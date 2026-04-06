import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { loadIndexedArrayWithFallback, loadIndexedObjectWithFallback } from "./indexed-fallback-loaders.js";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "./normalizers.js";
import { extractSourceScopeKey } from "./source-identity.js";
import { isBlockedResearchDomain } from "./source-profiles.js";

const TELEGRAM_MESSAGE_MAX = 4096;
const CALLBACK_ALERT_MAX = 190;
const TELEGRAM_CAPTION_MAX = 1024;
const CARD_CONTEXT_MAX = 80;
const FILE_PICKER_CONTEXT_MAX = 80;
const RESEARCH_SUGGESTION_CONTEXT_MAX = 160;
const SCREENSHOT_PREVIEW_CONTEXT_MAX = 120;
const RESEARCH_SUGGESTION_TOP_LIMIT = 5;
const FILE_PICKER_PAGE_SIZE = 8;
const JOB_WATCH_INTERVAL_MS = 1600;
const POLL_RETRY_DELAY_MS = 2500;
const DOWNLOAD_TRACK_TIMEOUT_MS = 30 * 60 * 1000;
const SDVG_CHEER_MIN_DELAY_MS = 35 * 60 * 1000;
const SDVG_CHEER_MAX_DELAY_MS = 75 * 60 * 1000;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TIME_PARAM_KEYS = ["t", "start", "time_continue"];
const execFileAsync = promisify(execFile);

function clipText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function chunkButtons(buttons = [], chunkSize = 2) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += chunkSize) {
    rows.push(buttons.slice(index, index + chunkSize));
  }
  return rows;
}

function normalizeRelativeMediaPath(value) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  return raw.replace(/^\/+/, "");
}

function sanitizeFileName(value, fallback = "file") {
  const source = String(value ?? "").trim();
  const normalized = source
    .replace(/[\u0000-\u001f<>:\"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const base = normalized || fallback;
  return base.length > 160 ? base.slice(0, 160).trim() : base;
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatFileDateTimeSuffix(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "date_time";
  }
  const pad2 = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") + "_" + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds())
  ].join("-");
}

function hasPrioritySearchQueries(decision = {}) {
  return Array.isArray(decision?.queries) ? decision.queries.some((item) => compactText(item)) : false;
}

function hasPriorityVisualDescription(decision = {}) {
  return Boolean(compactText(decision?.description));
}

async function enrichSegmentWithTranslatedText(segment = {}, decisions = {}, translateHeadingToEnglishQuery) {
  const normalizedSearchDecision = normalizeSearchDecisionInput(decisions?.search_decision);
  const normalizedVisualDecision = normalizeVisualDecisionInput(decisions?.visual_decision);
  if (hasPrioritySearchQueries(normalizedSearchDecision) || hasPriorityVisualDescription(normalizedVisualDecision)) {
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: ""
    };
  }
  const textQuote = compactText(segment?.text_quote);
  if (!textQuote || typeof translateHeadingToEnglishQuery !== "function") {
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: ""
    };
  }
  try {
    const translated = compactText(await translateHeadingToEnglishQuery(textQuote.slice(0, 320)));
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: translated && translated.toLowerCase() !== textQuote.toLowerCase() ? translated : ""
    };
  } catch {
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: ""
    };
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureUniqueFilePath(dirPath, fileName) {
  const parsed = path.parse(fileName);
  const baseName = sanitizeFileName(parsed.name || "file", "file");
  const extension = parsed.ext || "";
  let candidate = `${baseName}${extension}`;
  let index = 1;
  while (await fileExists(path.join(dirPath, candidate))) {
    candidate = `${baseName}_${String(index).padStart(2, "0")}${extension}`;
    index += 1;
  }
  return path.join(dirPath, candidate);
}

function isVideoFilePath(value) {
  return /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i.test(String(value ?? ""));
}

function extractUrls(text) {
  const source = String(text ?? "");
  const matches = source.match(URL_RE);
  if (!matches) return [];
  const seen = new Set();
  const result = [];
  for (const item of matches) {
    const cleaned = String(item ?? "").replace(/[),.;!?]+$/g, "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function formatSecondsAsTimecode(totalSeconds) {
  const safeTotal = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeTotal / 3600);
  const minutes = Math.floor((safeTotal % 3600) / 60);
  const seconds = safeTotal % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function parseFlexibleTimecodeToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const totalSeconds = Number(raw);
    return Number.isFinite(totalSeconds) ? formatSecondsAsTimecode(totalSeconds) : null;
  }

  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) {
    const parts = raw.split(":").map((item) => Number(item));
    if (parts.some((item) => !Number.isFinite(item) || item < 0)) return null;
    if (parts.length === 2) {
      const [mm, ss] = parts;
      return formatSecondsAsTimecode(mm * 60 + ss);
    }
    const [hh, mm, ss] = parts;
    return formatSecondsAsTimecode(hh * 3600 + mm * 60 + ss);
  }

  const compact = raw.toLowerCase().replace(/\s+/g, "");
  if (/^\d+[hms]/.test(compact)) {
    const tokenRe = /(\d+)([hms])/g;
    let totalSeconds = 0;
    let consumed = "";
    let match = tokenRe.exec(compact);
    while (match) {
      const amount = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(amount) || amount < 0) return null;
      if (unit === "h") totalSeconds += amount * 3600;
      if (unit === "m") totalSeconds += amount * 60;
      if (unit === "s") totalSeconds += amount;
      consumed += match[0];
      match = tokenRe.exec(compact);
    }
    if (consumed && consumed === compact) {
      return formatSecondsAsTimecode(totalSeconds);
    }
  }

  return null;
}

function normalizeMediaStartTimecodeValue(value) {
  const parsed = parseFlexibleTimecodeToken(value);
  if (parsed) return parsed;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.length > 32 ? raw.slice(0, 32) : raw;
}

function parseUrlTimecode(url) {
  const rawUrl = String(url ?? "").trim();
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    const candidates = [];
    TIME_PARAM_KEYS.forEach((key) => {
      const value = parsed.searchParams.get(key);
      if (value) candidates.push(value);
    });

    const hash = String(parsed.hash ?? "").replace(/^#/, "").trim();
    if (hash) {
      candidates.push(hash);
      try {
        const hashParams = new URLSearchParams(hash);
        TIME_PARAM_KEYS.forEach((key) => {
          const value = hashParams.get(key);
          if (value) candidates.push(value);
        });
      } catch {
        // ignore malformed hash params
      }
    }

    for (const candidate of candidates) {
      const parsedCandidate = parseFlexibleTimecodeToken(candidate);
      if (parsedCandidate) return parsedCandidate;
    }
  } catch {
    return null;
  }

  return null;
}

function parseTextTimecode(text) {
  const source = String(text ?? "");
  if (!source) return null;

  const withoutUrls = source.replace(URL_RE, " ").trim();
  if (!withoutUrls) return null;

  const labeled = withoutUrls.match(
    /(?:тайм[- ]?код|таймкод|timecode|start(?:s)?\s+at|from|с\s+таймкода|начинается\s+с)\s*[:=]?\s*([0-9hms:\s]+)/i
  );
  if (labeled?.[1]) {
    const parsed = parseFlexibleTimecodeToken(labeled[1]);
    if (parsed) return parsed;
  }

  const directHms = withoutUrls.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (directHms?.[1]) {
    const parsed = parseFlexibleTimecodeToken(directHms[1]);
    if (parsed) return parsed;
  }

  const directCompact = withoutUrls.match(/\b(\d+h(?:\d+m)?(?:\d+s)?|\d+m(?:\d+s)?|\d+s)\b/i);
  if (directCompact?.[1]) {
    const parsed = parseFlexibleTimecodeToken(directCompact[1]);
    if (parsed) return parsed;
  }

  return null;
}

function extractMediaStartTimecode(text, url) {
  const fromText = parseTextTimecode(text);
  if (fromText) return fromText;
  return parseUrlTimecode(url);
}

function normalizeSegmentList(segments = []) {
  return Array.isArray(segments)
    ? segments.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() !== "links")
    : [];
}

  function buildDecisionMap(decisions = []) {
    const map = new Map();
    if (!Array.isArray(decisions)) return map;
    decisions.forEach((item) => {
    const key = String(item?.segment_id ?? "").trim();
    if (!key) return;
    map.set(key, item);
  });
    return map;
  }

  async function notifyResearchProgress(onProgress, text) {
    if (typeof onProgress !== "function") return;
    try {
      await onProgress(String(text ?? "").trim());
    } catch {
      // ignore progress update failures
    }
  }

function collectMessageMediaItems(message = {}) {
  const items = [];

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    if (photo?.file_id) {
      const unique = String(photo.file_unique_id ?? Date.now());
      items.push({
        fileId: String(photo.file_id),
        fileName: `photo_${unique}.jpg`,
        kind: "photo",
        fileUniqueId: String(photo.file_unique_id ?? ""),
        mimeType: "image/jpeg"
      });
    }
  }

  const single = [
    { key: "video", kind: "video", fallbackExt: ".mp4" },
    { key: "animation", kind: "animation", fallbackExt: ".mp4" },
    { key: "audio", kind: "audio", fallbackExt: ".mp3" },
    { key: "voice", kind: "voice", fallbackExt: ".ogg" },
    { key: "video_note", kind: "video_note", fallbackExt: ".mp4" },
    { key: "document", kind: "document", fallbackExt: "" }
  ];

  single.forEach((entry) => {
    const payload = message?.[entry.key];
    if (!payload?.file_id) return;
    const providedFileName = typeof payload.file_name === "string" ? payload.file_name : "";
    const parsed = path.parse(providedFileName);
    const ext = parsed.ext || entry.fallbackExt;
    const stem = parsed.name || `${entry.kind}_${String(payload.file_unique_id ?? Date.now())}`;
    const safeName = sanitizeFileName(`${stem}${ext}`, `${entry.kind}${entry.fallbackExt}`);
    items.push({
      fileId: String(payload.file_id),
      fileName: safeName,
      kind: entry.kind,
      fileUniqueId: String(payload.file_unique_id ?? ""),
      mimeType: String(payload.mime_type ?? "")
    });
  });

  return items;
}

function trimTrailingSlashes(value) {
  return String(value ?? "").trim().replace(/\/+$/g, "");
}

function isOfficialTelegramApiBase(value) {
  return /(^|\/\/)api\.telegram\.org(?=[:/]|$)/i.test(String(value ?? "").trim());
}

