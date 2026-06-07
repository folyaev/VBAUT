import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTimelineAlignment,
  framesToTimecode,
  normalizeTimelineText,
  parseTranscriptBlocks,
  timecodeToFrames
} from "../src/services/timeline-alignment.js";

test("timeline alignment parses transcript blocks and matches segments by speech", () => {
  const transcript = [
    "00:00:01:00 - 00:00:05:00",
    "Speaker 1",
    "Мы тут с вами разбираем актуальные события.",
    "",
    "00:00:05:00 - 00:00:08:00",
    "Speaker 1",
    "И вот тут есть отличная новость для студентов."
  ].join("\n");
  const blocks = parseTranscriptBlocks(transcript, 50);
  assert.equal(blocks.length, 2);

  const alignment = buildTimelineAlignment({
    document: { id: "doc_test" },
    fps: 50,
    transcriptBlocks: blocks,
    segments: [
      { segment_id: "news_99", block_type: "news", text_quote: "Мы тут с вами разбираем актуальные события." },
      { segment_id: "news_01", block_type: "news", text_quote: "И вот тут есть отличная новость для студентов." }
    ]
  });

  assert.equal(alignment.matched_segments, 2);
  assert.equal(alignment.items[0].start_tc, "00:00:01:00");
  assert.equal(alignment.items[1].start_tc, "00:00:05:00");
});

test("timeline alignment keeps directives out of timeline when there is no gap", () => {
  const blocks = parseTranscriptBlocks(
    [
      "00:00:00:00 - 00:00:02:00",
      "Speaker 1",
      "Первый текст.",
      "",
      "00:00:02:00 - 00:00:04:00",
      "Speaker 1",
      "Второй текст."
    ].join("\n"),
    50
  );
  const alignment = buildTimelineAlignment({
    document: { id: "doc_test" },
    fps: 50,
    transcriptBlocks: blocks,
    segments: [
      { segment_id: "a", block_type: "news", text_quote: "Первый текст." },
      { segment_id: "b", block_type: "news", text_quote: "/видео проходка" },
      { segment_id: "c", block_type: "news", text_quote: "Второй текст." }
    ]
  });

  const directive = alignment.items.find((item) => item.segment_id === "b");
  assert.equal(directive.matched, false);
  assert.equal(directive.slot_status, "no_timeline_slot");
});

test("timeline timecode frame conversion is stable", () => {
  assert.equal(timecodeToFrames("00:01:00:10", 50), 3010);
  assert.equal(framesToTimecode(3010, 50), "00:01:00:10");
});

test("timeline text normalization repairs known ASR title substitutions", () => {
  const normalized = normalizeTimelineText(
    "У АвтоВАЗа два стоил 200 миллионов. На полу в Юте сквозь двор потратили 700 миллионов."
  );

  assert.match(normalized, /the last of us ii/);
  assert.match(normalized, /call of duty black ops cold war/);
});
