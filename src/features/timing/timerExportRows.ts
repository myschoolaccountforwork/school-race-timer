import { formatTime, positions } from './timerOnly.ts';
import type { TimerRace } from './timerOnly.ts';

export function timerExportRows(races: TimerRace[]) {
  return races.flatMap(r => {
    const ranked = positions(r.lanes);
    return r.lanes.map(l => ({ Race: r.number, 'Race ID': r.id, Lane: l.lane, Position: ranked[l.lane] ?? '',
      Time: l.milliseconds === null ? '' : formatTime(l.milliseconds), Milliseconds: l.milliseconds ?? '',
      Status: l.status, Corrected: l.corrected ? 'Yes' : '', Confirmed: r.confirmedAt ?? '',
      'Start reference': r.startReference === 'relay' ? 'Relay receipt - internet test; physical start delay unknown'
        : r.startReference === 'chief-local' ? 'Chief original local tap' : r.startReference === 'tap' ? 'Chief synchronised tap' : 'Single-device local start',
      'Timing source': l.timingSource ?? (l.corrected ? 'manual' : 'local / legacy'),
      Verification: l.reviewRequired ? 'Unverified - review required' : l.reconciliation ? 'Clock-policy verified at selection; physical accuracy not validated' : 'Chief local / manual / legacy; not volunteer clock-policy verified',
      'Uncertainty (ms)': l.reconciliation?.uncertainty ?? '', 'Clock policy': l.reconciliation?.policy ?? '',
      'Capture ID': l.reconciliation?.captureId ?? '', 'Chief Start ID': l.reconciliation?.startId ?? r.chiefStart?.id ?? '',
      'Reconciliation ID': l.reconciliation?.id ?? '',
      'Clock evidence IDs': [...(l.reconciliation?.start?.sampleIds ?? []), ...(l.reconciliation?.finish?.sampleIds ?? [])].join(' '),
      'Chief local fallback (ms)': l.chiefLocalMilliseconds ?? '',
    }));
  });
}
