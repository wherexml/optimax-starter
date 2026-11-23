import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EnabledConfig } from "@optimax-starter/agent/models/config";
import { Agent, fetch as undiciFetch } from "undici";

export function createProvider(config: EnabledConfig) {
  const dispatcher = new Agent({ connect: config.ca ? { ca: config.ca } : {} });
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    const signal = AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(config.timeoutMs),
    ]);
    const options = { ...init, signal, redirect: "error", dispatcher } as Parameters<
      typeof undiciFetch
    >[1];
    return (await undiciFetch(url as string, options)) as unknown as Response;
  }) as typeof globalThis.fetch;
  const settings = { baseURL: config.baseURL, apiKey: config.apiKey, fetch: transport };
  const model =
    config.protocol === "anthropic-messages"
      ? createAnthropic(settings).messages(config.model)
      : createOpenAICompatible({
          ...settings,
          name: "compatible",
          includeUsage: true,
          supportsStructuredOutputs: config.structuredMode === "json_schema",
        }).chatModel(config.model);
  return {
    model,
    close: async () => {
      // Bun's undici polyfill may not expose the connection-pool lifecycle API.
      await (dispatcher as { close?: () => Promise<void> | void }).close?.();
    },
  };
}
