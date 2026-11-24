import {
  JOB_STATUS_LABELS,
  JOB_STATUSES,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  type Job,
  type JobStatus,
  type JobType,
} from "@optimax-starter/api";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Eraser, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { DataTable } from "@/components/table/DataTable";
import { TableExportMenu } from "@/components/table/TableExportMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { storageKey } from "@/config/app-config";
import { attachmentDownloadPath, isActiveJob, jobArtifactId, jobsApi } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";
import type { Filters } from "@/hooks/usePersistedFilters";
import { downloadCsv } from "@/lib/csv";

const PAGE_SIZES = [20, 50, 100];
const ACTIVE_REFRESH_MS = 2_000;

const JOB_FILTER_FIELDS: FilterField[] = [
  {
    key: "type",
    label: "类型",
    type: "select",
    options: JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] })),
  },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] })),
  },
];

const STATUS_VARIANT: Record<JobStatus, "neutral" | "brand" | "warning" | "danger" | "outline"> = {
  pending: "neutral",
  running: "warning",
  succeeded: "brand",
  failed: "danger",
  cancelled: "outline",
};

const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Short, secret-free summary of a job result (the server never returns raw CSV or tokens). */
export function summarizeJobResult(job: Pick<Job, "type" | "status" | "result" | "error">): string {
  if (job.status === "failed" || (job.status === "cancelled" && job.error))
    return job.error?.trim() || "执行失败";
  const r = job.result;
  if (!r) return "—";
  switch (job.type) {
    case "assets.export_csv":
      return `导出 ${num(r.rowCount)} 行${r.truncated === true ? "（已截断）" : ""}`;
    case "assets.bulk_import":
      return `导入 ${num(r.imported)} 行，跳过 ${num(r.skipped)} 行${num(r.errorCount) ? `，无效 ${num(r.errorCount)} 行` : ""}`;
    case "system.cleanup_expired":
      return `会话 ${num(r.sessions)} / SSO 状态 ${num(r.oidcStates)} / 邀请 ${num(r.invites)} / 登录锁 ${num(r.loginGuards)}`;
    default:
      return "—";
  }
}

type Pending =
  | { kind: "cancel"; job: Job; trigger: HTMLElement | null }
  | { kind: "cleanup"; trigger: HTMLElement | null }
  | null;

