export function normalizeSegmentTagList(value, limit = 12) {
  return [...new Set(
    (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item ?? "").split(/[\n,;|]+/))
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  )].slice(0, limit);
}

export function normalizeSegmentResearchContextSettings(segment = {}) {
  return {
    research_use_topic_title: Boolean(segment?.research_use_topic_title),
    research_use_theme_tags: Boolean(segment?.research_use_theme_tags)
  };
}

export function normalizeResearchSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const normalized = {
        url: String(entry.url ?? "").trim(),
        title: String(entry.title ?? "").trim(),
        domain: String(entry.domain ?? "").trim(),
        snippet: String(entry.snippet ?? "").trim(),
        applied_at: String(entry.applied_at ?? "").trim(),
        role: String(entry.role ?? "").trim(),
        attachment_role: String(entry.attachment_role ?? "").trim(),
        asset_id: String(entry.asset_id ?? "").trim(),
        reason: String(entry.reason ?? "").trim(),
        scores: entry.scores && typeof entry.scores === "object" ? { ...entry.scores } : null
      };
      return normalized.url || normalized.title || normalized.domain ? normalized : null;
    })
    .filter(Boolean);
}

export function normalizeResearchDismissedUrls(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => {
      const normalized =
        entry && typeof entry === "object"
          ? {
              url: String(entry.url ?? "").trim(),
              title: String(entry.title ?? "").trim(),
              domain: String(entry.domain ?? "").trim(),
              dismissed_at: String(entry.dismissed_at ?? "").trim(),
              source: String(entry.source ?? "").trim()
            }
          : {
              url: String(entry ?? "").trim(),
              title: "",
              domain: "",
              dismissed_at: "",
              source: ""
            };
      if (!normalized.url || seen.has(normalized.url)) return null;
      seen.add(normalized.url);
      return normalized;
    })
    .filter(Boolean);
}

export function normalizeResearchBundleTrace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalizePick = (pick) => {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) return null;
    const normalized = {
      result_id: String(pick.result_id ?? "").trim(),
      title: String(pick.title ?? "").trim(),
      domain: String(pick.domain ?? "").trim(),
      url: String(pick.url ?? "").trim(),
      role: String(pick.role ?? "").trim(),
      asset_id: String(pick.asset_id ?? "").trim(),
      attachment_id: String(pick.attachment_id ?? "").trim()
    };
    return normalized.result_id || normalized.title || normalized.url ? normalized : null;
  };
  const normalized = {
    run_id: String(value.run_id ?? "").trim(),
    source_result_id: String(value.source_result_id ?? "").trim(),
    visual_result_id: String(value.visual_result_id ?? "").trim(),
    applied_at: String(value.applied_at ?? "").trim(),
    source: normalizePick(value.source),
    visual: normalizePick(value.visual)
  };
  return normalized.run_id || normalized.source || normalized.visual ? normalized : null;
}
