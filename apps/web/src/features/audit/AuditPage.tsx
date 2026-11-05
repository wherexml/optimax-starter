import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/table/DataTable";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import type { Filters } from "@/hooks/usePersistedFilters";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  parseAuditSearch,
} from "@/features/filters/search";
import { useAccount } from "@/features/auth/session";
import { request, type AuditEntry, type AuditPage as Page } from "@/console-client";

const route = getRouteApi("/audit");
const SIZES = [20, 50, 100];
const ACTION_LABELS = AUDIT_ACTION_LABELS;
const FIELD_LABELS: Record<string, string> = {
  name: "姓名",
  email: "邮箱",
  company: "公司",
};
const ROLE: Record<string, string> = { admin: "管理员", member: "成员" };
// 与服务端日期筛选一致，按 UTC+8 显示。
const time = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function value(action: string, v: unknown) {
  if (action === "account.role") return ROLE[String(v)] ?? String(v);
  if (action === "account.status") return v ? "已启用" : "已停用";
  return String(v);
}
function describe(row: AuditEntry) {
  const d = row.detail ?? {};
  const parts: string[] = [];
  if ("from" in d || "to" in d)
    parts.push(`${value(row.action, d.from)} → ${value(row.action, d.to)}`);
  if (typeof d.role === "string") parts.push(`角色：${ROLE[d.role] ?? d.role}`);
  if (typeof d.sessions === "number") parts.push(`撤销会话 ${d.sessions} 个`);
  if (Array.isArray(d.fields))
    parts.push(`字段：${d.fields.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join("、")}`);
  return parts.join("；") || "—";
}
function Who({ name, username }: { name: string | null; username: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col">
      <span className="font-medium">{name}</span>
      <span className="font-mono text-xs text-muted-foreground">{username}</span>
    </span>
  );
}
const columns: ColumnDef<AuditEntry>[] = [
  {
    accessorKey: "at",
    header: "时间",
    enableSorting: false,
    cell: (c) => (
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {time.format(new Date(String(c.getValue())))}
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
];

export function AuditPage() {
  const me = useAccount(),
    admin = me.data?.role === "admin";
  const params = route.useSearch(),
    navigate = route.useNavigate();
  const page = params.page ?? 1,
    size = params.size ?? SIZES[0]!;
  const filters: Filters = {
    action: params.action,
    actor: params.actor,
    start: params.start,
    end: params.end,
  };
  const query = useQuery({
    queryKey: ["audit", params],
    queryFn: () => {
      const qs = new URLSearchParams(
        Object.entries({ ...filters, page, size })
          .filter(([, v]) => v !== undefined && String(v) !== "")
          .map(([k, v]) => [k, String(v)]),
      );
      return request<Page>("/audit?" + qs.toString());
    },
    enabled: admin,
    placeholderData: keepPreviousData,
  });
  // 改变筛选回到第一页，保留每页条数。
  const setFilters = (next: Filters) =>
    void navigate({
      search: parseAuditSearch({ ...next, size: params.size }),
      replace: true,
    });
  const fields: FilterField[] = [
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
  if (!admin)
    return (
      <>
        <PageHeader title="操作日志" />
        <p role="alert" className="text-muted-foreground">
          需要管理员权限
        </p>
      </>
    );
  return (
    <>
      <PageHeader title="操作日志" />
      <DataTable
        toolbar={
          <FilterBar
            fields={fields}
            values={filters}
            onApply={setFilters}
          />
        }
        toolbarEnd={
          <Button
            size="icon"
            className="h-9 w-9"
            title="刷新"
            variant="ghost"
            aria-label="刷新操作日志"
            onClick={() => query.refetch()}
          >
            <RotateCw size={15} />
          </Button>
        }
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isPending}
        error={query.error?.message}
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
    </>
  );
}
