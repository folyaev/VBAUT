export function isYouTubeLikeUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname ?? "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be");
  } catch {
    return false;
  }
}

export function detectDownloaderOperatorNotice({
  url,
  errorDetail = "",
  cookiesTargetPath = "",
  cookiesSourceLabel = ""
} = {}) {
  if (!isYouTubeLikeUrl(url)) return null;
  const detail = String(errorDetail ?? "").toLowerCase();
  const isAntiBot =
    detail.includes("sign in to confirm you're not a bot") ||
    detail.includes("confirm you're not a bot") ||
    detail.includes("if you are not a bot");
  const isAgeGate =
    detail.includes("sign in to confirm your age") ||
    detail.includes("confirm your age") ||
    detail.includes("may be inappropriate for some users");
  const isStreamStall =
    detail.includes("stalled after metadata with no download progress") ||
    detail.includes("youtube stream stalled after metadata");
  if (!isAntiBot && !isAgeGate && !isStreamStall) return null;

  const sourceLabel = String(cookiesSourceLabel ?? "").trim() || "LINK_SCREENSHOT_COOKIES_PATH";
  const targetPath = String(cookiesTargetPath ?? "").trim() || null;

  if (isStreamStall) {
    return {
      code: "youtube_stream_stalled_after_metadata",
      title: "\u041F\u043E\u0442\u043E\u043A YouTube \u0437\u0430\u0432\u0438\u0441 \u043F\u043E\u0441\u043B\u0435 metadata",
      hint:
        "Metadata \u0443\u0436\u0435 \u0441\u0447\u0438\u0442\u0430\u043B\u0430\u0441\u044C, \u043D\u043E \u0441\u0430\u043C \u043C\u0435\u0434\u0438\u0430-\u043F\u043E\u0442\u043E\u043A \u043D\u0435 \u0441\u0442\u0430\u0440\u0442\u043E\u0432\u0430\u043B. \u042D\u0442\u043E \u043D\u0435 \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0440\u043E login: \u0447\u0430\u0449\u0435 \u044D\u0442\u043E \u0441\u0431\u043E\u0439 \u0432 player client/CDN \u043F\u043E\u0441\u043B\u0435 \u0447\u0442\u0435\u043D\u0438\u044F cookies. \u0410\u0432\u0442\u043E\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 cookies \u0443\u0436\u0435 \u0431\u044B\u043B\u043E \u043F\u0440\u043E\u0431\u043E\u0432\u0430\u043D\u043E; \u0435\u0441\u043B\u0438 \u0440\u043E\u043B\u0438\u043A \u0441\u043D\u043E\u0432\u0430 \u0437\u0430\u0432\u0438\u0441\u0430\u0435\u0442, \u043D\u0443\u0436\u0435\u043D \u0434\u0440\u0443\u0433\u043E\u0439 extractor/client path, \u0430 \u043D\u0435 \u043F\u0440\u043E\u0441\u0442\u043E \u043D\u043E\u0432\u044B\u0435 cookies.",
      domains: ["youtube.com", "google.com", "youtu.be"],
      target_path: targetPath,
      cookies_source_label: sourceLabel
    };
  }

  if (isAgeGate) {
    return {
      code: "youtube_auth_refresh_required",
      title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044E YouTube",
      hint:
        "YouTube \u0443\u043F\u0435\u0440\u0441\u044F \u0432 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u044E \u0438\u043B\u0438 age-gate. \u0415\u0441\u043B\u0438 persistent screenshot browser \u0443\u0436\u0435 \u0437\u0430\u043B\u043E\u0433\u0438\u043D\u0435\u043D, \u043E\u0431\u044B\u0447\u043D\u043E \u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0437\u0430\u043D\u043E\u0432\u043E \u0432\u044B\u0433\u0440\u0443\u0437\u0438\u0442\u044C cookies \u0438\u0437 \u044D\u0442\u043E\u0433\u043E \u043F\u0440\u043E\u0444\u0438\u043B\u044F; \u0432\u0440\u0443\u0447\u043D\u0443\u044E \u0432\u043C\u0435\u0448\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u043D\u0443\u0436\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 YouTube \u0441\u043D\u043E\u0432\u0430 \u043F\u043E\u043A\u0430\u0436\u0435\u0442 login \u0438\u043B\u0438 consent.",
      domains: ["youtube.com", "google.com", "youtu.be"],
      target_path: targetPath,
      cookies_source_label: sourceLabel
    };
  }

  return {
    code: "youtube_cookies_refresh_required",
    title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C cookies YouTube",
    hint:
      "YouTube \u0443\u043F\u0435\u0440\u0441\u044F \u0432 anti-bot. \u0415\u0441\u043B\u0438 persistent screenshot browser \u0443\u0436\u0435 \u0437\u0430\u043B\u043E\u0433\u0438\u043D\u0435\u043D, \u043E\u0431\u044B\u0447\u043D\u043E \u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0437\u0430\u043D\u043E\u0432\u043E \u0432\u044B\u0433\u0440\u0443\u0437\u0438\u0442\u044C cookies \u0438\u0437 \u044D\u0442\u043E\u0433\u043E \u043F\u0440\u043E\u0444\u0438\u043B\u044F; \u0432\u0440\u0443\u0447\u043D\u0443\u044E \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0442\u044C cookies \u043D\u0443\u0436\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 YouTube \u0441\u043D\u043E\u0432\u0430 \u043F\u043E\u043A\u0430\u0436\u0435\u0442 consent \u0438\u043B\u0438 login.",
    domains: ["youtube.com", "google.com", "youtu.be"],
    target_path: targetPath,
    cookies_source_label: sourceLabel
  };
}
