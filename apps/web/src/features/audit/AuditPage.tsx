import { useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import {
  ACTOR_SOURCE_LABELS,
  DEFAULT_SYSTEM_TIMEZONE,
  ROLE_LABELS,
  type AccountRole,
  type ActorSource,
} from "@optimax-starter/api";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import { type FilterField } from "@/components/filters/FilterBar";
import { Badge } from "@/components/ui/badge";
import { request, type AuditEntry, type AuditPage as Page } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  parseAuditSearch,
} from "@/features/filters/search";
import type { Filters } from "@/hooks/usePersistedFilters";

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

function describe(row: AuditEntry) {
  const d = row.detail ?? {};
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
      const qs = new URLSearchParams(
        Object.entries({ ...filters, page, size })
          .filter(([, v]) => v !== undefined && String(v) !== "")
          .map(([k, v]) => [k, String(v)]),
      );
      return request<Page>("/audit?" + qs.toString());
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
            <Badge variant={src === "agent" ? "brand" : "neutral"}>
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
  return (
    <ResourceTableSlot
      title="操作日志"
      allowed={canRead}
      fields={fields}
      filters={filters}
      onApplyFilters={setFilters}
      columns={columns}
      data={query.data?.items ?? []}
      isLoading={query.isPending}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新操作日志"
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
    />
  );
}
