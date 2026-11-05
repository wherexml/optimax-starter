import type { ReactNode } from "react";

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex min-h-11 flex-wrap items-center justify-between gap-3">
      <h1 className="m-0 text-lg font-semibold leading-7 text-foreground">
        {title}
      </h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
