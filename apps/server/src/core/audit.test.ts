import { describe, expect, it } from "vitest";
import { containsPattern, dayStart, sanitizeAuditDetail } from "./audit";

describe("audit helpers", () => {
  it("recursively redacts sensitive keys while preserving audit metadata", () => {
    const cleaned = sanitizeAuditDetail({
      domain: "采购",
      password: "secret",
      apiKey: "sk-123",
      nested: {
        token: "abc",
        prompt: "ignore rules",
        fields: ["email", "company"],
      },
      items: [{ authorization: "Bearer xxx", ok: true }],
    }) as Record<string, unknown>;

    expect(cleaned.domain).toBe("采购");
    expect(cleaned.password).toBe("[REDACTED]");
    expect(cleaned.apiKey).toBe("[REDACTED]");
    expect(cleaned.nested).toEqual({
      token: "[REDACTED]",
      prompt: "[REDACTED]",
      fields: ["email", "company"],
    });
    expect(cleaned.items).toEqual([{ authorization: "[REDACTED]", ok: true }]);
  });

  it("escapes LIKE wildcards safely", () => {
    expect(containsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });

  it("computes zoned local midnight boundaries", () => {
    expect(dayStart("2026-11-21", 0, "Asia/Shanghai").toISOString()).toBe(
      "2026-11-20T16:00:00.000Z",
    );
    expect(dayStart("2026-11-21", 1, "Asia/Shanghai").toISOString()).toBe(
      "2026-11-21T16:00:00.000Z",
    );
    expect(dayStart("2026-11-21", 0, "UTC").toISOString()).toBe(
      "2026-11-21T00:00:00.000Z",
    );
  });
});
