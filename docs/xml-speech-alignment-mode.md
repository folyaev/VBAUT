# XML speech alignment mode

This is a parked design note for the experimental XML export mode that aligns visual segments to the cleaned transcript timeline.

## Goal

Use `timeline-alignment.json` generated from a cut transcript such as `C:\tgbotapi\NAV  2-1 CUT.txt` so XML illustrations land at the moment where the segment text is spoken.

## Current components

- `backend/src/services/timeline-alignment.js`
  - Parses transcript timecode blocks.
  - Normalizes known ASR mistakes, for example:
    - `АвтоВАЗа два` -> `The Last of Us II`
    - `На полу в Юте сквозь двор` -> `Call of Duty Black Ops Cold War`
  - Matches document segments to transcript windows.
  - Writes matched `start_frame` / `end_frame` per segment.

- `scripts/align-transcript-timeline.mjs`
  - CLI for rebuilding:
    `node scripts/align-transcript-timeline.mjs --doc <docId> --transcript "<cut transcript path>" --fps 50`

- Output files:
  - `data/<docId>/timeline-alignment.json`
  - `data/<docId>/timeline-alignment-report.md`

## Problems observed

- The cut transcript may not follow original document order. In the current `NAV  2-1 CUT.txt`, the `Альфа` ad appears before `Интро`, while the document order starts with `Интро`.
- Some segments in `segments.json` are already out of real scenario order after prior re-segmentation. Examples seen:
  - `Ермак`: `news_88/news_89` logically precede `news_07...news_42`.
  - `ВПН в Европе`: `news_160/news_161` logically precede `news_133...`.
- Unmatched segments with media need local fallback slots between neighboring matched segments; sending them to the end makes the XML look random.
- Auto background generation (`bg_lines/bg_whirl`) made Premiere timelines noisy, especially while debugging placement.

## Revival checklist

1. Keep normal XML export in simple document-order mode by default.
2. Add an explicit opt-in flag/query for speech alignment export, not automatic use of `timeline-alignment.json`.
3. Before enabling alignment, repair source segment order or store an explicit scenario order independent of `segment_id` and source array index.
4. Add diagnostics to exported XML:
   - segment id in marker/comment metadata,
   - report of unmatched media segments,
   - report of clips sorted differently from document/scenario order.
5. Keep automatic backgrounds disabled unless explicitly requested.