export function JobsTab() {
  const me = useAccount();
  const cache = useQueryClient();
  const runRefresh = useContentRefresh();
  const canRead = hasPermission(me.data, "jobs:read");
  const canManage = hasPermission(me.data, "jobs:manage");
  const canCleanup = canManage || hasPermission(me.data, "system:settings:manage");

  const [filters, setFilters] = useState<Filters>({});
  const [paging, setPaging] = useState({ pageIndex: 0, pageSize: PAGE_SIZES[0]! });
  const [pending, setPending] = useState<Pending>(null);

  const status =
    typeof filters.status === "string" &&
    (JOB_STATUSES as readonly string[]).includes(filters.status)
      ? (filters.status as JobStatus)
      : undefined;
  const type =
    typeof filters.type === "string" && (JOB_TYPES as readonly string[]).includes(filters.type)
      ? (filters.type as JobType)
      : undefined;

  const listQuery = { status, type, page: paging.pageIndex + 1, size: paging.pageSize };
  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["jobs", listQuery],
    queryFn: () => jobsApi.list(listQuery),
    placeholderData: keepPreviousData,
    enabled: Boolean(me.data) && canRead,
    // Poll every 2s only while the visible page still has pending/running jobs.
    refetchInterval: (q) => (q.state.data?.items.some(isActiveJob) ? ACTIVE_REFRESH_MS : false),
  });

  const invalidate = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["jobs"] }),
      cache.invalidateQueries({ queryKey: ["audit"] }),
    ]);

  const retry = useMutation({
    mutationFn: (job: Job) => jobsApi.retry(job.id),
    onSuccess: async (job) => {
      await invalidate();
      toast.success(`已重新排队 JOB-${job.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        id: "id",
        accessorKey: "id",
        header: "编号",
        enableSorting: false,
        cell: (c) => (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            JOB-{String(c.getValue())}
          </span>
        ),
      },
      {
        id: "type",
        accessorKey: "type",
        header: "类型",
        enableSorting: false,
        cell: (c) => JOB_TYPE_LABELS[c.getValue() as JobType] ?? String(c.getValue()),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "状态",
        enableSorting: false,
        cell: (c) => {
          const s = c.getValue() as JobStatus;
          return <Badge variant={STATUS_VARIANT[s]}>{JOB_STATUS_LABELS[s] ?? s}</Badge>;
        },
      },
      {
        id: "progress",
        accessorKey: "progress",
        header: "进度",
        enableSorting: false,
        cell: (c) => {
          const value = Math.max(0, Math.min(100, Number(c.getValue()) || 0));
          return (
            <div className="flex min-w-24 items-center gap-2">
              <div
                role="progressbar"
                aria-label={`JOB-${c.row.original.id} 进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${value}%` }}
                />
              </div>
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                {value}%
              </span>
            </div>
          );
        },
      },
      {
        id: "result",
        header: "结果",
        enableSorting: false,
        cell: (c) => {
          const job = c.row.original;
          const text = summarizeJobResult(job);
          return (
            <span
              className={`block max-w-72 truncate text-sm ${job.status === "failed" ? "text-destructive" : ""}`}
              title={text}
            >
              {text}
            </span>
          );
        },
      },
      {
        id: "attempts",
        header: "尝试",
        enableSorting: false,
        cell: (c) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {c.row.original.attempts}/{c.row.original.maxAttempts}
          </span>
        ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "创建时间",
        enableSorting: false,
        cell: (c) => (
          <span className="whitespace-nowrap text-xs tabular-nums">
            {formatTime(c.row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "action",
        header: "操作",
        enableSorting: false,
        enableHiding: false,
        cell: (c) => {
          const job = c.row.original;
          const artifact = job.status === "succeeded" ? jobArtifactId(job) : null;
          const canCancel = canManage && isActiveJob(job);
          const canRetry = canManage && (job.status === "failed" || job.status === "cancelled");
          return (
            <div className="row-actions">
              {artifact && (
                <Button asChild variant="ghost" size="sm" className="gap-1">
                  <a
                    href={attachmentDownloadPath(artifact)}
                    download
                    rel="noopener"
                    aria-label={`下载 JOB-${job.id} 结果文件`}
                  >
                    <Download size={14} aria-hidden="true" />
                    下载
                  </a>
                </Button>
              )}
              {canRetry && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={retry.isPending}
                  aria-label={`重试 JOB-${job.id}`}
                  onClick={() => retry.mutate(job)}
                >
                  重试
                </Button>
              )}
              {canCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label={`取消 JOB-${job.id}`}
                  onClick={(e) => setPending({ kind: "cancel", job, trigger: e.currentTarget })}
                >
                  取消
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [canManage, retry],
  );

  if (!canRead) {
    return (
      <p role="alert" className="text-muted-foreground">
        无权查看后台任务
      </p>
    );
  }

  const resetPage = () => setPaging((p) => ({ ...p, pageIndex: 0 }));
  const currentItems = query.data?.items ?? [];
  const hasActive = currentItems.some(isActiveJob);

  return (
    <>
      <DataTable
        data={currentItems}
        columns={columns}
        isLoading={query.isLoading}
        error={query.error?.message}
        toolbar={
          <>
            <FilterBar
              fields={JOB_FILTER_FIELDS}
              values={filters}
              storageKey={
                me.data ? `${storageKey("filter-drafts.v1")}:${me.data.id}:jobs` : undefined
              }
              onApply={(next) => {
                setFilters(next);
                resetPage();
              }}
            />
            {hasActive && (
              <span role="status" className="text-xs text-muted-foreground">
                自动刷新中
              </span>
            )}
          </>
        }
        toolbarEnd={
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="刷新"
              aria-label="刷新后台任务"
              onClick={() => void runRefresh(() => query.refetch())}
            >
              <RotateCw size={15} />
            </Button>
            <TableExportMenu
              disabled={!currentItems.length}
              items={[
                {
                  label: "导出当前页 CSV",
                  disabled: !currentItems.length,
                  onSelect: () => {
                    const count = downloadCsv(
                      `后台任务-第${paging.pageIndex + 1}页.csv`,
                      currentItems,
                      [
                        { header: "编号", value: (r) => `JOB-${r.id}` },
                        { header: "类型", value: (r) => JOB_TYPE_LABELS[r.type] ?? r.type },
                        { header: "状态", value: (r) => JOB_STATUS_LABELS[r.status] ?? r.status },
                        {
                          header: "进度",
                          value: (r) => `${Math.max(0, Math.min(100, Number(r.progress) || 0))}%`,
                        },
                        { header: "结果", value: (r) => summarizeJobResult(r) },
                        { header: "尝试", value: (r) => `${r.attempts}/${r.maxAttempts}` },
                        { header: "创建时间", value: (r) => formatTime(r.createdAt) },
                      ],
                    );
                    toast.success(`已导出当前页 ${count} 条后台任务`);
                  },
                },
              ]}
            />
            {canCleanup ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={(e) => setPending({ kind: "cleanup", trigger: e.currentTarget })}
              >
                <Eraser size={14} aria-hidden="true" />
                清理过期数据
              </Button>
            ) : null}
          </>
        }
        pagination={{
          pageIndex: paging.pageIndex,
          pageSize: paging.pageSize,
          total: query.data?.total ?? 0,
          sizes: PAGE_SIZES,
          onChange: (p) =>
            setPaging(p.pageSize === paging.pageSize ? p : { pageIndex: 0, pageSize: p.pageSize }),
        }}
      />
      {pending?.kind === "cancel" && (
        <ConfirmDialog
          title="取消任务"
          description={`将取消 JOB-${pending.job.id}（${JOB_TYPE_LABELS[pending.job.type]}），并写入操作日志。`}
          submitText="取消任务"
          trigger={pending.trigger}
          action={() => jobsApi.cancel(pending.job.id)}
          close={async (done) => {
            const id = pending.job.id;
            setPending(null);
            if (done) {
              await invalidate();
              toast.success(`已取消 JOB-${id}`);
            }
          }}
        />
      )}
      {pending?.kind === "cleanup" && (
        <ConfirmDialog
          title="清理过期数据"
          description="将排队清理已过期的会话、SSO 状态、邀请链接与登录锁记录，并写入操作日志。"
          submitText="开始清理"
          submitVariant="default"
          trigger={pending.trigger}
          action={() => jobsApi.create({ type: "system.cleanup_expired", payload: {} })}
          close={async (done) => {
            setPending(null);
            if (done) {
              setFilters({});
              resetPage();
              await invalidate();
              toast.success("已创建清理任务");
            }
          }}
        />
      )}
    </>
  );
}
