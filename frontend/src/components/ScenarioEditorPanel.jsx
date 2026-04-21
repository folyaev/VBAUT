import React from "react";

const LABEL_SCENARIO = "\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439";
const LABEL_NEW_SCENARIO = "\u041d\u043e\u0432\u044b\u0439 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u0439";
const LABEL_NOTION_PLACEHOLDER = "\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 Notion";
const LABEL_LOAD_NOTION = "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c Notion";
const LABEL_REFRESH_NOTION = "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0438\u0437 Notion";
const LABEL_SCRIPT_PLACEHOLDER = "\u0412\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f...";
const LABEL_GENERATE = "\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c";
const LABEL_RECOVER_STATE = "\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c state";
const LABEL_RECOVER_STATE_TITLE =
  "\u0412\u0435\u0440\u043d\u0443\u0442\u044c done \u0438 media \u0438\u0437 \u0438\u0441\u0442\u043e\u0440\u0438\u0438 \u0432\u0435\u0440\u0441\u0438\u0439";
const LABEL_DONE = "\u0413\u043e\u0442\u043e\u0432\u043e";
const LABEL_COLLAPSE = "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c";
const LABEL_EXPAND = "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c";

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
  handleRecoverSegmentState,
  canRecoverSegmentState,
  notionHasUpdates,
  handleMarkAllDone,
  segmentsCount
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{LABEL_SCENARIO}</h2>
        <div className="panel-actions panel-actions-scenario-toggle">
          <button
            className="btn ghost small segment-group-expand-icon scenario-panel-toggle"
            type="button"
            onClick={() => setScenarioPanelOpen((prev) => !prev)}
            title={scenarioPanelOpen ? LABEL_COLLAPSE : LABEL_EXPAND}
            aria-label={scenarioPanelOpen ? LABEL_COLLAPSE : LABEL_EXPAND}
            aria-expanded={scenarioPanelOpen}
          >
            {scenarioPanelOpen ? "\u25B4" : "\u25BE"}
          </button>
        </div>
      </div>
      {scenarioPanelOpen ? (
        <>
          <div className="panel-actions panel-actions-scenario">
            <button className="btn ghost" onClick={handleStartNewScenario} disabled={loading}>
              {LABEL_NEW_SCENARIO}
            </button>
            <div className="doc-loader notion-loader">
              <input
                className="notion-url-input"
                type="url"
                value={notionUrl}
                onChange={(event) => setNotionUrl(event.target.value)}
                placeholder={LABEL_NOTION_PLACEHOLDER}
              />
              <button className="btn ghost notion-load-btn" onClick={handleLoadNotion} disabled={!canLoadNotion}>
                {LABEL_LOAD_NOTION}
              </button>
              <button
                className="btn ghost icon-btn notion-refresh-btn"
                onClick={handleRefreshNotion}
                disabled={!canRefreshNotion}
                title={LABEL_REFRESH_NOTION}
                aria-label={LABEL_REFRESH_NOTION}
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
            placeholder={LABEL_SCRIPT_PLACEHOLDER}
            value={scriptText}
            onChange={(event) => setScriptText(event.target.value)}
          />
          <div className="panel-actions panel-actions-scenario panel-actions-scenario-footer">
            <button className="btn ghost" onClick={handleGenerate} disabled={!canGenerate}>
              {LABEL_GENERATE}
              {notionHasUpdates ? <span className="badge">NEW</span> : null}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={handleRecoverSegmentState}
              disabled={!canRecoverSegmentState}
              title={LABEL_RECOVER_STATE_TITLE}
            >
              {LABEL_RECOVER_STATE}
            </button>
            <button className="btn ghost" type="button" onClick={handleMarkAllDone} disabled={segmentsCount === 0}>
              {LABEL_DONE}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
