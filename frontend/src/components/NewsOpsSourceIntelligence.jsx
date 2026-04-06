import React from "react";

function parseProfileMap(value) {
  try {
    const parsed = JSON.parse(String(value ?? "{}") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: {}, error: "JSON must be an object map." };
    }
    return { value: parsed, error: "" };
  } catch (error) {
    return { value: {}, error: error?.message ?? "Invalid JSON" };
  }
}

function sortMapEntries(map = {}) {
  return Object.entries(map).sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function stringifyMap(map = {}) {
  return JSON.stringify(map, null, 2);
}

function boolValue(value) {
  return Boolean(value);
}

function stringValue(value) {
  return String(value ?? "");
}

function numberValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatScreenshotProfiles(value) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const width = Number(item?.width ?? 0);
      const height = Number(item?.height ?? 0);
      const zoom = Number(item?.zoom ?? 0);
      if (!width || !height || !zoom) return "";
      return `${width}x${height}@${zoom}`;
    })
    .filter(Boolean)
    .join("\n");
}

function parseScreenshotProfiles(value) {
  return String(value ?? "")
    .split(/\r?\n|,|;/)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(\d{3,4})\s*x\s*(\d{3,4})\s*@\s*(\d{2,3})$/i);
      if (!match) return null;
      return {
        width: Number(match[1]),
        height: Number(match[2]),
        zoom: Number(match[3])
      };
    })
    .filter(Boolean);
}

