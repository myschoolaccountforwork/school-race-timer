import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import LiveSessionStatus from "../../components/LiveSessionStatus";
import type { Gender, TrackEventDraft } from "../../types/events";
import "./Marshal2Screen.css";

interface EventGroup {
  id: string;
  age: string;
  gender: Gender;
}

interface HeatEntry {
  id: string;
  names: string[];
  ready?: boolean;
}

type GroupStatus =
  | "draft"
  | "sent"
  | "skipped"
  | "returned"
  | "confirmed"
  | "completed";

interface GroupEntry {
  group: EventGroup;
  heats: HeatEntry[];
  status: GroupStatus;
}

interface MarshalEntryState {
  eventCreatedAt: string;
  currentGroupIndex: number;
  groups: GroupEntry[];
}

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const ENTRY_STORAGE_KEY = "raceflow.marshal1Entry";
const QUEUE_STORAGE_KEY = "raceflow.marshal2Queue";
const CHIEF_TIMEKEEPER_QUEUE_KEY = "raceflow.chiefTimekeeperQueue";

interface ChiefTimekeeperQueueEntry {
  group: EventGroup;
  heat: HeatEntry;
  heatNumber: number;
  pushedAt: string;
}

function loadEvent(): TrackEventDraft | null {
  const raw = localStorage.getItem(EVENT_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TrackEventDraft;
  } catch {
    return null;
  }
}

function loadMarshalState(): MarshalEntryState | null {
  const raw = localStorage.getItem(ENTRY_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MarshalEntryState;
  } catch {
    return null;
  }
}

function loadChiefTimekeeperQueue(): ChiefTimekeeperQueueEntry[] {
  const raw = localStorage.getItem(CHIEF_TIMEKEEPER_QUEUE_KEY);
  if (!raw) return [];

  try {
    const queue = JSON.parse(raw) as unknown;
    return Array.isArray(queue) ? (queue as ChiefTimekeeperQueueEntry[]) : [];
  } catch {
    return [];
  }
}

function getAgeLabel(age: string) {
  return age === "open" ? "Open" : `${age} Years`;
}

function getGenderLabel(gender: Gender) {
  return gender === "boys" ? "Boys" : "Girls";
}

