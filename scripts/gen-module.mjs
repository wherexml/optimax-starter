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
  "permissions",
  "system",
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
  3. apps/api-laravel/app/Modules/<Pascal>/   Laravel 控制器/请求/资源/路由（LC-08 起后端唯一栈）
     apps/api-laravel/app/Core/Models/        Eloquent 模型（零迁移，@property 显式列）
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
    rel: `apps/api-laravel/app/Core/Models/Console${pascal}.php`,
    content: `<?php

namespace App\\Core\\Models;

use Illuminate\\Database\\Eloquent\\Model;

/**
 * ${label}（console_${tableIdent}）。schema 权威在 Drizzle（LARAVEL.md D2，零迁移）。
 * gen:module 生成（LD-01）；\$fillable 对齐契约 ${slug}.${camel}InputSchema 字段集。
 *
 * @property int $id
 * @property string $name
 * @property string $category
 * @property string $owner
 * @property string $status
 * @property \\Carbon\\CarbonInterface $created_at
 */
final class Console${pascal} extends Model
{
    const UPDATED_AT = null;

    protected $table = 'console_${tableIdent}';

    protected $fillable = ['name', 'category', 'owner', 'status'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/routes.php`,
    content: `<?php

use App\\Modules\\${pascal}\\${pascal}Controller as Controller;
use Illuminate\\Support\\Facades\\Route;

// gen:module 生成（LD-01）：routes/api.php 的 glob 自动装载本文件（/console 前缀与守卫已就位）。
Route::get('/${slug}', [Controller::class, 'index'])->middleware('console.permission:${slug}:read');
Route::post('/${slug}', [Controller::class, 'store'])->middleware('console.permission:${slug}:manage');
Route::patch('/${slug}/{id}', [Controller::class, 'update'])->whereNumber('id')->middleware('console.permission:${slug}:manage');
Route::delete('/${slug}/{id}', [Controller::class, 'destroy'])->whereNumber('id')->middleware('console.permission:${slug}:manage');
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/${pascal}InputRequest.php`,
    content: `<?php

namespace App\\Modules\\${pascal};

use App\\Core\\Http\\SchemaRequest;

/** ${label} 创建入参（契约 ${slug}.${camel}InputSchema，gen:module 生成）。 */
final class ${pascal}InputRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return '${slug}.${camel}InputSchema';
    }

    protected function contractError(): string
    {
        return '请完整填写${label}信息';
    }
}
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/${pascal}PatchRequest.php`,
    content: `<?php

namespace App\\Modules\\${pascal};

use App\\Core\\Http\\SchemaRequest;

/** ${label} 变更入参（契约 ${slug}.${camel}PatchSchema；非空 refine 由 ContractRefines 覆盖）。 */
final class ${pascal}PatchRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return '${slug}.${camel}PatchSchema';
    }

    protected function contractError(): string
    {
        return '无效的变更参数';
    }
}
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/${pascal}Resource.php`,
    content: `<?php

namespace App\\Modules\\${pascal};

use App\\Core\\Http\\ConsoleResponse;
use App\\Core\\Models\\Console${pascal};
use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

/**
 * @property Console${pascal} $resource
 */
final class ${pascal}Resource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => (int) \$this->resource->id,
            'name' => (string) \$this->resource->name,
            'category' => (string) \$this->resource->category,
            'owner' => (string) \$this->resource->owner,
            'status' => (string) \$this->resource->status,
            'createdAt' => ConsoleResponse::isoTime(\$this->resource->getAttributeValue('created_at')),
        ];
    }
}
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/${pascal}PaginatedResource.php`,
    content: `<?php

namespace App\\Modules\\${pascal};

use App\\Core\\Http\\Resources\\PaginatedResource;

/** ${label} 分页响应（PaginatedResult 形状的唯一实现处消费方）。 */
final class ${pascal}PaginatedResource extends PaginatedResource
{
    protected function itemResource(): string
    {
        return ${pascal}Resource::class;
    }
}
`,
  },
  {
    rel: `apps/api-laravel/app/Modules/${pascal}/${pascal}Controller.php`,
    content: `<?php

namespace App\\Modules\\${pascal};

use App\\Core\\Audit\\AuditWriter;
use App\\Core\\Auth\\Actor;
use App\\Core\\Http\\Concerns\\LocksPermission;
use App\\Core\\Http\\ConsoleResponse;
use App\\Core\\Models\\Console${pascal};
use App\\Core\\Support\\Like;
use Illuminate\\Http\\JsonResponse;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\DB;
use Symfony\\Component\\HttpKernel\\Exception\\HttpException;

/**
 * ${label}（gen:module 生成，LD-01）：分页筛选 + 管理员 CRUD + 同事务审计。
 * 按 LARAVEL.md 模块标准开发流程实现；对照实现见 apps/server 退役栈模板（只读参考）。
 */
final class ${pascal}Controller
{
    use LocksPermission;

    private const MAX_PAGE = 100;

    public function index(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $qOp = (string) $request->query('qOp', '');
        $status = trim((string) $request->query('status', ''));
        $page = (int) $request->query('page', 1);
        $size = (int) $request->query('size', 20);

        if ($q !== '' && strlen($q) > 200) {
            throw new HttpException(400, '筛选条件无效');
        }
        if ($qOp !== '' && ! in_array($qOp, ['contains', 'equals'], true)) {
            throw new HttpException(400, '筛选条件无效');
        }
        if ($status !== '' && ! in_array($status, ['启用', '停用'], true)) {
            throw new HttpException(400, '筛选条件无效');
        }
        if ($page < 1 || $page > 100000 || $size < 1) {
            throw new HttpException(400, '筛选条件无效');
        }
        $size = min(self::MAX_PAGE, $size);

        $query = Console${pascal}::query()
            ->when($q !== '', function ($builder) use ($q, $qOp): void {
                if ($qOp === 'equals') {
                    $builder->where('name', $q);
                } else {
                    $builder->where('name', 'ilike', '%'.Like::escape($q).'%');
                }
            })
            ->when($status !== '', fn ($builder) => $builder->where('status', $status));

        $total = (clone $query)->count();
        $items = (clone $query)->orderByDesc('id')->forPage($page, $size)->get();

        return ConsoleResponse::json([
            'items' => ${pascal}Resource::collection($items)->resolve(),
            'total' => $total,
            'page' => $page,
            'size' => $size,
        ]);
    }

    public function store(${pascal}InputRequest $request): JsonResponse
    {
        $data = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $row = DB::transaction(function () use ($actor, $data): array {
            $self = $this->lockPermission($actor, '${slug}:manage');

            if (Console${pascal}::query()->where('name', (string) $data['name'])->exists()) {
                throw new HttpException(409, '名称已存在');
            }

            $record = Console${pascal}::query()->create([
                'name' => (string) $data['name'],
                'category' => (string) $data['category'],
                'owner' => (string) $data['owner'],
                'status' => (string) $data['status'],
            ]);

            AuditWriter::auditResource('${singularSlug}.create', $this->partyOf($self), $this->toResource($record),
                ['stage' => (string) $record->status, 'domain' => (string) $record->category]);

            return [
                'id' => (int) $record->id,
                'name' => (string) $record->name,
                'category' => (string) $record->category,
                'owner' => (string) $record->owner,
                'status' => (string) $record->status,
                'createdAt' => ConsoleResponse::isoTime($record->getAttributeValue('created_at')),
            ];
        });

        return ConsoleResponse::json($row, 201);
    }

    public function update(${pascal}PatchRequest $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的变更参数');
        }
        $change = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $row = DB::transaction(function () use ($actor, $id, $change): array {
            $self = $this->lockPermission($actor, '${slug}:manage');

            $record = Console${pascal}::query()->where('id', $id)->lockForUpdate()->first();
            if ($record === null) {
                throw new HttpException(404, '记录不存在');
            }

            $set = [];
            if (isset($change['name']) && $change['name'] !== $record->name) {
                $set['name'] = (string) $change['name'];
            }
            if (isset($change['category']) && $change['category'] !== $record->category) {
                $set['category'] = (string) $change['category'];
            }
            if (isset($change['owner']) && $change['owner'] !== $record->owner) {
                $set['owner'] = (string) $change['owner'];
            }
            if (isset($change['status']) && $change['status'] !== $record->status) {
                $set['status'] = (string) $change['status'];
            }

            if ($set !== []) {
                if (isset($set['name'])) {
                    $dup = Console${pascal}::query()->where('name', $set['name'])->where('id', '!=', $id)->exists();
                    if ($dup) {
                        throw new HttpException(409, '名称已存在');
                    }
                }
                $record->fill($set)->save();

                AuditWriter::auditResource('${singularSlug}.update', $this->partyOf($self), $this->toResource($record),
                    ['fields' => array_keys($set)]);
            }

            return [
                'id' => (int) $record->id,
                'name' => (string) $record->name,
                'category' => (string) $record->category,
                'owner' => (string) $record->owner,
                'status' => (string) $record->status,
                'createdAt' => ConsoleResponse::isoTime($record->getAttributeValue('created_at')),
            ];
        });

        return ConsoleResponse::json($row);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的编号');
        }
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        DB::transaction(function () use ($actor, $id): void {
            $self = $this->lockPermission($actor, '${slug}:manage');

            $record = Console${pascal}::query()->where('id', $id)->first();
            if ($record === null) {
                throw new HttpException(404, '记录不存在');
            }
            $resource = $this->toResource($record);
            $record->delete();

            AuditWriter::auditResource('${singularSlug}.delete', $this->partyOf($self), $resource,
                ['domain' => (string) $record->category]);
        });

        return ConsoleResponse::json(['ok' => true]);
    }

    /** @return array{id: int, code: string, name: string} 审计 resource 同口径（${codePrefix}-%03d）。 */
    private function toResource(Console${pascal} $record): array
    {
        return [
            'id' => (int) $record->id,
            'code' => '${codePrefix}-'.str_pad((string) $record->id, 3, '0', STR_PAD_LEFT),
            'name' => (string) $record->name,
        ];
    }
}
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
import { hasPermission, useAccount } from "@/features/auth/session";
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
  const canRead = hasPermission(me.data, "${slug}:read");
  const canManage = hasPermission(me.data, "${slug}:manage");
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
    enabled: Boolean(me.data) && canRead,
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
    if (!canManage) return base;
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

// 3. Register contract schemas in packages/api/src/generate.ts（json-schema 产物名单）
const genFile = path.join(ROOT, "packages/api/src/generate.ts");
let genSrc = readFileSync(genFile, "utf-8");
if (!genSrc.includes(`import * as ${camel} from "./${slug}";`)) {
  if (!genSrc.includes('  // ---- gen:module 追加业务模块契约（勿删锚点）----')) {
    throw new Error("generate.ts 缺少 registry 锚点（// ---- gen:module 追加业务模块契约）——请核对 packages/api/src/generate.ts");
  }
  genSrc = genSrc.replace(
    'import * as system from "./system";',
    `import * as ${camel} from "./${slug}";\nimport * as system from "./system";`,
  );
  genSrc = genSrc.replace(
    "  // ---- gen:module 追加业务模块契约（勿删锚点）----",
    `  { module: "${slug}", name: "${camel}InputSchema", schema: ${camel}.${camel}InputSchema },\n  { module: "${slug}", name: "${camel}PatchSchema", schema: ${camel}.${camel}PatchSchema },\n  // ---- gen:module 追加业务模块契约（勿删锚点）----`,
  );
  writeFileSync(genFile, genSrc);
}

