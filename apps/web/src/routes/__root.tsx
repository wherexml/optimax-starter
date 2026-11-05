import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/features/auth/session";
import { QuickNav } from "@/features/navigation/QuickNav";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import {
  Boxes,
  ChevronUp,
  LayoutDashboard,
  Layers3,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { request } from "../console-client";
import "../index.css";

const SIDEBAR_KEY = "optimax-starter.sidebar";
const MOBILE_QUERY = "(max-width: 720px)";
const MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function readCompact() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "compact";
  } catch {
    return false;
  }
}
function writeCompact(compact: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, compact ? "compact" : "expanded");
  } catch {
    // 本地存储不可用时仅保留本次页面内的状态。
  }
}
function useMedia(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);
    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);
  return matches;
}
// Arrow keys, Home and End move focus between user-menu items. Tab order is unchanged.
function moveFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(".user-menu-item"),
  ];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? last
        : e.key === "ArrowDown"
          ? (i + 1) % items.length
          : i <= 0
            ? last
            : i - 1;
  items[next]?.focus();
}

export const Route = createRootRoute({ component: Root });
function Root() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return path === "/login" ? <Outlet /> : <Shell />;
}
function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const mobile = useMedia(MOBILE_QUERY);
  const [compact, setCompact] = useState(readCompact);
  const [drawer, setDrawer] = useState(false);
  const [quick, setQuick] = useState(false);
  const [menu, setMenu] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const content = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const userTrigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skipMenuReturn = useRef(false);
  const drawerWasOpen = useRef(false);
  const cache = useQueryClient();
  const me = useAccount();
  const ready = Boolean(me.data);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
  }, [path, mobile]);
  useEffect(() => {
    if (!ready) return;
    const open = mobile && drawer;
    const side = aside.current;
    content.current?.toggleAttribute("inert", open);
    // 抽屉关闭时，若焦点仍在侧栏中（或已丢失），先移回打开按钮，再让侧栏变为 inert。
    if (drawerWasOpen.current && !open && mobile) {
      const active = document.activeElement;
      if (!active || active === document.body || side?.contains(active))
        opener.current?.focus();
    }
    drawerWasOpen.current = open;
    side?.toggleAttribute("inert", mobile && !drawer);
    if (!open) return;
    nav.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, mobile, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!me.data)
    return me.isError ? (
      <main className="boot">
        <div role="alert" className="grid justify-items-center gap-3 text-center">
          <strong className="text-base text-foreground">服务暂时不可用</strong>
          <p className="m-0 text-sm">{me.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={me.isFetching}
            onClick={() => void me.refetch()}
          >
            重试
          </Button>
        </div>
      </main>
    ) : (
      <main role="status" className="boot">
        正在加载…
      </main>
    );
  const admin = me.data.role === "admin";
  const roleLabel = admin ? "管理员" : "成员";
  const initial = me.data.name.slice(0, 1);
  const rail = compact && !mobile;
  const toggleLabel = mobile ? "关闭菜单" : compact ? "展开菜单" : "折叠菜单";
  const ToggleIcon = mobile ? X : compact ? PanelLeftOpen : PanelLeftClose;
  // When a menu item navigates or opens a dialog, focus does not return to the trigger, so it cannot land in a hidden sidebar or behind the dialog.
  const leaveMenu = () => {
    skipMenuReturn.current = true;
    setMenu(false);
  };
  async function logout() {
    setLoggingOut(true);
    try {
      await request("/logout", "POST", {});
    } catch {
      // 会话可能已失效，仍然回到登录页。
    }
    cache.clear();
    location.replace("/login");
  }

  return (
    <div
      className={
        "workspace" +
        (rail ? " compact" : "") +
        (mobile && drawer ? " drawer-open" : "")
      }
    >
      <aside id="console-sidebar" ref={aside} aria-label="侧边栏">
        <header className="brand">
          <span className="mark">
            <Layers3 size={19} />
          </span>
          <strong>OptiMax</strong>
          <button
            className="rail-toggle"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-controls="console-sidebar"
            {...(mobile ? {} : { "aria-expanded": !compact })}
            onClick={() => {
              if (mobile) {
                setDrawer(false);
                return;
              }
              writeCompact(!compact);
              setCompact(!compact);
            }}
          >
            <ToggleIcon size={18} />
          </button>
        </header>
        <nav id="console-nav" ref={nav} aria-label="主导航">
          <Link to="/" activeOptions={{ exact: true }} title="工作台">
            <LayoutDashboard size={17} />
            <span>工作台</span>
          </Link>
          <Link to="/assets" title="资产台账">
            <Boxes size={17} />
            <span>资产台账</span>
          </Link>
          {admin && (
            <>
              <Link to="/accounts" title="账户管理">
                <Users size={17} />
                <span>账户管理</span>
              </Link>
              <Link to="/audit" title="操作日志">
                <ScrollText size={17} />
                <span>操作日志</span>
              </Link>
            </>
          )}
        </nav>
        <div className="nav-tools">
          <button
            className="nav-search"
            aria-label="搜索页面"
            title="搜索页面"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setQuick(true)}
          >
            <Search size={17} aria-hidden="true" />
            <span>搜索</span>
            <kbd aria-hidden="true">{MAC ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        </div>
        {/* EASM SidebarFooter user dropdown, built on Radix Popover. */}
        <div className="identity">
          <Popover open={menu} onOpenChange={setMenu}>
            <PopoverTrigger asChild>
              <button
                ref={userTrigger}
                className="who"
                title={me.data.name}
                aria-label={`用户菜单：${me.data.name}，${roleLabel}`}
              >
                <i aria-hidden="true">{initial}</i>
                <span className="who-text">
                  <strong>{me.data.name}</strong>
                  <small>{roleLabel}</small>
                </span>
                <ChevronUp size={16} className="who-chevron" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              ref={menuRef}
              side={mobile ? "top" : "right"}
              align={mobile ? "start" : "end"}
              sideOffset={8}
              collisionPadding={8}
              aria-label="用户菜单"
              className="user-menu w-60 p-1"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                menuRef.current
                  ?.querySelector<HTMLElement>(".user-menu-item")
                  ?.focus();
              }}
              onCloseAutoFocus={(e) => {
                if (!skipMenuReturn.current) return;
                skipMenuReturn.current = false;
                e.preventDefault();
              }}
              onKeyDown={moveFocus}
            >
              <div className="user-menu-head">
                <i aria-hidden="true">{initial}</i>
                <span>
                  <strong>{me.data.name}</strong>
                  <small>
                    {me.data.username} · {roleLabel}
                  </small>
                </span>
              </div>
              <hr />
              <Link to="/settings" className="user-menu-item" onClick={leaveMenu}>
                <Settings size={16} aria-hidden="true" />
                个人设置
              </Link>
              {admin && (
                <Link to="/accounts" className="user-menu-item" onClick={leaveMenu}>
                  <Users size={16} aria-hidden="true" />
                  账户管理
                </Link>
              )}
              <hr />
              <button
                type="button"
                className="user-menu-item"
                data-tone="danger"
                onClick={() => {
                  leaveMenu();
                  setLogoutOpen(true);
                }}
              >
                <LogOut size={16} aria-hidden="true" />
                退出登录
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
      {mobile && drawer && (
        <div
          className="scrim"
          aria-hidden="true"
          onClick={() => setDrawer(false)}
        />
      )}
      <main>
        <section className="content" ref={content}>
          {mobile && !drawer && (
            <button
              ref={opener}
              className="menu-opener"
              aria-label="打开菜单"
              title="打开菜单"
              aria-expanded={false}
              aria-controls="console-sidebar"
              onClick={() => setDrawer(true)}
            >
              <Menu size={18} />
            </button>
          )}
          <div key={path} className="page">
            <Outlet />
          </div>
        </section>
      </main>
      <QuickNav open={quick} onOpenChange={setQuick} admin={admin} />
      <FormDialog
        open={logoutOpen}
        onOpenChange={(open) => {
          if (!loggingOut) setLogoutOpen(open);
        }}
        title="退出登录"
        description="确定要退出当前账户吗？"
        size="sm"
        submitText="退出登录"
        loading={loggingOut}
        onSubmit={() => void logout()}
        onCloseAutoFocus={(e) => {
          const t = userTrigger.current;
          if (t?.isConnected && !t.closest("[inert]")) {
            e.preventDefault();
            t.focus();
          }
        }}
      >
        {null}
      </FormDialog>
    </div>
  );
}
