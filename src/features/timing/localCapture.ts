import { timerId } from './timerId.ts';
import type { TimerRace } from './timerOnly.ts';
import type { FourTimestamp } from './reconciliation.ts';

export interface TimingCapture {
  id: string; raceId: string; epochId: string; localAt: number;
  kind: 'start' | 'finish' | 'stop'; lane?: number; startId?: string;
  evidence?: { localMidpoint: number; serverTime: number; uncertainty: number };
  syncSamples?: readonly FourTimestamp[];
}
export interface CaptureRecord {
  capture: Readonly<TimingCapture>;
  delivery: 'captured' | 'saved' | 'received' | 'rejected';
  error?: string;
}
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }

// A new document always has a new epoch. Never reconstruct monotonic continuity
// using Date.now(), including after reload or browser suspension.
export const pageClockEpoch = timerId();

export class CaptureJournal {
  records: CaptureRecord[] = [];
  references: NonNullable<TimerRace['chiefStart']>[] = [];
  clockSamples: FourTimestamp[] = [];
  error = '';
  interrupted = false;
  running = false;
  loadFailed = false;
  private uploading = false;
  readonly storage: StoragePort;
  readonly key: string;
  epochId: string;
  readonly clock: () => number;
  readonly id: () => string;
  constructor(storage: StoragePort, key: string,
    epochId = pageClockEpoch, clock = () => performance.now(), id = timerId) {
    this.storage = storage; this.key = key; this.epochId = epochId; this.clock = clock; this.id = id;
    try {
      const archive = JSON.parse(storage.getItem(key) ?? '[]');
      const saved = (Array.isArray(archive) ? archive : archive.records) as CaptureRecord[];
      if (!Array.isArray(saved) || saved.some(r => !r.capture || typeof r.capture.id !== 'string' || typeof r.capture.raceId !== 'string' || typeof r.capture.epochId !== 'string' || !['start', 'finish', 'stop'].includes(r.capture.kind) || !['captured', 'saved', 'received', 'rejected'].includes(r.delivery) || !Number.isFinite(r.capture.localAt))) throw new Error('Invalid capture journal');
      this.records = saved.map(r => ({ ...r, capture: Object.freeze({ ...r.capture, ...(r.capture.evidence ? { evidence: Object.freeze({ ...r.capture.evidence }) } : {}), ...(r.capture.syncSamples ? { syncSamples: Object.freeze(r.capture.syncSamples.map(s => Object.freeze(s))) } : {}) }) }));
      if (!Array.isArray(archive)) {
        if (archive.version !== 1 || !Array.isArray(archive.references)) throw new Error('Invalid archive version');
        if (archive.references.some((r: NonNullable<TimerRace['chiefStart']>) => !r || typeof r.id !== 'string' || typeof r.raceId !== 'string' || typeof r.epochId !== 'string' || !Number.isFinite(r.localAt) || r.kind !== 'start')) throw new Error('Invalid start archive');
        this.references = archive.references.map((r: NonNullable<TimerRace['chiefStart']>) => Object.freeze(r));
        if (archive.clockSamples !== undefined && !Array.isArray(archive.clockSamples)) throw new Error('Invalid clock archive');
        if ((archive.clockSamples ?? []).length > 64 || (archive.clockSamples ?? []).some((s: FourTimestamp) => !s ||
          typeof s.id !== 'string' || typeof s.epochId !== 'string' || typeof s.relayEpoch !== 'string' ||
          typeof s.proof !== 'string' || ![s.t1, s.t2, s.t3, s.t4].every(Number.isFinite) || s.t4 < s.t1)) throw new Error('Invalid clock archive');
        this.clockSamples = (archive.clockSamples ?? []).map((s: FourTimestamp) => Object.freeze(s));
      }
    } catch { this.loadFailed = true; this.error = 'Local capture archive cannot be read. Export/recover browser data before starting; do not clear it.'; }
  }
  start(raceId: string) {
    if (this.interrupted) return undefined;
    return this.records.find(r => r.capture.raceId === raceId && r.capture.kind === 'start' && r.capture.epochId === this.epochId)?.capture;
  }
  interrupt() { this.epochId = this.id(); this.interrupted = true; }
  setRunning(value: boolean) { this.running = value; }
  rememberClock(sample: FourTimestamp) {
    this.clockSamples = [...this.clockSamples.filter(s => s.id !== sample.id), Object.freeze({ ...sample })].slice(-64);
    return this.save();
  }
  rememberStart(start: NonNullable<TimerRace['chiefStart']>) {
    if (this.loadFailed || this.references.some(r => r.id === start.id)) return;
    this.references.push(Object.freeze({ id: start.id, raceId: start.raceId, epochId: start.epochId, localAt: start.localAt, kind: 'start' }));
    this.save();
  }
  add(kind: TimingCapture['kind'], raceId: string, lane?: number, startId?: string, evidence?: TimingCapture['evidence'], localAt = this.clock()) {
    // The default clock read occurs before IDs, persistence or delivery.
    if (this.loadFailed) throw new Error(this.error);
    if (this.records.some(r => r.capture.raceId === raceId && r.capture.kind === kind && r.capture.lane === lane)) return undefined;
    if (!Number.isFinite(localAt) || localAt < 0) throw new Error('Invalid local clock. Reset this attempt.');
    const previous = this.records.findLast(r => r.capture.epochId === this.epochId)?.capture;
    if (previous && localAt < previous.localAt) this.interrupt();
    if (kind === 'start') this.interrupted = false;
    const capture = Object.freeze({ id: this.id(), raceId, epochId: this.epochId, localAt, kind,
      ...(lane === undefined ? {} : { lane }), ...(startId ? { startId } : {}),
      ...(evidence ? { evidence: Object.freeze({ ...evidence }) } : {}),
      syncSamples: Object.freeze(this.clockSamples.filter(s => s.epochId === this.epochId && Math.abs((s.t1 + s.t4) / 2 - localAt) <= 15000).slice(-4)) });
    this.records.push({ capture, delivery: 'captured' });
    this.save();
    return capture;
  }
  save() {
    if (this.loadFailed) return false;
    try {
      const next = this.records.map(r => r.delivery === 'captured' ? { ...r, delivery: 'saved' as const } : r);
      this.storage.setItem(this.key, JSON.stringify({ version: 1, records: next, references: this.references, clockSamples: this.clockSamples }));
      this.records = next; this.error = '';
      return true;
    } catch {
      this.error = 'Local saving failed: new captures/evidence may exist in memory only. Upload is blocked for unsaved captures. Keep this page open and retry saving.';
      return false;
    }
  }
  async flush(deliver: (capture: Readonly<TimingCapture>) => Promise<void>) {
    if (this.uploading) return;
    this.uploading = true;
    try {
      for (const record of this.records) {
        if (record.delivery !== 'saved') continue;
        try {
          await deliver(record.capture);
          record.delivery = 'received'; record.error = undefined; this.save();
        } catch (error) {
          const code = (error as { code?: number }).code;
          record.error = error instanceof Error ? error.message : 'Delivery failed; retrying original capture.';
          if (code && code >= 400 && code < 500 && code !== 429 && code !== 408) {
            record.delivery = 'rejected'; this.save(); continue;
          }
          break; // Preserve original records; retry automatically after reconnect.
        }
      }
    } finally { this.uploading = false; }
  }
}

export function chiefElapsed(start: Readonly<TimingCapture>, finish: Readonly<TimingCapture>) {
  if (start.kind !== 'start' || finish.raceId !== start.raceId || finish.startId !== start.id || finish.epochId !== start.epochId || finish.localAt < start.localAt) return null;
  return Math.round(finish.localAt - start.localAt);
}

export function chiefFallbackRace(race: TimerRace, id: string, elapsed: number, localNow: number): TimerRace {
  return { ...structuredClone(race), id: race.state === 'confirmed' ? race.id : id,
    elapsed: Math.round(elapsed), startedAt: race.state === 'running' ? localNow - elapsed : null,
    lanes: race.lanes.map(l => {
      if (race.state === 'confirmed') return { ...l };
      if (l.timingSource === 'volunteer-verified' && l.chiefLocalMilliseconds != null) return {
        ...l, milliseconds: l.chiefLocalMilliseconds, status: '', timingSource: 'chief-local', corrected: false,
        reconciliation: undefined, reviewRequired: undefined,
      };
      if (l.reviewRequired) return { ...l, milliseconds: null, status: '', timingSource: 'manual', reconciliation: undefined, reviewRequired: undefined };
      return { ...l };
    }),
  };
}
