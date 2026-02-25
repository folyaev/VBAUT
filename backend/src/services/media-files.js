import fs from "node:fs/promises";
import path from "node:path";

export function createMediaFilesUtils(options = {}) {
  const mediaRoot = String(options.mediaRoot ?? "");
  const mediaMaxFilesList = Number.isFinite(Number(options.mediaMaxFilesList))
    ? Math.max(20, Number(options.mediaMaxFilesList))
    : 500;

  function getMediaDir() {
    return mediaRoot;
  }

  async function ensureMediaDir(sectionTitle) {
    const root = getMediaDir();
    await fs.mkdir(root, { recursive: true });
    const topic = sanitizeMediaTopicName(sectionTitle);
    const dir = path.join(root, topic);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async function ensureMediaTopicFoldersForSegments(segments = []) {
    const normalized = Array.isArray(segments) ? segments : [];
    const seen = new Set();
    const ensured = [];
    await fs.mkdir(getMediaDir(), { recursive: true });
    for (const segment of normalized) {
      if (String(segment?.block_type ?? "").trim().toLowerCase() === "links") continue;
      const topic = sanitizeMediaTopicName(segment?.section_title ?? "");
      const key = topic.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      await ensureMediaDir(topic);
      ensured.push(topic);
    }
    return ensured;
  }

  function safeResolveMediaPath(mediaDir, relativePath) {
    const clean = String(relativePath ?? "").replace(/^[/\\]+/, "");
    if (!clean) return "";
    const base = path.resolve(mediaDir);
    const target = path.resolve(mediaDir, clean);
    if (target === base) return "";
    if (!target.startsWith(`${base}${path.sep}`)) return "";
    return target;
  }

  async function listMediaFiles() {
    const mediaDir = getMediaDir();
    const exists = await fs
      .access(mediaDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];

    const files = [];
    const stack = [""];
    while (stack.length > 0 && files.length < mediaMaxFilesList) {
      const currentRel = stack.pop();
      const currentDir = currentRel ? path.join(mediaDir, currentRel) : mediaDir;
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (files.length >= mediaMaxFilesList) break;
        const relPath = currentRel ? path.join(currentRel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          stack.push(relPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (shouldHideMediaFile(entry.name)) continue;
        const absolutePath = path.join(mediaDir, relPath);
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (!stats || !stats.isFile()) continue;
        const normalizedRel = relPath.split(path.sep).join("/");
        files.push({
          path: normalizedRel,
          name: entry.name,
          size: stats.size,
          updated_at: stats.mtime?.toISOString?.() ?? null
        });
      }
    }
    return files.sort((a, b) => {
      const left = a.updated_at ?? "";
      const right = b.updated_at ?? "";
      return left > right ? -1 : 1;
    });
  }

  function shouldHideMediaFile(fileName) {
    const normalized = String(fileName ?? "").trim().toLowerCase();
    if (!normalized) return true;
    if (normalized.includes("newfile")) return true;
    if (normalized.endsWith(".txt")) return true;
    if (normalized.endsWith(".db")) return true;
    if (normalized.endsWith(".py")) return true;
    if (normalized.endsWith(".sqlite")) return true;
    if (normalized.endsWith(".sqlite-shm")) return true;
    if (normalized.endsWith(".sqlite-wal")) return true;
    return false;
  }

  function sanitizeMediaTopicName(rawTitle) {
    const fallbackTopic = "Без темы";
    const value = String(rawTitle ?? "").trim();
    if (!value) return fallbackTopic;

    const replaced = value
      .replace(/[\u0000-\u001f<>:\"/\\|?*]+/g, " ")
      .replace(/\(\s*\d+\s*\)\s*$/g, " ")
      .replace(/\(\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");

    const normalized = replaced || fallbackTopic;
    const clipped = normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
    if (!clipped) return fallbackTopic;

    const upper = clipped.toUpperCase();
    const reserved = new Set([
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM2",
      "COM3",
      "COM4",
      "COM5",
      "COM6",
      "COM7",
      "COM8",
      "COM9",
      "LPT1",
      "LPT2",
      "LPT3",
      "LPT4",
      "LPT5",
      "LPT6",
      "LPT7",
      "LPT8",
      "LPT9"
    ]);
    return reserved.has(upper) ? `_${clipped}` : clipped;
  }
  return {
    ensureMediaDir,
    ensureMediaTopicFoldersForSegments,
    getMediaDir,
    listMediaFiles,
    safeResolveMediaPath,
    sanitizeMediaTopicName
  };
}

