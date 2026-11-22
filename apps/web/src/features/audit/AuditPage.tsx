import { useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Download } from "lucide-react";
import {
  ACTOR_SOURCES,
  ACTOR_SOURCE_LABELS,
  DEFAULT_SYSTEM_TIMEZONE,
  JOB_TYPE_LABELS,
  PERMISSION_CATALOG,
  ROLE_LABELS,
  type AccountRole,
  type ActorSource,
  type AuditAction,
} from "@optimax-starter/api";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DetailDrawer,
  DetailField,
  DetailSection,
} from "@/components/ui/detail-drawer";
import { toast } from "@/components/ui/toast";
import { api, unwrapRpc, type AuditEntry } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  parseAuditSearch,
} from "@/features/filters/search";
import type { Filters } from "@/hooks/usePersistedFilters";
import { downloadCsv } from "@/lib/csv";

const route = getRouteApi("/audit");
const SIZES = [20, 50, 100];
const ACTION_LABELS: Record<string, string> = AUDIT_ACTION_LABELS;
const FIELD_LABELS: Record<string, string> = {
  name: "姓名",
  email: "邮箱",
  company: "公司",
  domain: "业务域",
  owner: "责任团队",
  stage: "登记状态",
};
const ROLE: Record<string, string> = ROLE_LABELS as Record<AccountRole, string>;
const JOB_TYPES_ZH: Record<string, string> = JOB_TYPE_LABELS;
const PERMISSION_LABELS = new Map(PERMISSION_CATALOG.map((p) => [p.code, p.label]));

/** Badge variant per actor source: Agent uses the brand tint, system integrations the outline style. */
const sourceVariant = (src: string | undefined) =>
  src === "agent" ? ("brand" as const) : src === "system" ? ("outline" as const) : ("neutral" as const);

const JOB_STATUS_ZH: Record<string, string> = {
  pending: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/** Package 2 actions: bulk import, attachments, jobs and API tokens (detail never holds secrets or bytes). */
function describeResource(row: AuditEntry): string | null {
  const d = row.detail ?? {};
  const parts: string[] = [];
  switch (row.action) {
    case "asset.bulk_import":
      if (typeof d.imported === "number") parts.push(`导入 ${d.imported} 项`);
      if (typeof d.skipped === "number" && d.skipped > 0) parts.push(`跳过 ${d.skipped} 行`);
      if (typeof d.filename === "string" && d.filename) parts.push(`文件：${d.filename}`);
      if (typeof d.jobId === "number") parts.push(`任务 JOB-${d.jobId}`);
      break;
    case "attachment.upload":
    case "attachment.delete":
      if (typeof d.filename === "string") parts.push(`文件：${d.filename}`);
      if (typeof d.sizeBytes === "number") parts.push(formatBytes(d.sizeBytes));
      if (typeof d.entityId === "number") parts.push(`资产 AS-${String(d.entityId).padStart(3, "0")}`);
      break;
    case "job.create":
    case "job.retry":
    case "job.cancel":
      if (typeof d.jobId === "number") parts.push(`JOB-${d.jobId}`);
      if (typeof d.jobType === "string") parts.push(JOB_TYPES_ZH[d.jobType] ?? d.jobType);
      if (typeof d.from === "string" && typeof d.to === "string") {
        parts.push(`${JOB_STATUS_ZH[d.from] ?? d.from} → ${JOB_STATUS_ZH[d.to] ?? d.to}`);
      }
      break;
    case "token.create":
    case "token.revoke":
      if (typeof d.prefix === "string") parts.push(`前缀：${d.prefix}…`);
      if (typeof d.actorSource === "string") {
        parts.push(`来源：${ACTOR_SOURCE_LABELS[d.actorSource as ActorSource] ?? d.actorSource}`);
      }
      if (Array.isArray(d.scopes)) {
        const labels = d.scopes.map((s) => PERMISSION_LABELS.get(String(s)) ?? String(s));
        parts.push(`权限 ${labels.length} 项：${labels.slice(0, 4).join("、")}${labels.length > 4 ? " 等" : ""}`);
      }
      if (typeof d.expiresAt === "string") parts.push(`有效期至 ${formatAuditTime(d.expiresAt)}`);
      break;
    default:
      return null;
  }
  return parts.join("；") || "—";
}

function makeFormatter(timeZone: string) {
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
    });
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: DEFAULT_SYSTEM_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
}

