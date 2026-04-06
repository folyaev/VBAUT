import React from "react";

export function ScenarioGroupContent({
  group,
  visibleItems,
  remaining,
  handleShowMore,
  LinksCardComponent,
  SegmentCardComponent,
  handleLinkAdd,
  handleLinkUpdate,
  handleLinkRemove,
  handleOpenSegmentScreenshotMode,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded,
  config,
  docId,
  mediaFiles,
  updateSegment,
  updateVisual,
  updateSearch,
  handleQuoteChange,
  handleInsertAfter,
  handleRemoveSegment,
  handleClearSearch,
  handleGenerateSearch,
  searchLoading,
  handleSearchToggle,
  handleSearch,
  segmentResearchRuns,
  segmentResearchHistory,
  segmentResearchLoading,
  handleRunSegmentResearch,
  handleSelectSegmentResearchRun,
  handleApplySegmentResearch,
  handlePromoteSegmentResearchBundle,
  handleCopySegmentResearchBrief,
  handleOpenResearchWorkspace,
  linkedReleaseSegmentIds,
  selectedReleaseDetail,
  linkedReleaseSnapshotBySegmentId,
  handleOpenReleaseFromSegment,
  handleUseLinkedReleasePrimary,
  handlePromoteLinkedReleasePrimaryPair,
  handlePromoteLinkedReleaseBackupPair,
  handleUseLinkedReleaseBackup,
  handleCopy,
  handleToggleSegmentDone
}) {
  return (
    <>
      {group.linkSegment ? (
        <LinksCardComponent
          segment={group.linkSegment.segment}
          index={group.linkSegment.index}
          onLinkAdd={handleLinkAdd}
          onLinkUpdate={handleLinkUpdate}
          onLinkRemove={handleLinkRemove}
          onOpenScreenshotLab={handleOpenSegmentScreenshotMode}
          onDownload={handleDownloadMedia}
          isDownloadBusy={isMediaDownloadBusy}
          isDownloadSupported={isMediaDownloadSupported}
          isDownloaded={isMediaDownloaded}
        />
      ) : null}
      <div className="segments-grid">
        {visibleItems.map(({ segment, index }, localIndex) => {
          const segmentKey = String(segment.segment_id ?? "").trim();
          const linkedReleaseInfo = linkedReleaseSegmentIds.has(segmentKey) && selectedReleaseDetail
            ? {
                id: selectedReleaseDetail.id,
                title: selectedReleaseDetail.title,
                status: selectedReleaseDetail.status,
                air_date: selectedReleaseDetail.air_date
              }
            : null;
          return (
            <SegmentCardComponent
              key={`${segment.segment_id}-${index}`}
              segment={segment}
              index={index}
              animationIndex={localIndex}
              config={config}
              docId={docId}
              mediaFiles={mediaFiles}
              onUpdate={updateSegment}
              onVisualUpdate={updateVisual}
              onSearchUpdate={updateSearch}
              onQuoteChange={handleQuoteChange}
              onInsertAfter={handleInsertAfter}
              onRemove={handleRemoveSegment}
              onClearSearch={handleClearSearch}
              onSearchGenerate={handleGenerateSearch}
              searchLoading={Boolean(searchLoading[segment.segment_id])}
              onSearchToggle={handleSearchToggle}
              onSearch={handleSearch}
              researchRun={segmentResearchRuns[segment.segment_id] ?? null}
              researchHistory={segmentResearchHistory[segment.segment_id] ?? []}
              researchLoading={Boolean(segmentResearchLoading[segment.segment_id])}
              onResearchRun={handleRunSegmentResearch}
              onResearchSelectRun={handleSelectSegmentResearchRun}
              onResearchApply={handleApplySegmentResearch}
              onResearchPromoteBundle={handlePromoteSegmentResearchBundle}
              onResearchCopyBrief={handleCopySegmentResearchBrief}
              onOpenResearchWorkspace={handleOpenResearchWorkspace}
              linkedReleaseInfo={linkedReleaseInfo}
              linkedReleaseSnapshot={linkedReleaseSnapshotBySegmentId.get(segmentKey) ?? null}
              onOpenLinkedRelease={handleOpenReleaseFromSegment}
              onOpenLinkedReleaseHandoff={handleOpenReleaseFromSegment}
              onUseLinkedReleasePrimary={handleUseLinkedReleasePrimary}
              onPromoteLinkedReleasePrimaryPair={handlePromoteLinkedReleasePrimaryPair}
              onPromoteLinkedReleaseBackupPair={handlePromoteLinkedReleaseBackupPair}
              onUseLinkedReleaseBackup={handleUseLinkedReleaseBackup}
              onCopy={handleCopy}
              onDoneToggle={handleToggleSegmentDone}
            />
          );
        })}
      </div>
      {remaining > 0 ? (
        <div className="segment-group-footer">
          <button className="btn ghost small" type="button" onClick={() => handleShowMore(group.id)}>
            Показать ещё
          </button>
          <span>
            Показано {visibleItems.length} из {group.items.length}
          </span>
        </div>
      ) : null}
    </>
  );
}
