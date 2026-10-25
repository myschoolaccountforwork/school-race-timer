import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { complete, formatTime, mergeConfirmedHistory, newRace, parseTime, positions, TIMER_ONLY_KEY } from './timerOnly';
import type { ResultStatus, TimerLane, TimerRace, TimerSession } from './timerOnly';
import type { RelayCredentials, RelaySnapshot } from './relayProtocol';
import { readStorage } from './timingStorage';
import { timerId } from './timerId';
import { localRaceNow } from './localClock';
import { timerRequest, useTimerRelay } from './useTimerRelay';
import { useLocalCaptures } from './useLocalCaptures';
import { timingJoinUrl } from './relayUrls';
import TimerHistory from './TimerHistory';
import '../events/TimingOnlyScreen.css';

const CHIEF_KEY = 'timer-only-chief';
function storedCredentials(key: string): RelayCredentials | null {
  try {
    // Migrate Build 017 tabs without losing the active session on refresh.
    const saved = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    const value = JSON.parse(saved ?? 'null') as RelayCredentials | null;
    if (!value || typeof value.sessionId !== 'string' || typeof value.token !== 'string' || !['chief', 'lane'].includes(value.role)) return null;
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.removeItem(key);
    return value;
  } catch { return null; }
}
function localSession(): TimerSession { return readStorage<TimerSession>(TIMER_ONLY_KEY) ?? { current: newRace(), history: [] }; }

