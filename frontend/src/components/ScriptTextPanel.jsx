import React from "react";
import {
  buildMediaFileUrl,
  isVideoMediaPath,
  normalizeMediaFilePathList
} from "../utils/visualDecision.js";

function normalizeUrl(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function getSegmentText(segment) {
  return String(segment?.text_quote ?? "").trim();
}

function isCommentSegment(segment) {
  return /^comments_/i.test(String(segment?.segment_id ?? ""));
}

function getLinks(segment) {
  if (!segment || !Array.isArray(segment.links)) return [];
  return segment.links
    .map((link) => {
      const url = normalizeUrl(link?.url ?? link);
      return url ? { url, raw: link } : null;
    })
    .filter(Boolean);
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

function getUrlHost(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function getPreviewKey(url) {
  return normalizeUrl(url).toLowerCase();
}

function getPreviewImageSrc(image) {
  const value = String(image ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    return `/api/image-proxy?url=${encodeURIComponent(value)}`;
  }
  return value;
}

function getMediaPaths(segment) {
  return normalizeMediaFilePathList(
    segment?.visual_decision?.media_file_paths ?? segment?.visual_decision?.media_file_path ?? null
  );
}

function TextMediaEmbeds({ docId, segment }) {
  const mediaPaths = getMediaPaths(segment);
  const timecodes = segment?.visual_decision?.media_file_timecodes && typeof segment.visual_decision.media_file_timecodes === "object"
    ? segment.visual_decision.media_file_timecodes
    : {};
  if (!mediaPaths.length) return null;
  return (
    <div className="script-text-media-embeds">
      {mediaPaths.map((mediaPath) => {
        const mediaUrl = buildMediaFileUrl(docId, mediaPath);
        const name = mediaPath.split("/").filter(Boolean).pop() ?? mediaPath;
        const timecode = timecodes[mediaPath] ?? "";
        return (
          <a
            className="script-text-media-embed"
            href={mediaUrl || undefined}
            target="_blank"
            rel="noreferrer"
            title={mediaPath}
            key={mediaPath}
          >
            <span className="script-text-media-preview">
              {isVideoMediaPath(mediaPath) ? (
                <video src={mediaUrl} muted playsInline preload="metadata" />
              ) : (
                <img src={mediaUrl} alt="" loading="lazy" />
              )}
            </span>
            <span className="script-text-media-meta">
              <strong>{name}</strong>
              <span>{timecode ? `timecode ${timecode}` : mediaPath}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function TextLinks({
  links,
  previews,
  segment,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded
}) {
  if (!links.length) return null;
  return (
    <div className="script-text-links">
      {links.map(({ url }, index) => {
        const preview = previews[getPreviewKey(url)] ?? null;
        const host = getUrlHost(url);
        const label = getReadableUrlLabel(url);
        const downloadable = isMediaDownloadSupported?.(url);
        const downloaded = isMediaDownloaded?.(url);
        const downloading = isMediaDownloadBusy?.(url);
        return (
          <div className="script-text-link-embed" key={`${url}-${index}`}>
            <a className="script-text-link-main" href={url} target="_blank" rel="noreferrer">
              {preview?.image ? (
                <span className="script-text-link-thumb">
                  <img src={getPreviewImageSrc(preview.image)} alt="" loading="lazy" />
                </span>
              ) : null}
              <span className="script-text-link-copy">
                <strong>{preview?.title || label || host || url}</strong>
                {preview?.description ? <span>{preview.description}</span> : null}
                <em>{preview?.siteName || host || url}</em>
              </span>
            </a>
            {downloadable ? (
              <button
                className="btn ghost small script-text-download"
                type="button"
                disabled={downloading || downloaded}
                onClick={() => handleDownloadMedia?.(url, segment?.section_title ?? null)}
              >
                {downloaded ? "Downloaded" : downloading ? "Downloading" : "Download"}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ScriptTextPanel({
  group,
  visibleItems,
  docId,
  handleDownloadMedia,
  isMediaDownloadBusy,
  isMediaDownloadSupported,
  isMediaDownloaded
}) {
  const documentItems = React.useMemo(() => {
    const items = Array.isArray(visibleItems) ? [...visibleItems] : [];
    if (Array.isArray(group?.linkSegments)) {
      items.push(...group.linkSegments);
    } else if (group?.linkSegment) {
      items.push(group.linkSegment);
    }
    return items
      .filter((item) => item?.segment)
      .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  }, [group?.linkSegment, group?.linkSegments, visibleItems]);

  const displayItems = React.useMemo(
    () => documentItems.map((item) => ({ ...item, displayLinks: getLinks(item.segment) })),
    [documentItems]
  );

  const allLinks = React.useMemo(() => {
    const map = new Map();
    displayItems.forEach(({ displayLinks }) => {
      displayLinks.forEach((link) => {
        map.set(getPreviewKey(link.url), link.url);
      });
    });
    return Array.from(map.values());
  }, [displayItems]);

  const [previews, setPreviews] = React.useState({});
  React.useEffect(() => {
    allLinks.forEach((url) => {
      const key = getPreviewKey(url);
      if (!key || previews[key]?.loading || previews[key]?.loaded || previews[key]?.error) return;
      setPreviews((prev) => ({ ...prev, [key]: { loading: true } }));
      fetch(`/api/link/preview?url=${encodeURIComponent(url)}`)
        .then((response) => {
          if (!response.ok) throw new Error("preview_failed");
          return response.json();
        })
        .then((data) => {
          setPreviews((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              loaded: true,
              title: data?.title ?? "",
              description: data?.description ?? "",
              image: data?.image ?? "",
              siteName: data?.siteName ?? ""
            }
          }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [key]: { loading: false, loaded: true, error: true } }));
        });
    });
  }, [allLinks, previews]);

  return (
    <div className="script-text-panel">
      {displayItems.map(({ segment, index, displayLinks }) => {
        const text = getSegmentText(segment);
        const links = displayLinks;
        const mediaPaths = getMediaPaths(segment);
        if (!text && !links.length && !mediaPaths.length) return null;
        const isDirection = text.startsWith("/");
        const isLinksBlock = String(segment?.block_type ?? "").toLowerCase().trim() === "links";
        const kind = isLinksBlock ? "links" : isDirection ? "direction" : isCommentSegment(segment) ? "comment" : "paragraph";
        return (
          <div className={`script-text-block is-${kind}`} key={`${segment.segment_id}-${index}`}>
            {text ? <p>{text}</p> : null}
            <TextLinks
              links={links}
              previews={previews}
              segment={segment}
              handleDownloadMedia={handleDownloadMedia}
              isMediaDownloadBusy={isMediaDownloadBusy}
              isMediaDownloadSupported={isMediaDownloadSupported}
              isMediaDownloaded={isMediaDownloaded}
            />
            <TextMediaEmbeds docId={docId} segment={segment} />
          </div>
        );
      })}
    </div>
  );
}
