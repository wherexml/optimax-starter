import { DEFAULT_SESSION_TTL_HOURS } from "@optimax-starter/api";

export const SESSION_LIFETIME_SECONDS = DEFAULT_SESSION_TTL_HOURS * 60 * 60;
export const DEMO_DEFAULT_PASSWORD = ["demo", "2026!"].join("@");

export function getCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || "optimax_console";
}

export function getCorsOrigin(): string {
  return process.env.CORS_ORIGIN?.trim() || "http://127.0.0.1:38140";
}

export function getBootstrapAdminUsername(): string {
  if (process.env.NODE_ENV === "production") {
    return process.env.STARTER_ADMIN_USERNAME?.trim() || "";
  }
  return process.env.STARTER_ADMIN_USERNAME?.trim() || "demo@optimax.hk";
}

export function assertProductionSafety(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.STARTER_SEED_DEMO === "true") {
    throw new Error("生产环境禁止开启 STARTER_SEED_DEMO");
  }
  const adminPassword = process.env.STARTER_ADMIN_PASSWORD;
  if (adminPassword) {
    if (adminPassword === DEMO_DEFAULT_PASSWORD) {
      throw new Error("生产环境禁止使用本地演示默认密码");
    }
    if (adminPassword.length < 10) {
      throw new Error("生产环境 STARTER_ADMIN_PASSWORD 长度不得少于 10 位");
    }
  }
}

export function shouldSeedDemo(): boolean {
  assertProductionSafety();
  if (process.env.NODE_ENV === "production") return false;
  return process.env.STARTER_SEED_DEMO !== "false";
}
