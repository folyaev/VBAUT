import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { dedupeRankedResearchResultsByStory } from "../src/services/research-story-clusters.js";
import { mergeResearchScores } from "../src/services/research-ranker.js";
import { detectResearchOutcomeAction } from "../src/services/research-outcome-auto-mark.js";
import { createSourceMemoryStore } from "../src/services/source-memory.js";
import { createResearchStore } from "../src/services/research-store.js";

test("dedupeRankedResearchResultsByStory collapses repeated story headlines and keeps strongest candidate", () => {
  const results = [
    {
      id: "r1",
      title: "UAE says ceasefire talks resumed after overnight strikes in Sudan",
      url: "https://example.com/story-a",
      domain: "example.com",
      snippet: "Wire update",
      phase: "source"
    },
    {
      id: "r2",
      title: "UAE says ceasefire talks resumed after overnight strikes in Sudan",
      url: "https://mirror.example.net/world/story-b",
      domain: "mirror.example.net",
      snippet: "Syndicated copy",
      phase: "source"
    },
    {
      id: "r3",
      title: "Separate footage from Khartoum after overnight strikes",
      url: "https://video.example.org/watch/khartoum",
      domain: "video.example.org",
      snippet: "Video",
      phase: "visual"
    }
  ];
  const rankedResults = [
    { result_id: "r1", total_score: 0.74, source_score: 0.8, montage_score: 0.3, visual_score: 0.25, reason_tags: [] },
    { result_id: "r2", total_score: 0.88, source_score: 0.91, montage_score: 0.32, visual_score: 0.26, reason_tags: [] },
    { result_id: "r3", total_score: 0.7, source_score: 0.45, montage_score: 0.82, visual_score: 0.79, reason_tags: [] }
  ];

  const deduped = dedupeRankedResearchResultsByStory(results, rankedResults);

  assert.equal(deduped.removed_count, 1);
  assert.equal(deduped.cluster_count, 1);
  assert.deepEqual(
    deduped.results.map((item) => item.id),
    ["r2", "r3"]
  );
  const keptStory = deduped.ranked_results.find((item) => item.result_id === "r2");
  assert.equal(keptStory.story_cluster_size, 2);
  assert.match((keptStory.reason_tags ?? []).join(" "), /story_cluster:2/);
});

test("mergeResearchScores penalizes candidates with bad operational memory", () => {
  const results = [
    {
      id: "clean",
      title: "Official briefing on ceasefire negotiations",
      url: "https://clean.example.com/briefing",
      domain: "clean.example.com",
      snippet: "Primary source update",
      content_type: "article"
    },
    {
      id: "risky",
      title: "Raw footage from ceasefire negotiations",
      url: "https://risky.example.com/watch",
      domain: "risky.example.com",
      snippet: "Video source",
      content_type: "video"
    }
  ];
  const llmScores = [
    { result_id: "clean", relevance_score: 0.72, visual_score: 0.44, source_score: 0.74, freshness_score: 0.55, downloadability_score: 0.42, total_score: 0.7 },
    { result_id: "risky", relevance_score: 0.72, visual_score: 0.66, source_score: 0.74, freshness_score: 0.55, downloadability_score: 0.68, total_score: 0.76 }
  ];
  const sourceMemory = {
    version: 2,
    domains: {
      "risky.example.com": {
        applied_count: 5,
        helpful_count: 0,
        source_count: 0,
        attach_count: 0,
        screenshot_count: 0,
        download_count: 0,
        dismissed_count: 2,
        duplicate_story_count: 1,
        bad_visual_count: 1,
        screenshot_fail_count: 2,
        download_fail_count: 3,
        paywall_count: 1,
        anti_bot_count: 2,
        age_gate_count: 1
      }
    },
    urls: {},
    recent: [],
    patterns: []
  };

  const ranked = mergeResearchScores(results, llmScores, {}, sourceMemory, {
    section_title: "Ceasefire talks",
    text_quote: "Ceasefire negotiations resumed overnight after strikes."
  });
  const clean = ranked.find((item) => item.result_id === "clean");
  const risky = ranked.find((item) => item.result_id === "risky");

  assert.ok(clean);
  assert.ok(risky);
  assert.ok(clean.total_score > risky.total_score);
  assert.ok(Number(risky.downloadability_score) < 0.68);
  assert.match((risky.reason_tags ?? []).join(" "), /download_fail_risk/);
  assert.match((risky.reason_tags ?? []).join(" "), /anti_bot_prone/);
  assert.match((risky.reason_tags ?? []).join(" "), /dismissed_before/);
});

