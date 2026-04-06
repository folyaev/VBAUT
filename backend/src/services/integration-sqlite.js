import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function jsonText(value) {
  return JSON.stringify(value ?? {});
}

function safeText(value) {
  return String(value ?? "").trim();
}

function parseRawJson(value) {
  const text = safeText(value);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function createIntegrationSqliteMirrorService({ dataDir }) {
  const integrationDir = path.join(dataDir, "_integration");
  const dbPath = path.join(integrationDir, "integration.sqlite");
  let db = null;

  function ensureDatabase() {
    if (db) return db;
    fs.mkdirSync(integrationDir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT,
        status TEXT,
        title TEXT,
        source_url TEXT,
        source_domain TEXT,
        local_path TEXT,
        created_at TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        asset_id TEXT,
        target_type TEXT,
        target_id TEXT,
        role TEXT,
        sort_order INTEGER,
        item_status TEXT,
        created_at TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS releases (
        id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        editor_status TEXT,
        document_id TEXT,
        created_at TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_sessions (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        user_id TEXT,
        mode TEXT,
        active_document_id TEXT,
        active_segment_id TEXT,
        active_release_id TEXT,
        last_seen_at TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT,
        status TEXT,
        asset_id TEXT,
        target_type TEXT,
        target_id TEXT,
        created_at TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        release_id TEXT,
        asset_id TEXT,
        attachment_id TEXT,
        event TEXT,
        created_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_profiles_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_profile_domains (
        list_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        PRIMARY KEY (list_name, domain)
      );
      CREATE TABLE IF NOT EXISTS source_profile_overrides (
        domain TEXT PRIMARY KEY,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_memory_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_memory_domains (
        domain TEXT PRIMARY KEY,
        applied_count INTEGER,
        helpful_count INTEGER,
        source_count INTEGER,
        attach_count INTEGER,
        screenshot_count INTEGER,
        download_count INTEGER,
        last_used_at TEXT,
        last_title TEXT,
        last_url TEXT
      );
      CREATE TABLE IF NOT EXISTS source_memory_urls (
        url TEXT PRIMARY KEY,
        domain TEXT,
        applied_count INTEGER,
        last_used_at TEXT,
        last_title TEXT
      );
      CREATE TABLE IF NOT EXISTS source_memory_recent (
        seq INTEGER PRIMARY KEY,
        domain TEXT,
        url TEXT,
        title TEXT,
        action TEXT,
        segment_id TEXT,
        doc_id TEXT,
        used_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_memory_patterns (
        seq INTEGER PRIMARY KEY,
        segment_key TEXT,
        section_title TEXT,
        quote_preview TEXT,
        tokens_json TEXT NOT NULL,
        domain TEXT,
        url TEXT,
        action TEXT,
        used_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS release_outcome_memory_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS release_outcome_domains (
        domain TEXT PRIMARY KEY,
        used_count INTEGER,
        attach_count INTEGER,
        prepare_count INTEGER,
        fill_count INTEGER,
        last_used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS release_outcome_kinds (
        kind TEXT PRIMARY KEY,
        used_count INTEGER,
        attach_count INTEGER,
        prepare_count INTEGER,
        fill_count INTEGER,
        last_used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS release_outcome_roles (
        role TEXT PRIMARY KEY,
        used_count INTEGER,
        attach_count INTEGER,
        prepare_count INTEGER,
        fill_count INTEGER,
        last_used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS release_outcome_recent (
        seq INTEGER PRIMARY KEY,
        release_id TEXT,
        asset_id TEXT,
        domain TEXT,
        kind TEXT,
        role TEXT,
        action TEXT,
        title TEXT,
        url TEXT,
        used_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_runs (
        run_id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        segment_id TEXT,
        section_id TEXT,
        section_title TEXT,
        status TEXT,
        mode TEXT,
        created_at TEXT,
        updated_at TEXT,
        brief_summary TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_documents (
        doc_id TEXT PRIMARY KEY,
        updated_at TEXT,
        notion_url TEXT,
        needs_segmentation INTEGER,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_segments (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        block_type TEXT,
        section_id TEXT,
        section_title TEXT,
        text_quote TEXT,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_decisions (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        has_visual INTEGER,
        updated_at TEXT,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_media_downloads (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        url TEXT,
        status TEXT,
        section_title TEXT,
        updated_at TEXT,
        output_files_json TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const hasSourceMemoryHelpfulCount = db
      .prepare("SELECT 1 AS ok FROM pragma_table_info('source_memory_domains') WHERE name = 'helpful_count'")
      .get();
    if (!hasSourceMemoryHelpfulCount) {
      db.exec("ALTER TABLE source_memory_domains ADD COLUMN helpful_count INTEGER DEFAULT 0");
    }
    return db;
  }

  function replaceTable(table, rows, mapper) {
    const database = ensureDatabase();
    database.exec(`DELETE FROM ${table}`);
    if (!Array.isArray(rows) || rows.length === 0) return;
    const mapped = rows.map(mapper);
    const columns = Object.keys(mapped[0]);
    const stmt = database.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => `:${column}`).join(", ")})`
    );
    for (const row of mapped) stmt.run(row);
  }

  function setMeta(key, value) {
    const database = ensureDatabase();
    const stmt = database.prepare(`
      INSERT INTO meta (key, value) VALUES (:key, :value)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run({ key, value: String(value ?? "") });
  }

  function getFileSizeSafe(filePath) {
    try {
      return Number(fs.statSync(filePath)?.size ?? 0);
    } catch {
      return 0;
    }
  }

  function getMeta(key) {
    const database = ensureDatabase();
    const row = database.prepare("SELECT value FROM meta WHERE key = ?").get(String(key));
    return safeText(row?.value);
  }

  function replaceSingletonState(table, payload = {}, updatedAt = new Date().toISOString()) {
    const database = ensureDatabase();
    database.exec(`DELETE FROM ${table}`);
    const stmt = database.prepare(
      `INSERT INTO ${table} (id, version, updated_at, raw_json) VALUES (1, :version, :updated_at, :raw_json)`
    );
    stmt.run({
      version: Number(payload?.version ?? 1) || 1,
      updated_at: safeText(updatedAt),
      raw_json: jsonText(payload)
    });
  }

  function readSingletonState(table) {
    const database = ensureDatabase();
    const row = database.prepare(`SELECT raw_json FROM ${table} WHERE id = 1`).get();
    const parsed = parseRawJson(row?.raw_json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0
      ? parsed
      : null;
  }

  function syncCollections(snapshot = {}, meta = {}) {
    const database = ensureDatabase();
    const currentSnapshot = snapshot ?? {};
    const currentMeta = meta ?? {};
    database.exec("BEGIN");
    try {
      replaceTable("assets", currentSnapshot.assets ?? [], (item) => ({
        id: safeText(item.id),
        kind: safeText(item.kind),
        status: safeText(item.status),
        title: safeText(item.title),
        source_url: safeText(item.source_url),
        source_domain: safeText(item.source_domain),
        local_path: safeText(item.local_path),
        created_at: safeText(item.created_at),
        updated_at: safeText(item.updated_at),
        raw_json: jsonText(item)
      }));
      replaceTable("attachments", currentSnapshot.attachments ?? [], (item) => ({
        id: safeText(item.id),
        asset_id: safeText(item.asset_id),
        target_type: safeText(item.target_type),
        target_id: safeText(item.target_id),
        role: safeText(item.role),
        sort_order: Number(item.sort_order ?? 0) || 0,
        item_status: safeText(item.item_status),
        created_at: safeText(item.created_at),
        updated_at: safeText(item.updated_at),
        raw_json: jsonText(item)
      }));
      replaceTable("releases", currentSnapshot.releases ?? [], (item) => ({
        id: safeText(item.id),
        title: safeText(item.title),
        status: safeText(item.status),
        editor_status: safeText(item.editor_status),
        document_id: safeText(item.document_id),
        created_at: safeText(item.created_at),
        updated_at: safeText(item.updated_at),
        raw_json: jsonText(item)
      }));
      replaceTable("bot_sessions", currentSnapshot.bot_sessions ?? [], (item) => ({
        id: safeText(item.id),
        chat_id: safeText(item.chat_id),
        user_id: safeText(item.user_id),
        mode: safeText(item.mode),
        active_document_id: safeText(item.active_document_id),
        active_segment_id: safeText(item.active_segment_id),
        active_release_id: safeText(item.active_release_id),
        last_seen_at: safeText(item.last_seen_at),
        updated_at: safeText(item.updated_at),
        raw_json: jsonText(item)
      }));
      replaceTable("jobs", currentSnapshot.jobs ?? [], (item) => ({
        id: safeText(item.id),
        kind: safeText(item.kind),
        status: safeText(item.status),
        asset_id: safeText(item.asset_id),
        target_type: safeText(item.target_type),
        target_id: safeText(item.target_id),
        created_at: safeText(item.created_at),
        updated_at: safeText(item.updated_at),
        raw_json: jsonText(item)
      }));
      replaceTable("activities", currentSnapshot.activities ?? [], (item) => ({
        id: safeText(item.id),
        release_id: safeText(item.release_id),
        asset_id: safeText(item.asset_id),
        attachment_id: safeText(item.attachment_id),
        event: safeText(item.event),
        created_at: safeText(item.created_at),
        raw_json: jsonText(item)
      }));
      setMeta("last_sync_at", new Date().toISOString());
      setMeta("last_reason", safeText(currentMeta?.reason || "sync"));
      setMeta(
        "counts",
        jsonText({
          assets: Array.isArray(currentSnapshot.assets) ? currentSnapshot.assets.length : 0,
          attachments: Array.isArray(currentSnapshot.attachments) ? currentSnapshot.attachments.length : 0,
          releases: Array.isArray(currentSnapshot.releases) ? currentSnapshot.releases.length : 0,
          bot_sessions: Array.isArray(currentSnapshot.bot_sessions) ? currentSnapshot.bot_sessions.length : 0,
          jobs: Array.isArray(currentSnapshot.jobs) ? currentSnapshot.jobs.length : 0,
          activities: Array.isArray(currentSnapshot.activities) ? currentSnapshot.activities.length : 0
        })
      );
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
    return getStatus();
  }

  function syncAssistantMemory(snapshot = {}, meta = {}) {
    const database = ensureDatabase();
    const currentSnapshot = snapshot ?? {};
    const currentMeta = meta ?? {};
    const nowIso = new Date().toISOString();
    database.exec("BEGIN");
    try {
      if (Object.prototype.hasOwnProperty.call(currentSnapshot, "sourceProfiles")) {
        const sourceProfiles = currentSnapshot.sourceProfiles ?? {};
        replaceSingletonState("source_profiles_state", sourceProfiles, nowIso);
        replaceTable(
          "source_profile_domains",
          [
            ...((sourceProfiles?.trusted_domains ?? []).map((domain) => ({ list_name: "trusted_domains", domain }))),
            ...((sourceProfiles?.blocked_domains ?? []).map((domain) => ({ list_name: "blocked_domains", domain }))),
            ...((sourceProfiles?.video_platform_domains ?? []).map((domain) => ({ list_name: "video_platform_domains", domain }))),
            ...((sourceProfiles?.social_domains ?? []).map((domain) => ({ list_name: "social_domains", domain }))),
            ...((sourceProfiles?.downloadable_domains ?? []).map((domain) => ({ list_name: "downloadable_domains", domain }))),
            ...((sourceProfiles?.screenshot_friendly_domains ?? []).map((domain) => ({ list_name: "screenshot_friendly_domains", domain })))
          ],
          (item) => ({
            list_name: safeText(item.list_name),
            domain: safeText(item.domain)
          })
        );
        replaceTable(
          "source_profile_overrides",
          Object.entries(sourceProfiles?.domain_profiles ?? {}).map(([domain, profile]) => ({
            domain,
            profile
          })),
          (item) => ({
            domain: safeText(item.domain),
            raw_json: jsonText(item.profile)
          })
        );
      }

      if (Object.prototype.hasOwnProperty.call(currentSnapshot, "sourceMemory")) {
        const sourceMemory = currentSnapshot.sourceMemory ?? {};
        replaceSingletonState("source_memory_state", sourceMemory, nowIso);
        replaceTable(
          "source_memory_domains",
          Object.entries(sourceMemory?.domains ?? {}).map(([domain, stats]) => ({ domain, stats })),
          (item) => ({
            domain: safeText(item.domain),
            applied_count: Number(item.stats?.applied_count ?? 0) || 0,
            helpful_count: Number(item.stats?.helpful_count ?? 0) || 0,
            source_count: Number(item.stats?.source_count ?? 0) || 0,
            attach_count: Number(item.stats?.attach_count ?? 0) || 0,
            screenshot_count: Number(item.stats?.screenshot_count ?? 0) || 0,
            download_count: Number(item.stats?.download_count ?? 0) || 0,
            last_used_at: safeText(item.stats?.last_used_at),
            last_title: safeText(item.stats?.last_title),
            last_url: safeText(item.stats?.last_url)
          })
        );
        replaceTable(
          "source_memory_urls",
          Object.entries(sourceMemory?.urls ?? {}).map(([url, stats]) => ({ url, stats })),
          (item) => ({
            url: safeText(item.url),
            domain: safeText(item.stats?.domain),
            applied_count: Number(item.stats?.applied_count ?? 0) || 0,
            last_used_at: safeText(item.stats?.last_used_at),
            last_title: safeText(item.stats?.last_title)
          })
        );
        replaceTable(
          "source_memory_recent",
          (sourceMemory?.recent ?? []).map((item, index) => ({ ...item, seq: index + 1 })),
          (item) => ({
            seq: Number(item.seq ?? 0) || 0,
            domain: safeText(item.domain),
            url: safeText(item.url),
            title: safeText(item.title),
            action: safeText(item.action),
            segment_id: safeText(item.segment_id),
            doc_id: safeText(item.doc_id),
            used_at: safeText(item.used_at),
            raw_json: jsonText(item)
          })
        );
        replaceTable(
          "source_memory_patterns",
          (sourceMemory?.patterns ?? []).map((item, index) => ({ ...item, seq: index + 1 })),
          (item) => ({
            seq: Number(item.seq ?? 0) || 0,
            segment_key: safeText(item.segment_key),
            section_title: safeText(item.section_title),
            quote_preview: safeText(item.quote_preview),
            tokens_json: jsonText(Array.isArray(item.tokens) ? item.tokens : []),
            domain: safeText(item.domain),
            url: safeText(item.url),
            action: safeText(item.action),
            used_at: safeText(item.used_at),
            raw_json: jsonText(item)
          })
        );
      }

      if (Object.prototype.hasOwnProperty.call(currentSnapshot, "releaseOutcomeMemory")) {
        const releaseOutcomeMemory = currentSnapshot.releaseOutcomeMemory ?? {};
        replaceSingletonState("release_outcome_memory_state", releaseOutcomeMemory, nowIso);
        replaceTable(
          "release_outcome_domains",
          Object.entries(releaseOutcomeMemory?.domains ?? {}).map(([domain, stats]) => ({ domain, stats })),
          (item) => ({
            domain: safeText(item.domain),
            used_count: Number(item.stats?.used_count ?? 0) || 0,
            attach_count: Number(item.stats?.attach_count ?? 0) || 0,
            prepare_count: Number(item.stats?.prepare_count ?? 0) || 0,
            fill_count: Number(item.stats?.fill_count ?? 0) || 0,
            last_used_at: safeText(item.stats?.last_used_at)
          })
        );
        replaceTable(
          "release_outcome_kinds",
          Object.entries(releaseOutcomeMemory?.kinds ?? {}).map(([kind, stats]) => ({ kind, stats })),
          (item) => ({
            kind: safeText(item.kind),
            used_count: Number(item.stats?.used_count ?? 0) || 0,
            attach_count: Number(item.stats?.attach_count ?? 0) || 0,
            prepare_count: Number(item.stats?.prepare_count ?? 0) || 0,
            fill_count: Number(item.stats?.fill_count ?? 0) || 0,
            last_used_at: safeText(item.stats?.last_used_at)
          })
        );
        replaceTable(
          "release_outcome_roles",
          Object.entries(releaseOutcomeMemory?.roles ?? {}).map(([role, stats]) => ({ role, stats })),
          (item) => ({
            role: safeText(item.role),
            used_count: Number(item.stats?.used_count ?? 0) || 0,
            attach_count: Number(item.stats?.attach_count ?? 0) || 0,
            prepare_count: Number(item.stats?.prepare_count ?? 0) || 0,
            fill_count: Number(item.stats?.fill_count ?? 0) || 0,
            last_used_at: safeText(item.stats?.last_used_at)
          })
        );
        replaceTable(
          "release_outcome_recent",
          (releaseOutcomeMemory?.recent ?? []).map((item, index) => ({ ...item, seq: index + 1 })),
          (item) => ({
            seq: Number(item.seq ?? 0) || 0,
            release_id: safeText(item.release_id),
            asset_id: safeText(item.asset_id),
            domain: safeText(item.domain),
            kind: safeText(item.kind),
            role: safeText(item.role),
            action: safeText(item.action),
            title: safeText(item.title),
            url: safeText(item.url),
            used_at: safeText(item.used_at),
            raw_json: jsonText(item)
          })
        );
      }

      setMeta("assistant_last_sync_at", nowIso);
      setMeta("assistant_last_reason", safeText(currentMeta?.reason || "assistant_memory_sync"));
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
    return getStatus();
  }

  function syncResearchRuns(docId, runs = [], meta = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return getStatus();
    const currentRuns = Array.isArray(runs) ? runs : [];
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM research_runs WHERE doc_id = ?").run(normalizedDocId);
      if (currentRuns.length > 0) {
        const stmt = database.prepare(`
          INSERT INTO research_runs (
            run_id, doc_id, segment_id, section_id, section_title, status, mode, created_at, updated_at, brief_summary, raw_json
          ) VALUES (
            :run_id, :doc_id, :segment_id, :section_id, :section_title, :status, :mode, :created_at, :updated_at, :brief_summary, :raw_json
          )
        `);
        for (const item of currentRuns) {
          stmt.run({
            run_id: safeText(item?.run_id),
            doc_id: normalizedDocId,
            segment_id: safeText(item?.segment_id),
            section_id: safeText(item?.section_id),
            section_title: safeText(item?.section_title),
            status: safeText(item?.status),
            mode: safeText(item?.mode),
            created_at: safeText(item?.created_at),
            updated_at: safeText(item?.updated_at),
            brief_summary: safeText(item?.brief?.summary),
            raw_json: jsonText(item)
          });
        }
      }
      setMeta("research_last_sync_at", new Date().toISOString());
      setMeta("research_last_reason", safeText(meta?.reason || "research_sync"));
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
    return getStatus();
  }

  function syncDocumentContext(docId, segments = [], decisions = [], meta = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return getStatus();
    const nowIso = new Date().toISOString();
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM doc_segments WHERE doc_id = ?").run(normalizedDocId);
      database.prepare("DELETE FROM doc_decisions WHERE doc_id = ?").run(normalizedDocId);
      if (Array.isArray(segments) && segments.length > 0) {
        const segmentStmt = database.prepare(`
          INSERT INTO doc_segments (
            id, doc_id, block_type, section_id, section_title, text_quote, updated_at, raw_json
          ) VALUES (
            :id, :doc_id, :block_type, :section_id, :section_title, :text_quote, :updated_at, :raw_json
          )
        `);
        for (const item of segments) {
          const segmentId = safeText(item?.segment_id);
          segmentStmt.run({
            id: safeText(`${normalizedDocId}::${segmentId}`),
            doc_id: normalizedDocId,
            block_type: safeText(item?.block_type),
            section_id: safeText(item?.section_id),
            section_title: safeText(item?.section_title),
            text_quote: safeText(item?.text_quote),
            updated_at: safeText(item?.updated_at || nowIso),
            raw_json: jsonText(item)
          });
        }
      }
      if (Array.isArray(decisions) && decisions.length > 0) {
        const decisionStmt = database.prepare(`
          INSERT INTO doc_decisions (
            id, doc_id, has_visual, updated_at, raw_json
          ) VALUES (
            :id, :doc_id, :has_visual, :updated_at, :raw_json
          )
        `);
        for (const item of decisions) {
          const segmentId = safeText(item?.segment_id);
          const visual = item?.visual_decision ?? {};
          const hasVisual = Number(
            Boolean(
              safeText(visual?.description) ||
                safeText(visual?.format_hint) ||
                safeText(visual?.priority) ||
                safeText(visual?.media_file_path) ||
                (Array.isArray(visual?.media_file_paths) && visual.media_file_paths.some((entry) => safeText(entry))) ||
                ((visual?.duration_hint_sec ?? null) !== null && (visual?.duration_hint_sec ?? null) !== undefined) ||
                (safeText(visual?.type) && safeText(visual?.type) !== "no_visual")
            )
          );
          decisionStmt.run({
            id: safeText(`${normalizedDocId}::${segmentId}`),
            doc_id: normalizedDocId,
            has_visual: hasVisual,
            updated_at: safeText(item?.updated_at || nowIso),
            raw_json: jsonText(item)
          });
        }
      }
      setMeta("doc_context_last_sync_at", nowIso);
      setMeta("doc_context_last_reason", safeText(meta?.reason || "doc_context_sync"));
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
    return getStatus();
  }

  function syncDocumentState(docId, document = null, meta = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId || document?.id);
    if (!normalizedDocId) return getStatus();
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM doc_documents WHERE doc_id = ?").run(normalizedDocId);
      if (document && typeof document === "object" && !Array.isArray(document)) {
        database
          .prepare(
            `
              INSERT INTO doc_documents (
                doc_id, updated_at, notion_url, needs_segmentation, raw_json
              ) VALUES (
                :doc_id, :updated_at, :notion_url, :needs_segmentation, :raw_json
              )
            `
          )
          .run({
            doc_id: normalizedDocId,
            updated_at: safeText(document?.updated_at ?? document?.created_at),
            notion_url: safeText(document?.notion_url),
            needs_segmentation: document?.needs_segmentation ? 1 : 0,
            raw_json: jsonText(document)
          });
      }
      setMeta("doc_documents_last_sync_at", new Date().toISOString());
      setMeta("doc_documents_last_reason", safeText(meta?.reason) || "doc_documents_sync");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getStatus();
  }

  function syncDocumentMediaDownloads(docId, mediaDownloads = {}, meta = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return getStatus();
    const entries =
      mediaDownloads && typeof mediaDownloads === "object" && !Array.isArray(mediaDownloads)
        ? Object.entries(mediaDownloads)
        : [];
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM doc_media_downloads WHERE doc_id = ?").run(normalizedDocId);
      if (entries.length > 0) {
        const stmt = database.prepare(`
          INSERT INTO doc_media_downloads (
            id, doc_id, url, status, section_title, updated_at, output_files_json, raw_json
          ) VALUES (
            :id, :doc_id, :url, :status, :section_title, :updated_at, :output_files_json, :raw_json
          )
        `);
        for (const [key, value] of entries) {
          const item = value && typeof value === "object" ? value : { url: key, status: "completed" };
          const url = safeText(key || item?.url);
          if (!url) continue;
          const outputFiles = Array.isArray(item?.output_files)
            ? item.output_files.map((entry) => safeText(entry)).filter(Boolean)
            : [];
          const raw = {
            ...item,
            url,
            output_files: outputFiles
          };
          stmt.run({
            id: `${normalizedDocId}::${url}`,
            doc_id: normalizedDocId,
            url,
            status: safeText(item?.status) || "completed",
            section_title: safeText(item?.section_title),
            updated_at: safeText(item?.updated_at),
            output_files_json: JSON.stringify(outputFiles),
            raw_json: jsonText(raw)
          });
        }
      }
      setMeta("doc_media_downloads_last_sync_at", new Date().toISOString());
      setMeta("doc_media_downloads_last_reason", safeText(meta?.reason) || "doc_media_downloads_sync");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return getStatus();
  }

  function getStatus() {
    const database = ensureDatabase();
    const counts = {
      assets: Number(database.prepare("SELECT COUNT(*) AS count FROM assets").get()?.count ?? 0),
      attachments: Number(database.prepare("SELECT COUNT(*) AS count FROM attachments").get()?.count ?? 0),
      releases: Number(database.prepare("SELECT COUNT(*) AS count FROM releases").get()?.count ?? 0),
      bot_sessions: Number(database.prepare("SELECT COUNT(*) AS count FROM bot_sessions").get()?.count ?? 0),
      jobs: Number(database.prepare("SELECT COUNT(*) AS count FROM jobs").get()?.count ?? 0),
      activities: Number(database.prepare("SELECT COUNT(*) AS count FROM activities").get()?.count ?? 0)
    };
    const assistantMemory = {
      source_profile_domains: Number(database.prepare("SELECT COUNT(*) AS count FROM source_profile_domains").get()?.count ?? 0),
      source_profile_overrides: Number(database.prepare("SELECT COUNT(*) AS count FROM source_profile_overrides").get()?.count ?? 0),
      source_memory_domains: Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_domains").get()?.count ?? 0),
      source_memory_urls: Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_urls").get()?.count ?? 0),
      source_memory_recent: Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_recent").get()?.count ?? 0),
      source_memory_patterns: Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_patterns").get()?.count ?? 0),
      release_outcome_domains: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_domains").get()?.count ?? 0),
      release_outcome_kinds: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_kinds").get()?.count ?? 0),
      release_outcome_roles: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_roles").get()?.count ?? 0),
      release_outcome_recent: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_recent").get()?.count ?? 0),
      research_runs: Number(database.prepare("SELECT COUNT(*) AS count FROM research_runs").get()?.count ?? 0),
      doc_documents: Number(database.prepare("SELECT COUNT(*) AS count FROM doc_documents").get()?.count ?? 0),
      doc_segments: Number(database.prepare("SELECT COUNT(*) AS count FROM doc_segments").get()?.count ?? 0),
      doc_decisions: Number(database.prepare("SELECT COUNT(*) AS count FROM doc_decisions").get()?.count ?? 0),
      doc_media_downloads: Number(database.prepare("SELECT COUNT(*) AS count FROM doc_media_downloads").get()?.count ?? 0)
    };
    return {
      path: dbPath,
      db_size_bytes: getFileSizeSafe(dbPath),
      wal_path: `${dbPath}-wal`,
      wal_size_bytes: getFileSizeSafe(`${dbPath}-wal`),
      shm_path: `${dbPath}-shm`,
      shm_size_bytes: getFileSizeSafe(`${dbPath}-shm`),
      last_sync_at: getMeta("last_sync_at"),
      last_reason: getMeta("last_reason"),
      assistant_last_sync_at: getMeta("assistant_last_sync_at"),
      assistant_last_reason: getMeta("assistant_last_reason"),
      research_last_sync_at: getMeta("research_last_sync_at"),
      research_last_reason: getMeta("research_last_reason"),
      doc_documents_last_sync_at: getMeta("doc_documents_last_sync_at"),
      doc_documents_last_reason: getMeta("doc_documents_last_reason"),
      doc_context_last_sync_at: getMeta("doc_context_last_sync_at"),
      doc_context_last_reason: getMeta("doc_context_last_reason"),
      doc_media_downloads_last_sync_at: getMeta("doc_media_downloads_last_sync_at"),
      doc_media_downloads_last_reason: getMeta("doc_media_downloads_last_reason"),
      counts,
      assistant_memory: assistantMemory
    };
  }

  function checkpoint(mode = "PASSIVE") {
    const normalizedMode = safeText(mode).toUpperCase() || "PASSIVE";
    const checkpointMode = ["PASSIVE", "FULL", "RESTART", "TRUNCATE"].includes(normalizedMode)
      ? normalizedMode
      : "PASSIVE";
    const database = ensureDatabase();
    const result = database.prepare(`PRAGMA wal_checkpoint(${checkpointMode})`).get() ?? {};
    return {
      ...getStatus(),
      checkpoint: {
        mode: checkpointMode,
        busy: Number(result?.busy ?? 0),
        log: Number(result?.log ?? 0),
        checkpointed: Number(result?.checkpointed ?? 0)
      }
    };
  }

  function getSourceProfiles() {
    const database = ensureDatabase();
    const state = readSingletonState("source_profiles_state");
    const listNames = [
      "trusted_domains",
      "blocked_domains",
      "video_platform_domains",
      "social_domains",
      "downloadable_domains",
      "screenshot_friendly_domains"
    ];
    const lists = Object.fromEntries(
      listNames.map((listName) => {
        const rows = database
          .prepare(
            `
              SELECT domain
              FROM source_profile_domains
              WHERE list_name = ?
              ORDER BY domain ASC
            `
          )
          .all(listName)
          .map((row) => safeText(row?.domain))
          .filter(Boolean);
        return [listName, rows];
      })
    );
    const domainProfiles = Object.fromEntries(
      database
        .prepare(
          `
            SELECT domain, raw_json
            FROM source_profile_overrides
            ORDER BY domain ASC
          `
        )
        .all()
        .map((row) => [safeText(row?.domain), parseRawJson(row?.raw_json)])
        .filter(([domain]) => Boolean(domain))
    );
    const hasTableState =
      Object.values(lists).some((items) => Array.isArray(items) && items.length > 0) ||
      Object.keys(domainProfiles).length > 0;
    if (!hasTableState) return state;
    return {
      version: Number(state?.version ?? 1) || 1,
      ...lists,
      domain_profiles: domainProfiles
    };
  }

  function getSourceMemory() {
    return readSingletonState("source_memory_state");
  }

  function getReleaseOutcomeMemory() {
    return readSingletonState("release_outcome_memory_state");
  }

  function summarizeSourceMemory() {
    const database = ensureDatabase();
    const totalDomains = Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_domains").get()?.count ?? 0);
    const totalUrls = Number(database.prepare("SELECT COUNT(*) AS count FROM source_memory_urls").get()?.count ?? 0);
    const totalPatterns = Number(database.prepare("SELECT COUNT(DISTINCT segment_key) AS count FROM source_memory_patterns").get()?.count ?? 0);
    const topDomains = database
      .prepare(
        `
          SELECT
            domain,
            applied_count,
            helpful_count,
            source_count,
            attach_count,
            screenshot_count,
            download_count,
            last_used_at,
            last_title,
            last_url
          FROM source_memory_domains
          ORDER BY applied_count DESC, last_used_at DESC
          LIMIT 8
        `
      )
      .all()
      .map((row) => ({
        domain: safeText(row?.domain),
        applied_count: Number(row?.applied_count ?? 0),
        helpful_count: Number(row?.helpful_count ?? 0),
        source_count: Number(row?.source_count ?? 0),
        attach_count: Number(row?.attach_count ?? 0),
        screenshot_count: Number(row?.screenshot_count ?? 0),
        download_count: Number(row?.download_count ?? 0),
        last_used_at: safeText(row?.last_used_at) || null,
        last_title: safeText(row?.last_title) || null,
        last_url: safeText(row?.last_url) || null
      }));
    const topPatterns = database
      .prepare(
        `
          SELECT
            segment_key,
            MAX(section_title) AS section_title,
            COUNT(*) AS count,
            MAX(used_at) AS last_used_at,
            MAX(domain) AS sample_domain
          FROM source_memory_patterns
          GROUP BY segment_key
          ORDER BY count DESC, last_used_at DESC
          LIMIT 8
        `
      )
      .all()
      .map((row) => ({
        segment_key: safeText(row?.segment_key),
        section_title: safeText(row?.section_title) || null,
        count: Number(row?.count ?? 0),
        last_used_at: safeText(row?.last_used_at) || null,
        sample_domain: safeText(row?.sample_domain) || null
      }));
    const recent = database
      .prepare(
        `
          SELECT raw_json
          FROM source_memory_recent
          ORDER BY used_at DESC, seq ASC
          LIMIT 12
        `
      )
      .all()
      .map((row) => parseRawJson(row?.raw_json));
    return {
      total_domains: totalDomains,
      total_urls: totalUrls,
      total_patterns: totalPatterns,
      top_domains: topDomains,
      top_patterns: topPatterns,
      recent
    };
  }

  function summarizeReleaseOutcomeMemory() {
    const database = ensureDatabase();
    const toRankedEntries = (table, keyColumn) =>
      database
        .prepare(
          `
            SELECT
              ${keyColumn} AS entry_key,
              used_count,
              attach_count,
              prepare_count,
              fill_count,
              last_used_at
            FROM ${table}
            ORDER BY used_count DESC, last_used_at DESC
            LIMIT 8
          `
        )
        .all()
        .map((row) => ({
          key: safeText(row?.entry_key),
          used_count: Number(row?.used_count ?? 0),
          attach_count: Number(row?.attach_count ?? 0),
          prepare_count: Number(row?.prepare_count ?? 0),
          fill_count: Number(row?.fill_count ?? 0),
          last_used_at: safeText(row?.last_used_at) || null
        }));
    return {
      total_domains: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_domains").get()?.count ?? 0),
      total_kinds: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_kinds").get()?.count ?? 0),
      total_roles: Number(database.prepare("SELECT COUNT(*) AS count FROM release_outcome_roles").get()?.count ?? 0),
      top_domains: toRankedEntries("release_outcome_domains", "domain"),
      top_kinds: toRankedEntries("release_outcome_kinds", "kind"),
      top_roles: toRankedEntries("release_outcome_roles", "role"),
      recent: database
        .prepare(
          `
            SELECT raw_json
            FROM release_outcome_recent
            ORDER BY used_at DESC, seq ASC
            LIMIT 12
          `
        )
        .all()
        .map((row) => parseRawJson(row?.raw_json))
    };
  }

  function listResearchRuns(docId, options = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return [];
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : null;
    const stmt = database.prepare(
      `
        SELECT raw_json
        FROM research_runs
        WHERE doc_id = ?
        ORDER BY updated_at DESC, created_at DESC
        ${limit ? `LIMIT ${limit}` : ""}
      `
    );
    return stmt.all(normalizedDocId).map((row) => parseRawJson(row?.raw_json));
  }

  function listRunsForSegment(docId, segmentId, options = {}) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    const normalizedSegmentId = safeText(segmentId);
    if (!normalizedDocId || !normalizedSegmentId) return [];
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : null;
    const stmt = database.prepare(
      `
        SELECT raw_json
        FROM research_runs
        WHERE doc_id = ? AND segment_id = ?
        ORDER BY updated_at DESC, created_at DESC
        ${limit ? `LIMIT ${limit}` : ""}
      `
    );
    return stmt.all(normalizedDocId, normalizedSegmentId).map((row) => parseRawJson(row?.raw_json));
  }

  function getLatestResearchRun(docId, segmentId) {
    return listRunsForSegment(docId, segmentId, { limit: 1 })[0] ?? null;
  }

  function getResearchRunById(docId, runId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    const normalizedRunId = safeText(runId);
    if (!normalizedDocId || !normalizedRunId) return null;
    const row = database
      .prepare(
        `
          SELECT raw_json
          FROM research_runs
          WHERE doc_id = ? AND run_id = ?
        `
      )
      .get(normalizedDocId, normalizedRunId);
    const parsed = parseRawJson(row?.raw_json);
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  }

  function listDocSegments(docId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return [];
    return database
      .prepare(
        `
          SELECT raw_json
          FROM doc_segments
          WHERE doc_id = ?
          ORDER BY section_title ASC, id ASC
        `
      )
      .all(normalizedDocId)
      .map((row) => parseRawJson(row?.raw_json));
  }

  function getDocumentState(docId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return null;
    const row = database
      .prepare(
        `
          SELECT raw_json
          FROM doc_documents
          WHERE doc_id = ?
        `
      )
      .get(normalizedDocId);
    const parsed = parseRawJson(row?.raw_json);
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  }

  function summarizeDocumentState(docId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return null;
    const row = database
      .prepare(
        `
          SELECT updated_at
          FROM (
            SELECT updated_at FROM doc_documents WHERE doc_id = ?
            UNION ALL
            SELECT updated_at FROM doc_segments WHERE doc_id = ?
            UNION ALL
            SELECT updated_at FROM doc_decisions WHERE doc_id = ?
            UNION ALL
            SELECT updated_at FROM research_runs WHERE doc_id = ?
          )
          WHERE COALESCE(updated_at, '') <> ''
          ORDER BY updated_at DESC
          LIMIT 1
        `
      )
      .get(normalizedDocId, normalizedDocId, normalizedDocId, normalizedDocId);
    const updatedAt = safeText(row?.updated_at);
    if (!updatedAt) return null;
    const revision = Date.parse(updatedAt);
    return {
      revision: Number.isFinite(revision) ? revision : 0,
      updated_at: updatedAt
    };
  }

  function listDocDecisions(docId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return [];
    return database
      .prepare(
        `
          SELECT raw_json
          FROM doc_decisions
          WHERE doc_id = ?
          ORDER BY id ASC
        `
      )
      .all(normalizedDocId)
      .map((row) => parseRawJson(row?.raw_json));
  }

  function getDocumentMediaDownloads(docId) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return {};
    const rows = database
      .prepare(
        `
          SELECT url, raw_json
          FROM doc_media_downloads
          WHERE doc_id = ?
          ORDER BY updated_at DESC, url ASC
        `
      )
      .all(normalizedDocId);
    const result = {};
    for (const row of rows) {
      const parsed = parseRawJson(row?.raw_json);
      const url = safeText(row?.url || parsed?.url);
      if (!url) continue;
      result[url] = {
        ...parsed,
        url
      };
    }
    return result;
  }

  function listDocSegmentsWithoutVisual(docId, limit = 20) {
    const database = ensureDatabase();
    const normalizedDocId = safeText(docId);
    if (!normalizedDocId) return [];
    const normalizedLimit = Math.max(1, Number(limit) || 20);
    return database
      .prepare(
        `
          SELECT
            s.raw_json AS segment_raw
          FROM doc_segments s
          LEFT JOIN doc_decisions d
            ON d.doc_id = s.doc_id
           AND json_extract(d.raw_json, '$.segment_id') = json_extract(s.raw_json, '$.segment_id')
          WHERE s.doc_id = ?
            AND LOWER(COALESCE(s.block_type, '')) != 'links'
            AND json_extract(s.raw_json, '$.segment_id') NOT LIKE 'comments_%'
            AND COALESCE(d.has_visual, 0) = 0
          ORDER BY s.section_title ASC, s.id ASC
          LIMIT ?
        `
      )
      .all(normalizedDocId, normalizedLimit)
      .map((row) => parseRawJson(row?.segment_raw))
      .map((segment) => {
        const links = Array.isArray(segment?.links) ? segment.links.filter((item) => safeText(item?.url ?? item)) : [];
        return {
          segment_id: safeText(segment?.segment_id),
          section_title: safeText(segment?.section_title),
          has_links: links.length > 0
        };
      })
      .filter((item) => Boolean(item.segment_id));
  }

  function listOrphanScreenshotsForRelease(releaseId, documentId, limit = 20) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    const normalizedDocumentId = safeText(documentId);
    if (!normalizedReleaseId) return [];
    const normalizedLimit = Math.max(1, Number(limit) || 20);
    const rows = database
      .prepare(
        `
          SELECT a.id
          FROM assets a
          WHERE a.kind = 'screenshot'
            AND NOT EXISTS (
              SELECT 1
              FROM attachments att_release
              WHERE att_release.asset_id = a.id
                AND att_release.target_type = 'release'
                AND att_release.target_id = ?
            )
            AND (
              ? = ''
              OR EXISTS (
                SELECT 1
                FROM attachments att_ctx
                WHERE att_ctx.asset_id = a.id
                  AND (
                    (att_ctx.target_type = 'document' AND att_ctx.target_id = ?)
                    OR att_ctx.target_type = 'segment'
                  )
              )
            )
          ORDER BY a.updated_at DESC
          LIMIT ?
        `
      )
      .all(normalizedReleaseId, normalizedDocumentId, normalizedDocumentId, normalizedLimit);
    return rows
      .map((row) => buildAssetSummaryById(row?.id))
      .filter(Boolean);
  }

  function listRecommendationCandidatesForRelease(releaseId, documentId, options = {}) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    const normalizedDocumentId = safeText(documentId);
    const normalizedLimit = Math.max(1, Number(options?.limit) || 400);
    const sectionTitles = Array.from(
      new Set(
        (Array.isArray(options?.section_titles) ? options.section_titles : [])
          .map((value) => safeText(value).toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 24);
    const domains = Array.from(
      new Set(
        (Array.isArray(options?.domains) ? options.domains : [])
          .map((value) => safeText(value).toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 24);
    const sectionCase =
      sectionTitles.length > 0
        ? `CASE WHEN LOWER(COALESCE(json_extract(a.raw_json, '$.meta_json.section_title'), '')) IN (${sectionTitles
            .map(() => "?")
            .join(", ")}) THEN 1 ELSE 0 END`
        : "0";
    const domainCase =
      domains.length > 0
        ? `CASE WHEN LOWER(COALESCE(a.source_domain, '')) IN (${domains.map(() => "?").join(", ")}) THEN 1 ELSE 0 END`
        : "0";
    const values = [
      normalizedDocumentId,
      normalizedDocumentId,
      ...sectionTitles,
      ...domains,
      normalizedReleaseId,
      normalizedLimit
    ];
    const rows = database
      .prepare(
        `
          SELECT
            a.id,
            CASE
              WHEN ? <> '' AND EXISTS (
                SELECT 1
                FROM attachments att_ctx
                WHERE att_ctx.asset_id = a.id
                  AND (
                    (att_ctx.target_type = 'document' AND att_ctx.target_id = ?)
                    OR att_ctx.target_type = 'segment'
                  )
              )
              THEN 1
              ELSE 0
            END AS same_doc_context,
            ${sectionCase} AS same_section,
            ${domainCase} AS same_domain,
            CASE
              WHEN a.kind IN ('screenshot', 'telegram_media', 'downloaded_media', 'preview')
              THEN 1
              ELSE 0
            END AS visual_candidate,
            CASE
              WHEN a.kind IN ('link', 'note', 'preview')
              THEN 1
              ELSE 0
            END AS source_candidate,
            CASE
              WHEN LOWER(COALESCE(json_extract(a.raw_json, '$.processing_state'), '')) IN ('processed', 'attached')
              THEN 1
              ELSE 0
            END AS ready_state
          FROM assets a
          WHERE a.kind IN ('screenshot', 'telegram_media', 'downloaded_media', 'preview', 'link', 'note')
            AND LOWER(COALESCE(a.status, '')) NOT IN ('archived', 'failed')
            AND LOWER(COALESCE(json_extract(a.raw_json, '$.processing_state'), '')) != 'failed'
            AND NOT EXISTS (
              SELECT 1
              FROM attachments att_release
              WHERE att_release.asset_id = a.id
                AND att_release.target_type = 'release'
                AND att_release.target_id = ?
            )
          ORDER BY
            same_doc_context DESC,
            same_section DESC,
            same_domain DESC,
            visual_candidate DESC,
            source_candidate DESC,
            ready_state DESC,
            a.updated_at DESC
          LIMIT ?
        `
      )
      .all(...values);
    return rows
      .map((row) => buildAssetSummaryById(row?.id))
      .filter(Boolean);
  }

  function listRecommendationCandidatesForItem(releaseId, documentId, options = {}) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    const normalizedDocumentId = safeText(documentId);
    const normalizedLimit = Math.max(1, Number(options?.limit) || 80);
    const normalizedSectionTitle = safeText(options?.section_title).toLowerCase();
    const domains = Array.from(
      new Set(
        (Array.isArray(options?.domains) ? options.domains : [])
          .map((value) => safeText(value).toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 16);
    const researchDomains = Array.from(
      new Set(
        (Array.isArray(options?.research_domains) ? options.research_domains : [])
          .map((value) => safeText(value).toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 12);
    const researchTitles = Array.from(
      new Set(
        (Array.isArray(options?.research_titles) ? options.research_titles : [])
          .map((value) => safeText(value).toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 8);
    const normalizedMode = safeText(options?.mode).toLowerCase() || "visual";
    const kindList =
      normalizedMode === "source"
        ? ["link", "note", "preview"]
        : normalizedMode === "visual"
          ? ["screenshot", "telegram_media", "downloaded_media", "preview"]
          : ["screenshot", "telegram_media", "downloaded_media", "preview", "link", "note"];
    const kindPlaceholders = kindList.map(() => "?").join(", ");
    const domainCase =
      domains.length > 0
        ? `CASE WHEN LOWER(COALESCE(a.source_domain, '')) IN (${domains.map(() => "?").join(", ")}) THEN 1 ELSE 0 END`
        : "0";
    const researchDomainCase =
      researchDomains.length > 0
        ? `CASE WHEN LOWER(COALESCE(a.source_domain, '')) IN (${researchDomains.map(() => "?").join(", ")}) THEN 1 ELSE 0 END`
        : "0";
    const researchTitleCase =
      researchTitles.length > 0
        ? `CASE WHEN LOWER(COALESCE(json_extract(a.raw_json, '$.title'), '')) IN (${researchTitles.map(() => "?").join(", ")}) THEN 1 ELSE 0 END`
        : "0";
    const values = [
      normalizedDocumentId,
      normalizedDocumentId,
      normalizedSectionTitle,
      normalizedSectionTitle,
      ...domains,
      ...researchDomains,
      ...researchTitles,
      ...kindList,
      normalizedReleaseId,
      normalizedLimit
    ];
    const rows = database
      .prepare(
        `
          SELECT
            a.id,
            CASE
              WHEN ? <> '' AND EXISTS (
                SELECT 1
                FROM attachments att_ctx
                WHERE att_ctx.asset_id = a.id
                  AND (
                    (att_ctx.target_type = 'document' AND att_ctx.target_id = ?)
                    OR att_ctx.target_type = 'segment'
                  )
              )
              THEN 1
              ELSE 0
            END AS same_doc_context,
            CASE
              WHEN ? <> ''
               AND LOWER(COALESCE(json_extract(a.raw_json, '$.meta_json.section_title'), '')) = ?
              THEN 1
              ELSE 0
            END AS same_section,
            ${domainCase} AS same_domain,
            ${researchDomainCase} AS same_research_domain,
            ${researchTitleCase} AS same_research_title,
            CASE
              WHEN LOWER(COALESCE(json_extract(a.raw_json, '$.processing_state'), '')) IN ('processed', 'attached')
              THEN 1
              ELSE 0
            END AS ready_state
          FROM assets a
          WHERE a.kind IN (${kindPlaceholders})
            AND LOWER(COALESCE(a.status, '')) NOT IN ('archived', 'failed')
            AND LOWER(COALESCE(json_extract(a.raw_json, '$.processing_state'), '')) != 'failed'
            AND NOT EXISTS (
              SELECT 1
              FROM attachments att_release
              WHERE att_release.asset_id = a.id
                AND att_release.target_type = 'release'
                AND att_release.target_id = ?
            )
          ORDER BY
            same_research_title DESC,
            same_research_domain DESC,
            same_section DESC,
            same_domain DESC,
            same_doc_context DESC,
            ready_state DESC,
            a.updated_at DESC
          LIMIT ?
        `
      )
      .all(...values);
    return rows
      .map((row) => buildAssetSummaryById(row?.id))
      .filter(Boolean);
  }

  function listAssets(filters = {}) {
    const database = ensureDatabase();
    const clauses = [];
    const values = {};
    if (safeText(filters.kind)) {
      clauses.push("a.kind = :kind");
      values.kind = safeText(filters.kind);
    }
    if (safeText(filters.status)) {
      clauses.push("a.status = :status");
      values.status = safeText(filters.status);
    }
    if (safeText(filters.processing_state)) {
      clauses.push("json_extract(a.raw_json, '$.processing_state') = :processing_state");
      values.processing_state = safeText(filters.processing_state);
    }
    if (String(filters.inbox_only) === "1") {
      clauses.push(`(
        (SELECT COUNT(*) FROM attachments att WHERE att.asset_id = a.id) = 0
        OR COALESCE(json_extract(a.raw_json, '$.processing_state'), '') LIKE 'pending%'
      )`);
    }
    if (safeText(filters.q)) {
      clauses.push(`(
        LOWER(COALESCE(json_extract(a.raw_json, '$.title'), '')) LIKE :q
        OR LOWER(COALESCE(json_extract(a.raw_json, '$.description'), '')) LIKE :q
        OR LOWER(COALESCE(a.source_url, '')) LIKE :q
        OR LOWER(COALESCE(json_extract(a.raw_json, '$.author'), '')) LIKE :q
        OR LOWER(COALESCE(json_extract(a.raw_json, '$.file_name'), '')) LIKE :q
      )`);
      values.q = `%${safeText(filters.q).toLowerCase()}%`;
    }
    if (safeText(filters.target_type) && safeText(filters.target_id)) {
      clauses.push(
        "EXISTS (SELECT 1 FROM attachments att_filter WHERE att_filter.asset_id = a.id AND att_filter.target_type = :target_type AND att_filter.target_id = :target_id)"
      );
      values.target_type = safeText(filters.target_type);
      values.target_id = safeText(filters.target_id);
    }
    const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Number(filters.limit)) : 100;
    values.limit = limit;
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = database
      .prepare(
        `
          SELECT
            a.raw_json AS asset_raw,
            (
              SELECT COUNT(*) FROM attachments att
              WHERE att.asset_id = a.id
            ) AS attachment_count
          FROM assets a
          ${whereSql}
          ORDER BY a.updated_at DESC
          LIMIT :limit
        `
      )
      .all(values);
    return rows.map((row) => {
      const asset = parseRawJson(row?.asset_raw);
      const targets = database
        .prepare(
          `
            SELECT raw_json
            FROM attachments
            WHERE asset_id = ?
            ORDER BY sort_order ASC, created_at ASC
            LIMIT 8
          `
        )
        .all(safeText(asset.id))
        .map((entry) => parseRawJson(entry?.raw_json))
        .map((item) => ({
          id: safeText(item.id),
          target_type: safeText(item.target_type),
          target_id: safeText(item.target_id),
          role: safeText(item.role),
          note: safeText(item.note)
        }));
      return {
        ...asset,
        attachment_count: Number(row?.attachment_count ?? 0),
        targets
      };
    });
  }

  function getOverview() {
    const database = ensureDatabase();
    const counts = {
      assets: Number(database.prepare("SELECT COUNT(*) AS count FROM assets").get()?.count ?? 0),
      attachments: Number(database.prepare("SELECT COUNT(*) AS count FROM attachments").get()?.count ?? 0),
      releases: Number(database.prepare("SELECT COUNT(*) AS count FROM releases").get()?.count ?? 0),
      bot_sessions: Number(database.prepare("SELECT COUNT(*) AS count FROM bot_sessions").get()?.count ?? 0),
      jobs: Number(database.prepare("SELECT COUNT(*) AS count FROM jobs").get()?.count ?? 0),
      activities: Number(database.prepare("SELECT COUNT(*) AS count FROM activities").get()?.count ?? 0),
      inbox_assets: Number(
        database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM assets a
              WHERE
                (SELECT COUNT(*) FROM attachments att WHERE att.asset_id = a.id) = 0
                OR COALESCE(json_extract(a.raw_json, '$.processing_state'), '') LIKE 'pending%'
            `
          )
          .get()?.count ?? 0
      )
    };
    return {
      data_dir: integrationDir,
      counts
    };
  }

  function buildAssetSummaryById(assetId) {
    const database = ensureDatabase();
    const row = database.prepare("SELECT raw_json FROM assets WHERE id = ?").get(safeText(assetId));
    const asset = parseRawJson(row?.raw_json);
    if (!asset?.id) return null;
    const attachmentCount = Number(
      database.prepare("SELECT COUNT(*) AS count FROM attachments WHERE asset_id = ?").get(safeText(asset.id))?.count ?? 0
    );
    const targets = database
      .prepare(
        `
          SELECT raw_json
          FROM attachments
          WHERE asset_id = ?
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 8
        `
      )
      .all(safeText(asset.id))
      .map((entry) => parseRawJson(entry?.raw_json))
      .map((item) => ({
        id: safeText(item.id),
        target_type: safeText(item.target_type),
        target_id: safeText(item.target_id),
        role: safeText(item.role),
        note: safeText(item.note)
      }));
    return {
      ...asset,
      attachment_count: attachmentCount,
      targets
    };
  }

  function getAsset(assetId) {
    const database = ensureDatabase();
    const asset = buildAssetSummaryById(assetId);
    if (!asset?.id) return null;
    const attachments = database
      .prepare(
        `
          SELECT raw_json
          FROM attachments
          WHERE asset_id = ?
          ORDER BY sort_order ASC, created_at ASC
        `
      )
      .all(safeText(assetId))
      .map((row) => parseRawJson(row?.raw_json));
    return {
      ...asset,
      attachments
    };
  }

  function listReleases(filters = {}) {
    const database = ensureDatabase();
    const clauses = [];
    const values = {};
    if (safeText(filters.status)) {
      clauses.push("status = :status");
      values.status = safeText(filters.status);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = database
      .prepare(
        `
          SELECT
            r.raw_json AS release_raw,
            (
              SELECT COUNT(*) FROM attachments att
              WHERE att.target_type = 'release' AND att.target_id = r.id
            ) AS asset_count
          FROM releases r
          ${whereSql}
          ORDER BY r.updated_at DESC
        `
      )
      .all(values);
    return rows.map((row) => ({
      ...parseRawJson(row?.release_raw),
      asset_count: Number(row?.asset_count ?? 0)
    }));
  }

  function getRelease(releaseId) {
    const database = ensureDatabase();
    const releaseRow = database.prepare("SELECT raw_json FROM releases WHERE id = ?").get(safeText(releaseId));
    const release = parseRawJson(releaseRow?.raw_json);
    if (!release?.id) return null;
    const attachmentRows = database
      .prepare(
        `
          SELECT raw_json
          FROM attachments
          WHERE target_type = 'release' AND target_id = ?
          ORDER BY sort_order ASC, created_at ASC
        `
      )
      .all(safeText(releaseId))
      .map((row) => parseRawJson(row?.raw_json));
    return {
      ...release,
      asset_count: attachmentRows.length,
      assets: attachmentRows
        .map((attachment) => {
          const asset = buildAssetSummaryById(attachment?.asset_id);
          if (!asset) return null;
          return {
            attachment,
            asset
          };
        })
        .filter(Boolean)
    };
  }

  function summarizeReleaseAssistant(releaseId) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    if (!normalizedReleaseId) return null;
    const row = database
      .prepare(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN LOWER(COALESCE(att.item_status, json_extract(att.raw_json, '$.item_status'), 'planned')) IN ('ready', 'done') THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN LOWER(COALESCE(att.item_status, json_extract(att.raw_json, '$.item_status'), 'planned')) NOT IN ('ready', 'done', 'skipped') THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN TRIM(COALESCE(json_extract(att.raw_json, '$.script_note'), '')) = '' THEN 1 ELSE 0 END) AS missing_script,
            SUM(CASE WHEN TRIM(COALESCE(json_extract(att.raw_json, '$.visual_note'), '')) = '' THEN 1 ELSE 0 END) AS missing_visual,
            SUM(CASE WHEN TRIM(COALESCE(a.source_url, '')) = '' THEN 1 ELSE 0 END) AS needs_link,
            SUM(CASE WHEN LOWER(COALESCE(a.kind, '')) = 'screenshot' THEN 1 ELSE 0 END) AS screenshots
          FROM attachments att
          JOIN assets a ON a.id = att.asset_id
          WHERE att.target_type = 'release'
            AND att.target_id = ?
        `
      )
      .get(normalizedReleaseId);
    return {
      total: Number(row?.total ?? 0),
      ready: Number(row?.ready ?? 0),
      in_progress: Number(row?.in_progress ?? 0),
      missing_script: Number(row?.missing_script ?? 0),
      missing_visual: Number(row?.missing_visual ?? 0),
      needs_link: Number(row?.needs_link ?? 0),
      screenshots: Number(row?.screenshots ?? 0),
      orphan_screenshots: 0,
      segments_without_visual: 0
    };
  }

  function listReleaseItemsByGap(releaseId, gap = "missing_visual", limit = 20) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    if (!normalizedReleaseId) return [];
    const normalizedLimit = Math.max(1, Number(limit) || 20);
    const normalizedGap = safeText(gap).toLowerCase();
    const gapCondition =
      normalizedGap === "missing_script"
        ? "TRIM(COALESCE(json_extract(att.raw_json, '$.script_note'), '')) = ''"
        : normalizedGap === "needs_link"
          ? "TRIM(COALESCE(a.source_url, '')) = ''"
          : "TRIM(COALESCE(json_extract(att.raw_json, '$.visual_note'), '')) = ''";
    return database
      .prepare(
        `
          SELECT
            att.raw_json AS attachment_raw,
            a.raw_json AS asset_raw
          FROM attachments att
          JOIN assets a ON a.id = att.asset_id
          WHERE att.target_type = 'release'
            AND att.target_id = ?
            AND ${gapCondition}
          ORDER BY att.sort_order ASC, att.created_at ASC
          LIMIT ?
        `
      )
      .all(normalizedReleaseId, normalizedLimit)
      .map((row) => {
        const attachment = parseRawJson(row?.attachment_raw);
        const asset = parseRawJson(row?.asset_raw);
        return {
          attachment_id: safeText(attachment?.id),
          asset_id: safeText(asset?.id),
          title: safeText(asset?.title || asset?.file_name || asset?.id),
          section_title: safeText(asset?.meta_json?.section_title),
          item_status: safeText(attachment?.item_status || "planned"),
          source_url: safeText(asset?.source_url),
          source_domain: safeText(asset?.source_domain)
        };
      })
      .filter((item) => Boolean(item.attachment_id && item.asset_id));
  }

  function listReleaseActivities(releaseId, limit = 80) {
    const database = ensureDatabase();
    const normalizedReleaseId = safeText(releaseId);
    if (!normalizedReleaseId) return [];
    const normalizedLimit = Math.max(1, Number(limit) || 80);
    return database
      .prepare(
        `
          SELECT raw_json
          FROM activities
          WHERE release_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(normalizedReleaseId, normalizedLimit)
      .map((row) => parseRawJson(row?.raw_json));
  }

  function listBotSessions(filters = {}) {
    const database = ensureDatabase();
    const clauses = [];
    const values = {};
    if (safeText(filters.chat_id)) {
      clauses.push("chat_id = :chat_id");
      values.chat_id = safeText(filters.chat_id);
    }
    if (safeText(filters.user_id)) {
      clauses.push("user_id = :user_id");
      values.user_id = safeText(filters.user_id);
    }
    if (safeText(filters.mode)) {
      clauses.push("mode = :mode");
      values.mode = safeText(filters.mode);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return database
      .prepare(
        `
          SELECT raw_json
          FROM bot_sessions
          ${whereSql}
          ORDER BY updated_at DESC
        `
      )
      .all(values)
      .map((row) => parseRawJson(row?.raw_json));
  }

  function listJobs(filters = {}) {
    const database = ensureDatabase();
    const clauses = [];
    const values = {};
    if (safeText(filters.status)) {
      clauses.push("status = :status");
      values.status = safeText(filters.status);
    }
    if (safeText(filters.kind)) {
      clauses.push("kind = :kind");
      values.kind = safeText(filters.kind);
    }
    if (safeText(filters.asset_id)) {
      clauses.push("asset_id = :asset_id");
      values.asset_id = safeText(filters.asset_id);
    }
    const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Number(filters.limit)) : 100;
    values.limit = limit;
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return database
      .prepare(
        `
          SELECT raw_json
          FROM jobs
          ${whereSql}
          ORDER BY updated_at DESC
          LIMIT :limit
        `
      )
      .all(values)
      .map((row) => parseRawJson(row?.raw_json));
  }

  function close() {
    if (!db) return;
    db.close();
    db = null;
  }

  return {
    ensureDatabase,
    syncCollections,
    syncAssistantMemory,
    syncResearchRuns,
    syncDocumentState,
    syncDocumentContext,
    syncDocumentMediaDownloads,
    checkpoint,
    getStatus,
    listAssets,
    getAsset,
    listReleases,
    getRelease,
    summarizeReleaseAssistant,
    listReleaseItemsByGap,
    listReleaseActivities,
    listBotSessions,
    listJobs,
    getSourceProfiles,
    getSourceMemory,
    getReleaseOutcomeMemory,
    getDocumentState,
    summarizeDocumentState,
    summarizeSourceMemory,
    summarizeReleaseOutcomeMemory,
    listResearchRuns,
    listRunsForSegment,
    getLatestResearchRun,
    getResearchRunById,
    listDocSegments,
    listDocDecisions,
    getDocumentMediaDownloads,
    listDocSegmentsWithoutVisual,
    listOrphanScreenshotsForRelease,
    listRecommendationCandidatesForRelease,
    listRecommendationCandidatesForItem,
    getOverview,
    close,
    dbPath
  };
}
