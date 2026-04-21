import { normalizeLinkUrl } from "./links.js";

export function unwrapSegmentsPayload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.segments)) return value.segments;
  return [];
}

export function pickWritableSegments(fileSegments, fallbackSegments) {
  if (Array.isArray(fileSegments) || Array.isArray(fileSegments?.segments)) {
    return unwrapSegmentsPayload(fileSegments);
  }
  return unwrapSegmentsPayload(fallbackSegments);
}

export function collectLinkStats(segments = []) {
  const list = unwrapSegmentsPayload(segments);
  const linkBlocks = list.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links");
  return {
    segment_count: list.length,
    link_block_count: linkBlocks.length,
    total_links: linkBlocks.reduce(
      (sum, segment) => sum + (Array.isArray(segment?.links) ? segment.links.length : 0),
      0
    )
  };
}

export function collectHistoricalLinkSections(versionEntries = [], activeSegments = []) {
  const segments = unwrapSegmentsPayload(activeSegments);
  const sectionMetaById = new Map();
  for (const segment of segments) {
    if (String(segment?.block_type ?? "").trim().toLowerCase() === "links") continue;
    const sectionId = String(segment?.section_id ?? "").trim();
    if (!sectionId || sectionMetaById.has(sectionId)) continue;
    sectionMetaById.set(sectionId, {
      section_id: sectionId,
      section_title: String(segment?.section_title ?? "").trim(),
      section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null
    });
  }

  const sections = new Map();
  for (const entry of versionEntries) {
    const version = Number(entry?.version ?? 0);
    const versionSegments = unwrapSegmentsPayload(entry?.segments);
    for (const segment of versionSegments) {
      if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") continue;
      const sectionId = String(segment?.section_id ?? "").trim();
      if (!sectionId || !sectionMetaById.has(sectionId)) continue;
      let bucket = sections.get(sectionId);
      if (!bucket) {
        const meta = sectionMetaById.get(sectionId);
        bucket = {
          section_id: sectionId,
          section_title: meta?.section_title ?? String(segment?.section_title ?? "").trim(),
          section_index: meta?.section_index ?? null,
          segment_id: String(segment?.segment_id ?? `links_${sectionId}`).trim() || `links_${sectionId}`,
          links: [],
          urls: new Map()
        };
        sections.set(sectionId, bucket);
      }
      const items = Array.isArray(segment?.links) ? segment.links : [];
      for (const item of items) {
        const normalizedUrl = normalizeLinkUrl(item?.url ?? item?.raw ?? item);
        if (!normalizedUrl) continue;
        const existing = bucket.urls.get(normalizedUrl);
        if (existing) {
          existing.last_version = Math.max(existing.last_version, version || existing.last_version);
          continue;
        }
        const record = {
          url: normalizedUrl,
          raw: String(item?.raw ?? normalizedUrl).trim() || normalizedUrl,
          first_version: version || 0,
          last_version: version || 0
        };
        bucket.urls.set(normalizedUrl, record);
        bucket.links.push(record);
      }
    }
  }

  return Array.from(sections.values())
    .map((section) => ({
      section_id: section.section_id,
      section_title: section.section_title,
      section_index: section.section_index,
      segment_id: section.segment_id,
      links: section.links
        .slice()
        .sort((left, right) => left.first_version - right.first_version || left.url.localeCompare(right.url))
    }))
    .filter((section) => section.links.length > 0)
    .sort((left, right) => {
      const leftIndex = Number.isFinite(left.section_index) ? left.section_index : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isFinite(right.section_index) ? right.section_index : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.section_title.localeCompare(right.section_title, "ru");
    });
}

export function analyzeHistoricalLinkDrift(currentSegments = [], historicalSections = []) {
  const currentList = unwrapSegmentsPayload(currentSegments);
  const currentLinksBySection = new Map();
  for (const segment of currentList) {
    if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") continue;
    const sectionId = String(segment?.section_id ?? "").trim();
    if (!sectionId) continue;
    const urls = new Set();
    for (const item of Array.isArray(segment?.links) ? segment.links : []) {
      const normalizedUrl = normalizeLinkUrl(item?.url ?? item?.raw ?? item);
      if (normalizedUrl) urls.add(normalizedUrl);
    }
    currentLinksBySection.set(sectionId, {
      segment_id: String(segment?.segment_id ?? "").trim(),
      section_title: String(segment?.section_title ?? "").trim(),
      urls
    });
  }

  const sectionsMissingLinkBlocks = [];
  const sectionsWithMissingUrls = [];
  let historicalTotalUniqueLinks = 0;
  let currentTotalLinksAcrossHistoricalSections = 0;

  for (const section of historicalSections) {
    const historicalUrls = new Set(
      (Array.isArray(section?.links) ? section.links : [])
        .map((item) => normalizeLinkUrl(item?.url ?? item?.raw ?? item))
        .filter(Boolean)
    );
    historicalTotalUniqueLinks += historicalUrls.size;
    const current = currentLinksBySection.get(String(section?.section_id ?? "").trim());
    const currentUrls = current?.urls ?? new Set();
    currentTotalLinksAcrossHistoricalSections += currentUrls.size;
    const missingUrls = Array.from(historicalUrls).filter((url) => !currentUrls.has(url));
    if (!current) {
      sectionsMissingLinkBlocks.push({
        section_id: section.section_id,
        section_title: section.section_title,
        historical_url_count: historicalUrls.size
      });
      continue;
    }
    if (missingUrls.length > 0) {
      sectionsWithMissingUrls.push({
        section_id: section.section_id,
        section_title: section.section_title,
        segment_id: current.segment_id || section.segment_id,
        current_url_count: currentUrls.size,
        historical_url_count: historicalUrls.size,
        missing_urls: missingUrls
      });
    }
  }

  const currentStats = collectLinkStats(currentList);
  return {
    current: currentStats,
    historical: {
      section_count: historicalSections.length,
      total_unique_links: historicalTotalUniqueLinks
    },
    sections_missing_link_blocks: sectionsMissingLinkBlocks,
    sections_with_missing_urls: sectionsWithMissingUrls,
    current_total_links_across_historical_sections: currentTotalLinksAcrossHistoricalSections,
    suspicious:
      sectionsMissingLinkBlocks.length > 0 ||
      sectionsWithMissingUrls.length > 0 ||
      currentTotalLinksAcrossHistoricalSections < historicalTotalUniqueLinks
  };
}
