import {
  type AccountRole,
  getModuleActionChecked,
  getModuleActionDisabled,
  type ModulePermissionAction,
  PERMISSION_ACTION_LABELS,
  PERMISSION_ROLES,
  ROLE_LABELS,
  SYSTEM_PERMISSION_ROWS,
  type SystemPermissionMatrixPayload,
  type SystemPermissionRow,
  toggleModulePermissionAction,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Lock, RotateCcw, RotateCw, Save, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { useContentRefresh } from "@/features/refresh/WorkspaceRefresh";
import { cn } from "@/lib/utils";

type RoleMatrix = Record<AccountRole, string[]>;

const ACTION_ICONS: Record<ModulePermissionAction, typeof Eye> = {
  view: Eye,
  operate: Wrench,
};

const SUPER_ADMIN_LOCKED_REASON = "超级管理员默认拥有全部查看和操作权限，不能关闭";

function cloneMatrix(roles: RoleMatrix): RoleMatrix {
  return {
    member: [...(roles.member ?? [])],
    admin: [...(roles.admin ?? [])],
    super_admin: [...(roles.super_admin ?? [])],
  };
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code) => b.includes(code));
}

function sameMatrix(a: RoleMatrix, b: RoleMatrix): boolean {
  return PERMISSION_ROLES.every((role) => sameCodes(a[role] ?? [], b[role] ?? []));
}

function PermissionActionButton({
  action,
  checked,
  disabled,
  disabledReason,
  label,
  roleLabel,
  rowLabel,
  onClick,
}: {
  action: ModulePermissionAction;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  label: string;
  roleLabel: string;
  rowLabel: string;
  onClick: () => void;
}) {
  const Icon = ACTION_ICONS[action];
  return (
    <button
      type="button"
      aria-label={`${roleLabel}-${rowLabel}-${label}`}
      aria-pressed={checked}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-[86px] items-center justify-center gap-1.5 rounded-md border-[0.5px] text-sm font-medium transition-colors duration-150",
        checked
          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "border-[var(--input)] bg-[var(--card)] text-foreground hover:bg-[var(--muted)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {disabled && <Lock size={12} aria-hidden="true" />}
    </button>
  );
}

