import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCookiesFromPath, normalizeCookiesForPuppeteer } from "../../../screenshot-engine/cookie-utils.js";
import { detectResearchOutcomeAction, extractDomainFromUrl } from "../services/research-outcome-auto-mark.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINK_SCREENSHOT_SCRIPT_PATH = path.resolve(__dirname, "../../../screenshot-engine/link-screenshot.js");
const LINK_SCREENSHOT_PROFILES_PATH = path.resolve(
  __dirname,
  "../../../screenshot-engine/config/link-screenshot-profiles.json"
);
const DEFAULT_LINK_SCREENSHOT_COOKIES_PATH = path.resolve(__dirname, "../../../data/cookies/global-cookies.json");
const LINK_SCREENSHOT_ACCEPT_LANGUAGE = "ru-RU,ru;q=0.9,en;q=0.8";
const BACKEND_ENV_PATH = path.resolve(__dirname, "../../.env");
const SCREENSHOT_LAB_HTML_PATH = path.resolve(__dirname, "../../public/screenshot-lab.html");
const SCREENSHOT_LAB_LOG_FILE_NAME = "screenshot-lab-events.ndjson";
const LINK_SCREENSHOT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LINK_SCREENSHOT_CACHE_MAX = 80;
const SCREENSHOT_PERSISTENT_CAPTURE_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.SCREENSHOT_PERSISTENT_CAPTURE_ENABLED ?? "1").trim().toLowerCase()
);
const SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS = parseDomainList(
  process.env.SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS ?? "*"
);
const SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS = clampNumber(
  process.env.SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS,
  1400,
  0,
  12000
);
const SCREENSHOT_LAB_MANUAL_READY_WAIT_MS = clampNumber(
  process.env.SCREENSHOT_LAB_MANUAL_READY_WAIT_MS,
  1800,
  0,
  15000
);
const SCREENSHOT_LAB_MANUAL_CAPTURE_WAIT_MS = clampNumber(
  process.env.SCREENSHOT_LAB_MANUAL_CAPTURE_WAIT_MS,
  1800,
  0,
  15000
);
const SCREENSHOT_LAB_MANUAL_FORCE_HEADED = !["0", "false", "off", "no"].includes(
  String(process.env.SCREENSHOT_LAB_MANUAL_FORCE_HEADED ?? "1").trim().toLowerCase()
);
const SCREENSHOT_LAB_MANUAL_ALLOW_EPHEMERAL_FALLBACK = !["0", "false", "off", "no"].includes(
  String(process.env.SCREENSHOT_LAB_MANUAL_ALLOW_EPHEMERAL_FALLBACK ?? "0").trim().toLowerCase()
);
let linkScreenshotCookiesPath = String(process.env.LINK_SCREENSHOT_COOKIES_PATH ?? "").trim() || DEFAULT_LINK_SCREENSHOT_COOKIES_PATH;
const MANUAL_LAB_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MANUAL_LAB_MAX_EVENTS = 600;
const linkScreenshotCache = new Map();
const manualLabSessions = new Map();
let linkScreenshotProfilesMemo = null;
let linkScreenshotProfilesLoadedAt = 0;
let manualLabPuppeteerMemo = null;
let screenshotBrowserServiceRef = null;

function createScreenshotFileName() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `shot_${stamp}_${suffix}.png`;
}

function normalizeRelativeFilePath(filePath) {
  return String(filePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readOptionalClampedNumber(value, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

function clipString(value, maxLen = 600) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function sanitizeScreenshotLabEvent(rawEvent = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return null;
  const type = clipString(rawEvent.type ?? "", 80);
  if (!type) return null;
  const url = clipString(rawEvent.url ?? "", 1400);
  return {
    type,
    url: url || null,
    mode: clipString(rawEvent.mode ?? "", 32) || null,
    status: clipString(rawEvent.status ?? "", 32) || null,
    message: clipString(rawEvent.message ?? "", 1200) || null,
    detail: clipString(rawEvent.detail ?? "", 2000) || null,
    session_id: clipString(rawEvent.session_id ?? "", 120) || null,
    timestamp_client: clipString(rawEvent.timestamp_client ?? "", 64) || null
  };
}

async function appendScreenshotLabAuditEvents(dataDir, events, meta = {}) {
  if (!dataDir || !Array.isArray(events) || events.length === 0) return 0;
  await fs.mkdir(dataDir, { recursive: true });
  const logPath = path.resolve(dataDir, SCREENSHOT_LAB_LOG_FILE_NAME);
  const now = new Date().toISOString();
  const lines = events
    .map((event) => sanitizeScreenshotLabEvent(event))
    .filter(Boolean)
    .map((event) =>
      JSON.stringify({
        ts: now,
        source: "screenshot_lab",
        event,
        meta: {
          ip: clipString(meta.ip ?? "", 120) || null,
          user_agent: clipString(meta.userAgent ?? "", 400) || null,
          referer: clipString(meta.referer ?? "", 600) || null
        }
      })
    );
  if (!lines.length) return 0;
  await fs.appendFile(logPath, `${lines.join("\n")}\n`, "utf8");
  return lines.length;
}

async function readScreenshotLabAuditEvents(dataDir, limit = 200) {
  if (!dataDir) return [];
  const safeLimit = clampNumber(limit, 200, 1, 2000);
  const logPath = path.resolve(dataDir, SCREENSHOT_LAB_LOG_FILE_NAME);
  let text = "";
  try {
    text = await fs.readFile(logPath, "utf8");
  } catch {
    return [];
  }
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sliced = lines.slice(-safeLimit);
  return sliced
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeHost(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^www\./i, "");
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseDomainList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeHost(item))
      .filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\s,;]+/)
    .map((item) => normalizeHost(item))
    .filter(Boolean);
}

