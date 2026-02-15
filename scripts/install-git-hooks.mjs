#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GIT_DIR = path.join(ROOT, ".git");

if (!fs.existsSync(GIT_DIR)) {
  console.log("hooks-install: skip (.git not found)");
  process.exit(0);
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: ROOT,
  encoding: "utf8"
});

if (result.status !== 0) {
  const message = (result.stderr || result.stdout || "").trim();
  console.warn(`hooks-install: warning (${message || "git config failed"})`);
  process.exit(0);
}

console.log("hooks-install: core.hooksPath=.githooks");
