import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
} from "./normalizers.js";

const TELEGRAM_MESSAGE_MAX = 4096;
const CALLBACK_ALERT_MAX = 190;
const CARD_CONTEXT_MAX = 80;
const JOB_WATCH_INTERVAL_MS = 1600;
const POLL_RETRY_DELAY_MS = 2500;
const DOWNLOAD_TRACK_TIMEOUT_MS = 30 * 60 * 1000;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

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

export function createTelegramSdvgBotService(deps) {
  const {
    appendEvent,
    ensureMediaDir,
    getDocDir,
    getMediaDir,
    isHttpUrl,
    isYtDlpCandidateUrl,
    listDocuments,
    mediaDownloader,
    readOptionalJson,
    sanitizeMediaTopicName,
    saveVersioned
  } = deps;

  const token = String(
    process.env.TELEGRAM_BOT_TOKEN ?? "7686518888:AAGf1HwSavQS7lsMvzbXq-1Ti7vZ-aNes5U"
  ).trim();
  const enabled = String(process.env.TELEGRAM_SDVG_ENABLED ?? "1") !== "0";
  const defaultDocId = String(process.env.TELEGRAM_SDVG_DOC_ID ?? "").trim();
  const pollTimeoutSecRaw = Number(process.env.TELEGRAM_SDVG_POLL_TIMEOUT_SEC ?? 25);
  const pollTimeoutSec = Number.isFinite(pollTimeoutSecRaw) ? Math.max(5, Math.min(50, pollTimeoutSecRaw)) : 25;
  const apiBase = token ? `https://api.telegram.org/bot${token}` : "";
  const fileApiBase = token ? `https://api.telegram.org/file/bot${token}` : "";

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
        card_contexts: new Map()
      });
    }
    return state.sessions.get(key);
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
    if (context) return context;
    if (!session.doc_id || !session.active_segment_id) return null;
    return {
      doc_id: session.doc_id,
      segment_id: session.active_segment_id
    };
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

  function buildCardKeyboard(segment, decision, session) {
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    const metaButtons = [];
    if (resolveComment(segment, decision)) {
      metaButtons.push({ text: "Комментарий", callback_data: "sdvg_meta:comment" });
    }
    if (visual.format_hint) {
      metaButtons.push({ text: `Формат: ${clipText(visual.format_hint, 20)}`, callback_data: "sdvg_meta:format" });
    }
    if (visual.priority) {
      metaButtons.push({
        text: `Приоритет: ${clipText(visual.priority, 20)}`,
        callback_data: "sdvg_meta:priority"
      });
    }
    const sectionTitle = String(segment?.section_title ?? "").trim();
    metaButtons.push({
      text: clipText(sectionTitle || "Без темы", 28),
      callback_data: "sdvg_meta:section"
    });

    const rows = chunkButtons(metaButtons, 2);
    rows.push([
      {
        text: session?.random_mode ? "🎲" : "📚",
        callback_data: "sdvg_mode:toggle"
      },
      { text: "⏭️", callback_data: "sdvg_next" }
    ]);
    return { inline_keyboard: rows };
  }

  async function sendSegmentCard(chatId, docId, segmentId) {
    const payload = await readDocPayload(docId);
    if (!payload) {
      await sendMessage(chatId, `Документ "${docId}" не найден.`);
      return null;
    }
    const segment = payload.segments.find((item) => String(item?.segment_id ?? "") === String(segmentId));
    if (!segment) {
      await sendMessage(chatId, `Сегмент "${segmentId}" не найден.`);
      return null;
    }
    const decisionMap = buildDecisionMap(payload.decisions);
    const decision = decisionMap.get(segment.segment_id) ?? null;
    const quote = clipText(String(segment.text_quote ?? "").trim() || "Пустая цитата", TELEGRAM_MESSAGE_MAX - 32);
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

  async function appendSegmentMediaPaths(docId, segmentId, mediaPaths = [], chatId, source = "telegram_upload") {
    const incomingPaths = Array.isArray(mediaPaths) ? mediaPaths.map(normalizeRelativeMediaPath).filter(Boolean) : [];
    if (incomingPaths.length === 0) return null;

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
      const firstVideoPath = mergedVisual.media_file_paths.find((item) => isVideoFilePath(item)) ?? null;
      const mergedTimecodes = firstVideoPath ? mergedVisual.media_file_timecodes : {};
      const nextDecision = {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput({
          ...mergedVisual,
          media_file_timecodes: mergedTimecodes,
          media_start_timecode: firstVideoPath ? mergedVisual.media_file_timecodes[firstVideoPath] ?? null : null
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
          decisions_version: version
        }
      }).catch(() => null);
      return {
        version,
        decision: normalized.find((item) => item.segment_id === segmentId) ?? nextDecision
      };
    });
  }

  async function downloadTelegramFileToTopic(fileId, sectionTitle, preferredName) {
    const fileResult = await telegramApiCall("getFile", { file_id: fileId });
    const filePath = String(fileResult?.file_path ?? "").trim();
    if (!filePath) {
      throw new Error("Telegram did not return file_path");
    }
    const topic = sanitizeMediaTopicName(sectionTitle);
    const outputDir = await ensureMediaDir(topic);
    const sourceName = preferredName || path.basename(filePath);
    const safeName = sanitizeFileName(sourceName, "telegram_file");
    const targetPath = await ensureUniqueFilePath(outputDir, safeName);
    const encodedPath = filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const response = await fetch(`${fileApiBase}/${encodedPath}`);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Telegram file (${response.status})`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
    const mediaRoot = path.resolve(getMediaDir());
    const relativePath = path.relative(mediaRoot, targetPath).split(path.sep).join("/");
    return normalizeRelativeMediaPath(relativePath);
  }

  function formatJobStatusMessage(segmentId, url, job) {
    const status = String(job?.status ?? "queued");
    const progress = String(job?.progress ?? "").trim();
    const progressLine = progress ? `Прогресс: ${progress}` : "Прогресс: ...";
    const errorLine = job?.error ? `Ошибка: ${job.error}` : "";
    const lines = [`Сегмент: ${segmentId}`, `URL: ${url}`, `Статус: ${status}`, progressLine];
    if (errorLine) lines.push(errorLine);
    return lines.join("\n");
  }

  async function trackDownloadJobAndAttach({
    chatId,
    statusMessageId,
    docId,
    segmentId,
    sectionTitle,
    url,
    jobId
  }) {
    const startedAt = Date.now();
    let lastRendered = "";
    while (Date.now() - startedAt <= DOWNLOAD_TRACK_TIMEOUT_MS) {
      const job = mediaDownloader.getJob(jobId);
      if (!job) {
        await editMessage(chatId, statusMessageId, "Задача загрузки не найдена.");
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
          await appendSegmentMediaPaths(docId, segmentId, attachedPaths, chatId, "yt_dlp_url");
          await editMessage(
            chatId,
            statusMessageId,
            `Готово.\nСегмент: ${segmentId}\nФайлов добавлено: ${attachedPaths.length}`
          ).catch(() => null);
        } else {
          await editMessage(
            chatId,
            statusMessageId,
            `Загрузка завершена, но файлов для привязки не найдено.\nСегмент: ${segmentId}`
          ).catch(() => null);
        }
        return;
      }
      if (job.status === "failed" || job.status === "canceled") {
        await editMessage(chatId, statusMessageId, formatJobStatusMessage(segmentId, url, job)).catch(() => null);
        return;
      }
      await delay(JOB_WATCH_INTERVAL_MS);
    }
    await editMessage(
      chatId,
      statusMessageId,
      `Остановил отслеживание задачи по таймауту.\nСегмент: ${segmentId}\nПроверьте историю загрузок в UI.`
    ).catch(() => null);
  }

  async function handleUrlInput(chatId, session, segment, url) {
    if (!mediaDownloader.isAvailable()) {
      await sendMessage(chatId, "yt-dlp недоступен в backend. Проверьте MEDIA_YTDLP_PATH / локальные бинарники.");
      return;
    }
    if (!isHttpUrl(url)) {
      await sendMessage(chatId, "URL должен быть http(s).");
      return;
    }
    if (!isYtDlpCandidateUrl(url)) {
      await sendMessage(chatId, "URL не поддерживается фильтром yt-dlp.");
      return;
    }
    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? "");
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
        url
      }
    }).catch(() => null);

    const progressMessage = await sendMessage(
      chatId,
      `Сегмент: ${segment.segment_id}\nURL: ${url}\nСтатус: queued\nПрогресс: 0%`
    );

    void trackDownloadJobAndAttach({
      chatId,
      statusMessageId: progressMessage?.message_id,
      docId: session.doc_id,
      segmentId: segment.segment_id,
      sectionTitle,
      url,
      jobId: job.id
    });
  }

  async function handleTelegramMediaInput(chatId, session, segment, mediaItems) {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) return;
    const status = await sendMessage(
      chatId,
      `Сегмент: ${segment.segment_id}\nСкачиваю файлы из Telegram: 0/${mediaItems.length}`
    );
    const attachedPaths = [];
    const sectionTitle = sanitizeMediaTopicName(segment?.section_title ?? "");
    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      await editMessage(
        chatId,
        status?.message_id,
        `Сегмент: ${segment.segment_id}\nСкачиваю файлы из Telegram: ${index + 1}/${mediaItems.length}`
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
      `Готово.\nСегмент: ${segment.segment_id}\nФайлов добавлено: ${attachedPaths.length}`
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
      await sendMessage(chatId, "Не удалось найти документ. Укажите doc_id: /sdvg <doc_id>");
      return;
    }
    const payload = await readDocPayload(docId);
    if (!payload || payload.segments.length === 0) {
      await sendMessage(chatId, `В документе "${docId}" пока нет сегментов.`);
      return;
    }
    const openSegments = getOpenSegments(payload.segments);
    if (openSegments.length === 0) {
      session.doc_id = docId;
      session.active_segment_id = null;
      await sendMessage(chatId, `В документе "${docId}" нет незавершённых сегментов.`);
      return;
    }

    const current = openSegments.find((item) => item.segment_id === session.active_segment_id) ?? openSegments[0];
    await sendSegmentCard(chatId, docId, current.segment_id);
  }

  async function handleNextSegmentCallback(chatId, callbackId, callbackMessageId, session) {
    const context = getCardContext(session, callbackMessageId);
    if (!context?.doc_id || !context?.segment_id) {
      await answerCallback(callbackId, "Карточка устарела. Отправьте /sdvg заново.", true).catch(() => null);
      return;
    }
    const payload = await readDocPayload(context.doc_id);
    if (!payload) {
      await answerCallback(callbackId, "Документ не найден.", true).catch(() => null);
      return;
    }
    const openSegments = getOpenSegments(payload.segments);
    if (openSegments.length === 0) {
      session.doc_id = context.doc_id;
      session.active_segment_id = null;
      await answerCallback(callbackId, "Незавершённых сегментов нет.", true).catch(() => null);
      return;
    }
    let nextSegment = null;
    if (session?.random_mode) {
      const candidates = openSegments.filter((item) => item.segment_id !== context.segment_id);
      if (candidates.length > 0) {
        const index = Math.floor(Math.random() * candidates.length);
        nextSegment = candidates[index] ?? null;
      }
    } else {
      const currentIndex = openSegments.findIndex((item) => item.segment_id === context.segment_id);
      nextSegment = currentIndex >= 0 ? openSegments[currentIndex + 1] ?? null : openSegments[0];
    }
    if (!nextSegment) {
      session.doc_id = context.doc_id;
      session.active_segment_id = null;
      await answerCallback(callbackId, "Незавершённые сегменты закончились.", true).catch(() => null);
      await sendMessage(chatId, "Незавершённые сегменты закончились.");
      return;
    }
    await answerCallback(callbackId, "Отправляю следующий сегмент...", false).catch(() => null);
    await sendSegmentCard(chatId, context.doc_id, nextSegment.segment_id);
  }

  async function handleMetaCallback(callbackId, callbackMessageId, session, key) {
    const context = getCardContext(session, callbackMessageId);
    if (!context?.doc_id || !context?.segment_id) {
      await answerCallback(callbackId, "Карточка устарела. Отправьте /sdvg заново.", true).catch(() => null);
      return;
    }
    const payload = await readDocPayload(context.doc_id);
    if (!payload) {
      await answerCallback(callbackId, "Документ не найден.", true).catch(() => null);
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
      text = visual.priority;
    } else if (key === "section") {
      text = String(segment?.section_title ?? "").trim();
    }
    if (!text) text = "Пусто";
    await answerCallback(callbackId, clipText(text, CALLBACK_ALERT_MAX), true).catch(() => null);
  }

  async function handleModeToggleCallback(chatId, callbackId, callbackMessageId, session) {
    session.random_mode = !Boolean(session.random_mode);
    const modeText = session.random_mode ? "🎲" : "📚";
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
    if (data === "sdvg_mode:toggle") {
      await handleModeToggleCallback(chatId, callbackId, messageId, session);
      return;
    }
    if (data.startsWith("sdvg_meta:")) {
      const key = data.slice("sdvg_meta:".length);
      await handleMetaCallback(callbackId, messageId, session, key);
      return;
    }

    await answerCallback(callbackId, "Неизвестное действие.", false).catch(() => null);
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
      if (["random", "rnd", "rand", "случайно", "mix"].includes(normalized)) {
        randomMode = true;
        return;
      }
      if (["seq", "order", "по_порядку", "по-порядку", "по", "очередь"].includes(normalized)) {
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
          "СДВГ режим активен.",
          "Команда: /sdvg или /sdvg <doc_id>",
          "Режим случайного выбора: /sdvg random (или кнопка режима в карточке).",
          "Текст добавляется в «Описание визуала/Комментарий».",
          "Ссылка запускает yt-dlp загрузку и привязку к текущему сегменту.",
          "Фото/видео/аудио из Telegram скачиваются в папку темы и привязываются к сегменту."
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
        await sendMessage(chatId, "Сначала отправьте /sdvg, чтобы выбрать активный сегмент.");
      }
      return;
    }
    const { segment } = active;
    const urls = extractUrls(String(message?.text ?? message?.caption ?? ""));
    const supportedUrl = urls.find((item) => isHttpUrl(item) && isYtDlpCandidateUrl(item)) ?? null;
    if (supportedUrl) {
      await handleUrlInput(chatId, session, segment, supportedUrl);
      return;
    }

    const mediaItems = collectMessageMediaItems(message);
    if (mediaItems.length > 0) {
      await handleTelegramMediaInput(chatId, session, segment, mediaItems);
      return;
    }

    const plainText = String(message?.text ?? "").trim();
    if (plainText && !plainText.startsWith("/")) {
      await appendVisualDescription(session.doc_id, segment.segment_id, plainText, chatId);
      await sendMessage(chatId, `Добавил в «Описание визуала/Комментарий» для сегмента ${segment.segment_id}.`);
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
      bot_username: state.botUsername
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
