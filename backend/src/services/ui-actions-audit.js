import fs from "node:fs/promises";
import path from "node:path";

const MAX_ACTIONS_PER_REQUEST = 200;
const MAX_TEXT = 500;
const MAX_KEYS = 40;

export function createUiActionsAuditStore(options = {}) {
  const dataDir = String(options.dataDir ?? "").trim();
  const enabled = options.enabled !== false;
  const auditDir = path.join(dataDir, "_audit");

  async function appendActions(actions, context = {}) {
    if (!enabled || !dataDir) return { accepted: 0 };
    const list = Array.isArray(actions) ? actions : [];
    if (list.length === 0) return { accepted: 0 };

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const targetFile = path.join(auditDir, `ui-actions-${day}.jsonl`);
    const base = {
      received_at: now.toISOString(),
      source: sanitizeText(context.source, 120) || "frontend",
      user_agent: sanitizeText(context.userAgent, 300) || null,
      ip: sanitizeText(context.ip, 120) || null
    };

    const rows = list
      .slice(0, MAX_ACTIONS_PER_REQUEST)
      .map((item) => normalizeAction(item, base))
      .filter(Boolean);

    if (rows.length === 0) return { accepted: 0 };

    const payload = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await fs.mkdir(auditDir, { recursive: true });
    await fs.appendFile(targetFile, payload, "utf8");
    return { accepted: rows.length, file: targetFile };
  }

  return { appendActions };
}

function normalizeAction(input, base) {
  if (!input || typeof input !== "object") return null;
  const type = sanitizeText(input.type, 40);
  if (!type) return null;
  const row = {
    ...base,
    ts: normalizeIsoDate(input.ts) || base.received_at,
    type,
    path: sanitizeText(input.path, 300) || null,
    doc_id: sanitizeText(input.doc_id, 200) || null,
    target: normalizePlainObject(input.target, 20),
    meta: normalizePlainObject(input.meta, MAX_KEYS)
  };
  return row;
}

function normalizePlainObject(value, maxKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, maxKeys);
  const next = {};
  for (const [key, raw] of entries) {
    const safeKey = sanitizeText(key, 80);
    if (!safeKey) continue;
    if (typeof raw === "boolean" || typeof raw === "number") {
      next[safeKey] = raw;
      continue;
    }
    if (raw == null) {
      next[safeKey] = null;
      continue;
    }
    next[safeKey] = sanitizeText(raw, MAX_TEXT);
  }
  return next;
}

function sanitizeText(value, maxLength = MAX_TEXT) {
  if (value == null) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function normalizeIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}
