import React from "react";
import {
  FORMAT_HINT_LABELS,
  PRIORITY_LABELS,
  VISUAL_TYPE_LABELS,
  buildMediaFileUrl,
  isVideoMediaPath,
  normalizeMediaFilePath,
  normalizeMediaFilePathList
} from "../utils/visualDecision.js";

const COMMENT_ID_RE = /^comments_/i;
const DEFAULT_MEDIA_TOPIC_NAME = "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";

function formatBytes(value) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let current = size;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[idx]}`;
}

function sanitizeMediaTopicName(rawTitle) {
  const value = String(rawTitle ?? "").trim();
  if (!value) return DEFAULT_MEDIA_TOPIC_NAME;
  const replaced = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const normalized = replaced || DEFAULT_MEDIA_TOPIC_NAME;
  const clipped = normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
  if (!clipped) return DEFAULT_MEDIA_TOPIC_NAME;
  const upper = clipped.toUpperCase();
  const reserved = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]);
  return reserved.has(upper) ? `_${clipped}` : clipped;
}

function getMediaFileTopicFolder(mediaPath) {
  const normalizedPath = normalizeMediaFilePath(mediaPath);
  if (!normalizedPath) return "";
  const [folder] = normalizedPath.split("/");
  return String(folder ?? "").trim();
}

function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  return raw;
}

function getSegmentText(segment) {
  return String(segment?.text_quote ?? "");
}

function getVisualText(segment) {
  return String(segment?.visual_decision?.description ?? "").trim();
}

function getSegmentMediaPaths(segment) {
  return normalizeMediaFilePathList(
    segment?.visual_decision?.media_file_paths ?? segment?.visual_decision?.media_file_path ?? null
  );
}

function getSegmentKind(segment) {
  const text = getSegmentText(segment).trim();
  if (COMMENT_ID_RE.test(String(segment?.segment_id ?? ""))) return "comment";
  if (text.startsWith("/")) return "direction";
  return "script";
}

function getLinkedReleaseInfo(segment, linkedReleaseSegmentIds, selectedReleaseDetail) {
  const segmentKey = String(segment?.segment_id ?? "").trim();
  if (!segmentKey || !linkedReleaseSegmentIds?.has(segmentKey) || !selectedReleaseDetail) return null;
  return {
    id: selectedReleaseDetail.id,
    title: selectedReleaseDetail.title,
    status: selectedReleaseDetail.status,
    air_date: selectedReleaseDetail.air_date
  };
}

function ScriptCanvasStatusBadges({ segment, researchRun }) {
  const mediaCount = getSegmentMediaPaths(segment).length;
  const linkCount = Array.isArray(segment?.links) ? segment.links.filter((link) => normalizeUrl(link?.url ?? link ?? "")).length : 0;
  const queryCount = Array.isArray(segment?.search_decision?.queries)
    ? segment.search_decision.queries.filter((query) => String(query ?? "").trim()).length
    : 0;
  const researchCount = Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results.length : 0;
  const visualType = String(segment?.visual_decision?.type ?? "").trim();
  const duration = segment?.visual_decision?.duration_hint_sec;
  const badges = [];
  if (visualType && visualType !== "no_visual") badges.push({ key: "visual", label: visualType });
  if (mediaCount > 0) badges.push({ key: "media", label: `${mediaCount} media` });
  if (linkCount > 0) badges.push({ key: "links", label: `${linkCount} links` });
  if (queryCount > 0) badges.push({ key: "search", label: `${queryCount} queries` });
  if (researchCount > 0) badges.push({ key: "research", label: `${researchCount} research` });
  if (duration !== null && duration !== undefined && duration !== "") badges.push({ key: "duration", label: `${duration}s` });
  if (segment?.is_done) badges.push({ key: "done", label: "done" });
  if (!badges.length) return null;
  return (
    <div className="script-canvas-status-badges">
      {badges.map((badge) => (
        <span key={badge.key} className={`script-canvas-status-badge is-${badge.key}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function hasVisualContent(segment) {
  const visual = segment?.visual_decision ?? {};
  if (String(visual?.type ?? "").trim() && String(visual.type).trim() !== "no_visual") return true;
  if (String(visual?.description ?? "").trim()) return true;
  if (getSegmentMediaPaths(segment).length > 0) return true;
  return false;
}

