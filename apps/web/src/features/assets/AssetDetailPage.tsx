import { ACTOR_SOURCE_LABELS, type ActorSource, AUDIT_ACTION_LABELS } from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Layers,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AttachmentPanel } from "@/components/attachments/AttachmentPanel";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { BarList, type BarListItem } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { CategoryBar } from "@/components/ui/category-bar";
import { DonutChart, type DonutSegment } from "@/components/ui/donut-chart";
import { KpiCard, KpiCardSkeleton } from "@/components/ui/kpi-card";
import { PageTabs, PageTabsPanel } from "@/components/ui/page-tabs";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast";
import { Tracker, type TrackerSlot } from "@/components/ui/tracker";
import {
  type Asset,
  type AssetAuditEntry,
  type AssetSearch,
  assetsApi,
  request,
} from "@/console-client";
// @starter:agent-start
import { AskAssistant } from "@/features/assistant/AssistantDrawer";
// @starter:agent-end
import { hasPermission, useAccount } from "@/features/auth/session";
import { parseAssetSearch } from "@/features/filters/search";
import type { Filters } from "@/hooks/usePersistedFilters";
import { cn } from "@/lib/utils";
import { AssetFormDialog } from "./AssetFormDialog";
import { AssetTopologyGraph } from "./AssetTopologyGraph";

type DetailTab = "peers" | "attachments" | "audit";
type BenchmarkView = "domain-owners" | "all-domains";

const route = getRouteApi("/assets_/$assetId");

const ASSET_FIELD_LABELS: Record<string, string> = {
  name: "资产名称",
  domain: "业务域",
  owner: "责任团队",
  stage: "登记状态",
};

const CHART_TONES: readonly NonNullable<DonutSegment["tone"]>[] = [
  "brand",
  "warning",
  "neutral",
  "danger",
];

const filterValues = (s: AssetSearch): Filters => ({
  ...(s.code ? { code: s.code } : {}),
  ...(s.codeOp ? { codeOp: s.codeOp } : {}),
  ...(s.q ? { q: s.q } : {}),
  ...(s.qOp ? { qOp: s.qOp } : {}),
  ...(s.stage ? { stage: s.stage } : {}),
  ...(s.domain ? { domain: s.domain } : {}),
  ...(s.owner ? { owner: s.owner } : {}),
});

const formatCode = (id: number) => `AS-${String(id).padStart(3, "0")}`;

function formatAuditTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleString("zh-CN", { hour12: false });
  }
}

function summarizeAssetAudit(entry: AssetAuditEntry): string {
  const d = entry.detail ?? {};
  if (entry.action === "asset.create") {
    const parts = [
      typeof d.domain === "string" && d.domain ? `业务域 ${d.domain}` : "",
      typeof d.owner === "string" && d.owner ? `团队 ${d.owner}` : "",
      typeof d.stage === "string" && d.stage ? `状态 ${d.stage}` : "",
    ].filter(Boolean);
    return parts.length ? `初始登记（${parts.join(" / ")}）` : "完成资产初始登记";
  }
  if (entry.action === "asset.update") {
    const fields = Array.isArray(d.fields)
      ? d.fields
          .filter((f): f is string => typeof f === "string")
          .map((f) => ASSET_FIELD_LABELS[f] ?? f)
      : [];
    const range =
      d.from !== undefined && d.to !== undefined ? `（${String(d.from)} → ${String(d.to)}）` : "";
    return fields.length ? `变更字段：${fields.join("、")}${range}` : `更新台账信息${range}`;
  }
  if (entry.action === "asset.delete") {
    const parts = [
      typeof d.domain === "string" && d.domain ? `原属 ${d.domain}` : "",
      typeof d.owner === "string" && d.owner ? `团队 ${d.owner}` : "",
    ].filter(Boolean);
    return parts.length ? `移出资产台账（${parts.join(" / ")}）` : "已从资产台账删除";
  }
  if (entry.action === "attachment.upload") {
    return typeof d.filename === "string" && d.filename
      ? `上传凭证附件「${d.filename}」`
      : "上传资产附件凭证";
  }
  if (entry.action === "attachment.delete") {
    return typeof d.filename === "string" && d.filename
      ? `移除凭证附件「${d.filename}」`
      : "删除资产附件凭证";
  }
  return AUDIT_ACTION_LABELS[entry.action] ?? "系统审计记录";
}

