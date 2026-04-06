import React from "react";

function pickLatestRelease(releases = []) {
  return [...(Array.isArray(releases) ? releases : [])]
    .sort((left, right) =>
      String(right?.updated_at ?? right?.created_at ?? "").localeCompare(String(left?.updated_at ?? left?.created_at ?? ""))
    )[0] ?? null;
}

function pickLatestMeaningfulActivity(activity = []) {
  return [...(Array.isArray(activity) ? activity : [])]
    .filter((item) => {
      const event = String(item?.event ?? "").trim();
      return Boolean(event) && event !== "handoff_snapshot";
    })
    .sort((left, right) =>
      String(right?.created_at ?? "").localeCompare(String(left?.created_at ?? ""))
    )[0] ?? null;
}

function buildRecentChanges({
  latestMeaningfulActivity,
  runtimeBackupsStatus,
  sqliteMirrorStatus,
  latestRelease,
  focusRelease,
  releaseControlPanel
}) {
  const changes = [];
  if (latestMeaningfulActivity) {
    changes.push({
      title: latestMeaningfulActivity.label || latestMeaningfulActivity.event || "Release activity",
      detail: latestMeaningfulActivity.detail || "Recent assistant or release action happened.",
      at: latestMeaningfulActivity.created_at || ""
    });
  }
  if (runtimeBackupsStatus?.latest?.created_at) {
    changes.push({
      title: "Latest backup",
      detail: runtimeBackupsStatus.latest.backup_id || "Runtime snapshot created.",
      at: runtimeBackupsStatus.latest.created_at
    });
  }
  if (sqliteMirrorStatus?.last_sync_at) {
    changes.push({
      title: "SQLite sync",
      detail: sqliteMirrorStatus.last_reason || "Mirror updated.",
      at: sqliteMirrorStatus.last_sync_at
    });
  }
  if (focusRelease?.updated_at || latestRelease?.updated_at || latestRelease?.created_at) {
    changes.push({
      title: "Focus release updated",
      detail: focusRelease?.title || latestRelease?.title || focusRelease?.id || latestRelease?.id || "Release changed.",
      at: focusRelease?.updated_at || latestRelease?.updated_at || latestRelease?.created_at || ""
    });
  }
  if (releaseControlPanel?.handoff_status_code) {
    changes.push({
      title: "Handoff status",
      detail: String(releaseControlPanel.handoff_status_code).replaceAll("_", " "),
      at: focusRelease?.updated_at || latestRelease?.updated_at || latestRelease?.created_at || ""
    });
  }
  return changes
    .filter((item) => item.at || item.detail)
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")))
    .slice(0, 5);
}

function buildNextActions({
  latestRelease,
  segmentsNeedingVisual,
  storageHealthHighlights,
  runtimeBackupsStatus,
  sourceMemorySummary,
  sourceMemorySignal,
  releaseOutcomeMemorySummary,
  integrationOverview
}) {
  const actions = [];
  if (latestRelease && !["published", "archived"].includes(String(latestRelease?.status ?? "").trim().toLowerCase())) {
    actions.push(`Focus the latest release: ${latestRelease.title || latestRelease.id}.`);
  }
  if (Number(segmentsNeedingVisual?.length ?? 0) > 0) {
    actions.push(`Close visual gaps for ${segmentsNeedingVisual.length} segment(s).`);
  }
  if (runtimeBackupsStatus?.auto_backup_enabled === false) {
    actions.push("Re-enable auto-backup before the next mass assistant action.");
  }
  if (Array.isArray(storageHealthHighlights) && storageHealthHighlights.length > 0) {
    actions.push(storageHealthHighlights[0]);
  }
  if (Number(integrationOverview?.counts?.inbox_assets ?? 0) > 0) {
    actions.push(`Review ${integrationOverview.counts.inbox_assets} inbox asset(s) before they pile up.`);
  }
  if (Number(sourceMemorySummary?.total_domains ?? 0) === 0) {
    actions.push("Start applying research results so source memory begins learning.");
  } else if (sourceMemorySignal?.detail) {
    actions.push(sourceMemorySignal.detail);
  }
  if (Number(releaseOutcomeMemorySummary?.total_domains ?? 0) === 0) {
    actions.push("Let the release assistant finish a few attachment flows to build outcome memory.");
  }
  return actions.slice(0, 4);
}

