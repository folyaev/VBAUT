import { domainMatches } from "./source-profiles.js";
import { extractSourceScopeKey } from "./source-identity.js";

function sortByScore(items = []) {
  return [...items].sort((a, b) => Number(b?.total_score ?? 0) - Number(a?.total_score ?? 0));
}

function clampScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasCyrillic(value) {
  return /[\u0400-\u04FF]/u.test(String(value ?? ""));
}

function hasLatin(value) {
  return /[a-z]/i.test(String(value ?? ""));
}

function parseReasonTagCounter(tags = [], prefix = "") {
  const normalizedPrefix = compactText(prefix).toLowerCase();
  if (!normalizedPrefix) return 0;
  const match = (Array.isArray(tags) ? tags : []).find((tag) =>
    compactText(tag).toLowerCase().startsWith(`${normalizedPrefix}:`)
  );
  if (!match) return 0;
  const value = Number(String(match).split(":")[1]);
  return Number.isFinite(value) ? value : 0;
}

function buildResearchMemoryHint(ranked = {}) {
  const helpfulCount = parseReasonTagCounter(ranked?.reason_tags, "helpful");
  const usageCount = Number(ranked?.memory_usage_count ?? 0);
  const parts = [];
  if (helpfulCount > 0) {
    parts.push(helpfulCount > 1 ? `Helpful x${helpfulCount}` : "Helpful before");
  }
  if (usageCount > 0) {
    parts.push(usageCount > 1 ? `Used x${usageCount}` : "Used before");
  }
  return parts.join(" · ");
}

