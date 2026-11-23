import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { DataTable } from "@/components/table/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, PageTabsPanel } from "@/components/ui/page-tabs";
import { type Asset, request } from "@/console-client";
import type { Filters } from "@/hooks/usePersistedFilters";
import { ASSET_VIEWS, type AssetView, parseDemoSearch } from "./search";

const route = getRouteApi("/demo/navigation");

// Local copy of the asset ledger columns so this demo does not depend on features/assets.
const demoColumns: ColumnDef<Asset>[] = [
  {
    id: "id",
    accessorKey: "id",
    header: "编号",
    enableSorting: true,
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        AS-{String(c.getValue()).padStart(3, "0")}
      </span>
    ),
  },
  {
    id: "name",
    accessorKey: "name",
    header: "资产名称",
    enableSorting: true,
    cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
  },
  { id: "domain", accessorKey: "domain", header: "业务域", enableSorting: true },
  { id: "owner", accessorKey: "owner", header: "责任团队", enableSorting: true },
  {
    id: "stage",
    accessorKey: "stage",
    header: "登记状态",
    enableSorting: true,
    cell: (c) => (
      <Badge variant={c.getValue() === "已登记" ? "brand" : "warning"}>
        {String(c.getValue())}
      </Badge>
    ),
  },
];

export function NavigationDemoPage() {
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();

  return (
    <>
      <PageHeader title="资产视图" />
      <PageTabs
        label="资产视图"
        items={ASSET_VIEWS}
        value={tab}
        onValueChange={(next) => {
          const view = parseDemoSearch({ tab: next }).tab;
          void navigate({ search: { tab: view }, replace: true });
        }}
      >
        {ASSET_VIEWS.map((view) => (
          <PageTabsPanel key={view.value} value={view.value}>
            <AssetViewTable view={view.value} />
          </PageTabsPanel>
        ))}
      </PageTabs>
    </>
  );
}

function toList(value: Filters[string]): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return typeof value === "string" && value ? [value] : [];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function formatAssetCode(id: number): string {
  return `AS-${String(id).padStart(3, "0")}`;
}

function filterDemoAssets(assets: readonly Asset[], filters: Filters): Asset[] {
  const code = typeof filters.code === "string" ? filters.code.trim().toLowerCase() : "";
  const codeExact = filters.codeOp === "equals";
  const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  const exact = filters.qOp === "equals";
  const stages = toList(filters.stage);
  const domains = toList(filters.domain);
  const owners = toList(filters.owner);
  return assets.filter((asset) => {
    if (code) {
      const formatted = formatAssetCode(asset.id).toLowerCase();
      if (
        codeExact ? !(formatted === code || String(asset.id) === code) : !formatted.includes(code)
      ) {
        return false;
      }
    }
    if (q) {
      const name = asset.name.toLowerCase();
      if (exact ? name !== q : !name.includes(q)) return false;
    }
    if (stages.length && !stages.includes(asset.stage)) return false;
    if (domains.length && !domains.includes(asset.domain)) return false;
    if (owners.length && !owners.includes(asset.owner)) return false;
    return true;
  });
}

function AssetViewTable({ view }: { view: AssetView }) {
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const query = useQuery({
    queryKey: ["navigation-demo-assets", view],
    queryFn: async () => {
      const assets = await request<Asset[]>("/assets");
      const stage = ASSET_VIEWS.find((item) => item.value === view)?.stage;
      return stage ? assets.filter((asset) => asset.stage === stage) : assets;
    },
  });

  const fields = useMemo<FilterField[]>(() => {
    const items = query.data ?? [];
    const domains = uniqueSorted(items.map((item) => item.domain));
    const owners = uniqueSorted(items.map((item) => item.owner));
    return [
      {
        key: "code",
        label: "编号",
        type: "text",
        ariaLabel: "搜索编号",
        placeholder: "搜索资产编号（如 AS-001）",
        operatorKey: "codeOp",
      },
      {
        key: "q",
        label: "资产名称",
        type: "text",
        ariaLabel: "搜索资产",
        placeholder: "搜索资产名称",
        operatorKey: "qOp",
      },
      {
        key: "domain",
        label: "业务域",
        type: "select",
        multi: true,
        options: domains.map((domain) => ({ value: domain, label: domain })),
      },
      {
        key: "owner",
        label: "责任团队",
        type: "select",
        multi: true,
        options: owners.map((owner) => ({ value: owner, label: owner })),
      },
      ...(view === "all"
        ? [
            {
              key: "stage",
              label: "登记状态",
              type: "select" as const,
              multi: true,
              options: [
                { value: "已登记", label: "已登记" },
                { value: "待复核", label: "待复核" },
              ],
            },
          ]
        : []),
    ];
  }, [query.data, view]);

  const filteredData = useMemo(
    () => filterDemoAssets(query.data ?? [], filters),
    [query.data, filters],
  );

  return (
    <ContentRefresh loading={query.isLoading || refreshing} immediate={refreshing} layout="table">
      <DataTable
        data={filteredData}
        columns={demoColumns}
        isLoading={query.isLoading}
        error={query.error?.message}
        toolbar={
          <FilterBar fields={fields} values={filters} onApply={setFilters} defaultKeys={["q"]} />
        }
        toolbarEnd={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="刷新资产视图"
            title="刷新"
            onClick={async () => {
              const startedAt = performance.now();
              setRefreshing(true);
              try {
                const res = await query.refetch();
                const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                const remain = res.isError || reduced ? 0 : 260 - (performance.now() - startedAt);
                if (remain > 0)
                  await new Promise<void>((resolve) => {
                    setTimeout(resolve, remain);
                  });
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RotateCw size={15} />
          </Button>
        }
      />
    </ContentRefresh>
  );
}
