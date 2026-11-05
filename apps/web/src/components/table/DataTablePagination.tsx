import { Table as TanStackTable } from "@tanstack/react-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SmartPagination } from "@/components/ui/pagination";

interface DataTablePaginationProps<TData> {
  table: TanStackTable<TData>;
  pagination: {
    pageIndex: number;
    pageSize: number;
    total: number;
  };
  onPaginationChange: (pagination: {
    pageIndex: number;
    pageSize: number;
  }) => void;
  pageSizeOptions?: number[];
  showSelectionInfo?: boolean;
}

export function DataTablePagination<TData>({
  table,
  pagination,
  onPaginationChange,
  pageSizeOptions = [10, 20, 50, 100],
  showSelectionInfo = true,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize, total } = pagination;
  const pageCount = Math.ceil(total / pageSize);
  const hasSelectedRows = table.getFilteredSelectedRowModel().rows.length > 0;

  // 只有 1 页且没有选中行时，不显示分页区域
  if (total <= Math.min(...pageSizeOptions) && !hasSelectedRows) {
    return null;
  }

  return (
    <div className="px-4 py-1 shrink-0 flex items-center justify-end gap-3">
      {/* Selection info (only when rows selected and enabled) */}
      {showSelectionInfo && hasSelectedRows && (
        <span className="text-sm text-muted-foreground mr-auto">
          {table.getFilteredSelectedRowModel().rows.length} of {total} selected
        </span>
      )}

      {/* Page size selector & Pagination - 只在多页时显示 */}
      {total > 0 && (
        <>
          {/* Page size selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              每页
            </span>
            <Select
              value={`${pageSize}`}
              onValueChange={(value) => {
                onPaginationChange({
                  pageIndex: 0, // Reset to first page when changing page size
                  pageSize: Number(value),
                });
              }}
            >
              <SelectTrigger
                aria-label="每页条数"
                className="h-7 w-[70px] text-sm"
              >
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Smart Pagination */}
          <SmartPagination
            currentPage={pageIndex + 1}
            totalPages={pageCount}
            onPageChange={(page) =>
              onPaginationChange({ pageIndex: page - 1, pageSize })
            }
            siblingCount={1}
            showPrevNextText={false}
            size="sm"
          />
        </>
      )}
    </div>
  );
}
