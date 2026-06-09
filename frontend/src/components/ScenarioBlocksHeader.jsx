import React from "react";

export function ScenarioBlocksHeader({
  hasUnsavedChanges,
  handleSave,
  canSave,
  handleAddSegment,
  scenarioViewMode,
  setScenarioViewMode,
  linksPanelOpen,
  allScenarioLinksCount,
  handleToggleLinksPanel,
  handleOpenScriptTextMode,
  handleCopyForFigma,
  handleExport,
  handleConfigureXmlMediaRoot
}) {
  return (
    <div className="panel-header">
      <h2>Блоки сценария</h2>
      <div className="panel-actions panel-actions-blocks">
        <div className="scenario-view-toggle" role="group" aria-label="Scenario view">
          <button
            className={`btn ghost small${scenarioViewMode === "text" ? " is-active" : ""}`}
            type="button"
            onClick={() => setScenarioViewMode("text")}
          >
            Text
          </button>
          <button
            className={`btn ghost small${scenarioViewMode === "canvas" ? " is-active" : ""}`}
            type="button"
            onClick={() => setScenarioViewMode("canvas")}
          >
            Canvas
          </button>
          <button
            className={`btn ghost small${scenarioViewMode === "cards" ? " is-active" : ""}`}
            type="button"
            onClick={() => setScenarioViewMode("cards")}
          >
            Cards
          </button>
        </div>
        <button className={`btn save-btn${hasUnsavedChanges ? " is-dirty" : ""}`} onClick={handleSave} disabled={!canSave}>
          Сохранить
        </button>
        <button className="btn ghost" onClick={handleAddSegment}>
          Добавить сегмент
        </button>
        <button className="btn ghost" type="button" onClick={handleToggleLinksPanel}>
          {linksPanelOpen ? `Скрыть ссылки (${allScenarioLinksCount})` : `Все ссылки (${allScenarioLinksCount})`}
        </button>
        <button className="btn ghost" type="button" onClick={handleOpenScriptTextMode}>
          Text tab
        </button>
        <button className="btn ghost" type="button" onClick={handleCopyForFigma}>
          For Figma
        </button>
        <button className="btn ghost" type="button" onClick={() => handleExport("jsonl")}>
          Экспорт JSONL
        </button>
        <button className="btn ghost" type="button" onClick={() => handleExport("md")}>
          Экспорт MD
        </button>
        <button className="btn ghost" type="button" onClick={() => handleExport("xml")}>
          Экспорт XML
        </button>
        <button className="btn ghost" type="button" onClick={handleConfigureXmlMediaRoot}>
          XML путь
        </button>
      </div>
    </div>
  );
}
