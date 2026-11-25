import type {
  AssetGraphDomainDto,
  AssetGraphEdge,
  AssetGraphLinkType,
  AssetGraphNode,
  AssetStage,
  AssetSubgraphDto,
  AssetSubgraphPath,
  AssetTopologyResponse,
} from "@optimax-starter/api";
import { AlertTriangle, Building2, Compass, type LucideIcon, Server } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AssetShape = "circle" | "diamond" | "hexagon" | "roundedSquare" | "pill";

export interface AssetVisualSpec {
  key: string;
  label: string;
  shape: AssetShape;
  color: string;
  Icon: LucideIcon;
  radius: number;
}

export const GRAPH_BRAND_COLOR = "#3e63dd";
export const GRAPH_UPSTREAM_COLOR = "#3e63dd";
export const GRAPH_DOWNSTREAM_COLOR = "#d97706";
export const GRAPH_TEAM_COLOR = "#0284c7";
export const GRAPH_INFRA_COLOR = "#0891b2";

export const ASSET_VISUALS: Record<string, AssetVisualSpec> = {
  Asset: {
    key: "Asset",
    label: "已登记系统",
    shape: "circle",
    color: "#3e63dd",
    Icon: Server,
    radius: 3.1,
  },
  AssetPending: {
    key: "AssetPending",
    label: "待复核系统",
    shape: "diamond",
    color: "#d97706",
    Icon: AlertTriangle,
    radius: 3.7,
  },
  OwnerTeam: {
    key: "OwnerTeam",
    label: "责任团队枢纽",
    shape: "hexagon",
    color: "#0284c7",
    Icon: Building2,
    radius: 5.8,
  },
  DomainAnchor: {
    key: "DomainAnchor",
    label: "业务域锚点",
    shape: "pill",
    color: "#3e63dd",
    Icon: Compass,
    radius: 6,
  },
};

export const LEGEND_NODE_TYPES = ["Asset", "AssetPending", "OwnerTeam"] as const;

export const LINK_TYPE_LABELS: Record<AssetGraphLinkType, string> = {
  ANCHORS_DOMAIN: "业务域锚定",
  GOVERNED_BY: "责任团队纳管",
  COLLABORATES_WITH: "同域系统协同",
  DATA_FLOW: "跨域数据流转",
  INFRA_DEPENDENCY: "安全与底座依赖",
};

export function resolveVisualKey(node: Pick<AssetGraphNode, "objectType" | "stage">): string {
  if (node.objectType === "Asset" && node.stage === "待复核") return "AssetPending";
  return node.objectType;
}

export function getAssetVisual(visualKey: string): AssetVisualSpec {
  return ASSET_VISUALS[visualKey] ?? ASSET_VISUALS.Asset!;
}

export function stageBadgeVariant(stage?: AssetStage): "brand" | "warning" | "neutral" {
  if (stage === "已登记") return "brand";
  if (stage === "待复核") return "warning";
  return "neutral";
}

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
  closePath(): void;
}

function polygon(
  sink: PathSink,
  x: number,
  y: number,
  radii: number,
  sides: number,
  rotation: number,
) {
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * Math.PI * 2) / sides;
    const px = x + Math.cos(a) * radii;
    const py = y + Math.sin(a) * radii;
    if (i === 0) sink.moveTo(px, py);
    else sink.lineTo(px, py);
  }
  sink.closePath();
}

function addShape(sink: PathSink, shape: AssetShape, x: number, y: number, r: number) {
  const up = -Math.PI / 2;
  switch (shape) {
    case "diamond":
      polygon(sink, x, y, r * 1.24, 4, up);
      return;
    case "hexagon":
      polygon(sink, x, y, r * 1.12, 6, up);
      return;
    case "roundedSquare": {
      const h = r * 0.94;
      const c = h * 0.36;
      sink.moveTo(x - h + c, y - h);
      sink.arc(x + h - c, y - h + c, c, -Math.PI / 2, 0);
      sink.arc(x + h - c, y + h - c, c, 0, Math.PI / 2);
      sink.arc(x - h + c, y + h - c, c, Math.PI / 2, Math.PI);
      sink.arc(x - h + c, y - h + c, c, Math.PI, Math.PI * 1.5);
      sink.closePath();
      return;
    }
    case "pill": {
      const w = r * 1.5;
      const h = r * 0.78;
      sink.moveTo(x - w + h, y - h);
      sink.lineTo(x + w - h, y - h);
      sink.arc(x + w - h, y, h, -Math.PI / 2, Math.PI / 2);
      sink.lineTo(x - w + h, y + h);
      sink.arc(x - w + h, y, h, Math.PI / 2, Math.PI * 1.5);
      sink.closePath();
      return;
    }
    default:
      sink.moveTo(x + r, y);
      sink.arc(x, y, r, 0, Math.PI * 2);
      sink.closePath();
  }
}

