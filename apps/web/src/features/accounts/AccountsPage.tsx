import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { TableExportMenu } from "@/components/table/TableExportMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailDrawer, DetailField, DetailSection } from "@/components/ui/detail-drawer";
import { toast } from "@/components/ui/toast";
import { storageKey } from "@/config/app-config";
import { type Account, type AccountInviteLink, request } from "@/console-client";
import { getRoleLabel, hasPermission, useAccount } from "@/features/auth/session";
import { parseAccountSearch } from "@/features/filters/search";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { downloadCsv } from "@/lib/csv";
import { CreateAccountDialog } from "./CreateAccountDialog";
import { EditAccountDialog } from "./EditAccountDialog";
import { InviteLinkDialog, type InviteLinkResult } from "./InviteLinkDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

const route = getRouteApi("/accounts");
type Kind = "detail" | "edit" | "password" | "invite" | "revoke" | "disable";
type Pending = { kind: Kind; row: Account } | null;
const PERSIST = ["status", "role"] as const;
const FIELDS: FilterField[] = [
  {
    key: "q",
    label: "姓名",
    type: "text",
    ariaLabel: "搜索姓名",
    placeholder: "搜索姓名",
  },
  {
    key: "username",
    label: "账户名",
    type: "text",
    ariaLabel: "搜索账户名",
    placeholder: "搜索账户名",
  },
  {
    key: "role",
    label: "角色",
    type: "select",
    options: [
      { value: "super_admin", label: "超级管理员" },
      { value: "admin", label: "管理员" },
      { value: "member", label: "成员" },
    ],
  },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: [
      { value: "active", label: "已启用" },
      { value: "disabled", label: "已停用" },
    ],
  },
];

function roleBadgeVariant(role: string): "brand" | "outline" | "neutral" {
  if (role === "super_admin") return "brand";
  if (role === "admin") return "outline";
  return "neutral";
}

