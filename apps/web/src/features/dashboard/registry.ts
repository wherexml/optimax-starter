// 工作台业务模块注册表：由 `bootstrap --no-example` 与 `bun run gen:module` 自动维护。
// 下游项目可在此增删业务模块卡片或调整指标口径，无需修改上游同步的 `DashboardPage.tsx`：
// 1. 每个条目通过 `permissionCode` 自动按当前登录用户权限加载（无权用户零 403 请求）。
// 2. 通过 `fetchSummary()` 返回主 KPI 卡片、状态分段条（CategoryBar）、分类排行条（BarList）与可选待办队列。
// 3. 请保留 `@starter:dashboard-modules` 注释锚点，以便后续 `gen:module` 自动追加新模块。
import { Boxes, type LucideIcon } from "lucide-react";
import type { BarListItem } from "@optimax-starter/ui/components/bar-list";
import type { CategoryBarSegment } from "@optimax-starter/ui/components/category-bar";
import type { DataTone } from "@optimax-starter/ui/lib/data-tone";
import type { NavTarget } from "@/config/app-config";
// @starter:example-assets-start
import type { Asset } from "@/console-client";
// @starter:example-assets-end
import { request } from "@/console-client";
import {
  summarizeGeneratedRows,
  type GeneratedModuleFieldConfig,
} from "./dashboard-utils";

export interface DashboardStatBadgeLink {
  label: string;
  to: NavTarget;
  search?: Record<string, string>;
}

export interface DashboardQueueEntry {
  id: number | string;
  code: string;
  title: string;
  meta: string;
  to: NavTarget;
  search?: Record<string, string>;
}

export interface DashboardBreakdownEntry extends BarListItem {
  to?: NavTarget;
  search?: Record<string, string>;
  pendingCount?: number;
  pendingTo?: NavTarget;
  pendingSearch?: Record<string, string>;
}

export interface DashboardBreakdownDimension {
  key: string;
  label: string;
  items: readonly DashboardBreakdownEntry[];
}

export interface DashboardPreviewRow {
  id: number | string;
  code: string;
  title: string;
  group: string;
  owner: string;
  statusLabel: string;
  statusTone: DataTone;
  to: NavTarget;
  search?: Record<string, string>;
}

export interface DashboardModuleSummary {
  total: number;
  unit: string;
  primaryLabel: string;
  primaryBadge?: string;
  primaryTone?: DataTone;
  primaryLinks?: readonly DashboardStatBadgeLink[];
  completionRate?: number;
  completionLabel?: string;
  secondaryStat?: {
    label: string;
    value: number | string;
    unit?: string;
    tone?: DataTone;
    badge?: string;
    to: NavTarget;
    search?: Record<string, string>;
    links?: readonly DashboardStatBadgeLink[];
  };
  segmentsTitle?: string;
  segments: readonly (CategoryBarSegment & { to?: NavTarget; search?: Record<string, string> })[];
  breakdownTitle: string;
  breakdown: readonly DashboardBreakdownEntry[];
  dimensions?: readonly DashboardBreakdownDimension[];
  previewColumns?: {
    item: string;
    group: string;
    owner: string;
    status: string;
  };
  previewRows?: readonly DashboardPreviewRow[];
  queueTitle?: string;
  queueSearch?: Record<string, string>;
  queueItems?: readonly DashboardQueueEntry[];
  queueOverflowCount?: number;
  extraStats?: readonly {
    label: string;
    value: number | string;
    unit?: string;
    tone?: DataTone;
    to: NavTarget;
    search?: Record<string, string>;
    note?: string;
  }[];
}

export interface DashboardModuleSpec {
  id: string;
  label: string;
  to: NavTarget;
  permissionCode: string;
  icon: LucideIcon;
  fetchSummary: () => Promise<DashboardModuleSummary>;
}

