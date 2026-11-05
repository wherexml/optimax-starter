"""Verify actual HTTP sessions against the running local Docker stack."""
import http.cookiejar
import json
import secrets
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
origin = "http://127.0.0.1:38140"
def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(session, method, path, status, data=None):
    request = urllib.request.Request(origin + "/console" + path, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Origin": origin, "Content-Type": "application/json"})
    try:
        response = session.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == status, (method, path, response.status, status)
        return json.load(response)

config = dict(line.split("=", 1) for line in (root / ".env").read_text().splitlines() if "=" in line)
admin, member = client(), client()
call(member, "GET", "/assets", 401)
call(admin, "POST", "/login", 200, {"username":"demo@optimax.hk","password":config["STARTER_ADMIN_PASSWORD"]})
username = "qa_" + secrets.token_hex(8)
credentials = {"username":username,"password":secrets.token_hex(16)}
row = call(admin, "POST", "/accounts", 201, {**credentials,"name":"临时验收","role":"member"})
try:
    call(member, "POST", "/login", 401, {**credentials,"password":"invalid"})
    call(member, "POST", "/login", 200, credentials)
    assert call(member, "GET", "/assets", 200)
    call(member, "GET", "/accounts", 403)
    target = "/accounts/" + str(row["id"])
    call(member, "PATCH", target, 403, {"active":False})
    call(admin, "PATCH", target, 200, {"active":False})
    call(member, "GET", "/assets", 401)
    call(member, "POST", "/login", 401, credentials)
    call(admin, "PATCH", target, 200, {"active":True})
    call(member, "POST", "/login", 200, credentials)
    call(member, "POST", "/logout", 200, {})
    call(member, "GET", "/assets", 401)
    call(admin, "POST", "/logout", 200, {})
    print("PASS: anonymous guard, login, assets, RBAC, disable/revoke, enable, logout")
finally:
    subprocess.run(["docker","compose","exec","-T","db","psql","-v","ON_ERROR_STOP=1","-U","starter","-d","starter"],cwd=root,
        input=f"BEGIN; DELETE FROM console_audit WHERE target_id={int(row['id'])}; DELETE FROM console_session WHERE account={int(row['id'])}; DELETE FROM console_account WHERE id={int(row['id'])} AND username='{username}'; COMMIT;",text=True,check=True,stdout=subprocess.DEVNULL)
