import type {
  AssetGraphDomainDto,
  AssetGraphEdge,
  AssetGraphNode,
  AssetSubgraphDto,
  AssetSubgraphPath,
  AssetTopologyResponse,
} from "@optimax-starter/api";
import {
  ChevronDown,
  ChevronUp,
  Expand,
  Focus,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AssetDomainDot,
  AssetShapeGlyph,
  addAssetShapeToPath,
  GRAPH_BRAND_COLOR,
  GRAPH_DOWNSTREAM_COLOR,
  GRAPH_INFRA_COLOR,
  GRAPH_TEAM_COLOR,
  GRAPH_UPSTREAM_COLOR,
  getAssetVisual,
  LEGEND_NODE_TYPES,
  resolveVisualKey,
  stageBadgeVariant,
} from "./asset-graph-visuals";

const GRID_CELL = 44;
const MIN_SCALE = 0.18;
const MAX_SCALE = 6.5;
const OVERVIEW_PAD = 44;
const BG_LABEL_MIN_SCALE = 1.25;
const BG_LABEL_LIMIT = 40;
const FONT_FAMILY = 'Inter, "PingFang SC", sans-serif';

export interface AssetGraphFocusTarget {
  id: string;
  nonce: number;
}

interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

interface DomainCapsule {
  key: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  anchorNode: AssetGraphNode;
}

type CameraIntent = "auto" | "focus" | "user";

type DragState =
  | {
      mode: "pan";
      moved: boolean;
      startX: number;
      startY: number;
      origTx: number;
      origTy: number;
    }
  | {
      mode: "node";
      nodeId: string;
      moved: boolean;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    };

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function isDomainAnchor(node: AssetGraphNode | null | undefined): boolean {
  return node?.objectType === "DomainAnchor";
}

function edgeStrokeColor(
  edge: AssetGraphEdge,
  seedNodeId: string | undefined,
  nodeRoles: AssetSubgraphDto["nodeRoles"] | undefined,
): string {
  if (edge.linkType === "GOVERNED_BY") return GRAPH_TEAM_COLOR;
  if (edge.linkType === "INFRA_DEPENDENCY") return GRAPH_INFRA_COLOR;
  if (seedNodeId && edge.targetId === seedNodeId) return GRAPH_UPSTREAM_COLOR;
  if (seedNodeId && edge.sourceId === seedNodeId) return GRAPH_DOWNSTREAM_COLOR;
  if (nodeRoles?.[edge.sourceId] === "upstream") return GRAPH_UPSTREAM_COLOR;
  return GRAPH_DOWNSTREAM_COLOR;
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  targetRadius: number,
  size: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < targetRadius + size * 2) return;
  const ux = dx / len;
  const uy = dy / len;
  const tipX = x2 - ux * targetRadius;
  const tipY = y2 - uy * targetRadius;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const perpX = -uy * (size * 0.5);
  const perpY = ux * (size * 0.5);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX, baseY + perpY);
  ctx.lineTo(baseX - perpX, baseY - perpY);
  ctx.closePath();
  ctx.fill();
}

function fitCamera(
  w: number,
  h: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  padPx: number,
  minScale: number,
  maxScale: number,
): Camera {
  const spanW = Math.max(1, box.maxX - box.minX);
  const spanH = Math.max(1, box.maxY - box.minY);
  const scale = clamp(
    Math.min((w - padPx * 2) / spanW, (h - padPx * 2) / spanH),
    minScale,
    maxScale,
  );
  return {
    scale,
    tx: w / 2 - ((box.minX + box.maxX) / 2) * scale,
    ty: h / 2 - ((box.minY + box.maxY) / 2) * scale,
  };
}

