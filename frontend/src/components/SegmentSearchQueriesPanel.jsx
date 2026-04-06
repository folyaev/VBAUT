import React from "react";

export function SegmentSearchQueriesPanel({
  segmentId,
  index,
  queriesValue,
  queryItems,
  searchEngines,
  maxQueries,
  normalizeQueryList,
  onSearchUpdate,
  onSearch,
  onCopy,
  onClearSearch
}) {
  return (
    <>
      <label>{"Поисковые запросы"}</label>
      <textarea
        value={queriesValue}
        onChange={(event) =>
          onSearchUpdate(index, {
            queries: normalizeQueryList(event.target.value, maxQueries)
          })
        }
        placeholder={"Каждый запрос с новой строки"}
      />
      {queryItems.length ? (
        <div className="query-list">
          {queryItems.map((query, queryIndex) => (
            <div key={`${segmentId}-query-${queryIndex}`} className="query-row">
              <span className="query-text">{query}</span>
              <div className="query-actions">
                {(searchEngines ?? []).map((engine) => (
                  <button
                    key={`${engine.id}-${queryIndex}`}
                    className="btn ghost small"
                    type="button"
                    onClick={() => onSearch(engine, query)}
                  >
                    {engine.label}
                  </button>
                ))}
                <button className="btn ghost small" type="button" onClick={() => onCopy(query)}>
                  {"Копировать"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="segment-actions">
        <button className="btn ghost small" onClick={() => onClearSearch(index)}>
          {"Очистить поисковые"}
        </button>
      </div>
    </>
  );
}
