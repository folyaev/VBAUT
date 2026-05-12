import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDownloadThemeMoveAuditPayload,
  buildTelegramAssetPathRepairPlan,
  clearTelegramSdvgSessionEphemeralState,
  createEmptyTelegramSdvgSession,
  createTelegramSdvgBotService,
  ensureTelegramMediaBatchMap,
  getTelegramMediaBatchAudit,
  isTelegramSdvgControlCommandText,
  isTelegramSdvgControlUpdate,
  sweepIdleTelegramSdvgSessions,
  touchTelegramSdvgSession,
  upsertTelegramMediaBatchAudit
} from "../src/services/telegram-sdvg-bot.js";

test("createTelegramSdvgBotService does not start without TELEGRAM_BOT_TOKEN", async (t) => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  t.after(() => {
    if (previous == null) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });

  const service = createTelegramSdvgBotService({});
  assert.equal(service.getRuntimeInfo().configured, false);
  assert.equal(service.start(), false);
});

test("telegram SDVG control detector allows commands and callbacks in ignored threads", () => {
  assert.equal(isTelegramSdvgControlCommandText("/start"), true);
  assert.equal(isTelegramSdvgControlCommandText("/sdvg"), true);
  assert.equal(isTelegramSdvgControlCommandText("/sdvg random"), true);
  assert.equal(isTelegramSdvgControlCommandText("/sdvg@utsearchbot doc_1"), true);
  assert.equal(isTelegramSdvgControlCommandText("/download"), true);
  assert.equal(isTelegramSdvgControlCommandText("/research"), true);
  assert.equal(isTelegramSdvgControlCommandText("/threadid"), true);
  assert.equal(isTelegramSdvgControlCommandText("plain text"), false);
  assert.equal(isTelegramSdvgControlCommandText("/sdvgx"), false);

  assert.equal(isTelegramSdvgControlUpdate({ message: { text: "/sdvg", message_thread_id: 10 } }), true);
  assert.equal(isTelegramSdvgControlUpdate({ callback_query: { data: "sdvg_next" } }), true);
  assert.equal(isTelegramSdvgControlUpdate({ callback_query: { data: "other" } }), false);
});

test("clearTelegramSdvgSessionEphemeralState clears pending timers and volatile maps", () => {
  const session = createEmptyTelegramSdvgSession("doc_test");
  session.card_contexts.set("1", { ok: true });
  session.file_picker_contexts.set("1", { ok: true });
  session.research_suggestion_contexts.set("1", { ok: true });
  session.research_status_message_ids.set("1", 123);
  session.download_theme_contexts.set("1", { ok: true });
  session.screenshot_preview_contexts.set("1", { ok: true });
  session.card_action_locks.add("lock");
  session.project_archive_request = { doc_id: "doc_test" };
  session.download_theme_create_request = { prompt_message_id: 10 };
  session.download_theme_search_request = { prompt_message_id: 11 };
  const timeout = setTimeout(() => {}, 60_000);
  session.pending_inbox_media_groups.set("grp", { timeout, mediaItems: [{ id: 1 }] });
  const sdvgTimeout = setTimeout(() => {}, 60_000);
  session.pending_sdvg_media_groups.set("sdvg", { timeout: sdvgTimeout, mediaItems: [{ id: 2 }] });
  ensureTelegramMediaBatchMap(session).set("batch_1", { ok: true });

  clearTelegramSdvgSessionEphemeralState(session);

  assert.equal(session.card_contexts.size, 0);
  assert.equal(session.file_picker_contexts.size, 0);
  assert.equal(session.research_suggestion_contexts.size, 0);
  assert.equal(session.research_status_message_ids.size, 0);
  assert.equal(session.download_theme_contexts.size, 0);
  assert.equal(session.screenshot_preview_contexts.size, 0);
  assert.equal(session.pending_inbox_media_groups.size, 0);
  assert.equal(session.pending_sdvg_media_groups.size, 0);
  assert.equal(session.telegram_media_batches.size, 0);
  assert.equal(session.card_action_locks.size, 0);
  assert.equal(session.project_archive_request, null);
  assert.equal(session.download_theme_create_request, null);
  assert.equal(session.download_theme_search_request, null);
});

