import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { TimerRelay, timerRelayMiddleware } from './timerRelay.ts';
import { bestClock, clockSample, serverTimeAt, clockUncertainty, clockReadiness } from '../src/features/timing/relayClock.ts';
import { startDisabledReason } from '../src/features/timing/relayReadiness.ts';

function fixture(lanes = 2) {
  let now = 1000;
  const relay = new TimerRelay(() => now);
  const chief = relay.create(lanes);
  const join = lane => relay.join(chief.sessionId, chief.joinToken, lane, randomBytes(24).toString('hex'));
  const snapshot = who => relay.snapshot(chief.sessionId, who.token);
  const command = (who, action, details = {}) => relay.command(chief.sessionId, who.token, {
    id: randomUUID(), raceId: snapshot(chief).race.id, action,
    ...(['start', 'stop', 'stopLane', 'stopAll'].includes(action) ? { at: now, uncertainty: 2 } : {}), ...details,
  });
  return { relay, chief, join, snapshot, command, advance: ms => { now += ms; } };
}

test('clock midpoint accounts for transit; samples expire and lowest round trip wins', () => {
  const slow = clockSample(100, 300, 1200);
  const fast = clockSample(400, 420, 1410);
  assert.equal(serverTimeAt(fast, 510), 1510);
  assert.equal(fast.uncertainty, 10);
  assert.deepEqual(bestClock([slow, fast], 500), fast);
  assert.equal(bestClock([fast], 16000), null);
  // A different phone's monotonic origin can be entirely unrelated.
  const phone = clockSample(100000, 100020, 1410);
  assert.equal(serverTimeAt(phone, 100110), 1510);
});

test('hosted 400 ms round trips stay unsafe for finishes but no longer block relay-receipt start', () => {
  // A browser and relay have unrelated monotonic origins; map via midpoint.
  const samples = Array.from({ length: 30 }, (_, i) => clockSample(100000 + i * 1150, 100400 + i * 1150, 9000000 + i * 1150));
  const now = 100400 + 29 * 1150;
  const sample = bestClock(samples, now);
  assert.equal(sample.uncertainty, 200);
  assert.match(clockReadiness(true, sample, sample, now), /exceeds 100 ms/);
  assert.equal(serverTimeAt(samples[0], 100200), 9000000);
  const f = fixture();
  const readiness = { role: 'chief', connected: true, chiefConnected: true, busy: false, pending: false, race: f.snapshot(f.chief).race, synchronised: false };
  assert.match(startDisabledReason({ ...readiness, reference: 'tap' }), /requires a fresh clock/);
  assert.equal(startDisabledReason({ ...readiness, reference: 'relay' }), '');
  assert.match(startDisabledReason({ ...readiness, reference: 'relay', connected: false }), /connection/);
  assert.match(startDisabledReason({ ...readiness, reference: 'relay', pending: true }), /acknowledged/);
  assert.match(startDisabledReason({ ...readiness, reference: 'relay', role: 'lane' }), /Only the Chief/);
  const a = f.join(1);
  assert.throws(() => f.command(f.chief, 'start', { uncertainty: 200 }), /synchronised/);
  assert.throws(() => f.command(a, 'startRelay'), /Only the Chief/);
  assert.throws(() => f.command(f.chief, 'startRelay', { at: 1, uncertainty: 0 }), /must not supply/);
  f.advance(500); // Unknown delivery delay: use receipt, never pretend this was the tap.
  const id = randomUUID();
  f.command(f.chief, 'startRelay', { id });
  assert.equal(f.snapshot(f.chief).race.startedAt, 1500);
  assert.equal(f.snapshot(f.chief).race.startReference, 'relay');
  f.advance(1000);
  f.command(f.chief, 'startRelay', { id });
  assert.equal(f.snapshot(f.chief).race.startedAt, 1500); // lost acknowledgement retry
  assert.throws(() => f.command(a, 'submit', { lane: 1, milliseconds: 1000, status: '', uncertainty: 200 }), /uncertain/);
  assert.throws(() => f.command(f.chief, 'stopLane', { lane: 1, uncertainty: 200 }), /synchronised/);
  assert.equal(f.snapshot(f.chief).race.lanes[0].milliseconds, null);
  f.command(a, 'submit', { lane: 1, milliseconds: 990, status: '', uncertainty: 5 });
  assert.equal(f.snapshot(f.chief).submissions[0].milliseconds, 990);
  assert.equal(f.snapshot(f.chief).race.lanes[0].milliseconds, null);
});

