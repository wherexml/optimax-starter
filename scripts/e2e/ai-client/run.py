#!/usr/bin/env python3
"""HTTP E2E for the AI client port: token field compatibility, error classes, bounded queue.

Runs against an isolated Compose stack (project optimax-starter-aie2e; web 38460, api 38461,
vendor simulator 38462) with its own volume, a random temporary admin, temporary members and a
fake API key. The vendor is a scripted OpenAI-compatible SIMULATOR, not a real or paid model.
No Magpie process is needed. It never touches optimax-starter-preview or its volume, and never
reads the repository .env.

Usage (from the repository root, Docker required):
  python3 scripts/e2e/ai-client/run.py                     # build, run every group, tear down
  python3 scripts/e2e/ai-client/run.py --keep              # keep the stack on profile "main"
  python3 scripts/e2e/ai-client/run.py --only token,queue --skip-build --keep
  python3 scripts/e2e/ai-client/run.py --switch disabled   # recreate api with one profile, run nothing
  python3 scripts/e2e/ai-client/run.py --cleanup           # remove this project's containers, volume, runtime secrets

Groups: config, token, security, errors, queue, trace, leak.
Evidence: evidence/ai-client-port/runs/<UTC>/ (results.json, fixture-trace.json, logs-redacted.txt).
"""
import argparse
import concurrent.futures
import contextlib
import datetime
import http.client
import json
import os
import re
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import time
import traceback
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROJECT = "optimax-starter-aie2e"
PROTECTED_PROJECTS = {"optimax-starter-preview"}
WEB_PORT, API_PORT, FIXTURE_PORT = 38460, 38461, 38462
ORIGIN = f"http://127.0.0.1:{WEB_PORT}"
FOREIGN_ORIGIN = "https://example.invalid"
ADMIN_USER = "aie2e_admin"
COOKIE_NAME = "optimax_aie2e"
EVIDENCE_ROOT = ROOT / "evidence" / "ai-client-port"
RUNTIME = EVIDENCE_ROOT / "runtime"
COMPOSE_FILE = HERE / "compose.e2e.yaml"
ERROR_KEYS = {"error", "code", "retryAfter", "upstreamStatus", "errorShape"}
TOOL_NAME = "apply_asset_filters"
GROUPS = ["config", "token", "security", "errors", "queue", "trace", "leak"]
SIMULATION = (
    "Vendor responses come from scripts/e2e/ai-client/fixture.mjs, a scripted OpenAI-compatible "
    "simulator inside the isolated Compose network. It is not a real, hosted or paid model. "
    "api.openai.com resolves to the simulator only inside this test network, with a throwaway CA."
)
USERINFO_CANARY = "UIPW" + secrets.token_hex(6)
CANARY = "VENDOR-CANARY-" + secrets.token_hex(6)

BASE_MAIN = {
    "STARTER_AI_BASE_URL": "http://fixture:38462/v1",
    "STARTER_AI_MODEL": "e2e-model-a",
    "STARTER_AI_API_KEY_FILE": "/run/secrets/starter_ai_key",
    "STARTER_AI_ALLOW_HTTP_HOSTS": "fixture",
    "STARTER_AI_TIMEOUT_MS": "8000",
    "STARTER_AI_CONCURRENCY": "2",
    "STARTER_AI_QUEUE_LIMIT": "2",
    "STARTER_AI_QUEUE_WAIT_MS": "3000",
    "STARTER_AI_ACTOR_LIMIT": "1",
}
LEGACY = {
    "STARTER_MAGPIE_RELAY_URL": "http://host.docker.internal:38462/chat/completions",
    "STARTER_MAGPIE_MODEL": "e2e-legacy",
}
PROFILES = {
    "disabled": {},
    "main": BASE_MAIN,
    "explicit-field": {**BASE_MAIN, "STARTER_AI_MODEL": "e2e-model-b", "STARTER_AI_TOKEN_FIELD": "max_completion_tokens"},
    "official-tls": {**BASE_MAIN, "STARTER_AI_BASE_URL": "https://api.openai.com:38463/v1", "STARTER_AI_ALLOW_HTTP_HOSTS": "", "STARTER_AI_CA_FILE": "/run/secrets/e2e_ca"},
    "official-tls-no-ca": {**BASE_MAIN, "STARTER_AI_BASE_URL": "https://api.openai.com:38463/v1", "STARTER_AI_ALLOW_HTTP_HOSTS": ""},
    "legacy-only": LEGACY,
    "new-and-legacy": {**BASE_MAIN, **LEGACY},
    "invalid-userinfo": {**BASE_MAIN, "STARTER_AI_BASE_URL": f"http://e2euser:{USERINFO_CANARY}@fixture:38462/v1"},
    "invalid-query": {**BASE_MAIN, "STARTER_AI_BASE_URL": "http://fixture:38462/v1?api-version=1"},
    "invalid-fragment": {**BASE_MAIN, "STARTER_AI_BASE_URL": "http://fixture:38462/v1#frag"},
    "invalid-scheme": {**BASE_MAIN, "STARTER_AI_BASE_URL": "ftp://fixture:38462/v1"},
    "invalid-http-host": {**BASE_MAIN, "STARTER_AI_ALLOW_HTTP_HOSTS": ""},
    "invalid-key-file": {**BASE_MAIN, "STARTER_AI_API_KEY_FILE": "/run/secrets/does-not-exist"},
    "invalid-bounds": {**BASE_MAIN, "STARTER_AI_CONCURRENCY": "1000"},
}

CA_CNF = """[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = OptiMax AI E2E throwaway CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
"""
SERVER_CNF = """[req]
distinguished_name = dn
prompt = no
[dn]
CN = api.openai.com
"""
SERVER_EXT = """[v3_srv]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:api.openai.com,DNS:fixture
"""

RESPONSES = []
LOG_CHUNKS = []
STATE = {"key": "", "admin_password": "", "db_password": ""}


# ---------------------------------------------------------------- runtime & compose

def write_private(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
    os.chmod(path, 0o600)


def read_env(path):
    values = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'")
    return values


def make_tls():
    tls = RUNTIME / "tls"
    tls.mkdir(parents=True, exist_ok=True)
    try:
        (tls / "ca.cnf").write_text(CA_CNF)
        (tls / "server.cnf").write_text(SERVER_CNF)
        (tls / "server-ext.cnf").write_text(SERVER_EXT)

        def ssl(*args):
            subprocess.run(["openssl", *args], cwd=str(tls), check=True, capture_output=True)

        ssl("req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", "ca.key", "-out", "ca.pem", "-days", "3", "-config", "ca.cnf")
        ssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "server-key.pem", "-out", "server.csr", "-config", "server.cnf")
        ssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "3", "-sha256", "-extfile", "server-ext.cnf", "-extensions", "v3_srv")
        for name in ("ca.key", "server.csr", "ca.srl"):
            with contextlib.suppress(FileNotFoundError):
                (tls / name).unlink()
        os.chmod(tls / "server-key.pem", 0o600)
        (tls / "READY").write_text("ok\n")
    except Exception as error:  # TLS group becomes BLOCKED; other groups still run.
        if not (tls / "ca.pem").exists():
            (tls / "ca.pem").write_text("")
        (tls / "FAILED").write_text(type(error).__name__ + "\n")


def ensure_runtime():
    env_file = RUNTIME / "compose.env"
    fresh = not env_file.exists()
    if fresh:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        os.chmod(RUNTIME, 0o700)
        values = {
            "AIE2E_DB_PASSWORD": secrets.token_hex(16),
            "AIE2E_ADMIN_PASSWORD": "aie2e-" + secrets.token_hex(16),
            "AIE2E_RUNTIME_DIR": str(RUNTIME),
        }
        write_private(env_file, "".join(f"{key}={value}\n" for key, value in values.items()))
        write_private(RUNTIME / "secrets" / "starter_ai_key", "sk-aie2e-" + secrets.token_hex(20) + "\n")
        os.chmod(RUNTIME / "secrets", 0o700)
        write_private(RUNTIME / "ai.env", "")
        make_tls()
    values = read_env(env_file)
    STATE["db_password"] = values["AIE2E_DB_PASSWORD"]
    STATE["admin_password"] = values["AIE2E_ADMIN_PASSWORD"]
    STATE["key"] = (RUNTIME / "secrets" / "starter_ai_key").read_text().strip()
    return fresh


