import { expect, test } from "@playwright/test";
import { expectToast, readEnvCredentials, shot, waitIdle } from "../helpers";

test.describe("登录页", () => {
  test("品牌与表单结构", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByPlaceholder("输入账户名")).toBeVisible();
    await expect(page.getByPlaceholder("输入密码")).toBeVisible();
    await expect(page.getByRole("button", { name: /^登录$/ })).toBeVisible();
    await shot(page, "login-品牌与表单");
  });

  test("空提交触发契约校验文案", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await expect(page.getByText("请输入账户名")).toBeVisible();
    await expect(page.getByText("请输入密码")).toBeVisible();
    await shot(page, "login-空提交校验");
  });

  test("错误密码被拒绝且停留在登录页", async ({ page }) => {
    const { username } = readEnvCredentials();
    await page.goto("/login");
    await page.getByPlaceholder("输入账户名").fill(username);
    await page.getByPlaceholder("输入密码").fill("wrong-password-000");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await expect(page.getByText("账户或密码错误")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, "login-错误密码行内错误");
  });

  test("正确凭证登录进入工作台", async ({ page }) => {
    const { username, password } = readEnvCredentials();
    await page.goto("/login");
    await page.getByPlaceholder("输入账户名").fill(username);
    await page.getByPlaceholder("输入密码").fill(password);
    await page.getByRole("button", { name: /^登录$/ }).click();
    await waitIdle(page, "工作台");
    await expect(page).toHaveURL(/\/$/);
    await shot(page, "login-登录成功工作台");
  });
});
