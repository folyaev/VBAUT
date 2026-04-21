import { createSegmentStateRecoveryUtils } from "../src/services/segment-state-recovery.js";
import { getDocDir, readOptionalJson, saveVersioned } from "../src/storage.js";
import {
  emptySearchDecision,
  emptyVisualDecision,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput
} from "../src/services/normalizers.js";
import { normalizeLinksInput } from "../src/services/links.js";
import { createSegmentsMergeUtils } from "../src/services/segments-merge.js";

const { mergeSegmentsWithHistory } = createSegmentsMergeUtils({
  emptySearchDecision,
  emptyVisualDecision,
  normalizeLinksInput,
  normalizeSearchDecisionInput,
  normalizeVisualDecisionInput
});

const { recoverDocumentSegmentState } = createSegmentStateRecoveryUtils({
  getDocDir,
  mergeSegmentsWithHistory,
  normalizeDecisionsInput,
  normalizeSearchDecisionInput,
  normalizeSegmentsInput,
  normalizeVisualDecisionInput,
  readOptionalJson,
  saveVersioned
});

function parseArgs(argv = []) {
  const options = {
    docId: "",
    sourceSegmentsVersion: null,
    sourceDecisionsVersion: null,
    apply: false,
    scanLimit: 40
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "").trim();
    if (!token) continue;
    if (token === "--apply") {
      options.apply = true;
      continue;
    }
    if (token === "--doc") {
      options.docId = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--segments-version") {
      const value = Number(argv[index + 1]);
      options.sourceSegmentsVersion = Number.isFinite(value) && value > 0 ? value : null;
      index += 1;
      continue;
    }
    if (token === "--decisions-version") {
      const value = Number(argv[index + 1]);
      options.sourceDecisionsVersion = Number.isFinite(value) && value > 0 ? value : null;
      index += 1;
      continue;
    }
    if (token === "--scan-limit") {
      const value = Number(argv[index + 1]);
      options.scanLimit = Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : options.scanLimit;
      index += 1;
      continue;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

recoverDocumentSegmentState(options)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