test("source memory stores negative outcomes without counting them as positive usage", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-source-memory-"));
  try {
    const store = createSourceMemoryStore({
      dataDir: tempDir,
      readOptionalJson: async (filePath) => {
        try {
          return JSON.parse(await fs.readFile(filePath, "utf8"));
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
      },
      writeJson: async (filePath, value) => {
        await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
      }
    });

    await store.recordSourceUsage({
      domain: "example.com",
      url: "https://example.com/a",
      action: "dismissed",
      title: "Dismissed source",
      section_title: "Intro",
      text_quote: "Quoted text"
    });
    const memory = await store.recordSourceUsage({
      domain: "example.com",
      url: "https://example.com/a",
      action: "download_failed",
      title: "Failed source",
      section_title: "Intro",
      text_quote: "Quoted text"
    });

    assert.equal(memory.domains["example.com"].applied_count, 0);
    assert.equal(memory.domains["example.com"].dismissed_count, 1);
    assert.equal(memory.domains["example.com"].download_fail_count, 1);
    assert.equal(memory.urls["https://example.com/a"].applied_count, 0);
    assert.equal(memory.urls["https://example.com/a"].dismissed_count, 1);
    assert.equal(memory.urls["https://example.com/a"].download_fail_count, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("detectResearchOutcomeAction classifies downloader and screenshot failures", () => {
  assert.equal(
    detectResearchOutcomeAction({
      url: "https://youtube.com/watch?v=abc",
      errorDetail: "Sign in to confirm your age. This video may be inappropriate for some users",
      operatorNotice: { code: "youtube_auth_refresh_required" },
      source: "download"
    }),
    "age_gate"
  );
  assert.equal(
    detectResearchOutcomeAction({
      url: "https://example.com/story",
      errorDetail: "subscriber-only paywall, subscribe to continue",
      source: "screenshot"
    }),
    "paywall"
  );
  assert.equal(
    detectResearchOutcomeAction({
      url: "https://example.com/story",
      errorDetail: "screenshot blocked by anti-bot",
      source: "screenshot"
    }),
    "anti_bot"
  );
  assert.equal(
    detectResearchOutcomeAction({
      url: "https://example.com/video",
      errorDetail: "yt-dlp exited with code 1",
      source: "download"
    }),
    "download_failed"
  );
});

test("research store keeps auto-recorded failure metadata on applied results", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-research-store-"));
  try {
    const ensureDocDir = async (docId) => {
      await fs.mkdir(path.join(tempDir, docId), { recursive: true });
    };
    const store = createResearchStore({
      ensureDocDir,
      getDocDir: (docId) => path.join(tempDir, docId),
      readOptionalJson: async (filePath) => {
        try {
          return JSON.parse(await fs.readFile(filePath, "utf8"));
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
      },
      writeJson: async (filePath, value) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
      }
    });

    await store.saveRun("doc_test", {
      run_id: "run_1",
      segment_id: "seg_1",
      results: [{ id: "res_1", url: "https://example.com/story" }]
    });

    const updated = await store.markApplied("doc_test", "run_1", {
      result_id: "res_1",
      action: "anti_bot",
      applied_at: "2026-04-10T12:00:00.000Z",
      meta: {
        auto_recorded: true,
        source: "media_download",
        url: "https://example.com/story"
      }
    });

    assert.equal(updated.applied.length, 1);
    assert.equal(updated.applied[0].action, "anti_bot");
    assert.equal(updated.applied[0].meta.auto_recorded, true);
    assert.equal(updated.applied[0].meta.source, "media_download");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
