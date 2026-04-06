import React from "react";

export function useReleaseBoardState({
  selectedReleaseAssets,
  selectedReleaseAttachmentIds,
  setSelectedReleaseAttachmentIds,
  releaseBoardFilter,
  normalizeLinkUrl,
  integrationAssets,
  selectedReleaseDetail,
  docId,
  selectedReleaseId,
  segmentsNeedingVisual
}) {
  const selectedReleaseAttachmentIdSet = React.useMemo(
    () => new Set(selectedReleaseAttachmentIds.map((item) => String(item ?? "").trim()).filter(Boolean)),
    [selectedReleaseAttachmentIds]
  );

  const selectedReleaseItems = React.useMemo(
    () =>
      selectedReleaseAssets.filter((item) =>
        selectedReleaseAttachmentIdSet.has(String(item?.attachment?.id ?? "").trim())
      ),
    [selectedReleaseAssets, selectedReleaseAttachmentIdSet]
  );

  React.useEffect(() => {
    const allowedIds = new Set(selectedReleaseAssets.map((item) => String(item?.attachment?.id ?? "").trim()).filter(Boolean));
    setSelectedReleaseAttachmentIds((prev) => prev.filter((item) => allowedIds.has(String(item ?? "").trim())));
  }, [selectedReleaseAssets, setSelectedReleaseAttachmentIds]);

  const filteredReleaseAssets = React.useMemo(
    () =>
      selectedReleaseAssets.filter((item) => {
        if (releaseBoardFilter === "all") return true;
        if (releaseBoardFilter === "missing_script") {
          return !String(item?.attachment?.script_note ?? "").trim();
        }
        if (releaseBoardFilter === "missing_visual") {
          return !String(item?.attachment?.visual_note ?? "").trim();
        }
        if (releaseBoardFilter === "needs_link") {
          return !normalizeLinkUrl(item?.asset?.source_url ?? "");
        }
        return String(item?.attachment?.item_status ?? "planned") === releaseBoardFilter;
      }),
    [normalizeLinkUrl, releaseBoardFilter, selectedReleaseAssets]
  );

  const releaseBoardColumns = React.useMemo(
    () => ["planned", "selected", "scripting", "visual_ready", "ready", "done"],
    []
  );

  const releaseBoardCounts = React.useMemo(() => {
    const counts = {
      all: selectedReleaseAssets.length,
      missing_script: 0,
      missing_visual: 0,
      needs_link: 0
    };
    selectedReleaseAssets.forEach((item) => {
      const statusKey = String(item?.attachment?.item_status ?? "planned");
      counts[statusKey] = Number(counts[statusKey] ?? 0) + 1;
      if (!String(item?.attachment?.script_note ?? "").trim()) counts.missing_script += 1;
      if (!String(item?.attachment?.visual_note ?? "").trim()) counts.missing_visual += 1;
      if (!normalizeLinkUrl(item?.asset?.source_url ?? "")) counts.needs_link += 1;
    });
    return counts;
  }, [normalizeLinkUrl, selectedReleaseAssets]);

  const releaseSummary = React.useMemo(() => {
    const summary = {
      total: selectedReleaseAssets.length,
      ready: 0,
      in_progress: 0,
      missing_script: 0,
      missing_visual: 0,
      with_screenshots: 0,
      with_links: 0
    };
    selectedReleaseAssets.forEach((item) => {
      const itemStatus = String(item?.attachment?.item_status ?? "planned");
      const kind = String(item?.asset?.kind ?? "").trim().toLowerCase();
      const hasScript = Boolean(String(item?.attachment?.script_note ?? "").trim());
      const hasVisual = Boolean(String(item?.attachment?.visual_note ?? "").trim());
      const hasLink = Boolean(normalizeLinkUrl(item?.asset?.source_url ?? ""));
      if (itemStatus === "ready" || itemStatus === "done") summary.ready += 1;
      if (!["ready", "done", "skipped"].includes(itemStatus)) summary.in_progress += 1;
      if (!hasScript) summary.missing_script += 1;
      if (!hasVisual) summary.missing_visual += 1;
      if (kind === "screenshot") summary.with_screenshots += 1;
      if (hasLink) summary.with_links += 1;
    });
    return summary;
  }, [normalizeLinkUrl, selectedReleaseAssets]);

  const releaseAttachedAssetIds = React.useMemo(
    () => new Set(selectedReleaseAssets.map((item) => String(item?.asset?.id ?? "")).filter(Boolean)),
    [selectedReleaseAssets]
  );

  const releaseOrphanScreenshots = React.useMemo(() => {
    const activeDocumentId = String(selectedReleaseDetail?.document_id || docId || "").trim();
    return integrationAssets.filter((asset) => {
      if (String(asset?.kind ?? "").trim().toLowerCase() !== "screenshot") return false;
      if (releaseAttachedAssetIds.has(String(asset.id ?? ""))) return false;
      const targets = Array.isArray(asset?.targets) ? asset.targets : [];
      const hasCurrentReleaseTarget = targets.some(
        (target) => target?.target_type === "release" && String(target?.target_id ?? "") === String(selectedReleaseId)
      );
      if (hasCurrentReleaseTarget) return false;
      if (!activeDocumentId) return true;
      return targets.some(
        (target) =>
          (target?.target_type === "document" && String(target?.target_id ?? "") === activeDocumentId) ||
          target?.target_type === "segment"
      );
    });
  }, [docId, integrationAssets, releaseAttachedAssetIds, selectedReleaseDetail, selectedReleaseId]);

  const releaseAssistantFindings = React.useMemo(() => {
    const findings = [];
    if (releaseSummary.missing_visual > 0) {
      findings.push({
        key: "missing_visual",
        severity: "high",
        title: `${releaseSummary.missing_visual} item без visual note`,
        detail: "Выпуск ещё не закрыт по визуалу. Проверь visual notes и недостающие скрины."
      });
    }
    if (releaseSummary.missing_script > 0) {
      findings.push({
        key: "missing_script",
        severity: "high",
        title: `${releaseSummary.missing_script} item без script note`,
        detail: "Есть материалы без редакторской пометки по тексту или подаче."
      });
    }
    if (releaseSummary.with_links === 0 && releaseSummary.total > 0) {
      findings.push({
        key: "needs_link",
        severity: "medium",
        title: "В выпуске нет source links",
        detail: "Ссылки нужны для проверки фактуры, capture flow и повторного поиска."
      });
    } else if (releaseBoardCounts.needs_link > 0) {
      findings.push({
        key: "needs_link",
        severity: "medium",
        title: `${releaseBoardCounts.needs_link} item без source link`,
        detail: "Часть материалов нельзя быстро перепроверить или прогнать через screenshot flow."
      });
    }
    if (segmentsNeedingVisual.length > 0) {
      findings.push({
        key: "segments_visual_gap",
        severity: "medium",
        title: `${segmentsNeedingVisual.length} сегм. без визуала`,
        detail: "В текущем документе есть сегменты, которые ещё не закрыты визуалом."
      });
    }
    if (releaseOrphanScreenshots.length > 0) {
      findings.push({
        key: "orphan_screenshots",
        severity: "low",
        title: `${releaseOrphanScreenshots.length} screenshot asset вне выпуска`,
        detail: "Есть готовые скрины, которые можно быстро дотянуть в текущий release."
      });
    }
    if (findings.length === 0 && selectedReleaseAssets.length > 0) {
      findings.push({
        key: "all_good",
        severity: "ok",
        title: "Явных дыр не найдено",
        detail: "По текущим полям выпуск выглядит собранным."
      });
    }
    return findings;
  }, [
    releaseBoardCounts.needs_link,
    releaseOrphanScreenshots.length,
    releaseSummary,
    segmentsNeedingVisual.length,
    selectedReleaseAssets.length
  ]);

  return {
    selectedReleaseAttachmentIdSet,
    selectedReleaseItems,
    filteredReleaseAssets,
    releaseBoardColumns,
    releaseBoardCounts,
    releaseSummary,
    releaseOrphanScreenshots,
    releaseAssistantFindings
  };
}
