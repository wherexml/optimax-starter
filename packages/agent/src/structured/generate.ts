import { AiError, type AiErrorCode, asAiError } from "@optimax-starter/agent/gateway/errors";
import { type AgentGateway, defaultAgent } from "@optimax-starter/agent/gateway/middleware";
import { repairJson } from "@optimax-starter/agent/structured/repair";
import {
  generateText,
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";

export type StructuredResult<T> =
  | { ok: true; data: T; usage: LanguageModelUsage; attempts: number; model: string }
  | { ok: false; code: AiErrorCode; reason: string; attempts: number };

const abnormalFinish = (reason: string) => ["length", "content-filter", "error"].includes(reason);

/** One schema object per call; transport retries belong to the caller. Only validation gets one retry. */
export async function generateStructured<S extends z.ZodType>({
  schema,
  system,
  prompt,
  actor,
  signal,
  gateway = defaultAgent(),
  maxOutputTokens = 4096,
}: {
  schema: S;
  system?: string;
  prompt: string;
  actor: string;
  signal?: AbortSignal;
  gateway?: AgentGateway;
  maxOutputTokens?: number;
}): Promise<StructuredResult<z.output<S>>> {
  let attempts = 0;
  let request: ReturnType<AgentGateway["request"]> | undefined;
  try {
    request = gateway.request(actor, signal);
    const jsonSchema = z.toJSONSchema(schema);
    const instructions =
      gateway.structuredMode === "json_object"
        ? [
            system,
            `Return exactly one JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
          ]
            .filter(Boolean)
            .join("\n")
        : system;
    const channel: LanguageModelMiddleware = {
      transformParams: async ({ params }) => {
        if (gateway.structuredMode === "json_object") {
          return {
            ...params,
            responseFormat:
              gateway.protocol === "anthropic-messages" ? undefined : { type: "json" },
          };
        }
        if (gateway.structuredMode === "tool") {
          return {
            ...params,
            responseFormat: undefined,
            tools: [
              {
                type: "function",
                name: "submit",
                description: "Submit exactly one result.",
                inputSchema: jsonSchema,
              },
            ],
            toolChoice: { type: "tool", toolName: "submit" },
          };
        }
        return params;
      },
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        // Reject before repair, including gateways that return raw "error" as an unknown finish reason.
        if (abnormalFinish(result.finishReason.unified) || result.finishReason.raw === "error") {
          throw new AiError("AI_INVALID_OUTPUT");
        }
        let text: string;
        if (gateway.structuredMode === "tool") {
          const calls = result.content.filter((part) => part.type === "tool-call");
          const call = calls[0];
          if (calls.length !== 1 || call?.toolName !== "submit") {
            throw new AiError("AI_INVALID_OUTPUT");
          }
          text = call.input;
        } else {
          text = result.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
        }
        if (!text.trim()) throw new AiError("AI_INVALID_OUTPUT");
        const repaired = repairJson(text) ?? text;
        return {
          ...result,
          structuredOutputText: repaired,
          ...(gateway.structuredMode === "tool"
            ? {
                content: [{ type: "text" as const, text: repaired }],
                finishReason: { unified: "stop" as const, raw: result.finishReason.raw },
              }
            : {}),
        };
      },
    };
    const model = wrapLanguageModel({ model: request.model, middleware: channel });
    let feedback = "";
    for (let index = 0; index < 2; index++) {
      attempts++;
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema }),
          system: instructions,
          prompt: prompt + feedback,
          temperature: 0,
          maxOutputTokens,
          maxRetries: 0,
          abortSignal: request.signal,
        });
        return {
          ok: true,
          data: schema.parse(result.output),
          usage: result.usage,
          attempts,
          model: result.response.modelId,
        };
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        if (!error.text?.trim() || abnormalFinish(error.finishReason ?? "")) {
          throw new AiError("AI_INVALID_OUTPUT");
        }
        const repaired = repairJson(error.text);
        let summary = "Return valid JSON for the requested schema.";
        if (repaired) {
          const parsed = schema.safeParse(JSON.parse(repaired));
          if (!parsed.success) {
            summary = parsed.error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.join(".") || "value"}: ${issue.code}`)
              .join("; ");
          }
        }
        if (index === 1) throw new AiError("AI_INVALID_OUTPUT");
        feedback = `\nValidation error: ${summary}. Return one corrected JSON object.`;
      }
    }
    throw new AiError("AI_INVALID_OUTPUT");
  } catch (error) {
    const safe = asAiError(error, request?.signal ?? signal);
    return { ok: false, code: safe.code, reason: safe.reason, attempts };
  }
}
