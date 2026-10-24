import type { Gender } from "../../types/events";

export interface QueuedRace {
  group: {
    id: string;
    age: string;
    gender: Gender;
  };
  heat: {
    id: string;
    names: string[];
    ready?: boolean;
  };
  heatNumber: number;
  pushedAt: string;
}

export type RaceControlStatus = "waiting" | "running" | "stopped";

export interface RaceControl {
  raceId: string;
  status: RaceControlStatus;
  startedAt: number | null;
  stoppedAt?: number;
}

export interface LaneResult {
  lane: number;
  finishMilliseconds?: number;
  status?: "DNS" | "DQ" | "DNF";
  submittedAt: number;
}

export interface LaneResultStore {
  raceId: string;
  results: Record<string, LaneResult>;
}

export interface ChiefResultOverride {
  lane: number;
  finishMilliseconds: number | null;
  status: "DQ" | "DNS" | "DNF" | null;
  editedAt: number;
}

export interface ChiefOverrideStore {
  raceId: string;
  overrides: Record<string, ChiefResultOverride>;
}

export interface StarterRaceStatus {
  status: "confirmed" | "wrong-group";
  updatedAt: number;
}

export interface StarterStatusStore {
  statuses: Record<string, StarterRaceStatus>;
}

export const CHIEF_QUEUE_KEY = "raceflow.chiefTimekeeperQueue";
export const CURRENT_RACE_KEY = "raceflow.chiefTimekeeperCurrentRace";
export const RACE_CONTROL_KEY = "raceflow.currentRaceControl";
export const LANE_RESULTS_KEY = "raceflow.laneResults";
export const CHIEF_OVERRIDES_KEY = "raceflow.chiefResultOverrides";
export const STARTER_STATUS_KEY = "raceflow.starterStatuses";
export const CHIEF_RACE_CONFIRMATIONS_KEY =
  "raceflow.chiefRaceConfirmations";

export function readStorage<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeRaceControl(control: RaceControl) {
  localStorage.setItem(RACE_CONTROL_KEY, JSON.stringify(control));
}

export function emptyResultStore(raceId: string): LaneResultStore {
  return { raceId, results: {} };
}
