import { describe, expect, it } from "vitest";
import {
  ASSET_IMPORT_TEMPLATE,
  CsvParseError,
  collectCsvNames,
  escapeCsvCell,
  mapAssetHeaders,
  parseCsv,
  serializeCsv,
  validateAssetCsv,
} from "./csv";

describe("parseCsv", () => {
  it("strips BOM and handles CRLF / LF", () => {
    expect(parseCsv("﻿a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted commas, newlines and doubled quotes", () => {
    expect(parseCsv('name,note\r\n"A, B","line1\nline2"\r\n"say ""hi""",x\r\n')).toEqual([
      ["name", "note"],
      ["A, B", "line1\nline2"],
      ['say "hi"', "x"],
    ]);
  });

  it("keeps empty cells and skips blank lines", () => {
    expect(parseCsv("a,,c\n\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("detects unclosed quotes", () => {
    expect(() => parseCsv('a,b\n"open,1\n')).toThrow(CsvParseError);
  });

  it("rejects stray characters after a closing quote", () => {
    expect(() => parseCsv('"a"b,c')).toThrow(CsvParseError);
  });
});

describe("serializeCsv / escapeCsvCell", () => {
  it("quotes special characters and neutralises formulas", () => {
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-1")).toBe("'-1");
    expect(escapeCsvCell("@x")).toBe("'@x");
    expect(escapeCsvCell(null)).toBe("");
  });

  it("round-trips with BOM and CRLF", () => {
    const text = serializeCsv([["名称", "备注"], ["门户", "a\nb"]], { bom: true });
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(parseCsv(text)).toEqual([["名称", "备注"], ["门户", "a\nb"]]);
  });
});

describe("headers", () => {
  it("maps Chinese and English aliases", () => {
    expect(mapAssetHeaders(["资产名称", "业务域", "责任团队", "登记状态"]).columns).toEqual([
      "name",
      "domain",
      "owner",
      "stage",
    ]);
    expect(mapAssetHeaders(["Name", "DOMAIN", "owner", "stage", "extra"]).columns).toEqual([
      "name",
      "domain",
      "owner",
      "stage",
      null,
    ]);
  });

  it("reports missing and duplicate columns", () => {
    const { errors } = mapAssetHeaders(["名称", "name", "业务域"]);
    expect(errors.some((e) => e.includes("重复"))).toBe(true);
    expect(errors.some((e) => e.includes("责任团队"))).toBe(true);
    expect(errors.some((e) => e.includes("登记状态"))).toBe(true);
  });

  it("template parses into a valid row", () => {
    const v = validateAssetCsv(ASSET_IMPORT_TEMPLATE, new Set());
    expect(v.total).toBe(1);
    expect(v.validCount).toBe(1);
  });
});

describe("validateAssetCsv", () => {
  const csv = [
    "名称,业务域,责任团队,登记状态",
    "门户A,采购,平台组,已登记",
    "门户B,采购,平台组,未知状态",
    "门户A,采购,平台组,已登记",
    "已存在,财务,数据组,待复核",
    ",财务,数据组,待复核",
  ].join("\r\n");

  it("validates schema and tracks file / DB duplicates", () => {
    const v = validateAssetCsv(csv, new Set(["已存在"]));
    expect(v.total).toBe(5);
    expect(v.validCount).toBe(1);
    expect(v.errorCount).toBe(2);
    expect(v.duplicateCount).toBe(2);
    expect(v.validRows).toEqual([{ name: "门户A", domain: "采购", owner: "平台组", stage: "已登记" }]);
    const byRow = new Map(v.rows.map((r) => [r.row, r]));
    expect(byRow.get(2)?.status).toBe("invalid");
    expect(byRow.get(3)?.duplicateOf).toBe("file");
    expect(byRow.get(4)?.duplicateOf).toBe("db");
    expect(byRow.get(5)?.status).toBe("invalid");
    // Problem rows are listed first in the preview.
    expect(v.rows[0]!.status).not.toBe("valid");
  });

  it("enforces the row limit", () => {
    const big = ["name,domain,owner,stage", ...Array.from({ length: 6 }, (_, i) => `a${i},d,o,已登记`)].join("\n");
    expect(() => validateAssetCsv(big, new Set(), 5)).toThrow(RangeError);
  });

  it("returns header errors instead of rows", () => {
    const v = validateAssetCsv("foo,bar\n1,2", new Set());
    expect(v.headerErrors?.length).toBeGreaterThan(0);
    expect(v.validCount).toBe(0);
  });

  it("collects candidate names", () => {
    expect(collectCsvNames(csv).sort()).toEqual(["已存在", "门户A", "门户B"].sort());
  });
});
