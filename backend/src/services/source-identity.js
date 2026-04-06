function compactText(value = "") {
  return String(value ?? "").trim();
}

function normalizeDomain(value = "") {
  return compactText(value).toLowerCase();
}

function normalizeHandle(value = "") {
  return compactText(value).replace(/^@+/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function safeUrl(value = "") {
  try {
    return new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
}

function pickPathSegment(pathname = "", index = 0) {
  const segments = String(pathname ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalizeHandle(segments[index] ?? "");
}

export function extractSourceScopeKey({ domain = "", url = "", uploader = "", uploaderUrl = "" } = {}) {
  const normalizedDomain = normalizeDomain(domain);
  const uploaderUrlValue = safeUrl(uploaderUrl);
  if (uploaderUrlValue) {
    const host = normalizeDomain(uploaderUrlValue.hostname);
    const path = String(uploaderUrlValue.pathname ?? "").replace(/\/+$/, "");
    if (host && path && path !== "/") {
      return `${host}${path}`.toLowerCase();
    }
  }

  const normalizedUploader = normalizeHandle(uploader);
  if (normalizedUploader) {
    if (normalizedDomain.includes("youtube.com") || normalizedDomain === "youtu.be") return `youtube.com/@${normalizedUploader}`;
    if (normalizedDomain.includes("x.com") || normalizedDomain.includes("twitter.com")) return `x.com/${normalizedUploader}`;
    if (normalizedDomain.includes("t.me") || normalizedDomain.includes("telegram.me")) return `t.me/${normalizedUploader}`;
    if (normalizedDomain.includes("instagram.com")) return `instagram.com/${normalizedUploader}`;
    if (normalizedDomain.includes("facebook.com")) return `facebook.com/${normalizedUploader}`;
  }

  const urlValue = safeUrl(url);
  if (!urlValue) return normalizedDomain;
  const host = normalizeDomain(urlValue.hostname);
  const path = String(urlValue.pathname ?? "");
  if (!host) return normalizedDomain;

  if (host.includes("youtube.com")) {
    const firstSegment = pickPathSegment(path, 0);
    const secondSegment = pickPathSegment(path, 1);
    if (firstSegment.startsWith("@")) return `youtube.com/${firstSegment}`;
    if (["channel", "c", "user"].includes(firstSegment) && secondSegment) {
      return `youtube.com/${firstSegment}/${secondSegment}`;
    }
    return normalizedDomain || "youtube.com";
  }
  if (host === "youtu.be") {
    return normalizedDomain || "youtu.be";
  }
  if (host.includes("x.com") || host.includes("twitter.com")) {
    const handle = pickPathSegment(path, 0);
    return handle ? `x.com/${handle}` : normalizedDomain || "x.com";
  }
  if (host.includes("t.me") || host.includes("telegram.me")) {
    const handle = pickPathSegment(path, 0);
    return handle ? `t.me/${handle}` : normalizedDomain || "t.me";
  }
  if (host.includes("instagram.com")) {
    const handle = pickPathSegment(path, 0);
    return handle ? `instagram.com/${handle}` : normalizedDomain || "instagram.com";
  }
  if (host.includes("facebook.com")) {
    const handle = pickPathSegment(path, 0);
    return handle ? `facebook.com/${handle}` : normalizedDomain || "facebook.com";
  }
  if (host.includes("rutube.ru")) {
    const firstSegment = pickPathSegment(path, 0);
    const secondSegment = pickPathSegment(path, 1);
    if (firstSegment === "channel" && secondSegment) return `rutube.ru/channel/${secondSegment}`;
  }

  return normalizedDomain || host;
}
