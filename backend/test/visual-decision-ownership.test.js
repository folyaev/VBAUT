import test from "node:test";
import assert from "node:assert/strict";

import {
  applyVisualDecisionFieldOrigins,
  mergeVisualDecisionWithOrigin
} from "../src/services/normalizers.js";

test("applyVisualDecisionFieldOrigins marks changed description and media as user-owned", () => {
  const current = {
    description: "old",
    media_file_paths: ["Topic/a.mp4"],
    media_file_timecodes: { "Topic/a.mp4": "00:00:01" },
    media_start_timecode: "00:00:01"
  };
  const next = {
    description: "new",
    media_file_paths: ["Topic/b.mp4"],
    media_file_timecodes: { "Topic/b.mp4": "00:00:02" },
    media_start_timecode: "00:00:02"
  };

  const result = applyVisualDecisionFieldOrigins(current, next, {
    description_origin: "user",
    media_origin: "user",
    updated_at: "2026-04-22T12:00:00.000Z"
  });

  assert.equal(result.description_meta?.origin, "user");
  assert.equal(result.description_meta?.updated_at, "2026-04-22T12:00:00.000Z");
  assert.equal(result.media_meta?.origin, "user");
  assert.equal(result.media_meta?.updated_at, "2026-04-22T12:00:00.000Z");
});

test("mergeVisualDecisionWithOrigin preserves user-owned description and media on system update", () => {
  const existing = {
    description: "manual description",
    description_meta: { origin: "user", updated_at: "2026-04-22T09:00:00.000Z" },
    media_file_paths: ["Topic/manual.mp4"],
    media_file_timecodes: { "Topic/manual.mp4": "00:00:03" },
    media_start_timecode: "00:00:03",
    media_meta: { origin: "user", updated_at: "2026-04-22T09:05:00.000Z" }
  };
  const incoming = {
    description: "generated description",
    media_file_paths: ["Topic/generated.mp4"],
    media_file_timecodes: { "Topic/generated.mp4": "00:00:01" },
    media_start_timecode: "00:00:01"
  };

  const result = mergeVisualDecisionWithOrigin(existing, incoming, {
    incoming_origin: "system",
    preserve_user_owned: true,
    updated_at: "2026-04-22T13:00:00.000Z"
  });

  assert.equal(result.description, "manual description");
  assert.equal(result.description_meta?.origin, "user");
  assert.deepEqual(result.media_file_paths, ["Topic/manual.mp4"]);
  assert.equal(result.media_meta?.origin, "user");
});
