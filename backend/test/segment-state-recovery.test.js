import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSegmentStateRecoveryUtils } from "../src/services/segment-state-recovery.js";
import {
  mergeVisualDecisionWithOrigin,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "../src/services/normalizers.js";

test("segment state recovery keeps user-owned description while recovering media", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "segment-state-recovery-"));
  const docId = "doc-ownership";
  const docDir = path.join(rootDir, docId);
  await fs.mkdir(docDir, { recursive: true });

  const currentSegments = [
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
      segment_id: "news_01",
      visual_decision: {
        description: "User-owned description",
        description_meta: { origin: "user", updated_at: "2026-04-22T09:00:00.000Z" }
      },
      version: 3
    }
  ];
  const historicalSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Bieber got 10 millions",
      section_title: "Bieber",
      section_index: 1,
      is_done: false
    }
  ];
  const historicalDecisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        description: "System description",
        description_meta: { origin: "system", updated_at: "2026-04-21T09:00:00.000Z" },
        media_file_paths: ["Bieber/clip.mp4"],
        media_meta: { origin: "system", updated_at: "2026-04-21T09:00:00.000Z" }
      },
      version: 2
    }
  ];

  await Promise.all([
    fs.writeFile(path.join(docDir, "segments.json"), JSON.stringify(currentSegments, null, 2)),
    fs.writeFile(path.join(docDir, "decisions.json"), JSON.stringify(currentDecisions, null, 2)),
    fs.writeFile(path.join(docDir, "segments.v1.json"), JSON.stringify(historicalSegments, null, 2)),
    fs.writeFile(path.join(docDir, "decisions.v1.json"), JSON.stringify(historicalDecisions, null, 2))
  ]);

  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  let writtenDecisions = null;
  const { recoverDocumentSegmentState } = createSegmentStateRecoveryUtils({
    getDocDir: (value) => path.join(rootDir, value),
    mergeSegmentsWithHistory: (segments, sourceSegments, sourceDecisions) => ({
      mergedSegments: normalizeSegmentsInput(segments),
      decisionsOverride: normalizeDecisionsInput(
        sourceSegments.map((segment, index) => ({
          segment_id: String(segment?.segment_id ?? "").trim(),
          visual_decision: sourceDecisions[index]?.visual_decision ?? {}
        }))
      ),
      diff: null
    }),
    mergeVisualDecisionWithOrigin,
    normalizeDecisionsInput,
    normalizeSearchDecisionInput,
    normalizeSegmentsInput,
    normalizeVisualDecisionInput,
    readOptionalJson: async (filePath) => {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch {
        return null;
      }
    },
    saveVersioned: async (value, baseName, data) => {
      const targetPath = path.join(rootDir, value, `${baseName}.json`);
      await fs.writeFile(targetPath, JSON.stringify(data, null, 2));
      if (baseName === "decisions") writtenDecisions = data;
      return 1;
    }
  });

  const result = await recoverDocumentSegmentState({
    docId,
    apply: true,
    sourceSegmentsVersion: 1,
    sourceDecisionsVersion: 1
  });

  assert.equal(result.strategy, "layered");
  assert.ok(Array.isArray(writtenDecisions));
  assert.equal(writtenDecisions[0]?.visual_decision?.description, "User-owned description");
  assert.equal(writtenDecisions[0]?.visual_decision?.description_meta?.origin, "user");
  assert.deepEqual(writtenDecisions[0]?.visual_decision?.media_file_paths, ["Bieber/clip.mp4"]);
  assert.equal(writtenDecisions[0]?.visual_decision?.media_meta?.origin, "system");
});
