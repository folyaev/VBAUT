import { isHttpUrl } from "./links.js";

export function createLinkPreviewUtils() {
  function toProxyImageUrl(rawUrl) {
    const value = String(rawUrl ?? "").trim();
    if (!value) return "";
    if (value.startsWith("/api/link/image")) return value;
    if (value.startsWith("data:")) return value;
    if (!isHttpUrl(value)) return "";
    return `/api/link/image?url=${encodeURIComponent(value)}`;
  }

  async function fetchLinkPreview(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const youtubeId = getYouTubeId(url);
      if (youtubeId) {
        const oembed = await fetchJson(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
          controller
        );
        const thumbnail = oembed?.thumbnail_url || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
        const image = toProxyImageUrl(thumbnail);
        return {
          url,
          title: oembed?.title ?? "",
          description: "",
          image,
          siteName: "YouTube"
        };
      }

      const tweetId = getTweetId(url);
      if (tweetId) {
        const xPreview = await fetchXPreview(url, tweetId, controller);
        if (xPreview) return xPreview;
      }

      if (isVkUrl(url)) {
        const vkBotPreview = await fetchVkBotPreview(url, controller);
        if (vkBotPreview) return vkBotPreview;
        const vkPreview = await fetchVkOembedPreview(url, controller);
        if (vkPreview) return vkPreview;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        }
      });
      if (!response.ok) {
        return { url, title: "", description: "", image: "", siteName: "" };
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return { url, title: "", description: "", image: "", siteName: "" };
      }
      const html = await decodeHtmlResponse(response);
      const head = html.slice(0, 200000);
      const title = extractTitle(head);
      const ogTitle = extractMeta(head, "og:title");
      const description = extractMeta(head, "description");
      const ogDescription = extractMeta(head, "og:description");
      const siteName = extractMeta(head, "og:site_name") || extractMeta(head, "twitter:site");
      const resolvedTitle = (ogTitle || title || "").trim();
      const blockedVkTitle = isVkUrl(url) && isVkAntiBotTitle(resolvedTitle);
      const image =
        extractMeta(head, "og:image:secure_url") ||
        extractMeta(head, "og:image") ||
        extractMeta(head, "og:image:url") ||
        extractMeta(head, "twitter:image") ||
        extractMeta(head, "twitter:image:src") ||
        extractLinkRel(head, "image_src");
      const imageUrl = image ? safeAbsoluteUrl(image, url) : "";
      const proxiedImage = toProxyImageUrl(imageUrl);

      return {
        url,
        title: blockedVkTitle ? "" : resolvedTitle,
        description: blockedVkTitle ? "" : (ogDescription || description || ""),
        image: proxiedImage,
        siteName: siteName || (isVkUrl(url) ? "VK" : "")
      };
    } catch {
      return { url, title: "", description: "", image: "", siteName: "" };
    } finally {
      clearTimeout(timeout);
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
    const response = await fetch(url, {
      signal: controller?.signal,
      redirect: "follow",
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      }
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  function truncateText(text, limit) {
    const value = String(text ?? "").trim();
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1)}...`;
  }

  function decodeHtml(value) {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
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
