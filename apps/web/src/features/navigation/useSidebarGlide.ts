import { type RefObject, useEffect, useRef } from "react";

/** SwiftUI 阻尼弹簧参数（低过冲线性收尾），用于侧栏共享高亮胶囊的物理滑动。 */
const NAV_SPRING = {
  response: 0.36,
  damping: 0.84,
} as const;

const ACTIVE_LINK_SELECTOR = 'a.active, a[aria-current="page"]';

interface RowMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
}

function measureRow(nav: HTMLElement, row: HTMLElement): RowMetrics {
  const navRect = nav.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return {
    x: rowRect.left - navRect.left + nav.scrollLeft,
    y: rowRect.top - navRect.top + nav.scrollTop,
    w: rowRect.width,
    h: rowRect.height,
  };
}

function isReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 为侧栏导航注入 Magpie 风格的共享弹性滑块物理动效：
 * pointerdown 时立即从当前落点向目标项发射阻尼弹簧，离开或取消时回弹至当前激活项，
 * 路由变化保持弹簧状态连续，进入侧栏外路由（如 /settings）时平滑淡出。
 */
export function useSidebarGlide(
  navRef: RefObject<HTMLElement | null>,
  pillRef: RefObject<HTMLSpanElement | null>,
  path: string,
  rail: boolean,
  ready = true,
) {
  const controllerRef = useRef<{
    settle: (snap?: boolean) => void;
  } | null>(null);
  const prevRailRef = useRef(rail);

  useEffect(() => {
    if (!ready) return;
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;

    const omega = (2 * Math.PI) / NAV_SPRING.response;
    const stiffness = omega * omega;
    const damping = (4 * Math.PI * NAV_SPRING.damping) / NAV_SPRING.response;

    let currentX = 0;
    let currentY = 0;
    let currentW = 0;
    let currentH = 0;
    let targetY = 0;
    let velocityY = 0;
    let lastTime = 0;
    let rafId = 0;
    let hideTimer = 0;
    let fallbackTimer = 0;
    let initialized = false;
    let pressing = false;

    const findActiveRow = () =>
      nav.querySelector<HTMLAnchorElement>(ACTIVE_LINK_SELECTOR);

    const applyTransform = () => {
      pill.style.width = `${currentW}px`;
      pill.style.height = `${currentH}px`;
      pill.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    };

    const showPill = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
      }
      pill.hidden = false;
      pill.dataset.state = "visible";
      nav.setAttribute("data-glide", "on");
    };

    const hidePill = (immediate: boolean) => {
      nav.removeAttribute("data-glide");
      pill.dataset.state = "hidden";
      initialized = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      velocityY = 0;
      if (immediate || isReducedMotion()) {
        pill.hidden = true;
        return;
      }
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        pill.hidden = true;
        hideTimer = 0;
      }, 160);
    };

    const snapTo = (row: HTMLElement) => {
      const m = measureRow(nav, row);
      if (m.w <= 0 || m.h <= 0) return;
      currentX = m.x;
      currentY = m.y;
      currentW = m.w;
      currentH = m.h;
      targetY = m.y;
      velocityY = 0;
      initialized = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      showPill();
      applyTransform();
    };

    const step = (now: number) => {
      const dt = lastTime
        ? Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
        : 1 / 60;
      lastTime = now;

      const subSteps = 4;
      const h = dt / subSteps;
      for (let i = 0; i < subSteps; i++) {
        const acc = stiffness * (targetY - currentY) - damping * velocityY;
        velocityY += acc * h;
        currentY += velocityY * h;
      }

      if (Math.abs(targetY - currentY) < 0.08 && Math.abs(velocityY) < 0.5) {
        currentY = targetY;
        velocityY = 0;
        applyTransform();
        rafId = 0;
        return;
      }

      applyTransform();
      rafId = requestAnimationFrame(step);
    };

    const glideTo = (row: HTMLElement) => {
      const m = measureRow(nav, row);
      if (m.w <= 0 || m.h <= 0) return;

      if (!initialized || isReducedMotion()) {
        snapTo(row);
        return;
      }

      currentX = m.x;
      currentW = m.w;
      currentH = m.h;
      targetY = m.y;
      showPill();
      applyTransform();

      if (!rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(step);
      }
    };

    const settleToActive = (snap = false) => {
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = 0;
      }
      const active = findActiveRow();
      if (!active) {
        hidePill(!initialized);
        return;
      }
      if (snap) {
        snapTo(active);
      } else {
        glideTo(active);
      }
    };

    controllerRef.current = { settle: settleToActive };

    // 首次挂载立即贴合激活项
    settleToActive(true);

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = (e.target as Element | null)?.closest<HTMLAnchorElement>(
        "a",
      );
      if (!target || !nav.contains(target)) return;
      pressing = true;
      glideTo(target);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (!pressing || (e.buttons & 1) === 0) return;
      const target = (e.target as Element | null)?.closest<HTMLAnchorElement>(
        "a",
      );
      if (!target || !nav.contains(target)) return;
      glideTo(target);
    };

    const onPointerLeave = () => {
      if (!pressing) return;
      settleToActive(false);
    };

    const onPointerCancel = () => {
      pressing = false;
      settleToActive(false);
    };

    const onWindowPointerUp = () => {
      if (!pressing) return;
      pressing = false;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = 0;
        settleToActive(false);
      }, 180);
    };

    nav.addEventListener("pointerdown", onPointerDown);
    nav.addEventListener("pointerover", onPointerOver);
    nav.addEventListener("pointerleave", onPointerLeave);
    nav.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("pointerup", onWindowPointerUp);

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            settleToActive(true);
          })
        : null;
    observer?.observe(nav);

    return () => {
      controllerRef.current = null;
      if (rafId) cancelAnimationFrame(rafId);
      if (hideTimer) window.clearTimeout(hideTimer);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      observer?.disconnect();
      nav.removeEventListener("pointerdown", onPointerDown);
      nav.removeEventListener("pointerover", onPointerOver);
      nav.removeEventListener("pointerleave", onPointerLeave);
      nav.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
  }, [navRef, pillRef, ready]);

  useEffect(() => {
    if (!ready) return;
    const railChanged = prevRailRef.current !== rail;
    prevRailRef.current = rail;
    const raf = requestAnimationFrame(() => {
      controllerRef.current?.settle(railChanged);
    });
    return () => cancelAnimationFrame(raf);
  }, [path, rail, ready]);
}
