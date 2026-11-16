import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyNavigationDemo(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [], screenshots = [];
  const result = { status: 'RUNNING', baseUrl, checks, screenshots };
  const check = (name, ok) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL' }); assert.ok(ok, name); };
  async function ready(tab) {
    await page.waitForSelector('[aria-label="资产视图"]');
    await page.waitForFunction(tab => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === tab && !!document.querySelector('[role="tabpanel"] tbody tr[data-row-id]') && document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby') === document.querySelector('[role="tab"][aria-selected="true"]')?.id, tab);
    await page.waitForFunction(() => !document.querySelector('.om-refresh-host[aria-busy="true"]'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function capture(name) {
    const path = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path }); screenshots.push({ name, path, url: await page.url() });
  }
  try {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/demo/navigation?tab=all`);
    await page.waitForSelector('[aria-label="资产视图"]', { timeout: 5000 });
    await ready('全部资产');
    check('Demo route is available with real asset rows', true);
    if (await page.evaluate(() => !!document.querySelector('.workspace.compact'))) await page.click('[aria-label="展开菜单"]');
    const hierarchy = await page.evaluate(() => {
      const leaf = document.querySelector('nav a[href^="/demo/navigation"]');
      return { current: leaf?.getAttribute('aria-current'), groups: [...document.querySelectorAll('nav .nav-group-title')].map(e => e.textContent.trim()), depth: leaf ? [...leaf.closest('nav').querySelectorAll('.nav-group')].filter(d => d.contains(leaf)).length + 1 : 0, nested: document.querySelectorAll('nav details details, nav .nav-group .nav-group').length };
    });
    check('Demo sidebar has two levels, no third level, and current page', hierarchy.depth === 2 && hierarchy.groups.join('/') === 'Demo' && hierarchy.nested === 0 && hierarchy.current === 'page');
    const assets = await page.evaluate(async () => (await (await fetch('/console/assets')).json()));
    async function rowsMatch(stage) {
      const names = await page.evaluate(() => [...document.querySelectorAll('[role="tabpanel"] tbody tr[data-row-id] td:nth-child(2)')].map(e => e.textContent.trim()));
      return names.join('|') === assets.filter(r => !stage || r.stage === stage).slice(0, 8).map(r => r.name).join('|');
    }
    check('all panel uses local API data', await rowsMatch());
    const history = await page.evaluate(() => window.history.length);
    await page.click('loc=role:tab[name="已登记"]'); await ready('已登记');
    check('registered tab updates URL and rows', (await page.url()).endsWith('?tab=registered') && await rowsMatch('已登记'));
    await page.click('loc=role:tab[name="待复核"]'); await ready('待复核');
    check('pending tab updates URL and rows', (await page.url()).endsWith('?tab=pending') && await rowsMatch('待复核'));
    await page.reload(); await ready('待复核');
    check('deep link survives reload', await rowsMatch('待复核'));
    await page.focus('loc=role:tab[name="待复核"]');
    await page.keyboard.press('Home'); await ready('全部资产');
    await page.keyboard.press('ArrowRight'); await ready('已登记');
    await page.keyboard.press('End'); await ready('待复核');
    await page.keyboard.press('ArrowLeft'); await ready('已登记');
    check('arrow keys and Home End control tabs', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.textContent === '已登记'));
    await page.keyboard.press('Tab');
    check('Tab moves into active panel', await page.evaluate(() => !!document.activeElement?.closest('[role="tabpanel"]')));
    check('tab switches replace history', await page.evaluate(() => window.history.length) === history);
    await page.goto(`${baseUrl}/demo/navigation?tab=invalid`); await ready('全部资产');
    await page.waitForFunction(() => location.search === '?tab=all');
    check('invalid tab normalizes to default', true);
    await page.goto(`${baseUrl}/demo/navigation`); await ready('全部资产');
    await page.waitForFunction(() => location.search === '?tab=all');
    check('missing tab normalizes to default', true);
    const agent = await page.evaluate(async () => {
      const { navigationDemoAgent } = await import('/src/features/navigation-demo/agent-bridge.ts');
      const entries = navigationDemoAgent.snapshot().filter(e => !e.offPage && e.component !== 'more');
      const entry = entries.find(e => e.component === 'tabs');
      const item = entry?.items?.find(item => item.label === '待复核');
      if (!entry || !item) return { entries, ok: false };
      const action = await navigationDemoAgent.act({ steps: [{ ref: entry.ref, action: 'setValue', args: [item.label] }] });
      return { entries, ok: action.ok, error: action.error };
    });
    result.agent = agent;
    check('Agent can discover named tabs and their choices', agent.entries.length > 0 && agent.entries.every(e => !!e.label));
    await ready('待复核');
    check('Agent changes actual URL and rows', agent.ok && (await page.url()).endsWith('?tab=pending') && await rowsMatch('待复核'));
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].every(tab => tab.getAnimations().every(animation => animation.playState === 'finished')));
    const styles = await page.evaluate(() => {
      const selected = getComputedStyle(document.querySelector('[role="tab"][aria-selected="true"]'));
      const idle = getComputedStyle(document.querySelector('[role="tab"][aria-selected="false"]'));
      const aside = getComputedStyle(document.querySelector('aside'));
      const link = getComputedStyle(document.querySelector('nav a[aria-current="page"]'));
      return { selected: { background: selected.backgroundColor, radius: selected.borderRadius, underline: selected.borderBottomWidth, color: selected.borderBottomColor }, idle: { background: idle.backgroundColor, underline: idle.borderBottomColor }, aside: { background: aside.backgroundColor, color: aside.color, width: aside.width }, link: { background: link.backgroundColor, color: link.color } };
    });
    result.styles = styles;
    check('original light sidebar colors and width are restored', styles.aside.background === 'rgb(249, 249, 248)' && styles.aside.color === 'rgb(33, 32, 28)' && styles.aside.width === '240px');
    check('original selected sidebar item uses light blue fill and blue text', styles.link.background === 'rgb(237, 242, 254)' && styles.link.color === 'rgb(62, 99, 221)');
    check('World Model selected tab has transparent square surface and 2px blue underline', styles.selected.background === 'rgba(0, 0, 0, 0)' && styles.selected.radius === '0px' && styles.selected.underline === '2px' && styles.selected.color === 'rgb(47, 111, 237)');
    check('World Model unselected tab has no fill or visible underline', styles.idle.background === 'rgba(0, 0, 0, 0)' && styles.idle.underline === 'rgba(0, 0, 0, 0)');
    await capture('desktop');
    await page.click('[aria-label="折叠菜单"]');
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().width === 64);
    check('collapsed sidebar retains named Demo link', await page.evaluate(() => !!document.querySelector('nav a[aria-label="Demo · 资产视图"]')));
    await capture('collapsed');
    await page.click('nav a[href="/assets"]');
    await page.waitForSelector('[aria-label="刷新资产"]');
    await page.click('[aria-label="搜索页面"]');
    await page.fill('input[role="combobox"][aria-label="搜索页面"]', 'demo'); await page.keyboard.press('Enter'); await ready('全部资产');
    check('quick navigation finds Demo', (await page.url()).includes('/demo/navigation'));
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await page.waitForSelector('[aria-label="打开菜单"]');
    await page.click('[aria-label="打开菜单"]'); await page.waitForSelector('[aria-label="关闭菜单"]');
    await page.waitForFunction(() => innerWidth === 375 && document.querySelector('aside').getBoundingClientRect().left === 0);
    check('mobile drawer keeps second-level link visible', await page.evaluate(() => {
      const link = document.querySelector('nav a[href^="/demo/navigation"]');
      return link && link.checkVisibility() && link.getBoundingClientRect().right <= innerWidth;
    }));
    await capture('mobile-drawer');
    await page.click('nav a[href^="/demo/navigation"]');
    await page.waitForFunction(() => document.querySelector('aside').inert && document.querySelector('aside').getBoundingClientRect().right <= 0);
    await page.click('loc=role:tab[name="待复核"]'); await ready('待复核');
    check('mobile pending panel matches actual API rows', await rowsMatch('待复核'));
    check('mobile tabs remain visible without page overflow', await page.evaluate(() => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect();
      return tab.left >= 0 && tab.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    }));
    await page.waitForFunction(() => document.querySelector('aside').inert && document.querySelector('aside').getBoundingClientRect().right <= 0);
    await capture('mobile');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.waitForSelector('[aria-label="展开菜单"]'); await page.click('[aria-label="展开菜单"]');
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().width === 240);
    result.url = await page.url(); result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = String(error); }
  await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  return result;
}
