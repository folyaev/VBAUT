import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function parseMode(value, fallback = "launch") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "launch" || raw === "connect") return raw;
  return fallback;
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileExists(filePath) {
  try {
    return fsSync.existsSync(filePath);
  } catch {
    return false;
  }
}

function detectChromeExecutable() {
  const platform = process.platform;
  if (platform === "win32") {
    const candidates = [
      process.env.CHROME_PATH,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
      process.env["PROGRAMFILES(X86)"]
        ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
        : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
        : ""
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fileExists(candidate)) return candidate;
    }
    return "";
  }
  if (platform === "darwin") {
    const candidates = [
      process.env.CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fileExists(candidate)) return candidate;
    }
    return "";
  }
  const linuxCandidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ].filter(Boolean);
  for (const candidate of linuxCandidates) {
    if (fileExists(candidate)) return candidate;
  }
  return "";
}

async function safeDirectory(pathValue) {
  const resolved = path.resolve(String(pathValue ?? "").trim());
  if (!resolved) return "";
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return "";
    return resolved;
  } catch {
    return "";
  }
}

async function loadPuppeteer() {
  try {
    const mod = await import("puppeteer");
    return mod?.default ?? mod;
  } catch {
    const mod = await import("../../../HeadlessNotion/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js");
    return mod?.default ?? mod;
  }
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function createPersistentScreenshotBrowserService(options = {}) {
  const env = options?.env ?? process.env;
  const dataDir = path.resolve(String(options?.dataDir ?? path.resolve(__dirname, "../../../data")).trim());
  const logger = options?.logger ?? console;

  const enabled = parseBoolean(env.SCREENSHOT_BROWSER_ENABLED, true);
  const autoStart = parseBoolean(env.SCREENSHOT_BROWSER_AUTOSTART, true);
  const configuredHeadless = parseBoolean(env.SCREENSHOT_BROWSER_HEADLESS, true);
  let headless = configuredHeadless;
  const mode = parseMode(env.SCREENSHOT_BROWSER_MODE, "launch");
  const remoteDebugPort = clampNumber(env.SCREENSHOT_BROWSER_DEBUG_PORT, 9223, 1024, 65535);
  const connectHost = String(env.SCREENSHOT_BROWSER_CONNECT_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const connectPort = clampNumber(env.SCREENSHOT_BROWSER_CONNECT_PORT, remoteDebugPort, 1024, 65535);
  const profileDir = path.resolve(
    String(env.SCREENSHOT_BROWSER_PROFILE_DIR ?? path.resolve(dataDir, "screenshot-browser-profile")).trim()
  );
  const executablePathRaw = String(env.SCREENSHOT_BROWSER_EXECUTABLE_PATH ?? "").trim();
  const detectedChromePath = detectChromeExecutable();
  const executablePath = executablePathRaw || detectedChromePath;
  const extensionsRaw = splitList(env.SCREENSHOT_BROWSER_EXTENSIONS ?? "");
  const extraArgsRaw = splitList(env.SCREENSHOT_BROWSER_EXTRA_ARGS ?? "");

  let browser = null;
  let browserPromise = null;
  let puppeteer = null;
  let startedAt = "";
  let lastError = "";
  let launchMode = "none";
  let extensionDirs = [];
  let browserProcess = null;

  async function waitForWebSocketEndpoint(host, port, timeoutMs = 15000) {
    const started = Date.now();
    let lastErr = null;
    while (Date.now() - started < timeoutMs) {
      try {
        return await resolveWebSocketEndpoint(host, port);
      } catch (error) {
        lastErr = error;
        await delay(300);
      }
    }
    throw lastErr ?? new Error("timed out waiting for browser websocket endpoint");
  }

  async function resolveWebSocketEndpoint(host, port) {
    const endpoint = `http://${host}:${port}/json/version`;
    const response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) {
      throw new Error(`cannot resolve browser websocket endpoint: ${response.status}`);
    }
    const payload = await response.json();
    const ws = String(payload?.webSocketDebuggerUrl ?? "").trim();
    if (!ws) {
      throw new Error("webSocketDebuggerUrl is missing");
    }
    return ws;
  }

  async function resolveExtensions() {
    if (!extensionsRaw.length) return [];
    const resolved = [];
    for (const raw of extensionsRaw) {
      const candidate = await safeDirectory(raw);
      if (candidate) resolved.push(candidate);
    }
    return resolved;
  }

  async function ensureBrowser() {
    if (!enabled) {
      throw new Error("persistent browser is disabled");
    }
    if (browser) return browser;
    if (browserPromise) return browserPromise;

    browserPromise = (async () => {
      await fs.mkdir(profileDir, { recursive: true });
      extensionDirs = await resolveExtensions();
      puppeteer = await loadPuppeteer();

      if (mode === "connect") {
        const browserWSEndpoint = await resolveWebSocketEndpoint(connectHost, connectPort);
        const connected = await puppeteer.connect({
          browserWSEndpoint,
          defaultViewport: null
        });
        browser = connected;
        startedAt = new Date().toISOString();
        launchMode = "connect";
        lastError = "";
        browser.on("disconnected", () => {
          browser = null;
        });
        return connected;
      }

      const baseArgs = [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        `--remote-debugging-port=${remoteDebugPort}`
      ];
      if (extraArgsRaw.length) {
        baseArgs.push(...extraArgsRaw);
      }
      if (extensionDirs.length) {
        const joined = extensionDirs.join(",");
        baseArgs.push(`--disable-extensions-except=${joined}`);
        baseArgs.push(`--load-extension=${joined}`);
      }

      if (executablePath) {
        const spawnArgs = [...baseArgs];
        if (headless) {
          spawnArgs.push("--headless=new");
          spawnArgs.push("--disable-gpu");
          spawnArgs.push("--window-size=2560,1280");
        }
        spawnArgs.push(`--user-data-dir=${profileDir}`, "about:blank");
        browserProcess = spawn(executablePath, spawnArgs, {
          detached: false,
          stdio: "ignore",
          windowsHide: false
        });
        browserProcess.on("exit", () => {
          browserProcess = null;
          browser = null;
        });
        const browserWSEndpoint = await waitForWebSocketEndpoint(connectHost, remoteDebugPort, 20000);
        const connected = await puppeteer.connect({
          browserWSEndpoint,
          defaultViewport: null
        });
        browser = connected;
        startedAt = new Date().toISOString();
        launchMode = "launch";
        lastError = "";
        browser.on("disconnected", () => {
          browser = null;
        });
        return connected;
      }

      const launchOptions = {
        headless,
        defaultViewport: null,
        userDataDir: profileDir,
        ignoreDefaultArgs: ["--enable-automation"],
        args: baseArgs
      };

      const launched = await puppeteer.launch(launchOptions);
      browser = launched;
      startedAt = new Date().toISOString();
      launchMode = "launch";
      lastError = "";
      browser.on("disconnected", () => {
        browser = null;
      });
      return launched;
    })();

    try {
      return await browserPromise;
    } catch (error) {
      lastError = String(error?.message ?? "failed to launch browser");
      if (browserProcess) {
        try {
          browserProcess.kill();
        } catch {
          // noop
        }
        browserProcess = null;
      }
      throw error;
    } finally {
      browserPromise = null;
    }
  }

  async function startBackground() {
    if (!enabled || !autoStart) return false;
    try {
      await ensureBrowser();
      logger.log?.(
        `[screenshot-browser] started: profile=${profileDir} port=${remoteDebugPort} extensions=${extensionDirs.length}`
      );
      return true;
    } catch (error) {
      lastError = String(error?.message ?? "failed to launch browser");
      logger.error?.(`[screenshot-browser] autostart failed: ${lastError}`);
      return false;
    }
  }

  async function openPage({
    url,
    width = 2560,
    height = 1280,
    userAgent = "",
    acceptLanguage = "",
    emulateViewport = false
  } = {}) {
    const activeBrowser = await ensureBrowser();
    const page = await activeBrowser.newPage();
    await page.evaluateOnNewDocument(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      } catch {
        // noop
      }
    });
    if (emulateViewport) {
      await page.setViewport({
        width: clampNumber(width, 2560, 480, 3840),
        height: clampNumber(height, 1280, 320, 2160)
      });
    }
    if (userAgent) {
      await page.setUserAgent(String(userAgent));
    }
    if (acceptLanguage) {
      await page.setExtraHTTPHeaders({ "accept-language": String(acceptLanguage) });
    }
    if (url) {
      await page.goto(String(url), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    }
    return { browser: activeBrowser, page, persistent: true };
  }

  async function closePage(page) {
    if (!page) return;
    try {
      await page.close();
    } catch {
      // noop
    }
  }

  async function stopBrowser() {
    if (browser) {
      const closing = browser;
      browser = null;
      try {
        await closing.close();
      } catch {
        // noop
      }
    }
    if (browserProcess) {
      const proc = browserProcess;
      browserProcess = null;
      try {
        proc.kill();
      } catch {
        // noop
      }
    }
  }

  async function restart(options = {}) {
    const hasHeadlessOverride = Object.prototype.hasOwnProperty.call(options ?? {}, "headless");
    const requestedHeadless = hasHeadlessOverride ? Boolean(options?.headless) : headless;
    if (mode === "connect" && hasHeadlessOverride && requestedHeadless !== headless) {
      throw new Error("cannot change headless in connect mode");
    }
    const previousHeadless = headless;
    if (hasHeadlessOverride) {
      headless = requestedHeadless;
    }
    try {
      await stopBrowser();
      await ensureBrowser();
      return getRuntimeInfo();
    } catch (error) {
      headless = previousHeadless;
      throw error;
    }
  }

  function getRuntimeInfo() {
    return {
      enabled,
      auto_start: autoStart,
      headless,
      configured_headless: configuredHeadless,
      running: Boolean(browser),
      mode: launchMode,
      configured_mode: mode,
      started_at: startedAt || null,
      profile_dir: profileDir,
      debug_port: remoteDebugPort,
      connect_host: connectHost,
      connect_port: connectPort,
      extensions: extensionDirs,
      extra_args: extraArgsRaw,
      executable_path: executablePath || null,
      executable_path_source: executablePathRaw ? "env" : detectedChromePath ? "auto-detected" : "none",
      spawned_process: Boolean(browserProcess),
      last_error: lastError || null
    };
  }

  return {
    enabled,
    autoStart,
    ensureBrowser,
    startBackground,
    openPage,
    closePage,
    restart,
    stopBrowser,
    getRuntimeInfo
  };
}
