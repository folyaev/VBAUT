import React from "react";

export function SegmentLinkedReleasePanel({
  segmentId,
  linkedReleaseInfo,
  linkedReleaseSnapshot,
  getCurrentPairBadgeClassName,
  onOpenLinkedRelease,
  onOpenLinkedReleaseHandoff,
  onUseLinkedReleasePrimary,
  onPromoteLinkedReleasePrimaryPair,
  onPromoteLinkedReleaseBackupPair,
  onUseLinkedReleaseBackup
}) {
  if (!linkedReleaseInfo && !linkedReleaseSnapshot) return null;

  return (
    <>
      {linkedReleaseInfo ? (
        <div className="segment-research-linked-release">
          <strong>{`Linked Release: ${linkedReleaseInfo.title || linkedReleaseInfo.id}`}</strong>
          <span>
            {linkedReleaseInfo.status || "draft"}
            {linkedReleaseInfo.air_date ? ` · ${linkedReleaseInfo.air_date}` : ""}
          </span>
          <button className="btn ghost small" type="button" onClick={() => onOpenLinkedRelease?.(segmentId)}>
            Open Release
          </button>
        </div>
      ) : null}
      {linkedReleaseSnapshot ? (
        <div className="segment-research-linked-release segment-research-linked-release-snapshot">
          <strong>{`Release Item: ${linkedReleaseSnapshot.item_status_label}`}</strong>
          <span>
            {`Script ${linkedReleaseSnapshot.has_script ? "ready" : "missing"} · Visual ${
              linkedReleaseSnapshot.has_visual ? "ready" : "missing"
            }`}
          </span>
          {linkedReleaseSnapshot.handoff_state_label ? (
            <span>{`Handoff ${linkedReleaseSnapshot.handoff_state_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.handoff_basis_label ? (
            <span>{`Basis ${linkedReleaseSnapshot.handoff_basis_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.last_handoff_event_label ? (
            <span>
              {`${linkedReleaseSnapshot.last_handoff_event_label}${
                linkedReleaseSnapshot.last_handoff_event_relative
                  ? ` · ${linkedReleaseSnapshot.last_handoff_event_relative}`
                  : ""
              }${linkedReleaseSnapshot.last_handoff_event_at ? ` · ${linkedReleaseSnapshot.last_handoff_event_at}` : ""}`}
            </span>
          ) : null}
          {Array.isArray(linkedReleaseSnapshot.trace_badges) && linkedReleaseSnapshot.trace_badges.length > 0 ? (
            <span>{`Trace ${linkedReleaseSnapshot.trace_badges.join(" · ")}`}</span>
          ) : null}
          {linkedReleaseSnapshot.last_pair_switch_label ? (
            <span>
              {`${linkedReleaseSnapshot.last_pair_switch_label}${
                linkedReleaseSnapshot.last_pair_switch_relative ? ` · ${linkedReleaseSnapshot.last_pair_switch_relative}` : ""
              }${linkedReleaseSnapshot.last_pair_switch_at ? ` · ${linkedReleaseSnapshot.last_pair_switch_at}` : ""}`}
            </span>
          ) : null}
          {linkedReleaseSnapshot.current_source_label ? (
            <span>
              {`Current Source ${linkedReleaseSnapshot.current_source_label}${
                linkedReleaseSnapshot.current_source_basis_label ? ` · ${linkedReleaseSnapshot.current_source_basis_label}` : ""
              }`}
            </span>
          ) : null}
          {linkedReleaseSnapshot.current_visual_label ? (
            <span>
              {`Current Visual ${linkedReleaseSnapshot.current_visual_label}${
                linkedReleaseSnapshot.current_visual_basis_label ? ` · ${linkedReleaseSnapshot.current_visual_basis_label}` : ""
              }`}
            </span>
          ) : null}
          {linkedReleaseSnapshot.current_pair_label ? (
            <div className="segment-current-pair-row">
              <span>Current Pair</span>
              <span className={getCurrentPairBadgeClassName(linkedReleaseSnapshot.current_pair_label)}>
                {linkedReleaseSnapshot.current_pair_label}
              </span>
              {linkedReleaseSnapshot.current_pair_hint ? (
                <span className="segment-current-pair-hint">{linkedReleaseSnapshot.current_pair_hint}</span>
              ) : null}
            </div>
          ) : null}
          {linkedReleaseSnapshot.primary_source_label ? (
            <span>{`Main Source ${linkedReleaseSnapshot.primary_source_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.primary_visual_label ? (
            <span>{`Main Visual ${linkedReleaseSnapshot.primary_visual_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.backup_source_label ? (
            <span>{`Backup Source ${linkedReleaseSnapshot.backup_source_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.backup_visual_label ? (
            <span>{`Backup Visual ${linkedReleaseSnapshot.backup_visual_label}`}</span>
          ) : null}
          {linkedReleaseSnapshot.next_action_label ? <span>{`Next ${linkedReleaseSnapshot.next_action_label}`}</span> : null}
          {linkedReleaseSnapshot.attachment_id &&
          linkedReleaseSnapshot.primary_source_entry &&
          linkedReleaseSnapshot.primary_visual_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onPromoteLinkedReleasePrimaryPair?.(segmentId)}
            >
              Promote Main Pair
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id &&
          linkedReleaseSnapshot.backup_source_entry &&
          linkedReleaseSnapshot.backup_visual_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onPromoteLinkedReleaseBackupPair?.(segmentId)}
            >
              Promote Backup Pair
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id && linkedReleaseSnapshot.primary_source_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onUseLinkedReleasePrimary?.(segmentId, "source")}
            >
              Use Main Source
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id && linkedReleaseSnapshot.primary_visual_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onUseLinkedReleasePrimary?.(segmentId, "visual")}
            >
              Use Main Visual
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id && linkedReleaseSnapshot.backup_source_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onUseLinkedReleaseBackup?.(segmentId, "source")}
            >
              Use Backup Source
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id && linkedReleaseSnapshot.backup_visual_entry ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onUseLinkedReleaseBackup?.(segmentId, "visual")}
            >
              Use Backup Visual
            </button>
          ) : null}
          {linkedReleaseSnapshot.attachment_id ? (
            <button
              className="btn ghost small"
              type="button"
              onClick={() => onOpenLinkedReleaseHandoff?.(segmentId, linkedReleaseSnapshot.attachment_id)}
            >
              Open Handoff
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
