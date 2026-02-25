import path from "node:path";
import { nanoid } from "nanoid";

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
    normalizeDecisionsInput,
    normalizeDocumentForResponse,
    normalizeNotionUrl,
    normalizeSearchDecisionInput,
    normalizeSegmentsInput,
    normalizeVisualDecisionInput,
    readDocumentState,
    readEvents,
    readOptionalJson,
    saveVersioned,
    shouldInferNeedsSegmentation,
    syncDocumentSegmentationState,
    writeJson
  } = deps;

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
        const current = (await readOptionalJson(path.join(dir, "document.json"))) ?? {};
        const document = {
          ...current,
          id: docId,
          raw_text: rawText,
          notion_url: notionUrl,
          created_at: current.created_at ?? existing.created_at ?? nowIso,
          last_segmented_text_hash: getDocumentLastSegmentedHash(current) || null
        };
        syncDocumentSegmentationState(document, rawText);
        await writeJson(path.join(dir, "document.json"), document);
        await appendEvent(docId, {
          timestamp: nowIso,
          event: "document_upserted",
          payload: { doc_id: docId, mode: "reuse_by_notion" }
        });
        return res.json({ id: docId, document: normalizeDocumentForResponse(document), reused: true });
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

    await writeJson(path.join(dir, "document.json"), document);
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "document_created",
      payload: { doc_id: docId }
    });

    res.json({ id: docId, document: normalizeDocumentForResponse(document) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);

    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = await readOptionalJson(path.join(dir, "segments.json"));
    const decisions = await readOptionalJson(path.join(dir, "decisions.json"));
    const normalizedDocument = normalizeDocumentForResponse(document);
    if (shouldInferNeedsSegmentation(document)) {
      normalizedDocument.needs_segmentation = await inferNeedsSegmentationFromFileState(
        dir,
        normalizedDocument.raw_text,
        segments
      );
    }
    const state = await readDocumentState(dir, normalizedDocument);

    res.json({
      document: normalizedDocument,
      segments: segments ?? [],
      decisions: decisions ?? [],
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
    const document = await readOptionalJson(path.join(dir, "document.json"));
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
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const rawTextInput = req.body?.raw_text;
    const notionInput = req.body?.notion_url;
    const hasRawText = typeof rawTextInput === "string";
    const hasNotion = notionInput !== undefined;
    if (!hasRawText && !hasNotion) {
      return res.status(400).json({ error: "raw_text or notion_url is required" });
    }

    if (hasRawText) {
      const nextRawText = String(rawTextInput);
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
    await writeJson(path.join(dir, "document.json"), document);
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "document_updated",
      payload: { doc_id: docId }
    });

    res.json({ document: normalizeDocumentForResponse(document) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/documents/:id/session", async (req, res) => {
  try {
    const docId = req.params.id;
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : null;
    if (!segments) return res.status(400).json({ error: "segments must be an array" });
    if (!decisions) return res.status(400).json({ error: "decisions must be an array" });

    const normalizedSegments = normalizeSegmentsInput(segments);
    const normalizedDecisions = normalizeDecisionsInput(decisions);

    if (typeof req.body?.raw_text === "string") {
      const nextRawText = String(req.body.raw_text);
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
    await writeJson(path.join(dir, "document.json"), document);

    const segmentsVersion = await saveVersioned(docId, "segments", normalizedSegments);
    const decisionsVersion = await saveVersioned(docId, "decisions", normalizedDecisions);

    const source = typeof req.body?.source === "string" ? req.body.source.slice(0, 64) : "manual";
    await appendEvent(docId, {
      timestamp: document.updated_at,
      event: "session_saved",
      payload: {
        source,
        segments_version: segmentsVersion,
        decisions_version: decisionsVersion
      }
    });

    const state = await readDocumentState(dir, document);
    res.json({
      document: normalizeDocumentForResponse(document),
      segments: normalizedSegments,
      decisions: normalizedDecisions,
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

    const normalized = normalizeSegmentsInput(segments);
    const version = await saveVersioned(docId, "segments", normalized);

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

    const normalized = normalizeDecisionsInput(decisions);
    const version = await saveVersioned(docId, "decisions", normalized);

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
    const dir = getDocDir(docId);
    const document = await readOptionalJson(path.join(dir, "document.json"));
    if (!document) return res.status(404).json({ error: "Document not found" });

    const segments = (await readOptionalJson(path.join(dir, "segments.json"))) ?? [];
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];

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