def compose(*args, capture=False, check=True):
    if PROJECT in PROTECTED_PROJECTS:
        raise SystemExit("refusing to operate on a protected Compose project")
    command = [
        "docker", "compose", "-p", PROJECT, "--project-directory", str(HERE),
        "-f", str(COMPOSE_FILE), "--env-file", str(RUNTIME / "compose.env"), *args,
    ]
    return subprocess.run(command, cwd=str(HERE), text=True, capture_output=capture, check=check)


def http_get(port, path, timeout=5):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read().decode("utf-8", "replace")
    finally:
        connection.close()


def wait_until(predicate, timeout, interval=0.2, what="condition"):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # still starting
            last = error
        time.sleep(interval)
    raise TimeoutError(f"timed out waiting for {what} ({type(last).__name__ if last else 'no error'})")


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def stack_running():
    result = compose("ps", "-q", capture=True, check=False)
    return result.returncode == 0 and bool(result.stdout.strip())


def wait_api():
    wait_until(lambda: http_get(API_PORT, "/healthz")[0] == 200, 180, 1.0, "api /healthz")


def capture_api_logs(label):
    result = compose("logs", "--no-color", "--timestamps", "api", "fixture", capture=True, check=False)
    LOG_CHUNKS.append((label, (result.stdout or "") + (result.stderr or "")))


def write_profile(name):
    values = PROFILES[name]
    for value in values.values():
        if "'" in value or "\n" in value:
            raise ValueError("profile values must not contain quotes or newlines")
    write_private(RUNTIME / "ai.env", "".join(f"{key}='{value}'\n" for key, value in values.items()))


def switch_profile(name):
    capture_api_logs(f"before switch to {name}")
    write_profile(name)
    compose("up", "-d", "--no-deps", "--force-recreate", "api", capture=True)
    wait_api()
    STATE["profile"] = name


def start_stack(build):
    for port in (WEB_PORT, API_PORT, FIXTURE_PORT):
        if not port_free(port) and not stack_running():
            raise SystemExit(f"port {port} is in use by something other than {PROJECT}")
    write_profile("disabled")
    compose("up", "-d", "--force-recreate", *(["--build"] if build else []))
    wait_api()
    wait_until(lambda: http_get(FIXTURE_PORT, "/__fixture/health")[0] == 200, 60, 0.5, "fixture health")
    wait_until(lambda: http_get(WEB_PORT, "/login")[0] == 200, 180, 1.0, "web /login")
    STATE["profile"] = "disabled"


def teardown():
    compose("down", "-v", "--remove-orphans", check=False)
    shutil.rmtree(RUNTIME, ignore_errors=True)


# ---------------------------------------------------------------- HTTP clients

class Resp:
    def __init__(self, status, headers, text, elapsed):
        self.status, self.headers, self.text, self.elapsed = status, headers, text, elapsed
        try:
            self.json = json.loads(text) if text else None
        except ValueError:
            self.json = None

    def body(self):
        return self.json if isinstance(self.json, dict) else {}


class Session:
    def __init__(self, label):
        self.label, self.cookie = label, None

    def call(self, method, path, body=None, origin=ORIGIN, raw=None, timeout=40):
        headers = {}
        if origin is not None:
            headers["Origin"] = origin
        data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
        if method != "GET":
            headers["Content-Type"] = "application/json"
        if self.cookie:
            headers["Cookie"] = self.cookie
        connection = http.client.HTTPConnection("127.0.0.1", API_PORT, timeout=timeout)
        started = time.monotonic()
        try:
            connection.request(method, "/console" + path, body=data, headers=headers)
            response = connection.getresponse()
            text = response.read().decode("utf-8", "replace")
            pairs = response.getheaders()
        finally:
            connection.close()
        for name, value in pairs:
            if name.lower() == "set-cookie" and value.startswith(COOKIE_NAME + "="):
                self.cookie = value.split(";", 1)[0]
        result = Resp(response.status, {name.lower(): value for name, value in pairs if name.lower() != "set-cookie"}, text, time.monotonic() - started)
        RESPONSES.append({"session": self.label, "method": method, "path": path, "status": result.status, "headers": result.headers, "text": text})
        return result

    def open_raw(self, path, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        head = (
            f"POST /console{path} HTTP/1.1\r\nHost: 127.0.0.1:{API_PORT}\r\nOrigin: {ORIGIN}\r\n"
            f"Content-Type: application/json\r\nContent-Length: {len(data)}\r\n"
            + (f"Cookie: {self.cookie}\r\n" if self.cookie else "")
            + "Connection: close\r\n\r\n"
        ).encode()
        sock = socket.create_connection(("127.0.0.1", API_PORT), timeout=30)
        sock.sendall(head + data)
        return sock


def abort_raw(sock):
    """Close with RST so the server sees the client disappear immediately."""
    with contextlib.suppress(OSError):
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    sock.close()


def fx(method, path, body=None, timeout=10):
    connection = http.client.HTTPConnection("127.0.0.1", FIXTURE_PORT, timeout=timeout)
    try:
        data = json.dumps(body).encode() if body is not None else None
        connection.request(method, "/__fixture" + path, body=data, headers={"Content-Type": "application/json"} if data else {})
        response = connection.getresponse()
        text = response.read().decode()
        if response.status >= 400:
            raise RuntimeError(f"fixture {method} {path} -> {response.status}")
        return json.loads(text) if text else {}
    finally:
        connection.close()


def fx_reset():
    fx("POST", "/reset", {})


def fx_rules(*rules):
    fx("POST", "/rules", {"rules": list(rules)})


def fx_models(models):
    fx("POST", "/models", {"models": models})


def fx_release(hold_id=None):
    fx("POST", "/release", {"holdId": hold_id} if hold_id else {"all": True})


def fx_state():
    return fx("GET", "/state")


def fx_trace(tag=None, since=0):
    query = {"sinceSeq": str(since)}
    if tag:
        query["tag"] = tag
    return fx("GET", "/trace?" + urllib.parse.urlencode(query))["records"]


def calls(tag, phases=("plan", "plan-retry")):
    return [row for row in fx_trace(tag) if row["phase"] in phases]


def seen(tag):
    return bool(calls(tag))


def wait_seen(tag, count=1, timeout=6):
    return wait_until(lambda: len(calls(tag)) >= count, timeout, 0.1, f"vendor arrival of {tag}")


def rule(tag, action, phase="any", times=1):
    return {"tag": tag, "phase": phase, "times": times, "action": action}


def hold(hold_id, then=None):
    action = {"type": "hold", "holdId": hold_id}
    if then:
        action["then"] = then
    return action


def err(status, shape="openai", message="", **extra):
    return {"type": "error", "status": status, "shape": shape, "message": message, **extra}


def plan(session, tag, text="只看待复核", current=None, timeout=40):
    return session.call("POST", "/assets/agent/plan", {"instruction": f"[e2e:{tag}] {text}", "current": current or {}}, timeout=timeout)


# ---------------------------------------------------------------- results

class Ctx:
    def __init__(self):
        self.checks, self.group, self.scenario = [], None, None
        self.admin = Session("admin")
        self.members = []
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=12)
        self.pending = []

    def check(self, name, ok, expected=None, actual=None):
        row = {"group": self.group, "scenario": self.scenario, "name": name, "status": "PASS" if ok else "FAIL"}
        if not ok or expected is not None:
            row["expected"], row["actual"] = expected, actual
        self.checks.append(row)
        return bool(ok)

    def blocked(self, name, reason):
        self.checks.append({"group": self.group, "scenario": self.scenario, "name": name, "status": "BLOCKED", "reason": reason})

    def submit(self, fn, *args, **kwargs):
        future = self.pool.submit(fn, *args, **kwargs)
        self.pending.append(future)
        return future

    def done(self, session, response, matched=3):
        """Consume the run with a real receipt so the bounded in-memory run map never fills."""
        body = response.body()
        if response.status == 200 and body.get("runId"):
            return session.call("POST", "/assets/agent/result", {"runId": body["runId"], "ok": True, "filters": body.get("filters", {}), "matched": matched})
        return None

    def clean(self, text):
        return STATE["key"] not in text and CANARY not in text and USERINFO_CANARY not in text


