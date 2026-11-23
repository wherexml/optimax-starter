import {
  ACTOR_SOURCES,
  type AccountRole,
  type AccountSearch,
  type ActorSource,
  ASSET_SORT_FIELDS,
  ASSET_STAGES,
  type AssetSearch,
  type AssetSortField,
  type AssetStage,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  type AuditSearch,
  ROLE_VALUES,
} from "@optimax-starter/api";

export { AUDIT_ACTION_LABELS, AUDIT_ACTIONS };

// URL search parsers shared by route validation and saved-filter restore, so both accept the same values.
const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v : undefined;

const MAX_ITEMS = 20;
const STAGES: readonly string[] = ASSET_STAGES;
const ROLES: readonly string[] = ROLE_VALUES;
const SOURCES: readonly string[] = ACTOR_SOURCES;

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

// Server paging/sorting defaults are omitted from URLs so the plain /assets link stays canonical.
export const ASSET_SEARCH_DEFAULTS = {
  sortBy: "id" as AssetSortField,
  sortDir: "desc" as const,
  page: 1,
  size: 20,
};
export const ASSET_PAGE_SIZES = [20, 50, 100] as const;
const SORT_FIELDS: readonly string[] = ASSET_SORT_FIELDS;

const intParam = (v: unknown): number | undefined => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d{1,6}$/.test(v.trim())
        ? Number(v)
        : NaN;
  return Number.isInteger(n) ? n : undefined;
};

export function parseAssetSearch(v: Record<string, unknown>): AssetSearch {
  const code = text(v.code, 40),
    q = text(v.q),
    stage = scalarOrList(list(v.stage, 10).filter((s): s is AssetStage => STAGES.includes(s))),
    domain = scalarOrList(list(v.domain, 80)),
    owner = scalarOrList(list(v.owner, 60)),
    sortBy =
      typeof v.sortBy === "string" && SORT_FIELDS.includes(v.sortBy)
        ? (v.sortBy as AssetSortField)
        : undefined,
    sortDir = v.sortDir === "asc" || v.sortDir === "desc" ? v.sortDir : undefined,
    page = intParam(v.page),
    size = intParam(v.size);
  return {
    ...(code ? { code } : {}),
    ...(code && v.codeOp === "equals" ? { codeOp: "equals" as const } : {}),
    ...(q ? { q } : {}),
    // Contains is the default and is left out of the URL. qOp is kept only alongside q.
    ...(q && v.qOp === "equals" ? { qOp: "equals" as const } : {}),
    ...(stage ? { stage } : {}),
    ...(domain ? { domain } : {}),
    ...(owner ? { owner } : {}),
    ...(sortBy && sortBy !== ASSET_SEARCH_DEFAULTS.sortBy ? { sortBy } : {}),
    ...(sortDir && sortDir !== ASSET_SEARCH_DEFAULTS.sortDir ? { sortDir } : {}),
    ...(page && page > 1 && page <= 100000 ? { page } : {}),
    ...(size &&
    size !== ASSET_SEARCH_DEFAULTS.size &&
    (ASSET_PAGE_SIZES as readonly number[]).includes(size)
      ? { size }
      : {}),
  };
}

export function parseAccountSearch(v: Record<string, unknown>): AccountSearch {
  const q = text(v.q),
    username = text(v.username, 80);
  return {
    ...(q ? { q } : {}),
    ...(username ? { username } : {}),
    ...(v.status === "active" || v.status === "disabled" ? { status: v.status } : {}),
    ...(typeof v.role === "string" && ROLES.includes(v.role)
      ? { role: v.role as AccountRole }
      : {}),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditSearch(v: Record<string, unknown>): AuditSearch {
  const actor = text(v.actor, 80),
    page = Number(v.page),
    size = Number(v.size);
  return {
    ...(typeof v.action === "string" && (AUDIT_ACTIONS as readonly string[]).includes(v.action)
      ? { action: v.action }
      : {}),
    ...(typeof v.source === "string" && SOURCES.includes(v.source)
      ? { source: v.source as ActorSource }
      : {}),
    ...(actor ? { actor } : {}),
    ...(typeof v.start === "string" && DAY.test(v.start) ? { start: v.start } : {}),
    ...(typeof v.end === "string" && DAY.test(v.end) ? { end: v.end } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    ...(size === 50 || size === 100 ? { size } : {}),
  };
}
