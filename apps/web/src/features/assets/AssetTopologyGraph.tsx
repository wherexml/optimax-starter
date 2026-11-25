import type { Asset, AssetGraphNode, AssetTopologyResponse } from "@optimax-starter/api";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Crosshair,
  Minus,
  Plus,
  RotateCcw,
  Route,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { assetsApi } from "@/console-client";
import { cn } from "@/lib/utils";
import { type AssetGraphFocusTarget, AssetSuperGraphCanvas } from "./AssetSuperGraphCanvas";
import { AssetSwimlaneView } from "./AssetSwimlaneView";
import {
  AssetDomainDot,
  AssetShapeGlyph,
  AssetTypeBadge,
  extractAssetSubgraph,
  LINK_TYPE_LABELS,
  resolveVisualKey,
  stageBadgeVariant,
} from "./asset-graph-visuals";

export interface AssetTopologyGraphProps {
  asset: Asset;
  onSelectAsset: (id: number) => void;
  onFilterDomain: (domain: string) => void;
  onFilterOwner: (owner: string) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const DIRECTION_OPTIONS = [
  { value: "both", label: "双向全链" },
  { value: "upstream", label: "上游输入" },
  { value: "downstream", label: "下游流向" },
] as const;

const VIEW_OPTIONS = [
  { value: "galaxy", label: "全图聚光灯" },
  { value: "swimlane", label: "5 层泳道" },
] as const;

const BUDGET_MIN = 16;
const BUDGET_MAX = 64;
const BUDGET_STEP = 12;

export function AssetTopologyGraph({
  asset,
  onSelectAsset,
  onFilterDomain,
  onFilterOwner,
  expanded = false,
  onToggleExpand,
}: AssetTopologyGraphProps) {
  const defaultSeedId = `AS-${asset.id}`;
  const [seedNodeId, setSeedNodeId] = useState(defaultSeedId);
  const [direction, setDirection] = useState<"both" | "upstream" | "downstream">("both");
  const [budget, setBudget] = useState(28);
  const [spotlight, setSpotlight] = useState(true);
  const [view, setView] = useState<"galaxy" | "swimlane">("galaxy");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(defaultSeedId);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<AssetGraphFocusTarget | null>(null);
  const focusNonceRef = useRef(0);
  const nextNonce = () => ++focusNonceRef.current;

  useEffect(() => {
    const nextSeed = `AS-${asset.id}`;
    setSeedNodeId(nextSeed);
    setSelectedNodeId(nextSeed);
    setActivePathId(null);
    setFocusTarget(null);
  }, [asset.id]);

  const topologyQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["assets", "topology"],
    queryFn: ({ signal }) => assetsApi.topology(signal),
    staleTime: 60_000,
  });

  const topology = topologyQuery.data;

  const nodeMap = useMemo(() => {
    const map = new Map<string, AssetGraphNode>();
    for (const n of topology?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [topology?.nodes]);

  const subgraph = useMemo(() => {
    if (!topology) return null;
    const effectiveSeed = nodeMap.has(seedNodeId) ? seedNodeId : defaultSeedId;
    return extractAssetSubgraph(topology, effectiveSeed, direction, budget);
  }, [topology, nodeMap, seedNodeId, defaultSeedId, direction, budget]);

  const activePath = useMemo(() => {
    if (!activePathId || !subgraph) return null;
    return subgraph.orderedPaths.find((p) => p.id === activePathId) ?? null;
  }, [activePathId, subgraph]);

  const handleSelectNode = useCallback((nodeId: string, options?: { focus?: boolean }) => {
    setSelectedNodeId(nodeId);
    if (options?.focus) {
      setFocusTarget({ id: nodeId, nonce: nextNonce() });
    }
  }, []);

  const focusOnCanvas = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setFocusTarget({ id: nodeId, nonce: nextNonce() });
      if (view !== "galaxy") {
        setView("galaxy");
      }
    },
    [view],
  );

  const handleReseed = useCallback((nodeId: string) => {
    setSeedNodeId(nodeId);
    setSelectedNodeId(nodeId);
    setActivePathId(null);
    setSpotlight(true);
    setView("galaxy");
  }, []);

  if (topologyQuery.isPending && !topology) {
    return (
      <section
        data-slot="asset-topology-graph"
        aria-label="全域资产架构超大图与聚光灯"
        className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Waypoints className="size-4 text-primary" />
            全域资产架构超大图与聚光灯
          </div>
          <Badge variant="outline">正在加载 1,000+ 节点拓扑</Badge>
        </div>
        <div className="flex h-[480px] items-center justify-center rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] text-sm text-muted-foreground">
          正在计算全量资产域与上下游链路坐标…
        </div>
      </section>
    );
  }

  if (topologyQuery.isError || !topology) {
    return (
      <section
        data-slot="asset-topology-graph"
        aria-label="全域资产架构超大图与聚光灯"
        className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Waypoints className="size-4 text-primary" />
            全域资产架构超大图与聚光灯
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void topologyQuery.refetch()}
          >
            重试加载
          </Button>
        </div>
        <div className="rounded-lg border-[0.5px] border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {topologyQuery.error instanceof Error ? topologyQuery.error.message : "加载资产拓扑失败"}
        </div>
      </section>
    );
  }

  const seedNode = nodeMap.get(subgraph?.seedNodeId ?? defaultSeedId);

  return (
    <section
      data-slot="asset-topology-graph"
      aria-label="全域资产架构超大图与聚光灯"
      className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5"
    >
      {/* Workbench Header & Inline Controls */}
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Waypoints className="size-4 shrink-0 text-primary" />
            <h2 className="m-0 text-[15px] leading-6 font-semibold text-foreground">
              全域资产架构超大图与聚光灯
            </h2>
            <Badge variant="outline" className="font-mono text-[11px]">
              起点：{seedNode?.code ?? defaultSeedId}
            </Badge>
            {seedNodeId !== defaultSeedId ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => handleReseed(defaultSeedId)}
              >
                <RotateCcw className="size-3" />
                回到当前资产
              </Button>
            ) : null}
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            支持鼠标滚轮缩放、拖拽画布平移、按住节点拖拽微调坐标；切换聚光灯可俯瞰全库{" "}
            {topology.stats.assetCount.toLocaleString()} 项系统资产架构
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">追踪方向</span>
            <SegmentedControl
              label="链路追踪方向"
              value={direction}
              onValueChange={(next) => {
                setDirection(next);
                setActivePathId(null);
              }}
              options={[...DIRECTION_OPTIONS]}
              className="h-8 w-auto min-w-[208px]"
            />
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">
              子图节点上限
            </span>
            <div className="flex h-8 items-center gap-0.5 rounded-md border-[0.5px] border-input bg-card px-1">
              <button
                type="button"
                aria-label="减小子图节点数量"
                disabled={budget <= BUDGET_MIN}
                onClick={() => {
                  setBudget((b) => Math.max(BUDGET_MIN, b - BUDGET_STEP));
                  setActivePathId(null);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Minus className="size-3" />
              </button>
              <span className="min-w-[26px] text-center font-mono text-xs tabular-nums text-foreground">
                {budget}
              </span>
              <button
                type="button"
                aria-label="增大子图节点数量"
                disabled={budget >= BUDGET_MAX}
                onClick={() => {
                  setBudget((b) => Math.min(BUDGET_MAX, b + BUDGET_STEP));
                  setActivePathId(null);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Plus className="size-3" />
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">视图模式</span>
            <SegmentedControl
              label="拓扑视图切换"
              value={view}
              onValueChange={(next) => setView(next)}
              options={[...VIEW_OPTIONS]}
              className="h-8 w-auto min-w-[164px]"
            />
          </div>
        </div>
      </div>

      {/* Main Visualization Surface: Interactive Canvas2D vs Structured 5-Lane Swimlane */}
      {view === "galaxy" ? (
        <AssetSuperGraphCanvas
          topology={topology}
          subgraph={subgraph}
          spotlight={spotlight}
          onToggleSpotlight={() => setSpotlight((s) => !s)}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id) => handleSelectNode(id)}
          onDoubleClickAsset={(targetAssetId) => {
            if (targetAssetId !== asset.id) onSelectAsset(targetAssetId);
          }}
          focusTarget={focusTarget}
          activePath={activePath}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      ) : subgraph ? (
        <AssetSwimlaneView
          topology={topology}
          subgraph={subgraph}
          selectedNodeId={selectedNodeId}
          activePath={activePath}
          onSelectNode={(id) => handleSelectNode(id)}
          onFocusNode={(id) => focusOnCanvas(id)}
        />
      ) : null}

      {/* Ordered Propagation Paths Strip */}
      {subgraph && subgraph.orderedPaths.length > 0 ? (
        <div className="rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Route className="size-3.5 text-primary" />
              有序传播链路（点击高亮单链）
            </div>
            {activePath ? (
              <button
                type="button"
                onClick={() => setActivePathId(null)}
                className="text-xs font-medium text-primary hover:underline"
              >
                清除单链高亮
              </button>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {subgraph.orderedPaths.map((p) => {
              const isActive = activePath?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    const nextId = isActive ? null : p.id;
                    setActivePathId(nextId);
                    if (!isActive) {
                      setSpotlight(true);
                      setView("galaxy");
                      const endpoint =
                        p.nodeIds[0] === seedNodeId
                          ? p.nodeIds[p.nodeIds.length - 1]
                          : p.nodeIds[0];
                      if (endpoint) setSelectedNodeId(endpoint);
                    }
                  }}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border-[0.5px] px-2.5 py-2 text-left text-xs transition-colors",
                    isActive
                      ? "border-primary bg-card ring-1 ring-primary/30"
                      : "border-border bg-card hover:border-foreground/30",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{p.label}</span>
                    <Badge
                      variant={
                        p.kind === "upstream"
                          ? "brand"
                          : p.kind === "downstream"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {p.nodeIds.length} 节点
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    {p.nodeIds.map((nid, idx) => {
                      const nodeObj = nodeMap.get(nid);
                      return (
                        <span
                          key={`${p.id}-${nid}-${idx}`}
                          className="inline-flex items-center gap-1"
                        >
                          {idx > 0 ? <span className="text-muted-foreground/70">-&gt;</span> : null}
                          <span
                            className={
                              nid === seedNodeId ? "font-semibold text-primary" : "text-foreground"
                            }
                          >
                            {nodeObj?.code ?? nid}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Compact Selection Inspector + Quick Domain Navigator */}
      <TopologySelectionInspector
        topology={topology}
        nodeMap={nodeMap}
        selectedNodeId={selectedNodeId}
        currentAssetId={asset.id}
        seedNodeId={seedNodeId}
        onSelectNode={handleSelectNode}
        onFocusNode={focusOnCanvas}
        onReseed={handleReseed}
        onSelectAsset={onSelectAsset}
        onFilterDomain={onFilterDomain}
        onFilterOwner={onFilterOwner}
      />
    </section>
  );
}

function TopologySelectionInspector({
  topology,
  nodeMap,
  selectedNodeId,
  currentAssetId,
  seedNodeId,
  onSelectNode,
  onFocusNode,
  onReseed,
  onSelectAsset,
  onFilterDomain,
  onFilterOwner,
}: {
  topology: AssetTopologyResponse;
  nodeMap: Map<string, AssetGraphNode>;
  selectedNodeId: string | null;
  currentAssetId: number;
  seedNodeId: string;
  onSelectNode: (nodeId: string, options?: { focus?: boolean }) => void;
  onFocusNode: (nodeId: string) => void;
  onReseed: (nodeId: string) => void;
  onSelectAsset: (id: number) => void;
  onFilterDomain: (domain: string) => void;
  onFilterOwner: (owner: string) => void;
}) {
  const selected = selectedNodeId ? nodeMap.get(selectedNodeId) : undefined;
  const domainMap = useMemo(() => {
    const map = new Map(topology.domains.map((d) => [d.key, d]));
    return map;
  }, [topology.domains]);

  const { incoming, outgoing, teamMembers } = useMemo(() => {
    if (!selected) {
      return { incoming: [], outgoing: [], teamMembers: [] };
    }
    const ins: Array<{ node: AssetGraphNode; linkLabel: string }> = [];
    const outs: Array<{ node: AssetGraphNode; linkLabel: string }> = [];
    const members: AssetGraphNode[] = [];

    for (const e of topology.edges) {
      if (e.linkType === "ANCHORS_DOMAIN") continue;
      if (
        selected.objectType === "OwnerTeam" &&
        e.targetId === selected.id &&
        e.linkType === "GOVERNED_BY"
      ) {
        const src = nodeMap.get(e.sourceId);
        if (src) members.push(src);
        continue;
      }
      if (e.targetId === selected.id) {
        const src = nodeMap.get(e.sourceId);
        if (src) ins.push({ node: src, linkLabel: LINK_TYPE_LABELS[e.linkType] });
      } else if (e.sourceId === selected.id) {
        const dst = nodeMap.get(e.targetId);
        if (dst) outs.push({ node: dst, linkLabel: LINK_TYPE_LABELS[e.linkType] });
      }
    }
    members.sort((a, b) => (b.assetId ?? 0) - (a.assetId ?? 0));
    return { incoming: ins, outgoing: outs, teamMembers: members };
  }, [selected, topology.edges, nodeMap]);

  const selectedDomainInfo = selected ? domainMap.get(selected.domain) : undefined;

  return (
    <div
      data-slot="topology-selection-inspector"
      className="flex flex-col gap-2.5 rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] p-3"
    >
      {/* Quick domain capsules */}
      <div className="flex flex-wrap items-center gap-1.5">
        {topology.domains.map((dom) => {
          const anchorId = `DOM:${dom.key}`;
          const activeAnchor = selectedNodeId === anchorId;
          const sameDom = selected?.domain === dom.key;
          return (
            <button
              key={dom.key}
              type="button"
              aria-pressed={activeAnchor}
              onClick={() => onFocusNode(anchorId)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md border-[0.5px] px-2 text-[11px] font-medium transition-colors",
                activeAnchor
                  ? "border-primary bg-card text-foreground shadow-2xs"
                  : sameDom
                    ? "border-primary/45 bg-card/80 text-foreground hover:bg-card"
                    : "border-border bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground",
              )}
            >
              <AssetDomainDot color={dom.color} />
              <span>{dom.label}</span>
              <span className="tabular-nums text-muted-foreground">{dom.nodeCount}</span>
            </button>
          );
        })}
      </div>

      {!selected ? (
        <div className="text-xs text-muted-foreground">
          点击画布任意系统节点、责任团队或业务域标签，可在此查看完整上下游关系并快捷跳转。
        </div>
      ) : selected.objectType === "DomainAnchor" && selectedDomainInfo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-[0.5px] border-border bg-card p-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <AssetDomainDot color={selectedDomainInfo.color} className="size-2.5" />
              <span className="text-sm font-semibold text-foreground">
                {selectedDomainInfo.label} 业务域
              </span>
              <Badge variant="neutral" className="tabular-nums">
                {selectedDomainInfo.nodeCount} 项系统资产
              </Badge>
              <Badge variant="brand" className="tabular-nums">
                已登记 {selectedDomainInfo.registeredCount}
              </Badge>
              {selectedDomainInfo.pendingCount > 0 ? (
                <Badge variant="warning" className="tabular-nums">
                  待复核 {selectedDomainInfo.pendingCount}
                </Badge>
              ) : null}
            </div>
            <p className="m-0 text-xs text-muted-foreground">{selectedDomainInfo.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onFocusNode(selected.id)}
            >
              <Crosshair className="size-3" />
              聚焦该域
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onFilterDomain(selectedDomainInfo.label)}
            >
              筛选该域台账
              <ArrowUpRight className="size-3" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-md border-[0.5px] border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={
                    selected.objectType === "Asset"
                      ? "font-mono text-xs font-semibold text-foreground"
                      : "text-sm font-semibold text-foreground"
                  }
                >
                  {selected.code}
                </span>
                {selected.objectType === "Asset" ? (
                  <span className="text-sm font-semibold text-foreground">{selected.label}</span>
                ) : null}
                <AssetTypeBadge node={selected} />
                {selected.stage ? (
                  <Badge variant={stageBadgeVariant(selected.stage)}>{selected.stage}</Badge>
                ) : null}
                {selected.assetId === currentAssetId ? (
                  <Badge variant="brand">当前详情页资产</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => onFilterDomain(selected.domain)}
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  {selectedDomainInfo ? <AssetDomainDot color={selectedDomainInfo.color} /> : null}
                  业务域：{selected.domain}
                </button>
                {selected.owner ? (
                  <button
                    type="button"
                    onClick={() => onFilterOwner(selected.owner!)}
                    className="hover:text-foreground hover:underline"
                  >
                    责任团队：{selected.owner}
                  </button>
                ) : null}
                <span className="tabular-nums">
                  上游 {selected.upstreamCount} 条 / 下游 {selected.downstreamCount} 条
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onFocusNode(selected.id)}
              >
                <Crosshair className="size-3" />
                画布居中
              </Button>
              {selected.id !== seedNodeId && selected.objectType === "Asset" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => onReseed(selected.id)}
                >
                  <Sparkles className="size-3" />
                  设为聚光灯起点
                </Button>
              ) : null}
              {selected.objectType === "OwnerTeam" && selected.owner ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => onFilterOwner(selected.owner!)}
                >
                  查看团队在管台账
                  <ArrowUpRight className="size-3" />
                </Button>
              ) : null}
              {selected.objectType === "Asset" &&
              selected.assetId &&
              selected.assetId !== currentAssetId ? (
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  onClick={() => onSelectAsset(selected.assetId!)}
                >
                  进入详情页
                  <ArrowUpRight className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>

          {selected.objectType === "OwnerTeam" && teamMembers.length > 0 ? (
            <div className="space-y-1.5 border-t-[0.5px] border-border pt-2">
              <div className="text-[11px] font-medium text-muted-foreground">
                该团队纳管资产抽样（共 {teamMembers.length} 项，点击在画布定位）
              </div>
              <div className="flex flex-wrap gap-1.5">
                {teamMembers.slice(0, 10).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onFocusNode(m.id)}
                    className="inline-flex items-center gap-1 rounded border-[0.5px] border-border bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] text-foreground hover:border-primary"
                  >
                    <AssetShapeGlyph visualKey={resolveVisualKey(m)} size={10} />
                    <span className="font-mono">{m.code}</span>
                    <span className="max-w-[110px] truncate text-muted-foreground">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 border-t-[0.5px] border-border pt-2 md:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <ArrowDownToLine className="size-3 text-primary" />
                  上游依赖输入 ({incoming.length})
                </div>
                {incoming.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">当前节点为链路源头</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {incoming.slice(0, 6).map(({ node, linkLabel }) => (
                      <button
                        key={`in-${node.id}`}
                        type="button"
                        title={linkLabel}
                        onClick={() => onSelectNode(node.id, { focus: true })}
                        className="inline-flex items-center gap-1 rounded border-[0.5px] border-border bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] text-foreground hover:border-primary"
                      >
                        <AssetShapeGlyph visualKey={resolveVisualKey(node)} size={10} />
                        {node.objectType === "OwnerTeam" ? (
                          <>
                            <span className="font-medium">{node.code}</span>
                            <span className="text-muted-foreground">团队枢纽</span>
                          </>
                        ) : (
                          <>
                            <span className="font-mono">{node.code}</span>
                            <span className="max-w-[96px] truncate text-muted-foreground">
                              {node.label}
                            </span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <ArrowUpFromLine className="size-3 text-[var(--warning-solid,#d97706)]" />
                  下游流向与归属 ({outgoing.length})
                </div>
                {outgoing.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">当前节点为终端汇总节点</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {outgoing.slice(0, 6).map(({ node, linkLabel }) => (
                      <button
                        key={`out-${node.id}`}
                        type="button"
                        title={linkLabel}
                        onClick={() => onSelectNode(node.id, { focus: true })}
                        className="inline-flex items-center gap-1 rounded border-[0.5px] border-border bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] text-foreground hover:border-primary"
                      >
                        <AssetShapeGlyph visualKey={resolveVisualKey(node)} size={10} />
                        {node.objectType === "OwnerTeam" ? (
                          <>
                            <span className="font-medium">{node.code}</span>
                            <span className="text-muted-foreground">团队枢纽</span>
                          </>
                        ) : (
                          <>
                            <span className="font-mono">{node.code}</span>
                            <span className="max-w-[96px] truncate text-muted-foreground">
                              {node.label}
                            </span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
