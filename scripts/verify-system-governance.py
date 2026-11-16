"""Verify 3-tier RBAC, privilege escalation defenses, role permission matrix, system status/timezone/AI circuit breaker, transaction rollback, and human/agent audit filtering."""
import http.cookiejar
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = (
    dict(
        line.split("=", 1)
        for line in (ROOT / ".env").read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )
    if (ROOT / ".env").exists()
    else {}
)
WEB_PORT = os.environ.get("WEB_PORT") or CFG.get("WEB_PORT", "38140")
API_PORT = os.environ.get("API_PORT") or CFG.get("API_PORT", "38141")
ORIGIN = (
    os.environ.get("CORS_ORIGIN")
    or CFG.get("CORS_ORIGIN")
    or f"http://127.0.0.1:{WEB_PORT}"
)
SUPER_USER = os.environ.get("STARTER_ADMIN_USERNAME") or CFG.get(
    "STARTER_ADMIN_USERNAME", "demo@optimax.hk"
)
SUPER_PW = os.environ.get("STARTER_ADMIN_PASSWORD") or CFG["STARTER_ADMIN_PASSWORD"]


def client():
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )


def call(session, method, path, status=200, data=None):
    req = urllib.request.Request(
        ORIGIN + "/console" + path,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers=(
            {}
            if method == "GET"
            else {"Origin": ORIGIN, "Content-Type": "application/json"}
        ),
    )
    try:
        res = session.open(req, timeout=15)
    except urllib.error.HTTPError as err:
        res = err
    with res:
        raw = res.read().decode("utf-8", "replace")
        assert res.status == status, (method, path, res.status, status, raw[:220])
        return (
            json.loads(raw)
            if "application/json" in res.headers.get("Content-Type", "")
            else raw
        )


def sql(statement: str) -> str:
    proc = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "starter",
            "-d",
            "starter",
        ],
        cwd=ROOT,
        input=statement,
        text=True,
        capture_output=True,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout


with urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/healthz", timeout=10) as hz:
    hz_body = json.load(hz)
    assert hz.status == 200 and set(hz_body.keys()) <= {"status", "db"}

sa = client()
adm = client()
adm2 = client()
mem = client()

call(sa, "POST", "/login", 200, {"username": SUPER_USER, "password": SUPER_PW})
me_sa = call(sa, "GET", "/me", 200)
assert me_sa["role"] == "super_admin" and "system:permission:manage" in me_sa["permissions"]

suffix = secrets.token_hex(5)
pw = "Gov@" + secrets.token_hex(12)
created_ids: list[int] = []
created_usernames: list[str] = []

