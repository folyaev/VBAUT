const VIDEO_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i;

export const TIMECODE_EDIT_FPS = 50;

export const VISUAL_TYPE_LABELS = {
  video: "Видео",
  portrait: "Портрет",
  image: "Картинка",
  infographic: "Инфографика",
  map: "Карта",
  interface: "Интерфейс",
  generation_collage: "Генерация / Коллаж",
  graphic_element: "Графический элемент",
  no_visual: "Без визуала"
};

export const FORMAT_HINT_LABELS = {
  "2:1": "2:1",
  "1:1": "1:1",
  "Заголовок/Цитата": "\u{1F4F0} Заголовок/Цитата",
  Документ: "\u{1F4DD} Документ"
};

export const PRIORITY_LABELS = {
  Обязательно: "\u{1F534} Обязательно",
  Рекомендуется: "\u{1F7E1} Рекомендуется",
  "При наличии": "\u{1F7E2} При наличии"
};

export const VISUAL_TYPE_DEFAULTS = {
  video: { format_hint: "2:1", priority: "Обязательно" },
  portrait: { format_hint: "1:1", priority: "Обязательно" },
  image: { format_hint: "2:1", priority: "Обязательно" },
  infographic: { format_hint: "2:1", priority: "Обязательно" },
  map: { format_hint: "2:1", priority: "Обязательно" },
  interface: { format_hint: "2:1", priority: "Обязательно" },
  generation_collage: { format_hint: "2:1", priority: "Обязательно" },
  graphic_element: { format_hint: "2:1", priority: "Обязательно" },
  no_visual: { format_hint: null, priority: null }
};

const DEFAULT_VISUAL_TYPES = Object.keys(VISUAL_TYPE_LABELS);
const DEFAULT_FORMAT_HINTS = Object.keys(FORMAT_HINT_LABELS);
const DEFAULT_PRIORITIES = Object.keys(PRIORITY_LABELS);

export function emptyVisualDecision() {
  return {
    type: "no_visual",
    description: "",
    description_meta: null,
    format_hint: null,
    duration_hint_sec: null,
    priority: null,
    media_file_path: null,
    media_file_paths: [],
    media_file_timecodes: {},
    media_start_timecode: null,
    media_meta: null
  };
}

function normalizeOwnershipOrigin(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "user" || normalized === "system") return normalized;
  return null;
}

function normalizeOwnershipTimestamp(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export function normalizeOwnershipMeta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const origin = normalizeOwnershipOrigin(raw.origin);
  if (!origin) return null;
  return {
    origin,
    updated_at: normalizeOwnershipTimestamp(raw.updated_at) ?? null
  };
}

export function emptySearchDecision() {
  return {
    keywords: [],
    queries: []
  };
}

export function normalizeMediaFilePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  return normalized.length > 512 ? normalized.slice(0, 512) : normalized;
}

export function normalizeMediaFilePathList(value) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const result = [];
  const seen = new Set();
  items.forEach((item) => {
    const normalized = normalizeMediaFilePath(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result.slice(0, 32);
}

export function normalizeMediaStartTimecode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > 32 ? normalized.slice(0, 32) : normalized;
}

export function isVideoMediaPath(value) {
  if (!value) return false;
  return VIDEO_MEDIA_PATH_RE.test(String(value));
}

export function normalizeMediaFileTimecodes(value, mediaPaths = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(
    normalizeMediaFilePathList(mediaPaths).filter((mediaPath) => isVideoMediaPath(mediaPath))
  );
  const result = {};
  Object.entries(value).forEach(([rawPath, rawTimecode]) => {
    const normalizedPath = normalizeMediaFilePath(rawPath);
    if (!normalizedPath || !allowed.has(normalizedPath)) return;
    const normalizedTimecode = normalizeMediaStartTimecode(rawTimecode);
    if (!normalizedTimecode) return;
    result[normalizedPath] = normalizedTimecode;
  });
  return result;
}

export function parseTimecodeToFrames(value, fps = TIMECODE_EDIT_FPS) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalizedRaw = raw.replace(",", ".");

  if (/^\d+(?:\.\d+)?$/.test(normalizedRaw)) {
    const sec = Number(normalizedRaw);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.max(0, Math.round(sec * fps));
  }

  const parts = raw.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((part) => !/^\d+(?:[.,]\d+)?$/.test(part))) return null;
  const nums = parts.map((part) => Number(part.replace(",", ".")));
  if (nums.some((num) => !Number.isFinite(num) || num < 0)) return null;

  if (parts.length === 2) {
    const [mm, ss] = nums;
    return Math.max(0, Math.round((mm * 60 + ss) * fps));
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = nums;
    return Math.max(0, Math.round((hh * 3600 + mm * 60 + ss) * fps));
  }

  const [hh, mm, ss, ff] = nums;
  return Math.max(0, Math.round((hh * 3600 + mm * 60 + ss) * fps + ff));
}

