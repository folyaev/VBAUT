import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_DEBOUNCE_MS = 1500;
const EXCLUDED_THEME_FOLDERS = new Set(["unsorted", "archive_projects", "archived", "graphics"]);

function normalizeBlockType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sanitizeDocFileName(value) {
  const fallback = "document";
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

function normalizeRelativeMediaPath(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableObject(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableObject(value[key]);
      return acc;
    }, {});
}

function hashPayload(value) {
  return createHash("sha1").update(JSON.stringify(stableObject(value))).digest("hex");
}

export function createXmlTimelineMirrorService(deps = {}) {
  const {
    buildXmlExportPayload,
    getDataDir,
    getMediaDir,
    normalizeVisualDecisionInput,
    sanitizeMediaTopicName,
    XML_EXPORT_DEFAULT_DURATION_SEC,
    XML_EXPORT_FPS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    enabled = true,
    logger = console
  } = deps;

  const statePath = typeof getDataDir === "function"
    ? path.join(getDataDir(), "_runtime", "xml-timeline-mirror-state.json")
    : "";
  let stateLoaded = false;
  let state = { entries: {} };
  let stateWritePromise = null;

  const timers = new Map();
  const pending = new Map();
  const running = new Map();

  async function loadState() {
    if (stateLoaded || !statePath) return;
    stateLoaded = true;
    const payload = await fs.readFile(statePath, "utf8").catch(() => "");
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
        state = {
          entries: { ...parsed.entries }
        };
      }
    } catch {
      state = { entries: {} };
    }
  }

  async function persistState() {
    if (!statePath) return;
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const payload = JSON.stringify(
      {
        entries: state.entries,
        updated_at: new Date().toISOString()
      },
      null,
      2
    );
    await fs.writeFile(statePath, payload, "utf8");
  }

  async function saveState() {
    stateWritePromise = (stateWritePromise ?? Promise.resolve())
      .catch(() => null)
      .then(() => persistState());
    return stateWritePromise;
  }

  function getSectionThemeName(segment) {
    const themeName = sanitizeMediaTopicName(String(segment?.section_title ?? "").trim() || "Без темы");
    const normalized = String(themeName ?? "").trim();
    if (!normalized) return "";
    if (EXCLUDED_THEME_FOLDERS.has(normalized.toLowerCase())) return "";
    return normalized;
  }

  function buildDecisionMap(decisions = []) {
    return new Map(
      (Array.isArray(decisions) ? decisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
  }

  async function buildSectionSignature({ docId, themeName, segments, decisionMap, mediaRoot }) {
    const mediaStats = [];
    const signatureSegments = [];

    for (const segment of segments) {
      const segmentId = String(segment?.segment_id ?? "").trim();
      const visual = normalizeVisualDecisionInput(decisionMap.get(segmentId)?.visual_decision);
      const mediaPathCandidates = [];
      if (Array.isArray(visual?.media_file_paths)) {
        mediaPathCandidates.push(...visual.media_file_paths);
      } else if (visual?.media_file_paths != null) {
        mediaPathCandidates.push(visual.media_file_paths);
      }
      if (visual?.media_file_path != null) {
        mediaPathCandidates.push(visual.media_file_path);
      }

      const normalizedMediaPaths = [...new Set(mediaPathCandidates.map((item) => normalizeRelativeMediaPath(item)).filter(Boolean))];
      for (const mediaPath of normalizedMediaPaths) {
        const absolutePath = path.resolve(mediaRoot, mediaPath.replace(/\//g, path.sep));
        const insideRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
        if (!insideRoot) {
          mediaStats.push({ path: mediaPath, exists: false, outside_root: true });
          continue;
        }
        const stats = await fs.stat(absolutePath).catch(() => null);
        mediaStats.push(
          stats && stats.isFile()
            ? {
                path: mediaPath,
                exists: true,
                size: Number(stats.size ?? 0),
                mtime_ms: Number(stats.mtimeMs ?? 0)
              }
            : {
                path: mediaPath,
                exists: false
              }
        );
      }

      signatureSegments.push({
        segment_id: segmentId,
        block_type: String(segment?.block_type ?? ""),
        text_quote: String(segment?.text_quote ?? ""),
        section_id: segment?.section_id ? String(segment.section_id) : null,
        section_title: segment?.section_title ? String(segment.section_title) : null,
        section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null,
        is_done: Boolean(segment?.is_done),
        visual: {
          type: String(visual?.type ?? ""),
          description: String(visual?.description ?? ""),
          format_hint: visual?.format_hint ?? null,
          priority: visual?.priority ?? null,
          duration_hint_sec: visual?.duration_hint_sec ?? null,
          media_file_paths: normalizedMediaPaths,
          media_file_path: normalizeRelativeMediaPath(visual?.media_file_path ?? ""),
          media_start_timecode: visual?.media_start_timecode ?? null,
          media_file_timecodes: stableObject(visual?.media_file_timecodes ?? {})
        }
      });
    }

    return hashPayload({
      doc_id: String(docId ?? "").trim(),
      theme_name: String(themeName ?? "").trim(),
      segments: signatureSegments,
      media_stats: mediaStats.sort((left, right) => String(left.path ?? "").localeCompare(String(right.path ?? "")))
    });
  }

  function collectThemeGroups(segments = []) {
    const groups = new Map();
    (Array.isArray(segments) ? segments : []).forEach((segment) => {
      if (normalizeBlockType(segment?.block_type) === "links") return;
      const themeName = getSectionThemeName(segment);
      if (!themeName) return;
      const key = themeName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { themeName, segments: [] });
      }
      groups.get(key).segments.push(segment);
    });
    return Array.from(groups.values());
  }

  async function removeManagedXml(entry) {
    const xmlPath = String(entry?.xml_path ?? "").trim();
    if (xmlPath) {
      await fs.unlink(xmlPath).catch(() => null);
    }
  }

  async function syncDocumentContextNow(docId, segments = [], decisions = [], options = {}) {
    if (!enabled || typeof buildXmlExportPayload !== "function" || typeof getMediaDir !== "function") {
      return { skipped: true, reason: "disabled" };
    }
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId) {
      return { skipped: true, reason: "missing_doc_id" };
    }

    await loadState();

    const mediaRoot = path.resolve(String(getMediaDir() ?? "").trim());
    if (!mediaRoot) {
      return { skipped: true, reason: "missing_media_root" };
    }
    await fs.mkdir(mediaRoot, { recursive: true });

    const decisionMap = buildDecisionMap(decisions);
    const themeGroups = collectThemeGroups(segments);
    const activeKeys = new Set();
    const safeDocPart = sanitizeDocFileName(normalizedDocId);
    let written = 0;
    let skipped = 0;
    let removed = 0;

    for (const group of themeGroups) {
      const themeName = String(group?.themeName ?? "").trim();
      if (!themeName) continue;
      const stateKey = `${normalizedDocId}::${themeName.toLowerCase()}`;
      activeKeys.add(stateKey);
      const topicDir = path.join(mediaRoot, themeName);
      const xmlPath = path.join(topicDir, `_timeline-${safeDocPart}.xml`);
      const signature = await buildSectionSignature({
        docId: normalizedDocId,
        themeName,
        segments: group.segments,
        decisionMap,
        mediaRoot
      });
      const previous = state.entries[stateKey] ?? null;
      if (previous?.signature === signature && String(previous?.xml_path ?? "").trim() === xmlPath) {
        skipped += 1;
        continue;
      }

      await fs.mkdir(topicDir, { recursive: true });
      const xmlPayload = await buildXmlExportPayload({
        document: options?.document ?? { id: normalizedDocId },
        segments: group.segments,
        decisionsBySegment: decisionMap,
        mediaDir: mediaRoot,
        mediaPathRootOverride: mediaRoot,
        fps: XML_EXPORT_FPS,
        defaultDurationSec: XML_EXPORT_DEFAULT_DURATION_SEC,
        sectionId: "",
        sectionTitle: themeName
      });

      if (!xmlPayload?.clipCount || !String(xmlPayload?.xml ?? "").trim()) {
        await fs.unlink(xmlPath).catch(() => null);
        delete state.entries[stateKey];
        removed += 1;
        continue;
      }

      await fs.writeFile(xmlPath, String(xmlPayload.xml), "utf8");
      state.entries[stateKey] = {
        doc_id: normalizedDocId,
        theme_name: themeName,
        xml_path: xmlPath,
        signature,
        clip_count: Number(xmlPayload.clipCount ?? 0),
        reason: String(options?.reason ?? "").trim() || null,
        updated_at: new Date().toISOString()
      };
      written += 1;
    }

    const staleKeys = Object.keys(state.entries).filter(
      (key) => key.startsWith(`${normalizedDocId}::`) && !activeKeys.has(key)
    );
    for (const key of staleKeys) {
      await removeManagedXml(state.entries[key]);
      delete state.entries[key];
      removed += 1;
    }

    await saveState();

    if (written > 0 && typeof logger?.info === "function") {
      logger.info(
        `[xml-mirror] synced doc=${normalizedDocId} reason=${String(options?.reason ?? "update")} written=${written} skipped=${skipped} removed=${removed}`
      );
    }

    return {
      ok: true,
      written,
      skipped,
      removed,
      themes: themeGroups.length
    };
  }

  function runPending(docId) {
    const payload = pending.get(docId);
    if (!payload) return;
    pending.delete(docId);
    const previous = running.get(docId) ?? Promise.resolve();
    const next = previous
      .catch(() => null)
      .then(() =>
        syncDocumentContextNow(payload.docId, payload.segments, payload.decisions, payload.options).catch((error) => {
          if (typeof logger?.warn === "function") {
            logger.warn(`[xml-mirror] sync failed doc=${payload.docId}: ${error?.message ?? error}`);
          }
          return null;
        })
      )
      .finally(() => {
        if (pending.has(docId)) {
          schedule(docId);
        } else {
          running.delete(docId);
        }
      });
    running.set(docId, next);
  }

  function schedule(docId) {
    const previousTimer = timers.get(docId);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      timers.delete(docId);
      runPending(docId);
    }, Math.max(100, Number(debounceMs) || DEFAULT_DEBOUNCE_MS));
    if (typeof timer?.unref === "function") timer.unref();
    timers.set(docId, timer);
  }

  function enqueueDocumentContextSync(docId, segments = [], decisions = [], options = {}) {
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId) return false;
    pending.set(normalizedDocId, {
      docId: normalizedDocId,
      segments: Array.isArray(segments) ? [...segments] : [],
      decisions: Array.isArray(decisions) ? [...decisions] : [],
      options: { ...options }
    });
    schedule(normalizedDocId);
    return true;
  }

  return {
    enqueueDocumentContextSync,
    syncDocumentContextNow
  };
}