test("sweepIdleTelegramSdvgSessions removes stale sessions and keeps fresh ones", () => {
  const sessions = new Map();
  const stale = createEmptyTelegramSdvgSession("doc_stale", 1_000);
  const fresh = createEmptyTelegramSdvgSession("doc_fresh", 95_000);
  sessions.set("100", stale);
  sessions.set("200", fresh);

  const result = sweepIdleTelegramSdvgSessions(sessions, {
    now: 100_000,
    ttlMs: 60_000
  });

  assert.equal(result.scanned_count, 2);
  assert.equal(result.removed_count, 1);
  assert.deepEqual(result.removed_chat_ids, ["100"]);
  assert.equal(sessions.has("100"), false);
  assert.equal(sessions.has("200"), true);
});

test("touchTelegramSdvgSession refreshes session timestamp", () => {
  const session = createEmptyTelegramSdvgSession("doc_touch", 100);
  touchTelegramSdvgSession(session, 500);
  assert.equal(session.__last_touched_at, 500);
});

test("buildDownloadThemeMoveAuditPayload summarizes move outcomes", () => {
  const payload = buildDownloadThemeMoveAuditPayload({
    chatId: 42,
    context: { doc_id: "doc_1", segment_id: "seg_1" },
    selectedTheme: "Russia",
    movedItems: [
      {
        relative_path: "UNSORTED/a.mp4",
        next_relative_path: "Russia/a.mp4",
        asset_id: "asset_1",
        move_strategy: "renamed",
        source_deleted: true,
        reused_existing: false,
        renamed_with_suffix: false
      },
      {
        relative_path: "UNSORTED/b.mp4",
        next_relative_path: "Russia/b_1.mp4",
        asset_id: "asset_2",
        move_strategy: "copied_then_deleted",
        source_deleted: true,
        reused_existing: false,
        renamed_with_suffix: true
      },
      {
        relative_path: "Russia/c.mp4",
        next_relative_path: "Russia/c.mp4",
        asset_id: "asset_3",
        move_strategy: "already_in_theme",
        source_deleted: false,
        reused_existing: false,
        renamed_with_suffix: false
      }
    ]
  });

  assert.equal(payload.chat_id, "42");
  assert.equal(payload.doc_id, "doc_1");
  assert.equal(payload.segment_id, "seg_1");
  assert.equal(payload.theme, "Russia");
  assert.equal(payload.item_count, 3);
  assert.deepEqual(payload.strategies, ["renamed", "copied_then_deleted", "already_in_theme"]);
  assert.equal(payload.all_source_deleted, true);
  assert.equal(payload.reused_existing_count, 0);
  assert.equal(payload.renamed_with_suffix_count, 1);
  assert.equal(payload.moved_paths.length, 3);
  assert.equal(payload.moved_paths[1].renamed_with_suffix, true);
});

test("buildTelegramAssetPathRepairPlan repairs only unique stale unsorted assets", () => {
  const plan = buildTelegramAssetPathRepairPlan(
    [
      { id: "asset_1", local_path: "UNSORTED/a.mp4" },
      { id: "asset_2", local_path: "UNSORTED/b.mp4" },
      { id: "asset_3", local_path: "Topic/c.mp4" },
      { id: "asset_4", local_path: "UNSORTED/already-there.mp4" }
    ],
    [
      "Topic A/a.mp4",
      "Topic B/b.mp4",
      "Topic C/b.mp4",
      "UNSORTED/already-there.mp4"
    ]
  );

  assert.deepEqual(plan, [
    {
      asset_id: "asset_1",
      previous_relative_path: "UNSORTED/a.mp4",
      next_relative_path: "Topic A/a.mp4"
    }
  ]);
});

test("telegram media batch audit upserts and returns normalized state", () => {
  const session = createEmptyTelegramSdvgSession("doc_test");
  const batch = upsertTelegramMediaBatchAudit(session, "batch_1", {
    doc_id: "doc_test",
    segment_id: "news_01",
    expected: 3,
    downloaded: 2,
    failed: 1,
    retried: 1,
    status: "partial",
    failed_items: [
      {
        file_id: "file_1",
        file_unique_id: "uniq_1",
        file_name: "shot.png",
        retry_count: 2
      }
    ]
  });

  assert.equal(batch.batch_id, "batch_1");
  assert.equal(batch.expected, 3);
  assert.equal(batch.downloaded, 2);
  assert.equal(batch.failed, 1);
  assert.equal(batch.retried, 1);
  assert.equal(batch.failed_items.length, 1);
  assert.equal(getTelegramMediaBatchAudit(session, "batch_1")?.segment_id, "news_01");
});
