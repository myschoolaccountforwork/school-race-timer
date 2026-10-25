import type { Reconciliation } from './reconciliation';
import { formatTime } from './timerOnly';

export default function VolunteerMeasurement({ result }: { result?: Reconciliation }) {
  const status = result?.verification ?? 'pending';
  return <div className="volunteer-measurement" data-verification={status}>
    <strong>{status === 'verified' ? 'Verified (clock policy)' : status === 'unverified' ? 'Unverified' : 'Pending verification'}</strong>
    {result?.milliseconds != null && <p>Calculated elapsed: {result.milliseconds < 0 ? '-' : ''}{formatTime(Math.abs(result.milliseconds))}
      {result.uncertainty != null ? ` (±${Math.ceil(result.uncertainty)} ms clock uncertainty)` : ''}</p>}
    <p>{result?.reason ?? 'Waiting for authenticated evidence and the original Chief Start. The raw timestamp is retained.'}</p>
    {result?.start && result.finish && <details><summary>Reconciliation evidence</summary>
      <p>Policy: {result.policy}. Original Start: {result.startId?.slice(0, 12)}.</p>
      {([['Chief Start', result.start], ['Volunteer Finish', result.finish]] as const).map(([name, mapping]) => <p key={name}>
        {name}: {mapping.sampleIds.length} samples; maximum age at capture {Math.ceil(mapping.sampleAge)} ms;
        minimum network round trip {Math.ceil(mapping.roundTrip)} ms; offset {Math.round(mapping.offset)} ms;
        observed drift {mapping.driftPpm == null ? 'not estimated' : `${Math.round(mapping.driftPpm)} ± ${Math.ceil(mapping.driftUncertaintyPpm ?? 0)} ppm`}.
      </p>)}
      <p>Drift allowance is an assumed 100 ppm per device relative to the relay. Human reaction and physical input accuracy are not validated by this calculation.</p>
    </details>}
  </div>;
}