export default function RelayTimingScreen({ volunteer = false }: { volunteer?: boolean }) {
  // Keep join capabilities out of the URL query and out of request/referrer logs.
  const [join] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const sessionId = join.get('id') ?? '';
  const joinToken = join.get('key') ?? '';
  const storageKey = volunteer ? `timer-only-lane-${sessionId}` : CHIEF_KEY;
  const [credentials, setCredentials] = useState<RelayCredentials | null>(() => storedCredentials(storageKey));
  const [laneCount, setLaneCount] = useState(8);
  const [availableLanes, setAvailableLanes] = useState(0);
  const [setupBusy, setSetupBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState(() => volunteer ? [] : localSession().history);
  const [savedRaceId, setSavedRaceId] = useState('');
  const [editing, setEditing] = useState<TimerLane | null>(null);
  const [time, setTime] = useState('');
  const [status, setStatus] = useState<ResultStatus>('');
  const [correctionError, setCorrectionError] = useState('');
  const [showQr, setShowQr] = useState(false);
  const saveHistory = useCallback((snapshot: RelaySnapshot) => {
    if (volunteer || !snapshot.history.length) return;
    const confirmed = snapshot.history;
    const latestId = confirmed[confirmed.length - 1].id;
    try {
      const local = localSession();
      const missing = confirmed.some(r => !local.history.some(c => c.id === r.id));
      const merged = missing ? mergeConfirmedHistory(local, confirmed) : local;
      if (missing) localStorage.setItem(TIMER_ONLY_KEY, JSON.stringify(merged));
      setHistory(merged.history); setSavedRaceId(latestId);
    } catch { setSavedRaceId(''); setMessage('Local saving failed. Keep this session open. Free browser storage before Next Race. Saving retries automatically.'); }
  }, [volunteer]);
  const relay = useTimerRelay(credentials, saveHistory);
  const navigate = useNavigate();
  const state = relay.snapshot;
  const local = useLocalCaptures(credentials, state);
  const race = local.race;
  const elapsed = race?.state === 'running' ? (local.usableStart ? Math.max(0, relay.localNow - local.usableStart.localAt) : race.startReference === 'chief-local' ? 0 : Math.max(0, relay.raceNow - race.startedAt!)) : race?.elapsed ?? 0;
  const self = state?.volunteers.find(v => v.id === state.selfId);
  const submission = state?.submissions.find(s => s.volunteerId === state.selfId && s.raceId === race?.id);
  const disabled = !relay.connected || !relay.chiefConnected || relay.busy || Boolean(relay.pending);
  const locked = race?.state === 'confirmed';
  const joinUrl = credentials?.joinToken ? timingJoinUrl(credentials.sessionId, credentials.joinToken) : '';
  const places = race ? positions(race.lanes) : {};
  const startReason = !race || race.state !== 'ready' || complete(race) ? 'Race is not ready.'
    : relay.busy || relay.pending ? 'Wait for the previous race-control action.'
    : local.journal?.loadFailed ? 'Local capture archive needs recovery.' : '';
  const capturedFinish = local.currentRecords.find(r => r.capture.kind === 'finish' && r.capture.lane === self?.lane);
  const remoteFinish = state?.captures?.find(c => c.kind === 'finish' && c.volunteerId === state.selfId);
  const metric = (value: number | undefined) => value === undefined ? 'No sample' : Math.round(value).toLocaleString() + ' ms';

  useEffect(() => {
    if (!volunteer || credentials || !sessionId || !joinToken) return;
    let active = true;
    timerRequest<{ laneCount: number }>('preview', { sessionId, joinToken }).then(data => {
      if (active) setAvailableLanes(data.laneCount);
    }).catch(e => { if (active) setMessage(e instanceof Error ? e.message : 'Unable to reach relay.'); });
    return () => { active = false; };
  }, [volunteer, credentials, sessionId, joinToken]);

  async function createOrJoin(lane?: number) {
    if (setupBusy) return;
    setSetupBusy(true); setMessage('');
    try {
      const local = volunteer ? null : localSession();
      const number = local ? Math.max(local.current.number, ...local.history.map(r => r.number), 0) + (local.history.length || local.current.state !== 'ready' || local.current.lanes.some(l => l.status !== '' || l.milliseconds !== null) ? 1 : 0) : 1;
      // A stable per-device token also makes a join retry idempotent if its response is lost.
      const identityKey = `${storageKey}-identity`;
      const identity = localStorage.getItem(identityKey) ?? timerId();
      localStorage.setItem(identityKey, identity);
      const next = volunteer
        ? await timerRequest<RelayCredentials>('join', { sessionId, joinToken, lane, token: identity })
        : await timerRequest<RelayCredentials>('create', { laneCount, number });
      localStorage.setItem(storageKey, JSON.stringify(next));
      setCredentials(next);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to connect.'); }
    finally { setSetupBusy(false); }
  }
  async function fallback() {
    if (local.interrupted && race?.state === 'running') { setMessage('Clock continuity is lost. Reset the attempt or use independent manual results before fallback.'); return; }
    if (!window.confirm('Switch to Chief-only timing? Volunteers must stop using this session. Official times will be kept and a running clock will continue on this device.')) return;
    try {
      const local = localSession();
      const fallbackRace: TimerRace = race ? { ...race, id: timerId(), elapsed: Math.round(elapsed), startedAt: race.startedAt === null ? null : localRaceNow() - elapsed } : local.current;
      // Keep confirmed IDs intact so history and the current locked race remain the same record.
      if (race?.state === 'confirmed') fallbackRace.id = race.id;
      const confirmed = state?.history ?? [];
      const merged = [...local.history.filter(r => !confirmed.some(c => c.id === r.id)), ...confirmed];
      localStorage.setItem(TIMER_ONLY_KEY, JSON.stringify({ current: fallbackRace, history: merged }));
      if (credentials) {
        await timerRequest('close', { sessionId: credentials.sessionId }, credentials).catch(() => undefined);
      }
      localStorage.removeItem(CHIEF_KEY); navigate('/timing');
    } catch { setMessage('Unable to save fallback results locally. Export your results or free browser storage before switching.'); }
  }
  async function confirm() {
    if (!race || !window.confirm('Confirm and lock official results? Unselected volunteer times will not become official.')) return;
    try { const local = localSession(); localStorage.setItem(TIMER_ONLY_KEY, JSON.stringify(local)); }
    catch { setMessage('Local storage unavailable. Results cannot be confirmed safely.'); return; }
    await relay.command('confirm');
  }
  async function correction(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!editing) return;
    const ms = time.trim() ? parseTime(time) : null;
    if ((time.trim() && ms === null) || (!status && ms === null)) { setCorrectionError('Enter a positive time in seconds or mm:ss.mmm, or choose a status.'); return; }
    setCorrectionError('');
    if (await relay.command('correct', { lane: editing.lane, milliseconds: status === 'DNS' || status === 'DNF' ? null : ms, status })) setEditing(null);
  }

  return <main className="timer-only"><div className="timer-shell">
    <Link to={volunteer ? '/' : '/timing'}>{volunteer ? 'Home' : 'Single-device Timing Only'}</Link>
    <header><p>RACEFLOW - BUILD 019 - LOCAL CAPTURE</p><h1>{volunteer ? 'Lane Timekeeper' : 'Multi-device Timer Only'}</h1>
      <p>{volunteer ? 'Keep this screen awake. One submission per volunteer per race.' : 'No student names. Confirmed results stay in this browser.'}</p></header>
    {message && <p className="timer-notice" role="status">{message}</p>}
    {!credentials ? <section className="timer-panel">
      {volunteer ? <><h2>Select your lane</h2><p>Several volunteers can time the same lane.</p>
        {!sessionId || !joinToken ? <p>Scan the Chief's Timing Only QR code or open their join link.</p> : null}
        <div className="timer-controls">{Array.from({ length: availableLanes }, (_, i) => <button disabled={setupBusy} key={i} onClick={() => void createOrJoin(i + 1)}>Join Lane {i + 1}</button>)}</div>
        {sessionId && !availableLanes && <button onClick={() => window.location.reload()}>Retry connection</button>}
      </> : <><h2>Create a shared timing session</h2><label>Number of lanes <select value={laneCount} onChange={e => setLaneCount(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i}>{i + 1}</option>)}</select></label>
        <p>Use the hosted website and internet relay with mobile data or Wi-Fi. Keep this screen awake while timing.</p>
        <button className="primary" disabled={setupBusy} onClick={() => void createOrJoin()}>Create session</button></>}
    </section> : <>
      <aside className={`timer-panel relay-connection ${relay.connected && relay.chiefConnected ? 'is-connected' : ''}`} role="status">
        <strong>{!relay.connected && !navigator.onLine ? 'Disconnected - device reports offline' : !relay.connected ? 'Disconnected / reconnecting to relay' : !relay.chiefConnected ? 'Chief disconnected - waiting for reconnection' : 'Connected to timing relay'}</strong>
        <p>Finish capture is local and does not wait for clock sync or upload acknowledgements. Volunteer measurements remain Pending verification in Stage 1.</p>
        <p>{relay.synchronised ? `Clock sample uncertainty about ±${Math.ceil(relay.uncertainty ?? 0)} ms (network estimate only).` : 'Clock alignment is insufficient. Local capture remains available; volunteer elapsed times are not verified.'}</p>
        <details className="relay-diagnostics"><summary>Connection and clock diagnostics</summary>
          <p>Connection: {relay.connected ? 'Connected' : 'Disconnected / reconnecting'}. Last successful response: {metric(relay.diagnostics.lastSuccessAge)} ago.</p>
          <p>Latest round trip: {metric(relay.diagnostics.latestRoundTrip)}. Latest sample age: {metric(relay.diagnostics.latestSampleAge)}.</p>
          <p>Selected sample age: {metric(relay.diagnostics.sampleAge)}. Selected network uncertainty: {metric(relay.diagnostics.selectedUncertainty)}. Active clock uncertainty including drift: {metric(relay.uncertainty)}.</p>
          <p>Frozen race clock age: {metric(relay.diagnostics.raceClockAge)}. Relay minus browser clock offset: {metric(relay.diagnostics.offset)} (different monotonic origins are normal).</p>
          <p>Clock evidence only: {relay.syncDisabledReason || 'A clock sample is available; Stage 1 still does not verify volunteer elapsed times.'}</p>
          {!volunteer && <p>Start: {startReason || 'Ready. Original Chief local tap; no relay timestamp substitution.'}</p>}
          <p>Polling waits 750 ms after each request. Samples expire after 15 seconds; connection freshness is 3 seconds. Round trip includes network, possible CORS preflight, server work and browser processing.</p>
        </details>
        {!volunteer && <p role="status">Start: {startReason || 'Ready for the physical starter signal.'}</p>}
        {relay.error && <p>{relay.error}</p>}
        {local.error && <p className="timer-notice" role="alert">{local.error}</p>}
        {local.interrupted && <p className="timer-notice" role="alert">Chief clock continuity lost after reload or leaving the page. Existing captures are retained. New Chief timed captures are blocked: reset the attempt or enter manual results from an independent reference.</p>}
        <div className="timer-controls"><button onClick={() => local.retrySaving()}>Retry local saving</button><button disabled={!local.records.length} onClick={() => local.download()}>Export raw capture archive</button></div>
        <details><summary>Capture delivery ({local.records.length} records)</summary>
          <p>Received means relay acknowledgement, not verified timing. Keep this page open when local saving fails.</p>
          <p>Showing the last 20 records. The raw archive includes all retained local records and received Chief Start references.</p>
          {local.records.slice(-20).map(r => <p key={r.capture.id}>Attempt {r.capture.raceId.slice(0, 8)} - {r.capture.kind}{r.capture.lane ? ' Lane ' + r.capture.lane : ''}: Captured{r.delivery !== 'captured' ? ' / Saved locally' : ' (memory only)'}{r.delivery === 'received' ? ' / Received' : ''} - {r.capture.kind === 'finish' && volunteer ? 'Pending verification' : 'Chief local record; accuracy not certified'}. {r.delivery === 'rejected' ? 'Upload rejected; retained locally. ' : ''}{r.error}</p>)}
        </details>
        {relay.pending && <><p>Unverified action awaiting relay acknowledgement. This is not an official result. {relay.pending.milliseconds != null ? `Captured ${formatTime(relay.pending.milliseconds)}.` : ''} Retry sends the same action, never a new finish time.</p><button disabled={relay.busy || !relay.connected} onClick={() => void relay.retry()}>Retry acknowledgement</button></>}
        {!volunteer && <button disabled={relay.busy} onClick={() => { if (window.confirm('Forget this session on this phone? Saved confirmed results remain.')) { localStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey); window.location.reload(); } }}>Forget session / create a new one</button>}
      </aside>
      {!volunteer && <section className="timer-panel"><div className="timer-controls"><button disabled={!joinUrl} onClick={() => setShowQr(!showQr)}>{showQr ? 'Hide QR' : 'Show join QR'}</button>
        <button disabled={!joinUrl} onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(joinUrl).then(() => setMessage('Join link copied.')).catch(() => setMessage('Select and copy the join link below.')); else setMessage('Select and copy the join link below.'); }}>Copy join link</button>
        <button disabled={!joinUrl || !navigator.share} onClick={() => void navigator.share({ title: 'RaceFlow lane timing', url: joinUrl }).catch(() => setMessage('Sharing cancelled. You can copy the link.'))}>Share join link</button>
        <button onClick={() => void fallback()}>Use Chief-only fallback</button></div>
        {joinUrl && <label className="relay-join-link">Volunteer join link<input readOnly value={joinUrl} onFocus={e => e.target.select()} /></label>}
        {!joinUrl && <p className="timer-notice">A public HTTPS website address is required for production QR links. Check frontend configuration.</p>}
        {showQr && <div className="relay-qr"><QRCodeSVG value={joinUrl} size={240} level="M" includeMargin /><p>Scan to select a lane.</p></div>}
        {/localhost|127\.0\.0\.1/.test(window.location.hostname) && <p className="timer-notice">This link uses localhost and cannot be opened on another phone. Open the Chief screen using the server's reachable LAN address first.</p>}
        <h2>Volunteer connections</h2><p>Heartbeat status updates about once a second. A backgrounded or sleeping phone may appear disconnected.</p>
        {!state?.volunteers.length && <p>No lane volunteers connected. The Chief can time every lane.</p>}
        <ul>{state?.volunteers.map((v, i) => <li key={v.id}>Volunteer {i + 1} · Lane {v.lane} · {!relay.connected ? 'Unknown - Chief disconnected' : relay.serverNow - v.lastSeen < 4000 ? 'Connected' : relay.serverNow - v.lastSeen < 8000 ? 'Reconnecting' : 'Disconnected'}</li>)}</ul>
      </section>}
      {race && <>
        <section className="timer-panel"><div className="timer-heading"><h2>Race {race.number}{self ? ` · Lane ${self.lane}` : ''}</h2><strong>{locked ? 'Confirmed & locked' : race.state}</strong></div>
          {race.startReference === 'relay' && <p className="timer-notice">Internet test: elapsed times use relay receipt as the start reference. Unknown start delivery delay is excluded from the clock uncertainty estimate; these are not verified physical-start race durations.</p>}
          {race.chiefStart && <p>Chief original Start reference: {race.chiefStart.id.slice(0, 12)}. Volunteer timestamps will be reconciled against this record, never message arrival.</p>}
          <div className="standalone-clock" role="timer">{volunteer ? 'Pending verification' : local.interrupted ? 'Clock interrupted' : formatTime(elapsed)}</div>
          {volunteer ? <>
            {capturedFinish || remoteFinish ? <p role="status">Finish captured{capturedFinish ? (capturedFinish.delivery !== 'captured' ? ' / Saved locally' : ' (memory only)') : ''}{remoteFinish || capturedFinish?.delivery === 'received' ? ' / Received by relay' : ''}. Pending verification - no verified elapsed time is available in Stage 1. Stay here for Next Race.</p> : submission ? <p role="status">Received by Chief: {submission.milliseconds === null ? submission.status : formatTime(submission.milliseconds)}. Waiting for official selection. Stay here for Next Race.</p> : <>
              <button className="primary lane-finish relay-big-finish" disabled={!self || !['ready', 'running'].includes(race.state) || Boolean(local.journal?.loadFailed)} onClick={() => self && local.capture('finish', self.lane, relay.clockEvidence)}>Finish · Lane {self?.lane ?? '?'}</button>
              <p>Armed for attempt {race.id.slice(0, 8)}. Tap only at the finish. If Start is delayed, the capture stays on this displayed attempt; it is never silently moved.</p>
              <div className="timer-controls">{(['DNS', 'DNF', 'DQ'] as const).map(s => <button key={s} disabled={disabled || locked || !self || (s === 'DNF' && race.state === 'ready')} onClick={() => { if (self && window.confirm(`Submit ${s} for Lane ${self.lane}? Ask the Chief for any later correction.`)) void relay.command('submit', { lane: self.lane, milliseconds: null, status: s }); }}>{s}</button>)}</div>
            </>}
            <p>Chief-selected official result (separate from this unverified capture): {self ? (() => { const l = race.lanes[self.lane - 1]; return l.status || (l.milliseconds === null ? 'Awaiting Chief selection' : formatTime(l.milliseconds)); })() : 'Waiting for assignment'}</p>
          </> : <div className="timer-controls">
            <p>Press Start once at the physical starter signal. Each Chief lane finish is captured locally and independently.</p>
            <button className="primary" disabled={Boolean(startReason)} onClick={() => local.capture('start', undefined, relay.clockEvidence)}>Chief Start (physical signal)</button>
            <button className="danger" disabled={race.state !== 'running' || !local.usableStart} onClick={() => local.capture('stop')}>Stop clock</button>
            <button disabled={race.state !== 'running' || !local.usableStart} onClick={() => race.lanes.filter(l => l.milliseconds === null && !l.status).forEach(l => local.capture('finish', l.lane, relay.clockEvidence))}>Finish all unresolved lanes</button>
            <button disabled={disabled || locked} onClick={() => { if (window.confirm('Reset this race and clear all submissions?')) void relay.command('reset'); }}>Reset</button>
            <button disabled={disabled || !['running', 'stopped'].includes(race.state)} onClick={() => { if (window.confirm('Declare a false start? All times will be cleared; DNS official lanes will remain.')) void relay.command('falseStart'); }}>False Start</button>
          </div>}
        </section>
        {!volunteer && <><section className="timer-lanes">{race.lanes.map(l => <article className="timer-lane" key={l.lane}>
          <div className="timer-heading"><h3>Lane {l.lane}</h3><strong>{places[l.lane] ? `Place ${places[l.lane]}` : l.status || 'No official result'}</strong></div>
          <output>{l.milliseconds === null ? '—' : formatTime(l.milliseconds)} {l.status}</output>
          <button className="primary lane-finish" disabled={!local.usableStart || race.state !== 'running' || l.milliseconds !== null || l.status !== ''} onClick={() => local.capture('finish', l.lane, relay.clockEvidence)}>Chief Finish · Lane {l.lane}</button>
          <button disabled={disabled || local.unsent || locked} onClick={() => { setEditing(l); setTime(l.milliseconds === null ? '' : formatTime(l.milliseconds)); setStatus(l.status); setCorrectionError(''); }}>Correct official time / status</button>
          {l.timingSource === 'chief-local' && <small>Chief local elapsed time - not dependent on relay delivery.</small>}
          <h4>Volunteer submissions</h4>
          {state?.captures?.filter(c => c.source === 'lane' && c.kind === 'finish' && c.lane === l.lane).map(c => <p className="relay-candidate" key={c.id}>Volunteer {(state?.volunteers.findIndex(v => v.id === c.volunteerId) ?? -1) + 1}: Received / Pending verification. Raw local timestamp retained; no verified race duration. Official selection is unavailable until reconciliation is implemented.</p>)}
          {state?.submissions.filter(s => s.lane === l.lane).map(s => <div className="relay-candidate" key={s.id}>
            <span>Volunteer {state.volunteers.findIndex(v => v.id === s.volunteerId) + 1}: {s.milliseconds === null ? s.status : formatTime(s.milliseconds)}{s.milliseconds !== null ? ` (±${Math.ceil(s.uncertainty)} ms network estimate)` : ''}</span>
            <button disabled={disabled || locked} onClick={() => void relay.command('select', { lane: l.lane, submissionId: s.id })}>Use as official</button>
          </div>)}
        </article>)}</section>
        <section className="timer-panel"><p>Volunteer raw captures remain Pending verification and cannot be selected as official in Stage 1. Review Chief local times or enter manual corrections/statuses, then confirm.</p><div className="timer-controls">
          <button className="primary" disabled={disabled || local.unsent || locked || race.state === 'running' || !complete(race)} onClick={() => void confirm()}>Confirm & lock results</button>
          <button disabled={disabled || local.unsent || !locked || savedRaceId !== race.id} onClick={() => void relay.command('next')}>Next Race</button>
          {locked && savedRaceId !== race.id && <p>Waiting for local saving. Retrying automatically.</p>}
        </div></section></>}
      </>}
      {volunteer && <button disabled={relay.busy} onClick={() => window.location.reload()}>Reconnect to assigned lane</button>}
    </>}
    {!volunteer && <TimerHistory races={history} />}
    {editing && <div className="timer-overlay"><form className="timer-panel timer-editor" role="dialog" aria-modal="true" aria-labelledby="relay-correction-title" onSubmit={e => void correction(e)} onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}>
      <h2 id="relay-correction-title">Official result · Lane {editing.lane}</h2>
      <label>Time (seconds or mm:ss.mmm)<input autoFocus value={time} onChange={e => setTime(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value as ResultStatus)}><option value="">Finished</option><option>DNS</option><option>DNF</option><option>DQ</option></select></label>
      <p>DNS/DNF clear the time. Non-finish statuses do not receive positions.</p>
      {(correctionError || relay.error) && <p role="alert">{correctionError || relay.error}</p>}
      <div className="timer-controls"><button className="primary" disabled={disabled || local.unsent || locked}>Save official result</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></div>}
  </div></main>;
}