// @starter:example-assets-start
function countBy(rows: Asset[], key: (row: Asset) => string) {
  const map = new Map<string, number>();
  for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

const assetsDashboardModule: DashboardModuleSpec = {
  id: "assets",
  label: "资产台账",
  to: "/assets",
  permissionCode: "assets:read",
  icon: Boxes,
  async fetchSummary() {
    const rows = await request<Asset[]>("/assets");
    const pending = rows.filter((r) => r.stage === "待复核");
    const registered = rows.length - pending.length;
    const share = rows.length ? Math.round((registered / rows.length) * 100) : 0;

    const domainRows = countBy(rows, (r) => r.domain).map(([domain, total]) => ({
      domain,
      total,
      pending: rows.filter((r) => r.domain === domain && r.stage === "待复核").length,
    }));
    domainRows.sort((a, b) => b.pending - a.pending || b.total - a.total);

    const ownerRows = countBy(rows, (r) => r.owner).map(([owner, total]) => ({
      owner,
      total,
      pending: rows.filter((r) => r.owner === owner && r.stage === "待复核").length,
    }));
    ownerRows.sort((a, b) => b.pending - a.pending || b.total - a.total);

    const orderedPreviewSource = [
      ...pending,
      ...rows.filter((r) => r.stage !== "待复核"),
    ];

    return {
      total: rows.length,
      unit: "项",
      primaryLabel: "资产总数",
      primaryBadge: rows.length ? `已登记 ${share}%` : undefined,
      primaryTone: "brand",
      completionRate: share,
      completionLabel: "登记完成率",
      primaryLinks: [
        { label: `已登记 ${registered}`, to: "/assets", search: { stage: "已登记" } },
        { label: `待复核 ${pending.length}`, to: "/assets", search: { stage: "待复核" } },
      ],
      secondaryStat: {
        label: "待复核资产",
        value: pending.length,
        unit: "项",
        tone: pending.length > 0 ? "warning" : "success",
        to: "/assets",
        search: { stage: "待复核" },
        links: countBy(pending, (r) => r.domain)
          .slice(0, 3)
          .map(([domain, n]) => ({
            label: `${domain} ${n}`,
            to: "/assets",
            search: { stage: "待复核", domain },
          })),
      },
      segmentsTitle: "登记状态",
      segments: [
        {
          key: "registered",
          label: "已登记",
          value: registered,
          tone: "brand",
          to: "/assets",
          search: { stage: "已登记" },
        },
        {
          key: "pending",
          label: "待复核",
          value: pending.length,
          tone: "warning",
          to: "/assets",
          search: { stage: "待复核" },
        },
      ],
      breakdownTitle: "业务域分布",
      breakdown: domainRows.map((d) => ({
        key: d.domain,
        label: d.domain,
        value: d.total,
        tone: "brand",
        to: "/assets",
        search: { domain: d.domain },
        pendingCount: d.pending,
        pendingTo: "/assets",
        pendingSearch: { domain: d.domain, stage: "待复核" },
      })),
      dimensions: [
        {
          key: "domain",
          label: "按业务域",
          items: domainRows.map((d) => ({
            key: d.domain,
            label: d.domain,
            value: d.total,
            tone: "brand",
            to: "/assets",
            search: { domain: d.domain },
            pendingCount: d.pending,
            pendingTo: "/assets",
            pendingSearch: { domain: d.domain, stage: "待复核" },
          })),
        },
        {
          key: "owner",
          label: "按责任团队",
          items: ownerRows.slice(0, 6).map((o) => ({
            key: o.owner,
            label: o.owner,
            value: o.total,
            tone: "brand",
            to: "/assets",
            search: { q: o.owner },
            pendingCount: o.pending,
            pendingTo: "/assets",
            pendingSearch: { q: o.owner, stage: "待复核" },
          })),
        },
      ],
      previewColumns: {
        item: "资产名称",
        group: "业务域",
        owner: "责任团队",
        status: "状态",
      },
      previewRows: orderedPreviewSource.slice(0, 5).map((r) => ({
        id: r.id,
        code: `AS-${String(r.id).padStart(3, "0")}`,
        title: r.name,
        group: r.domain,
        owner: r.owner,
        statusLabel: r.stage,
        statusTone: r.stage === "待复核" ? "warning" : "success",
        to: "/assets",
        search: { q: r.name },
      })),
      queueTitle: "待复核资产",
      queueSearch: { stage: "待复核" },
      queueItems: pending.slice(0, 6).map((r) => ({
        id: r.id,
        code: `AS-${String(r.id).padStart(3, "0")}`,
        title: r.name,
        meta: `${r.domain} / ${r.owner}`,
        to: "/assets",
        search: { q: r.name, stage: "待复核" },
      })),
      queueOverflowCount: Math.max(0, pending.length - 6),
      extraStats: [
        {
          label: "已登记资产",
          value: registered,
          unit: "项",
          tone: "success",
          to: "/assets",
          search: { stage: "已登记" },
          note: `占全部 ${share}%`,
        },
        {
          label: "业务域",
          value: domainRows.length,
          unit: "个",
          tone: "brand",
          to: "/assets",
          note: domainRows
            .slice(0, 2)
            .map((d) => `${d.domain} ${d.total}`)
            .join(" / "),
        },
      ],
    };
  },
};
// @starter:example-assets-end

export function createGeneratedModuleSpec(options: {
  id: string;
  label: string;
  to: NavTarget;
  permissionCode: string;
  primaryEnumField?: GeneratedModuleFieldConfig | null;
  categoryField?: GeneratedModuleFieldConfig | null;
  ownerField?: GeneratedModuleFieldConfig | null;
  booleanField?: GeneratedModuleFieldConfig | null;
}): DashboardModuleSpec {
  return {
    id: options.id,
    label: options.label,
    to: options.to,
    permissionCode: options.permissionCode,
    icon: Boxes,
    async fetchSummary() {
      const page = await request<{ items: Record<string, unknown>[]; total: number }>(
        `/${options.id}?page=1&size=50`,
      );
      const summary = summarizeGeneratedRows(page.items, page.total, options);
      const enumName = options.primaryEnumField?.name;
      return {
        total: summary.total,
        unit: "条",
        primaryLabel: options.label,
        primaryBadge:
          summary.total > summary.sampled && summary.sampled > 0
            ? `抽样前 ${summary.sampled} 条`
            : undefined,
        primaryTone: "brand",
        primaryLinks: summary.segments.slice(0, 3).map((seg) => ({
          label: `${seg.label} ${seg.value}`,
          to: options.to,
          search: enumName && seg.key !== "yes" && seg.key !== "no" ? { [enumName]: seg.label } : undefined,
        })),
        secondaryStat:
          summary.secondaryLabel && summary.secondaryValue !== undefined
            ? {
                label: summary.secondaryLabel,
                value: summary.secondaryValue,
                unit: "条",
                tone: /待|观察|异常/.test(summary.secondaryLabel) ? "warning" : "success",
                to: options.to,
                search: summary.secondarySearch,
              }
            : undefined,
        segmentsTitle: summary.segmentsTitle,
        segments: summary.segments.map((seg) => ({
          ...seg,
          to: options.to,
          search: enumName && seg.key !== "yes" && seg.key !== "no" ? { [enumName]: seg.label } : undefined,
        })),
        breakdownTitle: summary.breakdownTitle,
        breakdown: summary.breakdown.map((row) => ({
          ...row,
          to: options.to,
          search: row.filterParam,
        })),
        dimensions: summary.dimensions?.map((dim) => ({
          key: dim.key,
          label: dim.label,
          items: dim.items.map((row) => ({
            ...row,
            to: options.to,
            search: row.filterParam,
          })),
        })),
        previewColumns: {
          item: "名称",
          group: options.categoryField?.label ?? "分类",
          owner: options.ownerField?.label ?? "负责人",
          status: options.primaryEnumField?.label ?? options.booleanField?.label ?? "状态",
        },
        previewRows: summary.previewRows?.map((row) => ({
          id: row.id,
          code: `#${row.id}`,
          title: row.title,
          group: row.group,
          owner: row.owner,
          statusLabel: row.statusLabel,
          statusTone: row.statusTone,
          to: options.to,
          search: row.search,
        })),
        extraStats: summary.segments.slice(0, 2).map((seg) => ({
          label: seg.label,
          value: seg.value,
          unit: "条",
          tone: seg.tone ?? "brand",
          to: options.to,
          search: enumName && seg.key !== "yes" && seg.key !== "no" ? { [enumName]: seg.label } : undefined,
        })),
      };
    },
  };
}

export const DASHBOARD_MODULES: readonly DashboardModuleSpec[] = [
  // @starter:example-assets-start
  assetsDashboardModule,
  // @starter:example-assets-end
  // @starter:dashboard-modules
];