function titleCaseName(value: string) {
  return value.replace(
    /(^|[\s'-])([a-z])/g,
    (_match, separator: string, letter: string) =>
      `${separator}${letter.toUpperCase()}`,
  );
}

export default function Marshal2Screen() {
  const event = useMemo(() => loadEvent(), []);
  const initialMarshalState = useMemo(() => loadMarshalState(), []);

  const [marshalState, setMarshalState] =
    useState<MarshalEntryState | null>(initialMarshalState);

  const [selectedGroupId, setSelectedGroupId] =
    useState<string | null>(() => {
      const first = initialMarshalState?.groups.find(
        (group) =>
          group.status === "sent" ||
          group.status === "returned" ||
          group.status === "confirmed",
      );

      return first?.group.id ?? null;
    });

  const [selectedHeatId, setSelectedHeatId] = useState<string | null>(() => {
    const firstGroup = initialMarshalState?.groups.find(
      (group) =>
        group.status === "sent" ||
        group.status === "returned" ||
        group.status === "confirmed",
    );

    return (
      firstGroup?.heats.find((heat) => !heat.ready)?.id ??
      firstGroup?.heats[0]?.id ??
      null
    );
  });

  const [message, setMessage] = useState("");

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === ENTRY_STORAGE_KEY) {
        setMarshalState(loadMarshalState());
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  if (!event || !marshalState) {
    return (
      <main className="marshal2-page">
        <section className="marshal2-shell marshal2-empty">
          <LiveSessionStatus />
          <h1>Line Marshal</h1>
          <p>No event data is available.</p>

          <Link
            className="marshal2-primary-link"
            to={AppRoute.TRACK_CONTROL}
          >
            Event Control
          </Link>
        </section>
      </main>
    );
  }

  const activeMarshalState = marshalState;
  const queue = activeMarshalState.groups.filter(
    (group) =>
      group.status === "sent" ||
      group.status === "returned" ||
      group.status === "confirmed",
  );

  const selectedGroup =
    queue.find((group) => group.group.id === selectedGroupId) ??
    queue[0] ??
    null;

  const eventName = event.customEventName || event.eventName;

  function saveState(groups: GroupEntry[]) {
    const updatedState = {
      ...activeMarshalState,
      groups,
    };

    setMarshalState(updatedState);

    localStorage.setItem(
      ENTRY_STORAGE_KEY,
      JSON.stringify(updatedState),
    );

    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify(
        groups.filter(
          (group) =>
            group.status === "sent" ||
            group.status === "returned",
        ),
      ),
    );
  }

  function updateName(
    groupId: string,
    heatIndex: number,
    laneIndex: number,
    value: string,
  ) {
    const groups = activeMarshalState.groups.map((group) => {
      if (
        group.group.id !== groupId ||
        group.heats[heatIndex]?.ready
      ) {
        return group;
      }

      const heats = group.heats.map((heat, currentHeatIndex) => {
        if (currentHeatIndex !== heatIndex) return heat;

        const names = [...heat.names];
        names[laneIndex] = value;

        return {
          ...heat,
          names,
        };
      });

      return {
        ...group,
        heats,
      };
    });

    saveState(groups);
  }

  function pushHeatToChiefTimekeeper(heatId: string) {
    if (!selectedGroup) return;

    const selectedHeat = selectedGroup.heats.find(
      (heat) => heat.id === heatId,
    );
    if (!selectedHeat || selectedHeat.ready) return;

    const hasAthletes = selectedHeat.names.some(
      (name) => name.trim() !== "",
    );

    if (!hasAthletes) {
      setMessage("Add or confirm at least one athlete before pushing this heat.");
      return;
    }

    const heatNumber =
      selectedGroup.heats.findIndex((heat) => heat.id === selectedHeat.id) + 1;
    const updatedHeats = selectedGroup.heats.map((heat) =>
      heat.id === selectedHeat.id ? { ...heat, ready: true } : heat,
    );
    const groups = activeMarshalState.groups.map((group) => {
      if (group.group.id !== selectedGroup.group.id) return group;

      return {
        ...group,
        heats: updatedHeats,
        status: updatedHeats.every((heat) => heat.ready)
          ? ("confirmed" as const)
          : group.status,
      };
    });

    saveState(groups);
    const chiefQueue = loadChiefTimekeeperQueue();
    if (
      !chiefQueue.some(
        (entry) =>
          entry.group.id === selectedGroup.group.id &&
          entry.heat.id === selectedHeat.id,
      )
    ) {
      localStorage.setItem(
        CHIEF_TIMEKEEPER_QUEUE_KEY,
        JSON.stringify([
          ...chiefQueue,
          {
            group: selectedGroup.group,
            heat: { ...selectedHeat, ready: true },
            heatNumber,
            pushedAt: new Date().toISOString(),
          },
        ]),
      );
    }
    setMessage(`Heat ${heatNumber} pushed to Chief Timekeeper and locked.`);

    const nextHeat = updatedHeats.find((heat) => !heat.ready);
    if (nextHeat) {
      setSelectedHeatId(nextHeat.id);
      return;
    }

    const next = groups.find(
      (group) =>
        (group.status === "sent" || group.status === "returned") &&
        group.heats.some((heat) => !heat.ready),
    );
    setSelectedGroupId(next?.group.id ?? selectedGroup.group.id);
    setSelectedHeatId(
      next?.heats.find((heat) => !heat.ready)?.id ?? selectedHeat.id,
    );
  }

  return (
    <main className="marshal2-page">
      <section className="marshal2-shell">
        <LiveSessionStatus />
        <div className="marshal2-top-row">
          <Link className="back-link" to={AppRoute.TRACK_CONTROL}>
            ← Event Control
          </Link>
        </div>

        <header className="marshal2-header">
          <p className="marshal2-eyebrow">Line Marshal</p>
          <h1>{eventName}</h1>
          <p>Confirm athletes before timing.</p>
        </header>

        {message && (
          <div className="marshal2-message" role="status">
            {message}
          </div>
        )}

        {queue.length === 0 ? (
          <section className="marshal2-empty-queue">
            <h2>Waiting for Chief Marshal</h2>
            <p>No groups have been pushed to Line Marshal yet.</p>
          </section>
        ) : (
          <>
            <section className="marshal2-queue">
              <h2>Groups</h2>

              <div className="marshal2-queue-list">
                {queue.map((group) => (
                  <button
                    key={group.group.id}
                    type="button"
                    className={`marshal2-queue-row ${
                      selectedGroup?.group.id === group.group.id
                        ? "marshal2-queue-current"
                        : ""
                    }`}
                    onClick={() => {
                      setSelectedGroupId(group.group.id);
                      setSelectedHeatId(
                        group.heats.find((heat) => !heat.ready)?.id ??
                          group.heats[0]?.id ??
                          null,
                      );
                      setMessage("");
                    }}
                  >
                    <span>
                      {getAgeLabel(group.group.age)}{" "}
                      {getGenderLabel(group.group.gender)}
                    </span>

                    <span
                      className={`marshal2-status marshal2-status-${group.status}`}
                    >
                      {group.heats.filter((heat) => heat.ready).length} of{" "}
                      {group.heats.length} Heats Ready
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {selectedGroup && (
              <section className="marshal2-review">
                <header className="marshal2-review-header">
                  <h2>
                    {getAgeLabel(selectedGroup.group.age)}{" "}
                    {getGenderLabel(selectedGroup.group.gender)}
                  </h2>

                  <span>
                    {selectedGroup.heats.length}{" "}
                    {selectedGroup.heats.length === 1 ? "heat" : "heats"}
                  </span>
                </header>

                <div className="marshal2-heats">
                  {selectedGroup.heats.map((heat, heatIndex) => (
                    <section
                      className={`marshal2-heat-card ${
                        selectedHeatId === heat.id ? "marshal2-heat-current" : ""
                      } ${heat.ready ? "marshal2-heat-ready" : ""}`}
                      key={heat.id}
                      onClick={() => {
                        if (!heat.ready) setSelectedHeatId(heat.id);
                      }}
                    >
                      <h3>Heat {heatIndex + 1}</h3>

                      <div className="marshal2-lanes">
                        {heat.names.map((name, laneIndex) => (
                          <label
                            className="marshal2-lane-row"
                            key={`${heat.id}-${laneIndex}`}
                          >
                            <span>Lane {laneIndex + 1}</span>

                            <input
                              type="text"
                              value={name}
                              placeholder="Empty"
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="words"
                              spellCheck={false}
                              disabled={Boolean(heat.ready)}
                              onChange={(event) =>
                                updateName(
                                  selectedGroup.group.id,
                                  heatIndex,
                                  laneIndex,
                                  event.target.value,
                                )
                              }
                              onBlur={(event) => {
                                const formatted = titleCaseName(
                                  event.target.value.trim(),
                                );

                                updateName(
                                  selectedGroup.group.id,
                                  heatIndex,
                                  laneIndex,
                                  formatted,
                                );
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      {heat.ready && (
                        <div className="marshal2-confirmed-note">
                          Pushed to Chief Timekeeper and locked.
                        </div>
                      )}
                      {!heat.ready && (
                        <button
                          className="marshal2-heat-push-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedHeatId(heat.id);
                            pushHeatToChiefTimekeeper(heat.id);
                          }}
                        >
                          Push to Chief Timekeeper
                        </button>
                      )}
                    </section>
                  ))}
                </div>

              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
