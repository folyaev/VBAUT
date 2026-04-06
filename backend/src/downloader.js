import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_MEDIA_DOWNLOADER_DIR = path.join(ROOT_DIR, "MediaDownloaderQt6-5.4.2");
const IS_WINDOWS = process.platform === "win32";
const FFMPEG_BIN = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg";
const FFPROBE_BIN = IS_WINDOWS ? "ffprobe.exe" : "ffprobe";
const FORMAT_SORT = "res:1080,vcodec:h264,acodec:m4a,ext:mp4";
const DEFAULT_FORMAT = [
  "bv*[height<=1080][vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a]/",
  "b[height<=1080][vcodec^=avc1][ext=mp4]/",
  "bv*[height<=1080]+ba/",
  "b[height<=1080]/best[height<=1080]/best"
].join("");
const YTDLP_UPDATE_TIMEOUT_MS = 5 * 60 * 1000;
const GALLERYDL_TIMEOUT_MS = 2 * 60 * 1000;
const GALLERYDL_IMAGE_ONLY_FILTER = "extension in ('jpg', 'jpeg', 'png', 'webp', 'gif')";
const THUMBNAIL_FALLBACK_TIMEOUT_MS = 30000;
const VERIFYABLE_MEDIA_EXT_RE = /\.(mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const TRACKED_OUTPUT_EXT_RE = /\.(mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus|jpg|jpeg|png|webp|gif)$/i;
const IMAGE_OUTPUT_EXT_RE = /\.(jpg|jpeg|png|webp|gif)$/i;
const X_TRANSIENT_RETRY_DELAYS_MS = [4000, 10000];

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
const TIKTOK_SHORT_HOSTS = new Set(["vt.tiktok.com", "vm.tiktok.com"]);

const DIRECT_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|m3u8|mp3|m4a|wav|flac)(?:$|[?#])/i;

function isVkVideoUrl(parsedUrl) {
  if (!parsedUrl) return false;
  const host = String(parsedUrl.hostname ?? "").toLowerCase();
  const pathWithQuery = `${parsedUrl.pathname ?? ""}${parsedUrl.search ?? ""}`.toLowerCase();
  if (host === "vk.com" || host.endsWith(".vk.com")) {
    return pathWithQuery.startsWith("/video");
  }
  if (host === "vk.ru" || host.endsWith(".vk.ru")) {
    return pathWithQuery.startsWith("/video");
  }
  if (host === "vkvideo.ru" || host.endsWith(".vkvideo.ru")) {
    return pathWithQuery.startsWith("/video") || pathWithQuery.includes("/video-") || pathWithQuery.includes("video");
  }
  return false;
}

export function isYtDlpCandidateUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (DIRECT_MEDIA_PATH_RE.test(parsed.pathname + parsed.search)) return true;
  const host = parsed.hostname.toLowerCase();
  if (host === "vk.com" || host.endsWith(".vk.com") || host === "vk.ru" || host.endsWith(".vk.ru") || host === "vkvideo.ru" || host.endsWith(".vkvideo.ru")) {
    return isVkVideoUrl(parsed);
  }
  return YTDLP_CANDIDATE_HOSTS.some((pattern) => pattern.test(host));
}

function normalizeYtDlpInputUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return "";

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  const host = parsed.hostname.toLowerCase();
  if (!TIKTOK_SHORT_HOSTS.has(host)) {
    return value;
  }

  const token = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (!token || !/^[a-z0-9_-]{6,}$/i.test(token)) {
    return value;
  }

  return `https://www.tiktok.com/t/${token}/`;
}

function isTikTokUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function isXUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
  } catch {
    return false;
  }
}

function shouldRetryTransientXFailure(rawUrl, detail = "") {
  if (!isXUrl(rawUrl)) return false;
  const text = String(detail ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("api.x.com") &&
    (text.includes("getaddrinfo failed") ||
      text.includes("failed to resolve") ||
      text.includes("nameresolutionerror") ||
      text.includes("guest_token"))
  );
}

export async function resolveDownloaderTools() {
  const ytCandidates = [
    process.env.MEDIA_YTDLP_PATH,
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "bin", "yt-dlp"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "bin", "yt-dlp.exe"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "3rdParty", "ytdlp", "yt-dlp"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "3rdParty", "ytdlp", "yt-dlp_x86.exe"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "update", "local", "bin", "yt-dlp"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "update", "local", "bin", "yt-dlp.exe"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "update", "3rdParty", "ytdlp", "yt-dlp"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "update", "3rdParty", "ytdlp", "yt-dlp_x86.exe"),
    "yt-dlp"
  ];

  let ytDlpPath = null;
  for (const candidate of ytCandidates) {
    if (!candidate) continue;
    if (await probeExecutable(candidate, ["--version"])) {
      ytDlpPath = candidate;
      break;
    }
  }

  const ffmpegCandidates = [
    process.env.MEDIA_FFMPEG_LOCATION,
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "3rdParty", "ffmpeg", "bin"),
    path.join(DEFAULT_MEDIA_DOWNLOADER_DIR, "local", "update", "3rdParty", "ffmpeg", "bin"),
    "ffmpeg"
  ];

  let ffmpegLocation = null;
  for (const candidate of ffmpegCandidates) {
    if (!candidate) continue;
    const ok = await probeFfmpegLocation(candidate);
    if (ok) {
      ffmpegLocation = candidate;
      break;
    }
  }

  const galleryCandidates = [process.env.MEDIA_GALLERYDL_PATH, "gallery-dl"];
  let galleryDlPath = null;
  let galleryDlPythonModule = false;
  for (const candidate of galleryCandidates) {
    if (!candidate) continue;
    if (await probeExecutable(candidate, ["--version"])) {
      galleryDlPath = candidate;
      break;
    }
  }
  if (!galleryDlPath && (await probeExecutable("python", ["-m", "gallery_dl", "--version"]))) {
    galleryDlPath = "python";
    galleryDlPythonModule = true;
  }
  if (!galleryDlPath && (await probeExecutable("py", ["-m", "gallery_dl", "--version"]))) {
    galleryDlPath = "py";
    galleryDlPythonModule = true;
  }

  return {
    ytDlpPath,
    ffmpegLocation,
    galleryDlPath,
    galleryDlPythonModule
  };
}

