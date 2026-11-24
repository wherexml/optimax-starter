import { Popover, PopoverContent, PopoverTrigger } from "@optimax-starter/ui/components/popover";
import { cn } from "@optimax-starter/ui/lib/utils";
import { Check, ChevronDown, Search, X } from "lucide-react";
import * as React from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  keywords?: string[];
  disabled?: boolean;
}

export interface ComboboxProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      id,
      label,
      value,
      onValueChange,
      options,
      placeholder = "请选择",
      searchPlaceholder = "搜索选项…",
      emptyText = "未找到匹配选项",
      allowClear = false,
      disabled,
      className,
      ...ariaProps
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [activeIndex, setActiveIndex] = React.useState(0);
    const listId = React.useId();
    const listRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
      if (!open) return;
      const frame = requestAnimationFrame(() => {
        const current = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
        current?.scrollIntoView({ block: "nearest" });
      });
      return () => cancelAnimationFrame(frame);
    }, [open]);

    const selected = options.find((o) => o.value === value);
    const filtered = React.useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return options;
      return options.filter((o) =>
        [o.label, o.value, o.hint ?? "", ...(o.keywords ?? [])].some((text) =>
          text.toLowerCase().includes(q),
        ),
      );
    }, [options, query]);

    const enabledIndices = React.useMemo(
      () => filtered.map((o, idx) => (o.disabled ? -1 : idx)).filter((idx) => idx >= 0),
      [filtered],
    );

    const safeIndex = enabledIndices.includes(activeIndex)
      ? activeIndex
      : (enabledIndices[0] ?? -1);

    const handleOpenChange = (nextOpen: boolean) => {
      if (disabled) return;
      setOpen(nextOpen);
      if (nextOpen) {
        setQuery("");
        const currentIdx = options.findIndex((o) => o.value === value && !o.disabled);
        setActiveIndex(currentIdx >= 0 ? currentIdx : 0);
      }
    };

    const selectOption = (option: ComboboxOption) => {
      if (option.disabled) return;
      onValueChange(option.value);
      setOpen(false);
    };

    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={label}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border-[0.5px] border-input bg-card px-3 py-1.5 text-left text-sm leading-5 text-foreground transition-[border-color,background-color] duration-150 hover:border-[color:var(--foreground)]/30 data-[state=open]:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-75",
              ariaProps["aria-invalid"] && "border-destructive",
              className,
            )}
            {...ariaProps}
          >
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.label : placeholder}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {allowClear && selected && !disabled && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`清空${label ?? "选择"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onValueChange("");
                  }}
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </span>
              )}
              <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          onWheel={(e) => e.stopPropagation()}
          className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        >
          <div className="flex items-center gap-2 border-b-[0.5px] border-border px-2.5 py-2">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => {
                if (!enabledIndices.length) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const pos = enabledIndices.indexOf(safeIndex);
                  const nextPos =
                    e.key === "ArrowDown"
                      ? (pos + 1) % enabledIndices.length
                      : (pos - 1 + enabledIndices.length) % enabledIndices.length;
                  setActiveIndex(enabledIndices[nextPos]!);
                } else if (e.key === "Enter" && safeIndex >= 0) {
                  e.preventDefault();
                  const opt = filtered[safeIndex];
                  if (opt) selectOption(opt);
                }
              }}
              className="h-6 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label ?? "选项列表"}
            className="max-h-60 overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <p className="m-0 px-3 py-5 text-center text-xs leading-[18px] text-muted-foreground">
                {emptyText}
              </p>
            ) : (
              filtered.map((option, idx) => {
                const checked = option.value === value;
                const highlighted = idx === safeIndex;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    disabled={option.disabled}
                    aria-selected={checked}
                    onMouseEnter={() => {
                      if (!option.disabled) setActiveIndex(idx);
                    }}
                    onClick={() => selectOption(option)}
                    className={cn(
                      "relative flex min-h-8 w-full items-center justify-between gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-left text-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-45",
                      highlighted && "bg-accent text-accent-foreground",
                      checked && "font-medium",
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.hint && (
                        <span className="truncate text-xs font-normal leading-[18px] text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {checked && (
                      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center text-primary">
                        <Check aria-hidden="true" className="size-4" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
Combobox.displayName = "Combobox";

export { Combobox };
