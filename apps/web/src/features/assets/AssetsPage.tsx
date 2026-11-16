import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { Button } from "@/components/ui/button";
import { storageKey } from "@/config/app-config";
import { request, type Asset } from "@/console-client";
import { useAccount } from "@/features/auth/session";
import { asList, parseAssetSearch } from "@/features/filters/search";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { AssetAgent, type FilterDraft } from "./AssetAgent";
import { AssetFormDialog } from "./AssetFormDialog";
import { assetColumns } from "./columns";

const PERSIST = ["q", "qOp", "stage", "domain"] as const;
const route = getRouteApi("/assets");

type PendingAction =
  | { kind: "create" }
  | { kind: "edit"; row: Asset }
  | { kind: "delete"; row: Asset }
  | null;

export function AssetsPage() {
  const [draft, setDraft] = useState<FilterDraft>({ dirty: false, signature: "" });
  const onDraftChange = useCallback((dirty: boolean, signature: string) => {
    setDraft((previous) =>
      previous.dirty === dirty && previous.signature === signature
        ? previous
        : { dirty, signature },
    );
  }, []);
  const me = useAccount();
  const cache = useQueryClient();
  const admin = me.data?.role === "admin";
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState("");
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // The router can keep raw or invalid keys (objects, nested arrays) even after validateSearch, so parse again here.
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
    apply: (next) => navigate({ search: parseAssetSearch(next), replace: true }),
  });

  const query = useQuery({
    meta: { contentRefresh: true },
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

  // GET /console/assets returns every row; filtering happens here in the browser.
  // For large datasets, switch to GET /console/assets/page (see modules/assets.ts).
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

  const openRowAction = useCallback(
    (kind: "edit" | "delete", row: Asset, e: MouseEvent<HTMLElement>) => {
      returnFocus.current = e.currentTarget;
      setNotice("");
      setPending({ kind, row });
    },
    [],
  );

  const columns = useMemo<ColumnDef<Asset>[]>(() => {
    if (!admin) return assetColumns;
    return [
      ...assetColumns,
      {
        id: "action",
        header: "操作",
        enableSorting: false,
        cell: (c) => {
          const row = c.row.original;
          return (
            <div className="row-actions">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`编辑资产 ${row.name}`}
                onClick={(e) => openRowAction("edit", row, e)}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                aria-label={`删除资产 ${row.name}`}
                onClick={(e) => openRowAction("delete", row, e)}
              >
                删除
              </Button>
            </div>
          );
        },
      },
    ];
  }, [admin, openRowAction]);

  return (
    <ResourceTableSlot
      title="资产台账"
      actions={
        admin ? (
          <Button
            ref={createTrigger}
            onClick={() => {
              returnFocus.current = createTrigger.current;
              setNotice("");
              setPending({ kind: "create" });
            }}
          >
            <Plus size={16} />
            新增资产
          </Button>
        ) : undefined
      }
      notice={notice}
      fields={fields}
      filters={params}
      onApplyFilters={update}
      onDraftChange={onDraftChange}
      draftStorageKey={
        me.data ? `${storageKey("filter-drafts.v1")}:${me.data.id}:assets` : undefined
      }
      columns={columns}
      data={rows}
      isLoading={query.isLoading}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新资产"
      wrapTable={(table) => (
        <AssetAgent
          filters={params}
          domains={domains}
          matched={rows.length}
          ready={!query.isFetching && !query.isError && Boolean(me.data)}
          draft={draft}
          apply={update}
        >
          {table}
        </AssetAgent>
      )}
    >
      {pending?.kind === "create" && (
        <AssetFormDialog
          trigger={returnFocus.current}
          close={(msg) => {
            setPending(null);
            if (msg) setNotice(msg);
          }}
        />
      )}
      {pending?.kind === "edit" && (
        <AssetFormDialog
          asset={pending.row}
          trigger={returnFocus.current}
          close={(msg) => {
            setPending(null);
            if (msg) setNotice(msg);
          }}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="删除资产"
          description={`将从台账中删除「${pending.row.name}」，并写入操作日志。`}
          submitText="删除资产"
          trigger={returnFocus.current}
          action={() => request(`/assets/${pending.row.id}`, "DELETE", {})}
          close={async (done) => {
            const name = pending.row.name;
            setPending(null);
            if (done) {
              await cache.invalidateQueries({ queryKey: ["assets"] });
              setNotice(`已删除资产 ${name}`);
            }
          }}
        />
      )}
    </ResourceTableSlot>
  );
}
