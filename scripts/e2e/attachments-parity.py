#!/usr/bin/env python3
"""LD-02 附件模块 E2E：local 盘全链路 + S3 兼容（Garage，OSS 同驱动）对拍。"""
import hashlib, http.cookiejar, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split("=", 1) for l in open(os.path.join(ROOT, ".env")) if "=" in l and not l.lstrip().startswith("#"))
PW = env["STARTER_ADMIN_PASSWORD"].strip()
ORIGIN = "http://127.0.0.1:38140"
results = []

def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL") + f": {name} {detail if not ok else ''}")

def session():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(op, base, path, method="GET", data=None, headers=None):
    req = urllib.request.Request(base + "/console" + path, data=data, method=method,
        headers={"Origin": ORIGIN, **({"Content-Type": "application/json"} if method != "GET" else {}), **(headers or {})})
    try:
        with op.open(req, timeout=20) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def login(base, password=PW, username="demo@optimax.hk"):
    op = session()
    s, _ = call(op, base, "/login", "POST", json.dumps({"username": username, "password": password}).encode())
    assert s == 200, f"login {base} -> {s}"
    return op

def upload(op, base, payload, name, mime="text/plain"):
    boundary = "----ld02boundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(base + "/console/attachments", data=body, method="POST", headers={
        "Origin": ORIGIN, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with op.open(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def fetch_bytes(op, url):
    req = urllib.request.Request(url, headers={"Origin": ORIGIN})
    with op.open(req, timeout=20) as r:
        return r.status, r.read()

def run_phase(base, tag, payload):
    op = login(base)
    sha = hashlib.sha256(payload).hexdigest()
    s, d = upload(op, base, payload, f"ld02-{tag}.txt")
    check(f"{tag} 上传 201", s == 201 and d.get("size") == len(payload) and d.get("mime") == "text/plain",
          json.dumps(d, ensure_ascii=False)[:180])
    aid = d.get("id")
    s, lst = call(op, base, "/attachments")
    row = next((x for x in lst.get("items", []) if x.get("id") == aid), None)
    check(f"{tag} 列表可见(uploadedByUsername)", row is not None and row.get("uploadedByUsername") == "demo@optimax.hk",
          json.dumps(lst, ensure_ascii=False)[:160])
    s, u = call(op, base, f"/attachments/{aid}/url")
    check(f"{tag} 签名 URL 形状", s == 200 and sorted(u.keys()) == ["expiresAt", "url"], json.dumps(u, ensure_ascii=False)[:200])
    s2, blob = fetch_bytes(op, u["url"])
    check(f"{tag} 下载 sha256 字节一致", s2 == 200 and hashlib.sha256(blob).hexdigest() == sha)
    s, _ = call(op, base, f"/attachments/{aid}", "DELETE", b"")
    check(f"{tag} 删除 200", s == 200)
    s, a = call(op, base, "/audit?action=attachment.delete&size=1")
    row = a.get("items", [{}])[0]
    check(f"{tag} 审计 attachment.delete(AT 编号+size)",
          row.get("targetUsername") == f"AT-{aid:03d}" and row.get("detail", {}).get("size") == len(payload),
          json.dumps(row, ensure_ascii=False)[:180])
    s, lst = call(op, base, "/attachments?size=100")
    check(f"{tag} 删除后列表无残留", all(x.get("name") != f"ld02-{tag}.txt" for x in lst.get("items", [])))

# ---- Phase local（web→Laravel 主栈，ATTACHMENT_DISK=local）----
payload = ("LD-02 附件对拍 local 盘\n").encode() * 64
run_phase("http://127.0.0.1:38140", "local", payload)

# 白名单拒绝：可执行扩展名（mimes 规则）
op = login("http://127.0.0.1:38140")
s, d = upload(op, "http://127.0.0.1:38140", b"#!/bin/sh\n", "evil.sh")
check("扩展名白名单 400", s == 400 and "仅支持" in str(d), json.dumps(d, ensure_ascii=False)[:100])

# member 越权 403
op_m = login("http://127.0.0.1:38140", password="Member#2026x!", username="lb03_member")
s, d = upload(op_m, "http://127.0.0.1:38140", b"x", "member.txt")
check("member 上传 403", s == 403, json.dumps(d, ensure_ascii=False)[:100])

# ---- Phase s3（Garage，一次性容器，与生产 OSS 同一 S3 驱动）----
keys = dict(l.split("=", 1) for l in open(os.path.join(ROOT, "scripts/e2e/fixtures/garage/keys.env")).read().splitlines() if "=" in l)
K, S = keys["ATTACHMENT_S3_KEY"], keys["ATTACHMENT_S3_SECRET"]
subprocess.run(["docker", "rm", "-f", "laravel-s3-e2e"], capture_output=True)
cmd = ["docker", "run", "-d", "--name", "laravel-s3-e2e", "--network", "optimax-starter-preview_default",
    "-v", f"{ROOT}/apps/api-laravel:/var/www/html",
    "-v", f"{ROOT}/packages/api/json-schema:/var/www/html/storage/contracts",
    "-p", "127.0.0.1:38480:8080",
    "-e", "APP_ENV=local", "-e", "APP_DEBUG=false", "-e", "LOG_LEVEL=warning",
    "-e", "SESSION_COOKIE_NAME=optimax_console", "-e", "STARTER_SEED_DEMO=true",
    "-e", f"DATABASE_URL=postgres://starter:{env['STARTER_DB_PASSWORD'].strip()}@db:5432/starter",
    "-e", "CONTRACTS_DIR=/var/www/html/storage/contracts",
    "-e", "ATTACHMENT_DISK=s3",
    "-e", f"ATTACHMENT_S3_KEY={K}", "-e", f"ATTACHMENT_S3_SECRET={S}",
    "-e", "ATTACHMENT_S3_BUCKET=starter-attachments",
    "-e", f"ATTACHMENT_S3_ENDPOINT=http://192.168.0.187:38470",
    "-e", "CACHE_STORE=file", "-e", "PHP_CLI_SERVER_WORKERS=2",
    "optimax-starter-laravel:local",
    "sh", "-ec", "cd public && exec php -S 0.0.0.0:8080 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"]
r = subprocess.run(cmd, capture_output=True, text=True)
assert r.returncode == 0, r.stderr[:200]
try:
    time.sleep(8)
    payload2 = ("LD-02 附件对拍 s3/Garage 盘\n").encode() * 96
    run_phase("http://127.0.0.1:38480", "s3", payload2)
finally:
    subprocess.run(["docker", "rm", "-f", "laravel-s3-e2e"], capture_output=True)

bad = [n for n, ok in results if not ok]
print(json.dumps({"status": "PASS" if not bad else "FAIL", "failed": bad}, ensure_ascii=False))
sys.exit(1 if bad else 0)
