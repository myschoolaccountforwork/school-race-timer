// Verification is conditional on this clock model, not a physical accuracy claim.
export const CLOCK_POLICY = 'raceflow-020-total-100ms-v1';
export const MAX_ELAPSED_UNCERTAINTY = 100;
export const MAX_SAMPLE_AGE = 15000;
export const DRIFT_ALLOWANCE_PPM = 100;
const TIMESTAMP_ALLOWANCE = 2;

export interface ClockProbe {
  id: string; relayEpoch: string; epochId: string; t1: number; t2: number; t3: number; proof: string;
}
export interface FourTimestamp extends ClockProbe { t4: number }
export interface ClockMapping {
  lower: number; upper: number; uncertainty: number | null; offset: number;
  sampleAge: number; roundTrip: number; sampleIds: string[];
  driftPpm: number | null; driftUncertaintyPpm: number | null;
  sufficient: boolean; reason: string;
}
export interface Reconciliation {
  verification: 'pending' | 'unverified' | 'verified';
  milliseconds: number | null; uncertainty: number | null; reason: string;
  policy: string; startId?: string; lower?: number; upper?: number;
  start?: ClockMapping; finish?: ClockMapping;
}

export function mapClock(localAt: number, epochId: string, relayEpoch: string, samples: readonly FourTimestamp[]): ClockMapping | null {
  const valid = samples.filter(s => s.epochId === epochId && s.relayEpoch === relayEpoch &&
    [s.t1, s.t2, s.t3, s.t4].every(Number.isFinite) && s.t4 >= s.t1 && s.t3 >= s.t2 &&
    s.t4 - s.t1 + 1 >= s.t3 - s.t2 && Math.abs(localAt - (s.t1 + s.t4) / 2) <= MAX_SAMPLE_AGE);
  if (!valid.length) return null;
  // One-way delays are unknown. Keep their full possible asymmetry interval;
  // repeated equal samples do not shrink it by averaging or sqrt(n).
  const drift = DRIFT_ALLOWANCE_PPM / 1000000;
  const intervals = valid.map(s => ({ s,
    lower: localAt + s.t3 - s.t4 - Math.abs(localAt - s.t4) * drift - TIMESTAMP_ALLOWANCE,
    upper: localAt + s.t2 - s.t1 + Math.abs(localAt - s.t1) * drift + TIMESTAMP_ALLOWANCE,
  }));
  const lower = Math.max(...intervals.map(i => i.lower));
  const upper = Math.min(...intervals.map(i => i.upper));
  const sorted = [...valid].sort((a, b) => a.t1 - b.t1);
  const first = sorted[0], last = sorted.at(-1)!;
  const midpoint = (s: FourTimestamp) => (s.t1 + s.t4) / 2;
  const offset = (s: FourTimestamp) => ((s.t2 - s.t1) + (s.t3 - s.t4)) / 2;
  const width = (s: FourTimestamp) => Math.max(0, (s.t4 - s.t1) - (s.t3 - s.t2)) / 2 + TIMESTAMP_ALLOWANCE;
  const span = midpoint(last) - midpoint(first);
  const sufficient = new Set(valid.map(s => s.id)).size >= 2 && span >= 1000 && lower <= upper;
  return { lower, upper, offset: (lower + upper) / 2 - localAt,
    uncertainty: lower <= upper ? (upper - lower) / 2 : null,
    sampleAge: Math.max(...valid.map(s => Math.abs(localAt - midpoint(s)))),
    roundTrip: Math.min(...valid.map(s => (s.t4 - s.t1) - (s.t3 - s.t2))),
    sampleIds: sorted.map(s => s.id),
    driftPpm: span >= 1000 ? (offset(last) - offset(first)) / span * 1000000 : null,
    driftUncertaintyPpm: span >= 1000 ? (width(first) + width(last)) / span * 1000000 : null,
    sufficient, reason: lower > upper ? 'Clock evidence is inconsistent: possible discontinuity or drift outside the model.'
      : !sufficient ? 'Need at least two distinct clock samples spanning one second near this capture.' : '',
  };
}

export function reconcile(start: { id: string; raceId: string; epochId: string; localAt: number } | undefined,
  finish: { raceId: string; epochId: string; localAt: number; startId?: string },
  relayEpoch: string, startSamples: readonly FourTimestamp[], finishSamples: readonly FourTimestamp[]): Reconciliation {
  const base = { policy: CLOCK_POLICY, startId: start?.id, milliseconds: null, uncertainty: null };
  if (!start) return { ...base, verification: 'pending', reason: 'Waiting for the original Chief Start record.' };
  if (start.raceId !== finish.raceId || (finish.startId !== undefined && finish.startId !== start.id)) {
    return { ...base, verification: 'unverified', reason: 'Capture does not match this original Start/attempt.' };
  }
  const s = mapClock(start.localAt, start.epochId, relayEpoch, startSamples);
  const f = mapClock(finish.localAt, finish.epochId, relayEpoch, finishSamples);
  if (!s || !f) return { ...base, verification: 'pending', reason: `Missing or stale clock evidence near ${!s ? 'Chief Start' : 'volunteer Finish'} (15 second window, matching clock epochs required).` };
  if (s.lower > s.upper || f.lower > f.upper) return { ...base, start: s, finish: f, verification: 'unverified', reason: !s.sufficient ? s.reason : f.reason };
  const lower = f.lower - s.upper, upper = f.upper - s.lower;
  const milliseconds = Math.round((lower + upper) / 2);
  // Include rounding of the exported integer time in its uncertainty budget.
  // Round the bound upward to 0.001 ms so CSV/Excel round trips never
  // understate it. This is serialization precision, not claimed accuracy.
  const uncertainty = Math.ceil(Math.max(milliseconds - lower, upper - milliseconds) * 1000) / 1000;
  const result = { ...base, start: s, finish: f, lower, upper, milliseconds, uncertainty };
  if (!s.sufficient || !f.sufficient) return { ...result, verification: 'pending', reason: !s.sufficient ? s.reason : f.reason };
  if (lower <= 0) return { ...result, verification: 'unverified', reason: 'Evidence cannot establish a positive elapsed time after the Chief Start.' };
  if (uncertainty > MAX_ELAPSED_UNCERTAINTY) return { ...result, verification: 'unverified', reason: 'Combined elapsed-time uncertainty exceeds 100 ms; raw capture retained.' };
  return { ...result, verification: 'verified', reason: 'Meets the 100 ms total clock policy under the stated drift/timestamp assumptions; physical accuracy is not validated.' };
}
