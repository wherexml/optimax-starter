import { Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import type { FilterValue, Filters } from "@/hooks/usePersistedFilters";

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
  [...new Set(list(v).map((s) => s.trim()).filter(Boolean))].sort(cmp);
const filled = (v: Row["value"]) =>
  Array.isArray(v) ? v.length > 0 : v.trim() !== "";
const scalar = (v: FilterValue) => (typeof v === "string" ? v : undefined);
const keysOf = (fields: FilterField[]) =>
  fields.flatMap((f) =>
    f.type === "text" && f.operatorKey ? [f.key, f.operatorKey] : [f.key],
  );
const signature = (fields: FilterField[], v: Filters) =>
  JSON.stringify(keysOf(fields).map((k) => [k, canon(v[k])]));

function blank(f: FilterField): Omit<Row, "id"> {
  if (f.type === "select" && f.multi) return { key: f.key, value: [] };
  if (f.type === "text" && f.operatorKey)
    return { key: f.key, value: "", op: "contains" };
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
}: {
  fields: FilterField[];
  /** Committed filters from the URL. */
  values: Filters;
  /** Commits every draft row at once. Keys not in the result are removed. */
  onApply: (next: Filters) => void;
}) {
  const base = useId();
  const counter = useRef(0);
  const nextId = () => `c${++counter.current}`;
  const fieldOf = (key: string) => fields.find((f) => f.key === key);
  // Sync from the URL only when the canonical committed values change, never because a new object or array was passed in.
  const sig = signature(fields, values);
  const [rows, setRows] = useState<Row[]>(() => {
    const get = (k: string) => canon(values[k]);
    return fields
      .filter((f) => get(f.key).length)
      .map((f) => ({ id: nextId(), ...fromCommitted(f, get) }));
  });
  const synced = useRef(sig);
  useEffect(() => {
    if (synced.current === sig) return;
    synced.current = sig;
    const map = new Map(JSON.parse(sig) as [string, string[]][]);
    const get = (k: string) => map.get(k) ?? [];
    setRows((prev) => {
      // Keep row order. Committed rows take the URL value and operator together, blank rows stay visible,
      // and non-blank drafts that are no longer in the URL are dropped.
      const next = prev.flatMap((r) => {
        const f = fieldOf(r.key);
        if (!f) return [];
        if (get(r.key).length) return [{ id: r.id, ...fromCommitted(f, get) }];
        return filled(r.value) ? [] : [r];
      });
      for (const f of fields)
        if (get(f.key).length && !next.some((r) => r.key === f.key))
          next.push({ id: nextId(), ...fromCommitted(f, get) });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

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
    if (f.type === "text" && f.operatorKey && r.op === "equals")
      draft[f.operatorKey] = "equals";
  }
  const dirty = signature(fields, draft) !== sig;
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
  const focus = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus());

  function add() {
    const f = unused[0];
    if (!f) return;
    const row = { id: nextId(), ...blank(f) };
    setRows((prev) => [...prev, row]);
    focus(valueId(row));
  }
  function remove(index: number) {
    const rest = rows.filter((_, i) => i !== index);
    setRows(rest);
    const next = rest[index] ?? rest[index - 1];
    focus(next ? removeId(next) : addId);
  }
  function setField(id: string, key: string) {
    const f = fieldOf(key);
    if (!f) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { id, ...blank(f) } : r)));
  }
  function setValue(id: string, value: string | string[]) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }
  function setOp(id: string, op: Op) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, op } : r)));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (error || malformed) return;
    onApply(draft);
  }
  function clear() {
    setRows([]);
    onApply({});
    focus(addId);
  }

  return (
    <form
      role="search"
      aria-label="筛选"
      className="filter-bar"
      noValidate
      onSubmit={submit}
    >
      {rows.map((r, i) => {
        const f = fieldOf(r.key);
        if (!f) return null;
        const choices = fields.filter(
          (x) => x.key === r.key || !rows.some((o) => o.key === x.key),
        );
        const text = typeof r.value === "string" ? r.value : "";
        const invalid =
          f.type === "date" &&
          ((text !== "" && !DAY.test(text)) ||
            (Boolean(error) && Boolean(f.notBefore || f.notAfter)));
        return (
          <div
            key={r.id}
            role="group"
            aria-label={`筛选条件 ${i + 1}`}
            className="filter-row"
          >
            <Select value={r.key} onValueChange={(k) => setField(r.id, k)}>
              <SelectTrigger
                aria-label="筛选字段"
                className="filter-field h-9 w-28 shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((x) => (
                  <SelectItem key={x.key} value={x.key}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {f.type === "text" && f.operatorKey && (
              <Select
                value={r.op ?? "contains"}
                onValueChange={(op) => setOp(r.id, op === "equals" ? "equals" : "contains")}
              >
                <SelectTrigger
                  aria-label={`${f.label}匹配方式`}
                  className="filter-op h-9 w-20 shrink-0"
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
                className="filter-value h-9 w-56 max-w-full"
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
                className="filter-value h-9 w-40"
                options={f.options}
                value={Array.isArray(r.value) ? r.value : []}
                onValueChange={(v) => setValue(r.id, v)}
              />
            ) : f.type === "select" ? (
              <Select value={text} onValueChange={(v) => setValue(r.id, v)}>
                <SelectTrigger
                  id={valueId(r)}
                  aria-label={f.label}
                  className="filter-value h-9 w-36"
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
                className="filter-value h-9 w-40"
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
              size="icon"
              className="filter-remove h-9 w-9 shrink-0"
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
        size="icon"
        className="h-9 w-9"
        aria-label="添加筛选"
        title="添加筛选"
        disabled={!unused.length}
        onClick={add}
      >
        <Plus size={16} aria-hidden="true" />
      </Button>
      <Button
        type="submit"
        variant={dirty ? "default" : "outline"}
        size="icon"
        className="filter-apply h-9 w-9"
        aria-label="应用筛选"
        title="应用筛选"
        aria-describedby={dirty ? `${base}-pending` : undefined}
        data-pending={dirty || undefined}
        disabled={Boolean(error) || malformed}
      >
        <Search size={16} aria-hidden="true" />
      </Button>
      {dirty && (
        <span id={`${base}-pending`} className="sr-only">
          有未应用的更改
        </span>
      )}
      {rows.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          清空筛选
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
