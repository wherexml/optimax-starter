export type AiErrorCode =
  | "AI_DISABLED"
  | "AI_CIRCUIT_OPEN"
  | "AI_RATE_LIMITED"
  | "AI_QUEUE_FULL"
  | "AI_QUEUE_TIMEOUT"
  | "AI_TIMEOUT"
  | "AI_UPSTREAM_ERROR"
  | "AI_INVALID_OUTPUT";

const reasons: Record<AiErrorCode, string> = {
  AI_DISABLED: "AI is not configured or its configuration is invalid.",
  AI_CIRCUIT_OPEN: "AI is temporarily disabled.",
  AI_RATE_LIMITED: "Too many requests.",
  AI_QUEUE_FULL: "The request queue is full.",
  AI_QUEUE_TIMEOUT: "The queue deadline expired.",
  AI_TIMEOUT: "The request was cancelled or timed out.",
  AI_UPSTREAM_ERROR: "The model service failed.",
  AI_INVALID_OUTPUT: "The model output did not match the required schema.",
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly reason: string;
  constructor(code: AiErrorCode, reason = reasons[code]) {
    super(reason);
    this.name = "AiError";
    this.code = code;
    this.reason = reason;
  }
}

/** Never return vendor messages, request bodies, URLs or credentials. */
export function asAiError(error: unknown, signal?: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (signal?.aborted) return new AiError("AI_TIMEOUT");
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 429) {
    return new AiError("AI_RATE_LIMITED");
  }
  return new AiError("AI_UPSTREAM_ERROR");
}
