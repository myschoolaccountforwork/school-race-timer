import type { Reconciliation } from './reconciliation';
import { formatTime } from './timerOnly';

export default function VolunteerMeasurement({ result }: { result?: Reconciliation }) {
  const status = result?.verification ?? 'pending';
  return <div className="volunteer-measurement" data-verification={status}>
    <strong>{status === 'verified' ? 'Verified (clock policy)' : status === 'unverified' ? 'Unverified' : 'Pending verification'}</strong>
    {result?.milliseconds != null && <p>Calculated elapsed: {result.milliseconds < 0 ? '-' : ''}{formatTime(Math.abs(result.milliseconds))}
      {result.uncertainty != null ? ` (±${Math.ceil(result.uncertainty)} ms clock uncertainty)` : ''}</p>}
    <p>{result?.reason ?? 'Reconciliation details are missing from this relay response. Raw timestamp retained; check that the relay and frontend are both Build 020 or newer.'}</p>
    {result?.diagnostics && <details open={status === 'pending'}><summary>Clock evidence diagnostics</summary>
      <p>Original Chief Start record: {result.diagnostics.startRecord}. Evidence is checked against each original event, not the current polling time.</p>
      {([['Chief Start', result.diagnostics.start], ['Volunteer Finish', result.diagnostics.finish]] as const).map(([name, d]) => d && <div key={name}>
        <p><strong>{name}</strong> / capture clock epoch {d.epochId.slice(0, 8)}: {d.available} retained samples;
          {' '}{d.matchingDeviceEpoch} device-epoch matches; {d.matchingRelayEpoch} relay-epoch matches;
          {' '}{d.usable} usable within 15000 ms; {d.stale} stale; {d.invalid} invalid.</p>
        <p>Nearest matching sample: {d.nearestAgeMs === null ? 'none' : `${Math.ceil(d.nearestAgeMs)} ms from event`}.
          Nearby sample span: {Math.floor(d.spanMs)} ms (need two distinct samples spanning 1000 ms).</p>
        {d.health && <p>Relay observed {d.health.probes} probes / {d.health.completions} accepted sample submissions (including retries and embedded evidence).
          Last accepted evidence: {d.health.lastAcceptedAgeMs === null ? 'none' : `${Math.ceil(d.health.lastAcceptedAgeMs)} ms ago`}.
          {d.health.lastError ? ` Latest rejection: ${d.health.lastError}` : ''}</p>}
      </div>)}
      <p>Rechecked automatically on each state poll and evidence completion. An old gap requires saved original evidence; waiting cannot make samples from another epoch or more than 15 seconds away valid. Diagnostics: {result.diagnostics.version}.</p>
    </details>}
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
