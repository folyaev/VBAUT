import path from "node:path";
import fs from "node:fs/promises";

export function registerGenerationRoutes(app, deps) {
  const {
    applySegmentLinkHintsToSegments,
    appendEvent,
    appendLinkDecisionsOverride,
    buildSegmentLinkHintsFromRawText,
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
    normalizeSegmentLinkHintsInput,
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

  app.post("/api/documents/:id/segments:generate", async (req, res) => {
    try {
      const docId = req.params.id;
      const dir = getDocDir(docId);
      const document = await readOptionalJson(path.join(dir, "document.json"));
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
          document_version: documentVersion,
          segmentsVersion,
          decisionsVersion,
          media_topic_folders_ensured: ensuredMediaTopics.length,
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
        segments: segmentsData,
        decisions: decisionsData,
        media_topic_folders_ensured: ensuredMediaTopics.length,
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
      const document = await readOptionalJson(path.join(dir, "document.json"));
      if (!document) return res.status(404).json({ error: "Document not found" });

      const currentSegments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
      const currentDecisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
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
