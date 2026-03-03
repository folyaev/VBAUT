import fs from "node:fs/promises";
import path from "node:path";

export function registerExportRoutes(app, deps) {
  const {
    XML_EXPORT_DEFAULT_DURATION_SEC,
    XML_EXPORT_FPS,
    buildContentDisposition,
    buildXmlExportPayload,
    emptySearchDecision,
    emptyVisualDecision,
    getDataDir,
    getDocDir,
    getMediaDir,
    normalizeLinksInput,
    normalizeSearchDecisionInput,
    normalizeSectionTitleForMatch,
    normalizeVisualDecisionInput,
    readOptionalJson,
    writeJson
  } = deps;
  const xmlSettingsPath = typeof getDataDir === "function"
    ? path.join(getDataDir(), "_settings", "xml-export.json")
    : null;
  const MAX_XML_MEDIA_ROOT_RECENT = 3;

  const normalizeXmlMediaRootValue = (value) => {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, 1024);
  };

  const normalizeXmlMediaRootRecent = (values, preferred) => {
    const unique = [];
    const push = (value) => {
      const normalized = normalizeXmlMediaRootValue(value);
      if (!normalized) return;
      if (unique.includes(normalized)) return;
      unique.push(normalized);
    };
    push(preferred);
    if (Array.isArray(values)) {
      values.forEach((value) => push(value));
    }
    return unique.slice(0, MAX_XML_MEDIA_ROOT_RECENT);
  };

  const readXmlMediaRootSettings = async () => {
    const envDefault = normalizeXmlMediaRootValue(String(process.env.XML_EXPORT_MEDIA_ROOT ?? ""));
    if (!xmlSettingsPath) {
      return {
        xml_media_root: envDefault,
        xml_media_roots_recent: envDefault ? [envDefault] : []
      };
    }
    const payload = await readOptionalJson(xmlSettingsPath).catch(() => null);
    const storedCurrent = normalizeXmlMediaRootValue(String(payload?.xml_media_root ?? ""));
    const storedRecent = normalizeXmlMediaRootRecent(payload?.xml_media_roots_recent ?? [], storedCurrent);
    const current = storedCurrent || storedRecent[0] || envDefault;
    return {
      xml_media_root: current,
      xml_media_roots_recent: normalizeXmlMediaRootRecent([current, ...storedRecent, envDefault], current)
    };
  };

  app.get("/api/settings/xml-export", async (_req, res) => {
    try {
      const settings = await readXmlMediaRootSettings();
      return res.json({
        ok: true,
        xml_media_root: settings.xml_media_root || "",
        xml_media_roots_recent: settings.xml_media_roots_recent ?? []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/xml-export", async (req, res) => {
    try {
      if (!xmlSettingsPath || typeof writeJson !== "function") {
        return res.status(503).json({ error: "XML settings storage unavailable" });
      }
      const xmlMediaRoot = normalizeXmlMediaRootValue(String(req.body?.xml_media_root ?? ""));
      const previous = await readXmlMediaRootSettings();
      const recent = xmlMediaRoot
        ? normalizeXmlMediaRootRecent([xmlMediaRoot, ...(previous.xml_media_roots_recent ?? [])], xmlMediaRoot)
        : normalizeXmlMediaRootRecent(previous.xml_media_roots_recent ?? [], "");
      const payload = {
        xml_media_root: xmlMediaRoot,
        xml_media_roots_recent: recent,
        updated_at: new Date().toISOString()
      };
      const settingsDir = path.dirname(xmlSettingsPath);
      await fs.mkdir(settingsDir, { recursive: true });
      await writeJson(xmlSettingsPath, payload);
      return res.json({
        ok: true,
        xml_media_root: xmlMediaRoot,
        xml_media_roots_recent: recent
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/:id/export", async (req, res) => {
    try {
      const docId = req.params.id;
      const format = String(req.query?.format ?? "jsonl").toLowerCase();
      if (!["jsonl", "md", "xml"].includes(format)) {
        return res.status(400).json({ error: "format must be jsonl, md or xml" });
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
            search: normalizeSearchDecisionInput(item.search_decision),
            searchEn: normalizeSearchDecisionInput(item.search_decision_en)
          }
        ])
      );

      if (format === "xml") {
        const sectionId = String(req.query?.section_id ?? "").trim();
        const sectionTitle = String(req.query?.section_title ?? "").trim();
        const xmlMediaRootQuery = String(req.query?.xml_media_root ?? "").trim();
        const xmlMediaRoot = xmlMediaRootQuery || (await readXmlMediaRootSettings()).xml_media_root;
        const scope = String(req.query?.scope ?? "").trim().toLowerCase();
        const wantSection = scope === "section" || Boolean(sectionId) || Boolean(sectionTitle);
        const sourceSegments = segments.filter((segment) => segment?.block_type !== "links");
        const targetSegments = wantSection
          ? sourceSegments.filter((segment) => {
              if (sectionId && String(segment?.section_id ?? "").trim() === sectionId) return true;
              if (!sectionTitle) return false;
              return (
                normalizeSectionTitleForMatch(segment?.section_title ?? "") ===
                normalizeSectionTitleForMatch(sectionTitle)
              );
            })
          : sourceSegments;

        if (wantSection && targetSegments.length === 0) {
          return res.status(404).json({ error: "Section not found for XML export" });
        }

        const xmlPayload = await buildXmlExportPayload({
          document,
          segments: targetSegments,
          decisionsBySegment: decisionMap,
          mediaDir: getMediaDir(),
          mediaPathRootOverride: xmlMediaRoot || null,
          fps: XML_EXPORT_FPS,
          defaultDurationSec: XML_EXPORT_DEFAULT_DURATION_SEC,
          sectionId: wantSection ? sectionId : "",
          sectionTitle: wantSection ? sectionTitle : ""
        });

        if (xmlPayload.clipCount === 0) {
          return res.status(400).json({
            error: "No segments with attached media files found for XML export"
          });
        }

        res.setHeader("content-type", "application/xml; charset=utf-8");
        res.setHeader("content-disposition", buildContentDisposition(xmlPayload.fileName));
        return res.send(xmlPayload.xml);
      }

      if (format === "jsonl") {
        const segmentsForJsonl = segments.filter((segment) => segment?.block_type !== "links");
        const lines = segmentsForJsonl.map((segment) => {
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
                    search_decision: decision.search,
                    search_decision_en: decision.searchEn
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
        res.setHeader("content-disposition", buildContentDisposition(`${document.id}.jsonl`));
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
        if (segment?.block_type === "links") {
          const links = normalizeLinksInput(segment.links);
          mdLines.push(
            `### ${segment.segment_id} (links)`,
            segment.section_title ? `**Раздел:** ${segment.section_title}` : "**Раздел:** —",
            "",
            "**Ссылки**"
          );
          if (links.length) {
            links.forEach((link) => mdLines.push(`- ${link.url}`));
          } else {
            mdLines.push("- —");
          }
          mdLines.push("");
          return;
        }
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
        if (decision.searchEn?.keywords?.length || decision.searchEn?.queries?.length) {
          mdLines.push(
            "",
            "**Search (EN)**",
            `- keywords: ${(decision.searchEn.keywords ?? []).join(", ") || "—"}`,
            "- queries:"
          );
          if (decision.searchEn.queries?.length) {
            decision.searchEn.queries.forEach((query) => mdLines.push(`  - ${query}`));
          } else {
            mdLines.push("  - —");
          }
        }
        mdLines.push("");
      });

      const mdBody = mdLines.join("\n");
      res.setHeader("content-type", "text/markdown; charset=utf-8");
      res.setHeader("content-disposition", buildContentDisposition(`${document.id}.md`));
      return res.send(mdBody);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
