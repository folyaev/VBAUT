import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-backend-test-"));
process.env.DATA_DIR = testDataDir;

const { app } = await import("../src/index.js");

let server = null;
let baseUrl = "";

async function createDocument(rawText = "Smoke test script text") {
  const response = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_text: rawText })
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data?.id);
  return data;
}

before(async () => {
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

test("GET /api/health returns ok", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data, { ok: true });
});

test("misc/media config endpoints return expected shape", async () => {
  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const configData = await configResponse.json();
  assert.equal(typeof configData, "object");
  assert.notEqual(configData, null);

  const downloaderResponse = await fetch(`${baseUrl}/api/downloader/config`);
  assert.equal(downloaderResponse.status, 200);
  const downloaderData = await downloaderResponse.json();
  assert.equal(downloaderData?.note, "Downloader uses yt-dlp only");
  assert.equal(typeof downloaderData?.tools, "object");
  assert.notEqual(downloaderData?.tools, null);

  const uiAuditResponse = await fetch(`${baseUrl}/api/audit/ui-actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "test",
      actions: [
        {
          ts: new Date().toISOString(),
          type: "click",
          path: "/",
          doc_id: null,
          target: { tag: "button", text: "test" },
          meta: { trusted: true }
        }
      ]
    })
  });
  assert.equal(uiAuditResponse.status, 200);
  const uiAuditData = await uiAuditResponse.json();
  assert.equal(uiAuditData?.ok, true);
  assert.equal(Number(uiAuditData?.accepted), 1);

  const versionResponse = await fetch(`${baseUrl}/api/downloader/yt-dlp/version`);
  assert.equal(versionResponse.status, 200);
  const versionData = await versionResponse.json();
  assert.equal(typeof versionData?.available, "boolean");

  if (!versionData?.available) {
    const updateResponse = await fetch(`${baseUrl}/api/downloader/yt-dlp:update`, {
      method: "POST"
    });
    assert.equal(updateResponse.status, 503);
  }
});

test("notion progress endpoint returns 404 for unknown progress id", async () => {
  const response = await fetch(`${baseUrl}/api/notion/progress/unknown_progress_id`);
  assert.equal(response.status, 404);
  const data = await response.json();
  assert.equal(data?.error, "Progress session not found");
});

test("POST/GET document lifecycle works", async () => {
  const rawText = "   Smoke test script text   ";
  const created = await createDocument(rawText);

  const getResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(created.id)}`);
  assert.equal(getResponse.status, 200);
  const loaded = await getResponse.json();
  assert.equal(loaded?.document?.id, created.id);
  assert.equal(loaded?.document?.raw_text, rawText.trim());
});