@contextlib.contextmanager
def scenario(ctx, name):
    ctx.scenario = name
    try:
        fx_reset()
        yield
    except Exception as error:
        ctx.check("scenario completed without exception", False, None, f"{type(error).__name__}: {error}")
        ctx.checks[-1]["trace"] = traceback.format_exc(limit=3)
    finally:
        with contextlib.suppress(Exception):
            fx_release()
        for future in ctx.pending:
            with contextlib.suppress(Exception):
                future.result(timeout=20)
        ctx.pending = []
        with contextlib.suppress(Exception):
            wait_until(lambda: fx_state()["inflight"] == 0, 15, 0.2, "vendor idle")
        with contextlib.suppress(Exception):
            fx_reset()


def ok200(ctx, label, response):
    ctx.check(f"{label}: HTTP 200 with filters", response.status == 200 and "filters" in response.body(), 200, [response.status, response.text[:300]])


def expect_error(ctx, label, response, status, code, upstream_status=None, shape=None, retry_after=None):
    code = code.upper()  # Public API codes follow API_CONVENTIONS.md, independently of internal labels.
    body = response.body()
    ctx.check(f"{label}: HTTP {status}", response.status == status, status, response.status)
    ctx.check(f"{label}: code {code}", body.get("code") == code, code, body.get("code"))
    ctx.check(f"{label}: keeps error string contract", isinstance(body.get("error"), str) and 0 < len(body["error"]) <= 200, "string", body.get("error"))
    ctx.check(f"{label}: only safe error keys", set(body) <= ERROR_KEYS, sorted(ERROR_KEYS), sorted(body))
    ctx.check(f"{label}: never maps to app 401", response.status != 401, "!=401", response.status)
    ctx.check(f"{label}: no vendor text, key or canary", ctx.clean(response.text + json.dumps(response.headers)))
    if upstream_status is not None:
        ctx.check(f"{label}: upstreamStatus {upstream_status}", body.get("upstreamStatus") == upstream_status, upstream_status, body.get("upstreamStatus"))
    if shape is not None:
        ctx.check(f"{label}: errorShape {shape}", body.get("errorShape") == shape, shape, body.get("errorShape"))
    if retry_after == "absent":
        ctx.check(f"{label}: no Retry-After", "retryAfter" not in body and "retry-after" not in response.headers, "absent", [body.get("retryAfter"), response.headers.get("retry-after")])
    elif isinstance(retry_after, int):
        ctx.check(f"{label}: retryAfter {retry_after}", body.get("retryAfter") == retry_after and response.headers.get("retry-after") == str(retry_after), retry_after, [body.get("retryAfter"), response.headers.get("retry-after")])
    elif isinstance(retry_after, tuple):
        value = body.get("retryAfter")
        ok = isinstance(value, int) and retry_after[0] <= value <= retry_after[1] and response.headers.get("retry-after") == str(value)
        ctx.check(f"{label}: retryAfter in {list(retry_after)}", ok, list(retry_after), [value, response.headers.get("retry-after")])


def one_call(ctx, label, tag, settle=0.4):
    time.sleep(settle)
    count = len(calls(tag))
    ctx.check(f"{label}: exactly 1 vendor request (no retry)", count == 1, 1, count)


# ---------------------------------------------------------------- groups

def setup_accounts(ctx):
    ctx.group, ctx.scenario = "setup", "temporary accounts"
    response = ctx.admin.call("POST", "/login", {"username": ADMIN_USER, "password": STATE["admin_password"]})
    if not ctx.check("temporary admin login", response.status == 200, 200, response.status):
        raise SystemExit("admin login failed; see results.json")
    for index in range(1, 7):
        username = f"qa_aie2e_{secrets.token_hex(4)}_u{index}"
        password = secrets.token_hex(16)
        created = ctx.admin.call("POST", "/accounts", {"username": username, "password": password, "name": f"AI E2E U{index}", "role": "member"})
        ctx.check(f"create temporary member U{index}", created.status == 201, 201, created.status)
        member = Session(f"U{index}")
        login = member.call("POST", "/login", {"username": username, "password": password})
        ctx.check(f"member U{index} login", login.status == 200, 200, login.status)
        ctx.members.append(member)


def config_case(ctx, name, profile, plan_status, plan_code, enabled):
    with scenario(ctx, name):
        switch_profile(profile)
        before = fx_state()["seq"]
        config = ctx.admin.call("GET", "/assets/agent/config")
        ctx.check("config 200", config.status == 200, 200, config.status)
        ctx.check(f"enabled is {enabled}", config.body().get("enabled") is enabled, enabled, config.body())
        ctx.check("config exposes only enabled", set(config.body()) <= {"enabled"}, ["enabled"], sorted(config.body()))
        ctx.check("config has no URL/key/canary", ctx.clean(config.text) and "fixture" not in config.text and "http" not in config.text)
        response = plan(ctx.admin, f"cfg-{profile}")
        expect_error(ctx, "plan", response, plan_status, plan_code)
        after = fx_state()["seq"]
        ctx.check("no vendor request", after == before, before, after)
        ctx.check("api stays healthy", http_get(API_PORT, "/healthz")[0] == 200)


def group_config(ctx):
    ctx.group = "config"
    config_case(ctx, "C1 未配置默认关闭", "disabled", 503, "ai_disabled", False)
    for profile in ["invalid-userinfo", "invalid-query", "invalid-fragment", "invalid-scheme", "invalid-http-host", "invalid-key-file", "invalid-bounds"]:
        config_case(ctx, f"C2 拒绝无效配置 {profile}", profile, 503, "ai_config_invalid", False)

    with scenario(ctx, "C3 仅旧 Magpie relay 配置仍可选兼容"):
        switch_profile("legacy-only")
        ctx.check("enabled true", ctx.admin.call("GET", "/assets/agent/config").body().get("enabled") is True)
        response = plan(ctx.admin, "c3")
        ok200(ctx, "legacy plan", response)
        records = calls("c3")
        ctx.check("legacy path /chat/completions without Authorization", len(records) == 1 and records[0]["path"] == "/chat/completions" and not records[0]["authPresent"], "1 relay call, no auth", [(row["path"], row["authPresent"]) for row in records])
        ctx.check("legacy model", records and records[0]["model"] == "e2e-legacy", "e2e-legacy", records and records[0]["model"])
        if not records:
            ctx.checks[-1]["note"] = "the test network aliases host.docker.internal to the fixture for the optional legacy path"
        ctx.done(ctx.admin, response)

    with scenario(ctx, "C4 新旧同时配置时新模式优先"):
        switch_profile("new-and-legacy")
        response = plan(ctx.admin, "c4")
        ok200(ctx, "plan", response)
        records = calls("c4")
        ctx.check("new /v1 client used with key", len(records) == 1 and records[0]["path"] == "/v1/chat/completions" and records[0]["authOk"] and records[0]["model"] == "e2e-model-a", "1 /v1 call", [(row["path"], row["authOk"], row["model"]) for row in records])
        ctx.done(ctx.admin, response)

    with scenario(ctx, "C5 显式 token 字段配置"):
        switch_profile("explicit-field")
        response = plan(ctx.admin, "c5")
        ok200(ctx, "plan", response)
        records = calls("c5")
        ctx.check("first request uses configured max_completion_tokens", len(records) == 1 and records[0]["tokenFields"] == ["max_completion_tokens"] and records[0]["model"] == "e2e-model-b", ["max_completion_tokens"], [row["tokenFields"] for row in records])
        ctx.done(ctx.admin, response)

    tls_ready = (RUNTIME / "tls" / "READY").exists() and fx("GET", "/health").get("tls") is True
    with scenario(ctx, "C6 官方主机默认 max_completion_tokens（模拟主机名 + 测试 CA）"):
        if not tls_ready:
            ctx.blocked("official host over TLS", "openssl certificate generation or simulator TLS listener unavailable")
        else:
            switch_profile("official-tls")
            resolved = compose("exec", "-T", "api", "getent", "hosts", "api.openai.com", capture=True, check=False).stdout.split()
            simulator = compose("exec", "-T", "api", "getent", "hosts", "fixture", capture=True, check=False).stdout.split()
            if not resolved or not simulator or resolved[0] != simulator[0]:
                ctx.blocked("official host over TLS", "api.openai.com does not resolve to the simulator inside the test network; refusing to send traffic")
            else:
                response = plan(ctx.admin, "c6")
                ok200(ctx, "plan", response)
                records = calls("c6")
                ctx.check("TLS to api.openai.com alias with test CA", len(records) == 1 and records[0]["listener"] == "https" and records[0]["host"].startswith("api.openai.com") and records[0]["authOk"], "1 https call", [(row["listener"], row["host"]) for row in records])
                ctx.check("official host defaults to max_completion_tokens", records and records[0]["tokenFields"] == ["max_completion_tokens"], ["max_completion_tokens"], records and records[0]["tokenFields"])
                ctx.done(ctx.admin, response)

    with scenario(ctx, "C7 未配置 CA 时不接受测试证书"):
        if not tls_ready:
            ctx.blocked("TLS without CA", "TLS fixture unavailable")
        else:
            switch_profile("official-tls-no-ca")
            response = plan(ctx.admin, "c7")
            expect_error(ctx, "plan", response, 502, "upstream_network")
            ctx.check("no HTTP request reached the simulator", not calls("c7"), 0, len(calls("c7")))


