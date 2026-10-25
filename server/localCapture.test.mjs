import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { CaptureJournal, chiefElapsed } from '../src/features/timing/localCapture.ts';
import { TimerRelay } from './timerRelay.ts';
import { createRelayServer } from './relayServer.ts';

function storage() {
  const data = new Map();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}
function fixture(lanes = 8) {
  const relay = new TimerRelay(() => 9000000);
  const chief = relay.create(lanes);
  const lane = relay.join(chief.sessionId, chief.joinToken, 1, randomBytes(24).toString('hex'));
  const state = who => relay.snapshot(chief.sessionId, who.token);
  const deliver = who => async capture => { relay.command(chief.sessionId, who.token, { id: capture.id, raceId: capture.raceId, action: 'localCapture', capture }); };
  const command = (action, details = {}) => relay.command(chief.sessionId, chief.token, { id: randomUUID(), raceId: state(chief).race.id, action, ...details });
  return { relay, chief, lane, state, deliver, command };
}

test('capture clock is read before IDs and storage; timestamps are immutable and persisted before delivery', async () => {
  const order = [];
  const disk = storage();
  const journal = new CaptureJournal({ ...disk, setItem(k, v) { order.push('saved'); disk.setItem(k, v); } }, 'journal', randomUUID(), () => { order.push('clock'); return 1234.5; }, () => { order.push('id'); return randomUUID(); });
  const capture = journal.add('start', randomUUID());
  assert.deepEqual(order, ['clock', 'id', 'saved']);
  assert.equal(capture.localAt, 1234.5);
  assert.throws(() => { capture.localAt = 9000; }, TypeError);
  await journal.flush(async sent => {
    assert.equal(JSON.parse(disk.getItem('journal')).records[0].capture.localAt, 1234.5);
    assert.equal(sent.localAt, 1234.5); order.push('delivery');
  });
  assert.equal(journal.records[0].delivery, 'received');
});

test('eight closely spaced Chief finishes capture while Start acknowledgement is delayed', async () => {
  const f = fixture(); const disk = storage(); let now = 1000;
  const journal = new CaptureJournal(disk, 'chief', randomUUID(), () => now);
  const raceId = f.state(f.chief).race.id;
  const start = journal.add('start', raceId);
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const sending = journal.flush(async c => { await delayed; await f.deliver(f.chief)(c); });
  const finishes = [];
  for (let lane = 1; lane <= 8; lane++) {
    now = 11000 + lane;
    finishes.push(journal.add('finish', raceId, lane, start.id));
  }
  assert.equal(journal.records.length, 9);
  assert.ok(journal.records.every(r => r.delivery === 'saved'));
  assert.deepEqual(finishes.map(c => chiefElapsed(start, c)), [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008]);
  assert.equal(f.state(f.chief).race.state, 'ready'); // no acknowledgement yet
  release(); await sending; await journal.flush(f.deliver(f.chief));
  const state = f.state(f.chief);
  assert.equal(state.race.state, 'stopped');
  assert.equal(state.race.chiefStart.localAt, 1000);
  assert.deepEqual(state.race.lanes.map(l => l.milliseconds), [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008]);
  assert.ok(state.race.lanes.every(l => l.timingSource === 'chief-local'));
  assert.equal(f.state(f.lane).race.chiefStart.id, start.id);
});

