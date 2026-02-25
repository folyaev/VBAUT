import path from "node:path";

export function registerGenerationRoutes(app, deps) {
  const {
    appendEvent,
    appendLinkDecisionsOverride,
    collapseDuplicateLinkOnlyTopics,
    ensureMediaTopicFoldersForSegments,
    generateEnglishSearchDecisionsForSegments,
    generateSearchDecisionsForSegments,
    generateSegmentsOnly,
    generateVisualDecisionsForSegments,
    getDocDir,
    markDocumentSegmented,
    mergeLinkSegmentsBySection,
    mergeSegmentsWithHistory,
    normalizeDocumentForResponse,
    normalizeLinkSegmentsInput,
    normalizeSearchDecisionInput,
    normalizeSegmentForDecision,
    normalizeSegmentWithVisual,
    normalizeVisualDecisionInput,
    readOptionalJson,
    saveVersioned,
    splitSegmentsAndDecisions,
    syncDocumentSegmentationState,
    writeJson
  } = deps;

  app.post("/api/documents/:id/segments:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) return res.status(404).json({ error: "Document not found" });

      let text = document.raw_text;
      const incomingText = typeof req.body?.raw_text === "string" ? req.body.raw_text.trim() : "";
      if (incomingText) {
        text = incomingText;
        if (incomingText !== document.raw_text) {
          document.raw_text = incomingText;
          syncDocumentSegmentationState(document, incomingText);
          document.updated_at = new Date().toISOString();
          await writeJson(path.join(dir, "document.json"), document);
          await appendEvent(docId, {
            timestamp: new Date().toISOString(),
            event: "document_updated",
            payload: { doc_id: docId }
          });
        }
      }

      const segments = await generateSegmentsOnly({ text });
      const existingSegments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
      const existingDecisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
      const existingLinkSegments = normalizeLinkSegmentsInput(
        existingSegments.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links")
      );
      const { mergedSegments, decisionsOverride, diff } = mergeSegmentsWithHistory(
        segments,
        existingSegments,
        existingDecisions
      );
      const incomingLinkSegments = normalizeLinkSegmentsInput(req.body?.link_segments);
      const mergedLinkSegments = mergeLinkSegmentsBySection(existingLinkSegments, incomingLinkSegments);
      const collapsedLinkTopicsResult = collapseDuplicateLinkOnlyTopics(
        mergedLinkSegments.length > 0 ? [...mergedSegments, ...mergedLinkSegments] : mergedSegments
      );
      const mergedWithLinks = collapsedLinkTopicsResult.segments;
      const mergedLinkTopicsCollapsed = collapsedLinkTopicsResult.collapsedLinkTopics;
      const finalLinkSegments = mergedWithLinks.filter(
        (segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links"
      );
      const decisionsOverrideWithLinks = Array.isArray(decisionsOverride)
        ? appendLinkDecisionsOverride(decisionsOverride, finalLinkSegments)
        : null;
      const { segmentsData, decisionsData } = splitSegmentsAndDecisions(
        mergedWithLinks,
        decisionsOverrideWithLinks
      );
      const ensuredMediaTopics = await ensureMediaTopicFoldersForSegments(segmentsData);

      const segmentsVersion = await saveVersioned(docId, "segments", segmentsData);
      const decisionsVersion = await saveVersioned(docId, "decisions", decisionsData);
      markDocumentSegmented(document, text);
      document.updated_at = new Date().toISOString();
      await writeJson(path.join(dir, "document.json"), document);

      await appendEvent(docId, {
        timestamp: new Date().toISOString(),
        event: "segments_generated",
        payload: {
          segmentsVersion,
          decisionsVersion,
          media_topic_folders_ensured: ensuredMediaTopics.length,
          segmentation_diff: {
            ...(diff ?? {}),
            link_topics_collapsed: mergedLinkTopicsCollapsed
          }
        }
      });

      res.json({
        document: normalizeDocumentForResponse(document),
        segments: segmentsData,
        decisions: decisionsData,
        media_topic_folders_ensured: ensuredMediaTopics.length,
        segmentation_diff: {
          ...(diff ?? {}),
          link_topics_collapsed: mergedLinkTopicsCollapsed
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/:id/decisions:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) return res.status(404).json({ error: "Document not found" });

      const segments = ((await readOptionalJson(path.join(dir, "segments.json"))) ?? []).filter(
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
      const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
      const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

      generated.forEach((decision) => {
        const existing = decisionMap.get(decision.segment_id);
        const mergedVisual = {
          ...(existing?.visual_decision ?? {}),
          ...(decision.visual_decision ?? {})
        };
        decisionMap.set(decision.segment_id, {
          segment_id: decision.segment_id,
          visual_decision: normalizeVisualDecisionInput(mergedVisual),
          search_decision: normalizeSearchDecisionInput(existing?.search_decision),
          search_decision_en: normalizeSearchDecisionInput(existing?.search_decision_en),
          version: 1
        });
      });

      const mergedDecisions = Array.from(decisionMap.values());
      const version = await saveVersioned(docId, "decisions", mergedDecisions);

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

  app.post("/api/documents/:id/search:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) return res.status(404).json({ error: "Document not found" });

      const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
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
        const decisionList = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
      const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) return res.status(404).json({ error: "Document not found" });

      const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
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
        const decisionList = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
      const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
