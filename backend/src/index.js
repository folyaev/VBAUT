import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendEvent,
  ensureDataDir,
  ensureDocDir,
  getDataDir,
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
  getYtDlpVersion,
  isYtDlpCandidateUrl,
  resolveDownloaderTools,
  updateYtDlpBinary
} from "./downloader.js";
import { scrapeNotionPage } from "../../HeadlessNotion/notion-scraper.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerGenerationRoutes } from "./routes/generation.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerMiscRoutes } from "./routes/misc.js";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeMediaFilePath,
  normalizeSearchDecisionInput,
  normalizeSegmentForDecision,
  normalizeSegmentWithVisual,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "./services/normalizers.js";
import { createSegmentsMergeUtils } from "./services/segments-merge.js";
import { createXmlExportUtils } from "./services/xml-export.js";
import { createNotionProgressStore } from "./services/notion-progress.js";
import { createMediaDownloadStateUtils } from "./services/media-download-state.js";
import { createLinkPreviewUtils } from "./services/link-preview.js";
import { createDocumentStateUtils } from "./services/document-state.js";
import { createMediaFilesUtils } from "./services/media-files.js";
import { canonicalizeLinkUrl, isHttpUrl, normalizeLinkUrl, normalizeLinksInput } from "./services/links.js";
import { isNotionUrl, normalizeNotionUrl } from "./services/notion-url.js";
import { createSegmentsSessionUtils } from "./services/segments-session.js";
import { createRequestAuditLogger } from "./services/request-audit.js";
import { createUiActionsAuditStore } from "./services/ui-actions-audit.js";

const app = express();
export const DEFAULT_PORT = Number(process.env.PORT ?? 8787);
const execFileAsync = promisify(execFile);
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_MAX_FILES_LIST = Number.isFinite(Number(process.env.MEDIA_MAX_FILES_LIST))
  ? Math.max(20, Number(process.env.MEDIA_MAX_FILES_LIST))
  : 500;
const MEDIA_DOWNLOAD_ROOT = process.env.MEDIA_DOWNLOAD_ROOT || "C:\\Users\\Nemifist\\YandexDisk\\PAMPAM";
const API_AUDIT_LOG_ENABLED = String(process.env.API_AUDIT_LOG_ENABLED ?? "1") !== "0";
const API_AUDIT_LOG_INCLUDE_HEALTH = String(process.env.API_AUDIT_LOG_INCLUDE_HEALTH ?? "0") === "1";
const UI_ACTION_AUDIT_ENABLED = String(process.env.UI_ACTION_AUDIT_ENABLED ?? "1") !== "0";
const {
  finishNotionProgress,
  getNotionProgress,
  initNotionProgress,
  pruneNotionProgressStore,
  pushNotionProgress
} = createNotionProgressStore({
  ttlMs: 15 * 60 * 1000
});
const { appendActions: appendUiActionsAudit } = createUiActionsAuditStore({
  dataDir: getDataDir(),
  enabled: UI_ACTION_AUDIT_ENABLED
});
const {
  getDocumentLastSegmentedHash,
  inferNeedsSegmentationFromFileState,
  markDocumentSegmented,
  normalizeDocumentForResponse,
  readDocumentState,
  shouldInferNeedsSegmentation,
  syncDocumentSegmentationState
} = createDocumentStateUtils();
const {
  ensureMediaDir,
  ensureMediaTopicFoldersForSegments,
  getMediaDir,
  listMediaFiles,
  safeResolveMediaPath,
  sanitizeMediaTopicName
} = createMediaFilesUtils({
  mediaMaxFilesList: MEDIA_MAX_FILES_LIST,
  mediaRoot: MEDIA_DOWNLOAD_ROOT
});
const {
  isMediaAlreadyDownloaded,
  normalizeDocumentMediaDownloads,
  persistMediaDownloadState
} = createMediaDownloadStateUtils({
  appendEvent,
  canonicalizeLinkUrl,
  getDocDir,
  normalizeLinkUrl,
  readOptionalJson,
  writeJson
});
const { fetchLinkPreview } = createLinkPreviewUtils();
const { splitSegmentsAndDecisions } = createSegmentsSessionUtils({
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});

