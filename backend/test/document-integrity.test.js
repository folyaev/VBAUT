import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentIntegrityUtils } from "../src/services/document-integrity.js";
import {
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "../src/services/normalizers.js";

const { buildDocumentIntegritySnapshot, applyDocumentIntegritySnapshot } = createDocumentIntegrityUtils({
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
});

test("document integrity restores done, description and media after reorder shift", () => {
  const previousSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Bieber got 10 millions",
      section_title: "Bieber",
      section_index: 1,
      is_done: true
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "Chimp war discovered in Uganda",
      section_title: "Chimp",
      section_index: 2,
      is_done: false
    }
  ];
  const previousDecisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        description: "Close-up of the stage",
        description_meta: { origin: "user", updated_at: "2026-04-21T12:00:00.000Z" },
        media_file_paths: ["Bieber/shot.mp4"],
        media_file_timecodes: { "Bieber/shot.mp4": "00:00:03" },
        media_meta: { origin: "user", updated_at: "2026-04-21T12:00:00.000Z" }
      }
    },
    {
      segment_id: "news_02",
      visual_decision: {}
    }
  ];
  const snapshot = buildDocumentIntegritySnapshot(previousSegments, previousDecisions);

  const currentSegments = [
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "Chimp war discovered in Uganda",
      section_title: "Chimp",
      section_index: 2,
      is_done: false
    },
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Bieber got 10 millions",
      section_title: "Bieber",
      section_index: 1,
      is_done: false
    }
  ];
  const currentDecisions = [
    {
      segment_id: "news_02",
      visual_decision: {
        description: "Close-up of the stage",
        description_meta: { origin: "system", updated_at: "2026-04-22T12:00:00.000Z" },
        media_file_paths: ["Bieber/shot.mp4"],
        media_file_timecodes: { "Bieber/shot.mp4": "00:00:03" },
        media_meta: { origin: "system", updated_at: "2026-04-22T12:00:00.000Z" }
      }
    },
    {
      segment_id: "news_01",
      visual_decision: {}
    }
  ];

  const result = applyDocumentIntegritySnapshot({
    snapshot,
    segments: currentSegments,
    decisions: currentDecisions
  });

  const decisionById = new Map(result.decisions.map((item) => [item.segment_id, item]));
  const segmentById = new Map(result.segments.map((item) => [item.segment_id, item]));

  assert.equal(segmentById.get("news_01")?.is_done, true);
  assert.equal(decisionById.get("news_01")?.visual_decision?.description, "Close-up of the stage");
  assert.equal(decisionById.get("news_01")?.visual_decision?.description_meta?.origin, "user");
  assert.deepEqual(decisionById.get("news_01")?.visual_decision?.media_file_paths, ["Bieber/shot.mp4"]);
  assert.equal(decisionById.get("news_01")?.visual_decision?.media_meta?.origin, "user");
  assert.equal(decisionById.get("news_02")?.visual_decision?.description, "");
  assert.equal(decisionById.get("news_02")?.visual_decision?.description_meta, null);
  assert.deepEqual(decisionById.get("news_02")?.visual_decision?.media_file_paths, []);
  assert.equal(decisionById.get("news_02")?.visual_decision?.media_meta, null);
  assert.equal(result.report.applied, true);
  assert.equal(result.report.restored.is_done, 1);
  assert.equal(result.report.restored.visual_description, 1);
  assert.equal(result.report.restored.media, 1);
  assert.equal(result.report.moved.visual_description, 1);
  assert.equal(result.report.moved.media, 1);
});

test("document integrity leaves disappeared segment unresolved instead of reassigning its state", () => {
  const previousSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Bieber got 10 millions",
      section_title: "Bieber",
      section_index: 1,
      is_done: false
    },
    {
      segment_id: "news_02",
      block_type: "news",
      text_quote: "Chimp war discovered in Uganda",
      section_title: "Chimp",
      section_index: 2,
      is_done: true
    }
  ];
  const previousDecisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        description: "Close-up of the stage",
        media_file_paths: ["Bieber/shot.mp4"]
      }
    },
    {
      segment_id: "news_02",
      visual_decision: {}
    }
  ];
  const snapshot = buildDocumentIntegritySnapshot(previousSegments, previousDecisions);

  const result = applyDocumentIntegritySnapshot({
    snapshot,
    segments: [
      {
        segment_id: "news_02",
        block_type: "news",
        text_quote: "Chimp war discovered in Uganda",
        section_title: "Chimp",
        section_index: 2,
        is_done: false
      }
    ],
    decisions: [{ segment_id: "news_02", visual_decision: {} }]
  });

  assert.equal(result.segments[0]?.is_done, true);
  assert.equal(result.decisions[0]?.visual_decision?.description, "");
  assert.deepEqual(result.decisions[0]?.visual_decision?.media_file_paths, []);
  assert.equal(result.report.matched_items, 1);
  assert.equal(result.report.unresolved_items, 1);
  assert.deepEqual(result.report.unresolved_segment_ids, ["news_01"]);
});

test("document integrity snapshot preserves ownership metadata when restoring missing state", () => {
  const snapshot = buildDocumentIntegritySnapshot(
    [
      {
        segment_id: "news_01",
        block_type: "news",
        text_quote: "Bieber got 10 millions",
        section_title: "Bieber",
        section_index: 1,
        is_done: false
      }
    ],
    [
      {
        segment_id: "news_01",
        visual_decision: {
          description: "User-owned description",
          description_meta: { origin: "user", updated_at: "2026-04-21T12:00:00.000Z" },
          media_file_paths: ["Bieber/shot.mp4"],
          media_meta: { origin: "user", updated_at: "2026-04-21T12:00:00.000Z" }
        }
      }
    ]
  );

  const result = applyDocumentIntegritySnapshot({
    snapshot,
    segments: [
      {
        segment_id: "news_01",
        block_type: "news",
        text_quote: "Bieber got 10 millions",
        section_title: "Bieber",
        section_index: 1,
        is_done: false
      }
    ],
    decisions: [{ segment_id: "news_01", visual_decision: {} }]
  });

  assert.equal(result.decisions[0]?.visual_decision?.description_meta?.origin, "user");
  assert.equal(result.decisions[0]?.visual_decision?.media_meta?.origin, "user");
});

test("document integrity reports no changes when state is already aligned", () => {
  const previousSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Bieber got 10 millions",
      section_title: "Bieber",
      section_index: 1,
      is_done: true
    }
  ];
  const previousDecisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        description: "Close-up of the stage",
        media_file_paths: ["Bieber/shot.mp4"]
      }
    }
  ];
  const snapshot = buildDocumentIntegritySnapshot(previousSegments, previousDecisions);

  const result = applyDocumentIntegritySnapshot({
    snapshot,
    segments: previousSegments,
    decisions: previousDecisions
  });

  assert.equal(result.report.applied, false);
  assert.deepEqual(result.report.restored, {
    is_done: 0,
    visual_description: 0,
    media: 0,
    comments: 0,
    links: 0
  });
  assert.deepEqual(result.report.moved, {
    visual_description: 0,
    media: 0
  });
});
