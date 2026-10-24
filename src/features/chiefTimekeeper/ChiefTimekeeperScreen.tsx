import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { QRCodeSVG } from "qrcode.react";
import { AppRoute } from "../../types/routes";
import LiveSessionStatus from "../../components/LiveSessionStatus";
import type { Gender, TrackEventDraft } from "../../types/events";
import {
  CHIEF_OVERRIDES_KEY,
  CHIEF_QUEUE_KEY,
  CHIEF_RACE_CONFIRMATIONS_KEY,
  CURRENT_RACE_KEY,
  LANE_RESULTS_KEY,
  RACE_CONTROL_KEY,
  STARTER_STATUS_KEY,
  emptyResultStore,
  readStorage,
  writeRaceControl,
} from "../timing/timingStorage";
import type {
  ChiefOverrideStore,
  ChiefResultOverride,
  LaneResult,
  LaneResultStore,
  QueuedRace,
  RaceControl,
  StarterStatusStore,
} from "../timing/timingStorage";
import "./ChiefTimekeeperScreen.css";

type TimerState = "idle" | "running" | "stopped";

const EVENT_STORAGE_KEY = "raceflow.trackEventDraft";
const EXPORTED_HEATS_KEY = "raceflow.chiefTimekeeperExportedHeats";
const COMPLETED_HEATS_KEY = "raceflow.chiefTimekeeperCompletedHeats";

interface ExportRow {
  place: string;
  lane: number;
  athlete: string;
  time: string;
  status: "" | "DQ" | "DNS" | "DNF";
}

interface CompletedHeat {
  race: QueuedRace;
  rows: ExportRow[];
}

type ExportFormat = "pdf" | "xlsx" | "csv";
type ExportDestination = "email" | "teams" | "download";

function loadQueue() {
  const queue = readStorage<unknown>(CHIEF_QUEUE_KEY);
  return Array.isArray(queue) ? (queue as QueuedRace[]) : [];
}

function loadStarterStatuses(): StarterStatusStore {
  return (
    readStorage<StarterStatusStore>(STARTER_STATUS_KEY) ?? {
      statuses: {},
    }
  );
}

function loadChiefConfirmations() {
  return (
    readStorage<Record<string, boolean>>(
      CHIEF_RACE_CONFIRMATIONS_KEY,
    ) ?? {}
  );
}

function loadCompletedHeats() {
  const heats = readStorage<unknown>(COMPLETED_HEATS_KEY);
  return Array.isArray(heats) ? (heats as CompletedHeat[]) : [];
}

function getAgeLabel(age: string) {
  return age === "open" ? "Open" : `${age} Years`;
}

function getGenderLabel(gender: Gender) {
  return gender === "boys" ? "Boys" : "Girls";
}

function getRaceLabel(race: QueuedRace) {
  return `${getAgeLabel(race.group.age)} ${getGenderLabel(
    race.group.gender,
  )} — Heat ${race.heatNumber}`;
}

function getCompactEventLabel(value: string) {
  return value.replace(/^(\d+)\s+metres$/i, "$1m");
}

function getStoredResults(raceId: string) {
  const store = readStorage<LaneResultStore>(LANE_RESULTS_KEY);
  return store?.raceId === raceId ? store.results : {};
}

