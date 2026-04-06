import React from "react";

export function useCollaborativeSession({
  docId,
  buildSessionPayload,
  fetchJsonSafe,
  getSessionFingerprint,
  autosaveDebounceMs,
  onError
}) {
  const [collabAutoSaving, setCollabAutoSaving] = React.useState(false);
  const [collabRevision, setCollabRevision] = React.useState(0);

  const collabSaveTimerRef = React.useRef(null);
  const collabIsApplyingRemoteRef = React.useRef(false);
  const collabLastSavedFingerprintRef = React.useRef("");
  const collabAutoSaveInFlightRef = React.useRef(false);
  const collabPollInFlightRef = React.useRef(false);
  const collabRevisionRef = React.useRef(0);
  const initialDocRestoreDoneRef = React.useRef(false);

  React.useEffect(() => {
    collabRevisionRef.current = collabRevision;
  }, [collabRevision]);

  const rememberSessionSnapshot = React.useCallback(
    (snapshot, revision = 0) => {
      collabLastSavedFingerprintRef.current = getSessionFingerprint(snapshot);
      const normalizedRevision = Number(revision);
      if (Number.isFinite(normalizedRevision) && normalizedRevision > 0) {
        collabRevisionRef.current = normalizedRevision;
        setCollabRevision(normalizedRevision);
        return;
      }
      collabRevisionRef.current = 0;
      setCollabRevision(0);
    },
    [getSessionFingerprint]
  );

  const hasUnsavedChanges = React.useMemo(() => {
    if (!docId) return false;
    const fingerprint = getSessionFingerprint(buildSessionPayload());
    return fingerprint !== collabLastSavedFingerprintRef.current;
  }, [buildSessionPayload, collabAutoSaving, collabRevision, docId, getSessionFingerprint]);

  const isSnapshotDirty = React.useCallback(
    (snapshot) => getSessionFingerprint(snapshot) !== collabLastSavedFingerprintRef.current,
    [getSessionFingerprint]
  );

  const runWithRemoteApply = React.useCallback((callback) => {
    collabIsApplyingRemoteRef.current = true;
    try {
      return callback?.();
    } finally {
      setTimeout(() => {
        collabIsApplyingRemoteRef.current = false;
      }, 0);
    }
  }, []);

  const saveSessionSnapshot = React.useCallback(
    async (snapshot, source = "manual") => {
      if (!docId) throw new Error("Document is not selected.");
      const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/session`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...snapshot, source })
      });
      if (!response.ok) throw new Error(data?.error ?? "Session save error");
      rememberSessionSnapshot(snapshot, data?.revision);
      return data;
    },
    [docId, fetchJsonSafe, rememberSessionSnapshot]
  );

  React.useEffect(() => {
    if (collabSaveTimerRef.current) {
      clearTimeout(collabSaveTimerRef.current);
      collabSaveTimerRef.current = null;
    }
    if (!docId) {
      setCollabAutoSaving(false);
      return;
    }
    if (collabIsApplyingRemoteRef.current) return;

    const snapshot = buildSessionPayload();
    const fingerprint = getSessionFingerprint(snapshot);
    if (fingerprint === collabLastSavedFingerprintRef.current) return;

    collabSaveTimerRef.current = setTimeout(async () => {
      collabSaveTimerRef.current = null;
      if (collabAutoSaveInFlightRef.current) return;
      collabAutoSaveInFlightRef.current = true;
      setCollabAutoSaving(true);
      try {
        await saveSessionSnapshot(snapshot, "auto");
      } catch (error) {
        if (typeof onError === "function") {
          onError(error);
        }
      } finally {
        collabAutoSaveInFlightRef.current = false;
        setCollabAutoSaving(false);
      }
    }, autosaveDebounceMs);

    return () => {
      if (collabSaveTimerRef.current) {
        clearTimeout(collabSaveTimerRef.current);
        collabSaveTimerRef.current = null;
      }
    };
  }, [autosaveDebounceMs, buildSessionPayload, docId, getSessionFingerprint, onError, saveSessionSnapshot]);

  return {
    collabAutoSaving,
    collabRevision,
    collabAutoSaveInFlightRef,
    collabPollInFlightRef,
    collabRevisionRef,
    hasUnsavedChanges,
    initialDocRestoreDoneRef,
    isSnapshotDirty,
    rememberSessionSnapshot,
    runWithRemoteApply,
    saveSessionSnapshot
  };
}
