export function createNotionProgressStore(options = {}) {
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Math.max(1, Number(options.ttlMs)) : 15 * 60 * 1000;
  const maxMessages = Number.isFinite(Number(options.maxMessages))
    ? Math.max(1, Math.round(Number(options.maxMessages)))
    : 120;
  const maxResponseMessages = Number.isFinite(Number(options.maxResponseMessages))
    ? Math.max(1, Math.round(Number(options.maxResponseMessages)))
    : 40;
  const store = new Map();

  function pruneNotionProgressStore() {
    const now = Date.now();
    for (const [id, state] of store.entries()) {
      const updatedAt = Date.parse(String(state?.updated_at ?? ""));
      if (!Number.isFinite(updatedAt)) {
        store.delete(id);
        continue;
      }
      if (now - updatedAt > ttlMs) {
        store.delete(id);
      }
    }
  }

  function initNotionProgress(progressId) {
    const id = String(progressId ?? "").trim();
    if (!id) return;
    pruneNotionProgressStore();
    store.set(id, {
      id,
      messages: [],
      last_message: "",
      done: false,
      updated_at: new Date().toISOString()
    });
  }

  function pushNotionProgress(progressId, message) {
    const id = String(progressId ?? "").trim();
    if (!id) return;
    const text = String(message ?? "").trim();
    if (!text) return;

    const current = store.get(id) ?? {
      id,
      messages: [],
      last_message: "",
      done: false,
      updated_at: new Date().toISOString()
    };

    if (current.last_message === text) {
      current.updated_at = new Date().toISOString();
      store.set(id, current);
      return;
    }

    current.messages.push(text);
    if (current.messages.length > maxMessages) {
      current.messages = current.messages.slice(-maxMessages);
    }
    current.last_message = text;
    current.updated_at = new Date().toISOString();
    store.set(id, current);
  }

  function finishNotionProgress(progressId) {
    const id = String(progressId ?? "").trim();
    if (!id) return;
    const current = store.get(id);
    if (!current) return;
    current.done = true;
    current.updated_at = new Date().toISOString();
    store.set(id, current);
  }

  function getNotionProgress(progressId) {
    const id = String(progressId ?? "").trim();
    if (!id) return null;
    const current = store.get(id);
    if (!current) return null;
    return {
      progress_id: current.id,
      done: Boolean(current.done),
      last_message: current.last_message || "",
      messages: current.messages.slice(-maxResponseMessages),
      updated_at: current.updated_at
    };
  }

  return {
    finishNotionProgress,
    getNotionProgress,
    initNotionProgress,
    pruneNotionProgressStore,
    pushNotionProgress
  };
}
