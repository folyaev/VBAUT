import React from "react";

export function SegmentResearchToolbar({
  index,
  onSearchGenerate,
  searchLoading,
  onSearchToggle,
  isSearchOpen,
  queryItemsCount,
  onResearchRun,
  researchLoading,
  onOpenResearchWorkspace
}) {
  const searchToggleLabel = isSearchOpen
    ? "Скрыть поисковые запросы"
    : `Показать поисковые запросы (${queryItemsCount})`;

  return (
    <div className="search-toggle">
      <button className="btn ghost small" type="button" onClick={() => onSearchGenerate(index)} disabled={searchLoading}>
        {searchLoading ? "..." : "✨"}
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() => onSearchToggle(index)}
        title={searchToggleLabel}
        aria-label={searchToggleLabel}
      >
        🔍
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() => onResearchRun(index, "fast")}
        disabled={researchLoading}
        title="Найти источники и визуальные ссылки"
        aria-label="Найти источники и визуальные ссылки"
      >
        {researchLoading ? "..." : "Research"}
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() => onResearchRun(index, "deep")}
        disabled={researchLoading}
        title="Глубокий research по сегменту"
        aria-label="Глубокий research по сегменту"
      >
        {researchLoading ? "..." : "Deep"}
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() => onOpenResearchWorkspace?.()}
      >
        Open
      </button>
    </div>
  );
}
