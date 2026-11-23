import { JOB_STATUS_LABELS, JOB_TYPE_LABELS } from "@optimax-starter/api";
import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  KeyRound,
  LogOut,
  type LucideIcon,
  Pencil,
  Power,
  RotateCw,
  ShieldCheck,
  Terminal,
  UserPlus,
  Users,
} from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BarList } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { CategoryBar } from "@/components/ui/category-bar";
import { DonutChart, type DonutSegment } from "@/components/ui/donut-chart";
import { KpiCard, KpiCardError, KpiCardSkeleton } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Tracker } from "@/components/ui/tracker";
import { TrendAreaChart, type TrendChartType } from "@/components/ui/trend-area-chart";
import type { NavTarget } from "@/config/app-config";
import {
  type Account,
  type AuditEntry,
  type AuditPage,
  type JobPage,
  request,
  type SystemStatusResponse,
} from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { AUDIT_ACTION_LABELS } from "@/features/filters/search";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";
import {
  buildAuditActionRanking,
  buildAuditActorRanking,
  buildAuditDailyTrend,
  buildJobTrackerSlots,
} from "./dashboard-utils";
import {
  DASHBOARD_MODULES,
  type DashboardModuleSpec,
  type DashboardModuleSummary,
} from "./registry";

const AUDIT_TREND_FETCH_SIZE = 100;
const ACTIVITY_DISPLAY_SIZE = 5;
const JOB_TRACKER_SLOTS = 24;

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  "account.create": UserPlus,
  "account.update": Pencil,
  "account.role": ShieldCheck,
  "account.status": Power,
  "account.password_reset": KeyRound,
  "account.revoke": LogOut,
  "profile.update": Pencil,
  "profile.password_change": KeyRound,
  "profile.session_revoke": LogOut,
  "permission.update": ShieldCheck,
  "permission.reset": ShieldCheck,
  "system.timezone_update": Clock,
  "system.ai_circuit": Power,
  "agent.asset_filter": Activity,
  "asset.create": Boxes,
  "asset.update": Pencil,
  "asset.bulk_update": Pencil,
  "asset.bulk_delete": Boxes,
};

type TrendRange = "7d" | "30d";
type DashboardView = "overview" | "governance";
type ActivitySourceFilter = "all" | "human" | "agent";
type ModuleViewMode = "breakdown" | "table";

const DASHBOARD_VIEW_OPTIONS: readonly { value: DashboardView; label: string }[] = [
  { value: "overview", label: "业务总览" },
  { value: "governance", label: "治理与审计" },
];

const ACTIVITY_SOURCE_OPTIONS: readonly { value: ActivitySourceFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "human", label: "人工" },
  { value: "agent", label: "Agent" },
];

const MODULE_VIEW_OPTIONS: readonly { value: ModuleViewMode; label: string }[] = [
  { value: "breakdown", label: "分布视图" },
  { value: "table", label: "明细预览" },
];

const TREND_RANGE_OPTIONS: readonly { value: TrendRange; label: string }[] = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
];

const TREND_SERIES = [
  { key: "human", label: "人工操作", tone: "brand" as const },
  { key: "agent", label: "Agent 操作", tone: "success" as const },
];

function computeSummaryMetrics(points: ReturnType<typeof buildAuditDailyTrend>, range: TrendRange) {
  let total = 0;
  let human = 0;
  let agent = 0;
  let peak = 0;
  let peakLabel = "—";
  for (const p of points) {
    total += p.total;
    human += p.human;
    agent += p.agent;
    if (p.total > peak) {
      peak = p.total;
      peakLabel = p.label;
    }
  }
  const humanPct = total > 0 ? Math.round((human / total) * 100) : 0;
  const agentPct = total > 0 ? Math.round((agent / total) * 100) : 0;
  return [
    {
      label: "总操作次数",
      value: total,
      hint: range === "7d" ? "近 7 天" : "近 30 天",
    },
    {
      label: "人工操作",
      value: human,
      hint: total > 0 ? `占 ${humanPct}%` : undefined,
    },
    {
      label: "Agent 操作",
      value: agent,
      hint: total > 0 ? `占 ${agentPct}%` : undefined,
    },
    {
      label: "单日峰值",
      value: peak,
      hint: peak > 0 ? peakLabel : "暂无峰值",
    },
  ];
}

