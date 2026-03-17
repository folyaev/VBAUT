import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const { app, DEFAULT_PORT, getServerRuntimeInfo } = await import("./index.js");

app.listen(DEFAULT_PORT, () => {
  console.log(`Backend listening on http://localhost:${DEFAULT_PORT}`);
  const runtime = getServerRuntimeInfo();
  const tools = runtime.tools;
  console.log(`Media downloader: yt-dlp=${tools.yt_dlp_path || "N/A"} ffmpeg_location=${tools.ffmpeg_location || "N/A"}`);
  console.log(`Media root: ${runtime.mediaRoot}`);
  const telegram = runtime.telegram ?? {};
  console.log(
    `Telegram SDVG: enabled=${telegram.enabled ? "1" : "0"} running=${telegram.running ? "1" : "0"} bot=${telegram.bot_username || "N/A"}`
  );
  console.log(
    `Telegram SDVG API: mode=${telegram.official_api ? "cloud" : "local/custom"} api_base=${telegram.api_base || "N/A"} file_base=${telegram.file_base || "N/A"}`
  );
});
