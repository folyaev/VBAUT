import path from "node:path";

const DEFAULT_RESEARCH_DATA = {
  version: 1,
  runs: []
};

function normalizeRun(run = {}) {
  return {
    run_id: String(run.run_id ?? "").trim(),
    segment_id: String(run.segment_id ?? "").trim(),
    section_id: String(run.section_id ?? "").trim() || null,
    section_title: String(run.section_title ?? "").trim() || null,
    status: String(run.status ?? "pending").trim() || "pending",
    mode: String(run.mode ?? "fast").trim() || "fast",
    queries: Array.isArray(run.queries) ? run.queries : [],
    results: Array.isArray(run.results) ? run.results : [],
    ranked_results: Array.isArray(run.ranked_results) ? run.ranked_results : [],
    summary: run.summary && typeof run.summary === "object" ? run.summary : {},
    brief: run.brief && typeof run.brief === "object" ? run.brief : { items: [] },
    warnings: Array.isArray(run.warnings) ? run.warnings : [],
    applied: Array.isArray(run.applied) ? run.applied : [],
    created_at: String(run.created_at ?? new Date().toISOString()),
    updated_at: String(run.updated_at ?? new Date().toISOString())
  };
}

export function createResearchStore({ ensureDocDir, getDocDir, readOptionalJson, writeJson, onRunsChanged = null }) {
  function getResearchFilePath(docId) {
    return path.join(getDocDir(docId), "research.json");
  }

  async function ensureResearchFile(docId) {
    await ensureDocDir(docId);
    const filePath = getResearchFilePath(docId);
    const current = await readOptionalJson(filePath);
    if (current && typeof current === "object" && Array.isArray(current.runs)) {
      return current;
    }
    await writeJson(filePath, DEFAULT_RESEARCH_DATA);
    return { ...DEFAULT_RESEARCH_DATA };
  }

  async function listRuns(docId) {
    const current = await ensureResearchFile(docId);
    return Array.isArray(current.runs) ? current.runs.map((item) => normalizeRun(item)) : [];
  }

  async function getLatestRun(docId, segmentId) {
    const normalizedSegmentId = String(segmentId ?? "").trim();
    if (!normalizedSegmentId) return null;
    const filtered = await listRunsForSegment(docId, segmentId);
    return filtered[0] ?? null;
  }

  async function getRunById(docId, runId) {
    const normalizedRunId = String(runId ?? "").trim();
    if (!normalizedRunId) return null;
    const runs = await listRuns(docId);
    return runs.find((item) => String(item?.run_id ?? "") === normalizedRunId) ?? null;
  }

  async function listRunsForSegment(docId, segmentId, options = {}) {
    const normalizedSegmentId = String(segmentId ?? "").trim();
    if (!normalizedSegmentId) return [];
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : null;
    const runs = await listRuns(docId);
    const filtered = runs
      .filter((item) => item.segment_id === normalizedSegmentId)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async function saveRun(docId, run) {
    const normalized = normalizeRun(run);
    if (!normalized.run_id || !normalized.segment_id) {
      throw new Error("run_id and segment_id are required");
    }
    const current = await ensureResearchFile(docId);
    const runs = Array.isArray(current.runs) ? [...current.runs] : [];
    const index = runs.findIndex((item) => String(item?.run_id ?? "") === normalized.run_id);
    if (index >= 0) {
      runs[index] = normalized;
    } else {
      runs.push(normalized);
    }
    await writeJson(getResearchFilePath(docId), {
      version: 1,
      runs
    });
    if (typeof onRunsChanged === "function") {
      await onRunsChanged(docId, runs.map((item) => normalizeRun(item)), { reason: "save_run", run_id: normalized.run_id });
    }
    return normalized;
  }

  async function markApplied(docId, runId, appliedInput = {}) {
    const normalizedRunId = String(runId ?? "").trim();
    if (!normalizedRunId) return null;
    const current = await ensureResearchFile(docId);
    const runs = Array.isArray(current.runs) ? [...current.runs] : [];
    const index = runs.findIndex((item) => String(item?.run_id ?? "") === normalizedRunId);
    if (index < 0) return null;
    const nextApplied = {
      result_id: String(appliedInput.result_id ?? "").trim(),
      action: String(appliedInput.action ?? "").trim(),
      asset_id: String(appliedInput.asset_id ?? "").trim() || null,
      applied_at: String(appliedInput.applied_at ?? new Date().toISOString()),
      meta: appliedInput.meta && typeof appliedInput.meta === "object" ? appliedInput.meta : {}
    };
    const existing = normalizeRun(runs[index]);
    runs[index] = {
      ...existing,
      applied: [...existing.applied, nextApplied],
      updated_at: nextApplied.applied_at
    };
    await writeJson(getResearchFilePath(docId), {
      version: 1,
      runs
    });
    if (typeof onRunsChanged === "function") {
      await onRunsChanged(docId, runs.map((item) => normalizeRun(item)), { reason: "mark_applied", run_id: normalizedRunId });
    }
    return runs[index];
  }

  return {
    ensureResearchFile,
    listRuns,
    listRunsForSegment,
    getRunById,
    getLatestRun,
    saveRun,
    markApplied
  };
}
