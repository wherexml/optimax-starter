import { defineConfig } from "@playwright/test";

// OptiMax Starter 浏览器 E2E（Playwright）。
// 目标栈：本地 Docker compose 的 web（默认 http://127.0.0.1:38140）。
// 证据：逐步截图 + manifest 落 evidence/playwright/run-*（evidence/ 不入库）。
// 单次运行的所有 worker 共享同一个证据目录（通过环境变量传递时间戳）。
process.env.E2E_RUN ??= new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../../evidence/playwright/report", open: "never" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:38140",
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    screenshot: "off",
    trace: "retain-on-failure",
  },
  outputDir: "../../../evidence/playwright-artifacts",
});
