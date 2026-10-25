import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ClockProbe, FourTimestamp, ClockHealth } from '../src/features/timing/reconciliation.ts';
import type { TimingCapture } from '../src/features/timing/localCapture.ts';
import { MAX_SAMPLE_AGE, DRIFT_ALLOWANCE_PPM } from '../src/features/timing/reconciliation.ts';

const identifier = (v: unknown) => typeof v === 'string' && /^[a-f0-9-]{16,100}$/.test(v);
const timestamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e15;
export class ClockEvidence {
  readonly relayEpoch: string;
  private readonly secret: string;
  private recent = new Map<string, FourTimestamp[]>();
  private pinned = new Map<string, FourTimestamp[]>();
  private status = new Map<string, ClockHealth>();
  private readonly clock: () => number;
  constructor(relayEpoch: string, secret: string, clock = () => performance.now()) { this.relayEpoch = relayEpoch; this.secret = secret; this.clock = clock; }
  private ownerHealth(owner: string) {
    const h = this.status.get(owner) ?? { probes: 0, completions: 0, lastProbeAt: null, lastAcceptedAt: null, lastAcceptedAgeMs: null, lastError: null };
    this.status.set(owner, h); return h;
  }
  health(owner: string): ClockHealth {
    const h = this.ownerHealth(owner);
    return { ...h, lastAcceptedAgeMs: h.lastAcceptedAt === null ? null : Math.max(0, this.clock() - h.lastAcceptedAt) };
  }
  private sign(owner: string, probe: Omit<ClockProbe, 'proof'>) {
    return createHmac('sha256', this.secret).update(JSON.stringify([owner, probe.id, probe.relayEpoch, probe.epochId, probe.t1, probe.t2, probe.t3])).digest('hex');
  }
  probe(owner: string, epochId: string, t1: number, t2: number, t3: number): ClockProbe {
    if (!identifier(epochId) || !timestamp(t1)) throw new Error('Invalid clock probe.');
    const probe = { id: randomUUID(), relayEpoch: this.relayEpoch, epochId, t1, t2, t3 };
    const h = this.ownerHealth(owner); h.probes++; h.lastProbeAt = t3;
    return { ...probe, proof: this.sign(owner, probe) };
  }
  accept(owner: string, value: FourTimestamp) {
    const h = this.ownerHealth(owner);
    try { this.acceptSample(owner, value); h.completions++; h.lastAcceptedAt = this.clock(); h.lastError = null; }
    catch (error) { h.lastError = error instanceof Error ? error.message : 'Clock evidence rejected.'; throw error; }
  }
  private acceptSample(owner: string, value: FourTimestamp) {
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['id', 'relayEpoch', 'epochId', 't1', 't2', 't3', 't4', 'proof'].includes(k)) ||
      !identifier(value.id) || !identifier(value.epochId) || value.relayEpoch !== this.relayEpoch ||
      ![value.t1, value.t2, value.t3, value.t4].every(timestamp) || value.t4 < value.t1 || value.t3 < value.t2 ||
      value.t4 - value.t1 > 10000 || value.t4 - value.t1 + 1 < value.t3 - value.t2 ||
      typeof value.proof !== 'string' || !/^[a-f0-9]{64}$/.test(value.proof) ||
      !timingSafeEqual(Buffer.from(value.proof, 'hex'), Buffer.from(this.sign(owner, value), 'hex'))) throw new Error('Invalid or unauthenticated four-timestamp evidence.');
    const known = [...(this.recent.get(owner) ?? []), ...[...this.pinned.entries()].filter(([k]) => k.startsWith(owner + ':')).flatMap(([, v]) => v)].find(s => s.id === value.id);
    if (known && (['id', 'relayEpoch', 'epochId', 't1', 't2', 't3', 't4', 'proof'] as const).some(k => known[k] !== value[k])) throw new Error('Clock sample ID reused with different data.');
    const samples = this.recent.get(owner) ?? [];
    // t1 values from different document epochs are not comparable: after a
    // reload a new page's small t1 must not be evicted behind 64 older samples.
    if (!samples.some(s => s.id === value.id)) this.recent.set(owner, [...samples, structuredClone(value)].slice(-64));
  }
  available(owner: string, capture: Pick<TimingCapture, 'id'>) {
    return [...new Map([...(this.pinned.get(`${owner}:${capture.id}`) ?? []), ...(this.recent.get(owner) ?? [])].map(s => [s.id, s])).values()];
  }
  pin(owner: string, capture: Pick<TimingCapture, 'id' | 'epochId' | 'localAt'>) {
    const key = `${owner}:${capture.id}`;
    const candidates = [...(this.pinned.get(key) ?? []), ...(this.recent.get(owner) ?? [])]
      .filter(s => s.epochId === capture.epochId && Math.abs((s.t1 + s.t4) / 2 - capture.localAt) <= MAX_SAMPLE_AGE);
    const unique = [...new Map(candidates.map(s => [s.id, s])).values()];
    // Pin the tightest lower/upper constraints as well as temporal endpoints.
    // A contradictory high-delay sample must never disappear merely because
    // later low-delay samples occupy the bounded history.
    unique.sort((a, b) => a.t1 - b.t1);
    const endpoints = [unique[0], unique.at(-1)].filter((s): s is FourTimestamp => Boolean(s));
    const drift = DRIFT_ALLOWANCE_PPM / 1000000;
    const lower = (s: FourTimestamp) => s.t3 - s.t4 - Math.abs(capture.localAt - s.t4) * drift;
    const upper = (s: FourTimestamp) => s.t2 - s.t1 + Math.abs(capture.localAt - s.t1) * drift;
    const constraints = [unique.reduce<FourTimestamp | undefined>((a, b) => !a || lower(b) > lower(a) ? b : a, undefined),
      unique.reduce<FourTimestamp | undefined>((a, b) => !a || upper(b) < upper(a) ? b : a, undefined)].filter((s): s is FourTimestamp => Boolean(s));
    const best = unique.sort((a, b) => ((a.t4 - a.t1) - (a.t3 - a.t2)) - ((b.t4 - b.t1) - (b.t3 - b.t2))).slice(0, 4);
    const selected = [...new Map([...endpoints, ...constraints, ...best].map(s => [s.id, s])).values()];
    this.pinned.set(key, selected);
    return selected;
  }
}
