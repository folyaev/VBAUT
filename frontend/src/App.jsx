import React, { useEffect, useState } from "react";
import { AppHeroHeader } from "./components/AppHeroHeader.jsx";
import { AppNewsOpsSection } from "./components/AppNewsOpsSection.jsx";
import { LazySectionFallback } from "./components/LazySectionFallback.jsx";
import { SegmentLinkedReleasePanel } from "./components/SegmentLinkedReleasePanel.jsx";
import { SegmentResearchBrief } from "./components/SegmentResearchBrief.jsx";
import { SegmentResearchHeader } from "./components/SegmentResearchHeader.jsx";
import { SegmentResearchResultsPanel } from "./components/SegmentResearchResultsPanel.jsx";
import { SegmentSearchQueriesPanel } from "./components/SegmentSearchQueriesPanel.jsx";
import { SegmentResearchToolbar } from "./components/SegmentResearchToolbar.jsx";
import { SegmentVisualEditor } from "./components/SegmentVisualEditor.jsx";
import { ScenarioBlocksHeader } from "./components/ScenarioBlocksHeader.jsx";
import { ScenarioGroupSection } from "./components/ScenarioGroupSection.jsx";
import { ScenarioLinksPanel } from "./components/ScenarioLinksPanel.jsx";
import {
  buildResearchCategoryBuckets,
  RESEARCH_CATEGORY_ORDER,
  RESEARCH_CATEGORY_LABELS
} from "./utils/researchCategories.js";
import {
  collectResearchMemoryBadges,
  formatResearchCandidateRoleLabel,
  formatResearchReasonTagLabel,
  getVisibleResearchReasonTags,
  hasSearchDecisionContent,
  hasVisualDecisionContent,
  inferResearchCandidateRole
} from "./utils/researchUi.js";
import {
  normalizeResearchBundleTrace,
  normalizeResearchDismissedUrls,
  normalizeResearchSources,
  normalizeSegmentResearchContextSettings,
  normalizeSegmentTagList
} from "./utils/segmentResearchState.js";
import {
  buildMediaFileUrl,
  emptySearchDecision,
  emptyVisualDecision,
  FORMAT_HINT_LABELS,
  formatFramesAsTimecode,
  isVideoMediaPath,
  normalizeMediaFilePath,
  normalizeMediaFilePathList,
  normalizeMediaFileTimecodes,
  normalizeMediaStartTimecode,
  normalizePriority,
  normalizeQueryList,
  normalizeSearchDecision,
  normalizeVisualDecision,
  partsToTimecode,
  parseTimecodeToFrames,
  PRIORITY_LABELS,
  splitTimecodeToParts,
  TIMECODE_EDIT_FPS,
  VISUAL_TYPE_DEFAULTS,
  VISUAL_TYPE_LABELS
} from "./utils/visualDecision.js";
import { useCollaborativeSession } from "./hooks/useCollaborativeSession.js";
import { useReleaseAssistantActions } from "./hooks/useReleaseAssistantActions.js";
import { useMediaManager } from "./hooks/useMediaManager.js";
import { useReleaseBoardState } from "./hooks/useReleaseBoardState.js";
import { useReleaseMutations } from "./hooks/useReleaseMutations.js";
import { useReleaseWorkspaceData } from "./hooks/useReleaseWorkspaceData.js";
import { useScenarioGroups } from "./hooks/useScenarioGroups.js";
import { useUiAuditQueue } from "./hooks/useUiAuditQueue.js";
const NewsroomWorkspace = React.lazy(() =>
  import("./components/NewsroomWorkspace.jsx").then((module) => ({ default: module.NewsroomWorkspace }))
);
const ReleaseOnAirMode = React.lazy(() =>
  import("./components/ReleaseOnAirMode.jsx").then((module) => ({ default: module.ReleaseOnAirMode }))
);
const ReleaseProducerMode = React.lazy(() =>
  import("./components/ReleaseProducerMode.jsx").then((module) => ({ default: module.ReleaseProducerMode }))
);
const ScenarioEditorPanel = React.lazy(() =>
  import("./components/ScenarioEditorPanel.jsx").then((module) => ({ default: module.ScenarioEditorPanel }))
);
const MediaHistoryPanel = React.lazy(() =>
  import("./components/MediaHistoryPanel.jsx").then((module) => ({ default: module.MediaHistoryPanel }))
);
const ResearchWorkspace = React.lazy(() =>
  import("./components/ResearchWorkspace.jsx").then((module) => ({ default: module.ResearchWorkspace }))
);
const defaultConfig = {
  blockTypes: ["news", "ad", "selfad", "intro", "outro"],
  visualTypes: [
    "video",
    "portrait",
    "image",
    "infographic",
    "map",
    "interface",
    "generation_collage",
    "graphic_element",
    "no_visual"
  ],
  formatHints: ["2:1", "1:1", "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a/\u0426\u0438\u0442\u0430\u0442\u0430", "\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442"],
  priorities: ["Обязательно", "Рекомендуется", "При наличии"],
  searchLimits: { maxKeywords: 8, maxQueries: 3 },
  searchEngines: [
    { id: "youtube", label: "YouTube", url: "https://www.youtube.com/results?search_query=" },
    {
      id: "youtube_7d_hd",
      label: "YouTube 7 days HD",
      url: "https://www.youtube.com/results?search_query=",
      suffix: "&sp=EgYIAxABIAE%253D"
    },
    {
      id: "yandex_hq",
      label: "\u042f\u043d\u0434\u0435\u043a\u0441 HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&isize=large"
    },
    {
      id: "yandex_hq_square",
      label: "1:1 \u042f\u043d\u0434\u0435\u043a\u0441 HQ",
      url: "https://yandex.ru/images/search?text=",
      suffix: "&iorient=square&isize=large"
    },
    {
      id: "google_hq",
      label: "Google HQ",
      url: "https://www.google.com/search?q=",
      suffix: "&tbm=isch&tbs=isz:l"
    },
    { id: "vk_video", label: "VK \u0412\u0438\u0434\u0435\u043e", url: "https://vk.com/search/video?q=" },
    { id: "vk", label: "VK \u041f\u043e\u0441\u0442", url: "https://vk.com/search?q=" },
    {
      id: "x_live",
      label: "X",
      url: "https://x.com/search?q=",
      suffix: "&src=typed_query&f=live"
    },
    { id: "dzen_news", label: "\u0414\u0437\u0435\u043d.\u041d\u043e\u0432\u043e\u0441\u0442\u0438", url: "https://dzen.ru/news/search?query=" },
    { id: "reddit", label: "Reddit", url: "https://www.reddit.com/search/?q=" },
    { id: "perplexity", label: "Copy and Perplexity", url: "https://www.perplexity.ai/", action: "copy_open" }
  ]
};
const NEW_SCENARIO_TEMPLATE = `# UT

Оформление видео

### Интро
Привет! Я Руслан Усачев и сегодня мы поговорим о самых интересных новостях и событиях в России и мире за последнее время.

### Комплимент
Это все новости на сегодня.`;
const HEADING_SEARCH_RU_ENGINE_IDS = new Set(["vk", "vk_video", "perplexity"]);
const HEADING_EN_SEARCH_ENGINES = [
  { id: "yt_reuters", label: "@Reuters", url: "https://www.youtube.com/@Reuters/search?query=" },
  { id: "yt_afp", label: "@AFP", url: "https://www.youtube.com/@AFP/search?query=" },
  { id: "yt_nypost", label: "@nypost", url: "https://www.youtube.com/@nypost/search?query=" },
  { id: "yt_gbcnewsroom", label: "@GBCNewsroom", url: "https://www.youtube.com/@GBCNewsroom/search?query=" },
  { id: "yt_kolezev", label: "@Kolezev", url: "https://www.youtube.com/@Kolezev/search?query=" },
  { id: "yt_wfaa8", label: "@Wfaa8", url: "https://www.youtube.com/@Wfaa8/search?query=" },
  { id: "yt_wthr13news", label: "@WTHR13News", url: "https://www.youtube.com/@WTHR13News/search?query=" },
  { id: "yt_waaytv", label: "@WAAYTV", url: "https://www.youtube.com/@WAAYTV/search?query=" },
  { id: "yt_newsthink", label: "@Newsthink", url: "https://www.youtube.com/@Newsthink/search?query=" },
  { id: "yt_redactsiya", label: "@redactsiya", url: "https://www.youtube.com/@redactsiya/search?query=" },
  { id: "yt_theindependent", label: "@theindependent", url: "https://www.youtube.com/@theindependent/search?query=" },
  { id: "yt_diplomatrutube", label: "@Diplomatrutube", url: "https://www.youtube.com/@Diplomatrutube/search?query=" },
  { id: "yt_business", label: "@business", url: "https://www.youtube.com/@business/search?query=" },
  { id: "yt_fox13now", label: "@Fox13now", url: "https://www.youtube.com/@Fox13now/search?query=" },
  { id: "yt_ksdk", label: "@KSDK", url: "https://www.youtube.com/@KSDK/search?query=" },
  { id: "yt_associatedpress", label: "@AssociatedPress", url: "https://www.youtube.com/@AssociatedPress/search?query=" },
  { id: "yt_kanal13az", label: "@Kanal13AZ", url: "https://www.youtube.com/@Kanal13AZ/search?query=" },
  { id: "yt_abcnewsaustralia", label: "@abcnewsaustralia", url: "https://www.youtube.com/@abcnewsaustralia/search?query=" },
  { id: "yt_cbcthenational", label: "@CBCTheNational", url: "https://www.youtube.com/@CBCTheNational/search?query=" },
  { id: "yt_10tampabay", label: "@10TampaBay", url: "https://www.youtube.com/@10TampaBay/search?query=" },
  { id: "yt_thetimes", label: "@TheTimes", url: "https://www.youtube.com/@TheTimes/search?query=" },
  { id: "yt_aljazeeraenglish", label: "@aljazeeraenglish", url: "https://www.youtube.com/@aljazeeraenglish/search?query=" },
  { id: "yt_euronewsru", label: "@euronewsru", url: "https://www.youtube.com/@euronewsru/search?query=" },
  { id: "yt_bbcnews", label: "@BBCNews", url: "https://www.youtube.com/@BBCNews/search?query=" },
  { id: "yt_abc7news", label: "@abc7news", url: "https://www.youtube.com/@abc7news/search?query=" },
  { id: "yt_9newsaus", label: "@9NewsAUS", url: "https://www.youtube.com/@9NewsAUS/search?query=" }
];
const YTDLP_CANDIDATE_HOSTS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)dailymotion\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)vk\.com$/i,
  /(^|\.)rutube\.ru$/i,
  /(^|\.)ok\.ru$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.watch$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)streamable\.com$/i,
  /(^|\.)soundcloud\.com$/i
];

function formatDomainListForTextarea(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}

function parseDomainListFromTextarea(value = "") {
  return [...new Set(
    String(value ?? "")
      .split(/\r?\n|,|;/)
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function buildSourceProfilesDraft(profiles = {}) {
  return {
    trusted_domains: formatDomainListForTextarea(profiles?.trusted_domains),
    blocked_domains: formatDomainListForTextarea(profiles?.blocked_domains),
    video_platform_domains: formatDomainListForTextarea(profiles?.video_platform_domains),
    social_domains: formatDomainListForTextarea(profiles?.social_domains),
    downloadable_domains: formatDomainListForTextarea(profiles?.downloadable_domains),
    screenshot_friendly_domains: formatDomainListForTextarea(profiles?.screenshot_friendly_domains),
    domain_profiles_json: JSON.stringify(profiles?.domain_profiles ?? {}, null, 2),
    channel_profiles_json: JSON.stringify(profiles?.channel_profiles ?? {}, null, 2)
  };
}
const DIRECT_MEDIA_PATH_RE = /\.(mp4|m4v|mov|webm|mkv|m3u8|mp3|m4a|wav|flac)(?:$|[?#])/i;
const isVkVideoUrl = (parsedUrl) => {
  if (!parsedUrl) return false;
  const host = String(parsedUrl.hostname ?? "").toLowerCase();
  const pathWithQuery = `${parsedUrl.pathname ?? ""}${parsedUrl.search ?? ""}`.toLowerCase();
  if (host === "vk.com" || host.endsWith(".vk.com")) {
    return pathWithQuery.startsWith("/video");
  }
  if (host === "vk.ru" || host.endsWith(".vk.ru")) {
    return pathWithQuery.startsWith("/video");
  }
  if (host === "vkvideo.ru" || host.endsWith(".vkvideo.ru")) {
    return pathWithQuery.startsWith("/video") || pathWithQuery.includes("/video-") || pathWithQuery.includes("video");
  }
  return false;
};
const getInitialTheme = () => {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage?.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
};
const isNewsroomPathname = (pathname) => {
  const normalized = String(pathname ?? "")
    .trim()
    .replace(/\/+$/g, "") || "/";
  return normalized === "/newsroom";
};
const isResearchPathname = (pathname) => {
  const normalized = String(pathname ?? "")
    .trim()
    .replace(/\/+$/g, "") || "/";
  return normalized === "/research";
};
const getInitialAppMode = () => {
  if (typeof window === "undefined") return "workspace";
  const mode = String(new URLSearchParams(window.location.search).get("mode") ?? "").toLowerCase().trim();
  if (mode === "producer") return "producer";
  if (mode === "onair") return "onair";
  if (mode === "newsops") return "newsops";
  if (mode === "inbox") return "inbox";
  if (mode === "library") return "library";
  if (mode === "releases") return "releases";
  if (isResearchPathname(window.location.pathname)) return "research";
  if (isNewsroomPathname(window.location.pathname)) return "newsroom";
  return "workspace";
};
const getInitialReleaseQueryId = () => {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("release") ?? "").trim();
};
const getInitialResearchDocQueryId = () => {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("doc_id") ?? "").trim();
};
const getInitialResearchSegmentQueryId = () => {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("segment_id") ?? "").trim();
};
const getInitialResearchRunQueryId = () => {
  if (typeof window === "undefined") return "";
  return String(new URLSearchParams(window.location.search).get("run_id") ?? "").trim();
};
const syncAppLocation = (mode, releaseId, researchState = {}) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const isNewsroomMode = mode === "newsroom" || mode === "inbox" || mode === "library" || mode === "releases";
  const isResearchMode = mode === "research";
  url.pathname = isResearchMode ? "/research" : isNewsroomMode ? "/newsroom" : "/";
  if (mode === "producer" || mode === "onair" || mode === "newsops" || mode === "inbox" || mode === "library" || mode === "releases") {
    url.searchParams.set("mode", mode);
  } else {
    url.searchParams.delete("mode");
  }
  const normalizedReleaseId = String(releaseId ?? "").trim();
  if (normalizedReleaseId) {
    url.searchParams.set("release", normalizedReleaseId);
  } else {
    url.searchParams.delete("release");
  }
  const normalizedResearchDocId = String(researchState?.docId ?? "").trim();
  const normalizedResearchSegmentId = String(researchState?.segmentId ?? "").trim();
  const normalizedResearchRunId = String(researchState?.runId ?? "").trim();
  if (isResearchMode && normalizedResearchDocId) {
    url.searchParams.set("doc_id", normalizedResearchDocId);
  } else {
    url.searchParams.delete("doc_id");
  }
  if (isResearchMode && normalizedResearchSegmentId) {
    url.searchParams.set("segment_id", normalizedResearchSegmentId);
  } else {
    url.searchParams.delete("segment_id");
  }
  if (isResearchMode && normalizedResearchRunId) {
    url.searchParams.set("run_id", normalizedResearchRunId);
  } else {
    url.searchParams.delete("run_id");
  }
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history.replaceState({}, "", nextPath);
  }
};
const formatDocDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};
const formatDateTimeShort = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
};
const formatRelativeEventLabel = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
};
const formatAssetKindLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    link: "Ссылка",
    note: "Заметка",
    telegram_media: "Telegram media",
    downloaded_media: "Скачанный файл",
    screenshot: "Скриншот",
    preview: "Превью"
  };
  return labels[key] ?? (key || "Asset");
};
const formatReleaseItemStatusLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    planned: "Planned",
    selected: "Selected",
    scripting: "Scripting",
    visual_ready: "Visual Ready",
    ready: "Ready",
    done: "Done",
    skipped: "Skipped"
  };
  return labels[key] ?? (key || "planned");
};
const formatReleaseReadyStateLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    ready: "Ready",
    capture_needed: "Capture Needed",
    download_needed: "Download Needed",
    backup_only: "Backup Only",
    downloaded: "Downloaded",
    captured: "Captured"
  };
  return labels[key] ?? (key || "");
};
const formatReleasePickedFromLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    research_bundle: "Research Bundle",
    research_brief: "Research Brief",
    assistant_recommendation: "Assistant Recommendation",
    research_backup_visual: "Backup Visual",
    research_backup_source: "Backup Source",
    research_fallback_visual: "Fallback Visual",
    research_fallback_source: "Fallback Source"
  };
  return labels[key] ?? (key ? key.replace(/_/g, " ") : "");
};
const formatReleaseHandoffEventLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    handoff_download_resolved: "Download resolved",
    handoff_capture_resolved: "Capture resolved"
  };
  return labels[key] ?? (key ? key.replace(/_/g, " ") : "");
};
const formatReleasePairSwitchLabel = (event = "", meta = {}) => {
  const normalizedEvent = String(event ?? "").trim().toLowerCase();
  const action = String(meta?.action ?? "").trim().toLowerCase();
  if (normalizedEvent === "manual_override") return "Manual override";
  if (normalizedEvent === "research_pick_applied") {
    if (action === "research_pick") return "Research pair applied";
    if (action === "research_pick_source") return "Research source updated";
    if (action === "research_pick_visual") return "Research visual updated";
    return "Research pick applied";
  }
  return "";
};
const getCurrentPairBadgeClassName = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "main pair") return "segment-current-pair-badge is-main";
  if (key === "backup pair") return "segment-current-pair-badge is-backup";
  if (key === "mixed pair") return "segment-current-pair-badge is-mixed";
  if (key === "custom pair") return "segment-current-pair-badge is-custom";
  return "segment-current-pair-badge";
};
const normalizeComparablePickLabel = (value) => String(value ?? "").trim().toLowerCase();
const getSegmentResearchEntryComparableLabel = (entry = null) =>
  String(entry?.title || entry?.label || entry?.domain || entry?.url || entry?.result_id || "").trim();
