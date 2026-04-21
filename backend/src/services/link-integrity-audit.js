import fs from "node:fs/promises";
import path from "node:path";

import { fileExists, readOptionalJson } from "../storage.js";
import { analyzeHistoricalLinkDrift, collectHistoricalLinkSections, unwrapSegmentsPayload } from "./link-integrity.js";

export async function listLinkIntegrityDocIds(dataDir) {
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && String(entry.name).startsWith("doc_"))
    .map((entry) => entry.name)
    .sort();
}

export async function listLinkIntegritySegmentVersions(docDir) {
  const entries = await fs.readdir(docDir);
  const files = entries
    .filter((name) => /^segments\.v\d+\.json$/i.test(name))
    .map((name) => ({
      name,
      version: Number(name.match(/\.v(\d+)\.json$/i)?.[1] ?? 0)
    }))
    .filter((entry) => entry.version > 0)
    .sort((left, right) => left.version - right.version);

  const versions = [];
  for (const file of files) {
    const fullPath = path.join(docDir, file.name);
    const segments = await readOptionalJson(fullPath);
    versions.push({
      version: file.version,
      segments: unwrapSegmentsPayload(segments)
    });
  }
  return versions;
}

export async function auditLinkIntegrityDocument(dataDir, docId) {
  const docDir = path.join(dataDir, docId);
  const currentSegments = unwrapSegmentsPayload(await readOptionalJson(path.join(docDir, "segments.json")));
  const versionEntries = await listLinkIntegritySegmentVersions(docDir);
  const historicalSections = collectHistoricalLinkSections(versionEntries, currentSegments);
  const drift = analyzeHistoricalLinkDrift(currentSegments, historicalSections);
  return {
    doc_id: docId,
    versions_scanned: versionEntries.length,
    ...drift
  };
}

export async function auditLinkIntegrityDataDir(dataDir) {
  if (!(await fileExists(dataDir))) {
    throw new Error(`Data dir not found: ${dataDir}`);
  }

  const docIds = await listLinkIntegrityDocIds(dataDir);
  const results = [];
  for (const docId of docIds) {
    results.push(await auditLinkIntegrityDocument(dataDir, docId));
  }

  const suspicious = results.filter((item) => item.suspicious);
  const summary = {
    data_dir: dataDir,
    scanned_documents: results.length,
    suspicious_documents: suspicious.length,
    suspicious_doc_ids: suspicious.map((item) => item.doc_id),
    max_historical_links: results.reduce(
      (max, item) => Math.max(max, Number(item.historical?.total_unique_links ?? 0)),
      0
    ),
    generated_at: new Date().toISOString()
  };

  return {
    summary,
    results: suspicious,
    all_results: results
  };
}
