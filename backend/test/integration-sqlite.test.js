import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createIntegrationSqliteMirrorService } from "../src/services/integration-sqlite.js";

test("integration sqlite returns document segments in scenario order", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-sqlite-order-"));

  const mirror = createIntegrationSqliteMirrorService({ dataDir });
  t.after(() => {
    mirror.close();
    return fs.rm(dataDir, { recursive: true, force: true });
  });
  mirror.syncDocumentContext(
    "doc_order",
    [
      { segment_id: "news_239", block_type: "news", section_title: "Альфа", text_quote: "first in script" },
      { segment_id: "news_07", block_type: "news", section_title: "Мендель", text_quote: "second in script" },
      { segment_id: "news_121", block_type: "news", section_title: "Unitree", text_quote: "third in script" }
    ],
    []
  );

  const ids = mirror.listDocSegments("doc_order").map((segment) => segment.segment_id);

  assert.deepEqual(ids, ["news_239", "news_07", "news_121"]);
});
