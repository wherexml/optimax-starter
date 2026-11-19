import { expect, test } from "@playwright/test";
import { loginViaUI, shot, waitIdle } from "../helpers";

test.describe("导航与布局", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
  });

  test("侧栏折叠与展开", async ({ page }) => {
    const aside = page.locator('aside[aria-label="侧边栏"]');
    await shot(page, "nav-侧栏展开");
    const collapse = aside.getByRole("button", { name: /折叠/ });
    await collapse.click();
    await page.waitForTimeout(300);
    await shot(page, "nav-侧栏折叠");
    const expand = page.getByRole("button", { name: /展开/ });
    await expand.click();
    await page.waitForTimeout(300);
    await expect(aside.getByRole("link", { name: "资产台账" })).toBeVisible();
    await shot(page, "nav-侧栏重新展开");
  });

  test("快速导航 Cmd/Ctrl+K：打开、过滤、跳转、Esc 关闭", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+K");
    const search = page.locator('input[aria-label="搜索页面"]');
    await expect(search).toBeVisible();
    await shot(page, "nav-快速导航已打开");
    await search.fill("资产");
    await shot(page, "nav-快速导航过滤资产");
    await page.keyboard.press("Enter");
    await waitIdle(page, "资产台账");
    await shot(page, "nav-快速导航跳转资产页");
    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.press("Escape");
    await expect(page.locator('input[aria-label="搜索页面"]')).toBeHidden();
    await shot(page, "nav-Esc关闭快速导航");
  });

  test("移动端 375px 抽屉导航", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await waitIdle(page, "工作台");
    const menu = page.getByRole("button", { name: "打开菜单" });
    await expect(menu).toBeVisible();
    await shot(page, "nav-移动端默认");
    await menu.click();
    await expect(page.locator('nav[aria-label="主导航"]')).toBeVisible();
    await shot(page, "nav-移动端抽屉已打开");
    await page.locator('nav[aria-label="主导航"]').getByRole("link", { name: "资产台账" }).click();
    await waitIdle(page, "资产台账");
    await shot(page, "nav-移动端抽屉跳转");
  });
});
