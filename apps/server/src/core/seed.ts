import { count, eq } from "drizzle-orm";
import { accounts } from "@optimax-starter/db/schema/console";
import { hashPassword } from "../password";
import { db } from "../services";
import { ADMIN_LOCK } from "./guards";
import {
  assertProductionSafety,
  getBootstrapAdminUsername,
  shouldSeedDemo,
} from "./config";

type DemoSeeder = () => Promise<void>;

const DEMO_SEEDERS: DemoSeeder[] = [];

/** Business modules register idempotent demo seeders; they run only when demo seeding is on. */
export function registerDemoSeeder(fn: DemoSeeder): void {
  DEMO_SEEDERS.push(fn);
}

// 生产首个 super_admin：仅在 console_account 为空时创建一次，绝不修改已有账户。
async function bootstrapProductionAdmin() {
  const username = process.env.STARTER_ADMIN_USERNAME?.trim();
  const password = process.env.STARTER_ADMIN_PASSWORD;
  if (!username || !password) return;
  const [existing] = await db.select({ n: count() }).from(accounts);
  if (Number(existing?.n) > 0) return;
  const hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.execute(ADMIN_LOCK);
    const [lockedCount] = await tx.select({ n: count() }).from(accounts);
    if (Number(lockedCount?.n) !== 0) return;
    await tx
      .insert(accounts)
      .values({
        username,
        name: "系统管理员",
        role: "super_admin",
        active: true,
        hash,
      })
      .onConflictDoNothing();
  });
}

export async function initializeConsole() {
  assertProductionSafety();
  if (!shouldSeedDemo()) {
    await bootstrapProductionAdmin();
    return;
  }

  const adminUsername = getBootstrapAdminUsername();
  const [existing] = await db
    .select({ id: accounts.id, role: accounts.role, active: accounts.active })
    .from(accounts)
    .where(eq(accounts.username, adminUsername));
  if (!existing) {
    const password = process.env.STARTER_ADMIN_PASSWORD;
    if (!password) throw new Error("Missing bootstrap password");
    await db
      .insert(accounts)
      .values({
        username: adminUsername,
        name: "本地管理员",
        role: "super_admin",
        hash: await hashPassword(password),
      })
      .onConflictDoNothing();
  } else if (existing.role !== "super_admin" || !existing.active) {
    await db
      .update(accounts)
      .set({ role: "super_admin", active: true })
      .where(eq(accounts.id, existing.id));
  }

  for (const seeder of DEMO_SEEDERS) {
    await seeder();
  }
}
