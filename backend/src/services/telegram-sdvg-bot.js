import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { loadIndexedArrayWithFallback, loadIndexedObjectWithFallback } from "./indexed-fallback-loaders.js";
import {
  applyVisualDecisionFieldOrigins,
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "./normalizers.js";
import { extractSourceScopeKey } from "./source-identity.js";
import { isBlockedResearchDomain, isUaResearchDomain } from "./source-profiles.js";
import { pickWritableSegments } from "./link-integrity.js";
import { buildSdvgHelpText, SDVG_MESSAGES } from "./telegram-sdvg-messages.js";

const TELEGRAM_MESSAGE_MAX = 4096;
const CALLBACK_ALERT_MAX = 190;
const TELEGRAM_CAPTION_MAX = 1024;
const CARD_CONTEXT_MAX = 80;
const FILE_PICKER_CONTEXT_MAX = 80;
const RESEARCH_SUGGESTION_CONTEXT_MAX = 160;
const SCREENSHOT_PREVIEW_CONTEXT_MAX = 120;
const RESEARCH_SUGGESTION_TOP_LIMIT = 5;
const RESEARCH_CATEGORY_ORDER = ["video", "preview", "quotes", "images", "other"];
const FILE_PICKER_PAGE_SIZE = 8;
const DOWNLOAD_THEME_PAGE_SIZE = 8;
const TELEGRAM_MEDIA_GROUP_LIMIT = 10;
const JOB_WATCH_INTERVAL_MS = 1600;
const POLL_RETRY_DELAY_MS = 2500;
const DOWNLOAD_TRACK_TIMEOUT_MS = 30 * 60 * 1000;
const INBOX_MEDIA_GROUP_WAIT_MS = 1200;
const SDVG_CHEER_MIN_DELAY_MS = 35 * 60 * 1000;
const SDVG_CHEER_MAX_DELAY_MS = 75 * 60 * 1000;
const LOG_LEVEL_WEIGHTS = { error: 0, warn: 1, info: 2, debug: 3 };
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

function getResearchCategoryPresentation(categoryId = "") {
  const normalized = String(categoryId ?? "").trim().toLowerCase();
  if (normalized === "video") return { icon: "\uD83C\uDFAC", label: "\u0412\u0438\u0434\u0435\u043E" };
  if (normalized === "preview") return { icon: "\uD83D\uDDBC\uFE0F", label: "\u041F\u0440\u0435\u0432\u044C\u044E" };
  if (normalized === "quotes") {
    return { icon: "\uD83D\uDCDD", label: "\u0426\u0438\u0442\u0430\u0442\u044B \u0438 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438" };
  }
  if (normalized === "images") return { icon: "\uD83D\uDDBC\uFE0F", label: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F" };
  return { icon: "\uD83E\uDDF9", label: "\u0414\u0440\u0443\u0433\u043E\u0435" };
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
  const translationSeed = [compactText(segment?.text_quote), compactText(segment?.section_context_text)]
    .filter(Boolean)
    .join(". ")
    .slice(0, 320);
  if (!translationSeed || typeof translateHeadingToEnglishQuery !== "function") {
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: ""
    };
  }
  try {
    const translated = compactText(await translateHeadingToEnglishQuery(translationSeed));
    return {
      ...segment,
      visual_decision: normalizedVisualDecision,
      search_decision: normalizedSearchDecision,
      translated_text_quote: translated && translated.toLowerCase() !== translationSeed.toLowerCase() ? translated : ""
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

function parseIgnoredThreadKeys(value) {
  const items = String(value ?? "")
    .split(/[,\n;]/)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const result = new Set();
  items.forEach((item) => {
    const normalized = item.replace(/\s+/g, "");
    if (!normalized) return;
    if (/^-?\d+:\d+$/.test(normalized) || /^\d+$/.test(normalized)) {
      result.add(normalized);
    }
  });
  return result;
}

function extractUpdateThreadContext(update) {
  const callbackMessage = update?.callback_query?.message;
  const message = update?.message ?? callbackMessage ?? null;
  const chatId = message?.chat?.id ?? null;
  const threadId = message?.message_thread_id ?? null;
  if (!chatId || !threadId) return null;
  return {
    chatId: String(chatId),
    threadId: String(threadId),
    key: `${String(chatId)}:${String(threadId)}`
  };
}

export function isTelegramSdvgControlCommandText(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return /^\/(?:start|sdvg|download|donwload|research|notion|threadid|topicid)(?:@[a-z0-9_]+)?(?:\s|$)/i.test(value);
}

export function isTelegramSdvgControlUpdate(update) {
  const callbackData = String(update?.callback_query?.data ?? "").trim();
  if (callbackData && callbackData.startsWith("sdvg_")) return true;
  const message = update?.message ?? null;
  return isTelegramSdvgControlCommandText(message?.text ?? message?.caption ?? "");
}

function toSessionTouchTimestamp(value = Date.now()) {
  const parsed =
    value instanceof Date ? value.getTime() : Number.isFinite(Number(value)) ? Number(value) : Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function createEmptyTelegramSdvgSession(defaultDocId = null, lastTouchedAt = Date.now()) {
  return {
    doc_id: defaultDocId || null,
    mode: "inbox",
    active_segment_id: null,
    random_mode: false,
    sdvg_cheer_muted: false,
    sdvg_encouragement_message_id: null,
    sdvg_cheer_next_at: 0,
    project_archive_request: null,
    card_contexts: new Map(),
    file_picker_contexts: new Map(),
    research_suggestion_contexts: new Map(),
    research_status_message_ids: new Map(),
    download_theme_contexts: new Map(),
    selected_download_theme: "",
    ad_hoc_research_query: "",
    ad_hoc_research_card_id: "",
    ad_hoc_research_seen_keys: new Set(),
    pending_inbox_media_groups: new Map(),
    pending_sdvg_media_groups: new Map(),
    telegram_media_batches: new Map(),
    download_theme_create_request: null,
    download_theme_search_request: null,
    screenshot_preview_contexts: new Map(),
    card_action_locks: new Set(),
    __last_touched_at: toSessionTouchTimestamp(lastTouchedAt)
  };
}

export function touchTelegramSdvgSession(session, at = Date.now()) {
  if (!session || typeof session !== "object") return session;
  session.__last_touched_at = toSessionTouchTimestamp(at);
  return session;
}

export function clearTelegramSdvgSessionEphemeralState(session) {
  if (!session || typeof session !== "object") return session;
  const pendingGroups =
    session.pending_inbox_media_groups instanceof Map ? Array.from(session.pending_inbox_media_groups.values()) : [];
  const pendingSdvgGroups =
    session.pending_sdvg_media_groups instanceof Map ? Array.from(session.pending_sdvg_media_groups.values()) : [];
  [...pendingGroups, ...pendingSdvgGroups].forEach((entry) => {
    if (entry?.timeout) {
      clearTimeout(entry.timeout);
    }
  });
  if (session.card_contexts instanceof Map) session.card_contexts.clear();
  if (session.file_picker_contexts instanceof Map) session.file_picker_contexts.clear();
  if (session.research_suggestion_contexts instanceof Map) session.research_suggestion_contexts.clear();
  if (session.research_status_message_ids instanceof Map) session.research_status_message_ids.clear();
  if (session.download_theme_contexts instanceof Map) session.download_theme_contexts.clear();
  if (session.pending_inbox_media_groups instanceof Map) session.pending_inbox_media_groups.clear();
  if (session.pending_sdvg_media_groups instanceof Map) session.pending_sdvg_media_groups.clear();
  if (session.telegram_media_batches instanceof Map) session.telegram_media_batches.clear();
  if (session.screenshot_preview_contexts instanceof Map) session.screenshot_preview_contexts.clear();
  if (session.card_action_locks instanceof Set) session.card_action_locks.clear();
  session.download_theme_create_request = null;
  session.download_theme_search_request = null;
  session.sdvg_encouragement_message_id = null;
  session.project_archive_request = null;
  return session;
}

export function sweepIdleTelegramSdvgSessions(sessions, options = {}) {
  if (!(sessions instanceof Map)) {
    return { scanned_count: 0, removed_count: 0, removed_chat_ids: [] };
  }
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Math.max(60_000, Number(options.ttlMs)) : 12 * 60 * 60 * 1000;
  const now = toSessionTouchTimestamp(options.now ?? Date.now());
  const removedChatIds = [];
  for (const [chatId, session] of sessions.entries()) {
    const lastTouchedAt = toSessionTouchTimestamp(session?.__last_touched_at ?? session?.last_seen_at ?? 0);
    if (now - lastTouchedAt < ttlMs) continue;
    clearTelegramSdvgSessionEphemeralState(session);
    sessions.delete(chatId);
    removedChatIds.push(String(chatId ?? ""));
    if (typeof options.onDelete === "function") {
      options.onDelete(chatId, session);
    }
  }
  return {
    scanned_count: sessions.size + removedChatIds.length,
    removed_count: removedChatIds.length,
    removed_chat_ids: removedChatIds
  };
}

export function buildDownloadThemeMoveAuditPayload({ chatId, context = {}, selectedTheme = "", movedItems = [] } = {}) {
  const normalizedItems = Array.isArray(movedItems) ? movedItems : [];
  return {
    chat_id: String(chatId ?? ""),
    doc_id: String(context?.doc_id ?? "") || null,
    segment_id: String(context?.segment_id ?? "") || null,
    theme: String(selectedTheme ?? "").trim(),
    item_count: normalizedItems.length,
    strategies: normalizedItems.map((item) => String(item?.move_strategy ?? "")),
    all_source_deleted: normalizedItems.every(
      (item) => Boolean(item?.source_deleted) || String(item?.move_strategy ?? "") === "already_in_theme"
    ),
    reused_existing_count: normalizedItems.filter((item) => item?.reused_existing).length,
    renamed_with_suffix_count: normalizedItems.filter((item) => item?.renamed_with_suffix).length,
    moved_paths: normalizedItems.map((item) => ({
      previous_relative_path: item?.relative_path ?? "",
      next_relative_path: item?.next_relative_path ?? "",
      asset_id: item?.asset_id ?? null,
      move_strategy: item?.move_strategy ?? null,
      source_deleted: Boolean(item?.source_deleted),
      reused_existing: Boolean(item?.reused_existing),
      renamed_with_suffix: Boolean(item?.renamed_with_suffix)
    }))
  };
}

export function ensureTelegramMediaBatchMap(session) {
  if (!session || typeof session !== "object") return new Map();
  if (!(session.telegram_media_batches instanceof Map)) {
    session.telegram_media_batches = new Map();
  }
  return session.telegram_media_batches;
}

function normalizeTelegramMediaBatchFailedItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      return {
        file_id: compactText(item.file_id ?? item.fileId),
        file_unique_id: compactText(item.file_unique_id ?? item.fileUniqueId),
        file_name: compactText(item.file_name ?? item.fileName),
        mime_type: compactText(item.mime_type ?? item.mimeType),
        kind: compactText(item.kind),
        error: compactText(item.error),
        retry_count: Math.max(0, Number(item.retry_count ?? item.retryCount ?? 0) || 0)
      };
    })
    .filter((item) => item?.file_id)
    .slice(0, 32);
}

export function upsertTelegramMediaBatchAudit(session, batchId, patch = {}) {
  const normalizedBatchId = compactText(batchId);
  if (!normalizedBatchId) return null;
  const batches = ensureTelegramMediaBatchMap(session);
  const nowIso = new Date().toISOString();
  const current = batches.get(normalizedBatchId) ?? {
    batch_id: normalizedBatchId,
    expected: 0,
    downloaded: 0,
    failed: 0,
    retried: 0,
    status: "queued",
    failed_items: [],
    created_at: nowIso,
    updated_at: nowIso
  };
  const next = {
    ...current,
    ...patch,
    batch_id: normalizedBatchId,
    expected: Math.max(0, Number(patch.expected ?? current.expected ?? 0) || 0),
    downloaded: Math.max(0, Number(patch.downloaded ?? current.downloaded ?? 0) || 0),
    failed: Math.max(0, Number(patch.failed ?? current.failed ?? 0) || 0),
    retried: Math.max(0, Number(patch.retried ?? current.retried ?? 0) || 0),
    failed_items: normalizeTelegramMediaBatchFailedItems(patch.failed_items ?? current.failed_items),
    created_at: String(current.created_at ?? nowIso),
    updated_at: nowIso
  };
  batches.set(normalizedBatchId, next);
  if (batches.size > 40) {
    const oldestKey = batches.keys().next().value;
    if (oldestKey && oldestKey !== normalizedBatchId) {
      batches.delete(oldestKey);
    }
  }
  return next;
}

export function getTelegramMediaBatchAudit(session, batchId) {
  const normalizedBatchId = compactText(batchId);
  if (!normalizedBatchId) return null;
  return ensureTelegramMediaBatchMap(session).get(normalizedBatchId) ?? null;
}

export function buildTelegramAssetPathRepairPlan(assets = [], existingRelativePaths = []) {
  const normalizedExistingPaths = (Array.isArray(existingRelativePaths) ? existingRelativePaths : [])
    .map((item) => normalizeRelativeMediaPath(item))
    .filter(Boolean);
  const existingPathSet = new Set(normalizedExistingPaths.map((item) => item.toLowerCase()));
  const existingByName = new Map();
  normalizedExistingPaths.forEach((relativePath) => {
    const fileNameKey = path.basename(relativePath).toLowerCase();
    if (!fileNameKey) return;
    if (!existingByName.has(fileNameKey)) {
      existingByName.set(fileNameKey, []);
    }
    existingByName.get(fileNameKey).push(relativePath);
  });

  return (Array.isArray(assets) ? assets : [])
    .map((asset) => {
      const assetId = String(asset?.id ?? "").trim();
      const previousRelativePath = normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? "");
      if (!assetId || !previousRelativePath) return null;
      if (!previousRelativePath.toLowerCase().startsWith("unsorted/")) return null;
      if (existingPathSet.has(previousRelativePath.toLowerCase())) return null;
      const fileNameKey = path.basename(previousRelativePath).toLowerCase();
      if (!fileNameKey) return null;
      const matches = [...new Set(existingByName.get(fileNameKey) ?? [])];
      if (matches.length !== 1) return null;
      return {
        asset_id: assetId,
        previous_relative_path: previousRelativePath,
        next_relative_path: matches[0]
      };
    })
    .filter(Boolean);
}

function isVideoFilePath(value) {
  return /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i.test(String(value ?? ""));
}

function isImageFilePath(value) {
  return /\.(png|jpe?g|webp|gif|bmp)(?:$|[?#])/i.test(String(value ?? ""));
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
    /(?:тайм[- ]?код|таймкод|timecode|start(?:s)?\s+at|from|с\s+таймкода|начиная\s+с)\s*[:=]?\s*([0-9hms:\s]+)/i
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

function getMessageMediaGroupId(message = {}) {
  const raw = String(message?.media_group_id ?? "").trim();
  return raw || "";
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
    listAssets,
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
    updateAsset,
    listBotSessions,
    upsertBotSession
  } = deps;

  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const enabled = String(process.env.TELEGRAM_SDVG_ENABLED ?? "1") !== "0";
  const defaultDocId = String(process.env.TELEGRAM_SDVG_DOC_ID ?? "").trim();
  const pollTimeoutSecRaw = Number(process.env.TELEGRAM_SDVG_POLL_TIMEOUT_SEC ?? 25);
  const pollTimeoutSec = Number.isFinite(pollTimeoutSecRaw) ? Math.max(5, Math.min(50, pollTimeoutSecRaw)) : 25;
  const dropPendingUpdatesOnStart = String(process.env.TELEGRAM_SDVG_DROP_PENDING_ON_START ?? "1") !== "0";
  const ignoredThreadKeys = parseIgnoredThreadKeys(process.env.TELEGRAM_SDVG_IGNORED_THREAD_KEYS ?? "");
  const sessionTtlMs = Number.isFinite(Number(process.env.TELEGRAM_SDVG_SESSION_TTL_MS))
    ? Math.max(60_000, Number(process.env.TELEGRAM_SDVG_SESSION_TTL_MS))
    : 12 * 60 * 60 * 1000;
  const sessionCleanupIntervalMs = Number.isFinite(Number(process.env.TELEGRAM_SDVG_SESSION_CLEANUP_MS))
    ? Math.max(60_000, Number(process.env.TELEGRAM_SDVG_SESSION_CLEANUP_MS))
    : 10 * 60 * 1000;
  const apiBaseRoot = trimTrailingSlashes(process.env.TELEGRAM_BASE_API_URL ?? "https://api.telegram.org/bot");
  const fileBaseRootRaw = trimTrailingSlashes(process.env.TELEGRAM_BASE_FILE_URL ?? "");
  const usingOfficialApi = isOfficialTelegramApiBase(apiBaseRoot);
  const localStoragePrefix = String(
    process.env.TELEGRAM_LOCAL_STORAGE_PREFIX ?? "/var/lib/telegram-bot-api/"
  ).trim();
  const dockerContainerName = String(process.env.TELEGRAM_DOCKER_CONTAINER_NAME ?? "tgbotapi").trim();
  const dockerCopyFallbackEnabled = String(process.env.TELEGRAM_DOCKER_COPY_FALLBACK ?? "1") !== "0";
  const themeMoveLogLevel = (() => {
    const raw = String(process.env.TELEGRAM_THEME_MOVE_LOG_LEVEL ?? "warn").trim().toLowerCase();
    if (raw && Object.prototype.hasOwnProperty.call(LOG_LEVEL_WEIGHTS, raw)) return raw;
    return "warn";
  })();
  const fileBaseRoot =
    fileBaseRootRaw || (usingOfficialApi ? "https://api.telegram.org/file" : deriveLocalFileBaseUrl(apiBaseRoot));

  function isIgnoredThreadUpdate(update) {
    const context = extractUpdateThreadContext(update);
    if (!context) return false;
    return ignoredThreadKeys.has(context.key) || ignoredThreadKeys.has(context.threadId);
  }
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
    documentLocks: new Map(),
    sessionCleanupTimer: null
  };

  function shouldLogAtLevel(level = "info") {
    const configuredWeight = LOG_LEVEL_WEIGHTS[themeMoveLogLevel] ?? LOG_LEVEL_WEIGHTS.warn;
    const requestedWeight = LOG_LEVEL_WEIGHTS[String(level ?? "").trim().toLowerCase()] ?? LOG_LEVEL_WEIGHTS.info;
    return requestedWeight <= configuredWeight;
  }

  function logThemeMove(level, payload) {
    if (!shouldLogAtLevel(level)) return;
    const text = `[telegram-sdvg] theme-move ${JSON.stringify(payload)}`;
    if (String(level ?? "").trim().toLowerCase() === "error") {
      console.error(text);
      return;
    }
    if (String(level ?? "").trim().toLowerCase() === "warn") {
      console.warn(text);
      return;
    }
    console.log(text);
  }

  async function listExistingMediaRelativePaths() {
    const mediaRoot = path.resolve(getMediaDir());
    const entries = [];
    const stack = [""];
    const skippedRootDirs = new Set(["archive_projects", "graphics"]);

    while (stack.length > 0) {
      const currentRelativeDir = stack.pop();
      const currentDir = currentRelativeDir ? path.join(mediaRoot, currentRelativeDir) : mediaRoot;
      const dirEntries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of dirEntries) {
        const entryRelativePath = currentRelativeDir ? path.join(currentRelativeDir, entry.name) : entry.name;
        if (entry.isDirectory()) {
          if (!currentRelativeDir && skippedRootDirs.has(String(entry.name ?? "").trim().toLowerCase())) {
            continue;
          }
          stack.push(entryRelativePath);
          continue;
        }
        if (!entry.isFile()) continue;
        entries.push(normalizeRelativeMediaPath(entryRelativePath.split(path.sep).join("/")));
      }
    }

    return entries;
  }

  async function reconcileMovedAssetRegistryEntries(movedItems = []) {
    const normalizedItems = (Array.isArray(movedItems) ? movedItems : [])
      .map((item) => ({
        asset_id: String(item?.asset_id ?? "").trim() || null,
        previous_relative_path: normalizeRelativeMediaPath(item?.relative_path),
        next_relative_path: normalizeRelativeMediaPath(item?.next_relative_path)
      }))
      .filter((item) => item.previous_relative_path && item.next_relative_path);
    if (normalizedItems.length === 0 || typeof updateAsset !== "function") {
      return { updated_count: 0, unresolved_count: normalizedItems.length };
    }

    const knownAssets = typeof listAssets === "function" ? await listAssets({ limit: 5000 }).catch(() => []) : [];
    const assetById = new Map();
    const assetsByPath = new Map();
    (Array.isArray(knownAssets) ? knownAssets : []).forEach((asset) => {
      const assetId = String(asset?.id ?? "").trim();
      const assetPath = normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? "");
      if (assetId) assetById.set(assetId, asset);
      if (!assetPath) return;
      const key = assetPath.toLowerCase();
      if (!assetsByPath.has(key)) {
        assetsByPath.set(key, []);
      }
      assetsByPath.get(key).push(asset);
    });

    let updatedCount = 0;
    let unresolvedCount = 0;
    for (const item of normalizedItems) {
      const candidateMap = new Map();
      if (item.asset_id && assetById.has(item.asset_id)) {
        candidateMap.set(item.asset_id, assetById.get(item.asset_id));
      }
      const fallbackCandidates = assetsByPath.get(item.previous_relative_path.toLowerCase()) ?? [];
      fallbackCandidates.forEach((asset) => {
        const assetId = String(asset?.id ?? "").trim();
        if (assetId) candidateMap.set(assetId, asset);
      });
      if (candidateMap.size === 0) {
        unresolvedCount += 1;
        continue;
      }

      let itemUpdated = false;
      for (const asset of candidateMap.values()) {
        const assetId = String(asset?.id ?? "").trim();
        if (!assetId) continue;
        const currentRelativePath = normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? "");
        if (
          currentRelativePath &&
          currentRelativePath.toLowerCase() !== item.previous_relative_path.toLowerCase() &&
          assetId !== item.asset_id
        ) {
          continue;
        }
        const updated = await updateAsset(assetId, {
          local_path: item.next_relative_path,
          file_name: path.basename(item.next_relative_path)
        }).catch(() => null);
        if (!updated) continue;
        itemUpdated = true;
        updatedCount += 1;
      }
      if (!itemUpdated) {
        unresolvedCount += 1;
      }
    }

    return {
      updated_count: updatedCount,
      unresolved_count: unresolvedCount
    };
  }

  async function reconcileStaleUnsortedAssetRegistry(reason = "startup") {
    if (typeof listAssets !== "function" || typeof updateAsset !== "function") {
      return { repaired_count: 0, planned_count: 0, skipped: true };
    }
    const assets = await listAssets({ limit: 5000 }).catch(() => []);
    const unsortedAssets = (Array.isArray(assets) ? assets : []).filter((asset) =>
      normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? "").toLowerCase().startsWith("unsorted/")
    );
    if (unsortedAssets.length === 0) {
      return { repaired_count: 0, planned_count: 0, skipped: false };
    }
    const existingRelativePaths = await listExistingMediaRelativePaths();
    const repairPlan = buildTelegramAssetPathRepairPlan(unsortedAssets, existingRelativePaths);
    if (repairPlan.length === 0) {
      return { repaired_count: 0, planned_count: 0, skipped: false };
    }

    let repairedCount = 0;
    for (const item of repairPlan) {
      const updated = await updateAsset(item.asset_id, {
        local_path: item.next_relative_path,
        file_name: path.basename(item.next_relative_path)
      }).catch(() => null);
      if (updated) repairedCount += 1;
    }

    if (repairedCount > 0) {
      logThemeMove("warn", {
        type: "asset_registry_repair",
        reason,
        repaired_count: repairedCount,
        planned_count: repairPlan.length
      });
    }

    return {
      repaired_count: repairedCount,
      planned_count: repairPlan.length,
      skipped: false
    };
  }

  function runSessionCleanup(reason = "interval") {
    const result = sweepIdleTelegramSdvgSessions(state.sessions, { ttlMs: sessionTtlMs });
    if (result.removed_count > 0) {
      console.warn(
        `[telegram-sdvg] session-cleanup (${reason}): removed=${result.removed_count} scanned=${result.scanned_count}`
      );
    }
    return result;
  }

  function getSession(chatId) {
    const key = String(chatId ?? "").trim();
    if (!state.sessions.has(key)) {
      state.sessions.set(key, createEmptyTelegramSdvgSession(defaultDocId || null));
    }
    return touchTelegramSdvgSession(state.sessions.get(key));
  }

  async function syncSessionState(chatId, session, extra = {}) {
    if (typeof upsertBotSession !== "function") return null;
    const normalizedChatId = String(chatId ?? "").trim();
    if (!normalizedChatId) return null;
    const selectedDownloadTheme = String(session?.selected_download_theme ?? "").trim();
    const nextMode = String(extra.mode ?? (session?.active_segment_id ? "sdvg" : "inbox")).trim() || "inbox";
    if (session) {
      session.mode = nextMode;
      touchTelegramSdvgSession(session);
    }
    const pendingPayload = {
      ...(extra.pendingPayload ?? {}),
      selected_download_theme: selectedDownloadTheme || null
    };
    return upsertBotSession({
      chat_id: normalizedChatId,
      user_id: String(extra.userId ?? "").trim(),
      mode: nextMode,
      active_document_id: String(extra.activeDocumentId ?? session?.doc_id ?? "").trim(),
      active_segment_id: String(extra.activeSegmentId ?? session?.active_segment_id ?? "").trim(),
      active_release_id: String(extra.activeReleaseId ?? "").trim(),
      pending_action: String(extra.pendingAction ?? "").trim(),
      pending_payload_json: pendingPayload,
      last_seen_at: new Date().toISOString()
    }).catch(() => null);
  }

  function getPendingProjectArchiveRequest(session) {
    const docId = String(session?.project_archive_request?.doc_id ?? "").trim();
    if (!docId) return null;
    return {
      doc_id: docId,
      requested_at: String(session?.project_archive_request?.requested_at ?? "").trim() || null
    };
  }

  function rememberPendingProjectArchiveRequest(session, docId) {
    const normalizedDocId = String(docId ?? "").trim();
    session.project_archive_request = normalizedDocId
      ? {
          doc_id: normalizedDocId,
          requested_at: new Date().toISOString()
        }
      : null;
  }

  function clearPendingProjectArchiveRequest(session) {
    if (!session) return;
    session.project_archive_request = null;
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

  async function loadWritableSegmentsForBot(docId) {
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId) return [];
    const fileSegments = await readOptionalJson(path.join(getDocDir(normalizedDocId), "segments.json")).catch(() => null);
    const fallbackSegments = await loadSegmentsForBot(normalizedDocId);
    return pickWritableSegments(fileSegments, fallbackSegments);
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

  async function findExistingTelegramMediaAssetByUniqueId(fileUniqueId = "") {
    const normalizedUniqueId = String(fileUniqueId ?? "").trim();
    if (!normalizedUniqueId || typeof listAssets !== "function") return null;
    const assets = await listAssets({ kind: "telegram_media", limit: 5000 }).catch(() => []);
    if (!Array.isArray(assets) || assets.length === 0) return null;
    for (const asset of assets) {
      if (String(asset?.telegram_file_unique_id ?? "").trim() !== normalizedUniqueId) continue;
      const relativePath = normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? "");
      if (!relativePath) continue;
      const absolutePath = path.resolve(getMediaDir(), relativePath.replace(/\//g, path.sep));
      const insideRoot = absolutePath.startsWith(`${path.resolve(getMediaDir())}${path.sep}`) || absolutePath === path.resolve(getMediaDir());
      if (!insideRoot) continue;
      if (await fileExists(absolutePath)) {
        return asset;
      }
    }
    return null;
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
      height: clampInteger(profile.height, 1280, 240, 5120),
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

  function extendScreenshotHeight(profile = {}, delta = 640) {
    const normalized = normalizeScreenshotProfile(profile);
    return normalizeScreenshotProfile({
      ...normalized,
      height: Math.max(240, Math.min(5120, normalized.height + Number(delta || 0)))
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
        const existingAsset = await findExistingTelegramMediaAssetByUniqueId(item?.fileUniqueId);
        if (existingAsset) {
          created.push(existingAsset);
          continue;
        }
        const preferredName = String(item?.fileName ?? "").trim() || `telegram_${String(item?.fileUniqueId ?? Date.now())}`;
        let savedPath = "";
        try {
          savedPath = await downloadTelegramFileToTopic(item.fileId, "UNSORTED", preferredName);
        } catch {
          savedPath = "";
        }
        const asset = await createAssetRecord(
          {
            kind: "telegram_media",
            status: savedPath ? "processed" : "new",
            title: path.basename(savedPath || preferredName),
            description: messageText,
            telegramChatId: String(chatId),
            telegramMessageId: String(message?.message_id ?? ""),
            telegramFileId: item.fileId,
            telegramFileUniqueId: item.fileUniqueId,
            mimeType: item.mimeType,
            fileName: path.basename(savedPath || preferredName),
            localPath: savedPath || "",
            processingState: savedPath ? "saved_to_inbox" : "pending_segment",
            originType: "telegram_message",
            originId: String(message?.message_id ?? ""),
            meta: {
              source: "telegram_inbox",
              media_kind: item.kind,
              saved_to_unsorted: Boolean(savedPath)
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
      segment_section_title: String(context.segment_section_title ?? "").trim(),
      segment_text_quote: String(context.segment_text_quote ?? "").trim(),
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
      inline_keyboard: [[{ text: "\uD83D\uDD15", callback_data: "sdvg_cheer:mute" }]]
    };
  }

  function buildSdvgEncouragementText(remainingCount = 0) {
    const count = Math.max(0, Number(remainingCount) || 0);
    if (count <= 0) return "\u0412\u0441\u0435 \u043D\u0435\u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0435 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u044B \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C.";
    const countLabel =
      count % 10 === 1 && count % 100 !== 11
        ? "\u0441\u0435\u0433\u043C\u0435\u043D\u0442"
        : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
          ? "\u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0430"
          : "\u0441\u0435\u0433\u043C\u0435\u043D\u0442\u043E\u0432";
    const variants = [
      `\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ${count} ${countLabel}.`,
      `\u0415\u0449\u0435 ${count} ${countLabel} \u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u043E\u0447\u0435\u0440\u0435\u0434\u0438.`,
      `\u0412 \u0440\u0430\u0431\u043E\u0442\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ${count} ${countLabel}.`,
      `${count} ${countLabel} \u0435\u0449\u0435 \u0436\u0434\u0443\u0442.`
    ];
    return variants[count % variants.length];
  }

  function buildSdvgEncouragementTextRich(remainingCount = 0) {
    const count = Math.max(0, Number(remainingCount) || 0);
    if (count <= 0) {
      const completedVariants = [
        "\uD83C\uDF89 <b>\u041D\u0435\u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u043E\u0432 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C.</b>\n\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0434\u043E\u0445\u043D\u0443\u0442\u044C.",
        "\u2705 <b>\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u0430.</b>\nSDVG \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u043E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043B \u0447\u0438\u0441\u0442\u043E.",
        "\uD83C\uDFC1 <b>\u0424\u0438\u043D\u0438\u0448.</b>\n\u0421\u0435\u0433\u043C\u0435\u043D\u0442\u044B \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C, \u0442\u0438\u0442\u0440\u044B \u043C\u043E\u0436\u043D\u043E \u043D\u0435 \u0432\u043A\u043B\u044E\u0447\u0430\u0442\u044C.",
        "\uD83E\uDD73 <b>\u0412\u0441\u0451 \u0437\u0430\u043A\u0440\u044B\u0442\u043E.</b>\n\u0414\u0430\u0436\u0435 \u043F\u0440\u0438\u0434\u0438\u0440\u0430\u0442\u044C\u0441\u044F \u0441\u0435\u0439\u0447\u0430\u0441 \u043E\u0441\u043E\u0431\u043E \u043D\u0435 \u043A \u0447\u0435\u043C\u0443."
      ];
      return completedVariants[Math.floor(Math.random() * completedVariants.length)];
    }
    const countLabel =
      count % 10 === 1 && count % 100 !== 11
        ? "\u0441\u0435\u0433\u043C\u0435\u043D\u0442"
        : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
          ? "\u0441\u0435\u0433\u043C\u0435\u043D\u0442\u0430"
          : "\u0441\u0435\u0433\u043C\u0435\u043D\u0442\u043E\u0432";
    const headline = `\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C <b>${count}</b> ${countLabel}`;
    const variants = [
      `\uD83D\uDCA1 ${headline}.\n\u0422\u0435\u043C\u043F \u0445\u043E\u0440\u043E\u0448\u0438\u0439. \u041F\u0430\u043D\u0438\u043A\u0430 \u043F\u043E\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F.`,
      `\uD83D\uDE80 <b>\u0412 \u0440\u0430\u0431\u043E\u0442\u0435 \u0435\u0449\u0451 ${count} ${countLabel}.</b>\n\u0418\u0434\u0451\u043C \u0434\u0430\u043B\u044C\u0448\u0435, \u0441\u0442\u0430\u043F \u0435\u0449\u0451 \u0442\u0451\u043F\u043B\u044B\u0439.`,
      `\u23F3 ${headline}.\n\u041A\u043E\u0441\u043C\u043E\u0441 \u043F\u043E\u0434\u043E\u0436\u0434\u0451\u0442, \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u044B.`,
      `\uD83C\uDFA7 ${headline}.\n\u041D\u0430\u0439\u043F\u0435\u0440\u0441\u043A\u0438, \u0431\u0435\u0437 \u0441\u0443\u0435\u0442\u044B.`,
      `\uD83E\uDDF9 \u0415\u0449\u0451 <b>${count} ${countLabel}</b> \u0434\u043E \u0447\u0438\u0441\u0442\u043E\u0433\u043E \u043B\u0438\u0441\u0442\u0430.\n\u041F\u0430\u0437\u043B \u0443\u0436\u0435 \u043F\u043E\u0447\u0442\u0438 \u0441\u043E\u0431\u0440\u0430\u043D.`,
      `\u2615 ${headline}.\nSDVG \u043D\u0435 \u0441\u043F\u0438\u0442, \u043F\u0440\u043E\u0441\u0442\u043E \u043C\u043E\u0440\u0433\u0430\u0435\u0442.`,
      `\uD83C\uDFAC \u041D\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0435\u0449\u0451 <b>${count} ${countLabel}</b>.\n\u0421\u0435\u0437\u043E\u043D \u0434\u043B\u0438\u043D\u043D\u044B\u0439, \u043D\u043E \u0444\u0438\u043D\u0430\u043B \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442.`,
      `\uD83E\uDD73 ${headline}.\n\u0420\u0430\u0431\u043E\u0447\u0438\u0439 \u0442\u0435\u043C\u043F. \u0411\u0435\u0437 \u0433\u0435\u0440\u043E\u0438\u0437\u043C\u0430, \u0437\u0430\u0442\u043E \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E.`,
      `\uD83D\uDD04 \u0415\u0449\u0451 <b>${count} ${countLabel}</b>.\n\u041A\u0443\u0445\u043D\u044F \u0448\u0443\u043C\u0438\u0442, \u043D\u043E \u0441\u0435\u0440\u0432\u0438\u0441 \u0438\u0434\u0451\u0442.`,
      `\uD83D\uDCCB ${headline}.\n\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u044F\u0435\u043C \u0432\u044B\u043F\u0443\u0441\u043A \u0434\u0430\u043B\u044C\u0448\u0435.`,
      `\uD83D\uDD25 \u0415\u0449\u0451 <b>${count} ${countLabel}</b> \u0441\u043C\u043E\u0442\u0440\u044F\u0442 \u0443\u043A\u043E\u0440\u0438\u0437\u043D\u0435\u043D\u043D\u043E.\n\u0418\u0433\u043D\u043E\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438\u0445 \u0443\u0436\u0435 \u043F\u043E\u0437\u0434\u043D\u043E.`,
      `\uD83D\uDC47 ${headline}.\n\u041E\u0442\u043A\u0440\u044B\u0432\u0430\u0439 \u043F\u043E \u043F\u043B\u0430\u043D\u0443, \u043A\u0430\u0441\u043A\u0430 \u043D\u0430 \u043C\u0435\u0441\u0442\u0435.`
    ];
    return variants[Math.floor(Math.random() * variants.length)];
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
    const sent = await sendMessage(chatId, buildSdvgEncouragementTextRich(remainingCount), {
      parse_mode: "HTML",
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

  function buildSegmentCardSignature(segment) {
    if (!segment || typeof segment !== "object") return "";
    const sectionTitle = String(segment.section_title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const quote = String(segment.text_quote ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    return `${sectionTitle}||${quote}`;
  }

  function isCardContextStale(context, segment) {
    if (!context || !segment) return false;
    const expected = buildSegmentCardSignature({
      section_title: context.segment_section_title,
      text_quote: context.segment_text_quote
    });
    const current = buildSegmentCardSignature(segment);
    return Boolean(expected) && Boolean(current) && expected !== current;
  }

  async function resolveSdvgTargetFromIncomingMessage(session, message, active) {
    if (!session?.doc_id) return active ?? null;
    const replyMessageId = Number(message?.reply_to_message?.message_id ?? 0) || null;
    if (!replyMessageId) return active ?? null;
    const context = getCardContext(session, replyMessageId);
    if (!context?.doc_id || !context?.segment_id) return active ?? null;
    const payload = await readDocPayload(context.doc_id);
    if (!payload) return active ?? null;
    const segment = findSdvgDisplaySegment(payload.segments, context.segment_id);
    if (!segment) {
      return {
        docId: String(context.doc_id),
        payload,
        segment: null,
        staleCard: true,
        staleReason: "missing_segment"
      };
    }
    if (isCardContextStale(context, segment)) {
      return {
        docId: String(context.doc_id),
        payload,
        segment,
        staleCard: true,
        staleReason: "segment_changed"
      };
    }
    return {
      docId: String(context.doc_id),
      payload,
      segment,
      staleCard: false,
      staleReason: null
    };
  }

  function ensureAdHocResearchSeenSet(session) {
    if (!session) return new Set();
    if (!(session.ad_hoc_research_seen_keys instanceof Set)) {
      const raw = Array.isArray(session?.ad_hoc_research_seen_keys) ? session.ad_hoc_research_seen_keys : [];
      session.ad_hoc_research_seen_keys = new Set(
        raw.map((item) => String(item ?? "").trim()).filter(Boolean)
      );
    }
    return session.ad_hoc_research_seen_keys;
  }

  function resetAdHocResearchState(session, query = "", cardId = "") {
    if (!session) return;
    session.ad_hoc_research_query = String(query ?? "").trim();
    session.ad_hoc_research_card_id = String(cardId ?? "").trim();
    session.ad_hoc_research_seen_keys = new Set();
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

  function rememberDownloadThemeContext(session, messageId, context) {
    if (!session || messageId == null || !context) return;
    const key = String(messageId);
    session.download_theme_contexts.set(key, {
      ...context,
      created_at: Date.now()
    });
    if (session.download_theme_contexts.size <= FILE_PICKER_CONTEXT_MAX) return;
    const items = Array.from(session.download_theme_contexts.entries()).sort((a, b) => {
      const left = Number(a?.[1]?.created_at ?? 0);
      const right = Number(b?.[1]?.created_at ?? 0);
      return left - right;
    });
    while (items.length > FILE_PICKER_CONTEXT_MAX) {
      const item = items.shift();
      if (!item) break;
      session.download_theme_contexts.delete(item[0]);
    }
  }

  function getDownloadThemeContext(session, messageId) {
    if (!session || messageId == null) return null;
    return session.download_theme_contexts.get(String(messageId)) ?? null;
  }

  function forgetDownloadThemeContext(session, messageId) {
    if (!session || messageId == null) return;
    session.download_theme_contexts.delete(String(messageId));
  }

  function getDownloadThemeCreateRequest(session) {
    if (!session?.download_theme_create_request) return null;
    const controlMessageId = Number(session.download_theme_create_request.control_message_id ?? 0) || null;
    if (!controlMessageId) return null;
    return {
      control_message_id: controlMessageId,
      prompt_message_id: Number(session.download_theme_create_request.prompt_message_id ?? 0) || null,
      created_at: Number(session.download_theme_create_request.created_at ?? 0) || Date.now()
    };
  }

  function rememberDownloadThemeCreateRequest(session, controlMessageId, promptMessageId = null) {
    if (!session) return;
    session.download_theme_create_request = {
      control_message_id: Number(controlMessageId ?? 0) || null,
      prompt_message_id: Number(promptMessageId ?? 0) || null,
      created_at: Date.now()
    };
  }

  function clearDownloadThemeCreateRequest(session) {
    if (!session) return null;
    const existing = getDownloadThemeCreateRequest(session);
    session.download_theme_create_request = null;
    return existing;
  }

  function getDownloadThemeSearchRequest(session) {
    if (!session?.download_theme_search_request) return null;
    const controlMessageId = Number(session.download_theme_search_request.control_message_id ?? 0) || null;
    if (!controlMessageId) return null;
    return {
      control_message_id: controlMessageId,
      prompt_message_id: Number(session.download_theme_search_request.prompt_message_id ?? 0) || null,
      created_at: Number(session.download_theme_search_request.created_at ?? 0) || Date.now()
    };
  }

  function rememberDownloadThemeSearchRequest(session, controlMessageId, promptMessageId = null) {
    if (!session) return;
    session.download_theme_search_request = {
      control_message_id: Number(controlMessageId ?? 0) || null,
      prompt_message_id: Number(promptMessageId ?? 0) || null,
      created_at: Date.now()
    };
  }

  function clearDownloadThemeSearchRequest(session) {
    if (!session) return null;
    const existing = getDownloadThemeSearchRequest(session);
    session.download_theme_search_request = null;
    return existing;
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
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}\u2026`;
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

  function looksGenericDownloaderTitle(value) {
    const normalized = cleanupCaptionText(value)
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .toLowerCase();
    return ["preview", "video", "file", "download", "media", "ok_preview"].includes(normalized);
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
    if (cleanedMetaTitle && !looksCorruptedText(cleanedMetaTitle) && !looksGenericDownloaderTitle(cleanedMetaTitle)) {
      return cleanedMetaTitle;
    }

    const parsedFromFile = cleanupCaptionText(parseTitleFromFileName(fileName) || fileName);
    if (parsedFromFile && !looksCorruptedText(parsedFromFile) && !looksGenericDownloaderTitle(parsedFromFile)) {
      return parsedFromFile;
    }

    const host = extractHostLabel(sourceUrl);
    if (host) {
      return isVideo ? `\u0412\u0438\u0434\u0435\u043E \u0438\u0437 ${host}` : `\u0424\u0430\u0439\u043B \u0438\u0437 ${host}`;
    }
    return "\u0421\u043A\u0430\u0447\u0430\u043D\u043D\u044B\u0439 \u0444\u0430\u0439\u043B";
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

    return isVideo ? "\u0412\u0438\u0434\u0435\u043E" : "\u0424\u0430\u0439\u043B";
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
      lines.push(`\uD83D\uDCF9 <a href="${escapeHtml(mediaUrl)}">${escapeHtml(title)}</a>`);
    } else {
      lines.push(`\uD83D\uDCF9 ${escapeHtml(title)}`);
    }
    if (uploader) {
      if (uploaderUrl) {
        lines.push(`\uD83D\uDC64 <a href="${escapeHtml(uploaderUrl)}">${escapeHtml(uploader)}</a>`);
      } else {
        lines.push(`\uD83D\uDC64 ${escapeHtml(uploader)}`);
      }
    }
    lines.push("", `\uD83D\uDCF9 ${escapeHtml(quality)}`, `\uD83D\uDCE6 ${escapeHtml(formatBytes(sizeBytes))}`);

    let caption = lines.join("\n");
    if (caption.length > TELEGRAM_CAPTION_MAX) {
      const fallbackTitle = clipLabel(title, 90);
      caption = `\uD83D\uDCF9 ${fallbackTitle}\n\uD83D\uDCE6 ${formatBytes(sizeBytes)}`;
    }
    return caption;
  }

  function resolveThemeFromRelativePath(relativePath) {
    const normalized = normalizeRelativeMediaPath(relativePath);
    if (!normalized) return "";
    const [themeName] = normalized.split("/").filter(Boolean);
    if (!themeName) return "";
    const lower = themeName.toLowerCase();
    if (lower === "unsorted" || lower === "archive_projects" || lower === "graphics") return "";
    return themeName;
  }

  function formatDownloadThemeLabel(themeName = "") {
    const value = String(themeName ?? "").trim();
    return value || "\u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0442\u0435\u043C\u0443";
  }

  function buildDownloadThemeMessageText(themeName = "", appliedTheme = "") {
    const selected = String(themeName ?? "").trim();
    const applied = String(appliedTheme ?? "").trim();
    if (applied) {
      return `\uD83D\uDCC2 \u0424\u0430\u0439\u043B \u0432 \u0442\u0435\u043C\u0435: ${applied}`;
    }
    if (selected) {
      return `\uD83D\uDCC2 \u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0442\u0435\u043C\u0430: ${selected}`;
    }
    return "\uD83D\uDCC2 \u0422\u0435\u043C\u0430 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u0430";
  }

  function buildDownloadThemeCollapsedKeyboard(themeName = "", appliedTheme = "") {
    const selected = String(themeName ?? "").trim();
    const applied = String(appliedTheme ?? "").trim();
    if (!selected) {
      return {
        inline_keyboard: [[
          {
            text: `\uD83D\uDCC2 ${formatDownloadThemeLabel("")}`,
            callback_data: "sdvg_theme:open"
          }
        ]]
      };
    }
    const matchesApplied = applied && applied.toLowerCase() === selected.toLowerCase();
    return {
      inline_keyboard: [[
        {
          text: `${matchesApplied ? "\u2705" : "\uD83D\uDCC2"} ${formatDownloadThemeLabel(selected)}`,
          callback_data: "sdvg_theme:open"
        }
      ]]
    };
  }

  function buildDownloadThemePickerKeyboard(context = {}) {
    const themes = Array.isArray(context?.themes) ? context.themes.filter(Boolean) : [];
    const totalPages = Math.max(1, Math.ceil(themes.length / DOWNLOAD_THEME_PAGE_SIZE));
    const page = Math.min(Math.max(0, Number.parseInt(context?.page, 10) || 0), totalPages - 1);
    const start = page * DOWNLOAD_THEME_PAGE_SIZE;
    const pageThemes = themes.slice(start, start + DOWNLOAD_THEME_PAGE_SIZE);
    const currentTheme = String(context?.current_theme ?? "").trim().toLowerCase();
    const appliedTheme = String(context?.applied_theme ?? "").trim().toLowerCase();
    const rows = [];

    for (let index = 0; index < pageThemes.length; index += 2) {
      const rowThemes = pageThemes.slice(index, index + 2);
      rows.push(
        rowThemes.map((theme, rowIndex) => {
          const absoluteIndex = start + index + rowIndex;
          const normalizedTheme = String(theme ?? "").trim();
          const lowerTheme = normalizedTheme.toLowerCase();
          const prefix = lowerTheme === appliedTheme ? "\u2705 " : lowerTheme === currentTheme ? "\uD83D\uDCC2 " : "";
          return {
            text: `${prefix}${normalizedTheme}`,
            callback_data: `sdvg_theme:sel:${absoluteIndex}`
          };
        })
      );
    }

    if (rows.length === 0) {
      rows.push([
        {
          text: "\u041F\u0430\u043F\u043E\u043A \u043D\u0435\u0442",
          callback_data: "sdvg_theme:noop"
        }
      ]);
    }

    if (totalPages > 1) {
      rows.push([
        {
          text: page > 0 ? "\u2B05\uFE0F" : "\u00B7",
          callback_data: page > 0 ? `sdvg_theme:page:${page - 1}` : "sdvg_theme:noop"
        },
        {
          text: `${page + 1}/${totalPages}`,
          callback_data: "sdvg_theme:noop"
        },
        {
          text: page + 1 < totalPages ? "\u27A1\uFE0F" : "\u00B7",
          callback_data: page + 1 < totalPages ? `sdvg_theme:page:${page + 1}` : "sdvg_theme:noop"
        }
      ]);
    }

    rows.push([
      { text: "\uD83D\uDD0E", callback_data: "sdvg_theme:search" },
      { text: "\u2795", callback_data: "sdvg_theme:new" },
      { text: "\u21A9\uFE0F \u041D\u0430\u0437\u0430\u0434", callback_data: "sdvg_theme:close" }
    ]);

    return { inline_keyboard: rows };
  }

  async function listDownloadThemeFolders() {
    const mediaRoot = path.resolve(getMediaDir());
    const entries = await fs.readdir(mediaRoot, { withFileTypes: true }).catch(() => []);
    const excluded = new Set(["unsorted", "archive_projects", "graphics"]);
    return entries
      .filter((entry) => entry?.isDirectory?.())
      .map((entry) => String(entry.name ?? "").trim())
      .filter((name) => name && !name.startsWith(".") && !excluded.has(name.toLowerCase()))
      .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }));
  }

  function resolveDownloadThemePage(themes = [], themeName = "") {
    const normalizedTheme = String(themeName ?? "").trim().toLowerCase();
    if (!normalizedTheme) return 0;
    const index = (Array.isArray(themes) ? themes : []).findIndex(
      (item) => String(item ?? "").trim().toLowerCase() === normalizedTheme
    );
    if (index < 0) return 0;
    return Math.max(0, Math.floor(index / DOWNLOAD_THEME_PAGE_SIZE));
  }

  function filterDownloadThemes(themes = [], query = "") {
    const normalizedQuery = String(query ?? "").trim().toLowerCase();
    const list = Array.isArray(themes) ? themes : [];
    if (!normalizedQuery) return list;
    const startsWith = [];
    const includes = [];
    list.forEach((theme) => {
      const normalizedTheme = String(theme ?? "").trim();
      if (!normalizedTheme) return;
      const lower = normalizedTheme.toLowerCase();
      if (lower.startsWith(normalizedQuery)) {
        startsWith.push(normalizedTheme);
        return;
      }
      if (lower.includes(normalizedQuery)) {
        includes.push(normalizedTheme);
      }
    });
    return [...startsWith, ...includes];
  }

  async function createDownloadThemeFolder(themeName) {
    const sanitized = String(sanitizeMediaTopicName(themeName) ?? "").trim();
    if (!sanitized) throw new Error("theme name is empty");
    const lower = sanitized.toLowerCase();
    if (lower === "unsorted" || lower === "archive_projects" || lower === "graphics") {
      throw new Error("reserved theme name");
    }
    const existingThemes = await listDownloadThemeFolders();
    const duplicateTheme =
      existingThemes.find((item) => String(item ?? "").trim().toLowerCase() === lower) ??
      existingThemes.find(
        (item) => String(sanitizeMediaTopicName(item) ?? "").trim().toLowerCase() === lower
      ) ??
      "";
    if (duplicateTheme) {
      return duplicateTheme;
    }
    const mediaRoot = path.resolve(getMediaDir());
    const targetDir = path.resolve(mediaRoot, sanitized);
    const targetInsideRoot = targetDir === mediaRoot || targetDir.startsWith(`${mediaRoot}${path.sep}`);
    if (!targetInsideRoot) {
      throw new Error("target theme is outside media root");
    }
    await fs.mkdir(targetDir, { recursive: true });
    return sanitized;
  }

  async function moveDownloadedMediaToTheme(relativePath, themeName) {
    const normalizedRelativePath = normalizeRelativeMediaPath(relativePath);
    const sanitizedTheme = String(sanitizeMediaTopicName(themeName) ?? "").trim();
    if (!normalizedRelativePath) throw new Error("relative path is missing");
    if (!sanitizedTheme) throw new Error("theme is required");

    const mediaRoot = path.resolve(getMediaDir());
    const sourcePath = path.resolve(mediaRoot, normalizedRelativePath.replace(/\//g, path.sep));
    const sourceInsideRoot = sourcePath === mediaRoot || sourcePath.startsWith(`${mediaRoot}${path.sep}`);
    if (!sourceInsideRoot) {
      throw new Error("source file is outside media root");
    }
    if (!(await fileExists(sourcePath))) {
      throw new Error("source file was not found");
    }

    const themeDir = path.resolve(mediaRoot, sanitizedTheme);
    const themeInsideRoot = themeDir === mediaRoot || themeDir.startsWith(`${mediaRoot}${path.sep}`);
    if (!themeInsideRoot) {
      throw new Error("target theme is outside media root");
    }
    await fs.mkdir(themeDir, { recursive: true });

    const sourceName = path.basename(sourcePath);
    const sourceExt = path.extname(sourceName);
    const sourceBase = path.basename(sourceName, sourceExt);
    const sourceTheme = resolveThemeFromRelativePath(normalizedRelativePath);
    if (sourceTheme && sourceTheme.toLowerCase() === sanitizedTheme.toLowerCase()) {
      return {
        next_relative_path: normalizeRelativeMediaPath(path.relative(mediaRoot, sourcePath).split(path.sep).join("/")),
        strategy: "already_in_theme",
        renamed_with_suffix: false,
        source_deleted: false,
        reused_existing: false
      };
    }

    const sourceStats = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStats?.isFile?.()) {
      throw new Error("source file was not found");
    }

    let targetPath = path.join(themeDir, sourceName);
    const initialTargetStats = await fs.stat(targetPath).catch(() => null);
    if (
      initialTargetStats?.isFile?.() &&
      Number(initialTargetStats.size ?? -1) === Number(sourceStats.size ?? -2)
    ) {
      await fs.unlink(sourcePath).catch(() => null);
      return {
        next_relative_path: normalizeRelativeMediaPath(path.relative(mediaRoot, targetPath).split(path.sep).join("/")),
        strategy: "reused_existing",
        renamed_with_suffix: false,
        source_deleted: true,
        reused_existing: true
      };
    }

    let suffix = 1;
    let renamedWithSuffix = false;
    while (await fileExists(targetPath)) {
      targetPath = path.join(themeDir, `${sourceBase}_${suffix}${sourceExt}`);
      suffix += 1;
      renamedWithSuffix = true;
    }

    let strategy = "renamed";
    try {
      await fs.rename(sourcePath, targetPath);
    } catch (error) {
      strategy = "copied_then_deleted";
      await fs.copyFile(sourcePath, targetPath);
      await fs.unlink(sourcePath).catch(() => null);
      const copiedStats = await fs.stat(targetPath).catch(() => null);
      if (
        !copiedStats?.isFile?.() ||
        Number(copiedStats.size ?? -1) !== Number(sourceStats.size ?? -2)
      ) {
        throw error;
      }
    }

    let sourceDeleted = !(await fileExists(sourcePath));
    if (await fileExists(sourcePath)) {
      const targetStats = await fs.stat(targetPath).catch(() => null);
      if (
        targetStats?.isFile?.() &&
        Number(targetStats.size ?? -1) === Number(sourceStats.size ?? -2)
      ) {
        await fs.unlink(sourcePath).catch(() => null);
        sourceDeleted = !(await fileExists(sourcePath));
      }
    }
    return {
      next_relative_path: normalizeRelativeMediaPath(path.relative(mediaRoot, targetPath).split(path.sep).join("/")),
      strategy,
      renamed_with_suffix: renamedWithSuffix,
      source_deleted: sourceDeleted,
      reused_existing: false
    };
  }

  async function sendDownloadThemeControlMessage(chatId, session, context = {}) {
    const rawItems = Array.isArray(context?.items) ? context.items : [];
    const normalizedItems = rawItems
      .map((item) => ({
        relative_path: normalizeRelativeMediaPath(item?.relative_path),
        asset_id: String(item?.asset_id ?? "").trim() || null
      }))
      .filter((item) => item.relative_path);
    const fallbackRelativePath = normalizeRelativeMediaPath(context?.relative_path);
    if (fallbackRelativePath && !normalizedItems.some((item) => item.relative_path === fallbackRelativePath)) {
      normalizedItems.unshift({
        relative_path: fallbackRelativePath,
        asset_id: String(context?.asset_id ?? "").trim() || null
      });
    }
    if (!chatId || !session || !normalizedItems.length) return null;
    const selectedTheme = String(session?.selected_download_theme ?? "").trim();
    const appliedTheme = resolveThemeFromRelativePath(normalizedItems[0].relative_path);
    const themes = await listDownloadThemeFolders();
    const sent = await sendMessage(chatId, buildDownloadThemeMessageText(selectedTheme, appliedTheme), {
      reply_markup: buildDownloadThemeCollapsedKeyboard(selectedTheme, appliedTheme)
    }).catch(() => null);
    const messageId = Number(sent?.message_id ?? 0) || null;
    if (!messageId) return null;
    rememberDownloadThemeContext(session, messageId, {
      ...context,
      relative_path: normalizedItems[0].relative_path,
      asset_id: normalizedItems[0].asset_id,
      items: normalizedItems,
      themes,
      page: resolveDownloadThemePage(themes, selectedTheme || appliedTheme),
      current_theme: selectedTheme,
      applied_theme: appliedTheme
    });
    return sent;
  }

  function extractDownloadThemeItemsFromAssets(assets = []) {
    return (Array.isArray(assets) ? assets : [])
      .map((asset) => ({
        relative_path: normalizeRelativeMediaPath(asset?.local_path ?? asset?.localPath ?? ""),
        asset_id: String(asset?.id ?? "").trim() || null
      }))
      .filter((item) => item.relative_path);
  }

  async function sendInboxSavedSummaryAndThemePicker(chatId, session, created = [], options = {}) {
    const count = Array.isArray(created) ? created.length : 0;
    if (count <= 0) return;
    const autoMode = Boolean(options?.autoMode);
    await sendMessage(
      chatId,
      autoMode ? SDVG_MESSAGES.inboxSavedAutoDownload(count) : `Сохранил в Inbox: ${count}.`
    ).catch(() => null);
    const themeItems = extractDownloadThemeItemsFromAssets(created);
    if (themeItems.length <= 0) return;
    await sendDownloadThemeControlMessage(chatId, session, {
      relative_path: themeItems[0].relative_path,
      asset_id: themeItems[0].asset_id,
      items: themeItems
    }).catch(() => null);
  }

  function ensurePendingInboxMediaGroupMap(session) {
    if (!session) return new Map();
    if (!(session.pending_inbox_media_groups instanceof Map)) {
      session.pending_inbox_media_groups = new Map();
    }
    return session.pending_inbox_media_groups;
  }

  function ensurePendingSdvgMediaGroupMap(session) {
    if (!session) return new Map();
    if (!(session.pending_sdvg_media_groups instanceof Map)) {
      session.pending_sdvg_media_groups = new Map();
    }
    return session.pending_sdvg_media_groups;
  }

  async function flushPendingInboxMediaGroup(chatId, userId, session, groupId) {
    const groups = ensurePendingInboxMediaGroupMap(session);
    const entry = groups.get(String(groupId ?? ""));
    if (!entry) return;
    groups.delete(String(groupId ?? ""));
    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }
    const representativeMessage = entry.message ?? {};
    const created = await createInboxAssetsFromMessage(chatId, session, representativeMessage, entry.mediaItems);
    if (created.length <= 0) return;
    await syncSessionState(chatId, session, {
      userId,
      mode: "download",
      activeDocumentId: session?.doc_id,
      activeSegmentId: ""
    });
    await sendInboxSavedSummaryAndThemePicker(chatId, session, created, { autoMode: true });
  }

  function queuePendingInboxMediaGroup(chatId, userId, session, message, mediaItems = []) {
    const groupId = getMessageMediaGroupId(message);
    if (!groupId || !Array.isArray(mediaItems) || mediaItems.length <= 0) return false;
    const groups = ensurePendingInboxMediaGroupMap(session);
    const key = String(groupId);
    const existing = groups.get(key) ?? {
      message: null,
      mediaItems: [],
      seenKeys: new Set(),
      timeout: null
    };
    const messageText = String(message?.text ?? message?.caption ?? "").trim();
    if (!existing.message || messageText) {
      existing.message = message;
    }
    mediaItems.forEach((item) => {
      const dedupeKey = String(item?.fileUniqueId ?? item?.fileId ?? item?.fileName ?? "").trim();
      if (dedupeKey && existing.seenKeys.has(dedupeKey)) return;
      if (dedupeKey) existing.seenKeys.add(dedupeKey);
      existing.mediaItems.push(item);
    });
    if (existing.timeout) {
      clearTimeout(existing.timeout);
    }
    existing.timeout = setTimeout(() => {
      void flushPendingInboxMediaGroup(chatId, userId, session, key);
    }, INBOX_MEDIA_GROUP_WAIT_MS);
    if (typeof existing.timeout?.unref === "function") existing.timeout.unref();
    groups.set(key, existing);
    return true;
  }

  async function flushPendingSdvgMediaGroup(chatId, session, groupId) {
    const groups = ensurePendingSdvgMediaGroupMap(session);
    const entry = groups.get(String(groupId ?? ""));
    if (!entry) return;
    groups.delete(String(groupId ?? ""));
    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }
    if (!entry.segment || !Array.isArray(entry.mediaItems) || entry.mediaItems.length <= 0) return;
    await handleTelegramMediaInput(
      chatId,
      session,
      entry.segment,
      entry.mediaItems,
      Number(entry.sourceMessageId ?? 0) || null
    );
  }

  function queuePendingSdvgMediaGroup(chatId, session, segment, message, mediaItems = []) {
    const groupId = getMessageMediaGroupId(message);
    if (!groupId || !segment || !Array.isArray(mediaItems) || mediaItems.length <= 0) return false;
    const groups = ensurePendingSdvgMediaGroupMap(session);
    const key = String(groupId);
    const existing = groups.get(key) ?? {
      segment,
      message: null,
      sourceMessageId: null,
      mediaItems: [],
      seenKeys: new Set(),
      timeout: null
    };
    const messageText = String(message?.text ?? message?.caption ?? "").trim();
    if (!existing.message || messageText) {
      existing.message = message;
    }
    if (!existing.segment || messageText) {
      existing.segment = segment;
    }
    if (!existing.sourceMessageId || messageText) {
      existing.sourceMessageId = Number(message?.message_id ?? 0) || existing.sourceMessageId || null;
    }
    mediaItems.forEach((item) => {
      const dedupeKey = String(item?.fileUniqueId ?? item?.fileId ?? item?.fileName ?? "").trim();
      if (dedupeKey && existing.seenKeys.has(dedupeKey)) return;
      if (dedupeKey) existing.seenKeys.add(dedupeKey);
      existing.mediaItems.push(item);
    });
    if (existing.timeout) {
      clearTimeout(existing.timeout);
    }
    existing.timeout = setTimeout(() => {
      void flushPendingSdvgMediaGroup(chatId, session, key);
    }, INBOX_MEDIA_GROUP_WAIT_MS);
    if (typeof existing.timeout?.unref === "function") existing.timeout.unref();
    groups.set(key, existing);
    return true;
  }

  async function telegramApiCallMultipartMediaGroup(payload = {}, mediaEntries = [], timeoutMs = 120000) {
    if (!apiBase) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const items = Array.isArray(mediaEntries) ? mediaEntries.filter(Boolean) : [];
    if (!items.length) throw new Error("mediaEntries are required");
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

      for (const entry of items) {
        const attachName = String(entry?.attachName ?? "").trim();
        const filePath = String(entry?.filePath ?? "").trim();
        if (!attachName || !filePath) continue;
        let blob = null;
        if (typeof fs.openAsBlob === "function") {
          blob = await fs.openAsBlob(filePath);
        } else {
          const bytes = await fs.readFile(filePath);
          blob = new Blob([bytes]);
        }
        form.append(attachName, blob, String(entry?.fileName ?? path.basename(filePath)));
      }

      const response = await fetch(`${apiBase}/sendMediaGroup`, {
        method: "POST",
        body: form,
        signal: controller.signal
      });
      const raw = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("Telegram sendMediaGroup returned non-JSON response");
      }
      if (!response.ok || !parsed?.ok) {
        const reason = parsed?.description || `HTTP ${response.status}`;
        throw new Error(`Telegram sendMediaGroup failed: ${reason}`);
      }
      return parsed.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendDownloadedMediaEntry(chatId, entry) {
    const fileName = String(entry?.fileName ?? "").trim() || "file";
    const absolutePath = String(entry?.absolutePath ?? "").trim();
    const sendAs = async (kind = "document") => {
      const method = kind === "video" ? "sendVideo" : "sendDocument";
      const fileField = kind === "video" ? "video" : "document";
      const payload = {
        chat_id: chatId,
        caption: String(entry?.caption ?? ""),
        parse_mode: "HTML"
      };
      if (kind === "video") {
        payload.supports_streaming = true;
      }
      return telegramApiCallMultipart(method, payload, fileField, absolutePath, fileName, 180000);
    };

    try {
      return await sendAs(entry?.kind === "video" ? "video" : "document");
    } catch (error) {
      const message = String(error?.message ?? "");
      const tooLarge = /request entity too large/i.test(message);
      if (entry?.kind === "video" && tooLarge) {
        return sendAs("document");
      }
      throw error;
    }
  }

  async function sendDownloadedMediaGroup(chatId, entries = []) {
    const items = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!items.length) return [];
    const media = items.map((entry, index) => {
      const attachName = `media_${index}`;
      const payload = {
        type: entry.kind === "video" ? "video" : "document",
        media: `attach://${attachName}`,
        caption: String(entry.caption ?? ""),
        parse_mode: "HTML"
      };
      if (entry.kind === "video") {
        payload.supports_streaming = true;
      }
      return {
        ...payload,
        __attachName: attachName
      };
    });

    return telegramApiCallMultipartMediaGroup(
      {
        chat_id: chatId,
        media: media.map(({ __attachName, ...rest }) => rest)
      },
      items.map((entry, index) => ({
        attachName: media[index].__attachName,
        filePath: entry.absolutePath,
        fileName: entry.fileName
      })),
      180000
    );
  }

  async function sendDownloadedMediaBackToChat(chatId, segmentId, sourceUrl, mediaPaths = [], metadata = null, options = {}) {
    if (!chatId) return;
    const mediaRoot = path.resolve(getMediaDir());
    const themePickerEnabled = Boolean(options?.themePicker?.enabled);
    const themePickerSession = options?.themePicker?.session ?? null;
    const themePickerDocId = String(options?.themePicker?.docId ?? "").trim();
    const themePickerSegmentId = String(options?.themePicker?.segmentId ?? "").trim();
    const assetIdByPath = options?.themePicker?.assetIdByPath instanceof Map ? options.themePicker.assetIdByPath : new Map();
    const sourceMessageId = Number(options?.sourceMessageId ?? 0) || null;
    const deleteSourceMessage = Boolean(options?.deleteSourceMessage) && sourceMessageId;
    const unique = Array.from(
      new Set(
        (Array.isArray(mediaPaths) ? mediaPaths : [])
          .map((item) => normalizeRelativeMediaPath(item))
          .filter(Boolean)
      )
    );
    const preparedEntries = [];
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
      preparedEntries.push({
        relativePath,
        absolutePath,
        fileName,
        kind: isVideo ? "video" : "document",
        caption,
        assetId: String(assetIdByPath.get(relativePath) ?? "").trim() || null
      });
    }

    let sentCount = 0;
    const themedEntries = [];

    const documentEntries = preparedEntries.filter((entry) => entry.kind === "document");
    const videoEntries = preparedEntries.filter((entry) => entry.kind === "video");

    const sendChunkedGroup = async (entries = []) => {
      const chunks = [];
      for (let index = 0; index < entries.length; index += TELEGRAM_MEDIA_GROUP_LIMIT) {
        chunks.push(entries.slice(index, index + TELEGRAM_MEDIA_GROUP_LIMIT));
      }
      for (const chunk of chunks) {
        try {
          await sendDownloadedMediaGroup(chatId, chunk);
          sentCount += chunk.length;
          themedEntries.push(...chunk);
        } catch (groupError) {
          for (const entry of chunk) {
            await sendDownloadedMediaEntry(chatId, entry)
              .then(() => {
                sentCount += 1;
                themedEntries.push(entry);
              })
              .catch(async (error) => {
                await sendMessage(
                  chatId,
                  `\u0424\u0430\u0439\u043B \u0441\u043A\u0430\u0447\u0430\u043D, \u043D\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E: ${entry.fileName} (${error?.message ?? groupError?.message ?? error})`
                ).catch(() => null);
              });
          }
        }
      }
    };

    if (documentEntries.length > 1) {
      await sendChunkedGroup(documentEntries);
    } else if (documentEntries.length === 1) {
      await sendDownloadedMediaEntry(chatId, documentEntries[0])
        .then(() => {
          sentCount += 1;
          themedEntries.push(documentEntries[0]);
        })
        .catch(async (error) => {
          await sendMessage(
            chatId,
            `\u0424\u0430\u0439\u043B \u0441\u043A\u0430\u0447\u0430\u043D, \u043D\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E: ${documentEntries[0].fileName} (${error?.message ?? error})`
          ).catch(() => null);
        });
    }

    if (videoEntries.length > 1) {
      await sendChunkedGroup(videoEntries);
    } else if (videoEntries.length === 1) {
      await sendDownloadedMediaEntry(chatId, videoEntries[0])
        .then(() => {
          sentCount += 1;
          themedEntries.push(videoEntries[0]);
        })
        .catch(async (error) => {
          await sendMessage(
            chatId,
            `\u0424\u0430\u0439\u043B \u0441\u043A\u0430\u0447\u0430\u043D, \u043D\u043E \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u043B\u043E\u0441\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E: ${videoEntries[0].fileName} (${error?.message ?? error})`
          ).catch(() => null);
        });
    }

    if (deleteSourceMessage && sentCount > 0) {
      await deleteMessage(chatId, sourceMessageId).catch(() => null);
    }
    if (themePickerEnabled && themePickerSession && themedEntries.length > 0) {
      await sendDownloadThemeControlMessage(chatId, themePickerSession, {
        doc_id: themePickerDocId || null,
        segment_id: themePickerSegmentId || null,
        relative_path: themedEntries[0].relativePath,
        asset_id: themedEntries[0].assetId ?? null,
        items: themedEntries.map((entry) => ({
          relative_path: entry.relativePath,
          asset_id: entry.assetId ?? null
        })),
        source_url: String(sourceUrl ?? "").trim()
      }).catch(() => null);
    }
    if (sentCount === 0 && unique.length > 0) {
      await sendMessage(
        chatId,
        SDVG_MESSAGES.fileNotSentBack(unique[0])
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
      `\uD83D\uDCF8 <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
      `\uD83D\uDDA5 ${escapeHtml(formatScreenshotProfile(profile))}`
    ].join("\n");
  }

  function buildScreenshotPreviewKeyboardV2() {
    return {
      inline_keyboard: [
        [
          { text: "\uD83C\uDF10", callback_data: "sdvg_shot:format" },
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
      `\uD83D\uDCF8 <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
      `🖥 ${escapeHtml(formatScreenshotProfile(profile))} • ${escapeHtml(formatPreset.label)}`
    ].join("\n");
  }

  function buildScreenshotPreviewKeyboardV3() {
    return {
      inline_keyboard: [
        [
          { text: "\uD83C\uDF10", callback_data: "sdvg_shot:format" },
          { text: "📜⬇️", callback_data: "sdvg_shot:taller" },
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

  function buildScreenshotPreviewCaptionV3(url, profile = {}, metadata = {}) {
    const host = deriveSourceDomain(url) || "source";
    const title = clipLabel(String(metadata?.title ?? "").trim() || host, 90);
    const normalized = normalizeScreenshotProfile(profile);
    const formatPreset = getScreenshotFormatPreset(detectScreenshotFormatKey(profile));
    const isExactPreset = SCREENSHOT_FORMAT_PRESETS.some(
      (preset) => preset.width === normalized.width && preset.height === normalized.height
    );
    const frameLabel = isExactPreset ? formatPreset.label : normalized.height > 1440 ? "long" : "custom";
    return [
      `\uD83D\uDCF8 <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
      `🖥 ${escapeHtml(formatScreenshotProfile(profile))} • ${escapeHtml(frameLabel)}`
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
          caption: buildScreenshotPreviewCaptionV3(previewContext.url, captured.profile, previewContext.metadata),
          parse_mode: "HTML",
          reply_markup: buildScreenshotPreviewKeyboardV3()
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

  async function saveAdHocResearchScreenshotToTheme(chatId, session, url, metadata = {}, profile = {}) {
    const selectedTheme = String(session?.selected_download_theme ?? "").trim();
    if (!selectedTheme) {
      throw new Error("Сначала выбери тему для сохранения.");
    }
    const captured = await captureLinkScreenshotForBot(url, profile);
    const outputDir = await ensureMediaDir(sanitizeMediaTopicName(selectedTheme));
    const host = deriveSourceDomain(url) || "screenshot";
    const fileStamp = formatFileDateTimeSuffix();
    const targetPath = await ensureUniqueFilePath(
      outputDir,
      `${sanitizeFileName(`${host}_${fileStamp}`, "screenshot")}.png`
    );
    await fs.writeFile(targetPath, captured.buffer);
    const mediaRoot = path.resolve(getMediaDir());
    const relativePath = normalizeRelativeMediaPath(path.relative(mediaRoot, targetPath));
    const asset = await createAssetRecord(
      {
        kind: "screenshot",
        status: "processed",
        title: clipText(String(metadata?.title ?? `Screenshot ${host}`), 180),
        description: String(url ?? "").trim(),
        sourceUrl: url,
        sourceDomain: host,
        telegramChatId: String(chatId),
        fileName: path.basename(targetPath),
        localPath: relativePath,
        screenshotPath: relativePath,
        processingState: "saved_to_theme",
        originType: "adhoc_research_screenshot",
        originId: String(metadata?.result_id ?? "").trim(),
        meta: {
          source: "telegram_adhoc_research_screenshot",
          selected_theme: selectedTheme,
          captured_from_url: url,
          screenshot_profile: captured.profile,
          title: String(metadata?.title ?? "").trim(),
          domain: String(metadata?.domain ?? "").trim()
        }
      },
      {
        role: "inbox",
        attachedBy: "telegram_sdvg"
      }
    );
    return {
      absolutePath: targetPath,
      relativePath,
      fileName: path.basename(targetPath),
      profile: captured.profile,
      assetId: String(asset?.id ?? "").trim() || null,
      theme: selectedTheme
    };
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

  async function filterBlockedResearchResults_legacy(results = [], sourceProfiles = {}) {
    const allowed = [];
    const uaFallback = [];
    (Array.isArray(results) ? results : []).forEach(async (item) => {
      if (isBlockedResearchDomain(item?.domain, sourceProfiles)) return;
      if (isUaResearchDomain(item?.domain)) {
        uaFallback.push(item);
        await sendMessage(chatId, `📎 Добавил файл в ${context.segment_id}: ${path.basename(picked.path)}`).catch(
          () => null
        );
        return;
      }
      allowed.push(item);
    });
    return allowed.length > 0 ? allowed : uaFallback;
  }

  function filterBlockedResearchResults(results = [], sourceProfiles = {}) {
    const allowed = [];
    const uaFallback = [];
    (Array.isArray(results) ? results : []).forEach((item) => {
      if (isBlockedResearchDomain(item?.domain, sourceProfiles)) return;
      if (isUaResearchDomain(item?.domain)) {
        uaFallback.push(item);
        return;
      }
      allowed.push(item);
    });
    return allowed.length > 0 ? allowed : uaFallback;
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
      (Array.isArray(run?.applied) ? run.applied : []).forEach((item) => {
        const key = canonicalizeBotUrl(item?.meta?.url);
        if (key) seen.add(key);
      });
    });
    return seen;
  }

  function collectDismissedResearchKeys(decision = null) {
    const seen = new Set();
    (Array.isArray(decision?.research_dismissed_urls) ? decision.research_dismissed_urls : []).forEach((item) => {
      const key = canonicalizeBotUrl(item?.url ?? item);
      if (key) seen.add(key);
    });
    return seen;
  }

  const SDVG_LEADING_NUMBERED_LINE_RE = /^\s*\d{1,3}[.)]\s*\S/;
  const SDVG_LEADING_COMMENT_START_RE = /^\s*1[.)]\s*\S/;
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

  function extractSdvgResearchLinkHintDomains(linkHints = []) {
    const seen = new Set();
    const domains = [];
    (Array.isArray(linkHints) ? linkHints : []).forEach((item) => {
      const raw = compactText(item);
      if (!raw) return;
      try {
        const parsed = new URL(raw);
        const hostname = compactText(parsed.hostname).replace(/^www\./i, "").toLowerCase();
        if (!hostname || seen.has(hostname)) return;
        seen.add(hostname);
        domains.push(hostname);
      } catch {
        // Ignore malformed URLs in hints.
      }
    });
    return domains.slice(0, 4);
  }

  function buildSdvgSectionResearchContext(segments = [], targetSegment = {}) {
    const sectionKey = getSdvgSectionKey(targetSegment);
    if (!sectionKey || sectionKey === "untitled") {
      return {
        section_context_text: "",
        section_link_hints: []
      };
    }
    const source = Array.isArray(segments) ? segments : [];
    const currentSegmentId = compactText(targetSegment?.segment_id);
    const sameSection = source.filter((item) => getSdvgSectionKey(item) === sectionKey);
    if (sameSection.length === 0) {
      return {
        section_context_text: "",
        section_link_hints: []
      };
    }

    const currentIndex = sameSection.findIndex((item) => compactText(item?.segment_id) === currentSegmentId);
    const contextTexts = sameSection
      .map((item, index) => {
        const blockType = compactText(item?.block_type).toLowerCase();
        if (blockType === "links" || isSdvgCommentsSegment(item)) return null;
        if (compactText(item?.segment_id) === currentSegmentId) return null;
        const text = compactText(item?.text_quote);
        if (!text) return null;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const linkCount = Array.isArray(item?.links) ? item.links.length : 0;
        const distance = currentIndex === -1 ? 99 : Math.abs(index - currentIndex);
        const score =
          (linkCount * 120) +
          Math.max(0, 40 - (distance * 8)) +
          Math.min(text.length, 220) / 3 +
          Math.min(wordCount, 24) * 4;
        return { text, score };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    const seenTexts = new Set();
    const selectedTexts = [];
    contextTexts.forEach((item) => {
      const normalized = item.text.toLowerCase();
      if (seenTexts.has(normalized)) return;
      seenTexts.add(normalized);
      selectedTexts.push(item.text);
    });

    const linkHints = [];
    const seenLinkHints = new Set();
    sameSection.forEach((item) => {
      (Array.isArray(item?.links) ? item.links : []).forEach((entry) => {
        const url = compactText(entry?.url ?? entry);
        if (!url || seenLinkHints.has(url)) return;
        seenLinkHints.add(url);
        linkHints.push(url);
      });
    });

    return {
      section_context_text: selectedTexts.slice(0, 3).join("\n"),
      section_link_hints: [
        ...linkHints.slice(0, 4),
        ...extractSdvgResearchLinkHintDomains(linkHints)
      ].slice(0, 6)
    };
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
    const startedSections = new Set();
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

      const sectionAtStart = !startedSections.has(sectionKey);
      const firstLeadText = String(leadWindow[0]?.text_quote ?? "").trim();
      if (sectionAtStart && SDVG_LEADING_COMMENT_START_RE.test(firstLeadText) && leadWindow.length >= 2) {
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
      startedSections.add(sectionKey);
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
    return sectionTitle || clipText(String(segment?.segment_id ?? "").trim(), 48) || "\u0441\u0435\u0433\u043C\u0435\u043D\u0442";
  }

  function selectResearchCandidatesByCategory(candidates = [], limit = RESEARCH_SUGGESTION_TOP_LIMIT) {
    const selected = [];
    const seenKeys = new Set();
    RESEARCH_CATEGORY_ORDER.forEach((categoryId) => {
      const match = (Array.isArray(candidates) ? candidates : []).find((item) => {
        const key = String(item?.key ?? "").trim();
        if (!key || seenKeys.has(key)) return false;
        return String(item?.ranked?.category_id ?? "other").trim().toLowerCase() === categoryId;
      });
      if (!match) return;
      seenKeys.add(String(match.key));
      selected.push(match);
    });
    if (selected.length >= limit) {
      return selected.slice(0, limit);
    }
    (Array.isArray(candidates) ? candidates : []).forEach((item) => {
      const key = String(item?.key ?? "").trim();
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      selected.push(item);
    });
    return selected.slice(0, limit);
  }

  function listResearchCandidatesForCategory(candidates = [], categoryId = "", excludedKeys = null) {
    const normalizedCategoryId = String(categoryId ?? "").trim().toLowerCase();
    return (Array.isArray(candidates) ? candidates : []).filter((item) => {
      const key = String(item?.key ?? "").trim();
      if (!key) return false;
      if (excludedKeys instanceof Set && excludedKeys.has(key)) return false;
      if (!normalizedCategoryId) return true;
      return String(item?.ranked?.category_id ?? "other").trim().toLowerCase() === normalizedCategoryId;
    });
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
      ...collectDismissedResearchKeys(decision),
      ...collectSeenResearchRunKeys(previousRuns),
      ...(extraExcludedKeys instanceof Set ? [...extraExcludedKeys] : [])
    ]);
    const rankingSegment = await enrichSegmentWithTranslatedText(
      {
        ...segment,
        ...buildSdvgSectionResearchContext(rawSegments, segment)
      },
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
      section_context_text: rankingSegment.section_context_text ?? "",
      section_link_hints: Array.isArray(rankingSegment?.section_link_hints) ? rankingSegment.section_link_hints : [],
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

  function buildAdHocResearchRankingSegment(query, themeLabel = "") {
    const normalizedQuery = compactText(query);
    const normalizedTheme = compactText(themeLabel);
    const tokens = normalizedQuery
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
      .slice(0, 8);
    return {
      segment_id: "__adhoc__",
      section_title: normalizedQuery,
      text_quote: normalizedQuery,
      section_context_text: normalizedTheme && normalizedTheme !== normalizedQuery ? normalizedTheme : "",
      research_use_topic_title: true,
      research_use_theme_tags: false,
      visual_decision: emptyVisualDecision(),
      search_decision: normalizeSearchDecisionInput({
        queries: normalizedQuery ? [normalizedQuery] : [],
        keywords: tokens
      })
    };
  }

  async function fetchAdHocResearchCandidates(query, themeLabel = "", extraExcludedKeys = new Set(), onProgress = null) {
    if (
      typeof generateSegmentResearchQueries !== "function" ||
      typeof searchQueries !== "function" ||
      typeof rankSegmentResearchResults !== "function" ||
      typeof mergeResearchScores !== "function"
    ) {
      return [];
    }
    const normalizedQuery = compactText(query);
    if (!normalizedQuery) return [];
    const topicLabel = clipText(normalizedQuery, 80);
    await notifyResearchProgress(onProgress, `🔎 Готовлю поиск: ${topicLabel}`);
    const [sourceProfiles, sourceMemory] = await Promise.all([
      typeof getSourceProfiles === "function" ? getSourceProfiles().catch(() => ({})) : Promise.resolve({}),
      typeof getSourceMemory === "function" ? getSourceMemory().catch(() => ({})) : Promise.resolve({})
    ]);
    const rankingSegment = await enrichSegmentWithTranslatedText(
      buildAdHocResearchRankingSegment(normalizedQuery, themeLabel),
      {
        visual_decision: emptyVisualDecision(),
        search_decision: {
          queries: [normalizedQuery]
        }
      },
      translateHeadingToEnglishQuery
    );
    await notifyResearchProgress(onProgress, `🔎 Собираю запросы: ${topicLabel}`);
    const queries = await generateSegmentResearchQueries(rankingSegment, { mode: "deep" });
    await notifyResearchProgress(onProgress, `🔎 Ищу материалы: ${topicLabel}`);
    const searchResult = await searchQueries(queries, { mode: "deep" });
    const filteredResults = filterBlockedResearchResults(dedupeResearchResults(searchResult?.results), sourceProfiles).filter((item) => {
      const key = canonicalizeBotUrl(item?.url);
      return key && !(extraExcludedKeys instanceof Set && extraExcludedKeys.has(key));
    });
    if (!filteredResults.length) return [];
    await notifyResearchProgress(onProgress, `🔎 Нашёл ${filteredResults.length} кандидатов: ${topicLabel}`);
    const llmScores = await rankSegmentResearchResults(rankingSegment, filteredResults, sourceProfiles);
    const rankedResults = mergeResearchScores(filteredResults, llmScores, sourceProfiles, sourceMemory, {
      section_title: rankingSegment.section_title,
      research_use_topic_title: true,
      research_use_theme_tags: false,
      text_quote: rankingSegment.text_quote,
      section_context_text: rankingSegment.section_context_text ?? "",
      section_link_hints: [],
      translated_text_quote: rankingSegment.translated_text_quote ?? "",
      visual_description: "",
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

  async function removeResearchSuggestionFromStoredRuns(docId, segmentId, targetUrl) {
    const normalizedUrlKey = canonicalizeBotUrl(targetUrl);
    if (!docId || !segmentId || !normalizedUrlKey || typeof listRunsForSegment !== "function") {
      return false;
    }
    const runs = await listRunsForSegment(docId, segmentId, { limit: 60 }).catch(() => []);
    for (const run of runs) {
      const result = (Array.isArray(run?.results) ? run.results : []).find(
        (item) => canonicalizeBotUrl(item?.url) === normalizedUrlKey
      );
      const runId = String(run?.run_id ?? "").trim();
      const resultId = String(result?.id ?? "").trim();
      if (!runId || !resultId) continue;
      const response = await fetch(
        `${getLocalBackendOrigin()}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/remove`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            run_id: runId,
            result_id: resultId
          })
        }
      ).catch(() => null);
      if (response?.ok) {
        return true;
      }
    }
    return false;
  }

  async function persistDismissedResearchSuggestion(docId, segmentId, candidate = null) {
    const url = String(candidate?.result?.url ?? "").trim();
    if (!docId || !segmentId || !url) return false;
    const response = await fetch(
      `${getLocalBackendOrigin()}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/dismiss`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          title: String(candidate?.result?.title ?? "").trim(),
          domain: String(candidate?.result?.domain ?? "").trim(),
          source: "sdvg_drop"
        })
      }
    ).catch(() => null);
    return Boolean(response?.ok);
  }

  function normalizeSectionTitleForDisplay(value) {
    return String(value ?? "")
      .replace(/\(\s*\d+\s*\)\s*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shouldRenameIncomingImage(item = {}) {
    const fileName = compactText(item?.fileName).toLowerCase();
    const mimeType = compactText(item?.mimeType).toLowerCase();
    const kind = compactText(item?.kind).toLowerCase();
    const imageLike = kind === "photo" || mimeType.startsWith("image/") || isImageFilePath(fileName);
    if (!imageLike) return false;
    if (kind === "photo") return true;
    return /^(?:image|img|photo)[_-]?.*\.(?:png|jpe?g|webp)$/i.test(fileName);
  }

  function isIncomingWebpImage(item = {}) {
    const fileName = compactText(item?.fileName).toLowerCase();
    const mimeType = compactText(item?.mimeType).toLowerCase();
    return mimeType === "image/webp" || /\.webp$/i.test(fileName);
  }

  function replaceFileExtension(fileName, nextExtension = ".png") {
    const parsed = path.parse(compactText(fileName) || "image");
    const baseName = sanitizeFileName(parsed.name || "image", "image");
    return `${baseName}${String(nextExtension || ".png").trim() || ".png"}`;
  }

  function detectChromeExecutableForImageConversion() {
    const candidates = [
      process.env.SCREENSHOT_BROWSER_EXECUTABLE_PATH,
      process.env.CHROME_PATH,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
        : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
        : ""
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return "";
  }

  async function loadPuppeteerForImageConversion() {
    try {
      const mod = await import("puppeteer");
      return mod?.default ?? mod;
    } catch {
      const mod = await import("../../../HeadlessNotion/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js");
      return mod?.default ?? mod;
    }
  }

  async function convertLocalWebpToPng(sourcePath, targetPath) {
    const absoluteSource = path.resolve(String(sourcePath ?? "").trim());
    const absoluteTarget = path.resolve(String(targetPath ?? "").trim());
    if (!absoluteSource || !absoluteTarget) {
      throw new Error("WEBP conversion paths are invalid");
    }
    const puppeteer = await loadPuppeteerForImageConversion();
    const executablePath = detectChromeExecutableForImageConversion();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1600, deviceScaleFactor: 1 });
      const fileUrl = pathToFileURL(absoluteSource).href;
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:#fff"><img id="img" src="${fileUrl}" style="display:block;max-width:none;max-height:none"></body></html>`,
        { waitUntil: "load" }
      );
      await page.waitForFunction(() => {
        const img = document.getElementById("img");
        return Boolean(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
      }, { timeout: 15000 });
      const dimensions = await page.evaluate(() => {
        const img = document.getElementById("img");
        return {
          width: Math.max(1, Number(img?.naturalWidth ?? img?.width ?? 1)),
          height: Math.max(1, Number(img?.naturalHeight ?? img?.height ?? 1))
        };
      });
      await page.setViewport({
        width: Math.min(4096, Math.max(1, Number(dimensions?.width ?? 1))),
        height: Math.min(4096, Math.max(1, Number(dimensions?.height ?? 1))),
        deviceScaleFactor: 1
      });
      const imageHandle = await page.$("#img");
      if (!imageHandle) throw new Error("WEBP image element not found");
      await imageHandle.screenshot({
        type: "png",
        path: absoluteTarget,
        omitBackground: false
      });
    } finally {
      await browser.close().catch(() => null);
    }
  }

  function buildIncomingImageFileName(segment = {}, item = {}, timestamp = Date.now(), forcedExtension = "") {
    const originalName = compactText(item?.fileName);
    const extMatch = originalName.match(/(\.[a-z0-9]+)$/i);
    const extension = String(forcedExtension ?? "").trim().toLowerCase() || (
      extMatch?.[1]
        ? extMatch[1].toLowerCase()
        : compactText(item?.mimeType).toLowerCase() === "image/png"
          ? ".png"
          : ".jpg"
    );
    const sectionTitle = normalizeSectionTitleForDisplay(segment?.section_title ?? "");
    const segmentId = compactText(segment?.segment_id);
    const baseLabel = sectionTitle || segmentId || "UT";
    const uniqueSuffix = compactText(item?.fileUniqueId)
      .replace(/[^a-z0-9]+/gi, "")
      .slice(-8)
      .toLowerCase();
    const timeSuffix = formatFileDateTimeSuffix(timestamp).replace(/-/g, "");
    const stem = uniqueSuffix
      ? `${baseLabel}_${timeSuffix}_${uniqueSuffix}`
      : `${baseLabel}_${timeSuffix}`;
    return `${sanitizeFileName(stem, "UT")}${extension}`;
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

  function buildResearchSuggestionKeyboard(entry = {}, options = {}) {
    const mode = String(options?.mode ?? "segment").trim().toLowerCase();
    const url = String(entry?.result?.url ?? "").trim();
    const downloadable = url ? isYtDlpCandidateUrl(url) : false;
    const rows = [];
    const actionRow = [];
    if (mode === "adhoc") {
      if (downloadable) {
        actionRow.push({ text: "⬇️ Скачать", callback_data: "sdvg_rs:add" });
      }
      if (url) {
        actionRow.push({ text: "📸 Screenshot", callback_data: "sdvg_rs:shot" });
      }
    } else {
      actionRow.push({ text: "➕ В тему", callback_data: "sdvg_rs:add" });
    }
    actionRow.push({ text: "🔄 Ещё", callback_data: "sdvg_rs:refresh" });
    actionRow.push({ text: "✖️", callback_data: "sdvg_rs:drop" });
    rows.push(actionRow);
    if (url) {
      rows.push([{ text: "🔗 Открыть", url }]);
    }
    return {
      inline_keyboard: rows
    };
  }

  function formatResearchPublishedAt(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(parsed);
    }
    const dateOnlyMatch = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
    }
    const yearOnlyMatch = raw.match(/\b(19|20)\d{2}\b/);
    return yearOnlyMatch ? yearOnlyMatch[0] : clipText(raw, 32);
  }

  function buildResearchSuggestionText(entry = {}, position = null) {
    const result = entry?.result ?? {};
    const title = clipText(String(result?.title ?? result?.url ?? "").trim() || "Research link", 220);
    const domain = clipText(String(result?.domain ?? "").trim(), 120);
    const url = String(result?.url ?? "").trim();
    const snippet = clipText(String(result?.snippet ?? "").replace(/\s+/g, " ").trim(), 240);
    const header =
      position != null ? `\uD83D\uDD0E ${position}. ${escapeHtml(title)}` : `\uD83D\uDD0E ${escapeHtml(title)}`;
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

  function buildResearchSuggestionTextV2(entry = {}, position = null) {
    const result = entry?.result ?? {};
    const title = clipText(String(result?.title ?? result?.url ?? "").trim() || "Research link", 220);
    const domain = clipText(String(result?.domain ?? "").trim(), 120);
    const url = String(result?.url ?? "").trim();
    const snippet = clipText(String(result?.snippet ?? "").replace(/\s+/g, " ").trim(), 240);
    const publishedAt = formatResearchPublishedAt(result?.published_at);
    const header =
      position != null ? `\uD83D\uDD0E ${position}. ${escapeHtml(title)}` : `\uD83D\uDD0E ${escapeHtml(title)}`;
    const sourceLabel = domain || extractHostLabel(url) || "source";
    return [
      header,
      url
        ? `<a href="${escapeHtml(url)}">${escapeHtml(sourceLabel)}</a>`
        : sourceLabel
          ? escapeHtml(sourceLabel)
          : "",
      publishedAt ? `\uD83D\uDCC5 ${escapeHtml(publishedAt)}` : "",
      snippet ? `<blockquote>${escapeHtml(snippet)}</blockquote>` : ""
    ].filter(Boolean).join("\n");
  }

  function buildCategorizedResearchSuggestionText(entry = {}, position = null) {
    const result = entry?.result ?? {};
    const title = clipText(String(result?.title ?? result?.url ?? "").trim() || "Research link", 220);
    const domain = clipText(String(result?.domain ?? "").trim(), 120);
    const url = String(result?.url ?? "").trim();
    const snippet = clipText(String(result?.snippet ?? "").replace(/\s+/g, " ").trim(), 240);
    const publishedAt = formatResearchPublishedAt(result?.published_at);
    const category = getResearchCategoryPresentation(entry?.ranked?.category_id);
    const header = position != null
      ? `${category.icon} ${position}. ${category.label}\n${escapeHtml(title)}`
      : `${category.icon} ${category.label}\n${escapeHtml(title)}`;
    const sourceLabel = domain || extractHostLabel(url) || "source";
    return [
      header,
      url
        ? `<a href="${escapeHtml(url)}">${escapeHtml(sourceLabel)}</a>`
        : sourceLabel
          ? escapeHtml(sourceLabel)
          : "",
      publishedAt ? `\uD83D\uDCC5 ${escapeHtml(publishedAt)}` : "",
      snippet ? `<blockquote>${escapeHtml(snippet)}</blockquote>` : ""
    ].filter(Boolean).join("\n");
  }

  function formatPickedFileButtonText(relativePath) {
    const normalized = normalizeRelativeMediaPath(relativePath);
    const base = path.basename(normalized || String(relativePath ?? "").trim());
    const parent = path.posix.basename(path.posix.dirname(normalized || ""));
    const label = parent && parent !== "." ? `${base} • ${parent}` : base;
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
      rows.push([{ text: "\u0424\u0430\u0439\u043B\u043E\u0432 \u043D\u0435\u0442", callback_data: "sdvg_pick:noop" }]);
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
      { text: "\uD83D\uDCC2", callback_data: "sdvg_pick:open" },
      { text: "\uD83D\uDD0E", callback_data: "sdvg_rs:open" },
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

      const segmentsRaw = await loadWritableSegmentsForBot(docId);
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
      segment_id: segment.segment_id,
      segment_section_title: String(segment?.section_title ?? "").trim(),
      segment_text_quote: String(segment?.text_quote ?? "").trim()
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
      const allSegmentsRaw = await loadWritableSegmentsForBot(docId);
      const allSegments = Array.isArray(allSegmentsRaw) ? allSegmentsRaw : [];
      const segments = normalizeSegmentList(allSegments);
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
        visual_decision:
          typeof applyVisualDecisionFieldOrigins === "function"
            ? applyVisualDecisionFieldOrigins(visual, {
                ...visual,
                description: mergedDescription
              }, {
                description_origin: "user",
                updated_at: new Date().toISOString()
              })
            : normalizeVisualDecisionInput({
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
      await syncDocumentContextForBot(docId, allSegments, normalized, "telegram_sdvg_description_update");
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
      const allSegmentsRaw = await loadWritableSegmentsForBot(docId);
      const allSegments = Array.isArray(allSegmentsRaw) ? allSegmentsRaw : [];
      const segments = normalizeSegmentList(allSegments);
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
        visual_decision:
          typeof applyVisualDecisionFieldOrigins === "function"
            ? applyVisualDecisionFieldOrigins(visual, {
                ...mergedVisual,
                media_file_timecodes: mergedTimecodes,
                media_start_timecode: firstVideoPath
                  ? normalizedMediaStartTimecode ?? mergedTimecodes[firstVideoPath] ?? null
                  : null
              }, {
                media_origin: "user",
                updated_at: new Date().toISOString()
              })
            : normalizeVisualDecisionInput({
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
      await syncDocumentContextForBot(docId, allSegments, normalized, "telegram_sdvg_media_attach");
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

      const segmentsRaw = await loadWritableSegmentsForBot(docId);
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
    return preferred.length > 0 ? preferred : other;
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

  async function downloadTelegramFileToDirectory(fileId, outputDir, preferredName) {
    const fileResult = await telegramApiCall("getFile", { file_id: fileId });
    const rawFilePath = String(fileResult?.file_path ?? "").trim();
    if (!rawFilePath) {
      throw new Error("Telegram did not return file_path");
    }
    const filePath = normalizeTelegramFilePath(rawFilePath, localStoragePrefix);
    if (!filePath) {
      throw new Error("Telegram returned empty normalized file_path");
    }
    const sourceName = preferredName || path.basename(filePath);
    const safeName = sanitizeFileName(sourceName, "telegram_file");
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

  async function downloadTelegramFileToTopic(fileId, sectionTitle, preferredName) {
    const topic = sanitizeMediaTopicName(sectionTitle);
    const outputDir = await ensureMediaDir(topic);
    return downloadTelegramFileToDirectory(fileId, outputDir, preferredName);
  }

  async function ensureProjectArchiveDir(docId) {
    const mediaRoot = path.resolve(getMediaDir());
    const archiveRoot = path.join(mediaRoot, "ARCHIVE_PROJECTS");
    const documentFolder = sanitizeMediaTopicName(String(docId ?? "").trim() || "UT");
    const targetDir = path.join(archiveRoot, documentFolder);
    await fs.mkdir(targetDir, { recursive: true });
    return targetDir;
  }

  async function downloadTelegramFileToProjectArchive(docId, fileId, preferredName) {
    const outputDir = await ensureProjectArchiveDir(docId);
    return downloadTelegramFileToDirectory(fileId, outputDir, preferredName);
  }

  function formatJobStatusMessage(segmentId, url, job) {
    const status = String(job?.status ?? "queued");
    const progress = String(job?.progress ?? "").trim();
    const progressLine = progress
      ? `\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: ${progress}`
      : "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441: ...";
    const errorLine = job?.error ? `\u041E\u0448\u0438\u0431\u043A\u0430: ${job.error}` : "";
    const operatorTitle = String(job?.operator_notice?.title ?? "").trim();
    const operatorHint = String(job?.operator_notice?.hint ?? "").trim();
    const operatorAutoRefreshAttempted = Boolean(job?.operator_notice?.auto_refresh_attempted);
    const operatorAutoRefreshOk = Boolean(job?.operator_notice?.auto_refresh_ok);
    const operatorAutoRefreshCount = Number(job?.operator_notice?.auto_refresh_count ?? 0);
    const operatorAutoRefreshError = String(job?.operator_notice?.auto_refresh_error ?? "").trim();
    const lines = [
      `\u0421\u0435\u0433\u043C\u0435\u043D\u0442: ${segmentId}`,
      `URL: ${url}`,
      `\u0421\u0442\u0430\u0442\u0443\u0441: ${status}`,
      progressLine
    ];
    if (errorLine) lines.push(errorLine);
    if (operatorTitle) lines.push(`\u0412\u043D\u0438\u043C\u0430\u043D\u0438\u0435: ${operatorTitle}`);
    if (operatorHint) lines.push(`\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430: ${operatorHint}`);
    if (operatorAutoRefreshAttempted) {
      lines.push(
        operatorAutoRefreshOk
          ? `\u0410\u0432\u0442\u043E\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 cookies: ok (${operatorAutoRefreshCount})`
          : `\u0410\u0432\u0442\u043E\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 cookies: ${operatorAutoRefreshError || "failed"}`
      );
    }
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
          const createdAssets = await registerSegmentMediaAssets({
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
          const assetIdByPath = new Map(
            (Array.isArray(createdAssets) ? createdAssets : [])
              .map((asset) => [normalizeRelativeMediaPath(asset?.local_path ?? ""), String(asset?.id ?? "").trim()])
              .filter((item) => item[0] && item[1])
          );
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
            deleteSourceMessage: true,
            themePicker: {
              enabled: true,
              session: getSession(chatId),
              docId: docId,
              assetIdByPath,
              segmentId
            }
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
          const createdAssets = await registerInboxDownloadedAssets({
            chatId,
            session,
            message,
            sourceUrl: url,
            relativePaths: downloadedPaths,
            metadata
          });
          const assetIdByPath = new Map(
            (Array.isArray(createdAssets) ? createdAssets : [])
              .map((asset) => [normalizeRelativeMediaPath(asset?.local_path ?? ""), String(asset?.id ?? "").trim()])
              .filter((item) => item[0] && item[1])
          );
          await editMessage(
            chatId,
            statusMessageId,
            `\u0413\u043E\u0442\u043E\u0432\u043E.\nUNSORTED: ${downloadedPaths.length} \u0444\u0430\u0439\u043B(\u043E\u0432).`
          ).catch(() => null);
          scheduleMessageDeletion(chatId, statusMessageId, 3 * 60 * 1000);
          await sendDownloadedMediaBackToChat(chatId, "UNSORTED", url, downloadedPaths, metadata, {
            sourceMessageId: message?.message_id,
            deleteSourceMessage: true,
            themePicker: {
              enabled: true,
              session,
              docId: resolveInboxDownloadDocId(session),
              assetIdByPath
            }
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
      await sendMessage(chatId, SDVG_MESSAGES.linkSavedToInboxNoDownloader);
      return;
    }
    if (!isHttpUrl(url)) {
      await sendMessage(chatId, "URL \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C http(s).");
      return;
    }
    if (!isYtDlpCandidateUrl(url)) {
      await sendMessage(chatId, "\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430 \u0432 Inbox.");
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
          const createdAssets = await registerSegmentMediaAssets({
            chatId,
            session,
            segment,
            relativePaths: cachedPaths,
            sourceUrl: url,
            source: "yt_dlp_url_cached",
            mediaStartTimecode: normalizedMediaStartTimecode
          });
          const assetIdByPath = new Map(
            (Array.isArray(createdAssets) ? createdAssets : [])
              .map((asset) => [normalizeRelativeMediaPath(asset?.local_path ?? ""), String(asset?.id ?? "").trim()])
              .filter((item) => item[0] && item[1])
          );
          await sendMessage(
            chatId,
            `\u0423\u0436\u0435 \u0441\u043A\u0430\u0447\u0430\u043D\u043E. \u0414\u043E\u0431\u0430\u0432\u0438\u043B \u0432 ${segment.segment_id}: ${cachedPaths.length} \u0444\u0430\u0439\u043B(\u043E\u0432).`
          );
          await sendDownloadedMediaBackToChat(chatId, segment.segment_id, url, cachedPaths, null, {
            sourceMessageId,
            deleteSourceMessage: true,
            themePicker: {
              enabled: true,
              session,
              docId: session.doc_id,
              assetIdByPath,
              segmentId: segment.segment_id
            }
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
  function buildTelegramMediaBatchKeyboard(batch = null) {
    const batchId = compactText(batch?.batch_id);
    const failedCount = Array.isArray(batch?.failed_items) ? batch.failed_items.length : 0;
    if (!batchId || failedCount <= 0) return undefined;
    return {
      inline_keyboard: [[{ text: `🔁 Retry failed (${failedCount})`, callback_data: `sdvg_batch:retry:${batchId}` }]]
    };
  }

  function buildTelegramMediaBatchSummary(segmentId, downloadedCount, totalCount, attachedCount, failedCount) {
    const lines = [
      "Готово.",
      `Сегмент: ${segmentId}`,
      `Скачано файлов из Telegram: ${downloadedCount}/${totalCount}`,
      `Файлов добавлено: ${attachedCount}`
    ];
    if (failedCount > 0) {
      lines.push(`Ошибок: ${failedCount}`);
      lines.push("Доступен Retry failed.");
    }
    return lines.join("\n");
  }

  function toTelegramBatchFailedItem(item, error = "", retryCount = 0) {
    return {
      file_id: compactText(item?.fileId),
      file_unique_id: compactText(item?.fileUniqueId),
      file_name: compactText(item?.fileName),
      mime_type: compactText(item?.mimeType),
      kind: compactText(item?.kind),
      error: clipText(error, 240),
      retry_count: Math.max(0, Number(retryCount ?? 0) || 0)
    };
  }

  async function handleTelegramMediaInput(chatId, session, segment, mediaItems, sourceMessageId = null, options = {}) {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) return;
    const retryOnly = options.retryOnly === true;
    const batchId = compactText(options.batchId) || `tgm_${createPickerToken()}`;
    const previousBatch = getTelegramMediaBatchAudit(session, batchId);
    const totalCount = Math.max(mediaItems.length, Number(previousBatch?.expected ?? 0) || 0);
    let statusMessageId = Number(options.statusMessageId ?? previousBatch?.status_message_id ?? 0) || null;
    if (!statusMessageId) {
      const status = await sendMessage(
        chatId,
        `Сегмент: ${segment.segment_id}\nСкачано файлов из Telegram: ${Number(previousBatch?.downloaded ?? 0) || 0}/${totalCount}`
      );
      statusMessageId = Number(status?.message_id ?? 0) || null;
    }
    upsertTelegramMediaBatchAudit(session, batchId, {
      doc_id: String(session?.doc_id ?? "").trim(),
      segment_id: String(segment?.segment_id ?? "").trim(),
      chat_id: String(chatId ?? ""),
      source_message_id: Number(sourceMessageId ?? previousBatch?.source_message_id ?? 0) || null,
      status_message_id: statusMessageId,
      expected: totalCount,
      downloaded: Number(previousBatch?.downloaded ?? 0) || 0,
      failed: retryOnly ? 0 : Number(previousBatch?.failed ?? 0) || 0,
      retried: Number(previousBatch?.retried ?? 0) || 0,
      failed_items: retryOnly ? [] : previousBatch?.failed_items ?? [],
      status: retryOnly ? "retrying" : "running"
    });
    const attachedPaths = [];
    const echoedUploads = [];
    const nextFailedItems = [];
    let downloadedCount = Number(previousBatch?.downloaded ?? 0) || 0;
    let retriedCount = Number(previousBatch?.retried ?? 0) || 0;
    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? "");
    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      await editMessage(
        chatId,
        statusMessageId,
        `Сегмент: ${segment.segment_id}\nСкачано файлов из Telegram: ${downloadedCount}/${totalCount}\nСейчас скачиваю: ${index + 1}/${mediaItems.length}`
      ).catch(() => null);
      const shouldRename = shouldRenameIncomingImage(item);
      const shouldConvertWebp = isIncomingWebpImage(item);
      const preferredName = shouldRename
        ? buildIncomingImageFileName(segment, item, Date.now(), shouldConvertWebp ? ".png" : "")
        : shouldConvertWebp
          ? replaceFileExtension(item.fileName, ".png")
          : item.fileName;
      const previousRetryCount =
        retryOnly
          ? Number(
              (Array.isArray(previousBatch?.failed_items) ? previousBatch.failed_items : []).find(
                (entry) => String(entry?.file_id ?? "") === String(item?.fileId ?? "")
              )?.retry_count ?? 0
            ) || 0
          : 0;
      let savedPath = null;
      let lastError = null;
      let attempt = 0;
      while (attempt < 2 && !savedPath) {
        try {
          if (attempt > 0) retriedCount += 1;
          savedPath = await downloadTelegramFileToTopic(item.fileId, sectionTitle, preferredName);
        } catch (error) {
          lastError = error;
          attempt += 1;
          if (attempt < 2) await delay(300);
        }
      }
      let finalSavedPath = savedPath;
      let finalFileName = preferredName;
      if (savedPath && shouldConvertWebp) {
        const mediaRoot = path.resolve(getMediaDir());
        const absoluteSavedPath = path.resolve(mediaRoot, normalizeRelativeMediaPath(savedPath).replace(/\//g, path.sep));
        const targetPath = await ensureUniqueFilePath(path.dirname(absoluteSavedPath), replaceFileExtension(preferredName, ".png"));
        try {
          await convertLocalWebpToPng(absoluteSavedPath, targetPath);
          await fs.unlink(absoluteSavedPath).catch(() => null);
          finalSavedPath = normalizeRelativeMediaPath(path.relative(mediaRoot, targetPath).split(path.sep).join("/"));
          finalFileName = path.basename(targetPath);
        } catch (error) {
          await sendMessage(chatId, `Не удалось конвертировать WEBP в PNG: ${error?.message ?? error}`).catch(() => null);
        }
      }
      if (!finalSavedPath) {
        nextFailedItems.push(toTelegramBatchFailedItem(item, lastError?.message ?? "download_failed", previousRetryCount + 1));
        continue;
      }
      if (finalSavedPath) {
        attachedPaths.push(finalSavedPath);
        if (shouldRename || shouldConvertWebp) {
          echoedUploads.push({
            relativePath: finalSavedPath,
            fileName: finalFileName || path.basename(finalSavedPath)
          });
        }
        await createAssetRecord(
          {
            kind: "telegram_media",
            status: "processed",
            title: finalFileName || preferredName,
            description: String(segment?.text_quote ?? "").trim(),
            telegramChatId: String(chatId),
            telegramFileId: item.fileId,
            telegramFileUniqueId: item.fileUniqueId,
            mimeType: item.mimeType,
            fileName: finalFileName || preferredName,
            localPath: finalSavedPath,
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
        downloadedCount += 1;
        await editMessage(
          chatId,
          statusMessageId,
          `Сегмент: ${segment.segment_id}\nСкачано файлов из Telegram: ${downloadedCount}/${totalCount}`
        ).catch(() => null);
      }
    }
    if (attachedPaths.length > 0) {
      await appendSegmentMediaPaths(session.doc_id, segment.segment_id, attachedPaths, chatId, "telegram_media");
    }
    let echoedCount = 0;
    if (echoedUploads.length > 0) {
      const mediaRoot = path.resolve(getMediaDir());
      for (const item of echoedUploads) {
        const relativePath = normalizeRelativeMediaPath(item?.relativePath);
        if (!relativePath) continue;
        const absolutePath = path.resolve(mediaRoot, relativePath.replace(/\//g, path.sep));
        const insideMediaRoot = absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);
        if (!insideMediaRoot || !(await fileExists(absolutePath))) continue;
        await telegramApiCallMultipart(
          "sendDocument",
          {
            chat_id: chatId
          },
          "document",
          absolutePath,
          String(item?.fileName ?? path.basename(absolutePath) ?? "image.jpg").trim() || "image.jpg",
          180000
        ).then(() => {
          echoedCount += 1;
        }).catch(() => null);
      }
      if (sourceMessageId && echoedCount > 0) {
        await deleteMessage(chatId, sourceMessageId).catch(() => null);
      }
    }
    const finalBatch = upsertTelegramMediaBatchAudit(session, batchId, {
      doc_id: String(session?.doc_id ?? "").trim(),
      segment_id: String(segment?.segment_id ?? "").trim(),
      chat_id: String(chatId ?? ""),
      source_message_id: Number(sourceMessageId ?? previousBatch?.source_message_id ?? 0) || null,
      status_message_id: statusMessageId,
      expected: totalCount,
      downloaded: downloadedCount,
      failed: nextFailedItems.length,
      retried: retriedCount,
      failed_items: nextFailedItems,
      status:
        nextFailedItems.length > 0
          ? downloadedCount > 0
            ? "partial"
            : "failed"
          : "completed"
    });
    await editMessage(
      chatId,
      statusMessageId,
      buildTelegramMediaBatchSummary(segment.segment_id, downloadedCount, totalCount, attachedPaths.length, nextFailedItems.length),
      finalBatch?.status === "partial" || finalBatch?.status === "failed"
        ? { reply_markup: buildTelegramMediaBatchKeyboard(finalBatch) }
        : { reply_markup: { inline_keyboard: [] } }
    ).catch(() => null);
  }

  async function handleProjectArchiveUpload(chatId, session, mediaItems) {
    const request = getPendingProjectArchiveRequest(session);
    const docId = String(request?.doc_id ?? session?.doc_id ?? "").trim();
    if (!docId || !Array.isArray(mediaItems) || mediaItems.length === 0) return false;

    const status = await sendMessage(
      chatId,
      `📦 Архивирую проект для документа <code>${escapeHtml(docId)}</code>: 0/${mediaItems.length}`,
      { parse_mode: "HTML" }
    ).catch(() => null);

    const savedPaths = [];
    try {
      for (let index = 0; index < mediaItems.length; index += 1) {
        const item = mediaItems[index];
        await editMessage(
          chatId,
          status?.message_id,
          `📦 Архивирую проект для документа <code>${escapeHtml(docId)}</code>: ${index + 1}/${mediaItems.length}`,
          { parse_mode: "HTML" }
        ).catch(() => null);
        const preferredName = String(item?.fileName ?? "").trim() || `project_${index + 1}`;
        const savedPath = await downloadTelegramFileToProjectArchive(docId, item.fileId, preferredName);
        if (savedPath) {
          savedPaths.push(savedPath);
        }
      }
    } catch (error) {
      await sendMessage(
        chatId,
        `📦 Не удалось сохранить проект в архив <code>${escapeHtml(docId)}</code>: ${escapeHtml(error?.message ?? error)}`,
        { parse_mode: "HTML" }
      ).catch(() => null);
      return false;
    }

    clearPendingProjectArchiveRequest(session);
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "telegram_project_archived",
      payload: {
        chat_id: String(chatId),
        files: savedPaths
      }
    }).catch(() => null);

    await editMessage(
      chatId,
      status?.message_id,
      `📦 Проект сохранён в архив <code>${escapeHtml(docId)}</code>.\nФайлов: ${savedPaths.length}`,
      { parse_mode: "HTML" }
    ).catch(async () => {
      await sendMessage(
        chatId,
        `📦 Проект сохранён в архив <code>${escapeHtml(docId)}</code>.\nФайлов: ${savedPaths.length}`,
        { parse_mode: "HTML" }
      ).catch(() => null);
    });
    return savedPaths.length > 0;
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
    clearPendingProjectArchiveRequest(session);
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
      await sendMessage(
        chatId,
        `\u0412 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0435 "${docId}" \u043D\u0435\u0442 \u0441\u0435\u0433\u043C\u0435\u043D\u0442\u043E\u0432.`
      );
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
  async function applyDownloadThemeSelection(chatId, session, callbackMessageId, context, themeName) {
    const selectedTheme = String(themeName ?? "").trim();
    if (!selectedTheme) throw new Error("theme is required");
    const items = (Array.isArray(context?.items) ? context.items : [{ relative_path: context?.relative_path, asset_id: context?.asset_id }])
      .map((item) => ({
        relative_path: normalizeRelativeMediaPath(item?.relative_path),
        asset_id: String(item?.asset_id ?? "").trim() || null
      }))
      .filter((item) => item.relative_path);
    if (!items.length) throw new Error("file context is missing");

    const movedItems = [];
    for (const item of items) {
      const currentAppliedTheme = resolveThemeFromRelativePath(item.relative_path);
      const moveResult =
        currentAppliedTheme && currentAppliedTheme.toLowerCase() === selectedTheme.toLowerCase()
          ? {
              next_relative_path: item.relative_path,
              strategy: "already_in_theme",
              renamed_with_suffix: false,
              source_deleted: false,
              reused_existing: false
            }
          : await moveDownloadedMediaToTheme(item.relative_path, selectedTheme);
      movedItems.push({
        ...item,
        next_relative_path: moveResult.next_relative_path,
        move_strategy: moveResult.strategy,
        renamed_with_suffix: Boolean(moveResult.renamed_with_suffix),
        source_deleted: Boolean(moveResult.source_deleted),
        reused_existing: Boolean(moveResult.reused_existing)
      });
    }

    const previousRelativePath = movedItems[0].relative_path;
    const nextRelativePath = movedItems[0].next_relative_path;
    const moveAuditPayload = buildDownloadThemeMoveAuditPayload({
      chatId,
      context,
      selectedTheme,
      movedItems
    });
    const nextThemes = await listDownloadThemeFolders();
    session.selected_download_theme = selectedTheme;
    const nextContext = {
      ...context,
      relative_path: nextRelativePath,
      asset_id: movedItems[0].asset_id,
      items: movedItems.map((item) => ({
        relative_path: item.next_relative_path,
        asset_id: item.asset_id
      })),
      themes: nextThemes,
      page: 0,
      current_theme: selectedTheme,
      applied_theme: selectedTheme
    };
    rememberDownloadThemeContext(session, callbackMessageId, nextContext);

    const assetRegistrySync = await reconcileMovedAssetRegistryEntries(movedItems);
    if (assetRegistrySync.unresolved_count > 0) {
      logThemeMove("warn", {
        type: "asset_registry_sync_partial",
        theme: selectedTheme,
        unresolved_count: assetRegistrySync.unresolved_count,
        updated_count: assetRegistrySync.updated_count,
        item_count: movedItems.length
      });
    }
    if (context?.doc_id && context?.segment_id) {
      for (const item of movedItems) {
        await replaceSegmentMediaPath(
          String(context.doc_id),
          String(context.segment_id),
          item.relative_path,
          item.next_relative_path,
          chatId
        ).catch(() => null);
      }
    }
    if (context?.doc_id) {
      await appendEvent(String(context.doc_id), {
        timestamp: new Date().toISOString(),
        event: "telegram_download_theme_selected",
        payload: {
          chat_id: String(chatId ?? ""),
          asset_id: String(movedItems[0]?.asset_id ?? ""),
          source_url: String(context?.source_url ?? ""),
          theme: selectedTheme,
          previous_relative_path: previousRelativePath,
          next_relative_path: nextRelativePath,
          moved_paths: moveAuditPayload.moved_paths,
          move_strategy: movedItems[0]?.move_strategy ?? null,
          source_deleted: Boolean(movedItems[0]?.source_deleted),
          reused_existing: Boolean(movedItems[0]?.reused_existing),
          renamed_with_suffix: Boolean(movedItems[0]?.renamed_with_suffix)
        }
      }).catch(() => null);
    }
    logThemeMove(
      movedItems.some((item) => item.move_strategy === "copied_then_deleted" || !item.source_deleted) ? "warn" : "info",
      moveAuditPayload
    );
    await syncSessionState(chatId, session, {
      mode: String(session?.active_segment_id ? "sdvg" : "download")
    });
    await editMessage(chatId, callbackMessageId, buildDownloadThemeMessageText(selectedTheme, selectedTheme), {
      reply_markup: buildDownloadThemeCollapsedKeyboard(selectedTheme, selectedTheme)
    }).catch(() => null);
    return nextContext;
  }

  async function replaceSegmentMediaPath(docId, segmentId, fromPath, toPath, chatId) {
    const oldPath = normalizeRelativeMediaPath(fromPath);
    const nextPath = normalizeRelativeMediaPath(toPath);
    if (!docId || !segmentId || !oldPath || !nextPath || oldPath === nextPath) return null;
    return withDocumentLock(docId, async () => {
      const allSegmentsRaw = await loadWritableSegmentsForBot(docId);
      const allSegments = Array.isArray(allSegmentsRaw) ? allSegmentsRaw : [];
      const decisions = await loadDecisionsForBot(docId);
      const list = Array.isArray(decisions) ? [...decisions] : [];
      const index = list.findIndex((item) => String(item?.segment_id ?? "") === String(segmentId));
      if (index < 0) return null;
      const current = list[index];
      const visual = normalizeVisualDecisionInput(current?.visual_decision);
      if (!visual.media_file_paths.includes(oldPath) && visual.media_file_path !== oldPath) {
        return null;
      }
      const remappedPaths = visual.media_file_paths.map((item) => (item === oldPath ? nextPath : item));
      const nextTimecodes = {};
      Object.entries(visual.media_file_timecodes ?? {}).forEach(([mediaPath, timecode]) => {
        nextTimecodes[mediaPath === oldPath ? nextPath : mediaPath] = timecode;
      });
      const nextVisual = normalizeVisualDecisionInput({
        ...visual,
        media_file_paths: remappedPaths,
        media_file_path: visual.media_file_path === oldPath ? nextPath : visual.media_file_path,
        media_file_timecodes: nextTimecodes
      });
      list[index] = {
        ...current,
        visual_decision: nextVisual,
        search_decision: normalizeSearchDecisionInput(current.search_decision),
        search_decision_en: normalizeSearchDecisionInput(current.search_decision_en),
        version: Number(current.version ?? 1)
      };
      const normalized = normalizeDecisionsInput(list);
      const version = await saveVersioned(docId, "decisions", normalized);
      await syncDocumentContextForBot(docId, allSegments, normalized, "telegram_sdvg_media_path_move");
      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "telegram_sdvg_media_path_moved",
        payload: {
          segment_id: segmentId,
          chat_id: String(chatId ?? ""),
          previous_relative_path: oldPath,
          next_relative_path: nextPath,
          decisions_version: version
        }
      }).catch(() => null);
      return { version };
    });
  }

  async function handleDownloadThemeCallback(chatId, callbackId, callbackMessageId, session, data) {
    const context = getDownloadThemeContext(session, callbackMessageId);
    if (!context?.relative_path) {
      await answerCallback(
        callbackId,
        "\u041A\u043D\u043E\u043F\u043A\u0430 \u0442\u0435\u043C\u044B \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430. \u041F\u0440\u0438\u0448\u043B\u0438 \u0444\u0430\u0439\u043B \u0435\u0449\u0435 \u0440\u0430\u0437.",
        true
      ).catch(() => null);
      return;
    }

    const action = String(data ?? "").slice("sdvg_theme:".length).trim();
    try {
      if (!action || action === "noop") {
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "apply") {
        const selectedTheme =
          String(context?.current_theme ?? "").trim() || String(session?.selected_download_theme ?? "").trim();
        if (!selectedTheme) {
          const themes = await listDownloadThemeFolders();
          const nextContext = {
            ...context,
            themes,
            page: 0,
            current_theme: "",
            applied_theme: String(context?.applied_theme ?? "").trim()
          };
          rememberDownloadThemeContext(session, callbackMessageId, nextContext);
          await editMessage(chatId, callbackMessageId, buildDownloadThemeMessageText("", nextContext.applied_theme), {
            reply_markup: buildDownloadThemePickerKeyboard(nextContext)
          }).catch(() => null);
          await answerCallback(callbackId, "\u0412\u044B\u0431\u0435\u0440\u0438 \u0442\u0435\u043C\u0443.", false).catch(() => null);
          return;
        }
        const appliedTheme = String(context?.applied_theme ?? "").trim();
        if (appliedTheme && appliedTheme.toLowerCase() === selectedTheme.toLowerCase()) {
          await answerCallback(callbackId, `\u0423\u0436\u0435 \u0432 \u0442\u0435\u043C\u0435: ${selectedTheme}`, false).catch(() => null);
          return;
        }
        await applyDownloadThemeSelection(chatId, session, callbackMessageId, context, selectedTheme);
        await answerCallback(callbackId, `\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u043B \u0432 ${selectedTheme}`, false).catch(
          () => null
        );
        return;
      }

      if (action === "open") {
        const themes = await listDownloadThemeFolders();
        const selectedTheme = String(context?.current_theme ?? session?.selected_download_theme ?? "").trim();
        const appliedTheme = String(context?.applied_theme ?? "").trim();
        const nextContext = {
          ...context,
          themes,
          page: resolveDownloadThemePage(themes, selectedTheme || appliedTheme),
          current_theme: selectedTheme,
          applied_theme: appliedTheme
        };
        rememberDownloadThemeContext(session, callbackMessageId, nextContext);
        await editMessage(
          chatId,
          callbackMessageId,
          buildDownloadThemeMessageText(nextContext.current_theme, nextContext.applied_theme),
          { reply_markup: buildDownloadThemePickerKeyboard(nextContext) }
        ).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "new") {
        const previousRequest = clearDownloadThemeCreateRequest(session);
        if (previousRequest?.prompt_message_id) {
          await deleteMessage(chatId, previousRequest.prompt_message_id).catch(() => null);
        }
        const previousSearch = clearDownloadThemeSearchRequest(session);
        if (previousSearch?.prompt_message_id) {
          await deleteMessage(chatId, previousSearch.prompt_message_id).catch(() => null);
        }
        const prompt = await sendMessage(
          chatId,
          "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0442\u0435\u043C\u044B"
        ).catch(() => null);
        const promptMessageId = Number(prompt?.message_id ?? 0) || null;
        rememberDownloadThemeCreateRequest(session, callbackMessageId, promptMessageId);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "search") {
        const previousSearch = clearDownloadThemeSearchRequest(session);
        if (previousSearch?.prompt_message_id) {
          await deleteMessage(chatId, previousSearch.prompt_message_id).catch(() => null);
        }
        const previousRequest = clearDownloadThemeCreateRequest(session);
        if (previousRequest?.prompt_message_id) {
          await deleteMessage(chatId, previousRequest.prompt_message_id).catch(() => null);
        }
        const prompt = await sendMessage(
          chatId,
          "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0447\u0430\u0441\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F \u0442\u0435\u043C\u044B"
        ).catch(() => null);
        const promptMessageId = Number(prompt?.message_id ?? 0) || null;
        rememberDownloadThemeSearchRequest(session, callbackMessageId, promptMessageId);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "close") {
        const selectedTheme = String(context?.current_theme ?? session?.selected_download_theme ?? "").trim();
        const appliedTheme = String(context?.applied_theme ?? "").trim();
        const nextContext = {
          ...context,
          current_theme: selectedTheme,
          applied_theme: appliedTheme
        };
        rememberDownloadThemeContext(session, callbackMessageId, nextContext);
        await editMessage(chatId, callbackMessageId, buildDownloadThemeMessageText(selectedTheme, appliedTheme), {
          reply_markup: buildDownloadThemeCollapsedKeyboard(selectedTheme, appliedTheme)
        }).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action.startsWith("page:")) {
        const page = Math.max(0, Number.parseInt(action.slice("page:".length), 10) || 0);
        const themes = Array.isArray(context?.themes) && context.themes.length ? context.themes : await listDownloadThemeFolders();
        const nextContext = {
          ...context,
          themes,
          page,
          current_theme: String(context?.current_theme ?? session?.selected_download_theme ?? "").trim(),
          applied_theme: String(context?.applied_theme ?? "").trim()
        };
        rememberDownloadThemeContext(session, callbackMessageId, nextContext);
        await editMessageReplyMarkup(chatId, callbackMessageId, buildDownloadThemePickerKeyboard(nextContext)).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action.startsWith("sel:")) {
        const index = Number.parseInt(action.slice("sel:".length), 10);
        const themes = Array.isArray(context?.themes) && context.themes.length ? context.themes : await listDownloadThemeFolders();
        if (!Number.isInteger(index) || index < 0 || index >= themes.length) {
          await answerCallback(callbackId, "\u0422\u0435\u043C\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.", true).catch(() => null);
          return;
        }
        const selectedTheme = String(themes[index] ?? "").trim();
        if (!selectedTheme) {
          await answerCallback(callbackId, "\u0422\u0435\u043C\u0430 \u043F\u0443\u0441\u0442\u0430\u044F.", true).catch(() => null);
          return;
        }
        await applyDownloadThemeSelection(chatId, session, callbackMessageId, { ...context, themes }, selectedTheme);
        await answerCallback(callbackId, `\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u043B \u0432 ${selectedTheme}`, false).catch(
          () => null
        );
        return;
      }

      await answerCallback(callbackId, "", false).catch(() => null);
    } catch (error) {
      await answerCallback(
        callbackId,
        clipText(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u0442\u0435\u043C\u0443: ${error?.message ?? error}`, CALLBACK_ALERT_MAX),
        true
      ).catch(() => null);
    }
  }

  async function handleDownloadThemeCreateInput(chatId, userId, session, message) {
    const request = getDownloadThemeCreateRequest(session);
    if (!request) return false;
    const text = String(message?.text ?? "").trim();
    if (!text || text.startsWith("/")) return false;
    clearDownloadThemeCreateRequest(session);

    const promptMessageId = Number(request.prompt_message_id ?? 0) || null;
    const controlMessageId = Number(request.control_message_id ?? 0) || null;
    const replyMessageId = Number(message?.message_id ?? 0) || null;
    const cleanupIds = [promptMessageId, replyMessageId].filter(Boolean);

    try {
      const createdTheme = await createDownloadThemeFolder(text);
      session.selected_download_theme = createdTheme;
      const context = getDownloadThemeContext(session, controlMessageId);
      if (context?.relative_path) {
        const themes = await listDownloadThemeFolders();
        const nextContext = {
          ...context,
          themes,
          page: resolveDownloadThemePage(themes, createdTheme),
          current_theme: createdTheme
        };
        rememberDownloadThemeContext(session, controlMessageId, nextContext);
        await editMessage(
          chatId,
          controlMessageId,
          buildDownloadThemeMessageText(nextContext.current_theme, String(nextContext?.applied_theme ?? "").trim()),
          { reply_markup: buildDownloadThemePickerKeyboard(nextContext) }
        ).catch(() => null);
      }
      await syncSessionState(chatId, session, {
        userId,
        mode: String(session?.active_segment_id ? "sdvg" : "download")
      });
      const confirm = await sendMessage(chatId, "\u0422\u0435\u043C\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430").catch(
        () => null
      );
      if (confirm?.message_id) {
        cleanupIds.push(Number(confirm.message_id));
        scheduleMessageDeletion(chatId, confirm.message_id, 1500);
      }
      for (const messageId of cleanupIds) {
        await deleteMessage(chatId, messageId).catch(() => null);
      }
    } catch (error) {
      const failure = await sendMessage(
        chatId,
        `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0442\u0435\u043C\u0443: ${error?.message ?? error}`
      ).catch(() => null);
      if (failure?.message_id) {
        scheduleMessageDeletion(chatId, failure.message_id, 2500);
      }
      for (const messageId of cleanupIds) {
        await deleteMessage(chatId, messageId).catch(() => null);
      }
    }
    return true;
  }

  async function hydratePersistedSessions() {
    if (typeof listBotSessions !== "function") return;
    const storedSessions = await listBotSessions({}).catch(() => []);
    if (!Array.isArray(storedSessions) || storedSessions.length === 0) return;
    const seenChats = new Set();
    for (const stored of storedSessions) {
      const chatId = String(stored?.chat_id ?? "").trim();
      if (!chatId || seenChats.has(chatId)) continue;
      seenChats.add(chatId);
      const session = getSession(chatId);
      touchTelegramSdvgSession(session, stored?.last_seen_at ?? Date.now());
      session.mode = String(stored?.mode ?? "").trim() || session.mode || "inbox";
      const selectedTheme = String(stored?.pending_payload_json?.selected_download_theme ?? "").trim();
      if (selectedTheme) {
        session.selected_download_theme = selectedTheme;
      }
    }
  }

  async function handleDownloadThemeSearchInput(chatId, userId, session, message) {
    const request = getDownloadThemeSearchRequest(session);
    if (!request) return false;
    const text = String(message?.text ?? "").trim();
    if (!text || text.startsWith("/")) return false;
    clearDownloadThemeSearchRequest(session);

    const promptMessageId = Number(request.prompt_message_id ?? 0) || null;
    const controlMessageId = Number(request.control_message_id ?? 0) || null;
    const replyMessageId = Number(message?.message_id ?? 0) || null;
    const cleanupIds = [promptMessageId, replyMessageId].filter(Boolean);

    try {
      const context = getDownloadThemeContext(session, controlMessageId);
      if (context?.relative_path) {
        const themes = filterDownloadThemes(await listDownloadThemeFolders(), text);
        const nextContext = {
          ...context,
          themes,
          page: 0,
          current_theme: String(context?.current_theme ?? session?.selected_download_theme ?? "").trim()
        };
        rememberDownloadThemeContext(session, controlMessageId, nextContext);
        await editMessage(
          chatId,
          controlMessageId,
          buildDownloadThemeMessageText(nextContext.current_theme, String(nextContext?.applied_theme ?? "").trim()),
          { reply_markup: buildDownloadThemePickerKeyboard(nextContext) }
        ).catch(() => null);
      }
      await syncSessionState(chatId, session, {
        userId,
        mode: String(session?.active_segment_id ? "sdvg" : "download")
      });
      for (const messageId of cleanupIds) {
        await deleteMessage(chatId, messageId).catch(() => null);
      }
    } catch {
      for (const messageId of cleanupIds) {
        await deleteMessage(chatId, messageId).catch(() => null);
      }
    }
    return true;
  }

  async function handleMetaCallback(callbackId, callbackMessageId, session, key) {
    const context = getCardContext(session, callbackMessageId);
    if (!context?.doc_id || !context?.segment_id) {
      await answerCallback(callbackId, SDVG_MESSAGES.staleCard, true).catch(() => null);
      return;
    }
    const payload = await readDocPayload(context.doc_id);
    if (!payload) {
      await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
      return;
    }
    const segment = findSdvgDisplaySegment(payload.segments, context.segment_id);
    if (!segment) {
      await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
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

  async function handleSdvgCheerArchiveRequestCallback(chatId, callbackId, callbackMessageId, session) {
    session.sdvg_cheer_muted = true;
    session.sdvg_cheer_next_at = 0;
    const docId = String(session?.doc_id ?? "").trim();
    if (docId) {
      rememberPendingProjectArchiveRequest(session, docId);
    }
    if (String(session.sdvg_encouragement_message_id ?? "") === String(callbackMessageId ?? "")) {
      session.sdvg_encouragement_message_id = null;
    }
    await deleteMessage(chatId, callbackMessageId).catch(() => null);
    await answerCallback(
      callbackId,
      docId ? "Жду следующий файл проекта для архива." : "Бодрящие сообщения отключены.",
      false
    ).catch(() => null);
    if (!docId) {
      await sendMessage(chatId, "✖️ Бодрящие сообщения отключены до следующего /sdvg.").catch(() => null);
      return;
    }
    await sendMessage(
      chatId,
      [
        "📦 Пришли следующим сообщением файл готового проекта для архива.",
        `\uD83D\uDCC2 \u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442: <code>${escapeHtml(docId)}</code>`,
        SDVG_MESSAGES.archiveTarget(escapeHtml(docId))
      ].join("\n"),
      { parse_mode: "HTML" }
    ).catch(() => null);
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
        await answerCallback(callbackId, SDVG_MESSAGES.staleCard, true).catch(() => null);
        return;
      }
      await answerCallback(callbackId, SDVG_MESSAGES.linksSearchInProgress, false).catch(() => null);
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await sendMessage(chatId, SDVG_MESSAGES.documentUnavailable);
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await sendMessage(chatId, SDVG_MESSAGES.segmentNotFound);
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
      const topCandidates = selectResearchCandidatesByCategory(candidates, RESEARCH_SUGGESTION_TOP_LIMIT);
      if (!topCandidates.length) {
        await sendMessage(chatId, `Для ${segment.segment_id} не нашёл новых подходящих ссылок.`);
        return;
      }
      await updateProgress(`🔎 Отправляю ${topCandidates.length} ссыл${topCandidates.length === 1 ? "ку" : topCandidates.length < 5 ? "ки" : "ок"} для: ${topicLabel}`);
      for (let index = 0; index < topCandidates.length; index += 1) {
        const candidate = topCandidates[index];
        const categoryId = String(candidate?.ranked?.category_id ?? "other").trim().toLowerCase();
        const categoryResults = listResearchCandidatesForCategory(candidates, categoryId);
        const categoryIndex = Math.max(
          0,
          categoryResults.findIndex((item) => String(item?.key ?? "").trim() === String(candidate?.key ?? "").trim())
        );
        const sent = await sendMessage(
          chatId,
          buildCategorizedResearchSuggestionText(candidate, index + 1),
          {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: buildResearchSuggestionKeyboard(candidate)
          }
        );
        rememberResearchSuggestionContext(session, sent?.message_id, {
          chat_id: String(chatId),
          doc_id: context.doc_id,
          segment_id: context.segment_id,
          card_message_id: String(callbackMessageId),
          results: candidates,
          current_index: categoryIndex,
          current_key: candidate.key,
          current_category_id: categoryId
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
        await answerCallback(callbackId, SDVG_MESSAGES.staleHint, true).catch(() => null);
        return;
      }
      const payload = await readDocPayload(context.doc_id);
      if (!payload) {
        await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
        return;
      }
      const decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
      const results = Array.isArray(context.results) ? context.results : [];
      const currentIndex = Number.isFinite(Number(context.current_index)) ? Number(context.current_index) : 0;
      const currentCandidate =
        results.find((item) => String(item?.key ?? "").trim() === String(context.current_key ?? "").trim()) ??
        results[currentIndex] ??
        null;

      if (action === "sdvg_rs:drop") {
        const targetUrl = String(currentCandidate?.result?.url ?? "").trim();
        let removedFromRuns = false;
        if (targetUrl) {
          removedFromRuns = await removeResearchSuggestionFromStoredRuns(
            context.doc_id,
            context.segment_id,
            targetUrl
          ).catch(() => false);
          if (!removedFromRuns) {
            await persistDismissedResearchSuggestion(context.doc_id, context.segment_id, currentCandidate).catch(() => false);
          }
        }
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "sdvg_rs:add") {
        const targetUrl = String(currentCandidate?.result?.url ?? "").trim();
        if (!targetUrl) {
          await answerCallback(callbackId, SDVG_MESSAGES.linkExpired, true).catch(() => null);
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
          String(context.current_key ?? "").trim()
        ]);
        const currentCategoryId = String(
          context.current_category_id ?? currentCandidate?.ranked?.category_id ?? ""
        ).trim().toLowerCase();
        const categoryResults = listResearchCandidatesForCategory(results, currentCategoryId, excludedKeys);
        const safeCurrentIndex = Number.isFinite(currentIndex) ? Math.max(0, currentIndex) : 0;
        let nextIndex = categoryResults.length > 0 ? Math.min(safeCurrentIndex, categoryResults.length - 1) : -1;
        let nextCandidate = nextIndex >= 0 ? categoryResults[nextIndex] : null;
        let nextResults = results;
        if (!nextCandidate) {
          nextResults = await fetchSegmentResearchCandidates(context.doc_id, segment, decision, excludedKeys);
          const nextCategoryResults = listResearchCandidatesForCategory(nextResults, currentCategoryId, excludedKeys);
          nextCandidate = nextCategoryResults[0] ?? null;
          nextIndex = Math.max(
            0,
            nextCategoryResults.findIndex((item) => String(item?.key ?? "").trim() === String(nextCandidate?.key ?? "").trim())
          );
        }
        if (!nextCandidate?.result?.url) {
          await editMessage(chatId, callbackMessageId, "В этой категории новых ссылок пока нет.", {
            reply_markup: {
              inline_keyboard: [[
                { text: "\u0418\u0441\u043A\u0430\u0442\u044C \u0435\u0449\u0435", callback_data: "sdvg_rs:refresh" },
                { text: "➖", callback_data: "sdvg_rs:drop" }
              ]]
            }
          }).catch(() => null);
          return;
        }
        rememberResearchSuggestionContext(session, callbackMessageId, {
          ...context,
          results: nextResults,
          current_index: nextIndex,
          current_key: nextCandidate.key,
          current_category_id: String(nextCandidate?.ranked?.category_id ?? currentCategoryId ?? "other").trim().toLowerCase()
        });
        await editMessage(chatId, callbackMessageId, buildCategorizedResearchSuggestionText(nextCandidate), {
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: buildResearchSuggestionKeyboard(nextCandidate)
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
      if (!context) {
        await answerCallback(callbackId, SDVG_MESSAGES.staleHint, true).catch(() => null);
        return;
      }
      const mode = String(context?.mode ?? "segment").trim().toLowerCase();
      const results = Array.isArray(context.results) ? context.results : [];
      const currentIndex = Number.isFinite(Number(context.current_index)) ? Number(context.current_index) : 0;
      const currentCandidate =
        results.find((item) => String(item?.key ?? "").trim() === String(context.current_key ?? "").trim()) ??
        results[currentIndex] ??
        null;
      const currentUrl = String(currentCandidate?.result?.url ?? "").trim();
      const currentKey = String(context?.current_key ?? currentCandidate?.key ?? "").trim();
      const adHocSeenKeys = ensureAdHocResearchSeenSet(session);

      let segment = null;
      let decision = null;
      if (mode !== "adhoc") {
        if (!context?.doc_id || !context?.segment_id) {
          await answerCallback(callbackId, SDVG_MESSAGES.staleHint, true).catch(() => null);
          return;
        }
        const payload = await readDocPayload(context.doc_id);
        if (!payload) {
          await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
          return;
        }
        segment = payload.segments.find((item) => item.segment_id === context.segment_id);
        if (!segment) {
          await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
          return;
        }
        decision = buildDecisionMap(payload.decisions).get(segment.segment_id) ?? null;
      }

      if (action === "sdvg_rs:drop") {
        if (currentKey) adHocSeenKeys.add(currentKey);
        if (currentUrl) {
          const normalizedUrl = canonicalizeBotUrl(currentUrl);
          if (normalizedUrl) adHocSeenKeys.add(normalizedUrl);
        }
        if (mode !== "adhoc" && currentUrl) {
          const removedFromRuns = await removeResearchSuggestionFromStoredRuns(
            context.doc_id,
            context.segment_id,
            currentUrl
          ).catch(() => false);
          if (!removedFromRuns) {
            await persistDismissedResearchSuggestion(context.doc_id, context.segment_id, currentCandidate).catch(() => false);
          }
        }
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        await answerCallback(callbackId, "", false).catch(() => null);
        return;
      }

      if (action === "sdvg_rs:add") {
        if (!currentUrl) {
          await answerCallback(callbackId, SDVG_MESSAGES.linkExpired, true).catch(() => null);
          return;
        }
        if (currentKey) adHocSeenKeys.add(currentKey);
        if (mode === "adhoc") {
          if (!isYtDlpCandidateUrl(currentUrl)) {
            await answerCallback(callbackId, "Открой ссылку кнопкой ниже.", true).catch(() => null);
            return;
          }
          await answerCallback(callbackId, "Скачиваю...", false).catch(() => null);
          await handleInboxUrlInput(
            chatId,
            session,
            {
              text: String(currentCandidate?.result?.title ?? currentUrl).trim(),
              caption: "",
              message_id: null
            },
            currentUrl
          );
        } else {
          await answerCallback(callbackId, "Добавляю...", false).catch(() => null);
          await handleUrlScreenshotPreview(chatId, { ...session, doc_id: context.doc_id }, segment, currentUrl, null, null);
        }
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        return;
      }

      if (action === "sdvg_rs:shot") {
        if (!currentUrl) {
          await answerCallback(callbackId, SDVG_MESSAGES.linkExpired, true).catch(() => null);
          return;
        }
        if (mode !== "adhoc") {
          await answerCallback(callbackId, "Screenshot здесь доступен только для ad-hoc research.", true).catch(() => null);
          return;
        }
        await answerCallback(callbackId, "Делаю screenshot...", false).catch(() => null);
        const saved = await saveAdHocResearchScreenshotToTheme(
          chatId,
          session,
          currentUrl,
          {
            title: String(currentCandidate?.result?.title ?? currentUrl).trim(),
            domain: String(currentCandidate?.result?.domain ?? "").trim(),
            result_id: String(currentCandidate?.result?.id ?? "").trim()
          }
        );
        await sendSavedScreenshotBackToChat(chatId, saved, {
          url: currentUrl,
          metadata: currentCandidate?.result ?? {},
          profile: saved.profile
        }).catch(() => null);
        if (currentKey) adHocSeenKeys.add(currentKey);
        forgetResearchSuggestionContext(session, callbackMessageId);
        await deleteMessage(chatId, callbackMessageId).catch(() => null);
        return;
      }

      if (action === "sdvg_rs:refresh") {
        await answerCallback(callbackId, "Обновляю...", false).catch(() => null);
        const excludedKeys = new Set([
          ...collectCurrentResearchSuggestionKeys(session, context.card_message_id, callbackMessageId),
          ...adHocSeenKeys,
          currentKey
        ]);
        const currentCategoryId = String(
          context.current_category_id ?? currentCandidate?.ranked?.category_id ?? ""
        ).trim().toLowerCase();
        const categoryResults = listResearchCandidatesForCategory(results, currentCategoryId, excludedKeys);
        const safeCurrentIndex = Number.isFinite(currentIndex) ? Math.max(0, currentIndex) : 0;
        let nextIndex = categoryResults.length > 0 ? Math.min(safeCurrentIndex, categoryResults.length - 1) : -1;
        let nextCandidate = nextIndex >= 0 ? categoryResults[nextIndex] : null;
        let nextResults = results;
        if (!nextCandidate) {
          nextResults =
            mode === "adhoc"
              ? await fetchAdHocResearchCandidates(context.query, context.theme_label, excludedKeys)
              : await fetchSegmentResearchCandidates(context.doc_id, segment, decision, excludedKeys);
          const nextCategoryResults = listResearchCandidatesForCategory(nextResults, currentCategoryId, excludedKeys);
          nextCandidate = nextCategoryResults[0] ?? null;
          nextIndex = Math.max(
            0,
            nextCategoryResults.findIndex((item) => String(item?.key ?? "").trim() === String(nextCandidate?.key ?? "").trim())
          );
        }
        if (!nextCandidate?.result?.url) {
          await editMessage(chatId, callbackMessageId, "В этой категории новых ссылок пока нет.", {
            reply_markup: {
              inline_keyboard: [[
                { text: "🔄 Ещё", callback_data: "sdvg_rs:refresh" },
                { text: "✖️", callback_data: "sdvg_rs:drop" }
              ]]
            }
          }).catch(() => null);
          return;
        }
        rememberResearchSuggestionContext(session, callbackMessageId, {
          ...context,
          results: nextResults,
          current_index: nextIndex,
          current_key: nextCandidate.key,
          current_category_id: String(nextCandidate?.ranked?.category_id ?? currentCategoryId ?? "other").trim().toLowerCase()
        });
        await editMessage(chatId, callbackMessageId, buildCategorizedResearchSuggestionText(nextCandidate), {
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: buildResearchSuggestionKeyboard(nextCandidate, { mode })
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
        await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
        return;
      }
      const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
      if (!segment) {
        await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
        return;
      }

      if (action === "sdvg_shot:format" || action === "sdvg_shot:taller" || action === "sdvg_shot:zoom_in" || action === "sdvg_shot:zoom_out") {
        const nextProfile =
          action === "sdvg_shot:format"
            ? cycleScreenshotFormat(context.profile)
            : action === "sdvg_shot:taller"
              ? extendScreenshotHeight(context.profile, 640)
            : action === "sdvg_shot:zoom_in"
              ? shiftScreenshotZoom(context.profile, 50)
              : shiftScreenshotZoom(context.profile, -50);
        if (screenshotProfileKey(nextProfile) === screenshotProfileKey(context.profile)) {
          const alertText =
            action === "sdvg_shot:taller"
              ? "Скриншот уже максимально высокий."
              : action === "sdvg_shot:zoom_in"
              ? "Масштаб уже максимальный."
              : action === "sdvg_shot:zoom_out"
                ? "Масштаб уже минимальный."
                : "\u0424\u043E\u0440\u043C\u0430\u0442 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D.";
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
        await answerCallback(callbackId, SDVG_MESSAGES.staleCard, true).catch(() => null);
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
          await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
          return;
        }
        const segment = payload.segments.find((item) => item.segment_id === context.segment_id);
        if (!segment) {
          await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
          return;
        }
        const files = await collectDownloadedFilesForPicker(context.doc_id, segment);
        if (files.length === 0) {
          await answerCallback(callbackId, SDVG_MESSAGES.noDownloadedFiles, true).catch(() => null);
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
        await answerCallback(callbackId, SDVG_MESSAGES.fileCount(files.length), false).catch(() => null);
        return;
      }

      if (data.startsWith("sdvg_pick:page:")) {
        const picker = getFilePickerContext(session, callbackMessageId);
        if (!picker) {
          await answerCallback(callbackId, SDVG_MESSAGES.staleList, true).catch(() => null);
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
          await answerCallback(callbackId, SDVG_MESSAGES.staleList, true).catch(() => null);
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
        await sendMessage(chatId, `📎 Добавил файл в ${context.segment_id}: ${path.basename(picked.path)}`).catch(
          () => null
        );
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

  async function handleTelegramMediaBatchRetryCallback(chatId, callbackId, session, data) {
    const batchId = compactText(String(data ?? "").slice("sdvg_batch:retry:".length));
    if (!batchId) {
      await answerCallback(callbackId, "", false).catch(() => null);
      return;
    }
    const batch = getTelegramMediaBatchAudit(session, batchId);
    if (!batch) {
      await answerCallback(callbackId, "Batch уже недоступен.", true).catch(() => null);
      return;
    }
    const failedItems = Array.isArray(batch.failed_items) ? batch.failed_items : [];
    if (failedItems.length === 0) {
      await answerCallback(callbackId, "Ошибок для retry нет.", false).catch(() => null);
      return;
    }
    const docId = String(batch.doc_id ?? "").trim();
    const segmentId = String(batch.segment_id ?? "").trim();
    if (!docId || !segmentId) {
      await answerCallback(callbackId, "Batch потерял контекст документа.", true).catch(() => null);
      return;
    }
    const payload = await readDocPayload(docId);
    if (!payload) {
      await answerCallback(callbackId, SDVG_MESSAGES.documentUnavailable, true).catch(() => null);
      return;
    }
    const segment = findSdvgDisplaySegment(payload.segments, segmentId);
    if (!segment) {
      await answerCallback(callbackId, SDVG_MESSAGES.segmentNotFound, true).catch(() => null);
      return;
    }
    await answerCallback(callbackId, "Повторяю недокачанные файлы...", false).catch(() => null);
    await handleTelegramMediaInput(
      chatId,
      session,
      segment,
      failedItems.map((item) => ({
        fileId: item.file_id,
        fileUniqueId: item.file_unique_id,
        fileName: item.file_name,
        mimeType: item.mime_type,
        kind: item.kind
      })),
      batch.source_message_id,
      {
        batchId,
        retryOnly: true,
        statusMessageId: batch.status_message_id
      }
    );
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
    if (data.startsWith("sdvg_theme:")) {
      await handleDownloadThemeCallback(chatId, callbackId, messageId, session, data);
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
    if (data.startsWith("sdvg_batch:retry:")) {
      await handleTelegramMediaBatchRetryCallback(chatId, callbackId, session, data);
      return;
    }
    if (data === "sdvg_cheer:mute") {
      await handleSdvgCheerArchiveRequestCallback(chatId, callbackId, messageId, session);
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
    const match = value.match(/^\/(?:sdvg|сдвг|сдвнг)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
    if (!match) return null;
    const rawArgs = String(match[1] ?? "").trim();
    const tokens = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    let docId = "";
    let randomMode = null;
    tokens.forEach((token) => {
      const normalized = token.toLowerCase();
      if (["random", "rnd", "rand", "mix", "\u0441\u043B\u0443\u0447\u0430\u0439\u043D\u043E", "\u0440\u0430\u043D\u0434\u043E\u043C"].includes(normalized)) {
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

  function parseResearchCommand(text) {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const match = value.match(/^\/research(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
    if (!match) return null;
    return {
      query: compactText(match[1] ?? "")
    };
  }

  function parseNotionCommand(text) {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const match = value.match(/^\/notion(?:@[a-z0-9_]+)?$/i);
    return match ? {} : null;
  }

  function isNotionOnlyCommandMessage(update) {
    const text = String(update?.message?.text ?? "").trim();
    return Boolean(parseNotionCommand(text));
  }

  function parseThreadInfoCommand(text) {
    const value = String(text ?? "").trim();
    if (!value) return null;
    const match = value.match(/^\/(?:threadid|topicid)(?:@[a-z0-9_]+)?$/i);
    return match ? {} : null;
  }

  function scheduleMessageDeletion(chatId, messageId, delayMs = 3 * 60 * 1000) {
    const normalizedMessageId = Number(messageId);
    if (!chatId || !Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
    const timeout = setTimeout(() => {
      void deleteMessage(chatId, normalizedMessageId).catch(() => null);
    }, Math.max(1000, Number(delayMs) || 0));
    if (typeof timeout?.unref === "function") timeout.unref();
  }

  function countNonEmptyLines(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean).length;
  }

  function formatSignedDelta(value) {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric === 0) return "0";
    return numeric > 0 ? `+${numeric}` : String(numeric);
  }

  async function fetchLocalBackendJson(url, init = {}, timeoutMs = 120000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal
      });
      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      return { response, data, raw };
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildNotionRefreshSummary({
    docId,
    previousText,
    nextText,
    updatedDocument = null,
    notionUrl = "",
    progressMessage = ""
  }) {
    const previous = String(previousText ?? "");
    const next = String(nextText ?? "");
    const previousChars = previous.length;
    const nextChars = next.length;
    const previousLines = countNonEmptyLines(previous);
    const nextLines = countNonEmptyLines(next);
    const hasNextText = Boolean(next.trim());
    const changed = next !== previous;
    const needsSegmentation = Boolean(updatedDocument?.needs_segmentation);
    let statusLine = SDVG_MESSAGES.notionStatusUnchanged;
    if (!hasNextText) {
      statusLine = SDVG_MESSAGES.notionStatusEmpty;
    } else if (changed) {
      statusLine = SDVG_MESSAGES.notionStatusUpdated;
    }
    const lines = [
      SDVG_MESSAGES.notionUpdateTitle,
      SDVG_MESSAGES.notionDocumentLine(docId),
      statusLine,
      `Строки: ${previousLines} → ${nextLines} (${formatSignedDelta(nextLines - previousLines)})`,
      `Символы: ${previousChars} → ${nextChars} (${formatSignedDelta(nextChars - previousChars)})`
    ];
    if (notionUrl) lines.push(`Notion: ${notionUrl}`);
    if (hasNextText && needsSegmentation) {
      lines.push("⚠️ Текст обновился. Проверьте сегменты.");
    }
    const trailing = String(progressMessage ?? "").trim();
    if (trailing && trailing.toUpperCase() !== "DONE") {
      lines.push(SDVG_MESSAGES.notionStageLine(trailing));
    }
    return lines.join("\n");
  }

  async function handleNotionCommand(chatId, userId, sourceMessageId = null) {
    const session = getSession(chatId);
    if (sourceMessageId) {
      scheduleMessageDeletion(chatId, sourceMessageId);
    }
    const docId = String(session?.doc_id ?? defaultDocId ?? "").trim();
    if (!docId) {
      await sendMessage(chatId, "Нет активного документа. Сначала открой его через /sdvg.");
      return;
    }
    const payload = await readDocPayload(docId);
    if (!payload?.document) {
      await sendMessage(chatId, `Документ "${docId}" не найден или недоступен.`);
      return;
    }
    const notionUrl = String(payload.document?.notion_url ?? "").trim();
    if (!notionUrl) {
      await sendMessage(chatId, "У текущего документа нет Notion-ссылки. Привяжите её в VBAUT и попробуйте снова.");
      return;
    }

    const progressId = `tg_notion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const statusMessage = await sendMessage(chatId, `📝 Обновляю из Notion для ${docId}...`).catch(() => null);
    const statusMessageId = Number(statusMessage?.message_id ?? 0) || null;
    let progressStopped = false;
    let lastProgressMessage = "";
    let progressTimer = null;
    const stopProgressPolling = () => {
      progressStopped = true;
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };
    const pollProgress = async () => {
      if (progressStopped || !statusMessageId) return;
      try {
        const { response, data } = await fetchLocalBackendJson(
          `${getLocalBackendOrigin()}/api/notion/progress/${encodeURIComponent(progressId)}`,
          {},
          15000
        );
        if (response.status === 404) {
          stopProgressPolling();
          return;
        }
        if (!response.ok) return;
        const nextMessage = String(data?.last_message ?? "").trim();
        if (!nextMessage || nextMessage === lastProgressMessage) {
          if (data?.done) {
            stopProgressPolling();
          }
          return;
        }
        lastProgressMessage = nextMessage;
        if (data?.done) {
          stopProgressPolling();
        }
        await editMessage(chatId, statusMessageId, `📝 ${nextMessage}`).catch(() => null);
      } catch {
        return;
      }
    };
    progressTimer = setInterval(() => {
      void pollProgress();
    }, 1200);
    void pollProgress();

    try {
      const previousText = String(payload.document?.raw_text ?? "");
      const notionResponse = await fetchLocalBackendJson(
        `${getLocalBackendOrigin()}/api/notion/raw`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: notionUrl,
            progress_id: progressId
          })
        },
        180000
      );
      if (!notionResponse.response.ok) {
        throw new Error(notionResponse.data?.error ?? "Ошибка загрузки Notion");
      }
      stopProgressPolling();

      const normalizedUrl = String(notionResponse.data?.url ?? notionUrl).trim() || notionUrl;
      const content = typeof notionResponse.data?.content === "string" ? notionResponse.data.content : "";
      const hasContent = Boolean(content.trim());
      let updatedDocument = payload.document;

      if (hasContent) {
        const updateResponse = await fetchLocalBackendJson(
          `${getLocalBackendOrigin()}/api/documents/${encodeURIComponent(docId)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              raw_text: content,
              notion_url: normalizedUrl
            })
          },
          120000
        );
        if (!updateResponse.response.ok) {
          throw new Error(updateResponse.data?.error ?? "Не удалось обновить документ из Notion");
        }
        updatedDocument = updateResponse.data?.document ?? updatedDocument;
      } else if (normalizedUrl !== notionUrl) {
        const updateResponse = await fetchLocalBackendJson(
          `${getLocalBackendOrigin()}/api/documents/${encodeURIComponent(docId)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              notion_url: normalizedUrl
            })
          },
          120000
        );
        if (updateResponse.response.ok) {
          updatedDocument = updateResponse.data?.document ?? updatedDocument;
        }
      }

      const summaryText = buildNotionRefreshSummary({
        docId,
        previousText,
        nextText: hasContent ? content : previousText,
        updatedDocument,
        notionUrl: normalizedUrl,
        progressMessage: lastProgressMessage
      });
      if (statusMessageId) {
        await editMessage(chatId, statusMessageId, summaryText).catch(async () => {
          const sent = await sendMessage(chatId, summaryText).catch(() => null);
          if (sent?.message_id) scheduleMessageDeletion(chatId, sent.message_id);
        });
        scheduleMessageDeletion(chatId, statusMessageId);
      } else {
        const sent = await sendMessage(chatId, summaryText).catch(() => null);
        if (sent?.message_id) scheduleMessageDeletion(chatId, sent.message_id);
      }
    } catch (error) {
      progressStopped = true;
      clearInterval(progressTimer);
      const errorText = SDVG_MESSAGES.notionUpdateFailed(docId, error?.message ?? error);
      if (statusMessageId) {
        await editMessage(chatId, statusMessageId, errorText).catch(async () => {
          const sent = await sendMessage(chatId, errorText).catch(() => null);
          if (sent?.message_id) scheduleMessageDeletion(chatId, sent.message_id);
        });
        scheduleMessageDeletion(chatId, statusMessageId);
      } else {
        const sent = await sendMessage(chatId, errorText).catch(() => null);
        if (sent?.message_id) scheduleMessageDeletion(chatId, sent.message_id);
      }
    } finally {
      stopProgressPolling();
      await syncSessionState(chatId, session, {
        userId,
        mode: String(session?.active_segment_id ? "sdvg" : "inbox")
      });
    }
  }

  async function handleDownloadCommand(chatId, userId) {
    const session = getSession(chatId);
    const pendingThemePrompt = clearDownloadThemeCreateRequest(session);
    if (pendingThemePrompt?.prompt_message_id) {
      await deleteMessage(chatId, pendingThemePrompt.prompt_message_id).catch(() => null);
    }
    const pendingThemeSearch = clearDownloadThemeSearchRequest(session);
    if (pendingThemeSearch?.prompt_message_id) {
      await deleteMessage(chatId, pendingThemeSearch.prompt_message_id).catch(() => null);
    }
    session.active_segment_id = null;
    session.sdvg_cheer_muted = false;
    session.sdvg_cheer_next_at = 0;
    clearTelegramSdvgSessionEphemeralState(session);
    await clearSdvgEncouragementMessage(chatId, session);
    await syncSessionState(chatId, session, {
      userId,
      mode: "download",
      activeDocumentId: session?.doc_id,
      activeSegmentId: ""
    });
    await sendMessage(chatId, SDVG_MESSAGES.downloadModeEnabled);
  }

  async function handleAdHocResearchCommand(chatId, userId, rawQuery = "") {
    const session = getSession(chatId);
    const pendingThemePrompt = clearDownloadThemeCreateRequest(session);
    if (pendingThemePrompt?.prompt_message_id) {
      await deleteMessage(chatId, pendingThemePrompt.prompt_message_id).catch(() => null);
    }
    const pendingThemeSearch = clearDownloadThemeSearchRequest(session);
    if (pendingThemeSearch?.prompt_message_id) {
      await deleteMessage(chatId, pendingThemeSearch.prompt_message_id).catch(() => null);
    }
    const explicitQuery = compactText(rawQuery);
    const themeLabel = compactText(session?.selected_download_theme);
    const query = explicitQuery || themeLabel;
    if (!query) {
      await sendMessage(
        chatId,
        "Пришли `/research запрос` или сначала выбери тему. Если тема уже выбрана, `/research` возьмёт её как поисковый запрос.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const runCardId = `adhoc:${chatId}:${Date.now().toString(36)}:${createPickerToken()}`;
    resetAdHocResearchState(session, query, runCardId);
    await syncSessionState(chatId, session, {
      userId,
      mode: String(session?.active_segment_id ? "sdvg" : session?.mode === "download" ? "download" : "inbox")
    });

    const statusLabel = explicitQuery ? `Ищу: ${query}` : `Ищу по теме: ${query}`;
    const statusMessage = await sendMessage(chatId, statusLabel).catch(() => null);
    const statusMessageId = Number(statusMessage?.message_id ?? 0) || null;
    if (statusMessageId) {
      rememberResearchStatusMessage(session, runCardId, statusMessageId);
    }

    let lastProgressText = "";
    let lastProgressAt = 0;
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

    try {
      const seenKeys = ensureAdHocResearchSeenSet(session);
      const candidates = await fetchAdHocResearchCandidates(query, themeLabel, seenKeys, updateProgress);
      const topCandidates = selectResearchCandidatesByCategory(candidates, RESEARCH_SUGGESTION_TOP_LIMIT);
      if (!topCandidates.length) {
        if (statusMessageId) {
          await editMessage(chatId, statusMessageId, `По запросу «${query}» новых ссылок пока не нашёл.`).catch(() => null);
          scheduleMessageDeletion(chatId, statusMessageId);
        } else {
          await sendMessage(chatId, `По запросу «${query}» новых ссылок пока не нашёл.`);
        }
        return;
      }
      if (statusMessageId) {
        await editMessage(chatId, statusMessageId, `Нашёл ${topCandidates.length} результатов: ${query}`).catch(() => null);
        scheduleMessageDeletion(chatId, statusMessageId);
      }
      for (let index = 0; index < topCandidates.length; index += 1) {
        const candidate = topCandidates[index];
        const categoryId = String(candidate?.ranked?.category_id ?? "other").trim().toLowerCase();
        const categoryResults = listResearchCandidatesForCategory(candidates, categoryId);
        const categoryIndex = Math.max(
          0,
          categoryResults.findIndex((item) => String(item?.key ?? "").trim() === String(candidate?.key ?? "").trim())
        );
        const sent = await sendMessage(
          chatId,
          buildCategorizedResearchSuggestionText(candidate, index + 1),
          {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: buildResearchSuggestionKeyboard(candidate, { mode: "adhoc" })
          }
        );
        rememberResearchSuggestionContext(session, sent?.message_id, {
          mode: "adhoc",
          chat_id: String(chatId),
          query,
          theme_label: themeLabel,
          card_message_id: runCardId,
          results: candidates,
          current_index: categoryIndex,
          current_key: candidate.key,
          current_category_id: categoryId
        });
      }
    } catch (error) {
      const text = `Не удалось выполнить research: ${error?.message ?? error}`;
      if (statusMessageId) {
        await editMessage(chatId, statusMessageId, text).catch(() => null);
        scheduleMessageDeletion(chatId, statusMessageId);
      } else {
        await sendMessage(chatId, text).catch(() => null);
      }
    }
  }

  async function handleIncomingMessage(update) {
    const message = update?.message;
    const chatId = message?.chat?.id;
    const userId = message?.from?.id;
    if (!message || !chatId) return;
    const text = String(message?.text ?? "").trim();
    if (text.startsWith("/")) {
      console.log(
        `[telegram-sdvg] command chat=${String(chatId)} thread=${String(message?.message_thread_id ?? "none")} user=${String(
          userId ?? ""
        )} text=${JSON.stringify(text)}`
      );
    }
    if (parseThreadInfoCommand(text)) {
      const threadId = message?.message_thread_id ?? null;
      await sendMessage(
        chatId,
        [
          `chat_id: ${String(chatId)}`,
          `thread_id: ${threadId == null ? "none" : String(threadId)}`,
          `ignore_key: ${threadId == null ? "n/a" : `${String(chatId)}:${String(threadId)}`}`
        ].join("\n")
      );
      return;
    }
    if (/^\/start(?:@[a-z0-9_]+)?$/i.test(text)) {
      await sendMessage(chatId, buildSdvgHelpText());
      return;
    }

    const command = parseSdvgCommand(text);
    if (command) {
      const commandSession = getSession(chatId);
      const pendingThemePrompt = clearDownloadThemeCreateRequest(commandSession);
      if (pendingThemePrompt?.prompt_message_id) {
        await deleteMessage(chatId, pendingThemePrompt.prompt_message_id).catch(() => null);
      }
      const pendingThemeSearch = clearDownloadThemeSearchRequest(commandSession);
      if (pendingThemeSearch?.prompt_message_id) {
        await deleteMessage(chatId, pendingThemeSearch.prompt_message_id).catch(() => null);
      }
      await syncSessionState(chatId, commandSession, {
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

    const researchCommand = parseResearchCommand(text);
    if (researchCommand) {
      await handleAdHocResearchCommand(chatId, userId, researchCommand.query);
      return;
    }

    if (parseNotionCommand(text)) {
      const notionSession = getSession(chatId);
      const pendingThemePrompt = clearDownloadThemeCreateRequest(notionSession);
      if (pendingThemePrompt?.prompt_message_id) {
        await deleteMessage(chatId, pendingThemePrompt.prompt_message_id).catch(() => null);
      }
      const pendingThemeSearch = clearDownloadThemeSearchRequest(notionSession);
      if (pendingThemeSearch?.prompt_message_id) {
        await deleteMessage(chatId, pendingThemeSearch.prompt_message_id).catch(() => null);
      }
      await handleNotionCommand(chatId, userId, Number(message?.message_id ?? 0) || null);
      return;
    }

    const session = getSession(chatId);
    if (await handleDownloadThemeSearchInput(chatId, userId, session, message)) {
      return;
    }
    if (await handleDownloadThemeCreateInput(chatId, userId, session, message)) {
      return;
    }
    const mediaItems = collectMessageMediaItems(message);
    const pendingProjectArchive = getPendingProjectArchiveRequest(session);
    if (pendingProjectArchive && mediaItems.length > 0) {
      await handleProjectArchiveUpload(chatId, session, mediaItems);
      return;
    }
    if (session?.mode === "download") {
      if (mediaItems.length > 0) {
        if (queuePendingInboxMediaGroup(chatId, userId, session, message, mediaItems)) {
          return;
        }
        const created = await createInboxAssetsFromMessage(chatId, session, message, mediaItems);
        await syncSessionState(chatId, session, {
          userId,
          mode: "download",
          activeDocumentId: session?.doc_id,
          activeSegmentId: ""
        });
        await sendInboxSavedSummaryAndThemePicker(chatId, session, created, { autoMode: false });
        return;
      }
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
    const urls = extractUrls(messageText);
    if (!active) {
      session.active_segment_id = null;
      session.sdvg_cheer_muted = false;
      session.sdvg_cheer_next_at = 0;
      clearTelegramSdvgSessionEphemeralState(session);
      await clearSdvgEncouragementMessage(chatId, session);
      session.mode = "download";
      if (mediaItems.length > 0 && queuePendingInboxMediaGroup(chatId, userId, session, message, mediaItems)) {
        return;
      }
      const created = await createInboxAssetsFromMessage(chatId, session, message, mediaItems);
      await syncSessionState(chatId, session, {
        userId,
        mode: "download",
        activeDocumentId: session?.doc_id,
        activeSegmentId: ""
      });
      const supportedInboxUrl =
        mediaItems.length === 0 ? urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null : null;
      if (supportedInboxUrl) {
        await handleInboxUrlInput(chatId, session, message, supportedInboxUrl);
        return;
      }
      if ((mediaItems.length > 0 || urls.length > 0 || (text && !text.startsWith("/"))) && created.length > 0) {
        await sendInboxSavedSummaryAndThemePicker(chatId, session, created, { autoMode: true });
        return;
      }
      if (text && !text.startsWith("/")) {
        await sendMessage(chatId, SDVG_MESSAGES.downloadModeAuto);
        return;
      }
      if ((mediaItems.length > 0 || urls.length > 0 || (text && !text.startsWith("/"))) && created.length > 0) {
        await sendMessage(chatId, `Нет активного сегмента. Сохранил в Inbox: ${created.length}. Запусти /sdvg, чтобы привязать к сегменту.`);
        return;
      }
      if (text && !text.startsWith("/")) {
        await sendMessage(chatId, SDVG_MESSAGES.noActiveSegmentRunSdvg);
      }
      return;
    }
    const resolvedTarget = await resolveSdvgTargetFromIncomingMessage(session, message, active);
    if (resolvedTarget?.staleCard) {
      await sendMessage(
        chatId,
        resolvedTarget.staleReason === "segment_changed"
          ? "Карточка устарела после обновления сценария. Этот segment_id уже указывает на другой текст. Запусти /sdvg заново и отправь файл ответом на свежую карточку."
          : "Карточка больше не соответствует текущему сценарию. Запусти /sdvg заново и отправь файл ответом на свежую карточку."
      );
      return;
    }
    const currentTarget = resolvedTarget?.segment ? resolvedTarget : active;
    const { segment } = currentTarget;
    if (currentTarget?.docId) {
      session.doc_id = String(currentTarget.docId);
    }
    await syncSessionState(chatId, session, {
      userId,
      mode: "sdvg",
      activeDocumentId: session?.doc_id,
      activeSegmentId: segment?.segment_id
    });
    if (mediaItems.length > 0) {
      if (queuePendingSdvgMediaGroup(chatId, session, segment, message, mediaItems)) {
        return;
      }
      await handleTelegramMediaInput(chatId, session, segment, mediaItems, message?.message_id);
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
    if (isIgnoredThreadUpdate(update) && !isTelegramSdvgControlUpdate(update)) {
      const context = extractUpdateThreadContext(update);
      console.log(
        `[telegram-sdvg] ignored update chat=${context?.chatId ?? "unknown"} thread=${context?.threadId ?? "unknown"}`
      );
      return;
    }
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
      await hydratePersistedSessions();
      await reconcileStaleUnsortedAssetRegistry("startup");
      runSessionCleanup("startup");
      if (dropPendingUpdatesOnStart) {
        await telegramApiCall("deleteWebhook", { drop_pending_updates: true }, 15000).catch((error) => {
          console.warn(`[telegram-sdvg] Failed to drop pending updates on start: ${error?.message ?? error}`);
          return null;
        });
      }
      const me = await telegramApiCall("getMe", {}, 15000);
      state.botUsername = String(me?.username ?? "").trim() || null;
      console.log(`[telegram-sdvg] Bot connected${state.botUsername ? ` as @${state.botUsername}` : ""}`);
    } catch (error) {
      console.error(`[telegram-sdvg] Failed to initialize bot: ${error?.message ?? error}`);
      stop();
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
        console.log(`[telegram-sdvg] received updates=${updates.length}`);
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
      drop_pending_updates_on_start: dropPendingUpdatesOnStart,
      session_count: state.sessions.size,
      telegram_media_batch_count: Array.from(state.sessions.values()).reduce(
        (sum, session) => sum + (session?.telegram_media_batches instanceof Map ? session.telegram_media_batches.size : 0),
        0
      ),
      session_ttl_ms: sessionTtlMs,
      session_cleanup_interval_ms: sessionCleanupIntervalMs,
      ignored_thread_keys_count: ignoredThreadKeys.size,
      ignored_thread_keys: Array.from(ignoredThreadKeys.values()),
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
    state.sessionCleanupTimer = setInterval(() => {
      runSessionCleanup("interval");
    }, sessionCleanupIntervalMs);
    if (typeof state.sessionCleanupTimer?.unref === "function") state.sessionCleanupTimer.unref();
    void pollLoop();
    return true;
  }

  function stop() {
    state.running = false;
    if (state.sessionCleanupTimer) {
      clearInterval(state.sessionCleanupTimer);
      state.sessionCleanupTimer = null;
    }
    runSessionCleanup("stop");
  }

  return {
    getRuntimeInfo,
    start,
    stop
  };
}

