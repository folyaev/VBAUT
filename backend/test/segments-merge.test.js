import test from "node:test";
import assert from "node:assert/strict";

import { createSegmentsMergeUtils } from "../src/services/segments-merge.js";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
} from "../src/services/normalizers.js";
import { normalizeLinksInput } from "../src/services/links.js";

const {
  applySegmentLinkHintsToSegments,
  buildSegmentLinkHintsFromRawText,
  mergeLinkSegmentsBySection,
  mergeSegmentsWithHistory,
  normalizeSegmentLinkHintsInput
} = createSegmentsMergeUtils({
  emptySearchDecision,
  emptyVisualDecision,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});

function makeDecision(segmentId, description) {
  return {
    segment_id: segmentId,
    visual_decision: {
      type: "image",
      description
    },
    search_decision: emptySearchDecision(),
    search_decision_en: emptySearchDecision()
  };
}

test("mergeSegmentsWithHistory does not inherit decisions for unmatched new segments with same ids", () => {
  const oldSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "alpha beta gamma delta epsilon zeta eta theta",
      section_title: "A",
      is_done: false
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "iota kappa lambda mu nu xi omicron pi",
      section_title: "A",
      is_done: false
    }
  ];
  const oldDecisions = [makeDecision("news_01", "Old comment 01"), makeDecision("news_02", "Old comment 02")];
  const newSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "red green blue yellow purple cyan black white",
      section_title: "A"
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "one two three four five six seven eight",
      section_title: "A"
    }
  ];

  const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(newSegments, oldSegments, oldDecisions);
  assert.equal(mergedSegments.length, 2);
  assert.ok(Array.isArray(decisionsOverride));
  assert.equal(decisionsOverride.length, 2);
  assert.equal(
    String(decisionsOverride.find((item) => item.segment_id === "news_01")?.visual_decision?.description ?? ""),
    ""
  );
  assert.equal(
    String(decisionsOverride.find((item) => item.segment_id === "news_02")?.visual_decision?.description ?? ""),
    ""
  );
});

test("mergeSegmentsWithHistory keeps decision for exact text match", () => {
  const oldSegments = [
    {
      segment_id: "news_05",
      block_type: "news",
      text_quote: "Заголовок о том, что Дубай теряет миллион в минуту",
      section_title: "Экономика",
      is_done: false
    }
  ];
  const oldDecisions = [makeDecision("news_05", "Правильный комментарий")];
  const newSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Заголовок о том, что Дубай теряет миллион в минуту",
      section_title: "Экономика"
    }
  ];

  const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(newSegments, oldSegments, oldDecisions);
  assert.equal(mergedSegments.length, 1);
  assert.equal(mergedSegments[0]?.segment_id, "news_05");
  assert.equal(decisionsOverride?.length, 1);
  assert.equal(String(decisionsOverride?.[0]?.visual_decision?.description ?? ""), "Правильный комментарий");
});

test("mergeSegmentsWithHistory does not let unmatched generated ids steal later exact matches", () => {
  const oldSegments = [
    {
      segment_id: "news_12",
      block_type: "news",
      text_quote: "Unitree showed a useful robot suit demo.",
      section_title: "Unitree",
      is_done: true
    }
  ];
  const oldDecisions = [makeDecision("news_12", "Unitree media")];
  const newSegments = [
    {
      segment_id: "news_12",
      block_type: "news",
      text_quote: "A different story got inserted before Unitree.",
      section_title: "Inserted"
    },
    {
      segment_id: "news_13",
      block_type: "news",
      text_quote: "Unitree showed a useful robot suit demo.",
      section_title: "Unitree"
    }
  ];

  const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(newSegments, oldSegments, oldDecisions);

  assert.equal(mergedSegments.length, 2);
  assert.notEqual(String(mergedSegments[0]?.segment_id ?? ""), "news_12");
  assert.equal(String(mergedSegments[1]?.segment_id ?? ""), "news_12");
  assert.equal(Boolean(mergedSegments[1]?.is_done), true);
  assert.equal(
    String(decisionsOverride.find((item) => item.segment_id === "news_12")?.visual_decision?.description ?? ""),
    "Unitree media"
  );
});

