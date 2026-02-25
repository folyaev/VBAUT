import path from "node:path";

export function createMediaDownloadStateUtils(deps) {
  const {
    appendEvent,
    canonicalizeLinkUrl,
    getDocDir,
    normalizeLinkUrl,
    readOptionalJson,
    writeJson
  } = deps;

  const mediaDocumentWriteLocks = new Map();

  function normalizeDocumentMediaDownloads(raw) {
    if (!raw || typeof raw !== "object") return {};
    const result = {};
    Object.entries(raw).forEach(([key, value]) => {
      const canonicalKey = canonicalizeLinkUrl(key);
      if (!canonicalKey) return;
      if (!value || typeof value !== "object") {
        result[canonicalKey] = {
          url: canonicalKey,
          status: "completed",
          updated_at: null
        };
        return;
      }
      const normalizedUrl = normalizeLinkUrl(value.url ?? canonicalKey) || canonicalKey;
      result[canonicalKey] = {
        url: normalizedUrl,
        status: "completed",
        section_title: typeof value.section_title === "string" ? value.section_title : null,
        output_files: Array.isArray(value.output_files)
          ? value.output_files
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
              .slice(0, 50)
          : [],
        updated_at: typeof value.updated_at === "string" ? value.updated_at : null
      };
    });
    return result;
  }

  function isMediaAlreadyDownloaded(document, rawUrl) {
    const canonicalUrl = canonicalizeLinkUrl(rawUrl);
    if (!canonicalUrl) return false;
    const downloaded = normalizeDocumentMediaDownloads(document?.media_downloads);
    return Boolean(downloaded[canonicalUrl]);
  }

  async function withMediaDocumentWriteLock(docId, fn) {
    const id = String(docId ?? "").trim();
    if (!id) return fn();

    const previous = mediaDocumentWriteLocks.get(id) ?? Promise.resolve();
    const run = previous
      .catch(() => null)
      .then(() => fn());

    mediaDocumentWriteLocks.set(id, run);
    try {
      return await run;
    } finally {
      if (mediaDocumentWriteLocks.get(id) === run) {
        mediaDocumentWriteLocks.delete(id);
      }
    }
  }

  async function persistMediaDownloadState(job) {
    const docId = String(job?.doc_id ?? "").trim();
    const rawUrl = String(job?.url ?? "").trim();
    if (!docId || !rawUrl) return;
    const canonicalUrl = canonicalizeLinkUrl(rawUrl);
    if (!canonicalUrl) return;

    await withMediaDocumentWriteLock(docId, async () => {
      const dir = getDocDir(docId);
      const documentPath = path.join(dir, "document.json");
      const document = await readOptionalJson(documentPath);
      if (!document) return;

      const downloaded = normalizeDocumentMediaDownloads(document.media_downloads);
      downloaded[canonicalUrl] = {
        url: normalizeLinkUrl(rawUrl) || canonicalUrl,
        status: "completed",
        section_title: typeof job.section_title === "string" ? job.section_title : null,
        output_files: Array.isArray(job.output_files)
          ? job.output_files
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
              .slice(0, 50)
          : [],
        updated_at: new Date().toISOString()
      };

      document.media_downloads = downloaded;
      document.updated_at = new Date().toISOString();
      await writeJson(documentPath, document);
      await appendEvent(docId, {
        timestamp: document.updated_at,
        event: "media_download_recorded",
        payload: {
          url: canonicalUrl,
          section_title: downloaded[canonicalUrl].section_title,
          output_files: downloaded[canonicalUrl].output_files
        }
      });
    });
  }

  return {
    isMediaAlreadyDownloaded,
    normalizeDocumentMediaDownloads,
    persistMediaDownloadState
  };
}
