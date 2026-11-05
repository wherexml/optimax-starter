import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Boxes,
  LayoutDashboard,
  ScrollText,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Target = "/" | "/assets" | "/accounts" | "/audit" | "/settings";
type Entry = {
  to: Target;
  label: string;
  aliases: string[];
  admin: boolean;
  icon: LucideIcon;
};
// Local routes only, following the OptiONE search-command entries. Admin entries are hidden from members; the backend still checks access.
const ENTRIES: Entry[] = [
  { to: "/", label: "工作台", aliases: ["dashboard", "home", "overview", "总览", "首页"], admin: false, icon: LayoutDashboard },
  { to: "/assets", label: "资产台账", aliases: ["assets", "ledger", "inventory", "资产"], admin: false, icon: Boxes },
  { to: "/accounts", label: "账户管理", aliases: ["accounts", "users", "members", "账户", "用户"], admin: true, icon: Users },
  { to: "/audit", label: "操作日志", aliases: ["audit", "logs", "activity", "日志", "审计"], admin: true, icon: ScrollText },
  { to: "/settings", label: "个人设置", aliases: ["settings", "profile", "account", "password", "security", "设置", "资料", "密码"], admin: false, icon: Settings },
];

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
    return ENTRIES.filter((e) => admin || !e.admin).filter(
      (e) => !q || [e.label, ...e.aliases].some((t) => t.toLowerCase().includes(q)),
    );
  }, [admin, query]);
  const current = Math.min(active, Math.max(items.length - 1, 0));
  function go(entry: Entry) {
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
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={items.length ? `${id}-${current}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {items.length ? (
        <ul role="listbox" id={`${id}-list`} aria-label="页面">
          {items.map((entry, i) => (
            <li
              key={entry.to}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onClick={() => go(entry)}
            >
              <entry.icon size={16} aria-hidden="true" />
              <span>{entry.label}</span>
              {entry.to === path && <small>当前页面</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="quick-nav-empty">
          无匹配页面
        </p>
      )}
    </DialogContent>
  );
}
