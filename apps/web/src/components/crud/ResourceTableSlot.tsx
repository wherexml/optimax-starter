import type { ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { DataTable } from "@/components/table/DataTable";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
  wrapTable,
  children,
}: ResourceTableSlotProps<TData>) {
  const runRefresh = useContentRefresh();

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
    />
  );

  return (
    <>
      <PageHeader title={title} actions={actions} />
      {notice !== undefined && (
        <p role="status" className={notice ? "notice" : "m-0"}>
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-3 mt-0 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {wrapTable ? wrapTable(tableNode) : tableNode}
      {children}
    </>
  );
}
