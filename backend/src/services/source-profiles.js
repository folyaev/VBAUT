import path from "node:path";

const DEFAULT_SOURCE_PROFILES = {
  version: 1,
  trusted_domains: [
    "reuters.com",
    "apnews.com",
    "bbc.com",
    "cnn.com",
    "nytimes.com",
    "theguardian.com",
    "dw.com",
    "ft.com"
  ],
  blocked_domains: [
    "pinterest.com",
    "quora.com",
    "wikipedia.org"
  ],
  preferred_article_domains: [],
  video_platform_domains: [
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "rutube.ru",
    "dailymotion.com"
  ],
  social_domains: [
    "x.com",
    "twitter.com",
    "reddit.com",
    "tiktok.com",
    "instagram.com",
    "facebook.com",
    "vk.com",
    "t.me"
  ],
  downloadable_domains: [
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "rutube.ru",
    "reddit.com",
    "vk.com",
    "x.com",
    "twitter.com",
    "tiktok.com"
  ],
  screenshot_friendly_domains: [
    "x.com",
    "twitter.com",
    "reddit.com",
    "t.me",
    "instagram.com",
    "facebook.com"
  ],
  domain_profiles: {
    "reuters.com": { trusted: true, source_bias: 0.42, visual_bias: 0.18 },
    "apnews.com": { trusted: true, source_bias: 0.38, visual_bias: 0.14 },
    "bbc.com": { trusted: true, source_bias: 0.34, visual_bias: 0.12 },
    "youtube.com": { downloadable: true, visual_bias: 0.36, downloadability_bias: 0.4 },
    "youtu.be": { downloadable: true, visual_bias: 0.36, downloadability_bias: 0.4 },
    "reddit.com": { screenshot_friendly: true, downloadable: true, visual_bias: 0.22, downloadability_bias: 0.18 },
    "x.com": { screenshot_friendly: true, downloadable: true, visual_bias: 0.2, downloadability_bias: 0.16 },
    "twitter.com": { screenshot_friendly: true, downloadable: true, visual_bias: 0.2, downloadability_bias: 0.16 },
    "vk.com": { screenshot_friendly: true, downloadable: true, visual_bias: 0.22, downloadability_bias: 0.24 },
    "pinterest.com": { blocked: true, source_bias: -0.18, visual_bias: -0.08 },
    "quora.com": { blocked: true, source_bias: -0.16, visual_bias: -0.06 }
  },
  channel_profiles: {}
};

