import React, { useEffect, useState } from "react";

const defaultConfig = {
  blockTypes: ["news", "ad", "selfad", "intro", "outro"],
  visualTypes: [
    "event_footage",
    "portrait",
    "location",
    "explainer_graphic",
    "map",
    "interface_ui",
    "archive",
    "comparison",
    "generated_art",
    "no_visual"
  ],
  formatHints: ["2:1", "1:1", "Заголовок/Цитата", "Документ"],
  priorities: ["обязательно", "рекомендуется", "при наличии"],
  searchLimits: { maxKeywords: 8, maxQueries: 6 },
  searchEngines: [
    { id: "youtube", label: "YouTube", url: "https://www.youtube.com/results?search_query=" },
    {
      id: "youtube_7d_hd",
      label: "YouTube 7 days HD",
      url: "https://www.youtube.com/results?search_query=",
      suffix: "&sp=EgYIAxABIAE%253D"
    },
    {
      id: "yandex_hq",
      label: "Яндекс HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&isize=large"
    },
    {
      id: "yandex_hq_square",
      label: "1:1 Яндекс HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&iorient=square&isize=large"
    },
    {
      id: "google_hq",
      label: "Google HQ",
      url: "https://www.google.com/search?q=",
      suffix: "&tbm=isch&tbs=isz:l"
    },
    { id: "vk_video", label: "VK Видео", url: "https://vk.com/search/video?q=" },
    { id: "vk", label: "VK", url: "https://vk.com/search?q=" },
    {
      id: "x_live",
      label: "X",
      url: "https://x.com/search?q=",
      suffix: "&src=typed_query&f=live"
    },
    { id: "dzen_news", label: "Дзен.Новости", url: "https://dzen.ru/news/search?query=" },
    { id: "reddit", label: "Reddit", url: "https://www.reddit.com/search/?q=" },
    { id: "perplexity", label: "Copy and Perplexity", url: "https://www.perplexity.ai/", action: "copy_open" }
  ]
};

const VISUAL_TYPE_LABELS = {
  event_footage: "🎬 Съёмка события",
  portrait: "🙂 Портрет",
  location: "📍 Локация",
  explainer_graphic: "📊 Инфографика",
  map: "🗺️ Карта",
  interface_ui: "🖥️ Интерфейс",
  archive: "🗄️ Архив",
  comparison: "⚖️ Сравнение",
  generated_art: "🎨 Генеративная графика",
  no_visual: "🚫 Без визуала"
};

const FORMAT_HINT_LABELS = {
  "2:1": "💻 2:1",
  "1:1": "◻️ 1:1",
  "Заголовок/Цитата": "📰 Заголовок/Цитата",
  "Документ": "📝 Документ"
};

const PRIORITY_LABELS = {
  "обязательно": "🔴 Обязательно",
  "рекомендуется": "🟡 Рекомендуется",
  "при наличии": "🟢 При наличии"
};

const emptyVisualDecision = () => ({
  type: "no_visual",
  description: "",
  format_hint: null,
  duration_hint_sec: null,
  priority: null
});

const emptySearchDecision = () => ({
  keywords: [],
  queries: []
});

const normalizeVisualDecision = (decision, config) => {
  if (!decision || typeof decision !== "object") return emptyVisualDecision();
  const typeRaw = String(decision.type ?? decision.visual_type ?? "").toLowerCase().trim();
  const type = (config?.visualTypes ?? defaultConfig.visualTypes).includes(typeRaw) ? typeRaw : "no_visual";
  const description = typeof decision.description === "string" ? decision.description : "";
  const format_hint = normalizeFormatHint(decision.format_hint, config);
  const durationRaw = decision.duration_hint_sec ?? decision.duration_hint ?? null;
  const duration_hint_sec = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
  const priority = normalizePriority(decision.priority, config);

  return {
    type,
    description,
    format_hint,
    duration_hint_sec,
    priority
  };
};

const normalizeFormatHint = (value, config) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = { LONG: "Документ", SQUARE: "1:1" };
  const upper = trimmed.toUpperCase();
  if (legacy[upper]) return legacy[upper];
  const list = config?.formatHints ?? defaultConfig.formatHints;
  const normalized = trimmed.toLowerCase();
  const match = list.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
};

