import { canonicalizeLinkUrl } from "./links.js";

function compactText(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDomain(input) {
  return compactText(input).toLowerCase().replace(/^www\./i, "").replace(/^m\./i, "");
}

function normalizeTitle(input) {
  return compactText(input)
    .replace(/\s+[|\-–—]\s+[^|\-–—]{2,80}$/u, "")
    .replace(/[“”"'`]+/g, "")
    .toLowerCase();
}

const STOPWORDS = new Set([
  "about", "after", "against", "amid", "and", "are", "but", "for", "from", "have", "into", "more", "news", "says",
  "that", "than", "the", "their", "this", "with", "what", "when", "where", "which", "will", "video",
  "это", "как", "или", "при", "что", "после", "среди", "новости", "видео", "фото", "подкаст"
]);

function tokenize(input) {
  return [...new Set(
    normalizeTitle(input)
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4 && !STOPWORDS.has(item))
      .slice(0, 14)
  )];
}

function buildTitleFingerprint(result = {}) {
  return tokenize(result?.title).slice(0, 8);
}

function buildUrlStem(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.pathname
      .toLowerCase()
      .replace(/\/+/g, "/")
      .replace(/\/(?:amp|live|video|videos)\b/g, "")
      .replace(/\/$/, "");
  } catch {
    return "";
  }
}

function extractVideoId(url = "") {
  const normalized = compactText(url);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const hostname = normalizeDomain(parsed.hostname);
    if (hostname === "youtu.be") return compactText(parsed.pathname).replace(/^\//, "");
    if (hostname.endsWith("youtube.com")) return compactText(parsed.searchParams.get("v"));
    if (hostname.endsWith("vimeo.com")) return compactText(parsed.pathname).split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
  return "";
}

function tokenOverlap(left = [], right = []) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const shared = left.filter((item) => rightSet.has(item)).length;
  return shared / Math.max(left.length, right.length, 1);
}

function buildCandidate(item = {}, ranked = {}) {
  const url = compactText(item?.url);
  return {
    result: item,
    ranked,
    canonicalUrl: canonicalizeLinkUrl(url),
    domain: normalizeDomain(item?.domain),
    titleFingerprint: buildTitleFingerprint(item),
    urlStem: buildUrlStem(url),
    videoId: extractVideoId(url)
  };
}

function isStoryDuplicate(left, right) {
  if (!left || !right) return false;
  if (left.canonicalUrl && right.canonicalUrl && left.canonicalUrl === right.canonicalUrl) return true;
  if (left.videoId && right.videoId && left.videoId === right.videoId) return true;
  if (left.urlStem && right.urlStem && left.domain === right.domain && left.urlStem === right.urlStem) return true;
  const overlap = tokenOverlap(left.titleFingerprint, right.titleFingerprint);
  if (overlap >= 0.72 && left.titleFingerprint.length >= 4 && right.titleFingerprint.length >= 4) return true;
  if (overlap >= 0.58 && left.domain === right.domain && left.titleFingerprint.length >= 4 && right.titleFingerprint.length >= 4) {
    return true;
  }
  return false;
}

function compareCandidates(left, right) {
  return (
    Number(right?.ranked?.total_score ?? 0) - Number(left?.ranked?.total_score ?? 0) ||
    Number(right?.ranked?.source_score ?? 0) - Number(left?.ranked?.source_score ?? 0) ||
    Number(right?.ranked?.montage_score ?? right?.ranked?.visual_score ?? 0) -
      Number(left?.ranked?.montage_score ?? left?.ranked?.visual_score ?? 0) ||
    compactText(right?.result?.title).length - compactText(left?.result?.title).length
  );
}

export function dedupeRankedResearchResultsByStory(results = [], rankedResults = []) {
  const rankedMap = new Map(
    (Array.isArray(rankedResults) ? rankedResults : [])
      .map((item) => [String(item?.result_id ?? "").trim(), item])
      .filter(([id]) => Boolean(id))
  );
  const candidates = (Array.isArray(results) ? results : [])
    .map((item) => buildCandidate(item, rankedMap.get(String(item?.id ?? "").trim()) ?? null))
    .filter((item) => item.result && item.ranked)
    .sort(compareCandidates);

  const kept = [];
  const clusters = [];
  candidates.forEach((candidate) => {
    const existing = kept.find((item) => isStoryDuplicate(item, candidate));
    if (!existing) {
      kept.push(candidate);
      clusters.push({ leader_id: String(candidate.result?.id ?? "").trim(), duplicate_ids: [] });
      return;
    }
    const cluster = clusters.find((item) => item.leader_id === String(existing.result?.id ?? "").trim());
    if (cluster) cluster.duplicate_ids.push(String(candidate.result?.id ?? "").trim());
  });

  const clusterMap = new Map();
  clusters.forEach((cluster) => {
    const total = 1 + cluster.duplicate_ids.length;
    if (total <= 1) return;
    clusterMap.set(cluster.leader_id, {
      cluster_size: total,
      duplicate_ids: cluster.duplicate_ids
    });
  });

  const keptIdSet = new Set(kept.map((item) => String(item.result?.id ?? "").trim()));
  const dedupedResults = (Array.isArray(results) ? results : []).filter((item) => keptIdSet.has(String(item?.id ?? "").trim()));
  const dedupedRankedResults = (Array.isArray(rankedResults) ? rankedResults : [])
    .filter((item) => keptIdSet.has(String(item?.result_id ?? "").trim()))
    .map((item) => {
      const cluster = clusterMap.get(String(item?.result_id ?? "").trim());
      if (!cluster) return item;
      return {
        ...item,
        story_cluster_size: cluster.cluster_size,
        story_duplicate_ids: cluster.duplicate_ids,
        reason_tags: [
          ...(Array.isArray(item?.reason_tags) ? item.reason_tags : []),
          `story_cluster:${cluster.cluster_size}`
        ]
      };
    });

  return {
    results: dedupedResults,
    ranked_results: dedupedRankedResults,
    removed_count: Math.max(0, candidates.length - kept.length),
    cluster_count: clusterMap.size
  };
}