test('lost acknowledgement and reconnect retry identical immutable records without duplicate results', async () => {
  const f = fixture(1); const disk = storage(); let now = 200;
  const journal = new CaptureJournal(disk, 'chief', randomUUID(), () => now);
  const raceId = f.state(f.chief).race.id;
  const start = journal.add('start', raceId);
  await journal.flush(async c => { await f.deliver(f.chief)(c); throw new Error('Response lost'); });
  assert.equal(journal.records[0].delivery, 'saved');
  now = 15200;
  const finish = journal.add('finish', raceId, 1, start.id);
  const restored = new CaptureJournal(disk, 'chief', randomUUID(), () => 9999999);
  assert.equal(restored.start(raceId), undefined); // reload cannot recreate an active monotonic clock
  await restored.flush(f.deliver(f.chief));
  assert.equal(f.state(f.chief).captures.length, 2);
  assert.equal(f.state(f.chief).race.lanes[0].milliseconds, 15000);
  await f.deliver(f.chief)(finish);
  assert.equal(f.state(f.chief).captures.length, 2);
  await assert.rejects(f.deliver(f.chief)({ ...finish, localAt: finish.localAt + 1 }), /different data/);
  await assert.rejects(f.deliver(f.chief)({ ...finish, id: randomUUID() }), /already exists/);
  assert.equal(restored.records[1].capture.localAt, 15200);
});

test('volunteer captures before delayed start, with poor sync, stay on original attempt and never become official', async () => {
  const f = fixture(1);
  const id = f.state(f.lane).race.id;
  const volunteer = new CaptureJournal(storage(), 'volunteer', randomUUID(), () => 500000);
  const raw = volunteer.add('finish', id, 1, undefined, { localMidpoint: 499000, serverTime: 9000000, uncertainty: 800 });
  await volunteer.flush(f.deliver(f.lane)); // allowed while armed; no received start needed
  const chief = new CaptureJournal(storage(), 'chief', randomUUID(), () => 500);
  chief.add('start', id);
  await chief.flush(f.deliver(f.chief));
  const received = f.state(f.chief).captures.find(c => c.id === raw.id);
  assert.equal(received.raceId, id);
  assert.equal(received.startId, undefined); // no silent amendment after late start
  assert.equal(received.verification, 'pending');
  assert.equal(received.evidence.uncertainty, 800);
  assert.equal(f.state(f.chief).race.lanes[0].milliseconds, null);
  assert.throws(() => f.command('select', { lane: 1, submissionId: raw.id }), /not found/);
  f.command('falseStart');
  const nextId = f.state(f.lane).race.id;
  assert.notEqual(nextId, id);
  await f.deliver(f.lane)(raw); // identical replay only acknowledges old attempt
  assert.equal(f.state(f.chief).captures.length, 0);
  assert.equal(f.state(f.chief).race.id, nextId);
  volunteer.add('finish', nextId, 1);
  await volunteer.flush(f.deliver(f.lane));
  assert.equal(f.state(f.chief).captures[0].raceId, nextId);
  assert.equal(f.state(f.chief).volunteers.length, 1);
});

test('late uploads after reset are archived, never reassigned; next race retains volunteer assignment', async () => {
  const f = fixture(1); let now = 100;
  const chief = new CaptureJournal(storage(), 'chief', randomUUID(), () => now);
  const id = f.state(f.chief).race.id;
  const start = chief.add('start', id); await chief.flush(f.deliver(f.chief));
  const volunteer = new CaptureJournal(storage(), 'lane', randomUUID(), () => 60000);
  const raw = volunteer.add('finish', id, 1, start.id);
  f.command('reset');
  await volunteer.flush(f.deliver(f.lane));
  assert.equal(f.state(f.chief).captures.length, 0);
  assert.equal(f.relay.get(f.chief.sessionId).captures.find(c => c.id === raw.id).raceId, id);
  const next = f.state(f.chief).race.id;
  const s = chief.add('start', next); await chief.flush(f.deliver(f.chief));
  now = 20100; chief.add('finish', next, 1, s.id); await chief.flush(f.deliver(f.chief));
  f.command('confirm'); f.command('next');
  assert.equal(f.state(f.lane).race.number, 2);
  assert.equal(f.state(f.lane).volunteers[0].lane, 1);
  assert.equal(f.state(f.chief).history[0].chiefStart.id, s.id);
});