export async function getYtDlpVersion(ytDlpPath) {
  const command = String(ytDlpPath ?? "").trim();
  if (!command) return null;
  const version = await runCommandCaptureFirstLine(command, ["--version"], 12000);
  const normalized = String(version ?? "").trim();
  return normalized || null;
}

export async function updateYtDlpBinary(ytDlpPath) {
  const command = String(ytDlpPath ?? "").trim();
  if (!command) {
    throw new Error("yt-dlp unavailable");
  }

  const before = await getYtDlpVersion(command);
  const result = await runCommandCaptureOutput(command, ["-U"], YTDLP_UPDATE_TIMEOUT_MS);
  const after = await getYtDlpVersion(command);
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
  const lower = combinedOutput.toLowerCase();
  const changed = Boolean(before && after && before !== after);
  const upToDate = !changed && /up to date|latest version|already up[- ]to[- ]date/i.test(lower);

  return {
    before,
    after,
    changed,
    up_to_date: upToDate,
    output_tail: trimOutputTail(combinedOutput, 3000)
  };
}

export class MediaDownloadQueue {
  constructor(options = {}) {
    this.ytDlpPath = options.ytDlpPath ?? null;
    this.ffmpegLocation = options.ffmpegLocation ?? null;
    this.galleryDlPath = options.galleryDlPath ?? null;
    this.galleryDlPythonModule = Boolean(options.galleryDlPythonModule);
    this.tiktokFallbackEnabled = String(process.env.MEDIA_TIKTOK_FALLBACK ?? "1") !== "0";
    this.xGalleryDlSupplementEnabled = String(process.env.MEDIA_X_GALLERYDL_SUPPLEMENT ?? "1") !== "0";
    this.ytDlpProxy = process.env.MEDIA_YTDLP_PROXY ? String(process.env.MEDIA_YTDLP_PROXY).trim() : "";
    this.ytDlpImpersonate = process.env.MEDIA_YTDLP_IMPERSONATE
      ? String(process.env.MEDIA_YTDLP_IMPERSONATE).trim()
      : "";
    this.ytDlpTikTokExtractorArgs = process.env.MEDIA_YTDLP_TIKTOK_EXTRACTOR_ARGS
      ? String(process.env.MEDIA_YTDLP_TIKTOK_EXTRACTOR_ARGS).trim()
      : "";
    this.galleryDlProxy = process.env.MEDIA_GALLERYDL_PROXY
      ? String(process.env.MEDIA_GALLERYDL_PROXY).trim()
      : this.ytDlpProxy;
    this.cookiesPath = process.env.MEDIA_COOKIES_PATH
      ? String(process.env.MEDIA_COOKIES_PATH)
      : null;
    this.cookiesFromBrowser = process.env.MEDIA_COOKIES_FROM_BROWSER
      ? String(process.env.MEDIA_COOKIES_FROM_BROWSER)
      : null;
    this.maxConcurrent = Math.max(1, Number(options.maxConcurrent ?? 1) || 1);
    this.startDelayMs = Math.max(500, Number(options.startDelayMs ?? 2500) || 2500);
    this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;

    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.runningProcs = new Map();
    this.lastStartAt = 0;
    this.pumpScheduled = false;
  }

  isAvailable() {
    return Boolean(this.ytDlpPath);
  }

  hasActiveJobs() {
    for (const job of this.jobs.values()) {
      if (job.status === "queued" || job.status === "running") return true;
    }
    return false;
  }

  getToolsInfo() {
    return {
      available: this.isAvailable(),
      yt_dlp_path: this.ytDlpPath,
      ffmpeg_location: this.ffmpegLocation,
      gallery_dl_path: this.galleryDlPath,
      gallery_dl_mode: this.galleryDlPythonModule ? "python_module" : "binary",
      tiktok_fallback_enabled: this.tiktokFallbackEnabled,
      x_gallerydl_supplement_enabled: this.xGalleryDlSupplementEnabled,
      yt_dlp_proxy: this.ytDlpProxy || null,
      yt_dlp_impersonate: this.ytDlpImpersonate || null,
      yt_dlp_tiktok_extractor_args: this.ytDlpTikTokExtractorArgs || null,
      gallery_dl_proxy: this.galleryDlProxy || null,
      cookies_path: this.cookiesPath,
      cookies_from_browser: this.cookiesFromBrowser,
      max_concurrent: this.maxConcurrent,
      start_delay_ms: this.startDelayMs,
      supported_hosts: YTDLP_CANDIDATE_HOSTS.map((pattern) => pattern.source)
    };
  }

  listJobs(docId) {
    const list = [];
    for (const job of this.jobs.values()) {
      if (docId && job.doc_id !== docId) continue;
      list.push(this._snapshot(job));
    }
    return list.sort((a, b) => {
      const left = a.created_at ?? "";
      const right = b.created_at ?? "";
      return left > right ? -1 : 1;
    });
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? this._snapshot(job) : null;
  }

