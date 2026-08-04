import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import type {
  AgeOrder,
  Gender,
  GenderOrder,
  TrackEventDraft,
} from "../../types/events";
import "./TrackEventScreen.css";

const TRACK_EVENTS = [
  "100 metres",
  "200 metres",
  "400 metres",
  "800 metres",
  "1500 metres",
  "Relay",
  "Alternative Event",
];

const LANE_OPTIONS = [4, 5, 6, 7, 8, 9];
const NON_LANED_EVENTS = new Set(["800 metres", "1500 metres"]);

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const ENTRY_STORAGE_KEY = "raceflow.marshal1Entry";
const MARSHAL_2_QUEUE_KEY = "raceflow.marshal2Queue";

function getAgeOptions() {
  const currentYear = new Date().getFullYear();

  const numberedAges = Array.from({ length: 14 }, (_, index) => {
    const age = index + 6;

    return {
      value: String(age),
      label: `${age} Years (Born ${currentYear - age})`,
    };
  });

  return [...numberedAges, { value: "open", label: "Open" }];
}

export default function TrackEventScreen() {
  const navigate = useNavigate();
  const ageOptions = useMemo(getAgeOptions, []);

  const [eventName, setEventName] = useState("");
  const [customEventName, setCustomEventName] = useState("");
  const [laneCount, setLaneCount] = useState<number | null>(null);
  const [ageGroups, setAgeGroups] = useState<string[]>([]);
  const [genders, setGenders] = useState<Gender[]>([]);
  const [genderOrder, setGenderOrder] = useState<GenderOrder | null>(null);
  const [ageOrder, setAgeOrder] = useState<AgeOrder | null>(null);

  const isNonLaned = NON_LANED_EVENTS.has(eventName);
  const needsCustomName = eventName === "Alternative Event";

  const needsGenderOrder = genders.length > 1;
  const needsAgeOrder = ageGroups.length > 1;

  const isValid =
    eventName !== "" &&
    (!needsCustomName || customEventName.trim() !== "") &&
    (isNonLaned || laneCount !== null) &&
    ageGroups.length > 0 &&
    genders.length > 0 &&
    (!needsGenderOrder || genderOrder !== null) &&
    (!needsAgeOrder || ageOrder !== null);

  function toggleAge(value: string) {
    setAgeGroups((current) => {
      const updated = current.includes(value)
        ? current.filter((age) => age !== value)
        : [...current, value];

      if (updated.length <= 1) {
        setAgeOrder(null);
      }

      return updated;
    });
  }

  function toggleGender(value: Gender) {
    setGenders((current) => {
      const updated = current.includes(value)
        ? current.filter((gender) => gender !== value)
        : [...current, value];

      if (updated.length <= 1) {
        setGenderOrder(null);
      }

      return updated;
    });
  }

  function selectOrClearAllAges() {
    if (ageGroups.length === ageOptions.length) {
      setAgeGroups([]);
      setAgeOrder(null);
      return;
    }

    setAgeGroups(ageOptions.map((option) => option.value));
    setAgeOrder(null);
  }

  function handleEventChange(value: string) {
    setEventName(value);

    if (NON_LANED_EVENTS.has(value)) {
      setLaneCount(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValid) return;

    const resolvedGenderOrder: GenderOrder =
      genders.length === 1
        ? genders[0] === "boys"
          ? "boys-first"
          : "girls-first"
        : genderOrder!;

    const resolvedAgeOrder: AgeOrder =
      ageGroups.length === 1 ? "youngest-first" : ageOrder!;

    const draft: TrackEventDraft = {
      eventName,
      customEventName: needsCustomName
        ? customEventName.trim()
        : undefined,
      laneCount: isNonLaned ? null : laneCount,
      ageGroups,
      genders,
      genderOrder: resolvedGenderOrder,
      ageOrder: resolvedAgeOrder,
      createdAt: new Date().toISOString(),
    };

    localStorage.removeItem(ENTRY_STORAGE_KEY);
    localStorage.removeItem(MARSHAL_2_QUEUE_KEY);
    localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify(draft));

    navigate(AppRoute.TRACK_CONTROL);
  }

  return (
    <main className="event-page">
      <form
        className="event-card"
        onSubmit={handleSubmit}
        autoComplete="off"
      >
        <Link className="back-link" to={AppRoute.HOME}>
          ← Back
        </Link>

        <header className="event-header">
          <h1>Start Track Event</h1>
          <p>Create the event workflow in under one minute.</p>
        </header>

        <section className="form-section">
          <label className="field-label" htmlFor="event-name">
            Event
          </label>

          <select
            id="event-name"
            value={eventName}
            onChange={(changeEvent) =>
              handleEventChange(changeEvent.target.value)
            }
          >
            <option value="">Select event</option>

            {TRACK_EVENTS.map((trackEvent) => (
              <option key={trackEvent} value={trackEvent}>
                {trackEvent}
              </option>
            ))}
          </select>

          {needsCustomName && (
            <div className="nested-field">
              <label
                className="field-label"
                htmlFor="custom-event-name"
              >
                Alternative event name
              </label>

              <input
                id="custom-event-name"
                type="text"
                value={customEventName}
                onChange={(changeEvent) =>
                  setCustomEventName(changeEvent.target.value)
                }
                placeholder="e.g. 80 metres or Staff Race"
                autoComplete="off"
              />
            </div>
          )}
        </section>

        {!isNonLaned && (
          <section className="form-section">
            <h2>Number of lanes</h2>

            <div className="choice-grid lane-grid">
              {LANE_OPTIONS.map((count) => (
                <label
                  key={count}
                  className={`choice-tile ${
                    laneCount === count
                      ? "choice-tile-selected"
                      : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="lane-count"
                    value={count}
                    checked={laneCount === count}
                    onChange={() => setLaneCount(count)}
                  />

                  <span>{count}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {isNonLaned && (
          <div className="info-box">
            This event uses the non-laned workflow, so lane selection is not
            required.
          </div>
        )}

        <section className="form-section">
          <div className="section-heading-row">
            <h2>Age groups</h2>

            <button
              className="text-button"
              type="button"
              onClick={selectOrClearAllAges}
            >
              {ageGroups.length === ageOptions.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>

          <div className="age-list">
            {ageOptions.map((option) => (
              <label key={option.value} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={ageGroups.includes(option.value)}
                  onChange={() => toggleAge(option.value)}
                />

                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>

        {needsAgeOrder && (
          <section className="form-section">
            <h2>Age order</h2>

            <label className="radio-row">
              <input
                type="radio"
                name="age-order"
                checked={ageOrder === "youngest-first"}
                onChange={() => setAgeOrder("youngest-first")}
              />

              Youngest to Oldest
            </label>

            <label className="radio-row">
              <input
                type="radio"
                name="age-order"
                checked={ageOrder === "oldest-first"}
                onChange={() => setAgeOrder("oldest-first")}
              />

              Oldest to Youngest
            </label>
          </section>
        )}

        <section className="form-section">
          <h2>Gender</h2>

          <div className="choice-grid two-column">
            {(["boys", "girls"] as Gender[]).map((gender) => (
              <label
                key={gender}
                className={`choice-tile ${
                  genders.includes(gender)
                    ? "choice-tile-selected"
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={genders.includes(gender)}
                  onChange={() => toggleGender(gender)}
                />

                <span>{gender === "boys" ? "Boys" : "Girls"}</span>
              </label>
            ))}
          </div>
        </section>

        {needsGenderOrder && (
          <section className="form-section">
            <h2>Gender order</h2>

            <label className="radio-row">
              <input
                type="radio"
                name="gender-order"
                checked={genderOrder === "boys-first"}
                onChange={() => setGenderOrder("boys-first")}
              />

              Boys then Girls
            </label>

            <label className="radio-row">
              <input
                type="radio"
                name="gender-order"
                checked={genderOrder === "girls-first"}
                onChange={() => setGenderOrder("girls-first")}
              />

              Girls then Boys
            </label>
          </section>
        )}

        <div className="sticky-action">
          <button
            className="primary-action"
            type="submit"
            disabled={!isValid}
          >
            Create Track Event
          </button>
        </div>
      </form>
    </main>
  );
}
