import http.cookiejar,urllib.request,urllib.error,json,secrets,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ORIGIN='http://127.0.0.1:38140'
def client():
 return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(s, method, path, code=200, data=None):
 r=urllib.request.Request(ORIGIN+'/console'+path,method=method,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':ORIGIN})
 try:resp=s.open(r,timeout=15)
 except urllib.error.HTTPError as e:resp=e
 with resp:
  body=resp.read().decode();assert resp.status==code,(method,path,resp.status,code,body[:200]);return json.loads(body) if resp.headers.get("Content-Type","").startswith("application/json") else body
def login(s,user='demo@optimax.hk',password='demo@2026!'):
 return call(s,'POST','/login',data={'username':user,'password':password})
def no_secrets(value, generated_password):
 if isinstance(value,dict):
  assert not set(value)&{'hash','password','token','cookie'},value.keys()
  for item in value.values():no_secrets(item,generated_password)
 elif isinstance(value,list):
  for item in value:no_secrets(item,generated_password)
 else:assert generated_password not in str(value)

import sys,os,datetime
from urllib.parse import urlencode
STATE=Path("/tmp/optimax-foundation-fixture.json")
def sql(statement):
 result=subprocess.run(["docker","compose","exec","-T","db","psql","-v","ON_ERROR_STOP=1","-U","starter","-d","starter"],cwd=ROOT,input=statement,text=True,capture_output=True)
 assert result.returncode==0,result.stderr
 return result.stdout
if "--cleanup" in sys.argv:
 f=json.loads(STATE.read_text())
 assert f["username"].startswith("qa_foundation_") and f["username"].replace("_","").isalnum()
 ident=int(f["id"]); user=f["username"]
 sql(f"BEGIN; DELETE FROM console_audit WHERE (target_id={ident} AND target_username='{user}') OR (actor_id={ident} AND actor_username='{user}'); DELETE FROM console_session WHERE account={ident}; DELETE FROM console_account WHERE id={ident} AND username='{user}'; COMMIT;")
 STATE.unlink()
 print("PASS removed only this run's temporary account, sessions and audit fixtures")
 sys.exit()
assert not STATE.exists(),"Clean previous fixture first"
a,m=client(),client()
call(m,"GET","/audit",401)
login(a)
u="qa_foundation_"+secrets.token_hex(5); pw=secrets.token_hex(14)
row=call(a,"POST","/accounts",201,{"username":u,"name":"功能验收成员","password":pw,"role":"member"})
fixture={"id":row["id"],"username":u,"password":pw}
STATE.write_text(json.dumps(fixture));STATE.chmod(0o600)
path="/accounts/"+str(row["id"])
login(m,u,pw);call(m,"GET","/audit",403)
call(m,"POST","/accounts",403,{"username":"x","name":"x","password":pw,"role":"admin"})
call(m,"PATCH","/me",data={"name":"成员自行改名"})
call(a,"PATCH",path,data={"name":"功能验收账户"})
call(a,"PATCH",path,data={"role":"admin"})
call(a,"PATCH",path,data={"role":"member"})
call(a,"POST",path+"/revoke",data={});call(m,"GET","/me",401)
call(a,"POST",path+"/password",data={"password":pw+"N"})
fixture["password"]=pw+"N";STATE.write_text(json.dumps(fixture))
login(m,u,pw+"N")
call(a,"PATCH",path,data={"active":False});call(m,"GET","/me",401)
call(a,"PATCH",path,data={"active":True})
logs=call(a,"GET","/audit?size=100")
mine=[r for r in logs["items"] if r["targetId"]==row["id"]]
expected={"profile.update","account.create","account.update","account.role","account.status","account.password_reset","account.revoke"}
assert expected.issubset({r["action"] for r in mine}),mine
no_secrets(logs,pw)
before=logs["total"]
call(a,"POST","/accounts",409,{"username":u,"name":"重复","password":pw,"role":"member"})
assert call(a,"GET","/audit?size=100")["total"]==before
# Force only this fixture's audit insert to fail and check the account write rolls back.
ident=int(row["id"])
sql(f"""CREATE FUNCTION foundation_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_id={ident} AND NEW.detail->>'to'='ROLLBACK_SENTINEL' THEN RAISE EXCEPTION 'qa audit failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER foundation_qa_reject BEFORE INSERT ON console_audit FOR EACH ROW EXECUTE FUNCTION foundation_qa_reject();""")
try:
 call(a,"PATCH",path,500,{"name":"ROLLBACK_SENTINEL"})
 assert next(r for r in call(a,"GET","/accounts") if r["id"]==ident)["name"]=="功能验收账户"
 assert call(a,"GET","/audit")["total"]==before
finally:
 sql("DROP TRIGGER foundation_qa_reject ON console_audit; DROP FUNCTION foundation_qa_reject();")
one=call(a,"GET","/audit?size=2&page=1");two=call(a,"GET","/audit?size=2&page=2")
assert len(one["items"])==len(two["items"])==2
assert not {r["id"] for r in one["items"]}&{r["id"] for r in two["items"]}
filtered=call(a,"GET","/audit?"+urlencode({"action":"account.role","actor":"demo@optimax.hk","size":100}))
assert filtered["items"] and all(r["action"]=="account.role" and r["actorUsername"]=="demo@optimax.hk" for r in filtered["items"])
today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()
assert call(a,"GET","/audit?"+urlencode({"start":today,"end":today}))["total"]>0
for query in ("start=2026-02-30","start=2026-11-06&end=2026-11-05","page=0","action=invalid"):
 call(a,"GET","/audit?"+query,400)
assert call(a,"GET","/audit?size=9999")["size"]==100
call(a,"POST","/logout",data={})
print("PASS audit actions, member denial, secret exclusion, duplicate rejection, transaction rollback, filters, date bounds and pagination")
print("Temporary fixture retained for browser QA; run this script with --cleanup afterwards")