  enqueue({ docId, url, outputDir, sectionTitle = null }) {
    const normalizedUrl = normalizeYtDlpInputUrl(String(url ?? "").trim());
    const normalizedOutputDir = String(outputDir ?? "").trim();
    if (!docId || !normalizedUrl || !normalizedOutputDir) {
      throw new Error("docId, url and outputDir are required");
    }

    for (const existing of this.jobs.values()) {
      if (existing.url !== normalizedUrl) continue;
      if (existing.output_dir !== normalizedOutputDir) continue;
      if (existing.status === "queued" || existing.status === "running") {
        return this._snapshot(existing);
      }
    }

    const now = new Date().toISOString();
    const job = {
      id: `job_${Date.now()}_${nanoid(6)}`,
      doc_id: docId,
      url: normalizedUrl,
      section_title: sectionTitle ?? null,
      output_dir: normalizedOutputDir,
      status: "queued",
      progress: "0%",
      progress_percent: 0,
      progress_bucket: 0,
      output_files: [],
      skip_reason: null,
      error: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
      last_message: null,
      cancel_requested: false,
      meta_title: null,
      meta_uploader: null,
      meta_uploader_url: null,
      meta_webpage_url: null,
      meta_format_note: null,
      meta_resolution: null,
      meta_thumbnail: null
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this._emit(job);
    this._schedulePump();
    return this._snapshot(job);
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === "queued") {
      this.queue = this.queue.filter((queuedId) => queuedId !== jobId);
      job.status = "canceled";
      job.cancel_requested = true;
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return true;
    }

    if (job.status !== "running") return false;
    const proc = this.runningProcs.get(jobId);
    if (!proc) return false;

    job.cancel_requested = true;
    try {
      proc.kill();
    } catch {
      return false;
    }

    setTimeout(() => {
      if (!this.runningProcs.has(jobId)) return;
      try {
        proc.kill("SIGKILL");
      } catch {
        // noop
      }
    }, 1500);

    return true;
  }

  _snapshot(job) {
    return {
      id: job.id,
      doc_id: job.doc_id,
      url: job.url,
      section_title: job.section_title,
      output_dir: job.output_dir,
      status: job.status,
      progress: job.progress,
      progress_percent: job.progress_percent,
      progress_bucket: job.progress_bucket,
      output_files: [...(job.output_files ?? [])],
      skip_reason: job.skip_reason,
      error: job.error,
      created_at: job.created_at,
      updated_at: job.updated_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      last_message: job.last_message,
      meta_title: job.meta_title ?? null,
      meta_uploader: job.meta_uploader ?? null,
      meta_uploader_url: job.meta_uploader_url ?? null,
      meta_webpage_url: job.meta_webpage_url ?? null,
      meta_format_note: job.meta_format_note ?? null,
      meta_resolution: job.meta_resolution ?? null,
      meta_thumbnail: job.meta_thumbnail ?? null
    };
  }

  _emit(job) {
    job.updated_at = new Date().toISOString();
    if (!this.onStateChange) return;
    this.onStateChange(this._snapshot(job));
  }

