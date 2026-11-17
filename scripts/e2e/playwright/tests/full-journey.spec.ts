import { expect, test } from "@playwright/test";
import { confirmDialog, expectToast, loginViaUI, shot, waitIdle } from "../helpers";

// 全流程串行旅程：登录 → 工作台 → 资产 CRUD+筛选 → 账户全操作 → 权限矩阵 →
// 系统配置 → 操作日志 → 个人设置 → 登出。每步截图留证。
// 明确不覆盖：AI 自然语言筛选（环境默认关闭）、/demo/* 页面（VITE_ENABLE_DEMOS 演示页）、
// 个人设置里的修改密码（避免中途变更演示管理员密码破坏后续流程）。

test.describe.configure({ mode: "serial" });

const navTo = async (page: import("@playwright/test").Page, name: string, title?: string) => {
  await page.locator('nav[aria-label="主导航"]').getByRole("link", { name }).click();
  await waitIdle(page, title);
};

test("全功能全流程旅程", async ({ page }) => {
  const assetName = `PW自动化资产-${Date.now().toString(36)}`;
  const accountUsername = `pw_auto_${Date.now().toString(36)}`;
  const accountPassword = "AutoTest#2026pw";

  await test.step("登录", async () => {
    await loginViaUI(page);
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
    await shot(page, "01-工作台");
  });

  await test.step("工作台统计卡", async () => {
    await expect(page.getByText("最近操作").first()).toBeVisible();
    await expect(page.getByText("待复核资产").first()).toBeVisible();
  });

  await test.step("资产：新增", async () => {
    await navTo(page, "资产台账", "资产台账");
    await shot(page, "02-资产列表");
    await page.getByRole("button", { name: "新增资产" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    const form = dialog.locator("#asset-form");
    await form.locator('input[name="name"]').fill(assetName);
    await form.locator('input[name="domain"]').fill("自动化测试域");
    await form.locator('input[name="owner"]').fill("自动化团队");
    await form.getByRole("combobox").click();
    await page.getByRole("option", { name: "待复核" }).click();
    await shot(page, "03-资产表单已填写");
    await dialog.getByRole("button", { name: "保存资产" }).click();
    await expectToast(page);
    await shot(page, "04-资产新增成功toast");
  });

  await test.step("资产：动态筛选定位新资产", async () => {
    await page.getByRole("button", { name: "添加筛选" }).click();
    // 新增条件行默认选中「关键词」字段，直接填值即可。
    await shot(page, "05-筛选条件行");
    await page.locator('input[type="search"][name^="filter-"]').first().fill(assetName);
    await page.getByRole("button", { name: "应用筛选" }).click();
    await waitIdle(page, "资产台账");
    await expect(page.getByRole("row").filter({ hasText: assetName })).toBeVisible();
    await shot(page, "06-筛选定位到新资产");
  });

  await test.step("资产：编辑", async () => {
    const row = page.getByRole("row").filter({ hasText: assetName });
    await row.getByRole("button", { name: "编辑资产" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator("#asset-form").locator('input[name="owner"]').fill("自动化团队B");
    await shot(page, "07-资产编辑表单");
    await dialog.getByRole("button", { name: /^保存(修改|资产)$/ }).click();
    await expectToast(page);
    await waitIdle(page, "资产台账");
    await expect(page.getByRole("row").filter({ hasText: "自动化团队B" })).toBeVisible();
    await shot(page, "08-资产编辑成功");
  });

  await test.step("资产：删除与清空筛选", async () => {
    const row = page.getByRole("row").filter({ hasText: assetName });
    await row.getByRole("button", { name: "删除资产" }).click();
    await confirmDialog(page, /^(确认|删除)/);
    await expectToast(page);
    await waitIdle(page, "资产台账");
    await expect(page.getByRole("row").filter({ hasText: assetName })).toHaveCount(0);
    await shot(page, "09-资产已删除");
    await page.getByRole("button", { name: "清空筛选" }).click();
    await waitIdle(page, "资产台账");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await shot(page, "10-筛选已清空");
  });

  await test.step("账户：新增成员", async () => {
    await navTo(page, "账户管理", "账户管理");
    await shot(page, "10-账户列表");
    await page.getByRole("button", { name: "新增账户" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('input[name="username"]').fill(accountUsername);
    await dialog.locator('input[name="name"]').fill("自动化账户");
    await dialog.locator('input[name="password"]').fill(accountPassword);
    await shot(page, "11-账户表单已填写");
    await dialog.getByRole("button", { name: "创建账户" }).click();
    await expectToast(page);
    await shot(page, "12-账户创建成功toast");
    await page.getByRole("button", { name: "添加筛选" }).click();
    await page.locator('input[type="search"][name^="filter-"]').first().fill(accountUsername);
    await page.getByRole("button", { name: "应用筛选" }).click();
    await waitIdle(page, "账户管理");
    await expect(page.getByRole("row").filter({ hasText: accountUsername })).toBeVisible();
    await shot(page, "12b-筛选定位新账户");
  });

  await test.step("账户：编辑与角色调整", async () => {
    const row = page.getByRole("row").filter({ hasText: accountUsername });
    await row.getByRole("button", { name: /编辑/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('input[name="name"]').fill("自动化账户改");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "管理员", exact: true }).click();
    await shot(page, "13-账户角色调整");
    await dialog.getByRole("button", { name: /保存/ }).click();
    await confirmDialog(page, /^确认更改角色$/);
    await expectToast(page);
    await waitIdle(page, "账户管理");
    await shot(page, "14-账户角色已调整");
  });

  await test.step("账户：重置密码", async () => {
    const row = page.getByRole("row").filter({ hasText: accountUsername });
    await row.getByRole("button", { name: "重置" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('input[name="password"]').fill("Reset#2026pw!");
    await dialog.locator('input[name="confirm"]').fill("Reset#2026pw!");
    await dialog.getByRole("button", { name: "重置密码" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
    await expectToast(page);
    await shot(page, "15-重置密码完成");
  });

  await test.step("账户：停用再启用", async () => {
    const row = page.getByRole("row").filter({ hasText: accountUsername });
    await row.getByRole("button", { name: "停用" }).click();
    await confirmDialog(page, /^停用账户$/);
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "已停用" })).toBeVisible({ timeout: 10_000 });
    await waitIdle(page, "账户管理");
    await expect(page.getByRole("row").filter({ hasText: accountUsername }).getByText("已停用")).toBeVisible();
    await shot(page, "16-账户已停用");
    const rowAfter = page.getByRole("row").filter({ hasText: accountUsername });
    await rowAfter.getByRole("button", { name: "启用" }).click();
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "已启用" })).toBeVisible({ timeout: 10_000 });
    await waitIdle(page, "账户管理");
    await shot(page, "17-账户已启用");
  });

  await test.step("账户：强制下线（无会话时按钮禁用，验证状态即可）与清空筛选", async () => {
    const row = page.getByRole("row").filter({ hasText: accountUsername });
    // 新建账户无活动会话，下线按钮为禁用态——断言其存在即验证了权限入口。
    await expect(row.getByRole("button", { name: "下线" })).toBeAttached();
    await shot(page, "18-强制下线入口");
    await page.getByRole("button", { name: "清空筛选" }).click();
    await waitIdle(page, "账户管理");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await shot(page, "18b-账户筛选已清空");
  });

  await test.step("权限矩阵：修改与恢复默认", async () => {
    await navTo(page, "系统权限", "系统权限");
    await shot(page, "19-权限矩阵");
    // 幂等：仅在当前为关闭时切换并保存，重复执行不会来回翻转。
    const toggle = page.getByRole("button", { name: "成员-资产台账-操作" });
    if ((await toggle.getAttribute("aria-pressed")) !== "true") {
      await toggle.click();
      await shot(page, "20-权限开关已切换");
      await page.getByRole("button", { name: "保存配置" }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "系统权限已保存" })).toBeVisible({ timeout: 10_000 });
      await waitIdle(page, "系统权限");
    }
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await shot(page, "21-权限已生效");
    await page.getByRole("button", { name: "恢复默认" }).click();
    await page.getByRole("button", { name: "确认恢复" }).click();
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "已恢复默认系统权限" })).toBeVisible({ timeout: 10_000 });
    await waitIdle(page, "系统权限");
    await expect(page.getByRole("button", { name: "成员-资产台账-操作" })).toHaveAttribute("aria-pressed", "false");
    await shot(page, "22-权限恢复默认");
  });

  await test.step("系统配置：时区保存与还原", async () => {
    await navTo(page, "系统配置");
    await waitIdle(page);
    await shot(page, "23-系统配置-运行控制");
    await page.getByRole("tab", { name: "基础配置" }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "东京时间 UTC+09:00" }).click();
    await shot(page, "24-时区已选择东京");
    await page.getByRole("button", { name: "保存配置" }).click();
    await expectToast(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "北京时间 UTC+08:00" }).click();
    await page.getByRole("button", { name: "保存配置" }).click();
    await expectToast(page);
    await shot(page, "25-时区已还原北京");
    await page.getByRole("tab", { name: "运行控制" }).click();
    await expect(page.getByText("熔断").first()).toBeVisible();
    await shot(page, "26-运行控制探针与熔断状态");
  });

  await test.step("操作日志：列表与筛选", async () => {
    await navTo(page, "操作日志", "操作日志");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await shot(page, "27-操作日志列表");
    await page.getByRole("button", { name: "添加筛选" }).click();
    await page.getByRole("combobox", { name: "筛选字段" }).first().click();
    await shot(page, "28-日志筛选字段选项已展开");
    await page.keyboard.press("Escape");
  });

  await test.step("个人设置：资料保存", async () => {
    // 个人设置不在主导航，经用户菜单或直接路由进入，这里直连路由并验证页面。
    await page.goto("/settings");
    await waitIdle(page, "个人设置");
    await shot(page, "29-个人设置");
    const company = page.locator('input[name="company"]');
    // 唯一值保证表单 dirty 判定为真（重复运行不会因值未变而禁用保存）。
    await company.fill(`E2E 验证团队 ${Date.now().toString(36)}`);
    await page.getByRole("button", { name: /保存/ }).first().click();
    await expectToast(page);
    await shot(page, "30-个人资料已保存");
  });

  await test.step("登出", async () => {
    await page.getByRole("button", { name: "用户菜单" }).click();
    await page.getByRole("button", { name: "退出登录" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    await shot(page, "31-退出确认弹窗");
    await dialog.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await shot(page, "32-已登出回到登录页");
  });
});
