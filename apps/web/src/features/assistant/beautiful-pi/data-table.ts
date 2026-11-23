// Adapted from Beautiful Pi Web (4a308ed) lib/data-table + lib/table-export; MIT notice in LICENSE.
// Pure display utilities.
export type DataCellKind =
  | "text"
  | "number"
  | "currency"
  | "percent"
  | "boolean"
  | "date"
  | "badge";

export interface DataTableData {
  columns: string[];
  rows: string[][];
}

interface HastTableNode {
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: HastTableNode[];
}

export const CITATION_HREF_PREFIX = "#agent-citation-";
const CITATION_HREF = /^#agent-citation-(E\d+)$/;

function hastNodeText(node: HastTableNode): string {
  if (typeof node.value === "string") return node.value;
  // Citation links keep their [[E1]] token so copy/sort stay plain text and the cell can re-render the pill.
  const citation =
    node.tagName === "a" && typeof node.properties?.href === "string"
      ? CITATION_HREF.exec(node.properties.href)?.[1]
      : undefined;
  if (citation) return `[[${citation}]]`;
  return (node.children ?? []).map(hastNodeText).join("").trim();
}

export function extractHastTable(node: unknown): DataTableData | null {
  const root = node as HastTableNode | undefined;
  if (!root?.children) return null;
  const tableRows: HastTableNode[] = [];
  const collectRows = (current: HastTableNode) => {
    if (current.tagName === "tr") tableRows.push(current);
    else for (const child of current.children ?? []) collectRows(child);
  };
  collectRows(root);
  const firstRow = tableRows[0];
  if (!firstRow) return null;

  const cells = (row: HastTableNode) =>
    (row.children ?? [])
      .filter((child) => child.tagName === "th" || child.tagName === "td")
      .map(hastNodeText);
  const firstCells = cells(firstRow);
  if (firstCells.length === 0) return null;
  const hasHeader = (firstRow.children ?? []).some((child) => child.tagName === "th");
  const columns = hasHeader ? firstCells : firstCells.map((_, index) => `第 ${index + 1} 列`);
  const rows = (hasHeader ? tableRows.slice(1) : tableRows).map((row) => {
    const rowCells = cells(row);
    return columns.map((_, index) => rowCells[index] ?? "");
  });
  return { columns, rows };
}

const STATUS_COLUMN_RE =
  /(?:^|\b)(status|state|stage|priority|health)(?:\b|$)|状态|阶段|优先级|结论|是否/i;
const CURRENCY_RE = /^\s*([+$£¥€]|[A-Z]{3}\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*[kmb])?\s*$/i;
const PERCENT_RE = /^\s*[+-]?\d[\d,]*(?:\.\d+)?%\s*$/;
const NUMBER_RE = /^\s*[+-]?\d[\d,]*(?:\.\d+)?\s*(?:个|项|条|次|份|家)?\s*$/;
const DATE_RE = /^\s*(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[T\s].*)?\s*$/;

export function inferDataCellKind(value: string, column = ""): DataCellKind {
  const normalized = value.trim();
  if (!normalized) return "text";
  if (STATUS_COLUMN_RE.test(column) && normalized.length <= 12) return "badge";
  if (/^(?:true|false|yes|no|是|否)$/i.test(normalized)) return "boolean";
  if (PERCENT_RE.test(normalized)) return "percent";
  if (CURRENCY_RE.test(normalized) && /[$£¥€]|^[A-Z]{3}\s/i.test(normalized)) {
    return "currency";
  }
  if (NUMBER_RE.test(normalized)) return "number";
  if (DATE_RE.test(normalized) && Number.isFinite(Date.parse(normalized))) return "date";
  return "text";
}

export function dataCellSortValue(value: string, column = ""): string | number {
  const kind = inferDataCellKind(value, column);
  if (kind === "number" || kind === "currency" || kind === "percent") {
    const suffix = value
      .trim()
      .match(/([kmb])$/i)?.[1]
      ?.toLowerCase();
    const multiplier =
      suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
    const parsed = Number(value.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed * multiplier : value.toLocaleLowerCase();
  }
  if (kind === "date") return Date.parse(value);
  if (kind === "boolean") return /^(?:true|yes|是)$/i.test(value.trim()) ? 1 : 0;
  return value.toLocaleLowerCase();
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function tableToCsv({ columns, rows }: DataTableData) {
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function tableToTsv({ columns, rows }: DataTableData) {
  return [columns, ...rows]
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}

export function tableToMarkdown({ columns, rows }: DataTableData) {
  const line = (row: string[]) =>
    `| ${row.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [line(columns), line(columns.map(() => "---")), ...rows.map(line)].join("\n");
}
