import { eq } from "drizzle-orm";
import { rolePermissions } from "@optimax-starter/db/schema/console";
import {
  PERMISSION_CATALOG,
  PERMISSION_ROLES,
  ROLE_LABELS,
  defaultPermissionCodes,
  normalizePersistedRolePermissions,
  validateRolePermissionsInput,
  type AccountRole,
  type ActorSource,
  type SystemPermissionMatrixPayload,
} from "@optimax-starter/api";
import { db } from "../services";
import { auditResource } from "./audit";
import { Refusal, type Party, type Tx } from "./guards";

type DbReader = Tx | typeof db;

const CACHE_TTL_MS = 2_000;
let cachedMatrix: {
  expiresAt: number;
  roles: Record<AccountRole, string[]>;
} | null = null;

export function invalidatePermissionCache(): void {
  cachedMatrix = null;
}

async function readRoleMap(reader: DbReader): Promise<{
  roles: Record<AccountRole, string[]>;
  updatedAt: Date | null;
}> {
  const rows = await reader.select().from(rolePermissions);
  const byRole = new Map(rows.map((row) => [row.role, row]));
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.updatedAt && (!latest || row.updatedAt > latest)) {
      latest = row.updatedAt;
    }
  }
  return {
    roles: {
      member: normalizePersistedRolePermissions(
        "member",
        byRole.get("member")?.permissions,
      ),
      admin: normalizePersistedRolePermissions(
        "admin",
        byRole.get("admin")?.permissions,
      ),
      super_admin: defaultPermissionCodes("super_admin"),
    },
    updatedAt: latest,
  };
}

export async function getEffectivePermissions(role: string): Promise<string[]> {
  if (role === "super_admin") {
    return defaultPermissionCodes("super_admin");
  }
  if (role !== "admin" && role !== "member") {
    return [];
  }
  const now = Date.now();
  if (!cachedMatrix || cachedMatrix.expiresAt <= now) {
    const { roles } = await readRoleMap(db);
    cachedMatrix = { expiresAt: now + CACHE_TTL_MS, roles };
  }
  return cachedMatrix.roles[role];
}

export async function getEffectivePermissionsTx(
  tx: Tx,
  role: string,
): Promise<string[]> {
  if (role === "super_admin") {
    return defaultPermissionCodes("super_admin");
  }
  if (role !== "admin" && role !== "member") {
    return [];
  }
  const [row] = await tx
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.role, role));
  return normalizePersistedRolePermissions(role, row?.permissions);
}

export async function getPermissionMatrixPayload(
  reader: DbReader = db,
): Promise<SystemPermissionMatrixPayload> {
  const { roles, updatedAt } = await readRoleMap(reader);
  return {
    catalog: PERMISSION_CATALOG,
    roles,
    defaults: {
      member: defaultPermissionCodes("member"),
      admin: defaultPermissionCodes("admin"),
      super_admin: defaultPermissionCodes("super_admin"),
    },
    immutable: {
      super_admin: defaultPermissionCodes("super_admin"),
    },
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

function samePermissions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code, idx) => code === b[idx]);
}

export async function updatePermissionMatrixTx(
  tx: Tx,
  actor: Party,
  inputRoles: Partial<Record<AccountRole, string[]>>,
  actorSource: ActorSource = "human",
): Promise<SystemPermissionMatrixPayload> {
  const { roles: beforeByRole } = await readRoleMap(tx);
  const now = new Date();

  for (const role of PERMISSION_ROLES) {
    const submitted = inputRoles[role];
    if (submitted === undefined) continue;
    let normalized: string[];
    try {
      normalized = validateRolePermissionsInput(role, submitted);
    } catch (error) {
      throw new Refusal(
        422,
        error instanceof Error ? error.message : "权限配置无效",
      );
    }
    const before = beforeByRole[role];
    if (role === "super_admin") continue;
    if (samePermissions(before, normalized)) continue;

    await tx
      .insert(rolePermissions)
      .values({
        role,
        permissions: normalized,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: rolePermissions.role,
        set: {
          permissions: normalized,
          updatedAt: now,
          updatedBy: actor.id,
        },
      });

    await auditResource(
      tx,
      "permission.update",
      actor,
      { code: role, name: ROLE_LABELS[role] },
      {
        targetRole: role,
        beforePermissions: before,
        afterPermissions: normalized,
      }, actorSource,
    );
  }

  return getPermissionMatrixPayload(tx);
}

export async function resetPermissionMatrixTx(
  tx: Tx,
  actor: Party,
  actorSource: ActorSource = "human",
): Promise<SystemPermissionMatrixPayload> {
  const { roles: beforeByRole } = await readRoleMap(tx);
  const now = new Date();
  let changed = false;

  for (const role of ["member", "admin"] as const) {
    const defaults = defaultPermissionCodes(role);
    if (!samePermissions(beforeByRole[role], defaults)) {
      changed = true;
    }
    await tx
      .insert(rolePermissions)
      .values({
        role,
        permissions: defaults,
        updatedAt: now,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: rolePermissions.role,
        set: {
          permissions: defaults,
          updatedAt: now,
          updatedBy: actor.id,
        },
      });
  }

  await auditResource(
    tx,
    "permission.reset",
    actor,
    { code: "all_roles", name: "全部系统角色" },
    {
      from: changed ? "custom" : "default",
      to: "default",
    }, actorSource,
  );

  return getPermissionMatrixPayload(tx);
}