export function AccountsPage() {
  const me = useAccount(),
    cache = useQueryClient(),
    canRead = hasPermission(me.data, "accounts:read"),
    canManage = hasPermission(me.data, "accounts:manage"),
    isSuperAdmin = me.data?.role === "super_admin";
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  // One-time activation link shown right after generation (never re-fetchable).
  const [inviteLink, setInviteLink] = useState<InviteLinkResult | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnToDetailRef = useRef<number | null>(null);
  const inviteReturnDetailRef = useRef<number | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const params = route.useSearch(),
    navigate = route.useNavigate(),
    search = params.q ?? "",
    username = params.username ?? "",
    status = params.status ?? "",
    role = params.role ?? "";
  const update = usePersistedFilters({
    scope: "accounts",
    accountId: canRead ? me.data?.id : undefined,
    values: params,
    persist: PERSIST,
    parse: parseAccountSearch,
    apply: (next) => void navigate({ search: parseAccountSearch(next), replace: true }),
  });
  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["accounts"],
    queryFn: () => request<Account[]>("/accounts"),
    enabled: Boolean(me.data) && canRead,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: ["accounts"] });
  const enable = useMutation({
    mutationFn: (row: Account) => request("/accounts/" + row.id, "PATCH", { active: true }),
    onSuccess: async (_d, row) => {
      await refresh();
      toast.success(`已启用 ${row.name}`);
    },
    onError: (err) => {
      toast.error("启用账户失败", { description: err.message });
    },
  });
  const resetEnable = enable.reset;
  const open = useCallback(
    (kind: Kind, row: Account, e?: MouseEvent<HTMLElement>) => {
      returnToDetailRef.current = null;
      returnFocus.current = e?.currentTarget ?? null;
      resetEnable();
      setPending({ kind, row });
    },
    [resetEnable],
  );
  const openFromDetail = useCallback(
    (kind: Exclude<Kind, "detail">, row: Account) => {
      returnToDetailRef.current = row.id;
      resetEnable();
      setPending({ kind, row });
    },
    [resetEnable],
  );
  const matchesFilters = useCallback(
    (r: Account) => {
      const nameNeedle = search.trim().toLowerCase();
      const userNeedle = username.trim().toLowerCase();
      return (
        (!nameNeedle || r.name.toLowerCase().includes(nameNeedle)) &&
        (!userNeedle || r.username.toLowerCase().includes(userNeedle)) &&
        (!status || r.active === (status === "active")) &&
        (!role || r.role === role)
      );
    },
    [search, username, status, role],
  );
  async function finish(message?: string, description?: string) {
    const backId = returnToDetailRef.current;
    returnToDetailRef.current = null;
    if (!message) {
      if (backId !== null) {
        const latest =
          cache.getQueryData<Account[]>(["accounts"])?.find((r) => r.id === backId) ??
          query.data?.find((r) => r.id === backId);
        if (latest) {
          setPending({ kind: "detail", row: latest });
          return;
        }
      }
      setPending(null);
      return;
    }
    setPending(null);
    await refresh();
    toast.success(message, description ? { description } : undefined);
    if (backId !== null) {
      const updated = cache.getQueryData<Account[]>(["accounts"])?.find((r) => r.id === backId);
      if (updated) setPending({ kind: "detail", row: updated });
    }
  }
  const activeSuperAdminCount = useMemo(
    () => (query.data ?? []).filter((r) => r.role === "super_admin" && r.active).length,
    [query.data],
  );
  const columns = useMemo<ColumnDef<Account>[]>(() => {
    const base: ColumnDef<Account>[] = [
      {
        accessorKey: "name",
        header: "姓名",
        cell: (c) => (
          <span className="font-medium">
            {String(c.getValue())}
            {c.row.original.id === me.data?.id && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">当前账户</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "username",
        header: "账户名",
        cell: (c) => (
          <span className="font-mono text-xs text-muted-foreground">{String(c.getValue())}</span>
        ),
      },
      {
        accessorKey: "role",
        header: "角色",
        cell: (c) => {
          const val = String(c.getValue());
          return <Badge variant={roleBadgeVariant(val)}>{getRoleLabel(val)}</Badge>;
        },
      },
      {
        accessorKey: "active",
        header: "状态",
        cell: (c) => (
          <Badge variant={c.getValue() ? "success" : "neutral"}>
            {c.getValue() ? "已启用" : "已停用"}
          </Badge>
        ),
      },
      {
        accessorKey: "sessions",
        header: "在线会话",
        cell: (c) => <span className="tabular-nums">{Number(c.getValue() ?? 0)}</span>,
      },
    ];
    const detailButton = (row: Account) => (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`查看账户 ${row.name} 详情`}
        onClick={(e) => open("detail", row, e)}
      >
        详情
      </Button>
    );
    return [
      ...base,
      {
        id: "action",
        header: "操作",
        enableSorting: false,
        cell: (c) => {
          const row = c.row.original;
          if (!canManage) {
            return <div className="row-actions">{detailButton(row)}</div>;
          }
          const self = row.id === me.data?.id;
          const protectedPeer = !self && !isSuperAdmin && row.role !== "member";
          if (protectedPeer) {
            return (
              <div className="row-actions">
                {detailButton(row)}
                <span className="text-xs text-muted-foreground">仅超管可维护</span>
              </div>
            );
          }
          const isLastSuperAdmin =
            row.role === "super_admin" && row.active && activeSuperAdminCount <= 1;
          return (
            <div className="row-actions">
              {detailButton(row)}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`编辑 ${row.name}`}
                onClick={(e) => open("edit", row, e)}
              >
                编辑
              </Button>
              {!self &&
                (row.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`停用 ${row.name}`}
                    disabled={isLastSuperAdmin}
                    title={isLastSuperAdmin ? "至少保留一名启用的超级管理员" : undefined}
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
                    onClick={() => enable.mutate(row)}
                  >
                    启用
                  </Button>
                ))}
            </div>
          );
        },
      },
    ];
  }, [activeSuperAdminCount, canManage, enable, isSuperAdmin, me.data?.id, open]);

  const rows = useMemo(() => {
    const filtered = query.data?.filter(matchesFilters) ?? [];
    if (!recentIds.length) return filtered;
    // Newly created accounts stay pinned at the top (most recent first) for this page visit.
    const rank = new Map(recentIds.map((id, index) => [id, index]));
    return [...filtered].sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return 0;
    });
  }, [query.data, matchesFilters, recentIds]);
  const target = useMemo(() => {
    if (!pending) return undefined;
    return (
      rows.find((r) => r.id === pending.row.id) ??
      query.data?.find((r) => r.id === pending.row.id) ??
      pending.row
    );
  }, [pending, rows, query.data]);
  const detailIndex =
    pending?.kind === "detail" && target ? rows.findIndex((r) => r.id === target.id) : -1;
  const targetSelf = Boolean(target && target.id === me.data?.id);
  const targetProtectedPeer = Boolean(target && !targetSelf && !isSuperAdmin && target.role !== "member");
  const targetIsLastSuperAdmin = Boolean(
    target && target.role === "super_admin" && target.active && activeSuperAdminCount <= 1,
  );
  return (
    <ResourceTableSlot
      title="账户管理"
      allowed={canRead}
      actions={
        canManage ? (
          <Button ref={trigger} size="sm" onClick={() => setAdding(true)}>
            <Plus size={15} />
            新增账户
          </Button>
        ) : undefined
      }
      fields={FIELDS}
      filters={params}
      onApplyFilters={update}
      draftStorageKey={
        me.data ? `${storageKey("filter-drafts.v1")}:${me.data.id}:accounts` : undefined
      }
      columns={columns}
      data={rows}
      defaultPageSize={20}
      pageSizes={[20, 50, 100]}
      isLoading={query.isLoading}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新账户"
      onRowClick={(row) => open("detail", row)}
      toolbarEnd={
        <TableExportMenu
          disabled={!rows.length}
          items={[
            {
              label: "导出筛选结果 CSV",
              disabled: !rows.length,
              onSelect: () => {
                // Non-secret fields only: no passwords, session tokens or permission lists.
                const count = downloadCsv("账户列表.csv", rows, [
                  { header: "姓名", value: (r) => r.name },
                  { header: "账户名", value: (r) => r.username },
                  { header: "角色", value: (r) => getRoleLabel(r.role) },
                  { header: "状态", value: (r) => (r.active ? "已启用" : "已停用") },
                  { header: "邮箱", value: (r) => r.email ?? "" },
                  { header: "公司或团队", value: (r) => r.company ?? "" },
                  { header: "在线会话", value: (r) => r.sessions ?? 0 },
                ]);
                toast.success(`已导出 ${count} 条账户记录`);
              },
            },
          ]}
        />
      }
    >
      {adding && (
        <CreateAccountDialog
          trigger={trigger.current}
          close={(created) => {
            setAdding(false);
            if (!created) return;
            if (created.invitePath && created.expiresAt) {
              setInviteLink({
                name: created.name,
                username: created.username,
                invitePath: created.invitePath,
                expiresAt: created.expiresAt,
              });
            }
            setRecentIds((prev) => [created.id, ...prev.filter((id) => id !== created.id)]);
            toast.success(
              `已创建账户 ${created.name}`,
              matchesFilters(created)
                ? undefined
                : { description: "当前筛选条件已隐藏该记录，可清空筛选查看" },
            );
          }}
        />
      )}
      {pending?.kind === "detail" && target && (
        <DetailDrawer
          open
          onOpenChange={(isOpen) => {
            if (!isOpen) setPending(null);
          }}
          title={target.name}
          description={`账户名 ${target.username}`}
          badge={<Badge variant={roleBadgeVariant(target.role)}>{getRoleLabel(target.role)}</Badge>}
          onCloseAutoFocus={(e) => {
            if (returnFocus.current?.isConnected) {
              e.preventDefault();
              returnFocus.current.focus();
            }
          }}
          actions={
            canManage ? (
              targetProtectedPeer ? (
                <span className="text-xs text-muted-foreground">仅超管可维护</span>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openFromDetail("edit", target)}
                  >
                    编辑
                  </Button>
                  {!targetSelf && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openFromDetail("password", target)}
                      >
                        重置密码
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openFromDetail("invite", target)}
                      >
                        生成激活链接
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!target.sessions}
                        title={
                          target.sessions
                            ? "撤销该账户全部在线会话，需要重新登录"
                            : "暂无在线会话"
                        }
                        onClick={() => openFromDetail("revoke", target)}
                      >
                        下线
                      </Button>
                      {target.active ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={targetIsLastSuperAdmin}
                          title={
                            targetIsLastSuperAdmin ? "至少保留一名启用的超级管理员" : undefined
                          }
                          onClick={() => openFromDetail("disable", target)}
                        >
                          停用
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={enable.isPending}
                          onClick={() => enable.mutate(target)}
                        >
                          启用
                        </Button>
                      )}
                    </>
                  )}
                </>
              )
            ) : undefined
          }
          navigation={
            detailIndex >= 0
              ? {
                  hasPrev: detailIndex > 0,
                  hasNext: detailIndex < rows.length - 1,
                  current: detailIndex + 1,
                  total: rows.length,
                  onPrev: () => {
                    const prev = rows[detailIndex - 1];
                    if (prev) setPending({ kind: "detail", row: prev });
                  },
                  onNext: () => {
                    const next = rows[detailIndex + 1];
                    if (next) setPending({ kind: "detail", row: next });
                  },
                }
              : undefined
          }
        >
          <DetailSection title="身份与组织">
            <DetailField label="姓名">{target.name}</DetailField>
            <DetailField label="账户名">
              <span className="font-mono text-xs text-muted-foreground">{target.username}</span>
            </DetailField>
            <DetailField label="邮箱">{target.email || "未填写"}</DetailField>
            <DetailField label="公司或团队">{target.company || "未填写"}</DetailField>
          </DetailSection>
          <DetailSection title="角色与状态">
            <DetailField label="角色">{getRoleLabel(target.role)}</DetailField>
            <DetailField label="状态">
              <Badge variant={target.active ? "success" : "neutral"}>
                {target.active ? "已启用" : "已停用"}
              </Badge>
            </DetailField>
            <DetailField label="在线会话">
              <span className="tabular-nums">{target.sessions ?? 0}</span>
            </DetailField>
            {target.id === me.data?.id && <DetailField label="备注">当前登录账户</DetailField>}
          </DetailSection>
        </DetailDrawer>
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
          close={(message) =>
            void finish(
              message ? `已重置 ${target.name} 的密码` : undefined,
              message ? "现有在线会话已全部失效" : undefined,
            )
          }
        />
      )}
      {pending?.kind === "invite" && target && (
        <ConfirmDialog
          title="生成激活链接"
          description={`将为 ${target.name} 生成新的一次性激活链接（72 小时有效），此前未使用的链接立即失效。对方设置密码后账户被启用，现有会话全部失效。`}
          submitText="生成链接"
          submitVariant="default"
          trigger={returnFocus.current}
          action={async () => {
            inviteReturnDetailRef.current = returnToDetailRef.current;
            returnToDetailRef.current = null;
            const link = await request<AccountInviteLink>(
              `/accounts/${target.id}/invite`,
              "POST",
              {},
            );
            setInviteLink({ name: target.name, username: target.username, ...link });
          }}
          close={() => {
            const backId = returnToDetailRef.current;
            returnToDetailRef.current = null;
            if (backId !== null) {
              const latest =
                cache.getQueryData<Account[]>(["accounts"])?.find((r) => r.id === backId) ??
                query.data?.find((r) => r.id === backId);
              if (latest) {
                setPending({ kind: "detail", row: latest });
                return;
              }
            }
            setPending(null);
          }}
        />
      )}
      {inviteLink && (
        <InviteLinkDialog
          invite={inviteLink}
          close={() => {
            setInviteLink(null);
            const backId = inviteReturnDetailRef.current;
            inviteReturnDetailRef.current = null;
            if (backId !== null) {
              const latest =
                cache.getQueryData<Account[]>(["accounts"])?.find((r) => r.id === backId) ??
                query.data?.find((r) => r.id === backId);
              if (latest) setPending({ kind: "detail", row: latest });
            }
          }}
        />
      )}
      {pending?.kind === "revoke" && target && (
        <ConfirmDialog
          title="强制下线"
          description={`将撤销 ${target.name} 的 ${target.sessions ?? 0} 个在线会话，对方需要重新登录。`}
          submitText="强制下线"
          trigger={returnFocus.current}
          action={() => request(`/accounts/${target.id}/revoke`, "POST", {})}
          close={(done) => void finish(done ? `${target.name} 的会话已全部撤销` : undefined)}
        />
      )}
      {pending?.kind === "disable" && target && (
        <ConfirmDialog
          title="停用账户"
          description={`停用后 ${target.name} 无法登录，现有会话立即失效。可随时重新启用。`}
          submitText="停用账户"
          trigger={returnFocus.current}
          action={() => request(`/accounts/${target.id}`, "PATCH", { active: false })}
          close={(done) =>
            void finish(
              done ? `已停用 ${target.name}` : undefined,
              done ? "现有在线会话已立即失效" : undefined,
            )
          }
        />
      )}
    </ResourceTableSlot>
  );
}
