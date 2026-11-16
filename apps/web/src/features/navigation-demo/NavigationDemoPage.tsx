import { useEffect, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { RotateCw } from "lucide-react";
import { DataTable } from "@/components/table/DataTable";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { assetColumns } from "@/features/assets/columns";
import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";
import { request, type Asset } from "@/console-client";
import { ASSET_VIEWS, parseDemoSearch, type AssetView } from "./search";
import { APP_CONFIG } from "@/config/app-config";

const route = getRouteApi("/demo/navigation");

export function NavigationDemoPage() {
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();
  const [value, setValue] = useState<AssetView>(tab);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => setValue(tab), [tab]);
  useEffect(() => {
    const selected = list.current?.querySelector<HTMLElement>('[data-selected]');
    if (selected && list.current) {
      const viewport = list.current.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < viewport.left) list.current.scrollLeft -= viewport.left - item.left;
      if (item.right > viewport.right) list.current.scrollLeft += item.right - viewport.right;
    }
  }, [value]);

  return (
    <>
      <PageHeader title="资产视图" />
      <Tabs className="page-tabs" value={value} onValueChange={next => {
        if (!next) return;
        const view = parseDemoSearch({ tab: next }).tab;
        setValue(view);
        void navigate({ search: { tab: view }, replace: true });
      }}>
        <div className="page-tabs-scroll" ref={list}>
          <TabsList aria-label="资产视图">
            {ASSET_VIEWS.map(view => <TabsTab key={view.value} value={view.value}>{view.label}</TabsTab>)}
          </TabsList>
        </div>
        {ASSET_VIEWS.map(view => (
          <TabsPanel key={view.value} value={view.value}>
            <AssetViewTable view={view.value} />
          </TabsPanel>
        ))}
      </Tabs>
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

  return <ContentRefresh loading={query.isLoading || refreshing} layout="table" logoSrc={APP_CONFIG.logoSrc}>
    <DataTable data={query.data ?? []} columns={assetColumns} isLoading={query.isLoading} error={query.error?.message} toolbarEnd={
    <Button size="icon" variant="ghost" aria-label="刷新资产视图" title="刷新" onClick={async () => {
      setRefreshing(true);
      try { await query.refetch(); }
      finally { setRefreshing(false); }
    }}>
      <RotateCw size={15} />
    </Button>
  } />
  </ContentRefresh>;
}
