import {
  AGENT_PROTOCOL_LABELS,
  AGENT_STRUCTURED_MODE_LABELS,
  type AgentProtocol,
  type AgentStructuredMode,
  agentModelInputSchema,
} from "@optimax-starter/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SelectControl, SelectItem } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { RegisterSettingsSection } from "@/features/system/settings-controller";
import {
  AGENT_STATUS_KEY,
  type AgentModelInput,
  type AgentModelSettings,
  type AgentProbeResponse,
  clearModelSettings,
  fetchAgentStatus,
  fetchModelSettings,
  MODEL_SETTINGS_KEY,
  mapAgentError,
  probeDraftModel,
  probeSavedAgent,
  saveModelSettings,
} from "./api";

type Draft = Omit<AgentModelInput, "revision" | "apiKey"> & { apiKey: string };

const toDraft = (settings: AgentModelSettings): Draft => ({
  protocol: settings.protocol,
  baseUrl: settings.baseUrl,
  model: settings.model,
  structuredMode: settings.structuredMode,
  apiKey: "",
});

function getOrigin(raw: string): string | undefined {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return undefined;
  }
}

function ProbeResult({ result }: { result?: AgentProbeResponse }) {
  if (!result) return null;
  return result.ok ? (
    <span role="status" className="text-xs text-[var(--success-foreground)]">
      连接正常（{result.chat.latencyMs} ms）
    </span>
  ) : (
    <span role="alert" className="text-xs text-destructive">
      连接失败：{mapAgentError(result.chat.error ?? "")}
    </span>
  );
}

