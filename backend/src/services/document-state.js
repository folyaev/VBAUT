import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function createDocumentStateUtils() {
  function parseUpdatedAtMs(value) {
    const parsed = Date.parse(String(value ?? "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function readFileStatSafe(filePath) {
    return fs.stat(filePath).catch(() => null);
  }

  // Last-resort fallback when document/segment timestamps are absent in state.
  async function readSegmentationFileStats(dir) {
    const [documentStats, segmentsStats] = await Promise.all([
      readFileStatSafe(path.join(dir, "document.json")),
      readFileStatSafe(path.join(dir, "segments.json"))
    ]);
    return { documentStats, segmentsStats };
  }

  // Last-resort revision source for legacy paths that have no indexed summary yet.
  async function readDocumentRevisionFromFileStats(dir, document = null) {
    const files = ["document.json", "segments.json", "decisions.json", "events.jsonl", "events.log"];
    let revision = 0;
    let updatedAt = document?.updated_at ?? null;

    for (const name of files) {
      const stats = await readFileStatSafe(path.join(dir, name));
      if (!stats || !stats.isFile()) continue;
      const mtimeMs = Number(stats.mtimeMs ?? 0);
      if (mtimeMs > revision) {
        revision = mtimeMs;
        updatedAt = stats.mtime?.toISOString?.() ?? updatedAt;
      }
    }

    return {
      revision,
      updated_at: updatedAt
    };
  }

  async function inferNeedsSegmentationFromFileState(dir, rawText, segments, document = null) {
    const hasText = Boolean(String(rawText ?? "").trim());
    const hasSegments = Array.isArray(segments) && segments.length > 0;
    if (!hasSegments) return hasText;

    const documentUpdatedAtMs = Math.max(
      parseUpdatedAtMs(document?.updated_at),
      parseUpdatedAtMs(document?.created_at)
    );
    const latestSegmentUpdatedAtMs = Array.isArray(segments)
      ? Math.max(
          0,
          ...segments.map((segment) =>
            Math.max(
              parseUpdatedAtMs(segment?.updated_at),
              parseUpdatedAtMs(segment?.created_at)
            )
          )
        )
      : 0;
    if (documentUpdatedAtMs > 0 && latestSegmentUpdatedAtMs > 0) {
      return documentUpdatedAtMs > latestSegmentUpdatedAtMs;
    }

    const { documentStats, segmentsStats } = await readSegmentationFileStats(dir);
    if (!documentStats || !segmentsStats) return false;
    return Number(documentStats.mtimeMs ?? 0) > Number(segmentsStats.mtimeMs ?? 0);
  }

  function hashDocumentText(rawText) {
    return createHash("sha1").update(String(rawText ?? ""), "utf8").digest("hex");
  }

  function getDocumentLastSegmentedHash(document) {
    const value = document?.last_segmented_text_hash;
    return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
  }

  function getDocumentNeedsSegmentation(document) {
    const explicit = document?.needs_segmentation;
    if (typeof explicit === "boolean") return explicit;
    const lastSegmentedHash = getDocumentLastSegmentedHash(document);
    if (!lastSegmentedHash) return false;
    const rawTextHash = hashDocumentText(document?.raw_text ?? "");
    return rawTextHash !== lastSegmentedHash;
  }

  function syncDocumentSegmentationState(document, rawText) {
    const lastSegmentedHash = getDocumentLastSegmentedHash(document);
    const rawTextHash = hashDocumentText(rawText ?? "");
    document.needs_segmentation = !lastSegmentedHash || rawTextHash !== lastSegmentedHash;
  }

  function markDocumentSegmented(document, rawText) {
    document.last_segmented_text_hash = hashDocumentText(rawText ?? "");
    document.needs_segmentation = false;
  }

  function normalizeDocumentForResponse(document) {
    if (!document || typeof document !== "object") return document;
    return {
      ...document,
      needs_segmentation: getDocumentNeedsSegmentation(document),
      last_segmented_text_hash: getDocumentLastSegmentedHash(document) || null
    };
  }

  function shouldInferNeedsSegmentation(document) {
    return typeof document?.needs_segmentation !== "boolean" && !getDocumentLastSegmentedHash(document);
  }

  async function readDocumentState(dir, document = null) {
    return readDocumentRevisionFromFileStats(dir, document);
  }

  return {
    getDocumentLastSegmentedHash,
    inferNeedsSegmentationFromFileState,
    markDocumentSegmented,
    normalizeDocumentForResponse,
    readDocumentState,
    shouldInferNeedsSegmentation,
    syncDocumentSegmentationState
  };
}