test("mergeLinkSegmentsBySection keeps each URL in one topic and lets incoming explicit placement win", () => {
  const existing = [
    {
      segment_id: "links_section_oil_01",
      block_type: "links",
      section_id: "section_oil_01",
      section_title: "Oil",
      links: [{ url: "https://example.com/oil", raw: null }]
    },
    {
      segment_id: "links_section_rihanna_01",
      block_type: "links",
      section_id: "section_rihanna_01",
      section_title: "Rihanna",
      links: [{ url: "https://example.com/rihanna", raw: null }]
    }
  ];

  const incoming = [
    {
      segment_id: "links_section_rihanna_02",
      block_type: "links",
      section_id: "section_rihanna_02",
      section_title: "Rihanna",
      links: [
        { url: "https://example.com/oil", raw: null },
        { url: "https://example.com/rihanna", raw: null }
      ]
    }
  ];

  const merged = mergeLinkSegmentsBySection(existing, incoming);
  const byTitle = new Map(merged.map((item) => [String(item.section_title ?? "").trim().toLowerCase(), item]));

  const oilUrls = (byTitle.get("oil")?.links ?? []).map((item) => String(item.url ?? ""));
  const rihannaUrls = (byTitle.get("rihanna")?.links ?? []).map((item) => String(item.url ?? ""));

  assert.deepEqual(oilUrls, []);
  assert.deepEqual(rihannaUrls, ["https://example.com/oil", "https://example.com/rihanna"]);
});

test("mergeLinkSegmentsBySection preserves repeated positional scrape links", () => {
  const incoming = [
    {
      segment_id: "links_afghan_001",
      block_type: "links",
      section_title: "Afghanistan",
      source_order: 3,
      links: [{ url: "https://t.me/sharemed/23320", raw: null }]
    },
    {
      segment_id: "links_afghan_002",
      block_type: "links",
      section_title: "Afghanistan",
      source_order: 5,
      links: [{ url: "https://t.me/sharemed/23320", raw: null }]
    }
  ];

  const merged = mergeLinkSegmentsBySection([], incoming);

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((item) => (item.links ?? []).map((link) => String(link.url ?? ""))),
    [["https://t.me/sharemed/23320"], ["https://t.me/sharemed/23320"]]
  );
});

test("mergeLinkSegmentsBySection keeps URL ownership stable regardless existing order", () => {
  const existingForward = [
    {
      segment_id: "links_a",
      block_type: "links",
      section_title: "Zulu",
      links: [{ url: "https://example.com/shared", raw: null }]
    },
    {
      segment_id: "links_b",
      block_type: "links",
      section_title: "Alpha",
      links: [{ url: "https://example.com/shared", raw: null }]
    }
  ];
  const existingReverse = [...existingForward].reverse();

  const mergedForward = mergeLinkSegmentsBySection(existingForward, []);
  const mergedReverse = mergeLinkSegmentsBySection(existingReverse, []);

  const ownerForward = mergedForward.find((item) =>
    (item.links ?? []).some((link) => String(link?.url ?? "") === "https://example.com/shared")
  );
  const ownerReverse = mergedReverse.find((item) =>
    (item.links ?? []).some((link) => String(link?.url ?? "") === "https://example.com/shared")
  );

  assert.equal(String(ownerForward?.section_title ?? ""), "Alpha");
  assert.equal(String(ownerReverse?.section_title ?? ""), "Alpha");
});

test("normalizeSegmentLinkHintsInput dedupes by section/url/quote", () => {
  const hints = normalizeSegmentLinkHintsInput([
    {
      section_title: "Topic A",
      url: "example.com/a",
      quote_hint: "Same hint"
    },
    {
      section_title: "Topic A",
      url: "https://example.com/a",
      quote_hint: "same   hint"
    },
    {
      section_title: "Topic A",
      url: "https://example.com/a",
      quote_hint: "Different hint"
    }
  ]);
  assert.equal(hints.length, 2);
});

test("applySegmentLinkHintsToSegments attaches URL to best matching segment", () => {
  const segments = [
    {
      segment_id: "news_01",
      block_type: "news",
      section_title: "Tech",
      text_quote: "A neutral line about processors.",
      links: []
    },
    {
      segment_id: "news_02",
      block_type: "news",
      section_title: "Tech",
      text_quote: "NVIDIA announced a new Blackwell update for data centers.",
      links: []
    }
  ];
  const hints = [
    {
      section_title: "Tech",
      url: "https://example.com/blackwell",
      quote_hint: "Blackwell update for data centers"
    }
  ];
  const { segments: merged, appliedCount } = applySegmentLinkHintsToSegments(segments, hints);
  assert.equal(appliedCount, 1);
  assert.equal((merged[0].links ?? []).length, 0);
  assert.equal((merged[1].links ?? []).length, 1);
  assert.equal(String(merged[1].links[0]?.url ?? ""), "https://example.com/blackwell");
});

