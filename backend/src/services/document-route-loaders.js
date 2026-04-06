import path from "node:path";

export function createDocumentRouteLoaders(deps = {}) {
  const {
    getDocDir,
    readOptionalJson,
    getDocumentState,
    listDocSegments,
    listDocDecisions,
    getDocumentMediaDownloads,
    normalizeDocumentMediaDownloads
  } = deps;

  async function loadDocumentState(docId) {
    const normalizedId = String(docId ?? "").trim();
    if (!normalizedId) return null;
    if (typeof getDocumentState === "function") {
      const indexed = await getDocumentState(normalizedId);
      if (indexed && typeof indexed === "object") return indexed;
    }
    return readOptionalJson(path.join(getDocDir(normalizedId), "document.json"));
  }

  async function loadDocumentContext(docId) {
    const normalizedId = String(docId ?? "").trim();
    if (!normalizedId) return { segments: [], decisions: [] };
    const [segments, decisions] = await Promise.all([
      typeof listDocSegments === "function"
        ? listDocSegments(normalizedId)
        : readOptionalJson(path.join(getDocDir(normalizedId), "segments.json")),
      typeof listDocDecisions === "function"
        ? listDocDecisions(normalizedId)
        : readOptionalJson(path.join(getDocDir(normalizedId), "decisions.json"))
    ]);
    return {
      segments: Array.isArray(segments) ? segments : [],
      decisions: Array.isArray(decisions) ? decisions : []
    };
  }

  async function loadDocumentMediaDownloads(docId, document = null) {
    const normalizedId = String(docId ?? "").trim();
    if (!normalizedId) return {};
    if (typeof getDocumentMediaDownloads === "function") {
      const indexed = await getDocumentMediaDownloads(normalizedId);
      if (indexed && typeof indexed === "object") return indexed;
    }
    if (typeof normalizeDocumentMediaDownloads !== "function") return {};
    const state = document ?? (await loadDocumentState(normalizedId));
    return normalizeDocumentMediaDownloads(state?.media_downloads);
  }

  return {
    loadDocumentContext,
    loadDocumentMediaDownloads,
    loadDocumentState
  };
}
