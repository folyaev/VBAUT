#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MODE_STAGED = process.argv.includes("--staged");

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".txt",
  ".yml",
  ".yaml",
  ".xml",
  ".cmd",
  ".bat",
  ".ps1",
  ".env",
  ".ini"
]);

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "data",
  "MediaDownloaderQt6-5.4.2",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache"
]);

const MOJIBAKE_RULES = [
  {
    id: "latin1-mojibake",
    reason: "Looks like UTF-8 text decoded as Latin-1/Windows-1252",
    regex: /[\u00D0\u00D1\u00C3\u00C2](?=[\u0080-\u00FF])/u
  },
  {
    id: "cp1251-mojibake",
    reason: "Looks like UTF-8 text decoded as CP1251/CP866",
    regex: /[РС][\u0080-\u00BF\u2018-\u203A]/u
  },
  {
    id: "replacement-char",
    reason: "Contains replacement character U+FFFD",
    regex: /\uFFFD/u
  }
];

async function main() {
  const files = MODE_STAGED ? getStagedFiles() : await getAllCandidateFiles(ROOT);
  const targets = files.filter(isCandidateTextFile);
  const findings = [];

  for (const relPath of targets) {
    const absPath = path.resolve(ROOT, relPath);
    const buffer = await fs.readFile(absPath).catch(() => null);
    if (!buffer) continue;
    if (buffer.includes(0)) continue;

    const text = buffer.toString("utf8");
    const hit = detectMojibake(text);
    if (!hit) continue;

    const loc = locateFirstMatch(text, hit.regex);
    findings.push({
      file: relPath,
      rule: hit.id,
      reason: hit.reason,
      line: loc.line,
      column: loc.column,
      sample: loc.sample
    });
  }

  if (findings.length === 0) {
    console.log(`encoding-guard: OK (${targets.length} files checked)`);
    process.exit(0);
  }

  console.error(`encoding-guard: FAILED (${findings.length} issue(s))`);
  for (const item of findings) {
    console.error(
      `- ${item.file}:${item.line}:${item.column} [${item.rule}] ${item.reason}\n  ${item.sample}`
    );
  }
  process.exit(1);
}

function getStagedFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    {
      cwd: ROOT,
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(`Cannot read staged files: ${message || "git diff failed"}`);
  }
  const raw = result.stdout || "";
  if (!raw) return [];
  return raw
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getAllCandidateFiles(rootDir) {
  const output = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      output.push(rel);
    }
  }
  return output;
}

function isCandidateTextFile(relPath) {
  const base = path.basename(relPath);
  if (base === ".editorconfig" || base === ".gitattributes" || base === ".gitignore") {
    return true;
  }
  if (relPath.startsWith(".githooks/")) return true;
  const ext = path.extname(relPath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function detectMojibake(text) {
  for (const rule of MOJIBAKE_RULES) {
    if (rule.regex.test(text)) return rule;
  }
  return null;
}

function locateFirstMatch(text, regex) {
  const match = text.match(regex);
  if (!match || typeof match.index !== "number") {
    return { line: 1, column: 1, sample: "" };
  }
  const index = match.index;
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  const lineStart = text.lastIndexOf("\n", index);
  const lineEnd = text.indexOf("\n", index);
  const start = lineStart === -1 ? 0 : lineStart + 1;
  const end = lineEnd === -1 ? text.length : lineEnd;
  const sample = text.slice(start, end).trim();
  return { line, column, sample };
}

main().catch((error) => {
  console.error(`encoding-guard: ERROR ${error?.message ?? error}`);
  process.exit(2);
});
