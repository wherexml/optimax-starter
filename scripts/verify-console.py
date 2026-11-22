"""Verify actual HTTP sessions, asset CRUD/pagination and RBAC against the running local Docker stack."""
import http.cookiejar
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = dict(
    line.split("=", 1)
    for line in (root / ".env").read_text().splitlines()
    if "=" in line and not line.lstrip().startswith("#")
)
web_port = os.environ.get("WEB_PORT") or config.get("WEB_PORT", "38140")
api_port = os.environ.get("API_PORT") or config.get("API_PORT", "38141")
origin = os.environ.get("CORS_ORIGIN") or config.get("CORS_ORIGIN") or f"http://127.0.0.1:{web_port}"
admin_user = os.environ.get("STARTER_ADMIN_USERNAME") or config.get("STARTER_ADMIN_USERNAME", "demo@optimax.hk")
admin_password = os.environ.get("STARTER_ADMIN_PASSWORD") or config["STARTER_ADMIN_PASSWORD"]


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(session, method, path, status, data=None):
    request = urllib.request.Request(
        origin + "/console" + path,
        method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Origin": origin, "Content-Type": "application/json"},
    )
    try:
        response = session.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        assert response.status == status, (method, path, response.status, status)
        return json.load(response)


with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/healthz", timeout=10) as health_res:
    assert health_res.status == 200
    assert json.load(health_res)["status"] == "ok"

admin, member = client(), client()
assert isinstance(call(member, "GET", "/auth/providers", 200), list)
call(member, "GET", "/assets", 401)
call(admin, "POST", "/login", 200, {"username": admin_user, "password": admin_password})

username = "qa_" + secrets.token_hex(8)
credentials = {"username": username, "password": secrets.token_hex(16)}
row = call(admin, "POST", "/accounts", 201, {**credentials, "name": "临时验收", "role": "member"})
asset_name = "临时资产_" + secrets.token_hex(4)
created_asset = None
bulk_assets = []
bulk_audit_watermark = 0