export function addAssetShapeToPath(
  path: Path2D | CanvasRenderingContext2D,
  shape: AssetShape,
  x: number,
  y: number,
  r: number,
) {
  addShape(path, shape, x, y, r);
}

function shapeToSvgPath(shape: AssetShape, x: number, y: number, r: number): string {
  const parts: string[] = [];
  const f = (n: number) => Number(n.toFixed(2));
  let hasPoint = false;
  const sink: PathSink = {
    moveTo(px, py) {
      parts.push(`M${f(px)} ${f(py)}`);
      hasPoint = true;
    },
    lineTo(px, py) {
      parts.push(`L${f(px)} ${f(py)}`);
      hasPoint = true;
    },
    arc(cx, cy, rr, a0, a1) {
      const sx = cx + Math.cos(a0) * rr;
      const sy = cy + Math.sin(a0) * rr;
      parts.push(`${hasPoint ? "L" : "M"}${f(sx)} ${f(sy)}`);
      hasPoint = true;
      const sweep = a1 - a0;
      if (sweep >= Math.PI * 2 - 1e-6) {
        const mx = cx + Math.cos(a0 + Math.PI) * rr;
        const my = cy + Math.sin(a0 + Math.PI) * rr;
        parts.push(`A${f(rr)} ${f(rr)} 0 1 1 ${f(mx)} ${f(my)}`);
        parts.push(`A${f(rr)} ${f(rr)} 0 1 1 ${f(sx)} ${f(sy)}`);
        return;
      }
      const ex = cx + Math.cos(a1) * rr;
      const ey = cy + Math.sin(a1) * rr;
      parts.push(`A${f(rr)} ${f(rr)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${f(ex)} ${f(ey)}`);
    },
    closePath() {
      parts.push("Z");
    },
  };
  addShape(sink, shape, x, y, r);
  return parts.join("");
}

export function AssetShapeGlyph({
  visualKey,
  size = 12,
  withIcon = false,
  className,
}: {
  visualKey: string;
  size?: number;
  withIcon?: boolean;
  className?: string;
}) {
  const visual = getAssetVisual(visualKey);
  const r = visual.shape === "pill" ? 5.6 : 7;
  const svg = (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    >
      <path d={shapeToSvgPath(visual.shape, 10, 10, r)} fill={visual.color} />
    </svg>
  );
  if (!withIcon) return svg;
  const Icon = visual.Icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {svg}
      <Icon aria-hidden="true" style={{ width: size + 1, height: size + 1, color: visual.color }} />
    </span>
  );
}

