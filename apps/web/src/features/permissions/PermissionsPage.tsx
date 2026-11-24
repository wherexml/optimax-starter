import {
  type AccountRole,
  getModuleActionChecked,
  getModuleActionDisabled,
  hasModuleOperateAction,
  type ModulePermissionAction,
  PERMISSION_ACTION_LABELS,
  PERMISSION_ROLES,
  ROLE_LABELS,
  SYSTEM_PERMISSION_ROWS,
  type SystemPermissionMatrixPayload,
  type SystemPermissionRow,
  toggleModulePermissionAction,
} from "@optimax-starter/api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@optimax-starter/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleHelp, Eye, Lock, RotateCcw, RotateCw, Save, Wrench } from "lucide-react";
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
  locked,
  busy,
  disabledReason,
  label,
  roleLabel,
  rowLabel,
  onClick,
}: {
  action: ModulePermissionAction;
  checked: boolean;
  locked: boolean;
  busy: boolean;
  disabledReason?: string;
  label: string;
  roleLabel: string;
  rowLabel: string;
  onClick: () => void;
}) {
  const Icon = ACTION_ICONS[action];
  const buttonClass = cn(
    "inline-flex h-[26px] w-[66px] items-center justify-center gap-1 rounded-[5px] border-[0.5px] text-xs leading-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    checked
      ? "border-[var(--primary)] bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
      : "border-[var(--input)] bg-[var(--card)] font-normal text-foreground hover:bg-[var(--muted)]",
    (locked || busy) && "cursor-not-allowed opacity-55",
  );
  const content = (
    <>
      <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
      {locked && <Lock size={10.5} strokeWidth={1.75} aria-hidden="true" />}
    </>
  );

  if (locked && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={`${roleLabel}-${rowLabel}-${label}`}
          aria-pressed={checked}
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className={buttonClass}
        >
          {content}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-xs rounded-md leading-relaxed">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      aria-label={`${roleLabel}-${rowLabel}-${label}`}
      aria-pressed={checked}
      aria-disabled={locked || busy ? "true" : undefined}
      onClick={() => {
        if (locked || busy) return;
        onClick();
      }}
      className={buttonClass}
    >
      {content}
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
              variant="ghost"
              size="icon-sm"
              title="刷新"
              aria-label="刷新系统权限"
              disabled={query.isFetching}
              onClick={() => void runRefresh(() => query.refetch())}
            >
              <RotateCw size={15} />
            </Button>
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
        <TooltipProvider delay={150}>
          <div className="overflow-x-auto rounded-lg border-[0.5px] border-[var(--hairline)] bg-[var(--card)]">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)]">
                  <th className="h-10 w-[220px] px-3.5 text-xs font-medium text-muted-foreground">
                    权限模块
                  </th>
                  {PERMISSION_ROLES.map((role) => (
                    <th
                      key={role}
                      className="h-10 px-3.5 text-center text-xs font-medium text-muted-foreground"
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
                    className={cn(
                      "transition-colors hover:bg-muted/40",
                      idx < SYSTEM_PERMISSION_ROWS.length - 1 &&
                        "border-b-[0.5px] border-[var(--hairline)]",
                    )}
                  >
                    <td className="h-11 px-3.5 py-1.5 align-middle">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{row.label}</span>
                        <Tooltip>
                          <TooltipTrigger
                            type="button"
                            className="inline-grid size-5 place-items-center rounded text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:text-foreground"
                            aria-label={`${row.label}权限说明`}
                          >
                            <CircleHelp size={13.5} aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            sideOffset={6}
                            className="max-w-xs rounded-md leading-relaxed"
                          >
                            {row.description}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                    {PERMISSION_ROLES.map((role) => (
                      <td
                        key={`${row.id}-${role}`}
                        className="h-11 px-3.5 py-1.5 text-center align-middle"
                      >
                        {role === "super_admin" ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  data-perm-tag={`超级管理员-${row.label}-全部权限`}
                                  className="inline-flex h-[26px] cursor-default select-none items-center justify-center gap-1 text-xs text-muted-foreground"
                                />
                              }
                            >
                              <Lock
                                size={11}
                                strokeWidth={1.75}
                                aria-hidden="true"
                                className="text-muted-foreground/70"
                              />
                              <span>全部权限</span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              sideOffset={6}
                              className="max-w-xs rounded-md leading-relaxed"
                            >
                              {SUPER_ADMIN_LOCKED_REASON}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <div className="mx-auto grid w-[138px] grid-cols-2 gap-1.5">
                            {row.actions.map((action) => {
                              if (action === "operate" && !hasModuleOperateAction(row)) {
                                return (
                                  <Tooltip key={action}>
                                    <TooltipTrigger
                                      render={
                                        <span
                                          data-perm-tag={`${ROLE_LABELS[role]}-${row.label}-无操作项`}
                                          className="inline-flex h-[26px] w-[66px] cursor-default select-none items-center justify-center text-xs text-muted-foreground/60"
                                        />
                                      }
                                    >
                                      <span aria-hidden="true">—</span>
                                      <span className="sr-only">无操作项</span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      sideOffset={6}
                                      className="max-w-xs rounded-md leading-relaxed"
                                    >
                                      {row.readonlyReason ?? "该模块仅含查看权限，无独立操作项"}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }
                              const checked = getModuleActionChecked(
                                row,
                                role,
                                draft[role] ?? [],
                                action,
                              );
                              const ruleLocked =
                                !canManage || getModuleActionDisabled(row, role, action);
                              const reason = !canManage
                                ? "当前账户仅可查看权限矩阵，无法修改"
                                : (row.disabledReason ?? "该角色不支持配置此权限项");
                              return (
                                <PermissionActionButton
                                  key={action}
                                  action={action}
                                  checked={checked}
                                  locked={ruleLocked}
                                  busy={busy}
                                  disabledReason={reason}
                                  label={PERMISSION_ACTION_LABELS[action]}
                                  roleLabel={ROLE_LABELS[role]}
                                  rowLabel={row.label}
                                  onClick={() => toggle(row, role, action, !checked)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      ) : null}
    </>
  );
}
