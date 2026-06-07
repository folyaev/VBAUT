import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createXmlExportUtils } from "../src/services/xml-export.js";

function createXmlUtilsForTest({ mediaDir, backgroundRoot, mediaInfoByName, autoBackgrounds = false, timelineAlignment = false }) {
  process.env.XML_BACKGROUND_ROOT = backgroundRoot;
  if (autoBackgrounds) {
    process.env.XML_AUTO_BACKGROUNDS_ENABLED = "1";
  } else {
    process.env.XML_AUTO_BACKGROUNDS_ENABLED = "0";
  }
  if (timelineAlignment) {
    process.env.XML_TIMELINE_ALIGNMENT_ENABLED = "1";
  } else {
    delete process.env.XML_TIMELINE_ALIGNMENT_ENABLED;
  }

  return createXmlExportUtils({
    execFileAsync: async (_executable, args) => {
      const targetPath = path.basename(String(args?.[args.length - 1] ?? ""));
      const mediaInfo = mediaInfoByName[targetPath];
      if (!mediaInfo) {
        throw new Error(`Unexpected ffprobe target: ${targetPath}`);
      }
      return {
        stdout: JSON.stringify({
          streams: [
            mediaInfo.hasVideo
              ? {
                  codec_type: "video",
                  width: mediaInfo.width,
                  height: mediaInfo.height,
                  avg_frame_rate: mediaInfo.fps ? `${mediaInfo.fps}/1` : undefined,
                  r_frame_rate: mediaInfo.fps ? `${mediaInfo.fps}/1` : undefined,
                  duration: mediaInfo.durationSec
                }
              : null,
            mediaInfo.hasAudio
              ? {
                  codec_type: "audio",
                  channels: mediaInfo.audioChannels ?? 2,
                  duration: mediaInfo.durationSec
                }
              : null
          ].filter(Boolean),
          format: {
            duration: mediaInfo.durationSec
          }
        })
      };
    },
    downloaderTools: {},
    getMediaDir: () => mediaDir,
    normalizeMediaFilePath: (value) => String(value ?? "").trim(),
    normalizeSectionTitleForMatch: (value) => String(value ?? "").trim().toLowerCase(),
    normalizeVisualDecisionInput: (value) => ({ ...(value ?? {}) }),
    safeResolveMediaPath: (root, mediaPath) => path.resolve(root, mediaPath)
  });
}