  _schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      this._pump().catch(() => null);
    }, 0);
  }

  async _pump() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const nextId = this.queue.shift();
      const job = this.jobs.get(nextId);
      if (!job || job.status !== "queued") continue;

      this.running += 1;
      void this._run(job)
        .catch((error) => {
          if (job.status === "queued" || job.status === "running") {
            job.status = "failed";
            job.error = error?.message ?? "Download failed";
            job.finished_at = new Date().toISOString();
            this._emit(job);
          }
        })
        .finally(() => {
          this.running -= 1;
          this._schedulePump();
        });
    }
  }

  async _run(job) {
    if (!this.isAvailable()) {
      job.status = "failed";
      job.error = "yt-dlp unavailable";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    if (!isYtDlpCandidateUrl(job.url)) {
      job.status = "failed";
      job.error = "Unsupported URL for yt-dlp";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    const elapsed = Date.now() - this.lastStartAt;
    if (elapsed < this.startDelayMs) {
      await sleep(this.startDelayMs - elapsed);
    }
    this.lastStartAt = Date.now();

    if (job.cancel_requested) {
      job.status = "canceled";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    await fs.mkdir(job.output_dir, { recursive: true });

    job.status = "running";
    job.started_at = new Date().toISOString();
    job.progress = "0%";
    job.progress_percent = 0;
    job.progress_bucket = 0;
    job.error = null;
    job.skip_reason = null;
    this._emit(job);

    const outputTemplate = path.join(job.output_dir, "%(title).180B [%(id)s].%(ext)s");
    const archivePath = path.join(job.output_dir, ".yt-dlp-archive.txt");
    const mediaId = await this._resolveMediaId(job.url);
    const beforeSnapshot = await listOutputFileSnapshots(job.output_dir);

    const predictedPath = await this._predictFilename(job.url, outputTemplate);
    if (predictedPath && (await fileExists(predictedPath))) {
      const verifyExisting = await verifyMediaOutputs([predictedPath], this.ffmpegLocation);
      if (!verifyExisting.ok) {
        job.status = "failed";
        job.error = `Existing file failed integrity check: ${verifyExisting.message}`;
        job.finished_at = new Date().toISOString();
        this._emit(job);
        return;
      }
      const displayFiles = new Set([toRelativeDisplayPath(job.output_dir, predictedPath)]);
      const absoluteFiles = new Set([predictedPath]);
      const xSupplementError = await this._tryXGallerySupplement(job, beforeSnapshot, displayFiles, absoluteFiles);
      if (job.status === "canceled") {
        return;
      }
      if (xSupplementError) {
        job.last_message = `X gallery-dl supplement skipped: ${xSupplementError}`;
      }
      job.output_files = Array.from(displayFiles);
      job.status = "completed";
      job.skip_reason = "file_exists";
      this._setProgress(job, 100, true);
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    let result = null;
    let attempt = 0;
    let transientXRetryCount = 0;
    let displayFiles = new Set(job.output_files ?? []);
    let absoluteFiles = new Set();
    while (attempt < 2) {
      result = await this._spawnYtDlp(job, {
        outputTemplate,
        archivePath
      });

      if (job.cancel_requested || result.canceled) {
        job.status = "canceled";
        job.finished_at = new Date().toISOString();
        this._emit(job);
        return;
      }

      if (result.exitCode !== 0) {
        const retryDelayMs = X_TRANSIENT_RETRY_DELAYS_MS[transientXRetryCount] ?? 0;
        const retryDetail = result.error || result.stderrTail || "";
        if (retryDelayMs > 0 && shouldRetryTransientXFailure(job.url, retryDetail)) {
          transientXRetryCount += 1;
          job.last_message = `X download retry ${transientXRetryCount}/${X_TRANSIENT_RETRY_DELAYS_MS.length} after transient api.x.com failure...`;
          this._emit(job);
          await sleep(retryDelayMs);
          continue;
        }
        break;
      }

      for (const filePath of result.files) {
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(job.output_dir, filePath);
        if (!isTrackedOutputFile(absolutePath)) continue;
        if (!(await fileExists(absolutePath))) continue;
        absoluteFiles.add(absolutePath);
        displayFiles.add(toRelativeDisplayPath(job.output_dir, absolutePath));
      }

      const afterSnapshot = await listOutputFileSnapshots(job.output_dir);
      const changedFiles = diffOutputSnapshots(beforeSnapshot, afterSnapshot);
      for (const filePath of changedFiles) {
        if (!isTrackedOutputFile(filePath)) continue;
        absoluteFiles.add(filePath);
        displayFiles.add(toRelativeDisplayPath(job.output_dir, filePath));
      }

      if (displayFiles.size === 0 && predictedPath && (await fileExists(predictedPath))) {
        absoluteFiles.add(predictedPath);
        displayFiles.add(toRelativeDisplayPath(job.output_dir, predictedPath));
      }

      if (displayFiles.size === 0) {
        const thumbnailFallbackPath = await this._tryThumbnailFallback(job, mediaId);
        if (thumbnailFallbackPath) {
          absoluteFiles.add(thumbnailFallbackPath);
          displayFiles.add(toRelativeDisplayPath(job.output_dir, thumbnailFallbackPath));
        }
      }

      if (displayFiles.size > 0) {
        break;
      }

      const archiveLikely = result.skippedByArchive || (await this._isUrlInArchive(job.url, archivePath, mediaId));
      if (!archiveLikely) {
        break;
      }

      const archivedFiles = await findOutputFilesById(job.output_dir, mediaId);
      for (const filePath of archivedFiles) {
        absoluteFiles.add(filePath);
        displayFiles.add(toRelativeDisplayPath(job.output_dir, filePath));
      }
      if (displayFiles.size > 0) {
        job.skip_reason = "already_downloaded";
        break;
      }

      const removedStaleEntry = await this._removeUrlFromArchive(job.url, archivePath, mediaId);
      if (removedStaleEntry && attempt === 0) {
        job.last_message = "Stale archive entry removed, retrying download...";
        this._emit(job);
        attempt += 1;
        continue;
      }

      job.status = "failed";
      job.error = "Archive marks URL as downloaded, but file is missing on disk";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    if (result?.exitCode === 0) {
      if (displayFiles.size === 0) {
        job.status = "failed";
        job.error = result.stderrTail || "No output files found after download";
        job.finished_at = new Date().toISOString();
        this._emit(job);
        return;
      }

      const verifyDownloaded = await verifyMediaOutputs(Array.from(absoluteFiles), this.ffmpegLocation);
      if (!verifyDownloaded.ok) {
        await this._removeUrlFromArchive(job.url, archivePath, mediaId);
        job.status = "failed";
        job.error = `Downloaded file failed integrity check: ${verifyDownloaded.message}`;
        job.finished_at = new Date().toISOString();
        this._emit(job);
        return;
      }

      const xSupplementError = await this._tryXGallerySupplement(job, beforeSnapshot, displayFiles, absoluteFiles);
      if (job.status === "canceled") {
        return;
      }
      if (xSupplementError) {
        job.last_message = `X gallery-dl supplement skipped: ${xSupplementError}`;
      }

      job.output_files = Array.from(displayFiles);
      if (!job.output_files.length && result.skippedByArchive) {
        job.skip_reason = "already_downloaded";
      }
      job.status = "completed";
      this._setProgress(job, 100, true);
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    const xFallbackError = await this._tryXGalleryFallback(job, beforeSnapshot);
    if (job.status === "completed" || job.status === "canceled") {
      return;
    }

    const fallbackError = await this._tryTikTokFallback(job, beforeSnapshot);
    if (job.status === "completed" || job.status === "canceled") {
      return;
    }

    job.status = "failed";
    const ytError = result?.error || result?.stderrTail || `yt-dlp exited with code ${result?.exitCode ?? "unknown"}`;
    const fallbackErrors = [];
    if (xFallbackError) fallbackErrors.push(`x-gallery-dl: ${xFallbackError}`);
    if (fallbackError) fallbackErrors.push(`tiktok-gallery-dl: ${fallbackError}`);
    job.error = fallbackErrors.length > 0 ? `${ytError} | ${fallbackErrors.join(" | ")}` : ytError;
    job.finished_at = new Date().toISOString();
    this._emit(job);
  }

  async _tryXGallerySupplement(job, beforeSnapshot, displayFiles, absoluteFiles) {
    if (!this.xGalleryDlSupplementEnabled) return "";
    if (!this.galleryDlPath) return "";
    if (!isXUrl(job.url)) return "";
    if (job.cancel_requested) return "";

    job.last_message = "yt-dlp completed, trying gallery-dl for extra media in X post...";
    this._emit(job);

    const result = await this._spawnGalleryDl(job, { imageOnly: true });
    if (job.cancel_requested || result.canceled) {
      job.status = "canceled";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return "";
    }

    if (result.exitCode !== 0) {
      return result.error || result.stderrTail || `gallery-dl exited with code ${result.exitCode ?? "unknown"}`;
    }

    const addImageCandidate = async (candidatePath) => {
      if (!candidatePath) return;
      const absolutePath = path.isAbsolute(candidatePath)
        ? candidatePath
        : path.resolve(job.output_dir, candidatePath);
      if (!isTrackedOutputFile(absolutePath)) return;
      if (!IMAGE_OUTPUT_EXT_RE.test(absolutePath)) return;
      if (!(await fileExists(absolutePath))) return;
      absoluteFiles.add(absolutePath);
      displayFiles.add(toRelativeDisplayPath(job.output_dir, absolutePath));
    };

    for (const filePath of result.files) {
      await addImageCandidate(filePath);
    }

    const afterSnapshot = await listOutputFileSnapshots(job.output_dir);
    const changedFiles = diffOutputSnapshots(beforeSnapshot, afterSnapshot);
    for (const filePath of changedFiles) {
      await addImageCandidate(filePath);
    }

    return "";
  }

  async _tryXGalleryFallback(job, beforeSnapshot) {
    if (!this.xGalleryDlSupplementEnabled) return "";
    if (!this.galleryDlPath) return "";
    if (!isXUrl(job.url)) return "";
    if (job.cancel_requested) return "";

    job.last_message = "yt-dlp failed for X, trying gallery-dl fallback...";
    this._emit(job);

    const result = await this._spawnGalleryDl(job);
    if (job.cancel_requested || result.canceled) {
      job.status = "canceled";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return "";
    }

    if (result.exitCode !== 0) {
      return result.error || result.stderrTail || `gallery-dl exited with code ${result.exitCode ?? "unknown"}`;
    }

    const absoluteFiles = new Set();
    const displayFiles = new Set();

    for (const filePath of result.files) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(job.output_dir, filePath);
      if (!isTrackedOutputFile(absolutePath)) continue;
      if (!(await fileExists(absolutePath))) continue;
      absoluteFiles.add(absolutePath);
      displayFiles.add(toRelativeDisplayPath(job.output_dir, absolutePath));
    }

    const afterSnapshot = await listOutputFileSnapshots(job.output_dir);
    const changedFiles = diffOutputSnapshots(beforeSnapshot, afterSnapshot);
    for (const filePath of changedFiles) {
      if (!isTrackedOutputFile(filePath)) continue;
      absoluteFiles.add(filePath);
      displayFiles.add(toRelativeDisplayPath(job.output_dir, filePath));
    }

    if (displayFiles.size === 0) {
      return result.stderrTail || "gallery-dl completed but produced no output files";
    }

    const verifyDownloaded = await verifyMediaOutputs(Array.from(absoluteFiles), this.ffmpegLocation);
    if (!verifyDownloaded.ok) {
      return `downloaded file failed integrity check: ${verifyDownloaded.message}`;
    }

    job.output_files = Array.from(displayFiles);
    job.status = "completed";
    this._setProgress(job, 100, true);
    job.finished_at = new Date().toISOString();
    this._emit(job);
    return "";
  }

  async _tryTikTokFallback(job, beforeSnapshot) {
    if (!this.tiktokFallbackEnabled) return "";
    if (!this.galleryDlPath) return "";
    if (!isTikTokUrl(job.url)) return "";
    if (job.cancel_requested) return "";

    job.last_message = "yt-dlp failed for TikTok, trying gallery-dl fallback...";
    this._emit(job);

    const result = await this._spawnGalleryDl(job);
    if (job.cancel_requested || result.canceled) {
      job.status = "canceled";
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return "";
    }

    if (result.exitCode !== 0) {
      return result.error || result.stderrTail || `gallery-dl exited with code ${result.exitCode ?? "unknown"}`;
    }

    const absoluteFiles = new Set();
    const displayFiles = new Set();

    for (const filePath of result.files) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(job.output_dir, filePath);
      if (!isTrackedOutputFile(absolutePath)) continue;
      if (!(await fileExists(absolutePath))) continue;
      absoluteFiles.add(absolutePath);
      displayFiles.add(toRelativeDisplayPath(job.output_dir, absolutePath));
    }

    const afterSnapshot = await listOutputFileSnapshots(job.output_dir);
    const changedFiles = diffOutputSnapshots(beforeSnapshot, afterSnapshot);
    for (const filePath of changedFiles) {
      if (!isTrackedOutputFile(filePath)) continue;
      absoluteFiles.add(filePath);
      displayFiles.add(toRelativeDisplayPath(job.output_dir, filePath));
    }

    if (displayFiles.size === 0) {
      return result.stderrTail || "gallery-dl completed but produced no output files";
    }

    const verifyDownloaded = await verifyMediaOutputs(Array.from(absoluteFiles), this.ffmpegLocation);
    if (!verifyDownloaded.ok) {
      return `downloaded file failed integrity check: ${verifyDownloaded.message}`;
    }

    job.output_files = Array.from(displayFiles);
    job.status = "completed";
    this._setProgress(job, 100, true);
    job.finished_at = new Date().toISOString();
    this._emit(job);
    return "";
  }

  async _resolveMediaId(url) {
    if (!this.ytDlpPath) return "";
    const rawId = await runCommandCaptureFirstLine(
      this.ytDlpPath,
      ["--no-warnings", "--no-playlist", "--get-id", url],
      25000
    ).catch(() => "");
    return String(rawId ?? "").trim();
  }

  async _isUrlInArchive(url, archivePath, mediaIdHint = "") {
    if (!this.ytDlpPath) return false;
    const archiveExists = await fileExists(archivePath);
    if (!archiveExists) return false;

    const id = String(mediaIdHint ?? "").trim() || (await this._resolveMediaId(url));
    if (!id) return false;

    const escapedId = escapeRegex(id);
    const archiveText = await fs.readFile(archivePath, "utf8").catch(() => "");
    if (!archiveText) return false;
    const lineRe = new RegExp(`(?:^|\\s)${escapedId}\\s*$`, "m");
    return lineRe.test(archiveText);
  }

  async _removeUrlFromArchive(url, archivePath, mediaIdHint = "") {
    const archiveExists = await fileExists(archivePath);
    if (!archiveExists) return false;

    const id = String(mediaIdHint ?? "").trim() || (await this._resolveMediaId(url));
    if (!id) return false;

    const archiveText = await fs.readFile(archivePath, "utf8").catch(() => "");
    if (!archiveText) return false;
    const lines = archiveText.split(/\r?\n/);
    let changed = false;
    const keep = [];
    for (const line of lines) {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) continue;
      if (trimmed === id || trimmed.endsWith(` ${id}`)) {
        changed = true;
        continue;
      }
      keep.push(line);
    }
    if (!changed) return false;
    const nextText = keep.length ? `${keep.join("\n")}\n` : "";
    await fs.writeFile(archivePath, nextText, "utf8");
    return true;
  }

  _setProgress(job, percent, forceEmit = false) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return;
    const clipped = Math.max(0, Math.min(100, value));
    const nextBucket = clipped >= 100 ? 100 : Math.floor(clipped / 20) * 20;

    job.progress_percent = Number(clipped.toFixed(1));
    if (forceEmit || nextBucket > (job.progress_bucket ?? 0)) {
      job.progress_bucket = nextBucket;
      job.progress = `${nextBucket}%`;
      this._emit(job);
    }
  }

  async _predictFilename(url, outputTemplate) {
    if (!this.ytDlpPath) return null;
    const args = [
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      "-S",
      FORMAT_SORT,
      "-f",
      DEFAULT_FORMAT,
      "--merge-output-format",
      "mp4",
      "--get-filename",
      "-o",
      outputTemplate,
      url
    ];

    if (this.ffmpegLocation) {
      args.unshift("--ffmpeg-location", this.ffmpegLocation);
    }

    const output = await runCommandCaptureFirstLine(this.ytDlpPath, args, 25000).catch(() => "");
    if (!output) return null;
    const trimmed = output.trim().replace(/^"|"$/g, "");
    if (!trimmed) return null;
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
  }

  _spawnYtDlp(job, context) {
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--newline",
      "-S",
      FORMAT_SORT,
      "--progress",
      "--progress-template",
      "download:__PROGRESS__%(progress._percent_str)s",
      "--print",
      "before_dl:__META_TITLE__%(title)s",
      "--print",
      "before_dl:__META_UPLOADER__%(uploader)s",
      "--print",
      "before_dl:__META_UPLOADER_URL__%(uploader_url)s",
      "--print",
      "before_dl:__META_WEBPAGE_URL__%(webpage_url)s",
      "--print",
      "before_dl:__META_FORMAT_NOTE__%(format_note)s",
      "--print",
      "before_dl:__META_RESOLUTION__%(resolution)s",
      "--print",
      "before_dl:__META_THUMBNAIL__%(thumbnail)s",
      "--print",
      "after_move:__FILE__%(filepath)s",
      "-f",
      DEFAULT_FORMAT,
      "--merge-output-format",
      "mp4",
      "--concurrent-fragments",
      "1",
      "--retries",
      "8",
      "--extractor-retries",
      "6",
      "--fragment-retries",
      "8",
      "--retry-sleep",
      "exp=1:30",
      "--retry-sleep",
      "extractor:exp=1:20",
      "--retry-sleep",
      "http:exp=1:20",
      "--sleep-requests",
      "1",
      "--sleep-interval",
      "1",
      "--max-sleep-interval",
      "3",
      "--socket-timeout",
      "30",
      "--download-archive",
      context.archivePath,
      "-o",
      context.outputTemplate,
      job.url
    ];

    if (isTikTokUrl(job.url) && this.ytDlpTikTokExtractorArgs) {
      args.unshift("--extractor-args", `tiktok:${this.ytDlpTikTokExtractorArgs}`);
    }

    if (this.ytDlpImpersonate) {
      args.unshift("--impersonate", this.ytDlpImpersonate);
    }

    if (this.ytDlpProxy) {
      args.unshift("--proxy", this.ytDlpProxy);
    }

    if (this.ffmpegLocation) {
      args.unshift("--ffmpeg-location", this.ffmpegLocation);
    }

    if (this.cookiesPath) {
      args.unshift("--cookies", this.cookiesPath);
    } else if (this.cookiesFromBrowser) {
      args.unshift("--cookies-from-browser", this.cookiesFromBrowser);
    }

    return new Promise((resolve) => {
      let canceled = false;
      let skippedByArchive = false;
      const files = new Set();
      const stderrTail = [];
      let spawnError = null;

      const child = spawn(this.ytDlpPath, args, {
        cwd: job.output_dir,
        windowsHide: true,
        env: buildSubprocessEnv()
      });
      this.runningProcs.set(job.id, child);

      const handleLine = (line) => {
        const text = String(line ?? "").trim();
        if (!text) return;
        job.last_message = text.slice(0, 500);

        const assignMeta = (prefix, key) => {
          if (!text.startsWith(prefix)) return false;
          const rawValue = text.slice(prefix.length).trim();
          const value = normalizeYtDlpMetaValue(rawValue);
          if (value) {
            job[key] = value;
          }
          return true;
        };
        if (assignMeta("__META_TITLE__", "meta_title")) return;
        if (assignMeta("__META_UPLOADER__", "meta_uploader")) return;
        if (assignMeta("__META_UPLOADER_URL__", "meta_uploader_url")) return;
        if (assignMeta("__META_WEBPAGE_URL__", "meta_webpage_url")) return;
        if (assignMeta("__META_FORMAT_NOTE__", "meta_format_note")) return;
        if (assignMeta("__META_RESOLUTION__", "meta_resolution")) return;
        if (assignMeta("__META_THUMBNAIL__", "meta_thumbnail")) return;

        const percent = parsePercent(text);
        if (percent !== null) {
          this._setProgress(job, percent);
        }

        if (text.startsWith("__FILE__")) {
          const filePath = text.slice("__FILE__".length).trim().replace(/^"|"$/g, "");
          if (filePath) {
            files.add(path.isAbsolute(filePath) ? filePath : path.resolve(job.output_dir, filePath));
          }
        }

        if (
          /has already been downloaded/i.test(text) ||
          /already in archive/i.test(text) ||
          /already been recorded in the archive/i.test(text)
        ) {
          skippedByArchive = true;
        }

        if (stderrTail.length >= 10) stderrTail.shift();
        stderrTail.push(text);
      };

      pipeLines(child.stdout, handleLine);
      pipeLines(child.stderr, handleLine);

      child.on("error", (error) => {
        spawnError = error?.message ?? "Failed to start yt-dlp";
      });

      child.on("close", (code, signal) => {
        this.runningProcs.delete(job.id);
        if (signal) canceled = true;
        resolve({
          exitCode: Number.isInteger(code) ? code : 1,
          canceled,
          skippedByArchive,
          files: Array.from(files),
          error: spawnError,
          stderrTail: stderrTail.join(" | ")
        });
      });
    });
  }

  _spawnGalleryDl(job, options = null) {
    const imageOnly = Boolean(options?.imageOnly);
    const args = [];
    if (this.galleryDlPythonModule) {
      args.push("-m", "gallery_dl");
    }
    args.push("--directory", job.output_dir);
    if (imageOnly) {
      args.push("--filter", GALLERYDL_IMAGE_ONLY_FILTER);
    }
    if (this.galleryDlProxy) {
      args.push("--proxy", this.galleryDlProxy);
    }
    args.push(job.url);

    return new Promise((resolve) => {
      let canceled = false;
      let spawnError = null;
      let timedOut = false;
      const files = new Set();
      const stderrTail = [];

      const child = spawn(this.galleryDlPath, args, {
        cwd: job.output_dir,
        windowsHide: true,
        env: buildSubprocessEnv()
      });
      this.runningProcs.set(job.id, child);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // noop
        }
      }, GALLERYDL_TIMEOUT_MS);

      const handleLine = (line) => {
        const text = String(line ?? "").trim();
        if (!text) return;
        job.last_message = text.slice(0, 500);
        if (stderrTail.length >= 12) stderrTail.shift();
        stderrTail.push(text);

        const fileMatch = text.match(/(?:^|[\s:"])([A-Za-z]:\\[^"]+\.(?:mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus|jpg|jpeg|png|webp|gif)|\/[^"]+\.(?:mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus|jpg|jpeg|png|webp|gif))/i);
        if (fileMatch?.[1]) files.add(fileMatch[1]);
      };

      pipeLines(child.stdout, handleLine);
      pipeLines(child.stderr, handleLine);

      child.on("error", (error) => {
        spawnError = error?.message ?? "Failed to start gallery-dl";
      });

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.runningProcs.delete(job.id);
        if (signal) canceled = true;
        if (timedOut && !spawnError) {
          spawnError = `gallery-dl timeout after ${Math.round(GALLERYDL_TIMEOUT_MS / 1000)}s`;
        }
        resolve({
          exitCode: Number.isInteger(code) ? code : 1,
          canceled,
          files: Array.from(files),
          error: spawnError,
          stderrTail: stderrTail.join(" | ")
        });
      });
    });
  }

  async _tryThumbnailFallback(job, mediaId = "") {
    const thumbnailUrl = String(job?.meta_thumbnail ?? "").trim();
    if (!thumbnailUrl) return null;
    if (!/^https?:\/\//i.test(thumbnailUrl)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), THUMBNAIL_FALLBACK_TIMEOUT_MS);
    try {
      job.last_message = "No media file from yt-dlp, trying preview image fallback...";
      this._emit(job);

      const response = await fetch(thumbnailUrl, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0",
          accept: "image/*,*/*;q=0.8"
        }
      });
      if (!response.ok) return null;

      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType && !contentType.startsWith("image/")) return null;

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > 20 * 1024 * 1024) {
        return null;
      }

      const fileExt = inferImageExtensionFromResponse(thumbnailUrl, contentType);
      const title = sanitizeFileStem(job?.meta_title || job?.section_title || "preview");
      const idPart = String(mediaId ?? "").trim() ? ` [${String(mediaId).trim()}]` : "";
      const fileName = `${title}${idPart}.${fileExt}`;
      const absolutePath = path.join(job.output_dir, fileName);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) return null;
      await fs.writeFile(absolutePath, bytes);
      return absolutePath;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function verifyMediaOutputs(filePaths, ffmpegLocation) {
  if (!ffmpegLocation) {
    return { ok: true, message: null };
  }
  const candidates = Array.isArray(filePaths) ? filePaths : [];
  const mediaFiles = [];
  for (const filePath of candidates) {
    if (!filePath) continue;
    const normalized = String(filePath);
    if (!VERIFYABLE_MEDIA_EXT_RE.test(normalized)) continue;
    const stats = await fs.stat(normalized).catch(() => null);
    if (!stats || !stats.isFile()) continue;
    mediaFiles.push({ filePath: normalized, size: Number(stats.size ?? 0) });
  }

  if (mediaFiles.length === 0) {
    return { ok: true, message: null };
  }

  for (const item of mediaFiles) {
    if (!Number.isFinite(item.size) || item.size <= 0) {
      return { ok: false, message: `${path.basename(item.filePath)} (empty or missing)` };
    }
    const isValid = await probeMediaFile(item.filePath, ffmpegLocation);
    if (!isValid) {
      return { ok: false, message: path.basename(item.filePath) };
    }
  }

  return { ok: true, message: null };
}

