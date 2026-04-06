import React from "react";
import { buildSourceMetadataBadges } from "../utils/sourceMetadata.js";

function formatRecommendationReasonTag(reason = {}) {
  const key = String(reason?.key ?? "").trim().toLowerCase();
  if (!key) return "";
  if (key === "research_domain") return "Research Domain";
  if (key === "research_visual") return "Research Visual";
  if (key === "research_source") return "Research Source";
  if (key === "source_memory_helpful") return "Helpful Before";
  if (key === "source_memory_used") return "Used Before";
  if (key === "release_outcome_domain") return "Worked in Releases";
  if (key === "release_outcome_kind") return "Successful Asset Type";
  if (key === "same_section") return "Same Section";
  if (key === "same_domain") return "Same Domain";
  if (key === "visual_candidate") return "Visual Candidate";
  return String(reason?.label ?? key).trim();
}

function collectRecommendationMemoryBadges(reasons = []) {
  const badges = [];
  (Array.isArray(reasons) ? reasons : []).forEach((reason) => {
    const key = String(reason?.key ?? "").trim().toLowerCase();
    const rawLabel = String(reason?.label ?? "").trim();
    const countMatch = rawLabel.match(/x(\d+)/i);
    if (key === "source_memory_helpful") {
      badges.push(countMatch ? `Helpful x${countMatch[1]}` : "Helpful Before");
      return;
    }
    if (key === "source_memory_used") {
      badges.push(countMatch ? `Used x${countMatch[1]}` : "Used Before");
    }
  });
  return [...new Set(badges)];
}

function buildRecommendationExplainLine(item = {}, index = -1) {
  if (index < 0 || index > 2) return "";
  const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
  const labels = reasons
    .filter((reason) => String(reason?.key ?? "").trim().toLowerCase() !== "matched_segment")
    .slice(0, 2)
    .map((reason) => formatRecommendationReasonTag(reason))
    .filter(Boolean);
  if (labels.length === 0) return "";
  return `Attach Top 3 sees this as: ${labels.join(" + ")}`;
}

function buildRecommendationBatchPreview(item = {}) {
  const asset = item?.asset ?? {};
  const title = String(asset?.title || asset?.file_name || asset?.id || "Asset").trim();
  const bucket = formatRecommendationBucketLabel(item?.bucket);
  const memoryBadges = collectRecommendationMemoryBadges(item?.reasons);
  return {
    id: String(asset?.id ?? "").trim() || title,
    title,
    bucket,
    memory: memoryBadges[0] || ""
  };
}

function formatResearchReasonTagLabel(tag = "") {
  const normalized = String(tag ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ru_blocked") return "RU blocked";
  if (normalized === "responsive") return "Responsive";
  if (normalized === "watermarks") return "Watermarks";
  if (normalized.startsWith("quality:")) return String(tag).trim().slice("quality:".length).toUpperCase();
  if (normalized.startsWith("lang:")) return `Lang ${String(tag).trim().slice("lang:".length).toUpperCase()}`;
  return "";
}

function getVisibleResearchMetadataBadges(entry = {}) {
  return Array.from(
    new Set(
      (Array.isArray(entry?.reason_tags) ? entry.reason_tags : [])
        .map((tag) => formatResearchReasonTagLabel(tag))
        .filter(Boolean)
    )
  );
}

function formatPickedFromLabel(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "research_bundle") return "Research Bundle";
  if (normalized === "research_brief") return "Research Brief";
  if (normalized === "assistant_recommendation") return "Assistant Recommendation";
  if (normalized === "research_backup_visual") return "Backup Visual";
  if (normalized === "research_backup_source") return "Backup Source";
  if (normalized === "research_fallback_visual") return "Fallback Visual";
  if (normalized === "research_fallback_source") return "Fallback Source";
  return normalized.replace(/_/g, " ");
}

function formatReadyStateLabel(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ready") return "Ready";
  if (normalized === "capture_needed") return "Capture Needed";
  if (normalized === "download_needed") return "Download Needed";
  if (normalized === "backup_only") return "Backup Only";
  if (normalized === "downloaded") return "Downloaded";
  if (normalized === "captured") return "Captured";
  return normalized.replace(/_/g, " ");
}

function formatHandoffStatusLabel(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ready") return "Ready";
  if (normalized === "pending_capture") return "Pending Capture";
  if (normalized === "pending_download") return "Pending Download";
  if (normalized === "backup_only") return "Backup Only";
  if (normalized === "no_files") return "No Files";
  return normalized.replace(/_/g, " ");
}

function formatHandoffResolvedEventLabel(event = "") {
  const normalized = String(event ?? "").trim().toLowerCase();
  if (normalized === "handoff_download_resolved") return "Download resolved";
  if (normalized === "handoff_capture_resolved") return "Capture resolved";
  return "";
}

function formatPairSwitchEventLabel(event = "", meta = {}) {
  const normalizedEvent = String(event ?? "").trim().toLowerCase();
  const action = String(meta?.action ?? "").trim().toLowerCase();
  if (normalizedEvent === "manual_override") return "Manual override";
  if (normalizedEvent === "research_pick_applied") {
    if (action === "research_pick") return "Research pair applied";
    if (action === "research_pick_source") return "Research source updated";
    if (action === "research_pick_visual") return "Research visual updated";
    return "Research pick applied";
  }
  return "";
}

function normalizeComparablePickLabel(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function getCurrentPairBadgeClassName(value = "") {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "main pair") return "segment-current-pair-badge is-main";
  if (key === "backup pair") return "segment-current-pair-badge is-backup";
  if (key === "mixed pair") return "segment-current-pair-badge is-mixed";
  if (key === "custom pair") return "segment-current-pair-badge is-custom";
  return "segment-current-pair-badge";
}

