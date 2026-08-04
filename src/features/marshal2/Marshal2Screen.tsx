import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
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
  const event = useMemo(loadEvent, []);
  const initialMarshalState = useMemo(loadMarshalState, []);

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

  const [message, setMessage] = useState("");

  if (!event || !marshalState) {
    return (
      <main className="marshal2-page">
        <section className="marshal2-shell marshal2-empty">
          <h1>Marshal 2</h1>
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

  const queue = marshalState.groups.filter(
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
      ...marshalState,
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
    const groups = marshalState.groups.map((group) => {
      if (
        group.group.id !== groupId ||
        group.status === "confirmed"
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

  function returnToMarshal1() {
    if (!selectedGroup) return;

    const groups = marshalState.groups.map((group) =>
      group.group.id === selectedGroup.group.id
        ? {
            ...group,
            status: "returned" as const,
          }
        : group,
    );

    saveState(groups);
    setMessage("Returned to Marshal 1 for correction.");
  }

  function confirmGroup() {
    if (!selectedGroup) return;

    const hasAthletes = selectedGroup.heats.some((heat) =>
      heat.names.some((name) => name.trim() !== ""),
    );

    if (!hasAthletes) {
      setMessage(
        "Add or confirm at least one athlete before confirming.",
      );
      return;
    }

    const groups = marshalState.groups.map((group) =>
      group.group.id === selectedGroup.group.id
        ? {
            ...group,
            status: "confirmed" as const,
          }
        : group,
    );

    saveState(groups);
    setMessage("Group confirmed and locked for Marshal 1.");

    const next = groups.find(
      (group) =>
        group.status === "sent" ||
        group.status === "returned",
    );

    setSelectedGroupId(next?.group.id ?? null);
  }

  return (
    <main className="marshal2-page">
      <section className="marshal2-shell">
        <div className="marshal2-top-row">
          <Link className="back-link" to={AppRoute.TRACK_CONTROL}>
            ← Event Control
          </Link>
        </div>

        <header className="marshal2-header">
          <p className="marshal2-eyebrow">Marshal 2</p>
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
            <h2>Waiting for Marshal 1</h2>
            <p>No groups have been pushed to Marshal 2 yet.</p>
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
                      {group.status === "confirmed"
                        ? "Confirmed"
                        : group.status === "returned"
                          ? "Returned"
                          : "Waiting"}
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
                    <section className="marshal2-heat-card" key={heat.id}>
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
                              disabled={selectedGroup.status === "confirmed"}
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
                    </section>
                  ))}
                </div>

                {selectedGroup.status === "confirmed" ? (
                  <div className="marshal2-confirmed-note">
                    This group is confirmed and locked.
                  </div>
                ) : (
                  <div className="marshal2-actions">
                    <button
                      className="marshal2-secondary-button"
                      type="button"
                      onClick={returnToMarshal1}
                    >
                      Return To Marshal 1
                    </button>

                    <button
                      className="marshal2-primary-button"
                      type="button"
                      onClick={confirmGroup}
                    >
                      Confirm Group
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
