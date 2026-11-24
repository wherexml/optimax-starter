import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { storageKey } from "@/config/app-config";
import { hasPermission, useAccount } from "@/features/auth/session";
import { AssistantBrandMark } from "./AssistantBrandMark";
import { AGENT_STATUS_KEY, type AgentScope, fetchAgentStatus } from "./api";
import { DrawerResizeHandle, PANEL_ID } from "./DrawerResizeHandle";
import "./assistant.css";

const AssistantPanel = lazy(() => import("./AssistantPanel"));
const NARROW_QUERY = "(max-width: 720px)";
const WIDE_PREFERENCE_KEY = storageKey("agent.drawer-wide");

function readWidePreference(): boolean {
  try {
    return localStorage.getItem(WIDE_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeWidePreference(wide: boolean) {
  try {
    localStorage.setItem(WIDE_PREFERENCE_KEY, wide ? "1" : "0");
  } catch {
    /* Storage is optional. */
  }
}

/** Page scope sent with the next question; `nonce` lets the same page re-open a fresh request. */
export type AssistantRequest = { scope?: AgentScope; nonce: number };

// ---------------------------------------------------------------------------
// Drawer state lives in a tiny module store, so host pages only render <AssistantDock /> once and
// triggers anywhere in the tree can open it without wrapping the shell in a provider.
// ---------------------------------------------------------------------------
type DockState = { open: boolean; mounted: boolean; wide: boolean; request: AssistantRequest };
let state: DockState = {
  open: false,
  mounted: false,
  wide: readWidePreference(),
  request: { nonce: 0 },
};
let trigger: HTMLElement | null = null;
const listeners = new Set<() => void>();
const setState = (next: Partial<DockState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function show(element: HTMLElement, scope?: AgentScope) {
  trigger = element;
  setState({
    open: true,
    mounted: true,
    wide: state.open ? state.wide : readWidePreference(),
    request: scope ? { scope, nonce: state.request.nonce + 1 } : state.request,
  });
  document.getElementById(PANEL_ID)?.focus({ preventScroll: true });
}

function closePanel({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
  // Closing hides the drawer without discarding the user's persisted wide preference.
  setState({ open: false });
  if (!restoreFocus) return;
  requestAnimationFrame(() => {
    const restore =
      trigger?.isConnected && !trigger.closest("[inert]")
        ? trigger
        : document.querySelector<HTMLElement>(".nav-assistant, .menu-opener");
    restore?.focus({ preventScroll: true });
  });
}

function close() {
  closePanel();
}

function toggleWide() {
  const next = !state.wide;
  writeWidePreference(next);
  setState({ wide: next });
}

/** 全屏态下点击引用或执行页面跳转工具时，临时退回右侧窄抽屉以便对照查看，不覆盖持久化的全屏偏好。 */
export function stepDownAssistantWidth() {
  if (state.open && state.wide) {
    setState({ wide: false });
  }
}

export function useAssistantDrawer() {
  const open = useSyncExternalStore(
    subscribe,
    () => state.open,
    () => false,
  );
  return { open, show, close };
}

/**
 * Shared visibility gate. Accounts without `agent:use` never see the assistant. When the model is
 * unconfigured or the circuit is open, only accounts that can fix it (settings / AI readers) see
 * a trigger; everyone else sees nothing.
 */
export function useAssistantAvailability() {
  const me = useAccount();
  const canUse = hasPermission(me.data, "agent:use");
  const status = useQuery({
    queryKey: AGENT_STATUS_KEY,
    queryFn: fetchAgentStatus,
    staleTime: 30_000,
    enabled: Boolean(me.data) && canUse,
  });
  const canFix =
    hasPermission(me.data, "system:settings:read") || hasPermission(me.data, "system:ai:read");
  const data = status.data;
  const visible = canUse && !!data && (data.enabled || canFix);
  const hint = !data || data.enabled ? "" : data.circuitOpen ? "已熔断" : "待配置";
  return { visible, status: data, hint };
}

export function AskAssistant({ scope, label = "问助理" }: { scope?: AgentScope; label?: string }) {
  const dock = useAssistantDrawer();
  const { visible, hint } = useAssistantAvailability();
  if (!visible) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="starter-assistant-ask"
      aria-expanded={dock.open}
      aria-controls={PANEL_ID}
      title={hint ? `智能助理（${hint}）` : "智能助理"}
      onClick={(event) => dock.show(event.currentTarget, scope)}
    >
      <AssistantBrandMark size={16} />
      {label}
    </Button>
  );
}

export function SidebarAssistantTrigger({ compact }: { compact: boolean }) {
  const dock = useAssistantDrawer();
  const { visible, hint } = useAssistantAvailability();
  if (!visible) return null;
  const title = hint ? `智能助理（${hint}）` : "智能助理";
  return (
    <button
      type="button"
      className="nav-search nav-assistant"
      aria-label={title}
      title={title}
      aria-expanded={dock.open}
      aria-controls={PANEL_ID}
      data-compact={compact || undefined}
      onClick={(event) => (dock.open ? dock.close() : dock.show(event.currentTarget))}
    >
      <AssistantBrandMark size={16} />
      <span>智能助理</span>
      {hint && <small className="nav-assistant-hint">{hint}</small>}
    </button>
  );
}

/** Renders the drawer (portal). Optional children are passed through for wrapper-style mounting. */
export function AssistantDock({ children }: { children?: ReactNode }) {
  const dock = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches,
  );
  const panel = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prevPathname = useRef(pathname);

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!dock.open) return;
    const root = document.documentElement;
    root.dataset.assistantPanel = "open";
    panel.current?.focus({ preventScroll: true });
    return () => {
      delete root.dataset.assistantPanel;
    };
  }, [dock.open]);
  useEffect(() => {
    // Narrow screens: the drawer is modal, so the shell behind it becomes inert.
    const shell = document.querySelector<HTMLElement>(".workspace");
    if (!dock.open || !narrow || !shell) return;
    const previous = shell.inert;
    shell.inert = true;
    return () => {
      shell.inert = previous;
    };
  }, [dock.open, narrow]);
  useEffect(() => {
    // Desktop fullscreen: cover <main> and keep keyboard focus inside the assistant/sidebar.
    if (!dock.open || !dock.wide || narrow) return;
    const main = document.querySelector<HTMLElement>(".workspace > main");
    if (!main) return;
    const previous = main.inert;
    main.inert = true;
    return () => {
      main.inert = previous;
    };
  }, [dock.open, dock.wide, narrow]);
  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;
    if (state.open && state.wide && !narrow) {
      closePanel({ restoreFocus: false });
    }
  }, [pathname, narrow]);
  useEffect(() => {
    if (!dock.open || !dock.wide || narrow) return;
    const onDocumentClick = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("#console-sidebar nav a, .user-menu a.user-menu-item, .quick-nav-item")) {
        closePanel({ restoreFocus: false });
      }
    };
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      if (!(event.target instanceof Element) || !event.target.closest(".quick-nav")) return;
      setTimeout(() => {
        if (!document.querySelector(".quick-nav") && state.open && state.wide) {
          closePanel({ restoreFocus: false });
        }
      }, 0);
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [dock.open, dock.wide, narrow]);
  // Leaving the authenticated shell (logout) closes the drawer without wiping wide preference.
  useEffect(() => () => setState({ open: false }), []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (
      target.matches("input, select") ||
      document.querySelector("[data-radix-popper-content-wrapper]")
    ) {
      return;
    }
    event.preventDefault();
    close();
  }

  return (
    <>
      {children}
      {dock.mounted &&
        createPortal(
          <>
            {dock.open && narrow && (
              <div className="starter-assistant-backdrop" aria-hidden="true" onClick={close} />
            )}
            {(() => {
              const panelBody = (
                <>
                  {!narrow && !dock.wide && <DrawerResizeHandle />}
                  <Suspense
                    fallback={
                      <button
                        type="button"
                        className="pi-icon starter-assistant-close"
                        aria-label="关闭智能助理"
                        onClick={close}
                      >
                        <X size={17} />
                      </button>
                    }
                  >
                    <AssistantPanel
                      request={dock.request}
                      wide={dock.wide}
                      onExpand={toggleWide}
                      onClose={close}
                    />
                  </Suspense>
                </>
              );
              const common = {
                id: PANEL_ID,
                ref: panel,
                hidden: !dock.open,
                className: "starter-assistant-panel",
                "data-wide": dock.wide || undefined,
                "aria-label": "智能助理",
                tabIndex: -1,
                onKeyDown,
              };
              return narrow ? (
                <section {...common} role="dialog" aria-modal="true">
                  {panelBody}
                </section>
              ) : (
                <aside {...common}>{panelBody}</aside>
              );
            })()}
          </>,
          document.body,
        )}
    </>
  );
}