def ensure_main(ctx):
    ctx.group, ctx.scenario = "main", "M0 新模式启用（重启清空能力缓存）"
    switch_profile("main")
    config = ctx.admin.call("GET", "/assets/agent/config")
    ok = ctx.check("main profile enabled", config.status == 200 and config.body().get("enabled") is True, True, config.body())
    with scenario(ctx, "M1 API 容器环境不含密钥"):
        container = compose("ps", "-q", "api", capture=True).stdout.strip()
        inspected = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Env}}", container], text=True, capture_output=True, check=True).stdout
        env = json.loads(inspected)
        names = sorted(item.split("=", 1)[0] for item in env)
        ctx.check("key value absent from container env", all(STATE["key"] not in item for item in env))
        ctx.check("only a key file path is configured", "STARTER_AI_API_KEY_FILE" in names and "STARTER_AI_API_KEY" not in names, "STARTER_AI_API_KEY_FILE only", [name for name in names if name.startswith("STARTER_AI")])
    return ok


def group_token(ctx):
    ctx.group = "token"
    admin = ctx.admin
    with scenario(ctx, "T0 不需要修正时只请求一次，非官方主机默认 max_tokens"):
        response = plan(admin, "t0")
        ok200(ctx, "plan", response)
        records = calls("t0")
        ctx.check("1 vendor request", len(records) == 1, 1, len(records))
        ctx.check("default max_tokens", records and records[0]["tokenFields"] == ["max_tokens"], ["max_tokens"], records and records[0]["tokenFields"])
        ctx.check("business max 1200 unchanged", records and records[0]["tokenValue"] == 1200, 1200, records and records[0]["tokenValue"])
        receipt = ctx.done(admin, response)
        ctx.check("receipt acknowledged", receipt is not None and receipt.status == 200 and receipt.body().get("acknowledged") is True, 200, receipt and receipt.status)
        receipts = calls("t0", ("receipt",))
        ctx.check("receipt uses 800 and same field", len(receipts) == 1 and receipts[0]["tokenValue"] == 800 and receipts[0]["tokenFields"] == ["max_tokens"], [800, ["max_tokens"]], [(row["tokenValue"], row["tokenFields"]) for row in receipts])

    fx_models_a = {"e2e-model-a": {"accept": ["max_completion_tokens"], "rejectStatus": 400}}
    with scenario(ctx, "T1 400 明确要求 max_completion_tokens 时只修正一次"):
        fx_models(fx_models_a)
        response = plan(admin, "t1")
        ok200(ctx, "plan", response)
        records = calls("t1")
        ctx.check("exactly 2 vendor requests", len(records) == 2, 2, len(records))
        if len(records) == 2:
            first, second = records
            ctx.check("first sent max_tokens and got 400", first["tokenFields"] == ["max_tokens"] and first["status"] == 400, ["max_tokens", 400], [first["tokenFields"], first["status"]])
            ctx.check("second sent max_completion_tokens only", second["tokenFields"] == ["max_completion_tokens"] and second["status"] == 200, ["max_completion_tokens", 200], [second["tokenFields"], second["status"]])
            ctx.check("value 1200 kept", first["tokenValue"] == second["tokenValue"] == 1200, 1200, [first["tokenValue"], second["tokenValue"]])
            ctx.check("messages/tools/other fields unchanged", first["bodyHash"] == second["bodyHash"] and first["messagesHash"] == second["messagesHash"] and first["toolsHash"] == second["toolsHash"])
        ctx.check("tool-argument corrections still 0", response.body().get("corrections") == 0, 0, response.body().get("corrections"))
        ctx.done(admin, response)

    with scenario(ctx, "T2 同 endpoint+model 缓存命中，回执也使用"):
        fx_models(fx_models_a)
        response = plan(admin, "t2")
        ok200(ctx, "plan", response)
        records = calls("t2")
        ctx.check("1 request with cached max_completion_tokens", len(records) == 1 and records[0]["tokenFields"] == ["max_completion_tokens"], ["max_completion_tokens"], [row["tokenFields"] for row in records])
        ctx.done(admin, response)
        receipts = calls("t2", ("receipt",))
        ctx.check("receipt uses cached field with 800", len(receipts) == 1 and receipts[0]["tokenFields"] == ["max_completion_tokens"] and receipts[0]["tokenValue"] == 800, [["max_completion_tokens"], 800], [(row["tokenFields"], row["tokenValue"]) for row in receipts])

    with scenario(ctx, "T3 第二次仍被拒绝时不来回切换"):
        fx_models({"e2e-model-a": {"accept": [], "rejectStatus": 400}})
        response = plan(admin, "t3")
        expect_error(ctx, "plan", response, 502, "upstream_bad_request", upstream_status=400, shape="openai")
        time.sleep(1.0)
        records = calls("t3")
        ctx.check("at most 2 vendor requests", len(records) == 2, 2, len(records))
        ctx.check("the two requests used different fields", len(records) == 2 and records[0]["tokenFields"] != records[1]["tokenFields"], "different", [row["tokenFields"] for row in records])

    with scenario(ctx, "T4 422 反向要求 max_tokens 时修正一次"):
        fx_models({"e2e-model-a": {"accept": ["max_tokens"], "rejectStatus": 422}})
        response = plan(admin, "t4")
        ok200(ctx, "plan", response)
        records = calls("t4")
        ctx.check("1 or 2 requests, last max_tokens", 1 <= len(records) <= 2 and records[-1]["tokenFields"] == ["max_tokens"], "<=2, last max_tokens", [(row["tokenFields"], row["status"]) for row in records])
        if len(records) == 2:
            ctx.check("first was the 422 for max_completion_tokens", records[0]["status"] == 422 and records[0]["tokenFields"] == ["max_completion_tokens"], [422, ["max_completion_tokens"]], [records[0]["status"], records[0]["tokenFields"]])
        ctx.done(admin, response)

    with scenario(ctx, "T5 缓存更新后下一次直接 max_tokens"):
        fx_models({"e2e-model-a": {"accept": ["max_tokens"], "rejectStatus": 422}})
        response = plan(admin, "t5")
        ok200(ctx, "plan", response)
        records = calls("t5")
        ctx.check("1 request with max_tokens", len(records) == 1 and records[0]["tokenFields"] == ["max_tokens"], ["max_tokens"], [row["tokenFields"] for row in records])
        ctx.done(admin, response)

    with scenario(ctx, "T6 字段修正与工具参数修正互不放大"):
        fx_models(fx_models_a)
        fx_rules(rule("t6", {"type": "tool", "arguments": {"clear_all": False, "stage": ["已删除"]}}, phase="plan"))
        response = plan(admin, "t6")
        ok200(ctx, "plan", response)
        records = calls("t6")
        ctx.check("3 requests: field fix, invalid tool, corrected tool", [row["tokenFields"] for row in records] == [["max_tokens"], ["max_completion_tokens"], ["max_completion_tokens"]], 3, [(row["phase"], row["tokenFields"], row["status"]) for row in records])
        ctx.check("tool correction reported once", response.body().get("corrections") == 1, 1, response.body().get("corrections"))
        ctx.done(admin, response)

    negatives = [
        ("n1", "400 数值上限不是字段名错误", err(400, message="max_tokens must be at most 32768 for this model. " + CANARY, code="invalid_value", param="max_tokens"), 502, "upstream_bad_request", 400),
        ("n2", "无关 400", err(400, message="Invalid value for 'temperature'. " + CANARY, code="invalid_value", param="temperature"), 502, "upstream_bad_request", 400),
        ("n3", "429 额度错误即使提到字段也不重试", err(429, message="You exceeded your current quota; use '{other}' after upgrading. " + CANARY, errType="insufficient_quota", code="insufficient_quota"), 429, "upstream_rate_limited", 429),
        ("n4", "401 提到字段也不重试", err(401, message="Incorrect API key provided; use '{other}'. " + CANARY, code="invalid_api_key"), 502, "upstream_auth", 401),
        ("n5", "500 提到字段也不重试", err(500, message="Server error; use '{other}' instead. " + CANARY, errType="server_error"), 502, "upstream_server", 500),
        ("n6", "上下文超限提到 max_tokens 不重试", err(400, message="This model's maximum context length is 8192 tokens. Please reduce the length of the messages or max_tokens. " + CANARY, code="context_length_exceeded"), 502, "upstream_bad_request", 400),
        ("n7", "要求的字段与已发送字段相同时不重试", err(400, message="Unsupported parameter. Use '{sent}' instead. " + CANARY, code="unsupported_parameter"), 502, "upstream_bad_request", 400),
    ]
    for tag, title, action, status, code, upstream in negatives:
        with scenario(ctx, f"T7 {tag} {title}"):
            fx_rules(rule(tag, action))
            response = plan(admin, tag)
            expect_error(ctx, "plan", response, status, code, upstream_status=upstream)
            one_call(ctx, "plan", tag)

    with scenario(ctx, "T8 超时不重试"):
        fx_rules(rule("n8", {"type": "tool", "delayMs": 9500}))
        response = plan(admin, "n8")
        expect_error(ctx, "plan", response, 504, "upstream_timeout")
        ctx.check("returns near 8s total timeout", 7.3 <= response.elapsed <= 9.6, "7.3-9.6s", round(response.elapsed, 2))
        one_call(ctx, "plan", "n8")
        wait_until(lambda: calls("n8") and calls("n8")[0]["aborted"], 4, 0.2, "timed-out request aborted")
        ctx.check("upstream request aborted", calls("n8")[0]["aborted"] is True)

    with scenario(ctx, "T9 总超时包含字段修正"):
        fx_rules(
            rule("n9", err(400, message="Unsupported parameter: '{sent}' is not supported with this model. Use '{other}' instead.", code="unsupported_parameter", delayMs=5000)),
            rule("n9", {"type": "tool", "delayMs": 5000}),
        )
        response = plan(admin, "n9")
        expect_error(ctx, "plan", response, 504, "upstream_timeout")
        ctx.check("deadline is shared, not reset by correction", 7.3 <= response.elapsed <= 9.6, "7.3-9.6s", round(response.elapsed, 2))
        records = wait_until(lambda: (lambda rows: rows if len(rows) == 2 and rows[1]["aborted"] else None)(calls("n9")), 4, 0.2, "corrected request aborted")
        ctx.check("2 requests, second aborted", len(records) == 2 and records[1]["aborted"] is True)


    with scenario(ctx, "T10 保留供应商工具回传必需的 reasoning_content，仅留在后端"):
        opaque = "opaque-vendor-reasoning-not-for-the-page"
        fx_rules(rule("t10", {"type": "json", "body": {"choices": [{"message": {
            "role": "assistant", "content": None, "reasoning_content": opaque,
            "tool_calls": [{"id": "call-reasoning-e2e", "type": "function", "function": {
                "name": TOOL_NAME, "arguments": json.dumps({"clear_all": False, "stage": ["待复核"]}, ensure_ascii=False)
            }}]
        }}]}}, phase="plan"))
        response = plan(admin, "t10")
        ok200(ctx, "plan", response)
        receipt = ctx.done(admin, response)
        ctx.check("receipt acknowledged", receipt is not None and receipt.status == 200)
        receipts = calls("t10", ("receipt",))
        ctx.check("assistant reasoning survives the server-side tool roundtrip", len(receipts) == 1 and receipts[0].get("hasAssistantReasoning") is True)
        ctx.check("reasoning never returned to browser", opaque not in response.text and (receipt is None or opaque not in receipt.text))


