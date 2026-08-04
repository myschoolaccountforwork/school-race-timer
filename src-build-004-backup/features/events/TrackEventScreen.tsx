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
  const [genderOrder, setGenderOrder] =
    useState<GenderOrder>("boys-first");
  const [ageOrder, setAgeOrder] = useState<AgeOrder>("oldest-first");

  const isNonLaned = NON_LANED_EVENTS.has(eventName);
  const needsCustomName = eventName === "Alternative Event";

  const isValid =
    eventName !== "" &&
    (!needsCustomName || customEventName.trim() !== "") &&
    (isNonLaned || laneCount !== null) &&
    ageGroups.length > 0 &&
    genders.length > 0;

  function toggleAge(value: string) {
    setAgeGroups((current) =>
      current.includes(value)
        ? current.filter((age) => age !== value)
        : [...current, value],
    );
  }

  function toggleGender(value: Gender) {
    setGenders((current) =>
      current.includes(value)
        ? current.filter((gender) => gender !== value)
        : [...current, value],
    );
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

    const draft: TrackEventDraft = {
      eventName,
      customEventName: needsCustomName ? customEventName.trim() : undefined,
      laneCount: isNonLaned ? null : laneCount,
      ageGroups,
      genders,
      genderOrder,
      ageOrder,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem("raceflow.trackEventDraft", JSON.stringify(draft));
    navigate(AppRoute.TRACK_CREATED);
  }

  return (
    <main className="event-page">
      <form className="event-card" onSubmit={handleSubmit}>
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
            onChange={(event) => handleEventChange(event.target.value)}
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
              <label className="field-label" htmlFor="custom-event-name">
                Alternative event name
              </label>
              <input
                id="custom-event-name"
                type="text"
                value={customEventName}
                onChange={(event) => setCustomEventName(event.target.value)}
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
                    laneCount === count ? "choice-tile-selected" : ""
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
              onClick={() =>
                setAgeGroups(
                  ageGroups.length === ageOptions.length
                    ? []
                    : ageOptions.map((option) => option.value),
                )
              }
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

        <section className="form-section">
          <h2>Gender</h2>
          <div className="choice-grid two-column">
            {(["boys", "girls"] as Gender[]).map((gender) => (
              <label
                key={gender}
                className={`choice-tile ${
                  genders.includes(gender) ? "choice-tile-selected" : ""
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

        <section className="form-section">
          <h2>Running order</h2>

          <fieldset>
            <legend>Gender order</legend>
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
          </fieldset>

          <fieldset>
            <legend>Age order</legend>
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
          </fieldset>
        </section>

        <div className="sticky-action">
          <button className="primary-action" type="submit" disabled={!isValid}>
            Create Track Event
          </button>
        </div>
      </form>
    </main>
  );
}