function normalizeDomainList(list = []) {
  return [...new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeScreenshotProfiles(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const normalized = [];
  list.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const width = clampInteger(item.width, 0, 320, 3840);
    const height = clampInteger(item.height, 0, 240, 2160);
    const zoom = clampInteger(item.zoom, 0, 50, 800);
    if (!width || !height || !zoom) return;
    const key = `${width}x${height}@${zoom}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      width,
      height,
      zoom,
      success_count: clampInteger(item.success_count, 0, 0, 100000),
      last_used_at: String(item.last_used_at ?? "").trim().slice(0, 64)
    });
  });
  return normalized.sort((left, right) => {
    const successDelta = Number(right.success_count ?? 0) - Number(left.success_count ?? 0);
    if (successDelta !== 0) return successDelta;
    return String(right.last_used_at ?? "").localeCompare(String(left.last_used_at ?? ""));
  });
}

function normalizeDomainProfiles(input = {}) {
  const normalized = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return normalized;
  Object.entries(input).forEach(([domain, profile]) => {
    const normalizedDomain = String(domain ?? "").trim().toLowerCase();
    if (!normalizedDomain || !profile || typeof profile !== "object" || Array.isArray(profile)) return;
    normalized[normalizedDomain] = {
      trusted: Boolean(profile.trusted),
      blocked: Boolean(profile.blocked),
      downloadable: Boolean(profile.downloadable),
      screenshot_friendly: Boolean(profile.screenshot_friendly),
      language: String(profile.language ?? "").trim().slice(0, 32),
      blocked_in_rf: Boolean(profile.blocked_in_rf),
      responsive_design: Boolean(profile.responsive_design),
      default_video_quality: String(profile.default_video_quality ?? "").trim().slice(0, 64),
      watermarks: Boolean(profile.watermarks),
      notes: String(profile.notes ?? "").trim().slice(0, 512),
      source_bias: Number.isFinite(Number(profile.source_bias)) ? Number(profile.source_bias) : 0,
      visual_bias: Number.isFinite(Number(profile.visual_bias)) ? Number(profile.visual_bias) : 0,
      downloadability_bias: Number.isFinite(Number(profile.downloadability_bias)) ? Number(profile.downloadability_bias) : 0,
      screenshot_profiles: normalizeScreenshotProfiles(profile.screenshot_profiles)
    };
  });
  return normalized;
}

function normalizeChannelProfiles(input = {}) {
  const normalized = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return normalized;
  Object.entries(input).forEach(([key, profile]) => {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey || !profile || typeof profile !== "object" || Array.isArray(profile)) return;
    normalized[normalizedKey] = {
      platform: String(profile.platform ?? "").trim().toLowerCase().slice(0, 32),
      channel_url: String(profile.channel_url ?? "").trim().slice(0, 2048),
      language: String(profile.language ?? "").trim().slice(0, 32),
      watermarks: Boolean(profile.watermarks),
      published_quality: String(profile.published_quality ?? "").trim().slice(0, 64),
      notes: String(profile.notes ?? "").trim().slice(0, 512),
      screenshot_profiles: normalizeScreenshotProfiles(profile.screenshot_profiles)
    };
  });
  return normalized;
}

function normalizeSourceProfiles(input = {}) {
  const merged = {
    ...DEFAULT_SOURCE_PROFILES,
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {})
  };

  return {
    version: Number.isFinite(Number(merged.version)) ? Number(merged.version) : 1,
    trusted_domains: normalizeDomainList(merged.trusted_domains),
    blocked_domains: normalizeDomainList(merged.blocked_domains),
    preferred_article_domains: normalizeDomainList(merged.preferred_article_domains),
    video_platform_domains: normalizeDomainList(merged.video_platform_domains),
    social_domains: normalizeDomainList(merged.social_domains),
    downloadable_domains: normalizeDomainList(merged.downloadable_domains),
    screenshot_friendly_domains: normalizeDomainList(merged.screenshot_friendly_domains),
    domain_profiles: normalizeDomainProfiles({
      ...DEFAULT_SOURCE_PROFILES.domain_profiles,
      ...(merged.domain_profiles ?? {})
    }),
    channel_profiles: normalizeChannelProfiles({
      ...DEFAULT_SOURCE_PROFILES.channel_profiles,
      ...(merged.channel_profiles ?? {})
    })
  };
}

export function sanitizeSourceProfiles(input = {}) {
  return normalizeSourceProfiles(input);
}

export function domainMatches(domain, list = []) {
  const normalizedDomain = String(domain ?? "").trim().toLowerCase();
  if (!normalizedDomain) return false;
  return normalizeDomainList(list).some(
    (candidate) => normalizedDomain === candidate || normalizedDomain.endsWith(`.${candidate}`)
  );
}

export function getDomainProfile(domain, sourceProfiles = {}) {
  const normalizedDomain = String(domain ?? "").trim().toLowerCase();
  if (!normalizedDomain) return null;
  const entries = Object.entries(sourceProfiles?.domain_profiles ?? {});
  for (const [candidate, profile] of entries) {
    const normalizedCandidate = String(candidate ?? "").trim().toLowerCase();
    if (!normalizedCandidate) continue;
    if (normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`)) {
      return profile;
    }
  }
  return null;
}

export function isBlockedResearchDomain(domain, sourceProfiles = {}) {
  const profile = getDomainProfile(domain, sourceProfiles);
  return Boolean(
    domainMatches(domain, sourceProfiles?.blocked_domains) ||
      profile?.blocked ||
      profile?.blocked_in_rf
  );
}

export function createSourceProfilesStore({ dataDir, readOptionalJson, writeJson }) {
  const filePath = path.join(dataDir, "source-profiles.json");

  async function ensureSourceProfiles() {
    const current = await readOptionalJson(filePath);
    const normalized = normalizeSourceProfiles(current);
    const needsWrite = JSON.stringify(current ?? null) !== JSON.stringify(normalized);
    if (needsWrite) {
      await writeJson(filePath, normalized);
    }
    return normalized;
  }

  async function getSourceProfiles() {
    return ensureSourceProfiles();
  }

  async function updateSourceProfiles(nextProfiles) {
    const normalized = normalizeSourceProfiles(nextProfiles);
    await writeJson(filePath, normalized);
    return normalized;
  }

  return {
    filePath,
    ensureSourceProfiles,
    getSourceProfiles,
    updateSourceProfiles
  };
}