async function listOutputFileSnapshots(rootDir) {
  const result = new Map();
  const stack = [String(rootDir ?? "")];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = await fs.stat(absolutePath).catch(() => null);
      if (!stats || !stats.isFile()) continue;
      result.set(absolutePath, {
        mtimeMs: Number(stats.mtimeMs ?? 0),
        size: Number(stats.size ?? 0)
      });
    }
  }
  return result;
}

async function findOutputFilesById(rootDir, mediaId) {
  const id = String(mediaId ?? "").trim();
  if (!id) return [];
  const snapshots = await listOutputFileSnapshots(rootDir);
  const files = [];
  for (const filePath of snapshots.keys()) {
    if (!isTrackedOutputFile(filePath)) continue;
    const name = path.basename(filePath);
    if (!name.includes(`[${id}]`)) continue;
    files.push(filePath);
  }
  return files;
}

function diffOutputSnapshots(before, after) {
  const changed = [];
  const beforeMap = before instanceof Map ? before : new Map();
  const afterMap = after instanceof Map ? after : new Map();
  for (const [filePath, meta] of afterMap.entries()) {
    const prev = beforeMap.get(filePath);
    if (!prev) {
      changed.push(filePath);
      continue;
    }
    if (Number(prev.mtimeMs) !== Number(meta.mtimeMs) || Number(prev.size) !== Number(meta.size)) {
      changed.push(filePath);
    }
  }
  return changed;
}

