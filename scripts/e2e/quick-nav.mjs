import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyQuickNav(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  const page = task.page(pageLabel);
  const result = { status: 'RUNNING', checks: [], pages: [] };
  await mkdir(evidenceDir, { recursive: true });
  const check = (name, ok) => {
    result.checks.push({ name, status: ok ? 'PASS' : 'FAIL' });
    if (!ok) throw new Error(name);
  };
  const open = async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForSelector('.quick-nav');
    await page.waitForFunction(() => document.querySelector('.quick-nav').getAnimations().every(a => a.playState === 'finished'));
  };
  const closed = () => page.waitForSelector('.quick-nav', { state: 'detached' });
  const layout = async name => {
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('.quick-nav').getBoundingClientRect();
      const list = document.querySelector('.quick-nav-list');
      const items = [...list.querySelectorAll('[role="option"]')].map(e => e.getBoundingClientRect());
      const input = document.querySelector('.quick-nav-input input').getBoundingClientRect();
      const close = document.querySelector('.quick-nav > button').getBoundingClientRect();
      return {
        rows: items.every((r, i) => r.height >= 44 && Math.abs(r.width - list.clientWidth) < 2 && (!i || r.top >= items[i - 1].bottom)),
        contained: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight,
        inputClear: input.right <= close.left,
        noHorizontalOverflow: list.scrollWidth <= list.clientWidth,
        focus: document.activeElement === document.querySelector('.quick-nav input'),
      };
    });
    check(`${name}: full-width rows, clear input, viewport bounds and input focus`, Object.values(metrics).every(Boolean));
    const screenshot = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path: screenshot });
    result.pages.push({ name, url: await page.url(), screenshot, metrics });
  };
  try {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/assets`);
    await page.waitForSelector('button[aria-label="搜索页面"]');
    if (await page.evaluate(() => !!document.querySelector('.workspace.compact'))) await page.click('[aria-label="展开菜单"]');
    await page.click('button[aria-label="搜索页面"]');
    await page.waitForSelector('.quick-nav');
    await page.waitForFunction(() => document.querySelector('.quick-nav').getAnimations().every(a => a.playState === 'finished'));
    await layout('desktop');
    await page.keyboard.press('Escape');
    await closed();
    await page.waitForFunction(() => document.activeElement?.matches('button[aria-label="搜索页面"]'));
    check('Escape returns focus to sidebar search', await page.evaluate(() => document.activeElement?.matches('button[aria-label="搜索页面"]')));
    await open();
    await page.keyboard.press('ArrowUp');
    check('ArrowUp wraps to last result', await page.evaluate(() => document.querySelector('.quick-nav-item:last-child').getAttribute('aria-selected') === 'true'));
    await page.keyboard.press('ArrowDown');
    check('ArrowDown wraps to first result', await page.evaluate(() => document.querySelector('.quick-nav-item').getAttribute('aria-selected') === 'true'));
    await page.fill('.quick-nav input', 'settings');
    check('English alias filters results', await page.evaluate(() => document.querySelectorAll('.quick-nav-item').length === 1 && document.querySelector('.quick-nav-item').textContent.includes('个人设置')));
    await page.keyboard.press('Enter');
    await page.waitForURL(`${baseUrl}/settings`);
    await closed();
    check('Enter navigates to filtered page', true);
    await open();
    await page.fill('.quick-nav input', '没有这个页面');
    check('Empty result state', await page.evaluate(() => !document.querySelector('.quick-nav-item') && document.querySelector('.quick-nav-list').textContent.includes('未找到匹配页面')));
    await page.keyboard.press('Enter');
    check('Enter on empty results does not navigate', await page.url() === `${baseUrl}/settings`);
    await page.fill('.quick-nav input', '资产台账');
    await page.click('.quick-nav-item');
    await page.waitForURL(`${baseUrl}/assets`);
    await closed();
    check('Chinese filter and pointer navigation', true);
    await page.click('[aria-label="折叠菜单"]');
    await page.click('button[aria-label="搜索页面"]');
    await page.waitForSelector('.quick-nav');
    check('Collapsed sidebar opens search', await page.evaluate(() => !!document.querySelector('.workspace.compact') && document.activeElement?.matches('.quick-nav input')));
    await page.keyboard.press('Escape');
    await closed();
    await page.click('[aria-label="展开菜单"]');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await page.click('[aria-label="打开菜单"]');
    await page.click('button[aria-label="搜索页面"]');
    await page.waitForSelector('.quick-nav');
    await page.waitForFunction(() => document.querySelector('.quick-nav').getAnimations().every(a => a.playState === 'finished'));
    await layout('mobile');
    await page.keyboard.press('Escape');
    await closed();
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 400, deviceScaleFactor: 1, mobile: true });
    await open();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => {
      const selected = document.querySelector('.quick-nav-item[aria-selected="true"]').getBoundingClientRect();
      const list = document.querySelector('.quick-nav-list').getBoundingClientRect();
      return selected.top >= list.top && selected.bottom <= list.bottom + 1;
    });
    check('Short viewport scrolls keyboard selection into view', await page.evaluate(() => document.querySelector('.quick-nav-list').scrollTop > 0));
    await layout('short-viewport');
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = String(error);
  } finally {
    if (await page.evaluate(() => !!document.querySelector('.quick-nav'))) await page.keyboard.press('Escape');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/assets`);
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
