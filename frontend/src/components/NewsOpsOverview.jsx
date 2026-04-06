import React from "react";

export function NewsOpsOverview({
  integrationOverview,
  integrationAssets,
  integrationBotSessions,
  integrationReleases,
  segmentsNeedingVisual,
  formatAssetKindLabel,
  formatDateTimeShort,
  handleOpenSegmentScreenshotMode
}) {
  return (
    <>
      <div className="integration-stats">
        <div className="integration-stat-card">
          <span>Assets</span>
          <strong>{integrationOverview?.counts?.assets ?? 0}</strong>
        </div>
        <div className="integration-stat-card">
          <span>Attachments</span>
          <strong>{integrationOverview?.counts?.attachments ?? 0}</strong>
        </div>
        <div className="integration-stat-card">
          <span>Releases</span>
          <strong>{integrationOverview?.counts?.releases ?? 0}</strong>
        </div>
        <div className="integration-stat-card">
          <span>Bot Sessions</span>
          <strong>{integrationOverview?.counts?.bot_sessions ?? 0}</strong>
        </div>
      </div>

      <div className="integration-card needs-visual-card">
        <div className="integration-card-head">
          <strong>Последние assets</strong>
          <span>{integrationAssets.length}</span>
        </div>
        {integrationAssets.length > 0 ? (
          <div className="integration-list">
            {integrationAssets.map((asset) => (
              <div key={asset.id} className="integration-row">
                <div className="integration-row-main">
                  <strong>{asset.title || asset.file_name || asset.id}</strong>
                  <span>
                    {formatAssetKindLabel(asset.kind)}
                    {asset.source_domain ? ` · ${asset.source_domain}` : ""}
                    {asset.meta_json?.section_title ? ` · ${asset.meta_json.section_title}` : ""}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{formatDateTimeShort(asset.updated_at || asset.created_at)}</span>
                  <code>{asset.local_path || asset.source_url || asset.id}</code>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Пока пусто. Новые ссылки, заметки и медиа из Telegram появятся здесь.</div>
        )}
      </div>

      <div className="integration-card">
        <div className="integration-card-head">
          <strong>Активные сессии бота</strong>
          <span>{integrationBotSessions.length}</span>
        </div>
        {integrationBotSessions.length > 0 ? (
          <div className="integration-list">
            {integrationBotSessions.slice(0, 8).map((session) => (
              <div key={session.id} className="integration-row">
                <div className="integration-row-main">
                  <strong>{session.mode || "inbox"}</strong>
                  <span>
                    chat {session.chat_id}
                    {session.active_document_id ? ` · ${session.active_document_id}` : ""}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{session.active_segment_id || "без сегмента"}</span>
                  <span>{formatDateTimeShort(session.last_seen_at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Сессий пока нет. После /sdvg и входящих сообщений бот начнёт заполнять этот блок.</div>
        )}
      </div>

      <div className="integration-card">
        <div className="integration-card-head">
          <strong>Releases</strong>
          <span>{integrationReleases.length}</span>
        </div>
        {integrationReleases.length > 0 ? (
          <div className="integration-list">
            {integrationReleases.slice(0, 8).map((release) => (
              <div key={release.id} className="integration-row">
                <div className="integration-row-main">
                  <strong>{release.title || release.id}</strong>
                  <span>
                    {release.status || "draft"}
                    {release.document_id ? ` · ${release.document_id}` : ""}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{release.air_date || "без даты"}</span>
                  <span>{formatDateTimeShort(release.updated_at || release.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Release-слой уже подключен по API, но в UI ещё не создавался ни один выпуск.</div>
        )}
      </div>

      <div className="integration-card">
        <div className="integration-card-head">
          <strong>Needs Visual</strong>
          <span>{segmentsNeedingVisual.length}</span>
        </div>
        {segmentsNeedingVisual.length > 0 ? (
          <div className="integration-list">
            {segmentsNeedingVisual.slice(0, 8).map((item) => (
              <div key={item.segmentId} className="integration-row newsroom-row">
                <div className="integration-row-main">
                  <strong>{item.segmentId}</strong>
                  <span>
                    {item.sectionTitle || "без темы"}
                    {item.isDone ? " · done" : " · open"}
                    {item.links.length ? ` · links ${item.links.length}` : " · links 0"}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{item.quote}</span>
                </div>
                <div className="newsroom-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleOpenSegmentScreenshotMode(item)}
                    disabled={item.links.length === 0}
                  >
                    Screenshot segment
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Сегментов без визуала сейчас нет.</div>
        )}
      </div>
    </>
  );
}
