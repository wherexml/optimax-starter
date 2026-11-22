import type { ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { DataTable, type ServerSortingConfig } from "@/components/table/DataTable";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";
import type { Filters } from "@/hooks/usePersistedFilters";

export interface ServerPaginationConfig {
  pageIndex: number;
  pageSize: number;
  total: number;
  sizes: number[];
  onChange: (p: { pageIndex: number; pageSize: number }) => void;
}

export interface ResourceTableSlotProps<TData extends { id: number }> {
  title: string;
  actions?: ReactNode;
  allowed?: boolean;
  deniedMessage?: string;
  notice?: string;
  actionError?: string | null;
  fields: FilterField[];
  filters: Filters;
  onApplyFilters: (next: Filters) => void;
  onDraftChange?: (dirty: boolean, signature: string) => void;
  draftStorageKey?: string;
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh: () => Promise<unknown>;
  refreshLabel?: string;
  toolbarEnd?: ReactNode;
  pagination?: ServerPaginationConfig;
  /** 服务端排序（受控）；提供时表格使用 manualSorting。 */
  sorting?: ServerSortingConfig;
  enableRowSelection?: boolean;
  bulkActions?: (ctx: {
    selectedRows: TData[];
    clearSelection: () => void;
  }) => ReactNode;
  onRowClick?: (row: TData) => void;
  wrapTable?: (table: ReactNode) => ReactNode;
  children?: ReactNode;
}

/**
 * Enterprise high-density CRUD/ledger page slot.
 * Composes PageHeader, permission boundary, status notice, EASM FilterBar + DataTable,
 * WorkspaceRefresh skeleton orchestration, and optional server pagination.
 */
export function ResourceTableSlot<TData extends { id: number }>({
  title,
  actions,
  allowed = true,
  deniedMessage = "需要管理员权限",
  notice,
  actionError,
  fields,
  filters,
  onApplyFilters,
  onDraftChange,
  draftStorageKey,
  columns,
  data,
  isLoading,
  error,
  onRefresh,
  refreshLabel,
  toolbarEnd,
  pagination,
  sorting,
  enableRowSelection,
  bulkActions,
  onRowClick,
  wrapTable,
  children,
}: ResourceTableSlotProps<TData>) {
  const runRefresh = useContentRefresh();
  const prevNotice = useRef("");
  const prevActionError = useRef("");

  useEffect(() => {
    const next = notice?.trim() ?? "";
    if (next && next !== prevNotice.current) {
      toast.success(next);
    }
    prevNotice.current = next;
  }, [notice]);

  useEffect(() => {
    const next = actionError?.trim() ?? "";
    if (next && next !== prevActionError.current) {
      toast.error(next);
    }
    prevActionError.current = next;
  }, [actionError]);

  if (!allowed) {
    return (
      <>
        <PageHeader title={title} />
        <p role="alert" className="text-muted-foreground">
          {deniedMessage}
        </p>
      </>
    );
  }

  const tableNode = (
    <DataTable
      toolbar={
        <FilterBar
          fields={fields}
          values={filters}
          onApply={onApplyFilters}
          onDraftChange={onDraftChange}
          storageKey={draftStorageKey}
        />
      }
      toolbarEnd={
        toolbarEnd ? (
          <div className="flex items-center gap-1.5">
            {toolbarEnd}
            <Button
              size="icon"
              className="h-9 w-9"
              title="刷新"
              variant="ghost"
              aria-label={refreshLabel ?? `刷新${title}`}
              onClick={() => void runRefresh(onRefresh)}
            >
              <RotateCw size={15} />
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            className="h-9 w-9"
            title="刷新"
            variant="ghost"
            aria-label={refreshLabel ?? `刷新${title}`}
            onClick={() => void runRefresh(onRefresh)}
          >
            <RotateCw size={15} />
          </Button>
        )
      }
      columns={columns}
      data={data}
      isLoading={isLoading}
      error={error}
      pagination={pagination}
      sorting={sorting}
      enableRowSelection={enableRowSelection}
      bulkActions={bulkActions}
      onRowClick={onRowClick}
    />
  );

  return (
    <>
      <PageHeader title={title} actions={actions} />
      {wrapTable ? wrapTable(tableNode) : tableNode}
      {children}
    </>
  );
}
