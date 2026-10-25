export interface ClockSample { localMidpoint: number; serverTime: number; uncertainty: number }
export function clockSample(sent: number, received: number, serverTime: number): ClockSample {
  if (![sent, received, serverTime].every(Number.isFinite) || received < sent) throw new Error('Invalid relay clock sample. Check relay response timestamps.');
  return { localMidpoint: (sent + received) / 2, serverTime, uncertainty: Math.max(0, received - sent) / 2 };
}
export function serverTimeAt(sample: ClockSample, localNow: number) {
  return sample.serverTime + localNow - sample.localMidpoint;
}
// Prefer low round-trip samples and expire old ones to limit oscillator drift.
export function bestClock(samples: ClockSample[], now: number) {
  return samples.filter(s => Number.isFinite(s.serverTime) && Number.isFinite(s.uncertainty) && s.uncertainty >= 0 && now >= s.localMidpoint && now - s.localMidpoint < 15000)
    .sort((a, b) => a.uncertainty - b.uncertainty)[0] ?? null;
}

export function clockUncertainty(sample: ClockSample | null, now: number) {
  return sample ? sample.uncertainty + Math.max(0, now - sample.localMidpoint) * 0.0001 : Infinity;
}

export function clockReadiness(connected: boolean, sample: ClockSample | null, active: ClockSample | null, now: number) {
  if (!connected) return 'No fresh relay connection (last success must be under 3 seconds ago).';
  if (!sample) return 'No valid clock sample within 15 seconds. Waiting for a fresh response.';
  if (sample.uncertainty > 100) return 'Network clock uncertainty exceeds 100 ms. A round trip below 200 ms is needed; waiting longer does not average this away.';
  if (clockUncertainty(active, now) > 100) return 'Race clock uncertainty including drift exceeds 100 ms. Timed finishes remain blocked; use manual correction or Chief-only fallback.';
  return '';
}
