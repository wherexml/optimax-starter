import { useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import { DataTable } from "@/components/table/DataTable";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs, PageTabsPanel } from "@/components/ui/page-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";
import { request, type Asset } from "@/console-client";
import { ASSET_VIEWS, parseDemoSearch, type AssetView } from "./search";

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

function AssetViewTable({ view }: { view: AssetView }) {
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ["navigation-demo-assets", view],
    queryFn: async () => {
      const assets = await request<Asset[]>("/assets");
      const stage = ASSET_VIEWS.find(item => item.value === view)?.stage;
      return stage ? assets.filter(asset => asset.stage === stage) : assets;
    },
  });

  return <ContentRefresh loading={query.isLoading || refreshing} immediate={refreshing} layout="table">
    <DataTable data={query.data ?? []} columns={demoColumns} isLoading={query.isLoading} error={query.error?.message} toolbarEnd={
    <Button type="button" size="icon" variant="ghost" aria-label="刷新资产视图" title="刷新" onClick={async () => {
      const startedAt = performance.now();
      setRefreshing(true);
      try {
        const res = await query.refetch();
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const remain = res.isError || reduced ? 0 : 260 - (performance.now() - startedAt);
        if (remain > 0) await new Promise<void>(resolve => { setTimeout(resolve, remain); });
      }
      finally { setRefreshing(false); }
    }}>
      <RotateCw size={15} />
    </Button>
  } />
  </ContentRefresh>;
}
