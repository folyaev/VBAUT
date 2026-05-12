function isLinksSegment(segment) {
  return String(segment?.block_type ?? "").trim().toLowerCase() === "links";
}

function isCommentsSegment(segment) {
  return /^comments_/i.test(String(segment?.segment_id ?? "").trim());
}

function normalizeTextForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForMatch(value) {
  const normalized = normalizeTextForMatch(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function buildDecisionMap(decisions = []) {
  return new Map(
    (Array.isArray(decisions) ? decisions : [])
      .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
      .filter(([segmentId]) => Boolean(segmentId))
  );
}

function compareStringLists(left = [], right = []) {
  const a = Array.isArray(left) ? left.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const b = Array.isArray(right) ? right.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function countTokenIntersection(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) return 0;
  const left = new Set(tokensA);
  let intersection = 0;
  for (const token of new Set(tokensB)) {
    if (left.has(token)) intersection += 1;
  }
  return intersection;
}

function jaccardSimilarity(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) return 0;
  const left = new Set(tokensA);
  const right = new Set(tokensB);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function createEmptyIntegrityReport() {
  return {
    applied: false,
    snapshot_items: 0,
    matched_items: 0,
    unresolved_items: 0,
    unresolved_segment_ids: [],
    restored: {
      is_done: 0,
      visual_description: 0,
      media: 0,
      comments: 0,
      links: 0
    },
    moved: {
      visual_description: 0,
      media: 0
    }
  };
}

export function createDocumentIntegrityUtils(deps = {}) {
  const {
    normalizeDecisionsInput,
    normalizeSearchDecisionInput,
    normalizeSegmentsInput,
    normalizeVisualDecisionInput
  } = deps;

  function buildDocumentIntegritySnapshot(segments = [], decisions = []) {
    const decisionMap = buildDecisionMap(decisions);
    const items = (Array.isArray(segments) ? segments : [])
      .filter((segment) => !isLinksSegment(segment) && !isCommentsSegment(segment))
      .map((segment) => {
        const segmentId = String(segment?.segment_id ?? "").trim();
        const visual = normalizeVisualDecisionInput(decisionMap.get(segmentId)?.visual_decision);
        const mediaPaths = Array.isArray(visual?.media_file_paths)
          ? visual.media_file_paths.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [];
        const visualDescription = String(visual?.description ?? "").trim();
        const hasState = Boolean(segment?.is_done) || Boolean(visualDescription) || mediaPaths.length > 0;
        if (!hasState) return null;
        return {
          segment_id: segmentId,
          block_type: String(segment?.block_type ?? "").trim().toLowerCase() || "news",
          section_title: String(segment?.section_title ?? "").trim(),
          section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null,
          text_quote: String(segment?.text_quote ?? "").trim(),
          normalized_quote: normalizeTextForMatch(segment?.text_quote ?? ""),
          tokens: tokenizeForMatch(segment?.text_quote ?? ""),
          state: {
            is_done: Boolean(segment?.is_done),
            visual_description: visualDescription,
            description_meta: visual?.description_meta ?? null,
            media_file_paths: mediaPaths,
            media_file_timecodes:
              visual?.media_file_timecodes && typeof visual.media_file_timecodes === "object"
                ? { ...visual.media_file_timecodes }
                : {},
            media_start_timecode: visual?.media_start_timecode ?? null,
            media_meta: visual?.media_meta ?? null
          }
        };
      })
      .filter(Boolean);

    return {
      item_count: items.length,
      items
    };
  }

  function scoreSnapshotMatch(snapshotItem, segment) {
    if (!snapshotItem || !segment || isLinksSegment(segment) || isCommentsSegment(segment)) {
      return Number.NEGATIVE_INFINITY;
    }
    const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
    if (blockType !== snapshotItem.block_type) return Number.NEGATIVE_INFINITY;

    const segmentId = String(segment?.segment_id ?? "").trim();
    const sectionTitle = String(segment?.section_title ?? "").trim();
    const sectionIndex = Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null;
    const normalizedQuote = normalizeTextForMatch(segment?.text_quote ?? "");
    const tokens = tokenizeForMatch(segment?.text_quote ?? "");
    const sameSection = sectionTitle && snapshotItem.section_title
      ? sectionTitle.toLowerCase() === snapshotItem.section_title.toLowerCase()
      : false;
    const sameIndex = snapshotItem.section_index != null && sectionIndex != null && snapshotItem.section_index === sectionIndex;
    const sameSegmentId = segmentId && segmentId === snapshotItem.segment_id;
    const exactQuote = normalizedQuote && snapshotItem.normalized_quote && normalizedQuote === snapshotItem.normalized_quote;
    const overlap = countTokenIntersection(snapshotItem.tokens, tokens);
    const jaccard = jaccardSimilarity(snapshotItem.tokens, tokens);

    if (exactQuote && sameSection) return 130 + (sameSegmentId ? 5 : 0);
    if (exactQuote) return 118 + (sameSegmentId ? 5 : 0) + (sameIndex ? 2 : 0);
    if (sameSection && overlap >= 4 && jaccard >= 0.52) return 104 + Math.round(jaccard * 10);
    if (sameSection && overlap >= 3 && jaccard >= 0.4) return 96 + Math.round(jaccard * 10);
    if (sameSegmentId && overlap >= 2 && jaccard >= 0.26) return 88 + Math.round(jaccard * 10);
    if (sameSection && sameIndex && overlap >= 2 && jaccard >= 0.22) return 84 + Math.round(jaccard * 10);
    if (overlap >= 5 && jaccard >= 0.68) return 82 + Math.round(jaccard * 10);
    if (sameSection && overlap >= 2 && snapshotItem.tokens.length <= 5 && tokens.length <= 5 && jaccard >= 0.5) {
      return 80 + Math.round(jaccard * 10);
    }
    return Number.NEGATIVE_INFINITY;
  }

  function matchIntegritySnapshotItems(snapshotItems = [], segments = []) {
    const candidateSegments = (Array.isArray(segments) ? segments : []).filter(
      (segment) => !isLinksSegment(segment) && !isCommentsSegment(segment)
    );
    const candidates = [];

    snapshotItems.forEach((snapshotItem, snapshotIndex) => {
      candidateSegments.forEach((segment, segmentIndex) => {
        const score = scoreSnapshotMatch(snapshotItem, segment);
        if (!Number.isFinite(score) || score < 80) return;
        candidates.push({
          snapshotIndex,
          segmentIndex,
          score
        });
      });
    });

    candidates.sort((left, right) => right.score - left.score);
    const usedSnapshotIndexes = new Set();
    const usedSegmentIndexes = new Set();
    const matched = [];

    candidates.forEach((candidate) => {
      if (usedSnapshotIndexes.has(candidate.snapshotIndex) || usedSegmentIndexes.has(candidate.segmentIndex)) return;
      usedSnapshotIndexes.add(candidate.snapshotIndex);
      usedSegmentIndexes.add(candidate.segmentIndex);
      matched.push({
        snapshot: snapshotItems[candidate.snapshotIndex],
        segment: candidateSegments[candidate.segmentIndex],
        score: candidate.score
      });
    });

    return {
      matched,
      unresolved: snapshotItems.filter((_, index) => !usedSnapshotIndexes.has(index))
    };
  }

  function findDescriptionOwners(decisions, description, excludedSegmentId) {
    const normalizedDescription = String(description ?? "").trim();
    if (!normalizedDescription) return [];
    return (Array.isArray(decisions) ? decisions : [])
      .filter((decision) => String(decision?.segment_id ?? "").trim() !== excludedSegmentId)
      .filter((decision) => String(decision?.visual_decision?.description ?? "").trim() === normalizedDescription);
  }

  function findMediaOwners(decisions, mediaPaths = [], excludedSegmentId) {
    if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) return [];
    return (Array.isArray(decisions) ? decisions : [])
      .filter((decision) => String(decision?.segment_id ?? "").trim() !== excludedSegmentId)
      .filter((decision) =>
        compareStringLists(
          normalizeVisualDecisionInput(decision?.visual_decision)?.media_file_paths ?? [],
          mediaPaths
        )
      );
  }

  function buildNormalizedDecision(decision = null, segmentId = "") {
    return {
      segment_id: segmentId,
      visual_decision: normalizeVisualDecisionInput(decision?.visual_decision),
      search_decision: normalizeSearchDecisionInput(decision?.search_decision),
      search_decision_en: normalizeSearchDecisionInput(decision?.search_decision_en),
      research_sources: Array.isArray(decision?.research_sources) ? decision.research_sources : [],
      research_dismissed_urls: Array.isArray(decision?.research_dismissed_urls) ? decision.research_dismissed_urls : [],
      research_bundle_trace: decision?.research_bundle_trace ?? null,
      version: Number(decision?.version ?? 1)
    };
  }

  function applyDocumentIntegritySnapshot({ snapshot = null, segments = [], decisions = [] } = {}) {
    const report = createEmptyIntegrityReport();
    const snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
    report.snapshot_items = snapshotItems.length;
    if (snapshotItems.length === 0) {
      return {
        segments: normalizeSegmentsInput(Array.isArray(segments) ? segments : []),
        decisions: normalizeDecisionsInput(Array.isArray(decisions) ? decisions : []),
        report
      };
    }

    const nextSegments = normalizeSegmentsInput(Array.isArray(segments) ? segments : []).map((segment) => ({ ...segment }));
    const nextDecisions = normalizeDecisionsInput(Array.isArray(decisions) ? decisions : []).map((decision) => ({
      ...decision,
      visual_decision: normalizeVisualDecisionInput(decision?.visual_decision)
    }));
    const decisionIndexBySegmentId = new Map(
      nextDecisions.map((decision, index) => [String(decision?.segment_id ?? "").trim(), index]).filter(([id]) => Boolean(id))
    );

    const { matched, unresolved } = matchIntegritySnapshotItems(snapshotItems, nextSegments);
    report.matched_items = matched.length;
    report.unresolved_items = unresolved.length;
    report.unresolved_segment_ids = unresolved.map((item) => String(item?.segment_id ?? "").trim()).filter(Boolean).slice(0, 12);

    matched.forEach(({ snapshot: snapshotItem, segment }) => {
      const targetSegmentId = String(segment?.segment_id ?? "").trim();
      const segmentIndex = nextSegments.findIndex((item) => String(item?.segment_id ?? "").trim() === targetSegmentId);
      if (segmentIndex < 0) return;
      const decisionIndex = decisionIndexBySegmentId.get(targetSegmentId);
      const currentDecision = decisionIndex != null
        ? nextDecisions[decisionIndex]
        : buildNormalizedDecision(null, targetSegmentId);
      const nextDecision = buildNormalizedDecision(currentDecision, targetSegmentId);
      const snapshotState = snapshotItem?.state ?? {};
      const currentVisual = normalizeVisualDecisionInput(nextDecision.visual_decision);

      if (snapshotState.is_done && !nextSegments[segmentIndex].is_done) {
        nextSegments[segmentIndex] = {
          ...nextSegments[segmentIndex],
          is_done: true
        };
        report.restored.is_done += 1;
      }

      const snapshotDescription = String(snapshotState.visual_description ?? "").trim();
      const currentDescription = String(currentVisual?.description ?? "").trim();
      if (snapshotDescription && currentDescription !== snapshotDescription) {
        const descriptionOwners = findDescriptionOwners(nextDecisions, snapshotDescription, targetSegmentId);
        if (!currentDescription && descriptionOwners.length === 1) {
          const ownerIndex = nextDecisions.findIndex(
            (decision) => String(decision?.segment_id ?? "").trim() === String(descriptionOwners[0]?.segment_id ?? "").trim()
          );
          if (ownerIndex >= 0) {
            const ownerVisual = normalizeVisualDecisionInput(nextDecisions[ownerIndex]?.visual_decision);
            nextDecisions[ownerIndex] = {
              ...nextDecisions[ownerIndex],
              visual_decision: normalizeVisualDecisionInput({
                ...ownerVisual,
                description: "",
                description_meta: null
              })
            };
            report.moved.visual_description += 1;
          }
        }
        nextDecision.visual_decision = normalizeVisualDecisionInput({
          ...currentVisual,
          description: snapshotDescription,
          description_meta: snapshotState.description_meta ?? currentVisual.description_meta ?? null
        });
        report.restored.visual_description += 1;
      }

      const snapshotMediaPaths = Array.isArray(snapshotState.media_file_paths)
        ? snapshotState.media_file_paths.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [];
      const currentMediaPaths = Array.isArray(currentVisual?.media_file_paths)
        ? currentVisual.media_file_paths.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [];
      if (snapshotMediaPaths.length > 0 && !compareStringLists(currentMediaPaths, snapshotMediaPaths)) {
        const mediaOwners = findMediaOwners(nextDecisions, snapshotMediaPaths, targetSegmentId);
        if (currentMediaPaths.length === 0 && mediaOwners.length === 1) {
          const ownerIndex = nextDecisions.findIndex(
            (decision) => String(decision?.segment_id ?? "").trim() === String(mediaOwners[0]?.segment_id ?? "").trim()
          );
          if (ownerIndex >= 0) {
            const ownerVisual = normalizeVisualDecisionInput(nextDecisions[ownerIndex]?.visual_decision);
            nextDecisions[ownerIndex] = {
              ...nextDecisions[ownerIndex],
              visual_decision: normalizeVisualDecisionInput({
                ...ownerVisual,
                media_file_paths: [],
                media_file_path: null,
                media_file_timecodes: {},
                media_start_timecode: null,
                media_meta: null
              })
            };
            report.moved.media += 1;
          }
        }
        nextDecision.visual_decision = normalizeVisualDecisionInput({
          ...normalizeVisualDecisionInput(nextDecision.visual_decision),
          media_file_paths: snapshotMediaPaths,
          media_file_path: snapshotMediaPaths[0] ?? null,
          media_file_timecodes:
            snapshotState.media_file_timecodes && typeof snapshotState.media_file_timecodes === "object"
              ? { ...snapshotState.media_file_timecodes }
              : {},
          media_start_timecode: snapshotState.media_start_timecode ?? null,
          media_meta: snapshotState.media_meta ?? currentVisual.media_meta ?? null
        });
        report.restored.media += 1;
      }

      if (decisionIndex != null) {
        nextDecisions[decisionIndex] = nextDecision;
      } else {
        nextDecisions.push(nextDecision);
        decisionIndexBySegmentId.set(targetSegmentId, nextDecisions.length - 1);
      }
    });

    report.applied =
      report.restored.is_done > 0 ||
      report.restored.visual_description > 0 ||
      report.restored.media > 0 ||
      report.moved.visual_description > 0 ||
      report.moved.media > 0;

    return {
      segments: normalizeSegmentsInput(nextSegments),
      decisions: normalizeDecisionsInput(nextDecisions),
      report
    };
  }

  return {
    applyDocumentIntegritySnapshot,
    buildDocumentIntegritySnapshot
  };
}
