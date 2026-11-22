import { describe, expect, it } from "vitest";
import { escapeCsvCell, serializeCsv, type CsvColumn } from "./csv";

describe("csv export helpers", () => {
  it("escapes nullish values, quotes, commas, and newlines", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell("普通文本")).toBe("普通文本");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formula injection prefixes", () => {
    expect(escapeCsvCell("=CMD()")).toBe("'=CMD()");
    expect(escapeCsvCell("+1+1")).toBe("'+1+1");
    expect(escapeCsvCell("-1+1")).toBe("'-1+1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\tfoo")).toBe("'\tfoo");
    expect(escapeCsvCell("\rbar")).toBe('"\'\rbar"');
    expect(escapeCsvCell("=1,2")).toBe('"\'=1,2"');
  });

  it("serializes rows with UTF-8 BOM and CRLF line endings", () => {
    const rows = [
      { code: "AS-001", name: "采购门户,一期", count: 3 },
      { code: "AS-002", name: "=HYPERLINK(\"x\")", count: null },
    ];
    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: "编号", value: (r) => r.code },
      { header: "资产名称", value: (r) => r.name },
      { header: "数量", value: (r) => r.count },
    ];
    const out = serializeCsv(rows, columns);
    expect(out.startsWith("\uFEFF编号,资产名称,数量\r\n")).toBe(true);
    expect(out).toBe(
      '\uFEFF编号,资产名称,数量\r\nAS-001,"采购门户,一期",3\r\nAS-002,"\'=HYPERLINK(""x"")",',
    );
  });
});