test("buildSegmentLinkHintsFromRawText maps numbered quote refs to section links", () => {
  const rawText = [
    "### Topic One",
    "2. quote for second url",
    "",
    "Body text here."
  ].join("\n");
  const linkSegments = [
    {
      segment_id: "links_topic_one",
      block_type: "links",
      section_title: "Topic One",
      links: [
        { url: "https://example.com/first" },
        { url: "https://example.com/second" }
      ]
    }
  ];
  const hints = buildSegmentLinkHintsFromRawText(rawText, linkSegments);
  assert.equal(hints.length, 1);
  assert.equal(String(hints[0]?.url ?? ""), "https://example.com/second");
  assert.equal(String(hints[0]?.quote_hint ?? ""), "quote for second url");
});

test("mergeSegmentsWithHistory preserves done state and media for same section slot after rewrite", () => {
  const oldSegments = [
    {
      segment_id: "news_15",
      block_type: "news",
      text_quote: "Russia was officially recognized as a zone free of foot-and-mouth disease.",
      section_id: "section_fmd",
      section_title: "FMD",
      is_done: true
    }
  ];
  const oldDecisions = [
    {
      segment_id: "news_15",
      visual_decision: {
        type: "image",
        description: "Reference screenshot",
        media_file_paths: ["FMD/fmd_status.png"]
      },
      search_decision: emptySearchDecision(),
      search_decision_en: emptySearchDecision()
    }
  ];
  const newSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "The stigma matters politically, but the key point is that from May 2025 Russia has been treated as officially free of foot-and-mouth disease.",
      section_id: "section_fmd",
      section_title: "FMD"
    }
  ];

  const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(newSegments, oldSegments, oldDecisions);
  assert.equal(mergedSegments.length, 1);
  assert.equal(String(mergedSegments[0]?.segment_id ?? ""), "news_15");
  assert.equal(Boolean(mergedSegments[0]?.is_done), true);
  assert.equal(decisionsOverride?.length, 1);
  assert.equal(String(decisionsOverride?.[0]?.segment_id ?? ""), "news_15");
  assert.equal(String(decisionsOverride?.[0]?.visual_decision?.description ?? ""), "Reference screenshot");
  assert.deepEqual(decisionsOverride?.[0]?.visual_decision?.media_file_paths ?? [], ["FMD/fmd_status.png"]);
});

test("mergeSegmentsWithHistory preserves comments segments and keeps them before the matched story", () => {
  const oldSegments = [
    {
      segment_id: "comments_news_02",
      block_type: "news",
      text_quote: "1. Bieber got 10 millions",
      section_id: "section_pop",
      section_title: "Pop",
      is_done: false
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "Justin Bieber is in the center of a new payments scandal with multiple claims around ghost promotions.",
      section_id: "section_pop",
      section_title: "Pop",
      is_done: true
    },
    {
      segment_id: "news_03",
      block_type: "news",
      text_quote: "A separate entertainment story about another artist.",
      section_id: "section_pop",
      section_title: "Pop",
      is_done: false
    }
  ];
  const oldDecisions = [
    makeDecision("comments_news_02", "Comment visual should stay empty but mapped"),
    makeDecision("news_02", "Main story decision"),
    makeDecision("news_03", "Other story decision")
  ];
  const newSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "A separate entertainment story about another artist.",
      section_id: "section_pop",
      section_title: "Pop"
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "Justin Bieber is in the center of a new payments scandal with multiple claims around ghost promotions.",
      section_id: "section_pop",
      section_title: "Pop"
    }
  ];

  const { mergedSegments, decisionsOverride } = mergeSegmentsWithHistory(newSegments, oldSegments, oldDecisions);
  assert.deepEqual(
    mergedSegments.map((segment) => String(segment?.segment_id ?? "")),
    ["news_03", "comments_news_02", "news_02"]
  );
  assert.equal(String(mergedSegments[1]?.text_quote ?? ""), "1. Bieber got 10 millions");
  assert.equal(Boolean(mergedSegments[2]?.is_done), true);
  assert.equal(
    String(decisionsOverride.find((item) => item.segment_id === "comments_news_02")?.visual_decision?.description ?? ""),
    "Comment visual should stay empty but mapped"
  );
  assert.equal(
    String(decisionsOverride.find((item) => item.segment_id === "news_02")?.visual_decision?.description ?? ""),
    "Main story decision"
  );
});
