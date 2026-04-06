import React from "react";

export function ReleaseWorkspaceBoard({
  releaseBoardFilter,
  setReleaseBoardFilter,
  releaseBoardCounts,
  releaseBoardColumns,
  releaseBoardGroups,
  formatReleaseItemStatusLabel
}) {
  return (
    <div className="release-workspace-section">
      <div className="release-board-toolbar">
        <button
          className={`btn ghost small${releaseBoardFilter === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setReleaseBoardFilter("all")}
        >
          All {releaseBoardCounts.all}
        </button>
        <button
          className={`btn ghost small${releaseBoardFilter === "missing_script" ? " is-active" : ""}`}
          type="button"
          onClick={() => setReleaseBoardFilter("missing_script")}
        >
          No Script {releaseBoardCounts.missing_script}
        </button>
        <button
          className={`btn ghost small${releaseBoardFilter === "missing_visual" ? " is-active" : ""}`}
          type="button"
          onClick={() => setReleaseBoardFilter("missing_visual")}
        >
          No Visual {releaseBoardCounts.missing_visual}
        </button>
        <button
          className={`btn ghost small${releaseBoardFilter === "needs_link" ? " is-active" : ""}`}
          type="button"
          onClick={() => setReleaseBoardFilter("needs_link")}
        >
          No Link {releaseBoardCounts.needs_link}
        </button>
      </div>
      <div className="release-board">
        {releaseBoardColumns.map((column) => {
          const items = releaseBoardGroups.get(column) ?? [];
          return (
            <div key={column} className="release-board-column">
              <div className="release-board-head">
                <strong>{formatReleaseItemStatusLabel(column)}</strong>
                <span>{items.length}</span>
              </div>
              {items.length > 0 ? (
                <div className="release-board-list">
                  {items.map((item) => (
                    <div key={`board-${item.attachment?.id}`} className="release-board-card">
                      <strong>
                        {Number(item.attachment?.sort_order ?? 0) > 0 ? `${item.attachment.sort_order}. ` : ""}
                        {item.asset?.title || item.asset?.file_name || item.asset?.id}
                      </strong>
                      <span>{item.asset?.meta_json?.section_title || item.asset?.source_domain || "без темы"}</span>
                      <span>
                        {item.attachment?.script_note ? "script ok" : "script missing"}
                        {" · "}
                        {item.attachment?.visual_note ? "visual ok" : "visual missing"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">Пусто</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
