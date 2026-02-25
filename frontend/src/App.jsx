import React, { useEffect, useState } from "react";
const defaultConfig = {
  blockTypes: ["news", "ad", "selfad", "intro", "outro"],
  visualTypes: [
    "video",
    "portrait",
    "image",
    "infographic",
    "map",
    "interface",
    "generation_collage",
    "graphic_element",
    "no_visual"
  ],
  formatHints: ["2:1", "1:1", "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a/\u0426\u0438\u0442\u0430\u0442\u0430", "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442"],
  priorities: ["\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e", "\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f", "\u043f\u0440\u0438 \u043d\u0430\u043b\u0438\u0447\u0438\u0438"],
  searchLimits: { maxKeywords: 8, maxQueries: 3 },
  searchEngines: [
    { id: "youtube", label: "YouTube", url: "https://www.youtube.com/results?search_query=" },
    {
      id: "youtube_7d_hd",
      label: "YouTube 7 days HD",
      url: "https://www.youtube.com/results?search_query=",
      suffix: "&sp=EgYIAxABIAE%253D"
    },
    {
      id: "yandex_hq",
      label: "\u042f\u043d\u0434\u0435\u043a\u0441 HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&isize=large"
    },
    {
      id: "yandex_hq_square",
      label: "1:1 \u042f\u043d\u0434\u0435\u043a\u0441 HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&iorient=square&isize=large"
    },
    {
      id: "google_hq",
      label: "Google HQ",
      url: "https://www.google.com/search?q=",
      suffix: "&tbm=isch&tbs=isz:l"
    },
    { id: "vk_video", label: "VK \u0412\u0438\u0434\u0435\u043e", url: "https://vk.com/search/video?q=" },
    { id: "vk", label: "VK \u041f\u043e\u0441\u0442", url: "https://vk.com/search?q=" },
    {
      id: "x_live",
      label: "X",
      url: "https://x.com/search?q=",
      suffix: "&src=typed_query&f=live"
    },
    { id: "dzen_news", label: "\u0414\u0437\u0435\u043d.\u041d\u043e\u0432\u043e\u0441\u0442\u0438", url: "https://dzen.ru/news/search?query=" },
    { id: "reddit", label: "Reddit", url: "https://www.reddit.com/search/?q=" },
    { id: "perplexity", label: "Copy and Perplexity", url: "https://www.perplexity.ai/", action: "copy_open" }
  ]
};
const HEADING_SEARCH_RU_ENGINE_IDS = new Set(["vk", "vk_video", "perplexity"]);
const HEADING_EN_SEARCH_ENGINES = [
  { id: "yt_reuters", label: "Reuters", url: "https://www.youtube.com/@Reuters/search?query=" },
  { id: "yt_afp", label: "AFP", url: "https://www.youtube.com/@AFP/search?query=" },
  { id: "yt_nypost", label: "NY Post", url: "https://www.youtube.com/@nypost/search?query=" },
  { id: "yt_wthr13", label: "WTHR13", url: "https://www.youtube.com/@WTHR13News/search?query=" },
  { id: "yt_independent", label: "Independent", url: "https://www.youtube.com/@theindependent/search?query=" }
];
const YTDLP_CANDIDATE_HOSTS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)dailymotion\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)vk\.com$/i,
  /(^|\.)rutube\.ru$/i,
  /(^|\.)ok\.ru$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.watch$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)streamable\.com$/i,
  /(^|\.)soundcloud\.com$/i
];
const DIRECT_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|m3u8|mp3|m4a|wav|flac)(?:$|[?#])/i;
const VIDEO_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i;
const TIMECODE_EDIT_FPS = 50;
const VISUAL_TYPE_LABELS = {
  video: "\u0412\u0438\u0434\u0435\u043e",
  portrait: "\u041f\u043e\u0440\u0442\u0440\u0435\u0442",
  image: "\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430",
  infographic: "\u0418\u043d\u0444\u043e\u0433\u0440\u0430\u0444\u0438\u043a\u0430",
  map: "\u041a\u0430\u0440\u0442\u0430",
  interface: "\u0418\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441",
  generation_collage: "\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f / \u041a\u043e\u043b\u043b\u0430\u0436",
  graphic_element: "\u0413\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442",
  no_visual: "\u0411\u0435\u0437 \u0432\u0438\u0437\u0443\u0430\u043b\u0430"
};
const FORMAT_HINT_LABELS = {
  "2:1": "2:1",
  "1:1": "1:1",
  "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a/\u0426\u0438\u0442\u0430\u0442\u0430": "\u{1F4F0} \u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a/\u0426\u0438\u0442\u0430\u0442\u0430",
  "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442": "\u{1F4DD} \u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442"
};
const PRIORITY_LABELS = {
  "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e": "\u{1F534} \u041e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e",
  "\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f": "\u{1F7E1} \u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f",
  "\u043f\u0440\u0438 \u043d\u0430\u043b\u0438\u0447\u0438\u0438": "\u{1F7E2} \u041f\u0440\u0438 \u043d\u0430\u043b\u0438\u0447\u0438\u0438"
};
const VISUAL_TYPE_DEFAULTS = {
  video: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  portrait: { format_hint: "1:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  image: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  infographic: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  map: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  interface: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  generation_collage: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  graphic_element: { format_hint: "2:1", priority: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e" },
  no_visual: { format_hint: null, priority: null }
};
const emptyVisualDecision = () => ({
  type: "no_visual",
  description: "",
  format_hint: null,
  duration_hint_sec: null,
  priority: null,
  media_file_path: null,
  media_start_timecode: null
});
const emptySearchDecision = () => ({
  keywords: [],
  queries: []
});
const normalizeVisualDecision = (decision, config) => {
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
  const type = (config?.visualTypes ?? defaultConfig.visualTypes).includes(mappedType) ? mappedType : "no_visual";
  const description = typeof decision.description === "string" ? decision.description : "";
  const format_hint = normalizeFormatHint(decision.format_hint, config);
  const durationRaw = decision.duration_hint_sec ?? decision.duration_hint ?? null;
  const duration_hint_sec = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  const priority = normalizePriority(decision.priority, config);
  const media_file_path = normalizeMediaFilePath(decision.media_file_path ?? decision.media_path ?? null);
  const media_start_timecode = normalizeMediaStartTimecode(decision.media_start_timecode ?? decision.media_start ?? null);
  return {
    type,
    description,
    format_hint,
    duration_hint_sec,
    priority,
    media_file_path,
    media_start_timecode
  };
};
const normalizeFormatHint = (value, config) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442", SQUARE: "1:1" };
  const upper = trimmed.toUpperCase();
  if (legacy[upper]) return legacy[upper];
  const list = config?.formatHints ?? defaultConfig.formatHints;
  const normalized = trimmed.toLowerCase();
  const match = list.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
};
const normalizePriority = (value, config) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const legacy = {
    high: "\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e",
    medium: "\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f",
    low: "\u043f\u0440\u0438 \u043d\u0430\u043b\u0438\u0447\u0438\u0438"
  };
  if (legacy[trimmed]) return legacy[trimmed];
  const list = config?.priorities ?? defaultConfig.priorities;
  const match = list.find((priority) => priority.toLowerCase() === trimmed);
  return match ?? null;
};
const normalizeKeywordList = (value, limit) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
};
const normalizeQueryList = (value, limit) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split("\n");
  const normalized = items.map((item) => String(item ?? "").replace(/\r/g, ""));
  if (!limit) return normalized;
  return normalized.slice(0, limit);
};
const getInitialTheme = () => {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage?.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
};
const formatDocDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};
const formatRecentDocLabel = (doc) => {
  if (!doc) return "";
  const dateLabel = formatDocDate(doc.updated_at ?? doc.created_at);
  return dateLabel ? `${doc.id} - ${dateLabel}` : doc.id;
};
const getNeedsSegmentationFromDocument = (document) => {
  if (!document || typeof document !== "object") return false;
  return Boolean(document.needs_segmentation);
};
const formatBytes = (value) => {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let current = size;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[idx]}`;
};
const normalizeMediaFilePath = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  return normalized.length > 512 ? normalized.slice(0, 512) : normalized;
};
const normalizeMediaStartTimecode = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > 32 ? normalized.slice(0, 32) : normalized;
};

const parseTimecodeToFrames = (value, fps = TIMECODE_EDIT_FPS) => {
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
};

const formatFramesAsTimecode = (frames, fps = TIMECODE_EDIT_FPS) => {
  const total = Math.max(0, Math.round(Number(frames) || 0));
  const perHour = 3600 * fps;
  const perMinute = 60 * fps;
  const hh = Math.floor(total / perHour);
  const mm = Math.floor((total % perHour) / perMinute);
  const ss = Math.floor((total % perMinute) / fps);
  const ff = total % fps;
  const pad2 = (num) => String(num).padStart(2, "0");
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
};
const splitTimecodeToParts = (value, fps = TIMECODE_EDIT_FPS) => {
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
};

const partsToTimecode = (parts, fps = TIMECODE_EDIT_FPS) => {
  const hh = Math.max(0, Number.parseInt(String(parts?.hh ?? "0"), 10) || 0);
  const mm = Math.min(59, Math.max(0, Number.parseInt(String(parts?.mm ?? "0"), 10) || 0));
  const ss = Math.min(59, Math.max(0, Number.parseInt(String(parts?.ss ?? "0"), 10) || 0));
  const pad2 = (num) => String(num).padStart(2, "0");
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
};

const isVideoMediaPath = (value) => {
  if (!value) return false;
  return VIDEO_MEDIA_PATH_RE.test(String(value));
};
const buildMediaFileUrl = (docId, mediaPath) => {
  const id = String(docId ?? "").trim();
  const normalizedPath = normalizeMediaFilePath(mediaPath);
  if (!id || !normalizedPath) return "";
  return `/api/documents/${encodeURIComponent(id)}/media/file?path=${encodeURIComponent(normalizedPath)}`;
};
const getFileNameFromDisposition = (value) => {
  const header = String(value ?? "").trim();
  if (!header) return "";
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }
  const plainMatch = header.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] ? plainMatch[1].trim() : "";
};
const isYtDlpCandidateUrl = (rawUrl) => {
  const normalized = normalizeLinkUrl(rawUrl);
  if (!normalized) return false;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (DIRECT_MEDIA_PATH_RE.test(parsed.pathname + parsed.search)) return true;
  return YTDLP_CANDIDATE_HOSTS.some((pattern) => pattern.test(parsed.hostname.toLowerCase()));
};
const formatMediaJobProgress = (job) => {
  const bucket = Number(job?.progress_bucket);
  if (Number.isFinite(bucket)) return `${Math.max(0, Math.min(100, bucket))}%`;
  const text = String(job?.progress ?? "").trim();
  return text;
};
const COLLAB_AUTOSAVE_DEBOUNCE_MS = 1200;
const COLLAB_POLL_INTERVAL_MS = 2500;
const COLLAB_REMOTE_POLL_ENABLED = false;
const LAST_USED_DOC_STORAGE_KEY = "vbaut:last_used_doc_id";
const AUTO_OPEN_LAST_DOC_STORAGE_KEY = "vbaut:auto_open_last_doc";
const API_HTML_RESPONSE_ERROR =
  "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b HTML \u0432\u043c\u0435\u0441\u0442\u043e JSON. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 backend, Vite proxy (/api) \u0438 \u0442\u0443\u043d\u043d\u0435\u043b\u044c ngrok.";

const shouldLookLikeJson = (text = "") => {
  const trimmed = String(text).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  return false;
};

async function fetchJsonSafe(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (!headers.has("ngrok-skip-browser-warning")) {
    headers.set("ngrok-skip-browser-warning", "1");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const rawText = await response.text();
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();

  if (!rawText.trim()) {
    return { response, data: null, rawText };
  }

  if (contentType.includes("application/json") || shouldLookLikeJson(rawText)) {
    try {
      const data = JSON.parse(rawText);
      return { response, data, rawText };
    } catch {
      throw new Error(
        "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u043d\u044b\u0439 JSON. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 backend."
      );
    }
  }

  if (/^\s*<!doctype html|^\s*<html/i.test(rawText)) {
    throw new Error(API_HTML_RESPONSE_ERROR);
  }

  return { response, data: null, rawText };
}
const UI_AUDIT_BATCH_SIZE = 25;
const UI_AUDIT_MAX_QUEUE = 500;
const UI_AUDIT_FLUSH_MS = 1500;
const UI_AUDIT_INPUT_THROTTLE_MS = 1200;
const UI_AUDIT_TARGET_SELECTOR = "button,a,input,select,textarea,[role='button'],[data-action],[data-audit],label";
const UI_AUDIT_TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week"
]);

const truncateText = (value, maxLength = 160) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= maxLength ? text : text.slice(0, maxLength);
};

const safeUrlHint = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncateText(text, 200);
  }
};

const extractUiTargetInfo = (rawTarget) => {
  if (typeof window === "undefined") return null;
  if (!(rawTarget instanceof Element)) return null;
  const target = rawTarget.closest(UI_AUDIT_TARGET_SELECTOR) ?? rawTarget;
  if (!(target instanceof Element)) return null;

  const base = {
    tag: String(target.tagName ?? "").toLowerCase(),
    id: truncateText(target.id, 80) || null,
    name: truncateText(target.getAttribute("name"), 80) || null,
    role: truncateText(target.getAttribute("role"), 80) || null,
    class: truncateText(target.className, 120) || null,
    text: truncateText(target.textContent, 120) || null,
    type: null,
    href: null,
    data_action: truncateText(target.getAttribute("data-action"), 120) || null
  };

  if (target instanceof HTMLInputElement) {
    base.type = truncateText(target.type, 40) || "input";
    return base;
  }
  if (target instanceof HTMLTextAreaElement) {
    base.type = "textarea";
    return base;
  }
  if (target instanceof HTMLSelectElement) {
    base.type = "select";
    return base;
  }
  if (target instanceof HTMLAnchorElement) {
    base.type = "link";
    base.href = safeUrlHint(target.href) || null;
    return base;
  }
  base.type = base.tag || null;
  return base;
};

const buildUiActionPayload = (eventType, event, docId) => {
  if (!event || typeof eventType !== "string") return null;
  const target = extractUiTargetInfo(event.target);
  if (!target) return null;

  const meta = {
    trusted: Boolean(event.isTrusted)
  };

  if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLInputElement) {
    const inputType = String(event.target.type ?? "").toLowerCase();
    if (inputType === "checkbox" || inputType === "radio") {
      meta.checked = Boolean(event.target.checked);
    } else if (UI_AUDIT_TEXT_INPUT_TYPES.has(inputType)) {
      meta.value_length = String(event.target.value ?? "").length;
    } else {
      meta.value_hint = truncateText(event.target.value, 120) || null;
    }
  } else if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLTextAreaElement) {
    meta.value_length = String(event.target.value ?? "").length;
  } else if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLSelectElement) {
    meta.value_hint = truncateText(event.target.value, 120) || null;
  } else if (eventType === "submit" && event.target instanceof HTMLFormElement) {
    meta.form_action = safeUrlHint(event.target.action) || null;
  }

  return {
    ts: new Date().toISOString(),
    type: eventType,
    path: `${window.location.pathname}${window.location.search}`,
    doc_id: docId || null,
    target,
    meta
  };
};

async function sendUiAuditActions(actions, options = {}) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return true;
  const bodyText = JSON.stringify({
    source: "frontend_app",
    actions: list
  });

  const keepalive = Boolean(options.keepalive);
  try {
    await fetch("/api/audit/ui-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "ngrok-skip-browser-warning": "1"
      },
      body: bodyText,
      keepalive
    });
    return true;
  } catch {
    return false;
  }
}

const getInitialCollaborativeMode = () => {
  return false;
};
const getInitialAutoOpenLastDoc = () => {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage?.getItem(AUTO_OPEN_LAST_DOC_STORAGE_KEY);
  if (raw === "0") return false;
  return true;
};
const buildSessionPayloadFromState = ({ scriptText, notionUrl, segments }) => {
  const { segmentsPayload, decisionsPayload } = splitSegmentsAndDecisions(segments);
  return {
    raw_text: scriptText,
    notion_url: notionUrl.trim() || null,
    segments: segmentsPayload,
    decisions: decisionsPayload
  };
};
const getSessionFingerprint = (snapshot) => JSON.stringify(snapshot ?? {});
const normalizeSearchDecision = (decision, config) => {
  if (!decision || typeof decision !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? defaultConfig.searchLimits;
  const keywords = normalizeKeywordList(decision.keywords, limits.maxKeywords);
  const queries = normalizeQueryList(decision.queries ?? decision.search_queries ?? decision.searchQueries, limits.maxQueries);
  return { keywords, queries };
};
const normalizeSegmentBlockType = (value) => {
  const normalized = String(value ?? "").toLowerCase().trim();
  return normalized === "links" ? "links" : "news";
};
const VOWELS_RU = new Set(["\u0430", "\u0435", "\u0451", "\u0438", "\u043e", "\u0443", "\u044b", "\u044d", "\u044e", "\u044f"]);
const VOWELS_EN = new Set(["a", "e", "i", "o", "u", "y"]);
const RU_UNITS_SYL = [0, 2, 1, 1, 3, 1, 1, 1, 2, 2];
const RU_TEENS_SYL = [2, 4, 3, 3, 4, 3, 3, 3, 4, 4];
const RU_TENS_SYL = [0, 0, 2, 2, 2, 3, 3, 3, 4, 4];
const RU_HUNDREDS_SYL = [0, 1, 2, 2, 4, 2, 2, 2, 3, 3];
const RU_SCALES = [
  null,
  { singular: 3, few: 3, many: 2 },
  { singular: 3, few: 4, many: 4 },
  { singular: 3, few: 4, many: 4 },
  { singular: 3, few: 4, many: 4 }
];
const countRussianGroupSyllables = (value) => {
  const hundreds = Math.floor(value / 100);
  const tensUnits = value % 100;
  let total = RU_HUNDREDS_SYL[hundreds] ?? 0;
  if (tensUnits >= 10 && tensUnits <= 19) {
    total += RU_TEENS_SYL[tensUnits - 10] ?? 0;
    return total;
  }
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;
  total += (RU_TENS_SYL[tens] ?? 0) + (RU_UNITS_SYL[units] ?? 0);
  return total;
};
const countRussianScaleSyllables = (scaleIndex, groupValue) => {
  if (scaleIndex === 0 || groupValue === 0) return 0;
  const scale = RU_SCALES[scaleIndex] ?? { singular: 3, few: 4, many: 4 };
  const mod100 = groupValue % 100;
  if (mod100 >= 11 && mod100 <= 19) return scale.many;
  const mod10 = groupValue % 10;
  if (mod10 === 1) return scale.singular;
  if (mod10 >= 2 && mod10 <= 4) return scale.few ?? scale.many;
  return scale.many;
};
const countNumberSyllables = (digits) => {
  if (!digits) return 0;
  const cleaned = String(digits).replace(/^0+(?=\d)/, "");
  if (cleaned === "0") return 1;
  let total = 0;
  let groupIndex = 0;
  for (let end = cleaned.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    const groupValue = Number(cleaned.slice(start, end));
    if (groupValue) {
      total += countRussianGroupSyllables(groupValue);
      total += countRussianScaleSyllables(groupIndex, groupValue);
    }
    groupIndex += 1;
  }
  return total;
};
const countSyllables = (text) => {
  const tokens = String(text ?? "").match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return 0;
  let total = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      total += countNumberSyllables(token);
      continue;
    }
    let count = 0;
    const hasCyrillic = /[\p{Script=Cyrillic}]/u.test(token);
    if (hasCyrillic) {
      for (const ch of token) {
        if (VOWELS_RU.has(ch.toLowerCase())) count += 1;
      }
    } else {
      let prevIsVowel = false;
      for (const ch of token) {
        const isVowel = VOWELS_EN.has(ch.toLowerCase());
        if (isVowel && !prevIsVowel) count += 1;
        prevIsVowel = isVowel;
      }
    }
    total += count || 1;
  }
  return total;
};
const computeDurationHint = (text) => {
  const syllables = countSyllables(text);
  if (!syllables) return null;
  return Math.ceil(syllables / 4.5);
};
const LEADING_NUMBERED_LINE_RE = /^\s*\d{1,3}[.)]\s*\S/;
const COMMENT_NUMBER_PREFIX_RE = /^\s*\d{1,3}[.)]\s*/;
const normalizeCommentLineForCompare = (value) =>
  normalizeLineBreaks(value)
    .replace(COMMENT_NUMBER_PREFIX_RE, "")
    .replace(/^[/\\\-]+\s*/g, "")
    .replace(/[«»"“”'`]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const isCommentLineDuplicate = (line, pool) => {
  if (!line) return false;
  for (const candidate of pool) {
    if (!candidate) continue;
    if (candidate === line) return true;
    const minLen = Math.min(candidate.length, line.length);
    if (minLen >= 14 && (candidate.includes(line) || line.includes(candidate))) {
      return true;
    }
  }
  return false;
};
const removeDuplicateCommentSegments = (segments = []) => {
  if (!Array.isArray(segments) || segments.length === 0) return segments;
  const sectionPools = new Map();
  const getPool = (segment) => {
    const key = getSectionKeyFromMeta(segment);
    if (!sectionPools.has(key)) sectionPools.set(key, []);
    return sectionPools.get(key);
  };

  segments.forEach((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) === "links") return;
    if (isCommentsSegment(segment)) return;
    const normalized = normalizeCommentLineForCompare(segment?.text_quote ?? "");
    if (!normalized) return;
    getPool(segment).push(normalized);
  });

  const result = [];
  segments.forEach((segment) => {
    if (!isCommentsSegment(segment)) {
      result.push(segment);
      return;
    }
    const lines = normalizeLineBreaks(segment?.text_quote ?? "").split("\n");
    const pool = getPool(segment);
    const seen = new Set();
    const kept = [];
    lines.forEach((line) => {
      const content = String(line ?? "").replace(COMMENT_NUMBER_PREFIX_RE, "").trim();
      const normalized = normalizeCommentLineForCompare(content);
      if (!normalized) return;
      if (seen.has(normalized)) return;
      if (isCommentLineDuplicate(normalized, pool)) return;
      seen.add(normalized);
      kept.push(content);
    });

    if (kept.length === 0) return;
    const normalizedText = kept.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
    result.push({
      ...segment,
      text_quote: normalizedText,
      visual_decision: {
        ...emptyVisualDecision(),
        duration_hint_sec: computeDurationHint(normalizedText)
      },
      search_decision: emptySearchDecision(),
      search_open: false
    });
  });

  return result;
};
const getVisualDefaultsByType = (type, config = defaultConfig) => {
  const key = String(type ?? "").trim().toLowerCase();
  const defaults = VISUAL_TYPE_DEFAULTS[key] ?? VISUAL_TYPE_DEFAULTS.image;
  const formatHint =
    defaults.format_hint && (config?.formatHints ?? defaultConfig.formatHints).includes(defaults.format_hint)
      ? defaults.format_hint
      : null;
  const priority =
    defaults.priority && (config?.priorities ?? defaultConfig.priorities).includes(defaults.priority)
      ? defaults.priority
      : null;
  return { format_hint: formatHint, priority };
};
const splitLeadingCommentList = (text) => {
  const lines = normalizeLineBreaks(text).split("\n");
  const commentLines = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      if (commentLines.length === 0) {
        index += 1;
        continue;
      }
      const next = lines[index + 1];
      if (next && LEADING_NUMBERED_LINE_RE.test(next)) {
        commentLines.push(line);
        index += 1;
        continue;
      }
      break;
    }
    if (!LEADING_NUMBERED_LINE_RE.test(line)) break;
    commentLines.push(line);
    index += 1;
  }
  if (commentLines.length < 1) return null;
  const commentsText = commentLines.join("\n").trim();
  const mainText = lines.slice(index).join("\n").trimStart();
  if (!commentsText) return null;
  return { commentsText, mainText };
};
const buildCommentsSegmentId = (sourceId, usedIds) => {
  const rawBase = String(sourceId ?? "news")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = rawBase || "news";
  let candidate = `comments_${base}`;
  let counter = 1;
  while (usedIds.has(candidate)) {
    candidate = `comments_${base}_${String(counter).padStart(2, "0")}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
};
const splitOutLeadingCommentSegments = (segments = []) => {
  if (!segments.length) return segments;
  const usedIds = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  const result = [];
  segments.forEach((segment) => {
    if (normalizeSegmentBlockType(segment.block_type) === "links") {
      result.push(segment);
      return;
    }
    const split = splitLeadingCommentList(segment.text_quote ?? "");
    if (!split) {
      result.push(segment);
      return;
    }

    const currentVisual = normalizeVisualDecision(segment.visual_decision, defaultConfig);
    const prevDuration = currentVisual.duration_hint_sec;
    const prevAutoDuration = computeDurationHint(segment.text_quote ?? "");
    const shouldAutoUpdateMainDuration =
      prevDuration === null || prevDuration === undefined || prevDuration === prevAutoDuration;

    result.push({
      ...segment,
      segment_id: buildCommentsSegmentId(segment.segment_id, usedIds),
      text_quote: split.commentsText,
      segment_status: "new",
      is_done: false,
      visual_decision: {
        ...emptyVisualDecision(),
        duration_hint_sec: computeDurationHint(split.commentsText)
      },
      search_decision: emptySearchDecision(),
      search_open: false
    });
    if (String(split.mainText ?? "").trim()) {
      result.push({
        ...segment,
        text_quote: split.mainText,
        visual_decision: {
          ...currentVisual,
          duration_hint_sec: shouldAutoUpdateMainDuration ? computeDurationHint(split.mainText) : prevDuration
        }
      });
    }
  });
  return result;
};
const normalizeLineBreaks = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const normalizeTopicTitleForDisplay = (title) => {
  const value = normalizeLineBreaks(title)
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
};
const DEFAULT_MEDIA_TOPIC_NAME = "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";
const sanitizeMediaTopicName = (rawTitle) => {
  const value = String(rawTitle ?? "").trim();
  if (!value) return DEFAULT_MEDIA_TOPIC_NAME;

  const replaced = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const normalized = replaced || DEFAULT_MEDIA_TOPIC_NAME;
  const clipped = normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
  if (!clipped) return DEFAULT_MEDIA_TOPIC_NAME;

  const upper = clipped.toUpperCase();
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9"
  ]);
  return reserved.has(upper) ? `_${clipped}` : clipped;
};
const getMediaFileTopicFolder = (mediaPath) => {
  const normalizedPath = normalizeMediaFilePath(mediaPath);
  if (!normalizedPath) return "";
  const [folder] = normalizedPath.split("/");
  return String(folder ?? "").trim();
};
const normalizeHeadingForFigma = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, "")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const getQuotePreview = (text, limit = 110) => {
  const value = normalizeLineBreaks(text).replace(/\s+/g, " ").trim();
  if (!value) return "\u041f\u0443\u0441\u0442\u0430\u044f \u0446\u0438\u0442\u0430\u0442\u0430";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}...`;
};
const isCommentsSegment = (segment) => /^comments_/i.test(String(segment?.segment_id ?? "").trim());
const normalizeSectionTitleForId = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, " ")
    .replace(/[«»"“”'`]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const normalizeSectionTitleForMerge = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, " ")
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/[«»"“”'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const hashSectionTitle = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const buildSectionId = (title, occurrence = 1) => {
  const normalizedTitle = normalizeSectionTitleForId(title);
  if (!normalizedTitle) return `section_${String(occurrence).padStart(2, "0")}`;
  return `section_${hashSectionTitle(normalizedTitle)}_${String(occurrence).padStart(2, "0")}`;
};
const isLegacySectionId = (value) => /^section_\d+$/i.test(String(value ?? "").trim());
const splitScriptIntoHeadingBlocks = (text) => {
  const normalized = normalizeLineBreaks(text);
  const lines = normalized.split("\n");
  const blocks = [];
  let offset = 0;
  let current = {
    heading: null,
    headingLine: null,
    headingStart: 0,
    contentStart: 0,
    lines: []
  };
  const pushCurrent = (endOffset) => {
    if (!current.heading && current.lines.length === 0) return;
    blocks.push({ ...current, endOffset });
  };
  for (const line of lines) {
    const match = line.match(/#{3,}\s*(.+?)\s*$/);
    if (match) {
      const hashIndex = line.indexOf("#");
      const before = hashIndex > 0 ? line.slice(0, hashIndex).trim() : "";
      if (before) current.lines.push(before);
      pushCurrent(offset + hashIndex);
      current = {
        heading: match[1].trim(),
        headingLine: line,
        headingStart: offset + hashIndex,
        contentStart: offset + line.length + 1,
        lines: []
      };
      offset += line.length + 1;
      continue;
    }
    current.lines.push(line);
    offset += line.length + 1;
  }
  pushCurrent(normalized.length);
  return { normalized, blocks };
};
const isLikelyUrlToken = (value) => {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^www\./i.test(value)) return true;
  return /^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(value);
};
const normalizeLinkUrl = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};
const canonicalizeLinkUrl = (value) => {
  const normalized = normalizeLinkUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.port === "80") url.port = "";
    if (url.protocol === "https:" && url.port === "443") url.port = "";
    return url.toString();
  } catch {
    return normalized;
  }
};
const getReadableLinkLabel = (value, maxLength = 240) => {
  const normalized = normalizeLinkUrl(value);
  if (!normalized) return "";
  const displayUrl = normalized;
  let decoded = displayUrl;
  try {
    decoded = decodeURI(displayUrl);
  } catch {
    decoded = displayUrl;
  }
  if (decoded.length <= maxLength) return decoded;
  return `${decoded.slice(0, maxLength).trimEnd()}...`;
};
const getPreviewImageSrc = (value) => {
  const normalized = normalizeLinkUrl(value);
  if (!normalized) return "";
  return `/api/link/image?url=${encodeURIComponent(normalized)}`;
};
const getUrlHost = (value) => {
  try {
    const url = new URL(normalizeLinkUrl(value));
    return url.host.replace(/^www\./i, "");
  } catch {
    return "";
  }
};
const parseLinkLine = (line) => {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:\d+\.\s*)?(\S+)$/);
  if (!match) return null;
  let token = match[1].replace(/[)\],.]+$/g, "");
  if (!isLikelyUrlToken(token)) return null;
  return { url: normalizeLinkUrl(token), raw: trimmed };
};
const dedupeLinks = (links = []) => {
  const seen = new Set();
  const result = [];
  links.forEach((link) => {
    const url = normalizeLinkUrl(link?.url ?? link ?? "");
    if (!url) return;
    const key = canonicalizeLinkUrl(url);
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ url, raw: link?.raw ?? null });
  });
  return result;
};
const getSectionTitleKey = (section) => normalizeSectionTitleForId(section?.section_title ?? "");
const getSectionKeyFromMeta = (section) => {
  const sectionId = String(section?.section_id ?? "").trim();
  const titleKey = getSectionTitleKey(section);
  if (sectionId && !isLegacySectionId(sectionId)) return `id:${sectionId}`;
  if (titleKey) return `title:${titleKey}`;
  if (sectionId) return `id:${sectionId}`;
  return "untitled";
};
const extractLinksFromScript = (text) => {
  const { blocks } = splitScriptIntoHeadingBlocks(text);
  const linkGroups = new Map();
  const cleanLines = [];
  let sectionIndex = 0;
  const sectionTitleCounts = new Map();
  let currentSection = null;
  for (const block of blocks) {
    if (block.heading) {
      const hasContent = block.lines.some((line) => {
        const trimmed = String(line ?? "").trim();
        if (!trimmed) return false;
        return !parseLinkLine(trimmed);
      });
      if (hasContent) {
        sectionIndex += 1;
        const titleKey = normalizeSectionTitleForId(block.heading);
        const occurrence = (sectionTitleCounts.get(titleKey) ?? 0) + 1;
        sectionTitleCounts.set(titleKey, occurrence);
        currentSection = {
          section_id: buildSectionId(block.heading, occurrence),
          section_title: block.heading,
          section_index: sectionIndex
        };
      } else {
        currentSection = {
          section_id: null,
          section_title: block.heading,
          section_index: null
        };
      }
      cleanLines.push(block.headingLine ?? `### ${block.heading}`);
    }
    for (const line of block.lines) {
      const link = parseLinkLine(line);
      if (link) {
        const key = getSectionKeyFromMeta(currentSection);
        if (!linkGroups.has(key)) {
          linkGroups.set(key, {
            section_id: currentSection?.section_id ?? null,
            section_title: currentSection?.section_title ?? null,
            section_index: currentSection?.section_index ?? null,
            links: []
          });
        }
        linkGroups.get(key).links.push(link);
        cleanLines.push("");
        continue;
      }
      cleanLines.push(line);
    }
  }
  const cleanText = cleanLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  const linkSegments = Array.from(linkGroups.values()).map((group, index) => ({
    segment_id: group.section_id ? `links_${group.section_id}` : `links_${String(index + 1).padStart(2, "0")}`,
    block_type: "links",
    text_quote: "",
    links: dedupeLinks(group.links),
    section_id: group.section_id ?? null,
    section_title: group.section_title ?? null,
    section_index: group.section_index ?? null,
    segment_status: null,
    visual_decision: emptyVisualDecision(),
    search_decision: emptySearchDecision(),
    search_open: false,
  }));
  return { cleanText, linkSegments };
};
const mergeLinkSegmentsBySection = (existing = [], extracted = []) => {
  const map = new Map();
  const order = [];
  const looseTitleToStrictKey = new Map();

  const upsert = (segment, targetKey, mode = "merge") => {
    const key = targetKey || getSectionKeyFromMeta(segment);
    const links = dedupeLinks(segment.links ?? []);
    const current = map.get(key);
    if (!current) {
      map.set(key, { segment: { ...segment }, links });
      order.push(key);
      return;
    }
    const mergedLinks = dedupeLinks([...(current.links ?? []), ...links]);
    const keepCurrentMeta = mode !== "replace_meta";
    map.set(key, {
      segment: keepCurrentMeta
        ? {
            ...current.segment,
            section_id: current.segment.section_id ?? segment.section_id,
            section_title: current.segment.section_title ?? segment.section_title,
            section_index: current.segment.section_index ?? segment.section_index,
            segment_id: current.segment.segment_id || segment.segment_id
          }
        : {
            ...segment,
            section_id: segment.section_id ?? current.segment.section_id,
            section_title: segment.section_title ?? current.segment.section_title,
            section_index: segment.section_index ?? current.segment.section_index
          },
      links: mergedLinks
    });
  };

  extracted.forEach((segment) => {
    const strictKey = getSectionKeyFromMeta(segment);
    upsert(segment, strictKey, "replace_meta");
    const looseTitle = normalizeSectionTitleForMerge(segment.section_title ?? "");
    if (looseTitle && !looseTitleToStrictKey.has(looseTitle)) {
      looseTitleToStrictKey.set(looseTitle, strictKey);
    }
  });

  existing.forEach((segment) => {
    const strictKey = getSectionKeyFromMeta(segment);
    if (map.has(strictKey)) {
      upsert(segment, strictKey, "merge");
      return;
    }
    const looseTitle = normalizeSectionTitleForMerge(segment.section_title ?? "");
    const mappedKey = looseTitle ? looseTitleToStrictKey.get(looseTitle) : "";
    if (mappedKey) {
      upsert(segment, mappedKey, "merge");
      return;
    }
    upsert(segment, strictKey, "merge");
  });

  return order.map((key) => {
    const entry = map.get(key);
    return {
      ...entry.segment,
      links: entry.links ?? []
    };
  });
};
const mergeLinkSegmentsIntoSegments = (segments, linkSegments) => {
  const withoutLinks = segments.filter((segment) => segment.block_type !== "links");
  if (!linkSegments.length) return withoutLinks;
  const result = [...withoutLinks];
  linkSegments.forEach((linkSegment) => {
    const key = getSectionKeyFromMeta(linkSegment);
    const insertAt = result.findIndex(
      (segment) => segment.block_type !== "links" && getSectionKeyFromMeta(segment) === key
    );
    if (insertAt === -1) {
      result.push(linkSegment);
    } else {
      result.splice(insertAt, 0, linkSegment);
    }
  });
  return result;
};
const collapseDuplicateLinkOnlyTopics = (segments = []) => {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const primaryByTitle = new Map();
  segments.forEach((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) === "links") return;
    const titleKey = normalizeSectionTitleForMerge(segment?.section_title ?? "");
    if (!titleKey) return;
    if (!primaryByTitle.has(titleKey)) {
      primaryByTitle.set(titleKey, {
        section_id: segment?.section_id ?? null,
        section_title: segment?.section_title ?? null,
        section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null
      });
      return;
    }
    const current = primaryByTitle.get(titleKey);
    if (!current?.section_id && segment?.section_id) {
      primaryByTitle.set(titleKey, {
        section_id: segment.section_id,
        section_title: segment.section_title ?? current.section_title ?? null,
        section_index: Number.isFinite(Number(segment?.section_index))
          ? Number(segment.section_index)
          : current.section_index
      });
    }
  });

  const reassigned = segments.map((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) !== "links") return segment;
    const titleKey = normalizeSectionTitleForMerge(segment?.section_title ?? "");
    if (!titleKey) return segment;
    const target = primaryByTitle.get(titleKey);
    if (!target) return segment;
    const sectionId = target.section_id ?? segment.section_id ?? null;
    return {
      ...segment,
      segment_id: sectionId ? `links_${sectionId}` : String(segment.segment_id ?? ""),
      section_id: sectionId,
      section_title: target.section_title ?? segment.section_title ?? null,
      section_index: Number.isFinite(Number(target.section_index))
        ? Number(target.section_index)
        : Number.isFinite(Number(segment?.section_index))
          ? Number(segment.section_index)
          : null
    };
  });

  const withoutLinks = reassigned.filter((segment) => normalizeSegmentBlockType(segment?.block_type) !== "links");
  const linkSegments = reassigned.filter((segment) => normalizeSegmentBlockType(segment?.block_type) === "links");
  const mergedLinks = mergeLinkSegmentsBySection([], linkSegments);
  return mergeLinkSegmentsIntoSegments(withoutLinks, mergedLinks);
};
const parseScriptSections = (text, options = {}) => {
  const includeEmpty = Boolean(options?.includeEmpty);
  const sections = [];
  const { normalized, blocks } = splitScriptIntoHeadingBlocks(text);
  const titleOccurrences = new Map();
  for (const block of blocks) {
    if (!block.heading) continue;
    const hasContent = block.lines.some((line) => String(line ?? "").trim());
    if (!hasContent && !includeEmpty) continue;
    const index = sections.length + 1;
    const titleKey = normalizeSectionTitleForId(block.heading);
    const occurrence = (titleOccurrences.get(titleKey) ?? 0) + 1;
    titleOccurrences.set(titleKey, occurrence);
    sections.push({
      id: buildSectionId(block.heading, occurrence),
      title: block.heading,
      index,
      start: block.contentStart,
      end: block.endOffset ?? normalized.length
    });
  }
  return sections;
};
const buildEmptyTopicSegmentId = (section, usedIds) => {
  const fallbackIndex = Number.isFinite(Number(section?.index)) ? Number(section.index) : usedIds.size + 1;
  const rawBase = String(section?.id ?? `topic_${String(fallbackIndex).padStart(2, "0")}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = rawBase || `topic_${String(fallbackIndex).padStart(2, "0")}`;
  let candidate = `${base}_01`;
  let counter = 1;
  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${base}_${String(counter).padStart(2, "0")}`;
  }
  usedIds.add(candidate);
  return candidate;
};
const ensureEmptySectionTopics = (segments = [], scriptText = "") => {
  const sections = parseScriptSections(scriptText, { includeEmpty: true });
  if (!sections.length) return segments;

  const result = [...segments];
  const titleOnlyIndexMap = new Map();
  result.forEach((segment, idx) => {
    if (segment?.section_id) return;
    const titleKey = normalizeSectionTitleForId(segment?.section_title ?? "");
    if (!titleKey) return;
    if (!titleOnlyIndexMap.has(titleKey)) titleOnlyIndexMap.set(titleKey, []);
    titleOnlyIndexMap.get(titleKey).push(idx);
  });

  const usedTitleOnlyIndexes = new Set();
  sections.forEach((section) => {
    const titleKey = normalizeSectionTitleForId(section.title ?? "");
    const candidates = titleOnlyIndexMap.get(titleKey) ?? [];
    const targetIndex = candidates.find((idx) => !usedTitleOnlyIndexes.has(idx));
    if (!Number.isInteger(targetIndex)) return;
    const current = result[targetIndex];
    result[targetIndex] = {
      ...current,
      section_id: section.id,
      section_title: section.title,
      section_index: section.index
    };
    usedTitleOnlyIndexes.add(targetIndex);
  });

  const usedIds = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  const existingSectionKeys = new Set(
    result.map((segment) =>
      getSectionKeyFromMeta({
        section_id: segment.section_id ?? null,
        section_title: segment.section_title ?? null
      })
    )
  );

  sections.forEach((section) => {
    const sectionKey = getSectionKeyFromMeta({
      section_id: section.id,
      section_title: section.title
    });
    if (existingSectionKeys.has(sectionKey)) return;

    const placeholder = {
      segment_id: buildEmptyTopicSegmentId(section, usedIds),
      block_type: "news",
      text_quote: "",
      section_id: section.id,
      section_title: section.title,
      section_index: section.index,
      visual_decision: emptyVisualDecision(),
      search_decision: emptySearchDecision(),
      search_open: false,
      is_done: false,
      segment_status: "new"
    };

    const insertAt = result.findIndex((segment) => {
      const idx = Number(segment?.section_index);
      return Number.isFinite(idx) && idx > section.index;
    });
    if (insertAt === -1) {
      result.push(placeholder);
    } else {
      result.splice(insertAt, 0, placeholder);
    }
    existingSectionKeys.add(sectionKey);
  });

  return result;
};
const assignSectionsByIndex = (segments, sections, options = {}) => {
  if (!sections.length || !segments.length) return segments;
  const override = Boolean(options.override);
  const missingCount = override
    ? segments.filter((segment) => segment.block_type !== "links").length
    : segments.reduce((count, segment) => {
        if (segment.block_type === "links") return count;
        return segment.section_title ? count : count + 1;
      }, 0);
  if (!override && missingCount === 0) return segments;
  let assignedIndex = 0;
  const totalSlots = Math.max(1, missingCount);
  return segments.map((segment) => {
    if (segment.block_type === "links") return segment;
    if (!override && segment.section_title) return segment;
    const ratio = assignedIndex / totalSlots;
    const sectionIndex = Math.min(sections.length - 1, Math.floor(ratio * sections.length));
    const section = sections[sectionIndex];
    assignedIndex += 1;
    return {
      ...segment,
      section_id: section.id,
      section_title: section.title,
      section_index: section.index
    };
  });
};
const applySectionsFromScript = (segments, scriptText) => {
  const sections = parseScriptSections(scriptText);
  if (sections.length === 0) return segments;
  const titleCounts = new Map();
  sections.forEach((section) => {
    const key = section.title.trim();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  });
  const titleIndex = new Map();
  sections.forEach((section) => {
    const key = section.title.trim();
    if (titleCounts.get(key) === 1) {
      titleIndex.set(key, section);
    }
  });
  const normalizedText = normalizeLineBreaks(scriptText);
  let cursor = 0;
  let matchCount = 0;
  const mapped = segments.map((segment) => {
    const titleKey = segment.section_title ? segment.section_title.trim() : "";
    const titleMatch = titleKey ? titleIndex.get(titleKey) : null;
    if (segment.block_type === "links") {
      if (!titleMatch) return segment;
      return {
        ...segment,
        section_id: titleMatch.id,
        section_title: titleMatch.title,
        section_index: titleMatch.index
      };
    }
    if (titleMatch) {
      matchCount += 1;
      return {
        ...segment,
        section_id: titleMatch.id,
        section_title: titleMatch.title,
        section_index: titleMatch.index
      };
    }
    const quote = normalizeLineBreaks(segment.text_quote ?? "");
    let index = -1;
    if (quote) {
      index = normalizedText.indexOf(quote, cursor);
      if (index === -1) index = normalizedText.indexOf(quote);
    }
    if (index !== -1) {
      matchCount += 1;
      cursor = index + quote.length;
    }
    let selected = null;
    if (index !== -1) {
      for (const section of sections) {
        if (index >= section.start && index < section.end) {
          selected = section;
        }
      }
    } else {
      for (const section of sections) {
        if (cursor >= section.start) selected = section;
      }
    }
    if (!selected) return segment;
    return {
      ...segment,
      section_id: selected.id,
      section_title: selected.title,
      section_index: selected.index
    };
  });
  const matchRatio = segments.length ? matchCount / segments.length : 0;
  if (matchRatio < 0.25) {
    return assignSectionsByIndex(mapped, sections, { override: true });
  }
  return assignSectionsByIndex(mapped, sections);
};
const emptySegment = (index, section = {}) => ({
  segment_id: `custom_${String(index).padStart(2, "0")}`,
  block_type: "news",
  text_quote: "",
  section_id: section.section_id ?? null,
  section_title: section.section_title ?? null,
  section_index: section.section_index ?? null,
  visual_decision: emptyVisualDecision(),
  search_decision: emptySearchDecision(),
  search_open: false,
  is_done: false
});
const GROUP_RENDER_CHUNK = 20;
const getSegmentGroupKey = (segment) => getSectionKeyFromMeta(segment);
const getSegmentGroupTitle = (segment) => {
  const title = normalizeTopicTitleForDisplay(segment.section_title ?? "");
  return title || "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";
};
const getSubSegmentBaseId = (segmentId) => {
  const value = String(segmentId ?? "");
  const parts = value.split("_");
  if (parts.length >= 3 && /^\d{2}$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join("_");
  }
  return value;
};
const getNextSubSegmentId = (segments, baseId) => {
  const prefix = `${baseId}_`;
  let max = 0;
  segments.forEach((segment) => {
    const id = String(segment.segment_id ?? "");
    if (!id.startsWith(prefix)) return;
    const suffix = id.slice(prefix.length);
    if (!/^\d{2}$/.test(suffix)) return;
    const value = Number.parseInt(suffix, 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  });
  let next = max + 1;
  let candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  const existing = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  }
  return candidate;
};
const hasVisualDecisionContent = (decision) => {
  if (!decision) return false;
  if (decision.description) return true;
  if (decision.format_hint) return true;
  if (decision.priority) return true;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return true;
  return decision.type && decision.type !== "no_visual";
};
const hasSearchDecisionContent = (decision) => {
  if (!decision) return false;
  if (Array.isArray(decision.keywords) && decision.keywords.length > 0) return true;
  if (Array.isArray(decision.queries) && decision.queries.length > 0) return true;
  return false;
};
const collectScenarioLinks = (segments = []) => {
  const seen = new Set();
  const result = [];
  segments.forEach((segment) => {
    if (segment?.block_type !== "links") return;
    const sectionTitle = getSegmentGroupTitle(segment);
    (segment.links ?? []).forEach((link) => {
      const url = normalizeLinkUrl(link?.url ?? link ?? "");
      const key = canonicalizeLinkUrl(url);
      if (!url || !key || seen.has(key)) return;
      seen.add(key);
      result.push({
        url,
        sectionTitle,
        segmentId: segment.segment_id
      });
    });
  });
  return result;
};
const LinksCard = React.memo(function LinksCard({
  segment,
  index,
  onLinkAdd,
  onLinkUpdate,
  onLinkRemove,
  onDownload,
  isDownloadBusy,
  isDownloadSupported,
  isDownloaded
}) {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState({});
  const [editing, setEditing] = useState({});
  useEffect(() => {
    if (!open) return;
    const links = segment.links ?? [];
    links.forEach((link) => {
      const url = normalizeLinkUrl(link?.url ?? "");
      if (!url) return;
      const key = canonicalizeLinkUrl(url) || url;
      if (previews[key]?.loading || previews[key]?.loaded || previews[key]?.error) return;
      setPreviews((prev) => ({ ...prev, [key]: { loading: true } }));
      fetchJsonSafe(`/api/link/preview?url=${encodeURIComponent(url)}`)
        .then(({ response, data }) => {
          if (!response.ok) throw new Error("preview_failed");
          setPreviews((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              loaded: true,
              title: data?.title ?? "",
              description: data?.description ?? "",
              image: data?.image ?? "",
              siteName: data?.siteName ?? ""
            }
          }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [key]: { loading: false, loaded: true, error: true } }));
        });
    });
  }, [open, segment.links, previews]);
  return (
    <article className="segment-card links-card">
      <div className="segment-head">
        <div>
          <label>{"\u0421\u0441\u044b\u043b\u043a\u0438"}</label>
          <div className="links-meta">
            <span>
              {(segment.links ?? []).length}{" "}{"\u0441\u0441\u044b\u043b\u043e\u043a"}
            </span>
          </div>
        </div>
        <div className="segment-head-actions">
          <button
            className="btn ghost icon-round"
            type="button"
            onClick={() => onLinkAdd(index)}
            title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
            aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
          >
            +
          </button>
          <button
            className="btn ghost icon-round"
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            title={open ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
            aria-label={open ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
          >
            {open ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 15l6-6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
      {open ? (
        <div className="links-list">
          {(segment.links ?? []).length === 0 ? (
            <div className="links-empty">{"\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443."}</div>
          ) : null}
          {(segment.links ?? []).map((link, linkIndex) => {
            const url = normalizeLinkUrl(link?.url ?? "");
            const sectionTitle = getSegmentGroupTitle(segment);
            const previewKey = canonicalizeLinkUrl(url) || url;
            const preview = url ? previews[previewKey] : null;
            const host = getUrlHost(url);
            const linkLabel = getReadableLinkLabel(url);
            const isEditing = Boolean(editing[linkIndex]);
            const alreadyDownloaded =
              typeof isDownloaded === "function" ? isDownloaded(url) : false;
            const canDownload =
              alreadyDownloaded ||
              (typeof isDownloadSupported === "function" ? isDownloadSupported(url) : false);
            const openUrl = () => {
              if (!url) return;
              window.open(url, "_blank", "noopener,noreferrer");
            };
            return (
              <div key={`${url}-${linkIndex}`} className="link-item link-telegram">
                <div className="link-header">
                  <div
                    className="link-url"
                    role="button"
                    tabIndex={0}
                    onClick={openUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openUrl();
                      }
                    }}
                    title={linkLabel || url}
                  >
                    {linkLabel || "-"}
                  </div>
                  <div className="link-actions">
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() =>
                        setEditing((prev) => ({ ...prev, [linkIndex]: !prev[linkIndex] }))
                      }
                      title={isEditing ? "\u0421\u043a\u0440\u044b\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435" : "\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                      aria-label={"\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={openUrl}
                      title={"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      aria-label={"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      disabled={!url}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 14L20 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 14v6H4V4h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    {canDownload ? (
                      alreadyDownloaded ? (
                        <button
                          className="btn small ghost"
                          type="button"
                          disabled
                          title="\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0441\u043a\u0430\u0447\u0430\u043d\u0430"
                          aria-label="\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0441\u043a\u0430\u0447\u0430\u043d\u0430"
                        >
                          {"\u0421\u043a\u0430\u0447\u0430\u043d\u043e"}
                        </button>
                      ) : (
                        <button
                          className="btn small ghost"
                          type="button"
                          onClick={() => onDownload?.(url, sectionTitle)}
                          title="\u0421\u043a\u0430\u0447\u0430\u0442\u044c \u043c\u0435\u0434\u0438\u0430"
                          aria-label="\u0421\u043a\u0430\u0447\u0430\u0442\u044c \u043c\u0435\u0434\u0438\u0430"
                          disabled={!url || (typeof isDownloadBusy === "function" && isDownloadBusy(url))}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M7 11l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        </button>
                      )
                    ) : null}
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() => onLinkRemove(index, linkIndex)}
                      title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="link-row">
                    <input
                      value={link?.url ?? ""}
                      placeholder="https://example.com"
                      onChange={(event) => onLinkUpdate(index, linkIndex, event.target.value)}
                      onBlur={(event) =>
                        onLinkUpdate(index, linkIndex, normalizeLinkUrl(event.target.value))
                      }
                    />
                  </div>
                ) : null}
                {url ? (
                  <div
                    className={`link-preview link-preview-telegram${preview?.image ? " has-image" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={openUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openUrl();
                      }
                    }}
                  >
                    {preview?.loading ? (
                      <span className="muted">{"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043f\u0440\u0435\u0432\u044c\u044e\u2026"}</span>
                    ) : preview?.error ? (
                      <span className="muted">{"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u0435\u0432\u044c\u044e."}</span>
                    ) : preview?.title || preview?.description || preview?.image ? (
                      <>
                        <div className="link-preview-text">
                          <strong>{preview?.title || host || url}</strong>
                          {preview?.description ? <p>{preview.description}</p> : null}
                          <div className="muted">{preview?.siteName || host || url}</div>
                        </div>
                        {preview?.image ? (
                          <div className="link-preview-image">
                            <img
                              src={getPreviewImageSrc(preview.image)}
                              alt={preview.title || "preview"}
                              onError={(event) => {
                                const img = event.currentTarget;
                                if (img.dataset.fallbackApplied === "1") return;
                                img.dataset.fallbackApplied = "1";
                                img.src = preview.image;
                              }}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="link-preview-text">
                        <strong>{host || url}</strong>
                        <div className="muted">{linkLabel || url}</div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
});
const SegmentCard = React.memo(function SegmentCard({
  segment,
  index,
  animationIndex = 0,
  config,
  docId,
  mediaFiles,
  onUpdate,
  onVisualUpdate,
  onSearchUpdate,
  onQuoteChange,
  onInsertAfter,
  onRemove,
  onClearSearch,
  onSearchGenerate,
  searchLoading,
  onSearchToggle,
  onSearch,
  onCopy,
  onDoneToggle
}) {
  const queriesValue = (segment.search_decision?.queries ?? []).join("\n");
  const queryItems = (segment.search_decision?.queries ?? []).filter(
    (query) => String(query ?? "").trim().length > 0
  );
  const [mediaFilter, setMediaFilter] = React.useState("");
  const selectedMediaPath = normalizeMediaFilePath(segment.visual_decision?.media_file_path ?? "");
  const mediaFileUrl = buildMediaFileUrl(docId, selectedMediaPath);
  const showMediaStartTimecode = isVideoMediaPath(selectedMediaPath);
  const mediaStartTimecodeValue = segment.visual_decision.media_start_timecode ?? "";
  const [timecodeDraft, setTimecodeDraft] = React.useState(() =>
    splitTimecodeToParts(mediaStartTimecodeValue, TIMECODE_EDIT_FPS)
  );
  const [focusedTimecodePart, setFocusedTimecodePart] = React.useState(null);
  const timecodeInputRefs = React.useRef([]);
  React.useEffect(() => {
    setTimecodeDraft(splitTimecodeToParts(mediaStartTimecodeValue, TIMECODE_EDIT_FPS));
  }, [mediaStartTimecodeValue, index]);
  const mediaFileList = Array.isArray(mediaFiles) ? mediaFiles : [];
  const mediaTopicFolder = sanitizeMediaTopicName(segment.section_title ?? "");
  const topicMediaFiles = mediaFileList.filter((file) => getMediaFileTopicFolder(file.path) === mediaTopicFolder);
  const mediaFileOptions = topicMediaFiles;
  const hasTopicFiles = mediaFileOptions.length > 0;
  const normalizedMediaFilter = mediaFilter.trim().toLowerCase();
  const filteredMediaFileOptions = React.useMemo(() => {
    if (!normalizedMediaFilter) return mediaFileOptions;
    return mediaFileOptions.filter((file) =>
      `${file.name} ${file.path}`.toLowerCase().includes(normalizedMediaFilter)
    );
  }, [mediaFileOptions, normalizedMediaFilter]);
  const mediaVisibleLimit = 10;
  const visibleMediaFileOptions = filteredMediaFileOptions.slice(0, mediaVisibleLimit);
  const hasMoreMediaFiles = filteredMediaFileOptions.length > mediaVisibleLimit;
  const isDone = Boolean(segment.is_done);
  const isCommentOnlySegment = isCommentsSegment(segment);
  const donePreview = isCommentOnlySegment
    ? (() => {
        const value = normalizeLineBreaks(segment.text_quote).trim();
        if (!value) return "\u041f\u0443\u0441\u0442\u043e";
        return value.length > 220 ? `${value.slice(0, 220).trimEnd()}...` : value;
      })()
    : getQuotePreview(segment.text_quote, 78);
  const updateTimecodePart = React.useCallback((partName, rawValue, partIndex) => {
    const digits = String(rawValue ?? "").replace(/\D/g, "").slice(0, 2);
    const partValue = digits;
    const nextParts = { ...timecodeDraft, [partName]: partValue };
    setTimecodeDraft(nextParts);
    onVisualUpdate(index, { media_start_timecode: partsToTimecode(nextParts, TIMECODE_EDIT_FPS) });
    if (digits.length >= 2 && partIndex < 2) {
      window.setTimeout(() => {
        const nextInput = timecodeInputRefs.current[partIndex + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 0);
    }
  }, [index, onVisualUpdate, timecodeDraft]);
  const handleTimecodePartFocus = React.useCallback((event) => {
    event.currentTarget.select();
  }, []);
  const handleTimecodePartBlur = React.useCallback(() => {
    setFocusedTimecodePart(null);
  }, []);
  const getTimecodeDisplayValue = React.useCallback((partName, partIndex) => {
    const raw = String(timecodeDraft?.[partName] ?? "");
    if (focusedTimecodePart === partIndex) return raw;
    if (!raw) return "00";
    return raw.padStart(2, "0").slice(-2);
  }, [focusedTimecodePart, timecodeDraft]);
  const statusBadge =
    segment.segment_status === "new"
      ? { text: "NEW", className: "badge badge-new" }
      : segment.segment_status === "changed"
        ? { text: "CHANGED", className: "badge badge-changed" }
        : null;
  if (isDone) {
    return (
      <article
        className="segment-card segment-card-done"
        style={{ animationDelay: `${animationIndex * 40}ms` }}
      >
        <div className={`segment-done-row${isCommentOnlySegment ? " segment-done-row-comments" : ""}`}>
          {!isCommentOnlySegment ? (
            <label className="done-toggle-inline" title="\u0421\u043d\u044f\u0442\u044c \u043e\u0442\u043c\u0435\u0442\u043a\u0443">
              <input
                type="checkbox"
                checked={true}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
          ) : null}
          <span className="segment-done-preview">{donePreview}</span>
        </div>
      </article>
    );
  }
  return (
    <article
      className="segment-card"
      style={{ animationDelay: `${animationIndex * 40}ms` }}
    >
      <div className="segment-head">
        <div>
          <label>ID</label>
          <div className="segment-id-row">
            <input
              value={segment.segment_id}
              onChange={(event) => onUpdate(index, { segment_id: event.target.value })}
            />
            {statusBadge ? <span className={statusBadge.className}>{statusBadge.text}</span> : null}
          </div>
        </div>
        {!isCommentOnlySegment ? (
          <div className="segment-head-actions">
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
      <div className="segment-body">
        <label>
          {isCommentOnlySegment
            ? "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438"
            : "\u0426\u0438\u0442\u0430\u0442\u0430"}
        </label>
        <textarea
          value={segment.text_quote}
          onChange={(event) => onQuoteChange(index, event.target.value)}
        />
        {!isCommentOnlySegment ? (
          <>
        <div className="decision-grid">
          <div>
            <label>{"\u0412\u0438\u0437\u0443\u0430\u043b"}</label>
            <select
              value={segment.visual_decision.type}
              onChange={(event) => onVisualUpdate(index, { type: event.target.value })}
            >
              {config.visualTypes.map((type) => (
                <option key={type} value={type}>
                  {VISUAL_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{"\u0424\u043e\u0440\u043c\u0430\u0442"}</label>
            <select
              value={segment.visual_decision.format_hint ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  format_hint: event.target.value ? event.target.value : null
                })
              }
            >
              <option value="">—</option>
              {config.formatHints.map((type) => (
                <option key={type} value={type}>
                  {FORMAT_HINT_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{"\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442"}</label>
            <select
              value={segment.visual_decision.priority ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  priority: event.target.value ? event.target.value : null
                })
              }
            >
              <option value="">—</option>
              {config.priorities.map((type) => (
                <option key={type} value={type}>
                  {PRIORITY_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{"\u0414\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c (\u0441\u0435\u043a)"}</label>
            <input
              type="number"
              value={segment.visual_decision.duration_hint_sec ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  duration_hint_sec: event.target.value ? Number(event.target.value) : null
                })
              }
            />
          </div>
        </div>
        <label>{"\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0432\u0438\u0437\u0443\u0430\u043b\u0430"}</label>
        <textarea
          value={segment.visual_decision.description}
          onChange={(event) => onVisualUpdate(index, { description: event.target.value })}
        />
        <div className="segment-media-picker">
          <label>{"\u0424\u0430\u0439\u043b"}</label>
          <div className="segment-media-picker-row">
            {hasTopicFiles ? (
              <input
                className="segment-media-filter-input"
                type="search"
                value={mediaFilter}
                onChange={(event) => setMediaFilter(event.target.value)}
                placeholder={"\u041f\u043e\u0438\u0441\u043a \u0444\u0430\u0439\u043b\u0430..."}
              />
            ) : null}
            {selectedMediaPath ? (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => onVisualUpdate(index, { media_file_path: null })}
              >
                {"\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c"}
              </button>
            ) : null}
            {mediaFileUrl ? (
              <a className="btn ghost small" href={mediaFileUrl} target="_blank" rel="noopener noreferrer">
                {"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0444\u0430\u0439\u043b"}
              </a>
            ) : null}
          </div>
          {hasTopicFiles ? (
            filteredMediaFileOptions.length > 0 ? (
              <div className="segment-media-options" role="listbox" aria-label="media-files">
                <button
                  type="button"
                  className={`segment-media-option${!selectedMediaPath ? " is-selected" : ""}`}
                  onClick={() => onVisualUpdate(index, { media_file_path: null })}
                >
                  {"\u2014 \u0411\u0435\u0437 \u0444\u0430\u0439\u043b\u0430"}
                </button>
                {visibleMediaFileOptions.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className={`segment-media-option${selectedMediaPath === file.path ? " is-selected" : ""}`}
                    onClick={() => onVisualUpdate(index, { media_file_path: file.path })}
                    title={file.path}
                  >
                    <span className="segment-media-option-name">{file.name}</span>
                    <span className="segment-media-option-size">{formatBytes(file.size)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted segment-media-empty-hint">
                {"\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043f\u043e \u043f\u043e\u0438\u0441\u043a\u0443"}
              </div>
            )
          ) : (
            <div className="muted segment-media-empty-hint">
              {"\u041d\u0435\u0442 \u0444\u0430\u0439\u043b\u043e\u0432 \u0432 \u0442\u0435\u043c\u0435"}
            </div>
          )}
          {hasMoreMediaFiles ? (
            <div className="muted segment-media-empty-hint">
              {`\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e ${mediaVisibleLimit} \u0438\u0437 ${filteredMediaFileOptions.length}. \u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u043f\u043e\u0438\u0441\u043a.`}
            </div>
          ) : null}
          {selectedMediaPath ? <div className="muted segment-media-picked">{selectedMediaPath}</div> : null}
          {showMediaStartTimecode ? (
            <>
              <label>{"\u0422\u0430\u0439\u043c\u043a\u043e\u0434"}</label>
              <div className="timecode-split-input" role="group" aria-label="timecode">
                {["hh", "mm", "ss"].map((partName, partIndex) => (
                  <React.Fragment key={partName}>
                    <input
                      ref={(node) => {
                        timecodeInputRefs.current[partIndex] = node;
                      }}
                      className="timecode-part-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={2}
                      value={getTimecodeDisplayValue(partName, partIndex)}
                      onFocus={(event) => {
                        setFocusedTimecodePart(partIndex);
                        handleTimecodePartFocus(event);
                      }}
                      onBlur={handleTimecodePartBlur}
                      onChange={(event) => updateTimecodePart(partName, event.target.value, partIndex)}
                      aria-label={partName.toUpperCase()}
                    />
                    {partIndex < 2 ? <span className="timecode-separator">:</span> : null}
                  </React.Fragment>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="search-toggle">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchGenerate(index)}
            disabled={searchLoading}
          >
            {searchLoading ? "..." : "\u2728"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchToggle(index)}
            title={
              segment.search_open
                ? "\u0421\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u044b"
                : `\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u044b (${queryItems.length})`
            }
            aria-label={
              segment.search_open
                ? "\u0421\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u044b"
                : `\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u044b (${queryItems.length})`
            }
          >
            {"\u{1F50D}"}
          </button>
        </div>
        {segment.search_open ? (
          <>
            <label>{"\u041f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u044b"}</label>
            <textarea
              value={queriesValue}
              onChange={(event) =>
                onSearchUpdate(index, {
                  queries: normalizeQueryList(event.target.value, config.searchLimits?.maxQueries)
                })
              }
              placeholder={"\u041a\u0430\u0436\u0434\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441 \u0441 \u043d\u043e\u0432\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u0438"}
            />
            {queryItems.length ? (
              <div className="query-list">
                {queryItems.map((query, queryIndex) => (
                  <div key={`${segment.segment_id}-query-${queryIndex}`} className="query-row">
                    <span className="query-text">{query}</span>
                    <div className="query-actions">
                      {(config.searchEngines ?? []).map((engine) => (
                        <button
                          key={`${engine.id}-${queryIndex}`}
                          className="btn ghost small"
                          type="button"
                          onClick={() => onSearch(engine, query)}
                        >
                          {engine.label}
                        </button>
                      ))}
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => onCopy(query)}
                      >
                        {"\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="segment-actions">
              <button className="btn ghost small" onClick={() => onClearSearch(index)}>
                {"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0435"}
              </button>
            </div>
          </>
        ) : null}
          </>
        ) : null}
        {!isCommentOnlySegment ? (
          <div className="segment-tail-actions">
            <label className="done-toggle-inline segment-done-bottom-toggle" title="\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u0433\u043e\u0442\u043e\u0432\u043e">
              <input
                type="checkbox"
                checked={isDone}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});
export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [config, setConfig] = useState(defaultConfig);
  const [scriptText, setScriptText] = useState("");
  const [docId, setDocId] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [notionHasUpdates, setNotionHasUpdates] = useState(false);
  const [segments, setSegments] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);
  const [recentDocId, setRecentDocId] = useState("");
  const [status, setStatus] = useState("");
  const [scenarioPanelOpen, setScenarioPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState({});
  const [searchLoading, setSearchLoading] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupRenderLimits, setGroupRenderLimits] = useState({});
  const [linksPanelOpen, setLinksPanelOpen] = useState(false);
  const [headingSearchOpen, setHeadingSearchOpen] = useState({});
  const [headingEnglishQueries, setHeadingEnglishQueries] = useState({});
  const [headingTranslateLoading, setHeadingTranslateLoading] = useState({});
  const [mediaJobs, setMediaJobs] = useState([]);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [downloadedMediaUrls, setDownloadedMediaUrls] = useState([]);
  const [mediaQueue, setMediaQueue] = useState({});
  const [mediaTools, setMediaTools] = useState(null);
  const [ytDlpVersion, setYtDlpVersion] = useState(null);
  const [ytDlpVersionLoading, setYtDlpVersionLoading] = useState(false);
  const [ytDlpUpdateLoading, setYtDlpUpdateLoading] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [collabSessionEnabled, setCollabSessionEnabled] = useState(getInitialCollaborativeMode);
  const [autoOpenLastDocEnabled, setAutoOpenLastDocEnabled] = useState(getInitialAutoOpenLastDoc);
  const [collabAutoSaving, setCollabAutoSaving] = useState(false);
  const [collabRevision, setCollabRevision] = useState(0);
  const collabSaveTimerRef = React.useRef(null);
  const collabIsApplyingRemoteRef = React.useRef(false);
  const collabLastSavedFingerprintRef = React.useRef("");
  const collabAutoSaveInFlightRef = React.useRef(false);
  const collabPollInFlightRef = React.useRef(false);
  const collabRevisionRef = React.useRef(0);
  const initialDocRestoreDoneRef = React.useRef(false);
  const mediaJobStatusRef = React.useRef(new Map());
  const mediaJobStatusReadyRef = React.useRef(false);
  const uiAuditQueueRef = React.useRef([]);
  const uiAuditTimerRef = React.useRef(null);
  const uiAuditDocIdRef = React.useRef("");
  const uiAuditLastInputRef = React.useRef(new Map());
  useEffect(() => {
    collabRevisionRef.current = collabRevision;
  }, [collabRevision]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem("collabSessionEnabled", collabSessionEnabled ? "1" : "0");
  }, [collabSessionEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem(AUTO_OPEN_LAST_DOC_STORAGE_KEY, autoOpenLastDocEnabled ? "1" : "0");
  }, [autoOpenLastDocEnabled]);
  useEffect(() => {
    fetchJsonSafe("/api/config")
      .then(({ response, data }) => {
        if (!response.ok || !data) return;
        if (data?.blockTypes) {
          setConfig({
            ...defaultConfig,
            ...data,
            visualTypes: data.visualTypes ?? defaultConfig.visualTypes,
            formatHints: data.formatHints ?? defaultConfig.formatHints,
            priorities: data.priorities ?? defaultConfig.priorities,
            searchLimits: { ...defaultConfig.searchLimits, ...(data.searchLimits ?? {}) },
            searchEngines: data.searchEngines ?? defaultConfig.searchEngines
          });
        }
      })
      .catch(() => null);
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("theme", theme);
    }
  }, [theme]);
  const fetchRecentDocuments = React.useCallback(async () => {
    try {
      const { response, data } = await fetchJsonSafe("/api/documents");
      if (!response.ok) return;
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      setRecentDocs(docs.slice(0, 12));
    } catch {
      setRecentDocs([]);
    }
  }, []);
  useEffect(() => {
    fetchRecentDocuments();
  }, [fetchRecentDocuments]);
  useEffect(() => {
    if (typeof window === "undefined" || !docId) return;
    window.localStorage?.setItem(LAST_USED_DOC_STORAGE_KEY, docId);
  }, [docId]);
  useEffect(() => {
    uiAuditDocIdRef.current = docId || "";
  }, [docId]);
  const flushUiAuditQueue = React.useCallback(async ({ keepalive = false } = {}) => {
    if (uiAuditTimerRef.current) {
      clearTimeout(uiAuditTimerRef.current);
      uiAuditTimerRef.current = null;
    }
    const queue = uiAuditQueueRef.current;
    if (!Array.isArray(queue) || queue.length === 0) return;

    const batch = queue.splice(0, UI_AUDIT_BATCH_SIZE);
    const ok = await sendUiAuditActions(batch, { keepalive });
    if (!ok) {
      uiAuditQueueRef.current = [...batch, ...uiAuditQueueRef.current].slice(-UI_AUDIT_MAX_QUEUE);
    }

    if (uiAuditQueueRef.current.length > 0 && !uiAuditTimerRef.current) {
      uiAuditTimerRef.current = setTimeout(() => {
        void flushUiAuditQueue();
      }, UI_AUDIT_FLUSH_MS);
    }
  }, []);
  const enqueueUiAuditAction = React.useCallback(
    (action) => {
      if (!action || typeof action !== "object") return;
      uiAuditQueueRef.current.push(action);
      if (uiAuditQueueRef.current.length > UI_AUDIT_MAX_QUEUE) {
        uiAuditQueueRef.current = uiAuditQueueRef.current.slice(-UI_AUDIT_MAX_QUEUE);
      }
      if (uiAuditQueueRef.current.length >= UI_AUDIT_BATCH_SIZE) {
        void flushUiAuditQueue();
        return;
      }
      if (!uiAuditTimerRef.current) {
        uiAuditTimerRef.current = setTimeout(() => {
          void flushUiAuditQueue();
        }, UI_AUDIT_FLUSH_MS);
      }
    },
    [flushUiAuditQueue]
  );
  useEffect(() => {
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
      if (now - prevAt < UI_AUDIT_INPUT_THROTTLE_MS) return;
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
  }, [enqueueUiAuditAction, flushUiAuditQueue]);
  useEffect(() => {
    setMediaQueue({});
    setDownloadedMediaUrls([]);
    setYtDlpVersion(null);
    setMediaPanelOpen(false);
    mediaJobStatusRef.current = new Map();
    mediaJobStatusReadyRef.current = false;
  }, [docId]);
  const refreshMedia = React.useCallback(async () => {
    if (!docId) {
      setMediaJobs([]);
      setMediaFiles([]);
      setDownloadedMediaUrls([]);
      setMediaTools(null);
      setYtDlpVersion(null);
      return;
    }
    try {
      const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media`);
      if (!response.ok) return;
      setMediaJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setMediaFiles(Array.isArray(data?.files) ? data.files : []);
      setDownloadedMediaUrls(Array.isArray(data?.downloaded_urls) ? data.downloaded_urls : []);
      setMediaTools(data?.tools ?? null);
    } catch {
      setMediaJobs([]);
      setMediaFiles([]);
      setDownloadedMediaUrls([]);
      setYtDlpVersion(null);
    }
  }, [docId]);
  useEffect(() => {
    refreshMedia();
  }, [refreshMedia]);
  useEffect(() => {
    if (!docId) return;
    const hasActive = mediaJobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasActive) return;
    const timer = setInterval(() => {
      refreshMedia();
    }, 2500);
    return () => clearInterval(timer);
  }, [docId, mediaJobs, refreshMedia]);
  useEffect(() => {
    const nextMap = new Map();
    mediaJobs.forEach((job) => {
      nextMap.set(job.id, {
        status: String(job.status ?? ""),
        sectionTitle: String(job.section_title ?? ""),
        error: String(job.error ?? ""),
        outputCount: Array.isArray(job.output_files) ? job.output_files.length : 0
      });
    });

    if (!mediaJobStatusReadyRef.current) {
      mediaJobStatusRef.current = nextMap;
      mediaJobStatusReadyRef.current = true;
      return;
    }

    let statusMessage = "";
    for (const job of mediaJobs) {
      const prev = mediaJobStatusRef.current.get(job.id);
      if (!prev) continue;
      if (prev.status === job.status) continue;

      const cleanedTitle = normalizeTopicTitleForDisplay(job.section_title ?? "");
      const title = cleanedTitle || (job.section_title ? String(job.section_title) : job.id);
      if (job.status === "completed") {
        const outputCount = Array.isArray(job.output_files) ? job.output_files.length : 0;
        statusMessage = `Media completed: ${title}${outputCount > 0 ? ` (${outputCount})` : ""}`;
      } else if (job.status === "failed") {
        statusMessage = `Media failed: ${title}${job.error ? ` - ${job.error}` : ""}`;
      } else if (job.status === "canceled") {
        statusMessage = `Media canceled: ${title}`;
      }

      if (statusMessage) break;
    }

    mediaJobStatusRef.current = nextMap;
    if (statusMessage) {
      setStatus(statusMessage);
    }
  }, [mediaJobs]);
  const handleCheckYtDlpVersion = React.useCallback(
    async ({ silent = false } = {}) => {
      if (ytDlpVersionLoading) return;
      setYtDlpVersionLoading(true);
      try {
        const { response, data } = await fetchJsonSafe("/api/downloader/yt-dlp/version");
        if (!response.ok) throw new Error(data?.error ?? "Version check failed");
        const version = typeof data?.version === "string" ? data.version : null;
        const normalizedVersion = version || "unknown";
        setYtDlpVersion(normalizedVersion);
        if (!silent) {
          if (data?.available) {
            setStatus(`yt-dlp version: ${normalizedVersion}`);
          } else {
            setStatus("yt-dlp unavailable");
          }
        }
      } catch (error) {
        if (!silent) {
          setStatus(error.message);
        }
      } finally {
        setYtDlpVersionLoading(false);
      }
    },
    [ytDlpVersionLoading]
  );
  const handleUpdateYtDlp = React.useCallback(async () => {
    if (ytDlpUpdateLoading) return;
    setYtDlpUpdateLoading(true);
    try {
      const { response, data } = await fetchJsonSafe("/api/downloader/yt-dlp:update", {
        method: "POST"
      });
      if (!response.ok) throw new Error(data?.error ?? "yt-dlp update failed");
      const nextVersion =
        (typeof data?.after === "string" && data.after) ||
        (typeof data?.before === "string" && data.before) ||
        ytDlpVersion ||
        "unknown";
      setYtDlpVersion(nextVersion);
      await refreshMedia();
      if (data?.changed) {
        setStatus(`yt-dlp updated: ${data?.before ?? "unknown"} -> ${data?.after ?? "unknown"}`);
      } else if (data?.up_to_date) {
        setStatus(`yt-dlp already up to date: ${data?.after ?? data?.before ?? "unknown"}`);
      } else {
        setStatus(`yt-dlp update completed: ${data?.after ?? data?.before ?? "unknown"}`);
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setYtDlpUpdateLoading(false);
    }
  }, [refreshMedia, ytDlpUpdateLoading, ytDlpVersion]);
  useEffect(() => {
    if (!mediaPanelOpen) return;
    if (!mediaTools?.available) return;
    if (ytDlpVersion || ytDlpVersionLoading || ytDlpUpdateLoading) return;
    handleCheckYtDlpVersion({ silent: true });
  }, [handleCheckYtDlpVersion, mediaPanelOpen, mediaTools, ytDlpUpdateLoading, ytDlpVersion, ytDlpVersionLoading]);
  const segmentsCount = segments.filter((segment) => segment.block_type !== "links").length;
  const activeMediaJobsCount = React.useMemo(
    () => mediaJobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [mediaJobs]
  );
  const downloadedMediaSet = React.useMemo(() => {
    const set = new Set();
    downloadedMediaUrls.forEach((url) => {
      const key = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (key) set.add(key);
    });
    return set;
  }, [downloadedMediaUrls]);
  const isMediaDownloaded = React.useCallback(
    (url) => {
      const key = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (!key) return false;
      return downloadedMediaSet.has(key);
    },
    [downloadedMediaSet]
  );
  const groupedSegments = React.useMemo(() => {
    const map = new Map();
    segments.forEach((segment, index) => {
      const key = getSegmentGroupKey(segment);
      const title = getSegmentGroupTitle(segment);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title,
          items: [],
          linkSegment: null,
          section_id: segment.section_id ?? null,
          section_title: segment.section_title ?? null,
          section_index: segment.section_index ?? null
        });
      }
      const group = map.get(key);
      if (normalizeSegmentBlockType(segment.block_type) === "links") {
        group.linkSegment = { segment, index };
        return;
      }
      group.items.push({ segment, index });
    });
    return Array.from(map.values());
  }, [segments]);
  const allScenarioLinks = React.useMemo(() => collectScenarioLinks(segments), [segments]);
  const headingRuEngines = React.useMemo(
    () => (config.searchEngines ?? []).filter((engine) => HEADING_SEARCH_RU_ENGINE_IDS.has(engine.id)),
    [config.searchEngines]
  );
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = false;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments]);
  useEffect(() => {
    setGroupRenderLimits((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = GROUP_RENDER_CHUNK;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments]);
  useEffect(() => {
    setHeadingSearchOpen((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = false;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setHeadingEnglishQueries((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = group.title === "Без темы" ? "" : group.title;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments]);
  const canGenerate = Boolean(String(scriptText).trim()) && !loading;
  const canSaveBase = Boolean(docId) && segmentsCount > 0 && !loading;
  const buildSessionPayload = React.useCallback(
    () =>
      buildSessionPayloadFromState({
        scriptText,
        notionUrl,
        segments
      }),
    [notionUrl, scriptText, segments]
  );
  const hasUnsavedChanges = React.useMemo(() => {
    if (!docId) return false;
    const fingerprint = getSessionFingerprint(buildSessionPayload());
    return fingerprint !== collabLastSavedFingerprintRef.current;
  }, [buildSessionPayload, docId, collabRevision, collabAutoSaving, loading, status]);
  const canSave = canSaveBase && hasUnsavedChanges;
  const canLoadNotion = Boolean(notionUrl.trim()) && !loading;
  const canRefreshNotion = canLoadNotion;
  const rememberSessionSnapshot = React.useCallback((snapshot, revision = 0) => {
    collabLastSavedFingerprintRef.current = getSessionFingerprint(snapshot);
    const normalizedRevision = Number(revision);
    if (Number.isFinite(normalizedRevision) && normalizedRevision > 0) {
      collabRevisionRef.current = normalizedRevision;
      setCollabRevision(normalizedRevision);
      return;
    }
    collabRevisionRef.current = 0;
    setCollabRevision(0);
  }, []);
  const applyLoadedSnapshot = React.useCallback(
    (targetId, data) => {
      const rawText = data?.document?.raw_text ?? "";
      const loadedNotion = data?.document?.notion_url ?? "";
      const merged = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        rawText
      );
      const normalizedComments = removeDuplicateCommentSegments(merged);
      const mergedWithTopics = ensureEmptySectionTopics(normalizedComments, rawText);
      const linksFromMerged = mergedWithTopics.filter((item) => item.block_type === "links");
      const ordered = collapseDuplicateLinkOnlyTopics(
        mergeLinkSegmentsIntoSegments(mergedWithTopics, linksFromMerged)
      );

      collabIsApplyingRemoteRef.current = true;
      const snapshot = buildSessionPayloadFromState({
        scriptText: rawText,
        notionUrl: loadedNotion,
        segments: ordered
      });
      rememberSessionSnapshot(snapshot, data?.revision);

      setDocId(targetId);
      setScriptText(rawText);
      setNotionUrl(loadedNotion);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
      setSegments(ordered);
      setRecentDocId(targetId);
      setTimeout(() => {
        collabIsApplyingRemoteRef.current = false;
      }, 0);
    },
    [config, rememberSessionSnapshot]
  );
  const saveSessionSnapshot = React.useCallback(
    async (snapshot, source = "manual") => {
      if (!docId) throw new Error("Документ не выбран.");
      const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/session`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...snapshot, source })
      });
      if (!response.ok) throw new Error(data?.error ?? "Session save error");
      rememberSessionSnapshot(snapshot, data?.revision);
      return data;
    },
    [docId, rememberSessionSnapshot]
  );
  const upsertDocumentForText = React.useCallback(
    async (rawTextValue, notionUrlValue = "") => {
      const rawText = String(rawTextValue ?? "").trim();
      if (!rawText) {
        throw new Error("\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u0435\u043a\u0441\u0442 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f.");
      }
      const payload = {
        raw_text: rawText,
        notion_url: String(notionUrlValue ?? "").trim() || null
      };
      const { response, data } = await fetchJsonSafe("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430");
      }
      const targetId = String(data?.id ?? "").trim();
      if (!targetId) {
        throw new Error("Server returned empty document id");
      }
      setDocId(targetId);
      setRecentDocId(targetId);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
      if (targetId !== docId) {
        fetchRecentDocuments();
      }
      try {
        const loaded = await fetchJsonSafe(`/api/documents/${targetId}`);
        if (loaded.response.ok && loaded.data) {
          applyLoadedSnapshot(targetId, loaded.data);
        } else {
          rememberSessionSnapshot(
            buildSessionPayloadFromState({
              scriptText: rawText,
              notionUrl: payload.notion_url ?? "",
              segments: []
            }),
            0
          );
        }
      } catch {
        rememberSessionSnapshot(
          buildSessionPayloadFromState({
            scriptText: rawText,
            notionUrl: payload.notion_url ?? "",
            segments: []
          }),
          0
        );
      }
      return { id: targetId, reused: Boolean(data?.reused), document: data?.document ?? null };
    },
    [applyLoadedSnapshot, docId, fetchRecentDocuments, rememberSessionSnapshot]
  );
  const handleStartNewScenario = React.useCallback(() => {
    const hasDraftContent =
      Boolean(String(scriptText ?? "").trim()) ||
      Boolean(String(notionUrl ?? "").trim()) ||
      (Array.isArray(segments) && segments.length > 0);
    const shouldConfirmReset = Boolean(hasUnsavedChanges || hasDraftContent);
    if (shouldConfirmReset && typeof window !== "undefined") {
      const ok = window.confirm("Есть несохраненные изменения. Сбросить и начать новый сценарий?");
      if (!ok) return;
    }
    initialDocRestoreDoneRef.current = true;
    setDocId("");
    setRecentDocId("");
    setScriptText("");
    setNotionUrl("");
    setNotionHasUpdates(false);
    setSegments([]);
    setLinksPanelOpen(false);
    setMediaPanelOpen(false);
    setHeadingSearchOpen({});
    setHeadingEnglishQueries({});
    setStatus("\u041d\u043e\u0432\u044b\u0439 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439: \u0432\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0442\u0435\u043a\u0441\u0442, \u043f\u0440\u0438 \u043d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e\u0441\u0442\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 Notion \u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u0421\u0435\u0433\u043c\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c.");
    rememberSessionSnapshot(
      buildSessionPayloadFromState({
        scriptText: "",
        notionUrl: "",
        segments: []
      }),
      0
    );
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(LAST_USED_DOC_STORAGE_KEY);
    }
  }, [hasUnsavedChanges, notionUrl, rememberSessionSnapshot, scriptText, segments]);
  const fetchNotionContent = async (statusLabel) => {
    const url = notionUrl.trim();
    if (!url) {
      setStatus("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Notion.");
      return;
    }
    setLoading(true);
    setStatus(statusLabel);
    const progressId = `notion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let progressStopped = false;
    let lastProgressMessage = "";
    const pollProgress = async () => {
      if (progressStopped) return;
      try {
        const { response, data } = await fetchJsonSafe(`/api/notion/progress/${progressId}`);
        if (!response.ok) return;
        const nextMessage = String(data?.last_message ?? "").trim();
        if (nextMessage && nextMessage !== lastProgressMessage) {
          lastProgressMessage = nextMessage;
          setStatus(nextMessage);
        }
      } catch {
        return;
      }
    };
    const progressTimer = setInterval(() => {
      pollProgress();
    }, 700);
    void pollProgress();
    try {
      const previousText = scriptText;
      const { response, data } = await fetchJsonSafe("/api/notion/raw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, progress_id: progressId })
      });
      if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 Notion");
      const normalizedUrl = data?.url ?? url;
      if (normalizedUrl) {
        setNotionUrl(normalizedUrl);
      }
      const content = typeof data?.content === "string" ? data.content : "";
      const hasChanges = content !== previousText;
      setScriptText(content);

      if (content.trim()) {
        const upserted = await upsertDocumentForText(content, normalizedUrl);
        if (upserted?.document) {
          setNotionHasUpdates(getNeedsSegmentationFromDocument(upserted.document));
        } else if (hasChanges) {
          setNotionHasUpdates(true);
        }
      } else if (hasChanges) {
        setNotionHasUpdates(true);
      }

      if (hasChanges) {
        setStatus(content.trim() ? "Notion \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u044b." : "Notion \u0432\u0435\u0440\u043d\u0443\u043b \u043f\u0443\u0441\u0442\u043e\u0439 \u0442\u0435\u043a\u0441\u0442.");
      } else {
        setStatus("Notion \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439.");
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      progressStopped = true;
      clearInterval(progressTimer);
      setLoading(false);
    }
  };
  const handleLoadNotion = async () => {
    await fetchNotionContent("Загрузка Notion...");
  };
  const handleRefreshNotion = async () => {
    await fetchNotionContent("Обновление Notion...");
  };
  const loadDocumentById = React.useCallback(
    async (targetId, options = {}) => {
      const trimmed = String(targetId ?? "").trim();
      if (!trimmed) return false;
      const silent = Boolean(options?.silent);
      if (!silent) {
        setLoading(true);
        setStatus("\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430...");
      }
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${trimmed}`);
        if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430");
        applyLoadedSnapshot(trimmed, data);
        if (silent) {
          setStatus(`Collaborative session updated: ${trimmed}`);
        } else {
          setStatus(`\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d: ${trimmed}`);
        }
        return true;
      } catch (error) {
        setStatus(error.message);
        return false;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [applyLoadedSnapshot]
  );
  const handleRecentSelect = async (event) => {
    const selected = event.target.value;
    setRecentDocId(selected);
    if (!selected) return;
    await loadDocumentById(selected);
  };
  useEffect(() => {
    if (initialDocRestoreDoneRef.current) return;
    if (!autoOpenLastDocEnabled) return;
    if (recentDocs.length === 0) return;
    const hasDraft =
      Boolean(docId) ||
      Boolean(String(scriptText).trim()) ||
      Boolean(String(notionUrl).trim()) ||
      segments.length > 0;
    if (hasDraft) {
      initialDocRestoreDoneRef.current = true;
      return;
    }

    const storedDocId =
      typeof window !== "undefined" ? window.localStorage?.getItem(LAST_USED_DOC_STORAGE_KEY) : "";
    const hasStored = storedDocId && recentDocs.some((item) => item.id === storedDocId);
    const targetDocId = hasStored ? storedDocId : recentDocs[0]?.id;
    if (!targetDocId) return;

    initialDocRestoreDoneRef.current = true;
    setRecentDocId(targetDocId);
    void loadDocumentById(targetDocId);
  }, [autoOpenLastDocEnabled, docId, loadDocumentById, notionUrl, recentDocs, scriptText, segments.length]);
  useEffect(() => {
    if (collabSaveTimerRef.current) {
      clearTimeout(collabSaveTimerRef.current);
      collabSaveTimerRef.current = null;
    }
    if (!docId) {
      setCollabAutoSaving(false);
      return;
    }
    if (collabIsApplyingRemoteRef.current) return;

    const snapshot = buildSessionPayload();
    const fingerprint = getSessionFingerprint(snapshot);
    if (fingerprint === collabLastSavedFingerprintRef.current) return;

    collabSaveTimerRef.current = setTimeout(async () => {
      collabSaveTimerRef.current = null;
      if (collabAutoSaveInFlightRef.current) return;
      collabAutoSaveInFlightRef.current = true;
      setCollabAutoSaving(true);
      try {
        await saveSessionSnapshot(snapshot, "auto");
      } catch (error) {
        setStatus(error.message);
      } finally {
        collabAutoSaveInFlightRef.current = false;
        setCollabAutoSaving(false);
      }
    }, COLLAB_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (collabSaveTimerRef.current) {
        clearTimeout(collabSaveTimerRef.current);
        collabSaveTimerRef.current = null;
      }
    };
  }, [buildSessionPayload, docId, saveSessionSnapshot]);
  useEffect(() => {
    if (!COLLAB_REMOTE_POLL_ENABLED || !collabSessionEnabled || !docId) return;
    let stopped = false;

    const pollState = async () => {
      if (stopped || collabPollInFlightRef.current || collabAutoSaveInFlightRef.current) return;
      collabPollInFlightRef.current = true;
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/state`);
        if (!response.ok) return;
        const remoteRevision = Number(data?.revision ?? 0);
        if (!Number.isFinite(remoteRevision) || remoteRevision <= collabRevisionRef.current) return;

        const localFingerprint = getSessionFingerprint(buildSessionPayload());
        const isDirty = localFingerprint !== collabLastSavedFingerprintRef.current;
        if (isDirty) return;

        await loadDocumentById(docId, { silent: true });
      } catch {
        return;
      } finally {
        collabPollInFlightRef.current = false;
      }
    };

    const timer = setInterval(() => {
      pollState();
    }, COLLAB_POLL_INTERVAL_MS);
    pollState();

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [buildSessionPayload, collabSessionEnabled, docId, loadDocumentById]);
  const handleGenerate = async () => {
    setLoading(true);
    setStatus("\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u043e\u0432...");
    try {
      const { cleanText, linkSegments: extractedLinks } = extractLinksFromScript(scriptText);
      const existingLinks = segments.filter((segment) => segment.block_type === "links");
      const mergedLinks = mergeLinkSegmentsBySection(existingLinks, extractedLinks);
      if (cleanText !== scriptText) {
        setScriptText(cleanText);
      }
      if (!cleanText.trim()) {
        setStatus("\u041d\u0435\u0442 \u0442\u0435\u043a\u0441\u0442\u0430 \u0434\u043b\u044f \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u0438 \u043f\u043e\u0441\u043b\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a.");
        return;
      }

      let targetDocId = docId;
      if (!targetDocId || notionUrl.trim()) {
        const upserted = await upsertDocumentForText(cleanText, notionUrl);
        targetDocId = upserted.id;
      }

      const { response, data } = await fetchJsonSafe(`/api/documents/${targetDocId}/segments:generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: cleanText, link_segments: mergedLinks })
      });
      if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438");

      const mergedBase = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        cleanText
      );
      const mergedWithComments = splitOutLeadingCommentSegments(mergedBase);
      const normalizedComments = removeDuplicateCommentSegments(mergedWithComments);
      const merged = ensureEmptySectionTopics(normalizedComments, cleanText);
      const linksFromMerged = merged.filter((segment) => segment.block_type === "links");
      const orderedSegments = collapseDuplicateLinkOnlyTopics(
        mergeLinkSegmentsIntoSegments(merged, linksFromMerged)
      );
      setSegments(orderedSegments);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));

      const visualCount = merged.filter((segment) => hasVisualDecisionContent(segment.visual_decision)).length;
      const searchCount = merged.filter((segment) => hasSearchDecisionContent(segment.search_decision)).length;
      const diff = data?.segmentation_diff ?? null;
      if (diff && typeof diff === "object") {
        const added = Number(diff.added ?? 0);
        const changed = Number(diff.changed ?? 0);
        const same = Number(diff.same ?? 0);
        const removed = Number(diff.removed ?? 0);
        const preservedManual = Number(diff.preserved_manual ?? 0);
        const collapsedLinks = Number(diff.link_topics_collapsed ?? 0);
        setStatus(
          `Сегменты готовы: ${merged.length}. NEW +${added}, ~${changed}, =${same}, -${removed}. ` +
            `Ручные сохранены: ${preservedManual}. Схлопнуто дублей ссылок: ${collapsedLinks}. ` +
            `Визуал: ${visualCount}. Поиск: ${searchCount}.`
        );
      } else if (visualCount === 0 && searchCount === 0) {
        setStatus(`\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u044b \u0433\u043e\u0442\u043e\u0432\u044b: ${merged.length}. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 AI Help \u0443 \u043d\u0443\u0436\u043d\u043e\u0439 \u0442\u0435\u043c\u044b, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0432\u0438\u0437\u0443\u0430\u043b \u0438 \u043f\u043e\u0438\u0441\u043a.`);
      } else {
        setStatus(`\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u044b \u0433\u043e\u0442\u043e\u0432\u044b: ${merged.length}. \u0412\u0438\u0437\u0443\u0430\u043b: ${visualCount}. \u041f\u043e\u0438\u0441\u043a: ${searchCount}.`);
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleSave = async () => {
    if (!docId) return;
    setLoading(true);
    setStatus("Сохранение...");
    try {
      await saveSessionSnapshot(buildSessionPayload(), "manual");
      setStatus("Сохранено.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleExport = async (format, options = {}) => {
    if (!docId) {
      setStatus("Сначала создайте или загрузите документ.");
      return;
    }
    try {
      setStatus(`Экспорт ${format.toUpperCase()}...`);
      const params = new URLSearchParams();
      params.set("format", String(format ?? "").toLowerCase());
      if (options?.scope) params.set("scope", String(options.scope));
      if (options?.section_id) params.set("section_id", String(options.section_id));
      if (options?.section_title) params.set("section_title", String(options.section_title));
      const response = await fetch(`/api/documents/${docId}/export?${params.toString()}`);
      if (!response.ok) {
        const rawText = await response.text().catch(() => "");
        let data = null;
        if (shouldLookLikeJson(rawText)) {
          try {
            data = JSON.parse(rawText);
          } catch {
            data = null;
          }
        }
        throw new Error(data?.error ?? `Ошибка экспорта ${format.toUpperCase()}`);
      }
      const blob = await response.blob();
      const ext = format === "jsonl" ? "jsonl" : format === "xml" ? "xml" : "md";
      const fileNameFromHeader = getFileNameFromDisposition(response.headers.get("content-disposition"));
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromHeader || `${docId}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus(`Экспорт готов: ${link.download}`);
    } catch (error) {
      setStatus(error.message);
    }
  };
  const handleAddSegment = () => {
    setSegments((prev) => {
      const last = [...prev].reverse().find((segment) => segment.block_type !== "links");
      const section = last
        ? {
            section_id: last.section_id ?? null,
            section_title: last.section_title ?? null,
            section_index: last.section_index ?? null
          }
        : {};
      return [...prev, emptySegment(prev.length + 1, section)];
    });
  };
  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
    setGroupRenderLimits((prev) => {
      if (prev[groupId]) return prev;
      return { ...prev, [groupId]: GROUP_RENDER_CHUNK };
    });
  };
  const handleShowMore = React.useCallback((groupId) => {
    setGroupRenderLimits((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? GROUP_RENDER_CHUNK) + GROUP_RENDER_CHUNK
    }));
  }, []);
  const translateHeadingQuery = React.useCallback(
    async (groupId, sourceText, options = {}) => {
      const ruQuery = String(sourceText ?? "").trim();
      if (!ruQuery) return;
      const force = Boolean(options?.force);
      const currentEn = String(headingEnglishQueries[groupId] ?? "").trim();
      if (!force && currentEn && currentEn !== ruQuery) return;
      if (headingTranslateLoading[groupId]) return;

      setHeadingTranslateLoading((prev) => ({ ...prev, [groupId]: true }));
      try {
        const { response, data } = await fetchJsonSafe("/api/search/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: ruQuery })
        });
        if (!response.ok) throw new Error(data?.error ?? "Ошибка перевода EN query");
        const translated = String(data?.text ?? "").trim();
        if (!translated) return;
        setHeadingEnglishQueries((prev) => ({ ...prev, [groupId]: translated }));
      } catch (error) {
        setStatus(error.message);
      } finally {
        setHeadingTranslateLoading((prev) => {
          const next = { ...prev };
          delete next[groupId];
          return next;
        });
      }
    },
    [headingEnglishQueries, headingTranslateLoading]
  );
  const toggleHeadingSearch = React.useCallback(
    (groupId, ruQuery, enQuery) => {
      setHeadingSearchOpen((prev) => {
        const nextOpen = !prev[groupId];
        if (nextOpen) {
          const ru = String(ruQuery ?? "").trim();
          const en = String(enQuery ?? "").trim();
          if (ru && (!en || en === ru)) {
            void translateHeadingQuery(groupId, ru);
          }
        }
        return { ...prev, [groupId]: nextOpen };
      });
    },
    [translateHeadingQuery]
  );
  const handleHeadingEnglishQueryChange = React.useCallback((groupId, value) => {
    setHeadingEnglishQueries((prev) => ({ ...prev, [groupId]: value }));
  }, []);
  const handleRemoveSegment = React.useCallback((index) => {
    setSegments((prev) => prev.filter((_, idx) => idx !== index));
  }, []);
  const handleToggleSegmentDone = React.useCallback((index, isDone) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, is_done: Boolean(isDone) } : segment
      )
    );
  }, []);
  const handleToggleGroupDone = React.useCallback((groupId, isDone) => {
    setSegments((prev) =>
      prev.map((segment) => {
        if (normalizeSegmentBlockType(segment.block_type) === "links") return segment;
        if (getSegmentGroupKey(segment) !== groupId) return segment;
        return { ...segment, is_done: Boolean(isDone) };
      })
    );
  }, []);
  const handleMarkAllDone = React.useCallback(() => {
    setSegments((prev) =>
      prev.map((segment) =>
        normalizeSegmentBlockType(segment.block_type) === "links"
          ? segment
          : { ...segment, is_done: true }
      )
    );
    setStatus("Все сегменты отмечены как сделано.");
  }, []);
  const handleAddLinksBlock = React.useCallback((group) => {
    setSegments((prev) => {
      const exists = prev.some(
        (segment) => segment.block_type === "links" && getSegmentGroupKey(segment) === group.id
      );
      if (exists) return prev;
      const isUntitled = group.id === "untitled";
      const linkSegment = {
        segment_id: group.section_id ? `links_${group.section_id}` : `links_${Date.now()}`,
        block_type: "links",
        text_quote: "",
        links: [],
        section_id: group.section_id ?? null,
        section_title: isUntitled ? null : group.section_title ?? group.title ?? null,
        section_index: group.section_index ?? null,
        segment_status: null,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision(),
        search_open: false,
        is_done: false,
      };
      return [...prev, linkSegment];
    });
  }, []);
  const handleLinkAdd = React.useCallback((segmentIndex) => {
    setSegments((prev) =>
      prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? [...segment.links] : [];
        links.push({ url: "", raw: null });
        return { ...segment, links };
      })
    );
  }, []);
  const handleLinkUpdate = React.useCallback((segmentIndex, linkIndex, value) => {
    setSegments((prev) =>
      prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? [...segment.links] : [];
        if (!links[linkIndex]) links[linkIndex] = { url: "", raw: null };
        links[linkIndex] = { ...links[linkIndex], url: value };
        return { ...segment, links };
      })
    );
  }, []);
  const handleLinkRemove = React.useCallback((segmentIndex, linkIndex) => {
    setSegments((prev) =>
      prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? segment.links.filter((_, i) => i !== linkIndex) : [];
        return { ...segment, links };
      })
    );
  }, []);
  const handleInsertAfter = React.useCallback((index) => {
    setSegments((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const source = prev[index];
      const baseId = getSubSegmentBaseId(source.segment_id);
      const newId = getNextSubSegmentId(prev, baseId);
      const sourceVisual = source?.visual_decision ?? emptyVisualDecision();
      const sourceSearch = source?.search_decision ?? emptySearchDecision();
      const newSegment = {
        ...source,
        segment_id: newId,
        block_type: normalizeSegmentBlockType(source?.block_type),
        text_quote: "",
        section_id: source.section_id ?? null,
        section_title: source.section_title ?? null,
        section_index: source.section_index ?? null,
        links: Array.isArray(source?.links) ? dedupeLinks(source.links) : [],
        visual_decision: {
          ...sourceVisual
        },
        search_decision: {
          ...sourceSearch,
          keywords: Array.isArray(sourceSearch?.keywords) ? [...sourceSearch.keywords] : [],
          queries: Array.isArray(sourceSearch?.queries) ? [...sourceSearch.queries] : []
        },
        search_open: Boolean(source?.search_open),
        is_done: Boolean(source?.is_done),
        segment_status: null,
        version: 1
      };
      const next = [...prev];
      next.splice(index + 1, 0, newSegment);
      return next;
    });
  }, []);
  const updateSegment = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, ...(updates ?? {}) } : segment
      )
    );
  }, []);
  const updateVisual = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? (() => {
              const nextVisual = { ...segment.visual_decision, ...(updates ?? {}) };
              if (updates && Object.prototype.hasOwnProperty.call(updates, "type")) {
                const nextType = String(updates.type ?? "").trim().toLowerCase();
                const defaults = getVisualDefaultsByType(nextType, config);
                if (nextType === "no_visual") {
                  return {
                    ...segment,
                    visual_decision: {
                      ...nextVisual,
                      ...defaults,
                      description: "",
                      media_file_path: null,
                      media_start_timecode: null
                    }
                  };
                }
                return {
                  ...segment,
                  visual_decision: {
                    ...nextVisual,
                    ...defaults
                  }
                };
              }
              if (updates && Object.prototype.hasOwnProperty.call(updates, "media_file_path")) {
                const nextPath = normalizeMediaFilePath(updates.media_file_path ?? null);
                if (!isVideoMediaPath(nextPath)) {
                  nextVisual.media_start_timecode = null;
                }
              }
              return { ...segment, visual_decision: nextVisual };
            })()
          : segment
      )
    );
  }, [config]);
  const updateSearch = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, search_decision: { ...segment.search_decision, ...updates } }
          : segment
      )
    );
  }, []);
  const handleSearchToggle = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_open: !segment.search_open } : segment
      )
    );
  }, []);
  const handleClearSearch = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_decision: emptySearchDecision() } : segment
      )
    );
  }, []);
  const handleQuoteChange = React.useCallback((index, value) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? {
              ...segment,
              text_quote: value,
              visual_decision: {
                ...segment.visual_decision,
                duration_hint_sec: (() => {
                  const currentDuration = segment.visual_decision?.duration_hint_sec;
                  const previousAutoDuration = computeDurationHint(segment.text_quote);
                  const shouldAutoUpdate =
                    currentDuration === null ||
                    currentDuration === undefined ||
                    currentDuration === previousAutoDuration;
                  return shouldAutoUpdate ? computeDurationHint(value) : currentDuration;
                })()
              }
            }
          : segment
      )
    );
  }, []);
  const copyToClipboard = React.useCallback((value, successMessage = "Запрос скопирован.") => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => setStatus(successMessage),
        () => setStatus("Не удалось скопировать запрос.")
      );
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      setStatus(successMessage);
    } catch {
      setStatus("Не удалось скопировать запрос.");
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);
  const isMediaDownloadBusy = React.useCallback(
    (url) => {
      const normalized = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (!normalized) return false;
      if (mediaQueue[normalized]) return true;
      return mediaJobs.some((job) => {
        if (job.status !== "queued" && job.status !== "running") return false;
        const jobUrl = canonicalizeLinkUrl(job.url) || normalizeLinkUrl(job.url);
        return jobUrl === normalized;
      });
    },
    [mediaJobs, mediaQueue]
  );
  const isMediaDownloadSupported = React.useCallback(
    (url) => {
      if (!mediaTools?.available) return false;
      return isYtDlpCandidateUrl(url);
    },
    [mediaTools]
  );
  const handleDownloadMedia = React.useCallback(
    async (url, sectionTitle = null) => {
      const normalized = normalizeLinkUrl(url);
      if (!docId || !normalized) return;
      if (!isYtDlpCandidateUrl(normalized)) {
        setStatus("Ссылка не подходит под фильтр yt-dlp.");
        return;
      }
      if (isMediaDownloaded(normalized)) {
        setStatus("\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u043f\u043e\u043c\u0435\u0447\u0435\u043d\u0430 \u043a\u0430\u043a \u0441\u043a\u0430\u0447\u0430\u043d\u043d\u0430\u044f.");
        return;
      }
      const key = canonicalizeLinkUrl(normalized) || normalized;
      if (mediaQueue[key]) return;
      setMediaQueue((prev) => ({ ...prev, [key]: true }));
      setStatus(`Media download: ${normalized}`);
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media:download`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: normalized, section_title: sectionTitle ?? null })
        });
        if (!response.ok) throw new Error(data?.error ?? "Media download error");
        if (data?.already_downloaded) {
          await refreshMedia();
          setStatus("\u0423\u0436\u0435 \u0441\u043a\u0430\u0447\u0430\u043d\u043e.");
          return;
        }
        if (data?.job?.id) {
          mediaJobStatusRef.current.set(String(data.job.id), {
            status: String(data.job.status ?? "queued"),
            sectionTitle: String(data.job.section_title ?? sectionTitle ?? ""),
            error: "",
            outputCount: 0
          });
        }
        await refreshMedia();
        setStatus(`Media queued: ${data?.job?.id ?? normalized}`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setMediaQueue((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [docId, isMediaDownloaded, mediaQueue, refreshMedia]
  );
  const handleCancelMediaJob = React.useCallback(
    async (jobId) => {
      if (!docId || !jobId) return;
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media/${jobId}:cancel`, {
          method: "POST"
        });
        if (!response.ok) throw new Error(data?.error ?? "Cancel failed");
        await refreshMedia();
      } catch (error) {
        setStatus(error.message);
      }
    },
    [docId, refreshMedia]
  );
  const handleSearch = React.useCallback(
    (engine, query) => {
      if (!engine || !query) return;
      if (engine.action === "copy_open") {
        copyToClipboard(query, "Запрос скопирован и открыт Perplexity.");
        if (engine.url) {
          window.open(engine.url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (!engine.url) return;
      const suffix = engine.suffix ?? "";
      const url = `${engine.url}${encodeURIComponent(query)}${suffix}`;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [copyToClipboard]
  );
  const handleAiHelp = React.useCallback(
    async (groupId) => {
      if (!docId) {
        setStatus("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0438\u043b\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442.");
        return;
      }
      const group = groupedSegments.find((item) => item.id === groupId);
      if (!group || !group.items.length) {
        setStatus("\u0412 \u044d\u0442\u043e\u0439 \u0442\u0435\u043c\u0435 \u043d\u0435\u0442 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u043e\u0432.");
        return;
      }

      const pendingItems = group.items.filter(
        ({ segment }) =>
          !hasVisualDecisionContent(segment.visual_decision) ||
          !hasSearchDecisionContent(segment.search_decision)
      );
      const targetItems = pendingItems.length > 0 ? pendingItems : group.items;
      const targetSegments = targetItems.map(({ segment }) => ({
        segment_id: segment.segment_id,
        block_type: "news",
        text_quote: segment.text_quote
      }));
      const targetIds = targetSegments.map((item) => item.segment_id);
      if (targetIds.some((id) => aiLoading[id])) return;

      setAiLoading((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
      setStatus(`AI Help: \u043e\u0431\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u044e ${targetIds.length} \u0441\u0435\u0433\u043c.`);

      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/decisions:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ segments: targetSegments })
        });
        if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 AI Help");
        const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
        if (!decisions.length) throw new Error("AI Help: \u0440\u0435\u0448\u0435\u043d\u0438\u044f \u043d\u0435 \u043f\u0440\u0438\u0448\u043b\u0438");

        const decisionMap = new Map(decisions.map((decision) => [decision.segment_id, decision]));
        setSegments((prev) =>
          prev.map((segment) => {
            const decision = decisionMap.get(segment.segment_id);
            if (!decision) return segment;
            return {
              ...segment,
              visual_decision: normalizeVisualDecision(decision.visual_decision, config),
              search_decision: normalizeSearchDecision(decision.search_decision, config)
            };
          })
        );
        setStatus(`AI Help: \u0433\u043e\u0442\u043e\u0432\u043e ${decisions.length}/${targetSegments.length}.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setAiLoading((prev) => {
          const next = { ...prev };
          targetIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
    },
    [aiLoading, config, docId, groupedSegments]
  );
  const handleGenerateSearch = React.useCallback(
    async (index) => {
      const segment = segments[index];
      if (!segment) return;
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const segmentId = segment.segment_id;
      if (searchLoading[segmentId]) return;
      setSearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`Поиск: ${segmentId}...`);
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/search:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segment.segment_id,
              block_type: "news",
              text_quote: segment.text_quote,
              visual_decision: segment.visual_decision
            }
          })
        });
        if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации поиска");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("Поиск: решение не пришло");
        setSegments((prev) =>
          prev.map((item, idx) =>
            idx === index
              ? {
                  ...item,
                  visual_decision: normalizeVisualDecision(decision.visual_decision, config),
                  search_decision: normalizeSearchDecision(decision.search_decision, config),
                  search_open: true
                }
              : item
          )
        );
        setStatus(`Поиск: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, searchLoading, segments]
  );
  const handleCopy = React.useCallback((query) => {
    copyToClipboard(query);
  }, [copyToClipboard]);
  const handleCopyForFigma = React.useCallback(() => {
    const { blocks } = splitScriptIntoHeadingBlocks(scriptText);
    const topics = blocks
      .map((block) => normalizeHeadingForFigma(block.heading))
      .filter(Boolean);
    if (!topics.length) {
      setStatus("Нет тем для For Figma.");
      return;
    }
    copyToClipboard(topics.join("\n"), `For Figma: скопировано тем (${topics.length}).`);
  }, [copyToClipboard, scriptText]);
  const handleThemeToggle = React.useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);
  return (
    <div className="app">
      <header className="hero">
        <div>
          <div className="hero-top">
            <button
              className="theme-toggle"
              type="button"
              onClick={handleThemeToggle}
              aria-label={"\u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0442\u0435\u043c\u0443"}
              title={"\u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0442\u0435\u043c\u0443"}
            >
              <span className="theme-dot" aria-hidden="true" />
              {theme === "dark"
                ? "\u0422\u0435\u043c\u043d\u0430\u044f"
                : "\u0421\u0432\u0435\u0442\u043b\u0430\u044f"}
            </button>
          </div>
          <p className="eyebrow">{"\u041f\u043e\u0438\u0441\u043a \u043a\u043e\u043d\u0442\u0435\u043d\u0442\u0430"}</p>
          <h1 className="hero-title">
            <span>USACHEV</span>
            <span>TODAY</span>
          </h1>
        </div>
        <div className="hero-card">
          <div className="hero-stat">
            <span>Документ</span>
            <strong>{docId ? docId : "—"}</strong>
          </div>

          <div className="hero-stat">
            <span>Статус</span>
            <strong>{status || "\u0413\u043e\u0442\u043e\u0432"}</strong>
          </div>
          <div className="hero-recent">
            <label>Недавние документы</label>
            <div className="doc-loader recent-loader">
              <select
                value={recentDocId}
                onChange={handleRecentSelect}
                disabled={loading || recentDocs.length === 0}
                aria-label="Недавние документы"
              >
                <option value="">
                  {recentDocs.length > 0 ? "Недавние документы" : "Нет недавних документов"}
                </option>
                {recentDocs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {formatRecentDocLabel(doc)}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => setAutoOpenLastDocEnabled((prev) => !prev)}
            >
              {autoOpenLastDocEnabled
                ? "Авто-открытие последнего: ON"
                : "Авто-открытие последнего: OFF"}
            </button>
          </div>
        </div>
      </header>
      <section className="panel">
        <div className="panel-header">
          <h2>{"\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439"}</h2>
          <div className="panel-actions panel-actions-scenario-toggle">
            <button
              className="btn ghost small segment-group-expand-icon scenario-panel-toggle"
              type="button"
              onClick={() => setScenarioPanelOpen((prev) => !prev)}
              title={scenarioPanelOpen ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
              aria-label={scenarioPanelOpen ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
              aria-expanded={scenarioPanelOpen}
            >
              {scenarioPanelOpen ? "▴" : "▾"}
            </button>
          </div>
        </div>
        {scenarioPanelOpen ? (
          <>
            <div className="panel-actions panel-actions-scenario">
              <button className="btn ghost" onClick={handleStartNewScenario} disabled={loading}>
                {"\u041d\u043e\u0432\u044b\u0439 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439"}
              </button>
              <div className="doc-loader notion-loader">
                <input
                  className="notion-url-input"
                  type="url"
                  value={notionUrl}
                  onChange={(event) => setNotionUrl(event.target.value)}
                  placeholder={"\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 Notion"}
                />
                <button
                  className="btn ghost notion-load-btn"
                  onClick={handleLoadNotion}
                  disabled={!canLoadNotion}
                >
                  {"\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c Notion"}
                </button>
                <button
                  className="btn ghost icon-btn notion-refresh-btn"
                  onClick={handleRefreshNotion}
                  disabled={!canRefreshNotion}
                  title={"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0438\u0437 Notion"}
                  aria-label={"\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0438\u0437 Notion"}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 12a8 8 0 0 1 13.66-5.66L20 8V3h-5l2.22 2.22A10 10 0 1 0 22 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <textarea
              className="script-input"
              placeholder={"\u0412\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f..."}
              value={scriptText}
              onChange={(event) => setScriptText(event.target.value)}
            />
            <div className="panel-actions panel-actions-scenario panel-actions-scenario-footer">
              <button className="btn ghost" onClick={handleGenerate} disabled={!canGenerate}>
                {"\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                {notionHasUpdates ? <span className="badge">NEW</span> : null}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={handleMarkAllDone}
                disabled={segmentsCount === 0}
              >
                {"\u0413\u043e\u0442\u043e\u0432\u043e"}
              </button>
            </div>
          </>
        ) : null}
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Блоки сценария</h2>
          <div className="panel-actions panel-actions-blocks">
            <button
              className={`btn save-btn${hasUnsavedChanges ? " is-dirty" : ""}`}
              onClick={handleSave}
              disabled={!canSave}
            >
              {"\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"}
            </button>
            <button className="btn ghost" onClick={handleAddSegment}>
              {"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0435\u0433\u043c\u0435\u043d\u0442"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setLinksPanelOpen((prev) => !prev)}
            >
              {linksPanelOpen
                ? `\u0421\u043a\u0440\u044b\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0438 (${allScenarioLinks.length})`
                : `\u0412\u0441\u0435 \u0441\u0441\u044b\u043b\u043a\u0438 (${allScenarioLinks.length})`}
            </button>
            <button className="btn ghost" type="button" onClick={handleCopyForFigma}>
              For Figma
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("jsonl")}>
              {"\u042d\u043a\u0441\u043f\u043e\u0440\u0442 JSONL"}
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("md")}>
              {"\u042d\u043a\u0441\u043f\u043e\u0440\u0442 MD"}
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("xml")}>
              {"\u042d\u043a\u0441\u043f\u043e\u0440\u0442 XML"}
            </button>
          </div>
        </div>
        {linksPanelOpen ? (
          <div className="all-links-panel">
            <div className="all-links-panel-head">
              <strong>Все ссылки сценария</strong>
              <span>{allScenarioLinks.length}</span>
            </div>
            {allScenarioLinks.length === 0 ? (
              <div className="links-empty">Ссылок пока нет.</div>
            ) : (
              <div className="all-links-list">
                {allScenarioLinks.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="all-links-row">
                    <div className="all-links-meta">
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        {getReadableLinkLabel(item.url)}
                      </a>
                      <span>{item.sectionTitle}</span>
                    </div>
                    <div className="query-actions">
                      {(isMediaDownloadSupported(item.url) || isMediaDownloaded(item.url)) ? (
                        isMediaDownloaded(item.url) ? (
                          <button className="btn ghost small" type="button" disabled>
                            {"\u0421\u043a\u0430\u0447\u0430\u043d\u043e"}
                          </button>
                        ) : (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleDownloadMedia(item.url, item.sectionTitle)}
                            disabled={isMediaDownloadBusy(item.url)}
                          >
                            Скачать
                          </button>
                        )
                      ) : null}
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleCopy(item.url)}
                      >
                        Копировать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {segments.length === 0 ? (
          <div className="empty-state">
            <p>Пока нет сегментов. Запустите сегментацию или добавьте сегмент вручную.</p>
          </div>
        ) : (
          <div className="segment-groups">
            {groupedSegments.map((group, groupIndex) => {
              const isExpanded = Boolean(expandedGroups[group.id]);
              const limit = groupRenderLimits[group.id] ?? GROUP_RENDER_CHUNK;
              const visibleItems = isExpanded ? group.items.slice(0, limit) : [];
              const remaining = group.items.length - visibleItems.length;
              const groupLoading = group.items.some(({ segment }) => aiLoading[segment.segment_id]);
              const doneCount = group.items.filter(({ segment }) => Boolean(segment.is_done)).length;
              const groupDone = group.items.length > 0 && doneCount === group.items.length;
              const headingRuQuery = group.title === "Без темы" ? "" : group.title;
              const headingEnQuery = String(headingEnglishQueries[group.id] ?? headingRuQuery);
              const isHeadingSearchOpen = Boolean(headingSearchOpen[group.id]);
              const canExportGroupXml = Boolean(
                docId && (group.section_id || (group.title && group.title !== "Без темы"))
              );
              return (
                <div key={`${group.id}-${groupIndex}`} className="segment-group">
                  <div className="segment-group-header">
                    <div className="segment-group-title">
                      <div className="segment-group-title-row">
                        <h3>{group.title === "Без темы" ? "Без темы" : group.title}</h3>
                        <label
                          className="done-toggle-inline segment-group-done-toggle"
                          title="Отметить тему как готово"
                        >
                          <input
                            type="checkbox"
                            checked={groupDone}
                            onChange={(event) => handleToggleGroupDone(group.id, event.target.checked)}
                          />
                        </label>
                      </div>
                      <div className="segment-group-controls">
                        <div className="segment-group-actions">
                          {!group.linkSegment ? (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleAddLinksBlock(group)}
                            >
                              {"\u{1F517}+"}
                            </button>
                          ) : null}
                          {group.items.length > 0 ? (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleAiHelp(group.id)}
                              disabled={!docId || loading || groupLoading}
                              title="AI Help"
                              aria-label="AI Help"
                            >
                              {groupLoading ? "..." : "✨"}
                            </button>
                          ) : null}
                          <button
                            className="btn ghost small segment-group-heading-toggle"
                            type="button"
                            onClick={() => toggleHeadingSearch(group.id, headingRuQuery, headingEnQuery)}
                            disabled={!headingRuQuery}
                            title="Поиск по заголовку"
                            aria-label="Поиск по заголовку"
                          >
                            {"🔍"}
                          </button>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleExport("xml", {
                                scope: "section",
                                section_id: group.section_id ?? "",
                                section_title: group.title === "Без темы" ? "" : group.title
                              })
                            }
                            disabled={!canExportGroupXml}
                            title="Экспорт XML темы"
                            aria-label="Экспорт XML темы"
                          >
                            XML
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="segment-group-right">
                      <button
                        className="btn ghost small segment-group-expand segment-group-expand-icon"
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        title={isExpanded ? "Свернуть" : "Развернуть"}
                        aria-label={isExpanded ? "Свернуть" : "Развернуть"}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "▴" : "▾"}
                      </button>
                    </div>
                  </div>
                  {isHeadingSearchOpen ? (
                    <div className="heading-search-panel">
                      <div className="heading-search-grid">
                        <div className="heading-search-col">
                          <label>RU (как в заголовке)</label>
                          <input value={headingRuQuery} readOnly />
                          <div className="query-actions">
                            {headingRuEngines.map((engine) => (
                              <button
                                key={`${group.id}-${engine.id}-ru`}
                                className="btn ghost small"
                                type="button"
                                onClick={() => handleSearch(engine, headingRuQuery)}
                                disabled={!headingRuQuery}
                              >
                                {engine.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="heading-search-col">
                          <label>EN query</label>
                          <input
                            value={headingEnQuery}
                            onChange={(event) => handleHeadingEnglishQueryChange(group.id, event.target.value)}
                            placeholder="English query"
                          />
                          <div className="query-actions">
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => translateHeadingQuery(group.id, headingRuQuery, { force: true })}
                              disabled={!headingRuQuery || Boolean(headingTranslateLoading[group.id])}
                            >
                              {headingTranslateLoading[group.id] ? "Перевод..." : "Перевести EN"}
                            </button>
                            {HEADING_EN_SEARCH_ENGINES.map((engine) => (
                              <button
                                key={`${group.id}-${engine.id}-en`}
                                className="btn ghost small"
                                type="button"
                                onClick={() => handleSearch(engine, headingEnQuery)}
                                disabled={!headingEnQuery.trim()}
                              >
                                {engine.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {isExpanded ? (
                    <>
                      {group.linkSegment ? (
                        <LinksCard
                          segment={group.linkSegment.segment}
                          index={group.linkSegment.index}
                          onLinkAdd={handleLinkAdd}
                          onLinkUpdate={handleLinkUpdate}
                          onLinkRemove={handleLinkRemove}
                          onDownload={handleDownloadMedia}
                          isDownloadBusy={isMediaDownloadBusy}
                          isDownloadSupported={isMediaDownloadSupported}
                          isDownloaded={isMediaDownloaded}
                        />
                      ) : null}
                      <div className="segments-grid">
                        {visibleItems.map(({ segment, index }, localIndex) => (
                          <SegmentCard
                            key={`${segment.segment_id}-${index}`}
                            segment={segment}
                            index={index}
                            animationIndex={localIndex}
                            config={config}
                            docId={docId}
                            mediaFiles={mediaFiles}
                            onUpdate={updateSegment}
                            onVisualUpdate={updateVisual}
                            onSearchUpdate={updateSearch}
                            onQuoteChange={handleQuoteChange}
                            onInsertAfter={handleInsertAfter}
                            onRemove={handleRemoveSegment}
                            onClearSearch={handleClearSearch}
                            onSearchGenerate={handleGenerateSearch}
                            searchLoading={Boolean(searchLoading[segment.segment_id])}
                            onSearchToggle={handleSearchToggle}
                            onSearch={handleSearch}
                            onCopy={handleCopy}
                            onDoneToggle={handleToggleSegmentDone}
                          />
                        ))}
                      </div>
                      {remaining > 0 ? (
                        <div className="segment-group-footer">
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleShowMore(group.id)}
                          >
                            Показать ещё
                          </button>
                          <span>
                            Показано {visibleItems.length} из {group.items.length}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel media-panel-shell">
        <div className="panel-header">
          <h2>{"\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0417\u0430\u0433\u0440\u0443\u0437\u043e\u043a"}</h2>
          <div className="panel-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMediaPanelOpen((prev) => !prev)}
              disabled={!docId}
            >
              {mediaPanelOpen ? "\u0421\u043a\u0440\u044b\u0442\u044c" : "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c"}
            </button>
          </div>
        </div>
        {docId && mediaPanelOpen ? (
          <div className="media-panel">
            <div className="media-panel-head">
              <strong>{"\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0417\u0430\u0433\u0440\u0443\u0437\u043e\u043a"}</strong>
              <div className="media-panel-head-right">
                <span>
                  {mediaTools?.available
                    ? `yt-dlp ready${ytDlpVersion ? ` (${ytDlpVersion})` : ""}`
                    : "yt-dlp unavailable"}
                </span>
                <div className="query-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleCheckYtDlpVersion()}
                    disabled={!mediaTools?.available || ytDlpVersionLoading || ytDlpUpdateLoading}
                  >
                    {ytDlpVersionLoading ? "Проверка..." : "Версия yt-dlp"}
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={handleUpdateYtDlp}
                    disabled={!mediaTools?.available || ytDlpUpdateLoading || activeMediaJobsCount > 0}
                  >
                    {ytDlpUpdateLoading ? "Обновление..." : "Обновить yt-dlp"}
                  </button>
                </div>
              </div>
            </div>
            {mediaJobs.length > 0 ? (
              <div className="media-jobs-list">
                {mediaJobs.slice(0, 8).map((job) => (
                  <div key={job.id} className="media-job-row">
                    <div className="media-job-meta">
                      <strong>{job.id}</strong>
                      <span>{job.status}</span>
                      {job.section_title ? <span>{job.section_title}</span> : null}
                      {formatMediaJobProgress(job) ? <span>{formatMediaJobProgress(job)}</span> : null}
                      {job.error ? <span className="muted">{job.error}</span> : null}
                    </div>
                    {(job.status === "queued" || job.status === "running") ? (
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleCancelMediaJob(job.id)}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {mediaFiles.length > 0 ? (
              <div className="media-files-list">
                {mediaFiles.slice(0, 20).map((file) => (
                  <div key={file.path} className="media-file-row">
                    <a
                      href={`/api/documents/${docId}/media/file?path=${encodeURIComponent(file.path)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {file.path}
                    </a>
                    <span className="muted">{formatBytes(file.size)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Downloaded files will appear here.</div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
function mergeSegmentsAndDecisions(segments = [], decisions = [], config = defaultConfig) {
  const decisionMap = new Map(
    decisions.map((item) => [
      item.segment_id,
      {
        visual: item.visual_decision ?? item.visual,
        search: item.search_decision ?? item.search
      }
    ])
  );
  return segments.map((segment) => ({
    ...segment,
    block_type: normalizeSegmentBlockType(segment.block_type),
    links: Array.isArray(segment.links) ? dedupeLinks(segment.links) : [],
    visual_decision: (() => {
      const normalized = normalizeVisualDecision(
        decisionMap.get(segment.segment_id)?.visual ?? segment.visual_decision,
        config
      );
      if (normalized.duration_hint_sec !== null && normalized.duration_hint_sec !== undefined) {
        return normalized;
      }
      return { ...normalized, duration_hint_sec: computeDurationHint(segment.text_quote) };
    })(),
    search_decision: normalizeSearchDecision(
      decisionMap.get(segment.segment_id)?.search ?? segment.search_decision,
      config
    ),
    search_open: Boolean(segment.search_open),
    is_done: Boolean(segment.is_done)
  }));
}
function splitSegmentsAndDecisions(segments = []) {
  const segmentsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    block_type: normalizeSegmentBlockType(segment.block_type),
    text_quote: segment.text_quote,
    section_id: segment.section_id ?? null,
    section_title: segment.section_title ?? null,
    section_index: segment.section_index ?? null,
    links: Array.isArray(segment.links) ? dedupeLinks(segment.links) : [],
    segment_status: segment.segment_status ?? null,
    is_done: Boolean(segment.is_done),
    version: segment.version ?? 1
  }));
  const decisionsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision:
      normalizeSegmentBlockType(segment.block_type) === "links"
        ? emptyVisualDecision()
        : normalizeVisualDecision(segment.visual_decision, defaultConfig),
    search_decision:
      normalizeSegmentBlockType(segment.block_type) === "links"
        ? emptySearchDecision()
        : normalizeSearchDecision(segment.search_decision, defaultConfig),
    version: segment.version ?? 1
  }));
  return { segmentsPayload, decisionsPayload };
}





