import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AppRoute } from "../types/routes";
import { getSessionId } from "../features/live/liveSession";
import "./SessionQrButton.css";

interface SessionQrButtonProps {
  className?: string;
}

export default function SessionQrButton({
  className = "",
}: SessionQrButtonProps) {
  const [open, setOpen] = useState(false);
  const sessionId = getSessionId() ?? "";
  const joinUrl = `${window.location.origin}${AppRoute.JOIN}?session=${encodeURIComponent(
    sessionId,
  )}`;

  return (
    <>
      <button
        className={className}
        type="button"
        disabled={!sessionId}
        onClick={() => setOpen(true)}
      >
        QR Code
      </button>

      {open && (
        <div
          className="session-qr-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-qr-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="session-qr-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="session-qr-close"
              type="button"
              aria-label="Close QR code"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <QRCodeSVG value={joinUrl} size={260} level="M" includeMargin />
            <h2 id="session-qr-title">Scan to Join Event</h2>
            <p>Select a role after scanning.</p>
          </div>
        </div>
      )}
    </>
  );
}
