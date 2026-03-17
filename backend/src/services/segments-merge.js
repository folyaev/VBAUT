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

  function canonicalizeMergeLinkUrl(rawUrl) {
    const normalized = String(rawUrl ?? "").trim();
    if (!normalized) return "";
    try {
      const url = new URL(normalized);
      if (url.protocol === "http:" && url.port === "80") url.port = "";
      if (url.protocol === "https:" && url.port === "443") url.port = "";
      return url.toString();
    } catch {
      return normalized;
    }
  }

  function isLikelyUrlToken(value) {
    const text = String(value ?? "").trim();
    if (!text) return false;
    if (/^https?:\/\//i.test(text)) return true;
    if (/^www\./i.test(text)) return true;
    return /^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(text);
  }

  function normalizeMergeLinkUrl(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (!isLikelyUrlToken(trimmed)) return "";
    return `https://${trimmed}`;
  }

  function normalizeLineBreaks(text) {
    return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function parseIndexedReferenceLine(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d+)\.\s*(.+)$/);
    if (!match) return null;
    const index = Number.parseInt(match[1], 10);
    const value = String(match[2] ?? "").replace(/^[|>]+\s*/g, "").trim();
    if (!value) return null;
    return {
      index: Number.isFinite(index) ? index : null,
      value
    };
  }

  function splitScriptIntoHeadingBlocks(text) {
    const normalized = normalizeLineBreaks(text);
    const lines = normalized.split("\n");
    const blocks = [];
    let current = {
      heading: null,
      lines: []
    };
    const pushCurrent = () => {
      if (!current.heading && current.lines.length === 0) return;
      blocks.push({ ...current });
    };
    lines.forEach((line) => {
      const match = line.match(/#{3,}\s*(.+?)\s*$/);
      if (match) {
        pushCurrent();
        current = {
          heading: match[1].trim(),
          lines: []
        };
        return;
      }
      current.lines.push(line);
    });
    pushCurrent();
    return blocks;
  }

  function getHintSectionKeys(section) {
    const keys = [];
    const sectionId = String(section?.section_id ?? "").trim().toLowerCase();
    if (sectionId && !/^section_\d+$/i.test(sectionId)) {
      keys.push(`id:${sectionId}`);
    }
    const titleKey = normalizeSectionTitleForMatch(section?.section_title ?? "");
    if (titleKey) {
      keys.push(`title:${titleKey}`);
    }
    if (keys.length === 0) {
      const strict = getSectionMatchKey(section);
      if (strict) keys.push(strict);
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function normalizeSegmentLinkHintsInput(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];
    const seen = new Set();
    raw.forEach((item) => {
      const url = normalizeMergeLinkUrl(item?.url ?? "");
      if (!url) return;
      const canonical = canonicalizeMergeLinkUrl(url);
      if (!canonical) return;
      const quoteHint = String(item?.quote_hint ?? "").trim();
      const normalizedQuote = normalizeTextForMatch(quoteHint);
      const section = {
        section_id: item?.section_id ? String(item.section_id) : null,
        section_title: item?.section_title ? String(item.section_title) : null,
        section_index: Number.isFinite(Number(item?.section_index)) ? Number(item.section_index) : null
      };
      const sectionKeys = getHintSectionKeys(section);
      const sectionKey = sectionKeys[0] ?? "untitled";
      const dedupeKey = `${sectionKey}|${canonical}|${normalizedQuote}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      result.push({
        ...section,
        url,
        raw: item?.raw == null ? null : String(item.raw),
        quote_hint: quoteHint
      });
    });
    return result;
  }

  function buildSegmentLinkHintsFromRawText(rawText, linkSegments = []) {
    const normalizedLinkSegments = normalizeLinkSegmentsInput(linkSegments);
    if (!normalizedLinkSegments.length) return [];
    const blocks = splitScriptIntoHeadingBlocks(rawText);
    if (!blocks.length) return [];

    const refsBySectionKey = new Map();
    blocks.forEach((block) => {
      if (!block.heading) return;
      const refs = [];
      for (let index = 0; index < block.lines.length; index += 1) {
        const line = String(block.lines[index] ?? "");
        const trimmed = line.trim();
        if (!trimmed) {
          if (refs.length === 0) continue;
          break;
        }
        const ref = parseIndexedReferenceLine(trimmed);
        if (!ref) break;
        if (isLikelyUrlToken(ref.value)) continue;
        const text = String(ref.value ?? "").trim();
        if (text.length < 8) continue;
        refs.push({
          index: Number.isFinite(ref.index) ? ref.index : null,
          text
        });
      }
      if (!refs.length) return;
      const section = { section_title: block.heading };
      const keys = getHintSectionKeys(section);
      keys.forEach((key) => {
        if (!refsBySectionKey.has(key)) refsBySectionKey.set(key, []);
        refsBySectionKey.get(key).push(...refs);
      });
    });

    if (!refsBySectionKey.size) return [];

    const hints = [];
    normalizedLinkSegments.forEach((segment) => {
      const sectionKeys = getHintSectionKeys(segment);
      let refs = [];
      for (const key of sectionKeys) {
        const current = refsBySectionKey.get(key);
        if (current?.length) {
          refs = current;
          break;
        }
      }
      if (!refs.length) return;

      const links = normalizeLinksInput(segment?.links ?? []);
      if (!links.length) return;

      const usedIndexes = new Set();
      const pickLinkIndex = (preferred) => {
        if (Number.isInteger(preferred) && preferred >= 0 && preferred < links.length && !usedIndexes.has(preferred)) {
          usedIndexes.add(preferred);
          return preferred;
        }
        if (Number.isInteger(preferred)) {
          let best = -1;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (let i = 0; i < links.length; i += 1) {
            if (usedIndexes.has(i)) continue;
            const distance = Math.abs(i - preferred);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = i;
            }
          }
          if (best >= 0) {
            usedIndexes.add(best);
            return best;
          }
        }
        for (let i = 0; i < links.length; i += 1) {
          if (usedIndexes.has(i)) continue;
          usedIndexes.add(i);
          return i;
        }
        return -1;
      };

      refs.forEach((ref) => {
        const preferred = Number.isFinite(ref?.index) ? Number(ref.index) - 1 : null;
        const linkIndex = pickLinkIndex(Number.isFinite(preferred) ? preferred : null);
        if (linkIndex < 0) return;
        const link = links[linkIndex];
        const url = normalizeMergeLinkUrl(link?.url ?? "");
        if (!url) return;
        hints.push({
          section_id: segment?.section_id ? String(segment.section_id) : null,
          section_title: segment?.section_title ? String(segment.section_title) : null,
          section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null,
          url,
          raw: link?.raw == null ? null : String(link.raw),
          quote_hint: String(ref?.text ?? "").trim()
        });
      });
    });

    return normalizeSegmentLinkHintsInput(hints);
  }

  function scoreHintAgainstSegment(segmentText, hintText) {
    const segmentNorm = normalizeTextForMatch(segmentText);
    const hintNorm = normalizeTextForMatch(hintText);
    if (!segmentNorm || !hintNorm) return 0;
    if (segmentNorm === hintNorm) return 1.25;
    if (segmentNorm.includes(hintNorm)) return 1.1;
    if (hintNorm.length >= 20 && hintNorm.includes(segmentNorm)) return 0.95;
    const segmentTokens = tokenizeForMatch(segmentNorm);
    const hintTokens = tokenizeForMatch(hintNorm);
    if (!segmentTokens.length || !hintTokens.length) return 0;
    const overlap = countTokenIntersection(segmentTokens, hintTokens);
    if (overlap === 0) return 0;
    const union = new Set([...segmentTokens, ...hintTokens]).size;
    const jaccard = union > 0 ? overlap / union : 0;
    const coverage = overlap / hintTokens.length;
    return Math.max(jaccard, coverage * 0.92);
  }

  function applySegmentLinkHintsToSegments(segments = [], rawHints = []) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return { segments, appliedCount: 0 };
    }
    const hints = normalizeSegmentLinkHintsInput(rawHints);
    if (!hints.length) {
      return { segments, appliedCount: 0 };
    }

    const nextSegments = segments.map((segment) => ({
      ...segment,
      links: normalizeLinksInput(segment?.links ?? [])
    }));

    const candidatesBySection = new Map();
    nextSegments.forEach((segment, index) => {
      if (String(segment?.block_type ?? "").trim().toLowerCase() === "links") return;
      const keys = getHintSectionKeys(segment);
      keys.forEach((key) => {
        if (!candidatesBySection.has(key)) candidatesBySection.set(key, []);
        candidatesBySection.get(key).push({ index, segment });
      });
    });

    let appliedCount = 0;
    const seenAssignments = new Set();
    hints.forEach((hint) => {
      const url = normalizeMergeLinkUrl(hint?.url ?? "");
      const canonical = canonicalizeMergeLinkUrl(url);
      if (!url || !canonical) return;

      const sectionKeys = getHintSectionKeys(hint);
      const rawCandidates = [];
      sectionKeys.forEach((key) => {
        const rows = candidatesBySection.get(key);
        if (rows?.length) rawCandidates.push(...rows);
      });
      if (!rawCandidates.length) return;

      const unique = [];
      const seenIndexes = new Set();
      rawCandidates.forEach((candidate) => {
        if (seenIndexes.has(candidate.index)) return;
        seenIndexes.add(candidate.index);
        unique.push(candidate);
      });
      if (!unique.length) return;

      const hintText = String(hint?.quote_hint ?? "").trim();
      let best = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      unique.forEach((candidate) => {
        const score = hintText ? scoreHintAgainstSegment(candidate.segment?.text_quote ?? "", hintText) : 0.01;
        if (!best || score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      });

      if (!best) return;
      if (hintText && bestScore < 0.2) return;

      const assignmentKey = `${String(best.segment?.segment_id ?? "")}|${canonical}`;
      if (seenAssignments.has(assignmentKey)) return;

      const prevLinks = normalizeLinksInput(best.segment?.links ?? []);
      const nextLinks = normalizeLinksInput([
        ...prevLinks,
        {
          url,
          raw: hint?.raw == null ? null : String(hint.raw)
        }
      ]);
      if (nextLinks.length === prevLinks.length) return;

      best.segment.links = nextLinks;
      seenAssignments.add(assignmentKey);
      appliedCount += 1;
    });

    return {
      segments: nextSegments,
      appliedCount
    };
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
    const linkOwnerByCanonicalUrl = new Map();
    const historyOwnerByCanonicalUrl = new Map();

    history.forEach((segment, index) => {
      const key = getLinkSegmentKey(segment, index);
      const links = normalizeLinksInput(segment?.links ?? []);
      links.forEach((link) => {
        const canonical = canonicalizeMergeLinkUrl(link?.url ?? "");
        if (!canonical) return;
        const currentOwner = historyOwnerByCanonicalUrl.get(canonical);
        if (!currentOwner || key.localeCompare(currentOwner) < 0) {
          historyOwnerByCanonicalUrl.set(canonical, key);
        }
      });
    });

    const pickOwnedLinks = (links = [], key, source = "history") => {
      const accepted = [];
      const normalizedLinks = normalizeLinksInput(links);
      normalizedLinks.forEach((link) => {
        const canonical = canonicalizeMergeLinkUrl(link?.url ?? "");
        if (!canonical) return;
        const owner = linkOwnerByCanonicalUrl.get(canonical);
        if (owner && owner !== key) return;
        if (!owner && source === "history") {
          const preferred = historyOwnerByCanonicalUrl.get(canonical);
          if (preferred && preferred !== key) return;
        }
        if (!owner) linkOwnerByCanonicalUrl.set(canonical, key);
        accepted.push(link);
      });
      return accepted;
    };

    const upsert = (segment, targetKey, strategy = "merge", source = "history") => {
      const key = targetKey || getLinkSegmentKey(segment);
      const current = map.get(key);
      const normalizedLinks = pickOwnedLinks(segment?.links ?? [], key, source);
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
      upsert(segment, strictKey, "replace_meta", "incoming");
      const looseTitle = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      if (looseTitle && !looseTitleToStrictKey.has(looseTitle)) {
        looseTitleToStrictKey.set(looseTitle, strictKey);
      }
    });

    history.forEach((segment, index) => {
      const strictKey = getLinkSegmentKey(segment, index);
      if (map.has(strictKey)) {
        upsert(segment, strictKey, "merge", "history");
        return;
      }
      const looseTitle = normalizeSectionTitleForMatch(segment?.section_title ?? "");
      const mappedKey = looseTitle ? looseTitleToStrictKey.get(looseTitle) : "";
      if (mappedKey) {
        upsert(segment, mappedKey, "merge", "history");
        return;
      }
      upsert(segment, strictKey, "merge", "history");
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
    return /^[a-z][a-z0-9_]*_\d{2}(?:_\d{2})+$/i.test(String(segmentId ?? "").trim());
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

  function countTokenIntersection(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    const left = new Set(tokensA);
    let count = 0;
    for (const token of new Set(tokensB)) {
      if (left.has(token)) count += 1;
    }
    return count;
  }

  function findBestFuzzyMatch({
    segment,
    normalized,
    tokens,
    sectionKey,
    candidates,
    usedOldIds,
    minScore,
    targetIndex = 0
  }) {
    if (!normalized || normalized.length < 35 || tokens.length < 4) return null;
    let best = null;
    let bestScore = 0;
    for (const item of candidates) {
      const oldId = String(item.segment.segment_id ?? "");
      if (!oldId || usedOldIds.has(oldId)) continue;
      if (!item.tokens.length) continue;
      if (sectionKey && item.sectionKey && sectionKey !== item.sectionKey) continue;
      const similarity = jaccardSimilarity(tokens, item.tokens);
      if (similarity <= 0) continue;
      const overlap = countTokenIntersection(tokens, item.tokens);
      if (overlap < 3) continue;
      const blockBonus = segment.block_type === item.segment.block_type ? 0.08 : 0;
      const sectionBonus = sectionKey && item.sectionKey && sectionKey === item.sectionKey ? 0.12 : 0;
      const lengthRatio = Math.min(normalized.length, item.normalized.length) / Math.max(normalized.length, item.normalized.length);
      const lengthBonus = Number.isFinite(lengthRatio) ? lengthRatio * 0.08 : 0;
      const indexDistance = Math.abs(Number(item.index ?? 0) - Number(targetIndex ?? 0));
      const indexPenalty = Math.min(0.24, indexDistance * 0.02);
      const score = similarity + blockBonus + sectionBonus + lengthBonus - indexPenalty;
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

  function takeExactMatch(index, key, usedOldIds, options = {}) {
    const candidateIds = options?.candidateIds ?? null;
    const sectionKey = String(options?.sectionKey ?? "");
    const targetIndex = Number(options?.targetIndex ?? 0);
    if (!key) return null;
    const list = index.get(key);
    if (!list) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const item of list) {
      const segmentId = String(item.segment.segment_id ?? "");
      if (candidateIds && !candidateIds.has(segmentId)) continue;
      if (usedOldIds.has(segmentId)) continue;
      const itemSectionKey = getSectionMatchKey(item.segment);
      const sectionScore =
        sectionKey && itemSectionKey ? (sectionKey === itemSectionKey ? 3 : -3) : 0;
      const distancePenalty = Number.isFinite(targetIndex) ? Math.abs(item.index - targetIndex) * 0.05 : 0;
      const score = sectionScore - distancePenalty;
      if (!best || score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
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
    newSegments.forEach((segment, newIndex) => {
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
      let matchedSourceSegment = null;
      let status = "new";

      const exact =
        takeExactMatch(normalizedIndex, normalized, usedOldIds, {
          candidateIds: scopedIds,
          sectionKey,
          targetIndex: newIndex
        }) ??
        takeExactMatch(normalizedIndex, normalized, usedOldIds, {
          sectionKey,
          targetIndex: newIndex
        });
      if (exact) {
        matchedId = exact.segment.segment_id;
        matchedSourceSegment = exact.segment;
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
            minScore: 0.62,
            targetIndex: newIndex
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
            minScore: 0.78,
            targetIndex: newIndex
          });
        if (globalFuzzy) {
          matchedId = globalFuzzy.segment.segment_id;
          matchedSourceSegment = globalFuzzy.segment;
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
      const inheritedDone = matchedSourceSegment ? Boolean(matchedSourceSegment.is_done) : false;

      matched.push({
        segment: { ...segment, segment_id: nextId, segment_status: status, is_done: inheritedDone },
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
      const sourceId = item.matchedId ? String(item.matchedId) : "";
      const existing = sourceId ? decisionMap.get(sourceId) : null;
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
    applySegmentLinkHintsToSegments,
    appendLinkDecisionsOverride,
    buildSegmentLinkHintsFromRawText,
    collapseDuplicateLinkOnlyTopics,
    getSectionMatchKey,
    mergeLinkSegmentsBySection,
    mergeLinkSegmentsIntoSegments,
    mergeSegmentsWithHistory,
    normalizeLinkSegmentsInput,
    normalizeSegmentLinkHintsInput,
    normalizeSectionTitleForMatch,
    normalizeTextForMatch
  };
}

