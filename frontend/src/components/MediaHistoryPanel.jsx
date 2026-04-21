import React from "react";

export function MediaHistoryPanel({
  docId,
  mediaPanelOpen,
  setMediaPanelOpen,
  mediaTools,
  ytDlpVersion,
  ytDlpVersionLoading,
  ytDlpUpdateLoading,
  handleCheckYtDlpVersion,
  handleUpdateYtDlp,
  activeMediaJobsCount,
  mediaJobs,
  formatMediaJobProgress,
  handleCancelMediaJob,
  mediaFiles,
  formatBytes
}) {
  return (
    <section className="panel media-panel-shell">
      <div className="panel-header">
        <h2>{"История Загрузок"}</h2>
        <div className="panel-actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => setMediaPanelOpen((prev) => !prev)}
            disabled={!docId}
          >
            {mediaPanelOpen ? "Скрыть" : "Показать"}
          </button>
        </div>
      </div>
      {docId && mediaPanelOpen ? (
        <div className="media-panel">
          <div className="media-panel-head">
            <strong>{"История Загрузок"}</strong>
            <div className="media-panel-head-right">
              <span>
                {mediaTools?.available
                  ? `yt-dlp ready${ytDlpVersion ? ` (${ytDlpVersion})` : ""}`
                  : "yt-dlp unavailable"}
              </span>
              <div className="query-actions">
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => handleCheckYtDlpVersion()}
                  disabled={!mediaTools?.available || ytDlpVersionLoading || ytDlpUpdateLoading}
                >
                  {ytDlpVersionLoading ? "Проверка..." : "Версия yt-dlp"}
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleUpdateYtDlp}
                  disabled={!mediaTools?.available || ytDlpUpdateLoading || activeMediaJobsCount > 0}
                >
                  {ytDlpUpdateLoading ? "Обновление..." : "Обновить yt-dlp"}
                </button>
              </div>
            </div>
          </div>
          {mediaJobs.length > 0 ? (
            <div className="media-jobs-list">
              {mediaJobs.slice(0, 8).map((job) => (
                <div key={job.id} className="media-job-row">
                  <div className="media-job-meta">
                    <strong>{job.id}</strong>
                    <span>{job.status}</span>
                    {job.section_title ? <span>{job.section_title}</span> : null}
                    {formatMediaJobProgress(job) ? <span>{formatMediaJobProgress(job)}</span> : null}
                    {job.error ? <span className="muted">{job.error}</span> : null}
                    {job?.operator_notice?.title ? <span>{job.operator_notice.title}</span> : null}
                    {job?.operator_notice?.hint ? <span className="muted">{job.operator_notice.hint}</span> : null}
                    {job?.operator_notice?.auto_refresh_attempted ? (
                      <span className="muted">
                        {job?.operator_notice?.auto_refresh_ok
                          ? `cookies auto-refresh ok (${Number(job?.operator_notice?.auto_refresh_count ?? 0)})`
                          : `cookies auto-refresh failed${
                              job?.operator_notice?.auto_refresh_error ? `: ${job.operator_notice.auto_refresh_error}` : ""
                            }`}
                      </span>
                    ) : null}
                  </div>
                  {job.status === "queued" || job.status === "running" ? (
                    <button className="btn ghost small" type="button" onClick={() => handleCancelMediaJob(job.id)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {mediaFiles.length > 0 ? (
            <div className="media-files-list">
              {mediaFiles.slice(0, 20).map((file) => (
                <div key={file.path} className="media-file-row">
                  <a
                    href={`/api/documents/${docId}/media/file?path=${encodeURIComponent(file.path)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {file.path}
                  </a>
                  <span className="muted">{formatBytes(file.size)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Downloaded files will appear here.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
