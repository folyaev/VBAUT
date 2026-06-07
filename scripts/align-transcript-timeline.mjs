#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTimelineAlignment,
  buildTimelineAlignmentReport,
  parseTranscriptBlocks,
  readTranscriptText
} from "../backend/src/services/timeline-alignment.js";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function readJson(filePath, fallback = null) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function findLatestDocDir(dataDir) {
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("doc_")) continue;
    const dir = path.join(dataDir, entry.name);
    const stat = await fs.stat(path.join(dir, "document.json")).catch(() => null);
    if (!stat) continue;
    candidates.push({ dir, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.dir ?? null;
}

function resolveDocDir(dataDir, docArg) {
  if (!docArg) return null;
  const raw = String(docArg);
  if (raw.includes("\\") || raw.includes("/") || raw.includes(":")) return path.resolve(raw);
  return path.join(dataDir, raw);
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(args.dataDir || path.join(repoRoot, "data"));
const transcriptPath = path.resolve(args.transcript || "C:\\tgbotapi\\NAV  2-1 CUT.txt");
const fps = Number.isFinite(Number(args.fps)) ? Math.max(1, Math.round(Number(args.fps))) : 50;
const docDir = resolveDocDir(dataDir, args.doc) || await findLatestDocDir(dataDir);

if (!docDir) {
  console.error("No document directory found. Pass --doc <doc_id_or_path>.");
  process.exit(1);
}

const document = await readJson(path.join(docDir, "document.json"), null);
const segments = await readJson(path.join(docDir, "segments.json"), []);
if (!document || !Array.isArray(segments)) {
  console.error(`Document files are missing or invalid: ${docDir}`);
  process.exit(1);
}

const transcriptText = await readTranscriptText(transcriptPath);
const transcriptBlocks = parseTranscriptBlocks(transcriptText, fps);
const alignment = buildTimelineAlignment({
  document,
  segments,
  transcriptBlocks,
  fps,
  options: {
    minScore: Number.isFinite(Number(args.minScore)) ? Number(args.minScore) : undefined,
    maxWindowBlocks: Number.isFinite(Number(args.maxWindowBlocks)) ? Number(args.maxWindowBlocks) : undefined
  }
});
alignment.source = transcriptPath;

const alignmentPath = path.join(docDir, "timeline-alignment.json");
const reportPath = path.join(docDir, "timeline-alignment-report.md");
await fs.writeFile(alignmentPath, `${JSON.stringify(alignment, null, 2)}\n`, "utf8");
await fs.writeFile(reportPath, buildTimelineAlignmentReport(alignment), "utf8");

console.log(`Document: ${document.id ?? path.basename(docDir)}`);
console.log(`Transcript blocks: ${alignment.transcript_blocks}`);
console.log(`Matched segments: ${alignment.matched_segments}/${alignment.total_segments}`);
console.log(`Unmatched segments: ${alignment.unmatched_segments.length}`);
console.log(`Unmatched transcript blocks: ${alignment.unmatched_transcript_blocks.length}`);
console.log(`Wrote: ${alignmentPath}`);
console.log(`Report: ${reportPath}`);