const {
  appendLinkDecisionsOverride,
  collapseDuplicateLinkOnlyTopics,
  getSectionMatchKey,
  mergeLinkSegmentsBySection,
  mergeSegmentsWithHistory,
  normalizeLinkSegmentsInput,
  normalizeSectionTitleForMatch
} = createSegmentsMergeUtils({
  emptySearchDecision,
  emptyVisualDecision,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});

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
app.use(
  createRequestAuditLogger({
    dataDir: getDataDir(),
    enabled: API_AUDIT_LOG_ENABLED,
    includeHealth: API_AUDIT_LOG_INCLUDE_HEALTH
  })
);

registerMiscRoutes(app, {
  appendUiActionsAudit,
  config,
  fetchLinkPreview,
  finishNotionProgress,
  getNotionProgress,
  imageProxyMaxBytes: IMAGE_PROXY_MAX_BYTES,
  initNotionProgress,
  isHttpUrl,
  isNotionUrl,
  normalizeLinkUrl,
  normalizeNotionUrl,
  pruneNotionProgressStore,
  pushNotionProgress,
  scrapeNotionPage,
  translateHeadingToEnglishQuery
});

registerMediaRoutes(app, {
  appendEvent,
  ensureMediaDir,
  getDocDir,
  getMediaDir,
  getYtDlpVersion,
  isHttpUrl,
  isMediaAlreadyDownloaded,
  isYtDlpCandidateUrl,
  listMediaFiles,
  mediaDownloadRoot: MEDIA_DOWNLOAD_ROOT,
  mediaDownloader,
  normalizeDocumentMediaDownloads,
  normalizeLinkUrl,
  readOptionalJson,
  safeResolveMediaPath,
  sanitizeMediaTopicName,
  updateYtDlpBinary
});
const {
  XML_EXPORT_DEFAULT_DURATION_SEC,
  XML_EXPORT_FPS,
  buildContentDisposition,
  buildXmlExportPayload
} = createXmlExportUtils({
  execFileAsync,
  downloaderTools,
  getMediaDir,
  normalizeMediaFilePath,
  normalizeSectionTitleForMatch,
  normalizeVisualDecisionInput,
  safeResolveMediaPath
});

registerDocumentRoutes(app, {
  appendEvent,
  emptySearchDecision,
  ensureDataDir,
  ensureDocDir,
  getDocDir,
  getDocumentLastSegmentedHash,
  inferNeedsSegmentationFromFileState,
  isNotionUrl,
  listDocuments,
  normalizeDecisionsInput,
  normalizeDocumentForResponse,
  normalizeNotionUrl,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput,
  readDocumentState,
  readEvents,
  readOptionalJson,
  saveVersioned,
  shouldInferNeedsSegmentation,
  syncDocumentSegmentationState,
  writeJson
});

registerGenerationRoutes(app, {
  appendEvent,
  appendLinkDecisionsOverride,
  collapseDuplicateLinkOnlyTopics,
  ensureMediaTopicFoldersForSegments,
  generateEnglishSearchDecisionsForSegments,
  generateSearchDecisionsForSegments,
  generateSegmentsOnly,
  generateVisualDecisionsForSegments,
  getDocDir,
  markDocumentSegmented,
  mergeLinkSegmentsBySection,
  mergeSegmentsWithHistory,
  normalizeDocumentForResponse,
  normalizeLinkSegmentsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentForDecision,
  normalizeSegmentWithVisual,
  normalizeVisualDecisionInput,
  readOptionalJson,
  saveVersioned,
  splitSegmentsAndDecisions,
  syncDocumentSegmentationState,
  writeJson
});

registerExportRoutes(app, {
  XML_EXPORT_DEFAULT_DURATION_SEC,
  XML_EXPORT_FPS,
  buildContentDisposition,
  buildXmlExportPayload,
  emptySearchDecision,
  emptyVisualDecision,
  getDocDir,
  getMediaDir,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeSectionTitleForMatch,
  normalizeVisualDecisionInput,
  readOptionalJson
});

export function getServerRuntimeInfo() {
  return {
    mediaRoot: MEDIA_DOWNLOAD_ROOT,
    tools: mediaDownloader.getToolsInfo()
  };
}

export { app };

