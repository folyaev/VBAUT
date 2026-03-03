import { config } from "../llm.js";

const FALLBACK_LIMITS = { maxKeywords: 8, maxQueries: 3 };
const VIDEO_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i;

function normalizeStringList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

export function emptySearchDecision() {
  return { keywords: [], queries: [] };
}

export function normalizeSearchDecisionInput(raw) {
  if (!raw || typeof raw !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? FALLBACK_LIMITS;
  const keywords = normalizeStringList(raw.keywords, limits.maxKeywords);
  const queries = normalizeStringList(raw.queries ?? raw.search_queries ?? raw.searchQueries, limits.maxQueries);
  return { keywords, queries };
}

export function emptyVisualDecision() {
  return {
    type: "no_visual",
    description: "",
    format_hint: null,
    duration_hint_sec: null,
    priority: null,
    media_file_path: null,
    media_file_paths: [],
    media_file_timecodes: {},
    media_start_timecode: null
  };
}

function normalizeMediaStartTimecode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > 32 ? normalized.slice(0, 32) : normalized;
}

export function normalizeMediaFilePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  return normalized.length > 512 ? normalized.slice(0, 512) : normalized;
}

function normalizeMediaFilePathList(value) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = [];
  const seen = new Set();

  items.forEach((item) => {
    const path = normalizeMediaFilePath(item);
    if (!path || seen.has(path)) return;
    seen.add(path);
    normalized.push(path);
  });

  return normalized.slice(0, 32);
}

function normalizeMediaFileTimecodes(value, mediaPaths = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(
    normalizeMediaFilePathList(mediaPaths).filter((mediaPath) => VIDEO_MEDIA_PATH_RE.test(mediaPath))
  );
  const normalized = {};
  Object.entries(value).forEach(([rawPath, rawTimecode]) => {
    const mediaPath = normalizeMediaFilePath(rawPath);
    if (!mediaPath || !allowed.has(mediaPath)) return;
    const timecode = normalizeMediaStartTimecode(rawTimecode);
    if (!timecode) return;
    normalized[mediaPath] = timecode;
  });
  return normalized;
}

function normalizeFormatHint(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "Документ", SQUARE: "1:1" };
  const upper = trimmed.toUpperCase();
  if (legacy[upper]) return legacy[upper];
  const list = config?.formatHints ?? [];
  const normalized = trimmed.toLowerCase();
  const match = list.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
}

function normalizePriority(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const legacy = { high: "обязательно", medium: "рекомендуется", low: "при наличии" };
  if (legacy[trimmed]) return legacy[trimmed];
  const list = config?.priorities ?? [];
  const match = list.find((priority) => priority.toLowerCase() === trimmed);
  return match ?? null;
}

export function normalizeVisualDecisionInput(raw) {
  if (!raw || typeof raw !== "object") return emptyVisualDecision();
  const typeRaw = String(raw.type ?? raw.visual_type ?? "").toLowerCase().trim();
  const legacyMap = {
    event_footage: "video",
    location: "image",
    explainer_graphic: "infographic",
    interface_ui: "interface",
    archive: "image",
    comparison: "generation_collage",
    generated_art: "generation_collage"
  };
  const mappedType = legacyMap[typeRaw] ?? typeRaw;
  const type = config?.visualTypes?.includes(mappedType) ? mappedType : "no_visual";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const formatHint = normalizeFormatHint(raw.format_hint);
  const durationRaw = raw.duration_hint_sec ?? raw.duration_hint ?? null;
  const durationHint = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  const priority = normalizePriority(raw.priority);
  const mediaPathCandidates = [];
  if (Array.isArray(raw.media_file_paths)) {
    mediaPathCandidates.push(...raw.media_file_paths);
  } else if (raw.media_file_paths != null) {
    mediaPathCandidates.push(raw.media_file_paths);
  }
  mediaPathCandidates.push(raw.media_file_path ?? raw.media_path ?? null);
  const mediaFilePaths = normalizeMediaFilePathList(mediaPathCandidates);
  const mediaFilePath = mediaFilePaths[0] ?? null;
  const mediaFileTimecodes = normalizeMediaFileTimecodes(
    raw.media_file_timecodes ?? raw.media_start_timecodes ?? null,
    mediaFilePaths
  );
  const mediaStartTimecodeRaw = normalizeMediaStartTimecode(raw.media_start_timecode ?? raw.media_start ?? null);
  const firstVideoPath = mediaFilePaths.find((mediaPath) => VIDEO_MEDIA_PATH_RE.test(mediaPath)) ?? null;
  if (firstVideoPath && mediaStartTimecodeRaw && !mediaFileTimecodes[firstVideoPath]) {
    mediaFileTimecodes[firstVideoPath] = mediaStartTimecodeRaw;
  }
  const mediaStartTimecode = firstVideoPath
    ? mediaFileTimecodes[firstVideoPath] ?? mediaStartTimecodeRaw ?? null
    : null;

  return {
    type,
    description,
    format_hint: formatHint,
    duration_hint_sec: durationHint,
    priority,
    media_file_path: mediaFilePath,
    media_file_paths: mediaFilePaths,
    media_file_timecodes: mediaFileTimecodes,
    media_start_timecode: mediaStartTimecode
  };
}

export function normalizeSegmentForDecision(segment) {
  return {
    segment_id: String(segment?.segment_id ?? ""),
    block_type: String(segment?.block_type ?? "news"),
    text_quote: String(segment?.text_quote ?? "")
  };
}

export function normalizeSegmentWithVisual(segment) {
  return {
    ...normalizeSegmentForDecision(segment),
    visual_decision: normalizeVisualDecisionInput(segment?.visual_decision)
  };
}

export function normalizeSegmentsInput(segments) {
  return segments.map((segment) => ({
    segment_id: String(segment.segment_id ?? ""),
    block_type: String(segment.block_type ?? "news"),
    text_quote: String(segment.text_quote ?? ""),
    section_id: segment.section_id ? String(segment.section_id) : null,
    section_title: segment.section_title ? String(segment.section_title) : null,
    section_index: Number.isFinite(Number(segment.section_index)) ? Number(segment.section_index) : null,
    links: Array.isArray(segment.links)
      ? segment.links.map((link) => ({
          url: String(link?.url ?? "").trim(),
          raw: link?.raw == null ? null : String(link.raw)
        }))
      : [],
    segment_status: segment.segment_status ? String(segment.segment_status) : null,
    is_done: Boolean(segment.is_done),
    version: Number(segment.version ?? 1)
  }));
}

export function normalizeDecisionsInput(decisions) {
  return decisions.map((decision) => ({
    segment_id: String(decision.segment_id ?? ""),
    visual_decision: normalizeVisualDecisionInput(decision.visual_decision ?? decision),
    search_decision: normalizeSearchDecisionInput(decision.search_decision ?? decision.visual_decision),
    search_decision_en: normalizeSearchDecisionInput(decision.search_decision_en),
    version: Number(decision.version ?? 1)
  }));
}
