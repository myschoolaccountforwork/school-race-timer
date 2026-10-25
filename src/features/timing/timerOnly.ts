export type ResultStatus = '' | 'DNS' | 'DNF' | 'DQ';
export interface TimerLane { lane: number; milliseconds: number | null; status: ResultStatus; corrected?: boolean; timingSource?: 'chief-local' | 'manual' }
export interface TimerRace {
  id: string; number: number; laneCount: number;
  state: 'ready' | 'running' | 'stopped' | 'confirmed';
  startedAt: number | null; elapsed: number; lanes: TimerLane[]; confirmedAt?: string;
  startReference?: 'relay' | 'tap' | 'chief-local';
  chiefStart?: { id: string; raceId: string; epochId: string; localAt: number; kind: 'start' };
}
export interface TimerSession { current: TimerRace; history: TimerRace[] }
export const TIMER_ONLY_KEY = 'raceflow.timerOnly.v1';
import { timerId } from './timerId.ts';
export function newRace(number = 1, laneCount = 8): TimerRace {
  return { id: timerId(), number, laneCount, state: 'ready', startedAt: null, elapsed: 0,
    lanes: Array.from({ length: laneCount }, (_, i) => ({ lane: i + 1, milliseconds: null, status: '' })) };
}
export function formatTime(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds));
  return `${String(Math.floor(value / 60000)).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
export function parseTime(value: string): number | null {
  if (!/^(?:\d+:)?\d{1,}(?:\.\d{1,3})?$/.test(value.trim())) return null;
  const parts = value.trim().split(':').map(Number);
  if (parts.length === 2 && parts[1] >= 60) return null;
  const milliseconds = Math.round((parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0]) * 1000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}
export function positions(lanes: TimerLane[]): Record<number, number> {
  const finishers = lanes.filter(l => l.status === '' && l.milliseconds !== null).sort((a, b) => a.milliseconds! - b.milliseconds!);
  const result: Record<number, number> = {};
  finishers.forEach((lane, i) => { result[lane.lane] = i > 0 && lane.milliseconds === finishers[i - 1].milliseconds ? result[finishers[i - 1].lane] : i + 1; });
  return result;
}
export function complete(race: TimerRace) { return race.lanes.every(l => l.status !== '' || l.milliseconds !== null); }
export function mergeConfirmedHistory(local: TimerSession, confirmed: TimerRace[]): TimerSession {
  if (!confirmed.length) return local;
  const history = [...local.history.filter(r => !confirmed.some(c => c.id === r.id)), ...confirmed];
  const inProgress = local.current.state === 'running' || local.current.state === 'stopped' ||
    (local.current.state === 'ready' && local.current.lanes.some(l => l.status !== '' || l.milliseconds !== null));
  return { current: inProgress ? local.current : confirmed[confirmed.length - 1], history };
}

