import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeHistoricalLinkDrift,
  collectHistoricalLinkSections,
  pickWritableSegments
} from "../src/services/link-integrity.js";

test("pickWritableSegments prefers disk segments over stale fallback mirror", () => {
  const diskSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      section_id: "section_a",
      section_title: "Alpha",
      links: []
    },
    {
      segment_id: "links_section_a",
      block_type: "links",
      section_id: "section_a",
      section_title: "Alpha",
      links: [{ url: "https://example.com/a" }]
    }
  ];
  const fallbackSegments = [
    {
      segment_id: "news_01",
      block_type: "news",
      section_id: "section_a",
      section_title: "Alpha",
      links: []
    }
  ];

  const chosen = pickWritableSegments(diskSegments, fallbackSegments);
  assert.equal(chosen.length, 2);
  assert.equal(
    chosen.filter((segment) => String(segment?.block_type ?? "").toLowerCase() === "links").length,
    1
  );
});

test("historical link audit flags missing blocks and missing urls", () => {
  const currentSegments = [
    {
      segment_id: "news_alpha",
      block_type: "news",
      section_id: "section_alpha",
      section_title: "Alpha",
      section_index: 1,
      links: []
    },
    {
      segment_id: "news_beta",
      block_type: "news",
      section_id: "section_beta",
      section_title: "Beta",
      section_index: 2,
      links: []
    },
    {
      segment_id: "links_section_beta",
      block_type: "links",
      section_id: "section_beta",
      section_title: "Beta",
      section_index: 2,
      links: [{ url: "https://example.com/b-2" }]
    }
  ];
  const versionEntries = [
    {
      version: 1,
      segments: [
        ...currentSegments,
        {
          segment_id: "links_section_alpha",
          block_type: "links",
          section_id: "section_alpha",
          section_title: "Alpha",
          section_index: 1,
          links: [{ url: "https://example.com/a-1" }]
        },
        {
          segment_id: "links_section_beta",
          block_type: "links",
          section_id: "section_beta",
          section_title: "Beta",
          section_index: 2,
          links: [{ url: "https://example.com/b-1" }]
        }
      ]
    },
    {
      version: 2,
      segments: [
        ...currentSegments,
        {
          segment_id: "links_section_beta",
          block_type: "links",
          section_id: "section_beta",
          section_title: "Beta",
          section_index: 2,
          links: [{ url: "https://example.com/b-2" }]
        }
      ]
    }
  ];

  const historicalSections = collectHistoricalLinkSections(versionEntries, currentSegments);
  const audit = analyzeHistoricalLinkDrift(currentSegments, historicalSections);

  assert.equal(audit.historical.total_unique_links, 3);
  assert.equal(audit.current.total_links, 1);
  assert.equal(audit.sections_missing_link_blocks.length, 1);
  assert.equal(audit.sections_missing_link_blocks[0]?.section_id, "section_alpha");
  assert.equal(audit.sections_with_missing_urls.length, 1);
  assert.deepEqual(audit.sections_with_missing_urls[0]?.missing_urls, ["https://example.com/b-1"]);
  assert.equal(audit.suspicious, true);
});
