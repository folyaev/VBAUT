import React from "react";

export function NewsOpsStorageHealth({
  runtimeBackupsStatus,
  sqliteMirrorStatus,
  storageHealthHighlights,
  backupActionBusy,
  handleCreateRuntimeBackup,
  handleRestoreRuntimeBackup,
  selectedBackupSnapshotId,
  handleSelectBackupSnapshot,
  selectedBackupSnapshot,
  selectedBackupDryRun,
  formatBytes,
  formatDateTimeShort
}) {
  return (
    <div className="integration-card storage-health-card">
      <div className="integration-card-head">
        <strong>Storage Health</strong>
        <span>{runtimeBackupsStatus?.total_backups ?? 0} backups</span>
      </div>
      <div className="source-memory-summary-line">
        {`SQLite ${formatBytes(sqliteMirrorStatus?.db_size_bytes ?? 0)}${
          Number(sqliteMirrorStatus?.wal_size_bytes ?? 0) ? ` | WAL ${formatBytes(sqliteMirrorStatus?.wal_size_bytes ?? 0)}` : ""
        }`}
      </div>
      <div className="source-memory-recent">
        {`Last sync: ${formatDateTimeShort(sqliteMirrorStatus?.last_sync_at) || "n/a"}${
          sqliteMirrorStatus?.last_reason ? ` | ${sqliteMirrorStatus.last_reason}` : ""
        }`}
      </div>
      <div className="source-memory-recent">
        {`Auto-backup: ${
          runtimeBackupsStatus?.auto_backup_enabled === false ? "OFF" : "ON"
        } | retention ${runtimeBackupsStatus?.keep_count ?? 0}`}
      </div>
      {runtimeBackupsStatus?.latest_restore ? (
        <div className="source-memory-recent">
          {`Last restore: ${formatDateTimeShort(runtimeBackupsStatus.latest_restore.restored_at) || "n/a"}${
            runtimeBackupsStatus.latest_restore.backup_id
              ? ` | ${runtimeBackupsStatus.latest_restore.backup_id}`
              : ""
          }`}
        </div>
      ) : null}
      {storageHealthHighlights.length ? (
        <div className="integration-list">
          {storageHealthHighlights.map((item, index) => (
            <div key={`storage-health-${index}`} className="muted source-memory-recent">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      <div className="source-profiles-actions">
        <button
          className="btn small"
          type="button"
          onClick={handleCreateRuntimeBackup}
          disabled={backupActionBusy}
        >
          {backupActionBusy ? "Creating..." : "Create Backup"}
        </button>
      </div>
      {runtimeBackupsStatus?.backups?.length ? (
        <div className="integration-list">
          {runtimeBackupsStatus.backups.slice(0, 5).map((item) => {
            const backupId = String(item?.backup_id ?? "").trim();
            return (
              <div key={`backup-${backupId}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{backupId || "backup"}</strong>
                  <span>{formatDateTimeShort(item?.created_at) || "no timestamp"}</span>
                </div>
                <div className="integration-row-side">
                  <span>{Array.isArray(item?.copied_entries) ? `${item.copied_entries.length} entries` : "snapshot"}</span>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleSelectBackupSnapshot(backupId)}
                    disabled={backupActionBusy}
                  >
                    {selectedBackupSnapshotId === backupId ? "Selected" : "Inspect"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="muted">Runtime backups not created yet.</div>
      )}
      {selectedBackupSnapshot ? (
        <div className="integration-list">
          <div className="integration-row">
            <div className="integration-row-main">
              <strong>Selected Snapshot</strong>
              <span>{String(selectedBackupSnapshot?.manifest?.backup_id ?? "").trim()}</span>
            </div>
            <div className="integration-row-side">
              <span>
                {`${selectedBackupSnapshot?.summary?.files ?? 0} files | ${formatBytes(
                  selectedBackupSnapshot?.summary?.total_bytes ?? 0
                )}`}
              </span>
              <code>{selectedBackupSnapshot?.manifest?.backup_dir || "backup dir"}</code>
            </div>
          </div>
          {selectedBackupDryRun?.summary ? (
            <div className="muted source-memory-recent">
              {`Dry-run | restore ${selectedBackupDryRun.summary.missing_in_live} | overwrite ${selectedBackupDryRun.summary.changed} | live-only ${selectedBackupDryRun.summary.missing_in_backup}`}
            </div>
          ) : null}
          {selectedBackupDryRun?.restore_plan?.would_restore?.length ? (
            <div className="muted source-memory-recent">
              {`Would restore: ${selectedBackupDryRun.restore_plan.would_restore.slice(0, 3).join(" | ")}`}
            </div>
          ) : null}
          {selectedBackupDryRun?.restore_plan?.would_overwrite?.length ? (
            <div className="muted source-memory-recent">
              {`Would overwrite: ${selectedBackupDryRun.restore_plan.would_overwrite
                .slice(0, 2)
                .map((item) => item.relative_path)
                .join(" | ")}`}
            </div>
          ) : null}
          <div className="source-profiles-actions">
            <button
              className="btn small danger"
              type="button"
              onClick={() => handleRestoreRuntimeBackup?.(selectedBackupSnapshot?.manifest?.backup_id)}
              disabled={backupActionBusy || !String(selectedBackupSnapshot?.manifest?.backup_id ?? "").trim()}
            >
              {backupActionBusy ? "Restoring..." : "Restore Snapshot"}
            </button>
          </div>
        </div>
      ) : null}
      {runtimeBackupsStatus?.restore_history?.length ? (
        <div className="integration-list">
          <div className="integration-row">
            <div className="integration-row-main">
              <strong>Restore History</strong>
              <span>{runtimeBackupsStatus.restore_history.length} recent</span>
            </div>
          </div>
          {runtimeBackupsStatus.restore_history.slice(0, 5).map((item) => {
            const restoreId = String(item?.restore_id ?? item?.restored_at ?? "").trim();
            return (
              <div key={`restore-history-${restoreId}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{String(item?.backup_id ?? "restore").trim()}</strong>
                  <span>{formatDateTimeShort(item?.restored_at) || "no timestamp"}</span>
                </div>
                <div className="integration-row-side">
                  <span>{`${item?.restored_entries_count ?? 0} restored | ${item?.removed_entries_count ?? 0} removed`}</span>
                  {item?.pre_restore_backup_id ? <code>{item.pre_restore_backup_id}</code> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