def group_security(ctx):
    ctx.group = "security"
    admin = ctx.admin
    snapshot = admin.call("GET", "/assets").text
    with scenario(ctx, "S1 匿名、外部来源、非法输入不调用上游"):
        before = fx_state()["seq"]
        anonymous = Session("anonymous")
        ctx.check("anonymous plan 401", plan(anonymous, "s1-anon").status == 401)
        foreign = admin.call("POST", "/assets/agent/plan", {"instruction": "[e2e:s1-foreign] 只看待复核", "current": {}}, origin=FOREIGN_ORIGIN)
        ctx.check("foreign origin 403", foreign.status == 403, 403, foreign.status)
        cases = [
            ("empty instruction", {"instruction": " ", "current": {}}, 400),
            ("instruction over 500 chars", {"instruction": "筛" * 501, "current": {}}, 400),
            ("extra action field", {"instruction": "筛选", "current": {}, "action": "delete_account"}, 400),
            ("invalid current state", {"instruction": "筛选", "current": {"stage": "已删除"}}, 400),
            ("body over 8KB", {"instruction": "筛" * 9000, "current": {}}, 413),
        ]
        for label, body, status in cases:
            response = admin.call("POST", "/assets/agent/plan", body)
            ctx.check(f"{label} -> {status}", response.status == status, status, response.status)
        unknown = admin.call("POST", "/assets/agent/result", {"runId": "00000000-0000-4000-8000-000000000000", "ok": True, "filters": {}, "matched": 12})
        ctx.check("unknown run 404", unknown.status == 404, 404, unknown.status)
        ctx.check("invalid receipt 400", admin.call("POST", "/assets/agent/result", {"ok": True}).status == 400)
        after = fx_state()["seq"]
        ctx.check("no vendor request for refused input", after == before, before, after)
        config = admin.call("GET", "/assets/agent/config")
        ctx.check("config enabled without secrets", config.body() == {"enabled": True} and ctx.clean(config.text), {"enabled": True}, config.body())

    with scenario(ctx, "S2 工具参数两次无效仍拒绝"):
        bad = {"type": "tool", "arguments": {"clear_all": False, "stage": ["已删除"]}}
        fx_rules(rule("s2", bad, phase="plan"), rule("s2", bad, phase="plan-retry"))
        response = plan(admin, "s2")
        ctx.check("not applied", response.status not in (200, 401) and "filters" not in response.body(), "non-200 without filters", [response.status, sorted(response.body())])
        ctx.check("exactly 2 vendor requests", len(calls("s2")) == 2, 2, len(calls("s2")))

    with scenario(ctx, "S3 非白名单工具名拒绝"):
        fx_rules(rule("s3", {"type": "tool", "name": "delete_account", "arguments": {}}, phase="plan"))
        response = plan(admin, "s3")
        ctx.check("not applied", response.status not in (200, 401) and "filters" not in response.body(), "non-200", response.status)
        one_call(ctx, "plan", "s3")

    with scenario(ctx, "S4 多个工具调用拒绝"):
        fx_rules(rule("s4", {"type": "tool", "calls": [{"name": TOOL_NAME, "arguments": {"clear_all": False}}, {"name": TOOL_NAME, "arguments": {"clear_all": True}}]}, phase="plan"))
        response = plan(admin, "s4")
        ctx.check("not applied", response.status not in (200, 401) and "filters" not in response.body(), "non-200", response.status)
        one_call(ctx, "plan", "s4")

    with scenario(ctx, "S5 不存在的业务域经一次工具修正后应用"):
        fx_rules(rule("s5", {"type": "tool", "arguments": {"clear_all": False, "domain": ["人事"]}}, phase="plan"))
        response = plan(admin, "s5")
        ok200(ctx, "plan", response)
        ctx.check("corrections 1", response.body().get("corrections") == 1, 1, response.body().get("corrections"))
        ctx.done(admin, response)

    with scenario(ctx, "S6 无额外写操作"):
        ctx.check("asset table unchanged", admin.call("GET", "/assets").text == snapshot)


