import React from "react";

export function SegmentVisualEditor({
  segment,
  config,
  index,
  onVisualUpdate,
  visualTypeLabels,
  formatHintLabels,
  priorityLabels,
  hasTopicFiles,
  mediaFilter,
  setMediaFilter,
  selectedMediaCount,
  mediaFileUrl,
  filteredMediaFileOptions,
  visibleMediaFileOptions,
  selectedMediaPaths,
  toggleMediaFileSelection,
  formatBytes,
  mediaVisibleLimit,
  hasMoreMediaFiles,
  selectedVideoPaths,
  mediaFileTimecodes,
  updateMediaFileTimecode,
  MediaTimecodeRowComponent,
  normalizeMediaFilePath
}) {
  return (
    <>
      <div className="decision-grid">
        <div>
          <label>Визуал</label>
          <select value={segment.visual_decision.type} onChange={(event) => onVisualUpdate(index, { type: event.target.value })}>
            {config.visualTypes.map((type) => (
              <option key={type} value={type}>
                {visualTypeLabels[type] ?? type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Формат</label>
          <select
            value={segment.visual_decision.format_hint ?? ""}
            onChange={(event) =>
              onVisualUpdate(index, {
                format_hint: event.target.value ? event.target.value : null
              })
            }
          >
            <option value="">—</option>
            {config.formatHints.map((type) => (
              <option key={type} value={type}>
                {formatHintLabels[type] ?? type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Приоритет</label>
          <select
            value={segment.visual_decision.priority ?? ""}
            onChange={(event) =>
              onVisualUpdate(index, {
                priority: event.target.value ? event.target.value : null
              })
            }
          >
            <option value="">—</option>
            {config.priorities.map((type) => (
              <option key={type} value={type}>
                {priorityLabels[type] ?? type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Длительность (сек)</label>
          <input
            type="number"
            value={segment.visual_decision.duration_hint_sec ?? ""}
            onChange={(event) =>
              onVisualUpdate(index, {
                duration_hint_sec: event.target.value ? Number(event.target.value) : null
              })
            }
          />
        </div>
      </div>
      <label>Описание визуала</label>
      <textarea value={segment.visual_decision.description} onChange={(event) => onVisualUpdate(index, { description: event.target.value })} />
      <div className="segment-media-picker">
        <label>Файлы</label>
        <div className="segment-media-picker-row">
          {hasTopicFiles ? (
            <input
              className="segment-media-filter-input"
              type="search"
              value={mediaFilter}
              onChange={(event) => setMediaFilter(event.target.value)}
              placeholder="Поиск файла..."
            />
          ) : null}
          {selectedMediaCount > 0 ? (
            <button className="btn ghost small" type="button" onClick={() => onVisualUpdate(index, { media_file_paths: [] })}>
              Сбросить
            </button>
          ) : null}
          {mediaFileUrl ? (
            <a className="btn ghost small" href={mediaFileUrl} target="_blank" rel="noopener noreferrer">
              Открыть файл
            </a>
          ) : null}
        </div>
        {hasTopicFiles ? (
          filteredMediaFileOptions.length > 0 ? (
            <div className="segment-media-options" role="listbox" aria-label="media-files">
              <button
                type="button"
                className={`segment-media-option${selectedMediaCount === 0 ? " is-selected" : ""}`}
                onClick={() => onVisualUpdate(index, { media_file_paths: [] })}
              >
                — Без файла
              </button>
              {visibleMediaFileOptions.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className={`segment-media-option${selectedMediaPaths.includes(normalizeMediaFilePath(file.path) ?? "") ? " is-selected" : ""}`}
                  onClick={() => toggleMediaFileSelection(file.path)}
                  title={file.path}
                >
                  <span className="segment-media-option-name">{file.name}</span>
                  <span className="segment-media-option-size">{formatBytes(file.size)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted segment-media-empty-hint">Ничего не найдено по поиску</div>
          )
        ) : (
          <div className="muted segment-media-empty-hint">Нет файлов в теме</div>
        )}
        {hasMoreMediaFiles ? (
          <div className="muted segment-media-empty-hint">
            {`Показано ${mediaVisibleLimit} из ${filteredMediaFileOptions.length}. Уточните поиск.`}
          </div>
        ) : null}
        {selectedMediaCount > 0 ? <div className="muted segment-media-picked">{selectedMediaPaths.join("\n")}</div> : null}
        {selectedVideoPaths.length > 0 ? (
          <>
            <label>Таймкоды видео</label>
            <div className="segment-media-timecodes">
              {selectedVideoPaths.map((mediaPath) => (
                <MediaTimecodeRowComponent
                  key={mediaPath}
                  mediaPath={mediaPath}
                  value={mediaFileTimecodes[mediaPath] ?? ""}
                  onChange={(nextValue) => updateMediaFileTimecode(mediaPath, nextValue)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
