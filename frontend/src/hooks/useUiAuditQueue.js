import React from "react";

export function useUiAuditQueue({
  docId,
  buildUiActionPayload,
  extractUiTargetInfo,
  sendUiAuditActions,
  batchSize,
  maxQueue,
  flushMs,
  inputThrottleMs
}) {
  const uiAuditQueueRef = React.useRef([]);
  const uiAuditTimerRef = React.useRef(null);
  const uiAuditDocIdRef = React.useRef("");
  const uiAuditLastInputRef = React.useRef(new Map());

  React.useEffect(() => {
    uiAuditDocIdRef.current = docId || "";
  }, [docId]);

  const flushUiAuditQueue = React.useCallback(
    async ({ keepalive = false } = {}) => {
      if (uiAuditTimerRef.current) {
        clearTimeout(uiAuditTimerRef.current);
        uiAuditTimerRef.current = null;
      }
      const queue = uiAuditQueueRef.current;
      if (!Array.isArray(queue) || queue.length === 0) return;

      const batch = queue.splice(0, batchSize);
      const ok = await sendUiAuditActions(batch, { keepalive });
      if (!ok) {
        uiAuditQueueRef.current = [...batch, ...uiAuditQueueRef.current].slice(-maxQueue);
      }

      if (uiAuditQueueRef.current.length > 0 && !uiAuditTimerRef.current) {
        uiAuditTimerRef.current = setTimeout(() => {
          void flushUiAuditQueue();
        }, flushMs);
      }
    },
    [batchSize, flushMs, maxQueue, sendUiAuditActions]
  );

  const enqueueUiAuditAction = React.useCallback(
    (action) => {
      if (!action || typeof action !== "object") return;
      uiAuditQueueRef.current.push(action);
      if (uiAuditQueueRef.current.length > maxQueue) {
        uiAuditQueueRef.current = uiAuditQueueRef.current.slice(-maxQueue);
      }
      if (uiAuditQueueRef.current.length >= batchSize) {
        void flushUiAuditQueue();
        return;
      }
      if (!uiAuditTimerRef.current) {
        uiAuditTimerRef.current = setTimeout(() => {
          void flushUiAuditQueue();
        }, flushMs);
      }
    },
    [batchSize, flushMs, flushUiAuditQueue, maxQueue]
  );

  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const record = (type, event) => {
      const payload = buildUiActionPayload(type, event, uiAuditDocIdRef.current);
      if (!payload) return;
      enqueueUiAuditAction(payload);
    };

    const onClick = (event) => record("click", event);
    const onInput = (event) => {
      const target = extractUiTargetInfo(event.target);
      if (!target) return;
      const key = `${target.tag || "unknown"}|${target.id || ""}|${target.name || ""}|${target.class || ""}`;
      const now = Date.now();
      const prevAt = Number(uiAuditLastInputRef.current.get(key) ?? 0);
      if (now - prevAt < inputThrottleMs) return;
      uiAuditLastInputRef.current.set(key, now);
      record("input", event);
    };
    const onChange = (event) => record("change", event);
    const onSubmit = (event) => record("submit", event);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushUiAuditQueue({ keepalive: true });
      }
    };
    const onBeforeUnload = () => {
      void flushUiAuditQueue({ keepalive: true });
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (uiAuditTimerRef.current) {
        clearTimeout(uiAuditTimerRef.current);
        uiAuditTimerRef.current = null;
      }
      uiAuditLastInputRef.current = new Map();
      void flushUiAuditQueue({ keepalive: true });
    };
  }, [
    buildUiActionPayload,
    enqueueUiAuditAction,
    extractUiTargetInfo,
    flushUiAuditQueue,
    inputThrottleMs
  ]);
}