const formatSegmentResearchBriefLabel = (item = null) => {
  const label = String(item?.label ?? "").trim();
  if (/pass|phase/i.test(label)) return label;
  const key = String(item?.key ?? "").trim().toLowerCase();
  const role = String(item?.role ?? "").trim().toLowerCase();
  if (key === "source" || role === "main_source") return "Main Source";
  if (key === "visual" || (role === "visual_candidate" && key !== "backup_visual")) return "Main Visual";
  if (key === "backup_source" || role === "backup_source") return "Backup Source";
  if (key === "backup_visual") return "Backup Visual";
  if (key === "download") return "Best Download";
  if (key === "context") return "Context";
  return label || "Research";
};
const deriveSegmentResearchCurrentPair = (
  promotedPair = null,
  {
    primarySource = null,
    primaryVisual = null,
    backupSource = null,
    backupVisual = null
  } = {}
) => {
  if (!promotedPair?.source && !promotedPair?.visual) return null;
  const currentSourceLabel = String(promotedPair?.source?.title || promotedPair?.source?.domain || "").trim();
  const currentVisualLabel = String(promotedPair?.visual?.title || promotedPair?.visual?.domain || "").trim();
  const primarySourceLabel = getSegmentResearchEntryComparableLabel(primarySource);
  const primaryVisualLabel = getSegmentResearchEntryComparableLabel(primaryVisual);
  const backupSourceLabel = getSegmentResearchEntryComparableLabel(backupSource);
  const backupVisualLabel = getSegmentResearchEntryComparableLabel(backupVisual);
  const sourceMatchesMain =
    Boolean(currentSourceLabel) &&
    Boolean(primarySourceLabel) &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(primarySourceLabel);
  const sourceMatchesBackup =
    Boolean(currentSourceLabel) &&
    Boolean(backupSourceLabel) &&
    normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(backupSourceLabel);
  const visualMatchesMain =
    Boolean(currentVisualLabel) &&
    Boolean(primaryVisualLabel) &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(primaryVisualLabel);
  const visualMatchesBackup =
    Boolean(currentVisualLabel) &&
    Boolean(backupVisualLabel) &&
    normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(backupVisualLabel);
  const label =
    sourceMatchesMain && visualMatchesMain
      ? "Main Pair"
      : sourceMatchesBackup && visualMatchesBackup
        ? "Backup Pair"
        : (sourceMatchesMain || sourceMatchesBackup || visualMatchesMain || visualMatchesBackup)
          ? "Mixed Pair"
          : (currentSourceLabel || currentVisualLabel)
            ? "Custom Pair"
            : "";
  if (!label) return null;
  const hint =
    label === "Main Pair"
      ? "Aligned with main picks"
      : label === "Backup Pair"
        ? "Using backup picks"
        : label === "Mixed Pair"
          ? "Mixed main + backup"
          : "Custom research mix";
  return {
    label,
    hint
  };
};
const findReleaseResearchBriefEntryByRole = (brief, roles = [], keys = []) => {
  const items = Array.isArray(brief?.brief?.items) ? brief.brief.items : [];
  if (items.length === 0) return null;
  const normalizedRoles = new Set(roles.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const normalizedKeys = new Set(keys.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  const exact = items.find((item) => {
    const role = String(item?.role ?? "").trim().toLowerCase();
    const key = String(item?.key ?? "").trim().toLowerCase();
    return (normalizedRoles.size > 0 && normalizedRoles.has(role)) || (normalizedKeys.size > 0 && normalizedKeys.has(key));
  });
  return exact ?? items[0] ?? null;
};
const findReleaseResearchBackupEntry = (brief, primaryEntry = null, kind = "source") => {
  const items = Array.isArray(brief?.brief?.items) ? brief.brief.items : [];
  if (items.length === 0) return null;
  const normalizedKind = String(kind ?? "").trim().toLowerCase();
  const primaryResultId = String(primaryEntry?.result_id ?? "").trim();
  const primaryKey = String(primaryEntry?.key ?? "").trim().toLowerCase();
  const explicit =
    normalizedKind === "visual"
      ? findReleaseResearchBriefEntryByRole(brief, ["visual_candidate"], ["backup_visual"])
      : findReleaseResearchBriefEntryByRole(brief, ["backup_source", "reference", "main_source"], ["backup_source"]);
  if (!explicit || typeof explicit !== "object") return null;
  const explicitResultId = String(explicit?.result_id ?? "").trim();
  const explicitKey = String(explicit?.key ?? "").trim().toLowerCase();
  if ((explicitResultId && explicitResultId === primaryResultId) || (explicitKey && explicitKey === primaryKey)) {
    return null;
  }
  return explicit;
};
const buildReleaseResearchContextPayload = (brief = null, { sourceEntry = null, visualEntry = null } = {}) => {
  if (!brief) return null;
  const normalize = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      key: String(entry?.key ?? "").trim(),
      label: String(entry?.label ?? "").trim(),
      title: String(entry?.title || entry?.label || "").trim(),
      domain: String(entry?.domain ?? "").trim(),
      role: String(entry?.role ?? "").trim(),
      reason: String(entry?.reason ?? "").trim(),
      score: Number(entry?.score ?? 0),
      url: String(entry?.url ?? "").trim(),
      result_id: String(entry?.result_id ?? "").trim()
    };
  };
  return {
    segment_id: String(brief?.segment_id ?? "").trim(),
    section_title: String(brief?.section_title ?? "").trim(),
    summary: String(brief?.brief?.summary ?? "").trim(),
    source_item: normalize(sourceEntry),
    visual_item: normalize(visualEntry)
  };
};
const buildReleaseResearchScriptNote = (brief = null, entry = null) => {
  const title = String(entry?.title || entry?.label || "").trim();
  const domain = String(entry?.domain || "").trim();
  const sectionTitle = String(brief?.section_title || "").trim();
  const parts = [];
  parts.push(sectionTitle ? `Lead with ${sectionTitle}` : "Lead with the selected source");
  if (title) parts.push(`source cue ${title}`);
  if (domain) parts.push(`cite ${domain}`);
  return `${parts.join(", ")}.`.trim();
};
const buildReleaseResearchVisualNote = (brief = null, entry = null) => {
  const title = String(entry?.title || entry?.label || "").trim();
  const domain = String(entry?.domain || "").trim();
  const sectionTitle = String(brief?.section_title || "").trim();
  if (title && domain) return `Use ${title} from ${domain} as the supporting visual for ${sectionTitle || "this segment"}.`;
  if (title) return `Use ${title} as the supporting visual for ${sectionTitle || "this segment"}.`;
  return `Use research-backed visual for ${sectionTitle || "this segment"}.`;
};
const buildReleaseResearchPickPatch = (brief = null, { sourceEntry = null, visualEntry = null } = {}) => {
  const patch = {
    assistant_action: "research_pick",
    research_context: buildReleaseResearchContextPayload(brief, { sourceEntry, visualEntry })
  };
  if (sourceEntry) {
    patch.script_note = buildReleaseResearchScriptNote(brief, sourceEntry);
  }
  if (visualEntry) {
    patch.visual_note = buildReleaseResearchVisualNote(brief, visualEntry);
  }
  if (sourceEntry && visualEntry) {
    patch.item_status = "visual_ready";
  }
  return patch;
};
const deriveReleaseTraceBadges = (attachment = {}) => {
  const trace = attachment?.assistant_trace_json ?? {};
  const badges = [];
  const scriptNote = String(attachment?.script_note ?? "").trim();
  const visualNote = String(attachment?.visual_note ?? "").trim();
  const tracedScriptNote = String(trace?.script?.note ?? "").trim();
  const tracedVisualNote = String(trace?.visual?.note ?? "").trim();

  if (
    String(trace?.research?.section_title ?? "").trim() ||
    String(trace?.script?.section_title ?? "").trim() ||
    String(trace?.visual?.section_title ?? "").trim()
  ) {
    badges.push("Research-backed");
  }
  if (
    String(trace?.visual?.recommendation?.asset_id ?? "").trim() ||
    String(trace?.visual?.recommendation?.title ?? "").trim()
  ) {
    badges.push("Recommendation-backed");
  }
  if (String(trace?.last_action ?? "").trim()) {
    badges.push("Assistant-updated");
  }
  if (
    Boolean(trace?.manual_override?.script) ||
    Boolean(trace?.manual_override?.visual) ||
    (scriptNote && tracedScriptNote && scriptNote !== tracedScriptNote) ||
    (visualNote && tracedVisualNote && visualNote !== tracedVisualNote)
  ) {
    badges.push("Manual override");
  }

  return Array.from(new Set(badges));
};
const deriveLinkedReleaseNextAction = ({ hasScript = false, hasVisual = false, handoffState = "", itemStatus = "" } = {}) => {
  const normalizedHandoffState = String(handoffState ?? "").trim().toLowerCase();
  const normalizedItemStatus = String(itemStatus ?? "").trim().toLowerCase();
  if (!hasScript) return "Draft";
  if (!hasVisual) return "Fill Visuals";
  if (normalizedHandoffState === "download_needed") return "Queue Download";
  if (normalizedHandoffState === "capture_needed") return "Screenshot";
  if (normalizedHandoffState === "backup_only") return "Review Backup";
  if (normalizedItemStatus === "selected" || normalizedItemStatus === "scripting") return "Prepare";
  if (normalizedItemStatus === "visual_ready") return "Mark Ready";
  if (normalizedHandoffState === "downloaded" || normalizedHandoffState === "captured") return "Open Handoff";
  return "Open Release";
};
const formatRecommendationBucketLabel = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  const labels = {
    strong: "Strong",
    good: "Good",
    possible: "Possible"
  };
  return labels[key] ?? (key || "Candidate");
};
const formatRecentDocLabel = (doc) => {
  if (!doc) return "";
  const dateLabel = formatDocDate(doc.updated_at ?? doc.created_at);
  return dateLabel ? `${doc.id} - ${dateLabel}` : doc.id;
};
const getNeedsSegmentationFromDocument = (document) => {
  if (!document || typeof document !== "object") return false;
  return Boolean(document.needs_segmentation);
};
const formatBytes = (value) => {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let current = size;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[idx]}`;
};
const getFileNameFromDisposition = (value) => {
  const header = String(value ?? "").trim();
  if (!header) return "";
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }
  const plainMatch = header.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] ? plainMatch[1].trim() : "";
};
const isYtDlpCandidateUrl = (rawUrl) => {
  const normalized = normalizeLinkUrl(rawUrl);
  if (!normalized) return false;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (DIRECT_MEDIA_PATH_RE.test(parsed.pathname + parsed.search)) return true;
  const host = parsed.hostname.toLowerCase();
  if (host === "vk.com" || host.endsWith(".vk.com") || host === "vk.ru" || host.endsWith(".vk.ru") || host === "vkvideo.ru" || host.endsWith(".vkvideo.ru")) {
    return isVkVideoUrl(parsed);
  }
  return YTDLP_CANDIDATE_HOSTS.some((pattern) => pattern.test(host));
};
const formatMediaJobProgress = (job) => {
  const bucket = Number(job?.progress_bucket);
  if (Number.isFinite(bucket)) return `${Math.max(0, Math.min(100, bucket))}%`;
  const text = String(job?.progress ?? "").trim();
  return text;
};
const COLLAB_AUTOSAVE_DEBOUNCE_MS = 1200;
const COLLAB_POLL_INTERVAL_MS = 2500;
const COLLAB_REMOTE_POLL_ENABLED = false;
const LAST_USED_DOC_STORAGE_KEY = "vbaut:last_used_doc_id";
const AUTO_OPEN_LAST_DOC_STORAGE_KEY = "vbaut:auto_open_last_doc";
const API_HTML_RESPONSE_ERROR =
  "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b HTML \u0432\u043c\u0435\u0441\u0442\u043e JSON. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 backend, Vite proxy (/api) \u0438 \u0442\u0443\u043d\u043d\u0435\u043b\u044c ngrok.";

const shouldLookLikeJson = (text = "") => {
  const trimmed = String(text).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  return false;
};

async function fetchJsonSafe(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (!headers.has("ngrok-skip-browser-warning")) {
    headers.set("ngrok-skip-browser-warning", "1");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const rawText = await response.text();
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();

  if (!rawText.trim()) {
    return { response, data: null, rawText };
  }

  if (contentType.includes("application/json") || shouldLookLikeJson(rawText)) {
    try {
      const data = JSON.parse(rawText);
      return { response, data, rawText };
    } catch {
      throw new Error(
        "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u043d\u044b\u0439 JSON. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 backend."
      );
    }
  }

  if (/^\s*<!doctype html|^\s*<html/i.test(rawText)) {
    throw new Error(API_HTML_RESPONSE_ERROR);
  }

  return { response, data: null, rawText };
}
const UI_AUDIT_BATCH_SIZE = 25;
const UI_AUDIT_MAX_QUEUE = 500;
const UI_AUDIT_FLUSH_MS = 1500;
const UI_AUDIT_INPUT_THROTTLE_MS = 1200;
const UI_AUDIT_TARGET_SELECTOR = "button,a,input,select,textarea,[role='button'],[data-action],[data-audit],label";
const UI_AUDIT_TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week"
]);

const truncateText = (value, maxLength = 160) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= maxLength ? text : text.slice(0, maxLength);
};

const safeUrlHint = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text, window.location.origin);
    const nestedPath = String(parsed.pathname ?? "").replace(/^\/+/, "");
    if (/^https?:\/\//i.test(nestedPath)) {
      try {
        const nested = new URL(nestedPath);
        return `${nested.origin}${nested.pathname}`;
      } catch {
        // fallback to parsed url below
      }
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncateText(text, 200);
  }
};

const extractUiTargetInfo = (rawTarget) => {
  if (typeof window === "undefined") return null;
  if (!(rawTarget instanceof Element)) return null;
  const target = rawTarget.closest(UI_AUDIT_TARGET_SELECTOR) ?? rawTarget;
  if (!(target instanceof Element)) return null;

  const base = {
    tag: String(target.tagName ?? "").toLowerCase(),
    id: truncateText(target.id, 80) || null,
    name: truncateText(target.getAttribute("name"), 80) || null,
    role: truncateText(target.getAttribute("role"), 80) || null,
    class: truncateText(target.className, 120) || null,
    text: truncateText(target.textContent, 120) || null,
    type: null,
    href: null,
    data_action: truncateText(target.getAttribute("data-action"), 120) || null
  };

  if (target instanceof HTMLInputElement) {
    base.type = truncateText(target.type, 40) || "input";
    return base;
  }
  if (target instanceof HTMLTextAreaElement) {
    base.type = "textarea";
    return base;
  }
  if (target instanceof HTMLSelectElement) {
    base.type = "select";
    return base;
  }
  if (target instanceof HTMLAnchorElement) {
    base.type = "link";
    base.href = safeUrlHint(target.href) || null;
    return base;
  }
  base.type = base.tag || null;
  return base;
};

const buildUiActionPayload = (eventType, event, docId) => {
  if (!event || typeof eventType !== "string") return null;
  const target = extractUiTargetInfo(event.target);
  if (!target) return null;

  const meta = {
    trusted: Boolean(event.isTrusted)
  };

  if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLInputElement) {
    const inputType = String(event.target.type ?? "").toLowerCase();
    if (inputType === "checkbox" || inputType === "radio") {
      meta.checked = Boolean(event.target.checked);
    } else if (UI_AUDIT_TEXT_INPUT_TYPES.has(inputType)) {
      meta.value_length = String(event.target.value ?? "").length;
    } else {
      meta.value_hint = truncateText(event.target.value, 120) || null;
    }
  } else if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLTextAreaElement) {
    meta.value_length = String(event.target.value ?? "").length;
  } else if ((eventType === "change" || eventType === "input") && event.target instanceof HTMLSelectElement) {
    meta.value_hint = truncateText(event.target.value, 120) || null;
  } else if (eventType === "submit" && event.target instanceof HTMLFormElement) {
    meta.form_action = safeUrlHint(event.target.action) || null;
  }

  return {
    ts: new Date().toISOString(),
    type: eventType,
    path: `${window.location.pathname}${window.location.search}`,
    doc_id: docId || null,
    target,
    meta
  };
};

async function sendUiAuditActions(actions, options = {}) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return true;
  const bodyText = JSON.stringify({
    source: "frontend_app",
    actions: list
  });

  const keepalive = Boolean(options.keepalive);
  try {
    await fetch("/api/audit/ui-actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "ngrok-skip-browser-warning": "1"
      },
      body: bodyText,
      keepalive
    });
    return true;
  } catch {
    return false;
  }
}

const getInitialCollaborativeMode = () => {
  return false;
};
const getInitialAutoOpenLastDoc = () => {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage?.getItem(AUTO_OPEN_LAST_DOC_STORAGE_KEY);
  if (raw === "0") return false;
  return true;
};
const buildSessionPayloadFromState = ({ scriptText, notionUrl, segments }) => {
  const { segmentsPayload, decisionsPayload } = splitSegmentsAndDecisions(segments);
  return {
    raw_text: scriptText,
    notion_url: notionUrl.trim() || null,
    segments: segmentsPayload,
    decisions: decisionsPayload
  };
};
const getSessionFingerprint = (snapshot) => JSON.stringify(snapshot ?? {});
const normalizeSegmentBlockType = (value) => {
  const normalized = String(value ?? "").toLowerCase().trim();
  return normalized === "links" ? "links" : "news";
};
const VOWELS_RU = new Set(["\u0430", "\u0435", "\u0451", "\u0438", "\u043e", "\u0443", "\u044b", "\u044d", "\u044e", "\u044f"]);
const VOWELS_EN = new Set(["a", "e", "i", "o", "u", "y"]);
const RU_UNITS_SYL = [0, 2, 1, 1, 3, 1, 1, 1, 2, 2];
const RU_TEENS_SYL = [2, 4, 3, 3, 4, 3, 3, 3, 4, 4];
const RU_TENS_SYL = [0, 0, 2, 2, 2, 3, 3, 3, 4, 4];
const RU_HUNDREDS_SYL = [0, 1, 2, 2, 4, 2, 2, 2, 3, 3];
const RU_SCALES = [
  null,
  { singular: 3, few: 3, many: 2 },
  { singular: 3, few: 4, many: 4 },
  { singular: 3, few: 4, many: 4 },
  { singular: 3, few: 4, many: 4 }
];
const countRussianGroupSyllables = (value) => {
  const hundreds = Math.floor(value / 100);
  const tensUnits = value % 100;
  let total = RU_HUNDREDS_SYL[hundreds] ?? 0;
  if (tensUnits >= 10 && tensUnits <= 19) {
    total += RU_TEENS_SYL[tensUnits - 10] ?? 0;
    return total;
  }
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;
  total += (RU_TENS_SYL[tens] ?? 0) + (RU_UNITS_SYL[units] ?? 0);
  return total;
};
const countRussianScaleSyllables = (scaleIndex, groupValue) => {
  if (scaleIndex === 0 || groupValue === 0) return 0;
  const scale = RU_SCALES[scaleIndex] ?? { singular: 3, few: 4, many: 4 };
  const mod100 = groupValue % 100;
  if (mod100 >= 11 && mod100 <= 19) return scale.many;
  const mod10 = groupValue % 10;
  if (mod10 === 1) return scale.singular;
  if (mod10 >= 2 && mod10 <= 4) return scale.few ?? scale.many;
  return scale.many;
};
const countNumberSyllables = (digits) => {
  if (!digits) return 0;
  const cleaned = String(digits).replace(/^0+(?=\d)/, "");
  if (cleaned === "0") return 1;
  let total = 0;
  let groupIndex = 0;
  for (let end = cleaned.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3);
    const groupValue = Number(cleaned.slice(start, end));
    if (groupValue) {
      total += countRussianGroupSyllables(groupValue);
      total += countRussianScaleSyllables(groupIndex, groupValue);
    }
    groupIndex += 1;
  }
  return total;
};
const countSyllables = (text) => {
  const tokens = String(text ?? "").match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return 0;
  let total = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      total += countNumberSyllables(token);
      continue;
    }
    let count = 0;
    const hasCyrillic = /[\p{Script=Cyrillic}]/u.test(token);
    if (hasCyrillic) {
      for (const ch of token) {
        if (VOWELS_RU.has(ch.toLowerCase())) count += 1;
      }
    } else {
      let prevIsVowel = false;
      for (const ch of token) {
        const isVowel = VOWELS_EN.has(ch.toLowerCase());
        if (isVowel && !prevIsVowel) count += 1;
        prevIsVowel = isVowel;
      }
    }
    total += count || 1;
  }
  return total;
};
const computeDurationHint = (text) => {
  const syllables = countSyllables(text);
  if (!syllables) return null;
  return Math.ceil(syllables / 6);
};
const LEADING_NUMBERED_LINE_RE = /^\s*\d{1,3}[.)]\s*\S/;
const COMMENT_NUMBER_PREFIX_RE = /^\s*\d{1,3}[.)]\s*/;
const COMMENT_COMMAND_RE = /^\s*\/(?:фрагмент|нарезка|нейро-видео)\b/i;
const COMMENT_DATE_ONLY_RE = /^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*$/;
const COMMENT_INLINE_NUMBER_TEST_RE = /(?:^|[\s\n])\d{1,3}[.)]\s*/;
const COMMENT_TRAILING_NUMBER_RE = /\b\d{1,3}[.)]\s*$/;
const normalizeCommentLineForCompare = (value) =>
  normalizeLineBreaks(value)
    .replace(COMMENT_NUMBER_PREFIX_RE, "")
    .replace(/^[/\\\-]+\s*/g, "")
    .replace(/[«»"“”'`]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const isCommentLineDuplicate = (line, pool) => {
  if (!line) return false;
  for (const candidate of pool) {
    if (!candidate) continue;
    if (candidate === line) return true;
    const minLen = Math.min(candidate.length, line.length);
    if (minLen >= 14 && (candidate.includes(line) || line.includes(candidate))) {
      return true;
    }
  }
  return false;
};
const removeDuplicateCommentSegments = (segments = []) => {
  if (!Array.isArray(segments) || segments.length === 0) return segments;
  const sectionPools = new Map();
  const getPool = (segment) => {
    const key = getSectionKeyFromMeta(segment);
    if (!sectionPools.has(key)) sectionPools.set(key, []);
    return sectionPools.get(key);
  };

  segments.forEach((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) === "links") return;
    if (isCommentsSegment(segment)) return;
    const normalized = normalizeCommentLineForCompare(segment?.text_quote ?? "");
    if (!normalized) return;
    getPool(segment).push(normalized);
  });

  const result = [];
  segments.forEach((segment) => {
    if (!isCommentsSegment(segment)) {
      result.push(segment);
      return;
    }
    const lines = normalizeLineBreaks(segment?.text_quote ?? "").split("\n");
    const pool = getPool(segment);
    const seen = new Set();
    const kept = [];
    lines.forEach((line) => {
      const content = String(line ?? "").replace(COMMENT_NUMBER_PREFIX_RE, "").trim();
      const normalized = normalizeCommentLineForCompare(content);
      if (!normalized) return;
      if (seen.has(normalized)) return;
      if (isCommentLineDuplicate(normalized, pool)) return;
      seen.add(normalized);
      kept.push(content);
    });

    if (kept.length === 0) return;
    const normalizedText = kept.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
    result.push({
      ...segment,
      text_quote: normalizedText,
      visual_decision: {
        ...emptyVisualDecision(),
        duration_hint_sec: computeDurationHint(normalizedText)
      },
      search_decision: emptySearchDecision(),
      search_open: false
    });
  });

  return result;
};
const getVisualDefaultsByType = (type, config = defaultConfig) => {
  const key = String(type ?? "").trim().toLowerCase();
  const defaults = VISUAL_TYPE_DEFAULTS[key] ?? VISUAL_TYPE_DEFAULTS.image;
  const formatHint =
    defaults.format_hint && (config?.formatHints ?? defaultConfig.formatHints).includes(defaults.format_hint)
      ? defaults.format_hint
      : null;
  const priority =
    defaults.priority && (config?.priorities ?? defaultConfig.priorities).includes(defaults.priority)
      ? defaults.priority
      : null;
  return { format_hint: formatHint, priority };
};
const splitLeadingCommentList = (text) => {
  const lines = normalizeLineBreaks(text).split("\n");
  const commentLines = [];
  let numberedCount = 0;
  let index = 0;
  let allowUpperContinuation = false;
  const isContinuationLine = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return false;
    if (LEADING_NUMBERED_LINE_RE.test(trimmed)) return false;
    if (COMMENT_COMMAND_RE.test(trimmed)) return false;
    if (COMMENT_DATE_ONLY_RE.test(trimmed)) return false;
    if (/^#{1,}\s+/.test(trimmed)) return false;
    if (/^\s*[-–—]\s+/.test(trimmed)) return false;
    if (allowUpperContinuation) return true;
    // Most continuation lines in comments start with lowercase words.
    if (/^[a-zа-яё]/u.test(trimmed)) return true;
    // Also keep very short tail lines like "(продолжение)" or "и т.д."
    if (trimmed.length <= 24) return true;
    return false;
  };
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      if (commentLines.length === 0) {
        index += 1;
        continue;
      }
      const next = lines[index + 1];
      if (next && LEADING_NUMBERED_LINE_RE.test(next)) {
        commentLines.push(line);
        index += 1;
        continue;
      }
      break;
    }
    if (LEADING_NUMBERED_LINE_RE.test(line)) {
      const numberedContent = String(line).replace(COMMENT_NUMBER_PREFIX_RE, "").trim();
      if (COMMENT_DATE_ONLY_RE.test(numberedContent)) {
        // Notion comments may inject author date (e.g. 08/07/2025) before the actual comment text.
        numberedCount += 1;
        allowUpperContinuation = true;
        index += 1;
        continue;
      }
      commentLines.push(line);
      numberedCount += 1;
      allowUpperContinuation = false;
      index += 1;
      continue;
    }
    if (numberedCount > 0 && isContinuationLine(line)) {
      const trimmed = String(line).trim();
      if (!COMMENT_DATE_ONLY_RE.test(trimmed)) {
        commentLines.push(line);
      }
      allowUpperContinuation = false;
      index += 1;
      continue;
    }
    allowUpperContinuation = false;
    break;
  }
  if (commentLines.length < 1) return null;
  const commentsText = commentLines.join("\n").trim();
  const mainText = lines.slice(index).join("\n").trimStart();
  if (!commentsText) return null;
  return { commentsText, mainText };
};
const sanitizeSearchQueryText = (value, engineId = "") => {
  let normalized = normalizeLineBreaks(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  // Dzen often receives malformed queries with long '+' runs from copied text.
  if (String(engineId) === "dzen_news") {
    normalized = normalized.replace(/\+{2,}/g, " ").replace(/\s+/g, " ").trim();
  }
  return normalized;
};
const buildCommentsSegmentId = (sourceId, usedIds) => {
  const rawBase = String(sourceId ?? "news")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = rawBase || "news";
  let candidate = `comments_${base}`;
  let counter = 1;
  while (usedIds.has(candidate)) {
    candidate = `comments_${base}_${String(counter).padStart(2, "0")}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
};
const extractInlineNumberedCommentItems = (text) => {
  const normalized = normalizeLineBreaks(text);
  const markerRe = /(^|[\s\n])(\d{1,3})[.)]\s*/g;
  const markers = [];
  let match = markerRe.exec(normalized);
  while (match) {
    const markerStart = match.index + String(match[1] ?? "").length;
    markers.push({
      markerStart,
      contentStart: markerRe.lastIndex
    });
    match = markerRe.exec(normalized);
  }
  if (markers.length === 0) return [];
  const items = [];
  for (let idx = 0; idx < markers.length; idx += 1) {
    const start = markers[idx].contentStart;
    const end = idx + 1 < markers.length ? markers[idx + 1].markerStart : normalized.length;
    const content = normalized
      .slice(start, end)
      .replace(/\s+/g, " ")
      .trim();
    if (!content || COMMENT_DATE_ONLY_RE.test(content)) continue;
    items.push(content);
  }
  return items;
};
const splitOutLeadingCommentSegments = (segments = []) => {
  if (!segments.length) return segments;
  const usedIds = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  const result = [];
  let index = 0;
  while (index < segments.length) {
    const segment = segments[index];
    if (normalizeSegmentBlockType(segment.block_type) === "links") {
      result.push(segment);
      index += 1;
      continue;
    }
    if (isCommentsSegment(segment)) {
      result.push(segment);
      index += 1;
      continue;
    }
    const sectionKey = getSectionKeyFromMeta(segment);
    const leadWindow = [segment];
    let cursor = index + 1;
    while (cursor < segments.length && leadWindow.length < 4) {
      const next = segments[cursor];
      if (normalizeSegmentBlockType(next.block_type) === "links" || isCommentsSegment(next)) break;
      if (getSectionKeyFromMeta(next) !== sectionKey) break;
      const windowText = leadWindow.map((item) => String(item.text_quote ?? "")).join("\n");
      const hasNumberInWindow = COMMENT_INLINE_NUMBER_TEST_RE.test(windowText);
      const lastText = String(leadWindow[leadWindow.length - 1].text_quote ?? "").trim();
      const nextText = String(next.text_quote ?? "").trim();
      const shouldAttach = COMMENT_INLINE_NUMBER_TEST_RE.test(nextText) || COMMENT_TRAILING_NUMBER_RE.test(lastText);
      if (!hasNumberInWindow || !shouldAttach) break;
      leadWindow.push(next);
      cursor += 1;
    }
    if (leadWindow.length >= 2) {
      const combinedLeadText = leadWindow.map((item) => String(item.text_quote ?? "")).join("\n");
      const extractedItems = extractInlineNumberedCommentItems(combinedLeadText);
      const combinedNorm = normalizeCommentLineForCompare(combinedLeadText);
      const extractedNorm = normalizeCommentLineForCompare(extractedItems.join(" "));
      const averageLen =
        leadWindow.reduce((sum, item) => sum + String(item.text_quote ?? "").trim().length, 0) / leadWindow.length;
      const coverage = combinedNorm ? extractedNorm.length / combinedNorm.length : 0;
      const looksLikeCommentLead = extractedItems.length >= 2 && averageLen <= 160 && coverage >= 0.52;
      if (looksLikeCommentLead) {
        const commentsText = extractedItems.map((item, idx) => `${idx + 1}. ${item}`).join("\n");
        result.push({
          ...segment,
          segment_id: buildCommentsSegmentId(segment.segment_id, usedIds),
          text_quote: commentsText,
          segment_status: "new",
          is_done: false,
          visual_decision: {
            ...emptyVisualDecision(),
            duration_hint_sec: computeDurationHint(commentsText)
          },
          search_decision: emptySearchDecision(),
          search_open: false
        });
        index = cursor;
        continue;
      }
    }

    const split = splitLeadingCommentList(segment.text_quote ?? "");
    if (!split) {
      result.push(segment);
      index += 1;
      continue;
    }

    const currentVisual = normalizeVisualDecision(segment.visual_decision, defaultConfig);
    const prevDuration = currentVisual.duration_hint_sec;
    const prevAutoDuration = computeDurationHint(segment.text_quote ?? "");
    const shouldAutoUpdateMainDuration =
      prevDuration === null || prevDuration === undefined || prevDuration === prevAutoDuration;

    result.push({
      ...segment,
      segment_id: buildCommentsSegmentId(segment.segment_id, usedIds),
      text_quote: split.commentsText,
      segment_status: "new",
      is_done: false,
      visual_decision: {
        ...emptyVisualDecision(),
        duration_hint_sec: computeDurationHint(split.commentsText)
      },
      search_decision: emptySearchDecision(),
      search_open: false
    });
    if (String(split.mainText ?? "").trim()) {
      result.push({
        ...segment,
        text_quote: split.mainText,
        visual_decision: {
          ...currentVisual,
          duration_hint_sec: shouldAutoUpdateMainDuration ? computeDurationHint(split.mainText) : prevDuration
        }
      });
    }
    index += 1;
  }
  return result;
};
const normalizeLineBreaks = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const normalizeTopicTitleForDisplay = (title) => {
  const value = normalizeLineBreaks(title)
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
};
const DEFAULT_MEDIA_TOPIC_NAME = "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";
const sanitizeMediaTopicName = (rawTitle) => {
  const value = String(rawTitle ?? "").trim();
  if (!value) return DEFAULT_MEDIA_TOPIC_NAME;

  const replaced = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const normalized = replaced || DEFAULT_MEDIA_TOPIC_NAME;
  const clipped = normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
  if (!clipped) return DEFAULT_MEDIA_TOPIC_NAME;

  const upper = clipped.toUpperCase();
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9"
  ]);
  return reserved.has(upper) ? `_${clipped}` : clipped;
};
const getMediaFileTopicFolder = (mediaPath) => {
  const normalizedPath = normalizeMediaFilePath(mediaPath);
  if (!normalizedPath) return "";
  const [folder] = normalizedPath.split("/");
  return String(folder ?? "").trim();
};
const normalizeHeadingForFigma = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, "")
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const getQuotePreview = (text, limit = 110) => {
  const value = normalizeLineBreaks(text).replace(/\s+/g, " ").trim();
  if (!value) return "\u041f\u0443\u0441\u0442\u0430\u044f \u0446\u0438\u0442\u0430\u0442\u0430";
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}...`;
};
const isCommentsSegment = (segment) => /^comments_/i.test(String(segment?.segment_id ?? "").trim());
const normalizeSectionTitleForId = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, " ")
    .replace(/[«»"“”'`]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const normalizeSectionTitleForMerge = (title) =>
  normalizeLineBreaks(title)
    .replace(/^#{1,}\s*/g, " ")
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/g, " ")
    .replace(/[«»"“”'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const hashSectionTitle = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const buildSectionId = (title, occurrence = 1) => {
  const normalizedTitle = normalizeSectionTitleForId(title);
  if (!normalizedTitle) return `section_${String(occurrence).padStart(2, "0")}`;
  return `section_${hashSectionTitle(normalizedTitle)}_${String(occurrence).padStart(2, "0")}`;
};
const isLegacySectionId = (value) => /^section_\d+$/i.test(String(value ?? "").trim());
const splitScriptIntoHeadingBlocks = (text) => {
  const normalized = normalizeLineBreaks(text);
  const lines = normalized.split("\n");
  const blocks = [];
  let offset = 0;
  let current = {
    heading: null,
    headingLine: null,
    headingStart: 0,
    contentStart: 0,
    lines: []
  };
  const pushCurrent = (endOffset) => {
    if (!current.heading && current.lines.length === 0) return;
    blocks.push({ ...current, endOffset });
  };
  for (const line of lines) {
    const match = line.match(/#{3,}\s*(.+?)\s*$/);
    if (match) {
      const hashIndex = line.indexOf("#");
      const before = hashIndex > 0 ? line.slice(0, hashIndex).trim() : "";
      if (before) current.lines.push(before);
      pushCurrent(offset + hashIndex);
      current = {
        heading: match[1].trim(),
        headingLine: line,
        headingStart: offset + hashIndex,
        contentStart: offset + line.length + 1,
        lines: []
      };
      offset += line.length + 1;
      continue;
    }
    current.lines.push(line);
    offset += line.length + 1;
  }
  pushCurrent(normalized.length);
  return { normalized, blocks };
};
const isLikelyUrlToken = (value) => {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^www\./i.test(value)) return true;
  return /^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(value);
};
const normalizeLinkUrl = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};
const canonicalizeLinkUrl = (value) => {
  const normalized = normalizeLinkUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.port === "80") url.port = "";
    if (url.protocol === "https:" && url.port === "443") url.port = "";
    return url.toString();
  } catch {
    return normalized;
  }
};
const getReadableLinkLabel = (value, maxLength = 240) => {
  const normalized = normalizeLinkUrl(value);
  if (!normalized) return "";
  const displayUrl = normalized;
  let decoded = displayUrl;
  try {
    decoded = decodeURI(displayUrl);
  } catch {
    decoded = displayUrl;
  }
  if (decoded.length <= maxLength) return decoded;
  return `${decoded.slice(0, maxLength).trimEnd()}...`;
};
const getPreviewImageSrc = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/api/link/")) return raw;
  if (raw.startsWith("data:")) return raw;
  const normalized = normalizeLinkUrl(raw);
  if (!normalized) return "";
  return `/api/link/image?url=${encodeURIComponent(normalized)}`;
};
const buildScreenshotPreviewImageSrc = (pageUrl) => {
  const normalized = normalizeLinkUrl(pageUrl);
  if (!normalized) return "";
  return `/api/link/screenshot?url=${encodeURIComponent(normalized)}&v=11`;
};
const getUrlHost = (value) => {
  try {
    const url = new URL(normalizeLinkUrl(value));
    return url.host.replace(/^www\./i, "");
  } catch {
    return "";
  }
};
const parseLinkLine = (line) => {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:\d+\.\s*)?(\S+)$/);
  if (!match) return null;
  let token = match[1]
    .replace(/^[|│┃¦❘>]+\s*/g, "")
    .replace(/[)\],.]+$/g, "");
  if (!isLikelyUrlToken(token)) return null;
  return { url: normalizeLinkUrl(token), raw: trimmed };
};
const parseIndexedReferenceLine = (line) => {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\.\s*(.+)$/);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  const value = String(match[2] ?? "")
    .replace(/^[|│┃¦❘>]+\s*/g, "")
    .trim();
  if (!value) return null;
  return {
    index: Number.isFinite(index) ? index : null,
    value,
    raw: trimmed
  };
};
const takeReferenceHint = (hints = [], refIndex = null) => {
  if (!Array.isArray(hints) || hints.length === 0) return null;
  let bestPos = -1;
  if (Number.isFinite(refIndex)) {
    let bestDelta = Number.POSITIVE_INFINITY;
    hints.forEach((item, idx) => {
      if (!item || !Number.isFinite(item.index) || item.index > refIndex) return;
      const delta = refIndex - item.index;
      if (delta <= bestDelta) {
        bestDelta = delta;
        bestPos = idx;
      }
    });
  }
  if (bestPos === -1) {
    bestPos = hints.length - 1;
  }
  const [picked] = hints.splice(bestPos, 1);
  const text = String(picked?.text ?? "").trim();
  if (!text) return null;
  return text;
};
const dedupeLinks = (links = []) => {
  const seen = new Set();
  const result = [];
  links.forEach((link) => {
    const url = normalizeLinkUrl(link?.url ?? link ?? "");
    if (!url) return;
    const key = canonicalizeLinkUrl(url);
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ url, raw: link?.raw ?? null });
  });
  return result;
};
const getSectionTitleKey = (section) => normalizeSectionTitleForId(section?.section_title ?? "");
const getSectionKeyFromMeta = (section) => {
  const sectionId = String(section?.section_id ?? "").trim();
  const titleKey = getSectionTitleKey(section);
  if (sectionId && !isLegacySectionId(sectionId)) return `id:${sectionId}`;
  if (titleKey) return `title:${titleKey}`;
  if (sectionId) return `id:${sectionId}`;
  return "untitled";
};
const getLooseSectionKeyFromMeta = (section) => {
  const sectionId = String(section?.section_id ?? "").trim();
  if (sectionId && !isLegacySectionId(sectionId)) return `id:${sectionId}`;
  const titleKey = normalizeSectionTitleForMerge(section?.section_title ?? "");
  if (titleKey) return `title:${titleKey}`;
  if (sectionId) return `id:${sectionId}`;
  return "untitled";
};
const normalizeTextForHintMatch = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const tokenizeTextForHintMatch = (text) => {
  const normalized = normalizeTextForHintMatch(text);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
};
const scoreHintAgainstSegment = (segmentText, hintText, hintTokens = null) => {
  const hintNorm = normalizeTextForHintMatch(hintText);
  const segmentNorm = normalizeTextForHintMatch(segmentText);
  if (!hintNorm || !segmentNorm) return 0;
  if (segmentNorm === hintNorm) return 1.25;
  if (segmentNorm.includes(hintNorm)) return 1.1;
  if (hintNorm.length >= 20 && hintNorm.includes(segmentNorm)) return 0.95;
  const left = tokenizeTextForHintMatch(segmentNorm);
  const right = Array.isArray(hintTokens) ? hintTokens : tokenizeTextForHintMatch(hintNorm);
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  let overlap = 0;
  right.forEach((token) => {
    if (leftSet.has(token)) overlap += 1;
  });
  if (overlap === 0) return 0;
  const union = new Set([...left, ...right]).size;
  const jaccard = union > 0 ? overlap / union : 0;
  const coverage = right.length > 0 ? overlap / right.length : 0;
  return Math.max(jaccard, coverage * 0.92);
};
const extractLinksFromScript = (text) => {
  const { blocks } = splitScriptIntoHeadingBlocks(text);
  const linkGroups = new Map();
  const segmentLinkHints = [];
  const cleanLines = [];
  let sectionIndex = 0;
  const sectionTitleCounts = new Map();
  let currentSection = null;
  const addLinkToGroup = (section, link) => {
    if (!link) return;
    const key = getSectionKeyFromMeta(section);
    if (!linkGroups.has(key)) {
      linkGroups.set(key, {
        section_id: section?.section_id ?? null,
        section_title: section?.section_title ?? null,
        section_index: section?.section_index ?? null,
        links: []
      });
    }
    linkGroups.get(key).links.push(link);
  };
  for (const block of blocks) {
    if (block.heading) {
      const hasContent = block.lines.some((line) => {
        const trimmed = String(line ?? "").trim();
        if (!trimmed) return false;
        return !parseLinkLine(trimmed);
      });
      if (hasContent) {
        sectionIndex += 1;
        const titleKey = normalizeSectionTitleForId(block.heading);
        const occurrence = (sectionTitleCounts.get(titleKey) ?? 0) + 1;
        sectionTitleCounts.set(titleKey, occurrence);
        currentSection = {
          section_id: buildSectionId(block.heading, occurrence),
          section_title: block.heading,
          section_index: sectionIndex
        };
      } else {
        currentSection = {
          section_id: null,
          section_title: block.heading,
          section_index: null
        };
      }
      cleanLines.push(block.headingLine ?? `### ${block.heading}`);
    }
    let refsConsumed = 0;
    const prefixRefs = [];
    for (let idx = 0; idx < block.lines.length; idx += 1) {
      const line = block.lines[idx];
      const trimmed = String(line ?? "").trim();
      if (!trimmed) {
        if (prefixRefs.length === 0) continue;
        break;
      }
      const indexedRef = parseIndexedReferenceLine(trimmed);
      if (indexedRef) {
        prefixRefs.push(indexedRef);
        refsConsumed = idx + 1;
        continue;
      }
      const plainLink = parseLinkLine(trimmed);
      if (plainLink && prefixRefs.length > 0) {
        prefixRefs.push({ index: null, value: trimmed, raw: trimmed });
        refsConsumed = idx + 1;
        continue;
      }
      break;
    }
    const hasReferencePrefix =
      prefixRefs.length > 0 &&
      prefixRefs.some((item) => Number.isFinite(item.index)) &&
      prefixRefs.some((item) => Boolean(parseLinkLine(item.value)));
    if (hasReferencePrefix) {
      const pendingHints = [];
      prefixRefs.forEach((entry) => {
        const content = String(entry?.value ?? "").trim();
        if (!content) return;
        const link = parseLinkLine(content);
        if (link) {
          addLinkToGroup(currentSection, link);
          const hintText = takeReferenceHint(pendingHints, entry.index);
          if (hintText) {
            segmentLinkHints.push({
              section_id: currentSection?.section_id ?? null,
              section_title: currentSection?.section_title ?? null,
              section_index: currentSection?.section_index ?? null,
              url: link.url,
              raw: link.raw ?? content,
              quote_hint: hintText
            });
          }
          return;
        }
        if (content.length >= 8) {
          pendingHints.push({
            index: Number.isFinite(entry.index) ? entry.index : null,
            text: content
          });
        }
      });
    }
    const skipUntil = hasReferencePrefix ? refsConsumed : 0;
    for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex += 1) {
      const line = block.lines[lineIndex];
      if (skipUntil > 0 && lineIndex < skipUntil) {
        continue;
      }
      const link = parseLinkLine(line);
      if (link) {
        addLinkToGroup(currentSection, link);
        cleanLines.push("");
        continue;
      }
      cleanLines.push(line);
    }
  }
  const cleanText = cleanLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  const linkSegments = Array.from(linkGroups.values()).map((group, index) => ({
    segment_id: group.section_id ? `links_${group.section_id}` : `links_${String(index + 1).padStart(2, "0")}`,
    block_type: "links",
    text_quote: "",
    links: dedupeLinks(group.links),
    section_id: group.section_id ?? null,
    section_title: group.section_title ?? null,
    section_index: group.section_index ?? null,
    segment_status: null,
    visual_decision: emptyVisualDecision(),
    search_decision: emptySearchDecision(),
    search_open: false,
  }));
  const dedupedSegmentHints = [];
  const seenSegmentHints = new Set();
  segmentLinkHints.forEach((item) => {
    const url = normalizeLinkUrl(item?.url ?? "");
    if (!url) return;
    const sectionKey = getLooseSectionKeyFromMeta(item);
    const canonical = canonicalizeLinkUrl(url);
    const hintNorm = normalizeTextForHintMatch(item?.quote_hint ?? "");
    const dedupeKey = `${sectionKey}|${canonical}|${hintNorm}`;
    if (seenSegmentHints.has(dedupeKey)) return;
    seenSegmentHints.add(dedupeKey);
    dedupedSegmentHints.push({
      ...item,
      url
    });
  });
  return { cleanText, linkSegments, segmentLinkHints: dedupedSegmentHints };
};
const mergeLinkSegmentsBySection = (existing = [], extracted = []) => {
  const map = new Map();
  const order = [];
  const looseTitleToStrictKey = new Map();
  const linkOwnerByCanonicalUrl = new Map();
  const historyOwnerByCanonicalUrl = new Map();

  existing.forEach((segment) => {
    const key = getSectionKeyFromMeta(segment);
    dedupeLinks(segment.links ?? []).forEach((link) => {
      const canonical = canonicalizeLinkUrl(link?.url ?? "");
      if (!canonical) return;
      const currentOwner = historyOwnerByCanonicalUrl.get(canonical);
      if (!currentOwner || key.localeCompare(currentOwner) < 0) {
        historyOwnerByCanonicalUrl.set(canonical, key);
      }
    });
  });

  const pickOwnedLinks = (links = [], key, source = "history") => {
    const accepted = [];
    dedupeLinks(links).forEach((link) => {
      const canonical = canonicalizeLinkUrl(link?.url ?? "");
      if (!canonical) return;
      const owner = linkOwnerByCanonicalUrl.get(canonical);
      if (owner && owner !== key) return;
      if (!owner && source === "history") {
        const preferred = historyOwnerByCanonicalUrl.get(canonical);
        if (preferred && preferred !== key) return;
      }
      if (!owner) linkOwnerByCanonicalUrl.set(canonical, key);
      accepted.push(link);
    });
    return accepted;
  };

  const upsert = (segment, targetKey, mode = "merge", source = "history") => {
    const key = targetKey || getSectionKeyFromMeta(segment);
    const links = pickOwnedLinks(segment.links ?? [], key, source);
    const current = map.get(key);
    if (!current) {
      map.set(key, { segment: { ...segment }, links });
      order.push(key);
      return;
    }
    const mergedLinks = dedupeLinks([...(current.links ?? []), ...links]);
    const keepCurrentMeta = mode !== "replace_meta";
    map.set(key, {
      segment: keepCurrentMeta
        ? {
            ...current.segment,
            section_id: current.segment.section_id ?? segment.section_id,
            section_title: current.segment.section_title ?? segment.section_title,
            section_index: current.segment.section_index ?? segment.section_index,
            segment_id: current.segment.segment_id || segment.segment_id
          }
        : {
            ...segment,
            section_id: segment.section_id ?? current.segment.section_id,
            section_title: segment.section_title ?? current.segment.section_title,
            section_index: segment.section_index ?? current.segment.section_index
          },
      links: mergedLinks
    });
  };

  extracted.forEach((segment) => {
    const strictKey = getSectionKeyFromMeta(segment);
    upsert(segment, strictKey, "replace_meta", "incoming");
    const looseTitle = normalizeSectionTitleForMerge(segment.section_title ?? "");
    if (looseTitle && !looseTitleToStrictKey.has(looseTitle)) {
      looseTitleToStrictKey.set(looseTitle, strictKey);
    }
  });

  existing.forEach((segment) => {
    const strictKey = getSectionKeyFromMeta(segment);
    if (map.has(strictKey)) {
      upsert(segment, strictKey, "merge", "history");
      return;
    }
    const looseTitle = normalizeSectionTitleForMerge(segment.section_title ?? "");
    const mappedKey = looseTitle ? looseTitleToStrictKey.get(looseTitle) : "";
    if (mappedKey) {
      upsert(segment, mappedKey, "merge", "history");
      return;
    }
    upsert(segment, strictKey, "merge", "history");
  });

  return order.map((key) => {
    const entry = map.get(key);
    return {
      ...entry.segment,
      links: entry.links ?? []
    };
  });
};
const mergeLinkSegmentsIntoSegments = (segments, linkSegments) => {
  const withoutLinks = segments.filter((segment) => segment.block_type !== "links");
  if (!linkSegments.length) return withoutLinks;
  const result = [...withoutLinks];
  linkSegments.forEach((linkSegment) => {
    const key = getSectionKeyFromMeta(linkSegment);
    const insertAt = result.findIndex(
      (segment) => segment.block_type !== "links" && getSectionKeyFromMeta(segment) === key
    );
    if (insertAt === -1) {
      result.push(linkSegment);
    } else {
      result.splice(insertAt, 0, linkSegment);
    }
  });
  return result;
};
const applySegmentLinkHints = (segments = [], segmentLinkHints = []) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { segments, appliedCount: 0 };
  }
  if (!Array.isArray(segmentLinkHints) || segmentLinkHints.length === 0) {
    return { segments, appliedCount: 0 };
  }

  const nextSegments = segments.map((segment) => ({
    ...segment,
    links: Array.isArray(segment.links) ? dedupeLinks(segment.links) : []
  }));

  const candidatesBySection = new Map();
  nextSegments.forEach((segment, index) => {
    if (normalizeSegmentBlockType(segment?.block_type) === "links") return;
    const strictKey = getSectionKeyFromMeta(segment);
    const looseKey = getLooseSectionKeyFromMeta(segment);
    const keys = new Set([strictKey, looseKey].filter(Boolean));
    keys.forEach((key) => {
      if (!candidatesBySection.has(key)) candidatesBySection.set(key, []);
      candidatesBySection.get(key).push({ index, segment });
    });
  });

  let appliedCount = 0;
  const seenAssignments = new Set();
  segmentLinkHints.forEach((hint) => {
    const url = normalizeLinkUrl(hint?.url ?? "");
    const canonical = canonicalizeLinkUrl(url);
    if (!url || !canonical) return;

    const strictKey = getSectionKeyFromMeta(hint);
    const looseKey = getLooseSectionKeyFromMeta(hint);
    const rawCandidates = [];
    [strictKey, looseKey].forEach((key) => {
      if (!key) return;
      const entries = candidatesBySection.get(key);
      if (!entries?.length) return;
      rawCandidates.push(...entries);
    });
    if (!rawCandidates.length) return;

    const uniqueCandidates = [];
    const seenIndexes = new Set();
    rawCandidates.forEach((item) => {
      if (seenIndexes.has(item.index)) return;
      seenIndexes.add(item.index);
      uniqueCandidates.push(item);
    });
    if (!uniqueCandidates.length) return;

    const hintText = String(hint?.quote_hint ?? "").trim();
    const hintTokens = tokenizeTextForHintMatch(hintText);
    let bestCandidate = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    uniqueCandidates.forEach((candidate) => {
      const score = hintText
        ? scoreHintAgainstSegment(candidate.segment?.text_quote ?? "", hintText, hintTokens)
        : 0.01;
      if (!bestCandidate || score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    });

    if (!bestCandidate) return;
    if (hintText && bestScore < 0.2) return;

    const assignmentKey = `${bestCandidate.segment.segment_id}|${canonical}`;
    if (seenAssignments.has(assignmentKey)) return;

    const nextLinks = dedupeLinks([
      ...(Array.isArray(bestCandidate.segment.links) ? bestCandidate.segment.links : []),
      { url, raw: hint?.raw ?? null }
    ]);
    if (nextLinks.length === (bestCandidate.segment.links ?? []).length) return;

    bestCandidate.segment.links = nextLinks;
    seenAssignments.add(assignmentKey);
    appliedCount += 1;
  });

  return { segments: nextSegments, appliedCount };
};
const collapseDuplicateLinkOnlyTopics = (segments = []) => {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const primaryByTitle = new Map();
  segments.forEach((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) === "links") return;
    const titleKey = normalizeSectionTitleForMerge(segment?.section_title ?? "");
    if (!titleKey) return;
    if (!primaryByTitle.has(titleKey)) {
      primaryByTitle.set(titleKey, {
        section_id: segment?.section_id ?? null,
        section_title: segment?.section_title ?? null,
        section_index: Number.isFinite(Number(segment?.section_index)) ? Number(segment.section_index) : null
      });
      return;
    }
    const current = primaryByTitle.get(titleKey);
    if (!current?.section_id && segment?.section_id) {
      primaryByTitle.set(titleKey, {
        section_id: segment.section_id,
        section_title: segment.section_title ?? current.section_title ?? null,
        section_index: Number.isFinite(Number(segment?.section_index))
          ? Number(segment.section_index)
          : current.section_index
      });
    }
  });

  const reassigned = segments.map((segment) => {
    if (normalizeSegmentBlockType(segment?.block_type) !== "links") return segment;
    const titleKey = normalizeSectionTitleForMerge(segment?.section_title ?? "");
    if (!titleKey) return segment;
    const target = primaryByTitle.get(titleKey);
    if (!target) return segment;
    const sectionId = target.section_id ?? segment.section_id ?? null;
    return {
      ...segment,
      segment_id: sectionId ? `links_${sectionId}` : String(segment.segment_id ?? ""),
      section_id: sectionId,
      section_title: target.section_title ?? segment.section_title ?? null,
      section_index: Number.isFinite(Number(target.section_index))
        ? Number(target.section_index)
        : Number.isFinite(Number(segment?.section_index))
          ? Number(segment.section_index)
          : null
    };
  });

  const withoutLinks = reassigned.filter((segment) => normalizeSegmentBlockType(segment?.block_type) !== "links");
  const linkSegments = reassigned.filter((segment) => normalizeSegmentBlockType(segment?.block_type) === "links");
  const mergedLinks = mergeLinkSegmentsBySection([], linkSegments);
  return mergeLinkSegmentsIntoSegments(withoutLinks, mergedLinks);
};
const parseScriptSections = (text, options = {}) => {
  const includeEmpty = Boolean(options?.includeEmpty);
  const sections = [];
  const { normalized, blocks } = splitScriptIntoHeadingBlocks(text);
  const titleOccurrences = new Map();
  for (const block of blocks) {
    if (!block.heading) continue;
    const hasContent = block.lines.some((line) => String(line ?? "").trim());
    if (!hasContent && !includeEmpty) continue;
    const index = sections.length + 1;
    const titleKey = normalizeSectionTitleForId(block.heading);
    const occurrence = (titleOccurrences.get(titleKey) ?? 0) + 1;
    titleOccurrences.set(titleKey, occurrence);
    sections.push({
      id: buildSectionId(block.heading, occurrence),
      title: block.heading,
      index,
      start: block.contentStart,
      end: block.endOffset ?? normalized.length
    });
  }
  return sections;
};
const buildEmptyTopicSegmentId = (section, usedIds) => {
  const fallbackIndex = Number.isFinite(Number(section?.index)) ? Number(section.index) : usedIds.size + 1;
  const rawBase = String(section?.id ?? `topic_${String(fallbackIndex).padStart(2, "0")}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = rawBase || `topic_${String(fallbackIndex).padStart(2, "0")}`;
  let candidate = `${base}_01`;
  let counter = 1;
  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${base}_${String(counter).padStart(2, "0")}`;
  }
  usedIds.add(candidate);
  return candidate;
};
const ensureEmptySectionTopics = (segments = [], scriptText = "") => {
  const sections = parseScriptSections(scriptText, { includeEmpty: true });
  if (!sections.length) return segments;

  const result = [...segments];
  const titleOnlyIndexMap = new Map();
  result.forEach((segment, idx) => {
    if (segment?.section_id) return;
    const titleKey = normalizeSectionTitleForId(segment?.section_title ?? "");
    if (!titleKey) return;
    if (!titleOnlyIndexMap.has(titleKey)) titleOnlyIndexMap.set(titleKey, []);
    titleOnlyIndexMap.get(titleKey).push(idx);
  });

  const usedTitleOnlyIndexes = new Set();
  sections.forEach((section) => {
    const titleKey = normalizeSectionTitleForId(section.title ?? "");
    const candidates = titleOnlyIndexMap.get(titleKey) ?? [];
    const targetIndex = candidates.find((idx) => !usedTitleOnlyIndexes.has(idx));
    if (!Number.isInteger(targetIndex)) return;
    const current = result[targetIndex];
    result[targetIndex] = {
      ...current,
      section_id: section.id,
      section_title: section.title,
      section_index: section.index
    };
    usedTitleOnlyIndexes.add(targetIndex);
  });

  const usedIds = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  const existingSectionKeys = new Set(
    result.map((segment) =>
      getSectionKeyFromMeta({
        section_id: segment.section_id ?? null,
        section_title: segment.section_title ?? null
      })
    )
  );

  sections.forEach((section) => {
    const sectionKey = getSectionKeyFromMeta({
      section_id: section.id,
      section_title: section.title
    });
    if (existingSectionKeys.has(sectionKey)) return;

    const placeholder = {
      segment_id: buildEmptyTopicSegmentId(section, usedIds),
      block_type: "news",
      text_quote: "",
      section_id: section.id,
      section_title: section.title,
      section_index: section.index,
      visual_decision: emptyVisualDecision(),
      search_decision: emptySearchDecision(),
      search_open: false,
      is_done: false,
      segment_status: "new"
    };

    const insertAt = result.findIndex((segment) => {
      const idx = Number(segment?.section_index);
      return Number.isFinite(idx) && idx > section.index;
    });
    if (insertAt === -1) {
      result.push(placeholder);
    } else {
      result.splice(insertAt, 0, placeholder);
    }
    existingSectionKeys.add(sectionKey);
  });

  return result;
};
const assignSectionsByIndex = (segments, sections, options = {}) => {
  if (!sections.length || !segments.length) return segments;
  const override = Boolean(options.override);
  const missingCount = override
    ? segments.filter((segment) => segment.block_type !== "links").length
    : segments.reduce((count, segment) => {
        if (segment.block_type === "links") return count;
        return segment.section_title ? count : count + 1;
      }, 0);
  if (!override && missingCount === 0) return segments;
  let assignedIndex = 0;
  const totalSlots = Math.max(1, missingCount);
  return segments.map((segment) => {
    if (segment.block_type === "links") return segment;
    if (!override && segment.section_title) return segment;
    const ratio = assignedIndex / totalSlots;
    const sectionIndex = Math.min(sections.length - 1, Math.floor(ratio * sections.length));
    const section = sections[sectionIndex];
    assignedIndex += 1;
    return {
      ...segment,
      section_id: section.id,
      section_title: section.title,
      section_index: section.index
    };
  });
};
const applySectionsFromScript = (segments, scriptText) => {
  const sections = parseScriptSections(scriptText);
  if (sections.length === 0) return segments;
  const titleCounts = new Map();
  sections.forEach((section) => {
    const key = section.title.trim();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  });
  const titleIndex = new Map();
  sections.forEach((section) => {
    const key = section.title.trim();
    if (titleCounts.get(key) === 1) {
      titleIndex.set(key, section);
    }
  });
  const normalizedText = normalizeLineBreaks(scriptText);
  let cursor = 0;
  let matchCount = 0;
  const mapped = segments.map((segment) => {
    const titleKey = segment.section_title ? segment.section_title.trim() : "";
    const titleMatch = titleKey ? titleIndex.get(titleKey) : null;
    if (segment.block_type === "links") {
      if (!titleMatch) return segment;
      return {
        ...segment,
        section_id: titleMatch.id,
        section_title: titleMatch.title,
        section_index: titleMatch.index
      };
    }
    if (titleMatch) {
      matchCount += 1;
      return {
        ...segment,
        section_id: titleMatch.id,
        section_title: titleMatch.title,
        section_index: titleMatch.index
      };
    }
    const quote = normalizeLineBreaks(segment.text_quote ?? "");
    let index = -1;
    if (quote) {
      index = normalizedText.indexOf(quote, cursor);
      if (index === -1) index = normalizedText.indexOf(quote);
    }
    if (index !== -1) {
      matchCount += 1;
      cursor = index + quote.length;
    }
    let selected = null;
    if (index !== -1) {
      for (const section of sections) {
        if (index >= section.start && index < section.end) {
          selected = section;
        }
      }
    } else {
      for (const section of sections) {
        if (cursor >= section.start) selected = section;
      }
    }
    if (!selected) return segment;
    return {
      ...segment,
      section_id: selected.id,
      section_title: selected.title,
      section_index: selected.index
    };
  });
  const matchRatio = segments.length ? matchCount / segments.length : 0;
  if (matchRatio < 0.25) {
    return assignSectionsByIndex(mapped, sections, { override: true });
  }
  return assignSectionsByIndex(mapped, sections);
};
const emptySegment = (index, section = {}) => ({
  segment_id: `custom_${String(index).padStart(2, "0")}`,
  block_type: "news",
  text_quote: "",
  section_id: section.section_id ?? null,
  section_title: section.section_title ?? null,
  section_index: section.section_index ?? null,
  research_use_topic_title: Boolean(section?.research_use_topic_title),
  research_use_theme_tags: Boolean(section?.research_use_theme_tags),
  topic_tags: normalizeSegmentTagList(section.topic_tags ?? section.section_tags ?? []),
  section_tags: normalizeSegmentTagList(section.section_tags ?? section.topic_tags ?? []),
  visual_decision: emptyVisualDecision(),
  search_decision: emptySearchDecision(),
  search_open: false,
  is_done: false
});
const GROUP_RENDER_CHUNK = 20;
const getSegmentGroupKey = (segment) => getSectionKeyFromMeta(segment);
const getSegmentGroupTitle = (segment) => {
  const title = normalizeTopicTitleForDisplay(segment.section_title ?? "");
  return title || "\u0411\u0435\u0437 \u0442\u0435\u043c\u044b";
};
const normalizeCommentAnchorBase = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
const resolveCommentAnchorSegmentId = (segment, segments = []) => {
  if (!isCommentsSegment(segment)) return "";
  const raw = String(segment?.segment_id ?? "").trim().replace(/^comments_/i, "");
  if (!raw) return "";
  let bestId = "";
  let bestLength = -1;
  segments.forEach((candidate) => {
    if (!candidate || isCommentsSegment(candidate) || normalizeSegmentBlockType(candidate?.block_type) === "links") return;
    const candidateId = String(candidate?.segment_id ?? "").trim();
    const normalizedCandidate = normalizeCommentAnchorBase(candidateId);
    if (!normalizedCandidate) return;
    if (raw === normalizedCandidate || raw.startsWith(`${normalizedCandidate}_`)) {
      if (normalizedCandidate.length > bestLength) {
        bestId = candidateId;
        bestLength = normalizedCandidate.length;
      }
    }
  });
  return bestId;
};
const getScenarioSegmentOrder = (segment, fallbackIndex = Number.MAX_SAFE_INTEGER, anchorOrder = null) => {
  const sectionIndex = Number.isFinite(Number(segment?.section_index))
    ? Number(segment.section_index)
    : Number.MAX_SAFE_INTEGER;
  const blockType = normalizeSegmentBlockType(segment?.block_type);
  const linksRank = blockType === "links" ? -1 : 0;
  const segmentId = String(anchorOrder?.segmentId ?? segment?.segment_id ?? "").trim();
  const numericSuffixMatch = segmentId.match(/_(\d{1,4})$/);
  const numericSuffix = numericSuffixMatch ? Number.parseInt(numericSuffixMatch[1], 10) : Number.MAX_SAFE_INTEGER;
  const commentRank = anchorOrder ? -1 : 0;
  const effectiveSectionIndex = anchorOrder?.sectionIndex ?? sectionIndex;
  return { sectionIndex: effectiveSectionIndex, linksRank, numericSuffix, commentRank, fallbackIndex };
};
const sortSegmentsInScenarioOrder = (segments = []) =>
  (() => {
    const list = Array.isArray(segments) ? segments : [];
    const baseOrders = new Map(
      list.map((segment, index) => [String(segment?.segment_id ?? "").trim(), getScenarioSegmentOrder(segment, index)])
    );
    return list
      .map((segment, index) => {
        const anchorSegmentId = resolveCommentAnchorSegmentId(segment, list);
        const anchorOrder = anchorSegmentId ? baseOrders.get(anchorSegmentId) ?? null : null;
        return { segment, index, order: getScenarioSegmentOrder(segment, index, anchorOrder) };
      })
    .sort((left, right) => {
      if (left.order.sectionIndex !== right.order.sectionIndex) {
        return left.order.sectionIndex - right.order.sectionIndex;
      }
      if (left.order.linksRank !== right.order.linksRank) {
        return left.order.linksRank - right.order.linksRank;
      }
      if (left.order.commentRank !== right.order.commentRank) {
        return left.order.commentRank - right.order.commentRank;
      }
      if (left.order.numericSuffix !== right.order.numericSuffix) {
        return left.order.numericSuffix - right.order.numericSuffix;
      }
      return left.order.fallbackIndex - right.order.fallbackIndex;
    })
      .map((item) => item.segment);
  })();
