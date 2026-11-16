// Server-side OpenAI-compatible Chat Completions client for the asset agent.
// Token field correction follows Magpie internal/gateway/token_field.go (see token-field.ts);
// error classes follow internal/gateway/kept_error.go (see errors.ts); slots follow
// internal/gateway/concurrency.go (see queue.ts). Copyright (c) 2026 yetone, MIT License:
// third_party/licenses/magpie-MIT.txt. Transport, config and session code here are Starter's own.
//
// Security: the base URL and key file only come from server env; the key is read from a private
// file and only sent as an Authorization header to that origin. Redirects are never followed.
// Vendor bodies, messages, URLs and credentials are never logged or returned.

import { readFileSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { z } from "zod";
import { AiError, classifyStatus, parseRetryAfter, readVendorError } from "./errors";
import { AiQueue, abortError, type QueueLimits } from "./queue";
import { MAX_COMPLETION_TOKENS, MAX_TOKENS, TokenFieldCache, isOpenAIHost, isTokenField, tokenFieldWanted, withTokenField, type TokenField } from "./token-field";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 4096;
const LEGACY_HOSTS = ["127.0.0.1", "localhost", "host.docker.internal"];

type Transport = { url: URL; agent: http.Agent; key?: string };
type Enabled = {
  mode: "client" | "legacy";
  model: string;
  endpoint: string;
  transport: Transport;
  tokenField?: TokenField;
  adaptTokens: boolean;
  timeoutMs: number;
  limits: QueueLimits;
};
export type AiConfig = { mode: "disabled" } | { mode: "invalid"; reason: string } | Enabled;

const env = (name: string) => process.env[name]?.trim() || undefined;

/** A failed configuration check; its message is a fixed label, never a configured value. */
class ConfigProblem extends Error {}
const problem = (label: string) => new ConfigProblem(label);

function bounded(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw problem(`${name} invalid`);
  const value = Number(raw);
  if (value < min || value > max) throw problem(`${name} out of range`);
  return value;
}

function tuning() {
  const timeoutMs = bounded("STARTER_AI_TIMEOUT_MS", 60_000, 1_000, 120_000);
  return {
    timeoutMs,
    limits: {
      concurrency: bounded("STARTER_AI_CONCURRENCY", 4, 1, 32),
      queueLimit: bounded("STARTER_AI_QUEUE_LIMIT", 16, 0, 256),
      queueWaitMs: bounded("STARTER_AI_QUEUE_WAIT_MS", 15_000, 0, 120_000),
      actorLimit: bounded("STARTER_AI_ACTOR_LIMIT", 2, 1, 16),
    },
  };
}

function validModel(model: string) {
  // eslint-disable-next-line no-control-regex
  if (model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) throw problem("model invalid");
  return model;
}

function readKey(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_KEY_BYTES) throw problem("key file invalid");
  if (stat.mode & 0o002) throw problem("key file is world-writable");
  const key = readFileSync(path, "utf8").trim();
  if (!key || !/^[\x21-\x7e]+$/.test(key)) throw problem("key file invalid");
  return key;
}

function readCa(path: string): Buffer {
  const ca = readFileSync(path);
  if (ca.length === 0 || ca.length > 256 * 1024 || !ca.includes("-----BEGIN CERTIFICATE-----")) throw problem("CA file invalid");
  return ca;
}

