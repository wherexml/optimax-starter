import type {
  AccountSearch,
  AssetSearch,
  AssetStage,
  AuditSearch,
} from "@/console-client";

// URL search parsers shared by route validation and saved-filter restore, so both accept the same values.
const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v : undefined;

const MAX_ITEMS = 20;
const STAGES: readonly string[] = ["已登记", "待复核"];
// Normalizes a scalar or array value: trimmed, unique, sorted, at most MAX_ITEMS entries.
// Objects, nested arrays and over-long strings are dropped, never thrown.
function list(v: unknown, max: number): string[] {
  const raw = Array.isArray(v) ? v.slice(0, 100) : [v];
  const out = new Set<string>();
  for (const x of raw) {
    const s =
      typeof x === "string"
        ? x.trim()
        : typeof x === "number" && Number.isFinite(x)
          ? String(x)
          : "";
    if (s && s.length <= max) out.add(s);
    if (out.size >= MAX_ITEMS) break;
  }
  return [...out].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
// One value stays scalar so existing URLs keep their shape; two or more become an array.
const scalarOrList = <T extends string>(a: T[]): T | T[] | undefined =>
  a.length === 0 ? undefined : a.length === 1 ? a[0]! : a;
export const asList = <T extends string>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

export function parseAssetSearch(v: Record<string, unknown>): AssetSearch {
  const q = text(v.q),
    stage = scalarOrList(
      list(v.stage, 10).filter((s): s is AssetStage => STAGES.includes(s)),
    ),
    domain = scalarOrList(list(v.domain, 80));
  return {
    ...(q ? { q } : {}),
    // Contains is the default and is left out of the URL. qOp is kept only alongside q.
    ...(q && v.qOp === "equals" ? { qOp: "equals" as const } : {}),
    ...(stage ? { stage } : {}),
    ...(domain ? { domain } : {}),
  };
}

export function parseAccountSearch(v: Record<string, unknown>): AccountSearch {
  const q = text(v.q);
  return {
    ...(q ? { q } : {}),
    ...(v.status === "active" || v.status === "disabled"
      ? { status: v.status }
      : {}),
    ...(v.role === "admin" || v.role === "member" ? { role: v.role } : {}),
  };
}

export const AUDIT_ACTIONS = [
  "account.create",
  "account.update",
  "account.role",
  "account.status",
  "account.password_reset",
  "account.revoke",
  "profile.update",
  "profile.password_change",
] as const;
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "account.create": "新增账户",
  "account.update": "修改姓名",
  "account.role": "调整角色",
  "account.status": "变更状态",
  "account.password_reset": "重置密码",
  "account.revoke": "强制下线",
  "profile.update": "修改本人资料",
  "profile.password_change": "修改本人密码",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditSearch(v: Record<string, unknown>): AuditSearch {
  const actor = text(v.actor, 80),
    page = Number(v.page),
    size = Number(v.size);
  return {
    ...(typeof v.action === "string" &&
    (AUDIT_ACTIONS as readonly string[]).includes(v.action)
      ? { action: v.action }
      : {}),
    ...(actor ? { actor } : {}),
    ...(typeof v.start === "string" && DAY.test(v.start) ? { start: v.start } : {}),
    ...(typeof v.end === "string" && DAY.test(v.end) ? { end: v.end } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    ...(size === 50 || size === 100 ? { size } : {}),
  };
}
