import React from "react";

function formatResearchModeLabel(mode) {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized === "deep" ? "search" : normalized;
}

export function SegmentResearchHeader({
  researchLoading,
  researchRun,
  researchPhaseSummary,
  index,
  onResearchCopyBrief,
  researchHistoryItems,
  onResearchSelectRun
}) {
  return (
    <>
      <div className="segment-research-head">
        <strong>Segment Research</strong>
        <div className="segment-research-head-actions">
          <span>
            {researchLoading
              ? "running"
              : `${Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results.length : 0} results${
                  researchRun?.mode ? ` В· ${formatResearchModeLabel(researchRun.mode)}` : ""
                }${researchPhaseSummary ? ` В· ${researchPhaseSummary}` : ""}`}
          </span>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onResearchCopyBrief?.(index)}
            disabled={!researchRun}
          >
            Copy Brief
          </button>
        </div>
      </div>
      {researchHistoryItems.length > 1 ? (
        <div className="segment-research-history">
          <label>Run</label>
          <select value={String(researchRun?.run_id ?? "")} onChange={(event) => onResearchSelectRun(index, event.target.value)}>
            {researchHistoryItems.map((item) => (
              <option key={item.run_id} value={item.run_id}>
                {`${String(item.updated_at ?? item.created_at ?? "").slice(0, 16).replace("T", " ")} В· ${
                  formatResearchModeLabel(item?.mode || "deep")
                } В· ${Array.isArray(item?.ranked_results) ? item.ranked_results.length : 0} results`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
