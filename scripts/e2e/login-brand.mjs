import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyLoginBrand(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [], screenshots = [];
  const result = { status: 'RUNNING', checks, screenshots };
  const check = (name, ok) => checks.push({ name, status: ok ? 'PASS' : 'FAIL' });
  async function ready() {
    await page.waitForSelector('#password');
    await page.waitForFunction(() => [...document.querySelectorAll('main img')].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  try {
    await page.goto(`${baseUrl}/login`); await ready();
    check('product heading matches requested name', await page.evaluate(() => document.querySelector('h1')?.textContent.trim() === 'Optimax Starter'));
    const brand = await page.evaluate(() => {
      const logo = document.querySelector('[data-login-logo]'), wrapper = logo?.parentElement;
      const style = wrapper ? getComputedStyle(wrapper) : null;
      return { src: logo?.getAttribute('src'), alt: logo?.getAttribute('alt'), frame: style ? [style.borderTopWidth, style.backgroundColor, style.boxShadow] : null };
    });
    check('existing OptiMax product logo has no outer frame', brand.src === '/brand/optimax-product-logo.png' && !!brand.alt && brand.frame?.join('|') === '0px|rgba(0, 0, 0, 0)|none');
    const intro = await page.evaluate(() => document.querySelector('[data-login-intro]')?.textContent.trim() ?? '');
    result.introLength = intro.length;
    check('product value introduction is 100 to 199 characters', intro.length >= 100 && intro.length < 200 && intro.includes('试点') && intro.includes('可选'));
    const background = await page.evaluate(() => {
      const image = document.querySelector('[data-login-background]');
      return image ? { src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight } : null;
    });
    result.background = background;
    check('new generated background is loaded', !!background && background.src !== '/login-map.png');
    check('exported background has actual UHD 4K dimensions', background?.width === 3840 && background?.height === 2160);
    check('login keeps username and password autocomplete', await page.evaluate(() => document.querySelector('#username').autocomplete === 'username' && document.querySelector('#password').autocomplete === 'current-password' && !document.querySelector('#password').hasAttribute('data-1p-ignore')));
    await page.fill('#username', ''); await page.fill('#password', '');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#username-error'); await page.waitForSelector('#password-error');
    check('required fields still validate before login', true);
    await page.fill('#password', 'local-ui-check');
    await page.click('[aria-label="显示密码"]');
    check('password visibility toggle still works', await page.evaluate(() => document.querySelector('#password').type === 'text'));
    await page.click('[aria-label="隐藏密码"]'); await page.fill('#password', '');
    check('password can be hidden again', await page.evaluate(() => document.querySelector('#password').type === 'password'));
    await page.focus('#username'); await page.keyboard.press('Tab');
    check('keyboard moves from username into password', await page.evaluate(() => document.activeElement?.id === 'password'));
    const remembered = await page.evaluate(() => document.querySelector('#remember').getAttribute('aria-checked'));
    await page.click('#remember'); await page.keyboard.press('Space');
    check('remember checkbox supports pointer and keyboard', await page.evaluate(() => document.querySelector('#remember').getAttribute('aria-checked')) === remembered);

    for (const [name, width, height] of [['comment',1203,896],['desktop',1440,900],['4k',3840,2160],['tablet',820,1180],['mobile',390,844]]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await page.reload(); await ready();
      await page.waitForFunction(width => innerWidth === width, width);
      const layout = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
        return { overflow: document.documentElement.scrollWidth > innerWidth, heading:rect(document.querySelector('h1')), intro:rect(document.querySelector('[data-login-intro]')), panel:rect(document.querySelector('[data-login-panel]')), button:rect(document.querySelector('button[type="submit"]')) };
      });
      check(`${name}: login panel fits horizontally`, !layout.overflow && layout.panel.left >= 16 && layout.panel.right <= width-16);
      check(`${name}: product copy does not overlap login panel`, width >= 1024 ? layout.intro.right <= layout.panel.left : layout.intro.bottom < layout.panel.top);
      const path = `${evidenceDir}/${name}.png`;
      await page.screenshot({ path }); screenshots.push({ name, path, url:await page.url(), width, height, layout });
    }
    result.status = checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) { result.status = 'FAIL'; result.error = String(error); }
  finally {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width:1203, height:896, deviceScaleFactor:1, mobile:false });
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
