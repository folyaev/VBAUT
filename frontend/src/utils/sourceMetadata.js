function compactText(value = "") {
  return String(value ?? "").trim();
}

function extractDomainFromValue(value = "") {
  const raw = compactText(value);
  if (!raw) return "";
  try {
    return String(new URL(raw).hostname ?? "").trim().toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }
}

function normalizeQualityLabel(raw = "") {
  const value = compactText(raw).toLowerCase();
  if (!value) return "";
  const explicit = value.match(/(?:^|[^0-9])((?:2160|1440|1080|720|480|360|240)p)(?:[^0-9]|$)/i);
  if (explicit?.[1]) return explicit[1].toLowerCase();
  const resolution = value.match(/(\d{2,5})x(\d{2,5})/i);
  if (resolution?.[1] && resolution?.[2]) {
    const width = Number(resolution[1]);
    const height = Number(resolution[2]);
    const vertical = Number.isFinite(width) && Number.isFinite(height) ? Math.min(width, height) : 0;
    if (vertical >= 2160) return "2160p";
    if (vertical >= 1440) return "1440p";
    if (vertical >= 1080) return "1080p";
    if (vertical >= 720) return "720p";
    if (vertical >= 480) return "480p";
    if (vertical >= 360) return "360p";
    if (vertical >= 240) return "240p";
  }
  const fallback = value.match(/\b(2160|1440|1080|720|480|360|240)\b/);
  return fallback?.[1] ? `${fallback[1]}p` : "";
}

function normalizeChannelIdentity(value = "") {
  const raw = compactText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return raw.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function resolveDomainProfile(asset = {}, sourceProfiles = {}) {
  const assetDomain = compactText(asset?.source_domain || extractDomainFromValue(asset?.source_url)).toLowerCase();
  if (!assetDomain) return null;
  const entries = Object.entries(sourceProfiles?.domain_profiles ?? {});
  return (
    entries.find(([domain]) => {
      const normalizedDomain = compactText(domain).toLowerCase();
      return normalizedDomain && (assetDomain === normalizedDomain || assetDomain.endsWith(`.${normalizedDomain}`));
    })?.[1] ?? null
  );
}

function resolveChannelProfile(asset = {}, sourceProfiles = {}) {
  const meta = asset?.meta_json ?? {};
  const uploader = normalizeChannelIdentity(meta?.uploader);
  const uploaderUrl = normalizeChannelIdentity(meta?.uploader_url);
  if (!uploader && !uploaderUrl) return null;
  const entries = Object.entries(sourceProfiles?.channel_profiles ?? {});
  return (
    entries.find(([channelKey, profile]) => {
      const keyIdentity = normalizeChannelIdentity(channelKey);
      const profileUrlIdentity = normalizeChannelIdentity(profile?.channel_url);
      if (uploader && keyIdentity && (uploader === keyIdentity || uploader === keyIdentity.replace(/^@/, ""))) {
        return true;
      }
      if (uploaderUrl && profileUrlIdentity && (uploaderUrl === profileUrlIdentity || uploaderUrl.startsWith(`${profileUrlIdentity}/`))) {
        return true;
      }
      if (uploaderUrl && keyIdentity && uploaderUrl.includes(keyIdentity.replace(/^@/, ""))) {
        return true;
      }
      return false;
    })?.[1] ?? null
  );
}

export function buildSourceMetadataBadges(asset = {}, sourceProfiles = {}) {
  const meta = asset?.meta_json ?? {};
  const domainProfile = resolveDomainProfile(asset, sourceProfiles);
  const channelProfile = resolveChannelProfile(asset, sourceProfiles);
  const language = compactText(channelProfile?.language || domainProfile?.language).toUpperCase();
  const quality = normalizeQualityLabel(
    meta?.resolution || meta?.format_note || channelProfile?.published_quality || domainProfile?.default_video_quality
  );
  const watermarks = channelProfile ? Boolean(channelProfile?.watermarks) : Boolean(domainProfile?.watermarks);
  const badges = [
    domainProfile?.blocked_in_rf ? "RU blocked" : "",
    domainProfile?.responsive_design ? "Responsive" : "",
    watermarks ? "Watermarks" : "",
    quality,
    language ? `Lang ${language}` : ""
  ].filter(Boolean);
  return Array.from(new Set(badges));
}
