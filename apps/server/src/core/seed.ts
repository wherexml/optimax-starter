import { eq } from "drizzle-orm";
import { accounts, assets } from "@optimax-starter/db/schema/console";
import { hashPassword } from "../password";
import { db } from "../services";
import {
  assertProductionSafety,
  getBootstrapAdminUsername,
  shouldSeedDemo,
} from "./config";

const DEMO_SYSTEMS = [
  "采购门户",
  "库存服务",
  "订单中心",
  "供应商门户",
  "合同服务",
  "仓储平台",
  "运输管理",
  "结算中心",
  "质量平台",
  "报表服务",
  "数据目录",
  "客户门户",
] as const;

export async function initializeConsole() {
  assertProductionSafety();
  if (!shouldSeedDemo()) return;

  const adminUsername = getBootstrapAdminUsername();
  const [existing] = await db
    .select({ id: accounts.id })
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
        role: "admin",
        hash: await hashPassword(password),
      })
      .onConflictDoNothing();
  }

  await db
    .insert(assets)
    .values(
      DEMO_SYSTEMS.map((name, i) => ({
        name,
        domain: ["采购", "履约", "运营"][i % 3]!,
        owner: ["业务运营组", "交付组", "平台组"][i % 3]!,
        stage: i % 4 === 1 ? "待复核" : "已登记",
      })),
    )
    .onConflictDoNothing();
}
