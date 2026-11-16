import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { RotateCw, Save } from "lucide-react";
import {
  DEFAULT_SYSTEM_TIMEZONE,
  type SystemSettingsResponse,
  type SystemStatusResponse,
  type SystemTab,
} from "@optimax-starter/api";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";
import { parseSystemSearch, SYSTEM_TAB_ITEMS } from "./search";

const route = getRouteApi("/system");

const SOURCE_LABELS: Record<SystemSettingsResponse["source"], string> = {
  database: "数据库持久化",
  env: "环境变量回退",
  default: "系统默认配置",
};

const AI_MODE_LABELS: Record<SystemStatusResponse["ai"]["configMode"], string> = {
  client: "服务端直连网关",
  legacy: "兼容本地转发",
  invalid: "配置校验未通过",
  disabled: "未配置模型参数",
};

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
  const canManageAi =
    me.data?.role === "super_admin" &&
    hasPermission(me.data, "system:ai:manage");
  const canReadSettings = hasPermission(me.data, "system:settings:read");
  const canManageSettings = hasPermission(me.data, "system:settings:manage");

  const visibleTabs = useMemo(
    () =>
      SYSTEM_TAB_ITEMS.filter(
        (item) =>
          (item.value === "status" && canReadAi) ||
          (item.value === "settings" && canReadSettings),
      ),
    [canReadAi, canReadSettings],
  );

  const activeTab: SystemTab = visibleTabs.some((t) => t.value === tab)
    ? tab
    : (visibleTabs[0]?.value ?? "status");

  const [tabState, setTabState] = useState<SystemTab>(activeTab);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTabState(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (visibleTabs.length > 0 && activeTab !== tab) {
      void navigate({ search: { tab: activeTab }, replace: true });
    }
  }, [activeTab, navigate, tab, visibleTabs.length]);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>("[data-selected]");
    if (selected && listRef.current) {
      const viewport = listRef.current.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < viewport.left) {
        listRef.current.scrollLeft -= viewport.left - item.left;
      }
      if (item.right > viewport.right) {
        listRef.current.scrollLeft += item.right - viewport.right;
      }
    }
  }, [tabState]);

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

  const activeTimezone =
    settingsQuery.data?.timezone ?? DEFAULT_SYSTEM_TIMEZONE;

  if (!canReadAi && !canReadSettings) {
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            title="刷新"
            aria-label="刷新系统配置"
            disabled={refreshing}
            onClick={() =>
              void runRefresh(() =>
                Promise.all([
                  statusQuery.refetch(),
                  ...(canReadSettings ? [settingsQuery.refetch()] : []),
                  cache.invalidateQueries({ queryKey: ["asset-agent-config"] }),
                ]),
              )
            }
          >
            <RotateCw size={15} />
          </Button>
        }
      />

      {visibleTabs.length > 1 ? (
        <Tabs
          className="page-tabs"
          value={tabState}
          onValueChange={(next) => {
            if (!next) return;
            const parsed = parseSystemSearch({ tab: next }).tab;
            setTabState(parsed);
            void navigate({ search: { tab: parsed }, replace: true });
          }}
        >
          <div className="page-tabs-scroll" ref={listRef}>
            <TabsList aria-label="系统配置">
              {visibleTabs.map((item) => (
                <TabsTab key={item.value} value={item.value}>
                  {item.label}
                </TabsTab>
              ))}
            </TabsList>
          </div>
          <TabsPanel value="status">
            <StatusControlPanel
              query={statusQuery}
              canManageAi={canManageAi}
              timeZone={activeTimezone}
            />
          </TabsPanel>
          <TabsPanel value="settings">
            <BaseSettingsPanel
              query={settingsQuery}
              canManageSettings={canManageSettings}
            />
          </TabsPanel>
        </Tabs>
      ) : activeTab === "status" ? (
        <StatusControlPanel
          query={statusQuery}
          canManageAi={canManageAi}
          timeZone={activeTimezone}
        />
      ) : (
        <BaseSettingsPanel
          query={settingsQuery}
          canManageSettings={canManageSettings}
        />
      )}
    </>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b-[0.5px] border-[var(--hairline)] py-2.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function StatusControlPanel({
  query,
  canManageAi,
  timeZone,
}: {
  query: ReturnType<typeof useQuery<SystemStatusResponse, Error>>;
  canManageAi: boolean;
  timeZone: string;
}) {
  const cache = useQueryClient();
  const [confirmCircuit, setConfirmCircuit] = useState<
    "disable" | "enable" | null
  >(null);
  const circuitTrigger = useRef<HTMLButtonElement>(null);

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="正在加载"
        className="panel p-6 text-sm text-muted-foreground"
      >
        正在探测系统与模型状态…
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
  const { probe, ai } = data;
  const dbHealthy = probe.db === "ok";

  const aiBadge = ai.circuitOpen
    ? { variant: "danger" as const, label: "已熔断", summary: "全局断路器已开启，所有模型请求在网关前直接拦截（503）" }
    : ai.configMode === "disabled"
      ? { variant: "neutral" as const, label: "未配置凭证", summary: "服务端未配置模型参数，断路器处于默认放行状态" }
      : ai.configMode === "invalid"
        ? { variant: "warning" as const, label: "配置异常", summary: `服务端模型配置未通过校验（${ai.configReason ?? "invalid"}）` }
        : { variant: "brand" as const, label: "运行就绪", summary: "模型通道与并发限流队列正常放行" };

  const queueText =
    ai.queue && ai.limits
      ? `执行中 ${ai.queue.active}/${ai.limits.concurrency}，排队 ${ai.queue.waiting}/${ai.limits.queueLimit}，活跃账户 ${ai.queue.activeActors}（单户上限 ${ai.limits.actorLimit}）`
      : "未挂载队列";

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel" aria-label="服务与数据库探针">
          <header className="panel-head">
            <h2>服务与数据库探针</h2>
            <Badge variant={dbHealthy ? "brand" : "danger"}>
              {dbHealthy ? "健康" : "异常"}
            </Badge>
          </header>
          <dl className="m-0">
            <MetricRow
              label="数据库探针 (/healthz)"
              value={
                dbHealthy
                  ? `正常（${probe.dbLatencyMs ?? 0} ms）`
                  : "连接不可达"
              }
            />
            <MetricRow
              label="当前活跃会话"
              value={`${probe.activeSessions} 个`}
            />
            <MetricRow
              label="进程持续运行"
              value={formatUptime(probe.uptimeSec)}
            />
            <MetricRow label="运行环境" value={`Node ${probe.nodeVersion}`} />
            <MetricRow
              label="最近探测时间"
              value={formatCheckedAt(data.checkedAt, timeZone)}
            />
          </dl>
        </section>

        <section className="panel" aria-label="AI 客户端与熔断控制">
          <header className="panel-head">
            <h2>AI 客户端与熔断控制</h2>
            <Badge variant={canManageAi ? "brand" : "neutral"}>
              {canManageAi ? "可维护" : "只读"}
            </Badge>
          </header>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)] p-3.5">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant={aiBadge.variant}>{aiBadge.label}</Badge>
                  <span className="text-sm font-medium text-foreground">
                    全局 AI 熔断开关
                  </span>
                </div>
                <p className="m-0 text-xs leading-[18px] text-muted-foreground">
                  {aiBadge.summary}
                </p>
              </div>
              {ai.circuitOpen ? (
                <Button
                  key="restore-ai"
                  ref={circuitTrigger}
                  type="button"
                  size="sm"
                  disabled={!canManageAi}
                  title={!canManageAi ? "仅超级管理员可操作 AI 熔断开关" : undefined}
                  onClick={() => setConfirmCircuit("enable")}
                >
                  恢复 AI 服务
                </Button>
              ) : (
                <Button
                  key="trip-ai"
                  ref={circuitTrigger}
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!canManageAi}
                  title={!canManageAi ? "仅超级管理员可操作 AI 熔断开关" : undefined}
                  onClick={() => setConfirmCircuit("disable")}
                >
                  一键熔断 AI
                </Button>
              )}
            </div>

            <dl className="m-0">
              <MetricRow
                label="接入模式"
                value={AI_MODE_LABELS[ai.configMode]}
              />
              <MetricRow label="当前模型" value={ai.model ?? "—"} />
              <MetricRow label="实时队列水位" value={queueText} />
              <MetricRow
                label="单次超时上限"
                value={ai.timeoutMs ? `${ai.timeoutMs} ms` : "—"}
              />
            </dl>
          </div>
        </section>
      </div>

      {confirmCircuit && (
        <ConfirmDialog
          title={
            confirmCircuit === "disable" ? "开启 AI 全局熔断" : "恢复 AI 服务"
          }
          description={
            confirmCircuit === "disable"
              ? "开启后将立即拦截全站自然语言筛选与模型请求（返回 503），状态持久化至数据库并写入操作日志。"
              : "关闭熔断后，若服务端已配置有效模型凭证，AI 能力将立即恢复放行并写入操作日志。"
          }
          submitText={confirmCircuit === "disable" ? "确认熔断" : "确认恢复"}
          submitVariant={confirmCircuit === "disable" ? "destructive" : "default"}
          trigger={circuitTrigger.current}
          action={() =>
            request("/system/ai-circuit", "PATCH", {
              enabled: confirmCircuit === "enable",
            })
          }
          close={async (done) => {
            const mode = confirmCircuit;
            setConfirmCircuit(null);
            if (done) {
              await Promise.all([
                cache.invalidateQueries({ queryKey: ["system-status"] }),
                cache.invalidateQueries({ queryKey: ["asset-agent-config"] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(
                mode === "disable"
                  ? "已开启 AI 全局熔断"
                  : "已恢复 AI 服务放行",
              );
            }
          }}
        />
      )}
    </>
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

  useEffect(() => {
    if (query.data?.timezone) {
      setTimezone(query.data.timezone);
    }
  }, [query.data?.timezone]);

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
      <div
        role="status"
        aria-label="正在加载"
        className="panel p-6 text-sm text-muted-foreground"
      >
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
  const hasChanged = Boolean(
    timezone && settings.timezone && timezone !== settings.timezone,
  );

  return (
    <section className="panel" aria-label="时间与区域设置">
      <header className="panel-head">
        <h2>时间与区域设置</h2>
        <Badge variant={canManageSettings ? "brand" : "neutral"}>
          {canManageSettings ? "可维护" : "只读"}
        </Badge>
      </header>
      <div className="flex flex-col gap-5">
        <div className="flex max-w-md flex-col gap-2">
          <Label htmlFor="system-timezone">系统时区</Label>
          <Select
            value={timezone}
            onValueChange={setTimezone}
            disabled={!canManageSettings || save.isPending}
          >
            <SelectTrigger id="system-timezone" aria-label="系统时区">
              <SelectValue placeholder="请选择系统时区" />
            </SelectTrigger>
            <SelectContent>
              {settings.timezoneOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 rounded-md border-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)] p-4 text-sm sm:grid-cols-3">
          <div>
            <p className="m-0 text-xs text-muted-foreground">当前生效时区</p>
            <p className="m-0 mt-1 font-medium text-foreground">
              {settings.timezoneLabel}
            </p>
          </div>
          <div>
            <p className="m-0 text-xs text-muted-foreground">配置来源</p>
            <p className="m-0 mt-1 font-medium text-foreground">
              {SOURCE_LABELS[settings.source]}
            </p>
          </div>
          <div>
            <p className="m-0 text-xs text-muted-foreground">维护权限</p>
            <p className="m-0 mt-1 font-medium text-foreground">
              {canManageSettings ? "可修改" : "仅查看"}
            </p>
          </div>
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