function deriveLocalFileBaseUrl(apiBaseRoot) {
  const fallback = "http://127.0.0.1:8081/file";
  const normalized = trimTrailingSlashes(apiBaseRoot);
  if (!normalized) return fallback;
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}/file`;
  } catch {
    return fallback;
  }
}

function injectToken(base, token, fallbackSuffix = null) {
  const normalizedBase = trimTrailingSlashes(base);
  if (!token || !normalizedBase) return "";
  if (normalizedBase.includes("{token}")) {
    return normalizedBase.replaceAll("{token}", token);
  }
  if (fallbackSuffix === null) {
    return `${normalizedBase}${token}`;
  }
  return `${normalizedBase}${fallbackSuffix}`;
}

function encodePathForUrl(filePath) {
  return String(filePath ?? "")
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeTelegramFilePath(filePath, localStoragePrefix = "") {
  const raw = String(filePath ?? "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  const normalizedPrefix = trimTrailingSlashes(localStoragePrefix || "/var/lib/telegram-bot-api");
  const prefixWithSlash = `${normalizedPrefix}/`;
  let value = raw;
  if (normalizedPrefix && value.startsWith(prefixWithSlash)) {
    value = value.slice(prefixWithSlash.length);
  }
  value = value.replace(/^\/+/, "");
  return value;
}

function looksLikeTelegramLocalStoragePath(filePath, localStoragePrefix = "") {
  const raw = String(filePath ?? "").trim().replace(/\\/g, "/");
  if (!raw) return false;
  const normalizedPrefix = trimTrailingSlashes(localStoragePrefix || "/var/lib/telegram-bot-api");
  if (!normalizedPrefix) return false;
  return raw === normalizedPrefix || raw.startsWith(`${normalizedPrefix}/`);
}

export function createTelegramSdvgBotService(deps) {
  const {
    appendLinkDecisionsOverride,
    appendEvent,
    attachAsset,
    canonicalizeLinkUrl,
    collapseDuplicateLinkOnlyTopics,
    createAsset,
    ensureMediaDir,
    getDocumentMediaDownloads,
    getDocumentState,
    getDocDir,
    getMediaDir,
    getSourceMemory,
    getSourceProfiles,
    updateSourceProfiles,
    generateSegmentResearchQueries,
    isHttpUrl,
    isMediaAlreadyDownloaded,
    isYtDlpCandidateUrl,
    listDocuments,
    mediaDownloader,
    mergeLinkSegmentsBySection,
    listDocDecisions,
    listDocSegments,
    listRunsForSegment,
    mergeResearchScores,
    normalizeDocumentMediaDownloads,
    normalizeLinkSegmentsInput,
    normalizeLinkUrl,
    rankSegmentResearchResults,
    readOptionalJson,
    sanitizeMediaTopicName,
    saveVersioned,
    searchQueries,
    splitSegmentsAndDecisions,
    syncDocumentContext,
    translateHeadingToEnglishQuery,
    upsertBotSession
  } = deps;

  const token = String(
    process.env.TELEGRAM_BOT_TOKEN ?? "7686518888:AAGf1HwSavQS7lsMvzbXq-1Ti7vZ-aNes5U"
  ).trim();
  const enabled = String(process.env.TELEGRAM_SDVG_ENABLED ?? "1") !== "0";
  const defaultDocId = String(process.env.TELEGRAM_SDVG_DOC_ID ?? "").trim();
  const pollTimeoutSecRaw = Number(process.env.TELEGRAM_SDVG_POLL_TIMEOUT_SEC ?? 25);
  const pollTimeoutSec = Number.isFinite(pollTimeoutSecRaw) ? Math.max(5, Math.min(50, pollTimeoutSecRaw)) : 25;
  const apiBaseRoot = trimTrailingSlashes(process.env.TELEGRAM_BASE_API_URL ?? "https://api.telegram.org/bot");
  const fileBaseRootRaw = trimTrailingSlashes(process.env.TELEGRAM_BASE_FILE_URL ?? "");
  const usingOfficialApi = isOfficialTelegramApiBase(apiBaseRoot);
  const localStoragePrefix = String(
    process.env.TELEGRAM_LOCAL_STORAGE_PREFIX ?? "/var/lib/telegram-bot-api/"
  ).trim();
  const dockerContainerName = String(process.env.TELEGRAM_DOCKER_CONTAINER_NAME ?? "tgbotapi").trim();
  const dockerCopyFallbackEnabled = String(process.env.TELEGRAM_DOCKER_COPY_FALLBACK ?? "1") !== "0";
  const fileBaseRoot =
    fileBaseRootRaw || (usingOfficialApi ? "https://api.telegram.org/file" : deriveLocalFileBaseUrl(apiBaseRoot));
  const apiBase = injectToken(apiBaseRoot, token);
  const fileApiBase = fileBaseRootRaw
    ? injectToken(fileBaseRoot, token, "")
    : injectToken(fileBaseRoot, token, usingOfficialApi ? `/bot${token}` : "");

  const state = {
    enabled: enabled && Boolean(token),
    configured: Boolean(token),
    running: false,
    offset: 0,
    botUsername: null,
    sessions: new Map(),
    documentLocks: new Map()
  };

  function getSession(chatId) {
    const key = String(chatId ?? "").trim();
    if (!state.sessions.has(key)) {
      state.sessions.set(key, {
        doc_id: defaultDocId || null,
        active_segment_id: null,
        random_mode: false,
        sdvg_cheer_muted: false,
        sdvg_encouragement_message_id: null,
        sdvg_cheer_next_at: 0,
        card_contexts: new Map(),
        file_picker_contexts: new Map(),
        research_suggestion_contexts: new Map(),
        research_status_message_ids: new Map(),
        screenshot_preview_contexts: new Map(),
        card_action_locks: new Set()
      });
    }
    return state.sessions.get(key);
  }

  async function syncSessionState(chatId, session, extra = {}) {
    if (typeof upsertBotSession !== "function") return null;
    const normalizedChatId = String(chatId ?? "").trim();
    if (!normalizedChatId) return null;
    return upsertBotSession({
      chat_id: normalizedChatId,
      user_id: String(extra.userId ?? "").trim(),
      mode: String(extra.mode ?? (session?.active_segment_id ? "sdvg" : "inbox")).trim() || "inbox",
      active_document_id: String(extra.activeDocumentId ?? session?.doc_id ?? "").trim(),
      active_segment_id: String(extra.activeSegmentId ?? session?.active_segment_id ?? "").trim(),
      active_release_id: String(extra.activeReleaseId ?? "").trim(),
      pending_action: String(extra.pendingAction ?? "").trim(),
      pending_payload_json: extra.pendingPayload ?? {},
      last_seen_at: new Date().toISOString()
    }).catch(() => null);
  }

  async function loadDocumentStateForBot(docId) {
    return loadIndexedObjectWithFallback(
      docId,
      getDocumentState,
      async (normalizedDocId) => readOptionalJson(path.join(getDocDir(normalizedDocId), "document.json")),
      null
    );
  }

  async function loadDocumentMediaDownloadsForBot(docId) {
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId || typeof normalizeDocumentMediaDownloads !== "function") return {};
    return loadIndexedObjectWithFallback(
      normalizedDocId,
      getDocumentMediaDownloads,
      async () => {
        const document = await loadDocumentStateForBot(normalizedDocId);
        return normalizeDocumentMediaDownloads(document?.media_downloads);
      },
      {}
    );
  }

  async function loadSegmentsForBot(docId) {
    return loadIndexedArrayWithFallback(
      docId,
      listDocSegments,
      (normalizedDocId) => readOptionalJson(path.join(getDocDir(normalizedDocId), "segments.json"))
    );
  }

  async function loadDecisionsForBot(docId) {
    return loadIndexedArrayWithFallback(
      docId,
      listDocDecisions,
      (normalizedDocId) => readOptionalJson(path.join(getDocDir(normalizedDocId), "decisions.json"))
    );
  }

  async function syncDocumentContextForBot(docId, segments = [], decisions = [], reason = "telegram_sdvg_update") {
    if (typeof syncDocumentContext !== "function") return;
    await syncDocumentContext(docId, segments, decisions, reason).catch(() => null);
  }

  async function createAssetRecord(input = {}, context = {}) {
    if (typeof createAsset !== "function") return null;
    const asset = await createAsset({
      kind: input.kind,
      status: input.status ?? "new",
      title: input.title,
      description: input.description,
      author: input.author,
      source_url: input.sourceUrl,
      source_domain: input.sourceDomain,
      telegram_chat_id: input.telegramChatId,
      telegram_message_id: input.telegramMessageId,
      telegram_file_id: input.telegramFileId,
      telegram_file_unique_id: input.telegramFileUniqueId,
      mime_type: input.mimeType,
      file_name: input.fileName,
      local_path: input.localPath,
      screenshot_path: input.screenshotPath,
      preview_image_path: input.previewImagePath,
      editor_note: input.editorNote,
      priority: input.priority,
      processing_state: input.processingState,
      origin_type: input.originType,
      origin_id: input.originId,
      meta_json: input.meta ?? {}
    }).catch(() => null);
    if (!asset || typeof attachAsset !== "function") return asset;

    const segmentId = String(context.segmentId ?? "").trim();
    const documentId = String(context.documentId ?? "").trim();
    if (segmentId) {
      await attachAsset(asset.id, {
        target_type: "segment",
        target_id: segmentId,
        role: context.role ?? "main",
        note: context.note ?? "",
        attached_by: context.attachedBy ?? ""
      }).catch(() => null);
      return asset;
    }
    if (documentId) {
      await attachAsset(asset.id, {
        target_type: "document",
        target_id: documentId,
        role: context.role ?? "inbox",
        note: context.note ?? "",
        attached_by: context.attachedBy ?? ""
      }).catch(() => null);
    }
    return asset;
  }

  function deriveSourceDomain(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try {
      return String(new URL(raw).hostname ?? "").replace(/^www\./i, "").trim();
    } catch {
      return "";
    }
  }

  function clampInteger(value, fallback, min, max) {
    const numeric = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeScreenshotProfile(profile = {}) {
    return {
      width: clampInteger(profile.width, 2560, 320, 3840),
      height: clampInteger(profile.height, 1280, 240, 2160),
      zoom: clampInteger(profile.zoom, 400, 50, 800),
      success_count: Math.max(0, clampInteger(profile.success_count, 0, 0, 100000)),
      last_used_at: String(profile.last_used_at ?? "").trim().slice(0, 64)
    };
  }

  function screenshotProfileKey(profile = {}) {
    const normalized = normalizeScreenshotProfile(profile);
    return `${normalized.width}x${normalized.height}@${normalized.zoom}`;
  }

  function formatScreenshotProfile(profile = {}) {
    const normalized = normalizeScreenshotProfile(profile);
    return `${normalized.width}x${normalized.height} @ ${normalized.zoom}%`;
  }

  const SCREENSHOT_FORMAT_PRESETS = [
    { key: "standard", label: "2:1", width: 2560, height: 1280 },
    { key: "square", label: "1:1", width: 1280, height: 1280 },
    { key: "widescreen", label: "16:9", width: 2560, height: 1440 }
  ];

  function detectScreenshotFormatKey(profile = {}) {
    const normalized = normalizeScreenshotProfile(profile);
    const ratio = normalized.height > 0 ? normalized.width / normalized.height : 2;
    const closest = SCREENSHOT_FORMAT_PRESETS
      .map((preset) => ({
        ...preset,
        distance: Math.abs((preset.width / preset.height) - ratio)
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    return closest?.key ?? "standard";
  }

  function getScreenshotFormatPreset(key = "") {
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    return SCREENSHOT_FORMAT_PRESETS.find((item) => item.key === normalizedKey) ?? SCREENSHOT_FORMAT_PRESETS[0];
  }

  function applyScreenshotFormat(profile = {}, formatKey = "") {
    const normalized = normalizeScreenshotProfile(profile);
    const preset = getScreenshotFormatPreset(formatKey);
    return normalizeScreenshotProfile({
      ...normalized,
      width: preset.width,
      height: preset.height
    });
  }

  function cycleScreenshotFormat(profile = {}) {
    const currentKey = detectScreenshotFormatKey(profile);
    const currentIndex = Math.max(
      0,
      SCREENSHOT_FORMAT_PRESETS.findIndex((item) => item.key === currentKey)
    );
    const nextPreset = SCREENSHOT_FORMAT_PRESETS[(currentIndex + 1) % SCREENSHOT_FORMAT_PRESETS.length];
    return applyScreenshotFormat(profile, nextPreset.key);
  }

  function shiftScreenshotZoom(profile = {}, delta = 0) {
    const normalized = normalizeScreenshotProfile(profile);
    return normalizeScreenshotProfile({
      ...normalized,
      zoom: Math.max(50, Math.min(800, normalized.zoom + Number(delta || 0)))
    });
  }

  function buildSourceScopeDetails(url, metadata = {}) {
    const domain = deriveSourceDomain(url);
    const scopeKey = extractSourceScopeKey({
      domain,
      url,
      uploader: metadata?.uploader ?? "",
      uploaderUrl: metadata?.uploader_url ?? ""
    });
    return {
      domain,
      scopeKey: String(scopeKey ?? "").trim().toLowerCase(),
      isChannelScope: Boolean(scopeKey) && String(scopeKey).trim().toLowerCase() !== String(domain ?? "").trim().toLowerCase()
    };
  }

  async function getScreenshotProfilesForSource(url, metadata = {}) {
    if (typeof getSourceProfiles !== "function") return [];
    const profiles = await getSourceProfiles().catch(() => null);
    const { domain, scopeKey, isChannelScope } = buildSourceScopeDetails(url, metadata);
    const list = isChannelScope
      ? profiles?.channel_profiles?.[scopeKey]?.screenshot_profiles
      : profiles?.domain_profiles?.[domain]?.screenshot_profiles;
    return Array.isArray(list) ? list.map((item) => normalizeScreenshotProfile(item)) : [];
  }

  async function rememberSuccessfulScreenshotProfile(url, metadata = {}, profile = {}) {
    if (typeof getSourceProfiles !== "function" || typeof updateSourceProfiles !== "function") return null;
    const current = await getSourceProfiles().catch(() => null);
    if (!current || typeof current !== "object") return null;
    const { domain, scopeKey, isChannelScope } = buildSourceScopeDetails(url, metadata);
    const normalizedDomain = String(domain ?? "").trim().toLowerCase();
    const normalizedScopeKey = String(scopeKey ?? "").trim().toLowerCase();
    if (!(isChannelScope ? normalizedScopeKey : normalizedDomain)) return null;
    const normalizedProfile = normalizeScreenshotProfile({
      ...profile,
      last_used_at: new Date().toISOString()
    });
    const nextProfiles = JSON.parse(JSON.stringify(current));
    if (isChannelScope) {
      nextProfiles.channel_profiles = nextProfiles.channel_profiles && typeof nextProfiles.channel_profiles === "object"
        ? nextProfiles.channel_profiles
        : {};
      const currentProfile = nextProfiles.channel_profiles[normalizedScopeKey] ?? {};
      const existing = Array.isArray(currentProfile.screenshot_profiles) ? currentProfile.screenshot_profiles : [];
      const existingMap = new Map(existing.map((item) => [screenshotProfileKey(item), normalizeScreenshotProfile(item)]));
      const prev = existingMap.get(screenshotProfileKey(normalizedProfile)) ?? null;
      existingMap.set(screenshotProfileKey(normalizedProfile), {
        ...normalizedProfile,
        success_count: Math.max(1, Number(prev?.success_count ?? 0) + 1)
      });
      nextProfiles.channel_profiles[normalizedScopeKey] = {
        ...currentProfile,
        screenshot_profiles: [...existingMap.values()]
      };
    } else {
      nextProfiles.domain_profiles = nextProfiles.domain_profiles && typeof nextProfiles.domain_profiles === "object"
        ? nextProfiles.domain_profiles
        : {};
      const currentProfile = nextProfiles.domain_profiles[normalizedDomain] ?? {};
      const existing = Array.isArray(currentProfile.screenshot_profiles) ? currentProfile.screenshot_profiles : [];
      const existingMap = new Map(existing.map((item) => [screenshotProfileKey(item), normalizeScreenshotProfile(item)]));
      const prev = existingMap.get(screenshotProfileKey(normalizedProfile)) ?? null;
      existingMap.set(screenshotProfileKey(normalizedProfile), {
        ...normalizedProfile,
        success_count: Math.max(1, Number(prev?.success_count ?? 0) + 1)
      });
      nextProfiles.domain_profiles[normalizedDomain] = {
        ...currentProfile,
        screenshot_profiles: [...existingMap.values()]
      };
    }
    return updateSourceProfiles(nextProfiles).catch(() => null);
  }

  function dedupeScreenshotProfiles(list = []) {
    const seen = new Set();
    const result = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item) return;
      const normalized = normalizeScreenshotProfile(item);
      const key = screenshotProfileKey(normalized);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(normalized);
    });
    return result;
  }

  function buildScreenshotProfileCandidates(baseProfile = {}, successfulProfiles = []) {
    const base = normalizeScreenshotProfile(baseProfile);
    return dedupeScreenshotProfiles([
      ...successfulProfiles,
      base,
      applyScreenshotFormat(base, "standard"),
      applyScreenshotFormat(base, "square"),
      applyScreenshotFormat(base, "widescreen"),
      { width: base.width, height: base.height, zoom: Math.max(50, base.zoom - 50) },
      { width: base.width, height: base.height, zoom: Math.min(800, base.zoom + 50) },
      { width: 1280, height: 1280, zoom: base.zoom },
      { width: 1920, height: 1080, zoom: base.zoom },
      { width: 2560, height: 1440, zoom: base.zoom },
      { width: 1440, height: 1600, zoom: Math.max(50, base.zoom - 100) },
      { width: 1280, height: 1600, zoom: Math.max(50, base.zoom - 120) }
    ]);
  }

  async function createInboxAssetsFromMessage(chatId, session, message, mediaItems = []) {
    const messageText = String(message?.text ?? message?.caption ?? "").trim();
    const urls = extractUrls(messageText);
    const created = [];
    const documentId = String(session?.doc_id ?? "").trim();
    const baseContext = {
      documentId,
      role: "inbox",
      attachedBy: "telegram_sdvg"
    };

    if (Array.isArray(mediaItems) && mediaItems.length > 0) {
      for (const item of mediaItems) {
        const asset = await createAssetRecord(
          {
            kind: "telegram_media",
            status: "new",
            title: item.fileName,
            description: messageText,
            telegramChatId: String(chatId),
            telegramMessageId: String(message?.message_id ?? ""),
            telegramFileId: item.fileId,
            telegramFileUniqueId: item.fileUniqueId,
            mimeType: item.mimeType,
            fileName: item.fileName,
            processingState: "pending_segment",
            originType: "telegram_message",
            originId: String(message?.message_id ?? ""),
            meta: {
              source: "telegram_inbox",
              media_kind: item.kind
            }
          },
          baseContext
        );
        if (asset) created.push(asset);
      }
      return created;
    }

    if (urls.length > 0) {
      for (const url of urls) {
        const asset = await createAssetRecord(
          {
            kind: "link",
            status: "new",
            title: clipText(url, 180),
            description: messageText,
            sourceUrl: url,
            sourceDomain: deriveSourceDomain(url),
            telegramChatId: String(chatId),
            telegramMessageId: String(message?.message_id ?? ""),
            processingState: "pending_segment",
            originType: "telegram_message",
            originId: String(message?.message_id ?? ""),
            meta: {
              source: "telegram_inbox",
              extracted_urls: urls
            }
          },
          baseContext
        );
        if (asset) created.push(asset);
      }
      return created;
    }

    if (!messageText) return created;
    const asset = await createAssetRecord(
      {
        kind: "note",
        status: "new",
        title: clipText(messageText, 120),
        description: messageText,
        telegramChatId: String(chatId),
        telegramMessageId: String(message?.message_id ?? ""),
        processingState: "pending_segment",
        originType: "telegram_message",
        originId: String(message?.message_id ?? ""),
        meta: {
          source: "telegram_inbox"
        }
      },
      baseContext
    );
    if (asset) created.push(asset);
    return created;
  }

  async function registerSegmentMediaAssets({
    chatId,
    session,
    segment,
    relativePaths = [],
    sourceUrl = "",
    source = "downloaded_media",
    mediaStartTimecode = null,
    metadata = {}
  }) {
    const paths = Array.isArray(relativePaths) ? relativePaths.map(normalizeRelativeMediaPath).filter(Boolean) : [];
    if (paths.length === 0) return [];
    const created = [];
    for (const relativePath of paths) {
      const asset = await createAssetRecord(
        {
          kind: "downloaded_media",
          status: "processed",
          title: clipText(String(metadata?.title ?? path.basename(relativePath)), 180),
          description: String(segment?.text_quote ?? "").trim(),
          sourceUrl,
          sourceDomain: deriveSourceDomain(sourceUrl),
          telegramChatId: String(chatId ?? ""),
          fileName: path.basename(relativePath),
          localPath: relativePath,
          processingState: "attached",
          originType: "sdvg_segment",
          originId: String(segment?.segment_id ?? ""),
          meta: {
            source,
            media_start_timecode: normalizeMediaStartTimecodeValue(mediaStartTimecode),
            section_title: String(segment?.section_title ?? "").trim(),
            uploader: metadata?.uploader ?? "",
            uploader_url: metadata?.uploader_url ?? "",
            webpage_url: metadata?.webpage_url ?? "",
            format_note: metadata?.format_note ?? "",
            resolution: metadata?.resolution ?? ""
          }
        },
        {
          documentId: session?.doc_id,
          segmentId: segment?.segment_id,
          role: "visual",
          attachedBy: "telegram_sdvg"
        }
      );
      if (asset) created.push(asset);
    }
    return created;
  }

  function acquireCardActionLock(session, messageId, action) {
    if (!session) return null;
    const key = `${String(messageId ?? "na")}:${String(action ?? "action")}`;
    if (session.card_action_locks.has(key)) return null;
    session.card_action_locks.add(key);
    return key;
  }

  function releaseCardActionLock(session, lockKey) {
    if (!session || !lockKey) return;
    session.card_action_locks.delete(lockKey);
  }

  function rememberCardContext(session, messageId, context) {
    if (!session || messageId == null) return;
    const key = String(messageId);
    session.card_contexts.set(key, {
      doc_id: context.doc_id,
      segment_id: context.segment_id,
      created_at: Date.now()
    });
    if (session.card_contexts.size <= CARD_CONTEXT_MAX) return;
    const items = Array.from(session.card_contexts.entries()).sort((a, b) => {
      const left = Number(a?.[1]?.created_at ?? 0);
      const right = Number(b?.[1]?.created_at ?? 0);
      return left - right;
    });
    while (items.length > CARD_CONTEXT_MAX) {
      const item = items.shift();
      if (!item) break;
      session.card_contexts.delete(item[0]);
    }
  }

  function getCardContext(session, messageId) {
    if (!session || messageId == null) return null;
    const context = session.card_contexts.get(String(messageId));
    return context ?? null;
  }

  function forgetCardContext(session, messageId) {
    if (!session || messageId == null) return;
    const key = String(messageId);
    session.card_contexts.delete(key);
    session.file_picker_contexts.delete(key);
  }

  function buildSdvgEncouragementKeyboard() {
    return {
      inline_keyboard: [[{ text: "X", callback_data: "sdvg_cheer:mute" }]]
    };
  }

  function buildSdvgEncouragementText(remainingCount = 0) {
    const count = Math.max(0, Number(remainingCount) || 0);
    if (count <= 0) return "Все незакрытые сегменты закончились.";
    const countLabel =
      count % 10 === 1 && count % 100 !== 11
        ? "сегмент"
        : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
          ? "сегмента"
          : "сегментов";
    const variants = [
      `Осталось ${count} незакрытых ${countLabel}. Темп хороший.`,
      `Еще ${count} ${countLabel} до закрытия очереди. Идем дальше.`,
      `В работе осталось ${count} ${countLabel}. Уже близко.`,
      `${count} ${countLabel} еще ждут. Дожимай.`
    ];
    return variants[count % variants.length];
  }

  async function clearSdvgEncouragementMessage(chatId, session) {
    if (!session?.sdvg_encouragement_message_id) return;
    const messageId = Number(session.sdvg_encouragement_message_id) || 0;
    session.sdvg_encouragement_message_id = null;
    if (!messageId) return;
    await deleteMessage(chatId, messageId).catch(() => null);
  }

  function getRandomSdvgCheerDelayMs() {
    const min = Math.max(60 * 1000, Number(SDVG_CHEER_MIN_DELAY_MS) || 0);
    const max = Math.max(min, Number(SDVG_CHEER_MAX_DELAY_MS) || min);
    return Math.round(min + (Math.random() * (max - min)));
  }

  function scheduleNextSdvgEncouragement(session, baseTime = Date.now()) {
    if (!session) return 0;
    const nextAt = Number(baseTime || Date.now()) + getRandomSdvgCheerDelayMs();
    session.sdvg_cheer_next_at = nextAt;
    return nextAt;
  }

  async function sendSdvgEncouragementMessage(chatId, session, remainingCount) {
    if (!session || session.sdvg_cheer_muted) return null;
    await clearSdvgEncouragementMessage(chatId, session);
    const sent = await sendMessage(chatId, buildSdvgEncouragementText(remainingCount), {
      reply_markup: buildSdvgEncouragementKeyboard()
    }).catch(() => null);
    session.sdvg_encouragement_message_id = Number(sent?.message_id ?? 0) || null;
    scheduleNextSdvgEncouragement(session);
    return sent;
  }

  async function maybeSendSdvgEncouragementMessage(chatId, session, remainingCount) {
    if (!session || session.sdvg_cheer_muted) return null;
    const now = Date.now();
    const nextAt = Number(session.sdvg_cheer_next_at ?? 0) || 0;
    if (!nextAt) {
      scheduleNextSdvgEncouragement(session, now);
      return null;
    }
    if (now < nextAt) return null;
    return sendSdvgEncouragementMessage(chatId, session, remainingCount);
  }

  function rememberScreenshotPreviewContext(session, messageId, context) {
    if (!session || messageId == null || !context) return;
    const key = String(messageId);
    session.screenshot_preview_contexts.set(key, {
      ...context,
      created_at: Date.now()
    });
    if (session.screenshot_preview_contexts.size <= SCREENSHOT_PREVIEW_CONTEXT_MAX) return;
    const items = Array.from(session.screenshot_preview_contexts.entries()).sort((a, b) => {
      const left = Number(a?.[1]?.created_at ?? 0);
      const right = Number(b?.[1]?.created_at ?? 0);
      return left - right;
    });
    while (items.length > SCREENSHOT_PREVIEW_CONTEXT_MAX) {
      const item = items.shift();
      if (!item) break;
      session.screenshot_preview_contexts.delete(item[0]);
    }
  }

  function getScreenshotPreviewContext(session, messageId) {
    if (!session || messageId == null) return null;
    return session.screenshot_preview_contexts.get(String(messageId)) ?? null;
  }

  function forgetScreenshotPreviewContext(session, messageId) {
    if (!session || messageId == null) return;
    session.screenshot_preview_contexts.delete(String(messageId));
  }

  function rememberResearchSuggestionContext(session, messageId, context) {
    if (!session || messageId == null || !context) return;
    const key = String(messageId);
    session.research_suggestion_contexts.set(key, {
      ...context,
      created_at: Date.now()
    });
    if (session.research_suggestion_contexts.size <= RESEARCH_SUGGESTION_CONTEXT_MAX) return;
    const items = Array.from(session.research_suggestion_contexts.entries()).sort((a, b) => {
      const left = Number(a?.[1]?.created_at ?? 0);
      const right = Number(b?.[1]?.created_at ?? 0);
      return left - right;
    });
    while (items.length > RESEARCH_SUGGESTION_CONTEXT_MAX) {
      const item = items.shift();
      if (!item) break;
      session.research_suggestion_contexts.delete(item[0]);
    }
  }

  function getResearchSuggestionContext(session, messageId) {
    if (!session || messageId == null) return null;
    return session.research_suggestion_contexts.get(String(messageId)) ?? null;
  }

  function forgetResearchSuggestionContext(session, messageId) {
    if (!session || messageId == null) return;
    session.research_suggestion_contexts.delete(String(messageId));
  }

  function listResearchSuggestionEntriesForCard(session, cardMessageId) {
    if (!session || cardMessageId == null) return [];
    const targetCardMessageId = String(cardMessageId);
    return Array.from(session.research_suggestion_contexts.entries()).filter(
      ([, context]) => String(context?.card_message_id ?? "") === targetCardMessageId
    );
  }

  function rememberResearchStatusMessage(session, cardMessageId, messageId) {
    if (!session || cardMessageId == null || messageId == null) return;
    session.research_status_message_ids.set(String(cardMessageId), String(messageId));
  }

  function forgetResearchStatusMessage(session, cardMessageId) {
    if (!session || cardMessageId == null) return null;
    const key = String(cardMessageId);
    const stored = session.research_status_message_ids.get(key) ?? null;
    session.research_status_message_ids.delete(key);
    return stored;
  }

  async function clearResearchStatusMessageForCard(chatId, session, cardMessageId) {
    const messageId = forgetResearchStatusMessage(session, cardMessageId);
    if (!messageId) return;
    await deleteMessage(chatId, Number(messageId)).catch(() => null);
  }

  function rememberFilePickerContext(session, messageId, context) {
    if (!session || messageId == null || !context) return;
    const key = String(messageId);
    session.file_picker_contexts.set(key, {
      ...context,
      created_at: Date.now()
    });
    if (session.file_picker_contexts.size <= FILE_PICKER_CONTEXT_MAX) return;
    const items = Array.from(session.file_picker_contexts.entries()).sort((a, b) => {
      const left = Number(a?.[1]?.created_at ?? 0);
      const right = Number(b?.[1]?.created_at ?? 0);
      return left - right;
    });
    while (items.length > FILE_PICKER_CONTEXT_MAX) {
      const item = items.shift();
      if (!item) break;
      session.file_picker_contexts.delete(item[0]);
    }
  }

  function getFilePickerContext(session, messageId) {
    if (!session || messageId == null) return null;
    return session.file_picker_contexts.get(String(messageId)) ?? null;
  }

  function forgetFilePickerContext(session, messageId) {
    if (!session || messageId == null) return;
    session.file_picker_contexts.delete(String(messageId));
  }

  async function withDocumentLock(docId, fn) {
    const key = String(docId ?? "").trim();
    if (!key) return fn();
    const previous = state.documentLocks.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => null)
      .then(() => fn());
    state.documentLocks.set(key, run);
    try {
      return await run;
    } finally {
      if (state.documentLocks.get(key) === run) {
        state.documentLocks.delete(key);
      }
    }
  }

  async function telegramApiCall(method, payload = {}, timeoutMs = 35000) {
    if (!apiBase) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const raw = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Telegram ${method} returned non-JSON response`);
      }
      if (!response.ok || !parsed?.ok) {
        const reason = parsed?.description || `HTTP ${response.status}`;
        throw new Error(`Telegram ${method} failed: ${reason}`);
      }
      return parsed.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendMessage(chatId, text, extra = {}) {
    return telegramApiCall("sendMessage", {
      chat_id: chatId,
      text: clipText(text, TELEGRAM_MESSAGE_MAX),
      disable_web_page_preview: true,
      ...extra
    });
  }

  function formatBytes(value) {
    const size = Number(value ?? 0);
    if (!Number.isFinite(size) || size <= 0) return "0 B";
    if (size < 1024) return `${size} B`;
    const kb = size / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clipLabel(value, maxLength = 140) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
  }

  function parseTitleFromFileName(fileName) {
    const name = String(fileName ?? "").trim();
    if (!name) return "";
    const withoutExt = name.replace(/\.[^.]+$/g, "");
    const withoutId = withoutExt.replace(/\s*\[[^\]]+\]\s*$/g, "");
    return withoutId.trim();
  }

  function cleanupCaptionText(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksCorruptedText(value) {
    const text = String(value ?? "");
    if (!text) return false;
    const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
    if (replacementCount >= 10) return true;
    if (replacementCount >= 3 && replacementCount / Math.max(1, text.length) >= 0.05) return true;
    return false;
  }

  function extractHostLabel(rawUrl) {
    const value = String(rawUrl ?? "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      return String(parsed.hostname ?? "").replace(/^www\./i, "").trim();
    } catch {
      return "";
    }
  }

  function buildSafeMediaTitle({ metadataTitle, fileName, sourceUrl, isVideo }) {
    const cleanedMetaTitle = cleanupCaptionText(metadataTitle);
    if (cleanedMetaTitle && !looksCorruptedText(cleanedMetaTitle)) {
      return cleanedMetaTitle;
    }

    const parsedFromFile = cleanupCaptionText(parseTitleFromFileName(fileName) || fileName);
    if (parsedFromFile && !looksCorruptedText(parsedFromFile)) {
      return parsedFromFile;
    }

    const host = extractHostLabel(sourceUrl);
    if (host) {
      return isVideo ? `Видео из ${host}` : `Файл из ${host}`;
    }
    return "Скачанный файл";
  }

  function normalizeUploaderLabel(value) {
    const raw = cleanupCaptionText(value).replace(/^@+/, "");
    if (!raw) return "";
    if (looksCorruptedText(raw)) return "";
    const compact = raw.replace(/\s+/g, "_");
    return compact.startsWith("#") ? compact : `#${compact}`;
  }

  function extractExplicitQualityLabel(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const directMatch = raw.match(/(?:^|[\s,/_-])((?:\d{3,4})p)(?:$|[\s,/_-])/i);
    if (directMatch?.[1]) return directMatch[1].toLowerCase();

    const resolutionMatch = raw.match(/(\d{2,5})x(\d{2,5})/i);
    if (resolutionMatch) {
      const width = Number(resolutionMatch[1]);
      const height = Number(resolutionMatch[2]);
      const shortSide = Math.min(width, height);
      if (Number.isFinite(shortSide) && shortSide >= 144) {
        return `${shortSide}p`;
      }
    }

    const normalized = raw.toLowerCase();
    if (normalized.includes("4320") || normalized.includes("8k")) return "4320p";
    if (normalized.includes("2160") || normalized.includes("4k")) return "2160p";
    if (normalized.includes("1440")) return "1440p";
    if (normalized.includes("1080") || normalized.includes("full hd") || normalized.includes("fhd")) return "1080p";
    if (normalized.includes("720") || normalized.includes(" hd")) return "720p";
    if (normalized.includes("480")) return "480p";
    if (normalized.includes("360")) return "360p";
    if (normalized.includes("240")) return "240p";
    if (normalized.includes("144")) return "144p";
    return "";
  }

  function deriveQualityLabel({ formatNote, resolution, fileName, isVideo }) {
    const fromResolution = extractExplicitQualityLabel(resolution);
    if (fromResolution) return fromResolution;

    const fromName = extractExplicitQualityLabel(fileName);
    if (fromName) return fromName;

    const fromNote = extractExplicitQualityLabel(formatNote);
    if (fromNote) return fromNote;

    return isVideo ? "Видео" : "Файл";
  }

  function buildReturnedMediaCaption({ fileName, sourceUrl, sizeBytes, isVideo, metadata = {} }) {
    const mediaUrl = String(metadata?.webpage_url ?? sourceUrl ?? "").trim();
    const uploaderUrl = String(metadata?.uploader_url ?? mediaUrl).trim();
    const title = clipLabel(
      buildSafeMediaTitle({
        metadataTitle: metadata?.title,
        fileName,
        sourceUrl: mediaUrl || sourceUrl,
        isVideo
      }),
      160
    );
    const uploader = clipLabel(normalizeUploaderLabel(metadata?.uploader), 80);
    const quality = clipLabel(
      deriveQualityLabel({
        formatNote: metadata?.format_note,
        resolution: metadata?.resolution,
        fileName,
        isVideo
      }),
      30
    );

    const lines = [];
    if (mediaUrl) {
      lines.push(`📹 <a href="${escapeHtml(mediaUrl)}">${escapeHtml(title)}</a> →`);
    } else {
      lines.push(`📹 ${escapeHtml(title)}`);
    }
    if (uploader) {
      if (uploaderUrl) {
        lines.push(`👤 <a href="${escapeHtml(uploaderUrl)}">${escapeHtml(uploader)}</a> →`);
      } else {
        lines.push(`👤 ${escapeHtml(uploader)}`);
      }
    }
    lines.push("", `📹${escapeHtml(quality)}`, `📏 ${escapeHtml(formatBytes(sizeBytes))}`);

    let caption = lines.join("\n");
    if (caption.length > TELEGRAM_CAPTION_MAX) {
      const fallbackTitle = clipLabel(title, 90);
      caption = `📹 ${fallbackTitle}\n📏 ${formatBytes(sizeBytes)}`;
    }
    return caption;
  }

  async function sendDownloadedMediaBackToChat(chatId, segmentId, sourceUrl, mediaPaths = [], metadata = null, options = {}) {
    if (!chatId) return;
    const mediaRoot = path.resolve(getMediaDir());
    const sourceMessageId = Number(options?.sourceMessageId ?? 0) || null;
    const deleteSourceMessage = Boolean(options?.deleteSourceMessage) && sourceMessageId;
    const unique = Array.from(
      new Set(
        (Array.isArray(mediaPaths) ? mediaPaths : [])
          .map((item) => normalizeRelativeMediaPath(item))
          .filter(Boolean)
      )
    );
    let sentCount = 0;

    for (const relativePath of unique) {
      const absolutePath = path.resolve(mediaRoot, relativePath.replace(/\//g, path.sep));
      const insideMediaRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
      if (!insideMediaRoot) continue;
      if (!(await fileExists(absolutePath))) continue;

      const stats = await fs.stat(absolutePath).catch(() => null);
      const fileName = path.basename(absolutePath);
      const isVideo = isVideoFilePath(fileName);
      const caption = buildReturnedMediaCaption({
        fileName,
        sourceUrl,
        sizeBytes: stats?.size ?? 0,
        isVideo,
        metadata: metadata ?? {}
      });
      const method = isVideo ? "sendVideo" : "sendDocument";
      const fileField = isVideo ? "video" : "document";
      const payload = {
        chat_id: chatId,
        caption,
        parse_mode: "HTML"
      };
      if (isVideo) payload.supports_streaming = true;

      await telegramApiCallMultipart(method, payload, fileField, absolutePath, fileName, 180000)
        .then(() => {
          sentCount += 1;
        })
        .catch(async (error) => {
          await sendMessage(
            chatId,
            `\u0424\u0430\u0439\u043B \u0441\u043A\u0430\u0447\u0430\u043D, \u043D\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E: ${fileName} (${error?.message ?? error})`
          ).catch(() => null);
        });
    }

    if (deleteSourceMessage && sentCount > 0) {
      await deleteMessage(chatId, sourceMessageId).catch(() => null);
    }
    if (sentCount === 0 && unique.length > 0) {
      await sendMessage(
        chatId,
        `Файл скачан, но не получилось отправить обратно из media storage. Проверь путь: ${unique[0]}`
      ).catch(() => null);
    }
  }

  function getLocalBackendOrigin() {
    const port = Math.max(1, Number(process.env.PORT ?? 8787) || 8787);
    return `http://127.0.0.1:${port}`;
  }

  function buildScreenshotPreviewKeyboard() {
    return {
      inline_keyboard: [[
        { text: "+", callback_data: "sdvg_shot:add" },
        { text: "-", callback_data: "sdvg_shot:drop" },
        { text: "✖️", callback_data: "sdvg_shot:refresh" }
      ]]
    };
  }

  function buildScreenshotPreviewCaption(url, profile = {}, metadata = {}) {
    const host = deriveSourceDomain(url) || "source";
    const title = clipLabel(String(metadata?.title ?? "").trim() || host, 90);
    return [
      `📸 <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
      `🖥 ${escapeHtml(formatScreenshotProfile(profile))}`
    ].join("\n");
  }

  function buildScreenshotPreviewKeyboardV2() {
    return {
      inline_keyboard: [
        [
          { text: "🌐", callback_data: "sdvg_shot:format" },
          { text: "🔎⬆️", callback_data: "sdvg_shot:zoom_in" },
          { text: "🔎⬇️", callback_data: "sdvg_shot:zoom_out" }
        ],
        [
          { text: "+", callback_data: "sdvg_shot:add" },
          { text: "-", callback_data: "sdvg_shot:drop" },
          { text: "✖️", callback_data: "sdvg_shot:refresh" }
        ]
      ]
    };
  }

  function buildScreenshotPreviewCaptionV2(url, profile = {}, metadata = {}) {
    const host = deriveSourceDomain(url) || "source";
    const title = clipLabel(String(metadata?.title ?? "").trim() || host, 90);
    const formatPreset = getScreenshotFormatPreset(detectScreenshotFormatKey(profile));
    return [
      `📸 <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
      `🖥 ${escapeHtml(formatScreenshotProfile(profile))} • ${escapeHtml(formatPreset.label)}`
    ].join("\n");
  }

  async function captureLinkScreenshotForBot(url, profile = {}) {
    const hasExplicitProfile =
      Number.isFinite(Number(profile?.width)) &&
      Number.isFinite(Number(profile?.height)) &&
      Number.isFinite(Number(profile?.zoom));
    const normalizedProfile = hasExplicitProfile ? normalizeScreenshotProfile(profile) : null;
    const query = new URLSearchParams({
      url,
      v: String(Date.now())
    });
    if (normalizedProfile) {
      query.set("width", String(normalizedProfile.width));
      query.set("height", String(normalizedProfile.height));
      query.set("zoom", String(normalizedProfile.zoom));
    }
    query.set("reset_browser_zoom", "1");
    const response = await fetch(`${getLocalBackendOrigin()}/api/link/screenshot?${query.toString()}`, {
      headers: { accept: "image/png,image/*;q=0.9,*/*;q=0.8" }
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `Screenshot failed: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Screenshot returned empty body");
    return {
      buffer,
      profile: normalizeScreenshotProfile({
        width: Number(response.headers.get("x-link-screenshot-width")) || normalizedProfile?.width || 2560,
        height: Number(response.headers.get("x-link-screenshot-height")) || normalizedProfile?.height || 1280,
        zoom: Number(response.headers.get("x-link-screenshot-zoom")) || normalizedProfile?.zoom || 400
      }),
      source: String(response.headers.get("x-link-screenshot-source") ?? "").trim()
    };
  }

  async function sendScreenshotPreviewMessage(chatId, session, previewContext) {
    const tempFilePath = path.join(
      os.tmpdir(),
      `utshot_${Date.now()}_${Math.random().toString(16).slice(2, 10)}.png`
    );
    try {
      const captured = await captureLinkScreenshotForBot(previewContext.url, previewContext.profile);
      await fs.writeFile(tempFilePath, captured.buffer);
      const result = await telegramApiCallMultipart(
        "sendPhoto",
        {
          chat_id: chatId,
          caption: buildScreenshotPreviewCaptionV2(previewContext.url, captured.profile, previewContext.metadata),
          parse_mode: "HTML",
          reply_markup: buildScreenshotPreviewKeyboardV2()
        },
        "photo",
        tempFilePath,
        "screenshot.png",
        180000
      );
      rememberScreenshotPreviewContext(session, result?.message_id, {
        ...previewContext,
        profile: captured.profile
      });
      return result;
    } finally {
      await fs.unlink(tempFilePath).catch(() => null);
    }
  }

  async function saveScreenshotPreviewToSegment(chatId, session, segment, previewContext) {
    const captured = await captureLinkScreenshotForBot(previewContext.url, previewContext.profile);
    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? segment?.segment_id ?? "SCREENSHOTS");
    const outputDir = await ensureMediaDir(sectionTitle);
    const host = deriveSourceDomain(previewContext.url) || "screenshot";
    const fileStamp = formatFileDateTimeSuffix();
    const targetPath = await ensureUniqueFilePath(
      outputDir,
      `${sanitizeFileName(`${host}_${fileStamp}`, "screenshot")}.png`
    );
    await fs.writeFile(targetPath, captured.buffer);
    const mediaRoot = path.resolve(getMediaDir());
    const relativePath = normalizeRelativeMediaPath(path.relative(mediaRoot, targetPath));
    await appendSegmentMediaPaths(
      session.doc_id,
      segment.segment_id,
      [relativePath],
      chatId,
      "telegram_screenshot_preview"
    );
    await createAssetRecord(
      {
        kind: "screenshot",
        status: "processed",
        title: clipText(`Screenshot ${host}`, 180),
        description: previewContext.url,
        sourceUrl: previewContext.url,
        sourceDomain: host,
        telegramChatId: String(chatId),
        fileName: path.basename(targetPath),
        localPath: relativePath,
        screenshotPath: relativePath,
        processingState: "attached",
        originType: "sdvg_link_screenshot",
        originId: String(segment?.segment_id ?? ""),
        meta: {
          source: "telegram_sdvg_screenshot",
          section_title: String(segment?.section_title ?? "").trim(),
          captured_from_url: previewContext.url,
          screenshot_profile: captured.profile
        }
      },
      {
        documentId: session?.doc_id,
        segmentId: segment?.segment_id,
        role: "visual",
        attachedBy: "telegram_sdvg"
      }
    );
    return {
      absolutePath: targetPath,
      relativePath,
      fileName: path.basename(targetPath),
      profile: captured.profile
    };
  }

  async function sendSavedScreenshotBackToChat(chatId, saved = {}, previewContext = {}) {
    const absolutePath = String(saved?.absolutePath ?? "").trim();
    if (!absolutePath) return null;
    if (!(await fileExists(absolutePath))) return null;
    const fileName = String(saved?.fileName ?? path.basename(absolutePath) ?? "screenshot.png").trim() || "screenshot.png";
    return telegramApiCallMultipart(
      "sendDocument",
      {
        chat_id: chatId,
        caption: buildScreenshotPreviewCaptionV2(
          previewContext?.url ?? "",
          saved?.profile ?? previewContext?.profile ?? {},
          previewContext?.metadata ?? {}
        ),
        parse_mode: "HTML"
      },
      "document",
      absolutePath,
      fileName,
      180000
    );
  }

  async function editMessage(chatId, messageId, text, extra = {}) {
    try {
      return await telegramApiCall("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: clipText(text, TELEGRAM_MESSAGE_MAX),
        disable_web_page_preview: true,
        ...extra
      });
    } catch (error) {
      const message = String(error?.message ?? "");
      if (message.toLowerCase().includes("message is not modified")) {
        return null;
      }
      throw error;
    }
  }

  async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    return telegramApiCall("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  }

  async function deleteMessage(chatId, messageId) {
    if (chatId == null || messageId == null) return null;
    return telegramApiCall("deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
  }

  async function answerCallback(callbackId, text = "", showAlert = false) {
    if (!callbackId) return null;
    return telegramApiCall("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: clipText(text, CALLBACK_ALERT_MAX),
      show_alert: Boolean(showAlert)
    });
  }

  async function readDocPayload(docId) {
    const document = await loadDocumentStateForBot(docId);
    if (!document) return null;
    const [segments, decisions] = await Promise.all([loadSegmentsForBot(docId), loadDecisionsForBot(docId)]);
    return {
      document,
      segments: normalizeSegmentList(segments),
      decisions: Array.isArray(decisions) ? decisions : []
    };
  }

  function canonicalizeBotUrl(url) {
    const normalized = typeof normalizeLinkUrl === "function" ? normalizeLinkUrl(url) : String(url ?? "").trim();
    if (!normalized) return "";
    if (typeof canonicalizeLinkUrl === "function") {
      return canonicalizeLinkUrl(normalized) || normalized;
    }
    try {
      return new URL(normalized).toString();
    } catch {
      return normalized;
    }
  }

  function dedupeResearchResults(results = []) {
    const seen = new Set();
    return (Array.isArray(results) ? results : []).filter((item) => {
      const key = canonicalizeBotUrl(item?.url);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function filterBlockedResearchResults(results = [], sourceProfiles = {}) {
    return (Array.isArray(results) ? results : []).filter(
      (item) => !isBlockedResearchDomain(item?.domain, sourceProfiles)
    );
  }

  function collectDocumentLinkKeys(segments = []) {
    const seen = new Set();
    (Array.isArray(segments) ? segments : []).forEach((segment) => {
      if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") return;
      (Array.isArray(segment?.links) ? segment.links : []).forEach((item) => {
        const key = canonicalizeBotUrl(item?.url ?? item);
        if (key) seen.add(key);
      });
    });
    return seen;
  }

  function collectSeenResearchRunKeys(runs = []) {
    const seen = new Set();
    (Array.isArray(runs) ? runs : []).forEach((run) => {
      (Array.isArray(run?.results) ? run.results : []).forEach((item) => {
        const key = canonicalizeBotUrl(item?.url);
        if (key) seen.add(key);
      });
    });
    return seen;
  }

  const SDVG_LEADING_NUMBERED_LINE_RE = /^\s*\d{1,3}[.)]\s*\S/;
  const SDVG_COMMENT_NUMBER_PREFIX_RE = /^\s*\d{1,3}[.)]\s*/;
  const SDVG_COMMENT_DATE_ONLY_RE = /^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*$/;
  const SDVG_COMMENT_INLINE_NUMBER_TEST_RE = /(?:^|[\s\n])\d{1,3}[.)]\s*/;
  const SDVG_COMMENT_TRAILING_NUMBER_RE = /\b\d{1,3}[.)]\s*$/;

  function normalizeSdvgLineBreaks(text) {
    return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function normalizeSdvgCommentLineForCompare(value) {
    return normalizeSdvgLineBreaks(value)
      .replace(SDVG_COMMENT_NUMBER_PREFIX_RE, "")
      .replace(/^[/\\-]+\s*/g, "")
      .replace(/[«»"“”'`]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getSdvgSectionKey(segment = {}) {
    const sectionId = String(segment?.section_id ?? "").trim();
    const title = normalizeSdvgLineBreaks(segment?.section_title ?? "")
      .replace(/^#{1,}\s*/g, " ")
      .replace(/[«»"“”'`]+/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (sectionId) return `id:${sectionId}`;
    if (title) return `title:${title}`;
    return "untitled";
  }

  function isSdvgCommentsSegment(segment = {}) {
    return /^comments_/i.test(String(segment?.segment_id ?? "").trim());
  }

  function extractSdvgInlineNumberedCommentItems(text) {
    const normalized = normalizeSdvgLineBreaks(text);
    const markerRe = /(^|[\s\n])(\d{1,3})[.)]\s*/g;
    const markers = [];
    let match = markerRe.exec(normalized);
    while (match) {
      const markerStart = match.index + String(match[1] ?? "").length;
      markers.push({
        markerStart,
        contentStart: markerRe.lastIndex
      });
      match = markerRe.exec(normalized);
    }
    if (markers.length === 0) return [];
    const items = [];
    for (let index = 0; index < markers.length; index += 1) {
      const start = markers[index].contentStart;
      const end = index + 1 < markers.length ? markers[index + 1].markerStart : normalized.length;
      const content = normalized
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim();
      if (!content || SDVG_COMMENT_DATE_ONLY_RE.test(content)) continue;
      items.push(content);
    }
    return items;
  }

  function appendSdvgSectionComment(map, sectionKey, text) {
    const normalized = normalizeSdvgLineBreaks(text).trim();
    if (!normalized) return;
    const existing = String(map.get(sectionKey) ?? "").trim();
    map.set(sectionKey, existing ? `${existing}\n${normalized}` : normalized);
  }

  function buildSdvgDisplaySegments(segments = []) {
    const source = Array.isArray(segments) ? segments : [];
    const pendingCommentsBySection = new Map();
    const visible = [];
    let index = 0;

    while (index < source.length) {
      const segment = source[index];
      const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
      if (blockType === "links") {
        index += 1;
        continue;
      }

      const sectionKey = getSdvgSectionKey(segment);
      if (isSdvgCommentsSegment(segment)) {
        appendSdvgSectionComment(pendingCommentsBySection, sectionKey, segment?.text_quote ?? "");
        index += 1;
        continue;
      }

      const leadWindow = [segment];
      let cursor = index + 1;
      while (cursor < source.length && leadWindow.length < 4) {
        const next = source[cursor];
        const nextBlockType = String(next?.block_type ?? "").trim().toLowerCase();
        if (nextBlockType === "links" || isSdvgCommentsSegment(next)) break;
        if (getSdvgSectionKey(next) !== sectionKey) break;
        const windowText = leadWindow.map((item) => String(item?.text_quote ?? "")).join("\n");
        const hasNumberInWindow = SDVG_COMMENT_INLINE_NUMBER_TEST_RE.test(windowText);
        const lastText = String(leadWindow[leadWindow.length - 1]?.text_quote ?? "").trim();
        const nextText = String(next?.text_quote ?? "").trim();
        const shouldAttach =
          SDVG_COMMENT_INLINE_NUMBER_TEST_RE.test(nextText) || SDVG_COMMENT_TRAILING_NUMBER_RE.test(lastText);
        if (!hasNumberInWindow || !shouldAttach) break;
        leadWindow.push(next);
        cursor += 1;
      }

      if (leadWindow.length >= 2) {
        const combinedLeadText = leadWindow.map((item) => String(item?.text_quote ?? "")).join("\n");
        const extractedItems = extractSdvgInlineNumberedCommentItems(combinedLeadText);
        const combinedNorm = normalizeSdvgCommentLineForCompare(combinedLeadText);
        const extractedNorm = normalizeSdvgCommentLineForCompare(extractedItems.join(" "));
        const averageLen =
          leadWindow.reduce((sum, item) => sum + String(item?.text_quote ?? "").trim().length, 0) / leadWindow.length;
        const coverage = combinedNorm ? extractedNorm.length / combinedNorm.length : 0;
        const looksLikeCommentLead = extractedItems.length >= 2 && averageLen <= 160 && coverage >= 0.52;
        if (looksLikeCommentLead) {
          const commentsText = extractedItems.map((item, idx) => `${idx + 1}. ${item}`).join("\n");
          appendSdvgSectionComment(pendingCommentsBySection, sectionKey, commentsText);
          index = cursor;
          continue;
        }
      }

      const pendingComment = String(pendingCommentsBySection.get(sectionKey) ?? "").trim();
      if (pendingComment) {
        visible.push({ ...segment, sdvg_comment: pendingComment });
        pendingCommentsBySection.delete(sectionKey);
      } else {
        visible.push(segment);
      }
      index += 1;
    }

    return visible;
  }

  function findSdvgDisplaySegment(segments = [], segmentId = "") {
    const normalizedId = String(segmentId ?? "").trim();
    if (!normalizedId) return null;
    return (
      buildSdvgDisplaySegments(segments).find((item) => String(item?.segment_id ?? "") === normalizedId) ??
      (Array.isArray(segments) ? segments : []).find((item) => String(item?.segment_id ?? "") === normalizedId) ??
      null
    );
  }

  function getOpenSegments(segments) {
    return buildSdvgDisplaySegments(segments).filter((segment) => !Boolean(segment?.is_done));
  }

  function resolveComment(segment, decision) {
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    return String(
      segment?.sdvg_comment ||
      segment?.comment ||
      segment?.comments ||
      decision?.comment ||
      decision?.comments ||
      visual.description ||
      ""
    ).trim();
  }

  function collectCurrentResearchSuggestionKeys(session, cardMessageId, excludedMessageId = null) {
    const seen = new Set();
    listResearchSuggestionEntriesForCard(session, cardMessageId).forEach(([messageId, context]) => {
      if (excludedMessageId != null && String(messageId) === String(excludedMessageId)) return;
      const key = String(context?.current_key ?? "").trim();
      if (key) seen.add(key);
    });
    return seen;
  }

  async function clearResearchSuggestionMessagesForCard(chatId, session, cardMessageId) {
    const entries = listResearchSuggestionEntriesForCard(session, cardMessageId);
    for (const [messageId] of entries) {
      forgetResearchSuggestionContext(session, messageId);
      await deleteMessage(chatId, Number(messageId)).catch(() => null);
    }
  }

  function buildResearchProgressTopic(segment = {}) {
    const sectionTitle = clipText(String(segment?.section_title ?? "").replace(/\s+/g, " ").trim(), 80);
    return sectionTitle || clipText(String(segment?.segment_id ?? "").trim(), 48) || "сегмент";
  }

  async function fetchSegmentResearchCandidates(docId, segment, decision, extraExcludedKeys = new Set(), onProgress = null) {
    if (
      typeof generateSegmentResearchQueries !== "function" ||
      typeof searchQueries !== "function" ||
      typeof rankSegmentResearchResults !== "function" ||
      typeof mergeResearchScores !== "function"
    ) {
      return [];
    }
    const topicLabel = buildResearchProgressTopic(segment);
    await notifyResearchProgress(onProgress, `🔎 Готовлю поиск для: ${topicLabel}`);
    const [rawSegments, sourceProfiles, sourceMemory, previousRuns] = await Promise.all([
      loadSegmentsForBot(docId),
      typeof getSourceProfiles === "function" ? getSourceProfiles().catch(() => ({})) : Promise.resolve({}),
      typeof getSourceMemory === "function" ? getSourceMemory().catch(() => ({})) : Promise.resolve({}),
      typeof listRunsForSegment === "function" ? listRunsForSegment(docId, segment?.segment_id, { limit: 40 }).catch(() => []) : Promise.resolve([])
    ]);
    const excludedKeys = new Set([
      ...collectDocumentLinkKeys(rawSegments),
      ...collectSeenResearchRunKeys(previousRuns),
      ...(extraExcludedKeys instanceof Set ? [...extraExcludedKeys] : [])
    ]);
    const rankingSegment = await enrichSegmentWithTranslatedText(
      segment,
      {
        visual_decision: decision?.visual_decision,
        search_decision: decision?.search_decision
      },
      translateHeadingToEnglishQuery
    );
    await notifyResearchProgress(onProgress, `🔎 Собираю запросы для: ${topicLabel}`);
    const queries = await generateSegmentResearchQueries(rankingSegment, { mode: "deep" });
    await notifyResearchProgress(onProgress, `🔎 Ищу материалы для: ${topicLabel}`);
    const searchResult = await searchQueries(queries, { mode: "deep" });
    const filteredResults = filterBlockedResearchResults(dedupeResearchResults(searchResult?.results), sourceProfiles).filter((item) => {
      const key = canonicalizeBotUrl(item?.url);
      return key && !excludedKeys.has(key);
    });
    if (!filteredResults.length) return [];
    await notifyResearchProgress(onProgress, `🔎 Нашёл ${filteredResults.length} кандидатов для: ${topicLabel}`);
    const llmScores = await rankSegmentResearchResults(rankingSegment, filteredResults, sourceProfiles);
    const rankedResults = mergeResearchScores(filteredResults, llmScores, sourceProfiles, sourceMemory, {
      section_title: segment?.section_title,
      research_use_topic_title: Boolean(segment?.research_use_topic_title),
      research_use_theme_tags: Boolean(segment?.research_use_theme_tags),
      text_quote: segment?.text_quote,
      translated_text_quote: rankingSegment.translated_text_quote ?? "",
      visual_description: rankingSegment?.visual_decision?.description ?? "",
      search_queries: Array.isArray(rankingSegment?.search_decision?.queries) ? rankingSegment.search_decision.queries : [],
      search_keywords: Array.isArray(rankingSegment?.search_decision?.keywords) ? rankingSegment.search_decision.keywords : []
    });
    const resultMap = new Map(
      filteredResults.map((item) => [String(item?.id ?? "").trim(), item]).filter(([id]) => Boolean(id))
    );
    return rankedResults
      .map((ranked) => {
        const result = resultMap.get(String(ranked?.result_id ?? "").trim()) ?? null;
        const key = canonicalizeBotUrl(result?.url);
        if (!result || !key) return null;
        return { result, ranked, key };
      })
      .filter(Boolean);
  }

  function normalizeSectionTitleForDisplay(value) {
    return String(value ?? "")
      .replace(/\(\s*\d+\s*\)\s*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toPseudoBoldAscii(value) {
    let changed = false;
    const chars = Array.from(String(value ?? ""));
    const converted = chars.map((char) => {
      const code = char.codePointAt(0);
      if (code >= 65 && code <= 90) {
        changed = true;
        return String.fromCodePoint(0x1d5d4 + (code - 65));
      }
      if (code >= 97 && code <= 122) {
        changed = true;
        return String.fromCodePoint(0x1d5ee + (code - 97));
      }
      if (code >= 48 && code <= 57) {
        changed = true;
        return String.fromCodePoint(0x1d7ec + (code - 48));
      }
      return char;
    });
    return {
      text: converted.join(""),
      changed
    };
  }

  function formatSectionTitleButtonText(value) {
    const title = String(value ?? "").trim();
    if (!title) return "";
    const pseudo = toPseudoBoldAscii(title);
    if (pseudo.changed) return pseudo.text;
    return title;
  }

  function normalizePriorityForDisplay(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (/(\u043e\u0431\u044f\u0437|\u043d\u0443\u0436\u043d|required|high)/i.test(text)) return "\u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E";
    if (/(\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434|recommend|medium)/i.test(text)) return "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F";
    if (/(\u043f\u0440\u0438\s*\u043d\u0430\u043b\u0438\u0447|\u0435\u0441\u043b\u0438\s*\u0435\u0441\u0442\u044c|optional|low)/i.test(text)) return "\u041F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438";
    return text;
  }

  function formatPriorityBadgeText(value) {
    const normalized = normalizePriorityForDisplay(value);
    if (!normalized) return "";
    if (normalized === "\u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E") return "\uD83D\uDD34 " + normalized;
    if (normalized === "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F") return "\uD83D\uDFE1 " + normalized;
    if (normalized === "\u041F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438") return "\uD83D\uDFE2 " + normalized;
    return normalized;
  }

  function createPickerToken() {
    return Math.random().toString(36).slice(2, 10);
  }

  function buildResearchSuggestionKeyboard() {
    return {
      inline_keyboard: [[
        { text: "➕", callback_data: "sdvg_rs:add" },
        { text: "➖", callback_data: "sdvg_rs:drop" },
        { text: "✖️", callback_data: "sdvg_rs:refresh" }
      ]]
    };
  }

  function buildResearchSuggestionText(entry = {}, position = null) {
    const result = entry?.result ?? {};
    const title = clipText(String(result?.title ?? result?.url ?? "").trim() || "Research link", 220);
    const domain = clipText(String(result?.domain ?? "").trim(), 120);
    const url = String(result?.url ?? "").trim();
    const snippet = clipText(String(result?.snippet ?? "").replace(/\s+/g, " ").trim(), 240);
    const header = position != null ? `🔎 ${position}. ${escapeHtml(title)}` : `🔎 ${escapeHtml(title)}`;
    const sourceLabel = domain || extractHostLabel(url) || "source";
    const sourceLine = url
      ? `Источник: <a href="${escapeHtml(url)}">${escapeHtml(sourceLabel)}</a>`
      : sourceLabel
        ? `Источник: ${escapeHtml(sourceLabel)}`
        : "";
    return [
      header,
      url
        ? `<a href="${escapeHtml(url)}">${escapeHtml(sourceLabel)}</a>`
        : sourceLabel
          ? escapeHtml(sourceLabel)
          : "",
      snippet ? `<blockquote>${escapeHtml(snippet)}</blockquote>` : ""
    ].filter(Boolean).join("\n");
  }

  function formatPickedFileButtonText(relativePath) {
    const normalized = normalizeRelativeMediaPath(relativePath);
    const base = path.basename(normalized || String(relativePath ?? "").trim());
    const parent = path.posix.basename(path.posix.dirname(normalized || ""));
    const label = parent && parent !== "." ? `${base} · ${parent}` : base;
    return clipText(label || "file", 40);
  }

  function buildPickFromDownloadedKeyboard(context) {
    const files = Array.isArray(context?.files) ? context.files : [];
    const token = String(context?.token ?? "").trim();
    const total = files.length;
    const maxPage = total > 0 ? Math.max(0, Math.ceil(total / FILE_PICKER_PAGE_SIZE) - 1) : 0;
    const page = Math.max(0, Math.min(maxPage, Number(context?.page ?? 0)));
    const from = page * FILE_PICKER_PAGE_SIZE;
    const to = Math.min(total, from + FILE_PICKER_PAGE_SIZE);
    const rows = [];

    for (let index = from; index < to; index += 1) {
      const item = files[index];
      if (!item?.path) continue;
      rows.push([
        {
          text: formatPickedFileButtonText(item.path),
          callback_data: `sdvg_pick:sel:${token}:${index}`
        }
      ]);
    }

    if (total === 0) {
      rows.push([{ text: "Файлов нет", callback_data: "sdvg_pick:noop" }]);
    }

    if (maxPage > 0) {
      const prevPage = page > 0 ? page - 1 : null;
      const nextPage = page < maxPage ? page + 1 : null;
      rows.push([
        {
          text: "⬅️",
          callback_data: prevPage == null ? "sdvg_pick:noop" : `sdvg_pick:page:${token}:${prevPage}`
        },
        {
          text: `${page + 1}/${maxPage + 1}`,
          callback_data: "sdvg_pick:noop"
        },
        {
          text: "➡️",
          callback_data: nextPage == null ? "sdvg_pick:noop" : `sdvg_pick:page:${token}:${nextPage}`
        }
      ]);
    }

    rows.push([{ text: "↩️ Назад", callback_data: "sdvg_pick:close" }]);
    return { inline_keyboard: rows };
  }

  function buildCardKeyboard(segment, decision, session) {
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    const metaButtons = [];
    if (resolveComment(segment, decision)) {
      metaButtons.push({ text: "\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439", callback_data: "sdvg_meta:comment" });
    }
    if (visual.format_hint) {
      metaButtons.push({ text: clipText(String(visual.format_hint).trim(), 20), callback_data: "sdvg_meta:format" });
    }
    if (visual.priority) {
      const priorityText = formatPriorityBadgeText(visual.priority);
      metaButtons.push({
        text: clipText(priorityText, 20),
        callback_data: "sdvg_meta:priority"
      });
    }
    const sectionTitle = normalizeSectionTitleForDisplay(segment?.section_title ?? "");
    metaButtons.push({
      text: clipText(formatSectionTitleButtonText(sectionTitle || "\u0411\u0435\u0437 \u0442\u0435\u043C\u044B"), 28),
      callback_data: "sdvg_meta:section"
    });

    const rows = chunkButtons(metaButtons, 2);
    rows.push([
      {
        text: session?.random_mode ? "\uD83C\uDFB2" : "\uD83D\uDCDA",
        callback_data: "sdvg_mode:toggle"
      },
      { text: "📂", callback_data: "sdvg_pick:open" },
      { text: "🔎", callback_data: "sdvg_rs:open" },
      { text: "\u2705", callback_data: "sdvg_done" },
      { text: "\u23ED\uFE0F", callback_data: "sdvg_next" }
    ]);
    return { inline_keyboard: rows };
  }

  function buildDoneBannerKeyboard() {
    return {
      inline_keyboard: [[{ text: "\u2705 \u0413\u043E\u0442\u043E\u0432\u043E", callback_data: "sdvg_done_banner" }]]
    };
  }

  async function markSegmentDone(docId, segmentId, chatId) {
    return withDocumentLock(docId, async () => {
      const document = await loadDocumentStateForBot(docId);
      if (!document) throw new Error("Document not found");

      const segmentsRaw = await loadSegmentsForBot(docId);
      const list = Array.isArray(segmentsRaw) ? [...segmentsRaw] : [];
      const index = list.findIndex((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (index < 0) throw new Error("Segment not found");

      const current = list[index] ?? {};
      const alreadyDone = Boolean(current?.is_done);
      if (!alreadyDone) {
        list[index] = { ...current, is_done: true };
      }

      const normalized = normalizeSegmentsInput(list);
      let version = null;
      if (!alreadyDone) {
        version = await saveVersioned(docId, "segments", normalized);
        await syncDocumentContextForBot(docId, normalized, await loadDecisionsForBot(docId), "telegram_sdvg_mark_done");
        await appendEvent(docId, {
          timestamp: new Date().toISOString(),
          event: "telegram_sdvg_segment_done",
          payload: {
            segment_id: String(segmentId),
            chat_id: String(chatId),
            segments_version: version
          }
        }).catch(() => null);
      }

      return { alreadyDone, version, segment: normalized[index] ?? null };
    });
  }

  function resolveNextOpenSegment(payload, currentSegmentId, randomMode) {
    const openSegments = getOpenSegments(payload?.segments ?? []);
    if (openSegments.length === 0) return null;

    if (randomMode) {
      const candidates = openSegments.filter((item) => item.segment_id !== currentSegmentId);
      if (candidates.length === 0) return null;
      const index = Math.floor(Math.random() * candidates.length);
      return candidates[index] ?? null;
    }

    const ordered = buildSdvgDisplaySegments(payload?.segments ?? []);
    const currentIndex = ordered.findIndex((item) => item?.segment_id === currentSegmentId);
    if (currentIndex >= 0) {
      for (let index = currentIndex + 1; index < ordered.length; index += 1) {
        const candidate = ordered[index];
        if (!candidate || Boolean(candidate.is_done)) continue;
        return candidate;
      }
      for (let index = 0; index < currentIndex; index += 1) {
        const candidate = ordered[index];
        if (!candidate || Boolean(candidate.is_done)) continue;
        return candidate;
      }
      return openSegments.find((item) => item?.segment_id !== currentSegmentId) ?? null;
    }

    return openSegments[0] ?? null;
  }

  async function sendSegmentCard(chatId, docId, segmentId) {
    const payload = await readDocPayload(docId);
    if (!payload) {
      await sendMessage(chatId, `Документ "${docId}" не найден или недоступен.`);
      return null;
    }
    const segment = findSdvgDisplaySegment(payload.segments, segmentId);
    if (!segment) {
      await sendMessage(chatId, `Сегмент "${segmentId}" не найден в документе.`);
      return null;
    }
    const decisionMap = buildDecisionMap(payload.decisions);
    const decision = decisionMap.get(segment.segment_id) ?? null;
    const quote = clipText(String(segment.text_quote ?? "").trim() || "Нет текста сегмента.", TELEGRAM_MESSAGE_MAX - 32);
    const session = getSession(chatId);
    const message = await sendMessage(chatId, quote, {
      reply_markup: buildCardKeyboard(segment, decision, session)
    });

    session.doc_id = docId;
    session.active_segment_id = segment.segment_id;
    await syncSessionState(chatId, session, {
      mode: "sdvg",
      activeDocumentId: docId,
      activeSegmentId: segment.segment_id
    });
    rememberCardContext(session, message?.message_id, {
      doc_id: docId,
      segment_id: segment.segment_id
    });
    const remainingOpenSegments = getOpenSegments(payload.segments).length;
    await maybeSendSdvgEncouragementMessage(chatId, session, remainingOpenSegments);
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "telegram_sdvg_segment_sent",
      payload: {
        segment_id: segment.segment_id,
        chat_id: String(chatId)
      }
    }).catch(() => null);
    return message;
  }

  async function resolveDocIdForSession(session, requestedDocId = "") {
    const candidate = String(requestedDocId ?? "").trim();
    if (candidate) {
      const payload = await readDocPayload(candidate);
      if (payload?.document) return candidate;
      return null;
    }

    if (session?.doc_id) {
      const payload = await readDocPayload(session.doc_id);
      if (payload?.document) return session.doc_id;
    }

    if (defaultDocId) {
      const payload = await readDocPayload(defaultDocId);
      if (payload?.document) return defaultDocId;
    }

    const docs = await listDocuments();
    for (const doc of docs) {
      const docId = String(doc?.id ?? "").trim();
      if (!docId) continue;
      const payload = await readDocPayload(docId);
      if (!payload?.document) continue;
      if (payload.segments.length > 0) return docId;
    }
    return null;
  }

  async function appendVisualDescription(docId, segmentId, text, chatId) {
    const incoming = String(text ?? "").trim();
    if (!incoming) return null;
    return withDocumentLock(docId, async () => {
      const document = await loadDocumentStateForBot(docId);
      if (!document) throw new Error("Document not found");
      const segments = normalizeSegmentList(await loadSegmentsForBot(docId));
      const segment = segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (!segment) throw new Error("Segment not found");
      const decisions = await loadDecisionsForBot(docId);
      const list = Array.isArray(decisions) ? [...decisions] : [];
      const index = list.findIndex((item) => String(item?.segment_id ?? "") === String(segmentId));
      const current = index >= 0
        ? list[index]
        : {
            segment_id: segmentId,
            visual_decision: emptyVisualDecision(),
            search_decision: emptySearchDecision(),
            search_decision_en: emptySearchDecision(),
            version: 1
          };
      const visual = normalizeVisualDecisionInput(current.visual_decision);
      const mergedDescription = visual.description ? `${visual.description}\n${incoming}` : incoming;
      const nextDecision = {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput({
          ...visual,
          description: mergedDescription
        }),
        search_decision: normalizeSearchDecisionInput(current.search_decision),
        search_decision_en: normalizeSearchDecisionInput(current.search_decision_en),
        version: Number(current.version ?? 1)
      };
      if (index >= 0) {
        list[index] = nextDecision;
      } else {
        list.push(nextDecision);
      }
      const normalized = normalizeDecisionsInput(list);
      const version = await saveVersioned(docId, "decisions", normalized);
      await syncDocumentContextForBot(docId, segments, normalized, "telegram_sdvg_description_update");
      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "telegram_sdvg_description_updated",
        payload: {
          segment_id: segmentId,
          chat_id: String(chatId),
          decisions_version: version
        }
      }).catch(() => null);
      return { version, decision: normalized.find((item) => item.segment_id === segmentId) ?? nextDecision };
    });
  }

  async function appendSegmentMediaPaths(
    docId,
    segmentId,
    mediaPaths = [],
    chatId,
    source = "telegram_upload",
    mediaStartTimecode = null
  ) {
    const incomingPaths = Array.isArray(mediaPaths) ? mediaPaths.map(normalizeRelativeMediaPath).filter(Boolean) : [];
    if (incomingPaths.length === 0) return null;
    const normalizedMediaStartTimecode = normalizeMediaStartTimecodeValue(mediaStartTimecode);

    return withDocumentLock(docId, async () => {
      const document = await loadDocumentStateForBot(docId);
      if (!document) throw new Error("Document not found");
      const segments = normalizeSegmentList(await loadSegmentsForBot(docId));
      const segment = segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (!segment) throw new Error("Segment not found");

      const decisions = await loadDecisionsForBot(docId);
      const list = Array.isArray(decisions) ? [...decisions] : [];
      const index = list.findIndex((item) => String(item?.segment_id ?? "") === String(segmentId));
      const current = index >= 0
        ? list[index]
        : {
            segment_id: segmentId,
            visual_decision: emptyVisualDecision(),
            search_decision: emptySearchDecision(),
            search_decision_en: emptySearchDecision(),
            version: 1
          };
      const visual = normalizeVisualDecisionInput(current.visual_decision);
      const mergedVisual = normalizeVisualDecisionInput({
        ...visual,
        media_file_paths: [...visual.media_file_paths, ...incomingPaths]
      });
      const nextTimecodes = { ...mergedVisual.media_file_timecodes };
      if (normalizedMediaStartTimecode) {
        const incomingVideoPaths = incomingPaths.filter((item) => isVideoFilePath(item));
        if (incomingVideoPaths.length > 0) {
          incomingVideoPaths.forEach((item) => {
            nextTimecodes[item] = normalizedMediaStartTimecode;
          });
        }
      }
      const firstVideoPath = mergedVisual.media_file_paths.find((item) => isVideoFilePath(item)) ?? null;
      const mergedTimecodes = firstVideoPath ? nextTimecodes : {};
      const nextDecision = {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput({
          ...mergedVisual,
          media_file_timecodes: mergedTimecodes,
          media_start_timecode: firstVideoPath
            ? normalizedMediaStartTimecode ?? mergedTimecodes[firstVideoPath] ?? null
            : null
        }),
        search_decision: normalizeSearchDecisionInput(current.search_decision),
        search_decision_en: normalizeSearchDecisionInput(current.search_decision_en),
        version: Number(current.version ?? 1)
      };
      if (index >= 0) {
        list[index] = nextDecision;
      } else {
        list.push(nextDecision);
      }
      const normalized = normalizeDecisionsInput(list);
      const version = await saveVersioned(docId, "decisions", normalized);
      await syncDocumentContextForBot(docId, segments, normalized, "telegram_sdvg_media_attach");
      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "telegram_sdvg_media_attached",
        payload: {
          segment_id: segmentId,
          chat_id: String(chatId),
          source,
          files: incomingPaths,
          decisions_version: version,
          ...(normalizedMediaStartTimecode ? { media_start_timecode: normalizedMediaStartTimecode } : {})
        }
      }).catch(() => null);
      return {
        version,
        decision: normalized.find((item) => item.segment_id === segmentId) ?? nextDecision
      };
    });
  }

  function normalizeSectionMeta(segment = {}) {
    const sectionId = String(segment?.section_id ?? "").trim() || null;
    const sectionTitle = String(segment?.section_title ?? "").trim() || null;
    const sectionIndex = Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null;
    return {
      section_id: sectionId,
      section_title: sectionTitle,
      section_index: sectionIndex
    };
  }

  function buildSectionIdentityKey(segment = {}) {
    const titleKey = String(segment?.section_title ?? "").trim().toLowerCase();
    if (titleKey) return `title:${titleKey}`;
    const idKey = String(segment?.section_id ?? "").trim().toLowerCase();
    if (idKey) return `id:${idKey}`;
    return "";
  }

  function hasUrlInTopicLinks(linkSegments = [], sectionMeta = {}, normalizedUrl = "") {
    if (!normalizedUrl) return false;
    const targetKey = buildSectionIdentityKey(sectionMeta);
    const candidates = targetKey
      ? linkSegments.filter((item) => buildSectionIdentityKey(item) === targetKey)
      : linkSegments;
    return candidates.some((segment) =>
      Array.isArray(segment?.links) &&
      segment.links.some((link) => {
        const candidateUrl = typeof normalizeLinkUrl === "function"
          ? normalizeLinkUrl(link?.url)
          : String(link?.url ?? "").trim();
        return candidateUrl === normalizedUrl;
      })
    );
  }

  async function appendUrlToTopicLinks(docId, segment, rawUrl, chatId, reason = "yt_dlp_failed") {
    const normalizedUrl =
      typeof normalizeLinkUrl === "function" ? normalizeLinkUrl(rawUrl) : String(rawUrl ?? "").trim();
    if (!normalizedUrl || !isHttpUrl(normalizedUrl)) {
      return {
        added: false,
        already_exists: false,
        skipped: true,
        url: normalizedUrl
      };
    }

    return withDocumentLock(docId, async () => {
      const document = await loadDocumentStateForBot(docId);
      if (!document) throw new Error("Document not found");

      const segmentsRaw = await loadSegmentsForBot(docId);
      const segmentsList = Array.isArray(segmentsRaw) ? [...segmentsRaw] : [];
      const sourceSegment = segmentsList.find(
        (item) =>
          String(item?.segment_id ?? "") === String(segment?.segment_id ?? "") &&
          String(item?.block_type ?? "").trim().toLowerCase() !== "links"
      ) ?? segment ?? {};
      const sectionMeta = normalizeSectionMeta(sourceSegment);

      const existingLinkSegments =
        typeof normalizeLinkSegmentsInput === "function"
          ? normalizeLinkSegmentsInput(
              segmentsList.filter((item) => String(item?.block_type ?? "").trim().toLowerCase() === "links")
            )
          : [];
      const alreadyExists = hasUrlInTopicLinks(existingLinkSegments, sectionMeta, normalizedUrl);
      if (alreadyExists) {
        return {
          added: false,
          already_exists: true,
          skipped: false,
          url: normalizedUrl,
          section_title: sectionMeta.section_title
        };
      }

      const fallbackSeed = String(sourceSegment?.segment_id ?? "topic").trim() || "topic";
      const incomingSeedId = sectionMeta.section_id ? `links_${sectionMeta.section_id}` : `links_${fallbackSeed}`;
      const incomingLinkSegments =
        typeof normalizeLinkSegmentsInput === "function"
          ? normalizeLinkSegmentsInput([
              {
                segment_id: incomingSeedId,
                block_type: "links",
                text_quote: "",
                section_id: sectionMeta.section_id,
                section_title: sectionMeta.section_title,
                section_index: sectionMeta.section_index,
                links: [{ url: normalizedUrl, raw: String(rawUrl ?? normalizedUrl) }]
              }
            ])
          : [];

      const mergedLinkSegments =
        typeof mergeLinkSegmentsBySection === "function"
          ? mergeLinkSegmentsBySection(existingLinkSegments, incomingLinkSegments)
          : [...existingLinkSegments, ...incomingLinkSegments];
      const withoutLinks = segmentsList.filter((item) => String(item?.block_type ?? "").trim().toLowerCase() !== "links");
      let mergedSegments = [...withoutLinks, ...mergedLinkSegments];
      if (typeof collapseDuplicateLinkOnlyTopics === "function") {
        const collapsed = collapseDuplicateLinkOnlyTopics(mergedSegments);
        if (Array.isArray(collapsed?.segments)) {
          mergedSegments = collapsed.segments;
        }
      }

      let segmentsVersion = null;
      let decisionsVersion = null;
      const decisionsRaw = await loadDecisionsForBot(docId);
      if (typeof splitSegmentsAndDecisions === "function" && typeof appendLinkDecisionsOverride === "function") {
        const finalLinkSegments = mergedSegments.filter(
          (item) => String(item?.block_type ?? "").trim().toLowerCase() === "links"
        );
        const decisionsOverrideWithLinks = appendLinkDecisionsOverride(
          Array.isArray(decisionsRaw) ? decisionsRaw : [],
          finalLinkSegments
        );
        const { segmentsData, decisionsData } = splitSegmentsAndDecisions(mergedSegments, decisionsOverrideWithLinks);
        segmentsVersion = await saveVersioned(docId, "segments", segmentsData);
        decisionsVersion = await saveVersioned(docId, "decisions", decisionsData);
        await syncDocumentContextForBot(docId, segmentsData, decisionsData, "telegram_sdvg_append_topic_link");
      } else {
        const segmentsData = normalizeSegmentsInput(mergedSegments);
        segmentsVersion = await saveVersioned(docId, "segments", segmentsData);

        const decisionsList = normalizeDecisionsInput(Array.isArray(decisionsRaw) ? decisionsRaw : []);
        const existingDecisionIds = new Set(
          decisionsList.map((item) => String(item?.segment_id ?? "").trim()).filter(Boolean)
        );
        const missingLinkDecisions = mergedSegments
          .filter((item) => String(item?.block_type ?? "").trim().toLowerCase() === "links")
          .map((item) => String(item?.segment_id ?? "").trim())
          .filter((id) => id && !existingDecisionIds.has(id))
          .map((segmentId) => ({
            segment_id: segmentId,
            visual_decision: emptyVisualDecision(),
            search_decision: emptySearchDecision(),
            search_decision_en: emptySearchDecision(),
            version: 1
          }));
        if (missingLinkDecisions.length > 0) {
          const nextDecisions = normalizeDecisionsInput([...decisionsList, ...missingLinkDecisions]);
          decisionsVersion = await saveVersioned(docId, "decisions", nextDecisions);
          await syncDocumentContextForBot(docId, segmentsData, nextDecisions, "telegram_sdvg_append_topic_link");
        } else {
          await syncDocumentContextForBot(docId, segmentsData, decisionsList, "telegram_sdvg_append_topic_link");
        }
      }

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "telegram_sdvg_topic_link_added",
        payload: {
          segment_id: String(sourceSegment?.segment_id ?? segment?.segment_id ?? ""),
          chat_id: String(chatId),
          url: normalizedUrl,
          reason,
          section_id: sectionMeta.section_id,
          section_title: sectionMeta.section_title,
          segments_version: segmentsVersion,
          decisions_version: decisionsVersion
        }
      }).catch(() => null);

      return {
        added: true,
        already_exists: false,
        skipped: false,
        url: normalizedUrl,
        section_title: sectionMeta.section_title,
        segments_version: segmentsVersion,
        decisions_version: decisionsVersion
      };
    });
  }

  async function resolveCachedDownloadedPaths(docId, rawUrl, fallbackSectionTitle = "") {
    if (!docId || !rawUrl || typeof normalizeDocumentMediaDownloads !== "function") return [];
    const normalizeUrl = (value) =>
      typeof normalizeLinkUrl === "function" ? normalizeLinkUrl(value) : String(value ?? "").trim();
    const targetUrl = normalizeUrl(rawUrl);
    if (!targetUrl) return [];

    const downloadedMap = await loadDocumentMediaDownloadsForBot(docId);
    const entry = Object.values(downloadedMap).find((item) => normalizeUrl(item?.url) === targetUrl);
    if (!entry) return [];

    const sectionName = sanitizeMediaTopicName(entry.section_title || fallbackSectionTitle || "");
    const mediaRoot = path.resolve(getMediaDir());
    const outputFiles = Array.isArray(entry.output_files) ? entry.output_files : [];
    const seen = new Set();
    const result = [];

    for (const outputFile of outputFiles) {
      const normalizedOutput = normalizeRelativeMediaPath(outputFile);
      if (!normalizedOutput) continue;
      const candidates = [normalizedOutput];
      if (sectionName && !normalizedOutput.startsWith(`${sectionName}/`)) {
        candidates.unshift(normalizeRelativeMediaPath(path.posix.join(sectionName, normalizedOutput)));
      }

      for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        const absolutePath = path.resolve(mediaRoot, candidate.replace(/\//g, path.sep));
        const insideMediaRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
        if (!insideMediaRoot) continue;
        if (!(await fileExists(absolutePath))) continue;
        seen.add(candidate);
        result.push(candidate);
        break;
      }
    }

    return result;
  }

  async function resolveJobOutputRelativePaths(sectionTitle, outputFiles = []) {
    const sectionName = sanitizeMediaTopicName(sectionTitle || "");
    const mediaRoot = path.resolve(getMediaDir());
    const seen = new Set();
    const result = [];

    for (const outputFile of Array.isArray(outputFiles) ? outputFiles : []) {
      const normalizedOutput = normalizeRelativeMediaPath(outputFile);
      if (!normalizedOutput) continue;
      const candidates = [normalizedOutput];
      if (sectionName && !normalizedOutput.startsWith(`${sectionName}/`)) {
        candidates.unshift(normalizeRelativeMediaPath(path.posix.join(sectionName, normalizedOutput)));
      }

      for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        const absolutePath = path.resolve(mediaRoot, candidate.replace(/\//g, path.sep));
        const insideMediaRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
        if (!insideMediaRoot) continue;
        if (!(await fileExists(absolutePath))) continue;
        seen.add(candidate);
        result.push(candidate);
        break;
      }
    }

    return result;
  }

  async function collectDownloadedFilesForPicker(docId, segment) {
    if (!docId || typeof normalizeDocumentMediaDownloads !== "function") return [];
    const mediaRoot = path.resolve(getMediaDir());
    const map = await loadDocumentMediaDownloadsForBot(docId);
    const segmentSection = sanitizeMediaTopicName(segment?.section_title ?? "");
    const seen = new Set();
    const preferred = [];
    const other = [];

    for (const entry of Object.values(map)) {
      const sectionName = sanitizeMediaTopicName(entry?.section_title ?? "");
      const files = Array.isArray(entry?.output_files) ? entry.output_files : [];
      for (const fileItem of files) {
        const normalizedOutput = normalizeRelativeMediaPath(fileItem);
        if (!normalizedOutput) continue;
        const candidates = [normalizedOutput];
        if (sectionName && !normalizedOutput.startsWith(`${sectionName}/`)) {
          candidates.unshift(normalizeRelativeMediaPath(path.posix.join(sectionName, normalizedOutput)));
        }
        for (const candidate of candidates) {
          if (!candidate || seen.has(candidate)) continue;
          const absolutePath = path.resolve(mediaRoot, candidate.replace(/\//g, path.sep));
          const insideMediaRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
          if (!insideMediaRoot) continue;
          if (!(await fileExists(absolutePath))) continue;
          const stat = await fs.stat(absolutePath).catch(() => null);
          const item = {
            path: candidate,
            section: sectionName || null,
            mtime: Number(stat?.mtimeMs ?? 0)
          };
          seen.add(candidate);
          if (segmentSection && sectionName && sectionName === segmentSection) {
            preferred.push(item);
          } else {
            other.push(item);
          }
          break;
        }
      }
    }

    const sortByMtimeDesc = (a, b) => Number(b?.mtime ?? 0) - Number(a?.mtime ?? 0);
    preferred.sort(sortByMtimeDesc);
    other.sort(sortByMtimeDesc);
    return [...preferred, ...other];
  }

  async function restoreCardKeyboard(chatId, callbackMessageId, session, context) {
    if (!context?.doc_id || !context?.segment_id) return false;
    const payload = await readDocPayload(context.doc_id);
    if (!payload) return false;
    const segment = findSdvgDisplaySegment(payload.segments, context.segment_id);
    if (!segment) return false;
    const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
    const keyboard = buildCardKeyboard(segment, decision, session);
    await editMessageReplyMarkup(chatId, callbackMessageId, keyboard).catch(() => null);
    return true;
  }

  async function downloadTelegramFileToTopic(fileId, sectionTitle, preferredName) {
    const fileResult = await telegramApiCall("getFile", { file_id: fileId });
    const rawFilePath = String(fileResult?.file_path ?? "").trim();
    if (!rawFilePath) {
      throw new Error("Telegram did not return file_path");
    }
    const filePath = normalizeTelegramFilePath(rawFilePath, localStoragePrefix);
    if (!filePath) {
      throw new Error("Telegram returned empty normalized file_path");
    }
    const topic = sanitizeMediaTopicName(sectionTitle);
    const outputDir = await ensureMediaDir(topic);
    const sourceName = preferredName || path.basename(filePath);
    const safeName = sanitizeFileName(sourceName, "telegram_file");
    const existingPath = path.join(outputDir, safeName);
    if (await fileExists(existingPath)) {
      const mediaRoot = path.resolve(getMediaDir());
      const relativePath = path.relative(mediaRoot, existingPath).split(path.sep).join("/");
      return normalizeRelativeMediaPath(relativePath);
    }
    const targetPath = await ensureUniqueFilePath(outputDir, safeName);
    const encodedPath = encodePathForUrl(filePath);
    const rawEncodedPath = encodePathForUrl(rawFilePath);
    const candidates = new Set([`${fileApiBase}/${encodedPath}`]);
    if (!usingOfficialApi && token) {
      candidates.add(`${fileApiBase}/bot${token}/${encodedPath}`);
    }
    if (rawEncodedPath && rawEncodedPath !== encodedPath) {
      candidates.add(`${fileApiBase}/${rawEncodedPath}`);
      if (!usingOfficialApi && token) {
        candidates.add(`${fileApiBase}/bot${token}/${rawEncodedPath}`);
      }
    }

    let response = null;
    let lastStatus = "unknown";
    for (const url of candidates) {
      response = await fetch(url);
      if (response.ok && response.body) {
        break;
      }
      lastStatus = String(response.status || "unknown");
    }
    if (!response?.ok || !response.body) {
      const canUseDockerFallback =
        dockerCopyFallbackEnabled &&
        lastStatus === "404" &&
        looksLikeTelegramLocalStoragePath(rawFilePath, localStoragePrefix) &&
        !usingOfficialApi;
      if (canUseDockerFallback) {
        try {
          await execFileAsync("docker", ["cp", `${dockerContainerName}:${rawFilePath}`, targetPath], {
            windowsHide: true
          });
          const mediaRoot = path.resolve(getMediaDir());
          const relativePath = path.relative(mediaRoot, targetPath).split(path.sep).join("/");
          return normalizeRelativeMediaPath(relativePath);
        } catch (error) {
          throw new Error(
            `Failed to download Telegram file (${lastStatus}); docker fallback failed: ${error?.message ?? error}`
          );
        }
      }
      throw new Error(`Failed to download Telegram file (${lastStatus})`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
    const mediaRoot = path.resolve(getMediaDir());
    const relativePath = path.relative(mediaRoot, targetPath).split(path.sep).join("/");
    return normalizeRelativeMediaPath(relativePath);
  }

  function formatJobStatusMessage(segmentId, url, job) {
    const status = String(job?.status ?? "queued");
    const progress = String(job?.progress ?? "").trim();
    const progressLine = progress
      ? `\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: ${progress}`
      : "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: ...";
    const errorLine = job?.error ? `\u041E\u0448\u0438\u0431\u043A\u0430: ${job.error}` : "";
    const lines = [
      `\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segmentId}`,
      `URL: ${url}`,
      `\u0421\u0442\u0430\u0442\u0443\u0441: ${status}`,
      progressLine
    ];
    if (errorLine) lines.push(errorLine);
    return lines.join("\n");
  }

  async function trackDownloadJobAndAttach({
    chatId,
    statusMessageId,
    docId,
    segmentId,
    segment,
    sectionTitle,
    url,
    jobId,
    mediaStartTimecode = null,
    sourceMessageId = null
  }) {
    const startedAt = Date.now();
    let lastRendered = "";
    while (Date.now() - startedAt <= DOWNLOAD_TRACK_TIMEOUT_MS) {
      const job = mediaDownloader.getJob(jobId);
      if (!job) {
        await editMessage(chatId, statusMessageId, "\u0417\u0430\u0434\u0430\u0447\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.");
        return;
      }
      const rendered = formatJobStatusMessage(segmentId, url, job);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        await editMessage(chatId, statusMessageId, rendered).catch(() => null);
      }
      if (job.status === "completed") {
        const attachedPaths = await resolveJobOutputRelativePaths(sectionTitle, job.output_files);
        if (attachedPaths.length > 0) {
          await appendSegmentMediaPaths(docId, segmentId, attachedPaths, chatId, "yt_dlp_url", mediaStartTimecode);
          await registerSegmentMediaAssets({
            chatId,
            session: getSession(chatId),
            segment: segment ?? { segment_id: segmentId, section_title: sectionTitle },
            relativePaths: attachedPaths,
            sourceUrl: url,
            source: "yt_dlp_url",
            mediaStartTimecode,
            metadata: {
              title: job?.meta_title,
              uploader: job?.meta_uploader,
              uploader_url: job?.meta_uploader_url,
              webpage_url: job?.meta_webpage_url,
              format_note: job?.meta_format_note,
              resolution: job?.meta_resolution
            }
          });
          await editMessage(
            chatId,
            statusMessageId,
            `\u0413\u043E\u0442\u043E\u0432\u043E.\n\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segmentId}\n\u0424\u0430\u0439\u043B\u043E\u0432 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E: ${attachedPaths.length}`
          ).catch(() => null);
          await sendDownloadedMediaBackToChat(chatId, segmentId, url, attachedPaths, {
            title: job?.meta_title,
            uploader: job?.meta_uploader,
            uploader_url: job?.meta_uploader_url,
            webpage_url: job?.meta_webpage_url,
            format_note: job?.meta_format_note,
            resolution: job?.meta_resolution
          }, {
            sourceMessageId,
            deleteSourceMessage: true
          }).catch(() => null);
        } else {
          await editMessage(
            chatId,
            statusMessageId,
            `\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430, \u043D\u043E \u0444\u0430\u0439\u043B\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B.\n\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segmentId}`
          ).catch(() => null);
        }
        return;
      }
      if (job.status === "failed" || job.status === "canceled") {
        let fallbackLine = "";
        try {
          const fallbackResult = await appendUrlToTopicLinks(
            docId,
            segment ?? { segment_id: segmentId, section_title: sectionTitle },
            url,
            chatId,
            "yt_dlp_failed"
          );
          if (fallbackResult?.added) {
            fallbackLine = "\n\u041d\u0435 \u0441\u043a\u0430\u0447\u0430\u043b\u043e\u0441\u044c. \u0421\u0441\u044b\u043b\u043a\u0443 \u0434\u043e\u0431\u0430\u0432\u0438\u043b \u0432 \u0421\u0441\u044b\u043b\u043a\u0438 \u0442\u0435\u043c\u044b.";
          } else if (fallbackResult?.already_exists) {
            fallbackLine = "\n\u041d\u0435 \u0441\u043a\u0430\u0447\u0430\u043b\u043e\u0441\u044c. \u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0432 \u0421\u0441\u044b\u043b\u043a\u0430\u0445 \u0442\u0435\u043c\u044b.";
          }
        } catch (fallbackError) {
          fallbackLine = `\n\u041d\u0435 \u0441\u043a\u0430\u0447\u0430\u043b\u043e\u0441\u044c, \u0438 \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443: ${
            fallbackError?.message ?? fallbackError
          }`;
        }
        await editMessage(chatId, statusMessageId, `${formatJobStatusMessage(segmentId, url, job)}${fallbackLine}`).catch(
          () => null
        );
        return;
      }
      await delay(JOB_WATCH_INTERVAL_MS);
    }
    await editMessage(
      chatId,
      statusMessageId,
      `\u041D\u0435 \u0434\u043E\u0436\u0434\u0430\u043B\u0441\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0437\u0430 \u043E\u0442\u0432\u0435\u0434\u0435\u043D\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F.\n\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segmentId}\n\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u0442\u0430\u0442\u0443\u0441 \u0432 UI.`
    ).catch(() => null);
  }

  function resolveInboxDownloadDocId(session) {
    const sessionDocId = String(session?.doc_id ?? "").trim();
    if (sessionDocId) return sessionDocId;
    if (defaultDocId) return defaultDocId;
    return "__telegram_inbox__";
  }

  async function registerInboxDownloadedAssets({
    chatId,
    session,
    message,
    sourceUrl,
    relativePaths = [],
    metadata = {}
  }) {
    const paths = Array.isArray(relativePaths) ? relativePaths.map(normalizeRelativeMediaPath).filter(Boolean) : [];
    if (paths.length === 0) return [];
    const created = [];
    for (const relativePath of paths) {
      const asset = await createAssetRecord(
        {
          kind: "downloaded_media",
          status: "processed",
          title: clipText(String(metadata?.title ?? path.basename(relativePath)), 180),
          description: String(message?.text ?? message?.caption ?? "").trim(),
          sourceUrl,
          sourceDomain: deriveSourceDomain(sourceUrl),
          telegramChatId: String(chatId),
          telegramMessageId: String(message?.message_id ?? ""),
          fileName: path.basename(relativePath),
          localPath: relativePath,
          processingState: "pending_segment",
          originType: "telegram_message",
          originId: String(message?.message_id ?? ""),
          meta: {
            source: "telegram_inbox_download",
            uploader: metadata?.uploader ?? "",
            uploader_url: metadata?.uploader_url ?? "",
            webpage_url: metadata?.webpage_url ?? "",
            format_note: metadata?.format_note ?? "",
            resolution: metadata?.resolution ?? ""
          }
        },
        {
          documentId: session?.doc_id,
          role: "inbox",
          attachedBy: "telegram_sdvg"
        }
      );
      if (asset) created.push(asset);
    }
    return created;
  }

  async function trackInboxDownloadAndReply({
    chatId,
    statusMessageId,
    session,
    message,
    url,
    jobId
  }) {
    const startedAt = Date.now();
    const folderName = sanitizeMediaTopicName("UNSORTED");
    let lastRendered = "";
    while (Date.now() - startedAt <= DOWNLOAD_TRACK_TIMEOUT_MS) {
      const job = mediaDownloader.getJob(jobId);
      if (!job) {
        await editMessage(chatId, statusMessageId, "\u0417\u0430\u0434\u0430\u0447\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.").catch(() => null);
        return;
      }
      const rendered = formatJobStatusMessage("UNSORTED", url, job);
      if (rendered !== lastRendered) {
        lastRendered = rendered;
        await editMessage(chatId, statusMessageId, rendered).catch(() => null);
      }
      if (job.status === "completed") {
        const downloadedPaths = await resolveJobOutputRelativePaths(folderName, job.output_files);
        if (downloadedPaths.length > 0) {
          const metadata = {
            title: job?.meta_title,
            uploader: job?.meta_uploader,
            uploader_url: job?.meta_uploader_url,
            webpage_url: job?.meta_webpage_url,
            format_note: job?.meta_format_note,
            resolution: job?.meta_resolution
          };
          await registerInboxDownloadedAssets({
            chatId,
            session,
            message,
            sourceUrl: url,
            relativePaths: downloadedPaths,
            metadata
          });
          await editMessage(
            chatId,
            statusMessageId,
            `\u0413\u043E\u0442\u043E\u0432\u043E.\nUNSORTED: ${downloadedPaths.length} \u0444\u0430\u0439\u043B(\u043E\u0432).`
          ).catch(() => null);
          await sendDownloadedMediaBackToChat(chatId, "UNSORTED", url, downloadedPaths, metadata, {
            sourceMessageId: message?.message_id,
            deleteSourceMessage: true
          }).catch(() => null);
        } else {
          await editMessage(
            chatId,
            statusMessageId,
            "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430, \u043D\u043E \u0444\u0430\u0439\u043B\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B."
          ).catch(() => null);
        }
        return;
      }
      if (job.status === "failed" || job.status === "canceled") {
        await editMessage(
          chatId,
          statusMessageId,
          `${formatJobStatusMessage("UNSORTED", url, job)}\n\u0421\u0441\u044B\u043B\u043A\u0430 \u043E\u0441\u0442\u0430\u043B\u0430\u0441\u044C \u0432 Inbox.`
        ).catch(() => null);
        return;
      }
      await delay(JOB_WATCH_INTERVAL_MS);
    }
    await editMessage(
      chatId,
      statusMessageId,
      "\u041D\u0435 \u0434\u043E\u0436\u0434\u0430\u043B\u0441\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0437\u0430 \u043E\u0442\u0432\u0435\u0434\u0435\u043D\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F."
    ).catch(() => null);
  }

  async function handleInboxUrlInput(chatId, session, message, url) {
    if (!mediaDownloader.isAvailable()) {
      await sendMessage(chatId, "Ссылка сохранена в Inbox, но yt-dlp сейчас недоступен для скачивания.");
      return;
    }
    if (!isHttpUrl(url)) {
      await sendMessage(chatId, "URL \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C http(s).");
      return;
    }
    if (!isYtDlpCandidateUrl(url)) {
      await sendMessage(chatId, "Ссылка сохранена в Inbox.");
      return;
    }

    const outputDir = await ensureMediaDir(sanitizeMediaTopicName("UNSORTED"));
    const job = mediaDownloader.enqueue({
      docId: resolveInboxDownloadDocId(session),
      url,
      outputDir,
      sectionTitle: "UNSORTED"
    });

    const progressMessage = await sendMessage(
      chatId,
      `UNSORTED\nURL: ${url}\n\u0421\u0442\u0430\u0442\u0443\u0441: queued\n\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: 0%`
    );

    void trackInboxDownloadAndReply({
      chatId,
      statusMessageId: progressMessage?.message_id,
      session,
      message,
      url,
      jobId: job.id
    });
  }

  async function handleUrlScreenshotPreview(chatId, session, segment, url, mediaStartTimecode = null, sourceMessageId = null) {
    if (isYtDlpCandidateUrl(url)) {
      return handleUrlInput(chatId, session, segment, url, mediaStartTimecode, sourceMessageId);
    }
    const status = await sendMessage(chatId, "Добавляю ссылку в тему и делаю скриншот...").catch(() => null);
    try {
      const linkResult = await appendUrlToTopicLinks(
        session.doc_id,
        segment,
        url,
        chatId,
        "telegram_sdvg_link_preview"
      ).catch(() => null);
      await createAssetRecord(
        {
          kind: "link",
          status: "processed",
          title: clipText(url, 180),
          description: String(segment?.text_quote ?? "").trim(),
          sourceUrl: url,
          sourceDomain: deriveSourceDomain(url),
          telegramChatId: String(chatId),
          telegramMessageId: sourceMessageId ? String(sourceMessageId) : "",
          processingState: "attached",
          originType: "sdvg_segment",
          originId: String(segment?.segment_id ?? ""),
          meta: {
            source: "telegram_sdvg_link_preview",
            media_start_timecode: normalizeMediaStartTimecodeValue(mediaStartTimecode),
            section_title: String(segment?.section_title ?? "").trim()
          }
        },
        {
          documentId: session?.doc_id,
          segmentId: segment?.segment_id,
          role: "source",
          attachedBy: "telegram_sdvg"
        }
      ).catch(() => null);
      const successfulProfiles = await getScreenshotProfilesForSource(url);
      const initialProfile = successfulProfiles[0] ?? null;
      const previewContext = {
        chat_id: String(chatId),
        doc_id: String(session?.doc_id ?? "").trim(),
        segment_id: String(segment?.segment_id ?? "").trim(),
        url: String(url ?? "").trim(),
        metadata: {},
        source_message_id: Number(sourceMessageId ?? 0) || null,
        media_start_timecode: normalizeMediaStartTimecodeValue(mediaStartTimecode),
        profile: initialProfile,
        profile_candidates: buildScreenshotProfileCandidates(initialProfile ?? {}, successfulProfiles),
        profile_index: initialProfile ? 0 : -1,
        link_was_added: Boolean(linkResult?.added),
        link_already_exists: Boolean(linkResult?.already_exists)
      };
      const sent = await sendScreenshotPreviewMessage(chatId, session, previewContext);
      if (status?.message_id) {
        await deleteMessage(chatId, status.message_id).catch(() => null);
      }
      return sent;
    } catch (error) {
      if (status?.message_id) {
        await deleteMessage(chatId, status.message_id).catch(() => null);
      }
      await sendMessage(chatId, `Не удалось сделать скриншот ссылки: ${error?.message ?? error}`).catch(() => null);
      return null;
    }
  }

  async function handleUrlInput(chatId, session, segment, url, mediaStartTimecode = null, sourceMessageId = null) {
    await createAssetRecord(
      {
        kind: "link",
        status: "processed",
        title: clipText(url, 180),
        description: String(segment?.text_quote ?? "").trim(),
        sourceUrl: url,
        sourceDomain: deriveSourceDomain(url),
        telegramChatId: String(chatId),
        processingState: "queued",
        originType: "sdvg_segment",
        originId: String(segment?.segment_id ?? ""),
        meta: {
          source: "telegram_sdvg",
          media_start_timecode: normalizeMediaStartTimecodeValue(mediaStartTimecode),
          section_title: String(segment?.section_title ?? "").trim()
        }
      },
      {
        documentId: session?.doc_id,
        segmentId: segment?.segment_id,
        role: "source",
        attachedBy: "telegram_sdvg"
      }
    );
    if (!mediaDownloader.isAvailable()) {
      const fallbackResult = await appendUrlToTopicLinks(
        session.doc_id,
        segment,
        url,
        chatId,
        "yt_dlp_unavailable"
      ).catch(() => null);
      if (fallbackResult?.added) {
        await sendMessage(
          chatId,
          "yt-dlp \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d. \u0421\u0441\u044b\u043b\u043a\u0443 \u0434\u043e\u0431\u0430\u0432\u0438\u043b \u0432 \u0421\u0441\u044b\u043b\u043a\u0438 \u0442\u0435\u043c\u044b."
        );
      } else if (fallbackResult?.already_exists) {
        await sendMessage(
          chatId,
          "yt-dlp \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d. \u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0432 \u0421\u0441\u044b\u043b\u043a\u0430\u0445 \u0442\u0435\u043c\u044b."
        );
      } else {
        await sendMessage(
          chatId,
          "yt-dlp \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432 backend. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 MEDIA_YTDLP_PATH \u0438\u043b\u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0443 \u0431\u0438\u043d\u0430\u0440\u043d\u0438\u043a\u0430."
        );
      }
      return;
    }
    if (!isHttpUrl(url)) {
      await sendMessage(chatId, "URL \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C http(s).");
      return;
    }

    const normalizedMediaStartTimecode = normalizeMediaStartTimecodeValue(mediaStartTimecode);
    if (normalizedMediaStartTimecode) {
      await appendVisualDescription(
        session.doc_id,
        segment.segment_id,
        `\u041D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u0441 \u0442\u0430\u0439\u043C\u043A\u043E\u0434\u0430 ${normalizedMediaStartTimecode}.`,
        chatId
      ).catch(() => null);
    }

    if (!isYtDlpCandidateUrl(url)) {
      const fallbackResult = await appendUrlToTopicLinks(
        session.doc_id,
        segment,
        url,
        chatId,
        "yt_dlp_unsupported_url"
      ).catch(() => null);
      if (fallbackResult?.added) {
        await sendMessage(chatId, "\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u0441\u0441\u044b\u043b\u043a\u0443 \u0432 \u0421\u0441\u044b\u043b\u043a\u0438 \u0442\u0435\u043c\u044b.");
      } else if (fallbackResult?.already_exists) {
        await sendMessage(chatId, "\u042d\u0442\u0430 \u0441\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0432 \u0421\u0441\u044b\u043b\u043a\u0430\u0445 \u0442\u0435\u043c\u044b.");
      } else {
        await sendMessage(chatId, "URL \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f yt-dlp.");
      }
      return;
    }

    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? "");
    if (typeof isMediaAlreadyDownloaded === "function") {
      const document = await loadDocumentStateForBot(session.doc_id);
      const alreadyDownloaded = isMediaAlreadyDownloaded(document, url);
      if (alreadyDownloaded) {
        const cachedPaths = await resolveCachedDownloadedPaths(session.doc_id, url, sectionTitle);
        if (cachedPaths.length > 0) {
          await appendSegmentMediaPaths(
            session.doc_id,
            segment.segment_id,
            cachedPaths,
            chatId,
            "yt_dlp_url_cached",
            normalizedMediaStartTimecode
          );
          await registerSegmentMediaAssets({
            chatId,
            session,
            segment,
            relativePaths: cachedPaths,
            sourceUrl: url,
            source: "yt_dlp_url_cached",
            mediaStartTimecode: normalizedMediaStartTimecode
          });
          await sendMessage(
            chatId,
            `\u0423\u0436\u0435 \u0441\u043A\u0430\u0447\u0430\u043D\u043E. \u0414\u043E\u0431\u0430\u0432\u0438\u043B \u0432 ${segment.segment_id}: ${cachedPaths.length} \u0444\u0430\u0439\u043B(\u043E\u0432).`
          );
          await sendDownloadedMediaBackToChat(chatId, segment.segment_id, url, cachedPaths, null, {
            sourceMessageId,
            deleteSourceMessage: true
          }).catch(() => null);
          return;
        }
      }
    }

    const outputDir = await ensureMediaDir(sectionTitle);
    const job = mediaDownloader.enqueue({
      docId: session.doc_id,
      url,
      outputDir,
      sectionTitle
    });

    await appendEvent(session.doc_id, {
      timestamp: new Date().toISOString(),
      event: "telegram_sdvg_media_download_queued",
      payload: {
        segment_id: segment.segment_id,
        chat_id: String(chatId),
        job_id: job.id,
        section_title: sectionTitle,
        url,
        ...(normalizedMediaStartTimecode ? { media_start_timecode: normalizedMediaStartTimecode } : {})
      }
    }).catch(() => null);

    const progressMessage = await sendMessage(
      chatId,
      `\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segment.segment_id}\nURL: ${url}\n\u0421\u0442\u0430\u0442\u0443\u0441: queued\n\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: 0%`
    );

    void trackDownloadJobAndAttach({
      chatId,
      statusMessageId: progressMessage?.message_id,
      docId: session.doc_id,
      segmentId: segment.segment_id,
      segment,
      sectionTitle,
      url,
      jobId: job.id,
      mediaStartTimecode: normalizedMediaStartTimecode,
      sourceMessageId
    });
  }
  async function handleTelegramMediaInput(chatId, session, segment, mediaItems) {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) return;
    const status = await sendMessage(
      chatId,
      `\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segment.segment_id}\n\u0421\u043A\u0430\u0447\u0430\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u0438\u0437 Telegram: 0/${mediaItems.length}`
    );
    const attachedPaths = [];
    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? "");
    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      await editMessage(
        chatId,
        status?.message_id,
        `\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segment.segment_id}\n\u0421\u043A\u0430\u0447\u0430\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432 \u0438\u0437 Telegram: ${index + 1}/${mediaItems.length}`
      ).catch(() => null);
      const savedPath = await downloadTelegramFileToTopic(item.fileId, sectionTitle, item.fileName);
      if (savedPath) {
        attachedPaths.push(savedPath);
        await createAssetRecord(
          {
            kind: "telegram_media",
            status: "processed",
            title: item.fileName,
            description: String(segment?.text_quote ?? "").trim(),
            telegramChatId: String(chatId),
            telegramFileId: item.fileId,
            telegramFileUniqueId: item.fileUniqueId,
            mimeType: item.mimeType,
            fileName: item.fileName,
            localPath: savedPath,
            processingState: "attached",
            originType: "sdvg_segment",
            originId: String(segment?.segment_id ?? ""),
            meta: {
              source: "telegram_sdvg",
              media_kind: item.kind,
              section_title: String(segment?.section_title ?? "").trim()
            }
          },
          {
            documentId: session?.doc_id,
            segmentId: segment?.segment_id,
            role: "visual",
            attachedBy: "telegram_sdvg"
          }
        );
      }
    }
    if (attachedPaths.length > 0) {
      await appendSegmentMediaPaths(session.doc_id, segment.segment_id, attachedPaths, chatId, "telegram_media");
    }
    await editMessage(
      chatId,
      status?.message_id,
      `\u0413\u043E\u0442\u043E\u0432\u043E.\n\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segment.segment_id}\n\u0424\u0430\u0439\u043B\u043E\u0432 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E: ${attachedPaths.length}`
    ).catch(() => null);
  }
  async function resolveActiveSegment(session) {
    if (!session?.doc_id || !session?.active_segment_id) return null;
    const payload = await readDocPayload(session.doc_id);
    if (!payload) return null;
    const segment = findSdvgDisplaySegment(payload.segments, session.active_segment_id);
    if (!segment) return null;
    return { payload, segment };
  }

  async function handleSdvgCommand(chatId, requestedDocId = "", randomModeOverride = null) {
    const session = getSession(chatId);
    session.sdvg_cheer_muted = false;
    session.sdvg_cheer_next_at = 0;
    await clearSdvgEncouragementMessage(chatId, session);
    if (randomModeOverride !== null) {
      session.random_mode = Boolean(randomModeOverride);
    }
    const docId = await resolveDocIdForSession(session, requestedDocId);
    if (!docId) {
      await sendMessage(chatId, "Нет активного документа. Используй /sdvg <doc_id>.");
      return;
    }
    const payload = await readDocPayload(docId);
    if (!payload || payload.segments.length === 0) {
      await sendMessage(chatId, `В документе "${docId}" нет сегментов.`);
      return;
    }
    const openSegments = getOpenSegments(payload.segments);
    if (openSegments.length === 0) {
      session.doc_id = docId;
      session.active_segment_id = null;
      await syncSessionState(chatId, session, {
        mode: "inbox",
        activeDocumentId: docId,
        activeSegmentId: ""
      });
      await sendMessage(chatId, `Незавершенные сегменты закончились в документе "${docId}".`);
      return;
    }

    const current = openSegments.find((item) => item.segment_id === session.active_segment_id) ?? openSegments[0];
    await sendSegmentCard(chatId, docId, current.segment_id);
  }

  async function handleNextSegmentCallback(chatId, callbackId, callbackMessageId, session) {
    const actionLock = acquireCardActionLock(session, callbackMessageId, "next");
    if (!actionLock) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    try {
      const context = getCardContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id) {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }
      await clearSdvgEncouragementMessage(chatId, session);
      await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      const openSegments = getOpenSegments(payload.segments);
      if (openSegments.length === 0) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
        await syncSessionState(chatId, session, {
          mode: "inbox",
          activeDocumentId: context.doc_id,
          activeSegmentId: ""
        });
        await clearResearchSuggestionMessagesForCard(chatId, session, callbackMessageId);
        await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
        forgetCardContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      const nextSegment = resolveNextOpenSegment(payload, context.segment_id, Boolean(session?.random_mode));
      if (!nextSegment) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
        await syncSessionState(chatId, session, {
          mode: "inbox",
          activeDocumentId: context.doc_id,
          activeSegmentId: ""
        });
        await clearResearchSuggestionMessagesForCard(chatId, session, callbackMessageId);
        await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
        forgetCardContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        await sendMessage(chatId, "\u041D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044B\u0435 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u044B \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C.");
        return;
      }

      await answerCallback(callbackId, "", false).catch(() => null);
      await clearResearchSuggestionMessagesForCard(chatId, session, callbackMessageId);
      await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
      forgetCardContext(session, callbackMessageId);
      await deleteMessage(chatId, callbackMessageId).catch(() => null);
      await sendSegmentCard(chatId, context.doc_id, nextSegment.segment_id);
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C\u0443 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0443: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    } finally {
      await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
      releaseCardActionLock(session, actionLock);
    }
  }
  async function handleDoneSegmentCallback(chatId, callbackId, callbackMessageId, session) {
    const actionLock = acquireCardActionLock(session, callbackMessageId, "done");
    if (!actionLock) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    try {
      const context = getCardContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id) {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }
      await clearSdvgEncouragementMessage(chatId, session);

      await markSegmentDone(context.doc_id, context.segment_id, chatId);
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(
          callbackId,
          clipText("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043F\u043E\u0441\u043B\u0435 \u043E\u0442\u043C\u0435\u0442\u043A\u0438 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0430.", CALLBACK_ALERT_MAX),
          true
        ).catch(() => null);
        return;
      }

      await clearResearchSuggestionMessagesForCard(chatId, session, callbackMessageId);
      await clearResearchStatusMessageForCard(chatId, session, callbackMessageId);
      forgetCardContext(session, callbackMessageId);
      await editMessageReplyMarkup(chatId, callbackMessageId, buildDoneBannerKeyboard()).catch(() => null);
      await answerCallback(callbackId, "", false).catch(() => null);

      const nextSegment = resolveNextOpenSegment(payload, context.segment_id, Boolean(session?.random_mode));
      if (!nextSegment) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
        await syncSessionState(chatId, session, {
          mode: "inbox",
          activeDocumentId: context.doc_id,
          activeSegmentId: ""
        });
        await sendMessage(chatId, "\u041D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044B\u0435 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u044B \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C.");
        return;
      }

      await sendSegmentCard(chatId, context.doc_id, nextSegment.segment_id);
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0441\u0435\u0433\u043C\u0435\u043D\u0442 \u043A\u0430\u043A \u0433\u043E\u0442\u043E\u0432\u044B\u0439: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    } finally {
      releaseCardActionLock(session, actionLock);
    }
  }
  async function telegramApiCallMultipart(method, payload = {}, fileField, filePath, fileName, timeoutMs = 120000) {
    if (!apiBase) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    if (!fileField || !filePath) throw new Error("fileField and filePath are required");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const form = new FormData();
      Object.entries(payload ?? {}).forEach(([key, value]) => {
        if (value == null) return;
        if (typeof value === "object") {
          form.append(key, JSON.stringify(value));
          return;
        }
        form.append(key, String(value));
      });

      let blob = null;
      if (typeof fs.openAsBlob === "function") {
        blob = await fs.openAsBlob(filePath);
      } else {
        const bytes = await fs.readFile(filePath);
        blob = new Blob([bytes]);
      }
      form.append(fileField, blob, fileName || path.basename(filePath));

      const response = await fetch(`${apiBase}/${method}`, {
        method: "POST",
        body: form,
        signal: controller.signal
      });
      const raw = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Telegram ${method} returned non-JSON response`);
      }
      if (!response.ok || !parsed?.ok) {
        const reason = parsed?.description || `HTTP ${response.status}`;
        throw new Error(`Telegram ${method} failed: ${reason}`);
      }
      return parsed.result;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function handleMetaCallback(callbackId, callbackMessageId, session, key) {
    const context = getCardContext(session, callbackMessageId);
    if (!context?.doc_id || !context?.segment_id) {
      await answerCallback(callbackId, "Карточка устарела. Запусти /sdvg заново.", true).catch(() => null);
      return;
    }
    const payload = await readDocPayload(context.doc_id);
    if (!payload) {
      await answerCallback(callbackId, "Документ недоступен.", true).catch(() => null);
      return;
    }
    const segment = findSdvgDisplaySegment(payload.segments, context.segment_id);
    if (!segment) {
      await answerCallback(callbackId, "Сегмент не найден.", true).catch(() => null);
      return;
    }
    const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    let text = "";
    if (key === "comment") {
      text = resolveComment(segment, decision);
    } else if (key === "format") {
      text = visual.format_hint;
    } else if (key === "priority") {
      text = normalizePriorityForDisplay(visual.priority);
    } else if (key === "section") {
      text = normalizeSectionTitleForDisplay(segment?.section_title ?? "");
    }
    if (!text) text = "\u041F\u0443\u0441\u0442\u043E";
    await answerCallback(callbackId, clipText(text, CALLBACK_ALERT_MAX), true).catch(() => null);
  }

  async function handleModeToggleCallback(chatId, callbackId, callbackMessageId, session) {
    session.random_mode = !Boolean(session.random_mode);
    await syncSessionState(chatId, session, {
      mode: session?.active_segment_id ? "sdvg" : "inbox"
    });
    const modeText = session.random_mode
      ? "\u0420\u0435\u0436\u0438\u043C: \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E"
      : "\u0420\u0435\u0436\u0438\u043C: \u043F\u043E \u043F\u043E\u0440\u044F\u0434\u043A\u0443";
    await answerCallback(callbackId, modeText, false).catch(() => null);

    const context = getCardContext(session, callbackMessageId);
    if (!context?.doc_id || !context?.segment_id) return;
    const payload = await readDocPayload(context.doc_id);
    if (!payload) return;
    const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
    if (!segment) return;
    const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
    const keyboard = buildCardKeyboard(segment, decision, session);
    await editMessageReplyMarkup(chatId, callbackMessageId, keyboard).catch(() => null);
  }

  async function handleSdvgCheerMuteCallback(chatId, callbackId, callbackMessageId, session) {
    session.sdvg_cheer_muted = true;
    session.sdvg_cheer_next_at = 0;
    if (String(session.sdvg_encouragement_message_id ?? "") === String(callbackMessageId ?? "")) {
      session.sdvg_encouragement_message_id = null;
    }
    await deleteMessage(chatId, callbackMessageId).catch(() => null);
    await answerCallback(callbackId, "Бодрящие сообщения отключены до следующего /sdvg.", false).catch(() => null);
  }

  async function handleResearchOpenCallback(chatId, callbackId, callbackMessageId, session) {
    const actionLock = acquireCardActionLock(session, callbackMessageId, "research_open");
    if (!actionLock) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    let statusMessageId = null;
    let lastProgressText = "";
    let lastProgressAt = 0;
    try {
      const context = getCardContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id) {
        await answerCallback(callbackId, "Карточка устарела. Запусти /sdvg заново.", true).catch(() => null);
        return;
      }
      await answerCallback(callbackId, "Ищу ссылки...", false).catch(() => null);
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await sendMessage(chatId, "Документ недоступен.");
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await sendMessage(chatId, "Сегмент не найден.");
        return;
      }
      const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
      const topicLabel = buildResearchProgressTopic(segment);
      const statusMessage = await sendMessage(chatId, `🔎 Готовлю поиск для: ${topicLabel}`).catch(() => null);
      statusMessageId = Number(statusMessage?.message_id ?? 0) || null;
      if (statusMessageId) {
        rememberResearchStatusMessage(session, callbackMessageId, statusMessageId);
      }
      const updateProgress = async (text) => {
        if (!statusMessageId) return;
        const nextText = String(text ?? "").trim();
        if (!nextText || nextText === lastProgressText) return;
        const now = Date.now();
        if (now - lastProgressAt < 900) return;
        lastProgressText = nextText;
        lastProgressAt = now;
        await editMessage(chatId, statusMessageId, nextText).catch(() => null);
      };
      await clearResearchSuggestionMessagesForCard(chatId, session, callbackMessageId);
      const candidates = await fetchSegmentResearchCandidates(context.doc_id, segment, decision, new Set(), updateProgress);
      const topCandidates = candidates.slice(0, RESEARCH_SUGGESTION_TOP_LIMIT);
      if (!topCandidates.length) {
        await sendMessage(chatId, `Для ${segment.segment_id} не нашёл новых подходящих ссылок.`);
        return;
      }
      await updateProgress(`🔎 Отправляю ${topCandidates.length} ссыл${topCandidates.length === 1 ? "ку" : topCandidates.length < 5 ? "ки" : "ок"} для: ${topicLabel}`);
      for (let index = 0; index < topCandidates.length; index += 1) {
        const candidate = topCandidates[index];
        const sent = await sendMessage(
          chatId,
          buildResearchSuggestionText(candidate, index + 1),
          {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: buildResearchSuggestionKeyboard()
          }
        );
        rememberResearchSuggestionContext(session, sent?.message_id, {
          chat_id: String(chatId),
          doc_id: context.doc_id,
          segment_id: context.segment_id,
          card_message_id: String(callbackMessageId),
          results: candidates,
          current_index: index,
          current_key: candidate.key
        });
      }
    } catch (error) {
      await sendMessage(chatId, `Не удалось подобрать ссылки: ${error?.message ?? error}`).catch(() => null);
    } finally {
      releaseCardActionLock(session, actionLock);
    }
  }

  async function handleResearchSuggestionCallback(chatId, callbackId, callbackMessageId, session, data) {
    const action = String(data ?? "").trim();
    if (action === "sdvg_rs:noop") {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    const lockKey = acquireCardActionLock(session, callbackMessageId, action);
    if (!lockKey) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    try {
      const context = getResearchSuggestionContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id) {
        await answerCallback(callbackId, "Подсказка устарела. Нажми 🔎 снова.", true).catch(() => null);
        return;
      }
      if (action === "sdvg_rs:drop") {
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(callbackId, "Документ недоступен.", true).catch(() => null);
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await answerCallback(callbackId, "Сегмент не найден.", true).catch(() => null);
        return;
      }
      const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
      const results = Array.isArray(context.results) ? context.results : [];
      const currentIndex = Number.isFinite(Number(context.current_index)) ? Number(context.current_index) : 0;
      const currentCandidate = results[currentIndex] ?? null;

      if (action === "sdvg_rs:add") {
        const targetUrl = String(currentCandidate?.result?.url ?? "").trim();
        if (!targetUrl) {
          await answerCallback(callbackId, "Ссылка устарела.", true).catch(() => null);
          return;
        }
        await answerCallback(callbackId, "Добавляю...", false).catch(() => null);
        await handleUrlScreenshotPreview(chatId, { ...session, doc_id: context.doc_id }, segment, targetUrl, null, null);
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        return;
      }

      if (action === "sdvg_rs:refresh") {
        await answerCallback(callbackId, "Обновляю...", false).catch(() => null);
        const excludedKeys = new Set([
          ...collectCurrentResearchSuggestionKeys(session, context.card_message_id, callbackMessageId),
          ...(Array.isArray(context.results) ? context.results.slice(0, currentIndex + 1).map((item) => item?.key).filter(Boolean) : []),
          String(context.current_key ?? "").trim()
        ]);
        let nextIndex = -1;
        for (let index = currentIndex + 1; index < results.length; index += 1) {
          const candidate = results[index];
          if (!candidate?.key || excludedKeys.has(candidate.key)) continue;
          nextIndex = index;
          break;
        }
        let nextCandidate = nextIndex >= 0 ? results[nextIndex] : null;
        let nextResults = results;
        if (!nextCandidate) {
          nextResults = await fetchSegmentResearchCandidates(context.doc_id, segment, decision, excludedKeys);
          nextCandidate = nextResults[0] ?? null;
          nextIndex = 0;
        }
        if (!nextCandidate?.result?.url) {
          await editMessage(chatId, callbackMessageId, "Новых подходящих ссылок пока нет.", {
            reply_markup: {
              inline_keyboard: [[{ text: "➖", callback_data: "sdvg_rs:drop" }]]
            }
          }).catch(() => null);
          return;
        }
        rememberResearchSuggestionContext(session, callbackMessageId, {
          ...context,
          results: nextResults,
          current_index: nextIndex,
          current_key: nextCandidate.key
        });
        await editMessage(chatId, callbackMessageId, buildResearchSuggestionText(nextCandidate), {
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: buildResearchSuggestionKeyboard()
        }).catch(() => null);
      }
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`Не удалось обработать ссылку: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    } finally {
      releaseCardActionLock(session, lockKey);
    }
  }

  async function handleScreenshotPreviewCallback(chatId, callbackId, callbackMessageId, session, data) {
    const action = String(data ?? "").trim();
    const lockKey = acquireCardActionLock(session, callbackMessageId, action);
    if (!lockKey) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    try {
      const context = getScreenshotPreviewContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id || !context?.url) {
        await answerCallback(callbackId, "Превью устарело. Пришли ссылку снова.", true).catch(() => null);
        return;
      }
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(callbackId, "Документ недоступен.", true).catch(() => null);
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await answerCallback(callbackId, "Сегмент не найден.", true).catch(() => null);
        return;
      }

      if (action === "sdvg_shot:format" || action === "sdvg_shot:zoom_in" || action === "sdvg_shot:zoom_out") {
        const nextProfile =
          action === "sdvg_shot:format"
            ? cycleScreenshotFormat(context.profile)
            : action === "sdvg_shot:zoom_in"
              ? shiftScreenshotZoom(context.profile, 50)
              : shiftScreenshotZoom(context.profile, -50);
        if (screenshotProfileKey(nextProfile) === screenshotProfileKey(context.profile)) {
          const alertText =
            action === "sdvg_shot:zoom_in"
              ? "Масштаб уже максимальный."
              : action === "sdvg_shot:zoom_out"
                ? "Масштаб уже минимальный."
                : "Формат уже выбран.";
          await answerCallback(callbackId, alertText, true).catch(() => null);
          return;
        }
        const successfulProfiles = await getScreenshotProfilesForSource(context.url, context.metadata);
        const candidates = buildScreenshotProfileCandidates(nextProfile, successfulProfiles);
        const sent = await sendScreenshotPreviewMessage(chatId, session, {
          ...context,
          profile: nextProfile,
          profile_candidates: candidates,
          profile_index: candidates.findIndex((item) => screenshotProfileKey(item) === screenshotProfileKey(nextProfile))
        });
        if (sent?.message_id) {
          forgetScreenshotPreviewContext(session, callbackMessageId);
          await deleteMessage(chatId, callbackMessageId).catch(() => null);
        }
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "sdvg_shot:add") {
        await answerCallback(callbackId, "Добавляю ссылку...", false).catch(() => null);
        const saved = await saveScreenshotPreviewToSegment(
          chatId,
          { ...session, doc_id: context.doc_id },
          segment,
          context
        );
        await rememberSuccessfulScreenshotProfile(context.url, context.metadata, saved?.profile ?? context.profile).catch(() => null);
        forgetScreenshotPreviewContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await sendSavedScreenshotBackToChat(chatId, saved, context).catch(() => null);
        await sendMessage(chatId, `Скриншот добавлен в ${segment.segment_id}.`).catch(() => null);
        return;
      }

      if (action === "sdvg_shot:drop") {
        forgetScreenshotPreviewContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "sdvg_shot:refresh") {
        await answerCallback(callbackId, "Пробую другой вариант...", false).catch(() => null);
        const successfulProfiles = await getScreenshotProfilesForSource(context.url, context.metadata);
        const candidates = buildScreenshotProfileCandidates(context.profile, successfulProfiles);
        const currentKey = screenshotProfileKey(context.profile);
        const currentIndex = Math.max(
          0,
          candidates.findIndex((item) => screenshotProfileKey(item) === currentKey)
        );
        const nextCandidate =
          candidates.find((item, index) => index > currentIndex && screenshotProfileKey(item) !== currentKey) ??
          candidates.find((item) => screenshotProfileKey(item) !== currentKey);
        if (!nextCandidate) {
          await answerCallback(callbackId, "Других параметров пока нет.", true).catch(() => null);
          return;
        }
        const sent = await sendScreenshotPreviewMessage(chatId, session, {
          ...context,
          profile: nextCandidate,
          profile_candidates: candidates,
          profile_index: candidates.findIndex((item) => screenshotProfileKey(item) === screenshotProfileKey(nextCandidate))
        });
        if (sent?.message_id) {
          forgetScreenshotPreviewContext(session, callbackMessageId);
          await deleteMessage(chatId, callbackMessageId).catch(() => null);
        }
        return;
      }

      await answerCallback(callbackId, "", false).catch(() => null);
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`Не удалось обработать скриншот: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    } finally {
      releaseCardActionLock(session, lockKey);
    }
  }

  async function handlePickFromDownloadedCallback(chatId, callbackId, callbackMessageId, session, data) {
    const actionLock = acquireCardActionLock(session, callbackMessageId, "pick");
    if (!actionLock) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    try {
      const context = getCardContext(session, callbackMessageId);
      if (!context?.doc_id || !context?.segment_id) {
        await answerCallback(callbackId, "Карточка устарела. Запусти /sdvg заново.", true).catch(() => null);
        return;
      }

      if (data === "sdvg_pick:noop") {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (data === "sdvg_pick:close") {
        forgetFilePickerContext(session, callbackMessageId);
        await restoreCardKeyboard(chatId, callbackMessageId, session, context);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (data === "sdvg_pick:open") {
        const payload = await readDocPayload(context.doc_id);
        if (!payload) {
          await answerCallback(callbackId, "Документ недоступен.", true).catch(() => null);
          return;
        }
        const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
        if (!segment) {
          await answerCallback(callbackId, "Сегмент не найден.", true).catch(() => null);
          return;
        }
        const files = await collectDownloadedFilesForPicker(context.doc_id, segment);
        if (files.length === 0) {
          await answerCallback(callbackId, "Скачанных файлов пока нет.", true).catch(() => null);
          return;
        }
        const pickerContext = {
          token: createPickerToken(),
          doc_id: context.doc_id,
          segment_id: context.segment_id,
          files,
          page: 0
        };
        rememberFilePickerContext(session, callbackMessageId, pickerContext);
        await editMessageReplyMarkup(
          chatId,
          callbackMessageId,
          buildPickFromDownloadedKeyboard(pickerContext)
        ).catch(() => null);
        await answerCallback(callbackId, `Файлов: ${files.length}`, false).catch(() => null);
        return;
      }

      if (data.startsWith("sdvg_pick:page:")) {
        const picker = getFilePickerContext(session, callbackMessageId);
        if (!picker) {
          await answerCallback(callbackId, "Список устарел. Нажми 📂 снова.", true).catch(() => null);
          return;
        }
        const parts = data.split(":");
        const token = String(parts[2] ?? "").trim();
        const nextPage = Number.parseInt(String(parts[3] ?? ""), 10);
        if (!token || picker.token !== token || !Number.isFinite(nextPage)) {
          await answerCallback(callbackId, "", false).catch(() => null);
          return;
        }
        const maxPage = Math.max(0, Math.ceil((picker.files?.length ?? 0) / FILE_PICKER_PAGE_SIZE) - 1);
        picker.page = Math.max(0, Math.min(maxPage, nextPage));
        rememberFilePickerContext(session, callbackMessageId, picker);
        await editMessageReplyMarkup(chatId, callbackMessageId, buildPickFromDownloadedKeyboard(picker)).catch(
          () => null
        );
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (data.startsWith("sdvg_pick:sel:")) {
        const picker = getFilePickerContext(session, callbackMessageId);
        if (!picker) {
          await answerCallback(callbackId, "Список устарел. Нажми 📂 снова.", true).catch(() => null);
          return;
        }
        const parts = data.split(":");
        const token = String(parts[2] ?? "").trim();
        const index = Number.parseInt(String(parts[3] ?? ""), 10);
        if (!token || picker.token !== token || !Number.isFinite(index)) {
          await answerCallback(callbackId, "", false).catch(() => null);
          return;
        }
        const picked = Array.isArray(picker.files) ? picker.files[index] : null;
        if (!picked?.path) {
          await answerCallback(callbackId, "Файл не найден в списке.", true).catch(() => null);
          return;
        }
        await appendSegmentMediaPaths(
          context.doc_id,
          context.segment_id,
          [picked.path],
          chatId,
          "sdvg_pick_existing"
        );
        const payload = await readDocPayload(context.doc_id);
        const pickedSegment = payload?.segments?.find((item) => item.segment_id === context.segment_id) ?? {
          segment_id: context.segment_id
        };
        await registerSegmentMediaAssets({
          chatId,
          session,
          segment: pickedSegment,
          relativePaths: [picked.path],
          source: "sdvg_pick_existing"
        });
        forgetFilePickerContext(session, callbackMessageId);
        await restoreCardKeyboard(chatId, callbackMessageId, session, context);
        await answerCallback(
          callbackId,
          clipText(`Добавил в ${context.segment_id}: ${path.basename(picked.path)}`, CALLBACK_ALERT_MAX),
          false
        ).catch(() => null);
        return;
      }

      await answerCallback(callbackId, "", false).catch(() => null);
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`Не удалось выбрать файл: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    } finally {
      releaseCardActionLock(session, actionLock);
    }
  }
  async function handleCallbackQuery(update) {
    const callback = update?.callback_query;
    if (!callback) return;
    const data = String(callback?.data ?? "").trim();
    const chatId = callback?.message?.chat?.id;
    const messageId = callback?.message?.message_id;
    const callbackId = callback?.id;
    if (!chatId || !callbackId) return;
    const session = getSession(chatId);

    if (data.startsWith("sdvg_pick:")) {
      await handlePickFromDownloadedCallback(chatId, callbackId, messageId, session, data);
      return;
    }
    if (data === "sdvg_rs:open") {
      await handleResearchOpenCallback(chatId, callbackId, messageId, session);
      return;
    }
    if (data.startsWith("sdvg_rs:")) {
      await handleResearchSuggestionCallback(chatId, callbackId, messageId, session, data);
      return;
    }
    if (data.startsWith("sdvg_shot:")) {
      await handleScreenshotPreviewCallback(chatId, callbackId, messageId, session, data);
      return;
    }
    if (data === "sdvg_cheer:mute") {
      await handleSdvgCheerMuteCallback(chatId, callbackId, messageId, session);
      return;
    }

    if (data === "sdvg_next") {
      await handleNextSegmentCallback(chatId, callbackId, messageId, session);
      return;
    }
    if (data === "sdvg_done") {
      await handleDoneSegmentCallback(chatId, callbackId, messageId, session);
      return;
    }
    if (data === "sdvg_done_banner") {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    if (data === "sdvg_mode:toggle") {
      await handleModeToggleCallback(chatId, callbackId, messageId, session);
      return;
    }
    if (data.startsWith("sdvg_meta:")) {
      const key = data.slice("sdvg_meta:".length);
      await handleMetaCallback(callbackId, messageId, session, key);
      return;
    }

    await answerCallback(callbackId, "", false).catch(() => null);
  }

  function parseSdvgCommand(text) {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const match = value.match(/^\/sdvg(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
    if (!match) return null;
    const rawArgs = String(match[1] ?? "").trim();
    const tokens = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    let docId = "";
    let randomMode = null;
    tokens.forEach((token) => {
      const normalized = token.toLowerCase();
      if (["random", "rnd", "rand", "mix", "случайно", "рандом"].includes(normalized)) {
        randomMode = true;
        return;
      }
      if (["seq", "order", "sequential", "порядок", "по-порядку", "попорядку"].includes(normalized)) {
        randomMode = false;
        return;
      }
      if (!docId) docId = token;
    });
    return {
      docId,
      randomMode
    };
  }

  function parseDownloadCommand(text) {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const match = value.match(/^\/(?:download|donwload)(?:@[a-z0-9_]+)?$/i);
    return match ? {} : null;
  }

  async function handleDownloadCommand(chatId, userId) {
    const session = getSession(chatId);
    session.active_segment_id = null;
    session.sdvg_cheer_muted = false;
    session.sdvg_cheer_next_at = 0;
    await clearSdvgEncouragementMessage(chatId, session);
    session.card_contexts.clear();
    session.file_picker_contexts.clear();
    session.research_suggestion_contexts.clear();
    session.research_status_message_ids.clear();
    session.screenshot_preview_contexts.clear();
    session.card_action_locks.clear();
    await syncSessionState(chatId, session, {
      userId,
      mode: "download",
      activeDocumentId: session?.doc_id,
      activeSegmentId: ""
    });
    await sendMessage(
      chatId,
      "Режим /download включен. Привязка к сегменту сброшена, скачиваемые ссылки будут уходить прямо в UNSORTED. Для возврата в сценарий снова запусти /sdvg."
    );
  }

  async function handleIncomingMessage(update) {
    const message = update?.message;
    const chatId = message?.chat?.id;
    const userId = message?.from?.id;
    if (!message || !chatId) return;
    const text = String(message?.text ?? "").trim();
    if (/^\/start(?:@[a-z0-9_]+)?$/i.test(text)) {
      await sendMessage(
        chatId,
        [
          "SDVG-режим включен.",
          "Команды:",
          "• /sdvg — открыть текущий документ",
          "• /sdvg <doc_id> — открыть конкретный документ",
          "• /sdvg random — случайный следующий сегмент",
          "• /sdvg order — следующий сегмент по порядку",
          "\u041a\u043d\u043e\u043f\u043a\u0430 \u2705 \u043e\u0442\u043c\u0435\u0447\u0430\u0435\u0442 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0441\u0435\u0433\u043c\u0435\u043d\u0442 \u043a\u0430\u043a \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0438 \u0441\u0440\u0430\u0437\u0443 \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0441\u0435\u0433\u043c\u0435\u043d\u0442.",
          "Поддерживаются ссылки и медиафайлы в Telegram."
        ].join("\n")
      );
      return;
    }

    const command = parseSdvgCommand(text);
    if (command) {
      await syncSessionState(chatId, getSession(chatId), {
        userId,
        mode: "sdvg"
      });
      await handleSdvgCommand(chatId, command.docId, command.randomMode);
      return;
    }

    if (parseDownloadCommand(text)) {
      await handleDownloadCommand(chatId, userId);
      return;
    }

    const session = getSession(chatId);
    if (session?.mode === "download") {
      const messageText = String(message?.text ?? message?.caption ?? "");
      const urls = extractUrls(messageText);
      const downloadableUrl = urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null;
      if (downloadableUrl) {
        await handleInboxUrlInput(chatId, session, message, downloadableUrl);
        return;
      }
      if (text && !text.startsWith("/")) {
        await sendMessage(chatId, "В /download режиме отправляй только скачиваемые ссылки. Для сегментов снова запусти /sdvg.");
      }
      return;
    }
    const active = await resolveActiveSegment(session);
    const messageText = String(message?.text ?? message?.caption ?? "");
    const mediaItems = collectMessageMediaItems(message);
    const urls = extractUrls(messageText);
    if (!active) {
      const created = await createInboxAssetsFromMessage(chatId, session, message, mediaItems);
      await syncSessionState(chatId, session, {
        userId,
        mode: "inbox"
      });
      const supportedInboxUrl =
        mediaItems.length === 0 ? urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null : null;
      if (supportedInboxUrl) {
        await handleInboxUrlInput(chatId, session, message, supportedInboxUrl);
        return;
      }
      if ((mediaItems.length > 0 || urls.length > 0 || (text && !text.startsWith("/"))) && created.length > 0) {
        await sendMessage(
          chatId,
          "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0430 \u043D\u0435\u0442. " +
            `\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u043B \u0432 Inbox: ${created.length}. ` +
            "\u0417\u0430\u043F\u0443\u0441\u0442\u0438 /sdvg, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C \u043A \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0443."
        );
        return;
      }
      if (text && !text.startsWith("/")) {
        await sendMessage(chatId, "Нет активного сегмента. Запусти /sdvg.");
      }
      return;
    }
    const { segment } = active;
    await syncSessionState(chatId, session, {
      userId,
      mode: "sdvg",
      activeDocumentId: session?.doc_id,
      activeSegmentId: segment?.segment_id
    });
    if (mediaItems.length > 0) {
      await handleTelegramMediaInput(chatId, session, segment, mediaItems);
      return;
    }

    const supportedUrl = urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null;
    const fallbackUrl = urls.find((item) => isHttpUrl(item)) ?? null;
    const inputUrl = supportedUrl ?? fallbackUrl;
    if (inputUrl) {
      const mediaStartTimecode = extractMediaStartTimecode(messageText, inputUrl);
      await handleUrlScreenshotPreview(chatId, session, segment, inputUrl, mediaStartTimecode, message?.message_id);
      return;
    }

    const plainText = String(message?.text ?? "").trim();
    if (plainText && !plainText.startsWith("/")) {
      await appendVisualDescription(session.doc_id, segment.segment_id, plainText, chatId);
      await createAssetRecord(
        {
          kind: "note",
          status: "processed",
          title: clipText(plainText, 120),
          description: plainText,
          telegramChatId: String(chatId),
          telegramMessageId: String(message?.message_id ?? ""),
          processingState: "attached",
          originType: "sdvg_segment",
          originId: String(segment?.segment_id ?? ""),
          meta: {
            source: "telegram_sdvg"
          }
        },
        {
          documentId: session?.doc_id,
          segmentId: segment?.segment_id,
          role: "note",
          attachedBy: "telegram_sdvg"
        }
      );
      await sendMessage(chatId, `\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0432 ${segment.segment_id}.`);
    }
  }

  async function processUpdate(update) {
    if (update?.callback_query) {
      await handleCallbackQuery(update);
      return;
    }
    if (update?.message) {
      await handleIncomingMessage(update);
    }
  }

  async function pollLoop() {
    try {
      const me = await telegramApiCall("getMe", {}, 15000);
      state.botUsername = String(me?.username ?? "").trim() || null;
      console.log(`[telegram-sdvg] Bot connected${state.botUsername ? ` as @${state.botUsername}` : ""}`);
    } catch (error) {
      console.error(`[telegram-sdvg] Failed to initialize bot: ${error?.message ?? error}`);
      state.running = false;
      return;
    }

    while (state.running) {
      try {
        const updates = await telegramApiCall(
          "getUpdates",
          {
            offset: state.offset,
            timeout: pollTimeoutSec,
            allowed_updates: ["message", "callback_query"]
          },
          pollTimeoutSec * 1000 + 15000
        );
        if (!Array.isArray(updates) || updates.length === 0) {
          continue;
        }
        for (const update of updates) {
          state.offset = Math.max(state.offset, Number(update?.update_id ?? 0) + 1);
          try {
            await processUpdate(update);
          } catch (error) {
            console.error(`[telegram-sdvg] Update handler failed: ${error?.message ?? error}`);
          }
        }
      } catch (error) {
        console.error(`[telegram-sdvg] Polling failed: ${error?.message ?? error}`);
        await delay(POLL_RETRY_DELAY_MS);
      }
    }
  }

  function getRuntimeInfo() {
    return {
      enabled: state.enabled,
      configured: state.configured,
      running: state.running,
      default_doc_id: defaultDocId || null,
      bot_username: state.botUsername,
      api_base: apiBaseRoot,
      file_base: fileBaseRoot,
      official_api: usingOfficialApi
    };
  }

  function start() {
    if (!state.enabled) {
      if (enabled && !token) {
        console.warn("[telegram-sdvg] TELEGRAM_SDVG_ENABLED=1, but TELEGRAM_BOT_TOKEN is empty.");
      }
      return false;
    }
    if (state.running) return true;
    state.running = true;
    void pollLoop();
    return true;
  }

  function stop() {
    state.running = false;
  }

  return {
    getRuntimeInfo,
    start,
    stop
  };
}
