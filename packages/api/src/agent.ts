import { z } from "zod";

// ---------------------------------------------------------------------------
// AI assistant: model settings, status and chat scope/citation contracts.
// Credentials never appear in any response; `hasKey` only reports presence.
// ---------------------------------------------------------------------------

export const agentProtocolSchema = z.enum(["openai-completions", "anthropic-messages"]);
export type AgentProtocol = z.infer<typeof agentProtocolSchema>;

export const agentStructuredModeSchema = z.enum(["json_object", "json_schema", "tool"]);
export type AgentStructuredMode = z.infer<typeof agentStructuredModeSchema>;

export const AGENT_PROTOCOL_LABELS: Record<AgentProtocol, string> = {
  "openai-completions": "OpenAI 兼容",
  "anthropic-messages": "Anthropic Messages",
};

export const AGENT_STRUCTURED_MODE_LABELS: Record<AgentStructuredMode, string> = {
  json_object: "JSON 对象",
  json_schema: "JSON Schema",
  tool: "工具调用",
};

export const agentModelSettingsSchema = z.object({
  /** false = read-only deployment credentials (no STARTER_AI_CONFIG_KEY_FILE). */
  editable: z.boolean(),
  protocol: agentProtocolSchema,
  baseUrl: z.string(),
  model: z.string(),
  structuredMode: agentStructuredModeSchema,
  hasKey: z.boolean(),
  source: z.enum(["database", "env", "unconfigured"]),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
  /** "deployment" until the first save, then a UUID used for optimistic locking. */
  revision: z.string(),
});
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;

const CONTROL_OR_SPACE = /[\s\x00-\x1f\x7f]/;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "请输入 API 地址")
  .max(1024, "API 地址最多 1024 个字符")
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "API 地址需为不含账号、查询参数的 http(s) URL");

export const agentModelInputSchema = z
  .object({
    protocol: agentProtocolSchema.default("openai-completions"),
    baseUrl: httpUrlSchema,
    model: z
      .string()
      .trim()
      .min(1, "请输入模型 ID")
      .max(200, "模型 ID 最多 200 个字符")
      .refine((value) => !CONTROL_OR_SPACE.test(value), "模型 ID 不能包含空白或控制字符"),
    structuredMode: agentStructuredModeSchema,
    /** Omit (or leave empty) to keep the stored key. Never echoed back. */
    apiKey: z
      .string()
      .trim()
      .max(4096, "密钥过长")
      .refine((value) => value === "" || PRINTABLE_ASCII.test(value), "密钥格式无效")
      .optional(),
    revision: z.union([z.literal("deployment"), z.uuid()]),
  })
  .strict();
export type AgentModelInput = z.infer<typeof agentModelInputSchema>;

export const agentStatusResponseSchema = z.object({
  enabled: z.boolean(),
  circuitOpen: z.boolean(),
  configured: z.boolean(),
  editable: z.boolean(),
  model: z.string().nullable(),
});
export type AgentStatusResponse = z.infer<typeof agentStatusResponseSchema>;

export const agentProbeResponseSchema = z.object({
  ok: z.boolean(),
  chat: z.object({
    ok: z.boolean(),
    latencyMs: z.number(),
    error: z.string().optional(),
  }),
});
export type AgentProbeResponse = z.infer<typeof agentProbeResponseSchema>;

/** The page the user opened the assistant from. Display/context only, never an authorization input. */
export const agentScopeSchema = z.object({
  kind: z.string().max(40),
  label: z.string().max(120).optional(),
  route: z.string().max(200).optional(),
  entityId: z.string().max(80).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type AgentScope = z.infer<typeof agentScopeSchema>;

/** Evidence returned by read tools; `[[E1]]` markers in answers refer to `id`. */
export const agentCitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  to: z.string(),
  search: z.record(z.string(), z.unknown()).optional(),
});
export type AgentCitation = z.infer<typeof agentCitationSchema>;

export const AGENT_MAX_MESSAGES = 8;
export const AGENT_MAX_TEXT_CHARS = 4000;
