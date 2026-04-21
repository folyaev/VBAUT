const DEFAULT_TIMEOUT_MS = Number.isFinite(Number(process.env.RESEARCH_REQUEST_TIMEOUT_MS))
  ? Math.max(1000, Number(process.env.RESEARCH_REQUEST_TIMEOUT_MS))
  : 12000;
const DEFAULT_RESULTS_PER_QUERY = Number.isFinite(Number(process.env.RESEARCH_RESULTS_PER_QUERY))
  ? Math.max(1, Number(process.env.RESEARCH_RESULTS_PER_QUERY))
  : 8;
const SEARXNG_URL = String(process.env.RESEARCH_SEARXNG_URL ?? process.env.SEARXNG_URL ?? "").trim().replace(/\/+$/, "");

function inferPhase(item = {}) {
  const explicit = String(item?.phase ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  if (kind === "source") return "source";
  if (kind === "visual") return "visual";
  const contentType = String(item?.content_type ?? "").trim().toLowerCase();
  const haystack = `${String(item?.title ?? "")} ${String(item?.snippet ?? item?.content ?? "")} ${String(item?.url ?? "")}`.toLowerCase();
  if (
    contentType.includes("video") ||
    contentType.includes("image") ||
    /(video|footage|photo|gallery|image|watch|clip|frame|screenshot)/.test(haystack)
  ) {
    return "visual";
  }
  if (/(reuters|ap|statement|official|source|report|briefing|document)/.test(haystack)) {
    return "source";
  }
  return "context";
}

function normalizeDomain(input) {
  try {
    return new URL(String(input ?? "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isStaticAssetPath(url = "") {
  return /\.(?:svg|png|jpe?g|gif|webp|ico|css|js|mjs|map|woff2?|ttf|otf)(?:[?#].*)?$/i.test(String(url ?? "").trim());
}

function isGarbageResearchResult(item = {}) {
  const url = String(item?.url ?? "").trim();
  const title = String(item?.title ?? "").trim();
  const snippet = String(item?.snippet ?? item?.content ?? "").trim();
  const domain = String(item?.domain ?? normalizeDomain(url)).trim().toLowerCase();
  const haystack = `${title} ${snippet} ${url} ${domain}`.toLowerCase();
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (!url) return true;

  const junkDomains = [
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "raw.githubusercontent.com",
    "registry.npmjs.org"
  ];
  if (junkDomains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
    return true;
  }

  if (isStaticAssetPath(url) && /(icon|sprite|logo|devicon|lucide|npm|cdn|assets?)/i.test(haystack)) {
    return true;
  }

  if (/\/(?:npm|gh)\//.test(pathname) && /(icons?|devicon|lucide-static)/i.test(pathname)) {
    return true;
  }

  if (/^(?:gallery|align|alarm|aftereffects|firebase|camera|cable|bell|book-image|camera-off)(?:[-\w]*)$/i.test(title)) {
    return true;
  }

  if (snippet && /^(carousel|pictures|images|scroll|swipe|album|portfolio|history|versions|backup|time machine)\b/i.test(snippet)) {
    return true;
  }

  return false;
}

function normalizeSeedResults(seedResults = []) {
  return (Array.isArray(seedResults) ? seedResults : []).map((item, index) => ({
    id: String(item?.id ?? `seed_${index + 1}`),
    query_id: String(item?.query_id ?? ""),
    phase: inferPhase(item),
    engine: String(item?.engine ?? "seed"),
    url: String(item?.url ?? "").trim(),
    title: String(item?.title ?? "").trim(),
    snippet: String(item?.snippet ?? item?.content ?? "").trim(),
    domain: String(item?.domain ?? normalizeDomain(item?.url)).trim(),
    published_at: String(item?.published_at ?? item?.published ?? "").trim() || null,
    position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index + 1,
    content_type: String(item?.content_type ?? "article").trim() || "article"
  })).filter((item) => item.url && !isGarbageResearchResult(item));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearxResult(result, query, index) {
  const url = String(result?.url ?? "").trim();
  return {
    id: `${query.id}_res_${index + 1}`,
    query_id: String(query.id ?? ""),
    phase: inferPhase(query),
    engine: String(result?.engine ?? "searxng"),
    url,
    title: String(result?.title ?? url).trim(),
    snippet: String(result?.content ?? result?.snippet ?? "").trim(),
    domain: normalizeDomain(url),
    published_at: String(result?.publishedDate ?? result?.published_at ?? "").trim() || null,
    position: index + 1,
    content_type: String(result?.category ?? "article").trim() || "article"
  };
}

export async function searchQueries(queries = [], options = {}) {
  const normalizedQueries = (Array.isArray(queries) ? queries : [])
    .map((item, index) => ({
      id: String(item?.id ?? `q${index + 1}`),
      text: String(item?.text ?? "").trim(),
      lang: String(item?.lang ?? "auto").trim() || "auto",
      kind: String(item?.kind ?? "general").trim() || "general",
      phase: inferPhase(item)
    }))
    .filter((item) => item.text);

  if (Array.isArray(options.seed_results) && options.seed_results.length > 0) {
    return {
      results: normalizeSeedResults(options.seed_results),
      warnings: ["Using seed_results override"]
    };
  }

  if (!SEARXNG_URL) {
    return {
      results: [],
      warnings: ["RESEARCH_SEARXNG_URL is not configured"]
    };
  }

  const results = [];
  const warnings = [];
  let skippedGarbageCount = 0;
  const mode = String(options?.mode ?? "fast").trim().toLowerCase() || "fast";
  const perQueryLimit = Number.isFinite(Number(options.limit_per_query))
    ? Math.max(1, Number(options.limit_per_query))
    : mode === "deep"
      ? Math.max(DEFAULT_RESULTS_PER_QUERY, 12)
      : DEFAULT_RESULTS_PER_QUERY;

  for (const query of normalizedQueries) {
    const url = new URL(`${SEARXNG_URL}/search`);
    url.searchParams.set("q", query.text);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", query.lang === "ru" ? "ru-RU" : query.lang === "en" ? "en-US" : "all");
    url.searchParams.set("safesearch", "0");
    const categories =
      query.phase === "visual" || query.kind === "visual"
        ? "images,general,news"
        : query.phase === "source" || query.kind === "source"
          ? "news,general"
          : "general,news";
    url.searchParams.set("categories", categories);

    try {
      const response = await fetchWithTimeout(url.toString(), {
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        warnings.push(`SearxNG error ${response.status} for query ${query.text}`);
        continue;
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.results) ? payload.results : [];
      const normalizedItems = items
        .slice(0, perQueryLimit)
        .map((item, index) => normalizeSearxResult(item, query, index))
        .filter((item) => item.url);
      const filteredItems = normalizedItems.filter((item) => !isGarbageResearchResult(item));
      skippedGarbageCount += Math.max(0, normalizedItems.length - filteredItems.length);
      results.push(...filteredItems);
    } catch (error) {
      warnings.push(`SearxNG request failed for query ${query.text}: ${error.message}`);
    }
  }

  if (skippedGarbageCount > 0) {
    warnings.push(`Skipped ${skippedGarbageCount} technical/static asset result(s).`);
  }

  return { results, warnings };
}
