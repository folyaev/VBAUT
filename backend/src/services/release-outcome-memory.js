import path from "node:path";

const DEFAULT_RELEASE_OUTCOME_MEMORY = {
  version: 1,
  domains: {},
  kinds: {},
  roles: {},
  recent: []
};

function normalizeDomain(input) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeKind(input) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeRole(input) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeUrl(input) {
  try {
    return new URL(String(input ?? "").trim()).toString();
  } catch {
    return "";
  }
}

function sanitizeMemory(input = {}) {
  const normalized = {
    version: Number.isFinite(Number(input?.version)) ? Number(input.version) : 1,
    domains: {},
    kinds: {},
    roles: {},
    recent: []
  };

  const normalizeStats = (stats = {}) => ({
    used_count: Number(stats.used_count ?? 0) || 0,
    attach_count: Number(stats.attach_count ?? 0) || 0,
    prepare_count: Number(stats.prepare_count ?? 0) || 0,
    fill_count: Number(stats.fill_count ?? 0) || 0,
    last_used_at: String(stats.last_used_at ?? "").trim() || null
  });

  if (input?.domains && typeof input.domains === "object" && !Array.isArray(input.domains)) {
    Object.entries(input.domains).forEach(([domain, stats]) => {
      const key = normalizeDomain(domain);
      if (!key || !stats || typeof stats !== "object" || Array.isArray(stats)) return;
      normalized.domains[key] = normalizeStats(stats);
    });
  }
  if (input?.kinds && typeof input.kinds === "object" && !Array.isArray(input.kinds)) {
    Object.entries(input.kinds).forEach(([kind, stats]) => {
      const key = normalizeKind(kind);
      if (!key || !stats || typeof stats !== "object" || Array.isArray(stats)) return;
      normalized.kinds[key] = normalizeStats(stats);
    });
  }
  if (input?.roles && typeof input.roles === "object" && !Array.isArray(input.roles)) {
    Object.entries(input.roles).forEach(([role, stats]) => {
      const key = normalizeRole(role);
      if (!key || !stats || typeof stats !== "object" || Array.isArray(stats)) return;
      normalized.roles[key] = normalizeStats(stats);
    });
  }

  normalized.recent = (Array.isArray(input?.recent) ? input.recent : [])
    .map((item) => ({
      release_id: String(item?.release_id ?? "").trim() || null,
      asset_id: String(item?.asset_id ?? "").trim() || null,
      domain: normalizeDomain(item?.domain) || null,
      kind: normalizeKind(item?.kind) || null,
      role: normalizeRole(item?.role) || null,
      action: normalizeRole(item?.action) || null,
      title: String(item?.title ?? "").trim() || null,
      url: normalizeUrl(item?.url) || null,
      used_at: String(item?.used_at ?? "").trim() || null
    }))
    .filter((item) => item.asset_id && item.action)
    .slice(0, 150);

  return normalized;
}

function bumpStats(target = {}, action, usedAt) {
  const stats = {
    used_count: 0,
    attach_count: 0,
    prepare_count: 0,
    fill_count: 0,
    last_used_at: null,
    ...(target ?? {})
  };
  stats.used_count += 1;
  if (action === "attach") stats.attach_count += 1;
  if (action === "prepare") stats.prepare_count += 1;
  if (action === "fill") stats.fill_count += 1;
  stats.last_used_at = usedAt;
  return stats;
}

function toRankedEntries(map = {}) {
  return Object.entries(map)
    .map(([key, stats]) => ({
      key,
      ...(stats && typeof stats === "object" ? stats : {})
    }))
    .sort(
      (a, b) =>
        Number(b.used_count ?? 0) - Number(a.used_count ?? 0) ||
        String(b.last_used_at ?? "").localeCompare(String(a.last_used_at ?? ""))
    );
}

export function createReleaseOutcomeMemoryStore({ dataDir, readOptionalJson, writeJson }) {
  const filePath = path.join(dataDir, "release-outcome-memory.json");

  async function ensureReleaseOutcomeMemory() {
    const current = await readOptionalJson(filePath);
    const normalized = sanitizeMemory(current ?? DEFAULT_RELEASE_OUTCOME_MEMORY);
    const needsWrite = JSON.stringify(current ?? null) !== JSON.stringify(normalized);
    if (needsWrite) {
      await writeJson(filePath, normalized);
    }
    return normalized;
  }

  async function getReleaseOutcomeMemory() {
    return ensureReleaseOutcomeMemory();
  }

  async function recordReleaseOutcome(input = {}) {
    const assetId = String(input.asset_id ?? "").trim();
    const action = normalizeRole(input.action);
    if (!assetId || !action) {
      throw new Error("asset_id and action are required");
    }
    const domain = normalizeDomain(input.domain);
    const kind = normalizeKind(input.kind);
    const role = normalizeRole(input.role);
    const usedAt = String(input.used_at ?? new Date().toISOString());

    const current = await ensureReleaseOutcomeMemory();
    const next = sanitizeMemory(current);

    if (domain) next.domains[domain] = bumpStats(next.domains[domain], action, usedAt);
    if (kind) next.kinds[kind] = bumpStats(next.kinds[kind], action, usedAt);
    if (role) next.roles[role] = bumpStats(next.roles[role], action, usedAt);

    next.recent = [
      {
        release_id: String(input.release_id ?? "").trim() || null,
        asset_id: assetId,
        domain: domain || null,
        kind: kind || null,
        role: role || null,
        action,
        title: String(input.title ?? "").trim() || null,
        url: normalizeUrl(input.url) || null,
        used_at: usedAt
      },
      ...next.recent.filter((item) => !(item.asset_id === assetId && item.action === action && item.release_id === String(input.release_id ?? "").trim()))
    ].slice(0, 150);

    await writeJson(filePath, next);
    return next;
  }

  function summarizeReleaseOutcomeMemory(memory = {}) {
    return {
      total_domains: Object.keys(memory?.domains ?? {}).length,
      total_kinds: Object.keys(memory?.kinds ?? {}).length,
      total_roles: Object.keys(memory?.roles ?? {}).length,
      top_domains: toRankedEntries(memory?.domains ?? {}).slice(0, 8),
      top_kinds: toRankedEntries(memory?.kinds ?? {}).slice(0, 8),
      top_roles: toRankedEntries(memory?.roles ?? {}).slice(0, 8),
      recent: (Array.isArray(memory?.recent) ? memory.recent : []).slice(0, 12)
    };
  }

  return {
    filePath,
    ensureReleaseOutcomeMemory,
    getReleaseOutcomeMemory,
    recordReleaseOutcome,
    summarizeReleaseOutcomeMemory
  };
}
