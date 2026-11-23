import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

export async function verifyFilterState(
  task,
  { evidenceDir, pageLabel = "p1", baseUrl = "http://127.0.0.1:38140", withModel = false },
) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel),
    originalUrl = await page.url(),
    checks = [];
  const id = await page.evaluate(async () => (await (await fetch("/console/me")).json()).id);
  const keys = [
    `optimax-starter.filters.v1:${id}:assets`,
    `optimax-starter.filter-drafts.v1:${id}:assets`,
  ];
  const backup = await page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    keys,
  );
  function check(name, value) {
    checks.push({ name, status: value ? "PASS" : "FAIL" });
  }
  async function state() {
    return page.evaluate(() => ({
      url: location.href,
      rows: [...document.querySelectorAll(".filter-row")].map((row) => ({
        field: row.querySelector('[aria-label="筛选字段"]')?.textContent.trim(),
        value: row.querySelector("input")?.value,
        operator: row.querySelector('[aria-label$="匹配方式"]')?.textContent.trim(),
        select: row.querySelector(".filter-value:not(input)")?.getAttribute("aria-label"),
      })),
      table: document.querySelector("tbody")?.innerText,
    }));
  }
  async function ready() {
    await page.waitForSelector('[aria-label="刷新资产"]');
    await page.waitForFunction(
      () =>
        !document.querySelector('.om-refresh-host[aria-busy="true"]') &&
        !!document.querySelector("tbody"),
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  const result = { status: "RUNNING", checks, baseUrl, originalUrl };
  try {
    await page.goto(`${baseUrl}/assets`);
    await ready();
    if (await page.evaluate(() => !!document.querySelector(".filter-bar .filter-row")))
      await page.click('text="清空"');
    await page.click('[aria-label="添加筛选项"]');
    await page.click('[aria-label="筛选条件 1"] [aria-label="筛选字段"]');
    await page.click('loc=role:option[name="资产名称"]');
    await page.click('[aria-label="添加筛选项"]');
    await page.click('[aria-label="筛选条件 2"] [aria-label="筛选字段"]');
    await page.click('loc=role:option[name="登记状态"]');
    const empty = await state();
    await page.reload();
    await ready();
    check(
      "empty filter rows and order survive reload",
      JSON.stringify((await state()).rows) === JSON.stringify(empty.rows),
    );
    if ((await state()).rows.length !== 2) {
      await page.click('[aria-label="添加筛选项"]');
      await page.click('[aria-label="筛选条件 1"] [aria-label="筛选字段"]');
      await page.click('loc=role:option[name="资产名称"]');
      await page.click('[aria-label="添加筛选项"]');
      await page.click('[aria-label="筛选条件 2"] [aria-label="筛选字段"]');
      await page.click('loc=role:option[name="登记状态"]');
    }
    await page.fill('[aria-label="搜索资产"]', "服务");
    check(
      "manual filter is a search input ignored by 1Password",
      await page.evaluate(() => {
        const input = document.querySelector('[aria-label="搜索资产"]');
        return (
          input.type === "search" &&
          input.autocomplete === "off" &&
          input.hasAttribute("data-1p-ignore") &&
          Boolean(input.name)
        );
      }),
    );
    check(
      "natural-language input is ignored by 1Password",
      await page.evaluate(() => {
        const input = document.querySelector('[aria-label="自然语言筛选"]');
        return (
          !input ||
          (input.type === "search" &&
            input.autocomplete === "off" &&
            input.hasAttribute("data-1p-ignore"))
        );
      }),
    );
    const draft = await state();
    await page.screenshot({ path: `${evidenceDir}/draft-before.png` });
    await page.reload();
    await ready();
    const restored = await state();
    result.draft = { before: draft, after: restored };
    check(
      "unapplied text and row order survive reload",
      JSON.stringify(restored.rows) === JSON.stringify(draft.rows),
    );
    check(
      "restored draft does not change applied filters or rows",
      restored.url === draft.url && restored.table === draft.table,
    );
    await page.screenshot({ path: `${evidenceDir}/draft-after.png` });
    if (!checks.every((row) => row.status === "PASS"))
      throw new Error("Filter state regression reproduced");

    if (await page.evaluate(() => !!document.querySelector('[aria-label="自然语言筛选"]'))) {
      await page.fill('[aria-label="自然语言筛选"]', "只看待复核");
      await page.click('[aria-label="执行筛选"]');
      await page.waitForSelector('[data-asset-agent-status="error"]');
      check(
        "Agent still refuses a restored unapplied draft",
        await page.evaluate(
          () =>
            document.querySelector("[data-asset-agent-status]").textContent.includes("先应用") &&
            !location.search,
        ),
      );
    }
    await page.click('[aria-label="登记状态：请选择"]');
    await page.click('.multi-select-option:has-text("待复核")');
    await page.keyboard.press("Escape");
    const selectedDraft = await state();
    await page.reload();
    await ready();
    check(
      "unapplied multi-select survives reload without changing results",
      JSON.stringify((await state()).rows) === JSON.stringify(selectedDraft.rows) &&
        (await state()).url === selectedDraft.url,
    );

    await page.click('[aria-label="资产名称匹配方式"]');
    await page.click('loc=role:option[name="等于"]');
    await page.click('[aria-label="移除筛选 资产名称"]');
    await page.click('[aria-label="添加筛选项"]');
    await page.click('[aria-label="筛选条件 2"] [aria-label="筛选字段"]');
    await page.click('loc=role:option[name="资产名称"]');
    await page.fill('[aria-label="搜索资产"]', "库存服务");
    await page.click('[aria-label="资产名称匹配方式"]');
    await page.click('loc=role:option[name="等于"]');
    const ordered = await state();
    await page.reload();
    await ready();
    check(
      "changed field order and equals draft survive reload",
      JSON.stringify((await state()).rows) === JSON.stringify(ordered.rows),
    );
    await page.click('.filter-bar [aria-label="搜索"]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "库存服务");
    const applied = await state();
    await page.click('[aria-label="刷新资产"]');
    await ready();
    check(
      "manual data refresh preserves filter state",
      JSON.stringify((await state()).rows) === JSON.stringify(applied.rows),
    );
    await page.goto(`${baseUrl}/assets`);
    await ready();
    check(
      "bare assets URL restores applied keyword and operator",
      await page.evaluate(
        () =>
          new URL(location.href).searchParams.get("q") === "库存服务" &&
          new URL(location.href).searchParams.get("qOp") === "equals",
      ),
    );
    await page.goto(`${baseUrl}/assets?stage=${encodeURIComponent("待复核")}`);
    await ready();
    check(
      "explicit new URL wins over previous filters and draft",
      await page.evaluate(
        () =>
          !new URL(location.href).searchParams.has("q") &&
          new URL(location.href).searchParams.get("stage") === "待复核" &&
          !document.querySelector('[aria-label="搜索资产"]'),
      ),
    );
    await page.click('text="清空"');
    await page.reload();
    await ready();
    check(
      "clear remains cleared after reload",
      (await state()).rows.length === 0 && !new URL(await page.url()).search,
    );
    if (
      withModel &&
      (await page.evaluate(() => !!document.querySelector('[aria-label="自然语言筛选"]')))
    ) {
      await page.evaluate(() => {
        window.__filterModelTrace = { fetch: window.fetch, calls: [] };
        window.fetch = async (...args) => {
          const response = await window.__filterModelTrace.fetch.apply(window, args);
          if (String(args[0]).includes("/console/assets/agent/"))
            window.__filterModelTrace.calls.push({
              path: String(args[0]),
              status: response.status,
              response: await response.clone().json(),
            });
          return response;
        };
      });
      await page.fill('[aria-label="自然语言筛选"]', "只看履约中待复核的资产");
      await page.click('[aria-label="执行筛选"]');
      await page.waitForFunction(
        () =>
          ["success", "error"].includes(
            document
              .querySelector("[data-asset-agent-status]")
              ?.getAttribute("data-asset-agent-status"),
          ),
        undefined,
        { timeout: 120000 },
      );
      result.model = await page.evaluate(() => ({
        status: document
          .querySelector("[data-asset-agent-status]")
          .getAttribute("data-asset-agent-status"),
        calls: window.__filterModelTrace.calls,
      }));
      check(
        "real Magpie filter and browser receipt still succeed",
        result.model.status === "success" &&
          result.model.calls.some((call) => call.response.model === "minimax/MiniMax-M3") &&
          result.model.calls.some((call) => call.response.acknowledged === true),
      );
      const modelState = await state();
      await page.reload();
      await ready();
      check(
        "real model filters survive reload unchanged",
        JSON.stringify(await state()) === JSON.stringify(modelState),
      );
      await page.screenshot({ path: `${evidenceDir}/model-after-reload.png` });
      await page.click('text="清空"');
      await page.reload();
      await ready();
    }
    await page.evaluate((key) => localStorage.setItem(key, "{broken JSON"), keys[1]);
    await page.reload();
    await ready();
    check(
      "corrupt draft cache falls back without breaking assets",
      (await state()).rows.length === 0 && (await state()).table.includes("采购门户"),
    );
    await page.goto(`${baseUrl}/login`);
    await page.waitForSelector('input[type="password"]');
    check(
      "login still supports password-manager autofill",
      await page.evaluate(
        () =>
          document.querySelector('input[type="password"]').autocomplete === "current-password" &&
          !document.querySelector('input[type="password"]').hasAttribute("data-1p-ignore"),
      ),
    );
    result.status = checks.every((row) => row.status === "PASS") ? "PASS" : "FAIL";
    assert.equal(result.status, "PASS");
  } catch (error) {
    result.status = "FAIL";
    result.error = String(error.stack ?? error);
    throw error;
  } finally {
    await page
      .evaluate((backup) => {
        for (const [key, value] of Object.entries(backup)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, backup)
      .catch(() => undefined);
    await page.goto(originalUrl);
    await ready();
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
