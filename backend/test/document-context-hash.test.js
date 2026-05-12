import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDocumentContextHashUtils } from "../src/services/document-context-hash.js";
import { normalizeVisualDecisionInput } from "../src/services/normalizers.js";

test("document context hash changes when media file content changes", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-context-hash-"));
  const mediaRoot = path.join(tempRoot, "PAMPAM");
  const themeDir = path.join(mediaRoot, "Bieber");
  await fs.mkdir(themeDir, { recursive: true });
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
  });

  const mediaPath = path.join(themeDir, "shot.mp4");
  await fs.writeFile(mediaPath, "v1", "utf8");

  const { buildDocumentContextHash } = createDocumentContextHashUtils({
    getMediaDir: () => mediaRoot,
    normalizeVisualDecisionInput,
    sanitizeMediaTopicName: (value) => String(value ?? "").trim() || "Без темы"
  });

  const segments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Story",
      section_title: "Bieber"
    }
  ];
  const decisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        type: "video",
        media_file_paths: ["Bieber/shot.mp4"]
      }
    }
  ];

  const first = await buildDocumentContextHash("doc_hash", segments, decisions);
  await fs.writeFile(mediaPath, "v2 updated", "utf8");
  const second = await buildDocumentContextHash("doc_hash", segments, decisions);

  assert.notEqual(first.context_hash, second.context_hash);
  assert.notEqual(first.themes[0]?.context_hash, second.themes[0]?.context_hash);
});

test("document context hash is stable for unchanged input", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-context-hash-stable-"));
  const mediaRoot = path.join(tempRoot, "PAMPAM");
  const themeDir = path.join(mediaRoot, "Topic");
  await fs.mkdir(themeDir, { recursive: true });
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
  });

  await fs.writeFile(path.join(themeDir, "clip.mp4"), "video", "utf8");

  const { buildDocumentContextHash } = createDocumentContextHashUtils({
    getMediaDir: () => mediaRoot,
    normalizeVisualDecisionInput,
    sanitizeMediaTopicName: (value) => String(value ?? "").trim() || "Без темы"
  });

  const segments = [
    {
      segment_id: "news_01",
      block_type: "news",
      text_quote: "Story",
      section_title: "Topic"
    }
  ];
  const decisions = [
    {
      segment_id: "news_01",
      visual_decision: {
        type: "video",
        media_file_paths: ["Topic/clip.mp4"]
      }
    }
  ];

  const first = await buildDocumentContextHash("doc_hash", segments, decisions);
  const second = await buildDocumentContextHash("doc_hash", segments, decisions);

  assert.equal(first.context_hash, second.context_hash);
  assert.equal(first.themes[0]?.context_hash, second.themes[0]?.context_hash);
});
