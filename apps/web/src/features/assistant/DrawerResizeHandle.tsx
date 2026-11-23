import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { storageKey } from "@/config/app-config";

const MINIMUM = 360;
const DEFAULT_WIDTH = 440;
const PREFERENCE_KEY = storageKey("agent.drawer-width");
export const PANEL_ID = "starter-assistant-panel";

function maximum() {
  const viewport = document.documentElement.clientWidth;
  // The docked drawer shares the window with the sidebar and the main page.
  return Math.max(MINIMUM, Math.min(900, viewport - (viewport >= 1080 ? 560 : 80)));
}

function readWidth() {
  try {
    const saved = Number(localStorage.getItem(PREFERENCE_KEY));
    if (Number.isFinite(saved) && saved >= MINIMUM) return saved;
  } catch {
    /* Storage is optional. */
  }
  return DEFAULT_WIDTH;
}

export function DrawerResizeHandle() {
  const [preferred, setPreferred] = useState(readWidth);
  const [limit, setLimit] = useState(maximum);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.max(MINIMUM, Math.min(limit, value)));
  const width = clamp(preferred);

  useEffect(() => {
    const update = () => setLimit(maximum());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useLayoutEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--starter-assistant-preferred", `${width}px`);
    return () => {
      style.removeProperty("--starter-assistant-preferred");
    };
  }, [width]);

  function commit(next: number) {
    const value = clamp(next);
    setPreferred(value);
    try {
      localStorage.setItem(PREFERENCE_KEY, String(value));
    } catch {
      /* Still works for this session. */
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="调整智能助理宽度"
      title="拖动或用左右方向键调整宽度"
      aria-controls={PANEL_ID}
      aria-orientation="vertical"
      aria-valuemin={MINIMUM}
      aria-valuemax={limit}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      className="starter-assistant-divider"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
          setPreferred(clamp(drag.current.width + drag.current.x - event.clientX));
        }
      }}
      onPointerUp={(event) => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        commit(drag.current.width + drag.current.x - event.clientX);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        if (drag.current) setPreferred(drag.current.width);
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const steps: Record<string, number> = {
          ArrowLeft: width + 24,
          ArrowRight: width - 24,
          Home: MINIMUM,
          End: limit,
        };
        const next = steps[event.key];
        if (next === undefined) return;
        event.preventDefault();
        commit(next);
      }}
    />
  );
}
