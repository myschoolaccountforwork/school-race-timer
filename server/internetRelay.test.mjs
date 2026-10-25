import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRelayServer } from './relayServer.ts';
import { TimerRelay, timerRelayMiddleware } from './timerRelay.ts';
import { publicHttpsOrigin, relayBaseUrl, timingJoinUrl } from '../src/features/timing/relayUrls.ts';

const site = 'https://raceflow.example.org';
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body, token, origin = site) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}

test('standalone production service: CORS, eight lanes, reconnect, permissions and next-race continuity', async t => {
  let now = 1000;
  const relay = new TimerRelay(() => now);
  const server = createRelayServer({ NODE_ENV: 'production', TIMER_ALLOWED_ORIGINS: site }, relay);
  const request = await listen(t, server);
  assert.equal((await request('/healthz')).status, 200);
  const created = await request('/api/timer/create', { laneCount: 8 });
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('access-control-allow-origin'), site);
  const chief = created.body;
  const volunteers = [];
  for (const lane of [1, 1, 2]) {
    const token = randomBytes(24).toString('hex');
    const result = await request('/api/timer/join', { sessionId: chief.sessionId, joinToken: chief.joinToken, lane, token });
    assert.equal(result.status, 200); volunteers.push(result.body);
  }
  const state = who => request(`/api/timer/state?id=${chief.sessionId}`, undefined, who.token);
  let raceId = (await state(chief)).body.race.id;
  const command = (who, action, details = {}) => request('/api/timer/command', { sessionId: chief.sessionId,
    command: { id: randomUUID(), raceId, action, ...details } }, who.token);
  for (const action of ['start', 'startRelay', 'reset', 'falseStart', 'stop', 'stopLane', 'stopAll', 'correct', 'select', 'confirm', 'next']) {
    assert.equal((await command(volunteers[0], action)).status, 403);
  }
  assert.equal((await request('/api/timer/close', { sessionId: chief.sessionId }, volunteers[0].token)).status, 403);
  assert.equal((await state({ token: chief.joinToken })).status, 403);
  const started = await command(chief, 'startRelay');
  assert.equal(started.status, 200);
  assert.equal(started.body.race.startedAt, now);
  assert.equal(started.body.race.startReference, 'relay');
  now += 1000;
  for (const [index, who] of volunteers.entries()) {
    assert.equal((await command(who, 'submit', { lane: index === 2 ? 2 : 1, milliseconds: 990 + index, status: '', uncertainty: 2 })).status, 200);
  }
  const before = (await state(chief)).body;
  assert.equal(before.submissions.length, 3);
  assert.equal(before.race.lanes[0].milliseconds, null);
  assert.equal((await command(chief, 'stopAll', { at: now, uncertainty: 1 })).status, 200);
  assert.equal((await command(chief, 'confirm')).status, 200);
  assert.equal((await state(chief)).body.history[0].startReference, 'relay');
  now += 10000; // Chief app switch: resume with the same stored bearer credential.
  assert.equal((await state(chief)).body.race.state, 'confirmed');
  assert.equal((await command(chief, 'next')).status, 200);
  const next = (await state(volunteers[0])).body;
  assert.equal(next.volunteers.length, 3);
  assert.equal(next.race.number, 2);
  assert.notEqual(next.race.id, raceId);
  assert.equal(next.submissions.length, 0);
  assert.equal((await command(volunteers[0], 'submit', { lane: 1, milliseconds: 100, status: '', uncertainty: 1 })).status, 409);
  raceId = next.race.id;
  const serialized = JSON.stringify(next);
  for (const secret of [chief.token, chief.joinToken, ...volunteers.map(v => v.token)]) assert.ok(!serialized.includes(secret));
  const foreign = await request('/api/timer/create', { laneCount: 1 }, undefined, 'https://hostile.example');
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(`http://127.0.0.1:${server.address().port}/api/timer/state`, { method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), site);
});

test('strict schemas, invalid access, bounded requests and rate limiting', async t => {
  const request = await listen(t, createRelayServer({ NODE_ENV: 'production', TIMER_ALLOWED_ORIGINS: site }));
  for (const body of [null, [], { laneCount: 8, student: 'rejected' }, { laneCount: '8' }, { laneCount: 99 }, { laneCount: 1, number: Infinity }]) {
    assert.equal((await request('/api/timer/create', body)).status, 400);
  }
  assert.equal((await request('/api/timer/create', { laneCount: 1, extra: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request('/api/timer/join', { sessionId: 'bad', joinToken: 'bad', token: 'bad', lane: 1 })).status, 400);
  assert.equal((await request('/api/timer/state?id=missing')).status, 404);
  const middleware = timerRelayMiddleware(new TimerRelay(), { production: true, allowedOrigins: [site], rateLimit: 2 });
  const limited = await listen(t, createServer((req, res) => void middleware(req, res, () => res.end())));
  assert.equal((await limited('/api/timer/create', { laneCount: 1 })).status, 200);
  assert.equal((await limited('/api/timer/create', { laneCount: 1 })).status, 200);
  assert.equal((await limited('/api/timer/create', { laneCount: 1 })).status, 429);
  assert.throws(() => createRelayServer({ NODE_ENV: 'production' }), /required/);
  assert.throws(() => createRelayServer({ NODE_ENV: 'production', TIMER_ALLOWED_ORIGINS: '*' }));
});

test('expiration: idle and hard lifetime despite volunteer activity; restart loses sessions', () => {
  let now = 0;
  const relay = new TimerRelay(() => now);
  const chief = relay.create(8);
  const lane = relay.join(chief.sessionId, chief.joinToken, 1, randomBytes(24).toString('hex'));
  for (let hour = 1; hour <= 16; hour++) { now = hour * 3600000; relay.snapshot(chief.sessionId, lane.token); }
  now++; relay.prune();
  assert.equal(relay.sessions.size, 0);
  const other = relay.create(8);
  now += 4 * 3600000 + 1; relay.prune();
  assert.equal(relay.sessions.size, 0);
  assert.throws(() => new TimerRelay().snapshot(other.sessionId, other.token), /restarted/);
});

test('public QR links exclude Chief credentials and disallow private production origins', () => {
  const env = { PROD: true, VITE_PUBLIC_SITE_URL: site, VITE_TIMER_RELAY_URL: 'https://relay.example.org' };
  const link = new URL(timingJoinUrl('session-id', 'join-token', env, 'http://localhost:5173'));
  assert.equal(link.origin, site);
  assert.equal(link.pathname, '/timing/join'); assert.equal(link.search, '');
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('key'), 'join-token');
  assert.equal(relayBaseUrl(env), 'https://relay.example.org');
  for (const origin of ['http://localhost:5173', 'https://192.168.1.2', 'https://127.0.0.1', 'https://[::1]', 'https://timer.local', 'https://user:secret@example.org']) {
    assert.throws(() => publicHttpsOrigin(origin));
    assert.equal(timingJoinUrl('id', 'key', { PROD: true }, origin), '');
  }
  assert.throws(() => relayBaseUrl({ PROD: true }), /missing/);
  assert.equal(relayBaseUrl({ PROD: false }), '');
  assert.match(timingJoinUrl('id', 'key', { PROD: false }, 'http://192.168.1.2:5173'), /^http:\/\/192/);
});
