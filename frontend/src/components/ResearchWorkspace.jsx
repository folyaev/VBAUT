import React from "react";
import { SegmentLinkedReleasePanel } from "./SegmentLinkedReleasePanel.jsx";
import { SegmentResearchHeader } from "./SegmentResearchHeader.jsx";
import { SegmentResearchResultsPanel } from "./SegmentResearchResultsPanel.jsx";
import {
  buildResearchCategoryBuckets,
  RESEARCH_CATEGORY_ORDER,
  RESEARCH_CATEGORY_LABELS
} from "../utils/researchCategories.js";

function getResearchResultPhase(result) {
  const phase = String(result?.phase ?? result?.kind ?? "").trim().toLowerCase();
  return phase || "general";
}

function buildSegmentOptionLabel(segment = {}) {
  const segmentId = String(segment?.segment_id ?? "").trim() || "segment";
  const sectionTitle = String(segment?.section_title ?? "").trim();
  const quote = String(segment?.text_quote ?? "").replace(/\s+/g, " ").trim();
  const preview = quote.length > 80 ? `${quote.slice(0, 80).trimEnd()}...` : quote;
  return [segmentId, sectionTitle, preview].filter(Boolean).join(" · ");
}

export function ResearchWorkspace({
  docId,
  segments,
  selectedSegmentId,
  setSelectedSegmentId,
  selectedRunId,
  setSelectedRunId,
  segmentResearchRuns,
  segmentResearchHistory,
  segmentResearchLoading,
  onResearchRun,
  onResearchSelectRun,
  onResearchApply,
  onResearchApplyMany,
  onResearchPromoteBundle,
  onResearchCopyBrief,
  onUpdateResearchThemeContext,
  linkedReleaseInfo,
  linkedReleaseSnapshot,
  onOpenLinkedRelease,
  onOpenLinkedReleaseHandoff,
  onUseLinkedReleasePrimary,
  onPromoteLinkedReleasePrimaryPair,
  onPromoteLinkedReleaseBackupPair,
  onUseLinkedReleaseBackup,
  onExitResearchMode,
  inferResearchCandidateRole,
  deriveSegmentResearchCurrentPair,
  normalizeResearchBundleTrace,
  getCurrentPairBadgeClassName,
  formatSegmentResearchBriefLabel,
  formatResearchCandidateRoleLabel,
  collectResearchMemoryBadges,
  getVisibleResearchReasonTags
}) {
  const [researchView, setResearchView] = React.useState("all");
  const [researchPhaseFilter, setResearchPhaseFilter] = React.useState("all");
  const [researchRoleFilter, setResearchRoleFilter] = React.useState("all");
  const [researchCompareIds, setResearchCompareIds] = React.useState([]);
  const [themeTagsInput, setThemeTagsInput] = React.useState("");
  const [useThemeTitle, setUseThemeTitle] = React.useState(false);
  const [useThemeTags, setUseThemeTags] = React.useState(false);

  const researchSegments = React.useMemo(
    () =>
      (Array.isArray(segments) ? segments : []).filter((item) => {
        const blockType = String(item?.block_type ?? "").trim().toLowerCase();
        const segmentId = String(item?.segment_id ?? "").trim();
        return blockType !== "links" && !/^comments_/i.test(segmentId);
      }),
    [segments]
  );

  const selectedSegment = React.useMemo(() => {
    const normalizedSelectedId = String(selectedSegmentId ?? "").trim();
    if (!normalizedSelectedId) return researchSegments[0] ?? null;
    return researchSegments.find((item) => String(item?.segment_id ?? "").trim() === normalizedSelectedId) ?? researchSegments[0] ?? null;
  }, [researchSegments, selectedSegmentId]);

  const selectedSegmentIndex = React.useMemo(() => {
    const normalizedId = String(selectedSegment?.segment_id ?? "").trim();
    if (!normalizedId) return -1;
    return (Array.isArray(segments) ? segments : []).findIndex(
      (item) => String(item?.segment_id ?? "").trim() === normalizedId
    );
  }, [segments, selectedSegment]);

  const segmentId = String(selectedSegment?.segment_id ?? "").trim();
  const researchRun = segmentId ? segmentResearchRuns?.[segmentId] ?? null : null;
  const researchHistory = React.useMemo(
    () => (segmentId ? segmentResearchHistory?.[segmentId] ?? [] : []),
    [segmentId, segmentResearchHistory]
  );
  const researchLoading = Boolean(segmentId && segmentResearchLoading?.[segmentId]);
  const selectedResearchSources = React.useMemo(
    () => (Array.isArray(selectedSegment?.research_sources) ? selectedSegment.research_sources : []),
    [selectedSegment]
  );
  const selectedThemeTags = React.useMemo(
    () =>
      [...new Set(
        [
          ...(Array.isArray(selectedSegment?.topic_tags) ? selectedSegment.topic_tags : []),
          ...(Array.isArray(selectedSegment?.section_tags) ? selectedSegment.section_tags : [])
        ]
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      )],
    [selectedSegment]
  );
  const selectedThemeContextSettings = React.useMemo(
    () => ({
      research_use_topic_title: Boolean(selectedSegment?.research_use_topic_title),
      research_use_theme_tags: Boolean(selectedSegment?.research_use_theme_tags)
    }),
    [selectedSegment]
  );
  React.useEffect(() => {
    setThemeTagsInput(selectedThemeTags.join(", "));
  }, [selectedThemeTags, segmentId]);
  React.useEffect(() => {
    setUseThemeTitle(selectedThemeContextSettings.research_use_topic_title);
    setUseThemeTags(selectedThemeContextSettings.research_use_theme_tags);
  }, [selectedThemeContextSettings, segmentId]);

  const researchResults = React.useMemo(() => {
    const resultMap = new Map(
      (Array.isArray(researchRun?.results) ? researchRun.results : [])
        .map((item) => [String(item?.id ?? ""), item])
        .filter(([id]) => Boolean(id))
    );
    return (Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results : [])
      .map((ranked) => ({
        ranked,
        result: resultMap.get(String(ranked?.result_id ?? "")) ?? null
      }))
      .filter((item) => item.result)
      .slice(0, 12);
  }, [researchRun]);

  const researchBuckets = React.useMemo(() => buildResearchCategoryBuckets(researchResults), [researchResults]);

  const researchViewTabs = React.useMemo(
    () => [
      { id: "all", label: RESEARCH_CATEGORY_LABELS.all, count: researchBuckets.all.length },
      ...RESEARCH_CATEGORY_ORDER.map((categoryId) => ({
        id: categoryId,
        label: RESEARCH_CATEGORY_LABELS[categoryId],
        count: researchBuckets[categoryId]?.length ?? 0
      }))
    ],
    [researchBuckets]
  );

  const researchRoleTabs = React.useMemo(() => {
    const counts = {
      all: researchResults.length,
      source: 0,
      visual_candidate: 0,
      reference: 0
    };
    researchResults.forEach(({ ranked }) => {
      const role = inferResearchCandidateRole(selectedSegment, ranked);
      if (role === "main_source" || role === "backup_source") counts.source += 1;
      else if (Object.prototype.hasOwnProperty.call(counts, role)) counts[role] += 1;
    });
    return [
      { id: "all", label: "Any Role", count: counts.all },
      { id: "source", label: "Source", count: counts.source },
      { id: "visual_candidate", label: "Visual", count: counts.visual_candidate },
      { id: "reference", label: "Reference", count: counts.reference }
    ];
  }, [inferResearchCandidateRole, researchResults, selectedSegment]);

  const researchPhaseTabs = React.useMemo(() => {
    const counts = {
      all: researchResults.length,
      context: 0,
      source: 0,
      visual: 0,
      general: 0
    };
    researchResults.forEach(({ result }) => {
      const phase = getResearchResultPhase(result);
      if (Object.prototype.hasOwnProperty.call(counts, phase)) {
        counts[phase] += 1;
      } else {
        counts.general += 1;
      }
    });
    return [
      { id: "all", label: "All Phases", count: counts.all },
      { id: "context", label: "Context", count: counts.context },
      { id: "source", label: "Source Pass", count: counts.source },
      { id: "visual", label: "Visual Pass", count: counts.visual }
    ].filter((item) => item.id === "all" || item.count > 0);
  }, [researchResults]);

  const visibleResearchResults = React.useMemo(() => {
    const nextItems = researchBuckets[researchView] ?? researchBuckets.all;
    const scopedItems = Array.isArray(nextItems) && nextItems.length > 0 ? nextItems : researchBuckets.all;
    const phaseScoped =
      researchPhaseFilter === "all"
        ? scopedItems
        : scopedItems.filter(({ result }) => getResearchResultPhase(result) === researchPhaseFilter);
    if (researchRoleFilter === "all") return phaseScoped;
    return phaseScoped.filter(({ ranked }) => {
      const role = inferResearchCandidateRole(selectedSegment, ranked);
      if (researchRoleFilter === "source") {
        return role === "main_source" || role === "backup_source";
      }
      return role === researchRoleFilter;
    });
  }, [inferResearchCandidateRole, researchBuckets, researchPhaseFilter, researchRoleFilter, researchView, selectedSegment]);

  const bestSourceCandidate = [...researchResults]
    .sort(
      (a, b) =>
        Number(b?.ranked?.source_score ?? 0) - Number(a?.ranked?.source_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.result ?? null;
  const bestVisualCandidate = [...researchResults]
    .filter((item) => {
      const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
      return (
        hints.length > 0 ||
        Number(item?.ranked?.montage_score ?? 0) >= 0.55 ||
        Number(item?.ranked?.visual_score ?? 0) >= 0.58
      );
    })
    .sort(
      (a, b) =>
        Number(b?.ranked?.montage_score ?? b?.ranked?.visual_score ?? 0) -
          Number(a?.ranked?.montage_score ?? a?.ranked?.visual_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.result ?? null;
  const bestVisibleCandidate = visibleResearchResults[0]?.result ?? null;
  const bestContextPhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "context")?.result ?? null;
  const bestSourcePhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "source")?.result ?? null;
  const bestVisualPhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "visual")?.result ?? null;

  const deepResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "source"
      ) ?? null,
    [researchRun]
  );
  const deepResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "visual"
      ) ?? null,
    [researchRun]
  );
  const deepResearchPairReady = Boolean(
    researchRun?.mode === "deep" &&
    String(deepResearchSourceItem?.result_id ?? "").trim() &&
    String(deepResearchVisualItem?.result_id ?? "").trim()
  );

  const promotedResearchPair = React.useMemo(
    () => normalizeResearchBundleTrace(selectedSegment?.research_bundle_trace),
    [normalizeResearchBundleTrace, selectedSegment]
  );

  const primaryResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "source" || role === "main_source";
      }) ?? null,
    [researchRun]
  );
  const primaryResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "visual" || (role === "visual_candidate" && key !== "backup_visual");
      }) ?? null,
    [researchRun]
  );
  const backupResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "backup_source" || role === "backup_source";
      }) ?? null,
    [researchRun]
  );
  const backupResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "backup_visual"
      ) ?? null,
    [researchRun]
  );
  const currentSegmentResearchPair = React.useMemo(
    () =>
      deriveSegmentResearchCurrentPair(promotedResearchPair, {
        primarySource: primaryResearchSourceItem,
        primaryVisual: primaryResearchVisualItem,
        backupSource: backupResearchSourceItem,
        backupVisual: backupResearchVisualItem
      }),
    [
      backupResearchSourceItem,
      backupResearchVisualItem,
      deriveSegmentResearchCurrentPair,
      primaryResearchSourceItem,
      primaryResearchVisualItem,
      promotedResearchPair
    ]
  );

  const primaryResearchSourceResultId = String(primaryResearchSourceItem?.result_id ?? "").trim();
  const primaryResearchVisualResultId = String(primaryResearchVisualItem?.result_id ?? "").trim();
  const backupResearchSourceResultId = String(backupResearchSourceItem?.result_id ?? "").trim();
  const backupResearchVisualResultId = String(backupResearchVisualItem?.result_id ?? "").trim();

  const researchBriefItems = React.useMemo(
    () =>
      Array.isArray(researchRun?.brief?.items) && researchRun.brief.items.length > 0
        ? [
            ...researchRun.brief.items,
            ...(Array.isArray(researchRun?.brief?.phase_items) ? researchRun.brief.phase_items : [])
          ]
        : [],
    [researchRun]
  );

  const researchCompareItems = React.useMemo(() => {
    if (!researchCompareIds.length) return [];
    const itemMap = new Map(
      researchResults.map((item) => [String(item?.result?.id ?? "").trim(), item]).filter(([id]) => Boolean(id))
    );
    return researchCompareIds
      .map((id) => itemMap.get(String(id ?? "").trim()) ?? null)
      .filter(Boolean)
      .slice(0, 3);
  }, [researchCompareIds, researchResults]);

  const researchHistoryItems = React.useMemo(
    () => (Array.isArray(researchHistory) ? researchHistory : []).slice(0, 8),
    [researchHistory]
  );

  const researchPhaseSummary = React.useMemo(
    () =>
      (Array.isArray(researchRun?.summary?.phases) ? researchRun.summary.phases : [])
        .map((item) => {
          const phase = String(item?.phase ?? "").trim();
          const resultCount = Number(item?.result_count ?? 0);
          if (!phase || resultCount <= 0) return "";
          return `${phase}:${resultCount}`;
        })
        .filter(Boolean)
        .join(" · "),
    [researchRun]
  );

  const researchPhaseActionHints = React.useMemo(
    () =>
      (Array.isArray(researchRun?.summary?.phases) ? researchRun.summary.phases : [])
        .map((item) => {
          const phase = String(item?.phase ?? "").trim().toLowerCase();
          const resultCount = Number(item?.result_count ?? 0);
          if (!phase || resultCount <= 0) return null;
          if (phase === "source") return { phase, label: "Source Pass", action: "promote source", detail: `${resultCount} result(s)` };
          if (phase === "visual") return { phase, label: "Visual Pass", action: "promote visual", detail: `${resultCount} result(s)` };
          if (phase === "context") return { phase, label: "Context Pass", action: "attach context", detail: `${resultCount} result(s)` };
          return { phase, label: phase, action: "review", detail: `${resultCount} result(s)` };
        })
        .filter(Boolean),
    [researchRun]
  );

  React.useEffect(() => {
    const allowedIds = new Set(researchResults.map((item) => String(item?.result?.id ?? "").trim()).filter(Boolean));
    setResearchCompareIds((prev) => prev.filter((id) => allowedIds.has(String(id ?? "").trim())).slice(0, 3));
  }, [researchResults]);

  React.useEffect(() => {
    const allowedPhases = new Set(researchPhaseTabs.map((item) => String(item?.id ?? "").trim()));
    if (!allowedPhases.has(researchPhaseFilter)) {
      setResearchPhaseFilter("all");
    }
  }, [researchPhaseFilter, researchPhaseTabs]);

  if (!docId) {
    return (
      <section className="panel research-workspace-panel">
        <div className="panel-header">
          <h2>Research Workspace</h2>
        </div>
        <div className="muted">Укажи `doc_id` в URL или открой research из карточки сегмента.</div>
      </section>
    );
  }

  return (
    <section className="panel research-workspace-panel">
      <div className="panel-header">
        <div>
          <h2>Research Workspace</h2>
          <span className="research-workspace-doc">{docId}</span>
        </div>
        <div className="panel-actions">
          <button className="btn ghost small" type="button" onClick={onExitResearchMode}>
            Back To Scenario
          </button>
        </div>
      </div>
      <div className="research-workspace-controls">
        <label className="research-workspace-field">
          <span>Segment</span>
          <select
            value={segmentId}
            onChange={(event) => {
              setSelectedSegmentId(event.target.value);
              setSelectedRunId("");
            }}
          >
            {researchSegments.map((item) => (
              <option key={item.segment_id} value={item.segment_id}>
                {buildSegmentOptionLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <div className="research-workspace-actions">
          <button
            className="btn ghost small"
            type="button"
            onClick={() =>
              selectedSegmentIndex >= 0 &&
              onResearchRun(selectedSegmentIndex, "deep", {
                segmentOverride: {
                  section_title: selectedSegment?.section_title ?? null,
                  text_quote: selectedSegment?.text_quote ?? "",
                  research_use_topic_title: useThemeTitle,
                  research_use_theme_tags: useThemeTags,
                  topic_tags: themeTagsInput,
                  section_tags: themeTagsInput
                }
              })
            }
            disabled={selectedSegmentIndex < 0 || researchLoading}
          >
            {researchLoading ? "..." : "Research"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() =>
              selectedSegmentIndex >= 0 &&
              onResearchRun(selectedSegmentIndex, "deep", {
                excludeSeen: true,
                segmentOverride: {
                  section_title: selectedSegment?.section_title ?? null,
                  text_quote: selectedSegment?.text_quote ?? "",
                  research_use_topic_title: useThemeTitle,
                  research_use_theme_tags: useThemeTags,
                  topic_tags: themeTagsInput,
                  section_tags: themeTagsInput
                }
              })
            }
            disabled={selectedSegmentIndex < 0 || researchLoading}
          >
            {researchLoading ? "..." : "Искать заново"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => selectedSegmentIndex >= 0 && onResearchCopyBrief?.(selectedSegmentIndex)}
            disabled={selectedSegmentIndex < 0 || !researchRun}
          >
            Copy Brief
          </button>
        </div>
      </div>
      {selectedSegment ? (
        <div className="research-workspace-segment">
          <strong>{String(selectedSegment?.section_title ?? "").trim() || segmentId}</strong>
          <span>{String(selectedSegment?.text_quote ?? "").replace(/\s+/g, " ").trim()}</span>
          <div className="research-theme-tags-editor">
            <div className="segment-research-head">
              <strong>Theme Tags</strong>
              <span>Работают для всей темы этого документа</span>
            </div>
            <div className="research-theme-context-toggles">
              <label className="research-theme-toggle">
                <input
                  type="checkbox"
                  checked={useThemeTitle}
                  onChange={(event) => setUseThemeTitle(event.target.checked)}
                />
                <span>Учитывать имя темы</span>
              </label>
              <label className="research-theme-toggle">
                <input
                  type="checkbox"
                  checked={useThemeTags}
                  onChange={(event) => setUseThemeTags(event.target.checked)}
                />
                <span>Учитывать theme tags</span>
              </label>
            </div>
            <textarea
              value={themeTagsInput}
              onChange={(event) => setThemeTagsInput(event.target.value)}
              placeholder="oscar, academy awards, winners, nominees, red carpet"
              rows={2}
            />
            <div className="research-theme-tags-actions">
              <button
                className="btn ghost small"
                type="button"
                onClick={() =>
                  onUpdateResearchThemeContext?.(segmentId, {
                    themeTags: themeTagsInput,
                    research_use_topic_title: useThemeTitle,
                    research_use_theme_tags: useThemeTags
                  })
                }
                disabled={!segmentId}
              >
                Save Theme Context
              </button>
              {selectedThemeTags.length > 0 ? (
                <div className="segment-research-tags">
                  {selectedThemeTags.map((tag) => (
                    <span key={`${segmentId}-theme-tag-${tag}`} className="segment-research-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted">Теги можно хранить отдельно и включать только когда они реально помогают поиску.</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="muted">В документе пока нет сегментов для research.</div>
      )}
      {selectedSegment ? (
        <div className="segment-research-panel research-workspace-body">
          <SegmentResearchHeader
            researchLoading={researchLoading}
            researchRun={researchRun}
            researchPhaseSummary={researchPhaseSummary}
            index={selectedSegmentIndex}
            onResearchCopyBrief={onResearchCopyBrief}
            researchHistoryItems={researchHistoryItems}
            onResearchSelectRun={(index, runId) => {
              setSelectedRunId(runId);
              onResearchSelectRun(index, runId);
            }}
          />
          <SegmentLinkedReleasePanel
            segmentId={segmentId}
            linkedReleaseInfo={linkedReleaseInfo}
            linkedReleaseSnapshot={linkedReleaseSnapshot}
            getCurrentPairBadgeClassName={getCurrentPairBadgeClassName}
            onOpenLinkedRelease={onOpenLinkedRelease}
            onOpenLinkedReleaseHandoff={onOpenLinkedReleaseHandoff}
            onUseLinkedReleasePrimary={onUseLinkedReleasePrimary}
            onPromoteLinkedReleasePrimaryPair={onPromoteLinkedReleasePrimaryPair}
            onPromoteLinkedReleaseBackupPair={onPromoteLinkedReleaseBackupPair}
            onUseLinkedReleaseBackup={onUseLinkedReleaseBackup}
          />
          {Array.isArray(researchRun?.summary?.guidance) && researchRun.summary.guidance.length > 0 ? (
            <div className="research-workspace-guidance">
              {researchRun.summary.guidance.map((item, guidanceIndex) => (
                <span key={`${segmentId}-guidance-${guidanceIndex}`}>{item}</span>
              ))}
            </div>
          ) : null}
          {selectedResearchSources.length > 0 ? (
            <div className="research-workspace-linked">
              <div className="segment-research-head">
                <strong>Selected Links</strong>
                <span>{`${selectedResearchSources.length} added to segment`}</span>
              </div>
              <div className="research-workspace-linked-list">
                {selectedResearchSources.slice().reverse().slice(0, 10).map((item, itemIndex) => (
                  <div key={`${segmentId}-selected-link-${item.url || itemIndex}`} className="research-workspace-linked-item">
                    <strong>{String(item?.title ?? item?.url ?? "").trim() || "Research link"}</strong>
                    <span>
                      {[String(item?.domain ?? "").trim(), String(item?.role ?? "").trim(), String(item?.reason ?? "").trim()]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {researchRun ? (
            <SegmentResearchResultsPanel
              segment={selectedSegment}
              index={selectedSegmentIndex}
              researchResults={researchResults}
              researchViewTabs={researchViewTabs}
              researchView={researchView}
              setResearchView={setResearchView}
              researchPhaseTabs={researchPhaseTabs}
              researchPhaseFilter={researchPhaseFilter}
              setResearchPhaseFilter={setResearchPhaseFilter}
              researchRoleTabs={researchRoleTabs}
              researchRoleFilter={researchRoleFilter}
              setResearchRoleFilter={setResearchRoleFilter}
              bestSourceCandidate={bestSourceCandidate}
              bestVisualCandidate={bestVisualCandidate}
              bestVisibleCandidate={bestVisibleCandidate}
              deepResearchPairReady={deepResearchPairReady}
              deepResearchSourceItem={deepResearchSourceItem}
              deepResearchVisualItem={deepResearchVisualItem}
              bestSourcePhaseCandidate={bestSourcePhaseCandidate}
              bestVisualPhaseCandidate={bestVisualPhaseCandidate}
              bestContextPhaseCandidate={bestContextPhaseCandidate}
              researchLoading={researchLoading}
              researchRun={researchRun}
              visibleResearchResults={visibleResearchResults}
              researchCompareIds={researchCompareIds}
              setResearchCompareIds={setResearchCompareIds}
              researchCompareItems={researchCompareItems}
              currentResearchSources={selectedResearchSources}
              onResearchApplyMany={onResearchApplyMany}
              onResearchPromoteBundle={onResearchPromoteBundle}
              onResearchApply={onResearchApply}
              formatResearchCandidateRoleLabel={formatResearchCandidateRoleLabel}
              inferResearchCandidateRole={inferResearchCandidateRole}
              getResearchResultPhase={getResearchResultPhase}
              collectResearchMemoryBadges={collectResearchMemoryBadges}
              getVisibleResearchReasonTags={getVisibleResearchReasonTags}
            />
          ) : !researchLoading ? (
            <div className="muted">Запусти Research, чтобы открыть полный research workflow по сегменту.</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
