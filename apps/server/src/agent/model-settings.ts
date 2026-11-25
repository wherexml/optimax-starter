import { X509Certificate, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AgentModelClearInput,
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
  isValidApiKey,
  isValidModelId,
  readAiSecretFile,
} from "@optimax-starter/agent/models/config";
import { db } from "../services";
import { auditResource } from "../core/audit";
import { type Actor, Refusal, type Tx, lockPermission } from "../core/guards";
import { getAiCircuitState } from "../core/system-settings";
import {
  MODEL_SETTING_KEY,
  decryptApiKey,
  encryptApiKey,
  validateConsoleModelUrl,
} from "./model-crypto";

// ---------------------------------------------------------------------------
// Console-managed AI model settings.
// Settings live in console_setting("ai.model"); the API key is encrypted with
// an auto-managed AES-256-GCM master key under `<STARTER_UPLOAD_DIR>/.system/ai-model.key`.
// ---------------------------------------------------------------------------

const INITIAL_REVISION = "deployment";
const DRAFT_TIMEOUT_MS = 45_000;
const DEFAULT_MODEL_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL_LIMITS = {
  concurrency: 4,
  actorLimit: 2,
  queueLimit: 16,
  queueWaitMs: 15_000,
} as const;

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

const unconfigured: AiConfig = { status: "disabled" };
const unavailable: AiConfig = { status: "invalid", reason: "Invalid AI configuration." };

function origin(value?: string) {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
}

function readOptionalCaCert(): string | undefined {
  const caFile = process.env.STARTER_AI_CA_FILE?.trim();
  if (!caFile) return undefined;
  try {
    const ca = readAiSecretFile(caFile);
    new X509Certificate(ca);
    return ca;
  } catch {
    return undefined;
  }
}

function buildConsoleConfig(settings: ModelFields, apiKey?: string): EnabledConfig {
  const baseUrl = settings.baseUrl.trim();
  const urlError = validateConsoleModelUrl(baseUrl);
  if (urlError) {
    throw new Refusal(400, urlError, "AI_CONFIG_INVALID");
  }
  const model = settings.model.trim();
  if (!isValidModelId(model)) {
    throw new Refusal(400, "请输入有效的模型 ID", "AI_CONFIG_INVALID");
  }
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey || !isValidApiKey(trimmedKey)) {
    throw new Refusal(400, "请填写有效的 API 密钥", "AI_KEY_REQUIRED");
  }
  const ca = readOptionalCaCert();
  return {
    status: "enabled",
    protocol: settings.protocol,
    baseURL: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey: trimmedKey,
    ...(ca ? { ca } : {}),
    structuredMode: settings.structuredMode,
    timeoutMs: DEFAULT_MODEL_TIMEOUT_MS,
    limits: { ...DEFAULT_MODEL_LIMITS },
  };
}

export const isModelSettingsEditable = () => true;

async function readSetting(reader: Reader) {
  const [row] = await reader
    .select({
      value: systemSettings.value,
      updatedAt: systemSettings.updatedAt,
      updatedBy: accounts.name,
    })
    .from(systemSettings)
    .leftJoin(accounts, eq(systemSettings.updatedBy, accounts.id))
    .where(eq(systemSettings.key, MODEL_SETTING_KEY));
  if (!row) return { row: undefined, value: undefined, revision: INITIAL_REVISION };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = undefined;
  }
  const saved = storedSchema.safeParse(parsed);
  if (!saved.success) return { row: undefined, value: undefined, revision: INITIAL_REVISION };
  return { row, value: saved.data, revision: saved.data.revision };
}

function tryDecryptStoredKey(stored?: StoredModel): string | undefined {
  if (!stored?.key) return undefined;
  try {
    return decryptApiKey(stored.key);
  } catch {
    return undefined;
  }
}

function effectiveConfig(value?: StoredModel): AiConfig {
  if (!value) return unconfigured;
  const plainKey = tryDecryptStoredKey(value);
  if (!plainKey) return unavailable;
  try {
    return buildConsoleConfig(value, plainKey);
  } catch {
    return unavailable;
  }
}