def group_errors(ctx):
    ctx.group = "errors"
    admin = ctx.admin
    date_window = (25, 31)
    cases = [
        ("e1", "Anthropic 529 overloaded", err(529, "anthropic", CANARY, errType="overloaded_error"), 502, "upstream_server", 529, "anthropic", None),
        ("e2", "Anthropic 429 + Retry-After 秒", err(429, "anthropic", CANARY, errType="rate_limit_error", headers={"Retry-After": "7"}), 429, "upstream_rate_limited", 429, "anthropic", 7),
        ("e3", "Gemini 429 + Retry-After HTTP 日期", err(429, "gemini", CANARY, errStatus="RESOURCE_EXHAUSTED", retryAfterDateIn=30), 429, "upstream_rate_limited", 429, "gemini", date_window),
        ("e4", "Gemini 400", err(400, "gemini", CANARY, errStatus="INVALID_ARGUMENT"), 502, "upstream_bad_request", 400, "gemini", None),
        ("e5", "OpenAI 401", err(401, "openai", CANARY, code="invalid_api_key", errType="CANARYTYPE" + CANARY), 502, "upstream_auth", 401, "openai", None),
        ("e6", "OpenAI 403", err(403, "openai", CANARY, code="unsupported_country_region_territory"), 502, "upstream_auth", 403, "openai", None),
        ("e7", "500 HTML", err(500, "html", CANARY), 502, "upstream_server", 500, "unknown", None),
        ("e8", "200 非法 JSON", {"type": "raw", "status": 200, "contentType": "application/json", "body": "not json " + CANARY}, 502, "upstream_invalid_response", None, None, None),
        ("e9", "200 携带 error", {"type": "json", "status": 200, "body": {"error": {"message": CANARY, "type": "server_error"}}}, 502, "upstream_invalid_response", None, None, None),
        ("e10", "200 缺少 choices", {"type": "json", "status": 200, "body": {"id": "x", "object": "chat.completion", "choices": []}}, 502, "upstream_invalid_response", None, None, None),
        ("e11", "超大响应", {"type": "big", "bytes": 1600000}, 502, "upstream_response_too_large", None, None, None),
        ("e12", "重定向不跟随", {"type": "redirect", "status": 307, "location": "http://fixture:38462/v1/redirected"}, 502, "upstream_redirect", None, None, None),
        ("e13", "429 无效 Retry-After", err(429, "openai", CANARY, errType="rate_limit_exceeded", headers={"Retry-After": "soon"}), 429, "upstream_rate_limited", 429, "openai", "absent"),
        ("e14", "503 + Retry-After 120", err(503, "openai", CANARY, errType="server_error", headers={"Retry-After": "120"}), 502, "upstream_server", 503, "openai", 120),
        ("e15", "响应中途断开", {"type": "destroy"}, 502, "upstream_network", None, None, None),
        ("e18", "429 + 很长 Retry-After 原样保留", err(429, "openai", CANARY, headers={"Retry-After": "86400"}), 429, "upstream_rate_limited", 429, "openai", 86400),
    ]
    for tag, title, action, status, code, upstream, shape, retry in cases:
        with scenario(ctx, f"E {tag} {title}"):
            fx_rules(rule(tag, action, phase="plan"))
            response = plan(admin, tag)
            expect_error(ctx, "plan", response, status, code, upstream_status=upstream, shape=shape, retry_after=retry)
            one_call(ctx, "plan", tag)
            if tag in ("e5", "e6"):
                ctx.check("local session kept (/me 200)", admin.call("GET", "/me").status == 200)
                ctx.check("assets still readable", admin.call("GET", "/assets").status == 200)
            if tag == "e11":
                ctx.check("oversized body rejected quickly", response.elapsed < 6, "<6s", round(response.elapsed, 2))
            if tag == "e12":
                followed = [row for row in fx_trace("e12") if row["path"] == "/v1/redirected"]
                ctx.check("redirect target never requested (key not forwarded)", not followed, 0, len(followed))

    with scenario(ctx, "E e16 回执上游 401 不导致退出登录"):
        fx_rules(rule("e16", err(401, "openai", CANARY, code="invalid_api_key"), phase="receipt"))
        response = plan(admin, "e16")
        ok200(ctx, "plan", response)
        receipt = admin.call("POST", "/assets/agent/result", {"runId": response.body().get("runId"), "ok": True, "filters": response.body().get("filters", {}), "matched": 3})
        expect_error(ctx, "receipt", receipt, 502, "upstream_auth", upstream_status=401)
        ctx.check("local session kept", admin.call("GET", "/me").status == 200)


