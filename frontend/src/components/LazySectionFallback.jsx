import React from "react";

export function LazySectionFallback({ label = "Loading..." }) {
  return (
    <div className="panel">
      <div className="muted">{label}</div>
    </div>
  );
}