function defaultFields(): ModelFields {
  return {
    protocol: "openai-completions",
    baseUrl: "",
    model: "",
    structuredMode: "json_schema",
  };
}

function describe(
  config: AiConfig,
  revision: string,
  value?: StoredModel,
  updatedAt?: Date,
  updatedBy?: string | null,
): AgentModelSettings {
  const fallback = value ?? defaultFields();
  const enabled = config.status === "enabled";
  return {
    editable: true,
    protocol: enabled ? config.protocol : fallback.protocol,
    baseUrl: enabled ? config.baseURL : fallback.baseUrl,
    model: enabled ? config.model : fallback.model,
    structuredMode: enabled ? config.structuredMode : fallback.structuredMode,
    hasKey: enabled,
    source: value ? "database" : "unconfigured",
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
  const urlError = validateConsoleModelUrl(input.baseUrl.trim());
  if (urlError) {
    throw new Refusal(400, urlError, "AI_CONFIG_INVALID");
  }
  const apiKey = input.apiKey?.trim() || undefined;
  const previousOrigin = origin(value?.baseUrl);
  if (previousOrigin && origin(input.baseUrl) !== previousOrigin && !apiKey) {
    throw new Refusal(400, "更换 API 地址后请重新填写密钥", "AI_KEY_REQUIRED");
  }
  const retainedCipher = value?.key;
  const decrypted = !apiKey ? tryDecryptStoredKey(value) : undefined;
  const key = apiKey ?? decrypted;
  if (!key) {
    throw new Refusal(400, "请填写 API 密钥", "AI_KEY_REQUIRED");
  }
  return { config: buildConsoleConfig(input, key), retainedCipher, apiKey };
}

async function circuitOpen() {
  return (await getAiCircuitState()).circuitOpen;
}

/** Unsaved draft for "test connection"; nothing is persisted. */
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
  return db.transaction(async (tx) => {
    const self = await lockPermission(tx, actor.id, "system:settings:manage", { exclusive: true });
    const { config, retainedCipher, apiKey } = await candidate(tx, input);
    const key = apiKey ? encryptApiKey(apiKey) : retainedCipher;
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
      .values({ key: MODEL_SETTING_KEY, ...fields })
      .onConflictDoUpdate({ target: systemSettings.key, set: fields });
    await auditResource(
      tx,
      "system.ai_model",
      self,
      { code: MODEL_SETTING_KEY, name: "AI 模型配置" },
      { revision: value.revision, keyChanged: !!apiKey, model: config.model },
      actor.actorSource,
    );
    return describe(config, value.revision, value, now, self.name);
  });
}

export async function clearModelSettings(
  actor: Actor,
  input: AgentModelClearInput,
): Promise<AgentModelSettings> {
  return db.transaction(async (tx) => {
    const self = await lockPermission(tx, actor.id, "system:settings:manage", { exclusive: true });
    const { revision, value } = await readSetting(tx);
    if (input.revision !== revision) {
      throw new Refusal(409, "配置已更新，请刷新后重试", "AI_CONFIG_CONFLICT");
    }
    if (value) {
      await tx.delete(systemSettings).where(eq(systemSettings.key, MODEL_SETTING_KEY));
      await auditResource(
        tx,
        "system.ai_model",
        self,
        { code: MODEL_SETTING_KEY, name: "AI 模型配置" },
        { cleared: true },
        actor.actorSource,
      );
    }
    return describe(unconfigured, INITIAL_REVISION);
  });
}

/** Caches one gateway per committed revision/config. In-flight chats finish on their gateway. */
export function createManagedAgentGateway() {
  let current: { revision: string; config: AiConfig; gateway: AgentGateway } | undefined;
  return {
    async load(): Promise<AgentGateway> {
      let revision = INITIAL_REVISION;
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
          env: {},
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
    editable: true,
  };
}
