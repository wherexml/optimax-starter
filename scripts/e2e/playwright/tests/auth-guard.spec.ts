import { expect, test } from "@playwright/test";
import { shot } from "../helpers";

test.describe("未认证守卫", () => {
  for (const path of ["/", "/assets", "/accounts", "/audit"]) {
    test(`访问 ${path} 重定向到登录页`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
      await shot(page, `guard-${path.replace(/\//g, "_")}-重定向登录`);
    });
  }
});
