import * as React from "react";
import { Check, Copy, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { Button } from "@optimax-starter/ui/components/button";
import { toast } from "@optimax-starter/ui/components/toast";
import { cn } from "@optimax-starter/ui/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "group/input-group relative flex min-h-10 w-full min-w-0 items-stretch overflow-hidden rounded-md border-[0.5px] border-input bg-card text-sm text-foreground transition-[border-color,background-color] duration-150 hover:border-[color:var(--foreground)]/30",
        "focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        "has-[[data-slot=input-group-control]:read-only]:bg-[var(--surface-subtle)] has-[[data-slot=input-group-control]:read-only]:hover:border-input",
        "has-[[data-slot=input-group-control]:disabled]:cursor-not-allowed has-[[data-slot=input-group-control]:disabled]:bg-muted/60 has-[[data-slot=input-group-control]:disabled]:opacity-75 has-[[data-slot=input-group-control]:disabled]:hover:border-input",
        "has-[[data-slot=input-group-control][aria-invalid=true]]:border-destructive has-[[data-slot=input-group-control][aria-invalid=true]]:focus-within:outline-destructive",
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "flex shrink-0 select-none items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-3 pr-0",
        "inline-end": "order-last pr-2 pl-0",
        "block-start": "order-first w-full justify-start px-3 pt-2",
        "block-end": "order-last w-full justify-start px-3 pb-2",
      },
      surface: {
        plain: "",
        muted: "bg-[var(--surface-subtle)] px-2.5 text-muted-foreground",
      },
    },
    compoundVariants: [
      {
        align: "inline-start",
        surface: "muted",
        className: "border-r-[0.5px] border-border px-2.5",
      },
      {
        align: "inline-end",
        surface: "muted",
        className: "border-l-[0.5px] border-border px-2.5",
      },
    ],
    defaultVariants: {
      align: "inline-start",
      surface: "plain",
    },
  },
);

function InputGroupAddon({
  className,
  align = "inline-start",
  surface = "plain",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align, surface }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.parentElement
          ?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
          ?.focus();
      }}
      {...props}
    />
  );
}

const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input-group-control"
    className={cn(
      "h-10 min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none read-only:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
      className,
    )}
    {...props}
  />
));
InputGroupInput.displayName = "InputGroupInput";

const InputGroupTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="input-group-control"
    className={cn(
      "min-h-[84px] min-w-0 flex-1 resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-[22px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
InputGroupTextarea.displayName = "InputGroupTextarea";

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs leading-[18px] text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn("size-7 rounded-md text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  );
}

export interface ClearableInputProps extends React.ComponentProps<"input"> {
  startIcon?: React.ReactNode;
  prefixText?: string;
  suffixText?: string;
  onClear?: () => void;
  clearLabel?: string;
  containerClassName?: string;
}

const ClearableInput = React.forwardRef<HTMLInputElement, ClearableInputProps>(
  (
    {
      startIcon,
      prefixText,
      suffixText,
      onClear,
      clearLabel = "清空输入",
      containerClassName,
      className,
      value,
      onChange,
      disabled,
      readOnly,
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    const hasValue = typeof value === "string" ? value.length > 0 : Boolean(value);
    const showClear = hasValue && !disabled && !readOnly && Boolean(onClear || onChange);

    const handleClear = () => {
      if (onClear) {
        onClear();
      } else if (innerRef.current && onChange) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(innerRef.current, "");
        innerRef.current.dispatchEvent(new Event("input", { bubbles: true }));
      }
      innerRef.current?.focus();
    };

    return (
      <InputGroup className={containerClassName}>
        {prefixText && (
          <InputGroupAddon align="inline-start" surface="muted" className="font-mono text-xs">
            {prefixText}
          </InputGroupAddon>
        )}
        {!prefixText && startIcon && (
          <InputGroupAddon align="inline-start">{startIcon}</InputGroupAddon>
        )}
        <InputGroupInput
          ref={setRefs}
          value={value}
          onChange={onChange}
          disabled={disabled}
          readOnly={readOnly}
          className={cn(startIcon && !prefixText && "pl-2", showClear && "pr-1", className)}
          {...props}
        />
        {(showClear || suffixText) && (
          <InputGroupAddon
            align="inline-end"
            surface={suffixText && !showClear ? "muted" : "plain"}
            className={cn(suffixText && showClear && "gap-1 pr-2")}
          >
            {showClear && (
              <InputGroupButton aria-label={clearLabel} title={clearLabel} onClick={handleClear}>
                <X className="size-3.5" />
              </InputGroupButton>
            )}
            {suffixText && <span className="px-1 text-xs text-muted-foreground">{suffixText}</span>}
          </InputGroupAddon>
        )}
      </InputGroup>
    );
  },
);
ClearableInput.displayName = "ClearableInput";

export interface CopyableInputProps extends React.ComponentProps<"input"> {
  copyLabel?: string;
  silentToast?: boolean;
  startIcon?: React.ReactNode;
  containerClassName?: string;
}

const CopyableInput = React.forwardRef<HTMLInputElement, CopyableInputProps>(
  (
    {
      copyLabel = "复制内容",
      silentToast = false,
      startIcon,
      containerClassName,
      className,
      value,
      readOnly = true,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [copied, setCopied] = React.useState(false);
    const timerRef = React.useRef<number | null>(null);
    React.useEffect(
      () => () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      },
      [],
    );
    const text = typeof value === "string" ? value : String(value ?? "");
    const copy = async () => {
      if (!text || disabled) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (!silentToast) {
          toast.success("已复制到剪贴板", {
            id: "optimax-clipboard-copy",
            duration: 2400,
          });
        }
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1600);
      } catch {
        if (!silentToast) {
          toast.error("复制失败，请手动复制", {
            id: "optimax-clipboard-copy",
          });
        }
      }
    };
    return (
      <InputGroup className={containerClassName}>
        {startIcon && <InputGroupAddon align="inline-start">{startIcon}</InputGroupAddon>}
        <InputGroupInput
          ref={ref}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          className={cn("font-mono text-xs", startIcon && "pl-2", className)}
          {...props}
        />
        <InputGroupAddon align="inline-end" className="pr-1.5">
          <InputGroupButton
            aria-label={copied ? `已${copyLabel}` : copyLabel}
            title={copied ? "已复制" : copyLabel}
            disabled={disabled || !text}
            onClick={() => void copy()}
          >
            {copied ? (
              <Check className="size-3.5 text-primary" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  },
);
CopyableInput.displayName = "CopyableInput";

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
  ClearableInput,
  CopyableInput,
};