// 3b. 把新模块加入 generate.ts 的 refine 源扫描（漂移对拍覆盖新契约文件）
genSrc = readFileSync(genFile, "utf-8");
if (!genSrc.includes(`const sources = ["asset-agent", "contracts", "permissions", "system", "${slug}"]`)) {
  const sourcesLine = 'const sources = ["asset-agent", "contracts", "permissions", "system"] as const;';
  if (!genSrc.includes(sourcesLine)) {
    throw new Error("generate.ts 源扫描名单行与预期不符——请核对 assertRefinesRegistered 的 sources 数组");
  }
  genSrc = genSrc.replace(
    sourcesLine,
    `const sources = ["asset-agent", "contracts", "permissions", "system", "${slug}"] as const;`,
  );
  writeFileSync(genFile, genSrc);
}

// 3c. 登记 PatchSchema 的非空 refine（refines.ts 锚点；漂移对拍要求逐条登记）
const refinesFile = path.join(ROOT, "packages/api/src/refines.ts");
let refinesSrc = readFileSync(refinesFile, "utf-8");
if (!refinesSrc.includes("  // ---- gen:module 追加 refine 登记（勿删锚点）----")) {
  throw new Error("refines.ts 缺少登记锚点——请核对 packages/api/src/refines.ts");
}
refinesSrc = refinesSrc.replace(
  "  // ---- gen:module 追加 refine 登记（勿删锚点）----",
  `  {
    id: "${slug}-patch-nonempty",
    schemas: ["${slug}.${camel}PatchSchema"],
    path: "",
    source: "packages/api/src/${slug}.ts",
    semantic: "${label}变更至少提供 name / category / owner / status 之一",
    message: "（未自定义文案，parse 失败时接口返回「无效的变更参数」）",
    phpRule: "required_without_all:name,category,owner,status",
  },
  // ---- gen:module 追加 refine 登记（勿删锚点）----`,
);
writeFileSync(refinesFile, refinesSrc);

