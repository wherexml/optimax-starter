import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 演示管理员凭证只从本地 .env 读取，绝不写入源码或证据文件。 */
export function readEnvCredentials(): { username: string; password: string } {
  const env = readFileSync(path.join(repoRoot, ".env"), "utf8");
  const pick = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  return {
    username: pick("STARTER_ADMIN_USERNAME") || "demo@optimax.hk",
    password: pick("STARTER_ADMIN_PASSWORD") || "",
  };
}

const runStamp = process.env.E2E_RUN ?? new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
export const evidenceDir = path.join(repoRoot, "evidence", "playwright", `run-${runStamp}`);
mkdirSync(evidenceDir, { recursive: true });

let counter = 0;
const manifest: Array<{ step: number; name: string; url: string; file: string }> = [];

/** 每个关键动作后调用：整页截图 + 追加 manifest（防幻觉的可复现证据链）。 */
export async function shot(page: Page, name: string) {
  counter += 1;
  const file = path.join(evidenceDir, `${String(counter).padStart(3, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  manifest.push({ step: counter, name, url: page.url(), file: path.relative(repoRoot, file) });
  writeFileSync(path.join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export function evidencePath() {
  return path.relative(repoRoot, evidenceDir);
}

/** 与既有 E2E 相同的稳态判定：标题就位 + 刷新宿主空闲 + 双 rAF。 */
export async function waitIdle(page: Page, title?: string) {
  if (title) {
    await page.waitForSelector(`main h1:has-text("${title}")`, { timeout: 20_000 });
  } else {
    await page.waitForSelector("main h1", { timeout: 20_000 });
  }
  await page.waitForFunction(() => !document.querySelector('.om-refresh-host[aria-busy="true"]'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function expectToast(page: Page) {
  await page.waitForSelector('[data-slot="toast"]', { timeout: 10_000 });
}

/** 在当前打开的 dialog 内点击匹配 /确认|保存|删除/ 的主按钮。 */
export async function confirmDialog(page: Page, pattern = /^(确认|删除)/) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await dialog.getByRole("button", { name: pattern }).first().click();
}

export async function loginViaUI(page: Page) {
  const { username, password } = readEnvCredentials();
  await page.goto("/login");
  await page.getByPlaceholder("输入账户名").fill(username);
  await page.getByPlaceholder("输入密码").fill(password);
  await shot(page, "login-填写完成");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await waitIdle(page, "工作台");
}
