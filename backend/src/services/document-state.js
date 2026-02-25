import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function createDocumentStateUtils() {
  async function inferNeedsSegmentationFromFileState(dir, rawText, segments) {
    const hasText = Boolean(String(rawText ?? "").trim());
    const hasSegments = Array.isArray(segments) && segments.length > 0;
    if (!hasSegments) return hasText;

    const [documentStats, segmentsStats] = await Promise.all([
      fs.stat(path.join(dir, "document.json")).catch(() => null),
      fs.stat(path.join(dir, "segments.json")).catch(() => null)
    ]);
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
    const files = ["document.json", "segments.json", "decisions.json", "events.jsonl", "events.log"];
    let revision = 0;
    let updatedAt = document?.updated_at ?? null;

    for (const name of files) {
      const stats = await fs.stat(path.join(dir, name)).catch(() => null);
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
