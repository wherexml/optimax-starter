import { Plus, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Filters, FilterValue } from "@/hooks/usePersistedFilters";

/*
 * Structural adaptation of skylance-easm FilterComponent / FilterItem:
 * - Conditions are an array of rows, each with a stable id.
 * - "+" adds the first field not yet in use.
 * - A row can switch to another unused field; its value and operator reset.
 * - X removes the whole row.
 * - Search (or Enter in a text box) applies all draft rows at once.
 * Rows are combined with AND. Each field type is opt-in:
 * - select with multi: true → MultiSelect, values within one field combined with OR (EASM "enum"); otherwise single-choice equals.
 * - text with operatorKey → 包含/等于 operator stored under that URL key; otherwise contains only.
 * - date → range bound (notBefore / notAfter).
 * The EASM forced 600ms delay and gradient are not ported.
 */

type Base = { key: string; label: string };
export type FilterField =
  | (Base & {
      type: "text";
      placeholder?: string;
      ariaLabel?: string;
      operatorKey?: string;
    })
  | (Base & {
      type: "select";
      options: { value: string; label: string }[];
      multi?: boolean;
    })
  | (Base & { type: "date"; notBefore?: string; notAfter?: string });

type Op = "contains" | "equals";
type Row = { id: string; key: string; value: string | string[]; op?: Op };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cmp = (a: string, b: string) => a.localeCompare(b, "zh-CN");
// Values can arrive at runtime in any shape, whatever the types say, so keep only string entries.
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
const canon = (v: unknown) =>
  [
    ...new Set(
      list(v)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort(cmp);
const filled = (v: Row["value"]) => (Array.isArray(v) ? v.length > 0 : v.trim() !== "");
const scalar = (v: FilterValue) => (typeof v === "string" ? v : undefined);
const keysOf = (fields: FilterField[]) =>
  fields.flatMap((f) => (f.type === "text" && f.operatorKey ? [f.key, f.operatorKey] : [f.key]));
const signature = (fields: FilterField[], v: Filters) =>
  JSON.stringify(keysOf(fields).map((k) => [k, canon(v[k])]));

function blank(f: FilterField): Omit<Row, "id"> {
  if (f.type === "select" && f.multi) return { key: f.key, value: [] };
  if (f.type === "text" && f.operatorKey) return { key: f.key, value: "", op: "contains" };
  return { key: f.key, value: "" };
}
function fromCommitted(f: FilterField, get: (k: string) => string[]): Omit<Row, "id"> {
  const v = get(f.key);
  if (f.type === "select" && f.multi) return { key: f.key, value: v };
  if (f.type === "text" && f.operatorKey)
    return {
      key: f.key,
      value: v[0] ?? "",
      op: get(f.operatorKey)[0] === "equals" ? "equals" : "contains",
    };
  return { key: f.key, value: v[0] ?? "" };
}

function savedRows(
  key: string | undefined,
  committed: string,
  fields: FilterField[],
): Omit<Row, "id">[] | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 10000) return null;
    const saved = JSON.parse(raw);
    if (
      saved?.version !== 1 ||
      saved.committed !== committed ||
      !Array.isArray(saved.rows) ||
      saved.rows.length > fields.length
    )
      return null;
    const seen = new Set<string>();
    const rows: Omit<Row, "id">[] = [];
    for (const row of saved.rows) {
      const field = fields.find((f) => f.key === row?.key);
      if (!field || seen.has(field.key)) return null;
      seen.add(field.key);
      const multi = field.type === "select" && field.multi;
      const validValue = multi
        ? Array.isArray(row.value) &&
          row.value.length <= 20 &&
          row.value.every((value: unknown) => typeof value === "string" && value.length <= 80)
        : typeof row.value === "string" &&
          row.value.length <= (field.type === "text" ? 200 : field.type === "date" ? 10 : 80);
      if (!validValue) return null;
      if (
        row.op !== undefined &&
        (field.type !== "text" || !field.operatorKey || !["contains", "equals"].includes(row.op))
      )
        return null;
      rows.push({
        key: field.key,
        value: Array.isArray(row.value) ? [...row.value] : row.value,
        ...(row.op ? { op: row.op } : {}),
      });
    }
    return rows;
  } catch {
    return null;
  }
}

function saveRows(key: string | undefined, committed: string, rows: Row[]) {
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        committed,
        rows: rows.map(({ key, value, op }) => ({ key, value, ...(op ? { op } : {}) })),
      }),
    );
  } catch {}
}

function rangeError(fields: FilterField[], draft: Filters) {
  for (const f of fields) {
    if (f.type !== "date" || !f.notBefore) continue;
    const from = scalar(draft[f.notBefore]),
      to = scalar(draft[f.key]);
    if (from && to && to < from) {
      const other = fields.find((x) => x.key === f.notBefore)?.label ?? f.notBefore;
      return `${f.label}不能早于${other}`;
    }
  }
  return "";
}

