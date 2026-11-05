"""Real local Docker HTTP journey. Retains one fixture for browser QA; --cleanup removes only it."""
import http.cookiejar,urllib.request,urllib.error,json,secrets,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];STATE=Path('/tmp/optimax-easm-fixture.json');ORIGIN='http://127.0.0.1:38140'
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(s,method,path,code=200,data=None):
 r=urllib.request.Request(ORIGIN+'/console'+path,method=method,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':ORIGIN})
 try:res=s.open(r,timeout=20)
 except urllib.error.HTTPError as e:res=e
 with res:
  raw=res.read().decode();assert res.status==code,(method,path,res.status,code,raw[:180]);return json.loads(raw) if 'json' in res.headers.get('Content-Type','') else raw
def login(s,u,p,code=200):return call(s,'POST','/login',code,{'username':u,'password':p})
def sql(q):
 r=subprocess.run(['docker','compose','exec','-T','db','psql','-v','ON_ERROR_STOP=1','-U','starter','-d','starter'],cwd=ROOT,input=q,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout
if '--cleanup' in sys.argv:
 f=json.loads(STATE.read_text());u=f['username'];i=int(f['id']);assert u.startswith('qa_easm_') and u.replace('_','').isalnum()
 sql(f"BEGIN; DELETE FROM console_audit WHERE (target_id={i} AND target_username='{u}') OR (actor_id={i} AND actor_username='{u}'); DELETE FROM console_session WHERE account={i}; DELETE FROM console_account WHERE id={i} AND username='{u}'; COMMIT;");STATE.unlink();print('PASS fixture cleanup');sys.exit()
assert not STATE.exists(),'Existing fixture needs cleanup'
a,m,m2=client(),client(),client();login(a,'demo@optimax.hk','demo@2026!');u='qa_easm_'+secrets.token_hex(5);pw=secrets.token_hex(14)
r=call(a,'POST','/accounts',201,{'username':u,'name':'设置验收成员','password':pw,'role':'member'});f={'id':r['id'],'username':u,'password':pw};STATE.write_text(json.dumps(f));STATE.chmod(0o600)
login(m,u,pw);login(m2,u,pw)
call(m,'PATCH','/me',data={'name':'设置验收成员','email':'qa@example.invalid','company':'OptiMax QA'})
r=call(m,'GET','/me');assert r['email']=='qa@example.invalid' and r['company']=='OptiMax QA'
call(m,'PATCH','/me',400,{'name':'x','role':'admin'});call(m,'PATCH','/me',400,{'email':'bad-email'});call(m,'GET','/accounts',403);call(m,'GET','/audit',403)
print('PASS profile persistence, input validation and member access boundaries')
# Keys align with API contract; no credentials written to evidence.
def change(old,new,code=200):return call(m,'POST','/me/password',code,{'current':old,'password':new})
new=secrets.token_hex(14);before=call(a,'GET','/audit')['total']
change('wrong-current',new,400);change(pw,'short',400);change(pw,pw,400)
assert call(a,'GET','/audit')['total']==before
call(m,'GET','/me');call(m2,'GET','/me')
change(pw,new);f['password']=new;STATE.write_text(json.dumps(f));call(m,'GET','/me',401);call(m2,'GET','/me',401);login(client(),u,pw,401);login(m,u,new)
logs=call(a,'GET','/audit?size=100');mine=[x for x in logs['items'] if x['actorId']==f['id']]
assert any(x['action']=='profile.password_change' for x in mine)
raw=json.dumps(mine);assert pw not in raw and new not in raw and 'qa@example.invalid' not in raw
print('PASS wrong/weak/same password rejection, all-session revocation, old/new login and audit secret exclusion')
call(a,'POST','/logout',data={});call(m,'POST','/logout',data={})
print('Retained temporary member for browser QA')
