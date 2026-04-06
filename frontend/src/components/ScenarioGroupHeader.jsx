import React from "react";

export function ScenarioGroupHeader({
  group,
  groupDone,
  handleToggleGroupDone,
  handleAddLinksBlock,
  docId,
  loading,
  groupLoading,
  handleAiHelp,
  toggleHeadingSearch,
  headingRuQuery,
  headingEnQuery,
  handleExport,
  canExportGroupXml,
  isExpanded,
  toggleGroup
}) {
  const groupTitle = group.title === "Без темы" ? "Без темы" : group.title;

  return (
    <div className="segment-group-header">
      <div className="segment-group-title">
        <div className="segment-group-title-row">
          <h3>{groupTitle}</h3>
          <label className="done-toggle-inline segment-group-done-toggle" title="Отметить тему как готово">
            <input
              type="checkbox"
              checked={groupDone}
              onChange={(event) => handleToggleGroupDone(group.id, event.target.checked)}
            />
          </label>
        </div>
        <div className="segment-group-controls">
          <div className="segment-group-actions">
            {!group.linkSegment ? (
              <button className="btn ghost small" type="button" onClick={() => handleAddLinksBlock(group)}>
                🔗+
              </button>
            ) : null}
            {group.items.length > 0 ? (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => handleAiHelp(group.id)}
                disabled={!docId || loading || groupLoading}
                title="AI Help"
                aria-label="AI Help"
              >
                {groupLoading ? "..." : "✨"}
              </button>
            ) : null}
            <button
              className="btn ghost small segment-group-heading-toggle"
              type="button"
              onClick={() => toggleHeadingSearch(group.id, headingRuQuery, headingEnQuery)}
              disabled={!headingRuQuery}
              title="Поиск по заголовку"
              aria-label="Поиск по заголовку"
            >
              🔍
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() =>
                handleExport("xml", {
                  scope: "section",
                  section_id: group.section_id ?? "",
                  section_title: group.title === "Без темы" ? "" : group.title
                })
              }
              disabled={!canExportGroupXml}
              title="Экспорт XML темы"
              aria-label="Экспорт XML темы"
            >
              XML
            </button>
          </div>
        </div>
      </div>
      <div className="segment-group-right">
        <button
          className="btn ghost small segment-group-expand segment-group-expand-icon"
          type="button"
          onClick={() => toggleGroup(group.id)}
          title={isExpanded ? "Свернуть" : "Развернуть"}
          aria-label={isExpanded ? "Свернуть" : "Развернуть"}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "▴" : "▾"}
        </button>
      </div>
    </div>
  );
}
