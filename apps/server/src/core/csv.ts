// Zero-dependency RFC 4180 CSV parser/serializer plus asset import validation.
import {
  assetInputSchema,
  type AssetImportPreview,
  type AssetImportRow,
  type AssetInput,
} from "@optimax-starter/api";

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * Parses CSV text into rows of cells.
 * - strips a leading UTF-8 BOM
 * - accepts CRLF, LF and lone CR line endings
 * - quoted cells may contain commas, newlines and doubled quotes ("")
 * - throws CsvParseError on an unclosed quote or stray characters after a closing quote
 * Fully empty lines are skipped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let quoteStartLine = 1;
  const pushRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "" && !quotedCell)) rows.push(row);
    row = [];
    cell = "";
    quotedCell = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          const next = text[i + 1];
          if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
            throw new CsvParseError(`第 ${line} 行引号后存在多余字符`, line);
          }
        }
      } else {
        if (ch === "\n") line++;
        else if (ch === "\r" && text[i + 1] !== "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell !== "") throw new CsvParseError(`第 ${line} 行引号位置无效`, line);
      inQuotes = true;
      quotedCell = true;
      quoteStartLine = line;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      quotedCell = false;
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      line++;
    } else if (ch === "\n") {
      pushRow();
      line++;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new CsvParseError(`第 ${quoteStartLine} 行引号未闭合`, quoteStartLine);
  if (cell !== "" || row.length > 0 || quotedCell) pushRow();
  return rows;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapes one cell; neutralises spreadsheet formula injection by prefixing a single quote. */
export function escapeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialises rows with CRLF line endings; `bom` prepends U+FEFF so Excel detects UTF-8. */
export function serializeCsv(rows: readonly (readonly unknown[])[], options: { bom?: boolean } = {}): string {
  const body = rows.map((r) => r.map(escapeCsvCell).join(",")).join("\r\n");
  return `${options.bom ? "﻿" : ""}${body}${rows.length ? "\r\n" : ""}`;
}

// ---------------------------------------------------------------------------
// Asset import
// ---------------------------------------------------------------------------
export type AssetField = keyof AssetInput;

const HEADER_ALIASES: Record<string, AssetField> = {
  资产名称: "name",
  名称: "name",
  name: "name",
  业务域: "domain",
  domain: "domain",
  责任团队: "owner",
  owner: "owner",
  登记状态: "stage",
  stage: "stage",
};

export const ASSET_CSV_HEADERS = ["名称", "业务域", "责任团队", "登记状态"] as const;
export const ASSET_IMPORT_TEMPLATE = `﻿${ASSET_CSV_HEADERS.join(",")}\r\n示例资产门户,采购,平台组,已登记\r\n`;

export function mapAssetHeaders(header: readonly string[]): {
  columns: (AssetField | null)[];
  errors: string[];
} {
  const columns = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? HEADER_ALIASES[h.trim()] ?? null);
  const errors: string[] = [];
  const seen = new Set<AssetField>();
  columns.forEach((col, idx) => {
    if (!col) return;
    if (seen.has(col)) errors.push(`表头「${header[idx]}」重复`);
    seen.add(col);
  });
  const labels: Record<AssetField, string> = {
    name: "名称",
    domain: "业务域",
    owner: "责任团队",
    stage: "登记状态",
  };
  for (const field of ["name", "domain", "owner", "stage"] as AssetField[]) {
    if (!seen.has(field)) errors.push(`缺少必填列「${labels[field]}」`);
  }
  return { columns, errors };
}

export type AssetCsvValidation = AssetImportPreview & {
  /** All valid, non-duplicate rows (not capped). */
  validRows: AssetInput[];
  /** Number of valid rows whose name already exists (in file or DB). */
  duplicateRows: AssetImportRow[];
};

export const PREVIEW_ROW_CAP = 200;

export function countCsvDataRows(csvText: string): number {
  const rows = parseCsv(csvText);
  return Math.max(0, rows.length - 1);
}

/**
 * Validates an asset CSV. Each data row is checked with assetInputSchema; names repeated within the
 * file (after the first occurrence) or already present in `existingNames` are marked duplicate.
 * Throws CsvParseError for malformed CSV, or a RangeError when the row count exceeds `maxRows`.
 */
export function validateAssetCsv(
  csvText: string,
  existingNames: ReadonlySet<string>,
  maxRows = 500,
): AssetCsvValidation {
  const parsed = parseCsv(csvText);
  const empty: AssetCsvValidation = {
    total: 0,
    validCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    rows: [],
    validRows: [],
    duplicateRows: [],
  };
  if (!parsed.length) return { ...empty, headerErrors: ["CSV 为空"] };
  const [header, ...data] = parsed;
  if (data.length > maxRows) {
    throw new RangeError(`CSV 共 ${data.length} 行，超过单次上限 ${maxRows} 行`);
  }
  const { columns, errors: headerErrors } = mapAssetHeaders(header!);
  if (headerErrors.length) return { ...empty, total: data.length, headerErrors };

  const seenInFile = new Set<string>();
  const all: AssetImportRow[] = [];
  const validRows: AssetInput[] = [];
  const duplicateRows: AssetImportRow[] = [];
  let errorCount = 0;
  data.forEach((cells, index) => {
    const raw: Record<AssetField, string> = { name: "", domain: "", owner: "", stage: "" };
    columns.forEach((col, i) => {
      if (col) raw[col] = (cells[i] ?? "").trim();
    });
    const result = assetInputSchema.safeParse(raw);
    const base: AssetImportRow = {
      row: index + 1,
      status: "valid",
      name: raw.name,
      domain: raw.domain,
      owner: raw.owner,
      stage: raw.stage,
      errors: [],
    };
    if (!result.success) {
      errorCount++;
      all.push({
        ...base,
        status: "invalid",
        errors: [...new Set(result.error.issues.map((issue) => issue.message))],
      });
      return;
    }
    const name = result.data.name;
    if (seenInFile.has(name)) {
      const dup: AssetImportRow = { ...base, status: "duplicate", errors: ["文件内资产名称重复"], duplicateOf: "file" };
      duplicateRows.push(dup);
      all.push(dup);
      return;
    }
    seenInFile.add(name);
    if (existingNames.has(name)) {
      const dup: AssetImportRow = { ...base, status: "duplicate", errors: ["资产名称已存在"], duplicateOf: "db" };
      duplicateRows.push(dup);
      all.push(dup);
      return;
    }
    validRows.push(result.data);
    all.push(base);
  });
  // Problem rows first so the capped preview always shows what needs fixing.
  const problems = all.filter((r) => r.status !== "valid");
  const fine = all.filter((r) => r.status === "valid");
  return {
    total: data.length,
    validCount: validRows.length,
    errorCount,
    duplicateCount: duplicateRows.length,
    rows: [...problems, ...fine].slice(0, PREVIEW_ROW_CAP),
    validRows,
    duplicateRows,
  };
}

/** Extracts the candidate asset names from a CSV (for the DB duplicate lookup). */
export function collectCsvNames(csvText: string): string[] {
  const parsed = parseCsv(csvText);
  if (parsed.length < 2) return [];
  const { columns } = mapAssetHeaders(parsed[0]!);
  const idx = columns.indexOf("name");
  if (idx < 0) return [];
  const names = new Set<string>();
  for (const cells of parsed.slice(1)) {
    const name = (cells[idx] ?? "").trim();
    if (name && name.length <= 80) names.add(name);
  }
  return [...names];
}
