import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Globe, Link2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  FieldCharCount,
  FieldHint,
  FieldLabelRow,
  FieldLayout,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormSection,
} from "@/components/ui/form";
import {
  ClearableInput,
  CopyableInput,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import { PasswordInput, generateSecurePassword } from "@/components/ui/password-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";

export const CONNECTOR_MODES = [
  { value: "api", label: "API 轮询" },
  { value: "webhook", label: "Webhook 推送" },
  { value: "agent", label: "Agent 上报" },
] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number]["value"];

const SCOPE_TOKEN_RE = /^[a-zA-Z0-9*._:/-]+$/;

export const connectorPolicySchema = z.object({
  name: z.string().trim().min(1, "请输入策略名称").max(60, "策略名称最多 60 个字符"),
  owner: z.string().trim().min(1, "请选择责任团队"),
  domains: z.array(z.string()).min(1, "请至少选择一个覆盖业务域"),
  mode: z.enum(["api", "webhook", "agent"]),
  defaultStage: z.enum(["待复核", "已登记"]),
  endpointHost: z
    .string()
    .trim()
    .min(1, "请输入接入主机或路径")
    .max(120, "接入地址最多 120 个字符")
    .refine((v) => !/^https?:\/\//i.test(v) && !/\s/.test(v), "无需填写协议头且不能包含空格"),
  secret: z.string().min(12, "接入密钥至少 12 位").max(128, "接入密钥最多 128 位"),
  intervalMinutes: z
    .number({ message: "请输入有效分钟数" })
    .int()
    .min(5, "最小间隔 5 分钟")
    .max(1440, "最大间隔 1440 分钟"),
  concurrency: z
    .number({ message: "请输入有效并发数" })
    .int()
    .min(1, "至少 1 路并发")
    .max(32, "最多 32 路并发"),
  allowlist: z
    .array(z.string())
    .min(1, "请至少添加一项白名单目标")
    .max(12, "最多添加 12 项"),
  notes: z.string().max(300, "说明最多 300 个字符"),
  autoReview: z.boolean(),
  auditStrict: z.boolean(),
});

export type ConnectorPolicyValues = z.infer<typeof connectorPolicySchema>;

export interface ConnectorPolicyRecord extends ConnectorPolicyValues {
  id: number;
  updatedAt: string;
}

export function validateScopeTag(token: string): string | null {
  if (token.length > 64) return "单项长度不能超过 64 个字符";
  if (!SCOPE_TOKEN_RE.test(token)) return "仅支持域名、IP、CIDR 或通配符（如 *.optimax.hk）";
  return null;
}

export function ComplexFormDialog({
  record,
  existingNames,
  domainOptions,
  ownerOptions,
  trigger,
  onSave,
  close,
}: {
  record?: ConnectorPolicyRecord;
  existingNames: string[];
  domainOptions: MultiSelectOption[];
  ownerOptions: ComboboxOption[];
  trigger: HTMLElement | null;
  onSave: (values: ConnectorPolicyValues) => void;
  close: () => void;
}) {
  const editing = Boolean(record);
  const form = useForm<ConnectorPolicyValues>({
    resolver: zodResolver(connectorPolicySchema),
    defaultValues: record
      ? {
          name: record.name,
          owner: record.owner,
          domains: record.domains,
          mode: record.mode,
          defaultStage: record.defaultStage,
          endpointHost: record.endpointHost,
          secret: record.secret,
          intervalMinutes: record.intervalMinutes,
          concurrency: record.concurrency,
          allowlist: record.allowlist,
          notes: record.notes,
          autoReview: record.autoReview,
          auditStrict: record.auditStrict,
        }
      : {
          name: "",
          owner: "",
          domains: [],
          mode: "api",
          defaultStage: "待复核",
          endpointHost: "",
          secret: "",
          intervalMinutes: 30,
          concurrency: 4,
          allowlist: ["10.20.0.0/16"],
          notes: "",
          autoReview: true,
          auditStrict: true,
        },
  });

  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagError, setTagError] = useState("");

  const nameValue = form.watch("name");
  const modeValue = form.watch("mode");
  const notesValue = form.watch("notes");

  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("name");
  };

  const fillSample = () => {
    form.reset(
      {
        name: editing ? record!.name : "云原生网关资产巡检",
        owner: ownerOptions[0]?.value ?? "平台组",
        domains: domainOptions.slice(0, 2).map((d) => d.value),
        mode: "api",
        defaultStage: "待复核",
        endpointHost: "cmdb-gateway.internal.optimax.hk/api/v2",
        secret: generateSecurePassword(24),
        intervalMinutes: 15,
        concurrency: 8,
        allowlist: ["*.optimax.hk", "10.20.0.0/16", "172.16.10.0/24"],
        notes: "按业务域增量同步网关与证书资产，变更项先进入待复核队列由责任团队确认。",
        autoReview: true,
        auditStrict: true,
      },
      { keepDefaultValues: true },
    );
    setTagError("");
  };

  const submit = form.handleSubmit((values) => {
    const trimmed = values.name.trim();
    const conflict = existingNames.some(
      (n) => n === trimmed && (!editing || n !== record!.name),
    );
    if (conflict) {
      form.setError(
        "name",
        { message: "策略名称已存在，请使用其他名称" },
        { shouldFocus: true },
      );
      return;
    }
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      onSave({ ...values, name: trimmed });
    }, 150);
  });

  const callbackUrl =
    modeValue === "agent"
      ? "https://console.optimax.hk/agent/register"
      : "https://console.optimax.hk/console/hooks/collector";

  return (
    <FormDialog
      open
      title={editing ? "编辑采集接入策略" : "新建采集接入策略"}
      size="lg"
      submitText={editing ? "保存修改" : "保存策略"}
      loading={saving}
      formId="complex-connector-form"
      footerStart={
        <div className="flex flex-wrap items-center gap-2">
          <span>带 * 项为必填</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={fillSample}
            className="text-primary hover:text-primary"
          >
            <Sparkles className="size-3.5" />
            填充示例数据
          </Button>
        </div>
      }
      unsaved={
        confirming
          ? {
              onKeepEditing: keepEditing,
              onDiscard: () => close(),
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
        if (open || saving) return;
        if (confirming) keepEditing();
        else if (isDirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="complex-connector-form"
          onSubmit={submit}
          className="flex flex-col gap-5"
        >
          <FormSection title="基础标识与归属">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelRow>
                    <FormLabel required>策略名称</FormLabel>
                    <FieldCharCount current={nameValue.length} max={60} />
                  </FieldLabelRow>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      autoFocus
                      autoComplete="off"
                      maxLength={60}
                      placeholder="例如：生产核心网关资产同步"
                      onClear={() => form.setValue("name", "", { shouldDirty: true })}
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
                  <FormLabel required>责任团队</FormLabel>
                  <FormControl>
                    <Combobox
                      label="责任团队"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={ownerOptions}
                      placeholder="搜索或选择责任团队"
                      searchPlaceholder="输入团队名称或职责关键字…"
                      allowClear
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="domains"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>覆盖业务域</FormLabel>
                  <FormControl>
                    <MultiSelect
                      label="覆盖业务域"
                      options={domainOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="选择至少一个业务域"
                      searchable
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultStage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>默认入库状态</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label="默认入库状态">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="待复核">待复核</SelectItem>
                      <SelectItem value="已登记">已登记</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel required>接入方式</FormLabel>
                  <FormControl>
                    <SegmentedControl
                      label="接入方式"
                      value={field.value}
                      onValueChange={field.onChange}
                      options={CONNECTOR_MODES}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection title="连接凭证与采集限流">
            <FormField
              control={form.control}
              name="endpointHost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>接入地址</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupAddon align="inline-start" surface="muted" className="font-mono text-xs">
                        https://
                      </InputGroupAddon>
                      <InputGroupInput
                        {...field}
                        autoComplete="off"
                        placeholder="gateway.internal.optimax.hk/v1"
                      />
                      <InputGroupAddon align="inline-end">
                        <Globe className="size-4" />
                      </InputGroupAddon>
                    </InputGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="secret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>接入密钥</FormLabel>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      toggleLabel="接入密钥"
                      generateLength={24}
                      autoComplete="new-password"
                      placeholder="至少 12 位，可一键随机生成"
                      onGenerate={(generated) =>
                        form.setValue("secret", generated, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FieldLayout className="sm:col-span-2">
              <Label htmlFor="demo-callback-url">平台回调地址</Label>
              <CopyableInput
                id="demo-callback-url"
                value={callbackUrl}
                disabled={modeValue === "agent"}
                copyLabel="复制回调地址"
                startIcon={<Link2 />}
              />
              <FieldHint>
                {modeValue === "agent"
                  ? "当前为 Agent 上报模式，由探针主动建立长连接，无需配置被动回调地址"
                  : "只读系统地址，点击右侧复制图标可写入剪贴板"}
              </FieldHint>
            </FieldLayout>

            <FormField
              control={form.control}
              name="intervalMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>轮询周期</FormLabel>
                  <FormControl>
                    <NumberInput
                      label="轮询周期"
                      value={field.value}
                      onValueChange={(next) =>
                        field.onChange(next === "" ? 5 : next)
                      }
                      min={5}
                      max={1440}
                      step={5}
                      unit="分钟"
                      disabled={modeValue !== "api"}
                    />
                  </FormControl>
                  {modeValue !== "api" && (
                    <FieldHint>仅 API 轮询模式需要固定周期，推送与上报实时触发</FieldHint>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="concurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>并发上限</FormLabel>
                  <FormControl>
                    <NumberInput
                      label="并发上限"
                      value={field.value}
                      onValueChange={(next) =>
                        field.onChange(next === "" ? 1 : next)
                      }
                      min={1}
                      max={32}
                      step={1}
                      unit="路"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allowlist"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FieldLabelRow>
                    <FormLabel required>采集范围白名单</FormLabel>
                    <FieldCharCount current={field.value.length} max={12} />
                  </FieldLabelRow>
                  <FormControl>
                    <TagInput
                      value={field.value}
                      onValueChange={field.onChange}
                      maxTags={12}
                      placeholder="输入域名或 CIDR（如 *.optimax.hk）后按 Enter 或逗号添加"
                      validateTag={validateScopeTag}
                      onRejectTag={setTagError}
                    />
                  </FormControl>
                  {tagError ? (
                    <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
                      {tagError}
                    </p>
                  ) : (
                    <FieldHint>支持回车、逗号分隔或批量粘贴，按 Backspace 移除末项</FieldHint>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection title="流转策略与备注">
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FieldLabelRow>
                    <FormLabel optional>核验说明</FormLabel>
                    <FieldCharCount current={notesValue.length} max={300} />
                  </FieldLabelRow>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={300}
                      placeholder="补充该接入源的资产归属口径、变更窗口或联系人说明…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoReview"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <SwitchField
                    label="新发现资产自动进入待复核队列"
                    description="开启后不会直接覆盖已登记台账，需由责任团队复核确认后生效"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="auditStrict"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border-[0.5px] border-border bg-card px-3.5 py-2.5 text-sm leading-5">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                    <span>强制校验 TLS 客户端证书并将每次同步摘要记入操作日志</span>
                  </label>
                </FormItem>
              )}
            />
          </FormSection>
        </form>
      </Form>
    </FormDialog>
  );
}
