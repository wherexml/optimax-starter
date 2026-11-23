// Sorting, filtering, row count and copy export adapted from Beautiful Pi Web RichDataTable (4a308ed, MIT, see LICENSE).
import { Check, Copy, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { copyText } from "./clipboard";
import {
  type DataTableData,
  dataCellSortValue,
  inferDataCellKind,
  tableToCsv,
  tableToTsv,
} from "./data-table";

type Sort = { column: number; direction: "asc" | "desc" };

export function RichDataTable({
  columns,
  rows,
  title,
  renderCell,
}: DataTableData & {
  title?: string;
  renderCell?: (value: string) => ReactNode;
}) {
  const [sort, setSort] = useState<Sort | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"tsv" | "csv" | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle
      ? rows.filter((row) => row.some((cell) => cell.toLocaleLowerCase().includes(needle)))
      : rows;
    if (!sort) return filtered;
    return filtered
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const a = dataCellSortValue(left.row[sort.column] ?? "", columns[sort.column]);
        const b = dataCellSortValue(right.row[sort.column] ?? "", columns[sort.column]);
        const comparison =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), "zh-CN", { numeric: true, sensitivity: "base" });
        return (comparison || left.index - right.index) * (sort.direction === "asc" ? 1 : -1);
      })
      .map(({ row }) => row);
  }, [columns, query, rows, sort]);

  if (!columns.length) return null;
  async function copy(format: "tsv" | "csv") {
    const table = { columns, rows: visible };
    if (await copyText(format === "tsv" ? tableToTsv(table) : tableToCsv(table))) {
      setCopied(format);
      window.setTimeout(() => setCopied(null), 1400);
    }
  }

  return (
    <section className="rich-data-table" aria-label={title || "数据表"}>
      <div className="rich-data-table-toolbar">
        {rows.length > 5 && (
          <label className="rich-data-table-filter">
            <Search size={13} aria-hidden="true" />
            <span className="sr-only">筛选表格</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选"
            />
          </label>
        )}
        <span className="rich-data-table-count">
          {visible.length === rows.length
            ? `${rows.length} 行`
            : `${visible.length} / ${rows.length} 行`}
        </span>
        <button
          type="button"
          className="rich-data-table-action"
          onClick={() => void copy("tsv")}
          aria-label="复制为 TSV"
        >
          {copied === "tsv" ? <Check size={13} /> : <Copy size={13} />}TSV
        </button>
        <button
          type="button"
          className="rich-data-table-action"
          onClick={() => void copy("csv")}
          aria-label="复制为 CSV"
        >
          {copied === "csv" ? <Check size={13} /> : <Copy size={13} />}CSV
        </button>
      </div>
      <div className="rich-data-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column, index) => {
                const direction = sort?.column === index ? sort.direction : null;
                return (
                  <th
                    key={index}
                    scope="col"
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) =>
                          current?.column === index
                            ? {
                                column: index,
                                direction: current.direction === "asc" ? "desc" : "asc",
                              }
                            : { column: index, direction: "asc" },
                        )
                      }
                    >
                      {column}
                      <span
                        className={
                          direction ? "rich-data-table-sort is-active" : "rich-data-table-sort"
                        }
                        aria-hidden="true"
                      >
                        {direction === "desc" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column, cellIndex) => {
                  const value = row[cellIndex] ?? "";
                  return (
                    <td key={cellIndex} data-cell-kind={inferDataCellKind(value, column)}>
                      <span>{renderCell ? renderCell(value) : value}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="rich-data-table-empty">没有匹配的行</p>}
      </div>
    </section>
  );
}