export function FilterBar({
  fields,
  values,
  onApply,
  onDraftChange,
  storageKey,
  defaultKeys,
}: {
  fields: FilterField[];
  /** Committed filters from the URL. */
  values: Filters;
  /** Commits every draft row at once. Keys not in the result are removed. */
  onApply: (next: Filters) => void;
  onDraftChange?: (dirty: boolean, signature: string) => void;
  storageKey?: string;
  /** Keys to pre-populate as empty rows when no committed filters or saved drafts exist. */
  defaultKeys?: readonly string[];
}) {
  const base = useId();
  const counter = useRef(0);
  const nextId = () => `c${++counter.current}`;
  const fieldOf = (key: string) => fields.find((f) => f.key === key);
  // Sync from the URL only when the canonical committed values change, never because a new object or array was passed in.
  const sig = signature(fields, values);
  const [rows, setRows] = useState<Row[]>(() => {
    const get = (k: string) => canon(values[k]);
    const saved = savedRows(storageKey, sig, fields);
    if (saved) return saved.map((row) => ({ id: nextId(), ...row }));
    const initial = fields
      .filter((f) => get(f.key).length)
      .map((f) => ({ id: nextId(), ...fromCommitted(f, get) }));
    if (initial.length || !defaultKeys?.length) return initial;
    const seen = new Set<string>();
    return defaultKeys.flatMap((key) => {
      if (seen.has(key)) return [];
      seen.add(key);
      const field = fields.find((f) => f.key === key);
      return field ? [{ id: nextId(), ...blank(field) }] : [];
    });
  });
  const synced = useRef(sig);
  const savedKey = useRef(storageKey);
  useEffect(() => {
    if (synced.current === sig && savedKey.current === storageKey) return;
    const changed = synced.current !== sig;
    const sameKey = savedKey.current === storageKey;
    synced.current = sig;
    savedKey.current = storageKey;
    const map = new Map(JSON.parse(sig) as [string, string[]][]);
    const get = (k: string) => map.get(k) ?? [];
    const saved = savedRows(storageKey, sig, fields);
    if (saved) {
      setRows(
        saved.map((row) => ({
          id: rows.find((previous) => previous.key === row.key)?.id ?? nextId(),
          ...row,
        })),
      );
      return;
    }
    const next = (sameKey ? rows : []).flatMap((r) => {
      const f = fieldOf(r.key);
      if (!f) return [];
      if (get(r.key).length) return [{ id: r.id, ...fromCommitted(f, get) }];
      return filled(r.value) ? [] : [r];
    });
    for (const f of fields)
      if (get(f.key).length && !next.some((r) => r.key === f.key))
        next.push({ id: nextId(), ...fromCommitted(f, get) });
    setRows(next);
    if (changed) saveRows(storageKey, sig, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, storageKey]);

  function changeRows(next: Row[]) {
    setRows(next);
    saveRows(storageKey, sig, next);
  }

  const draft: Filters = {};
  for (const r of rows) {
    const f = fieldOf(r.key);
    if (!f) continue;
    if (Array.isArray(r.value)) {
      const v = canon(r.value);
      if (v.length) draft[r.key] = v.length === 1 ? v[0]! : v;
      continue;
    }
    const v = r.value.trim();
    if (!v) continue;
    draft[r.key] = v;
    if (f.type === "text" && f.operatorKey && r.op === "equals") draft[f.operatorKey] = "equals";
  }
  const dirty = signature(fields, draft) !== sig;
  const draftSignature = JSON.stringify(rows.map(({ key, value, op }) => [key, value, op]));
  useEffect(() => {
    onDraftChange?.(dirty, draftSignature);
  }, [dirty, draftSignature, onDraftChange]);
  const error = rangeError(fields, draft);
  const malformed = rows.some(
    (r) =>
      fieldOf(r.key)?.type === "date" &&
      typeof r.value === "string" &&
      r.value !== "" &&
      !DAY.test(r.value),
  );
  const unused = fields.filter((f) => !rows.some((r) => r.key === f.key));
  const addId = `${base}-add`;
  const valueId = (r: Row) => `${base}-${r.id}-value`;
  const removeId = (r: Row) => `${base}-${r.id}-remove`;
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  function add() {
    const f = unused[0];
    if (!f) return;
    const row = { id: nextId(), ...blank(f) };
    changeRows([...rows, row]);
    focus(valueId(row));
  }
  function remove(index: number) {
    const rest = rows.filter((_, i) => i !== index);
    changeRows(rest);
    const next = rest[index] ?? rest[index - 1];
    focus(next ? removeId(next) : addId);
  }
  function setField(id: string, key: string) {
    if (rows.some((r) => r.id !== id && r.key === key)) return;
    const f = fieldOf(key);
    if (!f) return;
    changeRows(rows.map((r) => (r.id === id ? { id, ...blank(f) } : r)));
  }
  function setValue(id: string, value: string | string[]) {
    changeRows(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function setOp(id: string, op: Op) {
    changeRows(rows.map((r) => (r.id === id ? { ...r, op } : r)));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (error || malformed) return;
    onApply(draft);
  }
  function clear() {
    changeRows([]);
    onApply({});
    focus(addId);
  }

  return (
    <form
      role="search"
      aria-label="筛选"
      className="filter-bar"
      noValidate
      autoComplete="off"
      onSubmit={submit}
    >
      {rows.map((r, i) => {
        const f = fieldOf(r.key);
        if (!f) return null;
        const text = typeof r.value === "string" ? r.value : "";
        const invalid =
          f.type === "date" &&
          ((text !== "" && !DAY.test(text)) ||
            (Boolean(error) && Boolean(f.notBefore || f.notAfter)));
        return (
          <div key={r.id} role="group" aria-label={`筛选条件 ${i + 1}`} className="filter-row">
            <Select value={r.key} onValueChange={(k) => setField(r.id, k)}>
              <SelectTrigger
                aria-label="筛选字段"
                className="filter-field h-8 min-w-28 w-auto shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((x) => {
                  const usedByOther = x.key !== r.key && rows.some((o) => o.key === x.key);
                  return (
                    <SelectItem key={x.key} value={x.key} disabled={usedByOther}>
                      {x.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {f.type === "text" && f.operatorKey && (
              <Select
                value={r.op ?? "contains"}
                onValueChange={(op) => setOp(r.id, op === "equals" ? "equals" : "contains")}
              >
                <SelectTrigger
                  aria-label={`${f.label}匹配方式`}
                  className="filter-op h-8 w-20 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">包含</SelectItem>
                  <SelectItem value="equals">等于</SelectItem>
                </SelectContent>
              </Select>
            )}
            {f.type === "text" ? (
              <Input
                id={valueId(r)}
                type="search"
                name={`filter-${f.key}`}
                autoComplete="off"
                data-1p-ignore="true"
                className="filter-value h-8 w-56 max-w-full"
                aria-label={f.ariaLabel ?? f.label}
                placeholder={f.placeholder}
                maxLength={200}
                value={text}
                onChange={(e) => setValue(r.id, e.target.value)}
              />
            ) : f.type === "select" && f.multi ? (
              <MultiSelect
                id={valueId(r)}
                label={f.label}
                className="filter-value h-8 w-40"
                options={f.options}
                value={Array.isArray(r.value) ? r.value : []}
                onValueChange={(v) => setValue(r.id, v)}
              />
            ) : f.type === "select" ? (
              <Select value={text} onValueChange={(v) => setValue(r.id, v)}>
                <SelectTrigger
                  id={valueId(r)}
                  aria-label={f.label}
                  className="filter-value h-8 w-36"
                >
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {text && !f.options.some((o) => o.value === text) && (
                    <SelectItem value={text}>{text}</SelectItem>
                  )}
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={valueId(r)}
                type="date"
                name={`filter-${f.key}`}
                autoComplete="off"
                data-1p-ignore="true"
                className="filter-value h-8 w-40"
                aria-label={f.label}
                aria-invalid={invalid || undefined}
                min={f.notBefore ? scalar(draft[f.notBefore]) : undefined}
                max={f.notAfter ? scalar(draft[f.notAfter]) : undefined}
                value={text}
                onChange={(e) => setValue(r.id, e.target.value)}
              />
            )}
            <Button
              type="button"
              id={removeId(r)}
              variant="ghost"
              size="icon-sm"
              className="filter-remove shrink-0"
              aria-label={`移除筛选 ${f.label}`}
              title={`移除筛选 ${f.label}`}
              onClick={() => remove(i)}
            >
              <X size={15} aria-hidden="true" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        id={addId}
        variant="outline"
        size={rows.length === 0 ? "sm" : "icon-sm"}
        aria-label="添加筛选项"
        title={rows.length === 0 ? undefined : "添加筛选项"}
        disabled={!unused.length}
        onClick={add}
      >
        <Plus size={15} aria-hidden="true" />
        {rows.length === 0 && <span>添加筛选项</span>}
      </Button>
      {(rows.length > 0 || dirty) && (
        <Button
          type="submit"
          variant={dirty ? "default" : "outline"}
          size="sm"
          className="filter-apply"
          aria-label="搜索"
          aria-describedby={dirty ? `${base}-pending` : undefined}
          data-pending={dirty || undefined}
          disabled={Boolean(error) || malformed}
        >
          <Search size={15} aria-hidden="true" />
          <span>搜索</span>
        </Button>
      )}
      {dirty && (
        <span id={`${base}-pending`} className="sr-only">
          有未应用的更改
        </span>
      )}
      {rows.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          清空
        </Button>
      )}
      {error && (
        <p role="alert" className="filter-error">
          {error}
        </p>
      )}
    </form>
  );
}
