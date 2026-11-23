import {
  AGENT_PROTOCOL_LABELS,
  AGENT_STRUCTURED_MODE_LABELS,
  type AgentProtocol,
  type AgentStructuredMode,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  AGENT_STATUS_KEY,
  type AgentModelInput,
  type AgentModelSettings,
  type AgentProbeResponse,
  fetchAgentStatus,
  fetchModelSettings,
  MODEL_SETTINGS_KEY,
  mapAgentError,
  probeDraftModel,
  probeSavedAgent,
  saveModelSettings,
} from "./api";

const SOURCE_LABELS: Record<AgentModelSettings["source"], string> = {
  database: "网页端配置",
  env: "环境变量",
  unconfigured: "未配置",
};

type Draft = Omit<AgentModelInput, "revision" | "apiKey"> & { apiKey: string };

const toDraft = (settings: AgentModelSettings): Draft => ({
  protocol: settings.protocol,
  baseUrl: settings.baseUrl,
  model: settings.model,
  structuredMode: settings.structuredMode,
  apiKey: "",
});

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-xs text-muted-foreground">{label}</p>
      <p className="m-0 mt-1 truncate font-medium text-foreground" title={value}>
        {value || "未设置"}
      </p>
    </div>
  );
}

function ProbeResult({ result }: { result?: AgentProbeResponse }) {
  if (!result) return null;
  return result.ok ? (
    <span role="status" className="text-sm text-[var(--success-foreground)]">
      连接正常，耗时 {result.chat.latencyMs} ms
    </span>
  ) : (
    <span role="alert" className="text-sm text-destructive">
      连接失败：{mapAgentError(result.chat.error ?? "")}
    </span>
  );
}

