import { useQueryClient } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronUp,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { NotFoundFallback, RouteErrorFallback } from "@/components/RouteFallbacks";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster, toast } from "@/components/ui/toast";
import {
  APP_CONFIG,
  getFirstAccessiblePath,
  getSidebarNodes,
  isPathAccessible,
  type NavLeafItem,
  storageKey,
} from "@/config/app-config";
// @starter:agent-start
import { AssistantDock, SidebarAssistantTrigger } from "@/features/assistant/AssistantDrawer";
import { getRoleLabel, hasPermission, useAccount } from "@/features/auth/session";
import { QuickNav } from "@/features/navigation/QuickNav";
import { useSidebarGlide } from "@/features/navigation/useSidebarGlide";
import { WorkspaceRefresh } from "@/features/refresh/WorkspaceRefresh";
import { request } from "../console-client";
// @starter:agent-end
import "../index.css";

const SIDEBAR_KEY = storageKey("sidebar");
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
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(".user-menu-item")];
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

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFoundFallback,
  errorComponent: RouteErrorFallback,
});
function Root() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Public pages (login, one-time activation links) render without the authenticated shell.
  const bare = path === "/login" || path.startsWith("/invite/");
  return (
    <>
      {bare ? <Outlet /> : <Shell />}
      <Toaster />
    </>
  );
}

function SidebarLeaf({
  item,
  groupLabel,
  compact,
  onNavigate,
}: {
  item: NavLeafItem;
  groupLabel?: string;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const Icon = compact && item.collapsedIcon ? item.collapsedIcon : item.icon;
  const collapsedTitle =
    item.collapsedLabel ?? (groupLabel ? `${groupLabel} ${item.label}` : item.label);
  const linkProps = item.defaultSearch
    ? {
        search: item.defaultSearch as never,
        activeOptions: { includeSearch: false, exact: item.exact },
      }
    : item.exact
      ? { activeOptions: { exact: true } }
      : {};

  return (
    <Link
      to={item.to}
      {...linkProps}
      onClick={onNavigate}
      title={compact && groupLabel ? collapsedTitle : item.label}
      aria-label={compact && groupLabel ? collapsedTitle : undefined}
    >
      <Icon size={compact ? 18 : 16} aria-hidden="true" />
      {!(compact && groupLabel) && <span>{item.label}</span>}
    </Link>
  );
}

function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const mobile = useMedia(MOBILE_QUERY);
  const [compact, setCompact] = useState(readCompact);
  const [drawer, setDrawer] = useState(false);
  const [quick, setQuick] = useState(false);
  const [menu, setMenu] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const aside = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const navPill = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const userTrigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skipMenuReturn = useRef(false);
  const drawerWasOpen = useRef(false);
  const cache = useQueryClient();
  const me = useAccount();
  const ready = Boolean(me.data);
  const accessible = me.data ? isPathAccessible(path, me.data) : true;

  useEffect(() => {
    if (me.data && !accessible) {
      const target = getFirstAccessiblePath(me.data);
      if (target !== path) {
        void navigate({ to: target, replace: true });
      }
    }
  }, [accessible, me.data, navigate, path]);

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
      if (!active || active === document.body || side?.contains(active)) opener.current?.focus();
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
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rail = compact && !mobile;
  useSidebarGlide(nav, navPill, path, rail, ready);

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
  const canViewAccounts = hasPermission(me.data, "accounts:read");
  const roleLabel = getRoleLabel(me.data.role);
  const initial = me.data.name.slice(0, 1);
  const sidebarNodes = getSidebarNodes(me.data);
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
    toast.dismiss();
    cache.clear();
    location.replace("/login");
  }

  return (
    <div
      className={"workspace" + (rail ? " compact" : "") + (mobile && drawer ? " drawer-open" : "")}
    >
      <aside id="console-sidebar" ref={aside} aria-label="侧边栏">
        <header className="brand">
          <img
            className="mark"
            src={APP_CONFIG.logoSrc}
            alt={`${APP_CONFIG.title} Logo`}
            width={32}
            height={32}
          />
          <strong>{APP_CONFIG.title}</strong>
          <button
            type="button"
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
            <ToggleIcon size={16} />
          </button>
        </header>
        <nav id="console-nav" ref={nav} aria-label="主导航">
          <span ref={navPill} className="nav-glide-pill" aria-hidden="true" hidden />
          {sidebarNodes.map((node) => {
            if (node.kind === "item") {
              return <SidebarLeaf key={node.to} item={node} compact={rail} />;
            }
            if (rail) {
              return (
                <Fragment key={node.label}>
                  {node.children.map((child) => (
                    <SidebarLeaf
                      key={child.to}
                      item={child}
                      groupLabel={node.label}
                      compact
                      onNavigate={() => setDrawer(false)}
                    />
                  ))}
                </Fragment>
              );
            }
            return (
              <div key={node.label} className="nav-group">
                <div className="nav-group-title">{node.label}</div>
                <div className="nav-children">
                  {node.children.map((child) => (
                    <SidebarLeaf
                      key={child.to}
                      item={child}
                      groupLabel={node.label}
                      compact={false}
                      onNavigate={() => setDrawer(false)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="nav-tools">
          <button
            type="button"
            className="nav-search"
            aria-label="搜索页面"
            title="搜索页面"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setQuick(true)}
          >
            <Search size={15} aria-hidden="true" />
            <span>搜索</span>
            <kbd aria-hidden="true">{MAC ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          {/* @starter:agent-start */}
          <SidebarAssistantTrigger compact={rail} />
          {/* @starter:agent-end */}
        </div>
        {/* EASM SidebarFooter user dropdown, built on Radix Popover. */}
        <div className="identity">
          <Popover open={menu} onOpenChange={setMenu}>
            <PopoverTrigger asChild>
              <button
                type="button"
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
                <ChevronUp size={14} className="who-chevron" aria-hidden="true" />
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
                menuRef.current?.querySelector<HTMLElement>(".user-menu-item")?.focus();
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
                    {me.data.username} {roleLabel}
                  </small>
                </span>
              </div>
              <hr />
              <Link to="/settings" className="user-menu-item" onClick={leaveMenu}>
                <Settings size={16} aria-hidden="true" />
                个人设置
              </Link>
              {canViewAccounts && (
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
        <div className="scrim" aria-hidden="true" onClick={() => setDrawer(false)} />
      )}
      <main>
        <section className="content" ref={content}>
          {mobile && !drawer && (
            <button
              type="button"
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
          <WorkspaceRefresh key={path} path={path}>
            <div className="page">
              {accessible ? (
                <div key={path} className="route-stage">
                  <Outlet />
                </div>
              ) : null}
            </div>
          </WorkspaceRefresh>
        </section>
      </main>
      <QuickNav open={quick} onOpenChange={setQuick} account={me.data} />
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
      {/* @starter:agent-start */}
      <AssistantDock />
      {/* @starter:agent-end */}
    </div>
  );
}
