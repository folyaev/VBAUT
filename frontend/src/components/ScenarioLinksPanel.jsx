import React from "react";

export function ScenarioLinksPanel({
  allScenarioLinks,
  handleOpenAllLinksScreenshotMode,
  getReadableLinkLabel,
  isMediaDownloadSupported,
  isMediaDownloaded,
  handleDownloadMedia,
  isMediaDownloadBusy,
  handleCopy
}) {
  return (
    <div className="all-links-panel">
      <div className="all-links-panel-head">
        <div className="all-links-panel-title">
          <strong>Все ссылки сценария</strong>
          <span>{allScenarioLinks.length}</span>
        </div>
        <div className="query-actions">
          <button
            className="btn ghost small"
            type="button"
            onClick={handleOpenAllLinksScreenshotMode}
            disabled={allScenarioLinks.length === 0}
          >
            📸 Screenshot mode
          </button>
        </div>
      </div>
      {allScenarioLinks.length === 0 ? (
        <div className="links-empty">Ссылок пока нет.</div>
      ) : (
        <div className="all-links-list">
          {allScenarioLinks.map((item, index) => (
            <div key={`${item.url}-${index}`} className="all-links-row">
              <div className="all-links-meta">
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {getReadableLinkLabel(item.url)}
                </a>
                <span>{item.sectionTitle}</span>
              </div>
              <div className="query-actions">
                {(isMediaDownloadSupported(item.url) || isMediaDownloaded(item.url)) ? (
                  isMediaDownloaded(item.url) ? (
                    <button className="btn ghost small" type="button" disabled>
                      Скачано
                    </button>
                  ) : (
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => handleDownloadMedia(item.url, item.sectionTitle)}
                      disabled={isMediaDownloadBusy(item.url)}
                    >
                      Скачать
                    </button>
                  )
                ) : null}
                <button className="btn ghost small" type="button" onClick={() => handleCopy(item.url)}>
                  Копировать
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
