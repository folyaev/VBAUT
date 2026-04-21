import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-route-data-"));
const testMediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-route-media-"));
const testBackgroundDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-route-bg-"));
process.env.DATA_DIR = testDataDir;
process.env.MEDIA_DOWNLOAD_ROOT = testMediaDir;
process.env.XML_BACKGROUND_ROOT = testBackgroundDir;
process.env.TELEGRAM_SDVG_ENABLED = "0";

const { app, shutdownServerRuntime } = await import("../src/index.js");

let server = null;
let baseUrl = "";

async function createDocument(rawText = "XML route test script") {
  const response = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_text: rawText })
  });
  assert.equal(response.status, 200);
  return response.json();
}

before(async () => {
  await Promise.all([
    fs.writeFile(path.join(testMediaDir, "clip-a.mp4"), ""),
    fs.writeFile(path.join(testMediaDir, "clip-b.mp4"), "")
  ]);

  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Cannot resolve test server address"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

test("XML export can target a single topic by explicit segment_ids", async () => {
  const document = await createDocument();
  const docId = document.id;

  const sessionResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/session`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_text: "Topic A\nTopic B",
      segments: [
        {
          segment_id: "seg_a",
          block_type: "news",
          text_quote: "Clip A",
          section_id: "section_a",
          section_title: "Topic A",
          section_index: 0
        },
        {
          segment_id: "seg_b",
          block_type: "news",
          text_quote: "Clip B",
          section_id: "section_b",
          section_title: "Topic B",
          section_index: 1
        }
      ],
      decisions: [
        {
          segment_id: "seg_a",
          visual_decision: {
            media_file_path: "clip-a.mp4",
            duration_hint_sec: 3
          },
          search_decision: {}
        },
        {
          segment_id: "seg_b",
          visual_decision: {
            media_file_path: "clip-b.mp4",
            duration_hint_sec: 3
          },
          search_decision: {}
        }
      ],
      source: "test"
    })
  });
  assert.equal(sessionResponse.status, 200);

  const params = new URLSearchParams({
    format: "xml",
    scope: "section",
    section_id: "section_a",
    section_title: "Topic A",
    segment_ids: "seg_a"
  });
  const xmlResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/export?${params.toString()}`);
  assert.equal(xmlResponse.status, 200);
  const xml = await xmlResponse.text();

  assert.match(xml, /<name>clip-a\.mp4<\/name>/);
  assert.doesNotMatch(xml, /<name>clip-b\.mp4<\/name>/);
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  await shutdownServerRuntime?.();
  await Promise.all(
    [testDataDir, testMediaDir, testBackgroundDir].map((target) =>
      fs.rm(target, { recursive: true, force: true }).catch(() => null)
    )
  );
  delete process.env.DATA_DIR;
  delete process.env.MEDIA_DOWNLOAD_ROOT;
  delete process.env.XML_BACKGROUND_ROOT;
});
