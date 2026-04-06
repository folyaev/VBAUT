import React from "react";
import { LazySectionFallback } from "./LazySectionFallback.jsx";

const NewsOpsOverview = React.lazy(() =>
  import("./NewsOpsOverview.jsx").then((module) => ({ default: module.NewsOpsOverview }))
);
const NewsOpsStorageHealth = React.lazy(() =>
  import("./NewsOpsStorageHealth.jsx").then((module) => ({ default: module.NewsOpsStorageHealth }))
);
const NewsOpsOwnerDashboard = React.lazy(() =>
  import("./NewsOpsOwnerDashboard.jsx").then((module) => ({ default: module.NewsOpsOwnerDashboard }))
);
const NewsOpsSourceIntelligence = React.lazy(() =>
  import("./NewsOpsSourceIntelligence.jsx").then((module) => ({ default: module.NewsOpsSourceIntelligence }))
);

export function AppNewsOpsSection({
  integrationLoading,
  refreshIntegration,
  integrationOverview,
  integrationReleases,
  integrationBotSessions,
  segmentsNeedingVisual,
  sourceMemorySummary,
  releaseOutcomeMemorySummary,
  runtimeBackupsStatus,
  sqliteMirrorStatus,
  storageHealthHighlights,
  selectedReleaseId,
  selectedReleaseDetail,
  releaseControlPanel,
  releasePublishChecklist,
  releaseBriefingPanel,
  releaseActivity,
  formatDateTimeShort,
  handleOpenOwnerFocusRelease,
  handleOpenOwnerStorageHealth,
  handleOpenOwnerSourceIntelligence,
  handleOpenOwnerNeedsVisual,
  integrationAssets,
  formatAssetKindLabel,
  handleOpenSegmentScreenshotMode,
  sourceProfilesDirty,
  sourceProfilesDraft,
  updateSourceProfilesDraftField,
  sourceProfilesSaving,
  handleResetSourceProfilesDraft,
  handleSaveSourceProfiles,
  backupActionBusy,
  handleCreateRuntimeBackup,
  handleRestoreRuntimeBackup,
  selectedBackupSnapshotId,
  handleSelectBackupSnapshot,
  selectedBackupSnapshot,
  selectedBackupDryRun,
  formatBytes
}) {
  return (
    <section className="panel integration-panel">
      <div className="panel-header">
        <h2>News Ops</h2>
        <div className="panel-actions">
          <button className="btn ghost small" type="button" onClick={refreshIntegration} disabled={integrationLoading}>
            {integrationLoading ? "Обновление..." : "Обновить"}
          </button>
        </div>
      </div>
      <div className="integration-grid">
        <React.Suspense fallback={<LazySectionFallback label="Loading owner dashboard..." />}>
          <NewsOpsOwnerDashboard
            integrationOverview={integrationOverview}
            integrationReleases={integrationReleases}
            integrationBotSessions={integrationBotSessions}
            segmentsNeedingVisual={segmentsNeedingVisual}
            sourceMemorySummary={sourceMemorySummary}
            releaseOutcomeMemorySummary={releaseOutcomeMemorySummary}
            runtimeBackupsStatus={runtimeBackupsStatus}
            sqliteMirrorStatus={sqliteMirrorStatus}
            storageHealthHighlights={storageHealthHighlights}
            selectedReleaseId={selectedReleaseId}
            selectedReleaseDetail={selectedReleaseDetail}
            releaseControlPanel={releaseControlPanel}
            releasePublishChecklist={releasePublishChecklist}
            releaseBriefingPanel={releaseBriefingPanel}
            releaseActivity={releaseActivity}
            formatDateTimeShort={formatDateTimeShort}
            onOpenFocusRelease={handleOpenOwnerFocusRelease}
            onOpenStorageHealth={handleOpenOwnerStorageHealth}
            onOpenSourceIntelligence={handleOpenOwnerSourceIntelligence}
            onOpenNeedsVisual={handleOpenOwnerNeedsVisual}
          />
        </React.Suspense>
        <React.Suspense fallback={<LazySectionFallback label="Loading News Ops overview..." />}>
          <NewsOpsOverview
            integrationOverview={integrationOverview}
            integrationAssets={integrationAssets}
            integrationBotSessions={integrationBotSessions}
            integrationReleases={integrationReleases}
            segmentsNeedingVisual={segmentsNeedingVisual}
            formatAssetKindLabel={formatAssetKindLabel}
            formatDateTimeShort={formatDateTimeShort}
            handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
          />
        </React.Suspense>
        <React.Suspense fallback={<LazySectionFallback label="Loading source intelligence..." />}>
          <NewsOpsSourceIntelligence
            sourceProfilesDirty={sourceProfilesDirty}
            sourceProfilesDraft={sourceProfilesDraft}
            updateSourceProfilesDraftField={updateSourceProfilesDraftField}
            sourceProfilesSaving={sourceProfilesSaving}
            handleResetSourceProfilesDraft={handleResetSourceProfilesDraft}
            handleSaveSourceProfiles={handleSaveSourceProfiles}
            sourceMemorySummary={sourceMemorySummary}
            releaseOutcomeMemorySummary={releaseOutcomeMemorySummary}
            formatDateTimeShort={formatDateTimeShort}
          />
        </React.Suspense>
        <React.Suspense fallback={<LazySectionFallback label="Loading storage health..." />}>
          <NewsOpsStorageHealth
            runtimeBackupsStatus={runtimeBackupsStatus}
            sqliteMirrorStatus={sqliteMirrorStatus}
            storageHealthHighlights={storageHealthHighlights}
            backupActionBusy={backupActionBusy}
            handleCreateRuntimeBackup={handleCreateRuntimeBackup}
            handleRestoreRuntimeBackup={handleRestoreRuntimeBackup}
            selectedBackupSnapshotId={selectedBackupSnapshotId}
            handleSelectBackupSnapshot={handleSelectBackupSnapshot}
            selectedBackupSnapshot={selectedBackupSnapshot}
            selectedBackupDryRun={selectedBackupDryRun}
            formatBytes={formatBytes}
            formatDateTimeShort={formatDateTimeShort}
          />
        </React.Suspense>
      </div>
    </section>
  );
}
