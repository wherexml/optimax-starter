import { randomUUID } from "node:crypto";
import { unavailableConclusion, visibleDelta } from "@optimax-starter/agent/conclusion";
import type { UIMessageChunk } from "ai";

export type ConclusionRetry = "succeeded" | "failed";
type Summary = { text?: string; inputTokens?: number; outputTokens?: number; totalTokens?: number };
const USAGE_KEYS = ["inputTokens", "outputTokens", "totalTokens"] as const;

/** Retain genuine tool events (including approval pauses); never interpret tool markup from a text channel. */
export function protectConclusion(
  retry: () => Promise<Summary>,
  onRetry: (status: ConclusionRetry) => void,
  startedAt: number,
) {
  const blocks = new Map<string, { pending: string; blocked: boolean }>();
  let malformed = false;
  let deferredStep: UIMessageChunk | undefined;
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    async transform(chunk, controller) {
      if (chunk.type === "start-step") {
        if (deferredStep) controller.enqueue(deferredStep);
        deferredStep = undefined;
        malformed = false;
      }
      if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
        const block = blocks.get(chunk.id);
        if (block?.blocked) return;
        const safe = visibleDelta((block?.pending ?? "") + chunk.delta);
        blocks.set(chunk.id, safe);
        if (safe.blocked && chunk.type === "text-delta") malformed = true;
        if (safe.text) controller.enqueue({ ...chunk, delta: safe.text });
        return;
      }
      if (chunk.type === "text-end" || chunk.type === "reasoning-end") {
        const block = blocks.get(chunk.id);
        if (block?.pending) {
          controller.enqueue({
            type: chunk.type === "text-end" ? "text-delta" : "reasoning-delta",
            id: chunk.id,
            delta: block.pending,
          });
        }
        blocks.delete(chunk.id);
      }
      if (chunk.type === "finish-step" && malformed) {
        deferredStep = chunk;
        return;
      }
      if (chunk.type === "finish" && malformed) {
        const summary = await retry();
        const status = summary.text ? "succeeded" : "failed";
        onRetry(status);
        const id = `conclusion-${randomUUID()}`;
        controller.enqueue({ type: "text-start", id });
        controller.enqueue({
          type: "text-delta",
          id,
          delta: summary.text ?? unavailableConclusion,
        });
        controller.enqueue({ type: "text-end", id });
        if (deferredStep) controller.enqueue(deferredStep);
        const meta = (chunk.messageMetadata ?? {}) as Record<string, unknown>;
        const usage: Record<string, number> = {};
        for (const key of USAGE_KEYS) {
          const value = summary[key];
          if (value !== undefined) usage[key] = Number(meta[key] ?? 0) + value;
        }
        controller.enqueue({
          ...chunk,
          messageMetadata: {
            ...meta,
            ...usage,
            conclusionRetry: status,
            elapsedMs: Date.now() - startedAt,
          },
        });
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
