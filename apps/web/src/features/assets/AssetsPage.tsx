import { getRouteApi } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { RotateCw } from "lucide-react";
import { useMemo } from "react";
import { DataTable } from "@/components/table/DataTable";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { asList, parseAssetSearch } from "@/features/filters/search";
import { useAccount } from "@/features/auth/session";
import { request, type Asset } from "@/console-client";

const columns: ColumnDef<Asset>[] = [
  {
    accessorKey: "id",
    header: "编号",
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        AS-{String(c.getValue()).padStart(3, "0")}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "资产名称",
    cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
  },
  { accessorKey: "domain", header: "业务域" },
  { accessorKey: "owner", header: "责任团队" },
  {
    accessorKey: "stage",
    header: "登记状态",
    cell: (c) => (
      <Badge variant={c.getValue() === "已登记" ? "brand" : "warning"}>
        {String(c.getValue())}
      </Badge>
    ),
  },
];
const PERSIST = ["stage", "domain"] as const;
const route = getRouteApi("/assets");
export function AssetsPage() {
  const me = useAccount();
  // The router can keep raw or invalid keys (objects, nested arrays) even after validateSearch, so parse again here.
  // Everything below (matching, persistence, FilterBar) only sees sanitized values.
  const params = parseAssetSearch(route.useSearch() as Record<string, unknown>),
    navigate = route.useNavigate();
  // Signature of the applied filters, used as the memo dependency so new array references never re-filter the table or reset paging.
  const filterKey = JSON.stringify([
    params.q ?? "",
    params.qOp ?? "contains",
    asList(params.stage),
    asList(params.domain),
  ]);
  const update = usePersistedFilters({
    scope: "assets",
    accountId: me.data?.id,
    values: params,
    persist: PERSIST,
    parse: parseAssetSearch,
    apply: (next) =>
      void navigate({ search: parseAssetSearch(next), replace: true }),
  });
  const query = useQuery({
    queryKey: ["assets"],
    queryFn: () => request<Asset[]>("/assets"),
  });
  const domains = useMemo(
    () =>
      [...new Set((query.data ?? []).map((r) => r.domain))].sort((a, b) =>
        a.localeCompare(b, "zh-CN"),
      ),
    [query.data],
  );
  const fields: FilterField[] = [
    {
      key: "q",
      label: "关键词",
      type: "text",
      ariaLabel: "搜索资产",
      placeholder: "搜索资产名称",
      operatorKey: "qOp",
    },
    {
      key: "stage",
      label: "登记状态",
      type: "select",
      multi: true,
      options: [
        { value: "已登记", label: "已登记" },
        { value: "待复核", label: "待复核" },
      ],
    },
    {
      key: "domain",
      label: "业务域",
      type: "select",
      multi: true,
      options: domains.map((d) => ({ value: d, label: d })),
    },
  ];
  // GET /console/assets returns every row; filtering happens here in the browser. Rows are combined with AND,
  // and values within one field with OR. A selected value missing from the data matches nothing.
  const rows = useMemo(() => {
    const [q, op, stages, picked] = JSON.parse(filterKey) as [
      string,
      string,
      string[],
      string[],
    ];
    const term = q.trim();
    return (
      query.data?.filter(
        (r) =>
          (!term || (op === "equals" ? r.name === term : r.name.includes(term))) &&
          (!stages.length || stages.includes(r.stage)) &&
          (!picked.length || picked.includes(r.domain)),
      ) ?? []
    );
  }, [query.data, filterKey]);
  return (
    <>
      <PageHeader title="资产台账" />
      <DataTable
        toolbar={
          <FilterBar
            fields={fields}
            values={params}
            onApply={update}
          />
        }
        toolbarEnd={
          <Button
            size="icon"
            className="h-9 w-9"
            title="刷新"
            variant="ghost"
            aria-label="刷新资产"
            onClick={() => query.refetch()}
          >
            <RotateCw size={15} />
          </Button>
        }
        data={rows}
        columns={columns}
        isLoading={query.isLoading}
        error={query.error?.message}
      />
    </>
  );
}
