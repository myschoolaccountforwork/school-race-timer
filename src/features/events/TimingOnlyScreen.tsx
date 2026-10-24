import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TimerHistory from '../timing/TimerHistory';
import { localRaceNow } from '../timing/localClock';

import { AppRoute } from '../../types/routes';
import { readStorage } from '../timing/timingStorage';
import { complete, formatTime, newRace, parseTime, positions, TIMER_ONLY_KEY } from '../timing/timerOnly';
import type { ResultStatus, TimerLane, TimerRace, TimerSession } from '../timing/timerOnly';
import './TimingOnlyScreen.css';

export default function TimingOnlyScreen() {
  const [session, setSession] = useState<TimerSession>(() => readStorage<TimerSession>(TIMER_ONLY_KEY) ?? { current: newRace(), history: [] });
  const sessionRef = useRef(session);
  const [now, setNow] = useState(() => localRaceNow());
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [time, setTime] = useState('');
  const [status, setStatus] = useState<ResultStatus>('');
  const [editError, setEditError] = useState('');
  const race = session.current;
  const locked = race.state === 'confirmed';
  const places = positions(race.lanes);
  const elapsed = race.state === 'running' ? Math.max(0, now - race.startedAt!) : race.elapsed;

  // Persist each action immediately, including the start timestamp for refresh recovery.
  function commit(next: TimerSession) {
    try { localStorage.setItem(TIMER_ONLY_KEY, JSON.stringify(next)); setMessage(''); }
    catch { setMessage('Local saving failed. Keep this page open and export results before leaving.'); if (next.current.state === 'confirmed') return; }
    sessionRef.current = next;
    setSession(next);
  }
  function update(next: TimerRace) { commit({ ...sessionRef.current, current: next }); }
  useEffect(() => {
    if (race.state !== 'running') return;
    let frame: number;
    const tick = () => { setNow(localRaceNow()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [race.state]);

  function reset(falseStart = false) {
    const current = sessionRef.current.current;
    if (current.state === 'confirmed') return;
    if (!window.confirm(falseStart ? 'Declare a false start? All lane times will be cleared; DNS lanes will remain.' : 'Reset this race and clear all its unconfirmed results?')) return;
    const next = newRace(current.number, current.laneCount);
    if (falseStart) next.lanes = next.lanes.map(l => current.lanes[l.lane - 1].status === 'DNS' ? { ...l, status: 'DNS' } : l);
    update(next);
    setMessage(falseStart ? 'False start declared. Ready to restart.' : 'Race reset.');
  }
  function finish(lane: number) {
    const current = sessionRef.current.current;
    if (current.state !== 'running' || current.lanes[lane - 1].milliseconds !== null || current.lanes[lane - 1].status) return;
    const milliseconds = Math.max(0, Math.round(localRaceNow() - current.startedAt!));
    const next = { ...current, lanes: current.lanes.map(l => l.lane === lane ? { ...l, milliseconds } : l) };
    if (complete(next)) { next.state = 'stopped'; next.elapsed = milliseconds; }
    update(next);
  }
  function saveCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const milliseconds = time.trim() ? parseTime(time) : null;
    if ((time.trim() && milliseconds === null) || (!status && milliseconds === null)) {
      setEditError('Enter a positive time in seconds or mm:ss.mmm, or select DNS, DNF or DQ.'); return;
    }
    const current = sessionRef.current.current;
    if (current.state === 'confirmed' || current.state === 'running') return;
    update({ ...current, lanes: current.lanes.map(l => l.lane === editing ? { ...l, milliseconds: status === 'DNS' || status === 'DNF' ? null : milliseconds, status, corrected: true } : l) });
    setEditing(null);
  }
  function laneStatus(lane: number, value: ResultStatus) {
    const current = sessionRef.current.current;
    if (current.state === 'confirmed') return;
    const next: TimerRace = { ...current, lanes: current.lanes.map(l => l.lane === lane ? { ...l, status: value, milliseconds: value === 'DNS' || value === 'DNF' ? null : l.milliseconds } : l) };
    if (next.state === 'running' && complete(next)) { next.state = 'stopped'; next.elapsed = Math.max(0, localRaceNow() - next.startedAt!); }
    update(next);
  }
  function openEditor(l: TimerLane) { setEditing(l.lane); setTime(l.milliseconds === null ? '' : formatTime(l.milliseconds)); setStatus(l.status); setEditError(''); }

  return <main className="timer-only"><div className="timer-shell">
    <Link to={AppRoute.HOME}>Home</Link>
    <p><Link to="/timing/multi">Multi-device Timing Only (local relay)</Link></p><header><p>RACEFLOW · BUILD 017</p><h1>Timer Only</h1><p>Single-device race timing · Chief Timekeeper</p></header>
    {message && <p className="timer-notice" role="status">{message}</p>}
    <section aria-label="Race controls" className="timer-panel">
      <div className="timer-heading"><h2>Race {race.number}</h2><strong>{locked ? 'Confirmed & locked' : race.state === 'ready' ? 'Ready' : race.state === 'running' ? 'Running' : 'Stopped · review results'}</strong></div>
      <label>Number of lanes <select value={race.laneCount} disabled={race.state !== 'ready' || race.lanes.some(l => l.milliseconds !== null || l.status !== '')} onChange={e => update({ ...newRace(race.number, Number(e.target.value)), id: race.id })}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>
      <div className="standalone-clock" role="timer" aria-label="Elapsed race time">{formatTime(elapsed)}</div>
      <div className="timer-controls">
        <button className="primary" disabled={race.state !== 'ready' || race.lanes.every(l => l.status === 'DNS')} onClick={() => { const startedAt = localRaceNow(); setNow(startedAt); update({ ...race, state: 'running', startedAt, elapsed: 0 }); }}>Start</button>
        <button className="danger" disabled={race.state !== 'running'} onClick={() => update({ ...race, state: 'stopped', elapsed: Math.max(0, localRaceNow() - race.startedAt!) })}>Stop</button>
        <button disabled={locked} onClick={() => reset()}>Reset</button>
        <button disabled={race.state !== 'running' && race.state !== 'stopped'} onClick={() => reset(true)}>False Start</button>
      </div>
      <p>Finish each lane as it crosses the line. Stop ends timing; unresolved lanes require a correction or status. Equal times share a position.</p>
    </section>
    <section aria-label="Lane results" className="timer-lanes">{race.lanes.map(l => <article className="timer-lane" key={l.lane}>
      <div className="timer-heading"><h3>Lane {l.lane}</h3><strong>{places[l.lane] ? `Place ${places[l.lane]}` : l.status || '—'}</strong></div>
      <output>{l.milliseconds === null ? '—' : formatTime(l.milliseconds)}{l.status && ` · ${l.status}`}</output>
      {l.corrected && <small>Corrected by Chief Timekeeper</small>}
      <button className="primary lane-finish" disabled={race.state !== 'running' || l.milliseconds !== null || l.status !== ''} onClick={() => finish(l.lane)}>Finish · Lane {l.lane}</button>
      <label>Status <select aria-label={`Lane ${l.lane} status`} value={l.status} disabled={locked} onChange={e => laneStatus(l.lane, e.target.value as ResultStatus)}><option value="">No status</option><option>DNS</option><option disabled={race.state === 'ready'}>DNF</option><option>DQ</option></select></label>
      <button disabled={locked || race.state === 'running' || race.state === 'ready'} onClick={() => openEditor(l)}>Correct time / status</button>
    </article>)}</section>
    <section className="timer-panel">
      <div className="timer-controls"><button className="primary" disabled={locked || race.state === 'running' || !complete(race)} onClick={() => {
        if (!window.confirm('Confirm and lock these results? They cannot be edited after confirmation.')) return;
        const confirmed: TimerRace = { ...race, state: 'confirmed', confirmedAt: new Date().toISOString() };
        commit({ current: confirmed, history: [...session.history, confirmed] });
      }}>Confirm & lock results</button>
      <button disabled={!locked} onClick={() => commit({ ...session, current: newRace(Math.max(race.number, ...session.history.map(r => r.number)) + 1, race.laneCount) })}>Next Race</button></div>
      <p>{locked ? 'Results locked. Start the next race when ready.' : 'Stop timing and give every lane a time or status before confirming.'}</p>
    </section>
    <TimerHistory races={session.history} />
    {editing !== null && <div className="timer-overlay"><form className="timer-panel timer-editor" role="dialog" aria-modal="true" aria-labelledby="correction-title" onSubmit={saveCorrection} onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}>
      <h2 id="correction-title">Correct Lane {editing}</h2>
      <label>Time (seconds or mm:ss.mmm)<input autoFocus value={time} onChange={e => setTime(e.target.value)} placeholder="00:12.345" /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value as ResultStatus)}><option value="">Finished</option><option>DNS</option><option>DNF</option><option>DQ</option></select></label>
      <p>DNS and DNF clear the recorded time. DQ is excluded from positions.</p>
      {editError && <p role="alert">{editError}</p>}
      <div className="timer-controls"><button type="submit" className="primary">Save correction</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></div>}
  </div></main>;
}
