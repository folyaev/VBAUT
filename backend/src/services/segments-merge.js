export function createSegmentsMergeUtils(deps) {
  const {
    emptySearchDecision,
    emptyVisualDecision,
    normalizeLinksInput,
    normalizeSearchDecisionInput,
    normalizeVisualDecisionInput
  } = deps;

  function normalizeTextForMatch(text) {
    return String(text ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSectionTitleForMatch(title) {
    const cleaned = String(title ?? "")
      .replace(/^#{1,}\s*/g, " ")
      .replace(/\(\s*\d+\s*\)\s*$/g, " ")
      .replace(/[«»"“”'`]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalizeTextForMatch(cleaned);
  }

  function getSectionMatchKey(segment) {
    const title = normalizeSectionTitleForMatch(segment?.section_title ?? "");
    if (title) return `title:${title}`;
    const rawId = String(segment?.section_id ?? "").trim().toLowerCase();
    if (!rawId) return "";
    if (/^section_\d+$/i.test(rawId)) return "";
    return `id:${rawId}`;
  }

  function getLinkSegmentKey(segment, fallbackIndex = 0) {
    const title = normalizeSectionTitleForMatch(segment?.section_title ?? "");
    if (title) return `title:${title}`;
    const sectionId = String(segment?.section_id ?? "").trim().toLowerCase();
    if (sectionId && !/^section_\d+$/i.test(sectionId)) return `id:${sectionId}`;
    if (sectionId) return `legacy:${sectionId}`;
    const segmentId = String(segment?.segment_id ?? "").trim().toLowerCase();
    if (segmentId) return `segment:${segmentId}`;
    return `idx:${fallbackIndex}`;
  }

  function normalizeLinkSegmentsInput(raw) {
    if (!Array.isArray(raw)) return [];
    const map = new Map();
    raw.forEach((segment, index) => {
      const normalized = {
        segment_id: String(segment?.segment_id ?? `links_${index + 1}`),
        block_type: "links",
        text_quote: "",
        links: normalizeLinksInput(segment?.links),
        section_id: segment?.section_id ? String(segment.section_id) : null,
        section_title: segment?.section_title ? String(segment.section_title) : null,
        section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null,
        segment_status: segment?.segment_status ? String(segment.segment_status) : null,
        version: Number(segment?.version ?? 1)
      };
      const key = getLinkSegmentKey(normalized, index);
      const current = map.get(key);
      if (!current) {
        map.set(key, normalized);
        return;
      }
      map.set(key, {
        ...current,
        segment_id: current.segment_id || normalized.segment_id,
        section_id: current.section_id ?? normalized.section_id,
        section_title: current.section_title ?? normalized.section_title,
        section_index: current.section_index ?? normalized.section_index,
        links: normalizeLinksInput([...(current.links ?? []), ...(normalized.links ?? [])])
      });
    });
    return Array.from(map.values());
  }

  function mergeLinkSegmentsBySection(existing = [], incoming = []) {
    const extracted = normalizeLinkSegmentsInput(incoming);
    const history = normalizeLinkSegmentsInput(existing);
    const map = new Map();
    const order = [];
    const looseTitleToStrictKey = new Map();

    const upsert = (segment, targetKey, strategy = "merge") => {
      const key = targetKey || getLinkSegmentKey(segment);
      const current = map.get(key);
      const normalizedLinks = normalizeLinksInput(segment?.links ?? []);
      if (!current) {
        const entry = {
          segment: {
            ...segment,
            segment_id: String(segment?.segment_id ?? ""),
            block_type: "links",
            section_id: segment?.section_id ? String(segment.section_id) : null,
            section_title: segment?.section_title ? String(segment.section_title) : null,
            section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null
          },
          links: normalizedLinks
        };
        map.set(key, entry);
        order.push(key);
        return;
      }

      const mergedLinks = normalizeLinksInput([...(current.links ?? []), ...normalizedLinks]);
      const shouldReplaceMeta = strategy === "replace_meta";
      map.set(key, {
        segment: shouldReplaceMeta
          ? {
              ...current.segment,
              section_id: segment?.section_id ? String(segment.section_id) : current.segment.section_id,
              section_title: segment?.section_title ? String(segment.section_title) : current.segment.section_title,
              section_index: Number.isFinite(Number(segment?.section_index))
                ? Number(segment.section_index)
                : current.segment.section_index
            }
          : current.segment,
        links: mergedLinks
      });
    };

    extracted.forEach((segment, index) => {
      const strictKey = getLinkSegmentKey(segment, index);
      upsert(segment, strictKey, "replace_meta");
      const looseTitle = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      if (looseTitle && !looseTitleToStrictKey.has(looseTitle)) {
        looseTitleToStrictKey.set(looseTitle, strictKey);
      }
    });

    history.forEach((segment, index) => {
      const strictKey = getLinkSegmentKey(segment, index);
      if (map.has(strictKey)) {
        upsert(segment, strictKey, "merge");
        return;
      }
      const looseTitle = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      const mappedKey = looseTitle ? looseTitleToStrictKey.get(looseTitle) : "";
      if (mappedKey) {
        upsert(segment, mappedKey, "merge");
        return;
      }
      upsert(segment, strictKey, "merge");
    });

    return order.map((key) => {
      const entry = map.get(key);
      return {
        ...entry.segment,
        block_type: "links",
        text_quote: "",
        links: entry.links ?? []
      };
    });
  }

  function mergeLinkSegmentsIntoSegments(segments = [], linkSegments = []) {
    const withoutLinks = segments.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() !== "links");
    if (!linkSegments.length) return withoutLinks;
    const result = [...withoutLinks];
    linkSegments.forEach((linkSegment) => {
      const key = getSectionMatchKey(linkSegment);
      const insertAt = result.findIndex(
        (segment) =>
          String(segment?.block_type ?? "").trim().toLowerCase() !== "links" && getSectionMatchKey(segment) === key
      );
      if (insertAt === -1) {
        result.push(linkSegment);
      } else {
        result.splice(insertAt, 0, linkSegment);
      }
    });
    return result;
  }

  function collapseDuplicateLinkOnlyTopics(segments = []) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return { segments, collapsedLinkTopics: 0 };
    }

    const primaryByTitle = new Map();
    segments.forEach((segment) => {
      if (String(segment?.block_type ?? "").trim().toLowerCase() === "links") return;
      const titleKey = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      if (!titleKey) return;
      if (!primaryByTitle.has(titleKey)) {
        primaryByTitle.set(titleKey, {
          section_id: segment?.section_id ? String(segment.section_id) : null,
          section_title: segment?.section_title ? String(segment.section_title) : null,
          section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null
        });
        return;
      }
      const current = primaryByTitle.get(titleKey);
      if (!current?.section_id && segment?.section_id) {
        primaryByTitle.set(titleKey, {
          section_id: String(segment.section_id),
          section_title: segment?.section_title ? String(segment.section_title) : current.section_title,
          section_index: Number.isFinite(Number(segment?.section_index))
            ? Number(segment.section_index)
            : current.section_index
        });
      }
    });

    const reassigned = segments.map((segment) => {
      if (String(segment?.block_type ?? "").trim().toLowerCase() !== "links") return segment;
      const titleKey = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      if (!titleKey) return segment;
      const target = primaryByTitle.get(titleKey);
      if (!target) return segment;
      const sectionId = target.section_id ?? (segment?.section_id ? String(segment.section_id) : null);
      const isLegacy = /^section_\d+$/i.test(String(sectionId ?? "").trim());
      return {
        ...segment,
        segment_id: sectionId && !isLegacy ? `links_${sectionId}` : String(segment?.segment_id ?? ""),
        section_id: sectionId,
        section_title: target.section_title ?? (segment?.section_title ? String(segment.section_title) : null),
        section_index: Number.isFinite(Number(target.section_index))
          ? Number(target.section_index)
          : Number.isFinite(Number(segment?.section_index))
            ? Number(segment.section_index)
            : null
      };
    });

    const withoutLinks = reassigned.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() !== "links");
    const linkSegments = reassigned.filter((segment) => String(segment?.block_type ?? "").trim().toLowerCase() === "links");
    const mergedLinks = mergeLinkSegmentsBySection([], linkSegments);
    const merged = mergeLinkSegmentsIntoSegments(withoutLinks, mergedLinks);
    return {
      segments: merged,
      collapsedLinkTopics: Math.max(0, linkSegments.length - mergedLinks.length)
    };
  }

  function appendLinkDecisionsOverride(decisionsOverride = [], linkSegments = []) {
    const byId = new Map();
    decisionsOverride.forEach((item) => {
      const id = String(item?.segment_id ?? "").trim();
      if (!id) return;
      byId.set(id, {
        segment_id: id,
        visual_decision: normalizeVisualDecisionInput(item.visual_decision),
        search_decision: normalizeSearchDecisionInput(item.search_decision),
        search_decision_en: normalizeSearchDecisionInput(item.search_decision_en)
      });
    });
    linkSegments.forEach((segment) => {
      const id = String(segment?.segment_id ?? "").trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        segment_id: id,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision(),
        search_decision_en: emptySearchDecision()
      });
    });
    return Array.from(byId.values());
  }

  function isCustomSubSegmentId(segmentId) {
    return /^[a-z][a-z0-9]*_\d{2}(?:_\d{2})+$/i.test(String(segmentId ?? "").trim());
  }

  function normalizedContains(haystack, needle) {
    if (!haystack || !needle) return false;
    return haystack.includes(needle);
  }

  function tokenizeForMatch(text) {
    const normalized = normalizeTextForMatch(text);
    if (!normalized) return [];
    return normalized.split(" ").filter(Boolean);
  }

  function jaccardSimilarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  function ensureUniqueSegmentId(segment, usedIds, counters) {
    const desired = String(segment.segment_id ?? "").trim();
    if (desired && !usedIds.has(desired)) {
      usedIds.add(desired);
      return desired;
    }
    const base = String(segment.block_type ?? "news");
    let index = counters.get(base) ?? 1;
    let candidate = "";
    do {
      candidate = `${base}_${String(index).padStart(2, "0")}`;
      index += 1;
    } while (usedIds.has(candidate));
    counters.set(base, index);
    usedIds.add(candidate);
    return candidate;
  }

  function pickCustomSplitCandidates({ segment, normalized, customMeta, usedOldIds, sectionKey }) {
    if (!normalized || normalized.length < 20) return [];
    const candidates = customMeta
      .filter((item) => {
        const segmentId = String(item.segment.segment_id ?? "");
        if (!segmentId || usedOldIds.has(segmentId)) return false;
        if (segment.block_type && item.segment.block_type && segment.block_type !== item.segment.block_type) return false;
        if (sectionKey && item.sectionKey && sectionKey !== item.sectionKey) return false;
        if (!item.normalized || item.normalized.length < 8) return false;
        return normalizedContains(normalized, item.normalized);
      })
      .sort((a, b) => a.index - b.index);
    if (!candidates.length) return [];
    const total = candidates.reduce((sum, item) => sum + item.normalized.length, 0);
    const ratio = total / Math.max(1, normalized.length);
    if (candidates.length >= 2 && ratio >= 0.55) return candidates;
    if (candidates.length >= 1 && ratio >= 0.82) return candidates;
    return [];
  }

  function collectPreservedManualSegments({ oldMeta, usedOldIds, usedIds, newSegments, oldBySection }) {
    const preserved = [];
    const newMeta = newSegments.map((segment) => ({
      segment,
      normalized: normalizeTextForMatch(segment.text_quote),
      sectionKey: getSectionMatchKey(segment)
    }));
    oldMeta.forEach((item) => {
      const segmentId = String(item.segment.segment_id ?? "").trim();
      if (!segmentId || usedOldIds.has(segmentId) || usedIds.has(segmentId)) return;
      if (!isCustomSubSegmentId(segmentId)) return;
      const sectionCandidates = item.sectionKey ? oldBySection.get(item.sectionKey) ?? [] : [];
      if (sectionCandidates.length === 0 && !item.normalized) return;
      const stillPresent = newMeta.some((entry) => {
        if (item.sectionKey && entry.sectionKey && item.sectionKey !== entry.sectionKey) return false;
        return normalizedContains(entry.normalized, item.normalized);
      });
      if (!stillPresent) return;
      usedOldIds.add(segmentId);
      usedIds.add(segmentId);
      preserved.push({
        segment: { ...item.segment, segment_status: "same" },
        sourceId: segmentId
      });
    });
    return preserved;
  }

  function findBestFuzzyMatch({ segment, normalized, tokens, sectionKey, candidates, usedOldIds, minScore }) {
    if (!normalized || tokens.length < 3) return null;
    let best = null;
    let bestScore = 0;
    for (const item of candidates) {
      const oldId = String(item.segment.segment_id ?? "");
      if (!oldId || usedOldIds.has(oldId)) continue;
      if (!item.tokens.length) continue;
      const similarity = jaccardSimilarity(tokens, item.tokens);
      if (similarity <= 0) continue;
      const blockBonus = segment.block_type === item.segment.block_type ? 0.08 : 0;
      const sectionBonus =
        sectionKey && item.sectionKey ? (sectionKey === item.sectionKey ? 0.12 : -0.12) : 0;
      const lengthRatio = Math.min(normalized.length, item.normalized.length) / Math.max(normalized.length, item.normalized.length);
      const lengthBonus = Number.isFinite(lengthRatio) ? lengthRatio * 0.08 : 0;
      const score = similarity + blockBonus + sectionBonus + lengthBonus;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best || bestScore < minScore) return null;
    return best;
  }

  function buildNormalizedIndex(segments) {
    const map = new Map();
    segments.forEach((segment, index) => {
      const key = normalizeTextForMatch(segment.text_quote);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ segment, index });
    });
    return map;
  }

  function takeExactMatch(index, key, usedOldIds, candidateIds = null) {
    if (!key) return null;
    const list = index.get(key);
    if (!list) return null;
    for (const item of list) {
      const segmentId = String(item.segment.segment_id ?? "");
      if (candidateIds && !candidateIds.has(segmentId)) continue;
      if (!usedOldIds.has(segmentId)) {
        return item;
      }
    }
    return null;
  }

  function mergeSegmentsWithHistory(newSegments = [], oldSegments = [], oldDecisions = []) {
    const oldSegmentsFiltered = oldSegments.filter((segment) => segment?.block_type !== "links");
    if (!oldSegmentsFiltered.length) {
      const mergedSegments = newSegments.map((segment) => ({ ...segment, segment_status: null }));
      return {
        mergedSegments,
        decisionsOverride: null,
        diff: {
          old_total: 0,
          new_total: mergedSegments.length,
          generated_total: newSegments.length,
          added: mergedSegments.length,
          changed: 0,
          same: 0,
          preserved_manual: 0,
          removed: 0
        }
      };
    }

    const decisionMap = new Map(oldDecisions.map((item) => [String(item.segment_id ?? ""), item]));
    const oldMeta = oldSegmentsFiltered.map((segment, index) => ({
      segment,
      index,
      normalized: normalizeTextForMatch(segment.text_quote),
      tokens: tokenizeForMatch(segment.text_quote),
      sectionKey: getSectionMatchKey(segment)
    }));
    const oldBySection = new Map();
    oldMeta.forEach((item) => {
      if (!item.sectionKey) return;
      if (!oldBySection.has(item.sectionKey)) oldBySection.set(item.sectionKey, []);
      oldBySection.get(item.sectionKey).push(item);
    });
    const customMeta = oldMeta.filter((item) => isCustomSubSegmentId(item.segment.segment_id));
    const normalizedIndex = buildNormalizedIndex(oldSegmentsFiltered);
    const usedOldIds = new Set();
    const usedIds = new Set();
    const counters = new Map();

    const matched = [];
    newSegments.forEach((segment) => {
      const normalized = normalizeTextForMatch(segment.text_quote);
      const tokens = tokenizeForMatch(segment.text_quote);
      const sectionKey = getSectionMatchKey(segment);
      const scopedCandidates = sectionKey ? oldBySection.get(sectionKey) ?? [] : [];

      const splitCandidates = pickCustomSplitCandidates({
        segment,
        normalized,
        customMeta,
        usedOldIds,
        sectionKey
      });
      if (splitCandidates.length > 0) {
        splitCandidates.forEach((item) => {
          const segmentId = String(item.segment.segment_id ?? "").trim();
          if (!segmentId || usedIds.has(segmentId)) return;
          usedOldIds.add(segmentId);
          usedIds.add(segmentId);
          matched.push({
            segment: {
              ...item.segment,
              segment_status: "same"
            },
            matchedId: segmentId
          });
        });
        return;
      }

      const scopedIds = scopedCandidates.length
        ? new Set(scopedCandidates.map((item) => String(item.segment.segment_id ?? "")))
        : null;
      let matchedId = null;
      let status = "new";

      const exact = takeExactMatch(normalizedIndex, normalized, usedOldIds, scopedIds) ??
        takeExactMatch(normalizedIndex, normalized, usedOldIds);
      if (exact) {
        matchedId = exact.segment.segment_id;
        status = "same";
        usedOldIds.add(matchedId);
      } else {
        const scopedFuzzy = findBestFuzzyMatch({
          segment,
          normalized,
          tokens,
          sectionKey,
          candidates: scopedCandidates,
          usedOldIds,
          minScore: 0.48
        });
        const globalFuzzy =
          scopedFuzzy ??
          findBestFuzzyMatch({
            segment,
            normalized,
            tokens,
            sectionKey,
            candidates: oldMeta,
            usedOldIds,
            minScore: 0.67
          });
        if (globalFuzzy) {
          matchedId = globalFuzzy.segment.segment_id;
          status = "changed";
          usedOldIds.add(matchedId);
        }
      }

      let nextId = matchedId;
      if (nextId && usedIds.has(nextId)) {
        nextId = null;
        status = "new";
      }
      if (!nextId) {
        nextId = ensureUniqueSegmentId(segment, usedIds, counters);
      } else {
        usedIds.add(nextId);
      }

      matched.push({
        segment: { ...segment, segment_id: nextId, segment_status: status },
        matchedId
      });
    });

    const preservedManual = collectPreservedManualSegments({
      oldMeta,
      usedOldIds,
      usedIds,
      newSegments,
      oldBySection
    });
    const mergedSegments = [...matched.map((item) => item.segment), ...preservedManual.map((item) => item.segment)];
    const decisionsOverride = matched.map((item) => {
      const sourceId = item.matchedId ? String(item.matchedId) : String(item.segment.segment_id);
      const existing = decisionMap.get(sourceId);
      return {
        segment_id: item.segment.segment_id,
        visual_decision: existing?.visual_decision ?? emptyVisualDecision(),
        search_decision: existing?.search_decision ?? emptySearchDecision(),
        search_decision_en: existing?.search_decision_en ?? emptySearchDecision()
      };
    });
    preservedManual.forEach((item) => {
      const sourceId = String(item.sourceId ?? item.segment.segment_id);
      const existing = decisionMap.get(sourceId);
      decisionsOverride.push({
        segment_id: item.segment.segment_id,
        visual_decision: existing?.visual_decision ?? emptyVisualDecision(),
        search_decision: existing?.search_decision ?? emptySearchDecision(),
        search_decision_en: existing?.search_decision_en ?? emptySearchDecision()
      });
    });
    const oldIds = new Set(oldSegmentsFiltered.map((segment) => String(segment?.segment_id ?? "").trim()).filter(Boolean));
    const reusedOldIdsCount = Array.from(usedOldIds).filter((id) => oldIds.has(String(id))).length;
    const added = matched.filter((item) => item.segment.segment_status === "new").length;
    const changed = matched.filter((item) => item.segment.segment_status === "changed").length;
    const same = matched.filter((item) => item.segment.segment_status === "same").length + preservedManual.length;
    const removed = Math.max(0, oldIds.size - reusedOldIdsCount);

    return {
      mergedSegments,
      decisionsOverride,
      diff: {
        old_total: oldSegmentsFiltered.length,
        new_total: mergedSegments.length,
        generated_total: newSegments.length,
        added,
        changed,
        same,
        preserved_manual: preservedManual.length,
        removed
      }
    };
  }

  return {
    appendLinkDecisionsOverride,
    collapseDuplicateLinkOnlyTopics,
    getSectionMatchKey,
    mergeLinkSegmentsBySection,
    mergeLinkSegmentsIntoSegments,
    mergeSegmentsWithHistory,
    normalizeLinkSegmentsInput,
    normalizeSectionTitleForMatch,
    normalizeTextForMatch
  };
}
