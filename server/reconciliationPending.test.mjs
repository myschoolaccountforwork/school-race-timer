import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { TimerRelay } from './timerRelay.ts';
import { CaptureJournal } from '../src/features/timing/localCapture.ts';
import { diagnoseEvidence, reconcile } from '../src/features/timing/reconciliation.ts';

function fixture() {
  let now = 200000;
  const relay = new TimerRelay(() => now);
  const chief = relay.create(1);
  const volunteer = relay.join(chief.sessionId, chief.joinToken, 1, randomBytes(24).toString('hex'));
  const chiefEpoch = randomUUID(), volunteerEpoch = randomUUID();
  const snapshot = () => relay.snapshot(chief.sessionId, chief.token);
  const raceId = snapshot().race.id;
  const sample = (who, epochId, t1, offset, out = 10, back = 10, complete = true) => {
    const t2 = t1 + offset + out; now = t2 + 2;
    const probe = relay.clockProbe(chief.sessionId, who.token, epochId, t1, t2);
    const s = { ...probe, t4: t1 + out + 2 + back }; now += back;
    if (complete) relay.clockComplete(chief.sessionId, who.token, s);
    return s;
  };
  const send = (who, capture) => relay.command(chief.sessionId, who.token, { id: capture.id, raceId: capture.raceId, action: 'localCapture', capture });
  const start = { id: randomUUID(), raceId, epochId: chiefEpoch, kind: 'start', localAt: 110000 };
  const finish = { id: randomUUID(), raceId, epochId: volunteerEpoch, kind: 'finish', lane: 1, localAt: 720000, startId: start.id };
  const result = () => snapshot().captures.find(c => c.id === finish.id).reconciliation;
  return { relay, chief, volunteer, chiefEpoch, volunteerEpoch, raceId, snapshot, sample, send, start, finish, result,
    advance: ms => { now += ms; } };
}

test('waiting 60 seconds with ongoing sampling does not stale Chief Start or hide elapsed time', () => {
  const f = fixture();
  for (let elapsed = 0; elapsed <= 60000; elapsed += 3000) {
    f.sample(f.chief, f.chiefEpoch, 50000 + elapsed, 100000);
    f.sample(f.volunteer, f.volunteerEpoch, 660000 + elapsed, -500000);
  }
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  assert.equal(f.result().verification, 'verified'); assert.equal(f.result().milliseconds, 10000);
  assert.ok(f.result().diagnostics.start.stale > 0);
  assert.ok(f.result().diagnostics.start.usable >= 2);
  assert.ok(f.result().diagnostics.finish.usable >= 2);
  // A much later review still uses evidence near the original events.
  f.advance(60000); assert.equal(f.result().verification, 'verified');
});

test('RTTs like the physical test calculate a time but remain unverified, not Pending', () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) {
    f.sample(f.chief, f.chiefEpoch, 98000 + i * 2000, 100000, 100, 117);
    f.sample(f.volunteer, f.volunteerEpoch, 708000 + i * 2000, -500000, 190, 222);
  }
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const r = f.result(); assert.equal(r.verification, 'unverified');
  assert.ok(r.milliseconds > 0 && r.uncertainty > 300);
  assert.equal(r.start.roundTrip, 217); assert.equal(r.finish.roundTrip, 412);
});

test('reload after 64 old samples cannot evict every new-epoch sample and strand a received Finish', () => {
  const f = fixture(), oldEpoch = randomUUID();
  // Old document's t1 is much larger than the reloaded document's t1.
  for (let i = 0; i < 64; i++) f.sample(f.volunteer, oldEpoch, 2000000 + i * 3000, -1000000);
  f.sample(f.chief, f.chiefEpoch, 1098000, 100000);
  f.sample(f.chief, f.chiefEpoch, 1099500, 100000);
  f.sample(f.volunteer, f.volunteerEpoch, 22000, 1199000);
  f.sample(f.volunteer, f.volunteerEpoch, 23500, 1199000);
  const start = { ...f.start, localAt: 1100000 }, finish = { ...f.finish, localAt: 25000 };
  f.send(f.chief, start); f.send(f.volunteer, finish);
  const r = f.result();
  // c7d50aa sorts across unrelated local epochs and drops both new samples:
  // result is Pending with no elapsed time. Arrival-order retention fixes this.
  assert.equal(r.verification, 'verified'); assert.equal(r.milliseconds, 24000);
  assert.equal(r.diagnostics.finish.matchingDeviceEpoch, 2);
});

