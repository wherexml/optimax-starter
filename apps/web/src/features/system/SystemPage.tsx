import {
  DEFAULT_SESSION_TTL_HOURS,
  DEFAULT_SYSTEM_TIMEZONE,
  formatSessionTtlHint,
  formatSessionTtlLabel,
  formatSystemTimezoneOptionLabel,
  getSystemTimezoneOptions,
  MAX_SESSION_TTL_HOURS,
  MIN_SESSION_TTL_HOURS,
  normalizeSessionTtlHours,
  type SystemSettingsResponse,
  type SystemSettingsUpdateInput,
  type SystemStatusResponse,
  type SystemTab,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Check, RotateCcw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
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
import type { RegisterSettingsSection, SettingsSectionController } from "./settings-controller";

const route = getRouteApi("/system");

type SectionState = Pick<SettingsSectionController, "dirty" | "valid" | "pending">;

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

  const controllersRef = useRef<Record<string, SettingsSectionController>>({});
  const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({});
  const [applying, setApplying] = useState(false);

  const registerSection: RegisterSettingsSection = useCallback((id, controller) => {
    if (!controller) {
      delete controllersRef.current[id];
      setSectionStates((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    controllersRef.current[id] = controller;
    setSectionStates((prev) => {
      const existing = prev[id];
      if (
        existing &&
        existing.dirty === controller.dirty &&
        existing.valid === controller.valid &&
        existing.pending === controller.pending
      ) {
        return prev;
      }
      return {
        ...prev,
        [id]: {
          dirty: controller.dirty,
          valid: controller.valid,
          pending: controller.pending,
        },
      };
    });
  }, []);

  const dirtyIds = useMemo(
    () =>
      Object.entries(sectionStates)
        .filter(([, state]) => state.dirty)
        .map(([id]) => id),
    [sectionStates],
  );
  const hasDirtyChanges = dirtyIds.length > 0;
  const allDirtyValid =
    hasDirtyChanges && dirtyIds.every((id) => sectionStates[id]?.valid !== false);
  const anyPending =
    applying || Object.values(sectionStates).some((state) => state.pending);

  const applyAll = useCallback(async () => {
    if (!hasDirtyChanges || !allDirtyValid || anyPending) return;
    setApplying(true);
    try {
      for (const id of dirtyIds) {
        await controllersRef.current[id]?.apply();
      }
      toast.success("系统配置已应用");
    } catch (error) {
      toast.error("系统配置应用失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setApplying(false);
    }
  }, [allDirtyValid, anyPending, dirtyIds, hasDirtyChanges]);

  const resetAll = useCallback(() => {
    if (!hasDirtyChanges || anyPending) return;
    for (const id of dirtyIds) {
      controllersRef.current[id]?.reset();
    }
  }, [anyPending, dirtyIds, hasDirtyChanges]);

  useEffect(() => {
    if (activeTab !== "settings" || !canManageSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void applyAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, applyAll, canManageSettings]);

  const activeTimezone = settingsQuery.data?.timezone ?? DEFAULT_SYSTEM_TIMEZONE;
  const activeSessionTtlLabel =
    settingsQuery.data?.sessionTtlLabel ?? formatSessionTtlLabel(DEFAULT_SESSION_TTL_HOURS);

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
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="刷新"
                aria-label="刷新系统配置"
                disabled={refreshing || anyPending}
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
              {activeTab === "settings" && canManageSettings ? (
                <>
                  {hasDirtyChanges ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={anyPending}
                      onClick={resetAll}
                    >
                      <RotateCcw size={15} />
                      重置
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!hasDirtyChanges || !allDirtyValid || anyPending}
                    onClick={() => void applyAll()}
                  >
                    <Check size={15} />
                    {anyPending ? "应用中…" : "应用"}
                  </Button>
                </>
              ) : null}
            </div>
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
          <StatusControlPanel
            query={statusQuery}
            timeZone={activeTimezone}
            sessionTtlLabel={activeSessionTtlLabel}
          />
        </PageTabsPanel>
        <PageTabsPanel value="settings">
          <BaseSettingsPanel
            query={settingsQuery}
            canManageSettings={canManageSettings}
            registerSection={registerSection}
          />
          {/* @starter:agent-start */}
          <div className="mt-4">
            <AiModelSettingsCard
              canManageSettings={canManageSettings}
              registerSection={registerSection}
            />
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
      <dd className="m-0 font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function StatusControlPanel({
  query,
  timeZone,
  sessionTtlLabel,
}: {
  query: ReturnType<typeof useQuery<SystemStatusResponse, Error>>;
  timeZone: string;
  sessionTtlLabel: string;
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
      <div className="cq-kpi-4 mb-3 overflow-hidden rounded-lg border-[0.5px] border-[var(--hairline)] bg-[var(--hairline)]">
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
        <MetricRow label="登录会话有效期" value={sessionTtlLabel} />
        <MetricRow label="最近探测时间" value={formatCheckedAt(data.checkedAt, timeZone)} />
      </dl>
    </section>
  );
}

function BaseSettingsPanel({
  query,
  canManageSettings,
  registerSection,
}: {
  query: ReturnType<typeof useQuery<SystemSettingsResponse, Error>>;
  canManageSettings: boolean;
  registerSection: RegisterSettingsSection;
}) {
  const cache = useQueryClient();
  const [timezone, setTimezone] = useState("");
  const [sessionTtlInput, setSessionTtlInput] = useState<number | "">("");

  const currentTimezone = query.data?.timezone;
  useEffect(() => {
    if (currentTimezone) {
      setTimezone(currentTimezone);
    }
  }, [currentTimezone]);

  const currentSessionTtl = query.data?.sessionTtlHours;
  useEffect(() => {
    if (currentSessionTtl !== undefined) {
      setSessionTtlInput(currentSessionTtl);
    }
  }, [currentSessionTtl]);

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
    mutationFn: (payload: SystemSettingsUpdateInput) =>
      request<SystemSettingsResponse>("/system/settings", "PUT", payload),
    onSuccess: async (updated) => {
      setTimezone(updated.timezone);
      setSessionTtlInput(updated.sessionTtlHours);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["system-settings"] }),
        cache.invalidateQueries({ queryKey: ["system-status"] }),
        cache.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });

  const settings = query.data;
  const tzChanged = Boolean(settings && timezone && timezone !== settings.timezone);
  const parsedTtl =
    sessionTtlInput === "" ? null : normalizeSessionTtlHours(sessionTtlInput);
  const ttlChanged = Boolean(settings && sessionTtlInput !== settings.sessionTtlHours);
  const dirty = tzChanged || ttlChanged;
  const ttlInvalid = settings !== undefined && parsedTtl === null;
  const valid = !dirty || parsedTtl !== null;

  const reset = useCallback(() => {
    if (!settings) return;
    setTimezone(settings.timezone);
    setSessionTtlInput(settings.sessionTtlHours);
  }, [settings]);

  const apply = useCallback(async () => {
    if (!settings || !dirty || parsedTtl === null) return;
    const payload: SystemSettingsUpdateInput = {};
    if (tzChanged) payload.timezone = timezone;
    if (ttlChanged) payload.sessionTtlHours = parsedTtl;
    if (Object.keys(payload).length === 0) return;
    await save.mutateAsync(payload);
  }, [dirty, parsedTtl, save, settings, timezone, ttlChanged, tzChanged]);

  useEffect(() => {
    registerSection("base", {
      dirty,
      valid,
      pending: save.isPending,
      apply,
      reset,
    });
  }, [apply, dirty, registerSection, reset, save.isPending, valid]);

  useEffect(() => {
    return () => registerSection("base", null);
  }, [registerSection]);

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

  return (
    <div className="cq-grid-2 items-stretch">
      <section className="panel flex flex-col justify-between" aria-label="时间与区域设置">
        <div>
          <header className="panel-head">
            <h2>时间与区域设置</h2>
          </header>
          <div className="flex flex-col gap-2">
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
        </div>
        <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
          影响审计日志时间展示与按自然日区间筛选边界。
        </p>
      </section>

      <section className="panel flex flex-col justify-between" aria-label="登录与会话有效期">
        <div>
          <header className="panel-head">
            <h2>登录与会话有效期</h2>
          </header>
          <div className="flex flex-col gap-2">
            <Label htmlFor="system-session-ttl">登录保持时长</Label>
            <NumberInput
              id="system-session-ttl"
              aria-label="登录保持时长"
              label="登录保持时长"
              value={sessionTtlInput}
              onValueChange={setSessionTtlInput}
              min={MIN_SESSION_TTL_HOURS}
              max={MAX_SESSION_TTL_HOURS}
              step={1}
              unit="小时"
              placeholder="输入 1 到 2160 之间的整数"
              disabled={!canManageSettings || save.isPending}
              aria-invalid={ttlInvalid || undefined}
            />
          </div>
        </div>
        {ttlInvalid ? (
          <p role="alert" className="m-0 mt-3 text-xs leading-relaxed text-destructive">
            请输入 1 到 2160 之间的整数小时（最多 90 天）。
          </p>
        ) : (
          <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
            当前{parsedTtl !== null ? formatSessionTtlHint(parsedTtl) : "有效"}；活跃访问每 5
            分钟自动顺延（默认 168 小时 / 7 天）。
          </p>
        )}
      </section>
    </div>
  );
}
