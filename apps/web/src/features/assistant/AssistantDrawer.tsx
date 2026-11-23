import { useQuery } from "@tanstack/react-query";
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
import { hasPermission, useAccount } from "@/features/auth/session";
import { AssistantBrandMark } from "./AssistantBrandMark";
import { AGENT_STATUS_KEY, type AgentScope, fetchAgentStatus } from "./api";
import { DrawerResizeHandle, PANEL_ID } from "./DrawerResizeHandle";
import "./assistant.css";

const AssistantPanel = lazy(() => import("./AssistantPanel"));
const NARROW_QUERY = "(max-width: 720px)";

/** Page scope sent with the next question; `nonce` lets the same page re-open a fresh request. */
export type AssistantRequest = { scope?: AgentScope; nonce: number };

// ---------------------------------------------------------------------------
// Drawer state lives in a tiny module store, so host pages only render <AssistantDock /> once and
// triggers anywhere in the tree can open it without wrapping the shell in a provider.
// ---------------------------------------------------------------------------
type DockState = { open: boolean; mounted: boolean; wide: boolean; request: AssistantRequest };
let state: DockState = { open: false, mounted: false, wide: false, request: { nonce: 0 } };
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
    request: scope ? { scope, nonce: state.request.nonce + 1 } : state.request,
  });
  document.getElementById(PANEL_ID)?.focus({ preventScroll: true });
}

function close() {
  setState({ open: false, wide: false });
  requestAnimationFrame(() => {
    const restore =
      trigger?.isConnected && !trigger.closest("[inert]")
        ? trigger
        : document.querySelector<HTMLElement>(".nav-assistant, .menu-opener");
    restore?.focus({ preventScroll: true });
  });
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
  // Leaving the authenticated shell (logout) closes the drawer.
  useEffect(() => () => setState({ open: false, wide: false }), []);

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
                      onExpand={() => setState({ wide: !state.wide })}
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
