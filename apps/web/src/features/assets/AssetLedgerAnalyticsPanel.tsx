import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BarList, type BarListItem } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { CategoryBar, type CategoryBarSegment } from "@/components/ui/category-bar";
import type { AssetLedgerSummary } from "@/console-client";
import { cn } from "@/lib/utils";

export interface AssetLedgerAnalyticsPanelProps {
  summary?: AssetLedgerSummary;
  isLoading?: boolean;
  activeStages: readonly string[];
  activeDomains: readonly string[];
  activeOwners: readonly string[];
  onToggleStage: (stage: string) => void;
  onToggleDomain: (domain: string) => void;
  onToggleOwner: (owner: string) => void;
}

export function AssetLedgerAnalyticsPanel({
  summary,
  isLoading,
  activeStages,
  activeDomains,
  activeOwners,
  onToggleStage,
  onToggleDomain,
  onToggleOwner,
}: AssetLedgerAnalyticsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const total = summary?.total ?? 0;
  const registered = summary?.registered ?? 0;
  const pending = summary?.pending ?? 0;
  const registeredPct = total > 0 ? Math.round((registered / total) * 100) : 0;

  const stageSegments: CategoryBarSegment[] = [
    { key: "已登记", label: "已登记", value: registered, tone: "brand" },
    { key: "待复核", label: "待复核", value: pending, tone: "warning" },
  ];

  const topDomains: BarListItem[] = (summary?.domainBreakdown ?? []).slice(0, 4).map((item) => ({
    key: item.name,
    label: item.name,
    value: item.total,
    valueLabel: `${item.total} 项 (已登记 ${item.registered})`,
    tone: activeDomains.includes(item.name) ? "brand" : "neutral",
  }));

  const sortedOwners = [...(summary?.ownerBreakdown ?? [])].sort(
    (a, b) => b.pending - a.pending || b.total - a.total || a.name.localeCompare(b.name, "zh-CN"),
  );
  const topOwners = sortedOwners.slice(0, 4);
  const hasAnyPending = topOwners.some((o) => o.pending > 0);
  const ownerItems: BarListItem[] = topOwners.map((item) => ({
    key: item.name,
    label: item.name,
    value: hasAnyPending ? item.pending : item.total,
    valueLabel: `待复核 ${item.pending} / 共 ${item.total}`,
    tone: activeOwners.includes(item.name) ? "brand" : item.pending > 0 ? "warning" : "neutral",
  }));

  const domainCeiling = Math.max(topDomains[0]?.value ?? 1, 1);
  const ownerCeiling = Math.max(...ownerItems.map((item) => item.value), 1);

  return (
    <section
      data-slot="asset-ledger-analytics"
      aria-label="资产台账可视化分析概览"
      className="rounded-xl border-[0.5px] border-border bg-card px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2 sm:items-center">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 className="m-0 shrink-0 text-sm font-semibold text-foreground">台账结构与风险概览</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {isLoading && !summary
              ? "正在统计…"
              : `当前范围 ${total.toLocaleString("zh-CN")} 项（已登记 ${registered}，待复核 ${pending}）`}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <>
              展开分析
              <ChevronDown size={14} aria-hidden="true" />
            </>
          ) : (
            <>
              收起分析
              <ChevronUp size={14} aria-hidden="true" />
            </>
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t-[0.5px] border-border pt-3 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col justify-between gap-2.5 rounded-lg border-[0.5px] border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">登记进度分布</span>
              <Badge variant={registeredPct >= 60 ? "brand" : "warning"}>
                已登记 {registeredPct}%
              </Badge>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl leading-tight font-semibold text-foreground tabular-nums">
                {total.toLocaleString("zh-CN")}
              </span>
              <span className="text-xs text-muted-foreground">项匹配资产</span>
            </div>
            <CategoryBar
              segments={stageSegments}
              renderLegendItem={(seg, content) => {
                const selected = activeStages.includes(seg.key);
                return (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToggleStage(seg.key)}
                    className={cn(
                      "rounded px-1 py-0.5 transition-colors hover:bg-muted",
                      selected && "bg-accent ring-1 ring-primary/40",
                    )}
                  >
                    {content}
                  </button>
                );
              }}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 rounded-lg border-[0.5px] border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">业务域分布（Top 4）</span>
              <span className="text-[11px] text-muted-foreground">点击筛选</span>
            </div>
            <BarList
              items={topDomains}
              maxValue={domainCeiling}
              emptyLabel="当前无匹配业务域"
              renderRow={(item, barContent) => {
                const selected = activeDomains.includes(item.key);
                return (
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`按业务域 ${item.label} 筛选`}
                    onClick={() => onToggleDomain(item.key)}
                    className={cn(
                      "flex w-full min-w-0 flex-1 rounded-md text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
                      selected && "ring-1 ring-primary/50",
                    )}
                  >
                    {barContent}
                  </button>
                );
              }}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 rounded-lg border-[0.5px] border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                责任团队待复核关注（Top 4）
              </span>
              <span className="text-[11px] text-muted-foreground">点击筛选</span>
            </div>
            <BarList
              items={ownerItems}
              maxValue={ownerCeiling}
              emptyLabel="当前无匹配团队"
              renderRow={(item, barContent) => {
                const selected = activeOwners.includes(item.key);
                return (
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`按责任团队 ${item.label} 筛选`}
                    onClick={() => onToggleOwner(item.key)}
                    className={cn(
                      "flex w-full min-w-0 flex-1 rounded-md text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
                      selected && "ring-1 ring-primary/50",
                    )}
                  >
                    {barContent}
                  </button>
                );
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
