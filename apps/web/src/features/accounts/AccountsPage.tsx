import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, RotateCw } from "lucide-react";
import { useMemo, useState, useRef, type MouseEvent } from "react";
import { CreateAccountDialog } from "./CreateAccountDialog";
import { EditAccountDialog } from "./EditAccountDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/table/DataTable";
import { FilterBar, type FilterField } from "@/components/filters/FilterBar";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { parseAccountSearch } from "@/features/filters/search";
import { request, type Account } from "@/console-client";
import { useAccount } from "@/features/auth/session";

const route = getRouteApi("/accounts");
type Kind = "edit" | "password" | "revoke" | "disable";
type Pending = { kind: Kind; row: Account } | null;
const PERSIST = ["status", "role"] as const;
const FIELDS: FilterField[] = [
  {
    key: "q",
    label: "关键词",
    type: "text",
    ariaLabel: "搜索账户",
    placeholder: "搜索姓名或账户",
  },
  {
    key: "status",
    label: "账户状态",
    type: "select",
    options: [
      { value: "active", label: "已启用" },
      { value: "disabled", label: "已停用" },
    ],
  },
  {
    key: "role",
    label: "角色",
    type: "select",
    options: [
      { value: "admin", label: "管理员" },
      { value: "member", label: "成员" },
    ],
  },
];

export function AccountsPage() {
  const me = useAccount(),
    cache = useQueryClient(),
    admin = me.data?.role === "admin";
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const params = route.useSearch(),
    navigate = route.useNavigate(),
    search = params.q ?? "",
    status = params.status ?? "",
    role = params.role ?? "";
  const update = usePersistedFilters({
    scope: "accounts",
    accountId: admin ? me.data?.id : undefined,
    values: params,
    persist: PERSIST,
    parse: parseAccountSearch,
    apply: (next) =>
      void navigate({ search: parseAccountSearch(next), replace: true }),
  });
  const query = useQuery({
    queryKey: ["accounts"],
    queryFn: () => request<Account[]>("/accounts"),
    enabled: admin,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["accounts"] });
  const enable = useMutation({
    mutationFn: (row: Account) =>
      request("/accounts/" + row.id, "PATCH", { active: true }),
    onSuccess: async (_d, row) => {
      await refresh();
      setNotice(`已启用 ${row.name}`);
    },
  });
  function open(kind: Kind, row: Account, e: MouseEvent<HTMLElement>) {
    returnFocus.current = e.currentTarget;
    setNotice("");
    enable.reset();
    setPending({ kind, row });
  }
  async function finish(message?: string) {
    setPending(null);
    if (!message) return;
    await refresh();
    setNotice(message);
  }
  const columns: ColumnDef<Account>[] = [
    {
      accessorKey: "name",
      header: "姓名",
      cell: (c) => (
        <span className="font-medium">
          {String(c.getValue())}
          {c.row.original.id === me.data?.id && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              当前账户
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "username",
      header: "账户名",
      cell: (c) => (
        <span className="font-mono text-xs text-muted-foreground">
          {String(c.getValue())}
        </span>
      ),
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: (c) => (
        <Badge variant={c.getValue() === "admin" ? "brand" : "neutral"}>
          {c.getValue() === "admin" ? "管理员" : "成员"}
        </Badge>
      ),
    },
    {
      accessorKey: "active",
      header: "状态",
      cell: (c) => (
        <span className={c.getValue() ? "status-dot on" : "status-dot"}>
          {c.getValue() ? "已启用" : "已停用"}
        </span>
      ),
    },
    {
      accessorKey: "sessions",
      header: "在线会话",
      cell: (c) => <span className="tabular-nums">{Number(c.getValue() ?? 0)}</span>,
    },
    {
      id: "action",
      header: "操作",
      cell: (c) => {
        const row = c.row.original;
        const self = row.id === me.data?.id;
        return (
          <div className="row-actions">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`编辑 ${row.name}`}
              onClick={(e) => open("edit", row, e)}
            >
              编辑
            </Button>
            {!self && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`重置 ${row.name} 的密码`}
                  onClick={(e) => open("password", row, e)}
                >
                  重置密码
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`强制 ${row.name} 下线`}
                  disabled={!row.sessions}
                  onClick={(e) => open("revoke", row, e)}
                >
                  下线
                </Button>
                {row.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`停用 ${row.name}`}
                    onClick={(e) => open("disable", row, e)}
                  >
                    停用
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`启用 ${row.name}`}
                    disabled={enable.isPending}
                    onClick={() => {
                      setNotice("");
                      enable.mutate(row);
                    }}
                  >
                    启用
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];
  const rows = useMemo(
    () =>
      query.data?.filter(
        (r) =>
          [r.name, r.username].some((v) => v.includes(search.trim())) &&
          (!status || r.active === (status === "active")) &&
          (!role || r.role === role),
      ) ?? [],
    [query.data, search, status, role],
  );
  if (!admin)
    return (
      <>
        <PageHeader title="账户管理" />
        <p role="alert" className="text-muted-foreground">
          需要管理员权限
        </p>
      </>
    );
  const target = pending?.row;
  return (
    <>
      <PageHeader
        title="账户管理"
        actions={
          <Button
            ref={trigger}
            onClick={() => {
              setNotice("");
              setAdding(true);
            }}
          >
            <Plus size={16} />
            新增账户
          </Button>
        }
      />
      <p role="status" className={notice ? "notice" : "m-0"}>
        {notice}
      </p>
      {enable.error && (
        <p role="alert" className="mb-3 mt-0 text-sm text-destructive">
          {enable.error.message}
        </p>
      )}
      <DataTable
        toolbar={
          <FilterBar
            fields={FIELDS}
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
            aria-label="刷新账户"
            onClick={() => query.refetch()}
          >
            <RotateCw size={15} />
          </Button>
        }
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        error={query.error?.message}
      />
      {adding && (
        <CreateAccountDialog
          trigger={trigger.current}
          close={(createdName) => {
            setAdding(false);
            if (createdName) setNotice(`已创建账户 ${createdName}`);
          }}
        />
      )}
      {pending?.kind === "edit" && target && (
        <EditAccountDialog
          account={target}
          self={target.id === me.data?.id}
          trigger={returnFocus.current}
          close={(message) => void finish(message)}
        />
      )}
      {pending?.kind === "password" && target && (
        <ResetPasswordDialog
          account={target}
          trigger={returnFocus.current}
          close={(message) => void finish(message)}
        />
      )}
      {pending?.kind === "revoke" && target && (
        <ConfirmDialog
          title="强制下线"
          description={`将撤销 ${target.name} 的 ${target.sessions ?? 0} 个在线会话，对方需要重新登录。`}
          submitText="强制下线"
          trigger={returnFocus.current}
          action={() => request(`/accounts/${target.id}/revoke`, "POST", {})}
          close={(done) =>
            void finish(done ? `${target.name} 的会话已全部撤销` : undefined)
          }
        />
      )}
      {pending?.kind === "disable" && target && (
        <ConfirmDialog
          title="停用账户"
          description={`停用后 ${target.name} 无法登录，现有会话立即失效。可随时重新启用。`}
          submitText="停用账户"
          trigger={returnFocus.current}
          action={() =>
            request(`/accounts/${target.id}`, "PATCH", { active: false })
          }
          close={(done) => void finish(done ? `已停用 ${target.name}` : undefined)}
        />
      )}
    </>
  );
}
