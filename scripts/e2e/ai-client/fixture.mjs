// OpenAI-compatible vendor SIMULATOR used only by scripts/e2e/ai-client/run.py.
// It is not a real, paid or hosted model. Responses are scripted by the test runner
// through /__fixture/* control endpoints.
// Security: the Authorization header is compared by SHA-256 digest and never logged,
// stored or returned. Trace records hold only hashes, tags and numeric/enum metadata.
import http from 'node:http';
import https from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { once } from 'node:events';

const PORT = Number(process.env.FIXTURE_PORT || 38462);
const TLS_PORT = Number(process.env.FIXTURE_TLS_PORT || 38463);
const KEY_FILE = process.env.FIXTURE_EXPECTED_KEY_FILE || '/run/secrets/fixture_expected_key';
const TLS_DIR = process.env.FIXTURE_TLS_DIR || '/run/fixture-tls';
const MAX_BODY = 256 * 1024;
const MAX_TRACE = 5000;
const TOKEN_FIELDS = ['max_tokens', 'max_completion_tokens'];
const DEFAULT_ARGS = { clear_all: false, stage: ['待复核'] };
const started = Date.now();

const expectedDigest = existsSync(KEY_FILE)
  ? createHash('sha256').update(`Bearer ${readFileSync(KEY_FILE, 'utf8').trim()}`).digest()
  : null;

let seq = 0;
let inflight = 0;
let maxInflight = 0;
const trace = [];
let rules = [];
let models = {};
const holds = new Map();
const preReleased = new Set();

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex').slice(0, 16);

function sleep(ms, signal) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function authOk(header) {
  if (!expectedDigest || typeof header !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(header).digest(), expectedDigest);
}

function instructionOf(body) {
  const user = Array.isArray(body?.messages) ? body.messages.find(message => message?.role === 'user') : undefined;
  if (typeof user?.content !== 'string') return '';
  try {
    const value = JSON.parse(user.content);
    return typeof value?.instruction === 'string' ? value.instruction : '';
  } catch {
    return '';
  }
}

function phaseOf(body) {
  if (body?.tool_choice === 'none') return 'receipt';
  return Array.isArray(body?.messages) && body.messages.some(message => message?.role === 'tool') ? 'plan-retry' : 'plan';
}

function receiptOf(body) {
  if (body?.tool_choice !== 'none' || !Array.isArray(body?.messages)) return undefined;
  const tool = [...body.messages].reverse().find(message => message?.role === 'tool');
  try {
    const value = JSON.parse(tool?.content ?? '');
    return { ok: value?.ok === true, matched: Number.isInteger(value?.matched) ? value.matched : null };
  } catch {
    return { ok: null, matched: null };
  }
}

function withoutTokenFields(body) {
  const copy = { ...(body ?? {}) };
  for (const key of TOKEN_FIELDS) delete copy[key];
  return copy;
}

function record(req, listener, path, body, instruction) {
  const fields = TOKEN_FIELDS.filter(key => body && Object.hasOwn(body, key));
  const entry = {
    seq: ++seq,
    at: Date.now() - started,
    listener,
    host: String(req.headers.host || ''),
    method: req.method,
    path,
    model: typeof body?.model === 'string' ? body.model : null,
    phase: phaseOf(body),
    tag: instruction.match(/\[e2e:([A-Za-z0-9_-]{1,48})\]/)?.[1] ?? null,
    instructionHash: instruction ? digest(instruction) : null,
    tokenFields: fields,
    tokenValue: fields.length ? body[fields[0]] : null,
    bodyHash: digest(withoutTokenFields(body)),
    messagesHash: digest(body?.messages ?? null),
    toolsHash: digest(body?.tools ?? null),
    toolNames: Array.isArray(body?.tools) ? body.tools.map(tool => tool?.function?.name ?? null) : [],
    toolChoice: body?.tool_choice ?? null,
    stream: body?.stream ?? null,
    temperature: body?.temperature ?? null,
    authPresent: typeof req.headers.authorization === 'string',
    authOk: authOk(req.headers.authorization),
    contentType: String(req.headers['content-type'] || ''),
    receipt: receiptOf(body),
    hasAssistantReasoning: Array.isArray(body?.messages) && body.messages.some(message => message?.role === 'assistant' && typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0),
    ruleId: null,
    action: null,
    holdId: null,
    status: null,
    aborted: false,
    finishedAt: null,
  };
  trace.push(entry);
  if (trace.length > MAX_TRACE) trace.shift();
  return entry;
}