function cookieDomainMatchesList(cookieDomain, domains = []) {
  const host = normalizeHost(cookieDomain).replace(/^\./, "");
  if (!host) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function getScreenshotCookiesPath() {
  return String(linkScreenshotCookiesPath ?? "").trim() || DEFAULT_LINK_SCREENSHOT_COOKIES_PATH;
}

function setScreenshotCookiesPath(nextPath) {
  const value = String(nextPath ?? "").trim() || DEFAULT_LINK_SCREENSHOT_COOKIES_PATH;
  linkScreenshotCookiesPath = value;
  if (value) {
    process.env.LINK_SCREENSHOT_COOKIES_PATH = value;
  } else {
    delete process.env.LINK_SCREENSHOT_COOKIES_PATH;
  }
  return linkScreenshotCookiesPath;
}

async function pathIsFile(filePath) {
  const resolved = String(filePath ?? "").trim();
  if (!resolved) return false;
  try {
    const stat = await fs.stat(path.resolve(resolved));
    return Boolean(stat?.isFile?.());
  } catch {
    return false;
  }
}

function formatEnvValue(value) {
  const raw = String(value ?? "");
  if (/^[A-Za-z0-9_./:\\-]+$/.test(raw)) return raw;
  const escaped = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function persistEnvVar(filePath, key, value) {
  const envPath = path.resolve(String(filePath ?? "").trim());
  if (!envPath || !key) return;
  let text = "";
  try {
    text = await fs.readFile(envPath, "utf8");
  } catch {
    text = "";
  }
  const lines = String(text ?? "").split(/\r?\n/);
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const nextLines = [];
  let replaced = false;

  for (const line of lines) {
    if (!matcher.test(line)) {
      nextLines.push(line);
      continue;
    }
    if (value == null || String(value).trim() === "") {
      replaced = true;
      continue;
    }
    nextLines.push(`${key}=${formatEnvValue(value)}`);
    replaced = true;
  }

  if (!replaced && value != null && String(value).trim() !== "") {
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  const normalized = nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  const finalText = normalized ? `${normalized}\n` : "";
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, finalText, "utf8");
}

function getHostFromUrl(rawUrl) {
  try {
    return normalizeHost(new URL(String(rawUrl ?? "")).hostname);
  } catch {
    return "";
  }
}

function isPrivateOrLocalHost(host) {
  const value = normalizeHost(host);
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

async function loadLinkScreenshotProfiles() {
  const now = Date.now();
  if (linkScreenshotProfilesMemo && now - linkScreenshotProfilesLoadedAt < 30000) {
    return linkScreenshotProfilesMemo;
  }
  try {
    const raw = await fs.readFile(LINK_SCREENSHOT_PROFILES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    linkScreenshotProfilesMemo = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    linkScreenshotProfilesMemo = {};
  }
  linkScreenshotProfilesLoadedAt = now;
  return linkScreenshotProfilesMemo;
}

function parseZoomFromKey(key) {
  const match = String(key ?? "").toLowerCase().match(/^zoom_(\d{2,4})$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) return null;
  return Math.max(50, Math.min(800, value));
}

function resolveLinkScreenshotProfile(rawUrl, profiles) {
  const host = getHostFromUrl(rawUrl);
  const defaultsRaw = profiles?.defaults ?? {};
  const profile = {
    width: clampNumber(defaultsRaw.width, 2560, 320, 3840),
    height: clampNumber(defaultsRaw.height, 1280, 240, 2160),
    zoom: clampNumber(defaultsRaw.zoom, 400, 50, 800)
  };
  if (!host || !profiles || typeof profiles !== "object") return profile;

  for (const [groupKey, groupValue] of Object.entries(profiles)) {
    if (groupKey === "defaults" || !groupValue || typeof groupValue !== "object") continue;
    for (const [zoomKey, sourceList] of Object.entries(groupValue)) {
      const zoom = parseZoomFromKey(zoomKey);
      if (!zoom || !Array.isArray(sourceList) || sourceList.length === 0) continue;
      const matched = sourceList.some((source) => {
        const sourceHost = getHostFromUrl(source);
        if (!sourceHost) return false;
        return host === sourceHost || host.endsWith(`.${sourceHost}`);
      });
      if (matched) {
        profile.zoom = zoom;
        return profile;
      }
    }
  }

  return profile;
}

async function assessScreenshotPageState(page) {
  if (!page) return { isAntiBot: false, textLen: 0, title: "" };
  try {
    return await page.evaluate(() => {
      const text = String(document.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const title = String(document.title || "").toLowerCase();
      const combined = `${title} ${text.slice(0, 2500)}`;
      const antiBotMarkers = [
        "checking your browser",
        "verify you are human",
        "just a moment",
        "forbidden",
        "if you are not a bot",
        "captcha",
        "cloudflare",
        "проверка браузера",
        "не удалось проверить ваш браузер автоматически",
        "пройдите ручную проверку",
        "защита от ботов",
        "доступ ограничен"
      ];
      return {
        isAntiBot: antiBotMarkers.some((marker) => combined.includes(marker)),
        textLen: text.length,
        title
      };
    });
  } catch {
    return { isAntiBot: false, textLen: 0, title: "" };
  }
}

async function captureLinkScreenshotBuffer({ url, width, height, zoom, cookiesPath = "" }) {
  const scriptExists = await fs.stat(LINK_SCREENSHOT_SCRIPT_PATH).catch(() => null);
  if (!scriptExists) {
    throw new Error("screenshot script not found");
  }

  return new Promise((resolve, reject) => {
    const args = [
      LINK_SCREENSHOT_SCRIPT_PATH,
      "--url",
      url,
      "--width",
      String(width),
      "--height",
      String(height),
      "--zoom",
      String(zoom),
      "--timeout_ms",
      "22000"
    ];
    if (cookiesPath) {
      args.push("--cookies_path", String(cookiesPath));
    }
    const child = spawn(process.execPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8"
      }
    });

    const stdoutChunks = [];
    let stderrText = "";
    let finished = false;
    const done = (error, buffer = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(buffer);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // noop
      }
      done(new Error("screenshot timeout"));
    }, 30000);

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderrText += String(chunk ?? "");
    });
    child.on("error", (error) => {
      done(new Error(error?.message || "screenshot process failed"));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = String(stderrText).trim().slice(-300);
        done(new Error(tail || `screenshot exited with code ${code}`));
        return;
      }
      const buffer = Buffer.concat(stdoutChunks);
      if (!buffer.length) {
        done(new Error("empty screenshot result"));
        return;
      }
      done(null, buffer);
    });
  });
}

