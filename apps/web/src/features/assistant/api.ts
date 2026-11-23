import type {
  AgentCitation,
  AgentModelInput,
  AgentModelSettings,
  AgentProbeResponse,
  AgentScope,
  AgentStatusResponse,
} from "@optimax-starter/api";
import { request } from "@/console-client";

export type {
  AgentCitation,
  AgentModelInput,
  AgentModelSettings,
  AgentProbeResponse,
  AgentScope,
  AgentStatusResponse,
};

export const AGENT_STATUS_KEY = ["agent-status"] as const;
export const MODEL_SETTINGS_KEY = ["ai-model-settings"] as const;
export const CHAT_ENDPOINT = "/console/agent/chat";

export const fetchAgentStatus = () => request<AgentStatusResponse>("/agent/status");
export const probeSavedAgent = () => request<AgentProbeResponse>("/agent/test", "POST", {});
export const fetchModelSettings = () => request<AgentModelSettings>("/system/ai/model");
export const saveModelSettings = (input: AgentModelInput) =>
  request<AgentModelSettings>("/system/ai/model", "POST", input);
export const probeDraftModel = (input: AgentModelInput) =>
  request<AgentProbeResponse>("/system/ai/model/test", "POST", input);

const AGENT_ERRORS: Record<string, string> = {
  AI_NOT_CONFIGURED: "模型尚未配置，请联系管理员",
  AI_DISABLED: "模型尚未配置或配置无效，请联系管理员",
  AI_CIRCUIT_OPEN: "全局 AI 熔断开关已开启，暂不可对话",
  AI_RATE_LIMITED: "请求过于频繁，请稍后再试",
  AI_QUEUE_FULL: "当前排队人数较多，请稍后再试",
  AI_QUEUE_TIMEOUT: "排队等待超时，请稍后再试",
  AI_UPSTREAM_ERROR: "模型服务暂时不可用，请稍后重试",
  AI_TIMEOUT: "回答超时，请缩小问题范围后重试",
  AI_INVALID_OUTPUT: "模型返回内容无法识别，请重试",
  AI_UNAVAILABLE: "助理暂不可用，请重试",
  APPROVAL_INVALID: "确认已失效，请重新发起操作",
  PERM_DENIED: "当前账号没有此操作权限",
};

const CODE_RE = /\b(AI_[A-Z_]+|APPROVAL_INVALID|PERM_DENIED)\b/;

/** Maps server codes (JSON body, stream error text or Error.message) to concise Chinese messages. */
export function mapAgentError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = JSON.parse(raw) as {
      code?: unknown;
      error?: unknown;
    };
    const nested =
      body.error && typeof body.error === "object"
        ? (body.error as { code?: unknown; message?: unknown })
        : undefined;
    code = [body.code, nested?.code].find((value): value is string => typeof value === "string");
    message = typeof body.error === "string" ? body.error : undefined;
  } catch {
    /* Plain text. */
  }
  code ??= CODE_RE.exec(raw)?.[1];
  if (code && AGENT_ERRORS[code]) return AGENT_ERRORS[code];
  if (message) return message;
  if (raw && raw.length <= 80 && !/[{<]/.test(raw)) return raw;
  return "助理暂不可用，请重试";
}

export function isInternalPath(to: unknown): to is string {
  return (
    typeof to === "string" &&
    to.startsWith("/") &&
    !to.startsWith("//") &&
    to.length <= 200 &&
    /^\/[A-Za-z0-9\-_/]*$/.test(to)
  );
}
