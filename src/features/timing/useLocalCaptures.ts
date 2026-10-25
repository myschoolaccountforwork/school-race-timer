import { useEffect, useMemo, useState } from 'react';
import { CaptureJournal, chiefElapsed } from './localCapture';
import type { TimingCapture } from './localCapture';
import type { RelayCredentials, RelaySnapshot } from './relayProtocol';
import { complete } from './timerOnly';
import { timerRequest, TimerApiError } from './useTimerRelay';
import type { ClockProbe, FourTimestamp } from './reconciliation';

export function useLocalCaptures(credentials: RelayCredentials | null, snapshot: RelaySnapshot | null) {
  const journal = useMemo(() => credentials ? new CaptureJournal({
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
  }, `raceflow.captures.v1.${credentials.sessionId}.${credentials.token}`) : null, [credentials]);
  const [, redraw] = useState(0);
  const [actionError, setActionError] = useState('');
  const [clockStatus, setClockStatus] = useState('Collecting authenticated four-timestamp evidence. Capture does not wait for this.');
  const update = () => redraw(n => n + 1);

  useEffect(() => {
    if (journal && snapshot?.race.chiefStart) journal.rememberStart(snapshot.race.chiefStart);
  }, [journal, snapshot]);

  useEffect(() => {
    if (!journal || !credentials) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function complete(sample: FourTimestamp) {
      if (!journal || !credentials) return;
      try {
        await timerRequest('clock/complete', { sessionId: credentials.sessionId, sample }, credentials);
        journal.acknowledgeClock(sample.id);
      } catch (error) {
        if (error instanceof TimerApiError && error.code >= 400 && error.code < 500 && error.code !== 408 && error.code !== 429) journal.acknowledgeClock(sample.id, error.message);
        throw error;
      }
    }
    async function sync() {
      if (!journal || !credentials) return;
      // One durable completion retry per cycle, separate from capture delivery.
      // Failure must not stop collecting new evidence or block a Finish tap.
      const pending = journal.pendingClock();
      if (pending) void complete(pending).catch(() => { /* Queue/error status below; do not delay new probes. */ });
      if (!active) return;
      const epochId = journal.epochId;
      const t1 = performance.now();
      try {
        const probe = await timerRequest<ClockProbe>('clock/probe', { sessionId: credentials.sessionId, epochId, t1 }, credentials);
        const t4 = performance.now();
        if (!active) return;
        if (epochId !== journal.epochId || probe.epochId !== epochId || probe.t1 !== t1) throw new Error('Clock epoch changed during probe; discarding this sample.');
        if (t4 < t1) { journal.interrupt(); throw new Error('Clock discontinuity; a new clock epoch is required.'); }
        const sample: FourTimestamp = Object.freeze({ ...probe, t4 });
        // Keep signed evidence locally for delayed/retried original captures.
        if (!journal.rememberClock(sample)) throw new Error(journal.error);
        await complete(sample);
        if (active) setClockStatus(`Four-timestamp sample received. Latest network round trip about ${Math.ceil(Math.max(0, (t4 - t1) - (probe.t3 - probe.t2)))} ms. Verification uses both phones' evidence.`);
      } catch (error) { if (active) setClockStatus(error instanceof Error ? error.message : 'Clock evidence unavailable; captures remain local and queued.'); }
      if (active) timer = setTimeout(() => { void sync(); }, 3000);
    }
    void sync();
    return () => { active = false; clearTimeout(timer); };
  }, [journal, credentials]);

  useEffect(() => {
    if (!journal || !credentials) return;
    let active = true;
    const run = async () => {
      await journal.flush(async capture => {
        await timerRequest('command', { sessionId: credentials.sessionId,
          command: { id: capture.id, raceId: capture.raceId, action: 'localCapture', capture } }, credentials);
      });
      if (active) redraw(n => n + 1);
    };
    const timer = setInterval(() => { void run(); }, 750);
    const online = () => { void run(); };
    // Conservatively invalidate running Chief clocks after leaving the page.
    // Existing captured intervals remain valid; no wall-clock reconstruction.
    const visibility = () => { journal.interrupt(); if (active) redraw(n => n + 1); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (journal.records.some(r => r.delivery === 'captured') || journal.running) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', visibility);
    void run();
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', visibility); };
  }, [journal, credentials]);

  const race = snapshot ? structuredClone(snapshot.race) : null;
  const records = journal?.records ?? [];
  const currentRecords = records.filter(r => r.capture.raceId === race?.id);
  const localStart = currentRecords.find(r => r.capture.kind === 'start')?.capture;
  const usableStart = journal && race ? journal.start(race.id) : undefined;
  const chief = credentials?.role === 'chief';
  if (race && chief && localStart && race.state !== 'confirmed') {
    race.chiefStart = { ...localStart, kind: 'start' };
    race.startReference = 'chief-local';
    if (race.state === 'ready') race.state = 'running';
    for (const r of currentRecords.filter(r => r.capture.kind === 'finish')) {
      const lane = race.lanes.find(l => l.lane === r.capture.lane);
      const ms = chiefElapsed(localStart, r.capture);
      if (lane && ms !== null) lane.chiefLocalMilliseconds = ms;
      if (lane && ms !== null && lane.milliseconds === null && !lane.status && !lane.corrected) {
        lane.milliseconds = ms; lane.timingSource = 'chief-local';
      }
    }
    const stop = currentRecords.find(r => r.capture.kind === 'stop')?.capture;
    if (stop || complete(race)) {
      race.state = 'stopped';
      race.elapsed = stop ? chiefElapsed(localStart, stop) ?? race.elapsed : Math.max(...race.lanes.map(l => l.milliseconds ?? 0));
    }
  }
  const interrupted = Boolean(chief && race?.startReference === 'chief-local' && race.state === 'running' && !usableStart);
  const unsent = currentRecords.some(r => r.delivery === 'captured' || r.delivery === 'saved');
  const clockDelivery = journal ? {
    retained: journal.clockSamples.length,
    received: journal.clockSamples.filter(s => journal.clockReceipts[s.id]?.state === 'received').length,
    pending: journal.clockSamples.filter(s => !journal.clockReceipts[s.id]).length,
    rejected: journal.clockSamples.filter(s => journal.clockReceipts[s.id]?.state === 'rejected').length,
    lastError: Object.values(journal.clockReceipts).findLast(r => r.state === 'rejected')?.error,
  } : null;
  useEffect(() => {
    journal?.setRunning(Boolean(chief && race?.state === 'running'));
  }, [journal, chief, race?.state]);
  function capture(kind: TimingCapture['kind'], lane?: number, evidence?: TimingCapture['evidence']) {
    const capturedAt = performance.now(); // First action: never wait on the relay.
    if (!journal || !race) return;
    if (chief && kind !== 'start' && !usableStart) { setActionError('Chief clock continuity lost. Reset this attempt or use manual corrections; captured records are retained.'); return; }
    if (kind === 'start' && (race.state !== 'ready' || complete(race))) return;
    if (kind !== 'start' && chief && race.state !== 'running') return;
    if (!chief && (kind !== 'finish' || !['ready', 'running'].includes(race.state))) return;
    // The render's race ID is deliberately retained, even if a newer race arrives.
    // Capture never reassigns to the latest race during delivery/retry.
    try {
      journal.add(kind, race.id, lane, kind === 'start' ? undefined : chief ? usableStart?.id : race.chiefStart?.id, evidence, capturedAt);
      setActionError(''); update();
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Capture failed.'); }
  }
  function download() {
    if (!journal) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, sessionId: credentials?.sessionId, role: credentials?.role,
      participantId: snapshot?.selfId, records: journal.records, references: journal.references,
      clockSamples: journal.clockSamples, clockReceipts: journal.clockReceipts, receivedCaptures: snapshot?.captures ?? [] }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'raceflow-capture-archive.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { race, journal, records, currentRecords, interrupted, unsent, localStart, usableStart, capture, download,
    clockStatus, clockDelivery, error: actionError || journal?.error || '', retrySaving: () => { journal?.save(); update(); } };
}