function isTrackedOutputFile(filePath) {
  const value = String(filePath ?? "").trim();
  if (!value) return false;
  const name = path.basename(value).toLowerCase();
  if (!name) return false;
  if (name.startsWith(".yt-dlp-archive")) return false;
  if (name.endsWith(".part")) return false;
  if (name.endsWith(".ytdl")) return false;
  return TRACKED_OUTPUT_EXT_RE.test(name);
}

async function probeMediaFile(filePath, ffmpegLocation) {
  const checks = buildMediaProbeChecks(filePath, ffmpegLocation);
  for (const check of checks) {
    const ok = await runCommandExitZero(check.command, check.args, 45000).catch(() => false);
    if (ok) return true;
  }
  return false;
}

function buildMediaProbeChecks(filePath, ffmpegLocation) {
  const normalizedPath = path.resolve(filePath);
  const checks = [];
  const value = String(ffmpegLocation ?? "").trim();

  if (!value) {
    checks.push({
      command: FFPROBE_BIN,
      args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", normalizedPath]
    });
    checks.push({
      command: FFMPEG_BIN,
      args: ["-v", "error", "-i", normalizedPath, "-f", "null", "-"]
    });
    return checks;
  }

  if (value.toLowerCase() === "ffmpeg" || value.toLowerCase() === FFMPEG_BIN.toLowerCase()) {
    checks.push({
      command: FFPROBE_BIN,
      args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", normalizedPath]
    });
    checks.push({
      command: FFMPEG_BIN,
      args: ["-v", "error", "-i", normalizedPath, "-f", "null", "-"]
    });
    return checks;
  }

  const extension = path.extname(value).toLowerCase();
  if (extension) {
    const base = path.basename(value).toLowerCase();
    if (base === "ffprobe" || base === "ffprobe.exe") {
      checks.push({
        command: value,
        args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", normalizedPath]
      });
    } else {
      const ffprobePath = path.join(path.dirname(value), FFPROBE_BIN);
      checks.push({
        command: ffprobePath,
        args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", normalizedPath]
      });
      checks.push({
        command: value,
        args: ["-v", "error", "-i", normalizedPath, "-f", "null", "-"]
      });
    }
    return checks;
  }

  const ffprobePath = path.join(value, FFPROBE_BIN);
  const ffmpegPath = path.join(value, FFMPEG_BIN);
  checks.push({
    command: ffprobePath,
    args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", normalizedPath]
  });
  checks.push({
    command: ffmpegPath,
    args: ["-v", "error", "-i", normalizedPath, "-f", "null", "-"]
  });
  return checks;
}

