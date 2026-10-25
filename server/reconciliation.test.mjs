import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { TimerRelay } from './timerRelay.ts';
import { mapClock, reconcile, CLOCK_POLICY } from '../src/features/timing/reconciliation.ts';
import { timerExportRows } from '../src/features/timing/timerExportRows.ts';
import { chiefFallbackRace } from '../src/features/timing/localCapture.ts';

function fixture(lanes = 1) {
  let now = 200000;
  const relay = new TimerRelay(() => now);
  const chief = relay.create(lanes);
  const volunteer = relay.join(chief.sessionId, chief.joinToken, 1, randomBytes(24).toString('hex'));
  const chiefEpoch = randomUUID(), volunteerEpoch = randomUUID();
  const snapshot = (who = chief) => relay.snapshot(chief.sessionId, who.token);
  const id = snapshot().race.id;
  const evidence = (who, epochId, t1, offset, forward = 10, reverse = 10, complete = true) => {
    const t2 = t1 + offset + forward; now = t2 + 2;
    const probe = relay.clockProbe(chief.sessionId, who.token, epochId, t1, t2);
    const sample = { ...probe, t4: t1 + forward + 2 + reverse };
    now += reverse;
    if (complete) relay.clockComplete(chief.sessionId, who.token, sample);
    return sample;
  };
  const send = (who, capture) => relay.command(chief.sessionId, who.token, { id: capture.id, raceId: capture.raceId, action: 'localCapture', capture });
  const start = { id: randomUUID(), raceId: id, epochId: chiefEpoch, localAt: 110000, kind: 'start' };
  const finish = { id: randomUUID(), raceId: id, epochId: volunteerEpoch, localAt: 720000, kind: 'finish', lane: 1, startId: start.id };
  const calibrate = (forward = 10, reverse = 10, volunteerForward = forward, volunteerReverse = reverse) => {
    evidence(chief, chiefEpoch, 108000, 100000, forward, reverse);
    evidence(chief, chiefEpoch, 109500, 100000, forward, reverse);
    evidence(volunteer, volunteerEpoch, 718000, -500000, volunteerForward, volunteerReverse);
    evidence(volunteer, volunteerEpoch, 719500, -500000, volunteerForward, volunteerReverse);
  };
  const command = (action, fields = {}) => relay.command(chief.sessionId, chief.token, { id: randomUUID(), raceId: snapshot().race.id, action, ...fields });
  const result = () => snapshot().captures.find(c => c.id === finish.id).reconciliation;
  return { relay, chief, volunteer, chiefEpoch, volunteerEpoch, id, snapshot, evidence, send, start, finish, calibrate, command, result };
}

test('four-timestamp reconciliation uses original Chief Start across independent monotonic origins', () => {
  const f = fixture(); f.calibrate();
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  assert.equal(result.verification, 'verified');
  assert.equal(result.milliseconds, 10000);
  assert.ok(result.uncertainty > 20 && result.uncertainty <= 100);
  assert.equal(result.policy, CLOCK_POLICY);
  assert.equal(result.start.sampleIds.length, 2);
  assert.equal(result.finish.sampleIds.length, 2);
  assert.ok(result.start.sampleAge <= 15000);
  assert.equal(result.start.driftPpm, 0);
  assert.equal(f.snapshot().race.startedAt, null);
  assert.equal(f.snapshot().race.lanes[0].milliseconds, null); // never automatically official
});

test('persistent high latency remains unverified without averaging away uncertainty', () => {
  const f = fixture(); f.calibrate(400, 400);
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  assert.equal(result.verification, 'unverified');
  assert.ok(result.uncertainty > 800);
  assert.equal(result.milliseconds, 10000);
  assert.throws(() => f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: result.id }), /Only clock-policy verified/);
  assert.equal(f.snapshot().race.lanes[0].milliseconds, null);
});

test('asymmetric paths retain bias within the interval rather than claiming midpoint is exact', () => {
  const f = fixture(); f.calibrate(5, 35, 35, 5);
  f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  assert.equal(result.milliseconds, 10030); // opposing path asymmetries bias the point estimate
  assert.ok(result.lower <= 10000 && result.upper >= 10000);
  assert.ok(result.uncertainty >= 44);
  assert.equal(result.verification, 'verified'); // still within the stated 100 ms policy, not exact timing
  const slow = fixture(); slow.calibrate(5, 395, 395, 5);
  slow.send(slow.chief, slow.start); slow.send(slow.volunteer, slow.finish);
  assert.equal(slow.result().verification, 'unverified');
  assert.ok(slow.result().lower <= 10000 && slow.result().upper >= 10000);
});

