import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AgentModelInput,
  type AgentModelSettings,
  type AgentProbeResponse,
  agentModelInputSchema,
  agentProtocolSchema,
  agentStructuredModeSchema,
} from "@optimax-starter/api";
import { accounts, systemSettings } from "@optimax-starter/db/schema/console";
import { type AgentGateway, asAiError, createAgent, probeToolChat } from "@optimax-starter/agent";
import {
  type AiConfig,
  type EnabledConfig,
  readAiConfig,
  readAiSecretFile,
} from "@optimax-starter/agent/models/config";
import { db } from "../services";
import { auditResource } from "../core/audit";
import { type Actor, Refusal, type Tx, lockPermission } from "../core/guards";
import { getAiCircuitState } from "../core/system-settings";

// ---------------------------------------------------------------------------
// Adaptive model settings.
// - Managed (editable): STARTER_AI_CONFIG_KEY_FILE holds a 64-hex AES-256-GCM key. The model can be
//   maintained from the console; the API key is stored encrypted in console_setting("ai.model").
// - Read-only: no usable key file. Deployment env (readAiConfig) is the only source; DB rows are
//   ignored and saves are refused.
// console_setting.value is text, so the stored object is JSON serialized explicitly.
// ---------------------------------------------------------------------------

const SETTING_KEY = "ai.model";
const DEPLOYMENT_REVISION = "deployment";
const DRAFT_TIMEOUT_MS = 45_000;

const storedSchema = z
  .object({
    protocol: agentProtocolSchema,
    baseUrl: z.string().min(1).max(1024),
    model: z.string().min(1).max(200),
    structuredMode: agentStructuredModeSchema,
    revision: z.uuid(),
    /** base64(iv | ciphertext | tag); never returned to clients. */
    key: z.string().max(5700).optional(),
  })
  .strict();
type StoredModel = z.infer<typeof storedSchema>;
type ModelFields = Pick<AgentModelInput, "protocol" | "baseUrl" | "model" | "structuredMode">;
type Reader = Tx | typeof db;

const unavailable = { status: "invalid", reason: "Invalid AI configuration." } as const;

const readOnlyRefusal = () =>
  new Refusal(
    400,
    "当前环境使用只读部署凭证，如需在网页端维护模型请配置 STARTER_AI_CONFIG_KEY_FILE",
    "AI_CONFIG_READONLY",
  );

