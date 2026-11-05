"""Authenticated HTTP concurrency journey against local Docker, without mutating business records."""
import urllib.request,json,concurrent.futures,time
BASE='http://127.0.0.1:38140'
r=urllib.request.Request(BASE+'/console/login',data=json.dumps({'username':'demo@optimax.hk','password':'demo@2026!'}).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
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