test('missing, stale, single-sample and wrong-epoch evidence cannot verify a raw capture', () => {
  const f = fixture(); f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  assert.equal(f.result().verification, 'pending');
  f.evidence(f.chief, f.chiefEpoch, 80000, 100000);
  f.evidence(f.volunteer, f.volunteerEpoch, 680000, -500000);
  assert.match(f.result().reason, /Missing or stale/);
  f.evidence(f.chief, randomUUID(), 109000, 100000);
  f.evidence(f.volunteer, randomUUID(), 719000, -500000);
  assert.equal(f.result().verification, 'pending');
  f.evidence(f.chief, f.chiefEpoch, 109000, 100000);
  f.evidence(f.volunteer, f.volunteerEpoch, 719000, -500000);
  assert.equal(f.result().verification, 'pending');
  assert.equal(f.result().milliseconds, 10000);
  assert.match(f.result().reason, /two distinct/);
  const original = JSON.stringify(f.relay.get(f.chief.sessionId).captures.find(c => c.id === f.finish.id));
  f.evidence(f.chief, f.chiefEpoch, 111000, 100000);
  f.evidence(f.volunteer, f.volunteerEpoch, 721000, -500000);
  assert.equal(f.result().verification, 'verified');
  assert.equal(JSON.stringify(f.relay.get(f.chief.sessionId).captures.find(c => c.id === f.finish.id)), original);
});

test('clock discontinuity invalidates verification and prevents locking an affected selection', () => {
  const f = fixture(); f.calibrate(); f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: result.id });
  const selected = f.snapshot().race.lanes[0].milliseconds;
  f.evidence(f.volunteer, f.volunteerEpoch, 720500, -495000); // unexplained 5 second clock shift
  assert.equal(f.result().verification, 'unverified');
  assert.match(f.result().reason, /inconsistent/);
  assert.equal(f.snapshot().race.lanes[0].milliseconds, selected); // no silent official rewrite
  assert.equal(f.snapshot().race.lanes[0].reviewRequired, true);
  assert.throws(() => f.command('confirm'), /no longer sufficient/);
  for (let i = 0; i < 100; i++) f.evidence(f.volunteer, f.volunteerEpoch, 720600 + i * 10, -500000);
  assert.equal(f.result().verification, 'unverified'); // contradictory evidence stays pinned beyond the recent-sample cap
  f.command('correct', { lane: 1, milliseconds: 10040, status: '' });
  f.command('confirm');
  assert.equal(f.snapshot().history[0].lanes[0].reconciliation, undefined);
  assert.match(timerExportRows(f.snapshot().history)[0].Verification, /not volunteer clock-policy verified/);
});

test('drift estimate is reported with uncertainty; projection remains bounded by the explicit drift allowance', () => {
  const epochId = randomUUID(), relayEpoch = randomUUID();
  const sample = (t1, offset) => ({ id: randomUUID(), epochId, relayEpoch, t1, t2: t1 + offset + 1,
    t3: t1 + offset + 2, t4: t1 + 3, proof: 'unused in pure model' });
  const mapped = mapClock(11500, epochId, relayEpoch, [sample(1000, 10000), sample(11000, 10000.4)]);
  assert.ok(Math.abs(mapped.driftPpm - 40) < 0.01);
  assert.ok(mapped.driftUncertaintyPpm > 0);
  assert.ok(mapped.lower <= 21500.42 && mapped.upper >= 21500.42);
  assert.equal(mapClock(11500, randomUUID(), relayEpoch, [sample(11000, 10000)]), null);
  assert.equal(mapClock(11500, epochId, randomUUID(), [sample(11000, 10000)]), null);
});

