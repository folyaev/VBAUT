import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import path from "node:path";
import {
  appendEvent,
  ensureDataDir,
  ensureDocDir,
  getDocDir,
  listDocuments,
  readEvents,
  readOptionalJson,
  saveVersioned,
  writeJson
} from "./storage.js";
import { config, generateDecisionsForSegments, generateSegmentsOnly } from "./llm.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.get("/api/documents", async (_req, res) => {
  try {
    const docs = await listDocuments();
    res.json({ documents: docs });
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

    await ensureDataDir();
    const docId = `doc_${new Date().toISOString().replace(/[:.]/g, "-")}_${nanoid(6)}`;
    const dir = await ensureDocDir(docId);

    const document = {
      id: docId,
      raw_text: rawText,
      created_at: new Date().toISOString()
    };

    await writeJson(path.join(dir, "document.json"), document);
    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "document_created",
      payload: { doc_id: docId }
    });

    res.json({ id: docId, document });
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

    res.json({ document, segments: segments ?? [], decisions: decisions ?? [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    const { segmentsData, decisionsData } = splitSegmentsAndDecisions(
      segments,
      segments.map((segment) => ({
        segment_id: segment.segment_id,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision()
      }))
    );

    const segmentsVersion = await saveVersioned(docId, "segments", segmentsData);
    const decisionsVersion = await saveVersioned(docId, "decisions", decisionsData);

    await appendEvent(docId, {
      timestamp: new Date().toISOString(),
      event: "segments_generated",
      payload: { segmentsVersion, decisionsVersion }
    });

    res.json({ segments: segmentsData, decisions: decisionsData });
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
      targetSegments = inputSegments.map(normalizeSegmentForDecision).filter((segment) => segment.segment_id);
    } else if (inputIds.length) {
      targetSegments = segments.filter((segment) => inputIds.includes(segment.segment_id));
    }
    if (!targetSegments.length) {
      return res.status(400).json({ error: "segment_id/segment_ids or segment data is required" });
    }

    const generated = await generateDecisionsForSegments(targetSegments, document.raw_text ?? "");
    const decisions = (await readOptionalJson(path.join(dir, "decisions.json"))) ?? [];
    const decisionMap = new Map(decisions.map((item) => [item.segment_id, item]));

    generated.forEach((decision) => {
      decisionMap.set(decision.segment_id, {
        segment_id: decision.segment_id,
        visual_decision: normalizeVisualDecisionInput(decision.visual_decision),
        search_decision: normalizeSearchDecisionInput(decision.search_decision),
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
        visual_decision: normalizeVisualDecisionInput(decision.visual_decision),
        search_decision: normalizeSearchDecisionInput(decision.search_decision),
        version: 1
      })),
      version
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
          search: normalizeSearchDecisionInput(item.search_decision)
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
        keywords: decision.search?.keywords ?? [],
        queries: decision.search?.queries ?? []
      };
    });

    res.json({ dataset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/documents/:id/export", async (req, res) => {
  try {
    const docId = req.params.id;
    const format = String(req.query?.format ?? "jsonl").toLowerCase();
    if (!["jsonl", "md"].includes(format)) {
      return res.status(400).json({ error: "format must be jsonl or md" });
    }

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
          search: normalizeSearchDecisionInput(item.search_decision)
        }
      ])
    );

    if (format === "jsonl") {
      const lines = segments.map((segment) => {
        const decision = decisionMap.get(segment.segment_id) ?? {
          visual: emptyVisualDecision(),
          search: emptySearchDecision()
        };
        const payload = {
          messages: [
            {
              role: "system",
              content:
                "Ты — ассистент по визуальному брифу и поисковым запросам. По сегменту дай visual_decision и search_decision."
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  segment_id: segment.segment_id,
                  block_type: segment.block_type,
                  text_quote: segment.text_quote,
                  section_title: segment.section_title ?? null
                },
                null,
                2
              )
            },
            {
              role: "assistant",
              content: JSON.stringify(
                {
                  visual_decision: decision.visual,
                  search_decision: decision.search
                },
                null,
                2
              )
            }
          ],
          meta: {
            doc_id: document.id,
            segment_id: segment.segment_id,
            block_type: segment.block_type,
            section_id: segment.section_id ?? null,
            section_title: segment.section_title ?? null,
            section_index: segment.section_index ?? null
          }
        };
        return JSON.stringify(payload);
      });

      const body = lines.join("\n") + "\n";
      res.setHeader("content-type", "application/jsonl; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${document.id}.jsonl"`);
      return res.send(body);
    }

    const mdLines = [
      `# Экспорт документа ${document.id}`,
      "",
      "## Исходный текст",
      "",
      "```",
      String(document.raw_text ?? ""),
      "```",
      "",
      "## Сегменты",
      ""
    ];

    segments.forEach((segment) => {
      const decision = decisionMap.get(segment.segment_id) ?? {
        visual: emptyVisualDecision(),
        search: emptySearchDecision()
      };
      mdLines.push(
        `### ${segment.segment_id} (${segment.block_type})`,
        segment.section_title ? `**Раздел:** ${segment.section_title}` : "**Раздел:** —",
        "",
        `> ${segment.text_quote ?? ""}`,
        "",
        "**Визуал**",
        `- type: ${decision.visual.type ?? "no_visual"}`,
        `- description: ${decision.visual.description ?? ""}`,
        `- format_hint: ${decision.visual.format_hint ?? "—"}`,
        `- priority: ${decision.visual.priority ?? "—"}`,
        `- duration_hint_sec: ${decision.visual.duration_hint_sec ?? "—"}`,
        "",
        "**Поиск**",
        `- keywords: ${(decision.search.keywords ?? []).join(", ") || "—"}`,
        "- queries:"
      );
      if (decision.search.queries?.length) {
        decision.search.queries.forEach((query) => mdLines.push(`  - ${query}`));
      } else {
        mdLines.push("  - —");
      }
      mdLines.push("");
    });

    const mdBody = mdLines.join("\n");
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${document.id}.md"`);
    return res.send(mdBody);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

