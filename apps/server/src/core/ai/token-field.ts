// Ported from Magpie internal/provider/token_field.go (TokenFieldWanted, WithTokenField, OpenAIHost)
// and the one-correction call policy of internal/gateway/token_field.go.
// Copyright (c) 2026 yetone. MIT License, full text: third_party/licenses/magpie-MIT.txt.
// Source: https://github.com/yetone/magpie/blob/58cf764533743a84b93a8b2cbff61fde27350856/internal/provider/token_field.go
// Changes: TypeScript object operations instead of gjson byte splicing; correction limited to
// HTTP 400/422 JSON error messages; bounded TTL capability cache keyed by endpoint + model.

export const MAX_TOKENS = "max_tokens";
export const MAX_COMPLETION_TOKENS = "max_completion_tokens";
export type TokenField = typeof MAX_TOKENS | typeof MAX_COMPLETION_TOKENS;

export function isTokenField(value: unknown): value is TokenField {
  return value === MAX_TOKENS || value === MAX_COMPLETION_TOKENS;
}

/** OpenAI's own API (api.openai.com) reads max_completion_tokens; Azure OpenAI and relays are not this host. */
export function isOpenAIHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "openai.com" || host.endsWith(".openai.com");
}

// Only words that name the other field as the one to use; "max_tokens must be at most 32768" does not match.
const TOKEN_FIELD_ASKED = /\buse\s+['"`]?(max_completion_tokens|max_tokens)['"`]?/i;

/** The field a vendor refusal message asks for in place of the one sent, or undefined. */
export function tokenFieldWanted(message: string): TokenField | undefined {
  const match = TOKEN_FIELD_ASKED.exec(message);
  const field = match?.[1]?.toLowerCase();
  return isTokenField(field) ? field : undefined;
}

/**
 * Returns body with its reply length named `want`. The value is kept; a body naming both keeps
 * want's value and drops the other. Other keys (messages, tools, numbers) are untouched.
 */
export function withTokenField<T extends Record<string, unknown>>(body: T, want: TokenField): Record<string, unknown> {
  const from: TokenField = want === MAX_TOKENS ? MAX_COMPLETION_TOKENS : MAX_TOKENS;
  if (!Object.hasOwn(body, from)) return { ...body };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === from) {
      if (!Object.hasOwn(body, want)) out[want] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Bounded TTL cache of which field an endpoint + model accepts, learned from one explicit correction. */
export class TokenFieldCache {
  private readonly entries = new Map<string, { field: TokenField; expires: number }>();

  constructor(private readonly maxEntries = 64, private readonly ttlMs = 6 * 60 * 60_000) {}

  get(endpoint: string, model: string, now = Date.now()): TokenField | undefined {
    const key = `${endpoint}\n${model}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.field;
  }

  set(endpoint: string, model: string, field: TokenField, now = Date.now()): void {
    const key = `${endpoint}\n${model}`;
    this.entries.delete(key);
    for (const [other, entry] of this.entries) if (entry.expires <= now) this.entries.delete(other);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { field, expires: now + this.ttlMs });
  }
}