export function NewsOpsSourceIntelligence({
  sourceProfilesDirty,
  sourceProfilesDraft,
  updateSourceProfilesDraftField,
  sourceProfilesSaving,
  handleResetSourceProfilesDraft,
  handleSaveSourceProfiles,
  sourceMemorySummary,
  releaseOutcomeMemorySummary,
  formatDateTimeShort
}) {
  const [showAdvancedJson, setShowAdvancedJson] = React.useState(false);
  const domainProfilesState = React.useMemo(
    () => parseProfileMap(sourceProfilesDraft.domain_profiles_json),
    [sourceProfilesDraft.domain_profiles_json]
  );
  const channelProfilesState = React.useMemo(
    () => parseProfileMap(sourceProfilesDraft.channel_profiles_json),
    [sourceProfilesDraft.channel_profiles_json]
  );
  const domainEntries = React.useMemo(
    () => sortMapEntries(domainProfilesState.value),
    [domainProfilesState.value]
  );
  const channelEntries = React.useMemo(
    () => sortMapEntries(channelProfilesState.value),
    [channelProfilesState.value]
  );

  const updateDomainProfiles = React.useCallback(
    (updater) => {
      const nextMap = updater({ ...(domainProfilesState.value ?? {}) });
      updateSourceProfilesDraftField("domain_profiles_json", stringifyMap(nextMap));
    },
    [domainProfilesState.value, updateSourceProfilesDraftField]
  );

  const updateChannelProfiles = React.useCallback(
    (updater) => {
      const nextMap = updater({ ...(channelProfilesState.value ?? {}) });
      updateSourceProfilesDraftField("channel_profiles_json", stringifyMap(nextMap));
    },
    [channelProfilesState.value, updateSourceProfilesDraftField]
  );

  const handleDomainFieldChange = React.useCallback(
    (domainKey, field, value) => {
      updateDomainProfiles((current) => ({
        ...current,
        [domainKey]: {
          ...(current[domainKey] ?? {}),
          [field]: value
        }
      }));
    },
    [updateDomainProfiles]
  );

  const handleChannelFieldChange = React.useCallback(
    (channelKey, field, value) => {
      updateChannelProfiles((current) => ({
        ...current,
        [channelKey]: {
          ...(current[channelKey] ?? {}),
          [field]: value
        }
      }));
    },
    [updateChannelProfiles]
  );

  const handleRenameDomain = React.useCallback(
    (currentKey, nextKey) => {
      const normalizedNextKey = String(nextKey ?? "").trim().toLowerCase();
      if (!normalizedNextKey || normalizedNextKey === currentKey) return;
      updateDomainProfiles((current) => {
        const next = { ...current };
        const currentProfile = next[currentKey] ?? {};
        delete next[currentKey];
        next[normalizedNextKey] = currentProfile;
        return next;
      });
    },
    [updateDomainProfiles]
  );

  const handleRenameChannel = React.useCallback(
    (currentKey, nextKey) => {
      const normalizedNextKey = String(nextKey ?? "").trim();
      if (!normalizedNextKey || normalizedNextKey === currentKey) return;
      updateChannelProfiles((current) => {
        const next = { ...current };
        const currentProfile = next[currentKey] ?? {};
        delete next[currentKey];
        next[normalizedNextKey] = currentProfile;
        return next;
      });
    },
    [updateChannelProfiles]
  );

  const handleAddDomainProfile = React.useCallback(() => {
    updateDomainProfiles((current) => {
      let nextKey = "new-domain.com";
      let suffix = 1;
      while (Object.prototype.hasOwnProperty.call(current, nextKey)) {
        suffix += 1;
        nextKey = `new-domain-${suffix}.com`;
      }
      return {
        ...current,
        [nextKey]: {
          language: "",
          responsive_design: false,
          blocked_in_rf: false,
          trusted: false,
          blocked: false,
          downloadable: false,
          screenshot_friendly: false,
          default_video_quality: "",
          watermarks: false,
          notes: "",
          screenshot_profiles: [],
          source_bias: 0,
          visual_bias: 0,
          downloadability_bias: 0
        }
      };
    });
  }, [updateDomainProfiles]);

  const handleAddChannelProfile = React.useCallback(() => {
    updateChannelProfiles((current) => {
      let nextKey = "@newchannel";
      let suffix = 1;
      while (Object.prototype.hasOwnProperty.call(current, nextKey)) {
        suffix += 1;
        nextKey = `@newchannel${suffix}`;
      }
      return {
        ...current,
        [nextKey]: {
          platform: "youtube",
          channel_url: "",
          language: "",
          watermarks: false,
          published_quality: "",
          notes: "",
          screenshot_profiles: []
        }
      };
    });
  }, [updateChannelProfiles]);

  const handleDeleteDomainProfile = React.useCallback(
    (domainKey) => {
      updateDomainProfiles((current) => {
        const next = { ...current };
        delete next[domainKey];
        return next;
      });
    },
    [updateDomainProfiles]
  );

  const handleDeleteChannelProfile = React.useCallback(
    (channelKey) => {
      updateChannelProfiles((current) => {
        const next = { ...current };
        delete next[channelKey];
        return next;
      });
    },
    [updateChannelProfiles]
  );

  return (
    <>
      <div className="integration-card source-profiles-card">
        <div className="integration-card-head">
          <strong>Source Registry</strong>
          <span>{sourceProfilesDirty ? "draft" : "saved"}</span>
        </div>
        <div className="source-profiles-grid">
          <label className="source-profiles-field">
            <span>Trusted Domains</span>
            <textarea
              value={sourceProfilesDraft.trusted_domains}
              onChange={(event) => updateSourceProfilesDraftField("trusted_domains", event.target.value)}
              placeholder={"reuters.com\napnews.com"}
            />
          </label>
          <label className="source-profiles-field">
            <span>Blocked Domains</span>
            <textarea
              value={sourceProfilesDraft.blocked_domains}
              onChange={(event) => updateSourceProfilesDraftField("blocked_domains", event.target.value)}
              placeholder={"pinterest.com\nquora.com"}
            />
          </label>
          <label className="source-profiles-field">
            <span>Video Platforms</span>
            <textarea
              value={sourceProfilesDraft.video_platform_domains}
              onChange={(event) => updateSourceProfilesDraftField("video_platform_domains", event.target.value)}
              placeholder={"youtube.com\nvimeo.com"}
            />
          </label>
          <label className="source-profiles-field">
            <span>Social Platforms</span>
            <textarea
              value={sourceProfilesDraft.social_domains}
              onChange={(event) => updateSourceProfilesDraftField("social_domains", event.target.value)}
              placeholder={"x.com\nreddit.com"}
            />
          </label>
          <label className="source-profiles-field">
            <span>Downloadable Domains</span>
            <textarea
              value={sourceProfilesDraft.downloadable_domains}
              onChange={(event) => updateSourceProfilesDraftField("downloadable_domains", event.target.value)}
              placeholder={"youtube.com\nvk.com"}
            />
          </label>
          <label className="source-profiles-field">
            <span>Screenshot Friendly</span>
            <textarea
              value={sourceProfilesDraft.screenshot_friendly_domains}
              onChange={(event) => updateSourceProfilesDraftField("screenshot_friendly_domains", event.target.value)}
              placeholder={"x.com\nt.me"}
            />
          </label>
        </div>

        <div className="source-registry-section">
          <div className="integration-card-head">
            <strong>Domain Profiles</strong>
            <button className="btn ghost small" type="button" onClick={handleAddDomainProfile}>
              Add Domain
            </button>
          </div>
          {domainProfilesState.error ? (
            <div className="muted source-profiles-hint">Fix `Domain Profiles JSON`: {domainProfilesState.error}</div>
          ) : (
            <div className="source-registry-list">
              {domainEntries.map(([domainKey, profile]) => (
                <div key={`domain-profile-${domainKey}`} className="source-registry-card">
                  <div className="source-registry-card-head">
                    <input
                      value={domainKey}
                      onChange={(event) => handleRenameDomain(domainKey, event.target.value)}
                    />
                    <button className="btn ghost small" type="button" onClick={() => handleDeleteDomainProfile(domainKey)}>
                      Remove
                    </button>
                  </div>
                  <div className="source-registry-grid">
                    <label className="source-registry-field">
                      <span>Language</span>
                      <input
                        value={stringValue(profile.language)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "language", event.target.value)}
                        placeholder="en / ru / ar"
                      />
                    </label>
                    <label className="source-registry-field">
                      <span>Default Quality</span>
                      <input
                        value={stringValue(profile.default_video_quality)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "default_video_quality", event.target.value)}
                        placeholder="1080p"
                      />
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.responsive_design)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "responsive_design", event.target.checked)}
                      />
                      <span>Responsive Design</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.blocked_in_rf)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "blocked_in_rf", event.target.checked)}
                      />
                      <span>Blocked In RF</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.trusted)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "trusted", event.target.checked)}
                      />
                      <span>Trusted</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.blocked)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "blocked", event.target.checked)}
                      />
                      <span>Blocked</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.downloadable)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "downloadable", event.target.checked)}
                      />
                      <span>Downloadable</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.screenshot_friendly)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "screenshot_friendly", event.target.checked)}
                      />
                      <span>Screenshot Friendly</span>
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.watermarks)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "watermarks", event.target.checked)}
                      />
                      <span>Watermarks</span>
                    </label>
                    <label className="source-registry-field">
                      <span>Source Bias</span>
                      <input
                        type="number"
                        step="0.01"
                        value={numberValue(profile.source_bias)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "source_bias", Number(event.target.value))}
                      />
                    </label>
                    <label className="source-registry-field">
                      <span>Visual Bias</span>
                      <input
                        type="number"
                        step="0.01"
                        value={numberValue(profile.visual_bias)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "visual_bias", Number(event.target.value))}
                      />
                    </label>
                    <label className="source-registry-field">
                      <span>Download Bias</span>
                      <input
                        type="number"
                        step="0.01"
                        value={numberValue(profile.downloadability_bias)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "downloadability_bias", Number(event.target.value))}
                      />
                    </label>
                    <label className="source-registry-field source-registry-field-wide">
                      <span>Screenshot Profiles</span>
                      <textarea
                        value={formatScreenshotProfiles(profile.screenshot_profiles)}
                        onChange={(event) =>
                          handleDomainFieldChange(domainKey, "screenshot_profiles", parseScreenshotProfiles(event.target.value))
                        }
                        placeholder={"2560x1280@400\n1920x1080@300"}
                      />
                    </label>
                    <label className="source-registry-field source-registry-field-wide">
                      <span>Notes</span>
                      <textarea
                        value={stringValue(profile.notes)}
                        onChange={(event) => handleDomainFieldChange(domainKey, "notes", event.target.value)}
                        placeholder="Responsive? blocked in RF? editorial notes?"
                      />
                    </label>
                  </div>
                </div>
              ))}
              {domainEntries.length === 0 ? (
                <div className="muted">No domain profiles yet. Add one above.</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="source-registry-section">
          <div className="integration-card-head">
            <strong>Channel Profiles</strong>
            <button className="btn ghost small" type="button" onClick={handleAddChannelProfile}>
              Add Channel
            </button>
          </div>
          {channelProfilesState.error ? (
            <div className="muted source-profiles-hint">Fix `Channel Profiles JSON`: {channelProfilesState.error}</div>
          ) : (
            <div className="source-registry-list">
              {channelEntries.map(([channelKey, profile]) => (
                <div key={`channel-profile-${channelKey}`} className="source-registry-card">
                  <div className="source-registry-card-head">
                    <input
                      value={channelKey}
                      onChange={(event) => handleRenameChannel(channelKey, event.target.value)}
                    />
                    <button className="btn ghost small" type="button" onClick={() => handleDeleteChannelProfile(channelKey)}>
                      Remove
                    </button>
                  </div>
                  <div className="source-registry-grid">
                    <label className="source-registry-field">
                      <span>Platform</span>
                      <input
                        value={stringValue(profile.platform)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "platform", event.target.value)}
                        placeholder="youtube / telegram / x"
                      />
                    </label>
                    <label className="source-registry-field">
                      <span>Language</span>
                      <input
                        value={stringValue(profile.language)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "language", event.target.value)}
                        placeholder="en / ru"
                      />
                    </label>
                    <label className="source-registry-field">
                      <span>Published Quality</span>
                      <input
                        value={stringValue(profile.published_quality)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "published_quality", event.target.value)}
                        placeholder="1080p"
                      />
                    </label>
                    <label className="source-registry-toggle">
                      <input
                        type="checkbox"
                        checked={boolValue(profile.watermarks)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "watermarks", event.target.checked)}
                      />
                      <span>Watermarks</span>
                    </label>
                    <label className="source-registry-field source-registry-field-wide">
                      <span>Channel URL</span>
                      <input
                        value={stringValue(profile.channel_url)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "channel_url", event.target.value)}
                        placeholder="https://www.youtube.com/@Channel"
                      />
                    </label>
                    <label className="source-registry-field source-registry-field-wide">
                      <span>Screenshot Profiles</span>
                      <textarea
                        value={formatScreenshotProfiles(profile.screenshot_profiles)}
                        onChange={(event) =>
                          handleChannelFieldChange(channelKey, "screenshot_profiles", parseScreenshotProfiles(event.target.value))
                        }
                        placeholder={"2560x1280@400\n1920x1080@300"}
                      />
                    </label>
                    <label className="source-registry-field source-registry-field-wide">
                      <span>Notes</span>
                      <textarea
                        value={stringValue(profile.notes)}
                        onChange={(event) => handleChannelFieldChange(channelKey, "notes", event.target.value)}
                        placeholder="Watermarks, publishing quirks, editorial notes"
                      />
                    </label>
                  </div>
                </div>
              ))}
              {channelEntries.length === 0 ? (
                <div className="muted">No channel profiles yet. Add one above.</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="source-profiles-actions">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => setShowAdvancedJson((prev) => !prev)}
          >
            {showAdvancedJson ? "Hide Advanced JSON" : "Show Advanced JSON"}
          </button>
          <button
            className="btn ghost small"
            type="button"
            onClick={handleResetSourceProfilesDraft}
            disabled={sourceProfilesSaving || !sourceProfilesDirty}
          >
            Reset
          </button>
          <button
            className="btn small"
            type="button"
            onClick={handleSaveSourceProfiles}
            disabled={sourceProfilesSaving}
          >
            {sourceProfilesSaving ? "Saving..." : "Save Profiles"}
          </button>
        </div>

        {showAdvancedJson ? (
          <div className="source-registry-advanced">
            <label className="source-profiles-field source-profiles-field-wide">
              <span>Domain Profiles JSON</span>
              <textarea
                value={sourceProfilesDraft.domain_profiles_json}
                onChange={(event) => updateSourceProfilesDraftField("domain_profiles_json", event.target.value)}
              />
            </label>
            <label className="source-profiles-field source-profiles-field-wide">
              <span>Channel Profiles JSON</span>
              <textarea
                value={sourceProfilesDraft.channel_profiles_json}
                onChange={(event) => updateSourceProfilesDraftField("channel_profiles_json", event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <div className="muted source-profiles-hint">
          Источник правды: <code>data/source-profiles.json</code>. Здесь можно держать и домены новостных сайтов, и отдельные channel / handle профили.
        </div>
      </div>

      <div className="integration-card">
        <div className="integration-card-head">
          <strong>Source Memory</strong>
          <span>{`${sourceMemorySummary?.total_domains ?? 0} domains`}</span>
        </div>
        {sourceMemorySummary?.top_domains?.length ? (
          <div className="integration-list">
            <div className="muted source-memory-summary-line">
              {`URLs ${sourceMemorySummary?.total_urls ?? 0} · patterns ${sourceMemorySummary?.total_patterns ?? 0}`}
            </div>
            {sourceMemorySummary.top_domains.map((item) => (
              <div key={`source-memory-${item.domain}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{item.domain}</strong>
                  <span>
                    used {Number(item.applied_count ?? 0)}
                    {Number(item.helpful_count ?? 0) ? ` · helpful ${Number(item.helpful_count)}` : ""}
                    {Number(item.source_count ?? 0) ? ` · source ${Number(item.source_count)}` : ""}
                    {Number(item.download_count ?? 0) ? ` · dl ${Number(item.download_count)}` : ""}
                    {Number(item.screenshot_count ?? 0) ? ` · shot ${Number(item.screenshot_count)}` : ""}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{formatDateTimeShort(item.last_used_at)}</span>
                  <code>{item.last_url || item.last_title || item.domain}</code>
                </div>
              </div>
            ))}
            {sourceMemorySummary?.recent?.length ? (
              <div className="muted source-memory-recent">
                Recent:{" "}
                {sourceMemorySummary.recent
                  .slice(0, 4)
                  .map((item) => `${item.domain} (${item.action})`)
                  .join(" · ")}
              </div>
            ) : null}
            {sourceMemorySummary?.top_patterns?.length ? (
              <div className="muted source-memory-recent">
                Similarity memory:{" "}
                {sourceMemorySummary.top_patterns
                  .slice(0, 3)
                  .map((item) => `${item.section_title || item.segment_key} (${item.count})`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted">
            Память источников пока пустая. Она заполняется, когда ты применяешь research results или помечаешь кандидата как Helpful.
          </div>
        )}
      </div>

      <div className="integration-card">
        <div className="integration-card-head">
          <strong>Release Outcome Memory</strong>
          <span>{`${releaseOutcomeMemorySummary?.total_domains ?? 0} domains`}</span>
        </div>
        {releaseOutcomeMemorySummary?.top_domains?.length ? (
          <div className="integration-list">
            <div className="muted source-memory-summary-line">
              {`Kinds ${releaseOutcomeMemorySummary?.total_kinds ?? 0} · roles ${releaseOutcomeMemorySummary?.total_roles ?? 0}`}
            </div>
            {releaseOutcomeMemorySummary.top_domains.map((item) => (
              <div key={`release-outcome-domain-${item.key}`} className="integration-row">
                <div className="integration-row-main">
                  <strong>{item.key}</strong>
                  <span>
                    used {Number(item.used_count ?? 0)}
                    {Number(item.attach_count ?? 0) ? ` · attach ${Number(item.attach_count)}` : ""}
                    {Number(item.prepare_count ?? 0) ? ` · prepare ${Number(item.prepare_count)}` : ""}
                    {Number(item.fill_count ?? 0) ? ` · fill ${Number(item.fill_count)}` : ""}
                  </span>
                </div>
                <div className="integration-row-side">
                  <span>{formatDateTimeShort(item.last_used_at)}</span>
                  <code>{item.key}</code>
                </div>
              </div>
            ))}
            {releaseOutcomeMemorySummary?.top_kinds?.length ? (
              <div className="muted source-memory-recent">
                Kinds:{" "}
                {releaseOutcomeMemorySummary.top_kinds
                  .slice(0, 4)
                  .map((item) => `${item.key} (${item.used_count})`)
                  .join(" · ")}
              </div>
            ) : null}
            {releaseOutcomeMemorySummary?.top_roles?.length ? (
              <div className="muted source-memory-recent">
                Roles:{" "}
                {releaseOutcomeMemorySummary.top_roles
                  .slice(0, 4)
                  .map((item) => `${item.key} (${item.used_count})`)
                  .join(" · ")}
              </div>
            ) : null}
            {releaseOutcomeMemorySummary?.recent?.length ? (
              <div className="muted source-memory-recent">
                Recent:{" "}
                {releaseOutcomeMemorySummary.recent
                  .slice(0, 4)
                  .map((item) => `${item.domain || item.kind || item.asset_id} (${item.action})`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted">
            Память выпусков пока пустая. Она заполняется, когда assistant реально что-то прикрепляет или подготавливает.
          </div>
        )}
      </div>
    </>
  );
}
