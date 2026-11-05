// Adapted from skylance-easm/easm-webui/src/components/DataTable/DataTable.tsx.
import { useState, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives";
import { Skeleton } from "@optimax-starter/ui/components/skeleton";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import { useVirtualViewport } from "@/hooks/useVirtualViewport";

import { ColumnSettings } from "./ColumnSettings";
import { DataTablePagination } from "./DataTablePagination";
export function DataTable<T extends { id: number }>({
  data,
  columns,
  isLoading = false,
  error,
  toolbar,
  toolbarEnd,
  pagination,
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
}) {
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const table = useReactTable({
    data,
    columns,
    state: pagination
      ? {
          columnOrder,
          pagination: {
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
          },
        }
      : { columnOrder },
    onColumnOrderChange: setColumnOrder,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 8 } },
    manualPagination: Boolean(pagination),
    pageCount: pagination
      ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
      : undefined,
  });
  const { scrollContainerRef, handleScroll, scrollTop, viewportHeight } =
    useVirtualViewport({ enabled: true });
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-[var(--hairline)] px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {toolbar}
        </div>
        <div className="flex items-center gap-1">
          {toolbarEnd}
          <ColumnSettings
            columnOrder={table.getAllLeafColumns().map((c) => c.id)}
            columns={Object.fromEntries(
              table
                .getAllLeafColumns()
                .map((c) => [
                  c.id,
                  { visible: c.getIsVisible(), width: c.getSize() },
                ]),
            )}
            columnLabels={Object.fromEntries(
              table
                .getAllLeafColumns()
                .map((c) => [
                  c.id,
                  typeof c.columnDef.header === "string"
                    ? c.columnDef.header
                    : c.id,
                ]),
            )}
            translations={{ columnSettings: "列设置", dragToReorder: "列顺序" }}
            onColumnsChange={(prefs, order) => {
              if (!Object.values(prefs).some((c) => c.visible)) return;
              table.setColumnVisibility(
                Object.fromEntries(
                  Object.entries(prefs).map(([id, c]) => [id, c.visible]),
                ),
              );
              setColumnOrder(order);
            }}
          />
        </div>
      </div>
      {/* 表格主体 - 自动填满剩余空间 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        data-slot="datatable-scroll"
        className="min-h-0 flex-1 overflow-auto"
      >
        <Table
          style={
            enableColumnResize
              ? { width: table.getCenterTotalSize() }
              : undefined
          }
        >
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
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-sm px-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <span aria-hidden="true">
                          {header.column.getIsSorted() === "desc"
                            ? "↓"
                            : header.column.getIsSorted() === "asc"
                              ? "↑"
                              : "↕"}
                        </span>
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                    {/* Column Resize Handle */}
                    {enableColumnResize && header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:w-1.5 hover:bg-primary/50 transition-all border-r border-border group-hover:border-primary/30 ${
                          header.column.getIsResizing()
                            ? "bg-primary w-1.5"
                            : ""
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
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

                {shouldVirtualizeRows &&
                  virtualWindow.bottomSpacerHeight > 0 && (
                    <TableRow
                      aria-hidden="true"
                      className="hover:bg-transparent"
                    >
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
                <TableCell
                  colSpan={bodyColSpan}
                  className="h-24 text-center text-muted-foreground"
                >
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
              />
            </div>
          )
        : data.length > 8 && (
            <div className="border-t-[0.5px] border-[var(--hairline)] py-1.5">
              <DataTablePagination
                table={table}
                pagination={{ ...table.getState().pagination, total: data.length }}
                onPaginationChange={(p) => table.setPagination(p)}
                pageSizeOptions={[8, 20, 100]}
              />
            </div>
          )}
    </div>
  );
}
