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
const VERIFYABLE_MEDIA_EXT_RE = /\.(mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const TRACKED_OUTPUT_EXT_RE = /\.(mp4|m4v|mov|mkv|webm|avi|mp3|m4a|aac|wav|flac|ogg|opus|jpg|jpeg|png|webp|gif)$/i;

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
  return YTDLP_CANDIDATE_HOSTS.some((pattern) => pattern.test(host));
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

  return {
    ytDlpPath,
    ffmpegLocation
  };
}

export class MediaDownloadQueue {
  constructor(options = {}) {
    this.ytDlpPath = options.ytDlpPath ?? null;
    this.ffmpegLocation = options.ffmpegLocation ?? null;
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

  getToolsInfo() {
    return {
      available: this.isAvailable(),
      yt_dlp_path: this.ytDlpPath,
      ffmpeg_location: this.ffmpegLocation,
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
    const normalizedUrl = String(url ?? "").trim();
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
      cancel_requested: false
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
      last_message: job.last_message
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
      job.output_files = [toRelativeDisplayPath(job.output_dir, predictedPath)];
      job.status = "completed";
      job.skip_reason = "file_exists";
      this._setProgress(job, 100, true);
      job.finished_at = new Date().toISOString();
      this._emit(job);
      return;
    }

    let result = null;
    let attempt = 0;
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

    job.status = "failed";
    job.error = result?.error || result?.stderrTail || `yt-dlp exited with code ${result?.exitCode ?? "unknown"}`;
    job.finished_at = new Date().toISOString();
    this._emit(job);
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
      "after_move:__FILE__%(filepath)s",
      "-f",
      DEFAULT_FORMAT,
      "--merge-output-format",
      "mp4",
      "--concurrent-fragments",
      "1",
      "--retries",
      "8",
      "--fragment-retries",
      "8",
      "--retry-sleep",
      "exp=1:30",
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
        windowsHide: true
      });
      this.runningProcs.set(job.id, child);

      const handleLine = (line) => {
        const text = String(line ?? "").trim();
        if (!text) return;
        job.last_message = text.slice(0, 500);

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
    const child = spawn(command, args, { windowsHide: true });

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

async function runCommandExitZero(command, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const child = spawn(command, args, { windowsHide: true });

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