function formatRaceTime(milliseconds: number) {
  if (milliseconds < 60000) {
    return (milliseconds / 1000).toFixed(3);
  }

  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

function parseRaceTime(value: string) {
  const parts = value.trim().split(":");
  if (
    parts.length === 0 ||
    parts.length > 3 ||
    parts.some((part) => part.trim() === "" || !/^\d+(\.\d+)?$/.test(part)) ||
    parts.slice(0, -1).some((part) => !/^\d+$/.test(part))
  ) {
    return null;
  }

  const numbers = parts.map(Number);
  if (
    numbers.some((part) => !Number.isFinite(part) || part < 0) ||
    (parts.length > 1 && numbers.at(-1)! >= 60) ||
    (parts.length === 3 && numbers[1] >= 60)
  ) {
    return null;
  }

  const seconds = numbers.reduce(
    (total, part) => total * 60 + part,
    0,
  );
  return seconds * 1000;
}

function formatResult(result: LaneResult) {
  if (result.status === "DNS") return "DNS";

  const finish =
    result.finishMilliseconds === undefined
      ? ""
      : formatRaceTime(result.finishMilliseconds);
  if (finish && result.status === "DQ") return `${finish} • DQ`;
  return finish || result.status || "Running";
}

function formatEffectiveResult(
  result: LaneResult | ChiefResultOverride | undefined,
) {
  if (!result) return "";
  if (result.status === "DNS" || result.status === "DNF") {
    return result.status;
  }

  const milliseconds = result.finishMilliseconds;
  const finish =
    milliseconds === undefined || milliseconds === null
      ? ""
      : formatRaceTime(milliseconds);
  if (finish && result.status === "DQ") return `${finish} • DQ`;
  return finish || result.status || "";
}

function getStoredOverrides(raceId: string) {
  const store = readStorage<ChiefOverrideStore>(CHIEF_OVERRIDES_KEY);
  return store?.raceId === raceId ? store.overrides : {};
}

function loadExportedRaces() {
  const races = readStorage<unknown>(EXPORTED_HEATS_KEY);
  return Array.isArray(races)
    ? (races.filter(
        (race) => typeof race === "object" && race !== null,
      ) as QueuedRace[])
    : [];
}

export default function ChiefTimekeeperScreen() {
  const event = useMemo(
    () => readStorage<TrackEventDraft>(EVENT_STORAGE_KEY),
    [],
  );
  const initialRace = useMemo(
    () => readStorage<QueuedRace>(CURRENT_RACE_KEY),
    [],
  );
  const initialControl = useMemo(
    () => readStorage<RaceControl>(RACE_CONTROL_KEY),
    [],
  );
  const [queue, setQueue] = useState<QueuedRace[]>(() => loadQueue());
  const [starterStatuses, setStarterStatuses] =
    useState<StarterStatusStore>(loadStarterStatuses);
  const [chiefConfirmations, setChiefConfirmations] =
    useState<Record<string, boolean>>(loadChiefConfirmations);
  const [currentRace, setCurrentRace] =
    useState<QueuedRace | null>(initialRace);
  const [timerState, setTimerState] = useState<TimerState>(() => {
    if (
      initialRace &&
      initialControl?.raceId === initialRace.heat.id &&
      initialControl.status !== "waiting"
    ) {
      return initialControl.status;
    }
    return "idle";
  });
  const [raceHasStarted, setRaceHasStarted] = useState(
    initialControl?.status === "running" ||
      initialControl?.status === "stopped",
  );
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(() => {
    if (!initialControl?.startedAt) return 0;
    const end =
      initialControl.status === "stopped"
        ? initialControl.stoppedAt ?? Date.now()
        : Date.now();
    return Math.max(0, end - initialControl.startedAt);
  });
  const [laneResults, setLaneResults] = useState<
    Record<string, LaneResult>
  >(() => (initialRace ? getStoredResults(initialRace.heat.id) : {}));
  const [chiefOverrides, setChiefOverrides] = useState<
    Record<string, ChiefResultOverride>
  >(() => (initialRace ? getStoredOverrides(initialRace.heat.id) : {}));
  const [highlightedLanes, setHighlightedLanes] = useState<Set<number>>(
    new Set(),
  );
  const [resultsConfirmed, setResultsConfirmed] = useState(false);
  const [exportedRaces, setExportedRaces] = useState<QueuedRace[]>(
    loadExportedRaces,
  );
  const [completedHeats, setCompletedHeats] = useState<CompletedHeat[]>(
    loadCompletedHeats,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormats, setExportFormats] = useState<Set<ExportFormat>>(
    new Set(),
  );
  const [exportDestination, setExportDestination] =
    useState<ExportDestination>("download");
  const [exportMessage, setExportMessage] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [raceConfirmationPending, setRaceConfirmationPending] =
    useState(
      Boolean(
        event?.useStarterConfirmation &&
          initialRace &&
          initialControl?.status === "waiting",
      ),
    );
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [qrCodeOpen, setQrCodeOpen] = useState(false);
  const [overrideLane, setOverrideLane] = useState<number | null>(null);
  const [overrideTime, setOverrideTime] = useState("");
  const [overrideStatus, setOverrideStatus] = useState<
    "" | "DQ" | "DNS" | "DNF"
  >("");
  const timerStartedAt = useRef(initialControl?.startedAt ?? 0);
  const laneResultsRef = useRef(laneResults);

  useEffect(() => {
    laneResultsRef.current = laneResults;
  }, [laneResults]);

  useEffect(() => {
    if (timerState !== "running") return;

    let animationFrameId = 0;
    function updateTimer() {
      setElapsedMilliseconds(Date.now() - timerStartedAt.current);
      animationFrameId = window.requestAnimationFrame(updateTimer);
    }

    animationFrameId = window.requestAnimationFrame(updateTimer);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [timerState]);

  useEffect(() => {
    function handleStorage(storageEvent: StorageEvent) {
      if (storageEvent.key === CHIEF_QUEUE_KEY) {
        setQueue(loadQueue());
      }
      if (storageEvent.key === STARTER_STATUS_KEY) {
        setStarterStatuses(loadStarterStatuses());
      }
      if (storageEvent.key === CHIEF_RACE_CONFIRMATIONS_KEY) {
        setChiefConfirmations(loadChiefConfirmations());
      }

      if (
        storageEvent.key === LANE_RESULTS_KEY &&
        currentRace &&
        !resultsConfirmed
      ) {
        const store = readStorage<LaneResultStore>(LANE_RESULTS_KEY);
        if (store?.raceId !== currentRace.heat.id) return;

        const changedLanes = Object.values(store.results)
          .filter(
            (result) =>
              JSON.stringify(
                laneResultsRef.current[String(result.lane)],
              ) !== JSON.stringify(result),
          )
          .map((result) => result.lane);

        setLaneResults(store.results);
        if (changedLanes.length > 0) {
          setHighlightedLanes((current) => {
            const next = new Set(current);
            changedLanes.forEach((lane) => next.add(lane));
            return next;
          });
          window.setTimeout(() => {
            setHighlightedLanes((current) => {
              const next = new Set(current);
              changedLanes.forEach((lane) => next.delete(lane));
              return next;
            });
          }, 1800);
        }
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [currentRace, resultsConfirmed]);

  const eventName = event
    ? event.customEventName || event.eventName
    : "Track Event";
  const joinUrl = `${window.location.origin}${AppRoute.JOIN}?session=${encodeURIComponent(
    event?.sessionId ?? localStorage.getItem("raceflow.sessionId") ?? "",
  )}`;
  const starterRequired = Boolean(event?.useStarterConfirmation);
  const currentStarterStatus = currentRace
    ? starterStatuses.statuses[currentRace.heat.id]?.status
    : undefined;
  const summaryRaces = [
    ...exportedRaces,
    ...(currentRace ? [currentRace] : []),
    ...queue,
  ].filter(
    (race, index, races) =>
      races.findIndex((candidate) => candidate.heat.id === race.heat.id) ===
      index,
  );
  const summaryGroups = Array.from(
    summaryRaces.reduce((groups, race) => {
      const existing = groups.get(race.group.id) ?? [];
      groups.set(race.group.id, [...existing, race]);
      return groups;
    }, new Map<string, QueuedRace[]>()),
  );
  const activeLanes =
    currentRace?.heat.names
      .map((name, index) => ({ lane: index + 1, name }))
      .filter((athlete) => athlete.name.trim() !== "") ?? [];
  const allLanesHaveValidResults =
    activeLanes.length > 0 &&
    activeLanes.every(({ lane }) => {
      const result =
        chiefOverrides[String(lane)] ?? laneResults[String(lane)];
      return Boolean(
        result &&
          (result.status ||
            (result.finishMilliseconds !== undefined &&
              result.finishMilliseconds !== null)),
      );
    });

  useEffect(() => {
    if (
      timerState !== "running" ||
      !currentRace ||
      !allLanesHaveValidResults
    ) {
      return;
    }

    const stoppedAt = Date.now();
    setElapsedMilliseconds(stoppedAt - timerStartedAt.current);
    setTimerState("stopped");
    writeRaceControl({
      raceId: currentRace.heat.id,
      status: "stopped",
      startedAt: timerStartedAt.current,
      stoppedAt,
    });
  }, [allLanesHaveValidResults, currentRace, timerState]);

  function resetRaceState(race: QueuedRace) {
    const emptyResults = emptyResultStore(race.heat.id);
    setTimerState("idle");
    setRaceHasStarted(false);
    setElapsedMilliseconds(0);
    setLaneResults({});
    setChiefOverrides({});
    setResultsConfirmed(false);
    setExportOpen(false);
    timerStartedAt.current = 0;
    localStorage.setItem(LANE_RESULTS_KEY, JSON.stringify(emptyResults));
    localStorage.setItem(
      CHIEF_OVERRIDES_KEY,
      JSON.stringify({ raceId: race.heat.id, overrides: {} }),
    );
    const confirmations = {
      ...chiefConfirmations,
      [race.heat.id]: false,
    };
    setChiefConfirmations(confirmations);
    localStorage.setItem(
      CHIEF_RACE_CONFIRMATIONS_KEY,
      JSON.stringify(confirmations),
    );
    writeRaceControl({
      raceId: race.heat.id,
      status: "waiting",
      startedAt: null,
    });
  }

  function openRace() {
    if (currentRace || queue.length === 0) return;

    const [nextRace, ...remainingQueue] = queue;
    setCurrentRace(nextRace);
    setQueue(remainingQueue);
    setUpcomingOpen(false);
    resetRaceState(nextRace);
    setRaceConfirmationPending(starterRequired);
    localStorage.setItem(CURRENT_RACE_KEY, JSON.stringify(nextRace));
    localStorage.setItem(CHIEF_QUEUE_KEY, JSON.stringify(remainingQueue));
  }

  function startRace() {
    if (!currentRace) return;
    if (
      starterRequired &&
      currentStarterStatus !== "confirmed"
    ) {
      return;
    }

    const startedAt = Date.now();
    const emptyResults = emptyResultStore(currentRace.heat.id);
    timerStartedAt.current = startedAt;
    setElapsedMilliseconds(0);
    setLaneResults({});
    setRaceHasStarted(true);
    setResultsConfirmed(false);
    setTimerState("running");
    localStorage.setItem(LANE_RESULTS_KEY, JSON.stringify(emptyResults));
    writeRaceControl({
      raceId: currentRace.heat.id,
      status: "running",
      startedAt,
    });
  }

  function confirmNextRace() {
    if (!currentRace || !raceConfirmationPending) return;

    const updated = {
      ...chiefConfirmations,
      [currentRace.heat.id]: true,
    };
    setChiefConfirmations(updated);
    localStorage.setItem(
      CHIEF_RACE_CONFIRMATIONS_KEY,
      JSON.stringify(updated),
    );
  }

  function openTimingScreen() {
    if (
      !currentRace ||
      !chiefConfirmations[currentRace.heat.id] ||
      currentStarterStatus !== "confirmed"
    ) {
      return;
    }
    setRaceConfirmationPending(false);
  }

  function stopRace() {
    if (!currentRace) return;

    const stoppedAt = Date.now();
    setElapsedMilliseconds(stoppedAt - timerStartedAt.current);
    setTimerState("stopped");
    writeRaceControl({
      raceId: currentRace.heat.id,
      status: "stopped",
      startedAt: timerStartedAt.current,
      stoppedAt,
    });
  }

  function falseStart() {
    if (!currentRace) return;

    setTimerState("stopped");
    setRaceHasStarted(false);
    setElapsedMilliseconds(0);
    setLaneResults({});
    localStorage.setItem(
      LANE_RESULTS_KEY,
      JSON.stringify(emptyResultStore(currentRace.heat.id)),
    );
    writeRaceControl({
      raceId: currentRace.heat.id,
      status: "waiting",
      startedAt: null,
    });
  }

  function restartTimer() {
    if (!currentRace) return;
    resetRaceState(currentRace);
  }

  function buildExportRows(): ExportRow[] {
    const eligible = activeLanes
      .map(({ lane }) => {
        const result =
          chiefOverrides[String(lane)] ?? laneResults[String(lane)];
        return {
          lane,
          finish: result?.finishMilliseconds ?? null,
          status: result?.status ?? "",
        };
      })
      .filter(
        (result) =>
          result.finish !== null && result.status === "",
      )
      .sort((left, right) => left.finish! - right.finish!);
    const places = new Map(
      eligible.map((result, index) => [result.lane, String(index + 1)]),
    );

    return activeLanes.map(({ lane, name }) => {
      const result =
        chiefOverrides[String(lane)] ?? laneResults[String(lane)];
      return {
        place: places.get(lane) ?? "",
        lane,
        athlete: name,
        time:
          result?.finishMilliseconds === undefined ||
          result.finishMilliseconds === null
            ? ""
            : formatRaceTime(result.finishMilliseconds),
        status: result?.status ?? "",
      };
    });
  }

  function getExportDetails() {
    if (!currentRace) return null;
    const now = new Date();
    const heats = completedHeats
      .filter((heat) => heat.race.group.id === currentRace.group.id)
      .sort(
        (left, right) =>
          left.race.heatNumber - right.race.heatNumber,
      );
    const overall = heats
      .flatMap((heat) =>
        heat.rows.map((row) => ({
          ...row,
          heatNumber: heat.race.heatNumber,
        })),
      )
      .sort((left, right) => {
        if (left.status && !right.status) return 1;
        if (!left.status && right.status) return -1;
        return (
          (parseRaceTime(left.time) ?? Number.MAX_SAFE_INTEGER) -
          (parseRaceTime(right.time) ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .map((row, index) => ({
        ...row,
        place: row.status || !row.time ? "" : String(index + 1),
      }));
    return {
      heats,
      overall,
      metadata: [
        ["Event", eventName],
        ["Age Group", getAgeLabel(currentRace.group.age)],
        ["Gender", getGenderLabel(currentRace.group.gender)],
        ["Date", now.toLocaleDateString()],
        ["Time exported", now.toLocaleTimeString()],
      ],
      filename: `${currentRace.group.id}-official-results`,
    };
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function createCsvFile() {
    const details = getExportDetails();
    if (!details) return null;

    const data = [
      ...details.metadata,
      [],
      ["Overall Placings"],
      ["Place", "Lane", "Athlete", "Time", "Status"],
      ...details.overall.map((row) => [
        row.place,
        String(row.lane),
        row.athlete,
        row.time,
        row.status,
      ]),
      ...details.heats.flatMap((heat) => [
        [],
        [`Heat ${heat.race.heatNumber}`],
        ["Place", "Lane", "Athlete", "Time", "Status"],
        ...heat.rows.map((row) => [
          row.place,
          String(row.lane),
          row.athlete,
          row.time,
          row.status,
        ]),
      ]),
      [],
      ["Official Results"],
      ["Generated by RaceFlow"],
    ];
    const csv = data
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    return new File(
      [csv],
      `${details.filename}.csv`,
      { type: "text/csv;charset=utf-8" },
    );
  }

  function createExcelFile() {
    const details = getExportDetails();
    if (!details) return null;

    const worksheet = XLSX.utils.aoa_to_sheet([
      ...details.metadata,
      [],
      ["Overall Placings"],
      ["Place", "Lane", "Athlete", "Time", "Status"],
      ...details.overall.map((row) => [
        row.place,
        row.lane,
        row.athlete,
        row.time,
        row.status,
      ]),
      [],
      ["Official Results"],
      ["Generated by RaceFlow"],
    ]);
    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 10 },
      { wch: 28 },
      { wch: 14 },
      { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Overall");
    details.heats.forEach((heat) => {
      const heatSheet = XLSX.utils.aoa_to_sheet([
        [`Heat ${heat.race.heatNumber}`],
        ["Place", "Lane", "Athlete", "Time", "Status"],
        ...heat.rows.map((row) => [
          row.place,
          row.lane,
          row.athlete,
          row.time,
          row.status,
        ]),
      ]);
      XLSX.utils.book_append_sheet(
        workbook,
        heatSheet,
        `Heat ${heat.race.heatNumber}`,
      );
    });
    const bytes = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    return new File([bytes], `${details.filename}.xlsx`, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function createPdfFile() {
    const details = getExportDetails();
    if (!details) return null;

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFontSize(18);
    pdf.text("Official Results", pageWidth / 2, 18, {
      align: "center",
    });
    pdf.setFontSize(10);
    details.metadata.forEach(([label, value], index) => {
      pdf.text(`${label}: ${value}`, 18, 29 + index * 5);
    });

    const columns = [18, 38, 58, 126, 158];
    let y = 64;
    pdf.setFont("helvetica", "bold");
    pdf.text("Overall Placings", 18, y - 8);
    pdf.setFont("helvetica", "bold");
    ["Place", "Lane", "Athlete", "Time", "Status"].forEach(
      (heading, index) => pdf.text(heading, columns[index], y),
    );
    pdf.line(18, y + 2, pageWidth - 18, y + 2);
    pdf.setFont("helvetica", "normal");

    function ensurePdfSpace(requiredHeight: number) {
      if (y + requiredHeight <= 270) return;
      pdf.addPage();
      y = 20;
    }

    details.overall.forEach((row) => {
      ensurePdfSpace(8);
      y += 8;
      pdf.text(row.place, columns[0], y);
      pdf.text(String(row.lane), columns[1], y);
      pdf.text(row.athlete.slice(0, 34), columns[2], y);
      pdf.text(row.time, columns[3], y);
      pdf.text(row.status, columns[4], y);
    });
    details.heats.forEach((heat) => {
      ensurePdfSpace(20);
      y += 12;
      pdf.setFont("helvetica", "bold");
      pdf.text(`Heat ${heat.race.heatNumber}`, 18, y);
      pdf.setFont("helvetica", "normal");
      heat.rows.forEach((row) => {
        ensurePdfSpace(7);
        y += 7;
        pdf.text(row.place, columns[0], y);
        pdf.text(String(row.lane), columns[1], y);
        pdf.text(row.athlete.slice(0, 34), columns[2], y);
        pdf.text(row.time, columns[3], y);
        pdf.text(row.status, columns[4], y);
      });
    });

    ensurePdfSpace(18);
    const footerY = Math.max(y + 18, 270);
    pdf.line(18, footerY - 7, pageWidth - 18, footerY - 7);
    pdf.setFont("helvetica", "bold");
    pdf.text("Official Results", pageWidth / 2, footerY, {
      align: "center",
    });
    pdf.setFont("helvetica", "normal");
    pdf.text("Generated by RaceFlow", pageWidth / 2, footerY + 5, {
      align: "center",
    });
    return new File(
      [pdf.output("blob")],
      `${details.filename}.pdf`,
      { type: "application/pdf" },
    );
  }

  async function performGroupExport() {
    if (!currentRace || exportFormats.size === 0) return;

    const files = Array.from(exportFormats)
      .map((format) => {
        if (format === "csv") return createCsvFile();
        if (format === "xlsx") return createExcelFile();
        return createPdfFile();
      })
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;

    const shareData = {
      files,
      title: `RaceFlow Results – ${eventName} – ${getAgeLabel(
        currentRace.group.age,
      )}`,
      text: "Please find the attached official RaceFlow results.",
    };

    try {
      if (exportDestination === "download") {
        files.forEach(downloadFile);
      } else if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files }))
      ) {
        await navigator.share(shareData);
      } else {
        files.forEach(downloadFile);
        if (exportDestination === "email") {
          window.open(
            `mailto:?subject=${encodeURIComponent(
              shareData.title,
            )}&body=${encodeURIComponent(shareData.text)}`,
            "_self",
          );
        }
      }
    } catch {
      return;
    }

    const groupId = currentRace.group.id;
    const exportedGroupRaces = completedHeats
      .filter((heat) => heat.race.group.id === groupId)
      .map((heat) => heat.race);
    const updatedExported = [
      ...exportedRaces.filter((race) => race.group.id !== groupId),
      ...exportedGroupRaces,
    ];
    const remainingCompleted = completedHeats.filter(
      (heat) => heat.race.group.id !== groupId,
    );
    setExportedRaces(updatedExported);
    setCompletedHeats(remainingCompleted);
    localStorage.setItem(
      EXPORTED_HEATS_KEY,
      JSON.stringify(updatedExported),
    );
    localStorage.setItem(
      COMPLETED_HEATS_KEY,
      JSON.stringify(remainingCompleted),
    );
    setExportOpen(false);
    setExportMessage("Export successful.");

    if (queue.length > 0) {
      const [next, ...remainingQueue] = queue;
      setCurrentRace(next);
      setQueue(remainingQueue);
      resetRaceState(next);
      setRaceConfirmationPending(starterRequired);
      localStorage.setItem(CURRENT_RACE_KEY, JSON.stringify(next));
      localStorage.setItem(
        CHIEF_QUEUE_KEY,
        JSON.stringify(remainingQueue),
      );
    } else {
      leaveCompletedAgeGroup(true);
    }
  }

  function confirmCurrentResults() {
    if (
      !currentRace ||
      resultsConfirmed ||
      !allLanesHaveValidResults
    ) {
      return;
    }

    const snapshot: CompletedHeat = {
      race: currentRace,
      rows: buildExportRows(),
    };
    const updatedCompleted = [
      ...completedHeats.filter(
        (heat) => heat.race.heat.id !== currentRace.heat.id,
      ),
      snapshot,
    ];
    setCompletedHeats(updatedCompleted);
    localStorage.setItem(
      COMPLETED_HEATS_KEY,
      JSON.stringify(updatedCompleted),
    );

    const nextIndex = queue.findIndex(
      (race) => race.group.id === currentRace.group.id,
    );
    if (nextIndex >= 0) {
      const next = queue[nextIndex];
      const remainingQueue = queue.filter(
        (_race, index) => index !== nextIndex,
      );
      setCurrentRace(next);
      setQueue(remainingQueue);
      resetRaceState(next);
      setRaceConfirmationPending(starterRequired);
      localStorage.setItem(CURRENT_RACE_KEY, JSON.stringify(next));
      localStorage.setItem(
        CHIEF_QUEUE_KEY,
        JSON.stringify(remainingQueue),
      );
      return;
    }

    setResultsConfirmed(true);
  }

  function leaveCompletedAgeGroup(returnToQueue: boolean) {
    setCurrentRace(null);
    setTimerState("idle");
    setElapsedMilliseconds(0);
    setRaceHasStarted(false);
    setResultsConfirmed(false);
    setRaceConfirmationPending(false);
    localStorage.removeItem(CURRENT_RACE_KEY);
    localStorage.removeItem(RACE_CONTROL_KEY);
    localStorage.removeItem(LANE_RESULTS_KEY);
    localStorage.removeItem(CHIEF_OVERRIDES_KEY);
    if (returnToQueue) setUpcomingOpen(true);
  }

  function openOverride(lane: number) {
    const effective =
      chiefOverrides[String(lane)] ?? laneResults[String(lane)];
    const milliseconds = effective?.finishMilliseconds;
    setOverrideLane(lane);
    setOverrideTime(
      milliseconds === undefined || milliseconds === null
        ? ""
        : formatRaceTime(milliseconds),
    );
    setOverrideStatus(effective?.status ?? "");
  }

  function saveOverride() {
    if (
      !currentRace ||
      overrideLane === null ||
      resultsConfirmed
    ) {
      return;
    }

    const parsedMilliseconds =
      overrideTime.trim() === "" ? null : parseRaceTime(overrideTime);
    if (overrideTime.trim() !== "" && parsedMilliseconds === null) return;

    const status = overrideStatus || null;
    const override: ChiefResultOverride = {
      lane: overrideLane,
      finishMilliseconds:
        status === "DNS" || status === "DNF"
          ? null
          : parsedMilliseconds === null
            ? null
            : parsedMilliseconds,
      status,
      editedAt: Date.now(),
    };
    const updated = {
      ...chiefOverrides,
      [String(overrideLane)]: override,
    };
    setChiefOverrides(updated);
    localStorage.setItem(
      CHIEF_OVERRIDES_KEY,
      JSON.stringify({
        raceId: currentRace.heat.id,
        overrides: updated,
      }),
    );
    setOverrideLane(null);
  }

  function saveChiefStop(lane: number) {
    if (
      !currentRace ||
      resultsConfirmed ||
      timerState !== "running"
    ) {
      return;
    }

    const laneResult = laneResults[String(lane)];
    const override: ChiefResultOverride = {
      lane,
      finishMilliseconds: Math.max(
        0,
        Date.now() - timerStartedAt.current,
      ),
      status: laneResult?.status ?? null,
      editedAt: Date.now(),
    };
    const updated = {
      ...chiefOverrides,
      [String(lane)]: override,
    };
    setChiefOverrides(updated);
    localStorage.setItem(
      CHIEF_OVERRIDES_KEY,
      JSON.stringify({
        raceId: currentRace.heat.id,
        overrides: updated,
      }),
    );
  }

  function getSimulatedFinishTime() {
    const eventText = eventName.toLowerCase();
    let minimum = 11000;
    let maximum = 18000;
    if (eventText.includes("1500")) {
      minimum = 240000;
      maximum = 420000;
    } else if (eventText.includes("800")) {
      minimum = 120000;
      maximum = 210000;
    } else if (eventText.includes("400")) {
      minimum = 50000;
      maximum = 90000;
    } else if (eventText.includes("200")) {
      minimum = 23000;
      maximum = 38000;
    }
    return Math.round(minimum + Math.random() * (maximum - minimum));
  }

  function simulateLaneResult(
    lane: number,
    action: "finish" | "DQ" | "DNS" | "DNF",
  ) {
    if (
      !currentRace ||
      resultsConfirmed ||
      timerState !== "running"
    ) {
      return;
    }

    const existing = laneResults[String(lane)];
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
        lane,
        finishMilliseconds: getSimulatedFinishTime(),
        submittedAt: Date.now(),
      };
    } else if (action === "DQ") {
      if (
        existing?.status === "DQ" ||
        existing?.status === "DNS" ||
        existing?.status === "DNF"
      ) {
        return;
      }
      result = {
        ...existing,
        lane,
        status: "DQ",
        submittedAt: Date.now(),
      };
    } else {
      result = {
        lane,
        status: action,
        submittedAt: Date.now(),
      };
    }

    const updated = {
      ...laneResults,
      [String(lane)]: result,
    };
    setLaneResults(updated);
    laneResultsRef.current = updated;
    setHighlightedLanes((current) => new Set(current).add(lane));
    window.setTimeout(() => {
      setHighlightedLanes((current) => {
        const next = new Set(current);
        next.delete(lane);
        return next;
      });
    }, 1800);
    localStorage.setItem(
      LANE_RESULTS_KEY,
      JSON.stringify({
        raceId: currentRace.heat.id,
        results: updated,
      }),
    );
  }

  return (
    <main className="chief-page">
      <section className="chief-shell">
        <LiveSessionStatus />
        <div className="chief-top-row">
          <Link className="back-link" to={AppRoute.HOME}>
            ← Home
          </Link>
          <div className="chief-top-actions">
            <button type="button" onClick={() => setUpcomingOpen(true)}>
              Upcoming
              {queue.length > 0 && (
                <span className="chief-queue-count">{queue.length}</span>
              )}
            </button>
            <button type="button" onClick={() => setQrCodeOpen(true)}>
              QR Code
            </button>
          </div>
        </div>

        <header className="chief-header">
          <p>Chief Timekeeper</p>
          <h1>{eventName}</h1>
          <label className="chief-test-toggle">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(changeEvent) =>
                setTestMode(changeEvent.target.checked)
              }
            />
            <span>Test Mode</span>
          </label>
        </header>

        {exportMessage && (
          <div className="chief-export-success" role="status">
            {exportMessage}
          </div>
        )}

        <section className="chief-section">
          <h2>Current Race</h2>
          {!currentRace ? (
            <p className="chief-empty">No race is currently open.</p>
          ) : raceConfirmationPending ? (
            <div className="chief-race-confirmation">
              <div className="chief-confirmation-status">
                <div>
                  <span>Chief Timekeeper</span>
                  <strong>
                    {chiefConfirmations[currentRace.heat.id]
                      ? "🟢 Confirmed"
                      : "○ Waiting"}
                  </strong>
                </div>
                <div>
                  <span>Starter</span>
                  <strong>
                    {currentStarterStatus === "confirmed"
                      ? "🟢 Confirmed"
                      : "○ Waiting"}
                  </strong>
                </div>
              </div>

              {currentStarterStatus === "wrong-group" && (
                <div
                  className="chief-starter-alert chief-starter-wrong"
                  role="alert"
                >
                  Wrong Group reported by Starter. Timing is blocked.
                </div>
              )}

              <dl className="chief-confirmation-details">
                <div>
                  <dt>Event</dt>
                  <dd>{eventName}</dd>
                </div>
                <div>
                  <dt>Age / Gender</dt>
                  <dd>
                    {getAgeLabel(currentRace.group.age)}{" "}
                    {getGenderLabel(currentRace.group.gender)}
                  </dd>
                </div>
                <div>
                  <dt>Heat number</dt>
                  <dd>{currentRace.heatNumber}</dd>
                </div>
              </dl>

              <ol className="chief-confirmation-athletes">
                {currentRace.heat.names.map((name, index) => (
                  <li key={`${currentRace.heat.id}-confirm-${index}`}>
                    <span>Lane {index + 1}</span>
                    <strong>{name.trim() || "Empty"}</strong>
                  </li>
                ))}
              </ol>

              <div className="chief-confirmation-actions">
                <button
                  type="button"
                  disabled={
                    Boolean(
                      chiefConfirmations[currentRace.heat.id],
                    )
                  }
                  onClick={confirmNextRace}
                >
                  {chiefConfirmations[currentRace.heat.id]
                    ? "Chief Timekeeper Confirmed"
                    : "Confirm Next Race"}
                </button>
                <button
                  type="button"
                  disabled={
                    !chiefConfirmations[currentRace.heat.id] ||
                    currentStarterStatus !== "confirmed"
                  }
                  onClick={openTimingScreen}
                >
                  Open Timing Screen
                </button>
              </div>
            </div>
          ) : (
            <div className="chief-current-card">
              <h3>{getRaceLabel(currentRace)}</h3>
              {starterRequired &&
                currentStarterStatus !== "confirmed" && (
                  <div
                    className={`chief-starter-alert ${
                      currentStarterStatus === "wrong-group"
                        ? "chief-starter-wrong"
                        : ""
                    }`}
                    role="alert"
                  >
                    {currentStarterStatus === "wrong-group"
                      ? "Wrong Group reported by Starter. Race cannot start."
                      : "Starter confirmation required before this race can start."}
                  </div>
                )}
              <div
                className="chief-timer"
                role="timer"
                aria-label={`${(elapsedMilliseconds / 1000).toFixed(3)} seconds`}
              >
                {(elapsedMilliseconds / 1000).toFixed(3)}
              </div>

              <div className="chief-timer-actions">
                {timerState === "idle" && (
                  <button
                    className="chief-main-button"
                    type="button"
                    disabled={
                      starterRequired &&
                      currentStarterStatus !== "confirmed"
                    }
                    onClick={startRace}
                  >
                    Start Race
                  </button>
                )}
                {timerState === "running" && (
                  <>
                    <button
                      className="chief-main-button chief-stop-button"
                      type="button"
                      onClick={stopRace}
                    >
                      Stop
                    </button>
                    <button
                      className="chief-false-start-button"
                      type="button"
                      onClick={falseStart}
                    >
                      False Start
                    </button>
                  </>
                )}
                {timerState === "stopped" && (
                  <button
                    className="chief-main-button"
                    type="button"
                    onClick={restartTimer}
                  >
                    Restart Timer
                  </button>
                )}
              </div>

              <div className="chief-athlete-table-wrap">
                <table className="chief-athlete-table">
                  <thead>
                    <tr>
                      <th>Lane</th>
                      <th>Athlete</th>
                      <th>Result</th>
                      <th>Stop</th>
                      <th>Override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLanes.map(({ lane, name }) => {
                      const laneResult = laneResults[String(lane)];
                      const override = chiefOverrides[String(lane)];
                      const result = override ?? laneResult;
                      return (
                        <tr
                          className={
                            highlightedLanes.has(lane)
                              ? "chief-result-new"
                              : ""
                          }
                          key={`${currentRace.heat.id}-${lane}`}
                        >
                          <td>{lane}</td>
                          <td>{name}</td>
                          <td
                            className={
                              result?.status
                                ? "chief-result-invalid"
                                : result?.finishMilliseconds !== undefined &&
                                    result.finishMilliseconds !== null
                                  ? "chief-result-received"
                                  : "chief-result-waiting"
                            }
                          >
                            <div className="chief-result-cell">
                              <span>
                                {result
                                  ? formatEffectiveResult(result) ||
                                    (raceHasStarted ? "Running" : "Ready")
                                  : raceHasStarted
                                    ? "Running"
                                    : "Ready"}
                              </span>
                            </div>
                            {override && !resultsConfirmed && (
                              <small className="chief-edited-indicator">
                                Chief Override
                              </small>
                            )}
                            {override && (
                              <>
                                <details className="chief-audit-result">
                                  <summary>
                                    <span className="chief-show-original">
                                      Show Original
                                    </span>
                                    <span className="chief-hide-original">
                                      Hide Original
                                    </span>
                                  </summary>
                                  <span>
                                    {laneResult
                                      ? formatResult(laneResult)
                                      : "No lane submission"}
                                  </span>
                                </details>
                              </>
                            )}
                            {testMode && !resultsConfirmed && (
                              <div className="chief-simulate-actions">
                                <button
                                  type="button"
                                  disabled={
                                    timerState !== "running" ||
                                    laneResult?.finishMilliseconds !==
                                      undefined ||
                                    laneResult?.status === "DNS" ||
                                    laneResult?.status === "DNF"
                                  }
                                  onClick={() =>
                                    simulateLaneResult(lane, "finish")
                                  }
                                >
                                  Simulate Finish
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    timerState !== "running" ||
                                    Boolean(laneResult?.status)
                                  }
                                  onClick={() =>
                                    simulateLaneResult(lane, "DNS")
                                  }
                                >
                                  Simulate DNS
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    timerState !== "running" ||
                                    Boolean(laneResult?.status)
                                  }
                                  onClick={() =>
                                    simulateLaneResult(lane, "DQ")
                                  }
                                >
                                  Simulate DQ
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    timerState !== "running" ||
                                    laneResult?.status === "DNF"
                                  }
                                  onClick={() =>
                                    simulateLaneResult(lane, "DNF")
                                  }
                                >
                                  Simulate DNF
                                </button>
                              </div>
                            )}
                          </td>
                          <td>
                            {!resultsConfirmed && (
                              <button
                                className="chief-lane-action chief-stop-lane"
                                type="button"
                                disabled={
                                  timerState !== "running" ||
                                  Boolean(result)
                                }
                                onClick={() => saveChiefStop(lane)}
                              >
                                Stop
                              </button>
                            )}
                          </td>
                          <td>
                            {!resultsConfirmed && (
                              <button
                                className="chief-lane-action chief-override-action"
                                type="button"
                                disabled={!laneResult && !override}
                                onClick={() => openOverride(lane)}
                              >
                                Override
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="chief-result-actions">
                {!resultsConfirmed ? (
                  <button
                    type="button"
                    disabled={!allLanesHaveValidResults}
                    onClick={confirmCurrentResults}
                  >
                    Confirm Results
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setExportOpen(true)}
                  >
                    Export Results
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </section>

      {upcomingOpen && (
        <div
          className="chief-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upcoming-title"
          onClick={() => setUpcomingOpen(false)}
        >
          <section
            className="chief-popup"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="chief-popup-header">
              <h2 id="upcoming-title">Upcoming</h2>
              <button
                type="button"
                aria-label="Close upcoming races"
                onClick={() => setUpcomingOpen(false)}
              >
                ×
              </button>
            </div>
            {summaryRaces.length === 0 ? (
              <p className="chief-empty">
                No heats have been pushed from Line Marshal.
              </p>
            ) : (
              <div className="chief-upcoming-summary">
                <h3>{getCompactEventLabel(eventName)}</h3>
                {summaryGroups.map(([groupId, races]) => (
                  <section key={groupId}>
                    <h4>
                      {races[0].group.age === "open"
                        ? "Open"
                        : races[0].group.age}{" "}
                      {getGenderLabel(races[0].group.gender)}
                    </h4>
                    {races
                      .sort(
                        (left, right) =>
                          left.heatNumber - right.heatNumber,
                      )
                      .map((race) => {
                        const exported = exportedRaces.some(
                          (item) => item.heat.id === race.heat.id,
                        );
                        const isNext =
                          queue[0]?.heat.id === race.heat.id &&
                          !currentRace;
                        return (
                          <div
                            className="chief-upcoming-heat"
                            key={race.heat.id}
                          >
                            <span>
                              {exported ? "✓" : "○"} Heat{" "}
                              {race.heatNumber}
                              {!exported && " Ready"}
                            </span>
                            {isNext && (
                              <button
                                type="button"
                                onClick={openRace}
                              >
                                Open
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {qrCodeOpen && (
        <div
          className="chief-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-code-title"
          onClick={() => setQrCodeOpen(false)}
        >
          <section
            className="chief-popup chief-qr-popup"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="chief-popup-header">
              <h2 id="qr-code-title">QR Code</h2>
              <button
                type="button"
                aria-label="Close QR code"
                onClick={() => setQrCodeOpen(false)}
              >
                ×
              </button>
            </div>
            <QRCodeSVG
              value={joinUrl}
              size={220}
              level="M"
              includeMargin
            />
            <p>Scan to join this live RaceFlow session.</p>
          </section>
        </div>
      )}

      {exportOpen && currentRace && (
        <div
          className="chief-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-title"
          onClick={() => setExportOpen(false)}
        >
          <section
            className="chief-popup chief-export-popup"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="chief-popup-header">
              <h2 id="export-title">Export Results</h2>
              <button
                type="button"
                aria-label="Close export options"
                onClick={() => setExportOpen(false)}
              >
                ×
              </button>
            </div>
            <fieldset className="chief-export-choices">
              <legend>1. Choose one or more file formats</legend>
              {[
                ["pdf", "PDF"],
                ["xlsx", "Excel (.xlsx)"],
                ["csv", "CSV"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={exportFormats.has(value as ExportFormat)}
                    onChange={() => {
                      setExportFormats((current) => {
                        const next = new Set(current);
                        const format = value as ExportFormat;
                        if (next.has(format)) next.delete(format);
                        else next.add(format);
                        return next;
                      });
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="chief-export-choices">
              <legend>2. Choose destination</legend>
              {[
                ["email", "Email"],
                ["teams", "Microsoft Teams"],
                ["download", "Download to device"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="export-destination"
                    checked={exportDestination === value}
                    onChange={() =>
                      setExportDestination(value as ExportDestination)
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <button
              className="chief-export-submit"
              type="button"
              disabled={exportFormats.size === 0}
              onClick={() => void performGroupExport()}
            >
              3. Export
            </button>
          </section>
        </div>
      )}

      {overrideLane !== null && currentRace && (
        <div
          className="chief-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-title"
          onClick={() => setOverrideLane(null)}
        >
          <section
            className="chief-popup chief-override-popup"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <div className="chief-popup-header">
              <h2 id="override-title">Override Lane {overrideLane}</h2>
              <button
                type="button"
                aria-label="Close result override"
                onClick={() => setOverrideLane(null)}
              >
                ×
              </button>
            </div>

            <label className="chief-override-field">
              <span>Finish time</span>
              <input
                type="text"
                inputMode="decimal"
                value={overrideTime}
                placeholder="e.g. 12.54 or 5:37.82"
                onChange={(changeEvent) =>
                  setOverrideTime(changeEvent.target.value)
                }
              />
            </label>

            <fieldset className="chief-override-status">
              <legend>Status</legend>
              {[
                ["", "Clear DQ / DNS / DNF"],
                ["DQ", "DQ"],
                ["DNS", "DNS"],
                ["DNF", "DNF"],
              ].map(([value, label]) => (
                <label key={label}>
                  <input
                    type="radio"
                    name="override-status"
                    value={value}
                    checked={overrideStatus === value}
                    onChange={() =>
                      setOverrideStatus(
                        value as "" | "DQ" | "DNS" | "DNF",
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <button
              className="chief-save-override"
              type="button"
              onClick={saveOverride}
            >
              Save Override
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