function describeRelation(target: Asset, current: Asset): string {
  if (target.domain === current.domain && target.owner === current.owner) return "同域同团队";
  if (target.domain === current.domain) return "同业务域";
  return "同团队跨域";
}

export function AssetDetailPage() {
  const me = useAccount();
  const cache = useQueryClient();
  const canRead = hasPermission(me.data, "assets:read");
  const canManage = hasPermission(me.data, "assets:manage");
  const { assetId } = route.useParams();
  const search = parseAssetSearch(route.useSearch() as Record<string, unknown>);
  const navigate = route.useNavigate();

  const parsedId = /^\d{1,9}$/.test(assetId) ? Number(assetId) : 0;
  const searchKey = JSON.stringify(search);
  const stableSearch = useMemo(() => JSON.parse(searchKey) as AssetSearch, [searchKey]);

  const [tab, setTab] = useState<DetailTab>("peers");
  const [chartView, setChartView] = useState<BenchmarkView>("domain-owners");
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [pending, setPending] = useState<"edit" | "delete" | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const detailQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["assets", "detail", parsedId, stableSearch],
    queryFn: ({ signal }) => assetsApi.detail(parsedId, stableSearch, signal),
    enabled: Boolean(me.data) && canRead && parsedId > 0,
  });

  const stageToggle = useMutation({
    mutationFn: ({ id, nextStage }: { id: number; nextStage: "已登记" | "待复核" }) =>
      request<Asset>(`/assets/${id}`, "PATCH", { stage: nextStage }),
    onSuccess: async (updated) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["assets"] }),
        cache.invalidateQueries({ queryKey: ["audit"] }),
      ]);
      toast.success(`已将 ${updated.name} 状态设为${updated.stage}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "状态更新失败"),
  });

  if (me.data && !canRead) {
    return (
      <div className="panel flex flex-col gap-3">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          无权查看资产台账详情
        </p>
        <div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">返回概览</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (parsedId <= 0) {
    return (
      <div className="panel flex flex-col gap-3">
        <p role="alert" className="m-0 text-sm text-destructive">
          无效的资产编号：{assetId}
        </p>
        <div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/assets" search={stableSearch}>
              <ArrowLeft size={14} aria-hidden="true" />
              返回资产台账
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const data = detailQuery.data;
  const asset = data?.asset;

  const backNav = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/assets" search={stableSearch}>
          <ArrowLeft size={14} aria-hidden="true" />
          返回资产台账
        </Link>
      </Button>
      {data?.neighbor && (data.neighbor.prev || data.neighbor.next || data.neighbor.position) && (
        <div className="flex items-center gap-1.5">
          {data.neighbor.position !== null && (
            <span className="mr-1 text-xs text-muted-foreground tabular-nums">
              队列第 {data.neighbor.position} / {data.neighbor.total} 项
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!data.neighbor.prev}
            aria-label={
              data.neighbor.prev ? `上一条资产：${data.neighbor.prev.name}` : "已是第一条"
            }
            onClick={() => {
              if (!data.neighbor.prev) return;
              void navigate({
                to: "/assets/$assetId",
                params: { assetId: String(data.neighbor.prev.id) },
                search: stableSearch,
              });
            }}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            上一条
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!data.neighbor.next}
            aria-label={
              data.neighbor.next ? `下一条资产：${data.neighbor.next.name}` : "已是最后一条"
            }
            onClick={() => {
              if (!data.neighbor.next) return;
              void navigate({
                to: "/assets/$assetId",
                params: { assetId: String(data.neighbor.next.id) },
                search: stableSearch,
              });
            }}
          >
            下一条
            <ChevronRight size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );

  if (detailQuery.isPending && !data) {
    return (
      <div className="flex flex-col gap-3">
        {backNav}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
        <div className="panel h-80 animate-pulse bg-muted/35" />
      </div>
    );
  }

  if (detailQuery.error || !data || !asset) {
    return (
      <div className="flex flex-col gap-3">
        {backNav}
        <div className="panel flex flex-col gap-3">
          <p role="alert" className="m-0 text-sm text-destructive">
            {detailQuery.error?.message ?? "该资产不存在或已被移除"}
          </p>
        </div>
      </div>
    );
  }

  const { metrics } = data;
  const domainSharePct =
    metrics.ledgerTotal > 0 ? Math.round((metrics.domainTotal / metrics.ledgerTotal) * 100) : 0;
  const domainRegPct =
    metrics.domainTotal > 0
      ? Math.round((metrics.domainRegistered / metrics.domainTotal) * 100)
      : 0;
  const nextStage: "已登记" | "待复核" = asset.stage === "已登记" ? "待复核" : "已登记";

  const readinessSlots: TrackerSlot[] = [
    {
      key: "naming",
      status: asset.name.trim() ? "active" : "warning",
      label: `资产命名规范：${asset.name}`,
    },
    {
      key: "domain",
      status: asset.domain.trim() ? "active" : "warning",
      label: `业务域归属：${asset.domain}`,
    },
    {
      key: "owner",
      status: asset.owner.trim() ? "active" : "warning",
      label: `责任团队明确：${asset.owner}`,
    },
    {
      key: "stage",
      status: asset.stage === "已登记" ? "active" : "warning",
      label: `台账登记状态：${asset.stage}`,
    },
  ];
  const passedChecks = readinessSlots.filter((s) => s.status === "active").length;

  const ownerDonutSegments: DonutSegment[] = data.ownerPeersInDomain.map((item, idx) => ({
    key: item.name,
    label: item.name,
    value: item.total,
    tone:
      item.name === asset.owner
        ? "brand"
        : (CHART_TONES[(idx + 1) % CHART_TONES.length] ?? "neutral"),
  }));

  const domainBarItems: BarListItem[] = data.domainBreakdown.slice(0, 6).map((item) => ({
    key: item.name,
    label: item.name,
    value: item.total,
    valueLabel: `${item.total} 项 (已登记 ${item.registered})`,
    tone: item.name === asset.domain ? "brand" : "neutral",
  }));

  const peerFilterScope: Filters = filterValues(stableSearch);

  return (
    <div className="flex flex-col gap-3">
      {backNav}

      <header className="page-header mb-0 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
            {formatCode(asset.id)}
          </span>
          <h1 className="m-0 truncate text-xl font-semibold tracking-tight text-foreground">
            {asset.name}
          </h1>
          <Badge variant={asset.stage === "已登记" ? "brand" : "warning"}>{asset.stage}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* @starter:agent-start */}
          <AskAssistant
            scope={{
              kind: "assets",
              label: "资产台账",
              route: "/assets",
              filters: peerFilterScope,
            }}
          />
          {/* @starter:agent-end */}
          {canManage && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={stageToggle.isPending}
                onClick={() => stageToggle.mutate({ id: asset.id, nextStage })}
              >
                <CheckCircle2 size={14} aria-hidden="true" />
                {asset.stage === "已登记" ? "标记待复核" : "设为已登记"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setPending("edit");
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                编辑
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setPending("delete");
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                删除
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Layer 1: Quantitative KPI Summary Band */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`${asset.domain} 业务域资产`}
          value={metrics.domainTotal}
          unit="项"
          icon={<Layers size={16} />}
          tone="brand"
          badge={<Badge variant="neutral">占比 {domainSharePct}%</Badge>}
          note={`全库共 ${metrics.ledgerTotal.toLocaleString("zh-CN")} 项资产`}
        />
        <KpiCard
          label="所属业务域登记率"
          value={`${domainRegPct}%`}
          icon={<ShieldCheck size={16} />}
          tone={domainRegPct >= 60 ? "brand" : "warning"}
          note={`已登记 ${metrics.domainRegistered} / 待复核 ${metrics.domainPending}`}
        />
        <KpiCard
          label={`${asset.owner} 在管规模`}
          value={metrics.ownerTotal}
          unit="项"
          icon={<Building2 size={16} />}
          tone={metrics.ownerPending > 0 ? "warning" : "brand"}
          note={`待复核 ${metrics.ownerPending} 项 / 跨域 ${metrics.crossDomainCount} 项`}
        />
        <KpiCard
          label="凭证附件与审计活动"
          value={data.attachmentCount + data.auditTrail.length}
          unit="条"
          icon={<Clock3 size={16} />}
          tone="neutral"
          note={`附件 ${data.attachmentCount} 份 / 审计记录 ${data.auditTrail.length} 条`}
        />
      </div>

      {/* Layer 2: Interactive Topology Canvas + Metadata & Benchmarks */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className={cn("min-w-0", graphExpanded ? "xl:col-span-12" : "xl:col-span-7")}>
          <AssetTopologyGraph
            asset={asset}
            expanded={graphExpanded}
            onToggleExpand={() => setGraphExpanded((v) => !v)}
            onSelectAsset={(targetId) =>
              void navigate({
                to: "/assets/$assetId",
                params: { assetId: String(targetId) },
                search: stableSearch,
              })
            }
            onFilterDomain={(domain) =>
              void navigate({
                to: "/assets",
                search: parseAssetSearch({ domain }),
              })
            }
            onFilterOwner={(owner) =>
              void navigate({
                to: "/assets",
                search: parseAssetSearch({ owner }),
              })
            }
          />
        </div>

        <div
          className={cn(
            "min-w-0 gap-3",
            graphExpanded
              ? "grid grid-cols-1 xl:col-span-12 lg:grid-cols-2"
              : "flex flex-col xl:col-span-5",
          )}
        >
          <section className="flex flex-col gap-3.5 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-border pb-2.5">
              <h2 className="m-0 text-[15px] leading-6 font-semibold text-foreground">
                台账档案与治理完备度
              </h2>
              <Badge variant="neutral">
                达标 {passedChecks} / {readinessSlots.length}
              </Badge>
            </div>

            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">资产编号</dt>
                <dd className="m-0 font-mono text-xs text-foreground tabular-nums">
                  {formatCode(asset.id)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">当前状态</dt>
                <dd className="m-0">
                  <Badge variant={asset.stage === "已登记" ? "brand" : "warning"}>
                    {asset.stage}
                  </Badge>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">所属业务域</dt>
                <dd className="m-0 font-medium text-foreground">{asset.domain}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">责任团队</dt>
                <dd className="m-0 font-medium text-foreground">{asset.owner}</dd>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">同业务域协同团队</dt>
                <dd className="m-0 text-xs text-muted-foreground">
                  {asset.domain} 域共有 {metrics.sameDomainTeamCount} 个协同责任团队共同维护
                </dd>
              </div>
            </dl>

            <div className="flex flex-col gap-2 border-t-[0.5px] border-border pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">四项基础治理核查</span>
                <span className="text-muted-foreground">
                  {asset.stage === "已登记" ? "已完成登记闭环" : "待完成复核确认"}
                </span>
              </div>
              <Tracker slots={readinessSlots} ariaLabel="资产基础治理四项核查" />
            </div>

            <div className="flex flex-col gap-1.5 border-t-[0.5px] border-border pt-3">
              <span className="text-xs font-medium text-muted-foreground">
                {asset.domain} 业务域状态构成
              </span>
              <CategoryBar
                segments={[
                  {
                    key: "registered",
                    label: "已登记",
                    value: metrics.domainRegistered,
                    tone: "brand",
                  },
                  {
                    key: "pending",
                    label: "待复核",
                    value: metrics.domainPending,
                    tone: "warning",
                  },
                ]}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[15px] leading-6 font-semibold text-foreground">
                结构对比与分布分析
              </h2>
              <SegmentedControl
                label="对比分析视角"
                value={chartView}
                onValueChange={setChartView}
                options={[
                  { value: "domain-owners", label: "本域团队构成" },
                  { value: "all-domains", label: "全库业务域" },
                ]}
                className="w-auto min-w-[184px]"
              />
            </div>

            {chartView === "domain-owners" ? (
              <DonutChart
                title={`${asset.domain} 域内责任团队占比`}
                segments={ownerDonutSegments}
                centerLabel="本域资产"
                centerValue={metrics.domainTotal}
                className="border-0 bg-transparent p-0 sm:p-0"
              />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-xs text-muted-foreground">
                  点击任意业务域可在台账列表中筛选查看全部记录
                </p>
                <BarList
                  items={domainBarItems}
                  renderRow={(item, barContent) => (
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/assets",
                          search: parseAssetSearch({ domain: item.key }),
                        })
                      }
                      className={cn(
                        "flex w-full min-w-0 flex-1 rounded-md text-left transition-colors hover:bg-muted/60",
                      )}
                    >
                      {barContent}
                    </button>
                  )}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Layer 3: Related Entities, Attachments & Audit Trail */}
      <PageTabs
        label="资产关联与审计明细"
        value={tab}
        onValueChange={(next) => setTab(next)}
        items={[
          { value: "peers", label: `关联资产 (${data.peerAssets.length})` },
          { value: "attachments", label: `附件与凭证 (${data.attachmentCount})` },
          { value: "audit", label: `变更审计记录 (${data.auditTrail.length})` },
        ]}
      >
        <PageTabsPanel value="peers">
          {data.peerAssets.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">
              暂无同业务域或同责任团队的关联资产。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border-[0.5px] border-border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-[0.5px] border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">编号</th>
                    <th className="px-4 py-2.5 font-medium">资产名称</th>
                    <th className="px-4 py-2.5 font-medium">业务域</th>
                    <th className="px-4 py-2.5 font-medium">责任团队</th>
                    <th className="px-4 py-2.5 font-medium">关联关系</th>
                    <th className="px-4 py-2.5 font-medium">登记状态</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.peerAssets.map((peer) => (
                    <tr
                      key={peer.id}
                      className="border-b-[0.5px] border-border last:border-b-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatCode(peer.id)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{peer.name}</td>
                      <td className="px-4 py-2.5 text-foreground">{peer.domain}</td>
                      <td className="px-4 py-2.5 text-foreground">{peer.owner}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="neutral">{describeRelation(peer, asset)}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={peer.stage === "已登记" ? "brand" : "warning"}>
                          {peer.stage}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void navigate({
                              to: "/assets/$assetId",
                              params: { assetId: String(peer.id) },
                              search: stableSearch,
                            })
                          }
                        >
                          查看详情
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PageTabsPanel>

        <PageTabsPanel value="attachments">
          <div className="panel">
            <AttachmentPanel entityId={asset.id} canManage={canManage} />
          </div>
        </PageTabsPanel>

        <PageTabsPanel value="audit">
          {data.auditTrail.length === 0 ? (
            <div className="panel text-sm text-muted-foreground">
              暂无与该资产相关的操作审计记录（历史演示种子记录未写入增量审计流水）。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border-[0.5px] border-border bg-card">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-[0.5px] border-border text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">操作时间</th>
                    <th className="px-4 py-2.5 font-medium">操作类型</th>
                    <th className="px-4 py-2.5 font-medium">来源</th>
                    <th className="px-4 py-2.5 font-medium">操作人</th>
                    <th className="px-4 py-2.5 font-medium">变更说明</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditTrail.map((entry) => {
                    const src: ActorSource = entry.actorSource ?? "human";
                    return (
                      <tr
                        key={entry.id}
                        className="border-b-[0.5px] border-border last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                          {formatAuditTime(entry.at, data.timezone)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={src === "human" ? "neutral" : "brand"}>
                            {ACTOR_SOURCE_LABELS[src] ?? "人工"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">
                          {entry.actorName || entry.actorUsername}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {summarizeAssetAudit(entry)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PageTabsPanel>
      </PageTabs>

      {pending === "edit" && (
        <AssetFormDialog
          asset={asset}
          trigger={returnFocus.current}
          close={(msg) => {
            setPending(null);
            if (msg) {
              void cache.invalidateQueries({ queryKey: ["audit"] });
              toast.success(msg);
            }
          }}
        />
      )}

      {pending === "delete" && (
        <ConfirmDialog
          title="删除资产"
          description={`将从台账中删除「${asset.name}」，并写入操作日志。`}
          submitText="删除资产"
          trigger={returnFocus.current}
          action={() => request(`/assets/${asset.id}`, "DELETE", {})}
          close={async (done) => {
            const name = asset.name;
            setPending(null);
            if (done) {
              await Promise.all([
                cache.invalidateQueries({ queryKey: ["assets"] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(`已删除资产 ${name}`);
              void navigate({ to: "/assets", search: stableSearch, replace: true });
            }
          }}
        />
      )}
    </div>
  );
}