test('storage failures preserve memory capture, block unsaved delivery, and allow explicit save retry', async () => {
  const disk = storage(); let fail = true;
  const journal = new CaptureJournal({ ...disk, setItem(k, v) { if (fail) throw new Error('quota'); disk.setItem(k, v); } }, 'capture', randomUUID(), () => 100);
  const capture = journal.add('finish', randomUUID(), 1);
  assert.equal(journal.records[0].delivery, 'captured');
  assert.match(journal.error, /memory only/);
  let deliveries = 0;
  await journal.flush(async () => { deliveries++; }); assert.equal(deliveries, 0);
  fail = false; assert.equal(journal.save(), true);
  await journal.flush(async sent => { assert.deepEqual(sent, capture); deliveries++; });
  assert.equal(deliveries, 1);
  disk.setItem('broken', 'bad json');
  const broken = new CaptureJournal(disk, 'broken');
  assert.equal(broken.loadFailed, true);
  assert.throws(() => broken.add('start', randomUUID()), /cannot be read/);
  assert.equal(disk.getItem('broken'), 'bad json');
});

test('clock interruption or rollback cannot produce a Chief elapsed time in a different epoch', () => {
  let now = 1000;
  const journal = new CaptureJournal(storage(), 'clock', randomUUID(), () => now);
  const raceId = randomUUID(); const start = journal.add('start', raceId);
  now = 900;
  const finish = journal.add('finish', raceId, 1, start.id);
  assert.notEqual(finish.epochId, start.epochId);
  assert.equal(chiefElapsed(start, finish), null);
  assert.equal(journal.start(raceId), undefined);
  const prior = JSON.stringify(journal.records);
  journal.interrupt(); assert.equal(JSON.stringify(journal.records), prior);
  now = 2000;
  const freshId = randomUUID(); journal.add('start', freshId);
  assert.ok(journal.start(freshId));
});

test('capture permissions and schemas reject control attempts, lane spoofing and student fields', async () => {
  const f = fixture();
  const id = f.state(f.chief).race.id;
  const start = { id: randomUUID(), raceId: id, epochId: randomUUID(), localAt: 100, kind: 'start' };
  await assert.rejects(f.deliver(f.lane)(start), /Only the Chief/);
  await f.deliver(f.chief)(start);
  const finish = { ...start, id: randomUUID(), kind: 'finish', startId: start.id, localAt: 200, lane: 2 };
  await assert.rejects(f.deliver(f.lane)(finish), /assignment/);
  await assert.rejects(f.deliver(f.chief)({ ...finish, studentName: 'rejected' }), /Unexpected capture fields/);
  await assert.rejects(f.deliver(f.chief)({ ...finish, evidence: { localMidpoint: 1, serverTime: 1, uncertainty: 1, student: 'rejected' } }), /evidence fields/);
  await assert.rejects(f.deliver(f.chief)({ ...finish, epochId: randomUUID() }), /continuity/);
  await assert.rejects(f.deliver(f.chief)({ ...finish, raceId: randomUUID() }), /Unknown race/);
  assert.equal(f.state(f.chief).captures.length, 1);
});

test('received original start references survive later races and reload without amending captures', () => {
  const disk = storage(); const journal = new CaptureJournal(disk, 'volunteer', randomUUID(), () => 5000);
  const raceId = randomUUID(); const raw = journal.add('finish', raceId, 1);
  const original = JSON.stringify(raw);
  const reference = { id: randomUUID(), raceId, epochId: randomUUID(), localAt: 1000, kind: 'start' };
  journal.rememberStart(reference); journal.rememberStart(reference);
  assert.equal(journal.references.length, 1);
  const restored = new CaptureJournal(disk, 'volunteer');
  assert.deepEqual(restored.references[0], reference);
  assert.equal(JSON.stringify(restored.records[0].capture), original);
  assert.equal(restored.records[0].capture.startId, undefined);
});

