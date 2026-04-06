import React from "react";
import { ReleaseWorkspaceBoard } from "./ReleaseWorkspaceBoard.jsx";
import { ReleaseWorkspaceOverview } from "./ReleaseWorkspaceOverview.jsx";
import { ReleaseWorkspaceRundown } from "./ReleaseWorkspaceRundown.jsx";
import { ReleaseWorkspaceTimeline } from "./ReleaseWorkspaceTimeline.jsx";

export function ReleaseWorkspace({
  selectedReleaseDetail,
  releaseBusy,
  handleUpdateRelease,
  handleExportReleaseBrief,
  releaseSummary,
  releaseWorkspaceTab,
  setReleaseWorkspaceTab,
  effectiveReleaseAssistantFindings,
  setReleaseBoardFilter,
  segmentsNeedingVisual,
  handleOpenSegmentScreenshotMode,
  handleAttachOrphanScreenshots,
  effectiveOrphanScreenshotsCount,
  handleFillMissingVisualsWithRecommendations,
  handlePrepareRelease,
  handleMarkReleaseAirReady,
  handlePublishRelease,
  recommendedReleaseAssets,
  releaseRecommendationSummary,
  handleAttachRecommendedBatch,
  handleAttachAssetToRelease,
  assetActionBusy,
  selectedReleaseId,
  handleOpenAssetScreenshotMode,
  handleDownloadMedia,
  getMediaDownloadState,
  formatRecommendationBucketLabel,
  releaseDraftPackSummary,
  releaseDraftPackItems,
  releasePublishChecklistSummary,
  releasePublishChecklistItems,
  releaseReadyToAir,
  releaseControlPanel,
  releaseBriefingPanel,
  releaseResearchBriefs,
  sourceProfiles,
  releaseOutcomeMemorySummary,
  runtimeBackupsStatus,
  lastAssistantAutoBackup,
  handleApplyReleaseDraftPack,
  handleSelectBackupSnapshot,
  handleFocusReleaseAttachment,
  handlePrepareReleaseAttachment,
  handleDraftReleaseAttachment,
  handleFillReleaseAttachmentVisuals,
  handleUpdateReleaseAttachment,
  handleCopyReleaseResearchBrief,
  handleOpenReleaseResearchSegment,
  handlePinReleaseResearchRun,
  handleOpenReleaseFromSegment,
  releaseActivity,
  formatRelativeEventLabel,
  formatDateTimeShort,
  releaseBoardFilter,
  releaseBoardCounts,
  releaseBoardColumns,
  releaseBoardGroups,
  formatReleaseItemStatusLabel,
  selectedReleaseItems,
  selectedReleaseAssets,
  handleSelectAllReleaseItems,
  handleSelectReleaseItemsByFilter,
  handleClearReleaseSelection,
  handleBulkUpdateReleaseItems,
  releaseBulkScriptTemplate,
  setReleaseBulkScriptTemplate,
  releaseBulkVisualTemplate,
  setReleaseBulkVisualTemplate,
  handleBulkApplyNoteTemplates,
  handlePrepareSelectedReleaseItems,
  handleApplySelectionDraftPack,
  handleFillSelectedVisualsWithRecommendations,
  selectedReleaseAttachmentIdSet,
  toggleReleaseAttachmentSelection,
  formatAssetKindLabel,
  handleReorderReleaseAsset,
  handleAssetStatusUpdate,
  handleDetachAssetFromRelease,
  handleBulkUpdateSelectedAssetStatus,
  handleBulkDetachReleaseItems
}) {
  return (
    <div className="release-detail">
      <div className="release-detail-head">
        <strong>{selectedReleaseDetail.title || selectedReleaseDetail.id}</strong>
        <span>
          {selectedReleaseDetail.status || "draft"}
          {selectedReleaseDetail.air_date ? ` · ${selectedReleaseDetail.air_date}` : ""}
        </span>
      </div>
      <div className="release-controls">
        <select
          value={selectedReleaseDetail.status || "draft"}
          onChange={(event) => handleUpdateRelease({ status: event.target.value })}
          disabled={releaseBusy}
        >
          <option value="draft">draft</option>
          <option value="in_progress">in_progress</option>
          <option value="ready">ready</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
        </select>
        <select
          value={selectedReleaseDetail.editor_status || "planning"}
          onChange={(event) => handleUpdateRelease({ editor_status: event.target.value })}
          disabled={releaseBusy}
        >
          <option value="planning">planning</option>
          <option value="collecting">collecting</option>
          <option value="scripting">scripting</option>
          <option value="visual_ready">visual_ready</option>
          <option value="air_ready">air_ready</option>
        </select>
      </div>
      <div className="release-export-actions">
        <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("md")}>
          Export MD
        </button>
        <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("json")}>
          Export JSON
        </button>
        <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("shotlist")}>
          Export Shotlist
        </button>
        <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("media-package")}>
          Export Media Package
        </button>
        <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("copy-plan")}>
          Export Copy Plan
        </button>
      </div>
      <div className="release-summary-grid">
        <div className="release-summary-card">
          <span>Total</span>
          <strong>{releaseSummary.total}</strong>
        </div>
        <div className="release-summary-card">
          <span>Ready</span>
          <strong>{releaseSummary.ready}</strong>
        </div>
        <div className="release-summary-card">
          <span>In Progress</span>
          <strong>{releaseSummary.in_progress}</strong>
        </div>
        <div className="release-summary-card">
          <span>No Script</span>
          <strong>{releaseSummary.missing_script}</strong>
        </div>
        <div className="release-summary-card">
          <span>No Visual</span>
          <strong>{releaseSummary.missing_visual}</strong>
        </div>
        <div className="release-summary-card">
          <span>Screenshots</span>
          <strong>{releaseSummary.with_screenshots}</strong>
        </div>
      </div>
      <div className="release-workspace">
        <div className="release-workspace-head">
          <strong>Release Workspace</strong>
          <span>{releaseWorkspaceTab}</span>
        </div>
        <div className="release-workspace-tabs">
          <button
            className={`btn ghost small${releaseWorkspaceTab === "overview" ? " is-active" : ""}`}
            type="button"
            onClick={() => setReleaseWorkspaceTab("overview")}
          >
            Overview
          </button>
          <button
            className={`btn ghost small${releaseWorkspaceTab === "board" ? " is-active" : ""}`}
            type="button"
            onClick={() => setReleaseWorkspaceTab("board")}
          >
            Board
          </button>
          <button
            className={`btn ghost small${releaseWorkspaceTab === "rundown" ? " is-active" : ""}`}
            type="button"
            onClick={() => setReleaseWorkspaceTab("rundown")}
          >
            Rundown
          </button>
          <button
            className={`btn ghost small${releaseWorkspaceTab === "timeline" ? " is-active" : ""}`}
            type="button"
            onClick={() => setReleaseWorkspaceTab("timeline")}
          >
            Timeline
          </button>
        </div>
      </div>
      <div className={releaseWorkspaceTab === "overview" ? "" : "is-hidden"}>
        <ReleaseWorkspaceOverview
          effectiveReleaseAssistantFindings={effectiveReleaseAssistantFindings}
          setReleaseBoardFilter={setReleaseBoardFilter}
          setReleaseWorkspaceTab={setReleaseWorkspaceTab}
          segmentsNeedingVisual={segmentsNeedingVisual}
          handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
          handleAttachOrphanScreenshots={handleAttachOrphanScreenshots}
          effectiveOrphanScreenshotsCount={effectiveOrphanScreenshotsCount}
          handleFillMissingVisualsWithRecommendations={handleFillMissingVisualsWithRecommendations}
          handlePrepareRelease={handlePrepareRelease}
          handleMarkReleaseAirReady={handleMarkReleaseAirReady}
          handlePublishRelease={handlePublishRelease}
          releaseBusy={releaseBusy}
          releaseSummary={releaseSummary}
          recommendedReleaseAssets={recommendedReleaseAssets}
          releaseRecommendationSummary={releaseRecommendationSummary}
          handleAttachRecommendedBatch={handleAttachRecommendedBatch}
          handleAttachAssetToRelease={handleAttachAssetToRelease}
          assetActionBusy={assetActionBusy}
          selectedReleaseId={selectedReleaseId}
          handleOpenAssetScreenshotMode={handleOpenAssetScreenshotMode}
          handleDownloadMedia={handleDownloadMedia}
          getMediaDownloadState={getMediaDownloadState}
          formatRecommendationBucketLabel={formatRecommendationBucketLabel}
          releaseDraftPackSummary={releaseDraftPackSummary}
          releaseDraftPackItems={releaseDraftPackItems}
          releasePublishChecklistSummary={releasePublishChecklistSummary}
          releasePublishChecklistItems={releasePublishChecklistItems}
          releaseReadyToAir={releaseReadyToAir}
          releaseControlPanel={releaseControlPanel}
          releaseBriefingPanel={releaseBriefingPanel}
          releaseResearchBriefs={releaseResearchBriefs}
          sourceProfiles={sourceProfiles}
          releaseOutcomeMemorySummary={releaseOutcomeMemorySummary}
          runtimeBackupsStatus={runtimeBackupsStatus}
          lastAssistantAutoBackup={lastAssistantAutoBackup}
          formatDateTimeShort={formatDateTimeShort}
          releaseActivity={releaseActivity}
          handleApplyReleaseDraftPack={handleApplyReleaseDraftPack}
          handleSelectBackupSnapshot={handleSelectBackupSnapshot}
          handleFocusReleaseAttachment={handleFocusReleaseAttachment}
          handlePrepareReleaseAttachment={handlePrepareReleaseAttachment}
          handleDraftReleaseAttachment={handleDraftReleaseAttachment}
          handleFillReleaseAttachmentVisuals={handleFillReleaseAttachmentVisuals}
          handleUpdateReleaseAttachment={handleUpdateReleaseAttachment}
          handleCopyReleaseResearchBrief={handleCopyReleaseResearchBrief}
          handleOpenReleaseResearchSegment={handleOpenReleaseResearchSegment}
          handlePinReleaseResearchRun={handlePinReleaseResearchRun}
          handleOpenReleaseFromSegment={handleOpenReleaseFromSegment}
          selectedReleaseAssets={selectedReleaseAssets}
        />
      </div>
      <div className={releaseWorkspaceTab === "board" ? "" : "is-hidden"}>
        <ReleaseWorkspaceBoard
          releaseBoardFilter={releaseBoardFilter}
          setReleaseBoardFilter={setReleaseBoardFilter}
          releaseBoardCounts={releaseBoardCounts}
          releaseBoardColumns={releaseBoardColumns}
          releaseBoardGroups={releaseBoardGroups}
          formatReleaseItemStatusLabel={formatReleaseItemStatusLabel}
        />
      </div>
      <div className={releaseWorkspaceTab === "rundown" ? "" : "is-hidden"}>
        <ReleaseWorkspaceRundown
          selectedReleaseItems={selectedReleaseItems}
          selectedReleaseAssets={selectedReleaseAssets}
          handleSelectAllReleaseItems={handleSelectAllReleaseItems}
          handleSelectReleaseItemsByFilter={handleSelectReleaseItemsByFilter}
          handleClearReleaseSelection={handleClearReleaseSelection}
          handleBulkUpdateReleaseItems={handleBulkUpdateReleaseItems}
          releaseBusy={releaseBusy}
          handleBulkUpdateSelectedAssetStatus={handleBulkUpdateSelectedAssetStatus}
          handleBulkDetachReleaseItems={handleBulkDetachReleaseItems}
          releaseBulkScriptTemplate={releaseBulkScriptTemplate}
          setReleaseBulkScriptTemplate={setReleaseBulkScriptTemplate}
          releaseBulkVisualTemplate={releaseBulkVisualTemplate}
          setReleaseBulkVisualTemplate={setReleaseBulkVisualTemplate}
          handleBulkApplyNoteTemplates={handleBulkApplyNoteTemplates}
          handlePrepareSelectedReleaseItems={handlePrepareSelectedReleaseItems}
          handlePrepareReleaseAttachment={handlePrepareReleaseAttachment}
          handleApplySelectionDraftPack={handleApplySelectionDraftPack}
          handleDraftReleaseAttachment={handleDraftReleaseAttachment}
          handleFillSelectedVisualsWithRecommendations={handleFillSelectedVisualsWithRecommendations}
          handleFillReleaseAttachmentVisuals={handleFillReleaseAttachmentVisuals}
          selectedReleaseAttachmentIdSet={selectedReleaseAttachmentIdSet}
          toggleReleaseAttachmentSelection={toggleReleaseAttachmentSelection}
          formatAssetKindLabel={formatAssetKindLabel}
          handleUpdateReleaseAttachment={handleUpdateReleaseAttachment}
          assetActionBusy={assetActionBusy}
          handleReorderReleaseAsset={handleReorderReleaseAsset}
          handleOpenAssetScreenshotMode={handleOpenAssetScreenshotMode}
          handleDownloadMedia={handleDownloadMedia}
          getMediaDownloadState={getMediaDownloadState}
          handleAssetStatusUpdate={handleAssetStatusUpdate}
          handleDetachAssetFromRelease={handleDetachAssetFromRelease}
          releaseActivity={releaseActivity}
          releaseResearchBriefs={releaseResearchBriefs}
          sourceProfiles={sourceProfiles}
          releaseDraftPackItems={releaseDraftPackItems}
          formatRelativeEventLabel={formatRelativeEventLabel}
          formatDateTimeShort={formatDateTimeShort}
        />
      </div>
      <div className={releaseWorkspaceTab === "timeline" ? "" : "is-hidden"}>
        <ReleaseWorkspaceTimeline
          releaseActivity={releaseActivity}
          formatRelativeEventLabel={formatRelativeEventLabel}
          formatDateTimeShort={formatDateTimeShort}
          setReleaseWorkspaceTab={setReleaseWorkspaceTab}
          setReleaseBoardFilter={setReleaseBoardFilter}
          handleFocusReleaseAttachment={handleFocusReleaseAttachment}
        />
      </div>
    </div>
  );
}
