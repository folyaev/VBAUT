const DEFAULT_BASE_URL = process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080";
const DEFAULT_MODEL = process.env.LLAMA_MODEL ?? "";
const OUTPUT_TOKEN_LIMIT = Number.isFinite(Number(process.env.LLAMA_MAX_TOKENS))
  ? Number(process.env.LLAMA_MAX_TOKENS)
  : 2048;
const FETCH_RETRY_ATTEMPTS = Number.isFinite(Number(process.env.LLM_FETCH_RETRIES))
  ? Math.max(0, Number(process.env.LLM_FETCH_RETRIES))
  : 1;
const FETCH_RETRY_DELAY_MS = Number.isFinite(Number(process.env.LLM_FETCH_RETRY_DELAY_MS))
  ? Math.max(0, Number(process.env.LLM_FETCH_RETRY_DELAY_MS))
  : 500;

let cachedModel = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = FETCH_RETRY_ATTEMPTS, delayMs = FETCH_RETRY_DELAY_MS) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (attempt === retries) return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    }
    await wait(delayMs * Math.pow(2, attempt));
  }
  if (lastError) throw lastError;
  throw new Error("LLM request failed");
}

async function resolveModel() {
  if (DEFAULT_MODEL) return DEFAULT_MODEL;
  if (cachedModel !== null) return cachedModel || undefined;
  try {
    const response = await fetchWithRetry(`${DEFAULT_BASE_URL}/v1/models`);
    if (!response.ok) throw new Error(`Models error ${response.status}`);
    const json = await response.json();
    const list = Array.isArray(json?.data) ? json.data : [];
    cachedModel = String(list[0]?.id ?? "").trim();
  } catch {
    cachedModel = "";
  }
  return cachedModel || undefined;
}

function safeParseJson(content) {
  if (!content) throw new Error("LLM returned empty content");
  const trimmed = String(content).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const objStart = trimmed.indexOf("{");
    const objEnd = trimmed.lastIndexOf("}");
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
      return JSON.parse(trimmed.slice(objStart, objEnd + 1));
    }
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1));
    }
    throw new Error("Failed to parse JSON from LLM response");
  }
}

function compactText(value, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function hasCyrillic(value) {
  return /[\u0400-\u04FF]/u.test(String(value ?? ""));
}

function uniqueCompactList(values = [], limit = 0) {
  const items = [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((item) => compactText(item))
      .filter(Boolean)
  )];
  if (!limit || items.length <= limit) return items;
  return items.slice(0, limit);
}

function tokenizeIntentTerms(...parts) {
  return [...new Set(
    parts
      .map((item) => compactText(item).toLowerCase())
      .join(" ")
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
      .slice(0, 16)
  )];
}

function shouldUseTopicTitle(segment = {}) {
  return Boolean(segment?.research_use_topic_title);
}

function shouldUseThemeTags(segment = {}) {
  return Boolean(segment?.research_use_theme_tags);
}

function deriveTopicTags(segment = {}) {
  const titleTags = shouldUseTopicTitle(segment)
    ? uniqueCompactList(tokenizeIntentTerms(segment?.section_title), 8)
    : [];
  const themeTags = shouldUseThemeTags(segment)
    ? [...uniqueCompactList(segment?.topic_tags, 8), ...uniqueCompactList(segment?.section_tags, 8)]
    : [];
  return [...titleTags, ...themeTags].filter(Boolean).slice(0, 8);
}

function hasSavedSearchQueries(segment = {}) {
  return uniqueCompactList(segment?.search_decision?.queries, 4).length > 0;
}

function hasVisualPriorityInput(segment = {}) {
  return Boolean(compactText(segment?.visual_decision?.description));
}

function deriveResearchPriorityMode(segment = {}) {
  if (hasSavedSearchQueries(segment)) return "search";
  if (hasVisualPriorityInput(segment)) return "visual";
  return "text";
}

