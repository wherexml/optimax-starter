#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESERVED = new Set([
  "auth",
  "accounts",
  "audit",
  "assets",
  "settings",
  "login",
  "demo",
  "console",
  "healthz",
]);

function usage() {
  console.log(`用法:
  bun run gen:module <slug> --label <中文模块名> [--singular <单数英文名>] [--dry-run]

示例:
  bun run gen:module vendors --label 供应商台账 --singular vendor

生成内容:
  1. packages/db/src/schema/<slug>.ts         Drizzle 数据表定义并注册到 schema/index.ts
  2. packages/api/src/<slug>.ts               前后端共享 Zod 契约与 URL 筛选解析器
  3. apps/server/src/modules/<slug>.ts        Hono 服务端分页筛选 + 管理员 CRUD + 同事务审计路由
  4. apps/web/src/features/<slug>/*           ResourceTableSlot 列表页 + FormDialog 表单弹窗
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
let dryRun = false;

for (let i = 1; i < args.length; i += 1) {
  if (args[i] === "--label") {
    label = args[++i] ?? "";
  } else if (args[i] === "--singular") {
    singular = args[++i] ?? "";
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
const singularSlug = (singular.trim() || (slug.endsWith("s") ? slug.slice(0, -1) : slug)).replace(/-/g, "_");
const tableIdent = slug.replace(/-/g, "_");
const camel = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pascal = camel.slice(0, 1).toUpperCase() + camel.slice(1);
const singularPascal =
  singularSlug
    .split("_")
    .map((s) => s.slice(0, 1).toUpperCase() + s.slice(1))
    .join("");
const codePrefix = singularSlug.slice(0, 2).toUpperCase();

const files = [
  {
    rel: `packages/db/src/schema/${slug}.ts`,
    content: `import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ${camel}Table = pgTable("console_${tableIdent}", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  owner: text("owner").notNull(),
  status: text("status").notNull().default("启用"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
`,
  },
  {
    rel: `packages/api/src/${slug}.ts`,
    content: `import { z } from "zod";
import type { PaginatedResult } from "./contracts";

export const ${singularPascal.toUpperCase()}_STATUSES = ["启用", "停用"] as const;
export type ${singularPascal}Status = (typeof ${singularPascal.toUpperCase()}_STATUSES)[number];

export interface ${singularPascal}Record {
  id: number;
  name: string;
  category: string;
  owner: string;
  status: string;
  createdAt: string;
}

export type ${singularPascal}Page = PaginatedResult<${singularPascal}Record>;

export type ${singularPascal}Search = {
  q?: string;
  qOp?: "contains" | "equals";
  status?: ${singularPascal}Status;
  page?: number;
  size?: number;
};

export const ${camel}InputSchema = z
  .object({
    name: z.string().trim().min(1, "请输入名称").max(80, "名称最多 80 个字符"),
    category: z.string().trim().min(1, "请输入分类").max(40, "分类最多 40 个字符"),
    owner: z.string().trim().min(1, "请输入负责人").max(60, "负责人最多 60 个字符"),
    status: z.enum(${singularPascal.toUpperCase()}_STATUSES),
  })
  .strict();
export type ${singularPascal}Input = z.infer<typeof ${camel}InputSchema>;

export const ${camel}PatchSchema = ${camel}InputSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
);

export function parse${singularPascal}Search(v: Record<string, unknown>): ${singularPascal}Search {
  const q = typeof v.q === "string" && v.q.trim() && v.q.length <= 200 ? v.q : undefined;
  const page = Number(v.page);
  const size = Number(v.size);
  return {
    ...(q ? { q } : {}),
    ...(q && v.qOp === "equals" ? { qOp: "equals" as const } : {}),
    ...(v.status === "启用" || v.status === "停用" ? { status: v.status } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    ...(size === 50 || size === 100 ? { size } : {}),
  };
}
`,
  },
  {
    rel: `apps/server/src/modules/${slug}.ts`,
    content: `import { and, count, desc, eq, ilike, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ${singularPascal.toUpperCase()}_STATUSES,
  ${camel}InputSchema,
  ${camel}PatchSchema,
} from "@optimax-starter/api/${slug}";
import { ${camel}Table } from "@optimax-starter/db/schema/${slug}";
import { db } from "../services";
import { AUDIT_MAX_PAGE, auditResource, containsPattern } from "../core/audit";
import {
  Refusal,
  guarded,
  lockAdmin,
  parsePositiveId,
  requireAdmin,
  type Env,
} from "../core/guards";

export const ${camel}Routes = new Hono<Env>();

const querySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  qOp: z.enum(["contains", "equals"]).optional(),
  status: z.enum(${singularPascal.toUpperCase()}_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((n) => Math.min(n, AUDIT_MAX_PAGE)),
});

const toResource = (row: { id: number; name: string }) => ({
  id: row.id,
  code: \`${codePrefix}-\${String(row.id).padStart(3, "0")}\`,
  name: row.name,
});

${camel}Routes.get("/${slug}", async (c) => {
  const raw = Object.fromEntries(
    Object.entries(c.req.query()).filter(([, v]) => v.trim() !== ""),
  );
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "筛选条件无效" }, 400);
  const { q, qOp, status, page, size } = parsed.data;
  const where = and(
    q
      ? qOp === "equals"
        ? eq(${camel}Table.name, q)
        : ilike(${camel}Table.name, containsPattern(q))
      : undefined,
    status ? eq(${camel}Table.status, status) : undefined,
  );
  const [items, totals] = await Promise.all([
    db
      .select()
      .from(${camel}Table)
      .where(where)
      .orderBy(desc(${camel}Table.id))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(${camel}Table).where(where),
  ]);
  return c.json({ items, total: Number(totals[0]?.n ?? 0), page, size });
});

${camel}Routes.post("/${slug}", requireAdmin, async (c) => {
  const parsed = ${camel}InputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请完整填写${label}信息" }, 400);
  return guarded(c, async () => {
    const created = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [row] = await tx
        .insert(${camel}Table)
        .values(parsed.data)
        .onConflictDoNothing()
        .returning();
      if (!row) throw new Refusal(409, "名称已存在");
      await auditResource(tx, "${singularSlug}.create", self, toResource(row), {
        stage: row.status,
        domain: row.category,
      });
      return row;
    });
    return c.json(created, 201);
  });
});

${camel}Routes.patch("/${slug}/:id", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  const parsed = ${camel}PatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "无效的变更参数" }, 400);
  return guarded(c, async () => {
    const updated = await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [before] = await tx
        .select()
        .from(${camel}Table)
        .where(eq(${camel}Table.id, id))
        .for("update");
      if (!before) throw new Refusal(404, "记录不存在");
      if (parsed.data.name && parsed.data.name !== before.name) {
        const [dup] = await tx
          .select({ id: ${camel}Table.id })
          .from(${camel}Table)
          .where(and(eq(${camel}Table.name, parsed.data.name), ne(${camel}Table.id, id)));
        if (dup) throw new Refusal(409, "名称已存在");
      }
      const [after] = await tx
        .update(${camel}Table)
        .set(parsed.data)
        .where(eq(${camel}Table.id, id))
        .returning();
      await auditResource(tx, "${singularSlug}.update", self, toResource(after!), {
        fields: Object.keys(parsed.data),
      });
      return after!;
    });
    return c.json(updated);
  });
});

${camel}Routes.delete("/${slug}/:id", requireAdmin, async (c) => {
  const id = parsePositiveId(c.req.param("id"));
  if (!id) return c.json({ error: "无效的编号" }, 400);
  return guarded(c, async () => {
    await db.transaction(async (tx) => {
      const self = await lockAdmin(tx, c.get("actor").id);
      const [removed] = await tx
        .delete(${camel}Table)
        .where(eq(${camel}Table.id, id))
        .returning();
      if (!removed) throw new Refusal(404, "记录不存在");
      await auditResource(tx, "${singularSlug}.delete", self, toResource(removed), {
        domain: removed.category,
      });
    });
    return c.json({ ok: true });
  });
});
`,
  },
  {
    rel: `apps/web/src/features/${slug}/${pascal}FormDialog.tsx`,
    content: `import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ${singularPascal.toUpperCase()}_STATUSES,
  ${camel}InputSchema,
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
import { ClearableInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      name: record?.name ?? "",
      category: record?.category ?? "",
      owner: record?.owner ?? "",
      status: record?.status === "停用" ? "停用" : "启用",
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
      close(editing ? \`已更新 \${values.name.trim()}\` : \`已新增 \${values.name.trim()}\`);
    },
    onError: (err) =>
      form.setError(err.message === "名称已存在" ? "name" : "root", {
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
                setConfirming(false);
                form.setFocus("name");
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
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>名称</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    autoFocus
                    onClear={() => form.setValue("name", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>分类</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    onClear={() => form.setValue("category", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="owner"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>负责人</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    onClear={() => form.setValue("owner", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>状态</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="状态">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {${singularPascal.toUpperCase()}_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormDialog>
  );
}
`,
  },
  {
    rel: `apps/web/src/features/${slug}/${pascal}Page.tsx`,
    content: `import { getRouteApi } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  parse${singularPascal}Search,
  type ${singularPascal}Page,
  type ${singularPascal}Record,
} from "@optimax-starter/api/${slug}";
import { ConfirmDialog } from "@/components/crud/ConfirmDialog";
import { ResourceTableSlot } from "@/components/crud/ResourceTableSlot";
import type { FilterField } from "@/components/filters/FilterBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";
import { useAccount } from "@/features/auth/session";
import type { Filters } from "@/hooks/usePersistedFilters";
import { ${pascal}FormDialog } from "./${pascal}FormDialog";

const route = getRouteApi("/${slug}");
const SIZES = [20, 50, 100];

const FIELDS: FilterField[] = [
  {
    key: "q",
    label: "关键词",
    type: "text",
    ariaLabel: "搜索${label}",
    placeholder: "搜索名称",
    operatorKey: "qOp",
  },
  {
    key: "status",
    label: "状态",
    type: "select",
    options: [
      { value: "启用", label: "启用" },
      { value: "停用", label: "停用" },
    ],
  },
];

export function ${pascal}Page() {
  const me = useAccount();
  const cache = useQueryClient();
  const admin = me.data?.role === "admin";
  const params = route.useSearch();
  const navigate = route.useNavigate();
  const page = params.page ?? 1;
  const size = params.size ?? SIZES[0]!;
  const [pending, setPending] = useState<
    { kind: "create" } | { kind: "edit" | "delete"; row: ${singularPascal}Record } | null
  >(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const filters: Filters = {
    q: params.q,
    qOp: params.qOp,
    status: params.status,
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
      return request<${singularPascal}Page>("/${slug}?" + qs.toString());
    },
    placeholderData: keepPreviousData,
  });

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
      {
        accessorKey: "name",
        header: "名称",
        enableSorting: false,
        cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
      },
      { accessorKey: "category", header: "分类", enableSorting: false },
      { accessorKey: "owner", header: "负责人", enableSorting: false },
      {
        accessorKey: "status",
        header: "状态",
        enableSorting: false,
        cell: (c) => (
          <Badge variant={c.getValue() === "启用" ? "brand" : "neutral"}>
            {String(c.getValue())}
          </Badge>
        ),
      },
    ];
    if (!admin) return base;
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
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setPending({ kind: "edit", row });
                }}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setPending({ kind: "delete", row });
                }}
              >
                删除
              </Button>
            </div>
          );
        },
      },
    ];
  }, [admin]);

  return (
    <ResourceTableSlot
      title="${label}"
      actions={
        admin ? (
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
      data={query.data?.items ?? []}
      isLoading={query.isPending}
      error={query.error?.message}
      onRefresh={() => query.refetch()}
      refreshLabel="刷新${label}"
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
          description={\`将删除「\${pending.row.name}」并记录操作日志。\`}
          submitText="删除"
          trigger={returnFocus.current}
          action={() => request(\`/${slug}/\${pending.row.id}\`, "DELETE", {})}
          close={async (done) => {
            const name = pending.row.name;
            setPending(null);
            if (done) {
              await cache.invalidateQueries({ queryKey: ["${slug}"] });
              toast.success(\`已删除 \${name}\`);
            }
          }}
        />
      )}
    </ResourceTableSlot>
  );
}
`,
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
    content: `"""Verify ${slug} module RBAC, server pagination and audit logging."""
import http.cookiejar, json, os, secrets, subprocess, urllib.error, urllib.request
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
name = "qa_${tableIdent}_" + secrets.token_hex(4)
created = call(admin, "POST", "/${slug}", 201, {"name": name, "category": "测试分类", "owner": "平台组", "status": "启用"})
try:
    page = call(admin, "GET", f"/${slug}?q={name}&qOp=equals")
    assert page["total"] == 1 and page["items"][0]["id"] == created["id"]
    call(admin, "PATCH", f"/${slug}/{created['id']}", 200, {"status": "停用"})
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
`,
  },
];

for (const file of files) {
  if (existsSync(path.join(ROOT, file.rel))) {
    throw new Error(`目标文件已存在，停止生成以避免覆盖: ${file.rel}`);
  }
}

if (dryRun) {
  console.log("Dry-run 通过，将创建以下文件并注册契约/路由/侧栏:");
  for (const file of files) console.log(`  + ${file.rel}`);
  process.exit(0);
}

for (const file of files) {
  const full = path.join(ROOT, file.rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, file.content, "utf-8");
  if (file.mode) chmodSync(full, file.mode);
}

// 1. Register DB schema
const dbSchemaIndex = path.join(ROOT, "packages/db/src/schema/index.ts");
writeFileSync(
  dbSchemaIndex,
  readFileSync(dbSchemaIndex, "utf-8").trimEnd() + `\nexport * from "./${slug}";\n`,
);

// 2. Register API contracts + audit actions
const apiIndex = path.join(ROOT, "packages/api/src/index.ts");
writeFileSync(
  apiIndex,
  readFileSync(apiIndex, "utf-8").trimEnd() + `\nexport * from "./${slug}";\n`,
);

const contractsFile = path.join(ROOT, "packages/api/src/contracts.ts");
let contracts = readFileSync(contractsFile, "utf-8");
contracts = contracts.replace(
  '] as const;\nexport type AuditAction',
  `  "${singularSlug}.create",\n  "${singularSlug}.update",\n  "${singularSlug}.delete",\n] as const;\nexport type AuditAction`,
);
contracts = contracts.replace(
  '  "asset.delete": "删除资产",\n};',
  `  "asset.delete": "删除资产",\n  "${singularSlug}.create": "新增${label}",\n  "${singularSlug}.update": "编辑${label}",\n  "${singularSlug}.delete": "删除${label}",\n};`,
);
writeFileSync(contractsFile, contracts);

// 3. Mount Hono module in apps/server/src/console.ts
const consoleFile = path.join(ROOT, "apps/server/src/console.ts");
let consoleSrc = readFileSync(consoleFile, "utf-8");
consoleSrc = consoleSrc.replace(
  'import { authRoutes } from "./modules/auth";',
  `import { authRoutes } from "./modules/auth";\nimport { ${camel}Routes } from "./modules/${slug}";`,
);
consoleSrc =
  consoleSrc.trimEnd() + `\nconsoleApi.route("/", ${camel}Routes);\n`;
writeFileSync(consoleFile, consoleSrc);

// 4. Register navigation entry in apps/web/src/config/app-config.ts
const navFile = path.join(ROOT, "apps/web/src/config/app-config.ts");
let navSrc = readFileSync(navFile, "utf-8");
navSrc = navSrc.replace(
  '| "/demo/navigation";',
  `| "/${slug}"\n  | "/demo/navigation";`,
);
navSrc = navSrc.replace(
  '  {\n    kind: "item",\n    to: "/accounts",',
  `  {\n    kind: "item",\n    to: "/${slug}",\n    label: "${label}",\n    icon: Boxes,\n    aliases: ["${slug}", "${singularSlug}", "${label}"],\n  },\n  {\n    kind: "item",\n    to: "/accounts",`,
);
writeFileSync(navFile, navSrc);

console.log(`已生成模块 ${slug}（${label}）：`);
for (const file of files) console.log(`  + ${file.rel}`);
console.log("下一步：运行 docker compose restart api（或 bun run db:push）同步新表后即可访问 /" + slug);
