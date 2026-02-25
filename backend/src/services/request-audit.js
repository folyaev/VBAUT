import fs from "node:fs/promises";
import path from "node:path";

const DOC_ID_PATH_RE = /^\/api\/documents\/([^/]+)/i;
const BODY_KEYS_LIMIT = 20;

export function createRequestAuditLogger(options = {}) {
  const dataDir = String(options.dataDir ?? "").trim();
  const enabled = options.enabled !== false;
  const includeHealth = Boolean(options.includeHealth);

  if (!enabled || !dataDir) {
    return (_req, _res, next) => next();
  }

  const auditDir = path.join(dataDir, "_audit");

  return (req, res, next) => {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    res.on("finish", () => {
      const routePath = String(req.path ?? req.originalUrl ?? "");
      if (!routePath.startsWith("/api/")) return;
      if (!includeHealth && routePath === "/api/health") return;

      const day = timestamp.slice(0, 10);
      const targetFile = path.join(auditDir, `api-requests-${day}.jsonl`);
      const docId = extractDocId(routePath);
      const bodyKeys = collectBodyKeys(req.body);
      const queryKeys = collectQueryKeys(req.query);
      const durationMs = Date.now() - startedAt;

      const row = {
        timestamp,
        request_id: requestId,
        method: String(req.method ?? "GET").toUpperCase(),
        path: routePath,
        status_code: Number(res.statusCode ?? 0),
        duration_ms: durationMs,
        doc_id: docId,
        query_keys: queryKeys,
        body_keys: bodyKeys,
        user_agent: truncate(String(req.headers["user-agent"] ?? ""), 300),
        ip: resolveIp(req)
      };

      void fs
        .mkdir(auditDir, { recursive: true })
        .then(() => fs.appendFile(targetFile, `${JSON.stringify(row)}\n`, "utf8"))
        .catch(() => null);
    });

    next();
  };
}

function extractDocId(routePath) {
  const match = String(routePath ?? "").match(DOC_ID_PATH_RE);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function collectBodyKeys(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body).slice(0, BODY_KEYS_LIMIT);
}

function collectQueryKeys(query) {
  if (!query || typeof query !== "object") return [];
  return Object.keys(query).slice(0, BODY_KEYS_LIMIT);
}

function resolveIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  return truncate(forwarded || String(req.socket?.remoteAddress ?? ""), 120) || null;
}

function truncate(value, maxLength) {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}
