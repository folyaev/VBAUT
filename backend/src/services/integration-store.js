import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

const COLLECTION_FILES = {
  assets: "assets.json",
  attachments: "attachments.json",
  releases: "releases.json",
  bot_sessions: "bot-sessions.json",
  jobs: "jobs.json",
  activities: "activities.json"
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, maxLength = 0) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (maxLength > 0) return text.slice(0, maxLength);
  return text;
}

function normalizeJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createIntegrationStore({ dataDir, readOptionalJson, writeJson, onCollectionsChanged = null }) {
  const integrationDir = path.join(dataDir, "_integration");

  function buildAssetSummary(asset, attachments = []) {
    const related = attachments
      .filter((item) => item.asset_id === asset.id)
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
    return {
      ...asset,
      attachment_count: related.length,
      targets: related.slice(0, 8).map((item) => ({
        id: item.id,
        target_type: item.target_type,
        target_id: item.target_id,
        role: item.role,
        note: item.note
      }))
    };
  }

  function collectionPath(name) {
    const fileName = COLLECTION_FILES[name];
    if (!fileName) throw new Error(`Unknown integration collection: ${name}`);
    return path.join(integrationDir, fileName);
  }

  async function ensureStore() {
    await fs.mkdir(integrationDir, { recursive: true });
    await Promise.all(
      Object.keys(COLLECTION_FILES).map(async (name) => {
        const filePath = collectionPath(name);
        if (await fileExists(filePath)) {
          const stat = await fs.stat(filePath);
          if (stat.size > 0) return;
        }
        await writeJson(filePath, []);
      })
    );
  }

  async function readCollection(name) {
    await ensureStore();
    const filePath = collectionPath(name);
    let value;
    try {
      value = await readOptionalJson(filePath);
    } catch (error) {
      throw new Error(`Failed to read integration collection ${name} at ${filePath}: ${error.message}`, {
        cause: error
      });
    }
    return Array.isArray(value) ? value : [];
  }

  async function writeCollection(name, items) {
    await ensureStore();
    await writeJson(collectionPath(name), Array.isArray(items) ? items : []);
    if (typeof onCollectionsChanged === "function") {
      await onCollectionsChanged(await dumpCollections(), { reason: `write:${name}` });
    }
  }

  async function dumpCollections() {
    const [assets, attachments, releases, bot_sessions, jobs, activities] = await Promise.all([
      readCollection("assets"),
      readCollection("attachments"),
      readCollection("releases"),
      readCollection("bot_sessions"),
      readCollection("jobs"),
      readCollection("activities")
    ]);
    return {
      assets,
      attachments,
      releases,
      bot_sessions,
      jobs,
      activities
    };
  }

  function normalizeAssetInput(input = {}, existing = null) {
    const meta = normalizeJsonObject(input.meta_json ?? input.meta);
    return {
      id: existing?.id ?? `asset_${nanoid(10)}`,
      kind: normalizeString(input.kind || existing?.kind, 64) || "note",
      status: normalizeString(input.status || existing?.status, 32) || "new",
      title: normalizeString(input.title ?? existing?.title, 200),
      description: normalizeString(input.description ?? existing?.description, 4000),
      author: normalizeString(input.author ?? existing?.author, 200),
      source_url: normalizeString(input.source_url ?? existing?.source_url, 2000),
      source_domain: normalizeString(input.source_domain ?? existing?.source_domain, 200),
      telegram_chat_id: normalizeString(input.telegram_chat_id ?? existing?.telegram_chat_id, 64),
      telegram_message_id: normalizeString(input.telegram_message_id ?? existing?.telegram_message_id, 64),
      telegram_file_id: normalizeString(input.telegram_file_id ?? existing?.telegram_file_id, 512),
      telegram_file_unique_id: normalizeString(
        input.telegram_file_unique_id ?? existing?.telegram_file_unique_id,
        512
      ),
      mime_type: normalizeString(input.mime_type ?? existing?.mime_type, 200),
      file_name: normalizeString(input.file_name ?? existing?.file_name, 260),
      local_path: normalizeString(input.local_path ?? existing?.local_path, 4000),
      preview_image_path: normalizeString(input.preview_image_path ?? existing?.preview_image_path, 4000),
      screenshot_path: normalizeString(input.screenshot_path ?? existing?.screenshot_path, 4000),
      checksum_sha1: normalizeString(input.checksum_sha1 ?? existing?.checksum_sha1, 64),
      editor_note: normalizeString(input.editor_note ?? existing?.editor_note, 4000),
      priority: normalizeString(input.priority ?? existing?.priority, 32) || "normal",
      processing_state: normalizeString(input.processing_state ?? existing?.processing_state, 64) || "idle",
      origin_type: normalizeString(input.origin_type ?? existing?.origin_type, 64),
      origin_id: normalizeString(input.origin_id ?? existing?.origin_id, 128),
      is_duplicate_of: normalizeString(input.is_duplicate_of ?? existing?.is_duplicate_of, 128),
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
      meta_json: { ...(existing?.meta_json ?? {}), ...meta }
    };
  }

  function normalizeAttachmentInput(assetId, input = {}, existing = null) {
    const assistantTrace = normalizeJsonObject(input.assistant_trace_json ?? input.assistant_trace);
    return {
      id: existing?.id ?? `attach_${nanoid(10)}`,
      asset_id: assetId,
      target_type: normalizeString(input.target_type ?? existing?.target_type, 64),
      target_id: normalizeString(input.target_id ?? existing?.target_id, 128),
      role: normalizeString(input.role ?? existing?.role, 64) || "main",
      sort_order: Number.isFinite(Number(input.sort_order))
        ? Number(input.sort_order)
        : Number.isFinite(Number(existing?.sort_order))
          ? Number(existing.sort_order)
          : 0,
      note: normalizeString(input.note ?? existing?.note, 2000),
      script_note: normalizeString(input.script_note ?? existing?.script_note, 4000),
      visual_note: normalizeString(input.visual_note ?? existing?.visual_note, 4000),
      assistant_trace_json: { ...(existing?.assistant_trace_json ?? {}), ...assistantTrace },
      item_status: normalizeString(input.item_status ?? existing?.item_status, 64) || "planned",
      attached_by: normalizeString(input.attached_by ?? existing?.attached_by, 128),
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso()
    };
  }

  function getNextSortOrder(attachments = [], targetType = "", targetId = "") {
    const related = attachments.filter(
      (item) => item.target_type === targetType && item.target_id === targetId
    );
    if (related.length === 0) return 1;
    const max = related.reduce((best, item) => {
      const value = Number(item.sort_order ?? 0);
      return Number.isFinite(value) ? Math.max(best, value) : best;
    }, 0);
    return max + 1;
  }

  function normalizeReleaseInput(input = {}, existing = null) {
    const meta = normalizeJsonObject(input.meta_json ?? input.meta);
    return {
      id: existing?.id ?? `release_${nanoid(10)}`,
      slug: normalizeString(input.slug ?? existing?.slug, 160),
      title: normalizeString(input.title ?? existing?.title, 200),
      air_date: normalizeString(input.air_date ?? existing?.air_date, 64),
      status: normalizeString(input.status ?? existing?.status, 32) || "draft",
      document_id: normalizeString(input.document_id ?? existing?.document_id, 128),
      editor_status: normalizeString(input.editor_status ?? existing?.editor_status, 64) || "planning",
      anchor_document_id: normalizeString(input.anchor_document_id ?? existing?.anchor_document_id, 128),
      notes: normalizeString(input.notes ?? existing?.notes, 4000),
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
      meta_json: { ...(existing?.meta_json ?? {}), ...meta }
    };
  }

  function normalizeBotSessionInput(input = {}, existing = null) {
    const payload = normalizeJsonObject(input.pending_payload_json ?? input.pending_payload);
    return {
      id: existing?.id ?? `session_${nanoid(10)}`,
      user_id: normalizeString(input.user_id ?? existing?.user_id, 64),
      chat_id: normalizeString(input.chat_id ?? existing?.chat_id, 64),
      mode: normalizeString(input.mode ?? existing?.mode, 32) || "inbox",
      active_document_id: normalizeString(input.active_document_id ?? existing?.active_document_id, 128),
      active_segment_id: normalizeString(input.active_segment_id ?? existing?.active_segment_id, 128),
      active_release_id: normalizeString(input.active_release_id ?? existing?.active_release_id, 128),
      pending_action: normalizeString(input.pending_action ?? existing?.pending_action, 64),
      pending_payload_json: { ...(existing?.pending_payload_json ?? {}), ...payload },
      last_seen_at: normalizeString(input.last_seen_at ?? existing?.last_seen_at, 64) || nowIso(),
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso()
    };
  }

  function normalizeActivityInput(input = {}) {
    return {
      id: `activity_${nanoid(10)}`,
      release_id: normalizeString(input.release_id, 128),
      asset_id: normalizeString(input.asset_id, 128),
      attachment_id: normalizeString(input.attachment_id, 128),
      event: normalizeString(input.event, 80),
      detail: normalizeString(input.detail, 2000),
      meta_json: normalizeJsonObject(input.meta_json ?? input.meta),
      created_at: nowIso()
    };
  }

  async function appendActivity(input = {}) {
    const activity = normalizeActivityInput(input);
    if (!activity.release_id || !activity.event) return null;
    const activities = await readCollection("activities");
    activities.push(activity);
    await writeCollection("activities", activities);
    return activity;
  }

  async function listReleaseActivities(releaseId, limit = 80) {
    const normalizedReleaseId = normalizeString(releaseId, 128);
    if (!normalizedReleaseId) return [];
    const activities = await readCollection("activities");
    return activities
      .filter((item) => item.release_id === normalizedReleaseId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Math.max(1, Number(limit) || 80));
  }

  async function listAssets(filters = {}) {
    const assets = await readCollection("assets");
    const attachments = await readCollection("attachments");
    const q = normalizeString(filters.q).toLowerCase();
    let result = assets.map((item) => buildAssetSummary(item, attachments));

    if (filters.kind) {
      result = result.filter((item) => item.kind === filters.kind);
    }
    if (filters.status) {
      result = result.filter((item) => item.status === filters.status);
    }
    if (filters.processing_state) {
      result = result.filter((item) => item.processing_state === filters.processing_state);
    }
    if (String(filters.inbox_only) === "1") {
      result = result.filter(
        (item) =>
          Number(item.attachment_count ?? 0) === 0 ||
          String(item.processing_state ?? "").startsWith("pending")
      );
    }
    if (q) {
      result = result.filter((item) =>
        [item.title, item.description, item.source_url, item.author, item.file_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      );
    }
    if (filters.target_type && filters.target_id) {
      const allowedIds = new Set(
        attachments
          .filter(
            (item) => item.target_type === filters.target_type && item.target_id === filters.target_id
          )
          .map((item) => item.asset_id)
      );
      result = result.filter((item) => allowedIds.has(item.id));
    }

    result.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Number(filters.limit)) : 100;
    return result.slice(0, limit);
  }

  async function getAsset(assetId) {
    const assets = await readCollection("assets");
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return null;
    const attachments = await readCollection("attachments");
    const summary = buildAssetSummary(asset, attachments);
    return {
      ...summary,
      attachments: attachments
        .filter((item) => item.asset_id === assetId)
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    };
  }

  async function createAsset(input = {}) {
    const assets = await readCollection("assets");
    const asset = normalizeAssetInput(input);
    assets.push(asset);
    await writeCollection("assets", assets);
    return asset;
  }

  async function updateAsset(assetId, input = {}) {
    const assets = await readCollection("assets");
    const index = assets.findIndex((item) => item.id === assetId);
    if (index < 0) return null;
    const updated = normalizeAssetInput(input, assets[index]);
    assets[index] = updated;
    await writeCollection("assets", assets);
    return updated;
  }

  async function attachAsset(assetId, input = {}) {
    const assets = await readCollection("assets");
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return null;
    const draftAttachment = normalizeAttachmentInput(assetId, input);
    if (!draftAttachment.target_type || !draftAttachment.target_id) {
      throw new Error("target_type and target_id are required");
    }
    const attachments = await readCollection("attachments");
    const attachment =
      Number(draftAttachment.sort_order ?? 0) > 0
        ? draftAttachment
        : {
            ...draftAttachment,
            sort_order: getNextSortOrder(attachments, draftAttachment.target_type, draftAttachment.target_id)
          };
    attachments.push(attachment);
    await writeCollection("attachments", attachments);
    if (attachment.target_type === "release") {
      await appendActivity({
        release_id: attachment.target_id,
        asset_id: assetId,
        attachment_id: attachment.id,
        event: "asset_attached",
        detail: `asset ${assetId} attached to release`,
        meta: {
          role: attachment.role,
          sort_order: attachment.sort_order,
          attached_by: attachment.attached_by
        }
      });
    }
    return attachment;
  }

  async function updateAttachment(assetId, attachmentId, input = {}) {
    const attachments = await readCollection("attachments");
    const index = attachments.findIndex(
      (item) => item.asset_id === assetId && item.id === attachmentId
    );
    if (index < 0) return null;
    const updated = normalizeAttachmentInput(assetId, input, attachments[index]);
    attachments[index] = updated;
    await writeCollection("attachments", attachments);
    if (updated.target_type === "release") {
      const eventName = normalizeString(input.activity_event, 80) || "release_item_updated";
      const detail = normalizeString(input.activity_detail, 2000) || `release item ${updated.id} updated`;
      const activityMeta = normalizeJsonObject(input.activity_meta);
      await appendActivity({
        release_id: updated.target_id,
        asset_id: assetId,
        attachment_id: updated.id,
        event: eventName,
        detail,
        meta: {
          item_status: updated.item_status,
          role: updated.role,
          sort_order: updated.sort_order,
          ...activityMeta
        }
      });
    }
    return updated;
  }

  async function removeAttachment(assetId, attachmentId) {
    const attachments = await readCollection("attachments");
    const index = attachments.findIndex(
      (item) => item.asset_id === assetId && item.id === attachmentId
    );
    if (index < 0) return null;
    const [removed] = attachments.splice(index, 1);
    await writeCollection("attachments", attachments);
    if (removed.target_type === "release") {
      await appendActivity({
        release_id: removed.target_id,
        asset_id: assetId,
        attachment_id: removed.id,
        event: "asset_detached",
        detail: `asset ${assetId} detached from release`,
        meta: {
          role: removed.role
        }
      });
    }
    return removed;
  }

  async function reorderReleaseAttachments(releaseId, attachmentIds = []) {
    const normalizedReleaseId = normalizeString(releaseId, 128);
    if (!normalizedReleaseId) {
      throw new Error("releaseId is required");
    }
    const normalizedAttachmentIds = Array.isArray(attachmentIds)
      ? attachmentIds.map((item) => normalizeString(item, 128)).filter(Boolean)
      : [];
    if (normalizedAttachmentIds.length === 0) {
      throw new Error("attachment_ids are required");
    }

    const attachments = await readCollection("attachments");
    const releaseAttachments = attachments.filter(
      (item) => item.target_type === "release" && item.target_id === normalizedReleaseId
    );
    if (releaseAttachments.length === 0) return [];

    const allowedIds = new Set(releaseAttachments.map((item) => item.id));
    const uniqueOrderedIds = [];
    normalizedAttachmentIds.forEach((item) => {
      if (!allowedIds.has(item)) return;
      if (uniqueOrderedIds.includes(item)) return;
      uniqueOrderedIds.push(item);
    });
    releaseAttachments.forEach((item) => {
      if (!uniqueOrderedIds.includes(item.id)) uniqueOrderedIds.push(item.id);
    });

    const orderMap = new Map(uniqueOrderedIds.map((item, index) => [item, index + 1]));
    const nextAttachments = attachments.map((item) => {
      if (item.target_type !== "release" || item.target_id !== normalizedReleaseId) return item;
      const nextSortOrder = orderMap.get(item.id);
      if (!nextSortOrder) return item;
      return {
        ...item,
        sort_order: nextSortOrder
      };
    });
    await writeCollection("attachments", nextAttachments);
    await appendActivity({
      release_id: normalizedReleaseId,
      event: "rundown_reordered",
      detail: `release rundown reordered (${uniqueOrderedIds.length} items)`,
      meta: {
        attachment_ids: uniqueOrderedIds
      }
    });
    return nextAttachments
      .filter((item) => item.target_type === "release" && item.target_id === normalizedReleaseId)
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  }

  async function listReleases(filters = {}) {
    const [releases, attachments] = await Promise.all([
      readCollection("releases"),
      readCollection("attachments")
    ]);
    let result = releases.slice();
    if (filters.status) {
      result = result.filter((item) => item.status === filters.status);
    }
    result = result.map((release) => ({
      ...release,
      asset_count: attachments.filter(
        (item) => item.target_type === "release" && item.target_id === release.id
      ).length
    }));
    result.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return result;
  }

  async function getRelease(releaseId) {
    const [releases, assets, attachments] = await Promise.all([
      readCollection("releases"),
      readCollection("assets"),
      readCollection("attachments")
    ]);
    const release = releases.find((item) => item.id === releaseId);
    if (!release) return null;
    const releaseAttachments = attachments
      .filter((item) => item.target_type === "release" && item.target_id === releaseId)
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
    const assetMap = new Map(assets.map((item) => [item.id, item]));
    return {
      ...release,
      asset_count: releaseAttachments.length,
      updated_at: release.updated_at,
      assets: releaseAttachments
        .map((attachment) => {
          const asset = assetMap.get(attachment.asset_id);
          if (!asset) return null;
          return {
            attachment,
            asset: buildAssetSummary(asset, attachments)
          };
        })
        .filter(Boolean)
    };
  }

  async function createRelease(input = {}) {
    const release = normalizeReleaseInput(input);
    if (!release.title) {
      throw new Error("title is required");
    }
    const releases = await readCollection("releases");
    releases.push(release);
    await writeCollection("releases", releases);
    await appendActivity({
      release_id: release.id,
      event: "release_created",
      detail: `release ${release.id} created`,
      meta: {
        title: release.title,
        status: release.status
      }
    });
    return release;
  }

  async function updateRelease(releaseId, input = {}) {
    const releases = await readCollection("releases");
    const index = releases.findIndex((item) => item.id === releaseId);
    if (index < 0) return null;
    const updated = normalizeReleaseInput(input, releases[index]);
    if (!updated.title) {
      throw new Error("title is required");
    }
    releases[index] = updated;
    await writeCollection("releases", releases);
    await appendActivity({
      release_id: updated.id,
      event: "release_updated",
      detail: `release ${updated.id} updated`,
      meta: {
        status: updated.status,
        editor_status: updated.editor_status
      }
    });
    return updated;
  }

  async function listBotSessions(filters = {}) {
    const sessions = await readCollection("bot_sessions");
    let result = sessions.slice();
    if (filters.chat_id) {
      result = result.filter((item) => item.chat_id === filters.chat_id);
    }
    if (filters.user_id) {
      result = result.filter((item) => item.user_id === filters.user_id);
    }
    if (filters.mode) {
      result = result.filter((item) => item.mode === filters.mode);
    }
    result.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return result;
  }

  async function upsertBotSession(input = {}) {
    const normalizedChat = normalizeString(input.chat_id, 64);
    if (!normalizedChat) {
      throw new Error("chat_id is required");
    }
    const normalizedUser = normalizeString(input.user_id, 64);
    const sessions = await readCollection("bot_sessions");
    const index = sessions.findIndex(
      (item) => item.chat_id === normalizedChat && item.user_id === normalizedUser
    );
    const updated = normalizeBotSessionInput(input, index >= 0 ? sessions[index] : null);
    if (index >= 0) {
      sessions[index] = updated;
    } else {
      sessions.push(updated);
    }
    await writeCollection("bot_sessions", sessions);
    return updated;
  }

  async function getOverview() {
    const [assets, attachments, releases, sessions, jobs, activities] = await Promise.all([
      readCollection("assets"),
      readCollection("attachments"),
      readCollection("releases"),
      readCollection("bot_sessions"),
      readCollection("jobs"),
      readCollection("activities")
    ]);
    return {
      data_dir: integrationDir,
      counts: {
        assets: assets.length,
        attachments: attachments.length,
        releases: releases.length,
        bot_sessions: sessions.length,
        jobs: jobs.length,
        activities: activities.length,
        inbox_assets: assets.filter((item) => {
          const relatedCount = attachments.filter((attachment) => attachment.asset_id === item.id).length;
          return relatedCount === 0 || String(item.processing_state ?? "").startsWith("pending");
        }).length
      }
    };
  }

  return {
    ensureStore,
    listAssets,
    getAsset,
    createAsset,
    updateAsset,
    attachAsset,
    updateAttachment,
    removeAttachment,
    reorderReleaseAttachments,
    listReleases,
    getRelease,
    createRelease,
    updateRelease,
    listBotSessions,
    upsertBotSession,
    appendActivity,
    listReleaseActivities,
    getOverview,
    dumpCollections
  };
}