function value(action: string, v: unknown) {
  if (action === "account.role") return ROLE[String(v)] ?? String(v);
  if (action === "account.status") return v ? "已启用" : "已停用";
  if (action === "system.ai_circuit") return v ? "正常放行" : "已熔断";
  if (action === "permission.reset") return v === "default" ? "默认矩阵" : "自定义矩阵";
  return String(v);
}

// Fixed machine reasons written by the server; unknown values are shown as-is (they never carry secrets).
const REASON_LABELS: Record<string, string> = {
  invalid_credentials: "账户或密码错误",
  inactive: "账户已停用",
  locked: "失败次数过多已锁定",
  unmatched: "企业身份未关联账户",
  ambiguous: "邮箱匹配到多个账户",
};

function formatAuditTime(iso: unknown) {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

function describeAuth(row: AuditEntry): string | null {
  const d = row.detail ?? {};
  if (!row.action.startsWith("auth.") && !row.action.startsWith("account.invite_")) return null;
  const parts: string[] = [];
  if (typeof d.provider === "string") parts.push(`身份源：${d.provider}`);
  if (typeof d.reason === "string") parts.push(`原因：${REASON_LABELS[d.reason] ?? d.reason}`);
  if (row.action === "account.invite_create" && typeof d.expiresAt === "string") {
    parts.push(`有效期至 ${formatAuditTime(d.expiresAt)}`);
  }
  if (row.action === "account.invite_revoke" && typeof d.matched === "number") {
    parts.push(`撤销未使用链接 ${d.matched} 个`);
  }
  if (row.action === "account.invite_accept" && typeof d.sessions === "number" && d.sessions > 0) {
    parts.push(`撤销会话 ${d.sessions} 个`);
  }
  if (typeof d.ip === "string") parts.push(`IP：${d.ip}`);
  return parts.join("；") || "—";
}

function describe(row: AuditEntry) {
  const d = row.detail ?? {};
  const auth = describeAuth(row);
  if (auth !== null) return auth;
  const resource = describeResource(row);
  if (resource !== null) return resource;
  if (row.action === "permission.update") {
    const beforeLen = Array.isArray(d.beforePermissions) ? d.beforePermissions.length : 0;
    const afterLen = Array.isArray(d.afterPermissions) ? d.afterPermissions.length : 0;
    const targetRole = typeof d.targetRole === "string" ? ROLE[d.targetRole] ?? d.targetRole : "";
    return `${targetRole ? `角色：${targetRole}；` : ""}权限项 ${beforeLen} → ${afterLen}`;
  }
  if (row.action === "agent.asset_filter") {
    const parts: string[] = [];
    if (typeof d.matched === "number") parts.push(`命中 ${d.matched} 项`);
    if (typeof d.corrections === "number" && d.corrections > 0) {
      parts.push(`参数自愈 ${d.corrections} 次`);
    }
    if (typeof d.model === "string") parts.push(`模型：${d.model}`);
    return parts.join("；") || "已应用自然语言筛选";
  }
  const parts: string[] = [];
  if ("from" in d || "to" in d) {
    parts.push(`${value(row.action, d.from)} → ${value(row.action, d.to)}`);
  }
  if (typeof d.role === "string") parts.push(`角色：${ROLE[d.role] ?? d.role}`);
  if (typeof d.domain === "string") parts.push(`业务域：${d.domain}`);
  if (typeof d.stage === "string") parts.push(`状态：${d.stage}`);
  if (typeof d.matched === "number") parts.push(`共 ${d.matched} 项`);
  if (typeof d.sessions === "number") parts.push(`撤销会话 ${d.sessions} 个`);
  if (Array.isArray(d.fields)) {
    parts.push(
      `字段：${d.fields.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join("、")}`,
    );
  }
  return parts.join("；") || "—";
}

function Who({ name, username }: { name: string | null; username: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col">
      <span className="font-medium">{name}</span>
      {username && (
        <span className="font-mono text-xs text-muted-foreground">{username}</span>
      )}
    </span>
  );
}

export function AuditPage() {
  const me = useAccount(),
    canRead = hasPermission(me.data, "audit:read");
  const params = route.useSearch(),
    navigate = route.useNavigate();
  const page = params.page ?? 1,
    size = params.size ?? SIZES[0]!;
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const filters: Filters = {
    action: params.action,
    source: params.source,
    actor: params.actor,
    start: params.start,
    end: params.end,
  };
  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["audit", params],
    queryFn: () => {
      const sourceParam =
        typeof filters.source === "string" &&
        (ACTOR_SOURCES as readonly string[]).includes(filters.source)
          ? (filters.source as ActorSource)
          : undefined;
      const actionParam =
        typeof filters.action === "string" &&
        (AUDIT_ACTIONS as readonly string[]).includes(filters.action)
          ? (filters.action as AuditAction)
          : undefined;
      return unwrapRpc(
        api.audit.$get({
          query: {
            ...(actionParam ? { action: actionParam } : {}),
            ...(sourceParam ? { source: sourceParam } : {}),
            ...(typeof filters.actor === "string" && filters.actor
              ? { actor: filters.actor }
              : {}),
            ...(typeof filters.start === "string" && filters.start
              ? { start: filters.start }
              : {}),
            ...(typeof filters.end === "string" && filters.end
              ? { end: filters.end }
              : {}),
            page: String(page),
            size: String(size),
          },
        }),
      );
    },
    enabled: Boolean(me.data) && canRead,
    placeholderData: keepPreviousData,
  });

  const activeTimezone = query.data?.timezone ?? DEFAULT_SYSTEM_TIMEZONE;
  const formatter = useMemo(() => makeFormatter(activeTimezone), [activeTimezone]);

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: "at",
        header: "时间",
        enableSorting: false,
        cell: (c) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatter.format(new Date(String(c.getValue())))}
          </span>
        ),
      },
      {
        id: "auditAction",
        accessorKey: "action",
        header: "操作",
        enableSorting: false,
        cell: (c) => (
          <Badge variant="neutral">
            {ACTION_LABELS[String(c.getValue())] ?? String(c.getValue())}
          </Badge>
        ),
      },
      {
        accessorKey: "actorSource",
        header: "来源",
        enableSorting: false,
        cell: (c) => {
          const src = (c.getValue() as ActorSource | undefined) ?? "human";
          return (
            <Badge variant={sourceVariant(src)}>
              {ACTOR_SOURCE_LABELS[src] ?? "人工"}
            </Badge>
          );
        },
      },
      {
        id: "actor",
        header: "操作人",
        enableSorting: false,
        cell: (c) => (
          <Who name={c.row.original.actorName} username={c.row.original.actorUsername} />
        ),
      },
      {
        id: "target",
        header: "对象",
        enableSorting: false,
        cell: (c) => (
          <Who name={c.row.original.targetName} username={c.row.original.targetUsername} />
        ),
      },
      {
        id: "detail",
        header: "详情",
        enableSorting: false,
        cell: (c) => describe(c.row.original),
      },
      {
        id: "action",
        header: "查看",
        enableSorting: false,
        cell: (c) => (
          <div className="row-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`查看第 ${c.row.original.id} 条审计详情`}
              onClick={(e) => {
                returnFocus.current = e.currentTarget;
                setDetailEntry(c.row.original);
              }}
            >
              详情
            </Button>
          </div>
        ),
      },
    ],
    [formatter],
  );

  // 改变筛选回到第一页，保留每页条数。
  const setFilters = (next: Filters) =>
    void navigate({
      search: parseAuditSearch({ ...next, size: params.size }),
      replace: true,
    });
  const fields: FilterField[] = [
    {
      key: "source",
      label: "操作来源",
      type: "select",
      options: [
        { value: "human", label: "人工" },
        { value: "agent", label: "Agent" },
        { value: "system", label: "系统" },
      ],
    },
    {
      key: "actor",
      label: "操作人",
      type: "text",
      ariaLabel: "搜索操作人",
      placeholder: "搜索操作人姓名或账户",
    },
    {
      key: "action",
      label: "操作类型",
      type: "select",
      options: AUDIT_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a]! })),
    },
    { key: "start", label: "开始日期", type: "date", notAfter: "end" },
    { key: "end", label: "结束日期", type: "date", notBefore: "start" },
  ];
  const currentItems = query.data?.items ?? [];
  const formattedDetailJson = detailEntry
    ? JSON.stringify(detailEntry.detail ?? {}, null, 2)
    : "";
  return (
    <ResourceTableSlot
      title="操作日志"
      allowed={canRead}
      fields={fields}
      filters={filters}
      onApplyFilters={setFilters}
      columns={columns}
      data={currentItems}
      isLoading={query.isPending}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新操作日志"
      onRowClick={(row) => {
        returnFocus.current = null;
        setDetailEntry(row);
      }}
      toolbarEnd={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!currentItems.length}
          onClick={() => {
            const count = downloadCsv(`操作日志-第${page}页.csv`, currentItems, [
              { header: "时间", value: (r) => formatter.format(new Date(r.at)) },
              {
                header: "操作",
                value: (r) => ACTION_LABELS[r.action] ?? r.action,
              },
              {
                header: "来源",
                value: (r) =>
                  ACTOR_SOURCE_LABELS[(r.actorSource as ActorSource) ?? "human"] ??
                  "人工",
              },
              { header: "操作人", value: (r) => r.actorName },
              { header: "操作人账户", value: (r) => r.actorUsername },
              { header: "对象", value: (r) => r.targetName ?? "" },
              { header: "对象标识", value: (r) => r.targetUsername ?? "" },
              { header: "详情摘要", value: (r) => describe(r) },
            ]);
            toast.success(`已导出当前页 ${count} 条操作日志`);
          }}
        >
          <Download size={14} aria-hidden="true" />
          <span>导出当前页</span>
        </Button>
      }
      pagination={{
        pageIndex: page - 1,
        pageSize: size,
        total: query.data?.total ?? 0,
        sizes: SIZES,
        onChange: (p) =>
          void navigate({
            search: parseAuditSearch({
              ...filters,
              page: p.pageIndex + 1,
              size: p.pageSize,
            }),
            replace: true,
          }),
      }}
    >
      {detailEntry && (
        <DetailDrawer
          open
          onOpenChange={(open) => {
            if (!open) setDetailEntry(null);
          }}
          title={ACTION_LABELS[detailEntry.action] ?? detailEntry.action}
          description={`记录编号 #${detailEntry.id}，系统时区 ${activeTimezone}`}
          badge={
            <Badge
              variant={sourceVariant(detailEntry.actorSource)}
            >
              {ACTOR_SOURCE_LABELS[
                (detailEntry.actorSource as ActorSource) ?? "human"
              ] ?? "人工"}
            </Badge>
          }
          onCloseAutoFocus={(e) => {
            if (returnFocus.current?.isConnected) {
              e.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <DetailSection title="审计概览">
            <DetailField label="操作时间">
              <span className="tabular-nums">
                {formatter.format(new Date(detailEntry.at))}
              </span>
            </DetailField>
            <DetailField label="操作编码">
              <span className="font-mono text-xs text-muted-foreground">
                {detailEntry.action}
              </span>
            </DetailField>
            <DetailField label="操作人">
              <span>{detailEntry.actorName}</span>
              {detailEntry.actorUsername && (
                <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                  ({detailEntry.actorUsername})
                </span>
              )}
            </DetailField>
            <DetailField label="目标对象">
              {detailEntry.targetName ? (
                <>
                  <span>{detailEntry.targetName}</span>
                  {detailEntry.targetUsername && (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      ({detailEntry.targetUsername})
                    </span>
                  )}
                </>
              ) : (
                "—"
              )}
            </DetailField>
            <DetailField label="详情摘要" fullWidth>
              {describe(detailEntry)}
            </DetailField>
          </DetailSection>

          <DetailSection title="脱敏详情（JSON）">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      toast.error("当前环境不支持自动复制");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(formattedDetailJson)
                      .then(() => toast.success("已复制详情 JSON"))
                      .catch(() => toast.error("当前环境不支持自动复制"));
                  }}
                >
                  <Copy size={12} aria-hidden="true" />
                  <span>复制 JSON</span>
                </Button>
              </div>
              <pre className="m-0 max-h-72 overflow-auto rounded-md border-[0.5px] border-border bg-[var(--surface-subtle)] p-3 font-mono text-xs leading-5 text-foreground">
                {formattedDetailJson}
              </pre>
            </div>
          </DetailSection>
        </DetailDrawer>
      )}
    </ResourceTableSlot>
  );
}
