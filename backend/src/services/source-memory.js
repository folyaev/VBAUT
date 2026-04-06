import path from "node:path";
import { extractSourceScopeKey } from "./source-identity.js";

const DEFAULT_SOURCE_MEMORY = {
  version: 1,
  domains: {},
  urls: {},
  recent: [],
  patterns: []
};

function normalizeDomain(input) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeUrl(input) {
  try {
    return new URL(String(input ?? "").trim()).toString();
  } catch {
    return "";
  }
}

function compactText(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
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

function buildSegmentKey(sectionTitle, tokens = []) {
  const normalizedTitle = compactText(sectionTitle).toLowerCase();
  const head = normalizedTitle
    ? normalizedTitle.replace(/[^\p{L}\p{N}\s-]+/gu, " ").replace(/\s+/g, "_").slice(0, 48)
    : "segment";
  const tail = (Array.isArray(tokens) ? tokens : []).slice(0, 3).join("_");
  return compactText(`${head}_${tail}`).replace(/\s+/g, "_").slice(0, 96) || "segment";
}

function sanitizeMemory(input = {}) {
  const normalized = {
    version: Number.isFinite(Number(input?.version)) ? Number(input.version) : 1,
    domains: {},
    urls: {},
    recent: [],
    patterns: []
  };

  if (input?.domains && typeof input.domains === "object" && !Array.isArray(input.domains)) {
    Object.entries(input.domains).forEach(([domain, stats]) => {
      const normalizedDomain = normalizeDomain(domain);
      if (!normalizedDomain || !stats || typeof stats !== "object" || Array.isArray(stats)) return;
      normalized.domains[normalizedDomain] = {
        applied_count: Number(stats.applied_count ?? 0) || 0,
        helpful_count: Number(stats.helpful_count ?? 0) || 0,
        source_count: Number(stats.source_count ?? 0) || 0,
        attach_count: Number(stats.attach_count ?? 0) || 0,
        screenshot_count: Number(stats.screenshot_count ?? 0) || 0,
        download_count: Number(stats.download_count ?? 0) || 0,
        last_used_at: String(stats.last_used_at ?? "").trim() || null,
        last_title: String(stats.last_title ?? "").trim() || null,
        last_url: normalizeUrl(stats.last_url) || null
      };
    });
  }

  if (input?.urls && typeof input.urls === "object" && !Array.isArray(input.urls)) {
    Object.entries(input.urls).forEach(([url, stats]) => {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl || !stats || typeof stats !== "object" || Array.isArray(stats)) return;
      normalized.urls[normalizedUrl] = {
        domain: normalizeDomain(stats.domain),
        applied_count: Number(stats.applied_count ?? 0) || 0,
        last_used_at: String(stats.last_used_at ?? "").trim() || null,
        last_title: String(stats.last_title ?? "").trim() || null
      };
    });
  }

  normalized.recent = (Array.isArray(input?.recent) ? input.recent : [])
    .map((item) => ({
      domain: normalizeDomain(item?.domain),
      url: normalizeUrl(item?.url),
      title: String(item?.title ?? "").trim() || null,
      action: String(item?.action ?? "").trim() || null,
      segment_id: String(item?.segment_id ?? "").trim() || null,
      doc_id: String(item?.doc_id ?? "").trim() || null,
      used_at: String(item?.used_at ?? "").trim() || null
    }))
    .filter((item) => item.domain && item.url)
    .slice(0, 100);

  normalized.patterns = (Array.isArray(input?.patterns) ? input.patterns : [])
    .map((item) => ({
      segment_key: String(item?.segment_key ?? "").trim() || null,
      section_title: compactText(item?.section_title) || null,
      quote_preview: compactText(item?.quote_preview) || null,
      tokens: (Array.isArray(item?.tokens) ? item.tokens : [])
        .map((token) => String(token ?? "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 24),
      domain: normalizeDomain(item?.domain),
      url: normalizeUrl(item?.url),
      action: String(item?.action ?? "").trim() || null,
      used_at: String(item?.used_at ?? "").trim() || null
    }))
    .filter((item) => item.segment_key && item.domain && item.url && item.tokens.length > 0)
    .slice(0, 200);

  return normalized;
}

function summarizeMemory(memory = {}) {
  const domains = Object.entries(memory?.domains ?? {})
    .map(([domain, stats]) => ({
      domain,
      ...(stats && typeof stats === "object" ? stats : {})
    }))
    .sort(
      (a, b) =>
        Number(b.applied_count ?? 0) - Number(a.applied_count ?? 0) ||
        String(b.last_used_at ?? "").localeCompare(String(a.last_used_at ?? ""))
    );

  const patternMap = new Map();
  (Array.isArray(memory?.patterns) ? memory.patterns : []).forEach((item) => {
    const key = String(item?.segment_key ?? "").trim();
    if (!key) return;
    const current = patternMap.get(key) ?? {
      segment_key: key,
      section_title: item?.section_title ?? null,
      count: 0,
      last_used_at: null,
      sample_domain: item?.domain ?? null
    };
    current.count += 1;
    current.last_used_at =
      String(item?.used_at ?? "") > String(current.last_used_at ?? "") ? String(item?.used_at ?? "") : current.last_used_at;
    if (!current.section_title && item?.section_title) current.section_title = item.section_title;
    if (!current.sample_domain && item?.domain) current.sample_domain = item.domain;
    patternMap.set(key, current);
  });
  const topPatterns = [...patternMap.values()].sort(
    (a, b) => Number(b.count ?? 0) - Number(a.count ?? 0) || String(b.last_used_at ?? "").localeCompare(String(a.last_used_at ?? ""))
  );

  return {
    total_domains: domains.length,
    total_urls: Object.keys(memory?.urls ?? {}).length,
    total_patterns: patternMap.size,
    top_domains: domains.slice(0, 8),
    top_patterns: topPatterns.slice(0, 8),
    recent: (Array.isArray(memory?.recent) ? memory.recent : []).slice(0, 12)
  };
}

export function createSourceMemoryStore({ dataDir, readOptionalJson, writeJson }) {
  const filePath = path.join(dataDir, "source-memory.json");

  async function ensureSourceMemory() {
    const current = await readOptionalJson(filePath);
    const normalized = sanitizeMemory(current ?? DEFAULT_SOURCE_MEMORY);
    const needsWrite = JSON.stringify(current ?? null) !== JSON.stringify(normalized);
    if (needsWrite) {
      await writeJson(filePath, normalized);
    }
    return normalized;
  }

  async function getSourceMemory() {
    return ensureSourceMemory();
  }

  async function recordSourceUsage(input = {}) {
    const domain = normalizeDomain(input.domain);
    const url = normalizeUrl(input.url);
    const action = String(input.action ?? "").trim().toLowerCase();
    if (!domain || !url || !action) {
      throw new Error("domain, url and action are required");
    }
    const current = await ensureSourceMemory();
    const next = sanitizeMemory(current);
    const nowIso = String(input.used_at ?? new Date().toISOString());
    const sectionTitle = compactText(input.section_title);
    const quotePreview = compactText(input.text_quote).slice(0, 220) || null;
    const tokens = tokenizeSegmentText(sectionTitle, input.text_quote);
    const segmentKey = buildSegmentKey(sectionTitle, tokens);
    const sourceScopeKey =
      extractSourceScopeKey({
        domain,
        url,
        uploader: input.uploader,
        uploaderUrl: input.uploader_url
      }) || domain;

    const domainStats = {
      applied_count: 0,
      helpful_count: 0,
      source_count: 0,
      attach_count: 0,
      screenshot_count: 0,
      download_count: 0,
      last_used_at: null,
      last_title: null,
      last_url: null,
      ...(next.domains[sourceScopeKey] ?? {})
    };
    domainStats.applied_count += 1;
    if (action === "mark_helpful") domainStats.helpful_count += 1;
    if (action === "use_as_source") domainStats.source_count += 1;
    if (action === "attach_asset") domainStats.attach_count += 1;
    if (action === "screenshot") domainStats.screenshot_count += 1;
    if (action === "download") domainStats.download_count += 1;
    domainStats.last_used_at = nowIso;
    domainStats.last_title = String(input.title ?? "").trim() || domainStats.last_title;
    domainStats.last_url = url;
    next.domains[sourceScopeKey] = domainStats;

    const urlStats = {
      domain,
      applied_count: 0,
      last_used_at: null,
      last_title: null,
      ...(next.urls[url] ?? {})
    };
    urlStats.applied_count += 1;
    urlStats.last_used_at = nowIso;
    urlStats.last_title = String(input.title ?? "").trim() || urlStats.last_title;
    next.urls[url] = urlStats;

    next.recent = [
      {
        domain,
        url,
        title: String(input.title ?? "").trim() || null,
        action,
        segment_id: String(input.segment_id ?? "").trim() || null,
        doc_id: String(input.doc_id ?? "").trim() || null,
        used_at: nowIso
      },
      ...next.recent.filter((item) => !(item.url === url && item.action === action && item.segment_id === String(input.segment_id ?? "").trim()))
    ].slice(0, 100);

    if (tokens.length > 0) {
      next.patterns = [
        {
          segment_key: segmentKey,
          section_title: sectionTitle || null,
          quote_preview: quotePreview,
          tokens,
          domain,
          url,
          action,
          used_at: nowIso
        },
        ...next.patterns.filter(
          (item) =>
            !(
              item.url === url &&
              item.domain === domain &&
              item.segment_key === segmentKey &&
              item.action === action
            )
        )
      ].slice(0, 200);
    }

    await writeJson(filePath, next);
    return next;
  }

  return {
    filePath,
    ensureSourceMemory,
    getSourceMemory,
    recordSourceUsage,
    summarizeMemory
  };
}
