import test from "node:test";
import assert from "node:assert/strict";

import { detectDownloaderOperatorNotice, isYouTubeLikeUrl } from "../src/services/downloader-operator-notices.js";

test("isYouTubeLikeUrl detects youtube hosts", () => {
  assert.equal(isYouTubeLikeUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeLikeUrl("https://youtu.be/abc"), true);
  assert.equal(isYouTubeLikeUrl("https://example.com/watch?v=abc"), false);
});

test("detectDownloaderOperatorNotice returns hint for youtube anti-bot failures", () => {
  const notice = detectDownloaderOperatorNotice({
    url: "https://www.youtube.com/watch?v=abc",
    errorDetail: "ERROR: Sign in to confirm you're not a bot",
    cookiesTargetPath: "C:/tmp/global-cookies.json",
    cookiesSourceLabel: "LINK_SCREENSHOT_COOKIES_PATH"
  });
  assert.equal(notice?.code, "youtube_cookies_refresh_required");
  assert.equal(notice?.title, "Обновить cookies YouTube");
  assert.equal(Array.isArray(notice?.domains), true);
  assert.equal(notice?.domains?.includes("youtube.com"), true);
  assert.equal(notice?.target_path, "C:/tmp/global-cookies.json");
});

test("detectDownloaderOperatorNotice returns hint for youtube age-gate failures", () => {
  const notice = detectDownloaderOperatorNotice({
    url: "https://www.youtube.com/watch?v=abc",
    errorDetail: "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.",
    cookiesTargetPath: "C:/tmp/global-cookies.json"
  });
  assert.equal(notice?.code, "youtube_auth_refresh_required");
  assert.equal(notice?.title, "Обновить авторизацию YouTube");
});

test("detectDownloaderOperatorNotice distinguishes stalled youtube stream after metadata", () => {
  const notice = detectDownloaderOperatorNotice({
    url: "https://www.youtube.com/watch?v=abc",
    errorDetail: "yt-dlp stalled after metadata with no download progress for 45s",
    cookiesTargetPath: "C:/tmp/global-cookies.json"
  });
  assert.equal(notice?.code, "youtube_stream_stalled_after_metadata");
  assert.equal(notice?.title, "Поток YouTube завис после metadata");
});

test("detectDownloaderOperatorNotice ignores non-youtube failures", () => {
  const notice = detectDownloaderOperatorNotice({
    url: "https://example.com/video",
    errorDetail: "ERROR: Sign in to confirm you're not a bot"
  });
  assert.equal(notice, null);
});
