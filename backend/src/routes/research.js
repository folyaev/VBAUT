import path from "node:path";
import { nanoid } from "nanoid";
import { createDocumentRouteLoaders } from "../services/document-route-loaders.js";
import { canonicalizeLinkUrl, normalizeLinkUrl } from "../services/links.js";
import { normalizeResearchDismissedUrlsInput } from "../services/normalizers.js";
import { isBlockedResearchDomain, isUaResearchDomain } from "../services/source-profiles.js";
import { dedupeRankedResearchResultsByStory } from "../services/research-story-clusters.js";

function normalizeUrl(input) {
  return normalizeLinkUrl(input);
}

function normalizeUrlForKey(input) {
  return canonicalizeLinkUrl(input);
}

const RESEARCH_APPLY_ACTIONS = new Set([
  "use_as_source",
  "mark_helpful",
  "promote_to_decision",
  "screenshot",
  "download",
  "attach_asset",
  "duplicate_story",
  "bad_visual",
  "screenshot_failed",
  "download_failed",
  "paywall",
  "anti_bot",
  "age_gate"
]);

function dedupeResultsByUrl(results = []) {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).filter((item) => {
    const key = normalizeUrlForKey(item?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterBlockedResearchResults(results = [], sourceProfiles = {}) {
  const allowed = [];
  const blocked = [];
  const uaFallback = [];
  (Array.isArray(results) ? results : []).forEach((item) => {
    if (isBlockedResearchDomain(item?.domain, sourceProfiles)) {
      blocked.push(item);
      return;
    }
    if (isUaResearchDomain(item?.domain)) {
      uaFallback.push(item);
      return;
    }
    allowed.push(item);
  });
  return { allowed, blocked, uaFallback };
}

function collectSeenResearchUrls(runs = []) {
  const seen = new Set();
  (Array.isArray(runs) ? runs : []).forEach((run) => {
    (Array.isArray(run?.results) ? run.results : []).forEach((item) => {
      const key = normalizeUrlForKey(item?.url);
      if (key) seen.add(key);
    });
    (Array.isArray(run?.applied) ? run.applied : []).forEach((item) => {
      const key = normalizeUrlForKey(item?.meta?.url);
      if (key) seen.add(key);
    });
  });
  return seen;
}

function collectDocumentScenarioLinkUrls(segments = []) {
  const seen = new Set();
  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") return;
    (Array.isArray(segment?.links) ? segment.links : []).forEach((item) => {
      const key = normalizeUrlForKey(item?.url ?? item);
      if (key) seen.add(key);
    });
  });
  return seen;
}

function collectDismissedResearchUrlKeys(decision = null) {
  const seen = new Set();
  (Array.isArray(decision?.research_dismissed_urls) ? decision.research_dismissed_urls : []).forEach((item) => {
    const key = normalizeUrlForKey(item?.url ?? item);
    if (key) seen.add(key);
  });
  return seen;
}

function appendDismissedResearchUrlEntries(current = [], entries = []) {
  return normalizeResearchDismissedUrlsInput([...(Array.isArray(current) ? current : []), ...entries]);
}

function buildScreenshotLabUrl({ url, docId, segmentId, runId, resultId, title, textQuote }) {
  const params = new URLSearchParams({
    urls: url,
    mode: "screenshot"
  });
  if (docId) params.set("doc_id", docId);
  if (segmentId) params.set("segment_id", segmentId);
  if (runId) params.set("run_id", runId);
  if (resultId) params.set("result_id", resultId);
  if (title) params.set("note", title);
  if (textQuote) params.set("text_quote", textQuote);
  return `/tools/screenshot-lab?${params.toString()}`;
}

function compactText(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function getResearchSectionKey(segment = {}) {
  const sectionId = compactText(segment?.section_id).toLowerCase();
  if (sectionId) return `id:${sectionId}`;
  const sectionTitle = compactText(segment?.section_title).toLowerCase();
  if (sectionTitle) return `title:${sectionTitle}`;
  return "";
}

function isResearchContextTextSegment(segment = {}) {
  const blockType = compactText(segment?.block_type).toLowerCase();
  if (blockType === "links") return false;
  if (/^comments_/i.test(compactText(segment?.segment_id))) return false;
  return Boolean(compactText(segment?.text_quote));
}

function extractResearchLinkHintDomains(linkHints = []) {
  const seen = new Set();
  const domains = [];
  (Array.isArray(linkHints) ? linkHints : []).forEach((item) => {
    const raw = compactText(item);
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      const hostname = compactText(parsed.hostname).replace(/^www\./i, "").toLowerCase();
      if (!hostname || seen.has(hostname)) return;
      seen.add(hostname);
      domains.push(hostname);
    } catch {
      // Ignore malformed URLs in hints.
    }
  });
  return domains.slice(0, 4);
}

function buildSectionResearchContext(segments = [], targetSegment = {}) {
  const sectionKey = getResearchSectionKey(targetSegment);
  if (!sectionKey) {
    return {
      section_context_text: "",
      section_link_hints: []
    };
  }
  const source = Array.isArray(segments) ? segments : [];
  const currentSegmentId = compactText(targetSegment?.segment_id);
  const sameSection = source.filter((item) => getResearchSectionKey(item) === sectionKey);
  if (sameSection.length === 0) {
    return {
      section_context_text: "",
      section_link_hints: []
    };
  }

  const currentIndex = sameSection.findIndex((item) => compactText(item?.segment_id) === currentSegmentId);
  const contextTexts = sameSection
    .map((item, index) => {
      if (!isResearchContextTextSegment(item)) return null;
      if (compactText(item?.segment_id) === currentSegmentId) return null;
      const text = compactText(item?.text_quote);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const linkCount = Array.isArray(item?.links) ? item.links.length : 0;
      const distance = currentIndex === -1 ? 99 : Math.abs(index - currentIndex);
      const score =
        (linkCount * 120) +
        Math.max(0, 40 - (distance * 8)) +
        Math.min(text.length, 220) / 3 +
        Math.min(wordCount, 24) * 4;
      return { text, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  const seenTexts = new Set();
  const selectedTexts = [];
  contextTexts.forEach((item) => {
    const normalized = item.text.toLowerCase();
    if (seenTexts.has(normalized)) return;
    seenTexts.add(normalized);
    selectedTexts.push(item.text);
  });

  const linkHints = [];
  const seenLinkHints = new Set();
  sameSection.forEach((item) => {
    (Array.isArray(item?.links) ? item.links : []).forEach((entry) => {
      const url = compactText(entry?.url ?? entry);
      if (!url || seenLinkHints.has(url)) return;
      seenLinkHints.add(url);
      linkHints.push(url);
    });
  });

  return {
    section_context_text: selectedTexts.slice(0, 3).join("\n"),
    section_link_hints: [
      ...linkHints.slice(0, 4),
      ...extractResearchLinkHintDomains(linkHints)
    ].slice(0, 6)
  };
}

function tokenizeKeywords(...parts) {
  return [...new Set(
    parts
      .map((item) => compactText(item).toLowerCase())
      .join(" ")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
      .slice(0, 8)
  )];
}

function hasPrioritySearchQueries(segment = {}) {
  return Array.isArray(segment?.search_decision?.queries)
    ? segment.search_decision.queries.some((item) => compactText(item))
    : false;
}

function hasPriorityVisualDescription(segment = {}) {
  return Boolean(compactText(segment?.visual_decision?.description));
}

async function enrichSegmentWithTranslatedText(segment = {}, translateHeadingToEnglishQuery) {
  if (hasPrioritySearchQueries(segment) || hasPriorityVisualDescription(segment)) {
    return {
      ...segment,
      translated_text_quote: ""
    };
  }
  const translationSeed = [compactText(segment?.text_quote), compactText(segment?.section_context_text)]
    .filter(Boolean)
    .join(". ")
    .slice(0, 320);
  if (!translationSeed || typeof translateHeadingToEnglishQuery !== "function") {
    return {
      ...segment,
      translated_text_quote: ""
    };
  }
  try {
    const translated = compactText(await translateHeadingToEnglishQuery(translationSeed));
    return {
      ...segment,
      translated_text_quote: translated && translated.toLowerCase() !== translationSeed.toLowerCase() ? translated : ""
    };
  } catch {
    return {
      ...segment,
      translated_text_quote: ""
    };
  }
}

function inferPromotedVisual(result = {}, segment = {}, currentVisual = {}) {
  const title = compactText(result?.title || segment?.section_title || "Источник");
  const snippet = compactText(result?.snippet);
  const contentType = compactText(result?.content_type).toLowerCase();
  const domain = compactText(result?.domain).toLowerCase();
  const currentType = compactText(currentVisual?.type).toLowerCase();
  const looksVideo =
    contentType.includes("video") || /(youtube|youtu\.be|vimeo|rutube|dailymotion|video|footage|watch|clip)/.test(`${domain} ${title} ${snippet}`.toLowerCase());
  const looksImage =
    contentType.includes("image") || /(photo|image|gallery|pictures)/.test(`${title} ${snippet}`.toLowerCase());
  const looksScreenshot =
    /(x\.com|twitter|reddit|t\.me|instagram|facebook|thread|tweet|post|screenshot)/.test(`${domain} ${title} ${snippet}`.toLowerCase());
  let type = currentType;
  if (!type || type === "no_visual") {
    if (looksVideo) type = "video";
    else if (looksImage) type = "image";
    else if (looksScreenshot) type = "interface";
    else type = "document";
  }
  const description =
    compactText(currentVisual?.description) ||
    [title, snippet].filter(Boolean).join(". ").slice(0, 280);
  return {
    ...currentVisual,
    type,
    description
  };
}

function buildPromotedSearchDecision(result = {}, segment = {}, currentSearch = {}) {
  const domain = compactText(result?.domain);
  const title = compactText(result?.title);
  const sectionTitle = compactText(segment?.section_title);
  const quote = compactText(segment?.text_quote);
  const keywords = [...new Set([
    ...(Array.isArray(currentSearch?.keywords) ? currentSearch.keywords : []),
    ...tokenizeKeywords(sectionTitle, title, domain)
  ])];
  const queryCandidates = [
    ...((Array.isArray(currentSearch?.queries) ? currentSearch.queries : []).map((item) => compactText(item)).filter(Boolean)),
    title,
    [sectionTitle, domain].filter(Boolean).join(" "),
    [title, sectionTitle || quote.slice(0, 80)].filter(Boolean).join(" ")
  ];
  return {
    ...currentSearch,
    keywords,
    queries: [...new Set(queryCandidates.filter(Boolean))].slice(0, 3)
  };
}

function hasSearchDecisionContent(decision = {}) {
  return (
    (Array.isArray(decision?.keywords) && decision.keywords.some((item) => compactText(item))) ||
    (Array.isArray(decision?.queries) && decision.queries.some((item) => compactText(item)))
  );
}

function hasVisualDecisionContent(decision = {}) {
  const type = compactText(decision?.type).toLowerCase();
  return (type && type !== "no_visual") || Boolean(compactText(decision?.description));
}

function inferPromotedRole(ranked = {}, currentDecision = {}) {
  const sourceScore = Number(ranked?.source_score ?? 0);
  const visualScore = Number(ranked?.visual_score ?? 0);
  const montageScore = Number(ranked?.montage_score ?? 0);
  const totalScore = Number(ranked?.total_score ?? 0);
  const hints = (Array.isArray(ranked?.visual_hints) ? ranked.visual_hints : []).map((item) =>
    compactText(item).toLowerCase()
  );
  const existingSources = Array.isArray(currentDecision?.research_sources) ? currentDecision.research_sources : [];
  const hasPrimarySource = existingSources.some((item) => {
    const role = compactText(item?.role).toLowerCase();
    return role === "main_source" || role === "source";
  });
  const hasVisual = hasVisualDecisionContent(currentDecision?.visual_decision);
  const visualCandidate =
    hints.some((item) => ["video", "image", "screenshot", "downloadable"].includes(item)) ||
    visualScore >= 0.68 ||
    montageScore >= 0.68;

  if (visualCandidate && (!hasVisual || visualScore >= sourceScore + 0.08)) {
    return "visual_candidate";
  }
  if (!hasPrimarySource && (sourceScore >= 0.64 || totalScore >= 0.8)) {
    return "main_source";
  }
  if (sourceScore >= 0.56) {
    return hasPrimarySource ? "backup_source" : "main_source";
  }
  if (visualCandidate) return "visual_candidate";
  return "reference";
}

function mapPromotedAttachmentRole(promotedRole) {
  const normalized = compactText(promotedRole).toLowerCase();
  if (normalized === "main_source") return "source";
  if (normalized === "backup_source") return "backup";
  if (normalized === "visual_candidate") return "visual";
  return "reference";
}

function buildPromotionReasonSummary(ranked = {}) {
  const tags = Array.isArray(ranked?.reason_tags) ? ranked.reason_tags.filter(Boolean).slice(0, 6) : [];
  if (tags.length > 0) return tags.join(", ");
  return compactText(ranked?.reason);
}

function normalizeComparablePickLabel(value) {
  return compactText(value).toLowerCase();
}

function formatBriefItemLabel(item = {}) {
  const key = compactText(item?.key).toLowerCase();
  const role = compactText(item?.role).toLowerCase();
  if (key === "download") return "Best Download";
  if (key === "source" || role === "main_source") return "Main Source";
  if (key === "visual" || (role === "visual_candidate" && key !== "backup_visual")) return "Main Visual";
  if (key === "backup_source" || role === "backup_source") return "Backup Source";
  if (key === "backup_visual") return "Backup Visual";
  return compactText(item?.label) || "Research";
}

function getBriefComparableLabel(item = {}) {
  return compactText(item?.title || item?.label || item?.domain || item?.url || item?.result_id);
}

function deriveCurrentPairSummary(bundleTrace = null, mainSource = null, mainVisual = null, backupSource = null, backupVisual = null) {
  const currentSourceLabel = compactText(bundleTrace?.source?.title || bundleTrace?.source?.domain);
  const currentVisualLabel = compactText(bundleTrace?.visual?.title || bundleTrace?.visual?.domain);
  if (!currentSourceLabel && !currentVisualLabel) return null;
  const mainSourceLabel = getBriefComparableLabel(mainSource);
  const mainVisualLabel = getBriefComparableLabel(mainVisual);
  const backupSourceLabel = getBriefComparableLabel(backupSource);
  const backupVisualLabel = getBriefComparableLabel(backupVisual);
  const sourceMatchesMain =
    currentSourceLabel &&
    mainSourceLabel &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(mainSourceLabel);
  const sourceMatchesBackup =
    currentSourceLabel &&
    backupSourceLabel &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(backupSourceLabel);
  const visualMatchesMain =
    currentVisualLabel &&
    mainVisualLabel &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(mainVisualLabel);
  const visualMatchesBackup =
    currentVisualLabel &&
    backupVisualLabel &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(backupVisualLabel);
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

function formatBriefLines(items = []) {
  return (Array.isArray(items) ? items : []).map(
    (item) =>
      `- ${formatBriefItemLabel(item)}: ${item.title} | ${item.domain} | ${Number(item.score ?? 0).toFixed(2)}${
        compactText(item?.memory_hint) ? ` | ${compactText(item.memory_hint)}` : ""
      }`
  );
}

function formatResearchBriefExport({ segment = {}, decision = {}, run = {}, brief = {}, format = "md" }) {
  const normalizedFormat = String(format ?? "md").trim().toLowerCase();
  const sectionTitle = compactText(segment?.section_title || run?.section_title || "Untitled segment");
  const quote = compactText(segment?.text_quote);
  const summary = compactText(brief?.summary);
  const guidance = Array.isArray(run?.summary?.guidance) ? run.summary.guidance.filter(Boolean) : [];
  const items = Array.isArray(brief?.items) ? brief.items : [];
  const phaseItems = Array.isArray(brief?.phase_items) ? brief.phase_items : [];
  const mainSource = items.find((item) => compactText(item?.key).toLowerCase() === "source") ?? null;
  const mainVisual = items.find((item) => compactText(item?.key).toLowerCase() === "visual") ?? null;
  const backupSource = items.find((item) => compactText(item?.key).toLowerCase() === "backup_source") ?? null;
  const backupVisual = items.find((item) => compactText(item?.key).toLowerCase() === "backup_visual") ?? null;
  const mainItems = [mainSource, mainVisual, items.find((item) => compactText(item?.key).toLowerCase() === "download")].filter(Boolean);
  const backupItems = [backupSource, backupVisual].filter(Boolean);
  const currentPair = deriveCurrentPairSummary(
    decision?.research_bundle_trace ?? segment?.research_bundle_trace,
    mainSource,
    mainVisual,
    backupSource,
    backupVisual
  );

  if (normalizedFormat === "txt") {
    return [
      `Segment Research Brief`,
      `Section: ${sectionTitle}`,
      quote ? `Quote: ${quote}` : "",
      run?.mode ? `Mode: ${run.mode}` : "",
      summary ? `Summary: ${summary}` : "",
      guidance.length ? `Guidance: ${guidance.join(" | ")}` : "",
      currentPair
        ? `Current Pair:\n- ${currentPair.label} | ${currentPair.hint}\n${
            currentPair.source ? `- Current Source: ${currentPair.source}\n` : ""
          }${currentPair.visual ? `- Current Visual: ${currentPair.visual}` : ""}`.trim()
        : "",
      mainItems.length ? `Main Picks:\n${formatBriefLines(mainItems).join("\n")}` : "",
      backupItems.length ? `Backup Picks:\n${formatBriefLines(backupItems).join("\n")}` : "",
      phaseItems.length
        ? `Phase Picks:\n${phaseItems
          .map((item) => `- ${item.label}: ${item.title} | ${item.domain} | ${Number(item.score ?? 0).toFixed(2)}${
            compactText(item?.memory_hint) ? ` | ${compactText(item.memory_hint)}` : ""
          }`)
            .join("\n")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    `# Segment Research Brief`,
    `- Section: ${sectionTitle}`,
    quote ? `- Quote: ${quote}` : "",
    run?.mode ? `- Mode: ${run.mode}` : "",
    summary ? `- Summary: ${summary}` : "",
    guidance.length ? `- Guidance: ${guidance.join(" | ")}` : "",
    currentPair
      ? `\n## Current Pair\n- **${currentPair.label}**: ${currentPair.hint}${
          currentPair.source ? `\n- **Current Source**: ${currentPair.source}` : ""
        }${currentPair.visual ? `\n- **Current Visual**: ${currentPair.visual}` : ""}`
      : "",
    mainItems.length
      ? `\n## Main Picks\n${formatBriefLines(mainItems)
          .map((line) => line.replace(/^- /, "- **").replace(": ", "**: "))
          .join("\n")}`
      : "",
    backupItems.length
      ? `\n## Backup Picks\n${formatBriefLines(backupItems)
          .map((line) => line.replace(/^- /, "- **").replace(": ", "**: "))
          .join("\n")}`
      : "",
    phaseItems.length
      ? `\n## Phase Picks\n${phaseItems
          .map((item) => `- **${item.label}**: ${item.title} | ${item.domain} | ${Number(item.score ?? 0).toFixed(2)}${
            compactText(item?.memory_hint) ? ` | ${compactText(item.memory_hint)}` : ""
          }`)
          .join("\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeStoredResearchBrief(run = {}, rebuiltBrief = {}) {
  const storedBrief = run?.brief ?? {};
  return {
    ...storedBrief,
    ...rebuiltBrief,
    summary: compactText(rebuiltBrief?.summary || storedBrief?.summary),
    items:
      Array.isArray(rebuiltBrief?.items) && rebuiltBrief.items.length > 0
        ? rebuiltBrief.items
        : Array.isArray(storedBrief?.items)
          ? storedBrief.items
          : [],
    phase_items:
      Array.isArray(rebuiltBrief?.phase_items) && rebuiltBrief.phase_items.length > 0
        ? rebuiltBrief.phase_items
        : Array.isArray(storedBrief?.phase_items)
          ? storedBrief.phase_items
          : []
  };
}

export function registerResearchRoutes(app, deps) {
  const {
    applyVisualDecisionFieldOrigins,
    appendEvent,
    attachAsset,
    createAsset,
    emptySearchDecision,
    emptyVisualDecision,
    getDocumentState,
    getDocDir,
    getLatestRun,
    getRunById,
    getSourceMemory,
    getSourceProfiles,
    listDocDecisions,
    listDocSegments,
    listRunsForSegment,
    markApplied,
    buildResearchBrief,
    mergeResearchScores,
    normalizeSearchDecisionInput,
    normalizeVisualDecisionInput,
    recordSourceUsage,
    buildResearchSummary,
    generateSegmentResearchQueries,
    rankSegmentResearchResults,
    readOptionalJson,
    saveRun,
    searchQueries,
    syncDocumentContext,
    translateHeadingToEnglishQuery,
    writeJson
  } = deps;
  const { loadDocumentState: loadResearchDocumentState, loadDocumentContext: loadResearchDocumentContext } =
    createDocumentRouteLoaders({
      getDocDir,
      readOptionalJson,
      getDocumentState,
      listDocSegments,
      listDocDecisions
    });

  async function loadSegmentContext(docId, segmentId) {
    const dir = getDocDir(docId);
    const document = await loadResearchDocumentState(docId);
    if (!document) return { error: "Document not found", status: 404 };
    const { segments, decisions } = await loadResearchDocumentContext(docId);
    const segment = segments.find((item) => String(item?.segment_id ?? "") === String(segmentId ?? ""));
    if (!segment) return { error: "Segment not found", status: 404 };
    const decision =
      decisions.find((item) => String(item?.segment_id ?? "") === String(segmentId ?? "")) ??
      {
        segment_id: String(segmentId ?? ""),
        visual_decision: { type: "no_visual", description: "", format_hint: null, duration_hint_sec: null, priority: null },
        search_decision: { keywords: [], queries: [] },
        search_decision_en: { keywords: [], queries: [] },
        research_dismissed_urls: [],
        version: 1
      };
    return { dir, document, segments, decisions, segment, decision };
  }

  async function writeDecisionUpdate(context, segmentId, updater, options = {}) {
    const existingIndex = context.decisions.findIndex((item) => String(item?.segment_id ?? "") === String(segmentId ?? ""));
    const current =
      existingIndex >= 0
        ? context.decisions[existingIndex]
        : {
            segment_id: String(segmentId ?? ""),
            visual_decision: emptyVisualDecision(),
            search_decision: emptySearchDecision(),
            search_decision_en: emptySearchDecision(),
            research_dismissed_urls: [],
            version: 1
          };
    const nextRaw = updater(current);
    const updatedAt = new Date().toISOString();
    const normalized = {
      ...current,
      ...nextRaw,
      segment_id: String(segmentId ?? ""),
      visual_decision:
        typeof applyVisualDecisionFieldOrigins === "function"
          ? applyVisualDecisionFieldOrigins(current?.visual_decision, nextRaw?.visual_decision ?? current?.visual_decision, {
              description_origin: options.visualOrigin ?? "system",
              media_origin: options.visualOrigin ?? "system",
              updated_at: updatedAt
            })
          : normalizeVisualDecisionInput(nextRaw?.visual_decision ?? current?.visual_decision),
      search_decision: normalizeSearchDecisionInput(nextRaw?.search_decision ?? current?.search_decision),
      search_decision_en: normalizeSearchDecisionInput(nextRaw?.search_decision_en ?? current?.search_decision_en),
      research_dismissed_urls: normalizeResearchDismissedUrlsInput(
        nextRaw?.research_dismissed_urls ?? current?.research_dismissed_urls
      ),
      version: Number(current?.version ?? 1)
    };
    const nextDecisions = [...context.decisions];
    if (existingIndex >= 0) {
      nextDecisions[existingIndex] = normalized;
    } else {
      nextDecisions.push(normalized);
    }
    await writeJson(path.join(context.dir, "decisions.json"), nextDecisions);
    await syncDocumentContext?.(String(context.document?.id ?? ""), context.segments, nextDecisions, "research_decision_update");
    context.decisions = nextDecisions;
    context.decision = normalized;
    return normalized;
  }

  async function applyResearchAction({
    docId,
    segmentId,
    runId,
    resultId,
    action,
    context: initialContext = null,
    run: initialRun = null
  }) {
    const context = initialContext ?? (await loadSegmentContext(docId, segmentId));
    if (context.error) {
      const error = new Error(context.error);
      error.status = context.status;
      throw error;
    }
    const run = initialRun ?? (await getRunById(docId, runId));
    if (!run || String(run.segment_id ?? "") !== String(segmentId)) {
      const error = new Error("Research run not found");
      error.status = 404;
      throw error;
    }
    const result =
      (Array.isArray(run.results) ? run.results : []).find((item) => String(item?.id ?? "") === resultId) ?? null;
    if (!result) {
      const error = new Error("Research result not found");
      error.status = 404;
      throw error;
    }
    const ranked =
      (Array.isArray(run.ranked_results) ? run.ranked_results : []).find(
        (item) => String(item?.result_id ?? "") === resultId
      ) ?? null;

    const normalizedUrl = normalizeUrl(result.url);
    if (!normalizedUrl) {
      const error = new Error("Research result URL is invalid");
      error.status = 400;
      throw error;
    }

    let asset = null;
    let attachment = null;
    let updatedDecision = null;
    const nowIso = new Date().toISOString();
    const promotedRole = action === "promote_to_decision" ? inferPromotedRole(ranked, context.decision) : "";
    const attachmentRole =
      action === "attach_asset"
        ? "reference"
        : action === "download"
          ? "source"
          : action === "screenshot"
            ? "screenshot_candidate"
            : action === "promote_to_decision"
              ? mapPromotedAttachmentRole(promotedRole)
              : "source";

    if (["attach_asset", "screenshot", "download", "promote_to_decision"].includes(action)) {
      asset = await createAsset({
        kind: "link",
        status: action === "download" ? "new" : "attached",
        title: result.title,
        description: result.snippet,
        source_url: normalizedUrl,
        source_domain: result.domain,
        meta_json: {
          research_run_id: runId,
          research_result_id: resultId,
          content_type: result.content_type,
          published_at: result.published_at,
          promoted_role: promotedRole || null,
          ranked_scores: ranked
            ? {
                total_score: Number(ranked?.total_score ?? 0),
                source_score: Number(ranked?.source_score ?? 0),
                visual_score: Number(ranked?.visual_score ?? 0),
                montage_score: Number(ranked?.montage_score ?? 0),
                downloadability_score: Number(ranked?.downloadability_score ?? 0)
              }
            : null
        }
      });
      attachment = await attachAsset(asset.id, {
        target_type: "segment",
        target_id: segmentId,
        role: attachmentRole,
        note:
          action === "promote_to_decision"
            ? [promotedRole.replace(/_/g, " "), buildPromotionReasonSummary(ranked)].filter(Boolean).join(" В· ")
            : ""
      });
    }

    if (action === "use_as_source" || action === "promote_to_decision") {
      updatedDecision = await writeDecisionUpdate(context, segmentId, (current) => {
        const currentSources = Array.isArray(current?.research_sources) ? current.research_sources : [];
        const nextEntry = {
          url: normalizedUrl,
          title: result.title,
          domain: result.domain,
          snippet: result.snippet,
          applied_at: nowIso,
          role: action === "promote_to_decision" ? promotedRole : "source",
          attachment_role: attachmentRole,
          asset_id: asset?.id ?? null,
          scores: ranked
            ? {
                total_score: Number(ranked?.total_score ?? 0),
                source_score: Number(ranked?.source_score ?? 0),
                visual_score: Number(ranked?.visual_score ?? 0),
                montage_score: Number(ranked?.montage_score ?? 0)
              }
            : null,
          reason: buildPromotionReasonSummary(ranked)
        };
        const dedupedSources = [
          ...currentSources.filter((item) => normalizeUrl(item?.url) !== normalizedUrl),
          nextEntry
        ];
        const nextDecision = {
          ...current,
          research_sources: dedupedSources
        };
        if (action === "promote_to_decision") {
          if (promotedRole === "visual_candidate" || !hasVisualDecisionContent(current?.visual_decision)) {
            nextDecision.visual_decision = inferPromotedVisual(
              result,
              context.segment,
              current?.visual_decision ?? emptyVisualDecision()
            );
          }
          if (promotedRole !== "visual_candidate" || !hasSearchDecisionContent(current?.search_decision)) {
            nextDecision.search_decision = buildPromotedSearchDecision(
              result,
              context.segment,
              current?.search_decision ?? emptySearchDecision()
            );
          }
        }
        return nextDecision;
      });
    }

    const updatedRun = await markApplied(docId, runId, {
      result_id: resultId,
      action,
      asset_id: asset?.id ?? null,
      applied_at: nowIso,
      meta: {
        attachment_id: attachment?.id ?? null
      }
    });
    const sourceMemory = await recordSourceUsage({
      doc_id: docId,
      segment_id: segmentId,
      domain: result.domain,
      url: normalizedUrl,
      uploader: result?.uploader,
      uploader_url: result?.uploader_url,
      title: result.title,
      section_title: context.segment.section_title,
      text_quote: context.segment.text_quote,
      action,
      used_at: nowIso
    });

    await appendEvent(docId, {
      timestamp: nowIso,
      event: "segment_research_applied",
      payload: {
        segment_id: segmentId,
        run_id: runId,
        result_id: resultId,
        action,
        asset_id: asset?.id ?? null,
        attachment_id: attachment?.id ?? null
      }
    });

    return {
      ok: true,
      action,
      result,
      ranked,
      promoted_role: promotedRole || null,
      asset,
      attachment,
      decision: updatedDecision,
      screenshot_lab_url:
        action === "screenshot"
          ? buildScreenshotLabUrl({
              url: normalizedUrl,
              docId,
              segmentId,
              runId,
              resultId,
              title: result.title,
              textQuote: context.segment.text_quote
            })
          : null,
      download_url: action === "download" ? normalizedUrl : null,
      run: updatedRun,
      source_memory_summary: {
        total_domains: Object.keys(sourceMemory?.domains ?? {}).length,
        total_urls: Object.keys(sourceMemory?.urls ?? {}).length
      }
    };
  }

  async function removeResearchResult({ docId, segmentId, runId, resultId }) {
    const context = await loadSegmentContext(docId, segmentId);
    if (context.error) {
      const error = new Error(context.error);
      error.status = context.status;
      throw error;
    }
    const run = await getRunById(docId, runId);
    if (!run || String(run.segment_id ?? "") !== String(segmentId)) {
      const error = new Error("Research run not found");
      error.status = 404;
      throw error;
    }
    const result =
      (Array.isArray(run.results) ? run.results : []).find((item) => String(item?.id ?? "") === String(resultId ?? "")) ?? null;
    if (!result) {
      const error = new Error("Research result not found");
      error.status = 404;
      throw error;
    }

    const nextResults = (Array.isArray(run.results) ? run.results : []).filter(
      (item) => String(item?.id ?? "") !== String(resultId ?? "")
    );
    const nextRankedResults = (Array.isArray(run.ranked_results) ? run.ranked_results : []).filter(
      (item) => String(item?.result_id ?? "") !== String(resultId ?? "")
    );
    const nextApplied = [
      ...(Array.isArray(run.applied) ? run.applied : []).filter(
        (item) => !(String(item?.result_id ?? "") === String(resultId ?? "") && String(item?.action ?? "") !== "dismissed")
      ),
      {
        result_id: String(resultId ?? ""),
        action: "dismissed",
        asset_id: null,
        applied_at: new Date().toISOString(),
        meta: {
          url: normalizeUrl(result?.url),
          domain: compactText(result?.domain),
          title: compactText(result?.title)
        }
      }
    ];
    const nextSummary = buildResearchSummary(nextRankedResults, {
      queries: Array.isArray(run?.queries) ? run.queries : [],
      results: nextResults
    });
    const nextBrief = buildResearchBrief(nextResults, nextRankedResults, context.decision, { summary: nextSummary });
    const updatedRun = await saveRun(docId, {
      ...run,
      status: nextRankedResults.length > 0 ? "done" : "done_empty",
      results: nextResults,
      ranked_results: nextRankedResults,
      applied: nextApplied,
      summary: nextSummary,
      brief: nextBrief,
      updated_at: new Date().toISOString()
    });
    const updatedDecision = await writeDecisionUpdate(context, segmentId, (current) => ({
      ...current,
      research_dismissed_urls: appendDismissedResearchUrlEntries(current?.research_dismissed_urls, [
        {
          url: normalizeUrl(result?.url),
          domain: compactText(result?.domain),
          title: compactText(result?.title),
          dismissed_at: new Date().toISOString(),
          source: "research_remove"
        }
      ])
    }));
    await recordSourceUsage({
      doc_id: docId,
      segment_id: segmentId,
      domain: result.domain,
      url: normalizeUrl(result?.url),
      uploader: result?.uploader,
      uploader_url: result?.uploader_url,
      title: result.title,
      section_title: context.segment.section_title,
      text_quote: context.segment.text_quote,
      action: "dismissed",
      used_at: new Date().toISOString()
    });

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segment_research_result_removed",
      payload: {
        segment_id: segmentId,
        run_id: runId,
        result_id: resultId,
        url: normalizeUrl(result?.url)
      }
    });

    return {
      ok: true,
      run: updatedRun,
      decision: updatedDecision,
      removed_result_id: resultId
    };
  }

  app.get("/api/documents/:id/segments/:segmentId/research", async (req, res) => {
    try {
      const limit = Number.isFinite(Number(req.query?.limit)) ? Math.max(1, Number(req.query.limit)) : 8;
      const context = await loadSegmentContext(req.params.id, req.params.segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      const decorateRun = (item) =>
        item
          ? {
              ...item,
              brief: mergeStoredResearchBrief(
                item,
                buildResearchBrief(item.results, item.ranked_results, context.decision, { summary: item.summary })
              )
            }
          : null;
      const run = decorateRun(await getLatestRun(req.params.id, req.params.segmentId));
      const runs = (await listRunsForSegment(req.params.id, req.params.segmentId, { limit })).map((item) => decorateRun(item));
      res.json({ run, runs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id/segments/:segmentId/research/brief", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      const runId = String(req.query?.run_id ?? "").trim();
      const run = runId ? await getRunById(docId, runId) : await getLatestRun(docId, segmentId);
      if (!run || String(run.segment_id ?? "") !== String(segmentId)) {
        return res.status(404).json({ error: "Research run not found" });
      }
      const brief = mergeStoredResearchBrief(
        run,
        buildResearchBrief(run.results, run.ranked_results, context.decision, { summary: run.summary })
      );
      const format = String(req.query?.format ?? "").trim().toLowerCase();
      if (format === "md" || format === "txt") {
        const payload = formatResearchBriefExport({
          segment: context.segment,
          decision: context.decision,
          run,
          brief,
          format
        });
        res.type(format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8");
        return res.send(payload);
      }
      res.json({ brief, run_id: run.run_id, segment_id: segmentId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }

      const runId = `research_${Date.now()}_${nanoid(6)}`;
      const mode = String(req.body?.mode ?? "deep").trim().toLowerCase() === "fast" ? "fast" : "deep";
      const excludeSeen = Boolean(req.body?.exclude_seen);
      const segmentOverride = req.body?.segment_override && typeof req.body.segment_override === "object"
        ? req.body.segment_override
        : null;
      const effectiveSegment = segmentOverride
        ? {
            ...context.segment,
            section_id: segmentOverride?.section_id ? String(segmentOverride.section_id) : context.segment.section_id ?? null,
            section_title: segmentOverride?.section_title ? String(segmentOverride.section_title) : context.segment.section_title ?? null,
            text_quote: segmentOverride?.text_quote != null ? String(segmentOverride.text_quote) : context.segment.text_quote ?? "",
            research_use_topic_title: Boolean(segmentOverride?.research_use_topic_title),
            research_use_theme_tags: Boolean(segmentOverride?.research_use_theme_tags),
            topic_tags: Array.isArray(segmentOverride?.topic_tags)
              ? [...new Set(segmentOverride.topic_tags.map((item) => compactText(item)).filter(Boolean))].slice(0, 12)
              : Array.isArray(context.segment?.topic_tags)
                ? context.segment.topic_tags
                : [],
            section_tags: Array.isArray(segmentOverride?.section_tags)
              ? [...new Set(segmentOverride.section_tags.map((item) => compactText(item)).filter(Boolean))].slice(0, 12)
              : Array.isArray(context.segment?.section_tags)
                ? context.segment.section_tags
                : []
          }
        : {
            ...context.segment,
            research_use_topic_title: Boolean(context.segment?.research_use_topic_title),
            research_use_theme_tags: Boolean(context.segment?.research_use_theme_tags)
          };
      const effectiveSegmentWithContext = {
        ...effectiveSegment,
        ...buildSectionResearchContext(context.segments, effectiveSegment)
      };
      const rankingSegment = await enrichSegmentWithTranslatedText({
        ...effectiveSegmentWithContext,
        visual_decision: context.decision.visual_decision,
        search_decision: context.decision.search_decision
      }, translateHeadingToEnglishQuery);
      const sourceProfiles = await getSourceProfiles();
      const sourceMemory = await getSourceMemory();
      const queries = await generateSegmentResearchQueries(rankingSegment, { mode });
      const searchResult = await searchQueries(queries, {
        mode,
        seed_results: Array.isArray(req.body?.seed_results) ? req.body.seed_results : []
      });
      let filteredResults = dedupeResultsByUrl(searchResult.results);
      const warnings = Array.isArray(searchResult?.warnings) ? [...searchResult.warnings] : [];
      const blockedFilter = filterBlockedResearchResults(filteredResults, sourceProfiles);
      filteredResults = blockedFilter.allowed.length > 0 ? blockedFilter.allowed : blockedFilter.uaFallback;
      if (blockedFilter.blocked.length > 0) {
        warnings.push(`Skipped ${blockedFilter.blocked.length} blocked source result(s).`);
      }
      if (blockedFilter.uaFallback.length > 0 && blockedFilter.allowed.length > 0) {
        warnings.push(`Skipped ${blockedFilter.uaFallback.length} .ua result(s) because non-.ua sources were available.`);
      } else if (blockedFilter.uaFallback.length > 0 && blockedFilter.allowed.length === 0) {
        warnings.push(`Used ${blockedFilter.uaFallback.length} .ua result(s) as fallback because no other sources were found.`);
      }
      const documentScenarioLinks = collectDocumentScenarioLinkUrls(context.segments);
      const dismissedKeys = collectDismissedResearchUrlKeys(context.decision);
      if (dismissedKeys.size > 0) {
        const beforeDismissedCount = filteredResults.length;
        filteredResults = filteredResults.filter((item) => !dismissedKeys.has(normalizeUrlForKey(item?.url)));
        const removedDismissed = beforeDismissedCount - filteredResults.length;
        if (removedDismissed > 0) {
          warnings.push(`Skipped ${removedDismissed} previously dismissed link(s).`);
        }
      }
      if (documentScenarioLinks.size > 0) {
        const beforeDocumentDedupCount = filteredResults.length;
        filteredResults = filteredResults.filter((item) => !documentScenarioLinks.has(normalizeUrlForKey(item?.url)));
        const removedDocumentDuplicates = beforeDocumentDedupCount - filteredResults.length;
        if (removedDocumentDuplicates > 0) {
          warnings.push(`Skipped ${removedDocumentDuplicates} link(s) already present in document links.`);
        }
      }
      if (excludeSeen) {
        const previousRuns = await listRunsForSegment(docId, segmentId, { limit: 60 });
        const seenUrls = collectSeenResearchUrls(previousRuns);
        const beforeExcludeCount = filteredResults.length;
        filteredResults = filteredResults.filter((item) => !seenUrls.has(normalizeUrlForKey(item?.url)));
        const removedCount = beforeExcludeCount - filteredResults.length;
        if (removedCount > 0) {
          warnings.push(`Skipped ${removedCount} previously seen result(s).`);
        }
        if (beforeExcludeCount > 0 && filteredResults.length === 0) {
          warnings.push("No new links left after excluding previous runs.");
        }
      }
      const llmScores = await rankSegmentResearchResults(rankingSegment, filteredResults, sourceProfiles);
      const rankedResults = mergeResearchScores(
        filteredResults,
        llmScores,
        sourceProfiles,
        sourceMemory,
        {
          section_title: effectiveSegmentWithContext.section_title,
          research_use_topic_title: Boolean(effectiveSegmentWithContext?.research_use_topic_title),
          research_use_theme_tags: Boolean(effectiveSegmentWithContext?.research_use_theme_tags),
          topic_tags: Array.isArray(effectiveSegmentWithContext?.topic_tags) ? effectiveSegmentWithContext.topic_tags : [],
          section_tags: Array.isArray(effectiveSegmentWithContext?.section_tags) ? effectiveSegmentWithContext.section_tags : [],
          text_quote: effectiveSegmentWithContext.text_quote,
          section_context_text: effectiveSegmentWithContext.section_context_text ?? "",
          section_link_hints: Array.isArray(effectiveSegmentWithContext?.section_link_hints)
            ? effectiveSegmentWithContext.section_link_hints
            : [],
          translated_text_quote: rankingSegment.translated_text_quote ?? "",
          visual_description: context.decision?.visual_decision?.description ?? "",
          search_queries: Array.isArray(context.decision?.search_decision?.queries) ? context.decision.search_decision.queries : [],
          search_keywords: Array.isArray(context.decision?.search_decision?.keywords) ? context.decision.search_decision.keywords : []
        }
      );
      const storyDedupe = dedupeRankedResearchResultsByStory(filteredResults, rankedResults);
      filteredResults = storyDedupe.results;
      const finalRankedResults = storyDedupe.ranked_results;
      if (storyDedupe.removed_count > 0) {
        warnings.push(
          `Collapsed ${storyDedupe.removed_count} repeat story result(s) into ${storyDedupe.cluster_count} cluster(s).`
        );
      }
      const summary = buildResearchSummary(finalRankedResults, {
        queries,
        results: filteredResults
      });
      const brief = buildResearchBrief(filteredResults, finalRankedResults, context.decision, { summary });
      const nowIso = new Date().toISOString();
      const status = finalRankedResults.length > 0 ? "done" : "done_empty";
      const run = await saveRun(docId, {
        run_id: runId,
        segment_id: segmentId,
        section_id: context.segment.section_id ?? null,
        section_title: context.segment.section_title ?? null,
        status,
        mode,
        queries,
        results: filteredResults,
        ranked_results: finalRankedResults,
        summary,
        brief,
        warnings,
        applied: [],
        created_at: nowIso,
        updated_at: nowIso
      });

      await appendEvent(docId, {
        timestamp: nowIso,
        event: "segment_research_run",
        payload: {
          segment_id: segmentId,
          run_id: runId,
          mode,
          queries: queries.length,
          results: filteredResults.length,
          phases: summary?.phases ?? [],
          warnings
        }
      });

      res.status(201).json({ run });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research/apply", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const runId = String(req.body?.run_id ?? "").trim();
      const resultId = String(req.body?.result_id ?? "").trim();
      const action = String(req.body?.action ?? "").trim();
      if (!runId || !resultId || !action) {
        return res.status(400).json({ error: "run_id, result_id and action are required" });
      }
      if (!RESEARCH_APPLY_ACTIONS.has(action)) {
        return res.status(400).json({ error: `Unsupported research action: ${action}` });
      }

      const payload = await applyResearchAction({
        docId,
        segmentId,
        runId,
        resultId,
        action
      });
      return res.json(payload);

      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      const run = await getRunById(docId, runId);
      if (!run || String(run.segment_id ?? "") !== String(segmentId)) {
        return res.status(404).json({ error: "Research run not found" });
      }
      const result =
        (Array.isArray(run.results) ? run.results : []).find((item) => String(item?.id ?? "") === resultId) ?? null;
      if (!result) {
        return res.status(404).json({ error: "Research result not found" });
      }
      const ranked =
        (Array.isArray(run.ranked_results) ? run.ranked_results : []).find(
          (item) => String(item?.result_id ?? "") === resultId
        ) ?? null;

      const normalizedUrl = normalizeUrl(result.url);
      if (!normalizedUrl) {
        return res.status(400).json({ error: "Research result URL is invalid" });
      }

      let asset = null;
      let attachment = null;
      let updatedDecision = null;
      const nowIso = new Date().toISOString();
      const promotedRole = action === "promote_to_decision" ? inferPromotedRole(ranked, context.decision) : "";
      const attachmentRole =
        action === "attach_asset"
          ? "reference"
          : action === "download"
            ? "source"
            : action === "screenshot"
              ? "screenshot_candidate"
              : action === "promote_to_decision"
                ? mapPromotedAttachmentRole(promotedRole)
                : "source";

      if (["attach_asset", "screenshot", "download", "promote_to_decision"].includes(action)) {
        asset = await createAsset({
          kind: "link",
          status: action === "download" ? "new" : "attached",
          title: result.title,
          description: result.snippet,
          source_url: normalizedUrl,
          source_domain: result.domain,
          meta_json: {
            research_run_id: runId,
            research_result_id: resultId,
            content_type: result.content_type,
            published_at: result.published_at,
            promoted_role: promotedRole || null,
            ranked_scores: ranked
              ? {
                  total_score: Number(ranked?.total_score ?? 0),
                  source_score: Number(ranked?.source_score ?? 0),
                  visual_score: Number(ranked?.visual_score ?? 0),
                  montage_score: Number(ranked?.montage_score ?? 0),
                  downloadability_score: Number(ranked?.downloadability_score ?? 0)
                }
              : null
          }
        });
        attachment = await attachAsset(asset.id, {
          target_type: "segment",
          target_id: segmentId,
          role: attachmentRole,
          note:
            action === "promote_to_decision"
              ? [promotedRole.replace(/_/g, " "), buildPromotionReasonSummary(ranked)].filter(Boolean).join(" · ")
              : ""
        });
      }

      if (action === "use_as_source" || action === "promote_to_decision") {
        updatedDecision = await writeDecisionUpdate(context, segmentId, (current) => {
          const currentSources = Array.isArray(current?.research_sources) ? current.research_sources : [];
          const nextDecision = {
            ...current,
            research_sources: [
              ...currentSources,
              {
                url: normalizedUrl,
                title: result.title,
                domain: result.domain,
                snippet: result.snippet,
                applied_at: nowIso,
                role: action === "promote_to_decision" ? promotedRole : "source",
                attachment_role: attachmentRole,
                asset_id: asset?.id ?? null,
                scores: ranked
                  ? {
                      total_score: Number(ranked?.total_score ?? 0),
                      source_score: Number(ranked?.source_score ?? 0),
                      visual_score: Number(ranked?.visual_score ?? 0),
                      montage_score: Number(ranked?.montage_score ?? 0)
                    }
                  : null,
                reason: buildPromotionReasonSummary(ranked)
              }
            ]
          };
          if (action === "promote_to_decision") {
            if (promotedRole === "visual_candidate" || !hasVisualDecisionContent(current?.visual_decision)) {
              nextDecision.visual_decision = inferPromotedVisual(
                result,
                context.segment,
                current?.visual_decision ?? emptyVisualDecision()
              );
            }
            if (promotedRole !== "visual_candidate" || !hasSearchDecisionContent(current?.search_decision)) {
              nextDecision.search_decision = buildPromotedSearchDecision(
                result,
                context.segment,
                current?.search_decision ?? emptySearchDecision()
              );
            }
          }
          return nextDecision;
        });
      }

      const updatedRun = await markApplied(docId, runId, {
        result_id: resultId,
        action,
        asset_id: asset?.id ?? null,
        applied_at: nowIso,
        meta: {
          attachment_id: attachment?.id ?? null
        }
      });
      const sourceMemory = await recordSourceUsage({
        doc_id: docId,
        segment_id: segmentId,
        domain: result.domain,
        url: normalizedUrl,
        uploader: result?.uploader,
        uploader_url: result?.uploader_url,
        title: result.title,
        section_title: context.segment.section_title,
        text_quote: context.segment.text_quote,
        action,
        used_at: nowIso
      });

      await appendEvent(docId, {
        timestamp: nowIso,
        event: "segment_research_applied",
        payload: {
          segment_id: segmentId,
          run_id: runId,
          result_id: resultId,
          action,
          asset_id: asset?.id ?? null,
          attachment_id: attachment?.id ?? null
        }
      });

      res.json({
        ok: true,
        action,
        result,
        ranked,
        promoted_role: promotedRole || null,
        asset,
        attachment,
        decision: updatedDecision,
        screenshot_lab_url:
          action === "screenshot"
          ? buildScreenshotLabUrl({
              url: normalizedUrl,
              docId,
              segmentId,
              runId,
              resultId,
              title: result.title,
              textQuote: context.segment.text_quote
            })
          : null,
        download_url: action === "download" ? normalizedUrl : null,
        run: updatedRun,
        source_memory_summary: {
          total_domains: Object.keys(sourceMemory?.domains ?? {}).length,
          total_urls: Object.keys(sourceMemory?.urls ?? {}).length
        }
      });
    } catch (error) {
      res.status(error?.status ?? 500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research/apply-bundle", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const runId = String(req.body?.run_id ?? "").trim();
      const sourceResultId = String(req.body?.source_result_id ?? "").trim();
      const visualResultId = String(req.body?.visual_result_id ?? "").trim();
      if (!runId || !sourceResultId || !visualResultId) {
        return res.status(400).json({ error: "run_id, source_result_id and visual_result_id are required" });
      }

      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      let currentRun = await getRunById(docId, runId);
      if (!currentRun || String(currentRun?.segment_id ?? "") !== String(segmentId)) {
        return res.status(404).json({ error: "Research run not found" });
      }

      const resultIds = [...new Set([sourceResultId, visualResultId].filter(Boolean))];
      const applied = [];
      let sourcePayload = null;
      let visualPayload = null;
      let lastPayload = null;
      for (const resultId of resultIds) {
        lastPayload = await applyResearchAction({
          docId,
          segmentId,
          runId,
          resultId,
          action: "promote_to_decision",
          context,
          run: currentRun
        });
        currentRun = lastPayload?.run ?? currentRun;
        applied.push({
          result_id: resultId,
          promoted_role: lastPayload?.promoted_role ?? null,
          asset_id: lastPayload?.asset?.id ?? null,
          attachment_id: lastPayload?.attachment?.id ?? null
        });
        if (resultId === sourceResultId) sourcePayload = lastPayload;
        if (resultId === visualResultId) visualPayload = lastPayload;
      }

      const bundleTraceAppliedAt = new Date().toISOString();
      const updatedDecision = await writeDecisionUpdate(context, segmentId, (current) => ({
        ...current,
        research_bundle_trace: {
          run_id: runId,
          source_result_id: sourceResultId,
          visual_result_id: visualResultId,
          applied_at: bundleTraceAppliedAt,
          source: sourcePayload
            ? {
                result_id: sourceResultId,
                title: sourcePayload?.result?.title ?? "",
                domain: sourcePayload?.result?.domain ?? "",
                url: sourcePayload?.result?.url ?? "",
                role: sourcePayload?.promoted_role ?? "",
                asset_id: sourcePayload?.asset?.id ?? "",
                attachment_id: sourcePayload?.attachment?.id ?? ""
              }
            : null,
          visual: visualPayload
            ? {
                result_id: visualResultId,
                title: visualPayload?.result?.title ?? "",
                domain: visualPayload?.result?.domain ?? "",
                url: visualPayload?.result?.url ?? "",
                role: visualPayload?.promoted_role ?? "",
                asset_id: visualPayload?.asset?.id ?? "",
                attachment_id: visualPayload?.attachment?.id ?? ""
              }
            : null
        }
      }));

      await appendEvent(docId, {
        timestamp: bundleTraceAppliedAt,
        event: "segment_research_bundle_applied",
        payload: {
          segment_id: segmentId,
          run_id: runId,
          result_ids: resultIds,
          applied_count: applied.length
        }
      });

      res.json({
        ok: true,
        action: "promote_bundle_to_decision",
        run: lastPayload?.run ?? currentRun,
        decision: updatedDecision ?? context.decision ?? lastPayload?.decision ?? null,
        bundle: {
          source_result_id: sourceResultId,
          visual_result_id: visualResultId,
          applied
        },
        source_memory_summary: lastPayload?.source_memory_summary ?? null
      });
    } catch (error) {
      res.status(error?.status ?? 500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research/apply-many", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const runId = String(req.body?.run_id ?? "").trim();
      const action = String(req.body?.action ?? "use_as_source").trim();
      const resultIds = [...new Set(
        (Array.isArray(req.body?.result_ids) ? req.body.result_ids : [])
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      )];
      if (!runId || !resultIds.length) {
        return res.status(400).json({ error: "run_id and result_ids are required" });
      }
      if (action !== "use_as_source") {
        return res.status(400).json({ error: "apply-many currently supports only use_as_source" });
      }

      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      let currentRun = await getRunById(docId, runId);
      if (!currentRun || String(currentRun?.segment_id ?? "") !== String(segmentId)) {
        return res.status(404).json({ error: "Research run not found" });
      }

      const applied = [];
      let lastPayload = null;
      for (const resultId of resultIds) {
        lastPayload = await applyResearchAction({
          docId,
          segmentId,
          runId,
          resultId,
          action,
          context,
          run: currentRun
        });
        currentRun = lastPayload?.run ?? currentRun;
        applied.push({
          result_id: resultId,
          url: normalizeUrl(lastPayload?.result?.url),
          title: compactText(lastPayload?.result?.title),
          domain: compactText(lastPayload?.result?.domain)
        });
      }

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "segment_research_bulk_applied",
        payload: {
          segment_id: segmentId,
          run_id: runId,
          action,
          result_ids: resultIds,
          applied_count: applied.length
        }
      });

      res.json({
        ok: true,
        action,
        applied,
        decision: context.decision ?? lastPayload?.decision ?? null,
        run: lastPayload?.run ?? currentRun,
        source_memory_summary: lastPayload?.source_memory_summary ?? null
      });
    } catch (error) {
      res.status(error?.status ?? 500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research/remove", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const runId = String(req.body?.run_id ?? "").trim();
      const resultId = String(req.body?.result_id ?? "").trim();
      if (!runId || !resultId) {
        return res.status(400).json({ error: "run_id and result_id are required" });
      }

      const payload = await removeResearchResult({
        docId,
        segmentId,
        runId,
        resultId
      });
      res.json(payload);
    } catch (error) {
      res.status(error?.status ?? 500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segments/:segmentId/research/dismiss", async (req, res) => {
    try {
      const docId = req.params.id;
      const segmentId = req.params.segmentId;
      const context = await loadSegmentContext(docId, segmentId);
      if (context.error) {
        return res.status(context.status).json({ error: context.error });
      }
      const url = normalizeUrl(req.body?.url);
      if (!url) {
        return res.status(400).json({ error: "url is required" });
      }
      const title = compactText(req.body?.title);
      const domain = compactText(req.body?.domain);
      const source = compactText(req.body?.source) || "research_dismiss";
      const dismissedAt = new Date().toISOString();
      const updatedDecision = await writeDecisionUpdate(context, segmentId, (current) => ({
        ...current,
        research_dismissed_urls: appendDismissedResearchUrlEntries(current?.research_dismissed_urls, [
          {
            url,
            title,
            domain,
            dismissed_at: dismissedAt,
            source
          }
        ])
      }));
      await appendEvent(docId, {
        timestamp: dismissedAt,
        event: "segment_research_url_dismissed",
        payload: {
          segment_id: segmentId,
          url,
          title,
          domain,
          source
        }
      });
      res.json({
        ok: true,
        decision: updatedDecision,
        dismissed_url: url
      });
    } catch (error) {
      res.status(error?.status ?? 500).json({ error: error.message });
    }
  });
}
