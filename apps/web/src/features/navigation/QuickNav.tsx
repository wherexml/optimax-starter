import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { getQuickNavEntries, type QuickNavEntry } from "@/config/app-config";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function QuickNav({
  open,
  onOpenChange,
  admin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Palette admin={admin} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Palette({ admin, close }: { admin: boolean; close: () => void }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // 首次渲染时记录打开前的焦点（自动聚焦之前），关闭后归还。
  const [returnTo] = useState(() => document.activeElement);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return getQuickNavEntries(admin).filter(
      (e) => !q || [e.label, ...e.aliases].some((t) => t.toLowerCase().includes(q)),
    );
  }, [admin, query]);
  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => {
    document.getElementById(`${id}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, id, items]);
  function go(entry: QuickNavEntry) {
    close();
    if (entry.to !== path) void navigate({ to: entry.to });
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = items[current];
      if (entry) go(entry);
    }
  }
  return (
    <DialogContent
      size="sm"
      scrollable={false}
      aria-describedby={undefined}
      className="quick-nav gap-2 p-3"
      closeClassName="right-3 top-3 size-11"
      onCloseAutoFocus={(e) => {
        if (returnTo instanceof HTMLElement && returnTo.isConnected) {
          e.preventDefault();
          returnTo.focus();
        }
      }}
    >
      <DialogTitle className="sr-only">快速导航</DialogTitle>
      <label className="quick-nav-input">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-label="搜索页面"
          aria-expanded={true}
          aria-controls={`${id}-list`}
          aria-activedescendant={items[current] ? `${id}-${current}` : undefined}
          placeholder="搜索页面"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div id={`${id}-list`} role="listbox" aria-label="页面列表" className="quick-nav-list">
        {items.length === 0 ? (
          <p className="m-0 px-2.5 py-5 text-center text-sm text-muted-foreground">
            未找到匹配页面
          </p>
        ) : (
          items.map((entry, i) => {
            const Icon = entry.icon;
            const selected = i === current;
            return (
              <button
                key={entry.to}
                id={`${id}-${i}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={"quick-nav-item" + (selected ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(entry)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{entry.label}</span>
                {entry.to === path && <small>当前</small>}
              </button>
            );
          })
        )}
      </div>
    </DialogContent>
  );
}
