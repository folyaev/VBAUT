import React from "react";

export function SegmentResearchBrief({
  segmentId,
  researchResultsCount,
  guidance,
  researchPhaseActionHints,
  promotedResearchPair,
  currentSegmentResearchPair,
  getCurrentPairBadgeClassName,
  researchBriefItems,
  formatSegmentResearchBriefLabel,
  formatResearchCandidateRoleLabel,
  primaryResearchSourceResultId,
  primaryResearchVisualResultId,
  backupResearchSourceResultId,
  backupResearchVisualResultId,
  researchLoading,
  index,
  onResearchPromoteBundle,
  onResearchApply
}) {
  if (researchResultsCount <= 0) return null;

  return (
    <div className="segment-research-brief">
      <div className="segment-research-head">
        <strong>Research Brief</strong>
        <span>{`${researchResultsCount} ranked candidates`}</span>
      </div>
      {Array.isArray(guidance) && guidance.length > 0 ? (
        <div className="segment-research-guidance">
          {guidance.map((item, guidanceIndex) => (
            <span key={`${segmentId}-guidance-${guidanceIndex}`}>{item}</span>
          ))}
        </div>
      ) : null}
      {researchPhaseActionHints.length > 0 ? (
        <div className="segment-research-phase-hints">
          {researchPhaseActionHints.map((item) => (
            <span key={`${segmentId}-phase-hint-${item.phase}`}>
              {`${item.label} -> ${item.action} · ${item.detail}`}
            </span>
          ))}
        </div>
      ) : null}
      <div className="segment-research-brief-grid">
        {promotedResearchPair ? (
          <div key={`${segmentId}-brief-pair`} className="segment-research-brief-card segment-research-brief-card-pair">
            <span className="segment-research-brief-label">Current Pair</span>
            <strong>{promotedResearchPair?.source?.title || promotedResearchPair?.visual?.title || "Research bundle"}</strong>
            {currentSegmentResearchPair?.label ? (
              <div className="segment-current-pair-row">
                <span className={getCurrentPairBadgeClassName(currentSegmentResearchPair.label)}>
                  {currentSegmentResearchPair.label}
                </span>
                {currentSegmentResearchPair.hint ? (
                  <span className="segment-current-pair-hint">{currentSegmentResearchPair.hint}</span>
                ) : null}
              </div>
            ) : null}
            <span>
              {[
                promotedResearchPair?.source?.domain ? `Source: ${promotedResearchPair.source.domain}` : "",
                promotedResearchPair?.visual?.domain ? `Visual: ${promotedResearchPair.visual.domain}` : ""
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ) : null}
        {researchBriefItems.map((item) => (
          <div key={`${segmentId}-brief-${item.key}`} className="segment-research-brief-card">
            <span className="segment-research-brief-label">{formatSegmentResearchBriefLabel(item)}</span>
            <strong>{item.title}</strong>
            <span>{`${item.domain} · ${formatResearchCandidateRoleLabel(item.role)} · ${item.score.toFixed(2)}`}</span>
            {String(item?.memory_hint ?? "").trim() ? <span>{item.memory_hint}</span> : null}
          </div>
        ))}
      </div>
      {primaryResearchSourceResultId ||
      primaryResearchVisualResultId ||
      backupResearchSourceResultId ||
      backupResearchVisualResultId ? (
        <div className="segment-research-presets">
          {primaryResearchSourceResultId && primaryResearchVisualResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchPromoteBundle?.(index, primaryResearchSourceResultId, primaryResearchVisualResultId)}
            >
              Promote Main Pair
            </button>
          ) : null}
          {primaryResearchSourceResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchApply(index, "use_as_source", primaryResearchSourceResultId)}
            >
              Use Main Source
            </button>
          ) : null}
          {primaryResearchVisualResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchApply(index, "promote_to_decision", primaryResearchVisualResultId)}
            >
              Use Main Visual
            </button>
          ) : null}
          {backupResearchSourceResultId && backupResearchVisualResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchPromoteBundle?.(index, backupResearchSourceResultId, backupResearchVisualResultId)}
            >
              Promote Backup Pair
            </button>
          ) : null}
          {backupResearchSourceResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchApply(index, "use_as_source", backupResearchSourceResultId)}
            >
              Use Backup Source
            </button>
          ) : null}
          {backupResearchVisualResultId ? (
            <button
              className="btn ghost small"
              type="button"
              disabled={researchLoading}
              onClick={() => onResearchApply(index, "promote_to_decision", backupResearchVisualResultId)}
            >
              Use Backup Visual
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
