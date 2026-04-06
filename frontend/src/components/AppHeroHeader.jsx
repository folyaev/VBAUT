import React from "react";

export function AppHeroHeader({
  theme,
  handleThemeToggle,
  handleOpenNewsroom,
  docId,
  status,
  recentDocId,
  handleRecentSelect,
  loading,
  recentDocs,
  formatRecentDocLabel,
  autoOpenLastDocEnabled,
  setAutoOpenLastDocEnabled
}) {
  return (
    <header className="hero">
      <div>
        <div className="hero-top">
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
          <button className="hero-link-button" type="button" onClick={handleOpenNewsroom}>
            📰
          </button>
        </div>
        <p className="eyebrow">Поиск контента</p>
        <h1 className="hero-title">
          <span>USACHEV</span>
          <span>TODAY</span>
        </h1>
      </div>
      <div className="hero-card">
        <div className="hero-stat">
          <span>Документ</span>
          <strong>{docId || "—"}</strong>
        </div>
        <div className="hero-stat">
          <span>Статус</span>
          <strong>{status || "Готов"}</strong>
        </div>
        <div className="hero-recent">
          <label>Недавние документы</label>
          <div className="doc-loader recent-loader">
            <select
              value={recentDocId}
              onChange={handleRecentSelect}
              disabled={loading || recentDocs.length === 0}
              aria-label="Недавние документы"
            >
              <option value="">
                {recentDocs.length > 0 ? "Недавние документы" : "Нет недавних документов"}
              </option>
              {recentDocs.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {formatRecentDocLabel(doc)}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => setAutoOpenLastDocEnabled((prev) => !prev)}
          >
            {autoOpenLastDocEnabled ? "Авто-открытие последнего: ON" : "Авто-открытие последнего: OFF"}
          </button>
        </div>
      </div>
    </header>
  );
}
