import React from "react";

export function ScenarioEditorPanel({
  scenarioPanelOpen,
  setScenarioPanelOpen,
  handleStartNewScenario,
  loading,
  notionUrl,
  setNotionUrl,
  handleLoadNotion,
  canLoadNotion,
  handleRefreshNotion,
  canRefreshNotion,
  scriptText,
  setScriptText,
  handleGenerate,
  canGenerate,
  notionHasUpdates,
  handleMarkAllDone,
  segmentsCount
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{"Сценарий"}</h2>
        <div className="panel-actions panel-actions-scenario-toggle">
          <button
            className="btn ghost small segment-group-expand-icon scenario-panel-toggle"
            type="button"
            onClick={() => setScenarioPanelOpen((prev) => !prev)}
            title={scenarioPanelOpen ? "Свернуть" : "Развернуть"}
            aria-label={scenarioPanelOpen ? "Свернуть" : "Развернуть"}
            aria-expanded={scenarioPanelOpen}
          >
            {scenarioPanelOpen ? "▴" : "▾"}
          </button>
        </div>
      </div>
      {scenarioPanelOpen ? (
        <>
          <div className="panel-actions panel-actions-scenario">
            <button className="btn ghost" onClick={handleStartNewScenario} disabled={loading}>
              {"Новый сценарий"}
            </button>
            <div className="doc-loader notion-loader">
              <input
                className="notion-url-input"
                type="url"
                value={notionUrl}
                onChange={(event) => setNotionUrl(event.target.value)}
                placeholder={"Ссылка на Notion"}
              />
              <button className="btn ghost notion-load-btn" onClick={handleLoadNotion} disabled={!canLoadNotion}>
                {"Загрузить Notion"}
              </button>
              <button
                className="btn ghost icon-btn notion-refresh-btn"
                onClick={handleRefreshNotion}
                disabled={!canRefreshNotion}
                title={"Обновить из Notion"}
                aria-label={"Обновить из Notion"}
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 12a8 8 0 0 1 13.66-5.66L20 8V3h-5l2.22 2.22A10 10 0 1 0 22 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <textarea
            className="script-input"
            placeholder={"Вставьте готовый текст сценария..."}
            value={scriptText}
            onChange={(event) => setScriptText(event.target.value)}
          />
          <div className="panel-actions panel-actions-scenario panel-actions-scenario-footer">
            <button className="btn ghost" onClick={handleGenerate} disabled={!canGenerate}>
              {"Сегментировать"}
              {notionHasUpdates ? <span className="badge">NEW</span> : null}
            </button>
            <button className="btn ghost" type="button" onClick={handleMarkAllDone} disabled={segmentsCount === 0}>
              {"Готово"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