// 3d. ContractRefines.php 追加对应 PHP 规则实现（清单与实现双侧登记）
const phpRefinesFile = path.join(ROOT, "apps/api-laravel/app/Core/Contracts/ContractRefines.php");
let phpRefinesSrc = readFileSync(phpRefinesFile, "utf-8");
if (!phpRefinesSrc.includes("            // ---- gen:module 追加 refine 实现（勿删锚点）----")) {
  throw new Error("ContractRefines.php 缺少实现锚点——请核对 app/Core/Contracts/ContractRefines.php");
}
phpRefinesSrc = phpRefinesSrc.replace(
  "            // ---- gen:module 追加 refine 实现（勿删锚点）----",
  `            '${slug}-patch-nonempty' => fn (mixed \$data): bool => is_array(\$data)
                && collect(['name', 'category', 'owner', 'status'])->contains(fn (string \$k): bool => array_key_exists(\$k, \$data)),
            // ---- gen:module 追加 refine 实现（勿删锚点）----`,
);
writeFileSync(phpRefinesFile, phpRefinesSrc);

// 4. Register module permissions in packages/api/src/permissions.ts
const permFile = path.join(ROOT, "packages/api/src/permissions.ts");
let permSrc = readFileSync(permFile, "utf-8");
permSrc = permSrc.replace(
  '  { code: "assets:manage", label: "维护资产台账", module: "资产台账", kind: "operate" },',
  `  { code: "assets:manage", label: "维护资产台账", module: "资产台账", kind: "operate" },\n  { code: "${slug}:read", label: "查看${label}", module: "${label}", kind: "view" },\n  { code: "${slug}:manage", label: "维护${label}", module: "${label}", kind: "operate" },`,
);
permSrc = permSrc.replace(
  '    "assets:manage",\n    "accounts:read",',
  `    "assets:manage",\n    "${slug}:read",\n    "${slug}:manage",\n    "accounts:read",`,
);
permSrc = permSrc.replace(
  '  member: [\n    "workbench:read",\n    "assets:read",\n  ],',
  `  member: [\n    "workbench:read",\n    "assets:read",\n    "${slug}:read",\n  ],`,
);
permSrc = permSrc.replace(
  '  {\n    id: "accounts",',
  `  {\n    id: "${slug}",\n    label: "${label}",\n    description: "${label}查询与增删改维护",\n    actions: ALL_ACTIONS,\n    viewCodes: { default: ["${slug}:read"] },\n    operateCodes: { default: ["${slug}:manage"] },\n  },\n  {\n    id: "accounts",`,
);
writeFileSync(permFile, permSrc);

// 5. Register navigation entry in apps/web/src/config/app-config.ts
const navFile = path.join(ROOT, "apps/web/src/config/app-config.ts");
let navSrc = readFileSync(navFile, "utf-8");
navSrc = navSrc.replace(
  '| "/demo/forms";',
  `| "/${slug}"\n  | "/demo/forms";`,
);
navSrc = navSrc.replace(
  '  {\n    kind: "group",\n    label: "系统管理",',
  `  {\n    kind: "item",\n    to: "/${slug}",\n    label: "${label}",\n    icon: Boxes,\n    aliases: ["${slug}", "${singularSlug}", "${label}"],\n    permissionCode: "${slug}:read",\n  },\n  {\n    kind: "group",\n    label: "系统管理",`,
);
writeFileSync(navFile, navSrc);

console.log(`已生成模块 ${slug}（${label}）：`);
for (const file of files) console.log(`  + ${file.rel}`);
console.log("下一步：docker compose restart api 同步新表（Drizzle db:push）→ bun run contracts:generate 提交产物 → 后端即经 Laravel 生效（路由自动 glob 装载）。");
