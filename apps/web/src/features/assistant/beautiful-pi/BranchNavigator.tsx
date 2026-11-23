// Fork switcher adapted from Beautiful Pi Web BranchNavigator (4a308ed, MIT, see LICENSE).
// Forks are separate sessions linked by parentId; the pill jumps to the parent or a sibling branch.
import { ChevronDown, CornerLeftUp, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type BranchNode = { id: string; title: string; parentId?: string; forkTurn?: number };

export function BranchNavigator({
  sessions,
  activeId,
  onSelect,
}: {
  sessions: BranchNode[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const current = sessions.find(({ id }) => id === activeId);
  if (!current) return null;
  const rootId =
    current.parentId && sessions.some(({ id }) => id === current.parentId)
      ? current.parentId
      : current.id;
  const root = sessions.find(({ id }) => id === rootId);
  const branches = sessions.filter(({ parentId }) => parentId === rootId);
  if (!root || !branches.length) return null;
  const family = [root, ...branches];
  const position = family.findIndex(({ id }) => id === activeId) + 1;

  return (
    <div className="pi-branch" ref={box}>
      <button
        type="button"
        className="pi-branch-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`对话分支 ${position}/${family.length}`}
        title="切换对话分支"
        onClick={() => setOpen(!open)}
      >
        <GitBranch size={13} aria-hidden="true" />
        <span>{current.parentId ? `分支 ${position - 1}` : "主线"}</span>
        <small>
          {position}/{family.length}
        </small>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="pi-branch-menu" role="menu" aria-label="对话分支">
          {family.map((node, index) => (
            <button
              key={node.id}
              type="button"
              role="menuitemradio"
              aria-checked={node.id === activeId}
              onClick={() => {
                setOpen(false);
                onSelect(node.id);
              }}
            >
              {index === 0 ? (
                <CornerLeftUp size={13} aria-hidden="true" />
              ) : (
                <GitBranch size={13} aria-hidden="true" />
              )}
              <span>{index === 0 ? "主线" : `分支 ${index}`}</span>
              <small>
                {node.title}
                {node.forkTurn ? `（第 ${node.forkTurn} 轮起）` : ""}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
