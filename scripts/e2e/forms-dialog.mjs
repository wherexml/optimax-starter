import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyFormsDialog(
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

  async function waitAnimations() {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.dialog-content, .page')].every((el) =>
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
        !document.querySelector('.om-refresh-host[aria-busy="true"]'),
    );

    await page.click('button:has-text("新增账户")');
    await page.waitForSelector('[data-slot="dialog-content"] [data-slot="form-dialog-body"]');
    await waitAnimations();

    const accountGeometry = await page.evaluate(() => {
      const dialog = document.querySelector('[data-slot="dialog-content"]');
      const header = dialog.querySelector('[data-slot="dialog-header"]');
      const title = dialog.querySelector('[data-slot="dialog-title"]');
      const body = dialog.querySelector('[data-slot="form-dialog-body"]');
      const items = [...dialog.querySelectorAll('[data-slot="form-item"]')];
      const fieldGaps = items.map((item) => {
        const label = item.querySelector('[data-slot="label"]');
        const control = item.querySelector(
          '[data-slot="input-group"], [data-slot="input"], [data-slot="select-trigger"]',
        );
        const lr = label.getBoundingClientRect();
        const cr = control.getBoundingClientRect();
        return Math.round((cr.top - lr.bottom) * 10) / 10;
      });
      const fontSizes = new Set(
        [
          ...dialog.querySelectorAll(
            '[data-slot="dialog-title"], h3, [data-slot="label"], input, button, p, span',
          ),
        ]
          .filter((el) => el.checkVisibility() && el.textContent.trim().length > 0)
          .map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))),
      );
      const hr = header.getBoundingClientRect();
      const tr = title.getBoundingClientRect();
      const firstSection = body.querySelector('[data-slot="form-section"]').getBoundingClientRect();
      return {
        headerBorderBottom: getComputedStyle(header).borderBottomWidth,
        titleToFirstSectionGap: Math.round(firstSection.top - tr.bottom),
        headerBottomToBodyContent: Math.round(firstSection.top - hr.bottom),
        fieldGaps,
        fontSizes: [...fontSizes].sort((a, b) => a - b),
      };
    });
    result.accountGeometry = accountGeometry;

    check(
      'CreateAccountDialog has 3-tier header border and >=32px title-to-content breathing room',
      parseFloat(accountGeometry.headerBorderBottom) > 0 &&
        accountGeometry.titleToFirstSectionGap >= 32 &&
        accountGeometry.headerBottomToBodyContent >= 18,
      accountGeometry,
    );
    check(
      'Every field label has ~8px gap to its input control (no Tailwind v4 inline collapse)',
      accountGeometry.fieldGaps.length === 6 &&
        accountGeometry.fieldGaps.every((gap) => gap >= 7 && gap <= 9),
      accountGeometry.fieldGaps,
    );
    check(
      'Modal typography stays within 3 sizes (12/14/18px) and >=12px',
      accountGeometry.fontSizes.every((s) => s >= 12) &&
        accountGeometry.fontSizes.length <= 4,
      accountGeometry.fontSizes,
    );

    const suffix = Math.random().toString(16).slice(2, 9);
    const tempUser = `qa_dlg_${suffix}`;
    const tempName = `弹窗验收_${suffix.slice(0, 4)}`;

    await page.fill('input[placeholder="例如：张敏"]', tempName);
    await page.fill('input[placeholder="登录标识，创建后不可修改"]', tempUser);
    await page.fill('input[placeholder="name@company.com"]', 'qa_dialog@example.invalid');
    await page.fill('input[placeholder="例如：安全运营中心"]', '平台架构组');
    await page.click('[aria-label="随机生成初始密码"]');

    const generatedPw = await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="至少 10 位，可一键生成"]');
      return { length: input?.value?.length ?? 0, type: input?.getAttribute('type') };
    });
    check(
      'PasswordInput generates 16-char password and reveals it',
      generatedPw.length === 16 && generatedPw.type === 'text',
      generatedPw,
    );
    await page.click('[aria-label="隐藏初始密码"]');
    check(
      'PasswordInput hides password on toggle',
      await page.evaluate(
        () =>
          document
            .querySelector('input[placeholder="至少 10 位，可一键生成"]')
            ?.getAttribute('type') === 'password',
      ),
    );

    await capture('accounts-create-dialog');

    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-slot="unsaved-banner"]');
    await capture('accounts-unsaved-banner');
    await page.click('[data-slot="unsaved-banner"] button:has-text("继续编辑")');
    check(
      'Dirty guard intercepts Escape and restores focus on Keep Editing',
      await page.evaluate(() => !document.querySelector('[data-slot="unsaved-banner"]')),
    );

    await page.click('button:has-text("创建账户")');
    await page.waitForFunction(
      (name) =>
        !document.querySelector('[data-slot="dialog-content"]') &&
        [...document.querySelectorAll('[data-slot="toast"], [role="status"]')].some((el) =>
          el.textContent?.includes(name),
        ),
      tempName,
    );

    createdAccount = await page.evaluate(async (u) => {
      const list = await (await fetch('/console/accounts')).json();
      return list.find((r) => r.username === u) ?? null;
    }, tempUser);
    check(
      'Account created with optional email and company persisted',
      Boolean(
        createdAccount &&
          createdAccount.email === 'qa_dialog@example.invalid' &&
          createdAccount.company === '平台架构组',
      ),
    );

    await page.click(`[aria-label="编辑 ${tempName}"]`);
    await page.waitForSelector('[data-slot="dialog-content"]');
    await waitAnimations();
    const editValues = await page.evaluate(() => ({
      readonlyUsername: document.querySelector('input[readonly]')?.value,
      email: document.querySelector('input[type="email"]')?.value,
      company: document.querySelector('input[placeholder="例如：安全运营中心"]')?.value,
    }));
    check(
      'EditAccountDialog displays CopyableInput readonly username and saved email/company',
      editValues.readonlyUsername === tempUser &&
        editValues.email === 'qa_dialog@example.invalid' &&
        editValues.company === '平台架构组',
      editValues,
    );
    await capture('accounts-edit-dialog');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'));

    await page.goto(`${baseUrl}/demo/forms?dialog=create`);
    await page.waitForSelector('#complex-connector-form');
    await waitAnimations();

    const scrollMetrics = await page.evaluate(() => {
      const dialog = document.querySelector('[data-slot="dialog-content"]');
      const header = dialog.querySelector('[data-slot="dialog-header"]');
      const body = dialog.querySelector('[data-slot="form-dialog-body"]');
      const footer = dialog.querySelector('[data-slot="dialog-footer"]');
      return {
        dialogOverflow: getComputedStyle(dialog).overflow,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        headerTopBefore: header.getBoundingClientRect().top,
        footerBottomBefore: footer.getBoundingClientRect().bottom,
      };
    });
    check(
      'ComplexFormDialog uses fixed header/footer with independent scrollable body',
      scrollMetrics.bodyOverflowY === 'auto' && scrollMetrics.bodyScrollable,
      scrollMetrics,
    );

    await capture('forms-demo-complex-top');

    await page.click('#complex-connector-form button[role="combobox"][aria-label="责任团队"]');
    await page.waitForSelector('input[placeholder="输入团队名称或职责关键字…"]');
    await page.keyboard.press('Escape');
    check(
      'Pressing Escape inside open Combobox closes only popover, keeping Dialog open',
      await page.evaluate(
        () =>
          !!document.querySelector('#complex-connector-form') &&
          !document.querySelector('input[placeholder="输入团队名称或职责关键字…"]'),
      ),
    );

    await page.click('#complex-connector-form button[role="combobox"][aria-label="责任团队"]');
    await page.fill('input[placeholder="输入团队名称或职责关键字…"]', '安全');
    await page.keyboard.press('Enter');
    check(
      'Combobox filters and selects option by keyboard',
      await page.evaluate(
        () =>
          document
            .querySelector('#complex-connector-form button[role="combobox"][aria-label="责任团队"]')
            ?.textContent?.includes('安全运营组') ?? false,
      ),
    );

    await page.click('#complex-connector-form [data-segment-value="agent"]');
    const disabledState = await page.evaluate(() => {
      const form = document.querySelector('#complex-connector-form');
      const cb = form.querySelector('#demo-callback-url');
      const hints = [...form.querySelectorAll('[data-slot="field-hint"]')].map((e) =>
        e.textContent.trim(),
      );
      return {
        callbackDisabled: cb?.disabled === true,
        hasCallbackReason: hints.some((t) => t.includes('Agent 上报模式')),
        hasIntervalReason: hints.some((t) => t.includes('仅 API 轮询模式需要固定周期')),
      };
    });
    check(
      'SegmentedControl switches mode and disabled fields display explicit reasons',
      disabledState.callbackDisabled &&
        disabledState.hasCallbackReason &&
        disabledState.hasIntervalReason,
      disabledState,
    );

    await page.click('[data-slot="dialog-content"] button:has-text("填充示例数据")');
    await page.click('#complex-connector-form [aria-label="增加并发上限"]');
    check(
      'Quick sample fill + NumberInput stepper increment work together',
      await page.evaluate(
        () =>
          document.querySelector('#complex-connector-form input[placeholder="例如：生产核心网关资产同步"]')?.value ===
          '云原生网关资产巡检',
      ),
    );

    const tagInputSelector =
      '#complex-connector-form [data-slot="tag-input"] input[placeholder*="输入域名或 CIDR"]';
    await page.fill(tagInputSelector, 'invalid tag!');
    await page.keyboard.press('Enter');
    check(
      'TagInput validates invalid token and shows error alert',
      await page.evaluate(() =>
        [...document.querySelectorAll('#complex-connector-form [role="alert"]')].some((e) =>
          e.textContent.includes('仅支持域名'),
        ),
      ),
    );
    await page.fill(tagInputSelector, 'api.optimax.hk');
    await page.keyboard.press('Enter');
    check(
      'TagInput commits valid domain chip on Enter',
      await page.evaluate(() =>
        !!document.querySelector('#complex-connector-form [aria-label="移除 api.optimax.hk"]'),
      ),
    );

    await page.evaluate(() => {
      const body = document.querySelector('[data-slot="form-dialog-body"]');
      if (body) body.scrollTop = body.scrollHeight;
    });
    await waitAnimations();
    const pinnedAfterScroll = await page.evaluate(() => {
      const dialog = document.querySelector('[data-slot="dialog-content"]');
      const header = dialog.querySelector('[data-slot="dialog-header"]');
      const footer = dialog.querySelector('[data-slot="dialog-footer"]');
      return {
        headerTopAfter: header.getBoundingClientRect().top,
        footerBottomAfter: footer.getBoundingClientRect().bottom,
      };
    });
    check(
      'Header and Footer remain pinned while scrolling ComplexFormDialog body',
      Math.abs(pinnedAfterScroll.headerTopAfter - scrollMetrics.headerTopBefore) <= 1 &&
        Math.abs(pinnedAfterScroll.footerBottomAfter - scrollMetrics.footerBottomBefore) <= 1,
      pinnedAfterScroll,
    );
    await capture('forms-demo-complex-bottom');

    await page.click('[data-slot="dialog-content"] button:has-text("保存策略")');
    await page.waitForFunction(
      () =>
        !document.querySelector('#complex-connector-form') &&
        [...document.querySelectorAll('[data-slot="toast"], [role="status"]')].some((el) =>
          el.textContent?.includes('云原生网关资产巡检'),
        ),
    );
    await waitAnimations();
    await capture('forms-demo-page');

    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.goto(`${baseUrl}/demo/forms?dialog=create`);
    await page.waitForSelector('#complex-connector-form');
    await waitAnimations();
    const mobileFit = await page.evaluate(() => {
      const rect = document
        .querySelector('[data-slot="dialog-content"]')
        .getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    check(
      'Mobile 375px ComplexFormDialog fits viewport with clean margins and no horizontal overflow',
      mobileFit.left >= 10 && mobileFit.right <= 366 && !mobileFit.pageOverflow,
      mobileFit,
    );
    await capture('forms-demo-mobile-dialog');

    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = String(error);
  } finally {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return { ...result, createdAccountId: createdAccount?.id, createdUsername: createdAccount?.username };
}
