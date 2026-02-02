const DEFAULT_BASE_URL = process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080";
const DEFAULT_MODEL = process.env.LLAMA_MODEL ?? "";
let cachedModel = null;

async function resolveModel() {
  if (DEFAULT_MODEL) return DEFAULT_MODEL;
  if (cachedModel !== null) return cachedModel || undefined;
  try {
    const response = await fetchWithRetry(`${DEFAULT_BASE_URL}/v1/models`, {});
    if (!response.ok) throw new Error(`Models error ${response.status}`);
    const json = await response.json();
    const list = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : Array.isArray(json)
          ? json
          : [];
    const first = list[0] ?? json ?? {};
    const id =
      first?.id ??
      first?.name ??
      first?.model ??
      json?.id ??
      "";
    cachedModel = id || "";
  } catch {
    cachedModel = "";
  }
  return cachedModel || undefined;
}

const BLOCK_TYPES = ["news", "ad", "selfad", "intro", "outro"];
const VISUAL_TYPES = [
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
];
const FORMAT_HINTS = ["2:1", "1:1", "Заголовок/Цитата", "Документ"];
const PRIORITIES = ["обязательно", "рекомендуется", "при наличии"];
const SEARCH_LIMITS = { maxKeywords: 8, maxQueries: 6 };
const SEARCH_ENGINES = [
  { id: "google", label: "Google", url: "https://www.google.com/search?q=" },
  { id: "yandex", label: "Яндекс", url: "https://yandex.ru/search/?text=" }
];
const OUTPUT_TOKEN_LIMIT = Number.isFinite(Number(process.env.LLAMA_MAX_TOKENS))
  ? Number(process.env.LLAMA_MAX_TOKENS)
  : 2048;
const DECISION_BATCH_SIZE = Number.isFinite(Number(process.env.LLM_DECISION_BATCH))
  ? Math.max(1, Number(process.env.LLM_DECISION_BATCH))
  : 6;
const FETCH_RETRY_ATTEMPTS = Number.isFinite(Number(process.env.LLM_FETCH_RETRIES))
  ? Math.max(0, Number(process.env.LLM_FETCH_RETRIES))
  : 2;
const FETCH_RETRY_DELAY_MS = Number.isFinite(Number(process.env.LLM_FETCH_RETRY_DELAY_MS))
  ? Math.max(0, Number(process.env.LLM_FETCH_RETRY_DELAY_MS))
  : 500;

export const config = {
  blockTypes: BLOCK_TYPES,
  visualTypes: VISUAL_TYPES,
  formatHints: FORMAT_HINTS,
  priorities: PRIORITIES,
  searchLimits: SEARCH_LIMITS,
  searchEngines: SEARCH_ENGINES
};

export async function generateSegmentsOnly({ text }) {
  const headingBlocks = splitByHeadings(text);
  if (headingBlocks.length > 0) {
    const segments = buildSegmentsFromHeadings(headingBlocks);
    if (segments.length === 0) return [];
    return segments;
  }

  const llmSegments = await generateSegmentsViaLLM(text);
  const paragraphSegments = buildSegmentsFromText(text);
  if (llmSegments.length <= 1 && paragraphSegments.length > llmSegments.length) {
    return paragraphSegments;
  }
  return llmSegments;
}

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

function safeParseJson(content) {
  if (!content) throw new Error("LLM returned empty content");
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      return JSON.parse(slice);
    }
    const objStart = trimmed.indexOf("{");
    const objEnd = trimmed.lastIndexOf("}");
    if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
      const slice = trimmed.slice(objStart, objEnd + 1);
      return JSON.parse(slice);
    }
    throw new Error("Failed to parse JSON from LLM response");
  }
}