try:
    call(member, "POST", "/login", 401, {**credentials, "password": "invalid"})
    call(member, "POST", "/login", 200, credentials)
    assert call(member, "GET", "/assets", 200)
    call(member, "GET", "/accounts", 403)
    call(
        member,
        "POST",
        "/assets",
        403,
        {"name": asset_name, "domain": "采购", "owner": "平台组", "stage": "待复核"},
    )

    created_asset = call(
        admin,
        "POST",
        "/assets",
        201,
        {"name": asset_name, "domain": "采购", "owner": "平台组", "stage": "待复核"},
    )
    call(
        admin,
        "POST",
        "/assets",
        409,
        {"name": asset_name, "domain": "采购", "owner": "平台组", "stage": "待复核"},
    )
    paged = call(
        member,
        "GET",
        "/assets/page?" + urllib.parse.urlencode({"q": asset_name, "qOp": "equals", "stage": "待复核"}),
        200,
    )
    assert paged["total"] == 1 and paged["items"][0]["id"] == created_asset["id"]
    patched_asset = call(
        admin,
        "PATCH",
        f"/assets/{created_asset['id']}",
        200,
        {"stage": "已登记"},
    )
    assert patched_asset["stage"] == "已登记"
    call(admin, "DELETE", f"/assets/{created_asset['id']}", 200, {})
    audit_rows = call(admin, "GET", "/audit?action=asset.delete&size=20", 200)["items"]
    assert any(item["detail"].get("entityId") == created_asset["id"] for item in audit_rows)

    recent_audits = call(admin, "GET", "/audit?size=5", 200)["items"]
    bulk_audit_watermark = max((int(item["id"]) for item in recent_audits), default=0)
    bulk_a = call(
        admin,
        "POST",
        "/assets",
        201,
        {"name": "批量资产A_" + secrets.token_hex(4), "domain": "采购", "owner": "平台组", "stage": "待复核"},
    )
    bulk_b = call(
        admin,
        "POST",
        "/assets",
        201,
        {"name": "批量资产B_" + secrets.token_hex(4), "domain": "财务", "owner": "运营组", "stage": "待复核"},
    )
    bulk_assets = [bulk_a, bulk_b]
    bulk_ids = [bulk_a["id"], bulk_b["id"]]
    call(member, "POST", "/assets/bulk-stage", 403, {"ids": bulk_ids, "stage": "已登记"})
    call(member, "POST", "/assets/bulk-delete", 403, {"ids": bulk_ids})
    bulk_stage_res = call(admin, "POST", "/assets/bulk-stage", 200, {"ids": bulk_ids, "stage": "已登记"})
    assert bulk_stage_res["ok"] is True and bulk_stage_res["updated"] == 2
    bulk_update_audits = call(admin, "GET", "/audit?action=asset.bulk_update&size=20", 200)["items"]
    assert any(
        int(item["id"]) > bulk_audit_watermark and item["detail"].get("matched") == 2 and item["detail"].get("stage") == "已登记"
        for item in bulk_update_audits
    )
    bulk_delete_res = call(admin, "POST", "/assets/bulk-delete", 200, {"ids": bulk_ids})
    assert bulk_delete_res["ok"] is True and bulk_delete_res["deleted"] == 2
    bulk_delete_audits = call(admin, "GET", "/audit?action=asset.bulk_delete&size=20", 200)["items"]
    assert any(
        int(item["id"]) > bulk_audit_watermark and item["detail"].get("matched") == 2
        for item in bulk_delete_audits
    )

    target = "/accounts/" + str(row["id"])
    call(member, "PATCH", target, 403, {"active": False})
    call(admin, "PATCH", target, 400, {"email": "invalid-email"})
    patched_account = call(
        admin,
        "PATCH",
        target,
        200,
        {"email": "qa_member@example.invalid", "company": "安全运营中心"},
    )
    assert (
        patched_account["email"] == "qa_member@example.invalid"
        and patched_account["company"] == "安全运营中心"
    )
    account_audits = call(admin, "GET", "/audit?action=account.update&size=20", 200)["items"]
    raw_audit = json.dumps(account_audits, ensure_ascii=False)
    assert "qa_member@example.invalid" not in raw_audit and "安全运营中心" not in raw_audit
    assert any(
        item["targetId"] == row["id"] and item["detail"].get("fields") == ["email", "company"]
        for item in account_audits
    )
    call(admin, "PATCH", target, 200, {"active": False})
    call(member, "GET", "/assets", 401)
    call(member, "POST", "/login", 401, credentials)
    call(admin, "PATCH", target, 200, {"active": True})
    call(member, "POST", "/login", 200, credentials)
    call(member, "POST", "/logout", 200, {})
    call(member, "GET", "/assets", 401)
    call(admin, "POST", "/logout", 200, {})
    print("PASS: healthz, anonymous guard, login, assets CRUD + server pagination, RBAC, disable/revoke, enable, logout")
finally:
    asset_cleanup = (
        f"DELETE FROM console_audit WHERE detail->>'entityId'='{int(created_asset['id'])}' AND action LIKE 'asset.%'; "
        f"DELETE FROM console_asset WHERE id={int(created_asset['id'])} AND name='{asset_name}'; "
        if created_asset
        else ""
    )
    bulk_cleanup = "".join(
        f"DELETE FROM console_audit WHERE detail->>'entityId'='{int(item['id'])}' AND action LIKE 'asset.%'; "
        f"DELETE FROM console_asset WHERE id={int(item['id'])} AND name='{item['name']}'; "
        for item in bulk_assets
    )
    if bulk_audit_watermark or bulk_assets:
        bulk_cleanup += (
            f"DELETE FROM console_audit WHERE id>{int(bulk_audit_watermark)} "
            f"AND action IN ('asset.bulk_update', 'asset.bulk_delete'); "
        )
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "starter", "-d", "starter"],
        cwd=root,
        input=(
            f"BEGIN; {asset_cleanup}{bulk_cleanup}"
            f"DELETE FROM console_audit WHERE target_id={int(row['id'])}; "
            f"DELETE FROM console_session WHERE account={int(row['id'])}; "
            f"DELETE FROM console_account WHERE id={int(row['id'])} AND username='{username}'; COMMIT;"
        ),
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
