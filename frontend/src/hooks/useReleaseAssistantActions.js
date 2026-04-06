import React from "react";

export function useReleaseAssistantActions({
  fetchJsonSafe,
  selectedReleaseId,
  selectedReleaseAttachmentIds,
  releaseBulkScriptTemplate,
  releaseBulkVisualTemplate,
  setReleaseBusy,
  setStatus,
  setLastAttachRecommendationsResult,
  setSelectedReleaseAttachmentIds,
  setReleasePublishChecklist,
  setReleaseControlPanel,
  rememberAssistantAutoBackup,
  syncCurrentReleaseActionData,
  reloadCurrentReleaseWorkspace
}) {
  const handleAttachOrphanScreenshots = React.useCallback(async () => {
    if (!selectedReleaseId) return;
    setReleaseBusy(true);
    try {
      const { response, data } = await fetchJsonSafe(
        `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/attach-orphan-screenshots`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось прикрепить orphan screenshots");
      }
      await syncCurrentReleaseActionData(data, {
        integration: true,
        detail: true,
        assistantPass: true,
        recommendations: true,
        draftPack: true,
        activity: true
      });
      setStatus(`К выпуску прикреплено screenshot assets: ${Number(data?.attached ?? 0)}`);
    } catch (error) {
      setStatus(error?.message ?? "Не удалось прикрепить screenshot assets");
    } finally {
      setReleaseBusy(false);
    }
  }, [fetchJsonSafe, selectedReleaseId, setReleaseBusy, setStatus, syncCurrentReleaseActionData]);

  const handleAttachRecommendedBatch = React.useCallback(
    async (assetIds = null) => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const normalizedAssetIds = Array.isArray(assetIds)
          ? Array.from(new Set(assetIds.map((item) => String(item ?? "").trim()).filter(Boolean)))
          : [];
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/attach-recommendations`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              limit: normalizedAssetIds.length > 0 ? normalizedAssetIds.length : 3,
              asset_ids: normalizedAssetIds
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось прикрепить рекомендации");
        }
        await syncCurrentReleaseActionData(data, {
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: false,
          activity: false
        });
        setLastAttachRecommendationsResult({
          selected_ids: Array.isArray(data?.selected_ids) ? data.selected_ids : normalizedAssetIds,
          attached_ids: Array.isArray(data?.attached_ids) ? data.attached_ids : [],
          skipped_ids: Array.isArray(data?.skipped_ids) ? data.skipped_ids : [],
          results: Array.isArray(data?.results) ? data.results : [],
          attached: Number(data?.attached ?? 0),
          skipped: Number(data?.skipped ?? 0)
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "attach recommendations");
        await reloadCurrentReleaseWorkspace({
          integration: true,
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: true,
          activity: true
        });
        setStatus(
          `К выпуску прикреплено рекомендаций: ${Number(data?.attached ?? 0)}${backupId ? ` · backup ${backupId}` : ""}`
        );
      } catch (error) {
        setStatus(error?.message ?? "Не удалось прикрепить рекомендации");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseId,
      setLastAttachRecommendationsResult,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleFillMissingVisualsWithRecommendations = React.useCallback(async () => {
    if (!selectedReleaseId) return;
    setReleaseBusy(true);
    try {
      const { response, data } = await fetchJsonSafe(
        `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/fill-missing-visuals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 3 })
        }
      );
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось закрыть visual gaps");
      }
      await syncCurrentReleaseActionData(data, {
        integration: true,
        detail: true,
        assistantPass: true,
        recommendations: true,
        draftPack: true,
        activity: false
      });
      const backupId = rememberAssistantAutoBackup(data?.auto_backup, "fill missing visuals");
      await reloadCurrentReleaseWorkspace({
        integration: true,
        detail: false,
        assistantPass: false,
        recommendations: false,
        draftPack: false,
        activity: true
      });
      setStatus(
        `Visual gaps updated: ${Number(data?.updated ?? 0)}, attached visuals: ${Number(data?.attached ?? 0)}${
          backupId ? ` · backup ${backupId}` : ""
        }`
      );
    } catch (error) {
      setStatus(error?.message ?? "Не удалось закрыть visual gaps");
    } finally {
      setReleaseBusy(false);
    }
  }, [
    fetchJsonSafe,
    reloadCurrentReleaseWorkspace,
    rememberAssistantAutoBackup,
    selectedReleaseId,
    setReleaseBusy,
    setStatus,
    syncCurrentReleaseActionData
  ]);

  const handleBulkUpdateReleaseItems = React.useCallback(
    async (patch = {}, successLabel = "release items updated") => {
      if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/update-selection-items`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: selectedReleaseAttachmentIds,
              patch
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось массово обновить release items");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`${successLabel}: ${Number(data?.updated ?? 0)}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось массово обновить release items");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleBulkApplyNoteTemplates = React.useCallback(
    async ({ overwrite = false } = {}) => {
      if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
      const scriptTemplate = String(releaseBulkScriptTemplate ?? "").trim();
      const visualTemplate = String(releaseBulkVisualTemplate ?? "").trim();
      if (!scriptTemplate && !visualTemplate) {
        setStatus("Заполните script note или visual note шаблон.");
        return;
      }
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/apply-selection-note-templates`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: selectedReleaseAttachmentIds,
              script_template: scriptTemplate,
              visual_template: visualTemplate,
              overwrite
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось применить note template");
        }
        if (Number(data?.updated ?? 0) === 0) {
          setStatus("Для выбранных items нечего обновлять этим шаблоном.");
          return;
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`${overwrite ? "Шаблон перезаписал" : "Шаблон заполнил"} items: ${Number(data?.updated ?? 0)}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось применить note template");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      releaseBulkScriptTemplate,
      releaseBulkVisualTemplate,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleBulkUpdateSelectedAssetStatus = React.useCallback(
    async (nextStatus, successLabel = "assets updated") => {
      const normalizedStatus = String(nextStatus ?? "").trim();
      if (!normalizedStatus || selectedReleaseAttachmentIds.length === 0) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/update-selection-asset-status`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: selectedReleaseAttachmentIds,
              status: normalizedStatus
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось массово обновить assets");
        }
        await syncCurrentReleaseActionData(data, {
          integration: true,
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setStatus(`${successLabel}: ${Number(data?.updated ?? 0)}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось массово обновить assets");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleBulkDetachReleaseItems = React.useCallback(async () => {
    if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
    setReleaseBusy(true);
    try {
      const { response, data } = await fetchJsonSafe(
        `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/detach-selection-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attachment_ids: selectedReleaseAttachmentIds
          })
        }
      );
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось массово снять assets с выпуска");
      }
      setSelectedReleaseAttachmentIds([]);
      await syncCurrentReleaseActionData(data, {
        integration: true,
        detail: true,
        assistantPass: true,
        recommendations: true,
        draftPack: true,
        activity: true
      });
      setStatus(`Снято с выпуска: ${Number(data?.detached ?? 0)}`);
    } catch (error) {
      setStatus(error?.message ?? "Не удалось массово снять assets");
    } finally {
      setReleaseBusy(false);
    }
  }, [
    fetchJsonSafe,
    selectedReleaseAttachmentIds,
    selectedReleaseId,
    setReleaseBusy,
    setSelectedReleaseAttachmentIds,
    setStatus,
    syncCurrentReleaseActionData
  ]);

  const handleApplySelectionDraftPack = React.useCallback(
    async (mode = "missing_only") => {
      if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/apply-selection-draft-pack`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode,
              attachment_ids: selectedReleaseAttachmentIds
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось применить draft pack к выборке");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: false
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "apply selection draft pack");
        await reloadCurrentReleaseWorkspace({
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: false,
          activity: true
        });
        setStatus(`Draft pack applied to selected items: ${Number(data?.updated ?? 0)}${backupId ? ` · backup ${backupId}` : ""}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось применить draft pack к выборке");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleFillSelectedVisualsWithRecommendations = React.useCallback(
    async () => {
      if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/fill-selection-visuals`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: selectedReleaseAttachmentIds
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось закрыть visual gaps в выборке");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: false
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "fill selection visuals");
        await reloadCurrentReleaseWorkspace({
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: false,
          activity: true
        });
        setStatus(`Selected visuals filled: ${Number(data?.updated ?? 0)}${backupId ? ` · backup ${backupId}` : ""}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось закрыть visual gaps в выборке");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handlePrepareSelectedReleaseItems = React.useCallback(
    async () => {
      if (!selectedReleaseId || selectedReleaseAttachmentIds.length === 0) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/prepare-selection`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: selectedReleaseAttachmentIds
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось подготовить выбранные items");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: false
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "prepare selection");
        await reloadCurrentReleaseWorkspace({
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: false,
          activity: true
        });
        setStatus(
          `Prepared selected: ${Number(data?.updated ?? 0)} items, ${Number(data?.attached ?? 0)} visuals${
            backupId ? ` · backup ${backupId}` : ""
          }`
        );
      } catch (error) {
        setStatus(error?.message ?? "Не удалось подготовить выбранные items");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseAttachmentIds,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handlePrepareReleaseAttachment = React.useCallback(
    async (attachmentId) => {
      const normalizedId = String(attachmentId ?? "").trim();
      if (!selectedReleaseId || !normalizedId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/prepare-selection`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: [normalizedId]
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось подготовить item");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setSelectedReleaseAttachmentIds([normalizedId]);
        setStatus(`Prepared item: ${Number(data?.updated ?? 0)} update(s), ${Number(data?.attached ?? 0)} visual(s)`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось подготовить item");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseId,
      setReleaseBusy,
      setSelectedReleaseAttachmentIds,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleDraftReleaseAttachment = React.useCallback(
    async (attachmentId, mode = "missing_only") => {
      const normalizedId = String(attachmentId ?? "").trim();
      if (!selectedReleaseId || !normalizedId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/apply-selection-draft-pack`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: [normalizedId],
              mode
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось применить draft pack к item");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setSelectedReleaseAttachmentIds([normalizedId]);
        setStatus(`Draft applied to item: ${Number(data?.updated ?? 0)}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось применить draft pack к item");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseId,
      setReleaseBusy,
      setSelectedReleaseAttachmentIds,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleFillReleaseAttachmentVisuals = React.useCallback(
    async (attachmentId) => {
      const normalizedId = String(attachmentId ?? "").trim();
      if (!selectedReleaseId || !normalizedId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/fill-selection-visuals`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attachment_ids: [normalizedId],
              limit: 1
            })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось закрыть visual gaps для item");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: true
        });
        setSelectedReleaseAttachmentIds([normalizedId]);
        setStatus(`Visuals filled for item: ${Number(data?.updated ?? 0)}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось закрыть visual gaps для item");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseId,
      setReleaseBusy,
      setSelectedReleaseAttachmentIds,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handlePrepareRelease = React.useCallback(
    async () => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/prepare-release`,
          {
            method: "POST",
            headers: { "content-type": "application/json" }
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось подготовить выпуск");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: false
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "prepare release");
        await reloadCurrentReleaseWorkspace({
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: false,
          activity: true
        });
        setStatus(
          `Release prepared: ${Number(data?.updated ?? 0)} items, ${Number(data?.attached ?? 0)} visuals${
            backupId ? ` · backup ${backupId}` : ""
          }`
        );
      } catch (error) {
        setStatus(error?.message ?? "Не удалось подготовить выпуск");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleMarkReleaseAirReady = React.useCallback(
    async () => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/mark-air-ready`,
          {
            method: "POST",
            headers: { "content-type": "application/json" }
          }
        );
        if (!response.ok) {
          if (data?.publish_checklist) {
            setReleasePublishChecklist(data.publish_checklist);
          }
          throw new Error(data?.error || "Не удалось перевести выпуск в air_ready");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          publishChecklist: true,
          controlPanel: true,
          activity: true
        });
        setStatus("Release marked as air_ready");
      } catch (error) {
        setStatus(error?.message ?? "Не удалось перевести выпуск в air_ready");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseId,
      setReleaseBusy,
      setReleasePublishChecklist,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handlePublishRelease = React.useCallback(
    async () => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/publish-release`,
          {
            method: "POST",
            headers: { "content-type": "application/json" }
          }
        );
        if (!response.ok) {
          if (data?.publish_checklist) {
            setReleasePublishChecklist(data.publish_checklist);
          }
          if (data?.control_panel) {
            setReleaseControlPanel(data.control_panel);
          }
          throw new Error(data?.error || "Не удалось опубликовать выпуск");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          publishChecklist: true,
          controlPanel: true,
          activity: true
        });
        setStatus("Release marked as published");
      } catch (error) {
        setStatus(error?.message ?? "Не удалось опубликовать выпуск");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      selectedReleaseId,
      setReleaseBusy,
      setReleaseControlPanel,
      setReleasePublishChecklist,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  const handleApplyReleaseDraftPack = React.useCallback(
    async (mode = "missing_only") => {
      if (!selectedReleaseId) return;
      setReleaseBusy(true);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/assistant-actions/apply-draft-pack`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode })
          }
        );
        if (!response.ok) {
          throw new Error(data?.error || "Не удалось применить draft pack");
        }
        await syncCurrentReleaseActionData(data, {
          detail: true,
          assistantPass: true,
          recommendations: true,
          draftPack: true,
          activity: false
        });
        const backupId = rememberAssistantAutoBackup(data?.auto_backup, "apply release draft pack");
        await reloadCurrentReleaseWorkspace({
          detail: false,
          assistantPass: false,
          recommendations: false,
          draftPack: false,
          activity: true
        });
        setStatus(`Draft pack applied: ${Number(data?.updated ?? 0)}${backupId ? ` · backup ${backupId}` : ""}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось применить draft pack");
      } finally {
        setReleaseBusy(false);
      }
    },
    [
      fetchJsonSafe,
      reloadCurrentReleaseWorkspace,
      rememberAssistantAutoBackup,
      selectedReleaseId,
      setReleaseBusy,
      setStatus,
      syncCurrentReleaseActionData
    ]
  );

  return {
    handleAttachOrphanScreenshots,
    handleAttachRecommendedBatch,
    handleFillMissingVisualsWithRecommendations,
    handleBulkUpdateReleaseItems,
    handleBulkApplyNoteTemplates,
    handleBulkUpdateSelectedAssetStatus,
    handleBulkDetachReleaseItems,
    handleApplySelectionDraftPack,
    handleFillSelectedVisualsWithRecommendations,
    handlePrepareSelectedReleaseItems,
    handlePrepareReleaseAttachment,
    handleDraftReleaseAttachment,
    handleFillReleaseAttachmentVisuals,
    handlePrepareRelease,
    handleMarkReleaseAirReady,
    handlePublishRelease,
    handleApplyReleaseDraftPack
  };
}
