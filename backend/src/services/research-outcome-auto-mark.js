function compactText(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

export function extractDomainFromUrl(input) {
  try {
    const parsed = new URL(String(input ?? "").trim());
    return String(parsed.hostname ?? "").trim().replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isAgeGateError(detail = "") {
  return (
    detail.includes("confirm your age") ||
    detail.includes("sign in to confirm your age") ||
    detail.includes("age-gate") ||
    detail.includes("age restricted") ||
    detail.includes("age-restricted") ||
    detail.includes("inappropriate for some users")
  );
}

function isPaywallError(detail = "") {
  return (
    detail.includes("paywall") ||
    detail.includes("subscriber-only") ||
    detail.includes("subscription required") ||
    detail.includes("subscribe to continue") ||
    detail.includes("members only") ||
    detail.includes("premium article") ||
    detail.includes("read more to continue")
  );
}

function isAntiBotError(detail = "") {
  return (
    detail.includes("anti-bot") ||
    detail.includes("captcha") ||
    detail.includes("cloudflare") ||
    detail.includes("not a bot") ||
    detail.includes("confirm you're not a bot") ||
    detail.includes("access denied") ||
    detail.includes("forbidden") ||
    detail.includes("robot check")
  );
}

export function detectResearchOutcomeAction({
  url = "",
  errorDetail = "",
  operatorNotice = null,
  source = "download"
} = {}) {
  const detail = compactText(errorDetail).toLowerCase();
  const operatorCode =
    typeof operatorNotice === "string"
      ? compactText(operatorNotice).toLowerCase()
      : compactText(operatorNotice?.code).toLowerCase();

  if (isAgeGateError(detail)) return "age_gate";
  if (isPaywallError(detail)) return "paywall";
  if (isAntiBotError(detail)) return "anti_bot";
  if (operatorCode === "youtube_cookies_refresh_required") return "anti_bot";
  if (operatorCode === "youtube_stream_stalled_after_metadata") {
    return source === "screenshot" ? "screenshot_failed" : "download_failed";
  }
  if (operatorCode === "youtube_auth_refresh_required") {
    if (isAgeGateError(detail)) return "age_gate";
    return source === "screenshot" ? "screenshot_failed" : "download_failed";
  }
  return source === "screenshot" ? "screenshot_failed" : "download_failed";
}
