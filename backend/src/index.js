import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendEvent,
  ensureDataDir,
  ensureDocDir,
  getDocDir,
  listDocuments,
  readEvents,
  readOptionalJson,
  saveVersioned,
  writeJson
} from "./storage.js";
import {
  config,
  generateEnglishSearchDecisionsForSegments,
  generateSearchDecisionsForSegments,
  generateSegmentsOnly,
  generateVisualDecisionsForSegments,
  translateHeadingToEnglishQuery
} from "./llm.js";
import {
  MediaDownloadQueue,
  isYtDlpCandidateUrl,
  resolveDownloaderTools
} from "./downloader.js";
import { scrapeNotionPage } from "../../HeadlessNotion/notion-scraper.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const execFileAsync = promisify(execFile);
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_MAX_FILES_LIST = Number.isFinite(Number(process.env.MEDIA_MAX_FILES_LIST))
  ? Math.max(20, Number(process.env.MEDIA_MAX_FILES_LIST))
  : 500;
const MEDIA_DOWNLOAD_ROOT = process.env.MEDIA_DOWNLOAD_ROOT || "C:\\Users\\Nemifist\\YandexDisk\\PAMPAM";
const XML_EXPORT_FPS = Number.isFinite(Number(process.env.XML_EXPORT_FPS))
  ? Math.max(1, Number(process.env.XML_EXPORT_FPS))
  : 50;
const XML_EXPORT_DEFAULT_DURATION_SEC = Number.isFinite(Number(process.env.XML_EXPORT_DEFAULT_DURATION_SEC))
  ? Math.max(0.2, Number(process.env.XML_EXPORT_DEFAULT_DURATION_SEC))
  : 5;
const XML_SECTION_MARKER_DURATION_SEC = Number.isFinite(Number(process.env.XML_SECTION_MARKER_DURATION_SEC))
  ? Math.max(0, Number(process.env.XML_SECTION_MARKER_DURATION_SEC))
  : 2;
const XML_SECTION_GAP_SEC = Number.isFinite(Number(process.env.XML_SECTION_GAP_SEC))
  ? Math.max(0, Number(process.env.XML_SECTION_GAP_SEC))
  : 0;