test('signed evidence authenticates relay timestamps, owner and epoch; changed/replayed samples are rejected', () => {
  const f = fixture();
  const sample = f.evidence(f.chief, f.chiefEpoch, 109000, 100000);
  assert.doesNotThrow(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample }));
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.volunteer.token, sample), /unauthenticated/);
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample, t2: sample.t2 + 1 }), /unauthenticated/);
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample, epochId: randomUUID() }), /unauthenticated/);
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample, t4: sample.t4 + 1 }), /different data/);
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample, t4: sample.t1 - 1 }), /Invalid/);
  assert.throws(() => f.relay.clockProbe(f.chief.sessionId, 'bad', f.chiefEpoch, 10), /denied/);
  assert.throws(() => f.relay.clockComplete(f.chief.sessionId, f.chief.token, { ...sample, student: 'rejected' }), /Invalid/);
});

test('delayed captures carry signed historical samples; duplicate delivery never substitutes arrival time', () => {
  const f = fixture();
  const chiefSamples = [108000, 109500].map(t => f.evidence(f.chief, f.chiefEpoch, t, 100000, 10, 10, false));
  const volunteerSamples = [718000, 719500].map(t => f.evidence(f.volunteer, f.volunteerEpoch, t, -500000, 10, 10, false));
  const start = { ...f.start, syncSamples: chiefSamples };
  const finish = { ...f.finish, syncSamples: volunteerSamples };
  f.send(f.chief, start); f.send(f.volunteer, finish); f.send(f.volunteer, finish);
  assert.equal(f.result().verification, 'verified');
  assert.equal(f.result().milliseconds, 10000);
  assert.equal(f.snapshot().captures.filter(c => c.id === finish.id).length, 1);
  assert.deepEqual(f.relay.get(f.chief.sessionId).captures.find(c => c.id === finish.id).syncSamples, volunteerSamples);
});

test('closely spaced finishes from multiple volunteers remain independent and attempt-bound', () => {
  const f = fixture(); f.calibrate(); f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const other = f.relay.join(f.chief.sessionId, f.chief.joinToken, 1, randomBytes(24).toString('hex'));
  const epoch = randomUUID();
  f.evidence(other, epoch, 18000, 200000); f.evidence(other, epoch, 19500, 200000);
  const finish = { ...f.finish, id: randomUUID(), epochId: epoch, localAt: 20003 };
  f.send(other, finish);
  const records = f.snapshot().captures.filter(c => c.source === 'lane');
  assert.deepEqual(records.map(c => c.reconciliation.milliseconds), [10000, 10003]);
  assert.ok(records.every(c => c.verification === 'verified'));
  f.command('falseStart');
  f.send(other, finish);
  assert.equal(f.snapshot().captures.length, 0);
  assert.equal(f.snapshot(other).volunteers.length, 2);
});

test('official selection freezes accurate export provenance and preserves independent Chief fallback', () => {
  const f = fixture(); f.calibrate(); f.send(f.chief, f.start);
  f.send(f.chief, { id: randomUUID(), raceId: f.id, epochId: f.chiefEpoch, localAt: 120050, kind: 'finish', lane: 1, startId: f.start.id });
  f.send(f.volunteer, f.finish);
  const result = f.result();
  assert.throws(() => f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: 'a'.repeat(64) }), /changed/);
  f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: result.id });
  let lane = f.snapshot().race.lanes[0];
  assert.equal(lane.milliseconds, 10000);
  assert.equal(lane.chiefLocalMilliseconds, 10050);
  const fallback = chiefFallbackRace(f.snapshot().race, randomUUID(), 10050, 800000);
  assert.equal(fallback.lanes[0].milliseconds, 10050);
  assert.equal(fallback.lanes[0].reconciliation, undefined);
  f.command('confirm');
  const history = f.snapshot().history;
  const row = timerExportRows(history)[0];
  assert.equal(row.Time, '00:10.000'); assert.equal(row.Milliseconds, 10000);
  assert.equal(row['Timing source'], 'volunteer-verified');
  assert.equal(row['Uncertainty (ms)'], result.uncertainty);
  assert.equal(row['Clock policy'], CLOCK_POLICY);
  assert.equal(row['Capture ID'], f.finish.id);
  assert.equal(row['Chief Start ID'], f.start.id);
  assert.equal(row['Chief local fallback (ms)'], 10050);
  assert.ok(row['Clock evidence IDs'].includes(result.start.sampleIds[0]));
  assert.throws(() => f.command('correct', { lane: 1, milliseconds: 1, status: '' }), /locked/);
  f.command('next');
  assert.equal(f.snapshot(f.volunteer).race.number, 2);
  lane = history[0].lanes[0]; assert.equal(lane.reconciliation.id, result.id);
});

