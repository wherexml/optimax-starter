// Adapted from skylance-easm/easm-webui/src/components/DataTable/DataTable.tsx.

import { Skeleton } from "@optimax-starter/ui/components/skeleton";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import { useVirtualViewport } from "@/hooks/useVirtualViewport";
import { ColumnSettings } from "./ColumnSettings";
import { hasVisibleDataColumn } from "./column-settings-utils";
import { DataTablePagination } from "./DataTablePagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./primitives";

export type SortDirection = "asc" | "desc";

/** 服务端排序：受控 sortBy/sortDir；表头点击在 asc/desc 之间切换，不再回到未排序。 */
export interface ServerSortingConfig {
  sortBy: string;
  sortDir: SortDirection;
  onChange: (next: { sortBy: string; sortDir: SortDirection }) => void;
}

const DEFAULT_CLIENT_PAGE_SIZES = [8, 20, 100];

export function DataTable<T extends { id: number }>({
  data,
  columns,
  isLoading = false,
  error,
  toolbar,
  toolbarEnd,
  pagination,
  defaultPageSize = 8,
  pageSizes = DEFAULT_CLIENT_PAGE_SIZES,
  enableRowSelection = false,
  bulkActions,
  onRowClick,
  sorting,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  isLoading?: boolean;
  error?: ReactNode;
  toolbar?: ReactNode;
  toolbarEnd?: ReactNode;
  /** 服务端分页：data 为当前页，total 为全部条数。缺省时沿用客户端分页。 */
  pagination?: {
    pageIndex: number;
    pageSize: number;
    total: number;
    sizes: number[];
    onChange: (p: { pageIndex: number; pageSize: number }) => void;
  };
  /** 客户端分页默认每页条数与可选条数。 */
  defaultPageSize?: number;
  pageSizes?: number[];
  enableRowSelection?: boolean;
  bulkActions?: (ctx: { selectedRows: T[]; clearSelection: () => void }) => ReactNode;
  onRowClick?: (row: T) => void;
  sorting?: ServerSortingConfig;
}) {
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  useEffect(() => {
    if (!enableRowSelection) {
      setRowSelection((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    const existing = new Set(data.map((row) => String(row.id)));
    setRowSelection((prev) => {
      const entries = Object.entries(prev).filter(([id, checked]) => checked && existing.has(id));
      if (entries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(entries);
    });
  }, [data, enableRowSelection]);

  const resolvedColumns = useMemo<ColumnDef<T>[]>(() => {
    if (!enableRowSelection) return columns;
    const selectColumn: ColumnDef<T> = {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table: t }) => (
        <Checkbox
          aria-label="全选当前页"
          checked={
            t.getIsAllPageRowsSelected()
              ? true
              : t.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => t.toggleAllPageRowsSelected(Boolean(v))}
        />
      ),
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`选择第 ${row.index + 1} 行`}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          />
        </div>
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, enableRowSelection]);

  const sortingState = useMemo<SortingState | undefined>(
    () => (sorting ? [{ id: sorting.sortBy, desc: sorting.sortDir === "desc" }] : undefined),
    [sorting?.sortBy, sorting?.sortDir],
  );

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    enableRowSelection,
    state: {
      columnOrder,
      rowSelection,
      ...(pagination
        ? {
            pagination: {
              pageIndex: pagination.pageIndex,
              pageSize: pagination.pageSize,
            },
          }
        : {}),
      ...(sortingState ? { sorting: sortingState } : {}),
    },
    ...(sorting
      ? {
          manualSorting: true,
          enableSortingRemoval: false,
          onSortingChange: () => undefined,
        }
      : {}),
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: defaultPageSize } },
    manualPagination: Boolean(pagination),
    pageCount: pagination
      ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
      : undefined,
  });
  const selectedRows = enableRowSelection
    ? table.getSelectedRowModel().flatRows.map((r) => r.original)
    : [];
  const clearSelection = () => setRowSelection({});
  const { scrollContainerRef, handleScroll, scrollTop, viewportHeight } = useVirtualViewport({
    enabled: true,
  });
  const rows = table.getRowModel().rows;
  const shouldVirtualizeRows = rows.length >= 80;
  const virtualWindow = useVirtualRows({
    count: rows.length,
    scrollTop,
    viewportHeight,
    rowHeight: 44,
    overscan: 6,
    enabled: shouldVirtualizeRows,
  });
  const visibleRows = shouldVirtualizeRows
    ? rows.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : rows;
  const bodyColSpan = table.getVisibleLeafColumns().length,
    skeletonRows = 5,
    emptyText = "暂无匹配记录",
    enableColumnResize = false;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border-[0.5px] border-[var(--hairline)] bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-[var(--hairline)] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-1.5">
          {toolbarEnd}
          <ColumnSettings
            columnOrder={table.getAllLeafColumns().map((c) => c.id)}
            columns={Object.fromEntries(
              table
                .getAllLeafColumns()
                .map((c) => [c.id, { visible: c.getIsVisible(), width: c.getSize() }]),
            )}
            columnLabels={Object.fromEntries(
              table
                .getAllLeafColumns()
                .map((c) => [
                  c.id,
                  typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
                ]),
            )}
            translations={{ columnSettings: "列设置", dragToReorder: "列顺序" }}
            onColumnsChange={(prefs, order) => {
              if (!hasVisibleDataColumn(prefs)) return;
              table.setColumnVisibility(
                Object.fromEntries(Object.entries(prefs).map(([id, c]) => [id, c.visible])),
              );
              setColumnOrder(order);
            }}
          />
        </div>
      </div>
      {enableRowSelection && selectedRows.length > 0 && bulkActions && (
        <div
          role="region"
          aria-label="批量操作"
          className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-[var(--hairline)] bg-accent/55 px-3 py-2 text-sm"
        >
          <span className="font-medium text-foreground">
            已选 <span className="tabular-nums">{selectedRows.length}</span> 项
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {bulkActions({ selectedRows, clearSelection })}
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
              取消选择
            </Button>
          </div>
        </div>
      )}
      {/* 表格主体 - 自动填满剩余空间 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        data-slot="datatable-scroll"
        className="min-h-0 flex-1 overflow-auto"
      >
        <Table style={enableColumnResize ? { width: table.getCenterTotalSize() } : undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="relative select-none group"
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                    style={
                      enableColumnResize
                        ? {
                            width: header.getSize(),
                            minWidth: header.getSize(),
                          }
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                        sorting
                          ? header.column.columnDef.enableSorting === true
                          : header.column.getCanSort()
                      ) ? (
                      <button
                        type="button"
                        className="-mx-1 inline-flex min-h-10 items-center gap-1 rounded-sm px-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={
                          sorting
                            ? () =>
                                sorting.onChange({
                                  sortBy: header.column.id,
                                  // Same column flips asc ⇄ desc; a new column starts at asc.
                                  sortDir:
                                    sorting.sortBy === header.column.id && sorting.sortDir === "asc"
                                      ? "desc"
                                      : "asc",
                                })
                            : header.column.getToggleSortingHandler()
                        }
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true">
                          {header.column.getIsSorted() === "desc"
                            ? "↓"
                            : header.column.getIsSorted() === "asc"
                              ? "↑"
                              : "↕"}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                    {/* Column Resize Handle */}
                    {enableColumnResize && header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:w-1.5 hover:bg-primary/50 transition-all border-r border-border group-hover:border-primary/30 ${
                          header.column.getIsResizing() ? "bg-primary w-1.5" : ""
                        }`}
                        title="Drag to resize column"
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // 加载状态：显示骨架行
              [...Array(skeletonRows)].map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell colSpan={bodyColSpan}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell
                  colSpan={bodyColSpan}
                  role="alert"
                  className="h-24 text-center text-destructive"
                >
                  {error}
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              <>
                {shouldVirtualizeRows && virtualWindow.topSpacerHeight > 0 && (
                  <TableRow aria-hidden="true" className="hover:bg-transparent">
                    <TableCell
                      colSpan={bodyColSpan}
                      style={{
                        height: `${virtualWindow.topSpacerHeight}px`,
                        padding: 0,
                        border: 0,
                      }}
                    />
                  </TableRow>
                )}

                {visibleRows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-row-id={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={onRowClick ? "cursor-pointer" : undefined}
                    onClick={
                      onRowClick
                        ? (e) => {
                            if (
                              (e.target as HTMLElement).closest("button,a,input,[role=checkbox]")
                            ) {
                              return;
                            }
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={
                          enableColumnResize
                            ? {
                                width: cell.column.getSize(),
                                minWidth: cell.column.getSize(),
                                maxWidth: cell.column.getSize(),
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }
                            : undefined
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

                {shouldVirtualizeRows && virtualWindow.bottomSpacerHeight > 0 && (
                  <TableRow aria-hidden="true" className="hover:bg-transparent">
                    <TableCell
                      colSpan={bodyColSpan}
                      style={{
                        height: `${virtualWindow.bottomSpacerHeight}px`,
                        padding: 0,
                        border: 0,
                      }}
                    />
                  </TableRow>
                )}
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={bodyColSpan} className="h-24 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pagination
        ? pagination.total > Math.min(...pagination.sizes) && (
            <div className="border-t-[0.5px] border-[var(--hairline)] py-1.5">
              <DataTablePagination
                table={table}
                pagination={{
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  total: pagination.total,
                }}
                onPaginationChange={pagination.onChange}
                pageSizeOptions={pagination.sizes}
                showSelectionInfo={false}
              />
            </div>
          )
        : data.length > Math.min(...pageSizes) && (
            <div className="border-t-[0.5px] border-[var(--hairline)] py-1.5">
              <DataTablePagination
                table={table}
                pagination={{ ...table.getState().pagination, total: data.length }}
                onPaginationChange={(p) => table.setPagination(p)}
                pageSizeOptions={pageSizes}
                showSelectionInfo={false}
              />
            </div>
          )}
    </div>
  );
}
