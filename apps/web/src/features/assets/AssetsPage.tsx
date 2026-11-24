import type { AssetSortField } from "@optimax-starter/api";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CloudDownload, Download, FileUp, Plus } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttachmentPanel } from "@/components/attachments/AttachmentPanel";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { TableExportMenu } from "@/components/table/TableExportMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailDrawer, DetailField, DetailSection } from "@/components/ui/detail-drawer";
import { toast } from "@/components/ui/toast";
import { storageKey } from "@/config/app-config";
import {
  type Asset,
  type AssetSearch,
  api,
  assetsApi,
  downloadFrom,
  jobArtifactId,
  jobsApi,
  request,
  unwrapRpc,
} from "@/console-client";
// @starter:agent-start
import { AskAssistant } from "@/features/assistant/AssistantDrawer";
import { hasPermission, useAccount } from "@/features/auth/session";
import {
  ASSET_PAGE_SIZES,
  ASSET_SEARCH_DEFAULTS,
  asList,
  parseAssetSearch,
} from "@/features/filters/search";
import { type Filters, usePersistedFilters } from "@/hooks/usePersistedFilters";
import { downloadCsv } from "@/lib/csv";
import { AssetFormDialog } from "./AssetFormDialog";
import { AssetImportDialog } from "./AssetImportDialog";
import { assetColumns } from "./columns";

// @starter:agent-end

const PERSIST = ["code", "codeOp", "q", "qOp", "domain", "owner", "stage"] as const;
const route = getRouteApi("/assets");

/** Filter-only view of the URL search (no sort/paging), used by FilterBar and saved-filter restore. */
const filterValues = (s: AssetSearch): Filters => ({
  ...(s.code ? { code: s.code } : {}),
  ...(s.codeOp ? { codeOp: s.codeOp } : {}),
  ...(s.q ? { q: s.q } : {}),
  ...(s.qOp ? { qOp: s.qOp } : {}),
  ...(s.stage ? { stage: s.stage } : {}),
  ...(s.domain ? { domain: s.domain } : {}),
  ...(s.owner ? { owner: s.owner } : {}),
});
const parseFilters = (raw: Record<string, unknown>) => filterValues(parseAssetSearch(raw));

type PendingAction =
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "detail" | "edit" | "delete"; row: Asset }
  | {
      kind: "bulk-stage";
      rows: Asset[];
      stage: "已登记" | "待复核";
      clearSelection: () => void;
    }
  | {
      kind: "bulk-delete";
      rows: Asset[];
      clearSelection: () => void;
    }
  | null;