function formatReasonTagLabel(tag) {
  const normalized = compactText(tag).toLowerCase();
  if (!normalized || normalized.startsWith("helpful:") || normalized.startsWith("used_before:")) return "";
  if (normalized === "ru_blocked") return "RU blocked";
  if (normalized === "responsive") return "Responsive";
  if (normalized === "watermarks") return "Watermarks";
  if (normalized === "dismissed_before") return "Dismissed before";
  if (normalized === "duplicate_story") return "Repeat story";
  if (normalized === "bad_visual_history") return "Weak visual history";
  if (normalized === "screenshot_fail_risk") return "Screenshot risk";
  if (normalized === "download_fail_risk") return "Download risk";
  if (normalized === "paywall_prone") return "Paywall prone";
  if (normalized === "anti_bot_prone") return "Anti-bot prone";
  if (normalized === "age_gate_prone") return "Age-gate prone";
  if (normalized.startsWith("story_cluster:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Story dupes x${value}` : "Story dupes";
  }
  if (normalized === "youtube") return "YouTube first";
  if (normalized === "preferred_article") return "Preferred article";
  if (normalized.startsWith("quality:")) return String(tag).split(":")[1] || "";
  if (normalized.startsWith("lang:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Lang ${value.toUpperCase()}` : "";
  }
  if (normalized === "high_similarity") return "High similarity";
  if (normalized.startsWith("similar_segments:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Similar x${value}` : "";
  }
  if (normalized.startsWith("search_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Search x${value}` : "";
  }
  if (normalized.startsWith("topic_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Topic x${value}` : "";
  }
  if (normalized.startsWith("visual_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Visual x${value}` : "";
  }
  if (normalized.startsWith("text_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Text x${value}` : "";
  }
  return String(tag ?? "").trim().replace(/_/g, " ");
}

function buildResearchMetadataHint(ranked = {}) {
  const tags = (Array.isArray(ranked?.reason_tags) ? ranked.reason_tags : [])
    .map(formatReasonTagLabel)
    .filter(Boolean)
    .slice(0, 4);
  return tags.join(" В· ");
}

export const RESEARCH_CATEGORY_ORDER = ["video", "preview", "quotes", "images", "other"];

function isDirectImageUrl(url = "") {
  return /\.(png|jpe?g|webp|gif|bmp|avif)(?:$|[?#])/i.test(String(url ?? "").trim());
}

function isVideoPlatformUrl(url = "", domain = "", hints = []) {
  const normalizedUrl = compactText(url).toLowerCase();
  const normalizedDomain = compactText(domain).toLowerCase();
  const hintList = Array.isArray(hints) ? hints.map((item) => compactText(item).toLowerCase()) : [];
  if (domainMatches(normalizedDomain, ["youtube.com", "youtu.be", "rutube.ru", "vimeo.com", "dailymotion.com"])) {
    return true;
  }
  if (normalizedDomain === "vkvideo.ru") return true;
  if ((normalizedDomain === "vk.com" || normalizedDomain === "vk.ru") && /\/video/i.test(normalizedUrl)) return true;
  if (normalizedDomain === "ok.ru" && /(\/video|\/live)/i.test(normalizedUrl)) return true;
  if ((normalizedDomain === "x.com" || normalizedDomain === "twitter.com") && /\/status\//i.test(normalizedUrl)) {
    return true;
  }
  return hintList.some((item) => ["video", "video_platform", "youtube", "downloadable"].includes(item));
}

export function categorizeResearchResult(result = {}, ranked = {}, sourceProfiles = {}) {
  const domain = compactText(result?.domain).toLowerCase();
  const url = compactText(result?.url);
  const contentType = compactText(result?.content_type).toLowerCase();
  const hints = Array.isArray(ranked?.visual_hints) ? ranked.visual_hints : [];

  if (isVideoPlatformUrl(url, domain, hints) || contentType.includes("video")) {
    return { id: "video", label: "Video" };
  }
  if (domainMatches(domain, sourceProfiles?.preview_image_domains)) {
    return { id: "preview", label: "Preview" };
  }
  if (domainMatches(domain, sourceProfiles?.preferred_article_domains)) {
    return { id: "quotes", label: "Quotes & Headlines" };
  }
  if (
    contentType.includes("image") ||
    isDirectImageUrl(url) ||
    hints.map((item) => compactText(item).toLowerCase()).includes("image")
  ) {
    return { id: "images", label: "Images" };
  }
  return { id: "other", label: "Other" };
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

function tokenizeSegmentText(...parts) {
  return [...new Set(
    parts
      .map((item) => compactText(item).toLowerCase())
      .join(" ")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
      .slice(0, 24)
  )];
}

function shouldUseTopicTitle(segmentContext = {}) {
  return Boolean(segmentContext?.research_use_topic_title);
}

function shouldUseThemeTags(segmentContext = {}) {
  return Boolean(segmentContext?.research_use_theme_tags);
}

function hasSavedSearchQueries(segmentContext = {}) {
  return Array.isArray(segmentContext?.search_queries)
    ? segmentContext.search_queries.some((item) => compactText(item))
    : false;
}

function hasVisualPriorityInput(segmentContext = {}) {
  return Boolean(compactText(segmentContext?.visual_description));
}

function deriveResearchPriorityMode(segmentContext = {}) {
  if (hasSavedSearchQueries(segmentContext)) return "search";
  if (hasVisualPriorityInput(segmentContext)) return "visual";
  return "text";
}

function getSegmentTextSignals(segmentContext = {}) {
  const textQuote = compactText(segmentContext?.text_quote);
  const translatedTextQuote = compactText(segmentContext?.translated_text_quote);
  return {
    textQuote,
    translatedTextQuote:
      translatedTextQuote && translatedTextQuote.toLowerCase() !== textQuote.toLowerCase()
        ? translatedTextQuote
        : ""
  };
}

function getSectionResearchSignals(segmentContext = {}) {
  return {
    sectionContextText: compactText(segmentContext?.section_context_text),
    sectionLinkHints: Array.isArray(segmentContext?.section_link_hints) ? segmentContext.section_link_hints : []
  };
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
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw) && !seen.has(raw.toLowerCase())) {
        seen.add(raw.toLowerCase());
        domains.push(raw.toLowerCase());
      }
    }
  });
  return domains.slice(0, 4);
}

function inferPreferredResearchLanguage(segmentContext = {}) {
  const searchQueries = Array.isArray(segmentContext?.search_queries) ? segmentContext.search_queries : [];
  const { sectionContextText } = getSectionResearchSignals(segmentContext);
  if (searchQueries.some((item) => compactText(item))) {
    return searchQueries.some((item) => hasCyrillic(item)) ? "ru" : "en";
  }
  if (hasCyrillic(segmentContext?.visual_description)) return "ru";
  if (hasCyrillic(segmentContext?.text_quote)) return "ru";
  if (hasCyrillic(sectionContextText)) return "ru";
  return "en";
}

function getLanguagePreferenceSignals(result = {}, segmentContext = {}) {
  const preferredLang = inferPreferredResearchLanguage(segmentContext);
  const visibleText = `${compactText(result?.title)} ${compactText(result?.snippet)}`;
  const cyrillic = hasCyrillic(visibleText);
  const latin = hasLatin(visibleText);
  if (preferredLang === "ru") {
    return {
      preferred_language: preferredLang,
      language_bonus: cyrillic ? 0.08 : latin ? -0.06 : 0,
      language_match: cyrillic
    };
  }
  return {
    preferred_language: preferredLang,
    language_bonus: latin ? 0.05 : cyrillic ? -0.04 : 0,
    language_match: latin
  };
}

function deriveTopicTags(segmentContext = {}) {
  const titleTokens = shouldUseTopicTitle(segmentContext)
    ? tokenizeSegmentText(segmentContext?.section_title)
    : [];
  const themeTags = shouldUseThemeTags(segmentContext)
    ? [
        ...(Array.isArray(segmentContext?.topic_tags) ? segmentContext.topic_tags : []),
        ...(Array.isArray(segmentContext?.section_tags) ? segmentContext.section_tags : [])
      ]
    : [];
  return [...new Set(
    [...titleTokens, ...themeTags]
      .map((item) => compactText(item).toLowerCase())
      .filter(Boolean)
  )].slice(0, 8);
}

function countTokenHits(haystack = "", tokens = []) {
  const normalizedHaystack = compactText(haystack).toLowerCase();
  if (!normalizedHaystack) return 0;
  return (Array.isArray(tokens) ? tokens : []).filter((token) => normalizedHaystack.includes(token)).length;
}

function getIntentSignals(result = {}, segmentContext = {}) {
  const haystack = [
    result?.title,
    result?.snippet,
    result?.url,
    result?.domain
  ]
    .map((item) => compactText(item))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) {
    return {
      search_match_score: 0,
      topic_match_score: 0,
      visual_match_score: 0,
      text_match_score: 0,
      search_hits: 0,
      topic_hits: 0,
      visual_hits: 0,
      text_hits: 0,
      priority_mode: deriveResearchPriorityMode(segmentContext)
    };
  }
  const priorityMode = deriveResearchPriorityMode(segmentContext);
  const { textQuote, translatedTextQuote } = getSegmentTextSignals(segmentContext);
  const { sectionContextText, sectionLinkHints } = getSectionResearchSignals(segmentContext);
  const searchTokens = tokenizeSegmentText(
    ...(Array.isArray(segmentContext?.search_queries) ? segmentContext.search_queries : []),
    ...(Array.isArray(segmentContext?.search_keywords) ? segmentContext.search_keywords : []),
    ...extractResearchLinkHintDomains(sectionLinkHints)
  );
  const topicTokens = deriveTopicTags(segmentContext);
  const visualTokens = tokenizeSegmentText(segmentContext?.visual_description);
  const textTokens = tokenizeSegmentText(textQuote, translatedTextQuote, sectionContextText);
  const searchHits = countTokenHits(haystack, searchTokens);
  const topicHits = countTokenHits(haystack, topicTokens);
  const visualHits = countTokenHits(haystack, visualTokens);
  const textHits = countTokenHits(haystack, textTokens);
  const searchScore = priorityMode === "search"
    ? Math.min(0.26, searchHits * 0.05)
    : Math.min(0.08, searchHits * 0.025);
  const visualScore = priorityMode === "visual"
    ? Math.min(0.24, visualHits * 0.055)
    : Math.min(0.08, visualHits * 0.03);
  const textScore = priorityMode === "text"
    ? Math.min(0.24, textHits * 0.05)
    : Math.min(0.08, textHits * 0.025);
  const topicScore = Math.min(priorityMode === "text" ? 0.12 : 0.08, topicHits * 0.03);
  return {
    search_match_score: clampScore(searchScore),
    topic_match_score: clampScore(topicScore),
    visual_match_score: clampScore(visualScore),
    text_match_score: clampScore(textScore),
    search_hits: searchHits,
    topic_hits: topicHits,
    visual_hits: visualHits,
    text_hits: textHits,
    priority_mode: priorityMode
  };
}

function getDomainProfile(domain, sourceProfiles = {}) {
  const normalizedDomain = compactText(domain).toLowerCase();
  if (!normalizedDomain) return null;
  const entries = Object.entries(sourceProfiles?.domain_profiles ?? {});
  for (const [candidate, profile] of entries) {
    if (normalizedDomain === candidate || normalizedDomain.endsWith(`.${candidate}`)) {
      return profile;
    }
  }
  return null;
}

function normalizeQualityLabel(value) {
  const normalized = compactText(value).toLowerCase();
  if (!normalized) return "";
  const direct = normalized.match(/(\d{3,4}p)/);
  if (direct?.[1]) return direct[1];
  if (normalized.includes("2160") || normalized.includes("4k")) return "2160p";
  if (normalized.includes("1440")) return "1440p";
  if (normalized.includes("1080")) return "1080p";
  if (normalized.includes("720")) return "720p";
  if (normalized.includes("480")) return "480p";
  return "";
}

function buildProfileMetadata(profile = null) {
  if (!profile || typeof profile !== "object") return null;
  const quality = normalizeQualityLabel(profile.default_video_quality);
  const language = compactText(profile.language).toLowerCase();
  const notes = compactText(profile.notes);
  return {
    language,
    blocked_in_rf: Boolean(profile.blocked_in_rf),
    responsive_design: Boolean(profile.responsive_design),
    default_video_quality: quality,
    watermarks: Boolean(profile.watermarks),
    notes
  };
}

function detectSourceKind(result = {}, sourceProfiles = {}) {
  const domain = compactText(result?.domain).toLowerCase();
  const contentType = compactText(result?.content_type).toLowerCase();
  if (domainMatches(domain, sourceProfiles?.video_platform_domains)) return "video_platform";
  if (domainMatches(domain, sourceProfiles?.social_domains)) return "social";
  if (contentType.includes("image")) return "image_result";
  if (contentType.includes("video")) return "video_result";
  if (domainMatches(domain, sourceProfiles?.trusted_domains)) return "wire_or_major_news";
  return "article";
}

function getHeuristicSignals(result = {}, sourceProfiles = {}) {
  const domain = compactText(result?.domain).toLowerCase();
  const haystack = `${compactText(result?.title)} ${compactText(result?.snippet)} ${compactText(result?.url)}`.toLowerCase();
  const contentType = compactText(result?.content_type).toLowerCase();
  const sourceKind = detectSourceKind(result, sourceProfiles);
  const profile = getDomainProfile(domain, sourceProfiles);
  const profileMetadata = buildProfileMetadata(profile);
  const isPreferredArticleDomain = domainMatches(domain, sourceProfiles?.preferred_article_domains);
  const isYouTubeDomain = domainMatches(domain, ["youtube.com", "youtu.be"]);
  const visualHints = [];

  let visual = 0.22;
  let source = 0.3;
  let downloadability = 0.3;
  const freshness = result?.published_at ? 0.72 : 0.42;

  if (/(video|footage|watch|clip|live|raw)/.test(haystack) || contentType.includes("video")) {
    visual += 0.34;
    downloadability += 0.2;
    visualHints.push("video");
  }
  if (/(photo|image|gallery|slideshow|pictures)/.test(haystack) || contentType.includes("image")) {
    visual += 0.22;
    visualHints.push("image");
  }
  if (/(screenshot|thread|post|tweet)/.test(haystack) || sourceKind === "social") {
    visual += 0.14;
    downloadability += 0.08;
    visualHints.push("screenshot");
  }
  if (domainMatches(domain, sourceProfiles?.downloadable_domains)) {
    downloadability += 0.3;
    visualHints.push("downloadable");
  }
  if (isPreferredArticleDomain) {
    source += 0.42;
    visual += 0.08;
    visualHints.push("preferred_article");
  }
  if (domainMatches(domain, sourceProfiles?.trusted_domains) || profile?.trusted) {
    source += 0.32;
    visualHints.push("trusted");
  } else if (domainMatches(domain, sourceProfiles?.blocked_domains) || profile?.blocked) {
    source -= 0.08;
    visual -= 0.04;
    visualHints.push("low_trust");
  } else {
    source += 0.12;
  }
  if (domainMatches(domain, sourceProfiles?.screenshot_friendly_domains) || profile?.screenshot_friendly) {
    visual += 0.12;
    visualHints.push("screenshot_friendly");
  }
  if (sourceKind === "wire_or_major_news") source += 0.1;
  if (sourceKind === "video_platform") {
    source += 0.08;
    visual += 0.18;
    downloadability += 0.18;
    visualHints.push("video_platform");
  }
  if (isYouTubeDomain) {
    source += 0.12;
    visual += 0.16;
    downloadability += 0.16;
    visualHints.push("youtube");
  }
  if (profile) {
    source += Number(profile.source_bias ?? 0);
    visual += Number(profile.visual_bias ?? 0);
    downloadability += Number(profile.downloadability_bias ?? 0);
    if (profile.downloadable) visualHints.push("downloadable");
    if (profile.screenshot_friendly) visualHints.push("screenshot_friendly");
    if (profile.trusted) visualHints.push("trusted");
  }
  if (profileMetadata?.responsive_design) {
    source += 0.05;
    visual += 0.03;
  }
  if (profileMetadata?.blocked_in_rf) {
    source -= 0.28;
    visual -= 0.14;
    downloadability -= 0.08;
  }
  if (profileMetadata?.watermarks) {
    visual -= 0.08;
  }
  if (profileMetadata?.default_video_quality === "2160p") {
    visual += 0.1;
    downloadability += 0.08;
  } else if (profileMetadata?.default_video_quality === "1440p" || profileMetadata?.default_video_quality === "1080p") {
    visual += 0.08;
    downloadability += 0.06;
  } else if (profileMetadata?.default_video_quality === "720p") {
    visual += 0.04;
    downloadability += 0.03;
  } else if (profileMetadata?.default_video_quality === "480p") {
    visual -= 0.03;
  }

  const montageScore = clampScore((visual * 0.5) + (downloadability * 0.3) + (source * 0.2));
  return {
    visual_score: clampScore(visual),
    source_score: clampScore(source),
    freshness_score: clampScore(freshness),
    downloadability_score: clampScore(downloadability),
    montage_score: montageScore,
    source_kind: sourceKind,
    visual_hints: [...new Set(visualHints)],
    profile_metadata: profileMetadata
  };
}

function getMemorySignals(result = {}, sourceMemory = {}) {
  const domain = compactText(result?.domain).toLowerCase();
  const url = compactText(result?.url);
  const sourceScopeKey = extractSourceScopeKey({
    domain,
    url,
    uploader: result?.uploader,
    uploaderUrl: result?.uploader_url
  });
  const hasScopedSource = sourceScopeKey && sourceScopeKey !== domain;
  const domainStats = hasScopedSource
    ? (sourceMemory?.domains?.[sourceScopeKey] ?? null)
    : (sourceMemory?.domains?.[domain] ?? null);
  const urlStats = sourceMemory?.urls?.[url] ?? null;
  const usageCount = Number(domainStats?.applied_count ?? 0) + Number(urlStats?.applied_count ?? 0);
  const dismissedCount = Number(domainStats?.dismissed_count ?? 0) + Number(urlStats?.dismissed_count ?? 0);
  const duplicateStoryCount = Number(domainStats?.duplicate_story_count ?? 0) + Number(urlStats?.duplicate_story_count ?? 0);
  const badVisualCount = Number(domainStats?.bad_visual_count ?? 0) + Number(urlStats?.bad_visual_count ?? 0);
  const screenshotFailCount =
    Number(domainStats?.screenshot_fail_count ?? 0) + Number(urlStats?.screenshot_fail_count ?? 0);
  const downloadFailCount = Number(domainStats?.download_fail_count ?? 0) + Number(urlStats?.download_fail_count ?? 0);
  const paywallCount = Number(domainStats?.paywall_count ?? 0) + Number(urlStats?.paywall_count ?? 0);
  const antiBotCount = Number(domainStats?.anti_bot_count ?? 0) + Number(urlStats?.anti_bot_count ?? 0);
  const ageGateCount = Number(domainStats?.age_gate_count ?? 0) + Number(urlStats?.age_gate_count ?? 0);
  const sourceBonus = clampScore(
    Math.min(0.18, Number(domainStats?.source_count ?? 0) * 0.035) +
      Math.min(0.14, Number(domainStats?.helpful_count ?? 0) * 0.04) +
      Math.min(0.12, Number(urlStats?.applied_count ?? 0) * 0.04),
    0
  );
  const visualBonus = clampScore(
    Math.min(0.12, Number(domainStats?.helpful_count ?? 0) * 0.025) +
      Math.min(0.16, Number(domainStats?.screenshot_count ?? 0) * 0.03) +
      Math.min(0.16, Number(domainStats?.download_count ?? 0) * 0.03),
    0
  );
  const totalBonus = clampScore(Math.min(0.18, usageCount * 0.02), 0);
  const sourcePenalty = clampScore(
    Math.min(0.16, dismissedCount * 0.018) +
      Math.min(0.12, duplicateStoryCount * 0.03) +
      Math.min(0.12, paywallCount * 0.035),
    0
  );
  const visualPenalty = clampScore(
    Math.min(0.16, badVisualCount * 0.04) +
      Math.min(0.16, screenshotFailCount * 0.04) +
      Math.min(0.08, dismissedCount * 0.01),
    0
  );
  const downloadPenalty = clampScore(
    Math.min(0.18, downloadFailCount * 0.045) +
      Math.min(0.14, antiBotCount * 0.04) +
      Math.min(0.14, ageGateCount * 0.045) +
      Math.min(0.1, paywallCount * 0.03),
    0
  );
  const totalPenalty = clampScore(
    Math.min(0.18, dismissedCount * 0.012) +
      Math.min(0.12, duplicateStoryCount * 0.02) +
      Math.min(0.14, badVisualCount * 0.025) +
      Math.min(0.16, screenshotFailCount * 0.025) +
      Math.min(0.18, downloadFailCount * 0.03) +
      Math.min(0.14, paywallCount * 0.025) +
      Math.min(0.14, antiBotCount * 0.025) +
      Math.min(0.14, ageGateCount * 0.03),
    0
  );
  return {
    helpful_count: Number(domainStats?.helpful_count ?? 0),
    usage_count: usageCount,
    dismissed_count: dismissedCount,
    duplicate_story_count: duplicateStoryCount,
    bad_visual_count: badVisualCount,
    screenshot_fail_count: screenshotFailCount,
    download_fail_count: downloadFailCount,
    paywall_count: paywallCount,
    anti_bot_count: antiBotCount,
    age_gate_count: ageGateCount,
    source_bonus: sourceBonus,
    visual_bonus: visualBonus,
    total_bonus: totalBonus,
    source_penalty: sourcePenalty,
    visual_penalty: visualPenalty,
    download_penalty: downloadPenalty,
    total_penalty: totalPenalty,
    was_used: usageCount > 0
  };
}

function getSimilaritySignals(result = {}, sourceMemory = {}, segmentContext = {}) {
  const domain = compactText(result?.domain).toLowerCase();
  const url = compactText(result?.url);
  const { textQuote, translatedTextQuote } = getSegmentTextSignals(segmentContext);
  const currentTokens = tokenizeSegmentText(
    textQuote,
    translatedTextQuote,
    shouldUseTopicTitle(segmentContext) ? segmentContext?.section_title : ""
  );
  if (!currentTokens.length) {
    return { similarity_score: 0, similarity_hits: 0 };
  }
  const patterns = (Array.isArray(sourceMemory?.patterns) ? sourceMemory.patterns : []).filter(
    (item) => item?.domain === domain || item?.url === url
  );
  let bestOverlap = 0;
  let hits = 0;
  patterns.forEach((item) => {
    const patternTokens = Array.isArray(item?.tokens) ? item.tokens : [];
    if (!patternTokens.length) return;
    const matched = patternTokens.filter((token) => currentTokens.includes(token)).length;
    if (matched <= 0) return;
    hits += 1;
    const overlap = matched / Math.max(currentTokens.length, patternTokens.length, 1);
    if (overlap > bestOverlap) bestOverlap = overlap;
  });
  return {
    similarity_score: clampScore(bestOverlap),
    similarity_hits: hits
  };
}

function mergeSingleScore(result, llmScore = {}, sourceProfiles = {}, sourceMemory = {}, segmentContext = {}) {
  const heuristic = getHeuristicSignals(result, sourceProfiles);
  const memory = getMemorySignals(result, sourceMemory);
  const similarity = getSimilaritySignals(result, sourceMemory, segmentContext);
  const intent = getIntentSignals(result, segmentContext);
  const language = getLanguagePreferenceSignals(result, segmentContext);
  const relevance = clampScore(
    clampScore(llmScore?.relevance_score, 0.35) +
      intent.search_match_score +
      intent.text_match_score +
      intent.topic_match_score +
      Math.min(0.08, intent.visual_match_score * 0.6) +
      language.language_bonus
  );
  const visual = clampScore(
      (clampScore(llmScore?.visual_score, heuristic.visual_score) * 0.65) +
      (heuristic.visual_score * 0.35) +
      intent.visual_match_score +
      Math.min(0.08, intent.text_match_score * 0.35) +
      memory.visual_bonus +
      Math.min(0.12, similarity.similarity_score * 0.18) +
      Math.min(0.04, language.language_bonus * 0.5) -
      memory.visual_penalty
  );
  const source = clampScore(
      (clampScore(llmScore?.source_score, heuristic.source_score) * 0.7) +
      (heuristic.source_score * 0.3) +
      Math.min(0.12, intent.search_match_score * 0.9) +
      Math.min(0.08, intent.text_match_score * 0.55) +
      Math.min(0.1, intent.topic_match_score * 0.9) +
      memory.source_bonus +
      Math.min(0.1, similarity.similarity_score * 0.14) +
      Math.min(0.05, language.language_bonus * 0.6) -
      memory.source_penalty
  );
  const freshness = clampScore((clampScore(llmScore?.freshness_score, heuristic.freshness_score) * 0.65) + (heuristic.freshness_score * 0.35));
  const downloadability = clampScore(
    (clampScore(llmScore?.downloadability_score, heuristic.downloadability_score) * 0.6) +
      (heuristic.downloadability_score * 0.4) -
      memory.download_penalty
  );
  const montage = clampScore((heuristic.montage_score * 0.75) + (visual * 0.25));
  const llmTotal = clampScore(llmScore?.total_score, 0);
  const total = clampScore(
    llmTotal > 0
      ? (llmTotal * 0.55) + (relevance * 0.1) + (visual * 0.15) + (source * 0.08) + (freshness * 0.04) + (downloadability * 0.03) + (montage * 0.05) + memory.total_bonus + Math.min(0.08, similarity.similarity_score * 0.1) - memory.total_penalty
      : (relevance * 0.34) + (visual * 0.22) + (source * 0.16) + (freshness * 0.08) + (downloadability * 0.08) + (montage * 0.12) + memory.total_bonus + Math.min(0.08, similarity.similarity_score * 0.1) - memory.total_penalty
  );
  const bucket = total >= 0.82 ? "strong" : total >= 0.64 ? "good" : total >= 0.48 ? "possible" : "weak";
  const reasonTags = [
    bucket === "strong" ? "strong" : null,
    heuristic.visual_hints.includes("trusted") ? "trusted" : null,
    heuristic.visual_hints.includes("downloadable") ? "downloadable" : null,
    heuristic.visual_hints.includes("video") ? "video" : null,
    heuristic.visual_hints.includes("youtube") ? "youtube" : null,
    heuristic.visual_hints.includes("preferred_article") ? "preferred_article" : null,
    heuristic.visual_hints.includes("screenshot") ? "screenshot" : null,
    heuristic.visual_hints.includes("screenshot_friendly") ? "screenshot_friendly" : null,
    memory.helpful_count > 0 ? `helpful:${memory.helpful_count}` : null,
    memory.was_used ? `used_before:${memory.usage_count}` : null,
    memory.dismissed_count > 0 ? "dismissed_before" : null,
    memory.duplicate_story_count > 0 ? "duplicate_story" : null,
    memory.bad_visual_count > 0 ? "bad_visual_history" : null,
    memory.screenshot_fail_count > 0 ? "screenshot_fail_risk" : null,
    memory.download_fail_count > 0 ? "download_fail_risk" : null,
    memory.paywall_count > 0 ? "paywall_prone" : null,
    memory.anti_bot_count > 0 ? "anti_bot_prone" : null,
    memory.age_gate_count > 0 ? "age_gate_prone" : null,
    similarity.similarity_hits > 0 ? `similar_segments:${similarity.similarity_hits}` : null,
    similarity.similarity_score >= 0.35 ? "high_similarity" : null,
    intent.search_hits > 0 ? `search_match:${intent.search_hits}` : null,
    intent.topic_hits > 0 ? `topic_match:${intent.topic_hits}` : null,
    intent.visual_hits > 0 ? `visual_match:${intent.visual_hits}` : null,
    intent.text_hits > 0 ? `text_match:${intent.text_hits}` : null,
    language.preferred_language === "ru" && language.language_match ? "lang_pref_ru" : null,
    heuristic.profile_metadata?.blocked_in_rf ? "ru_blocked" : null,
    heuristic.profile_metadata?.responsive_design ? "responsive" : null,
    heuristic.profile_metadata?.watermarks ? "watermarks" : null,
    heuristic.profile_metadata?.default_video_quality ? `quality:${heuristic.profile_metadata.default_video_quality}` : null,
    heuristic.profile_metadata?.language ? `lang:${heuristic.profile_metadata.language}` : null
  ].filter(Boolean);
  const reason = compactText(llmScore?.reason) || [
    montage >= 0.75 ? "Strong montage fit" : null,
    heuristic.visual_hints.includes("video") ? "has video potential" : null,
    heuristic.visual_hints.includes("youtube") ? "YouTube-first video candidate" : null,
    heuristic.visual_hints.includes("preferred_article") ? "preferred article source" : null,
    heuristic.visual_hints.includes("screenshot") ? "good for screenshot" : null,
    heuristic.visual_hints.includes("trusted") ? "trusted source" : null,
    memory.dismissed_count > 0 ? "was dismissed before" : null,
    memory.duplicate_story_count > 0 ? "often duplicates existing story lines" : null,
    memory.bad_visual_count > 0 ? "visual quality has been weak before" : null,
    memory.screenshot_fail_count > 0 ? "screenshots failed before" : null,
    memory.download_fail_count > 0 ? "downloads failed before" : null,
    memory.paywall_count > 0 ? "paywall risk" : null,
    memory.anti_bot_count > 0 ? "anti-bot risk" : null,
    memory.age_gate_count > 0 ? "age-gate risk" : null,
    heuristic.profile_metadata?.responsive_design ? "responsive site" : null,
    heuristic.profile_metadata?.blocked_in_rf ? "restricted in RF" : null,
    heuristic.profile_metadata?.watermarks ? "watermarked media" : null,
    heuristic.profile_metadata?.default_video_quality ? `default ${heuristic.profile_metadata.default_video_quality}` : null,
    intent.search_hits > 0 ? "matches saved search queries" : null,
    intent.topic_hits > 0 ? "matches parent topic" : null,
    intent.visual_hits > 0 ? "matches visual description" : null,
    intent.text_hits > 0 ? "matches segment text" : null,
    language.preferred_language === "ru" && language.language_match ? "matches Russian query language" : null,
    memory.was_used ? "used successfully before" : null,
    similarity.similarity_hits > 0 ? "worked on similar segments" : null
  ].filter(Boolean).join(", ") || "Useful candidate";
  const category = categorizeResearchResult(result, { visual_hints: heuristic.visual_hints }, sourceProfiles);

  return {
    result_id: String(result?.id ?? "").trim(),
    relevance_score: Number(relevance.toFixed(3)),
    visual_score: Number(visual.toFixed(3)),
    source_score: Number(source.toFixed(3)),
    freshness_score: Number(freshness.toFixed(3)),
    downloadability_score: Number(downloadability.toFixed(3)),
    montage_score: Number(montage.toFixed(3)),
    total_score: Number(total.toFixed(3)),
    bucket,
    source_kind: heuristic.source_kind,
    visual_hints: heuristic.visual_hints,
    profile_metadata: heuristic.profile_metadata,
    memory_usage_count: memory.usage_count,
    similarity_score: Number(similarity.similarity_score.toFixed(3)),
    similarity_hits: similarity.similarity_hits,
    search_match_score: Number(intent.search_match_score.toFixed(3)),
    topic_match_score: Number(intent.topic_match_score.toFixed(3)),
    visual_match_score: Number(intent.visual_match_score.toFixed(3)),
    text_match_score: Number(intent.text_match_score.toFixed(3)),
    category_id: category.id,
    category_label: category.label,
    reason_tags: reasonTags,
    reason
  };
}

export function mergeResearchScores(results = [], llmScores = [], sourceProfiles = {}, sourceMemory = {}, segmentContext = {}) {
  const scoreMap = new Map(
    (Array.isArray(llmScores) ? llmScores : [])
      .map((item) => [String(item?.result_id ?? "").trim(), item])
      .filter(([id]) => Boolean(id))
  );

  return sortByScore(
    (Array.isArray(results) ? results : []).map((result) =>
      mergeSingleScore(result, scoreMap.get(String(result?.id ?? "").trim()) ?? {}, sourceProfiles, sourceMemory, segmentContext)
    )
  );
}

export function buildResearchSummary(rankedResults = [], options = {}) {
  const sorted = sortByScore(Array.isArray(rankedResults) ? rankedResults : []);
  const queries = Array.isArray(options?.queries) ? options.queries : [];
  const results = Array.isArray(options?.results) ? options.results : [];
  const topSource = sorted[0] ?? null;
  const topVisual = [...sorted].sort(
    (a, b) => Number((b?.montage_score ?? b?.visual_score) ?? 0) - Number((a?.montage_score ?? a?.visual_score) ?? 0)
  )[0] ?? null;
  const topSourceId = topSource?.result_id ?? null;
  const topVisualId = topVisual?.result_id ?? null;
  const phaseOrder = ["context", "source", "visual"];
  const phases = phaseOrder
    .map((phase) => {
      const phaseQueries = queries.filter((item) => compactText(item?.phase || item?.kind).toLowerCase() === phase);
      const phaseResults = results.filter((item) => compactText(item?.phase).toLowerCase() === phase);
      const phaseTop = sorted.find((item) => {
        const result = phaseResults.find((candidate) => String(candidate?.id ?? "").trim() === String(item?.result_id ?? "").trim());
        return Boolean(result);
      });
      if (phaseQueries.length === 0 && phaseResults.length === 0 && !phaseTop) return null;
      return {
        phase,
        query_count: phaseQueries.length,
        result_count: phaseResults.length,
        top_result_id: phaseTop?.result_id ?? null,
        top_score: Number(phaseTop?.total_score ?? 0),
        top_bucket: String(phaseTop?.bucket ?? "").trim() || null
      };
    })
    .filter(Boolean);
  const notes = [];
  if (topSource) notes.push(`Top source: ${topSourceId}`);
  if (topVisual && topVisualId !== topSourceId) notes.push(`Top visual: ${topVisualId}`);
  if (topVisual?.visual_hints?.length) notes.push(`Visual hints: ${topVisual.visual_hints.join(", ")}`);
  const sourcePhase = phases.find((item) => item.phase === "source");
  const visualPhase = phases.find((item) => item.phase === "visual");
  if (sourcePhase?.result_count) notes.push(`Source pass: ${sourcePhase.result_count} results`);
  if (visualPhase?.result_count) notes.push(`Visual pass: ${visualPhase.result_count} results`);
  if (sorted.length === 0) notes.push("Research found no candidates. Check SearxNG and queries.");
  const guidance = [];
  if ((sourcePhase?.result_count ?? 0) === 0) {
    guidance.push("No source-pass hits yet. Try stronger primary-source wording.");
  }
  if ((visualPhase?.result_count ?? 0) === 0) {
    guidance.push("No visual-pass hits yet. Try screenshot, gallery, or footage-oriented queries.");
  }
  if ((sourcePhase?.result_count ?? 0) > 0 && (visualPhase?.result_count ?? 0) > 0) {
    guidance.push("Research found both source and visual candidates. Promote the strongest picks first.");
  } else if ((sourcePhase?.result_count ?? 0) > 0) {
    guidance.push("Source coverage is stronger than visual coverage. Secure a visual fallback next.");
  } else if ((visualPhase?.result_count ?? 0) > 0) {
    guidance.push("Visual coverage is stronger than source coverage. Secure a primary source next.");
  }
  return {
    top_source_result_id: topSourceId,
    top_visual_result_id: topVisualId,
    totals: {
      queries: queries.length,
      results: results.length,
      ranked: sorted.length,
      source_queries: queries.filter((item) => compactText(item?.phase || item?.kind).toLowerCase() === "source").length,
      visual_queries: queries.filter((item) => compactText(item?.phase || item?.kind).toLowerCase() === "visual").length
    },
    coverage:
      (sourcePhase?.result_count ?? 0) > 0 && (visualPhase?.result_count ?? 0) > 0
        ? "balanced"
        : (sourcePhase?.result_count ?? 0) > 0
          ? "source_heavy"
          : (visualPhase?.result_count ?? 0) > 0
            ? "visual_heavy"
            : "empty",
    phases,
    notes,
    guidance
  };
}

export function inferResearchCandidateRole(ranked = {}, decisionContext = {}) {
  const sourceScore = Number(ranked?.source_score ?? 0);
  const visualScore = Number(ranked?.visual_score ?? 0);
  const montageScore = Number(ranked?.montage_score ?? 0);
  const totalScore = Number(ranked?.total_score ?? 0);
  const hints = (Array.isArray(ranked?.visual_hints) ? ranked.visual_hints : []).map((item) =>
    compactText(item).toLowerCase()
  );
  const existingSources = Array.isArray(decisionContext?.research_sources) ? decisionContext.research_sources : [];
  const hasPrimarySource = existingSources.some((item) => {
    const role = compactText(item?.role).toLowerCase();
    return role === "main_source" || role === "source";
  });
  const hasVisual = hasVisualDecisionContent(decisionContext?.visual_decision);
  const hasSearch = hasSearchDecisionContent(decisionContext?.search_decision);
  const visualCandidate =
    hints.some((item) => ["video", "image", "screenshot", "downloadable"].includes(item)) ||
    visualScore >= 0.68 ||
    montageScore >= 0.68;

  if (visualCandidate && (!hasVisual || visualScore >= sourceScore + 0.08)) return "visual_candidate";
  if (!hasPrimarySource && !hasSearch && (sourceScore >= 0.64 || totalScore >= 0.8)) return "main_source";
  if (sourceScore >= 0.56) return hasPrimarySource || hasSearch ? "backup_source" : "main_source";
  if (visualCandidate) return "visual_candidate";
  return "reference";
}

export function buildResearchBrief(results = [], rankedResults = [], decisionContext = {}, options = {}) {
  const resultMap = new Map(
    (Array.isArray(results) ? results : [])
      .map((item) => [String(item?.id ?? "").trim(), item])
      .filter(([id]) => Boolean(id))
  );
  const summary = options?.summary && typeof options.summary === "object" ? options.summary : {};
  const rankedItems = (Array.isArray(rankedResults) ? rankedResults : [])
    .map((ranked) => ({
      ranked,
      result: resultMap.get(String(ranked?.result_id ?? "").trim()) ?? null
    }))
    .filter((item) => item.result);
  const pick = (items, scoreField, excludedResultIds = []) => {
    const excluded = new Set(
      (Array.isArray(excludedResultIds) ? excludedResultIds : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    );
    const top = [...items]
      .filter((item) => !excluded.has(String(item?.result?.id ?? item?.ranked?.result_id ?? "").trim()))
      .sort(
      (a, b) =>
        Number(b?.ranked?.[scoreField] ?? b?.ranked?.total_score ?? 0) -
          Number(a?.ranked?.[scoreField] ?? a?.ranked?.total_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0];
    if (!top) return null;
    return {
      result_id: String(top.result?.id ?? "").trim() || String(top.ranked?.result_id ?? "").trim(),
      title: compactText(top.result?.title || top.result?.url),
      url: compactText(top.result?.url),
      domain: compactText(top.result?.domain) || "source",
      score: Number(top.ranked?.[scoreField] ?? top.ranked?.total_score ?? 0),
      role: inferResearchCandidateRole(top.ranked, decisionContext),
      reason: compactText(top.ranked?.reason),
      memory_hint: [buildResearchMemoryHint(top.ranked), buildResearchMetadataHint(top.ranked)].filter(Boolean).join(" В· "),
      reason_tags: Array.isArray(top.ranked?.reason_tags) ? top.ranked.reason_tags.filter(Boolean).slice(0, 6) : []
    };
  };
  const visualCandidates = rankedItems.filter((item) => {
    const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
    return (
      hints.length > 0 ||
      Number(item?.ranked?.montage_score ?? 0) >= 0.55 ||
      Number(item?.ranked?.visual_score ?? 0) >= 0.58
    );
  });
  const downloadableCandidates = rankedItems.filter((item) => {
    const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
    return hints.includes("downloadable") || Number(item?.ranked?.downloadability_score ?? 0) >= 0.62;
  });
  const bestSourceEntry = pick(rankedItems, "source_score");
  const bestVisualEntry = pick(visualCandidates, "montage_score");
  const bestDownloadEntry = pick(downloadableCandidates, "downloadability_score");
  const backupSourceEntry = pick(
    rankedItems.filter((item) => {
      const role = inferResearchCandidateRole(item?.ranked, decisionContext);
      return role === "main_source" || role === "backup_source" || role === "reference";
    }),
    "source_score",
    [bestSourceEntry?.result_id]
  );
  const backupVisualEntry = pick(
    visualCandidates,
    "montage_score",
    [bestVisualEntry?.result_id]
  );
  const items = [
    bestSourceEntry ? { key: "source", label: "Best Source", ...bestSourceEntry } : null,
    bestVisualEntry ? { key: "visual", label: "Best Visual", ...bestVisualEntry } : null,
    bestDownloadEntry ? { key: "download", label: "Best Download", ...bestDownloadEntry } : null,
    backupSourceEntry ? { key: "backup_source", label: "Backup Source", ...backupSourceEntry } : null,
    backupVisualEntry ? { key: "backup_visual", label: "Backup Visual", ...backupVisualEntry } : null
  ].filter(Boolean);
  const phaseItems = (Array.isArray(summary?.phases) ? summary.phases : [])
    .map((phaseInfo) => {
      const topResultId = String(phaseInfo?.top_result_id ?? "").trim();
      if (!topResultId) return null;
      const result = resultMap.get(topResultId) ?? null;
      const ranked = rankedItems.find((item) => String(item?.ranked?.result_id ?? "").trim() === topResultId) ?? null;
      const phase = compactText(phaseInfo?.phase).toLowerCase();
      const label =
        phase === "source"
          ? "Source Pass"
          : phase === "visual"
            ? "Visual Pass"
            : phase === "context"
              ? "Context Pass"
              : `${phase} Pass`;
      return {
        key: `${phase}_pass`,
        label,
        title: compactText(result?.title || result?.url || topResultId),
        url: compactText(result?.url),
        domain: compactText(result?.domain) || "source",
        score: Number(phaseInfo?.top_score ?? ranked?.ranked?.total_score ?? 0),
        role: ranked ? inferResearchCandidateRole(ranked.ranked, decisionContext) : "",
        memory_hint: ranked ? [buildResearchMemoryHint(ranked.ranked), buildResearchMetadataHint(ranked.ranked)].filter(Boolean).join(" В· ") : "",
        reason: `${Number(phaseInfo?.result_count ?? 0)} results in ${phase} pass`,
        reason_tags: [phase, `${phase}_pass`]
      };
    })
    .filter(Boolean);
  return {
    summary: items.map((item) => `${item.label}: ${item.title}`).join(" | "),
    items,
    phase_items: phaseItems
  };
}
