import React from "react";

function formatReleaseActivityTitle(event = "") {
  const normalized = String(event ?? "").trim().toLowerCase();
  if (normalized === "release_created") return "Release created";
  if (normalized === "asset_attached") return "Asset attached";
  if (normalized === "asset_detached") return "Asset detached";
  if (normalized === "rundown_reordered") return "Rundown reordered";
  if (normalized === "release_item_updated") return "Release item updated";
  if (normalized === "manual_override") return "Manual override";
  if (normalized === "research_pick_applied") return "Research pick applied";
  if (normalized === "attach_orphan_screenshots") return "Attach orphan screenshots";
  if (normalized === "attach_recommendations") return "Attach recommendations";
  if (normalized === "fill_missing_visuals") return "Fill missing visuals";
  if (normalized === "fill_selection_visuals") return "Fill selected visuals";
  if (normalized === "prepare_selection") return "Prepare selection";
  if (normalized === "prepare_release") return "Prepare release";
  if (normalized === "apply_draft_pack") return "Apply draft pack";
  if (normalized === "apply_selection_draft_pack") return "Apply selection draft pack";
  if (normalized === "mark_air_ready") return "Mark air ready";
  if (normalized === "publish_release") return "Publish release";
  if (normalized === "handoff_snapshot") return "Handoff snapshot refreshed";
  if (normalized === "handoff_download_resolved") return "Download blocker resolved";
  if (normalized === "handoff_capture_resolved") return "Capture blocker resolved";
  return normalized ? normalized.replace(/_/g, " ") : "Activity";
}

function formatReleaseActivityKind(event = "") {
  const normalized = String(event ?? "").trim().toLowerCase();
  if (normalized === "manual_override") return "manual";
  if (
    [
      "attach_orphan_screenshots",
      "attach_recommendations",
      "fill_missing_visuals",
      "fill_selection_visuals",
      "prepare_selection",
      "prepare_release",
      "apply_draft_pack",
      "apply_selection_draft_pack",
      "research_pick_applied",
      "handoff_snapshot",
      "handoff_download_resolved",
      "handoff_capture_resolved",
      "mark_air_ready",
      "publish_release"
    ].includes(normalized)
  ) {
    return "assistant";
  }
  if (normalized === "release_created" || normalized === "rundown_reordered") return "release";
  if (normalized === "asset_attached" || normalized === "asset_detached") return "asset";
  return "item";
}

function buildTimelineJump(item, { setReleaseWorkspaceTab, setReleaseBoardFilter, handleFocusReleaseAttachment }) {
  const event = String(item?.event ?? "").trim().toLowerCase();
  const attachmentId = String(item?.attachment_id ?? "").trim();
  if (attachmentId && typeof handleFocusReleaseAttachment === "function") {
    return {
      label: ["handoff_download_resolved", "handoff_capture_resolved"].includes(event) ? "Open Handoff" : "Open Item",
      action: () => handleFocusReleaseAttachment(attachmentId)
    };
  }
  if (event === "fill_missing_visuals" && typeof setReleaseBoardFilter === "function" && typeof setReleaseWorkspaceTab === "function") {
    return {
      label: "Show Gaps",
      action: () => {
        setReleaseBoardFilter("missing_visual");
        setReleaseWorkspaceTab("board");
      }
    };
  }
  if (
    [
      "attach_recommendations",
      "apply_draft_pack",
      "apply_selection_draft_pack",
      "prepare_release",
      "prepare_selection",
      "handoff_snapshot",
      "handoff_download_resolved",
      "handoff_capture_resolved"
    ].includes(event) &&
    typeof setReleaseWorkspaceTab === "function"
  ) {
    return {
      label: "Open Overview",
      action: () => setReleaseWorkspaceTab("overview")
    };
  }
  if (["asset_attached", "asset_detached", "rundown_reordered"].includes(event) && typeof setReleaseWorkspaceTab === "function") {
    return {
      label: "Open Rundown",
      action: () => setReleaseWorkspaceTab("rundown")
    };
  }
  return null;
}

export function ReleaseWorkspaceTimeline({
  releaseActivity,
  formatRelativeEventLabel,
  formatDateTimeShort,
  setReleaseWorkspaceTab,
  setReleaseBoardFilter,
  handleFocusReleaseAttachment
}) {
  const [filter, setFilter] = React.useState("all");
  const activityKinds = React.useMemo(
    () => (Array.isArray(releaseActivity) ? releaseActivity.map((item) => formatReleaseActivityKind(item?.event)) : []),
    [releaseActivity]
  );
  const filterCounts = React.useMemo(() => {
    const counts = {
      all: Array.isArray(releaseActivity) ? releaseActivity.length : 0,
      assistant: 0,
      manual: 0,
      release: 0,
      asset: 0,
      item: 0
    };
    activityKinds.forEach((kind) => {
      if (Object.prototype.hasOwnProperty.call(counts, kind)) {
        counts[kind] += 1;
      }
    });
    return counts;
  }, [activityKinds, releaseActivity]);
  const filteredActivity = React.useMemo(() => {
    const items = Array.isArray(releaseActivity) ? releaseActivity : [];
    if (filter === "all") return items;
    return items.filter((item) => formatReleaseActivityKind(item?.event) === filter);
  }, [filter, releaseActivity]);

  return (
    <div className="release-workspace-section">
      <div className="release-activity-panel">
        <div className="release-activity-head">
          <strong>Release Timeline</strong>
          <span>{filteredActivity.length}</span>
        </div>
        <div className="release-activity-toolbar">
          {[
            ["all", "All"],
            ["assistant", "Assistant"],
            ["manual", "Manual"],
            ["release", "Release"],
            ["asset", "Asset"],
            ["item", "Item"]
          ].map(([key, label]) => (
            <button
              key={key}
              className={`btn ghost small${filter === key ? " is-active" : ""}`}
              type="button"
              onClick={() => setFilter(key)}
            >
              {`${label} ${filterCounts[key] ?? 0}`}
            </button>
          ))}
        </div>
        {filteredActivity.length > 0 ? (
          <div className="release-activity-list">
            {filteredActivity.slice(0, 12).map((item) => {
              const kind = formatReleaseActivityKind(item.event);
              const jump = buildTimelineJump(item, {
                setReleaseWorkspaceTab,
                setReleaseBoardFilter,
                handleFocusReleaseAttachment
              });
              return (
                <div key={item.id} className={`release-activity-item kind-${kind}`}>
                  <div className="release-activity-row">
                    <strong>{formatReleaseActivityTitle(item.event)}</strong>
                    <span className={`release-activity-badge kind-${kind}`}>{kind}</span>
                  </div>
                  <span>{item.detail || ""}</span>
                  <div className="release-activity-row">
                    <span>
                      {formatRelativeEventLabel(item.created_at)}
                      {formatDateTimeShort(item.created_at) ? ` · ${formatDateTimeShort(item.created_at)}` : ""}
                    </span>
                    {jump ? (
                      <button className="btn ghost small" type="button" onClick={jump.action}>
                        {jump.label}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">
            {filter === "all" ? "Release timeline is still empty." : `No ${filter} activity yet.`}
          </div>
        )}
      </div>
    </div>
  );
}
