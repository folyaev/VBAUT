import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST_FILE_NAME = "manifest.json";
const RESTORE_HISTORY_FILE_NAME = "restore-history.json";

function safeText(value) {
  return String(value ?? "").trim();
}

function sanitizeLabel(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function createBackupId(label = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const normalizedLabel = sanitizeLabel(label);
  return normalizedLabel ? `${stamp}-${normalizedLabel}` : stamp;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalJson(filePath) {
  if (!(await exists(filePath))) return null;
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function statOptional(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export function createRuntimeBackupsService({
  dataDir,
  checkpointSqliteMirror = null,
  getSqliteMirrorStatus = null,
  beforeRestore = null,
  afterRestore = null
}) {
  const backupsDir = path.join(dataDir, "_backups");
  const keepCount = Math.max(1, Number(process.env.RUNTIME_BACKUPS_KEEP_COUNT ?? 8) || 8);
  const autoBackupEnabled = String(process.env.RUNTIME_AUTO_BACKUP_ENABLED ?? "1") !== "0";

  async function ensureBackupsDir() {
    await fs.mkdir(backupsDir, { recursive: true });
    return backupsDir;
  }

  function getBackupManifestPath(backupId) {
    return path.join(backupsDir, backupId, MANIFEST_FILE_NAME);
  }

  function getRestoreHistoryPath() {
    return path.join(backupsDir, RESTORE_HISTORY_FILE_NAME);
  }

  function getBackupDir(backupId) {
    return path.join(backupsDir, safeText(backupId));
  }

  async function buildInventory(rootDir, { excludeTopLevel = [], excludeRelative = [] } = {}) {
    const topLevelExcludes = new Set(excludeTopLevel.map((item) => safeText(item)).filter(Boolean));
    const relativeExcludes = new Set(excludeRelative.map((item) => safeText(item)).filter(Boolean));
    const items = [];

    async function walk(currentDir, prefix = "") {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!prefix && topLevelExcludes.has(entry.name)) continue;
        const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
        if (relativeExcludes.has(relativePath)) continue;
        const absolutePath = path.join(currentDir, entry.name);
        const stats = await statOptional(absolutePath);
        if (!stats) continue;
        items.push({
          relative_path: relativePath,
          type: entry.isDirectory() ? "dir" : "file",
          size: Number(stats.size ?? 0),
          mtime: String(stats.mtime?.toISOString?.() ?? "")
        });
        if (entry.isDirectory()) {
          await walk(absolutePath, relativePath);
        }
      }
    }

    await walk(rootDir);
    items.sort((a, b) => String(a.relative_path).localeCompare(String(b.relative_path)));
    return items;
  }

  async function listBackups() {
    await ensureBackupsDir();
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await readOptionalJson(getBackupManifestPath(entry.name)).catch(() => null);
      if (!manifest || typeof manifest !== "object") continue;
      backups.push(manifest);
    }
    backups.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return backups;
  }

  async function readRestoreHistory() {
    await ensureBackupsDir();
    const payload = await readOptionalJson(getRestoreHistoryPath()).catch(() => null);
    const entries = Array.isArray(payload?.entries) ? payload.entries : Array.isArray(payload) ? payload : [];
    return entries
      .filter((item) => item && typeof item === "object")
      .sort((a, b) => String(b.restored_at ?? "").localeCompare(String(a.restored_at ?? "")));
  }

  async function writeRestoreHistory(entries = []) {
    await ensureBackupsDir();
    await writeJson(getRestoreHistoryPath(), {
      entries: entries.slice(0, 25),
      updated_at: new Date().toISOString()
    });
  }

  async function pruneBackups() {
    const backups = await listBackups();
    const removable = backups.slice(keepCount);
    await Promise.all(
      removable.map((item) =>
        fs.rm(path.join(backupsDir, String(item?.backup_id ?? "").trim()), {
          recursive: true,
          force: true
        })
      )
    );
    return {
      removed: removable.map((item) => String(item?.backup_id ?? "").trim()).filter(Boolean),
      kept: backups.slice(0, keepCount).map((item) => String(item?.backup_id ?? "").trim()).filter(Boolean)
    };
  }

  async function createBackup(options = {}) {
    await ensureBackupsDir();
    const checkpoint =
      typeof checkpointSqliteMirror === "function"
        ? await Promise.resolve(checkpointSqliteMirror("PASSIVE")).catch(() => null)
        : null;
    const backupId = createBackupId(options?.label);
    const backupDir = path.join(backupsDir, backupId);
    await fs.mkdir(backupDir, { recursive: true });

    const sourceEntries = await fs.readdir(dataDir, { withFileTypes: true });
    const copied = [];
    for (const entry of sourceEntries) {
      if (entry.name === "_backups") continue;
      const sourcePath = path.join(dataDir, entry.name);
      const destinationPath = path.join(backupDir, entry.name);
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
      copied.push({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      });
    }

    const sqlite = typeof getSqliteMirrorStatus === "function" ? await Promise.resolve(getSqliteMirrorStatus()).catch(() => null) : null;
    const manifest = {
      backup_id: backupId,
      label: sanitizeLabel(options?.label),
      created_at: new Date().toISOString(),
      source_data_dir: dataDir,
      backup_dir: backupDir,
      keep_count: keepCount,
      copied_entries: copied,
      sqlite,
      checkpoint
    };
    await writeJson(path.join(backupDir, MANIFEST_FILE_NAME), manifest);
    const pruneResult = await pruneBackups();
    return {
      ...manifest,
      pruned: pruneResult.removed
    };
  }

  async function getStatus() {
    const backups = await listBackups();
    const restoreHistory = await readRestoreHistory();
    return {
      backup_dir: backupsDir,
      keep_count: keepCount,
      auto_backup_enabled: autoBackupEnabled,
      total_backups: backups.length,
      latest: backups[0] ?? null,
      backups: backups.slice(0, keepCount),
      latest_restore: restoreHistory[0] ?? null,
      restore_history: restoreHistory.slice(0, 10)
    };
  }

  async function getBackupById(backupId) {
    const normalizedBackupId = safeText(backupId);
    if (!normalizedBackupId) return null;
    const manifest = await readOptionalJson(getBackupManifestPath(normalizedBackupId)).catch(() => null);
    if (!manifest || typeof manifest !== "object") return null;
    const backupDir = getBackupDir(normalizedBackupId);
    const inventory = await buildInventory(backupDir, { excludeRelative: [MANIFEST_FILE_NAME] }).catch(() => []);
    const summary = {
      total_items: inventory.length,
      files: inventory.filter((item) => item.type === "file").length,
      directories: inventory.filter((item) => item.type === "dir").length,
      total_bytes: inventory.reduce((sum, item) => sum + Number(item.size ?? 0), 0)
    };
    return {
      manifest,
      summary,
      inventory: inventory.slice(0, 250)
    };
  }

  async function dryRunRestore(backupId) {
    const normalizedBackupId = safeText(backupId);
    if (!normalizedBackupId) throw new Error("backup_id is required");
    const backupDir = getBackupDir(normalizedBackupId);
    const manifest = await readOptionalJson(getBackupManifestPath(normalizedBackupId)).catch(() => null);
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Backup not found");
    }
    const [backupInventory, liveInventory] = await Promise.all([
      buildInventory(backupDir, { excludeRelative: [MANIFEST_FILE_NAME] }),
      buildInventory(dataDir, { excludeTopLevel: ["_backups"] })
    ]);
    const backupMap = new Map(backupInventory.map((item) => [item.relative_path, item]));
    const liveMap = new Map(liveInventory.map((item) => [item.relative_path, item]));

    const missingInLive = [];
    const missingInBackup = [];
    const changed = [];

    for (const [relativePath, backupItem] of backupMap.entries()) {
      const liveItem = liveMap.get(relativePath);
      if (!liveItem) {
        missingInLive.push(relativePath);
        continue;
      }
      if (backupItem.type !== liveItem.type || Number(backupItem.size ?? 0) !== Number(liveItem.size ?? 0)) {
        changed.push({
          relative_path: relativePath,
          backup_type: backupItem.type,
          live_type: liveItem.type,
          backup_size: Number(backupItem.size ?? 0),
          live_size: Number(liveItem.size ?? 0)
        });
      }
    }

    for (const [relativePath] of liveMap.entries()) {
      if (!backupMap.has(relativePath)) {
        missingInBackup.push(relativePath);
      }
    }

    return {
      backup_id: normalizedBackupId,
      created_at: String(manifest?.created_at ?? "").trim(),
      summary: {
        backup_items: backupInventory.length,
        live_items: liveInventory.length,
        missing_in_live: missingInLive.length,
        missing_in_backup: missingInBackup.length,
        changed: changed.length
      },
      restore_plan: {
        would_restore: missingInLive.slice(0, 80),
        would_overwrite: changed.slice(0, 80),
        live_only: missingInBackup.slice(0, 80)
      }
    };
  }

  async function restoreBackup(backupId, options = {}) {
    const normalizedBackupId = safeText(backupId);
    if (!normalizedBackupId) throw new Error("backup_id is required");
    const backupDir = getBackupDir(normalizedBackupId);
    const manifest = await readOptionalJson(getBackupManifestPath(normalizedBackupId)).catch(() => null);
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Backup not found");
    }

    if (typeof beforeRestore === "function") {
      await Promise.resolve(beforeRestore({ backupId: normalizedBackupId, backupDir, manifest }));
    }

    const backupEntries = await fs.readdir(backupDir, { withFileTypes: true });
    const restorableEntries = backupEntries.filter((entry) => entry.name !== MANIFEST_FILE_NAME);
    const restorableNames = new Set(restorableEntries.map((entry) => entry.name));

    const liveEntries = await fs.readdir(dataDir, { withFileTypes: true });
    const removedEntries = [];
    for (const entry of liveEntries) {
      if (entry.name === "_backups") continue;
      if (restorableNames.has(entry.name)) continue;
      await fs.rm(path.join(dataDir, entry.name), { recursive: true, force: true });
      removedEntries.push(entry.name);
    }

    const restoredEntries = [];
    for (const entry of restorableEntries) {
      const sourcePath = path.join(backupDir, entry.name);
      const destinationPath = path.join(dataDir, entry.name);
      await fs.rm(destinationPath, { recursive: true, force: true });
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
      restoredEntries.push({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      });
    }

    const restoreMeta = {
      backup_id: normalizedBackupId,
      created_at: String(manifest?.created_at ?? "").trim(),
      restored_at: new Date().toISOString(),
      restored_entries: restoredEntries,
      removed_entries: removedEntries
    };

    if (typeof afterRestore === "function") {
      restoreMeta.sync = await Promise.resolve(afterRestore({ backupId: normalizedBackupId, backupDir, manifest, restoreMeta }));
    }

    const historyEntry = {
      restore_id: createBackupId("restore"),
      backup_id: normalizedBackupId,
      backup_created_at: String(manifest?.created_at ?? "").trim(),
      restored_at: restoreMeta.restored_at,
      pre_restore_backup_id: safeText(options?.pre_restore_backup_id),
      restored_entries_count: restoredEntries.length,
      removed_entries_count: removedEntries.length,
      sync: restoreMeta.sync ?? null
    };
    const nextHistory = [historyEntry, ...(await readRestoreHistory())];
    await writeRestoreHistory(nextHistory);
    restoreMeta.history_entry = historyEntry;

    return restoreMeta;
  }

  return {
    backupsDir,
    keepCount,
    ensureBackupsDir,
    listBackups,
    createBackup,
    getStatus,
    getBackupById,
    dryRunRestore,
    restoreBackup
  };
}
