import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT_DIR, "data");
const EVENTS_JSONL_FILE = "events.jsonl";
const EVENTS_LEGACY_FILE = "events.log";

export function getDataDir() {
  return DATA_DIR;
}

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function getDocDir(docId) {
  return path.join(DATA_DIR, docId);
}

export async function ensureDocDir(docId) {
  const dir = getDocDir(docId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, json, "utf8");
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) return null;
  return readJson(filePath);
}

export async function appendEvent(docId, event) {
  const dir = getDocDir(docId);
  const logPath = path.join(dir, EVENTS_LEGACY_FILE);
  const jsonlPath = path.join(dir, EVENTS_JSONL_FILE);
  const line = JSON.stringify(event);
  await Promise.all([
    fs.appendFile(logPath, `${line}\n`, "utf8"),
    fs.appendFile(jsonlPath, `${line}\n`, "utf8")
  ]);
}

export async function readEvents(docId) {
  const dir = getDocDir(docId);
  const jsonlPath = path.join(dir, EVENTS_JSONL_FILE);
  const logPath = path.join(dir, EVENTS_LEGACY_FILE);
  const targetPath = (await fileExists(jsonlPath)) ? jsonlPath : logPath;
  if (!(await fileExists(targetPath))) return [];
  const raw = await fs.readFile(targetPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: "invalid", raw: line };
      }
    });
}

async function listVersionFiles(dir, baseName) {
  if (!(await fileExists(dir))) return [];
  const entries = await fs.readdir(dir);
  const prefix = `${baseName}.v`;
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const match = name.match(/\.v(\d+)\.json$/);
      return { name, version: match ? Number(match[1]) : 0 };
    })
    .filter((item) => item.version > 0)
    .sort((a, b) => a.version - b.version);
}

export async function getNextVersion(dir, baseName) {
  const files = await listVersionFiles(dir, baseName);
  if (files.length === 0) return 1;
  return files[files.length - 1].version + 1;
}

export async function saveVersioned(docId, baseName, data) {
  const dir = getDocDir(docId);
  await fs.mkdir(dir, { recursive: true });
  const version = await getNextVersion(dir, baseName);
  const versionedPath = path.join(dir, `${baseName}.v${version}.json`);
  const currentPath = path.join(dir, `${baseName}.json`);
  await writeJson(versionedPath, data);
  await writeJson(currentPath, data);
  return version;
}

export async function listDocuments() {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const docs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const docDir = path.join(DATA_DIR, entry.name);
    const docPath = path.join(docDir, "document.json");
    if (!(await fileExists(docPath))) continue;
    try {
      const doc = await readJson(docPath);
      docs.push({ id: entry.name, ...doc });
    } catch {
      docs.push({ id: entry.name, raw_text: "", created_at: null });
    }
  }
  return docs.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
}
