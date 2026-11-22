#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrimaryField,
  parseFieldsSpec,
  toSnakeCase,
} from "./lib/gen-module-fields.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
]);

function usage() {
  console.log(`用法:
  bun run gen:module <slug> --label <中文模块名> [--singular <单数英文名>] [--fields "<字段声明>"] [--dry-run]

字段语法（可选，省略时生成 name/category/owner/status 默认 4 字段）:
  <name>:<type>[:<中文标签>][?] ，多字段用英文逗号分隔；末尾 ? 表示可选
  支持类型: string | text | int | number | boolean | date | enum:选项A|选项B

示例:
  bun run gen:module vendors --label 供应商台账 --singular vendor
  bun run gen:module contracts --label 合同台账 --singular contract \\
    --fields "code:string:合同编号,amount:number:金额,qty:int:数量,kind:enum:采购|销售:类型,signedAt:date:签约日期,active:boolean:有效,remark:text:备注?"

生成内容:
  1. packages/db/src/schema/<slug>.ts         Drizzle 数据表定义并注册到 schema/index.ts
  2. packages/api/src/<slug>.ts               前后端共享 Zod 契约与 URL 筛选解析器
  3. apps/server/src/modules/<slug>.ts        Hono 链式分页筛选 + 管理员 CRUD + 同事务审计路由
  4. apps/web/src/features/<slug>/*           ResourceTableSlot 列表页 + FormDialog 表单弹窗 + DetailDrawer + CSV 导出
  5. apps/web/src/routes/<slug>.tsx           TanStack Router 路由并注册侧栏 / Cmd+K 导航
  6. scripts/verify-<slug>.py                 接口级权限、分页与审计闭环 E2E 脚本`);
}

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

const slug = args[0];
let label = "";
let singular = "";
let fieldsSpec = "";
let dryRun = false;

