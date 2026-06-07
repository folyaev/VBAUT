import assert from "node:assert/strict";
import test from "node:test";

import { generateSegmentsOnly } from "../src/llm.js";

test("heading segmentation keeps M.Video brand together across spaces and line breaks", async () => {
  const segments = await generateSegmentsOnly({
    text: [
      "### Мвидео",
      "Уйти домой, чтобы финально обдумать и на следующий день купить.",
      "М. Видео было одним из таких мест в России. Но сейчас М.",
      "Видео- это больше, чем техника.",
      "Теперь в М. Видео можно купить рекламу на ракетах."
    ].join("\n")
  });

  const quotes = segments.map((segment) => String(segment?.text_quote ?? ""));
  assert.ok(quotes.length >= 1);
  assert.equal(quotes.some((quote) => quote.trim() === "М."), false);
  assert.equal(quotes.some((quote) => /\b[МM]\.\s*$/u.test(quote)), false);
  assert.ok(quotes.join(" ").includes("М.Видео было одним из таких мест"));
  assert.ok(quotes.join(" ").includes("Но сейчас М.Видео- это больше"));
  assert.ok(quotes.join(" ").includes("Теперь в М.Видео можно купить"));
});