test('local fallback continues from the Chief original elapsed time even though relay startedAt is null', () => {
  const f = fixture(); f.send(f.chief, f.start);
  const fallback = chiefFallbackRace(f.snapshot().race, randomUUID(), 1234, 800000);
  assert.equal(fallback.state, 'running'); assert.equal(fallback.startedAt, 798766);
  assert.equal(800005 - fallback.startedAt, 1239);
});

test('late contradictory evidence flags locked history and exports without silently changing official times', () => {
  const f = fixture(); f.calibrate(); f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: result.id }); f.command('confirm');
  f.evidence(f.volunteer, f.volunteerEpoch, 720500, -495000);
  const locked = f.snapshot().history[0];
  assert.equal(locked.lanes[0].milliseconds, result.milliseconds);
  assert.equal(locked.lanes[0].reviewRequired, true);
  assert.equal(locked.lanes[0].reconciliation.id, result.id);
  assert.match(timerExportRows([locked])[0].Verification, /Unverified - review required/);
});

test('delayed Chief local finish remains an independent fallback after volunteer official selection', () => {
  const f = fixture(); f.calibrate(); f.send(f.chief, f.start); f.send(f.volunteer, f.finish);
  const result = f.result();
  f.command('selectCapture', { lane: 1, submissionId: f.finish.id, reconciliationId: result.id });
  f.send(f.chief, { id: randomUUID(), raceId: f.id, epochId: f.chiefEpoch, localAt: 120050, kind: 'finish', lane: 1, startId: f.start.id });
  assert.equal(f.snapshot().race.lanes[0].milliseconds, 10000);
  assert.equal(f.snapshot().race.lanes[0].chiefLocalMilliseconds, 10050);
  assert.equal(f.snapshot().captures.filter(c => c.source === 'chief' && c.kind === 'finish').length, 1);
});

test('pure reconciliation never mixes attempts or invents timestamps for a missing start', () => {
  const f = fixture();
  assert.equal(reconcile(undefined, f.finish, f.relay.relayEpoch, [], []).verification, 'pending');
  assert.equal(reconcile(f.start, { ...f.finish, raceId: randomUUID() }, f.relay.relayEpoch, [], []).verification, 'unverified');
  assert.equal(reconcile(f.start, { ...f.finish, startId: randomUUID() }, f.relay.relayEpoch, [], []).verification, 'unverified');
});

test('deterministic asymmetric-network and clock-rate trials contain independently calculated true elapsed intervals', () => {
  let seed = 2020;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const relayEpoch = randomUUID();
  for (let trial = 0; trial < 100; trial++) {
    const start = { id: randomUUID(), raceId: randomUUID(), epochId: randomUUID(), localAt: 110000 };
    const finish = { raceId: start.raceId, startId: start.id, epochId: randomUUID(), localAt: 720000 };
    const chiefRate = 1 + (random() * 2 - 1) * 0.0001, volunteerRate = 1 + (random() * 2 - 1) * 0.0001;
    const make = (event, rate, offset) => [-2000, -500, 1000].map(delta => {
      const t1 = event.localAt + delta, forward = random() * 400, reverse = random() * 400;
      const t2 = rate * t1 + offset + forward, t3 = t2 + 2;
      const t4 = (t3 + reverse - offset) / rate;
      return { id: randomUUID(), relayEpoch, epochId: event.epochId, t1, t2, t3, t4, proof: 'synthetic model only' };
    });
    const result = reconcile(start, finish, relayEpoch, make(start, chiefRate, 100000), make(finish, volunteerRate, -500000));
    const actual = volunteerRate * finish.localAt - 500000 - (chiefRate * start.localAt + 100000);
    assert.ok(result.lower <= actual && result.upper >= actual);
    assert.ok(Math.abs(result.milliseconds - actual) <= result.uncertainty);
    if (result.verification === 'verified') assert.ok(Math.abs(result.milliseconds - actual) <= 100);
  }
});