def group_queue(ctx):
    ctx.group = "queue"
    users = ctx.members
    if len(users) < 6:
        ctx.scenario = "precondition"
        ctx.check("6 temporary members available", False, 6, len(users))
        return

    def finish(pairs):
        statuses = []
        for session, future in pairs:
            response = future.result(timeout=25) if hasattr(future, "result") else future
            statuses.append(response.status)
            ctx.done(session, response)
        return statuses

    with scenario(ctx, "Q1 最多 N=2 个并发上游请求"):
        fx("POST", "/max-reset", {})
        fx_rules(rule("q1-u1", hold("q1-h1")), rule("q1-u2", hold("q1-h2")))
        f1, f2 = ctx.submit(plan, users[0], "q1-u1"), ctx.submit(plan, users[1], "q1-u2")
        wait_seen("q1-u1"); wait_seen("q1-u2")
        f3 = ctx.submit(plan, users[2], "q1-u3")
        time.sleep(0.8)
        ctx.check("third request waits in the app queue", not seen("q1-u3"))
        ctx.check("vendor inflight 2", fx_state()["inflight"] == 2, 2, fx_state()["inflight"])
        fx_release("q1-h1")
        wait_seen("q1-u3", timeout=4)
        fx_release("q1-h2")
        ctx.check("vendor maxInflight 2", fx_state()["maxInflight"] == 2, 2, fx_state()["maxInflight"])
        statuses = finish([(users[0], f1), (users[1], f2), (users[2], f3)])
        ctx.check("all succeed", statuses == [200, 200, 200], [200] * 3, statuses)

    with scenario(ctx, "Q2 FIFO"):
        fx_rules(rule("q2-u1", hold("q2-h1")), rule("q2-u2", hold("q2-h2")), rule("q2-u3", hold("q2-h3")))
        f1, f2 = ctx.submit(plan, users[0], "q2-u1"), ctx.submit(plan, users[1], "q2-u2")
        wait_seen("q2-u1"); wait_seen("q2-u2")
        f3 = ctx.submit(plan, users[2], "q2-u3"); time.sleep(0.4)
        f4 = ctx.submit(plan, users[3], "q2-u4"); time.sleep(0.4)
        ctx.check("both waiters queued", not seen("q2-u3") and not seen("q2-u4"))
        fx_release("q2-h1")
        wait_seen("q2-u3", timeout=4)
        time.sleep(0.3)
        ctx.check("second waiter still queued after first slot", not seen("q2-u4"))
        fx_release("q2-h2")
        wait_seen("q2-u4", timeout=4)
        ctx.check("arrival order U3 before U4", calls("q2-u3")[0]["seq"] < calls("q2-u4")[0]["seq"])
        fx_release("q2-h3")
        statuses = finish([(users[0], f1), (users[1], f2), (users[2], f3), (users[3], f4)])
        ctx.check("all succeed", statuses == [200] * 4, [200] * 4, statuses)

    with scenario(ctx, "Q3 队列满立即拒绝"):
        fx_rules(rule("q3-u1", hold("q3-h1")), rule("q3-u2", hold("q3-h2")))
        f1, f2 = ctx.submit(plan, users[0], "q3-u1"), ctx.submit(plan, users[1], "q3-u2")
        wait_seen("q3-u1"); wait_seen("q3-u2")
        f3, f4 = ctx.submit(plan, users[2], "q3-u3"), ctx.submit(plan, users[3], "q3-u4")
        time.sleep(0.5)
        response = plan(users[4], "q3-u5")
        expect_error(ctx, "fifth request", response, 429, "queue_full")
        ctx.check("refused without waiting", response.elapsed < 1.0, "<1s", round(response.elapsed, 2))
        ctx.check("refused request never sent", not seen("q3-u5"))
        fx_release()
        statuses = finish([(users[0], f1), (users[1], f2), (users[2], f3), (users[3], f4)])
        ctx.check("queued requests still succeed", statuses == [200] * 4, [200] * 4, statuses)

    with scenario(ctx, "Q4 排队超时退出且不发上游"):
        fx_rules(rule("q4-u1", hold("q4-h1")), rule("q4-u2", hold("q4-h2")))
        f1, f2 = ctx.submit(plan, users[0], "q4-u1"), ctx.submit(plan, users[1], "q4-u2")
        wait_seen("q4-u1"); wait_seen("q4-u2")
        response = plan(users[2], "q4-u3")
        expect_error(ctx, "waiter", response, 503, "queue_timeout")
        ctx.check("leaves near 3s queue wait", 2.5 <= response.elapsed <= 4.5, "2.5-4.5s", round(response.elapsed, 2))
        ctx.check("timed-out waiter never sent", not seen("q4-u3"))
        fx_release()
        statuses = finish([(users[0], f1), (users[1], f2)])
        ctx.check("holders succeed", statuses == [200, 200], [200, 200], statuses)

    with scenario(ctx, "Q5 等待者取消后不调用上游，槽位给下一个"):
        fx_rules(rule("q5-u1", hold("q5-h1")), rule("q5-u2", hold("q5-h2")), rule("q5-u4", hold("q5-h4")))
        f1, f2 = ctx.submit(plan, users[0], "q5-u1"), ctx.submit(plan, users[1], "q5-u2")
        wait_seen("q5-u1"); wait_seen("q5-u2")
        sock = users[2].open_raw("/assets/agent/plan", {"instruction": "[e2e:q5-u3] 只看待复核", "current": {}})
        time.sleep(0.5)
        abort_raw(sock)
        time.sleep(0.5)
        fx_release("q5-h1")
        f1.result(timeout=10)
        time.sleep(1.0)
        ctx.check("cancelled waiter never sent", not seen("q5-u3"))
        f4 = ctx.submit(plan, users[3], "q5-u4")
        try:
            wait_seen("q5-u4", timeout=3)
            ctx.check("freed slot goes to the next request", True)
        except TimeoutError:
            ctx.check("freed slot goes to the next request", False, "U4 at vendor <3s", "not seen")
        fx_release()
        again = plan(users[2], "q5-u3b")
        ctx.check("cancelled actor can request again", again.status == 200, 200, again.status)
        ctx.done(users[2], again)
        statuses = finish([(users[0], f1), (users[1], f2), (users[3], f4)])
        ctx.check("others succeed", statuses == [200] * 3, [200] * 3, statuses)

    with scenario(ctx, "Q6 上游错误释放槽位"):
        fx_rules(rule("q6-u1", err(500, message=CANARY)), rule("q6-u2", err(500, message=CANARY)))
        f1, f2 = ctx.submit(plan, users[0], "q6-u1"), ctx.submit(plan, users[1], "q6-u2")
        errors = [f1.result(timeout=15), f2.result(timeout=15)]
        ctx.check("both classified UPSTREAM_SERVER", [r.body().get("code") for r in errors] == ["UPSTREAM_SERVER"] * 2, ["UPSTREAM_SERVER"] * 2, [r.body().get("code") for r in errors])
        fx_rules(rule("q6-u3", hold("q6-h3")), rule("q6-u4", hold("q6-h4")))
        f3, f4 = ctx.submit(plan, users[2], "q6-u3"), ctx.submit(plan, users[3], "q6-u4")
        try:
            wait_seen("q6-u3", timeout=3); wait_seen("q6-u4", timeout=3)
            ctx.check("both slots usable after errors", True)
        except TimeoutError:
            ctx.check("both slots usable after errors", False, "2 arrivals", [seen("q6-u3"), seen("q6-u4")])
        f5 = ctx.submit(plan, users[4], "q6-u5")
        time.sleep(0.8)
        ctx.check("still capped at 2 (no double release)", not seen("q6-u5") and fx_state()["inflight"] == 2)
        fx_release()
        statuses = finish([(users[2], f3), (users[3], f4), (users[4], f5)])
        ctx.check("all succeed", statuses == [200] * 3, [200] * 3, statuses)

    with scenario(ctx, "Q7 进行中的请求被客户端取消后中止上游并释放槽位"):
        fx_rules(rule("q7-u1", hold("q7-h1")), rule("q7-u2", hold("q7-h2")))
        sock = users[0].open_raw("/assets/agent/plan", {"instruction": "[e2e:q7-u1] 只看待复核", "current": {}})
        f2 = ctx.submit(plan, users[1], "q7-u2")
        wait_seen("q7-u1"); wait_seen("q7-u2")
        abort_raw(sock)
        try:
            wait_until(lambda: calls("q7-u1")[0]["aborted"], 4, 0.2, "upstream abort")
            ctx.check("upstream request aborted", True)
        except TimeoutError:
            ctx.check("upstream request aborted", False, True, calls("q7-u1")[0]["aborted"])
        f3 = ctx.submit(plan, users[2], "q7-u3")
        try:
            wait_seen("q7-u3", timeout=3)
            ctx.check("slot freed for next request", True)
        except TimeoutError:
            ctx.check("slot freed for next request", False, "U3 at vendor <3s", "not seen")
        fx_release()
        again = plan(users[0], "q7-u1b")
        ctx.check("cancelled actor can request again", again.status == 200, 200, again.status)
        ctx.done(users[0], again)
        statuses = finish([(users[1], f2), (users[2], f3)])
        ctx.check("others succeed", statuses == [200, 200], [200, 200], statuses)

    with scenario(ctx, "Q8 单用户上限不饿死其他用户"):
        fx_rules(rule("q8-u1a", hold("q8-h1")))
        f1 = ctx.submit(plan, users[0], "q8-u1a")
        wait_seen("q8-u1a")
        response = plan(users[0], "q8-u1b")
        expect_error(ctx, "same actor second request", response, 429, "actor_limit")
        ctx.check("refused without waiting", response.elapsed < 1.0, "<1s", round(response.elapsed, 2))
        time.sleep(0.3)
        ctx.check("refused request never sent", not seen("q8-u1b"))
        other = plan(users[1], "q8-u2")
        ctx.check("other user served promptly", other.status == 200 and other.elapsed < 3, "200 <3s", [other.status, round(other.elapsed, 2)])
        ctx.done(users[1], other)
        fx_release()
        ctx.check("holder succeeds", finish([(users[0], f1)]) == [200])

    with scenario(ctx, "Q9 总超时包含排队时间"):
        fx_rules(rule("q9-u1", hold("q9-h1")), rule("q9-u2", hold("q9-h2")), rule("q9-u3", {"type": "tool", "delayMs": 6000}))
        f1, f2 = ctx.submit(plan, users[0], "q9-u1"), ctx.submit(plan, users[1], "q9-u2")
        wait_seen("q9-u1"); wait_seen("q9-u2")
        f3 = ctx.submit(plan, users[2], "q9-u3")
        time.sleep(2.5)
        fx_release("q9-h1"); fx_release("q9-h2")
        response = f3.result(timeout=20)
        expect_error(ctx, "queued then slow", response, 504, "upstream_timeout")
        ctx.check("timeout measured from request start", 7.3 <= response.elapsed <= 9.6, "7.3-9.6s", round(response.elapsed, 2))
        with contextlib.suppress(TimeoutError):
            wait_until(lambda: calls("q9-u3") and calls("q9-u3")[0]["aborted"], 4, 0.2, "abort")
        ctx.check("upstream request aborted", bool(calls("q9-u3")) and calls("q9-u3")[0]["aborted"] is True)
        ctx.check("holders succeed", finish([(users[0], f1), (users[1], f2)]) == [200, 200])

    with scenario(ctx, "Q10 收尾容量探测：无泄漏、无双释放"):
        fx_rules(rule("p-u1", hold("p-h1")), rule("p-u2", hold("p-h2")))
        f1, f2 = ctx.submit(plan, users[0], "p-u1"), ctx.submit(plan, users[1], "p-u2")
        wait_seen("p-u1"); wait_seen("p-u2")
        f3 = ctx.submit(plan, users[2], "p-u3")
        time.sleep(0.8)
        ctx.check("exactly 2 slots after all scenarios", not seen("p-u3") and fx_state()["inflight"] == 2)
        fx_release()
        ctx.check("probe requests succeed", finish([(users[0], f1), (users[1], f2), (users[2], f3)]) == [200] * 3)
        for index, session in enumerate(users):
            response = plan(session, f"p-seq-u{index + 1}")
            ctx.check(f"U{index + 1} actor lane free", response.status == 200, 200, response.status)
            ctx.done(session, response)


