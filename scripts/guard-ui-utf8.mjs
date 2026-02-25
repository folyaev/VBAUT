#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TARGET_DIRS = ["frontend/src", "frontend/public"];
const TARGET_FILES = ["README.md", "AGENTS.md"];
const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".md", ".json"]);

const RULES = [
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
  const files = await collectFiles();
  const findings = [];

  for (const relPath of files) {
    const absPath = path.resolve(ROOT, relPath);
    const buffer = await fs.readFile(absPath).catch(() => null);
    if (!buffer) continue;
    if (buffer.includes(0)) continue;

    const text = buffer.toString("utf8");
    const hit = RULES.find((rule) => rule.regex.test(text));
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
    console.log(`ui-utf8-guard: OK (${files.length} files checked)`);
    process.exit(0);
  }

  console.error(`ui-utf8-guard: FAILED (${findings.length} issue(s))`);
  findings.forEach((item) => {
    console.error(`- ${item.file}:${item.line}:${item.column} [${item.rule}] ${item.reason}\n  ${item.sample}`);
  });
  process.exit(1);
}

async function collectFiles() {
  const out = [];
  for (const relFile of TARGET_FILES) {
    const abs = path.resolve(ROOT, relFile);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat?.isFile()) out.push(relFile);
  }

  for (const relDir of TARGET_DIRS) {
    const absDir = path.resolve(ROOT, relDir);
    const exists = await fs.stat(absDir).catch(() => null);
    if (!exists?.isDirectory()) continue;
    const stack = [absDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) continue;
        out.push(path.relative(ROOT, abs).split(path.sep).join("/"));
      }
    }
  }

  return Array.from(new Set(out)).sort();
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
  console.error(`ui-utf8-guard: ERROR ${error?.message ?? error}`);
  process.exit(2);
});
