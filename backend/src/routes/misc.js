export function registerMiscRoutes(app, deps) {
  const {
    appendUiActionsAudit,
    config,
    fetchLinkPreview,
    finishNotionProgress,
    getNotionProgress,
    imageProxyMaxBytes,
    initNotionProgress,
    isHttpUrl,
    isNotionUrl,
    normalizeLinkUrl,
    normalizeNotionUrl,
    pruneNotionProgressStore,
    pushNotionProgress,
    scrapeNotionPage,
    translateHeadingToEnglishQuery
  } = deps;

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    res.json(config);
  });

  app.post("/api/audit/ui-actions", async (req, res) => {
    try {
      if (typeof appendUiActionsAudit !== "function") {
        return res.status(503).json({ error: "UI audit disabled" });
      }
      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
      const source = String(req.body?.source ?? "frontend");
      const userAgent = String(req.headers["user-agent"] ?? "");
      const forwarded = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
      const ip = forwarded || String(req.socket?.remoteAddress ?? "");
      const result = await appendUiActionsAudit(actions, { source, userAgent, ip });
      return res.json({ ok: true, accepted: Number(result?.accepted ?? 0) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/search/translate", async (req, res) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }
      const translated = await translateHeadingToEnglishQuery(text);
      return res.json({ text: translated || text });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/notion/raw", async (req, res) => {
    try {
      const rawUrl = String(req.body?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeNotionUrl(rawUrl);
      if (!isNotionUrl(url)) {
        return res.status(400).json({ error: "Notion URL is required" });
      }

      const progressId = String(req.body?.progress_id ?? "").trim();
      if (progressId) {
        initNotionProgress(progressId);
      }

      const content = await scrapeNotionPage(url, (message) => {
        if (!progressId) return;
        pushNotionProgress(progressId, message);
      });

      if (progressId) {
        finishNotionProgress(progressId);
      }

      res.json({ url, content, progress_id: progressId || null });
    } catch (error) {
      const progressId = String(req.body?.progress_id ?? "").trim();
      if (progressId) {
        pushNotionProgress(progressId, `ERROR ${error.message}`);
        finishNotionProgress(progressId);
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/notion/progress/:progressId", (req, res) => {
    const progressId = String(req.params?.progressId ?? "").trim();
    if (!progressId) {
      return res.status(400).json({ error: "progressId is required" });
    }
    pruneNotionProgressStore();
    const snapshot = getNotionProgress(progressId);
    if (!snapshot) {
      return res.status(404).json({ error: "Progress session not found" });
    }
    return res.json(snapshot);
  });

  app.get("/api/link/preview", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(url)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const preview = await fetchLinkPreview(url);
      res.json(preview);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/link/image", async (req, res) => {
    try {
      const rawUrl = String(req.query?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }
      const url = normalizeLinkUrl(rawUrl);
      if (!isHttpUrl(url)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const referer = (() => {
          try {
            return new URL(url).origin + "/";
          } catch {
            return undefined;
          }
        })();
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            ...(referer ? { referer } : {})
          }
        });

        if (!response.ok) {
          return res.status(502).json({ error: "image fetch failed" });
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          return res.status(415).json({ error: "not an image" });
        }
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength && contentLength > imageProxyMaxBytes) {
          return res.status(413).json({ error: "image too large" });
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > imageProxyMaxBytes) {
          return res.status(413).json({ error: "image too large" });
        }

        res.setHeader("content-type", contentType);
        res.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
        return res.send(buffer);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
}
