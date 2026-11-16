import { useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { request, type Asset } from "@/console-client";
import { DataTable } from "@/components/table/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  FieldCharCount,
  FieldHint,
  FieldLabelRow,
  FieldLayout,
} from "@/components/ui/field";
import { ClearableInput, CopyableInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SwitchField } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { toast } from "@/components/ui/toast";
import { ContentRefresh } from "@optimax-starter/ui/components/content-refresh";
import {
  CONNECTOR_MODES,
  ComplexFormDialog,
  type ConnectorMode,
  type ConnectorPolicyRecord,
  type ConnectorPolicyValues,
  validateScopeTag,
} from "./ComplexFormDialog";

const route = getRouteApi("/demo/forms");

const DEFAULT_DOMAINS = ["采购", "履约", "财务", "运营", "基础设施", "安全治理"];
const DEFAULT_OWNERS: ComboboxOption[] = [
  { value: "平台组", label: "平台组", hint: "网关、基础设施与容器集群" },
  { value: "安全运营组", label: "安全运营组", hint: "外部攻击面、证书与策略核验" },
  { value: "供应链研发", label: "供应链研发", hint: "采购、供应商协同与履约系统" },
  { value: "数据工程组", label: "数据工程组", hint: "湖仓同步、报表与指标服务" },
  { value: "企业IT组", label: "企业IT组", hint: "身份目录、终端与办公网络" },
];

const INITIAL_POLICIES: ConnectorPolicyRecord[] = [
  {
    id: 1,
    name: "核心云网关资产同步",
    owner: "平台组",
    domains: ["基础设施", "运营"],
    mode: "api",
    defaultStage: "待复核",
    endpointHost: "gateway-sync.internal.optimax.hk/v1/assets",
    secret: "omx_live_9K3pW7vR2xN8qL4m",
    intervalMinutes: 30,
    concurrency: 6,
    allowlist: ["*.optimax.hk", "10.20.0.0/16"],
    notes: "每 30 分钟增量拉取生产网关路由与外部域名映射。",
    autoReview: true,
    auditStrict: true,
    updatedAt: "2026-11-16 10:00",
  },
  {
    id: 2,
    name: "采购与供应商门户 Webhook",
    owner: "供应链研发",
    domains: ["采购", "履约"],
    mode: "webhook",
    defaultStage: "已登记",
    endpointHost: "scm-events.internal.optimax.hk/hooks/cmdb",
    secret: "omx_hook_5H8tY2nB6cM9pQ3z",
    intervalMinutes: 15,
    concurrency: 4,
    allowlist: ["scm.optimax.hk", "vendor.optimax.hk"],
    notes: "发布流水线变更后实时推送服务端点。",
    autoReview: false,
    auditStrict: true,
    updatedAt: "2026-11-16 11:30",
  },
];

const MODE_LABELS: Record<ConnectorMode, string> = {
  api: "API 轮询",
  webhook: "Webhook 推送",
  agent: "Agent 上报",
};

