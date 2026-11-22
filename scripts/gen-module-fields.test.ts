import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIELDS, parseFieldsSpec } from "./lib/gen-module-fields.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("gen-module fields parser", () => {
  it("returns default 4 fields when spec is omitted", () => {
    expect(parseFieldsSpec("")).toEqual(DEFAULT_FIELDS);
    expect(parseFieldsSpec(undefined)).toEqual(DEFAULT_FIELDS);
  });

  it("parses supported field types, enums, labels, and optional flag", () => {
    const parsed = parseFieldsSpec(
      "code:string:合同编号,amount:number:金额,qty:int:数量,kind:enum:采购|销售|框架:类型,signedAt:date:签约日期,active:boolean:有效,remark:text:备注?,codeHint:string",
    );
    expect(parsed).toEqual([
      { name: "code", type: "string", label: "合同编号", optional: false },
      { name: "amount", type: "number", label: "金额", optional: false },
      { name: "qty", type: "int", label: "数量", optional: false },
      {
        name: "kind",
        type: "enum",
        options: ["采购", "销售", "框架"],
        label: "类型",
        optional: false,
      },
      { name: "signedAt", type: "date", label: "签约日期", optional: false },
      { name: "active", type: "boolean", label: "有效", optional: false },
      { name: "remark", type: "text", label: "备注", optional: true },
      { name: "codeHint", type: "string", label: "codeHint", optional: false },
    ]);
  });

  it("rejects invalid field names, duplicates, reserved columns, and bad enums", () => {
    expect(() => parseFieldsSpec("1bad:string")).toThrow();
    expect(() => parseFieldsSpec("id:string:编号")).toThrow();
    expect(() => parseFieldsSpec("createdAt:date")).toThrow();
    expect(() => parseFieldsSpec("name:string,name:text")).toThrow();
    expect(() => parseFieldsSpec("kind:enum:唯一选项:类型")).toThrow();
    expect(() => parseFieldsSpec("foo:unknown")).toThrow();
  });
});

describe("gen-module dry-run mapping", () => {
  const runDry = (args: string[]) =>
    execFileSync("node", ["scripts/gen-module.mjs", ...args, "--dry-run"], {
      cwd: ROOT,
      encoding: "utf-8",
    });

  it("validates default fields and rich enum/date/combobox combinations in dry-run", () => {
    const basic = runDry(["qa-items", "--label", "测试台账", "--singular", "qa-item"]);
    expect(basic).toContain("Dry-run 通过");

    const rich = runDry([
      "agreements",
      "--label",
      "合同台账",
      "--singular",
      "agreement",
      "--fields",
      "code:string:合同编号,kind:enum:采购|销售|框架:合同类型,region:enum:华北|华东|华南|华中|西南|西北|东北:所属大区,status:enum:生效|归档:状态,signedAt:date:签约日期,amount:number:金额,active:boolean:有效,remark:text:备注?",
    ]);
    expect(rich).toContain("共 8 个字段");

    const numericOnly = runDry([
      "counters",
      "--label",
      "计数台账",
      "--singular",
      "counter",
      "--fields",
      "seq:int:序号,enabled:boolean:启用",
    ]);
    expect(numericOnly).toContain("共 2 个字段");
  });
});