export function AssetSuperGraphCanvas({
  topology,
  subgraph,
  spotlight,
  onToggleSpotlight,
  selectedNodeId,
  onSelectNode,
  onDoubleClickAsset,
  focusTarget,
  activePath,
  expanded = false,
  onToggleExpand,
}: {
  topology: AssetTopologyResponse;
  subgraph?: AssetSubgraphDto | null;
  spotlight: boolean;
  onToggleSpotlight?: () => void;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  onDoubleClickAsset?: (assetId: number) => void;
  focusTarget?: AssetGraphFocusTarget | null;
  activePath?: AssetSubgraphPath | null;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 760, height: 500 });
  const [hovered, setHovered] = useState<{
    node: AssetGraphNode;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(40);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [customPositions, setCustomPositions] = useState<Record<string, { x: number; y: number }>>(
    {},
  );

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const focusTargetRef = useRef(focusTarget);
  focusTargetRef.current = focusTarget;
  const customPosRef = useRef<Record<string, { x: number; y: number }>>(customPositions);
  customPosRef.current = customPositions;

  const cameraRef = useRef<Camera>({ scale: 0.4, tx: 40, ty: 20 });
  const animRef = useRef<{
    from: Camera;
    to: Camera;
    start: number;
    duration: number;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pulsePhaseRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);
  const capsulesRef = useRef<DomainCapsule[]>([]);
  const intentRef = useRef<CameraIntent>("auto");
  const prevContentKeyRef = useRef<string | null>(null);
  const lastReportedZoomRef = useRef(40);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const scheduleDraw = useCallback(() => scheduleDrawRef.current(), []);

  const syncZoomIndicator = useCallback((scale: number) => {
    const pct = Math.max(1, Math.round(scale * 100));
    if (pct !== lastReportedZoomRef.current) {
      lastReportedZoomRef.current = pct;
      setZoomPercent(pct);
    }
  }, []);

  const posOf = useCallback((node: AssetGraphNode): { x: number; y: number } => {
    const custom = customPosRef.current[node.id];
    return custom ?? { x: node.x, y: node.y };
  }, []);

  // Build spatial index, domain sectors, and batched Path2Ds (reacts cleanly to topology & dragged nodes)
  const graphCache = useMemo(() => {
    const nodeMap = new Map<string, AssetGraphNode>();
    const domainMap = new Map<string, AssetGraphDomainDto>();
    const spatial = new Map<string, AssetGraphNode[]>();
    const visualNodePaths = new Map<string, Path2D>();
    const domainNodePaths = new Map<string, Path2D>();
    const domainEdgePaths = new Map<string, Path2D>();
    const anchorRayPaths = new Map<string, Path2D>();
    const inEdges = new Map<string, AssetGraphEdge[]>();
    const outEdges = new Map<string, AssetGraphEdge[]>();
    const memberBounds = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    const world = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const grow = (minX: number, minY: number, maxX: number, maxY: number) => {
      if (minX < world.minX) world.minX = minX;
      if (minY < world.minY) world.minY = minY;
      if (maxX > world.maxX) world.maxX = maxX;
      if (maxY > world.maxY) world.maxY = maxY;
    };

    for (const dom of topology.domains) {
      domainMap.set(dom.key, dom);
      domainNodePaths.set(dom.key, new Path2D());
      domainEdgePaths.set(dom.key, new Path2D());
      anchorRayPaths.set(dom.key, new Path2D());
    }

    const getCoord = (n: AssetGraphNode) => customPositions[n.id] ?? { x: n.x, y: n.y };

    for (const rawNode of topology.nodes) {
      const coord = getCoord(rawNode);
      const n = coord.x === rawNode.x && coord.y === rawNode.y ? rawNode : { ...rawNode, ...coord };
      nodeMap.set(n.id, n);
      if (n.objectType === "DomainAnchor") {
        grow(n.x - 135, n.y - 24, n.x + 135, n.y + 24);
        continue;
      }
      grow(n.x, n.y, n.x, n.y);

      const cellKey = `${Math.floor(n.x / GRID_CELL)},${Math.floor(n.y / GRID_CELL)}`;
      const bucket = spatial.get(cellKey);
      if (bucket) bucket.push(n);
      else spatial.set(cellKey, [n]);

      const vKey = resolveVisualKey(n);
      const visual = getAssetVisual(vKey);
      let vPath = visualNodePaths.get(vKey);
      if (!vPath) {
        vPath = new Path2D();
        visualNodePaths.set(vKey, vPath);
      }
      addAssetShapeToPath(vPath, visual.shape, n.x, n.y, visual.radius);

      const dPath = domainNodePaths.get(n.domain);
      if (dPath) addAssetShapeToPath(dPath, visual.shape, n.x, n.y, visual.radius);

      const mb = memberBounds.get(n.domain);
      if (!mb) {
        memberBounds.set(n.domain, { minX: n.x, minY: n.y, maxX: n.x, maxY: n.y });
      } else {
        if (n.x < mb.minX) mb.minX = n.x;
        if (n.y < mb.minY) mb.minY = n.y;
        if (n.x > mb.maxX) mb.maxX = n.x;
        if (n.y > mb.maxY) mb.maxY = n.y;
      }
    }

    for (const e of topology.edges) {
      const s = nodeMap.get(e.sourceId);
      const t = nodeMap.get(e.targetId);
      if (!s || !t) continue;
      if (e.linkType === "ANCHORS_DOMAIN") {
        const anchor = s.objectType === "DomainAnchor" ? s : t;
        const ray = anchorRayPaths.get(anchor.domain);
        if (ray) {
          ray.moveTo(s.x, s.y);
          ray.lineTo(t.x, t.y);
        }
        continue;
      }
      const p = domainEdgePaths.get(s.domain);
      if (p) {
        p.moveTo(s.x, s.y);
        p.lineTo(t.x, t.y);
      }
      const outs = outEdges.get(e.sourceId);
      if (outs) outs.push(e);
      else outEdges.set(e.sourceId, [e]);
      const ins = inEdges.get(e.targetId);
      if (ins) ins.push(e);
      else inEdges.set(e.targetId, [e]);
    }

    const sectorBounds = new Map<string, { cx: number; cy: number; rx: number; ry: number }>();
    for (const [key, mb] of memberBounds) {
      const sector = {
        cx: (mb.minX + mb.maxX) / 2,
        cy: (mb.minY + mb.maxY) / 2,
        rx: Math.max(150, (mb.maxX - mb.minX) / 2 + 52),
        ry: Math.max(115, (mb.maxY - mb.minY) / 2 + 44),
      };
      sectorBounds.set(key, sector);
      grow(
        sector.cx - sector.rx,
        sector.cy - sector.ry,
        sector.cx + sector.rx,
        sector.cy + sector.ry,
      );
    }

    if (!Number.isFinite(world.minX)) {
      world.minX = 0;
      world.minY = 0;
      world.maxX = topology.world.width;
      world.maxY = topology.world.height;
    }

    return {
      nodeMap,
      domainMap,
      spatial,
      visualNodePaths,
      domainNodePaths,
      domainEdgePaths,
      anchorRayPaths,
      inEdges,
      outEdges,
      sectorBounds,
      world,
    };
  }, [topology, customPositions]);

  const highlightSets = useMemo(() => {
    const active = Boolean(spotlight && subgraph && subgraph.nodeIds.length > 0);
    const nodeIds = new Set(active && subgraph ? subgraph.nodeIds : []);
    const edgeIds = new Set(active && subgraph ? subgraph.edgeIds : []);
    return { active, nodeIds, edgeIds };
  }, [spotlight, subgraph]);

  const subgraphEdges = useMemo(() => {
    if (!highlightSets.active) return [];
    return topology.edges.filter((e) => highlightSets.edgeIds.has(e.id));
  }, [topology.edges, highlightSets]);

  const subgraphNodes = useMemo(() => {
    if (!highlightSets.active) return [];
    const out: AssetGraphNode[] = [];
    for (const id of highlightSets.nodeIds) {
      const node = graphCache.nodeMap.get(id);
      if (node) out.push(node);
    }
    return out;
  }, [graphCache.nodeMap, highlightSets]);

  const pathSets = useMemo(() => {
    if (!highlightSets.active || !activePath || !activePath.nodeIds.length) return null;
    const nodeOrder = new Map<string, number>();
    activePath.nodeIds.forEach((id, idx) => {
      if (!nodeOrder.has(id)) nodeOrder.set(id, idx + 1);
    });
    const edgeOrder = new Map<string, number>();
    activePath.edgeIds.forEach((id, idx) => {
      if (!edgeOrder.has(id)) edgeOrder.set(id, idx);
    });
    return {
      id: activePath.id,
      nodeOrder,
      edgeOrder,
      totalEdges: Math.max(1, activePath.edgeIds.length),
    };
  }, [highlightSets.active, activePath]);

  const computeOverviewCamera = useCallback(
    (w: number, h: number): Camera =>
      fitCamera(w, h, graphCache.world, OVERVIEW_PAD, MIN_SCALE, 1.5),
    [graphCache.world],
  );

  const computeSubgraphCamera = useCallback(
    (w: number, h: number, nodes: readonly AssetGraphNode[]): Camera => {
      if (!nodes.length) return computeOverviewCamera(w, h);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        const p = posOf(n);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const spanW = Math.max(260, maxX - minX + 190);
      const spanH = Math.max(200, maxY - minY + 150);
      const scale = clamp(Math.min((w - 72) / spanW, (h - 84) / spanH), 0.3, 1.65);
      return {
        scale,
        tx: w / 2 - ((minX + maxX) / 2) * scale,
        ty: h / 2 - ((minY + maxY) / 2) * scale,
      };
    },
    [computeOverviewCamera, posOf],
  );

  const computeFocusCamera = useCallback(
    (w: number, h: number, nodeId: string): Camera | null => {
      const node = graphCache.nodeMap.get(nodeId);
      if (!node) return null;
      if (node.objectType === "DomainAnchor") {
        const sector = graphCache.sectorBounds.get(node.domain);
        if (!sector) return null;
        return fitCamera(
          w,
          h,
          {
            minX: Math.min(sector.cx - sector.rx, node.x - 120),
            minY: Math.min(sector.cy - sector.ry, node.y - 26),
            maxX: Math.max(sector.cx + sector.rx, node.x + 120),
            maxY: sector.cy + sector.ry,
          },
          40,
          0.3,
          3.2,
        );
      }
      const scale = clamp(Math.max(cameraRef.current.scale, 1.45), 1.15, MAX_SCALE);
      return { scale, tx: w / 2 - node.x * scale, ty: h / 2 - node.y * scale };
    },
    [graphCache],
  );

  const animateToCamera = useCallback(
    (target: Camera, duration = 380) => {
      animRef.current = {
        from: { ...cameraRef.current },
        to: target,
        start: performance.now(),
        duration,
      };
      syncZoomIndicator(target.scale);
      scheduleDraw();
    },
    [scheduleDraw, syncZoomIndicator],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width > 0 && height > 0) {
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  // Auto-frame spotlight or overview when subgraph target/mode/size changes cleanly
  const spotlightNodesRef = useRef<{ active: boolean; seedId: string; nodes: AssetGraphNode[] }>({
    active: false,
    seedId: "",
    nodes: [],
  });
  spotlightNodesRef.current = {
    active: highlightSets.active,
    seedId: subgraph?.seedNodeId ?? "",
    nodes: subgraphNodes,
  };

  const contentKey = `${highlightSets.active ? 1 : 0}|${subgraph?.seedNodeId ?? ""}|${subgraph?.direction ?? ""}|${subgraph?.nodeIds.length ?? 0}`;
  useEffect(() => {
    const contentChanged = prevContentKeyRef.current !== contentKey;
    prevContentKeyRef.current = contentKey;
    if (!contentChanged) {
      if (intentRef.current === "user") {
        scheduleDraw();
        return;
      }
      const focus = focusTargetRef.current;
      if (intentRef.current === "focus" && focus) {
        const cam = computeFocusCamera(size.width, size.height, focus.id);
        if (cam) {
          animateToCamera(cam, 260);
          return;
        }
      }
    }
    intentRef.current = "auto";
    const { active, nodes } = spotlightNodesRef.current;
    if (active && nodes.length) {
      animateToCamera(computeSubgraphCamera(size.width, size.height, nodes), 420);
    } else {
      animateToCamera(computeOverviewCamera(size.width, size.height), 360);
    }
  }, [
    contentKey,
    size.width,
    size.height,
    animateToCamera,
    computeFocusCamera,
    computeOverviewCamera,
    computeSubgraphCamera,
    scheduleDraw,
  ]);

  const focusId = focusTarget?.id;
  const focusNonce = focusTarget?.nonce;
  useEffect(() => {
    if (!focusId || focusNonce === undefined) return;
    const cam = computeFocusCamera(sizeRef.current.width, sizeRef.current.height, focusId);
    if (!cam) return;
    intentRef.current = "focus";
    animateToCamera(cam, 420);
  }, [focusId, focusNonce, computeFocusCamera, animateToCamera]);

  const activePathKey = activePath ? `${activePath.id}:${activePath.nodeIds.join(",")}` : "";
  useEffect(() => {
    if (!activePath || !activePath.nodeIds.length) return;
    const pts = activePath.nodeIds
      .map((id) => graphCache.nodeMap.get(id))
      .filter((n): n is AssetGraphNode => Boolean(n));
    if (!pts.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    intentRef.current = "focus";
    animateToCamera(
      fitCamera(
        sizeRef.current.width,
        sizeRef.current.height,
        { minX, minY, maxX, maxY },
        84,
        0.35,
        2.2,
      ),
      400,
    );
  }, [activePathKey, activePath, graphCache.nodeMap, animateToCamera]);

  // High-DPI Canvas2D render loop (pulse animation + smooth camera tween + interactive node dragging)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.max(1, Math.floor(size.width * dpr));
    const pixelH = Math.max(1, Math.floor(size.height * dpr));
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;

    const selNode = selectedNodeId ? graphCache.nodeMap.get(selectedNodeId) : undefined;
    const selDomainKey = selNode && isDomainAnchor(selNode) ? selNode.domain : null;
    const selEntity = selNode && !isDomainAnchor(selNode) ? selNode : null;
    const selIns = selEntity ? (graphCache.inEdges.get(selEntity.id) ?? []) : [];
    const selOuts = selEntity ? (graphCache.outEdges.get(selEntity.id) ?? []) : [];
    const neighborIds = new Set<string>();
    for (const e of selIns) neighborIds.add(e.sourceId);
    for (const e of selOuts) neighborIds.add(e.targetId);
    if (selEntity) neighborIds.delete(selEntity.id);

    let rafId = 0;
    let alive = true;

    const renderFrame = (now: number) => {
      rafId = 0;
      if (!alive) return;

      let needsMoreFrames = false;
      const anim = animRef.current;
      if (anim) {
        const t = anim.duration <= 0 ? 1 : clamp((now - anim.start) / anim.duration, 0, 1);
        const ease = 1 - (1 - t) ** 3;
        cameraRef.current = {
          scale: anim.from.scale + (anim.to.scale - anim.from.scale) * ease,
          tx: anim.from.tx + (anim.to.tx - anim.from.tx) * ease,
          ty: anim.from.ty + (anim.to.ty - anim.from.ty) * ease,
        };
        syncZoomIndicator(cameraRef.current.scale);
        if (t < 1) needsMoreFrames = true;
        else animRef.current = null;
      }

      const spot = highlightSets.active;
      if (spot) {
        pulsePhaseRef.current = (now / 1500) % 1;
        needsMoreFrames = true;
      }

      const cam = cameraRef.current;
      const px = 1 / cam.scale;
      const labelPx = (base: number) =>
        clamp(base * (0.55 + cam.scale * 0.5), base * 0.78, base) * px;

      const isDark = document.documentElement.classList.contains("dark");
      const bgColor = isDark ? "#141413" : "#fcfcfb";
      const fgColor = isDark ? "#eeeeec" : "#21201c";
      const mutedColor = isDark ? "#9a9891" : "#63635e";
      const cardBg = isDark ? "rgba(25,25,24,0.94)" : "rgba(255,255,255,0.94)";
      const hairline = isDark ? "rgba(255,255,255,0.22)" : "rgba(33,32,28,0.18)";

      const hovNode = hoveredIdRef.current
        ? graphCache.nodeMap.get(hoveredIdRef.current)
        : undefined;
      const hovDomainKey = hovNode && isDomainAnchor(hovNode) ? hovNode.domain : null;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size.width, size.height);

      // Subtle architectural dot grid
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.045)" : "rgba(33,32,28,0.045)";
      const gridStep = 28;
      for (let gx = ((cam.tx % gridStep) + gridStep) % gridStep; gx < size.width; gx += gridStep) {
        for (
          let gy = ((cam.ty % gridStep) + gridStep) % gridStep;
          gy < size.height;
          gy += gridStep
        ) {
          ctx.fillRect(gx, gy, 1, 1);
        }
      }

      ctx.translate(cam.tx, cam.ty);
      ctx.scale(cam.scale, cam.scale);

      const viewMinX = -cam.tx * px;
      const viewMinY = -cam.ty * px;
      const viewMaxX = (size.width - cam.tx) * px;
      const viewMaxY = (size.height - cam.ty) * px;

      // 1. Domain sector soft halos
      for (const dom of topology.domains) {
        const bounds = graphCache.sectorBounds.get(dom.key);
        if (!bounds) continue;
        const domColor = dom.color || GRAPH_BRAND_COLOR;
        const isSel = dom.key === selDomainKey;
        ctx.save();
        ctx.globalAlpha = isSel ? 0.13 : spot ? 0.045 : 0.075;
        ctx.fillStyle = domColor;
        ctx.beginPath();
        ctx.ellipse(bounds.cx, bounds.cy, bounds.rx, bounds.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = isSel ? 0.88 : dom.key === hovDomainKey ? 0.52 : spot ? 0.16 : 0.28;
        ctx.strokeStyle = domColor;
        ctx.lineWidth = (isSel ? 1.8 : 1.05) * px;
        ctx.setLineDash(isSel ? [] : [8 * px, 6 * px]);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Background edges batched by domain
      ctx.save();
      const bgScreenPx = clamp(0.32 + cam.scale * 0.12, 0.32, 0.68);
      ctx.lineWidth = bgScreenPx * px;
      ctx.globalAlpha = spot ? 0.045 : 0.11;
      for (const [domKey, p] of graphCache.domainEdgePaths) {
        ctx.strokeStyle = graphCache.domainMap.get(domKey)?.color ?? mutedColor;
        ctx.stroke(p);
      }
      ctx.restore();

      // 3. Background nodes batched by visual kind
      ctx.save();
      ctx.globalAlpha = spot ? 0.18 : 0.9;
      for (const [vKey, p] of graphCache.visualNodePaths) {
        ctx.fillStyle = getAssetVisual(vKey).color;
        ctx.fill(p);
      }
      ctx.restore();

      // 3b. Selected domain highlights
      if (selDomainKey) {
        const members = graphCache.domainNodePaths.get(selDomainKey);
        const rays = graphCache.anchorRayPaths.get(selDomainKey);
        const domColor = graphCache.domainMap.get(selDomainKey)?.color ?? GRAPH_BRAND_COLOR;
        ctx.save();
        if (rays) {
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = domColor;
          ctx.lineWidth = 0.65 * px;
          ctx.setLineDash([3 * px, 4 * px]);
          ctx.stroke(rays);
          ctx.setLineDash([]);
        }
        if (members) {
          if (spot) {
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = domColor;
            ctx.fill(members);
          }
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 0.7 * px;
          ctx.stroke(members);
        }
        ctx.restore();
      }

      // 4. Micro labels when zoomed into a cluster
      if (cam.scale >= BG_LABEL_MIN_SCALE) {
        const cx = (viewMinX + viewMaxX) / 2;
        const cy = (viewMinY + viewMaxY) / 2;
        const candidates: Array<{ n: AssetGraphNode; rank: number }> = [];
        const gx0 = Math.floor(viewMinX / GRID_CELL);
        const gx1 = Math.floor(viewMaxX / GRID_CELL);
        const gy0 = Math.floor(viewMinY / GRID_CELL);
        const gy1 = Math.floor(viewMaxY / GRID_CELL);
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) {
            const bucket = graphCache.spatial.get(`${gx},${gy}`);
            if (!bucket) continue;
            for (const n of bucket) {
              if (n.x < viewMinX || n.x > viewMaxX || n.y < viewMinY || n.y > viewMaxY) continue;
              if (spot && highlightSets.nodeIds.has(n.id)) continue;
              if (n.id === selectedNodeId) continue;
              const vRadius = getAssetVisual(resolveVisualKey(n)).radius;
              const rank =
                (neighborIds.has(n.id) ? -1e6 : 0) - vRadius * 1e3 + Math.hypot(n.x - cx, n.y - cy);
              candidates.push({ n, rank });
            }
          }
        }
        candidates.sort((a, b) => a.rank - b.rank);
        const fz = 9.5 * px;
        const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
        ctx.save();
        ctx.font = `500 ${fz}px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.6 * px;
        ctx.strokeStyle = bgColor;
        ctx.globalAlpha = spot ? 0.72 : 0.95;
        for (const { n } of candidates) {
          if (placed.length >= BG_LABEL_LIMIT) break;
          const r = getAssetVisual(resolveVisualKey(n)).radius;
          const text = cam.scale >= 2.1 ? `${n.code} ${n.label.slice(0, 8)}` : n.code;
          const tw = ctx.measureText(text).width;
          const x1 = n.x - tw / 2 - 2 * px;
          const y1 = n.y + r * 1.25 + 2 * px;
          const x2 = x1 + tw + 4 * px;
          const y2 = y1 + fz + 2 * px;
          if (placed.some((b) => x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1)) continue;
          placed.push({ x1, y1, x2, y2 });
          ctx.strokeText(text, n.x, y1);
          ctx.fillStyle = neighborIds.has(n.id) ? fgColor : mutedColor;
          ctx.fillText(text, n.x, y1);
        }
        ctx.restore();
      }

      // 5. Domain title capsules (world rects recorded for hit testing)
      const capsules: DomainCapsule[] = [];
      ctx.save();
      const domFont = clamp(22 * cam.scale, 11.5, 14.5) * px;
      ctx.font = `600 ${domFont}px ${FONT_FAMILY}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (const dom of topology.domains) {
        const domNode = graphCache.nodeMap.get(`DOM:${dom.key}`);
        if (!domNode) continue;
        const domColor = dom.color || GRAPH_BRAND_COLOR;
        const isSel = dom.key === selDomainKey;
        const isHov = dom.key === hovDomainKey;
        const text = `${dom.label} (${dom.nodeCount})`;
        const tw = ctx.measureText(text).width;
        const padX = 9 * px;
        const boxH = domFont + 8 * px;
        const x = domNode.x - tw / 2 - padX;
        const y = domNode.y - boxH / 2;
        const w = tw + padX * 2;
        capsules.push({
          key: dom.key,
          minX: x,
          minY: y,
          maxX: x + w,
          maxY: y + boxH,
          anchorNode: domNode,
        });
        ctx.globalAlpha = isSel || isHov ? 1 : spot ? 0.68 : 0.95;
        ctx.beginPath();
        ctx.roundRect(x, y, w, boxH, 6 * px);
        ctx.fillStyle = cardBg;
        ctx.fill();
        if (isSel) {
          ctx.save();
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = domColor;
          ctx.fill();
          ctx.restore();
        }
        ctx.strokeStyle = domColor;
        ctx.lineWidth = (isSel ? 2.2 : isHov ? 1.6 : 1.1) * px;
        ctx.stroke();
        ctx.fillStyle = domColor;
        ctx.fillText(text, domNode.x, domNode.y);
      }
      ctx.restore();
      capsulesRef.current = capsules;

      const hiRadius = (n: AssetGraphNode) => {
        const isSeed = n.id === subgraph?.seedNodeId;
        const isTeam = n.objectType === "OwnerTeam";
        const base = isSeed ? 10 : n.id === selectedNodeId ? 9 : isTeam ? 8.2 : 6.4;
        return base / Math.max(0.65, cam.scale ** 0.75);
      };

      // 6. Spotlight subgraph layer
      if (spot && subgraph) {
        const pulse = pulsePhaseRef.current;
        const hiScreenPx = clamp(0.9 + cam.scale * 0.22, 0.9, 1.5);
        const pathScreenPx = clamp(1.6 + cam.scale * 0.3, 1.6, 2.2);
        const hasPath = Boolean(pathSets);

        // 6a. Highlighted edges + directional arrowheads + animated pulse particles
        for (const edge of subgraphEdges) {
          const s = graphCache.nodeMap.get(edge.sourceId);
          const t = graphCache.nodeMap.get(edge.targetId);
          if (!s || !t) continue;
          const pathEdgeIdx = pathSets?.edgeOrder.get(edge.id);
          const inActivePath = pathEdgeIdx !== undefined;
          const color = edgeStrokeColor(edge, subgraph.seedNodeId, subgraph.nodeRoles);

          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = (inActivePath ? pathScreenPx : hiScreenPx) * px;
          ctx.globalAlpha = hasPath
            ? inActivePath
              ? 0.96
              : 0.18
            : edge.linkType === "GOVERNED_BY"
              ? 0.55
              : 0.85;
          if (edge.linkType === "INFRA_DEPENDENCY") {
            ctx.setLineDash([4 * px, 3 * px]);
          }
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (!hasPath || inActivePath) {
            ctx.fillStyle = color;
            drawArrowHead(ctx, s.x, s.y, t.x, t.y, hiRadius(t) * 1.25 + px, 4.4 * px);
          }

          if (inActivePath && pathSets && pathEdgeIdx !== undefined) {
            const p =
              (pulse * pathSets.totalEdges - pathEdgeIdx + pathSets.totalEdges) %
              pathSets.totalEdges;
            if (p <= 1) {
              ctx.globalAlpha = 1;
              ctx.fillStyle = GRAPH_BRAND_COLOR;
              ctx.beginPath();
              ctx.arc(s.x + (t.x - s.x) * p, s.y + (t.y - s.y) * p, 3.3 * px, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (
            !hasPath &&
            (edge.linkType === "DATA_FLOW" || edge.linkType === "COLLABORATES_WITH")
          ) {
            ctx.globalAlpha = 0.82;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(s.x + (t.x - s.x) * pulse, s.y + (t.y - s.y) * pulse, 2.2 * px, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // 6b. Highlighted nodes (seed + team first so labels win collision checks)
        const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
        const sortedNodes = [...subgraphNodes].sort((a, b) => {
          const rank = (n: AssetGraphNode) =>
            n.id === subgraph.seedNodeId
              ? 0
              : pathSets?.nodeOrder.has(n.id)
                ? 1
                : n.id === selectedNodeId
                  ? 2
                  : n.objectType === "OwnerTeam"
                    ? 3
                    : 4;
          return rank(a) - rank(b);
        });

        for (const n of sortedNodes) {
          if (isDomainAnchor(n)) continue;
          const isSeed = n.id === subgraph.seedNodeId;
          const isSelected = n.id === selectedNodeId;
          const visual = getAssetVisual(resolveVisualKey(n));
          const r = hiRadius(n);
          const pathStep = pathSets?.nodeOrder.get(n.id);
          const dimmedByPath = hasPath && pathStep === undefined;

          ctx.save();
          if (isSeed && !dimmedByPath) {
            ctx.globalAlpha = 0.22 + 0.14 * Math.sin(now / 260);
            ctx.fillStyle = GRAPH_BRAND_COLOR;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 1.95, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.globalAlpha = dimmedByPath ? 0.35 : 1;
          ctx.fillStyle = isSeed ? GRAPH_BRAND_COLOR : visual.color;
          ctx.beginPath();
          addAssetShapeToPath(ctx, visual.shape, n.x, n.y, r);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.3 * px;
          ctx.stroke();

          if (pathStep !== undefined) {
            const stepR = 7 * px;
            const sx = n.x + r * 0.95;
            const sy = n.y - r * 0.95;
            ctx.globalAlpha = 1;
            ctx.fillStyle = GRAPH_BRAND_COLOR;
            ctx.beginPath();
            ctx.arc(sx, sy, stepR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1 * px;
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.font = `700 ${Math.round(9 * px * 100) / 100}px ${FONT_FAMILY}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(pathStep), sx, sy);
          }

          if (!isSelected) {
            const fz = labelPx(11);
            ctx.font = `${isSeed || pathStep !== undefined ? "600" : "500"} ${fz}px ${FONT_FAMILY}`;
            const shortText =
              n.objectType === "OwnerTeam"
                ? n.code
                : isSeed || n.objectType === "Asset"
                  ? `${n.code} ${n.label.slice(0, 12)}`
                  : n.code;
            const tw = ctx.measureText(shortText).width;
            const boxW = tw + 10 * px;
            const boxH = fz + 5 * px;
            const bx = n.x - boxW / 2;
            const by = n.y + r * 1.3 + 4 * px;
            const overlaps = placedBoxes.some(
              (b) => bx < b.x2 && bx + boxW > b.x1 && by < b.y2 && by + boxH > b.y1,
            );
            if (!overlaps || isSeed || pathStep !== undefined) {
              placedBoxes.push({ x1: bx, y1: by, x2: bx + boxW, y2: by + boxH });
              ctx.fillStyle = cardBg;
              ctx.strokeStyle =
                pathStep !== undefined ? GRAPH_BRAND_COLOR : isSeed ? GRAPH_BRAND_COLOR : hairline;
              ctx.lineWidth = (isSeed ? 1.2 : 0.8) * px;
              ctx.beginPath();
              ctx.roundRect(bx, by, boxW, boxH, 4 * px);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = fgColor;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(shortText, n.x, by + boxH / 2);
            }
          }
          ctx.restore();
        }
      }

      // 7. Independent selection layer (works for every node in the 1,000+ node universe)
      if (selEntity) {
        const inSubgraph = spot && highlightSets.nodeIds.has(selEntity.id);
        const visual = getAssetVisual(resolveVisualKey(selEntity));
        const total = selIns.length + selOuts.length;

        ctx.save();
        ctx.lineWidth = 1.05 * px;
        ctx.globalAlpha = total > 140 ? 0.36 : total > 45 ? 0.58 : 0.88;
        const strokeGroup = (edges: AssetGraphEdge[], color: string, incoming: boolean) => {
          if (!edges.length) return;
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (const e of edges) {
            const other = graphCache.nodeMap.get(incoming ? e.sourceId : e.targetId);
            if (!other) continue;
            ctx.moveTo(selEntity.x, selEntity.y);
            ctx.lineTo(other.x, other.y);
          }
          ctx.stroke();
        };
        strokeGroup(selIns, GRAPH_UPSTREAM_COLOR, true);
        strokeGroup(selOuts, GRAPH_DOWNSTREAM_COLOR, false);

        ctx.globalAlpha = 1;
        ctx.strokeStyle = bgColor;
        ctx.lineWidth = 0.8 * px;
        for (const id of neighborIds) {
          if (spot && highlightSets.nodeIds.has(id)) continue;
          const nb = graphCache.nodeMap.get(id);
          if (!nb || isDomainAnchor(nb)) continue;
          const nv = getAssetVisual(resolveVisualKey(nb));
          ctx.fillStyle = nv.color;
          ctx.beginPath();
          addAssetShapeToPath(ctx, nv.shape, nb.x, nb.y, Math.max(nv.radius * 1.2, 3.2 * px));
          ctx.fill();
          ctx.stroke();
        }

        if (total <= 60) {
          const arrow = 4.4 * px;
          const selR = Math.max(visual.radius * 1.5, 6.5 * px) + 5 * px;
          ctx.globalAlpha = 0.95;
          for (const e of selIns) {
            const other = graphCache.nodeMap.get(e.sourceId);
            if (!other) continue;
            ctx.fillStyle = GRAPH_UPSTREAM_COLOR;
            drawArrowHead(ctx, other.x, other.y, selEntity.x, selEntity.y, selR, arrow);
          }
          for (const e of selOuts) {
            const other = graphCache.nodeMap.get(e.targetId);
            if (!other) continue;
            ctx.fillStyle = GRAPH_DOWNSTREAM_COLOR;
            const nr = Math.max(getAssetVisual(resolveVisualKey(other)).radius * 1.2, 3.2 * px);
            drawArrowHead(ctx, selEntity.x, selEntity.y, other.x, other.y, nr * 1.3 + px, arrow);
          }
        }
        ctx.restore();

        // Selection ring + elevated title capsule
        const r = inSubgraph ? hiRadius(selEntity) : Math.max(visual.radius * 1.5, 6.5 * px);
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = GRAPH_BRAND_COLOR;
        ctx.beginPath();
        ctx.arc(selEntity.x, selEntity.y, r * 1.3 + 9 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!inSubgraph) {
          ctx.fillStyle = visual.color;
          ctx.beginPath();
          addAssetShapeToPath(ctx, visual.shape, selEntity.x, selEntity.y, r);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.3 * px;
          ctx.stroke();
        }
        ctx.strokeStyle = GRAPH_BRAND_COLOR;
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.arc(selEntity.x, selEntity.y, r * 1.3 + 4.5 * px, 0, Math.PI * 2);
        ctx.stroke();

        const name =
          selEntity.label && selEntity.label !== selEntity.code
            ? `${selEntity.code}  ${selEntity.label.length > 18 ? `${selEntity.label.slice(0, 18)}…` : selEntity.label}`
            : selEntity.code;
        const fz = 11.5 * px;
        ctx.font = `600 ${fz}px ${FONT_FAMILY}`;
        const tw = ctx.measureText(name).width;
        const boxW = tw + 14 * px;
        const boxH = fz + 8 * px;
        const bx = selEntity.x - boxW / 2;
        const byTop = selEntity.y - r * 1.3 - 9 * px - boxH;
        const hitsCapsule = capsulesRef.current.some(
          (c) =>
            bx < c.maxX + 6 * px &&
            bx + boxW > c.minX - 6 * px &&
            byTop < c.maxY + 6 * px &&
            byTop + boxH > c.minY - 6 * px,
        );
        const by =
          byTop < viewMinY + 34 * px || hitsCapsule ? selEntity.y + r * 1.3 + 8 * px : byTop;
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, boxH, 5 * px);
        ctx.fillStyle = cardBg;
        ctx.fill();
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
        ctx.fillStyle = fgColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name, selEntity.x, by + boxH / 2);
        ctx.restore();
      }

      // 8. Hover ring
      if (hovNode && !isDomainAnchor(hovNode) && hovNode.id !== selectedNodeId) {
        const inSubgraph = spot && highlightSets.nodeIds.has(hovNode.id);
        const r = inSubgraph
          ? hiRadius(hovNode) * 1.3
          : Math.max(getAssetVisual(resolveVisualKey(hovNode)).radius * 1.3, 3.2 * px);
        ctx.save();
        ctx.strokeStyle = fgColor;
        ctx.globalAlpha = 0.78;
        ctx.lineWidth = 1.25 * px;
        ctx.beginPath();
        ctx.arc(hovNode.x, hovNode.y, r + 3 * px, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      if (needsMoreFrames) schedule();
    };

    const schedule = () => {
      if (alive && !rafId) rafId = requestAnimationFrame(renderFrame);
    };
    scheduleDrawRef.current = schedule;
    schedule();

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      if (scheduleDrawRef.current === schedule) scheduleDrawRef.current = () => {};
    };
  }, [
    size,
    topology,
    graphCache,
    highlightSets,
    subgraphEdges,
    subgraphNodes,
    pathSets,
    activePath,
    subgraph,
    selectedNodeId,
    syncZoomIndicator,
  ]);

  const hitTest = useCallback(
    (clientX: number, clientY: number): AssetGraphNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      const wx = (clientX - rect.left - cam.tx) / cam.scale;
      const wy = (clientY - rect.top - cam.ty) / cam.scale;

      for (const c of capsulesRef.current) {
        if (wx >= c.minX && wx <= c.maxX && wy >= c.minY && wy <= c.maxY) return c.anchorNode;
      }

      const maxDist = 15 / cam.scale;
      const reach = Math.max(1, Math.ceil(maxDist / GRID_CELL));
      const gx = Math.floor(wx / GRID_CELL);
      const gy = Math.floor(wy / GRID_CELL);
      let best: AssetGraphNode | null = null;
      let bestScore = Infinity;
      for (let ox = -reach; ox <= reach; ox++) {
        for (let oy = -reach; oy <= reach; oy++) {
          const bucket = graphCache.spatial.get(`${gx + ox},${gy + oy}`);
          if (!bucket) continue;
          for (const n of bucket) {
            const dist = Math.hypot(n.x - wx, n.y - wy);
            if (dist > maxDist) continue;
            const screenDist = dist * cam.scale;
            const score =
              highlightSets.active && highlightSets.nodeIds.has(n.id) ? screenDist - 4 : screenDist;
            if (score < bestScore) {
              bestScore = score;
              best = n;
            }
          }
        }
      }
      return best;
    },
    [graphCache.spatial, highlightSets],
  );

  const clearHover = useCallback(() => {
    if (hoveredIdRef.current !== null) {
      hoveredIdRef.current = null;
      scheduleDraw();
    }
    setHovered((h) => (h ? null : h));
  }, [scheduleDraw]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number, duration = 140) => {
      const { width, height } = sizeRef.current;
      const ax = cx ?? width / 2;
      const ay = cy ?? height / 2;
      const base = animRef.current?.to ?? cameraRef.current;
      const nextScale = clamp(base.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / base.scale;
      intentRef.current = "user";
      animateToCamera(
        {
          scale: nextScale,
          tx: ax - (ax - base.tx) * ratio,
          ty: ay - (ay - base.ty) * ratio,
        },
        duration,
      );
    },
    [animateToCamera],
  );

  // Smooth cursor-anchored wheel / trackpad pinch zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 24;
      else if (e.deltaMode === 2) dy *= 240;
      if (e.ctrlKey) dy *= 3;
      const factor = Math.exp(-clamp(dy, -260, 260) * 0.0052);
      animRef.current = null;
      intentRef.current = "user";
      const cam = cameraRef.current;
      const nextScale = clamp(cam.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = nextScale / cam.scale;
      cameraRef.current = {
        scale: nextScale,
        tx: sx - (sx - cam.tx) * ratio,
        ty: sy - (sy - cam.ty) * ratio,
      };
      syncZoomIndicator(nextScale);
      hoveredIdRef.current = null;
      setHovered((h) => (h ? null : h));
      scheduleDrawRef.current();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [syncZoomIndicator]);

  const hoveredDomain = isDomainAnchor(hovered?.node)
    ? graphCache.domainMap.get(hovered?.node.domain ?? "")
    : undefined;
  const hoverBelow = hovered ? hovered.screenY < size.height * 0.55 : true;
  const customNodeCount = Object.keys(customPositions).length;

  return (
    <div
      ref={wrapRef}
      data-slot="asset-super-graph-canvas"
      className={cn(
        "relative w-full overflow-hidden rounded-lg border-[0.5px] border-border bg-card select-none transition-[height] duration-200",
        expanded ? "h-[560px] sm:h-[640px]" : "h-[460px] sm:h-[520px]",
      )}
    >
      <canvas
        ref={canvasRef}
        aria-label={`${subgraph?.seedNodeId ?? "资产"} 全域关联超大图画布`}
        className={cn(
          "block h-full w-full touch-none",
          draggingNodeId
            ? "cursor-grabbing"
            : hovered
              ? "cursor-pointer"
              : "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit && !isDomainAnchor(hit)) {
            dragRef.current = {
              mode: "node",
              nodeId: hit.id,
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
              origX: hit.x,
              origY: hit.y,
            };
          } else {
            dragRef.current = {
              mode: "pan",
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
              origTx: cameraRef.current.tx,
              origTy: cameraRef.current.ty,
            };
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (d) {
            const dx = e.clientX - d.startX;
            const dy = e.clientY - d.startY;
            if (!d.moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
            if (!d.moved) {
              d.moved = true;
              clearHover();
              if (d.mode === "node") setDraggingNodeId(d.nodeId);
            }
            animRef.current = null;
            intentRef.current = "user";
            if (d.mode === "node") {
              const scale = cameraRef.current.scale;
              const nextX = Number(
                clamp(d.origX + dx / scale, 48, topology.world.width - 48).toFixed(2),
              );
              const nextY = Number(
                clamp(d.origY + dy / scale, 64, topology.world.height - 48).toFixed(2),
              );
              setCustomPositions((prev) => ({
                ...prev,
                [d.nodeId]: { x: nextX, y: nextY },
              }));
            } else {
              cameraRef.current = {
                ...cameraRef.current,
                tx: d.origTx + dx,
                ty: d.origTy + dy,
              };
              scheduleDraw();
            }
            return;
          }

          const hit = hitTest(e.clientX, e.clientY);
          if (!hit) {
            clearHover();
            return;
          }
          if (hoveredIdRef.current !== hit.id) {
            hoveredIdRef.current = hit.id;
            scheduleDraw();
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setHovered({
            node: hit,
            screenX: e.clientX - rect.left,
            screenY: e.clientY - rect.top,
          });
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          setDraggingNodeId(null);
          if (d && !d.moved) {
            const hit = hitTest(e.clientX, e.clientY);
            if (hit && onSelectNode) onSelectNode(hit.id);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDraggingNodeId(null);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            clearHover();
          }
        }}
        onDoubleClick={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit?.objectType === "Asset" && hit.assetId && onDoubleClickAsset) {
            onDoubleClickAsset(hit.assetId);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(1.75, e.clientX - rect.left, e.clientY - rect.top, 160);
        }}
      />

      {/* Top HUD: Telemetry + Spotlight/Expand Controls */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col-reverse gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="bg-card/90 backdrop-blur-xs">
            全图 {topology.stats.nodeCount.toLocaleString()} 节点 /{" "}
            {topology.stats.edgeCount.toLocaleString()} 条连线
          </Badge>
          {highlightSets.active && subgraph ? (
            <Badge variant="brand" className="bg-card/95 backdrop-blur-xs">
              聚光灯高亮 {subgraph.stats.highlightedNodeCount} 节点 / 压缩{" "}
              {subgraph.stats.compressionRatio}%
            </Badge>
          ) : (
            <Badge variant="neutral" className="bg-card/90 backdrop-blur-xs">
              全域星云鸟瞰模式
            </Badge>
          )}
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center justify-end gap-1.5 self-end sm:self-auto">
          {onToggleSpotlight ? (
            <Button
              type="button"
              variant={spotlight ? "default" : "outline"}
              size="xs"
              aria-pressed={spotlight}
              className={spotlight ? "shadow-xs" : "bg-card/95 backdrop-blur-xs"}
              onClick={onToggleSpotlight}
            >
              <Sparkles className="size-3.5" />
              {spotlight ? "聚光灯：已开启" : "聚光灯：已关闭"}
            </Button>
          ) : null}
          {onToggleExpand ? (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="size-7 bg-card/95 backdrop-blur-xs"
              aria-pressed={expanded}
              aria-label={expanded ? "收起宽屏画布" : "宽屏展开画布"}
              title={expanded ? "收起宽屏画布" : "宽屏展开画布"}
              onClick={onToggleExpand}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Bottom-Left Camera & Layout Adjustment Controls */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
        {highlightSets.active && subgraphNodes.length ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="bg-card/95 backdrop-blur-xs"
            onClick={() => {
              intentRef.current = "auto";
              animateToCamera(computeSubgraphCamera(size.width, size.height, subgraphNodes), 380);
            }}
          >
            <Focus className="size-3.5" />
            聚焦子图
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="bg-card/95 backdrop-blur-xs"
          onClick={() => {
            intentRef.current = "auto";
            animateToCamera(computeOverviewCamera(size.width, size.height), 380);
          }}
        >
          <Expand className="size-3.5" />
          拉回全景
        </Button>

        <div className="inline-flex h-7 items-center rounded-md border-[0.5px] border-border bg-card/95 p-0.5 backdrop-blur-xs">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-6"
            aria-label="缩小画布"
            title="缩小画布 (支持滚轮缩放)"
            onClick={() => zoomAt(0.72)}
          >
            <Minus className="size-3.5" />
          </Button>
          <button
            type="button"
            aria-label="重置缩放为 100%"
            title="点击恢复 100% 比例"
            onClick={() => {
              const { width, height } = sizeRef.current;
              const focusNode = selectedNodeId
                ? graphCache.nodeMap.get(selectedNodeId)
                : subgraph?.seedNodeId
                  ? graphCache.nodeMap.get(subgraph.seedNodeId)
                  : undefined;
              const targetX = focusNode?.x ?? topology.world.width / 2;
              const targetY = focusNode?.y ?? topology.world.height / 2;
              intentRef.current = "user";
              animateToCamera({ scale: 1, tx: width / 2 - targetX, ty: height / 2 - targetY }, 280);
            }}
            className="min-w-[44px] px-1.5 text-center font-mono text-[11px] text-foreground tabular-nums hover:text-primary"
          >
            {zoomPercent}%
          </button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="size-6"
            aria-label="放大画布"
            title="放大画布 (支持滚轮或双击缩放)"
            onClick={() => zoomAt(1.4)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {customNodeCount > 0 ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="bg-card/95 backdrop-blur-xs"
            onClick={() => {
              setCustomPositions({});
              scheduleDraw();
            }}
          >
            <RotateCcw className="size-3" />
            重置位置 ({customNodeCount})
          </Button>
        ) : null}
      </div>

      {/* Bottom-Right Collapsible Legend */}
      <div className="absolute right-3 bottom-3 hidden w-[256px] rounded-md border-[0.5px] border-border bg-card/95 text-xs text-muted-foreground backdrop-blur-xs sm:block">
        <button
          type="button"
          aria-expanded={legendOpen}
          className="flex h-7 w-full items-center justify-between px-2.5 font-medium text-foreground"
          onClick={() => setLegendOpen((v) => !v)}
        >
          <span>图例与交互说明</span>
          {legendOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
        {legendOpen ? (
          <div className="space-y-2 border-t-[0.5px] border-border px-2.5 py-2">
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1">
              {topology.domains.slice(0, 8).map((dom) => (
                <span key={dom.key} className="inline-flex min-w-0 items-center gap-1.5">
                  <AssetDomainDot color={dom.color} />
                  <span className="truncate">{dom.label}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 border-t-[0.5px] border-border pt-2">
              {LEGEND_NODE_TYPES.map((typeKey) => (
                <span key={typeKey} className="inline-flex min-w-0 items-center gap-1.5">
                  <AssetShapeGlyph visualKey={typeKey} size={11} />
                  <span className="truncate">{getAssetVisual(typeKey).label}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 border-t-[0.5px] border-border pt-2">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-3.5 border-t-[1.5px]"
                  style={{ borderColor: GRAPH_UPSTREAM_COLOR }}
                />
                上游输入流
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-3.5 border-t-[1.5px]"
                  style={{ borderColor: GRAPH_DOWNSTREAM_COLOR }}
                />
                下游消费流
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-3.5 border-t-[1.5px]"
                  style={{ borderColor: GRAPH_TEAM_COLOR }}
                />
                团队纳管
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-3.5 border-t-[1.5px] border-dashed"
                  style={{ borderColor: GRAPH_INFRA_COLOR }}
                />
                底座依赖
              </span>
            </div>
            <div className="border-t-[0.5px] border-border pt-1.5 text-[11px] leading-4 text-muted-foreground">
              滚轮缩放画布，拖拽空白平移，按住节点可拖拽微调坐标；双击其他资产可跳转详情
            </div>
          </div>
        ) : null}
      </div>

      {/* Hover Tooltip Card */}
      {hovered && !draggingNodeId ? (
        <div
          className="pointer-events-none absolute z-20 w-68 rounded-md border-[0.5px] border-border bg-popover/95 p-2.5 text-xs text-popover-foreground shadow-md backdrop-blur-xs"
          style={{
            left: clamp(hovered.screenX + 14, 12, Math.max(12, size.width - 284)),
            ...(hoverBelow
              ? { top: hovered.screenY + 14 }
              : { bottom: size.height - hovered.screenY + 12 }),
          }}
        >
          {hoveredDomain ? (
            <DomainHoverCard domain={hoveredDomain} totalNodes={topology.stats.assetCount} />
          ) : (
            <NodeHoverCard
              node={hovered.node}
              domainColor={
                graphCache.domainMap.get(hovered.node.domain)?.color ?? GRAPH_BRAND_COLOR
              }
              upstream={graphCache.inEdges.get(hovered.node.id)?.length ?? 0}
              downstream={graphCache.outEdges.get(hovered.node.id)?.length ?? 0}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function NodeHoverCard({
  node,
  domainColor,
  upstream,
  downstream,
}: {
  node: AssetGraphNode;
  domainColor: string;
  upstream: number;
  downstream: number;
}) {
  const visualKey = resolveVisualKey(node);
  const visual = getAssetVisual(visualKey);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          <AssetShapeGlyph visualKey={visualKey} withIcon size={12} />
          <span className="truncate">{visual.label}</span>
        </span>
        {node.stage ? <Badge variant={stageBadgeVariant(node.stage)}>{node.stage}</Badge> : null}
      </div>
      <div className="mt-1.5 font-mono font-semibold text-foreground">{node.code}</div>
      <div className="truncate text-foreground">{node.label}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <AssetDomainDot color={domainColor} />
          {node.domain}
        </span>
        <span className="truncate">{node.owner ?? "多域协同"}</span>
      </div>
      <div className="mt-1 tabular-nums text-muted-foreground">
        上游输入 {upstream.toLocaleString()} 条 | 下游流向 {downstream.toLocaleString()} 条
      </div>
      <div className="mt-1.5 border-t-[0.5px] border-border pt-1.5 text-[11px] text-muted-foreground">
        点击查看上下游明细；按住节点可直接拖拽调整位置
      </div>
    </>
  );
}

function DomainHoverCard({
  domain,
  totalNodes,
}: {
  domain: AssetGraphDomainDto;
  totalNodes: number;
}) {
  const share = totalNodes > 0 ? ((domain.nodeCount / totalNodes) * 100).toFixed(1) : "0";
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <AssetDomainDot color={domain.color} />
          {domain.label} 业务域
        </span>
        <span className="tabular-nums text-muted-foreground">
          {domain.nodeCount.toLocaleString()} 项 / {share}%
        </span>
      </div>
      <div className="mt-1.5 leading-5 text-foreground">{domain.description}</div>
      <div className="mt-1.5 flex items-center justify-between border-t-[0.5px] border-border pt-1.5 tabular-nums text-muted-foreground">
        <span>已登记 {domain.registeredCount} 项</span>
        <span>待复核 {domain.pendingCount} 项</span>
      </div>
      <div className="mt-1.5 border-t-[0.5px] border-border pt-1.5 text-[11px] text-muted-foreground">
        点击业务域胶囊可在图谱中聚焦该域全部节点
      </div>
    </>
  );
}
