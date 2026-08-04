import "./RaceStatusBar.css";

export type RaceStatus = "up-next" | "live" | "paused" | "complete";

interface RaceStatusBarProps {
  status: RaceStatus;
  eventName: string;
  groupName: string;
  heatNumber: number;
  totalHeats: number;
}

const STATUS_LABELS: Record<RaceStatus, string> = {
  "up-next": "UP NEXT",
  live: "LIVE",
  paused: "PAUSED",
  complete: "COMPLETE",
};

export default function RaceStatusBar({
  status,
  eventName,
  groupName,
  heatNumber,
  totalHeats,
}: RaceStatusBarProps) {
  const safeHeatNumber = Math.max(1, heatNumber);
  const safeTotalHeats = Math.max(safeHeatNumber, totalHeats);

  return (
    <div
      className={`race-status-bar race-status-${status}`}
      role="status"
      aria-live="polite"
      aria-label={`${STATUS_LABELS[status]}. ${eventName}. ${groupName}. Heat ${safeHeatNumber} of ${safeTotalHeats}.`}
    >
      <span className="race-status-dot" aria-hidden="true" />

      <span className="race-status-label">
        {STATUS_LABELS[status]}
      </span>

      <span className="race-status-separator" aria-hidden="true">
        •
      </span>

      <span className="race-status-details">
        {eventName} • {groupName} • H{safeHeatNumber}/{safeTotalHeats}
      </span>
    </div>
  );
}