export function AiModelSettingsCard({
  canManageSettings,
  registerSection,
}: {
  canManageSettings: boolean;
  registerSection?: RegisterSettingsSection;
}) {
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

  const invalidateRelated = useCallback(async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: MODEL_SETTINGS_KEY }),
      cache.invalidateQueries({ queryKey: AGENT_STATUS_KEY }),
      cache.invalidateQueries({ queryKey: ["system-status"] }),
      cache.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  }, [cache]);

  const save = useMutation({
    mutationFn: (input: AgentModelInput) => saveModelSettings(input),
    onSuccess: async (saved) => {
      setDraft(toDraft(saved));
      setProbe(undefined);
      await invalidateRelated();
    },
  });

  const clear = useMutation({
    mutationFn: (revision: string) => clearModelSettings(revision),
    onSuccess: async (cleared) => {
      setDraft(toDraft(cleared));
      setProbe(undefined);
      await invalidateRelated();
      toast.success("已清空 AI 模型配置");
    },
    onError: (error) => toast.error("清空配置失败", { description: mapAgentError(error) }),
  });

  const test = useMutation({
    mutationFn: (input?: AgentModelInput) => (input ? probeDraftModel(input) : probeSavedAgent()),
    onMutate: () => setProbe(undefined),
    onSuccess: setProbe,
    onError: (error) => toast.error("连接测试失败", { description: mapAgentError(error) }),
  });

  const current = draft ?? (settings ? toDraft(settings) : undefined);
  const baseUrlTrimmed = current?.baseUrl.trim() ?? "";
  const modelTrimmed = current?.model.trim() ?? "";
  const apiKeyTrimmed = current?.apiKey.trim() ?? "";

  const dirty = Boolean(
    settings &&
      current &&
      (current.protocol !== settings.protocol ||
        baseUrlTrimmed !== settings.baseUrl ||
        modelTrimmed !== settings.model ||
        current.structuredMode !== settings.structuredMode ||
        apiKeyTrimmed.length > 0),
  );

  const buildInput = useCallback((): AgentModelInput => {
    if (!settings || !current) {
      return {
        protocol: "openai-completions",
        baseUrl: "",
        model: "",
        structuredMode: "json_schema",
        revision: "deployment",
      };
    }
    return {
      protocol: current.protocol,
      baseUrl: current.baseUrl.trim(),
      model: current.model.trim(),
      structuredMode: current.structuredMode,
      revision: settings.revision,
      ...(current.apiKey.trim() ? { apiKey: current.apiKey.trim() } : {}),
    };
  }, [current, settings]);

  let validationError: string | null = null;
  if (settings && current) {
    const parsedDraft = agentModelInputSchema.safeParse(buildInput());
    if (!parsedDraft.success) {
      validationError = parsedDraft.error.issues[0]?.message ?? "请检查模型配置";
    } else {
      const originChanged = Boolean(
        settings.baseUrl && getOrigin(baseUrlTrimmed) !== getOrigin(settings.baseUrl),
      );
      if ((!settings.hasKey || originChanged) && !apiKeyTrimmed) {
        validationError = originChanged ? "更换 API 地址后请重新填写密钥" : "请填写 API 密钥";
      }
    }
  }

  const valid = !dirty || validationError === null;
  const pending = save.isPending || clear.isPending || test.isPending;

  const reset = useCallback(() => {
    if (!settings) return;
    setDraft(toDraft(settings));
    setProbe(undefined);
  }, [settings]);

  const apply = useCallback(async () => {
    if (!settings || !dirty || !valid) return;
    try {
      await save.mutateAsync(buildInput());
    } catch (error) {
      throw new Error(mapAgentError(error));
    }
  }, [buildInput, dirty, save, settings, valid]);

  useEffect(() => {
    if (!registerSection) return;
    registerSection("ai-model", {
      dirty,
      valid,
      pending: save.isPending || clear.isPending,
      apply,
      reset,
    });
  }, [apply, clear.isPending, dirty, registerSection, reset, save.isPending, valid]);

  useEffect(() => {
    return () => registerSection?.("ai-model", null);
  }, [registerSection]);

  if (settingsQuery.isPending) {
    return (
      <div role="status" aria-label="正在加载" className="panel p-6 text-sm text-muted-foreground">
        正在读取 AI 模型配置…
      </div>
    );
  }
  if (settingsQuery.isError || !settings || !current) {
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
  const disabled = !canManageSettings || pending;
  const canProbeDraft = dirty && validationError === null;
  const canProbeSaved = !dirty && configured && !circuitOpen;

  return (
    <section className="panel" aria-label="AI 模型配置">
      <header className="panel-head flex-wrap">
        <div className="flex items-center gap-2.5">
          <h2>AI 模型配置</h2>
          <Badge variant={settings.hasKey ? "success" : "neutral"}>
            {settings.hasKey ? "已配置" : "未配置"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ProbeResult result={probe} />
          {canManageSettings && settings.source === "database" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => clear.mutate(settings.revision)}
            >
              <RotateCcw size={14} />
              {clear.isPending ? "清空中…" : "清空配置"}
            </Button>
          )}
          {canManageSettings && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || !(canProbeDraft || canProbeSaved)}
              onClick={() => test.mutate(canProbeDraft ? buildInput() : undefined)}
            >
              <PlugZap size={14} />
              {test.isPending ? "测试中…" : "测试连接"}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <div className="cq-grid-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model-base-url">API 地址</Label>
            <Input
              id="ai-model-base-url"
              value={current.baseUrl}
              maxLength={1024}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              disabled={disabled}
              onChange={(event) => {
                setProbe(undefined);
                setDraft({ ...current, baseUrl: event.target.value });
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model-key">API 密钥</Label>
            <PasswordInput
              id="ai-model-key"
              value={current.apiKey}
              maxLength={4096}
              autoComplete="new-password"
              placeholder={settings.hasKey ? "已保存，留空沿用当前密钥" : "输入服务商 API 密钥"}
              disabled={disabled}
              onChange={(event) => {
                setProbe(undefined);
                setDraft({ ...current, apiKey: event.target.value });
              }}
            />
          </div>
        </div>

        <div className="cq-grid-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model-protocol">接口协议</Label>
            <SelectControl
              id="ai-model-protocol"
              aria-label="接口协议"
              value={current.protocol}
              onValueChange={(value) => {
                setProbe(undefined);
                setDraft({ ...current, protocol: value as AgentProtocol });
              }}
              disabled={disabled}
            >
              {Object.entries(AGENT_PROTOCOL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectControl>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-model-id">模型 ID</Label>
            <Input
              id="ai-model-id"
              value={current.model}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="例如 deepseek-chat 或 gpt-4o-mini"
              disabled={disabled}
              onChange={(event) => {
                setProbe(undefined);
                setDraft({ ...current, model: event.target.value });
              }}
            />
          </div>
          <div className="cq-span-2-sm flex flex-col gap-2">
            <Label htmlFor="ai-model-structured">结构化输出方式</Label>
            <SelectControl
              id="ai-model-structured"
              aria-label="结构化输出方式"
              value={current.structuredMode}
              onValueChange={(value) => {
                setProbe(undefined);
                setDraft({ ...current, structuredMode: value as AgentStructuredMode });
              }}
              disabled={disabled}
            >
              {Object.entries(AGENT_STRUCTURED_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectControl>
          </div>
        </div>

        {dirty && validationError ? (
          <p role="alert" className="m-0 text-xs text-destructive">
            {validationError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
