import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import LiveSessionStatus from "../../components/LiveSessionStatus";
import type { TrackEventDraft } from "../../types/events";
import {
  CHIEF_QUEUE_KEY,
  CHIEF_RACE_CONFIRMATIONS_KEY,
  CURRENT_RACE_KEY,
  STARTER_STATUS_KEY,
  readStorage,
} from "../timing/timingStorage";
import type {
  QueuedRace,
  StarterStatusStore,
} from "../timing/timingStorage";
import "./StarterScreen.css";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";

function loadQueue() {
  const queue = readStorage<unknown>(CHIEF_QUEUE_KEY);
  return Array.isArray(queue) ? (queue as QueuedRace[]) : [];
}

function loadStatuses(): StarterStatusStore {
  return (
    readStorage<StarterStatusStore>(STARTER_STATUS_KEY) ?? {
      statuses: {},
    }
  );
}

function ageLabel(age: string) {
  return age === "open" ? "Open" : age;
}

export default function StarterScreen() {
  const event = useMemo(
    () => readStorage<TrackEventDraft>(EVENT_STORAGE_KEY),
    [],
  );
  const [queue, setQueue] = useState(loadQueue);
  const [currentRace, setCurrentRace] = useState<QueuedRace | null>(() =>
    readStorage<QueuedRace>(CURRENT_RACE_KEY),
  );
  const [statuses, setStatuses] = useState(loadStatuses);
  const [chiefConfirmations, setChiefConfirmations] = useState<
    Record<string, boolean>
  >(
    () =>
      readStorage<Record<string, boolean>>(
        CHIEF_RACE_CONFIRMATIONS_KEY,
      ) ?? {},
  );

  useEffect(() => {
    function handleStorage(storageEvent: StorageEvent) {
      if (storageEvent.key === CHIEF_QUEUE_KEY) setQueue(loadQueue());
      if (storageEvent.key === CURRENT_RACE_KEY) {
        setCurrentRace(readStorage<QueuedRace>(CURRENT_RACE_KEY));
      }
      if (storageEvent.key === STARTER_STATUS_KEY) {
        setStatuses(loadStatuses());
      }
      if (storageEvent.key === CHIEF_RACE_CONFIRMATIONS_KEY) {
        setChiefConfirmations(
          readStorage<Record<string, boolean>>(
            CHIEF_RACE_CONFIRMATIONS_KEY,
          ) ?? {},
        );
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const races = [
    ...(currentRace ? [currentRace] : []),
    ...queue,
  ].filter(
    (race, index, allRaces) =>
      allRaces.findIndex((item) => item.heat.id === race.heat.id) === index,
  );
  const nextRace = races[0] ?? null;
  const displayName = event
    ? event.customEventName || event.eventName
    : "Track Event";

  function setRaceStatus(status: "confirmed" | "wrong-group") {
    if (!nextRace) return;

    const updated: StarterStatusStore = {
      statuses: {
        ...statuses.statuses,
        [nextRace.heat.id]: {
          status,
          updatedAt: Date.now(),
        },
      },
    };
    setStatuses(updated);
    localStorage.setItem(STARTER_STATUS_KEY, JSON.stringify(updated));
  }

  return (
    <main className="starter-page">
      <section className="starter-shell">
        <LiveSessionStatus />
        <Link className="back-link" to={AppRoute.HOME}>
          ← Home
        </Link>

        <header className="starter-header">
          <p>Starter</p>
          <h1>{displayName}</h1>
        </header>

        {!event?.useStarterConfirmation ? (
          <p className="starter-empty">
            Starter confirmation is not enabled for this event.
          </p>
        ) : !nextRace ? (
          <p className="starter-empty">No race is waiting for the Starter.</p>
        ) : (
          <>
            <section className="starter-order-list">
              <h2>Race order</h2>
              <ol>
                {races.map((race, index) => (
                  <li key={race.heat.id}>
                    <span>
                      {ageLabel(race.group.age)}{" "}
                      {race.group.gender === "boys" ? "Boys" : "Girls"} —
                      Heat {race.heatNumber}
                    </span>
                    <strong>{index === 0 ? "Next" : "Waiting"}</strong>
                  </li>
                ))}
              </ol>
            </section>

            <section className="starter-race">
              <p className="starter-order">Next race</p>
              <h2>
                {ageLabel(nextRace.group.age)}{" "}
                {nextRace.group.gender === "boys" ? "Boys" : "Girls"}
              </h2>
              <h3>Heat {nextRace.heatNumber}</h3>

              <div className="starter-live-confirmations">
                <span>
                  Chief Timekeeper{" "}
                  <strong>
                    {chiefConfirmations[nextRace.heat.id]
                      ? "🟢 Confirmed"
                      : "○ Waiting"}
                  </strong>
                </span>
                <span>
                  Starter{" "}
                  <strong>
                    {statuses.statuses[nextRace.heat.id]?.status ===
                    "confirmed"
                      ? "🟢 Confirmed"
                      : "○ Waiting"}
                  </strong>
                </span>
              </div>

              <ol className="starter-athletes">
                {nextRace.heat.names.map((name, index) => (
                  <li key={`${nextRace.heat.id}-${index}`}>
                    <span>Lane {index + 1}</span>
                    <strong>{name.trim() || "Empty"}</strong>
                  </li>
                ))}
              </ol>

              {statuses.statuses[nextRace.heat.id] && (
                <p
                  className={`starter-status starter-status-${
                    statuses.statuses[nextRace.heat.id].status
                  }`}
                >
                  {statuses.statuses[nextRace.heat.id].status ===
                  "confirmed"
                    ? "Starter Confirmed"
                    : "Wrong Group reported"}
                </p>
              )}

              <div className="starter-actions">
                <button
                  className="starter-confirm"
                  type="button"
                  disabled={
                    statuses.statuses[nextRace.heat.id]?.status ===
                    "confirmed"
                  }
                  onClick={() => setRaceStatus("confirmed")}
                >
                  {statuses.statuses[nextRace.heat.id]?.status ===
                  "confirmed"
                    ? "Starter Confirmed"
                    : "Confirm Ready"}
                </button>
              <button
                className="starter-wrong"
                type="button"
                disabled={
                  statuses.statuses[nextRace.heat.id]?.status ===
                  "confirmed"
                }
                onClick={() => setRaceStatus("wrong-group")}
                >
                  Wrong Group
                </button>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
