import { spawn } from "node:child_process";
import { isYtDlpCandidateUrl } from "../downloader.js";
import { isHttpUrl } from "./links.js";

export function createLinkPreviewUtils(options = {}) {
  const SCREENSHOT_FALLBACK_REV = "10";
  const ytDlpPath = String(options?.ytDlpPath ?? "").trim();
  const ytdlpEnabled = Boolean(ytDlpPath);
  const ytdlpCacheTtlMs = 30 * 60 * 1000;
  const ytdlpCache = new Map();
  const HTML_PREVIEW_USER_AGENTS = [
    "TelegramBot (like TwitterBot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
  ];
  const ANTI_BOT_MARKERS = [
    "checking your browser",
    "just a moment",
    "ddos protection",
    "verify you are human",
    "security check",
    "browser check",
    "проверка браузера",
    "перед переходом на сайт",
    "подозрительная активность",
    "captcha",
    "cloudflare"
  ];
  const OEMBED_ENDPOINT_BUILDERS = [
    (targetUrl) => `https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`,
    (targetUrl) => `https://open.iframe.ly/api/oembed?url=${encodeURIComponent(targetUrl)}`
  ];

  function getHost(rawUrl) {
    try {
      return new URL(String(rawUrl ?? "")).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  }

  function isPrivateOrLocalHost(host) {
    const value = String(host ?? "").toLowerCase();
    if (!value) return true;
    if (value === "localhost" || value.endsWith(".localhost") || value === "::1") return true;
    if (value === "0.0.0.0") return true;
    if (/^127\./.test(value)) return true;
    if (/^10\./.test(value)) return true;
    if (/^192\.168\./.test(value)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
    if (value.endsWith(".local")) return true;
    return false;
  }

  function supportsScreenshotFallback(rawUrl) {
    const host = getHost(rawUrl);
    if (!host) return false;
    return !isPrivateOrLocalHost(host);
  }

  function stripTrackingParamsForScreenshot(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl ?? ""));
      const dropExact = new Set([
        "from",
        "source",
        "ref",
        "ref_src",
        "ref_url",
        "fbclid",
        "gclid",
        "yclid",
        "mc_cid",
        "mc_eid",
        "_hsenc",
        "_hsmi"
      ]);
      const keys = [...parsed.searchParams.keys()];
      for (const key of keys) {
        const lower = String(key ?? "").toLowerCase();
        if (!lower) continue;
        if (lower.startsWith("utm_") || dropExact.has(lower)) {
          parsed.searchParams.delete(key);
        }
      }
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return String(rawUrl ?? "").trim();
    }
  }

  function buildScreenshotFallbackUrl(rawUrl) {
    const normalized = stripTrackingParamsForScreenshot(String(rawUrl ?? "").trim());
    if (!isHttpUrl(normalized)) return "";
    return `/api/link/screenshot?url=${encodeURIComponent(normalized)}&v=${SCREENSHOT_FALLBACK_REV}`;
  }

  function toProxyImageUrl(rawUrl) {
    const value = String(rawUrl ?? "").trim();
    if (!value) return "";
    if (value.startsWith("/api/link/")) return value;
    if (value.startsWith("data:")) return value;
    if (!isHttpUrl(value)) return "";
    return `/api/link/image?url=${encodeURIComponent(value)}`;
  }

  async function fetchLinkPreview(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (isDirectImageUrl(url)) {
        return {
          url,
          title: deriveTitleFromUrl(url) || getHost(url),
          description: "",
          image: toProxyImageUrl(url),
          siteName: getHost(url)
        };
      }

      const youtubeId = getYouTubeId(url);
      if (youtubeId) {
        const youtubePreview = await fetchYouTubePreview(url, youtubeId, controller);
        if (youtubePreview && hasUsefulPreview(youtubePreview)) return finalizePreviewPayload(url, youtubePreview);
      }

      const tweetId = getTweetId(url);
      if (tweetId) {
        const xPreview = await fetchXPreview(url, tweetId, controller);
        if (xPreview) return finalizePreviewPayload(url, xPreview);
      }

      if (isVkUrl(url)) {
        const vkBotPreview = await fetchVkBotPreview(url, controller);
        if (vkBotPreview) return finalizePreviewPayload(url, vkBotPreview);
        const vkPreview = await fetchVkOembedPreview(url, controller);
        if (vkPreview) return finalizePreviewPayload(url, vkPreview);
      }

      const htmlPreview = await fetchHtmlPreview(url, controller);
      const enrichedPreview = await enrichPreviewWithYtDlp(url, htmlPreview);
      if (hasUsefulPreview(enrichedPreview)) return finalizePreviewPayload(url, enrichedPreview);
      const oembedPreview = await fetchOEmbedPreview(url, controller);
      const enrichedOembedPreview = await enrichPreviewWithYtDlp(url, oembedPreview);
      if (hasUsefulPreview(enrichedOembedPreview)) return finalizePreviewPayload(url, enrichedOembedPreview);
      return buildFallbackPreview(url);
    } catch {
      const enrichedFallback = await enrichPreviewWithYtDlp(url, null);
      if (hasUsefulPreview(enrichedFallback)) return finalizePreviewPayload(url, enrichedFallback);
      return buildFallbackPreview(url);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchHtmlPreview(url, controller) {
    let weakPreview = null;
    for (const userAgent of HTML_PREVIEW_USER_AGENTS) {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
            "user-agent": userAgent
          }
        });
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) continue;

        const html = await decodeHtmlResponse(response);
        const head = html.slice(0, 200000);
        const preview = extractPreviewFromHead(url, head);
        if (hasStrongPreview(preview)) {
          return stripInternalPreviewFields(preview);
        }
        if (!weakPreview && hasUsefulPreview(preview)) {
          weakPreview = preview;
        }
      } catch {
        continue;
      }
    }
    return weakPreview ? stripInternalPreviewFields(weakPreview) : null;
  }

  async function fetchYouTubePreview(url, youtubeId, controller) {
    const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    const oembed = await fetchJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      controller
    );
    const noembed = await fetchJson(
      `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`,
      controller
    );
    const noembedError = String(noembed?.error ?? "").trim().toLowerCase();
    let title = sanitizePreviewTitle(String(oembed?.title ?? noembed?.title ?? "").trim(), watchUrl);
    if (!title) {
      const htmlPreview = await fetchHtmlPreview(watchUrl, controller);
      title = sanitizePreviewTitle(String(htmlPreview?.title ?? "").trim(), watchUrl);
    }
    if (isLikelyYouTubeUnavailableTitle(title) || noembedError.includes("not found")) {
      title = "Видео недоступно на YouTube";
    }
    if (!title) {
      title = "Видео YouTube";
    }

    const description = String(oembed?.author_name ?? noembed?.author_name ?? "").trim();
    const thumbnailCandidates = uniqueNonEmpty([
      oembed?.thumbnail_url,
      noembed?.thumbnail_url,
      ...buildYouTubeThumbnailCandidates(youtubeId)
    ]);
    const thumbnail = await resolveFirstReachableImage(thumbnailCandidates, controller);
    const thumbnailFallback = thumbnail || thumbnailCandidates[0] || "";
    const image =
      toProxyImageUrl(thumbnailFallback) ||
      (supportsScreenshotFallback(url) ? toProxyImageUrl(buildScreenshotFallbackUrl(url)) : "");
    return {
      url,
      title,
      description,
      image,
      siteName: "YouTube"
    };
  }

  async function fetchOEmbedPreview(url, controller) {
    for (const buildEndpoint of OEMBED_ENDPOINT_BUILDERS) {
      let endpoint = "";
      try {
        endpoint = buildEndpoint(url);
      } catch {
        endpoint = "";
      }
      if (!endpoint) continue;
      const payload = await fetchJson(endpoint, controller);
      if (!isUsefulOEmbedResponse(payload)) continue;

      const rawTitle = String(payload.title ?? "").trim();
      const title = sanitizePreviewTitle(rawTitle, url);
      const description = String(payload.description ?? payload.author_name ?? "").trim();
      const imageRaw = String(payload.thumbnail_url ?? payload.thumbnail ?? payload.image ?? "").trim();
      const image = toProxyImageUrl(imageRaw);
      const siteName =
        String(payload.provider_name ?? "").trim() ||
        String(payload.author_name ?? "").trim() ||
        getHost(url);

      const hasInformativeText = Boolean(title || description);
      const hasNativeImage = Boolean(image);
      if (!hasInformativeText && !hasNativeImage) continue;

      const fallbackImage = hasNativeImage
        ? ""
        : supportsScreenshotFallback(url)
          ? toProxyImageUrl(buildScreenshotFallbackUrl(url))
          : "";

      return {
        url,
        title: title || deriveTitleFromUrl(url) || getHost(url),
        description,
        image: image || fallbackImage,
        siteName
      };
    }
    return null;
  }

  async function enrichPreviewWithYtDlp(url, basePreview) {
    const preview = {
      ...(basePreview && typeof basePreview === "object" ? basePreview : buildFallbackPreview(url))
    };
    if (!shouldUseYtDlpEnrichment(url, preview)) {
      return preview;
    }

    const metadata = await fetchYtDlpMetadata(url);
    if (!metadata) return preview;

    const title = String(preview.title ?? "").trim() || String(metadata.title ?? "").trim() || deriveTitleFromUrl(url);
    const description = String(preview.description ?? "").trim() || String(metadata.description ?? "").trim();
    const image =
      String(preview.image ?? "").trim() ||
      toProxyImageUrl(metadata.thumbnail ?? "") ||
      (supportsScreenshotFallback(url) ? toProxyImageUrl(buildScreenshotFallbackUrl(url)) : "");
    const siteName =
      String(preview.siteName ?? "").trim() ||
      String(metadata.siteName ?? "").trim() ||
      getHost(url);

    return {
      url,
      title,
      description,
      image,
      siteName
    };
  }

  function shouldUseYtDlpEnrichment(url, preview) {
    if (!ytdlpEnabled) return false;
    if (!isYtDlpCandidateUrl(url)) return false;
    const title = String(preview?.title ?? "").trim();
    const description = String(preview?.description ?? "").trim();
    const image = String(preview?.image ?? "").trim();
    return !title || !description || !image;
  }

  async function fetchYtDlpMetadata(url) {
    const key = String(url ?? "").trim();
    if (!key || !ytdlpEnabled || !isYtDlpCandidateUrl(key)) return null;
    const now = Date.now();
    const cached = ytdlpCache.get(key);
    if (cached && now - cached.at < ytdlpCacheTtlMs) {
      return cached.value ?? null;
    }

    const metadata = await runYtDlpMetadataCommand(key);
    ytdlpCache.set(key, { at: now, value: metadata ?? null });
    if (ytdlpCache.size > 400) {
      const oldest = ytdlpCache.keys().next().value;
      if (oldest) ytdlpCache.delete(oldest);
    }
    return metadata;
  }

  async function runYtDlpMetadataCommand(url) {
    const args = [
      "--no-download",
      "--no-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--socket-timeout",
      "15",
      "--",
      url
    ];

    return new Promise((resolve) => {
      const child = spawn(ytDlpPath, args, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8"
        }
      });
      let stdout = "";
      let stderr = "";
      let finished = false;

      const done = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // noop
        }
        done(null);
      }, 9000);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk ?? "");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk ?? "");
      });
      child.on("error", () => done(null));
      child.on("close", () => {
        const json = parseYtDlpJsonLine(stdout);
        if (!json || typeof json !== "object") return done(null);
        const title = String(json.title ?? "").trim();
        const description = normalizeYtDlpDescription(json.description);
        const thumbnail = String(json.thumbnail ?? "").trim();
        const uploader = String(json.uploader ?? "").trim();
        const extractor = String(json.extractor_key ?? json.extractor ?? "").trim();
        if (!title && !description && !thumbnail) {
          return done(null);
        }
        const siteName = uploader || extractor || "Media";
        return done({ title, description, thumbnail, siteName, stderr: trimOutput(stderr, 500) });
      });
    });
  }

  function parseYtDlpJsonLine(rawText) {
    const lines = String(rawText ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const line = lines[idx];
      if (!line || line === "null") continue;
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    return null;
  }

  function normalizeYtDlpDescription(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > 400 ? `${text.slice(0, 397)}...` : text;
  }

  function buildYouTubeThumbnailCandidates(youtubeId) {
    const id = String(youtubeId ?? "").trim();
    if (!id) return [];
    return [
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${id}/default.jpg`,
      `https://i.ytimg.com/vi_webp/${id}/hqdefault.webp`
    ];
  }

  async function resolveFirstReachableImage(urls, controller) {
    const candidates = uniqueNonEmpty(urls);
    if (!candidates.length) return "";
    for (const candidate of candidates) {
      if (!isHttpUrl(candidate)) continue;
      try {
        const response = await fetch(candidate, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
          }
        });
        const contentType = String(response.headers.get("content-type") ?? "");
        if (response.ok && contentType.startsWith("image/")) {
          return candidate;
        }
      } catch {
        // try next thumbnail candidate
      }
    }
    return "";
  }

  function isLikelyYouTubeUnavailableTitle(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) return false;
    if (text === "- youtube" || text === "youtube") return true;
    return (
      text.includes("video unavailable") ||
      text.includes("watch this video on youtube") ||
      text.includes("недоступно") ||
      text.includes("удалено") ||
      text.includes("private video")
    );
  }

  function extractPreviewFromHead(url, head) {
    const title = extractTitle(head);
    const ogTitle = extractMeta(head, "og:title");
    const description = extractMeta(head, "description");
    const ogDescription = extractMeta(head, "og:description");
    const siteName = extractMeta(head, "og:site_name") || extractMeta(head, "twitter:site");
    const rawTitle = (ogTitle || title || "").trim();
    const rawDescription = (ogDescription || description || "").trim();
    const blockedVkTitle = isVkUrl(url) && isVkAntiBotTitle(rawTitle);
    const antiBotPage = isLikelyAntiBotPage(rawTitle, rawDescription, head);
    const titleCandidate = blockedVkTitle || antiBotPage ? "" : sanitizePreviewTitle(rawTitle, url);
    const descriptionCandidate = blockedVkTitle || antiBotPage ? "" : rawDescription;
    const image =
      extractMeta(head, "og:image:secure_url") ||
      extractMeta(head, "og:image") ||
      extractMeta(head, "og:image:url") ||
      extractMeta(head, "twitter:image") ||
      extractMeta(head, "twitter:image:src") ||
      extractLinkRel(head, "image_src");
    const imageUrl = image ? safeAbsoluteUrl(image, url) : "";
    const proxiedImage = toProxyImageUrl(imageUrl);
    const shouldUseScreenshotFallback =
      !antiBotPage &&
      !proxiedImage &&
      !titleCandidate &&
      !descriptionCandidate &&
      supportsScreenshotFallback(url);
    const fallbackImage =
      shouldUseScreenshotFallback
        ? toProxyImageUrl(buildScreenshotFallbackUrl(url))
        : "";

    return {
      url,
      title: titleCandidate,
      description: descriptionCandidate,
      image: proxiedImage || fallbackImage,
      siteName: siteName || (isVkUrl(url) ? "VK" : getHost(url)),
      __hasNativeImage: Boolean(proxiedImage)
    };
  }

  function hasUsefulPreview(preview) {
    if (!preview || typeof preview !== "object") return false;
    return Boolean(String(preview.title ?? "").trim() || String(preview.description ?? "").trim() || String(preview.image ?? "").trim());
  }

  function finalizePreviewPayload(url, preview) {
    const base = preview && typeof preview === "object" ? preview : {};
    const siteName = String(base.siteName ?? "").trim() || getHost(url);
    const title =
      sanitizePreviewTitle(String(base.title ?? "").trim(), url) ||
      deriveTitleFromUrl(url) ||
      siteName ||
      getHost(url);
    const description = String(base.description ?? "").trim();
    const image = String(base.image ?? "").trim();
    return {
      url,
      title,
      description,
      image,
      siteName
    };
  }

  function isUsefulOEmbedResponse(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.error) return false;
    const title = sanitizePreviewTitle(String(payload.title ?? "").trim(), "");
    const description = String(payload.description ?? payload.author_name ?? "").trim();
    const image = String(payload.thumbnail_url ?? payload.thumbnail ?? payload.image ?? "").trim();
    return Boolean(title || description || image);
  }

  function hasStrongPreview(preview) {
    if (!preview || typeof preview !== "object") return false;
    const hasText = Boolean(String(preview.title ?? "").trim() || String(preview.description ?? "").trim());
    const hasNativeImage = Boolean(preview.__hasNativeImage);
    return hasText || hasNativeImage;
  }

  function stripInternalPreviewFields(preview) {
    if (!preview || typeof preview !== "object") return preview;
    const { __hasNativeImage: _ignore, ...clean } = preview;
    return clean;
  }

  function deriveTitleFromUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl ?? ""));
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (!segments.length) return "";
      for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
        const candidate = normalizePathSegmentTitle(segments[idx]);
        if (!candidate) continue;
        if (isOpaqueUrlTitleToken(candidate)) continue;
        return candidate;
      }
      return "";
    } catch {
      return "";
    }
  }

  function sanitizePreviewTitle(value, rawUrl) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const lowered = text.toLowerCase();
    const host = getHost(rawUrl);
    if (host && (lowered === host || lowered === `www.${host}`)) return "";
    if (isOpaqueUrlTitleToken(text)) return "";
    return text;
  }

  function buildFallbackPreview(url) {
    const fallbackImage = supportsScreenshotFallback(url)
      ? toProxyImageUrl(buildScreenshotFallbackUrl(url))
      : "";
    return {
      url,
      title: deriveTitleFromUrl(url) || getHost(url),
      description: "",
      image: fallbackImage,
      siteName: getHost(url)
    };
  }

  function normalizePathSegmentTitle(value) {
    const decoded = decodeHtml(safeDecodeURIComponent(String(value ?? "")));
    const normalized = decoded
      .replace(/\.[a-z0-9]{2,6}$/i, "")
      .replace(/[+_]+/g, " ")
      .replace(/[-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized;
  }

  function isOpaqueUrlTitleToken(value) {
    const text = String(value ?? "").trim();
    if (!text) return true;
    const compact = text.replace(/\s+/g, "");
    if (!compact) return true;
    if (/^[0-9a-f]{10,}$/i.test(compact)) return true;
    if (/^[a-z]?\d{6,}$/i.test(compact)) return true;
    if (/^\d+$/.test(compact)) return true;
    if (compact.length >= 12 && /^[a-z0-9]+$/i.test(compact)) {
      const digits = (compact.match(/\d/g) ?? []).length;
      if (digits / compact.length >= 0.5) return true;
    }
    const lowered = text.toLowerCase();
    if (
      [
        "news",
        "article",
        "post",
        "story",
        "watch",
        "video",
        "a",
        "politics",
        "sport",
        "sports",
        "football",
        "stars",
        "world",
        "life",
        "business",
        "society",
        "newsfeed"
      ].includes(lowered)
    ) {
      return true;
    }
    return false;
  }

  function isLikelyAntiBotPage(title, description, head) {
    const text = `${String(title ?? "")}\n${String(description ?? "")}\n${String(head ?? "").slice(0, 10000)}`.toLowerCase();
    if (!text.trim()) return false;
    return ANTI_BOT_MARKERS.some((marker) => text.includes(marker));
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function decodeHtmlResponse(response) {
    return response.arrayBuffer().then((arrayBuffer) => {
      const buffer = Buffer.from(arrayBuffer);
      const contentType = String(response.headers.get("content-type") ?? "");
      const headerCharset = parseCharsetFromContentType(contentType);
      const asciiProbe = buffer.toString("latin1", 0, Math.min(buffer.length, 8192));
      const metaCharset = parseCharsetFromHtmlProbe(asciiProbe);
      const candidates = [headerCharset, metaCharset, "utf-8", "windows-1251", "koi8-r"];
      const tried = new Set();
      let best = "";
      let bestScore = -1;
      for (const candidateRaw of candidates) {
        const candidate = normalizeCharsetName(candidateRaw);
        if (!candidate || tried.has(candidate)) continue;
        tried.add(candidate);
        const decoded = decodeBufferWithCharset(buffer, candidate);
        if (!decoded) continue;
        const score = scoreDecodedHtml(decoded);
        if (score > bestScore) {
          best = decoded;
          bestScore = score;
        }
        if (score >= 1000) break;
      }
      if (best) return best;
      return buffer.toString("utf8");
    });
  }

  function parseCharsetFromContentType(contentType) {
    const match = String(contentType ?? "").match(/charset\s*=\s*["']?\s*([^;"'\s]+)/i);
    return match ? match[1].trim() : "";
  }

  function parseCharsetFromHtmlProbe(htmlProbe) {
    const metaCharset = htmlProbe.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'>\s]+)/i);
    if (metaCharset?.[1]) return metaCharset[1].trim();
    const metaContentType = htmlProbe.match(
      /<meta[^>]+http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset=([^"'>\s;]+)/i
    );
    return metaContentType?.[1] ? metaContentType[1].trim() : "";
  }

  function normalizeCharsetName(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) return "";
    if (value === "utf8") return "utf-8";
    if (value === "cp1251" || value === "windows1251") return "windows-1251";
    if (value === "win-1251") return "windows-1251";
    return value;
  }

  function decodeBufferWithCharset(buffer, charset) {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(buffer);
    } catch {
      if (charset === "utf-8") {
        return buffer.toString("utf8");
      }
      return "";
    }
  }

  function scoreDecodedHtml(text) {
    if (!text) return -1;
    const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
    const hasHtml = /<html|<meta|<title|<body/i.test(text) ? 1 : 0;
    const hasCyrillic = /[\u0400-\u04FF]/.test(text) ? 1 : 0;
    if (replacementCount === 0 && hasHtml) {
      return 1000 + hasCyrillic;
    }
    return hasHtml * 10 + hasCyrillic - replacementCount * 3;
  }

  function extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? decodeHtml(match[1].trim()) : "";
  }

  function extractMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const reversed = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
      "i"
    );
    const match = html.match(direct) || html.match(reversed);
    return match ? decodeHtml(match[1].trim()) : "";
  }

  function extractLinkRel(html, rel) {
    const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const direct = new RegExp(
      `<link[^>]+rel=["']${escaped}["'][^>]*href=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const reversed = new RegExp(
      `<link[^>]+href=["']([^"']+)["'][^>]*rel=["']${escaped}["'][^>]*>`,
      "i"
    );
    const match = html.match(direct) || html.match(reversed);
    return match ? decodeHtml(match[1].trim()) : "";
  }

  function getYouTubeId(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.hostname.includes("youtu.be")) {
        return url.pathname.replace("/", "");
      }
      if (url.hostname.includes("youtube.com")) {
        const v = url.searchParams.get("v");
        if (v) return v;
        const match = url.pathname.match(/\/embed\/([^/?#]+)/);
        if (match) return match[1];
      }
    } catch {
      return null;
    }
    return null;
  }

  function isDirectImageUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl ?? ""));
      const target = `${parsed.pathname}${parsed.search}`;
      return /\.(jpe?g|png|webp|gif|avif|bmp|svg)(?:$|[?#])/i.test(target);
    } catch {
      return false;
    }
  }

  function getTweetId(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "x.com" && host !== "twitter.com") return null;
      const match = url.pathname.match(/status\/(\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  function isVkUrl(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
      return host === "vk.com" || host.endsWith(".vk.com");
    } catch {
      return false;
    }
  }

  function isVkAntiBotTitle(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes("\u0432\u0430\u0448 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0443\u0441\u0442\u0430\u0440\u0435\u043b") ||
      text.includes("browser is outdated") ||
      text.includes("security check") ||
      text.includes("\u043f\u043e\u0434\u043e\u0437\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c")
    );
  }

  async function fetchXPreview(url, tweetId, controller) {
    const tweetDataRaw = await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}`, controller);
    const tweetData = isUsefulTweetData(tweetDataRaw) ? tweetDataRaw : null;
    if (tweetData) {
      const media = Array.isArray(tweetData.mediaDetails) ? tweetData.mediaDetails[0] : null;
      const imageUrl = media?.media_url_https || media?.media_url || "";
      const image = toProxyImageUrl(imageUrl);
      const author = tweetData.user?.name || "";
      return {
        url,
        title: tweetData.text ? truncateText(tweetData.text, 200) : "",
        description: "",
        image,
        siteName: author ? `X - ${author}` : "X"
      };
    }

    const oembed = await fetchJson(
      `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`,
      controller
    );
    if (oembed) {
      const textFromHtml = stripHtml(String(oembed.html ?? ""));
      const fallbackText = textFromHtml || String(oembed.title ?? "").trim();
      const author = String(oembed.author_name ?? "").trim();
      return {
        url,
        title: fallbackText ? truncateText(fallbackText, 200) : "",
        description: "",
        image: "",
        siteName: author ? `X - ${author}` : "X"
      };
    }

    return null;
  }

  function isUsefulTweetData(tweetData) {
    if (!tweetData || typeof tweetData !== "object") return false;
    const hasText = typeof tweetData.text === "string" && tweetData.text.trim().length > 0;
    const hasMedia = Array.isArray(tweetData.mediaDetails) && tweetData.mediaDetails.length > 0;
    const hasAuthor = typeof tweetData.user?.name === "string" && tweetData.user.name.trim().length > 0;
    return hasText || hasMedia || hasAuthor;
  }

  async function fetchVkBotPreview(url, controller) {
    const userAgents = [
      "TelegramBot (like TwitterBot)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
    ];

    for (const userAgent of userAgents) {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
            "user-agent": userAgent
          }
        });
        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) continue;

        const html = await decodeHtmlResponse(response);
        const head = html.slice(0, 200000);
        const ogTitle = extractMeta(head, "og:title");
        const title = (ogTitle || extractTitle(head) || "").trim();
        if (isVkAntiBotTitle(title)) continue;

        const description = (extractMeta(head, "og:description") || extractMeta(head, "description") || "").trim();

        const imageRaw =
          extractMeta(head, "og:image:secure_url") ||
          extractMeta(head, "og:image") ||
          extractMeta(head, "og:image:url") ||
          extractMeta(head, "twitter:image") ||
          extractMeta(head, "twitter:image:src") ||
          extractLinkRel(head, "image_src");

        const imageUrl = imageRaw ? safeAbsoluteUrl(imageRaw, url) : "";
        const image = toProxyImageUrl(imageUrl);

        if (!title && !description && !image) continue;

        const siteName = extractMeta(head, "og:site_name") || "VK";
        return {
          url,
          title,
          description,
          image,
          siteName
        };
      } catch {
        // try next user-agent
      }
    }

    return null;
  }

  async function fetchVkOembedPreview(url, controller) {
    const oembed = await fetchJson(`https://vk.com/oembed.php?url=${encodeURIComponent(url)}`, controller);
    if (!oembed || oembed.error) return null;
    const image = toProxyImageUrl(String(oembed.thumbnail_url ?? "").trim());
    const title = String(oembed.title ?? "").trim();
    const author = String(oembed.author_name ?? "").trim();
    return {
      url,
      title,
      description: author,
      image,
      siteName: String(oembed.provider_name ?? "VK").trim() || "VK"
    };
  }

  function stripHtml(value) {
    return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  async function fetchJson(url, controller) {
    let response;
    try {
      response = await fetch(url, {
        signal: controller?.signal,
        redirect: "follow",
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        }
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    try {
      return await response.json();
    } catch {
      try {
        const rawText = await response.text();
        if (!rawText.trim()) return null;
        return JSON.parse(rawText);
      } catch {
        return null;
      }
    }
  }

  function truncateText(text, limit) {
    const value = String(text ?? "").trim();
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1)}...`;
  }

  function decodeHtml(value) {
    const text = String(value ?? "");
    const namedEntities = {
      amp: "&",
      quot: "\"",
      apos: "'",
      nbsp: " ",
      lt: "<",
      gt: ">",
      hellip: "...",
      ndash: "-",
      mdash: "-",
      laquo: "В«",
      raquo: "В»"
    };
    return text
      .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
      })
      .replace(/&#(\d+);?/g, (_match, dec) => {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
      })
      .replace(/&([a-z][a-z0-9]+);/gi, (match, name) => namedEntities[String(name).toLowerCase()] ?? match);
  }

  function uniqueNonEmpty(values) {
    const result = [];
    const seen = new Set();
    for (const value of values ?? []) {
      const normalized = String(value ?? "").trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }

  function trimOutput(value, maxLength = 500) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.slice(-maxLength);
  }

  function safeAbsoluteUrl(raw, base) {
    try {
      return new URL(raw, base).toString();
    } catch {
      return "";
    }
  }

  return {
    fetchLinkPreview
  };
}
