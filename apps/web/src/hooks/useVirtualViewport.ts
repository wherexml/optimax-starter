import { useCallback, useEffect, useState, type UIEvent } from "react";

export interface UseVirtualViewportOptions {
  enabled?: boolean;
  defaultHeight?: number;
}

export interface VirtualViewportState {
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  scrollTop: number;
  viewportHeight: number;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
}

export function useVirtualViewport({
  enabled = true,
  defaultHeight = 600,
}: UseVirtualViewportOptions = {}): VirtualViewportState {
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultHeight);

  const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    setScrollContainer(element);
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!enabled) return;
    setScrollTop(event.currentTarget.scrollTop);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setScrollTop(0);
      setViewportHeight(defaultHeight);
      return;
    }

    if (!scrollContainer) {
      setViewportHeight(defaultHeight);
      return;
    }

    const updateViewport = () => {
      setViewportHeight(scrollContainer.clientHeight || defaultHeight);
    };

    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(scrollContainer);

    return () => {
      observer.disconnect();
    };
  }, [enabled, defaultHeight, scrollContainer]);

  return {
    scrollContainerRef,
    scrollTop,
    viewportHeight,
    handleScroll,
  };
}