const XML_SEQUENCE_WIDTH = 1920;
const XML_SEQUENCE_HEIGHT = 960;
const XML_SECTION_MARKER_COLOR = "4294741314";
const XML_DEFAULT_CENTER = {
  x: XML_SEQUENCE_WIDTH / 2,
  y: XML_SEQUENCE_HEIGHT / 2
};
const XML_DEFAULT_MOTION_TEMPLATE = {
  scale: 100,
  center: XML_DEFAULT_CENTER
};
const XML_BASIC_MOTION_TEMPLATES = new Map(
  [
    [1920, 1080, 100, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1920, 960, 90, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1920, 1920, 50, null, null],
    [960, 960, 100, null, null],
    [3840, 1920, 50, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [872, 480, 222, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [854, 480, 225, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1024, 1024, 94, null, null],
    [1280, 720, 150, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1080, 1080, 88.9, null, null],
    [720, 1280, 75, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1080, 1920, 50, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [1280, 700, 150, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [480, 854, 115, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [2160, 2160, 45, null, null],
    [2358, 2358, 40.7, null, null],
    [4209, 1645, 41.1, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [3970, 1273, 43.5, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [3696, 790, 46.8, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [2452, 683, 70.4, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [4096, 1379, 42.2, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [2007, 562, 86.1, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y]
  ].map(([w, h, scale, cx, cy]) => [
    `${w}x${h}`,
    {
      scale,
      center: cx == null || cy == null ? null : { x: cx, y: cy }
    }
  ])
);
const XML_WIDTH_SCALE_OVERRIDES = new Map([
  [4096, 42.2],
  [2452, 70.4]
]);
const XML_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".webm",
  ".avi",
  ".mts",
  ".m2ts",
  ".ts"
]);
const XML_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".avif"
]);
const XML_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".aac",
  ".m4a",
  ".flac",
  ".ogg",
  ".opus",
  ".aiff"
]);
const XML_DIMENSIONS_CACHE = new Map();
const XML_MEDIA_INFO_CACHE = new Map();
let XML_FFPROBE_CANDIDATES = null;
const NOTION_PROGRESS_TTL_MS = 15 * 60 * 1000;
const notionProgressStore = new Map();
const mediaDocumentWriteLocks = new Map();

const downloaderTools = await resolveDownloaderTools();
const mediaDownloader = new MediaDownloadQueue({
  ytDlpPath: downloaderTools.ytDlpPath,
  ffmpegLocation: downloaderTools.ffmpegLocation,
  maxConcurrent: Number(process.env.MEDIA_MAX_CONCURRENT ?? 1),
  startDelayMs: Number(process.env.MEDIA_START_DELAY_MS ?? 2500),
  onStateChange: (job) => {
    if (!["running", "completed", "failed", "canceled"].includes(job.status)) return;
    appendEvent(job.doc_id, {
      timestamp: new Date().toISOString(),
      event: "media_download_status",
      payload: {
        job_id: job.id,
        status: job.status,
        url: job.url,
        progress: job.progress ?? null,
        error: job.error ?? null,
        output_files: job.output_files ?? []
      }
    }).catch(() => null);
    if (job.status === "completed") {
      persistMediaDownloadState(job).catch(() => null);
    }
  }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.post("/api/search/translate", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    const translated = await translateHeadingToEnglishQuery(text);
    return res.json({ text: translated || text });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/notion/raw", async (req, res) => {
  try {
    const rawUrl = String(req.body?.url ?? "").trim();
    if (!rawUrl) {
      return res.status(400).json({ error: "url is required" });
    }
    const url = normalizeNotionUrl(rawUrl);
    if (!isNotionUrl(url)) {
      return res.status(400).json({ error: "Notion URL is required" });
    }

    const progressId = String(req.body?.progress_id ?? "").trim();
    if (progressId) {
      initNotionProgress(progressId);
    }

    const content = await scrapeNotionPage(url, (message) => {
      if (!progressId) return;
      pushNotionProgress(progressId, message);
    });

    if (progressId) {
      finishNotionProgress(progressId);
    }

    res.json({ url, content, progress_id: progressId || null });
  } catch (error) {
    const progressId = String(req.body?.progress_id ?? "").trim();
    if (progressId) {
      pushNotionProgress(progressId, `❌ ${error.message}`);
      finishNotionProgress(progressId);
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/notion/progress/:progressId", (req, res) => {
  const progressId = String(req.params?.progressId ?? "").trim();
  if (!progressId) {
    return res.status(400).json({ error: "progressId is required" });
  }
  pruneNotionProgressStore();
  const snapshot = getNotionProgress(progressId);
  if (!snapshot) {
    return res.status(404).json({ error: "Progress session not found" });
  }
  return res.json(snapshot);
});

app.get("/api/link/preview", async (req, res) => {
  try {
    const rawUrl = String(req.query?.url ?? "").trim();
    if (!rawUrl) {
      return res.status(400).json({ error: "url is required" });
    }
    const url = normalizeLinkUrl(rawUrl);
    if (!isHttpUrl(url)) {
      return res.status(400).json({ error: "url must be http(s)" });
    }

    const preview = await fetchLinkPreview(url);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/link/image", async (req, res) => {
  try {
    const rawUrl = String(req.query?.url ?? "").trim();
    if (!rawUrl) {
      return res.status(400).json({ error: "url is required" });
    }
    const url = normalizeLinkUrl(rawUrl);
    if (!isHttpUrl(url)) {
      return res.status(400).json({ error: "url must be http(s)" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const referer = (() => {
        try {
          return new URL(url).origin + "/";
        } catch {
          return undefined;
        }
      })();
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          ...(referer ? { referer } : {})
        }
      });

      if (!response.ok) {
        return res.status(502).json({ error: "image fetch failed" });
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        return res.status(415).json({ error: "not an image" });
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength && contentLength > IMAGE_PROXY_MAX_BYTES) {
        return res.status(413).json({ error: "image too large" });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > IMAGE_PROXY_MAX_BYTES) {
        return res.status(413).json({ error: "image too large" });
      }

      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.send(buffer);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/downloader/config", (_req, res) => {
  res.json({
    tools: mediaDownloader.getToolsInfo(),
    download_root: MEDIA_DOWNLOAD_ROOT,
    note: "Downloader uses yt-dlp only"
  });
});

app.get("/api/documents/:id/media", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const files = await listMediaFiles();
    const jobs = mediaDownloader.listJobs(docId);
    const downloadedMap = normalizeDocumentMediaDownloads(document.media_downloads);
    res.json({
      files,
      jobs,
      downloaded_urls: Object.keys(downloadedMap),
      download_root: MEDIA_DOWNLOAD_ROOT,
      tools: mediaDownloader.getToolsInfo()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/media:download", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    if (!mediaDownloader.isAvailable()) {
      return res.status(503).json({
        error: "yt-dlp is not available. Configure MEDIA_YTDLP_PATH or add MediaDownloaderQt6-5.4.2."
      });
    }

    const rawUrl = String(req.body?.url ?? "").trim();
    if (!rawUrl) return res.status(400).json({ error: "url is required" });
    const url = normalizeLinkUrl(rawUrl);
    if (!isHttpUrl(url)) return res.status(400).json({ error: "url must be http(s)" });
    if (!isYtDlpCandidateUrl(url)) {
      return res.status(400).json({ error: "URL is not supported by yt-dlp filter" });
    }
    if (isMediaAlreadyDownloaded(document, url)) {
      return res.json({
        already_downloaded: true,
        url,
        tools: mediaDownloader.getToolsInfo()
      });
    }

    const rawSectionTitle = typeof req.body?.section_title === "string" ? req.body.section_title : "";
    const sectionTitle = sanitizeMediaTopicName(rawSectionTitle);
    const outputDir = await ensureMediaDir(sectionTitle);
    const job = mediaDownloader.enqueue({ docId, url, outputDir, sectionTitle });

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "media_download_queued",
      payload: { job_id: job.id, url: job.url, section_title: sectionTitle }
    });

    res.json({ job, tools: mediaDownloader.getToolsInfo() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/media/:jobId", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const job = mediaDownloader.getJob(req.params.jobId);
    if (!job || job.doc_id !== docId) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/media/:jobId:cancel", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const job = mediaDownloader.getJob(req.params.jobId);
    if (!job || job.doc_id !== docId) return res.status(404).json({ error: "Job not found" });

    const canceled = mediaDownloader.cancel(req.params.jobId);
    if (!canceled) return res.status(409).json({ error: "Job cannot be canceled" });

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "media_download_cancel",
      payload: { job_id: req.params.jobId }
    });

    res.json({ ok: true, job: mediaDownloader.getJob(req.params.jobId) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/media/file", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const relativePath = String(req.query?.path ?? "").trim();
    if (!relativePath) return res.status(400).json({ error: "path is required" });

    const mediaDir = getMediaDir();
    const filePath = safeResolveMediaPath(mediaDir, relativePath);
    if (!filePath) return res.status(400).json({ error: "Invalid path" });

    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) return res.status(404).json({ error: "File not found" });

    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents", async (_req, res) => {
  try {
    const docs = await listDocuments();
    res.json({ documents: docs.map((doc) => normalizeDocumentForResponse(doc)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents", async (req, res) => {
  try {
    const rawText = String(req.body?.raw_text ?? "").trim();
    if (!rawText) {
      return res.status(400).json({ error: "raw_text is required" });
    }
    const notionRaw = req.body?.notion_url;
    const notionInput = typeof notionRaw === "string" ? notionRaw.trim() : "";
    const notionUrl = notionInput ? normalizeNotionUrl(notionInput) : "";
    if (notionUrl && !isNotionUrl(notionUrl)) {
      return res.status(400).json({ error: "notion_url must be a Notion link" });
    }

    await ensureDataDir();
    const nowIso = new Date().toISOString();

    if (notionUrl) {
      const docs = await listDocuments();
      const existing = docs.find((item) => normalizeNotionUrl(item?.notion_url ?? "") === notionUrl);
      if (existing?.id) {
        const docId = existing.id;
        const dir = await ensureDocDir(docId);
        const current = (await readOptionalJson(path.join(dir, "document.json"))) ?? {};
        const document = {
          ...current,
          id: docId,
          raw_text: rawText,
          notion_url: notionUrl,
          created_at: current.created_at ?? existing.created_at ?? nowIso,
          last_segmented_text_hash: getDocumentLastSegmentedHash(current) || null
        };
        syncDocumentSegmentationState(document, rawText);
        await writeJson(path.join(dir, "document.json"), document);
        await appendEvent(docId, {
          timestamp: nowIso,
          event: "document_upserted",
          payload: { doc_id: docId, mode: "reuse_by_notion" }
        });
        return res.json({ id: docId, document: normalizeDocumentForResponse(document), reused: true });
      }
    }

    const docId = `doc_${new Date().toISOString().replace(/[:.]/g, "-")}_${nanoid(6)}`;
    const dir = await ensureDocDir(docId);
    const createdAt = nowIso;

    const document = {
      id: docId,
      raw_text: rawText,
      created_at: createdAt,
      notion_url: notionUrl || null,
      needs_segmentation: true,
      last_segmented_text_hash: null
    };

    await writeJson(path.join(dir, "document.json"), document);
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "document_created",
      payload: { doc_id: docId }
    });

    res.json({ id: docId, document: normalizeDocumentForResponse(document) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);

    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = await readOptionalJson(path.join(dir, "segments.json"));
    const decisions = await readOptionalJson(path.join(dir, "decisions.json"));
    const normalizedDocument = normalizeDocumentForResponse(document);
    if (shouldInferNeedsSegmentation(document)) {
      normalizedDocument.needs_segmentation = await inferNeedsSegmentationFromFileState(
        dir,
        normalizedDocument.raw_text,
        segments
      );
    }
    const state = await readDocumentState(dir, normalizedDocument);

    res.json({
      document: normalizedDocument,
      segments: segments ?? [],
      decisions: decisions ?? [],
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/state", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const state = await readDocumentState(dir, document);
    res.json({
      doc_id: docId,
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const rawTextInput = req.body?.raw_text;
    const notionInput = req.body?.notion_url;
    const hasRawText = typeof rawTextInput === "string";
    const hasNotion = notionInput !== undefined;
    if (!hasRawText && !hasNotion) {
      return res.status(400).json({ error: "raw_text or notion_url is required" });
    }

    if (hasRawText) {
      const nextRawText = String(rawTextInput);
      document.raw_text = nextRawText;
      syncDocumentSegmentationState(document, nextRawText);
    }

    if (hasNotion) {
      const notionValue = String(notionInput ?? "").trim();
      if (notionValue) {
        const normalized = normalizeNotionUrl(notionValue);
        if (!isNotionUrl(normalized)) {
          return res.status(400).json({ error: "notion_url must be a Notion link" });
        }
        document.notion_url = normalized;
      } else {
        document.notion_url = null;
      }
    }

    document.updated_at = new Date().toISOString();
    await writeJson(path.join(dir, "document.json"), document);
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "document_updated",
      payload: { doc_id: docId }
    });

    res.json({ document: normalizeDocumentForResponse(document) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/session", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!segments) return res.status(400).json({ error: "segments must be an array" });
    if (!decisions) return res.status(400).json({ error: "decisions must be an array" });

    const normalizedSegments = normalizeSegmentsInput(segments);
    const normalizedDecisions = normalizeDecisionsInput(decisions);

    if (typeof req.body?.raw_text === "string") {
      const nextRawText = String(req.body.raw_text);
      document.raw_text = nextRawText;
      syncDocumentSegmentationState(document, nextRawText);
    }

    if (req.body?.notion_url !== undefined) {
      const notionValue = String(req.body?.notion_url ?? "").trim();
      if (notionValue) {
        const normalizedNotion = normalizeNotionUrl(notionValue);
        if (!isNotionUrl(normalizedNotion)) {
          return res.status(400).json({ error: "notion_url must be a Notion link" });
        }
        document.notion_url = normalizedNotion;
      } else {
        document.notion_url = null;
      }
    }

    document.updated_at = new Date().toISOString();
    await writeJson(path.join(dir, "document.json"), document);

    const segmentsVersion = await saveVersioned(docId, "segments", normalizedSegments);
    const decisionsVersion = await saveVersioned(docId, "decisions", normalizedDecisions);

    const source = typeof req.body?.source === "string" ? req.body.source.slice(0, 64) : "manual";
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "session_saved",
      payload: {
        source,
        segments_version: segmentsVersion,
        decisions_version: decisionsVersion
      }
    });

    const state = await readDocumentState(dir, document);
    res.json({
      document: normalizeDocumentForResponse(document),
      segments: normalizedSegments,
      decisions: normalizedDecisions,
      segments_version: segmentsVersion,
      decisions_version: decisionsVersion,
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/segments:generate", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    let text = document.raw_text;
    const incomingText = typeof req.body?.raw_text === "string" ? req.body.raw_text.trim() : "";
    if (incomingText) {
      text = incomingText;
      if (incomingText !== document.raw_text) {
        document.raw_text = incomingText;
        syncDocumentSegmentationState(document, incomingText);
        document.updated_at = new Date().toISOString();
        await writeJson(path.join(dir, "document.json"), document);
        await appendEvent(docId, {
          timestamp: new Date().toISOString(),
          event: "document_updated",
          payload: { doc_id: docId }
        });
      }
    }

    const segments = await generateSegmentsOnly({ text });
    const existingSegments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    const existingDecisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(
      segments,
      existingSegments,
      existingDecisions
    );
    const incomingLinkSegments = normalizeLinkSegmentsInput(req.body?.link_segments);
    const mergedWithLinks =
      incomingLinkSegments.length > 0 ? [...mergedSegments, ...incomingLinkSegments] : mergedSegments;
    const decisionsOverrideWithLinks = Array.isArray(decisionsOverride)
      ? [
          ...decisionsOverride,
          ...incomingLinkSegments.map((segment) => ({
            segment_id: segment.segment_id,
            visual_decision: emptyVisualDecision(),
            search_decision: emptySearchDecision(),
            search_decision_en: emptySearchDecision()
          }))
        ]
      : null;
    const { segmentsData, decisionsData } = splitSegmentsAndDecisions(
      mergedWithLinks,
      decisionsOverrideWithLinks
    );
    const ensuredMediaTopics = await ensureMediaTopicFoldersForSegments(segmentsData);

    const segmentsVersion = await saveVersioned(docId, "segments", segmentsData);
    const decisionsVersion = await saveVersioned(docId, "decisions", decisionsData);
    markDocumentSegmented(document, text);
    document.updated_at = new Date().toISOString();
    await writeJson(path.join(dir, "document.json"), document);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segments_generated",
      payload: {
        segmentsVersion,
        decisionsVersion,
        media_topic_folders_ensured: ensuredMediaTopics.length
      }
    });

    res.json({
      document: normalizeDocumentForResponse(document),
      segments: segmentsData,
      decisions: decisionsData,
      media_topic_folders_ensured: ensuredMediaTopics.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/decisions:generate", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = ((await readOptionalJson(path.join(dir, "segments.json"))) ?? []).filter(
      (segment) => segment?.block_type !== "links"
    );
    if (!segments.length) return res.status(400).json({ error: "Segments not found" });

    const inputSegments = Array.isArray(req.body?.segments)
      ? req.body.segments
      : req.body?.segment
        ? [req.body.segment]
        : null;
    const inputIds = Array.isArray(req.body?.segment_ids)
      ? req.body.segment_ids.map((id) => String(id))
      : req.body?.segment_id
        ? [String(req.body.segment_id)]
        : [];

    let targetSegments = [];
    if (inputSegments?.length) {
      targetSegments = inputSegments.map(normalizeSegmentForDecision).filter((segment) => segment.segment_id);
    } else if (inputIds.length) {
      targetSegments = segments.filter((segment) => inputIds.includes(segment.segment_id));
    }
    if (!targetSegments.length) {
      return res.status(400).json({ error: "segment_id/segment_ids or segment data is required" });
    }

    const generated = await generateVisualDecisionsForSegments(targetSegments);
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

    generated.forEach((decision) => {
      const existing = decisionMap.get(decision.segment_id);
      const mergedVisual = {
        ...(existing?.visual_decision ?? {}),
        ...(decision.visual_decision ?? {})
      };
      decisionMap.set(decision.segment_id, {
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(mergedVisual),
        search_decision: normalizeSearchDecisionInput(existing?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
        version: 1
      });
    });

    const mergedDecisions = Array.from(decisionMap.values());
    const version = await saveVersioned(docId, "decisions", mergedDecisions);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "decisions_generated",
      payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
    });

    res.json({
      decisions: generated.map((decision) => ({
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(decisionMap.get(decision.segment_id)?.visual_decision),
        search_decision: normalizeSearchDecisionInput(decisionMap.get(decision.segment_id)?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(decisionMap.get(decision.segment_id)?.search_decision_en),
        version: 1
      })),
      version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/search:generate", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    if (!segments.length) return res.status(400).json({ error: "Segments not found" });

    const inputSegments = Array.isArray(req.body?.segments)
      ? req.body.segments
      : req.body?.segment
        ? [req.body.segment]
        : null;
    const inputIds = Array.isArray(req.body?.segment_ids)
      ? req.body.segment_ids.map((id) => String(id))
      : req.body?.segment_id
        ? [String(req.body.segment_id)]
        : [];

    let targetSegments = [];
    if (inputSegments?.length) {
      targetSegments = inputSegments.map(normalizeSegmentWithVisual).filter((segment) => segment.segment_id);
    } else if (inputIds.length) {
      const decisionList = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
      const decisionMap = new Map(decisionList.map((item) => [item.segment_id, item]));
      targetSegments = segments
        .filter((segment) => inputIds.includes(segment.segment_id))
        .map((segment) => ({
          ...normalizeSegmentForDecision(segment),
          visual_decision: normalizeVisualDecisionInput(decisionMap.get(segment.segment_id)?.visual_decision)
        }));
    }

    if (!targetSegments.length) {
      return res.status(400).json({ error: "segment/segments or segment_id/segment_ids is required" });
    }

    const generated = await generateSearchDecisionsForSegments(targetSegments);
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

    generated.forEach((decision) => {
      const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
      const existing = decisionMap.get(decision.segment_id);
      decisionMap.set(decision.segment_id, {
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(source?.visual_decision),
        search_decision: normalizeSearchDecisionInput(decision.search_decision),
        search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
        version: 1
      });
    });

    const mergedDecisions = Array.from(decisionMap.values());
    const version = await saveVersioned(docId, "decisions", mergedDecisions);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "search_generated",
      payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
    });

    res.json({
      decisions: generated.map((decision) => {
        const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
        const existing = decisionMap.get(decision.segment_id);
        return {
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(source?.visual_decision),
          search_decision: normalizeSearchDecisionInput(decision.search_decision),
          search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
          version: 1
        };
      }),
      version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents/:id/search-en:generate", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    if (!segments.length) return res.status(400).json({ error: "Segments not found" });

    const inputSegments = Array.isArray(req.body?.segments)
      ? req.body.segments
      : req.body?.segment
        ? [req.body.segment]
        : null;
    const inputIds = Array.isArray(req.body?.segment_ids)
      ? req.body.segment_ids.map((id) => String(id))
      : req.body?.segment_id
        ? [String(req.body.segment_id)]
        : [];

    let targetSegments = [];
    if (inputSegments?.length) {
      targetSegments = inputSegments.map(normalizeSegmentWithVisual).filter((segment) => segment.segment_id);
    } else if (inputIds.length) {
      const decisionList = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
      const decisionMap = new Map(decisionList.map((item) => [item.segment_id, item]));
      targetSegments = segments
        .filter((segment) => inputIds.includes(segment.segment_id))
        .map((segment) => ({
          ...normalizeSegmentForDecision(segment),
          visual_decision: normalizeVisualDecisionInput(decisionMap.get(segment.segment_id)?.visual_decision)
        }));
    }

    if (!targetSegments.length) {
      return res.status(400).json({ error: "segment/segments or segment_id/segment_ids is required" });
    }

    const generated = await generateEnglishSearchDecisionsForSegments(targetSegments);
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

    generated.forEach((decision) => {
      const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
      const existing = decisionMap.get(decision.segment_id);
      decisionMap.set(decision.segment_id, {
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(source?.visual_decision ?? existing?.visual_decision),
        search_decision: normalizeSearchDecisionInput(existing?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(decision.search_decision),
        version: 1
      });
    });

    const mergedDecisions = Array.from(decisionMap.values());
    const version = await saveVersioned(docId, "decisions", mergedDecisions);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "search_en_generated",
      payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
    });

    res.json({
      decisions: generated.map((decision) => {
        const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
        const existing = decisionMap.get(decision.segment_id);
        return {
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(source?.visual_decision ?? existing?.visual_decision),
          search_decision: normalizeSearchDecisionInput(existing?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(decision.search_decision),
          version: 1
        };
      }),
      version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/segments", async (req, res) => {
  try {
    const docId = req.params.id;
    const segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    if (!segments) return res.status(400).json({ error: "segments must be an array" });

    const normalized = normalizeSegmentsInput(segments);
    const version = await saveVersioned(docId, "segments", normalized);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segments_updated",
      payload: { version }
    });

    res.json({ segments: normalized, version });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/decisions", async (req, res) => {
  try {
    const docId = req.params.id;
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!decisions) return res.status(400).json({ error: "decisions must be an array" });

    const normalized = normalizeDecisionsInput(decisions);
    const version = await saveVersioned(docId, "decisions", normalized);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "decisions_updated",
      payload: { version }
    });

    res.json({ decisions: normalized, version });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/events", async (req, res) => {
  try {
    const docId = req.params.id;
    const events = await readEvents(docId);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/dataset", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];

    const decisionMap = new Map(
      decisions.map((item) => [
        item.segment_id,
        {
          visual: normalizeVisualDecisionInput(item.visual_decision),
          search: normalizeSearchDecisionInput(item.search_decision),
          searchEn: normalizeSearchDecisionInput(item.search_decision_en)
        }
      ])
    );

    const dataset = segments.map((segment) => {
      const decision = decisionMap.get(segment.segment_id) ?? { visual: null, search: emptySearchDecision() };
      return {
        input_text: document.raw_text,
        segment: segment.text_quote,
        visual_decision: decision.visual,
        search_decision: decision.search,
        search_decision_en: decision.searchEn,
        keywords: decision.search?.keywords ?? [],
        queries: decision.search?.queries ?? [],
        keywords_en: decision.searchEn?.keywords ?? [],
        queries_en: decision.searchEn?.queries ?? []
      };
    });

    res.json({ dataset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/export", async (req, res) => {
  try {
    const docId = req.params.id;
    const format = String(req.query?.format ?? "jsonl").toLowerCase();
    if (!["jsonl", "md", "xml"].includes(format)) {
      return res.status(400).json({ error: "format must be jsonl, md or xml" });
    }

    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];

    const decisionMap = new Map(
      decisions.map((item) => [
        item.segment_id,
        {
          visual: normalizeVisualDecisionInput(item.visual_decision),
          search: normalizeSearchDecisionInput(item.search_decision),
          searchEn: normalizeSearchDecisionInput(item.search_decision_en)
        }
      ])
    );

    if (format === "xml") {
      const sectionId = String(req.query?.section_id ?? "").trim();
      const sectionTitle = String(req.query?.section_title ?? "").trim();
      const scope = String(req.query?.scope ?? "").trim().toLowerCase();
      const wantSection = scope === "section" || Boolean(sectionId) || Boolean(sectionTitle);
      const sourceSegments = segments.filter((segment) => segment?.block_type !== "links");
      const targetSegments = wantSection
        ? sourceSegments.filter((segment) => {
            if (sectionId && String(segment?.section_id ?? "").trim() === sectionId) return true;
            if (!sectionTitle) return false;
            return normalizeSectionTitleForMatch(segment?.section_title ?? "") === normalizeSectionTitleForMatch(sectionTitle);
          })
        : sourceSegments;

      if (wantSection && targetSegments.length === 0) {
        return res.status(404).json({ error: "Section not found for XML export" });
      }

      const xmlPayload = await buildXmlExportPayload({
        document,
        segments: targetSegments,
        decisionsBySegment: decisionMap,
        mediaDir: getMediaDir(),
        fps: XML_EXPORT_FPS,
        defaultDurationSec: XML_EXPORT_DEFAULT_DURATION_SEC,
        sectionId: wantSection ? sectionId : "",
        sectionTitle: wantSection ? sectionTitle : ""
      });

      if (xmlPayload.clipCount === 0) {
        return res.status(400).json({
          error: "No segments with attached media files found for XML export"
        });
      }

      res.setHeader("content-type", "application/xml; charset=utf-8");
      res.setHeader("content-disposition", buildContentDisposition(xmlPayload.fileName));
      return res.send(xmlPayload.xml);
    }

    if (format === "jsonl") {
      const segmentsForJsonl = segments.filter((segment) => segment?.block_type !== "links");
      const lines = segmentsForJsonl.map((segment) => {
        const decision = decisionMap.get(segment.segment_id) ?? {
          visual: emptyVisualDecision(),
          search: emptySearchDecision()
        };
        const payload = {
          messages: [
            {
              role: "system",
              content:
                "Ты — ассистент по визуальному брифу и поисковым запросам. По сегменту дай visual_decision и search_decision."
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  segment_id: segment.segment_id,
                  block_type: segment.block_type,
                  text_quote: segment.text_quote,
                  section_title: segment.section_title ?? null
                },
                null,
                2
              )
            },
            {
              role: "assistant",
              content: JSON.stringify(
                {
                  visual_decision: decision.visual,
                  search_decision: decision.search,
                  search_decision_en: decision.searchEn
                },
                null,
                2
              )
            }
          ],
          meta: {
            doc_id: document.id,
            segment_id: segment.segment_id,
            block_type: segment.block_type,
            section_id: segment.section_id ?? null,
            section_title: segment.section_title ?? null,
            section_index: segment.section_index ?? null
          }
        };
        return JSON.stringify(payload);
      });

      const body = lines.join("\n") + "\n";
      res.setHeader("content-type", "application/jsonl; charset=utf-8");
      res.setHeader("content-disposition", buildContentDisposition(`${document.id}.jsonl`));
      return res.send(body);
    }

    const mdLines = [
      `# Экспорт документа ${document.id}`,
      "",
      "## Исходный текст",
      "",
      "```",
      String(document.raw_text ?? ""),
      "```",
      "",
      "## Сегменты",
      ""
    ];

    segments.forEach((segment) => {
      if (segment?.block_type === "links") {
        const links = normalizeLinksInput(segment.links);
        mdLines.push(
          `### ${segment.segment_id} (links)`,
          segment.section_title ? `**Раздел:** ${segment.section_title}` : "**Раздел:** —",
          "",
          "**Ссылки**"
        );
        if (links.length) {
          links.forEach((link) => mdLines.push(`- ${link.url}`));
        } else {
          mdLines.push("- —");
        }
        mdLines.push("");
        return;
      }
      const decision = decisionMap.get(segment.segment_id) ?? {
        visual: emptyVisualDecision(),
        search: emptySearchDecision()
      };
      mdLines.push(
        `### ${segment.segment_id} (${segment.block_type})`,
        segment.section_title ? `**Раздел:** ${segment.section_title}` : "**Раздел:** —",
        "",
        `> ${segment.text_quote ?? ""}`,
        "",
        "**Визуал**",
        `- type: ${decision.visual.type ?? "no_visual"}`,
        `- description: ${decision.visual.description ?? ""}`,
        `- format_hint: ${decision.visual.format_hint ?? "—"}`,
        `- priority: ${decision.visual.priority ?? "—"}`,
        `- duration_hint_sec: ${decision.visual.duration_hint_sec ?? "—"}`,
        "",
        "**Поиск**",
        `- keywords: ${(decision.search.keywords ?? []).join(", ") || "—"}`,
        "- queries:"
      );
      if (decision.search.queries?.length) {
        decision.search.queries.forEach((query) => mdLines.push(`  - ${query}`));
      } else {
        mdLines.push("  - —");
      }
      if (decision.searchEn?.keywords?.length || decision.searchEn?.queries?.length) {
        mdLines.push(
          "",
          "**Search (EN)**",
          `- keywords: ${(decision.searchEn.keywords ?? []).join(", ") || "—"}`,
          "- queries:"
        );
        if (decision.searchEn.queries?.length) {
          decision.searchEn.queries.forEach((query) => mdLines.push(`  - ${query}`));
        } else {
          mdLines.push("  - —");
        }
      }
      mdLines.push("");
    });

    const mdBody = mdLines.join("\n");
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("content-disposition", buildContentDisposition(`${document.id}.md`));
    return res.send(mdBody);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  const tools = mediaDownloader.getToolsInfo();
  console.log(`Media downloader: yt-dlp=${tools.yt_dlp_path || "N/A"} ffmpeg_location=${tools.ffmpeg_location || "N/A"}`);
  console.log(`Media root: ${MEDIA_DOWNLOAD_ROOT}`);
});

function initNotionProgress(progressId) {
  const id = String(progressId ?? "").trim();
  if (!id) return;
  pruneNotionProgressStore();
  notionProgressStore.set(id, {
    id,
    messages: [],
    last_message: "",
    done: false,
    updated_at: new Date().toISOString()
  });
}

function pushNotionProgress(progressId, message) {
  const id = String(progressId ?? "").trim();
  if (!id) return;
  const text = String(message ?? "").trim();
  if (!text) return;

  const current = notionProgressStore.get(id) ?? {
    id,
    messages: [],
    last_message: "",
    done: false,
    updated_at: new Date().toISOString()
  };

  if (current.last_message === text) {
    current.updated_at = new Date().toISOString();
    notionProgressStore.set(id, current);
    return;
  }

  current.messages.push(text);
  if (current.messages.length > 120) {
    current.messages = current.messages.slice(-120);
  }
  current.last_message = text;
  current.updated_at = new Date().toISOString();
  notionProgressStore.set(id, current);
}

function finishNotionProgress(progressId) {
  const id = String(progressId ?? "").trim();
  if (!id) return;
  const current = notionProgressStore.get(id);
  if (!current) return;
  current.done = true;
  current.updated_at = new Date().toISOString();
  notionProgressStore.set(id, current);
}

function getNotionProgress(progressId) {
  const id = String(progressId ?? "").trim();
  if (!id) return null;
  const current = notionProgressStore.get(id);
  if (!current) return null;
  return {
    progress_id: current.id,
    done: Boolean(current.done),
    last_message: current.last_message || "",
    messages: current.messages.slice(-40),
    updated_at: current.updated_at
  };
}

function pruneNotionProgressStore() {
  const now = Date.now();
  for (const [id, state] of notionProgressStore.entries()) {
    const updatedAt = Date.parse(String(state?.updated_at ?? ""));
    if (!Number.isFinite(updatedAt)) {
      notionProgressStore.delete(id);
      continue;
    }
    if (now - updatedAt > NOTION_PROGRESS_TTL_MS) {
      notionProgressStore.delete(id);
    }
  }
}

function normalizeDocumentMediaDownloads(raw) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    const canonicalKey = canonicalizeLinkUrl(key);
    if (!canonicalKey) return;
    if (!value || typeof value !== "object") {
      result[canonicalKey] = {
        url: canonicalKey,
        status: "completed",
        updated_at: null
      };
      return;
    }
    const normalizedUrl = normalizeLinkUrl(value.url ?? canonicalKey) || canonicalKey;
    result[canonicalKey] = {
      url: normalizedUrl,
      status: "completed",
      section_title: typeof value.section_title === "string" ? value.section_title : null,
      output_files: Array.isArray(value.output_files)
        ? value.output_files
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
            .slice(0, 50)
        : [],
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null
    };
  });
  return result;
}

function isMediaAlreadyDownloaded(document, rawUrl) {
  const canonicalUrl = canonicalizeLinkUrl(rawUrl);
  if (!canonicalUrl) return false;
  const downloaded = normalizeDocumentMediaDownloads(document?.media_downloads);
  return Boolean(downloaded[canonicalUrl]);
}

async function persistMediaDownloadState(job) {
  const docId = String(job?.doc_id ?? "").trim();
  const rawUrl = String(job?.url ?? "").trim();
  if (!docId || !rawUrl) return;
  const canonicalUrl = canonicalizeLinkUrl(rawUrl);
  if (!canonicalUrl) return;

  await withMediaDocumentWriteLock(docId, async () => {
    const dir = getDocDir(docId);
    const documentPath = path.join(dir, "document.json");
    const document = await readOptionalJson(documentPath);
    if (!document) return;

    const downloaded = normalizeDocumentMediaDownloads(document.media_downloads);
    downloaded[canonicalUrl] = {
      url: normalizeLinkUrl(rawUrl) || canonicalUrl,
      status: "completed",
      section_title: typeof job.section_title === "string" ? job.section_title : null,
      output_files: Array.isArray(job.output_files)
        ? job.output_files
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
            .slice(0, 50)
        : [],
      updated_at: new Date().toISOString()
    };

    document.media_downloads = downloaded;
    document.updated_at = new Date().toISOString();
    await writeJson(documentPath, document);
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "media_download_recorded",
      payload: {
        url: canonicalUrl,
        section_title: downloaded[canonicalUrl].section_title,
        output_files: downloaded[canonicalUrl].output_files
      }
    });
  });
}

async function withMediaDocumentWriteLock(docId, fn) {
  const id = String(docId ?? "").trim();
  if (!id) return fn();

  const previous = mediaDocumentWriteLocks.get(id) ?? Promise.resolve();
  const run = previous
    .catch(() => null)
    .then(() => fn());

  mediaDocumentWriteLocks.set(id, run);
  try {
    return await run;
  } finally {
    if (mediaDocumentWriteLocks.get(id) === run) {
      mediaDocumentWriteLocks.delete(id);
    }
  }
}

function normalizeNotionUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function inferNeedsSegmentationFromFileState(dir, rawText, segments) {
  const hasText = Boolean(String(rawText ?? "").trim());
  const hasSegments = Array.isArray(segments) && segments.length > 0;
  if (!hasSegments) return hasText;

  const [documentStats, segmentsStats] = await Promise.all([
    fs.stat(path.join(dir, "document.json")).catch(() => null),
    fs.stat(path.join(dir, "segments.json")).catch(() => null)
  ]);
  if (!documentStats || !segmentsStats) return false;
  return Number(documentStats.mtimeMs ?? 0) > Number(segmentsStats.mtimeMs ?? 0);
}

function hashDocumentText(rawText) {
  return createHash("sha1").update(String(rawText ?? ""), "utf8").digest("hex");
}

function getDocumentLastSegmentedHash(document) {
  const value = document?.last_segmented_text_hash;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
}

function getDocumentNeedsSegmentation(document) {
  const explicit = document?.needs_segmentation;
  if (typeof explicit === "boolean") return explicit;
  const lastSegmentedHash = getDocumentLastSegmentedHash(document);
  if (!lastSegmentedHash) return false;
  const rawTextHash = hashDocumentText(document?.raw_text ?? "");
  return rawTextHash !== lastSegmentedHash;
}

function syncDocumentSegmentationState(document, rawText) {
  const lastSegmentedHash = getDocumentLastSegmentedHash(document);
  const rawTextHash = hashDocumentText(rawText ?? "");
  document.needs_segmentation = !lastSegmentedHash || rawTextHash !== lastSegmentedHash;
}

function markDocumentSegmented(document, rawText) {
  document.last_segmented_text_hash = hashDocumentText(rawText ?? "");
  document.needs_segmentation = false;
}

function normalizeDocumentForResponse(document) {
  if (!document || typeof document !== "object") return document;
  return {
    ...document,
    needs_segmentation: getDocumentNeedsSegmentation(document),
    last_segmented_text_hash: getDocumentLastSegmentedHash(document) || null
  };
}

function shouldInferNeedsSegmentation(document) {
  return typeof document?.needs_segmentation !== "boolean" && !getDocumentLastSegmentedHash(document);
}

function isNotionUrl(url) {
  return /notion\.(so|site)\b/i.test(String(url ?? ""));
}

function normalizeLinkUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getMediaDir() {
  return MEDIA_DOWNLOAD_ROOT;
}

async function ensureMediaDir(sectionTitle) {
  const root = getMediaDir();
  await fs.mkdir(root, { recursive: true });
  const topic = sanitizeMediaTopicName(sectionTitle);
  const dir = path.join(root, topic);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function ensureMediaTopicFoldersForSegments(segments = []) {
  const normalized = Array.isArray(segments) ? segments : [];
  const seen = new Set();
  const ensured = [];
  await fs.mkdir(getMediaDir(), { recursive: true });
  for (const segment of normalized) {
    if (String(segment?.block_type ?? "").trim().toLowerCase() === "links") continue;
    const topic = sanitizeMediaTopicName(segment?.section_title ?? "");
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await ensureMediaDir(topic);
    ensured.push(topic);
  }
  return ensured;
}

function safeResolveMediaPath(mediaDir, relativePath) {
  const clean = String(relativePath ?? "").replace(/^[/\\]+/, "");
  if (!clean) return "";
  const base = path.resolve(mediaDir);
  const target = path.resolve(mediaDir, clean);
  if (target === base) return "";
  if (!target.startsWith(`${base}${path.sep}`)) return "";
  return target;
}

async function listMediaFiles() {
  const mediaDir = getMediaDir();
  const exists = await fs
    .access(mediaDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];

  const files = [];
  const stack = [""];
  while (stack.length > 0 && files.length < MEDIA_MAX_FILES_LIST) {
    const currentRel = stack.pop();
    const currentDir = currentRel ? path.join(mediaDir, currentRel) : mediaDir;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= MEDIA_MAX_FILES_LIST) break;
      const relPath = currentRel ? path.join(currentRel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldHideMediaFile(entry.name)) continue;
      const absolutePath = path.join(mediaDir, relPath);
      const stats = await fs.stat(absolutePath).catch(() => null);
      if (!stats || !stats.isFile()) continue;
      const normalizedRel = relPath.split(path.sep).join("/");
      files.push({
        path: normalizedRel,
        name: entry.name,
        size: stats.size,
        updated_at: stats.mtime?.toISOString?.() ?? null
      });
    }
  }
  return files.sort((a, b) => {
    const left = a.updated_at ?? "";
    const right = b.updated_at ?? "";
    return left > right ? -1 : 1;
  });
}

function shouldHideMediaFile(fileName) {
  const normalized = String(fileName ?? "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("newfile")) return true;
  if (normalized.endsWith(".txt")) return true;
  if (normalized.endsWith(".db")) return true;
  if (normalized.endsWith(".py")) return true;
  if (normalized.endsWith(".sqlite")) return true;
  if (normalized.endsWith(".sqlite-shm")) return true;
  if (normalized.endsWith(".sqlite-wal")) return true;
  return false;
}

async function readDocumentState(dir, document = null) {
  const files = ["document.json", "segments.json", "decisions.json", "events.jsonl", "events.log"];
  let revision = 0;
  let updatedAt = document?.updated_at ?? null;

  for (const name of files) {
    const stats = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stats || !stats.isFile()) continue;
    const mtimeMs = Number(stats.mtimeMs ?? 0);
    if (mtimeMs > revision) {
      revision = mtimeMs;
      updatedAt = stats.mtime?.toISOString?.() ?? updatedAt;
    }
  }

  return {
    revision,
    updated_at: updatedAt
  };
}

function sanitizeMediaTopicName(rawTitle) {
  const value = String(rawTitle ?? "").trim();
  if (!value) return "Без темы";

  const replaced = value
    .replace(/[\u0000-\u001f<>:\"/\\|?*]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const normalized = replaced || "Без темы";
  const clipped = normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
  if (!clipped) return "Без темы";

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
}

function canonicalizeLinkUrl(rawUrl) {
  const normalized = normalizeLinkUrl(rawUrl);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.port === "80") url.port = "";
    if (url.protocol === "https:" && url.port === "443") url.port = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ""));
}

function toProxyImageUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return "";
  if (value.startsWith("/api/link/image")) return value;
  if (value.startsWith("data:")) return value;
  if (!isHttpUrl(value)) return "";
  return `/api/link/image?url=${encodeURIComponent(value)}`;
}

function normalizeLinksInput(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  raw.forEach((item) => {
    if (typeof item === "string") {
      const url = normalizeLinkUrl(item);
      if (!url) return;
      const canonical = canonicalizeLinkUrl(url);
      if (!canonical || seen.has(canonical)) return;
      seen.add(canonical);
      result.push({ url, raw: item });
      return;
    }
    if (!item || typeof item !== "object") return;
    const url = normalizeLinkUrl(item.url ?? item.href ?? item.link ?? "");
    if (!url) return;
    const canonical = canonicalizeLinkUrl(url);
    if (!canonical || seen.has(canonical)) return;
    seen.add(canonical);
    result.push({ url, raw: typeof item.raw === "string" ? item.raw : null });
  });
  return result;
}

function normalizeLinkSegmentsInput(raw) {
  if (!Array.isArray(raw)) return [];
  const map = new Map();
  raw.forEach((segment, index) => {
    const normalized = {
      segment_id: String(segment?.segment_id ?? `links_${index + 1}`),
      block_type: "links",
      text_quote: "",
      links: normalizeLinksInput(segment?.links),
      section_id: segment?.section_id ? String(segment.section_id) : null,
      section_title: segment?.section_title ? String(segment.section_title) : null,
      section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null,
      segment_status: segment?.segment_status ? String(segment.segment_status) : null,
      version: Number(segment?.version ?? 1)
    };
    const key = getLinkSegmentKey(normalized, index);
    const current = map.get(key);
    if (!current) {
      map.set(key, normalized);
      return;
    }
    map.set(key, {
      ...current,
      segment_id: current.segment_id || normalized.segment_id,
      section_id: current.section_id ?? normalized.section_id,
      section_title: current.section_title ?? normalized.section_title,
      section_index: current.section_index ?? normalized.section_index,
      links: normalizeLinksInput([...(current.links ?? []), ...(normalized.links ?? [])])
    });
  });
  return Array.from(map.values());
}

function getLinkSegmentKey(segment, fallbackIndex = 0) {
  const title = normalizeSectionTitleForMatch(segment?.section_title ?? "");
  if (title) return `title:${title}`;
  const sectionId = String(segment?.section_id ?? "").trim().toLowerCase();
  if (sectionId && !/^section_\d+$/i.test(sectionId)) return `id:${sectionId}`;
  if (sectionId) return `legacy:${sectionId}`;
  const segmentId = String(segment?.segment_id ?? "").trim().toLowerCase();
  if (segmentId) return `segment:${segmentId}`;
  return `idx:${fallbackIndex}`;
}

async function fetchLinkPreview(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const youtubeId = getYouTubeId(url);
    if (youtubeId) {
      const oembed = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, controller);
      const thumbnail = oembed?.thumbnail_url || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
      const image = toProxyImageUrl(thumbnail);
      return {
        url,
        title: oembed?.title ?? "",
        description: "",
        image,
        siteName: "YouTube"
      };
    }

    const tweetId = getTweetId(url);
    if (tweetId) {
      const xPreview = await fetchXPreview(url, tweetId, controller);
      if (xPreview) return xPreview;
    }

    if (isVkUrl(url)) {
      const vkBotPreview = await fetchVkBotPreview(url, controller);
      if (vkBotPreview) return vkBotPreview;
      const vkPreview = await fetchVkOembedPreview(url, controller);
      if (vkPreview) return vkPreview;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      }
    });
    if (!response.ok) {
      return { url, title: "", description: "", image: "", siteName: "" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { url, title: "", description: "", image: "", siteName: "" };
    }
    const html = await decodeHtmlResponse(response);
    const head = html.slice(0, 200000);
    const title = extractTitle(head);
    const ogTitle = extractMeta(head, "og:title");
    const description = extractMeta(head, "description");
    const ogDescription = extractMeta(head, "og:description");
    const siteName = extractMeta(head, "og:site_name") || extractMeta(head, "twitter:site");
    const resolvedTitle = (ogTitle || title || "").trim();
    const blockedVkTitle = isVkUrl(url) && isVkAntiBotTitle(resolvedTitle);
    const image =
      extractMeta(head, "og:image:secure_url") ||
      extractMeta(head, "og:image") ||
      extractMeta(head, "og:image:url") ||
      extractMeta(head, "twitter:image") ||
      extractMeta(head, "twitter:image:src") ||
      extractLinkRel(head, "image_src");
    const imageUrl = image ? safeAbsoluteUrl(image, url) : "";
    const proxiedImage = toProxyImageUrl(imageUrl);

    return {
      url,
      title: blockedVkTitle ? "" : resolvedTitle,
      description: blockedVkTitle ? "" : (ogDescription || description || ""),
      image: proxiedImage,
      siteName: siteName || (isVkUrl(url) ? "VK" : "")
    };
  } catch {
    return { url, title: "", description: "", image: "", siteName: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlResponse(response) {
  return response.arrayBuffer().then((arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer);
    const contentType = String(response.headers.get("content-type") ?? "");
    const headerCharset = parseCharsetFromContentType(contentType);
    const asciiProbe = buffer.toString("latin1", 0, Math.min(buffer.length, 8192));
    const metaCharset = parseCharsetFromHtmlProbe(asciiProbe);
    const candidates = [
      headerCharset,
      metaCharset,
      "utf-8",
      "windows-1251",
      "koi8-r"
    ];
    const tried = new Set();
    let best = "";
    let bestScore = -1;
    for (const candidateRaw of candidates) {
      const candidate = normalizeCharsetName(candidateRaw);
      if (!candidate || tried.has(candidate)) continue;
      tried.add(candidate);
      const decoded = decodeBufferWithCharset(buffer, candidate);
      if (!decoded) continue;
      const score = scoreDecodedHtml(decoded);
      if (score > bestScore) {
        best = decoded;
        bestScore = score;
      }
      if (score >= 1000) break;
    }
    if (best) return best;
    return buffer.toString("utf8");
  });
}

function parseCharsetFromContentType(contentType) {
  const match = String(contentType ?? "").match(/charset\s*=\s*["']?\s*([^;"'\s]+)/i);
  return match ? match[1].trim() : "";
}

function parseCharsetFromHtmlProbe(htmlProbe) {
  const metaCharset = htmlProbe.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'>\s]+)/i);
  if (metaCharset?.[1]) return metaCharset[1].trim();
  const metaContentType = htmlProbe.match(
    /<meta[^>]+http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset=([^"'>\s;]+)/i
  );
  return metaContentType?.[1] ? metaContentType[1].trim() : "";
}

function normalizeCharsetName(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "";
  if (value === "utf8") return "utf-8";
  if (value === "cp1251" || value === "windows1251") return "windows-1251";
  if (value === "win-1251") return "windows-1251";
  return value;
}

function decodeBufferWithCharset(buffer, charset) {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    if (charset === "utf-8") {
      return buffer.toString("utf8");
    }
    return "";
  }
}

function scoreDecodedHtml(text) {
  if (!text) return -1;
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  const hasHtml = /<html|<meta|<title|<body/i.test(text) ? 1 : 0;
  const hasCyrillic = /[\u0400-\u04FF]/.test(text) ? 1 : 0;
  if (replacementCount === 0 && hasHtml) {
    return 1000 + hasCyrillic;
  }
  return hasHtml * 10 + hasCyrillic - replacementCount * 3;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtml(match[1].trim()) : "";
}

function extractMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
    "i"
  );
  const match = html.match(direct) || html.match(reversed);
  return match ? decodeHtml(match[1].trim()) : "";
}

function extractLinkRel(html, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(
    `<link[^>]+rel=["']${escaped}["'][^>]*href=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const reversed = new RegExp(
    `<link[^>]+href=["']([^"']+)["'][^>]*rel=["']${escaped}["'][^>]*>`,
    "i"
  );
  const match = html.match(direct) || html.match(reversed);
  return match ? decodeHtml(match[1].trim()) : "";
}

function getYouTubeId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const match = url.pathname.match(/\/embed\/([^/?#]+)/);
      if (match) return match[1];
    }
  } catch {
    return null;
  }
  return null;
}

function getTweetId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const match = url.pathname.match(/status\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isVkUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
    return host === "vk.com" || host.endsWith(".vk.com");
  } catch {
    return false;
  }
}

function isVkAntiBotTitle(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("\u0432\u0430\u0448 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0443\u0441\u0442\u0430\u0440\u0435\u043b") ||
    text.includes("browser is outdated") ||
    text.includes("security check") ||
    text.includes("\u043f\u043e\u0434\u043e\u0437\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c")
  );
}

async function fetchXPreview(url, tweetId, controller) {
  const tweetDataRaw = await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}`, controller);
  const tweetData = isUsefulTweetData(tweetDataRaw) ? tweetDataRaw : null;
  if (tweetData) {
    const media = Array.isArray(tweetData.mediaDetails) ? tweetData.mediaDetails[0] : null;
    const imageUrl = media?.media_url_https || media?.media_url || "";
    const image = toProxyImageUrl(imageUrl);
    const author = tweetData.user?.name || "";
    return {
      url,
      title: tweetData.text ? truncateText(tweetData.text, 200) : "",
      description: "",
      image,
      siteName: author ? `X - ${author}` : "X"
    };
  }

  const oembed = await fetchJson(
    `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`,
    controller
  );
  if (oembed) {
    const textFromHtml = stripHtml(String(oembed.html ?? ""));
    const fallbackText = textFromHtml || String(oembed.title ?? "").trim();
    const author = String(oembed.author_name ?? "").trim();
    return {
      url,
      title: fallbackText ? truncateText(fallbackText, 200) : "",
      description: "",
      image: "",
      siteName: author ? `X - ${author}` : "X"
    };
  }

  return null;
}

function isUsefulTweetData(tweetData) {
  if (!tweetData || typeof tweetData !== "object") return false;
  const hasText = typeof tweetData.text === "string" && tweetData.text.trim().length > 0;
  const hasMedia = Array.isArray(tweetData.mediaDetails) && tweetData.mediaDetails.length > 0;
  const hasAuthor = typeof tweetData.user?.name === "string" && tweetData.user.name.trim().length > 0;
  return hasText || hasMedia || hasAuthor;
}

async function fetchVkBotPreview(url, controller) {
  const userAgents = [
    "TelegramBot (like TwitterBot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
  ];

  for (const userAgent of userAgents) {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
          "user-agent": userAgent
        }
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) continue;

      const html = await decodeHtmlResponse(response);
      const head = html.slice(0, 200000);
      const ogTitle = extractMeta(head, "og:title");
      const title = (ogTitle || extractTitle(head) || "").trim();
      if (isVkAntiBotTitle(title)) continue;

      const description = (
        extractMeta(head, "og:description") ||
        extractMeta(head, "description") ||
        ""
      ).trim();

      const imageRaw =
        extractMeta(head, "og:image:secure_url") ||
        extractMeta(head, "og:image") ||
        extractMeta(head, "og:image:url") ||
        extractMeta(head, "twitter:image") ||
        extractMeta(head, "twitter:image:src") ||
        extractLinkRel(head, "image_src");

      const imageUrl = imageRaw ? safeAbsoluteUrl(imageRaw, url) : "";
      const image = toProxyImageUrl(imageUrl);

      if (!title && !description && !image) continue;

      const siteName = extractMeta(head, "og:site_name") || "VK";
      return {
        url,
        title,
        description,
        image,
        siteName
      };
    } catch {
      // try next user-agent
    }
  }

  return null;
}

async function fetchVkOembedPreview(url, controller) {
  const oembed = await fetchJson(`https://vk.com/oembed.php?url=${encodeURIComponent(url)}`, controller);
  if (!oembed || oembed.error) return null;
  const image = toProxyImageUrl(String(oembed.thumbnail_url ?? "").trim());
  const title = String(oembed.title ?? "").trim();
  const author = String(oembed.author_name ?? "").trim();
  return {
    url,
    title,
    description: author,
    image,
    siteName: String(oembed.provider_name ?? "VK").trim() || "VK"
  };
}

function stripHtml(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchJson(url, controller) {
  const response = await fetch(url, {
    signal: controller?.signal,
    redirect: "follow",
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function truncateText(text, limit) {
  const value = String(text ?? "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}...`;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeAbsoluteUrl(raw, base) {
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
}

function mergeSegmentsWithHistory(newSegments = [], oldSegments = [], oldDecisions = []) {
  const oldSegmentsFiltered = oldSegments.filter((segment) => segment?.block_type !== "links");
  if (!oldSegmentsFiltered.length) {
    return {
      mergedSegments: newSegments.map((segment) => ({ ...segment, segment_status: null })),
      decisionsOverride: null
    };
  }

  const decisionMap = new Map(oldDecisions.map((item) => [String(item.segment_id ?? ""), item]));
  const oldMeta = oldSegmentsFiltered.map((segment, index) => ({
    segment,
    index,
    normalized: normalizeTextForMatch(segment.text_quote),
    tokens: tokenizeForMatch(segment.text_quote),
    sectionKey: getSectionMatchKey(segment)
  }));
  const oldBySection = new Map();
  oldMeta.forEach((item) => {
    if (!item.sectionKey) return;
    if (!oldBySection.has(item.sectionKey)) oldBySection.set(item.sectionKey, []);
    oldBySection.get(item.sectionKey).push(item);
  });
  const customMeta = oldMeta.filter((item) => isCustomSubSegmentId(item.segment.segment_id));
  const normalizedIndex = buildNormalizedIndex(oldSegmentsFiltered);
  const usedOldIds = new Set();
  const usedIds = new Set();
  const counters = new Map();

  const matched = [];
  newSegments.forEach((segment) => {
    const normalized = normalizeTextForMatch(segment.text_quote);
    const tokens = tokenizeForMatch(segment.text_quote);
    const sectionKey = getSectionMatchKey(segment);
    const scopedCandidates = sectionKey ? oldBySection.get(sectionKey) ?? [] : [];

    const splitCandidates = pickCustomSplitCandidates({
      segment,
      normalized,
      customMeta,
      usedOldIds,
      sectionKey
    });
    if (splitCandidates.length > 0) {
      splitCandidates.forEach((item) => {
        const segmentId = String(item.segment.segment_id ?? "").trim();
        if (!segmentId || usedIds.has(segmentId)) return;
        usedOldIds.add(segmentId);
        usedIds.add(segmentId);
        matched.push({
          segment: {
            ...item.segment,
            segment_status: "same"
          },
          matchedId: segmentId
        });
      });
      return;
    }

    const scopedIds = scopedCandidates.length
      ? new Set(scopedCandidates.map((item) => String(item.segment.segment_id ?? "")))
      : null;
    let matchedId = null;
    let status = "new";

    const exact = takeExactMatch(normalizedIndex, normalized, usedOldIds, scopedIds) ??
      takeExactMatch(normalizedIndex, normalized, usedOldIds);
    if (exact) {
      matchedId = exact.segment.segment_id;
      status = "same";
      usedOldIds.add(matchedId);
    } else {
      const scopedFuzzy = findBestFuzzyMatch({
        segment,
        normalized,
        tokens,
        sectionKey,
        candidates: scopedCandidates,
        usedOldIds,
        minScore: 0.48
      });
      const globalFuzzy =
        scopedFuzzy ??
        findBestFuzzyMatch({
          segment,
          normalized,
          tokens,
          sectionKey,
          candidates: oldMeta,
          usedOldIds,
          minScore: 0.67
        });
      if (globalFuzzy) {
        matchedId = globalFuzzy.segment.segment_id;
        status = "changed";
        usedOldIds.add(matchedId);
      }
    }

    let nextId = matchedId;
    if (nextId && usedIds.has(nextId)) {
      nextId = null;
      status = "new";
    }
    if (!nextId) {
      nextId = ensureUniqueSegmentId(segment, usedIds, counters);
    } else {
      usedIds.add(nextId);
    }

    matched.push({
      segment: { ...segment, segment_id: nextId, segment_status: status },
      matchedId
    });
  });

  const preservedManual = collectPreservedManualSegments({
    oldMeta,
    usedOldIds,
    usedIds,
    newSegments,
    oldBySection
  });
  const mergedSegments = [...matched.map((item) => item.segment), ...preservedManual.map((item) => item.segment)];
  const decisionsOverride = matched.map((item) => {
    const sourceId = item.matchedId ? String(item.matchedId) : String(item.segment.segment_id);
    const existing = decisionMap.get(sourceId);
    return {
      segment_id: item.segment.segment_id,
      visual_decision: existing?.visual_decision ?? emptyVisualDecision(),
      search_decision: existing?.search_decision ?? emptySearchDecision(),
      search_decision_en: existing?.search_decision_en ?? emptySearchDecision()
    };
  });
  preservedManual.forEach((item) => {
    const sourceId = String(item.sourceId ?? item.segment.segment_id);
    const existing = decisionMap.get(sourceId);
    decisionsOverride.push({
      segment_id: item.segment.segment_id,
      visual_decision: existing?.visual_decision ?? emptyVisualDecision(),
      search_decision: existing?.search_decision ?? emptySearchDecision(),
      search_decision_en: existing?.search_decision_en ?? emptySearchDecision()
    });
  });

  return { mergedSegments, decisionsOverride };
}

function buildNormalizedIndex(segments) {
  const map = new Map();
  segments.forEach((segment, index) => {
    const key = normalizeTextForMatch(segment.text_quote);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ segment, index });
  });
  return map;
}

function takeExactMatch(index, key, usedOldIds, candidateIds = null) {
  if (!key) return null;
  const list = index.get(key);
  if (!list) return null;
  for (const item of list) {
    const segmentId = String(item.segment.segment_id ?? "");
    if (candidateIds && !candidateIds.has(segmentId)) continue;
    if (!usedOldIds.has(segmentId)) {
      return item;
    }
  }
  return null;
}

function getSectionMatchKey(segment) {
  const title = normalizeSectionTitleForMatch(segment?.section_title ?? "");
  if (title) return `title:${title}`;
  const rawId = String(segment?.section_id ?? "").trim().toLowerCase();
  if (!rawId) return "";
  if (/^section_\d+$/i.test(rawId)) return "";
  return `id:${rawId}`;
}

function normalizeSectionTitleForMatch(title) {
  const cleaned = String(title ?? "").replace(/\(\s*\d+\s*\)\s*$/g, " ");
  return normalizeTextForMatch(cleaned);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function secondsToFrames(seconds, fps) {
  const duration = Number(seconds);
  const rate = Number(fps);
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  if (!Number.isFinite(rate) || rate <= 0) return Math.max(1, Math.round(duration * 50));
  return Math.max(1, Math.round(duration * rate));
}

function secondsToFramesAllowZero(seconds, fps) {
  const duration = Number(seconds);
  const rate = Number(fps);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return Math.max(0, Math.round(duration * 50));
  return Math.max(0, Math.round(duration * rate));
}

function parseXmlStartTimecodeToSeconds(value, fps) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  const normalizedRaw = raw.replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(normalizedRaw)) {
    const numeric = Number(normalizedRaw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  const parts = raw.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) return 0;
  if (parts.some((part) => !/^\d+(?:[.,]\d+)?$/.test(part))) return 0;
  const nums = parts.map((part) => Number(part.replace(",", ".")));
  if (nums.some((num) => !Number.isFinite(num) || num < 0)) return 0;

  const rate = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : XML_EXPORT_FPS;
  if (parts.length === 2) {
    const [mm, ss] = nums;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = nums;
    return hh * 3600 + mm * 60 + ss;
  }
  const [hh, mm, ss, ff] = nums;
  return hh * 3600 + mm * 60 + ss + ff / rate;
}

function detectXmlMediaCategory(filePath) {
  const ext = String(path.extname(filePath ?? "")).toLowerCase();
  if (XML_AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (XML_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (XML_VIDEO_EXTENSIONS.has(ext)) return "video";
  return "video";
}

function normalizeXmlDurationSeconds(rawValue, fallbackValue, category) {
  const parsed = Number(rawValue);
  const fallback = Number.isFinite(Number(fallbackValue)) ? Math.max(0.2, Number(fallbackValue)) : 5;
  let duration = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  if (category === "image") {
    duration = Math.max(5, duration);
  }
  return duration;
}

function getXmlFfprobeCandidates() {
  if (Array.isArray(XML_FFPROBE_CANDIDATES)) return XML_FFPROBE_CANDIDATES;
  const list = [];
  const push = (value) => {
    const item = String(value ?? "").trim();
    if (!item) return;
    if (!list.includes(item)) list.push(item);
  };

  push(process.env.MEDIA_FFPROBE_PATH);

  const ffmpegLocation = String(downloaderTools?.ffmpegLocation ?? "").trim();
  if (ffmpegLocation) {
    const base = path.basename(ffmpegLocation).toLowerCase();
    if (base.startsWith("ffprobe")) {
      push(ffmpegLocation);
    } else {
      push(path.join(ffmpegLocation, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"));
    }
  }

  push(process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  XML_FFPROBE_CANDIDATES = list;
  return list;
}

async function probeXmlMediaInfo(filePath) {
  const absolute = path.resolve(String(filePath ?? ""));
  if (!absolute) return null;
  const cacheKey = absolute.toLowerCase();
  if (XML_MEDIA_INFO_CACHE.has(cacheKey)) return XML_MEDIA_INFO_CACHE.get(cacheKey);

  const args = [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height",
    "-of",
    "json",
    absolute
  ];

  for (const executable of getXmlFfprobeCandidates()) {
    try {
      const { stdout } = await execFileAsync(executable, args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const payload = JSON.parse(String(stdout ?? "{}"));
      const streams = Array.isArray(payload?.streams) ? payload.streams : [];
      let hasVideo = false;
      let hasAudio = false;
      let width = null;
      let height = null;

      for (const stream of streams) {
        const codecType = String(stream?.codec_type ?? "").toLowerCase();
        if (codecType === "video") {
          hasVideo = true;
          if (width == null || height == null) {
            const w = Number(stream?.width);
            const h = Number(stream?.height);
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
              width = Math.round(w);
              height = Math.round(h);
            }
          }
        } else if (codecType === "audio") {
          hasAudio = true;
        }
      }

      const result = {
        hasVideo,
        hasAudio,
        sourceDimensions:
          Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
            ? { width, height }
            : null
      };
      XML_MEDIA_INFO_CACHE.set(cacheKey, result);
      XML_DIMENSIONS_CACHE.set(cacheKey, result.sourceDimensions ?? null);
      return result;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      break;
    }
  }

  XML_MEDIA_INFO_CACHE.set(cacheKey, null);
  if (!XML_DIMENSIONS_CACHE.has(cacheKey)) {
    XML_DIMENSIONS_CACHE.set(cacheKey, null);
  }
  return null;
}

async function getXmlMediaInfo(filePath, hintedCategory) {
  const absolute = path.resolve(String(filePath ?? ""));
  if (!absolute) {
    return {
      category: hintedCategory,
      hasAudio: hintedCategory === "audio",
      hasVideo: hintedCategory !== "audio",
      sourceDimensions: null
    };
  }

  if (hintedCategory === "image") {
    const info = await probeXmlMediaInfo(absolute);
    return {
      category: "image",
      hasAudio: false,
      hasVideo: true,
      sourceDimensions: info?.sourceDimensions ?? null
    };
  }

  const info = await probeXmlMediaInfo(absolute);
  if (!info) {
    return {
      category: hintedCategory,
      hasAudio: hintedCategory === "audio",
      hasVideo: hintedCategory !== "audio",
      sourceDimensions: XML_DIMENSIONS_CACHE.get(absolute.toLowerCase()) ?? null
    };
  }

  if (info.hasVideo && info.hasAudio) {
    return {
      category: hintedCategory === "image" ? "image" : "video",
      hasAudio: true,
      hasVideo: true,
      sourceDimensions: info.sourceDimensions ?? null
    };
  }
  if (info.hasVideo && !info.hasAudio) {
    return {
      category: hintedCategory === "image" ? "image" : "video",
      hasAudio: false,
      hasVideo: true,
      sourceDimensions: info.sourceDimensions ?? null
    };
  }
  if (!info.hasVideo && info.hasAudio) {
    return {
      category: "audio",
      hasAudio: true,
      hasVideo: false,
      sourceDimensions: null
    };
  }
  return {
    category: hintedCategory,
    hasAudio: hintedCategory === "audio",
    hasVideo: hintedCategory !== "audio",
    sourceDimensions: info.sourceDimensions ?? null
  };
}

function toSafeXmlFileNamePart(value, fallback = "export") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const clipped = normalized.slice(0, 64);
  return clipped || fallback;
}

function transliterateRuForFileName(value) {
  const table = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };
  return String(value ?? "")
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      if (!(lower in table)) return char;
      const translit = table[lower];
      return char === lower ? translit : translit.charAt(0).toUpperCase() + translit.slice(1);
    })
    .join("");
}

function sanitizeRawExportFileNamePart(value, fallback = "export") {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function formatXmlExportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function buildXmlExportFileName({ documentId, sectionId, sectionTitle }) {
  const timestamp = formatXmlExportTimestamp();
  const rawSection = String(sectionTitle || sectionId || "").trim();
  if (rawSection) {
    const sectionBase = sanitizeRawExportFileNamePart(rawSection, "Тема");
    return `${sectionBase} - ${timestamp}.xml`;
  }
  return `UT - ${timestamp}.xml`;
}

function buildXmlSequenceName({ document, sectionId, sectionTitle }) {
  const docName = String(document?.id ?? "document").trim() || "document";
  const sectionName = String(sectionTitle ?? "").trim() || String(sectionId ?? "").trim();
  return sectionName ? `${docName} - ${sectionName}` : docName;
}

function getXmlSectionMarkerName(segment) {
  const title = String(segment?.section_title ?? "").trim();
  if (title) return title;
  const sectionId = String(segment?.section_id ?? "").trim();
  if (sectionId) return sectionId;
  return "Без темы";
}

function getXmlSectionMarkerKey(segment) {
  const titleKey = normalizeSectionTitleForMatch(segment?.section_title ?? "");
  if (titleKey) return `title:${titleKey}`;
  const sectionId = String(segment?.section_id ?? "").trim().toLowerCase();
  if (sectionId) return `id:${sectionId}`;
  return "section:unknown";
}

function buildContentDisposition(fileName) {
  const raw = String(fileName ?? "").trim();
  const extRaw = path.extname(raw).toLowerCase();
  const ext = [".xml", ".md", ".jsonl"].includes(extRaw) ? extRaw : ".xml";
  const baseRaw = extRaw ? raw.slice(0, -extRaw.length) : raw;
  const utfBase = sanitizeRawExportFileNamePart(baseRaw, "export");
  const utfName = `${utfBase}${ext}`;
  const fallbackBase = toSafeXmlFileNamePart(transliterateRuForFileName(utfBase), "export");
  const fallbackName = `${fallbackBase}${ext}`;
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(utfName)}`;
}

function formatXmlNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  if (Math.abs(numeric - Math.round(numeric)) < 0.0001) return String(Math.round(numeric));
  return numeric.toFixed(4).replace(/\.?0+$/, "");
}

function pickXmlMotionTemplate(sourceDimensions) {
  if (!sourceDimensions) return XML_DEFAULT_MOTION_TEMPLATE;
  return XML_BASIC_MOTION_TEMPLATES.get(`${sourceDimensions.width}x${sourceDimensions.height}`) ?? XML_DEFAULT_MOTION_TEMPLATE;
}

function resolveXmlMotionScale(sourceDimensions) {
  if (sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.width === sourceDimensions.height) {
    const squareScale = (960 / sourceDimensions.width) * 100;
    const normalized = Number.isFinite(squareScale) ? Number(squareScale.toFixed(1)) : 100;
    return Math.max(5, Math.min(400, normalized));
  }

  if (sourceDimensions && sourceDimensions.width === 3840) {
    return 45;
  }

  const template = pickXmlMotionTemplate(sourceDimensions);
  let scale = Number(template.scale ?? XML_DEFAULT_MOTION_TEMPLATE.scale);
  if (
    sourceDimensions &&
    !XML_BASIC_MOTION_TEMPLATES.has(`${sourceDimensions.width}x${sourceDimensions.height}`) &&
    sourceDimensions.width === 1920 &&
    sourceDimensions.height !== 1080
  ) {
    scale = 90;
  } else if (
    sourceDimensions &&
    !XML_BASIC_MOTION_TEMPLATES.has(`${sourceDimensions.width}x${sourceDimensions.height}`) &&
    XML_WIDTH_SCALE_OVERRIDES.has(sourceDimensions.width)
  ) {
    scale = Number(XML_WIDTH_SCALE_OVERRIDES.get(sourceDimensions.width));
  }
  return Number.isFinite(scale) && scale > 0 ? scale : 100;
}

function resolveXmlMotionCenterPx({ category, sourceDimensions, scale }) {
  if (sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.width === sourceDimensions.height) {
    const centerNorm = -scale / 200;
    const centerX = centerNorm * (XML_SEQUENCE_WIDTH / 2) + XML_SEQUENCE_WIDTH / 2;
    return { x: centerX, y: XML_DEFAULT_CENTER.y };
  }

  const template = pickXmlMotionTemplate(sourceDimensions);
  if (template?.center && Number.isFinite(template.center.x) && Number.isFinite(template.center.y)) {
    return template.center;
  }
  return XML_DEFAULT_CENTER;
}

function encodeXmlMotionCenter(centerPx) {
  const halfW = XML_SEQUENCE_WIDTH / 2;
  const halfH = XML_SEQUENCE_HEIGHT / 2;
  const x = (Number(centerPx?.x ?? XML_DEFAULT_CENTER.x) - halfW) / halfW;
  const y = (Number(centerPx?.y ?? XML_DEFAULT_CENTER.y) - halfH) / halfH;
  return { x, y };
}

function renderXmlBasicMotionFilter(clip) {
  const scale = formatXmlNumber(clip.motion.scale);
  const centerX = formatXmlNumber(clip.motion.center.x);
  const centerY = formatXmlNumber(clip.motion.center.y);

  return [
    "            <filter>",
    "              <effect>",
    "                <name>Basic Motion</name>",
    "                <effectid>basic</effectid>",
    "                <effectcategory>motion</effectcategory>",
    "                <effecttype>motion</effecttype>",
    "                <mediatype>video</mediatype>",
    "                <pproBypass>false</pproBypass>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>scale</parameterid>",
    "                  <name>Scale</name>",
    "                  <valuemin>0</valuemin>",
    "                  <valuemax>1000</valuemax>",
    `                  <value>${scale}</value>`,
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>rotation</parameterid>",
    "                  <name>Rotation</name>",
    "                  <valuemin>-8640</valuemin>",
    "                  <valuemax>8640</valuemax>",
    "                  <value>0</value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>center</parameterid>",
    "                  <name>Center</name>",
    "                  <value>",
    `                    <horiz>${centerX}</horiz>`,
    `                    <vert>${centerY}</vert>`,
    "                  </value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>centerOffset</parameterid>",
    "                  <name>Anchor Point</name>",
    "                  <value>",
    "                    <horiz>0</horiz>",
    "                    <vert>0</vert>",
    "                  </value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>antiflicker</parameterid>",
    "                  <name>Anti-flicker Filter</name>",
    "                  <valuemin>0.0</valuemin>",
    "                  <valuemax>1.0</valuemax>",
    "                  <value>0</value>",
    "                </parameter>",
    "              </effect>",
    "            </filter>"
  ];
}

function renderXmlLinkBlock({ targetClipId, mediaType, trackIndex, clipIndex, groupIndex = null }) {
  const lines = [
    "            <link>",
    `              <linkclipref>${escapeXml(targetClipId)}</linkclipref>`,
    `              <mediatype>${mediaType}</mediatype>`,
    `              <trackindex>${trackIndex}</trackindex>`,
    `              <clipindex>${clipIndex}</clipindex>`
  ];
  if (groupIndex != null) {
    lines.push(`              <groupindex>${groupIndex}</groupindex>`);
  }
  lines.push("            </link>");
  return lines;
}

function renderXmlFileElement({ clip, fps, includeVideo, includeAudio }) {
  const sourceWidth = Number(clip?.sourceDimensions?.width);
  const sourceHeight = Number(clip?.sourceDimensions?.height);
  const fileDurationFrames = Math.max(
    Number(clip?.durationFrames) || 0,
    Number(clip?.sourceOutFrame) || 0,
    1
  );
  const lines = [
    `            <file id="${escapeXml(clip.entry.fileId)}">`,
    `              <name>${escapeXml(clip.fileName)}</name>`,
    `              <pathurl>${escapeXml(clip.pathUrl)}</pathurl>`,
    "              <rate>",
    `                <timebase>${fps}</timebase>`,
    "                <ntsc>FALSE</ntsc>",
    "              </rate>",
    `              <duration>${fileDurationFrames}</duration>`,
    "              <timecode>",
    "                <rate>",
    `                  <timebase>${fps}</timebase>`,
    "                  <ntsc>FALSE</ntsc>",
    "                </rate>",
    "                <string>00:00:00:00</string>",
    "                <frame>0</frame>",
    "                <displayformat>NDF</displayformat>",
    "              </timecode>",
    "              <media>"
  ];

  if (includeVideo) {
    lines.push(
      "                <video>",
      "                  <samplecharacteristics>",
      "                    <rate>",
      `                      <timebase>${fps}</timebase>`,
      "                      <ntsc>FALSE</ntsc>",
      "                    </rate>",
      `                    <width>${Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : XML_SEQUENCE_WIDTH}</width>`,
      `                    <height>${Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : XML_SEQUENCE_HEIGHT}</height>`,
      "                    <anamorphic>FALSE</anamorphic>",
      "                    <pixelaspectratio>square</pixelaspectratio>",
      "                    <fielddominance>none</fielddominance>",
      "                  </samplecharacteristics>",
      "                </video>"
    );
  }

  if (includeAudio) {
    lines.push(
      "                <audio>",
      "                  <samplecharacteristics>",
      "                    <depth>16</depth>",
      "                    <samplerate>48000</samplerate>",
      "                  </samplecharacteristics>",
      "                  <channelcount>2</channelcount>",
      "                </audio>"
    );
  }

  lines.push("              </media>", "            </file>");
  return lines;
}

function renderXmlVideoClipItem({ clip, fps, audioPeer }) {
  const sourceInFrame = Math.max(0, Math.round(Number(clip?.sourceInFrame) || 0));
  const sourceOutFrame = Math.max(sourceInFrame, Math.round(Number(clip?.sourceOutFrame) || 0));
  const lines = [
    `          <clipitem id="${escapeXml(clip.clipId)}">`,
    `            <masterclipid>${escapeXml(clip.entry.masterClipId)}</masterclipid>`,
    `            <name>${escapeXml(clip.fileName)}</name>`,
    "            <enabled>TRUE</enabled>",
    `            <duration>${clip.durationFrames}</duration>`,
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <start>${clip.startFrame}</start>`,
    `            <end>${clip.endFrame}</end>`,
    `            <in>${sourceInFrame}</in>`,
    `            <out>${sourceOutFrame}</out>`,
    `            <alphatype>${clip.category === "image" ? "straight" : "none"}</alphatype>`,
    "            <pixelaspectratio>square</pixelaspectratio>",
    "            <anamorphic>FALSE</anamorphic>"
  ];

  lines.push(
    ...renderXmlFileElement({
      clip,
      fps,
      includeVideo: true,
      includeAudio: Boolean(clip.hasAudio)
    })
  );

  lines.push(...renderXmlBasicMotionFilter(clip));
  lines.push(...renderXmlLinkBlock({
    targetClipId: clip.clipId,
    mediaType: "video",
    trackIndex: 1,
    clipIndex: clip.clipIndex
  }));

  if (audioPeer) {
    lines.push(...renderXmlLinkBlock({
      targetClipId: audioPeer.clipId,
      mediaType: "audio",
      trackIndex: 1,
      clipIndex: audioPeer.clipIndex,
      groupIndex: 1
    }));
  }

  lines.push("          </clipitem>");
  return lines;
}

function renderXmlAudioClipItem({ clip, fps, videoPeer }) {
  const sourceInFrame = Math.max(0, Math.round(Number(clip?.sourceInFrame) || 0));
  const sourceOutFrame = Math.max(sourceInFrame, Math.round(Number(clip?.sourceOutFrame) || 0));
  const lines = [
    `          <clipitem id="${escapeXml(clip.clipId)}" premiereChannelType="stereo">`,
    `            <masterclipid>${escapeXml(clip.entry.masterClipId)}</masterclipid>`,
    `            <name>${escapeXml(clip.fileName)}</name>`,
    "            <enabled>TRUE</enabled>",
    `            <duration>${clip.durationFrames}</duration>`,
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <start>${clip.startFrame}</start>`,
    `            <end>${clip.endFrame}</end>`,
    `            <in>${sourceInFrame}</in>`,
    `            <out>${sourceOutFrame}</out>`
  ];

  if (videoPeer) {
    lines.push(`            <file id="${escapeXml(clip.entry.fileId)}"/>`);
  } else {
    lines.push(
      ...renderXmlFileElement({
        clip,
        fps,
        includeVideo: false,
        includeAudio: true
      })
    );
  }

  lines.push(
    "            <sourcetrack>",
    "              <mediatype>audio</mediatype>",
    "              <trackindex>1</trackindex>",
    "            </sourcetrack>",
    ...renderXmlLinkBlock({
      targetClipId: clip.clipId,
      mediaType: "audio",
      trackIndex: 1,
      clipIndex: clip.clipIndex
    })
  );

  if (videoPeer) {
    lines.push(...renderXmlLinkBlock({
      targetClipId: videoPeer.clipId,
      mediaType: "video",
      trackIndex: 1,
      clipIndex: videoPeer.clipIndex,
      groupIndex: 1
    }));
  }

  lines.push("          </clipitem>");
  return lines;
}

function renderXmlSequenceMarker({ name, inFrame, outFrame }) {
  const markerIn = Math.max(0, Math.round(Number(inFrame) || 0));
  const markerOut = Math.max(markerIn, Math.round(Number(outFrame) || markerIn));
  return [
    "    <marker>",
    "      <comment></comment>",
    `      <name>${escapeXml(name || "Тема")}</name>`,
    `      <in>${markerIn}</in>`,
    `      <out>${markerOut}</out>`,
    `      <pproColor>${XML_SECTION_MARKER_COLOR}</pproColor>`,
    "    </marker>"
  ];
}

function buildXmemlTimeline({ sequenceName, fps, totalFrames, videoClips, audioClips, sectionMarkers = [] }) {
  const audioByEntryId = new Map(audioClips.map((clip) => [clip.entry.entryId, clip]));
  const videoByEntryId = new Map(videoClips.map((clip) => [clip.entry.entryId, clip]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    "    <uuid>00000000-0000-0000-0000-000000000000</uuid>",
    `    <name>${escapeXml(sequenceName)}</name>`,
    `    <duration>${Math.max(1, totalFrames)}</duration>`,
    "    <rate>",
    `      <timebase>${fps}</timebase>`,
    "      <ntsc>FALSE</ntsc>",
    "    </rate>",
    "    <media>",
    "      <video>",
    "        <format>",
    "          <samplecharacteristics>",
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <width>${XML_SEQUENCE_WIDTH}</width>`,
    `            <height>${XML_SEQUENCE_HEIGHT}</height>`,
    "            <anamorphic>FALSE</anamorphic>",
    "            <pixelaspectratio>square</pixelaspectratio>",
    "            <fielddominance>none</fielddominance>",
    "            <colordepth>24</colordepth>",
    "          </samplecharacteristics>",
    "        </format>",
    "        <track>",
    "          <enabled>TRUE</enabled>",
    "          <locked>FALSE</locked>"
  ];

  videoClips.forEach((clip) => {
    lines.push(...renderXmlVideoClipItem({
      clip,
      fps,
      audioPeer: audioByEntryId.get(clip.entry.entryId) ?? null
    }));
  });

  lines.push(
    "        </track>",
    "      </video>",
    "      <audio>",
    "        <numOutputChannels>2</numOutputChannels>",
    "        <format>",
    "          <samplecharacteristics>",
    "            <depth>16</depth>",
    "            <samplerate>48000</samplerate>",
    "          </samplecharacteristics>",
    "        </format>",
    "        <outputs>",
    "          <group>",
    "            <index>1</index>",
    "            <numchannels>1</numchannels>",
    "            <downmix>0</downmix>",
    "            <channel>",
    "              <index>1</index>",
    "            </channel>",
    "          </group>",
    "          <group>",
    "            <index>2</index>",
    "            <numchannels>1</numchannels>",
    "            <downmix>0</downmix>",
    "            <channel>",
    "              <index>2</index>",
    "            </channel>",
    "          </group>",
    "        </outputs>",
    "        <track>",
    "          <enabled>TRUE</enabled>",
    "          <locked>FALSE</locked>",
    "          <outputchannelindex>1</outputchannelindex>"
  );

  audioClips.forEach((clip) => {
    lines.push(...renderXmlAudioClipItem({
      clip,
      fps,
      videoPeer: videoByEntryId.get(clip.entry.entryId) ?? null
    }));
  });

  lines.push(
    "        </track>",
    "      </audio>",
    "    </media>",
  );

  sectionMarkers.forEach((marker) => {
    lines.push(...renderXmlSequenceMarker(marker));
  });

  lines.push(
    "    <timecode>",
    "      <rate>",
    `        <timebase>${fps}</timebase>`,
    "        <ntsc>FALSE</ntsc>",
    "      </rate>",
    "      <string>00:00:00:00</string>",
    "      <frame>0</frame>",
    "      <displayformat>NDF</displayformat>",
    "    </timecode>",
    "  </sequence>",
    "</xmeml>",
    ""
  );

  return lines.join("\n");
}

async function buildXmlExportPayload({
  document,
  segments,
  decisionsBySegment,
  mediaDir,
  fps,
  defaultDurationSec,
  sectionId,
  sectionTitle
}) {
  const fpsValue = Number.isFinite(Number(fps)) ? Math.max(1, Math.round(Number(fps))) : XML_EXPORT_FPS;
  const fallbackDuration = Number.isFinite(Number(defaultDurationSec))
    ? Math.max(0.2, Number(defaultDurationSec))
    : XML_EXPORT_DEFAULT_DURATION_SEC;
  const mediaRoot = path.resolve(String(mediaDir ?? getMediaDir()));
  const exportFileName = buildXmlExportFileName({
    documentId: document?.id ?? "document",
    sectionId,
    sectionTitle
  });

  const markerDurationFrames = secondsToFrames(XML_SECTION_MARKER_DURATION_SEC, fpsValue);
  const sectionGapFrames = XML_SECTION_GAP_SEC > 0 ? secondsToFrames(XML_SECTION_GAP_SEC, fpsValue) : 0;
  const sectionMarkers = [];
  const mediaEntries = [];
  let frameCursor = 0;
  let activeSectionKey = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentId = String(segment?.segment_id ?? "").trim();

    const sectionKey = getXmlSectionMarkerKey(segment);
    if (sectionKey !== activeSectionKey) {
      if (activeSectionKey && sectionGapFrames > 0) {
        frameCursor += sectionGapFrames;
      }
      sectionMarkers.push({
        name: getXmlSectionMarkerName(segment),
        inFrame: frameCursor,
        outFrame: frameCursor + markerDurationFrames
      });
      activeSectionKey = sectionKey;
    }

    const decision = segmentId ? decisionsBySegment.get(segmentId) ?? {} : {};
    const visual = normalizeVisualDecisionInput(decision.visual ?? decision.visual_decision ?? null);
    const mediaPath = normalizeMediaFilePath(visual.media_file_path ?? null);
    let absolutePath = "";
    if (mediaPath) {
      absolutePath = safeResolveMediaPath(mediaRoot, mediaPath);
      if (absolutePath) {
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (!stats || !stats.isFile()) {
          absolutePath = "";
        }
      }
    }

    if (!absolutePath) {
      const gapDurationSec = normalizeXmlDurationSeconds(visual.duration_hint_sec, fallbackDuration, "video");
      const gapFrames = secondsToFrames(gapDurationSec, fpsValue);
      frameCursor += gapFrames;
      continue;
    }

    const hintedCategory = detectXmlMediaCategory(absolutePath);
    const mediaInfo = await getXmlMediaInfo(absolutePath, hintedCategory);
    const category = mediaInfo.category;
    const durationSec = normalizeXmlDurationSeconds(visual.duration_hint_sec, fallbackDuration, category);
    const durationFrames = secondsToFrames(durationSec, fpsValue);
    const sourceStartSec = category === "video"
      ? parseXmlStartTimecodeToSeconds(visual.media_start_timecode, fpsValue)
      : 0;
    const sourceInFrame = secondsToFramesAllowZero(sourceStartSec, fpsValue);
    const sourceOutFrame = sourceInFrame + durationFrames;
    const sourceDimensions = mediaInfo.sourceDimensions;
    const motionScale = resolveXmlMotionScale(sourceDimensions);
    const motionCenterPx = resolveXmlMotionCenterPx({
      category,
      sourceDimensions,
      scale: motionScale
    });
    const motionCenter = encodeXmlMotionCenter(motionCenterPx);
    const mediaIndex = mediaEntries.length + 1;
    const startFrame = frameCursor;
    const endFrame = startFrame + durationFrames;
    frameCursor = endFrame;

    mediaEntries.push({
      entryId: `entry-${mediaIndex}`,
      segmentId: segmentId || `segment_${index + 1}`,
      segmentQuote: String(segment?.text_quote ?? ""),
      fileId: `file-${mediaIndex}`,
      masterClipId: `masterclip-${mediaIndex}`,
      fileName: path.basename(absolutePath),
      pathUrl: pathToFileURL(absolutePath).href,
      durationFrames,
      sourceInFrame,
      sourceOutFrame,
      startFrame,
      endFrame,
      category,
      hasAudio: Boolean(mediaInfo.hasAudio),
      hasVideo: Boolean(mediaInfo.hasVideo),
      sourceDimensions,
      motion: {
        scale: motionScale,
        center: motionCenter
      }
    });
  }

  if (!mediaEntries.length) {
    return {
      clipCount: 0,
      fileName: exportFileName,
      xml: ""
    };
  }

  const videoClips = [];
  const audioClips = [];
  let videoClipIndex = 1;
  let audioClipIndex = 1;
  mediaEntries.forEach((entry) => {
    if (entry.hasVideo) {
      videoClips.push({
        ...entry,
        entry,
        startFrame: entry.startFrame,
        endFrame: entry.endFrame,
        clipId: `vclipitem-${videoClipIndex}`,
        clipIndex: videoClipIndex
      });
      videoClipIndex += 1;
    }

    if (entry.hasAudio) {
      audioClips.push({
        ...entry,
        entry,
        startFrame: entry.startFrame,
        endFrame: entry.endFrame,
        clipId: `aclipitem-${audioClipIndex}`,
        clipIndex: audioClipIndex
      });
      audioClipIndex += 1;
    }
  });

  const xml = buildXmemlTimeline({
    sequenceName: buildXmlSequenceName({ document, sectionId, sectionTitle }),
    fps: fpsValue,
    totalFrames: frameCursor,
    videoClips,
    audioClips,
    sectionMarkers
  });

  return {
    clipCount: mediaEntries.length,
    fileName: exportFileName,
    xml
  };
}

function isCustomSubSegmentId(segmentId) {
  return /^[a-z][a-z0-9]*_\d{2}(?:_\d{2})+$/i.test(String(segmentId ?? "").trim());
}

function normalizedContains(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.includes(needle);
}

function pickCustomSplitCandidates({ segment, normalized, customMeta, usedOldIds, sectionKey }) {
  if (!normalized || normalized.length < 20) return [];
  const candidates = customMeta
    .filter((item) => {
      const segmentId = String(item.segment.segment_id ?? "");
      if (!segmentId || usedOldIds.has(segmentId)) return false;
      if (segment.block_type && item.segment.block_type && segment.block_type !== item.segment.block_type) return false;
      if (sectionKey && item.sectionKey && sectionKey !== item.sectionKey) return false;
      if (!item.normalized || item.normalized.length < 8) return false;
      return normalizedContains(normalized, item.normalized);
    })
    .sort((a, b) => a.index - b.index);
  if (!candidates.length) return [];
  const total = candidates.reduce((sum, item) => sum + item.normalized.length, 0);
  const ratio = total / Math.max(1, normalized.length);
  if (candidates.length >= 2 && ratio >= 0.55) return candidates;
  if (candidates.length >= 1 && ratio >= 0.82) return candidates;
  return [];
}

function collectPreservedManualSegments({ oldMeta, usedOldIds, usedIds, newSegments, oldBySection }) {
  const preserved = [];
  const newMeta = newSegments.map((segment) => ({
    segment,
    normalized: normalizeTextForMatch(segment.text_quote),
    sectionKey: getSectionMatchKey(segment)
  }));
  oldMeta.forEach((item) => {
    const segmentId = String(item.segment.segment_id ?? "").trim();
    if (!segmentId || usedOldIds.has(segmentId) || usedIds.has(segmentId)) return;
    if (!isCustomSubSegmentId(segmentId)) return;
    const sectionCandidates = item.sectionKey ? oldBySection.get(item.sectionKey) ?? [] : [];
    if (sectionCandidates.length === 0 && !item.normalized) return;
    const stillPresent = newMeta.some((entry) => {
      if (item.sectionKey && entry.sectionKey && item.sectionKey !== entry.sectionKey) return false;
      return normalizedContains(entry.normalized, item.normalized);
    });
    if (!stillPresent) return;
    usedOldIds.add(segmentId);
    usedIds.add(segmentId);
    preserved.push({
      segment: { ...item.segment, segment_status: "same" },
      sourceId: segmentId
    });
  });
  return preserved;
}

function findBestFuzzyMatch({ segment, normalized, tokens, sectionKey, candidates, usedOldIds, minScore }) {
  if (!normalized || tokens.length < 3) return null;
  let best = null;
  let bestScore = 0;
  for (const item of candidates) {
    const oldId = String(item.segment.segment_id ?? "");
    if (!oldId || usedOldIds.has(oldId)) continue;
    if (!item.tokens.length) continue;
    const similarity = jaccardSimilarity(tokens, item.tokens);
    if (similarity <= 0) continue;
    const blockBonus = segment.block_type === item.segment.block_type ? 0.08 : 0;
    const sectionBonus =
      sectionKey && item.sectionKey ? (sectionKey === item.sectionKey ? 0.12 : -0.12) : 0;
    const lengthRatio = Math.min(normalized.length, item.normalized.length) / Math.max(normalized.length, item.normalized.length);
    const lengthBonus = Number.isFinite(lengthRatio) ? lengthRatio * 0.08 : 0;
    const score = similarity + blockBonus + sectionBonus + lengthBonus;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (!best || bestScore < minScore) return null;
  return best;
}

function normalizeTextForMatch(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForMatch(text) {
  const normalized = normalizeTextForMatch(text);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function ensureUniqueSegmentId(segment, usedIds, counters) {
  const desired = String(segment.segment_id ?? "").trim();
  if (desired && !usedIds.has(desired)) {
    usedIds.add(desired);
    return desired;
  }
  const base = String(segment.block_type ?? "news");
  let index = counters.get(base) ?? 1;
  let candidate = "";
  do {
    candidate = `${base}_${String(index).padStart(2, "0")}`;
    index += 1;
  } while (usedIds.has(candidate));
  counters.set(base, index);
  usedIds.add(candidate);
  return candidate;
}

function splitSegmentsAndDecisions(segments, decisionsOverride = null) {
  const segmentsData = segments.map((segment) => ({
    segment_id: segment.segment_id,
    block_type: segment.block_type,
    text_quote: segment.text_quote,
    section_id: segment.section_id ?? null,
    section_title: segment.section_title ?? null,
    section_index: segment.section_index ?? null,
    links: normalizeLinksInput(segment.links),
    segment_status: segment.segment_status ?? null,
    is_done: Boolean(segment.is_done),
    version: 1
  }));
  const decisionsSource = Array.isArray(decisionsOverride) ? decisionsOverride : segments;
  const decisionsData = decisionsSource.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision: normalizeVisualDecisionInput(segment.visual_decision),
    search_decision: normalizeSearchDecisionInput(segment.search_decision),
    search_decision_en: normalizeSearchDecisionInput(segment.search_decision_en),
    version: 1
  }));
  return { segmentsData, decisionsData };
}

function normalizeSegmentForDecision(segment) {
  return {
    segment_id: String(segment?.segment_id ?? ""),
    block_type: String(segment?.block_type ?? "news"),
    text_quote: String(segment?.text_quote ?? "")
  };
}

function normalizeSegmentWithVisual(segment) {
  return {
    ...normalizeSegmentForDecision(segment),
    visual_decision: normalizeVisualDecisionInput(segment?.visual_decision)
  };
}

function normalizeSegmentsInput(segments) {
  return segments.map((segment) => ({
    segment_id: String(segment.segment_id ?? ""),
    block_type: String(segment.block_type ?? "news"),
    text_quote: String(segment.text_quote ?? ""),
    section_id: segment.section_id ? String(segment.section_id) : null,
    section_title: segment.section_title ? String(segment.section_title) : null,
    section_index: Number.isFinite(Number(segment.section_index)) ? Number(segment.section_index) : null,
    links: normalizeLinksInput(segment.links),
    segment_status: segment.segment_status ? String(segment.segment_status) : null,
    is_done: Boolean(segment.is_done),
    version: Number(segment.version ?? 1)
  }));
}

function normalizeDecisionsInput(decisions) {
  return decisions.map((decision) => ({
    segment_id: String(decision.segment_id ?? ""),
    visual_decision: normalizeVisualDecisionInput(decision.visual_decision ?? decision),
    search_decision: normalizeSearchDecisionInput(decision.search_decision ?? decision.visual_decision),
    search_decision_en: normalizeSearchDecisionInput(decision.search_decision_en),
    version: Number(decision.version ?? 1)
  }));
}

const FALLBACK_LIMITS = { maxKeywords: 8, maxQueries: 3 };

function normalizeStringList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

function emptySearchDecision() {
  return { keywords: [], queries: [] };
}

function normalizeSearchDecisionInput(raw) {
  if (!raw || typeof raw !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? FALLBACK_LIMITS;
  const keywords = normalizeStringList(raw.keywords, limits.maxKeywords);
  const queries = normalizeStringList(raw.queries ?? raw.search_queries ?? raw.searchQueries, limits.maxQueries);
  return { keywords, queries };
}

function emptyVisualDecision() {
  return {
    type: "no_visual",
    description: "",
    format_hint: null,
    duration_hint_sec: null,
    priority: null,
    media_file_path: null,
    media_start_timecode: null
  };
}

function normalizeVisualDecisionInput(raw) {
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
  const mediaFilePath = normalizeMediaFilePath(raw.media_file_path ?? raw.media_path ?? null);
  const mediaStartTimecode = normalizeMediaStartTimecode(raw.media_start_timecode ?? raw.media_start ?? null);

  return {
    type,
    description,
    format_hint: formatHint,
    duration_hint_sec: durationHint,
    priority,
    media_file_path: mediaFilePath,
    media_start_timecode: mediaStartTimecode
  };
}

function normalizeMediaStartTimecode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > 32 ? normalized.slice(0, 32) : normalized;
}

function normalizeMediaFilePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  return normalized.length > 512 ? normalized.slice(0, 512) : normalized;
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