try:
    u_adm = f"qa_gov_adm_{suffix}"
    u_sa2 = f"qa_gov_sa2_{suffix}"
    u_mem = f"qa_gov_mem_{suffix}"
    u_mem2 = f"qa_gov_m2_{suffix}"

    r_adm = call(
        sa,
        "POST",
        "/accounts",
        201,
        {"username": u_adm, "name": "治理验收管理员", "password": pw, "role": "admin"},
    )
    created_ids.append(r_adm["id"])
    created_usernames.append(u_adm)

    r_sa2 = call(
        sa,
        "POST",
        "/accounts",
        201,
        {"username": u_sa2, "name": "协管超管", "password": pw, "role": "super_admin"},
    )
    created_ids.append(r_sa2["id"])
    created_usernames.append(u_sa2)

    r_mem = call(
        sa,
        "POST",
        "/accounts",
        201,
        {"username": u_mem, "name": "治理验收成员", "password": pw, "role": "member"},
    )
    created_ids.append(r_mem["id"])
    created_usernames.append(u_mem)

    call(adm, "POST", "/login", 200, {"username": u_adm, "password": pw})
    call(adm2, "POST", "/login", 200, {"username": u_sa2, "password": pw})
    call(mem, "POST", "/login", 200, {"username": u_mem, "password": pw})

    # 1. Ordinary admin escalation redlines
    call(
        adm,
        "POST",
        "/accounts",
        403,
        {"username": f"x_{suffix}", "name": "越权管理员", "password": pw, "role": "admin"},
    )
    call(
        adm,
        "POST",
        "/accounts",
        403,
        {
            "username": f"y_{suffix}",
            "name": "越权超管",
            "password": pw,
            "role": "super_admin",
        },
    )
    # Ordinary admin CAN create ordinary member
    r_mem2 = call(
        adm,
        "POST",
        "/accounts",
        201,
        {"username": u_mem2, "name": "管理员建成员", "password": pw, "role": "member"},
    )
    created_ids.append(r_mem2["id"])
    created_usernames.append(u_mem2)

    # Ordinary admin cannot promote member or touch super_admin
    call(adm, "PATCH", f"/accounts/{r_mem['id']}", 403, {"role": "admin"})
    call(adm, "PATCH", f"/accounts/{r_sa2['id']}", 403, {"name": "越权改超管"})
    call(adm, "PATCH", f"/accounts/{r_sa2['id']}", 403, {"active": False})
    call(adm, "POST", f"/accounts/{r_sa2['id']}/password", 403, {"password": pw + "X"})
    call(adm, "POST", f"/accounts/{r_sa2['id']}/revoke", 403, {})

    # Core bootstrap super_admin cannot be disabled or demoted even by another super_admin
    call(adm2, "PATCH", f"/accounts/{me_sa['id']}", 403, {"active": False})
    call(adm2, "PATCH", f"/accounts/{me_sa['id']}", 403, {"role": "admin"})

    # 2. Permission matrix access & immutable super_admin enforcement
    call(mem, "GET", "/system/permissions", 403)
    call(adm, "GET", "/system/permissions", 403)
    call(adm, "PUT", "/system/permissions", 403, {"roles": {"member": ["workbench:read"]}})
    call(adm, "POST", "/system/permissions/reset", 403, {})

    matrix = call(sa, "GET", "/system/permissions", 200)
    full_sa_codes = matrix["immutable"]["super_admin"]
    assert matrix["roles"]["super_admin"] == full_sa_codes

    # Spoofing super_admin-only permission onto admin/member must return 422
    call(
        sa,
        "PUT",
        "/system/permissions",
        422,
        {"roles": {"admin": ["workbench:read", "system:permission:manage"]}},
    )
    call(
        sa,
        "PUT",
        "/system/permissions",
        422,
        {"roles": {"member": ["workbench:read", "system:ai:manage"]}},
    )

    # Submitting shrunk super_admin array keeps super_admin at full permissions;
    # meanwhile remove assets:read from member, remove assets:manage from admin, and grant system:settings:manage to admin
    custom_admin = [
        "workbench:read",
        "assets:read",
        "accounts:read",
        "system:settings:read",
        "system:settings:manage",
        "system:ai:read",
        "audit:read",
    ]
    updated_matrix = call(
        sa,
        "PUT",
        "/system/permissions",
        200,
        {
            "roles": {
                "super_admin": ["workbench:read"],
                "member": ["workbench:read"],
                "admin": custom_admin,
            }
        },
    )
    assert updated_matrix["roles"]["super_admin"] == full_sa_codes
    assert "assets:read" not in updated_matrix["roles"]["member"]

    # Member immediately loses access to /assets AND /assets/agent/*
    call(mem, "GET", "/assets", 403)
    call(mem, "GET", "/assets/page", 403)
    call(mem, "GET", "/assets/agent/config", 403)
    call(mem, "POST", "/assets/agent/plan", 403, {"instruction": "待复核", "current": {}})

    # Admin keeps GET /assets (200) but loses POST /assets (403) and POST /accounts (403)
    call(adm, "GET", "/assets", 200)
    call(
        adm,
        "POST",
        "/assets",
        403,
        {"name": f"asset_{suffix}", "domain": "采购", "owner": "平台组", "stage": "待复核"},
    )
    call(
        adm,
        "POST",
        "/accounts",
        403,
        {"username": f"z_{suffix}", "name": "无维护权", "password": pw, "role": "member"},
    )
    # Admin WAS granted system:settings:manage, so PUT /system/settings now succeeds!
    tz_res = call(adm, "PUT", "/system/settings", 200, {"timezone": "UTC"})
    assert tz_res["timezone"] == "UTC" and tz_res["source"] == "database"

    # Reset permissions to defaults -> member regains assets:read, admin loses system:settings:manage
    reset_matrix = call(sa, "POST", "/system/permissions/reset", 200, {})
    assert "assets:read" in reset_matrix["roles"]["member"]
    assert "system:settings:manage" not in reset_matrix["roles"]["admin"]
    call(mem, "GET", "/assets", 200)
    call(adm, "GET", "/system/settings", 200)
    call(adm, "PUT", "/system/settings", 403, {"timezone": "Asia/Shanghai"})

    # 3. System status probe, timezone validation, AI circuit breaker & rollback safety
    call(mem, "GET", "/system/status", 403)
    status_adm = call(adm, "GET", "/system/status", 200)
    assert status_adm["overall"] == "ok" and status_adm["probe"]["db"] == "ok"
    assert isinstance(status_adm["probe"]["dbLatencyMs"], (int, float))
    raw_status = json.dumps(status_adm)
    assert SUPER_PW not in raw_status and "postgres://" not in raw_status

    call(adm, "PATCH", "/system/ai-circuit", 403, {"enabled": False})
    tripped = call(sa, "PATCH", "/system/ai-circuit", 200, {"enabled": False})
    assert tripped["circuitOpen"] is True
    assert call(sa, "GET", "/system/status", 200)["ai"]["circuitOpen"] is True
    assert call(sa, "GET", "/assets/agent/config", 200) == {"enabled": False}

    restored = call(sa, "PATCH", "/system/ai-circuit", 200, {"enabled": True})
    assert restored["circuitOpen"] is False
    assert call(sa, "GET", "/system/status", 200)["ai"]["circuitOpen"] is False

    call(sa, "PUT", "/system/settings", 422, {"timezone": "Invalid/Timezone"})
    tz_back = call(sa, "PUT", "/system/settings", 200, {"timezone": "Asia/Shanghai"})
    assert tz_back["timezone"] == "Asia/Shanghai"

    # Transaction rollback test on system.timezone_update
    sql(
        """CREATE FUNCTION gov_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action='system.timezone_update' AND NEW.detail->>'to'='Asia/Tokyo' THEN
    RAISE EXCEPTION 'qa system audit failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gov_qa_reject BEFORE INSERT ON console_audit FOR EACH ROW EXECUTE FUNCTION gov_qa_reject();"""
    )
    try:
        call(sa, "PUT", "/system/settings", 500, {"timezone": "Asia/Tokyo"})
        assert call(sa, "GET", "/system/settings", 200)["timezone"] == "Asia/Shanghai"
    finally:
        sql("DROP TRIGGER gov_qa_reject ON console_audit; DROP FUNCTION gov_qa_reject();")

    # 4. Audit source filter (human / agent) & timezone header
    call(sa, "GET", "/audit?source=invalid", 400)
    human_audit = call(sa, "GET", "/audit?source=human&size=50", 200)
    assert human_audit["timezone"] == "Asia/Shanghai"
    assert human_audit["items"] and all(
        item["actorSource"] == "human" for item in human_audit["items"]
    )
    recorded_actions = {item["action"] for item in human_audit["items"]}
    assert {
        "permission.update",
        "permission.reset",
        "system.ai_circuit",
        "system.timezone_update",
    }.issubset(recorded_actions)

    agent_audit = call(sa, "GET", "/audit?source=agent&size=20", 200)
    assert all(item["actorSource"] == "agent" for item in agent_audit["items"])

    for s in (sa, adm, adm2, mem):
        call(s, "POST", "/logout", 200, {})

    print(
        "PASS: 3-tier RBAC, escalation defenses, permission matrix linkage, system probes, AI circuit breaker, timezone & rollback, human/agent audit"
    )
finally:
    ids_csv = ",".join(str(int(i)) for i in created_ids)
    id_cleanup = (
        f"DELETE FROM console_audit WHERE target_id IN ({ids_csv}) OR actor_id IN ({ids_csv}); "
        f"DELETE FROM console_session WHERE account IN ({ids_csv}); "
        f"DELETE FROM console_account WHERE id IN ({ids_csv}); "
        if created_ids
        else ""
    )
    sql(
        f"BEGIN; {id_cleanup}"
        f"DELETE FROM console_audit WHERE actor_username='{SUPER_USER}' AND action IN ('permission.update','permission.reset','system.ai_circuit','system.timezone_update'); "
        f"DELETE FROM console_role_permission; "
        f"DELETE FROM console_setting WHERE key IN ('timezone','ai.enabled'); "
        f"COMMIT;"
    )