function buildSourceMemorySignal(sourceMemorySummary) {
  const topDomains = Array.isArray(sourceMemorySummary?.top_domains) ? sourceMemorySummary.top_domains : [];
  const recent = Array.isArray(sourceMemorySummary?.recent) ? sourceMemorySummary.recent : [];
  const helpfulDomain =
    [...topDomains].sort(
      (left, right) =>
        Number(right?.helpful_count ?? 0) - Number(left?.helpful_count ?? 0) ||
        Number(right?.applied_count ?? 0) - Number(left?.applied_count ?? 0)
    )[0] ?? null;
  if (Number(helpfulDomain?.helpful_count ?? 0) > 0) {
    const helpfulCount = Number(helpfulDomain.helpful_count ?? 0);
    return {
      title: "Top memory signal",
      short: `${helpfulDomain.domain} · Helpful x${helpfulCount}`,
      detail: `Lean on ${helpfulDomain.domain}: explicit editor feedback says it worked ${helpfulCount} time(s).`,
      recentLabel: recent[0]?.domain ? `Recent ${recent[0].domain} (${recent[0].action || "memory"})` : ""
    };
  }
  const usedDomain =
    [...topDomains].sort(
      (left, right) =>
        Number(right?.applied_count ?? 0) - Number(left?.applied_count ?? 0) ||
        String(right?.last_used_at ?? "").localeCompare(String(left?.last_used_at ?? ""))
    )[0] ?? null;
  if (Number(usedDomain?.applied_count ?? 0) > 0) {
    const usedCount = Number(usedDomain.applied_count ?? 0);
    return {
      title: "Top memory signal",
      short: `${usedDomain.domain} · Used x${usedCount}`,
      detail: `Reuse ${usedDomain.domain} first on similar segments: it already worked ${usedCount} time(s).`,
      recentLabel: recent[0]?.domain ? `Recent ${recent[0].domain} (${recent[0].action || "memory"})` : ""
    };
  }
  return null;
}

function buildOwnerRisks({
  segmentsNeedingVisual,
  integrationOverview,
  runtimeBackupsStatus,
  storageHealthHighlights,
  releaseControlPanel,
  releasePublishChecklist,
  topDiagnosticHighlight
}) {
  const risks = [];
  const handoffStatus = String(
    releaseControlPanel?.handoff_status_code || releasePublishChecklist?.summary?.handoff_status_code || ""
  )
    .trim()
    .toLowerCase();
  const editorialReady = Boolean(releasePublishChecklist?.summary?.editorial_ready);
  const inboxAssets = Number(integrationOverview?.counts?.inbox_assets ?? 0);
  const visualPressure = Number(segmentsNeedingVisual?.length ?? 0);

  if (editorialReady && ["pending_capture", "pending_download", "backup_only", "no_files"].includes(handoffStatus)) {
    risks.push({
      level: "high",
      label: "Handoff blocked",
      detail: `Editorially ready, but handoff is ${handoffStatus.replaceAll("_", " ")}.`,
      action: "focus_release",
      actionLabel: "Open Release"
    });
  }
  if (runtimeBackupsStatus?.auto_backup_enabled === false) {
    risks.push({
      level: "high",
      label: "Backups off",
      detail: "Auto-backup is disabled before assistant mass-actions.",
      action: "storage_health",
      actionLabel: "Open Storage"
    });
  }
  if (Array.isArray(storageHealthHighlights) && storageHealthHighlights.length > 0) {
    risks.push({
      level: "medium",
      label: "Storage warning",
      detail: storageHealthHighlights[0],
      action: "storage_health",
      actionLabel: "Inspect"
    });
  }
  if (visualPressure >= 5) {
    risks.push({
      level: "medium",
      label: "Visual pressure high",
      detail: `${visualPressure} segments still need visuals.`,
      action: "needs_visual",
      actionLabel: "Needs Visual"
    });
  }
  if (inboxAssets >= 10) {
    risks.push({
      level: "medium",
      label: "Inbox piling up",
      detail: `${inboxAssets} inbox assets need review.`,
      action: "focus_release",
      actionLabel: "Open Workspace"
    });
  }
  if (topDiagnosticHighlight?.label) {
    risks.push({
      level: "low",
      label: topDiagnosticHighlight.label,
      detail: topDiagnosticHighlight.detail || "Release diagnostics raised a blocker.",
      action: "focus_release",
      actionLabel: "Open Blocker"
    });
  }

  return risks.slice(0, 4);
}