function parsePercent(line) {
  const progressMarker = "__PROGRESS__";
  const source = line.includes(progressMarker)
    ? line.slice(line.indexOf(progressMarker) + progressMarker.length)
    : line;
  const match = source.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function normalizeYtDlpMetaValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^(na|n\/a|null|none|unknown)$/i.test(text)) return "";
  return text.length > 220 ? text.slice(0, 220).trim() : text;
}

function sanitizeFileStem(value) {
  const normalized = String(value ?? "")
    .replace(/[^\p{L}\p{N}\s._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const base = normalized || "preview";
  return base.length > 180 ? base.slice(0, 180).trim() : base;
}

function inferImageExtensionFromResponse(url, contentType = "") {
  const type = String(contentType ?? "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  try {
    const parsed = new URL(String(url ?? "").trim());
    const ext = path.extname(parsed.pathname).replace(/^\./, "").toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    // noop
  }
  return "jpg";
}

function buildSubprocessEnv(extra = null) {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    ...(extra && typeof extra === "object" ? extra : {})
  };
}

function pipeLines(stream, onLine) {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += String(chunk ?? "");
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      onLine(part);
    }
  });
  stream.on("end", () => {
    if (buffer) onLine(buffer);
    buffer = "";
  });
}

function toRelativeDisplayPath(baseDir, filePath) {
  const absoluteBase = path.resolve(baseDir);
  const absoluteFile = path.resolve(filePath);
  if (!absoluteFile.startsWith(`${absoluteBase}${path.sep}`)) {
    return path.basename(absoluteFile);
  }
  return path.relative(absoluteBase, absoluteFile).split(path.sep).join("/");
}