export function AiModelSettingsCard({ canManageSettings }: { canManageSettings: boolean }) {
  const cache = useQueryClient();
  const settingsQuery = useQuery({
    meta: { contentRefresh: true },
    queryKey: MODEL_SETTINGS_KEY,
    queryFn: fetchModelSettings,
  });
  const statusQuery = useQuery({
    queryKey: AGENT_STATUS_KEY,
    queryFn: fetchAgentStatus,
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<Draft>();
  const [probe, setProbe] = useState<AgentProbeResponse>();

  const settings = settingsQuery.data;
  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const save = useMutation({
    mutationFn: (input: AgentModelInput) => saveModelSettings(input),
    onSuccess: async (saved) => {
      setDraft(toDraft(saved));
      setProbe(undefined);
      await Promise.all([
        cache.invalidateQueries({ queryKey: MODEL_SETTINGS_KEY }),
        cache.invalidateQueries({ queryKey: AGENT_STATUS_KEY }),
        cache.invalidateQueries({ queryKey: ["system-status"] }),
        cache.invalidateQueries({ queryKey: ["audit"] }),
      ]);
      toast.success("模型配置已保存");
    },
    onError: (error) => toast.error("模型配置保存失败", { description: mapAgentError(error) }),
  });
  const test = useMutation({
    mutationFn: (input?: AgentModelInput) => (input ? probeDraftModel(input) : probeSavedAgent()),
    onMutate: () => setProbe(undefined),
    onSuccess: setProbe,
    onError: (error) => toast.error("连接测试失败", { description: mapAgentError(error) }),
  });

  if (settingsQuery.isPending) {
    return (
      <div role="status" aria-label="正在加载" className="panel p-6 text-sm text-muted-foreground">
        正在读取 AI 模型配置…
      </div>
    );
  }
  if (settingsQuery.isError || !settings) {
    return (
      <div role="alert" className="panel flex items-center justify-between gap-3 p-5">
        <p className="m-0 text-sm text-destructive">
          {settingsQuery.error?.message ?? "AI 模型配置读取失败"}
        </p>
        <Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  const status = statusQuery.data;
  const configured = status?.configured ?? settings.hasKey;
  const circuitOpen = status?.circuitOpen ?? false;
  const stateBadge = circuitOpen ? (
    <Badge variant="danger">已停用</Badge>
  ) : configured ? (
    <Badge variant="success">已配置</Badge>
  ) : (
    <Badge variant="neutral">未配置</Badge>
  );
  const modeBadge = (
    <Badge variant={settings.editable ? "brand" : "neutral"}>
      {settings.editable ? "在线维护" : "只读部署凭证"}
    </Badge>
  );
  const pending = save.isPending || test.isPending;
  const current = draft ?? toDraft(settings);
  const input = (): AgentModelInput => ({
    protocol: current.protocol,
    baseUrl: current.baseUrl.trim(),
    model: current.model.trim(),
    structuredMode: current.structuredMode,
    revision: settings.revision,
    ...(current.apiKey.trim() ? { apiKey: current.apiKey.trim() } : {}),
  });
  const editable = settings.editable && canManageSettings;
  const changed =
    current.protocol !== settings.protocol ||
    current.baseUrl.trim() !== settings.baseUrl ||
    current.model.trim() !== settings.model ||
    current.structuredMode !== settings.structuredMode ||
    Boolean(current.apiKey.trim());
  const complete = Boolean(current.baseUrl.trim() && current.model.trim());

  return (
    <section className="panel" aria-label="AI 模型配置">
      <header className="panel-head">
        <h2>AI 模型配置</h2>
        <div className="flex items-center gap-2">
          {stateBadge}
          {modeBadge}
        </div>
      </header>

      {!settings.editable ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-md border-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)] p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="协议" value={AGENT_PROTOCOL_LABELS[settings.protocol]} />
            <Fact label="模型" value={settings.model} />
            <Fact label="API 地址" value={settings.baseUrl} />
            <Fact label="配置来源" value={SOURCE_LABELS[settings.source]} />
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            当前使用部署环境中的只读凭证。配置 STARTER_AI_CONFIG_KEY_FILE
            后，可在此处在线维护模型与密钥。
          </p>
          {configured && !circuitOpen && canManageSettings && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ProbeResult result={probe} />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => test.mutate(undefined)}
              >
                <PlugZap size={15} />
                {test.isPending ? "测试中…" : "测试连接"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (editable && changed && complete) save.mutate(input());
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-model-protocol">协议</Label>
              <Select
                value={current.protocol}
                onValueChange={(value) =>
                  setDraft({ ...current, protocol: value as AgentProtocol })
                }
                disabled={!editable || pending}
              >
                <SelectTrigger id="ai-model-protocol" aria-label="协议">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AGENT_PROTOCOL_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-model-id">模型 ID</Label>
              <Input
                id="ai-model-id"
                value={current.model}
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                placeholder="例如 qwen-plus"
                disabled={!editable || pending}
                onChange={(event) => setDraft({ ...current, model: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="ai-model-base-url">API 地址</Label>
              <Input
                id="ai-model-base-url"
                value={current.baseUrl}
                maxLength={1024}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://api.example.com/v1"
                disabled={!editable || pending}
                onChange={(event) => setDraft({ ...current, baseUrl: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="ai-model-key">API 密钥</Label>
              <PasswordInput
                id="ai-model-key"
                value={current.apiKey}
                maxLength={4096}
                autoComplete="new-password"
                placeholder={settings.hasKey ? "已保存，留空沿用当前密钥" : "输入服务商 API 密钥"}
                disabled={!editable || pending}
                onChange={(event) => setDraft({ ...current, apiKey: event.target.value })}
              />
            </div>
          </div>

          <details className="rounded-md border-[0.5px] border-[var(--hairline)] p-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">高级选项</summary>
            <div className="mt-3 flex max-w-sm flex-col gap-2">
              <Label htmlFor="ai-model-structured">结构化输出方式</Label>
              <Select
                value={current.structuredMode}
                onValueChange={(value) =>
                  setDraft({ ...current, structuredMode: value as AgentStructuredMode })
                }
                disabled={!editable || pending}
              >
                <SelectTrigger id="ai-model-structured" aria-label="结构化输出方式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AGENT_STRUCTURED_MODE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </details>

          <div className="grid gap-3 rounded-md border-[0.5px] border-[var(--hairline)] bg-[var(--surface-subtle)] p-4 text-sm sm:grid-cols-3">
            <Fact label="配置来源" value={SOURCE_LABELS[settings.source]} />
            <Fact
              label="最近更新"
              value={
                settings.updatedAt ? new Date(settings.updatedAt).toLocaleString("zh-CN") : "未更新"
              }
            />
            <Fact label="更新人" value={settings.updatedBy ?? "部署环境"} />
          </div>

          {canManageSettings && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ProbeResult result={probe} />
              <Button
                type="button"
                variant="outline"
                disabled={pending || !complete}
                onClick={() => test.mutate(input())}
              >
                <PlugZap size={15} />
                {test.isPending ? "测试中…" : "测试连接"}
              </Button>
              <Button type="submit" disabled={pending || !changed || !complete}>
                <Save size={15} />
                {save.isPending ? "保存中…" : "保存配置"}
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