test('clock diagnostics distinguish stale, invalid and frozen-drift samples without relaxing safety', () => {
  for (const args of [[NaN, 20, 10], [20, 10, 10], [10, 20, Infinity]]) assert.throws(() => clockSample(...args), /Invalid relay clock/);
  const sample = clockSample(0, 100, 500000);
  assert.equal(clockReadiness(true, sample, sample, 100), '');
  assert.match(clockReadiness(false, sample, sample, 100), /connection/);
  assert.match(clockReadiness(true, bestClock([sample], 16000), sample, 16000), /15 seconds/);
  assert.equal(bestClock([{ ...sample, serverTime: NaN }], 100), null);
  assert.equal(bestClock([sample], 0), null);
  assert.ok(clockUncertainty(sample, 600000) > 100);
  const fresh = clockSample(599900, 600000, 1100000);
  assert.match(clockReadiness(true, fresh, sample, 600000), /including drift/);
});
test('several volunteers may share a lane; Chief selects one official result', () => {
  const f = fixture(); const a = f.join(1); const b = f.join(1);
  assert.equal(f.snapshot(f.chief).volunteers.length, 2);
  f.command(f.chief, 'start'); f.advance(12000);
  f.command(a, 'submit', { lane: 1, milliseconds: 11980, status: '', uncertainty: 5 });
  f.command(b, 'submit', { lane: 1, milliseconds: 12000, status: '', uncertainty: 5 });
  let state = f.snapshot(f.chief);
  assert.equal(state.submissions.length, 2);
  assert.equal(state.race.lanes[0].milliseconds, null);
  assert.equal(f.snapshot(a).submissions.length, 1);
  f.command(f.chief, 'select', { lane: 1, submissionId: state.submissions[0].id });
  assert.equal(f.snapshot(f.chief).race.lanes[0].milliseconds, 11980);
  f.command(f.chief, 'stopLane', { lane: 2 });
  state = f.snapshot(f.chief);
  assert.equal(state.race.state, 'stopped');
  f.command(f.chief, 'confirm');
  assert.equal(f.snapshot(f.chief).history.length, 1);
  f.command(f.chief, 'next');
  assert.equal(f.snapshot(a).race.number, 2);
  assert.equal(f.snapshot(a).volunteers.length, 2);
  assert.equal(f.snapshot(a).submissions.length, 0);
});
test('permissions, invalid lanes and session isolation are enforced', () => {
  const f = fixture(); const a = f.join(1);
  assert.throws(() => f.join(3), /Invalid lane/);
  assert.throws(() => f.relay.join(f.chief.sessionId, 'bad', 1, randomBytes(24).toString('hex')), /Invalid join/);
  assert.throws(() => f.command(a, 'start'), /Only the Chief/);
  assert.throws(() => f.command(a, 'correct', { lane: 1, milliseconds: 100, status: '' }), /Only the Chief/);
  assert.throws(() => f.snapshot({ token: 'bad' }), /denied/);
  const other = f.relay.create(1);
  assert.throws(() => f.relay.snapshot(other.sessionId, a.token), /denied/);
  f.command(f.chief, 'start'); f.advance(1000);
  assert.throws(() => f.command(a, 'submit', { lane: 2, milliseconds: 1000, status: '', uncertainty: 1 }), /assignment/);
});
test('idempotent retries do not duplicate results, and changed command payloads are rejected', () => {
  const f = fixture(); const a = f.join(1);
  f.command(f.chief, 'start'); f.advance(1000);
  const id = randomUUID();
  const details = { id, lane: 1, milliseconds: 995, status: '', uncertainty: 2 };
  f.command(a, 'submit', details); f.command(a, 'submit', details);
  assert.equal(f.snapshot(f.chief).submissions.length, 1);
  assert.throws(() => f.command(a, 'submit', { ...details, milliseconds: 990 }), /different data/);
  assert.throws(() => f.command(a, 'submit', { ...details, id: randomUUID() }), /Already submitted/);
});
test('false starts invalidate late submissions and retain official DNS', () => {
  const f = fixture(); const a = f.join(1);
  f.command(f.chief, 'correct', { lane: 2, milliseconds: null, status: 'DNS' });
  f.command(f.chief, 'start'); const oldRaceId = f.snapshot(a).race.id;
  f.command(f.chief, 'falseStart');
  assert.notEqual(f.snapshot(a).race.id, oldRaceId);
  assert.equal(f.snapshot(a).race.lanes[1].status, 'DNS');
  assert.throws(() => f.command(a, 'submit', { raceId: oldRaceId, lane: 1, milliseconds: 1000, status: '', uncertainty: 1 }), /Stale race/);
});
test('locked races reject edits and late submissions, next requires confirmation', () => {
  const f = fixture(1); const a = f.join(1);
  assert.throws(() => f.command(f.chief, 'next'), /Confirm/);
  f.command(f.chief, 'start'); f.advance(1000);
  f.command(f.chief, 'stopAll'); f.command(f.chief, 'confirm');
  for (const action of ['reset', 'falseStart', 'correct', 'stopLane']) assert.throws(() => f.command(f.chief, action), /locked/);
  assert.throws(() => f.command(a, 'submit', { lane: 1, milliseconds: 900, status: '', uncertainty: 1 }), /locked/);
  const copy = f.snapshot(f.chief); copy.history[0].lanes[0].milliseconds = 999;
  assert.equal(f.snapshot(f.chief).history[0].lanes[0].milliseconds, 1000);
});
test('stale Chief presence, poor sync, future finish and invalid correction are rejected', () => {
  const f = fixture(); const a = f.join(1);
  f.command(f.chief, 'start'); f.advance(1000);
  assert.throws(() => f.command(a, 'submit', { lane: 1, milliseconds: 1000, status: '', uncertainty: 101 }), /uncertain/);
  assert.throws(() => f.command(a, 'submit', { lane: 1, milliseconds: 99999, status: '', uncertainty: 1 }), /outside/);
  assert.throws(() => f.command(f.chief, 'correct', { lane: 1, milliseconds: -1, status: '' }), /Invalid milliseconds/);
  assert.throws(() => f.command(f.chief, 'correct', { lane: 1, milliseconds: 1000, status: '', student: 'not accepted' }), /Unexpected command fields/);
  f.advance(9000);
  const raceId = f.snapshot(a).race.id;
  assert.throws(() => f.relay.command(f.chief.sessionId, a.token, { id: randomUUID(), raceId, action: 'submit', lane: 1, milliseconds: 9000, status: '', uncertainty: 1 }), /Chief disconnected/);
  f.snapshot(f.chief);
  f.command(a, 'submit', { lane: 1, milliseconds: 9000, status: '', uncertainty: 1 });
});
test('chief timestamps exclude delivery delay; Stop differs from Finish all', () => {
  const f = fixture(); f.command(f.chief, 'start'); f.advance(12500);
  f.command(f.chief, 'stopLane', { lane: 1, at: 13000 }); // clicked at 12 s; received at 12.5 s
  assert.equal(f.snapshot(f.chief).race.lanes[0].milliseconds, 12000);
  f.command(f.chief, 'stop');
  assert.equal(f.snapshot(f.chief).race.lanes[1].milliseconds, null);
  assert.throws(() => f.command(f.chief, 'confirm'), /resolve every lane/);
  f.command(f.chief, 'correct', { lane: 2, milliseconds: null, status: 'DNF' });
  f.command(f.chief, 'confirm');
});
test('sessions expire and relay restarts do not restore memory', () => {
  const f = fixture(); f.advance(4 * 60 * 60 * 1000 + 1);
  assert.throws(() => f.snapshot(f.chief), /Session ended/);
  const other = new TimerRelay(); assert.throws(() => other.snapshot(f.chief.sessionId, f.chief.token), /Session ended/);
});

