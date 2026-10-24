import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { AppRoute } from "../../types/routes";
import type { TrackEventDraft } from "../../types/events";
import "./TrackEventControlCentre.css";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const ENTRY_STORAGE_KEY = "raceflow.marshal1Entry";
const MARSHAL_2_QUEUE_KEY = "raceflow.marshal2Queue";
const CHIEF_TIMEKEEPER_QUEUE_KEY = "raceflow.chiefTimekeeperQueue";
const CHIEF_TIMEKEEPER_CURRENT_RACE_KEY =
  "raceflow.chiefTimekeeperCurrentRace";
const RACE_CONTROL_KEY = "raceflow.currentRaceControl";
const LANE_RESULTS_KEY = "raceflow.laneResults";
const CHIEF_OVERRIDES_KEY = "raceflow.chiefResultOverrides";
const EXPORTED_HEATS_KEY = "raceflow.chiefTimekeeperExportedHeats";
const COMPLETED_HEATS_KEY = "raceflow.chiefTimekeeperCompletedHeats";
const STARTER_STATUS_KEY = "raceflow.starterStatuses";
const CHIEF_RACE_CONFIRMATIONS_KEY = "raceflow.chiefRaceConfirmations";

function loadDraft(): TrackEventDraft | null {
  const raw = localStorage.getItem(EVENT_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TrackEventDraft;
  } catch {
    return null;
  }
}

function getAgeLabel(value: string) {
  if (value === "open") return "Open";

  const age = Number(value);
  return `${age} Years`;
}

export default function TrackEventControlCentre() {
  const navigate = useNavigate();
  const [qrOpen, setQrOpen] = useState(false);
  const draft = useMemo(() => loadDraft(), []);

  if (!draft) {
    return (
      <main className="control-page">
        <section className="control-card empty-control">
          <h1>No Track Event Found</h1>
          <p>Create a Track Event first.</p>

          <Link className="control-primary-link" to={AppRoute.TRACK}>
            Start Track Event
          </Link>
        </section>
      </main>
    );
  }

  const displayName = draft.customEventName || draft.eventName;

  const genderText = draft.genders
    .map((gender) => (gender === "boys" ? "Boys" : "Girls"))
    .join(" & ");

  const ageText = draft.ageGroups
    .map(getAgeLabel)
    .join(", ");

  const joinUrl =
    `${window.location.origin}${AppRoute.JOIN}?session=${encodeURIComponent(
      draft.sessionId ?? localStorage.getItem("raceflow.sessionId") ?? "",
    )}`;

  function cancelEvent() {
    const confirmed = window.confirm(
      "Cancel this event and delete all locally stored setup and athlete-entry data?",
    );

    if (!confirmed) return;

    localStorage.removeItem(EVENT_STORAGE_KEY);
    localStorage.removeItem(ENTRY_STORAGE_KEY);
    localStorage.removeItem(MARSHAL_2_QUEUE_KEY);
    localStorage.removeItem(CHIEF_TIMEKEEPER_QUEUE_KEY);
    localStorage.removeItem(CHIEF_TIMEKEEPER_CURRENT_RACE_KEY);
    localStorage.removeItem(RACE_CONTROL_KEY);
    localStorage.removeItem(LANE_RESULTS_KEY);
    localStorage.removeItem(CHIEF_OVERRIDES_KEY);
    localStorage.removeItem(EXPORTED_HEATS_KEY);
    localStorage.removeItem(COMPLETED_HEATS_KEY);
    localStorage.removeItem(STARTER_STATUS_KEY);
    localStorage.removeItem(CHIEF_RACE_CONFIRMATIONS_KEY);

    navigate(AppRoute.HOME);
  }

  return (
    <main className="control-page">
      <section className="control-card">
        <div className="control-top-row">
          <Link className="back-link" to={AppRoute.HOME}>
            ← Home
          </Link>

          <button
            className="qr-button"
            type="button"
            aria-label={qrOpen ? "Close event QR code" : "Show event QR code"}
            aria-expanded={qrOpen}
            onClick={() => setQrOpen((open) => !open)}
          >
            QR
          </button>
        </div>

        <header className="control-header">
          <p className="eyebrow">Track Event Control Centre</p>
          <h1>{displayName}</h1>
          <p>{genderText}</p>
        </header>

        <section className="summary-card">
          <h2>Event Summary</h2>

          <dl className="summary-list">
            <div>
              <dt>Event</dt>
              <dd>{displayName}</dd>
            </div>

            <div>
              <dt>Lanes</dt>
              <dd>{draft.laneCount ?? "Non-laned"}</dd>
            </div>

            <div>
              <dt>Age groups</dt>
              <dd>{ageText}</dd>
            </div>

            <div>
              <dt>Gender</dt>
              <dd>{genderText}</dd>
            </div>

            {draft.ageGroups.length > 1 && (
              <div>
                <dt>Age order</dt>
                <dd>
                  {draft.ageOrder === "oldest-first"
                    ? "Oldest to Youngest"
                    : "Youngest to Oldest"}
                </dd>
              </div>
            )}

            {draft.genders.length > 1 && (
              <div>
                <dt>Gender order</dt>
                <dd>
                  {draft.genderOrder === "boys-first"
                    ? "Boys then Girls"
                    : "Girls then Boys"}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="connections-card">
          <div className="section-title-row">
            <h2>Connections</h2>
            <span className="status-badge status-waiting">Waiting</span>
          </div>

          <div className="connection-row">
            <span>Line Marshal</span>
            <span className="status-text">Local test available</span>
          </div>

          <div className="connection-row">
            <span>Chief Timekeeper</span>
            <span className="status-text">Not connected</span>
          </div>

          <div className="connection-row">
            <span>Lane Timekeepers</span>
            <span className="status-text">
              0 of {draft.laneCount ?? "required"}
            </span>
          </div>
        </section>

        <div className="control-actions">
          <button
            className="control-primary-button"
            type="button"
            onClick={() => navigate(AppRoute.TRACK_ENTRY)}
          >
            Begin Event Setup
          </button>

          <button
            className="control-secondary-button"
            type="button"
            onClick={() => navigate(AppRoute.MARSHAL_2)}
          >
            Open Line Marshal
          </button>

          <button
            className="control-secondary-button"
            type="button"
            onClick={() => navigate(AppRoute.TRACK)}
          >
            Edit Event Settings
          </button>

          <button
            className="control-danger-button"
            type="button"
            onClick={cancelEvent}
          >
            Cancel Event
          </button>
        </div>
      </section>

      {qrOpen && (
        <div
          className="qr-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Event QR code"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="qr-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="qr-close"
              type="button"
              aria-label="Close QR code"
              onClick={() => setQrOpen(false)}
            >
              ×
            </button>

            <QRCodeSVG
              value={joinUrl}
              size={260}
              level="M"
              includeMargin
            />

            <h2>Scan to Join Event</h2>
            <p>Select your role after scanning.</p>
          </div>
        </div>
      )}
    </main>
  );
}