export function FormsDemoPage() {
  const { dialog } = route.useSearch();
  const navigate = route.useNavigate();

  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const editTriggerRef = useRef<HTMLElement | null>(null);

  const [policies, setPolicies] = useState<ConnectorPolicyRecord[]>(INITIAL_POLICIES);
  const [editingTarget, setEditingTarget] = useState<ConnectorPolicyRecord | undefined>(
    undefined,
  );

  const assetsQuery = useQuery({
    queryKey: ["forms-demo-assets"],
    queryFn: () => request<Asset[]>("/assets"),
  });

  const domainOptions = useMemo<MultiSelectOption[]>(() => {
    const set = new Set(DEFAULT_DOMAINS);
    for (const item of assetsQuery.data ?? []) {
      if (item.domain?.trim()) set.add(item.domain.trim());
    }
    return [...set].map((value) => ({ value, label: value }));
  }, [assetsQuery.data]);

  const ownerOptions = useMemo<ComboboxOption[]>(() => {
    const map = new Map(DEFAULT_OWNERS.map((o) => [o.value, o]));
    for (const item of assetsQuery.data ?? []) {
      const owner = item.owner?.trim();
      if (owner && !map.has(owner)) {
        map.set(owner, { value: owner, label: owner, hint: "来自当前资产台账" });
      }
    }
    return [...map.values()];
  }, [assetsQuery.data]);

  const openCreate = () => {
    setEditingTarget(undefined);
    void navigate({ search: { dialog: "create" }, replace: true });
  };

  const openEdit = (row: ConnectorPolicyRecord, opener: HTMLElement | null) => {
    editTriggerRef.current = opener;
    setEditingTarget(row);
    void navigate({ search: { dialog: "edit" }, replace: true });
  };

  const closeDialog = () => {
    void navigate({ search: {}, replace: true });
  };

  const activeEditRecord =
    dialog === "edit" ? (editingTarget ?? policies[0]) : undefined;

  const columns = useMemo<ColumnDef<ConnectorPolicyRecord>[]>(
    () => [
      {
        accessorKey: "name",
        header: "策略名称",
        cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
      },
      {
        accessorKey: "mode",
        header: "接入方式",
        cell: (c) => (
          <Badge variant="brand">
            {MODE_LABELS[c.getValue() as ConnectorMode]}
          </Badge>
        ),
      },
      {
        accessorKey: "owner",
        header: "责任团队",
      },
      {
        accessorKey: "domains",
        header: "覆盖业务域",
        cell: (c) => (c.getValue() as string[]).join("、"),
      },
      {
        accessorKey: "concurrency",
        header: "并发 / 周期",
        cell: (c) => {
          const row = c.row.original;
          return (
            <span className="tabular-nums text-muted-foreground">
              {row.concurrency} 路
              {row.mode === "api" ? ` / ${row.intervalMinutes} 分钟` : " / 实时"}
            </span>
          );
        },
      },
      {
        id: "action",
        header: "操作",
        cell: (c) => {
          const row = c.row.original;
          return (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`编辑策略 ${row.name}`}
              onClick={(e) => openEdit(row, e.currentTarget)}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [policies],
  );

  return (
    <>
      <PageHeader
        title="表单弹窗"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={(e) => openEdit(policies[0]!, e.currentTarget)}
            >
              预填编辑弹窗
            </Button>
            <Button ref={createTriggerRef} type="button" onClick={openCreate}>
              <Plus size={16} />
              新建接入策略
            </Button>
          </div>
        }
      />

      <ContentRefresh
        loading={assetsQuery.isLoading}
        layout="table"
        logoSrc={APP_CONFIG.logoSrc}
      >
        <div className="flex flex-col gap-5">
          <DataTable
            data={policies}
            columns={columns}
            isLoading={assetsQuery.isLoading}
            error={assetsQuery.error?.message}
          />

          <StandaloneControlsShowcase
            domainOptions={domainOptions}
            ownerOptions={ownerOptions}
          />

          <GlobalNotificationShowcase />
        </div>
      </ContentRefresh>

      {(dialog === "create" || (dialog === "edit" && activeEditRecord)) && (
        <ComplexFormDialog
          record={activeEditRecord}
          existingNames={policies.map((p) => p.name)}
          domainOptions={domainOptions}
          ownerOptions={ownerOptions}
          trigger={
            dialog === "edit"
              ? editTriggerRef.current
              : createTriggerRef.current
          }
          onSave={(values: ConnectorPolicyValues) => {
            const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
            if (dialog === "edit" && activeEditRecord) {
              setPolicies((prev) =>
                prev.map((item) =>
                  item.id === activeEditRecord.id
                    ? { ...item, ...values, updatedAt: stamp }
                    : item,
                ),
              );
              toast.success(`已保存策略 ${values.name}`);
            } else {
              setPolicies((prev) => [
                {
                  id: Date.now(),
                  ...values,
                  updatedAt: stamp,
                },
                ...prev,
              ]);
              toast.success(`已创建策略 ${values.name}`);
            }
            closeDialog();
          }}
          close={closeDialog}
        />
      )}
    </>
  );
}

function StandaloneControlsShowcase({
  domainOptions,
  ownerOptions,
}: {
  domainOptions: MultiSelectOption[];
  ownerOptions: ComboboxOption[];
}) {
  const [keyword, setKeyword] = useState("gateway.optimax.hk");
  const [secret, setSecret] = useState("omx_demo_SecretKey2026!");
  const [owner, setOwner] = useState("平台组");
  const [domains, setDomains] = useState<string[]>(["采购", "基础设施"]);
  const [rate, setRate] = useState<number | "">(120);
  const [mode, setMode] = useState<ConnectorMode>("api");
  const [tags, setTags] = useState<string[]>(["*.optimax.hk", "10.0.0.0/8"]);
  const [tagErr, setTagErr] = useState("");
  const [strictTls, setStrictTls] = useState(true);

  return (
    <section className="panel" aria-label="标准化输入控件一览">
      <div className="panel-head">
        <h2>共享输入控件速查（@optimax-starter/ui）</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FieldLayout>
          <FieldLabelRow>
            <Label htmlFor="showcase-clearable" required>
              前后缀与一键清空
            </Label>
            <FieldCharCount current={keyword.length} max={64} />
          </FieldLabelRow>
          <ClearableInput
            id="showcase-clearable"
            prefixText="https://"
            value={keyword}
            maxLength={64}
            onChange={(e) => setKeyword(e.target.value)}
            onClear={() => setKeyword("")}
          />
        </FieldLayout>

        <FieldLayout>
          <Label htmlFor="showcase-password" required>
            密码框（显隐与随机生成）
          </Label>
          <PasswordInput
            id="showcase-password"
            toggleLabel="示例密钥"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onGenerate={setSecret}
          />
        </FieldLayout>

        <FieldLayout>
          <Label htmlFor="showcase-copy">只读与一键复制</Label>
          <CopyableInput
            id="showcase-copy"
            value="https://console.optimax.hk/console/hooks"
            copyLabel="复制示例地址"
          />
        </FieldLayout>

        <FieldLayout>
          <Label htmlFor="showcase-combobox" required>
            可搜索单选组合框
          </Label>
          <Combobox
            id="showcase-combobox"
            label="可搜索单选组合框"
            value={owner}
            onValueChange={setOwner}
            options={ownerOptions}
            allowClear
          />
        </FieldLayout>

        <FieldLayout>
          <Label htmlFor="showcase-multiselect" required>
            复选多选下拉
          </Label>
          <MultiSelect
            id="showcase-multiselect"
            label="复选多选下拉"
            options={domainOptions}
            value={domains}
            onValueChange={setDomains}
            searchable
          />
        </FieldLayout>

        <FieldLayout>
          <Label htmlFor="showcase-number" required>
            数值步进与单位
          </Label>
          <NumberInput
            id="showcase-number"
            label="请求速率上限"
            value={rate}
            onValueChange={setRate}
            min={10}
            max={1000}
            step={10}
            unit="次/分"
          />
        </FieldLayout>

        <FieldLayout>
          <Label>分段单选</Label>
          <SegmentedControl
            label="示例接入模式"
            value={mode}
            onValueChange={setMode}
            options={CONNECTOR_MODES}
          />
        </FieldLayout>

        <FieldLayout className="sm:col-span-2">
          <FieldLabelRow>
            <Label htmlFor="showcase-tags">多值胶囊标签输入</Label>
            <FieldCharCount current={tags.length} max={8} />
          </FieldLabelRow>
          <TagInput
            id="showcase-tags"
            value={tags}
            onValueChange={setTags}
            maxTags={8}
            validateTag={validateScopeTag}
            onRejectTag={setTagErr}
          />
          {tagErr ? (
            <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
              {tagErr}
            </p>
          ) : (
            <FieldHint>输入后按 Enter 或逗号生成标签，Backspace 删除末项</FieldHint>
          )}
        </FieldLayout>

        <div className="sm:col-span-2 lg:col-span-3">
          <SwitchField
            label="启用双向证书核验"
            description="关闭时仅校验签名令牌；开启后同时验证客户端证书链"
            checked={strictTls}
            onCheckedChange={setStrictTls}
          />
        </div>
      </div>
    </section>
  );
}

function GlobalNotificationShowcase() {
  return (
    <section className="panel" aria-label="全局通知速查">
      <div className="panel-head">
        <h2>全局通知速查（右下角堆栈）</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            toast.success("策略配置已同步", {
              description: "已下发至 6 个边缘采集节点",
            })
          }
        >
          成功通知
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            toast.info("后台巡检队列空闲", {
              description: "下次全量资产核验将在 15 分钟后启动",
            })
          }
        >
          提示信息
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            toast.warning("证书即将到期", {
              description: "gateway.optimax.hk 剩余有效期不足 7 天",
            })
          }
        >
          风险警告
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            toast.error("连接目标网关超时", {
              description: "请检查安全组放行策略后重试",
            })
          }
        >
          异常告警
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const task = new Promise<string>((resolve) =>
              window.setTimeout(() => resolve("巡检快照已生成"), 480),
            );
            void toast.promise(task, {
              loading: "正在拉取网关资产快照…",
              success: (msg) => ({
                title: msg,
                description: "共核验 12 条台账记录",
              }),
              error: "拉取资产快照失败",
            });
          }}
        >
          异步进度
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            toast("已归档接入策略", {
              description: "归档期间暂停周期轮询",
              action: {
                label: "撤销",
                onAction: () => {
                  toast.success("已恢复接入策略");
                },
              },
            })
          }
        >
          带撤销操作
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            toast.info("已发现新子域 edge-01.optimax.hk");
            toast.warning("供应商门户响应耗时偏高", {
              description: "最近 5 分钟 P95 达到 860ms",
            });
            toast.success("增量资产核验已完成", {
              description: "本批次同步 12 条记录，0 条冲突",
            });
          }}
        >
          连发堆叠
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => toast.dismiss()}
        >
          清空通知
        </Button>
      </div>
    </section>
  );
}
