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
  formatHints: ["2:1", "1:1", "Заголовок/Цитата", "Документ"],
  priorities: ["обязательно", "рекомендуется", "при наличии"],
  searchLimits: { maxKeywords: 8, maxQueries: 6 },
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
      label: "Яндекс HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&isize=large"
    },
    {
      id: "yandex_hq_square",
      label: "1:1 Яндекс HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&iorient=square&isize=large"
    },
    {
      id: "google_hq",
      label: "Google HQ",
      url: "https://www.google.com/search?q=",
      suffix: "&tbm=isch&tbs=isz:l"
    },
    { id: "vk_video", label: "VK Видео", url: "https://vk.com/search/video?q=" },
    { id: "vk", label: "VK \u041f\u043e\u0441\u0442", url: "https://vk.com/search?q=" },
    {
      id: "x_live",
      label: "X",
      url: "https://x.com/search?q=",
      suffix: "&src=typed_query&f=live"
    },
    { id: "dzen_news", label: "Дзен.Новости", url: "https://dzen.ru/news/search?query=" },
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
const VISUAL_TYPE_LABELS = {
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
const FORMAT_HINT_LABELS = {
  "2:1": "2:1",
  "1:1": "1:1",
  "Заголовок/Цитата": "📰 Заголовок/Цитата",
  "Документ": "📝 Документ"
};
const PRIORITY_LABELS = {
  "обязательно": "🔴 Обязательно",
  "рекомендуется": "🟡 Рекомендуется",
  "при наличии": "🟢 При наличии"
};
const emptyVisualDecision = () => ({
  type: "no_visual",
  description: "",
  format_hint: null,
  duration_hint_sec: null,
  priority: null
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
  return {
    type,
    description,
    format_hint,
    duration_hint_sec,
    priority
  };
};
const normalizeFormatHint = (value, config) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "Документ", SQUARE: "1:1" };
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
  const legacy = { high: "обязательно", medium: "рекомендуется", low: "при наличии" };
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
  const items = Array.isArray(value) ? value : String(value).split(/\n+/);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
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
  "Сервер вернул HTML вместо JSON. Проверьте backend, Vite proxy (/api) и туннель ngrok.";

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
      throw new Error("Сервер вернул поврежденный JSON. Обновите страницу и проверьте backend.");
    }
  }

  if (/^\s*<!doctype html|^\s*<html/i.test(rawText)) {
    throw new Error(API_HTML_RESPONSE_ERROR);
  }

  return { response, data: null, rawText };
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
const VOWELS_RU = new Set(["а", "е", "ё", "и", "о", "у", "ы", "э", "ю", "я"]);
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
const normalizeLineBreaks = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const normalizeTopicTitleForDisplay = (title) => {
  const value = normalizeLineBreaks(title)
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
};
const normalizeSectionTitleForId = (title) =>
  normalizeLineBreaks(title)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const normalizeSectionTitleForMerge = (title) =>
  normalizeLineBreaks(title)
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
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
  let displayUrl = normalized;
  try {
    const url = new URL(normalized);
    if (url.hash.includes(":~:text=")) {
      const markerIndex = url.hash.indexOf("#:~:text=");
      if (markerIndex === 0) {
        url.hash = "";
      } else if (markerIndex > 0) {
        url.hash = url.hash.slice(0, markerIndex);
      }
      displayUrl = url.toString();
    }
  } catch {
    displayUrl = normalized;
  }
  let decoded = displayUrl;
  try {
    decoded = decodeURI(displayUrl);
  } catch {
    decoded = displayUrl;
  }
  if (decoded.length <= maxLength) return decoded;
  return `${decoded.slice(0, maxLength).trimEnd()}...`;
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
const parseScriptSections = (text) => {
  const sections = [];
  const { normalized, blocks } = splitScriptIntoHeadingBlocks(text);
  const titleOccurrences = new Map();
  for (const block of blocks) {
    if (!block.heading) continue;
    const hasContent = block.lines.some((line) => String(line ?? "").trim());
    if (!hasContent) continue;
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
});
const GROUP_RENDER_CHUNK = 20;
const getSegmentGroupKey = (segment) => getSectionKeyFromMeta(segment);
const getSegmentGroupTitle = (segment) => {
  const title = normalizeTopicTitleForDisplay(segment.section_title ?? "");
  return title || "Без темы";
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
  onRemoveBlock,
  onDownload,
  isDownloadBusy,
  isDownloadSupported,
  isDownloaded
}) {
  const [open, setOpen] = useState((segment.links ?? []).length > 0);
  const [previews, setPreviews] = useState({});
  const [editing, setEditing] = useState({});
  useEffect(() => {
    if ((segment.links ?? []).length > 0 && !open) {
      setOpen(true);
    }
  }, [segment.links, open]);
  useEffect(() => {
    if (!open) return;
    const links = segment.links ?? [];
    links.forEach((link) => {
      const url = normalizeLinkUrl(link?.url ?? "");
      if (!url) return;
      const key = canonicalizeLinkUrl(url) || url;
      if (previews[key]?.loading || previews[key]?.title || previews[key]?.error) return;
      setPreviews((prev) => ({ ...prev, [key]: { loading: true } }));
      fetchJsonSafe(`/api/link/preview?url=${encodeURIComponent(url)}`)
        .then(({ response, data }) => {
          if (!response.ok) throw new Error("preview_failed");
          setPreviews((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              title: data?.title ?? "",
              description: data?.description ?? "",
              image: data?.image ?? "",
              siteName: data?.siteName ?? ""
            }
          }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [key]: { loading: false, error: true } }));
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
            className="btn small ghost"
            type="button"
            onClick={() => onLinkAdd(index)}
            title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
            aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
          >
            +
          </button>
          <button
            className="btn small ghost"
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
          <button
            className="btn small ghost"
            type="button"
            onClick={() => onRemoveBlock(index)}
            title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0431\u043b\u043e\u043a"}
            aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0431\u043b\u043e\u043a"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M3 6h18M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 6V4h4v2"
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
                            <img src={preview.image} alt={preview.title || "preview"} />
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
  onCopy
}) {
  const keywordsValue = (segment.search_decision?.keywords ?? []).join(", ");
  const queriesValue = (segment.search_decision?.queries ?? []).join("\n");
  const statusBadge =
    segment.segment_status === "new"
      ? { text: "NEW", className: "badge badge-new" }
      : segment.segment_status === "changed"
        ? { text: "CHANGED", className: "badge badge-changed" }
        : null;
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
        <div className="segment-head-actions">
          <button
            className="btn small ghost"
            type="button"
            onClick={() => onInsertAfter(index)}
            title="Добавить подблок"
            aria-label="Добавить подблок"
          >
            +
          </button>
          <button
            className="btn small ghost"
            type="button"
            onClick={() => onRemove(index)}
            title="Удалить"
            aria-label="Удалить"
          >
            -
          </button>
        </div>
      </div>
      <div className="segment-body">
        <label>Цитата</label>
        <textarea
          value={segment.text_quote}
          onChange={(event) => onQuoteChange(index, event.target.value)}
        />
        <div className="decision-grid">
          <div>
            <label>Визуал</label>
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
            <label>Формат</label>
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
            <label>Приоритет</label>
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
            <label>Длительность (сек)</label>
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
        <label>Описание визуала</label>
        <textarea
          value={segment.visual_decision.description}
          onChange={(event) => onVisualUpdate(index, { description: event.target.value })}
        />
        <div className="search-toggle">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchGenerate(index)}
            disabled={searchLoading}
          >
            {searchLoading ? "Генерация..." : "Сгенерировать поиск"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchToggle(index)}
          >
            {segment.search_open
              ? "Скрыть поисковые запросы"
              : `Показать поисковые запросы (${segment.search_decision?.queries?.length ?? 0})`}
          </button>
        </div>
        {segment.search_open ? (
          <>
            <label>Ключевые слова</label>
            <input
              value={keywordsValue}
              onChange={(event) =>
                onSearchUpdate(index, {
                  keywords: normalizeKeywordList(event.target.value, config.searchLimits?.maxKeywords)
                })
              }
              placeholder="Через запятую"
            />
            <label>Поисковые запросы</label>
            <textarea
              value={queriesValue}
              onChange={(event) =>
                onSearchUpdate(index, {
                  queries: normalizeQueryList(event.target.value, config.searchLimits?.maxQueries)
                })
              }
              placeholder="Каждый запрос с новой строки"
            />
            {segment.search_decision?.queries?.length ? (
              <div className="query-list">
                {segment.search_decision.queries.map((query, queryIndex) => (
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
                        Копировать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="segment-actions">
              <button className="btn ghost small" onClick={() => onClearSearch(index)}>
                Очистить поисковые
              </button>
            </div>
          </>
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
  const [docIdInput, setDocIdInput] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [notionHasUpdates, setNotionHasUpdates] = useState(false);
  const [segments, setSegments] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);
  const [recentDocId, setRecentDocId] = useState("");
  const [status, setStatus] = useState("");
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
    setDocIdInput(docId);
  }, [docId]);
  useEffect(() => {
    if (typeof window === "undefined" || !docId) return;
    window.localStorage?.setItem(LAST_USED_DOC_STORAGE_KEY, docId);
  }, [docId]);
  useEffect(() => {
    setMediaQueue({});
    setDownloadedMediaUrls([]);
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
  const canGenerate = Boolean(docId) && !loading;
  const canSave = Boolean(docId) && segmentsCount > 0 && !loading;
  const canLoad = Boolean(docIdInput.trim()) && !loading;
  const canLoadNotion = Boolean(notionUrl.trim()) && !loading;
  const canRefreshNotion = canLoadNotion;
  const buildSessionPayload = React.useCallback(
    () =>
      buildSessionPayloadFromState({
        scriptText,
        notionUrl,
        segments
      }),
    [notionUrl, scriptText, segments]
  );
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
      const linksFromMerged = merged.filter((item) => item.block_type === "links");
      const ordered = mergeLinkSegmentsIntoSegments(merged, linksFromMerged);

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
  const handleCreateDocument = async () => {
    if (!scriptText.trim()) {
      setStatus("Добавьте текст сценария.");
      return;
    }
    setLoading(true);
    setStatus("Создание документа...");
    try {
      const { response, data } = await fetchJsonSafe("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: scriptText, notion_url: notionUrl.trim() || null })
      });
      if (!response.ok) throw new Error(data?.error ?? "Ошибка создания документа");
      setDocId(data.id);
      setDocIdInput(data.id);
      setRecentDocId(data.id);
      setSegments([]);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
      rememberSessionSnapshot(
        buildSessionPayloadFromState({
          scriptText: data?.document?.raw_text ?? scriptText,
          notionUrl: data?.document?.notion_url ?? notionUrl,
          segments: []
        }),
        0
      );
      fetchRecentDocuments();
      setStatus(`Документ создан: ${data.id}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleStartNewScenario = React.useCallback(() => {
    initialDocRestoreDoneRef.current = true;
    setDocId("");
    setDocIdInput("");
    setRecentDocId("");
    setScriptText("");
    setNotionUrl("");
    setNotionHasUpdates(false);
    setSegments([]);
    setLinksPanelOpen(false);
    setMediaPanelOpen(false);
    setHeadingSearchOpen({});
    setHeadingEnglishQueries({});
    setStatus("Новый сценарий: вставьте текст и нажмите «Создать документ».");
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
  }, [rememberSessionSnapshot]);
  const updateDocumentMeta = async (payload) => {
    if (!docId) return;
    const { response, data } = await fetchJsonSafe(`/api/documents/${docId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(data?.error ?? "Ошибка обновления документа");
    }
    return data?.document;
  };
  const fetchNotionContent = async (statusLabel) => {
    const url = notionUrl.trim();
    if (!url) {
      setStatus("Укажите ссылку на Notion.");
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
      if (!response.ok) throw new Error(data?.error ?? "Ошибка загрузки Notion");
      const normalizedUrl = data?.url ?? url;
      if (normalizedUrl) {
        setNotionUrl(normalizedUrl);
      }
      const content = typeof data?.content === "string" ? data.content : "";
      const hasChanges = content !== previousText;
      setScriptText(content);
      if (hasChanges) {
        setNotionHasUpdates(true);
      }
      if (docId) {
        const updatedDocument = await updateDocumentMeta({ raw_text: content, notion_url: normalizedUrl });
        setNotionHasUpdates(getNeedsSegmentationFromDocument(updatedDocument));
      }
      if (hasChanges) {
        setStatus(content.trim() ? "Notion обновлен. Проверьте сегменты." : "Notion вернул пустой текст.");
      } else {
        setStatus("Notion без изменений.");
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
  const handleLoadDocument = async () => {
    await loadDocumentById(docIdInput.trim());
  };
  const handleRecentSelect = async (event) => {
    const selected = event.target.value;
    setRecentDocId(selected);
    if (!selected) return;
    setDocIdInput(selected);
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
    setDocIdInput(targetDocId);
    void loadDocumentById(targetDocId);
  }, [autoOpenLastDocEnabled, docId, loadDocumentById, notionUrl, recentDocs, scriptText, segments.length]);
  useEffect(() => {
    if (collabSaveTimerRef.current) {
      clearTimeout(collabSaveTimerRef.current);
      collabSaveTimerRef.current = null;
    }
    if (!collabSessionEnabled || !docId) {
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
  }, [buildSessionPayload, collabSessionEnabled, docId, saveSessionSnapshot]);
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
    if (!docId) return;
    setLoading(true);
    setStatus("Генерация сегментов...");
    try {
      const { cleanText, linkSegments: extractedLinks } = extractLinksFromScript(scriptText);
      const existingLinks = segments.filter((segment) => segment.block_type === "links");
      const mergedLinks = mergeLinkSegmentsBySection(existingLinks, extractedLinks);
      if (cleanText !== scriptText) {
        setScriptText(cleanText);
      }
      if (!cleanText.trim()) {
        setStatus("Нет текста для сегментации после удаления ссылок.");
        setLoading(false);
        return;
      }
      const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/segments:generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: cleanText, link_segments: mergedLinks })
      });
      if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации");
      const merged = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        cleanText
      );
      const linksFromMerged = merged.filter((segment) => segment.block_type === "links");
      const orderedSegments = mergeLinkSegmentsIntoSegments(merged, linksFromMerged);
      setSegments(orderedSegments);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
      const visualCount = merged.filter((segment) => hasVisualDecisionContent(segment.visual_decision)).length;
      const searchCount = merged.filter((segment) => hasSearchDecisionContent(segment.search_decision)).length;
      if (visualCount === 0 && searchCount === 0) {
        setStatus(
          `Сегменты готовы: ${merged.length}. Нажмите AI Help у нужной темы, чтобы получить визуал и поиск.`
        );
      } else {
        setStatus(
          `Сегменты готовы: ${merged.length}. Визуал: ${visualCount}. Поиск: ${searchCount}.`
        );
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
  const handleExport = async (format) => {
    if (!docId) {
      setStatus("Сначала создайте или загрузите документ.");
      return;
    }
    try {
      setStatus(`Экспорт ${format.toUpperCase()}...`);
      const response = await fetch(`/api/documents/${docId}/export?format=${format}`);
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
      const ext = format === "jsonl" ? "jsonl" : "md";
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${docId}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus(`Экспорт готов: ${docId}.${ext}`);
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
      const newSegment = {
        segment_id: newId,
        block_type: "news",
        text_quote: "",
        section_id: source.section_id ?? null,
        section_title: source.section_title ?? null,
        section_index: source.section_index ?? null,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision(),
        search_open: false,
        version: 1
      };
      const next = [...prev];
      next.splice(index + 1, 0, newSegment);
      return next;
    });
  }, []);
  const updateSegment = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) => (idx === index ? { ...segment, ...updates } : segment))
    );
  }, []);
  const updateVisual = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, visual_decision: { ...segment.visual_decision, ...updates } }
          : segment
      )
    );
  }, []);
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
                duration_hint_sec: computeDurationHint(value)
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
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const group = groupedSegments.find((item) => item.id === groupId);
      if (!group || !group.items.length) {
        setStatus("В этой теме нет сегментов.");
        return;
      }
      const pendingItem =
        group.items.find(
          ({ segment }) =>
            !hasVisualDecisionContent(segment.visual_decision) &&
            !hasSearchDecisionContent(segment.search_decision)
        ) ?? group.items[0];
      if (!pendingItem) {
        setStatus("Не удалось найти сегмент для AI Help.");
        return;
      }
      const segmentId = pendingItem.segment.segment_id;
      if (aiLoading[segmentId]) return;
      setAiLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`AI Help: ${segmentId}...`);
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/decisions:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segmentId,
              block_type: "news",
              text_quote: pendingItem.segment.text_quote
            }
          })
        });
        if (!response.ok) throw new Error(data?.error ?? "Ошибка AI Help");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("AI Help: решение не пришло");
        setSegments((prev) =>
          prev.map((segment) =>
            segment.segment_id === decision.segment_id
              ? {
                  ...segment,
                  visual_decision: normalizeVisualDecision(decision.visual_decision, config),
                  search_decision: normalizeSearchDecision(decision.search_decision, config)
                }
              : segment
          )
        );
        setStatus(`AI Help: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setAiLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
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
  const handleThemeToggle = React.useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);
  return (
    <div className="app">
      <header className="hero">
        <div>
          <div className="hero-top">
            <p className="eyebrow">Ассистент визуального брифа</p>
            <button
              className="theme-toggle"
              type="button"
              onClick={handleThemeToggle}
              aria-label="Переключить тему"
              title="Переключить тему"
            >
              <span className="theme-dot" aria-hidden="true" />
              {theme === "dark" ? "Темная" : "Светлая"}
            </button>
          </div>
          <h1>Локальный мозг для визуального ресёрча</h1>
          <p className="subtitle">
            Сегментируйте сценарий, получайте визуальные решения и поисковые запросы без потери ритма.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-stat">
            <span>Документ</span>
            <strong>{docId ? docId : "—"}</strong>
          </div>
          <div className="hero-stat">
            <span>Сегменты</span>
            <strong>{segmentsCount}</strong>
          </div>
          <div className="hero-stat">
            <span>Статус</span>
            <strong>{status || "Готов"}</strong>
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
          <h2>Сценарий</h2>
          <div className="panel-actions panel-actions-scenario">
            <button className="btn ghost" onClick={handleCreateDocument} disabled={loading}>
              Создать документ
            </button>
            <button className="btn ghost" onClick={handleStartNewScenario} disabled={loading}>
              Новый сценарий
            </button>
            <div className="doc-loader notion-loader">
              <input
                className="notion-url-input"
                type="url"
                value={notionUrl}
                onChange={(event) => setNotionUrl(event.target.value)}
                placeholder="Ссылка на Notion"
              />
              <button
                className="btn ghost notion-load-btn"
                onClick={handleLoadNotion}
                disabled={!canLoadNotion}
              >
                Загрузить Notion
              </button>
              <button
                className="btn ghost icon-btn notion-refresh-btn"
                onClick={handleRefreshNotion}
                disabled={!canRefreshNotion}
                title="Обновить из Notion"
                aria-label="Обновить из Notion"
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
            <div className="doc-loader">
              <input
                className="doc-id-input"
                value={docIdInput}
                onChange={(event) => setDocIdInput(event.target.value)}
                placeholder="ID документа"
              />
              <button
                className="btn ghost doc-load-btn"
                onClick={handleLoadDocument}
                disabled={!canLoad}
              >
                Загрузить
              </button>
            </div>
            <button className="btn ghost" onClick={handleGenerate} disabled={!canGenerate}>
              Сегментировать
              {notionHasUpdates ? <span className="badge">NEW</span> : null}
            </button>
          </div>
        </div>
        <textarea
          className="script-input"
          placeholder="Вставьте готовый текст сценария..."
          value={scriptText}
          onChange={(event) => setScriptText(event.target.value)}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Блоки сценария</h2>
          <div className="panel-actions panel-actions-blocks">
            <button className="btn ghost" onClick={handleAddSegment}>
              Добавить сегмент
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setLinksPanelOpen((prev) => !prev)}
            >
              {linksPanelOpen
                ? `Скрыть ссылки (${allScenarioLinks.length})`
                : `Все ссылки (${allScenarioLinks.length})`}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMediaPanelOpen((prev) => !prev)}
              disabled={!docId}
            >
              {mediaPanelOpen
                ? `Hide Downloads (${mediaFiles.length})`
                : `Media Downloads${activeMediaJobsCount > 0 ? ` (${activeMediaJobsCount})` : ""}`}
            </button>
            <button className="btn" onClick={handleSave} disabled={!canSave}>
              Сохранить
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("jsonl")}>
              Экспорт JSONL
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("md")}>
              Экспорт MD
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
        {docId && mediaPanelOpen ? (
          <div className="media-panel">
            <div className="media-panel-head">
              <strong>Media Downloads</strong>
              <span>
                {mediaTools?.available ? "yt-dlp ready" : "yt-dlp unavailable"}
              </span>
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
              const headingRuQuery = group.title === "Без темы" ? "" : group.title;
              const headingEnQuery = String(headingEnglishQueries[group.id] ?? headingRuQuery);
              const isHeadingSearchOpen = Boolean(headingSearchOpen[group.id]);
              return (
                <div key={`${group.id}-${groupIndex}`} className="segment-group">
                  <div className="segment-group-header">
                    <div className="segment-group-title">
                      <h3>{group.title === "Без темы" ? "Без темы" : `### ${group.title}`}</h3>
                      <div className="segment-group-meta">
                        <span>{group.items.length} сегм.</span>
                        {group.linkSegment ? (
                          <span>{(group.linkSegment.segment.links ?? []).length} ссылок</span>
                        ) : null}
                      </div>
                      <div className="segment-group-controls">
                        <div className="segment-group-actions">
                          {!group.linkSegment ? (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleAddLinksBlock(group)}
                            >
                              Ссылки +
                            </button>
                          ) : null}
                          {group.items.length > 0 ? (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleAiHelp(group.id)}
                              disabled={!docId || loading || groupLoading}
                            >
                              {groupLoading ? "AI Help..." : "AI Help"}
                            </button>
                          ) : null}
                          <button
                            className="btn ghost small segment-group-heading-toggle"
                            type="button"
                            onClick={() => toggleHeadingSearch(group.id, headingRuQuery, headingEnQuery)}
                            disabled={!headingRuQuery}
                          >
                            {isHeadingSearchOpen ? "Скрыть поиск темы" : "Поиск по заголовку"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn ghost small segment-group-expand"
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Свернуть" : "Развернуть"}
                    </button>
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
                          onRemoveBlock={handleRemoveSegment}
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
    search_open: Boolean(segment.search_open)
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
