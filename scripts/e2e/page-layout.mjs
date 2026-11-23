import { mkdir, writeFile } from "node:fs/promises";

export async function verifyPageLayout(
  task,
  { evidenceDir, pageLabel = "p1", baseUrl = "http://127.0.0.1:38140" },
) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel),
    checks = [],
    pages = [];
  const result = { status: "RUNNING", checks, pages };
  const routes = [
    ["dashboard", "/", "工作台"],
    ["assets", "/assets", "资产台账"],
    ["accounts", "/accounts", "账户管理"],
    ["audit", "/audit", "操作日志"],
    ["settings", "/settings", "个人设置"],
    ["tabs", "/demo/navigation?tab=pending", "资产视图"],
  ];
  const check = (name, ok) => checks.push({ name, status: ok ? "PASS" : "FAIL" });
  try {
    for (const mobile of [false, true]) {
      const width = mobile ? 375 : 1440;
      await page.cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height: mobile ? 812 : 960,
        deviceScaleFactor: 1,
        mobile,
      });
      for (const [name, path, title] of routes.filter(
        ([name]) => !mobile || ["assets", "settings", "tabs"].includes(name),
      )) {
        await page.goto(`${baseUrl}${path}`);
        await page.waitForSelector("main h1");
        await page.waitForFunction(
          (title) =>
            document.querySelector("main h1")?.textContent === title &&
            !document.querySelector('.om-refresh-host[aria-busy="true"]'),
          title,
        );
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".page")].every((e) =>
            e.getAnimations().every((a) => a.playState === "finished"),
          ),
        );
        if (!mobile && (await page.evaluate(() => !!document.querySelector(".workspace.compact"))))
          await page.click('[aria-label="展开菜单"]');
        await page.waitForFunction(
          (mobile) =>
            mobile
              ? document.querySelector("aside").inert &&
                document.querySelector("aside").getBoundingClientRect().right <= 0
              : document
                  .querySelector("aside")
                  .getAnimations()
                  .every((a) => a.playState === "finished"),
          mobile,
        );
        const metrics = await page.evaluate(() => {
          const h1 = document.querySelector("main h1"),
            header = h1.closest("header");
          const rect = (e) => {
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right };
          };
          let next = header.nextElementSibling;
          while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
          const content = getComputedStyle(document.querySelector(".content")),
            aside = getComputedStyle(document.querySelector("aside"));
          return {
            header: rect(header),
            title: rect(h1),
            first: rect(next),
            contentPadding: content.paddingTop,
            sidebar: { width: aside.width, background: aside.backgroundColor, color: aside.color },
            primary: getComputedStyle(document.documentElement)
              .getPropertyValue("--primary")
              .trim(),
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            tabs: rect(document.querySelector(".page-tabs-scroll")),
            panel: rect(document.querySelector('[role="tabpanel"]')),
            agentMargin: document.querySelector(".asset-agent")
              ? getComputedStyle(document.querySelector(".asset-agent")).marginBottom
              : null,
          };
        });
        const label = `${mobile ? "mobile" : "desktop"}-${name}`;
        check(
          `${label}: compact page top and title row`,
          Math.abs(metrics.header.top - (mobile ? 12 : 16)) < 1 &&
            Math.abs(metrics.header.height - (mobile ? 44 : 40)) < 1,
        );
        check(
          `${label}: 12px title-to-content gap and no page overflow`,
          metrics.first &&
            Math.abs(metrics.first.top - metrics.header.bottom - 12) < 1 &&
            !metrics.pageOverflow,
        );
        if (!mobile)
          check(
            `${label}: original light sidebar and global brand`,
            metrics.sidebar.width === "208px" &&
              metrics.sidebar.background === "rgb(249, 249, 248)" &&
              metrics.sidebar.color === "rgb(33, 32, 28)" &&
              metrics.primary === "#3e63dd",
          );
        if (name === "tabs")
          check(
            `${label}: compact tab-to-table gap`,
            metrics.panel &&
              Math.abs(metrics.panel.top - metrics.tabs.bottom - 12) < 1 &&
              metrics.panel.top <= 125,
          );
        if (name === "assets")
          check(
            `${label}: compact composer-to-table gap`,
            metrics.agentMargin === null || metrics.agentMargin === "12px",
          );
        const screenshot = `${evidenceDir}/${label}.png`;
        await page.screenshot({ path: screenshot });
        pages.push({ name: label, url: await page.url(), screenshot, metrics });
      }
    }
    result.status = checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL";
  } catch (error) {
    result.status = "FAIL";
    result.error = String(error);
  } finally {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.goto(`${baseUrl}/demo/navigation?tab=pending`);
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
