import { AiError, type AiErrorCode, asAiError } from "@optimax-starter/agent/gateway/errors";
import { AiQueue } from "@optimax-starter/agent/gateway/queue";
import {
  type AiConfig,
  type AiEnvironment,
  readAiConfig,
} from "@optimax-starter/agent/models/config";
import { createProvider } from "@optimax-starter/agent/models/provider";
import {
  defaultSettingsMiddleware,
  extractReasoningMiddleware,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";

export type AuditEvent = { actor: string; model: string; durationMs: number; code?: AiErrorCode };
export type AgentOptions = {
  env?: AiEnvironment;
  config?: AiConfig;
  /** Display label for chat UIs; defaults to STARTER_AI_MODEL_LABEL, then the model id. */
  modelLabel?: string;
  isCircuitOpen?: () => Promise<boolean>;
  audit?: (event: AuditEvent) => void | Promise<void>;
};

function thinkingOptions(model: string) {
  if (/qwen/i.test(model)) return { enable_thinking: false };
  if (/deepseek|glm|doubao|ark/i.test(model)) return { thinking: { type: "disabled" } };
  return {};
}

export function createAgent(options: AgentOptions = {}) {
  const config = options.config ?? readAiConfig(options.env);
  const queue = config.status === "enabled" ? new AiQueue(config.limits) : undefined;
  let provider: ReturnType<typeof createProvider> | undefined;
  const label =
    options.modelLabel?.trim() || (options.env ?? process.env).STARTER_AI_MODEL_LABEL?.trim();
  return {
    protocol: config.status === "enabled" ? config.protocol : ("openai-completions" as const),
    structuredMode: config.status === "enabled" ? config.structuredMode : ("json_schema" as const),
    /** Display label for authenticated chat UIs; health/status responses must not expose it. */
    modelLabel: config.status === "enabled" ? label?.slice(0, 80) || config.model : "",
    configured: config.status === "enabled",
    snapshot: () => queue?.snapshot() ?? { active: 0, waiting: 0, activeActors: 0 },
    close: async () => {
      await provider?.close();
    },
    request(actor: string, signal?: AbortSignal) {
      if (config.status !== "enabled" || !queue) throw new AiError("AI_DISABLED");
      provider ??= createProvider(config);
      const deadline = Date.now() + config.timeoutMs;
      const combined = AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(config.timeoutMs),
      ]);
      const admit = async () => {
        if (await options.isCircuitOpen?.()) throw new AiError("AI_CIRCUIT_OPEN");
        const release = await queue.acquire(actor, combined, deadline);
        try {
          if (combined.aborted) throw new AiError("AI_TIMEOUT");
          if (await options.isCircuitOpen?.()) throw new AiError("AI_CIRCUIT_OPEN");
        } catch (error) {
          release();
          throw error;
        }
        return release;
      };
      const guard: LanguageModelMiddleware = {
        transformParams: async ({ params }) => ({ ...params, abortSignal: combined }),
        wrapGenerate: async ({ doGenerate }) => {
          const at = Date.now();
          let release: (() => void) | undefined;
          let code: AiErrorCode | undefined;
          try {
            release = await admit();
            return await doGenerate();
          } catch (error) {
            const safe = asAiError(error, combined);
            code = safe.code;
            throw safe;
          } finally {
            release?.();
            await audit(at, code);
          }
        },
        wrapStream: async ({ doStream }) => {
          const at = Date.now();
          let release: (() => void) | undefined;
          let finished = false;
          const onAbort = () => {
            void finish("AI_TIMEOUT");
          };
          const finish = async (code?: AiErrorCode) => {
            if (finished) return;
            finished = true;
            combined.removeEventListener("abort", onAbort);
            release?.();
            await audit(at, code);
          };
          try {
            release = await admit();
            combined.addEventListener("abort", onAbort, { once: true });
            const result = await doStream();
            const reader = result.stream.getReader();
            return {
              ...result,
              stream: new ReadableStream({
                async pull(controller) {
                  try {
                    const next = await reader.read();
                    if (next.done) {
                      await finish();
                      controller.close();
                    } else if (next.value.type === "error") {
                      const safe = asAiError(next.value.error, combined);
                      await finish(safe.code);
                      controller.enqueue({ ...next.value, error: safe });
                    } else controller.enqueue(next.value);
                  } catch (error) {
                    const safe = asAiError(error, combined);
                    await finish(safe.code);
                    controller.error(safe);
                  }
                },
                async cancel(reason) {
                  try {
                    await reader.cancel(reason);
                  } finally {
                    await finish("AI_TIMEOUT");
                  }
                },
              }),
            };
          } catch (error) {
            const safe = asAiError(error, combined);
            await finish(safe.code);
            throw safe;
          }
        },
      };
      async function audit(at: number, code?: AiErrorCode) {
        // Audit callbacks get metadata only. A logging outage must not leak SDK error objects.
        try {
          await options.audit?.({
            actor,
            model: config.status === "enabled" ? config.model : "",
            durationMs: Date.now() - at,
            ...(code ? { code } : {}),
          });
        } catch {
          /* Caller owns audit transport health. */
        }
      }
      return {
        deadline,
        signal: combined,
        model: wrapLanguageModel({
          model: provider.model,
          middleware: [
            guard,
            extractReasoningMiddleware({ tagName: "think" }),
            defaultSettingsMiddleware({
              settings: {
                temperature: 0,
                maxOutputTokens: 4096,
                providerOptions: { compatible: thinkingOptions(config.model) },
              },
            }),
          ],
        }),
      };
    },
  };
}
export type AgentGateway = ReturnType<typeof createAgent>;
let shared: AgentGateway | undefined;
export const defaultAgent = () => {
  shared ??= createAgent();
  return shared;
};
