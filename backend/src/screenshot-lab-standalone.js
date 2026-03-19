import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { scrapeNotionPage } from "../../HeadlessNotion/notion-scraper.js";
import { config, translateHeadingToEnglishQuery } from "./llm.js";
import { resolveDownloaderTools } from "./downloader.js";
import { registerMiscRoutes } from "./routes/misc.js";
import { getDataDir } from "./storage.js";
import { createNotionProgressStore } from "./services/notion-progress.js";
import { createUiActionsAuditStore } from "./services/ui-actions-audit.js";
import { createLinkPreviewUtils } from "./services/link-preview.js";
import { isHttpUrl, normalizeLinkUrl } from "./services/links.js";
import { isNotionUrl, normalizeNotionUrl } from "./services/notion-url.js";
import { createPersistentScreenshotBrowserService } from "./services/screenshot-browser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseEnvValue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return inner;
  }
  return value;
}

function loadEnvFile(filePath) {
  const target = path.resolve(filePath);
  if (!fs.existsSync(target)) return false;
  const raw = fs.readFileSync(target, "utf8");
  const lines = String(raw).split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = String(lineRaw ?? "").trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] != null && String(process.env[key]).trim() !== "") continue;
    const value = parseEnvValue(normalized.slice(eq + 1));
    process.env[key] = value;
  }
  return true;
}

loadEnvFile(path.resolve(__dirname, "../.env"));
loadEnvFile(path.resolve(__dirname, "../../.env"));

const app = express();
const PORT = Number(process.env.SCREENSHOT_LAB_PORT ?? 8790);
const IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024;
const UI_ACTION_AUDIT_ENABLED = String(process.env.UI_ACTION_AUDIT_ENABLED ?? "1") !== "0";

const {
  finishNotionProgress,
  getNotionProgress,
  initNotionProgress,
  pruneNotionProgressStore,
  pushNotionProgress
} = createNotionProgressStore({
  ttlMs: 15 * 60 * 1000
});
const { appendActions: appendUiActionsAudit } = createUiActionsAuditStore({
  dataDir: getDataDir(),
  enabled: UI_ACTION_AUDIT_ENABLED
});
const downloaderTools = await resolveDownloaderTools();
const { fetchLinkPreview } = createLinkPreviewUtils({
  ytDlpPath: downloaderTools.ytDlpPath
});
const screenshotBrowserService = createPersistentScreenshotBrowserService({
  dataDir: getDataDir(),
  env: process.env
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

registerMiscRoutes(app, {
  appendUiActionsAudit,
  config,
  dataDir: getDataDir(),
  fetchLinkPreview,
  finishNotionProgress,
  getNotionProgress,
  imageProxyMaxBytes: IMAGE_PROXY_MAX_BYTES,
  initNotionProgress,
  isHttpUrl,
  isNotionUrl,
  normalizeLinkUrl,
  normalizeNotionUrl,
  pruneNotionProgressStore,
  pushNotionProgress,
  screenshotBrowserService,
  scrapeNotionPage,
  translateHeadingToEnglishQuery
});

app.get("/", (_req, res) => {
  res.redirect("/tools/screenshot-lab");
});

screenshotBrowserService.startBackground().catch(() => null);

app.listen(PORT, () => {
  const runtime = screenshotBrowserService.getRuntimeInfo();
  console.log(`Screenshot Lab standalone: http://localhost:${PORT}/tools/screenshot-lab`);
  console.log(
    `Persistent browser: enabled=${runtime.enabled ? "1" : "0"} running=${runtime.running ? "1" : "0"} profile=${runtime.profile_dir || "N/A"}`
  );
});