async function generateSegmentsViaLLM(text) {
  const model = await resolveModel();
  const system = `Ты — ассистент по сегментированию сценариев.\n\nПравила:\n- Не переписывай текст.\n- Делай осмысленные сегменты.\n- У каждого сегмента ровно один block_type: ${BLOCK_TYPES.join(", ")}.\n- text_quote должен быть точной подстрокой входного текста.\n- Выводи только JSON, без markdown.\n- segment_id формат: {block_type}_{index:02d}.\n\nВывод: массив объектов с полями: segment_id, block_type, text_quote.`;

  const user = `SCRIPT:\n${text}`;

  const body = {
    model,
    temperature: 0.2,
    max_tokens: OUTPUT_TOKEN_LIMIT,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const response = await fetchWithRetry(`${DEFAULT_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LLM error ${response.status}: ${responseText}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(content);
  return normalizeSegments(parsed);
}

export async function generateDecisionsForSegments(segments, text) {
  const model = await resolveModel();
  const system = `Ты — ассистент по визуальному брифу и поисковым запросам.\n\nПравила:\n- Ты получишь готовые сегменты. Не меняй segment_id, block_type или text_quote.\n- Для каждого сегмента дай visual_decision и search_decision.\n- visual_decision:\n  - type только из: ${VISUAL_TYPES.join(", ")}.\n  - description на русском, 1 короткое предложение, без английского.\n  - format_hint: ${FORMAT_HINTS.join(", ")} или null.\n  - priority: ${PRIORITIES.join(", ")} или null.\n  - duration_hint_sec: число или null.\n- search_decision:\n  - keywords: 5–7 коротких слов/фраз, без повторов; включи все имена, организации и места из сегмента.\n  - queries: 4–5 реальных поисковых запросов на русском с уточнениями (имена, место, время), без английского.\n  - каждое keyword должно встретиться хотя бы в одном запросе.\n- Выводи только JSON, без markdown.\n\nВывод: массив объектов с полями: segment_id, visual_decision { type, description, format_hint, duration_hint_sec, priority }, search_decision { keywords, queries }.`;

  const promptSegments = segments.map(({ segment_id, block_type, text_quote }) => ({
    segment_id,
    block_type,
    text_quote
  }));

  const batchSize = DECISION_BATCH_SIZE;
  const decisions = [];
  const missingSegments = new Map();

  for (let i = 0; i < promptSegments.length; i += batchSize) {
    const batch = promptSegments.slice(i, i + batchSize);
    const user = `SEGMENTS:\n${JSON.stringify(batch, null, 2)}`;
    try {
      const { parsed, normalized, presentIds } = await requestDecisionsBatch({
        model,
        system,
        user,
        batch
      });
      decisions.push(...normalized);
      if (presentIds.size < batch.length) {
        batch
          .filter((segment) => !presentIds.has(segment.segment_id))
          .forEach((segment) => missingSegments.set(segment.segment_id, segment));
      } else {
        const emptyDecisions = normalized.filter(
          (item) => isVisualDecisionEmpty(item.visual_decision) && isSearchDecisionEmpty(item.search_decision)
        );
        if (emptyDecisions.length) {
          batch
            .filter((segment) => emptyDecisions.some((item) => item.segment_id === segment.segment_id))
            .forEach((segment) => missingSegments.set(segment.segment_id, segment));
        }
      }
    } catch (error) {
      console.warn("LLM decisions failed:", error?.message ?? error);
      decisions.push(...batch.map((segment) => ({
        segment_id: segment.segment_id,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision()
      })));
      batch.forEach((segment) => missingSegments.set(segment.segment_id, segment));
    }
  }

  let recovered = [];
  if (missingSegments.size) {
    recovered = await recoverMissingDecisions({
      model,
      system,
      segments: Array.from(missingSegments.values())
    });
  }

  const decisionMap = new Map();
  decisions.forEach((item) => {
    decisionMap.set(item.segment_id, {
      visual: item.visual_decision,
      search: item.search_decision
    });
  });
  recovered.forEach((item) => {
    decisionMap.set(item.segment_id, {
      visual: item.visual_decision,
      search: item.search_decision
    });
  });

  return segments.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision: withDuration(decisionMap.get(segment.segment_id)?.visual ?? emptyVisualDecision(), segment.text_quote),
    search_decision: decisionMap.get(segment.segment_id)?.search ?? emptySearchDecision()
  }));
}

function normalizeSegments(parsed) {
  const list = coerceList(parsed, ["segments", "data", "items"]);

  const counts = new Map();
  const usedIds = new Set();

  const segments = list.map((raw) => {
    const blockType = normalizeBlockType(raw?.block_type);
    const textQuote = typeof raw?.text_quote === "string" ? raw.text_quote.trim() : "";

    const visualDecision = normalizeVisualDecision(raw?.visual_decision ?? raw);
    const searchDecision = normalizeSearchDecision(raw?.search_decision ?? raw?.visual_decision ?? raw);

    const nextIndex = (counts.get(blockType) ?? 0) + 1;
    counts.set(blockType, nextIndex);

    let segmentId = typeof raw?.segment_id === "string" ? raw.segment_id : "";
    if (!segmentId || usedIds.has(segmentId)) {
      segmentId = `${blockType}_${String(nextIndex).padStart(2, "0")}`;
    }
    usedIds.add(segmentId);

    return {
      segment_id: segmentId,
      block_type: blockType,
      text_quote: textQuote,
      visual_decision: visualDecision,
      search_decision: searchDecision
    };
  });

  return segments;
}

function normalizeDecisions(parsed, segments) {
  const list = coerceList(parsed, ["decisions", "items", "data"]);

  const decisionMap = new Map(
    list.map((item) => {
      const segmentId = String(item?.segment_id ?? "");
      const visual = normalizeVisualDecision(item?.visual_decision ?? item);
      const search = normalizeSearchDecision(item?.search_decision ?? item);
      return [segmentId, { visual, search }];
    })
  );

  return segments.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision: decisionMap.get(segment.segment_id)?.visual ?? emptyVisualDecision(),
    search_decision: decisionMap.get(segment.segment_id)?.search ?? emptySearchDecision()
  }));
}

function normalizeBlockType(blockType) {
  const value = String(blockType ?? "").toLowerCase().trim();
  return config.blockTypes.includes(value) ? value : "news";
}

function shouldRetryResponse(response) {
  if (!response) return false;
  return response.status === 429 || response.status >= 500;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, config = {}) {
  const retries = Number.isFinite(Number(config.retries)) ? Number(config.retries) : FETCH_RETRY_ATTEMPTS;
  const delayMs = Number.isFinite(Number(config.retryDelayMs)) ? Number(config.retryDelayMs) : FETCH_RETRY_DELAY_MS;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (!shouldRetryResponse(response) || attempt === retries) return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    }
    const backoff = delayMs * Math.pow(2, attempt);
    await wait(backoff);
  }
  if (lastError) throw lastError;
  throw new Error("fetch failed");
}

async function requestDecisionsBatch({ model, system, user, batch }) {
  const body = {
    model,
    temperature: 0.2,
    max_tokens: OUTPUT_TOKEN_LIMIT,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const response = await fetchWithRetry(`${DEFAULT_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LLM error ${response.status}: ${responseText}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson(content);
  const presentIds = extractDecisionIds(parsed);
  return {
    parsed,
    normalized: normalizeDecisions(parsed, batch),
    presentIds
  };
}

function extractDecisionIds(parsed) {
  const list = coerceList(parsed, ["decisions", "items", "data"]);
  return new Set(
    list
      .map((item) => String(item?.segment_id ?? "").trim())
      .filter(Boolean)
  );
}

async function recoverMissingDecisions({ model, system, segments }) {
  const recovered = [];
  for (const segment of segments) {
    const user = `SEGMENTS:\n${JSON.stringify([segment], null, 2)}`;
    try {
      const { normalized } = await requestDecisionsBatch({
        model,
        system,
        user,
        batch: [segment]
      });
      recovered.push(...normalized);
    } catch (error) {
      console.warn("LLM decision recovery failed:", error?.message ?? error);
      recovered.push({
        segment_id: segment.segment_id,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision()
      });
    }
  }
  return recovered;
}

function coerceList(parsed, keys) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of keys) {
      if (Array.isArray(parsed[key])) return parsed[key];
      if (parsed[key] && typeof parsed[key] === "object") return [parsed[key]];
    }
    if (parsed.segment_id || parsed.block_type || parsed.text_quote) return [parsed];
  }
  return [];
}

