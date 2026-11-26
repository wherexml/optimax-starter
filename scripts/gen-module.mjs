#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPrimaryField, parseFieldsSpec, toSnakeCase } from "./lib/gen-module-fields.mjs";

const ROOT = process.env.STARTER_GEN_ROOT
  ? path.resolve(process.env.STARTER_GEN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESERVED = new Set([
  "auth",
  "accounts",
  "audit",
  "assets",
  "permissions",
  "system",
  "settings",
  "login",
  "demo",
  "console",
  "healthz",
  "contracts",
  "agent",
  "assistant",
]);

function usage() {
  console.log(`用法:
  bun run gen:module <slug> --label <中文模块名> [--singular <单数英文名>] [--code-prefix <编码前缀>] [--detail drawer|page] [--fields "<字段声明>"] [--dry-run]

字段语法（可选，省略时生成 name/category/owner/status 默认 4 字段）:
  <name>:<type>[:<中文标签>][?] ，多字段用英文逗号分隔；末尾 ? 表示可选
  支持类型: string | text | int | number | boolean | date | enum:选项A|选项B

详情承载模式（--detail）:
  drawer  默认值，列表页右侧抽屉（仅限 <= 10 个只读/轻交互字段的记录速览）
  page    独立详情页（/<slug>/$id），适用于大图可视化、多维分析或复杂关联流程

示例:
  bun run gen:module vendors --label 供应商台账 --singular vendor --code-prefix VND
  bun run gen:module contracts --label 合同台账 --singular contract --detail page \\
    --fields "code:string:合同编号,amount:number:金额,qty:int:数量,kind:enum:采购|销售:类型,signedAt:date:签约日期,active:boolean:有效,remark:text:备注?"

生成内容:
  1. packages/db/src/schema/<slug>.ts         Drizzle 数据表定义并注册到 schema/index.ts
  2. packages/api/src/<slug>.ts               前后端共享 Zod 契约与 URL 筛选解析器
  3. apps/server/src/modules/<slug>.ts        Hono 链式分页筛选 + 单条读取 + 管理员 CRUD + 同事务审计路由
  4. apps/web/src/features/<slug>/*           ResourceTableSlot 列表页 + FormDialog + 详情抽屉或独立详情页 + CSV 导出
  5. apps/web/src/routes/<slug>*.tsx          TanStack Router 路由并注册侧栏 / Cmd+K 导航
  6. apps/server/src/agent/<slug>-tools.ts    AI 智能助理查询/汇总/审批创建工具（未裁剪助理时自动生成）
  7. scripts/verify-<slug>.py                 接口级权限、分页与审计闭环 E2E 脚本`);
}

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const slug = args[0];
let label = "";
let singular = "";
let codePrefixArg = "";
let fieldsSpec = "";
let detailMode = "drawer";
let dryRun = false;

for (let i = 1; i < args.length; i += 1) {
  if (args[i] === "--label") {
    label = args[++i] ?? "";
  } else if (args[i] === "--singular") {
    singular = args[++i] ?? "";
  } else if (args[i] === "--code-prefix") {
    codePrefixArg = args[++i] ?? "";
  } else if (args[i] === "--fields") {
    fieldsSpec = args[++i] ?? "";
  } else if (args[i] === "--detail") {
    detailMode = args[++i] ?? "";
  } else if (args[i] === "--dry-run") {
    dryRun = true;
  } else {
    throw new Error(`未知参数: ${args[i]}`);
  }
}

if (!/^[a-z][a-z0-9-]{1,28}$/.test(slug) || RESERVED.has(slug)) {
  throw new Error(`无效或保留的模块标识: ${slug}`);
}
if (!label.trim()) {
  throw new Error("请通过 --label 提供中文模块名称，例如 --label 供应商台账");
}
if (codePrefixArg && !/^[A-Z][A-Z0-9]{1,7}$/.test(codePrefixArg.trim())) {
  throw new Error(`无效的编码前缀: ${codePrefixArg}（需为 2-8 位大写字母或数字，以字母开头）`);
}
if (detailMode !== "drawer" && detailMode !== "page") {
  throw new Error(`无效的详情模式: ${detailMode}（仅支持 drawer 或 page）`);
}
label = label.trim();

const fields = parseFieldsSpec(fieldsSpec);
const primaryField = getPrimaryField(fields);
const primaryUnique = primaryField.type !== "boolean";
const enumFields = fields.filter((f) => f.type === "enum");
const multiEnumFields = enumFields.filter((f) => f.options.length >= 3);
const singleEnumFields = enumFields.filter((f) => f.options.length < 3);
const comboboxEnumFields = enumFields.filter((f) => f.options.length > 6);
const selectEnumFields = enumFields.filter((f) => f.options.length <= 6);
const dateFields = fields.filter((f) => f.type === "date");
const primaryEnum = enumFields[0] ?? null;
const searchField =
  primaryField.type === "string" || primaryField.type === "text"
    ? primaryField
    : (fields.find((f) => f.type === "string" || f.type === "text") ?? null);
const categoryField = fields.find((f) => f.name === "category" || f.name === "domain") ?? null;
const ownerField =
  fields.find((f) => f.name === "owner" || f.name === "assignee" || f.name === "manager") ?? null;
const booleanField = fields.find((f) => f.type === "boolean") ?? null;

const singularSlug = (singular.trim() || (slug.endsWith("s") ? slug.slice(0, -1) : slug)).replace(
  /-/g,
  "_",
);
const tableIdent = slug.replace(/-/g, "_");
const camel = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pascal = camel.slice(0, 1).toUpperCase() + camel.slice(1);
const singularPascal = singularSlug
  .split("_")
  .map((s) => s.slice(0, 1).toUpperCase() + s.slice(1))
  .join("");
const codePrefix = codePrefixArg.trim() || singularSlug.slice(0, 2).toUpperCase();
const agentPresent = existsSync(path.join(ROOT, "apps/server/src/agent/registry.ts"));

function toPascal(name) {
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

function enumConstName(field) {
  if (field.name === "status") {
    return `${singularPascal.toUpperCase()}_STATUSES`;
  }
  return `${singularPascal.toUpperCase()}_${toSnakeCase(field.name).toUpperCase()}_OPTIONS`;
}

function enumTypeName(field) {
  if (field.name === "status") {
    return `${singularPascal}Status`;
  }
  return `${singularPascal}${toPascal(field.name)}`;
}

function stringMaxLen(field) {
  if (field.name === "category") return 40;
  if (field.name === "owner") return 60;
  if (field.name === "name") return 80;
  return 120;
}

function buildDbSchemaContent() {
  const drizzleImports = new Set(["pgTable", "serial", "timestamp"]);
  const columns = [];
  for (const field of fields) {
    const colName = toSnakeCase(field.name);
    let colExpr = "";
    if (field.type === "int") {
      drizzleImports.add("integer");
      colExpr = `integer(${JSON.stringify(colName)})`;
    } else if (field.type === "number") {
      drizzleImports.add("doublePrecision");
      colExpr = `doublePrecision(${JSON.stringify(colName)})`;
    } else if (field.type === "boolean") {
      drizzleImports.add("boolean");
      colExpr = `boolean(${JSON.stringify(colName)})`;
    } else {
      drizzleImports.add("text");
      colExpr = `text(${JSON.stringify(colName)})`;
    }
    if (!field.optional) {
      colExpr += ".notNull()";
    }
    if (field === primaryField && primaryUnique) {
      colExpr += ".unique()";
    }
    if (!field.optional && field.type === "enum") {
      colExpr += `.default(${JSON.stringify(field.options[0])})`;
    }
    if (!field.optional && field.type === "boolean") {
      colExpr += ".default(false)";
    }
    columns.push(`  ${field.name}: ${colExpr},`);
  }

  const importList = [...drizzleImports].sort().join(", ");
  return `import { ${importList} } from "drizzle-orm/pg-core";

export const ${camel}Table = pgTable("console_${tableIdent}", {
  id: serial("id").primaryKey(),
${columns.join("\n")}
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
`;
}

function buildApiContractContent() {
  const enumDefs = enumFields
    .map(
      (f) =>
        `export const ${enumConstName(f)} = ${JSON.stringify(f.options)} as const;\nexport type ${enumTypeName(f)} = (typeof ${enumConstName(f)})[number];`,
    )
    .join("\n\n");

  const recordFields = fields
    .map((f) => {
      let base = "string";
      if (f.type === "int" || f.type === "number") base = "number";
      else if (f.type === "boolean") base = "boolean";
      return `  ${f.name}: ${base}${f.optional ? " | null" : ""};`;
    })
    .join("\n");

  const searchLines = [];
  if (searchField) {
    searchLines.push("  q?: string;");
    searchLines.push('  qOp?: "contains" | "equals";');
  }
  for (const f of enumFields) {
    if (f.options.length >= 3) {
      searchLines.push(`  ${f.name}?: ${enumTypeName(f)} | ${enumTypeName(f)}[];`);
    } else {
      searchLines.push(`  ${f.name}?: ${enumTypeName(f)};`);
    }
  }
  for (const f of dateFields) {
    searchLines.push(`  ${f.name}From?: string;`);
    searchLines.push(`  ${f.name}To?: string;`);
  }
  searchLines.push("  page?: number;");
  searchLines.push("  size?: number;");

  const schemaFields = fields
    .map((f) => {
      if (f.type === "enum") {
        const expr = `z.enum(${enumConstName(f)})`;
        return `    ${f.name}: ${f.optional ? `${expr}.nullish()` : expr},`;
      }
      if (f.type === "boolean") {
        const expr = "z.boolean()";
        return `    ${f.name}: ${f.optional ? `${expr}.nullish()` : expr},`;
      }
      if (f.type === "int") {
        if (f.optional) {
          return `    ${f.name}: z.number({ message: ${JSON.stringify(`${f.label}须为整数`)} }).int(${JSON.stringify(`${f.label}须为整数`)}).nullish(),`;
        }
        return `    ${f.name}: z.number({ message: ${JSON.stringify(`请输入${f.label}`)} }).int(${JSON.stringify(`${f.label}须为整数`)}),`;
      }
      if (f.type === "number") {
        if (f.optional) {
          return `    ${f.name}: z.number({ message: ${JSON.stringify(`${f.label}须为有效数字`)} }).finite(${JSON.stringify(`${f.label}须为有效数字`)}).nullish(),`;
        }
        return `    ${f.name}: z.number({ message: ${JSON.stringify(`请输入${f.label}`)} }).finite(${JSON.stringify(`请输入有效${f.label}`)}),`;
      }
      if (f.type === "date") {
        if (f.optional) {
          return `    ${f.name}: z.string().trim().refine((v) => v === "" || /^\\d{4}-\\d{2}-\\d{2}$/.test(v), ${JSON.stringify(`${f.label}格式应为 YYYY-MM-DD`)}).nullish(),`;
        }
        return `    ${f.name}: z.string().trim().regex(/^\\d{4}-\\d{2}-\\d{2}$/, ${JSON.stringify(`请选择有效${f.label}`)}),`;
      }
      if (f.type === "text") {
        if (f.optional) {
          return `    ${f.name}: z.string().trim().max(1000, ${JSON.stringify(`${f.label}最多 1000 个字符`)}).nullish(),`;
        }
        return `    ${f.name}: z.string().trim().min(1, ${JSON.stringify(`请输入${f.label}`)}).max(1000, ${JSON.stringify(`${f.label}最多 1000 个字符`)}),`;
      }
      const maxLen = stringMaxLen(f);
      if (f.optional) {
        return `    ${f.name}: z.string().trim().max(${maxLen}, ${JSON.stringify(`${f.label}最多 ${maxLen} 个字符`)}).nullish(),`;
      }
      return `    ${f.name}: z.string().trim().min(1, ${JSON.stringify(`请输入${f.label}`)}).max(${maxLen}, ${JSON.stringify(`${f.label}最多 ${maxLen} 个字符`)}),`;
    })
    .join("\n");

  const searchHelpers = [];
  if (multiEnumFields.length > 0) {
    searchHelpers.push(`function parseEnumList<const T extends readonly string[]>(
  raw: unknown,
  allowed: T,
): T[number] | T[number][] | undefined {
  const input = Array.isArray(raw) ? raw.slice(0, 100) : [raw];
  const out = new Set<T[number]>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (allowed.includes(trimmed)) out.add(trimmed as T[number]);
    if (out.size >= 20) break;
  }
  const sorted = [...out].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return sorted.length === 0 ? undefined : sorted.length === 1 ? sorted[0] : sorted;
}`);
  }
  if (dateFields.length > 0) {
    searchHelpers.push(`const DAY_RE = /^\\d{4}-\\d{2}-\\d{2}$/;

function parseDayParam(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !DAY_RE.test(raw)) return undefined;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d
    ? raw
    : undefined;
}`);
  }

  const searchParserLines = [];
  if (searchField) {
    searchParserLines.push(
      '  const q = typeof v.q === "string" && v.q.trim() && v.q.length <= 200 ? v.q : undefined;',
    );
  }
  for (const f of enumFields) {
    if (f.options.length >= 3) {
      searchParserLines.push(
        `  const enum_${f.name} = parseEnumList(v.${f.name}, ${enumConstName(f)});`,
      );
    } else {
      searchParserLines.push(
        `  const enum_${f.name} = typeof v.${f.name} === "string" && (${enumConstName(f)} as readonly string[]).includes(v.${f.name}) ? (v.${f.name} as ${enumTypeName(f)}) : undefined;`,
      );
    }
  }
  for (const f of dateFields) {
    searchParserLines.push(`  const rawFrom_${f.name} = parseDayParam(v.${f.name}From);`);
    searchParserLines.push(`  const rawTo_${f.name} = parseDayParam(v.${f.name}To);`);
    searchParserLines.push(
      `  const validRange_${f.name} = !(rawFrom_${f.name} && rawTo_${f.name} && rawTo_${f.name} < rawFrom_${f.name});`,
    );
    searchParserLines.push(
      `  const from_${f.name} = validRange_${f.name} ? rawFrom_${f.name} : undefined;`,
    );
    searchParserLines.push(
      `  const to_${f.name} = validRange_${f.name} ? rawTo_${f.name} : undefined;`,
    );
  }
  searchParserLines.push("  const page = Number(v.page);");
  searchParserLines.push("  const size = Number(v.size);");
  searchParserLines.push("  return {");
  if (searchField) {
    searchParserLines.push("    ...(q ? { q } : {}),");
    searchParserLines.push('    ...(q && v.qOp === "equals" ? { qOp: "equals" as const } : {}),');
  }
  for (const f of enumFields) {
    searchParserLines.push(`    ...(enum_${f.name} ? { ${f.name}: enum_${f.name} } : {}),`);
  }
  for (const f of dateFields) {
    searchParserLines.push(`    ...(from_${f.name} ? { ${f.name}From: from_${f.name} } : {}),`);
    searchParserLines.push(`    ...(to_${f.name} ? { ${f.name}To: to_${f.name} } : {}),`);
  }
  searchParserLines.push("    ...(Number.isInteger(page) && page > 1 ? { page } : {}),");
  searchParserLines.push("    ...(size === 50 || size === 100 ? { size } : {}),");
  searchParserLines.push("  };");

  return `import { z } from "zod";
import type { PaginatedResult } from "./contracts";

${enumDefs ? `${enumDefs}\n\n` : ""}export interface ${singularPascal}Record {
  id: number;
${recordFields}
  createdAt: string;
}

export type ${singularPascal}Page = PaginatedResult<${singularPascal}Record>;

export type ${singularPascal}Search = {
${searchLines.join("\n")}
};

export const ${camel}InputSchema = z
  .object({
${schemaFields}
  })
  .strict();
export type ${singularPascal}Input = z.infer<typeof ${camel}InputSchema>;

export const ${camel}PatchSchema = ${camel}InputSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
);

${searchHelpers.length ? `${searchHelpers.join("\n\n")}\n\n` : ""}export function parse${singularPascal}Search(v: Record<string, unknown>): ${singularPascal}Search {
${searchParserLines.join("\n")}
}
`;
}

function buildServerModuleContent() {
  const drizzleImports = new Set(["and", "count", "desc", "eq"]);
  if (searchField) drizzleImports.add("ilike");
  if (primaryUnique) drizzleImports.add("ne");
  if (multiEnumFields.length > 0) drizzleImports.add("inArray");
  if (dateFields.length > 0) {
    drizzleImports.add("gte");
    drizzleImports.add("lte");
  }

  const apiImports = [
    ...enumFields.map((f) => enumConstName(f)),
    `${camel}InputSchema`,
    `${camel}PatchSchema`,
  ];

  const optionalTextFields = fields.filter(
    (f) => f.optional && (f.type === "string" || f.type === "text" || f.type === "date"),
  );
  const needsContainsPattern = Boolean(searchField);
  const auditCoreImports = ["AUDIT_MAX_PAGE", "auditResource"];
  if (needsContainsPattern) auditCoreImports.push("containsPattern");

  const querySchemaLines = [];
  if (searchField) {
    querySchemaLines.push("  q: z.string().trim().min(1).max(200).optional(),");
    querySchemaLines.push('  qOp: z.enum(["contains", "equals"]).optional(),');
  }
  for (const f of singleEnumFields) {
    querySchemaLines.push(`  ${f.name}: z.enum(${enumConstName(f)}).optional(),`);
  }
  for (const f of dateFields) {
    querySchemaLines.push(`  ${f.name}From: dayParam.optional(),`);
    querySchemaLines.push(`  ${f.name}To: dayParam.optional(),`);
  }
  querySchemaLines.push("  page: z.coerce.number().int().min(1).max(100000).default(1),");
  querySchemaLines.push(
    "  size: z.coerce\n    .number()\n    .int()\n    .min(1)\n    .default(20)\n    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),",
  );

  const queryDestruct = [];
  if (searchField) queryDestruct.push("q", "qOp");
  for (const f of singleEnumFields) queryDestruct.push(f.name);
  for (const f of dateFields) queryDestruct.push(`${f.name}From`, `${f.name}To`);
  queryDestruct.push("page", "size");

  const whereParts = [];
  if (searchField) {
    whereParts.push(`      q
        ? qOp === "equals"
          ? eq(${camel}Table.${searchField.name}, q)
          : ilike(${camel}Table.${searchField.name}, containsPattern(q))
        : undefined,`);
  }
  for (const f of singleEnumFields) {
    whereParts.push(`      ${f.name} ? eq(${camel}Table.${f.name}, ${f.name}) : undefined,`);
  }
  for (const f of multiEnumFields) {
    whereParts.push(
      `      list_${f.name}.length ? inArray(${camel}Table.${f.name}, list_${f.name}) : undefined,`,
    );
  }
  for (const f of dateFields) {
    whereParts.push(
      `      ${f.name}From ? gte(${camel}Table.${f.name}, ${f.name}From) : undefined,`,
    );
    whereParts.push(`      ${f.name}To ? lte(${camel}Table.${f.name}, ${f.name}To) : undefined,`);
  }

  const extraHelpers = [];
  if (dateFields.length > 0) {
    extraHelpers.push(`const DAY_RE = /^\\d{4}-\\d{2}-\\d{2}$/;

function isValidDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

const dayParam = z.string().refine(isValidDay);`);
  }
  if (multiEnumFields.length > 0) {
    extraHelpers.push(`const MULTI_ENUM_KEYS = new Set(${JSON.stringify(multiEnumFields.map((f) => f.name))});

function normalizeListValues(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  const out: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const arr: unknown = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "string" && item.trim()) out.push(item.trim());
          }
          continue;
        }
      } catch {
        // Ignore invalid JSON and treat as plain value.
      }
    }
    out.push(trimmed);
  }
  return [...new Set(out)].slice(0, 20);
}`);
  }
  const extraHelperBlock = extraHelpers.length ? `${extraHelpers.join("\n\n")}\n\n` : "";

  const dateRangeChecks = dateFields
    .map(
      (f) =>
        `    if (${f.name}From && ${f.name}To && ${f.name}To < ${f.name}From) {\n      return c.json({ error: "筛选条件无效" }, 400);\n    }`,
    )
    .join("\n");
  const multiEnumChecks = multiEnumFields
    .map(
      (f) =>
        `    const list_${f.name} = normalizeListValues(c.req.queries(${JSON.stringify(f.name)}));\n    if (list_${f.name}.some((x) => !(${enumConstName(f)} as readonly string[]).includes(x))) {\n      return c.json({ error: "筛选条件无效" }, 400);\n    }`,
    )
    .join("\n");
  const rawQueryFilter = multiEnumFields.length
    ? 'Object.entries(c.req.query()).filter(([k, v]) => !MULTI_ENUM_KEYS.has(k) && v.trim() !== "")'
    : 'Object.entries(c.req.query()).filter(([, v]) => v.trim() !== "")';

  const normalizeHelper = optionalTextFields.length
    ? `const OPTIONAL_TEXT_KEYS = ${JSON.stringify(optionalTextFields.map((f) => f.name))} as const;

function normalizeOptionalText<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of OPTIONAL_TEXT_KEYS) {
    if (key in next && next[key] === "") next[key] = null;
  }
  return next as T;
}

`
    : "";

  const writePayloadExpr = optionalTextFields.length
    ? "normalizeOptionalText(parsed.data)"
    : "parsed.data";

  const createAuditDetailLines = [];
  if (primaryEnum) {
    createAuditDetailLines.push(`stage: row.${primaryEnum.name} ?? undefined,`);
  }
  if (categoryField) {
    createAuditDetailLines.push(`domain: row.${categoryField.name} ?? undefined,`);
  }
  if (!primaryEnum && !categoryField) {
    createAuditDetailLines.push("fields: Object.keys(parsed.data),");
  }

  const deleteAuditDetail = categoryField
    ? `{ domain: removed.${categoryField.name} ?? undefined }`
    : "{}";

  const conflictGuard = primaryUnique
    ? `if (!row) throw new Refusal(409, ${JSON.stringify(`${primaryField.label}已存在`)});`
    : `if (!row) throw new Refusal(500, "创建失败");`;

  const patchDupCheck = primaryUnique
    ? `        if (
          parsed.data.${primaryField.name} !== undefined &&
          parsed.data.${primaryField.name} !== null &&
          parsed.data.${primaryField.name} !== before.${primaryField.name}
        ) {
          const [dup] = await tx
            .select({ id: ${camel}Table.id })
            .from(${camel}Table)
            .where(
              and(
                eq(${camel}Table.${primaryField.name}, parsed.data.${primaryField.name}),
                ne(${camel}Table.id, id),
              ),
            );
          if (dup) throw new Refusal(409, ${JSON.stringify(`${primaryField.label}已存在`)});
        }
`
    : "";

  const whereBlock = whereParts.length
    ? `    const where = and(\n${whereParts.join("\n")}\n    );`
    : "";
  const whereClause = whereParts.length ? "\n        .where(where)" : "";
  const totalWhereClause = whereParts.length ? ".where(where)" : "";

  return `import { ${[...drizzleImports].sort().join(", ")} } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ${apiImports.join(",\n  ")},
} from "@optimax-starter/api/${slug}";
import { ${camel}Table } from "@optimax-starter/db/schema/${slug}";
import { db } from "../services";
import { ${auditCoreImports.join(", ")} } from "../core/audit";
import {
  Refusal,
  guarded,
  lockPermission,
  parsePositiveId,
  requirePermission,
  type Env,
} from "../core/guards";

${extraHelperBlock}const querySchema = z.object({
${querySchemaLines.join("\n")}
});

const toResource = (row: { id: number; ${primaryField.name}: unknown }) => ({
  id: row.id,
  code: \`${codePrefix}-\${String(row.id).padStart(3, "0")}\`,
  name: String(row.${primaryField.name} ?? row.id),
});

${normalizeHelper}export const ${camel}Routes = new Hono<Env>()
  .get("/${slug}", requirePermission("${slug}:read"), async (c) => {
    const raw = Object.fromEntries(
      ${rawQueryFilter},
    );
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
    const { ${queryDestruct.join(", ")} } = parsed.data;
${dateRangeChecks ? `${dateRangeChecks}\n` : ""}${multiEnumChecks ? `${multiEnumChecks}\n` : ""}${whereBlock ? `${whereBlock}\n` : ""}    const [items, totals] = await Promise.all([
      db
        .select()
        .from(${camel}Table)${whereClause}
        .orderBy(desc(${camel}Table.id))
        .limit(size)
        .offset((page - 1) * size),
      db.select({ n: count() }).from(${camel}Table)${totalWhereClause},
    ]);
    return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
  })
  .get("/${slug}/:id", requirePermission("${slug}:read"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return c.json({ error: "无效的编号" }, 400);
    const [row] = await db.select().from(${camel}Table).where(eq(${camel}Table.id, id));
    if (!row) return c.json({ error: "${label}记录不存在" }, 404);
    return c.json(row);
  })
  .post("/${slug}", requirePermission("${slug}:manage"), async (c) => {
    const parsed = ${camel}InputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "请完整填写${label}信息" }, 400);
    return guarded(c, async () => {
      const created = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, c.get("actor").id, "${slug}:manage");
        const [row] = await tx
          .insert(${camel}Table)
          .values(${writePayloadExpr})
          .onConflictDoNothing()
          .returning();
        ${conflictGuard}
        await auditResource(tx, "${singularSlug}.create", self, toResource(row), {
          ${createAuditDetailLines.join("\n          ")}
        });
        return row;
      });
      return c.json(created, 201);
    });
  })
  .patch("/${slug}/:id", requirePermission("${slug}:manage"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    const parsed = ${camel}PatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!id || !parsed.success) return c.json({ error: "无效的变更参数" }, 400);
    return guarded(c, async () => {
      const updated = await db.transaction(async (tx) => {
        const self = await lockPermission(tx, c.get("actor").id, "${slug}:manage");
        const [before] = await tx
          .select()
          .from(${camel}Table)
          .where(eq(${camel}Table.id, id))
          .for("update");
        if (!before) throw new Refusal(404, "记录不存在");
${patchDupCheck}        const [after] = await tx
          .update(${camel}Table)
          .set(${writePayloadExpr})
          .where(eq(${camel}Table.id, id))
          .returning();
        await auditResource(tx, "${singularSlug}.update", self, toResource(after!), {
          fields: Object.keys(parsed.data),
        });
        return after!;
      });
      return c.json(updated);
    });
  })
  .delete("/${slug}/:id", requirePermission("${slug}:manage"), async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return c.json({ error: "无效的编号" }, 400);
    return guarded(c, async () => {
      await db.transaction(async (tx) => {
        const self = await lockPermission(tx, c.get("actor").id, "${slug}:manage");
        const [removed] = await tx
          .delete(${camel}Table)
          .where(eq(${camel}Table.id, id))
          .returning();
        if (!removed) throw new Refusal(404, "记录不存在");
        await auditResource(
          tx,
          "${singularSlug}.delete",
          self,
          toResource(removed),
          ${deleteAuditDetail},
        );
      });
      return c.json({ ok: true });
    });
  });
`;
}

function buildFormDialogContent() {
  const hasString = fields.some((f) => f.type === "string");
  const hasText = fields.some((f) => f.type === "text");
  const hasInput = fields.some((f) => f.type === "number" || f.type === "date");
  const hasInt = fields.some((f) => f.type === "int");
  const hasSwitch = fields.some((f) => f.type === "boolean");
  const hasSelect = selectEnumFields.length > 0;
  const hasCombobox = comboboxEnumFields.length > 0;
  const focusField =
    fields.find(
      (f) =>
        f.type === "string" ||
        f.type === "text" ||
        f.type === "int" ||
        f.type === "number" ||
        f.type === "date",
    ) ?? null;

  const uiImports = [];
  if (hasCombobox) uiImports.push('import { Combobox } from "@/components/ui/combobox";');
  if (hasInput) uiImports.push('import { Input } from "@/components/ui/input";');
  if (hasString) uiImports.push('import { ClearableInput } from "@/components/ui/input-group";');
  if (hasInt) uiImports.push('import { NumberInput } from "@/components/ui/number-input";');
  if (hasSelect) {
    uiImports.push(`import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";`);
  }
  if (hasSwitch) uiImports.push('import { SwitchField } from "@/components/ui/switch";');
  if (hasText) uiImports.push('import { Textarea } from "@/components/ui/textarea";');

  const apiValueImports = [...enumFields.map((f) => enumConstName(f)), `${camel}InputSchema`];

  const defaultLines = fields
    .map((f) => {
      if (f.type === "enum") {
        const cName = enumConstName(f);
        if (f.optional) {
          return `      ${f.name}: record?.${f.name} && (${cName} as readonly string[]).includes(record.${f.name}) ? (record.${f.name} as (typeof ${cName})[number]) : undefined,`;
        }
        return `      ${f.name}: record?.${f.name} && (${cName} as readonly string[]).includes(record.${f.name}) ? (record.${f.name} as (typeof ${cName})[number]) : ${cName}[0],`;
      }
      if (f.type === "boolean") {
        return `      ${f.name}: record?.${f.name} ?? false,`;
      }
      if (f.type === "int" || f.type === "number") {
        return `      ${f.name}: record?.${f.name} ?? undefined,`;
      }
      return `      ${f.name}: record?.${f.name} ?? "",`;
    })
    .join("\n");

  const fieldBlocks = fields
    .map((f) => {
      const reqAttr = f.optional ? "" : " required";
      const autoFocusAttr = f === focusField ? "\n                    autoFocus" : "";
      if (f.type === "boolean") {
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormControl>
                  <SwitchField
                    label="${f.label}"
                    checked={Boolean(field.value)}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      if (f.type === "enum") {
        const cName = enumConstName(f);
        if (f.options.length > 6) {
          return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <Combobox
                    ref={field.ref}
                    label="${f.label}"
                    value={field.value ?? ""}
                    allowClear={${f.optional ? "true" : "false"}}
                    placeholder="请选择${f.label}"
                    searchPlaceholder="搜索${f.label}…"
                    options={${cName}.map((opt) => ({ value: opt, label: opt }))}
                    onValueChange={(v) => field.onChange(v || ${f.optional ? "(editing ? null : undefined)" : `${cName}[0]`})}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
        }
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <Select
                  value={field.value ?? ""}
                  onValueChange={(v) => field.onChange(v || ${f.optional ? "(editing ? null : undefined)" : `${cName}[0]`})}
                >
                  <FormControl>
                    <SelectTrigger aria-label="${f.label}">
                      <SelectValue${f.optional ? ` placeholder="请选择${f.label}"` : ""} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {${cName}.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      if (f.type === "text") {
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value ?? ""}
                    rows={3}${autoFocusAttr}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      if (f.type === "int") {
        const emptyVal = f.optional ? "(editing ? null : undefined)" : "undefined";
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <NumberInput
                    ref={field.ref}
                    name={field.name}
                    label="${f.label}"
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v === "" ? ${emptyVal} : v)}
                    onBlur={field.onBlur}${autoFocusAttr}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      if (f.type === "number") {
        const emptyVal = f.optional ? "(editing ? null : undefined)" : "undefined";
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <Input
                    ref={field.ref}
                    name={field.name}
                    type="number"
                    step="any"
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      field.onChange(raw === "" ? ${emptyVal} : Number(raw));
                    }}
                    onBlur={field.onBlur}${autoFocusAttr}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      if (f.type === "date") {
        return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    value={field.value ?? ""}${autoFocusAttr}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
      }
      return `          <FormField
            control={form.control}
            name="${f.name}"
            render={({ field }) => (
              <FormItem>
                <FormLabel${reqAttr}>${f.label}</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    value={field.value ?? ""}
                    autoComplete="off"${autoFocusAttr}
                    onClear={() => form.setValue("${f.name}", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />`;
    })
    .join("\n");

  const keepEditingFocus = focusField
    ? `\n                form.setFocus("${focusField.name}");`
    : "";

  return `import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ${apiValueImports.join(",\n  ")},
  type ${singularPascal}Input,
  type ${singularPascal}Record,
} from "@optimax-starter/api/${slug}";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
${uiImports.join("\n")}
import { request } from "@/console-client";

export function ${pascal}FormDialog({
  record,
  close,
  trigger,
}: {
  record?: ${singularPascal}Record;
  close: (message?: string) => void;
  trigger: HTMLElement | null;
}) {
  const editing = Boolean(record);
  const form = useForm<${singularPascal}Input>({
    resolver: zodResolver(${camel}InputSchema),
    defaultValues: {
${defaultLines}
    },
  });
  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (values: ${singularPascal}Input) =>
      editing
        ? request(\`/${slug}/\${record!.id}\`, "PATCH", values)
        : request("/${slug}", "POST", values),
    onSuccess: async (_data, values) => {
      await cache.invalidateQueries({ queryKey: ["${slug}"] });
      const title = String(values.${primaryField.name} ?? record?.${primaryField.name} ?? "").trim();
      close(editing ? \`已更新 \${title}\` : \`已新增 \${title}\`);
    },
    onError: (err) =>
      form.setError(err.message.includes("已存在") ? "${primaryField.name}" : "root", {
        message: err.message,
      }),
  });

  return (
    <FormDialog
      open
      title={editing ? "编辑${label}" : "新增${label}"}
      size="md"
      submitText={editing ? "保存修改" : "保存"}
      loading={save.isPending}
      formId="${slug}-form"
      unsaved={
        confirming
          ? {
              onKeepEditing: () => {
                setConfirming(false);${keepEditingFocus}
              },
              onDiscard: () => close(),
              discardText: "放弃改动",
            }
          : null
      }
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (open || save.isPending) return;
        if (confirming) setConfirming(false);
        else if (isDirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="${slug}-form"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="grid gap-4 sm:grid-cols-2"
        >
${fieldBlocks}
          {form.formState.errors.root?.message && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {form.formState.errors.root.message}
            </p>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
`;
}

function buildWebPageContent() {
  const apiImports = [
    ...enumFields.map((f) => enumConstName(f)),
    `parse${singularPascal}Search`,
    `type ${singularPascal}Page`,
    `type ${singularPascal}Record`,
  ];

  const hasBadge = fields.some((f) => f.type === "enum" || f.type === "boolean");
  const filterFields = [];
  const filterStateLines = [];
  for (const f of fields) {
    if (f === searchField) {
      filterFields.push(`  {
    key: "q",
    label: "${f.label}",
    type: "text",
    ariaLabel: "搜索${f.label}",
    placeholder: "搜索${f.label}",
    operatorKey: "qOp",
  }`);
      filterStateLines.push("    q: params.q,");
      filterStateLines.push("    qOp: params.qOp,");
    } else if (f.type === "enum") {
      const multiLine = f.options.length >= 3 ? "\n    multi: true," : "";
      filterFields.push(`  {
    key: "${f.name}",
    label: "${f.label}",
    type: "select",${multiLine}
    options: ${enumConstName(f)}.map((v) => ({ value: v, label: v })),
  }`);
      filterStateLines.push(`    ${f.name}: params.${f.name},`);
    } else if (f.type === "date") {
      filterFields.push(`  {
    key: "${f.name}From",
    label: "${f.label}起",
    type: "date",
    notAfter: "${f.name}To",
  }`);
      filterFields.push(`  {
    key: "${f.name}To",
    label: "${f.label}止",
    type: "date",
    notBefore: "${f.name}From",
  }`);
      filterStateLines.push(`    ${f.name}From: params.${f.name}From,`);
      filterStateLines.push(`    ${f.name}To: params.${f.name}To,`);
    }
  }

  const columnBlocks = fields.map((f) => {
    if (f === primaryField) {
      return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => <span className="font-medium">{String(c.getValue() ?? "—")}</span>,
      }`;
    }
    if (f.type === "enum") {
      return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => {
          const val = c.getValue();
          if (!val) return <span className="text-muted-foreground">—</span>;
          return (
            <Badge variant={val === ${JSON.stringify(f.options[0])} ? "brand" : "neutral"}>
              {String(val)}
            </Badge>
          );
        },
      }`;
    }
    if (f.type === "boolean") {
      return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => {
          const val = c.getValue();
          if (val === null || val === undefined) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Badge variant={val ? "brand" : "neutral"}>{val ? "是" : "否"}</Badge>
          );
        },
      }`;
    }
    if (f.type === "int" || f.type === "number" || f.type === "date") {
      return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => {
          const val = c.getValue();
          return (
            <span className="font-mono text-xs tabular-nums">
              {val === null || val === undefined || val === "" ? "—" : String(val)}
            </span>
          );
        },
      }`;
    }
    if (f.type === "text") {
      return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => {
          const val = c.getValue();
          return (
            <span className="block max-w-[220px] truncate">
              {val ? String(val) : "—"}
            </span>
          );
        },
      }`;
    }
    return `      {
        accessorKey: "${f.name}",
        header: "${f.label}",
        enableSorting: false,
        cell: (c) => {
          const val = c.getValue();
          return <span>{val ? String(val) : "—"}</span>;
        },
      }`;
  });

  const csvColumns = fields
    .map((f) => {
      if (f.type === "boolean") {
        return `              {
                header: "${f.label}",
                value: (r) =>
                  r.${f.name} === null || r.${f.name} === undefined
                    ? ""
                    : r.${f.name}
                      ? "是"
                      : "否",
              },`;
      }
      return `              { header: "${f.label}", value: (r) => r.${f.name} ?? "" },`;
    })
    .join("\n");

  const detailFields = fields
    .map((f) => {
      if (f.type === "boolean") {
        return `            <DetailField label="${f.label}">
              {detailRow.${f.name} === null || detailRow.${f.name} === undefined
                ? "—"
                : detailRow.${f.name}
                  ? "是"
                  : "否"}
            </DetailField>`;
      }
      if (f.type === "int" || f.type === "number") {
        return `            <DetailField label="${f.label}">
              <span className="font-mono text-xs tabular-nums">
                {detailRow.${f.name} === null || detailRow.${f.name} === undefined
                  ? "—"
                  : String(detailRow.${f.name})}
              </span>
            </DetailField>`;
      }
      if (f.type === "date") {
        return `            <DetailField label="${f.label}">
              <span className="font-mono text-xs tabular-nums">
                {detailRow.${f.name} ? String(detailRow.${f.name}) : "—"}
              </span>
            </DetailField>`;
      }
      const fullWidthAttr = f.type === "text" ? " fullWidth" : "";
      return `            <DetailField label="${f.label}"${fullWidthAttr}>
              {detailRow.${f.name} ? String(detailRow.${f.name}) : "—"}
            </DetailField>`;
    })
    .join("\n");

  const badgeImport = hasBadge ? 'import { Badge } from "@/components/ui/badge";\n' : "";
  const isPageDetail = detailMode === "page";
  const detailDrawerImport = isPageDetail
    ? ""
    : `import {
  DetailDrawer,
  DetailField,
  DetailSection,
} from "@/components/ui/detail-drawer";\n`;

  const stateDecl = isPageDetail
    ? ""
    : `\n  const [detailRow, setDetailRow] = useState<${singularPascal}Record | null>(null);`;
  const detailRefDecl = isPageDetail
    ? ""
    : "\n  const returnToDetailRef = useRef<number | null>(null);";
  const activeDetailBlock = isPageDetail
    ? ""
    : `\n  const activeDetailRow = detailRow
    ? (currentItems.find((r) => r.id === detailRow.id) ?? detailRow)
    : null;
  const detailIndex = activeDetailRow
    ? currentItems.findIndex((r) => r.id === activeDetailRow.id)
    : -1;`;
  const detailClickHandler = isPageDetail
    ? `void navigate({
                    to: "/${slug}/$id",
                    params: { id: String(row.id) },
                    search: params,
                  });`
    : `returnFocus.current = e.currentTarget;
                  setDetailRow(row);`;
  const rowClickHandler = isPageDetail
    ? `void navigate({
          to: "/${slug}/$id",
          params: { id: String(row.id) },
          search: params,
        });`
    : `returnFocus.current = null;
        setDetailRow(row);`;
  const editCloseBlock = isPageDetail
    ? `close={(msg) => {
            setPending(null);
            if (msg) toast.success(msg);
          }}`
    : `close={(msg) => {
            const backId = returnToDetailRef.current;
            returnToDetailRef.current = null;
            const fallbackRow = pending.row;
            setPending(null);
            if (msg) toast.success(msg);
            if (backId !== null) {
              const latest = currentItems.find((r) => r.id === backId) ?? fallbackRow;
              setDetailRow(latest);
            }
          }}`;
  const deleteCloseBlock = isPageDetail
    ? `close={async (done) => {
            const name = String(pending.row.${primaryField.name} ?? pending.row.id);
            setPending(null);
            if (done) {
              await cache.invalidateQueries({ queryKey: ["${slug}"] });
              toast.success(\`已删除 \${name}\`);
            }
          }}`
    : `close={async (done) => {
            const targetRow = pending.row;
            const backId = returnToDetailRef.current;
            returnToDetailRef.current = null;
            const name = String(targetRow.${primaryField.name} ?? targetRow.id);
            setPending(null);
            if (done) {
              await cache.invalidateQueries({ queryKey: ["${slug}"] });
              toast.success(\`已删除 \${name}\`);
            } else if (backId !== null) {
              const latest = currentItems.find((r) => r.id === backId) ?? targetRow;
              setDetailRow(latest);
            }
          }}`;
  const drawerJsx = isPageDetail
    ? ""
    : `\n      <DetailDrawer
        open={Boolean(activeDetailRow)}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
        title={
          activeDetailRow
            ? String(activeDetailRow.${primaryField.name} ?? "${label}详情")
            : "${label}详情"
        }
        description={
          activeDetailRow
            ? \`${codePrefix}-\${String(activeDetailRow.id).padStart(3, "0")}\`
            : undefined
        }
        actions={
          canManage && activeDetailRow ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  returnToDetailRef.current = activeDetailRow.id;
                  setDetailRow(null);
                  setPending({ kind: "edit", row: activeDetailRow });
                }}
              >
                编辑
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  returnToDetailRef.current = activeDetailRow.id;
                  setDetailRow(null);
                  setPending({ kind: "delete", row: activeDetailRow });
                }}
              >
                删除
              </Button>
            </>
          ) : undefined
        }
        navigation={
          detailIndex >= 0
            ? {
                hasPrev: detailIndex > 0,
                hasNext: detailIndex < currentItems.length - 1,
                current: detailIndex + 1,
                total: currentItems.length,
                onPrev: () => {
                  const prev = currentItems[detailIndex - 1];
                  if (prev) setDetailRow(prev);
                },
                onNext: () => {
                  const next = currentItems[detailIndex + 1];
                  if (next) setDetailRow(next);
                },
              }
            : undefined
        }
        onCloseAutoFocus={(e) => {
          if (returnFocus.current?.isConnected) {
            e.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        {activeDetailRow && (
          <DetailSection title="记录详情">
${detailFields}
            <DetailField label="创建时间">
              <span className="font-mono text-xs tabular-nums">
                {activeDetailRow.createdAt}
              </span>
            </DetailField>
          </DetailSection>
        )}
      </DetailDrawer>`;

  return `import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  ${apiImports.join(",\n  ")},
} from "@optimax-starter/api/${slug}";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { TableExportMenu } from "@/components/table/TableExportMenu";
${badgeImport}import { Button } from "@/components/ui/button";
${detailDrawerImport}import { toast } from "@/components/ui/toast";
import { storageKey } from "@/config/app-config";
import { request } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import type { Filters } from "@/hooks/usePersistedFilters";
import { downloadCsv } from "@/lib/csv";
import { ${pascal}FormDialog } from "./${pascal}FormDialog";

const route = getRouteApi("/${slug}");
const SIZES = [20, 50, 100];

const FIELDS: FilterField[] = [
${filterFields.join(",\n")}
];

export function ${pascal}Page() {
  const me = useAccount();
  const cache = useQueryClient();
  const canRead = hasPermission(me.data, "${slug}:read");
  const canManage = hasPermission(me.data, "${slug}:manage");
  const params = route.useSearch();
  const navigate = route.useNavigate();
  const page = params.page ?? 1;
  const size = params.size ?? SIZES[0]!;
  const [pending, setPending] = useState<
    { kind: "create" } | { kind: "edit" | "delete"; row: ${singularPascal}Record } | null
  >(null);${stateDecl}
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);${detailRefDecl}

  const filters: Filters = {
${filterStateLines.join("\n")}
  };

  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["${slug}", params],
    queryFn: () => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...filters, page, size })) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) {
            if (String(item) !== "") qs.append(k, String(item));
          }
          continue;
        }
        if (String(v) !== "") qs.set(k, String(v));
      }
      return request<${singularPascal}Page>(\`/${slug}?\${qs.toString()}\`);
    },
    enabled: Boolean(me.data) && canRead,
    placeholderData: keepPreviousData,
  });

  const currentItems = query.data?.items ?? [];${activeDetailBlock}

  const columns = useMemo<ColumnDef<${singularPascal}Record>[]>(() => {
    const base: ColumnDef<${singularPascal}Record>[] = [
      {
        accessorKey: "id",
        header: "编号",
        enableSorting: false,
        cell: (c) => (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            ${codePrefix}-{String(c.getValue()).padStart(3, "0")}
          </span>
        ),
      },
${columnBlocks.join(",\n")},
    ];
    return [
      ...base,
      {
        id: "action",
        header: "操作",
        enableSorting: false,
        cell: (c) => {
          const row = c.row.original;
          return (
            <div className="row-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  ${detailClickHandler}
                }}
              >
                详情
              </Button>
              {canManage && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      returnFocus.current = e.currentTarget;
                      setPending({ kind: "edit", row });
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      returnFocus.current = e.currentTarget;
                      setPending({ kind: "delete", row });
                    }}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ];
  }, [${isPageDetail ? "canManage, navigate, params" : "canManage"}]);

  return (
    <ResourceTableSlot
      title="${label}"
      allowed={canRead}
      actions={
        canManage ? (
          <Button
            ref={createTrigger}
            size="sm"
            onClick={() => {
              returnFocus.current = createTrigger.current;
              setPending({ kind: "create" });
            }}
          >
            <Plus size={15} />
            新增${label}
          </Button>
        ) : undefined
      }
      fields={FIELDS}
      filters={filters}
      onApplyFilters={(next) =>
        void navigate({
          search: parse${singularPascal}Search({ ...next, size: params.size }),
          replace: true,
        })
      }
      draftStorageKey={
        me.data ? \`\${storageKey("filter-drafts.v1")}:\${me.data.id}:${slug}\` : undefined
      }
      columns={columns}
      data={currentItems}
      isLoading={query.isPending}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新${label}"
      onRowClick={(row) => {
        ${rowClickHandler}
      }}
      toolbarEnd={
        <TableExportMenu
          disabled={!currentItems.length}
          items={[
            {
              label: "导出当前页 CSV",
              disabled: !currentItems.length,
              onSelect: () => {
                const count = downloadCsv(\`${label}-第\${page}页.csv\`, currentItems, [
                  {
                    header: "编号",
                    value: (r) => \`${codePrefix}-\${String(r.id).padStart(3, "0")}\`,
                  },
${csvColumns}
                  { header: "创建时间", value: (r) => r.createdAt },
                ]);
                toast.success(\`已导出当前页 \${count} 条${label}记录\`);
              },
            },
          ]}
        />
      }
      pagination={{
        pageIndex: page - 1,
        pageSize: size,
        total: query.data?.total ?? 0,
        sizes: SIZES,
        onChange: (p) =>
          void navigate({
            search: parse${singularPascal}Search({
              ...filters,
              page: p.pageIndex + 1,
              size: p.pageSize,
            }),
            replace: true,
          }),
      }}
    >
      {pending?.kind === "create" && (
        <${pascal}FormDialog
          trigger={returnFocus.current}
          close={(msg) => {
            setPending(null);
            if (msg) toast.success(msg);
          }}
        />
      )}
      {pending?.kind === "edit" && (
        <${pascal}FormDialog
          record={pending.row}
          trigger={returnFocus.current}
          ${editCloseBlock}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="删除记录"
          description={\`将删除「\${String(pending.row.${primaryField.name} ?? pending.row.id)}」并记录操作日志。\`}
          submitText="删除"
          trigger={returnFocus.current}
          action={() => request(\`/${slug}/\${pending.row.id}\`, "DELETE", {})}
          ${deleteCloseBlock}
        />
      )}${drawerJsx}
    </ResourceTableSlot>
  );
}
`;
}

function buildWebDetailPageContent() {
  const hasBadge = fields.some((f) => f.type === "enum" || f.type === "boolean");
  const badgeImport = hasBadge ? 'import { Badge } from "@/components/ui/badge";\n' : "";
  const infoCards = fields
    .map((f) => {
      if (f.type === "boolean") {
        return `            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">${f.label}</dt>
              <dd className="m-0 text-sm text-foreground">
                <Badge variant={record.${f.name} ? "brand" : "neutral"}>
                  {record.${f.name} === null || record.${f.name} === undefined
                    ? "—"
                    : record.${f.name}
                      ? "是"
                      : "否"}
                </Badge>
              </dd>
            </div>`;
      }
      if (f.type === "enum") {
        return `            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">${f.label}</dt>
              <dd className="m-0 text-sm text-foreground">
                {record.${f.name} ? (
                  <Badge variant={record.${f.name} === ${JSON.stringify(f.options[0])} ? "brand" : "neutral"}>
                    {String(record.${f.name})}
                  </Badge>
                ) : (
                  "—"
                )}
              </dd>
            </div>`;
      }
      if (f.type === "int" || f.type === "number" || f.type === "date") {
        return `            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">${f.label}</dt>
              <dd className="m-0 font-mono text-sm text-foreground tabular-nums">
                {record.${f.name} === null || record.${f.name} === undefined || record.${f.name} === ""
                  ? "—"
                  : String(record.${f.name})}
              </dd>
            </div>`;
      }
      const spanClass = f.type === "text" ? " sm:col-span-2" : "";
      return `            <div className="flex flex-col gap-1${spanClass}">
              <dt className="text-xs text-muted-foreground">${f.label}</dt>
              <dd className="m-0 text-sm text-foreground">
                {record.${f.name} ? String(record.${f.name}) : "—"}
              </dd>
            </div>`;
    })
    .join("\n");

  const filterSearchLines = [];
  for (const f of fields) {
    if (f === searchField) {
      filterSearchLines.push('    if (params.q) qs.set("q", params.q);');
      filterSearchLines.push('    if (params.q && params.qOp) qs.set("qOp", params.qOp);');
    } else if (f.type === "enum") {
      filterSearchLines.push(`    if (params.${f.name}) {`);
      filterSearchLines.push(
        `      const vals = Array.isArray(params.${f.name}) ? params.${f.name} : [params.${f.name}];`,
      );
      filterSearchLines.push(`      for (const v of vals) if (v) qs.append("${f.name}", v);`);
      filterSearchLines.push("    }");
    } else if (f.type === "date") {
      filterSearchLines.push(
        `    if (params.${f.name}From) qs.set("${f.name}From", params.${f.name}From);`,
      );
      filterSearchLines.push(
        `    if (params.${f.name}To) qs.set("${f.name}To", params.${f.name}To);`,
      );
    }
  }

  return `import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ${singularPascal}Page, ${singularPascal}Record } from "@optimax-starter/api/${slug}";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
${badgeImport}import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { ${pascal}FormDialog } from "./${pascal}FormDialog";

const route = getRouteApi("/${slug}_/$id");

export function ${pascal}DetailPage() {
  const me = useAccount();
  const cache = useQueryClient();
  const canRead = hasPermission(me.data, "${slug}:read");
  const canManage = hasPermission(me.data, "${slug}:manage");
  const { id } = route.useParams();
  const params = route.useSearch();
  const navigate = route.useNavigate();
  const recordId = /^\\d+$/.test(id) ? Number(id) : 0;
  const [pending, setPending] = useState<"edit" | "delete" | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const detailQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["${slug}", "detail", recordId],
    queryFn: () => request<${singularPascal}Record>(\`/${slug}/\${recordId}\`),
    enabled: Boolean(me.data) && canRead && recordId > 0,
  });

  const listQuery = useQuery({
    queryKey: ["${slug}", params],
    queryFn: () => {
      const qs = new URLSearchParams();
${filterSearchLines.join("\n")}
      qs.set("page", String(params.page ?? 1));
      qs.set("size", String(params.size ?? 20));
      return request<${singularPascal}Page>(\`/${slug}?\${qs.toString()}\`);
    },
    enabled: Boolean(me.data) && canRead,
  });

  if (me.data && !canRead) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        需要查看权限才可访问${label}详情
      </p>
    );
  }

  if (recordId <= 0) {
    return (
      <div className="panel flex flex-col gap-3">
        <p role="alert" className="m-0 text-sm text-destructive">
          无效的记录编号
        </p>
        <div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/${slug}" search={params}>
              <ArrowLeft size={14} aria-hidden="true" />
              返回${label}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const record = detailQuery.data;
  const items = listQuery.data?.items ?? [];
  const currentIdx = items.findIndex((item) => item.id === recordId);
  const prevItem = currentIdx > 0 ? items[currentIdx - 1] : null;
  const nextItem = currentIdx >= 0 && currentIdx < items.length - 1 ? items[currentIdx + 1] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/${slug}" search={params}>
            <ArrowLeft size={14} aria-hidden="true" />
            返回${label}
          </Link>
        </Button>
        {currentIdx >= 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentIdx + 1} / {items.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!prevItem}
              onClick={() =>
                prevItem &&
                void navigate({
                  to: "/${slug}/$id",
                  params: { id: String(prevItem.id) },
                  search: params,
                })
              }
            >
              <ChevronLeft size={14} aria-hidden="true" />
              上一条
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!nextItem}
              onClick={() =>
                nextItem &&
                void navigate({
                  to: "/${slug}/$id",
                  params: { id: String(nextItem.id) },
                  search: params,
                })
              }
            >
              下一条
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {detailQuery.isPending ? (
        <div className="panel h-48 animate-pulse bg-muted/40" />
      ) : detailQuery.error || !record ? (
        <div className="panel flex flex-col gap-3">
          <p role="alert" className="m-0 text-sm text-destructive">
            {detailQuery.error?.message ?? "记录不存在或已被删除"}
          </p>
        </div>
      ) : (
        <>
          <header className="page-header flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                ${codePrefix}-{String(record.id).padStart(3, "0")}
              </span>
              <h1 className="m-0 truncate text-xl font-semibold tracking-tight text-foreground">
                {String(record.${primaryField.name} ?? "${label}详情")}
              </h1>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setPending("edit");
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                  编辑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setPending("delete");
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  删除
                </Button>
              </div>
            )}
          </header>

          <div className="cq-split-12-tight">
            <section className="panel cq-main-7 flex flex-col justify-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-foreground">分析视图与关系画布</h2>
              <p className="m-0 text-xs text-muted-foreground">
                在此区域挂载本模块的拓扑图、时间序列图表（TrendAreaChart / DonutChart）或业务诊断画布，避免在窄侧栏内折叠复杂可视化。
              </p>
            </section>
            <section className="panel cq-side-5">
              <h2 className="m-0 mb-3 text-sm font-semibold text-foreground">结构化档案</h2>
              <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
${infoCards}
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">创建时间</dt>
                  <dd className="m-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {record.createdAt}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {pending === "edit" && (
            <${pascal}FormDialog
              record={record}
              trigger={returnFocus.current}
              close={(msg) => {
                setPending(null);
                if (msg) toast.success(msg);
              }}
            />
          )}
          {pending === "delete" && (
            <ConfirmDialog
              title="删除记录"
              description={\`将删除「\${String(record.${primaryField.name} ?? record.id)}」并记录操作日志。\`}
              submitText="删除"
              trigger={returnFocus.current}
              action={() => request(\`/${slug}/\${record.id}\`, "DELETE", {})}
              close={async (done) => {
                const name = String(record.${primaryField.name} ?? record.id);
                setPending(null);
                if (done) {
                  await cache.invalidateQueries({ queryKey: ["${slug}"] });
                  toast.success(\`已删除 \${name}\`);
                  void navigate({ to: "/${slug}", search: params, replace: true });
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
`;
}

function buildVerifyPyContent() {
  const sampleEntries = fields.map((f) => {
    if (f === primaryField && (f.type === "string" || f.type === "text")) {
      return `    ${JSON.stringify(f.name)}: primary_val,`;
    }
    if (f === primaryField && f.type === "int") {
      return `    ${JSON.stringify(f.name)}: 900000 + int(secrets.randbelow(90000)),`;
    }
    if (f.type === "enum") {
      return `    ${JSON.stringify(f.name)}: ${JSON.stringify(f.options[0])},`;
    }
    if (f.type === "boolean") {
      return `    ${JSON.stringify(f.name)}: True,`;
    }
    if (f.type === "int") {
      return `    ${JSON.stringify(f.name)}: 10,`;
    }
    if (f.type === "number") {
      return `    ${JSON.stringify(f.name)}: 100.5,`;
    }
    if (f.type === "date") {
      return `    ${JSON.stringify(f.name)}: "2026-11-21",`;
    }
    return `    ${JSON.stringify(f.name)}: ${JSON.stringify(`测试${f.label}`)},`;
  });

  let patchPayloadCode = "";
  if (primaryEnum) {
    patchPayloadCode = `{${JSON.stringify(primaryEnum.name)}: ${JSON.stringify(primaryEnum.options[1])}}`;
  } else {
    const mutable = fields.find((f) => f !== primaryField) ?? primaryField;
    if (mutable.type === "boolean") {
      patchPayloadCode = `{${JSON.stringify(mutable.name)}: False}`;
    } else if (mutable.type === "int") {
      patchPayloadCode = `{${JSON.stringify(mutable.name)}: 20}`;
    } else if (mutable.type === "number") {
      patchPayloadCode = `{${JSON.stringify(mutable.name)}: 200.5}`;
    } else if (mutable.type === "date") {
      patchPayloadCode = `{${JSON.stringify(mutable.name)}: "2026-11-22"}`;
    } else {
      patchPayloadCode = `{${JSON.stringify(mutable.name)}: ${JSON.stringify(`更新${mutable.label}`)}}`;
    }
  }

  const filterAssert = searchField
    ? `    page = call(admin, "GET", f"/${slug}?" + urllib.parse.urlencode({"q": primary_val, "qOp": "equals"}))
    assert page["total"] == 1 and page["items"][0]["id"] == created["id"]`
    : `    page = call(admin, "GET", "/${slug}?size=20")
    assert any(item["id"] == created["id"] for item in page["items"])`;

  return `"""Verify ${slug} module RBAC, server pagination and audit logging."""
import http.cookiejar, json, os, secrets, subprocess, urllib.error, urllib.parse, urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = dict(
    line.split("=", 1)
    for line in (root / ".env").read_text().splitlines()
    if "=" in line and not line.lstrip().startswith("#")
)
port = os.environ.get("WEB_PORT") or env.get("WEB_PORT", "38140")
origin = f"http://127.0.0.1:{port}"
admin_user = os.environ.get("STARTER_ADMIN_USERNAME") or env.get("STARTER_ADMIN_USERNAME", "demo@optimax.hk")
admin_pw = os.environ.get("STARTER_ADMIN_PASSWORD") or env["STARTER_ADMIN_PASSWORD"]

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(session, method, path, status=200, data=None):
    req = urllib.request.Request(
        origin + "/console" + path,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Origin": origin, "Content-Type": "application/json"},
    )
    try:
        res = session.open(req, timeout=10)
    except urllib.error.HTTPError as err:
        res = err
    with res:
        assert res.status == status, (method, path, res.status, status)
        return json.load(res)

anon, admin = client(), client()
call(anon, "GET", "/${slug}", 401)
call(admin, "POST", "/login", 200, {"username": admin_user, "password": admin_pw})
primary_val = "qa_${tableIdent}_" + secrets.token_hex(4)
payload = {
${sampleEntries.join("\n")}
}
created = call(admin, "POST", "/${slug}", 201, payload)
try:
${filterAssert}
    single = call(admin, "GET", f"/${slug}/{created['id']}", 200)
    assert single["id"] == created["id"]
    call(admin, "GET", "/${slug}/99999999", 404)
    call(admin, "PATCH", f"/${slug}/{created['id']}", 200, ${patchPayloadCode})
    call(admin, "DELETE", f"/${slug}/{created['id']}", 200, {})
    print("PASS: ${slug} anonymous 401, create, detail, server filter, patch, delete")
finally:
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "starter", "-d", "starter"],
        cwd=root,
        input=f"BEGIN; DELETE FROM console_audit WHERE detail->>'entityId'='{int(created['id'])}' AND action LIKE '${singularSlug}.%'; DELETE FROM console_${tableIdent} WHERE id={int(created['id'])}; COMMIT;",
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
`;
}

function buildAgentToolsContent() {
  const detailRoute = detailMode === "page" ? `\`/${slug}/\${row.id}\`` : `"/${slug}"`;
  const searchWhereLines = [];
  const searchParams = [];
  if (searchField) {
    searchParams.push(
      `  q: z.string().trim().max(80).optional().describe(${JSON.stringify(`${searchField.label}关键字`)}),`,
    );
    searchWhereLines.push(
      `          q ? ilike(${camel}Table.${searchField.name}, containsPattern(q)) : undefined,`,
    );
  }
  const summaryGroupBlock = primaryEnum
    ? `        const byGroup = await db
          .select({ group: ${camel}Table.${primaryEnum.name}, n: count() })
          .from(${camel}Table)
          .groupBy(${camel}Table.${primaryEnum.name});
        return {
          total: Number(totalRow?.n ?? 0),
          byGroup: byGroup.map((row) => ({ group: String(row.group ?? "-"), count: Number(row.n) })),
        };`
    : `        return { total: Number(totalRow?.n ?? 0) };`;

  const searchWhereCode =
    searchWhereLines.length > 0
      ? `        const where = and(\n${searchWhereLines.join("\n")}\n        );`
      : "        const where = undefined;";

  return `import { and, count, desc, ilike } from "drizzle-orm";
import { ${camel}InputSchema } from "@optimax-starter/api/${slug}";
import { ${camel}Table } from "@optimax-starter/db/schema/${slug}";
import { type ToolSet, redact, tool, z } from "@optimax-starter/agent";
import { db } from "../services";
import { auditResource, containsPattern } from "../core/audit";
import { Refusal, lockPermission } from "../core/guards";
import type { AgentToolContext } from "./registry";

const SEARCH_LIMIT = 20;

const recordCode = (id: number) => \`${codePrefix}-\${String(id).padStart(3, "0")}\`;

export const ${camel}WriteTools = {
  create_${singularSlug}: { permission: "${slug}:manage", input: ${camel}InputSchema },
} as const;

const searchInput = z.object({
${searchParams.join("\n")}
});

export function ${camel}Tools({ actor, approvals, citations }: AgentToolContext): ToolSet {
  const tools: ToolSet = {};
  if (actor.permissions.includes("${slug}:read")) {
    tools.search_${tableIdent} = tool({
      description: "按条件检索${label}记录，最多返回 20 条。",
      inputSchema: searchInput,
      execute: async (${searchField ? "{ q }" : "_input"}) => {
${searchWhereCode}
        const [rows, totals] = await Promise.all([
          db
            .select()
            .from(${camel}Table)
            .where(where)
            .orderBy(desc(${camel}Table.id))
            .limit(SEARCH_LIMIT),
          db.select({ n: count() }).from(${camel}Table).where(where),
        ]);
        const items = rows.map((row) => {
          const cid = \`E\${citations.length + 1}\`;
          const title = String((row as Record<string, unknown>)[${JSON.stringify(primaryField.name)}] ?? row.id);
          citations.push({
            id: cid,
            title: redact(title),
            snippet: \`\${recordCode(row.id)} | \${redact(title)}\`,
            to: ${detailRoute},
          });
          return {
            citation: cid,
            id: row.id,
            code: recordCode(row.id),
            ${primaryField.name}: redact(title),
          };
        });
        const total = Number(totals[0]?.n ?? 0);
        return { total, returned: items.length, truncated: total > items.length, items };
      },
    });

    tools.summarize_${tableIdent} = tool({
      description: "统计${label}记录总数与分布情况。",
      inputSchema: z.object({}),
      execute: async () => {
        const [totalRow] = await db.select({ n: count() }).from(${camel}Table);
${summaryGroupBlock}
      },
    });
  }

  if (actor.permissions.includes("${slug}:manage")) {
    tools.create_${singularSlug} = tool({
      description: "新增一条${label}记录，需用户确认后执行。",
      inputSchema: ${camel}InputSchema,
      needsApproval: true,
      execute: async (input, { toolCallId }) => {
        if (!approvals.has(toolCallId)) {
          throw new Refusal(403, "确认已失效，请重新发起操作", "APPROVAL_INVALID");
        }
        return db.transaction(async (tx) => {
          const self = await lockPermission(tx, actor.id, "${slug}:manage");
          const [row] = await tx
            .insert(${camel}Table)
            .values(input)
            .onConflictDoNothing()
            .returning();
          if (!row) throw new Refusal(409, "${primaryField.label}已存在或创建失败");
          const nameVal = String((row as Record<string, unknown>)[${JSON.stringify(primaryField.name)}] ?? row.id);
          await auditResource(
            tx,
            "${singularSlug}.create",
            self,
            { id: row.id, code: recordCode(row.id), name: nameVal },
            { fields: Object.keys(input) },
            "agent",
          );
          return { ok: true, id: row.id, code: recordCode(row.id), name: redact(nameVal) };
        });
      },
    });
  }
  return tools;
}
`;
}

const files = [
  {
    rel: `packages/db/src/schema/${slug}.ts`,
    content: buildDbSchemaContent(),
  },
  {
    rel: `packages/api/src/${slug}.ts`,
    content: buildApiContractContent(),
  },
  {
    rel: `apps/server/src/modules/${slug}.ts`,
    content: buildServerModuleContent(),
  },
  {
    rel: `apps/web/src/features/${slug}/${pascal}FormDialog.tsx`,
    content: buildFormDialogContent(),
  },
  {
    rel: `apps/web/src/features/${slug}/${pascal}Page.tsx`,
    content: buildWebPageContent(),
  },
  ...(detailMode === "page"
    ? [
        {
          rel: `apps/web/src/features/${slug}/${pascal}DetailPage.tsx`,
          content: buildWebDetailPageContent(),
        },
        {
          rel: `apps/web/src/routes/${slug}_.$id.tsx`,
          content: `import { createFileRoute } from "@tanstack/react-router";
import { parse${singularPascal}Search } from "@optimax-starter/api/${slug}";
import { ${pascal}DetailPage } from "@/features/${slug}/${pascal}DetailPage";

export const Route = createFileRoute("/${slug}_/$id")({
  validateSearch: parse${singularPascal}Search,
  component: ${pascal}DetailPage,
});
`,
        },
      ]
    : []),
  {
    rel: `apps/web/src/routes/${slug}.tsx`,
    content: `import { createFileRoute } from "@tanstack/react-router";
import { parse${singularPascal}Search } from "@optimax-starter/api/${slug}";
import { ${pascal}Page } from "@/features/${slug}/${pascal}Page";

export const Route = createFileRoute("/${slug}")({
  validateSearch: parse${singularPascal}Search,
  component: ${pascal}Page,
});
`,
  },
  ...(agentPresent
    ? [
        {
          rel: `apps/server/src/agent/${slug}-tools.ts`,
          content: buildAgentToolsContent(),
        },
      ]
    : []),
  {
    rel: `scripts/verify-${slug}.py`,
    mode: 0o755,
    content: buildVerifyPyContent(),
  },
];

for (const file of files) {
  if (existsSync(path.join(ROOT, file.rel))) {
    throw new Error(`目标文件已存在，停止生成以避免覆盖: ${file.rel}`);
  }
}

/**
 * Replaces exactly one occurrence of `target`; throws (naming the file and marker) when it is
 * missing or ambiguous so a central file is never silently left half-registered.
 */
function replaceOrThrow(content, target, replacement, fileLabel, markerLabel) {
  const first = content.indexOf(target);
  if (first === -1) {
    throw new Error(
      `${fileLabel} 缺少锚点 ${markerLabel}，已停止生成（未修改任何中心文件）。请从上游恢复该注释锚点后重试。`,
    );
  }
  if (content.indexOf(target, first + target.length) !== -1) {
    throw new Error(
      `${fileLabel} 中锚点 ${markerLabel} 出现多次，已停止生成（未修改任何中心文件）。`,
    );
  }
  return content.slice(0, first) + replacement + content.slice(first + target.length);
}

/** Full line (with indentation) holding `// @starter:<name>`, or null when absent. */
function findMarkerLine(content, marker) {
  // Markers are plain `@starter:<kebab-name>` tokens, so no regex escaping is required.
  const re = new RegExp("^[ \\t]*// " + marker + "[ \\t]*$", "m");
  return content.match(re)?.[0] ?? null;
}

/** Inserts `lines` (each prefixed with the marker's own indentation) directly before the marker. */
function insertBeforeMarker(content, marker, lines, fileLabel) {
  const markerLine = findMarkerLine(content, marker) ?? `// ${marker}`;
  const indent = markerLine.match(/^[ \t]*/)[0];
  const snippet = lines.map((line) => `${indent}${line}\n`).join("");
  return replaceOrThrow(content, markerLine, snippet + markerLine, fileLabel, marker);
}

const centralEdits = [
  {
    rel: "packages/db/src/schema/index.ts",
    inserts: [{ marker: "@starter:schema-exports", lines: [`export * from "./${slug}";`] }],
  },
  {
    rel: "packages/api/src/index.ts",
    inserts: [{ marker: "@starter:api-exports", lines: [`export * from "./${slug}";`] }],
  },
  {
    rel: "packages/api/src/contracts.ts",
    inserts: [
      {
        marker: "@starter:audit-actions",
        lines: [
          `"${singularSlug}.create",`,
          `"${singularSlug}.update",`,
          `"${singularSlug}.delete",`,
        ],
      },
      {
        marker: "@starter:audit-action-labels",
        lines: [
          `"${singularSlug}.create": "新增${label}",`,
          `"${singularSlug}.update": "编辑${label}",`,
          `"${singularSlug}.delete": "删除${label}",`,
        ],
      },
    ],
  },
  {
    rel: "packages/api/src/permissions.ts",
    inserts: [
      {
        marker: "@starter:permission-catalog",
        lines: [
          `{ code: "${slug}:read", label: "查看${label}", module: "${label}", kind: "view" },`,
          `{ code: "${slug}:manage", label: "维护${label}", module: "${label}", kind: "operate" },`,
        ],
      },
      {
        marker: "@starter:admin-permissions",
        lines: [`"${slug}:read",`, `"${slug}:manage",`],
      },
      { marker: "@starter:member-permissions", lines: [`"${slug}:read",`] },
      {
        marker: "@starter:permission-rows",
        lines: [
          "{",
          `  id: "${slug}",`,
          `  label: "${label}",`,
          `  description: "${label}查询与增删改维护",`,
          "  actions: ALL_ACTIONS,",
          `  viewCodes: { default: ["${slug}:read"] },`,
          `  operateCodes: { default: ["${slug}:manage"] },`,
          "},",
        ],
      },
    ],
  },
  {
    // Chained .route() keeps `typeof consoleRoutes` (hc RPC) complete.
    rel: "apps/server/src/console.ts",
    inserts: [
      {
        marker: "@starter:module-imports",
        lines: [`import { ${camel}Routes } from "./modules/${slug}";`],
      },
      { marker: "@starter:module-routes", lines: [`.route("/", ${camel}Routes)`] },
    ],
  },
  {
    rel: "apps/web/src/config/app-config.ts",
    inserts: [
      { marker: "@starter:nav-targets", lines: [`| "/${slug}"`] },
      {
        marker: "@starter:nav-items",
        lines: [
          "{",
          '  kind: "item",',
          `  to: "/${slug}",`,
          `  label: "${label}",`,
          "  icon: Boxes,",
          `  aliases: ["${slug}", "${singularSlug}", "${label}"],`,
          `  permissionCode: "${slug}:read",`,
          "},",
        ],
      },
    ],
  },
  {
    rel: "apps/web/src/features/dashboard/registry.ts",
    inserts: [
      {
        marker: "@starter:dashboard-modules",
        lines: [
          "createGeneratedModuleSpec({",
          `  id: ${JSON.stringify(slug)},`,
          `  label: ${JSON.stringify(label)},`,
          `  to: ${JSON.stringify(`/${slug}`)},`,
          `  permissionCode: ${JSON.stringify(`${slug}:read`)},`,
          `  primaryEnumField: ${primaryEnum ? JSON.stringify({ name: primaryEnum.name, label: primaryEnum.label, options: primaryEnum.options }) : "null"},`,
          `  categoryField: ${categoryField ? JSON.stringify({ name: categoryField.name, label: categoryField.label }) : "null"},`,
          `  ownerField: ${ownerField ? JSON.stringify({ name: ownerField.name, label: ownerField.label }) : "null"},`,
          `  booleanField: ${booleanField ? JSON.stringify({ name: booleanField.name, label: booleanField.label }) : "null"},`,
          "}),",
        ],
      },
    ],
  },
  ...(agentPresent
    ? [
        {
          rel: "apps/server/src/agent/registry.ts",
          inserts: [
            {
              marker: "@starter:agent-module-imports",
              lines: [`import { ${camel}Tools } from "./${slug}-tools";`],
            },
            {
              marker: "@starter:agent-module-tools",
              lines: [`Object.assign(tools, ${camel}Tools(context));`],
            },
          ],
        },
        {
          rel: "apps/server/src/agent/routes.ts",
          inserts: [
            {
              marker: "@starter:agent-write-tool-imports",
              lines: [`import { ${camel}WriteTools } from "./${slug}-tools";`],
            },
            {
              marker: "@starter:agent-write-tools",
              lines: [
                `for (const [name, spec] of Object.entries(${camel}WriteTools)) writeTools.set(name, spec);`,
              ],
            },
          ],
        },
        {
          rel: "apps/web/src/features/assistant/ToolSteps.tsx",
          inserts: [
            {
              marker: "@starter:agent-step-write-tools",
              lines: [`WRITE_TOOLS.add("create_${singularSlug}");`],
            },
            {
              marker: "@starter:agent-step-tools",
              lines: [
                `search_${tableIdent}: { label: "检索${label}", icon: <LayoutDashboard size={14} /> },`,
                `summarize_${tableIdent}: { label: "统计${label}", icon: <LayoutDashboard size={14} /> },`,
                `create_${singularSlug}: { label: "新增${label}", icon: <Wrench size={14} /> },`,
              ],
            },
          ],
        },
        ...(detailMode === "page" &&
        existsSync(path.join(ROOT, "apps/web/src/features/assistant/assistant-links-utils.ts"))
          ? [
              {
                rel: "apps/web/src/features/assistant/assistant-links-utils.ts",
                inserts: [
                  {
                    marker: "@starter:entity-link-rules",
                    lines: [
                      "{",
                      `  kind: ${JSON.stringify(slug)},`,
                      `  pattern: /\\b${codePrefix}-([1-9]\\d{0,8})\\b/,`,
                      "  resolve: (match) => ({",
                      `    kind: ${JSON.stringify(slug)},`,
                      `    code: \`${codePrefix}-\${match[1]}\`,`,
                      `    to: \`/${slug}/\${match[1]}\`,`,
                      `    label: \`打开${label} ${codePrefix}-\${match[1]}\`,`,
                      "  }),",
                      "},",
                    ],
                  },
                ],
              },
            ]
          : []),
      ]
    : []),
  ...(detailMode === "page" &&
  existsSync(path.join(ROOT, "apps/web/src/features/navigation/entity-search.ts"))
    ? [
        {
          rel: "apps/web/src/features/navigation/entity-search.ts",
          inserts: [
            {
              marker: "@starter:entity-search-providers",
              lines: [
                "async (query, signal) => {",
                '  const { request: apiRequest } = await import("@/console-client");',
                '  const qs = new URLSearchParams({ page: "1", size: "8" });',
                `  if (query.trim()) qs.set(${searchField ? '"q"' : '"q"'}, query.trim());`,
                `  const res = await apiRequest<{ items: Array<Record<string, unknown>> }>(\`/${slug}?\${qs.toString()}\`, "GET", undefined, { signal });`,
                "  return res.items.map((row) => {",
                "    const id = Number(row.id);",
                `    const code = id < 1000 ? \`${codePrefix}-\${String(id).padStart(3, "0")}\` : \`${codePrefix}-\${id}\`;`,
                "    return {",
                `      id: \`${slug}-\${id}\`,`,
                "      code,",
                `      title: String(row[${JSON.stringify(primaryField.name)}] ?? code),`,
                `      to: \`/${slug}/\${id}\`,`,
                "    };",
                "  });",
                "},",
              ],
            },
          ],
        },
      ]
    : []),
];

// Fail fast: every central file and marker must exist before anything is written.
const centralPlans = centralEdits.map((edit) => {
  const full = path.join(ROOT, edit.rel);
  if (!existsSync(full)) {
    throw new Error(`中心注册文件不存在: ${edit.rel}，已停止生成（未写入任何文件）。`);
  }
  let content = readFileSync(full, "utf-8");
  for (const insert of edit.inserts) {
    if (!findMarkerLine(content, insert.marker)) {
      throw new Error(
        `${edit.rel} 缺少锚点 // ${insert.marker}，已停止生成（未写入任何文件）。请从上游恢复该注释锚点后重试。`,
      );
    }
    content = insertBeforeMarker(content, insert.marker, insert.lines, edit.rel);
  }
  return { full, rel: edit.rel, content };
});

if (dryRun) {
  console.log(`Dry-run 通过（共 ${fields.length} 个字段），将创建以下文件并注册契约/路由/侧栏:`);
  for (const file of files) console.log(`  + ${file.rel}`);
  for (const plan of centralPlans) console.log(`  ~ ${plan.rel}`);
  process.exit(0);
}

for (const file of files) {
  const full = path.join(ROOT, file.rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, file.content, "utf-8");
  if (file.mode) chmodSync(full, file.mode);
}

for (const plan of centralPlans) {
  writeFileSync(plan.full, plan.content, "utf-8");
}

console.log(`已生成模块 ${slug}（${label}，${fields.length} 个字段）：`);
for (const file of files) console.log(`  + ${file.rel}`);
for (const plan of centralPlans) console.log(`  ~ ${plan.rel}`);
console.log(`
下一步:
  1. bun run db:generate                # 生成迁移 SQL，并提交 packages/db/src/migrations/
  2. bun run db:check                   # 确认 schema 与已提交迁移无漂移
  3. docker compose restart api         # 或本地 bun run db:push 同步新表
  4. python3 scripts/verify-${slug}.py  # 接口级权限、分页与审计闭环验收
访问入口: /${slug}`);