function takeRule(entry, instruction) {
  const rule = rules.find(candidate =>
    (candidate.times < 0 || candidate.used < candidate.times)
    && (candidate.tag === undefined || candidate.tag === entry.tag)
    && (candidate.instruction === undefined || candidate.instruction === instruction)
    && (candidate.phase === undefined || candidate.phase === 'any' || candidate.phase === entry.phase)
    && (candidate.path === undefined || candidate.path === entry.path)
    && (candidate.model === undefined || candidate.model === entry.model));
  if (!rule) return null;
  rule.used++;
  entry.ruleId = rule.id;
  return rule;
}

function waitHold(holdId, signal) {
  if (preReleased.delete(holdId)) return Promise.resolve();
  return new Promise(resolve => {
    const waiting = holds.get(holdId) ?? [];
    waiting.push(resolve);
    holds.set(holdId, waiting);
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function release(holdId) {
  const waiting = holds.get(holdId);
  if (!waiting?.length) { preReleased.add(holdId); return 0; }
  holds.delete(holdId);
  for (const resolve of waiting) resolve();
  return waiting.length;
}

function releaseAll() {
  let count = 0;
  for (const waiting of holds.values()) for (const resolve of waiting) { resolve(); count++; }
  holds.clear();
  preReleased.clear();
  return count;
}

function extraHeaders(action) {
  const headers = { ...(action.headers ?? {}) };
  if (Number.isFinite(action.retryAfterDateIn)) {
    headers['Retry-After'] = new Date(Date.now() + action.retryAfterDateIn * 1000).toUTCString();
  }
  return headers;
}

function writeHead(res, entry, status, headers) {
  entry.status = status;
  res.writeHead(status, headers);
}

function sendJson(res, entry, status, value, headers = {}) {
  writeHead(res, entry, status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function completion(entry, message, finishReason) {
  return {
    id: `chatcmpl-e2e-${entry.seq}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: entry.model ?? 'e2e-simulator',
    system_fingerprint: 'e2e-simulator',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function toolCalls(entry, action) {
  const calls = action.calls ?? [{ name: action.name ?? 'apply_asset_filters', arguments: action.arguments ?? DEFAULT_ARGS }];
  return calls.map((call, index) => ({
    id: `call_e2e_${entry.seq}_${index}`,
    type: 'function',
    function: { name: call.name ?? 'apply_asset_filters', arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? DEFAULT_ARGS) },
  }));
}

function errorBody(action, status, message) {
  switch (action.shape ?? 'openai') {
    case 'anthropic':
      return { type: 'error', error: { type: action.errType ?? 'api_error', message } };
    case 'gemini':
      return { error: { code: status, message, status: action.errStatus ?? 'INVALID_ARGUMENT' } };
    default:
      return { error: { message, type: action.errType ?? 'invalid_request_error', code: action.code ?? null, param: action.param ?? null } };
  }
}

async function perform(action, ctx) {
  const { res, entry, signal } = ctx;
  entry.action = entry.action ? `${entry.action}>${action.type}` : action.type;
  if (action.delayMs) await sleep(action.delayMs, signal);
  if (signal.aborted || res.destroyed) return;
  const sent = entry.tokenFields[0] ?? 'max_tokens';
  const other = sent === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
  const fill = text => String(text ?? '').replaceAll('{sent}', sent).replaceAll('{other}', other);
  const status = action.status ?? 200;
  switch (action.type) {
    case 'hold': {
      entry.holdId = action.holdId;
      await waitHold(action.holdId, signal);
      if (signal.aborted || res.destroyed) return;
      return perform(action.then ?? { type: entry.phase === 'receipt' ? 'text' : 'tool' }, ctx);
    }
    case 'tool':
      return sendJson(res, entry, 200, completion(entry, { role: 'assistant', content: null, tool_calls: toolCalls(entry, action) }, 'tool_calls'), extraHeaders(action));
    case 'text':
      return sendJson(res, entry, 200, completion(entry, { role: 'assistant', content: action.content ?? '已按页面回执确认筛选（模拟供应商）' }, 'stop'));
    case 'json':
      return sendJson(res, entry, status, action.body ?? {}, extraHeaders(action));
    case 'raw':
      writeHead(res, entry, status, { 'Content-Type': action.contentType ?? 'text/plain', ...extraHeaders(action) });
      return res.end(fill(action.body));
    case 'error': {
      const message = fill(action.message || 'simulated vendor error');
      if (action.shape === 'html') {
        writeHead(res, entry, status, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders(action) });
        return res.end(`<!doctype html><html><head><title>${status}</title></head><body><h1>${message}</h1></body></html>`);
      }
      if (action.shape === 'plain') {
        writeHead(res, entry, status, { 'Content-Type': 'text/plain', ...extraHeaders(action) });
        return res.end(message);
      }
      return sendJson(res, entry, status, errorBody({ ...action, param: action.param ? fill(action.param) : action.param }, status, message), extraHeaders(action));
    }
    case 'redirect':
      writeHead(res, entry, action.status ?? 307, { Location: action.location });
      return res.end();
    case 'big': {
      writeHead(res, entry, 200, { 'Content-Type': 'application/json' });
      const filler = 'x'.repeat(64 * 1024);
      let written = 0;
      res.write('{"choices":[{"index":0,"message":{"role":"assistant","content":"');
      while (written < (action.bytes ?? 1_600_000) && !res.destroyed && !signal.aborted) {
        written += filler.length;
        if (!res.write(filler)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
      }
      if (!res.destroyed) res.end('"},"finish_reason":"stop"}]}');
      return;
    }
    case 'destroy':
      writeHead(res, entry, 200, { 'Content-Type': 'application/json' });
      res.write('{"choices":[{"index":0,');
      setTimeout(() => res.socket?.destroy(), 30);
      return;
    default:
      return sendJson(res, entry, 500, { error: { message: 'unknown fixture action', type: 'fixture_error' } });
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return { tooLarge: true };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return { body: text ? JSON.parse(text) : null }; } catch { return { body: null, invalid: true }; }
}

async function vendor(req, res, listener, path) {
  const controller = new AbortController();
  let entry = null;
  let closed = false;
  inflight++;
  maxInflight = Math.max(maxInflight, inflight);
  res.on('close', () => {
    if (closed) return;
    closed = true;
    inflight--;
    if (entry) {
      entry.aborted = !res.writableFinished;
      entry.finishedAt = Date.now() - started;
    }
    controller.abort();
  });
  let parsed;
  try { parsed = await readBody(req); } catch { return; }
  if (parsed.tooLarge) { res.writeHead(413, { 'Content-Type': 'text/plain' }); return res.end('request too large'); }
  const body = parsed.body;
  const instruction = instructionOf(body);
  entry = record(req, listener, path, body, instruction);
  const ctx = { res, entry, signal: controller.signal };
  if (!body || typeof body !== 'object') return perform({ type: 'error', status: 400, message: 'Invalid JSON body.' }, ctx);
  if (path.startsWith('/v1/') && !entry.authOk) {
    return perform({ type: 'error', status: 401, message: 'Incorrect API key provided.', errType: 'invalid_request_error', code: 'invalid_api_key' }, ctx);
  }
  const model = models[entry.model];
  if (model && entry.tokenFields.length > 1) {
    return perform({ type: 'error', status: 400, message: 'Only one reply length field may be set.', code: 'invalid_request' }, ctx);
  }
  if (model && entry.tokenFields.length === 1 && !model.accept.includes(entry.tokenFields[0])) {
    entry.action = 'model-reject';
    return perform({
      type: 'error',
      status: model.rejectStatus ?? 400,
      shape: model.rejectShape ?? 'openai',
      message: "Unsupported parameter: '{sent}' is not supported with this model. Use '{other}' instead.",
      errType: 'invalid_request_error',
      code: 'unsupported_parameter',
      param: '{sent}',
      delayMs: model.delayMs,
    }, ctx);
  }
  const rule = takeRule(entry, instruction);
  const action = rule?.action ?? { type: entry.phase === 'receipt' ? 'text' : 'tool' };
  return perform(action, ctx);
}

async function control(req, res, url) {
  const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const input = req.method === 'POST' ? (await readBody(req)).body ?? {} : {};
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /__fixture/health':
      return reply(200, { ok: true, tls: tlsReady, simulator: 'OpenAI-compatible vendor simulator (not a real model)' });
    case 'GET /__fixture/state':
      return reply(200, {
        seq, inflight, maxInflight,
        waitingHolds: [...holds].map(([holdId, waiting]) => ({ holdId, waiting: waiting.length })),
        rules: rules.map(rule => ({ id: rule.id, tag: rule.tag ?? null, phase: rule.phase ?? 'any', used: rule.used, times: rule.times })),
        models,
        tls: tlsReady,
      });
    case 'GET /__fixture/trace': {
      const tag = url.searchParams.get('tag');
      const since = Number(url.searchParams.get('sinceSeq') || 0);
      return reply(200, { records: trace.filter(entry => entry.seq > since && (!tag || entry.tag === tag)) });
    }
    case 'POST /__fixture/reset':
      rules = [];
      models = {};
      releaseAll();
      maxInflight = inflight;
      return reply(200, { ok: true });
    case 'POST /__fixture/max-reset':
      maxInflight = inflight;
      return reply(200, { ok: true, maxInflight });
    case 'POST /__fixture/rules': {
      const added = (Array.isArray(input.rules) ? input.rules : []).map(rule => ({ ...rule, id: `r${seq}-${Math.random().toString(36).slice(2, 8)}`, used: 0, times: Number.isInteger(rule.times) ? rule.times : 1 }));
      rules.push(...added);
      return reply(200, { ok: true, ids: added.map(rule => rule.id) });
    }
    case 'POST /__fixture/models':
      for (const [name, value] of Object.entries(input.models ?? {})) {
        if (value === null) delete models[name];
        else models[name] = { accept: Array.isArray(value.accept) ? value.accept : TOKEN_FIELDS, rejectStatus: value.rejectStatus, rejectShape: value.rejectShape, delayMs: value.delayMs };
      }
      return reply(200, { ok: true, models });
    case 'POST /__fixture/release':
      return reply(200, { ok: true, released: input.all ? releaseAll() : release(String(input.holdId)) });
    default:
      return reply(404, { error: 'unknown control path' });
  }
}

const VENDOR_PATHS = new Set(['/v1/chat/completions', '/v1/redirected', '/chat/completions']);

function handler(listener) {
  return (req, res) => {
    const url = new URL(req.url, 'http://fixture.local');
    if (listener === 'http' && url.pathname.startsWith('/__fixture/')) {
      control(req, res, url).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
      return;
    }
    if (req.method === 'POST' && VENDOR_PATHS.has(url.pathname)) {
      vendor(req, res, listener, url.pathname).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }));
  };
}

const certFile = `${TLS_DIR}/server.pem`;
const keyFile = `${TLS_DIR}/server-key.pem`;
const tlsReady = existsSync(certFile) && existsSync(keyFile) && statSync(certFile).size > 0 && statSync(keyFile).size > 0;

http.createServer(handler('http')).listen(PORT, '0.0.0.0', () => {
  console.log(`AI vendor simulator (not a real model) listening on :${PORT}${tlsReady ? ` and TLS :${TLS_PORT}` : ''}`);
});
if (tlsReady) {
  https.createServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, handler('https')).listen(TLS_PORT, '0.0.0.0');
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => process.exit(0));
