import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { TimerRelay, timerRelayMiddleware } from './timerRelay.ts';

export function createRelayServer(env = process.env, relay = new TimerRelay()) {
  const production = env.NODE_ENV === 'production';
  const allowedOrigins = (env.TIMER_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (production && !allowedOrigins.length) throw new Error('TIMER_ALLOWED_ORIGINS is required in production.');
  for (const value of allowedOrigins) {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || (production && url.protocol !== 'https:')) {
      throw new Error('Allowed origins must be exact HTTPS origins in production.');
    }
  }
  const middleware = timerRelayMiddleware(relay, { production, allowedOrigins });
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end('{"ok":true}'); return;
    }
    void middleware(request, response, () => { response.writeHead(404); response.end(); });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  const cleanup = setInterval(() => relay.prune(), 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelayServer();
  server.listen(Number(process.env.PORT ?? 8787), '0.0.0.0', () => console.log('RaceFlow timing relay listening'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
    server.close(); server.closeIdleConnections();
  });
}
