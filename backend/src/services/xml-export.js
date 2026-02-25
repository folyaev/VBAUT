import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function createXmlExportUtils(deps) {
  const {
    execFileAsync,
    downloaderTools,
    getMediaDir,
    normalizeMediaFilePath,
    normalizeSectionTitleForMatch,
    normalizeVisualDecisionInput,
    safeResolveMediaPath
  } = deps;

  const XML_EXPORT_FPS = Number.isFinite(Number(process.env.XML_EXPORT_FPS))
    ? Math.max(1, Number(process.env.XML_EXPORT_FPS))
    : 50;
  const XML_EXPORT_DEFAULT_DURATION_SEC = Number.isFinite(Number(process.env.XML_EXPORT_DEFAULT_DURATION_SEC))
    ? Math.max(0.2, Number(process.env.XML_EXPORT_DEFAULT_DURATION_SEC))
    : 5;
  const XML_SECTION_MARKER_DURATION_SEC = Number.isFinite(Number(process.env.XML_SECTION_MARKER_DURATION_SEC))
    ? Math.max(0, Number(process.env.XML_SECTION_MARKER_DURATION_SEC))
    : 2;
  const XML_SECTION_GAP_SEC = Number.isFinite(Number(process.env.XML_SECTION_GAP_SEC))
    ? Math.max(0, Number(process.env.XML_SECTION_GAP_SEC))
    : 0;
  const XML_SEQUENCE_WIDTH = 1920;
  const XML_SEQUENCE_HEIGHT = 960;
  const XML_SECTION_MARKER_COLOR = "4294741314";
  const XML_DEFAULT_CENTER = {
    x: XML_SEQUENCE_WIDTH / 2,
    y: XML_SEQUENCE_HEIGHT / 2
  };
  const XML_DEFAULT_MOTION_TEMPLATE = {
    scale: 100,
    center: XML_DEFAULT_CENTER
  };
  const XML_BASIC_MOTION_TEMPLATES = new Map(
    [
      [1920, 1080, 100, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1920, 960, 90, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1920, 1920, 50, null, null],
      [960, 960, 100, null, null],
      [3840, 1920, 50, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [872, 480, 222, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [854, 480, 225, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1024, 1024, 94, null, null],
      [1280, 720, 150, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1080, 1080, 88.9, null, null],
      [720, 1280, 75, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1080, 1920, 50, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [1280, 700, 150, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [480, 854, 115, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [2160, 2160, 45, null, null],
      [2358, 2358, 40.7, null, null],
      [4209, 1645, 41.1, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [3970, 1273, 43.5, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [3696, 790, 46.8, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [2452, 683, 70.4, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
      [4096, 1379, 42.2, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y],
    [2007, 562, 86.1, XML_DEFAULT_CENTER.x, XML_DEFAULT_CENTER.y]
  ].map(([w, h, scale, cx, cy]) => [
      `${w}x${h}`,
      {
        scale,
        center: cx == null || cy == null ? null : { x: cx, y: cy }
      }
    ])
  );
  const XML_WIDTH_SCALE_OVERRIDES = new Map([
    [4096, 42.2],
    [2452, 70.4]
  ]);
  const XML_VIDEO_EXTENSIONS = new Set([
    ".mp4",
    ".mov",
    ".m4v",
    ".mkv",
    ".webm",
    ".avi",
    ".mts",
    ".m2ts",
    ".ts"
  ]);
  const XML_IMAGE_EXTENSIONS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".heic",
    ".avif"
  ]);
  const XML_AUDIO_EXTENSIONS = new Set([
    ".mp3",
    ".wav",
    ".aac",
    ".m4a",
    ".flac",
    ".ogg",
    ".opus",
    ".aiff"
  ]);
  const XML_DIMENSIONS_CACHE = new Map();
  const XML_MEDIA_INFO_CACHE = new Map();
  let XML_FFPROBE_CANDIDATES = null;

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function secondsToFrames(seconds, fps) {
  const duration = Number(seconds);
  const rate = Number(fps);
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  if (!Number.isFinite(rate) || rate <= 0) return Math.max(1, Math.round(duration * 50));
  return Math.max(1, Math.round(duration * rate));
}

function secondsToFramesAllowZero(seconds, fps) {
  const duration = Number(seconds);
  const rate = Number(fps);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return Math.max(0, Math.round(duration * 50));
  return Math.max(0, Math.round(duration * rate));
}

function parseXmlStartTimecodeToSeconds(value, fps) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  const normalizedRaw = raw.replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(normalizedRaw)) {
    const numeric = Number(normalizedRaw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  const parts = raw.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 4) return 0;
  if (parts.some((part) => !/^\d+(?:[.,]\d+)?$/.test(part))) return 0;
  const nums = parts.map((part) => Number(part.replace(",", ".")));
  if (nums.some((num) => !Number.isFinite(num) || num < 0)) return 0;

  const rate = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : XML_EXPORT_FPS;
  if (parts.length === 2) {
    const [mm, ss] = nums;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = nums;
    return hh * 3600 + mm * 60 + ss;
  }
  const [hh, mm, ss, ff] = nums;
  return hh * 3600 + mm * 60 + ss + ff / rate;
}

function detectXmlMediaCategory(filePath) {
  const ext = String(path.extname(filePath ?? "")).toLowerCase();
  if (XML_AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (XML_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (XML_VIDEO_EXTENSIONS.has(ext)) return "video";
  return "video";
}

function normalizeXmlDurationSeconds(rawValue, fallbackValue, category) {
  const parsed = Number(rawValue);
  const fallback = Number.isFinite(Number(fallbackValue)) ? Math.max(0.2, Number(fallbackValue)) : 5;
  let duration = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  if (category === "image") {
    duration = Math.max(5, duration);
  }
  return duration;
}

function getXmlFfprobeCandidates() {
  if (Array.isArray(XML_FFPROBE_CANDIDATES)) return XML_FFPROBE_CANDIDATES;
  const list = [];
  const push = (value) => {
    const item = String(value ?? "").trim();
    if (!item) return;
    if (!list.includes(item)) list.push(item);
  };

  push(process.env.MEDIA_FFPROBE_PATH);

  const ffmpegLocation = String(downloaderTools?.ffmpegLocation ?? "").trim();
  if (ffmpegLocation) {
    const base = path.basename(ffmpegLocation).toLowerCase();
    if (base.startsWith("ffprobe")) {
      push(ffmpegLocation);
    } else {
      push(path.join(ffmpegLocation, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"));
    }
  }

  push(process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  XML_FFPROBE_CANDIDATES = list;
  return list;
}

async function probeXmlMediaInfo(filePath) {
  const absolute = path.resolve(String(filePath ?? ""));
  if (!absolute) return null;
  const cacheKey = absolute.toLowerCase();
  if (XML_MEDIA_INFO_CACHE.has(cacheKey)) return XML_MEDIA_INFO_CACHE.get(cacheKey);

  const args = [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height",
    "-of",
    "json",
    absolute
  ];

  for (const executable of getXmlFfprobeCandidates()) {
    try {
      const { stdout } = await execFileAsync(executable, args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const payload = JSON.parse(String(stdout ?? "{}"));
      const streams = Array.isArray(payload?.streams) ? payload.streams : [];
      let hasVideo = false;
      let hasAudio = false;
      let width = null;
      let height = null;

      for (const stream of streams) {
        const codecType = String(stream?.codec_type ?? "").toLowerCase();
        if (codecType === "video") {
          hasVideo = true;
          if (width == null || height == null) {
            const w = Number(stream?.width);
            const h = Number(stream?.height);
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
              width = Math.round(w);
              height = Math.round(h);
            }
          }
        } else if (codecType === "audio") {
          hasAudio = true;
        }
      }

      const result = {
        hasVideo,
        hasAudio,
        sourceDimensions:
          Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
            ? { width, height }
            : null
      };
      XML_MEDIA_INFO_CACHE.set(cacheKey, result);
      XML_DIMENSIONS_CACHE.set(cacheKey, result.sourceDimensions ?? null);
      return result;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      break;
    }
  }

  XML_MEDIA_INFO_CACHE.set(cacheKey, null);
  if (!XML_DIMENSIONS_CACHE.has(cacheKey)) {
    XML_DIMENSIONS_CACHE.set(cacheKey, null);
  }
  return null;
}

async function getXmlMediaInfo(filePath, hintedCategory) {
  const absolute = path.resolve(String(filePath ?? ""));
  if (!absolute) {
    return {
      category: hintedCategory,
      hasAudio: hintedCategory === "audio",
      hasVideo: hintedCategory !== "audio",
      sourceDimensions: null
    };
  }

  if (hintedCategory === "image") {
    const info = await probeXmlMediaInfo(absolute);
    return {
      category: "image",
      hasAudio: false,
      hasVideo: true,
      sourceDimensions: info?.sourceDimensions ?? null
    };
  }

  const info = await probeXmlMediaInfo(absolute);
  if (!info) {
    return {
      category: hintedCategory,
      hasAudio: hintedCategory === "audio",
      hasVideo: hintedCategory !== "audio",
      sourceDimensions: XML_DIMENSIONS_CACHE.get(absolute.toLowerCase()) ?? null
    };
  }

  if (info.hasVideo && info.hasAudio) {
    return {
      category: hintedCategory === "image" ? "image" : "video",
      hasAudio: true,
      hasVideo: true,
      sourceDimensions: info.sourceDimensions ?? null
    };
  }
  if (info.hasVideo && !info.hasAudio) {
    return {
      category: hintedCategory === "image" ? "image" : "video",
      hasAudio: false,
      hasVideo: true,
      sourceDimensions: info.sourceDimensions ?? null
    };
  }
  if (!info.hasVideo && info.hasAudio) {
    return {
      category: "audio",
      hasAudio: true,
      hasVideo: false,
      sourceDimensions: null
    };
  }
  return {
    category: hintedCategory,
    hasAudio: hintedCategory === "audio",
    hasVideo: hintedCategory !== "audio",
    sourceDimensions: info.sourceDimensions ?? null
  };
}

function toSafeXmlFileNamePart(value, fallback = "export") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const clipped = normalized.slice(0, 64);
  return clipped || fallback;
}

function transliterateRuForFileName(value) {
  const table = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };
  return String(value ?? "")
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      if (!(lower in table)) return char;
      const translit = table[lower];
      return char === lower ? translit : translit.charAt(0).toUpperCase() + translit.slice(1);
    })
    .join("");
}

function sanitizeRawExportFileNamePart(value, fallback = "export") {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function formatXmlExportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function buildXmlExportFileName({ documentId, sectionId, sectionTitle }) {
  const timestamp = formatXmlExportTimestamp();
  const rawSection = String(sectionTitle || sectionId || "").trim();
  if (rawSection) {
    const sectionBase = sanitizeRawExportFileNamePart(rawSection, "Тема");
    return `${sectionBase} - ${timestamp}.xml`;
  }
  return `UT - ${timestamp}.xml`;
}

function buildXmlSequenceName({ document, sectionId, sectionTitle }) {
  const docName = String(document?.id ?? "document").trim() || "document";
  const sectionName = String(sectionTitle ?? "").trim() || String(sectionId ?? "").trim();
  return sectionName ? `${docName} - ${sectionName}` : docName;
}

function getXmlSectionMarkerName(segment) {
  const title = String(segment?.section_title ?? "").trim();
  if (title) return title;
  const sectionId = String(segment?.section_id ?? "").trim();
  if (sectionId) return sectionId;
  return "Без темы";
}

function getXmlSectionMarkerKey(segment) {
  const titleKey = normalizeSectionTitleForMatch(segment?.section_title ?? "");
  if (titleKey) return `title:${titleKey}`;
  const sectionId = String(segment?.section_id ?? "").trim().toLowerCase();
  if (sectionId) return `id:${sectionId}`;
  return "section:unknown";
}

function buildContentDisposition(fileName) {
  const raw = String(fileName ?? "").trim();
  const extRaw = path.extname(raw).toLowerCase();
  const ext = [".xml", ".md", ".jsonl"].includes(extRaw) ? extRaw : ".xml";
  const baseRaw = extRaw ? raw.slice(0, -extRaw.length) : raw;
  const utfBase = sanitizeRawExportFileNamePart(baseRaw, "export");
  const utfName = `${utfBase}${ext}`;
  const fallbackBase = toSafeXmlFileNamePart(transliterateRuForFileName(utfBase), "export");
  const fallbackName = `${fallbackBase}${ext}`;
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(utfName)}`;
}

function formatXmlNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  if (Math.abs(numeric - Math.round(numeric)) < 0.0001) return String(Math.round(numeric));
  return numeric.toFixed(4).replace(/\.?0+$/, "");
}

function pickXmlMotionTemplate(sourceDimensions) {
  if (!sourceDimensions) return XML_DEFAULT_MOTION_TEMPLATE;
  return XML_BASIC_MOTION_TEMPLATES.get(`${sourceDimensions.width}x${sourceDimensions.height}`) ?? XML_DEFAULT_MOTION_TEMPLATE;
}

function resolveXmlMotionScale(sourceDimensions) {
  if (sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.width === sourceDimensions.height) {
    const squareScale = (960 / sourceDimensions.width) * 100;
    const normalized = Number.isFinite(squareScale) ? Number(squareScale.toFixed(1)) : 100;
    return Math.max(5, Math.min(400, normalized));
  }

  if (sourceDimensions && sourceDimensions.width === 3840) {
    return 45;
  }

  const template = pickXmlMotionTemplate(sourceDimensions);
  let scale = Number(template.scale ?? XML_DEFAULT_MOTION_TEMPLATE.scale);
  if (
    sourceDimensions &&
    !XML_BASIC_MOTION_TEMPLATES.has(`${sourceDimensions.width}x${sourceDimensions.height}`) &&
    sourceDimensions.width === 1920 &&
    sourceDimensions.height !== 1080
  ) {
    scale = 90;
  } else if (
    sourceDimensions &&
    !XML_BASIC_MOTION_TEMPLATES.has(`${sourceDimensions.width}x${sourceDimensions.height}`) &&
    XML_WIDTH_SCALE_OVERRIDES.has(sourceDimensions.width)
  ) {
    scale = Number(XML_WIDTH_SCALE_OVERRIDES.get(sourceDimensions.width));
  }
  return Number.isFinite(scale) && scale > 0 ? scale : 100;
}

function resolveXmlMotionCenterPx({ category, sourceDimensions, scale }) {
  if (sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.width === sourceDimensions.height) {
    const centerNorm = -scale / 200;
    const centerX = centerNorm * (XML_SEQUENCE_WIDTH / 2) + XML_SEQUENCE_WIDTH / 2;
    return { x: centerX, y: XML_DEFAULT_CENTER.y };
  }

  const template = pickXmlMotionTemplate(sourceDimensions);
  if (template?.center && Number.isFinite(template.center.x) && Number.isFinite(template.center.y)) {
    return template.center;
  }
  return XML_DEFAULT_CENTER;
}

function encodeXmlMotionCenter(centerPx) {
  const halfW = XML_SEQUENCE_WIDTH / 2;
  const halfH = XML_SEQUENCE_HEIGHT / 2;
  const x = (Number(centerPx?.x ?? XML_DEFAULT_CENTER.x) - halfW) / halfW;
  const y = (Number(centerPx?.y ?? XML_DEFAULT_CENTER.y) - halfH) / halfH;
  return { x, y };
}

function renderXmlBasicMotionFilter(clip) {
  const scale = formatXmlNumber(clip.motion.scale);
  const centerX = formatXmlNumber(clip.motion.center.x);
  const centerY = formatXmlNumber(clip.motion.center.y);

  return [
    "            <filter>",
    "              <effect>",
    "                <name>Basic Motion</name>",
    "                <effectid>basic</effectid>",
    "                <effectcategory>motion</effectcategory>",
    "                <effecttype>motion</effecttype>",
    "                <mediatype>video</mediatype>",
    "                <pproBypass>false</pproBypass>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>scale</parameterid>",
    "                  <name>Scale</name>",
    "                  <valuemin>0</valuemin>",
    "                  <valuemax>1000</valuemax>",
    `                  <value>${scale}</value>`,
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>rotation</parameterid>",
    "                  <name>Rotation</name>",
    "                  <valuemin>-8640</valuemin>",
    "                  <valuemax>8640</valuemax>",
    "                  <value>0</value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>center</parameterid>",
    "                  <name>Center</name>",
    "                  <value>",
    `                    <horiz>${centerX}</horiz>`,
    `                    <vert>${centerY}</vert>`,
    "                  </value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>centerOffset</parameterid>",
    "                  <name>Anchor Point</name>",
    "                  <value>",
    "                    <horiz>0</horiz>",
    "                    <vert>0</vert>",
    "                  </value>",
    "                </parameter>",
    '                <parameter authoringApp="PremierePro">',
    "                  <parameterid>antiflicker</parameterid>",
    "                  <name>Anti-flicker Filter</name>",
    "                  <valuemin>0.0</valuemin>",
    "                  <valuemax>1.0</valuemax>",
    "                  <value>0</value>",
    "                </parameter>",
    "              </effect>",
    "            </filter>"
  ];
}

function renderXmlLinkBlock({ targetClipId, mediaType, trackIndex, clipIndex, groupIndex = null }) {
  const lines = [
    "            <link>",
    `              <linkclipref>${escapeXml(targetClipId)}</linkclipref>`,
    `              <mediatype>${mediaType}</mediatype>`,
    `              <trackindex>${trackIndex}</trackindex>`,
    `              <clipindex>${clipIndex}</clipindex>`
  ];
  if (groupIndex != null) {
    lines.push(`              <groupindex>${groupIndex}</groupindex>`);
  }
  lines.push("            </link>");
  return lines;
}

function renderXmlFileElement({ clip, fps, includeVideo, includeAudio }) {
  const sourceWidth = Number(clip?.sourceDimensions?.width);
  const sourceHeight = Number(clip?.sourceDimensions?.height);
  const fileDurationFrames = Math.max(
    Number(clip?.durationFrames) || 0,
    Number(clip?.sourceOutFrame) || 0,
    1
  );
  const lines = [
    `            <file id="${escapeXml(clip.entry.fileId)}">`,
    `              <name>${escapeXml(clip.fileName)}</name>`,
    `              <pathurl>${escapeXml(clip.pathUrl)}</pathurl>`,
    "              <rate>",
    `                <timebase>${fps}</timebase>`,
    "                <ntsc>FALSE</ntsc>",
    "              </rate>",
    `              <duration>${fileDurationFrames}</duration>`,
    "              <timecode>",
    "                <rate>",
    `                  <timebase>${fps}</timebase>`,
    "                  <ntsc>FALSE</ntsc>",
    "                </rate>",
    "                <string>00:00:00:00</string>",
    "                <frame>0</frame>",
    "                <displayformat>NDF</displayformat>",
    "              </timecode>",
    "              <media>"
  ];

  if (includeVideo) {
    lines.push(
      "                <video>",
      "                  <samplecharacteristics>",
      "                    <rate>",
      `                      <timebase>${fps}</timebase>`,
      "                      <ntsc>FALSE</ntsc>",
      "                    </rate>",
      `                    <width>${Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : XML_SEQUENCE_WIDTH}</width>`,
      `                    <height>${Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : XML_SEQUENCE_HEIGHT}</height>`,
      "                    <anamorphic>FALSE</anamorphic>",
      "                    <pixelaspectratio>square</pixelaspectratio>",
      "                    <fielddominance>none</fielddominance>",
      "                  </samplecharacteristics>",
      "                </video>"
    );
  }

  if (includeAudio) {
    lines.push(
      "                <audio>",
      "                  <samplecharacteristics>",
      "                    <depth>16</depth>",
      "                    <samplerate>48000</samplerate>",
      "                  </samplecharacteristics>",
      "                  <channelcount>2</channelcount>",
      "                </audio>"
    );
  }

  lines.push("              </media>", "            </file>");
  return lines;
}

function renderXmlVideoClipItem({ clip, fps, audioPeer }) {
  const sourceInFrame = Math.max(0, Math.round(Number(clip?.sourceInFrame) || 0));
  const sourceOutFrame = Math.max(sourceInFrame, Math.round(Number(clip?.sourceOutFrame) || 0));
  const lines = [
    `          <clipitem id="${escapeXml(clip.clipId)}">`,
    `            <masterclipid>${escapeXml(clip.entry.masterClipId)}</masterclipid>`,
    `            <name>${escapeXml(clip.fileName)}</name>`,
    "            <enabled>TRUE</enabled>",
    `            <duration>${clip.durationFrames}</duration>`,
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <start>${clip.startFrame}</start>`,
    `            <end>${clip.endFrame}</end>`,
    `            <in>${sourceInFrame}</in>`,
    `            <out>${sourceOutFrame}</out>`,
    `            <alphatype>${clip.category === "image" ? "straight" : "none"}</alphatype>`,
    "            <pixelaspectratio>square</pixelaspectratio>",
    "            <anamorphic>FALSE</anamorphic>"
  ];

  lines.push(
    ...renderXmlFileElement({
      clip,
      fps,
      includeVideo: true,
      includeAudio: Boolean(clip.hasAudio)
    })
  );

  lines.push(...renderXmlBasicMotionFilter(clip));
  lines.push(...renderXmlLinkBlock({
    targetClipId: clip.clipId,
    mediaType: "video",
    trackIndex: 1,
    clipIndex: clip.clipIndex
  }));

  if (audioPeer) {
    lines.push(...renderXmlLinkBlock({
      targetClipId: audioPeer.clipId,
      mediaType: "audio",
      trackIndex: 1,
      clipIndex: audioPeer.clipIndex,
      groupIndex: 1
    }));
  }

  lines.push("          </clipitem>");
  return lines;
}

function renderXmlAudioClipItem({ clip, fps, videoPeer }) {
  const sourceInFrame = Math.max(0, Math.round(Number(clip?.sourceInFrame) || 0));
  const sourceOutFrame = Math.max(sourceInFrame, Math.round(Number(clip?.sourceOutFrame) || 0));
  const lines = [
    `          <clipitem id="${escapeXml(clip.clipId)}" premiereChannelType="stereo">`,
    `            <masterclipid>${escapeXml(clip.entry.masterClipId)}</masterclipid>`,
    `            <name>${escapeXml(clip.fileName)}</name>`,
    "            <enabled>TRUE</enabled>",
    `            <duration>${clip.durationFrames}</duration>`,
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <start>${clip.startFrame}</start>`,
    `            <end>${clip.endFrame}</end>`,
    `            <in>${sourceInFrame}</in>`,
    `            <out>${sourceOutFrame}</out>`
  ];

  if (videoPeer) {
    lines.push(`            <file id="${escapeXml(clip.entry.fileId)}"/>`);
  } else {
    lines.push(
      ...renderXmlFileElement({
        clip,
        fps,
        includeVideo: false,
        includeAudio: true
      })
    );
  }

  lines.push(
    "            <sourcetrack>",
    "              <mediatype>audio</mediatype>",
    "              <trackindex>1</trackindex>",
    "            </sourcetrack>",
    ...renderXmlLinkBlock({
      targetClipId: clip.clipId,
      mediaType: "audio",
      trackIndex: 1,
      clipIndex: clip.clipIndex
    })
  );

  if (videoPeer) {
    lines.push(...renderXmlLinkBlock({
      targetClipId: videoPeer.clipId,
      mediaType: "video",
      trackIndex: 1,
      clipIndex: videoPeer.clipIndex,
      groupIndex: 1
    }));
  }

  lines.push("          </clipitem>");
  return lines;
}

function renderXmlSequenceMarker({ name, inFrame, outFrame }) {
  const markerIn = Math.max(0, Math.round(Number(inFrame) || 0));
  const markerOut = Math.max(markerIn, Math.round(Number(outFrame) || markerIn));
  return [
    "    <marker>",
    "      <comment></comment>",
    `      <name>${escapeXml(name || "Тема")}</name>`,
    `      <in>${markerIn}</in>`,
    `      <out>${markerOut}</out>`,
    `      <pproColor>${XML_SECTION_MARKER_COLOR}</pproColor>`,
    "    </marker>"
  ];
}

function buildXmemlTimeline({ sequenceName, fps, totalFrames, videoClips, audioClips, sectionMarkers = [] }) {
  const audioByEntryId = new Map(audioClips.map((clip) => [clip.entry.entryId, clip]));
  const videoByEntryId = new Map(videoClips.map((clip) => [clip.entry.entryId, clip]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    "    <uuid>00000000-0000-0000-0000-000000000000</uuid>",
    `    <name>${escapeXml(sequenceName)}</name>`,
    `    <duration>${Math.max(1, totalFrames)}</duration>`,
    "    <rate>",
    `      <timebase>${fps}</timebase>`,
    "      <ntsc>FALSE</ntsc>",
    "    </rate>",
    "    <media>",
    "      <video>",
    "        <format>",
    "          <samplecharacteristics>",
    "            <rate>",
    `              <timebase>${fps}</timebase>`,
    "              <ntsc>FALSE</ntsc>",
    "            </rate>",
    `            <width>${XML_SEQUENCE_WIDTH}</width>`,
    `            <height>${XML_SEQUENCE_HEIGHT}</height>`,
    "            <anamorphic>FALSE</anamorphic>",
    "            <pixelaspectratio>square</pixelaspectratio>",
    "            <fielddominance>none</fielddominance>",
    "            <colordepth>24</colordepth>",
    "          </samplecharacteristics>",
    "        </format>",
    "        <track>",
    "          <enabled>TRUE</enabled>",
    "          <locked>FALSE</locked>"
  ];

  videoClips.forEach((clip) => {
    lines.push(...renderXmlVideoClipItem({
      clip,
      fps,
      audioPeer: audioByEntryId.get(clip.entry.entryId) ?? null
    }));
  });

  lines.push(
    "        </track>",
    "      </video>",
    "      <audio>",
    "        <numOutputChannels>2</numOutputChannels>",
    "        <format>",
    "          <samplecharacteristics>",
    "            <depth>16</depth>",
    "            <samplerate>48000</samplerate>",
    "          </samplecharacteristics>",
    "        </format>",
    "        <outputs>",
    "          <group>",
    "            <index>1</index>",
    "            <numchannels>1</numchannels>",
    "            <downmix>0</downmix>",
    "            <channel>",
    "              <index>1</index>",
    "            </channel>",
    "          </group>",
    "          <group>",
    "            <index>2</index>",
    "            <numchannels>1</numchannels>",
    "            <downmix>0</downmix>",
    "            <channel>",
    "              <index>2</index>",
    "            </channel>",
    "          </group>",
    "        </outputs>",
    "        <track>",
    "          <enabled>TRUE</enabled>",
    "          <locked>FALSE</locked>",
    "          <outputchannelindex>1</outputchannelindex>"
  );

  audioClips.forEach((clip) => {
    lines.push(...renderXmlAudioClipItem({
      clip,
      fps,
      videoPeer: videoByEntryId.get(clip.entry.entryId) ?? null
    }));
  });

  lines.push(
    "        </track>",
    "      </audio>",
    "    </media>",
  );

  sectionMarkers.forEach((marker) => {
    lines.push(...renderXmlSequenceMarker(marker));
  });

  lines.push(
    "    <timecode>",
    "      <rate>",
    `        <timebase>${fps}</timebase>`,
    "        <ntsc>FALSE</ntsc>",
    "      </rate>",
    "      <string>00:00:00:00</string>",
    "      <frame>0</frame>",
    "      <displayformat>NDF</displayformat>",
    "    </timecode>",
    "  </sequence>",
    "</xmeml>",
    ""
  );

  return lines.join("\n");
}

async function buildXmlExportPayload({
  document,
  segments,
  decisionsBySegment,
  mediaDir,
  fps,
  defaultDurationSec,
  sectionId,
  sectionTitle
}) {
  const fpsValue = Number.isFinite(Number(fps)) ? Math.max(1, Math.round(Number(fps))) : XML_EXPORT_FPS;
  const fallbackDuration = Number.isFinite(Number(defaultDurationSec))
    ? Math.max(0.2, Number(defaultDurationSec))
    : XML_EXPORT_DEFAULT_DURATION_SEC;
  const mediaRoot = path.resolve(String(mediaDir ?? getMediaDir()));
  const exportFileName = buildXmlExportFileName({
    documentId: document?.id ?? "document",
    sectionId,
    sectionTitle
  });

  const markerDurationFrames = secondsToFrames(XML_SECTION_MARKER_DURATION_SEC, fpsValue);
  const sectionGapFrames = XML_SECTION_GAP_SEC > 0 ? secondsToFrames(XML_SECTION_GAP_SEC, fpsValue) : 0;
  const sectionMarkers = [];
  const mediaEntries = [];
  let frameCursor = 0;
  let activeSectionKey = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentId = String(segment?.segment_id ?? "").trim();

    const sectionKey = getXmlSectionMarkerKey(segment);
    if (sectionKey !== activeSectionKey) {
      if (activeSectionKey && sectionGapFrames > 0) {
        frameCursor += sectionGapFrames;
      }
      sectionMarkers.push({
        name: getXmlSectionMarkerName(segment),
        inFrame: frameCursor,
        outFrame: frameCursor + markerDurationFrames
      });
      activeSectionKey = sectionKey;
    }

    const decision = segmentId ? decisionsBySegment.get(segmentId) ?? {} : {};
    const visual = normalizeVisualDecisionInput(decision.visual ?? decision.visual_decision ?? null);
    const mediaPath = normalizeMediaFilePath(visual.media_file_path ?? null);
    let absolutePath = "";
    if (mediaPath) {
      absolutePath = safeResolveMediaPath(mediaRoot, mediaPath);
      if (absolutePath) {
        const stats = await fs.stat(absolutePath).catch(() => null);
        if (!stats || !stats.isFile()) {
          absolutePath = "";
        }
      }
    }

    if (!absolutePath) {
      const gapDurationSec = normalizeXmlDurationSeconds(visual.duration_hint_sec, fallbackDuration, "video");
      const gapFrames = secondsToFrames(gapDurationSec, fpsValue);
      frameCursor += gapFrames;
      continue;
    }

    const hintedCategory = detectXmlMediaCategory(absolutePath);
    const mediaInfo = await getXmlMediaInfo(absolutePath, hintedCategory);
    const category = mediaInfo.category;
    const durationSec = normalizeXmlDurationSeconds(visual.duration_hint_sec, fallbackDuration, category);
    const durationFrames = secondsToFrames(durationSec, fpsValue);
    const sourceStartSec = category === "video"
      ? parseXmlStartTimecodeToSeconds(visual.media_start_timecode, fpsValue)
      : 0;
    const sourceInFrame = secondsToFramesAllowZero(sourceStartSec, fpsValue);
    const sourceOutFrame = sourceInFrame + durationFrames;
    const sourceDimensions = mediaInfo.sourceDimensions;
    const motionScale = resolveXmlMotionScale(sourceDimensions);
    const motionCenterPx = resolveXmlMotionCenterPx({
      category,
      sourceDimensions,
      scale: motionScale
    });
    const motionCenter = encodeXmlMotionCenter(motionCenterPx);
    const mediaIndex = mediaEntries.length + 1;
    const startFrame = frameCursor;
    const endFrame = startFrame + durationFrames;
    frameCursor = endFrame;

    mediaEntries.push({
      entryId: `entry-${mediaIndex}`,
      segmentId: segmentId || `segment_${index + 1}`,
      segmentQuote: String(segment?.text_quote ?? ""),
      fileId: `file-${mediaIndex}`,
      masterClipId: `masterclip-${mediaIndex}`,
      fileName: path.basename(absolutePath),
      pathUrl: pathToFileURL(absolutePath).href,
      durationFrames,
      sourceInFrame,
      sourceOutFrame,
      startFrame,
      endFrame,
      category,
      hasAudio: Boolean(mediaInfo.hasAudio),
      hasVideo: Boolean(mediaInfo.hasVideo),
      sourceDimensions,
      motion: {
        scale: motionScale,
        center: motionCenter
      }
    });
  }

  if (!mediaEntries.length) {
    return {
      clipCount: 0,
      fileName: exportFileName,
      xml: ""
    };
  }

  const videoClips = [];
  const audioClips = [];
  let videoClipIndex = 1;
  let audioClipIndex = 1;
  mediaEntries.forEach((entry) => {
    if (entry.hasVideo) {
      videoClips.push({
        ...entry,
        entry,
        startFrame: entry.startFrame,
        endFrame: entry.endFrame,
        clipId: `vclipitem-${videoClipIndex}`,
        clipIndex: videoClipIndex
      });
      videoClipIndex += 1;
    }

    if (entry.hasAudio) {
      audioClips.push({
        ...entry,
        entry,
        startFrame: entry.startFrame,
        endFrame: entry.endFrame,
        clipId: `aclipitem-${audioClipIndex}`,
        clipIndex: audioClipIndex
      });
      audioClipIndex += 1;
    }
  });

  const xml = buildXmemlTimeline({
    sequenceName: buildXmlSequenceName({ document, sectionId, sectionTitle }),
    fps: fpsValue,
    totalFrames: frameCursor,
    videoClips,
    audioClips,
    sectionMarkers
  });

  return {
    clipCount: mediaEntries.length,
    fileName: exportFileName,
    xml
  };
}



  return {
    XML_EXPORT_DEFAULT_DURATION_SEC,
    XML_EXPORT_FPS,
    buildContentDisposition,
    buildXmlExportPayload
  };
}