test('Pending precisely identifies the missing endpoint, epoch and stale evidence', () => {
  const f = fixture(); f.send(f.volunteer, f.finish);
  assert.match(f.result().reason, /Chief Start record has not reached/);
  assert.equal(f.result().diagnostics.startRecord, 'missing');
  f.send(f.chief, f.start);
  assert.match(f.result().reason, /Chief Start.*no authenticated/);
  assert.match(f.result().reason, /Volunteer Finish.*no authenticated/);
  f.sample(f.chief, f.chiefEpoch, 108000, 100000); f.sample(f.chief, f.chiefEpoch, 109500, 100000);
  f.sample(f.volunteer, randomUUID(), 718000, -500000);
  assert.match(f.result().reason, /none match this capture's device clock epoch/);
  f.sample(f.volunteer, f.volunteerEpoch, 680000, -500000);
  assert.match(f.result().reason, /outside the 15000 ms window/);
  assert.equal(f.result().milliseconds, null);
  assert.ok(f.result().diagnostics.finish.nearestAgeMs > 15000);
});

test('late signed completion and late Start automatically reconsider a received Finish without retapping', () => {
  const f = fixture();
  const samples = [
    [f.chief, f.sample(f.chief, f.chiefEpoch, 108000, 100000, 10, 10, false)],
    [f.chief, f.sample(f.chief, f.chiefEpoch, 109500, 100000, 10, 10, false)],
    [f.volunteer, f.sample(f.volunteer, f.volunteerEpoch, 718000, -500000, 10, 10, false)],
    [f.volunteer, f.sample(f.volunteer, f.volunteerEpoch, 719500, -500000, 10, 10, false)],
  ];
  f.send(f.volunteer, f.finish); assert.equal(f.result().verification, 'pending');
  const raw = JSON.stringify(f.relay.get(f.chief.sessionId).captures[0]);
  f.send(f.chief, f.start); assert.equal(f.result().milliseconds, null);
  f.advance(60000); // New probes now would be stale, original completed samples are not.
  for (const [who, sample] of samples) f.relay.clockComplete(f.chief.sessionId, who.token, sample);
  assert.equal(f.result().verification, 'verified'); assert.equal(f.result().milliseconds, 10000);
  assert.equal(JSON.stringify(f.relay.get(f.chief.sessionId).captures.find(c => c.id === f.finish.id)), raw);
});

test('saved unacknowledged clock samples survive reload and retry the exact completion', () => {
  const f = fixture(); const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const journal = new CaptureJournal(storage, 'clock-outbox', f.chiefEpoch);
  const sample = f.sample(f.chief, f.chiefEpoch, 109000, 100000, 10, 10, false);
  journal.rememberClock(sample);
  const restored = new CaptureJournal(storage, 'clock-outbox', randomUUID());
  assert.deepEqual(restored.pendingClock(), sample);
  f.relay.clockComplete(f.chief.sessionId, f.chief.token, restored.pendingClock());
  restored.acknowledgeClock(sample.id);
  assert.equal(new CaptureJournal(storage, 'clock-outbox').pendingClock(), undefined);
  // A lost ack can safely replay the unchanged historical sample.
  assert.doesNotThrow(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, sample));
  assert.deepEqual(restored.clockSamples[0], sample);
});

test('poll health ages and diagnostics do not constantly change the selection version hash', () => {
  const f = fixture();
  for (const t of [108000, 109500]) f.sample(f.chief, f.chiefEpoch, t, 100000);
  for (const t of [718000, 719500]) f.sample(f.volunteer, f.volunteerEpoch, t, -500000);
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const before = f.result(); f.advance(5000); const after = f.result();
  assert.equal(before.id, after.id);
  assert.ok(after.diagnostics.finish.health.lastAcceptedAgeMs > before.diagnostics.finish.health.lastAcceptedAgeMs);
  assert.doesNotThrow(() => f.relay.command(f.chief.sessionId, f.chief.token, {
    id: randomUUID(), raceId: f.raceId, action: 'selectCapture', lane: 1, submissionId: f.finish.id, reconciliationId: before.id,
  }));
});

test('invalid and wrong-relay samples have separate diagnostic reasons and never relax verification', () => {
  const f = fixture();
  const sample = f.sample(f.volunteer, f.volunteerEpoch, 719000, -500000);
  const wrongRelay = { ...sample, relayEpoch: randomUUID() };
  const invalid = { ...sample, t4: sample.t1 - 1 };
  assert.equal(diagnoseEvidence(f.finish.localAt, f.finish.epochId, f.relay.relayEpoch, [wrongRelay]).matchingRelayEpoch, 0);
  assert.equal(diagnoseEvidence(f.finish.localAt, f.finish.epochId, f.relay.relayEpoch, [invalid]).invalid, 1);
  const r = reconcile(f.start, f.finish, f.relay.relayEpoch, [wrongRelay], [invalid]);
  assert.notEqual(r.verification, 'verified'); assert.equal(r.milliseconds, null);
});
