import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyNotifications(
  task,
  { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' },
) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel);
  const checks = [];
  const screenshots = [];
  const result = { status: 'RUNNING', baseUrl, checks, screenshots };
  let createdAccount = null;

  const check = (name, ok, detail) => {
    checks.push({ name, status: ok ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
    assert.ok(ok, `${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  };

  async function capture(name) {
    const path = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path });
    screenshots.push({ name, path, url: await page.url() });
  }

  async function waitFrames() {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }

  async function waitToastSettled() {
    await waitFrames();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="toast"]')].every((el) =>
        el.getAnimations().every((a) => a.playState === 'finished'),
      ),
    );
  }

  try {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 2,
      mobile: false,
    });

    await page.goto(`${baseUrl}/accounts`);
    await page.waitForSelector('main h1');
    await page.waitForFunction(
      () =>
        document.querySelector('main h1')?.textContent === '账户管理' &&
        !document.querySelector('.om-refresh-host[aria-busy="true"]') &&
        [...document.querySelectorAll('.page')].every((el) =>
          el.getAnimations().every((a) => a.playState === 'finished'),
        ),
    );
    await waitFrames();

    const baselineLayout = await page.evaluate(() => {
      const header = document.querySelector('main h1').closest('header').getBoundingClientRect();
      const first = document.querySelector('main h1').closest('header').nextElementSibling.getBoundingClientRect();
      return {
        headerBottom: Math.round(header.bottom),
        firstTop: Math.round(first.top),
        gap: Math.round(first.top - header.bottom),
      };
    });

    const suffix = Math.random().toString(16).slice(2, 9);
    const tempUser = `qa_ntf_${suffix}`;
    const tempName = `通知验收_${suffix.slice(0, 4)}`;

    await page.click('button:has-text("新增账户")');
    await page.waitForSelector('#create-account');
    await page.fill('#create-account input[placeholder="例如：张敏"]', tempName);
    await page.fill('#create-account input[placeholder="登录标识，创建后不可修改"]', tempUser);
    await page.click('#create-account [aria-label="随机生成初始密码"]');
    await page.click('button:has-text("创建账户")');

    await page.waitForFunction(
      (name) =>
        !document.querySelector('#create-account') &&
        [...document.querySelectorAll('[data-slot="toast"]')].some((el) =>
          el.textContent?.includes(`已创建账户 ${name}`),
        ),
      tempName,
    );
    await waitToastSettled();

    createdAccount = await page.evaluate(async (u) => {
      const list = await (await fetch('/console/accounts')).json();
      return list.find((r) => r.username === u) ?? null;
    }, tempUser);

    const toastMetrics = await page.evaluate(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      const toastEl = region?.querySelector('[data-slot="toast"]');
      const icon = toastEl?.querySelector('.om-toast-icon');
      const header = document.querySelector('main h1').closest('header').getBoundingClientRect();
      const first = document.querySelector('main h1').closest('header').nextElementSibling.getBoundingClientRect();
      const rr = region.getBoundingClientRect();
      const tr = toastEl.getBoundingClientRect();
      const ts = getComputedStyle(toastEl);
      const is = icon ? getComputedStyle(icon) : null;
      return {
        regionRightGap: Math.round(innerWidth - rr.right),
        regionBottomGap: Math.round(innerHeight - rr.bottom),
        toastWidth: Math.round(tr.width),
        toastRadius: ts.borderRadius,
        borderTopWidth: ts.borderTopWidth,
        borderLeftWidth: ts.borderLeftWidth,
        iconColor: is?.color ?? null,
        isTopLayer: region.matches(':popover-open'),
        agentHidden: region.hasAttribute('data-agent-hidden'),
        firstTopAfter: Math.round(first.top),
        gapAfter: Math.round(first.top - header.bottom),
      };
    });
    result.toastMetrics = toastMetrics;

    check(
      'Global notification renders at bottom-right (24px inset) in top layer without shifting page table',
      toastMetrics.regionRightGap === 24 &&
        toastMetrics.regionBottomGap === 24 &&
        toastMetrics.toastWidth >= 280 &&
        toastMetrics.toastWidth <= 368 &&
        toastMetrics.isTopLayer &&
        toastMetrics.agentHidden &&
        toastMetrics.firstTopAfter === baselineLayout.firstTop &&
        toastMetrics.gapAfter === 12,
      toastMetrics,
    );

    check(
      'Notification uses 10px radius, uniform 0.5px border (no left stripe), and Radix Blue brand icon',
      toastMetrics.toastRadius === '10px' &&
        parseFloat(toastMetrics.borderTopWidth) <= 1 &&
        toastMetrics.borderTopWidth === toastMetrics.borderLeftWidth &&
        toastMetrics.iconColor === 'rgb(62, 99, 221)',
      toastMetrics,
    );

    await capture('desktop-account-created-bottom-right');

    await page.click('nav a[href="/assets"]');
    await page.waitForSelector('main h1');
    await page.waitForFunction(
      () => document.querySelector('main h1')?.textContent === '资产台账',
    );
    check(
      'Bottom-right notification persists globally across route navigation (/accounts -> /assets)',
      await page.evaluate(
        (name) =>
          [...document.querySelectorAll('[data-slot="toast"]')].some((el) =>
            el.textContent?.includes(`已创建账户 ${name}`),
          ),
        tempName,
      ),
    );

    await page.click('nav a[href="/accounts"]');
    await page.waitForFunction(
      () =>
        document.querySelector('main h1')?.textContent === '账户管理' &&
        !document.querySelector('.om-refresh-host[aria-busy="true"]'),
    );
    await page.click(`[aria-label="编辑 ${tempName}"]`);
    await page.waitForSelector('#edit-account');
    await waitFrames();
    await page.click('#edit-account [aria-label="复制账户名"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="toast"]')].some((el) =>
        el.textContent?.includes('已复制到剪贴板'),
      ),
    );
    await waitToastSettled();
    await capture('desktop-toast-over-modal');

    await page.keyboard.press('F6');
    const focusedOverModal = await page.evaluate(
      () => !!document.activeElement?.matches('[data-slot="toast"]'),
    );
    check(
      'F6 focuses bottom-right toast even while Radix modal Dialog is open',
      focusedOverModal,
    );

    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[data-slot="toast"]')].some((el) =>
          el.textContent?.includes('已复制到剪贴板'),
        ),
    );
    check(
      'Pressing Escape on focused toast dismisses only that toast and keeps EditAccountDialog open',
      await page.evaluate(() => !!document.querySelector('#edit-account')),
    );

    await page.click('[data-slot="dialog-content"] button:has-text("取消")');
    await page.waitForFunction(() => !document.querySelector('#edit-account'));

    await page.goto(`${baseUrl}/demo/forms`);
    await page.waitForSelector('[aria-label="全局通知速查"]');
    await page.waitForFunction(() => !document.querySelector('.om-refresh-host[aria-busy="true"]'));
    await page.click('button:has-text("清空通知")');
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'));

    await page.click('button:has-text("异步进度")');
    await page.waitForSelector('[data-slot="toast"][data-type="loading"]');
    check(
      'Promise notification starts in loading state',
      await page.evaluate(() =>
        document
          .querySelector('[data-slot="toast"][data-type="loading"]')
          ?.textContent?.includes('正在拉取网关资产快照'),
      ),
    );
    await page.waitForSelector('[data-slot="toast"][data-type="success"]');
    check(
      'Promise notification transitions in place to success with description',
      await page.evaluate(() => {
        const el = document.querySelector('[data-slot="toast"][data-type="success"]');
        return (
          el?.textContent?.includes('巡检快照已生成') &&
          el?.textContent?.includes('共核验 12 条台账记录')
        );
      }),
    );

    await page.click('button:has-text("清空通知")');
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'));

    await page.click('button:has-text("带撤销操作")');
    await page.waitForSelector('[data-slot="toast-action"]');
    await waitToastSettled();
    await page.click('[data-slot="toast-action"]');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="toast"]')].some((el) =>
        el.textContent?.includes('已恢复接入策略'),
      ),
    );
    check('Toast action button triggers callback and emits follow-up confirmation', true);

    await page.click('button:has-text("清空通知")');
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'));

    await page.click('button:has-text("连发堆叠")');
    await page.click('button:has-text("异常告警")');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-slot="toast"]').length === 4,
    );
    await waitToastSettled();

    const collapsedStack = await page.evaluate(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      const items = [...region.querySelectorAll('[data-slot="toast"]')];
      const frontRect = items[0].getBoundingClientRect();
      const secondRect = items[1].getBoundingClientRect();
      return {
        count: items.length,
        expanded: region.hasAttribute('data-expanded'),
        regionHeight: Math.round(region.getBoundingClientRect().height),
        frontHeight: Math.round(frontRect.height),
        peekAboveFront: Math.round(frontRect.top - secondRect.top),
        behindInert: items.slice(1).every((el) => el.inert),
      };
    });
    check(
      'Multiple notifications collapse into 3D peek stack with inert background items',
      collapsedStack.count === 4 &&
        !collapsedStack.expanded &&
        Math.abs(collapsedStack.regionHeight - collapsedStack.frontHeight) <= 2 &&
        collapsedStack.peekAboveFront >= 6 &&
        collapsedStack.behindInert,
      collapsedStack,
    );
    await capture('desktop-stack-collapsed');

    await page.hover('[data-slot="toast"][data-front]', {
      label: 'hover bottom-right toast stack',
    });
    await page.waitForSelector('[data-slot="toast-region"][data-expanded]');
    await waitToastSettled();

    const expandedStack = await page.evaluate(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      const items = [...region.querySelectorAll('[data-slot="toast"]')];
      return {
        expanded: region.hasAttribute('data-expanded'),
        regionHeight: Math.round(region.getBoundingClientRect().height),
        behindActive: items.every((el) => !el.inert),
        types: items.map((el) => el.getAttribute('data-type')),
      };
    });
    check(
      'Hovering bottom-right stack expands all 4 notifications vertically and unlocks interaction',
      expandedStack.expanded &&
        expandedStack.regionHeight > collapsedStack.frontHeight * 2.5 &&
        expandedStack.behindActive,
      expandedStack,
    );
    await capture('desktop-stack-expanded');

    await page.mouse.move(200, 200, { label: 'leave toast stack' });
    await page.click('button:has-text("清空通知")');
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'));

    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await waitFrames();
    await page.click('button:has-text("风险警告")');
    await page.waitForSelector('[data-slot="toast"][data-type="warning"]');
    await waitToastSettled();

    const mobileToast = await page.evaluate(() => {
      const region = document.querySelector('[data-slot="toast-region"]');
      const rect = region.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        rightGap: Math.round(innerWidth - rect.right),
        bottomGap: Math.round(innerHeight - rect.bottom),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    check(
      'Mobile 375px notification fits cleanly at bottom with 16px margins and no horizontal overflow',
      mobileToast.left === 16 &&
        mobileToast.rightGap === 16 &&
        mobileToast.bottomGap >= 14 &&
        mobileToast.bottomGap <= 24 &&
        !mobileToast.pageOverflow,
      mobileToast,
    );
    await capture('mobile-bottom-toast');

    await page.click('[data-slot="toast"] [aria-label="关闭通知"]');
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]'));
    check('Mobile close button dismisses bottom toast cleanly', true);

    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = String(error?.stack || error);
    throw error;
  } finally {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }

  return { ...result, createdAccountId: createdAccount?.id ?? null };
}
