import React from "react";

export function useReleaseWorkspaceData({
  selectedReleaseId,
  appMode,
  fetchJsonSafe,
  refreshIntegration
}) {
  const [selectedReleaseDetail, setSelectedReleaseDetail] = React.useState(null);
  const [releaseAssistantPass, setReleaseAssistantPass] = React.useState(null);
  const [releaseRecommendations, setReleaseRecommendations] = React.useState(null);
  const [releaseDraftPack, setReleaseDraftPack] = React.useState(null);
  const [releasePublishChecklist, setReleasePublishChecklist] = React.useState(null);
  const [releaseControlPanel, setReleaseControlPanel] = React.useState(null);
  const [releaseBriefingPanel, setReleaseBriefingPanel] = React.useState(null);
  const [releaseResearchBriefs, setReleaseResearchBriefs] = React.useState(null);
  const [releaseActivity, setReleaseActivity] = React.useState([]);

  const loadReleaseDetail = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setSelectedReleaseDetail(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(`/api/releases/${encodeURIComponent(normalizedId)}`);
        if (!response.ok) return null;
        const release = data?.release ?? null;
        setSelectedReleaseDetail(release);
        return release;
      } catch {
        setSelectedReleaseDetail(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseAssistantPass = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseAssistantPass(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/assistant-pass`
        );
        if (!response.ok) return null;
        const nextPass = data?.assistant_pass ?? null;
        setReleaseAssistantPass(nextPass);
        return nextPass;
      } catch {
        setReleaseAssistantPass(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseActivity = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseActivity([]);
        return [];
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/activity?limit=20`
        );
        if (!response.ok) return [];
        const activity = Array.isArray(data?.activity) ? data.activity : [];
        setReleaseActivity(activity);
        return activity;
      } catch {
        setReleaseActivity([]);
        return [];
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseRecommendations = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseRecommendations(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/recommendations`
        );
        if (!response.ok) return null;
        const recommendations = data?.recommendations ?? null;
        setReleaseRecommendations(recommendations);
        return recommendations;
      } catch {
        setReleaseRecommendations(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseDraftPack = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseDraftPack(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/draft-pack`
        );
        if (!response.ok) return null;
        const draftPack = data?.draft_pack ?? null;
        setReleaseDraftPack(draftPack);
        return draftPack;
      } catch {
        setReleaseDraftPack(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleasePublishChecklist = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleasePublishChecklist(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/publish-checklist`
        );
        if (!response.ok) return null;
        const publishChecklist = data?.publish_checklist ?? null;
        setReleasePublishChecklist(publishChecklist);
        return publishChecklist;
      } catch {
        setReleasePublishChecklist(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseControlPanel = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseControlPanel(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(normalizedId)}/control-panel`
        );
        if (!response.ok) return null;
        const controlPanel = data?.control_panel ?? null;
        if (data?.publish_checklist) {
          setReleasePublishChecklist(data.publish_checklist);
        }
        setReleaseControlPanel(controlPanel);
        return controlPanel;
      } catch {
        setReleaseControlPanel(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const loadReleaseBriefingPanel = React.useCallback(
    async (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) {
        setReleaseBriefingPanel(null);
        setReleaseResearchBriefs(null);
        return null;
      }
      try {
        const { response, data } = await fetchJsonSafe(`/api/releases/${encodeURIComponent(normalizedId)}/briefing`);
        if (!response.ok) return null;
        if (data?.publish_checklist) {
          setReleasePublishChecklist(data.publish_checklist);
        }
        if (data?.control_panel) {
          setReleaseControlPanel(data.control_panel);
        }
        const briefingPanel = data?.briefing_panel ?? null;
        setReleaseResearchBriefs(data?.research_briefs ?? null);
        setReleaseBriefingPanel(briefingPanel);
        return briefingPanel;
      } catch {
        setReleaseBriefingPanel(null);
        setReleaseResearchBriefs(null);
        return null;
      }
    },
    [fetchJsonSafe]
  );

  const reloadReleaseWorkspaceData = React.useCallback(
    async (
      releaseId,
      {
        detail = true,
        assistantPass = true,
        recommendations = true,
        draftPack = true,
        publishChecklist = false,
        controlPanel = false,
        briefingPanel = false,
        activity = true,
        integration = false
      } = {}
    ) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) return null;
      if (integration) {
        await refreshIntegration();
      }
      const tasks = [];
      if (detail) tasks.push(loadReleaseDetail(normalizedId));
      if (assistantPass) tasks.push(loadReleaseAssistantPass(normalizedId));
      if (recommendations) tasks.push(loadReleaseRecommendations(normalizedId));
      if (draftPack) tasks.push(loadReleaseDraftPack(normalizedId));
      if (publishChecklist) tasks.push(loadReleasePublishChecklist(normalizedId));
      if (controlPanel) tasks.push(loadReleaseControlPanel(normalizedId));
      if (briefingPanel) tasks.push(loadReleaseBriefingPanel(normalizedId));
      if (activity) tasks.push(loadReleaseActivity(normalizedId));
      await Promise.all(tasks);
      return normalizedId;
    },
    [
      loadReleaseActivity,
      loadReleaseAssistantPass,
      loadReleaseBriefingPanel,
      loadReleaseControlPanel,
      loadReleaseDetail,
      loadReleaseDraftPack,
      loadReleasePublishChecklist,
      loadReleaseRecommendations,
      refreshIntegration
    ]
  );

  const syncReleaseWorkspaceDataFromAction = React.useCallback(
    async (
      data,
      {
        releaseId,
        detail = true,
        assistantPass = true,
        recommendations = true,
        draftPack = true,
        publishChecklist = false,
        controlPanel = false,
        briefingPanel = false,
        activity = true,
        integration = false
      } = {}
    ) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) return null;
      if (integration) {
        await refreshIntegration();
      }
      const tasks = [];

      if (detail) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "release")) {
          setSelectedReleaseDetail(data?.release ?? null);
        } else {
          tasks.push(loadReleaseDetail(normalizedId));
        }
      }
      if (assistantPass) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "assistant_pass")) {
          setReleaseAssistantPass(data?.assistant_pass ?? null);
        } else {
          tasks.push(loadReleaseAssistantPass(normalizedId));
        }
      }
      if (recommendations) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "recommendations")) {
          setReleaseRecommendations(data?.recommendations ?? null);
        } else {
          tasks.push(loadReleaseRecommendations(normalizedId));
        }
      }
      if (draftPack) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "draft_pack")) {
          setReleaseDraftPack(data?.draft_pack ?? null);
        } else {
          tasks.push(loadReleaseDraftPack(normalizedId));
        }
      }
      if (publishChecklist) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "publish_checklist")) {
          setReleasePublishChecklist(data?.publish_checklist ?? null);
        } else {
          tasks.push(loadReleasePublishChecklist(normalizedId));
        }
      }
      if (controlPanel) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "control_panel")) {
          setReleaseControlPanel(data?.control_panel ?? null);
        } else {
          tasks.push(loadReleaseControlPanel(normalizedId));
        }
      }
      if (briefingPanel) {
        if (Object.prototype.hasOwnProperty.call(data ?? {}, "briefing_panel")) {
          setReleaseBriefingPanel(data?.briefing_panel ?? null);
          setReleaseResearchBriefs(data?.research_briefs ?? null);
        } else {
          tasks.push(loadReleaseBriefingPanel(normalizedId));
        }
      }
      if (activity) {
        tasks.push(loadReleaseActivity(normalizedId));
      }

      await Promise.all(tasks);
      return normalizedId;
    },
    [
      loadReleaseActivity,
      loadReleaseAssistantPass,
      loadReleaseBriefingPanel,
      loadReleaseControlPanel,
      loadReleaseDetail,
      loadReleaseDraftPack,
      loadReleasePublishChecklist,
      loadReleaseRecommendations,
      refreshIntegration
    ]
  );

  React.useEffect(() => {
    loadReleaseDetail(selectedReleaseId);
    loadReleaseAssistantPass(selectedReleaseId);
    loadReleaseRecommendations(selectedReleaseId);
    loadReleaseDraftPack(selectedReleaseId);
    loadReleasePublishChecklist(selectedReleaseId);
    loadReleaseControlPanel(selectedReleaseId);
    loadReleaseBriefingPanel(selectedReleaseId);
    loadReleaseActivity(selectedReleaseId);
  }, [
    loadReleaseActivity,
    loadReleaseAssistantPass,
    loadReleaseBriefingPanel,
    loadReleaseControlPanel,
    loadReleaseDetail,
    loadReleaseDraftPack,
    loadReleasePublishChecklist,
    loadReleaseRecommendations,
    selectedReleaseId
  ]);

  React.useEffect(() => {
    if (!selectedReleaseId || !selectedReleaseDetail?.updated_at) return;
    loadReleasePublishChecklist(selectedReleaseId);
    loadReleaseControlPanel(selectedReleaseId);
    loadReleaseBriefingPanel(selectedReleaseId);
  }, [
    loadReleaseBriefingPanel,
    loadReleaseControlPanel,
    loadReleasePublishChecklist,
    selectedReleaseDetail?.updated_at,
    selectedReleaseId
  ]);

  React.useEffect(() => {
    if (!selectedReleaseId) return;
    loadReleaseControlPanel(selectedReleaseId);
    loadReleaseBriefingPanel(selectedReleaseId);
  }, [
    loadReleaseBriefingPanel,
    loadReleaseControlPanel,
    releaseAssistantPass,
    releasePublishChecklist,
    selectedReleaseId
  ]);

  React.useEffect(() => {
    if (appMode === "workspace" || !selectedReleaseId) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadReleaseDetail(selectedReleaseId);
      loadReleaseAssistantPass(selectedReleaseId);
      loadReleasePublishChecklist(selectedReleaseId);
      loadReleaseControlPanel(selectedReleaseId);
      loadReleaseBriefingPanel(selectedReleaseId);
      loadReleaseActivity(selectedReleaseId);
    }, 15000);
    return () => clearInterval(timer);
  }, [
    appMode,
    loadReleaseActivity,
    loadReleaseAssistantPass,
    loadReleaseBriefingPanel,
    loadReleaseControlPanel,
    loadReleaseDetail,
    loadReleasePublishChecklist,
    selectedReleaseId
  ]);

  return {
    selectedReleaseDetail,
    setSelectedReleaseDetail,
    releaseAssistantPass,
    setReleaseAssistantPass,
    releaseRecommendations,
    setReleaseRecommendations,
    releaseDraftPack,
    setReleaseDraftPack,
    releasePublishChecklist,
    setReleasePublishChecklist,
    releaseControlPanel,
    setReleaseControlPanel,
    releaseBriefingPanel,
    setReleaseBriefingPanel,
    releaseResearchBriefs,
    setReleaseResearchBriefs,
    releaseActivity,
    setReleaseActivity,
    loadReleaseDetail,
    loadReleaseAssistantPass,
    loadReleaseActivity,
    loadReleaseRecommendations,
    loadReleaseDraftPack,
    loadReleasePublishChecklist,
    loadReleaseControlPanel,
    loadReleaseBriefingPanel,
    reloadReleaseWorkspaceData,
    syncReleaseWorkspaceDataFromAction
  };
}
