import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";

type Refresh = <T>(request: () => Promise<T>) => Promise<T>;
const RefreshContext = createContext<Refresh>(request => request());
export function useContentRefresh() { return useContext(RefreshContext); }

const MANUAL_REFRESH_MIN_MS = 260;

/** Only first reads and deliberate refreshes cover the page. Background reads stay quiet. */
export function WorkspaceRefresh({ children, path }: { children: ReactNode; path: string }) {
  const initial = useIsFetching({ predicate: query => query.meta?.contentRefresh === true && query.isActive() && query.state.data === undefined });
  const [pending, setPending] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback<Refresh>(async request => {
    const startedAt = performance.now();
    setPending(count => count + 1);
    try {
      const result = await request();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const remain = reduced ? 0 : MANUAL_REFRESH_MIN_MS - (performance.now() - startedAt);
      if (remain > 0 && alive.current) {
        await new Promise<void>(resolve => { setTimeout(resolve, remain); });
      }
      return result;
    } finally {
      if (alive.current) setPending(count => count - 1);
    }
  }, []);
  return <RefreshContext.Provider value={run}>
    <ContentRefresh
      loading={initial > 0 || pending > 0}
      immediate={pending > 0}
      layout={path === "/" ? "dashboard" : "table"}
    >
      {children}
    </ContentRefresh>
  </RefreshContext.Provider>;
}
