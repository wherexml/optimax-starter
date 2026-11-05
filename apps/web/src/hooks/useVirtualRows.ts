import { useMemo } from "react";

export interface UseVirtualRowsOptions {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
  enabled?: boolean;
}

export interface VirtualRowsWindow {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  isVirtualized: boolean;
}

export function useVirtualRows({
  count,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan = 6,
  enabled = true,
}: UseVirtualRowsOptions): VirtualRowsWindow {
  return useMemo(() => {
    if (!enabled || count <= 0 || rowHeight <= 0) {
      return {
        startIndex: 0,
        endIndex: count,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        isVirtualized: false,
      };
    }

    const safeViewportHeight = viewportHeight > 0 ? viewportHeight : 600;
    const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / rowHeight));
    const rawStart = Math.floor(scrollTop / rowHeight);
    const clampedStart = Math.min(rawStart, Math.max(0, count - 1));

    const startIndex = Math.max(0, clampedStart - overscan);
    const endIndex = Math.min(count, clampedStart + visibleCount + overscan);

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * rowHeight,
      bottomSpacerHeight: Math.max(0, (count - endIndex) * rowHeight),
      isVirtualized: true,
    };
  }, [count, scrollTop, viewportHeight, rowHeight, overscan, enabled]);
}
