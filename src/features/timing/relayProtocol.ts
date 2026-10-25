import type { ResultStatus, TimerRace } from './timerOnly.ts';
import type { TimingCapture } from './localCapture.ts';
export interface RelayCredentials { sessionId: string; token: string; role: 'chief' | 'lane'; joinToken?: string }
export interface Volunteer { id: string; lane: number; lastSeen: number }
export interface Submission {
  id: string; raceId: string; volunteerId: string; lane: number;
  milliseconds: number | null; status: ResultStatus; uncertainty: number;
}
export interface RelaySnapshot {
  sessionId: string; revision: number; serverNow: number; race: TimerRace;
  volunteers: Volunteer[]; submissions: Submission[]; chiefLastSeen: number;
  history: TimerRace[]; selfId?: string;
  captures?: (TimingCapture & { volunteerId?: string; source: 'chief' | 'lane'; verification: 'pending' })[];
}
export interface RelayCommand {
  id: string; raceId: string; action: 'start' | 'startRelay' | 'localCapture' | 'stop' | 'stopLane' | 'stopAll' | 'reset' | 'falseStart' | 'correct' | 'select' | 'confirm' | 'next' | 'submit';
  lane?: number; milliseconds?: number | null; status?: ResultStatus; at?: number;
  submissionId?: string; uncertainty?: number;
  capture?: TimingCapture;
}
