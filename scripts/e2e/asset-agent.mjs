import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyAssetAgent(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [];
  const result = { status: 'RUNNING', baseUrl, checks, screenshots: [], traces: [] };
  function check(name, value) { assert.ok(value, name); checks.push({ name, status: 'PASS' }); }
  async function capture(name) {
    const path = `${evidenceDir}/${name}.png`;
    await page.screenshot({ path });
    result.screenshots.push({ path, url: await page.url() });
  }
  async function command(text, status = 'success') {
    await page.evaluate(() => {
      if (window.__assetAgentTrace) return;
      window.__assetAgentTrace = { fetch: window.fetch, calls: [] };
      window.fetch = async (...args) => {
        const response = await window.__assetAgentTrace.fetch.apply(window, args);
        if (String(args[0]).includes('/console/assets/agent/')) {
          window.__assetAgentTrace.calls.push({ path: String(args[0]), request: args[1]?.body ? JSON.parse(args[1].body) : undefined, status: response.status, response: await response.clone().json() });
        }
        return response;
      };
    });
    await page.fill('[aria-label="自然语言筛选"]', text);
    await page.click('[aria-label="执行筛选"]');
    await page.waitForFunction(() => ['success', 'error'].includes(document.querySelector('[data-asset-agent-status]')?.getAttribute('data-asset-agent-status')), undefined, { timeout: 120000 });
    const state = await page.evaluate(() => ({
      url: location.href,
      status: document.querySelector('[data-asset-agent-status]')?.textContent,
      kind: document.querySelector('[data-asset-agent-status]')?.getAttribute('data-asset-agent-status'),
      rows: [...document.querySelectorAll('tbody tr')].map(row => row.innerText),
      calls: window.__assetAgentTrace.calls.splice(0),
    }));
    result.traces.push({ text, ...state });
    assert.equal(state.kind, status, state.status);
    return state;
  }
  try {
    await page.goto(`${baseUrl}/assets`);
    await page.waitForSelector('[aria-label="自然语言筛选"]');
    if (await page.evaluate(() => !!document.querySelector('[aria-label="展开菜单"]'))) await page.click('[aria-label="展开菜单"]');
    const assetsResponse = await page.fetch('/console/assets');
    assert.equal(assetsResponse.status, 200);
    const assets = JSON.parse(assetsResponse.body);
    check('read real local assets', assets.length >= 12);
    await command('清空所有筛选条件');
    check('natural language clear removes URL filters', new URL(await page.url()).search === '');
    const filtered = await command('只看履约和运营中待复核的资产');
    const params = new URL(filtered.url).searchParams;
    const domain = JSON.parse(params.get('domain'));
    check('real model applies stage and multiple domains', params.get('stage') === '待复核' && domain.includes('履约') && domain.includes('运营'));
    check('Magpie tool call receives real browser result', filtered.calls.some(call => call.path.endsWith('/plan') && call.response.model === 'minimax/MiniMax-M3' && call.response.callId) && filtered.calls.some(call => call.path.endsWith('/result') && call.response.acknowledged === true && call.request.matched === 2));
    const expected = assets.filter(asset => asset.stage === '待复核' && ['履约', '运营'].includes(asset.domain));
    check('table reflects actual AND and OR filtering', filtered.rows.length === expected.length && expected.every(asset => filtered.rows.some(row => row.includes(asset.name))));
    await capture('asset-agent-filtered');
    await page.reload();
    await page.waitForSelector('[aria-label="自然语言筛选"]');
    check('reload restores applied URL and rows', (await page.url()).includes('stage=') && await page.evaluate(() => document.querySelectorAll('tbody tr').length) === expected.length);
    const followup = await command('保留登记状态，把业务域改为采购');
    check('follow-up preserves state and changes domain', new URL(followup.url).searchParams.get('stage') === '待复核' && decodeURI(followup.url).includes('采购') && !decodeURI(followup.url).includes('履约'));
    await command('清空筛选，资产名称必须等于库存服务');
    check('equals reuses existing matching semantics', new URL(await page.url()).searchParams.get('qOp') === 'equals' && await page.evaluate(() => document.querySelector('tbody')?.innerText.includes('库存服务')));
    const contains = await command('资产名称改为包含服务');
    check('contains replaces equals and uses real matching rows', new URL(contains.url).searchParams.get('q') === '服务' && !new URL(contains.url).searchParams.has('qOp') && contains.rows.length === assets.filter(asset => asset.name.includes('服务')).length);
    const beforeInvalid = await page.url();
    const refusal = await command('把登记状态设为已删除', 'error');
    check('unsupported value does not mutate filters', await page.url() === beforeInvalid);
    check('model reasoning is not rendered or returned', !refusal.status.includes('<think>') && refusal.calls.every(call => !JSON.stringify(call.response).includes('<think>')));
    await capture('asset-agent-refused');
    await command('清空所有筛选条件');
    await page.click('[aria-label="添加筛选"]');
    await page.fill('[aria-label="搜索资产"]', '未应用草稿');
    const draftUrl = await page.url();
    await command('只看待复核', 'error');
    check('unapplied manual draft is preserved', await page.url() === draftUrl && await page.evaluate(() => document.querySelector('[aria-label="搜索资产"]')?.value) === '未应用草稿');
    await capture('asset-agent-draft');
    await page.click('[aria-label="移除筛选 关键词"]');
    await command('只看待复核');
    await page.click('[aria-label="折叠菜单"]');
    check('collapsed sidebar retains bottom search', await page.evaluate(() => !!document.querySelector('aside [aria-label="搜索页面"]')));
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.waitForFunction(() => innerWidth === 390 && document.querySelector('aside').inert && document.querySelector('aside').getBoundingClientRect().right <= 0);
    check('mobile layout does not overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('asset-agent-mobile');
    await page.cdp('Emulation.clearDeviceMetricsOverride');
    await page.waitForFunction(() => !matchMedia('(max-width:720px)').matches && !document.querySelector('aside').inert);
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.error = String(error.stack ?? error);
    throw error;
  } finally {
    await page.evaluate(() => { if (window.__assetAgentTrace) window.fetch = window.__assetAgentTrace.fetch; }).catch(() => undefined);
    await page.cdp('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    await writeFile(`${evidenceDir}/results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}

export async function verifyAssetAgentEdges(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [];
  const result = { status: 'RUNNING', baseUrl, checks, faultInjection: 'Only this owned test page delays or rejects its own requests; successful responses use the actual API and Magpie.' };
  function check(name, value) { assert.ok(value, name); checks.push({ name, status: 'PASS' }); }
  async function clean() {
    await page.goto(`${baseUrl}/assets`);
    await page.waitForSelector('[aria-label="自然语言筛选"]');
    if (await page.evaluate(() => [...document.querySelectorAll('button')].some(button => button.textContent === '清空筛选'))) await page.click('text="清空筛选"');
    await page.waitForFunction(() => !location.search);
  }
  async function gate(afterResponse) {
    await page.evaluate(after => {
      const original = window.fetch;
      window.__assetGate = { original, ready: false, calls: 0 };
      const waiting = new Promise(resolve => { window.__assetGate.release = resolve; });
      window.fetch = async (...args) => {
        const value = window.__assetGate;
        if (!String(args[0]).endsWith('/assets/agent/plan')) return value.original.apply(window, args);
        value.calls++;
        if (after) {
          const response = await value.original.apply(window, args);
          await response.clone().json();
          value.ready = true;
          await waiting;
          return response;
        }
        value.ready = true;
        await waiting;
        args[1]?.signal?.throwIfAborted();
        return value.original.apply(window, args);
      };
    }, afterResponse);
  }
  async function start() {
    await page.fill('[aria-label="自然语言筛选"]', '只看待复核');
    await page.click('[aria-label="执行筛选"]');
    await page.waitForFunction(() => window.__assetGate.ready, undefined, { timeout: 100000 });
  }
  async function release() {
    await page.evaluate(() => { const value = window.__assetGate; window.fetch = value.original; value.release(); });
  }
  try {
    await clean();
    check('bridge exposes one named asset filter action', await page.evaluate(async () => {
      const { assetFilterSnapshot } = await import('/src/features/assets/agent-bridge.ts');
      const entries = assetFilterSnapshot();
      return entries.length === 1 && entries[0].label === '资产筛选' && JSON.stringify(entries[0].actions) === '["setValue"]';
    }));
    check('bridge rejects invalid enum and unsupported actions', await page.evaluate(async () => {
      const { assetAgent, assetFilterSnapshot } = await import('/src/features/assets/agent-bridge.ts');
      const ref = assetFilterSnapshot()[0].ref;
      const invalid = await assetAgent.act({ steps: [{ ref, action: 'setValue', args: [{ stage: '已删除' }] }] });
      const unsupported = await assetAgent.act({ steps: [{ ref, action: 'deleteAccount', args: [] }] });
      return !invalid.ok && !unsupported.ok && !location.search;
    }));
    check('bridge cannot apply without an active user request', await page.evaluate(async () => {
      const { assetAgent, assetFilterSnapshot } = await import('/src/features/assets/agent-bridge.ts');
      const result = await assetAgent.act({ steps: [{ ref: assetFilterSnapshot()[0].ref, action: 'setValue', args: [{ stage: '待复核' }] }] });
      return !result.ok && !location.search;
    }));

    await gate(true); await start();
    await page.click('[aria-label="添加筛选"]');
    await page.fill('[aria-label="搜索资产"]', '期间编辑');
    await release();
    await page.waitForSelector('[data-asset-agent-status="error"]', { timeout: 100000 });
    check('manual changes during real inference cannot be overwritten', await page.evaluate(() => !location.search && document.querySelector('[aria-label="搜索资产"]').value === '期间编辑' && document.querySelector('[data-asset-agent-status]').textContent.includes('手动')));
    await page.screenshot({ path: `${evidenceDir}/concurrent-draft.png` });
    await page.click('[aria-label="移除筛选 关键词"]');

    await gate(false); await start();
    await page.click('[aria-label="停止筛选"]');
    await release();
    check('stop keeps filters and prevents late application', await page.evaluate(() => !location.search && document.querySelector('[data-asset-agent-status]').textContent === '已停止'));

    await gate(true); await start();
    await page.click('aside a[href="/audit"]');
    await page.waitForSelector('[aria-label="刷新操作日志"]');
    await release();
    check('late result cannot change another route', (await page.url()).endsWith('/audit'));
    await clean();
    check('returning to assets retains original filter state', !(await page.url()).includes('?'));

    await page.evaluate(() => {
      window.__assetFailureFetch = window.fetch;
      window.fetch = async (...args) => { if (String(args[0]).endsWith('/assets/agent/plan')) throw new TypeError('E2E network fault'); return window.__assetFailureFetch.apply(window, args); };
    });
    await page.fill('[aria-label="自然语言筛选"]', '只看待复核');
    await page.click('[aria-label="执行筛选"]');
    await page.waitForSelector('[data-asset-agent-status="error"]');
    check('network failure leaves filters and returns controls', await page.evaluate(() => !location.search && !document.querySelector('[aria-label="执行筛选"]').disabled && document.querySelector('[data-asset-agent-status]').textContent.includes('无法连接服务')));
    await page.evaluate(() => { window.fetch = window.__assetFailureFetch; });

    await gate(true); await start();
    await page.evaluate(() => {
      window.__assetRefreshGate = { original: window.fetch };
      const waiting = new Promise(resolve => { window.__assetRefreshGate.release = resolve; });
      window.fetch = async (...args) => {
        if (String(args[0]) === '/console/assets') await waiting;
        return window.__assetRefreshGate.original.apply(window, args);
      };
    });
    await page.click('[aria-label="刷新资产"]');
    await page.waitForFunction(() => !!document.querySelector('.om-refresh-host[data-refresh-visible="true"]'));
    await page.evaluate(() => window.__assetGate.release());
    await page.waitForFunction(() => document.querySelector('[data-asset-agent-status]')?.getAttribute('data-asset-agent-status') === 'error', undefined, { timeout: 100000 });
    await page.evaluate(() => { window.fetch = window.__assetGate.original; window.__assetRefreshGate.release(); });
    await page.waitForFunction(() => !document.querySelector('.om-refresh-host[aria-busy="true"]'));
    check('refresh inert boundary refuses inference without changing filters', await page.evaluate(() => !location.search && !document.querySelector('[inert]') && document.querySelectorAll('tbody tr').length > 0));

    check('Chinese composition Enter does not submit', await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      document.querySelector('[aria-label="自然语言筛选"]').dispatchEvent(event);
      return event.defaultPrevented && !document.querySelector('[aria-label="停止筛选"]');
    }));

    await page.focus('[aria-label="自然语言筛选"]');
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForSelector('input[aria-label="搜索页面"]');
    await page.fill('input[aria-label="搜索页面"]', '资产');
    await page.press('input[aria-label="搜索页面"]', 'ArrowDown');
    await page.press('input[aria-label="搜索页面"]', 'Enter');
    await page.waitForFunction(() => !document.querySelector('input[aria-label="搜索页面"]') && document.activeElement?.getAttribute('aria-label') === '自然语言筛选');
    check('quick navigation keyboard still selects and returns focus', await page.evaluate(() => !document.querySelector('input[aria-label="搜索页面"]') && document.activeElement?.getAttribute('aria-label') === '自然语言筛选'));
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForSelector('input[aria-label="搜索页面"]');
    await page.press('input[aria-label="搜索页面"]', 'Escape');
    await page.waitForFunction(() => !document.querySelector('input[aria-label="搜索页面"]') && document.activeElement?.getAttribute('aria-label') === '自然语言筛选');
    check('quick navigation Esc restores focus', await page.evaluate(() => !document.querySelector('input[aria-label="搜索页面"]') && document.activeElement?.getAttribute('aria-label') === '自然语言筛选'));
    await page.screenshot({ path: `${evidenceDir}/keyboard-and-recovery.png` });
    result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = String(error.stack ?? error); throw error; }
  finally {
    await page.evaluate(() => {
      if (window.__assetGate) { window.fetch = window.__assetGate.original; window.__assetGate.release(); }
      if (window.__assetRefreshGate) window.__assetRefreshGate.release();
      if (window.__assetFailureFetch) window.fetch = window.__assetFailureFetch;
    }).catch(() => undefined);
    await writeFile(`${evidenceDir}/edge-results.json`, JSON.stringify(result, null, 2));
  }
  return result;
}
