import React from "react";
import { getResearchCategoryLabel } from "../utils/researchCategories.js";

const RESEARCH_OPERATOR_ACTIONS = [
  { action: "duplicate_story", label: "Dup story" },
  { action: "bad_visual", label: "Bad visual" },
  { action: "screenshot_failed", label: "Shot fail" },
  { action: "download_failed", label: "DL fail" },
  { action: "paywall", label: "Paywall" },
  { action: "anti_bot", label: "Anti-bot" },
  { action: "age_gate", label: "Age-gate" }
];

const AUTO_RESEARCH_ACTION_LABELS = {
  screenshot_failed: "Auto: Shot fail",
  download_failed: "Auto: DL fail",
  paywall: "Auto: Paywall",
  anti_bot: "Auto: Anti-bot",
  age_gate: "Auto: Age-gate"
};

const AUTO_RESEARCH_SOURCE_LABELS = {
  media_download: "DL",
  link_screenshot: "Shot",
  manual_capture: "Manual"
};

function formatAutoRecordedOutcomeLabel(action, source) {
  const baseLabel = AUTO_RESEARCH_ACTION_LABELS[String(action ?? "").trim()] ?? "";
  if (!baseLabel) return "";
  const sourceLabel = AUTO_RESEARCH_SOURCE_LABELS[String(source ?? "").trim()] ?? "";
  return sourceLabel ? `${baseLabel} · ${sourceLabel}` : baseLabel;
}

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
  bestSourcePhaseCandidate,
  bestVisualPhaseCandidate,
  bestContextPhaseCandidate,
  researchLoading,
  researchRun,
  visibleResearchResults,
  currentResearchSources,
  onResearchApply,
  formatResearchCandidateRoleLabel,
  inferResearchCandidateRole,
  getResearchResultPhase,
  collectResearchMemoryBadges,
  getVisibleResearchReasonTags
}) {
  const [researchActionSet, setResearchActionSet] = React.useState(() => new Set());

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

  const autoRecordedOutcomeMap = React.useMemo(() => {
    const appliedEntries = Array.isArray(researchRun?.applied) ? researchRun.applied : [];
    const nextMap = new Map();
    appliedEntries.forEach((entry) => {
      if (!entry?.meta?.auto_recorded) return;
      const resultId = String(entry?.result_id ?? "").trim();
      const action = String(entry?.action ?? "").trim();
      const source = String(entry?.meta?.source ?? "").trim();
      const label = formatAutoRecordedOutcomeLabel(action, source);
      if (!resultId || !label) return;
      const appliedAt = String(entry?.applied_at ?? "");
      const existing = nextMap.get(resultId) ?? [];
      existing.push({
        action,
        source,
        label,
        appliedAt
      });
      existing.sort((left, right) => String(right.appliedAt).localeCompare(String(left.appliedAt)));
      nextMap.set(resultId, existing.slice(0, 2));
    });
    return nextMap;
  }, [researchRun]);

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
          onClick={() => bestContextPhaseCandidate && onResearchApply(index, "use_as_source", bestContextPhaseCandidate.id)}
        >
          Add Context Pass Top
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
          {visibleResearchResults.map(({ result, ranked }) => {
            const resultUrl = String(result?.url ?? "").trim();
            const isAdded = currentSourceUrlSet.has(resultUrl);
            const autoOutcomes = autoRecordedOutcomeMap.get(String(result?.id ?? "").trim()) ?? [];
            return (
              <div key={`${segment.segment_id}-${result.id}`} className="segment-research-item">
                <div className="segment-research-copy">
                  <div className="segment-research-item-top">
                    {isAdded ? (
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
                      {getResearchCategoryLabel(ranked)}
                    </span>
                    <span className="segment-research-tag segment-research-tag-role">
                      {formatResearchCandidateRoleLabel(inferResearchCandidateRole(segment, ranked))}
                    </span>
                    <span className="segment-research-tag">{getResearchResultPhase(result)}</span>
                    {collectResearchMemoryBadges(ranked).map((tag) => (
                      <span key={`${result.id}-memory-${tag}`} className="segment-research-tag">
                        {tag}
                      </span>
                    ))}
                    {autoOutcomes.map((item) => (
                      <span
                        key={`${result.id}-auto-${item.action}-${item.source}-${item.appliedAt}`}
                        className="segment-research-tag"
                      >
                        {item.label}
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
                  <button className="btn ghost small" type="button" onClick={() => handleOpenResult(result.url)}>
                    Перейти
                  </button>
                  <button
                    className={`btn ghost small${isAdded ? " is-active" : ""}`}
                    type="button"
                    disabled={isAdded}
                    onClick={() => handleAction("use_as_source", result.id)}
                  >
                    {isAdded ? "Selected" : "Select"}
                  </button>
                  {renderActionButton("mark_helpful", "Helpful", result.id)}
                  {renderActionButton("promote_to_decision", "Use", result.id)}
                  {renderActionButton("screenshot", "Screenshot", result.id)}
                  {renderActionButton("download", "Download", result.id)}
                  {renderActionButton("delete_result", "Delete", result.id)}
                  {RESEARCH_OPERATOR_ACTIONS.map((item) => renderActionButton(item.action, item.label, result.id))}
                </div>
              </div>
            );
          })}
        </div>
      ) : !researchLoading ? (
        <div className="muted">Research пока не дал кандидатов.</div>
      ) : null}
    </>
  );
}
