import {
  DEFAULT_SYSTEM_TIMEZONE,
  formatSystemTimezoneOptionLabel,
  getSystemTimezoneOptions,
  type SystemSettingsResponse,
  type SystemStatusResponse,
  type SystemTab,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { RotateCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, PageTabsPanel } from "@/components/ui/page-tabs";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";

// @starter:agent-start
import { AiModelSettingsCard } from "@/features/assistant/AiModelSettingsCard";
// @starter:agent-end

import { JobsTab } from "./JobsTab";
import { parseSystemSearch, SYSTEM_TAB_ITEMS } from "./search";

const route = getRouteApi("/system");

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours} 小时 ${remMins} 分`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

function formatCheckedAt(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SystemPage() {
  const runRefresh = useContentRefresh();
  const cache = useQueryClient();
  const me = useAccount();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();

  const canReadAi = hasPermission(me.data, "system:ai:read");
  const canReadSettings = hasPermission(me.data, "system:settings:read");
  const canManageSettings = hasPermission(me.data, "system:settings:manage");
  const canReadJobs = hasPermission(me.data, "jobs:read");

  const visibleTabs = useMemo(
    () =>
      SYSTEM_TAB_ITEMS.filter(
        (item) =>
          (item.value === "status" && (canReadSettings || canReadAi)) ||
          (item.value === "settings" && canReadSettings) ||
          (item.value === "jobs" && canReadJobs),
      ),
    [canReadAi, canReadSettings, canReadJobs],
  );

  const activeTab: SystemTab = visibleTabs.some((t) => t.value === tab)
    ? tab
    : (visibleTabs[0]?.value ?? "status");

  useEffect(() => {
    if (visibleTabs.length > 0 && activeTab !== tab) {
      void navigate({ search: { tab: activeTab }, replace: true });
    }
  }, [activeTab, navigate, tab, visibleTabs.length]);

  const statusQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["system-status"],
    queryFn: () => request<SystemStatusResponse>("/system/status"),
    enabled: Boolean(me.data) && (canReadAi || canReadSettings),
  });

  const settingsQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["system-settings"],
    queryFn: () => request<SystemSettingsResponse>("/system/settings"),
    enabled: Boolean(me.data) && canReadSettings,
  });

  const activeTimezone = settingsQuery.data?.timezone ?? DEFAULT_SYSTEM_TIMEZONE;

  if (!canReadAi && !canReadSettings && !canReadJobs) {
    return (
      <>
        <PageHeader title="系统配置" />
        <p role="alert" className="text-muted-foreground">
          无权查看系统配置
        </p>
      </>
    );
  }

  const refreshing = statusQuery.isFetching || settingsQuery.isFetching;

  return (
    <>
      <PageHeader
        title="系统配置"
        actions={
          activeTab !== "jobs" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="刷新"
              aria-label="刷新系统配置"
              disabled={refreshing}
              onClick={() =>
                void runRefresh(() =>
                  Promise.all([
                    ...(canReadAi || canReadSettings ? [statusQuery.refetch()] : []),
                    ...(canReadSettings ? [settingsQuery.refetch()] : []),
                    ...(canReadJobs ? [cache.invalidateQueries({ queryKey: ["jobs"] })] : []),
                    // @starter:agent-start
                    cache.invalidateQueries({ queryKey: ["agent-status"] }),
                    cache.invalidateQueries({ queryKey: ["ai-model-settings"] }),
                    // @starter:agent-end
                  ]),
                )
              }
            >
              <RotateCw size={15} />
            </Button>
          ) : undefined
        }
      />

      <PageTabs
        label="系统配置"
        items={visibleTabs}
        value={activeTab}
        hideSingleTab
        onValueChange={(next) => {
          const parsed = parseSystemSearch({ tab: next }).tab;
          void navigate({ search: { tab: parsed }, replace: true });
        }}
      >
        <PageTabsPanel value="status">
          <StatusControlPanel query={statusQuery} timeZone={activeTimezone} />
        </PageTabsPanel>
        <PageTabsPanel value="settings">
          <BaseSettingsPanel query={settingsQuery} canManageSettings={canManageSettings} />
          {/* @starter:agent-start */}
          <div className="mt-5">
            <AiModelSettingsCard canManageSettings={canManageSettings} />
          </div>
          {/* @starter:agent-end */}
        </PageTabsPanel>
        <PageTabsPanel value="jobs">{canReadJobs ? <JobsTab /> : null}</PageTabsPanel>
      </PageTabs>
    </>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b-[0.5px] border-[var(--hairline)] py-2.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function StatusControlPanel({
  query,
  timeZone,
}: {
  query: ReturnType<typeof useQuery<SystemStatusResponse, Error>>;
  timeZone: string;
}) {
  if (query.isPending) {
    return (
      <div role="status" aria-label="正在加载" className="panel p-6 text-sm text-muted-foreground">
        正在探测系统运行状态…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="panel flex items-center justify-between gap-3 p-5">
        <p className="m-0 text-sm text-destructive">{query.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const data = query.data;
  const { probe } = data;
  const dbHealthy = probe.db === "ok";

  const summaryCells = [
    {
      label: "数据库延迟",
      value: dbHealthy ? `${probe.dbLatencyMs ?? 0} ms` : "异常",
    },
    {
      label: "当前活跃会话",
      value: `${probe.activeSessions} 个`,
    },
    {
      label: "进程持续运行",
      value: formatUptime(probe.uptimeSec),
    },
    {
      label: "运行环境",
      value: `Node ${probe.nodeVersion}`,
    },
  ];

  return (
    <section className="panel" aria-label="服务与数据库探针">
      <header className="panel-head">
        <h2>服务与数据库探针</h2>
        <Badge variant={dbHealthy ? "success" : "danger"}>{dbHealthy ? "健康" : "异常"}</Badge>
      </header>
      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border-[0.5px] border-[var(--hairline)] bg-[var(--hairline)] sm:grid-cols-4">
        {summaryCells.map((cell) => (
          <div key={cell.label} className="bg-card px-3.5 py-2.5">
            <div className="text-[11px] text-muted-foreground">{cell.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-foreground">
              {cell.value}
            </div>
          </div>
        ))}
      </div>
      <dl className="m-0">
        <MetricRow
          label="数据库探针 (/healthz)"
          value={dbHealthy ? `正常（${probe.dbLatencyMs ?? 0} ms）` : "连接不可达"}
        />
        <MetricRow label="生效系统时区" value={timeZone} />
        <MetricRow label="最近探测时间" value={formatCheckedAt(data.checkedAt, timeZone)} />
      </dl>
    </section>
  );
}

function BaseSettingsPanel({
  query,
  canManageSettings,
}: {
  query: ReturnType<typeof useQuery<SystemSettingsResponse, Error>>;
  canManageSettings: boolean;
}) {
  const cache = useQueryClient();
  const [timezone, setTimezone] = useState("");

  const currentTimezone = query.data?.timezone;
  useEffect(() => {
    if (currentTimezone) {
      setTimezone(currentTimezone);
    }
  }, [currentTimezone]);

  const timezoneOptions = useMemo(() => {
    const base = getSystemTimezoneOptions();
    if (!currentTimezone || base.some((opt) => opt.value === currentTimezone)) {
      return [...base];
    }
    return [
      {
        value: currentTimezone,
        label: formatSystemTimezoneOptionLabel(currentTimezone),
        keywords: [currentTimezone],
      },
      ...base,
    ];
  }, [currentTimezone]);

  const save = useMutation({
    mutationFn: (nextTimezone: string) =>
      request<SystemSettingsResponse>("/system/settings", "PUT", {
        timezone: nextTimezone,
      }),
    onSuccess: async (updated) => {
      setTimezone(updated.timezone);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["system-settings"] }),
        cache.invalidateQueries({ queryKey: ["system-status"] }),
        cache.invalidateQueries({ queryKey: ["audit"] }),
      ]);
      toast.success("系统配置已保存");
    },
    onError: (err) => {
      toast.error("系统配置保存失败", { description: err.message });
    },
  });

  if (query.isPending) {
    return (
      <div role="status" aria-label="正在加载" className="panel p-6 text-sm text-muted-foreground">
        正在读取系统配置…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="panel flex items-center justify-between gap-3 p-5">
        <p className="m-0 text-sm text-destructive">{query.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const settings = query.data;
  const hasChanged = Boolean(timezone && settings.timezone && timezone !== settings.timezone);

  return (
    <section className="panel" aria-label="时间与区域设置">
      <header className="panel-head">
        <h2>时间与区域设置</h2>
      </header>
      <div className="flex flex-col gap-5">
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor="system-timezone">系统时区</Label>
          <Combobox
            id="system-timezone"
            label="系统时区"
            value={timezone}
            onValueChange={setTimezone}
            options={timezoneOptions}
            placeholder="请选择系统时区"
            searchPlaceholder="搜索城市、时区标识或 UTC 偏移…"
            emptyText="未找到匹配时区"
            disabled={!canManageSettings || save.isPending}
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canManageSettings || !hasChanged || save.isPending}
            onClick={() => save.mutate(timezone)}
          >
            <Save size={15} />
            {save.isPending ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </div>
    </section>
  );
}
