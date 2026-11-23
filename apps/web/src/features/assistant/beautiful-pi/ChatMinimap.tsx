// Turn markers on the transcript edge, adapted from Beautiful Pi Web ChatMinimap (4a308ed, MIT, see LICENSE).
// One marker per question, hover preview, click-to-scroll and active-turn tracking.
import { type RefObject, useCallback, useEffect, useState } from "react";

export type MinimapTurn = { id: string; question: string };

export function ChatMinimap({
  turns,
  scroller,
}: {
  turns: MinimapTurn[];
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const [marks, setMarks] = useState<{ id: string; ratio: number }[]>([]);
  const [active, setActive] = useState<string>();
  const [hover, setHover] = useState<string>();

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const total = Math.max(el.scrollHeight, 1);
    const find = (id: string) =>
      el.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(id)}"]`);
    const next = turns.flatMap(({ id }) => {
      const node = find(id);
      return node ? [{ id, ratio: Math.min(0.98, node.offsetTop / total) }] : [];
    });
    setMarks(next);
    const middle = el.scrollTop + el.clientHeight * 0.35;
    let current = next[0]?.id;
    for (const { id } of next) {
      const node = find(id);
      if (node && node.offsetTop <= middle) current = id;
    }
    setActive(current);
  }, [scroller, turns]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, scroller]);

  if (turns.length < 2) return null;
  const preview = turns.find(({ id }) => id === hover);
  return (
    <nav className="pi-minimap" aria-label="对话导航">
      {marks.map(({ id, ratio }, index) => {
        const turn = turns.find((entry) => entry.id === id);
        return (
          <button
            key={id}
            type="button"
            className="pi-minimap-mark"
            style={{ top: `${ratio * 100}%` }}
            aria-current={id === active ? "true" : undefined}
            aria-label={`第 ${index + 1} 轮：${turn?.question.slice(0, 40) ?? ""}`}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(undefined)}
            onFocus={() => setHover(id)}
            onBlur={() => setHover(undefined)}
            onClick={() =>
              scroller.current
                ?.querySelector(`[data-turn-id="${CSS.escape(id)}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        );
      })}
      {preview && (
        <div
          className="pi-minimap-preview"
          role="tooltip"
          style={{ top: `${(marks.find(({ id }) => id === preview.id)?.ratio ?? 0) * 100}%` }}
        >
          <small>第 {turns.indexOf(preview) + 1} 轮</small>
          <p>{preview.question}</p>
        </div>
      )}
    </nav>
  );
}
