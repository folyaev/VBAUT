import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auditLinkIntegrityDataDir } from "../src/services/link-integrity-audit.js";

test("auditLinkIntegrityDataDir reports suspicious documents with missing historical links", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-link-audit-"));
  try {
    const docDir = path.join(tempDir, "doc_test");
    await fs.mkdir(docDir, { recursive: true });
    await fs.writeFile(
      path.join(docDir, "segments.v1.json"),
      JSON.stringify([
        { segment_id: "seg_1", section_id: "s1", section_title: "Intro", section_index: 0, block_type: "text" },
        {
          segment_id: "links_1",
          section_id: "s1",
          section_title: "Intro",
          section_index: 0,
          block_type: "links",
          links: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }]
        }
      ]),
      "utf8"
    );
    await fs.writeFile(
      path.join(docDir, "segments.json"),
      JSON.stringify([
        { segment_id: "seg_1", section_id: "s1", section_title: "Intro", section_index: 0, block_type: "text" },
        {
          segment_id: "links_1",
          section_id: "s1",
          section_title: "Intro",
          section_index: 0,
          block_type: "links",
          links: [{ url: "https://example.com/a" }]
        }
      ]),
      "utf8"
    );

    const audit = await auditLinkIntegrityDataDir(tempDir);
    assert.equal(audit.summary.scanned_documents, 1);
    assert.equal(audit.summary.suspicious_documents, 1);
    assert.equal(audit.results.length, 1);
    assert.equal(audit.results[0].doc_id, "doc_test");
    assert.equal(audit.results[0].sections_with_missing_urls.length, 1);
    assert.equal(audit.results[0].sections_with_missing_urls[0].missing_urls[0], "https://example.com/b");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
