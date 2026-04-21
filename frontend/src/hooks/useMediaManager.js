import React from "react";

export function useMediaManager({
  docId,
  setStatus,
  fetchJsonSafe,
  canonicalizeLinkUrl,
  normalizeLinkUrl,
  normalizeTopicTitleForDisplay,
  isYtDlpCandidateUrl
}) {
  const [mediaJobs, setMediaJobs] = React.useState([]);
  const [mediaFiles, setMediaFiles] = React.useState([]);
  const [downloadedMediaUrls, setDownloadedMediaUrls] = React.useState([]);
  const [mediaQueue, setMediaQueue] = React.useState({});
  const [mediaTools, setMediaTools] = React.useState(null);
  const [ytDlpVersion, setYtDlpVersion] = React.useState(null);
  const [ytDlpVersionLoading, setYtDlpVersionLoading] = React.useState(false);
  const [ytDlpUpdateLoading, setYtDlpUpdateLoading] = React.useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = React.useState(false);

  const mediaJobStatusRef = React.useRef(new Map());
  const mediaJobStatusReadyRef = React.useRef(false);

  React.useEffect(() => {
    setMediaQueue({});
    setDownloadedMediaUrls([]);
    setYtDlpVersion(null);
    setMediaPanelOpen(false);
    mediaJobStatusRef.current = new Map();
    mediaJobStatusReadyRef.current = false;
  }, [docId]);

  const refreshMedia = React.useCallback(async () => {
    if (!docId) {
      setMediaJobs([]);
      setMediaFiles([]);
      setDownloadedMediaUrls([]);
      setMediaTools(null);
      setYtDlpVersion(null);
      return;
    }
    try {
      const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media`);
      if (!response.ok) return;
      setMediaJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setMediaFiles(Array.isArray(data?.files) ? data.files : []);
      setDownloadedMediaUrls(Array.isArray(data?.downloaded_urls) ? data.downloaded_urls : []);
      setMediaTools(data?.tools ?? null);
    } catch {
      setMediaJobs([]);
      setMediaFiles([]);
      setDownloadedMediaUrls([]);
      setYtDlpVersion(null);
    }
  }, [docId, fetchJsonSafe]);

  React.useEffect(() => {
    refreshMedia();
  }, [refreshMedia]);

  React.useEffect(() => {
    if (!docId) return;
    const hasActive = mediaJobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasActive) return;
    const timer = setInterval(() => {
      refreshMedia();
    }, 2500);
    return () => clearInterval(timer);
  }, [docId, mediaJobs, refreshMedia]);

  React.useEffect(() => {
    const nextMap = new Map();
    mediaJobs.forEach((job) => {
      nextMap.set(job.id, {
        status: String(job.status ?? ""),
        sectionTitle: String(job.section_title ?? ""),
        error: String(job.error ?? ""),
        operatorTitle: String(job?.operator_notice?.title ?? ""),
        operatorHint: String(job?.operator_notice?.hint ?? ""),
        outputCount: Array.isArray(job.output_files) ? job.output_files.length : 0
      });
    });

    if (!mediaJobStatusReadyRef.current) {
      mediaJobStatusRef.current = nextMap;
      mediaJobStatusReadyRef.current = true;
      return;
    }

    let statusMessage = "";
    for (const job of mediaJobs) {
      const prev = mediaJobStatusRef.current.get(job.id);
      if (!prev) continue;
      if (prev.status === job.status) continue;

      const cleanedTitle = normalizeTopicTitleForDisplay(job.section_title ?? "");
      const title = cleanedTitle || (job.section_title ? String(job.section_title) : job.id);
      if (job.status === "completed") {
        const outputCount = Array.isArray(job.output_files) ? job.output_files.length : 0;
        statusMessage = `Media completed: ${title}${outputCount > 0 ? ` (${outputCount})` : ""}`;
      } else if (job.status === "failed") {
        const operatorTitle = String(job?.operator_notice?.title ?? "").trim();
        statusMessage = `Media failed: ${title}${job.error ? ` - ${job.error}` : ""}${
          operatorTitle ? ` · ${operatorTitle}` : ""
        }`;
      } else if (job.status === "canceled") {
        statusMessage = `Media canceled: ${title}`;
      }

      if (statusMessage) break;
    }

    mediaJobStatusRef.current = nextMap;
    if (statusMessage) {
      setStatus(statusMessage);
    }
  }, [mediaJobs, normalizeTopicTitleForDisplay, setStatus]);

  const handleCheckYtDlpVersion = React.useCallback(
    async ({ silent = false } = {}) => {
      if (ytDlpVersionLoading) return;
      setYtDlpVersionLoading(true);
      try {
        const { response, data } = await fetchJsonSafe("/api/downloader/yt-dlp/version");
        if (!response.ok) throw new Error(data?.error ?? "Version check failed");
        const version = typeof data?.version === "string" ? data.version : null;
        const normalizedVersion = version || "unknown";
        setYtDlpVersion(normalizedVersion);
        if (!silent) {
          if (data?.available) {
            setStatus(`yt-dlp version: ${normalizedVersion}`);
          } else {
            setStatus("yt-dlp unavailable");
          }
        }
      } catch (error) {
        if (!silent) {
          setStatus(error.message);
        }
      } finally {
        setYtDlpVersionLoading(false);
      }
    },
    [fetchJsonSafe, setStatus, ytDlpVersionLoading]
  );

  const handleUpdateYtDlp = React.useCallback(async () => {
    if (ytDlpUpdateLoading) return;
    setYtDlpUpdateLoading(true);
    try {
      const { response, data } = await fetchJsonSafe("/api/downloader/yt-dlp:update", {
        method: "POST"
      });
      if (!response.ok) throw new Error(data?.error ?? "yt-dlp update failed");
      const nextVersion =
        (typeof data?.after === "string" && data.after) ||
        (typeof data?.before === "string" && data.before) ||
        ytDlpVersion ||
        "unknown";
      setYtDlpVersion(nextVersion);
      await refreshMedia();
      if (data?.changed) {
        setStatus(`yt-dlp updated: ${data?.before ?? "unknown"} -> ${data?.after ?? "unknown"}`);
      } else if (data?.up_to_date) {
        setStatus(`yt-dlp already up to date: ${data?.after ?? data?.before ?? "unknown"}`);
      } else {
        setStatus(`yt-dlp update completed: ${data?.after ?? data?.before ?? "unknown"}`);
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setYtDlpUpdateLoading(false);
    }
  }, [fetchJsonSafe, refreshMedia, setStatus, ytDlpUpdateLoading, ytDlpVersion]);

  React.useEffect(() => {
    if (!mediaPanelOpen) return;
    if (!mediaTools?.available) return;
    if (ytDlpVersion || ytDlpVersionLoading || ytDlpUpdateLoading) return;
    handleCheckYtDlpVersion({ silent: true });
  }, [handleCheckYtDlpVersion, mediaPanelOpen, mediaTools, ytDlpUpdateLoading, ytDlpVersion, ytDlpVersionLoading]);

  const activeMediaJobsCount = React.useMemo(
    () => mediaJobs.filter((job) => job.status === "queued" || job.status === "running").length,
    [mediaJobs]
  );

  const downloadedMediaSet = React.useMemo(() => {
    const set = new Set();
    downloadedMediaUrls.forEach((url) => {
      const key = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (key) set.add(key);
    });
    return set;
  }, [canonicalizeLinkUrl, downloadedMediaUrls, normalizeLinkUrl]);

  const isMediaDownloaded = React.useCallback(
    (url) => {
      const key = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (!key) return false;
      return downloadedMediaSet.has(key);
    },
    [canonicalizeLinkUrl, downloadedMediaSet, normalizeLinkUrl]
  );

  const isMediaDownloadBusy = React.useCallback(
    (url) => {
      const normalized = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (!normalized) return false;
      if (mediaQueue[normalized]) return true;
      return mediaJobs.some((job) => {
        if (job.status !== "queued" && job.status !== "running") return false;
        const jobUrl = canonicalizeLinkUrl(job.url) || normalizeLinkUrl(job.url);
        return jobUrl === normalized;
      });
    },
    [canonicalizeLinkUrl, mediaJobs, mediaQueue, normalizeLinkUrl]
  );

  const getMediaDownloadState = React.useCallback(
    (url) => {
      const normalized = canonicalizeLinkUrl(url) || normalizeLinkUrl(url);
      if (!normalized) return null;
      if (downloadedMediaSet.has(normalized)) {
        return { state: "completed", label: "Downloaded" };
      }
      if (mediaQueue[normalized]) {
        return { state: "queued", label: "Queued" };
      }
      const activeJob = mediaJobs.find((job) => {
        if (job.status !== "queued" && job.status !== "running") return false;
        const jobUrl = canonicalizeLinkUrl(job.url) || normalizeLinkUrl(job.url);
        return jobUrl === normalized;
      });
      if (!activeJob) return null;
      const status = String(activeJob.status ?? "").trim().toLowerCase();
      if (status === "running") return { state: "running", label: "Downloading" };
      return { state: "queued", label: "Queued" };
    },
    [canonicalizeLinkUrl, downloadedMediaSet, mediaJobs, mediaQueue, normalizeLinkUrl]
  );

  const isMediaDownloadSupported = React.useCallback(
    (url) => {
      if (!mediaTools?.available) return false;
      return isYtDlpCandidateUrl(url);
    },
    [isYtDlpCandidateUrl, mediaTools]
  );

  const handleDownloadMedia = React.useCallback(
    async (url, sectionTitle = null, options = {}) => {
      const normalized = normalizeLinkUrl(url);
      if (!docId || !normalized) return;
      if (!isYtDlpCandidateUrl(normalized)) {
        setStatus("Ссылка не подходит под фильтр yt-dlp.");
        return;
      }
      if (isMediaDownloaded(normalized)) {
        setStatus("Ссылка уже помечена как скачанная.");
        return;
      }
      const key = canonicalizeLinkUrl(normalized) || normalized;
      if (mediaQueue[key]) return;
      setMediaQueue((prev) => ({ ...prev, [key]: true }));
      setStatus(`Media download: ${normalized}`);
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media:download`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: normalized,
            section_title: sectionTitle ?? null,
            segment_id: String(options?.segmentId ?? "").trim() || null,
            run_id: String(options?.runId ?? "").trim() || null,
            result_id: String(options?.resultId ?? "").trim() || null,
            source_title: String(options?.sourceTitle ?? "").trim() || null,
            source_domain: String(options?.sourceDomain ?? "").trim() || null,
            text_quote: String(options?.textQuote ?? "").trim() || null
          })
        });
        if (!response.ok) throw new Error(data?.error ?? "Media download error");
        if (data?.already_downloaded) {
          await refreshMedia();
          setStatus("Уже скачано.");
          return;
        }
        if (data?.job?.id) {
          mediaJobStatusRef.current.set(String(data.job.id), {
            status: String(data.job.status ?? "queued"),
            sectionTitle: String(data.job.section_title ?? sectionTitle ?? ""),
            error: "",
            outputCount: 0
          });
        }
        await refreshMedia();
        setStatus(`Media queued: ${data?.job?.id ?? normalized}`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setMediaQueue((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [
      canonicalizeLinkUrl,
      docId,
      fetchJsonSafe,
      isMediaDownloaded,
      isYtDlpCandidateUrl,
      mediaQueue,
      normalizeLinkUrl,
      refreshMedia,
      setStatus
    ]
  );

  const handleCancelMediaJob = React.useCallback(
    async (jobId) => {
      if (!docId || !jobId) return;
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/media/${jobId}:cancel`, {
          method: "POST"
        });
        if (!response.ok) throw new Error(data?.error ?? "Cancel failed");
        await refreshMedia();
      } catch (error) {
        setStatus(error.message);
      }
    },
    [docId, fetchJsonSafe, refreshMedia, setStatus]
  );

  return {
    mediaJobs,
    mediaFiles,
    downloadedMediaUrls,
    mediaQueue,
    mediaTools,
    ytDlpVersion,
    ytDlpVersionLoading,
    ytDlpUpdateLoading,
    mediaPanelOpen,
    setMediaPanelOpen,
    refreshMedia,
    handleCheckYtDlpVersion,
    handleUpdateYtDlp,
    activeMediaJobsCount,
    downloadedMediaSet,
    isMediaDownloaded,
    isMediaDownloadBusy,
    getMediaDownloadState,
    isMediaDownloadSupported,
    handleDownloadMedia,
    handleCancelMediaJob
  };
}
