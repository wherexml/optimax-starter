import * as React from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@optimax-starter/ui/components/button";
import { Checkbox } from "@optimax-starter/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@optimax-starter/ui/components/popover";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  id?: string;
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  allLabel?: string;
  clearLabel?: string;
  searchable?: boolean;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

export const MultiSelect = React.forwardRef<HTMLButtonElement, MultiSelectProps>(
  (
    {
      id,
      label,
      options,
      value,
      onValueChange,
      placeholder = "请选择",
      emptyText = "暂无选项",
      allLabel = "全选",
      clearLabel = "清空",
      searchable,
      disabled,
      className,
      ...ariaProps
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const known = new Set(options.map((o) => o.value));
    const merged = [
      ...options,
      ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
    ];
    const showSearch = searchable ?? merged.length > 6;
    const filtered = query.trim()
      ? merged.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : merged;
    const names = value.map((v) => merged.find((o) => o.value === v)?.label ?? v);
    const text = !names.length
      ? placeholder
      : names.length <= 2
        ? names.join("、")
        : `已选 ${names.length} 项`;
    const toggle = (v: string) =>
      onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    const allSelected = options.length > 0 && options.every((o) => value.includes(o.value));

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
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
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          {/* type=button prevents opening the list from submitting a surrounding form. */}
          <Button
            ref={ref}
            type="button"
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-between gap-1.5 px-3 font-normal",
              !names.length && "text-muted-foreground",
              ariaProps["aria-invalid"] && "border-destructive",
              className,
            )}
            aria-label={`${label}：${names.length ? names.join("、") : placeholder}`}
            title={names.length ? names.join("、") : undefined}
            {...ariaProps}
          >
            <span className="truncate">{text}</span>
            <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          onWheel={(e) => e.stopPropagation()}
          className="w-[max(15rem,var(--radix-popover-trigger-width))] p-0"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {showSearch && (
            <div className="flex items-center gap-2 border-b-[0.5px] border-border px-2.5 py-2">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={query}
                aria-label={`搜索${label}`}
                placeholder={`搜索${label}…`}
                onChange={(e) => setQuery(e.target.value)}
                className="h-6 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="multi-select-empty">{emptyText}</p>
          ) : (
            <div role="group" aria-label={label} className="multi-select-list">
              {filtered.map((o) => (
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
  },
);
MultiSelect.displayName = "MultiSelect";
