// Adapted from Beautiful Pi Web AgentLoadingState (4a308ed, MIT, see LICENSE).
import { useEffect, useState } from "react";

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min <= 0 ? `${sec}s` : `${min}m ${String(sec).padStart(2, "0")}s`;
}

export function AgentLoadingState({
  label,
  showElapsed = true,
  compact = false,
}: {
  label: string;
  showElapsed?: boolean;
  compact?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!showElapsed) return;
    setElapsed(0);
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - started), 250);
    return () => window.clearInterval(id);
  }, [label, showElapsed]);
  return (
    <div
      className={`pi-loading${compact ? " is-compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={showElapsed ? `${label} ${formatElapsed(elapsed)}` : label}
    >
      <span className="pi-loading-pulse" aria-hidden="true" />
      <span className="pi-loading-label">{label}</span>
      {showElapsed && <span className="pi-loading-elapsed">{formatElapsed(elapsed)}</span>}
    </div>
  );
}
