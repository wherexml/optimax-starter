import { cn } from "@optimax-starter/ui/lib/utils";
import { X } from "lucide-react";
import * as React from "react";

export interface TagInputProps {
  id?: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  disabled?: boolean;
  validateTag?: (tag: string) => string | null;
  onRejectTag?: (reason: string) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  (
    {
      id,
      value,
      onValueChange,
      placeholder = "输入后按 Enter 添加",
      maxTags = 12,
      disabled,
      validateTag,
      onRejectTag,
      className,
      ...ariaProps
    },
    ref,
  ) => {
    const [draft, setDraft] = React.useState("");
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const commitTokens = (raw: string) => {
      const parts = raw
        .split(/[\s,，;；\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return false;
      const next = [...value];
      for (const token of parts) {
        if (next.includes(token)) continue;
        if (next.length >= maxTags) {
          onRejectTag?.(`最多添加 ${maxTags} 项`);
          break;
        }
        const err = validateTag?.(token);
        if (err) {
          onRejectTag?.(err);
          return false;
        }
        next.push(token);
      }
      onRejectTag?.("");
      onValueChange(next);
      return true;
    };

    const removeAt = (target: string) => {
      if (disabled) return;
      onValueChange(value.filter((item) => item !== target));
      innerRef.current?.focus();
    };

    return (
      <div
        data-slot="tag-input"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          innerRef.current?.focus();
        }}
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border-[0.5px] border-input bg-card px-2.5 py-1 text-sm transition-[border-color] duration-150 hover:border-[color:var(--foreground)]/30",
          "focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          disabled && "cursor-not-allowed bg-muted/60 opacity-75 hover:border-input",
          ariaProps["aria-invalid"] && "border-destructive focus-within:outline-destructive",
          className,
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center gap-1 rounded-md border-[0.5px] border-ring/40 bg-accent px-2 py-0.5 text-xs font-medium leading-[18px] text-accent-foreground"
          >
            <span className="truncate font-mono">{tag}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`移除 ${tag}`}
                onClick={() => removeAt(tag)}
                className="grid size-4 shrink-0 place-items-center rounded-sm text-accent-foreground/75 hover:bg-primary/15 hover:text-accent-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <input
          ref={setRefs}
          id={id}
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={value.length >= maxTags ? `已达上限 ${maxTags} 项` : placeholder}
          onChange={(e) => {
            onRejectTag?.("");
            setDraft(e.target.value);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[,，;；\n]/.test(pasted)) {
              e.preventDefault();
              if (commitTokens(pasted)) setDraft("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "，") {
              if (!draft.trim()) return;
              e.preventDefault();
              if (commitTokens(draft)) setDraft("");
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              e.preventDefault();
              onValueChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() && commitTokens(draft)) setDraft("");
          }}
          className="h-7 min-w-[120px] flex-1 border-0 bg-transparent px-0.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed"
          {...ariaProps}
        />
      </div>
    );
  },
);
TagInput.displayName = "TagInput";

export { TagInput };