test("xml export keeps full source duration for trimmed video clipitems", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-export-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await fs.writeFile(path.join(mediaDir, "clip.mp4"), "");

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      mediaInfoByName: {
        "clip.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 8
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Trimmed clip",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "clip.mp4",
              duration_hint_sec: 3,
              media_start_timecode: "00:00:02:00"
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    assert.match(payload.xml, /<duration>400<\/duration>/);
    assert.match(payload.xml, /<in>100<\/in>/);
    assert.match(payload.xml, /<out>250<\/out>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export scales non-template landscape media to sequence width", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-scale-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "clip-1278.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "clip-1316.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "clip-884.mp4"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      mediaInfoByName: {
        "clip-1278.mp4": { hasVideo: true, hasAudio: false, width: 1278, height: 720, durationSec: 5 },
        "clip-1316.mp4": { hasVideo: true, hasAudio: false, width: 1316, height: 744, durationSec: 5 },
        "clip-884.mp4": { hasVideo: true, hasAudio: false, width: 884, height: 508, durationSec: 5 }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-scale" },
      segments: [
        { segment_id: "seg_1", section_id: "s", section_title: "Scale", text_quote: "a", block_type: "segment" },
        { segment_id: "seg_2", section_id: "s", section_title: "Scale", text_quote: "b", block_type: "segment" },
        { segment_id: "seg_3", section_id: "s", section_title: "Scale", text_quote: "c", block_type: "segment" }
      ],
      decisionsBySegment: new Map([
        ["seg_1", { visual: { media_file_path: "clip-1278.mp4" } }],
        ["seg_2", { visual: { media_file_path: "clip-1316.mp4" } }],
        ["seg_3", { visual: { media_file_path: "clip-884.mp4" } }]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    assert.match(payload.xml, /<width>1278<\/width>[\s\S]*?<parameterid>scale<\/parameterid>[\s\S]*?<value>150\.2347<\/value>/);
    assert.match(payload.xml, /<width>1316<\/width>[\s\S]*?<parameterid>scale<\/parameterid>[\s\S]*?<value>145\.8967<\/value>/);
    assert.match(payload.xml, /<width>884<\/width>[\s\S]*?<parameterid>scale<\/parameterid>[\s\S]*?<value>217\.1946<\/value>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export keeps segment bg_lines backgrounds anchored at zero source in", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-background-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "clip-a.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "clip-b.mp4"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_whirl.mov"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_lines.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "clip-a.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 1080,
          durationSec: 6
        },
        "clip-b.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 1080,
          durationSec: 6
        },
        "bg_whirl.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 12
        },
        "bg_lines.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 12
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Wide clip 1",
          block_type: "segment"
        },
        {
          segment_id: "seg_2",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Wide clip 2",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "clip-a.mp4",
              duration_hint_sec: 3
            }
          }
        ],
        [
          "seg_2",
          {
            visual: {
              media_file_path: "clip-b.mp4",
              duration_hint_sec: 3
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const bgLinesBlocks = payload.xml
      .split(/(?=<clipitem id=")/)
      .filter((block) => block.includes("<name>bg_lines.mov</name>"));
    assert.equal(bgLinesBlocks.length, 1);
    const bgLinesBlock = bgLinesBlocks[0];
    assert.ok(bgLinesBlock, "segment bg_lines clipitem missing from xml");
    assert.match(bgLinesBlock, /<start>150<\/start>/);
    assert.match(bgLinesBlock, /<end>300<\/end>/);
    assert.match(bgLinesBlock, /<in>0<\/in>/);
    assert.match(bgLinesBlock, /<out>150<\/out>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export writes native source rate and duration for background files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-bg-native-rate-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "clip-a.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "clip-b.mp4"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_whirl.mov"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_lines.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "clip-a.mp4": { hasVideo: true, hasAudio: false, width: 3840, height: 1080, durationSec: 6, fps: 50 },
        "clip-b.mp4": { hasVideo: true, hasAudio: false, width: 3840, height: 1080, durationSec: 6, fps: 50 },
        "bg_whirl.mov": { hasVideo: true, hasAudio: false, width: 3840, height: 2160, durationSec: 12.04, fps: 25 },
        "bg_lines.mov": { hasVideo: true, hasAudio: false, width: 3840, height: 1920, durationSec: 11.04, fps: 25 }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-bg-native-rate" },
      segments: [
        { segment_id: "seg_1", section_id: "intro", section_title: "Intro", text_quote: "Wide clip 1", block_type: "segment" },
        { segment_id: "seg_2", section_id: "intro", section_title: "Intro", text_quote: "Wide clip 2", block_type: "segment" }
      ],
      decisionsBySegment: new Map([
        ["seg_1", { visual: { media_file_path: "clip-a.mp4", duration_hint_sec: 3 } }],
        ["seg_2", { visual: { media_file_path: "clip-b.mp4", duration_hint_sec: 8 } }]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const bgLinesBlock = payload.xml
      .split(/(?=<clipitem id=")/)
      .find((block) => block.includes("<name>bg_lines.mov</name>"));
    assert.ok(bgLinesBlock, "bg_lines clipitem missing from xml");
    assert.match(bgLinesBlock, /<enabled>TRUE<\/enabled>\s*<duration>552<\/duration>/);
    assert.match(bgLinesBlock, /<start>150<\/start>/);
    assert.match(bgLinesBlock, /<end>550<\/end>/);
    assert.match(bgLinesBlock, /<file id="[^"]+">[\s\S]*?<rate>\s*<timebase>25<\/timebase>/);
    assert.match(bgLinesBlock, /<file id="[^"]+">[\s\S]*?<duration>276<\/duration>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export adds ribbon or whirl background for non-square non-sequence-aspect images", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-image-bg-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "four-three.png"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_ribbon.mov"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_whirl.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "four-three.png": {
          hasVideo: true,
          hasAudio: false,
          width: 2560,
          height: 1920,
          durationSec: null
        },
        "bg_ribbon.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 1920,
          durationSec: 12
        },
        "bg_whirl.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 2160,
          durationSec: 12
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-image-bg" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "ads",
          section_title: "Ads",
          text_quote: "Four three image",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "four-three.png",
              duration_hint_sec: 3
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const ribbonBlock = payload.xml.match(/<clipitem id="[^"]+">[\s\S]*?<name>bg_ribbon\.mov<\/name>[\s\S]*?<\/clipitem>/);
    assert.ok(ribbonBlock, "bg_ribbon clipitem missing from xml");
    assert.match(ribbonBlock[0], /<start>0<\/start>/);
    assert.match(ribbonBlock[0], /<end>150<\/end>/);
    assert.match(ribbonBlock[0], /<in>0<\/in>/);

    const imageBlock = payload.xml.match(/<clipitem id="[^"]+">[\s\S]*?<name>four-three\.png<\/name>[\s\S]*?<\/clipitem>/);
    assert.ok(imageBlock, "image clipitem missing from xml");
    assert.match(imageBlock[0], /<start>0<\/start>/);
    assert.match(imageBlock[0], /<end>150<\/end>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export does not add background for square images", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-square-no-bg-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "square.png"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_ribbon.mov"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_whirl.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "square.png": {
          hasVideo: true,
          hasAudio: false,
          width: 960,
          height: 960,
          durationSec: null
        },
        "bg_ribbon.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 1920,
          durationSec: 12
        },
        "bg_whirl.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 2160,
          durationSec: 12
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-square-no-bg" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "ads",
          section_title: "Ads",
          text_quote: "Square image",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "square.png",
              duration_hint_sec: 3
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    assert.doesNotMatch(payload.xml, /<name>bg_ribbon\.mov<\/name>/);
    assert.doesNotMatch(payload.xml, /<name>bg_whirl\.mov<\/name>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export places multiple media files in one aligned segment sequentially", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-sequential-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "clip-a.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "clip-b.mp4"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      timelineAlignment: true,
      mediaInfoByName: {
        "clip-a.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 10
        },
        "clip-b.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 10
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Two clips",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_paths: ["clip-a.mp4", "clip-b.mp4"],
              duration_hint_sec: 4
            }
          }
        ]
      ]),
      timelineAlignment: {
        items: [
          {
            segment_id: "seg_1",
            matched: true,
            start_frame: 100,
            end_frame: 300
          }
        ]
      },
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const clipA = payload.xml.match(/<clipitem id="[^"]+">[\s\S]*?<name>clip-a\.mp4<\/name>[\s\S]*?<\/clipitem>/);
    const clipB = payload.xml.match(/<clipitem id="[^"]+">[\s\S]*?<name>clip-b\.mp4<\/name>[\s\S]*?<\/clipitem>/);
    assert.ok(clipA, "clip-a clipitem missing from xml");
    assert.ok(clipB, "clip-b clipitem missing from xml");
    assert.match(clipA[0], /<start>100<\/start>/);
    assert.match(clipA[0], /<end>200<\/end>/);
    assert.match(clipB[0], /<start>200<\/start>/);
    assert.match(clipB[0], /<end>300<\/end>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export does not split background into one-frame loops when duration is unknown", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-bg-unknown-duration-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "wide.mp4"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_whirl.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "wide.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 3840,
          height: 1080,
          durationSec: 10
        },
        "bg_whirl.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: null
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Wide clip",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "wide.mp4",
              duration_hint_sec: 4
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const backgroundClipItems = payload.xml.match(/<name>bg_whirl\.mov<\/name>/g) ?? [];
    assert.equal(backgroundClipItems.length, 2);
    const backgroundBlock = payload.xml.match(/<clipitem id="[^"]+">[\s\S]*?<name>bg_whirl\.mov<\/name>[\s\S]*?<\/clipitem>/);
    assert.ok(backgroundBlock, "bg_whirl clipitem missing from xml");
    assert.match(backgroundBlock[0], /<start>0<\/start>/);
    assert.match(backgroundBlock[0], /<end>200<\/end>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export does not add a global bg_lines bed", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-global-bg-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "clip.mp4"), ""),
      fs.writeFile(path.join(backgroundRoot, "bg_lines.mov"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      autoBackgrounds: true,
      mediaInfoByName: {
        "clip.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 10
        },
        "bg_lines.mov": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: null
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "intro",
          section_title: "Intro",
          text_quote: "Intro clip",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_path: "clip.mp4",
              duration_hint_sec: 4
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    const backgroundBlocks = payload.xml
      .split(/(?=<clipitem id=")/)
      .filter((block) => block.includes("<name>bg_lines.mov</name>"));
    assert.equal(backgroundBlocks.length, 0);
    assert.doesNotMatch(payload.xml, /global-bg-lines/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("xml export skips media from another topic folder by default", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbaut-xml-cross-topic-"));
  try {
    const mediaDir = path.join(tempDir, "media");
    const backgroundRoot = path.join(tempDir, "backgrounds");
    await fs.mkdir(path.join(mediaDir, "Bees"), { recursive: true });
    await fs.mkdir(path.join(mediaDir, "Swatch"), { recursive: true });
    await fs.mkdir(backgroundRoot, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(mediaDir, "Bees", "bee.mp4"), ""),
      fs.writeFile(path.join(mediaDir, "Swatch", "watch.mp4"), "")
    ]);

    const { buildXmlExportPayload } = createXmlUtilsForTest({
      mediaDir,
      backgroundRoot,
      mediaInfoByName: {
        "bee.mp4": {
          hasVideo: true,
          hasAudio: false,
          width: 1920,
          height: 1080,
          durationSec: 10
        }
      }
    });

    const payload = await buildXmlExportPayload({
      document: { id: "doc-test" },
      segments: [
        {
          segment_id: "seg_1",
          section_id: "bees",
          section_title: "Bees (1)",
          text_quote: "Bee segment",
          block_type: "segment"
        }
      ],
      decisionsBySegment: new Map([
        [
          "seg_1",
          {
            visual: {
              media_file_paths: ["Swatch/watch.mp4", "Bees/bee.mp4"],
              duration_hint_sec: 4
            }
          }
        ]
      ]),
      mediaDir,
      mediaPathRootOverride: null,
      fps: 50,
      defaultDurationSec: 5,
      sectionId: "",
      sectionTitle: ""
    });

    assert.match(payload.xml, /<name>bee\.mp4<\/name>/);
    assert.doesNotMatch(payload.xml, /<name>watch\.mp4<\/name>/);
  } finally {
    delete process.env.XML_BACKGROUND_ROOT;
    delete process.env.XML_AUTO_BACKGROUNDS_ENABLED;
    delete process.env.XML_TIMELINE_ALIGNMENT_ENABLED;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