def group_trace(ctx):
    ctx.group = "trace"
    with scenario(ctx, "R 全部上游请求的白名单、业务参数与鉴权"):
        records = [row for row in fx_trace() if row["path"] in ("/v1/chat/completions", "/chat/completions")]
        new = [row for row in records if row["path"] == "/v1/chat/completions"]
        ctx.check("vendor requests recorded", bool(records), ">0", len(records))
        ctx.check("every /v1 request authenticated", all(row["authOk"] for row in new), True, [row["seq"] for row in new if not row["authOk"]])
        ctx.check("legacy relay requests carry no Authorization", all(not row["authPresent"] for row in records if row["path"] == "/chat/completions"))
        ctx.check("never both token fields", all(len(row["tokenFields"]) == 1 for row in records), 1, [row["seq"] for row in records if len(row["tokenFields"]) != 1])
        ctx.check("only apply_asset_filters offered", all(row["toolNames"] == [TOOL_NAME] for row in records), [TOOL_NAME], sorted({json.dumps(row["toolNames"]) for row in records}))
        ctx.check("plan max 1200 / receipt max 800 unchanged", all(row["tokenValue"] == (800 if row["phase"] == "receipt" else 1200) for row in records), "1200/800", [(row["seq"], row["phase"], row["tokenValue"]) for row in records if row["tokenValue"] != (800 if row["phase"] == "receipt" else 1200)][:10])
        ctx.check("tool_choice auto for plan, none for receipt", all(row["toolChoice"] == ("none" if row["phase"] == "receipt" else "auto") for row in records))
        ctx.check("stream false, temperature 0", all(row["stream"] is False and row["temperature"] == 0 for row in records))
        ctx.check("redirect target never requested", not [row for row in fx_trace() if row["path"] == "/v1/redirected"])


def group_leak(ctx, run_dir):
    ctx.group = "leak"
    with scenario(ctx, "L 日志、响应与追踪不含密钥或供应商原文"):
        capture_api_logs("final")
        logs = "\n".join(f"===== {label} =====\n{text}" for label, text in LOG_CHUNKS)
        ctx.check("logs contain no key", STATE["key"] not in logs)
        ctx.check("logs contain no vendor canary", CANARY not in logs)
        ctx.check("logs contain no URL userinfo", USERINFO_CANARY not in logs)
        ctx.check("logs contain no Authorization/Bearer", not re.search(r"authorization|bearer\s", logs, re.IGNORECASE))
        (run_dir / "logs-redacted.txt").write_text(scrub(logs))
        responses = json.dumps(RESPONSES, ensure_ascii=False)
        ctx.check("app responses contain no key", STATE["key"] not in responses)
        ctx.check("app responses contain no vendor canary", CANARY not in responses)
        trace_text = json.dumps(fx_trace(), ensure_ascii=False)
        ctx.check("simulator trace contains no key", STATE["key"] not in trace_text)


# ---------------------------------------------------------------- output

def scrub(text):
    for secret, marker in ((STATE["key"], "[KEY]"), (STATE["admin_password"], "[ADMIN_PASSWORD]"), (STATE["db_password"], "[DB_PASSWORD]"), (USERINFO_CANARY, "[USERINFO_CANARY]")):
        if secret:
            text = text.replace(secret, marker)
    return text


def git_revision():
    def git(*args):
        return subprocess.run(["git", "-C", str(ROOT), *args], text=True, capture_output=True, check=False).stdout.strip()
    status = git("status", "--porcelain")
    return {"head": git("rev-parse", "HEAD"), "dirty": bool(status), "changedPaths": len(status.splitlines()) if status else 0}


def logout_all(ctx):
    for session in [ctx.admin, *ctx.members]:
        if session.cookie and not session.cookie.endswith("="):
            with contextlib.suppress(Exception):
                session.call("POST", "/logout", {})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keep", action="store_true", help="leave the stack running on profile main")
    parser.add_argument("--skip-build", action="store_true", help="reuse the existing optimax-starter-aie2e:local image")
    parser.add_argument("--only", default=",".join(GROUPS), help="comma-separated groups")
    parser.add_argument("--switch", choices=sorted(PROFILES), help="recreate api with one profile and exit")
    parser.add_argument("--cleanup", action="store_true", help="remove this project's containers, volume and runtime secrets")
    parser.add_argument("--evidence", help="evidence directory (default evidence/ai-client-port/runs/<UTC>)")
    args = parser.parse_args()

    if args.cleanup:
        if (RUNTIME / "compose.env").exists():
            teardown()
        else:
            subprocess.run(["docker", "compose", "-p", PROJECT, "down", "-v", "--remove-orphans"], check=False)
        print(json.dumps({"cleanup": PROJECT, "runtimeRemoved": not RUNTIME.exists()}))
        return 0

    fresh = ensure_runtime()
    if fresh:
        compose("down", "-v", "--remove-orphans", check=False, capture=True)
    if args.switch:
        if not stack_running():
            start_stack(build=not args.skip_build)
        switch_profile(args.switch)
        print(json.dumps({"project": PROJECT, "profile": args.switch, "web": ORIGIN}))
        return 0

    groups = [group for group in args.only.split(",") if group]
    unknown = sorted(set(groups) - set(GROUPS))
    if unknown:
        raise SystemExit(f"unknown groups: {unknown}")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = Path(args.evidence).resolve() if args.evidence else EVIDENCE_ROOT / "runs" / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    ctx = Ctx()
    result = {
        "status": "RUNNING", "startedAt": stamp, "project": PROJECT,
        "ports": {"web": WEB_PORT, "api": API_PORT, "simulator": FIXTURE_PORT},
        "revision": git_revision(), "simulation": SIMULATION, "groups": groups,
        "commands": {"rerun": "python3 scripts/e2e/ai-client/run.py", "keep": "python3 scripts/e2e/ai-client/run.py --keep", "cleanup": "python3 scripts/e2e/ai-client/run.py --cleanup"},
    }
    exit_code = 1
    try:
        if not stack_running() or not args.skip_build:
            start_stack(build=not args.skip_build)
        elif STATE.get("profile") is None:
            switch_profile("disabled")
        setup_accounts(ctx)
        if "config" in groups:
            group_config(ctx)
        main_groups = [group for group in ("token", "security", "errors", "queue") if group in groups]
        if main_groups or args.keep:
            enabled = ensure_main(ctx)
            for group in main_groups:
                if not enabled:
                    ctx.group, ctx.scenario = group, "precondition"
                    ctx.check("main profile enabled (STARTER_AI_* client present)", False, True, False)
                    continue
                {"token": group_token, "security": group_security, "errors": group_errors, "queue": group_queue}[group](ctx)
        if "trace" in groups:
            group_trace(ctx)
        if "leak" in groups:
            group_leak(ctx, run_dir)
    except BaseException as error:
        ctx.group, ctx.scenario = "runner", "fatal"
        ctx.check("runner completed", False, None, f"{type(error).__name__}: {error}")
        ctx.checks[-1]["trace"] = traceback.format_exc(limit=5)
    finally:
        logout_all(ctx)
        ctx.pool.shutdown(wait=False, cancel_futures=True)
        with contextlib.suppress(Exception):
            (run_dir / "fixture-trace.json").write_text(json.dumps(fx_trace(), ensure_ascii=False, indent=1))
        statuses = {row["status"] for row in ctx.checks}
        result["status"] = "FAIL" if "FAIL" in statuses or not ctx.checks else ("BLOCKED" if "BLOCKED" in statuses else "PASS")
        result["summary"] = {status: sum(1 for row in ctx.checks if row["status"] == status) for status in ("PASS", "FAIL", "BLOCKED")}
        result["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        result["profileAtEnd"] = STATE.get("profile")
        result["keptRunning"] = bool(args.keep)
        result["checks"] = ctx.checks
        (run_dir / "results.json").write_text(scrub(json.dumps(result, ensure_ascii=False, indent=2)) + "\n")
        if not args.keep:
            teardown()
        exit_code = 0 if result["status"] == "PASS" else 1
        print(json.dumps({"status": result["status"], "summary": result["summary"], "evidence": str(run_dir), "keptRunning": bool(args.keep)}, ensure_ascii=False))
        if args.keep:
            print(f"Stack kept: {ORIGIN}/assets (profile {STATE.get('profile')}). Browser: scripts/e2e/ai-client/browser.mjs. Cleanup: python3 scripts/e2e/ai-client/run.py --cleanup")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
