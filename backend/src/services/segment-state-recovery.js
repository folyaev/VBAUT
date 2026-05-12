import fs from "node:fs/promises";
import path from "node:path";

export function createSegmentStateRecoveryUtils(deps) {
  const {
    getDocDir,
    mergeSegmentsWithHistory,
    mergeVisualDecisionWithOrigin,
    normalizeDecisionsInput,
    normalizeSearchDecisionInput,
    normalizeSegmentsInput,
    normalizeVisualDecisionInput,
    readOptionalJson,
    saveVersioned
  } = deps;

  async function listVersions(dir, baseName) {
    const entries = await fs.readdir(dir).catch(() => []);
    const prefix = `${baseName}.v`;
    return entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => {
        const match = name.match(/\.v(\d+)\.json$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
  }

  function isLinksSegment(segment) {
    return String(segment?.block_type ?? "").trim().toLowerCase() === "links";
  }

  function countDecisionMediaPaths(decisions = []) {
    return decisions.reduce((total, decision) => {
      const visual = normalizeVisualDecisionInput(decision?.visual_decision);
      const paths = Array.isArray(visual.media_file_paths) ? visual.media_file_paths : [];
      if (paths.length > 0) return total + 1;
      return visual.media_file_path ? total + 1 : total;
    }, 0);
  }

  function countDecisionDescriptions(decisions = []) {
    return decisions.reduce((total, decision) => {
      const description = String(decision?.visual_decision?.description ?? "").trim();
      return description ? total + 1 : total;
    }, 0);
  }

  function listDoneSegmentIds(segments = []) {
    return segments
      .filter((segment) => !isLinksSegment(segment) && Boolean(segment?.is_done))
      .map((segment) => String(segment?.segment_id ?? "").trim())
      .filter(Boolean)
      .sort();
  }

  function listVisualMediaSegmentIds(segments = [], decisions = []) {
    const decisionMap = new Map(
      (Array.isArray(decisions) ? decisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
    return segments
      .filter((segment) => !isLinksSegment(segment))
      .map((segment) => {
        const segmentId = String(segment?.segment_id ?? "").trim();
        if (!segmentId) return "";
        const decision = decisionMap.get(segmentId);
        return hasVisualMedia(decision?.visual_decision) ? segmentId : "";
      })
      .filter(Boolean)
      .sort();
  }

  function listVisualDescriptionSegmentIds(segments = [], decisions = []) {
    const decisionMap = new Map(
      (Array.isArray(decisions) ? decisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
    return segments
      .filter((segment) => !isLinksSegment(segment))
      .map((segment) => {
        const segmentId = String(segment?.segment_id ?? "").trim();
        if (!segmentId) return "";
        const description = String(decisionMap.get(segmentId)?.visual_decision?.description ?? "").trim();
        return description ? segmentId : "";
      })
      .filter(Boolean)
      .sort();
  }

  function hasVisualMedia(visualDecision) {
    const visual = normalizeVisualDecisionInput(visualDecision);
    if (visual.media_file_path) return true;
    return Array.isArray(visual.media_file_paths) && visual.media_file_paths.length > 0;
  }

  function hasVisualSignal(decision) {
    const visual = normalizeVisualDecisionInput(decision?.visual_decision);
    if (hasVisualMedia(visual)) return true;
    if (String(visual.description ?? "").trim()) return true;
    return String(visual.type ?? "").trim() && String(visual.type ?? "").trim() !== "no_visual";
  }

  function pickVisualDecision(currentDecision, sourceDecision) {
    const currentVisual = normalizeVisualDecisionInput(currentDecision?.visual_decision);
    const sourceVisual = normalizeVisualDecisionInput(sourceDecision?.visual_decision);
    if (sourceVisual.media_file_path) {
      return typeof mergeVisualDecisionWithOrigin === "function"
        ? mergeVisualDecisionWithOrigin(currentVisual, sourceVisual, { preserve_user_owned: true })
        : sourceVisual;
    }
    if (Array.isArray(sourceVisual.media_file_paths) && sourceVisual.media_file_paths.length > 0) {
      return typeof mergeVisualDecisionWithOrigin === "function"
        ? mergeVisualDecisionWithOrigin(currentVisual, sourceVisual, { preserve_user_owned: true })
        : sourceVisual;
    }
    if (!hasVisualSignal(currentDecision) && hasVisualSignal(sourceDecision)) {
      return typeof mergeVisualDecisionWithOrigin === "function"
        ? mergeVisualDecisionWithOrigin(currentVisual, sourceVisual, { preserve_user_owned: true })
        : sourceVisual;
    }
    return currentVisual;
  }

  function mergeVisualDecisions(baseDecision, sourceDecision) {
    const baseVisual = normalizeVisualDecisionInput(baseDecision?.visual_decision ?? baseDecision);
    const sourceVisual = normalizeVisualDecisionInput(sourceDecision?.visual_decision ?? sourceDecision);
    const mergedPaths = Array.from(
      new Set(
        [
          ...(Array.isArray(baseVisual.media_file_paths) ? baseVisual.media_file_paths : []),
          baseVisual.media_file_path,
          ...(Array.isArray(sourceVisual.media_file_paths) ? sourceVisual.media_file_paths : []),
          sourceVisual.media_file_path
        ].filter(Boolean)
      )
    );
    const mergedTimecodes = {
      ...(sourceVisual.media_file_timecodes && typeof sourceVisual.media_file_timecodes === "object"
        ? sourceVisual.media_file_timecodes
        : {}),
      ...(baseVisual.media_file_timecodes && typeof baseVisual.media_file_timecodes === "object"
        ? baseVisual.media_file_timecodes
        : {})
    };
    const firstVideoPath =
      mergedPaths.find((mediaPath) => /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mts|m2ts)(?:$|[?#])/i.test(mediaPath)) ??
      null;
    const mergedVisual = normalizeVisualDecisionInput({
      type: baseVisual.type && baseVisual.type !== "no_visual" ? baseVisual.type : sourceVisual.type,
      description: String(baseVisual.description ?? "").trim() || String(sourceVisual.description ?? "").trim(),
      description_meta: String(baseVisual.description ?? "").trim() ? baseVisual.description_meta : sourceVisual.description_meta,
      format_hint: baseVisual.format_hint ?? sourceVisual.format_hint ?? null,
      duration_hint_sec: baseVisual.duration_hint_sec ?? sourceVisual.duration_hint_sec ?? null,
      priority: baseVisual.priority ?? sourceVisual.priority ?? null,
      media_file_paths: mergedPaths,
      media_file_path: mergedPaths[0] ?? null,
      media_file_timecodes: mergedTimecodes,
      media_start_timecode:
        (firstVideoPath ? mergedTimecodes[firstVideoPath] : null) ??
        baseVisual.media_start_timecode ??
        sourceVisual.media_start_timecode ??
        null,
      media_meta:
        hasVisualMedia(baseVisual)
          ? baseVisual.media_meta
          : hasVisualMedia(sourceVisual)
            ? sourceVisual.media_meta
            : null
    });
    return typeof mergeVisualDecisionWithOrigin === "function"
      ? mergeVisualDecisionWithOrigin(baseVisual, mergedVisual, { preserve_user_owned: true })
      : mergedVisual;
  }

  function buildRecoveredState({ currentSegments, currentDecisions, mergedSegments, decisionsOverride }) {
    const currentDecisionMap = new Map(
      (Array.isArray(currentDecisions) ? currentDecisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
    const currentNonLinks = currentSegments.filter((segment) => !isLinksSegment(segment));
    if (mergedSegments.length !== currentNonLinks.length || decisionsOverride.length !== currentNonLinks.length) {
      throw new Error(
        `Unsafe recovery mapping: current_non_links=${currentNonLinks.length}, merged=${mergedSegments.length}, decisions=${decisionsOverride.length}`
      );
    }

    const recoveredNonLinks = currentNonLinks.map((segment, index) => {
      const merged = mergedSegments[index] ?? {};
      return {
        ...segment,
        is_done: Boolean(segment?.is_done) || Boolean(merged?.is_done),
        segment_status: segment?.segment_status ?? merged?.segment_status ?? null
      };
    });

    const recoveredDecisionMap = new Map();
    recoveredNonLinks.forEach((segment, index) => {
      const segmentId = String(segment?.segment_id ?? "").trim();
      if (!segmentId) return;
      const currentDecision = currentDecisionMap.get(segmentId);
      const sourceDecision = decisionsOverride[index];
      recoveredDecisionMap.set(segmentId, {
        segment_id: segmentId,
        visual_decision: pickVisualDecision(currentDecision, sourceDecision),
        search_decision: normalizeSearchDecisionInput(currentDecision?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(currentDecision?.search_decision_en),
        research_sources: Array.isArray(currentDecision?.research_sources) ? currentDecision.research_sources : [],
        research_dismissed_urls: Array.isArray(currentDecision?.research_dismissed_urls)
          ? currentDecision.research_dismissed_urls
          : [],
        research_bundle_trace: currentDecision?.research_bundle_trace ?? null,
        version: Number(currentDecision?.version ?? 1)
      });
    });

    const nextSegments = [];
    currentSegments.forEach((segment) => {
      if (isLinksSegment(segment)) {
        nextSegments.push({ ...segment });
        return;
      }
      const recovered = recoveredNonLinks.shift();
      nextSegments.push(recovered ? { ...recovered } : { ...segment });
    });

    const nextDecisions = currentSegments.map((segment) => {
      const segmentId = String(segment?.segment_id ?? "").trim();
      const recovered = recoveredDecisionMap.get(segmentId);
      if (recovered) return recovered;
      const currentDecision = currentDecisionMap.get(segmentId);
      return {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput(currentDecision?.visual_decision),
        search_decision: normalizeSearchDecisionInput(currentDecision?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(currentDecision?.search_decision_en),
        research_sources: Array.isArray(currentDecision?.research_sources) ? currentDecision.research_sources : [],
        research_dismissed_urls: Array.isArray(currentDecision?.research_dismissed_urls)
          ? currentDecision.research_dismissed_urls
          : [],
        research_bundle_trace: currentDecision?.research_bundle_trace ?? null,
        version: Number(currentDecision?.version ?? 1)
      };
    });

    return {
      segments: normalizeSegmentsInput(nextSegments),
      decisions: normalizeDecisionsInput(nextDecisions)
    };
  }

  function buildRecoveryStats(segments = [], decisions = []) {
    const nonLinks = segments.filter((segment) => !isLinksSegment(segment));
    return {
      total_non_links: nonLinks.length,
      done_non_links: nonLinks.filter((segment) => Boolean(segment?.is_done)).length,
      visual_media_segments: countDecisionMediaPaths(decisions),
      visual_descriptions: countDecisionDescriptions(decisions),
      done_segment_ids: listDoneSegmentIds(segments),
      visual_media_segment_ids: listVisualMediaSegmentIds(segments, decisions),
      visual_description_segment_ids: listVisualDescriptionSegmentIds(segments, decisions)
    };
  }

  async function loadVersionedState(dir, segmentsVersion, decisionsVersion) {
    const [sourceSegments, sourceDecisions] = await Promise.all([
      readOptionalJson(path.join(dir, `segments.v${segmentsVersion}.json`)),
      readOptionalJson(path.join(dir, `decisions.v${decisionsVersion}.json`))
    ]);
    if (!Array.isArray(sourceSegments) || sourceSegments.length === 0) {
      throw new Error(`Source segments version ${segmentsVersion} is empty or missing`);
    }
    if (!Array.isArray(sourceDecisions) || sourceDecisions.length === 0) {
      throw new Error(`Source decisions version ${decisionsVersion} is empty or missing`);
    }
    return {
      sourceSegments,
      sourceDecisions
    };
  }

  async function evaluateCandidate({
    dir,
    currentSegments,
    currentDecisions,
    segmentsVersion,
    decisionsVersion
  }) {
    const { sourceSegments, sourceDecisions } = await loadVersionedState(dir, segmentsVersion, decisionsVersion);
    const currentNonLinks = currentSegments.filter((segment) => !isLinksSegment(segment));
    const { mergedSegments, decisionsOverride, diff } = mergeSegmentsWithHistory(
      currentNonLinks,
      sourceSegments,
      sourceDecisions
    );
    const unsafe =
      mergedSegments.length !== currentNonLinks.length || decisionsOverride.length !== currentNonLinks.length;
    if (unsafe) {
      return {
        segmentsVersion,
        decisionsVersion,
        safe: false,
        diff,
        recovered: null,
        score: Number.NEGATIVE_INFINITY
      };
    }

    const recovered = buildRecoveredState({
      currentSegments,
      currentDecisions,
      mergedSegments,
      decisionsOverride
    });
    const stats = buildRecoveryStats(recovered.segments, recovered.decisions);
    const score =
      stats.done_non_links * 1_000_000 + stats.visual_media_segments * 10_000 + stats.visual_descriptions * 100;

    return {
      segmentsVersion,
      decisionsVersion,
      safe: true,
      diff,
      mergedSegments,
      decisionsOverride,
      recovered,
      stats,
      score
    };
  }

  function buildLayeredRecoveredState({ currentSegments, currentDecisions, evaluations = [] }) {
    const currentNonLinks = currentSegments.filter((segment) => !isLinksSegment(segment));
    const currentDecisionMap = new Map(
      (Array.isArray(currentDecisions) ? currentDecisions : [])
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );

    const segmentAccumulator = currentNonLinks.map((segment) => ({
      ...segment,
      is_done: Boolean(segment?.is_done)
    }));
    const decisionAccumulator = currentNonLinks.map((segment) => {
      const segmentId = String(segment?.segment_id ?? "").trim();
      const currentDecision = currentDecisionMap.get(segmentId);
      return {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput(currentDecision?.visual_decision),
        search_decision: normalizeSearchDecisionInput(currentDecision?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(currentDecision?.search_decision_en),
        research_sources: Array.isArray(currentDecision?.research_sources) ? currentDecision.research_sources : [],
        research_dismissed_urls: Array.isArray(currentDecision?.research_dismissed_urls)
          ? currentDecision.research_dismissed_urls
          : [],
        research_bundle_trace: currentDecision?.research_bundle_trace ?? null,
        version: Number(currentDecision?.version ?? 1)
      };
    });

    evaluations.forEach((evaluation) => {
      const mergedSegments = Array.isArray(evaluation?.mergedSegments) ? evaluation.mergedSegments : [];
      const decisionsOverride = Array.isArray(evaluation?.decisionsOverride) ? evaluation.decisionsOverride : [];
      if (mergedSegments.length !== currentNonLinks.length || decisionsOverride.length !== currentNonLinks.length) {
        return;
      }
      for (let index = 0; index < currentNonLinks.length; index += 1) {
        if (Boolean(mergedSegments[index]?.is_done)) {
          segmentAccumulator[index].is_done = true;
        }
        decisionAccumulator[index] = {
          ...decisionAccumulator[index],
          visual_decision: mergeVisualDecisions(
            decisionAccumulator[index]?.visual_decision,
            decisionsOverride[index]?.visual_decision
          )
        };
      }
    });

    const nextSegments = [];
    let nonLinkIndex = 0;
    currentSegments.forEach((segment) => {
      if (isLinksSegment(segment)) {
        nextSegments.push({ ...segment });
        return;
      }
      nextSegments.push({ ...segmentAccumulator[nonLinkIndex] });
      nonLinkIndex += 1;
    });

    const layeredDecisionMap = new Map(
      decisionAccumulator
        .map((decision) => [String(decision?.segment_id ?? "").trim(), decision])
        .filter(([segmentId]) => Boolean(segmentId))
    );
    const nextDecisions = currentSegments.map((segment) => {
      const segmentId = String(segment?.segment_id ?? "").trim();
      const layeredDecision = layeredDecisionMap.get(segmentId);
      if (layeredDecision) return layeredDecision;
      const currentDecision = currentDecisionMap.get(segmentId);
      return {
        segment_id: segmentId,
        visual_decision: normalizeVisualDecisionInput(currentDecision?.visual_decision),
        search_decision: normalizeSearchDecisionInput(currentDecision?.search_decision),
        search_decision_en: normalizeSearchDecisionInput(currentDecision?.search_decision_en),
        research_sources: Array.isArray(currentDecision?.research_sources) ? currentDecision.research_sources : [],
        research_dismissed_urls: Array.isArray(currentDecision?.research_dismissed_urls)
          ? currentDecision.research_dismissed_urls
          : [],
        research_bundle_trace: currentDecision?.research_bundle_trace ?? null,
        version: Number(currentDecision?.version ?? 1)
      };
    });

    return {
      segments: normalizeSegmentsInput(nextSegments),
      decisions: normalizeDecisionsInput(nextDecisions)
    };
  }

  function formatResult(result) {
    return {
      source_segments_version: result.segmentsVersion,
      source_decisions_version: result.decisionsVersion,
      safe: Boolean(result.safe),
      diff: result.diff ?? null,
      stats: result.stats ?? null
    };
  }

  async function recoverDocumentSegmentState(options = {}) {
    const docId = String(options.docId ?? "").trim();
    const rawSourceSegmentsVersion = options.sourceSegmentsVersion;
    const rawSourceDecisionsVersion = options.sourceDecisionsVersion;
    const sourceSegmentsVersion =
      rawSourceSegmentsVersion == null || rawSourceSegmentsVersion === ""
        ? null
        : Number(rawSourceSegmentsVersion);
    const sourceDecisionsVersion =
      rawSourceDecisionsVersion == null || rawSourceDecisionsVersion === ""
        ? null
        : Number(rawSourceDecisionsVersion);
    const apply = Boolean(options.apply);
    const scanLimitRaw = Number(options.scanLimit);
    const scanLimit = Number.isFinite(scanLimitRaw) && scanLimitRaw > 0 ? Math.max(1, Math.floor(scanLimitRaw)) : 40;
    if (!docId) {
      throw new Error("docId is required");
    }

    const dir = getDocDir(docId);
    const [currentSegments, currentDecisions, segmentVersions, decisionVersions] = await Promise.all([
      readOptionalJson(path.join(dir, "segments.json")),
      readOptionalJson(path.join(dir, "decisions.json")),
      listVersions(dir, "segments"),
      listVersions(dir, "decisions")
    ]);

    if (!Array.isArray(currentSegments) || currentSegments.length === 0) {
      throw new Error(`Current segments.json not found for ${docId}`);
    }
    if (!Array.isArray(currentDecisions) || currentDecisions.length === 0) {
      throw new Error(`Current decisions.json not found for ${docId}`);
    }

    let candidates = [];
    if (Number.isFinite(sourceSegmentsVersion) || Number.isFinite(sourceDecisionsVersion)) {
      const segmentsVersion = Number.isFinite(sourceSegmentsVersion) ? sourceSegmentsVersion : sourceDecisionsVersion;
      const decisionsVersion = Number.isFinite(sourceDecisionsVersion) ? sourceDecisionsVersion : sourceSegmentsVersion;
      if (!segmentsVersion || !decisionsVersion) {
        throw new Error("Both source segments and decisions versions must resolve to numbers");
      }
      candidates = [{ segmentsVersion, decisionsVersion }];
    } else {
      const availableDecisionVersions = new Set(decisionVersions);
      const shared = segmentVersions.filter((value) => availableDecisionVersions.has(value));
      candidates = shared.slice(-Math.max(1, scanLimit)).reverse().map((value) => ({
        segmentsVersion: value,
        decisionsVersion: value
      }));
      if (candidates.length === 0) {
        throw new Error(`No shared version pairs found for ${docId}`);
      }
    }

    const evaluated = [];
    for (const candidate of candidates) {
      try {
        evaluated.push(
          await evaluateCandidate({
            dir,
            currentSegments,
            currentDecisions,
            segmentsVersion: candidate.segmentsVersion,
            decisionsVersion: candidate.decisionsVersion
          })
        );
      } catch (error) {
        evaluated.push({
          segmentsVersion: candidate.segmentsVersion,
          decisionsVersion: candidate.decisionsVersion,
          safe: false,
          error: error.message,
          score: Number.NEGATIVE_INFINITY
        });
      }
    }

    const best = [...evaluated]
      .filter((item) => item.safe && item.recovered)
      .sort((left, right) => right.score - left.score)[0];
    const safeEvaluated = evaluated
      .filter((item) => item.safe && item.recovered)
      .sort((left, right) => right.segmentsVersion - left.segmentsVersion);

    if (!best) {
      return {
        doc_id: docId,
        mode: apply ? "apply" : "dry_run",
        current: buildRecoveryStats(currentSegments, currentDecisions),
        candidates: evaluated.map(formatResult)
      };
    }

    const layeredRecovered = buildLayeredRecoveredState({
      currentSegments,
      currentDecisions,
      evaluations: safeEvaluated
    });
    const layeredStats = buildRecoveryStats(layeredRecovered.segments, layeredRecovered.decisions);
    const layeredScore =
      layeredStats.done_non_links * 1_000_000 +
      layeredStats.visual_media_segments * 10_000 +
      layeredStats.visual_descriptions * 100;
    const layered = {
      mode: "layered",
      stats: layeredStats,
      score: layeredScore,
      recovered: layeredRecovered,
      sources: safeEvaluated.map((item) => item.segmentsVersion)
    };
    const selectedRecovery = layered.score >= best.score ? layered : { mode: "single", ...best };

    const output = {
      doc_id: docId,
      mode: apply ? "apply" : "dry_run",
      current: buildRecoveryStats(currentSegments, currentDecisions),
      strategy: selectedRecovery.mode,
      selected: formatResult(best),
      layered: {
        mode: layered.mode,
        stats: layered.stats,
        source_versions: layered.sources
      },
      candidates: evaluated.slice(0, 10).map(formatResult)
    };

    if (!apply) {
      return output;
    }

    const recoveredState = selectedRecovery.mode === "layered" ? layered.recovered : best.recovered;
    const segmentsVersion = await saveVersioned(docId, "segments", recoveredState.segments);
    const decisionsVersion = await saveVersioned(docId, "decisions", recoveredState.decisions);
    return {
      ...output,
      written: {
        segments_version: segmentsVersion,
        decisions_version: decisionsVersion
      }
    };
  }

  return {
    recoverDocumentSegmentState
  };
}
