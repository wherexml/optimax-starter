export const ASSET_VIEWS = [
  { value: "all", label: "全部资产", stage: undefined },
  { value: "registered", label: "已登记", stage: "已登记" },
  { value: "pending", label: "待复核", stage: "待复核" },
] as const;

export type AssetView = (typeof ASSET_VIEWS)[number]["value"];

export function parseDemoSearch(search: Record<string, unknown>): { tab: AssetView } {
  return { tab: ASSET_VIEWS.find(view => view.value === search.tab)?.value ?? "all" };
}