function normalizeComparableUrl(value = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

function formatEffectiveHandoffState(item = {}, downloadState = null) {
  const serverEffectiveState = String(item?.effective_ready_state ?? "").trim().toLowerCase();
  if (serverEffectiveState) return formatReadyStateLabel(serverEffectiveState);
  const readyState = String(item?.ready_state ?? "").trim().toLowerCase();
  const downloadStateKey = String(downloadState?.state ?? "").trim().toLowerCase();
  if (readyState === "download_needed") {
    if (downloadStateKey === "completed") return "Downloaded";
    if (downloadStateKey === "running") return "Downloading";
    if (downloadStateKey === "queued") return "Queued Download";
  }
  if (readyState === "capture_needed" && String(item?.capture_state ?? "").trim().toLowerCase() === "completed") {
    return "Captured";
  }
  return formatReadyStateLabel(readyState);
}

function deriveTraceConfidenceBadges(item = {}) {
  const attachment = item?.attachment ?? {};
  const trace = attachment?.assistant_trace_json ?? {};
  const badges = [];
  const scriptNote = String(attachment?.script_note ?? "").trim();
  const visualNote = String(attachment?.visual_note ?? "").trim();
  const tracedScriptNote = String(trace?.script?.note ?? "").trim();
  const tracedVisualNote = String(trace?.visual?.note ?? "").trim();

  if (
    String(trace?.research?.section_title ?? "").trim() ||
    String(trace?.script?.section_title ?? "").trim() ||
    String(trace?.visual?.section_title ?? "").trim()
  ) {
    badges.push("Research-backed");
  }
  if (
    String(trace?.visual?.recommendation?.asset_id ?? "").trim() ||
    String(trace?.visual?.recommendation?.title ?? "").trim()
  ) {
    badges.push("Recommendation-backed");
  }
  if (String(trace?.last_action ?? "").trim()) {
    badges.push("Assistant-updated");
  }
  if (
    Boolean(trace?.manual_override?.script) ||
    Boolean(trace?.manual_override?.visual) ||
    (scriptNote && tracedScriptNote && scriptNote !== tracedScriptNote) ||
    (visualNote && tracedVisualNote && visualNote !== tracedVisualNote)
  ) {
    badges.push("Manual override");
  }

  return Array.from(new Set(badges));
}

function findResearchBriefForItem(releaseResearchBriefs, item) {
  const briefItems = Array.isArray(releaseResearchBriefs?.items) ? releaseResearchBriefs.items : [];
  if (!item || briefItems.length === 0) return null;
  const segmentId = String(item?.asset?.meta_json?.segment_id ?? "").trim();
  const sectionTitle = String(item?.asset?.meta_json?.section_title ?? "").trim().toLowerCase();
  if (segmentId) {
    const bySegment = briefItems.find((entry) => String(entry?.segment_id ?? "").trim() === segmentId);
    if (bySegment) return bySegment;
  }
  if (sectionTitle) {
    const bySection = briefItems.find((entry) => String(entry?.section_title ?? "").trim().toLowerCase() === sectionTitle);
    if (bySection) return bySection;
  }
  return null;
}

function findResearchBriefEntryByRole(brief = null, preferredRoles = [], fallbackKeys = []) {
  const items = Array.isArray(brief?.brief?.items) ? brief.brief.items : [];
  if (items.length === 0) return null;
  const roleSet = new Set(preferredRoles.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const keySet = new Set(fallbackKeys.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const exact = items.find((entry) => {
    const role = String(entry?.role ?? "").trim().toLowerCase();
    const key = String(entry?.key ?? "").trim().toLowerCase();
    return (roleSet.size > 0 && roleSet.has(role)) || (keySet.size > 0 && keySet.has(key));
  });
  return exact ?? items[0] ?? null;
}

function findResearchBriefBackupEntry(brief = null, primaryEntry = null, kind = "source") {
  const items = Array.isArray(brief?.brief?.items) ? brief.brief.items : [];
  if (items.length === 0) return null;
  const normalizedKind = String(kind ?? "").trim().toLowerCase();
  const primaryResultId = String(primaryEntry?.result_id ?? "").trim();
  const primaryKey = String(primaryEntry?.key ?? "").trim().toLowerCase();
  const explicit =
    normalizedKind === "visual"
      ? findResearchBriefEntryByRole(brief, ["visual_candidate"], ["backup_visual"])
      : findResearchBriefEntryByRole(brief, ["backup_source", "reference", "main_source"], ["backup_source"]);
  if (!explicit || typeof explicit !== "object") return null;
  const explicitResultId = String(explicit?.result_id ?? "").trim();
  const explicitKey = String(explicit?.key ?? "").trim().toLowerCase();
  if ((explicitResultId && explicitResultId === primaryResultId) || (explicitKey && explicitKey === primaryKey)) {
    return null;
  }
  return explicit;
}

function findReleaseItemForBrief(brief = null, releaseItems = []) {
  const items = Array.isArray(releaseItems) ? releaseItems : [];
  const segmentId = String(brief?.segment_id ?? "").trim();
  const sectionTitle = String(brief?.section_title ?? "").trim().toLowerCase();
  if (segmentId) {
    const bySegment = items.find((item) => String(item?.asset?.meta_json?.segment_id ?? "").trim() === segmentId);
    if (bySegment) return bySegment;
  }
  if (sectionTitle) {
    const bySection = items.find((item) => String(item?.asset?.meta_json?.section_title ?? "").trim().toLowerCase() === sectionTitle);
    if (bySection) return bySection;
  }
  return null;
}

function deriveBriefCurrentPairState(brief = null, releaseItem = null, releaseActivity = [], formatRelativeEventLabel, formatDateTimeShort) {
  if (!brief || !releaseItem) return null;
  const attachment = releaseItem?.attachment ?? {};
  const trace = attachment?.assistant_trace_json ?? {};
  const sourceEntry = findResearchBriefEntryByRole(brief, ["main_source", "backup_source", "reference"], ["source"]);
  const visualEntry = findResearchBriefEntryByRole(brief, ["visual_candidate"], ["visual", "download"]);
  const backupSourceEntry = findResearchBriefBackupEntry(brief, sourceEntry, "source");
  const backupVisualEntry = findResearchBriefBackupEntry(brief, visualEntry, "visual");
  const currentSourceLabel = String(trace?.script?.title || sourceEntry?.title || sourceEntry?.label || "").trim();
  const currentVisualLabel = String(
    trace?.visual?.recommendation?.title || trace?.visual?.title || visualEntry?.title || visualEntry?.label || ""
  ).trim();
  const primarySourceLabel = String(sourceEntry?.title || sourceEntry?.label || sourceEntry?.domain || "").trim();
  const primaryVisualLabel = String(visualEntry?.title || visualEntry?.label || visualEntry?.domain || "").trim();
  const backupSourceLabel = String(backupSourceEntry?.title || backupSourceEntry?.label || backupSourceEntry?.domain || "").trim();
  const backupVisualLabel = String(backupVisualEntry?.title || backupVisualEntry?.label || backupVisualEntry?.domain || "").trim();
  const sourceMatchesMain =
    Boolean(currentSourceLabel) &&
    Boolean(primarySourceLabel) &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(primarySourceLabel);
  const sourceMatchesBackup =
    Boolean(currentSourceLabel) &&
    Boolean(backupSourceLabel) &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(backupSourceLabel);
  const visualMatchesMain =
    Boolean(currentVisualLabel) &&
    Boolean(primaryVisualLabel) &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(primaryVisualLabel);
  const visualMatchesBackup =
    Boolean(currentVisualLabel) &&
    Boolean(backupVisualLabel) &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(backupVisualLabel);
  const currentPairLabel =
    sourceMatchesMain && visualMatchesMain
      ? "Main Pair"
      : sourceMatchesBackup && visualMatchesBackup
        ? "Backup Pair"
        : (sourceMatchesMain || sourceMatchesBackup || visualMatchesMain || visualMatchesBackup)
          ? "Mixed Pair"
          : (currentSourceLabel || currentVisualLabel)
            ? "Custom Pair"
            : "";
  const currentVisualBasis = String(
    trace?.visual?.source_type || (String(trace?.visual?.recommendation?.asset_id ?? "").trim() ? "assistant_recommendation" : "")
  )
    .trim()
    .toLowerCase();
  const currentSourceBasis = String(trace?.script?.source_type ?? "").trim().toLowerCase();
  const currentPairHint =
    currentPairLabel === "Main Pair"
      ? "Aligned with main picks"
      : currentPairLabel === "Backup Pair"
        ? "Using backup picks"
        : currentPairLabel === "Mixed Pair"
          ? "Mixed main + backup"
          : currentVisualBasis === "assistant_recommendation"
            ? "Recommendation-backed override"
            : currentSourceBasis === "manual_override" || currentVisualBasis === "manual_override"
              ? "Custom override"
              : currentPairLabel
                ? "Custom research mix"
                : "";
  const attachmentId = String(attachment?.id ?? "").trim();
  const pairSwitchEvent = (Array.isArray(releaseActivity) ? releaseActivity : []).find((entry) => {
    const event = String(entry?.event ?? "").trim().toLowerCase();
    const targetAttachmentId = String(entry?.attachment_id ?? entry?.meta_json?.attachment_id ?? "").trim();
    return targetAttachmentId === attachmentId && ["research_pick_applied", "manual_override"].includes(event);
  }) ?? null;
  return {
    currentPairLabel,
    currentPairHint,
    pairSwitchLabel: formatPairSwitchEventLabel(pairSwitchEvent?.event, pairSwitchEvent?.meta_json),
    pairSwitchRelative: typeof formatRelativeEventLabel === "function" ? formatRelativeEventLabel(pairSwitchEvent?.created_at ?? "") : "",
    pairSwitchAt: typeof formatDateTimeShort === "function" ? formatDateTimeShort(pairSwitchEvent?.created_at ?? "") : ""
  };
}

function buildResearchScriptNote(brief = null, entry = null) {
  const title = String(entry?.title || entry?.label || "").trim();
  const domain = String(entry?.domain || "").trim();
  const sectionTitle = String(brief?.section_title || "").trim();
  const parts = [];
  parts.push(sectionTitle ? `Lead with ${sectionTitle}` : "Lead with the selected source");
  if (title) parts.push(`source cue ${title}`);
  if (domain) parts.push(`cite ${domain}`);
  return `${parts.join(", ")}.`.trim();
}

function buildResearchVisualNote(brief = null, entry = null) {
  const title = String(entry?.title || entry?.label || "").trim();
  const domain = String(entry?.domain || "").trim();
  const sectionTitle = String(brief?.section_title || "").trim();
  if (title && domain) return `Use ${title} from ${domain} as the supporting visual for ${sectionTitle || "this segment"}.`;
  if (title) return `Use ${title} as the supporting visual for ${sectionTitle || "this segment"}.`;
  return `Use research-backed visual for ${sectionTitle || "this segment"}.`;
}

function buildResearchContextPayload(brief = null, { sourceEntry = null, visualEntry = null } = {}) {
  if (!brief) return null;
  const normalize = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      key: String(entry?.key ?? "").trim(),
      label: String(entry?.label ?? "").trim(),
      title: String(entry?.title || entry?.label || "").trim(),
      domain: String(entry?.domain ?? "").trim(),
      role: String(entry?.role ?? "").trim(),
      reason: String(entry?.reason ?? "").trim(),
      score: Number(entry?.score ?? 0),
      url: String(entry?.url ?? "").trim(),
      result_id: String(entry?.result_id ?? "").trim()
    };
  };
  return {
    segment_id: String(brief?.segment_id ?? "").trim(),
    section_title: String(brief?.section_title ?? "").trim(),
    summary: String(brief?.brief?.summary ?? "").trim(),
    source_item: normalize(sourceEntry),
    visual_item: normalize(visualEntry)
  };
}

function buildResearchPromotePatch(brief = null, { sourceEntry = null, visualEntry = null } = {}) {
  const patch = {
    assistant_action: "research_pick",
    research_mode: "promote",
    research_context: buildResearchContextPayload(brief, { sourceEntry, visualEntry })
  };
  if (sourceEntry) {
    patch.script_note = buildResearchScriptNote(brief, sourceEntry);
  }
  if (visualEntry) {
    patch.visual_note = buildResearchVisualNote(brief, visualEntry);
  }
  if (sourceEntry && visualEntry) {
    patch.item_status = "visual_ready";
  } else if (sourceEntry) {
    patch.item_status = "selected";
  }
  return patch;
}

function buildResearchSingleSidePatch(brief = null, mode = "source", { sourceEntry = null, visualEntry = null } = {}) {
  const normalizedMode = String(mode ?? "").trim().toLowerCase();
  if (!["source", "visual"].includes(normalizedMode)) return null;
  const patch = {
    assistant_action: "research_pick",
    research_mode: normalizedMode === "source" ? "script" : "visual",
    research_context: buildResearchContextPayload(brief, { sourceEntry, visualEntry })
  };
  if (normalizedMode === "source" && sourceEntry) {
    patch.script_note = buildResearchScriptNote(brief, sourceEntry);
  }
  if (normalizedMode === "visual" && visualEntry) {
    patch.visual_note = buildResearchVisualNote(brief, visualEntry);
  }
  return patch;
}

export function ReleaseWorkspaceOverview({
  effectiveReleaseAssistantFindings,
  setReleaseBoardFilter,
  setReleaseWorkspaceTab,
  segmentsNeedingVisual,
  handleOpenSegmentScreenshotMode,
  handleAttachOrphanScreenshots,
  effectiveOrphanScreenshotsCount,
  handleFillMissingVisualsWithRecommendations,
  handlePrepareRelease,
  handleMarkReleaseAirReady,
  handlePublishRelease,
  releaseBusy,
  releaseSummary,
  recommendedReleaseAssets,
  releaseRecommendationSummary,
  lastAttachRecommendationsResult,
  handleAttachRecommendedBatch,
  handleAttachAssetToRelease,
  assetActionBusy,
  selectedReleaseId,
  handleOpenAssetScreenshotMode,
  handleDownloadMedia,
  getMediaDownloadState,
  formatRecommendationBucketLabel,
  releaseDraftPackSummary,
  releaseDraftPackItems,
  releasePublishChecklistSummary,
  releasePublishChecklistItems,
  releaseReadyToAir,
  releaseControlPanel,
  releaseBriefingPanel,
  releaseResearchBriefs,
  sourceProfiles,
  releaseOutcomeMemorySummary,
  runtimeBackupsStatus,
  lastAssistantAutoBackup,
  formatDateTimeShort,
  releaseActivity,
  handleApplyReleaseDraftPack,
  handleSelectBackupSnapshot,
  handleFocusReleaseAttachment,
  handlePrepareReleaseAttachment,
  handleDraftReleaseAttachment,
  handleFillReleaseAttachmentVisuals,
  handleUpdateReleaseAttachment,
  handleCopyReleaseResearchBrief,
  handleOpenReleaseResearchSegment,
  handlePinReleaseResearchRun,
  handleOpenReleaseFromSegment,
  selectedReleaseAssets
}) {
  const [attachTopConfirmOpen, setAttachTopConfirmOpen] = React.useState(false);
  const [attachTopSelectedIds, setAttachTopSelectedIds] = React.useState([]);
  const attachTopPreview = React.useMemo(
    () =>
        (Array.isArray(recommendedReleaseAssets) ? recommendedReleaseAssets.slice(0, 3) : []).map((item) => ({
          ...buildRecommendationBatchPreview(item),
        metadataBadges: buildSourceMetadataBadges(item?.asset, sourceProfiles)
      })),
    [recommendedReleaseAssets, sourceProfiles]
  );
  const attachTopPreviewItems = React.useMemo(
    () => (Array.isArray(recommendedReleaseAssets) ? recommendedReleaseAssets.slice(0, 3) : []),
    [recommendedReleaseAssets]
  );
  const lastAttachResultByAssetId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(lastAttachRecommendationsResult?.results) ? lastAttachRecommendationsResult.results : []).forEach((item) => {
      const assetId = String(item?.asset_id ?? "").trim();
      if (!assetId) return;
      map.set(assetId, item);
    });
    return map;
  }, [lastAttachRecommendationsResult]);

  React.useEffect(() => {
    setAttachTopSelectedIds(
      attachTopPreviewItems
        .map((item) => String(item?.asset?.id ?? "").trim())
        .filter(Boolean)
    );
    setAttachTopConfirmOpen(false);
  }, [attachTopPreviewItems, selectedReleaseId]);

  const releaseAssetMap = React.useMemo(() => {
    const items = Array.isArray(selectedReleaseAssets) ? selectedReleaseAssets : [];
    return new Map(items.map((item) => [String(item?.attachment?.id ?? "").trim(), item]));
  }, [selectedReleaseAssets]);
  const handoffResolutionByAttachmentId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(releaseActivity) ? releaseActivity : []).forEach((item) => {
      const event = String(item?.event ?? "").trim().toLowerCase();
      if (!["handoff_download_resolved", "handoff_capture_resolved"].includes(event)) return;
      const attachmentId = String(item?.attachment_id ?? item?.meta_json?.attachment_id ?? "").trim();
      if (!attachmentId || map.has(attachmentId)) return;
      map.set(attachmentId, item);
    });
    return map;
  }, [releaseActivity]);

  const traceHighlights = React.useMemo(() => {
    const items = Array.isArray(selectedReleaseAssets) ? selectedReleaseAssets : [];
    return items
      .filter((item) => item?.attachment?.assistant_trace_json?.script || item?.attachment?.assistant_trace_json?.visual)
      .map((item) => {
        const asset = item?.asset ?? {};
        const attachment = item?.attachment ?? {};
        const trace = attachment?.assistant_trace_json ?? {};
        const hasScriptGap = !String(attachment?.script_note ?? "").trim();
        const hasVisualGap = !String(attachment?.visual_note ?? "").trim();
        return {
          raw: item,
          attachment_id: String(attachment?.id ?? ""),
          title: String(asset?.title || asset?.file_name || asset?.id || "Asset"),
          item_status: String(attachment?.item_status ?? "planned"),
          hasScriptGap,
          hasVisualGap,
          last_action: String(trace?.last_action ?? "").trim(),
          script_section: String(trace?.script?.section_title ?? "").trim(),
          script_title: String(trace?.script?.title ?? "").trim(),
          visual_title: String(trace?.visual?.title ?? "").trim(),
          visual_section: String(trace?.visual?.section_title ?? "").trim(),
          visual_best_for: String(trace?.visual?.recommendation?.matched_section_title ?? "").trim(),
          confidence_badges: deriveTraceConfidenceBadges(item)
        };
      })
      .sort((a, b) => {
        const scoreA = (a.hasVisualGap ? 2 : 0) + (a.hasScriptGap ? 1 : 0);
        const scoreB = (b.hasVisualGap ? 2 : 0) + (b.hasScriptGap ? 1 : 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return String(a.title).localeCompare(String(b.title));
      })
      .slice(0, 6);
  }, [selectedReleaseAssets]);

  const handleOpenDiagnostic = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (attachmentId && typeof handleFocusReleaseAttachment === "function") {
        handleFocusReleaseAttachment(attachmentId);
        return;
      }
      const key = String(item?.key ?? "").trim().toLowerCase();
      if (key === "missing_script" || key === "missing_visual" || key === "needs_link") {
        setReleaseBoardFilter(key);
        setReleaseWorkspaceTab("board");
      }
    },
    [handleFocusReleaseAttachment, setReleaseBoardFilter, setReleaseWorkspaceTab]
  );

  const handleToggleAttachTopCandidate = React.useCallback((assetId) => {
    const normalizedId = String(assetId ?? "").trim();
    if (!normalizedId) return;
    setAttachTopSelectedIds((current) =>
      current.includes(normalizedId) ? current.filter((item) => item !== normalizedId) : [...current, normalizedId]
    );
  }, []);

  const handleStartAttachTopReview = React.useCallback(() => {
    if (attachTopPreviewItems.length === 0) return;
    setAttachTopConfirmOpen(true);
  }, [attachTopPreviewItems]);

  const handleCancelAttachTopReview = React.useCallback(() => {
    setAttachTopSelectedIds(
      attachTopPreviewItems
        .map((item) => String(item?.asset?.id ?? "").trim())
        .filter(Boolean)
    );
    setAttachTopConfirmOpen(false);
  }, [attachTopPreviewItems]);

  const handleConfirmAttachTopReview = React.useCallback(() => {
    if (attachTopSelectedIds.length === 0 || typeof handleAttachRecommendedBatch !== "function") return;
    handleAttachRecommendedBatch(attachTopSelectedIds);
    setAttachTopConfirmOpen(false);
  }, [attachTopSelectedIds, handleAttachRecommendedBatch]);

  const handleRunDiagnosticAction = React.useCallback(
    (item, action) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      if (action === "prepare" && typeof handlePrepareReleaseAttachment === "function") {
        handlePrepareReleaseAttachment(attachmentId);
        return;
      }
      if (action === "draft" && typeof handleDraftReleaseAttachment === "function") {
        handleDraftReleaseAttachment(attachmentId, "missing_only");
        return;
      }
      if (action === "fill" && typeof handleFillReleaseAttachmentVisuals === "function") {
        handleFillReleaseAttachmentVisuals(attachmentId);
        return;
      }
      if (action === "screenshot" && releaseItem?.asset && typeof handleOpenAssetScreenshotMode === "function") {
        handleOpenAssetScreenshotMode(releaseItem.asset);
      }
    },
    [
      handleDraftReleaseAttachment,
      handleFillReleaseAttachmentVisuals,
      handleOpenAssetScreenshotMode,
      handlePrepareReleaseAttachment,
      releaseAssetMap
    ]
  );

  const handleUseResearchForDiagnostic = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId || typeof handleUpdateReleaseAttachment !== "function") return;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) return;
      const brief = findResearchBriefForItem(releaseResearchBriefs, releaseItem);
      if (!brief) return;
      const sourceEntry = findResearchBriefEntryByRole(brief, ["main_source", "backup_source", "reference"], ["source"]);
      const visualEntry = findResearchBriefEntryByRole(brief, ["visual_candidate"], ["visual", "download"]);
      if (!sourceEntry && !visualEntry) return;
      handleUpdateReleaseAttachment(
        releaseItem.asset.id,
        releaseItem.attachment.id,
        buildResearchPromotePatch(brief, { sourceEntry, visualEntry })
      );
    },
    [handleUpdateReleaseAttachment, releaseAssetMap, releaseResearchBriefs]
  );

  const handleOpenCopyPlanItem = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (attachmentId && typeof handleFocusReleaseAttachment === "function") {
        handleFocusReleaseAttachment(attachmentId);
      }
    },
    [handleFocusReleaseAttachment]
  );

  const handleOpenResolvedHandoffItem = React.useCallback(
    (activityItem) => {
      const attachmentId = String(activityItem?.attachment_id ?? activityItem?.meta_json?.attachment_id ?? "").trim();
      if (attachmentId && typeof handleFocusReleaseAttachment === "function") {
        handleFocusReleaseAttachment(attachmentId);
      }
    },
    [handleFocusReleaseAttachment]
  );

  const handleCopyPlanAction = React.useCallback(
    (item, action) => {
      const normalizedAction = String(action ?? "").trim().toLowerCase();
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      if (normalizedAction === "open") {
        handleOpenCopyPlanItem(item);
        return;
      }
      if (normalizedAction === "download" && typeof handleDownloadMedia === "function") {
        handleDownloadMedia(item?.source_url, item?.section_title ?? null);
        return;
      }
      if (normalizedAction === "screenshot" && releaseItem?.asset && typeof handleOpenAssetScreenshotMode === "function") {
        handleOpenAssetScreenshotMode(releaseItem.asset);
      }
    },
    [handleDownloadMedia, handleOpenAssetScreenshotMode, handleOpenCopyPlanItem, releaseAssetMap]
  );
  const getHandoffDownloadState = React.useCallback(
    (item) => {
      if (String(item?.effective_ready_state ?? "").trim().toLowerCase() === "downloaded") {
        return { state: "completed", label: "Downloaded" };
      }
      if (typeof getMediaDownloadState !== "function") return null;
      return getMediaDownloadState(item?.source_url ?? "");
    },
    [getMediaDownloadState]
  );
  const getHandoffCaptureState = React.useCallback(
    (item) => {
      if (String(item?.effective_ready_state ?? "").trim().toLowerCase() === "captured") {
        return { state: "completed", label: "Captured" };
      }
      const readyState = String(item?.ready_state ?? "").trim().toLowerCase();
      if (readyState !== "capture_needed") return null;
      const attachmentId = String(item?.attachment_id ?? "").trim();
      const sectionTitle = String(item?.section_title ?? "").trim().toLowerCase();
      const sourceUrl = normalizeComparableUrl(item?.source_url ?? "");
      const hasCapturedVisual = (Array.isArray(selectedReleaseAssets) ? selectedReleaseAssets : []).some((entry) => {
        if (String(entry?.attachment?.id ?? "").trim() === attachmentId) return false;
        const asset = entry?.asset ?? {};
        const role = String(entry?.attachment?.role ?? "").trim().toLowerCase();
        const kind = String(asset?.kind ?? "").trim().toLowerCase();
        const hasLocal = Boolean(String(asset?.local_path ?? asset?.screenshot_path ?? "").trim());
        if (!hasLocal) return false;
        if (!["visual", "story"].includes(role)) return false;
        if (!["screenshot", "telegram_media", "downloaded_media", "preview"].includes(kind)) return false;
        const assetSectionTitle = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
        const assetSourceUrl = normalizeComparableUrl(asset?.source_url ?? "");
        return Boolean(
          (sectionTitle && assetSectionTitle && sectionTitle === assetSectionTitle) ||
            (sourceUrl && assetSourceUrl && sourceUrl === assetSourceUrl)
        );
      });
      return hasCapturedVisual ? { state: "completed", label: "Captured" } : null;
    },
    [selectedReleaseAssets]
  );
  const firstPendingCopyPlanItem = React.useMemo(
    () =>
      (Array.isArray(releaseBriefingPanel?.copy_plan_highlights) ? releaseBriefingPanel.copy_plan_highlights : []).find((item) => {
        const readyState = String(item?.effective_ready_state ?? item?.ready_state ?? "").trim().toLowerCase();
        if (!["capture_needed", "download_needed"].includes(readyState)) return false;
        if (readyState === "download_needed") {
          const downloadState = getHandoffDownloadState(item);
          return String(downloadState?.state ?? "").trim().toLowerCase() !== "completed";
        }
        const captureState = getHandoffCaptureState(item);
        return String(captureState?.state ?? "").trim().toLowerCase() !== "completed";
      }) ?? null,
    [getHandoffCaptureState, getHandoffDownloadState, releaseBriefingPanel]
  );

  const getDiagnosticResearchState = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) {
        return {
          brief: null,
          sourceEntry: null,
          visualEntry: null
        };
      }
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      const brief = findResearchBriefForItem(releaseResearchBriefs, releaseItem);
      const sourceEntry = brief
        ? findResearchBriefEntryByRole(brief, ["main_source", "backup_source", "reference"], ["source"])
        : null;
      const visualEntry = brief ? findResearchBriefEntryByRole(brief, ["visual_candidate"], ["visual", "download"]) : null;
      return {
        brief,
        sourceEntry,
        visualEntry
      };
    },
    [releaseAssetMap, releaseResearchBriefs]
  );

  const handleUseResearchSideForDiagnostic = React.useCallback(
    (item, mode) => {
      const normalizedMode = String(mode ?? "").trim().toLowerCase();
      if (!["source", "visual"].includes(normalizedMode) || typeof handleUpdateReleaseAttachment !== "function") return;
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) return;
      const { brief, sourceEntry, visualEntry } = getDiagnosticResearchState(item);
      if (!brief) return;
      if (normalizedMode === "source" && sourceEntry) {
        handleUpdateReleaseAttachment(
          releaseItem.asset.id,
          releaseItem.attachment.id,
          buildResearchSingleSidePatch(brief, "source", {
            sourceEntry,
            visualEntry
          })
        );
      }
      if (normalizedMode === "visual" && visualEntry) {
        handleUpdateReleaseAttachment(
          releaseItem.asset.id,
          releaseItem.attachment.id,
          buildResearchSingleSidePatch(brief, "visual", {
            sourceEntry,
            visualEntry
          })
        );
      }
    },
    [getDiagnosticResearchState, handleUpdateReleaseAttachment, releaseAssetMap]
  );

  const hasResearchForDiagnostic = React.useCallback(
    (item) => {
      const { sourceEntry, visualEntry } = getDiagnosticResearchState(item);
      return Boolean(sourceEntry || visualEntry);
    },
    [getDiagnosticResearchState]
  );

  const hasResearchSourceForDiagnostic = React.useCallback(
    (item) => Boolean(getDiagnosticResearchState(item).sourceEntry),
    [getDiagnosticResearchState]
  );

  const hasResearchVisualForDiagnostic = React.useCallback(
    (item) => Boolean(getDiagnosticResearchState(item).visualEntry),
    [getDiagnosticResearchState]
  );

  const canPromoteResearchForDiagnostic = React.useCallback(
    (item) => {
      const { sourceEntry, visualEntry } = getDiagnosticResearchState(item);
      return Boolean(sourceEntry && visualEntry);
    },
    [getDiagnosticResearchState]
  );

  const renderDiagnosticResearchPreview = React.useCallback(
    (item) => {
      const { sourceEntry, visualEntry } = getDiagnosticResearchState(item);
      if (!sourceEntry && !visualEntry) return null;
      return (
        <div className="release-diagnostic-preview">
          {sourceEntry ? (
            <span className="release-diagnostic-preview-line">
              {`Source: ${sourceEntry.title || sourceEntry.label || sourceEntry.url || sourceEntry.result_id || "research source"}${
                sourceEntry.domain ? ` · ${sourceEntry.domain}` : ""
              }`}
            </span>
          ) : null}
          {visualEntry ? (
            <span className="release-diagnostic-preview-line">
              {`Visual: ${visualEntry.title || visualEntry.label || visualEntry.url || visualEntry.result_id || "research visual"}${
                visualEntry.domain ? ` · ${visualEntry.domain}` : ""
              }`}
            </span>
          ) : null}
        </div>
      );
    },
    [getDiagnosticResearchState]
  );

  const renderDiagnosticTraceHints = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return null;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      const badges = deriveTraceConfidenceBadges(releaseItem ?? {});
      if (badges.length === 0) return null;
      return (
        <div className="release-trace-badges">
          {badges.map((badge) => (
            <span key={`${attachmentId}-${badge}`} className="release-trace-badge">
              {badge}
            </span>
          ))}
        </div>
      );
    },
    [releaseAssetMap]
  );

  const renderDiagnosticQualityHints = React.useCallback(
    (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return null;
      const releaseItem = releaseAssetMap.get(attachmentId) ?? null;
      const { sourceEntry, visualEntry } = getDiagnosticResearchState(item);
      const domainCandidates = [
        String(releaseItem?.asset?.source_domain ?? "").trim().toLowerCase(),
        String(sourceEntry?.domain ?? "").trim().toLowerCase(),
        String(visualEntry?.domain ?? "").trim().toLowerCase()
      ].filter(Boolean);
      const trustedDomains = new Set(
        (Array.isArray(sourceProfiles?.trusted_domains) ? sourceProfiles.trusted_domains : [])
          .map((entry) => String(entry ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const workedDomains = new Set(
        (Array.isArray(releaseOutcomeMemorySummary?.top_domains) ? releaseOutcomeMemorySummary.top_domains : [])
          .map((entry) => String(entry?.key ?? entry?.domain ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const successfulKinds = new Set(
        (Array.isArray(releaseOutcomeMemorySummary?.top_kinds) ? releaseOutcomeMemorySummary.top_kinds : [])
          .map((entry) => String(entry?.key ?? entry?.kind ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const hints = [];
      if (domainCandidates.some((domain) => trustedDomains.has(domain))) {
        hints.push("Trusted Domain");
      }
      if (domainCandidates.some((domain) => workedDomains.has(domain))) {
        hints.push("Worked in Releases");
      }
      const assetKind = String(releaseItem?.asset?.kind ?? "").trim().toLowerCase();
      if (assetKind && successfulKinds.has(assetKind)) {
        hints.push("Successful Asset Type");
      }
      if (hints.length === 0) return null;
      return (
        <div className="release-trace-badges">
          {hints.map((hint) => (
            <span key={`${attachmentId}-${hint}`} className="release-trace-badge">
              {hint}
            </span>
          ))}
        </div>
      );
    },
    [getDiagnosticResearchState, releaseAssetMap, releaseOutcomeMemorySummary, sourceProfiles]
  );

  const massActionSafetyHint = React.useMemo(() => {
    const autoBackupEnabled = runtimeBackupsStatus?.auto_backup_enabled !== false;
    const latestBackupAt = String(runtimeBackupsStatus?.latest?.created_at ?? "").trim();
    if (!autoBackupEnabled) {
      return {
        tone: "warning",
        text: "Auto-backup is OFF. Mass actions will run without automatic recovery-point."
      };
    }
    if (!latestBackupAt) {
      return {
        tone: "warning",
        text: "No backup snapshot exists yet. A recovery-point will be created on the next mass action."
      };
    }
    const ageMs = Date.now() - (Date.parse(latestBackupAt) || 0);
    if (ageMs > 24 * 60 * 60 * 1000) {
      return {
        tone: "warning",
        text: `Latest recovery-point is stale: ${formatDateTimeShort?.(latestBackupAt) || latestBackupAt}.`
      };
    }
    return {
      tone: "ok",
      text: `Auto-backup ON · last recovery-point ${formatDateTimeShort?.(latestBackupAt) || latestBackupAt}.`
    };
  }, [formatDateTimeShort, runtimeBackupsStatus]);

  const lastAssistantAutoBackupHint = React.useMemo(() => {
    const backupId = String(lastAssistantAutoBackup?.backup_id ?? "").trim();
    if (!backupId) return null;
    const label = String(lastAssistantAutoBackup?.label ?? "").trim() || "assistant action";
    const createdAt = String(lastAssistantAutoBackup?.created_at ?? "").trim();
    return {
      backupId,
      text: `Latest auto-backup: ${backupId}${createdAt ? ` · ${formatDateTimeShort?.(createdAt) || createdAt}` : ""} · ${label}.`
    };
  }, [formatDateTimeShort, lastAssistantAutoBackup]);

  return (
    <div className="release-workspace-section">
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Release Briefing</strong>
          <div className="release-draft-pack-summary">
            <span>{releaseBriefingPanel.headline}</span>
          </div>
        </div>
        <div className="release-draft-pack-toolbar">
          <span className="muted">{releaseBriefingPanel.summary_text}</span>
        </div>
        {Array.isArray(releaseBriefingPanel.risks) && releaseBriefingPanel.risks.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.risks.map((item, index) => (
              <div key={`brief-risk-${index}`} className="release-draft-pack-item">
                <strong>Risk</strong>
                <span>{item}</span>
              </div>
            ))}
            {Array.isArray(releaseBriefingPanel.next_steps)
              ? releaseBriefingPanel.next_steps.map((item, index) => (
                  <div key={`brief-next-${index}`} className="release-draft-pack-item">
                    <strong>Next Step</strong>
                    <span>{item}</span>
                  </div>
                ))
              : null}
          </div>
        ) : Array.isArray(releaseBriefingPanel.next_steps) && releaseBriefingPanel.next_steps.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.next_steps.map((item, index) => (
              <div key={`brief-next-${index}`} className="release-draft-pack-item">
                <strong>Next Step</strong>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Briefing is not available yet.</div>
        )}
        {Array.isArray(releaseBriefingPanel.recommendation_highlights) &&
        releaseBriefingPanel.recommendation_highlights.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.recommendation_highlights.map((item, index) => (
              <div key={`brief-highlight-${item.asset_id || index}`} className="release-draft-pack-item">
                <strong>{item.title || `Highlight ${index + 1}`}</strong>
                {item?.matched_section_title ? (
                  <span>{`Best for ${item.matched_section_title}${item?.matched_segment_id ? ` · ${item.matched_segment_id}` : ""}`}</span>
                ) : null}
                {item?.reason_summary ? <span>{item.reason_summary}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {Array.isArray(releaseBriefingPanel.handoff_queue) && releaseBriefingPanel.handoff_queue.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.handoff_queue.map((item, index) => (
              <div key={`brief-handoff-queue-${item.attachment_id || item.asset_id || index}`} className="release-draft-pack-item">
                {(() => {
                  const downloadState =
                    String(item?.ready_state ?? "").trim().toLowerCase() === "download_needed"
                      ? getHandoffDownloadState(item)
                      : null;
                  const captureState =
                    String(item?.ready_state ?? "").trim().toLowerCase() === "capture_needed"
                      ? getHandoffCaptureState(item)
                      : null;
                  const resolvedEvent = handoffResolutionByAttachmentId.get(String(item?.attachment_id ?? "").trim()) ?? null;
                  return (
                    <>
                <strong>{`Handoff P${item.priority}`}</strong>
                <span>{item.title || item.asset_id || `Queue ${index + 1}`}</span>
                {item?.section_title ? <span>{`Section: ${item.section_title}`}</span> : null}
                {item?.ready_state ? (
                  <span>
                    {`Ready State: ${formatEffectiveHandoffState({ ...item, capture_state: captureState?.state }, downloadState)}`}
                  </span>
                ) : null}
                {downloadState?.label ? <span>{`Download Status: ${downloadState.label}`}</span> : null}
                {captureState?.label ? <span>{`Capture Status: ${captureState.label}`}</span> : null}
                {resolvedEvent ? (
                  <span>
                    {`Last resolved: ${formatHandoffResolvedEventLabel(resolvedEvent.event)}${
                      formatDateTimeShort?.(resolvedEvent.created_at) ? ` В· ${formatDateTimeShort(resolvedEvent.created_at)}` : ""
                    }`}
                  </span>
                ) : null}
                {item?.picked_from ? <span>{`Picked From: ${formatPickedFromLabel(item.picked_from)}`}</span> : null}
                {!item?.path && item?.source_url ? <span>{item.source_url}</span> : null}
                {item?.reason ? <span>{item.reason}</span> : null}
                <div className="release-draft-pack-actions">
                  <button className="btn ghost small" type="button" onClick={() => handleCopyPlanAction(item, "open")}>
                    Open
                  </button>
                  {resolvedEvent ? (
                    <button className="btn ghost small" type="button" onClick={() => handleOpenResolvedHandoffItem(resolvedEvent)}>
                      Open Resolved
                    </button>
                  ) : null}
                  {String(item?.ready_state ?? "").trim().toLowerCase() === "download_needed" ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleCopyPlanAction(item, "download")}
                      disabled={["queued", "running", "completed"].includes(String(downloadState?.state ?? ""))}
                    >
                      Queue Download
                    </button>
                  ) : (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleCopyPlanAction(item, "screenshot")}
                      disabled={String(captureState?.state ?? "").trim().toLowerCase() === "completed"}
                    >
                      Screenshot
                    </button>
                  )}
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        ) : null}
        {Array.isArray(releaseBriefingPanel.copy_plan_highlights) &&
        releaseBriefingPanel.copy_plan_highlights.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.copy_plan_highlights.map((item, index) => (
              <div key={`brief-copy-plan-${item.attachment_id || item.asset_id || index}`} className="release-draft-pack-item">
                {(() => {
                  const downloadState =
                    String(item?.ready_state ?? "").trim().toLowerCase() === "download_needed"
                      ? getHandoffDownloadState(item)
                      : null;
                  const captureState =
                    String(item?.ready_state ?? "").trim().toLowerCase() === "capture_needed"
                      ? getHandoffCaptureState(item)
                      : null;
                  const resolvedEvent = handoffResolutionByAttachmentId.get(String(item?.attachment_id ?? "").trim()) ?? null;
                  return (
                    <>
                <strong>{`Copy Plan P${item.priority}`}</strong>
                <span>{item.title || item.asset_id || `Step ${index + 1}`}</span>
                {item?.section_title ? <span>{`Section: ${item.section_title}`}</span> : null}
                {item?.step_type ? <span>{`Step: ${item.step_type}`}</span> : null}
                {item?.target ? <span>{`Target: ${item.target}`}</span> : null}
                {item?.ready_state ? (
                  <span>
                    {`Ready State: ${formatEffectiveHandoffState({ ...item, capture_state: captureState?.state }, downloadState)}`}
                  </span>
                ) : null}
                {downloadState?.label ? <span>{`Download Status: ${downloadState.label}`}</span> : null}
                {captureState?.label ? <span>{`Capture Status: ${captureState.label}`}</span> : null}
                {resolvedEvent ? (
                  <span>
                    {`Last resolved: ${formatHandoffResolvedEventLabel(resolvedEvent.event)}${
                      formatDateTimeShort?.(resolvedEvent.created_at) ? ` В· ${formatDateTimeShort(resolvedEvent.created_at)}` : ""
                    }`}
                  </span>
                ) : null}
                {item?.picked_from ? <span>{`Picked From: ${formatPickedFromLabel(item.picked_from)}`}</span> : null}
                {item?.path ? <span>{item.path}</span> : null}
                {!item?.path && item?.source_url ? <span>{item.source_url}</span> : null}
                {item?.reason ? <span>{item.reason}</span> : null}
                <div className="release-draft-pack-actions">
                  <button className="btn ghost small" type="button" onClick={() => handleCopyPlanAction(item, "open")}>
                    Open
                  </button>
                  {resolvedEvent ? (
                    <button className="btn ghost small" type="button" onClick={() => handleOpenResolvedHandoffItem(resolvedEvent)}>
                      Open Resolved
                    </button>
                  ) : null}
                  {!item?.path && item?.source_url && String(item?.ready_state ?? "").trim().toLowerCase() === "download_needed" ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleCopyPlanAction(item, "download")}
                      disabled={["queued", "running", "completed"].includes(String(downloadState?.state ?? ""))}
                    >
                      Queue Download
                    </button>
                  ) : null}
                  {!item?.path &&
                  item?.source_url &&
                  String(item?.ready_state ?? "").trim().toLowerCase() !== "download_needed" ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleCopyPlanAction(item, "screenshot")}
                      disabled={String(captureState?.state ?? "").trim().toLowerCase() === "completed"}
                    >
                      Screenshot
                    </button>
                  ) : null}
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        ) : null}
        {Array.isArray(releaseBriefingPanel.diagnostic_highlights) &&
        releaseBriefingPanel.diagnostic_highlights.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseBriefingPanel.diagnostic_highlights.map((item, index) => (
              <div key={`brief-diagnostic-${item.asset_id || item.attachment_id || index}`} className="release-draft-pack-item">
                <strong>{item.label || `Diagnostic ${index + 1}`}</strong>
                <span>{item.title}</span>
                {item?.section_title ? <span>{`Section: ${item.section_title}`}</span> : null}
                {hasResearchForDiagnostic(item) ? renderDiagnosticResearchPreview(item) : null}
                {renderDiagnosticQualityHints(item)}
                {renderDiagnosticTraceHints(item)}
                {item?.next_step ? <span>{item.next_step}</span> : null}
                <div className="release-draft-pack-actions">
                  {canPromoteResearchForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchForDiagnostic(item)}>
                      Promote Research
                    </button>
                  ) : null}
                  {hasResearchSourceForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchSideForDiagnostic(item, "source")}>
                      Use Source
                    </button>
                  ) : null}
                  {hasResearchVisualForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchSideForDiagnostic(item, "visual")}>
                      Use Visual
                    </button>
                  ) : null}
                  {hasResearchForDiagnostic(item) && !canPromoteResearchForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchForDiagnostic(item)}>
                      Use Research
                    </button>
                  ) : null}
                  {String(item?.key ?? "").trim().toLowerCase() === "missing_script" ? (
                    <>
                      <button className="btn ghost small" type="button" onClick={() => handleRunDiagnosticAction(item, "draft")}>
                        Draft
                      </button>
                      <button className="btn ghost small" type="button" onClick={() => handleRunDiagnosticAction(item, "prepare")}>
                        Prepare
                      </button>
                    </>
                  ) : null}
                  {["missing_visual", "handoff_capture", "handoff_download"].includes(String(item?.key ?? "").trim().toLowerCase()) ? (
                    <>
                      {String(item?.key ?? "").trim().toLowerCase() === "missing_visual" ? (
                        <button className="btn ghost small" type="button" onClick={() => handleRunDiagnosticAction(item, "fill")}>
                          Fill
                        </button>
                      ) : null}
                {String(item?.key ?? "").trim().toLowerCase() === "handoff_download" ? (
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={() => handleCopyPlanAction(item, "download")}
                          disabled={["queued", "running", "completed"].includes(
                            String(getHandoffDownloadState(item)?.state ?? "")
                          )}
                        >
                          Queue Download
                        </button>
                      ) : (
                        <button className="btn ghost small" type="button" onClick={() => handleRunDiagnosticAction(item, "screenshot")}>
                          Screenshot
                        </button>
                      )}
                    </>
                  ) : null}
                  <button className="btn ghost small" type="button" onClick={() => handleOpenDiagnostic(item)}>
                    Open
                  </button>
                  {["missing_script", "missing_visual", "needs_link"].includes(String(item?.key ?? "").trim().toLowerCase()) ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => {
                        setReleaseBoardFilter(String(item?.key ?? "").trim().toLowerCase());
                        setReleaseWorkspaceTab("board");
                      }}
                    >
                      Board
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Release Control</strong>
          <div className="release-draft-pack-summary">
            <span>{releaseControlPanel.title}</span>
            <span>{String(releaseControlPanel.status_code ?? "").replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className="release-draft-pack-toolbar">
          <span className="muted">{releaseControlPanel.detail}</span>
          {releaseControlPanel?.copy_plan_summary ? (
            <span className="muted">
              {`Handoff: ${Number(releaseControlPanel.copy_plan_summary.ready_files ?? 0)} ready · ${
                Number(releaseControlPanel.copy_plan_summary.capture_needed ?? 0)
              } capture/download · ${Number(releaseControlPanel.copy_plan_summary.backup_steps ?? 0)} backup`}
            </span>
          ) : null}
          {releaseControlPanel?.handoff_status_code ? (
            <span className="muted">{`Handoff Status: ${formatHandoffStatusLabel(releaseControlPanel.handoff_status_code)}`}</span>
          ) : null}
          {Number(releaseControlPanel?.copy_plan_summary?.download_needed ?? 0) > 0 ? (
            <span className="muted">{`Pending downloads: ${Number(releaseControlPanel.copy_plan_summary.download_needed ?? 0)}`}</span>
          ) : null}
          {firstPendingCopyPlanItem?.ready_state ? (
            <span className="muted">{`Prep state: ${formatEffectiveHandoffState(
              {
                ...firstPendingCopyPlanItem,
                capture_state: getHandoffCaptureState(firstPendingCopyPlanItem)?.state
              },
              getHandoffDownloadState(firstPendingCopyPlanItem)
            )}`}</span>
          ) : null}
          {firstPendingCopyPlanItem?.picked_from ? (
            <span className="muted">{`Current basis: ${formatPickedFromLabel(firstPendingCopyPlanItem.picked_from)}`}</span>
          ) : null}
          <div className="release-draft-pack-actions">
            {firstPendingCopyPlanItem ? (
              <>
                <button className="btn ghost small" type="button" onClick={() => handleCopyPlanAction(firstPendingCopyPlanItem, "open")}>
                  Open Pending
                </button>
                {String(firstPendingCopyPlanItem?.ready_state ?? "").trim().toLowerCase() === "download_needed" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleCopyPlanAction(firstPendingCopyPlanItem, "download")}
                    disabled={["queued", "running", "completed"].includes(
                      String(getHandoffDownloadState(firstPendingCopyPlanItem)?.state ?? "")
                    )}
                  >
                    Queue Download
                  </button>
                ) : (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleCopyPlanAction(firstPendingCopyPlanItem, "screenshot")}
                    disabled={String(getHandoffCaptureState(firstPendingCopyPlanItem)?.state ?? "").trim().toLowerCase() === "completed"}
                  >
                    Screenshot Pending
                  </button>
                )}
              </>
            ) : null}
            <button className="btn ghost small" type="button" onClick={handlePrepareRelease} disabled={releaseBusy}>
              Prepare
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={handleMarkReleaseAirReady}
              disabled={releaseBusy || !releaseControlPanel.can_mark_air_ready}
            >
              Air Ready
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={handlePublishRelease}
              disabled={releaseBusy || !releaseControlPanel.can_publish}
            >
              Publish
            </button>
          </div>
        </div>
        <div className={`release-safety-hint${massActionSafetyHint.tone === "warning" ? " is-warning" : ""}`}>
          {massActionSafetyHint.text}
        </div>
        {lastAssistantAutoBackupHint ? (
          <div className="release-safety-hint">
            <span>{lastAssistantAutoBackupHint.text}</span>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => handleSelectBackupSnapshot?.(lastAssistantAutoBackupHint.backupId)}
            >
              Inspect Snapshot
            </button>
          </div>
        ) : null}
        {Array.isArray(releaseControlPanel.actions) && releaseControlPanel.actions.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseControlPanel.actions.map((item) => (
              <div key={`control-${item.key}`} className="release-draft-pack-item">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No additional control actions suggested.</div>
        )}
        {Array.isArray(releaseControlPanel.diagnostic_highlights) && releaseControlPanel.diagnostic_highlights.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseControlPanel.diagnostic_highlights.map((item, index) => (
              <div key={`control-diagnostic-${item.asset_id || item.attachment_id || index}`} className="release-draft-pack-item">
                <strong>{item.label || `Diagnostic ${index + 1}`}</strong>
                <span>{item.title}</span>
                {item?.section_title ? <span>{`Section: ${item.section_title}`}</span> : null}
                {hasResearchForDiagnostic(item) ? renderDiagnosticResearchPreview(item) : null}
                {renderDiagnosticQualityHints(item)}
                {renderDiagnosticTraceHints(item)}
                <div className="release-draft-pack-actions">
                  {canPromoteResearchForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchForDiagnostic(item)}>
                      Promote Research
                    </button>
                  ) : null}
                  {hasResearchSourceForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchSideForDiagnostic(item, "source")}>
                      Use Source
                    </button>
                  ) : null}
                  {hasResearchVisualForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchSideForDiagnostic(item, "visual")}>
                      Use Visual
                    </button>
                  ) : null}
                  {hasResearchForDiagnostic(item) && !canPromoteResearchForDiagnostic(item) ? (
                    <button className="btn ghost small" type="button" onClick={() => handleUseResearchForDiagnostic(item)}>
                      Use Research
                    </button>
                  ) : null}
                  {String(item?.key ?? "").trim().toLowerCase() === "missing_script" ? (
                    <button className="btn ghost small" type="button" onClick={() => handleRunDiagnosticAction(item, "draft")}>
                      Draft
                    </button>
                  ) : null}
                  {["missing_visual", "handoff_capture", "handoff_download"].includes(String(item?.key ?? "").trim().toLowerCase()) ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() =>
                        String(item?.key ?? "").trim().toLowerCase() === "handoff_download"
                          ? handleCopyPlanAction(item, "download")
                          : handleRunDiagnosticAction(
                              item,
                              String(item?.key ?? "").trim().toLowerCase() === "missing_visual" ? "fill" : "screenshot"
                            )
                      }
                    >
                      {String(item?.key ?? "").trim().toLowerCase() === "missing_visual"
                        ? "Fill"
                        : String(item?.key ?? "").trim().toLowerCase() === "handoff_download"
                          ? "Queue Download"
                          : "Screenshot"}
                    </button>
                  ) : null}
                  <button className="btn ghost small" type="button" onClick={() => handleOpenDiagnostic(item)}>
                    Open
                  </button>
                  {["missing_script", "missing_visual", "needs_link"].includes(String(item?.key ?? "").trim().toLowerCase()) ? (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => {
                        setReleaseBoardFilter(String(item?.key ?? "").trim().toLowerCase());
                        setReleaseWorkspaceTab("board");
                      }}
                    >
                      Board
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Segment Research Briefs</strong>
          <div className="release-draft-pack-summary">
            <span>{`Segments ${Number(releaseResearchBriefs?.summary?.total ?? 0)}`}</span>
          </div>
        </div>
        {Array.isArray(releaseResearchBriefs?.items) && releaseResearchBriefs.items.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseResearchBriefs.items.slice(0, 6).map((item) => (
              <div key={`segment-research-${item.segment_id}`} className="release-draft-pack-item">
                <strong>{item.section_title || item.segment_id}</strong>
                {(() => {
                  const releaseItem = findReleaseItemForBrief(item, selectedReleaseAssets);
                  const pairState = deriveBriefCurrentPairState(
                    item,
                    releaseItem,
                    releaseActivity,
                    formatRelativeEventLabel,
                    formatDateTimeShort
                  );
                  const sourceEntry = findResearchBriefEntryByRole(item, ["main_source", "backup_source", "reference"], ["source"]);
                  const visualEntry = findResearchBriefEntryByRole(item, ["visual_candidate"], ["visual", "download"]);
                  const backupSourceEntry = findResearchBriefBackupEntry(item, sourceEntry, "source");
                  const backupVisualEntry = findResearchBriefBackupEntry(item, visualEntry, "visual");
                  const summaryEntries = [
                    sourceEntry ? { label: "Main Source", entry: sourceEntry } : null,
                    visualEntry ? { label: "Main Visual", entry: visualEntry } : null,
                    backupSourceEntry ? { label: "Backup Source", entry: backupSourceEntry } : null,
                    backupVisualEntry ? { label: "Backup Visual", entry: backupVisualEntry } : null
                  ].filter(Boolean);
                  if (summaryEntries.length === 0) {
                    return <span>{item?.brief?.summary || "No research brief available."}</span>;
                  }
                  return (
                    <>
                      {pairState?.currentPairLabel ? (
                        <div className="segment-current-pair-row">
                          <span>Current Pair</span>
                          <span className={getCurrentPairBadgeClassName(pairState.currentPairLabel)}>
                            {pairState.currentPairLabel}
                          </span>
                          {pairState.currentPairHint ? (
                            <span className="segment-current-pair-hint">{pairState.currentPairHint}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {pairState?.pairSwitchLabel ? (
                        <span>
                          {`${pairState.pairSwitchLabel}${pairState.pairSwitchRelative ? ` · ${pairState.pairSwitchRelative}` : ""}${
                            pairState.pairSwitchAt ? ` · ${pairState.pairSwitchAt}` : ""
                          }`}
                        </span>
                      ) : null}
                      {summaryEntries.map((summaryEntry, index) => {
                        const metadataBadges = getVisibleResearchMetadataBadges(summaryEntry.entry);
                        return (
                          <div key={`segment-research-${item.segment_id}-${index}`} className="release-research-summary-entry">
                            <span>
                              {`${summaryEntry.label}: ${
                                summaryEntry.entry?.title || summaryEntry.entry?.url || summaryEntry.entry?.result_id || ""
                              }${summaryEntry.entry?.memory_hint ? ` · ${summaryEntry.entry.memory_hint}` : ""}`}
                            </span>
                            {metadataBadges.length > 0 ? (
                              <div className="release-trace-badges">
                                {metadataBadges.map((badge) => (
                                  <span key={`segment-research-${item.segment_id}-${index}-${badge}`} className="release-trace-badge">
                                    {badge}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
                <div className="release-diagnostic-actions">
                  {(() => {
                    const releaseItem = findReleaseItemForBrief(item, selectedReleaseAssets);
                    if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id || typeof handleUpdateReleaseAttachment !== "function") {
                      return null;
                    }
                    const sourceEntry = findResearchBriefEntryByRole(item, ["main_source", "backup_source", "reference"], ["source"]);
                    const visualEntry = findResearchBriefEntryByRole(item, ["visual_candidate"], ["visual", "download"]);
                    const backupSourceEntry = findResearchBriefBackupEntry(item, sourceEntry, "source");
                    const backupVisualEntry = findResearchBriefBackupEntry(item, visualEntry, "visual");
                    return (
                      <>
                        {sourceEntry && visualEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchPromotePatch(item, { sourceEntry, visualEntry })
                              )
                            }
                          >
                            Promote Main Pair
                          </button>
                        ) : null}
                        {sourceEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchSingleSidePatch(item, "source", { sourceEntry, visualEntry })
                              )
                            }
                          >
                            Use Main Source
                          </button>
                        ) : null}
                        {visualEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchSingleSidePatch(item, "visual", { sourceEntry, visualEntry })
                              )
                            }
                          >
                            Use Main Visual
                          </button>
                        ) : null}
                        {backupSourceEntry && backupVisualEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchPromotePatch(item, {
                                  sourceEntry: backupSourceEntry,
                                  visualEntry: backupVisualEntry
                                })
                              )
                            }
                          >
                            Promote Backup Pair
                          </button>
                        ) : null}
                        {backupSourceEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchSingleSidePatch(item, "source", {
                                  sourceEntry: backupSourceEntry,
                                  visualEntry
                                })
                              )
                            }
                          >
                            Use Backup Source
                          </button>
                        ) : null}
                        {backupVisualEntry ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                releaseItem.asset.id,
                                releaseItem.attachment.id,
                                buildResearchSingleSidePatch(item, "visual", {
                                  sourceEntry,
                                  visualEntry: backupVisualEntry
                                })
                              )
                            }
                          >
                            Use Backup Visual
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleOpenReleaseFromSegment?.(item.segment_id)}
                    disabled={!String(item?.segment_id ?? "").trim()}
                  >
                    Open Release
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleOpenReleaseResearchSegment?.(item.segment_id)}
                    disabled={!String(item?.segment_id ?? "").trim()}
                  >
                    Open Segment
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleOpenReleaseResearchSegment?.(item.segment_id, item.run_id)}
                    disabled={!String(item?.segment_id ?? "").trim() || !String(item?.run_id ?? "").trim()}
                  >
                    Open Run
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() =>
                      item?.is_pinned
                        ? handlePinReleaseResearchRun?.(item.segment_id, "")
                        : handlePinReleaseResearchRun?.(item.segment_id, item.run_id)
                    }
                    disabled={!String(item?.segment_id ?? "").trim() || !String(item?.run_id ?? "").trim()}
                  >
                    {item?.is_pinned ? "Unpin Run" : "Pin Run"}
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleCopyReleaseResearchBrief?.(item.segment_id, item.run_id)}
                    disabled={!String(item?.segment_id ?? "").trim()}
                  >
                    Copy Brief
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No segment research briefs linked to this release yet.</div>
        )}
      </div>
      <div className="release-assistant-panel">
        <div className="release-assistant-head">
          <strong>Release Assistant Pass</strong>
          <div className="release-assistant-actions">
            <span>{effectiveReleaseAssistantFindings.length}</span>
            <button className="btn ghost small" type="button" onClick={handlePrepareRelease} disabled={releaseBusy}>
              Prepare Release
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={handleMarkReleaseAirReady}
              disabled={releaseBusy || !releaseReadyToAir}
            >
              Mark Air Ready
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={handlePublishRelease}
              disabled={releaseBusy || !releaseControlPanel.can_publish}
            >
              Publish Release
            </button>
          </div>
        </div>
        <div className={`release-safety-hint${massActionSafetyHint.tone === "warning" ? " is-warning" : ""}`}>
          {massActionSafetyHint.text}
        </div>
        {lastAssistantAutoBackupHint ? (
          <div className="release-safety-hint">
            <span>{lastAssistantAutoBackupHint.text}</span>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => handleSelectBackupSnapshot?.(lastAssistantAutoBackupHint.backupId)}
            >
              Inspect Snapshot
            </button>
          </div>
        ) : null}
        <div className="release-assistant-list">
          {effectiveReleaseAssistantFindings.map((finding) => (
            <div key={finding.key} className={`release-assistant-item severity-${String(finding.severity ?? "low")}`}>
              <div className="release-assistant-copy">
                <strong>{finding.title}</strong>
                <span>{finding.detail}</span>
              </div>
              <div className="release-assistant-actions">
                {finding.key === "missing_script" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      setReleaseBoardFilter("missing_script");
                      setReleaseWorkspaceTab("board");
                    }}
                  >
                    Show
                  </button>
                ) : null}
                {finding.key === "missing_visual" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      setReleaseBoardFilter("missing_visual");
                      setReleaseWorkspaceTab("board");
                    }}
                  >
                    Show
                  </button>
                ) : null}
                {finding.key === "missing_visual" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={handleFillMissingVisualsWithRecommendations}
                    disabled={releaseBusy || releaseSummary.missing_visual === 0}
                  >
                    Attach Best
                  </button>
                ) : null}
                {finding.key === "needs_link" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      setReleaseBoardFilter("needs_link");
                      setReleaseWorkspaceTab("board");
                    }}
                  >
                    Show
                  </button>
                ) : null}
                {finding.key === "segments_visual_gap" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() =>
                      segmentsNeedingVisual[0] ? handleOpenSegmentScreenshotMode(segmentsNeedingVisual[0]) : null
                    }
                    disabled={!segmentsNeedingVisual[0]}
                  >
                    Fix First
                  </button>
                ) : null}
                {finding.key === "orphan_screenshots" ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={handleAttachOrphanScreenshots}
                    disabled={releaseBusy || effectiveOrphanScreenshotsCount === 0}
                  >
                    Attach All
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Assistant Trace Highlights</strong>
          <div className="release-draft-pack-summary">
            <span>{`Tracked ${traceHighlights.length}`}</span>
          </div>
        </div>
        {traceHighlights.length > 0 ? (
          <div className="release-draft-pack-list">
            {traceHighlights.map((item) => (
              <div key={`trace-${item.attachment_id}`} className="release-draft-pack-item">
                <strong>{item.title}</strong>
                <span>{item.last_action ? `Last action: ${item.last_action.replace(/_/g, " ")}` : `Status: ${item.item_status}`}</span>
                {item.script_section || item.script_title ? (
                  <span>{`Script from ${item.script_section || item.script_title}${item.script_title ? ` · ${item.script_title}` : ""}`}</span>
                ) : null}
                {item.visual_title || item.visual_section ? (
                  <span>{`Visual from ${item.visual_title || item.visual_section}${item.visual_best_for ? ` · best for ${item.visual_best_for}` : ""}`}</span>
                ) : null}
                {Array.isArray(item.confidence_badges) && item.confidence_badges.length > 0 ? (
                  <div className="release-trace-badges">
                    {item.confidence_badges.map((badge) => (
                      <span key={`${item.attachment_id}-${badge}`} className="release-trace-badge">
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.hasScriptGap || item.hasVisualGap ? (
                  <span>{`Open gaps:${item.hasScriptGap ? " script" : ""}${item.hasVisualGap ? " visual" : ""}`}</span>
                ) : null}
                <div className="release-draft-pack-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => setReleaseWorkspaceTab("rundown")}
                  >
                    Rundown
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No assistant traces yet. Prepare or fill notes to start tracking provenance.</div>
        )}
      </div>
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Publish Checklist</strong>
          <div className="release-draft-pack-summary">
            <span>Checks {releasePublishChecklistSummary.total_checks}</span>
            <span>Pass {releasePublishChecklistSummary.passed}</span>
            <span>Warn {releasePublishChecklistSummary.warnings}</span>
            <span>Block {releasePublishChecklistSummary.blocking_failures}</span>
          </div>
        </div>
        <div className="release-draft-pack-toolbar">
          <span className="muted">
            {releaseReadyToAir ? "Release can be moved to air_ready." : "Release still has blocking checks."}
          </span>
          {releasePublishChecklistSummary?.editorial_ready && !releasePublishChecklistSummary?.handoff_ready ? (
            <span className="muted">
              {`Editorially ready, but handoff is still ${formatHandoffStatusLabel(
                releasePublishChecklistSummary.handoff_status_code
              )}.`}
            </span>
          ) : null}
          <div className="release-draft-pack-actions">
            <button
              className="btn ghost small"
              type="button"
              onClick={handleMarkReleaseAirReady}
              disabled={releaseBusy || !releaseReadyToAir}
            >
              Ready Gate
            </button>
          </div>
        </div>
        {releasePublishChecklistItems.length > 0 ? (
          <div className="release-draft-pack-list">
            {releasePublishChecklistItems.map((item) => (
              <div key={`check-${item.key}`} className="release-draft-pack-item">
                <strong>{item.title}</strong>
                <span>
                  {String(item.status ?? "").toUpperCase()}
                  {item.blocking ? " · blocking" : " · advisory"}
                </span>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Checklist is not available yet.</div>
        )}
      </div>
      <div className="release-recommendations-panel">
        <div className="release-recommendations-head">
          <strong>Recommended Assets</strong>
          <div className="release-recommendations-summary">
            <span>All {releaseRecommendationSummary.total_candidates}</span>
            <span>Strong {releaseRecommendationSummary.strong}</span>
            <span>Good {releaseRecommendationSummary.good}</span>
          </div>
        </div>
        <div className="release-recommendations-toolbar">
          <span className="muted">
            {releaseRecommendationSummary.missing_visual_focus ? "visual focus active" : "general matching"}
          </span>
          <div className="release-recommendation-actions">
            <button
              className="btn ghost small"
              type="button"
              onClick={handleFillMissingVisualsWithRecommendations}
              disabled={releaseBusy || releaseSummary.missing_visual === 0 || recommendedReleaseAssets.length === 0}
            >
              Fill Visual Gaps
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={handleStartAttachTopReview}
              disabled={releaseBusy || recommendedReleaseAssets.length === 0}
            >
              Attach Top 3
            </button>
          </div>
        </div>
        {attachTopPreview.length > 0 ? (
          <div className="release-recommendation-preview">
            <span className="release-recommendation-preview-label">Attach Top 3 preview</span>
            <div className="release-recommendation-preview-list">
              {attachTopPreview.map((item, index) => {
                const isSelected = attachTopSelectedIds.includes(String(item?.id ?? "").trim());
                const lastResult = lastAttachResultByAssetId.get(String(item?.id ?? "").trim()) ?? null;
                return (
                  <label
                    key={`attach-preview-${item.id}-${index}`}
                    className={`release-recommendation-preview-item${attachTopConfirmOpen ? " is-interactive" : ""}${
                      isSelected ? " is-selected" : ""
                    }`}
                  >
                    {attachTopConfirmOpen ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleAttachTopCandidate(item.id)}
                        disabled={releaseBusy}
                      />
                    ) : null}
                    <div className="release-recommendation-preview-copy">
                      <strong>{`${index + 1}. ${item.title}`}</strong>
                      <span>
                        {item.bucket}
                        {item.memory ? ` · ${item.memory}` : ""}
                      </span>
                      {Array.isArray(item.metadataBadges) && item.metadataBadges.length > 0 ? (
                        <div className="release-trace-badges">
                          {item.metadataBadges.map((badge) => (
                            <span key={`preview-meta-${item.id}-${badge}`} className="release-trace-badge">
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {lastResult ? (
                        <span className={`release-recommendation-preview-result is-${String(lastResult?.status ?? "").trim().toLowerCase()}`}>
                          {String(lastResult?.status ?? "").trim().toLowerCase() === "attached"
                            ? "Attached"
                            : `Skipped${lastResult?.reason ? ` · ${String(lastResult.reason).replace(/_/g, " ")}` : ""}`}
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
            {attachTopConfirmOpen ? (
              <div className="release-recommendation-preview-actions">
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleConfirmAttachTopReview}
                  disabled={releaseBusy || attachTopSelectedIds.length === 0}
                >
                  Attach Selected
                </button>
                <button className="btn ghost small" type="button" onClick={handleCancelAttachTopReview} disabled={releaseBusy}>
                  Cancel
                </button>
              </div>
            ) : null}
            {!attachTopConfirmOpen && (Number(lastAttachRecommendationsResult?.attached ?? 0) > 0 || Number(lastAttachRecommendationsResult?.skipped ?? 0) > 0) ? (
              <div className="release-recommendation-preview-summary">
                <span>{`Attached ${Number(lastAttachRecommendationsResult?.attached ?? 0)}`}</span>
                <span>{`Skipped ${Number(lastAttachRecommendationsResult?.skipped ?? 0)}`}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {recommendedReleaseAssets.length > 0 ? (
          <div className="release-recommendations-list">
            {recommendedReleaseAssets.slice(0, 8).map((item, index) => {
              const asset = item?.asset ?? {};
              const memoryBadges = collectRecommendationMemoryBadges(item?.reasons);
              const metadataBadges = buildSourceMetadataBadges(asset, sourceProfiles);
              const explainLine = buildRecommendationExplainLine(item, index);
              return (
                <div key={`rec-${asset.id}`} className={`release-recommendation-item bucket-${item.bucket || "possible"}`}>
                  <div className="release-recommendation-main">
                    <strong>{asset.title || asset.file_name || asset.id}</strong>
                    <span>
                      {formatRecommendationBucketLabel(item.bucket)} · score {Number(item.score ?? 0)}
                      {asset.meta_json?.section_title ? ` · ${asset.meta_json.section_title}` : ""}
                    </span>
                    {item?.matched_section_title ? (
                      <span>{`Best for: ${item.matched_section_title}${item?.matched_segment_id ? ` · ${item.matched_segment_id}` : ""}`}</span>
                    ) : null}
                    {memoryBadges.length > 0 ? (
                      <div className="release-trace-badges">
                        {memoryBadges.map((badge) => (
                          <span
                            key={`rec-memory-${asset.id}-${badge}`}
                            className={`release-trace-badge ${badge.startsWith("Helpful") ? "is-helpful" : "is-used"}`}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {metadataBadges.length > 0 ? (
                      <div className="release-trace-badges">
                        {metadataBadges.map((badge) => (
                          <span key={`rec-meta-${asset.id}-${badge}`} className="release-trace-badge">
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <span>{item.reason_summary || "Suggested by release context"}</span>
                    {explainLine ? <div className="release-recommendation-explain">{explainLine}</div> : null}
                    {Array.isArray(item?.reasons) && item.reasons.length > 0 ? (
                      <div className="release-recommendation-tags">
                        {item.reasons.slice(0, 4).map((reason, index) => (
                          <span
                            key={`rec-reason-${asset.id}-${String(reason?.key ?? index)}`}
                            className={`release-recommendation-tag reason-${String(reason?.key ?? "generic").trim().toLowerCase()}`}
                          >
                            {formatRecommendationReasonTag(reason)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="release-recommendation-actions">
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleAttachAssetToRelease(asset.id)}
                      disabled={Boolean(assetActionBusy[asset.id]) || !selectedReleaseId}
                    >
                      Add
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleOpenAssetScreenshotMode(asset)}
                      disabled={!asset.source_url}
                    >
                      Скрин
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">Пока нет уверенных рекомендаций для этого выпуска.</div>
        )}
      </div>
      <div className="release-draft-pack-panel">
        <div className="release-draft-pack-head">
          <strong>Draft Pack</strong>
          <div className="release-draft-pack-summary">
            <span>All {releaseDraftPackSummary.total}</span>
            <span>Need Script {releaseDraftPackSummary.script_candidates}</span>
            <span>Need Visual {releaseDraftPackSummary.visual_candidates}</span>
          </div>
        </div>
        <div className="release-draft-pack-toolbar">
          <span className="muted">Server-side draft notes for current rundown.</span>
          <div className="release-draft-pack-actions">
            <button
              className="btn ghost small"
              type="button"
              onClick={() => handleApplyReleaseDraftPack("missing_only")}
              disabled={releaseBusy || releaseDraftPackSummary.script_candidates + releaseDraftPackSummary.visual_candidates === 0}
            >
              Fill Missing
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => handleApplyReleaseDraftPack("overwrite")}
              disabled={releaseBusy || releaseDraftPackItems.length === 0}
            >
              Overwrite
            </button>
          </div>
        </div>
        <div className={`release-safety-hint${massActionSafetyHint.tone === "warning" ? " is-warning" : ""}`}>
          {massActionSafetyHint.text}
        </div>
        {lastAssistantAutoBackupHint ? (
          <div className="release-safety-hint">
            <span>{lastAssistantAutoBackupHint.text}</span>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => handleSelectBackupSnapshot?.(lastAssistantAutoBackupHint.backupId)}
            >
              Inspect Snapshot
            </button>
          </div>
        ) : null}
        {releaseDraftPackItems.length > 0 ? (
          <div className="release-draft-pack-list">
            {releaseDraftPackItems.slice(0, 6).map((item) => (
              <div key={`draft-${item.attachment_id}`} className="release-draft-pack-item">
                <strong>
                  {Number(item.sort_order ?? 0) > 0 ? `${item.sort_order}. ` : ""}
                  {item.title || item.attachment_id}
                </strong>
                {item.suggested_script_note ? <span>Script: {item.suggested_script_note}</span> : null}
                {item.suggested_visual_note ? <span>Visual: {item.suggested_visual_note}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Черновых note suggestions пока нет.</div>
        )}
      </div>
    </div>
  );
}
