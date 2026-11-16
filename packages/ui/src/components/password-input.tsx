import * as React from "react";
import { Eye, EyeOff, WandSparkles } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@optimax-starter/ui/components/input-group";
import { cn } from "@optimax-starter/ui/lib/utils";

const CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_";

export function generateSecurePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
}

export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  toggleLabel?: string;
  onGenerate?: (value: string) => void;
  generateLength?: number;
  generateLabel?: string;
  containerClassName?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      toggleLabel = "密码",
      onGenerate,
      generateLength = 16,
      generateLabel = "随机生成",
      containerClassName,
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    const [visible, setVisible] = React.useState(false);
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const handleGenerate = () => {
      if (!onGenerate || disabled) return;
      const next = generateSecurePassword(generateLength);
      onGenerate(next);
      setVisible(true);
      innerRef.current?.focus();
    };

    return (
      <InputGroup className={containerClassName}>
        <InputGroupInput
          ref={setRefs}
          type={visible ? "text" : "password"}
          disabled={disabled}
          className={cn("pr-1", visible && "font-mono text-xs", className)}
          {...props}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5 pr-1.5">
          {onGenerate && (
            <InputGroupButton
              size="xs"
              disabled={disabled}
              aria-label={`${generateLabel}${toggleLabel}`}
              title={`${generateLabel}（${generateLength} 位）`}
              className="h-7 w-auto px-2 text-xs text-muted-foreground hover:text-primary"
              onClick={handleGenerate}
            >
              <WandSparkles className="size-3.5" />
              <span>生成</span>
            </InputGroupButton>
          )}
          <InputGroupButton
            disabled={disabled}
            aria-label={`${visible ? "隐藏" : "显示"}${toggleLabel}`}
            aria-pressed={visible}
            title={`${visible ? "隐藏" : "显示"}${toggleLabel}`}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