function origin(value?: string) {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the AES key, or null when the console cannot manage model settings. */
function configKey(): Buffer | null {
  const file = process.env.STARTER_AI_CONFIG_KEY_FILE?.trim();
  if (!file) return null;
  try {
    const secret = readAiSecretFile(file).trim();
    if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  } catch {
    /* Unreadable or invalid key file: stay read-only. */
  }
  return null;
}

export const isModelSettingsEditable = () => configKey() !== null;

function requireKey() {
  const key = configKey();
  if (!key) throw readOnlyRefusal();
  return key;
}

function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(Buffer.from(SETTING_KEY));
  return Buffer.concat([
    iv,
    cipher.update(plain, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(SETTING_KEY));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString(
    "utf8",
  );
}

function allowedOrigins() {
  return (process.env.STARTER_AI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => origin(value.trim()))
    .filter((value): value is string => !!value);
}

/** Validates console-supplied fields against deployment policy; credentials stay server-side. */
function mergeDeployment(settings: ModelFields, key?: string): EnabledConfig {
  const target = origin(settings.baseUrl);
  const deployed = origin(process.env.STARTER_AI_BASE_URL);
  if (!target || (target !== deployed && !allowedOrigins().includes(target))) {
    throw new Refusal(400, "API 地址不在此部署的允许列表内", "AI_ORIGIN_NOT_ALLOWED");
  }
  if (target !== deployed && !key) {
    throw new Refusal(400, "更换 API 服务时请填写该服务的密钥", "AI_KEY_REQUIRED");
  }
  const config = readAiConfig({
    ...process.env,
    STARTER_AI_PROTOCOL: settings.protocol,
    STARTER_AI_BASE_URL: settings.baseUrl,
    STARTER_AI_MODEL: settings.model,
    STARTER_AI_STRUCTURED_MODE: settings.structuredMode,
    STARTER_AI_API_KEY_FILE: key ? undefined : process.env.STARTER_AI_API_KEY_FILE,
    STARTER_AI_API_KEY: key ?? process.env.STARTER_AI_API_KEY,
    // A deployment CA only applies to the deployment endpoint.
    STARTER_AI_CA_FILE: target === deployed ? process.env.STARTER_AI_CA_FILE : undefined,
  });
  if (config.status !== "enabled") {
    throw new Refusal(400, "请检查 API 地址、模型 ID 和密钥", "AI_CONFIG_INVALID");
  }
  return config;
}

async function readSetting(reader: Reader) {
  if (!isModelSettingsEditable()) {
    return { row: undefined, value: undefined, revision: DEPLOYMENT_REVISION };
  }
  const [row] = await reader
    .select({
      value: systemSettings.value,
      updatedAt: systemSettings.updatedAt,
      updatedBy: accounts.name,
    })
    .from(systemSettings)
    .leftJoin(accounts, eq(systemSettings.updatedBy, accounts.id))
    .where(eq(systemSettings.key, SETTING_KEY));
  if (!row) return { row: undefined, value: undefined, revision: DEPLOYMENT_REVISION };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = undefined;
  }
  const saved = storedSchema.safeParse(parsed);
  if (!saved.success) throw new Refusal(503, "服务端模型配置无法读取", "AI_CONFIG_UNREADABLE");
  return { row, value: saved.data, revision: saved.data.revision };
}

function effectiveConfig(value?: StoredModel): AiConfig {
  if (!value) return readAiConfig(process.env);
  try {
    return mergeDeployment(value, value.key ? decrypt(value.key) : undefined);
  } catch {
    return unavailable;
  }
}

function envDefaults() {
  const protocol = agentProtocolSchema
    .catch("openai-completions")
    .parse(process.env.STARTER_AI_PROTOCOL?.trim());
  const mode = agentStructuredModeSchema.safeParse(process.env.STARTER_AI_STRUCTURED_MODE?.trim());
  return {
    protocol,
    baseUrl: process.env.STARTER_AI_BASE_URL?.trim() ?? "",
    model: process.env.STARTER_AI_MODEL?.trim() ?? "",
    structuredMode: mode.success
      ? mode.data
      : protocol === "anthropic-messages"
        ? ("tool" as const)
        : ("json_schema" as const),
  };
}

function describe(
  config: AiConfig,
  revision: string,
  value?: StoredModel,
  updatedAt?: Date,
  updatedBy?: string | null,
): AgentModelSettings {
  const fallback = value ?? envDefaults();
  const enabled = config.status === "enabled";
  const source: AgentModelSettings["source"] = value
    ? "database"
    : config.status === "disabled"
      ? "unconfigured"
      : "env";
  return {
    editable: isModelSettingsEditable(),
    protocol: enabled ? config.protocol : fallback.protocol,
    baseUrl: enabled ? config.baseURL : fallback.baseUrl,
    model: enabled ? config.model : fallback.model,
    structuredMode: enabled ? config.structuredMode : fallback.structuredMode,
    hasKey: enabled,
    source,
    updatedAt: updatedAt?.toISOString() ?? null,
    updatedBy: updatedBy ?? null,
    revision,
  };
}

export async function getModelSettings(): Promise<AgentModelSettings> {
  const { row, value, revision } = await readSetting(db);
  return describe(effectiveConfig(value), revision, value, row?.updatedAt, row?.updatedBy);
}

async function candidate(reader: Reader, input: AgentModelInput) {
  const { revision, value } = await readSetting(reader);
  if (input.revision !== revision) {
    throw new Refusal(409, "配置已更新，请刷新后重试", "AI_CONFIG_CONFLICT");
  }
  const apiKey = input.apiKey || undefined;
  const previousOrigin = origin(value?.baseUrl ?? process.env.STARTER_AI_BASE_URL);
  if (origin(input.baseUrl) !== previousOrigin && !apiKey) {
    throw new Refusal(400, "更换 API 服务时请填写该服务的密钥", "AI_KEY_REQUIRED");
  }
  const retained = value?.key;
  const key = apiKey ?? (retained ? decrypt(retained) : undefined);
  return { config: mergeDeployment(input, key), retained, apiKey };
}

async function circuitOpen() {
  return (await getAiCircuitState()).circuitOpen;
}

/** Unsaved draft for "test connection". Works in both modes; nothing is persisted. */
export async function draftModel(raw: AgentModelInput): Promise<AgentGateway> {
  const input = agentModelInputSchema.parse(raw);
  const { config } = await candidate(db, input);
  return createAgent({
    config: { ...config, timeoutMs: Math.min(config.timeoutMs, DRAFT_TIMEOUT_MS) },
    modelLabel: config.model,
    isCircuitOpen: circuitOpen,
  });
}

export async function saveModelSettings(
  actor: Actor,
  input: AgentModelInput,
): Promise<AgentModelSettings> {
  if (!isModelSettingsEditable()) throw readOnlyRefusal();
  const saved = await db.transaction(async (tx) => {
    const self = await lockPermission(tx, actor.id, "system:settings:manage", { exclusive: true });
    const { config, retained, apiKey } = await candidate(tx, input);
    // Keep the encrypted key when the form omits it; never re-read env credentials into storage.
    const key = apiKey ? encrypt(apiKey) : retained;
    const value: StoredModel = {
      protocol: config.protocol,
      baseUrl: config.baseURL,
      model: config.model,
      structuredMode: config.structuredMode,
      revision: randomUUID(),
      ...(key ? { key } : {}),
    };
    const now = new Date();
    const fields = { value: JSON.stringify(value), updatedAt: now, updatedBy: self.id };
    await tx
      .insert(systemSettings)
      .values({ key: SETTING_KEY, ...fields })
      .onConflictDoUpdate({ target: systemSettings.key, set: fields });
    await auditResource(
      tx,
      "system.ai_model",
      self,
      { code: SETTING_KEY, name: "AI 模型配置" },
      { revision: value.revision, keyChanged: !!apiKey, model: config.model },
      actor.actorSource,
    );
    return describe(config, value.revision, value, now, self.name);
  });
  return saved;
}

/** Caches one gateway per committed revision/config. In-flight chats finish on their gateway. */
export function createManagedAgentGateway() {
  let current: { revision: string; config: AiConfig; gateway: AgentGateway } | undefined;
  return {
    async load(): Promise<AgentGateway> {
      let revision = DEPLOYMENT_REVISION;
      let config: AiConfig;
      try {
        const setting = await readSetting(db);
        revision = setting.revision;
        config = effectiveConfig(setting.value);
      } catch {
        config = unavailable;
      }
      if (current?.revision === revision && isDeepStrictEqual(current.config, config)) {
        return current.gateway;
      }
      const previous = current;
      current = {
        revision,
        config,
        gateway: createAgent({
          config,
          env: revision === DEPLOYMENT_REVISION ? process.env : {},
          isCircuitOpen: circuitOpen,
        }),
      };
      if (previous) {
        const grace = previous.config.status === "enabled" ? previous.config.timeoutMs : 0;
        setTimeout(() => {
          void previous.gateway.close().catch(() => {});
        }, grace).unref();
      }
      return current.gateway;
    },
    async close() {
      await current?.gateway.close();
    },
  };
}

export const managedGateway = createManagedAgentGateway();

export async function probeGateway(
  gateway: AgentGateway,
  actor: string,
  signal?: AbortSignal,
): Promise<AgentProbeResponse> {
  const startedAt = Date.now();
  try {
    await probeToolChat(gateway, actor, signal);
    return { ok: true, chat: { ok: true, latencyMs: Date.now() - startedAt } };
  } catch (error) {
    const safe = asAiError(error, signal);
    return { ok: false, chat: { ok: false, latencyMs: Date.now() - startedAt, error: safe.code } };
  }
}

export async function probeSavedModel(actor: string, signal?: AbortSignal) {
  return probeGateway(await managedGateway.load(), actor, signal);
}

export async function agentStatus() {
  const [gateway, circuit] = await Promise.all([managedGateway.load(), getAiCircuitState()]);
  return {
    gateway,
    configured: gateway.configured,
    circuitOpen: circuit.circuitOpen,
    editable: isModelSettingsEditable(),
  };
}
