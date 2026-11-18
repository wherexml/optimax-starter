#!/usr/bin/env python3
"""LC-03/04 双栈对拍：system status / settings / permissions 矩阵读写恢复 / 熔断 / 越权 403。"""
import http.cookiejar, json, os, sys, time, urllib.parse, urllib.request

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split("=", 1) for l in open(os.path.join(root, ".env")) if "=" in l and not l.lstrip().startswith("#"))
PW = env["STARTER_ADMIN_PASSWORD"].strip()
USER = env.get("STARTER_ADMIN_USERNAME", "demo@optimax.hk").strip()
ORIGIN = "http://127.0.0.1:38140"
MEMBER_PW = "Member#2026x!"
HONO, LARA = "http://127.0.0.1:38141", "http://127.0.0.1:38142"
results = []

def session():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(op, base, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + "/console" + urllib.parse.quote(path, safe="?&=/."), data=data, method=method,
                                 headers={"Origin": ORIGIN, **({"Content-Type": "application/json"} if method != "GET" else {})})
    try:
        with op.open(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def login(base, password=PW, username=USER):
    op = session()
    s, _ = call(op, base, "/login", "POST", {"username": username, "password": password})
    assert s == 200, f"login {base} failed {s}"
    return op

def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL") + f": {name} {detail if not ok else ''}")

def strip_volatile(d, keys):
    d = json.loads(json.dumps(d, ensure_ascii=False))
    for k in keys:
        if isinstance(d, dict) and k in d:
            d.pop(k, None)
    return d

h, l = login(HONO), login(LARA)

# 1) status：形状 + 归一化对比（checkedAt/dbLatencyMs/uptimeSec/nodeVersion 为运行态值）
sh, dh = call(h, HONO, "/system/status")
sl, dl = call(l, LARA, "/system/status")
ok = sh == sl == 200 and sorted(dh.keys()) == sorted(dl.keys()) == ["ai", "checkedAt", "overall", "probe"] \
    and sorted(dh["probe"].keys()) == sorted(dl["probe"].keys()) \
    and dh["probe"]["db"] == dl["probe"]["db"] == "ok" \
    and dl["probe"]["activeSessions"] >= 0 \
    and sorted(dh["ai"].keys()) == sorted(dl["ai"].keys()) \
    and dh["ai"]["configMode"] == dl["ai"]["configMode"] == "disabled" \
    and dh["ai"]["circuitOpen"] == dl["ai"]["circuitOpen"]
check("system/status 形状与探针", ok, f"{json.dumps(dl, ensure_ascii=False)[:200]}")

# 2) settings：完整对比
sh, dh = call(h, HONO, "/system/settings")
sl, dl = call(l, LARA, "/system/settings")
check("system/settings 一致", sh == sl == 200 and dh == dl, f"{json.dumps(dl, ensure_ascii=False)[:200]}")

# 3) permissions 读：完整对比
sh, dh = call(h, HONO, "/system/permissions")
sl, dl = call(l, LARA, "/system/permissions")
norm = lambda d: strip_volatile(d, ["updatedAt"])
check("system/permissions 一致", sh == sl == 200 and norm(dh) == norm(dl), f"hono={json.dumps(norm(dh), ensure_ascii=False)[:150]} lara={json.dumps(norm(dl), ensure_ascii=False)[:150]}")

# 4) 矩阵写：经 Laravel 关掉 member 的 assets:read → 双栈读一致 → HONO reset → 双栈默认
s, w = call(l, LARA, "/system/permissions", "PUT", {"roles": {"member": ["workbench:read"]}})
sh, dh = call(h, HONO, "/system/permissions")
sl, dl = call(l, LARA, "/system/permissions")
ok = s == 200 and norm(w) == norm(dl) and dh["roles"]["member"] == dl["roles"]["member"] == ["workbench:read"]
check("矩阵写（Laravel）双栈读一致", ok)
s, r = call(h, HONO, "/system/permissions/reset", "POST")
sh, dh = call(h, HONO, "/system/permissions")
sl, dl = call(l, LARA, "/system/permissions")
check("HONO reset 后双栈默认一致", s == 200 and dh["roles"]["member"] == dl["roles"]["member"])

# 5) 经 Laravel reset 也一致（对称验证）
call(l, LARA, "/system/permissions", "PUT", {"roles": {"member": ["workbench:read"]}})
s, r = call(l, LARA, "/system/permissions/reset", "POST")
sh, dh = call(h, HONO, "/system/permissions")
sl, dl = call(l, LARA, "/system/permissions")
check("Laravel reset 双栈默认一致", s == 200 and norm(dh) == norm(dl))

# 6) 超管独占码注入 member → 422 同文案
sh, dh = call(h, HONO, "/system/permissions", "PUT", {"roles": {"member": ["system:permission:manage"]}})
sl, dl = call(l, LARA, "/system/permissions", "PUT", {"roles": {"member": ["system:permission:manage"]}})
check("超管独占码 422 同文案", sh == sl == 422 and dh == dl, f"hono={dh} lara={dl}")

# 7) 未知权限码 422
sh, dh = call(h, HONO, "/system/permissions", "PUT", {"roles": {"admin": ["nope:read"]}})
sl, dl = call(l, LARA, "/system/permissions", "PUT", {"roles": {"admin": ["nope:read"]}})
check("未知权限码 422 同文案", sh == sl == 422 and dh == dl, f"hono={dh} lara={dl}")

# 8) 时区写（Laravel）→ 双栈 settings 一致 → HONO 写回默认
s, w = call(l, LARA, "/system/settings", "PUT", {"timezone": "Asia/Tokyo"})
time.sleep(2.5)  # 两侧 2s 设置缓存窗口。
sh, dh = call(h, HONO, "/system/settings")
sl, dl = call(l, LARA, "/system/settings")
ok = s == 200 and dh["timezone"] == dl["timezone"] == "Asia/Tokyo" and dh["timezoneLabel"] == dl["timezoneLabel"]
check("时区写双栈一致", ok, f"hono={json.dumps(dh, ensure_ascii=False)[:180]} lara={json.dumps(dl, ensure_ascii=False)[:180]}")
call(h, HONO, "/system/settings", "PUT", {"timezone": "Asia/Shanghai"})

# 9) 熔断：Laravel 开→关 循环，双栈 circuitOpen 同步（共享库）
s, c1 = call(l, LARA, "/system/ai-circuit", "PATCH", {"enabled": False})
time.sleep(2.5)  # HONO 侧 2s 快照缓存。
sh, dh = call(h, HONO, "/system/status")
sl, dl = call(l, LARA, "/system/status")
ok = s == 200 and c1.get("ok") is True and c1["circuitOpen"] is True and dh["ai"]["circuitOpen"] == dl["ai"]["circuitOpen"] is True
check("熔断开双栈同视", ok)
s, c2 = call(l, LARA, "/system/ai-circuit", "PATCH", {"enabled": True})
time.sleep(2.5)
sh, dh = call(h, HONO, "/system/status")
sl, dl = call(l, LARA, "/system/status")
check("熔断恢复双栈同视", s == 200 and dh["ai"]["circuitOpen"] == dl["ai"]["circuitOpen"] is False)

# 10) member 越权：系统权限路由 403 需要超级管理员权限；status 无权限 403 无权执行该操作
op_m = login(LARA, MEMBER_PW, username="lb03_member")
s, d = call(op_m, LARA, "/system/permissions")
check("member 访问系统权限 403", s == 403 and d.get("error") == "需要超级管理员权限", json.dumps(d, ensure_ascii=False)[:80])
s, d = call(op_m, LARA, "/system/status")
check("member 访问 status 403", s == 403 and d.get("error") == "无权执行该操作", json.dumps(d, ensure_ascii=False)[:80])

bad = [n for n, ok in results if not ok]
print(json.dumps({"status": "PASS" if not bad else "FAIL", "failed": bad}, ensure_ascii=False))
sys.exit(1 if bad else 0)
