import * as React from "react";
import type { ChangeDetails } from "@ui-sdk/core";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  type TabsValueChangeReason,
} from "@ui-sdk/react/tabs";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface PageTabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface PageTabsProps<T extends string = string> {
  label: string;
  items?: readonly PageTabItem<T>[];
  value: T;
  onValueChange?: (
    value: T,
    details: ChangeDetails<TabsValueChangeReason>,
  ) => void;
  hideSingleTab?: boolean;
  className?: string;
  listClassName?: string;
  children?: React.ReactNode;
}

interface PageTabsContextValue {
  singleTabValue: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const PageTabsContext = React.createContext<PageTabsContextValue | null>(null);

export function PageTabs<T extends string = string>({
  label,
  items,
  value,
  onValueChange,
  hideSingleTab = false,
  className,
  listClassName,
  children,
}: PageTabsProps<T>) {
  const [localValue, setLocalValue] = React.useState<T>(value);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const singleTabValue =
    hideSingleTab && items && items.length <= 1
      ? (items[0]?.value ?? localValue)
      : null;

  React.useEffect(() => {
    if (singleTabValue !== null) return;
    const container = scrollRef.current;
    const selected = container?.querySelector<HTMLElement>("[data-selected]");
    if (!container || !selected) return;
    const viewport = container.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.left < viewport.left) {
      container.scrollLeft -= viewport.left - item.left;
    } else if (item.right > viewport.right) {
      container.scrollLeft += item.right - viewport.right;
    }
  }, [localValue, items, singleTabValue]);

  const ctxValue = React.useMemo<PageTabsContextValue>(
    () => ({ singleTabValue, scrollRef }),
    [singleTabValue],
  );

  if (singleTabValue !== null) {
    return (
      <PageTabsContext.Provider value={ctxValue}>
        {children}
      </PageTabsContext.Provider>
    );
  }

  return (
    <PageTabsContext.Provider value={ctxValue}>
      <Tabs
        className={cn("page-tabs", className)}
        value={localValue}
        onValueChange={(next, details) => {
          if (!next) return;
          onValueChange?.(next, details);
          if (!details.canceled) {
            setLocalValue(next);
          }
        }}
      >
        {items ? (
          <PageTabsList label={label} className={listClassName}>
            {items.map((item) => (
              <PageTabsTab
                key={item.value}
                value={item.value}
                disabled={item.disabled}
              >
                {item.label}
              </PageTabsTab>
            ))}
          </PageTabsList>
        ) : null}
        {children}
      </Tabs>
    </PageTabsContext.Provider>
  );
}

export interface PageTabsListProps {
  label: string;
  className?: string;
  children?: React.ReactNode;
}

export function PageTabsList({
  label,
  className,
  children,
}: PageTabsListProps) {
  const ctx = React.useContext(PageTabsContext);
  return (
    <div className="page-tabs-scroll" ref={ctx?.scrollRef}>
      <TabsList aria-label={label} className={className}>
        {children}
      </TabsList>
    </div>
  );
}

export interface PageTabsTabProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function PageTabsTab({
  value,
  disabled,
  className,
  children,
}: PageTabsTabProps) {
  return (
    <TabsTab value={value} disabled={disabled} className={className}>
      {children}
    </TabsTab>
  );
}

export interface PageTabsPanelProps {
  value: string;
  keepMounted?: boolean;
  hiddenUntilFound?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function PageTabsPanel({
  value,
  keepMounted,
  hiddenUntilFound,
  className,
  children,
}: PageTabsPanelProps) {
  const ctx = React.useContext(PageTabsContext);
  if (ctx?.singleTabValue !== null && ctx?.singleTabValue !== undefined) {
    if (ctx.singleTabValue !== value) return null;
    return <div className={cn("min-w-0", className)}>{children}</div>;
  }
  return (
    <TabsPanel
      value={value}
      keepMounted={keepMounted}
      hiddenUntilFound={hiddenUntilFound}
      className={className}
    >
      {children}
    </TabsPanel>
  );
}
