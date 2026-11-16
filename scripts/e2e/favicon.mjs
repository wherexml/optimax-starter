import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyFavicon(task, { evidenceDir, pageLabel = 'p1', baseUrl = 'http://127.0.0.1:38140' }) {
  await mkdir(evidenceDir, { recursive: true });
  const page = task.page(pageLabel), checks = [], screenshots = [];
  const check = (name, ok) => checks.push({ name, status: ok ? 'PASS' : 'FAIL' });
  const result = { status: 'RUNNING', checks, screenshots };
  try {
    await page.goto(`${baseUrl}/login`); await page.waitForSelector('#password');
    check('browser tab uses product-specific title', await page.title() === 'Optimax Starter');
    const info = await page.evaluate(async () => {
      const icon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
      if (!icon) return { hasIcon:false };
      const response = await fetch(icon.href), text = await response.text();
      const xml = new DOMParser().parseFromString(text,'image/svg+xml');
      return { hasIcon:true, href:icon.getAttribute('href'), mime:response.headers.get('content-type'), status:response.status, svg:xml.documentElement.localName === 'svg' && !xml.querySelector('parsererror'), viewBox:xml.documentElement.getAttribute('viewBox'), vectorOnly:!xml.querySelector('image,script,foreignObject,use[href^="http"],use[href^="data:"]'), fallback:document.querySelector('link[rel="icon"][type="image/png"]')?.getAttribute('href') };
    });
    result.icon = info;
    check('HTML declares the new SVG favicon', info.href === '/brand/optimax-starter.svg');
    check('SVG is served as a real SVG asset', info.status === 200 && info.mime?.includes('image/svg+xml') && info.svg);
    check('favicon is editable vector artwork', info.vectorOnly && info.viewBox === '0 0 64 64');
    check('HTML declares the matching PNG fallback', info.fallback === '/brand/optimax-starter-32.png');
    if (info.svg) {
      const render = await page.evaluate(async () => {
        const image = new Image(); image.src = '/brand/optimax-starter.svg'; await image.decode();
        const pixels = [];
        for (const size of [16,32]) {
          const canvas = document.createElement('canvas');canvas.width=size;canvas.height=size;
          const context = canvas.getContext('2d');context.drawImage(image,0,0,size,size);
          const data=context.getImageData(0,0,size,size).data;
          pixels.push({size,opaque:[...data].filter((_,i)=>i%4===3 && data[i]>0).length,cornerAlpha:[data[3],data[(size-1)*4+3],data[(size*size-size)*4+3],data[data.length-1]]});
        }
        const preview=document.createElement('canvas');preview.width=512;preview.height=192;
        const context=preview.getContext('2d');
        context.fillStyle='#f9f9f8';context.fillRect(0,0,256,192);context.fillStyle='#101828';context.fillRect(256,0,256,192);
        for(const offset of [0,256]) {context.drawImage(image,offset+28,48,96,96);context.drawImage(image,offset+152,80,32,32);context.drawImage(image,offset+208,88,16,16);}
        return {pixels,preview:preview.toDataURL('image/png')};
      });
      result.pixels=render.pixels;
      check('16px and 32px icons render with transparent corners', render.pixels.every(p=>p.opaque>p.size*p.size*.3 && p.opaque<p.size*p.size*.95 && p.cornerAlpha.every(a=>a===0)));
      const path=`${evidenceDir}/icon-preview.png`;await writeFile(path,Buffer.from(render.preview.split(',')[1],'base64'));result.preview=path;
    }
    const fallback = await page.evaluate(async () => {
      const image=new Image();image.src='/brand/optimax-starter-32.png';await image.decode();
      const response=await fetch('/favicon.ico'),data=new DataView(await response.arrayBuffer());
      return {width:image.naturalWidth,height:image.naturalHeight,icoStatus:response.status,type:data.getUint16(2,true),count:data.getUint16(4,true),icoWidth:data.getUint8(6),icoHeight:data.getUint8(7)};
    }).catch(error=>({error:String(error)}));
    result.fallback=fallback;
    check('32px PNG and ICO fallback load correctly', fallback.width===32 && fallback.height===32 && fallback.icoStatus===200 && fallback.type===1 && fallback.count===1 && fallback.icoWidth===32 && fallback.icoHeight===32);
    await page.reload();await page.waitForSelector('#password');
    check('reload preserves browser title and icon', await page.title()==='Optimax Starter' && await page.evaluate(()=>!!document.querySelector('link[href="/brand/optimax-starter.svg"]')));
    const path=`${evidenceDir}/login.png`;await page.screenshot({path});screenshots.push({path,url:await page.url(),title:await page.title()});
    result.status=checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
  } catch(error) { result.status='FAIL';result.error=String(error); }
  await writeFile(`${evidenceDir}/results.json`,JSON.stringify(result,null,2));
  return result;
}
