import { useCallback, useEffect, useRef, useState } from 'react';
import { bestClock, clockSample, serverTimeAt, clockUncertainty, clockReadiness } from './relayClock';
import type { ClockSample } from './relayClock';
import type { RelayCommand, RelayCredentials, RelaySnapshot } from './relayProtocol';
import { relayBaseUrl } from './relayUrls';
import { timerId } from './timerId';

export class TimerApiError extends Error {
  code: number;
  constructor(message: string, code: number) { super(message); this.code = code; }
}
export async function timerRequest<T>(path: string, body?: unknown, credentials?: RelayCredentials): Promise<T> {
  const response = await fetch(`${relayBaseUrl()}/api/timer/${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.timeout(3500),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({ error: 'Timing relay unavailable. Check your internet connection or use Chief-only fallback.' }));
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new TimerApiError(data.error ?? 'Timing relay unavailable.', response.status);
  return data as T;
}

export function useTimerRelay(credentials: RelayCredentials | null, onSnapshot?: (snapshot: RelaySnapshot) => void) {
  const [snapshot, setSnapshot] = useState<RelaySnapshot | null>(null);
  const latest = useRef<RelaySnapshot | null>(null);
  const samples = useRef<ClockSample[]>([]);
  const [clockSamples, setClockSamples] = useState<ClockSample[]>([]);
  const raceClock = useRef<{ raceId: string; sample: ClockSample } | null>(null);
  const [frozenClock, setFrozenClock] = useState<{ raceId: string; sample: ClockSample } | null>(null);
  const [tick, setTick] = useState(() => performance.now());
  const [health, setHealth] = useState({ lastSuccess: -Infinity, failed: false });
  const [error, setError] = useState('');
  const [transportError, setTransportError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<RelayCommand | null>(null);
  const pendingRef = useRef<RelayCommand | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const clockResetAt = useRef(-Infinity);

  const accept = useCallback((next: RelaySnapshot, sent: number) => {
    const received = performance.now();
    const measured = clockSample(sent, received, next.serverNow);
    // An in-flight request spanning background/sleep must not restore its old mapping.
    if (sent >= clockResetAt.current) {
      samples.current = [...samples.current.filter(s => received - s.localMidpoint < 15000), measured].slice(-24);
      setClockSamples(samples.current);
    }
    setHealth({ lastSuccess: received, failed: false });
    setTransportError('');
    if (!latest.current || next.revision > latest.current.revision || (next.revision === latest.current.revision && next.serverNow >= latest.current.serverNow)) {
      const timing = bestClock(samples.current, received);
      if (next.race.state === 'running' && raceClock.current?.raceId !== next.race.id && timing && timing.uncertainty <= 100) {
        raceClock.current = { raceId: next.race.id, sample: timing }; setFrozenClock(raceClock.current);
      }
      latest.current = next; setSnapshot(next); onSnapshot?.(next);
    }
  }, [onSnapshot]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const effectGeneration = ++generation.current;
    latest.current = null; samples.current = []; raceClock.current = null;
    clockResetAt.current = performance.now();
    pendingRef.current = null; sending.current = false;
    async function poll() {
      if (!credentials) return;
      const sent = performance.now();
      try {
        const next = await timerRequest<RelaySnapshot>(`state?id=${encodeURIComponent(credentials.sessionId)}`, undefined, credentials);
        if (active) accept(next, sent);
      } catch (e) {
        if (active) { setHealth(h => ({ ...h, failed: true })); setTransportError(e instanceof Error ? e.message : 'Reconnecting to relay.'); }
      }
      if (active) timer = setTimeout(poll, 750);
    }
    if (credentials) void poll();
    const visibility = () => { clockResetAt.current = performance.now(); samples.current = []; raceClock.current = null; setFrozenClock(null); setClockSamples([]); setHealth(h => ({ ...h, failed: true })); };
    document.addEventListener('visibilitychange', visibility);
    const offline = () => setHealth(h => ({ ...h, failed: true }));
    window.addEventListener('offline', offline);
    return () => { active = false; generation.current = effectGeneration + 1; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline); };
  }, [credentials, accept]);

  useEffect(() => {
    let frame: number;
    const render = () => { setTick(performance.now()); frame = requestAnimationFrame(render); };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);
  const sample = bestClock(clockSamples, tick);
  const serverNow = sample ? serverTimeAt(sample, tick) : snapshot?.serverNow ?? 0;
  const activeClock = frozenClock?.raceId === snapshot?.race.id ? frozenClock?.sample : sample;
  // 100 ppm is a conservative engineering allowance, not measured hardware accuracy.
  const uncertainty = clockUncertainty(activeClock ?? null, tick);
  const raceNow = activeClock ? serverTimeAt(activeClock, tick) : serverNow;
  // Actual relay reachability matters; navigator.onLine can be false on a working isolated LAN.
  const connected = Boolean(credentials && snapshot && !health.failed && tick - health.lastSuccess < 3000);
  const chiefConnected = connected && (credentials?.role === 'chief' || serverNow - (snapshot?.chiefLastSeen ?? 0) < 8000);
  const syncDisabledReason = clockReadiness(connected, sample, activeClock ?? null, tick);
  const synchronised = !syncDisabledReason;
  const latestSample = clockSamples.at(-1);
  const diagnostics = {
    latestRoundTrip: latestSample ? latestSample.uncertainty * 2 : undefined,
    sampleAge: sample ? Math.max(0, tick - sample.localMidpoint) : undefined,
    latestSampleAge: latestSample ? Math.max(0, tick - latestSample.localMidpoint) : undefined,
    raceClockAge: frozenClock ? Math.max(0, tick - frozenClock.sample.localMidpoint) : undefined,
    lastSuccessAge: Number.isFinite(health.lastSuccess) ? Math.max(0, tick - health.lastSuccess) : undefined,
    selectedUncertainty: sample?.uncertainty,
    offset: sample ? sample.serverTime - sample.localMidpoint : undefined,
  };

  async function send(command: RelayCommand) {
    if (!credentials || sending.current) return false;
    sending.current = true; setBusy(true); setError('');
    pendingRef.current = command; setPending(command);
    const attemptGeneration = generation.current;
    const sent = performance.now();
    try {
      const next = await timerRequest<RelaySnapshot>('command', { sessionId: credentials.sessionId, command }, credentials);
      if (generation.current !== attemptGeneration) return false;
      accept(next, sent);
      pendingRef.current = null; setPending(null); return true;
    } catch (e) {
      if (generation.current !== attemptGeneration) return false;
      setError(e instanceof Error ? e.message : 'Connection lost.');
      if (e instanceof TimerApiError && e.code >= 400 && e.code < 500) { pendingRef.current = null; setPending(null); }
      else setHealth(h => ({ ...h, failed: true }));
      return false;
    } finally {
      if (generation.current === attemptGeneration) { sending.current = false; setBusy(false); }
    }
  }
  function command(action: RelayCommand['action'], details: Partial<RelayCommand> = {}) {
    if (!latest.current || pendingRef.current || !connected || !chiefConnected || performance.now() - health.lastSuccess >= 3000) return Promise.resolve(false);
    const timing = action !== 'start' && raceClock.current?.raceId === latest.current.race.id ? raceClock.current.sample : bestClock(samples.current, performance.now());
    const timed = ['start', 'stop', 'stopLane', 'stopAll'].includes(action);
    const estimatedError = clockUncertainty(timing, performance.now());
    if (timed && (!timing || !synchronised || estimatedError > 100)) return Promise.resolve(false);
    return send({ ...details, ...(timed && timing ? { at: serverTimeAt(timing, performance.now()), uncertainty: estimatedError } : {}), id: timerId(), raceId: latest.current.race.id, action });
  }
  function finish(lane: number) {
    const current = latest.current;
    const timing = current && raceClock.current && raceClock.current.raceId === current.race.id ? raceClock.current.sample : null;
    if (!current || !timing || !synchronised || current.race.state !== 'running') return Promise.resolve(false);
    return command('submit', { lane, status: '', milliseconds: Math.max(0, Math.round(serverTimeAt(timing, performance.now()) - current.race.startedAt!)), uncertainty: timing.uncertainty + Math.max(0, performance.now() - timing.localMidpoint) * 0.0001 });
  }
  return { snapshot, connected, chiefConnected, synchronised, syncDisabledReason, diagnostics, clockEvidence: sample ?? latestSample, localNow: tick, serverNow, raceNow, uncertainty: Number.isFinite(uncertainty) ? uncertainty : undefined,
    error: error || transportError, busy, pending, command, finish, retry: () => pendingRef.current ? send(pendingRef.current) : Promise.resolve(false) };
}