function normalizeStringList(value, limit) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const normalized = items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!limit) return normalized;
  return normalized.slice(0, limit);
}

function ensureSearchCoverage(keywords, queries, limit) {
  if (!keywords.length) return queries.slice(0, limit);
  const normalizedQueries = [...queries];
  const lowerQueries = normalizedQueries.map((query) => query.toLowerCase());
  for (const keyword of keywords) {
    const key = String(keyword).toLowerCase();
    const exists = lowerQueries.some((query) => query.includes(key));
    if (!exists && normalizedQueries.length < limit) {
      normalizedQueries.push(keyword);
      lowerQueries.push(key);
    }
  }
  return normalizedQueries.slice(0, limit);
}

function normalizeVisualDecision(raw) {
  if (!raw || typeof raw !== "object") return emptyVisualDecision();
  const typeRaw = String(raw.type ?? raw.visual_type ?? "").toLowerCase().trim();
  const type = config.visualTypes.includes(typeRaw) ? typeRaw : "no_visual";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const formatHint = normalizeFormatHint(raw.format_hint);
  const durationRaw = raw.duration_hint_sec ?? raw.duration_hint ?? null;
  const durationHint =
    typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : durationRaw === null ? null : null;
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
  const normalized = trimmed.toLowerCase();
  const match = config.formatHints.find((hint) => hint.toLowerCase() === normalized);
  return match ?? null;
}

function normalizePriority(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const legacy = { high: "обязательно", medium: "рекомендуется", low: "при наличии" };
  if (legacy[trimmed]) return legacy[trimmed];
  const match = config.priorities.find((priority) => priority.toLowerCase() === trimmed);
  return match ?? null;
}

