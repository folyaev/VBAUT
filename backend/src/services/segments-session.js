export function createSegmentsSessionUtils(deps) {
  const {
    normalizeLinksInput,
    normalizeSearchDecisionInput,
    normalizeVisualDecisionInput
  } = deps;

  function splitSegmentsAndDecisions(segments, decisionsOverride = null) {
    const segmentsData = segments.map((segment) => ({
      segment_id: segment.segment_id,
      block_type: segment.block_type,
      text_quote: segment.text_quote,
      section_id: segment.section_id ?? null,
      section_title: segment.section_title ?? null,
      section_index: segment.section_index ?? null,
      links: normalizeLinksInput(segment.links),
      segment_status: segment.segment_status ?? null,
      is_done: Boolean(segment.is_done),
      version: 1
    }));
    const decisionsSource = Array.isArray(decisionsOverride) ? decisionsOverride : segments;
    const decisionsData = decisionsSource.map((segment) => ({
      segment_id: segment.segment_id,
      visual_decision: normalizeVisualDecisionInput(segment.visual_decision),
      search_decision: normalizeSearchDecisionInput(segment.search_decision),
      search_decision_en: normalizeSearchDecisionInput(segment.search_decision_en),
      version: 1
    }));
    return { segmentsData, decisionsData };
  }

  return {
    splitSegmentsAndDecisions
  };
}