export function AssetsPage() {
  const me = useAccount();
  const cache = useQueryClient();
  const canRead = hasPermission(me.data, "assets:read");
  const canManage = hasPermission(me.data, "assets:manage");
  const [pending, setPending] = useState<PendingAction>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnToDetailRef = useRef<number | null>(null);

  // The router can keep raw or invalid keys (objects, nested arrays) even after validateSearch, so parse again here.
  const params = parseAssetSearch(route.useSearch() as Record<string, unknown>),
    navigate = route.useNavigate();

  const sortBy: AssetSortField = params.sortBy ?? ASSET_SEARCH_DEFAULTS.sortBy;
  const sortDir = params.sortDir ?? ASSET_SEARCH_DEFAULTS.sortDir;
  const page = params.page ?? ASSET_SEARCH_DEFAULTS.page;
  const size = params.size ?? ASSET_SEARCH_DEFAULTS.size;
  const filters = filterValues(params);

  // Stable value keyed by content: new array references from the router never refetch on their own.
  const searchKey = JSON.stringify({ ...params, sortBy, sortDir, page, size });
  const pageSearch = useMemo(() => JSON.parse(searchKey) as AssetSearch, [searchKey]);

  // Filter/sort/size changes omit `page`, which resets it to 1.
  const navigateSearch = useCallback(
    (next: AssetSearch) => navigate({ search: parseAssetSearch(next), replace: true }),
    [navigate],
  );

  const update = usePersistedFilters({
    scope: "assets",
    accountId: me.data?.id,
    values: filters,
    persist: PERSIST,
    parse: parseFilters,
    apply: (next) => navigateSearch({ ...parseFilters(next), sortBy, sortDir, size }),
  });

  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["assets", "page", pageSearch],
    queryFn: ({ signal }) => assetsApi.page(pageSearch, signal),
    placeholderData: keepPreviousData,
    enabled: Boolean(me.data) && canRead,
  });

  const facets = useQuery({
    queryKey: ["assets", "facets"],
    queryFn: () => assetsApi.facets(),
    enabled: Boolean(me.data) && canRead,
    staleTime: 30_000,
  });

  const domains = facets.data?.domains ?? [];
  const owners = facets.data?.owners ?? [];
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const activeDetailRow = useMemo(() => {
    if (pending?.kind !== "detail") return null;
    return rows.find((r) => r.id === pending.row.id) ?? pending.row;
  }, [pending, rows]);
  const detailIndex = activeDetailRow ? rows.findIndex((r) => r.id === activeDetailRow.id) : -1;

  // After deletions the current page may be past the end: step back to the last page.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(query.data.total / size));
    if (page > last) navigateSearch({ ...pageSearch, page: last });
  }, [query.data, query.isPlaceholderData, page, size, pageSearch, navigateSearch]);

  const fields: FilterField[] = [
    {
      key: "code",
      label: "编号",
      type: "text",
      ariaLabel: "搜索编号",
      placeholder: "搜索资产编号（如 AS-001）",
      operatorKey: "codeOp",
    },
    {
      key: "q",
      label: "资产名称",
      type: "text",
      ariaLabel: "搜索资产",
      placeholder: "搜索资产名称",
      operatorKey: "qOp",
    },
    {
      key: "domain",
      label: "业务域",
      type: "select",
      multi: true,
      options: domains.map((d) => ({ value: d, label: d })),
    },
    {
      key: "owner",
      label: "责任团队",
      type: "select",
      multi: true,
      options: owners.map((o) => ({ value: o, label: o })),
    },
    {
      key: "stage",
      label: "登记状态",
      type: "select",
      multi: true,
      options: [
        { value: "已登记", label: "已登记" },
        { value: "待复核", label: "待复核" },
      ],
    },
  ];

  // Async full export: enqueue assets.export_csv, poll until succeeded, then download the artifact.
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);
  const exportAll = useMutation({
    mutationFn: async () => {
      exportAbort.current?.abort();
      const controller = new AbortController();
      exportAbort.current = controller;
      const job = await jobsApi.create({
        type: "assets.export_csv",
        payload: {
          ...(params.code ? { code: params.code } : {}),
          ...(params.code && params.codeOp ? { codeOp: params.codeOp } : {}),
          ...(params.q ? { q: params.q } : {}),
          ...(params.q && params.qOp ? { qOp: params.qOp } : {}),
          ...(params.stage ? { stage: asList(params.stage) } : {}),
          ...(params.domain ? { domain: asList(params.domain) } : {}),
          ...(params.owner ? { owner: asList(params.owner) } : {}),
          sortBy,
          sortDir,
        },
      });
      toast.success("已创建导出任务，完成后自动下载");
      const done = await jobsApi.waitFor(job.id, { signal: controller.signal });
      const attachmentId = jobArtifactId(done);
      if (!attachmentId) throw new Error("导出文件不可用，请在系统设置的后台任务中查看");
      downloadFrom(`/attachments/${attachmentId}/download`);
      const count = typeof done.result?.rowCount === "number" ? done.result.rowCount : null;
      return { count, truncated: done.result?.truncated === true };
    },
    onSuccess: ({ count, truncated }) =>
      toast.success(
        count === null ? "导出完成" : `已导出 ${count} 条资产记录`,
        truncated ? { description: "超出单次导出上限，结果已截断" } : undefined,
      ),
    onError: (error) => {
      if (exportAbort.current?.signal.aborted) return;
      toast.error(error instanceof Error ? error.message : "导出失败");
    },
  });

  const openRowAction = useCallback(
    (kind: "detail" | "edit" | "delete", row: Asset, e?: MouseEvent<HTMLElement>) => {
      returnToDetailRef.current = null;
      returnFocus.current = e?.currentTarget ?? null;
      setPending({ kind, row });
    },
    [],
  );

  const columns = useMemo<ColumnDef<Asset>[]>(() => {
    return [
      ...assetColumns,
      {
        id: "action",
        header: "操作",
        enableSorting: false,
        cell: (c) => {
          const row = c.row.original;
          return (
            <div className="row-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`查看资产 ${row.name} 详情`}
                onClick={(e) => openRowAction("detail", row, e)}
              >
                详情
              </Button>
              {canManage && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`编辑资产 ${row.name}`}
                    onClick={(e) => openRowAction("edit", row, e)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`删除资产 ${row.name}`}
                    onClick={(e) => openRowAction("delete", row, e)}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ];
  }, [canManage, openRowAction]);

  function renderHeaderActions() {
    // @starter:agent-start
    if (!canManage) {
      return (
        <AskAssistant scope={{ kind: "assets", label: "资产台账", route: "/assets", filters }} />
      );
    }
    // @starter:agent-end
    return canManage ? (
      <div className="flex items-center gap-1.5">
        {/* @starter:agent-start */}
        <AskAssistant scope={{ kind: "assets", label: "资产台账", route: "/assets", filters }} />
        {/* @starter:agent-end */}
        <Button
          ref={importTrigger}
          variant="outline"
          size="sm"
          onClick={() => {
            returnFocus.current = importTrigger.current;
            setPending({ kind: "import" });
          }}
        >
          <FileUp size={15} />
          批量导入
        </Button>
        <Button
          ref={createTrigger}
          size="sm"
          onClick={() => {
            returnFocus.current = createTrigger.current;
            setPending({ kind: "create" });
          }}
        >
          <Plus size={15} />
          新增资产
        </Button>
      </div>
    ) : undefined;
  }

  return (
    <ResourceTableSlot
      title="资产台账"
      allowed={canRead}
      deniedMessage="无权查看资产台账"
      actions={renderHeaderActions()}
      fields={fields}
      filters={filters}
      onApplyFilters={update}
      draftStorageKey={
        me.data ? `${storageKey("filter-drafts.v1")}:${me.data.id}:assets` : undefined
      }
      columns={columns}
      data={rows}
      isLoading={query.isLoading}
      error={query.error?.message}
      onRefresh={() => Promise.all([query.refetch(), facets.refetch()])}
      refreshLabel="刷新资产"
      pagination={{
        pageIndex: page - 1,
        pageSize: size,
        total,
        sizes: [...ASSET_PAGE_SIZES],
        onChange: (p) =>
          navigateSearch({
            ...pageSearch,
            size: p.pageSize,
            // Changing the page size restarts at page 1.
            page: p.pageSize === size ? p.pageIndex + 1 : 1,
          }),
      }}
      sorting={{
        sortBy,
        sortDir,
        onChange: (next) =>
          navigateSearch({
            ...pageSearch,
            sortBy: next.sortBy as AssetSortField,
            sortDir: next.sortDir,
            page: 1,
          }),
      }}
      enableRowSelection={canManage}
      onRowClick={(row) => openRowAction("detail", row)}
      bulkActions={
        canManage
          ? ({ selectedRows, clearSelection }) => (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setPending({
                      kind: "bulk-stage",
                      rows: selectedRows,
                      stage: "已登记",
                      clearSelection,
                    });
                  }}
                >
                  设为已登记
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setPending({
                      kind: "bulk-stage",
                      rows: selectedRows,
                      stage: "待复核",
                      clearSelection,
                    });
                  }}
                >
                  设为待复核
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setPending({
                      kind: "bulk-delete",
                      rows: selectedRows,
                      clearSelection,
                    });
                  }}
                >
                  批量删除
                </Button>
              </>
            )
          : undefined
      }
      toolbarEnd={
        <TableExportMenu
          busy={exportAll.isPending}
          disabled={!rows.length && !total}
          items={[
            {
              label: "导出当前页 CSV",
              icon: Download,
              disabled: !rows.length,
              onSelect: () => {
                const count = downloadCsv("资产台账.csv", rows, [
                  {
                    header: "编号",
                    value: (r) => `AS-${String(r.id).padStart(3, "0")}`,
                  },
                  { header: "资产名称", value: (r) => r.name },
                  { header: "业务域", value: (r) => r.domain },
                  { header: "责任团队", value: (r) => r.owner },
                  { header: "登记状态", value: (r) => r.stage },
                ]);
                toast.success(`已导出当前页 ${count} 条资产记录`);
              },
            },
            {
              label: exportAll.isPending ? "正在导出…" : "异步导出全部",
              icon: CloudDownload,
              disabled: !total || exportAll.isPending,
              onSelect: () => exportAll.mutate(),
            },
          ]}
        />
      }
    >
      {activeDetailRow && (
        <DetailDrawer
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={activeDetailRow.name}
          description={`资产编号 AS-${String(activeDetailRow.id).padStart(3, "0")}`}
          badge={
            <Badge variant={activeDetailRow.stage === "已登记" ? "brand" : "warning"}>
              {activeDetailRow.stage}
            </Badge>
          }
          onCloseAutoFocus={(e) => {
            if (returnFocus.current?.isConnected) {
              e.preventDefault();
              returnFocus.current.focus();
            }
          }}
          actions={
            canManage ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    returnToDetailRef.current = activeDetailRow.id;
                    setPending({ kind: "edit", row: activeDetailRow });
                  }}
                >
                  编辑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    returnToDetailRef.current = activeDetailRow.id;
                    setPending({ kind: "delete", row: activeDetailRow });
                  }}
                >
                  删除
                </Button>
              </>
            ) : undefined
          }
          navigation={
            detailIndex >= 0
              ? {
                  hasPrev: detailIndex > 0,
                  hasNext: detailIndex < rows.length - 1,
                  current: detailIndex + 1,
                  total: rows.length,
                  onPrev: () => {
                    const prev = rows[detailIndex - 1];
                    if (prev) setPending({ kind: "detail", row: prev });
                  },
                  onNext: () => {
                    const next = rows[detailIndex + 1];
                    if (next) setPending({ kind: "detail", row: next });
                  },
                }
              : undefined
          }
        >
          <DetailSection title="台账信息">
            <DetailField label="资产编号">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                AS-{String(activeDetailRow.id).padStart(3, "0")}
              </span>
            </DetailField>
            <DetailField label="登记状态">{activeDetailRow.stage}</DetailField>
            <DetailField label="资产名称">{activeDetailRow.name}</DetailField>
            <DetailField label="业务域">{activeDetailRow.domain}</DetailField>
            <DetailField label="责任团队" fullWidth>
              {activeDetailRow.owner}
            </DetailField>
          </DetailSection>
          <AttachmentPanel entityId={activeDetailRow.id} canManage={canManage} />
        </DetailDrawer>
      )}
      {pending?.kind === "create" && (
        <AssetFormDialog
          trigger={returnFocus.current}
          close={(msg, created) => {
            setPending(null);
            if (msg) {
              const term = (params.q ?? "").trim();
              const stages: readonly string[] = asList(params.stage);
              const domainsList = asList(params.domain);
              const ownersList = asList(params.owner);
              const matchesCurrent =
                !created ||
                ((!term ||
                  (params.qOp === "equals"
                    ? created.name === term
                    : created.name.includes(term))) &&
                  (!stages.length || stages.includes(created.stage)) &&
                  (!domainsList.length || domainsList.includes(created.domain)) &&
                  (!ownersList.length || ownersList.includes(created.owner)));
              toast.success(
                msg,
                matchesCurrent
                  ? undefined
                  : { description: "当前筛选条件已隐藏该记录，可清空筛选查看" },
              );
            }
          }}
        />
      )}
      {pending?.kind === "import" && (
        <AssetImportDialog
          trigger={returnFocus.current}
          close={async (result) => {
            setPending(null);
            if (result) {
              await Promise.all([
                cache.invalidateQueries({ queryKey: ["assets"] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(
                `已导入 ${result.imported} 项资产`,
                result.skipped ? { description: `跳过 ${result.skipped} 行重名` } : undefined,
              );
            }
          }}
        />
      )}
      {pending?.kind === "edit" && (
        <AssetFormDialog
          asset={pending.row}
          trigger={returnFocus.current}
          close={(msg) => {
            const backId = returnToDetailRef.current;
            returnToDetailRef.current = null;
            const fallbackRow = pending.row;
            if (msg) toast.success(msg);
            if (backId !== null) {
              const latest = rows.find((r) => r.id === backId) ?? fallbackRow;
              setPending({ kind: "detail", row: latest });
            } else {
              setPending(null);
            }
          }}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="删除资产"
          description={`将从台账中删除「${pending.row.name}」，并写入操作日志。`}
          submitText="删除资产"
          trigger={returnFocus.current}
          action={() => request(`/assets/${pending.row.id}`, "DELETE", {})}
          close={async (done) => {
            const targetRow = pending.row;
            const backId = returnToDetailRef.current;
            returnToDetailRef.current = null;
            if (done) {
              setPending(null);
              await cache.invalidateQueries({ queryKey: ["assets"] });
              toast.success(`已删除资产 ${targetRow.name}`);
            } else if (backId !== null) {
              const latest = rows.find((r) => r.id === backId) ?? targetRow;
              setPending({ kind: "detail", row: latest });
            } else {
              setPending(null);
            }
          }}
        />
      )}
      {pending?.kind === "bulk-stage" && (
        <ConfirmDialog
          title={`批量设为${pending.stage}`}
          description={`将把选中的 ${pending.rows.length} 项资产登记状态统一更新为「${pending.stage}」，并写入操作日志。`}
          submitText="确认更新"
          submitVariant="default"
          trigger={returnFocus.current}
          action={() =>
            unwrapRpc(
              api.assets["bulk-stage"].$post({
                json: {
                  ids: pending.rows.map((r) => r.id),
                  stage: pending.stage,
                },
              }),
            )
          }
          close={async (done) => {
            const { count, stage, clearSelection } = {
              count: pending.rows.length,
              stage: pending.stage,
              clearSelection: pending.clearSelection,
            };
            setPending(null);
            if (done) {
              clearSelection();
              await Promise.all([
                cache.invalidateQueries({ queryKey: ["assets"] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(`已将 ${count} 项资产设为${stage}`);
            }
          }}
        />
      )}
      {pending?.kind === "bulk-delete" && (
        <ConfirmDialog
          title="批量删除资产"
          description={`将从台账中永久删除选中的 ${pending.rows.length} 项资产，并写入操作日志。`}
          submitText="确认删除"
          trigger={returnFocus.current}
          action={() =>
            unwrapRpc(
              api.assets["bulk-delete"].$post({
                json: { ids: pending.rows.map((r) => r.id) },
              }),
            )
          }
          close={async (done) => {
            const { count, clearSelection } = {
              count: pending.rows.length,
              clearSelection: pending.clearSelection,
            };
            setPending(null);
            if (done) {
              clearSelection();
              await Promise.all([
                cache.invalidateQueries({ queryKey: ["assets"] }),
                cache.invalidateQueries({ queryKey: ["audit"] }),
              ]);
              toast.success(`已删除 ${count} 项资产`);
            }
          }}
        />
      )}
    </ResourceTableSlot>
  );
}
