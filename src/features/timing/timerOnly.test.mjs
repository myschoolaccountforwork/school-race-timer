import assert from 'node:assert/strict';
import test from 'node:test';
import { complete, formatTime, mergeConfirmedHistory, newRace, parseTime, positions } from './timerOnly.ts';
import { localRaceNow } from './localClock.ts';
import { timerId } from './timerId.ts';

test('clock formatting carries correctly at minute boundaries', () => {
  assert.equal(formatTime(59999), '00:59.999');
  assert.equal(formatTime(60000), '01:00.000');
  assert.equal(formatTime(123456), '02:03.456');
});
test('chief corrections accept seconds and minutes and reject malformed or zero times', () => {
  assert.equal(parseTime('12.345'), 12345);
  assert.equal(parseTime('02:03.456'), 123456);
  for (const value of ['', '0', '-2', '1:60', '1:2:3', 'NaN', '12.3456']) assert.equal(parseTime(value), null);
});
test('positions use competition ranking for ties and exclude non-finish statuses', () => {
  const lanes = newRace(1, 6).lanes;
  lanes[0].milliseconds = 12345;
  lanes[1].milliseconds = 12345;
  lanes[2].milliseconds = 13000;
  lanes[3].milliseconds = 11000; lanes[3].status = 'DQ';
  lanes[4].status = 'DNS'; lanes[5].status = 'DNF';
  assert.deepEqual(positions(lanes), { 1: 1, 2: 1, 3: 3 });
  assert.equal(complete({ ...newRace(), lanes }), true);
  lanes[5].status = '';
  assert.equal(complete({ ...newRace(), lanes }), false);
});
test('next races have independent result arrays and retain selected lane count', () => {
  const first = newRace(1, 10);
  first.lanes[0].milliseconds = 10000;
  const next = newRace(2, first.laneCount);
  assert.notEqual(first.id, next.id);
  assert.equal(next.number, 2);
  assert.equal(next.lanes.length, 10);
  assert.equal(next.lanes[0].milliseconds, null);
});
test('local race timing is independent of wall clock adjustments within the page', () => {
  const before = localRaceNow();
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 3600000;
    const after = localRaceNow();
    assert.ok(after >= before && after - before < 1000);
  } finally { Date.now = originalNow; }
});
test('device IDs use getRandomValues without requiring secure-context randomUUID', () => {
  const ids = new Set(Array.from({ length: 100 }, () => timerId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[a-f0-9]{48}$/);
});
test('merging relay history preserves local history and an unfinished single-device race', () => {
  const old = { ...newRace(1), state: 'confirmed' };
  const current = { ...newRace(2), state: 'running', startedAt: 1000 };
  const remote = { ...newRace(3), state: 'confirmed' };
  const merged = mergeConfirmedHistory({ current, history: [old] }, [remote]);
  assert.equal(merged.current, current);
  assert.deepEqual(merged.history.map(r => r.id), [old.id, remote.id]);
  assert.deepEqual(mergeConfirmedHistory(merged, [remote]).history, merged.history);
  const emptyLocal = { current: newRace(), history: [old] };
  assert.equal(mergeConfirmedHistory(emptyLocal, [remote]).current, remote);
});

