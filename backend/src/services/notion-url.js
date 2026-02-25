export function normalizeNotionUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isNotionUrl(url) {
  return /notion\.(so|site)\b/i.test(String(url ?? ""));
}
