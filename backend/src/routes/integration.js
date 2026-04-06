import path from "node:path";
import { loadIndexedArrayWithFallback, loadIndexedObjectWithFallback } from "../services/indexed-fallback-loaders.js";
import { extractSourceScopeKey } from "../services/source-identity.js";

function sanitizeExportFileNamePart(value, fallback = "release") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 80) : fallback;
}

function buildReleaseContentDisposition(fileName, format) {
  const ext = String(format ?? "").toLowerCase() === "json" ? ".json" : ".md";
  const base = sanitizeExportFileNamePart(fileName, "release");
  const utfName = `${base}${ext}`;
  const fallback = utfName.replace(/[^\x20-\x7E]+/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(utfName)}`;
}

function extractDomainFromValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  try {
    return String(new URL(normalized).hostname ?? "").toLowerCase();
  } catch {
    return "";
  }
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

function resolveHandoffReadyState(item = {}) {
  return String(item?.effective_ready_state ?? item?.ready_state ?? "")
    .trim()
    .toLowerCase();
}

function normalizeRecommendationText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, " ")
    .trim();
}

function extractRecommendationTokens(...values) {
  const tokens = new Set();
  values.flat(Infinity).forEach((value) => {
    const normalized = normalizeRecommendationText(value);
    if (!normalized) return;
    normalized.split(/\s+/).forEach((token) => {
      if (token.length < 3) return;
      tokens.add(token);
    });
  });
  return tokens;
}

function countTokenOverlap(referenceTokens, ...values) {
  if (!(referenceTokens instanceof Set) || referenceTokens.size === 0) return 0;
  const candidateTokens = extractRecommendationTokens(...values);
  let matches = 0;
  candidateTokens.forEach((token) => {
    if (referenceTokens.has(token)) matches += 1;
  });
  return matches;
}

function summarizeRecommendationReason(reasons = []) {
  return reasons
    .slice(0, 3)
    .map((item) => item.label)
    .join(", ");
}

function formatRecommendationReasonLabel(reason = {}) {
  const key = String(reason?.key ?? "").trim().toLowerCase();
  if (!key) return String(reason?.label ?? "").trim();
  if (key === "research_domain") return "Research Domain";
  if (key === "research_visual") return "Research Visual";
  if (key === "research_source") return "Research Source";
  if (key === "release_outcome_domain") return "Worked in Releases";
  if (key === "release_outcome_kind") return "Successful Asset Type";
  if (key === "same_section") return "Same Section";
  if (key === "same_domain") return "Same Domain";
  if (key === "visual_candidate") return "Visual Candidate";
  return String(reason?.label ?? key).trim();
}

function findResearchBriefItemByRole(brief = null, roles = [], keys = []) {
  const items = Array.isArray(brief?.brief?.items)
    ? brief.brief.items
    : Array.isArray(brief?.items)
      ? brief.items
      : [];
  const normalizedRoles = new Set(roles.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const normalizedKeys = new Set(keys.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const exact = items.find((item) => {
    const role = String(item?.role ?? "").trim().toLowerCase();
    const key = String(item?.key ?? "").trim().toLowerCase();
    return (normalizedRoles.size > 0 && normalizedRoles.has(role)) || (normalizedKeys.size > 0 && normalizedKeys.has(key));
  });
  return exact ?? items[0] ?? null;
}

function findResearchBriefBackupItem(brief = null, primaryEntry = null, kind = "source") {
  const items = Array.isArray(brief?.brief?.items)
    ? brief.brief.items
    : Array.isArray(brief?.items)
      ? brief.items
      : [];
  if (items.length === 0) return { entry: null, picked_from: "" };
  const normalizedKind = String(kind ?? "").trim().toLowerCase();
  const primaryResultId = String(primaryEntry?.result_id ?? "").trim();
  const primaryKey = String(primaryEntry?.key ?? "").trim().toLowerCase();
  const explicit =
    normalizedKind === "visual"
      ? findResearchBriefItemByRole(brief, ["visual_candidate"], ["backup_visual"])
      : findResearchBriefItemByRole(brief, ["backup_source", "reference", "main_source"], ["backup_source"]);
  const explicitResultId = String(explicit?.result_id ?? "").trim();
  const explicitKey = String(explicit?.key ?? "").trim().toLowerCase();
  if (
    explicit &&
    ((explicitResultId && explicitResultId !== primaryResultId) || (explicitKey && explicitKey !== primaryKey))
  ) {
    return {
      entry: explicit,
      picked_from: normalizedKind === "visual" ? "research_backup_visual" : "research_backup_source"
    };
  }
  const fallbackEntry =
    items.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const entryResultId = String(entry?.result_id ?? "").trim();
      const entryKey = String(entry?.key ?? "").trim().toLowerCase();
      if ((entryResultId && entryResultId === primaryResultId) || (entryKey && entryKey === primaryKey)) return false;
      const role = String(entry?.role ?? "").trim().toLowerCase();
      if (normalizedKind === "visual") {
        return role === "visual_candidate";
      }
      return ["main_source", "backup_source", "reference"].includes(role);
    }) ?? null;
  return {
    entry: fallbackEntry,
    picked_from:
      normalizedKind === "visual"
        ? (fallbackEntry ? "research_fallback_visual" : "")
        : (fallbackEntry ? "research_fallback_source" : "")
  };
}

function findResearchBriefForReleaseItem(researchBriefs = null, releaseItem = null) {
  const briefItems = Array.isArray(researchBriefs?.items) ? researchBriefs.items : [];
  if (briefItems.length === 0 || !releaseItem) return null;
  const asset = releaseItem?.asset ?? {};
  const meta = asset?.meta_json ?? {};
  const segmentId = String(meta?.segment_id ?? "").trim();
  const sectionTitle = String(meta?.section_title ?? "").trim().toLowerCase();
  if (segmentId) {
    const bySegment = briefItems.find((item) => String(item?.segment_id ?? "").trim() === segmentId);
    if (bySegment) return bySegment;
  }
  if (sectionTitle) {
    const bySection = briefItems.find((item) => String(item?.section_title ?? "").trim().toLowerCase() === sectionTitle);
    if (bySection) return bySection;
  }
  return briefItems.length === 1 ? briefItems[0] : null;
}

function buildReleaseOutcomeSignals(memory = {}) {
  const domains = memory?.domains && typeof memory.domains === "object" ? memory.domains : {};
  const kinds = memory?.kinds && typeof memory.kinds === "object" ? memory.kinds : {};
  const roles = memory?.roles && typeof memory.roles === "object" ? memory.roles : {};
  return { domains, kinds, roles };
}

function buildSourceMemorySignals(memory = {}) {
  const domains = memory?.domains && typeof memory.domains === "object" ? memory.domains : {};
  return { domains };
}

function scoreReleaseOutcomeCandidate(asset = {}, releaseOutcomeSignals = {}) {
  const domain = String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim().toLowerCase();
  const kind = String(asset?.kind ?? "").trim().toLowerCase();
  const domainStats = domain ? releaseOutcomeSignals?.domains?.[domain] ?? null : null;
  const kindStats = kind ? releaseOutcomeSignals?.kinds?.[kind] ?? null : null;
  const bonus = (Math.min(18, Number(domainStats?.used_count ?? 0) * 3)) + (Math.min(14, Number(kindStats?.used_count ?? 0) * 2));
  const reasons = [];
  if (domainStats?.used_count) reasons.push({ key: "release_outcome_domain", label: `worked in releases: ${domain}` });
  if (kindStats?.used_count) reasons.push({ key: "release_outcome_kind", label: `successful kind: ${kind}` });
  return {
    bonus,
    reasons
  };
}

function scoreSourceMemoryCandidate(asset = {}, sourceMemorySignals = {}) {
  const domain = String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim().toLowerCase();
  const sourceScopeKey = extractSourceScopeKey({
    domain,
    url: asset?.source_url,
    uploader: asset?.meta_json?.uploader,
    uploaderUrl: asset?.meta_json?.uploader_url
  });
  const hasScopedSource = sourceScopeKey && sourceScopeKey !== domain;
  const domainStats = hasScopedSource
    ? (sourceMemorySignals?.domains?.[sourceScopeKey] ?? null)
    : (domain ? sourceMemorySignals?.domains?.[domain] ?? null : null);
  const helpfulCount = Number(domainStats?.helpful_count ?? 0) || 0;
  const usedCount = Number(domainStats?.used_count ?? 0) || 0;
  const bonus = Math.min(24, helpfulCount * 8) + Math.min(12, usedCount * 2);
  const reasons = [];
  const memoryLabel = sourceScopeKey || domain;
  if (helpfulCount > 0) {
    reasons.push({
      key: "source_memory_helpful",
      label: helpfulCount > 1 ? `helpful before x${helpfulCount}: ${memoryLabel}` : `helpful before: ${memoryLabel}`
    });
  }
  if (usedCount > 0) {
    reasons.push({
      key: "source_memory_used",
      label: usedCount > 1 ? `used before x${usedCount}: ${memoryLabel}` : `used before: ${memoryLabel}`
    });
  }
  return {
    bonus,
    reasons,
    helpful_count: helpfulCount,
    used_count: usedCount
  };
}

async function recordReleaseOutcomeSafe(recordReleaseOutcome, payload) {
  if (typeof recordReleaseOutcome !== "function") return;
  try {
    await recordReleaseOutcome(payload);
  } catch {
    // Ignore memory write failures during assistant flows.
  }
}

function extractResearchBriefSignals(researchBriefs = null) {
  const entries = Array.isArray(researchBriefs?.items) ? researchBriefs.items : [];
  const allTokens = new Set();
  const sourceTokens = new Set();
  const visualTokens = new Set();
  const domains = new Set();
  const sourceDomains = new Set();
  const visualDomains = new Set();

  entries.forEach((entry) => {
    const sectionTitle = String(entry?.section_title ?? "").trim();
    extractRecommendationTokens(sectionTitle, entry?.text_quote).forEach((token) => allTokens.add(token));
    const items = Array.isArray(entry?.brief?.items) ? entry.brief.items : [];
    items.forEach((item) => {
      const role = String(item?.role ?? "").trim().toLowerCase();
      const domain = String(item?.domain ?? "").trim().toLowerCase();
      const tokens = extractRecommendationTokens(item?.label, item?.title, item?.reason, sectionTitle);
      tokens.forEach((token) => allTokens.add(token));
      if (domain) domains.add(domain);
      if (role === "visual_candidate") {
        tokens.forEach((token) => visualTokens.add(token));
        if (domain) visualDomains.add(domain);
      } else {
        tokens.forEach((token) => sourceTokens.add(token));
        if (domain) sourceDomains.add(domain);
      }
    });
  });

  return {
    allTokens,
    sourceTokens,
    visualTokens,
    domains,
    sourceDomains,
    visualDomains
  };
}

function findBestResearchBriefMatchForAsset(asset = {}, researchBriefs = null) {
  const entries = Array.isArray(researchBriefs?.items) ? researchBriefs.items : [];
  if (entries.length === 0) return null;
  const assetSectionTitle = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
  const assetSegmentId = String(asset?.meta_json?.segment_id ?? "").trim();
  if (assetSegmentId) {
    const exactSegment = entries.find((item) => String(item?.segment_id ?? "").trim() === assetSegmentId);
    if (exactSegment) {
      return {
        segment_id: String(exactSegment?.segment_id ?? "").trim(),
        section_title: String(exactSegment?.section_title ?? "").trim(),
        overlap: 100,
        match_type: "segment"
      };
    }
  }
  if (assetSectionTitle) {
    const exactSection = entries.find((item) => String(item?.section_title ?? "").trim().toLowerCase() === assetSectionTitle);
    if (exactSection) {
      return {
        segment_id: String(exactSection?.segment_id ?? "").trim(),
        section_title: String(exactSection?.section_title ?? "").trim(),
        overlap: 100,
        match_type: "section"
      };
    }
  }

  let best = null;
  entries.forEach((entry) => {
    const overlap = countTokenOverlap(
      extractRecommendationTokens(entry?.section_title, entry?.text_quote, ...(Array.isArray(entry?.brief?.items) ? entry.brief.items.map((item) => item?.title) : [])),
      asset?.title,
      asset?.description,
      asset?.meta_json?.section_title,
      asset?.source_domain,
      asset?.author
    );
    if (overlap <= 0) return;
    if (!best || overlap > best.overlap) {
      best = {
        segment_id: String(entry?.segment_id ?? "").trim(),
        section_title: String(entry?.section_title ?? "").trim(),
        overlap,
        match_type: "token"
      };
    }
  });
  return best;
}

function buildDraftScriptSuggestion(asset = {}, attachment = {}, researchBrief = null) {
  const title = String(asset?.title || asset?.file_name || asset?.id || "asset").trim();
  const sectionTitle = String(asset?.meta_json?.section_title || "").trim();
  const domain = String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim();
  const itemStatus = String(attachment?.item_status || "planned").trim();
  const sourceBrief = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
  const sourceTitle = String(sourceBrief?.title ?? "").trim();
  const sourceDomain = String(sourceBrief?.domain ?? "").trim();
  const parts = [];
  parts.push(sectionTitle ? `Lead with ${sectionTitle}` : sourceTitle ? `Lead with ${sourceTitle}` : `Lead with ${title}`);
  if (sourceTitle && sourceTitle.toLowerCase() !== String(sectionTitle || title).trim().toLowerCase()) {
    parts.push(`source cue ${sourceTitle}`);
  }
  if (sourceDomain || domain) parts.push(`check source ${sourceDomain || domain}`);
  if (itemStatus && itemStatus !== "planned") parts.push(`status ${itemStatus}`);
  return `${parts.join(", ")}.`;
}

function buildDraftVisualSuggestion(asset = {}, recommendation = null, researchBrief = null) {
  const assetKind = String(asset?.kind ?? "").trim().toLowerCase();
  const title = String(asset?.title || asset?.file_name || asset?.id || "asset").trim();
  const visualBrief = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
  const visualTitle = String(visualBrief?.title ?? "").trim();
  if (assetKind === "screenshot") {
    return "Use the captured screenshot as the primary visual.";
  }
  if (assetKind === "telegram_media" || assetKind === "downloaded_media") {
    return `Use native media from ${title} as the primary visual.`;
  }
  if (assetKind === "link") {
    if (recommendation?.asset?.title || recommendation?.asset?.id) {
      return `Take screenshot from source link or attach ${recommendation.asset.title || recommendation.asset.id}.`;
    }
    if (visualTitle) {
      return `Use ${visualTitle} as the visual target or capture a clean frame from the source link.`;
    }
    return "Take screenshot from source link or prepare a clean preview frame.";
  }
  if (recommendation?.asset?.title || recommendation?.asset?.id) {
    return `Attach ${recommendation.asset.title || recommendation.asset.id} as a supporting visual.`;
  }
  if (visualTitle) {
    return `Use ${visualTitle} as a supporting visual reference.`;
  }
  return `Find or capture supporting visual for ${title}.`;
}

function buildResearchTraceMeta(researchBrief = null) {
  if (!researchBrief) return null;
  const sourceBrief = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
  const visualBrief = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
  return {
    segment_id: String(researchBrief?.segment_id ?? "").trim(),
    section_title: String(researchBrief?.section_title ?? "").trim(),
    best_source_title: String(sourceBrief?.title ?? "").trim(),
    best_source_domain: String(sourceBrief?.domain ?? "").trim(),
    best_visual_title: String(visualBrief?.title ?? "").trim(),
    best_visual_domain: String(visualBrief?.domain ?? "").trim()
  };
}

function buildRecommendationTraceMeta(recommendation = null) {
  const asset = recommendation?.asset ?? {};
  if (!asset?.id && !asset?.title && !asset?.source_url) return null;
  return {
    asset_id: String(asset?.id ?? "").trim(),
    title: String(asset?.title || asset?.file_name || asset?.id || "").trim(),
    kind: String(asset?.kind ?? "").trim(),
    source_domain: String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim(),
    matched_segment_id: String(recommendation?.matched_segment_id ?? "").trim(),
    matched_section_title: String(recommendation?.matched_section_title ?? "").trim(),
    matched_by: String(recommendation?.matched_by ?? "").trim(),
    score: Number(recommendation?.score ?? 0),
    bucket: String(recommendation?.bucket ?? "").trim()
  };
}

function buildAssistantTracePatch({
  existingTrace = null,
  researchBrief = null,
  recommendation = null,
  scriptNote = "",
  visualNote = "",
  action = "",
  includeScript = false,
  includeVisual = false
} = {}) {
  const nextTrace =
    existingTrace && typeof existingTrace === "object" && !Array.isArray(existingTrace)
      ? { ...existingTrace }
      : {};
  const research = buildResearchTraceMeta(researchBrief);
  if (research && Object.values(research).some(Boolean)) {
    nextTrace.research = research;
  }
  if (includeScript) {
    const sourceBrief = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
    nextTrace.script = {
      source_type: sourceBrief ? "research_brief" : "assistant",
      note: String(scriptNote ?? "").trim(),
      segment_id: String(researchBrief?.segment_id ?? "").trim(),
      section_title: String(researchBrief?.section_title ?? "").trim(),
      title: String(sourceBrief?.title ?? "").trim(),
      domain: String(sourceBrief?.domain ?? "").trim()
    };
  }
  if (includeVisual) {
    const visualBrief = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
    const recommendationMeta = buildRecommendationTraceMeta(recommendation);
    nextTrace.visual = {
      source_type: recommendationMeta ? "recommendation" : visualBrief ? "research_brief" : "assistant",
      note: String(visualNote ?? "").trim(),
      segment_id: String(researchBrief?.segment_id ?? "").trim(),
      section_title: String(researchBrief?.section_title ?? "").trim(),
      title: String(recommendationMeta?.title || visualBrief?.title || "").trim(),
      domain: String(recommendationMeta?.source_domain || visualBrief?.domain || "").trim(),
      recommendation: recommendationMeta
    };
  }
  nextTrace.last_action = String(action ?? "").trim();
  nextTrace.updated_at = new Date().toISOString();
  return nextTrace;
}

function buildManualOverrideTracePatch(existingAttachment = null, incomingPatch = {}, action = "manual_edit") {
  const existingTrace =
    existingAttachment?.assistant_trace_json &&
    typeof existingAttachment.assistant_trace_json === "object" &&
    !Array.isArray(existingAttachment.assistant_trace_json)
      ? { ...existingAttachment.assistant_trace_json }
      : {};
  const now = new Date().toISOString();
  const nextTrace = { ...existingTrace };
  const manualOverride =
    existingTrace?.manual_override &&
    typeof existingTrace.manual_override === "object" &&
    !Array.isArray(existingTrace.manual_override)
      ? { ...existingTrace.manual_override }
      : {};

  const hasScriptPatch = Object.prototype.hasOwnProperty.call(incomingPatch, "script_note");
  const hasVisualPatch = Object.prototype.hasOwnProperty.call(incomingPatch, "visual_note");
  const nextScriptNote = hasScriptPatch ? String(incomingPatch?.script_note ?? "").trim() : String(existingAttachment?.script_note ?? "").trim();
  const nextVisualNote = hasVisualPatch ? String(incomingPatch?.visual_note ?? "").trim() : String(existingAttachment?.visual_note ?? "").trim();
  const currentScriptNote = String(existingAttachment?.script_note ?? "").trim();
  const currentVisualNote = String(existingAttachment?.visual_note ?? "").trim();

  if (hasScriptPatch && nextScriptNote !== currentScriptNote) {
    manualOverride.script = true;
    if (nextTrace.script && typeof nextTrace.script === "object" && !Array.isArray(nextTrace.script)) {
      nextTrace.script = {
        ...nextTrace.script,
        note: nextScriptNote,
        overridden: true,
        overridden_at: now
      };
    } else {
      nextTrace.script = {
        source_type: "manual_override",
        note: nextScriptNote,
        overridden: true,
        overridden_at: now
      };
    }
  }
  if (hasVisualPatch && nextVisualNote !== currentVisualNote) {
    manualOverride.visual = true;
    if (nextTrace.visual && typeof nextTrace.visual === "object" && !Array.isArray(nextTrace.visual)) {
      nextTrace.visual = {
        ...nextTrace.visual,
        note: nextVisualNote,
        overridden: true,
        overridden_at: now
      };
    } else {
      nextTrace.visual = {
        source_type: "manual_override",
        note: nextVisualNote,
        overridden: true,
        overridden_at: now
      };
    }
  }

  if (manualOverride.script || manualOverride.visual) {
    nextTrace.manual_override = {
      ...manualOverride,
      last_action: String(action ?? "manual_edit").trim(),
      updated_at: now
    };
    nextTrace.last_action = String(action ?? "manual_edit").trim();
    nextTrace.updated_at = now;
    return nextTrace;
  }
  return existingTrace;
}

function buildManualOverrideActivityFields(existingAttachment = null, incomingPatch = {}) {
  const changed = [];
  if (
    Object.prototype.hasOwnProperty.call(incomingPatch, "script_note") &&
    String(incomingPatch?.script_note ?? "").trim() !== String(existingAttachment?.script_note ?? "").trim()
  ) {
    changed.push("script");
  }
  if (
    Object.prototype.hasOwnProperty.call(incomingPatch, "visual_note") &&
    String(incomingPatch?.visual_note ?? "").trim() !== String(existingAttachment?.visual_note ?? "").trim()
  ) {
    changed.push("visual");
  }
  return changed;
}

function normalizeResearchPickItem(entry = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const title = String(entry?.title || entry?.label || entry?.url || entry?.result_id || "").trim();
  if (!title && !String(entry?.domain ?? "").trim()) return null;
  return {
    key: String(entry?.key ?? "").trim(),
    label: String(entry?.label ?? "").trim(),
    title,
    domain: String(entry?.domain ?? "").trim(),
    role: String(entry?.role ?? "reference").trim() || "reference",
    reason: String(entry?.reason ?? "").trim(),
    score: Number(entry?.score ?? 0),
    url: String(entry?.url ?? "").trim(),
    result_id: String(entry?.result_id ?? "").trim()
  };
}

function buildResearchPickBrief(researchContext = null) {
  if (!researchContext || typeof researchContext !== "object" || Array.isArray(researchContext)) return null;
  const sourceItem = normalizeResearchPickItem(researchContext?.source_item);
  const visualItem = normalizeResearchPickItem(researchContext?.visual_item);
  const items = [sourceItem, visualItem].filter(Boolean);
  if (items.length === 0) return null;
  return {
    segment_id: String(researchContext?.segment_id ?? "").trim(),
    section_title: String(researchContext?.section_title ?? "").trim(),
    brief: {
      summary: String(researchContext?.summary ?? "").trim(),
      items
    }
  };
}

function clearManualOverrideSignals(trace = null, { script = false, visual = false } = {}) {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return trace;
  const nextTrace = { ...trace };
  const manualOverride =
    nextTrace?.manual_override && typeof nextTrace.manual_override === "object" && !Array.isArray(nextTrace.manual_override)
      ? { ...nextTrace.manual_override }
      : null;
  if (!manualOverride) return nextTrace;
  if (script) delete manualOverride.script;
  if (visual) delete manualOverride.visual;
  if (Object.keys(manualOverride).length === 0 || (!manualOverride.script && !manualOverride.visual)) {
    delete nextTrace.manual_override;
  } else {
    nextTrace.manual_override = manualOverride;
  }
  return nextTrace;
}

function buildResearchBriefFallback(run = {}, segment = null) {
  const notes = Array.isArray(run?.summary?.notes) ? run.summary.notes.filter(Boolean).slice(0, 3) : [];
  return {
    summary: notes.join(" | "),
    items: notes.map((item, index) => ({
      key: `fallback_${index + 1}`,
      label: segment?.section_title ? String(segment.section_title) : "Research",
      title: String(item),
      domain: "",
      score: 0,
      role: "reference",
      reason: String(item),
      reason_tags: []
    }))
  };
}

function normalizeResearchBundleTrace(bundleTrace = null) {
  if (!bundleTrace || typeof bundleTrace !== "object" || Array.isArray(bundleTrace)) return null;
  const normalizePick = (pick) => {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) return null;
    const normalized = {
      result_id: String(pick?.result_id ?? "").trim(),
      title: String(pick?.title ?? "").trim(),
      domain: String(pick?.domain ?? "").trim(),
      url: String(pick?.url ?? "").trim(),
      role: String(pick?.role ?? "").trim(),
      asset_id: String(pick?.asset_id ?? "").trim(),
      attachment_id: String(pick?.attachment_id ?? "").trim()
    };
    return normalized.result_id || normalized.title || normalized.url ? normalized : null;
  };
  const normalized = {
    run_id: String(bundleTrace?.run_id ?? "").trim(),
    source_result_id: String(bundleTrace?.source_result_id ?? "").trim(),
    visual_result_id: String(bundleTrace?.visual_result_id ?? "").trim(),
    applied_at: String(bundleTrace?.applied_at ?? "").trim(),
    source: normalizePick(bundleTrace?.source),
    visual: normalizePick(bundleTrace?.visual)
  };
  return normalized.run_id || normalized.source || normalized.visual ? normalized : null;
}

function normalizeReleaseResearchRunPins(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([segmentId, runId]) => [String(segmentId ?? "").trim(), String(runId ?? "").trim()])
      .filter(([segmentId, runId]) => Boolean(segmentId) && Boolean(runId))
  );
}

function mergeResearchBriefWithBundleTrace(brief = null, bundleTrace = null) {
  const normalizedBundle = normalizeResearchBundleTrace(bundleTrace);
  if (!normalizedBundle) return brief;
  const existingBrief = brief && typeof brief === "object" && !Array.isArray(brief) ? brief : {};
  const existingItems = Array.isArray(existingBrief.items) ? existingBrief.items : [];
  const filteredItems = existingItems.filter((item) => {
    const key = String(item?.key ?? "").trim().toLowerCase();
    return key !== "source" && key !== "visual" && key !== "picked_source" && key !== "picked_visual";
  });
  const pairItems = [];
  if (normalizedBundle.source) {
    pairItems.push({
      key: "source",
      label: "Picked Source",
      title: normalizedBundle.source.title || normalizedBundle.source.url || "Picked source",
      domain: normalizedBundle.source.domain,
      score: 1,
      role: normalizedBundle.source.role || "main_source",
      result_id: normalizedBundle.source.result_id,
      reason: "Promoted from deep research bundle.",
      reason_tags: ["bundle_trace", "picked_source"]
    });
  }
  if (normalizedBundle.visual) {
    pairItems.push({
      key: "visual",
      label: "Picked Visual",
      title: normalizedBundle.visual.title || normalizedBundle.visual.url || "Picked visual",
      domain: normalizedBundle.visual.domain,
      score: 1,
      role: normalizedBundle.visual.role || "visual_candidate",
      result_id: normalizedBundle.visual.result_id,
      reason: "Promoted from deep research bundle.",
      reason_tags: ["bundle_trace", "picked_visual"]
    });
  }
  return {
    ...existingBrief,
    items: [...pairItems, ...filteredItems],
    bundle_trace: normalizedBundle
  };
}

function formatReleaseResearchBriefItemLabel(item = {}) {
  const key = String(item?.key ?? "").trim().toLowerCase();
  const role = String(item?.role ?? "").trim().toLowerCase();
  if (key === "download") return "Best Download";
  if (key === "source" || role === "main_source") return "Main Source";
  if (key === "visual" || (role === "visual_candidate" && key !== "backup_visual")) return "Main Visual";
  if (key === "backup_source" || role === "backup_source") return "Backup Source";
  if (key === "backup_visual") return "Backup Visual";
  return String(item?.label ?? "").trim() || "Research";
}

function getReleaseResearchComparableLabel(item = {}) {
  return String(item?.title || item?.label || item?.domain || item?.url || item?.result_id || "").trim();
}

function deriveReleaseResearchCurrentPair(bundleTrace = null, mainSource = null, mainVisual = null, backupSource = null, backupVisual = null) {
  const normalizedBundle = normalizeResearchBundleTrace(bundleTrace);
  const currentSourceLabel = String(normalizedBundle?.source?.title || normalizedBundle?.source?.domain || "").trim();
  const currentVisualLabel = String(normalizedBundle?.visual?.title || normalizedBundle?.visual?.domain || "").trim();
  if (!currentSourceLabel && !currentVisualLabel) return null;
  const mainSourceLabel = getReleaseResearchComparableLabel(mainSource);
  const mainVisualLabel = getReleaseResearchComparableLabel(mainVisual);
  const backupSourceLabel = getReleaseResearchComparableLabel(backupSource);
  const backupVisualLabel = getReleaseResearchComparableLabel(backupVisual);
  const sourceMatchesMain =
    currentSourceLabel &&
    mainSourceLabel &&
    currentSourceLabel.toLowerCase() === mainSourceLabel.toLowerCase();
  const sourceMatchesBackup =
    currentSourceLabel &&
    backupSourceLabel &&
    currentSourceLabel.toLowerCase() === backupSourceLabel.toLowerCase();
  const visualMatchesMain =
    currentVisualLabel &&
    mainVisualLabel &&
    currentVisualLabel.toLowerCase() === mainVisualLabel.toLowerCase();
  const visualMatchesBackup =
    currentVisualLabel &&
    backupVisualLabel &&
    currentVisualLabel.toLowerCase() === backupVisualLabel.toLowerCase();
  const label =
    sourceMatchesMain && visualMatchesMain
      ? "Main Pair"
      : sourceMatchesBackup && visualMatchesBackup
        ? "Backup Pair"
        : (sourceMatchesMain || sourceMatchesBackup || visualMatchesMain || visualMatchesBackup)
          ? "Mixed Pair"
          : "Custom Pair";
  const hint =
    label === "Main Pair"
      ? "Aligned with main picks"
      : label === "Backup Pair"
        ? "Using backup picks"
        : label === "Mixed Pair"
          ? "Mixed main + backup"
          : "Custom research mix";
  return {
    label,
    hint,
    source: currentSourceLabel,
    visual: currentVisualLabel
  };
}

function buildReleaseResearchPairSummary(brief = null, bundleTrace = null) {
  const items = Array.isArray(brief?.items) ? brief.items : [];
  const mainSource = items.find((item) => String(item?.key ?? "").trim().toLowerCase() === "source") ?? null;
  const mainVisual = items.find((item) => String(item?.key ?? "").trim().toLowerCase() === "visual") ?? null;
  const backupSource = items.find((item) => String(item?.key ?? "").trim().toLowerCase() === "backup_source") ?? null;
  const backupVisual = items.find((item) => String(item?.key ?? "").trim().toLowerCase() === "backup_visual") ?? null;
  const currentPair = deriveReleaseResearchCurrentPair(bundleTrace, mainSource, mainVisual, backupSource, backupVisual);
  const summarizeEntry = (entry = null) =>
    entry
      ? {
          label: formatReleaseResearchBriefItemLabel(entry),
          title: String(entry?.title || entry?.url || entry?.result_id || "").trim(),
          domain: String(entry?.domain ?? "").trim(),
          result_id: String(entry?.result_id ?? "").trim()
        }
      : null;
  return {
    current_pair: currentPair
      ? {
          label: currentPair.label,
          hint: currentPair.hint,
          source: currentPair.source,
          visual: currentPair.visual
        }
      : null,
    main_source: summarizeEntry(mainSource),
    main_visual: summarizeEntry(mainVisual),
    backup_source: summarizeEntry(backupSource),
    backup_visual: summarizeEntry(backupVisual)
  };
}

function detectBriefSelectionOrigin(researchBrief = null, entry = null, fallbackOrigin = "") {
  const normalizedFallback = String(fallbackOrigin ?? "").trim();
  const normalizedBundle = normalizeResearchBundleTrace(researchBrief?.brief?.bundle_trace ?? researchBrief?.bundle_trace);
  const entryResultId = String(entry?.result_id ?? "").trim();
  const entryKey = String(entry?.key ?? "").trim().toLowerCase();
  if (normalizedBundle && entryResultId) {
    if (normalizedBundle?.source?.result_id === entryResultId || normalizedBundle?.source_result_id === entryResultId) {
      return "research_bundle";
    }
    if (normalizedBundle?.visual?.result_id === entryResultId || normalizedBundle?.visual_result_id === entryResultId) {
      return "research_bundle";
    }
  }
  if (entryKey === "source" || entryKey === "visual") {
    const tags = Array.isArray(entry?.reason_tags) ? entry.reason_tags.map((item) => String(item ?? "").trim().toLowerCase()) : [];
    if (tags.includes("bundle_trace")) return "research_bundle";
  }
  return normalizedFallback || (entry ? "research_brief" : "");
}

function deriveAssistantConfidenceSignals(attachment = {}) {
  const trace = attachment?.assistant_trace_json ?? {};
  const signals = [];
  const scriptNote = String(attachment?.script_note ?? "").trim();
  const visualNote = String(attachment?.visual_note ?? "").trim();
  const tracedScriptNote = String(trace?.script?.note ?? "").trim();
  const tracedVisualNote = String(trace?.visual?.note ?? "").trim();

  if (
    String(trace?.research?.section_title ?? "").trim() ||
    String(trace?.script?.section_title ?? "").trim() ||
    String(trace?.visual?.section_title ?? "").trim()
  ) {
    signals.push("Research-backed");
  }
  if (
    String(trace?.visual?.recommendation?.asset_id ?? "").trim() ||
    String(trace?.visual?.recommendation?.title ?? "").trim()
  ) {
    signals.push("Recommendation-backed");
  }
  if (String(trace?.last_action ?? "").trim()) {
    signals.push("Assistant-updated");
  }
  if (
    Boolean(trace?.manual_override?.script) ||
    Boolean(trace?.manual_override?.visual) ||
    (scriptNote && tracedScriptNote && scriptNote !== tracedScriptNote) ||
    (visualNote && tracedVisualNote && visualNote !== tracedVisualNote)
  ) {
    signals.push("Manual override");
  }

  return Array.from(new Set(signals));
}

function deriveShotcardForReleaseItem(item = {}, researchBriefs = null) {
  const attachment = item?.attachment ?? {};
  const trace = attachment?.assistant_trace_json ?? {};
  const researchBrief = findResearchBriefForReleaseItem(researchBriefs, item);
  const sourceEntry = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
  const visualEntry = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
  const fallbackVisualMeta = findResearchBriefBackupItem(researchBrief, visualEntry, "visual");
  const fallbackSourceMeta = findResearchBriefBackupItem(researchBrief, sourceEntry, "source");
  const fallbackVisual = fallbackVisualMeta.entry;
  const fallbackSource = fallbackSourceMeta.entry;
  const fallbackPickedFrom = fallbackVisual ? fallbackVisualMeta.picked_from : fallbackSourceMeta.picked_from;
  const pickedSourceOrigin = detectBriefSelectionOrigin(
    researchBrief,
    sourceEntry,
    String(trace?.script?.source_type || (sourceEntry ? "research_brief" : "")).trim()
  );
  const pickedVisualOrigin = String(trace?.visual?.recommendation?.asset_id ?? "").trim()
    ? "assistant_recommendation"
    : detectBriefSelectionOrigin(
        researchBrief,
        visualEntry,
        String(trace?.visual?.source_type || (visualEntry ? "research_brief" : "")).trim()
      );
  return {
    picked_source: {
      title: String(trace?.script?.title || sourceEntry?.title || sourceEntry?.label || "").trim(),
      domain: String(trace?.script?.domain || sourceEntry?.domain || "").trim(),
      origin: pickedSourceOrigin,
      picked_from: pickedSourceOrigin
    },
    picked_visual: {
      title: String(trace?.visual?.recommendation?.title || trace?.visual?.title || visualEntry?.title || visualEntry?.label || "").trim(),
      domain: String(trace?.visual?.recommendation?.source_domain || trace?.visual?.domain || visualEntry?.domain || "").trim(),
      origin: pickedVisualOrigin,
      picked_from: pickedVisualOrigin
    },
    fallback: {
      title: String(fallbackVisual?.title || fallbackVisual?.label || fallbackSource?.title || fallbackSource?.label || "").trim(),
      domain: String(fallbackVisual?.domain || fallbackSource?.domain || "").trim(),
      origin: fallbackPickedFrom,
      picked_from: fallbackPickedFrom
    }
  };
}

function buildReleaseShotlist(release = null, researchBriefs = null) {
  const items = Array.isArray(release?.assets) ? release.assets : [];
  return items.map((item, index) => {
    const shotcard = deriveShotcardForReleaseItem(item, researchBriefs);
    const attachmentRole = String(item?.attachment?.role ?? "").trim();
    const assetKind = String(item?.asset?.kind ?? "").trim().toLowerCase();
    const sectionTitle = String(item?.asset?.meta_json?.section_title ?? "").trim();
    const scriptNote = String(item?.attachment?.script_note ?? "").trim();
    const usageRole =
      attachmentRole ||
      (assetKind === "screenshot"
        ? "screenshot"
        : assetKind === "telegram_media" || assetKind === "downloaded_media"
          ? "primary_visual"
          : shotcard?.picked_visual?.title
            ? "visual_reference"
            : "reference");
    const onScreenCue =
      scriptNote ||
      (sectionTitle
        ? `Open with ${sectionTitle}`
        : shotcard?.picked_source?.title
          ? `Open with ${shotcard.picked_source.title}`
          : "");
    const backupNote = shotcard?.fallback?.title
      ? `Fallback to ${shotcard.fallback.title}${shotcard?.fallback?.domain ? ` (${shotcard.fallback.domain})` : ""}.`
      : shotcard?.picked_visual?.title
        ? `If the primary visual does not hold, reuse ${shotcard.picked_visual.title}.`
        : "";
    return {
      index: index + 1,
      attachment_id: String(item?.attachment?.id ?? "").trim(),
      asset_id: String(item?.asset?.id ?? "").trim(),
      title: String(item?.asset?.title || item?.asset?.file_name || item?.asset?.id || "").trim(),
      section_title: sectionTitle,
      item_status: String(item?.attachment?.item_status ?? "planned").trim(),
      script_note: scriptNote,
      visual_note: String(item?.attachment?.visual_note ?? "").trim(),
      source_url: String(item?.asset?.source_url ?? "").trim(),
      local_path: String(item?.asset?.local_path ?? "").trim(),
      usage_role: usageRole,
      on_screen_cue: onScreenCue,
      backup_note: backupNote,
      confidence: deriveAssistantConfidenceSignals(item?.attachment ?? {}),
      shotcard
    };
  });
}

function buildReleaseShotlistMarkdown(release = null, shotlist = []) {
  const lines = [
    `# Shotlist: ${release?.title || release?.id || "Release"}`,
    "",
    `- Release ID: ${release?.id || ""}`,
    `- Status: ${release?.status || "draft"}`,
    `- Items: ${Array.isArray(shotlist) ? shotlist.length : 0}`,
    ""
  ];
  (Array.isArray(shotlist) ? shotlist : []).forEach((item) => {
    lines.push(`## ${item.index}. ${item.title || item.asset_id || "Release Item"}`, "");
    lines.push(`- Section: ${item.section_title || ""}`);
    lines.push(`- Status: ${item.item_status || "planned"}`);
    lines.push(`- Usage Role: ${item.usage_role || "reference"}`);
    if (item.on_screen_cue) lines.push(`- On-Screen Cue: ${item.on_screen_cue}`);
    lines.push(`- Picked Source: ${item?.shotcard?.picked_source?.title || "—"}`);
    if (item?.shotcard?.picked_source?.domain) lines.push(`  - Domain: ${item.shotcard.picked_source.domain}`);
    if (item?.shotcard?.picked_source?.origin) lines.push(`  - Origin: ${item.shotcard.picked_source.origin}`);
    if (item?.shotcard?.picked_source?.picked_from) lines.push(`  - Picked From: ${item.shotcard.picked_source.picked_from}`);
    lines.push(`- Picked Visual: ${item?.shotcard?.picked_visual?.title || "—"}`);
    if (item?.shotcard?.picked_visual?.domain) lines.push(`  - Domain: ${item.shotcard.picked_visual.domain}`);
    if (item?.shotcard?.picked_visual?.origin) lines.push(`  - Origin: ${item.shotcard.picked_visual.origin}`);
    if (item?.shotcard?.picked_visual?.picked_from) lines.push(`  - Picked From: ${item.shotcard.picked_visual.picked_from}`);
    lines.push(`- Fallback: ${item?.shotcard?.fallback?.title || "—"}`);
    if (item?.shotcard?.fallback?.domain) lines.push(`  - Domain: ${item.shotcard.fallback.domain}`);
    if (item?.shotcard?.fallback?.origin) lines.push(`  - Origin: ${item.shotcard.fallback.origin}`);
    if (item?.shotcard?.fallback?.picked_from) lines.push(`  - Picked From: ${item.shotcard.fallback.picked_from}`);
    if (item.backup_note) lines.push(`- Backup Note: ${item.backup_note}`);
    if (item.script_note) lines.push(`- Script Note: ${item.script_note}`);
    if (item.visual_note) lines.push(`- Visual Note: ${item.visual_note}`);
    if (item.source_url) lines.push(`- Source URL: ${item.source_url}`);
    if (item.local_path) lines.push(`- Local Path: ${item.local_path}`);
    if (Array.isArray(item.confidence) && item.confidence.length > 0) {
      lines.push(`- Confidence: ${item.confidence.join(", ")}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

function buildReleaseMediaPackage(release = null, shotlist = []) {
  const isLikelyDownloadSource = (value = "") => {
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
  };
  const inferCopyPlanReadyState = (payload = {}) => {
    const stepType = String(payload.step_type ?? "").trim().toLowerCase();
    const target = String(payload.target ?? "").trim().toLowerCase();
    const hasPath = Boolean(String(payload.path ?? "").trim());
    const sourceUrl = String(payload.source_url ?? "").trim();
    if (target === "fallback" || stepType === "keep_backup_ready") return "backup_only";
    if (hasPath || stepType === "copy_file" || stepType === "verify_visual" || stepType === "open_source" || stepType === "note") {
      return "ready";
    }
    if (stepType === "capture_or_download") {
      return isLikelyDownloadSource(sourceUrl) ? "download_needed" : "capture_needed";
    }
    if (sourceUrl) {
      return isLikelyDownloadSource(sourceUrl) ? "download_needed" : "capture_needed";
    }
    return "ready";
  };
  const inferMediaItemReadyState = (payload = {}) => {
    if (String(payload.local_path ?? "").trim()) return "ready";
    if (String(payload.source_url ?? "").trim()) {
      return isLikelyDownloadSource(payload.source_url) ? "download_needed" : "capture_needed";
    }
    if (payload?.fallback) return "backup_only";
    return "ready";
  };
  const files = [];
  const seenPaths = new Set();
  const copyPlan = [];
  const seenCopyPlanKeys = new Set();
  const rememberFile = (filePath, payload = {}) => {
    const normalizedPath = String(filePath ?? "").trim();
    if (!normalizedPath || seenPaths.has(normalizedPath)) return;
    seenPaths.add(normalizedPath);
    files.push({
      path: normalizedPath,
      kind: String(payload.kind ?? "").trim() || "file",
      asset_id: String(payload.asset_id ?? "").trim(),
      title: String(payload.title ?? "").trim(),
      section_title: String(payload.section_title ?? "").trim(),
      usage_role: String(payload.usage_role ?? "").trim(),
      source_url: String(payload.source_url ?? "").trim()
    });
  };
  const rememberCopyPlanEntry = (payload = {}) => {
    const key = [
      String(payload.attachment_id ?? "").trim(),
      String(payload.step_type ?? "").trim(),
      String(payload.path ?? "").trim(),
      String(payload.source_url ?? "").trim(),
      String(payload.target ?? "").trim()
    ].join("::");
    if (!key.replace(/::/g, "")) return;
    if (seenCopyPlanKeys.has(key)) return;
    seenCopyPlanKeys.add(key);
    copyPlan.push({
      priority: Number(payload.priority ?? 99),
      target: String(payload.target ?? "").trim(),
      step_type: String(payload.step_type ?? "").trim(),
      attachment_id: String(payload.attachment_id ?? "").trim(),
      asset_id: String(payload.asset_id ?? "").trim(),
      title: String(payload.title ?? "").trim(),
      section_title: String(payload.section_title ?? "").trim(),
      usage_role: String(payload.usage_role ?? "").trim(),
      picked_from: String(payload.picked_from ?? "").trim(),
      path: String(payload.path ?? "").trim(),
      source_url: String(payload.source_url ?? "").trim(),
      ready_state: inferCopyPlanReadyState(payload),
      reason: String(payload.reason ?? "").trim()
    });
  };

  const items = (Array.isArray(shotlist) ? shotlist : []).map((item) => {
    const normalized = {
      index: Number(item?.index ?? 0),
      asset_id: String(item?.asset_id ?? "").trim(),
      attachment_id: String(item?.attachment_id ?? "").trim(),
      title: String(item?.title ?? "").trim(),
      section_title: String(item?.section_title ?? "").trim(),
      item_status: String(item?.item_status ?? "").trim(),
      usage_role: String(item?.usage_role ?? "").trim(),
      on_screen_cue: String(item?.on_screen_cue ?? "").trim(),
      source_url: String(item?.source_url ?? "").trim(),
      local_path: String(item?.local_path ?? "").trim(),
      script_note: String(item?.script_note ?? "").trim(),
      visual_note: String(item?.visual_note ?? "").trim(),
      backup_note: String(item?.backup_note ?? "").trim(),
      picked_source: item?.shotcard?.picked_source ?? null,
      picked_visual: item?.shotcard?.picked_visual ?? null,
      fallback: item?.shotcard?.fallback ?? null,
      confidence: Array.isArray(item?.confidence) ? item.confidence : [],
      ready_state: inferMediaItemReadyState(item)
    };
    if (normalized.local_path) {
      rememberFile(normalized.local_path, {
        kind: "primary_media",
        asset_id: normalized.asset_id,
        title: normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        source_url: normalized.source_url
      });
      rememberCopyPlanEntry({
        priority: 1,
        target: "primary_media",
        step_type: "copy_file",
        attachment_id: normalized.attachment_id,
        asset_id: normalized.asset_id,
        title: normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        path: normalized.local_path,
        source_url: normalized.source_url,
        reason: "Primary file already attached to the release item"
      });
    } else if (normalized.source_url) {
      rememberCopyPlanEntry({
        priority: 2,
        target: "primary_media",
        step_type: "capture_or_download",
        attachment_id: normalized.attachment_id,
        asset_id: normalized.asset_id,
        title: normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        source_url: normalized.source_url,
        reason: "Primary release item still depends on source URL"
      });
    }
    const pickedSourceTitle = String(normalized.picked_source?.title ?? "").trim();
    const pickedSourceDomain = String(normalized.picked_source?.domain ?? "").trim();
    if (pickedSourceTitle || pickedSourceDomain) {
      rememberCopyPlanEntry({
        priority: normalized.local_path ? 3 : 2,
        target: "picked_source",
        step_type: normalized.source_url ? "open_source" : "note",
        attachment_id: normalized.attachment_id,
        asset_id: normalized.asset_id,
        title: pickedSourceTitle || normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        picked_from: String(normalized.picked_source?.picked_from ?? "").trim(),
        source_url: normalized.source_url,
        reason: pickedSourceDomain
          ? `Keep source reference from ${pickedSourceDomain} available for scripting or fact checks`
          : "Keep picked source reference available for scripting or fact checks"
      });
    }
    const pickedVisualTitle = String(normalized.picked_visual?.title ?? "").trim();
    const pickedVisualDomain = String(normalized.picked_visual?.domain ?? "").trim();
    if (pickedVisualTitle || pickedVisualDomain) {
      rememberCopyPlanEntry({
        priority: normalized.local_path ? 2 : 1,
        target: "picked_visual",
        step_type: normalized.local_path ? "verify_visual" : normalized.source_url ? "capture_or_download" : "note",
        attachment_id: normalized.attachment_id,
        asset_id: normalized.asset_id,
        title: pickedVisualTitle || normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        picked_from: String(normalized.picked_visual?.picked_from ?? "").trim(),
        path: normalized.local_path,
        source_url: normalized.source_url,
        reason: pickedVisualDomain
          ? `Primary visual cue points to ${pickedVisualDomain}`
          : "Primary visual cue should be prepared first"
      });
    }
    const fallbackTitle = String(normalized.fallback?.title ?? "").trim();
    const fallbackDomain = String(normalized.fallback?.domain ?? "").trim();
    if (fallbackTitle || fallbackDomain) {
      rememberCopyPlanEntry({
        priority: 4,
        target: "fallback",
        step_type: "keep_backup_ready",
        attachment_id: normalized.attachment_id,
        asset_id: normalized.asset_id,
        title: fallbackTitle || normalized.title,
        section_title: normalized.section_title,
        usage_role: normalized.usage_role,
        picked_from: String(normalized.fallback?.picked_from ?? "").trim(),
        source_url: normalized.source_url,
        reason: fallbackDomain
          ? `Backup option available via ${fallbackDomain}`
          : "Keep fallback option available for montage backup"
      });
    }
    return normalized;
  });
  const prioritizedCopyPlan = [...copyPlan].sort(
    (a, b) =>
      Number(a?.priority ?? 99) - Number(b?.priority ?? 99) ||
      String(a?.section_title ?? "").localeCompare(String(b?.section_title ?? "")) ||
      String(a?.title ?? "").localeCompare(String(b?.title ?? ""))
  );

  return {
    release: {
      id: String(release?.id ?? "").trim(),
      title: String(release?.title ?? "").trim(),
      status: String(release?.status ?? "").trim(),
      document_id: String(release?.document_id ?? "").trim()
    },
    summary: {
      items: items.length,
      files: files.length,
      copy_plan_steps: prioritizedCopyPlan.length,
      ready_files: prioritizedCopyPlan.filter((item) => String(item?.step_type ?? "") === "copy_file").length,
      capture_needed: prioritizedCopyPlan.filter((item) => ["capture_needed", "download_needed"].includes(String(item?.ready_state ?? ""))).length,
      download_needed: prioritizedCopyPlan.filter((item) => String(item?.ready_state ?? "") === "download_needed").length,
      backup_steps: prioritizedCopyPlan.filter((item) => String(item?.ready_state ?? "") === "backup_only").length
    },
    items,
    files,
    copy_plan: prioritizedCopyPlan
  };
}

function reconcileReleaseMediaPackage(release = null, mediaPackage = null, downloadedMap = {}) {
  if (!mediaPackage || typeof mediaPackage !== "object") return mediaPackage;
  const normalizedDownloaded = downloadedMap && typeof downloadedMap === "object" ? downloadedMap : {};
  const downloadedUrls = new Set();
  Object.entries(normalizedDownloaded).forEach(([key, value]) => {
    const comparableKey = normalizeComparableUrl(key);
    if (comparableKey) downloadedUrls.add(comparableKey);
    const comparableValue = normalizeComparableUrl(value?.url ?? "");
    if (comparableValue) downloadedUrls.add(comparableValue);
  });

  const visualCoverage = (Array.isArray(release?.assets) ? release.assets : [])
    .map((entry) => {
      const asset = entry?.asset ?? {};
      const attachment = entry?.attachment ?? {};
      const role = String(attachment?.role ?? "").trim().toLowerCase();
      const kind = String(asset?.kind ?? "").trim().toLowerCase();
      const localPath = String(asset?.local_path ?? asset?.screenshot_path ?? "").trim();
      const sectionTitle = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
      const sourceUrl = normalizeComparableUrl(asset?.source_url ?? "");
      return {
        attachment_id: String(attachment?.id ?? "").trim(),
        role,
        kind,
        local_path: localPath,
        section_title: sectionTitle,
        source_url: sourceUrl
      };
    })
    .filter(
      (entry) =>
        entry.local_path &&
        ["visual", "story"].includes(entry.role) &&
        ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(entry.kind)
    );

  const hasCapturedVisualForItem = (item = {}) => {
    const attachmentId = String(item?.attachment_id ?? "").trim();
    const sectionTitle = String(item?.section_title ?? "").trim().toLowerCase();
    const sourceUrl = normalizeComparableUrl(item?.source_url ?? "");
    return visualCoverage.some(
      (entry) =>
        entry.attachment_id !== attachmentId &&
        ((sectionTitle && entry.section_title && sectionTitle === entry.section_title) ||
          (sourceUrl && entry.source_url && sourceUrl === entry.source_url))
    );
  };

  const resolveEffectiveState = (item = {}) => {
    const readyState = String(item?.ready_state ?? "").trim().toLowerCase();
    if (readyState === "download_needed") {
      const sourceUrl = normalizeComparableUrl(item?.source_url ?? "");
      if (sourceUrl && downloadedUrls.has(sourceUrl)) return "downloaded";
    }
    if (readyState === "capture_needed" && hasCapturedVisualForItem(item)) {
      return "captured";
    }
    return readyState;
  };

  const items = (Array.isArray(mediaPackage?.items) ? mediaPackage.items : []).map((item) => ({
    ...item,
    effective_ready_state: resolveEffectiveState(item)
  }));
  const copyPlan = (Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : []).map((item) => ({
    ...item,
    effective_ready_state: resolveEffectiveState(item)
  }));
  const effectiveStates = copyPlan.map((item) => resolveHandoffReadyState(item));
  const summary = {
    ...(mediaPackage?.summary ?? {}),
    ready_files: effectiveStates.filter((state) => ["ready", "downloaded", "captured"].includes(state)).length,
    capture_needed: effectiveStates.filter((state) => ["capture_needed", "download_needed"].includes(state)).length,
    download_needed: effectiveStates.filter((state) => state === "download_needed").length,
    backup_steps: effectiveStates.filter((state) => state === "backup_only").length,
    downloaded: effectiveStates.filter((state) => state === "downloaded").length,
    captured: effectiveStates.filter((state) => state === "captured").length
  };

  return {
    ...mediaPackage,
    summary,
    items,
    copy_plan: copyPlan
  };
}

function buildReleaseCopyPlanMarkdown(release = null, mediaPackage = null) {
  const summary = mediaPackage?.summary ?? {};
  const steps = Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : [];
  const lines = [
    `# Copy Plan: ${release?.title || release?.id || "Release"}`,
    "",
    `- Release ID: ${String(release?.id ?? "").trim()}`,
    `- Items: ${Number(summary?.items ?? 0)}`,
    `- Files Ready: ${Number(summary?.ready_files ?? 0)}`,
    `- Capture Needed: ${Number(summary?.capture_needed ?? 0)}`,
    `- Backup Steps: ${Number(summary?.backup_steps ?? 0)}`,
    `- Total Steps: ${Number(summary?.copy_plan_steps ?? 0)}`,
    ""
  ];
  steps.forEach((item, index) => {
    lines.push(`## ${index + 1}. [P${Number(item?.priority ?? 99)}] ${item?.title || item?.asset_id || item?.attachment_id || "Step"}`, "");
    if (item?.section_title) lines.push(`- Section: ${item.section_title}`);
    if (item?.usage_role) lines.push(`- Usage Role: ${item.usage_role}`);
    if (item?.target) lines.push(`- Target: ${item.target}`);
    if (item?.step_type) lines.push(`- Step: ${item.step_type}`);
    if (resolveHandoffReadyState(item)) lines.push(`- Ready State: ${resolveHandoffReadyState(item)}`);
    if (item?.effective_ready_state && item?.ready_state && item.effective_ready_state !== item.ready_state) {
      lines.push(`- Original Ready State: ${item.ready_state}`);
    }
    if (item?.picked_from) lines.push(`- Picked From: ${item.picked_from}`);
    if (item?.path) lines.push(`- Path: ${item.path}`);
    if (item?.source_url) lines.push(`- Source URL: ${item.source_url}`);
    if (item?.reason) lines.push(`- Why: ${item.reason}`);
    lines.push("");
  });
  return lines.join("\n");
}

function buildMediaPackageHighlights(mediaPackage = null) {
  const steps = Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : [];
  return steps.slice(0, 4).map((item) => ({
    priority: Number(item?.priority ?? 99),
    target: String(item?.target ?? "").trim(),
    step_type: String(item?.step_type ?? "").trim(),
    attachment_id: String(item?.attachment_id ?? "").trim(),
    asset_id: String(item?.asset_id ?? "").trim(),
    title: String(item?.title ?? "").trim(),
    section_title: String(item?.section_title ?? "").trim(),
    usage_role: String(item?.usage_role ?? "").trim(),
    picked_from: String(item?.picked_from ?? "").trim(),
    ready_state: String(item?.ready_state ?? "").trim(),
    effective_ready_state: String(item?.effective_ready_state ?? "").trim(),
    path: String(item?.path ?? "").trim(),
    source_url: String(item?.source_url ?? "").trim(),
    reason: String(item?.reason ?? "").trim()
  }));
}

function buildHandoffQueue(mediaPackage = null) {
  const steps = Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : [];
  return steps
    .filter((item) => ["capture_needed", "download_needed"].includes(resolveHandoffReadyState(item)))
    .slice(0, 6)
    .map((item) => ({
      priority: Number(item?.priority ?? 99),
      target: String(item?.target ?? "").trim(),
      step_type: String(item?.step_type ?? "").trim(),
      attachment_id: String(item?.attachment_id ?? "").trim(),
      asset_id: String(item?.asset_id ?? "").trim(),
      title: String(item?.title ?? "").trim(),
      section_title: String(item?.section_title ?? "").trim(),
      usage_role: String(item?.usage_role ?? "").trim(),
      picked_from: String(item?.picked_from ?? "").trim(),
      ready_state: String(item?.ready_state ?? "").trim(),
      effective_ready_state: String(item?.effective_ready_state ?? "").trim(),
      path: String(item?.path ?? "").trim(),
      source_url: String(item?.source_url ?? "").trim(),
      reason: String(item?.reason ?? "").trim()
    }));
}

async function loadReleaseDocumentState({
  documentId,
  getDocumentState,
  getDocDir,
  readOptionalJson
}) {
  return loadIndexedObjectWithFallback(
    documentId,
    getDocumentState,
    (normalizedId) =>
      typeof getDocDir === "function" && typeof readOptionalJson === "function"
        ? readOptionalJson(path.join(getDocDir(normalizedId), "document.json")).catch(() => null)
        : null,
    null
  );
}

async function loadReleaseDocumentContext({
  documentId,
  listDocSegments,
  listDocDecisions,
  getDocDir,
  readOptionalJson
}) {
  const normalizedId = String(documentId ?? "").trim();
  if (!normalizedId) return { segments: [], decisions: [] };
  const [segments, decisions] = await Promise.all([
    loadIndexedArrayWithFallback(
      normalizedId,
      listDocSegments,
      (id) =>
        typeof getDocDir === "function" && typeof readOptionalJson === "function"
          ? readOptionalJson(path.join(getDocDir(id), "segments.json")).catch(() => [])
          : []
    ),
    loadIndexedArrayWithFallback(
      normalizedId,
      listDocDecisions,
      (id) =>
        typeof getDocDir === "function" && typeof readOptionalJson === "function"
          ? readOptionalJson(path.join(getDocDir(id), "decisions.json")).catch(() => [])
          : []
    )
  ]);
  return {
    segments: Array.isArray(segments) ? segments : [],
    decisions: Array.isArray(decisions) ? decisions : []
  };
}

async function loadReleaseResearchRuns({
  documentId,
  listResearchRuns,
  getDocDir,
  readOptionalJson
}) {
  const normalizedId = String(documentId ?? "").trim();
  if (!normalizedId) return [];
  return loadIndexedArrayWithFallback(
    normalizedId,
    listResearchRuns,
    (id) =>
      typeof getDocDir === "function" && typeof readOptionalJson === "function"
        ? readOptionalJson(path.join(getDocDir(id), "research.json")).catch(() => null)
        : null,
    (payload) => payload?.runs
  );
}

async function buildReleaseResearchBriefs({ release, listDocSegments, listDocDecisions, listResearchRuns, getDocDir, readOptionalJson }) {
  const documentId = String(release?.document_id ?? "").trim();
  if (!documentId) {
    return { summary: { total: 0 }, items: [] };
  }
  const [{ segments: segmentsRaw, decisions: decisionsRaw }, runs] = await Promise.all([
    loadReleaseDocumentContext({
      documentId,
      listDocSegments,
      listDocDecisions,
      getDocDir,
      readOptionalJson
    }),
    loadReleaseResearchRuns({
      documentId,
      listResearchRuns,
      getDocDir,
      readOptionalJson
    })
  ]);
  const segments = (Array.isArray(segmentsRaw) ? segmentsRaw : []).filter((segment) => {
    const segmentId = String(segment?.segment_id ?? "").trim();
    const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
    return segmentId && blockType !== "links" && !/^comments_/i.test(segmentId);
  });
  const segmentMap = new Map(segments.map((segment) => [String(segment.segment_id), segment]));
  const decisionMap = new Map(
    (Array.isArray(decisionsRaw) ? decisionsRaw : [])
      .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
      .filter(([segmentId]) => Boolean(segmentId))
  );
  const normalizedRuns = Array.isArray(runs) ? runs : [];
  if (normalizedRuns.length === 0) {
    return { summary: { total: 0 }, items: [] };
  }
  const researchRunPins = normalizeReleaseResearchRunPins(release?.meta_json?.research_run_pins);

  const latestRunBySegment = new Map();
  const runsBySegment = new Map();
  normalizedRuns.forEach((run) => {
    const segmentId = String(run?.segment_id ?? "").trim();
    if (!segmentId) return;
    const currentRuns = runsBySegment.get(segmentId) ?? [];
    currentRuns.push(run);
    runsBySegment.set(segmentId, currentRuns);
    const current = latestRunBySegment.get(segmentId);
    const currentStamp = String(current?.updated_at ?? current?.created_at ?? "");
    const nextStamp = String(run?.updated_at ?? run?.created_at ?? "");
    if (!current || nextStamp.localeCompare(currentStamp) > 0) {
      latestRunBySegment.set(segmentId, run);
    }
  });

  const explicitSegmentIds = new Set();
  const releaseSectionTitles = new Set();
  const releaseItems = Array.isArray(release?.assets) ? release.assets : [];
  releaseItems.forEach((item) => {
    const meta = item?.asset?.meta_json ?? {};
    const segmentId = String(meta?.segment_id ?? "").trim();
    const sectionTitle = String(meta?.section_title ?? "").trim().toLowerCase();
    if (segmentId) explicitSegmentIds.add(segmentId);
    if (sectionTitle) releaseSectionTitles.add(sectionTitle);
  });

  const selectedSegmentIds = new Set();
  explicitSegmentIds.forEach((segmentId) => {
    if (latestRunBySegment.has(segmentId)) selectedSegmentIds.add(segmentId);
  });
  if (releaseSectionTitles.size > 0) {
    segments.forEach((segment) => {
      const sectionTitle = String(segment?.section_title ?? "").trim().toLowerCase();
      if (sectionTitle && releaseSectionTitles.has(sectionTitle) && latestRunBySegment.has(String(segment.segment_id))) {
        selectedSegmentIds.add(String(segment.segment_id));
      }
    });
  }
  if (selectedSegmentIds.size === 0) {
    [...latestRunBySegment.values()]
      .sort((a, b) => String(b?.updated_at ?? b?.created_at ?? "").localeCompare(String(a?.updated_at ?? a?.created_at ?? "")))
      .slice(0, 5)
      .forEach((run) => selectedSegmentIds.add(String(run?.segment_id ?? "").trim()));
  }

  const items = [...selectedSegmentIds]
    .map((segmentId) => {
      const pinnedRunId = String(researchRunPins[segmentId] ?? "").trim();
      const pinnedRun = pinnedRunId
        ? (runsBySegment.get(segmentId) ?? []).find((item) => String(item?.run_id ?? "").trim() === pinnedRunId) ?? null
        : null;
      const run = pinnedRun ?? latestRunBySegment.get(segmentId);
      if (!run) return null;
      const segment = segmentMap.get(segmentId) ?? null;
      const decision = decisionMap.get(segmentId) ?? null;
      const brief = mergeResearchBriefWithBundleTrace(
        run?.brief && typeof run.brief === "object" && Array.isArray(run.brief.items)
          ? run.brief
          : buildResearchBriefFallback(run, segment),
        decision?.research_bundle_trace
      );
      const pairSummary = buildReleaseResearchPairSummary(brief, decision?.research_bundle_trace);
      return {
        segment_id: segmentId,
        section_title: String(segment?.section_title ?? run?.section_title ?? "").trim(),
        text_quote: String(segment?.text_quote ?? "").trim(),
        run_id: String(run?.run_id ?? "").trim(),
        updated_at: String(run?.updated_at ?? run?.created_at ?? ""),
        is_pinned: Boolean(pinnedRun),
        pinned_run_id: pinnedRun ? String(run?.run_id ?? "").trim() : "",
        brief,
        bundle_trace: normalizeResearchBundleTrace(decision?.research_bundle_trace),
        ...pairSummary
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return {
    summary: {
      total: items.length,
      pinned_total: items.filter((item) => Boolean(item?.is_pinned)).length
    },
    items
  };
}

function buildReleasePublishChecklist(release, assistantPass = null, mediaPackage = null) {
  const summary = assistantPass?.summary ?? {};
  const items = Array.isArray(release?.assets) ? release.assets : [];
  const allowedReadyStates = new Set(["visual_ready", "ready", "done", "skipped"]);
  const nonReadyItems = items.filter((item) => !allowedReadyStates.has(String(item?.attachment?.item_status ?? "planned").trim().toLowerCase()));
  const mediaSummary = mediaPackage?.summary ?? {};
  const captureNeeded = Number(mediaSummary?.capture_needed ?? 0);
  const downloadNeeded = Number(mediaSummary?.download_needed ?? 0);
  const pureCaptureNeeded = Math.max(0, captureNeeded - downloadNeeded);
  const backupSteps = Number(mediaSummary?.backup_steps ?? 0);
  const readyFiles = Number(mediaSummary?.ready_files ?? 0);

  const checks = [
    {
      key: "has_items",
      title: "Release has items",
      status: items.length > 0 ? "pass" : "fail",
      blocking: true,
      detail: items.length > 0 ? `${items.length} items in rundown.` : "Release is empty."
    },
    {
      key: "script_notes",
      title: "All items have script notes",
      status: Number(summary.missing_script ?? 0) === 0 ? "pass" : "fail",
      blocking: true,
      detail:
        Number(summary.missing_script ?? 0) === 0
          ? "Every item has a script note."
          : `${Number(summary.missing_script ?? 0)} items still missing script notes.`
    },
    {
      key: "visual_notes",
      title: "All items have visual notes",
      status: Number(summary.missing_visual ?? 0) === 0 ? "pass" : "fail",
      blocking: true,
      detail:
        Number(summary.missing_visual ?? 0) === 0
          ? "Every item has a visual note."
          : `${Number(summary.missing_visual ?? 0)} items still missing visual notes.`
    },
    {
      key: "source_links",
      title: "All items have source links",
      status: Number(summary.needs_link ?? 0) === 0 ? "pass" : "warn",
      blocking: false,
      detail:
        Number(summary.needs_link ?? 0) === 0
          ? "Every item has a source link."
          : `${Number(summary.needs_link ?? 0)} items still missing source links.`
    },
    {
      key: "segment_visual_coverage",
      title: "Document segments have visual coverage",
      status: Number(summary.segments_without_visual ?? 0) === 0 ? "pass" : "warn",
      blocking: false,
      detail:
        Number(summary.segments_without_visual ?? 0) === 0
          ? "No uncovered segments found."
          : `${Number(summary.segments_without_visual ?? 0)} document segments still have no visual coverage.`
    },
    {
      key: "rundown_status",
      title: "Rundown items are at least visual ready",
      status: nonReadyItems.length === 0 ? "pass" : "fail",
      blocking: true,
      detail:
        nonReadyItems.length === 0
          ? "All items are in visual_ready/ready/done/skipped."
          : `${nonReadyItems.length} items are still below visual_ready.`
    },
    {
      key: "montage_handoff",
      title: "Montage handoff is ready",
      status: captureNeeded === 0 ? "pass" : "warn",
      blocking: false,
      detail:
        captureNeeded === 0
          ? readyFiles > 0
            ? `${readyFiles} file(s) are already ready for montage handoff.`
            : backupSteps > 0
              ? "Only backup handoff steps remain."
              : "No capture/download steps are pending."
          : downloadNeeded > 0 && pureCaptureNeeded > 0
            ? `${downloadNeeded} download step(s) and ${pureCaptureNeeded} capture step(s) are still pending.`
            : downloadNeeded > 0
              ? `${downloadNeeded} download step(s) are still pending.`
              : `${captureNeeded} capture step(s) are still pending.`
    }
  ];

  const blockingFailures = checks.filter((item) => item.blocking && item.status === "fail").length;
  const warnings = checks.filter((item) => item.status === "warn").length;
  const passed = checks.filter((item) => item.status === "pass").length;
  const editorialReady = blockingFailures === 0;
  const handoffReady = captureNeeded === 0;
  let handoffStatusCode = "no_files";
  if (downloadNeeded > 0) handoffStatusCode = "pending_download";
  else if (pureCaptureNeeded > 0) handoffStatusCode = "pending_capture";
  else if (readyFiles > 0) handoffStatusCode = "ready";
  else if (backupSteps > 0) handoffStatusCode = "backup_only";

  return {
    summary: {
      total_checks: checks.length,
      passed,
      warnings,
      blocking_failures: blockingFailures,
      editorial_ready: editorialReady,
      handoff_ready: handoffReady,
      handoff_status_code: handoffStatusCode,
      download_needed: downloadNeeded,
      pure_capture_needed: pureCaptureNeeded
    },
    checks,
    is_ready_to_air: editorialReady
  };
}

function buildReleaseDiagnosticHighlights(assistantPass = null, mediaPackage = null) {
  const highlights = [];
  const pushGapHighlight = (key, label, items = [], nextStep) => {
    const first = Array.isArray(items) ? items[0] : null;
    if (!first) return;
    const title = String(first?.title || first?.asset_id || "Item").trim();
    const sectionTitle = String(first?.section_title ?? "").trim();
    highlights.push({
      key,
      label,
      title,
      section_title: sectionTitle,
      attachment_id: String(first?.attachment_id ?? "").trim(),
      asset_id: String(first?.asset_id ?? "").trim(),
      detail: `${label} in ${sectionTitle || title}`,
      next_step: nextStep
    });
  };

  pushGapHighlight("missing_script", "Script gap", assistantPass?.items_without_script, "Fill script note for the first script gap.");
  pushGapHighlight("missing_visual", "Visual gap", assistantPass?.items_without_visual, "Close the first visual gap with research or screenshots.");
  pushGapHighlight("needs_link", "Source gap", assistantPass?.items_without_link, "Restore the first missing source link.");
  const firstHandoffBlocker = (Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : []).find((item) =>
    ["capture_needed", "download_needed"].includes(resolveHandoffReadyState(item))
  );
  if (firstHandoffBlocker) {
    const isDownload = resolveHandoffReadyState(firstHandoffBlocker) === "download_needed";
    highlights.push({
      key: isDownload ? "handoff_download" : "handoff_capture",
      label: isDownload ? "Download blocker" : "Capture blocker",
      title: String(firstHandoffBlocker?.title || firstHandoffBlocker?.asset_id || "Item").trim(),
      section_title: String(firstHandoffBlocker?.section_title ?? "").trim(),
      attachment_id: String(firstHandoffBlocker?.attachment_id ?? "").trim(),
      asset_id: String(firstHandoffBlocker?.asset_id ?? "").trim(),
      detail: isDownload
        ? "This item still needs a source download before montage handoff."
        : "This item still needs a screenshot/capture before montage handoff.",
      next_step: isDownload ? "Download the primary handoff source first." : "Capture the primary visual first."
    });
  }
  return highlights.slice(0, 4);
}

function buildReleaseControlPanel(release, assistantPass = null, publishChecklist = null, mediaPackage = null) {
  const status = String(release?.status ?? "draft").trim().toLowerCase();
  const editorStatus = String(release?.editor_status ?? "planning").trim().toLowerCase();
  const blockingFailures = Number(publishChecklist?.summary?.blocking_failures ?? 0);
  const warnings = Number(publishChecklist?.summary?.warnings ?? 0);
  const copyPlanSummary = mediaPackage?.summary ?? {};
  const captureNeeded = Number(copyPlanSummary?.capture_needed ?? 0);
  const downloadNeeded = Number(copyPlanSummary?.download_needed ?? 0);
  const pureCaptureNeeded = Math.max(0, captureNeeded - downloadNeeded);
  const backupSteps = Number(copyPlanSummary?.backup_steps ?? 0);
  const readyFiles = Number(copyPlanSummary?.ready_files ?? 0);

  let statusCode = "not_ready";
  let title = "Not Ready";
  let detail = "Release still has blocking issues before air.";
  const diagnosticHighlights = buildReleaseDiagnosticHighlights(assistantPass, mediaPackage);
  const handoffQueue = buildHandoffQueue(mediaPackage);

  if (status === "published" || editorStatus === "published") {
    statusCode = "published";
    title = "Published";
    detail = "Release is already marked as published.";
  } else if (status === "ready" || editorStatus === "air_ready") {
    statusCode = "air_ready";
    title = "Air Ready";
    detail = "Release passed the air gate and can be published.";
  } else if (publishChecklist?.is_ready_to_air) {
    statusCode = "almost_ready";
    title = "Almost Ready";
    detail = "Release passed blocking checks and can be moved to air_ready.";
  } else if (blockingFailures === 0 && warnings > 0) {
    statusCode = "in_progress";
    title = "In Progress";
    detail = "Release has no blockers but still has advisory warnings.";
  }
  if (captureNeeded > 0) {
    if (downloadNeeded > 0 && pureCaptureNeeded > 0) {
      detail = `${detail} ${downloadNeeded} download step${downloadNeeded > 1 ? "s are" : " is"} and ${pureCaptureNeeded} capture step${
        pureCaptureNeeded > 1 ? "s are" : " is"
      } still pending for montage handoff.`;
    } else if (downloadNeeded > 0) {
      detail = `${detail} ${downloadNeeded} download step${downloadNeeded > 1 ? "s are" : " is"} still pending for montage handoff.`;
    } else {
      detail = `${detail} ${captureNeeded} capture step${captureNeeded > 1 ? "s are" : " is"} still pending for montage handoff.`;
    }
  } else if (readyFiles > 0 && statusCode !== "published") {
    detail = `${detail} ${readyFiles} file${readyFiles > 1 ? "s are" : " is"} already ready for montage handoff.`;
  } else if (backupSteps > 0) {
    detail = `${detail} Only backup handoff steps are currently available.`;
  }

  let handoffStatusCode = "no_files";
  if (downloadNeeded > 0) {
    handoffStatusCode = "pending_download";
  } else if (pureCaptureNeeded > 0) {
    handoffStatusCode = "pending_capture";
  } else if (readyFiles > 0) {
    handoffStatusCode = "ready";
  } else if (backupSteps > 0) {
    handoffStatusCode = "backup_only";
  }

  const actions = [];
  if (statusCode !== "published") {
    if (Number(assistantPass?.summary?.missing_script ?? 0) > 0 || Number(assistantPass?.summary?.missing_visual ?? 0) > 0) {
      actions.push({
        key: "prepare_release",
        title: "Prepare Release",
        detail: "Fill missing notes and attach visuals where possible."
      });
    }
    if (publishChecklist?.is_ready_to_air && !(status === "ready" || editorStatus === "air_ready")) {
      actions.push({
        key: "mark_air_ready",
        title: "Mark Air Ready",
        detail: "Move release into air_ready state."
      });
    }
    if (publishChecklist?.is_ready_to_air && (status === "ready" || editorStatus === "air_ready")) {
      actions.push({
        key: "publish_release",
        title: "Publish Release",
        detail: "Mark release as published."
      });
    }
    if (captureNeeded > 0) {
      actions.push({
        key: "prepare_handoff",
        title: "Prepare Handoff",
        detail: `Resolve ${captureNeeded} pending capture/download step${captureNeeded > 1 ? "s" : ""}.`
      });
    }
  }

  return {
    status_code: statusCode,
    handoff_status_code: handoffStatusCode,
    title,
    detail,
    can_mark_air_ready: Boolean(publishChecklist?.is_ready_to_air) && !(status === "ready" || editorStatus === "air_ready"),
    can_publish: Boolean(publishChecklist?.is_ready_to_air) && (status === "ready" || editorStatus === "air_ready"),
    actions,
    handoff_queue: handoffQueue,
    diagnostic_highlights: diagnosticHighlights,
    copy_plan_summary: {
      ready_files: readyFiles,
      capture_needed: captureNeeded,
      download_needed: downloadNeeded,
      pure_capture_needed: pureCaptureNeeded,
      downloaded: Number(copyPlanSummary?.downloaded ?? 0),
      captured: Number(copyPlanSummary?.captured ?? 0),
      backup_steps: backupSteps,
      total_steps: Number(copyPlanSummary?.copy_plan_steps ?? 0)
    }
  };
}

function buildReleaseBriefingPanel(
  release,
  assistantPass = null,
  publishChecklist = null,
  controlPanel = null,
  recommendations = null,
  mediaPackage = null
) {
  const summary = assistantPass?.summary ?? {};
  const recommendationSummary = recommendations?.summary ?? {};
  const risks = [];
  const nextSteps = [];
  const diagnosticHighlights = buildReleaseDiagnosticHighlights(assistantPass, mediaPackage);

  if (Number(summary.missing_script ?? 0) > 0) {
    risks.push(`${Number(summary.missing_script)} items still have no script note.`);
    nextSteps.push("Fill missing script notes.");
  }
  if (Number(summary.missing_visual ?? 0) > 0) {
    risks.push(`${Number(summary.missing_visual)} items still have no visual note.`);
    nextSteps.push("Close visual gaps or capture missing screenshots.");
  }
  if (Number(summary.needs_link ?? 0) > 0) {
    risks.push(`${Number(summary.needs_link)} items still have no source link.`);
    nextSteps.push("Restore missing source links for fact-checking.");
  }
  if (Number(summary.orphan_screenshots ?? 0) > 0) {
    risks.push(`${Number(summary.orphan_screenshots)} screenshots are still outside the release.`);
    nextSteps.push("Attach orphan screenshots to the release.");
  }
  if (Number(recommendationSummary.total_candidates ?? 0) > 0 && Number(summary.missing_visual ?? 0) > 0) {
    nextSteps.push("Review recommended assets and attach the strongest candidates.");
  }
  const copyPlanSummary = mediaPackage?.summary ?? {};
  if (Number(copyPlanSummary?.capture_needed ?? 0) > 0) {
    risks.push(`${Number(copyPlanSummary.capture_needed)} handoff step(s) still need capture or download.`);
    nextSteps.push("Resolve pending capture/download steps from the copy plan.");
  }
  if (publishChecklist?.summary?.editorial_ready && !publishChecklist?.summary?.handoff_ready) {
    risks.unshift(
      `Release is editorially ready, but montage handoff is still ${String(
        publishChecklist?.summary?.handoff_status_code ?? "pending"
      ).replace(/_/g, " ")}.`
    );
    nextSteps.unshift("Finish pending handoff prep before treating the release as montage-ready.");
  }
  if (Number(copyPlanSummary?.ready_files ?? 0) > 0) {
    nextSteps.push(`Start montage with ${Number(copyPlanSummary.ready_files)} file(s) already ready.`);
  }
  if (publishChecklist?.is_ready_to_air && controlPanel?.can_mark_air_ready) {
    nextSteps.unshift("Move the release to air_ready.");
  }
  if (controlPanel?.can_publish) {
    nextSteps.unshift("Publish the release.");
  }
  diagnosticHighlights.forEach((item) => {
    if (item?.detail) risks.push(item.detail);
    if (item?.next_step) nextSteps.push(item.next_step);
  });

  const compactNextSteps = Array.from(new Set(nextSteps)).slice(0, 3);
  const compactRisks = Array.from(new Set(risks)).slice(0, 4);

  const headline =
    controlPanel?.status_code === "published"
      ? "Release is published."
      : controlPanel?.status_code === "air_ready"
        ? "Release is air ready and can be published."
        : controlPanel?.status_code === "almost_ready"
          ? "Release is almost ready for air."
          : "Release still needs work before air.";

  const summaryText = [
    headline,
    `${Number(summary.total ?? 0)} items in rundown.`,
    `${Number(summary.ready ?? 0)} are ready or done.`,
    `${Number(summary.in_progress ?? 0)} are still in progress.`
  ].join(" ");
  const recommendationHighlights = (Array.isArray(recommendations?.candidates) ? recommendations.candidates : [])
    .slice(0, 3)
    .map((item) => {
      const asset = item?.asset ?? {};
      return {
        asset_id: String(asset?.id ?? "").trim(),
        title: String(asset?.title || asset?.file_name || asset?.id || "Asset").trim(),
        score: Number(item?.score ?? 0),
        bucket: String(item?.bucket ?? "possible"),
        reason_summary: String(item?.reason_summary ?? "").trim(),
        matched_segment_id: String(item?.matched_segment_id ?? "").trim(),
        matched_section_title: String(item?.matched_section_title ?? "").trim(),
        matched_by: String(item?.matched_by ?? "").trim(),
        reasons: (Array.isArray(item?.reasons) ? item.reasons : []).slice(0, 4).map((reason) => ({
          key: String(reason?.key ?? "").trim(),
          label: formatRecommendationReasonLabel(reason)
        }))
      };
    });
  const copyPlanHighlights = buildMediaPackageHighlights(mediaPackage);
  const handoffQueue = buildHandoffQueue(mediaPackage);

  return {
    headline,
    summary_text: summaryText,
    risks: compactRisks,
    next_steps: compactNextSteps,
    status_code: controlPanel?.status_code || "not_ready",
    recommendation_highlights: recommendationHighlights,
    handoff_queue: handoffQueue,
    diagnostic_highlights: diagnosticHighlights,
    copy_plan_highlights: copyPlanHighlights
  };
}

function buildReleaseBriefMarkdown(
  release,
  assistantPass = null,
  recommendations = null,
  publishChecklist = null,
  controlPanel = null,
  briefingPanel = null,
  researchBriefs = null
) {
  const lines = [
    `# ${release?.title || release?.id || "Release"}`,
    "",
    `- ID: ${release?.id || ""}`,
    `- Status: ${release?.status || "draft"}`,
    `- Editor Status: ${release?.editor_status || "planning"}`,
    `- Air Date: ${release?.air_date || ""}`,
    `- Document: ${release?.document_id || ""}`,
    `- Assets: ${Number(release?.asset_count ?? 0)}`,
    ""
  ];
  const notes = String(release?.notes ?? "").trim();
  if (notes) {
    lines.push("## Release Notes", "", notes, "");
  }
  if (controlPanel?.title) {
    lines.push("## Release Control", "");
    lines.push(`- Status: ${controlPanel.title}`);
    lines.push(`- Detail: ${controlPanel.detail || ""}`);
    lines.push("");
  }
  if (briefingPanel?.summary_text) {
    lines.push("## Release Briefing", "");
    lines.push(briefingPanel.summary_text);
    lines.push("");
    const risks = Array.isArray(briefingPanel?.risks) ? briefingPanel.risks : [];
    if (risks.length > 0) {
      lines.push("### Risks", "");
      risks.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    const copyPlanHighlights = Array.isArray(briefingPanel?.copy_plan_highlights) ? briefingPanel.copy_plan_highlights : [];
    const handoffQueue = Array.isArray(briefingPanel?.handoff_queue) ? briefingPanel.handoff_queue : [];
    if (handoffQueue.length > 0) {
      lines.push("### Handoff Queue", "");
      handoffQueue.forEach((item) => {
        lines.push(`- [P${item.priority}] ${item.title || item.asset_id || item.attachment_id || "Item"}`);
        if (item.section_title) lines.push(`  - Section: ${item.section_title}`);
        if (resolveHandoffReadyState(item)) lines.push(`  - Ready State: ${resolveHandoffReadyState(item)}`);
        if (item.picked_from) lines.push(`  - Picked From: ${item.picked_from}`);
        if (item.source_url) lines.push(`  - Source URL: ${item.source_url}`);
        if (item.reason) lines.push(`  - Why: ${item.reason}`);
      });
      lines.push("");
    }
    if (copyPlanHighlights.length > 0) {
      lines.push("### Copy Plan Highlights", "");
      copyPlanHighlights.forEach((item) => {
        lines.push(`- [P${item.priority}] ${item.title || item.asset_id || item.attachment_id || "Item"}`);
        if (item.section_title) lines.push(`  - Section: ${item.section_title}`);
        if (item.step_type) lines.push(`  - Step: ${item.step_type}`);
        if (item.target) lines.push(`  - Target: ${item.target}`);
        if (resolveHandoffReadyState(item)) lines.push(`  - Ready State: ${resolveHandoffReadyState(item)}`);
        if (item.picked_from) lines.push(`  - Picked From: ${item.picked_from}`);
        if (item.path) lines.push(`  - Path: ${item.path}`);
        if (item.source_url) lines.push(`  - Source URL: ${item.source_url}`);
        if (item.reason) lines.push(`  - Why: ${item.reason}`);
      });
      lines.push("");
    }
    const nextSteps = Array.isArray(briefingPanel?.next_steps) ? briefingPanel.next_steps : [];
    if (nextSteps.length > 0) {
      lines.push("### Next Steps", "");
      nextSteps.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    const recommendationHighlights = Array.isArray(briefingPanel?.recommendation_highlights)
      ? briefingPanel.recommendation_highlights
      : [];
    lines.push("### Recommendation Highlights", "");
    if (recommendationHighlights.length > 0) {
      recommendationHighlights.forEach((item, index) => {
        lines.push(`- ${index + 1}. ${item.title} (score ${Number(item?.score ?? 0)})`);
        if (item?.matched_section_title) {
          lines.push(
            `  - Best For: ${item.matched_section_title}${item?.matched_segment_id ? ` (${item.matched_segment_id})` : ""}`
          );
        }
        if (item?.reason_summary) {
          lines.push(`  - Why: ${item.reason_summary}`);
        }
        const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
        if (reasons.length > 0) {
          lines.push(`  - Signals: ${reasons.map((reason) => reason.label).filter(Boolean).join(", ")}`);
        }
      });
    } else {
      lines.push("_No recommendation highlights right now._");
    }
    lines.push("");
    const diagnosticHighlights = Array.isArray(briefingPanel?.diagnostic_highlights) ? briefingPanel.diagnostic_highlights : [];
    if (diagnosticHighlights.length > 0) {
      lines.push("### Diagnostic Highlights", "");
      diagnosticHighlights.forEach((item, index) => {
        lines.push(`- ${index + 1}. ${item.label}: ${item.title}`);
        if (item?.section_title) {
          lines.push(`  - Section: ${item.section_title}`);
        }
        if (item?.next_step) {
          lines.push(`  - Next: ${item.next_step}`);
        }
      });
      lines.push("");
    }
  }
  if (assistantPass?.summary) {
    lines.push("## Assistant Pass", "");
    lines.push(`- Total: ${assistantPass.summary.total ?? 0}`);
    lines.push(`- Ready: ${assistantPass.summary.ready ?? 0}`);
    lines.push(`- In Progress: ${assistantPass.summary.in_progress ?? 0}`);
    lines.push(`- Missing Script: ${assistantPass.summary.missing_script ?? 0}`);
    lines.push(`- Missing Visual: ${assistantPass.summary.missing_visual ?? 0}`);
    lines.push(`- Needs Link: ${assistantPass.summary.needs_link ?? 0}`);
    lines.push(`- Screenshots: ${assistantPass.summary.screenshots ?? 0}`);
    lines.push(`- Orphan Screenshots: ${assistantPass.summary.orphan_screenshots ?? 0}`);
    lines.push("");
    const findings = Array.isArray(assistantPass.findings) ? assistantPass.findings : [];
    if (findings.length > 0) {
      lines.push("### Findings", "");
      findings.forEach((finding) => {
        lines.push(`- ${finding.title}: ${finding.detail}`);
      });
      lines.push("");
    }
  }
  if (publishChecklist?.summary) {
    lines.push("## Publish Checklist", "");
    lines.push(`- Ready To Air: ${publishChecklist.is_ready_to_air ? "yes" : "no"}`);
    if (typeof publishChecklist?.summary?.editorial_ready === "boolean") {
      lines.push(`- Editorial Ready: ${publishChecklist.summary.editorial_ready ? "yes" : "no"}`);
    }
    if (typeof publishChecklist?.summary?.handoff_ready === "boolean") {
      lines.push(`- Handoff Ready: ${publishChecklist.summary.handoff_ready ? "yes" : "no"}`);
    }
    if (publishChecklist?.summary?.handoff_status_code) {
      lines.push(`- Handoff Status: ${publishChecklist.summary.handoff_status_code}`);
    }
    lines.push(`- Passed: ${publishChecklist.summary.passed ?? 0}`);
    lines.push(`- Warnings: ${publishChecklist.summary.warnings ?? 0}`);
    lines.push(`- Blocking Failures: ${publishChecklist.summary.blocking_failures ?? 0}`);
    lines.push("");
    const checklistItems = Array.isArray(publishChecklist?.checks) ? publishChecklist.checks : [];
    checklistItems.forEach((item) => {
      lines.push(`- [${String(item.status ?? "").toUpperCase()}] ${item.title}: ${item.detail}`);
    });
    lines.push("");
  }
  const hasRecommendations = Boolean(recommendations && typeof recommendations === "object");
  const recommendationItems = Array.isArray(recommendations?.candidates) ? recommendations.candidates.slice(0, 5) : [];
  if (hasRecommendations) {
    lines.push("## Recommended Assets", "");
    if (recommendationItems.length === 0) {
      lines.push("_No extra candidates right now._");
    } else {
      recommendationItems.forEach((item, index) => {
        const asset = item?.asset ?? {};
        lines.push(
          `- ${index + 1}. ${asset.title || asset.file_name || asset.id || "Asset"} ` +
            `(score ${Number(item?.score ?? 0)})`
        );
        if (item?.matched_section_title) {
          lines.push(`  - Best For: ${item.matched_section_title}${item?.matched_segment_id ? ` (${item.matched_segment_id})` : ""}`);
        }
        if (item?.reason_summary) {
          lines.push(`  - Why: ${item.reason_summary}`);
        }
        if (Array.isArray(item?.reasons) && item.reasons.length > 0) {
          lines.push(`  - Signals: ${item.reasons.map((reason) => formatRecommendationReasonLabel(reason)).filter(Boolean).join(", ")}`);
        }
        if (asset?.source_url) {
          lines.push(`  - Source: ${asset.source_url}`);
        }
      });
    }
    lines.push("");
  }
  const segmentResearchItems = Array.isArray(researchBriefs?.items) ? researchBriefs.items : [];
  if (segmentResearchItems.length > 0) {
    lines.push("## Segment Research Briefs", "");
    segmentResearchItems.slice(0, 8).forEach((item, index) => {
      const heading = item?.section_title || item?.segment_id || `segment_${index + 1}`;
      lines.push(`### ${index + 1}. ${heading}`);
      const briefItems = Array.isArray(item?.brief?.items) ? item.brief.items : [];
      if (briefItems.length === 0) {
        lines.push(`- ${item?.brief?.summary || "No brief available."}`);
      } else {
        if (item?.is_pinned && item?.pinned_run_id) {
          lines.push(`- Pinned Run: ${item.pinned_run_id}`);
        }
        if (item?.current_pair?.label) {
          lines.push(`- Current Pair: ${item.current_pair.label}`);
          if (item?.current_pair?.hint) lines.push(`- Pair Drift: ${item.current_pair.hint}`);
          if (item?.current_pair?.source) lines.push(`- Current Source: ${item.current_pair.source}`);
          if (item?.current_pair?.visual) lines.push(`- Current Visual: ${item.current_pair.visual}`);
        }
        [item?.main_source, item?.main_visual, item?.backup_source, item?.backup_visual]
          .filter(Boolean)
          .forEach((briefItem) => {
            lines.push(`- ${briefItem.label}: ${briefItem.title}`);
          });
      }
      lines.push("");
    });
  }
  lines.push("## Rundown", "");
  const items = Array.isArray(release?.assets) ? release.assets : [];
  if (items.length === 0) {
    lines.push("_Empty_");
    return `${lines.join("\n")}\n`;
  }
  items.forEach((item, index) => {
    const asset = item?.asset ?? {};
    const attachment = item?.attachment ?? {};
    const sortOrder = Number(attachment.sort_order ?? 0) || index + 1;
    lines.push(`### ${sortOrder}. ${asset.title || asset.file_name || asset.id || "Asset"}`);
    lines.push(`- Kind: ${asset.kind || ""}`);
    lines.push(`- Item Status: ${attachment.item_status || "planned"}`);
    lines.push(`- Asset Status: ${asset.status || ""}`);
    lines.push(`- Section: ${asset?.meta_json?.section_title || ""}`);
    lines.push(`- Source: ${asset.source_url || asset.local_path || asset.id || ""}`);
    lines.push(`- Role: ${attachment.role || ""}`);
    if (attachment.script_note) lines.push(`- Script Note: ${attachment.script_note}`);
    if (attachment.visual_note) lines.push(`- Visual Note: ${attachment.visual_note}`);
    const confidenceSignals = deriveAssistantConfidenceSignals(attachment);
    if (confidenceSignals.length > 0) {
      lines.push(`- Confidence: ${confidenceSignals.join(", ")}`);
    }
    if (attachment?.assistant_trace_json?.script?.section_title || attachment?.assistant_trace_json?.script?.title) {
      lines.push(
        `- Script Trace: ${
          attachment.assistant_trace_json.script.section_title ||
          attachment.assistant_trace_json.script.title
        }${attachment?.assistant_trace_json?.script?.title ? ` · ${attachment.assistant_trace_json.script.title}` : ""}`
      );
    }
    if (attachment?.assistant_trace_json?.visual?.title || attachment?.assistant_trace_json?.visual?.section_title) {
      lines.push(
        `- Visual Trace: ${
          attachment.assistant_trace_json.visual.title ||
          attachment.assistant_trace_json.visual.section_title
        }${
          attachment?.assistant_trace_json?.visual?.recommendation?.matched_section_title
            ? ` · best for ${attachment.assistant_trace_json.visual.recommendation.matched_section_title}`
            : ""
        }`
      );
    }
    if (asset.description) lines.push(`- Description: ${asset.description}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function hasVisualDecisionContent(decision) {
  if (!decision || typeof decision !== "object") return false;
  if (String(decision.description ?? "").trim()) return true;
  if (String(decision.format_hint ?? "").trim()) return true;
  if (String(decision.priority ?? "").trim()) return true;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return true;
  if (String(decision.media_file_path ?? "").trim()) return true;
  if (Array.isArray(decision.media_file_paths) && decision.media_file_paths.some((item) => String(item ?? "").trim())) {
    return true;
  }
  return String(decision.type ?? "").trim() && String(decision.type ?? "").trim() !== "no_visual";
}

async function buildReleaseAssistantPass({
  release,
  listAssets,
  summarizeReleaseAssistant = null,
  listReleaseItemsByGap = null,
  listDocSegments,
  listDocDecisions,
  listDocSegmentsWithoutVisual,
  listOrphanScreenshotsForRelease,
  getDocDir,
  readOptionalJson,
  normalizeVisualDecisionInput
}) {
  const items = Array.isArray(release?.assets) ? release.assets : [];
  const summary =
    (typeof summarizeReleaseAssistant === "function" ? await summarizeReleaseAssistant(release?.id) : null) ?? {
      total: items.length,
      ready: 0,
      in_progress: 0,
      missing_script: 0,
      missing_visual: 0,
      needs_link: 0,
      screenshots: 0,
      orphan_screenshots: 0,
      segments_without_visual: 0
    };

  if (!(typeof summarizeReleaseAssistant === "function" && summary && Number.isFinite(Number(summary.total)))) {
    items.forEach((item) => {
      const attachment = item?.attachment ?? {};
      const asset = item?.asset ?? {};
      const itemStatus = String(attachment.item_status ?? "planned");
      const assetKind = String(asset.kind ?? "").trim().toLowerCase();
      const hasScript = Boolean(String(attachment.script_note ?? "").trim());
      const hasVisual = Boolean(String(attachment.visual_note ?? "").trim());
      const hasLink = Boolean(String(asset.source_url ?? "").trim());
      if (itemStatus === "ready" || itemStatus === "done") summary.ready += 1;
      if (!["ready", "done", "skipped"].includes(itemStatus)) summary.in_progress += 1;
      if (!hasScript) summary.missing_script += 1;
      if (!hasVisual) summary.missing_visual += 1;
      if (!hasLink) summary.needs_link += 1;
      if (assetKind === "screenshot") summary.screenshots += 1;
    });
  }

  const releaseAssetIds = new Set(items.map((item) => String(item?.asset?.id ?? "")).filter(Boolean));
  const documentId = String(release?.document_id ?? "").trim();
  const itemsWithoutScript =
    typeof listReleaseItemsByGap === "function"
      ? await listReleaseItemsByGap(release?.id, "missing_script", 20)
      : items
          .filter((item) => !String(item?.attachment?.script_note ?? "").trim())
          .slice(0, 20)
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
  const itemsWithoutVisual =
    typeof listReleaseItemsByGap === "function"
      ? await listReleaseItemsByGap(release?.id, "missing_visual", 20)
      : items
          .filter((item) => !String(item?.attachment?.visual_note ?? "").trim())
          .slice(0, 20)
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
  const itemsWithoutLink =
    typeof listReleaseItemsByGap === "function"
      ? await listReleaseItemsByGap(release?.id, "needs_link", 20)
      : items
          .filter((item) => !String(item?.asset?.source_url ?? "").trim())
          .slice(0, 20)
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
  const orphanScreenshots =
    typeof listOrphanScreenshotsForRelease === "function"
      ? await listOrphanScreenshotsForRelease(release?.id, documentId, 20)
      : (await listAssets({ kind: "screenshot", limit: 1000 })).filter((asset) => {
          const assetId = String(asset?.id ?? "").trim();
          if (!assetId || releaseAssetIds.has(assetId)) return false;
          const targets = Array.isArray(asset?.targets) ? asset.targets : [];
          if (
            targets.some(
              (target) => target?.target_type === "release" && String(target?.target_id ?? "") === String(release?.id ?? "")
            )
          ) {
            return false;
          }
          if (!documentId) return true;
          return targets.some(
            (target) =>
              (target?.target_type === "document" && String(target?.target_id ?? "") === documentId) ||
              target?.target_type === "segment"
          );
        });
  summary.orphan_screenshots = orphanScreenshots.length;

  const segmentsWithoutVisual = [];
  if (documentId && typeof listDocSegmentsWithoutVisual === "function") {
    segmentsWithoutVisual.push(...(await listDocSegmentsWithoutVisual(documentId, 20)));
  } else if (
    documentId &&
    (
      (typeof listDocSegments === "function" && typeof listDocDecisions === "function") ||
      (typeof getDocDir === "function" && typeof readOptionalJson === "function")
    )
  ) {
    const { segments, decisions } = await loadReleaseDocumentContext({
      documentId,
      listDocSegments,
      listDocDecisions,
      getDocDir,
      readOptionalJson
    });
    const decisionMap = new Map(
      (Array.isArray(decisions) ? decisions : []).map((item) => [
        String(item?.segment_id ?? ""),
        normalizeVisualDecisionInput(item?.visual_decision)
      ])
    );
    (Array.isArray(segments) ? segments : []).forEach((segment) => {
      const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
      const segmentId = String(segment?.segment_id ?? "").trim();
      if (!segmentId || blockType === "links" || /^comments_/i.test(segmentId)) return;
      const visual = decisionMap.get(segmentId) ?? normalizeVisualDecisionInput(segment?.visual_decision);
      if (hasVisualDecisionContent(visual)) return;
      const links = Array.isArray(segment?.links) ? segment.links.filter((item) => String(item?.url ?? item ?? "").trim()) : [];
      segmentsWithoutVisual.push({
        segment_id: segmentId,
        section_title: String(segment?.section_title ?? "").trim(),
        has_links: links.length > 0
      });
    });
  }
  summary.segments_without_visual = segmentsWithoutVisual.length;

  const findings = [];
  if (summary.missing_visual > 0) {
    findings.push({
      key: "missing_visual",
      severity: "high",
      count: summary.missing_visual,
      title: `${summary.missing_visual} item without visual note`,
      detail: "Release still has items without visual instructions."
    });
  }
  if (summary.missing_script > 0) {
    findings.push({
      key: "missing_script",
      severity: "high",
      count: summary.missing_script,
      title: `${summary.missing_script} item without script note`,
      detail: "Some items still have no script/editor note."
    });
  }
  if (summary.needs_link > 0) {
    findings.push({
      key: "needs_link",
      severity: "medium",
      count: summary.needs_link,
      title: `${summary.needs_link} item without source link`,
      detail: "These items are harder to re-check or capture."
    });
  }
  if (summary.segments_without_visual > 0) {
    findings.push({
      key: "segments_visual_gap",
      severity: "medium",
      count: summary.segments_without_visual,
      title: `${summary.segments_without_visual} segments without visual`,
      detail: "Current document still has segments with no visual coverage."
    });
  }
  if (summary.orphan_screenshots > 0) {
    findings.push({
      key: "orphan_screenshots",
      severity: "low",
      count: summary.orphan_screenshots,
      title: `${summary.orphan_screenshots} screenshot assets outside release`,
      detail: "There are captured screenshots that can be attached to this release."
    });
  }
  if (findings.length === 0 && summary.total > 0) {
    findings.push({
      key: "all_good",
      severity: "ok",
      count: 0,
      title: "No obvious release gaps found",
      detail: "Release looks consistent by current rules."
    });
  }

  return {
    summary,
    findings,
    items_without_script: itemsWithoutScript,
    items_without_visual: itemsWithoutVisual,
    items_without_link: itemsWithoutLink,
    orphan_screenshots: orphanScreenshots.slice(0, 20),
    segments_without_visual: segmentsWithoutVisual.slice(0, 20)
  };
}

async function buildReleaseRecommendations({
  release,
  listAssets,
  listRecommendationCandidatesForRelease = null,
  assistantPass = null,
  researchBriefs = null,
  releaseOutcomeMemory = null,
  sourceMemory = null
}) {
  const items = Array.isArray(release?.assets) ? release.assets : [];
  const releaseAssetIds = new Set(items.map((item) => String(item?.asset?.id ?? "")).filter(Boolean));
  const documentId = String(release?.document_id ?? "").trim();
  const releaseSectionTitles = new Set();
  const releaseDomains = new Set();
  const referenceTokens = extractRecommendationTokens(release?.title, release?.notes);
  const missingVisualFocus =
    Number(assistantPass?.summary?.missing_visual ?? 0) > 0 ||
    Number(assistantPass?.summary?.segments_without_visual ?? 0) > 0;
  const researchSignals = extractResearchBriefSignals(researchBriefs);
  const releaseOutcomeSignals = buildReleaseOutcomeSignals(releaseOutcomeMemory);
  const sourceMemorySignals = buildSourceMemorySignals(sourceMemory);

  items.forEach((item) => {
    const asset = item?.asset ?? {};
    const sectionTitle = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
    if (sectionTitle) releaseSectionTitles.add(sectionTitle);
    const sourceDomain = String(asset?.source_domain ?? "").trim().toLowerCase() || extractDomainFromValue(asset?.source_url);
    if (sourceDomain) releaseDomains.add(sourceDomain);
    extractRecommendationTokens(
      asset?.title,
      asset?.description,
      asset?.meta_json?.section_title,
      asset?.source_domain
    ).forEach((token) => referenceTokens.add(token));
  });

  (Array.isArray(assistantPass?.segments_without_visual) ? assistantPass.segments_without_visual : []).forEach((segment) => {
    const sectionTitle = String(segment?.section_title ?? "").trim().toLowerCase();
    if (sectionTitle) releaseSectionTitles.add(sectionTitle);
    extractRecommendationTokens(segment?.section_title, segment?.segment_id).forEach((token) => referenceTokens.add(token));
  });

  const allAssets =
    typeof listRecommendationCandidatesForRelease === "function"
      ? await listRecommendationCandidatesForRelease(release?.id, documentId, {
          limit: 400,
          section_titles: [...releaseSectionTitles],
          domains: [...releaseDomains]
        })
      : await listAssets({ limit: 1000 });

  const candidates = [];
  allAssets.forEach((asset) => {
    const assetId = String(asset?.id ?? "").trim();
    if (!assetId || releaseAssetIds.has(assetId)) return;
    const status = String(asset?.status ?? "").trim().toLowerCase();
    if (status === "archived" || status === "failed") return;

    const assetKind = String(asset?.kind ?? "").trim().toLowerCase();
    const targets = Array.isArray(asset?.targets) ? asset.targets : [];
    const sectionTitle = String(asset?.meta_json?.section_title ?? "").trim();
    const sectionKey = sectionTitle.toLowerCase();
    const sourceDomain = String(asset?.source_domain ?? "").trim().toLowerCase() || extractDomainFromValue(asset?.source_url);
    const overlap = countTokenOverlap(
      referenceTokens,
      asset?.title,
      asset?.description,
      sectionTitle,
      asset?.author,
      sourceDomain
    );
    const researchOverlap = countTokenOverlap(
      researchSignals.allTokens,
      asset?.title,
      asset?.description,
      sectionTitle,
      asset?.author,
      sourceDomain
    );
    const researchVisualOverlap = countTokenOverlap(
      researchSignals.visualTokens,
      asset?.title,
      asset?.description,
      sectionTitle,
      sourceDomain
    );
    const researchSourceOverlap = countTokenOverlap(
      researchSignals.sourceTokens,
      asset?.title,
      asset?.description,
      sectionTitle,
      sourceDomain
    );
    const releaseOutcome = scoreReleaseOutcomeCandidate(asset, releaseOutcomeSignals);
    const sourceMemoryCandidate = scoreSourceMemoryCandidate(asset, sourceMemorySignals);
    const matchedBrief = findBestResearchBriefMatchForAsset(asset, researchBriefs);

    let score = 0;
    const reasons = [];

    if (
      documentId &&
      targets.some(
        (target) =>
          (target?.target_type === "document" && String(target?.target_id ?? "") === documentId) ||
          target?.target_type === "segment"
      )
    ) {
      score += 42;
      reasons.push({ key: "doc_context", label: "same document context" });
    }
    if (sectionKey && releaseSectionTitles.has(sectionKey)) {
      score += 26;
      reasons.push({ key: "same_section", label: `same section: ${sectionTitle}` });
    }
    if (sourceDomain && releaseDomains.has(sourceDomain)) {
      score += 14;
      reasons.push({ key: "same_domain", label: `same source domain: ${sourceDomain}` });
    }
    if (overlap > 0) {
      score += Math.min(18, overlap * 4);
      reasons.push({ key: "token_overlap", label: `${overlap} shared keyword${overlap > 1 ? "s" : ""}` });
    }
    if (sourceDomain && researchSignals.domains.has(sourceDomain)) {
      score += 18;
      reasons.push({ key: "research_domain", label: `matches research domain: ${sourceDomain}` });
    }
    if (researchOverlap > 0) {
      score += Math.min(20, researchOverlap * 5);
      reasons.push({ key: "research_overlap", label: `${researchOverlap} research brief match${researchOverlap > 1 ? "es" : ""}` });
    }
    if (researchVisualOverlap > 0 && ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(assetKind)) {
      score += Math.min(18, researchVisualOverlap * 6);
      reasons.push({ key: "research_visual", label: "fits visual brief" });
    }
    if (researchSourceOverlap > 0 && ["link", "note", "preview"].includes(assetKind)) {
      score += Math.min(14, researchSourceOverlap * 4);
      reasons.push({ key: "research_source", label: "fits source brief" });
    }
    if (sourceDomain && researchSignals.visualDomains.has(sourceDomain) && ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(assetKind)) {
      score += 10;
      reasons.push({ key: "research_visual_domain", label: "same domain as best visual" });
    }
    if (sourceDomain && researchSignals.sourceDomains.has(sourceDomain) && ["link", "note", "preview"].includes(assetKind)) {
      score += 8;
      reasons.push({ key: "research_source_domain", label: "same domain as best source" });
    }
    if (matchedBrief?.section_title) {
      score += matchedBrief.match_type === "token" ? Math.min(10, Number(matchedBrief.overlap ?? 0) * 2) : 12;
      reasons.push({
        key: "matched_segment",
        label: `best for ${matchedBrief.section_title}`
      });
    }
    if (releaseOutcome.bonus > 0) {
      score += releaseOutcome.bonus;
      reasons.unshift(...[...releaseOutcome.reasons].reverse());
    }
    if (sourceMemoryCandidate.bonus > 0) {
      score += sourceMemoryCandidate.bonus;
      reasons.unshift(...[...sourceMemoryCandidate.reasons].reverse());
    }
    if (missingVisualFocus && ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(assetKind)) {
      score += 12;
      reasons.push({ key: "visual_candidate", label: "good visual candidate" });
    }
    if (assetKind === "screenshot") {
      score += 8;
      reasons.push({ key: "screenshot", label: "already captured screenshot" });
    }
    if (asset?.source_url) {
      score += 4;
      reasons.push({ key: "source_link", label: "has source link" });
    }
    if (["processed", "attached"].includes(String(asset?.processing_state ?? "").trim().toLowerCase())) {
      score += 4;
      reasons.push({ key: "ready_state", label: "already processed" });
    }
    if (targets.some((target) => target?.target_type === "release")) {
      score -= 6;
      reasons.push({ key: "reused_release", label: "already used in another release" });
    }

    if (score < 18) return;
    const bucket = score >= 60 ? "strong" : score >= 35 ? "good" : "possible";
    candidates.push({
      bucket,
      score,
      overlap,
      matched_segment_id: String(matchedBrief?.segment_id ?? ""),
      matched_section_title: String(matchedBrief?.section_title ?? ""),
      matched_overlap: Number(matchedBrief?.overlap ?? 0),
      matched_by: String(matchedBrief?.match_type ?? ""),
      reason_summary: summarizeRecommendationReason(reasons),
      reasons: reasons.slice(0, 5),
      asset
    });
  });

  candidates.sort((a, b) => {
    const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b?.asset?.updated_at ?? "").localeCompare(String(a?.asset?.updated_at ?? ""));
  });

  const trimmed = candidates.slice(0, 12);
  const summary = {
    total_candidates: trimmed.length,
    strong: trimmed.filter((item) => item.bucket === "strong").length,
    good: trimmed.filter((item) => item.bucket === "good").length,
    possible: trimmed.filter((item) => item.bucket === "possible").length,
    missing_visual_focus: missingVisualFocus ? 1 : 0
  };

  return {
    summary,
    candidates: trimmed
  };
}

function buildReleaseDraftPack({ release, recommendations = null, researchBriefs = null }) {
  const items = Array.isArray(release?.assets) ? release.assets : [];
  const recommendationCandidates = Array.isArray(recommendations?.candidates) ? recommendations.candidates : [];
  const suggestionItems = items.map((item, index) => {
    const asset = item?.asset ?? {};
    const attachment = item?.attachment ?? {};
    const researchBrief = findResearchBriefForReleaseItem(researchBriefs, item);
    const sortOrder = Number(attachment?.sort_order ?? 0) || index + 1;
    const needsScript = !String(attachment?.script_note ?? "").trim();
    const needsVisual = !String(attachment?.visual_note ?? "").trim();
    const recommendation = needsVisual ? recommendationCandidates[0] ?? null : null;
    return {
      asset_id: String(asset?.id ?? ""),
      attachment_id: String(attachment?.id ?? ""),
      sort_order: sortOrder,
      title: String(asset?.title || asset?.file_name || asset?.id || "Asset"),
      needs_script: needsScript,
      needs_visual: needsVisual,
      suggested_script_note: needsScript ? buildDraftScriptSuggestion(asset, attachment, researchBrief) : "",
      suggested_visual_note: needsVisual ? buildDraftVisualSuggestion(asset, recommendation, researchBrief) : "",
      recommended_asset_id: String(recommendation?.asset?.id ?? ""),
      recommended_asset_title: String(recommendation?.asset?.title || recommendation?.asset?.id || ""),
      research_segment_id: String(researchBrief?.segment_id ?? ""),
      research_section_title: String(researchBrief?.section_title ?? ""),
      trace_preview: buildAssistantTracePatch({
        existingTrace: attachment?.assistant_trace_json,
        researchBrief,
        recommendation,
        scriptNote: needsScript ? buildDraftScriptSuggestion(asset, attachment, researchBrief) : "",
        visualNote: needsVisual ? buildDraftVisualSuggestion(asset, recommendation, researchBrief) : "",
        action: "draft_pack",
        includeScript: needsScript,
        includeVisual: needsVisual
      })
    };
  });

  return {
    summary: {
      total: suggestionItems.length,
      script_candidates: suggestionItems.filter((item) => item.needs_script).length,
      visual_candidates: suggestionItems.filter((item) => item.needs_visual).length
    },
    items: suggestionItems
  };
}

function scoreRecommendationForReleaseItem(item, recommendation, researchBrief = null, sourceMemorySignals = null) {
  const asset = item?.asset ?? {};
  const attachment = item?.attachment ?? {};
  const candidateAsset = recommendation?.asset ?? {};
  const itemSection = String(asset?.meta_json?.section_title ?? "").trim().toLowerCase();
  const candidateSection = String(candidateAsset?.meta_json?.section_title ?? "").trim().toLowerCase();
  const itemDomain = String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim().toLowerCase();
  const candidateDomain = String(candidateAsset?.source_domain || extractDomainFromValue(candidateAsset?.source_url))
    .trim()
    .toLowerCase();
  const itemKind = String(asset?.kind ?? "").trim().toLowerCase();
  const candidateKind = String(candidateAsset?.kind ?? "").trim().toLowerCase();
  const sourceBrief = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
  const visualBrief = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
  const sourceBriefDomain = String(sourceBrief?.domain ?? "").trim().toLowerCase();
  const visualBriefDomain = String(visualBrief?.domain ?? "").trim().toLowerCase();
  const sourceBriefOverlap = countTokenOverlap(
    extractRecommendationTokens(sourceBrief?.title, sourceBrief?.label, sourceBrief?.reason),
    candidateAsset?.title,
    candidateAsset?.description,
    candidateAsset?.meta_json?.section_title,
    candidateAsset?.source_domain
  );
  const visualBriefOverlap = countTokenOverlap(
    extractRecommendationTokens(visualBrief?.title, visualBrief?.label, visualBrief?.reason),
    candidateAsset?.title,
    candidateAsset?.description,
    candidateAsset?.meta_json?.section_title,
    candidateAsset?.source_domain
  );
  const tokenOverlap = countTokenOverlap(
    extractRecommendationTokens(
      asset?.title,
      asset?.description,
      asset?.meta_json?.section_title,
      asset?.source_domain,
      attachment?.script_note,
      attachment?.visual_note
    ),
    candidateAsset?.title,
    candidateAsset?.description,
    candidateAsset?.meta_json?.section_title,
    candidateAsset?.source_domain
  );
  const sourceMemoryCandidate = scoreSourceMemoryCandidate(candidateAsset, sourceMemorySignals);

  let score = Number(recommendation?.score ?? 0);
  if (itemSection && candidateSection && itemSection === candidateSection) score += 40;
  if (itemDomain && candidateDomain && itemDomain === candidateDomain) score += 22;
  if (tokenOverlap > 0) score += Math.min(25, tokenOverlap * 6);
  if (["screenshot", "telegram_media", "downloaded_media", "preview"].includes(candidateKind)) score += 12;
  if (itemKind === "link" && candidateKind === "screenshot") score += 10;
  if (itemKind === "link" && ["telegram_media", "downloaded_media"].includes(candidateKind)) score += 8;
  if (visualBriefDomain && candidateDomain && visualBriefDomain === candidateDomain) score += 24;
  if (sourceBriefDomain && candidateDomain && sourceBriefDomain === candidateDomain) score += 12;
  if (visualBriefOverlap > 0 && ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(candidateKind)) {
    score += Math.min(28, visualBriefOverlap * 8);
  }
  if (sourceBriefOverlap > 0 && ["link", "preview", "note"].includes(candidateKind)) {
    score += Math.min(18, sourceBriefOverlap * 6);
  }
  if (sourceMemoryCandidate.bonus > 0) {
    score += Math.min(20, sourceMemoryCandidate.bonus);
  }
  if (
    sourceMemoryCandidate.helpful_count > 0 &&
    candidateDomain &&
    [itemDomain, visualBriefDomain, sourceBriefDomain].filter(Boolean).includes(candidateDomain)
  ) {
    score += 12;
  }
  return score;
}

async function pickRecommendationForReleaseItem({
  release = null,
  item,
  candidates = [],
  usedAssetIds = new Set(),
  researchBrief = null,
  listRecommendationCandidatesForItem = null,
  sourceMemory = null,
  mode = "visual"
}) {
  let scopedCandidates = Array.isArray(candidates) ? candidates : [];
  const sourceMemorySignals = buildSourceMemorySignals(sourceMemory);
  if (typeof listRecommendationCandidatesForItem === "function") {
    const asset = item?.asset ?? {};
    const sourceBrief = findResearchBriefItemByRole(researchBrief, ["main_source", "backup_source", "reference"], ["source"]);
    const visualBrief = findResearchBriefItemByRole(researchBrief, ["visual_candidate"], ["visual", "download"]);
    const researchEntry = mode === "source" ? sourceBrief : visualBrief ?? sourceBrief;
    const researchItems = Array.isArray(researchBrief?.brief?.items)
      ? researchBrief.brief.items
      : Array.isArray(researchBrief?.items)
        ? researchBrief.items
        : [];
    const sectionTitle =
      String(asset?.meta_json?.section_title ?? "").trim() || String(researchBrief?.section_title ?? "").trim();
    const domains = Array.from(
      new Set(
        [
          String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim().toLowerCase(),
          ...((Array.isArray(researchBrief?.items) ? researchBrief.items : [])
            .map((entry) => String(entry?.domain ?? "").trim().toLowerCase())
            .filter(Boolean))
        ].filter(Boolean)
      )
    );
    const researchDomains = Array.from(
      new Set(
        [
          String(researchEntry?.domain ?? "").trim().toLowerCase(),
          ...(researchItems
            .filter((entry) => (mode === "source" ? String(entry?.key ?? "").trim().toLowerCase() === "source" : true))
            .map((entry) => String(entry?.domain ?? "").trim().toLowerCase())
            .filter(Boolean))
        ].filter(Boolean)
      )
    );
    const researchTitles = Array.from(
      new Set(
        [
          String(researchEntry?.title ?? "").trim().toLowerCase(),
          String(researchEntry?.label ?? "").trim().toLowerCase()
        ].filter(Boolean)
      )
    );
    try {
      const narrowedAssets = await listRecommendationCandidatesForItem(release?.id, release?.document_id, {
        section_title: sectionTitle,
        domains,
        research_domains: researchDomains,
        research_titles: researchTitles,
        mode,
        limit: 80
      });
      const narrowedIds = new Set(
        (Array.isArray(narrowedAssets) ? narrowedAssets : [])
          .map((candidateAsset) => String(candidateAsset?.id ?? "").trim())
          .filter(Boolean)
      );
      const narrowedCandidates = scopedCandidates.filter((candidate) =>
        narrowedIds.has(String(candidate?.asset?.id ?? "").trim())
      );
      if (narrowedCandidates.length > 0) {
        scopedCandidates = narrowedCandidates;
      }
    } catch {
      // fallback to the current in-memory candidate list
    }
  }
  let best = null;
  scopedCandidates.forEach((candidate) => {
    const assetId = String(candidate?.asset?.id ?? "").trim();
    if (!assetId || usedAssetIds.has(assetId)) return;
    const score = scoreRecommendationForReleaseItem(item, candidate, researchBrief, sourceMemorySignals);
    if (!best || score > best.score) {
      best = {
        candidate,
        score
      };
    }
  });
  return best?.candidate ?? null;
}

function normalizeAttachmentIdList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
}

function buildAssistantGapPriorityMap(assistantPass = null) {
  const priority = new Map();
  const add = (items = [], weight = 1) => {
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return;
      const current = priority.get(attachmentId) ?? 0;
      priority.set(attachmentId, current + weight + Math.max(0, 10 - index));
    });
  };
  add(assistantPass?.items_without_visual, 50);
  add(assistantPass?.items_without_script, 35);
  add(assistantPass?.items_without_link, 20);
  return priority;
}

function buildHandoffPriorityMap(mediaPackage = null) {
  const priority = new Map();
  const add = (items = [], weight = 1) => {
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId) return;
      const current = priority.get(attachmentId) ?? 0;
      priority.set(attachmentId, current + weight + Math.max(0, 10 - index));
    });
  };
  const steps = Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : [];
  add(steps.filter((item) => resolveHandoffReadyState(item) === "download_needed"), 70);
  add(steps.filter((item) => resolveHandoffReadyState(item) === "capture_needed"), 55);
  add(steps.filter((item) => String(item?.target ?? "").trim().toLowerCase() === "picked_visual"), 15);
  return priority;
}

function prioritizeReleaseItemsByAssistantPass(items = [], assistantPass = null, mediaPackage = null) {
  const priorityMap = buildAssistantGapPriorityMap(assistantPass);
  const handoffPriorityMap = buildHandoffPriorityMap(mediaPackage);
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftId = String(left?.attachment?.id ?? "").trim();
    const rightId = String(right?.attachment?.id ?? "").trim();
    const leftScore = (priorityMap.get(leftId) ?? 0) + (handoffPriorityMap.get(leftId) ?? 0);
    const rightScore = (priorityMap.get(rightId) ?? 0) + (handoffPriorityMap.get(rightId) ?? 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return Number(left?.attachment?.sort_order ?? 0) - Number(right?.attachment?.sort_order ?? 0);
  });
}

function selectReleaseItemsByAttachmentIds(release, attachmentIds = []) {
  const allowedIds = new Set(normalizeAttachmentIdList(attachmentIds));
  if (allowedIds.size === 0) return [];
  const items = Array.isArray(release?.assets) ? release.assets : [];
  return items.filter((item) => allowedIds.has(String(item?.attachment?.id ?? "").trim()));
}

export function registerIntegrationRoutes(app, deps) {
  const {
    attachAsset,
    appendActivity,
    createAsset,
    createRelease,
    getAssetIndexed,
    getAsset,
    getDocumentState,
    getDocDir,
    getOverviewIndexed,
    getOverview,
    getReleaseOutcomeMemory,
    getSourceMemory,
    getReleaseIndexed,
    getRelease,
    listAssets,
    listAssetsIndexed,
    listDocSegments,
    listDocDecisions,
    listDocSegmentsWithoutVisual,
    listOrphanScreenshotsForRelease,
    listRecommendationCandidatesForRelease,
    listRecommendationCandidatesForItem,
    summarizeReleaseAssistant,
    listReleaseItemsByGap,
    listResearchRuns,
    listBotSessionsIndexed,
    listBotSessions,
    listJobsIndexed,
    listReleaseActivitiesIndexed,
    listReleaseActivities,
    listReleasesIndexed,
    listReleases,
    getDocumentMediaDownloads,
    normalizeDocumentMediaDownloads,
    normalizeVisualDecisionInput,
    readOptionalJson,
    createRuntimeBackup,
    getRuntimeBackupsStatus,
    getRuntimeBackupById,
    dryRunRuntimeBackupRestore,
    restoreRuntimeBackup,
    recordReleaseOutcome,
    reindexSqliteMirror,
    removeAttachment,
    reorderReleaseAttachments,
    getSqliteMirrorStatus,
    updateAttachment,
    updateAsset,
    updateRelease,
    upsertBotSession
  } = deps;

  async function loadReleaseOutcomeMemorySafe() {
    if (typeof getReleaseOutcomeMemory !== "function") return null;
    try {
      return await getReleaseOutcomeMemory();
    } catch {
      return null;
    }
  }

  async function loadSourceMemorySafe() {
    if (typeof getSourceMemory !== "function") return null;
    try {
      return await getSourceMemory();
    } catch {
      return null;
    }
  }

  async function loadReleaseSafe(releaseId) {
    if (typeof getReleaseIndexed === "function") {
      return getReleaseIndexed(releaseId);
    }
    return getRelease(releaseId);
  }

  async function loadAssetSafe(assetId) {
    if (typeof getAssetIndexed === "function") {
      return getAssetIndexed(assetId);
    }
    return getAsset(assetId);
  }

  async function listResearchRunsSafe(documentId) {
    return loadReleaseResearchRuns({
      documentId,
      listResearchRuns,
      getDocDir,
      readOptionalJson
    });
  }

  async function computeAssistantPass(release) {
    return buildReleaseAssistantPass({
      release,
      listAssets,
      summarizeReleaseAssistant,
      listReleaseItemsByGap,
      listDocSegments,
      listDocDecisions,
      listDocSegmentsWithoutVisual,
      listOrphanScreenshotsForRelease,
      getDocDir,
      readOptionalJson,
      normalizeVisualDecisionInput
    });
  }

  async function loadDocumentMediaDownloadsSafe(documentId) {
    const normalizedId = String(documentId ?? "").trim();
    if (!normalizedId) return {};
    if (typeof getDocumentMediaDownloads === "function") {
      try {
        const indexed = await getDocumentMediaDownloads(normalizedId);
        if (indexed && typeof indexed === "object") return indexed;
      } catch {
        // fallback below
      }
    }
    const document = await loadReleaseDocumentState({
      documentId: normalizedId,
      getDocumentState,
      getDocDir,
      readOptionalJson
    });
    if (typeof normalizeDocumentMediaDownloads === "function") {
      return normalizeDocumentMediaDownloads(document?.media_downloads);
    }
    return document?.media_downloads && typeof document.media_downloads === "object" ? document.media_downloads : {};
  }

  async function buildReconciledMediaPackage(release, researchBriefs = null) {
    if (!release) return null;
    const shotlist = buildReleaseShotlist(release, researchBriefs);
    const downloadedMap = await loadDocumentMediaDownloadsSafe(release?.document_id);
    return reconcileReleaseMediaPackage(release, buildReleaseMediaPackage(release, shotlist), downloadedMap);
  }

  async function listReleaseActivitiesSafe(releaseId, limit = 120) {
    if (typeof listReleaseActivitiesIndexed === "function") {
      return listReleaseActivitiesIndexed(releaseId, limit);
    }
    if (typeof listReleaseActivities === "function") {
      return listReleaseActivities(releaseId, limit);
    }
    return [];
  }

  function buildHandoffSnapshot(mediaPackage = null) {
    const steps = Array.isArray(mediaPackage?.copy_plan) ? mediaPackage.copy_plan : [];
    return steps.map((item) => ({
      key: [
        String(item?.attachment_id ?? "").trim(),
        String(item?.target ?? "").trim(),
        String(item?.step_type ?? "").trim(),
        String(item?.source_url ?? "").trim(),
        String(item?.path ?? "").trim()
      ].join("::"),
      attachment_id: String(item?.attachment_id ?? "").trim(),
      asset_id: String(item?.asset_id ?? "").trim(),
      title: String(item?.title ?? "").trim(),
      section_title: String(item?.section_title ?? "").trim(),
      target: String(item?.target ?? "").trim(),
      step_type: String(item?.step_type ?? "").trim(),
      ready_state: String(item?.ready_state ?? "").trim(),
      effective_ready_state: String(item?.effective_ready_state ?? item?.ready_state ?? "").trim(),
      picked_from: String(item?.picked_from ?? "").trim(),
      source_url: String(item?.source_url ?? "").trim()
    }));
  }

  async function reconcileReleaseHandoffActivity(release, mediaPackage = null) {
    const releaseId = String(release?.id ?? "").trim();
    if (!releaseId || typeof appendActivity !== "function" || !mediaPackage) return;
    const currentSnapshot = buildHandoffSnapshot(mediaPackage);
    const activities = await listReleaseActivitiesSafe(releaseId, 160);
    const previousSnapshotActivity = (Array.isArray(activities) ? activities : []).find(
      (item) => String(item?.event ?? "").trim() === "handoff_snapshot"
    );
    const previousSnapshot = Array.isArray(previousSnapshotActivity?.meta_json?.snapshot)
      ? previousSnapshotActivity.meta_json.snapshot
      : [];
    const previousByKey = new Map(
      previousSnapshot
        .map((item) => [String(item?.key ?? "").trim(), item])
        .filter(([key]) => Boolean(key))
    );
    const currentSerialized = JSON.stringify(currentSnapshot);
    const previousSerialized = JSON.stringify(previousSnapshot);
    if (currentSerialized === previousSerialized) return;

    for (const item of currentSnapshot) {
      const previous = previousByKey.get(item.key);
      const previousState = String(previous?.effective_ready_state ?? previous?.ready_state ?? "").trim().toLowerCase();
      const baseState = String(item?.ready_state ?? "").trim().toLowerCase();
      const nextState = String(item?.effective_ready_state ?? item?.ready_state ?? "").trim().toLowerCase();
      if (previousState === nextState) continue;
      if ((previousState === "download_needed" || (!previousState && baseState === "download_needed")) && nextState === "downloaded") {
        await logReleaseAssistantActivity(
          releaseId,
          "handoff_download_resolved",
          `${item.title || item.attachment_id || "Item"} moved from download_needed to downloaded`,
          {
            attachment_id: item.attachment_id,
            asset_id: item.asset_id,
            section_title: item.section_title,
            target: item.target,
            previous_state: previousState || baseState,
            next_state: nextState,
            source_url: item.source_url
          }
        );
      }
      if ((previousState === "capture_needed" || (!previousState && baseState === "capture_needed")) && nextState === "captured") {
        await logReleaseAssistantActivity(
          releaseId,
          "handoff_capture_resolved",
          `${item.title || item.attachment_id || "Item"} moved from capture_needed to captured`,
          {
            attachment_id: item.attachment_id,
            asset_id: item.asset_id,
            section_title: item.section_title,
            target: item.target,
            previous_state: previousState || baseState,
            next_state: nextState,
            source_url: item.source_url
          }
        );
      }
    }

    await logReleaseAssistantActivity(releaseId, "handoff_snapshot", "handoff state snapshot refreshed", {
      snapshot: currentSnapshot,
      summary: mediaPackage?.summary ?? {}
    });
  }

  async function buildAndTrackReleaseMediaPackage(release, researchBriefs = null) {
    const mediaPackage = await buildReconciledMediaPackage(release, researchBriefs);
    await reconcileReleaseHandoffActivity(release, mediaPackage);
    return mediaPackage;
  }

  async function createSafetyBackup(label) {
    if (typeof createRuntimeBackup !== "function") return null;
    if (String(process.env.RUNTIME_AUTO_BACKUP_ENABLED ?? "1") === "0") return null;
    try {
      return await createRuntimeBackup({ label });
    } catch {
      return null;
    }
  }

  async function rememberReleaseOutcomeForAsset(release, asset, role, action) {
    await recordReleaseOutcomeSafe(recordReleaseOutcome, {
      release_id: String(release?.id ?? "").trim(),
      asset_id: String(asset?.id ?? "").trim(),
      domain: String(asset?.source_domain || extractDomainFromValue(asset?.source_url)).trim().toLowerCase(),
      kind: String(asset?.kind ?? "").trim().toLowerCase(),
      role: String(role ?? "").trim().toLowerCase(),
      action: String(action ?? "").trim().toLowerCase(),
      title: String(asset?.title || asset?.file_name || asset?.id || "").trim(),
      url: String(asset?.source_url ?? "").trim()
    });
  }

  async function logReleaseAssistantActivity(releaseId, event, detail, meta = {}) {
    if (typeof appendActivity !== "function") return;
    try {
      await appendActivity({
        release_id: String(releaseId ?? "").trim(),
        event: String(event ?? "").trim(),
        detail: String(detail ?? "").trim(),
        meta
      });
    } catch {
      // Ignore activity write failures during assistant flows.
    }
  }

  async function buildReleaseActionState(releaseId) {
    const nextRelease = await loadReleaseSafe(releaseId);
    const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
    const nextSourceMemory = nextRelease ? await loadSourceMemorySafe() : null;
    const nextResearchBriefs = nextRelease
      ? await buildReleaseResearchBriefs({
          release: nextRelease,
          listDocSegments,
          listResearchRuns: listResearchRunsSafe,
          getDocDir,
          readOptionalJson
        })
      : null;
    const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
    const nextRecommendations = nextRelease
      ? await buildReleaseRecommendations({
          release: nextRelease,
          listAssets,
          listRecommendationCandidatesForRelease,
          assistantPass: nextAssistantPass,
          researchBriefs: nextResearchBriefs,
          releaseOutcomeMemory: nextReleaseOutcomeMemory,
          sourceMemory: nextSourceMemory
        })
      : null;
    const nextDraftPack = nextRelease
      ? buildReleaseDraftPack({
          release: nextRelease,
          recommendations: nextRecommendations,
          researchBriefs: nextResearchBriefs
        })
      : null;
    const nextShotlist = nextRelease ? buildReleaseShotlist(nextRelease, nextResearchBriefs) : [];
    const nextMediaPackage = nextRelease ? await buildAndTrackReleaseMediaPackage(nextRelease, nextResearchBriefs) : null;
    const nextPublishChecklist = nextRelease
      ? buildReleasePublishChecklist(nextRelease, nextAssistantPass, nextMediaPackage)
      : null;
    const nextControlPanel =
      nextRelease && nextPublishChecklist
        ? buildReleaseControlPanel(nextRelease, nextAssistantPass, nextPublishChecklist, nextMediaPackage)
        : null;
    const nextBriefingPanel =
      nextRelease && nextControlPanel
        ? buildReleaseBriefingPanel(
            nextRelease,
            nextAssistantPass,
            nextPublishChecklist,
            nextControlPanel,
            nextRecommendations,
            nextMediaPackage
          )
        : null;
    return {
      release: nextRelease,
      assistant_pass: nextAssistantPass,
      recommendations: nextRecommendations,
      draft_pack: nextDraftPack,
      publish_checklist: nextPublishChecklist,
      control_panel: nextControlPanel,
      briefing_panel: nextBriefingPanel,
      research_briefs: nextResearchBriefs,
      media_package: nextMediaPackage
    };
  }

  app.get("/api/integration/overview", async (_req, res) => {
    try {
      if (typeof getOverviewIndexed === "function") {
        return res.json(await getOverviewIndexed());
      }
      res.json(await getOverview());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/integration/sqlite/status", async (_req, res) => {
    try {
      if (typeof getSqliteMirrorStatus !== "function") {
        return res.status(404).json({ error: "sqlite mirror is not configured" });
      }
      res.json({ sqlite: await getSqliteMirrorStatus() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/integration/sqlite/reindex", async (_req, res) => {
    try {
      if (typeof reindexSqliteMirror !== "function") {
        return res.status(404).json({ error: "sqlite mirror is not configured" });
      }
      const auto_backup = await createSafetyBackup("sqlite-reindex");
      res.json({ sqlite: await reindexSqliteMirror(), auto_backup });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/integration/backups/status", async (_req, res) => {
    try {
      if (typeof getRuntimeBackupsStatus !== "function") {
        return res.status(404).json({ error: "runtime backups are not configured" });
      }
      res.json({ backups: await getRuntimeBackupsStatus() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/integration/backups/create", async (req, res) => {
    try {
      if (typeof createRuntimeBackup !== "function") {
        return res.status(404).json({ error: "runtime backups are not configured" });
      }
      const backup = await createRuntimeBackup({ label: req.body?.label });
      res.json({ backup });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/integration/backups/:backupId", async (req, res) => {
    try {
      if (typeof getRuntimeBackupById !== "function") {
        return res.status(404).json({ error: "runtime backups are not configured" });
      }
      const backup = await getRuntimeBackupById(req.params.backupId);
      if (!backup) {
        return res.status(404).json({ error: "Backup not found" });
      }
      res.json({ backup });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/integration/backups/:backupId/restore-dry-run", async (req, res) => {
    try {
      if (typeof dryRunRuntimeBackupRestore !== "function") {
        return res.status(404).json({ error: "runtime backups are not configured" });
      }
      res.json({ dry_run: await dryRunRuntimeBackupRestore(req.params.backupId) });
    } catch (error) {
      if (String(error?.message ?? "").includes("Backup not found")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/integration/backups/:backupId/restore", async (req, res) => {
    try {
      if (typeof restoreRuntimeBackup !== "function" || typeof createRuntimeBackup !== "function") {
        return res.status(404).json({ error: "runtime backups are not configured" });
      }
      const pre_restore_backup = await createRuntimeBackup({ label: `pre-restore-${req.params.backupId}` });
      const restored = await restoreRuntimeBackup(req.params.backupId, {
        pre_restore_backup_id: String(pre_restore_backup?.backup_id ?? "").trim()
      });
      res.json({
        restored,
        pre_restore_backup,
        sqlite: typeof getSqliteMirrorStatus === "function" ? await getSqliteMirrorStatus() : null,
        backups: typeof getRuntimeBackupsStatus === "function" ? await getRuntimeBackupsStatus() : null
      });
    } catch (error) {
      if (String(error?.message ?? "").includes("Backup not found")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/integration/jobs", async (req, res) => {
    try {
      if (typeof listJobsIndexed !== "function") {
        return res.json({ jobs: [] });
      }
      const jobs = await listJobsIndexed({
        status: req.query.status,
        kind: req.query.kind,
        asset_id: req.query.asset_id,
        limit: req.query.limit
      });
      res.json({ jobs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/assets", async (req, res) => {
    try {
      const filters = {
        kind: req.query.kind,
        status: req.query.status,
        q: req.query.q,
        target_type: req.query.target_type,
        target_id: req.query.target_id,
        limit: req.query.limit,
        processing_state: req.query.processing_state,
        inbox_only: req.query.inbox_only
      };
      const assets =
        typeof listAssetsIndexed === "function"
          ? await listAssetsIndexed(filters)
          : await listAssets(filters);
      res.json({ assets });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/assets", async (req, res) => {
    try {
      const asset = await createAsset(req.body ?? {});
      res.status(201).json({ asset });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/assets/:id", async (req, res) => {
    try {
      const asset = await loadAssetSafe(req.params.id);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      res.json({ asset });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/assets/:id", async (req, res) => {
    try {
      const asset = await updateAsset(req.params.id, req.body ?? {});
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      res.json({ asset });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/assets/:id/attachments", async (req, res) => {
    try {
      const attachment = await attachAsset(req.params.id, req.body ?? {});
      if (!attachment) return res.status(404).json({ error: "Asset not found" });
      res.status(201).json({ attachment });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/assets/:id/attachments/:attachmentId", async (req, res) => {
    try {
      const attachment = await removeAttachment(req.params.id, req.params.attachmentId);
      if (!attachment) return res.status(404).json({ error: "Attachment not found" });
      res.json({ attachment });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/assets/:id/attachments/:attachmentId", async (req, res) => {
    try {
      const asset = await loadAssetSafe(req.params.id);
      const existingAttachment = Array.isArray(asset?.attachments)
        ? asset.attachments.find((item) => String(item?.id ?? "") === String(req.params.attachmentId ?? ""))
        : null;
      const patch = { ...(req.body ?? {}) };
      const assistantAction = String(patch?.assistant_action ?? "").trim().toLowerCase();
      const hasScriptPatch = Object.prototype.hasOwnProperty.call(patch, "script_note");
      const hasVisualPatch = Object.prototype.hasOwnProperty.call(patch, "visual_note");
      if (existingAttachment && (hasScriptPatch || hasVisualPatch) && assistantAction === "research_pick") {
        const researchBrief = buildResearchPickBrief(patch?.research_context);
        const action =
          hasScriptPatch && hasVisualPatch
            ? "research_pick"
            : hasVisualPatch
              ? "research_pick_visual"
              : "research_pick_source";
        patch.assistant_trace_json = clearManualOverrideSignals(
          buildAssistantTracePatch({
            existingTrace: existingAttachment?.assistant_trace_json,
            researchBrief,
            scriptNote: hasScriptPatch ? patch?.script_note : existingAttachment?.script_note,
            visualNote: hasVisualPatch ? patch?.visual_note : existingAttachment?.visual_note,
            action,
            includeScript: hasScriptPatch,
            includeVisual: hasVisualPatch
          }),
          { script: hasScriptPatch, visual: hasVisualPatch }
        );
        const changedFields = [];
        if (hasScriptPatch) changedFields.push("script");
        if (hasVisualPatch) changedFields.push("visual");
        patch.activity_event = "research_pick_applied";
        patch.activity_detail = `research pick applied for ${changedFields.join(" + ")} note${changedFields.length > 1 ? "s" : ""}`;
        patch.activity_meta = {
          action,
          fields: changedFields,
          segment_id: String(researchBrief?.segment_id ?? "").trim(),
          section_title: String(researchBrief?.section_title ?? "").trim()
        };
      } else if (existingAttachment && (hasScriptPatch || hasVisualPatch)) {
        const changedFields = buildManualOverrideActivityFields(existingAttachment, patch);
        patch.assistant_trace_json = buildManualOverrideTracePatch(existingAttachment, patch, "manual_edit");
        if (changedFields.length > 0) {
          patch.activity_event = "manual_override";
          patch.activity_detail = `manual override for ${changedFields.join(" + ")} note${changedFields.length > 1 ? "s" : ""}`;
          patch.activity_meta = {
            fields: changedFields,
            action: "manual_edit"
          };
        }
      }
      delete patch.assistant_action;
      delete patch.research_context;
      delete patch.research_mode;
      const attachment = await updateAttachment(req.params.id, req.params.attachmentId, patch);
      if (!attachment) return res.status(404).json({ error: "Attachment not found" });
      res.json({ attachment });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/releases", async (req, res) => {
    try {
      const releases =
        typeof listReleasesIndexed === "function"
          ? await listReleasesIndexed({ status: req.query.status })
          : await listReleases({ status: req.query.status });
      res.json({ releases });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases", async (req, res) => {
    try {
      const release = await createRelease(req.body ?? {});
      res.status(201).json({ release });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      res.json({ release });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/releases/:id", async (req, res) => {
    try {
      const release = await updateRelease(req.params.id, req.body ?? {});
      if (!release) return res.status(404).json({ error: "Release not found" });
      res.json({ release });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/rundown", async (req, res) => {
    try {
      await reorderReleaseAttachments(req.params.id, req.body?.attachment_ids ?? []);
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      res.json({ release });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/export", async (req, res) => {
    try {
      const format = String(req.query?.format ?? "md").toLowerCase();
      if (!["md", "json", "shotlist", "media-package", "copy-plan"].includes(format)) {
        return res.status(400).json({ error: "format must be md, json, shotlist, media-package, or copy-plan" });
      }
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const draftPack = buildReleaseDraftPack({
        release,
        recommendations,
        researchBriefs
      });
      const shotlist = buildReleaseShotlist(release, researchBriefs);
      const publishChecklist = buildReleasePublishChecklist(release, assistantPass, mediaPackage);
      const controlPanel = buildReleaseControlPanel(release, assistantPass, publishChecklist, mediaPackage);
      const briefingPanel = buildReleaseBriefingPanel(
        release,
        assistantPass,
        publishChecklist,
        controlPanel,
        recommendations,
        mediaPackage
      );
      const fileBase = sanitizeExportFileNamePart(release.title || release.id, "release-brief");
      res.setHeader(
        "content-disposition",
        buildReleaseContentDisposition(
          `${fileBase}-${format === "shotlist" ? "shotlist" : format === "media-package" ? "media-package" : format === "copy-plan" ? "copy-plan" : "brief"}`,
          format === "media-package" ? "json" : format
        )
      );
      if (format === "json") {
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.send(
          JSON.stringify(
            {
              release,
              assistant_pass: assistantPass,
              recommendations,
              draft_pack: draftPack,
              publish_checklist: publishChecklist,
              control_panel: controlPanel,
              briefing_panel: briefingPanel,
              research_briefs: researchBriefs,
              shotlist,
              media_package: mediaPackage
            },
            null,
            2
          )
        );
      }
      if (format === "media-package") {
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.send(JSON.stringify(mediaPackage, null, 2));
      }
      if (format === "copy-plan") {
        res.setHeader("content-type", "text/markdown; charset=utf-8");
        return res.send(buildReleaseCopyPlanMarkdown(release, mediaPackage));
      }
      if (format === "shotlist") {
        res.setHeader("content-type", "text/markdown; charset=utf-8");
        return res.send(buildReleaseShotlistMarkdown(release, shotlist));
      }
      res.setHeader("content-type", "text/markdown; charset=utf-8");
      return res.send(
        buildReleaseBriefMarkdown(
          release,
          assistantPass,
          recommendations,
          publishChecklist,
          controlPanel,
          briefingPanel,
          researchBriefs
        )
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/assistant-pass", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistant_pass = await computeAssistantPass(release);
      res.json({ assistant_pass });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/recommendations", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      res.json({ recommendations });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/publish-checklist", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistant_pass = await computeAssistantPass(release);
      const research_briefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const media_package = await buildAndTrackReleaseMediaPackage(release, research_briefs);
      const publish_checklist = buildReleasePublishChecklist(release, assistant_pass, media_package);
      res.json({ publish_checklist });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/control-panel", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistant_pass = await computeAssistantPass(release);
      const research_briefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const media_package = await buildAndTrackReleaseMediaPackage(release, research_briefs);
      const publish_checklist = buildReleasePublishChecklist(release, assistant_pass, media_package);
      const control_panel = buildReleaseControlPanel(
        release,
        assistant_pass,
        publish_checklist,
        media_package
      );
      res.json({ control_panel, publish_checklist });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/briefing", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistant_pass = await computeAssistantPass(release);
      const research_briefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const media_package = await buildAndTrackReleaseMediaPackage(release, research_briefs);
      const publish_checklist = buildReleasePublishChecklist(release, assistant_pass, media_package);
      const control_panel = buildReleaseControlPanel(
        release,
        assistant_pass,
        publish_checklist,
        media_package
      );
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass: assistant_pass,
        researchBriefs: research_briefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const briefing_panel = buildReleaseBriefingPanel(
        release,
        assistant_pass,
        publish_checklist,
        control_panel,
        recommendations,
        media_package
      );
      res.json({ briefing_panel, control_panel, publish_checklist, research_briefs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/draft-pack", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const draft_pack = buildReleaseDraftPack({
        release,
        recommendations,
        researchBriefs
      });
      res.json({ draft_pack });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/releases/:id/activity", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const activity =
        typeof listReleaseActivitiesIndexed === "function"
          ? await listReleaseActivitiesIndexed(req.params.id, req.query?.limit ?? 80)
          : await listReleaseActivities(req.params.id, req.query?.limit ?? 80);
      res.json({ activity });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/attach-orphan-screenshots", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const screenshotAssets = Array.isArray(assistantPass?.orphan_screenshots) ? assistantPass.orphan_screenshots : [];
      let attached = 0;
      for (const asset of screenshotAssets) {
        const created = await attachAsset(asset.id, {
          target_type: "release",
          target_id: release.id,
          role: "visual",
          attached_by: "release_assistant"
        });
        if (created?.id) attached += 1;
      }
      await logReleaseAssistantActivity(
        release.id,
        "attach_orphan_screenshots",
        `assistant attached ${attached} orphan screenshot${attached === 1 ? "" : "s"}`,
        { attached }
      );
      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      res.json({ ok: true, attached, release: nextRelease, assistant_pass: nextAssistantPass });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/attach-recommendations", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const auto_backup = await createSafetyBackup(`attach-recommendations-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const requestedAssetIds = Array.from(
        new Set(
          (Array.isArray(req.body?.asset_ids) ? req.body.asset_ids : [])
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
        )
      );
      const requestedLimit = Number(req.body?.limit ?? 3);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10, requestedLimit)) : 3;
      const recommendationMap = new Map(
        (Array.isArray(recommendations?.candidates) ? recommendations.candidates : [])
          .map((item) => [String(item?.asset?.id ?? "").trim(), item])
          .filter(([assetId]) => Boolean(assetId))
      );
      const picked =
        requestedAssetIds.length > 0
          ? requestedAssetIds
              .map((assetId) => recommendationMap.get(assetId) ?? null)
              .filter(Boolean)
              .slice(0, limit)
          : recommendations.candidates.slice(0, limit);
      if (picked.length === 0) {
        return res.status(400).json({ error: "No selected recommendation candidates" });
      }
      const selected_ids = picked.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean);
      const existingReleaseAssetIds = new Set(
        (Array.isArray(release?.assets) ? release.assets : [])
          .map((item) => String(item?.asset?.id ?? "").trim())
          .filter(Boolean)
      );
      let attached = 0;
      const attached_ids = [];
      const skipped_ids = [];
      const results = [];
      requestedAssetIds
        .filter((assetId) => !selected_ids.includes(assetId))
        .forEach((assetId) => {
          skipped_ids.push(assetId);
          results.push({
            asset_id: assetId,
            status: "skipped",
            reason: "not_available"
          });
        });
      for (const item of picked) {
        const assetId = String(item?.asset?.id ?? "").trim();
        if (!assetId) continue;
        if (existingReleaseAssetIds.has(assetId)) {
          skipped_ids.push(assetId);
          results.push({
            asset_id: assetId,
            status: "skipped",
            reason: "already_attached"
          });
          continue;
        }
        const assetKind = String(item?.asset?.kind ?? "").trim().toLowerCase();
        const created = await attachAsset(assetId, {
          target_type: "release",
          target_id: release.id,
          role: ["screenshot", "telegram_media", "downloaded_media", "preview"].includes(assetKind) ? "visual" : "story",
          attached_by: "release_recommendations",
          note: item?.reason_summary || ""
        });
        if (created?.id) {
          attached += 1;
          attached_ids.push(assetId);
          results.push({
            asset_id: assetId,
            status: "attached",
            attachment_id: String(created?.id ?? "").trim()
          });
          await rememberReleaseOutcomeForAsset(release, item.asset, created.role || req.body?.role || item?.asset?.kind, "attach");
        } else {
          skipped_ids.push(assetId);
          results.push({
            asset_id: assetId,
            status: "skipped",
            reason: "attach_failed"
          });
        }
      }
      await logReleaseAssistantActivity(
        release.id,
        "attach_recommendations",
        `assistant attached ${attached} recommendation${attached === 1 ? "" : "s"}`,
        { attached, asset_ids: attached_ids, skipped_ids, requested_asset_ids: requestedAssetIds }
      );
      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      const nextResearchBriefs = nextRelease
        ? await buildReleaseResearchBriefs({
            release: nextRelease,
            getDocDir,
            readOptionalJson
          })
        : null;
      const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
      const nextRecommendations = nextRelease
        ? await buildReleaseRecommendations({
            release: nextRelease,
            listAssets,
            listRecommendationCandidatesForRelease,
            assistantPass: nextAssistantPass,
            researchBriefs: nextResearchBriefs,
            releaseOutcomeMemory: nextReleaseOutcomeMemory,
            sourceMemory: await loadSourceMemorySafe()
          })
        : null;
      res.json({
        ok: true,
        auto_backup,
        attached,
        skipped: skipped_ids.length,
        selected_ids,
        attached_ids,
        skipped_ids,
        results,
        release: nextRelease,
        assistant_pass: nextAssistantPass,
        recommendations: nextRecommendations
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/fill-missing-visuals", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const auto_backup = await createSafetyBackup(`fill-missing-visuals-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const draftPack = buildReleaseDraftPack({
        release,
        recommendations,
        researchBriefs
      });
      const requestedLimit = Number(req.body?.limit ?? 3);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, requestedLimit)) : 3;
      const prioritizedVisualItems = prioritizeReleaseItemsByAssistantPass(release.assets, assistantPass, mediaPackage)
        .filter((item) => !String(item?.attachment?.visual_note ?? "").trim())
        .map((item) => ({
          attachment_id: String(item?.attachment?.id ?? "").trim()
        }));
      const missingItems = (
        prioritizedVisualItems.length > 0
          ? prioritizedVisualItems
          : draftPack.items.filter((item) => item.needs_visual)
      ).slice(0, limit);
      const usedAssetIds = new Set(release.assets.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean));
      let attached = 0;
      let updated = 0;
      const actions = [];

      for (const draftItem of missingItems) {
        const releaseItem = release.assets.find(
          (item) => String(item?.attachment?.id ?? "") === String(draftItem.attachment_id ?? "")
        );
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const researchBrief = findResearchBriefForReleaseItem(researchBriefs, releaseItem);
        const picked = await pickRecommendationForReleaseItem({
          release,
          item: releaseItem,
          candidates: recommendations.candidates,
          usedAssetIds,
          researchBrief,
          listRecommendationCandidatesForItem,
          sourceMemory,
          mode: "visual"
        });
        if (picked?.asset?.id) {
          const attachedVisual = await attachAsset(picked.asset.id, {
            target_type: "release",
            target_id: release.id,
            role: "visual",
            attached_by: "release_visual_fill",
            note: `Suggested visual for ${releaseItem.attachment.id}`
          });
          if (attachedVisual?.id) {
            attached += 1;
            usedAssetIds.add(String(picked.asset.id));
            await rememberReleaseOutcomeForAsset(release, picked.asset, "visual", "fill");
          }
        }
        const visualNote = buildDraftVisualSuggestion(releaseItem.asset, picked, researchBrief);
        const assistantTrace = buildAssistantTracePatch({
          existingTrace: releaseItem?.attachment?.assistant_trace_json,
          researchBrief,
          recommendation: picked,
          visualNote,
          action: "fill_missing_visuals",
          includeVisual: true
        });
        const updatedItem = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, {
          visual_note: visualNote,
          assistant_trace_json: assistantTrace
        });
        if (updatedItem?.id) {
          updated += 1;
        }
        actions.push({
          attachment_id: releaseItem.attachment.id,
          asset_id: releaseItem.asset.id,
          recommended_asset_id: String(picked?.asset?.id ?? "")
        });
      }
      await logReleaseAssistantActivity(
        release.id,
        "fill_missing_visuals",
        `assistant filled ${updated} visual gap${updated === 1 ? "" : "s"} and attached ${attached} visual${attached === 1 ? "" : "s"}`,
        { updated, attached }
      );

      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      const nextResearchBriefs = nextRelease
        ? await buildReleaseResearchBriefs({
            release: nextRelease,
            getDocDir,
            readOptionalJson
          })
        : null;
      const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
      const nextRecommendations = nextRelease
        ? await buildReleaseRecommendations({
            release: nextRelease,
            listAssets,
            listRecommendationCandidatesForRelease,
            assistantPass: nextAssistantPass,
            researchBriefs: nextResearchBriefs,
            releaseOutcomeMemory: nextReleaseOutcomeMemory,
            sourceMemory: await loadSourceMemorySafe()
          })
        : null;
      const nextDraftPack = nextRelease
        ? buildReleaseDraftPack({
            release: nextRelease,
            recommendations: nextRecommendations,
            researchBriefs: nextResearchBriefs
          })
        : null;

      res.json({
        ok: true,
        auto_backup,
        attached,
        updated,
        prioritized_attachment_ids: missingItems.map((item) => String(item?.attachment_id ?? "").trim()).filter(Boolean),
        actions,
        release: nextRelease,
        assistant_pass: nextAssistantPass,
        recommendations: nextRecommendations,
        draft_pack: nextDraftPack
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/fill-selection-visuals", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const auto_backup = await createSafetyBackup(`fill-selection-visuals-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const usedAssetIds = new Set(release.assets.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean));
      const requestedLimit = Number(req.body?.limit ?? selectedItems.length);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(selectedItems.length, Math.min(20, requestedLimit)))
        : selectedItems.length;
      const prioritizedSelectedVisualItems = prioritizeReleaseItemsByAssistantPass(selectedItems, assistantPass, mediaPackage)
        .filter((item) => !String(item?.attachment?.visual_note ?? "").trim())
        .slice(0, limit);
      let attached = 0;
      let updated = 0;
      const actions = [];

      for (const releaseItem of prioritizedSelectedVisualItems) {
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const researchBrief = findResearchBriefForReleaseItem(researchBriefs, releaseItem);
        const picked = await pickRecommendationForReleaseItem({
          release,
          item: releaseItem,
          candidates: recommendations.candidates,
          usedAssetIds,
          researchBrief,
          listRecommendationCandidatesForItem,
          sourceMemory,
          mode: "visual"
        });
        if (picked?.asset?.id) {
          const attachedVisual = await attachAsset(picked.asset.id, {
            target_type: "release",
            target_id: release.id,
            role: "visual",
            attached_by: "release_selection_visual_fill",
            note: `Suggested visual for ${releaseItem.attachment.id}`
          });
          if (attachedVisual?.id) {
            attached += 1;
            usedAssetIds.add(String(picked.asset.id));
            await rememberReleaseOutcomeForAsset(release, picked.asset, "visual", "fill");
          }
        }
        const visualNote = buildDraftVisualSuggestion(releaseItem.asset, picked, researchBrief);
        const assistantTrace = buildAssistantTracePatch({
          existingTrace: releaseItem?.attachment?.assistant_trace_json,
          researchBrief,
          recommendation: picked,
          visualNote,
          action: "fill_selection_visuals",
          includeVisual: true
        });
        const updatedItem = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, {
          visual_note: visualNote,
          assistant_trace_json: assistantTrace
        });
        if (updatedItem?.id) updated += 1;
        actions.push({
          attachment_id: releaseItem.attachment.id,
          asset_id: releaseItem.asset.id,
          recommended_asset_id: String(picked?.asset?.id ?? "")
        });
      }
      await logReleaseAssistantActivity(
        release.id,
        "fill_selection_visuals",
        `assistant filled visuals for ${updated} selected item${updated === 1 ? "" : "s"}`,
        { selected: selectedItems.length, updated, attached }
      );

      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      const nextResearchBriefs = nextRelease
        ? await buildReleaseResearchBriefs({
            release: nextRelease,
            getDocDir,
            readOptionalJson
          })
        : null;
      const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
      const nextRecommendations = nextRelease
        ? await buildReleaseRecommendations({
            release: nextRelease,
            listAssets,
            listRecommendationCandidatesForRelease,
            assistantPass: nextAssistantPass,
            researchBriefs: nextResearchBriefs,
            releaseOutcomeMemory: nextReleaseOutcomeMemory,
            sourceMemory: await loadSourceMemorySafe()
          })
        : null;
      const nextDraftPack = nextRelease
        ? buildReleaseDraftPack({
            release: nextRelease,
            recommendations: nextRecommendations,
            researchBriefs: nextResearchBriefs
          })
        : null;

      res.json({
        ok: true,
        auto_backup,
        selected: selectedItems.length,
        attached,
        updated,
        prioritized_attachment_ids: prioritizedSelectedVisualItems
          .map((item) => String(item?.attachment?.id ?? "").trim())
          .filter(Boolean),
        actions,
        release: nextRelease,
        assistant_pass: nextAssistantPass,
        recommendations: nextRecommendations,
        draft_pack: nextDraftPack
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/prepare-selection", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const auto_backup = await createSafetyBackup(`prepare-selection-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const usedAssetIds = new Set(release.assets.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean));
      const prioritizedSelectedItems = prioritizeReleaseItemsByAssistantPass(selectedItems, assistantPass, mediaPackage);
      let updated = 0;
      let attached = 0;
      const prepared = [];

      for (const releaseItem of prioritizedSelectedItems) {
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const currentStatus = String(releaseItem?.attachment?.item_status ?? "planned").trim().toLowerCase();
        const currentScript = String(releaseItem?.attachment?.script_note ?? "").trim();
        const currentVisual = String(releaseItem?.attachment?.visual_note ?? "").trim();
        const researchBrief = findResearchBriefForReleaseItem(researchBriefs, releaseItem);
        const picked = !currentVisual
          ? await pickRecommendationForReleaseItem({
              release,
              item: releaseItem,
              candidates: recommendations.candidates,
              usedAssetIds,
              researchBrief,
              listRecommendationCandidatesForItem,
              sourceMemory,
              mode: "visual"
            })
          : null;

        if (picked?.asset?.id) {
          const attachedVisual = await attachAsset(picked.asset.id, {
            target_type: "release",
            target_id: release.id,
            role: "visual",
            attached_by: "release_selection_prepare",
            note: `Prepared visual for ${releaseItem.attachment.id}`
          });
          if (attachedVisual?.id) {
            attached += 1;
            usedAssetIds.add(String(picked.asset.id));
            await rememberReleaseOutcomeForAsset(release, picked.asset, "visual", "prepare");
          }
        }

        const nextScript = currentScript || buildDraftScriptSuggestion(releaseItem.asset, releaseItem.attachment, researchBrief);
        const nextVisual = currentVisual || buildDraftVisualSuggestion(releaseItem.asset, picked, researchBrief);
        let nextStatus = currentStatus || "planned";
        if (!["ready", "done", "skipped"].includes(nextStatus)) {
          nextStatus = nextVisual ? "visual_ready" : nextScript ? "scripting" : nextStatus;
        }

        const patch = {};
        if (nextScript && nextScript !== currentScript) patch.script_note = nextScript;
        if (nextVisual && nextVisual !== currentVisual) patch.visual_note = nextVisual;
        if (nextStatus && nextStatus !== currentStatus) patch.item_status = nextStatus;
        if (patch.script_note || patch.visual_note) {
          patch.assistant_trace_json = buildAssistantTracePatch({
            existingTrace: releaseItem?.attachment?.assistant_trace_json,
            researchBrief,
            recommendation: picked,
            scriptNote: patch.script_note || currentScript,
            visualNote: patch.visual_note || currentVisual,
            action: "prepare_selection",
            includeScript: Boolean(patch.script_note),
            includeVisual: Boolean(patch.visual_note)
          });
        }

        if (Object.keys(patch).length > 0) {
          const result = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
          if (result?.id) {
            updated += 1;
            prepared.push({
              attachment_id: releaseItem.attachment.id,
              asset_id: releaseItem.asset.id,
              item_status: nextStatus,
              recommended_asset_id: String(picked?.asset?.id ?? "")
            });
          }
        }
      }
      await logReleaseAssistantActivity(
        release.id,
        "prepare_selection",
        `assistant prepared ${updated} selected item${updated === 1 ? "" : "s"}`,
        { selected: selectedItems.length, updated, attached }
      );

      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        auto_backup,
        selected: selectedItems.length,
        updated,
        attached,
        prioritized_attachment_ids: prioritizedSelectedItems
          .map((item) => String(item?.attachment?.id ?? "").trim())
          .filter(Boolean),
        prepared,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/prepare-release", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const releaseItems = Array.isArray(release?.assets) ? release.assets : [];
      if (releaseItems.length === 0) {
        return res.status(400).json({ error: "Release has no items" });
      }
      const auto_backup = await createSafetyBackup(`prepare-release-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const prioritizedReleaseItems = prioritizeReleaseItemsByAssistantPass(releaseItems, assistantPass, mediaPackage);
      const usedAssetIds = new Set(releaseItems.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean));
      let updated = 0;
      let attached = 0;
      const prepared = [];

      for (const releaseItem of prioritizedReleaseItems) {
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const currentStatus = String(releaseItem?.attachment?.item_status ?? "planned").trim().toLowerCase();
        const currentScript = String(releaseItem?.attachment?.script_note ?? "").trim();
        const currentVisual = String(releaseItem?.attachment?.visual_note ?? "").trim();
        const researchBrief = findResearchBriefForReleaseItem(researchBriefs, releaseItem);
        const picked = !currentVisual
          ? await pickRecommendationForReleaseItem({
              release,
              item: releaseItem,
              candidates: recommendations.candidates,
              usedAssetIds,
              researchBrief,
              listRecommendationCandidatesForItem,
              sourceMemory,
              mode: "visual"
            })
          : null;

        if (picked?.asset?.id) {
          const attachedVisual = await attachAsset(picked.asset.id, {
            target_type: "release",
            target_id: release.id,
            role: "visual",
            attached_by: "release_prepare",
            note: `Prepared visual for ${releaseItem.attachment.id}`
          });
          if (attachedVisual?.id) {
            attached += 1;
            usedAssetIds.add(String(picked.asset.id));
            await rememberReleaseOutcomeForAsset(release, picked.asset, "visual", "prepare");
          }
        }

        const nextScript = currentScript || buildDraftScriptSuggestion(releaseItem.asset, releaseItem.attachment, researchBrief);
        const nextVisual = currentVisual || buildDraftVisualSuggestion(releaseItem.asset, picked, researchBrief);
        let nextStatus = currentStatus || "planned";
        if (!["ready", "done", "skipped"].includes(nextStatus)) {
          nextStatus = nextVisual ? "visual_ready" : nextScript ? "scripting" : nextStatus;
        }

        const patch = {};
        if (nextScript && nextScript !== currentScript) patch.script_note = nextScript;
        if (nextVisual && nextVisual !== currentVisual) patch.visual_note = nextVisual;
        if (nextStatus && nextStatus !== currentStatus) patch.item_status = nextStatus;
        if (patch.script_note || patch.visual_note) {
          patch.assistant_trace_json = buildAssistantTracePatch({
            existingTrace: releaseItem?.attachment?.assistant_trace_json,
            researchBrief,
            recommendation: picked,
            scriptNote: patch.script_note || currentScript,
            visualNote: patch.visual_note || currentVisual,
            action: "prepare_release",
            includeScript: Boolean(patch.script_note),
            includeVisual: Boolean(patch.visual_note)
          });
        }

        if (Object.keys(patch).length > 0) {
          const result = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
          if (result?.id) {
            updated += 1;
            prepared.push({
              attachment_id: releaseItem.attachment.id,
              asset_id: releaseItem.asset.id,
              item_status: nextStatus,
              recommended_asset_id: String(picked?.asset?.id ?? "")
            });
          }
        }
      }
      await logReleaseAssistantActivity(
        release.id,
        "prepare_release",
        `assistant prepared ${updated} release item${updated === 1 ? "" : "s"}`,
        { total: releaseItems.length, updated, attached }
      );

      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        auto_backup,
        total: releaseItems.length,
        updated,
        attached,
        prioritized_attachment_ids: prioritizedReleaseItems
          .map((item) => String(item?.attachment?.id ?? "").trim())
          .filter(Boolean),
        prepared,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/mark-air-ready", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const publishChecklist = buildReleasePublishChecklist(release, assistantPass, mediaPackage);
      if (!publishChecklist.is_ready_to_air) {
        return res.status(409).json({
          error: "Release is not ready to air",
          publish_checklist: publishChecklist
        });
      }
      await updateRelease(req.params.id, {
        status: "ready",
        editor_status: "air_ready"
      });
      await logReleaseAssistantActivity(
        release.id,
        "mark_air_ready",
        "assistant moved release to air ready",
        { status: "ready", editor_status: "air_ready" }
      );
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/publish-release", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const mediaPackage = await buildAndTrackReleaseMediaPackage(release, researchBriefs);
      const publishChecklist = buildReleasePublishChecklist(release, assistantPass, mediaPackage);
      const controlPanel = buildReleaseControlPanel(
        release,
        assistantPass,
        publishChecklist,
        mediaPackage
      );
      if (!publishChecklist.is_ready_to_air || !controlPanel.can_publish) {
        return res.status(409).json({
          error: "Release cannot be published yet",
          publish_checklist: publishChecklist,
          control_panel: controlPanel
        });
      }
      await updateRelease(req.params.id, {
        status: "published",
        editor_status: "published"
      });
      await logReleaseAssistantActivity(
        release.id,
        "publish_release",
        "assistant marked release as published",
        { status: "published", editor_status: "published" }
      );
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/apply-draft-pack", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const auto_backup = await createSafetyBackup(`apply-draft-pack-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const draftPack = buildReleaseDraftPack({
        release,
        recommendations,
        researchBriefs
      });
      const mode = String(req.body?.mode ?? "missing_only").trim().toLowerCase();
      const overwrite = mode === "overwrite";
      let updated = 0;
      for (const item of draftPack.items) {
        const releaseItem = release.assets.find((entry) => String(entry?.attachment?.id ?? "") === String(item.attachment_id ?? ""));
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const patch = {};
        if (item.suggested_script_note && (overwrite || !String(releaseItem.attachment?.script_note ?? "").trim())) {
          patch.script_note = item.suggested_script_note;
        }
        if (item.suggested_visual_note && (overwrite || !String(releaseItem.attachment?.visual_note ?? "").trim())) {
          patch.visual_note = item.suggested_visual_note;
        }
        if (patch.script_note || patch.visual_note) {
          patch.assistant_trace_json = buildAssistantTracePatch({
            existingTrace: releaseItem?.attachment?.assistant_trace_json,
            researchBrief: {
              segment_id: item.research_segment_id,
              section_title: item.research_section_title,
              brief: {
                items: []
              }
            },
            recommendation: item.recommended_asset_id
              ? recommendations?.candidates?.find(
                  (candidate) => String(candidate?.asset?.id ?? "") === String(item.recommended_asset_id)
                ) ?? null
              : null,
            scriptNote: patch.script_note || releaseItem.attachment?.script_note,
            visualNote: patch.visual_note || releaseItem.attachment?.visual_note,
            action: "apply_draft_pack",
            includeScript: Boolean(patch.script_note),
            includeVisual: Boolean(patch.visual_note)
          });
        }
        if (Object.keys(patch).length === 0) continue;
        const result = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
        if (result?.id) updated += 1;
      }
      await logReleaseAssistantActivity(
        release.id,
        "apply_draft_pack",
        `assistant applied draft pack to ${updated} item${updated === 1 ? "" : "s"}`,
        { updated, mode }
      );
      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      const nextResearchBriefs = nextRelease
        ? await buildReleaseResearchBriefs({
            release: nextRelease,
            getDocDir,
            readOptionalJson
          })
        : null;
      const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
      const nextRecommendations = nextRelease
        ? await buildReleaseRecommendations({
            release: nextRelease,
            listAssets,
            listRecommendationCandidatesForRelease,
            assistantPass: nextAssistantPass,
            researchBriefs: nextResearchBriefs,
            releaseOutcomeMemory: nextReleaseOutcomeMemory,
            sourceMemory: await loadSourceMemorySafe()
          })
        : null;
      const nextDraftPack = nextRelease
        ? buildReleaseDraftPack({
            release: nextRelease,
            recommendations: nextRecommendations,
            researchBriefs: nextResearchBriefs
          })
        : null;
      res.json({
        ok: true,
        auto_backup,
        updated,
        release: nextRelease,
        assistant_pass: nextAssistantPass,
        recommendations: nextRecommendations,
        draft_pack: nextDraftPack
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/apply-selection-draft-pack", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const auto_backup = await createSafetyBackup(`apply-selection-draft-pack-${release.id}`);
      const assistantPass = await computeAssistantPass(release);
      const researchBriefs = await buildReleaseResearchBriefs({
        release,
        getDocDir,
        readOptionalJson
      });
      const releaseOutcomeMemory = await loadReleaseOutcomeMemorySafe();
      const sourceMemory = await loadSourceMemorySafe();
      const recommendations = await buildReleaseRecommendations({
        release,
        listAssets,
        listRecommendationCandidatesForRelease,
        assistantPass,
        researchBriefs,
        releaseOutcomeMemory,
        sourceMemory
      });
      const draftPack = buildReleaseDraftPack({
        release: {
          ...release,
          assets: selectedItems
        },
        recommendations,
        researchBriefs
      });
      const mode = String(req.body?.mode ?? "missing_only").trim().toLowerCase();
      const overwrite = mode === "overwrite";
      let updated = 0;
      for (const item of draftPack.items) {
        const releaseItem = selectedItems.find(
          (entry) => String(entry?.attachment?.id ?? "") === String(item.attachment_id ?? "")
        );
        if (!releaseItem?.asset?.id || !releaseItem?.attachment?.id) continue;
        const patch = {};
        if (item.suggested_script_note && (overwrite || !String(releaseItem.attachment?.script_note ?? "").trim())) {
          patch.script_note = item.suggested_script_note;
        }
        if (item.suggested_visual_note && (overwrite || !String(releaseItem.attachment?.visual_note ?? "").trim())) {
          patch.visual_note = item.suggested_visual_note;
        }
        if (patch.script_note || patch.visual_note) {
          patch.assistant_trace_json = buildAssistantTracePatch({
            existingTrace: releaseItem?.attachment?.assistant_trace_json,
            researchBrief: {
              segment_id: item.research_segment_id,
              section_title: item.research_section_title,
              brief: {
                items: []
              }
            },
            recommendation: item.recommended_asset_id
              ? recommendations?.candidates?.find(
                  (candidate) => String(candidate?.asset?.id ?? "") === String(item.recommended_asset_id)
                ) ?? null
              : null,
            scriptNote: patch.script_note || releaseItem.attachment?.script_note,
            visualNote: patch.visual_note || releaseItem.attachment?.visual_note,
            action: "apply_selection_draft_pack",
            includeScript: Boolean(patch.script_note),
            includeVisual: Boolean(patch.visual_note)
          });
        }
        if (Object.keys(patch).length === 0) continue;
        const result = await updateAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
        if (result?.id) updated += 1;
      }
      await logReleaseAssistantActivity(
        release.id,
        "apply_selection_draft_pack",
        `assistant applied selection draft pack to ${updated} item${updated === 1 ? "" : "s"}`,
        { selected: selectedItems.length, updated, mode }
      );
      const nextRelease = await loadReleaseSafe(req.params.id);
      const nextAssistantPass = nextRelease ? await computeAssistantPass(nextRelease) : null;
      const nextResearchBriefs = nextRelease
        ? await buildReleaseResearchBriefs({
            release: nextRelease,
            getDocDir,
            readOptionalJson
          })
        : null;
      const nextReleaseOutcomeMemory = nextRelease ? await loadReleaseOutcomeMemorySafe() : null;
      const nextRecommendations = nextRelease
        ? await buildReleaseRecommendations({
            release: nextRelease,
            listAssets,
            listRecommendationCandidatesForRelease,
            assistantPass: nextAssistantPass,
            researchBriefs: nextResearchBriefs,
            releaseOutcomeMemory: nextReleaseOutcomeMemory,
            sourceMemory: await loadSourceMemorySafe()
          })
        : null;
      const nextDraftPack = nextRelease
        ? buildReleaseDraftPack({
            release: nextRelease,
            recommendations: nextRecommendations,
            researchBriefs: nextResearchBriefs
          })
        : null;
      res.json({
        ok: true,
        auto_backup,
        selected: selectedItems.length,
        updated,
        release: nextRelease,
        assistant_pass: nextAssistantPass,
        recommendations: nextRecommendations,
        draft_pack: nextDraftPack
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/update-selection-items", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const patch = {};
      if (req.body?.patch && typeof req.body.patch === "object" && !Array.isArray(req.body.patch)) {
        if (req.body.patch.item_status !== undefined) patch.item_status = req.body.patch.item_status;
        if (req.body.patch.script_note !== undefined) patch.script_note = req.body.patch.script_note;
        if (req.body.patch.visual_note !== undefined) patch.visual_note = req.body.patch.visual_note;
        if (req.body.patch.note !== undefined) patch.note = req.body.patch.note;
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Selection patch is required" });
      }
      let updated = 0;
      for (const item of selectedItems) {
        const nextPatch = { ...patch };
        if (Object.prototype.hasOwnProperty.call(nextPatch, "script_note") || Object.prototype.hasOwnProperty.call(nextPatch, "visual_note")) {
          const changedFields = buildManualOverrideActivityFields(item.attachment, nextPatch);
          nextPatch.assistant_trace_json = buildManualOverrideTracePatch(item.attachment, nextPatch, "manual_selection_patch");
          if (changedFields.length > 0) {
            nextPatch.activity_event = "manual_override";
            nextPatch.activity_detail = `manual selection patch for ${changedFields.join(" + ")} note${changedFields.length > 1 ? "s" : ""}`;
            nextPatch.activity_meta = {
              fields: changedFields,
              action: "manual_selection_patch"
            };
          }
        }
        const result = await updateAttachment(item.asset.id, item.attachment.id, nextPatch);
        if (result?.id) updated += 1;
      }
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        selected: selectedItems.length,
        updated,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/update-selection-asset-status", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const nextStatus = String(req.body?.status ?? "").trim();
      if (!nextStatus) {
        return res.status(400).json({ error: "Asset status is required" });
      }
      const selectedAssetIds = Array.from(
        new Set(selectedItems.map((item) => String(item?.asset?.id ?? "").trim()).filter(Boolean))
      );
      let updated = 0;
      for (const assetId of selectedAssetIds) {
        const result = await updateAsset(assetId, {
          status: nextStatus,
          processing_state: nextStatus === "archived" ? "archived" : "processed"
        });
        if (result?.id) updated += 1;
      }
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        selected: selectedItems.length,
        updated,
        asset_ids: selectedAssetIds,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/apply-selection-note-templates", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      const scriptTemplate = String(req.body?.script_template ?? "").trim();
      const visualTemplate = String(req.body?.visual_template ?? "").trim();
      if (!scriptTemplate && !visualTemplate) {
        return res.status(400).json({ error: "script_template or visual_template is required" });
      }
      const overwrite = Boolean(req.body?.overwrite);
      let updated = 0;
      for (const item of selectedItems) {
        const patch = {};
        if (scriptTemplate && (overwrite || !String(item?.attachment?.script_note ?? "").trim())) {
          patch.script_note = scriptTemplate;
        }
        if (visualTemplate && (overwrite || !String(item?.attachment?.visual_note ?? "").trim())) {
          patch.visual_note = visualTemplate;
        }
        if (patch.script_note || patch.visual_note) {
          const changedFields = buildManualOverrideActivityFields(item.attachment, patch);
          patch.assistant_trace_json = buildManualOverrideTracePatch(item.attachment, patch, "manual_template_apply");
          if (changedFields.length > 0) {
            patch.activity_event = "manual_override";
            patch.activity_detail = `manual template apply for ${changedFields.join(" + ")} note${changedFields.length > 1 ? "s" : ""}`;
            patch.activity_meta = {
              fields: changedFields,
              action: "manual_template_apply"
            };
          }
        }
        if (Object.keys(patch).length === 0) continue;
        const result = await updateAttachment(item.asset.id, item.attachment.id, patch);
        if (result?.id) updated += 1;
      }
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        selected: selectedItems.length,
        updated,
        overwrite,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/releases/:id/assistant-actions/detach-selection-items", async (req, res) => {
    try {
      const release = await loadReleaseSafe(req.params.id);
      if (!release) return res.status(404).json({ error: "Release not found" });
      const selectedItems = selectReleaseItemsByAttachmentIds(release, req.body?.attachment_ids);
      if (selectedItems.length === 0) {
        return res.status(400).json({ error: "No selected release items" });
      }
      let detached = 0;
      for (const item of selectedItems) {
        const result = await removeAttachment(item.asset.id, item.attachment.id);
        if (result?.id) detached += 1;
      }
      const nextState = await buildReleaseActionState(req.params.id);
      res.json({
        ok: true,
        selected: selectedItems.length,
        detached,
        ...nextState
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/bot/sessions", async (req, res) => {
    try {
      const filters = {
        chat_id: req.query.chat_id,
        user_id: req.query.user_id,
        mode: req.query.mode
      };
      const sessions =
        typeof listBotSessionsIndexed === "function"
          ? await listBotSessionsIndexed(filters)
          : await listBotSessions(filters);
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/bot/sessions", async (req, res) => {
    try {
      const session = await upsertBotSession(req.body ?? {});
      res.json({ session });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}