export function PermissionsPage() {
  const runRefresh = useContentRefresh();
  const cache = useQueryClient();
  const me = useAccount();
  const canRead =
    me.data?.role === "super_admin" && hasPermission(me.data, "system:permission:read");
  const canManage =
    me.data?.role === "super_admin" && hasPermission(me.data, "system:permission:manage");

  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["system-permissions"],
    queryFn: () => request<SystemPermissionMatrixPayload>("/system/permissions"),
    enabled: Boolean(me.data) && canRead,
  });

  const [draft, setDraft] = useState<RoleMatrix | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    if (query.data?.roles) {
      setDraft(cloneMatrix(query.data.roles));
    }
  }, [query.data?.roles]);

  async function syncSessionAndMatrix() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["system-permissions"] }),
      cache.invalidateQueries({ queryKey: ["session"] }),
    ]);
  }

  const save = useMutation({
    mutationFn: (roles: RoleMatrix) =>
      request<SystemPermissionMatrixPayload>("/system/permissions", "PUT", {
        roles: {
          member: roles.member,
          admin: roles.admin,
        },
      }),
    onSuccess: async (updated) => {
      setDraft(cloneMatrix(updated.roles));
      await syncSessionAndMatrix();
      toast.success("系统权限已保存");
    },
    onError: (err) => {
      toast.error("保存系统权限失败", { description: err.message });
    },
  });

  const reset = useMutation({
    mutationFn: () =>
      request<SystemPermissionMatrixPayload>("/system/permissions/reset", "POST", {}),
    onSuccess: async (updated) => {
      setDraft(cloneMatrix(updated.roles));
      await syncSessionAndMatrix();
      toast.success("已恢复默认系统权限");
    },
    onError: (err) => {
      toast.error("恢复默认权限失败", { description: err.message });
    },
  });

  if (!canRead) {
    return (
      <>
        <PageHeader title="系统权限" />
        <p role="alert" className="text-muted-foreground">
          需要超级管理员权限
        </p>
      </>
    );
  }

  const busy = save.isPending || reset.isPending;
  const hasChanges = Boolean(query.data?.roles && draft && !sameMatrix(query.data.roles, draft));

  function toggle(
    row: SystemPermissionRow,
    role: AccountRole,
    action: ModulePermissionAction,
    nextChecked: boolean,
  ) {
    setResetArmed(false);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        [role]: toggleModulePermissionAction(row, role, current[role] ?? [], action, nextChecked),
      };
    });
  }

  function handleResetClick() {
    if (!resetArmed) {
      setResetArmed(true);
      toast.warning("再次点击「确认恢复」将恢复默认角色权限");
      return;
    }
    setResetArmed(false);
    reset.mutate();
  }

  return (
    <>
      <PageHeader
        title="系统权限"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage || busy}
              onClick={handleResetClick}
            >
              <RotateCcw size={15} />
              {reset.isPending ? "恢复中…" : resetArmed ? "确认恢复" : "恢复默认"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canManage || busy || !hasChanges}
              onClick={() => {
                if (!draft) return;
                setResetArmed(false);
                save.mutate(draft);
              }}
            >
              <Save size={15} />
              {save.isPending ? "保存中…" : "保存配置"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="刷新"
              aria-label="刷新系统权限"
              disabled={query.isFetching}
              onClick={() => void runRefresh(() => query.refetch())}
            >
              <RotateCw size={15} />
            </Button>
          </div>
        }
      />

      {query.isPending ? (
        <div
          role="status"
          aria-label="正在加载"
          className="panel p-6 text-sm text-muted-foreground"
        >
          正在加载系统权限…
        </div>
      ) : query.isError ? (
        <div role="alert" className="panel flex items-center justify-between gap-3 p-5">
          <p className="m-0 text-sm text-destructive">{query.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : draft ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-lg border-[0.5px] border-[var(--hairline)] bg-[var(--card)]">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)]">
                  <th className="w-[280px] px-4 py-3 font-medium text-muted-foreground">
                    权限模块
                  </th>
                  {PERMISSION_ROLES.map((role) => (
                    <th
                      key={role}
                      className="px-4 py-3 text-center font-medium text-muted-foreground"
                    >
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SYSTEM_PERMISSION_ROWS.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={
                      idx < SYSTEM_PERMISSION_ROWS.length - 1
                        ? "border-b-[0.5px] border-[var(--hairline)]"
                        : undefined
                    }
                  >
                    <td className="px-4 py-3.5 align-middle">
                      <div className="font-medium text-foreground">{row.label}</div>
                      <div className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
                        {row.description}
                      </div>
                    </td>
                    {PERMISSION_ROLES.map((role) => (
                      <td
                        key={`${row.id}-${role}`}
                        className="px-4 py-3.5 text-center align-middle"
                      >
                        <div className="mx-auto grid w-[180px] grid-cols-2 gap-2">
                          {row.actions.map((action) => {
                            const checked = getModuleActionChecked(
                              row,
                              role,
                              draft[role] ?? [],
                              action,
                            );
                            const actionDisabled =
                              !canManage || busy || getModuleActionDisabled(row, role, action);
                            const reason =
                              role === "super_admin"
                                ? SUPER_ADMIN_LOCKED_REASON
                                : (row.disabledReason ?? "该角色不支持配置此权限项");
                            return (
                              <PermissionActionButton
                                key={action}
                                action={action}
                                checked={checked}
                                disabled={actionDisabled}
                                disabledReason={reason}
                                label={PERMISSION_ACTION_LABELS[action]}
                                roleLabel={ROLE_LABELS[role]}
                                rowLabel={row.label}
                                onClick={() => toggle(row, role, action, !checked)}
                              />
                            );
                          })}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-xs leading-[18px] text-muted-foreground">
            超级管理员固定保留全部权限不可关闭；关闭角色的模块查看权限后，对应侧栏菜单自动隐藏且接口返回
            403。
          </p>
        </div>
      ) : null}
    </>
  );
}
