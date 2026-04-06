import React from "react";

const HOTKEYS = [
  { key: "R", label: "Refresh" },
  { key: "P", label: "Prepare" },
  { key: "A", label: "Air Ready" },
  { key: "U", label: "Publish" },
  { key: "F", label: "Fullscreen" },
  { key: "O", label: "Producer" },
  { key: "W", label: "Workspace" },
  { key: "H", label: "Help" }
];

const formatClockTime = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  try {
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return date.toISOString().slice(11, 19);
  }
};

const formatCountdown = (targetValue, nowValue) => {
  const target = new Date(targetValue);
  const now = new Date(nowValue);
  if (!Number.isFinite(target.getTime()) || !Number.isFinite(now.getTime())) {
    return "Время эфира не задано";
  }
  const diffMs = target.getTime() - now.getTime();
  const prefix = diffMs >= 0 ? "До эфира" : "После эфира";
  const totalSec = Math.abs(Math.round(diffMs / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${prefix} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const isTypingTarget = (target) => {
  if (!target || typeof target !== "object") return false;
  const tagName = String(target.tagName ?? "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable === true;
};

export function ReleaseOnAirMode({
  selectedReleaseDetail,
  releaseControlPanel,
  releaseBriefingPanel,
  releasePublishChecklistItems,
  selectedReleaseAssets,
  releaseActivity,
  releaseBusy,
  handleRefreshProducerView,
  handlePrepareRelease,
  handleMarkReleaseAirReady,
  handlePublishRelease,
  handleOpenProducerMode,
  handleExitProducerMode,
  formatReleaseItemStatusLabel,
  formatDateTimeShort,
  handleToggleFullscreen
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [hotkeysVisible, setHotkeysVisible] = React.useState(false);
  const shellRef = React.useRef(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    shellRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = String(event.key ?? "").toLowerCase();
      if (!key) return;

      if (key === "h") {
        event.preventDefault();
        setHotkeysVisible((prev) => !prev);
        return;
      }
      if (key === "r") {
        event.preventDefault();
        handleRefreshProducerView();
        return;
      }
      if (key === "p") {
        event.preventDefault();
        if (!releaseBusy) handlePrepareRelease();
        return;
      }
      if (key === "a") {
        event.preventDefault();
        if (!releaseBusy && releaseControlPanel.can_mark_air_ready) {
          handleMarkReleaseAirReady();
        }
        return;
      }
      if (key === "u") {
        event.preventDefault();
        if (!releaseBusy && releaseControlPanel.can_publish) {
          handlePublishRelease();
        }
        return;
      }
      if (key === "f") {
        event.preventDefault();
        handleToggleFullscreen();
        return;
      }
      if (key === "o") {
        event.preventDefault();
        handleOpenProducerMode();
        return;
      }
      if (key === "w") {
        event.preventDefault();
        handleExitProducerMode();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleExitProducerMode,
    handleMarkReleaseAirReady,
    handleOpenProducerMode,
    handlePrepareRelease,
    handlePublishRelease,
    handleRefreshProducerView,
    handleToggleFullscreen,
    releaseBusy,
    releaseControlPanel.can_mark_air_ready,
    releaseControlPanel.can_publish
  ]);

  const problematicChecks = Array.isArray(releasePublishChecklistItems)
    ? releasePublishChecklistItems.filter((item) => String(item?.status ?? "").toLowerCase() !== "pass")
    : [];
  const nextAction =
    Array.isArray(releaseControlPanel.actions) && releaseControlPanel.actions.length > 0
      ? releaseControlPanel.actions[0]
      : null;
  const nextStep =
    Array.isArray(releaseBriefingPanel.next_steps) && releaseBriefingPanel.next_steps.length > 0
      ? releaseBriefingPanel.next_steps[0]
      : "";
  const nextRundownItems = Array.isArray(selectedReleaseAssets) ? selectedReleaseAssets.slice(0, 5) : [];
  const recentActivity = Array.isArray(releaseActivity) ? releaseActivity.slice(0, 3) : [];
  const lastPublishedEvent = Array.isArray(releaseActivity)
    ? releaseActivity.find((item) => String(item?.event ?? "").toLowerCase().includes("publish"))
    : null;
  const tickerItems = [
    releaseControlPanel.title,
    releaseBriefingPanel.headline,
    problematicChecks[0]?.title ? `Блокер: ${problematicChecks[0].title}` : "Блокеры закрыты",
    nextStep || nextAction?.title || "Следующий шаг не определён",
    selectedReleaseDetail?.air_date ? `Эфир ${selectedReleaseDetail.air_date}` : "Эфир не назначен"
  ].filter(Boolean);

  return (
    <div
      ref={shellRef}
      className="onair-shell"
      tabIndex={-1}
      onClick={() => shellRef.current?.focus()}
      aria-label="On Air View"
    >
      <header className="onair-hero panel">
        <div className="onair-title-block">
          <p className="eyebrow">On Air Mode</p>
          <h1>{selectedReleaseDetail?.title || "Release On Air"}</h1>
          <div className={`onair-status status-${String(releaseControlPanel.status_code ?? "not_ready")}`}>
            {releaseControlPanel.title}
          </div>
          <p className="subtitle">{releaseControlPanel.detail}</p>
          <div className="onair-focus-hint">Фокус на экране. `H` показывает горячие клавиши.</div>
        </div>
        <div className="onair-toolbar">
          <button className="btn ghost small" type="button" onClick={handleRefreshProducerView} disabled={releaseBusy}>
            Refresh
          </button>
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
          <button className="btn ghost small" type="button" onClick={handleToggleFullscreen}>
            Fullscreen
          </button>
          <button className="btn ghost small" type="button" onClick={handleOpenProducerMode}>
            Producer
          </button>
          <button className="btn ghost small" type="button" onClick={handleExitProducerMode}>
            Workspace
          </button>
          <button className="btn ghost small" type="button" onClick={() => setHotkeysVisible((prev) => !prev)}>
            Hotkeys
          </button>
        </div>
      </header>

      {hotkeysVisible ? (
        <section className="panel onair-card onair-hotkeys-card">
          <div className="onair-card-head">
            <strong>Hotkeys</strong>
            <span>{HOTKEYS.length}</span>
          </div>
          <div className="onair-hotkeys-grid">
            {HOTKEYS.map((item) => (
              <div key={item.key} className="onair-hotkey-item">
                <strong>{item.key}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="onair-grid onair-grid-top">
        <div className="panel onair-card onair-card-clock">
          <div className="onair-card-head">
            <strong>Live Clock</strong>
            <span>local</span>
          </div>
          <div className="onair-clock">{formatClockTime(now)}</div>
          <div className="onair-detail">{formatCountdown(selectedReleaseDetail?.air_date, now)}</div>
        </div>

        <div className="panel onair-card onair-card-primary">
          <div className="onair-card-head">
            <strong>Next Action</strong>
            <span>{releaseBusy ? "busy" : "live"}</span>
          </div>
          <div className="onair-callout">{nextAction?.title || "Выпуск ждёт следующего шага"}</div>
          <div className="onair-detail">{nextAction?.detail || nextStep || "Следующий шаг пока не определён."}</div>
        </div>
      </section>

      <section className="panel onair-card onair-ticker-card">
        <div className="onair-card-head">
          <strong>Live Ticker</strong>
          <span>{tickerItems.length}</span>
        </div>
        <div className="onair-ticker">
          <div className="onair-ticker-track">
            {[...tickerItems, ...tickerItems].map((item, index) => (
              <span key={`ticker-${index}`} className="onair-ticker-item">
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="onair-grid">
        <div className="panel onair-card">
          <div className="onair-card-head">
            <strong>Blockers</strong>
            <span>{problematicChecks.length}</span>
          </div>
          {problematicChecks.length > 0 ? (
            <div className="onair-list">
              {problematicChecks.slice(0, 4).map((item) => (
                <div key={`onair-check-${item.key}`} className="onair-list-item">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="onair-detail">Блокирующих проверок сейчас нет.</div>
          )}
        </div>

        <div className="panel onair-card">
          <div className="onair-card-head">
            <strong>Last Publish Snapshot</strong>
            <span>{lastPublishedEvent ? "published" : selectedReleaseDetail?.status || "draft"}</span>
          </div>
          <div className="onair-callout">
            {lastPublishedEvent ? "Последний publish зафиксирован" : "Публикации ещё не было"}
          </div>
          <div className="onair-detail">
            {lastPublishedEvent
              ? `${lastPublishedEvent.detail || "Release published"} · ${formatDateTimeShort(lastPublishedEvent.created_at) || ""}`
              : selectedReleaseDetail?.status === "published"
                ? `Release уже в статусе published · ${formatDateTimeShort(selectedReleaseDetail.updated_at) || ""}`
                : "Когда выпуск будет опубликован, здесь появится последний publish snapshot."}
          </div>
        </div>
      </section>

      <section className="onair-grid">
        <div className="panel onair-card">
          <div className="onair-card-head">
            <strong>Rundown</strong>
            <span>{selectedReleaseAssets.length}</span>
          </div>
          {nextRundownItems.length > 0 ? (
            <div className="onair-list">
              {nextRundownItems.map((item, index) => {
                const asset = item?.asset ?? {};
                const attachment = item?.attachment ?? {};
                return (
                  <div key={attachment.id || asset.id || index} className="onair-list-item">
                    <strong>
                      {index + 1}. {asset.title || asset.file_name || asset.id || "Untitled asset"}
                    </strong>
                    <span>{formatReleaseItemStatusLabel(attachment.item_status)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="onair-detail">Выпуск пока пустой.</div>
          )}
        </div>

        <div className="panel onair-card">
          <div className="onair-card-head">
            <strong>Briefing</strong>
            <span>{releaseBriefingPanel.status_code || "live"}</span>
          </div>
          <div className="onair-callout">{releaseBriefingPanel.headline || "Release briefing"}</div>
          <div className="onair-detail">{releaseBriefingPanel.summary_text || "Краткая сводка пока не готова."}</div>
        </div>
      </section>

      <section className="panel onair-card">
        <div className="onair-card-head">
          <strong>Recent Activity</strong>
          <span>{recentActivity.length}</span>
        </div>
        {recentActivity.length > 0 ? (
          <div className="onair-list">
            {recentActivity.map((item) => (
              <div key={item.id} className="onair-list-item">
                <strong>{item.event}</strong>
                <span>{item.detail || "Без деталей"}</span>
                <span>{formatDateTimeShort(item.created_at) || ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="onair-detail">История действий пока пустая.</div>
        )}
      </section>
    </div>
  );
}
