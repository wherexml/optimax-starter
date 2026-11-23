import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { UIMessageChunk } from "@optimax-starter/agent";
import { Refusal } from "../core/guards";

// No transcript store: approval ids are HMAC attestations of (binding, call id, tool, input, expiry).
// The key lives in process memory, so a restart invalidates pending cards; users can re-request.
const key = randomBytes(32);
const APPROVAL_TTL_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 60_000;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const digest = (binding: string, id: string, name: string, input: unknown, expires: string) =>
  createHmac("sha256", key)
    .update(canonical([binding, id, name, input, expires]))
    .digest("hex");

const invalidApproval = () => new Refusal(403, "确认已失效，请重新发起操作", "APPROVAL_INVALID");

/** Replaces SDK approval ids with signed tokens bound to the caller and the exact tool input. */
export function approvalTransform(binding: string) {
  const calls = new Map<string, { name: string; input: unknown }>();
  return (chunk: UIMessageChunk): UIMessageChunk => {
    if (chunk.type === "tool-input-available") {
      calls.set(chunk.toolCallId, { name: chunk.toolName, input: chunk.input });
    }
    if (chunk.type !== "tool-approval-request") return chunk;
    const call = calls.get(chunk.toolCallId);
    if (!call) throw new Error("Missing approval input");
    const expires = String(Date.now() + APPROVAL_TTL_MS);
    const signature = digest(binding, chunk.toolCallId, call.name, call.input, expires);
    return { ...chunk, approvalId: `${expires}.${signature}` };
  };
}

export function verifyApproval(
  binding: string,
  id: string,
  name: string,
  input: unknown,
  token: string,
) {
  const parts = token.split(".");
  if (parts.length !== 2) throw invalidApproval();
  const [expires = "", signature = ""] = parts;
  const now = Date.now();
  if (!/^\d+$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature)) throw invalidApproval();
  const at = Number(expires);
  if (at < now || at > now + APPROVAL_TTL_MS + CLOCK_SKEW_MS) throw invalidApproval();
  const expected = digest(binding, id, name, input, expires);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw invalidApproval();
}
