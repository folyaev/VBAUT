function normalizeMediaFilePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").trim();
  return normalized || null;
}

function normalizeMediaFilePathList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeMediaFilePath(item)).filter(Boolean);
}

export function hasVisualDecisionContent(decision) {
  if (!decision) return false;
  if (decision.description) return true;
  if (decision.format_hint) return true;
  if (decision.priority) return true;
  if (decision.duration_hint_sec !== null && decision.duration_hint_sec !== undefined) return true;
  if (normalizeMediaFilePath(decision.media_file_path ?? null)) return true;
  if (normalizeMediaFilePathList(decision.media_file_paths).length > 0) return true;
  return decision.type && decision.type !== "no_visual";
}

export function hasSearchDecisionContent(decision) {
  if (!decision) return false;
  if (Array.isArray(decision.keywords) && decision.keywords.length > 0) return true;
  if (Array.isArray(decision.queries) && decision.queries.length > 0) return true;
  return false;
}

export function inferResearchCandidateRole(segment, ranked = {}) {
  const sourceScore = Number(ranked?.source_score ?? 0);
  const visualScore = Number(ranked?.visual_score ?? 0);
  const montageScore = Number(ranked?.montage_score ?? 0);
  const totalScore = Number(ranked?.total_score ?? 0);
  const hints = (Array.isArray(ranked?.visual_hints) ? ranked.visual_hints : []).map((item) =>
    String(item ?? "").trim().toLowerCase()
  );
  const hasVisual = hasVisualDecisionContent(segment?.visual_decision);
  const hasSearch = hasSearchDecisionContent(segment?.search_decision);
  const visualCandidate =
    hints.some((item) => ["video", "image", "screenshot", "downloadable"].includes(item)) ||
    visualScore >= 0.68 ||
    montageScore >= 0.68;

  if (visualCandidate && (!hasVisual || visualScore >= sourceScore + 0.08)) return "visual_candidate";
  if (!hasSearch && (sourceScore >= 0.64 || totalScore >= 0.8)) return "main_source";
  if (sourceScore >= 0.56) return hasSearch ? "backup_source" : "main_source";
  if (visualCandidate) return "visual_candidate";
  return "reference";
}

export function formatResearchCandidateRoleLabel(value) {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    main_source: "Source",
    backup_source: "Source",
    visual_candidate: "Visual",
    reference: "Reference"
  };
  return labels[key] ?? (key || "Candidate");
}

export function collectResearchMemoryBadges(ranked = {}) {
  const helpfulCount = Number(
    Array.isArray(ranked?.reason_tags)
      ? String(
          ranked.reason_tags.find((tag) => String(tag ?? "").trim().toLowerCase().startsWith("helpful:")) ?? ""
        ).split(":")[1]
      : 0
  );
  const usageCount = Number(ranked?.memory_usage_count ?? 0);
  const badges = [];
  if (helpfulCount > 0) {
    badges.push(helpfulCount > 1 ? `Helpful x${helpfulCount}` : "Helpful before");
  }
  if (usageCount > 0) {
    badges.push(usageCount > 1 ? `Used x${usageCount}` : "Used before");
  }
  return badges;
}

export function formatResearchReasonTagLabel(tag) {
  const normalized = String(tag ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ru_blocked") return "RU blocked";
  if (normalized === "responsive") return "Responsive";
  if (normalized === "watermarks") return "Watermarks";
  if (normalized === "dismissed_before") return "Dismissed before";
  if (normalized === "duplicate_story") return "Repeat story";
  if (normalized === "bad_visual_history") return "Weak visual history";
  if (normalized === "screenshot_fail_risk") return "Screenshot risk";
  if (normalized === "download_fail_risk") return "Download risk";
  if (normalized === "paywall_prone") return "Paywall prone";
  if (normalized === "anti_bot_prone") return "Anti-bot prone";
  if (normalized === "age_gate_prone") return "Age-gate prone";
  if (normalized.startsWith("story_cluster:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Story dupes x${value}` : "Story dupes";
  }
  if (normalized.startsWith("quality:")) return String(tag).split(":")[1] || "";
  if (normalized.startsWith("lang:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Lang ${value.toUpperCase()}` : "";
  }
  if (normalized === "high_similarity") return "High similarity";
  if (normalized.startsWith("similar_segments:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Similar x${value}` : "";
  }
  if (normalized.startsWith("search_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Search x${value}` : "";
  }
  if (normalized.startsWith("topic_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Topic x${value}` : "";
  }
  if (normalized.startsWith("visual_match:")) {
    const value = String(tag).split(":")[1] || "";
    return value ? `Visual x${value}` : "";
  }
  return String(tag ?? "").trim().replace(/_/g, " ");
}

export function getVisibleResearchReasonTags(ranked = {}) {
  return (Array.isArray(ranked?.reason_tags) ? ranked.reason_tags : [])
    .filter((tag) => {
      const normalized = String(tag ?? "").trim().toLowerCase();
      return normalized && !normalized.startsWith("helpful:") && !normalized.startsWith("used_before:");
    })
    .map(formatResearchReasonTagLabel)
    .filter(Boolean);
}
