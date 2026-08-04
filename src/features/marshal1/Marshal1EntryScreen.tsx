import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import type { Gender, TrackEventDraft } from "../../types/events";
import "./Marshal1EntryScreen.css";

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

type ViewMode = "editor" | "dashboard";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const ENTRY_STORAGE_KEY = "raceflow.marshal1Entry";
const MARSHAL_2_QUEUE_KEY = "raceflow.marshal2Queue";

const ALL_AGES = [
  ...Array.from({ length: 14 }, (_, index) => String(index + 6)),
  "open",
];

function loadEvent(): TrackEventDraft | null {
  const raw = localStorage.getItem(EVENT_STORAGE_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as TrackEventDraft;
  } catch {
    return null;
  }
}

function makeId(prefix: string) {
  if ("randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function titleCaseName(value: string) {
  return value.replace(
    /(^|[\s'-])([a-z])/g,
    (_match, separator: string, letter: string) =>
      `${separator}${letter.toUpperCase()}`,
  );
}

function getAgeNumber(age: string) {
  return age === "open" ? 100 : Number(age);
}

function getAgeLabel(age: string) {
  if (age === "open") return "Open";

  const numericAge = Number(age);
  const birthYear = new Date().getFullYear() - numericAge;

  return `${numericAge} Years (Born ${birthYear})`;
}

function getGenderLabel(gender: Gender) {
  return gender === "boys" ? "Boys" : "Girls";
}

function getGenderRank(gender: Gender, event: TrackEventDraft) {
  if (event.genderOrder === "boys-first") {
    return gender === "boys" ? 0 : 1;
  }

  return gender === "girls" ? 0 : 1;
}

function sortGroupEntries(
  groups: GroupEntry[],
  event: TrackEventDraft,
) {
  return [...groups].sort((first, second) => {
    const firstAge = getAgeNumber(first.group.age);
    const secondAge = getAgeNumber(second.group.age);

    if (firstAge !== secondAge) {
      return event.ageOrder === "youngest-first"
        ? firstAge - secondAge
        : secondAge - firstAge;
    }

    return (
      getGenderRank(first.group.gender, event) -
      getGenderRank(second.group.gender, event)
    );
  });
}

function createOrderedGroups(event: TrackEventDraft): EventGroup[] {
  const entries: GroupEntry[] = event.ageGroups.flatMap((age) =>
    event.genders.map((gender) => ({
      group: {
        id: `${age}-${gender}`,
        age,
        gender,
      },
      status: "draft" as const,
      heats: [],
    })),
  );

  return sortGroupEntries(entries, event).map((entry) => entry.group);
}

function createBlankHeat(laneCount: number): HeatEntry {
  return {
    id: makeId("heat"),
    names: Array.from({ length: laneCount }, () => ""),
  };
}

function createCleanState(event: TrackEventDraft): MarshalEntryState {
  const laneCount = event.laneCount ?? 10;

  return {
    eventCreatedAt: event.createdAt,
    currentGroupIndex: 0,
    groups: createOrderedGroups(event).map((group) => ({
      group,
      status: "draft",
      heats: [createBlankHeat(laneCount)],
    })),
  };
}

function createInitialState(event: TrackEventDraft): MarshalEntryState {
  const existing = localStorage.getItem(ENTRY_STORAGE_KEY);

  if (!existing) return createCleanState(event);

  try {
    const parsed = JSON.parse(existing) as MarshalEntryState;
    const laneCount = event.laneCount ?? 10;

    const belongsToCurrentEvent =
      parsed.eventCreatedAt === event.createdAt;

    const lanesMatchCurrentEvent =
      parsed.groups?.every((groupEntry) =>
        groupEntry.heats.every((heat) => heat.names.length === laneCount),
      ) ?? false;

    if (
      belongsToCurrentEvent &&
      lanesMatchCurrentEvent &&
      parsed.groups.length > 0
    ) {
      return parsed;
    }
  } catch {
    // Return a clean state below.
  }

  return createCleanState(event);
}

function groupHasAthletes(groupEntry: GroupEntry) {
  return groupEntry.heats.some((heat) =>
    heat.names.some((name) => name.trim() !== ""),
  );
}

function getDisplayStatus(groupEntry: GroupEntry) {
  if (groupEntry.status === "completed") return "Completed";
  if (groupEntry.status === "confirmed") return "Confirmed";
  if (groupEntry.status === "returned") return "Returned";
  if (groupEntry.status === "sent") return "Sent to Marshal 2";
  if (groupEntry.status === "skipped") return "No athletes";
  if (groupHasAthletes(groupEntry)) return "In progress";

  return "Not started";
}

function getStatusClass(groupEntry: GroupEntry) {
  if (groupEntry.status === "completed") return "group-status-completed";
  if (groupEntry.status === "confirmed") return "group-status-confirmed";
  if (groupEntry.status === "returned") return "group-status-returned";
  if (groupEntry.status === "sent") return "group-status-sent";
  if (groupEntry.status === "skipped") return "group-status-skipped";
  if (groupHasAthletes(groupEntry)) return "group-status-progress";

  return "group-status-new";
}

function groupIsLocked(groupEntry: GroupEntry) {
  return (
    groupEntry.status === "confirmed" ||
    groupEntry.status === "completed"
  );
}

function getPushButtonLabel(groupEntry: GroupEntry) {
  if (groupEntry.status === "sent") return "Update Marshal 2";
  if (groupEntry.status === "returned") return "Push Back To Marshal 2";

  return "Push To Marshal 2";
}

function allGroupsPrepared(groups: GroupEntry[]) {
  return groups.every((group) => group.status !== "draft");
}

export default function Marshal1EntryScreen() {
  const [trackEvent, setTrackEvent] =
    useState<TrackEventDraft | null>(() => loadEvent());

  const [entryState, setEntryState] =
    useState<MarshalEntryState | null>(() => {
      const event = loadEvent();
      return event ? createInitialState(event) : null;
    });

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const event = loadEvent();

    if (!event) return "editor";

    const initialState = createInitialState(event);
    return allGroupsPrepared(initialState.groups)
      ? "dashboard"
      : "editor";
  });

  const [message, setMessage] = useState("");
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newAge, setNewAge] = useState("");
  const [newGender, setNewGender] = useState<Gender | "">("");

  const firstInputRefs =
    useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (entryState) {
      localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entryState));
    }
  }, [entryState]);

  if (!trackEvent || !entryState || entryState.groups.length === 0) {
    return (
      <main className="marshal-page">
        <section className="marshal-shell marshal-empty">
          <h1>No Track Event Found</h1>
          <p>Create a Track Event before entering athletes.</p>

          <Link className="marshal-primary-link" to={AppRoute.TRACK}>
            Start Track Event
          </Link>
        </section>
      </main>
    );
  }

  const safeGroupIndex = Math.min(
    entryState.currentGroupIndex,
    entryState.groups.length - 1,
  );

  const currentEntry = entryState.groups[safeGroupIndex];
  const eventName = trackEvent.customEventName || trackEvent.eventName;
  const laneCount = trackEvent.laneCount ?? 10;
  const rowLabel = trackEvent.laneCount === null ? "Athlete" : "Lane";
  const currentLocked = groupIsLocked(currentEntry);

  function showTemporaryMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  }

  function syncMarshal2Queue(groups: GroupEntry[]) {
    localStorage.setItem(
      MARSHAL_2_QUEUE_KEY,
      JSON.stringify(
        groups.filter((groupEntry) => groupEntry.status === "sent"),
      ),
    );
  }

  function updateName(
    heatIndex: number,
    laneIndex: number,
    value: string,
  ) {
    if (currentLocked) return;

    setEntryState((current) => {
      if (!current) return current;

      const groups = current.groups.map((groupEntry, groupIndex) => {
        if (groupIndex !== current.currentGroupIndex) return groupEntry;

        const heats = groupEntry.heats.map((heat, currentHeatIndex) => {
          if (currentHeatIndex !== heatIndex) return heat;

          const names = [...heat.names];
          names[laneIndex] = value;

          return { ...heat, names };
        });

        return { ...groupEntry, heats };
      });

      return { ...current, groups };
    });
  }

  function handleNameChange(
    heatIndex: number,
    laneIndex: number,
    changeEvent: ChangeEvent<HTMLInputElement>,
  ) {
    updateName(heatIndex, laneIndex, changeEvent.target.value);
  }

  function handleNameBlur(
    heatIndex: number,
    laneIndex: number,
    value: string,
  ) {
    const formatted = titleCaseName(value.trim());

    if (formatted !== value) {
      updateName(heatIndex, laneIndex, formatted);
    }
  }

  function handleNameKeyDown(
    keyboardEvent: KeyboardEvent<HTMLInputElement>,
  ) {
    if (keyboardEvent.key !== "Enter") return;

    keyboardEvent.preventDefault();

    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "[data-athlete-entry='true']",
      ),
    );

    const currentIndex = fields.indexOf(keyboardEvent.currentTarget);
    fields[currentIndex + 1]?.focus();
  }

  function addHeat() {
    if (currentLocked) return;

    const newHeatId = makeId("heat");

    setEntryState((current) => {
      if (!current) return current;

      const groups = current.groups.map((groupEntry, groupIndex) =>
        groupIndex === current.currentGroupIndex
          ? {
              ...groupEntry,
              heats: [
                ...groupEntry.heats,
                {
                  id: newHeatId,
                  names: Array.from({ length: laneCount }, () => ""),
                },
              ],
            }
          : groupEntry,
      );

      return { ...current, groups };
    });

    window.setTimeout(() => {
      firstInputRefs.current[newHeatId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      firstInputRefs.current[newHeatId]?.focus();
    }, 80);
  }

  function openGroup(index: number) {
    const selected = entryState.groups[index];

    if (groupIsLocked(selected)) {
      showTemporaryMessage(
        `${getAgeLabel(selected.group.age)} ${getGenderLabel(
          selected.group.gender,
        )} is locked because it has already been confirmed or completed.`,
      );
      return;
    }

    setEntryState((current) =>
      current
        ? {
            ...current,
            currentGroupIndex: index,
          }
        : current,
    );

    setViewMode("editor");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function findNextDraftGroupIndex(
    groups: GroupEntry[],
    currentIndex: number,
  ) {
    for (let index = currentIndex + 1; index < groups.length; index += 1) {
      if (groups[index].status === "draft") return index;
    }

    for (let index = 0; index < currentIndex; index += 1) {
      if (groups[index].status === "draft") return index;
    }

    return -1;
  }

  function pushToMarshal2() {
    if (currentLocked) return;

    const hasAthletes = groupHasAthletes(currentEntry);

    const updatedGroups = entryState.groups.map((groupEntry, groupIndex) =>
      groupIndex === entryState.currentGroupIndex
        ? {
            ...groupEntry,
            status: hasAthletes ? ("sent" as const) : ("skipped" as const),
          }
        : groupEntry,
    );

    syncMarshal2Queue(updatedGroups);

    const nextIndex = findNextDraftGroupIndex(
      updatedGroups,
      entryState.currentGroupIndex,
    );

    if (nextIndex === -1) {
      setEntryState({
        eventCreatedAt: trackEvent.createdAt,
        currentGroupIndex: entryState.currentGroupIndex,
        groups: updatedGroups,
      });

      setViewMode("dashboard");
      setMessage(
        "All selected groups have been sent or marked with no athletes.",
      );

      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const nextGroup = updatedGroups[nextIndex].group;

    setEntryState({
      eventCreatedAt: trackEvent.createdAt,
      currentGroupIndex: nextIndex,
      groups: updatedGroups,
    });

    showTemporaryMessage(
      hasAthletes
        ? `${getAgeLabel(currentEntry.group.age)} ${getGenderLabel(
            currentEntry.group.gender,
          )} sent to Marshal 2. Opening ${getAgeLabel(
            nextGroup.age,
          )} ${getGenderLabel(nextGroup.gender)}.`
        : `No athletes entered. Opening ${getAgeLabel(
            nextGroup.age,
          )} ${getGenderLabel(nextGroup.gender)}.`,
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function combinationExists(age: string, gender: Gender) {
    return entryState.groups.some(
      (entry) =>
        entry.group.age === age &&
        entry.group.gender === gender,
    );
  }

  function addGroup() {
    if (!newAge || !newGender) return;

    if (combinationExists(newAge, newGender)) {
      showTemporaryMessage("That age and gender group already exists.");
      return;
    }

    const newEntry: GroupEntry = {
      group: {
        id: `${newAge}-${newGender}`,
        age: newAge,
        gender: newGender,
      },
      status: "draft",
      heats: [createBlankHeat(laneCount)],
    };

    const updatedGroups = sortGroupEntries(
      [...entryState.groups, newEntry],
      trackEvent,
    );

    const newIndex = updatedGroups.findIndex(
      (entry) => entry.group.id === newEntry.group.id,
    );

    const updatedEvent: TrackEventDraft = {
      ...trackEvent,
      ageGroups: trackEvent.ageGroups.includes(newAge)
        ? trackEvent.ageGroups
        : [...trackEvent.ageGroups, newAge],
      genders: trackEvent.genders.includes(newGender)
        ? trackEvent.genders
        : [...trackEvent.genders, newGender],
    };

    localStorage.setItem(
      EVENT_STORAGE_KEY,
      JSON.stringify(updatedEvent),
    );

    setTrackEvent(updatedEvent);
    setEntryState({
      ...entryState,
      currentGroupIndex: newIndex,
      groups: updatedGroups,
    });

    setNewAge("");
    setNewGender("");
    setAddGroupOpen(false);
    setViewMode("editor");

    showTemporaryMessage(
      `${getAgeLabel(newAge)} ${getGenderLabel(
        newGender,
      )} added to the event.`,
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderGroupList() {
    return (
      <div className="group-queue-list">
        {entryState.groups.map((groupEntry, index) => (
          <button
            key={groupEntry.group.id}
            className={`group-queue-row ${
              index === entryState.currentGroupIndex
                ? "group-queue-current"
                : ""
            }`}
            type="button"
            onClick={() => openGroup(index)}
          >
            <span className="group-queue-name">
              {getAgeLabel(groupEntry.group.age)}{" "}
              {getGenderLabel(groupEntry.group.gender)}
            </span>

            <span
              className={`group-status ${getStatusClass(groupEntry)}`}
            >
              {getDisplayStatus(groupEntry)}
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (viewMode === "dashboard") {
    return (
      <main className="marshal-page">
        <section className="marshal-shell marshal-dashboard">
          <div className="marshal-top-row">
            <Link className="back-link" to={AppRoute.TRACK_CONTROL}>
              ← Event Control
            </Link>

            <button
              className="add-group-button"
              type="button"
              onClick={() => setAddGroupOpen((open) => !open)}
            >
              + Add Group
            </button>
          </div>

          <header className="marshal-header">
            <h1>{eventName}</h1>
            <p>Marshal 1 Groups</p>
          </header>

          {message && (
            <div className="marshal-message" role="status">
              {message}
            </div>
          )}

          {addGroupOpen && (
            <section className="add-group-panel">
              <h2>Add Age/Gender Group</h2>

              <label className="add-group-field">
                <span>Age group</span>

                <select
                  value={newAge}
                  onChange={(event) => {
                    setNewAge(event.target.value);
                    setNewGender("");
                  }}
                >
                  <option value="">Select age</option>

                  {ALL_AGES.map((age) => (
                    <option key={age} value={age}>
                      {getAgeLabel(age)}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="add-group-genders">
                <legend>Gender</legend>

                {(["boys", "girls"] as Gender[]).map((gender) => {
                  const unavailable =
                    !newAge || combinationExists(newAge, gender);

                  return (
                    <label
                      key={gender}
                      className={`add-group-gender ${
                        newGender === gender
                          ? "add-group-gender-selected"
                          : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="new-group-gender"
                        checked={newGender === gender}
                        disabled={unavailable}
                        onChange={() => setNewGender(gender)}
                      />

                      <span>
                        {getGenderLabel(gender)}
                        {newAge &&
                        combinationExists(newAge, gender)
                          ? " — already added"
                          : ""}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="add-group-actions">
                <button
                  className="control-secondary-button"
                  type="button"
                  onClick={() => {
                    setAddGroupOpen(false);
                    setNewAge("");
                    setNewGender("");
                  }}
                >
                  Cancel
                </button>

                <button
                  className="control-primary-button"
                  type="button"
                  disabled={!newAge || !newGender}
                  onClick={addGroup}
                >
                  Add Group
                </button>
              </div>
            </section>
          )}

          <section className="group-queue group-queue-dashboard">
            <h2>Groups</h2>
            {renderGroupList()}
          </section>

          <p className="dashboard-note">
            Select an editable group to review or update its heats.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="marshal-page">
      <section className="marshal-shell">
        <div className="marshal-top-row">
          <Link className="back-link" to={AppRoute.TRACK_CONTROL}>
            ← Event Control
          </Link>

          <button
            className="groups-button"
            type="button"
            onClick={() => setViewMode("dashboard")}
          >
            Groups
          </button>
        </div>

        <header className="marshal-header">
          <h1>{eventName}</h1>

          <p>
            {getAgeLabel(currentEntry.group.age)}{" "}
            {getGenderLabel(currentEntry.group.gender)}
          </p>
        </header>

        {message && (
          <div className="marshal-message" role="status">
            {message}
          </div>
        )}

        {currentLocked && (
          <div className="marshal-lock-message">
            This group is locked and can no longer be edited by Marshal 1.
          </div>
        )}

        <div className="heat-list">
          {currentEntry.heats.map((heat, heatIndex) => (
            <section className="heat-card" key={heat.id}>
              <h2>Heat {heatIndex + 1}</h2>

              <div className="lane-list">
                {heat.names.map((name, laneIndex) => (
                  <label
                    className="lane-row"
                    key={`${heat.id}-${laneIndex}`}
                  >
                    <span className="lane-label">
                      {rowLabel} {laneIndex + 1}
                    </span>

                    <input
                      ref={(element) => {
                        if (laneIndex === 0) {
                          firstInputRefs.current[heat.id] = element;
                        }
                      }}
                      data-athlete-entry="true"
                      type="text"
                      value={name}
                      placeholder="Empty"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="words"
                      spellCheck={false}
                      enterKeyHint="next"
                      disabled={currentLocked}
                      onChange={(changeEvent) =>
                        handleNameChange(
                          heatIndex,
                          laneIndex,
                          changeEvent,
                        )
                      }
                      onBlur={(blurEvent) =>
                        handleNameBlur(
                          heatIndex,
                          laneIndex,
                          blurEvent.target.value,
                        )
                      }
                      onKeyDown={handleNameKeyDown}
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        {!currentLocked && (
          <button
            className="add-heat-button"
            type="button"
            onClick={addHeat}
          >
            + Add Heat
          </button>
        )}

        <div className="marshal-bottom-space" />
      </section>

      {!currentLocked && (
        <div className="marshal-action-bar">
          <button
            className="marshal-primary-button"
            type="button"
            onClick={pushToMarshal2}
          >
            {getPushButtonLabel(currentEntry)}
          </button>
        </div>
      )}
    </main>
  );
}
