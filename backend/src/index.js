import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import path from "node:path";
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
import { registerIntegrationRoutes } from "./routes/integration.js";
import { registerResearchRoutes } from "./routes/research.js";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeMediaFilePath,
  normalizeResearchBundleTraceInput,
  normalizeResearchSourcesInput,
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
import { createTelegramSdvgBotService } from "./services/telegram-sdvg-bot.js";
import { createPersistentScreenshotBrowserService } from "./services/screenshot-browser.js";
import { createIntegrationStore } from "./services/integration-store.js";
import { createIntegrationSqliteMirrorService } from "./services/integration-sqlite.js";
import { loadIndexedArrayWithFallback, loadIndexedObjectWithFallback } from "./services/indexed-fallback-loaders.js";
import { createResearchStore } from "./services/research-store.js";
import { createSourceMemoryStore } from "./services/source-memory.js";
import { createSourceProfilesStore } from "./services/source-profiles.js";
import { createReleaseOutcomeMemoryStore } from "./services/release-outcome-memory.js";
import { createRuntimeBackupsService } from "./services/runtime-backups.js";
import { searchQueries } from "./services/research-search.js";
import { buildResearchBrief, buildResearchSummary, mergeResearchScores } from "./services/research-ranker.js";
import { generateSegmentResearchQueries, rankSegmentResearchResults } from "./services/research-qwen.js";

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
const integrationSqliteMirror = createIntegrationSqliteMirrorService({
  dataDir: getDataDir()
});
integrationSqliteMirror.ensureDatabase();
const integrationStore = createIntegrationStore({
  dataDir: getDataDir(),
  readOptionalJson,
  writeJson,
  onCollectionsChanged: async (snapshot, meta) => {
    integrationSqliteMirror.syncCollections(snapshot, meta);
  }
});
await integrationStore.ensureStore();
const sourceProfilesStore = createSourceProfilesStore({
  dataDir: getDataDir(),
  readOptionalJson,
  writeJson
});
const sourceMemoryStore = createSourceMemoryStore({
  dataDir: getDataDir(),
  readOptionalJson,
  writeJson
});
const releaseOutcomeMemoryStore = createReleaseOutcomeMemoryStore({
  dataDir: getDataDir(),
  readOptionalJson,
  writeJson
});
const researchStore = createResearchStore({
  ensureDocDir,
  getDocDir,
  readOptionalJson,
  writeJson,
  onRunsChanged: async (docId, runs, meta) => {
    integrationSqliteMirror.syncResearchRuns(docId, runs, meta);
  }
});
function normalizeDocumentMediaDownloadsForMirror(raw) {
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
        ? value.output_files.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 50)
        : [],
      updated_at: typeof value.updated_at === "string" ? value.updated_at : null
    };
  });
  return result;
}
async function syncPersistentMirrorFromDisk(reason = "startup") {
  integrationSqliteMirror.ensureDatabase();
  integrationSqliteMirror.syncCollections(await integrationStore.dumpCollections(), { reason });
  integrationSqliteMirror.syncAssistantMemory(
    {
      sourceProfiles: await sourceProfilesStore.getSourceProfiles(),
      sourceMemory: await sourceMemoryStore.getSourceMemory(),
      releaseOutcomeMemory: await releaseOutcomeMemoryStore.getReleaseOutcomeMemory()
    },
    { reason: `${reason}_assistant_memory` }
  );
  for (const documentItem of await listDocuments()) {
    const docId = String(documentItem?.id ?? "").trim();
    if (!docId) continue;
    try {
      const runs = await researchStore.listRuns(docId);
      integrationSqliteMirror.syncResearchRuns(docId, runs, { reason: `${reason}_research`, doc_id: docId });
    } catch {
      // ignore malformed legacy research files during sync
    }
    try {
      const dir = getDocDir(docId);
      const [segments, decisions, documentState] = await Promise.all([
        readOptionalJson(path.join(dir, "segments.json")).catch(() => []),
        readOptionalJson(path.join(dir, "decisions.json")).catch(() => []),
        readOptionalJson(path.join(dir, "document.json")).catch(() => null)
      ]);
      integrationSqliteMirror.syncDocumentState(docId, documentState, {
        reason: `${reason}_doc_document`,
        doc_id: docId
      });
      integrationSqliteMirror.syncDocumentContext(
        docId,
        Array.isArray(segments) ? segments : [],
        Array.isArray(decisions) ? decisions : [],
        { reason: `${reason}_doc_context`, doc_id: docId }
      );
      integrationSqliteMirror.syncDocumentMediaDownloads(
        docId,
        normalizeDocumentMediaDownloadsForMirror(documentState?.media_downloads),
        { reason: `${reason}_doc_media_downloads`, doc_id: docId }
      );
    } catch {
      // ignore malformed legacy document context during sync
    }
  }
}
await syncPersistentMirrorFromDisk("startup");
const runtimeBackups = createRuntimeBackupsService({
  dataDir: getDataDir(),
  checkpointSqliteMirror: (mode) => integrationSqliteMirror.checkpoint(mode),
  getSqliteMirrorStatus: () => integrationSqliteMirror.getStatus(),
  beforeRestore: async () => {
    integrationSqliteMirror.close();
  },
  afterRestore: async () => {
    await syncPersistentMirrorFromDisk("restore");
    return {
      sqlite: integrationSqliteMirror.getStatus()
    };
  }
});
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
  getDocumentState: async (docId) => getDocumentStateSafe(docId),
  getDocDir,
  normalizeLinkUrl,
  onPersistDocumentState: async (docId, document, reason) => {
    integrationSqliteMirror.syncDocumentState(docId, document, { reason, doc_id: docId });
  },
  onPersistMediaDownloads: async (docId, downloaded, reason) => {
    integrationSqliteMirror.syncDocumentMediaDownloads(docId, downloaded, { reason, doc_id: docId });
  },
  writeJson
});
const { splitSegmentsAndDecisions } = createSegmentsSessionUtils({
  normalizeLinksInput,
  normalizeResearchBundleTraceInput,
  normalizeResearchSourcesInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});