test('HTTP relay supports independent clients and exposes no credentials or arbitrary student fields', async t => {
  const middleware = timerRelayMiddleware();
  const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, token) => {
    const response = await fetch(`${origin}/api/timer/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { code: response.status, body: await response.json() };
  };
  const created = await post('create', { laneCount: 1, number: 1 });
  assert.equal(created.code, 200);
  const chief = created.body;
  const a = (await post('join', { sessionId: chief.sessionId, joinToken: chief.joinToken, lane: 1, token: randomBytes(24).toString('hex') })).body;
  const b = (await post('join', { sessionId: chief.sessionId, joinToken: chief.joinToken, lane: 1, token: randomBytes(24).toString('hex') })).body;
  const get = async who => (await fetch(`${origin}/api/timer/state?id=${chief.sessionId}`, { headers: { Authorization: `Bearer ${who.token}` } })).json();
  const state = await get(chief);
  assert.equal(state.volunteers.length, 2);
  const wire = JSON.stringify(state);
  assert.ok(!wire.includes(chief.token) && !wire.includes(chief.joinToken) && !wire.includes(a.token));
  assert.ok(!wire.includes('student'));
  const raceId = state.race.id;
  const sent = performance.now();
  const stateAtStart = await get(chief);
  const received = performance.now();
  const sample = clockSample(sent, received, stateAtStart.serverNow);
  const start = await post('command', { sessionId: chief.sessionId, command: { id: randomUUID(), raceId, action: 'start', at: serverTimeAt(sample, performance.now()), uncertainty: sample.uncertainty } }, chief.token);
  assert.equal(start.code, 200);
  const states = await Promise.all([get(a), get(b)]);
  assert.equal(states[0].race.state, 'running'); assert.equal(states[0].race.startedAt, states[1].race.startedAt);
  const unauthorised = await post('command', { sessionId: chief.sessionId, command: { id: randomUUID(), raceId, action: 'confirm' } }, a.token);
  assert.equal(unauthorised.code, 403);
  const foreign = await fetch(`${origin}/api/timer/create`, { method: 'POST', headers: { Origin: 'https://another-site.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ laneCount: 1 }) });
  assert.equal(foreign.status, 403);
  assert.equal((await post('close', { sessionId: chief.sessionId }, chief.token)).code, 200);
  assert.match((await get(a)).error, /Session ended/);
});
