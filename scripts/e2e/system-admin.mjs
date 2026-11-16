import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

export async function verifySystemAdmin(
  task,
  { evidenceDir, pageLabel = "p1", baseUrl = "http://127.0.0.1:38140", superPassword },
) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel);
  const checks = [];
  const screenshots = [];
  const createdUsernames = [];
  const result = { status: "RUNNING", baseUrl, checks, screenshots, createdUsernames };

  const check = (name, ok, detail) => {
    checks.push({ name, status: ok ? "PASS" : "FAIL", ...(detail !== undefined ? { detail } : {}) });
    assert.ok(ok, `${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`);
  };

  async function waitIdle(expectedTitle) {
    await page.waitForSelector("main h1", { timeout: 10000 });
    await page.waitForFunction(
      (title) =>
        (!title || document.querySelector("main h1")?.textContent?.trim() === title) &&
        !document.querySelector('.om-refresh-host[aria-busy="true"]'),
      expectedTitle ?? null,
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }

  async function shot(name) {
    const file = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path: file });
    screenshots.push({ name, path: file, url: await page.url() });
  }

  async function apiCall(method, path, body) {
    return page.evaluate(
      async ({ m, p, b }) => {
        const res = await fetch("/console" + p, {
          method: m,
          headers: m === "GET" ? {} : { "Content-Type": "application/json" },
          body: b === undefined ? undefined : JSON.stringify(b),
        });
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        return { status: res.status, json, text };
      },
      { m: method, p: path, b: body },
    );
  }

  async function switchUser(username, password) {
    await apiCall("POST", "/logout", {});
    await page.goto(`${baseUrl}/login`);
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    const loginRes = await apiCall("POST", "/login", { username, password });
    assert.equal(loginRes.status, 200, `login failed for ${username}`);
    await page.goto(`${baseUrl}/`);
    await waitIdle("工作台");
  }

  const suffix = Math.random().toString(16).slice(2, 8);
  const tempPw = `UiGov@${suffix}99!`;
  const admUser = `qa_ui_adm_${suffix}`;
  const memUser = `qa_ui_mem_${suffix}`;

  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await page.goto(`${baseUrl}/`);
    await waitIdle("工作台");
    if (await page.evaluate(() => !!document.querySelector(".workspace.compact"))) {
      await page.click('[aria-label="展开菜单"]');
    }

    // 1. Sidebar 2-level governance group & QuickNav
    const navInfo = await page.evaluate(() => {
      const groups = [...document.querySelectorAll("nav .nav-group-title")].map((e) =>
        e.textContent.trim(),
      );
      const sysGroup = [...document.querySelectorAll("nav .nav-group")].find(
        (g) => g.querySelector(".nav-group-title")?.textContent?.trim() === "系统管理",
      );
      const sysLinks = sysGroup
        ? [...sysGroup.querySelectorAll("a")].map((a) => ({
            text: a.textContent.trim(),
            href: a.getAttribute("href"),
          }))
        : [];
      const nestedGroups = document.querySelectorAll("nav .nav-group .nav-group").length;
      const roleBadge = document.querySelector(".who-text small")?.textContent?.trim();
      return { groups, sysLinks, nestedGroups, roleBadge };
    });
    check(
      "Super admin sidebar has 2-level 系统管理 group with 4 entries and zero nested groups",
      navInfo.groups.includes("系统管理") &&
        navInfo.nestedGroups === 0 &&
        navInfo.sysLinks.map((x) => x.text).join(",") ===
          "账户管理,系统权限,系统配置,操作日志" &&
        navInfo.roleBadge === "超级管理员",
      navInfo,
    );

    // Create temporary admin & member via session API for multi-role UI verification
    const cAdm = await apiCall("POST", "/accounts", {
      username: admUser,
      name: "界面验收管理员",
      password: tempPw,
      role: "admin",
    });
    check("Super admin creates temporary admin", cAdm.status === 201, cAdm.status);
    createdUsernames.push(admUser);

    const cMem = await apiCall("POST", "/accounts", {
      username: memUser,
      name: "界面验收成员",
      password: tempPw,
      role: "member",
    });
    check("Super admin creates temporary member", cMem.status === 201, cMem.status);
    createdUsernames.push(memUser);

    // 2. /permissions UI: super_admin lock, view/operate auto-linkage & save
    await page.click('nav a[href="/permissions"]');
    await waitIdle("系统权限");
    await page.waitForSelector('button[aria-label="超级管理员-系统权限-操作"]');

    const permInitial = await page.evaluate(() => {
      const saBtn = document.querySelector('button[aria-label="超级管理员-系统权限-操作"]');
      const bodyText = document.querySelector("main")?.innerText ?? "";
      return {
        saPressed: saBtn?.getAttribute("aria-pressed"),
        saDisabled: saBtn?.hasAttribute("disabled"),
        saTitle: saBtn?.getAttribute("title"),
        hasMiddleDot: bodyText.includes("\u00b7"),
      };
    });
    check(
      "PermissionsPage locks super_admin column with tooltip and uses zero middle dots",
      permInitial.saPressed === "true" &&
        permInitial.saDisabled === true &&
        Boolean(permInitial.saTitle) &&
        !permInitial.hasMiddleDot,
      permInitial,
    );

    // Click member assets operate -> both view and operate become pressed
    await page.click('button[aria-label="成员-资产台账-操作"]');
    const afterOperateOn = await page.evaluate(() => ({
      view: document.querySelector('button[aria-label="成员-资产台账-查看"]')?.getAttribute("aria-pressed"),
      op: document.querySelector('button[aria-label="成员-资产台账-操作"]')?.getAttribute("aria-pressed"),
    }));
    check(
      "Enabling 操作 keeps 查看 enabled",
      afterOperateOn.view === "true" && afterOperateOn.op === "true",
      afterOperateOn,
    );

    // Click member assets view OFF -> both view and operate automatically turn OFF
    await page.click('button[aria-label="成员-资产台账-查看"]');
    const afterViewOff = await page.evaluate(() => ({
      view: document.querySelector('button[aria-label="成员-资产台账-查看"]')?.getAttribute("aria-pressed"),
      op: document.querySelector('button[aria-label="成员-资产台账-操作"]')?.getAttribute("aria-pressed"),
    }));
    check(
      "Disabling 查看 automatically disables 操作",
      afterViewOff.view === "false" && afterViewOff.op === "false",
      afterViewOff,
    );

    // Also turn off 管理员-操作日志-查看 so we can verify dynamic menu hiding + redirect for admin
    await page.click('button[aria-label="管理员-操作日志-查看"]');
    await shot("desktop-permissions-matrix");
    await page.click('button:has-text("保存配置")');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="toast"]')].some((e) =>
        e.textContent?.includes("系统权限已保存"),
      ),
    );
    check("Saving permission matrix succeeds with bottom-right toast", true);

    // 3. /system UI: World Model top Tabs, health probes, AI circuit breaker & timezone settings
    await page.click('nav a[href^="/system"]');
    await waitIdle("系统配置");
    await page.waitForFunction(() => location.search === "?tab=status");
    await page.waitForSelector('section[aria-label="服务与数据库探针"]');

    const sysTabMetrics = await page.evaluate(() => {
      const selected = document.querySelector('[role="tab"][aria-selected="true"]');
      const st = selected ? getComputedStyle(selected) : null;
      const tabs = document.querySelector(".page-tabs-scroll")?.getBoundingClientRect();
      const panel = document.querySelector('[role="tabpanel"]')?.getBoundingClientRect();
      const bodyText = document.querySelector("main")?.innerText ?? "";
      return {
        tabLabel: selected?.textContent?.trim(),
        underline: st?.borderBottomWidth,
        radius: st?.borderRadius,
        gap: tabs && panel ? Math.round(panel.top - tabs.bottom) : null,
        hasDbOk: bodyText.includes("正常（") && bodyText.includes("ms）"),
        hasEditableBadge: bodyText.includes("可维护"),
        hasMiddleDot: bodyText.includes("\u00b7"),
      };
    });
    check(
      "SystemPage status tab uses World Model 2px underline, 12px panel gap, live DB probe, and zero middle dots",
      sysTabMetrics.tabLabel === "运行控制" &&
        sysTabMetrics.underline === "2px" &&
        sysTabMetrics.radius === "0px" &&
        Math.abs((sysTabMetrics.gap ?? 0) - 12) <= 2 &&
        sysTabMetrics.hasDbOk &&
        sysTabMetrics.hasEditableBadge &&
        !sysTabMetrics.hasMiddleDot,
      sysTabMetrics,
    );

    // Trip AI circuit breaker via ConfirmDialog
    await page.click('button:has-text("一键熔断 AI")');
    await page.waitForSelector('[data-slot="dialog-content"]');
    await page.click('[data-slot="dialog-content"] button:has-text("确认熔断")');
    await page.waitForFunction(() =>
      document
        .querySelector('section[aria-label="AI 客户端与熔断控制"]')
        ?.textContent?.includes("已熔断"),
    );
    await shot("desktop-system-circuit-open");
    check("One-click AI circuit breaker opens and updates status badge to 已熔断", true);

    // Restore AI circuit breaker
    await page.click('button:has-text("恢复 AI 服务")');
    await page.waitForSelector('[data-slot="dialog-content"]');
    await page.click('[data-slot="dialog-content"] button:has-text("确认恢复")');
    await page.waitForFunction(
      () =>
        !document
          .querySelector('section[aria-label="AI 客户端与熔断控制"]')
          ?.textContent?.includes("已熔断"),
    );
    check("Restoring AI service closes circuit breaker", true);

    // Switch to 基础配置 tab via keyboard ArrowRight
    await page.focus('[role="tab"][aria-selected="true"]');
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => location.search === "?tab=settings");
    await page.waitForSelector('section[aria-label="时间与区域设置"]');
    await page.click('button[aria-label="系统时区"]');
    await page.click('loc=role:option[name="协调世界时 UTC+00:00"]');
    await page.click('button:has-text("保存配置")');
    await page.waitForFunction(() =>
      document
        .querySelector('section[aria-label="时间与区域设置"]')
        ?.textContent?.includes("数据库持久化"),
    );
    await shot("desktop-system-settings");
    check("SystemPage settings tab saves timezone to database", true);

    // 4. Multi-role verification: log in as ordinary admin
    await switchUser(admUser, tempPw);
    const admNav = await page.evaluate(() => ({
      links: [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href")),
      roleBadge: document.querySelector(".who-text small")?.textContent?.trim(),
    }));
    check(
      "Ordinary admin hides /permissions and dynamically hides unchecked /audit",
      !admNav.links.includes("/permissions") &&
        !admNav.links.includes("/audit") &&
        admNav.links.includes("/accounts") &&
        admNav.roleBadge === "管理员",
      admNav,
    );

    // Direct navigation to unpermitted /audit redirects to first accessible path (/)
    await page.goto(`${baseUrl}/audit`);
    await waitIdle("工作台");
    check(
      "Direct visit to unpermitted /audit redirects to first accessible path /",
      new URL(await page.url()).pathname === "/",
    );

    // Ordinary admin on /system?tab=settings sees 只读 badge and disabled controls
    await page.goto(`${baseUrl}/system?tab=settings`);
    await waitIdle("系统配置");
    await page.waitForSelector('section[aria-label="时间与区域设置"]');
    const admReadonly = await page.evaluate(() => {
      const sec = document.querySelector('section[aria-label="时间与区域设置"]');
      const trigger = sec?.querySelector('button[aria-label="系统时区"]');
      return {
        hasReadonlyBadge: sec?.textContent?.includes("只读") && !sec?.textContent?.includes("可维护"),
        selectDisabled: trigger?.hasAttribute("disabled") || trigger?.getAttribute("data-disabled") !== null,
      };
    });
    check(
      "Ordinary admin sees 只读 badge and disabled timezone selector on /system?tab=settings",
      Boolean(admReadonly.hasReadonlyBadge && admReadonly.selectDisabled),
      admReadonly,
    );

    // Ordinary admin on /accounts sees 仅超管可维护 on super_admin row and locked role in CreateAccountDialog
    await page.goto(`${baseUrl}/accounts`);
    await waitIdle("账户管理");
    const admAccountsCheck = await page.evaluate(() =>
      document.querySelector("table")?.textContent?.includes("仅超管可维护"),
    );
    check("Ordinary admin sees 仅超管可维护 on super_admin account row", Boolean(admAccountsCheck));

    // 5. Log in as member whose assets:read was turned off -> /assets hidden & redirects to /
    await switchUser(memUser, tempPw);
    const memLinks = await page.evaluate(() =>
      [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href")),
    );
    check("Member without assets:read hides /assets and 系统管理", !memLinks.includes("/assets"), memLinks);
    await page.goto(`${baseUrl}/assets`);
    await waitIdle("工作台");
    check(
      "Member visiting unpermitted /assets redirects to /",
      new URL(await page.url()).pathname === "/",
    );

    // 6. Log back in as super_admin: two-click 恢复默认, restore Asia/Shanghai, verify /audit & 375px mobile
    await switchUser("demo@optimax.hk", superPassword);
    await page.goto(`${baseUrl}/permissions`);
    await waitIdle("系统权限");
    await page.click('button:has-text("恢复默认")');
    const armed = await page.evaluate(() =>
      [...document.querySelectorAll("header button")].some(
        (b) => b.textContent?.trim() === "确认恢复",
      ),
    );
    check("First click on 恢复默认 arms confirmation state", armed);
    await page.click('button:has-text("确认恢复")');
    await page.waitForFunction(
      () =>
        document
          .querySelector('button[aria-label="成员-资产台账-查看"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    check("Second click on 确认恢复 restores default role permissions", true);

    // Restore Asia/Shanghai timezone
    await page.goto(`${baseUrl}/system?tab=settings`);
    await waitIdle("系统配置");
    await page.waitForSelector('button[aria-label="系统时区"]');
    await page.click('button[aria-label="系统时区"]');
    await page.click('loc=role:option[name="北京时间 UTC+08:00"]');
    await page.click('button:has-text("保存配置")');
    await page.waitForFunction(() =>
      document
        .querySelector('section[aria-label="时间与区域设置"]')
        ?.textContent?.includes("北京时间 UTC+08:00"),
    );

    // Check /audit has 来源 column & governance action badges
    await page.goto(`${baseUrl}/audit`);
    await waitIdle("操作日志");
    const auditInfo = await page.evaluate(() => {
      const headers = [...document.querySelectorAll("table thead th")].map((th) =>
        th.textContent.trim(),
      );
      const text = document.querySelector("table tbody")?.textContent ?? "";
      return {
        headers,
        hasHumanBadge: text.includes("人工"),
        hasGovActions:
          text.includes("恢复默认权限") &&
          text.includes("切换 AI 熔断开关") &&
          text.includes("修改系统时区"),
      };
    });
    await shot("desktop-audit-sources");
    check(
      "AuditPage displays 来源 column, 人工 badge, and formatted governance audit entries",
      auditInfo.headers.includes("来源") &&
        auditInfo.hasHumanBadge &&
        auditInfo.hasGovActions,
      auditInfo,
    );

    // 7. Mobile 375x812 viewport check on /permissions and /system
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: true,
    });
    for (const [slug, url, title] of [
      ["mobile-permissions", "/permissions", "系统权限"],
      ["mobile-system-status", "/system?tab=status", "系统配置"],
    ]) {
      await page.goto(`${baseUrl}${url}`);
      await waitIdle(title);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      await shot(slug);
      check(`${slug}: zero horizontal page overflow at 375px`, !overflow);
    }

    result.status = "PASS";
    return result;
  } catch (err) {
    result.status = "FAIL";
    result.error = String(err?.stack || err);
    throw err;
  } finally {
    await page
      .cdp("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
      })
      .catch(() => undefined);
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
}
