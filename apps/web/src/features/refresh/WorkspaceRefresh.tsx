import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";
import { APP_CONFIG } from "@/config/app-config";

type Refresh = <T>(request: () => Promise<T>) => Promise<T>;
const RefreshContext = createContext<Refresh>(request => request());
export function useContentRefresh() { return useContext(RefreshContext); }

/** Only first reads and deliberate refreshes cover the page. Background reads stay quiet. */
export function WorkspaceRefresh({ children, path }: { children: ReactNode; path: string }) {
  const initial = useIsFetching({ predicate: query => query.meta?.contentRefresh === true && query.isActive() && query.state.data === undefined });
  const [pending, setPending] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback<Refresh>(async request => {
    setPending(count => count + 1);
    try { return await request(); }
    finally { if (alive.current) setPending(count => count - 1); }
  }, []);
  return <RefreshContext.Provider value={run}>
    <ContentRefresh loading={initial > 0 || pending > 0} layout={path === "/" ? "dashboard" : "table"} logoSrc={APP_CONFIG.logoSrc}>
      {children}
    </ContentRefresh>
  </RefreshContext.Provider>;
}
