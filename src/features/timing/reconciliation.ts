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
export interface ClockHealth {
  probes: number; completions: number; lastProbeAt: number | null; lastAcceptedAt: number | null;
  lastAcceptedAgeMs: number | null; lastError: string | null;
}
export interface EvidenceDiagnostic {
  epochId: string; available: number; matchingDeviceEpoch: number; matchingRelayEpoch: number;
  valid: number; usable: number; stale: number; invalid: number;
  nearestAgeMs: number | null; spanMs: number; health?: ClockHealth;
}
export interface ReconciliationDiagnostics {
  version: '020-pending-1'; startRecord: 'missing' | 'received';
  start?: EvidenceDiagnostic; finish: EvidenceDiagnostic;
}
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
  diagnostics?: ReconciliationDiagnostics;
}

function ordered(s: FourTimestamp) {
  return [s.t1, s.t2, s.t3, s.t4].every(Number.isFinite) && s.t4 >= s.t1 && s.t3 >= s.t2 && s.t4 - s.t1 + 1 >= s.t3 - s.t2;
}
export function diagnoseEvidence(localAt: number, epochId: string, relayEpoch: string, samples: readonly FourTimestamp[]): EvidenceDiagnostic {
  const unique = [...new Map(samples.map(s => [s.id, s])).values()];
  const device = unique.filter(s => s.epochId === epochId), relay = device.filter(s => s.relayEpoch === relayEpoch);
  const valid = relay.filter(ordered);
  const ages = valid.map(s => Math.abs(localAt - (s.t1 + s.t4) / 2));
  const nearby = valid.filter(s => Math.abs(localAt - (s.t1 + s.t4) / 2) <= MAX_SAMPLE_AGE);
  const midpoints = nearby.map(s => (s.t1 + s.t4) / 2);
  return { epochId, available: unique.length, matchingDeviceEpoch: device.length, matchingRelayEpoch: relay.length,
    valid: valid.length, usable: nearby.length, stale: valid.length - nearby.length, invalid: relay.length - valid.length,
    nearestAgeMs: ages.length ? Math.min(...ages) : null, spanMs: midpoints.length ? Math.max(...midpoints) - Math.min(...midpoints) : 0 };
}
function pendingEvidence(label: string, d: EvidenceDiagnostic) {
  const prefix = `${label} (clock epoch ${d.epochId.slice(0, 8)})`;
  if (!d.available) return `${prefix}: no authenticated four-timestamp evidence received for this participant. Check that device's clock upload status.`;
  if (!d.matchingDeviceEpoch) return `${prefix}: ${d.available} retained sample(s), none match this capture's device clock epoch. A reload/visibility change or an evidence-retention gap may be involved; another epoch cannot be substituted.`;
  if (!d.matchingRelayEpoch) return `${prefix}: matching device samples belong to another relay clock epoch and cannot be reused.`;
  if (!d.valid) return `${prefix}: matching samples have invalid timestamps/order and cannot be used.`;
  if (!d.usable) return `${prefix}: nearest matching sample is ${Math.ceil(d.nearestAgeMs!)} ms from the event, outside the 15000 ms window. New samples now cannot repair an old gap; saved original evidence may still arrive.`;
  return `${prefix}: ${d.usable} nearby sample(s), spanning ${Math.floor(d.spanMs)} ms. Need at least two distinct samples spanning 1000 ms near this capture.`;
}

export function mapClock(localAt: number, epochId: string, relayEpoch: string, samples: readonly FourTimestamp[]): ClockMapping | null {
  const valid = samples.filter(s => s.epochId === epochId && s.relayEpoch === relayEpoch &&
    ordered(s) && Math.abs(localAt - (s.t1 + s.t4) / 2) <= MAX_SAMPLE_AGE);
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
  relayEpoch: string, startSamples: readonly FourTimestamp[], finishSamples: readonly FourTimestamp[],
  available = { start: startSamples, finish: finishSamples }): Reconciliation {
  const diagnostics: ReconciliationDiagnostics = { version: '020-pending-1', startRecord: start ? 'received' : 'missing',
    start: start ? diagnoseEvidence(start.localAt, start.epochId, relayEpoch, available.start) : undefined,
    finish: diagnoseEvidence(finish.localAt, finish.epochId, relayEpoch, available.finish) };
  const base = { policy: CLOCK_POLICY, startId: start?.id, milliseconds: null, uncertainty: null, diagnostics };
  if (!start) return { ...base, verification: 'pending', reason: 'Original Chief Start record has not reached this relay for this race attempt. Finish receipt does not acknowledge Start delivery; check the Chief capture outbox.' };
  if (start.raceId !== finish.raceId || (finish.startId !== undefined && finish.startId !== start.id)) {
    return { ...base, verification: 'unverified', reason: 'Capture does not match this original Start/attempt.' };
  }
  const s = mapClock(start.localAt, start.epochId, relayEpoch, startSamples);
  const f = mapClock(finish.localAt, finish.epochId, relayEpoch, finishSamples);
  if (!s || !f) return { ...base, verification: 'pending', reason: 'Missing or stale clock evidence. ' +
    [!s ? pendingEvidence('Chief Start', diagnostics.start!) : '', !f ? pendingEvidence('Volunteer Finish', diagnostics.finish) : ''].filter(Boolean).join(' ') };
  if (s.lower > s.upper || f.lower > f.upper) return { ...base, start: s, finish: f, verification: 'unverified', reason: s.lower > s.upper ? `Chief Start: ${s.reason}` : `Volunteer Finish: ${f.reason}` };
  const lower = f.lower - s.upper, upper = f.upper - s.lower;
  const milliseconds = Math.round((lower + upper) / 2);
  // Include rounding of the exported integer time in its uncertainty budget.
  // Round the bound upward to 0.001 ms so CSV/Excel round trips never
  // understate it. This is serialization precision, not claimed accuracy.
  const uncertainty = Math.ceil(Math.max(milliseconds - lower, upper - milliseconds) * 1000) / 1000;
  const result = { ...base, start: s, finish: f, lower, upper, milliseconds, uncertainty };
  if (!s.sufficient || !f.sufficient) return { ...result, verification: 'pending', reason:
    [!s.sufficient ? pendingEvidence('Chief Start', diagnostics.start!) : '', !f.sufficient ? pendingEvidence('Volunteer Finish', diagnostics.finish) : ''].filter(Boolean).join(' ') };
  if (lower <= 0) return { ...result, verification: 'unverified', reason: 'Evidence cannot establish a positive elapsed time after the Chief Start.' };
  if (uncertainty > MAX_ELAPSED_UNCERTAINTY) return { ...result, verification: 'unverified', reason: 'Combined elapsed-time uncertainty exceeds 100 ms; raw capture retained.' };
  return { ...result, verification: 'verified', reason: 'Meets the 100 ms total clock policy under the stated drift/timestamp assumptions; physical accuracy is not validated.' };
}