const getSubSegmentBaseId = (segmentId) => {
  const value = String(segmentId ?? "");
  const parts = value.split("_");
  if (parts.length >= 3 && /^\d{2}$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join("_");
  }
  return value;
};
const getNextSubSegmentId = (segments, baseId) => {
  const prefix = `${baseId}_`;
  let max = 0;
  segments.forEach((segment) => {
    const id = String(segment.segment_id ?? "");
    if (!id.startsWith(prefix)) return;
    const suffix = id.slice(prefix.length);
    if (!/^\d{2}$/.test(suffix)) return;
    const value = Number.parseInt(suffix, 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  });
  let next = max + 1;
  let candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  const existing = new Set(segments.map((segment) => String(segment.segment_id ?? "")));
  while (existing.has(candidate)) {
    next += 1;
    candidate = `${baseId}_${String(next).padStart(2, "0")}`;
  }
  return candidate;
};
const collectScenarioLinks = (segments = []) => {
  const seen = new Set();
  const result = [];
  segments.forEach((segment) => {
    if (segment?.block_type !== "links") return;
    const sectionTitle = getSegmentGroupTitle(segment);
    (segment.links ?? []).forEach((link) => {
      const url = normalizeLinkUrl(link?.url ?? link ?? "");
      const key = canonicalizeLinkUrl(url);
      if (!url || !key || seen.has(key)) return;
      seen.add(key);
      result.push({
        url,
        sectionTitle,
        segmentId: segment.segment_id
      });
    });
  });
  return result;
};
const collectSegmentsNeedingVisual = (segments = []) => {
  const result = [];
  segments.forEach((segment) => {
    const blockType = String(segment?.block_type ?? "").trim().toLowerCase();
    if (!segment || blockType === "links" || isCommentsSegment(segment) || Boolean(segment?.is_topic_research_anchor)) return;
    if (hasVisualDecisionContent(segment.visual_decision)) return;
    const links = dedupeLinks(segment.links ?? []).map((item) => normalizeLinkUrl(item?.url ?? item ?? "")).filter(Boolean);
    result.push({
      segmentId: segment.segment_id,
      sectionTitle: getSegmentGroupTitle(segment),
      quote: getQuotePreview(segment.text_quote, 140),
      links,
      isDone: Boolean(segment.is_done)
    });
  });
  return result;
};
const LinksCard = React.memo(function LinksCard({
  segment,
  index,
  onLinkAdd,
  onLinkUpdate,
  onLinkRemove,
  onDownload,
  onOpenScreenshotLab,
  isDownloadBusy,
  isDownloadSupported,
  isDownloaded
}) {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState({});
  const [editing, setEditing] = useState({});
  const [screenshotMode, setScreenshotMode] = useState({});

  const setScreenshotPreviewState = React.useCallback((url) => {
    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl) return;
    const key = canonicalizeLinkUrl(normalizedUrl) || normalizedUrl;
    const host = getUrlHost(normalizedUrl);
    setPreviews((prev) => ({
      ...prev,
      [key]: {
        loading: false,
        loaded: true,
        title: getReadableLinkLabel(normalizedUrl) || host || normalizedUrl,
        description: "",
        image: buildScreenshotPreviewImageSrc(normalizedUrl),
        siteName: host || normalizedUrl
      }
    }));
  }, []);

  const toggleScreenshotMode = React.useCallback((url) => {
    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl) return;
    const key = canonicalizeLinkUrl(normalizedUrl) || normalizedUrl;
    const currentlyEnabled = Boolean(screenshotMode[key]);
    if (currentlyEnabled) {
      setScreenshotMode((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setScreenshotMode((prev) => ({ ...prev, [key]: true }));
    setScreenshotPreviewState(normalizedUrl);
  }, [screenshotMode, setScreenshotPreviewState]);

  const openScreenshotLab = React.useCallback(() => {
    if (typeof onOpenScreenshotLab === "function") {
      onOpenScreenshotLab(segment);
      return;
    }
    const urls = (segment.links ?? []).map((item) => normalizeLinkUrl(item?.url ?? "")).filter(Boolean).join("\n");
    const query = urls ? `?urls=${encodeURIComponent(urls)}` : "";
    window.open(`/tools/screenshot-lab${query}`, "_blank", "noopener,noreferrer");
  }, [onOpenScreenshotLab, segment]);

  useEffect(() => {
    if (!open) return;
    const links = segment.links ?? [];
    links.forEach((link) => {
      const url = normalizeLinkUrl(link?.url ?? "");
      if (!url) return;
      const key = canonicalizeLinkUrl(url) || url;
      if (screenshotMode[key]) {
        if (!previews[key]?.image) {
          setScreenshotPreviewState(url);
        }
        return;
      }
      if (previews[key]?.loading || previews[key]?.loaded || previews[key]?.error) return;
      setPreviews((prev) => ({ ...prev, [key]: { loading: true } }));
      fetchJsonSafe(`/api/link/preview?url=${encodeURIComponent(url)}`)
        .then(({ response, data }) => {
          if (!response.ok) throw new Error("preview_failed");
          setPreviews((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              loaded: true,
              title: data?.title ?? "",
              description: data?.description ?? "",
              image: data?.image ?? "",
              siteName: data?.siteName ?? ""
            }
          }));
        })
        .catch(() => {
          setPreviews((prev) => ({ ...prev, [key]: { loading: false, loaded: true, error: true } }));
        });
    });
  }, [open, previews, screenshotMode, segment.links, setScreenshotPreviewState]);
  return (
    <article className="segment-card links-card">
      <div className="segment-head">
        <div>
          <label>{"\u0421\u0441\u044b\u043b\u043a\u0438"}</label>
          <div className="links-meta">
            <span>
              {(segment.links ?? []).length}{" "}{"\u0441\u0441\u044b\u043b\u043e\u043a"}
            </span>
          </div>
        </div>
        <div className="segment-head-actions">
          <button
            className="btn ghost icon-round"
            type="button"
            onClick={openScreenshotLab}
            title="Screenshot Lab"
            aria-label="Screenshot Lab"
          >
            📸
          </button>
          <button
            className="btn ghost icon-round"
            type="button"
            onClick={() => onLinkAdd(index)}
            title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
            aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
          >
            +
          </button>
          <button
            className="btn ghost icon-round"
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            title={open ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
            aria-label={open ? "\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c"}
          >
            {open ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 15l6-6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
      {open ? (
        <div className="links-list">
          {(segment.links ?? []).length === 0 ? (
            <div className="links-empty">{"\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443."}</div>
          ) : null}
          {(segment.links ?? []).map((link, linkIndex) => {
            const url = normalizeLinkUrl(link?.url ?? "");
            const sectionTitle = getSegmentGroupTitle(segment);
            const previewKey = canonicalizeLinkUrl(url) || url;
            const preview = url ? previews[previewKey] : null;
            const isScreenshotPreview = Boolean(url && screenshotMode[previewKey]);
            const host = getUrlHost(url);
            const linkLabel = getReadableLinkLabel(url);
            const isEditing = Boolean(editing[linkIndex]);
            const alreadyDownloaded =
              typeof isDownloaded === "function" ? isDownloaded(url) : false;
            const canDownload =
              alreadyDownloaded ||
              (typeof isDownloadSupported === "function" ? isDownloadSupported(url) : false);
            const openUrl = () => {
              if (!url) return;
              window.open(url, "_blank", "noopener,noreferrer");
            };
            return (
              <div key={`${url}-${linkIndex}`} className="link-item link-telegram">
                <div className="link-header">
                  <div
                    className="link-url"
                    role="button"
                    tabIndex={0}
                    onClick={openUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openUrl();
                      }
                    }}
                    title={linkLabel || url}
                  >
                    {linkLabel || "-"}
                  </div>
                  <div className="link-actions">
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() =>
                        setEditing((prev) => ({ ...prev, [linkIndex]: !prev[linkIndex] }))
                      }
                      title={isEditing ? "\u0421\u043a\u0440\u044b\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435" : "\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                      aria-label={"\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={openUrl}
                      title={"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      aria-label={"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      disabled={!url}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 14L20 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 14v6H4V4h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    {canDownload ? (
                      alreadyDownloaded ? (
                        <button
                          className="btn small ghost"
                          type="button"
                          disabled
                          title="\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0441\u043a\u0430\u0447\u0430\u043d\u0430"
                          aria-label="\u0421\u0441\u044b\u043b\u043a\u0430 \u0443\u0436\u0435 \u0441\u043a\u0430\u0447\u0430\u043d\u0430"
                        >
                          {"\u0421\u043a\u0430\u0447\u0430\u043d\u043e"}
                        </button>
                      ) : (
                        <button
                          className="btn small ghost"
                          type="button"
                          onClick={() => onDownload?.(url, sectionTitle)}
                          title="\u0421\u043a\u0430\u0447\u0430\u0442\u044c \u043c\u0435\u0434\u0438\u0430"
                          aria-label="\u0421\u043a\u0430\u0447\u0430\u0442\u044c \u043c\u0435\u0434\u0438\u0430"
                          disabled={!url || (typeof isDownloadBusy === "function" && isDownloadBusy(url))}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M7 11l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        </button>
                      )
                    ) : null}
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() => toggleScreenshotMode(url)}
                      title={
                        isScreenshotPreview
                          ? "\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u043e\u0431\u044b\u0447\u043d\u043e\u0435 \u043f\u0440\u0435\u0432\u044c\u044e"
                          : "\u0421\u0434\u0435\u043b\u0430\u0442\u044c \u0441\u043a\u0440\u0438\u043d\u0448\u043e\u0442 \u0432\u043c\u0435\u0441\u0442\u043e \u043f\u0440\u0435\u0432\u044c\u044e"
                      }
                      aria-label="\u0421\u043a\u0440\u0438\u043d\u0448\u043e\u0442"
                      disabled={!url}
                    >
                      📸
                    </button>
                    <button
                      className="btn small ghost"
                      type="button"
                      onClick={() => onLinkRemove(index, linkIndex)}
                      title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                      aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0441\u044b\u043b\u043a\u0443"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="link-row">
                    <input
                      value={link?.url ?? ""}
                      placeholder="https://example.com"
                      onChange={(event) => onLinkUpdate(index, linkIndex, event.target.value)}
                      onBlur={(event) =>
                        onLinkUpdate(index, linkIndex, normalizeLinkUrl(event.target.value))
                      }
                    />
                  </div>
                ) : null}
                {url ? (
                  <div
                    className={`link-preview link-preview-telegram${preview?.image ? " has-image" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={openUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openUrl();
                      }
                    }}
                  >
                    {preview?.loading ? (
                      <span className="muted">{"\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043f\u0440\u0435\u0432\u044c\u044e\u2026"}</span>
                    ) : preview?.error ? (
                      <span className="muted">{"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0440\u0435\u0432\u044c\u044e."}</span>
                    ) : preview?.title || preview?.description || preview?.image ? (
                      <>
                        <div className="link-preview-text">
                          <strong>{preview?.title || host || url}</strong>
                          {preview?.description ? <p>{preview.description}</p> : null}
                          <div className="muted">{preview?.siteName || host || url}</div>
                        </div>
                        {preview?.image ? (
                          <div className="link-preview-image">
                            <img
                              src={getPreviewImageSrc(preview.image)}
                              alt={preview.title || "preview"}
                              onError={(event) => {
                                const img = event.currentTarget;
                                if (isScreenshotPreview) {
                                  img.style.display = "none";
                                  return;
                                }
                                if (img.dataset.fallbackApplied === "1") {
                                  img.style.display = "none";
                                  return;
                                }
                                img.dataset.fallbackApplied = "1";
                                const screenshotFallback = buildScreenshotPreviewImageSrc(url);
                                if (screenshotFallback) {
                                  img.src = screenshotFallback;
                                  return;
                                }
                                img.style.display = "none";
                              }}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="link-preview-text">
                        <strong>{host || url}</strong>
                        <div className="muted">{linkLabel || url}</div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
});
const MediaTimecodeRow = React.memo(function MediaTimecodeRow({ mediaPath, value, onChange }) {
  const [timecodeDraft, setTimecodeDraft] = React.useState(() =>
    splitTimecodeToParts(value, TIMECODE_EDIT_FPS)
  );
  const [focusedTimecodePart, setFocusedTimecodePart] = React.useState(null);
  const timecodeInputRefs = React.useRef([]);

  React.useEffect(() => {
    setTimecodeDraft(splitTimecodeToParts(value, TIMECODE_EDIT_FPS));
  }, [mediaPath, value]);

  const updateTimecodePart = React.useCallback((partName, rawValue, partIndex) => {
    const digits = String(rawValue ?? "").replace(/\D/g, "").slice(0, 2);
    const nextParts = { ...timecodeDraft, [partName]: digits };
    setTimecodeDraft(nextParts);
    onChange(partsToTimecode(nextParts, TIMECODE_EDIT_FPS));
    if (digits.length >= 2 && partIndex < 2) {
      window.setTimeout(() => {
        const nextInput = timecodeInputRefs.current[partIndex + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 0);
    }
  }, [onChange, timecodeDraft]);

  const handleTimecodePartFocus = React.useCallback((event) => {
    event.currentTarget.select();
  }, []);

  const handleTimecodePartBlur = React.useCallback(() => {
    setFocusedTimecodePart(null);
  }, []);

  const getTimecodeDisplayValue = React.useCallback((partName, partIndex) => {
    const raw = String(timecodeDraft?.[partName] ?? "");
    if (focusedTimecodePart === partIndex) return raw;
    if (!raw) return "00";
    return raw.padStart(2, "0").slice(-2);
  }, [focusedTimecodePart, timecodeDraft]);

  const mediaName = String(mediaPath ?? "").split("/").pop() || mediaPath;

  return (
    <div className="segment-media-timecode-row">
      <span className="segment-media-timecode-name" title={mediaPath}>
        {mediaName}
      </span>
      <div className="timecode-split-input" role="group" aria-label={`timecode-${mediaName}`}>
        {["hh", "mm", "ss"].map((partName, partIndex) => (
          <React.Fragment key={`${mediaPath}-${partName}`}>
            <input
              ref={(node) => {
                timecodeInputRefs.current[partIndex] = node;
              }}
              className="timecode-part-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              value={getTimecodeDisplayValue(partName, partIndex)}
              onFocus={(event) => {
                setFocusedTimecodePart(partIndex);
                handleTimecodePartFocus(event);
              }}
              onBlur={handleTimecodePartBlur}
              onChange={(event) => updateTimecodePart(partName, event.target.value, partIndex)}
              aria-label={`${mediaName}-${partName.toUpperCase()}`}
            />
            {partIndex < 2 ? <span className="timecode-separator">:</span> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});
const LegacySegmentCard = React.memo(function LegacySegmentCard({
  segment,
  index,
  animationIndex = 0,
  config,
  docId,
  mediaFiles,
  onUpdate,
  onVisualUpdate,
  onSearchUpdate,
  onQuoteChange,
  onInsertAfter,
  onRemove,
  onClearSearch,
  onSearchGenerate,
  searchLoading,
  onSearchToggle,
  onSearch,
  researchRun,
  researchHistory,
  researchLoading,
  onResearchRun,
  onResearchSelectRun,
  onResearchApply,
  onResearchPromoteBundle,
  onResearchCopyBrief,
  linkedReleaseInfo,
  linkedReleaseSnapshot,
  onOpenLinkedRelease,
  onOpenLinkedReleaseHandoff,
  onUseLinkedReleasePrimary,
  onPromoteLinkedReleasePrimaryPair,
  onPromoteLinkedReleaseBackupPair,
  onUseLinkedReleaseBackup,
  onCopy,
  onDoneToggle
}) {
  const getResearchResultPhase = React.useCallback((result) => {
    const phase = String(result?.phase ?? result?.kind ?? "").trim().toLowerCase();
    return phase || "general";
  }, []);
  const queriesValue = (segment.search_decision?.queries ?? []).join("\n");
  const queryItems = (segment.search_decision?.queries ?? []).filter(
    (query) => String(query ?? "").trim().length > 0
  );
  const [mediaFilter, setMediaFilter] = React.useState("");
  const [researchView, setResearchView] = React.useState("all");
  const [researchPhaseFilter, setResearchPhaseFilter] = React.useState("all");
  const [researchRoleFilter, setResearchRoleFilter] = React.useState("all");
  const [researchCompareIds, setResearchCompareIds] = React.useState([]);
  const selectedMediaPaths = normalizeMediaFilePathList(
    segment.visual_decision?.media_file_paths ?? segment.visual_decision?.media_file_path ?? null
  );
  const primarySelectedMediaPath = selectedMediaPaths[0] ?? null;
  const mediaFileUrl = buildMediaFileUrl(docId, primarySelectedMediaPath);
  const selectedVideoPaths = selectedMediaPaths.filter((mediaPath) => isVideoMediaPath(mediaPath));
  const mediaFileTimecodes = normalizeMediaFileTimecodes(
    segment.visual_decision?.media_file_timecodes ?? null,
    selectedMediaPaths
  );
  const mediaFileList = Array.isArray(mediaFiles) ? mediaFiles : [];
  const mediaTopicFolder = sanitizeMediaTopicName(segment.section_title ?? "");
  const topicMediaFiles = mediaFileList.filter((file) => getMediaFileTopicFolder(file.path) === mediaTopicFolder);
  const mediaFileOptions = topicMediaFiles;
  const hasTopicFiles = mediaFileOptions.length > 0;
  const normalizedMediaFilter = mediaFilter.trim().toLowerCase();
  const filteredMediaFileOptions = React.useMemo(() => {
    if (!normalizedMediaFilter) return mediaFileOptions;
    return mediaFileOptions.filter((file) =>
      `${file.name} ${file.path}`.toLowerCase().includes(normalizedMediaFilter)
    );
  }, [mediaFileOptions, normalizedMediaFilter]);
  const mediaVisibleLimit = 10;
  const researchResults = React.useMemo(() => {
    const resultMap = new Map(
      (Array.isArray(researchRun?.results) ? researchRun.results : [])
        .map((item) => [String(item?.id ?? ""), item])
        .filter(([id]) => Boolean(id))
    );
    return (Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results : [])
      .map((ranked) => ({
        ranked,
        result: resultMap.get(String(ranked?.result_id ?? "")) ?? null
      }))
      .filter((item) => item.result)
      .slice(0, 12);
  }, [researchRun]);
  const researchBuckets = React.useMemo(() => buildResearchCategoryBuckets(researchResults), [researchResults]);
  const researchViewTabs = React.useMemo(
    () => [
      { id: "all", label: RESEARCH_CATEGORY_LABELS.all, count: researchBuckets.all.length },
      ...RESEARCH_CATEGORY_ORDER.map((categoryId) => ({
        id: categoryId,
        label: RESEARCH_CATEGORY_LABELS[categoryId],
        count: researchBuckets[categoryId]?.length ?? 0
      }))
    ],
    [researchBuckets]
  );
  const researchRoleTabs = React.useMemo(() => {
    const counts = {
      all: researchResults.length,
      main_source: 0,
      backup_source: 0,
      visual_candidate: 0,
      reference: 0
    };
    researchResults.forEach(({ ranked }) => {
      const role = inferResearchCandidateRole(segment, ranked);
      if (Object.prototype.hasOwnProperty.call(counts, role)) {
        counts[role] += 1;
      }
    });
    return [
      { id: "all", label: "Any Role", count: counts.all },
      { id: "main_source", label: "Main Source", count: counts.main_source },
      { id: "backup_source", label: "Backup", count: counts.backup_source },
      { id: "visual_candidate", label: "Visual", count: counts.visual_candidate },
      { id: "reference", label: "Reference", count: counts.reference }
    ];
  }, [researchResults, segment]);
  const researchPhaseTabs = React.useMemo(() => {
    const counts = {
      all: researchResults.length,
      context: 0,
      source: 0,
      visual: 0,
      general: 0
    };
    researchResults.forEach(({ result }) => {
      const phase = getResearchResultPhase(result);
      if (Object.prototype.hasOwnProperty.call(counts, phase)) {
        counts[phase] += 1;
      } else {
        counts.general += 1;
      }
    });
    return [
      { id: "all", label: "All Phases", count: counts.all },
      { id: "context", label: "Context", count: counts.context },
      { id: "source", label: "Source Pass", count: counts.source },
      { id: "visual", label: "Visual Pass", count: counts.visual }
    ].filter((item) => item.id === "all" || item.count > 0);
  }, [getResearchResultPhase, researchResults]);
  const visibleResearchResults = React.useMemo(() => {
    const nextItems = researchBuckets[researchView] ?? researchBuckets.all;
    const scopedItems = Array.isArray(nextItems) && nextItems.length > 0 ? nextItems : researchBuckets.all;
    const phaseScoped =
      researchPhaseFilter === "all"
        ? scopedItems
        : scopedItems.filter(({ result }) => getResearchResultPhase(result) === researchPhaseFilter);
    if (researchRoleFilter === "all") return phaseScoped;
    return phaseScoped.filter(({ ranked }) => inferResearchCandidateRole(segment, ranked) === researchRoleFilter);
  }, [getResearchResultPhase, researchBuckets, researchPhaseFilter, researchRoleFilter, researchView, segment]);
  const bestSourceCandidate = [...researchResults]
    .sort(
      (a, b) =>
        Number(b?.ranked?.source_score ?? 0) - Number(a?.ranked?.source_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.result ?? null;
  const bestVisualCandidate = [...researchResults]
    .filter((item) => {
      const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
      return (
        hints.length > 0 ||
        Number(item?.ranked?.montage_score ?? 0) >= 0.55 ||
        Number(item?.ranked?.visual_score ?? 0) >= 0.58
      );
    })
    .sort(
      (a, b) =>
        Number(b?.ranked?.montage_score ?? b?.ranked?.visual_score ?? 0) -
          Number(a?.ranked?.montage_score ?? a?.ranked?.visual_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.result ?? null;
  const bestDownloadableCandidate = [...researchResults]
    .filter((item) => {
      const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
      return hints.includes("downloadable") || Number(item?.ranked?.downloadability_score ?? 0) >= 0.62;
    })
    .sort(
      (a, b) =>
        Number(b?.ranked?.downloadability_score ?? 0) - Number(a?.ranked?.downloadability_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.result ?? null;
  const bestVisibleCandidate = visibleResearchResults[0]?.result ?? null;
  const bestContextPhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "context")?.result ?? null;
  const bestSourcePhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "source")?.result ?? null;
  const bestVisualPhaseCandidate =
    researchResults.find(({ result }) => getResearchResultPhase(result) === "visual")?.result ?? null;
  const bestSourceRanked = [...researchResults]
    .sort(
      (a, b) =>
        Number(b?.ranked?.source_score ?? 0) - Number(a?.ranked?.source_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.ranked ?? null;
  const bestVisualRanked = [...researchResults]
    .filter((item) => {
      const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
      return (
        hints.length > 0 ||
        Number(item?.ranked?.montage_score ?? 0) >= 0.55 ||
        Number(item?.ranked?.visual_score ?? 0) >= 0.58
      );
    })
    .sort(
      (a, b) =>
        Number(b?.ranked?.montage_score ?? b?.ranked?.visual_score ?? 0) -
          Number(a?.ranked?.montage_score ?? a?.ranked?.visual_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.ranked ?? null;
  const bestDownloadableRanked = [...researchResults]
    .filter((item) => {
      const hints = Array.isArray(item?.ranked?.visual_hints) ? item.ranked.visual_hints : [];
      return hints.includes("downloadable") || Number(item?.ranked?.downloadability_score ?? 0) >= 0.62;
    })
    .sort(
      (a, b) =>
        Number(b?.ranked?.downloadability_score ?? 0) - Number(a?.ranked?.downloadability_score ?? 0) ||
        Number(b?.ranked?.total_score ?? 0) - Number(a?.ranked?.total_score ?? 0)
    )[0]?.ranked ?? null;
  const deepResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "source"
      ) ?? null,
    [researchRun]
  );
  const deepResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "visual"
      ) ?? null,
    [researchRun]
  );
  const deepResearchPairReady = Boolean(
    researchRun?.mode === "deep" &&
    String(deepResearchSourceItem?.result_id ?? "").trim() &&
    String(deepResearchVisualItem?.result_id ?? "").trim()
  );
  const promotedResearchPair = React.useMemo(
    () => normalizeResearchBundleTrace(segment?.research_bundle_trace),
    [segment]
  );
  const primaryResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "source" || role === "main_source";
      }) ?? null,
    [researchRun]
  );
  const primaryResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "visual" || (role === "visual_candidate" && key !== "backup_visual");
      }) ?? null,
    [researchRun]
  );
  const backupResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "backup_source" || role === "backup_source";
      }) ?? null,
    [researchRun]
  );
  const backupResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        return key === "backup_visual";
      }) ?? null,
    [researchRun]
  );
  const currentSegmentResearchPair = React.useMemo(
    () =>
      deriveSegmentResearchCurrentPair(promotedResearchPair, {
        primarySource: primaryResearchSourceItem,
        primaryVisual: primaryResearchVisualItem,
        backupSource: backupResearchSourceItem,
        backupVisual: backupResearchVisualItem
      }),
    [
      backupResearchSourceItem,
      backupResearchVisualItem,
      primaryResearchSourceItem,
      primaryResearchVisualItem,
      promotedResearchPair
    ]
  );
  const primaryResearchSourceResultId = String(primaryResearchSourceItem?.result_id ?? "").trim();
  const primaryResearchVisualResultId = String(primaryResearchVisualItem?.result_id ?? "").trim();
  const backupResearchSourceResultId = String(backupResearchSourceItem?.result_id ?? "").trim();
  const backupResearchVisualResultId = String(backupResearchVisualItem?.result_id ?? "").trim();
  const researchBriefItems = React.useMemo(
    () =>
      Array.isArray(researchRun?.brief?.items) && researchRun.brief.items.length > 0
        ? [
            ...researchRun.brief.items,
            ...(Array.isArray(researchRun?.brief?.phase_items) ? researchRun.brief.phase_items : [])
          ]
        : [
        bestSourceCandidate
          ? {
              key: "source",
              label: "Main Source",
              title: bestSourceCandidate.title || bestSourceCandidate.url,
              domain: bestSourceCandidate.domain || "source",
              score: Number(bestSourceRanked?.source_score ?? bestSourceRanked?.total_score ?? 0),
              role: inferResearchCandidateRole(segment, bestSourceRanked)
            }
          : null,
        bestVisualCandidate
          ? {
              key: "visual",
              label: "Main Visual",
              title: bestVisualCandidate.title || bestVisualCandidate.url,
              domain: bestVisualCandidate.domain || "source",
              score: Number(bestVisualRanked?.montage_score ?? bestVisualRanked?.visual_score ?? bestVisualRanked?.total_score ?? 0),
              role: inferResearchCandidateRole(segment, bestVisualRanked)
            }
          : null,
        bestDownloadableCandidate
          ? {
              key: "download",
              label: "Best Download",
              title: bestDownloadableCandidate.title || bestDownloadableCandidate.url,
              domain: bestDownloadableCandidate.domain || "source",
              score: Number(bestDownloadableRanked?.downloadability_score ?? bestDownloadableRanked?.total_score ?? 0),
              role: inferResearchCandidateRole(segment, bestDownloadableRanked)
            }
          : null
      ].filter(Boolean),
    [
      bestDownloadableCandidate,
      bestDownloadableRanked,
      bestSourceCandidate,
      bestSourceRanked,
      bestVisualCandidate,
      bestVisualRanked,
      researchRun,
      segment
    ]
  );
  const researchCompareItems = React.useMemo(() => {
    if (!researchCompareIds.length) return [];
    const itemMap = new Map(
      researchResults.map((item) => [String(item?.result?.id ?? "").trim(), item]).filter(([id]) => Boolean(id))
    );
    return researchCompareIds
      .map((id) => itemMap.get(String(id ?? "").trim()) ?? null)
      .filter(Boolean)
      .slice(0, 3);
  }, [researchCompareIds, researchResults]);
  const researchHistoryItems = React.useMemo(
    () => (Array.isArray(researchHistory) ? researchHistory : []).slice(0, 8),
    [researchHistory]
  );
  const researchPhaseSummary = React.useMemo(
    () =>
      (Array.isArray(researchRun?.summary?.phases) ? researchRun.summary.phases : [])
        .map((item) => {
          const phase = String(item?.phase ?? "").trim();
          const resultCount = Number(item?.result_count ?? 0);
          if (!phase || resultCount <= 0) return "";
          return `${phase}:${resultCount}`;
        })
        .filter(Boolean)
        .join(" · "),
    [researchRun]
  );
  const researchPhaseActionHints = React.useMemo(() => {
    return (Array.isArray(researchRun?.summary?.phases) ? researchRun.summary.phases : [])
      .map((item) => {
        const phase = String(item?.phase ?? "").trim().toLowerCase();
        const resultCount = Number(item?.result_count ?? 0);
        if (!phase || resultCount <= 0) return null;
        if (phase === "source") {
          return {
            phase,
            label: "Source Pass",
            action: "promote source",
            detail: `${resultCount} result(s)`
          };
        }
        if (phase === "visual") {
          return {
            phase,
            label: "Visual Pass",
            action: "promote visual",
            detail: `${resultCount} result(s)`
          };
        }
        if (phase === "context") {
          return {
            phase,
            label: "Context Pass",
            action: "attach context",
            detail: `${resultCount} result(s)`
          };
        }
        return {
          phase,
          label: phase,
          action: "review",
          detail: `${resultCount} result(s)`
        };
      })
      .filter(Boolean);
  }, [researchRun]);
  React.useEffect(() => {
    const allowedIds = new Set(researchResults.map((item) => String(item?.result?.id ?? "").trim()).filter(Boolean));
    setResearchCompareIds((prev) => prev.filter((id) => allowedIds.has(String(id ?? "").trim())).slice(0, 3));
  }, [researchResults]);
  React.useEffect(() => {
    const allowedPhases = new Set(researchPhaseTabs.map((item) => String(item?.id ?? "").trim()));
    if (!allowedPhases.has(researchPhaseFilter)) {
      setResearchPhaseFilter("all");
    }
  }, [researchPhaseFilter, researchPhaseTabs]);
  const visibleMediaFileOptions = filteredMediaFileOptions.slice(0, mediaVisibleLimit);
  const hasMoreMediaFiles = filteredMediaFileOptions.length > mediaVisibleLimit;
  const selectedMediaCount = selectedMediaPaths.length;
  const toggleMediaFileSelection = React.useCallback((mediaPath) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath) return;
    const alreadySelected = selectedMediaPaths.includes(normalizedPath);
    const nextMediaPaths = alreadySelected
      ? selectedMediaPaths.filter((item) => item !== normalizedPath)
      : [...selectedMediaPaths, normalizedPath];
    onVisualUpdate(index, { media_file_paths: nextMediaPaths });
  }, [index, onVisualUpdate, selectedMediaPaths]);
  const updateMediaFileTimecode = React.useCallback((mediaPath, rawValue) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath || !isVideoMediaPath(normalizedPath)) return;
    const normalizedTimecode = normalizeMediaStartTimecode(rawValue);
    const nextTimecodes = { ...mediaFileTimecodes };
    if (!normalizedTimecode) {
      delete nextTimecodes[normalizedPath];
    } else {
      nextTimecodes[normalizedPath] = normalizedTimecode;
    }
    onVisualUpdate(index, { media_file_timecodes: nextTimecodes });
  }, [index, mediaFileTimecodes, onVisualUpdate]);
  const isDone = Boolean(segment.is_done);
  const isCommentOnlySegment = isCommentsSegment(segment);
  const donePreview = isCommentOnlySegment
    ? (() => {
        const value = normalizeLineBreaks(segment.text_quote).trim();
        if (!value) return "\u041f\u0443\u0441\u0442\u043e";
        return value.length > 220 ? `${value.slice(0, 220).trimEnd()}...` : value;
      })()
    : getQuotePreview(segment.text_quote, 78);
  const statusBadge =
    segment.segment_status === "new"
      ? { text: "NEW", className: "badge badge-new" }
      : segment.segment_status === "changed"
        ? { text: "CHANGED", className: "badge badge-changed" }
        : null;
  if (isDone) {
    return (
      <article
        className="segment-card segment-card-done"
        style={{ animationDelay: `${animationIndex * 40}ms` }}
      >
        <div className={`segment-done-row${isCommentOnlySegment ? " segment-done-row-comments" : ""}`}>
          {!isCommentOnlySegment ? (
            <label className="done-toggle-inline" title="\u0421\u043d\u044f\u0442\u044c \u043e\u0442\u043c\u0435\u0442\u043a\u0443">
              <input
                type="checkbox"
                checked={true}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
          ) : null}
          <span className="segment-done-preview">{donePreview}</span>
        </div>
      </article>
    );
  }
  return (
    <article
      className="segment-card"
      data-segment-id={segment.segment_id}
      style={{ animationDelay: `${animationIndex * 40}ms` }}
    >
      <div className="segment-head">
        <div>
          <label>ID</label>
          <div className="segment-id-row">
            <input
              value={segment.segment_id}
              onChange={(event) => onUpdate(index, { segment_id: event.target.value })}
            />
            {statusBadge ? <span className={statusBadge.className}>{statusBadge.text}</span> : null}
          </div>
        </div>
        {!isCommentOnlySegment ? (
          <div className="segment-head-actions">
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
      <div className="segment-body">
        <label>
          {isCommentOnlySegment
            ? "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438"
            : "\u0426\u0438\u0442\u0430\u0442\u0430"}
        </label>
        <textarea
          value={segment.text_quote}
          onChange={(event) => onQuoteChange(index, event.target.value)}
        />
        {!isCommentOnlySegment ? (
          <>
        <SegmentVisualEditor
          segment={segment}
          config={config}
          index={index}
          onVisualUpdate={onVisualUpdate}
          visualTypeLabels={VISUAL_TYPE_LABELS}
          formatHintLabels={FORMAT_HINT_LABELS}
          priorityLabels={PRIORITY_LABELS}
          hasTopicFiles={hasTopicFiles}
          mediaFilter={mediaFilter}
          setMediaFilter={setMediaFilter}
          selectedMediaCount={selectedMediaCount}
          mediaFileUrl={mediaFileUrl}
          filteredMediaFileOptions={filteredMediaFileOptions}
          visibleMediaFileOptions={visibleMediaFileOptions}
          selectedMediaPaths={selectedMediaPaths}
          toggleMediaFileSelection={toggleMediaFileSelection}
          formatBytes={formatBytes}
          mediaVisibleLimit={mediaVisibleLimit}
          hasMoreMediaFiles={hasMoreMediaFiles}
          selectedVideoPaths={selectedVideoPaths}
          mediaFileTimecodes={mediaFileTimecodes}
          updateMediaFileTimecode={updateMediaFileTimecode}
          MediaTimecodeRowComponent={MediaTimecodeRow}
          normalizeMediaFilePath={normalizeMediaFilePath}
        />
        <SegmentResearchToolbar
          index={index}
          onSearchGenerate={onSearchGenerate}
          searchLoading={searchLoading}
          onSearchToggle={onSearchToggle}
          isSearchOpen={segment.search_open}
          queryItemsCount={queryItems.length}
          onResearchRun={onResearchRun}
          researchLoading={researchLoading}
        />
        {researchLoading || researchRun ? (
          <div className="segment-research-panel">
            <SegmentResearchHeader
              researchLoading={researchLoading}
              researchRun={researchRun}
              researchPhaseSummary={researchPhaseSummary}
              index={index}
              onResearchCopyBrief={onResearchCopyBrief}
              researchHistoryItems={researchHistoryItems}
              onResearchSelectRun={onResearchSelectRun}
            />
            <SegmentLinkedReleasePanel
              segmentId={segment.segment_id}
              linkedReleaseInfo={linkedReleaseInfo}
              linkedReleaseSnapshot={linkedReleaseSnapshot}
              getCurrentPairBadgeClassName={getCurrentPairBadgeClassName}
              onOpenLinkedRelease={onOpenLinkedRelease}
              onOpenLinkedReleaseHandoff={onOpenLinkedReleaseHandoff}
              onUseLinkedReleasePrimary={onUseLinkedReleasePrimary}
              onPromoteLinkedReleasePrimaryPair={onPromoteLinkedReleasePrimaryPair}
              onPromoteLinkedReleaseBackupPair={onPromoteLinkedReleaseBackupPair}
              onUseLinkedReleaseBackup={onUseLinkedReleaseBackup}
            />
            <SegmentResearchBrief
              segmentId={segment.segment_id}
              researchResultsCount={researchResults.length}
              guidance={researchRun?.summary?.guidance}
              researchPhaseActionHints={researchPhaseActionHints}
              promotedResearchPair={promotedResearchPair}
              currentSegmentResearchPair={currentSegmentResearchPair}
              getCurrentPairBadgeClassName={getCurrentPairBadgeClassName}
              researchBriefItems={researchBriefItems}
              formatSegmentResearchBriefLabel={formatSegmentResearchBriefLabel}
              formatResearchCandidateRoleLabel={formatResearchCandidateRoleLabel}
              primaryResearchSourceResultId={primaryResearchSourceResultId}
              primaryResearchVisualResultId={primaryResearchVisualResultId}
              backupResearchSourceResultId={backupResearchSourceResultId}
              backupResearchVisualResultId={backupResearchVisualResultId}
              researchLoading={researchLoading}
              index={index}
              onResearchPromoteBundle={onResearchPromoteBundle}
              onResearchApply={onResearchApply}
            />
            <SegmentResearchResultsPanel
              segment={segment}
              index={index}
              researchResults={researchResults}
              researchViewTabs={researchViewTabs}
              researchView={researchView}
              setResearchView={setResearchView}
              researchPhaseTabs={researchPhaseTabs}
              researchPhaseFilter={researchPhaseFilter}
              setResearchPhaseFilter={setResearchPhaseFilter}
              researchRoleTabs={researchRoleTabs}
              researchRoleFilter={researchRoleFilter}
              setResearchRoleFilter={setResearchRoleFilter}
              bestSourceCandidate={bestSourceCandidate}
              bestVisualCandidate={bestVisualCandidate}
              bestVisibleCandidate={bestVisibleCandidate}
              deepResearchPairReady={deepResearchPairReady}
              deepResearchSourceItem={deepResearchSourceItem}
              deepResearchVisualItem={deepResearchVisualItem}
              bestSourcePhaseCandidate={bestSourcePhaseCandidate}
              bestVisualPhaseCandidate={bestVisualPhaseCandidate}
              bestContextPhaseCandidate={bestContextPhaseCandidate}
              researchLoading={researchLoading}
              researchRun={researchRun}
              visibleResearchResults={visibleResearchResults}
              researchCompareIds={researchCompareIds}
              setResearchCompareIds={setResearchCompareIds}
              researchCompareItems={researchCompareItems}
              onResearchPromoteBundle={onResearchPromoteBundle}
              onResearchApply={onResearchApply}
              formatResearchCandidateRoleLabel={formatResearchCandidateRoleLabel}
              inferResearchCandidateRole={inferResearchCandidateRole}
              getResearchResultPhase={getResearchResultPhase}
              collectResearchMemoryBadges={collectResearchMemoryBadges}
              getVisibleResearchReasonTags={getVisibleResearchReasonTags}
            />
          </div>
        ) : null}
        {segment.search_open ? (
          <SegmentSearchQueriesPanel
            segmentId={segment.segment_id}
            index={index}
            queriesValue={queriesValue}
            queryItems={queryItems}
            searchEngines={config.searchEngines}
            maxQueries={config.searchLimits?.maxQueries}
            normalizeQueryList={normalizeQueryList}
            onSearchUpdate={onSearchUpdate}
            onSearch={onSearch}
            onCopy={onCopy}
            onClearSearch={onClearSearch}
          />
        ) : null}
          </>
        ) : null}
        {!isCommentOnlySegment ? (
          <div className="segment-tail-actions">
            <label className="done-toggle-inline segment-done-bottom-toggle" title="\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u0433\u043e\u0442\u043e\u0432\u043e">
              <input
                type="checkbox"
                checked={isDone}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});
const SegmentCard = React.memo(function SegmentCard({
  segment,
  index,
  animationIndex = 0,
  config,
  docId,
  mediaFiles,
  onUpdate,
  onVisualUpdate,
  onSearchUpdate,
  onQuoteChange,
  onInsertAfter,
  onRemove,
  onClearSearch,
  onSearchGenerate,
  searchLoading,
  onSearchToggle,
  onSearch,
  researchRun,
  researchLoading,
  onResearchRun,
  onResearchCopyBrief,
  onOpenResearchWorkspace,
  linkedReleaseInfo,
  onCopy,
  onDoneToggle
}) {
  const queriesValue = (segment.search_decision?.queries ?? []).join("\n");
  const queryItems = (segment.search_decision?.queries ?? []).filter(
    (query) => String(query ?? "").trim().length > 0
  );
  const [mediaFilter, setMediaFilter] = React.useState("");
  const selectedMediaPaths = normalizeMediaFilePathList(
    segment.visual_decision?.media_file_paths ?? segment.visual_decision?.media_file_path ?? null
  );
  const primarySelectedMediaPath = selectedMediaPaths[0] ?? null;
  const mediaFileUrl = buildMediaFileUrl(docId, primarySelectedMediaPath);
  const selectedVideoPaths = selectedMediaPaths.filter((mediaPath) => isVideoMediaPath(mediaPath));
  const mediaFileTimecodes = normalizeMediaFileTimecodes(
    segment.visual_decision?.media_file_timecodes ?? null,
    selectedMediaPaths
  );
  const mediaFileList = Array.isArray(mediaFiles) ? mediaFiles : [];
  const mediaTopicFolder = sanitizeMediaTopicName(segment.section_title ?? "");
  const mediaFileOptions = mediaFileList.filter((file) => getMediaFileTopicFolder(file.path) === mediaTopicFolder);
  const hasTopicFiles = mediaFileOptions.length > 0;
  const normalizedMediaFilter = mediaFilter.trim().toLowerCase();
  const filteredMediaFileOptions = React.useMemo(() => {
    if (!normalizedMediaFilter) return mediaFileOptions;
    return mediaFileOptions.filter((file) =>
      `${file.name} ${file.path}`.toLowerCase().includes(normalizedMediaFilter)
    );
  }, [mediaFileOptions, normalizedMediaFilter]);
  const mediaVisibleLimit = 10;
  const visibleMediaFileOptions = filteredMediaFileOptions.slice(0, mediaVisibleLimit);
  const hasMoreMediaFiles = filteredMediaFileOptions.length > mediaVisibleLimit;
  const selectedMediaCount = selectedMediaPaths.length;
  const researchResultsCount = Array.isArray(researchRun?.ranked_results) ? researchRun.ranked_results.length : 0;
  const researchPhaseSummary = React.useMemo(
    () =>
      (Array.isArray(researchRun?.summary?.phases) ? researchRun.summary.phases : [])
        .map((item) => {
          const phase = String(item?.phase ?? "").trim();
          const resultCount = Number(item?.result_count ?? 0);
          if (!phase || resultCount <= 0) return "";
          return `${phase}:${resultCount}`;
        })
        .filter(Boolean)
        .join(" · "),
    [researchRun]
  );
  const promotedResearchPair = React.useMemo(
    () => normalizeResearchBundleTrace(segment?.research_bundle_trace),
    [segment]
  );
  const primaryResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "source" || role === "main_source";
      }) ?? null,
    [researchRun]
  );
  const primaryResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "visual" || (role === "visual_candidate" && key !== "backup_visual");
      }) ?? null,
    [researchRun]
  );
  const backupResearchSourceItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find((item) => {
        const key = String(item?.key ?? "").trim().toLowerCase();
        const role = String(item?.role ?? "").trim().toLowerCase();
        return key === "backup_source" || role === "backup_source";
      }) ?? null,
    [researchRun]
  );
  const backupResearchVisualItem = React.useMemo(
    () =>
      (Array.isArray(researchRun?.brief?.items) ? researchRun.brief.items : []).find(
        (item) => String(item?.key ?? "").trim().toLowerCase() === "backup_visual"
      ) ?? null,
    [researchRun]
  );
  const currentSegmentResearchPair = React.useMemo(
    () =>
      deriveSegmentResearchCurrentPair(promotedResearchPair, {
        primarySource: primaryResearchSourceItem,
        primaryVisual: primaryResearchVisualItem,
        backupSource: backupResearchSourceItem,
        backupVisual: backupResearchVisualItem
      }),
    [
      backupResearchSourceItem,
      backupResearchVisualItem,
      primaryResearchSourceItem,
      primaryResearchVisualItem,
      promotedResearchPair
    ]
  );
  const toggleMediaFileSelection = React.useCallback((mediaPath) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath) return;
    const alreadySelected = selectedMediaPaths.includes(normalizedPath);
    const nextMediaPaths = alreadySelected
      ? selectedMediaPaths.filter((item) => item !== normalizedPath)
      : [...selectedMediaPaths, normalizedPath];
    onVisualUpdate(index, { media_file_paths: nextMediaPaths });
  }, [index, onVisualUpdate, selectedMediaPaths]);
  const updateMediaFileTimecode = React.useCallback((mediaPath, rawValue) => {
    const normalizedPath = normalizeMediaFilePath(mediaPath);
    if (!normalizedPath || !isVideoMediaPath(normalizedPath)) return;
    const normalizedTimecode = normalizeMediaStartTimecode(rawValue);
    const nextTimecodes = { ...mediaFileTimecodes };
    if (!normalizedTimecode) {
      delete nextTimecodes[normalizedPath];
    } else {
      nextTimecodes[normalizedPath] = normalizedTimecode;
    }
    onVisualUpdate(index, { media_file_timecodes: nextTimecodes });
  }, [index, mediaFileTimecodes, onVisualUpdate]);
  const isDone = Boolean(segment.is_done);
  const isCommentOnlySegment = isCommentsSegment(segment);
  const donePreview = isCommentOnlySegment
    ? (() => {
        const value = normalizeLineBreaks(segment.text_quote).trim();
        if (!value) return "\u041f\u0443\u0441\u0442\u043e";
        return value.length > 220 ? `${value.slice(0, 220).trimEnd()}...` : value;
      })()
    : getQuotePreview(segment.text_quote, 78);
  const statusBadge =
    segment.segment_status === "new"
      ? { text: "NEW", className: "badge badge-new" }
      : segment.segment_status === "changed"
        ? { text: "CHANGED", className: "badge badge-changed" }
        : null;

  if (isDone) {
    return (
      <article
        className="segment-card segment-card-done"
        style={{ animationDelay: `${animationIndex * 40}ms` }}
      >
        <div className={`segment-done-row${isCommentOnlySegment ? " segment-done-row-comments" : ""}`}>
          {!isCommentOnlySegment ? (
            <label className="done-toggle-inline" title="\u0421\u043d\u044f\u0442\u044c \u043e\u0442\u043c\u0435\u0442\u043a\u0443">
              <input
                type="checkbox"
                checked={true}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
          ) : null}
          <span className="segment-done-preview">{donePreview}</span>
        </div>
      </article>
    );
  }

  return (
    <article
      className="segment-card"
      data-segment-id={segment.segment_id}
      style={{ animationDelay: `${animationIndex * 40}ms` }}
    >
      <div className="segment-head">
        <div>
          <label>ID</label>
          <div className="segment-id-row">
            <input
              value={segment.segment_id}
              onChange={(event) => onUpdate(index, { segment_id: event.target.value })}
            />
            {statusBadge ? <span className={statusBadge.className}>{statusBadge.text}</span> : null}
          </div>
        </div>
        {!isCommentOnlySegment ? (
          <div className="segment-head-actions">
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
      <div className="segment-body">
        <label>
          {isCommentOnlySegment ? "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438" : "\u0426\u0438\u0442\u0430\u0442\u0430"}
        </label>
        <textarea
          value={segment.text_quote}
          onChange={(event) => onQuoteChange(index, event.target.value)}
        />
        {!isCommentOnlySegment ? (
          <>
            <SegmentVisualEditor
              segment={segment}
              config={config}
              index={index}
              onVisualUpdate={onVisualUpdate}
              visualTypeLabels={VISUAL_TYPE_LABELS}
              formatHintLabels={FORMAT_HINT_LABELS}
              priorityLabels={PRIORITY_LABELS}
              hasTopicFiles={hasTopicFiles}
              mediaFilter={mediaFilter}
              setMediaFilter={setMediaFilter}
              selectedMediaCount={selectedMediaCount}
              mediaFileUrl={mediaFileUrl}
              filteredMediaFileOptions={filteredMediaFileOptions}
              visibleMediaFileOptions={visibleMediaFileOptions}
              selectedMediaPaths={selectedMediaPaths}
              toggleMediaFileSelection={toggleMediaFileSelection}
              formatBytes={formatBytes}
              mediaVisibleLimit={mediaVisibleLimit}
              hasMoreMediaFiles={hasMoreMediaFiles}
              selectedVideoPaths={selectedVideoPaths}
              mediaFileTimecodes={mediaFileTimecodes}
              updateMediaFileTimecode={updateMediaFileTimecode}
              MediaTimecodeRowComponent={MediaTimecodeRow}
              normalizeMediaFilePath={normalizeMediaFilePath}
            />
            <SegmentResearchToolbar
              index={index}
              onSearchGenerate={onSearchGenerate}
              searchLoading={searchLoading}
              onSearchToggle={onSearchToggle}
              isSearchOpen={segment.search_open}
              queryItemsCount={queryItems.length}
              onResearchRun={onResearchRun}
              researchLoading={researchLoading}
              onOpenResearchWorkspace={() => onOpenResearchWorkspace?.(segment.segment_id, researchRun?.run_id ?? "")}
            />
            {researchLoading || researchRun || currentSegmentResearchPair || promotedResearchPair ? (
              <div className="segment-research-summary">
                <div className="segment-research-summary-head">
                  <strong>Research</strong>
                  <span>
                    {researchLoading
                      ? "running"
                      : researchRun
                        ? `${researchResultsCount} results${researchRun?.mode ? ` · ${researchRun.mode}` : ""}${
                            researchPhaseSummary ? ` · ${researchPhaseSummary}` : ""
                          }`
                        : "Open workspace to run research"}
                  </span>
                </div>
                {linkedReleaseInfo?.title ? (
                  <div className="segment-research-summary-link">Linked release: {linkedReleaseInfo.title}</div>
                ) : null}
                {currentSegmentResearchPair ? (
                  <div className="segment-research-summary-pair">
                    <span className={`badge ${getCurrentPairBadgeClassName("current")}`}>Current Pair</span>
                    <div className="segment-research-summary-copy">
                      {currentSegmentResearchPair.source?.label ? <span>{currentSegmentResearchPair.source.label}</span> : null}
                      {currentSegmentResearchPair.visual?.label ? <span>{currentSegmentResearchPair.visual.label}</span> : null}
                    </div>
                  </div>
                ) : null}
                {promotedResearchPair ? (
                  <div className="segment-research-summary-pair">
                    <span className={`badge ${getCurrentPairBadgeClassName("applied")}`}>Promoted</span>
                    <div className="segment-research-summary-copy">
                      {promotedResearchPair.source?.label ? <span>{promotedResearchPair.source.label}</span> : null}
                      {promotedResearchPair.visual?.label ? <span>{promotedResearchPair.visual.label}</span> : null}
                    </div>
                  </div>
                ) : null}
                <div className="segment-research-summary-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => onOpenResearchWorkspace?.(segment.segment_id, researchRun?.run_id ?? "")}
                  >
                    Open Research
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => onResearchCopyBrief?.(index)}
                    disabled={!researchRun}
                  >
                    Copy Brief
                  </button>
                </div>
              </div>
            ) : null}
            {segment.search_open ? (
              <SegmentSearchQueriesPanel
                segmentId={segment.segment_id}
                index={index}
                queriesValue={queriesValue}
                queryItems={queryItems}
                searchEngines={config.searchEngines}
                maxQueries={config.searchLimits?.maxQueries}
                normalizeQueryList={normalizeQueryList}
                onSearchUpdate={onSearchUpdate}
                onSearch={onSearch}
                onCopy={onCopy}
                onClearSearch={onClearSearch}
              />
            ) : null}
          </>
        ) : null}
        {!isCommentOnlySegment ? (
          <div className="segment-tail-actions">
            <label className="done-toggle-inline segment-done-bottom-toggle" title="\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u043a\u0430\u043a \u0433\u043e\u0442\u043e\u0432\u043e">
              <input
                type="checkbox"
                checked={isDone}
                onChange={(event) => onDoneToggle?.(index, event.target.checked)}
              />
            </label>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onInsertAfter(index)}
              title={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
              aria-label={"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u0431\u043b\u043e\u043a"}
            >
              +
            </button>
            <button
              className="btn ghost icon-round"
              type="button"
              onClick={() => onRemove(index)}
              title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
              aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
            >
              -
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
});
export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [config, setConfig] = useState(defaultConfig);
  const [scriptText, setScriptText] = useState("");
  const [docId, setDocId] = useState("");
  const [notionUrl, setNotionUrl] = useState("");
  const [notionHasUpdates, setNotionHasUpdates] = useState(false);
  const [segments, setSegments] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);
  const [recentDocId, setRecentDocId] = useState("");
  const [status, setStatus] = useState("");
  const [scenarioPanelOpen, setScenarioPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState({});
  const [searchLoading, setSearchLoading] = useState({});
  const [segmentResearchRuns, setSegmentResearchRuns] = useState({});
  const [segmentResearchHistory, setSegmentResearchHistory] = useState({});
  const [segmentResearchLoading, setSegmentResearchLoading] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [groupRenderLimits, setGroupRenderLimits] = useState({});
  const [linksPanelOpen, setLinksPanelOpen] = useState(false);
  const [headingSearchOpen, setHeadingSearchOpen] = useState({});
  const [headingEnglishQueries, setHeadingEnglishQueries] = useState({});
  const [headingTranslateLoading, setHeadingTranslateLoading] = useState({});
  const [appMode, setAppMode] = useState(getInitialAppMode);
  const [integrationOverview, setIntegrationOverview] = useState(null);
  const [integrationAssets, setIntegrationAssets] = useState([]);
  const [integrationReleases, setIntegrationReleases] = useState([]);
  const [integrationBotSessions, setIntegrationBotSessions] = useState([]);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [sqliteMirrorStatus, setSqliteMirrorStatus] = useState(null);
  const [runtimeBackupsStatus, setRuntimeBackupsStatus] = useState(null);
  const [selectedBackupSnapshotId, setSelectedBackupSnapshotId] = useState("");
  const [selectedBackupSnapshot, setSelectedBackupSnapshot] = useState(null);
  const [selectedBackupDryRun, setSelectedBackupDryRun] = useState(null);
  const [backupActionBusy, setBackupActionBusy] = useState(false);
  const [lastAssistantAutoBackup, setLastAssistantAutoBackup] = useState(null);
  const [sourceMemorySummary, setSourceMemorySummary] = useState(null);
  const [releaseOutcomeMemorySummary, setReleaseOutcomeMemorySummary] = useState(null);
  const [sourceProfiles, setSourceProfiles] = useState(null);
  const [sourceProfilesDraft, setSourceProfilesDraft] = useState(() => buildSourceProfilesDraft({}));
  const [sourceProfilesDirty, setSourceProfilesDirty] = useState(false);
  const [sourceProfilesSaving, setSourceProfilesSaving] = useState(false);
  const [selectedReleaseId, setSelectedReleaseId] = useState(getInitialReleaseQueryId);
  const [researchDocQueryId, setResearchDocQueryId] = useState(getInitialResearchDocQueryId);
  const [selectedResearchSegmentId, setSelectedResearchSegmentId] = useState(getInitialResearchSegmentQueryId);
  const [selectedResearchRunId, setSelectedResearchRunId] = useState(getInitialResearchRunQueryId);
  const [lastAttachRecommendationsResult, setLastAttachRecommendationsResult] = useState(null);
  const [integrationQuery, setIntegrationQuery] = useState("");
  const [integrationKind, setIntegrationKind] = useState("");
  const [integrationStatusFilter, setIntegrationStatusFilter] = useState("");
  const [releaseDraftTitle, setReleaseDraftTitle] = useState("");
  const [releaseDraftDate, setReleaseDraftDate] = useState("");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseBoardFilter, setReleaseBoardFilter] = useState("all");
  const [releaseWorkspaceTab, setReleaseWorkspaceTab] = useState("overview");
  const [selectedReleaseAttachmentIds, setSelectedReleaseAttachmentIds] = useState([]);
  const [releaseBulkScriptTemplate, setReleaseBulkScriptTemplate] = useState("");
  const [releaseBulkVisualTemplate, setReleaseBulkVisualTemplate] = useState("");
  const [assetActionBusy, setAssetActionBusy] = useState({});
  const [collabSessionEnabled, setCollabSessionEnabled] = useState(getInitialCollaborativeMode);
  const [autoOpenLastDocEnabled, setAutoOpenLastDocEnabled] = useState(getInitialAutoOpenLastDoc);
  const buildLatestResearchRunMap = React.useCallback((runs) => {
    const latestBySegment = {};
    for (const run of Array.isArray(runs) ? runs : []) {
      const segmentId = String(run?.segment_id ?? "").trim();
      if (!segmentId) continue;
      const current = latestBySegment[segmentId];
      const currentKey = Date.parse(current?.updated_at ?? current?.created_at ?? "") || 0;
      const nextKey = Date.parse(run?.updated_at ?? run?.created_at ?? "") || 0;
      if (!current || nextKey >= currentKey) {
        latestBySegment[segmentId] = run;
      }
    }
    return latestBySegment;
  }, []);
  const buildResearchRunHistoryMap = React.useCallback((runs) => {
    const bySegment = {};
    for (const run of Array.isArray(runs) ? runs : []) {
      const segmentId = String(run?.segment_id ?? "").trim();
      if (!segmentId) continue;
      if (!Array.isArray(bySegment[segmentId])) bySegment[segmentId] = [];
      bySegment[segmentId].push(run);
    }
    Object.keys(bySegment).forEach((segmentId) => {
      bySegment[segmentId] = bySegment[segmentId].sort((a, b) =>
        String(b?.updated_at ?? b?.created_at ?? "").localeCompare(String(a?.updated_at ?? a?.created_at ?? ""))
      );
    });
    return bySegment;
  }, []);
  const mergeResearchRunHistory = React.useCallback((historyMap, run) => {
    const segmentId = String(run?.segment_id ?? "").trim();
    if (!segmentId) return historyMap;
    const current = Array.isArray(historyMap?.[segmentId]) ? historyMap[segmentId] : [];
    const next = [run, ...current.filter((item) => String(item?.run_id ?? "") !== String(run?.run_id ?? ""))].sort(
      (a, b) => String(b?.updated_at ?? b?.created_at ?? "").localeCompare(String(a?.updated_at ?? a?.created_at ?? ""))
    );
    return {
      ...(historyMap ?? {}),
      [segmentId]: next
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem("collabSessionEnabled", collabSessionEnabled ? "1" : "0");
  }, [collabSessionEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem(AUTO_OPEN_LAST_DOC_STORAGE_KEY, autoOpenLastDocEnabled ? "1" : "0");
  }, [autoOpenLastDocEnabled]);
  useEffect(() => {
    fetchJsonSafe("/api/config")
      .then(({ response, data }) => {
        if (!response.ok || !data) return;
        if (data?.blockTypes) {
          setConfig({
            ...defaultConfig,
            ...data,
            visualTypes: data.visualTypes ?? defaultConfig.visualTypes,
            formatHints: data.formatHints ?? defaultConfig.formatHints,
            priorities: data.priorities ?? defaultConfig.priorities,
            searchLimits: { ...defaultConfig.searchLimits, ...(data.searchLimits ?? {}) },
            searchEngines: data.searchEngines ?? defaultConfig.searchEngines
          });
        }
      })
      .catch(() => null);
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("theme", theme);
    }
  }, [theme]);
  useEffect(() => {
    syncAppLocation(appMode, selectedReleaseId, {
      docId: appMode === "research" ? researchDocQueryId || docId : "",
      segmentId: appMode === "research" ? selectedResearchSegmentId : "",
      runId: appMode === "research" ? selectedResearchRunId : ""
    });
  }, [appMode, docId, researchDocQueryId, selectedReleaseId, selectedResearchRunId, selectedResearchSegmentId]);
  const fetchRecentDocuments = React.useCallback(async () => {
    try {
      const { response, data } = await fetchJsonSafe("/api/documents");
      if (!response.ok) return;
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      setRecentDocs(docs.slice(0, 12));
    } catch {
      setRecentDocs([]);
    }
  }, []);
  useEffect(() => {
    fetchRecentDocuments();
  }, [fetchRecentDocuments]);
  useEffect(() => {
    if (typeof window === "undefined" || !docId) return;
    window.localStorage?.setItem(LAST_USED_DOC_STORAGE_KEY, docId);
  }, [docId]);
  useUiAuditQueue({
    docId,
    buildUiActionPayload,
    extractUiTargetInfo,
    sendUiAuditActions,
    batchSize: UI_AUDIT_BATCH_SIZE,
    maxQueue: UI_AUDIT_MAX_QUEUE,
    flushMs: UI_AUDIT_FLUSH_MS,
    inputThrottleMs: UI_AUDIT_INPUT_THROTTLE_MS
  });
  const {
    mediaJobs,
    mediaFiles,
    downloadedMediaUrls,
    mediaQueue,
    mediaTools,
    ytDlpVersion,
    ytDlpVersionLoading,
    ytDlpUpdateLoading,
    mediaPanelOpen,
    setMediaPanelOpen,
    refreshMedia,
    handleCheckYtDlpVersion,
    handleUpdateYtDlp,
    activeMediaJobsCount,
    downloadedMediaSet,
    isMediaDownloaded,
    isMediaDownloadBusy,
    getMediaDownloadState,
    isMediaDownloadSupported,
    handleDownloadMedia,
    handleCancelMediaJob
  } = useMediaManager({
    docId,
    setStatus,
    fetchJsonSafe,
    canonicalizeLinkUrl,
    normalizeLinkUrl,
    normalizeTopicTitleForDisplay,
    isYtDlpCandidateUrl
  });
  useEffect(() => {
    setSegmentResearchRuns({});
    setSegmentResearchHistory({});
    setSegmentResearchLoading({});
  }, [docId]);
  const refreshIntegration = React.useCallback(async () => {
    setIntegrationLoading(true);
    try {
      const [
        overviewResult,
        assetsResult,
        releasesResult,
        sessionsResult,
        sqliteStatusResult,
        backupsStatusResult,
        sourceProfilesResult,
        sourceMemoryResult,
        releaseOutcomeMemoryResult
      ] = await Promise.all([
        fetchJsonSafe("/api/integration/overview"),
        fetchJsonSafe("/api/assets?limit=80"),
        fetchJsonSafe("/api/releases"),
        fetchJsonSafe("/api/bot/sessions"),
        fetchJsonSafe("/api/integration/sqlite/status"),
        fetchJsonSafe("/api/integration/backups/status"),
        fetchJsonSafe("/api/source-profiles"),
        fetchJsonSafe("/api/source-memory"),
        fetchJsonSafe("/api/release-outcome-memory")
      ]);

      if (overviewResult.response.ok) {
        setIntegrationOverview(overviewResult.data ?? null);
      }
      if (assetsResult.response.ok) {
        setIntegrationAssets(Array.isArray(assetsResult.data?.assets) ? assetsResult.data.assets : []);
      }
      if (releasesResult.response.ok) {
        setIntegrationReleases(Array.isArray(releasesResult.data?.releases) ? releasesResult.data.releases : []);
      }
      if (sessionsResult.response.ok) {
        setIntegrationBotSessions(Array.isArray(sessionsResult.data?.sessions) ? sessionsResult.data.sessions : []);
      }
      if (sqliteStatusResult.response.ok) {
        setSqliteMirrorStatus(sqliteStatusResult.data?.sqlite ?? null);
      }
      let nextSelectedBackupId = "";
      if (backupsStatusResult.response.ok) {
        const nextBackupsStatus = backupsStatusResult.data?.backups ?? null;
        setRuntimeBackupsStatus(nextBackupsStatus);
        const backupItems = Array.isArray(nextBackupsStatus?.backups) ? nextBackupsStatus.backups : [];
        const preferredBackupId = String(selectedBackupSnapshotId ?? "").trim();
        nextSelectedBackupId =
          (preferredBackupId && backupItems.some((item) => String(item?.backup_id ?? "").trim() === preferredBackupId)
            ? preferredBackupId
            : String(nextBackupsStatus?.latest?.backup_id ?? backupItems[0]?.backup_id ?? "").trim()) || "";
        setSelectedBackupSnapshotId(nextSelectedBackupId);
      } else {
        setRuntimeBackupsStatus(null);
        setSelectedBackupSnapshotId("");
        setSelectedBackupSnapshot(null);
        setSelectedBackupDryRun(null);
      }
      if (sourceProfilesResult.response.ok) {
        const profiles = sourceProfilesResult.data?.profiles ?? null;
        setSourceProfiles(profiles);
        setSourceProfilesDraft((prev) => (sourceProfilesDirty ? prev : buildSourceProfilesDraft(profiles ?? {})));
      }
      if (sourceMemoryResult.response.ok) {
        setSourceMemorySummary(sourceMemoryResult.data?.summary ?? null);
      }
      if (releaseOutcomeMemoryResult.response.ok) {
        setReleaseOutcomeMemorySummary(releaseOutcomeMemoryResult.data?.summary ?? null);
      }

      if (nextSelectedBackupId) {
        const [backupInspectResult, backupDryRunResult] = await Promise.all([
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(nextSelectedBackupId)}`),
          fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(nextSelectedBackupId)}/restore-dry-run`, {
            method: "POST"
          })
        ]);
        if (backupInspectResult.response.ok) {
          setSelectedBackupSnapshot(backupInspectResult.data?.backup ?? null);
        } else {
          setSelectedBackupSnapshot(null);
        }
        if (backupDryRunResult.response.ok) {
          setSelectedBackupDryRun(backupDryRunResult.data?.dry_run ?? null);
        } else {
          setSelectedBackupDryRun(null);
        }
      }
    } catch {
      setIntegrationOverview(null);
      setIntegrationAssets([]);
      setIntegrationReleases([]);
      setIntegrationBotSessions([]);
      setSqliteMirrorStatus(null);
      setRuntimeBackupsStatus(null);
      setSelectedBackupSnapshot(null);
      setSelectedBackupDryRun(null);
      setSourceMemorySummary(null);
      setReleaseOutcomeMemorySummary(null);
      setSourceProfiles(null);
    } finally {
      setIntegrationLoading(false);
    }
  }, [selectedBackupSnapshotId, sourceProfilesDirty]);
  const updateSourceProfilesDraftField = React.useCallback((field, value) => {
    setSourceProfilesDraft((prev) => ({
      ...prev,
      [field]: value
    }));
    setSourceProfilesDirty(true);
  }, []);
  const handleResetSourceProfilesDraft = React.useCallback(() => {
    setSourceProfilesDraft(buildSourceProfilesDraft(sourceProfiles ?? {}));
    setSourceProfilesDirty(false);
    setStatus("Source profiles reset to saved values.");
  }, [sourceProfiles]);
  const handleSaveSourceProfiles = React.useCallback(async () => {
    try {
      setSourceProfilesSaving(true);
      const domainProfiles = JSON.parse(String(sourceProfilesDraft.domain_profiles_json ?? "{}") || "{}");
      const channelProfiles = JSON.parse(String(sourceProfilesDraft.channel_profiles_json ?? "{}") || "{}");
      const payload = {
        version: Number(sourceProfiles?.version ?? 1) || 1,
        trusted_domains: parseDomainListFromTextarea(sourceProfilesDraft.trusted_domains),
        blocked_domains: parseDomainListFromTextarea(sourceProfilesDraft.blocked_domains),
        video_platform_domains: parseDomainListFromTextarea(sourceProfilesDraft.video_platform_domains),
        social_domains: parseDomainListFromTextarea(sourceProfilesDraft.social_domains),
        downloadable_domains: parseDomainListFromTextarea(sourceProfilesDraft.downloadable_domains),
        screenshot_friendly_domains: parseDomainListFromTextarea(sourceProfilesDraft.screenshot_friendly_domains),
        domain_profiles: domainProfiles && typeof domainProfiles === "object" && !Array.isArray(domainProfiles) ? domainProfiles : {},
        channel_profiles: channelProfiles && typeof channelProfiles === "object" && !Array.isArray(channelProfiles) ? channelProfiles : {}
      };
      const { response, data } = await fetchJsonSafe("/api/source-profiles", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles: payload })
      });
      if (!response.ok) throw new Error(data?.error ?? "Failed to save source profiles");
      const nextProfiles = data?.profiles ?? null;
      setSourceProfiles(nextProfiles);
      setSourceProfilesDraft(buildSourceProfilesDraft(nextProfiles ?? {}));
      setSourceProfilesDirty(false);
      setStatus("Source profiles saved.");
    } catch (error) {
      setStatus(error?.message ?? "Failed to save source profiles");
    } finally {
      setSourceProfilesSaving(false);
    }
  }, [sourceProfiles, sourceProfilesDraft]);
  const handleSelectBackupSnapshot = React.useCallback(async (backupId) => {
    const normalizedId = String(backupId ?? "").trim();
    setSelectedBackupSnapshotId(normalizedId);
    if (!normalizedId) {
      setSelectedBackupSnapshot(null);
      setSelectedBackupDryRun(null);
      return;
    }
    try {
      setBackupActionBusy(true);
      const [backupInspectResult, backupDryRunResult] = await Promise.all([
        fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(normalizedId)}`),
        fetchJsonSafe(`/api/integration/backups/${encodeURIComponent(normalizedId)}/restore-dry-run`, {
          method: "POST"
        })
      ]);
      if (!backupInspectResult.response.ok) {
        throw new Error(backupInspectResult.data?.error ?? "Failed to load backup snapshot");
      }
      if (!backupDryRunResult.response.ok) {
        throw new Error(backupDryRunResult.data?.error ?? "Failed to load backup dry-run");
      }
      setSelectedBackupSnapshot(backupInspectResult.data?.backup ?? null);
      setSelectedBackupDryRun(backupDryRunResult.data?.dry_run ?? null);
    } catch (error) {
      setSelectedBackupSnapshot(null);
      setSelectedBackupDryRun(null);
      setStatus(error?.message ?? "Failed to load backup snapshot");
    } finally {
      setBackupActionBusy(false);
    }
  }, []);
  const handleCreateRuntimeBackup = React.useCallback(async () => {
    try {
      setBackupActionBusy(true);
      const { response, data } = await fetchJsonSafe("/api/integration/backups/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "manual" })
      });
      if (!response.ok) throw new Error(data?.error ?? "Failed to create backup");
      const backupId = String(data?.backup?.backup_id ?? "").trim();
      await refreshIntegration();
      if (backupId) {
        await handleSelectBackupSnapshot(backupId);
      }
      setStatus(`Backup created: ${backupId || "ok"}`);
    } catch (error) {
      setStatus(error?.message ?? "Failed to create backup");
    } finally {
      setBackupActionBusy(false);
    }
  }, [handleSelectBackupSnapshot, refreshIntegration]);
  const handleRestoreRuntimeBackup = React.useCallback(
    async (backupId) => {
      const normalizedId = String(backupId ?? selectedBackupSnapshotId ?? "").trim();
      if (!normalizedId) return;
      try {
        setBackupActionBusy(true);
        const { response, data } = await fetchJsonSafe(
          `/api/integration/backups/${encodeURIComponent(normalizedId)}/restore`,
          {
            method: "POST"
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Failed to restore backup");
        await refreshIntegration();
        await handleSelectBackupSnapshot(normalizedId);
        const preRestoreId = String(data?.pre_restore_backup?.backup_id ?? "").trim();
        setStatus(
          preRestoreId
            ? `Backup restored: ${normalizedId} · safety snapshot ${preRestoreId}`
            : `Backup restored: ${normalizedId}`
        );
      } catch (error) {
        setStatus(error?.message ?? "Failed to restore backup");
      } finally {
        setBackupActionBusy(false);
      }
    },
    [handleSelectBackupSnapshot, refreshIntegration, selectedBackupSnapshotId]
  );
  const rememberAssistantAutoBackup = React.useCallback((autoBackup, contextLabel = "assistant action") => {
    const backupId = String(autoBackup?.backup_id ?? "").trim();
    if (!backupId) return "";
    setLastAssistantAutoBackup({
      backup_id: backupId,
      created_at: String(autoBackup?.created_at ?? "").trim(),
      label: String(contextLabel ?? "").trim() || "assistant action"
    });
    return backupId;
  }, []);
  useEffect(() => {
    refreshIntegration();
  }, [refreshIntegration]);
  useEffect(() => {
    let refreshInFlight = false;
    const runRefresh = async () => {
      if (refreshInFlight) return;
      if (typeof document !== "undefined" && document.hidden) return;
      refreshInFlight = true;
      try {
        await refreshIntegration();
      } finally {
        refreshInFlight = false;
      }
    };
    const timer = setInterval(() => {
      void runRefresh();
    }, 30000);
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void runRefresh();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [refreshIntegration]);
  useEffect(() => {
    if (selectedReleaseId) return;
    const nextReleaseId = integrationReleases[0]?.id ?? "";
    if (!nextReleaseId) return;
    setSelectedReleaseId(nextReleaseId);
  }, [integrationReleases, selectedReleaseId]);
  const {
    selectedReleaseDetail,
    setSelectedReleaseDetail,
    releaseAssistantPass,
    setReleaseAssistantPass,
    releaseRecommendations,
    setReleaseRecommendations,
    releaseDraftPack,
    setReleaseDraftPack,
    releasePublishChecklist,
    setReleasePublishChecklist,
    releaseControlPanel,
    setReleaseControlPanel,
    releaseBriefingPanel,
    releaseResearchBriefs,
    releaseActivity,
    loadReleaseDetail,
    loadReleaseAssistantPass,
    loadReleaseActivity,
    loadReleaseRecommendations,
    loadReleaseDraftPack,
    loadReleasePublishChecklist,
    loadReleaseControlPanel,
    loadReleaseBriefingPanel,
    reloadReleaseWorkspaceData,
    syncReleaseWorkspaceDataFromAction
  } = useReleaseWorkspaceData({
    selectedReleaseId,
    appMode,
    fetchJsonSafe,
    refreshIntegration
  });

  const reloadCurrentReleaseWorkspace = React.useCallback(
    async (options = {}) => {
      if (!selectedReleaseId) return null;
      return reloadReleaseWorkspaceData(selectedReleaseId, options);
    },
    [reloadReleaseWorkspaceData, selectedReleaseId]
  );
  const syncCurrentReleaseActionData = React.useCallback(
    async (data, options = {}) => {
      if (!selectedReleaseId) return null;
      return syncReleaseWorkspaceDataFromAction(data, {
        releaseId: selectedReleaseId,
        ...options
      });
    },
    [selectedReleaseId, syncReleaseWorkspaceDataFromAction]
  );
  useEffect(() => {
    setReleaseWorkspaceTab("overview");
    setSelectedReleaseAttachmentIds([]);
    setLastAttachRecommendationsResult(null);
  }, [selectedReleaseId]);
  const segmentsCount = segments.filter((segment) => segment.block_type !== "links").length;
  const { groupedSegments, allScenarioLinks, segmentsNeedingVisual, headingRuEngines } = useScenarioGroups({
    segments,
    config,
    headingSearchRuEngineIds: HEADING_SEARCH_RU_ENGINE_IDS,
    groupRenderChunk: GROUP_RENDER_CHUNK,
    getSegmentGroupKey,
    getSegmentGroupTitle,
    collectScenarioLinks,
    collectSegmentsNeedingVisual,
    setExpandedGroups,
    setGroupRenderLimits,
    setHeadingSearchOpen,
    setHeadingEnglishQueries
  });
  const canGenerate = Boolean(String(scriptText).trim()) && !loading;
  const canRecoverSegmentState = Boolean(String(docId ?? "").trim()) && !loading;
  const canSaveBase = Boolean(docId) && segmentsCount > 0 && !loading;
  const buildSessionPayload = React.useCallback(
    () =>
      buildSessionPayloadFromState({
        scriptText,
        notionUrl,
        segments
      }),
    [notionUrl, scriptText, segments]
  );
  const {
    collabAutoSaving,
    collabRevision,
    collabAutoSaveInFlightRef,
    collabPollInFlightRef,
    collabRevisionRef,
    hasUnsavedChanges,
    initialDocRestoreDoneRef,
    isSnapshotDirty,
    rememberSessionSnapshot,
    runWithRemoteApply,
    saveSessionSnapshot
  } = useCollaborativeSession({
    docId,
    buildSessionPayload,
    fetchJsonSafe,
    getSessionFingerprint,
    autosaveDebounceMs: COLLAB_AUTOSAVE_DEBOUNCE_MS,
    onError: (error) => setStatus(error?.message ?? "Collaborative autosave failed.")
  });
  const canSave = canSaveBase && hasUnsavedChanges;
  const canLoadNotion = Boolean(notionUrl.trim()) && !loading;
  const canRefreshNotion = canLoadNotion;
  const applyLoadedSnapshot = React.useCallback(
    (targetId, data) => {
      const rawText = data?.document?.raw_text ?? "";
      const loadedNotion = data?.document?.notion_url ?? "";
      const merged = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        rawText
      );
      const normalizedComments = removeDuplicateCommentSegments(merged);
      const mergedWithTopics = ensureEmptySectionTopics(normalizedComments, rawText);
      const linksFromMerged = mergedWithTopics.filter((item) => item.block_type === "links");
      const ordered = sortSegmentsInScenarioOrder(collapseDuplicateLinkOnlyTopics(
        mergeLinkSegmentsIntoSegments(mergedWithTopics, linksFromMerged)
      ));

      const snapshot = buildSessionPayloadFromState({
        scriptText: rawText,
        notionUrl: loadedNotion,
        segments: ordered
      });
      runWithRemoteApply(() => {
        rememberSessionSnapshot(snapshot, data?.revision);
        setDocId(targetId);
        setScriptText(rawText);
        setNotionUrl(loadedNotion);
        setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
        setSegments(ordered);
        setSegmentResearchRuns(buildLatestResearchRunMap(data?.research_runs));
        setSegmentResearchHistory(buildResearchRunHistoryMap(data?.research_runs));
        setSegmentResearchLoading({});
        setRecentDocId(targetId);
        setResearchDocQueryId(targetId);
      });
    },
    [buildLatestResearchRunMap, buildResearchRunHistoryMap, config, rememberSessionSnapshot, runWithRemoteApply]
  );
  const upsertDocumentForText = React.useCallback(
    async (rawTextValue, notionUrlValue = "") => {
      const rawText = String(rawTextValue ?? "").trim();
      if (!rawText) {
        throw new Error("\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u0435\u043a\u0441\u0442 \u0441\u0446\u0435\u043d\u0430\u0440\u0438\u044f.");
      }
      const payload = {
        raw_text: rawText,
        notion_url: String(notionUrlValue ?? "").trim() || null
      };
      const { response, data } = await fetchJsonSafe("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430");
      }
      const targetId = String(data?.id ?? "").trim();
      if (!targetId) {
        throw new Error("Server returned empty document id");
      }
      setDocId(targetId);
      setRecentDocId(targetId);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));
      if (targetId !== docId) {
        fetchRecentDocuments();
      }
      try {
        const loaded = await fetchJsonSafe(`/api/documents/${targetId}`);
        if (loaded.response.ok && loaded.data) {
          applyLoadedSnapshot(targetId, loaded.data);
        } else {
          rememberSessionSnapshot(
            buildSessionPayloadFromState({
              scriptText: rawText,
              notionUrl: payload.notion_url ?? "",
              segments: []
            }),
            0
          );
        }
      } catch {
        rememberSessionSnapshot(
          buildSessionPayloadFromState({
            scriptText: rawText,
            notionUrl: payload.notion_url ?? "",
            segments: []
          }),
          0
        );
      }
      return { id: targetId, reused: Boolean(data?.reused), document: data?.document ?? null };
    },
    [applyLoadedSnapshot, docId, fetchRecentDocuments, rememberSessionSnapshot]
  );
  const handleStartNewScenario = React.useCallback(() => {
    const hasDraftContent =
      Boolean(String(scriptText ?? "").trim()) ||
      Boolean(String(notionUrl ?? "").trim()) ||
      (Array.isArray(segments) && segments.length > 0);
    const shouldConfirmReset = Boolean(hasUnsavedChanges || hasDraftContent);
    if (shouldConfirmReset && typeof window !== "undefined") {
      const ok = window.confirm("Есть несохраненные изменения. Сбросить и начать новый сценарий?");
      if (!ok) return;
    }
    initialDocRestoreDoneRef.current = true;
    setDocId("");
    setRecentDocId("");
    setResearchDocQueryId("");
    setSelectedResearchSegmentId("");
    setSelectedResearchRunId("");
    setScriptText(NEW_SCENARIO_TEMPLATE);
    setNotionUrl("");
    setNotionHasUpdates(false);
    setSegments([]);
    setLinksPanelOpen(false);
    setMediaPanelOpen(false);
    setHeadingSearchOpen({});
    setHeadingEnglishQueries({});
    setStatus("Новый сценарий: шаблон загружен, можно сразу сегментировать.");
    rememberSessionSnapshot(
      buildSessionPayloadFromState({
        scriptText: NEW_SCENARIO_TEMPLATE,
        notionUrl: "",
        segments: []
      }),
      0
    );
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(LAST_USED_DOC_STORAGE_KEY);
    }
  }, [hasUnsavedChanges, notionUrl, rememberSessionSnapshot, scriptText, segments]);
  const fetchNotionContent = async (statusLabel) => {
    const url = notionUrl.trim();
    if (!url) {
      setStatus("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Notion.");
      return;
    }
    if (docId && hasUnsavedChanges) {
      try {
        await saveSessionSnapshot(buildSessionPayload(), "pre_notion_refresh");
      } catch (error) {
        setStatus(`Не удалось сохранить правки перед обновлением Notion: ${error.message}`);
        return;
      }
    }
    setLoading(true);
    setStatus(statusLabel);
    const progressId = `notion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let progressStopped = false;
    let lastProgressMessage = "";
    let progressTimer = null;
    const stopProgressPolling = () => {
      progressStopped = true;
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };
    const pollProgress = async () => {
      if (progressStopped) return;
      try {
        const { response, data } = await fetchJsonSafe(`/api/notion/progress/${progressId}`);
        if (response.status === 404) {
          stopProgressPolling();
          return;
        }
        if (!response.ok) return;
        const nextMessage = String(data?.last_message ?? "").trim();
        if (nextMessage && nextMessage !== lastProgressMessage) {
          lastProgressMessage = nextMessage;
          setStatus(nextMessage);
        }
        if (data?.done) {
          stopProgressPolling();
        }
      } catch {
        return;
      }
    };
    progressTimer = setInterval(() => {
      pollProgress();
    }, 700);
    void pollProgress();
    try {
      const previousText = scriptText;
      const { response, data } = await fetchJsonSafe("/api/notion/raw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, progress_id: progressId })
      });
      if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 Notion");
      const normalizedUrl = data?.url ?? url;
      if (normalizedUrl) {
        setNotionUrl(normalizedUrl);
      }
      const content = typeof data?.content === "string" ? data.content : "";
      const hasChanges = content !== previousText;
      setScriptText(content);

      if (content.trim()) {
        const upserted = await upsertDocumentForText(content, normalizedUrl);
        if (upserted?.document) {
          setNotionHasUpdates(getNeedsSegmentationFromDocument(upserted.document));
        } else if (hasChanges) {
          setNotionHasUpdates(true);
        }
      } else if (hasChanges) {
        setNotionHasUpdates(true);
      }

      if (hasChanges) {
        setStatus(content.trim() ? "Notion \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u044b." : "Notion \u0432\u0435\u0440\u043d\u0443\u043b \u043f\u0443\u0441\u0442\u043e\u0439 \u0442\u0435\u043a\u0441\u0442.");
      } else {
        setStatus("Notion \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439.");
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      stopProgressPolling();
      setLoading(false);
    }
  };
  const handleLoadNotion = async () => {
    await fetchNotionContent("Загрузка Notion...");
  };
  const handleRefreshNotion = async () => {
    await fetchNotionContent("Обновление Notion...");
  };
  const loadDocumentById = React.useCallback(
    async (targetId, options = {}) => {
      const trimmed = String(targetId ?? "").trim();
      if (!trimmed) return false;
      const silent = Boolean(options?.silent);
      if (!silent) {
        setLoading(true);
        setStatus("\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430...");
      }
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${trimmed}`);
        if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430");
        applyLoadedSnapshot(trimmed, data);
        if (silent) {
          setStatus(`Collaborative session updated: ${trimmed}`);
        } else {
          setStatus(`\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d: ${trimmed}`);
        }
        return true;
      } catch (error) {
        setStatus(error.message);
        return false;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [applyLoadedSnapshot]
  );
  const handleRecentSelect = async (event) => {
    const selected = event.target.value;
    setRecentDocId(selected);
    if (!selected) return;
    await loadDocumentById(selected);
  };
  useEffect(() => {
    if (initialDocRestoreDoneRef.current) return;
    if (appMode === "research") return;
    if (!autoOpenLastDocEnabled) return;
    if (recentDocs.length === 0) return;
    const hasDraft =
      Boolean(docId) ||
      Boolean(String(scriptText).trim()) ||
      Boolean(String(notionUrl).trim()) ||
      segments.length > 0;
    if (hasDraft) {
      initialDocRestoreDoneRef.current = true;
      return;
    }

    const storedDocId =
      typeof window !== "undefined" ? window.localStorage?.getItem(LAST_USED_DOC_STORAGE_KEY) : "";
    const hasStored = storedDocId && recentDocs.some((item) => item.id === storedDocId);
    const targetDocId = hasStored ? storedDocId : recentDocs[0]?.id;
    if (!targetDocId) return;

    initialDocRestoreDoneRef.current = true;
    setRecentDocId(targetDocId);
    void loadDocumentById(targetDocId);
  }, [appMode, autoOpenLastDocEnabled, docId, loadDocumentById, notionUrl, recentDocs, scriptText, segments.length]);
  useEffect(() => {
    if (appMode !== "research") return;
    const targetDocId = String(researchDocQueryId ?? "").trim();
    if (!targetDocId || targetDocId === docId) return;
    void loadDocumentById(targetDocId);
  }, [appMode, docId, loadDocumentById, researchDocQueryId]);
  useEffect(() => {
    if (appMode !== "research") return;
    const researchSegments = segments.filter(
      (item) => normalizeSegmentBlockType(item?.block_type) !== "links" && !isCommentsSegment(item)
    );
    if (!researchSegments.length) return;
    const hasSelectedSegment = researchSegments.some(
      (item) => String(item?.segment_id ?? "").trim() === String(selectedResearchSegmentId ?? "").trim()
    );
    if (!hasSelectedSegment) {
      setSelectedResearchSegmentId(String(researchSegments[0]?.segment_id ?? "").trim());
    }
  }, [appMode, segments, selectedResearchSegmentId]);
  useEffect(() => {
    if (appMode !== "research") return;
    const segmentId = String(selectedResearchSegmentId ?? "").trim();
    if (!segmentId) return;
    const requestedRunId = String(selectedResearchRunId ?? "").trim();
    const historyItems = segmentResearchHistory[segmentId] ?? [];
    const hasUsefulResults = (item) =>
      Array.isArray(item?.ranked_results)
        ? item.ranked_results.length > 0
        : Array.isArray(item?.results)
          ? item.results.length > 0
          : false;
    if (requestedRunId) {
      const hasRequestedRun = historyItems.some((item) => String(item?.run_id ?? "").trim() === requestedRunId);
      if (hasRequestedRun) return;
    }
    const currentRunId = String(segmentResearchRuns[segmentId]?.run_id ?? "").trim();
    const preferredHistoryItem = [...historyItems]
      .sort((left, right) => {
        const leftTs = Date.parse(String(left?.updated_at ?? left?.created_at ?? "")) || 0;
        const rightTs = Date.parse(String(right?.updated_at ?? right?.created_at ?? "")) || 0;
        return rightTs - leftTs;
      })
      .find((item) => hasUsefulResults(item));
    const preferredRunId = String(preferredHistoryItem?.run_id ?? currentRunId ?? "").trim();
    if (preferredRunId !== requestedRunId) {
      setSelectedResearchRunId(preferredRunId);
    }
  }, [appMode, segmentResearchHistory, segmentResearchRuns, selectedResearchRunId, selectedResearchSegmentId]);
  useEffect(() => {
    if (appMode !== "research") return;
    const segmentId = String(selectedResearchSegmentId ?? "").trim();
    const runId = String(selectedResearchRunId ?? "").trim();
    if (!segmentId || !runId) return;
    const selectedRun = (segmentResearchHistory[segmentId] ?? []).find(
      (item) => String(item?.run_id ?? "").trim() === runId
    );
    if (!selectedRun) return;
    setSegmentResearchRuns((prev) => {
      const currentRunId = String(prev?.[segmentId]?.run_id ?? "").trim();
      if (currentRunId === runId) return prev;
      return {
        ...prev,
        [segmentId]: selectedRun
      };
    });
  }, [appMode, segmentResearchHistory, selectedResearchRunId, selectedResearchSegmentId]);
  useEffect(() => {
    if (!COLLAB_REMOTE_POLL_ENABLED || !collabSessionEnabled || !docId) return;
    let stopped = false;

    const pollState = async () => {
      if (stopped || collabPollInFlightRef.current || collabAutoSaveInFlightRef.current) return;
      collabPollInFlightRef.current = true;
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/state`);
        if (!response.ok) return;
        const remoteRevision = Number(data?.revision ?? 0);
        if (!Number.isFinite(remoteRevision) || remoteRevision <= collabRevisionRef.current) return;

        if (isSnapshotDirty(buildSessionPayload())) return;

        await loadDocumentById(docId, { silent: true });
      } catch {
        return;
      } finally {
        collabPollInFlightRef.current = false;
      }
    };

    const timer = setInterval(() => {
      pollState();
    }, COLLAB_POLL_INTERVAL_MS);
    pollState();

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [buildSessionPayload, collabSessionEnabled, docId, isSnapshotDirty, loadDocumentById]);
  const handleGenerate = async () => {
    setLoading(true);
    setStatus("\u0413\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u043e\u0432...");
    try {
      // After a Notion refresh, local segments/decisions may be older than backend state
      // (for example when SDVG already attached media or marked items done). In that case
      // sending a full /session snapshot before regeneration can overwrite those newer
      // backend changes. Let segments:generate use backend state as the merge source.
      if (docId && hasUnsavedChanges && !notionHasUpdates) {
        await saveSessionSnapshot(buildSessionPayload(), "pre_generate");
      }
      const { cleanText, linkSegments: extractedLinks, segmentLinkHints } = extractLinksFromScript(scriptText);
      const existingLinks = segments.filter((segment) => segment.block_type === "links");
      const mergedLinks = mergeLinkSegmentsBySection(existingLinks, extractedLinks);
      if (cleanText !== scriptText) {
        setScriptText(cleanText);
      }
      if (!cleanText.trim()) {
        setStatus("\u041d\u0435\u0442 \u0442\u0435\u043a\u0441\u0442\u0430 \u0434\u043b\u044f \u0441\u0435\u0433\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u0438 \u043f\u043e\u0441\u043b\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a.");
        return;
      }

      let targetDocId = docId;
      if (!targetDocId || notionUrl.trim()) {
        const upserted = await upsertDocumentForText(cleanText, notionUrl);
        targetDocId = upserted.id;
      }

      const { response, data } = await fetchJsonSafe(`/api/documents/${targetDocId}/segments:generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw_text: cleanText, link_segments: mergedLinks })
      });
      if (!response.ok) throw new Error(data?.error ?? "\u041e\u0448\u0438\u0431\u043a\u0430 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438");

      const mergedBase = applySectionsFromScript(
        mergeSegmentsAndDecisions(data.segments, data.decisions, config),
        cleanText
      );
      const mergedWithComments = splitOutLeadingCommentSegments(mergedBase);
      const normalizedComments = removeDuplicateCommentSegments(mergedWithComments);
      const merged = ensureEmptySectionTopics(normalizedComments, cleanText);
      const {
        segments: mergedWithSegmentLinks,
        appliedCount: segmentLinkHintsApplied
      } = applySegmentLinkHints(merged, segmentLinkHints);
      const linksFromMerged = mergedWithSegmentLinks.filter((segment) => segment.block_type === "links");
      const orderedSegments = sortSegmentsInScenarioOrder(collapseDuplicateLinkOnlyTopics(
        mergeLinkSegmentsIntoSegments(mergedWithSegmentLinks, linksFromMerged)
      ));
      setSegments(orderedSegments);
      setNotionHasUpdates(getNeedsSegmentationFromDocument(data?.document));

      const visualCount = mergedWithSegmentLinks.filter((segment) => hasVisualDecisionContent(segment.visual_decision)).length;
      const searchCount = mergedWithSegmentLinks.filter((segment) => hasSearchDecisionContent(segment.search_decision)).length;
      const diff = data?.segmentation_diff ?? null;
      const recoveryTarget =
        String(data?.state_recovery?.strategy ?? "").trim().toLowerCase() === "layered"
          ? data?.state_recovery?.layered?.stats ?? data?.state_recovery?.target ?? null
          : data?.state_recovery?.target ?? null;
      const recoverySummary = recoveryTarget
        ? ` Автовосстановление: done ${Number(recoveryTarget?.done_non_links ?? 0)}, media ${Number(
            recoveryTarget?.visual_media_segments ?? 0
          )}.`
        : "";
      if (diff && typeof diff === "object") {
        const added = Number(diff.added ?? 0);
        const changed = Number(diff.changed ?? 0);
        const same = Number(diff.same ?? 0);
        const removed = Number(diff.removed ?? 0);
        const preservedManual = Number(diff.preserved_manual ?? 0);
        const collapsedLinks = Number(diff.link_topics_collapsed ?? 0);
        setStatus(
          `Сегменты готовы: ${mergedWithSegmentLinks.length}. NEW +${added}, ~${changed}, =${same}, -${removed}. ` +
            `Ручные сохранены: ${preservedManual}. Схлопнуто дублей ссылок: ${collapsedLinks}. ` +
            `Ссылки к сегментам: ${segmentLinkHintsApplied}. Визуал: ${visualCount}. Поиск: ${searchCount}.` +
            recoverySummary
        );
      } else if (visualCount === 0 && searchCount === 0) {
        setStatus(
          `\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u044b \u0433\u043e\u0442\u043e\u0432\u044b: ${mergedWithSegmentLinks.length}. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u2728 \u0443 \u043d\u0443\u0436\u043d\u043e\u0439 \u0442\u0435\u043c\u044b, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c research \u043f\u043e \u0442\u0435\u043c\u0435.` +
            recoverySummary
        );
      } else {
        setStatus(
          `\u0421\u0435\u0433\u043c\u0435\u043d\u0442\u044b \u0433\u043e\u0442\u043e\u0432\u044b: ${mergedWithSegmentLinks.length}. ` +
            `Ссылки к сегментам: ${segmentLinkHintsApplied}. Визуал: ${visualCount}. Поиск: ${searchCount}.` +
            recoverySummary
        );
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleRecoverSegmentState = React.useCallback(async () => {
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId) return;
    if (hasUnsavedChanges && typeof window !== "undefined") {
      const shouldContinue = window.confirm(
        "Есть несохраненные локальные правки. Восстановление перезагрузит документ из backend. Продолжить?"
      );
      if (!shouldContinue) return;
    }

    setLoading(true);
    setStatus("Проверка истории состояния...");
    try {
      const dryRun = await fetchJsonSafe(`/api/documents/${normalizedDocId}/segment-state:recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: false })
      });
      if (!dryRun.response.ok) {
        throw new Error(dryRun.data?.error ?? "Не удалось проверить восстановление состояния");
      }

      const suggestedStats =
        dryRun.data?.strategy === "layered" ? dryRun.data?.layered?.stats ?? null : dryRun.data?.selected?.stats ?? null;
      if (!suggestedStats) {
        throw new Error("Не нашлось подходящей версии для восстановления");
      }

      if (typeof window !== "undefined") {
        const currentStats = dryRun.data?.current ?? {};
        const strategyLabel = dryRun.data?.strategy === "layered" ? "layered" : "single";
        const confirmation = window.confirm(
          `Восстановить состояние из истории?\n` +
            `Done: ${Number(currentStats.done_non_links ?? 0)} -> ${Number(suggestedStats.done_non_links ?? 0)}\n` +
            `Media: ${Number(currentStats.visual_media_segments ?? 0)} -> ${Number(suggestedStats.visual_media_segments ?? 0)}\n` +
            `Strategy: ${strategyLabel}`
        );
        if (!confirmation) {
          setStatus("Восстановление отменено.");
          return;
        }
      }

      setStatus("Восстановление состояния...");
      const applied = await fetchJsonSafe(`/api/documents/${normalizedDocId}/segment-state:recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true })
      });
      if (!applied.response.ok) {
        throw new Error(applied.data?.error ?? "Не удалось восстановить состояние");
      }

      await loadDocumentById(normalizedDocId, { silent: true });
      const appliedStats =
        applied.data?.strategy === "layered" ? applied.data?.layered?.stats ?? null : applied.data?.selected?.stats ?? null;
      const doneCount = Number(appliedStats?.done_non_links ?? 0);
      const mediaCount = Number(appliedStats?.visual_media_segments ?? 0);
      setStatus(`Состояние восстановлено: done ${doneCount}, media ${mediaCount}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }, [docId, fetchJsonSafe, hasUnsavedChanges, loadDocumentById]);
  const handleSave = async () => {
    if (!docId) return;
    setLoading(true);
    setStatus("Сохранение...");
    try {
      await saveSessionSnapshot(buildSessionPayload(), "manual");
      setStatus("Сохранено.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };
  const handleConfigureXmlMediaRoot = () => {
    const run = async () => {
      const storageKey = "vbaut.xmlMediaRoot";
      let recentRoots = [];
      let savedRoot = String(window.localStorage.getItem(storageKey) ?? "").trim();
      try {
        const response = await fetch("/api/settings/xml-export");
        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          const serverRoot = String(data?.xml_media_root ?? "").trim();
          const serverRecent = Array.isArray(data?.xml_media_roots_recent)
            ? data.xml_media_roots_recent.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 3)
            : [];
          recentRoots = serverRecent;
          if (!savedRoot && serverRoot) {
            savedRoot = serverRoot;
          }
        }
      } catch {
        // ignore and keep local fallback
      }

      const hintLines = recentRoots.length
        ? [
            "",
            "Недавние пути:",
            ...recentRoots.map((item, index) => `${index + 1}) ${item}`),
            "Введи путь или 1/2/3. Пусто = сброс."
          ]
        : ["", "Введи путь. Пусто = сброс."];
      const inputRoot = window.prompt(
        `Папка медиа для XML (сохранится для следующих экспортов).${hintLines.join("\n")}`,
        savedRoot
      );
      if (inputRoot === null) return;
      const rawInput = String(inputRoot ?? "").trim();
      const numericChoice = Number(rawInput);
      const xmlMediaRoot =
        /^[1-3]$/.test(rawInput) && Number.isFinite(numericChoice) && recentRoots[numericChoice - 1]
          ? recentRoots[numericChoice - 1]
          : rawInput;
      window.localStorage.setItem(storageKey, xmlMediaRoot);

      const response = await fetch("/api/settings/xml-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xml_media_root: xmlMediaRoot })
      }).catch(() => null);
      if (response && !response.ok) {
        const rawText = await response.text().catch(() => "");
        throw new Error(rawText || "Не удалось сохранить путь XML на сервере");
      }

      if (xmlMediaRoot) {
        setStatus(`Путь XML медиа сохранен: ${xmlMediaRoot}`);
      } else {
        setStatus("Путь XML медиа очищен.");
      }
    };
    void run().catch((error) => setStatus(error.message));
  };
  const handleExport = async (format, options = {}) => {
    if (!docId) {
      setStatus("Сначала создайте или загрузите документ.");
      return;
    }
    try {
      setStatus(`Экспорт ${format.toUpperCase()}...`);
      const params = new URLSearchParams();
      params.set("format", String(format ?? "").toLowerCase());
      if (options?.scope) params.set("scope", String(options.scope));
      if (options?.section_id) params.set("section_id", String(options.section_id));
      if (options?.section_title) params.set("section_title", String(options.section_title));
      if (Array.isArray(options?.segment_ids) && options.segment_ids.length > 0) {
        params.set(
          "segment_ids",
          options.segment_ids
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
            .join(",")
        );
      }
      if (String(format ?? "").toLowerCase() === "xml") {
        const storageKey = "vbaut.xmlMediaRoot";
        let xmlMediaRoot = String(window.localStorage.getItem(storageKey) ?? "").trim();
        if (!xmlMediaRoot) {
          const settingsResponse = await fetch("/api/settings/xml-export").catch(() => null);
          if (settingsResponse?.ok) {
            const settingsData = await settingsResponse.json().catch(() => ({}));
            xmlMediaRoot = String(settingsData?.xml_media_root ?? "").trim();
            if (xmlMediaRoot) {
              window.localStorage.setItem(storageKey, xmlMediaRoot);
            }
          }
        }
        if (xmlMediaRoot) {
          params.set("xml_media_root", xmlMediaRoot);
        }
      }
      const response = await fetch(`/api/documents/${docId}/export?${params.toString()}`);
      if (!response.ok) {
        const rawText = await response.text().catch(() => "");
        let data = null;
        if (shouldLookLikeJson(rawText)) {
          try {
            data = JSON.parse(rawText);
          } catch {
            data = null;
          }
        }
        throw new Error(data?.error ?? `Ошибка экспорта ${format.toUpperCase()}`);
      }
      const blob = await response.blob();
      const ext = format === "jsonl" ? "jsonl" : format === "xml" ? "xml" : "md";
      const fileNameFromHeader = getFileNameFromDisposition(response.headers.get("content-disposition"));
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromHeader || `${docId}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus(`Экспорт готов: ${link.download}`);
    } catch (error) {
      setStatus(error.message);
    }
  };
  const handleAddSegment = () => {
    setSegments((prev) => {
      const last = [...prev].reverse().find((segment) => segment.block_type !== "links");
      const section = last
        ? {
            section_id: last.section_id ?? null,
            section_title: last.section_title ?? null,
            section_index: last.section_index ?? null,
            research_use_topic_title: Boolean(last?.research_use_topic_title),
            research_use_theme_tags: Boolean(last?.research_use_theme_tags),
            topic_tags: normalizeSegmentTagList(last.topic_tags ?? last.section_tags ?? []),
            section_tags: normalizeSegmentTagList(last.section_tags ?? last.topic_tags ?? [])
          }
        : {};
      return [...prev, emptySegment(prev.length + 1, section)];
    });
  };
  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
    setGroupRenderLimits((prev) => {
      if (prev[groupId]) return prev;
      return { ...prev, [groupId]: GROUP_RENDER_CHUNK };
    });
  };
  const handleShowMore = React.useCallback((groupId) => {
    setGroupRenderLimits((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? GROUP_RENDER_CHUNK) + GROUP_RENDER_CHUNK
    }));
  }, []);
  const translateHeadingQuery = React.useCallback(
    async (groupId, sourceText, options = {}) => {
      const ruQuery = String(sourceText ?? "").trim();
      if (!ruQuery) return;
      const force = Boolean(options?.force);
      const currentEn = String(headingEnglishQueries[groupId] ?? "").trim();
      if (!force && currentEn && currentEn !== ruQuery) return;
      if (headingTranslateLoading[groupId]) return;

      setHeadingTranslateLoading((prev) => ({ ...prev, [groupId]: true }));
      try {
        const { response, data } = await fetchJsonSafe("/api/search/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: ruQuery })
        });
        if (!response.ok) throw new Error(data?.error ?? "Ошибка перевода EN query");
        const translated = String(data?.text ?? "").trim();
        if (!translated) return;
        setHeadingEnglishQueries((prev) => ({ ...prev, [groupId]: translated }));
      } catch (error) {
        setStatus(error.message);
      } finally {
        setHeadingTranslateLoading((prev) => {
          const next = { ...prev };
          delete next[groupId];
          return next;
        });
      }
    },
    [headingEnglishQueries, headingTranslateLoading]
  );
  const toggleHeadingSearch = React.useCallback(
    (groupId, ruQuery, enQuery) => {
      setHeadingSearchOpen((prev) => {
        const nextOpen = !prev[groupId];
        if (nextOpen) {
          const ru = String(ruQuery ?? "").trim();
          const en = String(enQuery ?? "").trim();
          if (ru && (!en || en === ru)) {
            void translateHeadingQuery(groupId, ru);
          }
        }
        return { ...prev, [groupId]: nextOpen };
      });
    },
    [translateHeadingQuery]
  );
  const handleHeadingEnglishQueryChange = React.useCallback((groupId, value) => {
    setHeadingEnglishQueries((prev) => ({ ...prev, [groupId]: value }));
  }, []);
  const handleRemoveSegment = React.useCallback((index) => {
    setSegments((prev) => prev.filter((_, idx) => idx !== index));
  }, []);
  const handleToggleSegmentDone = React.useCallback((index, isDone) => {
    setSegments((prev) => {
      const next = prev.map((segment, idx) =>
        idx === index ? { ...segment, is_done: Boolean(isDone) } : segment
      );
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "toggle_done").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleToggleGroupDone = React.useCallback((groupId, isDone) => {
    setSegments((prev) => {
      const next = prev.map((segment) => {
        if (normalizeSegmentBlockType(segment.block_type) === "links") return segment;
        if (getSegmentGroupKey(segment) !== groupId) return segment;
        return { ...segment, is_done: Boolean(isDone) };
      });
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "toggle_group_done").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleMarkAllDone = React.useCallback(() => {
    setSegments((prev) => {
      const next = prev.map((segment) =>
        normalizeSegmentBlockType(segment.block_type) === "links"
          ? segment
          : { ...segment, is_done: true }
      );
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "mark_all_done").catch(() => null);
      }
      return next;
    });
    setStatus("Все сегменты отмечены как сделано.");
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleAddLinksBlock = React.useCallback((group) => {
    setSegments((prev) => {
      const exists = prev.some(
        (segment) => segment.block_type === "links" && getSegmentGroupKey(segment) === group.id
      );
      if (exists) return prev;
      const isUntitled = group.id === "untitled";
      const linkSegment = {
        segment_id: group.section_id ? `links_${group.section_id}` : `links_${Date.now()}`,
        block_type: "links",
        text_quote: "",
        links: [],
        section_id: group.section_id ?? null,
        section_title: isUntitled ? null : group.section_title ?? group.title ?? null,
        section_index: group.section_index ?? null,
        research_use_topic_title: Boolean(group?.research_use_topic_title),
        research_use_theme_tags: Boolean(group?.research_use_theme_tags),
        topic_tags: normalizeSegmentTagList(group.topic_tags ?? group.section_tags ?? []),
        section_tags: normalizeSegmentTagList(group.section_tags ?? group.topic_tags ?? []),
        segment_status: null,
        visual_decision: emptyVisualDecision(),
        search_decision: emptySearchDecision(),
        search_open: false,
        is_done: false,
      };
      const next = [...prev, linkSegment];
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "add_links_block").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleLinkAdd = React.useCallback((segmentIndex) => {
    setSegments((prev) => {
      const next = prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? [...segment.links] : [];
        links.push({ url: "", raw: null });
        return { ...segment, links };
      });
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "link_add").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleLinkUpdate = React.useCallback((segmentIndex, linkIndex, value) => {
    setSegments((prev) => {
      const next = prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? [...segment.links] : [];
        if (!links[linkIndex]) links[linkIndex] = { url: "", raw: null };
        links[linkIndex] = { ...links[linkIndex], url: value };
        return { ...segment, links };
      });
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "link_update").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleLinkRemove = React.useCallback((segmentIndex, linkIndex) => {
    setSegments((prev) => {
      const next = prev.map((segment, idx) => {
        if (idx !== segmentIndex) return segment;
        const links = Array.isArray(segment.links) ? segment.links.filter((_, i) => i !== linkIndex) : [];
        return { ...segment, links };
      });
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        saveSessionSnapshot(snapshot, "link_remove").catch(() => null);
      }
      return next;
    });
  }, [docId, notionUrl, saveSessionSnapshot, scriptText]);
  const handleInsertAfter = React.useCallback((index) => {
    setSegments((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const source = prev[index];
      const baseId = getSubSegmentBaseId(source.segment_id);
      const newId = getNextSubSegmentId(prev, baseId);
      const sourceVisual = source?.visual_decision ?? emptyVisualDecision();
      const sourceSearch = source?.search_decision ?? emptySearchDecision();
      const newSegment = {
        ...source,
        segment_id: newId,
        block_type: normalizeSegmentBlockType(source?.block_type),
        text_quote: "",
        section_id: source.section_id ?? null,
        section_title: source.section_title ?? null,
        section_index: source.section_index ?? null,
        research_use_topic_title: Boolean(source?.research_use_topic_title),
        research_use_theme_tags: Boolean(source?.research_use_theme_tags),
        topic_tags: normalizeSegmentTagList(source.topic_tags ?? source.section_tags ?? []),
        section_tags: normalizeSegmentTagList(source.section_tags ?? source.topic_tags ?? []),
        links: Array.isArray(source?.links) ? dedupeLinks(source.links) : [],
        visual_decision: {
          ...sourceVisual,
          media_file_paths: normalizeMediaFilePathList(sourceVisual?.media_file_paths ?? sourceVisual?.media_file_path ?? null),
          media_file_timecodes: normalizeMediaFileTimecodes(
            sourceVisual?.media_file_timecodes ?? {},
            sourceVisual?.media_file_paths ?? sourceVisual?.media_file_path ?? null
          )
        },
        search_decision: {
          ...sourceSearch,
          keywords: Array.isArray(sourceSearch?.keywords) ? [...sourceSearch.keywords] : [],
          queries: Array.isArray(sourceSearch?.queries) ? [...sourceSearch.queries] : []
        },
        search_open: Boolean(source?.search_open),
        is_done: Boolean(source?.is_done),
        segment_status: null,
        version: 1
      };
      const next = [...prev];
      next.splice(index + 1, 0, newSegment);
      return next;
    });
  }, []);
  const updateSegment = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, ...(updates ?? {}) } : segment
      )
    );
  }, []);
  const updateVisual = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? (() => {
              const nextVisual = { ...segment.visual_decision, ...(updates ?? {}) };
              if (updates && Object.prototype.hasOwnProperty.call(updates, "type")) {
                const nextType = String(updates.type ?? "").trim().toLowerCase();
                const defaults = getVisualDefaultsByType(nextType, config);
                const hasFormatOverride = Object.prototype.hasOwnProperty.call(updates, "format_hint");
                const hasPriorityOverride = Object.prototype.hasOwnProperty.call(updates, "priority");
                if (!hasFormatOverride) nextVisual.format_hint = defaults.format_hint;
                if (!hasPriorityOverride) nextVisual.priority = defaults.priority;
                if (nextType === "no_visual") {
                  return {
                    ...segment,
                    visual_decision: {
                      ...nextVisual,
                      ...defaults,
                      description: "",
                      media_file_path: null,
                      media_file_paths: [],
                      media_file_timecodes: {},
                      media_start_timecode: null
                    }
                  };
                }
              }
              let mediaPaths = normalizeMediaFilePathList(
                nextVisual.media_file_paths ?? nextVisual.media_file_path ?? null
              );
              if (updates && Object.prototype.hasOwnProperty.call(updates, "media_file_paths")) {
                mediaPaths = normalizeMediaFilePathList(updates.media_file_paths ?? []);
              } else if (updates && Object.prototype.hasOwnProperty.call(updates, "media_file_path")) {
                mediaPaths = normalizeMediaFilePathList(updates.media_file_path ?? null);
              }
              nextVisual.media_file_paths = mediaPaths;
              nextVisual.media_file_path = mediaPaths[0] ?? null;
              const videoMediaPaths = mediaPaths.filter((mediaPath) => isVideoMediaPath(mediaPath));
              let mediaFileTimecodes = normalizeMediaFileTimecodes(nextVisual.media_file_timecodes ?? {}, mediaPaths);
              if (updates && Object.prototype.hasOwnProperty.call(updates, "media_file_timecodes")) {
                mediaFileTimecodes = normalizeMediaFileTimecodes(updates.media_file_timecodes ?? {}, mediaPaths);
              } else if (updates && Object.prototype.hasOwnProperty.call(updates, "media_start_timecode")) {
                const firstVideoPath = videoMediaPaths[0] ?? null;
                const normalizedTimecode = normalizeMediaStartTimecode(updates.media_start_timecode ?? null);
                if (firstVideoPath && normalizedTimecode) {
                  mediaFileTimecodes[firstVideoPath] = normalizedTimecode;
                } else if (firstVideoPath) {
                  delete mediaFileTimecodes[firstVideoPath];
                }
              }
              nextVisual.media_file_timecodes = mediaFileTimecodes;
              nextVisual.media_start_timecode = videoMediaPaths[0] ? mediaFileTimecodes[videoMediaPaths[0]] ?? null : null;
              return { ...segment, visual_decision: nextVisual };
            })()
          : segment
      )
    );
  }, [config]);
  const updateSearch = React.useCallback((index, updates) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? { ...segment, search_decision: { ...segment.search_decision, ...updates } }
          : segment
      )
    );
  }, []);
  const handleSearchToggle = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_open: !segment.search_open } : segment
      )
    );
  }, []);
  const handleClearSearch = React.useCallback((index) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index ? { ...segment, search_decision: emptySearchDecision() } : segment
      )
    );
  }, []);
  const handleQuoteChange = React.useCallback((index, value) => {
    setSegments((prev) =>
      prev.map((segment, idx) =>
        idx === index
          ? {
              ...segment,
              text_quote: value,
              visual_decision: {
                ...segment.visual_decision,
                duration_hint_sec: (() => {
                  const currentDuration = segment.visual_decision?.duration_hint_sec;
                  const previousAutoDuration = computeDurationHint(segment.text_quote);
                  const shouldAutoUpdate =
                    currentDuration === null ||
                    currentDuration === undefined ||
                    currentDuration === previousAutoDuration;
                  return shouldAutoUpdate ? computeDurationHint(value) : currentDuration;
                })()
              }
            }
          : segment
      )
    );
  }, []);
  const copyToClipboard = React.useCallback((value, successMessage = "Запрос скопирован.") => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => setStatus(successMessage),
        () => setStatus("Не удалось скопировать запрос.")
      );
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      setStatus(successMessage);
    } catch {
      setStatus("Не удалось скопировать запрос.");
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);
  const handleSearch = React.useCallback(
    (engine, query) => {
      if (!engine || !query) return;
      const normalizedQuery = sanitizeSearchQueryText(query, engine.id);
      if (!normalizedQuery) return;
      if (engine.action === "copy_open") {
        copyToClipboard(normalizedQuery, "Запрос скопирован и открыт Perplexity.");
        if (engine.url) {
          window.open(engine.url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (!engine.url) return;
      const suffix = engine.suffix ?? "";
      const url = `${engine.url}${encodeURIComponent(normalizedQuery)}${suffix}`;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [copyToClipboard]
  );
  const handleGenerateSearch = React.useCallback(
    async (index) => {
      const segment = segments[index];
      if (!segment) return;
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return;
      }
      const segmentId = segment.segment_id;
      if (searchLoading[segmentId]) return;
      setSearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`Поиск: ${segmentId}...`);
      try {
        const { response, data } = await fetchJsonSafe(`/api/documents/${docId}/search:generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            segment: {
              segment_id: segment.segment_id,
              block_type: "news",
              text_quote: segment.text_quote,
              visual_decision: segment.visual_decision
            }
          })
        });
        if (!response.ok) throw new Error(data?.error ?? "Ошибка генерации поиска");
        const decision = data?.decisions?.[0];
        if (!decision) throw new Error("Поиск: решение не пришло");
        setSegments((prev) =>
          prev.map((item, idx) =>
            idx === index
              ? {
                  ...item,
                  visual_decision: normalizeVisualDecision(decision.visual_decision, config),
                  search_decision: normalizeSearchDecision(decision.search_decision, config),
                  search_open: true
                }
              : item
          )
        );
        setStatus(`Поиск: ${decision.segment_id} готов.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, searchLoading, segments]
  );
  const handleRunSegmentResearch = React.useCallback(
    async (index, mode = "deep", options = {}) => {
      const segment = segments[index];
      if (!segment) return null;
      if (!docId) {
        setStatus("Сначала создайте или загрузите документ.");
        return null;
      }
      const segmentId = String(segment.segment_id ?? "").trim();
      if (!segmentId || segmentResearchLoading[segmentId]) return null;
      const normalizedMode = String(mode ?? "deep").trim().toLowerCase() === "fast" ? "fast" : "deep";
      const excludeSeen = Boolean(options?.excludeSeen);
      const override = options?.segmentOverride && typeof options.segmentOverride === "object" ? options.segmentOverride : {};
      setSegmentResearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      setStatus(`${excludeSeen ? "Research rerun" : "Research"}: ${segmentId}...`);
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: normalizedMode,
              exclude_seen: excludeSeen,
              segment_override: {
                segment_id: segment.segment_id,
                section_id: override?.section_id ?? segment.section_id ?? null,
                section_title: override?.section_title ?? segment.section_title ?? null,
                text_quote: override?.text_quote ?? segment.text_quote ?? "",
                research_use_topic_title: override?.research_use_topic_title ?? Boolean(segment?.research_use_topic_title),
                research_use_theme_tags: override?.research_use_theme_tags ?? Boolean(segment?.research_use_theme_tags),
                topic_tags: normalizeSegmentTagList(override?.topic_tags ?? segment.topic_tags ?? segment.section_tags ?? []),
                section_tags: normalizeSegmentTagList(override?.section_tags ?? segment.section_tags ?? segment.topic_tags ?? [])
              }
            })
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Не удалось запустить research");
        if (data?.run) {
          setSegmentResearchRuns((prev) => ({ ...prev, [segmentId]: data.run }));
          setSegmentResearchHistory((prev) => mergeResearchRunHistory(prev, data.run));
          setStatus(
            `${excludeSeen ? "Research rerun" : "Research"}: ${segmentId} · ${
              Array.isArray(data.run.ranked_results) ? data.run.ranked_results.length : 0
            } candidates`
          );
          return data.run;
        }
        return null;
      } catch (error) {
        setStatus(error.message);
        return null;
      } finally {
        setSegmentResearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [docId, mergeResearchRunHistory, segmentResearchLoading, segments]
  );
  const handleAiHelp = React.useCallback(
    async (groupId) => {
      if (!docId) {
        setStatus("\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0441\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0438\u043b\u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442.");
        return;
      }
      const group = groupedSegments.find((item) => item.id === groupId);
      if (!group) {
        setStatus("Не удалось определить тему для research.");
        return;
      }

      const themeTitle = group.title === "Без темы" ? "" : String(group.title ?? "").trim();
      const themeTags = normalizeSegmentTagList(group.topic_tags ?? group.section_tags ?? []);
      const combinedQuote = [...new Set(
        group.items
          .map(({ segment }) => String(segment?.text_quote ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )]
        .slice(0, 6)
        .join(". ");
      const topicSeedText = combinedQuote || themeTitle || themeTags.join(", ");
      if (!topicSeedText && !themeTitle && themeTags.length === 0) {
        setStatus("В теме пока нет текста, заголовка или тегов для topic research.");
        return;
      }

      let anchorItem =
        group.items.find(({ segment }) => String(segment?.text_quote ?? "").trim()) ??
        group.items[0] ??
        group.topicResearchAnchor ??
        null;
      let anchorIndex = Number(anchorItem?.index ?? -1);
      let anchorSegment = anchorItem?.segment ?? null;
      let anchorSegmentId = String(anchorSegment?.segment_id ?? "").trim();

      if (!anchorSegmentId) {
        const sectionMeta = {
          section_id: group.section_id ?? null,
          section_title: themeTitle || (group.section_title ?? null),
          section_index: group.section_index ?? null,
          research_use_topic_title: Boolean(themeTitle),
          research_use_theme_tags: themeTags.length > 0,
          topic_tags: themeTags,
          section_tags: themeTags
        };
        const nextSegments = [...segments];
        const baseId = group.section_id ? `topic_${group.section_id}` : `topic_${Date.now()}`;
        let nextSegmentId = baseId;
        let suffix = 2;
        while (nextSegments.some((item) => String(item?.segment_id ?? "").trim() === nextSegmentId)) {
          nextSegmentId = `${baseId}_${suffix}`;
          suffix += 1;
        }
        const nextSegment = {
          ...emptySegment(nextSegments.length + 1, sectionMeta),
          segment_id: nextSegmentId,
          is_topic_research_anchor: true
        };
        const insertAt = Number.isFinite(Number(group?.linkSegment?.index))
          ? Math.max(0, Number(group.linkSegment.index) + 1)
          : nextSegments.length;
        nextSegments.splice(insertAt, 0, nextSegment);
        setSegments(nextSegments);
        anchorItem = { segment: nextSegment, index: insertAt };
        anchorIndex = insertAt;
        anchorSegment = nextSegment;
        anchorSegmentId = nextSegmentId;
        if (docId) {
          const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: nextSegments });
          saveSessionSnapshot(snapshot, "topic_research_anchor").catch(() => null);
        }
      }

      if (!anchorSegmentId || anchorIndex < 0) {
        setStatus("Не удалось определить сегмент-опору для topic research.");
        return;
      }

      const groupSegmentIds = [
        ...group.items
        .map(({ segment }) => String(segment?.segment_id ?? "").trim())
        .filter(Boolean),
        anchorSegmentId
      ];
      if (groupSegmentIds.some((id) => aiLoading[id])) return;

      setAiLoading((prev) => {
        const next = { ...prev };
        groupSegmentIds.forEach((id) => {
          next[id] = true;
        });
        return next;
      });
      setSelectedResearchSegmentId(anchorSegmentId);
      setSelectedResearchRunId("");
      setAppMode("research");

      try {
        const run = await handleRunSegmentResearch(anchorIndex, "deep", {
          segmentOverride: {
            section_id: anchorSegment?.section_id ?? group.section_id ?? null,
            section_title: themeTitle || (anchorSegment?.section_title ?? null),
            text_quote: topicSeedText || (anchorSegment?.text_quote ?? ""),
            research_use_topic_title: Boolean(themeTitle),
            research_use_theme_tags: themeTags.length > 0,
            topic_tags: themeTags,
            section_tags: themeTags
          }
        });
        if (run?.run_id) {
          setSelectedResearchRunId(String(run.run_id));
        }
      } finally {
        setAiLoading((prev) => {
          const next = { ...prev };
          groupSegmentIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
    },
    [aiLoading, docId, groupedSegments, handleRunSegmentResearch, notionUrl, saveSessionSnapshot, scriptText, segments]
  );
  const handleSelectSegmentResearchRun = React.useCallback(
    (index, runId) => {
      const segment = segments[index];
      if (!segment || !runId) return;
      const segmentId = String(segment.segment_id ?? "").trim();
      const selected = (segmentResearchHistory[segmentId] ?? []).find(
        (item) => String(item?.run_id ?? "") === String(runId)
      );
      if (!selected) return;
      setSegmentResearchRuns((prev) => ({
        ...prev,
        [segmentId]: selected
      }));
      setStatus(`Research: loaded ${segmentId} · ${String(selected.updated_at ?? selected.created_at ?? "").slice(0, 16).replace("T", " ")}`);
    },
    [segmentResearchHistory, segments]
  );
  const handleApplySegmentResearch = React.useCallback(
    async (index, action, resultId) => {
      const segment = segments[index];
      if (!segment || !docId || !resultId || !action) return;
      const segmentId = String(segment.segment_id ?? "").trim();
      const run = segmentResearchRuns[segmentId];
      const runId = String(run?.run_id ?? "").trim();
      if (!runId) {
        setStatus("Сначала запусти Research для сегмента.");
        return;
      }
      setSegmentResearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      try {
        const endpoint =
          action === "delete_result"
            ? `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/remove`
            : `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/apply`;
        const { response, data } = await fetchJsonSafe(
          endpoint,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              run_id: runId,
              result_id: resultId,
              ...(action === "delete_result" ? {} : { action })
            })
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Не удалось применить research result");
        if (data?.run) {
          setSegmentResearchRuns((prev) => ({ ...prev, [segmentId]: data.run }));
          setSegmentResearchHistory((prev) => mergeResearchRunHistory(prev, data.run));
        }
        if (action === "screenshot" && data?.screenshot_lab_url) {
          window.open(data.screenshot_lab_url, "_blank", "noopener,noreferrer");
        }
        if (action === "download" && data?.download_url) {
          await handleDownloadMedia(data.download_url, segment.section_title ?? null, {
            segmentId,
            runId,
            resultId,
            sourceTitle: String(data?.result?.title ?? "").trim(),
            sourceDomain: String(data?.result?.domain ?? "").trim(),
            textQuote: String(segment?.text_quote ?? "").trim()
          });
        }
        if (data?.decision) {
          setSegments((prev) =>
            prev.map((item) =>
              String(item?.segment_id ?? "") === segmentId
                ? {
                    ...item,
                    visual_decision: normalizeVisualDecision(data.decision.visual_decision, config),
                    search_decision: normalizeSearchDecision(data.decision.search_decision, config),
                    research_sources: normalizeResearchSources(data.decision.research_sources),
                    research_dismissed_urls: normalizeResearchDismissedUrls(data.decision.research_dismissed_urls),
                    research_bundle_trace: normalizeResearchBundleTrace(data.decision.research_bundle_trace)
                  }
                : item
            )
          );
        }
        if (action === "attach_asset" || action === "promote_to_decision" || action === "mark_helpful") {
          await refreshIntegration();
        }
        if (action === "delete_result") {
          setStatus("Research result removed.");
        } else if (action === "promote_to_decision" && data?.promoted_role) {
          setStatus(`Research promoted: ${String(data.promoted_role).replace(/_/g, " ")}`);
        } else if (action === "mark_helpful") {
          setStatus("Research candidate marked as helpful.");
        } else if (action === "duplicate_story") {
          setStatus("Research candidate marked as duplicate story.");
        } else if (action === "bad_visual") {
          setStatus("Research candidate marked as weak visual.");
        } else if (action === "screenshot_failed") {
          setStatus("Research candidate marked as screenshot failure.");
        } else if (action === "download_failed") {
          setStatus("Research candidate marked as download failure.");
        } else if (action === "paywall") {
          setStatus("Research candidate marked as paywalled.");
        } else if (action === "anti_bot") {
          setStatus("Research candidate marked as anti-bot blocked.");
        } else if (action === "age_gate") {
          setStatus("Research candidate marked as age-gated.");
        } else {
          setStatus(`Research action: ${action}`);
        }
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSegmentResearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, handleDownloadMedia, mergeResearchRunHistory, refreshIntegration, segmentResearchRuns, segments]
  );
  const handleApplyManySegmentResearch = React.useCallback(
    async (index, resultIds, action = "use_as_source") => {
      const segment = segments[index];
      const normalizedResultIds = [...new Set(
        (Array.isArray(resultIds) ? resultIds : []).map((item) => String(item ?? "").trim()).filter(Boolean)
      )];
      if (!segment || !docId || !normalizedResultIds.length) return;
      const segmentId = String(segment.segment_id ?? "").trim();
      const run = segmentResearchRuns[segmentId];
      const runId = String(run?.run_id ?? "").trim();
      if (!runId) {
        setStatus("Сначала запусти Research для сегмента.");
        return;
      }
      setSegmentResearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/apply-many`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              run_id: runId,
              action,
              result_ids: normalizedResultIds
            })
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Не удалось применить выбранные research links");
        if (data?.run) {
          setSegmentResearchRuns((prev) => ({ ...prev, [segmentId]: data.run }));
          setSegmentResearchHistory((prev) => mergeResearchRunHistory(prev, data.run));
        }
        if (data?.decision) {
          setSegments((prev) =>
            prev.map((item) =>
              String(item?.segment_id ?? "") === segmentId
                ? {
                    ...item,
                    visual_decision: normalizeVisualDecision(data.decision.visual_decision, config),
                    search_decision: normalizeSearchDecision(data.decision.search_decision, config),
                    research_sources: normalizeResearchSources(data.decision.research_sources),
                    research_dismissed_urls: normalizeResearchDismissedUrls(data.decision.research_dismissed_urls),
                    research_bundle_trace: normalizeResearchBundleTrace(data.decision.research_bundle_trace)
                  }
                : item
            )
          );
        }
        setStatus(`Added ${Number(data?.applied?.length ?? normalizedResultIds.length)} research link(s) to segment.`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setSegmentResearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, mergeResearchRunHistory, segmentResearchRuns, segments]
  );
  const handlePromoteSegmentResearchBundle = React.useCallback(
    async (index, sourceResultId, visualResultId) => {
      const segment = segments[index];
      if (!segment || !docId || !sourceResultId || !visualResultId) return;
      const segmentId = String(segment.segment_id ?? "").trim();
      const run = segmentResearchRuns[segmentId];
      const runId = String(run?.run_id ?? "").trim();
      if (!runId) {
        setStatus("Сначала запусти Research для сегмента.");
        return;
      }
      setSegmentResearchLoading((prev) => ({ ...prev, [segmentId]: true }));
      try {
        const { response, data } = await fetchJsonSafe(
          `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/apply-bundle`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              run_id: runId,
              source_result_id: sourceResultId,
              visual_result_id: visualResultId
            })
          }
        );
        if (!response.ok) throw new Error(data?.error ?? "Не удалось применить research bundle");
        if (data?.run) {
          setSegmentResearchRuns((prev) => ({ ...prev, [segmentId]: data.run }));
          setSegmentResearchHistory((prev) => mergeResearchRunHistory(prev, data.run));
        }
        if (data?.decision) {
          setSegments((prev) =>
            prev.map((item) =>
              String(item?.segment_id ?? "") === segmentId
                ? {
                    ...item,
                    visual_decision: normalizeVisualDecision(data.decision.visual_decision, config),
                    search_decision: normalizeSearchDecision(data.decision.search_decision, config),
                    research_sources: normalizeResearchSources(data.decision.research_sources),
                    research_dismissed_urls: normalizeResearchDismissedUrls(data.decision.research_dismissed_urls),
                    research_bundle_trace: normalizeResearchBundleTrace(data.decision.research_bundle_trace)
                  }
                : item
            )
          );
        }
        await refreshIntegration();
        const appliedCount = Number(data?.bundle?.applied?.length ?? 0);
        setStatus(appliedCount > 1 ? "Research bundle promoted: source + visual" : "Research promoted");
      } catch (error) {
        setStatus(error?.message ?? "Не удалось применить research bundle");
      } finally {
        setSegmentResearchLoading((prev) => {
          const next = { ...prev };
          delete next[segmentId];
          return next;
        });
      }
    },
    [config, docId, mergeResearchRunHistory, refreshIntegration, segmentResearchRuns, segments]
  );
  const handleCopy = React.useCallback((query) => {
    copyToClipboard(query);
  }, [copyToClipboard]);
  const handleCopySegmentResearchBrief = React.useCallback(
    async (index) => {
      const segment = segments[index];
      const segmentId = String(segment?.segment_id ?? "").trim();
      if (!docId || !segmentId) return;
      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(docId)}/segments/${encodeURIComponent(segmentId)}/research/brief?format=md`
        );
        if (!response.ok) {
          throw new Error("Не удалось получить research brief");
        }
        const text = await response.text();
        if (!String(text ?? "").trim()) {
          throw new Error("Research brief пуст");
        }
        copyToClipboard(text, `Research brief: ${segmentId} скопирован.`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось скопировать research brief");
      }
    },
    [copyToClipboard, docId, segments]
  );
  const handleUpdateResearchThemeTags = React.useCallback(
    async (segmentId, value) => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!normalizedSegmentId) return;
      const nextTags = normalizeSegmentTagList(value);
      const sourceSegment = segments.find((item) => String(item?.segment_id ?? "").trim() === normalizedSegmentId);
      if (!sourceSegment) {
        setStatus("Не удалось обновить теги темы.");
        return;
      }
      const sectionId = String(sourceSegment?.section_id ?? "").trim();
      const titleKey = normalizeSectionTitleForMerge(sourceSegment?.section_title ?? "");
      let applied = 0;
      const next = segments.map((item) => {
        const sameSectionId = sectionId && String(item?.section_id ?? "").trim() === sectionId;
        const sameTitle = !sectionId && titleKey && normalizeSectionTitleForMerge(item?.section_title ?? "") === titleKey;
        if (!sameSectionId && !sameTitle) return item;
        applied += 1;
        return {
          ...item,
          topic_tags: [...nextTags],
          section_tags: [...nextTags]
        };
      });
      setSegments(next);
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        await saveSessionSnapshot(snapshot, "theme_tags").catch(() => null);
      }
      setStatus(applied ? "Теги темы обновлены." : "Не удалось обновить теги темы.");
    },
    [docId, notionUrl, saveSessionSnapshot, scriptText, segments]
  );
  const handleEditThemeTags = React.useCallback(
    (groupId) => {
      const group = groupedSegments.find((item) => item.id === groupId);
      if (!group) {
        setStatus("В этой теме нет данных для тегов.");
        return;
      }
      const anchorSegmentId = String(
        group.items[0]?.segment?.segment_id ??
          group.topicResearchAnchor?.segment?.segment_id ??
          group.linkSegment?.segment?.segment_id ??
          ""
      ).trim();
      if (!anchorSegmentId) {
        setStatus("Не удалось определить тему для тегов.");
        return;
      }
      if (typeof window === "undefined" || typeof window.prompt !== "function") return;
      const currentValue = normalizeSegmentTagList(group.topic_tags ?? group.section_tags ?? []).join(", ");
      const nextValue = window.prompt("Теги темы через запятую или с новой строки", currentValue);
      if (nextValue === null) return;
      void handleUpdateResearchThemeTags(anchorSegmentId, nextValue);
    },
    [groupedSegments, handleUpdateResearchThemeTags]
  );
  const handleUpdateResearchThemeContext = React.useCallback(
    async (segmentId, payload = {}) => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!normalizedSegmentId) return;
      const nextTags = normalizeSegmentTagList(payload?.themeTags ?? []);
      const nextUseTopicTitle = Boolean(payload?.research_use_topic_title);
      const nextUseThemeTags = Boolean(payload?.research_use_theme_tags);
      const sourceSegment = segments.find((item) => String(item?.segment_id ?? "").trim() === normalizedSegmentId);
      if (!sourceSegment) {
        setStatus("Не удалось обновить research context темы.");
        return;
      }
      const sectionId = String(sourceSegment?.section_id ?? "").trim();
      const titleKey = normalizeSectionTitleForMerge(sourceSegment?.section_title ?? "");
      let applied = 0;
      const next = segments.map((item) => {
        const sameSectionId = sectionId && String(item?.section_id ?? "").trim() === sectionId;
        const sameTitle = !sectionId && titleKey && normalizeSectionTitleForMerge(item?.section_title ?? "") === titleKey;
        if (!sameSectionId && !sameTitle) return item;
        applied += 1;
        return {
          ...item,
          research_use_topic_title: nextUseTopicTitle,
          research_use_theme_tags: nextUseThemeTags,
          topic_tags: [...nextTags],
          section_tags: [...nextTags]
        };
      });
      setSegments(next);
      if (docId) {
        const snapshot = buildSessionPayloadFromState({ scriptText, notionUrl, segments: next });
        await saveSessionSnapshot(snapshot, "theme_context").catch(() => null);
      }
      setStatus(applied ? "Research context темы обновлён." : "Не удалось обновить research context темы.");
    },
    [docId, notionUrl, saveSessionSnapshot, scriptText, segments]
  );
  const handleCopyReleaseResearchBrief = React.useCallback(
    async (segmentId, runId = "") => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      const normalizedRunId = String(runId ?? "").trim();
      const activeDocId = String(selectedReleaseDetail?.document_id || docId || "").trim();
      if (!activeDocId || !normalizedSegmentId) return;
      try {
        const params = new URLSearchParams({ format: "md" });
        if (normalizedRunId) params.set("run_id", normalizedRunId);
        const response = await fetch(
          `/api/documents/${encodeURIComponent(activeDocId)}/segments/${encodeURIComponent(normalizedSegmentId)}/research/brief?${params.toString()}`
        );
        if (!response.ok) {
          throw new Error("Не удалось получить release segment brief");
        }
        const text = await response.text();
        if (!String(text ?? "").trim()) {
          throw new Error("Release segment brief пуст");
        }
        copyToClipboard(text, `Release segment brief: ${normalizedSegmentId} скопирован.`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось скопировать release segment brief");
      }
    },
    [copyToClipboard, docId, selectedReleaseDetail?.document_id]
  );
  const handleOpenResearchWorkspace = React.useCallback(
    (segmentId, runId = "") => {
      if (typeof window === "undefined") return;
      const query = new URLSearchParams();
      if (docId) query.set("doc_id", String(docId));
      if (segmentId) query.set("segment_id", String(segmentId));
      if (runId) query.set("run_id", String(runId));
      const queryText = query.toString();
      window.open(`/research${queryText ? `?${queryText}` : ""}`, "_blank", "noopener,noreferrer");
    },
    [docId]
  );
  const handleExitResearchMode = React.useCallback(() => {
    setAppMode("workspace");
  }, []);
  const handleCopyForFigma = React.useCallback(() => {
    const { blocks } = splitScriptIntoHeadingBlocks(scriptText);
    const topics = blocks
      .map((block) => normalizeHeadingForFigma(block.heading))
      .filter(Boolean);
    if (!topics.length) {
      setStatus("Нет тем для For Figma.");
      return;
    }
    copyToClipboard(topics.join("\n"), `For Figma: скопировано тем (${topics.length}).`);
  }, [copyToClipboard, scriptText]);
  const openScreenshotLabWithContext = React.useCallback(
    (urls, options = {}) => {
      const normalizedUrls = Array.isArray(urls)
        ? urls.map((item) => normalizeLinkUrl(item ?? "")).filter(Boolean)
        : String(urls ?? "")
            .split(/\r?\n/)
            .map((item) => normalizeLinkUrl(item))
            .filter(Boolean);
      if (!normalizedUrls.length) {
        setStatus("Ссылок для screenshot mode пока нет.");
        return;
      }
      const query = new URLSearchParams({
        urls: normalizedUrls.join("\n"),
        mode: "screenshot"
      });
      if (options.docId) query.set("doc_id", String(options.docId));
      if (options.releaseId) query.set("release_id", String(options.releaseId));
      if (options.segmentId) query.set("segment_id", String(options.segmentId));
      if (options.note) query.set("note", String(options.note));
      window.open(`/tools/screenshot-lab?${query.toString()}`, "_blank", "noopener,noreferrer");
    },
    [setStatus]
  );
  const handleOpenAllLinksScreenshotMode = React.useCallback(() => {
    openScreenshotLabWithContext(
      allScenarioLinks.map((item) => item?.url ?? ""),
      {
        docId,
        releaseId: selectedReleaseId,
        note: docId ? `Scenario links for ${docId}` : "Scenario links"
      }
    );
  }, [allScenarioLinks, docId, openScreenshotLabWithContext, selectedReleaseId]);
  const handleOpenSegmentScreenshotMode = React.useCallback(
    (segmentOrNeed) => {
      const target = segmentOrNeed?.segmentId
        ? segmentOrNeed
        : {
            segmentId: segmentOrNeed?.segment_id ?? "",
            sectionTitle: getSegmentGroupTitle(segmentOrNeed),
            quote: getQuotePreview(segmentOrNeed?.text_quote ?? "", 140),
            links: dedupeLinks(segmentOrNeed?.links ?? [])
              .map((item) => normalizeLinkUrl(item?.url ?? item ?? ""))
              .filter(Boolean)
          };
      if (!target?.links?.length) {
        setStatus("У этого сегмента пока нет ссылок для screenshot flow.");
        return;
      }
      openScreenshotLabWithContext(target.links, {
        docId,
        releaseId: selectedReleaseId,
        segmentId: target.segmentId,
        note: [target.sectionTitle, target.quote].filter(Boolean).join(" | ")
      });
    },
    [docId, openScreenshotLabWithContext, selectedReleaseId]
  );
  const selectedReleaseAssets = Array.isArray(selectedReleaseDetail?.assets) ? selectedReleaseDetail.assets : [];
  const handleOpenReleaseScreenshotMode = React.useCallback(() => {
    const urls = selectedReleaseAssets
      .map((item) => normalizeLinkUrl(item?.asset?.source_url ?? ""))
      .filter(Boolean);
    openScreenshotLabWithContext(urls, {
      docId: docId || selectedReleaseDetail?.document_id || "",
      releaseId: selectedReleaseId,
      note: selectedReleaseDetail?.title ? `Release ${selectedReleaseDetail.title}` : "Release links"
    });
  }, [docId, openScreenshotLabWithContext, selectedReleaseAssets, selectedReleaseDetail, selectedReleaseId]);
  const handleOpenProducerMode = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "producer");
    if (selectedReleaseId) {
      url.searchParams.set("release", selectedReleaseId);
    }
    window.open(`${url.pathname}${url.search}${url.hash}`, "_blank", "noopener,noreferrer");
  }, [selectedReleaseId]);
  const handleOpenOnAirMode = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "onair");
    if (selectedReleaseId) {
      url.searchParams.set("release", selectedReleaseId);
    }
    window.open(`${url.pathname}${url.search}${url.hash}`, "_blank", "noopener,noreferrer");
  }, [selectedReleaseId]);
  const handleExitProducerMode = React.useCallback(() => {
    setAppMode("workspace");
  }, []);
  const handleToggleFullscreen = React.useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => null);
      return;
    }
    document.exitFullscreen?.().catch(() => null);
  }, []);

  const {
    handleCreateRelease,
    handleAttachAssetToRelease,
    handleDetachAssetFromRelease,
    handleUpdateRelease,
    handleReorderReleaseAsset,
    handleUpdateReleaseAttachment
  } = useReleaseMutations({
    fetchJsonSafe,
    docId,
    selectedReleaseId,
    selectedReleaseDetail,
    releaseDraftTitle,
    releaseDraftDate,
    setReleaseDraftTitle,
    setReleaseDraftDate,
    setSelectedReleaseId,
    setReleaseBusy,
    setAssetActionBusy,
    setStatus,
    refreshIntegration,
    reloadCurrentReleaseWorkspace,
    syncReleaseWorkspaceDataFromAction
  });

  const scrollToWorkspaceSelector = React.useCallback((selector) => {
    if (typeof document === "undefined") return;
    const node = document.querySelector(selector);
    node?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);
  const handleOpenOwnerFocusRelease = React.useCallback(
    (releaseId) => {
      const normalizedId = String(releaseId ?? "").trim();
      if (!normalizedId) return;
      setSelectedReleaseId(normalizedId);
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          scrollToWorkspaceSelector(".newsroom-panel");
        }, 60);
      }
    },
    [scrollToWorkspaceSelector]
  );
  const handleOpenOwnerStorageHealth = React.useCallback(() => {
    scrollToWorkspaceSelector(".storage-health-card");
  }, [scrollToWorkspaceSelector]);
  const handleOpenOwnerSourceIntelligence = React.useCallback(() => {
    scrollToWorkspaceSelector(".source-profiles-card");
  }, [scrollToWorkspaceSelector]);
  const handleOpenOwnerNeedsVisual = React.useCallback(() => {
    scrollToWorkspaceSelector(".needs-visual-card");
  }, [scrollToWorkspaceSelector]);
  const handleOpenReleaseResearchSegment = React.useCallback(
    (segmentId, runId = "") => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      const normalizedRunId = String(runId ?? "").trim();
      if (!normalizedSegmentId) return;
      const targetGroup = groupedSegments.find((group) =>
        Array.isArray(group?.items) && group.items.some(({ segment }) => String(segment?.segment_id ?? "").trim() === normalizedSegmentId)
      );
      if (!targetGroup) {
        setStatus("Не удалось найти сегмент в текущем документе.");
        return;
      }
      const targetIndex = segments.findIndex(
        (segment) => String(segment?.segment_id ?? "").trim() === normalizedSegmentId
      );
      const groupId = String(targetGroup.id ?? "").trim();
      setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
      setGroupRenderLimits((prev) => ({
        ...prev,
        [groupId]: Math.max(prev?.[groupId] ?? GROUP_RENDER_CHUNK, targetGroup.items.length)
      }));
      if (targetIndex >= 0 && normalizedRunId) {
        const selectedRun = (segmentResearchHistory[normalizedSegmentId] ?? []).find(
          (item) => String(item?.run_id ?? "").trim() === normalizedRunId
        );
        if (selectedRun) {
          setSegmentResearchRuns((prev) => ({
            ...prev,
            [normalizedSegmentId]: selectedRun
          }));
          setStatus(
            `Research run loaded: ${normalizedSegmentId} · ${String(
              selectedRun.updated_at ?? selectedRun.created_at ?? ""
            )
              .slice(0, 16)
              .replace("T", " ")}`
          );
        } else {
          setStatus(`Не удалось найти research run ${normalizedRunId} для сегмента ${normalizedSegmentId}.`);
        }
      }
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          const node = document.querySelector(`[data-segment-id="${normalizedSegmentId.replace(/"/g, '\\"')}"]`);
          node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        }, 80);
      }
    },
    [groupedSegments, segmentResearchHistory, segments]
  );
  const handleOpenReleaseFromSegment = React.useCallback(
    (segmentId, options = {}) => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!normalizedSegmentId) return;
      const normalizedAttachmentId = String(options?.attachmentId ?? "").trim();
      const matchingBrief = Array.isArray(releaseResearchBriefs?.items)
        ? releaseResearchBriefs.items.find((item) => String(item?.segment_id ?? "").trim() === normalizedSegmentId)
        : null;
      const releaseDocumentId = String(selectedReleaseDetail?.document_id || docId || "").trim();
      const targetRelease =
        integrationReleases.find((release) => String(release?.document_id ?? "").trim() === releaseDocumentId) ||
        integrationReleases.find((release) => String(release?.id ?? "").trim() === String(selectedReleaseId ?? "").trim()) ||
        null;
      if (!matchingBrief && !targetRelease) {
        setStatus("Не удалось найти связанный выпуск для сегмента.");
        return;
      }
      if (targetRelease?.id) {
        setSelectedReleaseId(String(targetRelease.id));
      }
      if (normalizedAttachmentId) {
        setReleaseWorkspaceTab("rundown");
        setSelectedReleaseAttachmentIds([normalizedAttachmentId]);
      }
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          scrollToWorkspaceSelector(".newsroom-panel");
        }, 60);
      }
    },
    [
      docId,
      integrationReleases,
      releaseResearchBriefs,
      scrollToWorkspaceSelector,
      selectedReleaseDetail?.document_id,
      selectedReleaseId,
      setReleaseWorkspaceTab
    ]
  );

  const handleRefreshProducerView = React.useCallback(async () => {
    await reloadCurrentReleaseWorkspace({
      integration: true,
      recommendations: false,
      draftPack: false,
      publishChecklist: true,
      controlPanel: true,
      briefingPanel: true,
      activity: true
    });
  }, [reloadCurrentReleaseWorkspace]);
  const handleOpenAssetScreenshotMode = React.useCallback(
    (asset) => {
      const url = normalizeLinkUrl(asset?.source_url ?? "");
      if (!url) {
        setStatus("У этого asset нет ссылки для screenshot flow.");
        return;
      }
      openScreenshotLabWithContext([url], {
        docId,
        releaseId: selectedReleaseId,
        note: asset?.title || asset?.file_name || asset?.id || "Asset screenshot"
      });
    },
    [docId, openScreenshotLabWithContext, selectedReleaseId]
  );
  const handleThemeToggle = React.useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);
  const handleAssetStatusUpdate = React.useCallback(
    async (assetId, nextStatus) => {
      const normalizedStatus = String(nextStatus ?? "").trim();
      if (!assetId || !normalizedStatus) return;
      setAssetActionBusy((prev) => ({ ...prev, [assetId]: true }));
      try {
        const { response } = await fetchJsonSafe(`/api/assets/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: normalizedStatus })
        });
        if (!response.ok) throw new Error("Не удалось обновить статус asset");
        if (selectedReleaseId) {
          await reloadCurrentReleaseWorkspace({
            integration: true,
            detail: true,
            assistantPass: true,
            recommendations: true,
            draftPack: true,
            activity: true
          });
        } else {
          await refreshIntegration();
        }
        setStatus(`Asset ${assetId} -> ${normalizedStatus}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось обновить asset");
      } finally {
        setAssetActionBusy((prev) => ({ ...prev, [assetId]: false }));
      }
    },
    [loadReleaseActivity, loadReleaseAssistantPass, loadReleaseDetail, loadReleaseDraftPack, loadReleaseRecommendations, refreshIntegration, selectedReleaseId]
  );
  const handlePinReleaseResearchRun = React.useCallback(
    async (segmentId, runId = "") => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!selectedReleaseId || !normalizedSegmentId) return;
      const normalizedRunId = String(runId ?? "").trim();
      const currentPins =
        selectedReleaseDetail?.meta_json?.research_run_pins &&
        typeof selectedReleaseDetail.meta_json.research_run_pins === "object" &&
        !Array.isArray(selectedReleaseDetail.meta_json.research_run_pins)
          ? selectedReleaseDetail.meta_json.research_run_pins
          : {};
      const nextPins = Object.fromEntries(
        Object.entries(currentPins)
          .map(([key, value]) => [String(key ?? "").trim(), String(value ?? "").trim()])
          .filter(([key, value]) => Boolean(key) && Boolean(value))
      );
      if (normalizedRunId) nextPins[normalizedSegmentId] = normalizedRunId;
      else delete nextPins[normalizedSegmentId];
      await handleUpdateRelease({
        meta_json: {
          research_run_pins: nextPins
        }
      });
      setStatus(
        normalizedRunId
          ? `Pinned research run ${normalizedRunId} for ${normalizedSegmentId}`
          : `Unpinned research run for ${normalizedSegmentId}`
      );
    },
    [handleUpdateRelease, selectedReleaseDetail, selectedReleaseId]
  );
  const handleExportReleaseBrief = React.useCallback(
    async (format = "md") => {
      if (!selectedReleaseId) {
        setStatus("Сначала выбери выпуск.");
        return;
      }
      try {
        const normalizedFormat = String(format).toLowerCase();
        setStatus(
          normalizedFormat === "shotlist"
            ? "Экспорт shotlist..."
            : normalizedFormat === "media-package"
              ? "Экспорт media package..."
              : normalizedFormat === "copy-plan"
                ? "Экспорт copy plan..."
              : `Экспорт release brief ${String(format).toUpperCase()}...`
        );
        const response = await fetch(
          `/api/releases/${encodeURIComponent(selectedReleaseId)}/export?format=${encodeURIComponent(normalizedFormat)}`
        );
        if (!response.ok) {
          const rawText = await response.text().catch(() => "");
          let data = null;
          if (shouldLookLikeJson(rawText)) {
            try {
              data = JSON.parse(rawText);
            } catch {
              data = null;
            }
          }
          throw new Error(data?.error ?? "Ошибка экспорта выпуска");
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download =
          getFileNameFromDisposition(response.headers.get("content-disposition")) ||
          `${selectedReleaseId}-${
            normalizedFormat === "shotlist"
              ? "shotlist"
              : normalizedFormat === "media-package"
                ? "media-package"
                : normalizedFormat === "copy-plan"
                  ? "copy-plan"
                  : "brief"
          }.${normalizedFormat === "json" || normalizedFormat === "media-package" ? "json" : "md"}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        setStatus(`Экспорт готов: ${link.download}`);
      } catch (error) {
        setStatus(error?.message ?? "Не удалось экспортировать выпуск");
      }
    },
    [selectedReleaseId]
  );
  const {
    handleAttachOrphanScreenshots: releaseActionAttachOrphanScreenshots,
    handleAttachRecommendedBatch: releaseActionAttachRecommendedBatch,
    handleFillMissingVisualsWithRecommendations: releaseActionFillMissingVisualsWithRecommendations,
    handleBulkUpdateReleaseItems: releaseActionBulkUpdateReleaseItems,
    handleBulkApplyNoteTemplates: releaseActionBulkApplyNoteTemplates,
    handleBulkUpdateSelectedAssetStatus: releaseActionBulkUpdateSelectedAssetStatus,
    handleBulkDetachReleaseItems: releaseActionBulkDetachReleaseItems,
    handleApplySelectionDraftPack: releaseActionApplySelectionDraftPack,
    handleFillSelectedVisualsWithRecommendations: releaseActionFillSelectedVisualsWithRecommendations,
    handlePrepareSelectedReleaseItems: releaseActionPrepareSelectedReleaseItems,
    handlePrepareReleaseAttachment: releaseActionPrepareReleaseAttachment,
    handleDraftReleaseAttachment: releaseActionDraftReleaseAttachment,
    handleFillReleaseAttachmentVisuals: releaseActionFillReleaseAttachmentVisuals,
    handlePrepareRelease: releaseActionPrepareRelease,
    handleMarkReleaseAirReady: releaseActionMarkReleaseAirReady,
    handlePublishRelease: releaseActionPublishRelease,
    handleApplyReleaseDraftPack: releaseActionApplyReleaseDraftPack
  } = useReleaseAssistantActions({
    fetchJsonSafe,
    selectedReleaseId,
    selectedReleaseAttachmentIds,
    releaseBulkScriptTemplate,
    releaseBulkVisualTemplate,
    setReleaseBusy,
    setStatus,
    setLastAttachRecommendationsResult,
    setSelectedReleaseAttachmentIds,
    setReleasePublishChecklist,
    setReleaseControlPanel,
    rememberAssistantAutoBackup,
    syncCurrentReleaseActionData,
    reloadCurrentReleaseWorkspace
  });
  const handleAttachOrphanScreenshots = releaseActionAttachOrphanScreenshots;
  const handleAttachRecommendedBatch = releaseActionAttachRecommendedBatch;
  const handleFillMissingVisualsWithRecommendations = releaseActionFillMissingVisualsWithRecommendations;
  const toggleReleaseAttachmentSelection = React.useCallback((attachmentId) => {
    const normalizedId = String(attachmentId ?? "").trim();
    if (!normalizedId) return;
    setSelectedReleaseAttachmentIds((prev) =>
      prev.includes(normalizedId) ? prev.filter((item) => item !== normalizedId) : [...prev, normalizedId]
    );
  }, []);
  const handleSelectAllReleaseItems = React.useCallback(() => {
    const currentItems = Array.isArray(selectedReleaseDetail?.assets) ? selectedReleaseDetail.assets : [];
    setSelectedReleaseAttachmentIds(
      currentItems.map((item) => String(item?.attachment?.id ?? "").trim()).filter(Boolean)
    );
  }, [selectedReleaseDetail]);
  const handleClearReleaseSelection = React.useCallback(() => {
    setSelectedReleaseAttachmentIds([]);
  }, []);
  const handleFocusReleaseAttachment = React.useCallback((attachmentId) => {
    const normalizedId = String(attachmentId ?? "").trim();
    if (!normalizedId) return;
    setReleaseWorkspaceTab("rundown");
    setSelectedReleaseAttachmentIds([normalizedId]);
  }, []);
  const handleSelectReleaseItemsByFilter = React.useCallback((mode) => {
    const currentItems = Array.isArray(selectedReleaseDetail?.assets) ? selectedReleaseDetail.assets : [];
    const nextIds = currentItems
      .filter((item) => {
        if (mode === "missing_script") {
          return !String(item?.attachment?.script_note ?? "").trim();
        }
        if (mode === "missing_visual") {
          return !String(item?.attachment?.visual_note ?? "").trim();
        }
        return false;
      })
      .map((item) => String(item?.attachment?.id ?? "").trim())
      .filter(Boolean);
    setSelectedReleaseAttachmentIds(nextIds);
  }, [selectedReleaseDetail]);
  const handleBulkUpdateReleaseItems = React.useCallback(
    async (patch = {}, successLabel = "release items updated") => {
      await releaseActionBulkUpdateReleaseItems(patch, successLabel);
    },
    [releaseActionBulkUpdateReleaseItems]
  );
  const handleBulkApplyNoteTemplates = React.useCallback(
    async ({ overwrite = false } = {}) => {
      await releaseActionBulkApplyNoteTemplates({ overwrite });
    },
    [releaseActionBulkApplyNoteTemplates]
  );
  const handleBulkUpdateSelectedAssetStatus = React.useCallback(
    async (nextStatus, successLabel = "assets updated") => {
      await releaseActionBulkUpdateSelectedAssetStatus(nextStatus, successLabel);
    },
    [releaseActionBulkUpdateSelectedAssetStatus]
  );
  const handleBulkDetachReleaseItems = React.useCallback(async () => {
    await releaseActionBulkDetachReleaseItems();
  }, [releaseActionBulkDetachReleaseItems]);
  const handleApplySelectionDraftPack = React.useCallback(
    async (mode = "missing_only") => {
      await releaseActionApplySelectionDraftPack(mode);
    },
    [releaseActionApplySelectionDraftPack]
  );
  const handleFillSelectedVisualsWithRecommendations = React.useCallback(
    async () => {
      await releaseActionFillSelectedVisualsWithRecommendations();
    },
    [releaseActionFillSelectedVisualsWithRecommendations]
  );
  const handlePrepareSelectedReleaseItems = React.useCallback(
    async () => {
      await releaseActionPrepareSelectedReleaseItems();
    },
    [releaseActionPrepareSelectedReleaseItems]
  );
  const handlePrepareReleaseAttachment = React.useCallback(
    async (attachmentId) => {
      await releaseActionPrepareReleaseAttachment(attachmentId);
    },
    [releaseActionPrepareReleaseAttachment]
  );
  const handleDraftReleaseAttachment = React.useCallback(
    async (attachmentId, mode = "missing_only") => {
      await releaseActionDraftReleaseAttachment(attachmentId, mode);
    },
    [releaseActionDraftReleaseAttachment]
  );
  const handleFillReleaseAttachmentVisuals = React.useCallback(
    async (attachmentId) => {
      await releaseActionFillReleaseAttachmentVisuals(attachmentId);
    },
    [releaseActionFillReleaseAttachmentVisuals]
  );
  const handlePrepareRelease = React.useCallback(
    async () => {
      await releaseActionPrepareRelease();
    },
    [releaseActionPrepareRelease]
  );
  const handleMarkReleaseAirReady = React.useCallback(
    async () => {
      await releaseActionMarkReleaseAirReady();
    },
    [releaseActionMarkReleaseAirReady]
  );
  const handlePublishRelease = React.useCallback(
    async () => {
      await releaseActionPublishRelease();
    },
    [releaseActionPublishRelease]
  );
  const handleApplyReleaseDraftPack = React.useCallback(
    async (mode = "missing_only") => {
      await releaseActionApplyReleaseDraftPack(mode);
    },
    [releaseActionApplyReleaseDraftPack]
  );
  const normalizedIntegrationQuery = integrationQuery.trim().toLowerCase();
  const inboxAssets = integrationAssets
    .filter(
      (asset) =>
        Number(asset.attachment_count ?? 0) === 0 ||
        String(asset.processing_state ?? "").startsWith("pending")
    )
    .slice(0, 12);
  const filteredLibraryAssets = integrationAssets.filter((asset) => {
    if (integrationKind && asset.kind !== integrationKind) return false;
    if (integrationStatusFilter && asset.status !== integrationStatusFilter) return false;
    if (!normalizedIntegrationQuery) return true;
    const haystack = [
      asset.title,
      asset.description,
      asset.source_url,
      asset.file_name,
      asset.source_domain,
      asset.meta_json?.section_title
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedIntegrationQuery);
  });
  const {
    selectedReleaseAttachmentIdSet,
    selectedReleaseItems,
    filteredReleaseAssets,
    releaseBoardColumns,
    releaseBoardCounts,
    releaseSummary,
    releaseOrphanScreenshots,
    releaseAssistantFindings
  } = useReleaseBoardState({
    selectedReleaseAssets,
    selectedReleaseAttachmentIds,
    setSelectedReleaseAttachmentIds,
    releaseBoardFilter,
    normalizeLinkUrl,
    integrationAssets,
    selectedReleaseDetail,
    docId,
    selectedReleaseId,
    segmentsNeedingVisual
  });
  const effectiveReleaseAssistantFindings = Array.isArray(releaseAssistantPass?.findings)
    ? releaseAssistantPass.findings
    : releaseAssistantFindings;
  const effectiveOrphanScreenshotsCount =
    Number(releaseAssistantPass?.summary?.orphan_screenshots) || releaseOrphanScreenshots.length;
  const recommendedReleaseAssets = Array.isArray(releaseRecommendations?.candidates)
    ? releaseRecommendations.candidates
    : [];
  const releaseRecommendationSummary = releaseRecommendations?.summary ?? {
    total_candidates: 0,
    strong: 0,
    good: 0,
    possible: 0,
    missing_visual_focus: 0
  };
  const releaseDraftPackSummary = releaseDraftPack?.summary ?? {
    total: 0,
    script_candidates: 0,
    visual_candidates: 0
  };
  const releaseDraftPackItems = Array.isArray(releaseDraftPack?.items) ? releaseDraftPack.items : [];
  const releasePublishChecklistSummary = releasePublishChecklist?.summary ?? {
    total_checks: 0,
    passed: 0,
    warnings: 0,
    blocking_failures: 0
  };
  const releasePublishChecklistItems = Array.isArray(releasePublishChecklist?.checks)
    ? releasePublishChecklist.checks
    : [];
  const effectiveReleaseControlPanel = releaseControlPanel ?? {
    status_code: "not_ready",
    title: "Not Ready",
    detail: "Control panel is loading.",
    can_mark_air_ready: false,
    can_publish: false,
    actions: []
  };
  const effectiveReleaseBriefingPanel = releaseBriefingPanel ?? {
    headline: "Release briefing is loading.",
    summary_text: "",
    risks: [],
    next_steps: [],
    status_code: effectiveReleaseControlPanel.status_code
  };
  const effectiveReleaseResearchBriefs = releaseResearchBriefs ?? {
    summary: { total: 0 },
    items: []
  };
  const linkedReleaseSegmentIds = React.useMemo(
    () =>
      new Set(
        (Array.isArray(effectiveReleaseResearchBriefs?.items) ? effectiveReleaseResearchBriefs.items : [])
          .map((item) => String(item?.segment_id ?? "").trim())
          .filter(Boolean)
      ),
    [effectiveReleaseResearchBriefs]
  );
  const linkedReleaseHandoffByAttachmentId = React.useMemo(() => {
    const map = new Map();
    const register = (item) => {
      const attachmentId = String(item?.attachment_id ?? "").trim();
      if (!attachmentId || map.has(attachmentId)) return;
      map.set(attachmentId, {
        ready_state: String(item?.effective_ready_state ?? item?.ready_state ?? "").trim().toLowerCase(),
        picked_from: String(item?.picked_from ?? "").trim().toLowerCase()
      });
    };
    [
      ...(Array.isArray(effectiveReleaseBriefingPanel?.handoff_queue) ? effectiveReleaseBriefingPanel.handoff_queue : []),
      ...(Array.isArray(effectiveReleaseControlPanel?.handoff_queue) ? effectiveReleaseControlPanel.handoff_queue : []),
      ...(Array.isArray(effectiveReleaseBriefingPanel?.copy_plan_highlights)
        ? effectiveReleaseBriefingPanel.copy_plan_highlights
        : [])
    ].forEach(register);
    return map;
  }, [effectiveReleaseBriefingPanel, effectiveReleaseControlPanel]);
  const linkedReleaseResolvedHandoffByAttachmentId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(releaseActivity) ? releaseActivity : []).forEach((item) => {
      const event = String(item?.event ?? "").trim().toLowerCase();
      if (!["handoff_download_resolved", "handoff_capture_resolved"].includes(event)) return;
      const attachmentId = String(item?.attachment_id ?? item?.meta_json?.attachment_id ?? "").trim();
      if (!attachmentId || map.has(attachmentId)) return;
      map.set(attachmentId, {
        state: event === "handoff_download_resolved" ? "downloaded" : "captured",
        event,
        created_at: String(item?.created_at ?? "").trim()
      });
    });
    return map;
  }, [releaseActivity]);
  const linkedReleasePairSwitchByAttachmentId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(releaseActivity) ? releaseActivity : []).forEach((item) => {
      const event = String(item?.event ?? "").trim().toLowerCase();
      if (!["research_pick_applied", "manual_override"].includes(event)) return;
      const attachmentId = String(item?.attachment_id ?? item?.meta_json?.attachment_id ?? "").trim();
      if (!attachmentId || map.has(attachmentId)) return;
      map.set(attachmentId, item);
    });
    return map;
  }, [releaseActivity]);
  const linkedReleaseSnapshotBySegmentId = React.useMemo(() => {
    const map = new Map();
    selectedReleaseAssets.forEach((item) => {
      const segmentId = String(item?.asset?.meta_json?.segment_id ?? "").trim();
      if (!segmentId || map.has(segmentId)) return;
      const attachment = item?.attachment ?? {};
      const asset = item?.asset ?? {};
      const attachmentId = String(attachment?.id ?? "").trim();
      const handoffInfo = linkedReleaseHandoffByAttachmentId.get(attachmentId) ?? null;
      const localMediaPath = String(asset?.local_path ?? asset?.screenshot_path ?? "").trim();
      const resolvedEvent = linkedReleaseResolvedHandoffByAttachmentId.get(attachmentId) ?? null;
      const pairSwitchEvent = linkedReleasePairSwitchByAttachmentId.get(attachmentId) ?? null;
      const traceBadges = deriveReleaseTraceBadges(attachment).slice(0, 2);
      const hasScript = Boolean(String(attachment?.script_note ?? "").trim());
      const hasVisual = Boolean(String(attachment?.visual_note ?? "").trim());
      const trace = attachment?.assistant_trace_json ?? {};
      const researchBrief = Array.isArray(effectiveReleaseResearchBriefs?.items)
        ? effectiveReleaseResearchBriefs.items.find((entry) => String(entry?.segment_id ?? "").trim() === segmentId) ?? null
        : null;
      const primarySourceEntry = findReleaseResearchBriefEntryByRole(
        researchBrief,
        ["main_source", "backup_source", "reference"],
        ["source"]
      );
      const primaryVisualEntry = findReleaseResearchBriefEntryByRole(
        researchBrief,
        ["visual_candidate"],
        ["visual", "download"]
      );
      const backupSourceEntry = findReleaseResearchBackupEntry(researchBrief, primarySourceEntry, "source");
      const backupVisualEntry = findReleaseResearchBackupEntry(researchBrief, primaryVisualEntry, "visual");
      const resolvedState =
        String(resolvedEvent?.state ?? "").trim().toLowerCase() || (localMediaPath ? "ready" : "");
      const handoffState = String(handoffInfo?.ready_state ?? resolvedState ?? "").trim().toLowerCase();
      const itemStatus = String(attachment?.item_status ?? "planned");
      const currentSourceLabel = String(trace?.script?.title || primarySourceEntry?.title || primarySourceEntry?.label || "").trim();
      const currentVisualLabel = String(
        trace?.visual?.recommendation?.title || trace?.visual?.title || primaryVisualEntry?.title || primaryVisualEntry?.label || ""
      ).trim();
      const primarySourceLabel = String(primarySourceEntry?.title || primarySourceEntry?.label || primarySourceEntry?.domain || "").trim();
      const primaryVisualLabel = String(primaryVisualEntry?.title || primaryVisualEntry?.label || primaryVisualEntry?.domain || "").trim();
      const backupSourceLabel = String(backupSourceEntry?.title || backupSourceEntry?.label || backupSourceEntry?.domain || "").trim();
      const backupVisualLabel = String(backupVisualEntry?.title || backupVisualEntry?.label || backupVisualEntry?.domain || "").trim();
      const sourceMatchesMain =
        Boolean(currentSourceLabel) &&
        Boolean(primarySourceLabel) &&
        normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(primarySourceLabel);
      const sourceMatchesBackup =
        Boolean(currentSourceLabel) &&
        Boolean(backupSourceLabel) &&
        normalizeComparablePickLabel(currentSourceLabel) === normalizeComparablePickLabel(backupSourceLabel);
      const visualMatchesMain =
        Boolean(currentVisualLabel) &&
        Boolean(primaryVisualLabel) &&
        normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(primaryVisualLabel);
      const visualMatchesBackup =
        Boolean(currentVisualLabel) &&
        Boolean(backupVisualLabel) &&
        normalizeComparablePickLabel(currentVisualLabel) === normalizeComparablePickLabel(backupVisualLabel);
      const currentPairLabel =
        sourceMatchesMain && visualMatchesMain
          ? "Main Pair"
          : sourceMatchesBackup && visualMatchesBackup
            ? "Backup Pair"
            : (sourceMatchesMain || sourceMatchesBackup || visualMatchesMain || visualMatchesBackup)
              ? "Mixed Pair"
              : (currentSourceLabel || currentVisualLabel)
                ? "Custom Pair"
                : "";
      const currentSourceBasis = String(trace?.script?.source_type || "").trim().toLowerCase();
      const currentVisualBasis = String(
        trace?.visual?.source_type || (String(trace?.visual?.recommendation?.asset_id ?? "").trim() ? "assistant_recommendation" : "")
      )
        .trim()
        .toLowerCase();
      const currentPairHint =
        currentPairLabel === "Main Pair"
          ? "Aligned with main picks"
          : currentPairLabel === "Backup Pair"
            ? "Using backup picks"
            : currentPairLabel === "Mixed Pair"
              ? "Mixed main + backup"
              : currentVisualBasis === "assistant_recommendation"
                ? "Recommendation-backed override"
                : currentSourceBasis === "manual_override" || currentVisualBasis === "manual_override"
                  ? "Custom override"
                  : currentPairLabel
                    ? "Custom research mix"
                    : "";
      map.set(segmentId, {
        attachment_id: attachmentId,
        item_status: itemStatus,
        item_status_label: formatReleaseItemStatusLabel(itemStatus),
        has_script: hasScript,
        has_visual: hasVisual,
        current_source_label: currentSourceLabel,
        current_source_basis: currentSourceBasis,
        current_source_basis_label: formatReleasePickedFromLabel(trace?.script?.source_type || ""),
        current_visual_label: currentVisualLabel,
        current_visual_basis: currentVisualBasis,
        current_visual_basis_label: formatReleasePickedFromLabel(
          trace?.visual?.source_type || (String(trace?.visual?.recommendation?.asset_id ?? "").trim() ? "assistant_recommendation" : "")
        ),
        current_pair_label: currentPairLabel,
        current_pair_hint: currentPairHint,
        handoff_state: handoffState,
        handoff_state_label: formatReleaseReadyStateLabel(handoffState),
        handoff_basis: String(handoffInfo?.picked_from ?? "").trim().toLowerCase(),
        handoff_basis_label: formatReleasePickedFromLabel(handoffInfo?.picked_from ?? ""),
        last_handoff_event: String(resolvedEvent?.event ?? "").trim().toLowerCase(),
        last_handoff_event_label: formatReleaseHandoffEventLabel(resolvedEvent?.event ?? ""),
        last_handoff_event_relative: formatRelativeEventLabel(resolvedEvent?.created_at ?? ""),
        last_handoff_event_at: formatDateTimeShort(resolvedEvent?.created_at ?? ""),
        last_pair_switch_label: formatReleasePairSwitchLabel(pairSwitchEvent?.event, pairSwitchEvent?.meta_json),
        last_pair_switch_relative: formatRelativeEventLabel(pairSwitchEvent?.created_at ?? ""),
        last_pair_switch_at: formatDateTimeShort(pairSwitchEvent?.created_at ?? ""),
        trace_badges: traceBadges,
        research_brief: researchBrief,
        primary_source_entry: primarySourceEntry,
        primary_visual_entry: primaryVisualEntry,
        backup_source_entry: backupSourceEntry,
        backup_visual_entry: backupVisualEntry,
        primary_source_label: primarySourceLabel,
        primary_visual_label: primaryVisualLabel,
        backup_source_label: backupSourceLabel,
        backup_visual_label: backupVisualLabel,
        next_action_label: deriveLinkedReleaseNextAction({
          hasScript,
          hasVisual,
          handoffState,
          itemStatus
        })
      });
    });
    return map;
  }, [
    selectedReleaseAssets,
    linkedReleaseHandoffByAttachmentId,
    linkedReleaseResolvedHandoffByAttachmentId,
    linkedReleasePairSwitchByAttachmentId,
    effectiveReleaseResearchBriefs
  ]);
  const releaseBoardGroups = React.useMemo(() => {
    const groups = new Map(releaseBoardColumns.map((status) => [status, []]));
    filteredReleaseAssets.forEach((item) => {
      const key = String(item?.attachment?.item_status ?? "planned");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }, [filteredReleaseAssets, releaseBoardColumns]);
  const releaseScreenshotSourceCount = selectedReleaseAssets.filter((item) =>
    normalizeLinkUrl(item?.asset?.source_url ?? "")
  ).length;
  const handleUseLinkedReleaseBackup = React.useCallback(
    async (segmentId, kind = "source") => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      const normalizedKind = String(kind ?? "").trim().toLowerCase();
      if (!normalizedSegmentId || !["source", "visual"].includes(normalizedKind)) return;
      const snapshot = linkedReleaseSnapshotBySegmentId.get(normalizedSegmentId) ?? null;
      const attachmentId = String(snapshot?.attachment_id ?? "").trim();
      const releaseItem =
        attachmentId && Array.isArray(selectedReleaseAssets)
          ? selectedReleaseAssets.find((item) => String(item?.attachment?.id ?? "").trim() === attachmentId) ?? null
          : null;
      const brief = snapshot?.research_brief ?? null;
      const sourceEntry = normalizedKind === "source" ? snapshot?.backup_source_entry ?? null : null;
      const visualEntry = normalizedKind === "visual" ? snapshot?.backup_visual_entry ?? null : null;
      if (!attachmentId || !releaseItem?.asset?.id || !releaseItem?.attachment?.id || !brief || (!sourceEntry && !visualEntry)) {
        setStatus("Не удалось применить backup research для сюжета.");
        return;
      }
      const patch = buildReleaseResearchPickPatch(brief, { sourceEntry, visualEntry });
      await handleUpdateReleaseAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
    },
    [handleUpdateReleaseAttachment, linkedReleaseSnapshotBySegmentId, selectedReleaseAssets]
  );
  const handleUseLinkedReleasePrimary = React.useCallback(
    async (segmentId, kind = "source") => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      const normalizedKind = String(kind ?? "").trim().toLowerCase();
      if (!normalizedSegmentId || !["source", "visual"].includes(normalizedKind)) return;
      const snapshot = linkedReleaseSnapshotBySegmentId.get(normalizedSegmentId) ?? null;
      const attachmentId = String(snapshot?.attachment_id ?? "").trim();
      const releaseItem =
        attachmentId && Array.isArray(selectedReleaseAssets)
          ? selectedReleaseAssets.find((item) => String(item?.attachment?.id ?? "").trim() === attachmentId) ?? null
          : null;
      const brief = snapshot?.research_brief ?? null;
      const sourceEntry = normalizedKind === "source" ? snapshot?.primary_source_entry ?? null : null;
      const visualEntry = normalizedKind === "visual" ? snapshot?.primary_visual_entry ?? null : null;
      if (!attachmentId || !releaseItem?.asset?.id || !releaseItem?.attachment?.id || !brief || (!sourceEntry && !visualEntry)) {
        setStatus("Не удалось применить основной research для сюжета.");
        return;
      }
      const patch = buildReleaseResearchPickPatch(brief, { sourceEntry, visualEntry });
      await handleUpdateReleaseAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
    },
    [handleUpdateReleaseAttachment, linkedReleaseSnapshotBySegmentId, selectedReleaseAssets]
  );
  const handlePromoteLinkedReleasePrimaryPair = React.useCallback(
    async (segmentId) => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!normalizedSegmentId) return;
      const snapshot = linkedReleaseSnapshotBySegmentId.get(normalizedSegmentId) ?? null;
      const attachmentId = String(snapshot?.attachment_id ?? "").trim();
      const releaseItem =
        attachmentId && Array.isArray(selectedReleaseAssets)
          ? selectedReleaseAssets.find((item) => String(item?.attachment?.id ?? "").trim() === attachmentId) ?? null
          : null;
      const brief = snapshot?.research_brief ?? null;
      const sourceEntry = snapshot?.primary_source_entry ?? null;
      const visualEntry = snapshot?.primary_visual_entry ?? null;
      if (!attachmentId || !releaseItem?.asset?.id || !releaseItem?.attachment?.id || !brief || !sourceEntry || !visualEntry) {
        setStatus("Не удалось применить основную research pair для сюжета.");
        return;
      }
      const patch = buildReleaseResearchPickPatch(brief, { sourceEntry, visualEntry });
      await handleUpdateReleaseAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
    },
    [handleUpdateReleaseAttachment, linkedReleaseSnapshotBySegmentId, selectedReleaseAssets]
  );
  const handlePromoteLinkedReleaseBackupPair = React.useCallback(
    async (segmentId) => {
      const normalizedSegmentId = String(segmentId ?? "").trim();
      if (!normalizedSegmentId) return;
      const snapshot = linkedReleaseSnapshotBySegmentId.get(normalizedSegmentId) ?? null;
      const attachmentId = String(snapshot?.attachment_id ?? "").trim();
      const releaseItem =
        attachmentId && Array.isArray(selectedReleaseAssets)
          ? selectedReleaseAssets.find((item) => String(item?.attachment?.id ?? "").trim() === attachmentId) ?? null
          : null;
      const brief = snapshot?.research_brief ?? null;
      const sourceEntry = snapshot?.backup_source_entry ?? null;
      const visualEntry = snapshot?.backup_visual_entry ?? null;
      if (!attachmentId || !releaseItem?.asset?.id || !releaseItem?.attachment?.id || !brief || !sourceEntry || !visualEntry) {
        setStatus("Не удалось применить backup research pair для сюжета.");
        return;
      }
      const patch = buildReleaseResearchPickPatch(brief, { sourceEntry, visualEntry });
      await handleUpdateReleaseAttachment(releaseItem.asset.id, releaseItem.attachment.id, patch);
    },
    [handleUpdateReleaseAttachment, linkedReleaseSnapshotBySegmentId, selectedReleaseAssets]
  );

  const releaseWorkspaceProps = {
    selectedReleaseDetail,
    releaseBusy,
    handleUpdateRelease,
    handleExportReleaseBrief,
    releaseSummary,
    releaseWorkspaceTab,
    setReleaseWorkspaceTab,
    effectiveReleaseAssistantFindings,
    setReleaseBoardFilter,
    segmentsNeedingVisual,
    handleOpenSegmentScreenshotMode,
    handleAttachOrphanScreenshots,
    effectiveOrphanScreenshotsCount,
    handleFillMissingVisualsWithRecommendations,
    handlePrepareRelease,
    handleMarkReleaseAirReady,
    handlePublishRelease,
    recommendedReleaseAssets,
    releaseRecommendationSummary,
    lastAttachRecommendationsResult,
    handleAttachRecommendedBatch,
    handleAttachAssetToRelease,
    assetActionBusy,
    selectedReleaseId,
    handleOpenAssetScreenshotMode,
    handleDownloadMedia,
    getMediaDownloadState,
    formatRecommendationBucketLabel,
    releaseDraftPackSummary,
    releaseDraftPackItems,
    releasePublishChecklistSummary,
    releasePublishChecklistItems,
    releaseReadyToAir: Boolean(releasePublishChecklist?.is_ready_to_air),
    releaseControlPanel: effectiveReleaseControlPanel,
    releaseBriefingPanel: effectiveReleaseBriefingPanel,
    releaseResearchBriefs: effectiveReleaseResearchBriefs,
    sourceProfiles,
    releaseOutcomeMemorySummary,
    runtimeBackupsStatus,
    lastAssistantAutoBackup,
    handleApplyReleaseDraftPack,
    handleSelectBackupSnapshot,
    releaseActivity,
    formatRelativeEventLabel,
    formatDateTimeShort,
    releaseBoardFilter,
    releaseBoardCounts,
    releaseBoardColumns,
    releaseBoardGroups,
    formatReleaseItemStatusLabel,
    selectedReleaseItems,
    selectedReleaseAssets,
    handleSelectAllReleaseItems,
    handleSelectReleaseItemsByFilter,
    handleClearReleaseSelection,
    handleFocusReleaseAttachment,
    handleBulkUpdateReleaseItems,
    handleBulkUpdateSelectedAssetStatus,
    handleBulkDetachReleaseItems,
    releaseBulkScriptTemplate,
    setReleaseBulkScriptTemplate,
    releaseBulkVisualTemplate,
    setReleaseBulkVisualTemplate,
    handleBulkApplyNoteTemplates,
    handlePrepareSelectedReleaseItems,
    handlePrepareReleaseAttachment,
    handleApplySelectionDraftPack,
    handleDraftReleaseAttachment,
    handleFillSelectedVisualsWithRecommendations,
    handleFillReleaseAttachmentVisuals,
    handleCopyReleaseResearchBrief,
    handleOpenReleaseResearchSegment,
    handlePinReleaseResearchRun,
    handleOpenReleaseFromSegment,
    selectedReleaseAttachmentIdSet,
    toggleReleaseAttachmentSelection,
    formatAssetKindLabel,
    handleUpdateReleaseAttachment,
    handleReorderReleaseAsset,
    handleAssetStatusUpdate,
    handleDetachAssetFromRelease
  };
  const researchWorkspaceDocId = String(researchDocQueryId || docId || "").trim();
  const researchWorkspaceSegmentId = String(selectedResearchSegmentId ?? "").trim();
  const researchWorkspaceLinkedReleaseInfo =
    researchWorkspaceSegmentId && linkedReleaseSegmentIds.has(researchWorkspaceSegmentId) && selectedReleaseDetail
      ? {
          id: selectedReleaseDetail.id,
          title: selectedReleaseDetail.title,
          status: selectedReleaseDetail.status,
          air_date: selectedReleaseDetail.air_date
        }
      : null;
  const researchWorkspaceLinkedReleaseSnapshot =
    researchWorkspaceSegmentId ? linkedReleaseSnapshotBySegmentId.get(researchWorkspaceSegmentId) ?? null : null;
  const storageHealthHighlights = React.useMemo(() => {
    const highlights = [];
    if (runtimeBackupsStatus?.auto_backup_enabled === false) {
      highlights.push("Auto-backup policy is disabled.");
    }
    const latestBackupAt = String(runtimeBackupsStatus?.latest?.created_at ?? "").trim();
    if (!latestBackupAt) {
      highlights.push("No runtime backups created yet.");
    } else {
      const ageMs = Date.now() - (Date.parse(latestBackupAt) || 0);
      if (ageMs > 24 * 60 * 60 * 1000) {
        highlights.push("Latest backup is older than 24 hours.");
      }
    }
    if (Number(sqliteMirrorStatus?.wal_size_bytes ?? 0) > 64 * 1024 * 1024) {
      highlights.push(`WAL is large: ${formatBytes(sqliteMirrorStatus?.wal_size_bytes ?? 0)}.`);
    }
    if (Number(runtimeBackupsStatus?.total_backups ?? 0) >= Number(runtimeBackupsStatus?.keep_count ?? 0) && Number(runtimeBackupsStatus?.keep_count ?? 0) > 0) {
      highlights.push(`Retention active: keeping last ${runtimeBackupsStatus.keep_count} backups.`);
    }
    return highlights;
  }, [runtimeBackupsStatus, sqliteMirrorStatus]);
  if (appMode === "producer") {
    return (
      <React.Suspense fallback={<LazySectionFallback label="Loading producer view..." />}>
        <ReleaseProducerMode
          theme={theme}
          handleThemeToggle={handleThemeToggle}
          integrationReleases={integrationReleases}
          selectedReleaseId={selectedReleaseId}
          setSelectedReleaseId={setSelectedReleaseId}
          selectedReleaseDetail={selectedReleaseDetail}
          releaseSummary={releaseSummary}
          releaseControlPanel={effectiveReleaseControlPanel}
          releaseBriefingPanel={effectiveReleaseBriefingPanel}
          releasePublishChecklistSummary={releasePublishChecklistSummary}
          releasePublishChecklistItems={releasePublishChecklistItems}
          effectiveReleaseAssistantFindings={effectiveReleaseAssistantFindings}
          selectedReleaseAssets={selectedReleaseAssets}
          releaseActivity={releaseActivity}
          releaseBusy={releaseBusy}
          handleRefreshProducerView={handleRefreshProducerView}
          handlePrepareRelease={handlePrepareRelease}
          handleMarkReleaseAirReady={handleMarkReleaseAirReady}
          handlePublishRelease={handlePublishRelease}
          handleOpenReleaseScreenshotMode={handleOpenReleaseScreenshotMode}
          handleExportReleaseBrief={handleExportReleaseBrief}
          handleOpenOnAirMode={handleOpenOnAirMode}
          formatReleaseItemStatusLabel={formatReleaseItemStatusLabel}
          formatDateTimeShort={formatDateTimeShort}
          formatRelativeEventLabel={formatRelativeEventLabel}
          handleExitProducerMode={handleExitProducerMode}
        />
      </React.Suspense>
    );
  }
  if (appMode === "onair") {
    return (
      <React.Suspense fallback={<LazySectionFallback label="Loading on-air view..." />}>
        <ReleaseOnAirMode
          selectedReleaseDetail={selectedReleaseDetail}
          releaseControlPanel={effectiveReleaseControlPanel}
          releaseBriefingPanel={effectiveReleaseBriefingPanel}
          releasePublishChecklistItems={releasePublishChecklistItems}
          selectedReleaseAssets={selectedReleaseAssets}
          releaseActivity={releaseActivity}
          releaseBusy={releaseBusy}
          handleRefreshProducerView={handleRefreshProducerView}
          handlePrepareRelease={handlePrepareRelease}
          handleMarkReleaseAirReady={handleMarkReleaseAirReady}
          handlePublishRelease={handlePublishRelease}
          handleOpenProducerMode={handleOpenProducerMode}
          handleExitProducerMode={handleExitProducerMode}
          formatReleaseItemStatusLabel={formatReleaseItemStatusLabel}
          formatDateTimeShort={formatDateTimeShort}
          handleToggleFullscreen={handleToggleFullscreen}
        />
      </React.Suspense>
    );
  }

  if (appMode === "research") {
    return (
      <div className="app">
        <React.Suspense fallback={<LazySectionFallback label="Loading research workspace..." />}>
          <ResearchWorkspace
            docId={researchWorkspaceDocId}
            segments={segments}
            selectedSegmentId={selectedResearchSegmentId}
            setSelectedSegmentId={setSelectedResearchSegmentId}
            selectedRunId={selectedResearchRunId}
            setSelectedRunId={setSelectedResearchRunId}
            segmentResearchRuns={segmentResearchRuns}
            segmentResearchHistory={segmentResearchHistory}
            segmentResearchLoading={segmentResearchLoading}
            onResearchRun={handleRunSegmentResearch}
            onResearchSelectRun={handleSelectSegmentResearchRun}
            onResearchApply={handleApplySegmentResearch}
            onResearchApplyMany={handleApplyManySegmentResearch}
            onResearchPromoteBundle={handlePromoteSegmentResearchBundle}
            onResearchCopyBrief={handleCopySegmentResearchBrief}
            onUpdateResearchThemeContext={handleUpdateResearchThemeContext}
            linkedReleaseInfo={researchWorkspaceLinkedReleaseInfo}
            linkedReleaseSnapshot={researchWorkspaceLinkedReleaseSnapshot}
            onOpenLinkedRelease={handleOpenReleaseFromSegment}
            onOpenLinkedReleaseHandoff={handleOpenReleaseFromSegment}
            onUseLinkedReleasePrimary={handleUseLinkedReleasePrimary}
            onPromoteLinkedReleasePrimaryPair={handlePromoteLinkedReleasePrimaryPair}
            onPromoteLinkedReleaseBackupPair={handlePromoteLinkedReleaseBackupPair}
            onUseLinkedReleaseBackup={handleUseLinkedReleaseBackup}
            onExitResearchMode={handleExitResearchMode}
            inferResearchCandidateRole={inferResearchCandidateRole}
            deriveSegmentResearchCurrentPair={deriveSegmentResearchCurrentPair}
            normalizeResearchBundleTrace={normalizeResearchBundleTrace}
            getCurrentPairBadgeClassName={getCurrentPairBadgeClassName}
            formatSegmentResearchBriefLabel={formatSegmentResearchBriefLabel}
            formatResearchCandidateRoleLabel={formatResearchCandidateRoleLabel}
            collectResearchMemoryBadges={collectResearchMemoryBadges}
            getVisibleResearchReasonTags={getVisibleResearchReasonTags}
          />
        </React.Suspense>
      </div>
    );
  }

  if (appMode === "newsops") {
    return (
      <div className="app">
        <AppNewsOpsSection
          integrationLoading={integrationLoading}
          refreshIntegration={refreshIntegration}
          integrationOverview={integrationOverview}
          integrationReleases={integrationReleases}
          integrationBotSessions={integrationBotSessions}
          segmentsNeedingVisual={segmentsNeedingVisual}
          sourceMemorySummary={sourceMemorySummary}
          releaseOutcomeMemorySummary={releaseOutcomeMemorySummary}
          runtimeBackupsStatus={runtimeBackupsStatus}
          sqliteMirrorStatus={sqliteMirrorStatus}
          storageHealthHighlights={storageHealthHighlights}
          selectedReleaseId={selectedReleaseId}
          selectedReleaseDetail={selectedReleaseDetail}
          releaseControlPanel={releaseControlPanel}
          releasePublishChecklist={releasePublishChecklist}
          releaseBriefingPanel={releaseBriefingPanel}
          releaseActivity={releaseActivity}
          formatDateTimeShort={formatDateTimeShort}
          handleOpenOwnerFocusRelease={handleOpenOwnerFocusRelease}
          handleOpenOwnerStorageHealth={handleOpenOwnerStorageHealth}
          handleOpenOwnerSourceIntelligence={handleOpenOwnerSourceIntelligence}
          handleOpenOwnerNeedsVisual={handleOpenOwnerNeedsVisual}
          integrationAssets={integrationAssets}
          formatAssetKindLabel={formatAssetKindLabel}
          handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
          sourceProfilesDirty={sourceProfilesDirty}
          sourceProfilesDraft={sourceProfilesDraft}
          updateSourceProfilesDraftField={updateSourceProfilesDraftField}
          sourceProfilesSaving={sourceProfilesSaving}
          handleResetSourceProfilesDraft={handleResetSourceProfilesDraft}
          handleSaveSourceProfiles={handleSaveSourceProfiles}
          backupActionBusy={backupActionBusy}
          handleCreateRuntimeBackup={handleCreateRuntimeBackup}
          handleRestoreRuntimeBackup={handleRestoreRuntimeBackup}
          selectedBackupSnapshotId={selectedBackupSnapshotId}
          handleSelectBackupSnapshot={handleSelectBackupSnapshot}
          selectedBackupSnapshot={selectedBackupSnapshot}
          selectedBackupDryRun={selectedBackupDryRun}
          formatBytes={formatBytes}
        />
      </div>
    );
  }

  if (appMode === "newsroom" || appMode === "inbox" || appMode === "library" || appMode === "releases") {
    return (
      <div className="app">
        <React.Suspense fallback={<LazySectionFallback label={`Loading ${appMode === "newsroom" ? "newsroom" : appMode}...`} />}>
          <NewsroomWorkspace
            appMode={appMode === "newsroom" ? "workspace" : appMode}
            integrationQuery={integrationQuery}
            setIntegrationQuery={setIntegrationQuery}
            integrationKind={integrationKind}
            setIntegrationKind={setIntegrationKind}
            integrationStatusFilter={integrationStatusFilter}
            setIntegrationStatusFilter={setIntegrationStatusFilter}
            integrationOverview={integrationOverview}
            inboxAssets={inboxAssets}
            filteredLibraryAssets={filteredLibraryAssets}
            formatAssetKindLabel={formatAssetKindLabel}
            formatDateTimeShort={formatDateTimeShort}
            handleAssetStatusUpdate={handleAssetStatusUpdate}
            assetActionBusy={assetActionBusy}
            handleAttachAssetToRelease={handleAttachAssetToRelease}
            selectedReleaseId={selectedReleaseId}
            releaseDraftTitle={releaseDraftTitle}
            setReleaseDraftTitle={setReleaseDraftTitle}
            releaseDraftDate={releaseDraftDate}
            setReleaseDraftDate={setReleaseDraftDate}
            handleCreateRelease={handleCreateRelease}
            releaseBusy={releaseBusy}
            integrationReleases={integrationReleases}
            setSelectedReleaseId={setSelectedReleaseId}
            handleOpenReleaseScreenshotMode={handleOpenReleaseScreenshotMode}
            releaseScreenshotSourceCount={releaseScreenshotSourceCount}
            handleOpenProducerMode={handleOpenProducerMode}
            handleOpenOnAirMode={handleOpenOnAirMode}
            handleOpenAssetScreenshotMode={handleOpenAssetScreenshotMode}
            releaseWorkspaceProps={releaseWorkspaceProps}
            sourceProfiles={sourceProfiles}
          />
        </React.Suspense>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeroHeader
        theme={theme}
        handleThemeToggle={handleThemeToggle}
        handleOpenNewsroom={() => window.open("/newsroom", "_blank", "noopener,noreferrer")}
        docId={docId}
        status={status}
        recentDocId={recentDocId}
        handleRecentSelect={handleRecentSelect}
        loading={loading}
        recentDocs={recentDocs}
        formatRecentDocLabel={formatRecentDocLabel}
        autoOpenLastDocEnabled={autoOpenLastDocEnabled}
        setAutoOpenLastDocEnabled={setAutoOpenLastDocEnabled}
      />
      <React.Suspense fallback={<LazySectionFallback label="Loading scenario editor..." />}>
        <ScenarioEditorPanel
          scenarioPanelOpen={scenarioPanelOpen}
          setScenarioPanelOpen={setScenarioPanelOpen}
          handleStartNewScenario={handleStartNewScenario}
          loading={loading}
          notionUrl={notionUrl}
          setNotionUrl={setNotionUrl}
          handleLoadNotion={handleLoadNotion}
          canLoadNotion={canLoadNotion}
          handleRefreshNotion={handleRefreshNotion}
          canRefreshNotion={canRefreshNotion}
          scriptText={scriptText}
          setScriptText={setScriptText}
          handleGenerate={handleGenerate}
          canGenerate={canGenerate}
          handleRecoverSegmentState={handleRecoverSegmentState}
          canRecoverSegmentState={canRecoverSegmentState}
          notionHasUpdates={notionHasUpdates}
          handleMarkAllDone={handleMarkAllDone}
          segmentsCount={segmentsCount}
        />
      </React.Suspense>
      <section className="panel">
        <ScenarioBlocksHeader
          hasUnsavedChanges={hasUnsavedChanges}
          handleSave={handleSave}
          canSave={canSave}
          handleAddSegment={handleAddSegment}
          linksPanelOpen={linksPanelOpen}
          allScenarioLinksCount={allScenarioLinks.length}
          handleToggleLinksPanel={() => setLinksPanelOpen((prev) => !prev)}
          handleCopyForFigma={handleCopyForFigma}
          handleExport={handleExport}
          handleConfigureXmlMediaRoot={handleConfigureXmlMediaRoot}
        />
        {linksPanelOpen ? (
          <ScenarioLinksPanel
            allScenarioLinks={allScenarioLinks}
            handleOpenAllLinksScreenshotMode={handleOpenAllLinksScreenshotMode}
            getReadableLinkLabel={getReadableLinkLabel}
            isMediaDownloadSupported={isMediaDownloadSupported}
            isMediaDownloaded={isMediaDownloaded}
            handleDownloadMedia={handleDownloadMedia}
            isMediaDownloadBusy={isMediaDownloadBusy}
            handleCopy={handleCopy}
          />
        ) : null}
        {segments.length === 0 ? (
          <div className="empty-state">
            <p>Пока нет сегментов. Запустите сегментацию или добавьте сегмент вручную.</p>
          </div>
        ) : (
          <div className="segment-groups">
            {groupedSegments.map((group, groupIndex) => {
              const isExpanded = Boolean(expandedGroups[group.id]);
              const limit = groupRenderLimits[group.id] ?? GROUP_RENDER_CHUNK;
              const visibleItems = isExpanded ? group.items.slice(0, limit) : [];
              const remaining = group.items.length - visibleItems.length;
              const groupLoading =
                group.items.some(({ segment }) => aiLoading[segment.segment_id]) ||
                Boolean(group.topicResearchAnchor?.segment?.segment_id) &&
                  Boolean(aiLoading[group.topicResearchAnchor.segment.segment_id]);
              const doneCount = group.items.filter(({ segment }) => Boolean(segment.is_done)).length;
              const totalGroupSegments = group.items.length;
              const completionPercent =
                totalGroupSegments > 0 ? Math.round((doneCount / totalGroupSegments) * 100) : 0;
              const groupDone = totalGroupSegments > 0 && doneCount === totalGroupSegments;
              const headingRuQuery = group.title === "Без темы" ? "" : group.title;
              const headingEnQuery = String(headingEnglishQueries[group.id] ?? headingRuQuery);
              const isHeadingSearchOpen = Boolean(headingSearchOpen[group.id]);
              const canExportGroupXml = Boolean(
                docId && (group.section_id || (group.title && group.title !== "Без темы"))
              );
              return (
                <ScenarioGroupSection
                  key={`${group.id}-${groupIndex}`}
                  group={group}
                  groupIndex={groupIndex}
                  isExpanded={isExpanded}
                  visibleItems={visibleItems}
                  remaining={remaining}
                  groupDone={groupDone}
                  groupDoneCount={doneCount}
                  groupTotalSegments={totalGroupSegments}
                  groupCompletionPercent={completionPercent}
                  groupLoading={groupLoading}
                  headingRuQuery={headingRuQuery}
                  headingEnQuery={headingEnQuery}
                  isHeadingSearchOpen={isHeadingSearchOpen}
                  canExportGroupXml={canExportGroupXml}
                  headingRuEngines={headingRuEngines}
                  headingEnEngines={HEADING_EN_SEARCH_ENGINES}
                  headingTranslateLoading={Boolean(headingTranslateLoading[group.id])}
                  handleToggleGroupDone={handleToggleGroupDone}
                  handleAddLinksBlock={handleAddLinksBlock}
                  docId={docId}
                  loading={loading}
                  handleAiHelp={handleAiHelp}
                  handleEditThemeTags={handleEditThemeTags}
                  toggleHeadingSearch={toggleHeadingSearch}
                  handleExport={handleExport}
                  toggleGroup={toggleGroup}
                  handleSearch={handleSearch}
                  handleHeadingEnglishQueryChange={handleHeadingEnglishQueryChange}
                  translateHeadingQuery={translateHeadingQuery}
                  handleShowMore={handleShowMore}
                  LinksCardComponent={LinksCard}
                  SegmentCardComponent={SegmentCard}
                  handleLinkAdd={handleLinkAdd}
                  handleLinkUpdate={handleLinkUpdate}
                  handleLinkRemove={handleLinkRemove}
                  handleOpenSegmentScreenshotMode={handleOpenSegmentScreenshotMode}
                  handleDownloadMedia={handleDownloadMedia}
                  isMediaDownloadBusy={isMediaDownloadBusy}
                  isMediaDownloadSupported={isMediaDownloadSupported}
                  isMediaDownloaded={isMediaDownloaded}
                  config={config}
                  mediaFiles={mediaFiles}
                  updateSegment={updateSegment}
                  updateVisual={updateVisual}
                  updateSearch={updateSearch}
                  handleQuoteChange={handleQuoteChange}
                  handleInsertAfter={handleInsertAfter}
                  handleRemoveSegment={handleRemoveSegment}
                  handleClearSearch={handleClearSearch}
                  handleGenerateSearch={handleGenerateSearch}
                  searchLoading={searchLoading}
                  handleSearchToggle={handleSearchToggle}
                  segmentResearchRuns={segmentResearchRuns}
                  segmentResearchHistory={segmentResearchHistory}
                  segmentResearchLoading={segmentResearchLoading}
                  handleRunSegmentResearch={handleRunSegmentResearch}
                  handleSelectSegmentResearchRun={handleSelectSegmentResearchRun}
                  handleApplySegmentResearch={handleApplySegmentResearch}
                  handlePromoteSegmentResearchBundle={handlePromoteSegmentResearchBundle}
                  handleCopySegmentResearchBrief={handleCopySegmentResearchBrief}
                  handleOpenResearchWorkspace={handleOpenResearchWorkspace}
                  linkedReleaseSegmentIds={linkedReleaseSegmentIds}
                  selectedReleaseDetail={selectedReleaseDetail}
                  linkedReleaseSnapshotBySegmentId={linkedReleaseSnapshotBySegmentId}
                  handleOpenReleaseFromSegment={handleOpenReleaseFromSegment}
                  handleUseLinkedReleasePrimary={handleUseLinkedReleasePrimary}
                  handlePromoteLinkedReleasePrimaryPair={handlePromoteLinkedReleasePrimaryPair}
                  handlePromoteLinkedReleaseBackupPair={handlePromoteLinkedReleaseBackupPair}
                  handleUseLinkedReleaseBackup={handleUseLinkedReleaseBackup}
                  handleCopy={handleCopy}
                  handleToggleSegmentDone={handleToggleSegmentDone}
                />
              );
            })}
          </div>
        )}
      </section>
      <React.Suspense fallback={<LazySectionFallback label="Loading media history..." />}>
        <MediaHistoryPanel
          docId={docId}
          mediaPanelOpen={mediaPanelOpen}
          setMediaPanelOpen={setMediaPanelOpen}
          mediaTools={mediaTools}
          ytDlpVersion={ytDlpVersion}
          ytDlpVersionLoading={ytDlpVersionLoading}
          ytDlpUpdateLoading={ytDlpUpdateLoading}
          handleCheckYtDlpVersion={handleCheckYtDlpVersion}
          handleUpdateYtDlp={handleUpdateYtDlp}
          activeMediaJobsCount={activeMediaJobsCount}
          mediaJobs={mediaJobs}
          formatMediaJobProgress={formatMediaJobProgress}
          handleCancelMediaJob={handleCancelMediaJob}
          mediaFiles={mediaFiles}
          formatBytes={formatBytes}
        />
      </React.Suspense>
    </div>
  );
}
function mergeSegmentsAndDecisions(segments = [], decisions = [], config = defaultConfig) {
  const decisionMap = new Map(
    decisions.map((item) => [
      item.segment_id,
      {
        visual: item.visual_decision ?? item.visual,
        search: item.search_decision ?? item.search,
        research_sources: normalizeResearchSources(item.research_sources),
        research_dismissed_urls: normalizeResearchDismissedUrls(item.research_dismissed_urls),
        research_bundle_trace: normalizeResearchBundleTrace(item.research_bundle_trace)
      }
    ])
  );
  return segments.map((segment) => ({
    ...segment,
    block_type: normalizeSegmentBlockType(segment.block_type),
    ...normalizeSegmentResearchContextSettings(segment),
    topic_tags: normalizeSegmentTagList(segment.topic_tags ?? segment.section_tags ?? []),
    section_tags: normalizeSegmentTagList(segment.section_tags ?? segment.topic_tags ?? []),
    links: Array.isArray(segment.links) ? dedupeLinks(segment.links) : [],
    visual_decision: (() => {
      const normalized = normalizeVisualDecision(
        decisionMap.get(segment.segment_id)?.visual ?? segment.visual_decision,
        config
      );
      if (normalized.duration_hint_sec !== null && normalized.duration_hint_sec !== undefined) {
        return normalized;
      }
      return { ...normalized, duration_hint_sec: computeDurationHint(segment.text_quote) };
    })(),
    search_decision: normalizeSearchDecision(
      decisionMap.get(segment.segment_id)?.search ?? segment.search_decision,
      config
    ),
    research_sources: normalizeResearchSources(
      decisionMap.get(segment.segment_id)?.research_sources ?? segment.research_sources
    ),
    research_dismissed_urls: normalizeResearchDismissedUrls(
      decisionMap.get(segment.segment_id)?.research_dismissed_urls ?? segment.research_dismissed_urls
    ),
    research_bundle_trace: normalizeResearchBundleTrace(
      decisionMap.get(segment.segment_id)?.research_bundle_trace ?? segment.research_bundle_trace
    ),
    search_open: Boolean(segment.search_open),
    is_done: Boolean(segment.is_done)
  }));
}
function splitSegmentsAndDecisions(segments = []) {
  const segmentsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    block_type: normalizeSegmentBlockType(segment.block_type),
    text_quote: segment.text_quote,
    section_id: segment.section_id ?? null,
    section_title: segment.section_title ?? null,
    section_index: segment.section_index ?? null,
    research_use_topic_title: Boolean(segment?.research_use_topic_title),
    research_use_theme_tags: Boolean(segment?.research_use_theme_tags),
    topic_tags: normalizeSegmentTagList(segment.topic_tags ?? segment.section_tags ?? []),
    section_tags: normalizeSegmentTagList(segment.section_tags ?? segment.topic_tags ?? []),
    links: Array.isArray(segment.links) ? dedupeLinks(segment.links) : [],
    segment_status: segment.segment_status ?? null,
    is_done: Boolean(segment.is_done),
    version: segment.version ?? 1
  }));
  const decisionsPayload = segments.map((segment) => ({
    segment_id: segment.segment_id,
    visual_decision:
      normalizeSegmentBlockType(segment.block_type) === "links"
        ? emptyVisualDecision()
        : normalizeVisualDecision(segment.visual_decision, defaultConfig),
    search_decision:
      normalizeSegmentBlockType(segment.block_type) === "links"
        ? emptySearchDecision()
        : normalizeSearchDecision(segment.search_decision, defaultConfig),
    research_sources: normalizeResearchSources(segment.research_sources),
    research_dismissed_urls: normalizeResearchDismissedUrls(segment.research_dismissed_urls),
    research_bundle_trace: normalizeResearchBundleTrace(segment.research_bundle_trace),
    version: segment.version ?? 1
  }));
  return { segmentsPayload, decisionsPayload };
}


