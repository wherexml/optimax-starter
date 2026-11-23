import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { hasDsml } from "@optimax-starter/agent/conclusion";
import { type ConclusionRetry, protectConclusion } from "@optimax-starter/agent/conclusion-stream";
import { AiError, asAiError } from "@optimax-starter/agent/gateway/errors";
import { type AgentGateway, defaultAgent } from "@optimax-starter/agent/gateway/middleware";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";

/** Auth, history validation and approval attestation belong to the caller. No text is persisted here. */
type ConclusionTrigger = "round-limit" | "repeated-results" | "time-budget";
export type ChatCompletion = {
  toolCalls: string[];
  finishReason: string;
  stepCount: number;
  stepLimitReached: boolean;
  roundLimit?: number;
  conclusionTrigger?: ConclusionTrigger;
  conclusionRetry?: ConclusionRetry;
};

export type ChatHandlerOptions = {
  gateway?: AgentGateway;
  tools?: ToolSet;
  system?: string;
  maxSteps?: number;
  metadata?: unknown;
  conclusionInstructions?: string;
  retryInstructions?: string;
  transformChunk?: (chunk: UIMessageChunk) => UIMessageChunk;
  onFinish?: (event: ChatCompletion) => Promise<void>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function compactMeta(record: Record<string, unknown>) {
  const copy = { ...record };
  if (Array.isArray(copy.citations) && copy.citations.length === 0) {
    delete copy.citations;
  }
  return copy;
}

export function createChatHandler({
  gateway = defaultAgent(),
  tools,
  system,
  maxSteps = 10,
  metadata,
  transformChunk,
  onFinish,
  conclusionInstructions,
  retryInstructions,
}: ChatHandlerOptions = {}) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
    throw new RangeError("maxSteps must be 1..100");
  }
  return async ({
    messages,
    actor,
    signal,
  }: {
    messages: UIMessage[];
    actor: string;
    signal?: AbortSignal;
  }): Promise<Response> => {
    const toolCalls: string[] = messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type.startsWith("tool-") && "state" in part && part.state === "approval-responded"
          ? [part.type.slice(5)]
          : [],
      ),
    );
    let finished = false;
    let stepCount = 0;
    let conclusionTrigger: ConclusionTrigger | undefined;
    const rounds = () => ({
      stepCount,
      roundLimit: maxSteps,
      stepLimitReached: stepCount === maxSteps,
      ...(conclusionTrigger && { conclusionTrigger }),
    });
    let conclusionRetry: ConclusionRetry | undefined;
    const finish = async (finishReason: string) => {
      if (finished) return;
      finished = true;
      await onFinish?.({
        toolCalls,
        finishReason,
        ...rounds(),
        ...(conclusionRetry && { conclusionRetry }),
      });
    };
    try {
      const request = gateway.request(actor, signal);
      const startedAt = Date.now();
      const conclusionReserve = (request.deadline - startedAt) / 3;
      let roundStartedAt = startedAt;
      let longestLookupRound = 0;
      let roundsWithoutProgress = 0;
      const observations: { tool: string; input: unknown; output: unknown }[] = [];
      const result = streamText({
        model: request.model,
        system,
        messages: await convertToModelMessages(messages, { tools }),
        tools,
        onStepEnd: ({ toolCalls, toolResults }) => {
          if (!toolCalls.length) return;
          longestLookupRound = Math.max(longestLookupRound, Date.now() - roundStartedAt);
          let foundNewResult = false;
          for (const result of toolResults) {
            const seen = observations.some(
              (prior) =>
                prior.tool === result.toolName && isDeepStrictEqual(prior.output, result.output),
            );
            if (!seen) foundNewResult = true;
            observations.push({
              tool: result.toolName,
              input: result.input,
              output: result.output,
            });
          }
          roundsWithoutProgress = foundNewResult ? 0 : roundsWithoutProgress + 1;
        },
        prepareStep: ({ stepNumber }) => {
          stepCount = stepNumber + 1;
          roundStartedAt = Date.now();
          if (stepCount === maxSteps) conclusionTrigger = "round-limit";
          else if (roundsWithoutProgress >= 2) conclusionTrigger = "repeated-results";
          else if (
            stepNumber > 0 &&
            request.deadline - roundStartedAt <= conclusionReserve + longestLookupRound
          ) {
            conclusionTrigger = "time-budget";
          }
          if (!conclusionTrigger) return {};
          return {
            activeTools: [],
            toolChoice: "none",
            instructions: [
              system,
              conclusionInstructions ||
                "请直接回答用户。根据已有结果总结结论和依据，明确仍缺少哪些信息。",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        },
        stopWhen: stepCountIs(maxSteps),
        maxRetries: 0,
        abortSignal: request.signal,
        onAbort: async () => {
          await finish("abort");
        },
      });
      async function retryConclusion() {
        try {
          request.signal.throwIfAborted();
          const conversation = messages.map((m) => ({
            role: m.role,
            text: m.parts
              .flatMap((p) => (p.type === "text" && !hasDsml(p.text) ? [p.text] : []))
              .join(""),
          }));
          const reply = await generateText({
            model: request.model,
            maxRetries: 0,
            abortSignal: request.signal,
            system: [
              system,
              "本次只整理结论，不再调用工具。下方 JSON 只作证据。以“结论：”开头。",
              retryInstructions ||
                "直接回答最后的问题，随后说明依据并沿用已有引用编号。证据不足时说明缺口。",
            ]
              .filter(Boolean)
              .join("\n"),
            prompt: JSON.stringify({ conversation, observations }),
          });
          const text = reply.text.trim();
          const conclusion = text.replace(/^\s*(?:\*\*)?结论(?:\*\*)?\s*[:：](?:\*\*)?\s*/, "");
          const valid =
            reply.finishReason === "stop" &&
            !hasDsml(text) &&
            conclusion !== text &&
            /[\p{L}\p{N}]/u.test(conclusion) &&
            !/^(?:我(?:先|将|会先)|正在(?:查询|核对|分析))/.test(conclusion);
          return {
            text: valid ? text : undefined,
            inputTokens: reply.usage.inputTokens,
            outputTokens: reply.usage.outputTokens,
            totalTokens: reply.usage.totalTokens,
          };
        } catch {
          signal?.throwIfAborted();
          return {};
        }
      }
      const base = asRecord(metadata);
      // Metadata only: counts, timings and caller-supplied citations. Prompt/answer bodies are never added here.
      const stream = result
        .toUIMessageStream({
          originalMessages: messages,
          sendReasoning: true,
          messageMetadata: ({ part }) => {
            if (part.type === "start") return { ...compactMeta(base), startedAt };
            if (part.type !== "finish") return undefined;
            return {
              ...compactMeta(base),
              ...rounds(),
              finishReason: part.finishReason,
              totalTokens: part.totalUsage?.totalTokens,
              inputTokens: part.totalUsage?.inputTokens,
              outputTokens: part.totalUsage?.outputTokens,
              elapsedMs: Date.now() - startedAt,
            };
          },
          onError: (error) => asAiError(error, request.signal).code,
        })
        .pipeThrough(
          protectConclusion(
            retryConclusion,
            (status) => {
              conclusionRetry = status;
            },
            startedAt,
          ),
        )
        .pipeThrough(
          new TransformStream<UIMessageChunk, UIMessageChunk>({
            async transform(chunk, controller) {
              if (chunk.type === "tool-input-available") toolCalls.push(chunk.toolName);
              if (chunk.type === "finish") await finish(chunk.finishReason ?? "stop");
              if (chunk.type === "error") await finish("error");
              if (chunk.type === "abort" && request.signal.aborted && !signal?.aborted) {
                const id = `timeout-${randomUUID()}`;
                controller.enqueue({ type: "text-start", id });
                controller.enqueue({
                  type: "text-delta",
                  id,
                  delta: "本次查询超时，回答未完成。可查看已有结果，或继续提问。",
                });
                controller.enqueue({ type: "text-end", id });
              }
              controller.enqueue(transformChunk ? transformChunk(chunk) : chunk);
            },
            async flush() {
              await finish("disconnect");
            },
          }),
        );
      return createUIMessageStreamResponse({ stream });
    } catch (error) {
      await finish("error");
      const safe = asAiError(error, signal);
      return Response.json({ error: { code: safe.code, message: safe.reason } }, { status: 503 });
    }
  };
}