function clientConfig(base: string): Enabled {
  const model = env("STARTER_AI_MODEL");
  const keyFile = env("STARTER_AI_API_KEY_FILE");
  if (!model || !keyFile) throw problem("incomplete");
  if (/[?#]/.test(base)) throw problem("query or fragment");
  const url = new URL(base);
  if (url.username || url.password) throw problem("userinfo");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw problem("scheme");
  if (!url.hostname) throw problem("host");
  if (url.protocol === "http:") {
    const allowed = (env("STARTER_AI_ALLOW_HTTP_HOSTS") ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
    if (process.env.NODE_ENV === "production" || !allowed.includes(url.hostname.toLowerCase())) throw problem("plain HTTP host not allowed");
  }
  const field = env("STARTER_AI_TOKEN_FIELD");
  if (field !== undefined && !isTokenField(field)) throw problem("token field");
  const caFile = env("STARTER_AI_CA_FILE");
  const ca = caFile ? readCa(caFile) : undefined;
  const key = readKey(keyFile);
  const endpoint = new URL(`${url.pathname.replace(/\/+$/, "")}/chat/completions`, url.origin);
  const agent = endpoint.protocol === "https:" ? new https.Agent({ keepAlive: true, ...(ca ? { ca } : {}) }) : new http.Agent({ keepAlive: true });
  return {
    mode: "client",
    model: validModel(model),
    endpoint: endpoint.href,
    transport: { url: endpoint, agent, key },
    tokenField: field ?? (isOpenAIHost(url.hostname) ? MAX_COMPLETION_TOKENS : MAX_TOKENS),
    adaptTokens: true,
    ...tuning(),
  };
}

/** Optional compatibility with the earlier local Magpie relay; only used when no STARTER_AI_* client is set. */
function legacyConfig(relay: string, model: string): Enabled {
  const url = new URL(relay);
  if (url.protocol !== "http:" || !LEGACY_HOSTS.includes(url.hostname) || url.username || url.password || url.search || url.hash) throw problem("legacy relay invalid");
  return {
    mode: "legacy",
    model: validModel(model),
    endpoint: url.href,
    transport: { url, agent: new http.Agent({ keepAlive: true }) },
    adaptTokens: false,
    ...tuning(),
  };
}

function load(): AiConfig {
  const base = env("STARTER_AI_BASE_URL");
  const clientRequested = Boolean(base || env("STARTER_AI_MODEL") || env("STARTER_AI_API_KEY_FILE"));
  try {
    if (clientRequested) return clientConfig(base ?? "");
    const relay = env("STARTER_MAGPIE_RELAY_URL");
    const model = env("STARTER_MAGPIE_MODEL");
    if (relay && model) return legacyConfig(relay, model);
    if (relay || model) return { mode: "invalid", reason: "legacy relay incomplete" };
    return { mode: "disabled" };
  } catch (error) {
    // The reason names a check, never a value: system errors (URL parser, fs) may embed inputs.
    return { mode: "invalid", reason: error instanceof ConfigProblem ? error.message : "unreadable or malformed setting" };
  }
}

let cached: AiConfig | undefined;
let queue: AiQueue | undefined;
const tokenCache = new TokenFieldCache();

/** Settings are read once per process; restart the API after changing them or rotating the key file. */
export function aiConfig(): AiConfig {
  if (!cached) {
    cached = load();
    if (cached.mode === "invalid") console.warn("ai client disabled: invalid configuration", { reason: cached.reason });
    if (cached.mode === "client" || cached.mode === "legacy") queue = new AiQueue(cached.limits);
  }
  return cached;
}

export function aiEnabled(): boolean {
  const config = aiConfig();
  return config.mode === "client" || config.mode === "legacy";
}

type RawResponse = { status: number; headers: http.IncomingHttpHeaders; text: string };

function post(transport: Transport, payload: string, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    let settled = false;
    const finish = (error: AiError | undefined, value?: RawResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) {
        request.destroy();
        reject(error);
      } else resolve(value!);
    };
    const onAbort = () => finish(abortError(signal));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Length": String(Buffer.byteLength(payload)),
    };
    if (transport.key) headers.Authorization = `Bearer ${transport.key}`;
    const options: http.RequestOptions = { method: "POST", headers, agent: transport.agent };
    const onResponse = (response: http.IncomingMessage) => {
      // Settle with the intended error before destroying: destroy() emits aborted/close synchronously.
      const stop = (error: AiError) => {
        finish(error);
        response.destroy();
      };
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) return stop(new AiError("upstream_redirect", { upstreamStatus: status }));
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return stop(new AiError("upstream_response_too_large"));
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) return stop(new AiError("upstream_response_too_large"));
        chunks.push(chunk);
      });
      response.on("end", () => finish(undefined, { status, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("aborted", () => finish(new AiError("upstream_network")));
      response.on("error", () => finish(signal.aborted ? abortError(signal) : new AiError("upstream_network")));
      response.on("close", () => finish(signal.aborted ? abortError(signal) : new AiError("upstream_network")));
    };
    const request = transport.url.protocol === "https:"
      ? https.request(transport.url, options, onResponse)
      : http.request(transport.url, options, onResponse);
    request.on("error", () => finish(signal.aborted ? abortError(signal) : new AiError("upstream_network")));
    signal.addEventListener("abort", onAbort, { once: true });
    request.end(payload);
  });
}

// Known fields are validated strictly; unknown vendor metadata (e.g. reasoning_content) is kept
// opaque so the server-side history round-trips it. It is never sent to the page or logged.
const toolCall = z.looseObject({
  id: z.string().min(1).max(200),
  type: z.literal("function").optional(),
  function: z.looseObject({ name: z.string().max(200), arguments: z.string().max(65_536) }),
}).transform(call => ({ ...call, type: "function" as const }));
const assistantMessage = z.looseObject({
  role: z.string().max(40).default("assistant"),
  content: z.string().max(65_536).nullish(),
  tool_calls: z.array(toolCall).max(16).optional(),
});
export type AiMessage = z.infer<typeof assistantMessage>;

