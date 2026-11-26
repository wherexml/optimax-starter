#!/usr/bin/env node
// Headless Chromium smoke gate for CI and local stack verification.
// Expects a running console stack at BASE_URL (default http://127.0.0.1:38140).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:38140";
const USERNAME = process.env.STARTER_ADMIN_USERNAME || "demo@optimax.hk";
const PASSWORD = process.env.STARTER_ADMIN_PASSWORD || "demo@2026!";
const REPORT_PATH = process.env.WEB_SMOKE_REPORT || "";

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(
      `[${label}] 检测到横向溢出: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
    );
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err));
  });

  const checks = [];
  const record = (name, detail = "") => {
    checks.push({ name, status: "PASS", detail });
  };

  try {
    // 1. Login on /login
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.fill('input[autocomplete="username"]', USERNAME);
    await page.fill('input[autocomplete="current-password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForSelector("#console-sidebar", { timeout: 15_000 });
    await assertNoOverflow(page, "desktop-home");
    record("login-and-desktop-layout");

    // 2. QuickNav (Cmd/Ctrl+K) with @ui-sdk/react/command
    await page.keyboard.press("ControlOrMeta+k");
    await page.waitForSelector('.quick-nav [data-slot="command"]', { timeout: 5_000 });
    const navInput = page.locator(".quick-nav input");
    await navInput.fill("系统配置");
    await page.locator('.quick-nav-item:has-text("系统配置")').first().click();
    await page.waitForURL((url) => url.pathname === "/system", { timeout: 10_000 });
    record("quick-nav-command-navigation");

    // 3. System Settings unified Apply bar + UI SDK agent bridge snapshot
    await page.goto(`${BASE_URL}/system?tab=settings`, { waitUntil: "networkidle" });
    const applyBtn = page.locator('button:has-text("应用")');
    await applyBtn.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await applyBtn.isDisabled())) {
      throw new Error("系统设置初始无变更时顶栏「应用」按钮应处于禁用状态");
    }
    const ttlInput = page.locator('input[aria-label="会话时长（小时）"]');
    if ((await ttlInput.count()) > 0) {
      const initial = await ttlInput.inputValue();
      await ttlInput.fill(String(Number(initial || 168) + 1));
      if (await applyBtn.isDisabled()) {
        throw new Error("修改会话时长后「应用」按钮应激活");
      }
      await ttlInput.fill(initial);
      if (!(await applyBtn.isDisabled())) {
        throw new Error("恢复会话时长后「应用」按钮应重新禁用");
      }
    }
    const agentSnapshot = await page.evaluate(() => {
      const bridge = window.__starterUiAgent;
      if (!bridge || typeof bridge.snapshot !== "function") return null;
      return bridge.snapshot();
    });
    if (!Array.isArray(agentSnapshot) || agentSnapshot.length === 0) {
      throw new Error("未检测到 window.__starterUiAgent.snapshot() 返回有效组件列表");
    }
    await assertNoOverflow(page, "desktop-system-settings");
    record("system-settings-and-ui-sdk-bridge", `snapshotCount=${agentSnapshot.length}`);

    // 4. QuickNav entity lookup when assets module is present
    const hasAssets = (await page.locator('a[href="/assets"]').count()) > 0;
    if (hasAssets) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForSelector('.quick-nav [data-slot="command"]', { timeout: 5_000 });
      await page.locator(".quick-nav input").fill("AS-1000");
      const assetItem = page.locator('.quick-nav-item:has-text("AS-1000")').first();
      await assetItem.waitFor({ state: "visible", timeout: 8_000 });
      await assetItem.click();
      await page.waitForURL((url) => url.pathname === "/assets/1000", { timeout: 10_000 });
      await assertNoOverflow(page, "desktop-asset-detail");
      record("quick-nav-entity-search-AS-1000");
    }

    // 5. Assistant Drawer + TriggerMenu `/` and `@` when assistant trigger exists
    const assistantBtn = page.locator(".nav-assistant");
    if ((await assistantBtn.count()) > 0) {
      await assistantBtn.click();
      const drawer = page.locator("#starter-assistant-panel");
      await drawer.waitFor({ state: "visible", timeout: 10_000 });
      await drawer
        .locator('textarea[aria-label="输入问题"], .pi-unavailable')
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
      await assertNoOverflow(page, "desktop-assistant-open");

      const composer = drawer.locator('textarea[aria-label="输入问题"]');
      if ((await composer.count()) > 0) {
        await composer.fill("/");
        await page.locator(".pi-trigger-popup").waitFor({ state: "visible", timeout: 5_000 });
        if (hasAssets) {
          await composer.fill("@AS-1000");
          await page
            .locator('.pi-trigger-item:has-text("AS-1000")')
            .first()
            .waitFor({ state: "visible", timeout: 8_000 });
        }
        record("assistant-trigger-menu");
      } else {
        record("assistant-drawer-unavailable-ok");
      }
      await page.locator('#starter-assistant-panel button[aria-label="关闭智能助理"]').click();
    }

    // 6. Mobile 375x812 check
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/system?tab=settings`, { waitUntil: "networkidle" });
    await assertNoOverflow(page, "mobile-system-settings");
    record("mobile-zero-overflow");

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        `控制台存在报错: console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`,
      );
    }

    const report = { status: "PASS", baseUrl: BASE_URL, checks };
    if (REPORT_PATH) {
      mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    }
    console.log(`PASS: web-smoke (${checks.length} checks) at ${BASE_URL}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(`FAIL: web-smoke -> ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