function getSegmentTextSignals(segment = {}) {
  const textQuote = compactText(segment?.text_quote);
  const translatedTextQuote = compactText(segment?.translated_text_quote);
  return {
    textQuote,
    translatedTextQuote:
      translatedTextQuote && translatedTextQuote.toLowerCase() !== textQuote.toLowerCase()
        ? translatedTextQuote
        : ""
  };
}

function getSectionResearchSignals(segment = {}) {
  return {
    sectionContextText: compactText(segment?.section_context_text),
    sectionLinkHints: uniqueCompactList(segment?.section_link_hints, 6)
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

function inferPreferredResearchLanguage(segment = {}) {
  const savedQueries = uniqueCompactList(segment?.search_decision?.queries, 8);
  const { sectionContextText } = getSectionResearchSignals(segment);
  if (savedQueries.length > 0) {
    return savedQueries.some((item) => hasCyrillic(item)) ? "ru" : "en";
  }
  if (hasCyrillic(segment?.visual_decision?.description)) return "ru";
  if (hasCyrillic(segment?.text_quote)) return "ru";
  if (hasCyrillic(sectionContextText)) return "ru";
  return "en";
}

function dedupeResearchQueries(queries = []) {
  const seen = new Set();
  return (Array.isArray(queries) ? queries : []).filter((item, index) => {
    const text = compactText(item?.text);
    const lang = compactText(item?.lang || "auto").toLowerCase() || "auto";
    const key = `${lang}:${text.toLowerCase()}`;
    if (!text || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item, index) => ({
    id: String(item?.id ?? `q${index + 1}`),
    text: compactText(item?.text),
    lang: compactText(item?.lang || "auto").toLowerCase() || "auto",
    kind: compactText(item?.kind, "general").toLowerCase() || "general",
    phase: compactText(item?.phase, item?.kind === "source" ? "source" : item?.kind === "visual" ? "visual" : "context").toLowerCase() || "context"
  }));
}

function normalizeQueryLanguagePriority(normalized = [], fallbackQueries = [], segment = {}) {
  const preferredLang = inferPreferredResearchLanguage(segment);
  const hasExplicitSavedQueries = hasSavedSearchQueries(segment);
  const explicitEnglishSavedQueries =
    hasExplicitSavedQueries &&
    uniqueCompactList(segment?.search_decision?.queries, 8).every((item) => !hasCyrillic(item));
  const merged = dedupeResearchQueries([...normalized, ...fallbackQueries]);
  if (preferredLang !== "ru" || explicitEnglishSavedQueries) {
    return merged;
  }
  const preferred = [];
  const secondary = [];
  merged.forEach((item) => {
    if (String(item?.lang ?? "").trim().toLowerCase() === "ru") preferred.push(item);
    else secondary.push(item);
  });
  const cappedSecondary = hasExplicitSavedQueries ? secondary : secondary.slice(0, 1);
  return [...preferred, ...cappedSecondary].map((item, index) => ({
    ...item,
    id: `q${index + 1}`
  }));
}

function prioritizeVideoFirstQueries(queries = [], segment = {}) {
  const preferredLang = inferPreferredResearchLanguage(segment);
  return (Array.isArray(queries) ? queries : [])
    .map((item) => {
      const text = compactText(item?.text).toLowerCase();
      const lang = compactText(item?.lang).toLowerCase();
      const kind = compactText(item?.kind).toLowerCase();
      const youtubeQuery = text.includes("site:youtube.com") || text.includes("youtube") || text.includes("youtu.be");
      const videoQuery = youtubeQuery || text.includes("video") || text.includes("footage") || kind === "visual";
      const langBoost = preferredLang === "ru" ? (lang === "ru" ? 1 : 0) : lang === preferredLang ? 1 : 0;
      return {
        ...item,
        __sortScore: (youtubeQuery ? 100 : 0) + (videoQuery ? 20 : 0) + langBoost
      };
    })
    .sort((left, right) => Number(right.__sortScore ?? 0) - Number(left.__sortScore ?? 0))
    .map((item, index) => ({
      id: `q${index + 1}`,
      text: compactText(item?.text),
      lang: compactText(item?.lang || preferredLang).toLowerCase() || preferredLang,
      kind: compactText(item?.kind, "general").toLowerCase() || "general",
      phase: compactText(item?.phase, item?.kind === "source" ? "source" : item?.kind === "visual" ? "visual" : "context").toLowerCase() || "context"
    }));
}

function domainMatches(domain, list = []) {
  const normalizedDomain = String(domain ?? "").trim().toLowerCase();
  if (!normalizedDomain) return false;
  return (Array.isArray(list) ? list : []).some((candidate) => {
    const normalizedCandidate = String(candidate ?? "").trim().toLowerCase();
    if (!normalizedCandidate) return false;
    return normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`);
  });
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

function buildHeuristicQueries(segment, options = {}) {
  const mode = compactText(options?.mode, "fast").toLowerCase() || "fast";
  const maxQueries = Number.isFinite(Number(options.maxQueries))
    ? Math.max(1, Number(options.maxQueries))
    : mode === "deep"
      ? 8
      : 4;
  const priorityMode = deriveResearchPriorityMode(segment);
  const sectionTitle = shouldUseTopicTitle(segment) ? compactText(segment?.section_title) : "";
  const { textQuote, translatedTextQuote } = getSegmentTextSignals(segment);
  const topicTags = deriveTopicTags(segment);
  const visualDescription = compactText(segment?.visual_decision?.description);
  const savedQueries = uniqueCompactList(segment?.search_decision?.queries, 4);
  const searchKeywords = uniqueCompactList(segment?.search_decision?.keywords, 8);
  const textSeed = tokenizeIntentTerms(textQuote).slice(0, 8).join(" ").trim() || textQuote;
  const translatedSeed =
    tokenizeIntentTerms(translatedTextQuote).slice(0, 8).join(" ").trim() || translatedTextQuote;
  const visualSeed = tokenizeIntentTerms(visualDescription).slice(0, 6).join(" ").trim() || visualDescription;
  const keywordSeed = searchKeywords.slice(0, 4).join(" ").trim();
  const topicSeed = topicTags.slice(0, 4).join(" ").trim();
  const topicContext = [sectionTitle, topicSeed].filter(Boolean).join(" ").trim();
  const queries = [];
  const pushQuery = (text, lang, kind, phase) => {
    const normalized = compactText(text);
    if (!normalized) return;
    const duplicate = queries.some(
      (item) =>
        item.lang === lang &&
        item.kind === kind &&
        item.phase === phase &&
        compactText(item.text).toLowerCase() === normalized.toLowerCase()
    );
    if (duplicate) return;
    queries.push({
      id: `q${queries.length + 1}`,
      text: normalized,
      lang,
      kind,
      phase
    });
  };

  if (priorityMode === "search") {
    savedQueries.forEach((query, index) => {
      const withKeywords = [query, index === 0 ? keywordSeed : "", topicContext].filter(Boolean).join(" ").trim();
      if (index === 0) {
        pushQuery([query, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
      }
      pushQuery(withKeywords || query, "ru", index === 0 ? "visual" : "general", index === 0 ? "visual" : "context");
    });
    pushQuery([savedQueries[0], keywordSeed, "video footage"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery([savedQueries[0], keywordSeed, "official source"].filter(Boolean).join(" "), "ru", "source", "source");
    if (mode === "deep") {
      pushQuery([savedQueries[0], topicContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([savedQueries[0], topicContext, "statement"].filter(Boolean).join(" "), "ru", "source", "source");
    }
  } else if (priorityMode === "visual") {
    const visualContext = [visualSeed, textSeed, topicContext].filter(Boolean).join(" ").trim();
    pushQuery([visualContext, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery(visualContext, "ru", "visual", "visual");
    pushQuery([visualSeed, "video footage"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery([visualSeed, textSeed, "source"].filter(Boolean).join(" "), "ru", "source", "source");
    if (translatedSeed) {
      pushQuery([translatedSeed, visualSeed].filter(Boolean).join(" "), "en", "visual", "visual");
    }
    if (mode === "deep") {
      pushQuery([visualSeed, topicContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([visualSeed, topicContext, "official"].filter(Boolean).join(" "), "ru", "source", "source");
    }
  } else {
    const ruTextContext = [textQuote, topicContext].filter(Boolean).join(" ").trim() || textSeed || "news visual";
    const enTextContext = [translatedTextQuote, topicSeed].filter(Boolean).join(" ").trim() || translatedSeed;
    pushQuery([ruTextContext, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery(ruTextContext, "ru", "general", "context");
    pushQuery([ruTextContext, "источник"].filter(Boolean).join(" "), "ru", "source", "source");
    pushQuery([ruTextContext, "видео"].filter(Boolean).join(" "), "ru", "visual", "visual");
    if (enTextContext) {
      pushQuery(enTextContext, "en", "general", "context");
    }
    if (mode === "deep") {
      pushQuery([ruTextContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([ruTextContext, "official statement"].filter(Boolean).join(" "), "en", "source", "source");
      if (enTextContext) {
        pushQuery([enTextContext, "video footage"].filter(Boolean).join(" "), "en", "visual", "visual");
      }
    }
  }
  return uniqueCompactList(
    queries.map((item) => JSON.stringify(item)),
    maxQueries
  ).map((item) => JSON.parse(item));
}

function buildHeuristicQueriesV2(segment, options = {}) {
  const mode = compactText(options?.mode, "fast").toLowerCase() || "fast";
  const maxQueries = Number.isFinite(Number(options.maxQueries))
    ? Math.max(1, Number(options.maxQueries))
    : mode === "deep"
      ? 8
      : 4;
  const priorityMode = deriveResearchPriorityMode(segment);
  const sectionTitle = shouldUseTopicTitle(segment) ? compactText(segment?.section_title) : "";
  const { textQuote, translatedTextQuote } = getSegmentTextSignals(segment);
  const { sectionContextText, sectionLinkHints } = getSectionResearchSignals(segment);
  const topicTags = deriveTopicTags(segment);
  const visualDescription = compactText(segment?.visual_decision?.description);
  const savedQueries = uniqueCompactList(segment?.search_decision?.queries, 4);
  const searchKeywords = uniqueCompactList(segment?.search_decision?.keywords, 8);
  const linkHintDomains = extractResearchLinkHintDomains(sectionLinkHints);
  const textSeed = tokenizeIntentTerms(textQuote).slice(0, 8).join(" ").trim() || textQuote;
  const translatedSeed =
    tokenizeIntentTerms(translatedTextQuote).slice(0, 8).join(" ").trim() || translatedTextQuote;
  const sectionSeed =
    tokenizeIntentTerms(sectionContextText).slice(0, 8).join(" ").trim() || sectionContextText;
  const visualSeed = tokenizeIntentTerms(visualDescription).slice(0, 6).join(" ").trim() || visualDescription;
  const keywordSeed = searchKeywords.slice(0, 4).join(" ").trim();
  const topicSeed = topicTags.slice(0, 4).join(" ").trim();
  const topicContext = [sectionTitle, topicSeed].filter(Boolean).join(" ").trim();
  const sourceHintDomain = linkHintDomains[0] ? `site:${linkHintDomains[0]}` : "";
  const queries = [];
  const pushQuery = (text, lang, kind, phase) => {
    const normalized = compactText(text);
    if (!normalized) return;
    const duplicate = queries.some(
      (item) =>
        item.lang === lang &&
        item.kind === kind &&
        item.phase === phase &&
        compactText(item.text).toLowerCase() === normalized.toLowerCase()
    );
    if (duplicate) return;
    queries.push({
      id: `q${queries.length + 1}`,
      text: normalized,
      lang,
      kind,
      phase
    });
  };

  if (priorityMode === "search") {
    savedQueries.forEach((query, index) => {
      const withKeywords = [query, index === 0 ? keywordSeed : "", sectionSeed, topicContext].filter(Boolean).join(" ").trim();
      if (index === 0) {
        pushQuery([query, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
      }
      pushQuery(withKeywords || query, "ru", index === 0 ? "visual" : "general", index === 0 ? "visual" : "context");
    });
    pushQuery([savedQueries[0], keywordSeed, "video footage"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery([savedQueries[0], keywordSeed, "official source"].filter(Boolean).join(" "), "ru", "source", "source");
    if (sourceHintDomain) {
      pushQuery([savedQueries[0], sourceHintDomain].filter(Boolean).join(" "), "ru", "source", "source");
    }
    if (mode === "deep") {
      pushQuery([savedQueries[0], sectionSeed, topicContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([savedQueries[0], sectionSeed, topicContext, "statement"].filter(Boolean).join(" "), "ru", "source", "source");
    }
  } else if (priorityMode === "visual") {
    const visualContext = [visualSeed, textSeed, sectionSeed, topicContext].filter(Boolean).join(" ").trim();
    pushQuery([visualContext, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery(visualContext, "ru", "visual", "visual");
    pushQuery([visualSeed, "video footage"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery([visualSeed, textSeed, sectionSeed, "source"].filter(Boolean).join(" "), "ru", "source", "source");
    if (sourceHintDomain) {
      pushQuery([visualSeed || textSeed || sectionSeed, sourceHintDomain].filter(Boolean).join(" "), "ru", "source", "source");
    }
    if (translatedSeed) {
      pushQuery([translatedSeed, visualSeed, sectionSeed].filter(Boolean).join(" "), "en", "visual", "visual");
    }
    if (mode === "deep") {
      pushQuery([visualSeed, sectionSeed, topicContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([visualSeed, sectionSeed, topicContext, "official"].filter(Boolean).join(" "), "ru", "source", "source");
    }
  } else {
    const ruTextContext = [textQuote, sectionSeed, topicContext].filter(Boolean).join(" ").trim() || textSeed || sectionSeed || "news visual";
    const enTextContext = [translatedTextQuote, topicSeed].filter(Boolean).join(" ").trim() || translatedSeed;
    pushQuery([ruTextContext, "site:youtube.com"].filter(Boolean).join(" "), "ru", "visual", "visual");
    pushQuery(ruTextContext, "ru", "general", "context");
    pushQuery([ruTextContext, "источник"].filter(Boolean).join(" "), "ru", "source", "source");
    pushQuery([ruTextContext, "видео"].filter(Boolean).join(" "), "ru", "visual", "visual");
    if (sourceHintDomain) {
      pushQuery([sectionSeed || ruTextContext, sourceHintDomain].filter(Boolean).join(" "), "ru", "source", "source");
    }
    if (enTextContext) {
      pushQuery(enTextContext, "en", "general", "context");
    }
    if (mode === "deep") {
      pushQuery([ruTextContext, "gallery"].filter(Boolean).join(" "), "ru", "visual", "visual");
      pushQuery([ruTextContext, "official statement"].filter(Boolean).join(" "), "en", "source", "source");
      if (enTextContext) {
        pushQuery([enTextContext, "video footage"].filter(Boolean).join(" "), "en", "visual", "visual");
      }
    }
  }

  return uniqueCompactList(
    queries.map((item) => JSON.stringify(item)),
    maxQueries
  ).map((item) => JSON.parse(item));
}

function fallbackRankResults(segment, results = [], sourceProfiles = {}) {
  const priorityMode = deriveResearchPriorityMode(segment);
  const { textQuote, translatedTextQuote } = getSegmentTextSignals(segment);
  const { sectionContextText, sectionLinkHints } = getSectionResearchSignals(segment);
  const quote = textQuote.toLowerCase();
  const quoteEn = translatedTextQuote.toLowerCase();
  const section = shouldUseTopicTitle(segment) ? compactText(segment?.section_title).toLowerCase() : "";
  const topicTags = deriveTopicTags(segment);
  const visualTerms = tokenizeIntentTerms(segment?.visual_decision?.description);
  const sectionTerms = tokenizeIntentTerms(sectionContextText);
  const linkHintDomains = extractResearchLinkHintDomains(sectionLinkHints);
  const searchTerms = tokenizeIntentTerms(
    ...(Array.isArray(segment?.search_decision?.queries) ? segment.search_decision.queries : []),
    ...(Array.isArray(segment?.search_decision?.keywords) ? segment.search_decision.keywords : [])
  );
  const textTerms = tokenizeIntentTerms(textQuote, translatedTextQuote, sectionContextText);
  return results.map((result) => {
    const haystack = `${result.title} ${result.snippet} ${result.url} ${result.domain}`.toLowerCase();
    const profile = getDomainProfile(result.domain, sourceProfiles);
    const blockedInRf = Boolean(profile?.blocked_in_rf);
    const preferredArticle = domainMatches(result.domain, sourceProfiles?.preferred_article_domains);
    const youtubeMatch = domainMatches(result.domain, ["youtube.com", "youtu.be"]);
    const sectionHit = section && haystack.includes(section) ? 0.25 : 0;
    const quoteHit =
      (quote && haystack.includes(quote.slice(0, 40)) ? 0.16 : 0) +
      (quoteEn && haystack.includes(quoteEn.slice(0, 40)) ? 0.16 : 0);
    const topicHits = topicTags.filter((term) => haystack.includes(term)).length;
    const visualHits = visualTerms.filter((term) => haystack.includes(term)).length;
    const sectionHits = sectionTerms.filter((term) => haystack.includes(term)).length;
    const searchHits = searchTerms.filter((term) => haystack.includes(term)).length;
    const textHits = textTerms.filter((term) => haystack.includes(term)).length;
    const sourceHintHit = linkHintDomains.some((term) => haystack.includes(term)) ? 1 : 0;
    const trustedHit = domainMatches(result.domain, sourceProfiles?.trusted_domains) ? 0.2 : 0.05;
    const visualHit = /(video|footage|photo|images|watch)/i.test(`${result.title} ${result.snippet}`) ? 0.25 : 0.1;
    const preferredArticleHit = preferredArticle ? 0.28 : 0;
    const youtubeHit = youtubeMatch ? 0.26 : 0;
    const rfPenalty = blockedInRf ? 0.24 : 0;
    const weightedSearchHit = priorityMode === "search" ? Math.min(0.24, searchHits * 0.05) : Math.min(0.08, searchHits * 0.025);
    const weightedVisualHit = priorityMode === "visual" ? Math.min(0.24, visualHits * 0.055) : Math.min(0.08, visualHits * 0.03);
    const weightedTextHit = priorityMode === "text" ? Math.min(0.24, textHits * 0.05) : Math.min(0.08, textHits * 0.025);
    const weightedSectionHit = Math.min(0.14, sectionHits * 0.03);
    const weightedTopicHit = Math.min(priorityMode === "text" ? 0.12 : 0.08, topicHits * 0.03);
    const relevance = Math.max(0, Math.min(0.98, 0.34 + sectionHit * 0.35 + quoteHit + trustedHit + weightedSearchHit + weightedVisualHit * 0.4 + weightedTextHit + weightedSectionHit + weightedTopicHit + preferredArticleHit * 0.3 + youtubeHit * 0.2 + sourceHintHit * 0.06 - rfPenalty * 0.3));
    const visual = Math.max(0, Math.min(0.98, 0.3 + visualHit + trustedHit * 0.5 + weightedVisualHit + weightedTextHit * 0.35 + youtubeHit * 0.6 - rfPenalty * 0.4));
    const source = Math.max(0, Math.min(0.98, 0.3 + trustedHit + sectionHit * 0.4 + weightedSearchHit * 0.8 + weightedTextHit * 0.35 + weightedSectionHit * 0.8 + weightedTopicHit * 0.7 + preferredArticleHit + youtubeHit * 0.2 + sourceHintHit * 0.14 - rfPenalty));
    const freshness = result.published_at ? 0.7 : 0.45;
    const downloadability = Math.max(0, Math.min(0.98, (domainMatches(result.domain, sourceProfiles?.downloadable_domains) ? 0.75 : 0.45) + youtubeHit * 0.35 - rfPenalty * 0.2));
    const total = Number(
      ((relevance * 0.35) + (visual * 0.25) + (source * 0.2) + (freshness * 0.1) + (downloadability * 0.1)).toFixed(3)
    );
    return {
      result_id: result.id,
      relevance_score: Number(relevance.toFixed(3)),
      visual_score: Number(visual.toFixed(3)),
      source_score: Number(source.toFixed(3)),
      freshness_score: Number(freshness.toFixed(3)),
      downloadability_score: Number(downloadability.toFixed(3)),
      total_score: total,
      bucket: total >= 0.75 ? "strong" : total >= 0.58 ? "good" : "possible",
      reason:
        trustedHit > 0.15
          ? "Strong source and useful visual candidate"
          : "Working candidate for the segment"
    };
  });
}

async function requestJson(system, user) {
  const model = await resolveModel();
  const response = await fetchWithRetry(`${DEFAULT_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: OUTPUT_TOKEN_LIMIT,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM error ${response.status}: ${text}`);
  }
  const json = await response.json();
  return safeParseJson(json?.choices?.[0]?.message?.content ?? "");
}

export async function generateSegmentResearchQueries(segment, options = {}) {
  const fallbackQueries = buildHeuristicQueriesV2(segment, options);
  const mode = compactText(options?.mode, "fast").toLowerCase() || "fast";
  const priorityMode = deriveResearchPriorityMode(segment);
  const preferredLang = inferPreferredResearchLanguage(segment);
  const { sectionContextText, sectionLinkHints } = getSectionResearchSignals(segment);
  const system = [
    "You generate web search queries for a news editing assistant.",
    "Return strict JSON array only.",
    'Each item must be: {"id":"q1","text":"...","lang":"ru|en","kind":"general|visual|source","phase":"context|source|visual"}',
    "Generate practical search queries for finding source links and visuals for a segment.",
    preferredLang === "ru"
      ? "This segment is Russian-first. Prefer Russian queries and ru language unless the user explicitly saved English queries."
      : "Prefer English queries only when the input itself is primarily English.",
    "Saved search queries have highest priority. If they exist, use them as the main search basis and do not let topic hints override them.",
    "Prefer video-first search. Put a YouTube-focused query near the top whenever it is relevant.",
    "If there are no saved search queries but there is a visual description, prioritize the visual description.",
    "If neither saved search queries nor visual description exist, search by the segment text and its English translation.",
    "Parent topic title and theme tags are optional hints only when they are explicitly enabled.",
    mode === "deep"
      ? "Deep mode: include more source-seeking and visual-seeking queries, including official statements, galleries, and footage angles."
      : "Fast mode: keep queries compact and pragmatic.",
    `Priority mode for this request is ${priorityMode}.`,
    `Return at most ${fallbackQueries.length} items.`
  ].join(" ");
  const { translatedTextQuote } = getSegmentTextSignals(segment);
  const user = JSON.stringify(
    {
      section_title: shouldUseTopicTitle(segment) ? segment?.section_title ?? "" : "",
      parent_topic_title: shouldUseTopicTitle(segment) ? segment?.section_title ?? "" : "",
      use_topic_title: shouldUseTopicTitle(segment),
      use_theme_tags: shouldUseThemeTags(segment),
      topic_tags: deriveTopicTags(segment),
      text_quote: segment?.text_quote ?? "",
      section_context_text: sectionContextText,
      section_link_hints: sectionLinkHints,
      translated_text_quote: translatedTextQuote,
      mode,
      priority_mode: priorityMode,
      current_visual_description: segment?.visual_decision?.description ?? "",
      current_search_keywords: Array.isArray(segment?.search_decision?.keywords) ? segment.search_decision.keywords : [],
      current_search_queries: Array.isArray(segment?.search_decision?.queries) ? segment.search_decision.queries : []
    },
    null,
    2
  );

  try {
    const parsed = await requestJson(system, user);
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.queries) ? parsed.queries : [];
    const normalized = items
      .map((item, index) => ({
        id: String(item?.id ?? `q${index + 1}`),
        text: compactText(item?.text),
        lang: compactText(item?.lang, preferredLang).toLowerCase() || preferredLang,
        kind: compactText(item?.kind, "general").toLowerCase() || "general",
        phase: compactText(
          item?.phase,
          item?.kind === "source" ? "source" : item?.kind === "visual" ? "visual" : "context"
        ).toLowerCase() || "context"
      }))
      .filter((item) => item.text)
      .slice(0, fallbackQueries.length);
    const prioritized = prioritizeVideoFirstQueries(
      normalizeQueryLanguagePriority(normalized, fallbackQueries, segment),
      segment
    ).slice(0, fallbackQueries.length);
    return prioritized.length > 0 ? prioritized : fallbackQueries;
  } catch {
    return prioritizeVideoFirstQueries(
      normalizeQueryLanguagePriority([], fallbackQueries, segment),
      segment
    ).slice(0, fallbackQueries.length);
  }
}

export async function rankSegmentResearchResults(segment, results = [], sourceProfiles = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const fallback = fallbackRankResults(segment, results, sourceProfiles);
  const priorityMode = deriveResearchPriorityMode(segment);
  const { translatedTextQuote } = getSegmentTextSignals(segment);
  const { sectionContextText, sectionLinkHints } = getSectionResearchSignals(segment);
  const system = [
    "You rank search results for a news video editing assistant.",
    "Return strict JSON array only.",
    'Each item must be: {"result_id":"...","relevance_score":0.0,"visual_score":0.0,"source_score":0.0,"freshness_score":0.0,"downloadability_score":0.0,"total_score":0.0,"bucket":"strong|good|possible","reason":"..."}',
    "Scores must be between 0 and 1.",
    "Prefer results that are useful for editing, screenshots, or downloadable media.",
    "Prefer video-first results. Strong YouTube or other downloadable video matches should outrank generic article links.",
    "Saved search queries have highest priority. If they exist, they outweigh topic hints and visual hints.",
    "If there are no saved search queries but there is a visual description, prioritize visual alignment.",
    "If neither saved search queries nor visual description exist, prioritize the segment text and its English translation.",
    "Parent topic title and theme tags are optional hints only when they are explicitly enabled."
  ].join(" ");
  const user = JSON.stringify(
    {
      section_title: shouldUseTopicTitle(segment) ? segment?.section_title ?? "" : "",
      parent_topic_title: shouldUseTopicTitle(segment) ? segment?.section_title ?? "" : "",
      use_topic_title: shouldUseTopicTitle(segment),
      use_theme_tags: shouldUseThemeTags(segment),
      topic_tags: deriveTopicTags(segment),
      text_quote: segment?.text_quote ?? "",
      section_context_text: sectionContextText,
      section_link_hints: sectionLinkHints,
      translated_text_quote: translatedTextQuote,
      priority_mode: priorityMode,
      current_visual_description: segment?.visual_decision?.description ?? "",
      current_search_keywords: Array.isArray(segment?.search_decision?.keywords) ? segment.search_decision.keywords : [],
      current_search_queries: Array.isArray(segment?.search_decision?.queries) ? segment.search_decision.queries : [],
      results: results.map((item) => ({
        result_id: item.id,
        title: item.title,
        snippet: item.snippet,
        domain: item.domain,
        published_at: item.published_at,
        content_type: item.content_type
      }))
    },
    null,
    2
  );

  try {
    const parsed = await requestJson(system, user);
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : [];
    const normalized = items
      .map((item) => ({
        result_id: String(item?.result_id ?? "").trim(),
        relevance_score: Number(item?.relevance_score ?? 0),
        visual_score: Number(item?.visual_score ?? 0),
        source_score: Number(item?.source_score ?? 0),
        freshness_score: Number(item?.freshness_score ?? 0),
        downloadability_score: Number(item?.downloadability_score ?? 0),
        total_score: Number(item?.total_score ?? 0),
        bucket: compactText(item?.bucket, "possible"),
        reason: compactText(item?.reason, "Useful candidate")
      }))
      .filter((item) => item.result_id);
    return normalized.length > 0 ? normalized : fallback;
  } catch {
    return fallback;
  }
}
