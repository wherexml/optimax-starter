import { Link } from "@tanstack/react-router";
import { AlertTriangle, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "请刷新页面或返回概览重试。";
  const cleaned = [...error.message]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "请刷新页面或返回概览重试。";
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}…` : cleaned;
}

export function NotFoundFallback() {
  return (
    <div className="mx-auto my-12 flex max-w-md flex-col items-center rounded-xl border-[0.5px] border-border bg-card p-8 text-center">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md border-[0.5px] border-border bg-[var(--surface-subtle)] text-muted-foreground">
        <Compass className="size-4" aria-hidden="true" />
      </div>
      <span className="font-mono text-xs font-medium text-muted-foreground">
        404
      </span>
      <h1 className="m-0 mt-1 text-lg font-semibold leading-7 text-foreground">
        页面不存在
      </h1>
      <p className="m-0 mt-2 text-sm leading-[22px] text-muted-foreground">
        访问的地址不存在或无对应页面，可返回概览继续操作。
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/">返回概览</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.history.back()}
        >
          返回上一页
        </Button>
      </div>
    </div>
  );
}

export function RouteErrorFallback({
  error,
  reset,
}: {
  error?: unknown;
  reset?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto my-12 flex max-w-md flex-col items-center rounded-xl border-[0.5px] border-border bg-card p-8 text-center"
    >
      <div className="mb-3 flex size-9 items-center justify-center rounded-md border-[0.5px] border-border bg-[var(--surface-subtle)] text-destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
      </div>
      <h1 className="m-0 text-lg font-semibold leading-7 text-foreground">
        页面加载异常
      </h1>
      <p className="m-0 mt-2 text-sm leading-[22px] text-muted-foreground">
        {safeErrorMessage(error)}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            if (reset) reset();
            else window.location.reload();
          }}
        >
          重试
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">返回概览</Link>
        </Button>
      </div>
    </div>
  );
}
