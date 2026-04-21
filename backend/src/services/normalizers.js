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

function normalizeCompactString(value, maxLength = 512) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
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
  const legacy = { high: "Обязательно", medium: "Рекомендуется", low: "При наличии" };
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

export function normalizeResearchSourcesInput(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const normalized = {
        url: normalizeCompactString(entry.url, 2048),
        title: normalizeCompactString(entry.title),
        domain: normalizeCompactString(entry.domain, 255),
        snippet: normalizeCompactString(entry.snippet, 1024),
        applied_at: normalizeCompactString(entry.applied_at, 64),
        role: normalizeCompactString(entry.role, 64),
        attachment_role: normalizeCompactString(entry.attachment_role, 64),
        asset_id: normalizeCompactString(entry.asset_id, 128),
        reason: normalizeCompactString(entry.reason, 1024),
        scores:
          entry.scores && typeof entry.scores === "object"
            ? {
                total_score: Number(entry.scores.total_score ?? 0),
                source_score: Number(entry.scores.source_score ?? 0),
                visual_score: Number(entry.scores.visual_score ?? 0),
                montage_score: Number(entry.scores.montage_score ?? 0)
              }
            : null
      };
      return normalized.url || normalized.title || normalized.domain ? normalized : null;
    })
    .filter(Boolean)
    .slice(0, 64);
}

export function normalizeResearchDismissedUrlsInput(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  value.forEach((entry) => {
    const item =
      entry && typeof entry === "object"
        ? {
            url: normalizeCompactString(entry.url, 2048),
            title: normalizeCompactString(entry.title),
            domain: normalizeCompactString(entry.domain, 255),
            dismissed_at: normalizeCompactString(entry.dismissed_at, 64),
            source: normalizeCompactString(entry.source, 64)
          }
        : {
            url: normalizeCompactString(entry, 2048),
            title: "",
            domain: "",
            dismissed_at: "",
            source: ""
          };
    if (!item.url || seen.has(item.url)) return;
    seen.add(item.url);
    normalized.push(item);
  });
  return normalized.slice(0, 256);
}

export function normalizeResearchBundleTraceInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalizePick = (pick) => {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) return null;
    const normalized = {
      result_id: normalizeCompactString(pick.result_id, 128),
      title: normalizeCompactString(pick.title),
      domain: normalizeCompactString(pick.domain, 255),
      url: normalizeCompactString(pick.url, 2048),
      role: normalizeCompactString(pick.role, 64),
      asset_id: normalizeCompactString(pick.asset_id, 128),
      attachment_id: normalizeCompactString(pick.attachment_id, 128)
    };
    return normalized.result_id || normalized.title || normalized.url ? normalized : null;
  };
  const normalized = {
    run_id: normalizeCompactString(value.run_id, 128),
    source_result_id: normalizeCompactString(value.source_result_id, 128),
    visual_result_id: normalizeCompactString(value.visual_result_id, 128),
    applied_at: normalizeCompactString(value.applied_at, 64),
    source: normalizePick(value.source),
    visual: normalizePick(value.visual)
  };
  return normalized.run_id || normalized.source || normalized.visual ? normalized : null;
}

export function normalizeSegmentsInput(segments) {
  return segments.map((segment) => ({
    segment_id: String(segment.segment_id ?? ""),
    block_type: String(segment.block_type ?? "news"),
    text_quote: String(segment.text_quote ?? ""),
    section_id: segment.section_id ? String(segment.section_id) : null,
    section_title: segment.section_title ? String(segment.section_title) : null,
    section_index: Number.isFinite(Number(segment.section_index)) ? Number(segment.section_index) : null,
    research_use_topic_title: Boolean(segment?.research_use_topic_title),
    research_use_theme_tags: Boolean(segment?.research_use_theme_tags),
    topic_tags: Array.isArray(segment.topic_tags)
      ? [...new Set(segment.topic_tags.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 12)
      : [],
    section_tags: Array.isArray(segment.section_tags)
      ? [...new Set(segment.section_tags.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 12)
      : [],
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
    research_sources: normalizeResearchSourcesInput(decision.research_sources),
    research_dismissed_urls: normalizeResearchDismissedUrlsInput(decision.research_dismissed_urls),
    research_bundle_trace: normalizeResearchBundleTraceInput(decision.research_bundle_trace),
    version: Number(decision.version ?? 1)
  }));
}
