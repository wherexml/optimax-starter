#!/usr/bin/env python3
import http.cookiejar
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[2]
base = 'http://127.0.0.1:38140'
evidence = root / 'evidence/asset-agent/api-results.json'
checks = []
cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

def request(path, body=None, origin=base):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + '/console' + path, data=data, headers={'Origin': origin, 'Content-Type': 'application/json'})
    try:
        with client.open(req, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

def check(name, actual, expected):
    checks.append({'name': name, 'status': 'PASS' if actual == expected else 'FAIL', 'actual': actual, 'expected': expected})
    assert actual == expected, name

password = os.environ.get('STARTER_ADMIN_PASSWORD')
if not password:
    for line in (root / '.env').read_text().splitlines():
        if line.startswith('STARTER_ADMIN_PASSWORD='):
            password = line.split('=', 1)[1].strip().strip('\"\'')
if not password:
    raise SystemExit('Local test password unavailable')

try:
    check('anonymous model request refused', request('/assets/agent/plan', {'instruction': '只看待复核', 'current': {}})[0], 401)
    check('foreign origin refused', request('/assets/agent/plan', {'instruction': '只看待复核', 'current': {}}, 'https://example.invalid')[0], 403)
    check('local demo session', request('/login', {'username': 'demo@optimax.hk', 'password': password})[0], 200)
    check('config enabled', request('/assets/agent/config')[1].get('enabled'), True)
    check('empty instruction refused', request('/assets/agent/plan', {'instruction': ' ', 'current': {}})[0], 400)
    check('long instruction refused', request('/assets/agent/plan', {'instruction': '筛' * 501, 'current': {}})[0], 400)
    check('extra action refused', request('/assets/agent/plan', {'instruction': '筛选', 'current': {}, 'action': 'delete_account'})[0], 400)
    check('invalid current state refused', request('/assets/agent/plan', {'instruction': '筛选', 'current': {'stage': '已删除'}})[0], 400)
    check('oversized request refused', request('/assets/agent/plan', {'instruction': '筛' * 9000, 'current': {}})[0], 413)
    check('unknown result run refused', request('/assets/agent/result', {'runId': '00000000-0000-4000-8000-000000000000', 'ok': True, 'filters': {}, 'matched': 12})[0], 404)
    check('invalid result refused', request('/assets/agent/result', {'ok': True})[0], 400)
finally:
    if len(cookies):
        request('/logout', {})
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({'status': 'PASS' if checks and all(row['status'] == 'PASS' for row in checks) else 'FAIL', 'baseUrl': base, 'checks': checks}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'checks': len(checks), 'evidence': str(evidence)}, ensure_ascii=False))