function buildSuggestedSession({
  ownerRisks,
  topDiagnosticHighlight,
  latestRelease,
  selectedReleaseId,
  runtimeBackupsStatus,
  segmentsNeedingVisual,
  sourceMemorySummary,
  sourceMemorySignal
}) {
  const steps = [];
  const pushStep = (step) => {
    if (!step?.title) return;
    if (steps.some((item) => item.title === step.title)) return;
    steps.push(step);
  };

  const topRisk = ownerRisks?.[0] ?? null;
  if (topRisk) {
    pushStep({
      title: topRisk.label,
      detail: topRisk.detail,
      action: topRisk.action || "focus_release",
      actionLabel: topRisk.actionLabel || "Open"
    });
  }

  if (topDiagnosticHighlight?.label) {
    pushStep({
      title: `Handle: ${topDiagnosticHighlight.label}`,
      detail: topDiagnosticHighlight.next_action || topDiagnosticHighlight.detail || "Resolve the current release blocker.",
      action: "focus_release",
      actionLabel: "Open Release"
    });
  } else if (latestRelease || selectedReleaseId) {
    pushStep({
      title: "Review focus release",
      detail: `Open ${latestRelease?.title || selectedReleaseId || "the current release"} and validate readiness/handoff state.`,
      action: "focus_release",
      actionLabel: "Open Release"
    });
  }

  if (runtimeBackupsStatus?.auto_backup_enabled === false) {
    pushStep({
      title: "Fix reliability first",
      detail: "Re-enable auto-backup before any large assistant action.",
      action: "storage_health",
      actionLabel: "Open Storage"
    });
  } else if (Number(segmentsNeedingVisual?.length ?? 0) > 0) {
    pushStep({
      title: "Close visual pressure",
      detail: `${segmentsNeedingVisual.length} segment(s) still need visual support.`,
      action: "needs_visual",
      actionLabel: "Needs Visual"
    });
  } else if (Number(sourceMemorySummary?.total_domains ?? 0) === 0) {
    pushStep({
      title: "Seed assistant memory",
      detail: "Apply a few research results so source memory starts learning.",
      action: "source_intelligence",
      actionLabel: "Open Sources"
    });
  } else if (sourceMemorySignal?.detail) {
    pushStep({
      title: sourceMemorySignal.title || "Reuse source memory",
      detail: sourceMemorySignal.detail,
      action: "source_intelligence",
      actionLabel: "Open Sources"
    });
  }

  return steps.slice(0, 3);
}