test('multiple volunteers on one lane retain separate pending captures; late captures cannot edit locked results', async () => {
  const f = fixture(1);
  const second = f.relay.join(f.chief.sessionId, f.chief.joinToken, 1, randomBytes(24).toString('hex'));
  const id = f.state(f.chief).race.id;
  const chief = new CaptureJournal(storage(), 'chief', randomUUID(), () => 1000);
  const start = chief.add('start', id); await chief.flush(f.deliver(f.chief));
  f.command('correct', { lane: 1, milliseconds: 15000, status: '' }); f.command('confirm');
  for (const who of [f.lane, second]) {
    const journal = new CaptureJournal(storage(), 'lane', randomUUID(), () => 80000);
    journal.add('finish', id, 1, start.id); await journal.flush(f.deliver(who));
  }
  const state = f.state(f.chief);
  assert.equal(state.captures.filter(c => c.source === 'lane').length, 2);
  assert.equal(state.race.state, 'confirmed');
  assert.equal(state.race.lanes[0].milliseconds, 15000);
  assert.equal(state.history[0].lanes[0].milliseconds, 15000);
});

test('manual recovery, DNS false-start retention, DNF/DQ selection and locking remain available', async () => {
  const f = fixture(2); const raceId = f.state(f.chief).race.id;
  const journal = new CaptureJournal(storage(), 'chief', randomUUID(), () => 1000);
  journal.add('start', raceId); await journal.flush(f.deliver(f.chief));
  // After reload/no continuous Chief clock, independent manual results can resolve a race.
  f.command('correct', { lane: 1, milliseconds: null, status: 'DNF' });
  f.command('correct', { lane: 2, milliseconds: null, status: 'DQ' });
  assert.equal(f.state(f.chief).race.state, 'stopped');
  assert.ok(f.state(f.chief).race.lanes.every(l => l.timingSource === 'manual'));
  f.command('confirm'); assert.throws(() => f.command('reset'), /locked/);
  f.command('next');
  f.command('correct', { lane: 1, milliseconds: null, status: 'DNS' });
  f.command('falseStart');
  assert.equal(f.state(f.chief).race.lanes[0].status, 'DNS');
  assert.equal(f.state(f.lane).volunteers[0].lane, 1);
});

test('standalone HTTP service accepts durable raw captures and exposes no credentials or official volunteer times', async t => {
  const origin = 'https://raceflow.example.org';
  const server = createRelayServer({ NODE_ENV: 'production', TIMER_ALLOWED_ORIGINS: origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/timer/`;
  async function post(path, body, token, expected = 200) {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, expected); return response.json();
  }
  const chief = await post('create', { laneCount: 8 });
  const lane = await post('join', { sessionId: chief.sessionId, joinToken: chief.joinToken, lane: 1, token: randomBytes(24).toString('hex') });
  const initial = await (await fetch(`${base}state?id=${chief.sessionId}`, { headers: { Origin: origin, Authorization: `Bearer ${chief.token}` } })).json();
  const start = { id: randomUUID(), raceId: initial.race.id, epochId: randomUUID(), localAt: 123.45, kind: 'start' };
  const send = (capture, who, expected = 200) => post('command', { sessionId: chief.sessionId, command: { id: capture.id, raceId: capture.raceId, action: 'localCapture', capture } }, who.token, expected);
  const started = await send(start, chief);
  assert.deepEqual(started.race.chiefStart, start);
  assert.equal(started.race.startedAt, null); // never substitute receipt time
  const raw = { id: randomUUID(), raceId: start.raceId, epochId: randomUUID(), localAt: 90000, kind: 'finish', lane: 1, startId: start.id };
  await send(raw, lane);
  const wrongOwner = await send(raw, chief, 409);
  assert.match(wrongOwner.error, /different data/); // a different owner cannot reuse the same command ID
  const snapshot = await (await fetch(`${base}state?id=${chief.sessionId}`, { headers: { Origin: origin, Authorization: `Bearer ${chief.token}` } })).json();
  assert.equal(snapshot.captures.find(c => c.id === raw.id).verification, 'pending');
  assert.equal(snapshot.race.lanes[0].milliseconds, null);
  for (const token of [chief.token, chief.joinToken, lane.token]) assert.ok(!JSON.stringify(snapshot).includes(token));
});