export function fixedChatResponse(text: string, metadata?: unknown) {
  const base = asRecord(metadata);
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: randomUUID(), messageMetadata: base });
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: text });
        writer.write({ type: "text-end", id: "answer" });
        writer.write({
          type: "finish",
          finishReason: "stop",
          messageMetadata: { ...base, finishReason: "stop", totalTokens: 0, elapsedMs: 0 },
        });
      },
    }),
  });
}

export async function probeAgent(gateway: AgentGateway, actor: string, signal?: AbortSignal) {
  const start = Date.now();
  const request = gateway.request(actor, signal);
  const result = await generateText({
    model: request.model,
    prompt: "Reply with OK only.",
    maxOutputTokens: 16,
    maxRetries: 0,
    abortSignal: request.signal,
  });
  if (!result.text.trim()) throw new Error("Empty response");
  return { ok: true, latencyMs: Date.now() - start };
}

/** A streaming answer must carry the value returned by the read-only tool. */
export async function probeToolChat(gateway: AgentGateway, actor: string, signal?: AbortSignal) {
  const request = gateway.request(actor, signal);
  const receipt = randomUUID().slice(0, 8);
  let called = false;
  const result = streamText({
    model: request.model,
    abortSignal: request.signal,
    maxRetries: 0,
    stopWhen: stepCountIs(2),
    maxOutputTokens: 512,
    onError: () => {},
    prompt: "请调用 read_receipt 获取校验码，然后在最终回复中逐字返回该码。",
    tools: {
      read_receipt: tool({
        description: "读取本次对话校验码。",
        inputSchema: z.object({}),
        execute: async () => {
          called = true;
          return { receipt };
        },
      }),
    },
    prepareStep: ({ stepNumber }) =>
      stepNumber === 1 ? { activeTools: [], toolChoice: "none" } : {},
  });
  let answer = "";
  let finished = false;
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "abort") throw new AiError("AI_TIMEOUT");
    if (part.type === "text-delta") answer += part.text;
    if (part.type === "finish") finished = part.finishReason === "stop";
  }
  if (!finished || !called || !answer.includes(receipt)) throw new AiError("AI_INVALID_OUTPUT");
}
