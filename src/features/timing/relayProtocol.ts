import type { ResultStatus, TimerRace } from './timerOnly.ts';
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
}
export interface RelayCommand {
  id: string; raceId: string; action: 'start' | 'stop' | 'stopLane' | 'stopAll' | 'reset' | 'falseStart' | 'correct' | 'select' | 'confirm' | 'next' | 'submit';
  lane?: number; milliseconds?: number | null; status?: ResultStatus; at?: number;
  submissionId?: string; uncertainty?: number;
}
