export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escapes a single CSV cell per RFC 4180 while neutralizing spreadsheet formula
 * injection prefixes (=, +, -, @, tab, CR).
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let str = String(raw);
  if (FORMULA_PREFIX.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes rows into UTF-8 BOM CSV with CRLF line endings for clean Excel / WPS import.
 */
export function serializeCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvCell(c.value(row))).join(","),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

export function downloadCsv<T>(
  filename: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): number {
  const csv = serializeCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}
