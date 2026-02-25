export function normalizeLinkUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function canonicalizeLinkUrl(rawUrl) {
  const normalized = normalizeLinkUrl(rawUrl);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.port === "80") url.port = "";
    if (url.protocol === "https:" && url.port === "443") url.port = "";
    return url.toString();
  } catch {
    return normalized;
  }
}

export function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ""));
}

export function normalizeLinksInput(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  raw.forEach((item) => {
    if (typeof item === "string") {
      const url = normalizeLinkUrl(item);
      if (!url) return;
      const canonical = canonicalizeLinkUrl(url);
      if (!canonical || seen.has(canonical)) return;
      seen.add(canonical);
      result.push({ url, raw: item });
      return;
    }
    if (!item || typeof item !== "object") return;
    const url = normalizeLinkUrl(item.url ?? item.href ?? item.link ?? "");
    if (!url) return;
    const canonical = canonicalizeLinkUrl(url);
    if (!canonical || seen.has(canonical)) return;
    seen.add(canonical);
    result.push({ url, raw: typeof item.raw === "string" ? item.raw : null });
  });
  return result;
}