const normalizePriority = (value, config) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const legacy = { high: "обязательно", medium: "рекомендуется", low: "при наличии" };
  if (legacy[trimmed]) return legacy[trimmed];
  const list = config?.priorities ?? defaultConfig.priorities;
  const match = list.find((priority) => priority.toLowerCase() === trimmed);
  return match ?? null;
};

const normalizeKeywordList = (value, limit) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
};

const normalizeQueryList = (value, limit) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/\n+/);
  const normalized = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
};

const normalizeSearchDecision = (decision, config) => {
  if (!decision || typeof decision !== "object") return emptySearchDecision();
  const limits = config?.searchLimits ?? defaultConfig.searchLimits;
  const keywords = normalizeKeywordList(decision.keywords, limits.maxKeywords);
  const queries = normalizeQueryList(decision.queries ?? decision.search_queries ?? decision.searchQueries, limits.maxQueries);
  return { keywords, queries };
};

const computeDurationHint = (text) => {
  const matches = String(text ?? "").match(/[\p{L}\p{N}]+/gu);
  const count = matches ? matches.length : 0;
  if (!count) return null;
  return Math.ceil(count / 2);
};

const normalizeLineBreaks = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const parseScriptSections = (text) => {
  const normalized = normalizeLineBreaks(text);
  const lines = normalized.split("\n");
  const sections = [];
  let offset = 0;

  for (const line of lines) {
    const match = line.match(/#{3,}\s*(.+?)\s*$/);
    if (match) {
      const title = match[1].trim();
      const headingStart = offset + line.indexOf("#");
      const contentStart = offset + line.length + 1;
      if (sections.length > 0) {
        sections[sections.length - 1].end = headingStart;
      }
      const index = sections.length + 1;
      sections.push({
        id: `section_${String(index).padStart(2, "0")}`,
        title,
        index,
        start: contentStart,
        end: normalized.length
      });
    }
    offset += line.length + 1;
  }

  return sections;
};

const assignSectionsByIndex = (segments, sections, options = {}) => {
  if (!sections.length || !segments.length) return segments;

  const override = Boolean(options.override);
  const missingCount = override
    ? segments.length
    : segments.reduce((count, segment) => (segment.section_title ? count : count + 1), 0);
  if (!override && missingCount === 0) return segments;

  let assignedIndex = 0;
  const totalSlots = Math.max(1, missingCount);

  return segments.map((segment) => {
    if (!override && segment.section_title) return segment;
    const ratio = assignedIndex / totalSlots;
    const sectionIndex = Math.min(sections.length - 1, Math.floor(ratio * sections.length));
    const section = sections[sectionIndex];
    assignedIndex += 1;

    return {
      ...segment,
      section_id: section.id,
      section_title: section.title,
      section_index: section.index
    };
  });
};

const applySectionsFromScript = (segments, scriptText) => {
  const sections = parseScriptSections(scriptText);
  if (sections.length === 0) return segments;

  const normalizedText = normalizeLineBreaks(scriptText);
  let cursor = 0;
  let matchCount = 0;

  const mapped = segments.map((segment) => {
    if (segment.section_title) {
      matchCount += 1;
      return segment;
    }
    const quote = normalizeLineBreaks(segment.text_quote ?? "");
    let index = -1;
    if (quote) {
      index = normalizedText.indexOf(quote, cursor);
      if (index === -1) index = normalizedText.indexOf(quote);
    }
    if (index !== -1) {
      matchCount += 1;
      cursor = index + quote.length;
    }

    let selected = null;
    if (index !== -1) {
      for (const section of sections) {
        if (index >= section.start && index < section.end) {
          selected = section;
        }
      }
    } else {
      for (const section of sections) {
        if (cursor >= section.start) selected = section;
      }
    }

    if (!selected) return segment;

    return {
      ...segment,
      section_id: segment.section_id ?? selected.id,
      section_title: segment.section_title ?? selected.title,
      section_index: segment.section_index ?? selected.index
    };
  });

  const matchRatio = segments.length ? matchCount / segments.length : 0;
  if (matchRatio < 0.25) {
    return assignSectionsByIndex(mapped, sections, { override: true });
  }
  return assignSectionsByIndex(mapped, sections);
};

const emptySegment = (index, section = {}) => ({
  segment_id: `custom_${String(index).padStart(2, "0")}`,
  block_type: "news",
  text_quote: "",
  section_id: section.section_id ?? null,
  section_title: section.section_title ?? null,
  section_index: section.section_index ?? null,
  visual_decision: emptyVisualDecision(),
  search_decision: emptySearchDecision(),
  search_decision_en: emptySearchDecision(),
  search_open: false,
  search_en_open: false
});

const GROUP_RENDER_CHUNK = 20;

const getSegmentGroupKey = (segment) => {
  const title = segment.section_title ? segment.section_title.trim() : "";
  return segment.section_id?.trim() || title || "untitled";
};

const getSegmentGroupTitle = (segment) => {
  const title = segment.section_title ? segment.section_title.trim() : "";
  return title || "Без темы";
};

const getSubSegmentBaseId = (segmentId) => {
  const value = String(segmentId ?? "");
  const parts = value.split("_");
  if (parts.length >= 3 && /^\d{2}$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join("_");
  }
  return value;
};

const getNextSubSegmentId = (segments, baseId) => {
  const prefix = `${baseId}_`;
  let max = 0;
  segments.forEach((segment) => {
    const id = String(segment.segment_id ?? "");
    if (!id.startsWith(prefix)) return;
    const suffix = id.slice(prefix.length);
    if (!/^\d{2}$/.test(suffix)) return;
    const value = Number.parseInt(suffix, 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  });
  let next = max + 1;
  let candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  const existing = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  }
  return candidate;
};

const hasVisualDecisionContent = (decision) => {
  if (!decision) return false;
  if (decision.description) return true;
  if (decision.format_hint) return true;
  if (decision.priority) return true;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return true;
  return decision.type && decision.type !== "no_visual";
};

const hasSearchDecisionContent = (decision) => {
  if (!decision) return false;
  if (Array.isArray(decision.keywords) && decision.keywords.length > 0) return true;
  if (Array.isArray(decision.queries) && decision.queries.length > 0) return true;
  return false;
};

const SegmentCard = React.memo(function SegmentCard({
  segment,
  index,
  animationIndex = 0,
  config,
  onUpdate,
  onVisualUpdate,
  onSearchUpdate,
  onQuoteChange,
  onInsertAfter,
  onRemove,
  onClearSearch,
  onSearchGenerate,
  onSearchGenerateEn,
  onSearchEnUpdate,
  onSearchEnToggle,
  searchLoading,
  searchEnLoading,
  onSearchToggle,
  onSearch,
  onCopy
}) {
  const keywordsValue = (segment.search_decision?.keywords ?? []).join(", ");
  const queriesValue = (segment.search_decision?.queries ?? []).join("\n");
  const enKeywordsValue = (segment.search_decision_en?.keywords ?? []).join(", ");
  const enQueriesValue = (segment.search_decision_en?.queries ?? []).join("\n");
  const hasEn = (segment.search_decision_en?.keywords ?? []).length > 0 || (segment.search_decision_en?.queries ?? []).length > 0;

  return (
    <article
      className="segment-card"
      style={{ animationDelay: `${animationIndex * 40}ms` }}
    >
      <div className="segment-head">
        <div>
          <label>ID</label>
          <input
            value={segment.segment_id}
            onChange={(event) => onUpdate(index, { segment_id: event.target.value })}
          />
        </div>
        <div className="segment-head-actions">
          <button
            className="btn small ghost"
            type="button"
            onClick={() => onInsertAfter(index)}
            title="Добавить подблок"
            aria-label="Добавить подблок"
          >
            +
          </button>
          <button
            className="btn small ghost"
            type="button"
            onClick={() => onRemove(index)}
            title="Удалить"
            aria-label="Удалить"
          >
            -
          </button>
        </div>
      </div>

      <div className="segment-body">
        <label>Цитата</label>
        <textarea
          value={segment.text_quote}
          onChange={(event) => onQuoteChange(index, event.target.value)}
        />

        <div className="decision-grid">
          <div>
            <label>Визуал</label>
            <select
              value={segment.visual_decision.type}
              onChange={(event) => onVisualUpdate(index, { type: event.target.value })}
            >
              {config.visualTypes.map((type) => (
                <option key={type} value={type}>
                  {VISUAL_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Формат</label>
            <select
              value={segment.visual_decision.format_hint ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  format_hint: event.target.value ? event.target.value : null
                })
              }
            >
              <option value="">—</option>
              {config.formatHints.map((type) => (
                <option key={type} value={type}>
                  {FORMAT_HINT_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Приоритет</label>
            <select
              value={segment.visual_decision.priority ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  priority: event.target.value ? event.target.value : null
                })
              }
            >
              <option value="">—</option>
              {config.priorities.map((type) => (
                <option key={type} value={type}>
                  {PRIORITY_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Длительность (сек)</label>
            <input
              type="number"
              value={segment.visual_decision.duration_hint_sec ?? ""}
              onChange={(event) =>
                onVisualUpdate(index, {
                  duration_hint_sec: event.target.value ? Number(event.target.value) : null
                })
              }
            />
          </div>
        </div>

        <label>Описание визуала</label>
        <textarea
          value={segment.visual_decision.description}
          onChange={(event) => onVisualUpdate(index, { description: event.target.value })}
        />

        <div className="search-toggle">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchGenerate(index)}
            disabled={searchLoading}
          >
            {searchLoading ? "Генерация..." : "Сгенерировать поиск"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchGenerateEn(index)}
            disabled={searchEnLoading}
          >
            {searchEnLoading ? "EN..." : "Добавить EN"}
          </button>
          {hasEn || segment.search_en_open ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onSearchEnToggle(index)}
            >
              {segment.search_en_open ? "Скрыть EN" : "Показать EN"}
            </button>
          ) : null}
          <button
            className="btn ghost small"
            type="button"
            onClick={() => onSearchToggle(index)}
          >
            {segment.search_open
              ? "Скрыть поисковые запросы"
              : `Показать поисковые запросы (${segment.search_decision?.queries?.length ?? 0})`}
          </button>
        </div>

        {segment.search_open ? (
          <>
            <label>Ключевые слова</label>
            <input
              value={keywordsValue}
              onChange={(event) =>
                onSearchUpdate(index, {
                  keywords: normalizeKeywordList(event.target.value, config.searchLimits?.maxKeywords)
                })
              }
              placeholder="Через запятую"
            />

            <label>Поисковые запросы</label>
            <textarea
              value={queriesValue}
              onChange={(event) =>
                onSearchUpdate(index, {
                  queries: normalizeQueryList(event.target.value, config.searchLimits?.maxQueries)
                })
              }
              placeholder="Каждый запрос с новой строки"
            />

            {segment.search_decision?.queries?.length ? (
              <div className="query-list">
                {segment.search_decision.queries.map((query, queryIndex) => (
                  <div key={`${segment.segment_id}-query-${queryIndex}`} className="query-row">
                    <span className="query-text">{query}</span>
                    <div className="query-actions">
                      {(config.searchEngines ?? []).map((engine) => (
                        <button
                          key={`${engine.id}-${queryIndex}`}
                          className="btn ghost small"
                          type="button"
                          onClick={() => onSearch(engine, query)}
                        >
                          {engine.label}
                        </button>
                      ))}
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => onCopy(query)}
                      >
                        Копировать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="segment-actions">
              <button className="btn ghost small" onClick={() => onClearSearch(index)}>
                Очистить поисковые
              </button>
            </div>

            {segment.search_en_open ? (
              <>
                <label>EN keywords</label>
                <input
                  value={enKeywordsValue}
                  onChange={(event) =>
                    onSearchEnUpdate(index, {
                      keywords: normalizeKeywordList(event.target.value, config.searchLimits?.maxKeywords)
                    })
                  }
                  placeholder="Comma-separated"
                />

                <label>EN queries</label>
                <textarea
                  value={enQueriesValue}
                  onChange={(event) =>
                    onSearchEnUpdate(index, {
                      queries: normalizeQueryList(event.target.value, config.searchLimits?.maxQueries)
                    })
                  }
                  placeholder="Each query on new line"
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
});

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [scriptText, setScriptText] = useState("");
  const [docId, setDocId] = useState("");
  const [docIdInput, setDocIdInput] = useState("");
  const [segments, setSegments] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState({});
  const [searchLoading, setSearchLoading] = useState({});
  const [searchEnLoading, setSearchEnLoading] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupRenderLimits, setGroupRenderLimits] = useState({});

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data?.blockTypes) {
          setConfig({
            ...defaultConfig,
            ...data,
            visualTypes: data.visualTypes ?? defaultConfig.visualTypes,
            formatHints: data.formatHints ?? defaultConfig.formatHints,
            priorities: data.priorities ?? defaultConfig.priorities,
            searchLimits: { ...defaultConfig.searchLimits, ...(data.searchLimits ?? {}) },
            searchEngines: data.searchEngines ?? defaultConfig.searchEngines
          });
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    setDocIdInput(docId);
  }, [docId]);

  const segmentsCount = segments.length;
  const groupedSegments = React.useMemo(() => {
    const map = new Map();
    segments.forEach((segment, index) => {
      const key = getSegmentGroupKey(segment);
      const title = getSegmentGroupTitle(segment);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title,
          items: [],
          blockType: segment.block_type ?? "news",
          mixed: false
        });
      }
      const group = map.get(key);
      if (group.blockType !== segment.block_type) {
        group.mixed = true;
      }
      group.items.push({ segment, index });
    });
    return Array.from(map.values());
  }, [segments]);

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = false;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments]);

  useEffect(() => {
    setGroupRenderLimits((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = GROUP_RENDER_CHUNK;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments]);

  const canGenerate = Boolean(docId) && !loading;
  const canSave = Boolean(docId) && segmentsCount > 0 && !loading;
  const canLoad = Boolean(docIdInput.trim()) && !loading;

  const handleCreateDocument = async () => {
    if (!scriptText.trim()) {
      setStatus("Добавьте текст сценария.");
      return;
    }
    setLoading(true);
    setStatus("Создание документа...");
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: scriptText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Ошибка создания документа");

      setDocId(data.id);
      setDocIdInput(data.id);
      setSegments([]);
      setStatus(`Документ создан: ${data.id}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDocument = async () => {
    const targetId = docIdInput.trim();
    if (!targetId) return;
    setLoading(true);
    setStatus("Загрузка документа...");
    try {
      const response = await fetch(`/api/documents/${targetId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Ошибка загрузки документа");

      setDocId(targetId);
      setScriptText(data.document?.raw_text ?? "");
      const merged = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        data.document?.raw_text ?? ""
      );
      setSegments(merged);
      setStatus(`Документ загружен: ${targetId}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!docId) return;
    setLoading(true);
    setStatus("Генерация сегментов...");
    try {
      const response = await fetch(`/api/documents/${docId}/segments:generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: scriptText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации");

      const merged = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        scriptText
      );
      setSegments(merged);
      const visualCount = merged.filter((segment) => hasVisualDecisionContent(segment.visual_decision)).length;
      const searchCount = merged.filter((segment) => hasSearchDecisionContent(segment.search_decision)).length;
      if (visualCount === 0 && searchCount === 0) {
        setStatus(
          `Сегменты готовы: ${merged.length}. Нажмите AI Help у нужной темы, чтобы получить визуал и поиск.`
        );
      } else {
        setStatus(
          `Сегменты готовы: ${merged.length}. Визуал: ${visualCount}. Поиск: ${searchCount}.`
        );
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!docId) return;
    setLoading(true);
    setStatus("Сохранение...");
    try {
      const { segmentsPayload, decisionsPayload } = splitSegmentsAndDecisions(segments);

      const [segmentsResponse, decisionsResponse] = await Promise.all([
        fetch(`/api/documents/${docId}/segments`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ segments: segmentsPayload })
        }),
        fetch(`/api/documents/${docId}/decisions`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decisions: decisionsPayload })
        })
      ]);

      const segmentsResult = await segmentsResponse.json();
      const decisionsResult = await decisionsResponse.json();

      if (!segmentsResponse.ok) throw new Error(segmentsResult?.error ?? "Ошибка сохранения сегментов");
      if (!decisionsResponse.ok) throw new Error(decisionsResult?.error ?? "Ошибка сохранения решений");

      setStatus("Сохранено.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format) => {
    if (!docId) {
      setStatus("Сначала создайте или загрузите документ.");
      return;
    }
    try {
      setStatus(`Экспорт ${format.toUpperCase()}...`);
      const response = await fetch(`/api/documents/${docId}/export?format=${format}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `Ошибка экспорта ${format.toUpperCase()}`);
      }
      const blob = await response.blob();
      const ext = format === "jsonl" ? "jsonl" : "md";
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${docId}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus(`Экспорт готов: ${docId}.${ext}`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAddSegment = () => {
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      const section = last
        ? {
            section_id: last.section_id ?? null,
            section_title: last.section_title ?? null,
            section_index: last.section_index ?? null
          }
        : {};
      return [...prev, emptySegment(prev.length + 1, section)];
    });
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
    setGroupRenderLimits((prev) => {
      if (prev[groupId]) return prev;
      return { ...prev, [groupId]: GROUP_RENDER_CHUNK };
    });
  };

  const handleGroupBlockTypeChange = React.useCallback((groupId, value) => {
    setSegments((prev) =>
      prev.map((segment) =>
        getSegmentGroupKey(segment) === groupId ? { ...segment, block_type: value } : segment
      )
    );
  }, []);

  const handleShowMore = React.useCallback((groupId) => {
    setGroupRenderLimits((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? GROUP_RENDER_CHUNK) + GROUP_RENDER_CHUNK
    }));
  }, []);

  const handleRemoveSegment = React.useCallback((index) => {
    setSegments((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleInsertAfter = React.useCallback((index) => {
    setSegments((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const source = prev[index];
      const baseId = getSubSegmentBaseId(source.segment_id);
      const newId = getNextSubSegmentId(prev, baseId);
      const newSegment = {
        segment_id: newId,
        block_type: source.block_type ?? "news",
        text_quote: "",
        section_id: source.section_id ?? null,
        section_title: source.section_title ?? null,
        section_index: source.section_index ?? null,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision(),
        search_open: false,
        version: 1
      };
      const next = [...prev];
      next.splice(index + 1, 0, newSegment);
      return next;
    });
  }, []);

  const updateSegment = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) => (idx === index ? { ...segment, ...updates } : segment))
    );
  }, []);

  const updateVisual = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, visual_decision: { ...segment.visual_decision, ...updates } }
          : segment
      )
    );
  }, []);

  const updateSearch = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, search_decision: { ...segment.search_decision, ...updates } }
          : segment
      )
    );
  }, []);

  const updateSearchEn = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, search_decision_en: { ...segment.search_decision_en, ...updates } }
          : segment
      )
    );
  }, []);

  const handleSearchToggle = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_open: !segment.search_open } : segment
      )
    );
  }, []);

  const handleSearchEnToggle = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_en_open: !segment.search_en_open } : segment
      )
    );
  }, []);

  const handleClearSearch = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_decision: emptySearchDecision() } : segment
      )
    );
  }, []);

  const handleQuoteChange = React.useCallback((index, value) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? {
              ...segment,
              text_quote: value,
              visual_decision:
                segment.visual_decision?.duration_hint_sec !== null &&
                segment.visual_decision?.duration_hint_sec !== undefined
                  ? segment.visual_decision
                  : {
                      ...segment.visual_decision,
                      duration_hint_sec: computeDurationHint(value)
                    }
            }
          : segment
      )
    );
  }, []);

  const copyToClipboard = React.useCallback((value, successMessage = "Запрос скопирован.") => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => setStatus(successMessage),
        () => setStatus("Не удалось скопировать запрос.")
      );
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      setStatus(successMessage);
    } catch {
      setStatus("Не удалось скопировать запрос.");
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);

  const handleSearch = React.useCallback(
    (engine, query) => {
      if (!engine || !query) return;
      if (engine.action === "copy_open") {
        copyToClipboard(query, "Запрос скопирован и открыт Perplexity.");
        if (engine.url) {
          window.open(engine.url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (!engine.url) return;
      const suffix = engine.suffix ?? "";
      const url = `${engine.url}${encodeURIComponent(query)}${suffix}`;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [copyToClipboard]
  );

  const handleAiHelp = React.useCallback(
    async (groupId) => {
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const group = groupedSegments.find((item) => item.id === groupId);
      if (!group || !group.items.length) {
        setStatus("В этой теме нет сегментов.");
        return;
      }

      const pendingItem =
        group.items.find(
          ({ segment }) =>
            !hasVisualDecisionContent(segment.visual_decision) &&
            !hasSearchDecisionContent(segment.search_decision)
        ) ?? group.items[0];
      if (!pendingItem) {
        setStatus("Не удалось найти сегмент для AI Help.");
        return;
      }

      const segmentId = pendingItem.segment.segment_id;
      if (aiLoading[segmentId]) return;

      setAiLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`AI Help: ${segmentId}...`);
      try {
        const response = await fetch(`/api/documents/${docId}/decisions:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segmentId,
              block_type: pendingItem.segment.block_type,
              text_quote: pendingItem.segment.text_quote
            }
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Ошибка AI Help");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("AI Help: решение не пришло");

        setSegments((prev) =>
          prev.map((segment) =>
            segment.segment_id === decision.segment_id
              ? {
                  ...segment,
                  visual_decision: normalizeVisualDecision(decision.visual_decision, config),
                  search_decision: normalizeSearchDecision(decision.search_decision, config)
                }
              : segment
          )
        );
        setStatus(`AI Help: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setAiLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [aiLoading, config, docId, groupedSegments]
  );

  const handleGenerateSearch = React.useCallback(
    async (index) => {
      const segment = segments[index];
      if (!segment) return;
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const segmentId = segment.segment_id;
      if (searchLoading[segmentId]) return;

      setSearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`Поиск: ${segmentId}...`);
      try {
        const response = await fetch(`/api/documents/${docId}/search:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segment.segment_id,
              block_type: segment.block_type,
              text_quote: segment.text_quote,
              visual_decision: segment.visual_decision
            }
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации поиска");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("Поиск: решение не пришло");

        setSegments((prev) =>
          prev.map((item, idx) =>
            idx === index
              ? {
                  ...item,
                  visual_decision: normalizeVisualDecision(decision.visual_decision, config),
                  search_decision: normalizeSearchDecision(decision.search_decision, config),
                  search_open: true
                }
              : item
          )
        );
        setStatus(`Поиск: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, searchLoading, segments]
  );

  const handleGenerateSearchEn = React.useCallback(
    async (index) => {
      const segment = segments[index];
      if (!segment) return;
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const segmentId = segment.segment_id;
      if (searchEnLoading[segmentId]) return;

      setSearchEnLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`Search EN: ${segmentId}...`);
      try {
        const response = await fetch(`/api/documents/${docId}/search-en:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segment.segment_id,
              block_type: segment.block_type,
              text_quote: segment.text_quote,
              visual_decision: segment.visual_decision
            }
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации EN-поиска");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("EN поиск: решение не пришло");

        setSegments((prev) =>
          prev.map((item, idx) =>
            idx === index
              ? {
                  ...item,
                  search_decision_en: normalizeSearchDecision(decision.search_decision_en, config),
                  search_en_open: true
                }
              : item
          )
        );
        setStatus(`Search EN: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSearchEnLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, searchEnLoading, segments]
  );

  const handleCopy = React.useCallback((query) => {
    copyToClipboard(query);
  }, [copyToClipboard]);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Ассистент визуального брифа</p>
          <h1>Локальный мозг для визуального ресёрча</h1>
          <p className="subtitle">
            Сегментируйте сценарий, получайте визуальные решения и поисковые запросы без потери ритма.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-stat">
            <span>Документ</span>
            <strong>{docId ? docId : "—"}</strong>
          </div>
          <div className="hero-stat">
            <span>Сегменты</span>
            <strong>{segmentsCount}</strong>
          </div>
          <div className="hero-stat">
            <span>Статус</span>
            <strong>{status || "Готов"}</strong>
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>Сценарий</h2>
          <div className="panel-actions">
            <button className="btn" onClick={handleCreateDocument} disabled={loading}>
              Создать документ
            </button>
            <div className="doc-loader">
              <input
                value={docIdInput}
                onChange={(event) => setDocIdInput(event.target.value)}
                placeholder="ID документа"
              />
              <button className="btn ghost" onClick={handleLoadDocument} disabled={!canLoad}>
                Загрузить
              </button>
            </div>
            <button className="btn ghost" onClick={handleGenerate} disabled={!canGenerate}>
              Сегментировать
            </button>
          </div>
        </div>
        <textarea
          className="script-input"
          placeholder="Вставьте готовый текст сценария..."
          value={scriptText}
          onChange={(event) => setScriptText(event.target.value)}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Блоки сценария</h2>
          <div className="panel-actions">
            <button className="btn ghost" onClick={handleAddSegment}>
              Добавить сегмент
            </button>
            <button className="btn" onClick={handleSave} disabled={!canSave}>
              Сохранить
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("jsonl")}>
              Экспорт JSONL
            </button>
            <button className="btn ghost" type="button" onClick={() => handleExport("md")}>
              Экспорт MD
            </button>
          </div>
        </div>

        {segments.length === 0 ? (
          <div className="empty-state">
            <p>Пока нет сегментов. Запустите сегментацию или добавьте сегмент вручную.</p>
          </div>
        ) : (




          <div className="segment-groups">
            {groupedSegments.map((group, groupIndex) => {
              const isExpanded = Boolean(expandedGroups[group.id]);
              const limit = groupRenderLimits[group.id] ?? GROUP_RENDER_CHUNK;
              const visibleItems = isExpanded ? group.items.slice(0, limit) : [];
              const remaining = group.items.length - visibleItems.length;
              const groupLoading = group.items.some(({ segment }) => aiLoading[segment.segment_id]);

              return (
                <div key={`${group.id}-${groupIndex}`} className="segment-group">
                  <div className="segment-group-header">
                    <div className="segment-group-title">
                      <h3>{group.title === "Без темы" ? "Без темы" : `### ${group.title}`}</h3>
                      <div className="segment-group-meta">
                        <span>{group.items.length} сегм.</span>
                        <div className="segment-group-type">
                          <label>Тип блока</label>
                          <select
                            value={group.mixed ? "" : group.blockType}
                            onChange={(event) => handleGroupBlockTypeChange(group.id, event.target.value)}
                          >
                            <option value="" disabled>
                              смешано
                            </option>
                            {config.blockTypes.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleAiHelp(group.id)}
                            disabled={!docId || loading || groupLoading}
                          >
                            {groupLoading ? "AI Help..." : "AI Help"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Свернуть" : "Развернуть"}
                    </button>
                  </div>
                  {isExpanded ? (
                    <>
                      <div className="segments-grid">
                        {visibleItems.map(({ segment, index }, localIndex) => (
                          <SegmentCard
                            key={`${segment.segment_id}-${index}`}
                            segment={segment}
                            index={index}
                            animationIndex={localIndex}
                            config={config}
                            onUpdate={updateSegment}
                            onVisualUpdate={updateVisual}
                            onSearchUpdate={updateSearch}
                            onSearchEnUpdate={updateSearchEn}
                            onQuoteChange={handleQuoteChange}
                            onInsertAfter={handleInsertAfter}
                            onRemove={handleRemoveSegment}
                            onClearSearch={handleClearSearch}
                            onSearchGenerate={handleGenerateSearch}
                            onSearchGenerateEn={handleGenerateSearchEn}
                            searchLoading={Boolean(searchLoading[segment.segment_id])}
                            searchEnLoading={Boolean(searchEnLoading[segment.segment_id])}
                            onSearchToggle={handleSearchToggle}
                            onSearchEnToggle={handleSearchEnToggle}
                            onSearch={handleSearch}
                            onCopy={handleCopy}
                          />
                        ))}
                      </div>
                      {remaining > 0 ? (
                        <div className="segment-group-footer">
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleShowMore(group.id)}
                          >
                            Показать ещё
                          </button>
                          <span>
                            Показано {visibleItems.length} из {group.items.length}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function mergeSegmentsAndDecisions(segments = [], decisions = [], config = defaultConfig) {
  const decisionMap = new Map(
    decisions.map((item) => [
      item.segment_id,
      {
        visual: item.visual_decision ?? item.visual,
        search: item.search_decision ?? item.search,
        searchEn: item.search_decision_en ?? item.search_en ?? item.searchEn
      }
    ])
  );
  return segments.map((segment) => ({
    ...segment,
    visual_decision: (() => {
      const normalized = normalizeVisualDecision(
        decisionMap.get(segment.segment_id)?.visual ?? segment.visual_decision,
        config
      );
      if (normalized.duration_hint_sec !== null && normalized.duration_hint_sec !== undefined) {
        return normalized;
      }
      return { ...normalized, duration_hint_sec: computeDurationHint(segment.text_quote) };
    })(),
    search_decision: normalizeSearchDecision(
      decisionMap.get(segment.segment_id)?.search ?? segment.search_decision,
      config
    ),
    search_decision_en: normalizeSearchDecision(
      decisionMap.get(segment.segment_id)?.searchEn ?? segment.search_decision_en,
      config
    ),
    search_open: Boolean(segment.search_open),
    search_en_open: Boolean(segment.search_en_open)
  }));
}

function splitSegmentsAndDecisions(segments = []) {
  const segmentsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    block_type: segment.block_type,
    text_quote: segment.text_quote,
    section_id: segment.section_id ?? null,
    section_title: segment.section_title ?? null,
    section_index: segment.section_index ?? null,
    version: segment.version ?? 1
  }));

  const decisionsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision: normalizeVisualDecision(segment.visual_decision, defaultConfig),
    search_decision: normalizeSearchDecision(segment.search_decision, defaultConfig),
    search_decision_en: normalizeSearchDecision(segment.search_decision_en, defaultConfig),
    version: segment.version ?? 1
  }));

  return { segmentsPayload, decisionsPayload };
}
