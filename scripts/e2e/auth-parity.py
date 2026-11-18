#!/usr/bin/env python3
"""LC-02 双栈对拍：PATCH /me、密码修改（含跨栈会话撤销验证）、防提权 400。"""
import http.cookiejar, json, os, sys, time, urllib.request

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split("=", 1) for l in open(os.path.join(root, ".env")) if "=" in l and not l.lstrip().startswith("#"))
PW = env["STARTER_ADMIN_PASSWORD"].strip()
USER = env.get("STARTER_ADMIN_USERNAME", "demo@optimax.hk").strip()
ORIGIN = "http://127.0.0.1:38140"
results = []

def call(op, base, path, method="GET", body=None, origin=ORIGIN):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + "/console" + path, data=data, method=method,
                                 headers={"Origin": origin, **({"Content-Type": "application/json"} if method != "GET" else {})})
    try:
        with op.open(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def session(base):
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return op

def login(op, base, password=PW):
    return call(op, base, "/login", "POST", {"username": USER, "password": password})

def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL") + f": {name} {detail}")

HONO, LARA = "http://127.0.0.1:38141", "http://127.0.0.1:38142"
stamp = str(int(time.time()))

# 1) PATCH /me 双栈：各自改 company，响应形状一致
for tag, base in (("hono", HONO), ("lara", LARA)):
    op = session(base)
    login(op, base)
    s, d = call(op, base, "/me", "PATCH", {"company": f"对拍{tag}{stamp}"})
    shape_ok = s == 200 and d.get("company") == f"对拍{tag}{stamp}" and sorted(d.keys()) == ["active","company","email","id","name","permissions","role","username"]
    check(f"PATCH /me 形状（{tag}）", shape_ok, json.dumps(d, ensure_ascii=False)[:120] if not shape_ok else "")

# 2) 防提权：role 注入 → 400
for tag, base in (("hono", HONO), ("lara", LARA)):
    op = session(base)
    login(op, base)
    s, d = call(op, base, "/me", "PATCH", {"role": "super_admin", "name": "x"})
    check(f"role 注入 400（{tag}）", s == 400, json.dumps(d, ensure_ascii=False)[:100])

# 3) 密码修改跨栈互作：经 HONO 改密 → HONO 会话死 + Laravel 旧会话死（共享 DB）→ 新密可登两栈 → 再经 Laravel 改回
NEW_PW = f"Parity#{stamp}x!"

def restore_original_password():
    """失败也要把演示密码恢复原值（改密流程曾在失败后遗留中间值）。"""
    for base in (LARA, HONO):
        op = session(base)
        st, _ = login(op, base, NEW_PW)
        if st == 200:
            call(op, base, "/me/password", "POST", {"current": NEW_PW, "password": PW})
            return
    # NEW_PW 已不可登录（说明原密已恢复或从未生效）——无需处理。

try:
    op_h, op_l = session(HONO), session(LARA)
    login(op_h, HONO)
    login(op_l, LARA)
    s, d = call(op_h, HONO, "/me/password", "POST", {"current": PW, "password": NEW_PW})
    check("HONO 改密 {ok,revoked>=1}", s == 200 and d.get("ok") and d.get("revoked", 0) >= 1, json.dumps(d, ensure_ascii=False)[:100])
    s1, _ = call(op_h, HONO, "/me")
    check("HONO 改密后旧会话 401", s1 == 401)
    s2, _ = call(op_l, LARA, "/me")
    check("Laravel 旧会话同库同死 401", s2 == 401)
    s3, d3 = login(session(LARA), LARA, NEW_PW)
    check("新密码可登 Laravel", s3 == 200)
    s4, d4 = call(session(HONO), HONO, "/login", "POST", {"username": USER, "password": NEW_PW})
    check("新密码可登 HONO", s4 == 200)

    # 4) 错当前密码 400
    op = session(LARA); login(op, LARA, NEW_PW)
    s, d = call(op, LARA, "/me/password", "POST", {"current": "wrong-current-1", "password": "Another#2026x!"})
    check("当前密码错误 400", s == 400 and d.get("error") == "当前密码错误", json.dumps(d, ensure_ascii=False)[:80])

    # 5) 同密码 400
    s, d = call(op, LARA, "/me/password", "POST", {"current": NEW_PW, "password": NEW_PW})
    check("新旧相同 400", s == 400 and d.get("error") == "新密码不能与当前密码相同", json.dumps(d, ensure_ascii=False)[:80])

    # 6) 经 Laravel 改回原密
    s, d = call(op, LARA, "/me/password", "POST", {"current": NEW_PW, "password": PW})
    check("Laravel 改回原密 {ok}", s == 200 and d.get("ok") is True, json.dumps(d, ensure_ascii=False)[:80])
    s, _ = login(session(HONO), HONO, PW)
    check("原密恢复可登 HONO", s == 200)
finally:
    # 双保险：无论中途哪步失败都尝试恢复原密码。
    _, probe = call(session(HONO), HONO, "/login", "POST", {"username": USER, "password": PW})
    restore_original_password()

bad = [n for n, ok in results if not ok]
print(json.dumps({"status": "PASS" if not bad else "FAIL", "failed": bad}, ensure_ascii=False))
sys.exit(1 if bad else 0)
