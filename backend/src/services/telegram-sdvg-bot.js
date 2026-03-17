import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "./normalizers.js";

const TELEGRAM_MESSAGE_MAX = 4096;
const CALLBACK_ALERT_MAX = 190;
const TELEGRAM_CAPTION_MAX = 1024;
const CARD_CONTEXT_MAX = 80;
const JOB_WATCH_INTERVAL_MS = 1600;
const POLL_RETRY_DELAY_MS = 2500;
const DOWNLOAD_TRACK_TIMEOUT_MS = 30 * 60 * 1000;
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

function collectMessageMediaItems(message = {}) {
  const items = [];

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    if (photo?.file_id) {
      const unique = String(photo.file_unique_id ?? Date.now());
      items.push({
        fileId: String(photo.file_id),
        fileName: `photo_${unique}.jpg`,
        kind: "photo"
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
      kind: entry.kind
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
    collapseDuplicateLinkOnlyTopics,
    ensureMediaDir,
    getDocDir,
    getMediaDir,
    isHttpUrl,
    isMediaAlreadyDownloaded,
    isYtDlpCandidateUrl,
    listDocuments,
    mediaDownloader,
    mergeLinkSegmentsBySection,
    normalizeDocumentMediaDownloads,
    normalizeLinkSegmentsInput,
    normalizeLinkUrl,
    readOptionalJson,
    sanitizeMediaTopicName,
    saveVersioned,
    splitSegmentsAndDecisions
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
        card_contexts: new Map(),
        card_action_locks: new Set()
      });
    }
    return state.sessions.get(key);
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
    session.card_contexts.delete(String(messageId));
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

  function deriveQualityLabel({ formatNote, resolution, fileName, isVideo }) {
    const note = String(formatNote ?? "").trim();
    if (note) return note;

    const fromName = String(fileName ?? "").match(/(?:^|[\s._-])(\d{3,4}p)(?=$|[\s._-])/i)?.[1];
    if (fromName) return fromName;

    const match = String(resolution ?? "").trim().match(/^(\d{2,5})x(\d{2,5})$/i);
    if (match) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      const side = Math.min(a, b);
      if (Number.isFinite(side) && side >= 144) return `${side}p`;
    }

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

  async function sendDownloadedMediaBackToChat(chatId, segmentId, sourceUrl, mediaPaths = [], metadata = null) {
    if (!chatId) return;
    const mediaRoot = path.resolve(getMediaDir());
    const unique = Array.from(
      new Set(
        (Array.isArray(mediaPaths) ? mediaPaths : [])
          .map((item) => normalizeRelativeMediaPath(item))
          .filter(Boolean)
      )
    );

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

      await telegramApiCallMultipart(method, payload, fileField, absolutePath, fileName, 180000).catch(
        async (error) => {
          await sendMessage(
            chatId,
            `\u0424\u0430\u0439\u043B \u0441\u043A\u0430\u0447\u0430\u043D, \u043D\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E: ${fileName} (${error?.message ?? error})`
          ).catch(() => null);
        }
      );
    }
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
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return null;
    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    return {
      document,
      segments: normalizeSegmentList(segments),
      decisions: Array.isArray(decisions) ? decisions : []
    };
  }

  function getOpenSegments(segments) {
    return segments.filter((segment) => !Boolean(segment?.is_done));
  }

  function resolveComment(segment, decision) {
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    return String(
      visual.description ||
        segment?.comment ||
        segment?.comments ||
        decision?.comment ||
        decision?.comments ||
        ""
    ).trim();
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
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) throw new Error("Document not found");

      const segmentsRaw = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
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

    const ordered = Array.isArray(payload?.segments) ? payload.segments : [];
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
    const segment = payload.segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
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
    rememberCardContext(session, message?.message_id, {
      doc_id: docId,
      segment_id: segment.segment_id
    });
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
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) throw new Error("Document not found");
      const segments = normalizeSegmentList((await readOptionalJson(path.join(dir, "segments.json"))) ?? []);
      const segment = segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (!segment) throw new Error("Segment not found");
      const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) throw new Error("Document not found");
      const segments = normalizeSegmentList((await readOptionalJson(path.join(dir, "segments.json"))) ?? []);
      const segment = segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (!segment) throw new Error("Segment not found");

      const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) throw new Error("Document not found");

      const segmentsRaw = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
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
      const decisionsRaw = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return [];

    const normalizeUrl = (value) =>
      typeof normalizeLinkUrl === "function" ? normalizeLinkUrl(value) : String(value ?? "").trim();
    const targetUrl = normalizeUrl(rawUrl);
    if (!targetUrl) return [];

    const downloadedMap = normalizeDocumentMediaDownloads(document.media_downloads);
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
    mediaStartTimecode = null
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
        const topic = sanitizeMediaTopicName(sectionTitle);
        const attachedPaths = Array.isArray(job.output_files)
          ? job.output_files
              .map((outputFile) => normalizeRelativeMediaPath(`${topic}/${normalizeRelativeMediaPath(outputFile)}`))
              .filter(Boolean)
          : [];
        if (attachedPaths.length > 0) {
          await appendSegmentMediaPaths(docId, segmentId, attachedPaths, chatId, "yt_dlp_url", mediaStartTimecode);
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
  async function handleUrlInput(chatId, session, segment, url, mediaStartTimecode = null) {
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
      const document = await readOptionalJson(path.join(getDocDir(session.doc_id), "document.json"));
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
          await sendMessage(
            chatId,
            `\u0423\u0436\u0435 \u0441\u043A\u0430\u0447\u0430\u043D\u043E. \u0414\u043E\u0431\u0430\u0432\u0438\u043B \u0432 ${segment.segment_id}: ${cachedPaths.length} \u0444\u0430\u0439\u043B(\u043E\u0432).`
          );
          await sendDownloadedMediaBackToChat(chatId, segment.segment_id, url, cachedPaths).catch(() => null);
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
      mediaStartTimecode: normalizedMediaStartTimecode
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
      if (savedPath) attachedPaths.push(savedPath);
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
    const segment = payload.segments.find(
      (item) => String(item?.segment_id ?? "") === String(session.active_segment_id)
    );
    if (!segment) return null;
    return { payload, segment };
  }

  async function handleSdvgCommand(chatId, requestedDocId = "", randomModeOverride = null) {
    const session = getSession(chatId);
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

      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      const openSegments = getOpenSegments(payload.segments);
      if (openSegments.length === 0) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
        forgetCardContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      const nextSegment = resolveNextOpenSegment(payload, context.segment_id, Boolean(session?.random_mode));
      if (!nextSegment) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
        forgetCardContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        await sendMessage(chatId, "\u041D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044B\u0435 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u044B \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C.");
        return;
      }

      await answerCallback(callbackId, "", false).catch(() => null);
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

      forgetCardContext(session, callbackMessageId);
      await editMessageReplyMarkup(chatId, callbackMessageId, buildDoneBannerKeyboard()).catch(() => null);
      await answerCallback(callbackId, "", false).catch(() => null);

      const nextSegment = resolveNextOpenSegment(payload, context.segment_id, Boolean(session?.random_mode));
      if (!nextSegment) {
        session.doc_id = context.doc_id;
        session.active_segment_id = null;
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
    const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
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
  async function handleCallbackQuery(update) {
    const callback = update?.callback_query;
    if (!callback) return;
    const data = String(callback?.data ?? "").trim();
    const chatId = callback?.message?.chat?.id;
    const messageId = callback?.message?.message_id;
    const callbackId = callback?.id;
    if (!chatId || !callbackId) return;
    const session = getSession(chatId);

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

  async function handleIncomingMessage(update) {
    const message = update?.message;
    const chatId = message?.chat?.id;
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
      await handleSdvgCommand(chatId, command.docId, command.randomMode);
      return;
    }

    const session = getSession(chatId);
    const active = await resolveActiveSegment(session);
    if (!active) {
      if (text && !text.startsWith("/")) {
        await sendMessage(chatId, "Нет активного сегмента. Запусти /sdvg.");
      }
      return;
    }
    const { segment } = active;
    const messageText = String(message?.text ?? message?.caption ?? "");
    const mediaItems = collectMessageMediaItems(message);
    if (mediaItems.length > 0) {
      await handleTelegramMediaInput(chatId, session, segment, mediaItems);
      return;
    }

    const urls = extractUrls(messageText);
    const supportedUrl = urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null;
    const fallbackUrl = urls.find((item) => isHttpUrl(item)) ?? null;
    const inputUrl = supportedUrl ?? fallbackUrl;
    if (inputUrl) {
      const mediaStartTimecode = extractMediaStartTimecode(messageText, inputUrl);
      await handleUrlInput(chatId, session, segment, inputUrl, mediaStartTimecode);
      return;
    }

    const plainText = String(message?.text ?? "").trim();
    if (plainText && !plainText.startsWith("/")) {
      await appendVisualDescription(session.doc_id, segment.segment_id, plainText, chatId);
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