export function DashboardPage() {
  const runRefresh = useContentRefresh();
  const me = useAccount();
  const [dashView, setDashView] = useState<DashboardView>("overview");
  const [trendRange, setTrendRange] = useState<TrendRange>("7d");
  const [trendChartType, setTrendChartType] = useState<TrendChartType>("area");
  const [activitySource, setActivitySource] = useState<ActivitySourceFilter>("all");
  const [selectedModuleId, setSelectedModuleId] = useState<string>("");

  const canReadAccounts = hasPermission(me.data, "accounts:read");
  const canReadAudit = hasPermission(me.data, "audit:read");
  const canReadJobs = hasPermission(me.data, "jobs:read");
  const canReadSystem =
    hasPermission(me.data, "system:settings:read") || hasPermission(me.data, "system:ai:read");
  const isGovernanceView = canReadAudit || canReadAccounts || canReadSystem || canReadJobs;

  const visibleModules = useMemo(
    () => DASHBOARD_MODULES.filter((mod) => hasPermission(me.data, mod.permissionCode)),
    [me.data],
  );

  const moduleQueries = useQueries({
    queries: visibleModules.map((mod) => ({
      meta: { contentRefresh: true },
      queryKey: ["dashboard-module", mod.id],
      queryFn: () => mod.fetchSummary(),
      enabled: Boolean(me.data),
    })),
  });

  const accounts = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["accounts"],
    queryFn: () => request<Account[]>("/accounts"),
    enabled: Boolean(me.data) && canReadAccounts,
  });

  const auditPage = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["audit", "dashboard-trend"],
    queryFn: () => request<AuditPage>(`/audit?size=${AUDIT_TREND_FETCH_SIZE}`),
    enabled: Boolean(me.data) && canReadAudit,
  });

  const jobsPage = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["jobs", "dashboard-tracker"],
    queryFn: () => request<JobPage>(`/jobs?size=${JOB_TRACKER_SLOTS}`),
    enabled: Boolean(me.data) && canReadJobs,
  });

  const systemStatus = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["system", "status"],
    queryFn: () => request<SystemStatusResponse>("/system/status"),
    enabled: Boolean(me.data) && canReadSystem,
  });

  const fetching =
    moduleQueries.some((q) => q.isFetching) ||
    (canReadAccounts && accounts.isFetching) ||
    (canReadAudit && auditPage.isFetching) ||
    (canReadJobs && jobsPage.isFetching) ||
    (canReadSystem && systemStatus.isFetching);

  const activeModuleIndex = Math.max(
    0,
    visibleModules.findIndex((m) => m.id === selectedModuleId),
  );
  const activeModule = visibleModules[activeModuleIndex];
  const activeModuleQuery = moduleQueries[activeModuleIndex];

  const timeZone = auditPage.data?.timezone || "Asia/Shanghai";
  const auditItems = auditPage.data?.items ?? [];

  const spark7 = useMemo(
    () => buildAuditDailyTrend(auditItems, 7, timeZone),
    [auditItems, timeZone],
  );
  const trendData = useMemo(
    () => buildAuditDailyTrend(auditItems, trendRange === "30d" ? 30 : 7, timeZone),
    [auditItems, trendRange, timeZone],
  );
  const trendSummaryMetrics = useMemo(
    () => computeSummaryMetrics(trendData, trendRange),
    [trendData, trendRange],
  );
  const actionRanking = useMemo(() => buildAuditActionRanking(auditItems, 6), [auditItems]);
  const actorRanking = useMemo(() => buildAuditActorRanking(auditItems, 6), [auditItems]);
  const filteredActivity = useMemo(
    () =>
      activitySource === "all"
        ? auditItems
        : auditItems.filter((item) => item.actorSource === activitySource),
    [auditItems, activitySource],
  );
  const jobTracker = useMemo(
    () => buildJobTrackerSlots(jobsPage.data?.items ?? [], JOB_TRACKER_SLOTS),
    [jobsPage.data],
  );

  const activeAccountsCount = accounts.data?.filter((a) => a.active).length ?? 0;
  const totalAccountsCount = accounts.data?.length ?? 0;
  const disabledAccountsCount = Math.max(0, totalAccountsCount - activeAccountsCount);
  const sum7 = spark7.reduce((acc, p) => acc + p.total, 0);
  const agent7 = spark7.reduce((acc, p) => acc + p.agent, 0);

  const firstModule = visibleModules[0];
  const firstModuleQuery = moduleQueries[0];
  const secondModule = visibleModules[1];
  const secondModuleQuery = moduleQueries[1];
  const currentView: DashboardView = isGovernanceView ? dashView : "overview";

  const activeSummary = activeModuleQuery?.data;
  const compositionDonut = useMemo<{
    title: string;
    segments: DonutSegment[];
    centerValue: string | number;
    centerLabel: string;
    footer?: string;
  } | null>(() => {
    if (activeModule && activeSummary?.segments.length) {
      return {
        title: `${activeModule.label}构成`,
        segments: activeSummary.segments.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          tone: s.tone,
        })),
        centerValue:
          activeSummary.completionRate !== undefined
            ? `${activeSummary.completionRate}%`
            : activeSummary.total,
        centerLabel: activeSummary.completionLabel ?? activeSummary.unit,
        footer: `全量 ${activeSummary.total} ${activeSummary.unit}`,
      };
    }
    if (canReadAudit) {
      let humanCount = 0;
      let agentCount = 0;
      let systemCount = 0;
      for (const item of auditItems) {
        if (item.actorSource === "agent") agentCount += 1;
        else if (item.actorSource === "system") systemCount += 1;
        else humanCount += 1;
      }
      return {
        title: "操作主体分布",
        segments: [
          { key: "human", label: "人工操作", value: humanCount, tone: "brand" },
          { key: "agent", label: "Agent 操作", value: agentCount, tone: "warning" },
          { key: "system", label: "系统自动", value: systemCount, tone: "success" },
        ],
        centerValue: auditItems.length,
        centerLabel: "近期样本",
        footer: `当前统计基于最近 ${auditItems.length} 条记录`,
      };
    }
    return null;
  }, [activeModule, activeSummary, auditItems, canReadAudit]);

  const handleRefresh = () => {
    void runRefresh(() =>
      Promise.all([
        ...moduleQueries.map((q) => q.refetch()),
        ...(canReadAccounts ? [accounts.refetch()] : []),
        ...(canReadAudit ? [auditPage.refetch()] : []),
        ...(canReadJobs ? [jobsPage.refetch()] : []),
        ...(canReadSystem ? [systemStatus.refetch()] : []),
      ]),
    );
  };

  return (
    <>
      <PageHeader
        title="工作台"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {isGovernanceView ? (
              <div className="w-auto min-w-[172px]">
                <SegmentedControl
                  label="工作台视图"
                  value={currentView}
                  onValueChange={setDashView}
                  options={DASHBOARD_VIEW_OPTIONS}
                  className="h-8"
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="刷新"
              aria-label="刷新工作台"
              disabled={fetching}
              onClick={handleRefresh}
            >
              <RotateCw size={15} className={fetching ? "animate-spin" : undefined} />
            </Button>
          </div>
        }
      />

      {currentView === "governance" ? (
        <GovernanceView
          canReadAudit={canReadAudit}
          canReadJobs={canReadJobs}
          canReadSystem={canReadSystem}
          canReadAccounts={canReadAccounts}
          auditPage={auditPage}
          jobsPage={jobsPage}
          systemStatus={systemStatus}
          accounts={accounts}
          actionRanking={actionRanking}
          actorRanking={actorRanking}
          jobTracker={jobTracker}
          activeAccountsCount={activeAccountsCount}
          disabledAccountsCount={disabledAccountsCount}
          timeZone={timeZone}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {renderTopKpis({
              isGovernanceView,
              firstModule,
              firstModuleQuery,
              secondModule,
              secondModuleQuery,
              canReadAccounts,
              accounts,
              activeAccountsCount,
              disabledAccountsCount,
              canReadAudit,
              auditPage,
              spark7,
              sum7,
              agent7,
              canReadJobs,
              jobsPage,
              jobTracker,
              canReadSystem,
              systemStatus,
            })}
          </div>

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
              {canReadAudit ? (
                auditPage.isPending ? (
                  <PanelSkeleton height={310} />
                ) : auditPage.isError ? (
                  <KpiCardError
                    message={auditPage.error.message}
                    onRetry={() => void auditPage.refetch()}
                  />
                ) : (
                  <TrendAreaChart
                    title="操作趋势"
                    subtitle={
                      (auditPage.data?.total ?? 0) > AUDIT_TREND_FETCH_SIZE
                        ? `统计口径：${timeZone} 按日（近 ${AUDIT_TREND_FETCH_SIZE} 条）`
                        : `统计口径：${timeZone} 按日`
                    }
                    data={trendData}
                    series={TREND_SERIES}
                    range={trendRange}
                    rangeOptions={TREND_RANGE_OPTIONS}
                    onRangeChange={setTrendRange}
                    chartType={trendChartType}
                    onChartTypeChange={setTrendChartType}
                    summaryMetrics={trendSummaryMetrics}
                    height={212}
                    className="p-4 sm:p-5"
                  />
                )
              ) : (
                <ModuleOverviewPanel
                  visibleModules={visibleModules}
                  activeModule={activeModule}
                  activeModuleQuery={activeModuleQuery}
                  selectedModuleId={activeModule?.id ?? ""}
                  onSelectModule={setSelectedModuleId}
                />
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
              {compositionDonut ? (
                <DonutChart
                  title={compositionDonut.title}
                  segments={compositionDonut.segments}
                  centerValue={compositionDonut.centerValue}
                  centerLabel={compositionDonut.centerLabel}
                  footer={compositionDonut.footer}
                />
              ) : null}

              {isGovernanceView && (canReadSystem || canReadJobs) ? (
                <SystemHealthPanel
                  canReadSystem={canReadSystem}
                  canReadJobs={canReadJobs}
                  systemStatus={systemStatus}
                  jobsPage={jobsPage}
                  jobTracker={jobTracker}
                />
              ) : null}
            </div>
          </div>

          {canReadAudit ? (
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
              <div className="min-w-0 xl:col-span-7">
                <ModuleOverviewPanel
                  visibleModules={visibleModules}
                  activeModule={activeModule}
                  activeModuleQuery={activeModuleQuery}
                  selectedModuleId={activeModule?.id ?? ""}
                  onSelectModule={setSelectedModuleId}
                />
              </div>

              <div className="min-w-0 xl:col-span-5">
                <Panel
                  title="最近操作"
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-auto min-w-[144px]">
                        <SegmentedControl
                          label="操作来源筛选"
                          value={activitySource}
                          onValueChange={setActivitySource}
                          options={ACTIVITY_SOURCE_OPTIONS}
                          className="h-8"
                        />
                      </div>
                      <Link
                        to={"/audit" as never}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <span>操作日志</span>
                        <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    </div>
                  }
                >
                  <LoadedQuery
                    query={auditPage}
                    empty={activitySource === "all" ? "暂无操作记录" : "当前来源筛选下暂无操作记录"}
                    isEmpty={() => !filteredActivity.length}
                  >
                    {() => <RecentActivityList items={filteredActivity} timeZone={timeZone} />}
                  </LoadedQuery>
                </Panel>
              </div>
            </div>
          ) : activeModule && activeModuleQuery ? (
            <Panel
              title={activeModuleQuery.data?.queueTitle || `${activeModule.label}待办`}
              action={
                <Link
                  to={activeModule.to as never}
                  search={(activeModuleQuery.data?.queueSearch ?? {}) as never}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>查看全部</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <LoadedQuery
                query={activeModuleQuery}
                empty="暂无待处理事项"
                isEmpty={(d) => !d.queueItems?.length}
              >
                {(d) => (
                  <ModuleQueueList
                    items={d.queueItems ?? []}
                    overflowCount={d.queueOverflowCount ?? 0}
                  />
                )}
              </LoadedQuery>
            </Panel>
          ) : null}

          <QuickAccessRow
            firstModule={firstModule}
            firstSummary={firstModuleQuery?.data}
            canReadAccounts={canReadAccounts}
            disabledAccountsCount={accounts.data ? disabledAccountsCount : undefined}
            canReadAudit={canReadAudit}
            canReadSystem={canReadSystem}
            canReadJobs={canReadJobs}
          />
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ top 4 KPIs
function renderTopKpis(ctx: {
  isGovernanceView: boolean;
  firstModule?: DashboardModuleSpec;
  firstModuleQuery?: UseQueryResult<DashboardModuleSummary, Error>;
  secondModule?: DashboardModuleSpec;
  secondModuleQuery?: UseQueryResult<DashboardModuleSummary, Error>;
  canReadAccounts: boolean;
  accounts: UseQueryResult<Account[], Error>;
  activeAccountsCount: number;
  disabledAccountsCount: number;
  canReadAudit: boolean;
  auditPage: UseQueryResult<AuditPage, Error>;
  spark7: { label: string; total: number }[];
  sum7: number;
  agent7: number;
  canReadJobs: boolean;
  jobsPage: UseQueryResult<JobPage, Error>;
  jobTracker: ReturnType<typeof buildJobTrackerSlots>;
  canReadSystem: boolean;
  systemStatus: UseQueryResult<SystemStatusResponse, Error>;
}): ReactNode[] {
  const cards: ReactNode[] = [];

  if (!ctx.isGovernanceView && ctx.firstModule && ctx.firstModuleQuery) {
    const mod = ctx.firstModule;
    const q = ctx.firstModuleQuery;
    if (q.isPending) return [0, 1, 2, 3].map((i) => <KpiCardSkeleton key={i} />);
    if (q.isError) {
      return [
        <KpiCardError
          key="mod-err"
          message={q.error.message}
          onRetry={() => void q.refetch()}
          className="sm:col-span-2 xl:col-span-4"
        />,
      ];
    }
    const d = q.data;
    cards.push(renderPrimaryModuleKpi(mod, d));
    if (d.secondaryStat) {
      const sec = d.secondaryStat;
      cards.push(
        <KpiCard
          key="mod-sec"
          label={sec.label}
          value={sec.value}
          unit={sec.unit}
          icon={<Clock size={16} aria-hidden="true" />}
          tone={sec.tone ?? "warning"}
          renderMain={(content) => (
            <Link
              to={sec.to as never}
              search={(sec.search ?? {}) as never}
              className="block rounded-md text-inherit no-underline"
            >
              {content}
            </Link>
          )}
          links={(sec.links ?? []).map((l, i) => (
            <Link
              key={i}
              to={l.to as never}
              search={(l.search ?? {}) as never}
              className="text-inherit no-underline hover:text-foreground hover:underline"
            >
              {l.label}
            </Link>
          ))}
        />,
      );
    }
    for (const extra of (d.extraStats ?? []).slice(0, 4 - cards.length)) {
      cards.push(
        <KpiCard
          key={extra.label}
          label={extra.label}
          value={extra.value}
          unit={extra.unit}
          icon={<Boxes size={16} aria-hidden="true" />}
          tone={extra.tone ?? "brand"}
          renderMain={(content) => (
            <Link
              to={extra.to as never}
              search={(extra.search ?? {}) as never}
              className="block rounded-md text-inherit no-underline"
            >
              {content}
            </Link>
          )}
          note={extra.note}
        />,
      );
    }
    return cards;
  }

  // Admin / Governance layout (with or without business modules)
  if (ctx.firstModule && ctx.firstModuleQuery) {
    const q = ctx.firstModuleQuery;
    if (q.isPending) cards.push(<KpiCardSkeleton key="m1" />);
    else if (q.isError) {
      cards.push(
        <KpiCardError key="m1" message={q.error.message} onRetry={() => void q.refetch()} />,
      );
    } else cards.push(renderPrimaryModuleKpi(ctx.firstModule, q.data));

    if (ctx.secondModule && ctx.secondModuleQuery) {
      const q2 = ctx.secondModuleQuery;
      if (q2.isPending) cards.push(<KpiCardSkeleton key="m2" />);
      else if (q2.isError) {
        cards.push(
          <KpiCardError key="m2" message={q2.error.message} onRetry={() => void q2.refetch()} />,
        );
      } else cards.push(renderPrimaryModuleKpi(ctx.secondModule, q2.data));
    } else if (q.data?.secondaryStat) {
      const sec = q.data.secondaryStat;
      cards.push(
        <KpiCard
          key="m1-sec"
          label={sec.label}
          value={sec.value}
          unit={sec.unit}
          icon={<Clock size={16} aria-hidden="true" />}
          tone={sec.tone ?? "warning"}
          renderMain={(content) => (
            <Link
              to={sec.to as never}
              search={(sec.search ?? {}) as never}
              className="block rounded-md text-inherit no-underline"
            >
              {content}
            </Link>
          )}
          links={(sec.links ?? []).map((l, i) => (
            <Link
              key={i}
              to={l.to as never}
              search={(l.search ?? {}) as never}
              className="text-inherit no-underline hover:text-foreground hover:underline"
            >
              {l.label}
            </Link>
          ))}
        />,
      );
    }
  } else {
    // `--no-example` 空白系统场景：展示完整核心治理 KPI
    if (ctx.canReadAccounts) {
      cards.push(
        renderAccountsKpi(ctx.accounts, ctx.activeAccountsCount, ctx.disabledAccountsCount),
      );
    }
    if (ctx.canReadJobs) {
      cards.push(renderJobsKpi(ctx.jobsPage, ctx.jobTracker));
    }
  }

  if (ctx.canReadAudit) {
    cards.push(renderAudit7dKpi(ctx.auditPage, ctx.spark7, ctx.sum7, ctx.agent7));
  }

  if (cards.length < 4 && (ctx.canReadSystem || (ctx.firstModule && ctx.canReadAccounts))) {
    cards.push(
      renderPlatformKpi({
        canReadSystem: ctx.canReadSystem,
        systemStatus: ctx.systemStatus,
        canReadAccounts: ctx.canReadAccounts,
        accounts: ctx.accounts,
        activeAccountsCount: ctx.activeAccountsCount,
        disabledAccountsCount: ctx.disabledAccountsCount,
      }),
    );
  }

  if (cards.length < 4 && ctx.canReadJobs && ctx.firstModule) {
    cards.push(renderJobsKpi(ctx.jobsPage, ctx.jobTracker));
  }

  return cards.slice(0, 4);
}

function renderPrimaryModuleKpi(mod: DashboardModuleSpec, data: DashboardModuleSummary) {
  const Icon = mod.icon;
  return (
    <KpiCard
      key={`mod-${mod.id}`}
      label={data.primaryLabel}
      value={data.total}
      unit={data.unit}
      icon={<Icon size={16} aria-hidden="true" />}
      tone={data.primaryTone ?? "brand"}
      badge={data.primaryBadge ? <Badge variant="brand">{data.primaryBadge}</Badge> : undefined}
      renderMain={(content) => (
        <Link to={mod.to as never} className="block rounded-md text-inherit no-underline">
          {content}
        </Link>
      )}
      links={(data.primaryLinks ?? []).map((l, i) => (
        <Link
          key={i}
          to={l.to as never}
          search={(l.search ?? {}) as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          {l.label}
        </Link>
      ))}
      note={
        data.completionRate !== undefined ? (
          <div
            className="flex items-center gap-1.5"
            title={`${data.completionLabel ?? "完成率"} ${data.completionRate}%`}
          >
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, data.completionRate))}%` }}
              />
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

function renderAccountsKpi(
  accounts: UseQueryResult<Account[], Error>,
  activeCount: number,
  disabledCount: number,
) {
  if (accounts.isPending) return <KpiCardSkeleton key="kpi-accounts" />;
  if (accounts.isError) {
    return (
      <KpiCardError
        key="kpi-accounts"
        message={accounts.error.message}
        onRetry={() => void accounts.refetch()}
      />
    );
  }
  return (
    <KpiCard
      key="kpi-accounts"
      label="启用账户"
      value={activeCount}
      unit="人"
      icon={<Users size={16} aria-hidden="true" />}
      tone="brand"
      badge={<Badge variant="neutral">共 {accounts.data.length}</Badge>}
      renderMain={(content) => (
        <Link to={"/accounts" as never} className="block rounded-md text-inherit no-underline">
          {content}
        </Link>
      )}
      links={[
        <Link
          key="active"
          to={"/accounts" as never}
          search={{ status: "active" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          已启用 {activeCount}
        </Link>,
        <Link
          key="disabled"
          to={"/accounts" as never}
          search={{ status: "disabled" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          已停用 {disabledCount}
        </Link>,
      ]}
    />
  );
}

function renderAudit7dKpi(
  auditPage: UseQueryResult<AuditPage, Error>,
  spark7: { label: string; total: number }[],
  sum7: number,
  agent7: number,
) {
  if (auditPage.isPending) return <KpiCardSkeleton key="kpi-audit" />;
  if (auditPage.isError) {
    return (
      <KpiCardError
        key="kpi-audit"
        message={auditPage.error.message}
        onRetry={() => void auditPage.refetch()}
      />
    );
  }
  const agentPct = sum7 > 0 ? Math.round((agent7 / sum7) * 100) : 0;
  return (
    <KpiCard
      key="kpi-audit"
      label="近 7 日操作"
      value={sum7}
      unit="次"
      icon={<Activity size={16} aria-hidden="true" />}
      tone="brand"
      badge={agent7 > 0 ? <Badge variant="success">Agent {agentPct}%</Badge> : undefined}
      sparkline={spark7.map((p) => ({ label: p.label, value: p.total }))}
      renderMain={(content) => (
        <Link to={"/audit" as never} className="block rounded-md text-inherit no-underline">
          {content}
        </Link>
      )}
      links={[
        <Link
          key="human"
          to={"/audit" as never}
          search={{ source: "human" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          人工 {sum7 - agent7}
        </Link>,
        <Link
          key="agent"
          to={"/audit" as never}
          search={{ source: "agent" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          Agent {agent7}
        </Link>,
      ]}
    />
  );
}

function renderJobsKpi(
  jobsPage: UseQueryResult<JobPage, Error>,
  jobTracker: ReturnType<typeof buildJobTrackerSlots>,
) {
  if (jobsPage.isPending) return <KpiCardSkeleton key="kpi-jobs" />;
  if (jobsPage.isError) {
    return (
      <KpiCardError
        key="kpi-jobs"
        message={jobsPage.error.message}
        onRetry={() => void jobsPage.refetch()}
      />
    );
  }
  const hasFailure = jobTracker.danger > 0;
  return (
    <KpiCard
      key="kpi-jobs"
      label="后台任务"
      value={jobsPage.data.total}
      unit="个"
      icon={<CheckCircle2 size={16} aria-hidden="true" />}
      tone={hasFailure ? "danger" : "success"}
      badge={
        hasFailure ? (
          <Badge variant="danger">失败 {jobTracker.danger}</Badge>
        ) : jobTracker.active > 0 ? (
          <Badge variant="brand">执行中 {jobTracker.active}</Badge>
        ) : (
          <Badge variant="success">队列正常</Badge>
        )
      }
      renderMain={(content) => (
        <Link
          to={"/system" as never}
          search={{ tab: "jobs" } as never}
          className="block rounded-md text-inherit no-underline"
        >
          {content}
        </Link>
      )}
      links={[
        <Link
          key="done"
          to={"/system" as never}
          search={{ tab: "jobs", status: "succeeded" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          已完成 {jobTracker.ok}
        </Link>,
        <Link
          key="fail"
          to={"/system" as never}
          search={{ tab: "jobs", status: "failed" } as never}
          className="text-inherit no-underline hover:text-foreground hover:underline"
        >
          失败 {jobTracker.danger}
        </Link>,
      ]}
    />
  );
}

function renderPlatformKpi(ctx: {
  canReadSystem: boolean;
  systemStatus: UseQueryResult<SystemStatusResponse, Error>;
  canReadAccounts: boolean;
  accounts: UseQueryResult<Account[], Error>;
  activeAccountsCount: number;
  disabledAccountsCount: number;
}) {
  if (ctx.canReadSystem) {
    if (ctx.systemStatus.isPending) return <KpiCardSkeleton key="kpi-sys" />;
    if (ctx.systemStatus.isError) {
      return (
        <KpiCardError
          key="kpi-sys"
          message={ctx.systemStatus.error.message}
          onRetry={() => void ctx.systemStatus.refetch()}
        />
      );
    }
    const sys = ctx.systemStatus.data;
    const ok = sys.overall === "ok";
    const headline =
      ctx.canReadAccounts && ctx.accounts.data ? ctx.activeAccountsCount : ok ? "正常" : "异常";
    const unit = ctx.canReadAccounts && ctx.accounts.data ? "启用账户" : undefined;

    return (
      <KpiCard
        key="kpi-sys"
        label={ctx.canReadAccounts ? "系统与账户" : "系统探针"}
        value={headline}
        unit={unit}
        icon={<Cpu size={16} aria-hidden="true" />}
        tone={ok ? "success" : "danger"}
        badge={<Badge variant={ok ? "success" : "danger"}>{ok ? "运行正常" : "服务降级"}</Badge>}
        renderMain={(content) => (
          <Link
            to={(ctx.canReadAccounts ? "/accounts" : "/system") as never}
            className="block rounded-md text-inherit no-underline"
          >
            {content}
          </Link>
        )}
        links={[
          ...(ctx.canReadAccounts && ctx.accounts.data
            ? [
                <Link
                  key="acc"
                  to={"/accounts" as never}
                  search={{ status: "disabled" } as never}
                  className="text-inherit no-underline hover:text-foreground hover:underline"
                >
                  停用 {ctx.disabledAccountsCount}
                </Link>,
              ]
            : []),
          <Link
            key="lat"
            to={"/system" as never}
            search={{ tab: "status" } as never}
            className="text-inherit no-underline hover:text-foreground hover:underline"
          >
            延迟 {sys.probe.dbLatencyMs !== null ? `${sys.probe.dbLatencyMs}ms` : "-"}
          </Link>,
          <span key="sess">会话 {sys.probe.activeSessions}</span>,
        ]}
      />
    );
  }

  return renderAccountsKpi(ctx.accounts, ctx.activeAccountsCount, ctx.disabledAccountsCount);
}

// ------------------------------------------------------------------ panels
function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="m-0 text-[15px] leading-6 font-semibold text-foreground">
            {title}
          </h2>
          {subtitle ? <p className="m-0 mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PanelSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-label="正在加载面板"
      className="flex flex-col justify-between rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5"
      style={{ height }}
    >
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="h-32 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

function LoadedQuery<D>({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<D, Error>;
  empty: string;
  isEmpty: (data: D) => boolean;
  children: (data: D) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="正在加载"
        className="flex min-h-[120px] flex-col justify-center gap-2.5"
      >
        <span className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        <span className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div
        role="alert"
        className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"
      >
        <p className="m-0">{query.error.message || "加载失败"}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }
  if (isEmpty(query.data)) {
    return (
      <p className="m-0 grid min-h-[108px] place-items-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return <>{children(query.data)}</>;
}

function ModuleOverviewPanel({
  visibleModules,
  activeModule,
  activeModuleQuery,
  selectedModuleId,
  onSelectModule,
}: {
  visibleModules: readonly DashboardModuleSpec[];
  activeModule?: DashboardModuleSpec;
  activeModuleQuery?: UseQueryResult<DashboardModuleSummary, Error>;
  selectedModuleId: string;
  onSelectModule: (id: string) => void;
}) {
  const [viewMode, setViewMode] = useState<ModuleViewMode>("breakdown");
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string>("");

  if (!visibleModules.length) {
    return (
      <Panel title="业务模块">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] px-3.5 py-3 text-xs text-muted-foreground">
          <span>尚未接入业务台账模块，运行脚手架命令后自动挂载至工作台</span>
          <code className="rounded border-[0.5px] border-border bg-card px-2 py-1 text-[12px] text-foreground">
            bun run gen:module &lt;slug&gt; --label &lt;名称&gt;
          </code>
        </div>
      </Panel>
    );
  }

  if (!activeModule || !activeModuleQuery) return null;

  const summaryData = activeModuleQuery.data;
  const hasPreviewTable = Boolean(summaryData?.previewRows?.length);

  return (
    <Panel
      title={visibleModules.length > 1 ? "业务模块" : activeModule.label}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {visibleModules.length > 1 ? (
            <div className="w-auto min-w-[140px]">
              <SegmentedControl
                label="切换业务模块"
                value={selectedModuleId}
                onValueChange={(next) => {
                  setSelectedDimensionKey("");
                  onSelectModule(next);
                }}
                options={visibleModules.map((m) => ({ value: m.id, label: m.label }))}
                className="h-8"
              />
            </div>
          ) : null}
          {hasPreviewTable ? (
            <div className="w-auto min-w-[140px]">
              <SegmentedControl
                label="模块展示形态"
                value={viewMode}
                onValueChange={setViewMode}
                options={MODULE_VIEW_OPTIONS}
                className="h-8"
              />
            </div>
          ) : null}
          <Link
            to={activeModule.to as never}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <span>进入台账</span>
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      }
    >
      <LoadedQuery
        query={activeModuleQuery}
        empty="暂无业务数据"
        isEmpty={(d) => !d.breakdown.length && !d.segments.length}
      >
        {(summary) => {
          const dimensions = summary.dimensions?.length
            ? summary.dimensions
            : [
                {
                  key: "default",
                  label: summary.breakdownTitle,
                  items: summary.breakdown,
                },
              ];
          const activeDimension =
            dimensions.find((d) => d.key === selectedDimensionKey) ?? dimensions[0];
          const breakdownRows = activeDimension?.items ?? summary.breakdown;

          return (
            <div className="flex flex-col gap-4">
              {summary.segments.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {summary.segmentsTitle ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      {summary.segmentsTitle}
                    </span>
                  ) : null}
                  <CategoryBar
                    segments={summary.segments}
                    renderLegendItem={(seg, content) => {
                      const matched = summary.segments.find((s) => s.key === seg.key);
                      if (!matched?.to) return content;
                      return (
                        <Link
                          to={matched.to as never}
                          search={(matched.search ?? {}) as never}
                          className="rounded no-underline hover:underline"
                        >
                          {content}
                        </Link>
                      );
                    }}
                  />
                </div>
              ) : null}

              {viewMode === "table" && summary.previewRows?.length ? (
                <div className="overflow-x-auto rounded-lg border-[0.5px] border-border">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b-[0.5px] border-border bg-[var(--surface-subtle)] text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">
                          {summary.previewColumns?.item ?? "名称"}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {summary.previewColumns?.group ?? "分类"}
                        </th>
                        <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                          {summary.previewColumns?.owner ?? "负责人"}
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          {summary.previewColumns?.status ?? "状态"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {summary.previewRows.map((row) => (
                        <tr key={row.id} className="transition-colors hover:bg-muted/50">
                          <td className="max-w-[180px] px-3 py-2">
                            <Link
                              to={row.to as never}
                              search={(row.search ?? {}) as never}
                              className="flex items-center gap-2 text-foreground no-underline hover:text-primary hover:underline"
                            >
                              <span className="hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">
                                {row.code}
                              </span>
                              <span className="truncate font-medium">{row.title}</span>
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.group}</td>
                          <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                            {row.owner}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Badge variant={row.statusTone}>{row.statusLabel}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : breakdownRows.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {dimensions.length > 1 ? activeDimension?.label : summary.breakdownTitle}
                    </span>
                    {dimensions.length > 1 ? (
                      <div className="w-auto min-w-[144px]">
                        <SegmentedControl
                          label="汇总维度"
                          value={activeDimension?.key ?? ""}
                          onValueChange={setSelectedDimensionKey}
                          options={dimensions.map((d) => ({ value: d.key, label: d.label }))}
                          className="h-7"
                        />
                      </div>
                    ) : null}
                  </div>
                  <BarList
                    items={breakdownRows.map((row) => ({
                      ...row,
                      badge:
                        row.pendingCount !== undefined ? (
                          row.pendingCount > 0 && row.pendingTo ? (
                            <Link
                              to={row.pendingTo as never}
                              search={(row.pendingSearch ?? {}) as never}
                              className="inline-flex h-6 min-w-[66px] items-center justify-center rounded-full bg-warning px-2.5 text-xs font-medium text-warning-foreground no-underline tabular-nums hover:ring-1 hover:ring-[var(--warning-foreground)]"
                            >
                              待复核 {row.pendingCount}
                            </Link>
                          ) : (
                            <span className="inline-flex h-6 min-w-[66px] items-center justify-center rounded-full bg-muted px-2.5 text-xs text-muted-foreground tabular-nums">
                              待复核 0
                            </span>
                          )
                        ) : undefined,
                    }))}
                    renderRow={(item, content) => {
                      const row = breakdownRows.find((b) => b.key === item.key);
                      if (!row?.to) return content;
                      return (
                        <Link
                          to={row.to as never}
                          search={(row.search ?? {}) as never}
                          className="flex min-w-0 flex-1 rounded-md text-inherit no-underline transition-colors hover:bg-muted/60"
                        >
                          {content}
                        </Link>
                      );
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        }}
      </LoadedQuery>
    </Panel>
  );
}

function SystemHealthPanel({
  canReadSystem,
  canReadJobs,
  systemStatus,
  jobsPage,
  jobTracker,
}: {
  canReadSystem: boolean;
  canReadJobs: boolean;
  systemStatus: UseQueryResult<SystemStatusResponse, Error>;
  jobsPage: UseQueryResult<JobPage, Error>;
  jobTracker: ReturnType<typeof buildJobTrackerSlots>;
}) {
  const sys = systemStatus.data;

  return (
    <Panel
      title="运行健康"
      action={
        <Link
          to={"/system" as never}
          search={{ tab: canReadSystem ? "status" : "jobs" } as never}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <span>系统配置</span>
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {canReadSystem ? (
        systemStatus.isPending ? (
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        ) : systemStatus.isError ? (
          <p className="m-0 text-xs text-destructive">{systemStatus.error.message}</p>
        ) : sys ? (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] px-3 py-2">
              <div className="text-xs text-muted-foreground">数据库延迟</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor:
                      sys.probe.db === "ok" ? "var(--success-solid)" : "var(--destructive)",
                  }}
                />
                <span>{sys.probe.db === "ok" ? `${sys.probe.dbLatencyMs ?? 0}ms` : "不可达"}</span>
              </div>
            </div>
            <div className="rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] px-3 py-2">
              <div className="text-xs text-muted-foreground">活跃会话</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">
                {sys.probe.activeSessions} 个
              </div>
            </div>
          </div>
        ) : null
      ) : null}

      {canReadJobs ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>近期任务队列（{JOB_TRACKER_SLOTS} 格）</span>
            <Link
              to={"/system" as never}
              search={{ tab: "jobs" } as never}
              className="text-inherit no-underline tabular-nums hover:text-foreground hover:underline"
            >
              完成 {jobTracker.ok} / 失败 {jobTracker.danger}
            </Link>
          </div>
          {jobsPage.isPending ? (
            <div className="h-7 animate-pulse rounded bg-muted" />
          ) : jobsPage.isError ? (
            <p className="m-0 text-xs text-destructive">{jobsPage.error.message}</p>
          ) : (
            <Tracker slots={jobTracker.slots} ariaLabel="近期后台任务执行健康度" />
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function relativeTime(at: string, timeZone: string) {
  const diff = Date.now() - new Date(at).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(at).toLocaleDateString("zh-CN", { timeZone });
}

function RecentActivityList({
  items,
  timeZone,
}: {
  items: readonly AuditEntry[];
  timeZone: string;
}) {
  return (
    <ol className="m-0 list-none divide-y divide-border/60 p-0">
      {items.slice(0, ACTIVITY_DISPLAY_SIZE).map((e) => {
        const Icon = ACTIVITY_ICONS[e.action] ?? Activity;
        const label = AUDIT_ACTION_LABELS[e.action] ?? e.action;
        const target = e.targetName && e.targetId !== e.actorId ? `（${e.targetName}）` : "";
        return (
          <li key={e.id}>
            <Link
              to={"/audit" as never}
              search={{ action: e.action } as never}
              className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-2 text-inherit no-underline transition-colors hover:bg-muted/70"
            >
              <span className="grid size-7 flex-none place-items-center rounded-md bg-accent text-accent-foreground">
                <Icon size={14} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[13px] leading-5 text-foreground">
                  {e.actorName} {label}
                  {target}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <time dateTime={e.at}>{relativeTime(e.at, timeZone)}</time>
                  {e.actorSource === "agent" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                      <Bot size={11} aria-hidden="true" />
                      Agent
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ModuleQueueList({
  items,
  overflowCount,
}: {
  items: readonly NonNullable<DashboardModuleSummary["queueItems"]>[number][];
  overflowCount: number;
}) {
  return (
    <>
      <ol className="m-0 list-none divide-y divide-border/60 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to as never}
              search={(item.search ?? {}) as never}
              className="-mx-2 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md px-2 py-2.5 text-inherit no-underline transition-colors hover:bg-muted/70"
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {item.code}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm font-medium">{item.title}</strong>
                <small className="block truncate text-xs text-muted-foreground">{item.meta}</small>
              </span>
              <ArrowRight size={14} className="text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      {overflowCount > 0 ? (
        <p className="m-0 mt-1 text-xs text-muted-foreground">另有 {overflowCount} 项待处理</p>
      ) : null}
    </>
  );
}

interface ShortcutDef {
  key: string;
  title: string;
  icon: LucideIcon;
  to: NavTarget;
  search?: Record<string, string>;
  count?: number | string;
}

function QuickAccessRow({
  firstModule,
  firstSummary,
  canReadAccounts,
  disabledAccountsCount,
  canReadAudit,
  canReadSystem,
  canReadJobs,
}: {
  firstModule?: DashboardModuleSpec;
  firstSummary?: DashboardModuleSummary;
  canReadAccounts: boolean;
  disabledAccountsCount?: number;
  canReadAudit: boolean;
  canReadSystem: boolean;
  canReadJobs: boolean;
}) {
  const headingId = useId();
  const shortcuts: ShortcutDef[] = [];

  if (firstModule && firstSummary?.secondaryStat) {
    shortcuts.push({
      key: `mod-${firstModule.id}`,
      title: firstSummary.secondaryStat.label,
      icon: Clock,
      to: firstSummary.secondaryStat.to,
      search: firstSummary.secondaryStat.search,
      count: firstSummary.secondaryStat.value,
    });
  }
  if (canReadAccounts) {
    shortcuts.push({
      key: "accounts",
      title: "已停用账户",
      icon: Power,
      to: "/accounts",
      search: { status: "disabled" },
      count: disabledAccountsCount,
    });
  }
  if (canReadAudit) {
    shortcuts.push({
      key: "audit-agent",
      title: "Agent 操作日志",
      icon: Bot,
      to: "/audit",
      search: { source: "agent" },
    });
  }
  if (canReadSystem) {
    shortcuts.push({
      key: "system-status",
      title: "系统运行状态",
      icon: Terminal,
      to: "/system",
      search: { tab: "status" },
    });
  } else if (canReadJobs) {
    shortcuts.push({
      key: "system-jobs",
      title: "后台任务队列",
      icon: CheckCircle2,
      to: "/system",
      search: { tab: "jobs" },
    });
  }

  if (!shortcuts.length) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="m-0 mb-2.5 text-[15px] leading-6 font-semibold">
        常用任务
      </h2>
      <div className="feature-grid" data-count={Math.min(shortcuts.length, 4)}>
        {shortcuts.slice(0, 4).map((sc) => {
          const Icon = sc.icon;
          return (
            <Link
              key={sc.key}
              to={sc.to as never}
              search={(sc.search ?? {}) as never}
              className="feature-card"
            >
              <span className="stat-icon">
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{sc.title}</span>
                {sc.count !== undefined ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                    {sc.count}
                  </span>
                ) : null}
              </span>
              <ArrowRight
                size={15}
                className="flex-none text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function GovernanceView({
  canReadAudit,
  canReadJobs,
  canReadSystem,
  canReadAccounts,
  auditPage,
  jobsPage,
  systemStatus,
  accounts,
  actionRanking,
  actorRanking,
  jobTracker,
  activeAccountsCount,
  disabledAccountsCount,
  timeZone,
}: {
  canReadAudit: boolean;
  canReadJobs: boolean;
  canReadSystem: boolean;
  canReadAccounts: boolean;
  auditPage: UseQueryResult<AuditPage, Error>;
  jobsPage: UseQueryResult<JobPage, Error>;
  systemStatus: UseQueryResult<SystemStatusResponse, Error>;
  accounts: UseQueryResult<Account[], Error>;
  actionRanking: ReturnType<typeof buildAuditActionRanking>;
  actorRanking: ReturnType<typeof buildAuditActorRanking>;
  jobTracker: ReturnType<typeof buildJobTrackerSlots>;
  activeAccountsCount: number;
  disabledAccountsCount: number;
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canReadAudit ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-6">
            <Panel
              title="高频操作动作排行"
              action={
                <Link
                  to={"/audit" as never}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>进入审计日志</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <LoadedQuery
                query={auditPage}
                empty="暂无操作统计"
                isEmpty={() => !actionRanking.length}
              >
                {() => (
                  <BarList
                    items={actionRanking}
                    renderRow={(item, content) => (
                      <Link
                        to={"/audit" as never}
                        search={{ action: item.key } as never}
                        className="flex min-w-0 flex-1 rounded-md text-inherit no-underline transition-colors hover:bg-muted/60"
                      >
                        {content}
                      </Link>
                    )}
                  />
                )}
              </LoadedQuery>
            </Panel>
          </div>

          <div className="min-w-0 xl:col-span-6">
            <Panel
              title="活跃主体分布"
              action={
                <Link
                  to={"/audit" as never}
                  search={{ source: "agent" } as never}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>筛选 Agent</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <LoadedQuery
                query={auditPage}
                empty="暂无主体记录"
                isEmpty={() => !actorRanking.length}
              >
                {() => (
                  <BarList
                    items={actorRanking}
                    renderRow={(item, content) => {
                      const matched = actorRanking.find((a) => a.key === item.key);
                      return (
                        <Link
                          to={"/audit" as never}
                          search={{ source: matched?.actorSource ?? "human" } as never}
                          className="flex min-w-0 flex-1 rounded-md text-inherit no-underline transition-colors hover:bg-muted/60"
                        >
                          {content}
                        </Link>
                      );
                    }}
                  />
                )}
              </LoadedQuery>
            </Panel>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        {canReadJobs ? (
          <div className="min-w-0 xl:col-span-7">
            <Panel
              title="后台任务执行记录"
              action={
                <Link
                  to={"/system" as never}
                  search={{ tab: "jobs" } as never}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>管理后台任务</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <LoadedQuery
                query={jobsPage}
                empty="暂无后台任务记录"
                isEmpty={(d) => !d.items.length}
              >
                {(page) => (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>近期健康序列（{JOB_TRACKER_SLOTS} 格）</span>
                      <span className="tabular-nums">
                        完成 {jobTracker.ok} / 进行 {jobTracker.active} / 失败 {jobTracker.danger}
                      </span>
                    </div>
                    <Tracker slots={jobTracker.slots} ariaLabel="后台任务健康度序列" />
                    <div className="overflow-x-auto rounded-lg border-[0.5px] border-border">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b-[0.5px] border-border bg-[var(--surface-subtle)] text-muted-foreground">
                            <th scope="col" className="px-3 py-2 font-medium">
                              任务
                            </th>
                            <th scope="col" className="px-3 py-2 font-medium">
                              状态
                            </th>
                            <th
                              scope="col"
                              className="hidden px-3 py-2 text-right font-medium sm:table-cell"
                            >
                              进度
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              创建时间
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {page.items.slice(0, 6).map((job) => {
                            const statusLabel = JOB_STATUS_LABELS[job.status] ?? job.status;
                            const statusVariant =
                              job.status === "succeeded"
                                ? "success"
                                : job.status === "failed"
                                  ? "danger"
                                  : job.status === "running" || job.status === "pending"
                                    ? "brand"
                                    : "neutral";
                            return (
                              <tr key={job.id} className="transition-colors hover:bg-muted/50">
                                <td className="px-3 py-2 font-medium text-foreground">
                                  <span className="mr-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                                    #{job.id}
                                  </span>
                                  <span>{JOB_TYPE_LABELS[job.type] ?? job.type}</span>
                                </td>
                                <td className="px-3 py-2">
                                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                                </td>
                                <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground sm:table-cell">
                                  {job.progress}%
                                </td>
                                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                                  {relativeTime(job.createdAt, timeZone)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </LoadedQuery>
            </Panel>
          </div>
        ) : null}

        {canReadAccounts || canReadSystem ? (
          <div className={canReadJobs ? "min-w-0 xl:col-span-5" : "min-w-0 xl:col-span-12"}>
            <Panel
              title="账户与运行探针"
              action={
                <Link
                  to={(canReadSystem ? "/system" : "/accounts") as never}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>{canReadSystem ? "系统配置" : "账户管理"}</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <div className="flex flex-col gap-3">
                {canReadAccounts ? (
                  accounts.isPending ? (
                    <div className="h-16 animate-pulse rounded-lg bg-muted" />
                  ) : accounts.data ? (
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border-[0.5px] border-border bg-border">
                      <Link
                        to={"/accounts" as never}
                        search={{ status: "active" } as never}
                        className="bg-card px-3.5 py-2.5 text-inherit no-underline transition-colors hover:bg-muted/40"
                      >
                        <div className="text-[11px] text-muted-foreground">启用账户</div>
                        <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                          {activeAccountsCount}
                        </div>
                      </Link>
                      <Link
                        to={"/accounts" as never}
                        search={{ status: "disabled" } as never}
                        className="bg-card px-3.5 py-2.5 text-inherit no-underline transition-colors hover:bg-muted/40"
                      >
                        <div className="text-[11px] text-muted-foreground">已停用账户</div>
                        <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                          {disabledAccountsCount}
                        </div>
                      </Link>
                    </div>
                  ) : null
                ) : null}

                {canReadSystem ? (
                  systemStatus.isPending ? (
                    <div className="h-24 animate-pulse rounded-lg bg-muted" />
                  ) : systemStatus.data ? (
                    <dl className="m-0 divide-y divide-border/60 rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] px-3.5">
                      <div className="flex items-center justify-between py-2 text-xs">
                        <dt className="text-muted-foreground">数据库探针</dt>
                        <dd className="m-0 font-medium tabular-nums">
                          {systemStatus.data.probe.db === "ok"
                            ? `正常 (${systemStatus.data.probe.dbLatencyMs ?? 0}ms)`
                            : "异常"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2 text-xs">
                        <dt className="text-muted-foreground">当前活跃会话</dt>
                        <dd className="m-0 font-medium tabular-nums">
                          {systemStatus.data.probe.activeSessions} 个
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2 text-xs">
                        <dt className="text-muted-foreground">运行环境</dt>
                        <dd className="m-0 font-medium tabular-nums">
                          Node {systemStatus.data.probe.nodeVersion}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2 text-xs">
                        <dt className="text-muted-foreground">系统基准时区</dt>
                        <dd className="m-0 font-medium">{timeZone}</dd>
                      </div>
                    </dl>
                  ) : null
                ) : null}
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}
