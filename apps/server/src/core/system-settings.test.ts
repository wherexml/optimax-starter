import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TTL_HOURS,
  MAX_SESSION_TTL_HOURS,
  MIN_SESSION_TTL_HOURS,
  formatSessionTtlHint,
  formatSessionTtlLabel,
  normalizeSessionTtlHours,
  systemSettingsUpdateSchema,
} from "@optimax-starter/api";

describe("session TTL helpers", () => {
  it("exposes expected default bounds", () => {
    expect(DEFAULT_SESSION_TTL_HOURS).toBe(168);
    expect(MIN_SESSION_TTL_HOURS).toBe(1);
    expect(MAX_SESSION_TTL_HOURS).toBe(2160);
  });

  it("normalizes valid integer hours and trimmed numeric strings", () => {
    expect(normalizeSessionTtlHours(1)).toBe(1);
    expect(normalizeSessionTtlHours(168)).toBe(168);
    expect(normalizeSessionTtlHours(2160)).toBe(2160);
    expect(normalizeSessionTtlHours(" 72 ")).toBe(72);
    expect(normalizeSessionTtlHours("720")).toBe(720);
  });

  it("rejects out-of-range, fractional, empty, and non-numeric inputs", () => {
    expect(normalizeSessionTtlHours(0)).toBeNull();
    expect(normalizeSessionTtlHours(-8)).toBeNull();
    expect(normalizeSessionTtlHours(2161)).toBeNull();
    expect(normalizeSessionTtlHours(12.5)).toBeNull();
    expect(normalizeSessionTtlHours("")).toBeNull();
    expect(normalizeSessionTtlHours("   ")).toBeNull();
    expect(normalizeSessionTtlHours("abc")).toBeNull();
    expect(normalizeSessionTtlHours(null)).toBeNull();
    expect(normalizeSessionTtlHours(undefined)).toBeNull();
    expect(normalizeSessionTtlHours(true)).toBeNull();
  });

  it("formats session TTL labels and human-readable day hints", () => {
    expect(formatSessionTtlLabel(12)).toBe("12 小时");
    expect(formatSessionTtlLabel(24)).toBe("1 天（24 小时）");
    expect(formatSessionTtlLabel(36)).toBe("36 小时");
    expect(formatSessionTtlLabel(168)).toBe("7 天（168 小时）");
    expect(formatSessionTtlLabel(720)).toBe("30 天（720 小时）");
    expect(formatSessionTtlLabel(2160)).toBe("90 天（2160 小时）");

    expect(formatSessionTtlHint(12)).toBe("12 小时");
    expect(formatSessionTtlHint(24)).toBe("折合 1 天");
    expect(formatSessionTtlHint(36)).toBe("折合 1 天 12 小时");
    expect(formatSessionTtlHint(168)).toBe("折合 7 天");
    expect(formatSessionTtlHint(720)).toBe("折合 30 天");
    expect(formatSessionTtlHint(2160)).toBe("折合 90 天");
  });

  it("validates systemSettingsUpdateSchema boundaries", () => {
    expect(systemSettingsUpdateSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
    expect(systemSettingsUpdateSchema.safeParse({ sessionTtlHours: 336 }).success).toBe(true);
    expect(
      systemSettingsUpdateSchema.safeParse({ timezone: "Asia/Shanghai", sessionTtlHours: 168 })
        .success,
    ).toBe(true);
    expect(systemSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(systemSettingsUpdateSchema.safeParse({ sessionTtlHours: 0 }).success).toBe(false);
    expect(systemSettingsUpdateSchema.safeParse({ sessionTtlHours: 2161 }).success).toBe(false);
    expect(systemSettingsUpdateSchema.safeParse({ sessionTtlHours: 12.5 }).success).toBe(false);
  });
});
