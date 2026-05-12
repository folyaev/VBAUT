import path from "node:path";
import { nanoid } from "nanoid";
import { createDocumentRouteLoaders } from "../services/document-route-loaders.js";

export function registerDocumentRoutes(app, deps) {
  const {
    appendEvent,
    emptySearchDecision,
    ensureDataDir,
    ensureDocDir,
    getDocDir,
    getDocumentLastSegmentedHash,
    inferNeedsSegmentationFromFileState,
    isNotionUrl,
    listDocuments,
    applyVisualDecisionFieldOrigins,
    normalizeDecisionsInput,
    normalizeDocumentForResponse,
    normalizeNotionUrl,
  normalizeSearchDecisionInput,
    normalizeSegmentsInput,
    normalizeVisualDecisionInput,
    getDocumentState,
    listDocDecisions,
    listDocSegments,
    listResearchRuns,
    syncDocumentState,
    syncDocumentContext,
    readDocumentState,
  readEvents,
  readOptionalJson,
    saveVersioned,
    shouldInferNeedsSegmentation,
    syncDocumentSegmentationState,
    writeJson
  } = deps;
  const { loadDocumentState: loadDocumentRouteState, loadDocumentContext: loadDocumentRouteContext } =
    createDocumentRouteLoaders({
      getDocDir,
      readOptionalJson,
      getDocumentState,
      listDocSegments,
      listDocDecisions
    });

  function canonicalizeMergeLinkUrl(rawUrl) {
    const normalized = String(rawUrl ?? "").trim();
    if (!normalized) return "";
    try {
      const url = new URL(normalized);
      if (url.protocol === "http:" && url.port === "80") url.port = "";
      if (url.protocol === "https:" && url.port === "443") url.port = "";
      return url.toString();
    } catch {
      return normalized;
    }
  }

  function dedupeLinkDuplicatesAcrossSections(segments = []) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    const seen = new Set();
    return segments.map((segment) => {
      if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") return segment;
      const links = Array.isArray(segment?.links) ? segment.links : [];
      const dedupedLinks = [];
      links.forEach((link) => {
        const url = String(link?.url ?? "").trim();
        const canonical = canonicalizeMergeLinkUrl(url);
        if (!canonical || seen.has(canonical)) return;
        seen.add(canonical);
        dedupedLinks.push({
          url,
          raw: link?.raw == null ? null : String(link.raw)
        });
      });
      return {
        ...segment,
        links: dedupedLinks
      };
    });
  }

  function applyUserOwnedDecisionChanges(decisions = [], currentDecisions = []) {
    const updatedAt = new Date().toISOString();
    const currentMap = new Map(
      (Array.isArray(currentDecisions) ? currentDecisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
    return normalizeDecisionsInput(Array.isArray(decisions) ? decisions : []).map((decision) => ({
      ...decision,
      visual_decision:
        typeof applyVisualDecisionFieldOrigins === "function"
          ? applyVisualDecisionFieldOrigins(currentMap.get(String(decision?.segment_id ?? "").trim())?.visual_decision, decision.visual_decision, {
              description_origin: "user",
              media_origin: "user",
              updated_at: updatedAt
            })
          : normalizeVisualDecisionInput(decision.visual_decision)
    }));
  }

app.get("/api/documents", async (_req, res) => {
  try {
    const docs = await listDocuments();
    res.json({ documents: docs.map((doc) => normalizeDocumentForResponse(doc)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents", async (req, res) => {
  try {
    const rawText = String(req.body?.raw_text ?? "").trim();
    if (!rawText) {
      return res.status(400).json({ error: "raw_text is required" });
    }
    const notionRaw = req.body?.notion_url;
    const notionInput = typeof notionRaw === "string" ? notionRaw.trim() : "";
    const notionUrl = notionInput ? normalizeNotionUrl(notionInput) : "";
    if (notionUrl && !isNotionUrl(notionUrl)) {
      return res.status(400).json({ error: "notion_url must be a Notion link" });
    }

    await ensureDataDir();
    const nowIso = new Date().toISOString();

    if (notionUrl) {
      const docs = await listDocuments();
      const existing = docs.find((item) => normalizeNotionUrl(item?.notion_url ?? "") === notionUrl);
      if (existing?.id) {
        const docId = existing.id;
        const dir = await ensureDocDir(docId);
        const current = (await loadDocumentRouteState(docId)) ?? {};
        const prevRawText = String(current.raw_text ?? "");
        const document = {
          ...current,
          id: docId,
          raw_text: rawText,
          notion_url: notionUrl,
          created_at: current.created_at ?? existing.created_at ?? nowIso,
          last_segmented_text_hash: getDocumentLastSegmentedHash(current) || null
        };
        syncDocumentSegmentationState(document, rawText);
        const rawTextChanged = prevRawText !== rawText;
        let documentVersion = null;
        if (rawTextChanged) {
          documentVersion = await saveVersioned(docId, "document", document);
        } else {
          await writeJson(path.join(dir, "document.json"), document);
        }
        await syncDocumentState?.(docId, document, rawTextChanged ? "document_versioned" : "document_upserted");
        await appendEvent(docId, {
          timestamp: nowIso,
          event: "document_upserted",
          payload: { doc_id: docId, mode: "reuse_by_notion", document_version: documentVersion }
        });
        return res.json({
          id: docId,
          document: normalizeDocumentForResponse(document),
          reused: true,
          document_version: documentVersion
        });
      }
    }

    const docId = `doc_${new Date().toISOString().replace(/[:.]/g, "-")}_${nanoid(6)}`;
    const dir = await ensureDocDir(docId);
    const createdAt = nowIso;

    const document = {
      id: docId,
      raw_text: rawText,
      created_at: createdAt,
      notion_url: notionUrl || null,
      needs_segmentation: true,
      last_segmented_text_hash: null
    };

    const documentVersion = await saveVersioned(docId, "document", document);
    await syncDocumentState?.(docId, document, "document_created");
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "document_created",
      payload: { doc_id: docId, document_version: documentVersion }
    });

    res.json({ id: docId, document: normalizeDocumentForResponse(document), document_version: documentVersion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await loadDocumentRouteState(docId);
    if (!document) return res.status(404).json({ error: "Document not found" });
    const { segments, decisions } = await loadDocumentRouteContext(docId);
    const researchRuns = typeof listResearchRuns === "function" ? await listResearchRuns(docId) : [];
    const normalizedDocument = normalizeDocumentForResponse(document);
    if (shouldInferNeedsSegmentation(document)) {
      normalizedDocument.needs_segmentation = await inferNeedsSegmentationFromFileState(
        dir,
        normalizedDocument.raw_text,
        segments,
        normalizedDocument
      );
    }
    const state = await readDocumentState(dir, normalizedDocument);

    res.json({
      document: normalizedDocument,
      segments: segments ?? [],
      decisions: decisions ?? [],
      research_runs: Array.isArray(researchRuns) ? researchRuns : [],
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/state", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await loadDocumentRouteState(docId);
    if (!document) return res.status(404).json({ error: "Document not found" });

    const state = await readDocumentState(dir, document);
    res.json({
      doc_id: docId,
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await loadDocumentRouteState(docId);
    if (!document) return res.status(404).json({ error: "Document not found" });

    const rawTextInput = req.body?.raw_text;
    const notionInput = req.body?.notion_url;
    const hasRawText = typeof rawTextInput === "string";
    const hasNotion = notionInput !== undefined;
    if (!hasRawText && !hasNotion) {
      return res.status(400).json({ error: "raw_text or notion_url is required" });
    }

    const previousRawText = String(document.raw_text ?? "");
    let rawTextChanged = false;
    if (hasRawText) {
      const nextRawText = String(rawTextInput);
      rawTextChanged = nextRawText !== previousRawText;
      document.raw_text = nextRawText;
      syncDocumentSegmentationState(document, nextRawText);
    }

    if (hasNotion) {
      const notionValue = String(notionInput ?? "").trim();
      if (notionValue) {
        const normalized = normalizeNotionUrl(notionValue);
        if (!isNotionUrl(normalized)) {
          return res.status(400).json({ error: "notion_url must be a Notion link" });
        }
        document.notion_url = normalized;
      } else {
        document.notion_url = null;
      }
    }

    document.updated_at = new Date().toISOString();
    let documentVersion = null;
    if (rawTextChanged) {
      documentVersion = await saveVersioned(docId, "document", document);
    } else {
      await writeJson(path.join(dir, "document.json"), document);
    }
    await syncDocumentState?.(docId, document, rawTextChanged ? "document_versioned" : "document_updated");
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "document_updated",
      payload: { doc_id: docId, document_version: documentVersion }
    });

    res.json({ document: normalizeDocumentForResponse(document), document_version: documentVersion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/session", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await loadDocumentRouteState(docId);
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!segments) return res.status(400).json({ error: "segments must be an array" });
    if (!decisions) return res.status(400).json({ error: "decisions must be an array" });

    const { decisions: currentDecisions } = await loadDocumentRouteContext(docId);
    const normalizedSegments = dedupeLinkDuplicatesAcrossSections(normalizeSegmentsInput(segments));
    const normalizedDecisions = applyUserOwnedDecisionChanges(decisions, currentDecisions);

    const previousRawText = String(document.raw_text ?? "");
    let rawTextChanged = false;
    if (typeof req.body?.raw_text === "string") {
      const nextRawText = String(req.body.raw_text);
      rawTextChanged = nextRawText !== previousRawText;
      document.raw_text = nextRawText;
      syncDocumentSegmentationState(document, nextRawText);
    }

    if (req.body?.notion_url !== undefined) {
      const notionValue = String(req.body?.notion_url ?? "").trim();
      if (notionValue) {
        const normalizedNotion = normalizeNotionUrl(notionValue);
        if (!isNotionUrl(normalizedNotion)) {
          return res.status(400).json({ error: "notion_url must be a Notion link" });
        }
        document.notion_url = normalizedNotion;
      } else {
        document.notion_url = null;
      }
    }

    document.updated_at = new Date().toISOString();
    let documentVersion = null;
    if (rawTextChanged) {
      documentVersion = await saveVersioned(docId, "document", document);
    } else {
      await writeJson(path.join(dir, "document.json"), document);
    }
    await syncDocumentState?.(docId, document, rawTextChanged ? "document_versioned" : "session_saved");

    const segmentsVersion = await saveVersioned(docId, "segments", normalizedSegments);
    const decisionsVersion = await saveVersioned(docId, "decisions", normalizedDecisions);
    await syncDocumentContext?.(docId, normalizedSegments, normalizedDecisions, "session_saved");

    const source = typeof req.body?.source === "string" ? req.body.source.slice(0, 64) : "manual";
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "session_saved",
      payload: {
        source,
        document_version: documentVersion,
        segments_version: segmentsVersion,
        decisions_version: decisionsVersion
      }
    });

    const state = await readDocumentState(dir, document);
    res.json({
      document: normalizeDocumentForResponse(document),
      segments: normalizedSegments,
      decisions: normalizedDecisions,
      document_version: documentVersion,
      segments_version: segmentsVersion,
      decisions_version: decisionsVersion,
      revision: state.revision,
      updated_at: state.updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.put("/api/documents/:id/segments", async (req, res) => {
  try {
    const docId = req.params.id;
    const segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    if (!segments) return res.status(400).json({ error: "segments must be an array" });

    const normalized = dedupeLinkDuplicatesAcrossSections(normalizeSegmentsInput(segments));
    const version = await saveVersioned(docId, "segments", normalized);
    const { decisions: currentDecisions } = await loadDocumentRouteContext(docId);
    await syncDocumentContext?.(docId, normalized, Array.isArray(currentDecisions) ? currentDecisions : [], "segments_updated");

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segments_updated",
      payload: { version }
    });

    res.json({ segments: normalized, version });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/decisions", async (req, res) => {
  try {
    const docId = req.params.id;
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!decisions) return res.status(400).json({ error: "decisions must be an array" });

    const { decisions: currentDecisions } = await loadDocumentRouteContext(docId);
    const normalized = applyUserOwnedDecisionChanges(decisions, currentDecisions);
    const version = await saveVersioned(docId, "decisions", normalized);
    const { segments: currentSegments } = await loadDocumentRouteContext(docId);
    await syncDocumentContext?.(docId, Array.isArray(currentSegments) ? currentSegments : [], normalized, "decisions_updated");

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "decisions_updated",
      payload: { version }
    });

    res.json({ decisions: normalized, version });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/events", async (req, res) => {
  try {
    const docId = req.params.id;
    const events = await readEvents(docId);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/dataset", async (req, res) => {
  try {
    const docId = req.params.id;
    const document = await loadDocumentRouteState(docId);
    if (!document) return res.status(404).json({ error: "Document not found" });
    const { segments, decisions } = await loadDocumentRouteContext(docId);

    const decisionMap = new Map(
      decisions.map((item) => [
        item.segment_id,
        {
          visual: normalizeVisualDecisionInput(item.visual_decision),
          search: normalizeSearchDecisionInput(item.search_decision),
          searchEn: normalizeSearchDecisionInput(item.search_decision_en)
        }
      ])
    );

    const dataset = segments.map((segment) => {
      const decision = decisionMap.get(segment.segment_id) ?? { visual: null, search: emptySearchDecision() };
      return {
        input_text: document.raw_text,
        segment: segment.text_quote,
        visual_decision: decision.visual,
        search_decision: decision.search,
        search_decision_en: decision.searchEn,
        keywords: decision.search?.keywords ?? [],
        queries: decision.search?.queries ?? [],
        keywords_en: decision.searchEn?.keywords ?? [],
        queries_en: decision.searchEn?.queries ?? []
      };
    });

    res.json({ dataset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

}
