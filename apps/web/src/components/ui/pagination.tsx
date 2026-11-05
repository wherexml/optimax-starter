import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { ButtonProps, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
);
Pagination.displayName = "Pagination";

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
));
PaginationContent.displayName = "PaginationContent";

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
));
PaginationItem.displayName = "PaginationItem";

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<"a">;

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = "PaginationLink";

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="上一页"
    size="default"
    className={cn("gap-1 pl-2.5", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="下一页"
    size="default"
    className={cn("gap-1 pr-2.5", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    aria-hidden
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

// ============================================================================
// SmartPagination - 智能分页器组件
// ============================================================================

interface SmartPaginationProps {
  /** 当前页码 (1-based) */
  currentPage: number;
  /** 总页数 */
  totalPages: number;
  /** 页码变化回调 */
  onPageChange: (page: number) => void;
  /** 当前页两侧显示的页码数量，默认 1 */
  siblingCount?: number;
  /** 自定义样式类名 */
  className?: string;
  /** 上一页文本 */
  previousText?: string;
  /** 下一页文本 */
  nextText?: string;
  /** 是否显示上一页/下一页按钮，默认 true */
  showPrevNext?: boolean;
  /** 是否显示上一页/下一页按钮的文字（仅当 showPrevNext 为 true 时生效），默认 true */
  showPrevNextText?: boolean;
  /** 分页器尺寸，默认 "default" */
  size?: "default" | "sm";
  /** 每页显示条数 */
  pageSize?: number;
  /** 每页条数选项 */
  pageSizeOptions?: number[];
  /** 每页条数变化回调 */
  onPageSizeChange?: (size: number) => void;
}

/**
 * 生成分页器显示的页码数组
 *
 * 示例:
 * - 总页数 ≤ 7:      1 2 3 4 5 6 7
 * - 当前页靠前:       1 2 3 4 5 ... 34
 * - 当前页居中:       1 ... 15 16 17 ... 34
 * - 当前页靠后:       1 ... 30 31 32 33 34
 */
function generatePaginationRange(
  currentPage: number,
  totalPages: number,
  siblingCount: number = 1,
): (number | "ellipsis-start" | "ellipsis-end")[] {
  // 始终显示的页码数量: 首页 + 尾页 + 当前页 + 两侧兄弟页 + 2个省略号位置
  const totalPageNumbers = siblingCount * 2 + 5;

  // 如果总页数小于等于要显示的数量，直接显示所有页码
  if (totalPages <= totalPageNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // 计算左右兄弟页的范围
  const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
  const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

  // 判断是否需要显示省略号
  const shouldShowLeftEllipsis = leftSiblingIndex > 2;
  const shouldShowRightEllipsis = rightSiblingIndex < totalPages - 1;

  const firstPageIndex = 1;
  const lastPageIndex = totalPages;

  // 情况1: 只有右侧省略号 (当前页靠前)
  // 1 2 3 4 5 ... 34
  if (!shouldShowLeftEllipsis && shouldShowRightEllipsis) {
    const leftItemCount = 3 + 2 * siblingCount;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
    return [...leftRange, "ellipsis-end", lastPageIndex];
  }

  // 情况2: 只有左侧省略号 (当前页靠后)
  // 1 ... 30 31 32 33 34
  if (shouldShowLeftEllipsis && !shouldShowRightEllipsis) {
    const rightItemCount = 3 + 2 * siblingCount;
    const rightRange = Array.from(
      { length: rightItemCount },
      (_, i) => totalPages - rightItemCount + i + 1,
    );
    return [firstPageIndex, "ellipsis-start", ...rightRange];
  }

  // 情况3: 两侧都有省略号 (当前页居中)
  // 1 ... 15 16 17 ... 34
  if (shouldShowLeftEllipsis && shouldShowRightEllipsis) {
    const middleRange = Array.from(
      { length: rightSiblingIndex - leftSiblingIndex + 1 },
      (_, i) => leftSiblingIndex + i,
    );
    return [
      firstPageIndex,
      "ellipsis-start",
      ...middleRange,
      "ellipsis-end",
      lastPageIndex,
    ];
  }

  // 默认返回所有页码
  return Array.from({ length: totalPages }, (_, i) => i + 1);
}

/**
 * SmartPagination - 智能分页器组件
 *
 * 自动处理页码省略逻辑，支持大量页面时的优雅显示
 */
const SmartPagination = ({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 1,
  className,
  previousText = "Previous",
  nextText = "Next",
  showPrevNext = true,
  showPrevNextText = true,
  size = "default",
  pageSize,
  pageSizeOptions = [20, 50, 100],
  onPageSizeChange,
}: SmartPaginationProps) => {
  // 如果只有一页或没有页面，且没有页码选择器，不显示分页器
  if (totalPages <= 1 && !onPageSizeChange) {
    return null;
  }

  const paginationRange = generatePaginationRange(
    currentPage,
    totalPages,
    siblingCount,
  );

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // 根据 size 确定样式
  const isSmall = size === "sm";
  const iconSize = isSmall ? "h-3.5 w-3.5" : "h-4 w-4";
  const buttonSize = isSmall ? "h-7 w-7" : "h-9 w-9";
  const textSize = isSmall ? "text-xs" : "text-sm";

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {onPageSizeChange && pageSize && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-muted-foreground whitespace-nowrap hidden sm:inline-block",
              textSize,
            )}
          >
            Rows per page
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className={cn("h-8 w-[70px]", textSize)}>
              <SelectValue placeholder={String(pageSize)} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto">
          <PaginationContent className={isSmall ? "gap-0.5" : "gap-1"}>
            {/* 上一页按钮 */}
            {showPrevNext && (
              <PaginationItem>
                <PaginationLink
                  onClick={handlePrevious}
                  aria-label="上一页"
                  size={showPrevNextText ? "default" : "icon"}
                  className={cn(
                    "cursor-pointer",
                    showPrevNextText ? "gap-1 pl-2.5" : buttonSize,
                    isSmall && "p-0",
                    currentPage === 1 && "pointer-events-none opacity-50",
                  )}
                >
                  <ChevronLeft className={iconSize} />
                  {showPrevNextText && (
                    <span className={textSize}>{previousText}</span>
                  )}
                </PaginationLink>
              </PaginationItem>
            )}

            {/* 页码列表 */}
            {paginationRange.map((pageNumber, index) => {
              // 渲染省略号
              if (
                pageNumber === "ellipsis-start" ||
                pageNumber === "ellipsis-end"
              ) {
                return (
                  <PaginationItem key={pageNumber + index}>
                    <PaginationEllipsis
                      className={isSmall ? "h-7 w-7" : undefined}
                    />
                  </PaginationItem>
                );
              }

              // 渲染页码
              return (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    onClick={() => onPageChange(pageNumber as number)}
                    isActive={currentPage === pageNumber}
                    className={cn(
                      "cursor-pointer",
                      isSmall && `${buttonSize} p-0 ${textSize}`,
                    )}
                  >
                    {pageNumber}
                  </PaginationLink>
                </PaginationItem>
              );
            })}

            {/* 下一页按钮 */}
            {showPrevNext && (
              <PaginationItem>
                <PaginationLink
                  onClick={handleNext}
                  aria-label="下一页"
                  size={showPrevNextText ? "default" : "icon"}
                  className={cn(
                    "cursor-pointer",
                    showPrevNextText ? "gap-1 pr-2.5" : buttonSize,
                    isSmall && "p-0",
                    currentPage === totalPages &&
                      "pointer-events-none opacity-50",
                  )}
                >
                  {showPrevNextText && (
                    <span className={textSize}>{nextText}</span>
                  )}
                  <ChevronRight className={iconSize} />
                </PaginationLink>
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};
SmartPagination.displayName = "SmartPagination";

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  SmartPagination,
  generatePaginationRange,
};
