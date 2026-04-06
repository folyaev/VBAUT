import React from "react";
import { ReleaseWorkspace } from "./ReleaseWorkspace.jsx";
import { buildSourceMetadataBadges } from "../utils/sourceMetadata.js";

export function NewsroomWorkspace({
  integrationQuery,
  setIntegrationQuery,
  integrationKind,
  setIntegrationKind,
  integrationStatusFilter,
  setIntegrationStatusFilter,
  integrationOverview,
  inboxAssets,
  filteredLibraryAssets,
  formatAssetKindLabel,
  formatDateTimeShort,
  handleAssetStatusUpdate,
  assetActionBusy,
  handleAttachAssetToRelease,
  selectedReleaseId,
  releaseDraftTitle,
  setReleaseDraftTitle,
  releaseDraftDate,
  setReleaseDraftDate,
  handleCreateRelease,
  releaseBusy,
  integrationReleases,
  setSelectedReleaseId,
  handleOpenReleaseScreenshotMode,
  releaseScreenshotSourceCount,
  handleOpenProducerMode,
  handleOpenOnAirMode,
  handleOpenAssetScreenshotMode,
  releaseWorkspaceProps,
  sourceProfiles,
  appMode = "workspace"
}) {
  const selectedReleaseAssetsCount = Array.isArray(releaseWorkspaceProps?.selectedReleaseAssets)
    ? releaseWorkspaceProps.selectedReleaseAssets.length
    : 0;

  return (
    <section className="panel newsroom-panel">
      <div className="panel-header">
        <h2>Inbox / Library / Releases</h2>
        <div className="panel-actions">
          <input
            className="newsroom-search"
            value={integrationQuery}
            onChange={(event) => setIntegrationQuery(event.target.value)}
            placeholder="Поиск по assets, ссылкам, темам"
          />
          <select value={integrationKind} onChange={(event) => setIntegrationKind(event.target.value)}>
            <option value="">Все типы</option>
            <option value="link">Ссылки</option>
            <option value="note">Заметки</option>
            <option value="telegram_media">Telegram media</option>
            <option value="downloaded_media">Скачанное медиа</option>
          </select>
          <select value={integrationStatusFilter} onChange={(event) => setIntegrationStatusFilter(event.target.value)}>
            <option value="">Все статусы</option>
            <option value="new">new</option>
            <option value="processed">processed</option>
            <option value="attached">attached</option>
            <option value="archived">archived</option>
          </select>
        </div>
      </div>
      <div className="newsroom-grid">
        {(appMode === "workspace" || appMode === "inbox") && (
        <div className="integration-card">
          <div className="integration-card-head">
            <strong>Inbox</strong>
            <span>{integrationOverview?.counts?.inbox_assets ?? inboxAssets.length}</span>
          </div>
          {inboxAssets.length > 0 ? (
            <div className="integration-list">
              {inboxAssets.map((asset) => {
                const metadataBadges = buildSourceMetadataBadges(asset, sourceProfiles);
                return (
                  <div key={`inbox-${asset.id}`} className="integration-row newsroom-row">
                    <div className="integration-row-main">
                      <strong>{asset.title || asset.file_name || asset.id}</strong>
                      <span>
                        {formatAssetKindLabel(asset.kind)}
                        {asset.meta_json?.section_title ? ` · ${asset.meta_json.section_title}` : ""}
                        {asset.source_domain ? ` · ${asset.source_domain}` : ""}
                      </span>
                      {metadataBadges.length > 0 ? (
                        <div className="release-trace-badges newsroom-metadata-badges">
                          {metadataBadges.map((badge) => (
                            <span key={`inbox-meta-${asset.id}-${badge}`} className="release-trace-badge">
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="integration-row-side">
                      <span>{formatDateTimeShort(asset.updated_at || asset.created_at)}</span>
                      <code>{asset.local_path || asset.source_url || asset.id}</code>
                    </div>
                    <div className="newsroom-actions">
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleAssetStatusUpdate(asset.id, "processed")}
                        disabled={Boolean(assetActionBusy[asset.id])}
                      >
                        Разобрано
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleAttachAssetToRelease(asset.id)}
                        disabled={!selectedReleaseId || Boolean(assetActionBusy[asset.id])}
                      >
                        В выпуск
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted">Inbox пуст. Новые Telegram-объекты сюда уже падают автоматически.</div>
          )}
        </div>
        )}

        {(appMode === "workspace" || appMode === "library") && (
        <div className="integration-card">
          <div className="integration-card-head">
            <strong>Library</strong>
            <span>{filteredLibraryAssets.length}</span>
          </div>
          {filteredLibraryAssets.length > 0 ? (
            <div className="integration-list newsroom-library-list">
              {filteredLibraryAssets.slice(0, 18).map((asset) => {
                const metadataBadges = buildSourceMetadataBadges(asset, sourceProfiles);
                return (
                  <div key={`library-${asset.id}`} className="integration-row newsroom-row">
                    <div className="integration-row-main">
                      <strong>{asset.title || asset.file_name || asset.id}</strong>
                      <span>
                        {formatAssetKindLabel(asset.kind)}
                        {asset.status ? ` · ${asset.status}` : ""}
                        {asset.attachment_count ? ` · targets ${asset.attachment_count}` : ""}
                      </span>
                      {metadataBadges.length > 0 ? (
                        <div className="release-trace-badges newsroom-metadata-badges">
                          {metadataBadges.map((badge) => (
                            <span key={`library-meta-${asset.id}-${badge}`} className="release-trace-badge">
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="integration-row-side">
                      <span>{asset.meta_json?.section_title || asset.source_domain || "без темы"}</span>
                      <code>{asset.local_path || asset.source_url || asset.id}</code>
                    </div>
                    <div className="newsroom-actions">
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleOpenAssetScreenshotMode(asset)}
                        disabled={!asset.source_url}
                      >
                        Скрин
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleAttachAssetToRelease(asset.id)}
                        disabled={!selectedReleaseId || Boolean(assetActionBusy[asset.id])}
                      >
                        В выпуск
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleAssetStatusUpdate(asset.id, "archived")}
                        disabled={Boolean(assetActionBusy[asset.id])}
                      >
                        Архив
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted">По текущим фильтрам assets не найдены.</div>
          )}
        </div>
        )}

        {(appMode === "workspace" || appMode === "releases") && (
        <div className="integration-card">
          <div className="integration-card-head">
            <strong>Release Builder</strong>
            <span>{selectedReleaseAssetsCount}</span>
          </div>
          <form className="release-form" onSubmit={handleCreateRelease}>
            <input
              value={releaseDraftTitle}
              onChange={(event) => setReleaseDraftTitle(event.target.value)}
              placeholder="Название выпуска"
            />
            <input
              type="date"
              value={releaseDraftDate}
              onChange={(event) => setReleaseDraftDate(event.target.value)}
            />
            <button className="btn ghost small" type="submit" disabled={releaseBusy || !releaseDraftTitle.trim()}>
              {releaseBusy ? "Создаю..." : "Новый выпуск"}
            </button>
          </form>
          {integrationReleases.length > 0 ? (
            <div className="release-selector">
              <div className="release-selector-row">
                <select value={selectedReleaseId} onChange={(event) => setSelectedReleaseId(event.target.value)}>
                  {integrationReleases.map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.title || release.id} · {release.status} · {release.asset_count ?? 0}
                    </option>
                  ))}
                </select>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleOpenReleaseScreenshotMode}
                  disabled={releaseScreenshotSourceCount === 0}
                >
                  Screenshot release
                </button>
                <button className="btn ghost small" type="button" onClick={handleOpenProducerMode}>
                  Producer View
                </button>
                <button className="btn ghost small" type="button" onClick={handleOpenOnAirMode}>
                  On Air View
                </button>
              </div>
            </div>
          ) : (
            <div className="muted">Создай первый выпуск, и сюда можно будет складывать assets.</div>
          )}
          {releaseWorkspaceProps?.selectedReleaseDetail ? <ReleaseWorkspace {...releaseWorkspaceProps} /> : null}
        </div>
        )}
      </div>
    </section>
  );
}
