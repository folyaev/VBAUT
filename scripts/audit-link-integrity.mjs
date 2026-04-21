import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditLinkIntegrityDataDir } from "../backend/src/services/link-integrity-audit.js";
import { fileExists } from "../backend/src/storage.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");

function normalizeCliPath(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^file:\/+/, "")
    .replace(/\//g, path.sep);
}

function formatDocSummary(result) {
  const missingBlocks = result.sections_missing_link_blocks.length;
  const missingUrls = result.sections_with_missing_urls.reduce(
    (sum, section) => sum + (Array.isArray(section.missing_urls) ? section.missing_urls.length : 0),
    0
  );
  return [
    result.doc_id,
    `current=${result.current.total_links}`,
    `historical=${result.historical.total_unique_links}`,
    `missing_blocks=${missingBlocks}`,
    `missing_urls=${missingUrls}`
  ].join(" ");
}

async function main() {
  const args = process.argv.slice(2);
  let dataDir = DEFAULT_DATA_DIR;
  let writePath = "";
  let jsonOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--data-dir") {
      dataDir = path.resolve(normalizeCliPath(args[index + 1] ?? DEFAULT_DATA_DIR));
      index += 1;
      continue;
    }
    if (arg === "--write") {
      writePath = path.resolve(normalizeCliPath(args[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (arg === "--json") {
      jsonOnly = true;
    }
  }

  if (!(await fileExists(dataDir))) {
    throw new Error(`Data dir not found: ${dataDir}`);
  }

  const audit = await auditLinkIntegrityDataDir(dataDir);
  const payload = { summary: audit.summary, results: audit.results };

  if (writePath) {
    await fs.mkdir(path.dirname(writePath), { recursive: true });
    await fs.writeFile(writePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(
    `[audit-link-integrity] scanned=${audit.summary.scanned_documents} suspicious=${audit.summary.suspicious_documents} max_historical_links=${audit.summary.max_historical_links}`
  );
  for (const item of audit.results) {
    console.log(formatDocSummary(item));
  }
  if (writePath) {
    console.log(`[audit-link-integrity] report=${writePath}`);
  }
}

await main();