test("session/segments/decisions endpoints keep state consistent", async () => {
  const created = await createDocument("Session smoke text");
  const docId = created.id;

  const segment = {
    segment_id: "news_01",
    block_type: "news",
    text_quote: "Segment text",
    section_id: "section_01",
    section_title: "Topic",
    section_index: 1,
    links: [],
    segment_status: null,
    is_done: false,
    version: 1
  };
  const decision = {
    segment_id: "news_01",
    visual_decision: {
      type: "image",
      description: "Test visual",
      format_hint: "2:1",
      duration_hint_sec: 5,
      priority: "обязательно",
      media_file_path: null,
      media_start_timecode: null
    },
    search_decision: {
      keywords: ["alpha"],
      queries: ["alpha query"]
    },
    search_decision_en: {
      keywords: ["alpha en"],
      queries: ["alpha en query"]
    },
    version: 1
  };

  const sessionResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/session`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_text: "Session smoke text updated",
      segments: [segment],
      decisions: [decision],
      source: "test"
    })
  });
  assert.equal(sessionResponse.status, 200);
  const sessionData = await sessionResponse.json();
  assert.equal(sessionData?.segments?.length, 1);
  assert.equal(sessionData?.decisions?.length, 1);
  assert.ok(Number(sessionData?.segments_version) >= 1);
  assert.ok(Number(sessionData?.decisions_version) >= 1);
  assert.ok(Number(sessionData?.revision) > 0);

  const stateResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/state`);
  assert.equal(stateResponse.status, 200);
  const stateData = await stateResponse.json();
  assert.ok(Number(stateData?.revision) > 0);

  const segmentsUpdateResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      segments: [
        {
          ...segment,
          text_quote: "Segment text updated"
        }
      ]
    })
  });
  assert.equal(segmentsUpdateResponse.status, 200);
  const segmentsUpdateData = await segmentsUpdateResponse.json();
  assert.equal(segmentsUpdateData?.segments?.[0]?.text_quote, "Segment text updated");
  assert.ok(Number(segmentsUpdateData?.version) >= 1);

  const decisionsUpdateResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/decisions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      decisions: [
        {
          ...decision,
          search_decision: {
            keywords: ["beta"],
            queries: ["beta query"]
          }
        }
      ]
    })
  });
  assert.equal(decisionsUpdateResponse.status, 200);
  const decisionsUpdateData = await decisionsUpdateResponse.json();
  assert.equal(decisionsUpdateData?.decisions?.[0]?.search_decision?.keywords?.[0], "beta");
  assert.ok(Number(decisionsUpdateData?.version) >= 1);

  const datasetResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/dataset`);
  assert.equal(datasetResponse.status, 200);
  const datasetData = await datasetResponse.json();
  assert.equal(datasetData?.dataset?.length, 1);
  assert.equal(datasetData?.dataset?.[0]?.segment, "Segment text updated");
  assert.equal(datasetData?.dataset?.[0]?.keywords?.[0], "beta");

  const docResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}`);
  assert.equal(docResponse.status, 200);
  const docData = await docResponse.json();
  assert.equal(docData?.segments?.[0]?.text_quote, "Segment text updated");
  assert.equal(docData?.decisions?.[0]?.search_decision?.keywords?.[0], "beta");

  const eventsResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/events`);
  assert.equal(eventsResponse.status, 200);
  const eventsData = await eventsResponse.json();
  const eventNames = new Set((eventsData?.events ?? []).map((item) => item?.event));
  assert.ok(eventNames.has("session_saved"));
  assert.ok(eventNames.has("segments_updated"));
  assert.ok(eventNames.has("decisions_updated"));
});

test("generation endpoints keep expected 404/400 behavior", async () => {
  const missingResponse = await fetch(`${baseUrl}/api/documents/missing_doc/segments:generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(missingResponse.status, 404);
  const missingData = await missingResponse.json();
  assert.equal(missingData?.error, "Document not found");

  const created = await createDocument("Generation smoke text");
  const docId = created.id;

  const decisionsResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/decisions:generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(decisionsResponse.status, 400);
  const decisionsData = await decisionsResponse.json();
  assert.equal(decisionsData?.error, "Segments not found");

  const searchResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/search:generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(searchResponse.status, 400);
  const searchData = await searchResponse.json();
  assert.equal(searchData?.error, "Segments not found");

  const searchEnResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/search-en:generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(searchEnResponse.status, 400);
  const searchEnData = await searchEnResponse.json();
  assert.equal(searchEnData?.error, "Segments not found");
});

test("export endpoints keep expected formats and validations", async () => {
  const created = await createDocument("Export smoke text");
  const docId = created.id;
  const segment = {
    segment_id: "news_01",
    block_type: "news",
    text_quote: "Export segment text",
    section_id: "section_01",
    section_title: "Export Topic",
    section_index: 1,
    links: [],
    segment_status: null,
    is_done: false,
    version: 1
  };
  const decision = {
    segment_id: "news_01",
    visual_decision: {
      type: "image",
      description: "Export visual",
      format_hint: "2:1",
      duration_hint_sec: 5,
      priority: "обязательно",
      media_file_path: null,
      media_start_timecode: null
    },
    search_decision: {
      keywords: ["export"],
      queries: ["export query"]
    },
    search_decision_en: {
      keywords: ["export en"],
      queries: ["export en query"]
    },
    version: 1
  };

  const sessionResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/session`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_text: "Export smoke text",
      segments: [segment],
      decisions: [decision],
      source: "test"
    })
  });
  assert.equal(sessionResponse.status, 200);

  const badFormatResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/export?format=zip`);
  assert.equal(badFormatResponse.status, 400);
  const badFormatData = await badFormatResponse.json();
  assert.equal(badFormatData?.error, "format must be jsonl, md or xml");

  const jsonlResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/export?format=jsonl`);
  assert.equal(jsonlResponse.status, 200);
  assert.ok(String(jsonlResponse.headers.get("content-type") ?? "").includes("application/jsonl"));
  const jsonlBody = await jsonlResponse.text();
  const jsonlLines = jsonlBody.split(/\r?\n/).filter(Boolean);
  assert.equal(jsonlLines.length, 1);
  const jsonlRow = JSON.parse(jsonlLines[0]);
  assert.equal(jsonlRow?.meta?.segment_id, "news_01");

  const mdResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/export?format=md`);
  assert.equal(mdResponse.status, 200);
  assert.ok(String(mdResponse.headers.get("content-type") ?? "").includes("text/markdown"));
  const mdBody = await mdResponse.text();
  assert.ok(mdBody.includes("# Экспорт документа"));
  assert.ok(mdBody.includes("news_01"));

  const xmlResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/export?format=xml`);
  assert.equal(xmlResponse.status, 400);
  const xmlData = await xmlResponse.json();
  assert.equal(xmlData?.error, "No segments with attached media files found for XML export");
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  await fs.rm(testDataDir, { recursive: true, force: true });
});
