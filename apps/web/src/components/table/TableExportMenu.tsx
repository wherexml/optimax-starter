import { Download, Loader2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface TableExportItem {
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  onSelect: () => void;
}

export interface TableExportMenuProps {
  items: TableExportItem[];
  disabled?: boolean;
  busy?: boolean;
  label?: string;
}

/** 表格工具栏统一纯图标导出菜单：无触发文案与箭头，点击弹出具体导出范围操作。 */
export function TableExportMenu({
  items,
  disabled = false,
  busy = false,
  label = "导出",
}: TableExportMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={busy ? "正在导出" : label}
          title={busy ? "正在导出…" : label}
          disabled={disabled}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        {items.map((item) => {
          const ItemIcon = item.icon ?? Download;
          return (
            <button
              key={item.label}
              type="button"
              className="user-menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <ItemIcon size={14} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
