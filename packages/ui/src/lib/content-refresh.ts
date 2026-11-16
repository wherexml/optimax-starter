import { refreshBrand } from "./refresh-brand";

export type SkeletonLayout = "dashboard" | "table";
export interface ContentRefreshOptions {
  layout?: SkeletonLayout;
  label?: string;
  logoSrc?: string;
  delay?: number;
}
let sequence = 0;

/** DOM-only renderer: the same mark and skeleton can be used without React. */
export function createRefreshVisual(options: ContentRefreshOptions = {}) {
  const id = `om-refresh-${++sequence}`;
  const el = document.createElement("div");
  el.className = "om-refresh-visual";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<span class="om-refresh-sr"></span>
    <div class="om-skeleton" aria-hidden="true" data-layout="${options.layout === "table" ? "table" : "dashboard"}">
      <div class="om-skeleton-heading"><i class="om-bone om-bone-title"></i><i class="om-bone om-bone-action"></i></div>
      <div class="om-skeleton-metrics">${Array.from({ length: 4 }, () => '<div><i class="om-bone om-bone-label"></i><i class="om-bone om-bone-value"></i></div>').join("")}</div>
      <div class="om-skeleton-table">${Array.from({ length: 8 }, () => `<div>${Array.from({ length: 5 }, () => '<i class="om-bone"></i>').join("")}</div>`).join("")}</div>
      <div class="om-skeleton-sweep"></div>
    </div>
    <div class="om-refresh-indicator" aria-hidden="true"><svg class="om-refresh-brand" viewBox="0 0 256 256">
      <defs><image id="${id}" width="256" height="256"/>${["M128 128 0 0H256Z", "M128 128 256 0V256Z", "M128 128 256 256H0Z", "M128 128 0 256V0Z"].map((d, i) => `<clipPath id="${id}-${i}"><path d="${d}"/></clipPath>`).join("")}</defs>
      ${[[0, -9], [9, 0], [0, 9], [-9, 0]].map(([x, y], i) => `<g class="om-refresh-petal" style="--petal-x:${x}px;--petal-y:${y}px"><g clip-path="url(#${id}-${i})"><use href="#${id}"/></g></g>`).join("")}
    </svg></div>`;
  el.querySelector("image")!.setAttribute("href", options.logoSrc || refreshBrand);
  el.querySelector(".om-refresh-sr")!.textContent = options.label || "正在刷新内容";
  return el;
}

/** Keeps the content mounted. Only this boundary is hidden and inert while loading. */
export function createContentRefresh(host: HTMLElement, options: ContentRefreshOptions = {}) {
  const visual = createRefreshVisual(options);
  const priorBusy = host.getAttribute("aria-busy");
  const ownClass = !host.classList.contains("om-refresh-host");
  host.classList.add("om-refresh-host");
  visual.classList.add("om-refresh-overlay");
  visual.hidden = true;
  host.append(visual);
  let busy = false, disposed = false, visible = false;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let animations: Animation[] = [];
  let focused: HTMLElement | null = null;
  const saved = new Map<HTMLElement, { inert: boolean; hidden: string | null }>();
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function position() {
    if (!visible || disposed) return;
    const rect = host.getBoundingClientRect();
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = host.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
        const box = parent.getBoundingClientRect();
        top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
      }
    }
    visual.style.top = `${Math.max(0, top - rect.top)}px`;
    visual.style.height = `${Math.max(0, bottom - top)}px`;
  }
  function schedulePosition() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  }
  function restore() {
    saved.forEach((value, node) => {
      node.inert = value.inert;
      if (value.hidden === null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", value.hidden);
    });
    saved.clear();
    delete host.dataset.refreshVisible;
    if (priorBusy === null) host.removeAttribute("aria-busy");
    else host.setAttribute("aria-busy", priorBusy);
    if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
    focused = null;
  }
  function cancelMotion() {
    clearTimeout(finishTimer);
    animations.forEach(animation => animation.cancel());
    animations = [];
    delete visual.dataset.settling;
  }
  function hide() {
    cancelMotion(); visible = false; visual.hidden = true; restore();
  }
  function show() {
    if (!busy || disposed) return;
    visible = true;
    focused = host.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const child of host.children) {
      if (!(child instanceof HTMLElement) || child === visual) continue;
      saved.set(child, { inert: child.inert, hidden: child.getAttribute("aria-hidden") });
      child.inert = true; child.setAttribute("aria-hidden", "true");
    }
    host.dataset.refreshVisible = "true";
    visual.hidden = false;
    visual.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 0; });
    position();
  }
  function settle() {
    if (reduced()) { hide(); return; }
    visual.dataset.settling = "true";
    const brand = visual.querySelector<SVGSVGElement>(".om-refresh-brand")!;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(brand).transform);
    const angle = (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
    const target = Math.ceil((angle - .05) / 90) * 90;
    const timing: KeyframeAnimationOptions = { duration: 220, easing: "cubic-bezier(.25,0,.15,1)", fill: "forwards" };
    animations.push(brand.animate([{ transform: `rotate(${angle}deg)` }, { transform: `rotate(${target}deg)` }], timing));
    visual.querySelectorAll<SVGGElement>(".om-refresh-petal").forEach(petal => {
      animations.push(petal.animate([{ transform: getComputedStyle(petal).transform }, { transform: "translate(0,0)" }], timing));
    });
    finishTimer = setTimeout(hide, 220);
  }
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(host);
  window.addEventListener("resize", schedulePosition);
  window.addEventListener("scroll", schedulePosition, true);
  return {
    setBusy(next: boolean) {
      if (disposed || next === busy) return;
      busy = next;
      clearTimeout(delayTimer);
      if (busy) {
        host.setAttribute("aria-busy", "true");
        cancelMotion();
        if (!visible) delayTimer = setTimeout(show, options.delay ?? 120);
      } else if (visible) settle();
      else restore();
    },
    destroy() {
      disposed = true; clearTimeout(delayTimer); hide();
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      visual.remove(); if (ownClass) host.classList.remove("om-refresh-host");
    },
  };
}
