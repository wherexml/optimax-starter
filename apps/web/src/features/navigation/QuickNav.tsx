import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@ui-sdk/react/command";
import { Hash, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getQuickNavEntries, type QuickNavEntry } from "@/config/app-config";
import type { Account } from "@/console-client";
import {
  type EntitySearchResult,
  hasEntitySearchProviders,
  searchConsoleEntities,
} from "./entity-search";

export function QuickNav({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | null | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Palette account={account} close={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Palette({ account, close }: { account: Account | null | undefined; close: () => void }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // 首次渲染时记录打开前的焦点（自动聚焦之前），关闭后归还。
  const [returnTo] = useState(() => document.activeElement);
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<EntitySearchResult[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  const navEntries = useMemo(() => getQuickNavEntries(account), [account]);
  const hasEntities = hasEntitySearchProviders();
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!hasEntities || !trimmedQuery) {
      setEntities([]);
      setLoadingEntities(false);
      return;
    }
    const controller = new AbortController();
    setLoadingEntities(true);
    const timer = window.setTimeout(() => {
      void searchConsoleEntities(trimmedQuery, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setEntities(rows);
            setLoadingEntities(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setEntities([]);
            setLoadingEntities(false);
          }
        });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasEntities, trimmedQuery]);

  function goNav(entry: QuickNavEntry) {
    close();
    if (entry.to !== path) {
      if (entry.defaultSearch) {
        void navigate({ to: entry.to, search: entry.defaultSearch as never });
      } else {
        void navigate({ to: entry.to });
      }
    }
  }

  function goEntity(entity: EntitySearchResult) {
    close();
    if (entity.search) {
      void navigate({ to: entity.to as never, search: entity.search as never });
    } else {
      void navigate({ to: entity.to as never });
    }
  }

  const showEntityGroup = hasEntities && Boolean(trimmedQuery) && entities.length > 0;

  const navItems = navEntries.map((entry) => {
    const Icon = entry.icon;
    return (
      <CommandItem
        key={entry.to}
        value={`nav:${entry.to}`}
        label={entry.label}
        keywords={entry.aliases}
        className="quick-nav-item"
      >
        <Icon size={16} aria-hidden="true" />
        <span>{entry.label}</span>
        {entry.to === path && <small>当前</small>}
      </CommandItem>
    );
  });

  return (
    <DialogContent
      size="sm"
      scrollable={false}
      aria-describedby={undefined}
      className="quick-nav gap-2 p-3"
      closeClassName="right-3 top-3 size-11"
      onCloseAutoFocus={(e) => {
        if (returnTo instanceof HTMLElement && returnTo.isConnected) {
          e.preventDefault();
          returnTo.focus();
        }
      }}
    >
      <DialogTitle className="sr-only">快速导航</DialogTitle>
      <Command
        loop
        autoHighlight
        filter="contains"
        query={query}
        onQueryChange={(next) => setQuery(next)}
        onAction={(actionValue) => {
          if (actionValue.startsWith("nav:")) {
            const to = actionValue.slice(4);
            const entry = navEntries.find((item) => item.to === to);
            if (entry) goNav(entry);
            return;
          }
          if (actionValue.startsWith("entity:")) {
            const id = actionValue.slice(7);
            const entity = entities.find((item) => item.id === id);
            if (entity) goEntity(entity);
          }
        }}
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden"
      >
        <label className="quick-nav-input">
          <Search size={16} aria-hidden="true" />
          <CommandInput
            autoFocus
            aria-label="搜索页面"
            placeholder={hasEntities ? "搜索页面或业务实体编码" : "搜索页面"}
          />
        </label>
        <CommandList aria-label="页面列表" className="quick-nav-list">
          <CommandEmpty className="quick-nav-empty">
            {loadingEntities ? "正在检索业务实体…" : "未找到匹配页面"}
          </CommandEmpty>
          {showEntityGroup ? (
            <CommandGroup>
              <CommandGroupLabel className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                控制台页面
              </CommandGroupLabel>
              {navItems}
            </CommandGroup>
          ) : (
            navItems
          )}
          {showEntityGroup ? (
            <>
              <CommandSeparator className="my-1 h-px bg-[var(--hairline)]" />
              <CommandGroup>
                <CommandGroupLabel className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  业务实体
                </CommandGroupLabel>
                {entities.map((entity) => (
                  <CommandItem
                    key={entity.id}
                    value={`entity:${entity.id}`}
                    label={`${entity.code} ${entity.title}`}
                    keywords={[entity.code, entity.title, entity.subtitle ?? "", trimmedQuery]}
                    className="quick-nav-item"
                  >
                    <Hash size={15} aria-hidden="true" />
                    <span className="flex min-w-0 items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                        {entity.code}
                      </code>
                      <span className="truncate">{entity.title}</span>
                    </span>
                    {entity.subtitle ? <small>{entity.subtitle}</small> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </DialogContent>
  );
}
