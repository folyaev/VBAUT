import path from "node:path";
import fs from "node:fs/promises";
import { createDocumentRouteLoaders } from "../services/document-route-loaders.js";

export function registerGenerationRoutes(app, deps) {
  const {
    applySegmentLinkHintsToSegments,
    appendEvent,
    appendLinkDecisionsOverride,
    buildSegmentLinkHintsFromRawText,
    collapseDuplicateLinkOnlyTopics,
    buildDocumentIntegritySnapshot,
    ensureMediaTopicFoldersForSegments,
    generateEnglishSearchDecisionsForSegments,
    generateSearchDecisionsForSegments,
    generateSegmentsOnly,
    generateVisualDecisionsForSegments,
    getDocumentState,
    getDocDir,
    listDocDecisions,
    listDocSegments,
    markDocumentSegmented,
    mergeLinkSegmentsBySection,
    mergeSegmentsWithHistory,
    normalizeDocumentForResponse,
    normalizeLinkSegmentsInput,
    normalizeSegmentLinkHintsInput,
    mergeVisualDecisionWithOrigin,
    normalizeSearchDecisionInput,
    normalizeSegmentForDecision,
    normalizeSegmentWithVisual,
    normalizeVisualDecisionInput,
    readOptionalJson,
    recoverDocumentSegmentState,
    saveVersioned,
    splitSegmentsAndDecisions,
    applyDocumentIntegritySnapshot,
    syncDocumentState,
    syncDocumentContext,
    syncDocumentSegmentationState,
    writeJson
  } = deps;
  const { loadDocumentState: loadGenerationDocumentState, loadDocumentContext: loadGenerationDocumentContext } =
    createDocumentRouteLoaders({
      getDocDir,
      readOptionalJson,
      getDocumentState,
      listDocSegments,
      listDocDecisions
    });

  async function listVersions(dir, baseName) {
    const entries = await fs.readdir(dir).catch(() => []);
    const prefix = `${baseName}.v`;
    return entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => {
        const match = name.match(/\.v(\d+)\.json$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
  }

  async function resolveSourceVersion(dir, baseName, requested) {
    const versions = await listVersions(dir, baseName);
    if (versions.length === 0) return null;
    if (Number.isFinite(requested) && requested > 0) {
      return versions.includes(requested) ? requested : null;
    }
    if (versions.length >= 2) {
      return versions[versions.length - 2];
    }
    return versions[versions.length - 1];
  }

  function pickRecoveryTargetStats(result) {
    if (!result || typeof result !== "object") return null;
    if (String(result?.strategy ?? "").trim().toLowerCase() === "layered") {
      return result?.layered?.stats ?? null;
    }
    return result?.selected?.stats ?? null;
  }

  function listsDiffer(left, right) {
    const a = Array.isArray(left) ? left.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
    const b = Array.isArray(right) ? right.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
    if (a.length !== b.length) return true;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return true;
    }
    return false;
  }

  function shouldApplyRecovery(result) {
    const current = result?.current ?? null;
    const target = pickRecoveryTargetStats(result);
    if (!current || !target) return false;
    const currentDone = Number(current?.done_non_links ?? 0);
    const targetDone = Number(target?.done_non_links ?? 0);
    const currentMedia = Number(current?.visual_media_segments ?? 0);
    const targetMedia = Number(target?.visual_media_segments ?? 0);
    const currentDescriptions = Number(current?.visual_descriptions ?? 0);
    const targetDescriptions = Number(target?.visual_descriptions ?? 0);
    if (targetDone > currentDone || targetMedia > currentMedia || targetDescriptions > currentDescriptions) {
      return true;
    }
    if (targetDone >= currentDone && listsDiffer(current?.done_segment_ids, target?.done_segment_ids)) {
      return true;
    }
    if (targetMedia >= currentMedia && listsDiffer(current?.visual_media_segment_ids, target?.visual_media_segment_ids)) {
      return true;
    }
    if (
      targetDescriptions >= currentDescriptions &&
      listsDiffer(current?.visual_description_segment_ids, target?.visual_description_segment_ids)
    ) {
      return true;
    }
    return false;
  }

  app.post("/api/documents/:id/segments:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });

      let text = document.raw_text;
      const incomingText = typeof req.body?.raw_text === "string" ? req.body.raw_text.trim() : "";
      let documentVersion = null;
      if (incomingText) {
        text = incomingText;
        if (incomingText !== document.raw_text) {
          document.raw_text = incomingText;
          syncDocumentSegmentationState(document, incomingText);
          document.updated_at = new Date().toISOString();
          documentVersion = await saveVersioned(docId, "document", document);
          await appendEvent(docId, {
            timestamp: new Date().toISOString(),
            event: "document_updated",
            payload: { doc_id: docId, document_version: documentVersion }
          });
        }
      }

      const segments = await generateSegmentsOnly({ text });
      const { segments: existingSegments, decisions: existingDecisions } = await loadGenerationDocumentContext(docId);
      const existingLinkSegments = normalizeLinkSegmentsInput(
        existingSegments.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links")
      );
      const { mergedSegments, decisionsOverride, diff } = mergeSegmentsWithHistory(
        segments,
        existingSegments,
        existingDecisions
      );
      const incomingLinkSegments = normalizeLinkSegmentsInput(req.body?.link_segments);
      const integritySnapshot =
        typeof buildDocumentIntegritySnapshot === "function"
          ? buildDocumentIntegritySnapshot(existingSegments, existingDecisions)
          : null;
      const mergedLinkSegments = mergeLinkSegmentsBySection(existingLinkSegments, incomingLinkSegments);
      const explicitSegmentHints = normalizeSegmentLinkHintsInput(req.body?.segment_link_hints);
      const collapsedLinkTopicsResult = collapseDuplicateLinkOnlyTopics(
        mergedLinkSegments.length > 0 ? [...mergedSegments, ...mergedLinkSegments] : mergedSegments
      );
      const mergedWithLinks = collapsedLinkTopicsResult.segments;
      const mergedLinkTopicsCollapsed = collapsedLinkTopicsResult.collapsedLinkTopics;
      const finalLinkSegments = mergedWithLinks.filter(
        (segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links"
      );
      const fallbackSegmentHints =
        explicitSegmentHints.length > 0 ? [] : buildSegmentLinkHintsFromRawText(text, finalLinkSegments);
      const segmentHints = explicitSegmentHints.length > 0 ? explicitSegmentHints : fallbackSegmentHints;
      const { segments: mergedWithSegmentLinks, appliedCount: segmentLinksApplied } = applySegmentLinkHintsToSegments(
        mergedWithLinks,
        segmentHints
      );
      const finalLinkSegmentsWithHints = mergedWithSegmentLinks.filter(
        (segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links"
      );
      const decisionsOverrideWithLinks = Array.isArray(decisionsOverride)
        ? appendLinkDecisionsOverride(decisionsOverride, finalLinkSegmentsWithHints)
        : null;
      const { segmentsData, decisionsData } = splitSegmentsAndDecisions(
        mergedWithSegmentLinks,
        decisionsOverrideWithLinks
      );
      const integrityApplied =
        typeof applyDocumentIntegritySnapshot === "function"
          ? applyDocumentIntegritySnapshot({
              snapshot: integritySnapshot,
              segments: segmentsData,
              decisions: decisionsData
            })
          : { segments: segmentsData, decisions: decisionsData, report: null };
      const finalSegmentsData = Array.isArray(integrityApplied?.segments) ? integrityApplied.segments : segmentsData;
      const finalDecisionsData = Array.isArray(integrityApplied?.decisions) ? integrityApplied.decisions : decisionsData;
      const integrityReport = integrityApplied?.report ?? null;
      const shouldEnsureMediaFolders = req.body?.ensure_media_folders === true;
      const ensuredMediaTopics = shouldEnsureMediaFolders && typeof ensureMediaTopicFoldersForSegments === "function"
        ? await ensureMediaTopicFoldersForSegments(finalSegmentsData)
        : [];

      let segmentsVersion = await saveVersioned(docId, "segments", finalSegmentsData);
      let decisionsVersion = await saveVersioned(docId, "decisions", finalDecisionsData);
      let responseSegments = finalSegmentsData;
      let responseDecisions = finalDecisionsData;
      let stateRecovery = null;
      await syncDocumentContext?.(docId, finalSegmentsData, finalDecisionsData, "segments_generate");

      if (typeof recoverDocumentSegmentState === "function") {
        const recoveryPreview = await recoverDocumentSegmentState({
          docId,
          apply: false,
          scanLimit: 40
        }).catch(() => null);
        if (recoveryPreview && shouldApplyRecovery(recoveryPreview)) {
          const recoveryApplied = await recoverDocumentSegmentState({
            docId,
            apply: true,
            scanLimit: 40
          }).catch(() => null);
          if (recoveryApplied?.written) {
            stateRecovery = {
              strategy: recoveryApplied?.strategy ?? null,
              current: recoveryApplied?.current ?? null,
              target: pickRecoveryTargetStats(recoveryApplied),
              selected: recoveryApplied?.selected ?? null,
              layered: recoveryApplied?.layered ?? null,
              written: recoveryApplied?.written ?? null
            };
            segmentsVersion = Number(recoveryApplied?.written?.segments_version ?? segmentsVersion);
            decisionsVersion = Number(recoveryApplied?.written?.decisions_version ?? decisionsVersion);
            const [recoveredSegments, recoveredDecisions] = await Promise.all([
              readOptionalJson(path.join(dir, "segments.json")),
              readOptionalJson(path.join(dir, "decisions.json"))
            ]);
            if (Array.isArray(recoveredSegments) && Array.isArray(recoveredDecisions)) {
              responseSegments = recoveredSegments;
              responseDecisions = recoveredDecisions;
              await syncDocumentContext?.(docId, recoveredSegments, recoveredDecisions, "segments_generate_auto_recover");
            }
            await appendEvent(docId, {
              timestamp: new Date().toISOString(),
              event: "segments_generate_auto_recovered",
              payload: stateRecovery
            });
          }
        }
      }

      markDocumentSegmented(document, text);
      document.updated_at = new Date().toISOString();
      await writeJson(path.join(dir, "document.json"), document);
      await syncDocumentState?.(docId, document, "segments_generate");

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "segments_generated",
          payload: {
            document_version: documentVersion,
            segmentsVersion,
            decisionsVersion,
            media_topic_folders_requested: shouldEnsureMediaFolders,
            media_topic_folders_ensured: ensuredMediaTopics.length,
            integrity_report: integrityReport,
            state_recovery: stateRecovery,
            segmentation_diff: {
              ...(diff ?? {}),
            link_topics_collapsed: mergedLinkTopicsCollapsed,
            segment_link_hints: segmentHints.length,
            segment_links_applied: segmentLinksApplied
          }
        }
      });

      res.json({
        document: normalizeDocumentForResponse(document),
        segments: responseSegments,
        decisions: responseDecisions,
        media_topic_folders_ensured: ensuredMediaTopics.length,
        media_topic_folders_requested: shouldEnsureMediaFolders,
        integrity_report: integrityReport,
        state_recovery: stateRecovery,
        segmentation_diff: {
          ...(diff ?? {}),
          link_topics_collapsed: mergedLinkTopicsCollapsed,
          segment_link_hints: segmentHints.length,
          segment_links_applied: segmentLinksApplied
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/decisions-realign", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });

      const { segments: currentSegments, decisions: currentDecisions } = await loadGenerationDocumentContext(docId);
      if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
        return res.status(400).json({ error: "Current segments not found" });
      }

      const requestedSegmentsVersionRaw = Number(req.body?.source_segments_version);
      const requestedDecisionsVersionRaw = Number(req.body?.source_decisions_version);
      const requestedSegmentsVersion = Number.isFinite(requestedSegmentsVersionRaw) ? requestedSegmentsVersionRaw : null;
      const requestedDecisionsVersion = Number.isFinite(requestedDecisionsVersionRaw) ? requestedDecisionsVersionRaw : null;

      const sourceSegmentsVersion = await resolveSourceVersion(dir, "segments", requestedSegmentsVersion);
      const sourceDecisionsVersion = await resolveSourceVersion(dir, "decisions", requestedDecisionsVersion);
      if (!sourceSegmentsVersion || !sourceDecisionsVersion) {
        return res.status(400).json({ error: "Source segments/decisions versions not found" });
      }

      const sourceSegments = (await readOptionalJson(path.join(dir, `segments.v${sourceSegmentsVersion}.json`))) ?? [];
      const sourceDecisions = (await readOptionalJson(path.join(dir, `decisions.v${sourceDecisionsVersion}.json`))) ?? [];
      if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
        return res.status(400).json({ error: "Source segments are empty" });
      }
      if (!Array.isArray(sourceDecisions) || sourceDecisions.length === 0) {
        return res.status(400).json({ error: "Source decisions are empty" });
      }

      const currentNonLinks = currentSegments.filter(
        (segment) => String(segment?.block_type ?? "").trim().toLowerCase() !== "links"
      );
      const { decisionsOverride, diff } = mergeSegmentsWithHistory(
        currentNonLinks,
        sourceSegments,
        sourceDecisions
      );

      const overrideMap = new Map(
        (Array.isArray(decisionsOverride) ? decisionsOverride : [])
          .map((item) => [String(item?.segment_id ?? "").trim(), item])
          .filter(([id]) => Boolean(id))
      );
      const currentDecisionMap = new Map(
        (Array.isArray(currentDecisions) ? currentDecisions : [])
          .map((item) => [String(item?.segment_id ?? "").trim(), item])
          .filter(([id]) => Boolean(id))
      );

      const nextDecisions = currentSegments.map((segment) => {
        const segmentId = String(segment?.segment_id ?? "").trim();
        const isLinks = String(segment?.block_type ?? "").trim().toLowerCase() === "links";
        if (isLinks) {
          const existing = currentDecisionMap.get(segmentId);
          return {
            segment_id: segmentId,
            visual_decision: normalizeVisualDecisionInput(existing?.visual_decision),
            search_decision: normalizeSearchDecisionInput(existing?.search_decision),
            search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
            version: 1
          };
        }
        const mapped = overrideMap.get(segmentId);
        return {
          segment_id: segmentId,
          visual_decision: normalizeVisualDecisionInput(mapped?.visual_decision),
          search_decision: normalizeSearchDecisionInput(mapped?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(mapped?.search_decision_en),
          version: 1
        };
      });

      const version = await saveVersioned(docId, "decisions", nextDecisions);
      await syncDocumentContext?.(docId, currentSegments, nextDecisions, "decisions_realign");
      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "decisions_realigned",
        payload: {
          version,
          source_segments_version: sourceSegmentsVersion,
          source_decisions_version: sourceDecisionsVersion,
          realign_diff: diff ?? null
        }
      });

      res.json({
        decisions: nextDecisions,
        version,
        source_segments_version: sourceSegmentsVersion,
        source_decisions_version: sourceDecisionsVersion,
        realign_diff: diff ?? null
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/decisions:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });

      const segments = (
        (
          (await loadGenerationDocumentContext(docId)).segments
        )
      ).filter(
        (segment) => segment?.block_type !== "links"
      );
      if (!segments.length) return res.status(400).json({ error: "Segments not found" });

      const inputSegments = Array.isArray(req.body?.segments)
        ? req.body.segments
        : req.body?.segment
          ? [req.body.segment]
          : null;
      const inputIds = Array.isArray(req.body?.segment_ids)
        ? req.body.segment_ids.map((id) => String(id))
        : req.body?.segment_id
          ? [String(req.body.segment_id)]
          : [];

      let targetSegments = [];
      if (inputSegments?.length) {
        targetSegments = inputSegments.map(normalizeSegmentForDecision).filter((segment) => segment.segment_id);
      } else if (inputIds.length) {
        targetSegments = segments.filter((segment) => inputIds.includes(segment.segment_id));
      }
      if (!targetSegments.length) {
        return res.status(400).json({ error: "segment_id/segment_ids or segment data is required" });
      }

      const generated = await generateVisualDecisionsForSegments(targetSegments);
      const { decisions } = await loadGenerationDocumentContext(docId);
      const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

      generated.forEach((decision) => {
        const existing = decisionMap.get(decision.segment_id);
        decisionMap.set(decision.segment_id, {
          segment_id: decision.segment_id,
          visual_decision:
            typeof mergeVisualDecisionWithOrigin === "function"
              ? mergeVisualDecisionWithOrigin(existing?.visual_decision, decision.visual_decision, {
                  incoming_origin: "system",
                  preserve_user_owned: true
                })
              : normalizeVisualDecisionInput({
                  ...(existing?.visual_decision ?? {}),
                  ...(decision.visual_decision ?? {})
                }),
          search_decision: normalizeSearchDecisionInput(existing?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
          version: 1
        });
      });

      const mergedDecisions = Array.from(decisionMap.values());
      const version = await saveVersioned(docId, "decisions", mergedDecisions);
      await syncDocumentContext?.(docId, segments, mergedDecisions, "decisions_generate");

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "decisions_generated",
        payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
      });

      res.json({
        decisions: generated.map((decision) => ({
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(decisionMap.get(decision.segment_id)?.visual_decision),
          search_decision: normalizeSearchDecisionInput(decisionMap.get(decision.segment_id)?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(decisionMap.get(decision.segment_id)?.search_decision_en),
          version: 1
        })),
        version
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/segment-state:recover", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });
      if (typeof recoverDocumentSegmentState !== "function") {
        return res.status(500).json({ error: "Segment state recovery is not configured" });
      }

      const result = await recoverDocumentSegmentState({
        docId,
        sourceSegmentsVersion: req.body?.source_segments_version,
        sourceDecisionsVersion: req.body?.source_decisions_version,
        scanLimit: req.body?.scan_limit,
        apply: req.body?.apply === true
      });

      if (req.body?.apply === true && result?.written) {
        const [segmentsData, decisionsData] = await Promise.all([
          readOptionalJson(path.join(dir, "segments.json")),
          readOptionalJson(path.join(dir, "decisions.json"))
        ]);
        if (Array.isArray(segmentsData) && Array.isArray(decisionsData)) {
          await syncDocumentContext?.(docId, segmentsData, decisionsData, "segment_state_recover");
        }
        await appendEvent(docId, {
          timestamp: new Date().toISOString(),
          event: "segment_state_recovered",
          payload: {
            strategy: result?.strategy ?? null,
            current: result?.current ?? null,
            selected: result?.selected ?? null,
            layered: result?.layered ?? null,
            written: result?.written ?? null
          }
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/search:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });

      const { segments } = await loadGenerationDocumentContext(docId);
      if (!segments.length) return res.status(400).json({ error: "Segments not found" });

      const inputSegments = Array.isArray(req.body?.segments)
        ? req.body.segments
        : req.body?.segment
          ? [req.body.segment]
          : null;
      const inputIds = Array.isArray(req.body?.segment_ids)
        ? req.body.segment_ids.map((id) => String(id))
        : req.body?.segment_id
          ? [String(req.body.segment_id)]
          : [];

      let targetSegments = [];
      if (inputSegments?.length) {
        targetSegments = inputSegments.map(normalizeSegmentWithVisual).filter((segment) => segment.segment_id);
      } else if (inputIds.length) {
        const { decisions: decisionList } = await loadGenerationDocumentContext(docId);
        const decisionMap = new Map(decisionList.map((item) => [item.segment_id, item]));
        targetSegments = segments
          .filter((segment) => inputIds.includes(segment.segment_id))
          .map((segment) => ({
            ...normalizeSegmentForDecision(segment),
            visual_decision: normalizeVisualDecisionInput(decisionMap.get(segment.segment_id)?.visual_decision)
          }));
      }

      if (!targetSegments.length) {
        return res.status(400).json({ error: "segment/segments or segment_id/segment_ids is required" });
      }

      const generated = await generateSearchDecisionsForSegments(targetSegments);
      const { decisions } = await loadGenerationDocumentContext(docId);
      const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

      generated.forEach((decision) => {
        const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
        const existing = decisionMap.get(decision.segment_id);
        decisionMap.set(decision.segment_id, {
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(source?.visual_decision),
          search_decision: normalizeSearchDecisionInput(decision.search_decision),
          search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
          version: 1
        });
      });

      const mergedDecisions = Array.from(decisionMap.values());
      const version = await saveVersioned(docId, "decisions", mergedDecisions);
      await syncDocumentContext?.(docId, segments, mergedDecisions, "search_generate");

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "search_generated",
        payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
      });

      res.json({
        decisions: generated.map((decision) => {
          const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
          const existing = decisionMap.get(decision.segment_id);
          return {
            segment_id: decision.segment_id,
            visual_decision: normalizeVisualDecisionInput(source?.visual_decision),
            search_decision: normalizeSearchDecisionInput(decision.search_decision),
            search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
            version: 1
          };
        }),
        version
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/search-en:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const document = await loadGenerationDocumentState(docId);
      if (!document) return res.status(404).json({ error: "Document not found" });

      const { segments } = await loadGenerationDocumentContext(docId);
      if (!segments.length) return res.status(400).json({ error: "Segments not found" });

      const inputSegments = Array.isArray(req.body?.segments)
        ? req.body.segments
        : req.body?.segment
          ? [req.body.segment]
          : null;
      const inputIds = Array.isArray(req.body?.segment_ids)
        ? req.body.segment_ids.map((id) => String(id))
        : req.body?.segment_id
          ? [String(req.body.segment_id)]
          : [];

      let targetSegments = [];
      if (inputSegments?.length) {
        targetSegments = inputSegments.map(normalizeSegmentWithVisual).filter((segment) => segment.segment_id);
      } else if (inputIds.length) {
        const { decisions: decisionList } = await loadGenerationDocumentContext(docId);
        const decisionMap = new Map(decisionList.map((item) => [item.segment_id, item]));
        targetSegments = segments
          .filter((segment) => inputIds.includes(segment.segment_id))
          .map((segment) => ({
            ...normalizeSegmentForDecision(segment),
            visual_decision: normalizeVisualDecisionInput(decisionMap.get(segment.segment_id)?.visual_decision)
          }));
      }

      if (!targetSegments.length) {
        return res.status(400).json({ error: "segment/segments or segment_id/segment_ids is required" });
      }

      const generated = await generateEnglishSearchDecisionsForSegments(targetSegments);
      const { decisions } = await loadGenerationDocumentContext(docId);
      const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

      generated.forEach((decision) => {
        const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
        const existing = decisionMap.get(decision.segment_id);
        decisionMap.set(decision.segment_id, {
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(source?.visual_decision ?? existing?.visual_decision),
          search_decision: normalizeSearchDecisionInput(existing?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(decision.search_decision),
          version: 1
        });
      });

      const mergedDecisions = Array.from(decisionMap.values());
      const version = await saveVersioned(docId, "decisions", mergedDecisions);
      await syncDocumentContext?.(docId, segments, mergedDecisions, "search_en_generate");

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "search_en_generated",
        payload: { version, segment_ids: targetSegments.map((segment) => segment.segment_id) }
      });

      res.json({
        decisions: generated.map((decision) => {
          const source = targetSegments.find((segment) => segment.segment_id === decision.segment_id);
          const existing = decisionMap.get(decision.segment_id);
          return {
            segment_id: decision.segment_id,
            visual_decision: normalizeVisualDecisionInput(source?.visual_decision ?? existing?.visual_decision),
            search_decision: normalizeSearchDecisionInput(existing?.search_decision),
            search_decision_en: normalizeSearchDecisionInput(decision.search_decision),
            version: 1
          };
        }),
        version
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