for (let i = 1; i < args.length; i += 1) {
  if (args[i] === "--label") {
    label = args[++i] ?? "";
  } else if (args[i] === "--singular") {
    singular = args[++i] ?? "";
  } else if (args[i] === "--fields") {
    fieldsSpec = args[++i] ?? "";
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
label = label.trim();

const fields = parseFieldsSpec(fieldsSpec);
const primaryField = getPrimaryField(fields);
const primaryUnique = primaryField.type !== "boolean";
const enumFields = fields.filter((f) => f.type === "enum");
const primaryEnum = enumFields[0] ?? null;
const searchField =
  primaryField.type === "string" || primaryField.type === "text"
    ? primaryField
    : fields.find((f) => f.type === "string" || f.type === "text") ?? null;
const categoryField =
  fields.find((f) => f.name === "category" || f.name === "domain") ?? null;

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
const codePrefix = singularSlug.slice(0, 2).toUpperCase();

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
  if (primaryEnum) {
    searchLines.push(`  ${primaryEnum.name}?: ${enumTypeName(primaryEnum)};`);
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

  const searchParserLines = [];
  if (searchField) {
    searchParserLines.push(
      '  const q = typeof v.q === "string" && v.q.trim() && v.q.length <= 200 ? v.q : undefined;',
    );
  }
  if (primaryEnum) {
    searchParserLines.push(
      `  const enumVal = typeof v.${primaryEnum.name} === "string" && (${enumConstName(primaryEnum)} as readonly string[]).includes(v.${primaryEnum.name}) ? (v.${primaryEnum.name} as ${enumTypeName(primaryEnum)}) : undefined;`,
    );
  }
  searchParserLines.push("  const page = Number(v.page);");
  searchParserLines.push("  const size = Number(v.size);");
  searchParserLines.push("  return {");
  if (searchField) {
    searchParserLines.push("    ...(q ? { q } : {}),");
    searchParserLines.push('    ...(q && v.qOp === "equals" ? { qOp: "equals" as const } : {}),');
  }
  if (primaryEnum) {
    searchParserLines.push(`    ...(enumVal ? { ${primaryEnum.name}: enumVal } : {}),`);
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

export function parse${singularPascal}Search(v: Record<string, unknown>): ${singularPascal}Search {
${searchParserLines.join("\n")}
}
`;
}

function buildServerModuleContent() {
  const drizzleImports = new Set(["and", "count", "desc", "eq"]);
  if (searchField) drizzleImports.add("ilike");
  if (primaryUnique) drizzleImports.add("ne");

  const apiImports = [];
  if (primaryEnum) apiImports.push(enumConstName(primaryEnum));
  apiImports.push(`${camel}InputSchema`, `${camel}PatchSchema`);

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
  if (primaryEnum) {
    querySchemaLines.push(
      `  ${primaryEnum.name}: z.enum(${enumConstName(primaryEnum)}).optional(),`,
    );
  }
  querySchemaLines.push("  page: z.coerce.number().int().min(1).max(100000).default(1),");
  querySchemaLines.push(
    "  size: z.coerce\n    .number()\n    .int()\n    .min(1)\n    .default(20)\n    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),",
  );

  const queryDestruct = [];
  if (searchField) queryDestruct.push("q", "qOp");
  if (primaryEnum) queryDestruct.push(primaryEnum.name);
  queryDestruct.push("page", "size");

  const whereParts = [];
  if (searchField) {
    whereParts.push(`      q
        ? qOp === "equals"
          ? eq(${camel}Table.${searchField.name}, q)
          : ilike(${camel}Table.${searchField.name}, containsPattern(q))
        : undefined,`);
  }
  if (primaryEnum) {
    whereParts.push(
      `      ${primaryEnum.name} ? eq(${camel}Table.${primaryEnum.name}, ${primaryEnum.name}) : undefined,`,
    );
  }

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

const querySchema = z.object({
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
      Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""),
    );
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
    const { ${queryDestruct.join(", ")} } = parsed.data;
${whereBlock ? `${whereBlock}\n` : ""}    const [items, totals] = await Promise.all([
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
  const hasEnum = enumFields.length > 0;
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
  if (hasInput) uiImports.push('import { Input } from "@/components/ui/input";');
  if (hasString) uiImports.push('import { ClearableInput } from "@/components/ui/input-group";');
  if (hasInt) uiImports.push('import { NumberInput } from "@/components/ui/number-input";');
  if (hasEnum) {
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

  const apiValueImports = [
    ...enumFields.map((f) => enumConstName(f)),
    `${camel}InputSchema`,
  ];

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

  const keepEditingFocus = focusField ? `\n                form.setFocus("${focusField.name}");` : "";

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
  const apiImports = [];
  if (primaryEnum) apiImports.push(enumConstName(primaryEnum));
  apiImports.push(
    `parse${singularPascal}Search`,
    `type ${singularPascal}Page`,
    `type ${singularPascal}Record`,
  );

  const hasBadge = fields.some((f) => f.type === "enum" || f.type === "boolean");
  const filterFields = [];
  if (searchField) {
    filterFields.push(`  {
    key: "q",
    label: "关键词",
    type: "text",
    ariaLabel: "搜索${label}",
    placeholder: "搜索${searchField.label}",
    operatorKey: "qOp",
  }`);
  }
  if (primaryEnum) {
    filterFields.push(`  {
    key: "${primaryEnum.name}",
    label: "${primaryEnum.label}",
    type: "select",
    options: ${enumConstName(primaryEnum)}.map((v) => ({ value: v, label: v })),
  }`);
  }

  const filterStateLines = [];
  if (searchField) {
    filterStateLines.push("    q: params.q,");
    filterStateLines.push("    qOp: params.qOp,");
  }
  if (primaryEnum) {
    filterStateLines.push(`    ${primaryEnum.name}: params.${primaryEnum.name},`);
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

  return `import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  ${apiImports.join(",\n  ")},
} from "@optimax-starter/api/${slug}";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
${badgeImport}import { Button } from "@/components/ui/button";
import {
  DetailDrawer,
  DetailField,
  DetailSection,
} from "@/components/ui/detail-drawer";
import { toast } from "@/components/ui/toast";
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
  >(null);
  const [detailRow, setDetailRow] = useState<${singularPascal}Record | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const filters: Filters = {
${filterStateLines.join("\n")}
  };

  const query = useQuery({
    meta: { contentRefresh: true },
    queryKey: ["${slug}", params],
    queryFn: () => {
      const qs = new URLSearchParams(
        Object.entries({ ...filters, page, size })
          .filter(([, v]) => v !== undefined && String(v) !== "")
          .map(([k, v]) => [k, String(v)]),
      );
      return request<${singularPascal}Page>(\`/${slug}?\${qs.toString()}\`);
    },
    enabled: Boolean(me.data) && canRead,
    placeholderData: keepPreviousData,
  });

  const currentItems = query.data?.items ?? [];

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
                  returnFocus.current = e.currentTarget;
                  setDetailRow(row);
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
  }, [canManage]);

  return (
    <ResourceTableSlot
      title="${label}"
      allowed={canRead}
      actions={
        canManage ? (
          <Button
            ref={createTrigger}
            onClick={() => {
              returnFocus.current = createTrigger.current;
              setPending({ kind: "create" });
            }}
          >
            <Plus size={16} />
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
      columns={columns}
      data={currentItems}
      isLoading={query.isPending}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新${label}"
      onRowClick={(row) => {
        returnFocus.current = null;
        setDetailRow(row);
      }}
      toolbarEnd={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!currentItems.length}
          onClick={() => {
            const count = downloadCsv(\`${label}-第\${page}页.csv\`, currentItems, [
              {
                header: "编号",
                value: (r) => \`${codePrefix}-\${String(r.id).padStart(3, "0")}\`,
              },
${csvColumns}
              { header: "创建时间", value: (r) => r.createdAt },
            ]);
            toast.success(\`已导出 \${count} 条${label}记录\`);
          }}
        >
          <Download size={14} aria-hidden="true" />
          <span>导出 CSV</span>
        </Button>
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
          close={(msg) => {
            setPending(null);
            if (msg) toast.success(msg);
          }}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title="删除记录"
          description={\`将删除「\${String(pending.row.${primaryField.name} ?? pending.row.id)}」并记录操作日志。\`}
          submitText="删除"
          trigger={returnFocus.current}
          action={() => request(\`/${slug}/\${pending.row.id}\`, "DELETE", {})}
          close={async (done) => {
            const name = String(pending.row.${primaryField.name} ?? pending.row.id);
            setPending(null);
            if (done) {
              await cache.invalidateQueries({ queryKey: ["${slug}"] });
              toast.success(\`已删除 \${name}\`);
            }
          }}
        />
      )}
      <DetailDrawer
        open={Boolean(detailRow)}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
        title={
          detailRow
            ? String(detailRow.${primaryField.name} ?? "${label}详情")
            : "${label}详情"
        }
        description={
          detailRow
            ? \`${codePrefix}-\${String(detailRow.id).padStart(3, "0")}\`
            : undefined
        }
        onCloseAutoFocus={(e) => {
          if (returnFocus.current?.isConnected) {
            e.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        {detailRow && (
          <DetailSection title="记录详情">
${detailFields}
            <DetailField label="创建时间">
              <span className="font-mono text-xs tabular-nums">
                {detailRow.createdAt}
              </span>
            </DetailField>
          </DetailSection>
        )}
      </DetailDrawer>
    </ResourceTableSlot>
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
    call(admin, "PATCH", f"/${slug}/{created['id']}", 200, ${patchPayloadCode})
    call(admin, "DELETE", f"/${slug}/{created['id']}", 200, {})
    print("PASS: ${slug} anonymous 401, create, server filter, patch, delete")
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
    throw new Error(`${fileLabel} 中锚点 ${markerLabel} 出现多次，已停止生成（未修改任何中心文件）。`);
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