type Attempt = { ok: true; message: AiMessage } | { ok: false; error: AiError; vendorMessage?: string; vendorCode?: string };

function read(response: RawResponse, legacy: boolean): Attempt {
  const { status, text } = response;
  if (status >= 200 && status < 300) {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, error: new AiError("upstream_invalid_response") };
    }
    const value = payload as { error?: unknown; choices?: { message?: unknown }[] };
    const message = assistantMessage.safeParse(Array.isArray(value?.choices) ? value.choices[0]?.message : undefined);
    if (value?.error || !message.success) return { ok: false, error: new AiError("upstream_invalid_response") };
    return { ok: true, message: message.data };
  }
  const retryAfter = parseRetryAfter(typeof response.headers["retry-after"] === "string" ? response.headers["retry-after"] : undefined);
  const meta = retryAfter === undefined ? {} : { retryAfter };
  if (legacy) {
    // The relay answers {upstreamStatus} for vendor failures; its own 429 means busy.
    let upstream: unknown;
    try { upstream = (JSON.parse(text) as { upstreamStatus?: unknown }).upstreamStatus; } catch { upstream = undefined; }
    const vendorStatus = typeof upstream === "number" && Number.isInteger(upstream) ? upstream : status;
    return { ok: false, error: new AiError(classifyStatus(vendorStatus), { upstreamStatus: vendorStatus, ...meta }) };
  }
  const vendor = readVendorError(text);
  return {
    ok: false,
    error: new AiError(classifyStatus(status), { upstreamStatus: status, errorShape: vendor.shape, ...meta }),
    vendorMessage: vendor.message,
    vendorCode: vendor.code ?? vendor.type,
  };
}

const NOT_A_FIELD_ERROR = /context_length|quota|rate_limit|billing/i;

/** The other field when this refusal explicitly asks for it: only a 400/422, never quota or context errors. */
function correction(attempt: Attempt, sent: TokenField): TokenField | undefined {
  if (attempt.ok || !attempt.vendorMessage) return undefined;
  const status = attempt.error.meta.upstreamStatus;
  if (status !== 400 && status !== 422) return undefined;
  if (attempt.vendorCode && NOT_A_FIELD_ERROR.test(attempt.vendorCode)) return undefined;
  const wanted = tokenFieldWanted(attempt.vendorMessage);
  return wanted && wanted !== sent ? wanted : undefined;
}

export type AiCall = (body: Record<string, unknown>) => Promise<AiMessage>;

/**
 * Runs fn holding one queue slot for the given actor. One deadline (STARTER_AI_TIMEOUT_MS) covers
 * the queue wait and every upstream attempt inside fn; client cancellation aborts the upstream
 * request. The slot is released exactly once whether fn succeeds, fails or is cancelled.
 */
export async function withAi<T>(actor: string, signal: AbortSignal, fn: (call: AiCall, model: string) => Promise<T>): Promise<T> {
  const config = aiConfig();
  if (config.mode === "disabled") throw new AiError("ai_disabled");
  if (config.mode === "invalid" || !queue) throw new AiError("ai_config_invalid");
  const deadline = Date.now() + config.timeoutMs;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new AiError("upstream_timeout")), config.timeoutMs);
  const combined = AbortSignal.any([signal, timeout.signal]);
  let release: (() => void) | undefined;
  try {
    release = await queue.acquire(actor, combined, deadline);
    if (combined.aborted) throw abortError(combined);
    const call: AiCall = async body => {
      if (!config.adaptTokens) {
        const attempt = read(await post(config.transport, JSON.stringify(body), combined), true);
        if (!attempt.ok) throw attempt.error;
        return attempt.message;
      }
      const first = tokenCache.get(config.endpoint, config.model) ?? config.tokenField ?? MAX_TOKENS;
      const firstBody = withTokenField(body, first);
      const attempt = read(await post(config.transport, JSON.stringify(firstBody), combined), false);
      if (attempt.ok) return attempt.message;
      const wanted = correction(attempt, first);
      if (!wanted) throw attempt.error;
      const retry = read(await post(config.transport, JSON.stringify(withTokenField(firstBody, wanted)), combined), false);
      if (!retry.ok) throw retry.error;
      tokenCache.set(config.endpoint, config.model, wanted);
      return retry.message;
    };
    return await fn(call, config.model);
  } catch (error) {
    if (combined.aborted && !(error instanceof AiError)) throw abortError(combined);
    throw error;
  } finally {
    clearTimeout(timer);
    release?.();
  }
}
