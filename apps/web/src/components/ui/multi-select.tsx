// Adapted from skylance-easm components/ui/multi-select.tsx (Radix Popover + Checkbox).
// Shows no counts: EASM displays option.count, and this project has no real counts to show.
// Selected values that are not among the current options stay listed and can be unchecked.
import { useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelect({
  id,
  label,
  options,
  value,
  onValueChange,
  placeholder = "请选择",
  emptyText = "暂无选项",
  allLabel = "全选",
  clearLabel = "清空",
  className,
}: {
  id?: string;
  /** Accessible name of the field, e.g. 业务域. */
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  allLabel?: string;
  clearLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const known = new Set(options.map((o) => o.value));
  const merged = [
    ...options,
    ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ];
  const names = value.map((v) => merged.find((o) => o.value === v)?.label ?? v);
  const text = !names.length
    ? placeholder
    : names.length <= 2
      ? names.join("、")
      : `已选 ${names.length} 项`;
  const toggle = (v: string) =>
    onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const allSelected = options.length > 0 && options.every((o) => value.includes(o.value));
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>('[role="checkbox"]'),
    ];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? (i + 1) % items.length
        : i <= 0
          ? items.length - 1
          : i - 1;
    items[next]?.focus();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* type=button: opening the list must never submit the surrounding filter form. */}
        <Button
          type="button"
          id={id}
          variant="outline"
          className={cn("justify-between gap-1 px-3 font-normal", className)}
          aria-label={`${label}：${names.length ? names.join("、") : placeholder}`}
          title={names.length ? names.join("、") : undefined}
        >
          <span className="truncate">{text}</span>
          <ChevronDown size={14} aria-hidden="true" className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-60 p-0"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {merged.length === 0 ? (
          <p className="multi-select-empty">{emptyText}</p>
        ) : (
          <div role="group" aria-label={label} className="multi-select-list">
            {merged.map((o) => (
              <label
                key={o.value}
                className="multi-select-option"
                data-unknown={known.has(o.value) ? undefined : ""}
              >
                <Checkbox
                  checked={value.includes(o.value)}
                  onCheckedChange={() => toggle(o.value)}
                />
                <span className="truncate" title={o.label}>
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="multi-select-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={allSelected || !options.length}
            onClick={() =>
              onValueChange([...new Set([...value, ...options.map((o) => o.value)])])
            }
          >
            {allLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!value.length}
            onClick={() => onValueChange([])}
          >
            {clearLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