export function formatFramesAsTimecode(frames, fps = TIMECODE_EDIT_FPS) {
  const total = Math.max(0, Math.round(Number(frames) || 0));
  const perHour = 3600 * fps;
  const perMinute = 60 * fps;
  const hh = Math.floor(total / perHour);
  const mm = Math.floor((total % perHour) / perMinute);
  const ss = Math.floor((total % perMinute) / fps);
  const ff = total % fps;
  const pad2 = (num) => String(num).padStart(2, "0");
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

export function splitTimecodeToParts(value, fps = TIMECODE_EDIT_FPS) {
  const parsed = parseTimecodeToFrames(value, fps);
  const totalFrames = Math.max(0, parsed == null ? 0 : parsed);
  const totalSeconds = Math.floor(totalFrames / fps);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return {
    hh: hh > 0 ? String(hh) : "",
    mm: mm > 0 ? String(mm) : "",
    ss: ss > 0 ? String(ss) : ""
  };
}

export function partsToTimecode(parts, fps = TIMECODE_EDIT_FPS) {
  const hh = Math.max(0, Number.parseInt(String(parts?.hh ?? "0"), 10) || 0);
  const mm = Math.min(59, Math.max(0, Number.parseInt(String(parts?.mm ?? "0"), 10) || 0));
  const ss = Math.min(59, Math.max(0, Number.parseInt(String(parts?.ss ?? "0"), 10) || 0));
  const pad2 = (num) => String(num).padStart(2, "0");
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

export function buildMediaFileUrl(docId, mediaPath) {
  const id = String(docId ?? "").trim();
  const normalizedPath = normalizeMediaFilePath(mediaPath);
  if (!id || !normalizedPath) return "";
  return `/api/documents/${encodeURIComponent(id)}/media/file?path=${encodeURIComponent(normalizedPath)}`;
}

export function normalizeFormatHint(value, config) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "Документ", SQUARE: "1:1" };
  const upper = trimmed.toUpperCase();
  if (legacy[upper]) return legacy[upper];
  const list = config?.formatHints ?? DEFAULT_FORMAT_HINTS;
  const normalized = trimmed.toLowerCase();
  const match = list.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
}

export function normalizePriority(value, config) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  const legacy = {
    high: "Обязательно",
    medium: "Рекомендуется",
    low: "При наличии"
  };
  if (legacy[normalized]) return legacy[normalized];
  const list = config?.priorities ?? DEFAULT_PRIORITIES;
  const match = list.find((priority) => priority.toLowerCase() === normalized);
  return match ?? null;
}

export function normalizeKeywordList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

export function normalizeQueryList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split("\n");
  const normalized = items.map((item) => String(item ?? "").replace(/\r/g, ""));
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

export function normalizeVisualDecision(decision, config) {
  if (!decision || typeof decision !== "object") return emptyVisualDecision();
  const typeRaw = String(decision.type ?? decision.visual_type ?? "").toLowerCase().trim();
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
  const type = (config?.visualTypes ?? DEFAULT_VISUAL_TYPES).includes(mappedType) ? mappedType : "no_visual";
  const description = typeof decision.description === "string" ? decision.description : "";
  const format_hint = normalizeFormatHint(decision.format_hint, config);
  const durationRaw = decision.duration_hint_sec ?? decision.duration_hint ?? null;
  const duration_hint_sec = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  const priority = normalizePriority(decision.priority, config);
  const mediaPathCandidates = [];
  if (Array.isArray(decision.media_file_paths)) {
    mediaPathCandidates.push(...decision.media_file_paths);
  } else if (decision.media_file_paths != null) {
    mediaPathCandidates.push(decision.media_file_paths);
  }
  mediaPathCandidates.push(decision.media_file_path ?? decision.media_path ?? null);
  const media_file_paths = normalizeMediaFilePathList(mediaPathCandidates);
  const media_file_path = media_file_paths[0] ?? null;
  const media_file_timecodes = normalizeMediaFileTimecodes(
    decision.media_file_timecodes ?? decision.media_start_timecodes ?? null,
    media_file_paths
  );
  const legacyTimecode = normalizeMediaStartTimecode(decision.media_start_timecode ?? decision.media_start ?? null);
  const firstVideoPath = media_file_paths.find((mediaPath) => isVideoMediaPath(mediaPath)) ?? null;
  if (firstVideoPath && legacyTimecode && !media_file_timecodes[firstVideoPath]) {
    media_file_timecodes[firstVideoPath] = legacyTimecode;
  }
  const media_start_timecode = firstVideoPath ? media_file_timecodes[firstVideoPath] ?? legacyTimecode ?? null : null;
  return {
    type,
    description,
    description_meta: normalizeOwnershipMeta(decision.description_meta),
    format_hint,
    duration_hint_sec,
    priority,
    media_file_path,
    media_file_paths,
    media_file_timecodes,
    media_start_timecode,
    media_meta: normalizeOwnershipMeta(decision.media_meta)
  };
}

export function normalizeSearchDecision(decision, config) {
  if (!decision || typeof decision !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? { maxKeywords: 8, maxQueries: 3 };
  const keywords = normalizeKeywordList(decision.keywords, limits.maxKeywords);
  const queries = normalizeQueryList(decision.queries ?? decision.search_queries ?? decision.searchQueries, limits.maxQueries);
  return { keywords, queries };
}
