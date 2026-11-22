import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createContentRefresh, createRefreshVisual, type ContentRefreshOptions } from "../lib/content-refresh";

type Props = ContentRefreshOptions & {
  children: ReactNode;
  loading: boolean;
  immediate?: boolean;
  className?: string;
};
export function ContentRefresh({
  children,
  loading,
  immediate = false,
  className,
  layout,
  label,
  logoSrc,
  delay,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<ReturnType<typeof createContentRefresh> | null>(null);
  useLayoutEffect(() => {
    control.current = createContentRefresh(host.current!, { layout, label, logoSrc, delay });
    return () => { control.current?.destroy(); control.current = null; };
  }, [layout, label, logoSrc, delay]);
  useLayoutEffect(() => {
    control.current?.setBusy(loading, immediate);
  }, [loading, immediate, layout, label, logoSrc, delay]);
  return <div className={className} ref={host}>{children}</div>;
}

/** Standalone skeleton for router/Suspense fallbacks; no fake progress or timer. */
export function PageSkeleton({ layout, label, logoSrc, className }: ContentRefreshOptions & { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visual = createRefreshVisual({ layout, label, logoSrc });
    host.current!.append(visual);
    return () => visual.remove();
  }, [layout, label, logoSrc]);
  return <div className={className} ref={host} />;
}