export function AssetDomainDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function AssetTypeBadge({
  node,
  className,
}: {
  node: Pick<AssetGraphNode, "objectType" | "stage">;
  className?: string;
}) {
  const visual = getAssetVisual(resolveVisualKey(node));
  return (
    <Badge variant="outline" className={cn("gap-1 font-normal", className)}>
      <AssetShapeGlyph visualKey={resolveVisualKey(node)} size={10} />
      <span>{visual.label}</span>
    </Badge>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border-[0.5px] px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-accent/50 text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function edgePriority(edge: AssetGraphEdge): number {
  switch (edge.linkType) {
    case "DATA_FLOW":
      return 0;
    case "INFRA_DEPENDENCY":
      return 1;
    case "COLLABORATES_WITH":
      return 2;
    case "GOVERNED_BY":
      return 3;
    default:
      return 9;
  }
}

/**
 * Extracts a crisp, bounded multi-hop spotlight subgraph centered on `seedNodeId`
 * from the full topology without extra backend roundtrips.
 */
export function extractAssetSubgraph(
  topology: AssetTopologyResponse,
  seedNodeId: string,
  direction: "both" | "upstream" | "downstream",
  budget = 28,
): AssetSubgraphDto {
  const nodeMap = new Map<string, AssetGraphNode>();
  for (const n of topology.nodes) nodeMap.set(n.id, n);

  const inMap = new Map<string, AssetGraphEdge[]>();
  const outMap = new Map<string, AssetGraphEdge[]>();
  for (const e of topology.edges) {
    if (e.linkType === "ANCHORS_DOMAIN") continue;
    const out = outMap.get(e.sourceId);
    if (out) out.push(e);
    else outMap.set(e.sourceId, [e]);
    const ins = inMap.get(e.targetId);
    if (ins) ins.push(e);
    else inMap.set(e.targetId, [e]);
  }
  for (const list of inMap.values()) list.sort((a, b) => edgePriority(a) - edgePriority(b));
  for (const list of outMap.values()) list.sort((a, b) => edgePriority(a) - edgePriority(b));

  const seed = nodeMap.get(seedNodeId);
  if (!seed) {
    return {
      seedNodeId,
      direction,
      nodeIds: [],
      edgeIds: [],
      nodeRoles: {},
      nodeHops: {},
      orderedPaths: [],
      stats: { highlightedNodeCount: 0, highlightedEdgeCount: 0, compressionRatio: 0 },
    };
  }

  const maxNodes = Math.max(8, Math.min(budget, topology.nodes.length));
  const included = new Set<string>([seedNodeId]);
  const nodeRoles: AssetSubgraphDto["nodeRoles"] = { [seedNodeId]: "seed" };
  const nodeHops: Record<string, number> = { [seedNodeId]: 0 };
  const parentEdge = new Map<string, { edge: AssetGraphEdge; role: "upstream" | "downstream" }>();

  const queue: Array<{
    id: string;
    hop: number;
    role: "upstream" | "downstream";
  }> = [];

  if (direction === "both" || direction === "upstream") {
    queue.push({ id: seedNodeId, hop: 0, role: "upstream" });
  }
  if (direction === "both" || direction === "downstream") {
    queue.push({ id: seedNodeId, hop: 0, role: "downstream" });
  }

  const MAX_HOP = 2;
  let head = 0;
  while (head < queue.length && included.size < maxNodes) {
    const cur = queue[head++]!;
    if (cur.hop >= MAX_HOP) continue;

    if (cur.role === "upstream") {
      const ins = inMap.get(cur.id) ?? [];
      // Prevent OwnerTeam hub from pulling dozens of unrelated peers when going upstream
      const limitPerNode = cur.id === seedNodeId ? 10 : 4;
      let addedHere = 0;
      for (const edge of ins) {
        if (included.size >= maxNodes || addedHere >= limitPerNode) break;
        const src = nodeMap.get(edge.sourceId);
        if (!src || src.objectType === "DomainAnchor") continue;
        if (included.has(src.id)) continue;
        included.add(src.id);
        nodeHops[src.id] = cur.hop + 1;
        nodeRoles[src.id] = src.objectType === "OwnerTeam" ? "team" : "upstream";
        parentEdge.set(src.id, { edge, role: "upstream" });
        addedHere += 1;
        if (src.objectType !== "OwnerTeam") {
          queue.push({ id: src.id, hop: cur.hop + 1, role: "upstream" });
        }
      }
    } else {
      const outs = outMap.get(cur.id) ?? [];
      const limitPerNode = cur.id === seedNodeId ? 10 : 4;
      let addedHere = 0;
      for (const edge of outs) {
        if (included.size >= maxNodes || addedHere >= limitPerNode) break;
        const dst = nodeMap.get(edge.targetId);
        if (!dst || dst.objectType === "DomainAnchor") continue;
        if (included.has(dst.id)) continue;
        included.add(dst.id);
        nodeHops[dst.id] = cur.hop + 1;
        nodeRoles[dst.id] = dst.objectType === "OwnerTeam" ? "team" : "downstream";
        parentEdge.set(dst.id, { edge, role: "downstream" });
        addedHere += 1;
        if (dst.objectType !== "OwnerTeam") {
          queue.push({ id: dst.id, hop: cur.hop + 1, role: "downstream" });
        }
      }
    }
  }

  // If seed has an OwnerTeam and we still have spare budget, surface up to 4 team peers
  if (included.size < maxNodes && seed.owner) {
    const teamId = `TEAM:${seed.owner}`;
    if (included.has(teamId)) {
      const teamIns = (inMap.get(teamId) ?? []).filter(
        (e) => e.sourceId !== seedNodeId && !included.has(e.sourceId),
      );
      let peersAdded = 0;
      for (const e of teamIns) {
        if (included.size >= maxNodes || peersAdded >= 4) break;
        const peer = nodeMap.get(e.sourceId);
        if (!peer || peer.objectType !== "Asset") continue;
        included.add(peer.id);
        nodeHops[peer.id] = 2;
        nodeRoles[peer.id] = peer.domain === seed.domain ? "peer" : "downstream";
        peersAdded += 1;
      }
    }
  }

  const edgeIds: string[] = [];
  for (const e of topology.edges) {
    if (e.linkType === "ANCHORS_DOMAIN") continue;
    if (included.has(e.sourceId) && included.has(e.targetId)) {
      edgeIds.push(e.id);
    }
  }

  // Build ordered causal/dependency chains (up to 4 most informative chains)
  const orderedPaths: AssetSubgraphPath[] = [];
  const edgeMap = new Map<string, AssetGraphEdge>();
  for (const e of topology.edges) edgeMap.set(e.id, e);

  if (seed.objectType !== "DomainAnchor") {
    const upstreamCandidates = [...included]
      .filter((id) => nodeRoles[id] === "upstream" && (nodeHops[id] ?? 0) >= 1)
      .sort((a, b) => (nodeHops[b] ?? 0) - (nodeHops[a] ?? 0));

    let pathSeq = 1;
    const usedPathSigs = new Set<string>();

    for (const startId of upstreamCandidates) {
      if (orderedPaths.length >= 2) break;
      const chainNodes: string[] = [startId];
      const chainEdges: string[] = [];
      let cursor = startId;
      let guard = 0;
      while (cursor !== seedNodeId && guard++ < 5) {
        const step = parentEdge.get(cursor);
        if (!step || step.role !== "upstream") break;
        chainEdges.push(step.edge.id);
        chainNodes.push(step.edge.targetId);
        cursor = step.edge.targetId;
      }
      if (cursor === seedNodeId && chainEdges.length >= 1) {
        const sig = chainNodes.join(">");
        if (!usedPathSigs.has(sig)) {
          usedPathSigs.add(sig);
          const first = nodeMap.get(startId);
          orderedPaths.push({
            id: `P-${pathSeq++}`,
            label: `${first?.domain ?? ""}上游输入: ${first?.label ?? startId}`,
            kind: "upstream",
            nodeIds: chainNodes,
            edgeIds: chainEdges,
          });
        }
      }
    }

    const downstreamCandidates = [...included]
      .filter(
        (id) =>
          (nodeRoles[id] === "downstream" || nodeRoles[id] === "team") && (nodeHops[id] ?? 0) >= 1,
      )
      .sort((a, b) => (nodeHops[b] ?? 0) - (nodeHops[a] ?? 0));

    for (const endId of downstreamCandidates) {
      if (orderedPaths.length >= 4) break;
      const revNodes: string[] = [endId];
      const revEdges: string[] = [];
      let cursor = endId;
      let guard = 0;
      while (cursor !== seedNodeId && guard++ < 5) {
        const step = parentEdge.get(cursor);
        if (!step || step.role !== "downstream") break;
        revEdges.push(step.edge.id);
        revNodes.push(step.edge.sourceId);
        cursor = step.edge.sourceId;
      }
      if (cursor === seedNodeId && revEdges.length >= 1) {
        const chainNodes = revNodes.reverse();
        const chainEdges = revEdges.reverse();
        const sig = chainNodes.join(">");
        if (!usedPathSigs.has(sig)) {
          usedPathSigs.add(sig);
          const tail = nodeMap.get(endId);
          orderedPaths.push({
            id: `P-${pathSeq++}`,
            label:
              tail?.objectType === "OwnerTeam"
                ? `治理归属: ${tail.code}`
                : `下游流向: ${tail?.label ?? endId}`,
            kind: tail?.objectType === "OwnerTeam" ? "governance" : "downstream",
            nodeIds: chainNodes,
            edgeIds: chainEdges,
          });
        }
      }
    }
  }

  const total = Math.max(1, topology.stats.nodeCount);
  const compressionRatio = Math.max(
    0,
    Math.min(99, Math.round(((total - included.size) / total) * 1000) / 10),
  );

  return {
    seedNodeId,
    direction,
    nodeIds: [...included],
    edgeIds,
    nodeRoles,
    nodeHops,
    orderedPaths,
    stats: {
      highlightedNodeCount: included.size,
      highlightedEdgeCount: edgeIds.length,
      compressionRatio,
    },
  };
}

export function findDomainByKey(
  domains: readonly AssetGraphDomainDto[],
  domainKey: string,
): AssetGraphDomainDto | undefined {
  return domains.find((d) => d.key === domainKey);
}
