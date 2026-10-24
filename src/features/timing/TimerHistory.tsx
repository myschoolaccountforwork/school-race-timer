import { useState } from 'react';
import { exportTimerResults } from './timerExports';
import { formatTime, positions } from './timerOnly';
import type { TimerRace } from './timerOnly';
export default function TimerHistory({ races }: { races: TimerRace[] }) {
  const [error, setError] = useState('');
  function download(format: 'csv' | 'xlsx' | 'pdf', selected = races) {
    try { exportTimerResults(format, selected); setError(''); }
    catch { setError('Export failed. Your saved results remain on this device. Please try again.'); }
  }
  return <section className="timer-panel"><h2>Confirmed races ({races.length})</h2>
    <p>Saved in this browser on the Chief device. Export a copy for your records.</p>
    {error && <p role="alert">{error}</p>}
    <div className="timer-controls">{(['csv', 'xlsx', 'pdf'] as const).map(f => <button key={f} disabled={!races.length} onClick={() => download(f)}>Export all · {f.toUpperCase()}</button>)}</div>
    {[...races].reverse().map(r => <details key={r.id}><summary>Race {r.number} · {r.laneCount} lanes · {new Date(r.confirmedAt!).toLocaleString()}</summary>
      <ul>{r.lanes.map(l => <li key={l.lane}>Lane {l.lane}: {l.milliseconds === null ? '—' : formatTime(l.milliseconds)} {l.status} {positions(r.lanes)[l.lane] ? `· Place ${positions(r.lanes)[l.lane]}` : ''}</li>)}</ul>
      <div className="timer-controls">{(['csv', 'xlsx', 'pdf'] as const).map(f => <button key={f} onClick={() => download(f, [r])}>{f.toUpperCase()}</button>)}</div>
    </details>)}
  </section>;
}