function normalizeSearchDecision(raw) {
  if (!raw || typeof raw !== "object") return emptySearchDecision();
  const keywords = normalizeStringList(raw.keywords, SEARCH_LIMITS.maxKeywords);
  const queries = normalizeStringList(raw.queries ?? raw.search_queries ?? raw.searchQueries, SEARCH_LIMITS.maxQueries);
  const covered = ensureSearchCoverage(keywords, queries, SEARCH_LIMITS.maxQueries);
  return { keywords, queries: covered };
}

function splitByHeadings(text) {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const blocks = [];
  let current = { heading: null, lines: [] };
  let hasHeading = false;

  for (const line of lines) {
    const match = line.match(/#{3,}\s*(.+?)\s*$/);
    if (match) {
      const hashIndex = line.indexOf("#");
      const before = hashIndex > 0 ? line.slice(0, hashIndex).trim() : "";
      if (before) current.lines.push(before);

      if (current.lines.length || current.heading) blocks.push(current);
      current = { heading: match[1].trim(), lines: [] };
      hasHeading = true;
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length || current.heading) blocks.push(current);

  if (!hasHeading) return [];

  return blocks
    .map((block) => ({
      heading: block.heading,
      text: block.lines.join("\n")
    }))
    .filter((block) => block.heading && block.text.trim());
}

function buildSegmentsFromHeadings(blocks) {
  const counts = new Map();
  const segments = [];
  let sectionIndex = 0;

  for (const block of blocks) {
    if (!block.heading) continue;
    if (shouldSkipHeading(block.heading)) continue;
    const blockType = inferBlockType(block.heading);
    const parts = splitIntoParagraphs(block.text);
    if (parts.length === 0) continue;

    sectionIndex += 1;
    const sectionId = `section_${String(sectionIndex).padStart(2, "0")}`;
    const sectionTitle = block.heading ? block.heading.trim() : "";

    for (const part of parts) {
      const textQuote = part.trim();
      if (!textQuote) continue;

      const nextIndex = (counts.get(blockType) ?? 0) + 1;
      counts.set(blockType, nextIndex);
      const segmentId = `${blockType}_${String(nextIndex).padStart(2, "0")}`;

      segments.push({
        segment_id: segmentId,
        block_type: blockType,
        text_quote: textQuote,
        section_id: sectionId,
        section_title: sectionTitle,
        section_index: sectionIndex,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision()
      });
    }
  }

  return segments;
}

function shouldSkipHeading(heading) {
  const value = String(heading ?? "").toLowerCase().trim();
  if (!value) return true;
  if (value.includes("оформление видео")) return true;
  return false;
}

function splitIntoParagraphs(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) return paragraphs;

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSegmentsFromText(text) {
  const parts = splitIntoParagraphs(text);
  const segments = [];
  let index = 0;
  for (const part of parts) {
    const textQuote = part.trim();
    if (!textQuote) continue;
    index += 1;
    segments.push({
      segment_id: `news_${String(index).padStart(2, "0")}`,
      block_type: "news",
      text_quote: textQuote,
      section_id: null,
      section_title: null,
      section_index: null,
      visual_decision: emptyVisualDecision(),
      search_decision: emptySearchDecision()
    });
  }
  return segments;
}

function inferBlockType(heading) {
  const value = String(heading ?? "").toLowerCase();
  if (value.includes("selfad") || value.includes("самореклам")) return "selfad";
  if (value.includes("intro") || value.includes("интро") || value.includes("вступ")) return "intro";
  if (value.includes("outro") || value.includes("аутро") || value.includes("финал") || value.includes("заключ"))
    return "outro";
  if (value.includes("ad") || value.includes("реклам") || value.includes("промо")) return "ad";
  return "news";
}

function withDuration(decision, textQuote) {
  if (!decision) return decision;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return decision;
  const computed = computeDurationHint(textQuote);
  return { ...decision, duration_hint_sec: computed };
}

function computeDurationHint(textQuote) {
  const matches = String(textQuote ?? "").match(/[\p{L}\p{N}]+/gu);
  const count = matches ? matches.length : 0;
  if (!count) return null;
  return Math.ceil(count / 2);
}

function isVisualDecisionEmpty(decision) {
  if (!decision) return true;
  if (decision.description) return false;
  if (decision.format_hint) return false;
  if (decision.priority) return false;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return false;
  return !decision.type || decision.type === "no_visual";
}

function isSearchDecisionEmpty(decision) {
  if (!decision) return true;
  if (Array.isArray(decision.keywords) && decision.keywords.length > 0) return false;
  if (Array.isArray(decision.queries) && decision.queries.length > 0) return false;
  return true;
}

