import React from "react";

export function useScenarioGroups({
  segments,
  config,
  headingSearchRuEngineIds,
  groupRenderChunk,
  getSegmentGroupKey,
  getSegmentGroupTitle,
  collectScenarioLinks,
  collectSegmentsNeedingVisual,
  setExpandedGroups,
  setGroupRenderLimits,
  setHeadingSearchOpen,
  setHeadingEnglishQueries
}) {
  const groupedSegments = React.useMemo(() => {
    const map = new Map();
    segments.forEach((segment, index) => {
      const key = getSegmentGroupKey(segment);
      const title = getSegmentGroupTitle(segment);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title,
          items: [],
          linkSegment: null,
          section_id: segment.section_id ?? null,
          section_title: segment.section_title ?? null,
          section_index: segment.section_index ?? null,
          research_use_topic_title: Boolean(segment?.research_use_topic_title),
          research_use_theme_tags: Boolean(segment?.research_use_theme_tags),
          topic_tags: Array.isArray(segment.topic_tags) ? segment.topic_tags : [],
          section_tags: Array.isArray(segment.section_tags) ? segment.section_tags : []
        });
      }
      const group = map.get(key);
      if (String(segment?.block_type ?? "").toLowerCase().trim() === "links") {
        group.linkSegment = { segment, index };
        return;
      }
      group.items.push({ segment, index });
    });
    return Array.from(map.values());
  }, [getSegmentGroupKey, getSegmentGroupTitle, segments]);

  const allScenarioLinks = React.useMemo(() => collectScenarioLinks(segments), [collectScenarioLinks, segments]);
  const segmentsNeedingVisual = React.useMemo(
    () => collectSegmentsNeedingVisual(segments),
    [collectSegmentsNeedingVisual, segments]
  );
  const headingRuEngines = React.useMemo(
    () => (config.searchEngines ?? []).filter((engine) => headingSearchRuEngineIds.has(engine.id)),
    [config.searchEngines, headingSearchRuEngineIds]
  );

  React.useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = false;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments, setExpandedGroups]);

  React.useEffect(() => {
    setGroupRenderLimits((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = groupRenderChunk;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupRenderChunk, groupedSegments, setGroupRenderLimits]);

  React.useEffect(() => {
    setHeadingSearchOpen((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = false;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setHeadingEnglishQueries((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupedSegments.map((group) => group.id));
      groupedSegments.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = group.title === "Без темы" ? "" : group.title;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedSegments, setHeadingEnglishQueries, setHeadingSearchOpen]);

  return {
    groupedSegments,
    allScenarioLinks,
    segmentsNeedingVisual,
    headingRuEngines
  };
}