export function NewsOpsOwnerDashboard({
  integrationOverview,
  integrationReleases,
  integrationBotSessions,
  segmentsNeedingVisual,
  sourceMemorySummary,
  releaseOutcomeMemorySummary,
  runtimeBackupsStatus,
  sqliteMirrorStatus,
  storageHealthHighlights,
  selectedReleaseId,
  selectedReleaseDetail,
  releaseControlPanel,
  releasePublishChecklist,
  releaseBriefingPanel,
  releaseActivity,
  formatDateTimeShort,
  onOpenFocusRelease,
  onOpenStorageHealth,
  onOpenSourceIntelligence,
  onOpenNeedsVisual
}) {
  const latestRelease = React.useMemo(() => pickLatestRelease(integrationReleases), [integrationReleases]);
  const focusRelease = selectedReleaseDetail || latestRelease;
  const latestMeaningfulActivity = React.useMemo(
    () => pickLatestMeaningfulActivity(releaseActivity),
    [releaseActivity]
  );
  const topDiagnosticHighlight =
    releaseBriefingPanel?.diagnostic_highlights?.[0] ||
    releaseControlPanel?.diagnostic_highlights?.[0] ||
    null;
  const sourceMemorySignal = React.useMemo(
    () => buildSourceMemorySignal(sourceMemorySummary),
    [sourceMemorySummary]
  );
  const recentChanges = React.useMemo(
    () =>
      buildRecentChanges({
        latestMeaningfulActivity,
        runtimeBackupsStatus,
        sqliteMirrorStatus,
        latestRelease,
        focusRelease,
        releaseControlPanel
      }),
    [focusRelease, latestMeaningfulActivity, latestRelease, releaseControlPanel, runtimeBackupsStatus, sqliteMirrorStatus]
  );
  const ownerRisks = React.useMemo(
    () =>
      buildOwnerRisks({
        segmentsNeedingVisual,
        integrationOverview,
        runtimeBackupsStatus,
        storageHealthHighlights,
        releaseControlPanel,
        releasePublishChecklist,
        topDiagnosticHighlight
      }),
    [
      integrationOverview,
      releaseControlPanel,
      releasePublishChecklist,
      runtimeBackupsStatus,
      segmentsNeedingVisual,
      storageHealthHighlights,
      topDiagnosticHighlight
    ]
  );
  const suggestedSession = React.useMemo(
    () =>
      buildSuggestedSession({
        ownerRisks,
        topDiagnosticHighlight,
        latestRelease,
        selectedReleaseId,
        runtimeBackupsStatus,
        segmentsNeedingVisual,
        sourceMemorySummary,
        sourceMemorySignal
      }),
    [
      latestRelease,
      ownerRisks,
      runtimeBackupsStatus,
      segmentsNeedingVisual,
      selectedReleaseId,
      sourceMemorySignal,
      sourceMemorySummary,
      topDiagnosticHighlight
    ]
  );
  const nextActions = React.useMemo(
    () =>
      buildNextActions({
        latestRelease,
        segmentsNeedingVisual,
        storageHealthHighlights,
        runtimeBackupsStatus,
        sourceMemorySummary,
        sourceMemorySignal,
        releaseOutcomeMemorySummary,
        integrationOverview
      }),
    [
      integrationOverview,
      latestRelease,
      releaseOutcomeMemorySummary,
      runtimeBackupsStatus,
      segmentsNeedingVisual,
      sourceMemorySignal,
      sourceMemorySummary,
      storageHealthHighlights
    ]
  );
  const handleRiskAction = React.useCallback(
    (action) => {
      switch (String(action ?? "").trim()) {
        case "focus_release":
          onOpenFocusRelease?.(latestRelease?.id || selectedReleaseId || focusRelease?.id);
          break;
        case "storage_health":
          onOpenStorageHealth?.();
          break;
        case "source_intelligence":
          onOpenSourceIntelligence?.();
          break;
        case "needs_visual":
          onOpenNeedsVisual?.();
          break;
        default:
          break;
      }
    },
    [
      focusRelease?.id,
      latestRelease?.id,
      onOpenFocusRelease,
      onOpenNeedsVisual,
      onOpenSourceIntelligence,
      onOpenStorageHealth,
      selectedReleaseId
    ]
  );

  return (
    <div className="integration-card owner-dashboard-card">
      <div className="integration-card-head">
        <strong>Owner Dashboard</strong>
        <span>System snapshot</span>
      </div>
      <div className="owner-dashboard-jumps">
        <button
          className="btn ghost small"
          type="button"
          onClick={() => onOpenFocusRelease?.(latestRelease?.id)}
          disabled={!latestRelease?.id}
        >
          Open Focus Release
        </button>
        <button className="btn ghost small" type="button" onClick={onOpenNeedsVisual}>
          Needs Visual
        </button>
        <button className="btn ghost small" type="button" onClick={onOpenSourceIntelligence}>
          Source Intelligence
        </button>
        <button className="btn ghost small" type="button" onClick={onOpenStorageHealth}>
          Storage Health
        </button>
      </div>
      {ownerRisks.length > 0 ? (
        <div className="owner-dashboard-risks">
          {ownerRisks.map((risk, index) => (
            <div
              key={`owner-risk-${risk.label}-${index}`}
              className={`owner-dashboard-risk owner-dashboard-risk-${risk.level}`}
            >
              <strong>{risk.label}</strong>
              <span>{risk.detail}</span>
              {risk.action ? (
                <div className="owner-dashboard-risk-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleRiskAction(risk.action)}
                  >
                    {risk.actionLabel || "Open"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="owner-dashboard-actions">
        <span className="owner-dashboard-label">Suggested Session</span>
        {suggestedSession.length > 0 ? (
          <div className="integration-list">
            {suggestedSession.map((step, index) => (
              <div key={`owner-session-${step.title}-${index}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{`Step ${index + 1}: ${step.title}`}</strong>
                  <span>{step.detail}</span>
                </div>
                <div className="integration-row-side">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => handleRiskAction(step.action)}
                  >
                    {step.actionLabel || "Open"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No suggested owner session right now.</div>
        )}
      </div>
      <div className="owner-dashboard-grid">
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Focus Release</span>
          {latestRelease ? (
            <>
              <strong>{latestRelease.title || latestRelease.id}</strong>
              <span>
                {latestRelease.status || "draft"}
                {latestRelease.document_id ? ` | ${latestRelease.document_id}` : ""}
              </span>
              <span>
                {`Assets ${Number(latestRelease.asset_count ?? 0)}${
                  latestRelease.air_date ? ` | Air ${latestRelease.air_date}` : ""
                }`}
              </span>
              <span>{formatDateTimeShort(latestRelease.updated_at || latestRelease.created_at)}</span>
            </>
          ) : (
            <span>No release yet.</span>
          )}
        </div>
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Pressure</span>
          <strong>{Number(segmentsNeedingVisual?.length ?? 0)}</strong>
          <span>{`Segments need visual`}</span>
          <span>{`Inbox ${Number(integrationOverview?.counts?.inbox_assets ?? 0)} | Sessions ${Number(integrationBotSessions?.length ?? 0)}`}</span>
        </div>
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Reliability</span>
          <strong>{runtimeBackupsStatus?.auto_backup_enabled === false ? "Attention" : "Stable"}</strong>
          <span>
            {runtimeBackupsStatus?.latest?.created_at
              ? `Latest backup ${formatDateTimeShort(runtimeBackupsStatus.latest.created_at)}`
              : "No runtime backup yet"}
          </span>
          <span>
            {sqliteMirrorStatus?.last_sync_at
              ? `SQLite sync ${formatDateTimeShort(sqliteMirrorStatus.last_sync_at)}`
              : "SQLite mirror idle"}
          </span>
        </div>
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Assistant Memory</span>
          <strong>{Number(sourceMemorySummary?.total_domains ?? 0)}</strong>
          <span>{`Source domains learned`}</span>
          <span>{`Release outcomes ${Number(releaseOutcomeMemorySummary?.total_domains ?? 0)}`}</span>
          {sourceMemorySignal?.short ? <span>{sourceMemorySignal.short}</span> : null}
          {sourceMemorySignal?.recentLabel ? <span>{sourceMemorySignal.recentLabel}</span> : null}
        </div>
      </div>
      <div className="owner-dashboard-release-summary">
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Current Release</span>
          {focusRelease ? (
            <>
              <strong>{focusRelease.title || focusRelease.id}</strong>
              <span>{selectedReleaseId ? `Selected ${selectedReleaseId}` : "Latest release loaded"}</span>
              <span>
                {`Editorial ${
                  releasePublishChecklist?.summary?.editorial_ready ? "ready" : "open"
                } | Handoff ${releaseControlPanel?.handoff_status_code || releasePublishChecklist?.summary?.handoff_status_code || "unknown"}`}
              </span>
            </>
          ) : (
            <span>No focused release yet.</span>
          )}
        </div>
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Top Blocker</span>
          <strong>{topDiagnosticHighlight?.label || "No major blocker"}</strong>
          <span>{topDiagnosticHighlight?.detail || "Current release looks stable from owner view."}</span>
          {topDiagnosticHighlight?.next_action ? <span>{`Next: ${topDiagnosticHighlight.next_action}`}</span> : null}
        </div>
        <div className="owner-dashboard-block">
          <span className="owner-dashboard-label">Last Assistant Move</span>
          {latestMeaningfulActivity ? (
            <>
              <strong>{latestMeaningfulActivity.label || latestMeaningfulActivity.event}</strong>
              <span>{latestMeaningfulActivity.detail || "Recent release activity"}</span>
              <span>{formatDateTimeShort(latestMeaningfulActivity.created_at)}</span>
            </>
          ) : (
            <span>No recent release activity yet.</span>
          )}
        </div>
      </div>
      <div className="owner-dashboard-actions">
        <span className="owner-dashboard-label">Next Actions</span>
        {nextActions.length > 0 ? (
          <div className="integration-list">
            {nextActions.map((item, index) => (
              <div key={`owner-next-${index}`} className="integration-row">
                <strong>{`Step ${index + 1}`}</strong>
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No urgent owner-level actions right now.</div>
        )}
      </div>
      <div className="owner-dashboard-actions">
        <span className="owner-dashboard-label">What Changed Recently</span>
        {recentChanges.length > 0 ? (
          <div className="integration-list">
            {recentChanges.map((item, index) => (
              <div key={`owner-change-${item.title}-${index}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <div className="integration-row-side">
                  <span>{formatDateTimeShort(item.at) || "recent"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">No recent changes captured yet.</div>
        )}
      </div>
    </div>
  );
}
