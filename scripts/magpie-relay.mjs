import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const ca = readFileSync(process.env.MAGPIE_CA_FILE || '/Users/steve/Dropbox/Steve/code/magpie/magpie.crt');
let gatewayKey = '';
let busy = false;
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function gateway(path, body, signal) {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(path, 'https://10.0.0.164'), {
      ca, method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${gatewayKey}`, 'Content-Type': 'application/json' },
      timeout: 80000,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (text.length > 1024 * 1024) request.destroy(new Error('Response too large'));
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          const error = new Error(`Magpie HTTP ${response.statusCode}`);
          error.upstreamStatus = response.statusCode;
          try { const value = JSON.parse(text); error.upstreamType = value.error?.type; error.upstreamCode = value.error?.code; } catch {}
          reject(error);
        }
        else { try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid Magpie response')); } }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Magpie timeout')));
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

const server = http.createServer(async (request, response) => {
  if (request.headers.origin || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return json(response, 403, { error: 'Local backend only' });
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ready: Boolean(gatewayKey) });
  if (request.method === 'GET' && request.url === '/models') {
    if (!gatewayKey) return json(response, 503, { error: 'Magpie not connected' });
    try { return json(response, 200, await gateway('/v1/models')); }
    catch { return json(response, 502, { error: 'Magpie models unavailable' }); }
  }
  if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json') || !['/bootstrap', '/chat/completions'].includes(request.url)) return json(response, 404, { error: 'Not found' });
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  let body = '';
  try {
    for await (const chunk of request) {
      body += chunk.toString();
      if (body.length > 65536) return json(response, 413, { error: 'Request too large' });
    }
    const data = JSON.parse(body);
    if (request.url === '/bootstrap') {
      if (gatewayKey) return json(response, 409, { error: 'Already connected' });
      if (typeof data.key !== 'string' || data.key.length < 20 || data.key.length > 512) return json(response, 400, { error: 'Invalid key' });
      gatewayKey = data.key;
      try { await gateway('/v1/models', undefined, controller.signal); }
      catch { gatewayKey = ''; return json(response, 502, { error: 'Magpie authentication failed' }); }
      return json(response, 200, { ready: true });
    }
    if (!gatewayKey) return json(response, 503, { error: 'Magpie not connected' });
    if (busy) return json(response, 429, { error: 'Magpie busy' });
    if (typeof data.model !== 'string' || !Array.isArray(data.messages) || data.stream) return json(response, 400, { error: 'Invalid request' });
    busy = true;
    try { return json(response, 200, await gateway('/v1/chat/completions', data, controller.signal)); }
    finally { busy = false; }
  } catch (error) {
    if (!response.destroyed) json(response, 502, { error: 'Magpie request failed', upstreamStatus: error.upstreamStatus, upstreamType: error.upstreamType, upstreamCode: error.upstreamCode });
  }
});
server.listen(38142, '127.0.0.1', () => console.log('Local Magpie relay listening on 127.0.0.1:38142; key stays in memory.'));
function shutdown() { gatewayKey = ''; server.close(); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
