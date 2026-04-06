import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-backend-test-"));
process.env.DATA_DIR = testDataDir;
process.env.TELEGRAM_SDVG_ENABLED = "0";

const { app, shutdownServerRuntime } = await import("../src/index.js");

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

  const sourceProfilesResponse = await fetch(`${baseUrl}/api/source-profiles`);
  assert.equal(sourceProfilesResponse.status, 200);
  const sourceProfilesData = await sourceProfilesResponse.json();
  assert.equal(Array.isArray(sourceProfilesData?.profiles?.trusted_domains), true);
  assert.equal(sourceProfilesData?.profiles?.trusted_domains.includes("reuters.com"), true);

  const updateSourceProfilesResponse = await fetch(`${baseUrl}/api/source-profiles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profiles: {
        ...sourceProfilesData?.profiles,
        trusted_domains: [...(sourceProfilesData?.profiles?.trusted_domains ?? []), "example.com"],
        domain_profiles: {
          ...(sourceProfilesData?.profiles?.domain_profiles ?? {}),
          "example.com": { trusted: true, source_bias: 0.25 }
        }
      }
    })
  });
  assert.equal(updateSourceProfilesResponse.status, 200);
  const updateSourceProfilesData = await updateSourceProfilesResponse.json();
  assert.equal(updateSourceProfilesData?.profiles?.trusted_domains.includes("example.com"), true);
  assert.equal(Boolean(updateSourceProfilesData?.profiles?.domain_profiles?.["example.com"]?.trusted), true);

  const sourceMemoryResponse = await fetch(`${baseUrl}/api/source-memory`);
  assert.equal(sourceMemoryResponse.status, 200);
  const sourceMemoryData = await sourceMemoryResponse.json();
  assert.equal(typeof sourceMemoryData?.summary, "object");

  const downloaderResponse = await fetch(`${baseUrl}/api/downloader/config`);
  assert.equal(downloaderResponse.status, 200);
  const downloaderData = await downloaderResponse.json();
  assert.equal(
    downloaderData?.note,
    "Primary downloader is yt-dlp; gallery-dl fallback is used for TikTok and can supplement X/Twitter posts"
  );
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

test("integration layer stores assets, attachments, releases, and bot sessions", async () => {
  const createAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "telegram_media",
      title: "Smoke asset",
      status: "new",
      source_url: "https://t.me/c/1/2"
    })
  });
  assert.equal(createAssetResponse.status, 201);
  const createAssetData = await createAssetResponse.json();
  assert.equal(createAssetData?.asset?.kind, "telegram_media");
  const assetId = createAssetData?.asset?.id;
  assert.ok(assetId);

  const attachResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(assetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "segment",
      target_id: "seg_smoke_01",
      role: "visual"
    })
  });
  assert.equal(attachResponse.status, 201);
  const attachData = await attachResponse.json();
  assert.equal(attachData?.attachment?.target_type, "segment");

  const getAssetResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(assetId)}`);
  assert.equal(getAssetResponse.status, 200);
  const getAssetData = await getAssetResponse.json();
  assert.equal(getAssetData?.asset?.attachments?.length, 1);
  assert.equal(Number(getAssetData?.asset?.attachment_count), 1);

  const createReleaseResponse = await fetch(`${baseUrl}/api/releases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Evening release",
      status: "draft",
      document_id: "doc_smoke"
    })
  });
  assert.equal(createReleaseResponse.status, 201);
  const createReleaseData = await createReleaseResponse.json();
  assert.equal(createReleaseData?.release?.title, "Evening release");
  const releaseId = createReleaseData?.release?.id;
  assert.ok(releaseId);

  const releaseAttachResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(assetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "release",
      target_id: releaseId,
      role: "story"
    })
  });
  assert.equal(releaseAttachResponse.status, 201);
  const releaseAttachData = await releaseAttachResponse.json();
  const releaseAttachmentId = releaseAttachData?.attachment?.id;
  assert.ok(releaseAttachmentId);

  const releaseDetailResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}`);
  assert.equal(releaseDetailResponse.status, 200);
  const releaseDetailData = await releaseDetailResponse.json();
  assert.equal(Number(releaseDetailData?.release?.asset_count), 1);
  assert.equal(releaseDetailData?.release?.assets?.[0]?.asset?.id, assetId);
  assert.equal(Number(releaseDetailData?.release?.assets?.[0]?.attachment?.sort_order), 1);

  const createSecondAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Smoke asset 2",
      status: "new",
      source_url: "https://www.youtube.com/watch?v=smoke-story",
      source_domain: "youtube.com"
    })
  });
  assert.equal(createSecondAssetResponse.status, 201);
  const createSecondAssetData = await createSecondAssetResponse.json();
  const secondAssetId = createSecondAssetData?.asset?.id;
  assert.ok(secondAssetId);

  const secondReleaseAttachResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(secondAssetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "release",
      target_id: releaseId,
      role: "story"
    })
  });
  assert.equal(secondReleaseAttachResponse.status, 201);
  const secondReleaseAttachData = await secondReleaseAttachResponse.json();
  const secondReleaseAttachmentId = secondReleaseAttachData?.attachment?.id;
  assert.ok(secondReleaseAttachmentId);
  assert.equal(Number(secondReleaseAttachData?.attachment?.sort_order), 2);

  const reorderReleaseResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/rundown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attachment_ids: [secondReleaseAttachmentId, releaseAttachmentId]
    })
  });
  assert.equal(reorderReleaseResponse.status, 200);
  const reorderReleaseData = await reorderReleaseResponse.json();
  assert.equal(reorderReleaseData?.release?.assets?.[0]?.asset?.id, secondAssetId);
  assert.equal(reorderReleaseData?.release?.assets?.[1]?.asset?.id, assetId);

  const patchAttachmentResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(secondAssetId)}/attachments/${encodeURIComponent(secondReleaseAttachmentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item_status: "visual_ready",
        script_note: "Open with headline",
        visual_note: "Need clean screenshot"
      })
    }
  );
  assert.equal(patchAttachmentResponse.status, 200);
  const patchAttachmentData = await patchAttachmentResponse.json();
  assert.equal(patchAttachmentData?.attachment?.item_status, "visual_ready");
  assert.equal(patchAttachmentData?.attachment?.script_note, "Open with headline");
  assert.equal(patchAttachmentData?.attachment?.visual_note, "Need clean screenshot");

  const releaseDetailAfterPatchResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}`);
  assert.equal(releaseDetailAfterPatchResponse.status, 200);
  const releaseDetailAfterPatchData = await releaseDetailAfterPatchResponse.json();
  assert.equal(releaseDetailAfterPatchData?.release?.assets?.[0]?.attachment?.item_status, "visual_ready");
  assert.equal(releaseDetailAfterPatchData?.release?.assets?.[0]?.attachment?.script_note, "Open with headline");

  const createRecommendedAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "downloaded_media",
      title: "Reuters smoke source video",
      status: "processed",
      source_url: "https://example.com/smoke-visual",
      source_domain: "reuters.com",
      processing_state: "processed",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createRecommendedAssetResponse.status, 201);
  const createRecommendedAssetData = await createRecommendedAssetResponse.json();
  const recommendedAssetId = createRecommendedAssetData?.asset?.id;
  assert.ok(recommendedAssetId);

  const attachRecommendedToDocResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(recommendedAssetId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "document",
        target_id: "doc_smoke",
        role: "reference"
      })
    }
  );
  assert.equal(attachRecommendedToDocResponse.status, 201);

  const createSecondRecommendedAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "screenshot",
      title: "Border footage frame",
      status: "processed",
      source_url: "https://example.com/smoke-frame",
      source_domain: "youtube.com",
      processing_state: "processed",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createSecondRecommendedAssetResponse.status, 201);
  const createSecondRecommendedAssetData = await createSecondRecommendedAssetResponse.json();
  const secondRecommendedAssetId = createSecondRecommendedAssetData?.asset?.id;
  assert.ok(secondRecommendedAssetId);

  const smokeDocDir = path.join(testDataDir, "doc_smoke");
  await fs.mkdir(smokeDocDir, { recursive: true });
  await fs.writeFile(
    path.join(smokeDocDir, "document.json"),
    JSON.stringify(
      {
        id: "doc_smoke",
        title: "Smoke Doc",
        raw_text: "Smoke release segment about border footage",
        media_downloads: {
          "https://www.youtube.com/watch?v=smoke-story": {
            url: "https://www.youtube.com/watch?v=smoke-story",
            status: "completed",
            section_title: "Smoke Topic",
            output_files: ["downloads/smoke-topic/story.mp4"],
            updated_at: "2026-03-22T10:00:00Z"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(smokeDocDir, "segments.json"),
    JSON.stringify(
      [
        {
          segment_id: "seg_smoke_01",
          block_type: "news",
          text_quote: "Smoke release segment about border footage",
          section_id: "topic_01",
          section_title: "Smoke Topic",
          section_index: 1
        }
      ],
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(smokeDocDir, "research.json"),
    JSON.stringify(
      {
        version: 1,
        runs: [
          {
            run_id: "research_smoke_01",
            segment_id: "seg_smoke_01",
            section_id: "topic_01",
            section_title: "Smoke Topic",
            status: "done",
            mode: "fast",
            queries: [],
            results: [
              {
                id: "smoke_result_1",
                url: "https://www.reuters.com/world/us/smoke-source",
                title: "Reuters smoke source",
                snippet: "Reuters source about the smoke segment",
                domain: "reuters.com",
                published_at: "2026-03-22T10:00:00Z",
                content_type: "article"
              },
              {
                id: "smoke_result_2",
                url: "https://www.youtube.com/watch?v=smoke-frame",
                title: "Border footage frame",
                snippet: "Border footage frame visual reference",
                domain: "youtube.com",
                published_at: "2026-03-22T10:00:00Z",
                content_type: "video"
              }
            ],
            ranked_results: [
              {
                result_id: "smoke_result_1",
                total_score: 0.91,
                source_score: 0.92,
                visual_score: 0.41,
                montage_score: 0.3,
                downloadability_score: 0.2
              },
              {
                result_id: "smoke_result_2",
                total_score: 0.88,
                source_score: 0.34,
                visual_score: 0.93,
                montage_score: 0.54,
                downloadability_score: 0.68
              }
            ],
            summary: {
              notes: ["Top source: Reuters smoke source", "Top visual: Border footage frame"]
            },
            brief: {
              summary: "Best Source: Reuters smoke source | Best Visual: Border footage frame",
              items: [
                {
                  key: "source",
                  label: "Best Source",
                  title: "Reuters smoke source",
                  domain: "reuters.com",
                  score: 0.91,
                  role: "main_source"
                },
                {
                  key: "visual",
                  label: "Best Visual",
                  title: "Border footage frame",
                  domain: "youtube.com",
                  score: 0.88,
                  role: "visual_candidate"
                }
              ]
            },
            warnings: [],
            applied: [],
            created_at: "2026-03-22T10:00:00Z",
            updated_at: "2026-03-22T10:00:00Z"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const attachSecondRecommendedToDocResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(secondRecommendedAssetId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "document",
        target_id: "doc_smoke",
        role: "reference"
      })
    }
  );
  assert.equal(attachSecondRecommendedToDocResponse.status, 201);

  const recommendationsResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/recommendations`);
  assert.equal(recommendationsResponse.status, 200);
  const recommendationsData = await recommendationsResponse.json();
  assert.equal(Number(recommendationsData?.recommendations?.summary?.total_candidates) >= 2, true);
  assert.equal(
    recommendationsData?.recommendations?.candidates?.some((item) => item?.asset?.id === recommendedAssetId),
    true
  );
  assert.equal(
    recommendationsData?.recommendations?.candidates?.some((item) =>
      Array.isArray(item?.reasons) &&
      item.reasons.some((reason) => ["research_domain", "research_visual", "research_source"].includes(String(reason?.key ?? "")))
    ),
    true
  );
  assert.equal(
    recommendationsData?.recommendations?.candidates?.some((item) => String(item?.matched_section_title ?? "") === "Smoke Topic"),
    true
  );

  const markHelpfulForReleaseResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent("doc_smoke")}/segments/${encodeURIComponent("seg_smoke_01")}/research/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: "research_smoke_01",
        result_id: "smoke_result_1",
        action: "mark_helpful"
      })
    }
  );
  assert.equal(markHelpfulForReleaseResponse.status, 200);

  const recommendationsAfterHelpfulResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/recommendations`
  );
  assert.equal(recommendationsAfterHelpfulResponse.status, 200);
  const recommendationsAfterHelpfulData = await recommendationsAfterHelpfulResponse.json();
  const helpfulRecommendation = recommendationsAfterHelpfulData?.recommendations?.candidates?.find(
    (item) => item?.asset?.id === recommendedAssetId
  );
  assert.equal(Boolean(helpfulRecommendation), true);
  assert.equal(
    Array.isArray(helpfulRecommendation?.reasons) &&
      helpfulRecommendation.reasons.some((reason) => String(reason?.key ?? "") === "source_memory_helpful"),
    true
  );

  const researchBriefMarkdownResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent("doc_smoke")}/segments/${encodeURIComponent("seg_smoke_01")}/research/brief?format=md`
  );
  assert.equal(researchBriefMarkdownResponse.status, 200);
  const researchBriefMarkdown = await researchBriefMarkdownResponse.text();
  assert.match(researchBriefMarkdown, /# Segment Research Brief/);
  assert.match(researchBriefMarkdown, /## Main Picks/);
  assert.match(researchBriefMarkdown, /(Main Source\*\*: Reuters smoke source|Main Visual\*\*: Border footage frame)/);

  const fillMissingVisualsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/fill-missing-visuals`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 })
    }
  );
  assert.equal(fillMissingVisualsResponse.status, 200);
  const fillMissingVisualsData = await fillMissingVisualsResponse.json();
  assert.equal(Boolean(String(fillMissingVisualsData?.auto_backup?.backup_id ?? "").trim()), true);
  assert.equal(Number(fillMissingVisualsData?.attached), 1);
  assert.equal(Number(fillMissingVisualsData?.updated), 1);
  assert.equal(Array.isArray(fillMissingVisualsData?.actions), true);

  const attachRecommendationsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/attach-recommendations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, asset_ids: [recommendedAssetId] })
    }
  );
  assert.equal(attachRecommendationsResponse.status, 200);
  const attachRecommendationsData = await attachRecommendationsResponse.json();
  assert.equal(Boolean(String(attachRecommendationsData?.auto_backup?.backup_id ?? "").trim()), true);
  assert.equal(Number(attachRecommendationsData?.attached), 1);
  assert.equal(Number(attachRecommendationsData?.skipped), 0);
  assert.deepEqual(attachRecommendationsData?.selected_ids, [recommendedAssetId]);
  assert.deepEqual(attachRecommendationsData?.attached_ids, [recommendedAssetId]);
  assert.equal(
    Array.isArray(attachRecommendationsData?.results) &&
      attachRecommendationsData.results.some(
        (item) => item?.asset_id === recommendedAssetId && item?.status === "attached"
      ),
    true
  );

  const releaseOutcomeMemoryResponse = await fetch(`${baseUrl}/api/release-outcome-memory`);
  assert.equal(releaseOutcomeMemoryResponse.status, 200);
  const releaseOutcomeMemoryData = await releaseOutcomeMemoryResponse.json();
  assert.equal(Number(releaseOutcomeMemoryData?.summary?.total_domains) >= 1, true);
  assert.equal(Number(releaseOutcomeMemoryData?.summary?.top_kinds?.length) >= 1, true);

  const createOutcomeFollowupMediaResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "downloaded_media",
      title: "Reuters smoke source follow-up",
      status: "processed",
      source_url: "https://example.com/smoke-followup-media",
      source_domain: "reuters.com",
      processing_state: "processed",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createOutcomeFollowupMediaResponse.status, 201);
  const createOutcomeFollowupMediaData = await createOutcomeFollowupMediaResponse.json();
  const outcomeFollowupMediaId = createOutcomeFollowupMediaData?.asset?.id;
  assert.ok(outcomeFollowupMediaId);

  const attachOutcomeFollowupMediaResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(outcomeFollowupMediaId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "document",
        target_id: "doc_smoke",
        role: "reference"
      })
    }
  );
  assert.equal(attachOutcomeFollowupMediaResponse.status, 201);

  const createOutcomeFollowupScreenshotResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "screenshot",
      title: "Border footage frame follow-up",
      status: "processed",
      source_url: "https://example.com/smoke-followup-shot",
      source_domain: "youtube.com",
      processing_state: "processed",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createOutcomeFollowupScreenshotResponse.status, 201);
  const createOutcomeFollowupScreenshotData = await createOutcomeFollowupScreenshotResponse.json();
  const outcomeFollowupScreenshotId = createOutcomeFollowupScreenshotData?.asset?.id;
  assert.ok(outcomeFollowupScreenshotId);

  const attachOutcomeFollowupScreenshotResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(outcomeFollowupScreenshotId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "document",
        target_id: "doc_smoke",
        role: "reference"
      })
    }
  );
  assert.equal(attachOutcomeFollowupScreenshotResponse.status, 201);

  const recommendationsAfterOutcomeResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/recommendations`
  );
  assert.equal(recommendationsAfterOutcomeResponse.status, 200);
  const recommendationsAfterOutcomeData = await recommendationsAfterOutcomeResponse.json();
  assert.equal(
    recommendationsAfterOutcomeData?.recommendations?.candidates?.some((item) =>
      Array.isArray(item?.reasons) &&
      item.reasons.some((reason) => ["release_outcome_domain", "release_outcome_kind"].includes(String(reason?.key ?? "")))
    ),
    true
  );

  const draftPackResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/draft-pack`);
  assert.equal(draftPackResponse.status, 200);
  const draftPackData = await draftPackResponse.json();
  assert.equal(Number(draftPackData?.draft_pack?.summary?.total), 4);
  assert.equal(Number(draftPackData?.draft_pack?.summary?.script_candidates) >= 1, true);
  assert.equal(Number(draftPackData?.draft_pack?.summary?.visual_candidates) >= 1, true);
  assert.equal(
    draftPackData?.draft_pack?.items?.some(
      (item) =>
        String(item?.suggested_script_note ?? "").includes("Reuters smoke source") ||
        String(item?.suggested_visual_note ?? "").includes("Border footage frame")
    ),
    true
  );

  const applyDraftPackResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/apply-draft-pack`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "missing_only" })
    }
  );
  assert.equal(applyDraftPackResponse.status, 200);
  const applyDraftPackData = await applyDraftPackResponse.json();
  assert.equal(Boolean(String(applyDraftPackData?.auto_backup?.backup_id ?? "").trim()), true);
  assert.equal(Number(applyDraftPackData?.updated) >= 1, true);
  assert.equal(Number(applyDraftPackData?.draft_pack?.summary?.script_candidates), 0);
  assert.equal(Number(applyDraftPackData?.draft_pack?.summary?.visual_candidates), 0);

  const createSelectionAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Selection candidate",
      status: "new",
      source_url: "https://example.com/selection-candidate",
      source_domain: "example.com"
    })
  });
  assert.equal(createSelectionAssetResponse.status, 201);
  const createSelectionAssetData = await createSelectionAssetResponse.json();
  const selectionAssetId = createSelectionAssetData?.asset?.id;
  assert.ok(selectionAssetId);

  const attachSelectionAssetResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(selectionAssetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "release",
      target_id: releaseId,
      role: "story"
    })
  });
  assert.equal(attachSelectionAssetResponse.status, 201);
  const attachSelectionAssetData = await attachSelectionAssetResponse.json();
  const selectionAttachmentId = attachSelectionAssetData?.attachment?.id;
  assert.ok(selectionAttachmentId);

  const applySelectionDraftPackResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/apply-selection-draft-pack`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "missing_only",
        attachment_ids: [selectionAttachmentId]
      })
    }
  );
  assert.equal(applySelectionDraftPackResponse.status, 200);
  const applySelectionDraftPackData = await applySelectionDraftPackResponse.json();
  assert.equal(Number(applySelectionDraftPackData?.selected), 1);
  assert.equal(Number(applySelectionDraftPackData?.updated) >= 1, true);
  const selectedReleaseAfterDraft = applySelectionDraftPackData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(selectionAttachmentId)
  );
  assert.equal(Boolean(String(selectedReleaseAfterDraft?.attachment?.script_note ?? "").trim()), true);

  const createVisualSelectionAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Selection visual candidate",
      status: "new",
      source_url: "https://example.com/selection-visual",
      source_domain: "example.com"
    })
  });
  assert.equal(createVisualSelectionAssetResponse.status, 201);
  const createVisualSelectionAssetData = await createVisualSelectionAssetResponse.json();
  const visualSelectionAssetId = createVisualSelectionAssetData?.asset?.id;
  assert.ok(visualSelectionAssetId);

  const attachVisualSelectionAssetResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(visualSelectionAssetId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "release",
        target_id: releaseId,
        role: "story"
      })
    }
  );
  assert.equal(attachVisualSelectionAssetResponse.status, 201);
  const attachVisualSelectionAssetData = await attachVisualSelectionAssetResponse.json();
  const visualSelectionAttachmentId = attachVisualSelectionAssetData?.attachment?.id;
  assert.ok(visualSelectionAttachmentId);

  const patchVisualSelectionAttachmentResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(visualSelectionAssetId)}/attachments/${encodeURIComponent(visualSelectionAttachmentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script_note: "Selection visual script"
      })
    }
  );
  assert.equal(patchVisualSelectionAttachmentResponse.status, 200);

  const fillSelectionVisualsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/fill-selection-visuals`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [visualSelectionAttachmentId]
      })
    }
  );
  assert.equal(fillSelectionVisualsResponse.status, 200);
  const fillSelectionVisualsData = await fillSelectionVisualsResponse.json();
  assert.equal(Number(fillSelectionVisualsData?.selected), 1);
  assert.equal(Number(fillSelectionVisualsData?.updated) >= 1, true);
  const selectedReleaseAfterVisual = fillSelectionVisualsData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(visualSelectionAttachmentId)
  );
  assert.equal(Boolean(String(selectedReleaseAfterVisual?.attachment?.visual_note ?? "").trim()), true);

  const createBulkOpsAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Bulk ops candidate",
      status: "new",
      source_url: "https://example.com/bulk-ops",
      source_domain: "example.com"
    })
  });
  assert.equal(createBulkOpsAssetResponse.status, 201);
  const createBulkOpsAssetData = await createBulkOpsAssetResponse.json();
  const bulkOpsAssetId = createBulkOpsAssetData?.asset?.id;
  assert.ok(bulkOpsAssetId);

  const attachBulkOpsAssetResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(bulkOpsAssetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "release",
      target_id: releaseId,
      role: "story"
    })
  });
  assert.equal(attachBulkOpsAssetResponse.status, 201);
  const attachBulkOpsAssetData = await attachBulkOpsAssetResponse.json();
  const bulkOpsAttachmentId = attachBulkOpsAssetData?.attachment?.id;
  assert.ok(bulkOpsAttachmentId);

  const applySelectionTemplatesResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/apply-selection-note-templates`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [bulkOpsAttachmentId],
        script_template: "Bulk script template",
        visual_template: "Bulk visual template",
        overwrite: false
      })
    }
  );
  assert.equal(applySelectionTemplatesResponse.status, 200);
  const applySelectionTemplatesData = await applySelectionTemplatesResponse.json();
  assert.equal(Number(applySelectionTemplatesData?.updated), 1);

  const updateSelectionItemsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/update-selection-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [bulkOpsAttachmentId],
        patch: {
          item_status: "ready"
        }
      })
    }
  );
  assert.equal(updateSelectionItemsResponse.status, 200);
  const updateSelectionItemsData = await updateSelectionItemsResponse.json();
  assert.equal(Number(updateSelectionItemsData?.updated), 1);
  const bulkOpsAfterItemUpdate = updateSelectionItemsData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(bulkOpsAttachmentId)
  );
  assert.equal(String(bulkOpsAfterItemUpdate?.attachment?.item_status ?? ""), "ready");

  const updateSelectionAssetStatusResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/update-selection-asset-status`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [bulkOpsAttachmentId],
        status: "archived"
      })
    }
  );
  assert.equal(updateSelectionAssetStatusResponse.status, 200);
  const updateSelectionAssetStatusData = await updateSelectionAssetStatusResponse.json();
  assert.equal(Number(updateSelectionAssetStatusData?.updated), 1);
  const bulkOpsAfterAssetUpdate = updateSelectionAssetStatusData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(bulkOpsAttachmentId)
  );
  assert.equal(String(bulkOpsAfterAssetUpdate?.asset?.status ?? ""), "archived");

  const detachSelectionItemsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/detach-selection-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [bulkOpsAttachmentId]
      })
    }
  );
  assert.equal(detachSelectionItemsResponse.status, 200);
  const detachSelectionItemsData = await detachSelectionItemsResponse.json();
  assert.equal(Number(detachSelectionItemsData?.detached), 1);
  assert.equal(
    detachSelectionItemsData?.release?.assets?.some(
      (item) => String(item?.attachment?.id ?? "") === String(bulkOpsAttachmentId)
    ),
    false
  );

  const createPreparedAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Prepare selection candidate",
      status: "new",
      source_url: "https://example.com/prepare-selection",
      source_domain: "example.com",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createPreparedAssetResponse.status, 201);
  const createPreparedAssetData = await createPreparedAssetResponse.json();
  const preparedAssetId = createPreparedAssetData?.asset?.id;
  assert.ok(preparedAssetId);

  const attachPreparedAssetResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(preparedAssetId)}/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_type: "release",
      target_id: releaseId,
      role: "story"
    })
  });
  assert.equal(attachPreparedAssetResponse.status, 201);
  const attachPreparedAssetData = await attachPreparedAssetResponse.json();
  const preparedAttachmentId = attachPreparedAssetData?.attachment?.id;
  assert.ok(preparedAttachmentId);

  const prepareSelectionResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/prepare-selection`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment_ids: [preparedAttachmentId]
      })
    }
  );
  assert.equal(prepareSelectionResponse.status, 200);
  const prepareSelectionData = await prepareSelectionResponse.json();
  assert.equal(Number(prepareSelectionData?.selected), 1);
  assert.equal(Number(prepareSelectionData?.updated) >= 1, true);
  assert.equal(Array.isArray(prepareSelectionData?.prioritized_attachment_ids), true);
  assert.equal(String(prepareSelectionData?.prioritized_attachment_ids?.[0] ?? ""), String(preparedAttachmentId));
  const preparedSelectionItem = prepareSelectionData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(preparedAttachmentId)
  );
  const preparedSelectionVisualNote = String(preparedSelectionItem?.attachment?.visual_note ?? "");
  assert.equal(Boolean(String(preparedSelectionItem?.attachment?.script_note ?? "").trim()), true);
  assert.equal(Boolean(preparedSelectionVisualNote.trim()), true);
  assert.equal(String(preparedSelectionItem?.attachment?.script_note ?? "").includes("Reuters smoke source"), true);
  assert.equal(
    ["Border footage frame", "Border footage frame follow-up", "Reuters smoke source video", "Reuters smoke source follow-up"].some(
      (label) => preparedSelectionVisualNote.includes(label)
    ),
    true
  );
  assert.equal(String(preparedSelectionItem?.attachment?.assistant_trace_json?.script?.section_title ?? ""), "Smoke Topic");
  assert.equal(String(preparedSelectionItem?.attachment?.assistant_trace_json?.visual?.section_title ?? ""), "Smoke Topic");
  assert.equal(
    Boolean(
      String(preparedSelectionItem?.attachment?.assistant_trace_json?.visual?.recommendation?.asset_id ?? "").trim() ||
      String(preparedSelectionItem?.attachment?.assistant_trace_json?.visual?.title ?? "").trim()
    ),
    true
  );
  assert.equal(String(preparedSelectionItem?.attachment?.item_status ?? ""), "visual_ready");

  const createPrepareReleaseAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "link",
      title: "Prepare release candidate",
      status: "new",
      source_url: "https://example.com/prepare-release",
      source_domain: "example.com",
      meta_json: {
        segment_id: "seg_smoke_01",
        section_title: "Smoke Topic"
      }
    })
  });
  assert.equal(createPrepareReleaseAssetResponse.status, 201);
  const createPrepareReleaseAssetData = await createPrepareReleaseAssetResponse.json();
  const prepareReleaseAssetId = createPrepareReleaseAssetData?.asset?.id;
  assert.ok(prepareReleaseAssetId);

  const attachPrepareReleaseAssetResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(prepareReleaseAssetId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "release",
        target_id: releaseId,
        role: "story"
      })
    }
  );
  assert.equal(attachPrepareReleaseAssetResponse.status, 201);
  const attachPrepareReleaseAssetData = await attachPrepareReleaseAssetResponse.json();
  const prepareReleaseAttachmentId = attachPrepareReleaseAssetData?.attachment?.id;
  assert.ok(prepareReleaseAttachmentId);

  const prepareReleaseResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/prepare-release`,
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
  assert.equal(prepareReleaseResponse.status, 200);
  const prepareReleaseData = await prepareReleaseResponse.json();
  assert.equal(Boolean(String(prepareReleaseData?.auto_backup?.backup_id ?? "").trim()), true);
  assert.equal(Number(prepareReleaseData?.total) >= 1, true);
  assert.equal(Number(prepareReleaseData?.updated) >= 1, true);
  assert.equal(Array.isArray(prepareReleaseData?.prioritized_attachment_ids), true);
  assert.equal(
    prepareReleaseData?.prioritized_attachment_ids?.includes?.(String(prepareReleaseAttachmentId)),
    true
  );
  const preparedReleaseItem = prepareReleaseData?.release?.assets?.find(
    (item) => String(item?.attachment?.id ?? "") === String(prepareReleaseAttachmentId)
  );
  const preparedReleaseVisualNote = String(preparedReleaseItem?.attachment?.visual_note ?? "");
  assert.equal(Boolean(String(preparedReleaseItem?.attachment?.script_note ?? "").trim()), true);
  assert.equal(Boolean(preparedReleaseVisualNote.trim()), true);
  assert.equal(String(preparedReleaseItem?.attachment?.script_note ?? "").includes("Reuters smoke source"), true);
  assert.equal(
    ["Border footage frame", "Border footage frame follow-up", "Reuters smoke source video", "Reuters smoke source follow-up"].some(
      (label) => preparedReleaseVisualNote.includes(label)
    ),
    true
  );
  assert.equal(String(preparedReleaseItem?.attachment?.assistant_trace_json?.script?.section_title ?? ""), "Smoke Topic");
  assert.equal(String(preparedReleaseItem?.attachment?.assistant_trace_json?.visual?.section_title ?? ""), "Smoke Topic");
  assert.equal(
    Boolean(
      String(preparedReleaseItem?.attachment?.assistant_trace_json?.visual?.recommendation?.asset_id ?? "").trim() ||
      String(preparedReleaseItem?.attachment?.assistant_trace_json?.visual?.title ?? "").trim()
    ),
    true
  );
  assert.equal(String(preparedReleaseItem?.attachment?.item_status ?? ""), "visual_ready");

  const researchPickResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(preparedReleaseItem?.asset?.id ?? "")}/attachments/${encodeURIComponent(
      prepareReleaseAttachmentId
    )}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script_note: "Lead with Smoke Topic, source cue Reuters smoke source, cite reuters.com.",
        assistant_action: "research_pick",
        research_mode: "script",
        research_context: {
          segment_id: "seg_smoke_01",
          section_title: "Smoke Topic",
          summary: "Research-backed source and visual picks",
          source_item: {
            key: "source",
            label: "Best Source",
            title: "Reuters smoke source",
            domain: "reuters.com",
            role: "main_source",
            reason: "Trusted wire and used successfully before",
            score: 97
          },
          visual_item: {
            key: "visual",
            label: "Best Visual",
            title: "Border footage frame",
            domain: "example.com",
            role: "visual_candidate",
            reason: "Useful frame for montage",
            score: 91
          }
        }
      })
    }
  );
  assert.equal(researchPickResponse.status, 200);
  const researchPickData = await researchPickResponse.json();
  assert.equal(
    String(researchPickData?.attachment?.assistant_trace_json?.last_action ?? ""),
    "research_pick_source"
  );
  assert.equal(
    String(researchPickData?.attachment?.assistant_trace_json?.script?.title ?? ""),
    "Reuters smoke source"
  );
  assert.equal(
    String(researchPickData?.attachment?.assistant_trace_json?.script?.section_title ?? ""),
    "Smoke Topic"
  );
  assert.equal(Boolean(researchPickData?.attachment?.assistant_trace_json?.manual_override?.script), false);

  const manualOverrideResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(preparedReleaseItem?.asset?.id ?? "")}/attachments/${encodeURIComponent(
      prepareReleaseAttachmentId
    )}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script_note: "Manual rewrite for release item"
      })
    }
  );
  assert.equal(manualOverrideResponse.status, 200);
  const manualOverrideData = await manualOverrideResponse.json();
  assert.equal(String(manualOverrideData?.attachment?.script_note ?? ""), "Manual rewrite for release item");
  assert.equal(Boolean(manualOverrideData?.attachment?.assistant_trace_json?.manual_override?.script), true);
  assert.equal(String(manualOverrideData?.attachment?.assistant_trace_json?.manual_override?.last_action ?? ""), "manual_edit");

  const publishChecklistResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/publish-checklist`
  );
  assert.equal(publishChecklistResponse.status, 200);
  const publishChecklistData = await publishChecklistResponse.json();
  assert.equal(Boolean(publishChecklistData?.publish_checklist?.is_ready_to_air), true);
  assert.equal(Boolean(publishChecklistData?.publish_checklist?.summary?.editorial_ready), true);
  assert.equal(typeof publishChecklistData?.publish_checklist?.summary?.handoff_ready, "boolean");
  assert.equal(
    ["ready", "pending_capture", "pending_download", "backup_only", "no_files"].includes(
      String(publishChecklistData?.publish_checklist?.summary?.handoff_status_code ?? "")
    ),
    true
  );
  assert.equal(Number(publishChecklistData?.publish_checklist?.summary?.blocking_failures), 0);

  const markAirReadyResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/mark-air-ready`,
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
  assert.equal(markAirReadyResponse.status, 200);
  const markAirReadyData = await markAirReadyResponse.json();
  assert.equal(String(markAirReadyData?.release?.status ?? ""), "ready");
  assert.equal(String(markAirReadyData?.release?.editor_status ?? ""), "air_ready");
  assert.equal(Boolean(markAirReadyData?.publish_checklist?.is_ready_to_air), true);
  assert.equal(Boolean(markAirReadyData?.publish_checklist?.summary?.editorial_ready), true);

  const controlPanelResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/control-panel`);
  assert.equal(controlPanelResponse.status, 200);
  const controlPanelData = await controlPanelResponse.json();
  assert.equal(String(controlPanelData?.control_panel?.status_code ?? ""), "air_ready");
  assert.equal(Boolean(controlPanelData?.control_panel?.can_publish), true);
  assert.equal(Array.isArray(controlPanelData?.control_panel?.diagnostic_highlights), true);
  assert.equal(Array.isArray(controlPanelData?.control_panel?.handoff_queue), true);
  assert.equal(
    controlPanelData?.control_panel?.diagnostic_highlights?.some((item) =>
      ["handoff_capture", "handoff_download"].includes(String(item?.key ?? ""))
    ),
    true
  );
  assert.equal(
    ["ready", "pending_capture", "pending_download", "backup_only", "no_files"].includes(
      String(controlPanelData?.control_panel?.handoff_status_code ?? "")
    ),
    true
  );

  const briefingPanelResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/briefing`);
  assert.equal(briefingPanelResponse.status, 200);
  const briefingPanelData = await briefingPanelResponse.json();
  assert.equal(Boolean(String(briefingPanelData?.briefing_panel?.summary_text ?? "").trim()), true);
  assert.equal(Array.isArray(briefingPanelData?.briefing_panel?.next_steps), true);
  assert.equal(Array.isArray(briefingPanelData?.briefing_panel?.recommendation_highlights), true);
  assert.equal(Array.isArray(briefingPanelData?.briefing_panel?.handoff_queue), true);
  assert.equal(Array.isArray(briefingPanelData?.briefing_panel?.diagnostic_highlights), true);
  assert.equal(
    Number(briefingPanelData?.briefing_panel?.recommendation_highlights?.length ?? 0) === 0 ||
      briefingPanelData?.briefing_panel?.recommendation_highlights?.some(
        (item) => String(item?.matched_section_title ?? "") === "Smoke Topic"
      ),
    true
  );
  assert.equal(Array.isArray(briefingPanelData?.research_briefs?.items), true);
  assert.equal(briefingPanelData?.research_briefs?.items?.[0]?.segment_id, "seg_smoke_01");
  assert.equal(
    typeof briefingPanelData?.research_briefs?.items?.[0]?.current_pair === "object" ||
      typeof briefingPanelData?.research_briefs?.items?.[0]?.main_source === "object",
    true
  );
  const releaseBriefRunId = String(briefingPanelData?.research_briefs?.items?.[0]?.run_id ?? "").trim();
  assert.equal(Boolean(releaseBriefRunId), true);

  const pinRunResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meta_json: {
        research_run_pins: {
          seg_smoke_01: releaseBriefRunId
        }
      }
    })
  });
  assert.equal(pinRunResponse.status, 200);

  const briefingPanelPinnedResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/briefing`);
  assert.equal(briefingPanelPinnedResponse.status, 200);
  const briefingPanelPinnedData = await briefingPanelPinnedResponse.json();
  assert.equal(String(briefingPanelPinnedData?.research_briefs?.items?.[0]?.run_id ?? ""), releaseBriefRunId);
  assert.equal(Boolean(briefingPanelPinnedData?.research_briefs?.items?.[0]?.is_pinned), true);
  assert.equal(String(briefingPanelPinnedData?.research_briefs?.items?.[0]?.pinned_run_id ?? ""), releaseBriefRunId);

  const publishReleaseResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/publish-release`,
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
  assert.equal(publishReleaseResponse.status, 200);
  const publishReleaseData = await publishReleaseResponse.json();
  assert.equal(String(publishReleaseData?.release?.status ?? ""), "published");
  assert.equal(String(publishReleaseData?.release?.editor_status ?? ""), "published");
  assert.equal(String(publishReleaseData?.control_panel?.status_code ?? ""), "published");

  const createScreenshotAssetResponse = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "screenshot",
      title: "Captured frame",
      status: "processed",
      source_url: "https://example.com/frame",
      local_path: "_integration/screenshots/test/frame.png"
    })
  });
  assert.equal(createScreenshotAssetResponse.status, 201);
  const createScreenshotAssetData = await createScreenshotAssetResponse.json();
  const screenshotAssetId = createScreenshotAssetData?.asset?.id;
  assert.ok(screenshotAssetId);
  const attachScreenshotToDocResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(screenshotAssetId)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_type: "document",
        target_id: "doc_smoke",
        role: "reference"
      })
    }
  );
  assert.equal(attachScreenshotToDocResponse.status, 201);

  const assistantPassResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-pass`);
  assert.equal(assistantPassResponse.status, 200);
  const assistantPassData = await assistantPassResponse.json();
  assert.equal(Number(assistantPassData?.assistant_pass?.summary?.orphan_screenshots), 1);
  assert.equal(Array.isArray(assistantPassData?.assistant_pass?.items_without_script), true);
  assert.equal(Array.isArray(assistantPassData?.assistant_pass?.items_without_visual), true);
  assert.equal(Array.isArray(assistantPassData?.assistant_pass?.items_without_link), true);
  const firstAssistantGapItem =
    assistantPassData?.assistant_pass?.items_without_script?.[0] ??
    assistantPassData?.assistant_pass?.items_without_visual?.[0] ??
    assistantPassData?.assistant_pass?.items_without_link?.[0] ??
    null;
  if (firstAssistantGapItem) {
    assert.equal(Boolean(String(firstAssistantGapItem?.attachment_id ?? "").trim()), true);
    assert.equal(Boolean(String(firstAssistantGapItem?.asset_id ?? "").trim()), true);
  }

  const attachOrphanScreenshotsResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/assistant-actions/attach-orphan-screenshots`,
    {
      method: "POST"
    }
  );
  assert.equal(attachOrphanScreenshotsResponse.status, 200);
  const attachOrphanScreenshotsData = await attachOrphanScreenshotsResponse.json();
  assert.equal(Number(attachOrphanScreenshotsData?.attached), 1);

  const releaseActivityResponse = await fetch(`${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/activity`);
  assert.equal(releaseActivityResponse.status, 200);
  const releaseActivityData = await releaseActivityResponse.json();
  assert.equal(Array.isArray(releaseActivityData?.activity), true);
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "release_created"),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "asset_attached"),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "manual_override"),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "research_pick_applied"),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) =>
      ["fill_missing_visuals", "fill_selection_visuals", "prepare_selection", "prepare_release", "research_pick_applied"].includes(
        String(item?.event ?? "")
      )
    ),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "handoff_snapshot"),
    true
  );
  assert.equal(
    releaseActivityData.activity.some((item) => String(item?.event ?? "") === "handoff_download_resolved"),
    true
  );

  const releaseExportMdResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/export?format=md`
  );
  assert.equal(releaseExportMdResponse.status, 200);
  assert.match(String(releaseExportMdResponse.headers.get("content-type") ?? ""), /text\/markdown/i);
  const releaseExportMd = await releaseExportMdResponse.text();
  assert.match(releaseExportMd, /## Release Briefing/);
  assert.match(releaseExportMd, /## Recommended Assets/);
  assert.match(releaseExportMd, /(Best For: Smoke Topic|_No extra candidates right now\.)/);
  assert.match(releaseExportMd, /## Publish Checklist/);
  assert.match(releaseExportMd, /Editorial Ready:/);
  assert.match(releaseExportMd, /Handoff Ready:/);
  assert.match(releaseExportMd, /Handoff Status:/);
  assert.match(releaseExportMd, /### Handoff Queue/);
  assert.match(releaseExportMd, /### Recommendation Highlights/);
  assert.match(releaseExportMd, /(### Diagnostic Highlights|## Segment Research Briefs)/);
  assert.match(releaseExportMd, /### Copy Plan Highlights/);
  assert.match(releaseExportMd, /## Segment Research Briefs/);
  assert.match(releaseExportMd, /(Current Pair:|Main Source:|Main Visual:)/);
  assert.match(releaseExportMd, /Pinned Run:/);
  if (/Current Pair:/.test(releaseExportMd)) {
    assert.match(releaseExportMd, /(Pair Drift:|Aligned with main picks|Using backup picks|Mixed main \+ backup|Custom research mix)/);
  }
  assert.match(releaseExportMd, /## Rundown/);
  assert.match(releaseExportMd, /Open with headline/);
  assert.match(releaseExportMd, /Confidence: Research-backed/);
  assert.match(releaseExportMd, /Manual override/);
  assert.match(releaseExportMd, /Script Trace: Smoke Topic/);

  const releaseShotlistResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/export?format=shotlist`
  );
  assert.equal(releaseShotlistResponse.status, 200);
  assert.match(String(releaseShotlistResponse.headers.get("content-type") ?? ""), /text\/markdown/i);
  const releaseShotlist = await releaseShotlistResponse.text();
  assert.match(releaseShotlist, /# Shotlist:/);
  assert.match(releaseShotlist, /Usage Role:/);
  assert.match(releaseShotlist, /On-Screen Cue:/);
  assert.match(releaseShotlist, /Picked Source:/);
  assert.match(releaseShotlist, /Picked Visual:/);
  assert.match(releaseShotlist, /Fallback:/);
  assert.match(releaseShotlist, /Backup Note:/);

  const releaseExportJsonResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/export?format=json`
  );
  assert.equal(releaseExportJsonResponse.status, 200);
  assert.match(String(releaseExportJsonResponse.headers.get("content-type") ?? ""), /application\/json/i);
  const releaseExportJson = await releaseExportJsonResponse.json();
  assert.equal(releaseExportJson?.release?.id, releaseId);
  assert.equal(Number(releaseExportJson?.assistant_pass?.summary?.orphan_screenshots), 0);
  assert.equal(Array.isArray(releaseExportJson?.recommendations?.candidates), true);
  assert.equal(
    Number(releaseExportJson?.recommendations?.candidates?.length ?? 0) === 0 ||
      releaseExportJson?.recommendations?.candidates?.some(
        (item) => String(item?.matched_section_title ?? "") === "Smoke Topic"
      ),
    true
  );
  assert.equal(Boolean(releaseExportJson?.publish_checklist?.is_ready_to_air), false);
  assert.equal(Boolean(releaseExportJson?.publish_checklist?.summary?.editorial_ready), false);
  assert.equal(typeof releaseExportJson?.publish_checklist?.summary?.handoff_ready, "boolean");
  assert.equal(
    ["ready", "pending_capture", "pending_download", "backup_only", "no_files"].includes(
      String(releaseExportJson?.publish_checklist?.summary?.handoff_status_code ?? "")
    ),
    true
  );
  assert.equal(String(releaseExportJson?.control_panel?.status_code ?? ""), "published");
  assert.equal(
    ["ready", "pending_capture", "pending_download", "backup_only", "no_files"].includes(
      String(releaseExportJson?.control_panel?.handoff_status_code ?? "")
    ),
    true
  );
  assert.equal(Boolean(String(releaseExportJson?.briefing_panel?.summary_text ?? "").trim()), true);
  assert.equal(Array.isArray(releaseExportJson?.briefing_panel?.recommendation_highlights), true);
  assert.equal(Array.isArray(releaseExportJson?.briefing_panel?.handoff_queue), true);
  assert.equal(Array.isArray(releaseExportJson?.briefing_panel?.diagnostic_highlights), true);
  assert.equal(
    releaseExportJson?.briefing_panel?.diagnostic_highlights?.some((item) =>
      ["handoff_capture", "handoff_download"].includes(String(item?.key ?? ""))
    ),
    true
  );
  assert.equal(Array.isArray(releaseExportJson?.briefing_panel?.copy_plan_highlights), true);
  assert.equal(
    releaseExportJson?.briefing_panel?.copy_plan_highlights?.some(
      (item) => ["picked_source", "picked_visual", "fallback"].includes(String(item?.target ?? "")) && String(item?.picked_from ?? "").trim()
    ),
    true
  );
  assert.equal(
    releaseExportJson?.briefing_panel?.copy_plan_highlights?.some((item) =>
      ["ready", "capture_needed", "download_needed", "backup_only"].includes(String(item?.ready_state ?? ""))
    ),
    true
  );
  assert.equal(Number(releaseExportJson?.control_panel?.copy_plan_summary?.ready_files ?? 0) >= 1, true);
  assert.equal(Number(releaseExportJson?.control_panel?.copy_plan_summary?.download_needed ?? 0) >= 0, true);
  assert.equal(Number(releaseExportJson?.control_panel?.copy_plan_summary?.downloaded ?? 0) >= 0, true);
  assert.equal(Array.isArray(releaseExportJson?.research_briefs?.items), true);
  assert.equal(
    releaseExportJson?.release?.assets?.some((item) => String(item?.attachment?.assistant_trace_json?.script?.section_title ?? "") === "Smoke Topic"),
    true
  );
  assert.equal(releaseExportJson?.research_briefs?.items?.[0]?.segment_id, "seg_smoke_01");
  assert.equal(
    typeof releaseExportJson?.research_briefs?.items?.[0]?.current_pair === "object" ||
      typeof releaseExportJson?.research_briefs?.items?.[0]?.main_source === "object",
    true
  );
  assert.equal(Boolean(releaseExportJson?.research_briefs?.items?.[0]?.is_pinned), true);
  assert.equal(
    String(releaseExportJson?.research_briefs?.items?.[0]?.pinned_run_id ?? ""),
    String(releaseExportJson?.research_briefs?.items?.[0]?.run_id ?? "")
  );
  assert.equal(Array.isArray(releaseExportJson?.shotlist), true);
  assert.equal(Boolean(String(releaseExportJson?.shotlist?.[0]?.shotcard?.picked_source?.title ?? "").trim()), true);
  assert.equal(Boolean(String(releaseExportJson?.shotlist?.[0]?.shotcard?.picked_source?.picked_from ?? "").trim()), true);
  assert.equal(Boolean(String(releaseExportJson?.shotlist?.[0]?.shotcard?.picked_visual?.picked_from ?? "").trim()), true);
  assert.equal(Boolean(String(releaseExportJson?.shotlist?.[0]?.usage_role ?? "").trim()), true);
  assert.equal(Boolean(String(releaseExportJson?.shotlist?.[0]?.on_screen_cue ?? "").trim()), true);
  assert.equal(typeof releaseExportJson?.shotlist?.[0]?.backup_note, "string");
  if (String(releaseExportJson?.shotlist?.[0]?.shotcard?.fallback?.title ?? "").trim()) {
    assert.equal(
      ["research_backup_visual", "research_backup_source", "research_fallback_visual", "research_fallback_source"].includes(
        String(releaseExportJson?.shotlist?.[0]?.shotcard?.fallback?.picked_from ?? "").trim()
      ),
      true
    );
  }
  assert.equal(Array.isArray(releaseExportJson?.media_package?.items), true);
  assert.equal(Array.isArray(releaseExportJson?.media_package?.files), true);
  assert.equal(Array.isArray(releaseExportJson?.media_package?.copy_plan), true);
  assert.equal(
    ["ready", "capture_needed", "download_needed", "backup_only"].includes(
      String(releaseExportJson?.media_package?.items?.[0]?.ready_state ?? "")
    ),
    true
  );
  assert.equal(Boolean(String(releaseExportJson?.media_package?.items?.[0]?.picked_source?.picked_from ?? "").trim()), true);
  assert.equal(Boolean(String(releaseExportJson?.media_package?.items?.[0]?.picked_visual?.picked_from ?? "").trim()), true);
  assert.equal(
    releaseExportJson?.media_package?.copy_plan?.some(
      (item) => ["picked_source", "picked_visual", "fallback"].includes(String(item?.target ?? "")) && String(item?.picked_from ?? "").trim()
    ),
    true
  );
  assert.equal(
    releaseExportJson?.media_package?.copy_plan?.some((item) =>
      ["ready", "capture_needed", "download_needed", "backup_only"].includes(String(item?.ready_state ?? ""))
    ),
    true
  );
  assert.equal(
    releaseExportJson?.media_package?.copy_plan?.some((item) =>
      ["ready", "capture_needed", "download_needed", "backup_only", "downloaded", "captured"].includes(
        String(item?.effective_ready_state ?? "")
      )
    ),
    true
  );

  const releaseMediaPackageResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/export?format=media-package`
  );
  assert.equal(releaseMediaPackageResponse.status, 200);
  assert.match(String(releaseMediaPackageResponse.headers.get("content-type") ?? ""), /application\/json/i);
  const releaseMediaPackage = await releaseMediaPackageResponse.json();
  assert.equal(releaseMediaPackage?.release?.id, releaseId);
  assert.equal(Array.isArray(releaseMediaPackage?.items), true);
  assert.equal(Array.isArray(releaseMediaPackage?.files), true);
  assert.equal(Array.isArray(releaseMediaPackage?.copy_plan), true);
  assert.equal(
    ["ready", "capture_needed", "download_needed", "backup_only"].includes(
      String(releaseMediaPackage?.items?.[0]?.ready_state ?? "")
    ),
    true
  );
  assert.equal(Boolean(String(releaseMediaPackage?.items?.[0]?.picked_source?.picked_from ?? "").trim()), true);
  assert.equal(Boolean(String(releaseMediaPackage?.items?.[0]?.picked_visual?.picked_from ?? "").trim()), true);
  if (String(releaseMediaPackage?.items?.[0]?.fallback?.title ?? "").trim()) {
    assert.equal(
      ["research_backup_visual", "research_backup_source", "research_fallback_visual", "research_fallback_source"].includes(
        String(releaseMediaPackage?.items?.[0]?.fallback?.picked_from ?? "").trim()
      ),
      true
    );
  }
  assert.equal(
    releaseMediaPackage?.copy_plan?.some(
      (item) => ["picked_source", "picked_visual", "fallback"].includes(String(item?.target ?? "")) && String(item?.picked_from ?? "").trim()
    ),
    true
  );
  assert.equal(
    releaseMediaPackage?.copy_plan?.some((item) =>
      ["ready", "capture_needed", "download_needed", "backup_only"].includes(String(item?.ready_state ?? ""))
    ),
    true
  );
  assert.equal(
    releaseMediaPackage?.copy_plan?.some((item) =>
      ["ready", "capture_needed", "download_needed", "backup_only", "downloaded", "captured"].includes(
        String(item?.effective_ready_state ?? "")
      )
    ),
    true
  );
  assert.equal(Number(releaseMediaPackage?.summary?.copy_plan_steps ?? 0) >= 1, true);
  assert.equal(Number(releaseMediaPackage?.summary?.ready_files ?? 0) >= 1, true);
  assert.equal(Number(releaseMediaPackage?.summary?.download_needed ?? 0) >= 0, true);
  assert.equal(Number(releaseMediaPackage?.summary?.downloaded ?? 0) >= 0, true);
  assert.equal(
    releaseMediaPackage?.copy_plan?.some((item) => String(item?.step_type ?? "") === "copy_file"),
    true
  );

  const releaseCopyPlanResponse = await fetch(
    `${baseUrl}/api/releases/${encodeURIComponent(releaseId)}/export?format=copy-plan`
  );
  assert.equal(releaseCopyPlanResponse.status, 200);
  assert.match(String(releaseCopyPlanResponse.headers.get("content-type") ?? ""), /text\/markdown/i);
  const releaseCopyPlan = await releaseCopyPlanResponse.text();
  assert.match(releaseCopyPlan, /# Copy Plan:/);
  assert.match(releaseCopyPlan, /Files Ready:/);
  assert.match(releaseCopyPlan, /Capture Needed:/);
  assert.match(releaseCopyPlan, /Ready State:/);

  const releaseListResponse = await fetch(`${baseUrl}/api/releases`);
  assert.equal(releaseListResponse.status, 200);
  const releaseListData = await releaseListResponse.json();
  assert.equal(Number(releaseListData?.releases?.[0]?.asset_count) >= 7, true);

  const removeAttachmentResponse = await fetch(
    `${baseUrl}/api/assets/${encodeURIComponent(assetId)}/attachments/${encodeURIComponent(releaseAttachmentId)}`,
    { method: "DELETE" }
  );
  assert.equal(removeAttachmentResponse.status, 200);

  const upsertSessionResponse = await fetch(`${baseUrl}/api/bot/sessions`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: "-100123",
      user_id: "42",
      mode: "sdvg",
      active_document_id: "doc_smoke",
      active_segment_id: "seg_smoke_01"
    })
  });
  assert.equal(upsertSessionResponse.status, 200);
  const upsertSessionData = await upsertSessionResponse.json();
  assert.equal(upsertSessionData?.session?.mode, "sdvg");

  const overviewResponse = await fetch(`${baseUrl}/api/integration/overview`);
  assert.equal(overviewResponse.status, 200);
  const overviewData = await overviewResponse.json();
  assert.equal(Number(overviewData?.counts?.assets) >= 7, true);
  assert.equal(Number(overviewData?.counts?.attachments) >= 10, true);
  assert.equal(Number(overviewData?.counts?.releases), 1);
  assert.equal(Number(overviewData?.counts?.bot_sessions), 1);
  assert.equal(Number(overviewData?.counts?.inbox_assets), 1);

  const sqliteStatusResponse = await fetch(`${baseUrl}/api/integration/sqlite/status`);
  assert.equal(sqliteStatusResponse.status, 200);
  const sqliteStatusData = await sqliteStatusResponse.json();
  assert.equal(Boolean(String(sqliteStatusData?.sqlite?.path ?? "").trim()), true);
  assert.equal(Number(sqliteStatusData?.sqlite?.db_size_bytes ?? 0) >= 0, true);
  assert.equal(Number(sqliteStatusData?.sqlite?.counts?.assets ?? 0) >= 7, true);
  assert.equal(Boolean(String(sqliteStatusData?.sqlite?.last_sync_at ?? "").trim()), true);
  assert.equal(Boolean(String(sqliteStatusData?.sqlite?.assistant_last_sync_at ?? "").trim()), true);
  assert.equal(Number(sqliteStatusData?.sqlite?.assistant_memory?.source_profile_domains ?? 0) >= 1, true);
  assert.equal(Number(sqliteStatusData?.sqlite?.assistant_memory?.source_memory_domains ?? 0) >= 0, true);
  assert.equal(Number(sqliteStatusData?.sqlite?.assistant_memory?.release_outcome_domains ?? 0) >= 1, true);

  const backupCreateResponse = await fetch(`${baseUrl}/api/integration/backups/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "smoke" })
  });
  assert.equal(backupCreateResponse.status, 200);
  const backupCreateData = await backupCreateResponse.json();
  const backupId = String(backupCreateData?.backup?.backup_id ?? "").trim();
  assert.equal(Boolean(backupId), true);
  assert.equal(Array.isArray(backupCreateData?.backup?.copied_entries), true);
  assert.equal(Boolean(String(backupCreateData?.backup?.sqlite?.path ?? "").trim()), true);
  await fs.access(path.join(testDataDir, "_backups", backupId, "manifest.json"));

  const backupStatusResponse = await fetch(`${baseUrl}/api/integration/backups/status`);
  assert.equal(backupStatusResponse.status, 200);
  const backupStatusData = await backupStatusResponse.json();
  assert.equal(typeof backupStatusData?.backups?.auto_backup_enabled, "boolean");
  assert.equal(Number(backupStatusData?.backups?.total_backups ?? 0) >= 1, true);
  assert.equal(String(backupStatusData?.backups?.latest?.backup_id ?? "").trim(), backupId);

  const backupInspectResponse = await fetch(`${baseUrl}/api/integration/backups/${encodeURIComponent(backupId)}`);
  assert.equal(backupInspectResponse.status, 200);
  const backupInspectData = await backupInspectResponse.json();
  assert.equal(String(backupInspectData?.backup?.manifest?.backup_id ?? "").trim(), backupId);
  assert.equal(Number(backupInspectData?.backup?.summary?.files ?? 0) >= 1, true);
  assert.equal(Array.isArray(backupInspectData?.backup?.inventory), true);

  const backupDryRunResponse = await fetch(
    `${baseUrl}/api/integration/backups/${encodeURIComponent(backupId)}/restore-dry-run`,
    { method: "POST" }
  );
  assert.equal(backupDryRunResponse.status, 200);
  const backupDryRunData = await backupDryRunResponse.json();
  assert.equal(String(backupDryRunData?.dry_run?.backup_id ?? "").trim(), backupId);
  assert.equal(typeof backupDryRunData?.dry_run?.summary, "object");
  assert.equal(Array.isArray(backupDryRunData?.dry_run?.restore_plan?.would_restore), true);
  assert.equal(Array.isArray(backupDryRunData?.dry_run?.restore_plan?.would_overwrite), true);
  assert.equal(Array.isArray(backupDryRunData?.dry_run?.restore_plan?.live_only), true);

  const restoreSentinelPath = path.join(testDataDir, "restore-sentinel.json");
  await fs.writeFile(restoreSentinelPath, JSON.stringify({ created_for: "restore_smoke" }), "utf8");
  const backupRestoreResponse = await fetch(`${baseUrl}/api/integration/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST"
  });
  assert.equal(backupRestoreResponse.status, 200);
  const backupRestoreData = await backupRestoreResponse.json();
  assert.equal(String(backupRestoreData?.restored?.backup_id ?? "").trim(), backupId);
  assert.equal(Boolean(String(backupRestoreData?.pre_restore_backup?.backup_id ?? "").trim()), true);
  assert.equal(Boolean(String(backupRestoreData?.restored?.history_entry?.restore_id ?? "").trim()), true);
  assert.equal(Boolean(String(backupRestoreData?.sqlite?.path ?? "").trim()), true);
  await assert.rejects(() => fs.access(restoreSentinelPath));

  const backupStatusAfterRestoreResponse = await fetch(`${baseUrl}/api/integration/backups/status`);
  assert.equal(backupStatusAfterRestoreResponse.status, 200);
  const backupStatusAfterRestoreData = await backupStatusAfterRestoreResponse.json();
  assert.equal(
    String(backupStatusAfterRestoreData?.backups?.latest_restore?.backup_id ?? "").trim(),
    backupId
  );
  assert.equal(Array.isArray(backupStatusAfterRestoreData?.backups?.restore_history), true);
  assert.equal(
    backupStatusAfterRestoreData?.backups?.restore_history?.some(
      (item) => String(item?.backup_id ?? "").trim() === backupId
    ),
    true
  );

  const sqliteReindexResponse = await fetch(`${baseUrl}/api/integration/sqlite/reindex`, {
    method: "POST"
  });
  assert.equal(sqliteReindexResponse.status, 200);
  const sqliteReindexData = await sqliteReindexResponse.json();
  assert.equal(Boolean(String(sqliteReindexData?.auto_backup?.backup_id ?? "").trim()), true);
  assert.equal(String(sqliteReindexData?.sqlite?.last_reason ?? ""), "manual_reindex");
  assert.equal(Number(sqliteReindexData?.sqlite?.counts?.attachments ?? 0) >= 10, true);

  const integrationJobsResponse = await fetch(`${baseUrl}/api/integration/jobs`);
  assert.equal(integrationJobsResponse.status, 200);
  const integrationJobsData = await integrationJobsResponse.json();
  assert.equal(Array.isArray(integrationJobsData?.jobs), true);
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
  assert.equal(Number(created?.document_version), 1);

  const v1Path = path.join(testDataDir, created.id, "document.v1.json");
  const v1Stat = await fs.stat(v1Path);
  assert.equal(v1Stat.isFile(), true);

  const getResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(created.id)}`);
  assert.equal(getResponse.status, 200);
  const loaded = await getResponse.json();
  assert.equal(loaded?.document?.id, created.id);
  assert.equal(loaded?.document?.raw_text, rawText.trim());

  const updatedText = "Smoke test script text updated";
  const updateResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(created.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw_text: updatedText })
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated?.document?.raw_text, updatedText);
  assert.equal(Number(updated?.document_version), 2);

  const v2Path = path.join(testDataDir, created.id, "document.v2.json");
  const v2Stat = await fs.stat(v2Path);
  assert.equal(v2Stat.isFile(), true);
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
      media_file_paths: ["topic/clip-a.mp4", "topic/clip-b.mp4"],
      media_file_timecodes: {
        "topic/clip-a.mp4": "00:00:03",
        "topic/clip-b.mp4": "00:00:07"
      },
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
  assert.equal(decisionsUpdateData?.decisions?.[0]?.visual_decision?.media_file_path, "topic/clip-a.mp4");
  assert.deepEqual(decisionsUpdateData?.decisions?.[0]?.visual_decision?.media_file_paths, [
    "topic/clip-a.mp4",
    "topic/clip-b.mp4"
  ]);
  assert.deepEqual(decisionsUpdateData?.decisions?.[0]?.visual_decision?.media_file_timecodes, {
    "topic/clip-a.mp4": "00:00:03",
    "topic/clip-b.mp4": "00:00:07"
  });
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
  assert.equal(docData?.decisions?.[0]?.visual_decision?.media_file_path, "topic/clip-a.mp4");
  assert.deepEqual(docData?.decisions?.[0]?.visual_decision?.media_file_paths, [
    "topic/clip-a.mp4",
    "topic/clip-b.mp4"
  ]);
  assert.deepEqual(docData?.decisions?.[0]?.visual_decision?.media_file_timecodes, {
    "topic/clip-a.mp4": "00:00:03",
    "topic/clip-b.mp4": "00:00:07"
  });

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
      media_file_paths: ["topic/export-a.mp4", "topic/export-b.mp4"],
      media_file_timecodes: {
        "topic/export-a.mp4": "00:00:01",
        "topic/export-b.mp4": "00:00:05"
      },
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

test("segment research routes generate runs and apply results", async () => {
  const created = await createDocument("## Topic\nResearch smoke segment about border footage and Reuters source");
  const docId = created.id;
  const firstSegment = {
    segment_id: "news_research_01",
    block_type: "news",
    text_quote: "Research smoke segment about border footage and Reuters source",
    section_id: "topic_01",
    section_title: "Topic",
    section_index: 1,
    links: [],
    segment_status: null,
    is_done: false,
    version: 1
  };
  const sessionResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/session`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_text: "## Topic\nResearch smoke segment about border footage and Reuters source",
      segments: [firstSegment],
      decisions: [
        {
          segment_id: firstSegment.segment_id,
          visual_decision: {
            type: "no_visual",
            description: "",
            format_hint: null,
            duration_hint_sec: null,
            priority: null
          },
          search_decision: {
            keywords: [],
            queries: []
          },
          search_decision_en: {
            keywords: [],
            queries: []
          },
          version: 1
        }
      ],
      source: "test"
    })
  });
  assert.equal(sessionResponse.status, 200);

  const researchResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "deep",
        seed_results: [
          {
            id: "seed_res_1",
            url: "https://www.reuters.com/world/us/example-footage",
            title: "Reuters example footage",
            snippet: "Video and source for smoke research test",
            domain: "reuters.com",
            published_at: "2026-03-22T10:00:00Z",
            content_type: "article"
          },
          {
            id: "seed_res_visual",
            url: "https://www.youtube.com/watch?v=deepVisualSmoke",
            title: "Border checkpoint footage",
            snippet: "Visual pass candidate for smoke research test",
            domain: "youtube.com",
            published_at: "2026-03-22T10:30:00Z",
            content_type: "video"
          }
        ]
      })
    }
  );
  assert.equal(researchResponse.status, 201);
  const researchData = await researchResponse.json();
  assert.equal(researchData?.run?.segment_id, firstSegment.segment_id);
  assert.equal(researchData?.run?.mode, "deep");
  assert.equal(researchData?.run?.results?.length, 2);
  assert.equal(researchData?.run?.ranked_results?.length, 2);
  assert.equal((researchData?.run?.queries?.length ?? 0) >= 4, true);
  assert.equal((researchData?.run?.queries ?? []).some((item) => String(item?.phase ?? "") === "source"), true);
  assert.equal((researchData?.run?.queries ?? []).some((item) => String(item?.phase ?? "") === "visual"), true);
  assert.equal(Array.isArray(researchData?.run?.summary?.phases), true);
  assert.equal(Array.isArray(researchData?.run?.summary?.guidance), true);
  assert.equal(Array.isArray(researchData?.run?.brief?.items), true);
  assert.equal(Array.isArray(researchData?.run?.brief?.phase_items), true);
  assert.equal(researchData?.run?.brief?.items?.length >= 1, true);
  assert.equal(
    researchData?.run?.brief?.items?.some((item) => String(item?.key ?? "").trim() === "backup_source") ||
      researchData?.run?.brief?.items?.some((item) => String(item?.key ?? "").trim() === "backup_visual"),
    true
  );
  const runId = researchData?.run?.run_id;
  assert.ok(runId);

  const secondResearchResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "fast",
        seed_results: [
          {
            id: "seed_res_2",
            url: "https://www.youtube.com/watch?v=smokeResearch",
            title: "Border footage video",
            snippet: "Downloadable footage candidate",
            domain: "youtube.com",
            published_at: "2026-03-22T11:00:00Z",
            content_type: "video"
          }
        ]
      })
    }
  );
  assert.equal(secondResearchResponse.status, 201);

  const latestRunResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research`
  );
  assert.equal(latestRunResponse.status, 200);
  const latestRunData = await latestRunResponse.json();
  assert.equal(latestRunData?.run?.run_id !== runId, true);
  assert.equal(Array.isArray(latestRunData?.runs), true);
  assert.equal(latestRunData?.runs?.length, 2);
  assert.equal(Array.isArray(latestRunData?.run?.ranked_results?.[0]?.visual_hints), true);
  assert.equal(Array.isArray(latestRunData?.run?.ranked_results?.[0]?.reason_tags), true);
  assert.equal(Array.isArray(latestRunData?.run?.brief?.items), true);

  const sqliteStatusAfterResearchResponse = await fetch(`${baseUrl}/api/integration/sqlite/status`);
  assert.equal(sqliteStatusAfterResearchResponse.status, 200);
  const sqliteStatusAfterResearchData = await sqliteStatusAfterResearchResponse.json();
  assert.equal(Number(sqliteStatusAfterResearchData?.sqlite?.assistant_memory?.research_runs ?? 0) >= 2, true);

  const latestBriefResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/brief`
  );
  assert.equal(latestBriefResponse.status, 200);
  const latestBriefData = await latestBriefResponse.json();
  assert.equal(latestBriefData?.run_id, latestRunData?.run?.run_id);
  assert.equal(Array.isArray(latestBriefData?.brief?.items), true);
  assert.equal(latestBriefData?.brief?.items?.length >= 1, true);
  assert.equal(
    latestBriefData?.brief?.items?.some((item) => ["source", "visual", "download"].includes(String(item?.key ?? "").trim())),
    true
  );

  const bundlePromoteResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/apply-bundle`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        source_result_id: "seed_res_1",
        visual_result_id: "seed_res_visual"
      })
    }
  );
  assert.equal(bundlePromoteResponse.status, 200);
  const bundlePromoteData = await bundlePromoteResponse.json();
  assert.equal(bundlePromoteData?.ok, true);
  assert.equal(bundlePromoteData?.action, "promote_bundle_to_decision");
  assert.equal(Array.isArray(bundlePromoteData?.bundle?.applied), true);
  assert.equal(bundlePromoteData?.bundle?.applied?.length, 2);
  assert.equal(bundlePromoteData?.decision?.segment_id, firstSegment.segment_id);
  assert.equal(Array.isArray(bundlePromoteData?.decision?.research_sources), true);
  assert.equal(bundlePromoteData?.decision?.research_sources?.length >= 2, true);
  assert.equal(String(bundlePromoteData?.decision?.visual_decision?.description ?? "").length > 0, true);
  assert.equal(Array.isArray(bundlePromoteData?.decision?.search_decision?.queries), true);
  assert.equal(bundlePromoteData?.decision?.search_decision?.queries?.length > 0, true);
  assert.equal(bundlePromoteData?.decision?.research_bundle_trace?.run_id, runId);
  assert.equal(bundlePromoteData?.decision?.research_bundle_trace?.source_result_id, "seed_res_1");
  assert.equal(bundlePromoteData?.decision?.research_bundle_trace?.visual_result_id, "seed_res_visual");

  const applySourceResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        result_id: "seed_res_1",
        action: "use_as_source"
      })
    }
  );
  assert.equal(applySourceResponse.status, 200);
  const applySourceData = await applySourceResponse.json();
  assert.equal(applySourceData?.ok, true);
  assert.equal(Number(applySourceData?.source_memory_summary?.total_domains ?? 0) >= 1, true);

  const docResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}`);
  assert.equal(docResponse.status, 200);
  const docData = await docResponse.json();
  const updatedDecision = Array.isArray(docData?.decisions)
    ? docData.decisions.find((item) => item.segment_id === firstSegment.segment_id)
    : null;
  assert.equal((updatedDecision?.research_sources?.length ?? 0) >= 3, true);
  assert.equal(
    updatedDecision?.research_sources?.some((item) => String(item?.domain ?? "") === "reuters.com"),
    true
  );
  assert.equal(updatedDecision?.research_bundle_trace?.run_id, runId);
  assert.equal(updatedDecision?.research_bundle_trace?.source?.result_id, "seed_res_1");
  assert.equal(updatedDecision?.research_bundle_trace?.visual?.result_id, "seed_res_visual");

  const bundleBriefMarkdownResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/brief?format=md&run_id=${encodeURIComponent(runId)}`
  );
  assert.equal(bundleBriefMarkdownResponse.status, 200);
  const bundleBriefMarkdown = await bundleBriefMarkdownResponse.text();
  assert.match(bundleBriefMarkdown, /## Current Pair/);
  assert.match(bundleBriefMarkdown, /## Main Picks/);
  assert.match(bundleBriefMarkdown, /## Backup Picks/);
  assert.match(bundleBriefMarkdown, /(Main Pair|Backup Pair|Mixed Pair|Custom Pair)/);

  const replayResearchResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "fast",
        seed_results: [
          {
            id: "seed_res_3",
            url: "https://www.reuters.com/world/us/example-footage-followup",
            title: "Reuters follow-up footage",
            snippet: "Another Reuters footage candidate for the same segment",
            domain: "reuters.com",
            published_at: "2026-03-22T12:00:00Z",
            content_type: "article"
          }
        ]
      })
    }
  );
  assert.equal(replayResearchResponse.status, 201);
  const replayResearchData = await replayResearchResponse.json();
  assert.equal(Number(replayResearchData?.run?.ranked_results?.[0]?.similarity_score ?? 0) > 0, true);
  assert.equal(Number(replayResearchData?.run?.ranked_results?.[0]?.memory_usage_count ?? 0) > 0, true);
  assert.equal(
    (Array.isArray(replayResearchData?.run?.brief?.items) ? replayResearchData.run.brief.items : []).some(
      (item) => String(item?.memory_hint ?? "").trim().length > 0
    ),
    true
  );

  const applyAttachResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        result_id: "seed_res_1",
        action: "attach_asset"
      })
    }
  );
  assert.equal(applyAttachResponse.status, 200);
  const applyAttachData = await applyAttachResponse.json();
  assert.equal(applyAttachData?.asset?.kind, "link");
  assert.equal(applyAttachData?.attachment?.target_type, "segment");
  assert.equal(Number(applyAttachData?.source_memory_summary?.total_domains ?? 0) >= 1, true);

  const markHelpfulResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        result_id: "seed_res_1",
        action: "mark_helpful"
      })
    }
  );
  assert.equal(markHelpfulResponse.status, 200);
  const markHelpfulData = await markHelpfulResponse.json();
  assert.equal(markHelpfulData?.ok, true);
  assert.equal(markHelpfulData?.action, "mark_helpful");
  assert.equal(markHelpfulData?.asset ?? null, null);
  assert.equal(markHelpfulData?.attachment ?? null, null);
  assert.equal(markHelpfulData?.decision ?? null, null);
  assert.equal(Number(markHelpfulData?.source_memory_summary?.total_domains ?? 0) >= 1, true);

  const promoteDecisionResponse = await fetch(
    `${baseUrl}/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(firstSegment.segment_id)}/research/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        result_id: "seed_res_1",
        action: "promote_to_decision"
      })
    }
  );
  assert.equal(promoteDecisionResponse.status, 200);
  const promoteDecisionData = await promoteDecisionResponse.json();
  assert.equal(promoteDecisionData?.decision?.segment_id, firstSegment.segment_id);
  assert.equal(promoteDecisionData?.asset?.kind, "link");
  assert.equal(typeof promoteDecisionData?.promoted_role, "string");
  assert.equal(promoteDecisionData?.promoted_role.length > 0, true);
  assert.equal(["source", "backup", "visual", "reference"].includes(String(promoteDecisionData?.attachment?.role ?? "")), true);
  assert.equal(Array.isArray(promoteDecisionData?.decision?.search_decision?.queries), true);
  assert.equal(promoteDecisionData?.decision?.search_decision?.queries?.length > 0, true);
  assert.equal(String(promoteDecisionData?.decision?.visual_decision?.type ?? "").length > 0, true);
  assert.equal(String(promoteDecisionData?.decision?.visual_decision?.description ?? "").length > 0, true);
  assert.equal(Array.isArray(promoteDecisionData?.decision?.research_sources), true);
  assert.equal(promoteDecisionData?.decision?.research_sources?.length >= 2, true);
  assert.equal(promoteDecisionData?.decision?.research_sources?.at(-1)?.role, promoteDecisionData?.promoted_role);
  assert.equal(promoteDecisionData?.decision?.research_sources?.at(-1)?.attachment_role, promoteDecisionData?.attachment?.role);

  const docAfterPromoteResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}`);
  assert.equal(docAfterPromoteResponse.status, 200);
  const docAfterPromoteData = await docAfterPromoteResponse.json();
  const promotedDecision = Array.isArray(docAfterPromoteData?.decisions)
    ? docAfterPromoteData.decisions.find((item) => item.segment_id === firstSegment.segment_id)
    : null;
  assert.equal(Array.isArray(promotedDecision?.search_decision?.queries), true);
  assert.equal(promotedDecision?.search_decision?.queries?.length > 0, true);
  assert.equal(String(promotedDecision?.visual_decision?.description ?? "").length > 0, true);
  assert.equal(promotedDecision?.research_sources?.at(-1)?.role, promoteDecisionData?.promoted_role);

  const sourceMemoryAfterApplyResponse = await fetch(`${baseUrl}/api/source-memory`);
  assert.equal(sourceMemoryAfterApplyResponse.status, 200);
  const sourceMemoryAfterApplyData = await sourceMemoryAfterApplyResponse.json();
  assert.equal(Array.isArray(sourceMemoryAfterApplyData?.summary?.top_domains), true);
  assert.equal(
    sourceMemoryAfterApplyData?.summary?.top_domains?.some((item) => String(item?.domain ?? "") === "reuters.com"),
    true
  );
  const reutersMemory = sourceMemoryAfterApplyData?.summary?.top_domains?.find(
    (item) => String(item?.domain ?? "") === "reuters.com"
  );
  assert.equal(Number(reutersMemory?.helpful_count ?? 0) >= 1, true);
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
  if (typeof shutdownServerRuntime === "function") {
    await shutdownServerRuntime();
  }
  await fs.rm(testDataDir, { recursive: true, force: true });
});