const screenshotBrowserService = createPersistentScreenshotBrowserService({
  dataDir: getDataDir(),
  env: process.env
});

const {
  applySegmentLinkHintsToSegments,
  appendLinkDecisionsOverride,
  buildSegmentLinkHintsFromRawText,
  collapseDuplicateLinkOnlyTopics,
  getSectionMatchKey,
  mergeLinkSegmentsBySection,
  mergeSegmentsWithHistory,
  normalizeLinkSegmentsInput,
  normalizeSegmentLinkHintsInput,
  normalizeSectionTitleForMatch
} = createSegmentsMergeUtils({
  emptySearchDecision,
  emptyVisualDecision,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});

const downloaderTools = await resolveDownloaderTools();
const { fetchLinkPreview } = createLinkPreviewUtils({
  ytDlpPath: downloaderTools.ytDlpPath
});
const mediaJobAuditState = new Map();
const MEDIA_AUDIT_STATE_MAX = 2000;
function mediaJobAuditSignature(job) {
  const outputFiles = Array.isArray(job?.output_files)
    ? job.output_files.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return JSON.stringify({
    status: String(job?.status ?? ""),
    progress: String(job?.progress ?? ""),
    error: String(job?.error ?? ""),
    output_files: outputFiles
  });
}
function rememberMediaJobAudit(jobId, signature) {
  const key = String(jobId ?? "").trim();
  if (!key) return false;
  const previous = mediaJobAuditState.get(key);
  if (previous === signature) return false;
  mediaJobAuditState.set(key, signature);
  if (mediaJobAuditState.size > MEDIA_AUDIT_STATE_MAX) {
    const overflow = mediaJobAuditState.size - MEDIA_AUDIT_STATE_MAX;
    let removed = 0;
    for (const id of mediaJobAuditState.keys()) {
      mediaJobAuditState.delete(id);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
  return true;
}
const mediaDownloader = new MediaDownloadQueue({
  ytDlpPath: downloaderTools.ytDlpPath,
  ffmpegLocation: downloaderTools.ffmpegLocation,
  galleryDlPath: downloaderTools.galleryDlPath,
  galleryDlPythonModule: downloaderTools.galleryDlPythonModule,
  maxConcurrent: Number(process.env.MEDIA_MAX_CONCURRENT ?? 1),
  startDelayMs: Number(process.env.MEDIA_START_DELAY_MS ?? 2500),
  onStateChange: (job) => {
    if (!["running", "completed", "failed", "canceled"].includes(job.status)) return;
    const signature = mediaJobAuditSignature(job);
    if (!rememberMediaJobAudit(job.id, signature)) return;
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

async function getSourceProfilesSafe() {
  try {
    const indexed = integrationSqliteMirror.getSourceProfiles();
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return sourceProfilesStore.getSourceProfiles();
}

async function listResearchRunsSafe(docId, options = {}) {
  try {
    const indexed = integrationSqliteMirror.listResearchRuns(docId, options);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  return researchStore.listRuns(docId);
}

async function listResearchRunsForSegmentSafe(docId, segmentId, options = {}) {
  try {
    const indexed = integrationSqliteMirror.listRunsForSegment(docId, segmentId, options);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  return researchStore.listRunsForSegment(docId, segmentId, options);
}

async function getLatestResearchRunSafe(docId, segmentId) {
  try {
    const indexed = integrationSqliteMirror.getLatestResearchRun(docId, segmentId);
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return researchStore.getLatestRun(docId, segmentId);
}

async function getResearchRunByIdSafe(docId, runId) {
  try {
    const indexed = integrationSqliteMirror.getResearchRunById(docId, runId);
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return researchStore.getRunById(docId, runId);
}

async function listIntegrationAssetsSafe(filters = {}) {
  try {
    const indexed = integrationSqliteMirror.listAssets(filters);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  return integrationStore.listAssets(filters);
}

async function getIntegrationReleaseSafe(releaseId) {
  try {
    const indexed = integrationSqliteMirror.getRelease(releaseId);
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return integrationStore.getRelease(releaseId);
}

async function syncDocumentContextSafe(docId, segments = [], decisions = [], reason = "doc_context_update") {
  integrationSqliteMirror.syncDocumentContext(docId, segments, decisions, { reason, doc_id: docId });
}

async function syncDocumentStateSafe(docId, document = null, reason = "doc_state_update") {
  integrationSqliteMirror.syncDocumentState(docId, document, { reason, doc_id: docId });
}

async function listDocSegmentsSafe(docId) {
  return loadIndexedArrayWithFallback(
    docId,
    (normalizedId) => integrationSqliteMirror.listDocSegments(normalizedId),
    (normalizedId) => readOptionalJson(path.join(getDocDir(normalizedId), "segments.json")).catch(() => [])
  );
}

async function listDocDecisionsSafe(docId) {
  return loadIndexedArrayWithFallback(
    docId,
    (normalizedId) => integrationSqliteMirror.listDocDecisions(normalizedId),
    (normalizedId) => readOptionalJson(path.join(getDocDir(normalizedId), "decisions.json")).catch(() => [])
  );
}

async function getDocumentMediaDownloadsSafe(docId) {
  return loadIndexedObjectWithFallback(
    docId,
    (normalizedId) => integrationSqliteMirror.getDocumentMediaDownloads(normalizedId),
    async (normalizedId) => {
      const document = await readOptionalJson(path.join(getDocDir(normalizedId), "document.json")).catch(() => null);
      return normalizeDocumentMediaDownloads(document?.media_downloads);
    },
    {}
  );
}

async function getDocumentStateSafe(docId) {
  return loadIndexedObjectWithFallback(
    docId,
    (normalizedId) => integrationSqliteMirror.getDocumentState(normalizedId),
    async (normalizedId) => readOptionalJson(path.join(getDocDir(normalizedId), "document.json")).catch(() => null),
    null
  );
}

async function readDocumentStateSafe(dir, document = null) {
  const docId = String(document?.id ?? path.basename(String(dir ?? "")) ?? "").trim();
  if (docId) {
    try {
      const indexed = integrationSqliteMirror.summarizeDocumentState(docId);
      if (indexed && (indexed.updated_at || Number(indexed.revision ?? 0) > 0)) {
        return indexed;
      }
    } catch {
      // fallback below
    }
  }
  return readDocumentState(dir, document);
}

async function listDocSegmentsWithoutVisualSafe(docId, limit = 20) {
  try {
    const indexed = integrationSqliteMirror.listDocSegmentsWithoutVisual(docId, limit);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  const [segments, decisions] = await Promise.all([listDocSegmentsSafe(docId), listDocDecisionsSafe(docId)]);
  const decisionMap = new Map(
    (Array.isArray(decisions) ? decisions : []).map((item) => [String(item?.segment_id ?? "").trim(), item?.visual_decision ?? {}])
  );
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => {
      const segmentId = String(segment?.segment_id ?? "").trim();
      const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
      if (!segmentId || blockType === "links" || /^comments_/i.test(segmentId)) return false;
      const visual = decisionMap.get(segmentId) ?? segment?.visual_decision ?? {};
      return !(
        String(visual?.description ?? "").trim() ||
        String(visual?.format_hint ?? "").trim() ||
        String(visual?.priority ?? "").trim() ||
        String(visual?.media_file_path ?? "").trim() ||
        (Array.isArray(visual?.media_file_paths) && visual.media_file_paths.some((entry) => String(entry ?? "").trim())) ||
        ((visual?.duration_hint_sec ?? null) !== null && (visual?.duration_hint_sec ?? null) !== undefined) ||
        (String(visual?.type ?? "").trim() && String(visual?.type ?? "").trim() !== "no_visual")
      );
    })
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((segment) => ({
      segment_id: String(segment?.segment_id ?? "").trim(),
      section_title: String(segment?.section_title ?? "").trim(),
      has_links: Array.isArray(segment?.links) ? segment.links.some((item) => String(item?.url ?? item ?? "").trim()) : false
    }));
}

async function listOrphanScreenshotsForReleaseSafe(releaseId, documentId, limit = 20) {
  try {
    const indexed = integrationSqliteMirror.listOrphanScreenshotsForRelease(releaseId, documentId, limit);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  const assets = await listIntegrationAssetsSafe({ kind: "screenshot", limit: 1000 });
  return assets
    .filter((asset) => {
      const assetId = String(asset?.id ?? "").trim();
      if (!assetId) return false;
      const targets = Array.isArray(asset?.targets) ? asset.targets : [];
      if (targets.some((target) => target?.target_type === "release" && String(target?.target_id ?? "") === String(releaseId ?? ""))) {
        return false;
      }
      if (!documentId) return true;
      return targets.some(
        (target) =>
          (target?.target_type === "document" && String(target?.target_id ?? "") === String(documentId ?? "")) ||
          target?.target_type === "segment"
      );
    })
    .slice(0, Math.max(1, Number(limit) || 20));
}

async function listRecommendationCandidatesForReleaseSafe(releaseId, documentId, options = {}) {
  const normalizedLimit = Math.max(1, Number(options?.limit) || 400);
  const sectionTitles = Array.from(
    new Set(
      (Array.isArray(options?.section_titles) ? options.section_titles : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const domains = Array.from(
    new Set(
      (Array.isArray(options?.domains) ? options.domains : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  try {
    const indexed = integrationSqliteMirror.listRecommendationCandidatesForRelease(releaseId, documentId, {
      limit: normalizedLimit,
      section_titles: sectionTitles,
      domains
    });
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  const release = await getIntegrationReleaseSafe(releaseId);
  const releaseAssetIds = new Set(
    (Array.isArray(release?.assets) ? release.assets : [])
      .map((item) => String(item?.asset?.id ?? "").trim())
      .filter(Boolean)
  );
  return (await listIntegrationAssetsSafe({ limit: normalizedLimit }))
    .filter((asset) => {
      const assetId = String(asset?.id ?? "").trim();
      if (!assetId || releaseAssetIds.has(assetId)) return false;
      const status = String(asset?.status ?? "").trim().toLowerCase();
      if (status === "archived" || status === "failed") return false;
      const processingState = String(asset?.processing_state ?? asset?.meta_json?.processing_state ?? "").trim().toLowerCase();
      if (processingState === "failed") return false;
      const kind = String(asset?.kind ?? "").trim().toLowerCase();
      if (!["screenshot", "telegram_media", "downloaded_media", "preview", "link", "note"].includes(kind)) return false;
      const sectionTitle = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
      const sourceDomain = String(asset?.source_domain ?? "").trim().toLowerCase();
      const targets = Array.isArray(asset?.targets) ? asset.targets : [];
      const sameDocContext =
        !documentId ||
        targets.some(
          (target) =>
            (target?.target_type === "document" && String(target?.target_id ?? "") === String(documentId ?? "")) ||
            target?.target_type === "segment"
        );
      const sameSection = sectionTitles.length > 0 && sectionTitle && sectionTitles.includes(sectionTitle);
      const sameDomain = domains.length > 0 && sourceDomain && domains.includes(sourceDomain);
      return sameDocContext || sameSection || sameDomain || sectionTitles.length === 0;
    })
    .sort((left, right) => {
      const leftSection = String(left?.meta_json?.section_title ?? "").trim().toLowerCase();
      const rightSection = String(right?.meta_json?.section_title ?? "").trim().toLowerCase();
      const leftDomain = String(left?.source_domain ?? "").trim().toLowerCase();
      const rightDomain = String(right?.source_domain ?? "").trim().toLowerCase();
      const leftScore = (sectionTitles.includes(leftSection) ? 2 : 0) + (domains.includes(leftDomain) ? 1 : 0);
      const rightScore = (sectionTitles.includes(rightSection) ? 2 : 0) + (domains.includes(rightDomain) ? 1 : 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return String(right?.updated_at ?? "").localeCompare(String(left?.updated_at ?? ""));
    })
    .slice(0, normalizedLimit);
}

async function listRecommendationCandidatesForItemSafe(releaseId, documentId, options = {}) {
  const normalizedLimit = Math.max(1, Number(options?.limit) || 80);
  const sectionTitle = String(options?.section_title ?? "").trim().toLowerCase();
  const domains = Array.from(
    new Set(
      (Array.isArray(options?.domains) ? options.domains : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const researchDomains = Array.from(
    new Set(
      (Array.isArray(options?.research_domains) ? options.research_domains : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const researchTitles = Array.from(
    new Set(
      (Array.isArray(options?.research_titles) ? options.research_titles : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const mode = String(options?.mode ?? "visual").trim().toLowerCase();
  const allowedKinds =
    mode === "source"
      ? ["link", "note", "preview"]
      : mode === "visual"
        ? ["screenshot", "telegram_media", "downloaded_media", "preview"]
        : ["screenshot", "telegram_media", "downloaded_media", "preview", "link", "note"];
  try {
    const indexed = integrationSqliteMirror.listRecommendationCandidatesForItem(releaseId, documentId, {
      limit: normalizedLimit,
      section_title: sectionTitle,
      domains,
      research_domains: researchDomains,
      research_titles: researchTitles,
      mode
    });
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  const release = await getIntegrationReleaseSafe(releaseId);
  const releaseAssetIds = new Set(
    (Array.isArray(release?.assets) ? release.assets : [])
      .map((item) => String(item?.asset?.id ?? "").trim())
      .filter(Boolean)
  );
  return (await listIntegrationAssetsSafe({ limit: normalizedLimit * 2 }))
    .filter((asset) => {
      const assetId = String(asset?.id ?? "").trim();
      if (!assetId || releaseAssetIds.has(assetId)) return false;
      const status = String(asset?.status ?? "").trim().toLowerCase();
      if (status === "archived" || status === "failed") return false;
      const processingState = String(asset?.processing_state ?? asset?.meta_json?.processing_state ?? "").trim().toLowerCase();
      if (processingState === "failed") return false;
      const kind = String(asset?.kind ?? "").trim().toLowerCase();
      if (!allowedKinds.includes(kind)) return false;
      const assetSection = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
      const assetDomain = String(asset?.source_domain ?? "").trim().toLowerCase();
      const assetTitle = String(asset?.title ?? "").trim().toLowerCase();
      const targets = Array.isArray(asset?.targets) ? asset.targets : [];
      const sameDocContext =
        !documentId ||
        targets.some(
          (target) =>
            (target?.target_type === "document" && String(target?.target_id ?? "") === String(documentId ?? "")) ||
            target?.target_type === "segment"
        );
      const sameSection = Boolean(sectionTitle && assetSection === sectionTitle);
      const sameDomain = Boolean(assetDomain && domains.includes(assetDomain));
      const sameResearchDomain = Boolean(assetDomain && researchDomains.includes(assetDomain));
      const sameResearchTitle = Boolean(assetTitle && researchTitles.includes(assetTitle));
      return sameSection || sameDomain || sameResearchDomain || sameResearchTitle || sameDocContext;
    })
    .sort((left, right) => {
      const leftSection = String(left?.meta_json?.section_title ?? "").trim().toLowerCase();
      const rightSection = String(right?.meta_json?.section_title ?? "").trim().toLowerCase();
      const leftDomain = String(left?.source_domain ?? "").trim().toLowerCase();
      const rightDomain = String(right?.source_domain ?? "").trim().toLowerCase();
      const leftTitle = String(left?.title ?? "").trim().toLowerCase();
      const rightTitle = String(right?.title ?? "").trim().toLowerCase();
      const leftScore =
        (researchTitles.includes(leftTitle) ? 4 : 0) +
        (researchDomains.includes(leftDomain) ? 3 : 0) +
        (leftSection === sectionTitle ? 2 : 0) +
        (domains.includes(leftDomain) ? 1 : 0);
      const rightScore =
        (researchTitles.includes(rightTitle) ? 4 : 0) +
        (researchDomains.includes(rightDomain) ? 3 : 0) +
        (rightSection === sectionTitle ? 2 : 0) +
        (domains.includes(rightDomain) ? 1 : 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return String(right?.updated_at ?? "").localeCompare(String(left?.updated_at ?? ""));
    })
    .slice(0, normalizedLimit);
}

async function summarizeReleaseAssistantSafe(releaseId) {
  try {
    const indexed = integrationSqliteMirror.summarizeReleaseAssistant(releaseId);
    if (indexed && typeof indexed === "object") return indexed;
  } catch {
    // fallback below
  }
  return null;
}

async function listReleaseItemsByGapSafe(releaseId, gap = "missing_visual", limit = 20) {
  try {
    const indexed = integrationSqliteMirror.listReleaseItemsByGap(releaseId, gap, limit);
    if (Array.isArray(indexed)) return indexed;
  } catch {
    // fallback below
  }
  const release = await getIntegrationReleaseSafe(releaseId);
  const items = Array.isArray(release?.assets) ? release.assets : [];
  const normalizedGap = String(gap ?? "").trim().toLowerCase();
  return items
    .filter((item) => {
      const attachment = item?.attachment ?? {};
      const asset = item?.asset ?? {};
      if (normalizedGap === "missing_script") return !String(attachment?.script_note ?? "").trim();
      if (normalizedGap === "needs_link") return !String(asset?.source_url ?? "").trim();
      return !String(attachment?.visual_note ?? "").trim();
    })
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((item) => ({
      attachment_id: String(item?.attachment?.id ?? "").trim(),
      asset_id: String(item?.asset?.id ?? "").trim(),
      title: String(item?.asset?.title || item?.asset?.file_name || item?.asset?.id || "").trim(),
      section_title: String(item?.asset?.meta_json?.section_title ?? "").trim(),
      item_status: String(item?.attachment?.item_status || "planned").trim(),
      source_url: String(item?.asset?.source_url ?? "").trim(),
      source_domain: String(item?.asset?.source_domain ?? "").trim()
    }))
    .filter((item) => item.attachment_id && item.asset_id);
}

async function updateSourceProfilesMirrored(nextProfiles) {
  const profiles = await sourceProfilesStore.updateSourceProfiles(nextProfiles);
  integrationSqliteMirror.syncAssistantMemory(
    { sourceProfiles: profiles },
    { reason: "source_profiles_update" }
  );
  return profiles;
}

async function getSourceMemorySafe() {
  try {
    const indexed = integrationSqliteMirror.getSourceMemory();
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return sourceMemoryStore.getSourceMemory();
}

function summarizeSourceMemorySafe(memory = null) {
  try {
    const indexedSummary = integrationSqliteMirror.summarizeSourceMemory();
    if (indexedSummary) return indexedSummary;
  } catch {
    // fallback below
  }
  return sourceMemoryStore.summarizeMemory(memory ?? {});
}

async function recordSourceUsageMirrored(input) {
  const memory = await sourceMemoryStore.recordSourceUsage(input);
  integrationSqliteMirror.syncAssistantMemory(
    { sourceMemory: memory },
    { reason: "source_memory_update" }
  );
  return memory;
}

async function getReleaseOutcomeMemorySafe() {
  try {
    const indexed = integrationSqliteMirror.getReleaseOutcomeMemory();
    if (indexed) return indexed;
  } catch {
    // fallback below
  }
  return releaseOutcomeMemoryStore.getReleaseOutcomeMemory();
}

function summarizeReleaseOutcomeMemorySafe(memory = null) {
  try {
    const indexedSummary = integrationSqliteMirror.summarizeReleaseOutcomeMemory();
    if (indexedSummary) return indexedSummary;
  } catch {
    // fallback below
  }
  return releaseOutcomeMemoryStore.summarizeReleaseOutcomeMemory(memory ?? {});
}

async function recordReleaseOutcomeMirrored(input) {
  const memory = await releaseOutcomeMemoryStore.recordReleaseOutcome(input);
  integrationSqliteMirror.syncAssistantMemory(
    { releaseOutcomeMemory: memory },
    { reason: "release_outcome_update" }
  );
  return memory;
}

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
  attachAsset: integrationStore.attachAsset,
  config,
  createAsset: integrationStore.createAsset,
  dataDir: getDataDir(),
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
  sourceMemoryStore: {
    ...sourceMemoryStore,
    getSourceMemory: getSourceMemorySafe,
    summarizeMemory: summarizeSourceMemorySafe
  },
  releaseOutcomeMemoryStore: {
    ...releaseOutcomeMemoryStore,
    getReleaseOutcomeMemory: getReleaseOutcomeMemorySafe,
    summarizeReleaseOutcomeMemory: summarizeReleaseOutcomeMemorySafe
  },
  sourceProfilesStore: {
    ...sourceProfilesStore,
    getSourceProfiles: getSourceProfilesSafe,
    updateSourceProfiles: updateSourceProfilesMirrored
  },
  screenshotBrowserService,
  scrapeNotionPage,
  translateHeadingToEnglishQuery
});

registerMediaRoutes(app, {
  appendEvent,
  ensureMediaDir,
  getDocumentMediaDownloads: getDocumentMediaDownloadsSafe,
  getDocumentState: getDocumentStateSafe,
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
  getDocumentState: getDocumentStateSafe,
  listDocDecisions: listDocDecisionsSafe,
  listDocSegments: listDocSegmentsSafe,
  listResearchRuns: listResearchRunsSafe,
  syncDocumentState: syncDocumentStateSafe,
  syncDocumentContext: syncDocumentContextSafe,
  readDocumentState: readDocumentStateSafe,
  readEvents,
  readOptionalJson,
  saveVersioned,
  shouldInferNeedsSegmentation,
  syncDocumentSegmentationState,
  writeJson
});

registerGenerationRoutes(app, {
  applySegmentLinkHintsToSegments,
  appendEvent,
  appendLinkDecisionsOverride,
  buildSegmentLinkHintsFromRawText,
  collapseDuplicateLinkOnlyTopics,
  ensureMediaTopicFoldersForSegments,
  generateEnglishSearchDecisionsForSegments,
  generateSearchDecisionsForSegments,
  generateSegmentsOnly,
  generateVisualDecisionsForSegments,
  getDocDir,
  listDocDecisions: listDocDecisionsSafe,
  listDocSegments: listDocSegmentsSafe,
  markDocumentSegmented,
  mergeLinkSegmentsBySection,
  mergeSegmentsWithHistory,
  normalizeDocumentForResponse,
  normalizeLinkSegmentsInput,
  normalizeSegmentLinkHintsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentForDecision,
  normalizeSegmentWithVisual,
  normalizeVisualDecisionInput,
  getDocumentState: getDocumentStateSafe,
  readOptionalJson,
  saveVersioned,
  splitSegmentsAndDecisions,
  syncDocumentState: syncDocumentStateSafe,
  syncDocumentContext: syncDocumentContextSafe,
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
  getDataDir,
  getDocumentState: getDocumentStateSafe,
  getDocDir,
  getMediaDir,
  listDocDecisions: listDocDecisionsSafe,
  listDocSegments: listDocSegmentsSafe,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeSectionTitleForMatch,
  normalizeVisualDecisionInput,
  readOptionalJson,
  writeJson
});

registerIntegrationRoutes(app, {
  attachAsset: integrationStore.attachAsset,
  appendActivity: integrationStore.appendActivity,
  createAsset: integrationStore.createAsset,
  createRelease: integrationStore.createRelease,
  getAssetIndexed: integrationSqliteMirror.getAsset,
  getAsset: integrationStore.getAsset,
  getDocumentState: getDocumentStateSafe,
  getDocDir,
  getOverviewIndexed: integrationSqliteMirror.getOverview,
  getOverview: integrationStore.getOverview,
  getReleaseIndexed: integrationSqliteMirror.getRelease,
  getRelease: integrationStore.getRelease,
  listAssetsIndexed: integrationSqliteMirror.listAssets,
  listAssets: listIntegrationAssetsSafe,
  listDocSegments: listDocSegmentsSafe,
  listDocDecisions: listDocDecisionsSafe,
  listDocSegmentsWithoutVisual: listDocSegmentsWithoutVisualSafe,
  listOrphanScreenshotsForRelease: listOrphanScreenshotsForReleaseSafe,
  listRecommendationCandidatesForRelease: listRecommendationCandidatesForReleaseSafe,
  listRecommendationCandidatesForItem: listRecommendationCandidatesForItemSafe,
  summarizeReleaseAssistant: summarizeReleaseAssistantSafe,
  listReleaseItemsByGap: listReleaseItemsByGapSafe,
  listResearchRuns: listResearchRunsSafe,
  listBotSessions: integrationStore.listBotSessions,
  listBotSessionsIndexed: integrationSqliteMirror.listBotSessions,
  listJobsIndexed: integrationSqliteMirror.listJobs,
  listReleaseActivitiesIndexed: integrationSqliteMirror.listReleaseActivities,
  listReleaseActivities: integrationStore.listReleaseActivities,
  listReleasesIndexed: integrationSqliteMirror.listReleases,
  listReleases: integrationStore.listReleases,
  getDocumentMediaDownloads: getDocumentMediaDownloadsSafe,
  normalizeDocumentMediaDownloads,
  normalizeVisualDecisionInput,
  getSourceMemory: getSourceMemorySafe,
  getReleaseOutcomeMemory: getReleaseOutcomeMemorySafe,
  recordReleaseOutcome: recordReleaseOutcomeMirrored,
  readOptionalJson,
  createRuntimeBackup: (options) => runtimeBackups.createBackup(options),
  getRuntimeBackupsStatus: () => runtimeBackups.getStatus(),
  getRuntimeBackupById: (backupId) => runtimeBackups.getBackupById(backupId),
  dryRunRuntimeBackupRestore: (backupId) => runtimeBackups.dryRunRestore(backupId),
  restoreRuntimeBackup: (backupId) => runtimeBackups.restoreBackup(backupId),
  removeAttachment: integrationStore.removeAttachment,
  reorderReleaseAttachments: integrationStore.reorderReleaseAttachments,
  reindexSqliteMirror: async () =>
    integrationSqliteMirror.syncCollections(await integrationStore.dumpCollections(), { reason: "manual_reindex" }),
  getSqliteMirrorStatus: integrationSqliteMirror.getStatus,
  updateAttachment: integrationStore.updateAttachment,
  updateAsset: integrationStore.updateAsset,
  updateRelease: integrationStore.updateRelease,
  upsertBotSession: integrationStore.upsertBotSession
});

registerResearchRoutes(app, {
  appendEvent,
  attachAsset: integrationStore.attachAsset,
  createAsset: integrationStore.createAsset,
  emptySearchDecision,
  emptyVisualDecision,
  getDocumentState: getDocumentStateSafe,
  getDocDir,
  getLatestRun: getLatestResearchRunSafe,
  getRunById: getResearchRunByIdSafe,
  getSourceMemory: getSourceMemorySafe,
  getSourceProfiles: getSourceProfilesSafe,
  listDocDecisions: listDocDecisionsSafe,
  listDocSegments: listDocSegmentsSafe,
  listRunsForSegment: listResearchRunsForSegmentSafe,
  markApplied: researchStore.markApplied,
  buildResearchBrief,
  mergeResearchScores,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput,
  recordSourceUsage: recordSourceUsageMirrored,
  buildResearchSummary,
  generateSegmentResearchQueries,
  rankSegmentResearchResults,
  readOptionalJson,
  saveRun: researchStore.saveRun,
  searchQueries,
  syncDocumentContext: syncDocumentContextSafe,
  translateHeadingToEnglishQuery,
  writeJson
});

const telegramSdvgBot = createTelegramSdvgBotService({
  appendLinkDecisionsOverride,
  appendEvent,
  attachAsset: integrationStore.attachAsset,
  canonicalizeLinkUrl,
  collapseDuplicateLinkOnlyTopics,
  createAsset: integrationStore.createAsset,
  ensureMediaDir,
  getDocumentMediaDownloads: getDocumentMediaDownloadsSafe,
  getDocumentState: getDocumentStateSafe,
  getDocDir,
  getMediaDir,
  getSourceMemory: getSourceMemorySafe,
  getSourceProfiles: getSourceProfilesSafe,
  generateSegmentResearchQueries,
  isHttpUrl,
  isMediaAlreadyDownloaded,
  isYtDlpCandidateUrl,
  listDocDecisions: listDocDecisionsSafe,
  listDocuments,
  listDocSegments: listDocSegmentsSafe,
  listRunsForSegment: listResearchRunsForSegmentSafe,
  mediaDownloader,
  mergeResearchScores,
  mergeLinkSegmentsBySection,
  normalizeDocumentMediaDownloads,
  normalizeLinkSegmentsInput,
  normalizeLinkUrl,
  rankSegmentResearchResults,
  readOptionalJson,
  sanitizeMediaTopicName,
  saveVersioned,
  searchQueries,
  splitSegmentsAndDecisions,
  syncDocumentContext: syncDocumentContextSafe,
  updateSourceProfiles: updateSourceProfilesMirrored,
  upsertBotSession: integrationStore.upsertBotSession
});
telegramSdvgBot.start();
screenshotBrowserService.startBackground().catch(() => null);

export function getServerRuntimeInfo() {
  return {
    integration: {
      data_dir: `${getDataDir()}/_integration`,
      sqlite_mirror: integrationSqliteMirror.getStatus()
    },
    mediaRoot: MEDIA_DOWNLOAD_ROOT,
    tools: mediaDownloader.getToolsInfo(),
    telegram: telegramSdvgBot.getRuntimeInfo(),
    screenshot_browser: screenshotBrowserService.getRuntimeInfo()
  };
}

export async function shutdownServerRuntime() {
  integrationSqliteMirror.close();
}

export { app };

