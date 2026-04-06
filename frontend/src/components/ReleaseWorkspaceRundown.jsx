import React from "react";

import { buildSourceMetadataBadges } from "../utils/sourceMetadata.js";

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
  if (items.length === 0) return { entry: null, origin: "" };
  const normalizedKind = String(kind ?? "").trim().toLowerCase();
  const primaryResultId = String(primaryEntry?.result_id ?? "").trim();
  const primaryKey = String(primaryEntry?.key ?? "").trim().toLowerCase();
  const explicit =
    normalizedKind === "visual"
      ? findResearchBriefEntryByRole(brief, ["visual_candidate"], ["backup_visual"])
      : findResearchBriefEntryByRole(brief, ["backup_source", "reference", "main_source"], ["backup_source"]);
  const explicitResultId = String(explicit?.result_id ?? "").trim();
  const explicitKey = String(explicit?.key ?? "").trim().toLowerCase();
  if (
    explicit &&
    ((explicitResultId && explicitResultId !== primaryResultId) || (explicitKey && explicitKey !== primaryKey))
  ) {
    return {
      entry: explicit,
      origin: normalizedKind === "visual" ? "research_backup_visual" : "research_backup_source"
    };
  }
  const fallbackEntry =
    items.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const entryResultId = String(entry?.result_id ?? "").trim();
      const entryKey = String(entry?.key ?? "").trim().toLowerCase();
      if ((entryResultId && entryResultId === primaryResultId) || (entryKey && entryKey === primaryKey)) return false;
      const role = String(entry?.role ?? "").trim().toLowerCase();
      if (normalizedKind === "visual") return role === "visual_candidate";
      return ["main_source", "backup_source", "reference"].includes(role);
    }) ?? null;
  return {
    entry: fallbackEntry,
    origin:
      normalizedKind === "visual"
        ? (fallbackEntry ? "research_fallback_visual" : "")
        : (fallbackEntry ? "research_fallback_source" : "")
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

function deriveInspectorShotcard(item = null, researchBrief = null, { sourceEntry = null, visualEntry = null } = {}) {
  const attachment = item?.attachment ?? {};
  const trace = attachment?.assistant_trace_json ?? {};
  const fallbackVisualMeta = findResearchBriefBackupEntry(researchBrief, visualEntry, "visual");
  const fallbackSourceMeta = findResearchBriefBackupEntry(researchBrief, sourceEntry, "source");
  const fallbackVisual = fallbackVisualMeta.entry;
  const fallbackSource = fallbackSourceMeta.entry;
  const primarySourceLabel = String(sourceEntry?.title || sourceEntry?.label || sourceEntry?.domain || "").trim();
  const primaryVisualLabel = String(visualEntry?.title || visualEntry?.label || visualEntry?.domain || "").trim();
  const fallbackSourceLabel = String(fallbackSource?.title || fallbackSource?.label || fallbackSource?.domain || "").trim();
  const fallbackVisualLabel = String(fallbackVisual?.title || fallbackVisual?.label || fallbackVisual?.domain || "").trim();

  const primarySource = {
    title: String(trace?.script?.title || primarySourceLabel).trim(),
    domain: String(trace?.script?.domain || sourceEntry?.domain || "").trim(),
    origin: String(trace?.script?.source_type || (sourceEntry ? "research_brief" : "")).trim()
  };
  const primaryVisual = {
    title: String(trace?.visual?.recommendation?.title || trace?.visual?.title || primaryVisualLabel || "").trim(),
    domain: String(trace?.visual?.recommendation?.source_domain || trace?.visual?.domain || visualEntry?.domain || "").trim(),
    origin: String(trace?.visual?.source_type || (visualEntry ? "research_brief" : "")).trim()
  };
  const fallback = {
    title: String(fallbackVisualLabel || fallbackSourceLabel || "").trim(),
    domain: String(fallbackVisual?.domain || fallbackSource?.domain || "").trim(),
    origin: fallbackVisual ? fallbackVisualMeta.origin : fallbackSourceMeta.origin
  };
  const sourceMatchesMain =
    Boolean(primarySource.title) &&
    Boolean(primarySourceLabel) &&
    normalizeComparablePickLabel(primarySource.title) === normalizeComparablePickLabel(primarySourceLabel);
  const sourceMatchesBackup =
    Boolean(primarySource.title) &&
    Boolean(fallbackSourceLabel) &&
    normalizeComparablePickLabel(primarySource.title) === normalizeComparablePickLabel(fallbackSourceLabel);
  const visualMatchesMain =
    Boolean(primaryVisual.title) &&
    Boolean(primaryVisualLabel) &&
    normalizeComparablePickLabel(primaryVisual.title) === normalizeComparablePickLabel(primaryVisualLabel);
  const visualMatchesBackup =
    Boolean(primaryVisual.title) &&
    Boolean(fallbackVisualLabel) &&
    normalizeComparablePickLabel(primaryVisual.title) === normalizeComparablePickLabel(fallbackVisualLabel);
  const currentPairLabel =
    sourceMatchesMain && visualMatchesMain
      ? "Main Pair"
      : sourceMatchesBackup && visualMatchesBackup
        ? "Backup Pair"
        : (sourceMatchesMain || sourceMatchesBackup || visualMatchesMain || visualMatchesBackup)
          ? "Mixed Pair"
          : (primarySource.title || primaryVisual.title)
            ? "Custom Pair"
            : "";
  const currentPairHint =
    currentPairLabel === "Main Pair"
      ? "Aligned with main picks"
      : currentPairLabel === "Backup Pair"
        ? "Using backup picks"
        : currentPairLabel === "Mixed Pair"
          ? "Mixed main + backup"
          : String(trace?.visual?.recommendation?.asset_id ?? "").trim()
            ? "Recommendation-backed override"
            : String(trace?.script?.source_type ?? "").trim().toLowerCase() === "manual_override" ||
                String(trace?.visual?.source_type ?? "").trim().toLowerCase() === "manual_override"
              ? "Custom override"
              : currentPairLabel
                ? "Custom research mix"
                : "";

  return {
    primarySource,
    primaryVisual,
    fallback,
    currentPairLabel,
    currentPairHint
  };
}

function formatShotcardOrigin(origin = "") {
  const normalized = String(origin ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "research_bundle") return "research bundle";
  if (normalized === "research_brief") return "research brief";
  if (normalized === "assistant_recommendation") return "assistant recommendation";
  if (normalized === "research_backup_visual") return "backup visual";
  if (normalized === "research_backup_source") return "backup source";
  if (normalized === "research_brief") return "research";
  if (normalized === "recommendation") return "recommendation";
  if (normalized === "assistant") return "assistant";
  if (normalized === "manual_override") return "manual";
  if (normalized === "research_fallback_visual") return "fallback visual";
  if (normalized === "research_fallback_source") return "fallback source";
  return normalized.replace(/_/g, " ");
}

function formatHandoffReadyStateLabel(value = "") {
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

function formatHandoffResolvedEventLabel(event = "") {
  const normalized = String(event ?? "").trim().toLowerCase();
  if (normalized === "handoff_download_resolved") return "Download resolved";
  if (normalized === "handoff_capture_resolved") return "Capture resolved";
  return normalized ? normalized.replace(/_/g, " ") : "";
}

function isLikelyDownloadSource(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (/\.(mp4|mov|m4v|webm|mkv|mp3|wav|jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(normalized)) return true;
  return [
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "tiktok.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "vk.com",
    "rutube.ru"
  ].some((domain) => normalized.includes(domain));
}

function inferInspectorHandoffState(item = null, handoffEvents = []) {
  const asset = item?.asset ?? {};
  const localPath = String(asset?.local_path ?? asset?.screenshot_path ?? "").trim();
  const sourceUrl = String(asset?.source_url ?? "").trim();
  let readyState = "ready";
  if (localPath) {
    readyState = "ready";
  } else if (sourceUrl) {
    readyState = isLikelyDownloadSource(sourceUrl) ? "download_needed" : "capture_needed";
  }
  const latestResolvedEvent =
    (Array.isArray(handoffEvents) ? handoffEvents : []).find((entry) =>
      ["handoff_download_resolved", "handoff_capture_resolved"].includes(String(entry?.event ?? "").trim().toLowerCase())
    ) ?? null;
  if (latestResolvedEvent) {
    const event = String(latestResolvedEvent?.event ?? "").trim().toLowerCase();
    if (event === "handoff_download_resolved") {
      return { ready_state: "downloaded", latest_resolved_event: latestResolvedEvent };
    }
    if (event === "handoff_capture_resolved") {
      return { ready_state: "captured", latest_resolved_event: latestResolvedEvent };
    }
  }
  return { ready_state: readyState, latest_resolved_event: null };
}

function formatTimelineEventTitle(event = "") {
  const normalized = String(event ?? "").trim().toLowerCase();
  if (normalized === "manual_override") return "Manual override";
  if (normalized === "research_pick_applied") return "Research pick applied";
  if (normalized === "release_item_updated") return "Release item updated";
  if (normalized === "asset_attached") return "Asset attached";
  if (normalized === "asset_detached") return "Asset detached";
  if (normalized === "prepare_selection") return "Prepare selection";
  if (normalized === "prepare_release") return "Prepare release";
  if (normalized === "fill_missing_visuals") return "Fill missing visuals";
  if (normalized === "fill_selection_visuals") return "Fill selected visuals";
  if (normalized === "apply_draft_pack") return "Apply draft pack";
  if (normalized === "apply_selection_draft_pack") return "Apply selection draft pack";
  return normalized ? normalized.replace(/_/g, " ") : "Activity";
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

function ReleaseRundownItemRow({
  item,
  selectedReleaseAttachmentIdSet,
  toggleReleaseAttachmentSelection,
  formatAssetKindLabel,
  handleUpdateReleaseAttachment,
  assetActionBusy,
  handleReorderReleaseAsset,
  handleOpenAssetScreenshotMode,
  handleAssetStatusUpdate,
  handleDetachAssetFromRelease,
  releaseBusy,
  totalItems,
  sourceProfiles
}) {
  const traceBadges = deriveTraceConfidenceBadges(item);
  const metadataBadges = buildSourceMetadataBadges(item?.asset, sourceProfiles);
  return (
    <div
      key={`${item.asset?.id}-${item.attachment?.id}`}
      className={`integration-row newsroom-row${
        selectedReleaseAttachmentIdSet.has(String(item.attachment?.id ?? "").trim()) ? " release-row-selected" : ""
      }`}
    >
      <label className="release-item-select">
        <input
          type="checkbox"
          checked={selectedReleaseAttachmentIdSet.has(String(item.attachment?.id ?? "").trim())}
          onChange={() => toggleReleaseAttachmentSelection(item.attachment?.id)}
        />
      </label>
      <div className="integration-row-main">
        <strong>
          {Number(item.attachment?.sort_order ?? 0) > 0 ? `${item.attachment.sort_order}. ` : ""}
          {item.asset?.title || item.asset?.file_name || item.asset?.id}
        </strong>
        <span>
          {formatAssetKindLabel(item.asset?.kind)}
          {item.attachment?.role ? ` В· ${item.attachment.role}` : ""}
        </span>
        {metadataBadges.length > 0 ? (
          <div className="release-trace-badges">
            {metadataBadges.map((badge) => (
              <span key={`${item.attachment?.id}-${badge}`} className="release-trace-badge">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="integration-row-side">
        <span>{item.asset?.meta_json?.section_title || item.asset?.source_domain || "No section"}</span>
        <code>{item.asset?.local_path || item.asset?.source_url || item.asset?.id}</code>
      </div>
      <div className="release-item-editor">
        {traceBadges.length > 0 ? (
          <div className="release-trace-badges">
            {traceBadges.map((badge) => (
              <span key={`${item.attachment?.id}-${badge}`} className="release-trace-badge">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        <select
          value={item.attachment?.item_status || "planned"}
          onChange={(event) =>
            handleUpdateReleaseAttachment(item.asset?.id, item.attachment?.id, {
              item_status: event.target.value
            })
          }
          disabled={Boolean(assetActionBusy[item.asset?.id])}
        >
          <option value="planned">planned</option>
          <option value="selected">selected</option>
          <option value="scripting">scripting</option>
          <option value="visual_ready">visual_ready</option>
          <option value="ready">ready</option>
          <option value="done">done</option>
          <option value="skipped">skipped</option>
        </select>
        <input
          key={`${item.attachment?.id}-script-${item.attachment?.script_note || ""}`}
          className="release-item-note"
          defaultValue={item.attachment?.script_note || ""}
          placeholder="Script note"
          onBlur={(event) =>
            handleUpdateReleaseAttachment(item.asset?.id, item.attachment?.id, {
              script_note: event.target.value
            })
          }
        />
        <input
          key={`${item.attachment?.id}-visual-${item.attachment?.visual_note || ""}`}
          className="release-item-note"
          defaultValue={item.attachment?.visual_note || ""}
          placeholder="Visual note"
          onBlur={(event) =>
            handleUpdateReleaseAttachment(item.asset?.id, item.attachment?.id, {
              visual_note: event.target.value
            })
          }
        />
        {item.attachment?.assistant_trace_json?.script || item.attachment?.assistant_trace_json?.visual ? (
          <div className="release-item-trace">
            {item.attachment?.assistant_trace_json?.script?.section_title ? (
              <span>
                {`Script from ${item.attachment.assistant_trace_json.script.section_title}${
                  item.attachment?.assistant_trace_json?.script?.title
                    ? ` В· ${item.attachment.assistant_trace_json.script.title}`
                    : ""
                }`}
              </span>
            ) : null}
            {item.attachment?.assistant_trace_json?.visual?.title ||
            item.attachment?.assistant_trace_json?.visual?.section_title ? (
              <span>
                {`Visual from ${
                  item.attachment?.assistant_trace_json?.visual?.title ||
                  item.attachment?.assistant_trace_json?.visual?.section_title
                }${
                  item.attachment?.assistant_trace_json?.visual?.recommendation?.matched_section_title
                    ? ` В· best for ${item.attachment.assistant_trace_json.visual.recommendation.matched_section_title}`
                    : ""
                }`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="newsroom-actions">
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleReorderReleaseAsset(item.attachment?.id, "up")}
          disabled={releaseBusy || Number(item.attachment?.sort_order ?? 0) <= 1}
        >
          в†‘
        </button>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleReorderReleaseAsset(item.attachment?.id, "down")}
          disabled={releaseBusy || Number(item.attachment?.sort_order ?? 0) >= totalItems}
        >
          в†“
        </button>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleOpenAssetScreenshotMode(item.asset)}
          disabled={!item.asset?.source_url}
        >
          Screenshot
        </button>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleAssetStatusUpdate(item.asset?.id, "processed")}
          disabled={Boolean(assetActionBusy[item.asset?.id])}
        >
          Ready
        </button>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleAssetStatusUpdate(item.asset?.id, "archived")}
          disabled={Boolean(assetActionBusy[item.asset?.id])}
        >
          Archive
        </button>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => handleDetachAssetFromRelease(item.asset?.id, item.attachment?.id)}
          disabled={Boolean(assetActionBusy[item.asset?.id])}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function ReleaseWorkspaceRundown({
  selectedReleaseItems,
  selectedReleaseAssets,
  handleSelectAllReleaseItems,
  handleSelectReleaseItemsByFilter,
  handleClearReleaseSelection,
  handleBulkUpdateReleaseItems,
  releaseBusy,
  handleBulkUpdateSelectedAssetStatus,
  handleBulkDetachReleaseItems,
  releaseBulkScriptTemplate,
  setReleaseBulkScriptTemplate,
  releaseBulkVisualTemplate,
  setReleaseBulkVisualTemplate,
  handleBulkApplyNoteTemplates,
  handlePrepareSelectedReleaseItems,
  handlePrepareReleaseAttachment,
  handleApplySelectionDraftPack,
  handleDraftReleaseAttachment,
  handleFillSelectedVisualsWithRecommendations,
  handleFillReleaseAttachmentVisuals,
  selectedReleaseAttachmentIdSet,
  toggleReleaseAttachmentSelection,
  formatAssetKindLabel,
  handleUpdateReleaseAttachment,
  assetActionBusy,
  handleReorderReleaseAsset,
  handleOpenAssetScreenshotMode,
  handleDownloadMedia,
  getMediaDownloadState,
  handleAssetStatusUpdate,
  handleDetachAssetFromRelease,
  releaseActivity,
  releaseResearchBriefs,
  sourceProfiles,
  releaseDraftPackItems,
  formatRelativeEventLabel,
  formatDateTimeShort
}) {
  const inspectorItem = React.useMemo(
    () => selectedReleaseItems[0] ?? selectedReleaseAssets[0] ?? null,
    [selectedReleaseAssets, selectedReleaseItems]
  );
  const inspectorTraceBadges = React.useMemo(
    () => (inspectorItem ? deriveTraceConfidenceBadges(inspectorItem) : []),
    [inspectorItem]
  );
  const inspectorMetadataBadges = React.useMemo(
    () => (inspectorItem ? buildSourceMetadataBadges(inspectorItem.asset, sourceProfiles) : []),
    [inspectorItem, sourceProfiles]
  );
  const inspectorResearchBrief = React.useMemo(
    () => findResearchBriefForItem(releaseResearchBriefs, inspectorItem),
    [inspectorItem, releaseResearchBriefs]
  );
  const inspectorDraftItem = React.useMemo(() => {
    const items = Array.isArray(releaseDraftPackItems) ? releaseDraftPackItems : [];
    const attachmentId = String(inspectorItem?.attachment?.id ?? "").trim();
    if (!attachmentId) return null;
    return items.find((item) => String(item?.attachment_id ?? "").trim() === attachmentId) ?? null;
  }, [inspectorItem, releaseDraftPackItems]);
  const inspectorActivity = React.useMemo(() => {
    const items = Array.isArray(releaseActivity) ? releaseActivity : [];
    const attachmentId = String(inspectorItem?.attachment?.id ?? "").trim();
    const assetId = String(inspectorItem?.asset?.id ?? "").trim();
    return items
      .filter(
        (item) =>
          (attachmentId && String(item?.attachment_id ?? "").trim() === attachmentId) ||
          (assetId && String(item?.asset_id ?? "").trim() === assetId)
      )
      .slice(0, 6);
  }, [inspectorItem, releaseActivity]);
  const inspectorResearchSource = React.useMemo(
    () => findResearchBriefEntryByRole(inspectorResearchBrief, ["main_source", "backup_source", "reference"], ["source"]),
    [inspectorResearchBrief]
  );
  const inspectorResearchVisual = React.useMemo(
    () => findResearchBriefEntryByRole(inspectorResearchBrief, ["visual_candidate"], ["visual", "download"]),
    [inspectorResearchBrief]
  );
  const inspectorResearchBackupSource = React.useMemo(
    () => findResearchBriefBackupEntry(inspectorResearchBrief, inspectorResearchSource, "source").entry,
    [inspectorResearchBrief, inspectorResearchSource]
  );
  const inspectorResearchBackupVisual = React.useMemo(
    () => findResearchBriefBackupEntry(inspectorResearchBrief, inspectorResearchVisual, "visual").entry,
    [inspectorResearchBrief, inspectorResearchVisual]
  );
  const inspectorShotcard = React.useMemo(
    () =>
      deriveInspectorShotcard(inspectorItem, inspectorResearchBrief, {
        sourceEntry: inspectorResearchSource,
        visualEntry: inspectorResearchVisual
      }),
    [inspectorItem, inspectorResearchBrief, inspectorResearchSource, inspectorResearchVisual]
  );
  const inspectorHandoffEvents = React.useMemo(
    () =>
      inspectorActivity.filter((entry) =>
        ["handoff_snapshot", "handoff_download_resolved", "handoff_capture_resolved"].includes(
          String(entry?.event ?? "").trim().toLowerCase()
        )
      ),
    [inspectorActivity]
  );
  const inspectorHandoffTrace = React.useMemo(
    () => inferInspectorHandoffState(inspectorItem, inspectorHandoffEvents),
    [inspectorHandoffEvents, inspectorItem]
  );
  const inspectorPairSwitchEvent = React.useMemo(() => {
    const attachmentId = String(inspectorItem?.attachment?.id ?? "").trim();
    if (!attachmentId) return null;
    return (Array.isArray(releaseActivity) ? releaseActivity : []).find((entry) => {
      const event = String(entry?.event ?? "").trim().toLowerCase();
      const targetAttachmentId = String(entry?.attachment_id ?? entry?.meta_json?.attachment_id ?? "").trim();
      return targetAttachmentId === attachmentId && ["research_pick_applied", "manual_override"].includes(event);
    }) ?? null;
  }, [inspectorItem, releaseActivity]);
  const inspectorDownloadState = React.useMemo(() => {
    if (!inspectorItem?.asset?.source_url || typeof getMediaDownloadState !== "function") return null;
    return getMediaDownloadState(inspectorItem.asset.source_url);
  }, [getMediaDownloadState, inspectorItem]);
  const handleOpenInspectorSource = React.useCallback(() => {
    const sourceUrl = String(inspectorItem?.asset?.source_url ?? "").trim();
    if (!sourceUrl) return;
    window.open(sourceUrl, "_blank", "noopener,noreferrer");
  }, [inspectorItem]);

  return (
    <div className="release-workspace-section">
      <div className="release-bulk-toolbar">
        <div className="release-bulk-summary">
          <strong>Selected {selectedReleaseItems.length}</strong>
          <span>of {selectedReleaseAssets.length}</span>
        </div>
        <div className="release-bulk-actions">
          <button className="btn ghost small" type="button" onClick={handleSelectAllReleaseItems}>
            Select All
          </button>
          <button className="btn ghost small" type="button" onClick={() => handleSelectReleaseItemsByFilter("missing_script")}>
            Missing Script
          </button>
          <button className="btn ghost small" type="button" onClick={() => handleSelectReleaseItemsByFilter("missing_visual")}>
            Missing Visual
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={handleClearReleaseSelection}
            disabled={selectedReleaseItems.length === 0}
          >
            Clear
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkUpdateReleaseItems({ item_status: "ready" }, "Release items ready")}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Mark Ready
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkUpdateReleaseItems({ item_status: "visual_ready" }, "Release items visual_ready")}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Visual Ready
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={handlePrepareSelectedReleaseItems}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Prepare Selected
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleApplySelectionDraftPack("missing_only")}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Draft Selected
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={handleFillSelectedVisualsWithRecommendations}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Fill Visuals
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkUpdateSelectedAssetStatus("processed", "Assets processed")}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Processed
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkUpdateSelectedAssetStatus("archived", "Assets archived")}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Archive
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={handleBulkDetachReleaseItems}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Remove Selected
          </button>
        </div>
        <div className="release-bulk-templates">
          <input
            className="release-bulk-input"
            value={releaseBulkScriptTemplate}
            onChange={(event) => setReleaseBulkScriptTemplate(event.target.value)}
            placeholder="Bulk script note template"
          />
          <input
            className="release-bulk-input"
            value={releaseBulkVisualTemplate}
            onChange={(event) => setReleaseBulkVisualTemplate(event.target.value)}
            placeholder="Bulk visual note template"
          />
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkApplyNoteTemplates({ overwrite: false })}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Fill Missing Notes
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleBulkApplyNoteTemplates({ overwrite: true })}
            disabled={releaseBusy || selectedReleaseItems.length === 0}
          >
            Overwrite Notes
          </button>
        </div>
      </div>
      {selectedReleaseAssets.length > 0 ? (
        <div className="release-rundown-layout">
          <div className="integration-list">
            {selectedReleaseAssets.map((item) => (
              <ReleaseRundownItemRow
                key={`${item.asset?.id}-${item.attachment?.id}`}
                item={item}
                selectedReleaseAttachmentIdSet={selectedReleaseAttachmentIdSet}
                toggleReleaseAttachmentSelection={toggleReleaseAttachmentSelection}
                formatAssetKindLabel={formatAssetKindLabel}
                handleUpdateReleaseAttachment={handleUpdateReleaseAttachment}
                assetActionBusy={assetActionBusy}
                handleReorderReleaseAsset={handleReorderReleaseAsset}
                handleOpenAssetScreenshotMode={handleOpenAssetScreenshotMode}
                handleAssetStatusUpdate={handleAssetStatusUpdate}
                handleDetachAssetFromRelease={handleDetachAssetFromRelease}
                releaseBusy={releaseBusy}
                totalItems={selectedReleaseAssets.length}
                sourceProfiles={sourceProfiles}
              />
            ))}
          </div>
          <div className="release-item-inspector">
            {inspectorItem ? (
              <>
                <div className="release-item-inspector-head">
                  <strong>{inspectorItem.asset?.title || inspectorItem.asset?.file_name || inspectorItem.asset?.id}</strong>
                  <span>{`${formatAssetKindLabel(inspectorItem.asset?.kind)} В· ${inspectorItem.attachment?.item_status || "planned"}`}</span>
                </div>
                {inspectorTraceBadges.length > 0 ? (
                  <div className="release-trace-badges">
                    {inspectorTraceBadges.map((badge) => (
                      <span key={`inspector-${badge}`} className="release-trace-badge">
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="release-item-inspector-block">
                  <strong>Asset</strong>
                  <span>{inspectorItem.asset?.meta_json?.section_title || inspectorItem.asset?.source_domain || "No section"}</span>
                  {inspectorMetadataBadges.length > 0 ? (
                    <div className="release-trace-badges">
                      {inspectorMetadataBadges.map((badge) => (
                        <span key={`inspector-meta-${badge}`} className="release-trace-badge">
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <code>{inspectorItem.asset?.source_url || inspectorItem.asset?.local_path || inspectorItem.asset?.id}</code>
                </div>
                <div className="release-item-inspector-block">
                  <strong>Inspector Actions</strong>
                  <div className="release-item-inspector-actions">
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handlePrepareReleaseAttachment(inspectorItem.attachment?.id)}
                      disabled={releaseBusy || !inspectorItem?.attachment?.id}
                    >
                      Prepare
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleDraftReleaseAttachment(inspectorItem.attachment?.id, "missing_only")}
                      disabled={releaseBusy || !inspectorItem?.attachment?.id}
                    >
                      Draft
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleFillReleaseAttachmentVisuals(inspectorItem.attachment?.id)}
                      disabled={releaseBusy || !inspectorItem?.attachment?.id}
                    >
                      Fill Visuals
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleOpenAssetScreenshotMode(inspectorItem.asset)}
                      disabled={!inspectorItem?.asset?.source_url}
                    >
                      Screenshot
                    </button>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() =>
                        handleUpdateReleaseAttachment(inspectorItem.asset?.id, inspectorItem.attachment?.id, {
                          item_status: "ready"
                        })
                      }
                      disabled={releaseBusy || !inspectorItem?.asset?.id || !inspectorItem?.attachment?.id}
                    >
                      Mark Ready
                    </button>
                  </div>
                </div>
                <div className="release-item-inspector-block">
                  <strong>Notes</strong>
                  <span>{inspectorItem.attachment?.script_note || "No script note yet."}</span>
                  <span>{inspectorItem.attachment?.visual_note || "No visual note yet."}</span>
                </div>
                <div className="release-item-inspector-block">
                  <strong>Shotcard</strong>
                  {inspectorShotcard.currentPairLabel ? (
                    <div className="segment-current-pair-row">
                      <span>Current Pair</span>
                      <span className={getCurrentPairBadgeClassName(inspectorShotcard.currentPairLabel)}>
                        {inspectorShotcard.currentPairLabel}
                      </span>
                      {inspectorShotcard.currentPairHint ? (
                        <span className="segment-current-pair-hint">{inspectorShotcard.currentPairHint}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="release-shotcard-grid">
                    <div className="release-shotcard-cell">
                      <span className="release-shotcard-label">Picked Source</span>
                      <strong>{inspectorShotcard.primarySource.title || "Not picked yet"}</strong>
                      {inspectorShotcard.primarySource.domain ? <span>{inspectorShotcard.primarySource.domain}</span> : null}
                      {inspectorShotcard.primarySource.origin ? (
                        <span className="release-shotcard-origin">{formatShotcardOrigin(inspectorShotcard.primarySource.origin)}</span>
                      ) : null}
                    </div>
                    <div className="release-shotcard-cell">
                      <span className="release-shotcard-label">Picked Visual</span>
                      <strong>{inspectorShotcard.primaryVisual.title || "Not picked yet"}</strong>
                      {inspectorShotcard.primaryVisual.domain ? <span>{inspectorShotcard.primaryVisual.domain}</span> : null}
                      {inspectorShotcard.primaryVisual.origin ? (
                        <span className="release-shotcard-origin">{formatShotcardOrigin(inspectorShotcard.primaryVisual.origin)}</span>
                      ) : null}
                    </div>
                    <div className="release-shotcard-cell">
                      <span className="release-shotcard-label">Fallback</span>
                      <strong>{inspectorShotcard.fallback.title || "No fallback yet"}</strong>
                      {inspectorShotcard.fallback.domain ? <span>{inspectorShotcard.fallback.domain}</span> : null}
                      {inspectorShotcard.fallback.origin ? (
                        <span className="release-shotcard-origin">{formatShotcardOrigin(inspectorShotcard.fallback.origin)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="release-item-inspector-block">
                  <strong>Handoff Trace</strong>
                  <span>{`Ready State: ${formatHandoffReadyStateLabel(inspectorHandoffTrace.ready_state)}`}</span>
                  {inspectorDownloadState?.label ? <span>{`Download Status: ${inspectorDownloadState.label}`}</span> : null}
                  {inspectorPairSwitchEvent ? (
                    <span>
                      {`${formatPairSwitchEventLabel(inspectorPairSwitchEvent.event, inspectorPairSwitchEvent.meta_json)} | ${formatRelativeEventLabel(
                        inspectorPairSwitchEvent.created_at
                      )}${formatDateTimeShort(inspectorPairSwitchEvent.created_at) ? ` | ${formatDateTimeShort(inspectorPairSwitchEvent.created_at)}` : ""}`}
                    </span>
                  ) : null}
                  {inspectorShotcard.primarySource.origin ? (
                    <span>{`Picked Source From: ${formatShotcardOrigin(inspectorShotcard.primarySource.origin)}`}</span>
                  ) : null}
                  {inspectorShotcard.primaryVisual.origin ? (
                    <span>{`Picked Visual From: ${formatShotcardOrigin(inspectorShotcard.primaryVisual.origin)}`}</span>
                  ) : null}
                  {inspectorHandoffTrace.latest_resolved_event ? (
                    <span>
                      {`${formatHandoffResolvedEventLabel(inspectorHandoffTrace.latest_resolved_event.event)} | ${formatRelativeEventLabel(
                        inspectorHandoffTrace.latest_resolved_event.created_at
                      )}${formatDateTimeShort(inspectorHandoffTrace.latest_resolved_event.created_at) ? ` | ${formatDateTimeShort(inspectorHandoffTrace.latest_resolved_event.created_at)}` : ""}`}
                    </span>
                  ) : null}
                  <div className="release-item-inspector-actions">
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={handleOpenInspectorSource}
                      disabled={!inspectorItem?.asset?.source_url}
                    >
                      Open Source
                    </button>
                    {String(inspectorHandoffTrace.ready_state ?? "").trim().toLowerCase() === "download_needed" ? (
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() =>
                          handleDownloadMedia?.(
                            inspectorItem?.asset?.source_url,
                            inspectorItem?.asset?.meta_json?.section_title ?? null
                          )
                        }
                        disabled={!inspectorItem?.asset?.source_url || ["queued", "running", "completed"].includes(String(inspectorDownloadState?.state ?? ""))}
                      >
                        Queue Download
                      </button>
                    ) : null}
                    {String(inspectorHandoffTrace.ready_state ?? "").trim().toLowerCase() === "capture_needed" ? (
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleOpenAssetScreenshotMode(inspectorItem?.asset)}
                        disabled={!inspectorItem?.asset?.source_url}
                      >
                        Screenshot
                      </button>
                    ) : null}
                  </div>
                </div>
                {inspectorItem.attachment?.assistant_trace_json?.script || inspectorItem.attachment?.assistant_trace_json?.visual ? (
                  <div className="release-item-inspector-block">
                    <strong>Trace</strong>
                    {inspectorItem.attachment?.assistant_trace_json?.script?.section_title ? (
                      <span>
                        {`Script from ${inspectorItem.attachment.assistant_trace_json.script.section_title}${
                          inspectorItem.attachment?.assistant_trace_json?.script?.title
                            ? ` В· ${inspectorItem.attachment.assistant_trace_json.script.title}`
                            : ""
                        }`}
                      </span>
                    ) : null}
                    {inspectorItem.attachment?.assistant_trace_json?.visual?.title ||
                    inspectorItem.attachment?.assistant_trace_json?.visual?.section_title ? (
                      <span>
                        {`Visual from ${
                          inspectorItem.attachment?.assistant_trace_json?.visual?.title ||
                          inspectorItem.attachment?.assistant_trace_json?.visual?.section_title
                        }${
                          inspectorItem.attachment?.assistant_trace_json?.visual?.recommendation?.matched_section_title
                            ? ` В· best for ${inspectorItem.attachment.assistant_trace_json.visual.recommendation.matched_section_title}`
                            : ""
                        }`}
                      </span>
                    ) : null}
                    {inspectorItem.attachment?.assistant_trace_json?.last_action ? (
                      <span>{`Last action: ${String(inspectorItem.attachment.assistant_trace_json.last_action).replace(/_/g, " ")}`}</span>
                    ) : null}
                  </div>
                ) : null}
                {inspectorDraftItem ? (
                  <div className="release-item-inspector-block">
                    <strong>Draft Pack</strong>
                    {inspectorDraftItem.suggested_script_note ? <span>{`Script: ${inspectorDraftItem.suggested_script_note}`}</span> : null}
                    {inspectorDraftItem.suggested_visual_note ? <span>{`Visual: ${inspectorDraftItem.suggested_visual_note}`}</span> : null}
                    {inspectorDraftItem.recommended_asset_title ? (
                      <span>{`Recommended asset: ${inspectorDraftItem.recommended_asset_title}`}</span>
                    ) : null}
                  </div>
                ) : null}
                {inspectorResearchBrief ? (
                  <div className="release-item-inspector-block">
                    <strong>Research Brief</strong>
                    <span>{inspectorResearchBrief.section_title || inspectorResearchBrief.segment_id}</span>
                    {(inspectorResearchSource || inspectorResearchVisual) && inspectorItem?.asset?.id && inspectorItem?.attachment?.id ? (
                      <div className="release-item-inspector-actions">
                        {inspectorResearchSource && inspectorResearchVisual ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchPromotePatch(inspectorResearchBrief, {
                                  sourceEntry: inspectorResearchSource,
                                  visualEntry: inspectorResearchVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Promote Main Pair
                          </button>
                        ) : null}
                        {inspectorResearchSource ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchSingleSidePatch(inspectorResearchBrief, "source", {
                                  sourceEntry: inspectorResearchSource,
                                  visualEntry: inspectorResearchVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Use Main Source
                          </button>
                        ) : null}
                        {inspectorResearchVisual ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchSingleSidePatch(inspectorResearchBrief, "visual", {
                                  sourceEntry: inspectorResearchSource,
                                  visualEntry: inspectorResearchVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Use Main Visual
                          </button>
                        ) : null}
                        {inspectorResearchBackupSource && inspectorResearchBackupVisual ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchPromotePatch(inspectorResearchBrief, {
                                  sourceEntry: inspectorResearchBackupSource,
                                  visualEntry: inspectorResearchBackupVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Promote Backup Pair
                          </button>
                        ) : null}
                        {inspectorResearchBackupSource ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchSingleSidePatch(inspectorResearchBrief, "source", {
                                  sourceEntry: inspectorResearchBackupSource,
                                  visualEntry: inspectorResearchVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Use Backup Source
                          </button>
                        ) : null}
                        {inspectorResearchBackupVisual ? (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() =>
                              handleUpdateReleaseAttachment(
                                inspectorItem.asset?.id,
                                inspectorItem.attachment?.id,
                                buildResearchSingleSidePatch(inspectorResearchBrief, "visual", {
                                  sourceEntry: inspectorResearchSource,
                                  visualEntry: inspectorResearchBackupVisual
                                })
                              )
                            }
                            disabled={releaseBusy}
                          >
                            Use Backup Visual
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {(Array.isArray(inspectorResearchBrief?.brief?.items) ? inspectorResearchBrief.brief.items : []).slice(0, 3).map((entry, index) => (
                      <span key={`inspector-research-${index}`}>{`${entry.label || "Research"}: ${entry.title || entry.url || entry.result_id || ""}${entry.role ? ` В· ${entry.role}` : ""}${entry.memory_hint ? ` В· ${entry.memory_hint}` : ""}`}</span>
                    ))}
                  </div>
                ) : null}
                {inspectorActivity.length > 0 ? (
                  <div className="release-item-inspector-block">
                    <strong>Recent Timeline</strong>
                    {inspectorActivity.map((entry) => (
                      <span key={`inspector-activity-${entry.id}`}>
                        {`${formatTimelineEventTitle(entry.event)} В· ${formatRelativeEventLabel(entry.created_at)}${
                          formatDateTimeShort(entry.created_at) ? ` В· ${formatDateTimeShort(entry.created_at)}` : ""
                        }`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="muted">Select an item to inspect it in detail.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="muted">No assets are attached to this release yet.</div>
      )}
    </div>
  );
}

