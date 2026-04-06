import React from "react";

export function useIntegrationWorkspace({
  fetchJsonSafe,
  setStatus,
  buildSourceProfilesDraft,
  parseDomainListFromTextarea,
  refreshIntervalMs = 15000
}) {
  const [integrationOverview, setIntegrationOverview] = React.useState(null);
  const [integrationAssets, setIntegrationAssets] = React.useState([]);
  const [integrationReleases, setIntegrationReleases] = React.useState([]);
  const [integrationBotSessions, setIntegrationBotSessions] = React.useState([]);
  const [integrationLoading, setIntegrationLoading] = React.useState(false);
  const [sqliteMirrorStatus, setSqliteMirrorStatus] = React.useState(null);
  const [runtimeBackupsStatus, setRuntimeBackupsStatus] = React.useState(null);
  const [selectedBackupSnapshotId, setSelectedBackupSnapshotId] = React.useState("");
  const [selectedBackupSnapshot, setSelectedBackupSnapshot] = React.useState(null);
  const [selectedBackupDryRun, setSelectedBackupDryRun] = React.useState(null);
  const [backupActionBusy, setBackupActionBusy] = React.useState(false);
  const [lastAssistantAutoBackup, setLastAssistantAutoBackup] = React.useState(null);
  const [sourceMemorySummary, setSourceMemorySummary] = React.useState(null);
  const [releaseOutcomeMemorySummary, setReleaseOutcomeMemorySummary] = React.useState(null);
  const [sourceProfiles, setSourceProfiles] = React.useState(null);
  const [sourceProfilesDraft, setSourceProfilesDraft] = React.useState(() => buildSourceProfilesDraft({}));
  const [sourceProfilesDirty, setSourceProfilesDirty] = React.useState(false);
  const [sourceProfilesSaving, setSourceProfilesSaving] = React.useState(false);

  const refreshIntegration = React.useCallback(async () => {
    setIntegrationLoading(true);
    try {
      const [
        overviewResult,
        assetsResult,
        releasesResult,
        sessionsResult,
        sqliteStatusResult,
        backupsStatusResult,
        sourceProfilesResult,
        sourceMemoryResult,
        releaseOutcomeMemoryResult
      ] = await Promise.all([
        fetchJsonSafe("/api/integration/overview"),
        fetchJsonSafe("/api/assets?limit=80"),
        fetchJsonSafe("/api/releases"),
        fetchJsonSafe("/api/bot/sessions"),
        fetchJsonSafe("/api/integration/sqlite/status"),
        fetchJsonSafe("/api/integration/backups/status"),
        fetchJsonSafe("/api/source-profiles"),
        fetchJsonSafe("/api/source-memory"),
        fetchJsonSafe("/api/release-outcome-memory")
      ]);

      if (overviewResult.response.ok) {
        setIntegrationOverview(overviewResult.data ?? null);
      }
      if (assetsResult.response.ok) {
        setIntegrationAssets(Array.isArray(assetsResult.data?.assets) ? assetsResult.data.assets : []);
      }
      if (releasesResult.response.ok) {
        setIntegrationReleases(Array.isArray(releasesResult.data?.releases) ? releasesResult.data.releases : []);
      }
      if (sessionsResult.response.ok) {
        setIntegrationBotSessions(Array.isArray(sessionsResult.data?.sessions) ? sessionsResult.data.sessions : []);
      }
      if (sqliteStatusResult.response.ok) {
        setSqliteMirrorStatus(sqliteStatusResult.data?.sqlite ?? null);
      }
      let nextSelectedBackupId = "";
      if (backupsStatusResult.response.ok) {
        const nextBackupsStatus = backupsStatusResult.data?.backups ?? null;
        setRuntimeBackupsStatus(nextBackupsStatus);
        const backupItems = Array.isArray(nextBackupsStatus?.backups) ? nextBackupsStatus.backups : [];
        const preferredBackupId = String(selectedBackupSnapshotId ?? "").trim();
        nextSelectedBackupId =
          (preferredBackupId && backupItems.some((item) => String(item?.backup_id ?? "").trim() === preferredBackupId)
            ? preferredBackupId
            : String(nextBackupsStatus?.latest?.backup_id ?? backupItems[0]?.backup_id ?? "").trim()) || "";
        setSelectedBackupSnapshotId(nextSelectedBackupId);
      } else {
        setRuntimeBackupsStatus(null);
        setSelectedBackupSnapshotId("");
        setSelectedBackupSnapshot(null);
        setSelectedBackupDryRun(null);
      }
      if (sourceProfilesResult.response.ok) {
        const profiles = sourceProfilesResult.data?.profiles ?? null;
        setSourceProfiles(profiles);
        setSourceProfilesDraft((prev) => (sourceProfilesDirty ? prev : buildSourceProfilesDraft(profiles ?? {})));
      }
      if (sourceMemoryResult.response.ok) {
        setSourceMemorySummary(sourceMemoryResult.data?.summary ?? null);
      }
      if (releaseOutcomeMemoryResult.response.ok) {
        setReleaseOutcomeMemorySummary(releaseOutcomeMemoryResult.data?.summary ?? null);
      }

      if (nextSelectedBackupId) {
        const [backupInspectResult, backupDryRunResult] = await Promise.all([
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(nextSelectedBackupId)}`),
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(nextSelectedBackupId)}/restore-dry-run`, {
            method: "POST"
          })
        ]);
        if (backupInspectResult.response.ok) {
          setSelectedBackupSnapshot(backupInspectResult.data?.backup ?? null);
        } else {
          setSelectedBackupSnapshot(null);
        }
        if (backupDryRunResult.response.ok) {
          setSelectedBackupDryRun(backupDryRunResult.data?.dry_run ?? null);
        } else {
          setSelectedBackupDryRun(null);
        }
      }
    } catch {
      setIntegrationOverview(null);
      setIntegrationAssets([]);
      setIntegrationReleases([]);
      setIntegrationBotSessions([]);
      setSqliteMirrorStatus(null);
      setRuntimeBackupsStatus(null);
      setSelectedBackupSnapshot(null);
      setSelectedBackupDryRun(null);
      setSourceMemorySummary(null);
      setReleaseOutcomeMemorySummary(null);
      setSourceProfiles(null);
    } finally {
      setIntegrationLoading(false);
    }
  }, [buildSourceProfilesDraft, fetchJsonSafe, selectedBackupSnapshotId, sourceProfilesDirty]);

  const updateSourceProfilesDraftField = React.useCallback((field, value) => {
    setSourceProfilesDraft((prev) => ({
      ...prev,
      [field]: value
    }));
    setSourceProfilesDirty(true);
  }, []);

  const handleResetSourceProfilesDraft = React.useCallback(() => {
    setSourceProfilesDraft(buildSourceProfilesDraft(sourceProfiles ?? {}));
    setSourceProfilesDirty(false);
    setStatus("Source profiles reset to saved values.");
  }, [buildSourceProfilesDraft, setStatus, sourceProfiles]);

  const handleSaveSourceProfiles = React.useCallback(async () => {
    try {
      setSourceProfilesSaving(true);
      const domainProfiles = JSON.parse(String(sourceProfilesDraft.domain_profiles_json ?? "{}") || "{}");
      const channelProfiles = JSON.parse(String(sourceProfilesDraft.channel_profiles_json ?? "{}") || "{}");
      const payload = {
        version: Number(sourceProfiles?.version ?? 1) || 1,
        trusted_domains: parseDomainListFromTextarea(sourceProfilesDraft.trusted_domains),
        blocked_domains: parseDomainListFromTextarea(sourceProfilesDraft.blocked_domains),
        video_platform_domains: parseDomainListFromTextarea(sourceProfilesDraft.video_platform_domains),
        social_domains: parseDomainListFromTextarea(sourceProfilesDraft.social_domains),
        downloadable_domains: parseDomainListFromTextarea(sourceProfilesDraft.downloadable_domains),
        screenshot_friendly_domains: parseDomainListFromTextarea(sourceProfilesDraft.screenshot_friendly_domains),
        domain_profiles:
          domainProfiles && typeof domainProfiles === "object" && !Array.isArray(domainProfiles) ? domainProfiles : {},
        channel_profiles:
          channelProfiles && typeof channelProfiles === "object" && !Array.isArray(channelProfiles) ? channelProfiles : {}
      };
      const { response, data } = await fetchJsonSafe("/api/source-profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles: payload })
      });
      if (!response.ok) throw new Error(data?.error ?? "Failed to save source profiles");
      const nextProfiles = data?.profiles ?? null;
      setSourceProfiles(nextProfiles);
      setSourceProfilesDraft(buildSourceProfilesDraft(nextProfiles ?? {}));
      setSourceProfilesDirty(false);
      setStatus("Source profiles saved.");
    } catch (error) {
      setStatus(error?.message ?? "Failed to save source profiles");
    } finally {
      setSourceProfilesSaving(false);
    }
  }, [buildSourceProfilesDraft, fetchJsonSafe, parseDomainListFromTextarea, setStatus, sourceProfiles, sourceProfilesDraft]);

  const handleSelectBackupSnapshot = React.useCallback(
    async (backupId) => {
      const normalizedId = String(backupId ?? "").trim();
      setSelectedBackupSnapshotId(normalizedId);
      if (!normalizedId) {
        setSelectedBackupSnapshot(null);
        setSelectedBackupDryRun(null);
        return;
      }
      try {
        setBackupActionBusy(true);
        const [backupInspectResult, backupDryRunResult] = await Promise.all([
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(normalizedId)}`),
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(normalizedId)}/restore-dry-run`, {
            method: "POST"
          })
        ]);
        if (!backupInspectResult.response.ok) {
          throw new Error(backupInspectResult.data?.error ?? "Failed to load backup snapshot");
        }
        if (!backupDryRunResult.response.ok) {
          throw new Error(backupDryRunResult.data?.error ?? "Failed to load backup dry-run");
        }
        setSelectedBackupSnapshot(backupInspectResult.data?.backup ?? null);
        setSelectedBackupDryRun(backupDryRunResult.data?.dry_run ?? null);
      } catch (error) {
        setSelectedBackupSnapshot(null);
        setSelectedBackupDryRun(null);
        setStatus(error?.message ?? "Failed to load backup snapshot");
      } finally {
        setBackupActionBusy(false);
      }
    },
    [fetchJsonSafe, setStatus]
  );

  const handleCreateRuntimeBackup = React.useCallback(async () => {
    try {
      setBackupActionBusy(true);
      const { response, data } = await fetchJsonSafe("/api/integration/backups/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "manual" })
      });
      if (!response.ok) throw new Error(data?.error ?? "Failed to create backup");
      const backupId = String(data?.backup?.backup_id ?? "").trim();
      await refreshIntegration();
      if (backupId) {
        await handleSelectBackupSnapshot(backupId);
      }
      setStatus(`Backup created: ${backupId || "ok"}`);
    } catch (error) {
      setStatus(error?.message ?? "Failed to create backup");
    } finally {
      setBackupActionBusy(false);
    }
  }, [fetchJsonSafe, handleSelectBackupSnapshot, refreshIntegration, setStatus]);

  const handleRestoreRuntimeBackup = React.useCallback(
    async (backupId) => {
      const normalizedId = String(backupId ?? selectedBackupSnapshotId ?? "").trim();
      if (!normalizedId) return;
      try {
        setBackupActionBusy(true);
        const { response, data } = await fetchJsonSafe(
          `/api/integration/backups/${encodeURIComponent(normalizedId)}/restore`,
          {
            method: "POST"
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Failed to restore backup");
        await refreshIntegration();
        await handleSelectBackupSnapshot(normalizedId);
        const preRestoreId = String(data?.pre_restore_backup?.backup_id ?? "").trim();
        setStatus(
          preRestoreId
            ? `Backup restored: ${normalizedId} · safety snapshot ${preRestoreId}`
            : `Backup restored: ${normalizedId}`
        );
      } catch (error) {
        setStatus(error?.message ?? "Failed to restore backup");
      } finally {
        setBackupActionBusy(false);
      }
    },
    [fetchJsonSafe, handleSelectBackupSnapshot, refreshIntegration, selectedBackupSnapshotId, setStatus]
  );

  const rememberAssistantAutoBackup = React.useCallback((autoBackup, contextLabel = "assistant action") => {
    const backupId = String(autoBackup?.backup_id ?? "").trim();
    if (!backupId) return "";
    setLastAssistantAutoBackup({
      backup_id: backupId,
      created_at: String(autoBackup?.created_at ?? "").trim(),
      label: String(contextLabel ?? "").trim() || "assistant action"
    });
    return backupId;
  }, []);

  React.useEffect(() => {
    refreshIntegration();
  }, [refreshIntegration]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      refreshIntegration();
    }, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [refreshIntegration, refreshIntervalMs]);

  return {
    integrationOverview,
    integrationAssets,
    integrationReleases,
    integrationBotSessions,
    integrationLoading,
    sqliteMirrorStatus,
    runtimeBackupsStatus,
    selectedBackupSnapshotId,
    selectedBackupSnapshot,
    selectedBackupDryRun,
    backupActionBusy,
    lastAssistantAutoBackup,
    sourceMemorySummary,
    releaseOutcomeMemorySummary,
    sourceProfiles,
    sourceProfilesDraft,
    sourceProfilesDirty,
    sourceProfilesSaving,
    refreshIntegration,
    updateSourceProfilesDraftField,
    handleResetSourceProfilesDraft,
    handleSaveSourceProfiles,
    handleSelectBackupSnapshot,
    handleCreateRuntimeBackup,
    handleRestoreRuntimeBackup,
    rememberAssistantAutoBackup
  };
}
