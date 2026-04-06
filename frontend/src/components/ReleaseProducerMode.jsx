import React from "react";

export function ReleaseProducerMode({
  theme,
  handleThemeToggle,
  integrationReleases,
  selectedReleaseId,
  setSelectedReleaseId,
  selectedReleaseDetail,
  releaseSummary,
  releaseControlPanel,
  releaseBriefingPanel,
  releasePublishChecklistSummary,
  releasePublishChecklistItems,
  effectiveReleaseAssistantFindings,
  selectedReleaseAssets,
  releaseActivity,
  releaseBusy,
  handleRefreshProducerView,
  handlePrepareRelease,
  handleMarkReleaseAirReady,
  handlePublishRelease,
  handleOpenReleaseScreenshotMode,
  handleExportReleaseBrief,
  handleOpenOnAirMode,
  formatReleaseItemStatusLabel,
  formatDateTimeShort,
  formatRelativeEventLabel,
  handleExitProducerMode
}) {
  const problematicChecks = Array.isArray(releasePublishChecklistItems)
    ? releasePublishChecklistItems.filter((item) => String(item?.status ?? "").toLowerCase() !== "pass")
    : [];
  const visibleRundown = Array.isArray(selectedReleaseAssets) ? selectedReleaseAssets.slice(0, 8) : [];
  const visibleActivity = Array.isArray(releaseActivity) ? releaseActivity.slice(0, 6) : [];

  return (
    <div className="producer-shell">
      <header className="producer-hero panel">
        <div className="producer-copy">
          <p className="eyebrow">Remote Producer Mode</p>
          <h1>{selectedReleaseDetail?.title || "Release Control"}</h1>
          <p className="subtitle">
            Компактный пульт выпуска для localhost и ngrok: состояние, блокеры, rundown и быстрые действия.
          </p>
          <div className="producer-meta">
            <span>{releaseControlPanel.title}</span>
            <span>{String(releaseControlPanel.status_code ?? "").replace(/_/g, " ")}</span>
            <span>Auto refresh 15s</span>
            {selectedReleaseDetail?.air_date ? <span>{selectedReleaseDetail.air_date}</span> : null}
          </div>
        </div>
        <div className="producer-tools">
          <button
            className="theme-toggle"
            type="button"
            onClick={handleThemeToggle}
            aria-label="Переключить тему"
            title="Переключить тему"
          >
            <span className="theme-dot" aria-hidden="true" />
            {theme === "dark" ? "Темная" : "Светлая"}
          </button>
          <div className="producer-release-picker">
            <label htmlFor="producer-release-picker">Release</label>
            <select
              id="producer-release-picker"
              value={selectedReleaseId}
              onChange={(event) => setSelectedReleaseId(event.target.value)}
            >
              {integrationReleases.length > 0 ? (
                integrationReleases.map((release) => (
                  <option key={release.id} value={release.id}>
                    {release.title || release.id} · {release.status}
                  </option>
                ))
              ) : (
                <option value="">Нет выпусков</option>
              )}
            </select>
          </div>
          <div className="producer-toolbar">
            <button className="btn ghost small" type="button" onClick={handleRefreshProducerView} disabled={releaseBusy}>
              Refresh
            </button>
            <button className="btn ghost small" type="button" onClick={handleOpenOnAirMode}>
              On Air
            </button>
            <button className="btn ghost small" type="button" onClick={handleExitProducerMode}>
              Workspace
            </button>
          </div>
        </div>
      </header>

      {selectedReleaseDetail ? (
        <>
          <section className="producer-grid">
            <div className="panel producer-card">
              <div className="producer-card-head">
                <strong>Release Control</strong>
                <span>{releaseBusy ? "busy" : "live"}</span>
              </div>
              <div className="producer-actions">
                <button className="btn ghost small" type="button" onClick={handlePrepareRelease} disabled={releaseBusy}>
                  Prepare
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleMarkReleaseAirReady}
                  disabled={releaseBusy || !releaseControlPanel.can_mark_air_ready}
                >
                  Air Ready
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handlePublishRelease}
                  disabled={releaseBusy || !releaseControlPanel.can_publish}
                >
                  Publish
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleOpenReleaseScreenshotMode}
                  disabled={visibleRundown.length === 0}
                >
                  Screenshot
                </button>
                <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("md")}>
                  Export MD
                </button>
                <button className="btn ghost small" type="button" onClick={() => handleExportReleaseBrief("json")}>
                  Export JSON
                </button>
              </div>
              <div className="producer-note">{releaseControlPanel.detail}</div>
              {Array.isArray(releaseControlPanel.actions) && releaseControlPanel.actions.length > 0 ? (
                <div className="producer-list">
                  {releaseControlPanel.actions.map((item) => (
                    <div key={`producer-action-${item.key}`} className="producer-list-item">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="producer-note">Дополнительных действий сейчас не требуется.</div>
              )}
            </div>

            <div className="panel producer-card">
              <div className="producer-card-head">
                <strong>Release Briefing</strong>
                <span>{releaseBriefingPanel.status_code || "live"}</span>
              </div>
              <div className="producer-note">{releaseBriefingPanel.summary_text || releaseBriefingPanel.headline}</div>
              <div className="producer-list">
                {(Array.isArray(releaseBriefingPanel.risks) ? releaseBriefingPanel.risks : []).slice(0, 3).map((item, index) => (
                  <div key={`producer-risk-${index}`} className="producer-list-item">
                    <strong>Risk</strong>
                    <span>{item}</span>
                  </div>
                ))}
                {(Array.isArray(releaseBriefingPanel.next_steps) ? releaseBriefingPanel.next_steps : [])
                  .slice(0, 3)
                  .map((item, index) => (
                    <div key={`producer-next-${index}`} className="producer-list-item">
                      <strong>Next</strong>
                      <span>{item}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          <section className="release-summary-grid producer-summary-grid">
            <div className="release-summary-card">
              <span>Total</span>
              <strong>{releaseSummary.total}</strong>
            </div>
            <div className="release-summary-card">
              <span>Ready</span>
              <strong>{releaseSummary.ready}</strong>
            </div>
            <div className="release-summary-card">
              <span>No Script</span>
              <strong>{releaseSummary.missing_script}</strong>
            </div>
            <div className="release-summary-card">
              <span>No Visual</span>
              <strong>{releaseSummary.missing_visual}</strong>
            </div>
            <div className="release-summary-card">
              <span>Checks</span>
              <strong>{releasePublishChecklistSummary.total_checks}</strong>
            </div>
            <div className="release-summary-card">
              <span>Findings</span>
              <strong>{effectiveReleaseAssistantFindings.length}</strong>
            </div>
          </section>

          <section className="producer-grid producer-grid-bottom">
            <div className="panel producer-card">
              <div className="producer-card-head">
                <strong>Blocking Checks</strong>
                <span>{problematicChecks.length}</span>
              </div>
              {problematicChecks.length > 0 ? (
                <div className="producer-list">
                  {problematicChecks.slice(0, 8).map((item) => (
                    <div key={`producer-check-${item.key}`} className="producer-list-item">
                      <strong>
                        {item.title} · {String(item.status ?? "").toUpperCase()}
                      </strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="producer-note">Blocking checks закрыты. Выпуск можно двигать дальше по эфиру.</div>
              )}
            </div>

            <div className="panel producer-card">
              <div className="producer-card-head">
                <strong>Rundown</strong>
                <span>{selectedReleaseAssets.length}</span>
              </div>
              {visibleRundown.length > 0 ? (
                <div className="producer-rundown-list">
                  {visibleRundown.map((item, index) => {
                    const asset = item?.asset ?? {};
                    const attachment = item?.attachment ?? {};
                    return (
                      <div key={attachment.id || asset.id || index} className="producer-rundown-item">
                        <strong>
                          {index + 1}. {asset.title || asset.file_name || asset.id || "Untitled asset"}
                        </strong>
                        <span>{formatReleaseItemStatusLabel(attachment.item_status)}</span>
                        <span>{attachment.visual_note || attachment.script_note || asset.source_domain || "без заметок"}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="producer-note">Выпуск пока пустой.</div>
              )}
            </div>
          </section>

          <section className="panel producer-card">
            <div className="producer-card-head">
              <strong>Timeline</strong>
              <span>{releaseActivity.length}</span>
            </div>
            {visibleActivity.length > 0 ? (
              <div className="producer-list">
                {visibleActivity.map((item) => (
                  <div key={item.id} className="producer-list-item">
                    <strong>{item.event}</strong>
                    <span>{item.detail || "Без деталей"}</span>
                    <span>
                      {formatRelativeEventLabel(item.created_at)}
                      {formatDateTimeShort(item.created_at) ? ` · ${formatDateTimeShort(item.created_at)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="producer-note">История выпуска пока пустая.</div>
            )}
          </section>
        </>
      ) : (
        <section className="panel producer-card">
          <div className="producer-card-head">
            <strong>Release Control</strong>
            <span>empty</span>
          </div>
          <div className="producer-note">
            Выпуск ещё не выбран. Выберите release сверху или создайте его в основном workspace.
          </div>
        </section>
      )}
    </div>
  );
}
