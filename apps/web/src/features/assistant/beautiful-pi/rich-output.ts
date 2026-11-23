// Adapted from Beautiful Pi Web; MIT notice in LICENSE. No filesystem or remote preview support.
import type { DataCellKind } from "./data-table";

export type RichTableColumn = { key: string; label: string; type: DataCellKind };
export type RichTableSpec = { title?: string; columns: RichTableColumn[]; rows: unknown[][] };
const CELL_TYPES = new Set<DataCellKind>([
  "text",
  "number",
  "currency",
  "percent",
  "boolean",
  "date",
  "badge",
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseRichTableSpec(source: string): RichTableSpec | null {
  try {
    const value = asObject(JSON.parse(source));
    if (!value || !Array.isArray(value.columns)) return null;
    const columns = value.columns.map((entry) => {
      const column = asObject(entry);
      if (!column || typeof column.key !== "string") return null;
      const type =
        typeof column.type === "string" && CELL_TYPES.has(column.type as DataCellKind)
          ? (column.type as DataCellKind)
          : "text";
      return {
        key: column.key,
        label: typeof column.label === "string" ? column.label : column.key,
        type,
      };
    });
    if (columns.some((column) => !column)) return null;
    const typedColumns = columns as RichTableColumn[];
    const rows = (Array.isArray(value.rows) ? value.rows : []).map((entry) => {
      if (Array.isArray(entry)) return typedColumns.map((_, index) => entry[index]);
      const row = asObject(entry);
      return typedColumns.map((column) => row?.[column.key]);
    });
    return {
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      columns: typedColumns,
      rows,
    };
  } catch {
    return null;
  }
}
