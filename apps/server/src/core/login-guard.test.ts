import { describe, expect, it } from "vitest";
import {
  IP_POLICY,
  USER_POLICY,
  ipGuardKey,
  isLocked,
  lockedMessage,
  nextFailureState,
  retryAfterSeconds,
  userGuardKey,
  type GuardPolicy,
  type GuardState,
} from "./login-guard";

const MIN = 60_000;
const t0 = new Date("2026-11-21T08:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function fail(times: number, policy: GuardPolicy, start = t0, stepMs = 1000) {
  let state: GuardState | null = null;
  for (let i = 0; i < times; i++) state = nextFailureState(state, new Date(start.getTime() + i * stepMs), policy);
  return state!;
}

describe("login guard keys", () => {
  it("normalizes usernames case-insensitively and scopes buckets", () => {
    expect(userGuardKey("  Demo@OptiMax.hk ")).toBe("user:demo@optimax.hk");
    expect(ipGuardKey("127.0.0.1")).toBe("ip:127.0.0.1");
    expect(userGuardKey("x".repeat(200)).length).toBe(5 + 80);
  });
});

describe("thresholds", () => {
  it("locks an account after 5 failures within 30 minutes for 30 minutes", () => {
    const four = fail(4, USER_POLICY);
    expect(four.failures).toBe(4);
    expect(isLocked(four, at(5000))).toBe(false);
    const five = nextFailureState(four, at(5000), USER_POLICY);
    expect(five.failures).toBe(5);
    expect(five.lockedUntil?.getTime()).toBe(at(5000).getTime() + 30 * MIN);
    expect(isLocked(five, at(6000))).toBe(true);
    expect(isLocked(five, at(5000 + 30 * MIN))).toBe(false);
  });

  it("locks an IP only after 20 failures within 15 minutes (NAT / local scripts safe)", () => {
    const nineteen = fail(19, IP_POLICY);
    expect(isLocked(nineteen, at(19_000))).toBe(false);
    const twenty = nextFailureState(nineteen, at(19_000), IP_POLICY);
    expect(isLocked(twenty, at(20_000))).toBe(true);
    expect(twenty.lockedUntil?.getTime()).toBe(at(19_000).getTime() + 30 * MIN);
  });

  it("does not lock when failures are spread outside the window", () => {
    // One failure every 8 minutes: the 30-minute window resets before 5 accumulate.
    const spread = fail(10, USER_POLICY, t0, 8 * MIN);
    expect(spread.failures).toBeLessThan(USER_POLICY.maxFailures);
    expect(spread.lockedUntil).toBeNull();
  });
});

describe("lock expiry", () => {
  it("starts a fresh window after the lock expires", () => {
    const locked = fail(5, USER_POLICY);
    const after = nextFailureState(locked, new Date(locked.lockedUntil!.getTime() + 1), USER_POLICY);
    expect(after.failures).toBe(1);
    expect(after.lockedUntil).toBeNull();
  });

  it("clearing (row deleted on success/reset) behaves as a fresh bucket", () => {
    const fresh = nextFailureState(null, t0, USER_POLICY);
    expect(fresh).toEqual({ failures: 1, windowStart: t0, lockedUntil: null });
  });
});

describe("retry-after", () => {
  it("is an integer >= 1 second and renders minutes in the message", () => {
    expect(retryAfterSeconds(at(1500), t0)).toBe(2);
    expect(retryAfterSeconds(at(-5000), t0)).toBe(1);
    expect(retryAfterSeconds(at(30 * MIN), t0)).toBe(1800);
    expect(lockedMessage(1800)).toBe("登录失败次数过多，请于 30 分钟后再试");
    expect(lockedMessage(61)).toBe("登录失败次数过多，请于 2 分钟后再试");
    expect(lockedMessage(1)).toBe("登录失败次数过多，请于 1 分钟后再试");
  });
});
