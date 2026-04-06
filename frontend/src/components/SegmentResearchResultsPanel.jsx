import React from "react";

export function SegmentResearchResultsPanel({
  segment,
  index,
  researchResults,
  researchViewTabs,
  researchView,
  setResearchView,
  researchPhaseTabs,
  researchPhaseFilter,
  setResearchPhaseFilter,
  researchRoleTabs,
  researchRoleFilter,
  setResearchRoleFilter,
  bestSourceCandidate,
  bestVisualCandidate,
  bestVisibleCandidate,
  deepResearchPairReady,
  deepResearchSourceItem,
  deepResearchVisualItem,
  bestSourcePhaseCandidate,
  bestVisualPhaseCandidate,
  bestContextPhaseCandidate,
  researchLoading,
  researchRun,
  visibleResearchResults,
  researchCompareIds,
  setResearchCompareIds,
  researchCompareItems,
  currentResearchSources,
  onResearchApplyMany,
  onResearchPromoteBundle,
  onResearchApply,
  formatResearchCandidateRoleLabel,
  inferResearchCandidateRole,
  getResearchResultPhase,
  collectResearchMemoryBadges,
  getVisibleResearchReasonTags
}) {
  const [researchActionSet, setResearchActionSet] = React.useState(() => new Set());
  const [selectedResultIds, setSelectedResultIds] = React.useState([]);
  const handleAction = React.useCallback(
    (action, resultId) => {
      onResearchApply(index, action, resultId);
      setResearchActionSet((prev) => new Set(prev).add(`${action}-${resultId}`));
    },
    [index, onResearchApply]
  );
  const currentSourceUrlSet = React.useMemo(
    () =>
      new Set(
        (Array.isArray(currentResearchSources) ? currentResearchSources : [])
          .map((item) => String(item?.url ?? "").trim())
          .filter(Boolean)
      ),
    [currentResearchSources]
  );
  const handleToggleSelect = React.useCallback((resultId) => {
    setSelectedResultIds((prev) =>
      prev.includes(resultId) ? prev.filter((id) => id !== resultId) : [...prev, resultId]
    );
  }, []);
  const handleAddSelected = React.useCallback(() => {
    if (!selectedResultIds.length) return;
    onResearchApplyMany?.(index, selectedResultIds, "use_as_source");
    setSelectedResultIds([]);
  }, [index, onResearchApplyMany, selectedResultIds]);
  const handleOpenResult = React.useCallback((resultUrl) => {
    const normalizedUrl = String(resultUrl ?? "").trim();
    if (!normalizedUrl) return;
    window.open(normalizedUrl, "_blank", "noopener,noreferrer");
  }, []);

  const renderActionButton = (action, label, resultId) => {
    const isDone = researchActionSet.has(`${action}-${resultId}`);
    return (
      <button
        key={`${action}-${resultId}`}
        className={`btn ghost small${isDone ? " is-active" : ""}`}
        type="button"
        onClick={() => handleAction(action, resultId)}
      >
        {isDone ? `${label} ✓` : label}
      </button>
    );
  };

  const handleToggleCompare = React.useCallback(
    (resultId) => {
      setResearchCompareIds((prev) =>
        prev.includes(resultId)
          ? prev.filter((id) => id !== resultId)
          : prev.length >= 3
            ? [...prev.slice(1), resultId]
            : [...prev, resultId]
      );
    },
    [setResearchCompareIds]
  );
  React.useEffect(() => {
    const allowedIds = new Set(researchResults.map((item) => String(item?.result?.id ?? "").trim()).filter(Boolean));
    setSelectedResultIds((prev) => prev.filter((id) => allowedIds.has(String(id ?? "").trim())));
  }, [researchResults]);

  if (researchResults.length <= 0) return null;

  return (
    <>
      <div className="segment-research-tabs">
        {researchViewTabs.map((tab) => (
          <button
            key={`${segment.segment_id}-${tab.id}`}
            className={`btn ghost small${researchView === tab.id ? " is-active" : ""}`}
            type="button"
            onClick={() => setResearchView(tab.id)}
          >
            {`${tab.label} · ${tab.count}`}
          </button>
        ))}
      </div>
      <div className="segment-research-tabs segment-research-role-tabs">
        {researchPhaseTabs.map((tab) => (
          <button
            key={`${segment.segment_id}-phase-${tab.id}`}
            className={`btn ghost small${researchPhaseFilter === tab.id ? " is-active" : ""}`}
            type="button"
            onClick={() => setResearchPhaseFilter(tab.id)}
          >
            {`${tab.label} · ${tab.count}`}
          </button>
        ))}
      </div>
      <div className="segment-research-tabs segment-research-role-tabs">
        {researchRoleTabs.map((tab) => (
          <button
            key={`${segment.segment_id}-role-${tab.id}`}
            className={`btn ghost small${researchRoleFilter === tab.id ? " is-active" : ""}`}
            type="button"
            onClick={() => setResearchRoleFilter(tab.id)}
          >
            {`${tab.label} · ${tab.count}`}
          </button>
        ))}
      </div>
      <div className="segment-research-presets">
        <button
          className="btn ghost small"
          type="button"
          disabled={!selectedResultIds.length || researchLoading}
          onClick={handleAddSelected}
        >
          {selectedResultIds.length > 0 ? `Add Selected Links · ${selectedResultIds.length}` : "Select Links To Add"}
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestSourceCandidate || researchLoading}
          onClick={() => bestSourceCandidate && onResearchApply(index, "promote_to_decision", bestSourceCandidate.id)}
        >
          Use Top Source
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestVisualCandidate || researchLoading}
          onClick={() => bestVisualCandidate && onResearchApply(index, "promote_to_decision", bestVisualCandidate.id)}
        >
          Use Top Visual
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestVisibleCandidate || researchLoading}
          onClick={() => bestVisibleCandidate && onResearchApply(index, "promote_to_decision", bestVisibleCandidate.id)}
        >
          Use Top Visible
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestSourcePhaseCandidate || researchLoading}
          onClick={() => bestSourcePhaseCandidate && onResearchApply(index, "promote_to_decision", bestSourcePhaseCandidate.id)}
        >
          Use Source Pass Top
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestVisualPhaseCandidate || researchLoading}
          onClick={() => bestVisualPhaseCandidate && onResearchApply(index, "promote_to_decision", bestVisualPhaseCandidate.id)}
        >
          Use Visual Pass Top
        </button>
        <button
          className="btn ghost small"
          type="button"
          disabled={!bestContextPhaseCandidate || researchLoading}
          onClick={() => bestContextPhaseCandidate && onResearchApply(index, "attach_asset", bestContextPhaseCandidate.id)}
        >
          Attach Context Pass Top
        </button>
      </div>
      {Array.isArray(researchRun?.warnings) && researchRun.warnings.length > 0 ? (
        <div className="segment-research-warnings">
          {researchRun.warnings.map((item, warningIndex) => (
            <span key={`${segment.segment_id}-warning-${warningIndex}`}>{item}</span>
          ))}
        </div>
      ) : null}
      {visibleResearchResults.length > 0 ? (
        <div className="segment-research-list">
          {visibleResearchResults.map(({ result, ranked }) => (
            <div key={`${segment.segment_id}-${result.id}`} className="segment-research-item">
              <div className="segment-research-copy">
                <div className="segment-research-item-top">
                  <label className="segment-research-select">
                    <input
                      type="checkbox"
                      checked={selectedResultIds.includes(result.id)}
                      onChange={() => handleToggleSelect(result.id)}
                    />
                    <span>Select</span>
                  </label>
                  {currentSourceUrlSet.has(String(result?.url ?? "").trim()) ? (
                    <span className="segment-research-tag segment-research-tag-role">Added</span>
                  ) : null}
                </div>
                <strong>{result.title || result.url}</strong>
                <span>
                  {result.domain || "source"}
                  {ranked?.bucket ? ` · ${ranked.bucket}` : ""}
                  {Number.isFinite(Number(ranked?.total_score)) ? ` · ${Number(ranked.total_score).toFixed(2)}` : ""}
                </span>
                <div className="segment-research-tags">
                  <span className="segment-research-tag segment-research-tag-role">
                    {formatResearchCandidateRoleLabel(inferResearchCandidateRole(segment, ranked))}
                  </span>
                  <span className="segment-research-tag">{getResearchResultPhase(result)}</span>
                  {collectResearchMemoryBadges(ranked).map((tag) => (
                    <span key={`${result.id}-memory-${tag}`} className="segment-research-tag">
                      {tag}
                    </span>
                  ))}
                </div>
                {getVisibleResearchReasonTags(ranked).length > 0 ? (
                  <div className="segment-research-tags">
                    {getVisibleResearchReasonTags(ranked).map((tag) => (
                      <span key={`${result.id}-${tag}`} className="segment-research-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(ranked?.visual_hints) && ranked.visual_hints.length > 0 ? (
                  <span>{ranked.visual_hints.join(" · ")}</span>
                ) : null}
                <span>{ranked?.reason || result.snippet || ""}</span>
              </div>
              <div className="segment-research-actions">
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => handleOpenResult(result.url)}
                >
                  Перейти
                </button>
                <button
                  className={`btn ghost small${researchCompareIds.includes(result.id) ? " is-active" : ""}`}
                  type="button"
                  onClick={() => handleToggleCompare(result.id)}
                >
                  {researchCompareIds.includes(result.id) ? "Compared" : "Compare"}
                </button>
                <button
                  className={`btn ghost small${selectedResultIds.includes(result.id) ? " is-active" : ""}`}
                  type="button"
                  onClick={() => handleToggleSelect(result.id)}
                >
                  {selectedResultIds.includes(result.id) ? "Selected" : "Select"}
                </button>
                {renderActionButton("mark_helpful", "Helpful", result.id)}
                {renderActionButton("use_as_source", "Add Link", result.id)}
                {renderActionButton("promote_to_decision", "Use", result.id)}
                {renderActionButton("attach_asset", "Attach", result.id)}
                {renderActionButton("screenshot", "Screenshot", result.id)}
                {renderActionButton("download", "Download", result.id)}
              </div>
            </div>
          ))}
        </div>
      ) : !researchLoading ? (
        <div className="muted">Research пока не дал кандидатов.</div>
      ) : null}
      {researchCompareItems.length > 0 ? (
        <div className="segment-research-compare">
          <div className="segment-research-head">
            <strong>{`Compare Candidates · ${researchCompareItems.length}`}</strong>
            <button className="btn ghost small" type="button" onClick={() => setResearchCompareIds([])}>
              Clear
            </button>
          </div>
          <div className="segment-research-compare-grid">
            {researchCompareItems.map(({ result, ranked }) => (
              <div key={`${segment.segment_id}-compare-${result.id}`} className="segment-research-compare-card">
                <strong>{result.title || result.url}</strong>
                <span>{result.domain || "source"}</span>
                <div className="segment-research-tags">
                  <span className="segment-research-tag segment-research-tag-role">
                    {formatResearchCandidateRoleLabel(inferResearchCandidateRole(segment, ranked))}
                  </span>
                  <span className="segment-research-tag">{getResearchResultPhase(result)}</span>
                  {collectResearchMemoryBadges(ranked).map((tag) => (
                    <span key={`${result.id}-compare-memory-${tag}`} className="segment-research-tag">
                      {tag}
                    </span>
                  ))}
                  {getVisibleResearchReasonTags(ranked).map((tag) => (
                    <span key={`${result.id}-compare-tag-${tag}`} className="segment-research-tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="segment-research-compare-metrics">
                  <span>{`Total ${Number(ranked?.total_score ?? 0).toFixed(2)}`}</span>
                  <span>{`Source ${Number(ranked?.source_score ?? 0).toFixed(2)}`}</span>
                  <span>{`Visual ${Number(ranked?.visual_score ?? 0).toFixed(2)}`}</span>
                  <span>{`Montage ${Number(ranked?.montage_score ?? 0).toFixed(2)}`}</span>
                  <span>{`Download ${Number(ranked?.downloadability_score ?? 0).toFixed(2)}`}</span>
                  <span>{`Similarity ${Number(ranked?.similarity_score ?? 0).toFixed(2)}`}</span>
                </div>
                <span>{ranked?.reason || result.snippet || ""}</span>
                <div className="segment-research-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleOpenResult(result.url)}
                  >
                    Перейти
                  </button>
                  {renderActionButton("mark_helpful", "Helpful", result.id)}
                  {renderActionButton("use_as_source", "Add Link", result.id)}
                  {renderActionButton("promote_to_decision", "Use", result.id)}
                  {renderActionButton("attach_asset", "Attach", result.id)}
                  {renderActionButton("screenshot", "Screenshot", result.id)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