function splitSegmentsAndDecisions(segments, decisionsOverride = null) {
  const segmentsData = segments.map((segment) => ({
    segment_id: segment.segment_id,
    block_type: segment.block_type,
    text_quote: segment.text_quote,
    section_id: segment.section_id ?? null,
    section_title: segment.section_title ?? null,
    section_index: segment.section_index ?? null,
    version: 1
  }));
  const decisionsSource = Array.isArray(decisionsOverride) ? decisionsOverride : segments;
  const decisionsData = decisionsSource.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision: normalizeVisualDecisionInput(segment.visual_decision),
    search_decision: normalizeSearchDecisionInput(segment.search_decision),
    version: 1
  }));
  return { segmentsData, decisionsData };
}

function normalizeSegmentForDecision(segment) {
  return {
    segment_id: String(segment?.segment_id ?? ""),
    block_type: String(segment?.block_type ?? "news"),
    text_quote: String(segment?.text_quote ?? "")
  };
}

function normalizeSegmentsInput(segments) {
  return segments.map((segment) => ({
    segment_id: String(segment.segment_id ?? ""),
    block_type: String(segment.block_type ?? "news"),
    text_quote: String(segment.text_quote ?? ""),
    section_id: segment.section_id ? String(segment.section_id) : null,
    section_title: segment.section_title ? String(segment.section_title) : null,
    section_index: Number.isFinite(Number(segment.section_index)) ? Number(segment.section_index) : null,
    version: Number(segment.version ?? 1)
  }));
}

function normalizeDecisionsInput(decisions) {
  return decisions.map((decision) => ({
    segment_id: String(decision.segment_id ?? ""),
    visual_decision: normalizeVisualDecisionInput(decision.visual_decision ?? decision),
    search_decision: normalizeSearchDecisionInput(decision.search_decision ?? decision.visual_decision),
    version: Number(decision.version ?? 1)
  }));
}

const FALLBACK_LIMITS = { maxKeywords: 8, maxQueries: 6 };

function normalizeStringList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

function emptySearchDecision() {
  return { keywords: [], queries: [] };
}

function normalizeSearchDecisionInput(raw) {
  if (!raw || typeof raw !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? FALLBACK_LIMITS;
  const keywords = normalizeStringList(raw.keywords, limits.maxKeywords);
  const queries = normalizeStringList(raw.queries ?? raw.search_queries ?? raw.searchQueries, limits.maxQueries);
  return { keywords, queries };
}

function emptyVisualDecision() {
  return {
    type: "no_visual",
    description: "",
    format_hint: null,
    duration_hint_sec: null,
    priority: null
  };
}

function normalizeVisualDecisionInput(raw) {
  if (!raw || typeof raw !== "object") return emptyVisualDecision();
  const typeRaw = String(raw.type ?? raw.visual_type ?? "").toLowerCase().trim();
  const type = config?.visualTypes?.includes(typeRaw) ? typeRaw : "no_visual";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const formatHint = normalizeFormatHint(raw.format_hint);
  const durationRaw = raw.duration_hint_sec ?? raw.duration_hint ?? null;
  const durationHint = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  const priority = normalizePriority(raw.priority);

  return {
    type,
    description,
    format_hint: formatHint,
    duration_hint_sec: durationHint,
    priority
  };
}

function normalizeFormatHint(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "Документ", SQUARE: "1:1" };
  const upper = trimmed.toUpperCase();
  if (legacy[upper]) return legacy[upper];
  const list = config?.formatHints ?? [];
  const normalized = trimmed.toLowerCase();
  const match = list.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
}

function normalizePriority(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const legacy = { high: "обязательно", medium: "рекомендуется", low: "при наличии" };
  if (legacy[trimmed]) return legacy[trimmed];
  const list = config?.priorities ?? [];
  const match = list.find((priority) => priority.toLowerCase() === trimmed);
  return match ?? null;
}
