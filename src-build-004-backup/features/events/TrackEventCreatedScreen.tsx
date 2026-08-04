import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import type { TrackEventDraft } from "../../types/events";
import "./TrackEventCreatedScreen.css";

function loadDraft(): TrackEventDraft | null {
  const raw = localStorage.getItem("raceflow.trackEventDraft");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TrackEventDraft;
  } catch {
    return null;
  }
}

export default function TrackEventCreatedScreen() {
  const draft = loadDraft();

  if (!draft) {
    return (
      <main className="created-page">
        <section className="created-card">
          <h1>No Track Event Found</h1>
          <p>Create a Track Event first.</p>
          <Link className="primary-link" to={AppRoute.TRACK}>
            Start Track Event
          </Link>
        </section>
      </main>
    );
  }

  const displayName = draft.customEventName || draft.eventName;

  return (
    <main className="created-page">
      <section className="created-card">
        <div className="success-mark" aria-hidden="true">✓</div>
        <h1>{displayName} Event Created</h1>

        <dl>
          <div>
            <dt>Lanes</dt>
            <dd>{draft.laneCount ?? "Non-laned"}</dd>
          </div>
          <div>
            <dt>Age groups</dt>
            <dd>{draft.ageGroups.length}</dd>
          </div>
          <div>
            <dt>Gender</dt>
            <dd>
              {draft.genders
                .map((gender) => (gender === "boys" ? "Boys" : "Girls"))
                .join(" & ")}
            </dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd>
              {draft.ageOrder === "oldest-first"
                ? "Oldest to Youngest"
                : "Youngest to Oldest"}
            </dd>
          </div>
        </dl>

        <p className="next-note">
          The Event Control Centre will be added in the next build.
        </p>

        <div className="created-actions">
          <Link className="primary-link" to={AppRoute.TRACK}>
            Edit Event
          </Link>
          <Link className="secondary-link" to={AppRoute.HOME}>
            Return Home
          </Link>
        </div>
      </section>
    </main>
  );
}
