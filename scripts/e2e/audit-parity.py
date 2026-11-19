#!/usr/bin/env python3
"""LC-01 双栈对拍：同一批审计查询打 Hono(38141) 与 Laravel(38142)，响应必须一致。"""
import http.cookiejar, json, os, re, sys, urllib.parse, urllib.request

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split("=", 1) for l in open(os.path.join(root, ".env")) if "=" in l and not l.lstrip().startswith("#"))
pw = env["STARTER_ADMIN_PASSWORD"].strip()
user = env.get("STARTER_ADMIN_USERNAME", "demo@optimax.hk").strip()
ORIGIN = "http://127.0.0.1:38140"

def login(base):
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    req = urllib.request.Request(base + "/console/login", data=json.dumps({"username": user, "password": pw}).encode(),
                                 headers={"Origin": ORIGIN, "Content-Type": "application/json"})
    op.open(req, timeout=10)
    return op

def call(op, base, path):
    req = urllib.request.Request(base + "/console" + urllib.parse.quote(path, safe="?&=/"), headers={"Origin": ORIGIN})
    try:
        with op.open(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

HONO, LARA = "http://127.0.0.1:38141", "http://127.0.0.1:38142"
h, l = login(HONO), login(LARA)
results = []

def norm(status, data, strip_at_ms=True):
    if status != 200 or not isinstance(data, dict):
        return {"status": status, "data": data}
    d = json.loads(json.dumps(data, ensure_ascii=False))
    if strip_at_ms and "items" in d:
        for it in d.get("items", []):
            if "at" in it:
                it["at"] = re.sub(r"\.\d+(Z|\+00:00)$", "Z", it["at"])
    return {"status": status, "keys": sorted(d.keys()), "data": d}

CASES = [
    ("默认分页", "?size=3"),
    ("action 过滤", "?action=profile.update&size=5"),
    ("source 过滤", "?source=human&size=5"),
    ("actor 模糊", "?actor=管理员&size=5"),
    ("时间窗", "?start=2026-11-01&end=2026-11-30&size=5"),
    ("无结果窗口", "?start=2020-01-01&end=2020-01-02"),
    ("start>end 400", "?start=2026-11-30&end=2026-11-01"),
    ("非法 action 400", "?action=not.an.action"),
    ("size 超限收敛", "?size=500"),
    ("page 边界", "?page=100000&size=2"),
]

for name, qs in CASES:
    sh, dh = call(h, HONO, "/audit" + qs)
    sl, dl = call(l, LARA, "/audit" + qs)
    same = norm(sh, dh) == norm(sl, dl)
    detail = "" if same else f"\n  hono={json.dumps(norm(sh, dh), ensure_ascii=False)[:220]}\n  lara={json.dumps(norm(sl, dl), ensure_ascii=False)[:220]}"
    results.append((name, same))
    print(("PASS" if same else "FAIL") + f": {name} ({sh}/{sl}){detail}")

bad = [n for n, ok in results if not ok]
print(json.dumps({"status": "PASS" if not bad else "FAIL", "failed": bad}, ensure_ascii=False))
sys.exit(1 if bad else 0)
