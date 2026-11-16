import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Real browser -> Starter API -> real isolated DB; only the vendor is simulated.
export async function verifyAiClientBrowser(task, {
  evidenceDir,
  pageLabel = 'p1',
  baseUrl = 'http://127.0.0.1:38460',
  fixtureUrl = 'http://127.0.0.1:38462',
  runtimeDir = '/Users/steve/Projects/00-optimax/optimax-starter/evidence/ai-client-port/runtime',
}) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel);
  let afterSequence = 0;
  const result = { status: 'RUNNING', baseUrl, simulation: 'Scripted vendor simulator; real Starter browser/API/PostgreSQL. No real model inference.', checks: [], screenshots: [] };
  function check(name, actual) { assert.ok(actual, name); result.checks.push({ name, status: 'PASS' }); }
  async function control(path, body) {
    const response = await fetch(`${fixtureUrl}/__fixture/${path}`, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function until(fn, label) {
    const end = Date.now() + 6000;
    while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 80)); }
    throw new Error(`Timed out: ${label}`);
  }
  async function capture(name) {
    const path = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path });
    result.screenshots.push({ path, url: await page.url() });
  }
  async function start(instruction) {
    await page.fill('[aria-label="自然语言筛选"]', instruction);
    await page.waitForFunction(() => {
      const button = document.querySelector('[aria-label="执行筛选"]');
      return button && !button.disabled && !button.closest('[inert]');
    }, undefined, { timeout: 10000 });
    await page.click('[aria-label="执行筛选"]');
  }
  async function settled(kind) {
    await page.waitForFunction(expected => document.querySelector('[data-asset-agent-status]')?.getAttribute('data-asset-agent-status') === expected, kind, { timeout: 15000 });
  }
  const instruction = '清空筛选，只看履约和运营中待复核的资产';
  async function demo() {
    await control('rules', { rules: [{ instruction, phase: 'plan', action: { type: 'tool', arguments: { clear_all: true, stage: ['待复核'], domain: ['履约', '运营'] } } }] });
    await start(instruction);
    await settled('success');
  }
  try {
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await control('reset', {});
    afterSequence = (await control('state')).seq;
    await page.goto(`${baseUrl}/assets`);
    if (new URL(await page.url()).pathname === '/login') {
      const env = Object.fromEntries((await readFile(`${runtimeDir}/compose.env`, 'utf8')).split('\n').filter(line => line.includes('=')).map(line => { const pos = line.indexOf('='); return [line.slice(0, pos), line.slice(pos + 1)]; }));
      await page.fill('input[name="username"]', 'aie2e_admin');
      await page.fill('input[name="password"]', env.AIE2E_ADMIN_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL(url => new URL(url).pathname !== '/login');
      await page.goto(`${baseUrl}/assets`);
    }
    await page.waitForSelector('[aria-label="自然语言筛选"]');
    check('isolated Starter session authenticated', (await page.fetch('/console/me')).status === 200);
    const assetResponse = await page.fetch('/console/assets');
    assert.equal(assetResponse.status, 200);
    const assets = JSON.parse(assetResponse.body);
    check('reads real seeded database assets', assets.length >= 12);
    await page.evaluate(() => {
      window.__aiPort = { original: window.fetch, calls: [] };
      window.fetch = async function (...args) {
        const response = await window.__aiPort.original.apply(window, args);
        if (String(args[0]).includes('/assets/agent/')) {
          window.__aiPort.calls.push({ path: String(args[0]), request: args[1]?.body ? JSON.parse(args[1].body) : null, status: response.status, response: await response.clone().json() });
        }
        return response;
      };
    });
    await demo();
    const state = await page.evaluate(() => ({ url: location.href, rows: [...document.querySelectorAll('tbody tr')].map(row => row.innerText), calls: window.__aiPort.calls }));
    result.callTrace = state.calls;
    const params = new URL(state.url).searchParams;
    check('tool changes URL stage and OR domains', params.get('stage') === '待复核' && JSON.parse(params.get('domain')).sort().join(',') === ['履约', '运营'].sort().join(','));
    const expected = assets.filter(asset => asset.stage === '待复核' && ['履约', '运营'].includes(asset.domain));
    check('actual table matches database rows', state.rows.length === expected.length && expected.every(asset => state.rows.some(row => row.includes(asset.name))));
    check('receipt carries actual matched rows and is acknowledged', state.calls.some(call => call.path.endsWith('/result') && call.request.matched === expected.length && call.response.acknowledged === true));
    const trace = await control(`trace?sinceSeq=${afterSequence}`);
    check('fixture receives real tool-result receipt', trace.records.some(row => row.phase === 'receipt' && row.receipt?.ok && row.receipt.matched === expected.length));
    await capture('desktop-filtered');
    await page.reload();
    await page.waitForSelector('[aria-label="自然语言筛选"]');
    check('URL and table survive refresh', (await page.url()).includes('stage=') && await page.evaluate(() => document.querySelectorAll('tbody tr').length) === expected.length);
    const beforeError = await page.url();
    await control('rules', { rules: [{ tag: 'browser-auth', phase: 'plan', action: { type: 'error', status: 401, message: 'VENDOR-BROWSER-SECRET-MUST-NOT-RENDER', code: 'invalid_api_key' } }] });
    await start('[e2e:browser-auth] 只看待复核');
    await settled('error');
    check('upstream auth failure preserves filter and application session', await page.url() === beforeError && (await page.fetch('/console/me')).status === 200);
    check('vendor error text is not rendered', !(await page.evaluate(() => document.body.innerText)).includes('VENDOR-BROWSER-SECRET'));
    await capture('upstream-error');
    await control('rules', { rules: [{ tag: 'browser-stop', phase: 'plan', action: { type: 'hold', holdId: 'browser-stop' } }] });
    const stopSequence = (await control('state')).seq;
    await start('[e2e:browser-stop] 只看待复核');
    await until(async () => (await control(`trace?sinceSeq=${stopSequence}`)).records.some(row => row.tag === 'browser-stop'), 'upstream receives held request');
    await page.click('[aria-label="停止筛选"]');
    await settled('idle');
    await until(async () => (await control(`trace?sinceSeq=${stopSequence}`)).records.some(row => row.tag === 'browser-stop' && row.aborted), 'browser cancellation aborts upstream');
    await control('release', { holdId: 'browser-stop' });
    check('stop prevents filter mutation', await page.url() === beforeError);
    await demo();
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.waitForFunction(() => {
      const sidebar = document.querySelector('aside');
      return innerWidth === 390 && sidebar?.inert && sidebar.getBoundingClientRect().right <= 1;
    });
    check('mobile sidebar finishes closing before capture', await page.evaluate(() => document.querySelector('aside')?.inert));
    check('mobile viewport has no page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('mobile-filtered');
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = String(error.stack ?? error);
    await capture('failure').catch(() => undefined);
    throw error;
  } finally {
    await page.evaluate(() => { if (window.__aiPort) { window.fetch = window.__aiPort.original; delete window.__aiPort; } }).catch(() => undefined);
    await page.cdp('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined);
    await control('release', { all: true }).catch(() => undefined);
    result.fixtureTrace = (await control(`trace?sinceSeq=${afterSequence}`).catch(() => ({ records: [] }))).records;
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2) + '\n');
  }
  return { status: result.status, checks: result.checks.length, evidenceDir, screenshots: result.screenshots };
}
