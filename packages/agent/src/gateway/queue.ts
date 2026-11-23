// Bounded FIFO slot queue ported in reduced form from Magpie internal/gateway/concurrency.go
// (lanes.take, lane.grant, lanes.releaser, lanes.drop).
// Copyright (c) 2026 yetone. MIT License, full text: third_party/licenses/magpie-MIT.txt.
// Source: https://github.com/yetone/magpie/blob/58cf764533743a84b93a8b2cbff61fde27350856/internal/gateway/concurrency.go
// Changes: one lane for the configured endpoint (no account routing, laneMate/waitMate or RPM);
// the queue is always bounded in length and wait; a per-actor limit counts active plus waiting
// requests; AbortSignal replaces context cancellation; per-actor counters are dropped at zero.

import { AiError } from "@optimax-starter/agent/gateway/errors";

export type QueueLimits = {
  concurrency: number;
  queueLimit: number;
  queueWaitMs: number;
  actorLimit: number;
};

type Waiter = {
  actor: string;
  grant: (release: () => void) => void;
  cleanup: () => void;
};

export class AiQueue {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  private readonly actors = new Map<string, number>();

  private readonly limits: QueueLimits;
  constructor(limits: QueueLimits) {
    this.limits = limits;
  }

  snapshot() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      activeActors: this.actors.size,
    };
  }

  /** Waits in turn for a slot; resolves with a release that is safe to call more than once. */
  acquire(actor: string, signal: AbortSignal, deadline: number): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if ((this.actors.get(actor) ?? 0) >= this.limits.actorLimit) {
      return Promise.reject(new AiError("AI_RATE_LIMITED"));
    }
    if (this.active < this.limits.concurrency && this.waiting.length === 0) {
      this.active++;
      this.count(actor, 1);
      return Promise.resolve(this.releaser(actor));
    }
    if (this.waiting.length >= this.limits.queueLimit) {
      return Promise.reject(new AiError("AI_QUEUE_FULL"));
    }

    return new Promise((resolve, reject) => {
      const untilDeadline = Math.max(0, deadline - Date.now());
      const queueFirst = this.limits.queueWaitMs <= untilDeadline;
      const timer = setTimeout(
        () => leave(new AiError(queueFirst ? "AI_QUEUE_TIMEOUT" : "AI_TIMEOUT")),
        Math.min(this.limits.queueWaitMs, untilDeadline),
      );
      const onAbort = () => leave(abortError(signal));
      const waiter: Waiter = {
        actor,
        grant: (release) => {
          waiter.cleanup();
          resolve(release);
        },
        cleanup: () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
        },
      };
      const leave = (error: AiError) => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return; // already granted
        this.waiting.splice(index, 1);
        waiter.cleanup();
        this.count(actor, -1);
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
      this.count(actor, 1);
    });
  }

  private releaser(actor: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.count(actor, -1);
      this.grant();
    };
  }

  /** Lets those first in the queue go while there is room. Their actor count was taken on enqueue. */
  private grant() {
    while (this.waiting.length > 0 && this.active < this.limits.concurrency) {
      const next = this.waiting.shift()!;
      this.active++;
      next.grant(this.releaser(next.actor));
    }
  }

  private count(actor: string, delta: number) {
    const value = (this.actors.get(actor) ?? 0) + delta;
    if (value <= 0) this.actors.delete(actor);
    else this.actors.set(actor, value);
  }
}

export function abortError(signal: AbortSignal): AiError {
  return signal.reason instanceof AiError ? signal.reason : new AiError("AI_TIMEOUT");
}
