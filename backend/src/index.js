import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
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
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_MAX_FILES_LIST = Number.isFinite(Number(process.env.MEDIA_MAX_FILES_LIST))
  ? Math.max(20, Number(process.env.MEDIA_MAX_FILES_LIST))
  : 500;
const MEDIA_DOWNLOAD_ROOT = process.env.MEDIA_DOWNLOAD_ROOT || "C:\\Users\\Nemifist\\YandexDisk\\PAMPAM";
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
    const docId = `doc_${new Date().toISOString().replace(/[:.]/g, "-")}_${nanoid(6)}`;
    const dir = await ensureDocDir(docId);
    const createdAt = new Date().toISOString();

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

    const segmentsVersion = await saveVersioned(docId, "segments", segmentsData);
    const decisionsVersion = await saveVersioned(docId, "decisions", decisionsData);
    markDocumentSegmented(document, text);
    document.updated_at = new Date().toISOString();
    await writeJson(path.join(dir, "document.json"), document);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segments_generated",
      payload: { segmentsVersion, decisionsVersion }
    });

    res.json({
      document: normalizeDocumentForResponse(document),
      segments: segmentsData,
      decisions: decisionsData
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
      decisionMap.set(decision.segment_id, {
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(decision.visual_decision),
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
        visual_decision: normalizeVisualDecisionInput(decision.visual_decision),
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
    if (!["jsonl", "md"].includes(format)) {
      return res.status(400).json({ error: "format must be jsonl or md" });
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
      res.setHeader("content-disposition", `attachment; filename="${document.id}.jsonl"`);
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
    res.setHeader("content-disposition", `attachment; filename="${document.id}.md"`);
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
      const tweetData = await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}`, controller);
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
    const html = await response.text();
    const head = html.slice(0, 200000);
    const title = extractTitle(head);
    const ogTitle = extractMeta(head, "og:title");
    const description = extractMeta(head, "description");
    const ogDescription = extractMeta(head, "og:description");
    const siteName = extractMeta(head, "og:site_name") || extractMeta(head, "twitter:site");
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
      title: ogTitle || title || "",
      description: ogDescription || description || "",
      image: proxiedImage,
      siteName: siteName || ""
    };
  } finally {
    clearTimeout(timeout);
  }
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
    .replace(/&#39;/g, "'")
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

const FALLBACK_LIMITS = { maxKeywords: 8, maxQueries: 6 };

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
    priority: null
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

  return {
    type,
    description,
    format_hint: formatHint,
    duration_hint_sec: durationHint,
    priority
  };
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
