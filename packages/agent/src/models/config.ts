import { X509Certificate } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import type { QueueLimits } from "@optimax-starter/agent/gateway/queue";

export type ModelProtocol = "openai-completions" | "anthropic-messages";
export type StructuredMode = "json_schema" | "json_object" | "tool";
export type AiEnvironment = Record<string, string | undefined>;
export type AiConfigStatus =
  | { status: "disabled" }
  | { status: "invalid"; reason: string }
  | { status: "enabled" };
export type EnabledConfig = {
  status: "enabled";
  baseURL: string;
  model: string;
  apiKey: string;
  ca?: string;
  protocol: ModelProtocol;
  structuredMode: StructuredMode;
  timeoutMs: number;
  limits: QueueLimits;
};
export type AiConfig = Exclude<AiConfigStatus, { status: "enabled" }> | EnabledConfig;

export const MODEL_PROTOCOLS: readonly ModelProtocol[] = [
  "openai-completions",
  "anthropic-messages",
];
export const STRUCTURED_MODES: readonly StructuredMode[] = ["json_schema", "json_object", "tool"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

class ConfigProblem extends Error {}
const invalid = () => new ConfigProblem("Invalid AI configuration.");

export function readAiSecretFile(path: string) {
  // O_NONBLOCK prevents a FIFO from hanging boot; fstat checks the actual open descriptor.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 4096 || stat.mode & 0o002) throw invalid();
    const value = readFileSync(fd, "utf8");
    if (!value.trim() || Buffer.byteLength(value) > 4096) throw invalid();
    return value;
  } finally {
    closeSync(fd);
  }
}

/** Starter name first, then the CMI alias. */
function reader(env: AiEnvironment) {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value) return value;
    }
    return undefined;
  };
  return get;
}

export function parseHttpHosts(env: AiEnvironment = process.env): string[] {
  const raw = reader(env)("STARTER_AI_ALLOW_HTTP_HOSTS", "STARTER_AI_HTTP_HOSTS") ?? "";
  const hosts = raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.some((host) => !/^(?:[a-z0-9][a-z0-9.-]*|\[[0-9a-f:.]+\])$/.test(host))) {
    throw invalid();
  }
  return hosts;
}

/**
 * HTTPS is always accepted. Plain HTTP: loopback or an explicit allowlist entry outside
 * production; in production only an explicit allowlist entry (loopback included).
 */
export function isAllowedModelUrl(raw: string, env: AiEnvironment = process.env): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || url.search || url.hash || !url.hostname) return false;
  if (url.protocol === "https:") return true;
  let allowed: string[];
  try {
    allowed = parseHttpHosts(env);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (allowed.includes(host)) return true;
  return env.NODE_ENV !== "production" && LOOPBACK_HOSTS.includes(host);
}

export function isValidModelId(model: string) {
  return model.length > 0 && model.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(model);
}

export function isValidApiKey(apiKey: string) {
  return apiKey.length > 0 && Buffer.byteLength(apiKey) <= 4096 && /^[\x21-\x7e]+$/.test(apiKey);
}

export function readAiConfig(env: AiEnvironment = process.env): AiConfig {
  const get = reader(env);
  const keys = ["BASE_URL", "MODEL", "API_KEY", "API_KEY_FILE", "CA_FILE"];
  if (!keys.some((key) => get(`STARTER_AI_${key}`))) return { status: "disabled" };
  try {
    const base = get("STARTER_AI_BASE_URL");
    const model = get("STARTER_AI_MODEL");
    if (!base || !model || !isValidModelId(model)) throw invalid();
    if (!isAllowedModelUrl(base, env)) throw invalid();
    const keyPath = get("STARTER_AI_API_KEY_FILE");
    const apiKey = keyPath ? readAiSecretFile(keyPath).trim() : get("STARTER_AI_API_KEY");
    if (!apiKey || !isValidApiKey(apiKey)) throw invalid();
    const caPath = get("STARTER_AI_CA_FILE");
    const ca = caPath ? readAiSecretFile(caPath) : undefined;
    if (ca) new X509Certificate(ca);
    const protocol = get("STARTER_AI_PROTOCOL") ?? "openai-completions";
    if (!MODEL_PROTOCOLS.includes(protocol as ModelProtocol)) throw invalid();
    const structuredMode =
      get("STARTER_AI_STRUCTURED_MODE") ??
      (protocol === "anthropic-messages" ? "tool" : "json_schema");
    if (!STRUCTURED_MODES.includes(structuredMode as StructuredMode)) throw invalid();
    const number = (keys: string[], fallback: number, min: number, max: number) => {
      const raw = get(...keys);
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
        throw invalid();
      }
      return value;
    };
    return {
      status: "enabled",
      baseURL: base.replace(/\/+$/, ""),
      model,
      apiKey,
      ca,
      protocol: protocol as ModelProtocol,
      structuredMode: structuredMode as StructuredMode,
      timeoutMs: number(["STARTER_AI_TIMEOUT_MS"], 60000, 1, 300000),
      limits: {
        concurrency: number(["STARTER_AI_CONCURRENCY", "STARTER_AI_MAX_CONCURRENCY"], 4, 1, 64),
        actorLimit: number(
          ["STARTER_AI_ACTOR_LIMIT", "STARTER_AI_PER_ACTOR_CONCURRENCY"],
          2,
          1,
          64,
        ),
        queueLimit: number(["STARTER_AI_QUEUE_LIMIT"], 16, 0, 1024),
        queueWaitMs: number(
          ["STARTER_AI_QUEUE_WAIT_MS", "STARTER_AI_QUEUE_TIMEOUT_MS"],
          15000,
          0,
          300000,
        ),
      },
    };
  } catch {
    return { status: "invalid", reason: "Invalid AI configuration." };
  }
}

/** Safe for health responses. Does not return endpoints, paths, model names or secrets. */
export function getAiConfigStatus(env: AiEnvironment = process.env): AiConfigStatus {
  const config = readAiConfig(env);
  return config.status === "enabled" ? { status: "enabled" } : config;
}
