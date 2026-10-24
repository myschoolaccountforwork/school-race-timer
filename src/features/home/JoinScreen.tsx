import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import type { TrackEventDraft } from "../../types/events";
import {
  getDeviceId,
  saveSessionRole,
} from "../live/liveSession";
import { readStorage } from "../timing/timingStorage";
import "./JoinScreen.css";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const LANE_ASSIGNMENTS_KEY = "raceflow.laneAssignments";

type Role = "chief-marshal" | "line-marshal" | "starter" | "lane";
type LaneAssignments = Record<string, string>;

export default function JoinScreen() {
  const navigate = useNavigate();
  const event = useMemo(
    () => readStorage<TrackEventDraft>(EVENT_STORAGE_KEY),
    [],
  );
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [assignments, setAssignments] = useState<LaneAssignments>(
    () => readStorage<LaneAssignments>(LANE_ASSIGNMENTS_KEY) ?? {},
  );

  useEffect(() => {
    function handleStorage(storageEvent: StorageEvent) {
      if (storageEvent.key === LANE_ASSIGNMENTS_KEY) {
        setAssignments(
          readStorage<LaneAssignments>(LANE_ASSIGNMENTS_KEY) ?? {},
        );
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  function joinRole(role: Exclude<Role, "lane">) {
    saveSessionRole(role);
    if (role === "chief-marshal") navigate(AppRoute.TRACK_ENTRY);
    if (role === "line-marshal") navigate(AppRoute.MARSHAL_2);
    if (role === "starter") navigate(AppRoute.STARTER);
  }

  function joinLane(lane: number) {
    if (assignments[String(lane)]) return;
    const updated = {
      ...assignments,
      [String(lane)]: getDeviceId(),
    };
    localStorage.setItem(LANE_ASSIGNMENTS_KEY, JSON.stringify(updated));
    saveSessionRole("lane-timekeeper", lane);
    navigate(`${AppRoute.LANE_TIMEKEEPER}?lane=${lane}`);
  }

  const laneCount = event?.laneCount ?? 0;

  return (
    <main className="join-page">
      <section className="join-card">
        <Link className="back-link" to={AppRoute.HOME}>
          ← Back
        </Link>
        <h1>Choose Role</h1>
        <p>{event?.customEventName || event?.eventName || "RaceFlow Event"}</p>

        {!selectedRole ? (
          <div className="join-role-list">
            <button type="button" onClick={() => joinRole("chief-marshal")}>
              Chief Marshal
            </button>
            <button type="button" onClick={() => joinRole("line-marshal")}>
              Line Marshal
            </button>
            <button type="button" onClick={() => joinRole("starter")}>
              Starter
            </button>
            <button type="button" onClick={() => setSelectedRole("lane")}>
              Lane Timekeeper
            </button>
          </div>
        ) : (
          <>
            <h2>Select lane</h2>
            <div className="join-lanes">
              {Array.from({ length: laneCount }, (_, index) => index + 1).map(
                (lane) => {
                  const occupied = Boolean(assignments[String(lane)]);
                  return (
                    <button
                      type="button"
                      disabled={occupied}
                      key={lane}
                      onClick={() => joinLane(lane)}
                    >
                      <strong>Lane {lane}</strong>
                      <span>{occupied ? "Occupied" : "Available"}</span>
                    </button>
                  );
                },
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
