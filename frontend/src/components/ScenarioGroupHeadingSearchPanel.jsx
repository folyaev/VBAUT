import React from "react";

export function ScenarioGroupHeadingSearchPanel({
  groupId,
  headingRuQuery,
  headingEnQuery,
  headingRuEngines,
  headingEnEngines,
  handleSearch,
  handleHeadingEnglishQueryChange,
  translateHeadingQuery,
  headingTranslateLoading
}) {
  return (
    <div className="heading-search-panel">
      <div className="heading-search-grid">
        <div className="heading-search-col">
          <label>RU (как в заголовке)</label>
          <input value={headingRuQuery} readOnly />
          <div className="query-actions">
            {headingRuEngines.map((engine) => (
              <button
                key={`${groupId}-${engine.id}-ru`}
                className="btn ghost small"
                type="button"
                onClick={() => handleSearch(engine, headingRuQuery)}
                disabled={!headingRuQuery}
              >
                {engine.label}
              </button>
            ))}
          </div>
        </div>
        <div className="heading-search-col">
          <label>EN query</label>
          <input
            value={headingEnQuery}
            onChange={(event) => handleHeadingEnglishQueryChange(groupId, event.target.value)}
            placeholder="English query"
          />
          <div className="query-actions">
            <button
              className="btn ghost small"
              type="button"
              onClick={() => translateHeadingQuery(groupId, headingRuQuery, { force: true })}
              disabled={!headingRuQuery || headingTranslateLoading}
            >
              {headingTranslateLoading ? "Перевод..." : "Перевести EN"}
            </button>
            {headingEnEngines.map((engine) => (
              <button
                key={`${groupId}-${engine.id}-en`}
                className="btn ghost small"
                type="button"
                onClick={() => handleSearch(engine, headingEnQuery)}
                disabled={!headingEnQuery.trim()}
              >
                {engine.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
