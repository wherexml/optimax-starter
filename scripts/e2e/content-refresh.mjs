// Run inside `ego-browser nodejs`, passing an owned TaskSpace and an absolute evidenceDir.
// Failure cases: sidebar remount, stuck overlay/inert, wrong scope, early concurrent completion,
// quick-request flash, failed read hiding errors, route-switch leak, overflow, reduced-motion drift.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

export async function verifyContentRefresh(task, { evidenceDir, worldUrl = 'http://127.0.0.1:36005/workspace/', starterUrl = 'http://127.0.0.1:38140/' }) {
  await mkdir(evidenceDir, { recursive: true });
  const world = task.page('p1'), starter = task.page('p2');
  const checks = [];
  function check(name, value) { assert.ok(value, name); checks.push({ name, status: 'PASS' }); }
  const visible = () => !!document.querySelector('.om-refresh-host[data-refresh-visible="true"]');
  const idle = () => !document.querySelector('.om-refresh-host[aria-busy="true"]');
  async function screenshot(page, name) { await page.screenshot({ path: `${evidenceDir}/${name}.png` }); }
  async function nativeGate() {
    await world.evaluate(() => {
      window.__refreshTest = { read: FabWorkspaceStore.read, gates: [], calls: [], nav: document.querySelector('#nav').firstElementChild, tabs: document.querySelector('.ws-nav') };
      FabWorkspaceStore.read = async (...args) => {
        const test = window.__refreshTest; test.calls.push(args);
        await new Promise(resolve => test.gates.push(resolve));
        return test.read(...args);
      };
    });
  }
  async function nativeRelease() { await world.evaluate(() => { const t=window.__refreshTest; FabWorkspaceStore.read=t.read; t.gates.forEach(resolve=>resolve()); }); }
  async function apiGate() {
    await starter.evaluate(() => {
      window.__refreshTest = { fetch, gates: [], calls: [], resolved: [], aside: document.querySelector('aside') };
      window.fetch = async (...args) => {
        const t=window.__refreshTest, url=String(args[0]);
        if (/\/console\/(assets|accounts|audit)/.test(url)) {
          t.calls.push(url); await new Promise(resolve=>t.gates.push(resolve));
        }
        const result=await t.fetch.apply(window,args); t.resolved.push({url,status:result.status}); return result;
      };
    });
  }
  async function apiRelease() { await starter.evaluate(() => { const t=window.__refreshTest; window.fetch=t.fetch; t.gates.forEach(resolve=>resolve()); }); }
  try {
    await world.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await starter.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await world.goto(`${worldUrl}#/app/o2/0`);
    await world.reload();
    await world.waitForFunction(() => !!window.FabFactoryRuntime?.session && !document.querySelector('[aria-busy="true"]'));
    await nativeGate(); await world.click('[data-v4="reload"]'); await world.waitForFunction(visible);
    const native = await world.evaluate(() => {
      const t=window.__refreshTest, host=document.querySelector('.om-refresh-host[data-refresh-visible]'), brand=host.querySelector('.om-refresh-brand');
      return {calls:t.calls.length,nav:t.nav===document.querySelector('#nav').firstElementChild,tabs:t.tabs===document.querySelector('.ws-nav'),inert:host.querySelector(':scope > :not(.om-refresh-overlay)').inert,size:brand.getBoundingClientRect().width};
    });
    check('World real reload keeps sidebar and tabs; only content is inert', native.calls===1 && native.nav && native.tabs && native.inert && native.size===32);
    await screenshot(world,'world-loading'); await nativeRelease(); await world.waitForFunction(idle);
    check('World success restores content and preserves sidebar DOM', await world.evaluate(() => window.__refreshTest.nav===document.querySelector('#nav').firstElementChild && !document.querySelector('[inert]')));
    await screenshot(world,'world-ready');

    await nativeGate();
    await world.evaluate(() => {
      const args=['fabflow-v4:'+FabFactoryRuntime.session.key];
      window.__refreshPromises=[1,2].map(()=>WorldContentRefresh.track(()=>FabWorkspaceStore.read(...args),'factory'));
    });
    await world.waitForFunction(visible);
    await world.evaluate(async()=>{window.__refreshTest.gates[0]();await window.__refreshPromises[0]});
    check('World concurrent reads retain overlay after the first result', await world.evaluate(visible));
    await world.click('a[href="#/apps"]');
    await world.waitForSelector('.catalog-page');
    check('Leaving manufacturing clears the old loading scope', await world.evaluate(()=>!document.querySelector('[aria-busy="true"]')));
    await nativeRelease();
    await world.evaluate(()=>Promise.all(window.__refreshPromises));
    check('Late completion does not cover the app catalog', await world.evaluate(()=>!!document.querySelector('.catalog-page')&&!document.querySelector('[aria-busy="true"]')));

    await world.goto(`${worldUrl}#/app/o2/0`); await world.waitForFunction(()=>!!FabFactoryRuntime.session);
    await world.evaluate(()=>{window.__originalRead=FabWorkspaceStore.read;FabWorkspaceStore.read=async()=>{throw Error('E2E_READ_FAILED')}});
    await world.click('[data-v4="reload"]');
    await world.waitForFunction(()=>document.querySelector('#content').textContent.includes('E2E_READ_FAILED'));
    check('World failed read surfaces the original error and releases loading', await world.evaluate(idle));
    await screenshot(world,'world-error');
    await world.evaluate(()=>{FabWorkspaceStore.read=window.__originalRead});
    await world.click('[data-v4="reload"]'); await world.waitForFunction(()=>!document.querySelector('#content').textContent.includes('E2E_READ_FAILED')&&!document.querySelector('[aria-busy="true"]'));
    check('World retry restores the real factory data',true);
    check('World fast read avoids a skeleton flash',await world.evaluate(async()=>{
      let flashes=0;const host=document.querySelector('.om-refresh-host');
      const observer=new MutationObserver(records=>{flashes+=records.length});observer.observe(host,{attributes:true,attributeFilter:['data-refresh-visible']});
      await WorldContentRefresh.track(()=>FabWorkspaceStore.read('fabflow-v4:'+FabFactoryRuntime.session.key),'factory');
      observer.disconnect();return flashes===0&&!host.hasAttribute('aria-busy');
    }));

    await starter.goto(starterUrl); await starter.reload(); await starter.waitForSelector('[aria-label="刷新概览"]:not([disabled])');
    await apiGate(); await starter.click('[aria-label="刷新概览"]'); await starter.waitForFunction(visible);
    check('Starter manual dashboard refresh tracks three real API reads and keeps sidebar', await starter.evaluate(()=>window.__refreshTest.calls.length===3&&window.__refreshTest.aside===document.querySelector('aside')));
    await screenshot(starter,'starter-loading');
    await starter.evaluate(()=>window.__refreshTest.gates[0]());
    await starter.waitForFunction(()=>window.__refreshTest.resolved.length>=1);
    check('Starter keeps the boundary until all dashboard reads complete',await starter.evaluate(visible));
    await apiRelease(); await starter.waitForFunction(idle);
    check('Starter success restores interaction and actual API responses',await starter.evaluate(()=>window.__refreshTest.resolved.filter(x=>x.status===200).length===3&&!document.querySelector('[inert]')&&window.__refreshTest.aside===document.querySelector('aside')));
    await screenshot(starter,'starter-ready');

    for (const [path,label] of [['assets','刷新资产'],['accounts','刷新账户'],['audit','刷新操作日志']]) {
      if(path==='audit')await apiGate();
      await starter.click(`aside a[href="/${path}"]`);
      if(path==='audit') {
        await starter.waitForFunction(visible);
        check('Starter uncached route uses the same first-load skeleton',await starter.evaluate(()=>window.__refreshTest.calls.length>=1&&window.__refreshTest.aside===document.querySelector('aside')));
        await apiRelease();await starter.waitForFunction(idle);
      }
      await starter.waitForSelector(`[aria-label="${label}"]:not([disabled])`);
      await apiGate(); await starter.click(`[aria-label="${label}"]`); await starter.waitForFunction(visible);
      check(`Starter ${path} uses the table skeleton for actual refresh`,await starter.evaluate(()=>document.querySelector('.om-refresh-overlay [data-layout]').dataset.layout==='table'&&window.__refreshTest.calls.length>=1));
      await apiRelease(); await starter.waitForFunction(idle);
    }
    await apiGate(); await starter.click('[aria-label="刷新操作日志"]'); await starter.waitForFunction(visible);
    await starter.click('aside a[href="/assets"]');
    await starter.waitForSelector('[aria-label="刷新资产"]');
    check('Starter route switch removes the previous page boundary', await starter.evaluate(()=>location.pathname==='/assets'&&!document.querySelector('[aria-busy="true"]')));
    await apiRelease(); await starter.waitForFunction(idle);

    await starter.waitForSelector('[aria-label="刷新资产"]:not([disabled])');
    await starter.evaluate(()=>{window.__refreshErrors=0;window.__refreshFetch=fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/console/assets')){window.__refreshErrors++;throw Error('E2E_NETWORK_FAILURE')}return window.__refreshFetch(...args)}});
    await starter.click('[aria-label="刷新资产"]');
    await starter.waitForFunction(()=>document.body.innerText.includes('无法连接服务'),undefined,{timeout:20000});
    check('Starter retry exhaustion displays the page error and releases loading',await starter.evaluate(idle));
    await screenshot(starter,'starter-error');
    await starter.evaluate(()=>{window.fetch=window.__refreshFetch});
    await starter.click('[aria-label="刷新资产"]'); await starter.waitForFunction(()=>!document.body.innerText.includes('无法连接服务')&&!document.querySelector('[aria-busy="true"]'));
    check('Starter retry returns real asset rows',await starter.evaluate(()=>document.querySelectorAll('tbody tr').length>0));

    await world.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await nativeGate(); await world.click('[data-v4="reload"]'); await world.waitForFunction(visible);
    check('Reduced motion disables rotor and petal animation',await world.evaluate(()=>[...document.querySelectorAll('.om-refresh-brand,.om-refresh-petal')].every(el=>getComputedStyle(el).animationName==='none')));
    await nativeRelease(); await world.waitForFunction(idle);
    await world.cdp('Emulation.setEmulatedMedia',{features:[]});
    for (const [page,name,button] of [[world,'world-mobile','[data-v4="reload"]'],[starter,'starter-mobile','[aria-label="刷新资产"]']]) {
      await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      if(page===world)await nativeGate();else await apiGate();
      await page.click(button);await page.waitForFunction(visible);
      check(`${name} indicator stays within the viewport`,await page.evaluate(()=>{const r=document.querySelector('.om-refresh-brand').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
      await screenshot(page,name);
      if(page===world)await nativeRelease();else await apiRelease();
      await page.waitForFunction(idle);await page.cdp('Emulation.clearDeviceMetricsOverride');
    }
    return checks;
  } finally {
    for (const page of [world,starter]) {
      await page.evaluate(()=>{const t=window.__refreshTest;if(t?.read&&window.FabWorkspaceStore)FabWorkspaceStore.read=t.read;if(t?.fetch)window.fetch=t.fetch;t?.gates.forEach(r=>r());if(window.__originalRead&&window.FabWorkspaceStore)FabWorkspaceStore.read=window.__originalRead;if(window.__refreshFetch)window.fetch=window.__refreshFetch}).catch(()=>{});
      await page.cdp('Emulation.clearDeviceMetricsOverride').catch(()=>{});
      await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
      await page.cdp('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
    }
    await writeFile(`${evidenceDir}/results.json`,JSON.stringify({at:new Date().toISOString(),worldUrl,starterUrl,checks},null,2)+'\n');
  }
}

/** World-only modules: real iframe navigation and the host boot contract of both studios. */
export async function verifyWorldModuleRefresh(task, { evidenceDir, worldUrl = 'http://127.0.0.1:36005/workspace/' }) {
  const page=task.page('p1'), checks=[];
  let scriptId;
  const idle=()=>!document.querySelector('.om-refresh-host[aria-busy="true"]');
  try {
    await page.goto(`${worldUrl}#/app/p-model/0`);await page.reload();await page.waitForFunction(idle);
    await page.cdp('Network.enable');await page.cdp('Network.setCacheDisabled',{cacheDisabled:true});
    await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:1000,downloadThroughput:-1,uploadThroughput:-1});
    await page.click('[data-go="#/app/p-model/1"]');await page.waitForSelector('.reuse-stage[data-refresh-visible="true"]');
    assert.ok(await page.evaluate(()=>!document.querySelector('.reuse-stage .ws-nav')&&!!document.querySelector('.reuse-stage>.om-refresh-overlay')));
    await page.screenshot({path:`${evidenceDir}/world-platform-loading.png`});
    await page.waitForFunction(idle,undefined,{timeout:30000});
    assert.ok(await page.evaluate(()=>document.querySelector('iframe').contentDocument.body.innerText.includes('实体类型')));
    checks.push({name:'Data-platform iframe navigation keeps tabs outside its skeleton and restores the loaded page',status:'PASS'});
    await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await page.cdp('Network.setCacheDisabled',{cacheDisabled:false});
    const result=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.__studioGates=[];let api;
      Object.defineProperty(window,'WorldContentRefresh',{configurable:true,get(){return api},set(raw){
        window.__studioOriginal=raw;
        api={...raw,track(read,scope){return raw.track(scope==='p-studio'?async()=>{await new Promise(resolve=>window.__studioGates.push(resolve));return read()}:read,scope)}};
      }});`});
    scriptId=result.identifier;
    await page.goto(`${worldUrl}#/app/p-studio/0`);await page.reload();
    await page.waitForSelector('.ms-stage[data-refresh-visible="true"]');
    assert.ok(await page.evaluate(()=>document.querySelector('.ms-stage>.om-refresh-overlay').isConnected&&document.querySelector('.ms-stage>.ms-slot').inert));
    await page.screenshot({path:`${evidenceDir}/world-studio-loading.png`});
    await page.evaluate(()=>window.__studioGates.forEach(resolve=>resolve()));await page.waitForFunction(idle);
    await page.waitForFunction(()=>document.querySelector('.ms-v2-host')?.shadowRoot?.textContent.includes('工作室资源'));
    checks.push({name:'V2 studio boot uses the shared host boundary outside its Shadow Root',status:'PASS'});
    await page.evaluate(()=>{window.__studioGates=[];location.hash='/app/p-studio/1'});
    await page.waitForSelector('.ms-stage[data-refresh-visible="true"]');
    await page.evaluate(()=>window.__studioGates.forEach(resolve=>resolve()));await page.waitForFunction(idle);
    await page.waitForFunction(()=>document.querySelector('.ms-slot').innerText.trim().length>0);
    checks.push({name:'Legacy studio snapshot read uses the same boundary and restores the actual view',status:'PASS'});
    return checks;
  } finally {
    if(scriptId)await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId});
    await page.evaluate(()=>{window.__studioGates?.forEach(resolve=>resolve());if(window.__studioOriginal)Object.defineProperty(window,'WorldContentRefresh',{configurable:true,writable:true,value:window.__studioOriginal})}).catch(()=>{});
    await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await page.cdp('Network.setCacheDisabled',{cacheDisabled:false});
    await writeFile(`${evidenceDir}/module-results.json`,JSON.stringify({at:new Date().toISOString(),worldUrl,checks},null,2)+'\n');
  }
}
