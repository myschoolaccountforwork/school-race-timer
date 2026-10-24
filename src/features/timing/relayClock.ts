export interface ClockSample { localMidpoint: number; serverTime: number; uncertainty: number }
export function clockSample(sent: number, received: number, serverTime: number): ClockSample {
  return { localMidpoint: (sent + received) / 2, serverTime, uncertainty: Math.max(0, received - sent) / 2 };
}
export function serverTimeAt(sample: ClockSample, localNow: number) {
  return sample.serverTime + localNow - sample.localMidpoint;
}
// Prefer low round-trip samples and expire old ones to limit oscillator drift.
export function bestClock(samples: ClockSample[], now: number) {
  return samples.filter(s => now - s.localMidpoint < 15000)
    .sort((a, b) => a.uncertainty - b.uncertainty)[0] ?? null;
}
