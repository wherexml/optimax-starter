import { useEffect, useRef } from "react";

export type FilterValue = string | string[] | undefined;
export type Filters = Record<string, FilterValue>;
const PREFIX = "optimax-starter.filters.v1";

const present = (v: FilterValue) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
// Copies arrays so a saved snapshot never shares a reference with render state.
const pick = (values: Filters, keys: readonly string[]): Filters =>
  Object.fromEntries(
    keys
      .filter((k) => present(values[k]))
      .map((k) => {
        const v = values[k];
        return [k, Array.isArray(v) ? [...v] : v];
      }),
  );
// Order-independent signature for comparing values that contain arrays.
const signature = (values: Filters, keys: readonly string[]) =>
  JSON.stringify(
    keys.map((k) => {
      const v = values[k];
      return [k, Array.isArray(v) ? [...v].sort() : (v ?? "")];
    }),
  );

function load(
  key: string,
  parse: (raw: Record<string, unknown>) => Filters,
  keys: readonly string[],
) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    // Old saves hold scalar values and new ones may hold arrays; parse() accepts both.
    return pick(parse(data as Record<string, unknown>), keys);
  } catch {
    return null;
  }
}
function save(key: string, value: Filters) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用或超出配额时，筛选只在 URL 中生效。
  }
}

/**
 * Saves each account's dropdown filters per page in localStorage. Adapted from EASM usePersistedFilters.
 * - When the page opens, filters already in the URL win and are saved. Otherwise the account's saved filters are restored once.
 * - After that, only filter changes are saved. Clearing all saves {}, so the page stays cleared after reload.
 * - Only keys listed in persist are saved. q and its operator qOp are never saved or restored.
 * - Array values are saved and compared by value.
 * Returns update(next); route all filter changes through it.
 */
export function usePersistedFilters({
  scope,
  accountId,
  values,
  persist,
  parse,
  apply,
}: {
  scope: string;
  accountId: number | undefined;
  values: Filters;
  persist: readonly string[];
  parse: (raw: Record<string, unknown>) => Filters;
  apply: (next: Filters) => void;
}) {
  const key = accountId ? `${PREFIX}:${accountId}:${scope}` : null;
  const decided = useRef<string | null>(null);
  const restoring = useRef<Filters | null>(null);
  const latest = useRef({ values, parse, apply, persist });
  latest.current = { values, parse, apply, persist };
  const snapshot = JSON.stringify(pick(values, persist));

  useEffect(() => {
    if (!key) return;
    const { values, parse, apply, persist } = latest.current;
    if (decided.current !== key) {
      decided.current = key;
      restoring.current = null;
      const explicit = Object.values(values).some(present);
      const saved = explicit ? null : load(key, parse, persist);
      if (saved && Object.keys(saved).length) {
        restoring.current = saved;
        apply(saved);
        return;
      }
    }
    if (restoring.current) {
      if (signature(values, persist) !== signature(restoring.current, persist)) return;
      restoring.current = null;
    }
    save(key, JSON.parse(snapshot) as Filters);
  }, [key, snapshot]);

  return (next: Filters) => {
    restoring.current = null;
    latest.current.apply(next);
  };
}
