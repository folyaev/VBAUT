import fs from "node:fs/promises";
import path from "node:path";

export function registerMediaRoutes(app, deps) {
  const {
    appendEvent,
    getDocDir,
    getMediaDir,
    getYtDlpVersion,
    isHttpUrl,
    isMediaAlreadyDownloaded,
    isYtDlpCandidateUrl,
    listMediaFiles,
    mediaDownloadRoot,
    mediaDownloader,
    normalizeDocumentMediaDownloads,
    normalizeLinkUrl,
    readOptionalJson,
    safeResolveMediaPath,
    sanitizeMediaTopicName,
    ensureMediaDir,
    updateYtDlpBinary
  } = deps;
  let ytDlpUpdatePromise = null;

  app.get("/api/downloader/config", (_req, res) => {
    res.json({
      tools: mediaDownloader.getToolsInfo(),
      download_root: mediaDownloadRoot,
      note: "Downloader uses yt-dlp only"
    });
  });

  app.get("/api/downloader/yt-dlp/version", async (_req, res) => {
    try {
      const tools = mediaDownloader.getToolsInfo();
      if (!tools.available || !tools.yt_dlp_path) {
        return res.json({
          available: false,
          version: null,
          yt_dlp_path: null
        });
      }
      const version = await getYtDlpVersion(tools.yt_dlp_path);
      return res.json({
        available: true,
        version,
        yt_dlp_path: tools.yt_dlp_path,
        checked_at: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to read yt-dlp version" });
    }
  });

  app.post("/api/downloader/yt-dlp:update", async (_req, res) => {
    try {
      const tools = mediaDownloader.getToolsInfo();
      if (!tools.available || !tools.yt_dlp_path) {
        return res.status(503).json({
          error: "yt-dlp is not available. Configure MEDIA_YTDLP_PATH or add MediaDownloaderQt6-5.4.2."
        });
      }
      if (mediaDownloader.hasActiveJobs()) {
        return res.status(409).json({ error: "Cannot update yt-dlp while media downloads are active" });
      }
      if (ytDlpUpdatePromise) {
        return res.status(409).json({ error: "yt-dlp update is already running" });
      }

      ytDlpUpdatePromise = updateYtDlpBinary(tools.yt_dlp_path);
      const updateResult = await ytDlpUpdatePromise;
      ytDlpUpdatePromise = null;

      return res.json({
        ok: true,
        ...updateResult,
        checked_at: new Date().toISOString()
      });
    } catch (error) {
      ytDlpUpdatePromise = null;
      return res.status(500).json({ error: error.message || "yt-dlp update failed" });
    }
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
        download_root: mediaDownloadRoot,
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
}