function hasSegmentLinks(segment) {
  return Array.isArray(segment?.links) && segment.links.some((link) => normalizeUrl(link?.url ?? link ?? ""));
}

function isWorkSegment(segment) {
  return !COMMENT_ID_RE.test(String(segment?.segment_id ?? ""));
}

function segmentMatchesCanvasFilter(segment, filterMode) {
  if (filterMode === "todo") return !segment?.is_done;
  if (filterMode === "empty") return isWorkSegment(segment) && !hasVisualContent(segment);
  if (filterMode === "media") return isWorkSegment(segment) && getSegmentMediaPaths(segment).length === 0;
  if (filterMode === "linked") return hasSegmentLinks(segment);
  return true;
}

function ScriptCanvasFilterBar({ items, filterMode, setFilterMode }) {
  const counts = React.useMemo(() => {
    const result = { all: 0, todo: 0, empty: 0, media: 0, linked: 0 };
    (Array.isArray(items) ? items : []).forEach(({ segment }) => {
      result.all += 1;
      if (segmentMatchesCanvasFilter(segment, "todo")) result.todo += 1;
      if (segmentMatchesCanvasFilter(segment, "empty")) result.empty += 1;
      if (segmentMatchesCanvasFilter(segment, "media")) result.media += 1;
      if (segmentMatchesCanvasFilter(segment, "linked")) result.linked += 1;
    });
    return result;
  }, [items]);
  const filters = [
    ["all", "All"],
    ["todo", "Todo"],
    ["empty", "Empty visual"],
    ["media", "No media"],
    ["linked", "Linked"]
  ];
  return (
    <div className="script-canvas-filter-bar" role="group" aria-label="Canvas filter">
      {filters.map(([key, label]) => (
        <button
          className={`btn ghost small${filterMode === key ? " is-active" : ""}`}
          type="button"
          key={key}
          onClick={() => setFilterMode(key)}
          disabled={counts[key] === 0}
        >
          {label} {counts[key]}
        </button>
      ))}
    </div>
  );
}

function ScriptCanvasGroupStats({ items, activeSegmentId, setActiveSegmentId }) {
  const total = Array.isArray(items) ? items.length : 0;
  if (!total) return null;
  let done = 0;
  let withMedia = 0;
  let withoutVisual = 0;
  let withoutMedia = 0;
  let withLinks = 0;
  items.forEach(({ segment }) => {
    if (segment?.is_done) done += 1;
    const mediaCount = getSegmentMediaPaths(segment).length;
    if (mediaCount > 0) withMedia += 1;
    if (mediaCount === 0 && !COMMENT_ID_RE.test(String(segment?.segment_id ?? ""))) withoutMedia += 1;
    if (!hasVisualContent(segment) && isWorkSegment(segment)) withoutVisual += 1;
    if (hasSegmentLinks(segment)) withLinks += 1;
  });
  const selectNextMatching = (predicate) => {
    const currentIndex = Math.max(
      0,
      items.findIndex(({ segment }) => String(segment?.segment_id ?? "") === String(activeSegmentId ?? ""))
    );
    const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex + 1)];
    const match = ordered.find(({ segment }) => predicate(segment));
    const matchId = String(match?.segment?.segment_id ?? "");
    if (matchId) setActiveSegmentId(matchId);
  };
  return (
    <div className="script-canvas-group-stats">
      <span>{done}/{total} done</span>
      <span>{withMedia} media</span>
      <span>{withLinks} linked</span>
      <span>{withoutVisual} empty visual</span>
      <span>{withoutMedia} no media</span>
      <button
        className="btn ghost small"
        type="button"
        onClick={() => selectNextMatching((segment) => !segment?.is_done)}
        disabled={done >= total}
      >
        Next todo
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() =>
          selectNextMatching((segment) => isWorkSegment(segment) && !hasVisualContent(segment))
        }
        disabled={withoutVisual <= 0}
      >
        Next empty
      </button>
      <button
        className="btn ghost small"
        type="button"
        onClick={() =>
          selectNextMatching(
            (segment) => isWorkSegment(segment) && getSegmentMediaPaths(segment).length === 0
          )
        }
        disabled={withoutMedia <= 0}
      >
        Next media
      </button>
    </div>
  );
}

