import React from "react";

const UNTITLED_GROUP = "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";
const LABEL_GROUP_DONE = "\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u0442\u0435\u043c\u0443 \u043a\u0430\u043a \u0433\u043e\u0442\u043e\u0432\u043e";
const LABEL_RESEARCH_TOPIC = "Research \u043f\u043e \u0442\u0435\u043c\u0435";
const LABEL_TOPIC_TAGS = "\u0422\u0435\u0433\u0438 \u0442\u0435\u043c\u044b";
const LABEL_SEARCH_HEADING = "\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0443";
const LABEL_EXPORT_XML_TOPIC = "\u042d\u043a\u0441\u043f\u043e\u0440\u0442 XML \u0442\u0435\u043c\u044b";
const LABEL_COLLAPSE = "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c";
const LABEL_EXPAND = "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c";

export function ScenarioGroupHeader({
  group,
  groupDone,
  groupDoneCount,
  groupTotalSegments,
  groupCompletionPercent,
  handleToggleGroupDone,
  handleAddLinksBlock,
  docId,
  loading,
  groupLoading,
  handleAiHelp,
  handleEditThemeTags,
  toggleHeadingSearch,
  headingRuQuery,
  headingEnQuery,
  handleExport,
  canExportGroupXml,
  isExpanded,
  toggleGroup
}) {
  const rawTitle = String(group?.title ?? "").trim();
  const groupTitle = rawTitle === UNTITLED_GROUP ? UNTITLED_GROUP : rawTitle;
  const progressLabel = groupTotalSegments > 0 ? `${groupCompletionPercent}%` : "0%";
  const progressTitle =
    groupTotalSegments > 0
      ? `${groupDoneCount}/${groupTotalSegments} \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u043e\u0432 \u0433\u043e\u0442\u043e\u0432\u044b`
      : "\u041d\u0435\u0442 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u043e\u0432 \u0432 \u0442\u0435\u043c\u0435";
  const hasTopicContext = Boolean(
    group?.section_id ||
      (rawTitle && rawTitle !== UNTITLED_GROUP) ||
      (Array.isArray(group?.topic_tags) && group.topic_tags.length > 0) ||
      (Array.isArray(group?.section_tags) && group.section_tags.length > 0) ||
      (Array.isArray(group?.items) && group.items.length > 0) ||
      group?.linkSegment
  );

  return (
    <div className="segment-group-header">
      <div className="segment-group-title">
        <div className="segment-group-title-row">
          <h3>{groupTitle}</h3>
          <span className={`segment-group-progress-badge${groupDone ? " is-complete" : ""}`} title={progressTitle}>
            {progressLabel}
          </span>
          <label className="done-toggle-inline segment-group-done-toggle" title={LABEL_GROUP_DONE}>
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
              <button className="btn ghost small" type="button" onClick={() => handleAddLinksBlock(group)} title="Add links">
                {"\uD83D\uDD17+"}
              </button>
            ) : null}
            {hasTopicContext ? (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => handleAiHelp(group.id)}
                disabled={!docId || loading || groupLoading}
                title={LABEL_RESEARCH_TOPIC}
                aria-label={LABEL_RESEARCH_TOPIC}
              >
                {groupLoading ? "..." : "\u2728"}
              </button>
            ) : null}
            {hasTopicContext ? (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => handleEditThemeTags?.(group.id)}
                disabled={loading}
                title={LABEL_TOPIC_TAGS}
                aria-label={LABEL_TOPIC_TAGS}
              >
                {"\uD83C\uDFF7"}
              </button>
            ) : null}
            <button
              className="btn ghost small segment-group-heading-toggle"
              type="button"
              onClick={() => toggleHeadingSearch(group.id, headingRuQuery, headingEnQuery)}
              disabled={!headingRuQuery}
              title={LABEL_SEARCH_HEADING}
              aria-label={LABEL_SEARCH_HEADING}
            >
              {"\uD83D\uDD0D"}
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() =>
                handleExport("xml", {
                  scope: "section",
                  section_id: group.section_id ?? "",
                  section_title: rawTitle === UNTITLED_GROUP ? "" : rawTitle,
                  segment_ids: Array.isArray(group?.items)
                    ? group.items
                        .map((item) => String(item?.segment?.segment_id ?? "").trim())
                        .filter(Boolean)
                    : []
                })
              }
              disabled={!canExportGroupXml}
              title={LABEL_EXPORT_XML_TOPIC}
              aria-label={LABEL_EXPORT_XML_TOPIC}
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
          title={isExpanded ? LABEL_COLLAPSE : LABEL_EXPAND}
          aria-label={isExpanded ? LABEL_COLLAPSE : LABEL_EXPAND}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "\u25B4" : "\u25BE"}
        </button>
      </div>
    </div>
  );
}
