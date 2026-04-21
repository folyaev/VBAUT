import fs from "node:fs/promises";
import path from "node:path";

const mediaRoot = path.resolve(process.env.MEDIA_ROOT || "C:\\Users\\Nemifist\\YandexDisk\\PAMPAM");
const unsortedDir = path.join(mediaRoot, "UNSORTED");
const excludedDirs = new Set(["UNSORTED", "ARCHIVE_PROJECTS"]);

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listThemeDirs() {
  const entries = await fs.readdir(mediaRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => String(entry.name ?? "").trim())
    .filter((name) => name && !excludedDirs.has(name))
    .map((name) => path.join(mediaRoot, name));
}

async function listUnsortedFiles() {
  const result = [];
  async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Cache") continue;
        await walk(absolutePath);
        continue;
      }
      if (entry.name === ".yt-dlp-archive.txt") continue;
      result.push(absolutePath);
    }
  }
  if (await fileExists(unsortedDir)) {
    await walk(unsortedDir);
  }
  return result;
}

async function findMatchingThemeCopy(filePath, themeDirs) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile?.()) return null;
  const fileName = path.basename(filePath);
  for (const themeDir of themeDirs) {
    const stack = [themeDir];
    while (stack.length > 0) {
      const currentDir = stack.pop();
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }
        if (entry.name !== fileName) continue;
        const candidateStat = await fs.stat(absolutePath).catch(() => null);
        if (candidateStat?.isFile?.() && Number(candidateStat.size ?? -1) === Number(stat.size ?? -2)) {
          return absolutePath;
        }
      }
    }
  }
  return null;
}

async function main() {
  const themeDirs = await listThemeDirs();
  const unsortedFiles = await listUnsortedFiles();
  const removed = [];
  for (const filePath of unsortedFiles) {
    const match = await findMatchingThemeCopy(filePath, themeDirs);
    if (!match) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    await fs.unlink(filePath).catch(() => null);
    removed.push({
      removed: filePath,
      kept: match,
      bytes: Number(stat?.size ?? 0)
    });
  }
  process.stdout.write(JSON.stringify({
    media_root: mediaRoot,
    removed_count: removed.length,
    removed
  }, null, 2));
}

await main();
