"""Authenticated HTTP concurrency journey against local Docker, without mutating business records."""
import urllib.request,json,concurrent.futures,time,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CFG=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines() if '=' in line and not line.lstrip().startswith('#')) if (ROOT/'.env').exists() else {}
WEB_PORT=os.environ.get('WEB_PORT') or CFG.get('WEB_PORT','38140')
BASE=os.environ.get('CORS_ORIGIN') or CFG.get('CORS_ORIGIN') or f'http://127.0.0.1:{WEB_PORT}'
ADMIN_USER=os.environ.get('STARTER_ADMIN_USERNAME') or CFG.get('STARTER_ADMIN_USERNAME','demo@optimax.hk')
ADMIN_PW=os.environ.get('STARTER_ADMIN_PASSWORD') or CFG.get('STARTER_ADMIN_PASSWORD','demo@2026!')
r=urllib.request.Request(BASE+'/console/login',data=json.dumps({'username':ADMIN_USER,'password':ADMIN_PW}).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
with urllib.request.urlopen(r,timeout=20) as res:
 assert res.status==200
 cookie=res.headers['Set-Cookie'].split(';',1)[0]
paths=['/me','/assets','/accounts','/audit?size=5']
def hit(i):
 req=urllib.request.Request(BASE+'/console'+paths[i%len(paths)],headers={'Cookie':cookie})
 with urllib.request.urlopen(req,timeout=20) as res:
  assert res.status==200
  data=json.loads(res.read());assert data is not None
 return 1
start=time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:total=sum(pool.map(hit,range(1200)))
print(f'PASS {total} authenticated requests, 8 workers, {time.monotonic()-start:.1f}s, all valid JSON')
req=urllib.request.Request(BASE+'/console/logout',data=b'{}',headers={'Cookie':cookie,'Origin':BASE,'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=20) as res:assert res.status==200
