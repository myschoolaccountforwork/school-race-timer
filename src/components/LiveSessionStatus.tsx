import { useEffect, useState } from "react";
import type { TrackEventDraft } from "../types/events";
import {
  CURRENT_RACE_KEY,
  RACE_CONTROL_KEY,
  readStorage,
} from "../features/timing/timingStorage";
import type {
  QueuedRace,
  RaceControl,
} from "../features/timing/timingStorage";
import {
  getConnectionState,
  subscribeConnection,
} from "../features/live/liveSession";
import type { ConnectionState } from "../features/live/liveSession";
import "./LiveSessionStatus.css";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const ENTRY_STORAGE_KEY = "raceflow.marshal1Entry";

interface MarshalState {
  groups: Array<{
    group: { id: string };
    heats: unknown[];
  }>;
}

function loadBannerState() {
  return {
    event: readStorage<TrackEventDraft>(EVENT_STORAGE_KEY),
    race: readStorage<QueuedRace>(CURRENT_RACE_KEY),
    control: readStorage<RaceControl>(RACE_CONTROL_KEY),
    marshal: readStorage<MarshalState>(ENTRY_STORAGE_KEY),
  };
}

function connectionLabel(state: ConnectionState) {
  if (state === "connected") return "🟢 Connected";
  if (state === "reconnecting") return "🟡 Reconnecting...";
  return "🔴 Offline";
}

export default function LiveSessionStatus() {
  const [connection, setConnection] =
    useState<ConnectionState>(getConnectionState);
  const [banner, setBanner] = useState(loadBannerState);

  useEffect(() => subscribeConnection(setConnection), []);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (
        event.key === EVENT_STORAGE_KEY ||
        event.key === CURRENT_RACE_KEY ||
        event.key === RACE_CONTROL_KEY ||
        event.key === ENTRY_STORAGE_KEY
      ) {
        setBanner(loadBannerState());
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const eventName = banner.event
    ? banner.event.customEventName || banner.event.eventName
    : "No active event";
  const race = banner.race;
  const totalHeats =
    banner.marshal?.groups.find(
      (group) => group.group.id === race?.group.id,
    )?.heats.length ?? race?.heatNumber ?? 0;
  const raceStatus =
    banner.control?.status === "running"
      ? "Running"
      : banner.control?.status === "stopped"
        ? "Finished"
        : race
          ? "Ready"
          : "Waiting";

  return (
    <aside className="live-session-status" aria-label="Live session status">
      <span className="live-connection">{connectionLabel(connection)}</span>
      <div>
        <small>Current Race</small>
        <strong>{eventName}</strong>
        {race && (
          <>
            <span>
              {race.group.age === "open" ? "Open" : race.group.age}{" "}
              {race.group.gender === "boys" ? "Boys" : "Girls"}
            </span>
            <span>
              Heat {race.heatNumber} of {totalHeats}
            </span>
          </>
        )}
        <span className={`live-race-state live-race-${raceStatus.toLowerCase()}`}>
          {raceStatus}
        </span>
      </div>
    </aside>
  );
}
