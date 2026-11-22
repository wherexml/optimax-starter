import { mkdir, writeFile } from 'node:fs/promises';

// Failure cases are recorded before implementation in evidence/product-brand/plan.md.
export async function verifyProductBrand(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [], screenshots = [];
  const check = (name, ok) => checks.push({ name, status: ok ? 'PASS' : 'FAIL' });
  const result = { status: 'RUNNING', checks, screenshots };
  const logoPath = '/brand/optimax-starter.svg';
  async function ready() {
    await page.waitForSelector('main h1');
    await page.waitForFunction(() => !document.querySelector('.om-refresh-host[aria-busy="true"]'));
  }
  async function logo() {
    return page.evaluate(() => {
      const image = document.querySelector('.brand img'), mark = document.querySelector('.brand .mark');
      const box = mark?.getBoundingClientRect(), side = document.querySelector('aside').getBoundingClientRect();
      const style = mark && getComputedStyle(mark);
      return { src: image?.getAttribute('src'), loaded: image?.complete && image.naturalWidth > 0, alt: image?.alt,
        width: box?.width, height: box?.height, fits: box && box.left >= side.left && box.right <= side.right,
        background: style?.backgroundColor, border: style?.borderTopWidth, sidebarWidth: side.width,
        sidebarBackground: getComputedStyle(document.querySelector('aside')).backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
  }
  async function screenshot(name) {
    const path = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path }); screenshots.push({ name, path, url: await page.url() });
  }
  try {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/assets`); await ready();
    if (await page.evaluate(() => !!document.querySelector('.workspace.compact'))) await page.click('[aria-label="展开菜单"]');
    for (const [name, path] of [['assets','/assets'],['dashboard','/'],['accounts','/accounts'],['audit','/audit'],['settings','/settings'],['demo','/demo/navigation?tab=pending']]) {
      await page.goto(`${baseUrl}${path}`); await ready();
      const info = await logo();
      check(`${name}: shared Starter SVG loads with accessible name`, info.src === logoPath && info.loaded && !!info.alt);
      check(`${name}: 32px mark has no outer frame or overflow`, info.width === 32 && info.height === 32 && info.fits && info.background === 'rgba(0, 0, 0, 0)' && info.border === '0px' && !info.overflow);
      if (name === 'assets') {
        result.expanded = info;
        check('expanded sidebar keeps the original 240px light style', info.sidebarWidth === 240 && info.sidebarBackground === 'rgb(249, 249, 248)');
        await screenshot('desktop-assets');
      }
    }
    await page.goto(`${baseUrl}/assets`); await ready();
    await page.click('[aria-label="折叠菜单"]');
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().width === 64);
    const compact = await logo(); result.compact = compact;
    check('collapsed sidebar shows the same unclipped SVG', compact.src === logoPath && compact.loaded && compact.fits && compact.width === 32 && compact.sidebarWidth === 64);
    await screenshot('collapsed-assets');
    await page.reload(); await ready();
    check('reload retains product logo and collapsed state', await page.evaluate(() => !!document.querySelector('.workspace.compact .brand img[src="/brand/optimax-starter.svg"]')));
    await page.click('[aria-label="展开菜单"]');
    await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().width === 240);

    // Delay a real read only in this tab, then forward it unchanged to the local API.
    await page.evaluate(() => {
      const original = window.fetch;
      window.__productBrandGate = { original, releases: [], hits: 0, statuses: [] };
      window.fetch = async (...args) => {
        if (String(args[0]).includes('/console/assets')) {
          window.__productBrandGate.hits++;
          await new Promise(resolve => { window.__productBrandGate.releases.push(resolve); });
          const response = await original(...args);
          window.__productBrandGate.statuses.push(response.status);
          return response;
        }
        return original(...args);
      };
    });
    await page.click('[aria-label="刷新资产"]');
    await page.waitForFunction(() => !!document.querySelector('.om-refresh-host[data-refresh-visible="true"]'));
    result.refresh = await page.evaluate(() => ({
      hasBrandImage: Boolean(document.querySelector('.om-refresh-overlay image')),
      petalCount: document.querySelectorAll('.om-refresh-overlay .om-refresh-petal').length,
      requests: window.__productBrandGate.hits,
    }));
    check(
      'content refresh uses standalone vector spinner without embedded brand image',
      !result.refresh.hasBrandImage && result.refresh.petalCount === 4 && result.refresh.requests >= 1,
    );
    await screenshot('assets-refresh');
    await page.evaluate(() => { window.fetch = window.__productBrandGate.original; window.__productBrandGate.releases.forEach(release => release()); });
    await ready();
    check('real refresh restores the asset table and interaction', await page.evaluate(() => !!document.querySelector('table tbody tr') && !document.querySelector('.om-refresh-host [inert]') && !document.body.innerText.includes('无法连接服务') && window.__productBrandGate.statuses.length >= 1 && window.__productBrandGate.statuses.every(status => status === 200)));

    await page.goto(`${baseUrl}/demo/navigation?tab=pending`); await ready();
    check(
      'Demo table refresh also uses the standalone vector spinner',
      await page.evaluate(() => !document.querySelector('.om-refresh-overlay image') && document.querySelectorAll('.om-refresh-overlay .om-refresh-petal').length === 4),
    );
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.goto(`${baseUrl}/assets`); await ready();
    await page.click('[aria-label="打开菜单"]');
    await page.waitForFunction(() => Math.abs(document.querySelector('aside').getBoundingClientRect().left) < 1);
    const mobile = await logo(); result.mobile = mobile;
    check('mobile drawer retains the same clear product logo', mobile.src === logoPath && mobile.loaded && mobile.width === 32 && mobile.fits && !mobile.overflow);
    await screenshot('mobile-drawer');
    await page.click('[aria-label="关闭菜单"]');
    check('mobile menu still closes and restores page interaction', await page.evaluate(() => !document.querySelector('.workspace.drawer-open') && !document.querySelector('.content').inert));

    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/login`); await page.waitForSelector('[data-login-logo]');
    check('login retains the original OptiMax brand logo', await page.evaluate(() => document.querySelector('[data-login-logo]').getAttribute('src') === '/brand/optimax-product-logo.png' && !document.querySelector('.brand')));
    check('browser tab keeps the Starter title and icon', await page.title() === 'Optimax Starter' && await page.evaluate(() => !!document.querySelector('link[href="/brand/optimax-starter.svg"]')));
    await screenshot('login-unchanged');
    result.status = checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) { result.status = 'FAIL'; result.error = String(error); }
  finally {
    await page.evaluate(() => { if (window.__productBrandGate) { window.fetch = window.__productBrandGate.original; window.__productBrandGate.releases.forEach(release => release()); } }).catch(() => {});
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${baseUrl}/assets`);
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
