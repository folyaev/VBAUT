import React from "react";

export function useReleaseMutations({
  fetchJsonSafe,
  docId,
  selectedReleaseId,
  selectedReleaseDetail,
  releaseDraftTitle,
  releaseDraftDate,
  setReleaseDraftTitle,
  setReleaseDraftDate,
  setSelectedReleaseId,
  setReleaseBusy,
  setAssetActionBusy,
  setStatus,
  refreshIntegration,
  reloadCurrentReleaseWorkspace,
  syncReleaseWorkspaceDataFromAction
}) {
  const handleCreateRelease = React.useCallback(
    async (event) => {
      event?.preventDefault?.();
      const title = String(releaseDraftTitle ?? "").trim();
      if (!title) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe("/api/releases", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            air_date: releaseDraftDate || "",
            status: "draft",
            document_id: docId || ""
          })
        });
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось создать выпуск");
        }
        const releaseId = data?.release?.id ?? "";
        setReleaseDraftTitle("");
        setReleaseDraftDate("");
        await refreshIntegration();
        if (releaseId) {
          setSelectedReleaseId(releaseId);
          await syncReleaseWorkspaceDataFromAction(data, {
            releaseId,
            detail: true,
            assistantPass: true,
            recommendations: true,
            draftPack: true,
            activity: true
          });
        }
        setStatus(`Создан выпуск: ${title}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось создать выпуск");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      docId,
      fetchJsonSafe,
      refreshIntegration,
      releaseDraftDate,
      releaseDraftTitle,
      setReleaseBusy,
      setReleaseDraftDate,
      setReleaseDraftTitle,
      setSelectedReleaseId,
      setStatus,
      syncReleaseWorkspaceDataFromAction
    ]
  );

  const handleAttachAssetToRelease = React.useCallback(
    async (assetId) => {
      if (!assetId || !selectedReleaseId) return;
      setAssetActionBusy((prev) => ({ ...prev, [assetId]: true }));
      try {
        const { response, data } = await fetchJsonSafe(`/api/assets/${encodeURIComponent(assetId)}/attachments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target_type: "release",
            target_id: selectedReleaseId,
            role: "story",
            attached_by: "vbaut_ui"
          })
        });
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось прикрепить asset к выпуску");
        }
        await fetchJsonSafe(`/api/assets/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "attached", processing_state: "attached" })
        }).catch(() => null);
        await reloadCurrentReleaseWorkspace({
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`Asset добавлен в выпуск ${selectedReleaseId}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось прикрепить asset");
      } finally {
        setAssetActionBusy((prev) => ({ ...prev, [assetId]: false }));
      }
    },
    [fetchJsonSafe, reloadCurrentReleaseWorkspace, selectedReleaseId, setAssetActionBusy, setStatus]
  );

  const handleDetachAssetFromRelease = React.useCallback(
    async (assetId, attachmentId) => {
      if (!assetId || !attachmentId || !selectedReleaseId) return;
      setAssetActionBusy((prev) => ({ ...prev, [assetId]: true }));
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/assets/${encodeURIComponent(assetId)}/attachments/${encodeURIComponent(attachmentId)}`,
          { method: "DELETE" }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось снять asset с выпуска");
        }
        await reloadCurrentReleaseWorkspace({
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`Asset снят с выпуска ${selectedReleaseId}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось снять asset");
      } finally {
        setAssetActionBusy((prev) => ({ ...prev, [assetId]: false }));
      }
    },
    [fetchJsonSafe, reloadCurrentReleaseWorkspace, selectedReleaseId, setAssetActionBusy, setStatus]
  );

  const handleUpdateRelease = React.useCallback(
    async (patch = {}) => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(`/api/releases/${encodeURIComponent(selectedReleaseId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось обновить выпуск");
        }
        await reloadCurrentReleaseWorkspace({
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`Выпуск ${selectedReleaseId} обновлён`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось обновить выпуск");
      } finally {
        setReleaseBusy(false);
      }
    },
    [fetchJsonSafe, reloadCurrentReleaseWorkspace, selectedReleaseId, setReleaseBusy, setStatus]
  );

  const handleReorderReleaseAsset = React.useCallback(
    async (attachmentId, direction) => {
      const currentItems = Array.isArray(selectedReleaseDetail?.assets) ? [...selectedReleaseDetail.assets] : [];
      const currentIndex = currentItems.findIndex((item) => item?.attachment?.id === attachmentId);
      if (currentIndex < 0) return;
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= currentItems.length) return;
      const [picked] = currentItems.splice(currentIndex, 1);
      currentItems.splice(nextIndex, 0, picked);
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(`/api/releases/${encodeURIComponent(selectedReleaseId)}/rundown`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attachment_ids: currentItems.map((item) => item?.attachment?.id).filter(Boolean)
          })
        });
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось переставить материалы выпуска");
        }
        await syncReleaseWorkspaceDataFromAction(data, {
          releaseId: selectedReleaseId,
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`Rundown ${selectedReleaseId} обновлён`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось обновить порядок выпуска");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseDetail,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncReleaseWorkspaceDataFromAction
    ]
  );

  const handleUpdateReleaseAttachment = React.useCallback(
    async (assetId, attachmentId, patch = {}) => {
      if (!assetId || !attachmentId) return;
      setAssetActionBusy((prev) => ({ ...prev, [assetId]: true }));
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/assets/${encodeURIComponent(assetId)}/attachments/${encodeURIComponent(attachmentId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch)
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось обновить release item");
        }
        await reloadCurrentReleaseWorkspace({
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`Release item ${attachmentId} обновлён`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось обновить release item");
      } finally {
        setAssetActionBusy((prev) => ({ ...prev, [assetId]: false }));
      }
    },
    [fetchJsonSafe, reloadCurrentReleaseWorkspace, setAssetActionBusy, setStatus]
  );

  return {
    handleCreateRelease,
    handleAttachAssetToRelease,
    handleDetachAssetFromRelease,
    handleUpdateRelease,
    handleReorderReleaseAsset,
    handleUpdateReleaseAttachment
  };
}