function ScriptCanvasMediaStrip({ docId, segment }) {
  const mediaPaths = getSegmentMediaPaths(segment);
  if (!mediaPaths.length) return null;
  return (
    <div className="script-canvas-media-strip">
      {mediaPaths.slice(0, 4).map((mediaPath) => {
        const mediaUrl = buildMediaFileUrl(docId, mediaPath);
        const name = mediaPath.split("/").filter(Boolean).pop() ?? mediaPath;
        return (
          <div className="script-canvas-media-thumb" key={mediaPath} title={mediaPath}>
            {isVideoMediaPath(mediaPath) ? (
              <video src={mediaUrl} muted playsInline preload="metadata" />
            ) : (
              <img src={mediaUrl} alt="" loading="lazy" />
            )}
            <span>{name}</span>
          </div>
        );
      })}
      {mediaPaths.length > 4 ? <span className="script-canvas-media-more">+{mediaPaths.length - 4}</span> : null}
    </div>
  );
}

function getReadableUrlLabel(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname.replace(/\/+$/g, "");
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return normalized.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}

function ScriptCanvasLinksStrip({
  segment,
  index,
  isActive,
  handleLinkAdd,
  handleLinkUpdate,
  handleLinkRemove,
  handleOpenSegmentScreenshotMode,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded
}) {
  const links = Array.isArray(segment?.links) ? segment.links : [];
  if (!isActive && links.length === 0) return null;
  return (
    <div className="script-canvas-links-strip" onClick={(event) => event.stopPropagation()}>
      {links.map((link, linkIndex) => {
        const url = normalizeUrl(link?.url ?? link ?? "");
        const label = getReadableUrlLabel(url);
        const downloadable = isMediaDownloadSupported?.(url);
        const downloaded = isMediaDownloaded?.(url);
        const downloading = isMediaDownloadBusy?.(url);
        return (
          <div className="script-canvas-link-item" key={`${url}-${linkIndex}`}>
            {isActive ? (
              <input
                value={url}
                onChange={(event) => handleLinkUpdate?.(index, linkIndex, normalizeUrl(event.target.value))}
                placeholder="https://..."
              />
            ) : (
              <a href={url} target="_blank" rel="noreferrer" title={url}>
                {label || "link"}
              </a>
            )}
            {isActive ? (
              <>
                <a
                  className={`btn ghost small${url ? "" : " is-disabled"}`}
                  href={url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!url}
                >
                  Open
                </a>
                {downloadable ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={downloading || downloaded}
                    onClick={() => handleDownloadMedia?.(url, segment?.section_title ?? null)}
                  >
                    {downloaded ? "Done" : downloading ? "..." : "Download"}
                  </button>
                ) : null}
                <button className="btn ghost small" type="button" onClick={() => handleLinkRemove?.(index, linkIndex)}>
                  -
                </button>
              </>
            ) : null}
          </div>
        );
      })}
      {isActive ? (
        <div className="script-canvas-link-actions">
          <button className="btn ghost small" type="button" onClick={() => handleLinkAdd?.(index)}>
            + link
          </button>
          {links.length ? (
            <button className="btn ghost small" type="button" onClick={() => handleOpenSegmentScreenshotMode?.(segment)}>
              Screenshot links
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function normalizeQueryLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function ScriptCanvasSearchPanel({
  segment,
  index,
  config,
  searchLoading,
  handleGenerateSearch,
  updateSearch,
  handleSearch
}) {
  const queries = Array.isArray(segment?.search_decision?.queries) ? segment.search_decision.queries : [];
  const queryText = queries.join("\n");
  const engines = Array.isArray(config?.searchEngines) ? config.searchEngines : [];
  const visibleEngines = engines.slice(0, 6);
  const loading = Boolean(searchLoading?.[segment?.segment_id]);
  return (
    <div className="script-canvas-search-panel" onClick={(event) => event.stopPropagation()}>
      <div className="script-canvas-search-head">
        <span>Search</span>
        <button className="btn ghost small" type="button" onClick={() => handleGenerateSearch?.(index)} disabled={loading}>
          {loading ? "Generating..." : queries.length ? "Regenerate" : "Generate"}
        </button>
      </div>
      <textarea
        value={queryText}
        onChange={(event) => updateSearch?.(index, { queries: normalizeQueryLines(event.target.value) })}
        placeholder="search queries"
      />
      {queries.length && visibleEngines.length ? (
        <div className="script-canvas-search-actions">
          {queries.slice(0, 4).map((query, queryIndex) => (
            <div className="script-canvas-search-query" key={`${query}-${queryIndex}`}>
              <strong>{query}</strong>
              <span>
                {visibleEngines.map((engine) => (
                  <button
                    className="btn ghost small"
                    type="button"
                    key={engine.id ?? engine.name}
                    onClick={() => handleSearch?.(engine, query)}
                  >
                    {engine.label ?? engine.name ?? engine.id}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getConfigItems(config, key, fallback) {
  const value = config?.[key];
  return Array.isArray(value) && value.length ? value : fallback;
}

function ScriptCanvasDecisionBar({ segment, index, config, updateVisual }) {
  const visualTypes = getConfigItems(config, "visualTypes", Object.keys(VISUAL_TYPE_LABELS));
  const formatHints = getConfigItems(config, "formatHints", Object.keys(FORMAT_HINT_LABELS));
  const priorities = getConfigItems(config, "priorities", Object.keys(PRIORITY_LABELS));
  return (
    <div className="script-canvas-decision-bar" onClick={(event) => event.stopPropagation()}>
      <label>
        <span>Visual</span>
        <select
          value={segment?.visual_decision?.type ?? "no_visual"}
          onChange={(event) => updateVisual?.(index, { type: event.target.value })}
        >
          {visualTypes.map((type) => (
            <option key={type} value={type}>
              {VISUAL_TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Format</span>
        <select
          value={segment?.visual_decision?.format_hint ?? ""}
          onChange={(event) => updateVisual?.(index, { format_hint: event.target.value || null })}
        >
          <option value="">-</option>
          {formatHints.map((format) => (
            <option key={format} value={format}>
              {FORMAT_HINT_LABELS[format] ?? format}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Priority</span>
        <select
          value={segment?.visual_decision?.priority ?? ""}
          onChange={(event) => updateVisual?.(index, { priority: event.target.value || null })}
        >
          <option value="">-</option>
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority] ?? priority}
            </option>
          ))}
        </select>
      </label>
      <label className="script-canvas-duration-field">
        <span>Sec</span>
        <input
          type="number"
          min="0"
          value={segment?.visual_decision?.duration_hint_sec ?? ""}
          onChange={(event) =>
            updateVisual?.(index, {
              duration_hint_sec: event.target.value ? Number(event.target.value) : null
            })
          }
        />
      </label>
    </div>
  );
}

function ScriptCanvasMediaTray({ docId, segment, index, mediaFiles, updateVisual }) {
  const [filter, setFilter] = React.useState("");
  const selectedMediaPaths = getSegmentMediaPaths(segment);
  const selectedVideoPaths = selectedMediaPaths.filter((mediaPath) => isVideoMediaPath(mediaPath));
  const mediaFileTimecodes = segment?.visual_decision?.media_file_timecodes && typeof segment.visual_decision.media_file_timecodes === "object"
    ? segment.visual_decision.media_file_timecodes
    : {};
  const mediaTopicFolder = sanitizeMediaTopicName(segment?.section_title ?? "");
  const mediaFileList = Array.isArray(mediaFiles) ? mediaFiles : [];
  const topicMediaFiles = mediaFileList.filter((file) => getMediaFileTopicFolder(file?.path) === mediaTopicFolder);
  const sourceFiles = topicMediaFiles.length ? topicMediaFiles : mediaFileList;
  const normalizedFilter = filter.trim().toLowerCase();
  React.useEffect(() => {
    setFilter("");
  }, [segment?.segment_id]);
  const visibleFiles = sourceFiles
    .filter((file) => {
      if (!normalizedFilter) return true;
      return `${file?.name ?? ""} ${file?.path ?? ""}`.toLowerCase().includes(normalizedFilter);
    })
    .slice(0, 10);
  const toggleMediaPath = React.useCallback((mediaPath) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath) return;
    const nextMediaPaths = selectedMediaPaths.includes(normalizedPath)
      ? selectedMediaPaths.filter((item) => item !== normalizedPath)
      : [...selectedMediaPaths, normalizedPath];
    updateVisual?.(index, { media_file_paths: nextMediaPaths });
  }, [index, selectedMediaPaths, updateVisual]);
  const updateTimecode = React.useCallback((mediaPath, value) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath) return;
    const normalizedValue = String(value ?? "").trim().slice(0, 32);
    const nextTimecodes = { ...mediaFileTimecodes };
    if (normalizedValue) {
      nextTimecodes[normalizedPath] = normalizedValue;
    } else {
      delete nextTimecodes[normalizedPath];
    }
    updateVisual?.(index, { media_file_timecodes: nextTimecodes });
  }, [index, mediaFileTimecodes, updateVisual]);

  return (
    <div className="script-canvas-media-tray" onClick={(event) => event.stopPropagation()}>
      <div className="script-canvas-media-tray-head">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={topicMediaFiles.length ? "Media in topic" : "Search media"}
        />
        {selectedMediaPaths.length ? (
          <button className="btn ghost small" type="button" onClick={() => updateVisual?.(index, { media_file_paths: [] })}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="script-canvas-media-options">
        {visibleFiles.map((file) => {
          const mediaPath = normalizeMediaFilePath(file?.path);
          if (!mediaPath) return null;
          const selected = selectedMediaPaths.includes(mediaPath);
          const mediaUrl = buildMediaFileUrl(docId, mediaPath);
          return (
            <button
              className={`script-canvas-media-option${selected ? " is-selected" : ""}`}
              key={mediaPath}
              type="button"
              onClick={() => toggleMediaPath(mediaPath)}
              title={mediaPath}
            >
              <span className="script-canvas-media-option-preview">
                {isVideoMediaPath(mediaPath) ? (
                  <video src={mediaUrl} muted playsInline preload="metadata" />
                ) : (
                  <img src={mediaUrl} alt="" loading="lazy" />
                )}
              </span>
              <span className="script-canvas-media-option-copy">
                <strong>{file?.name ?? mediaPath}</strong>
                <span>{formatBytes(file?.size)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {sourceFiles.length === 0 ? <div className="script-canvas-media-empty">No media files in document.</div> : null}
      {selectedVideoPaths.length ? (
        <div className="script-canvas-timecodes">
          {selectedVideoPaths.map((mediaPath) => (
            <label key={mediaPath}>
              <span>{mediaPath.split("/").filter(Boolean).pop() ?? mediaPath}</span>
              <input
                value={mediaFileTimecodes[mediaPath] ?? ""}
                onChange={(event) => updateTimecode(mediaPath, event.target.value)}
                placeholder="00:00:00"
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScriptCanvasToolbar({
  index,
  segment,
  researchLoading,
  researchRun,
  linkedReleaseInfo,
  onResearchRun,
  onOpenResearchWorkspace,
  onOpenScreenshotLab,
  onOpenLinkedRelease,
  onInsertAfter,
  onRemove,
  onSelectPrev,
  onSelectNext,
  canSelectPrev,
  canSelectNext,
  visiblePosition,
  visibleCount,
  onDoneToggle
}) {
  const isDone = Boolean(segment?.is_done);
  const researchCount = Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results.length : 0;
  return (
    <div className="script-canvas-toolbar">
      <span className="script-canvas-toolbar-position">
        {visiblePosition + 1}/{visibleCount}
      </span>
      <button className="btn ghost small" type="button" onClick={() => onResearchRun?.(index)} disabled={researchLoading}>
        {researchLoading ? "Research..." : researchCount > 0 ? `Research ${researchCount}` : "Research"}
      </button>
      <button className="btn ghost small" type="button" onClick={() => onOpenResearchWorkspace?.(segment?.segment_id, researchRun?.run_id ?? "")}>
        Workspace
      </button>
      <button className="btn ghost small" type="button" onClick={() => onOpenScreenshotLab?.(segment)}>
        Screenshot
      </button>
      {linkedReleaseInfo ? (
        <button className="btn ghost small" type="button" onClick={() => onOpenLinkedRelease?.(segment?.segment_id)}>
          Release
        </button>
      ) : null}
      <button className="btn ghost small" type="button" onClick={onSelectPrev} disabled={!canSelectPrev}>
        Prev
      </button>
      <button className="btn ghost small" type="button" onClick={onSelectNext} disabled={!canSelectNext}>
        Next
      </button>
      <button className="btn ghost small" type="button" onClick={() => onInsertAfter?.(index)} title="Add segment">
        +
      </button>
      <button className="btn ghost small" type="button" onClick={() => onRemove?.(index)} title="Remove segment">
        -
      </button>
      <label className="done-toggle-inline script-canvas-done-toggle" title="Done">
        <input type="checkbox" checked={isDone} onChange={(event) => onDoneToggle?.(index, event.target.checked)} />
      </label>
    </div>
  );
}

function ScriptCanvasSegment({
  item,
  docId,
  config,
  mediaFiles,
  activeSegmentId,
  setActiveSegmentId,
  segmentResearchRuns,
  segmentResearchLoading,
  linkedReleaseSegmentIds,
  selectedReleaseDetail,
  visiblePosition,
  visibleCount,
  setActiveSegmentByOffset,
  handleRunSegmentResearch,
  handleOpenResearchWorkspace,
  handleOpenSegmentScreenshotMode,
  handleOpenReleaseFromSegment,
  handleGenerateSearch,
  searchLoading,
  updateSearch,
  handleSearch,
  handleLinkAdd,
  handleLinkUpdate,
  handleLinkRemove,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded,
  updateVisual,
  handleQuoteChange,
  handleInsertAfter,
  handleRemoveSegment,
  handleToggleSegmentDone
}) {
  const { segment, index } = item;
  const segmentId = String(segment?.segment_id ?? "");
  const text = getSegmentText(segment);
  const visualText = getVisualText(segment);
  const kind = getSegmentKind(segment);
  const isActive = activeSegmentId === segmentId;
  const linkedReleaseInfo = getLinkedReleaseInfo(segment, linkedReleaseSegmentIds, selectedReleaseDetail);
  const researchRun = segmentResearchRuns?.[segment?.segment_id] ?? null;
  const researchLoading = Boolean(segmentResearchLoading?.[segment?.segment_id]);
  const className = [
    "script-canvas-segment",
    `is-${kind}`,
    isActive ? "is-active" : "",
    segment?.is_done ? "is-done" : ""
  ].filter(Boolean).join(" ");

  return (
    <article
      className={className}
      data-segment-id={segmentId}
      onClick={() => setActiveSegmentId(segmentId)}
    >
      <div className="script-canvas-segment-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="script-canvas-segment-body">
        {isActive ? (
          <textarea
            className={`script-canvas-edit script-canvas-edit-${kind}`}
            value={segment?.text_quote ?? ""}
            onChange={(event) => handleQuoteChange?.(index, event.target.value)}
            onClick={(event) => event.stopPropagation()}
          />
        ) : kind === "direction" ? (
          <div className="script-canvas-direction">{text.trim()}</div>
        ) : kind === "comment" ? (
          <div className="script-canvas-comment">{text.trim()}</div>
        ) : (
          <p className="script-canvas-text">{text.trim() || "..."}</p>
        )}
        {isActive && kind !== "direction" ? (
          <textarea
            className="script-canvas-visual-edit"
            value={segment?.visual_decision?.description ?? ""}
            placeholder="/visual"
            onChange={(event) => updateVisual?.(index, { description: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        ) : visualText && kind !== "direction" ? (
          <div className="script-canvas-visual-note">/{visualText}</div>
        ) : null}
        <ScriptCanvasStatusBadges segment={segment} researchRun={researchRun} />
        <ScriptCanvasLinksStrip
          segment={segment}
          index={index}
          isActive={isActive}
          handleLinkAdd={handleLinkAdd}
          handleLinkUpdate={handleLinkUpdate}
          handleLinkRemove={handleLinkRemove}
          handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
          handleDownloadMedia={handleDownloadMedia}
          isMediaDownloadBusy={isMediaDownloadBusy}
          isMediaDownloadSupported={isMediaDownloadSupported}
          isMediaDownloaded={isMediaDownloaded}
        />
        {isActive && kind !== "comment" ? (
          <ScriptCanvasSearchPanel
            segment={segment}
            index={index}
            config={config}
            searchLoading={searchLoading}
            handleGenerateSearch={handleGenerateSearch}
            updateSearch={updateSearch}
            handleSearch={handleSearch}
          />
        ) : null}
        {isActive && kind !== "comment" ? (
          <ScriptCanvasDecisionBar
            segment={segment}
            index={index}
            config={config}
            updateVisual={updateVisual}
          />
        ) : null}
        <ScriptCanvasMediaStrip docId={docId} segment={segment} />
        {isActive && kind !== "comment" ? (
          <ScriptCanvasMediaTray
            docId={docId}
            segment={segment}
            index={index}
            mediaFiles={mediaFiles}
            updateVisual={updateVisual}
          />
        ) : null}
        {isActive ? (
          <ScriptCanvasToolbar
            index={index}
            segment={segment}
            researchLoading={researchLoading}
            researchRun={researchRun}
            linkedReleaseInfo={linkedReleaseInfo}
            onResearchRun={handleRunSegmentResearch}
            onOpenResearchWorkspace={handleOpenResearchWorkspace}
            onOpenScreenshotLab={handleOpenSegmentScreenshotMode}
            onOpenLinkedRelease={handleOpenReleaseFromSegment}
            onInsertAfter={handleInsertAfter}
            onRemove={handleRemoveSegment}
            onSelectPrev={() => setActiveSegmentByOffset(visiblePosition, -1)}
            onSelectNext={() => setActiveSegmentByOffset(visiblePosition, 1)}
            canSelectPrev={visiblePosition > 0}
            canSelectNext={visiblePosition < visibleCount - 1}
            visiblePosition={visiblePosition}
            visibleCount={visibleCount}
            onDoneToggle={handleToggleSegmentDone}
          />
        ) : null}
      </div>
    </article>
  );
}

export function ScriptCanvasPanel({
  group,
  visibleItems,
  config,
  docId,
  mediaFiles,
  segmentResearchRuns,
  segmentResearchLoading,
  linkedReleaseSegmentIds,
  selectedReleaseDetail,
  handleRunSegmentResearch,
  handleGenerateSearch,
  searchLoading,
  updateSearch,
  handleSearch,
  handleOpenResearchWorkspace,
  handleOpenSegmentScreenshotMode,
  handleOpenReleaseFromSegment,
  handleLinkAdd,
  handleLinkUpdate,
  handleLinkRemove,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded,
  updateVisual,
  handleQuoteChange,
  handleInsertAfter,
  handleRemoveSegment,
  handleToggleSegmentDone
}) {
  const [activeSegmentId, setActiveSegmentId] = React.useState("");
  const [filterMode, setFilterMode] = React.useState("all");
  const canvasItems = React.useMemo(
    () => visibleItems.filter(({ segment }) => segmentMatchesCanvasFilter(segment, filterMode)),
    [filterMode, visibleItems]
  );
  const setActiveSegmentByOffset = React.useCallback((currentPosition, offset) => {
    const nextPosition = currentPosition + offset;
    const nextSegmentId = String(canvasItems[nextPosition]?.segment?.segment_id ?? "");
    if (nextSegmentId) setActiveSegmentId(nextSegmentId);
  }, [canvasItems]);

  const sectionLinks = React.useMemo(() => {
    const links = Array.isArray(group?.linkSegment?.segment?.links) ? group.linkSegment.segment.links : [];
    return links
      .map((link) => {
        const url = normalizeUrl(link?.url ?? link ?? "");
        if (!url) return null;
        const title = String(link?.title ?? link?.label ?? "").trim();
        return { url, title: title || url.replace(/^https?:\/\//i, "").replace(/^www\./i, "") };
      })
      .filter(Boolean)
      .slice(0, 8);
  }, [group?.linkSegment?.segment?.links]);

  React.useEffect(() => {
    if (!activeSegmentId) return;
    if (canvasItems.some(({ segment }) => String(segment?.segment_id ?? "") === activeSegmentId)) return;
    setActiveSegmentId("");
  }, [activeSegmentId, canvasItems]);

  React.useEffect(() => {
    if (filterMode === "all" || canvasItems.length > 0) return;
    setFilterMode("all");
  }, [canvasItems.length, filterMode]);

  React.useEffect(() => {
    if (!activeSegmentId || typeof document === "undefined") return;
    const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(activeSegmentId) : activeSegmentId.replace(/"/g, '\\"');
    const node = document.querySelector(`[data-segment-id="${escapedId}"]`);
    node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [activeSegmentId]);

  return (
    <div className="script-canvas">
      <ScriptCanvasGroupStats
        items={visibleItems}
        activeSegmentId={activeSegmentId}
        setActiveSegmentId={setActiveSegmentId}
      />
      <ScriptCanvasFilterBar items={visibleItems} filterMode={filterMode} setFilterMode={setFilterMode} />
      {sectionLinks.length ? (
        <div className="script-canvas-source-strip">
          <span>Sources</span>
          {sectionLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" title={link.url}>
              {link.title}
            </a>
          ))}
          <button
            className="btn ghost small"
            type="button"
            onClick={() => handleOpenSegmentScreenshotMode?.(group.linkSegment.segment)}
          >
            Screenshot
          </button>
        </div>
      ) : null}
      {canvasItems.length === 0 ? (
        <div className="script-canvas-empty-filter">No segments match this filter.</div>
      ) : null}
      {canvasItems.map((item, visiblePosition) => (
        <ScriptCanvasSegment
          key={`${item.segment?.segment_id}-${item.index}`}
          item={item}
          docId={docId}
          config={config}
          mediaFiles={mediaFiles}
          activeSegmentId={activeSegmentId}
          setActiveSegmentId={setActiveSegmentId}
          segmentResearchRuns={segmentResearchRuns}
          segmentResearchLoading={segmentResearchLoading}
          linkedReleaseSegmentIds={linkedReleaseSegmentIds}
          selectedReleaseDetail={selectedReleaseDetail}
          visiblePosition={visiblePosition}
          visibleCount={canvasItems.length}
          setActiveSegmentByOffset={setActiveSegmentByOffset}
          handleRunSegmentResearch={handleRunSegmentResearch}
          handleGenerateSearch={handleGenerateSearch}
          searchLoading={searchLoading}
          updateSearch={updateSearch}
          handleSearch={handleSearch}
          handleOpenResearchWorkspace={handleOpenResearchWorkspace}
          handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
          handleOpenReleaseFromSegment={handleOpenReleaseFromSegment}
          handleLinkAdd={handleLinkAdd}
          handleLinkUpdate={handleLinkUpdate}
          handleLinkRemove={handleLinkRemove}
          handleDownloadMedia={handleDownloadMedia}
          isMediaDownloadBusy={isMediaDownloadBusy}
          isMediaDownloadSupported={isMediaDownloadSupported}
          isMediaDownloaded={isMediaDownloaded}
          updateVisual={updateVisual}
          handleQuoteChange={handleQuoteChange}
          handleInsertAfter={handleInsertAfter}
          handleRemoveSegment={handleRemoveSegment}
          handleToggleSegmentDone={handleToggleSegmentDone}
        />
      ))}
    </div>
  );
}
