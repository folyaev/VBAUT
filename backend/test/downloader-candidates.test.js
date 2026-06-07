import test from "node:test";
import assert from "node:assert/strict";

import { isYtDlpCandidateUrl } from "../src/downloader.js";

test("isYtDlpCandidateUrl treats direct TikTok CDN video URLs as downloadable", () => {
  const url = "https://v16m.tiktokcdn-us.com/a1b49869ba09353cb84b76327a999a6c/6a0a3dd7/video/tos/useast2a/tos-useast2a-ve-0068-euttp/okIIEQGdjOeEARGUyLMPeOxKeJvIRIDgMUHgD1/?a=1233&mime_type=video_mp4&btag=e000b0000";
  assert.equal(isYtDlpCandidateUrl(url), true);
});

test("isYtDlpCandidateUrl treats direct TikTok CDN image URLs as downloadable", () => {
  const url = "https://p16-sign-va.tiktokcdn-us.com/tos-maliva-avt-0068/image.jpeg?mime_type=image_jpeg";
  assert.equal(isYtDlpCandidateUrl(url), true);
});

test("isYtDlpCandidateUrl treats direct image file URLs as downloadable", () => {
  assert.equal(isYtDlpCandidateUrl("https://cdn.example.com/news/photo.jpg"), true);
  assert.equal(isYtDlpCandidateUrl("https://cdn.example.com/news/photo.png?size=large"), true);
  assert.equal(isYtDlpCandidateUrl("https://cdn.example.com/news/photo.webp#preview"), true);
});