function shouldUsePersistentBrowserCapture(rawUrl) {
  if (!SCREENSHOT_PERSISTENT_CAPTURE_ENABLED) return false;
  const host = getHostFromUrl(rawUrl);
  if (!host) return false;
  if (!SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS.length) return false;
  if (
    SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS.includes("*") ||
    SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS.includes("all")
  ) {
    return true;
  }
  return SCREENSHOT_PERSISTENT_CAPTURE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

async function captureLinkScreenshotViaPersistentBrowser({ url, width, height, zoom, resetBrowserZoom = false }) {
  if (!screenshotBrowserServiceRef?.enabled || !screenshotBrowserServiceRef?.openPage) {
    throw new Error("persistent browser is unavailable");
  }
  const opened = await screenshotBrowserServiceRef.openPage({
    url,
    width,
    height,
    zoom,
    acceptLanguage: LINK_SCREENSHOT_ACCEPT_LANGUAGE,
    emulateViewport: true,
    resetBrowserZoom
  });
  const page = opened?.page;
  if (!page) throw new Error("persistent page not created");
  try {
    if (SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS > 0) {
      await waitMs(SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS);
    }
    let pageState = await assessScreenshotPageState(page);
    if (pageState?.isAntiBot) {
      await waitMs(2500);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      if (SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS > 0) {
        await waitMs(SCREENSHOT_PERSISTENT_CAPTURE_WAIT_MS);
      }
      pageState = await assessScreenshotPageState(page);
      if (pageState?.isAntiBot) {
        throw new Error("anti-bot-page");
      }
    }
    await hideScrollbarsForCapture(page);
    const buffer = await page.screenshot({
      type: "png",
      fullPage: false,
      captureBeyondViewport: false
    });
    if (!buffer || !buffer.length) {
      throw new Error("empty screenshot result");
    }
    return buffer;
  } finally {
    try {
      await screenshotBrowserServiceRef.closePage(page);
    } catch {
      // noop
    }
  }
}

function getCachedLinkScreenshot(cacheKey) {
  const item = linkScreenshotCache.get(cacheKey);
  if (!item) return null;
  if (Date.now() - item.at > LINK_SCREENSHOT_CACHE_TTL_MS) {
    linkScreenshotCache.delete(cacheKey);
    return null;
  }
  return item.buffer;
}

function putCachedLinkScreenshot(cacheKey, buffer) {
  linkScreenshotCache.set(cacheKey, { at: Date.now(), buffer });
  if (linkScreenshotCache.size <= LINK_SCREENSHOT_CACHE_MAX) return;
  const overflow = linkScreenshotCache.size - LINK_SCREENSHOT_CACHE_MAX;
  let removed = 0;
  for (const key of linkScreenshotCache.keys()) {
    linkScreenshotCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function buildThumIoScreenshotUrl(url, profile) {
  const width = clampNumber(profile?.width, 2560, 320, 3840);
  const height = clampNumber(profile?.height, 1280, 240, 5120);
  return `https://image.thum.io/get/width/${width}/crop/${height}/noanimate/${encodeURI(url)}`;
}

function isHostInDomain(host, domain) {
  const value = normalizeHost(host);
  const target = normalizeHost(domain);
  if (!value || !target) return false;
  return value === target || value.endsWith(`.${target}`);
}

async function fetchRemoteImageBuffer(url, maxBytes, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      }
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") ?? "");
    if (!contentType.startsWith("image/")) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > maxBytes) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return null;
    return { buffer, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function createManualSessionId() {
  return `manual_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeManualDomEvent(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = clipString(raw.type ?? "", 60);
  if (!type) return null;
  return {
    type,
    selector: clipString(raw.selector ?? "", 260) || null,
    text: clipString(raw.text ?? "", 220) || null,
    href: clipString(raw.href ?? "", 1200) || null,
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : null,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : null,
    key: clipString(raw.key ?? "", 64) || null
  };
}

function pushManualSessionEvent(session, type, payload = {}) {
  if (!session || !type) return;
  const event = {
    ts: new Date().toISOString(),
    type: clipString(type, 80),
    ...payload
  };
  session.events.push(event);
  if (session.events.length > MANUAL_LAB_MAX_EVENTS) {
    session.events.splice(0, session.events.length - MANUAL_LAB_MAX_EVENTS);
  }
  session.updatedAt = Date.now();
}

async function closeManualSession(sessionId, reason = "stopped") {
  const session = manualLabSessions.get(sessionId);
  if (!session) return;
  manualLabSessions.delete(sessionId);
  pushManualSessionEvent(session, "session_closed", { reason: clipString(reason, 120) || "stopped" });
  const shouldRestorePersistentHeadless = Boolean(session?.restorePersistentHeadless);
  try {
    if (session?.persistent && screenshotBrowserServiceRef?.closePage) {
      await screenshotBrowserServiceRef.closePage(session.page);
    } else {
      await session.browser?.close();
    }
  } catch {
    // noop
  } finally {
    if (shouldRestorePersistentHeadless && screenshotBrowserServiceRef?.restart) {
      try {
        await screenshotBrowserServiceRef.restart({ headless: true });
      } catch {
        // noop
      }
    }
  }
}

async function closeAllManualSessions(reason = "replaced") {
  const ids = [...manualLabSessions.keys()];
  for (const sessionId of ids) {
    await closeManualSession(sessionId, reason);
  }
}

function pruneManualSessions() {
  const now = Date.now();
  for (const [sessionId, session] of manualLabSessions.entries()) {
    if (now - Number(session?.updatedAt ?? 0) > MANUAL_LAB_SESSION_TTL_MS) {
      closeManualSession(sessionId, "ttl_expired").catch(() => null);
    }
  }
}

async function loadManualPuppeteer() {
  if (manualLabPuppeteerMemo) return manualLabPuppeteerMemo;
  try {
    const mod = await import("puppeteer");
    manualLabPuppeteerMemo = mod?.default ?? mod;
  } catch {
    const mod = await import("../../../HeadlessNotion/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js");
    manualLabPuppeteerMemo = mod?.default ?? mod;
  }
  return manualLabPuppeteerMemo;
}

async function applyManualPageScale(session) {
  void session;
  // Keep native browser zoom behavior in manual mode.
  // We intentionally do not force CSS zoom here.
}

async function loadCookiesForUrl(cookiesPath, targetUrl) {
  const pathValue = String(cookiesPath ?? "").trim();
  if (!pathValue) return [];
  try {
    const cookiesLoaded = await loadCookiesFromPath(pathValue);
    return normalizeCookiesForPuppeteer(cookiesLoaded, targetUrl);
  } catch {
    return [];
  }
}

function buildManualRecorderScript() {
  return `
    (() => {
      const cleanText = (value, maxLen = 140) =>
        String(value || "").replace(/\\s+/g, " ").trim().slice(0, maxLen);
      const selectorOf = (element) => {
        if (!element || !element.tagName) return "";
        const parts = [];
        let node = element;
        for (let i = 0; i < 4 && node && node.tagName; i += 1) {
          let part = String(node.tagName || "").toLowerCase();
          if (!part) break;
          if (node.id) {
            part += "#" + String(node.id).slice(0, 40);
            parts.unshift(part);
            break;
          }
          const className = String(node.className || "")
            .split(/\\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .join(".");
          if (className) part += "." + className;
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(" > ").slice(0, 240);
      };
      const push = (payload) => {
        try {
          if (typeof window.__screenshotLabRecordEvent === "function") {
            window.__screenshotLabRecordEvent(payload);
          }
        } catch {
          // noop
        }
      };
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (!target || !target.tagName) return;
          push({
            type: "click",
            selector: selectorOf(target),
            text: cleanText(target.innerText || target.textContent || "", 120),
            href: target.href || target.closest?.("a")?.href || "",
            x: Number(event.clientX || 0),
            y: Number(event.clientY || 0)
          });
        },
        true
      );
      document.addEventListener(
        "keydown",
        (event) => {
          const key = cleanText(event.key || "", 32);
          if (!key) return;
          if (!["Enter", "Tab", "Escape"].includes(key)) return;
          const target = event.target;
          push({
            type: "keydown",
            key,
            selector: selectorOf(target),
            text: cleanText(target?.value || target?.innerText || "", 120)
          });
        },
        true
      );
    })();
  `;
}

async function hideScrollbarsForCapture(page) {
  if (!page) return;
  try {
    await page.evaluate(() => {
      const styleId = "__vbaut_hide_scrollbars__";
      const css = `
        html, body, * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        *::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
          background: transparent !important;
        }
      `;
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        document.documentElement.appendChild(style);
      }
      style.textContent = css;

      document.documentElement.style.setProperty("overflow-x", "hidden", "important");
      document.documentElement.style.setProperty("overflow-y", "scroll", "important");
      if (document.body) {
        document.body.style.setProperty("overflow-x", "hidden", "important");
        document.body.style.setProperty("overflow-y", "scroll", "important");
      }

      const active = document.activeElement;
      if (active && typeof active.blur === "function") {
        try {
          active.blur();
        } catch {
          // noop
        }
      }
    });
  } catch {
    // noop
  }
}

async function waitForPageToSettle(page, extraWaitMs = 0) {
  if (!page) return;
  try {
    if (typeof page.waitForNetworkIdle === "function") {
      await page.waitForNetworkIdle({ idleTime: 900, timeout: 5000 }).catch(() => null);
    }
  } catch {
    // noop
  }
  if (extraWaitMs > 0) {
    await waitMs(extraWaitMs);
  }
}

export function registerMiscRoutes(app, deps) {
  const {
    appendUiActionsAudit,
    attachAsset,
    config,
    createAsset,
    dataDir,
    fetchLinkPreview,
    finishNotionProgress,
    getNotionProgress,
    getRuntimeHealth,
    imageProxyMaxBytes,
    initNotionProgress,
    isHttpUrl,
    isNotionUrl,
    normalizeLinkUrl,
    normalizeNotionUrl,
    pruneNotionProgressStore,
    pushNotionProgress,
    markResearchApplied,
    recordSourceUsage,
    releaseOutcomeMemoryStore,
    sourceMemoryStore,
    sourceProfilesStore,
    screenshotBrowserService,
    scrapeNotionPage,
    translateHeadingToEnglishQuery
  } = deps;
  screenshotBrowserServiceRef = screenshotBrowserService ?? null;

  async function recordAutoScreenshotOutcome({
    docId = "",
    segmentId = "",
    runId = "",
    resultId = "",
    url = "",
    title = "",
    textQuote = "",
    errorDetail = "",
    source = "link_screenshot"
  } = {}) {
    const normalizedDocId = String(docId ?? "").trim();
    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedDocId || !normalizedUrl || typeof recordSourceUsage !== "function") return null;
    const action = detectResearchOutcomeAction({
      url: normalizedUrl,
      errorDetail,
      source: "screenshot"
    });
    await recordSourceUsage({
      doc_id: normalizedDocId,
      segment_id: String(segmentId ?? "").trim() || null,
      domain: extractDomainFromUrl(normalizedUrl),
      url: normalizedUrl,
      title: clipString(title || normalizedUrl, 300),
      section_title: "",
      text_quote: clipString(textQuote, 600),
      action,
      used_at: new Date().toISOString()
    }).catch(() => null);
    const normalizedRunId = String(runId ?? "").trim();
    const normalizedResultId = String(resultId ?? "").trim();
    if (normalizedRunId && normalizedResultId && typeof markResearchApplied === "function") {
      await markResearchApplied(normalizedDocId, normalizedRunId, {
        result_id: normalizedResultId,
        action,
        applied_at: new Date().toISOString(),
        meta: {
          auto_recorded: true,
          source: String(source ?? "").trim() || "link_screenshot",
          domain: extractDomainFromUrl(normalizedUrl),
          url: normalizedUrl,
          error: clipString(errorDetail, 1000)
        }
      }).catch(() => null);
    }
    return action;
  }

  async function persistScreenshotAsset({
    buffer,
    url = "",
    source = "screenshot_lab_manual",
    sessionId = "",
    docId = "",
    segmentId = "",
    releaseId = "",
    note = ""
  }) {
    if (!createAsset || !buffer?.length) return null;
    const dayDir = new Date().toISOString().slice(0, 10);
    const screenshotsDir = path.resolve(dataDir || path.resolve(__dirname, "../../../data"), "_integration", "screenshots", dayDir);
    await fs.mkdir(screenshotsDir, { recursive: true });
    const fileName = createScreenshotFileName();
    const absolutePath = path.join(screenshotsDir, fileName);
    await fs.writeFile(absolutePath, buffer);
    const relativePath = normalizeRelativeFilePath(path.relative(dataDir, absolutePath));
    const asset = await createAsset({
      kind: "screenshot",
      status: "processed",
      title: clipString(`Screenshot ${getHostFromUrl(url) || fileName}`, 180),
      description: clipString(note || url, 1200),
      source_url: clipString(url, 2000),
      source_domain: clipString(getHostFromUrl(url), 200),
      file_name: fileName,
      local_path: relativePath,
      screenshot_path: relativePath,
      mime_type: "image/png",
      processing_state: "captured",
      origin_type: "screenshot_lab",
      origin_id: clipString(sessionId, 120),
      meta: {
        source,
        captured_from_url: clipString(url, 2000),
        note: clipString(note, 1000)
      }
    });
    if (!asset || !attachAsset) return asset;
    const attachmentTargets = [
      docId ? { target_type: "document", target_id: docId, role: "reference" } : null,
      segmentId ? { target_type: "segment", target_id: segmentId, role: "screenshot" } : null,
      releaseId ? { target_type: "release", target_id: releaseId, role: "visual" } : null
    ].filter(Boolean);
    for (const target of attachmentTargets) {
      await attachAsset(asset.id, {
        ...target,
        attached_by: "screenshot_lab"
      }).catch(() => null);
    }
    return asset;
  }

  app.get("/api/health", async (_req, res) => {
    try {
      const health = typeof getRuntimeHealth === "function" ? await getRuntimeHealth() : null;
      res.json({ ok: true, health });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error?.message ?? "health failed") });
    }
  });

  app.get("/tools/screenshot-lab", async (_req, res) => {
    try {
      const html = await fs.readFile(SCREENSHOT_LAB_HTML_PATH, "utf8");
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.send(html);
    } catch {
      return res.status(500).send("screenshot lab is unavailable");
    }
  });

  app.post("/api/tools/screenshot-lab/audit", async (req, res) => {
    try {
      const eventsRaw = Array.isArray(req.body?.events)
        ? req.body.events
        : req.body?.event
          ? [req.body.event]
          : [];
      if (!eventsRaw.length) {
        return res.status(400).json({ error: "events are required" });
      }
      const events = eventsRaw.slice(0, 200);
      const forwarded = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
      const ip = forwarded || String(req.socket?.remoteAddress ?? "");
      const userAgent = String(req.headers["user-agent"] ?? "");
      const referer = String(req.headers["referer"] ?? "");
      const accepted = await appendScreenshotLabAuditEvents(dataDir, events, { ip, userAgent, referer });
      return res.json({ ok: true, accepted });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tools/screenshot-lab/logs", async (req, res) => {
    try {
      const limit = clampNumber(req.query?.limit, 200, 1, 2000);
      const logs = await readScreenshotLabAuditEvents(dataDir, limit);
      return res.json({ logs, count: logs.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tools/screenshot-lab/cookies/path", async (_req, res) => {
    try {
      const value = getScreenshotCookiesPath();
      const exists = await pathIsFile(value);
      return res.json({
        path: value || null,
        enabled: exists
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "cookies path read failed") });
    }
  });

  app.post("/api/tools/screenshot-lab/cookies/path", async (req, res) => {
    try {
      const raw = String(req.body?.path ?? "").trim();
      if (!raw) {
        const resolved = setScreenshotCookiesPath("");
        await persistEnvVar(BACKEND_ENV_PATH, "LINK_SCREENSHOT_COOKIES_PATH", "");
        await appendScreenshotLabAuditEvents(dataDir, [
          { type: "cookies_global_reset_default", status: "ok", detail: resolved }
        ]);
        const exists = await pathIsFile(resolved);
        return res.json({ ok: true, path: resolved, enabled: exists, reset_to_default: true });
      }
      const resolved = path.resolve(raw);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) {
        return res.status(400).json({ error: "cookies file not found" });
      }
      setScreenshotCookiesPath(resolved);
      await persistEnvVar(BACKEND_ENV_PATH, "LINK_SCREENSHOT_COOKIES_PATH", resolved);
      await appendScreenshotLabAuditEvents(dataDir, [
        { type: "cookies_global_set", status: "ok", detail: resolved }
      ]);
      return res.json({ ok: true, path: resolved, enabled: true });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "cookies path set failed") });
    }
  });

  app.get("/api/tools/screenshot-lab/profile", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      const normalizedUrl = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(normalizedUrl)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }
      const profiles = await loadLinkScreenshotProfiles();
      const profile = resolveLinkScreenshotProfile(normalizedUrl, profiles);
      return res.json({
        ok: true,
        url: normalizedUrl,
        host: getHostFromUrl(normalizedUrl),
        profile: {
          width: clampNumber(profile?.width, 2560, 320, 3840),
          height: clampNumber(profile?.height, 1280, 240, 2160),
          zoom: clampNumber(profile?.zoom, 400, 50, 800)
        }
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "profile resolve failed") });
    }
  });

  app.get("/api/tools/screenshot-lab/browser/status", async (_req, res) => {
    try {
      const runtime = screenshotBrowserServiceRef?.getRuntimeInfo
        ? screenshotBrowserServiceRef.getRuntimeInfo()
        : {
            enabled: false,
            running: false,
            mode: "none",
            profile_dir: null
          };
      return res.json({ ok: true, browser: runtime });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "browser status failed") });
    }
  });

  app.post("/api/tools/screenshot-lab/manual/start", async (req, res) => {
    try {
      pruneManualSessions();
      const rawUrl = String(req.body?.url ?? "").trim();
      const normalizedUrl = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(normalizedUrl)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const profilePreset = resolveLinkScreenshotProfile(normalizedUrl, await loadLinkScreenshotProfiles());
      const outputWidth =
        readOptionalClampedNumber(req.body?.width, 480, 3840) ??
        clampNumber(profilePreset?.width, 2560, 480, 3840);
      const outputHeight =
        readOptionalClampedNumber(req.body?.height, 320, 2160) ??
        clampNumber(profilePreset?.height, 1280, 320, 2160);
      const zoom =
        readOptionalClampedNumber(req.body?.zoom, 50, 800) ??
        clampNumber(profilePreset?.zoom, 400, 50, 800);
      const requestedCookiesPath = String(req.body?.cookies_path ?? "").trim();
      const cookiesPathRaw = requestedCookiesPath || getScreenshotCookiesPath();
      const cookiesPath = cookiesPathRaw ? path.resolve(cookiesPathRaw) : "";
      const cookies = cookiesPath ? await loadCookiesForUrl(cookiesPath, normalizedUrl) : [];

      await closeAllManualSessions("manual_restarted");
      let browser = null;
      let page = null;
      let persistentMode = false;
      let persistentOpenError = null;
      let browserRuntime = screenshotBrowserServiceRef?.getRuntimeInfo
        ? screenshotBrowserServiceRef.getRuntimeInfo()
        : null;
      let restorePersistentHeadless = false;
      if (
        SCREENSHOT_LAB_MANUAL_FORCE_HEADED &&
        Boolean(browserRuntime?.headless) &&
        screenshotBrowserServiceRef?.restart
      ) {
        try {
          browserRuntime = await screenshotBrowserServiceRef.restart({ headless: false });
          restorePersistentHeadless = true;
        } catch {
          // fallback below
        }
      }
      if (screenshotBrowserServiceRef?.enabled && screenshotBrowserServiceRef?.openPage) {
        try {
          const opened = await screenshotBrowserServiceRef.openPage({
            url: normalizedUrl,
            width: outputWidth,
            height: outputHeight
          });
          browser = opened?.browser ?? null;
          page = opened?.page ?? null;
          persistentMode = Boolean(opened?.persistent);
        } catch (error) {
          persistentOpenError = error;
        }
      }
      if (!browser || !page) {
        if (screenshotBrowserServiceRef?.enabled && !SCREENSHOT_LAB_MANUAL_ALLOW_EPHEMERAL_FALLBACK) {
          const runtime = screenshotBrowserServiceRef?.getRuntimeInfo ? screenshotBrowserServiceRef.getRuntimeInfo() : null;
          const runtimeError = String(runtime?.last_error ?? "").trim();
          const openError = String(persistentOpenError?.message ?? "").trim();
          const reason = runtimeError || openError || "persistent browser is unavailable";
          return res.status(503).json({
            error: `persistent profile is unavailable: ${reason}`,
            hint:
              "Set SCREENSHOT_LAB_MANUAL_ALLOW_EPHEMERAL_FALLBACK=1 for temporary fallback, or fix persistent browser profile settings."
          });
        }
        const puppeteer = await loadManualPuppeteer();
        browser = await puppeteer.launch({
          headless: false,
          defaultViewport: null,
          ignoreDefaultArgs: ["--enable-automation"],
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--lang=ru-RU",
            `--window-size=${outputWidth},${outputHeight}`
          ]
        });

        page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
          try {
            Object.defineProperty(navigator, "webdriver", { get: () => false });
          } catch {
            // noop
          }
          try {
            Object.defineProperty(navigator, "language", { get: () => "ru-RU" });
            Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru", "en-US", "en"] });
          } catch {
            // noop
          }
        });
      }

      let cdp = null;
      const lockWindowBounds = String(req.body?.lock_window ?? "0").trim() === "1";
      try {
        cdp = await page.createCDPSession();
        if (lockWindowBounds) {
          const windowInfo = await cdp.send("Browser.getWindowForTarget");
          const windowId = Number(windowInfo?.windowId ?? 0);
          if (Number.isFinite(windowId) && windowId > 0) {
            await cdp.send("Browser.setWindowBounds", {
              windowId,
              bounds: {
                width: outputWidth,
                height: outputHeight
              }
            });
          }
        }
      } catch {
        // noop
      }

      const sessionId = createManualSessionId();
      const session = {
        id: sessionId,
        browser,
        page,
        startedAt: new Date().toISOString(),
        updatedAt: Date.now(),
        width: outputWidth,
        height: outputHeight,
        deviceScaleFactor: null,
        zoom,
        baseUrl: normalizedUrl,
        cookiesPath,
        cdp,
        persistent: persistentMode,
        restorePersistentHeadless,
        events: []
      };
      manualLabSessions.set(sessionId, session);
      pushManualSessionEvent(session, "session_started", {
        url: normalizedUrl,
        width: outputWidth,
        height: outputHeight,
        scale_factor: null,
        zoom,
        mode: persistentMode ? "persistent-profile" : "ephemeral",
        cookies: cookies.length ? "loaded" : cookiesPath ? "empty" : "none"
      });

      await page.exposeFunction("__screenshotLabRecordEvent", (payload) => {
        const active = manualLabSessions.get(sessionId);
        if (!active) return;
        const event = sanitizeManualDomEvent(payload);
        if (!event) return;
        pushManualSessionEvent(active, `dom_${event.type}`, event);
      });
      await page.evaluateOnNewDocument(buildManualRecorderScript());

      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        const active = manualLabSessions.get(sessionId);
        if (!active) return;
        pushManualSessionEvent(active, "navigate", { url: frame.url() });
      });
      page.on("load", () => {
        const active = manualLabSessions.get(sessionId);
        if (!active) return;
        pushManualSessionEvent(active, "load", { url: page.url() });
      });
      page.on("close", () => {
        closeManualSession(sessionId, "page_closed").catch(() => null);
      });

      if (cookies.length) {
        await page.setCookie(...cookies);
      }

      if (!persistentMode) {
        await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      }
      await waitForPageToSettle(page, SCREENSHOT_LAB_MANUAL_READY_WAIT_MS);
      pushManualSessionEvent(session, "ready", { url: page.url() || normalizedUrl });
      await appendScreenshotLabAuditEvents(dataDir, [
        { type: "manual_start", url: normalizedUrl, detail: `session=${sessionId}` }
      ]);

      return res.json({
        ok: true,
        session_id: sessionId,
        url: normalizedUrl,
        width: outputWidth,
        height: outputHeight,
        device_scale_factor: null,
        zoom,
        cookies_loaded: cookies.length,
        mode: persistentMode ? "persistent-profile" : "ephemeral",
        note: persistentMode
          ? "Tab opened in persistent browser profile. Logins/cookies/extensions are reused."
          : "Browser opened in manual mode. Interact with it, then call capture."
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "manual start failed") });
    }
  });

  app.get("/api/tools/screenshot-lab/manual/state", async (req, res) => {
    try {
      pruneManualSessions();
      const requested = String(req.query?.session_id ?? "").trim();
      const sessionId = requested || [...manualLabSessions.keys()].at(-1) || "";
      const session = sessionId ? manualLabSessions.get(sessionId) : null;
      if (!session) {
        return res.json({ active: false, session: null });
      }
      return res.json({
        active: true,
        session: {
          session_id: session.id,
          started_at: session.startedAt,
          updated_at: new Date(session.updatedAt).toISOString(),
          width: session.width,
          height: session.height,
          device_scale_factor: session.deviceScaleFactor ?? null,
          zoom: session.zoom,
          mode: session.persistent ? "persistent-profile" : "ephemeral",
          base_url: session.baseUrl,
          current_url: session.page?.url?.() || session.baseUrl,
          cookies_path: session.cookiesPath || null,
          events_count: session.events.length,
          last_event: session.events.at(-1) ?? null
        }
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "manual state failed") });
    }
  });

  app.get("/api/tools/screenshot-lab/manual/events", async (req, res) => {
    try {
      pruneManualSessions();
      const sessionId = String(req.query?.session_id ?? "").trim();
      if (!sessionId) {
        return res.status(400).json({ error: "session_id is required" });
      }
      const session = manualLabSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: "manual session not found" });
      }
      const limit = clampNumber(req.query?.limit, 80, 1, 1000);
      const events = session.events.slice(-limit);
      return res.json({ session_id: sessionId, events, count: events.length });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "manual events failed") });
    }
  });

  app.post("/api/tools/screenshot-lab/manual/capture", async (req, res) => {
    let session = null;
    try {
      pruneManualSessions();
      const sessionId = String(req.body?.session_id ?? "").trim();
      if (!sessionId) {
        return res.status(400).json({ error: "session_id is required" });
      }
      session = manualLabSessions.get(sessionId);
      if (!session || !session.page) {
        return res.status(404).json({ error: "manual session not found" });
      }
      await waitForPageToSettle(session.page, SCREENSHOT_LAB_MANUAL_CAPTURE_WAIT_MS);
      await hideScrollbarsForCapture(session.page);
      const buffer = await session.page.screenshot({
        type: "png",
        fullPage: false,
        captureBeyondViewport: false
      });
      const screenshotAsset = await persistScreenshotAsset({
        buffer,
        url: session.page.url?.() || session.baseUrl,
        sessionId,
        docId: String(req.body?.doc_id ?? "").trim(),
        segmentId: String(req.body?.segment_id ?? "").trim(),
        releaseId: String(req.body?.release_id ?? "").trim(),
        note: String(req.body?.note ?? "").trim()
      }).catch(() => null);
      pushManualSessionEvent(session, "capture", { url: session.page.url?.() || session.baseUrl });
      await appendScreenshotLabAuditEvents(dataDir, [
        { type: "manual_capture", url: session.page.url?.() || session.baseUrl, detail: `session=${sessionId}` }
      ]);
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "no-store");
      if (screenshotAsset?.id) {
        res.setHeader("x-screenshot-asset-id", screenshotAsset.id);
        res.setHeader("x-screenshot-asset-path", String(screenshotAsset.screenshot_path || screenshotAsset.local_path || ""));
      }
      return res.send(buffer);
    } catch (error) {
      await recordAutoScreenshotOutcome({
        docId: String(req.body?.doc_id ?? "").trim(),
        segmentId: String(req.body?.segment_id ?? "").trim(),
        runId: String(req.body?.run_id ?? "").trim(),
        resultId: String(req.body?.result_id ?? "").trim(),
        url: session?.page?.url?.() || session?.baseUrl || "",
        title: String(req.body?.note ?? "").trim(),
        textQuote: String(req.body?.text_quote ?? "").trim(),
        errorDetail: String(error?.message ?? "manual capture failed"),
        source: "manual_capture"
      });
      return res.status(500).json({ error: String(error?.message ?? "manual capture failed") });
    }
  });

  app.post("/api/tools/screenshot-lab/manual/cookies/export", async (req, res) => {
    try {
      pruneManualSessions();
      const sessionId = String(req.body?.session_id ?? "").trim();
      if (!sessionId) {
        return res.status(400).json({ error: "session_id is required" });
      }
      const session = manualLabSessions.get(sessionId);
      if (!session || !session.page) {
        return res.status(404).json({ error: "manual session not found" });
      }

      const domains = parseDomainList(req.body?.domains ?? "");
      const cdp = await session.page.target().createCDPSession();
      await cdp.send("Network.enable");
      const cookiesPayload = await cdp.send("Network.getAllCookies");
      const rawCookies = Array.isArray(cookiesPayload?.cookies) ? cookiesPayload.cookies : [];
      const filtered = domains.length
        ? rawCookies.filter((cookie) => cookieDomainMatchesList(cookie?.domain ?? "", domains))
        : rawCookies;

      const dedup = new Map();
      filtered.forEach((cookie) => {
        const domain = String(cookie?.domain ?? "").trim();
        const pathValue = String(cookie?.path ?? "/").trim() || "/";
        const name = String(cookie?.name ?? "").trim();
        if (!domain || !name) return;
        const key = `${normalizeHost(domain).replace(/^\./, "")}|${pathValue}|${name}`;
        if (dedup.has(key)) return;
        const normalized = {
          name,
          value: String(cookie?.value ?? ""),
          domain,
          path: pathValue,
          secure: Boolean(cookie?.secure),
          httpOnly: Boolean(cookie?.httpOnly)
        };
        const expires = Number(cookie?.expires ?? 0);
        if (Number.isFinite(expires) && expires > 0) {
          normalized.expires = Math.floor(expires);
        }
        const sameSiteRaw = String(cookie?.sameSite ?? "").trim();
        if (sameSiteRaw) {
          const normalizedSameSite = sameSiteRaw.charAt(0).toUpperCase() + sameSiteRaw.slice(1).toLowerCase();
          normalized.sameSite = normalizedSameSite;
        }
        dedup.set(key, normalized);
      });

      const cookies = [...dedup.values()];
      const cookiesDir = path.resolve(dataDir || path.resolve(__dirname, "../../../data"), "cookies");
      await fs.mkdir(cookiesDir, { recursive: true });
      const requestedTarget = String(req.body?.target_path ?? "").trim();
      const defaultTargetPath = getScreenshotCookiesPath();
      const targetPath = path.resolve(requestedTarget || defaultTargetPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const fileName = path.basename(targetPath);
      const payload = {
        exported_at: new Date().toISOString(),
        session_id: sessionId,
        domains,
        current_url: session.page?.url?.() || session.baseUrl || "",
        cookies
      };
      await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");
      setScreenshotCookiesPath(targetPath);
      await persistEnvVar(BACKEND_ENV_PATH, "LINK_SCREENSHOT_COOKIES_PATH", targetPath);

      pushManualSessionEvent(session, "cookies_export", {
        count: cookies.length,
        domains: domains.join(","),
        path: targetPath
      });
      await appendScreenshotLabAuditEvents(dataDir, [
        {
          type: "manual_cookies_export",
          detail: `session=${sessionId};count=${cookies.length};path=${targetPath}`,
          status: "ok"
        }
      ]);

      return res.json({
        ok: true,
        session_id: sessionId,
        count: cookies.length,
        domains,
        path: targetPath,
        file_name: fileName
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "manual cookies export failed") });
    }
  });

  app.post("/api/tools/screenshot-lab/manual/stop", async (req, res) => {
    try {
      const sessionId = String(req.body?.session_id ?? "").trim();
      if (!sessionId) {
        return res.status(400).json({ error: "session_id is required" });
      }
      await closeManualSession(sessionId, "manual_stopped");
      await appendScreenshotLabAuditEvents(dataDir, [
        { type: "manual_stop", detail: `session=${sessionId}` }
      ]);
      return res.json({ ok: true, session_id: sessionId });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message ?? "manual stop failed") });
    }
  });

  app.get("/api/config", (_req, res) => {
    res.json(config);
  });

  app.get("/api/source-profiles", async (_req, res) => {
    try {
      const profiles = await sourceProfilesStore.getSourceProfiles();
      res.json({
        file_path: sourceProfilesStore.filePath,
        profiles
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/source-profiles", async (req, res) => {
    try {
      const profilesInput =
        req.body?.profiles && typeof req.body.profiles === "object" && !Array.isArray(req.body.profiles)
          ? req.body.profiles
          : null;
      if (!profilesInput) {
        return res.status(400).json({ error: "profiles object is required" });
      }
      const profiles = await sourceProfilesStore.updateSourceProfiles(profilesInput);
      res.json({
        ok: true,
        file_path: sourceProfilesStore.filePath,
        profiles
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/source-memory", async (_req, res) => {
    try {
      const memory = await sourceMemoryStore.getSourceMemory();
      res.json({
        file_path: sourceMemoryStore.filePath,
        summary: sourceMemoryStore.summarizeMemory(memory)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/release-outcome-memory", async (_req, res) => {
    try {
      if (!releaseOutcomeMemoryStore) {
        return res.status(503).json({ error: "Release outcome memory unavailable" });
      }
      const memory = await releaseOutcomeMemoryStore.getReleaseOutcomeMemory();
      res.json({
        file_path: releaseOutcomeMemoryStore.filePath,
        summary: releaseOutcomeMemoryStore.summarizeReleaseOutcomeMemory(memory)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/audit/ui-actions", async (req, res) => {
    try {
      if (typeof appendUiActionsAudit !== "function") {
        return res.status(503).json({ error: "UI audit disabled" });
      }
      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
      const source = String(req.body?.source ?? "frontend");
      const userAgent = String(req.headers["user-agent"] ?? "");
      const forwarded = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
      const ip = forwarded || String(req.socket?.remoteAddress ?? "");
      const result = await appendUiActionsAudit(actions, { source, userAgent, ip });
      return res.json({ ok: true, accepted: Number(result?.accepted ?? 0) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/search/translate", async (req, res) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }
      const translated = await translateHeadingToEnglishQuery(text);
      return res.json({ text: translated || text });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notion/raw", async (req, res) => {
    try {
      const rawUrl = String(req.body?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeNotionUrl(rawUrl);
      if (!isNotionUrl(url)) {
        return res.status(400).json({ error: "Notion URL is required" });
      }

      const progressId = String(req.body?.progress_id ?? "").trim();
      if (progressId) {
        initNotionProgress(progressId);
      }

      const content = await scrapeNotionPage(url, (message) => {
        if (!progressId) return;
        pushNotionProgress(progressId, message);
      });

      if (progressId) {
        finishNotionProgress(progressId);
      }

      res.json({ url, content, progress_id: progressId || null });
    } catch (error) {
      const progressId = String(req.body?.progress_id ?? "").trim();
      if (progressId) {
        pushNotionProgress(progressId, `ERROR ${error.message}`);
        finishNotionProgress(progressId);
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/notion/progress/:progressId", (req, res) => {
    const progressId = String(req.params?.progressId ?? "").trim();
    if (!progressId) {
      return res.status(400).json({ error: "progressId is required" });
    }
    pruneNotionProgressStore();
    const snapshot = getNotionProgress(progressId);
    if (!snapshot) {
      return res.status(404).json({ error: "Progress session not found" });
    }
    return res.json(snapshot);
  });

  app.get("/api/link/preview", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(url)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const preview = await fetchLinkPreview(url);
      res.json(preview);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/link/image", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(url)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const controller = new AbortController();
      const timeoutMs = (() => {
        try {
          const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
          return host === "image.thum.io" ? 25000 : 12000;
        } catch {
          return 12000;
        }
      })();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const referer = (() => {
          try {
            return new URL(url).origin + "/";
          } catch {
            return undefined;
          }
        })();
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            ...(referer ? { referer } : {})
          }
        });

        if (!response.ok) {
          return res.status(502).json({ error: "image fetch failed" });
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          return res.status(415).json({ error: "not an image" });
        }
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength && contentLength > imageProxyMaxBytes) {
          return res.status(413).json({ error: "image too large" });
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > imageProxyMaxBytes) {
          return res.status(413).json({ error: "image too large" });
        }

        res.setHeader("content-type", contentType);
        res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
        return res.send(buffer);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/link/screenshot", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const normalizedUrl = normalizeLinkUrl(rawUrl);
      const docId = String(req.query?.doc_id ?? "").trim();
      const segmentId = String(req.query?.segment_id ?? "").trim();
      const runId = String(req.query?.run_id ?? "").trim();
      const resultId = String(req.query?.result_id ?? "").trim();
      const note = String(req.query?.note ?? "").trim();
      const textQuote = String(req.query?.text_quote ?? "").trim();
      if (!isHttpUrl(normalizedUrl)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }
      const captureUrl = stripTrackingParamsForScreenshot(normalizedUrl);
      const cacheVersion = String(req.query?.v ?? "").trim() || "1";
      const useCookies = String(req.query?.use_cookies ?? "1").trim() !== "0";
      const cookiesPath = useCookies ? getScreenshotCookiesPath() : "";

      const host = getHostFromUrl(captureUrl);
      if (isPrivateOrLocalHost(host)) {
        return res.status(400).json({ error: "private/local URLs are not allowed" });
      }

      const profiles = await loadLinkScreenshotProfiles();
      const resolvedProfile = resolveLinkScreenshotProfile(captureUrl, profiles);
      const profile = {
        width: readOptionalClampedNumber(req.query?.width, 320, 3840) ?? resolvedProfile.width,
        height: readOptionalClampedNumber(req.query?.height, 240, 5120) ?? resolvedProfile.height,
        zoom: readOptionalClampedNumber(req.query?.zoom, 50, 800) ?? resolvedProfile.zoom
      };
      const resetBrowserZoom = String(req.query?.reset_browser_zoom ?? "0").trim() === "1";
      const usePersistentCapture = shouldUsePersistentBrowserCapture(captureUrl);
      const captureStrategy = !usePersistentCapture
        ? "local-only"
        : resetBrowserZoom
          ? "persistent-first"
          : "local-first";
      const cacheKey = `${captureUrl}|${profile.width}|${profile.height}|${profile.zoom}|strategy=${captureStrategy}|cookies=${cookiesPath ? "1" : "0"}|reset=${resetBrowserZoom ? "1" : "0"}|v=${cacheVersion}`;
      const cached = getCachedLinkScreenshot(cacheKey);
      if (cached) {
        res.setHeader("x-link-screenshot-width", String(profile.width));
        res.setHeader("x-link-screenshot-height", String(profile.height));
        res.setHeader("x-link-screenshot-zoom", String(profile.zoom));
        res.setHeader(
          "x-link-screenshot-source",
          usePersistentCapture ? "cache:persistent-browser" : "cache"
        );
        res.setHeader(
          "x-link-screenshot-cookies",
          usePersistentCapture ? "profile" : cookiesPath ? "on" : "off"
        );
        res.setHeader("content-type", "image/png");
        res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
        return res.send(cached);
      }

      let buffer = null;
      let contentType = "image/png";
      let screenshotSource = "local";
      let lastCaptureError = null;

      const tryLocalCapture = async () => {
        buffer = await captureLinkScreenshotBuffer({
          url: captureUrl,
          width: profile.width,
          height: profile.height,
          zoom: profile.zoom,
          cookiesPath
        });
        screenshotSource = "local";
      };

      const tryPersistentCapture = async () => {
        buffer = await captureLinkScreenshotViaPersistentBrowser({
          url: captureUrl,
          width: profile.width,
          height: profile.height,
          zoom: profile.zoom,
          resetBrowserZoom
        });
        screenshotSource = "persistent-browser";
      };

      if (captureStrategy === "persistent-first") {
        try {
          await tryPersistentCapture();
        } catch (error) {
          lastCaptureError = error;
          try {
            await tryLocalCapture();
          } catch (fallbackError) {
            lastCaptureError = fallbackError;
          }
        }
      } else {
        try {
          await tryLocalCapture();
        } catch (error) {
          lastCaptureError = error;
          if (usePersistentCapture) {
            try {
              await tryPersistentCapture();
            } catch (fallbackError) {
              lastCaptureError = fallbackError;
            }
          }
        }
      }

      if (!buffer) {
        const message = String(lastCaptureError?.message ?? "").toLowerCase();
        const localAntiBotBlocked =
          message.includes("anti-bot-page") && isHostInDomain(host, "tass.ru") && !usePersistentCapture;
        if (localAntiBotBlocked) {
          await recordAutoScreenshotOutcome({
            docId,
            segmentId,
            runId,
            resultId,
            url: captureUrl,
            title: note,
            textQuote,
            errorDetail: "screenshot blocked by anti-bot",
            source: "link_screenshot"
          });
          return res.status(502).json({ error: "screenshot blocked by anti-bot" });
        }
        const thumIoUrl = buildThumIoScreenshotUrl(captureUrl, profile);
        const fallback = await fetchRemoteImageBuffer(thumIoUrl, imageProxyMaxBytes, 28000);
        if (!fallback?.buffer) {
          throw lastCaptureError ?? new Error("screenshot capture failed");
        }
        buffer = fallback.buffer;
        contentType = String(fallback.contentType ?? "image/png");
        screenshotSource = "thum.io";
      }

      if (!buffer || buffer.length > imageProxyMaxBytes) {
        return res.status(413).json({ error: "image too large" });
      }

      putCachedLinkScreenshot(cacheKey, buffer);
      res.setHeader("x-link-screenshot-width", String(profile.width));
      res.setHeader("x-link-screenshot-height", String(profile.height));
      res.setHeader("x-link-screenshot-zoom", String(profile.zoom));
      res.setHeader("x-link-screenshot-source", screenshotSource);
      res.setHeader(
        "x-link-screenshot-cookies",
        screenshotSource === "persistent-browser" ? "profile" : cookiesPath ? "on" : "off"
      );
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.send(buffer);
    } catch (error) {
      await recordAutoScreenshotOutcome({
        docId: String(req.query?.doc_id ?? "").trim(),
        segmentId: String(req.query?.segment_id ?? "").trim(),
        runId: String(req.query?.run_id ?? "").trim(),
        resultId: String(req.query?.result_id ?? "").trim(),
        url: String(req.query?.url ?? "").trim(),
        title: String(req.query?.note ?? "").trim(),
        textQuote: String(req.query?.text_quote ?? "").trim(),
        errorDetail: String(error?.message ?? "screenshot failed"),
        source: "link_screenshot"
      });
      return res.status(502).json({ error: String(error?.message ?? "screenshot failed") });
    }
  });
}
