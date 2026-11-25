import type {
  AssetGraphNode,
  AssetSubgraphDto,
  AssetSubgraphPath,
  AssetTopologyResponse,
} from "@optimax-starter/api";
import { ArrowRight, Crosshair } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AssetDomainDot,
  AssetShapeGlyph,
  resolveVisualKey,
  stageBadgeVariant,
} from "./asset-graph-visuals";

interface SwimlaneSpec {
  key: string;
  title: string;
  subtitle: string;
  match: (node: AssetGraphNode, subgraph: AssetSubgraphDto) => boolean;
}

const SWIMLANES: readonly SwimlaneSpec[] = [
  {
    key: "upstream",
    title: "上游与底座输入",
    subtitle: "供数前置与安全底座支撑",
    match: (n, sg) => n.id !== sg.seedNodeId && sg.nodeRoles[n.id] === "upstream",
  },
  {
    key: "seed",
    title: "当前焦点系统",
    subtitle: "所选资产核查起点",
    match: (n, sg) => n.id === sg.seedNodeId,
  },
  {
    key: "team",
    title: "责任团队枢纽",
    subtitle: "运维归属与管理主体",
    match: (n, sg) =>
      n.id !== sg.seedNodeId && (n.objectType === "OwnerTeam" || sg.nodeRoles[n.id] === "team"),
  },
  {
    key: "peer",
    title: "同域 / 同团队协同",
    subtitle: "相邻系统协同参照",
    match: (n, sg) =>
      n.id !== sg.seedNodeId && n.objectType !== "OwnerTeam" && sg.nodeRoles[n.id] === "peer",
  },
  {
    key: "downstream",
    title: "下游数据与消费",
    subtitle: "下游接收、风控与数仓",
    match: (n, sg) =>
      n.id !== sg.seedNodeId && n.objectType !== "OwnerTeam" && sg.nodeRoles[n.id] === "downstream",
  },
];

export function AssetSwimlaneView({
  topology,
  subgraph,
  selectedNodeId,
  activePath,
  onSelectNode,
  onFocusNode,
}: {
  topology: AssetTopologyResponse;
  subgraph: AssetSubgraphDto;
  selectedNodeId?: string | null;
  activePath?: AssetSubgraphPath | null;
  onSelectNode: (nodeId: string) => void;
  onFocusNode?: (nodeId: string) => void;
}) {
  const nodeMap = new Map<string, AssetGraphNode>();
  for (const n of topology.nodes) nodeMap.set(n.id, n);
  const domainColorMap = new Map<string, string>();
  for (const d of topology.domains) domainColorMap.set(d.key, d.color);

  const subNodes = subgraph.nodeIds
    .map((id) => nodeMap.get(id))
    .filter((n): n is AssetGraphNode => n !== undefined && n.objectType !== "DomainAnchor");

  const pathStepMap = new Map<string, number>();
  if (activePath) {
    activePath.nodeIds.forEach((id, idx) => {
      if (!pathStepMap.has(id)) pathStepMap.set(id, idx + 1);
    });
  }

  return (
    <div
      data-slot="asset-swimlane-view"
      className="overflow-x-auto rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] p-3"
    >
      <div className="grid min-w-[920px] grid-cols-5 gap-2.5">
        {SWIMLANES.map((lane, laneIdx) => {
          const nodes = subNodes
            .filter((n) => lane.match(n, subgraph))
            .sort(
              (a, b) =>
                (subgraph.nodeHops[a.id] ?? 99) - (subgraph.nodeHops[b.id] ?? 99) ||
                a.code.localeCompare(b.code),
            );
          return (
            <div
              key={lane.key}
              className="flex min-w-[172px] flex-col rounded-lg border-[0.5px] border-border bg-card p-2.5"
            >
              <div className="flex items-start justify-between gap-1.5 border-b-[0.5px] border-border pb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                    <span>
                      {laneIdx + 1}. {lane.title}
                    </span>
                    {laneIdx < SWIMLANES.length - 1 ? (
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {lane.subtitle}
                  </div>
                </div>
                <Badge variant="neutral" className="tabular-nums">
                  {nodes.length}
                </Badge>
              </div>

              <div className="mt-2 flex flex-1 flex-col gap-1.5">
                {nodes.length === 0 ? (
                  <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    当前方向无该层级节点
                  </div>
                ) : (
                  nodes.map((node) => {
                    const isSelected = node.id === selectedNodeId;
                    const isSeed = node.id === subgraph.seedNodeId;
                    const hop = subgraph.nodeHops[node.id];
                    const pathStep = pathStepMap.get(node.id);
                    const dimmed = Boolean(activePath) && pathStep === undefined;
                    const domColor = domainColorMap.get(node.domain) ?? "#3e63dd";

                    return (
                      <div
                        key={node.id}
                        className={cn(
                          "group relative rounded-md border-[0.5px] bg-[var(--surface-subtle)] p-2 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-accent/50"
                            : isSeed
                              ? "border-primary/60 bg-card"
                              : "border-border hover:border-foreground/30",
                          dimmed && "opacity-45",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectNode(node.id)}
                          className="block w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              <AssetShapeGlyph visualKey={resolveVisualKey(node)} size={11} />
                              <span className="truncate font-mono text-xs font-semibold text-foreground">
                                {node.code}
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              {pathStep !== undefined ? (
                                <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground tabular-nums">
                                  {pathStep}
                                </span>
                              ) : null}
                              {hop !== undefined ? (
                                <span className="rounded bg-card px-1 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                                  {hop}跳
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-1 truncate text-xs font-medium text-foreground">
                            {node.label}
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <AssetDomainDot color={domColor} />
                              <span className="truncate">{node.domain}</span>
                            </span>
                            {isSeed ? (
                              <Badge variant="brand">当前焦点</Badge>
                            ) : node.stage ? (
                              <Badge variant={stageBadgeVariant(node.stage)}>{node.stage}</Badge>
                            ) : null}
                          </div>
                        </button>

                        {onFocusNode ? (
                          <button
                            type="button"
                            title="在超大图画布中居中定位"
                            aria-label={`在画布定位 ${node.code}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onFocusNode(node.id);
                            }}
                            className="absolute right-1.5 bottom-1.5 hidden rounded border-[0.5px] border-border bg-card p-1 text-muted-foreground shadow-xs hover:text-foreground group-hover:inline-flex"
                          >
                            <Crosshair className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