async function probeExecutable(command, args = ["--version"]) {
  try {
    await runCommandCaptureFirstLine(command, args, 12000);
    return true;
  } catch {
    return false;
  }
}

async function probeFfmpegLocation(location) {
  const value = String(location ?? "").trim();
  if (!value) return false;

  if (value.toLowerCase() === "ffmpeg" || value.toLowerCase() === FFMPEG_BIN.toLowerCase()) {
    return probeExecutable(FFMPEG_BIN, ["-version"]);
  }

  const stats = await fs.stat(value).catch(() => null);
  if (!stats) return false;

  const ffmpegPath = stats.isDirectory() ? path.join(value, FFMPEG_BIN) : value;
  if (!(await fileExists(ffmpegPath))) return false;
  return probeExecutable(ffmpegPath, ["-version"]);
}

async function runCommandCaptureFirstLine(command, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const child = spawn(command, args, { windowsHide: true, env: buildSubprocessEnv() });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // noop
      }
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Command failed: ${command}`));
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean);
      resolve(line ?? "");
    });
  });
}

async function runCommandCaptureOutput(command, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const child = spawn(command, args, { windowsHide: true, env: buildSubprocessEnv() });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // noop
      }
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        const text = trimOutputTail(`${stdout}\n${stderr}`.trim(), 3000);
        reject(new Error(text || `Command failed: ${command}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runCommandExitZero(command, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const child = spawn(command, args, { windowsHide: true, env: buildSubprocessEnv() });

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // noop
      }
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimOutputTail(text, maxLength = 2000) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return value.slice(-maxLength);
}
