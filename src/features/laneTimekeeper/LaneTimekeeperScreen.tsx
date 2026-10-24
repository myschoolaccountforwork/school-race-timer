import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import LiveSessionStatus from "../../components/LiveSessionStatus";
import {
  CURRENT_RACE_KEY,
  LANE_RESULTS_KEY,
  RACE_CONTROL_KEY,
  emptyResultStore,
  readStorage,
} from "../timing/timingStorage";
import type {
  LaneResult,
  LaneResultStore,
  QueuedRace,
  RaceControl,
} from "../timing/timingStorage";
import "./LaneTimekeeperScreen.css";

function getAssignedLane() {
  const lane = Number(new URLSearchParams(window.location.search).get("lane"));
  return Number.isInteger(lane) && lane > 0 ? lane : 1;
}

function getInitialElapsed() {
  const control = readStorage<RaceControl>(RACE_CONTROL_KEY);
  if (!control?.startedAt) return 0;
  const end =
    control.status === "stopped"
      ? control.stoppedAt ?? Date.now()
      : Date.now();
  return Math.max(0, end - control.startedAt);
}

export default function LaneTimekeeperScreen() {
  const assignedLane = useMemo(() => getAssignedLane(), []);
  const [currentRace, setCurrentRace] = useState<QueuedRace | null>(() =>
    readStorage<QueuedRace>(CURRENT_RACE_KEY),
  );
  const [control, setControl] = useState<RaceControl | null>(() =>
    readStorage<RaceControl>(RACE_CONTROL_KEY),
  );
  const [resultStore, setResultStore] = useState<LaneResultStore | null>(() =>
    readStorage<LaneResultStore>(LANE_RESULTS_KEY),
  );
  const [elapsedMilliseconds, setElapsedMilliseconds] =
    useState(getInitialElapsed);
  const animationFrame = useRef(0);

  const raceIsCurrent =
    Boolean(currentRace) && control?.raceId === currentRace?.heat.id;
  const raceIsRunning =
    raceIsCurrent &&
    control?.status === "running" &&
    control.startedAt !== null;
  const submittedResult =
    currentRace && resultStore?.raceId === currentRace.heat.id
      ? resultStore.results[String(assignedLane)]
      : undefined;
  const timerShouldRun =
    raceIsRunning &&
    submittedResult?.finishMilliseconds === undefined &&
    submittedResult?.status !== "DNS" &&
    submittedResult?.status !== "DNF";
  const athleteName =
    currentRace?.heat.names[assignedLane - 1]?.trim() || "Unassigned";

  useEffect(() => {
    if (!timerShouldRun || !control?.startedAt) return;

    const startedAt = control.startedAt;
    function updateTimer() {
      setElapsedMilliseconds(Date.now() - startedAt);
      animationFrame.current = window.requestAnimationFrame(updateTimer);
    }

    animationFrame.current = window.requestAnimationFrame(updateTimer);
    return () => window.cancelAnimationFrame(animationFrame.current);
  }, [
    control,
    raceIsCurrent,
    timerShouldRun,
    submittedResult,
  ]);

  useEffect(() => {
    function handleStorage(storageEvent: StorageEvent) {
      if (storageEvent.key === CURRENT_RACE_KEY) {
        setCurrentRace(readStorage<QueuedRace>(CURRENT_RACE_KEY));
        setElapsedMilliseconds(0);
      }
      if (storageEvent.key === RACE_CONTROL_KEY) {
        const nextControl = readStorage<RaceControl>(RACE_CONTROL_KEY);
        setControl(nextControl);
        if (nextControl?.status === "waiting") {
          setElapsedMilliseconds(0);
        } else if (
          nextControl?.status === "stopped" &&
          nextControl.startedAt &&
          nextControl.stoppedAt
        ) {
          setElapsedMilliseconds(
            nextControl.stoppedAt - nextControl.startedAt,
          );
        }
      }
      if (storageEvent.key === LANE_RESULTS_KEY) {
        const nextStore =
          readStorage<LaneResultStore>(LANE_RESULTS_KEY);
        setResultStore(nextStore);
        const nextResult =
          nextStore?.results[String(assignedLane)];
        if (nextResult?.finishMilliseconds !== undefined) {
          setElapsedMilliseconds(nextResult.finishMilliseconds);
        }
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [assignedLane]);

  function submitResult(action: "finish" | "DNS" | "DNF" | "DQ") {
    if (
      !currentRace ||
      !raceIsRunning ||
      !control?.startedAt
    ) {
      return;
    }

    const latestStore =
      readStorage<LaneResultStore>(LANE_RESULTS_KEY) ??
      emptyResultStore(currentRace.heat.id);
    if (
      latestStore.raceId !== currentRace.heat.id
    ) {
      return;
    }

    const submittedAt = Date.now();
    const existing = latestStore.results[String(assignedLane)];
    let result: LaneResult;

    if (action === "finish") {
      if (
        existing?.finishMilliseconds !== undefined ||
        existing?.status === "DNS" ||
        existing?.status === "DNF"
      ) {
        return;
      }
      result = {
        ...existing,
        lane: assignedLane,
        finishMilliseconds: submittedAt - control.startedAt,
        submittedAt,
      };
    } else if (action === "DNS" || action === "DNF") {
      if (existing?.status === action) return;
      result = {
        lane: assignedLane,
        status: action,
        submittedAt,
      };
    } else {
      if (existing?.status === "DQ") return;
      result = {
        ...existing,
        lane: assignedLane,
        status: "DQ",
        submittedAt,
      };
    }
    const updatedStore: LaneResultStore = {
      raceId: currentRace.heat.id,
      results: {
        ...latestStore.results,
        [String(assignedLane)]: result,
      },
    };

    localStorage.setItem(LANE_RESULTS_KEY, JSON.stringify(updatedStore));
    setResultStore(updatedStore);
    if (result.finishMilliseconds !== undefined) {
      setElapsedMilliseconds(result.finishMilliseconds);
    }
  }

  const statusText = submittedResult
    ? submittedResult.status === "DNS" ||
      submittedResult.status === "DNF"
      ? submittedResult.status
      : submittedResult.finishMilliseconds !== undefined
        ? `Finished in ${(submittedResult.finishMilliseconds / 1000).toFixed(
            3,
          )}${submittedResult.status === "DQ" ? " • DQ" : ""}`
        : submittedResult.status ?? "Race Running"
    : raceIsRunning
      ? "Race Running"
      : "Waiting for Start";

  return (
    <main className="lane-page">
      <section className="lane-shell">
        <LiveSessionStatus />
        <Link className="back-link" to={AppRoute.HOME}>
          ← Home
        </Link>

        <header className="lane-header">
          <p>Lane Timekeeper</p>
          <h1>Assigned Lane {assignedLane}</h1>
        </header>

        <section className="lane-race-card">
          <h2>Current Race</h2>
          {!currentRace ? (
            <p className="lane-waiting">Waiting for a race to open.</p>
          ) : (
            <>
              <div className="lane-assignment">
                <span>Lane {assignedLane}</span>
                <strong>{athleteName}</strong>
              </div>
              <div
                className="lane-timer"
                role="timer"
                aria-label={`${(elapsedMilliseconds / 1000).toFixed(3)} seconds`}
              >
                {(elapsedMilliseconds / 1000).toFixed(3)}
              </div>
              <p className="lane-status" role="status">
                {statusText}
              </p>

              <button
                className="lane-finish-button"
                type="button"
                disabled={
                  !raceIsRunning ||
                  submittedResult?.finishMilliseconds !== undefined ||
                  submittedResult?.status === "DNS" ||
                  submittedResult?.status === "DNF"
                }
                onClick={() => submitResult("finish")}
              >
                Finish
              </button>
              <div className="lane-status-actions">
                <button
                  type="button"
                  disabled={
                    !raceIsRunning ||
                    submittedResult?.finishMilliseconds !== undefined ||
                    submittedResult?.status === "DQ" ||
                    submittedResult?.status === "DNS" ||
                    submittedResult?.status === "DNF"
                  }
                  onClick={() => submitResult("DQ")}
                >
                  DQ
                </button>
                <button
                  type="button"
                  disabled={
                    !raceIsRunning ||
                    submittedResult?.finishMilliseconds !== undefined ||
                    submittedResult?.status === "DNS" ||
                    submittedResult?.status === "DNF" ||
                    submittedResult?.status === "DQ"
                  }
                  onClick={() => submitResult("DNS")}
                >
                  DNS
                </button>
                <button
                  type="button"
                  disabled={
                    !raceIsRunning ||
                    submittedResult?.finishMilliseconds !== undefined ||
                    submittedResult?.status === "DNS" ||
                    submittedResult?.status === "DNF" ||
                    submittedResult?.status === "DQ"
                  }
                  onClick={() => submitResult("DNF")}
                >
                  DNF
                </button>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
