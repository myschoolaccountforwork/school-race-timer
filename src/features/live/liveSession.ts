import { timerId } from '../timing/timerId';
export type ConnectionState = "connected" | "reconnecting" | "offline";

const SESSION_KEY = "raceflow.sessionId";
const ROLE_KEY = "raceflow.sessionRole";
const SOURCE_KEY = "raceflow.deviceId";
const listeners = new Set<(state: ConnectionState) => void>();

let connectionState: ConnectionState = navigator.onLine
  ? "reconnecting"
  : "offline";
let eventSource: EventSource | null = null;
let activeSessionId = localStorage.getItem(SESSION_KEY);
let applyingRemoteUpdate = false;
const sourceId =
  localStorage.getItem(SOURCE_KEY) ?? timerId();

localStorage.setItem(SOURCE_KEY, sourceId);

const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;

function notify(state: ConnectionState) {
  connectionState = state;
  listeners.forEach((listener) => listener(state));
}

function dispatchStorageChange(key: string, value: string | null) {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: value,
      storageArea: localStorage,
      url: window.location.href,
    }),
  );
}

async function sendUpdate(key: string, value: string | null) {
  if (!activeSessionId || applyingRemoteUpdate || key === 'raceflow.timerOnly.v1') return;
  try {
    await fetch("/api/live/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSessionId,
        key,
        value,
        sourceId,
      }),
    });
  } catch {
    notify(navigator.onLine ? "reconnecting" : "offline");
  }
}

Storage.prototype.setItem = function setItem(key: string, value: string) {
  originalSetItem.call(this, key, value);
  if (this === localStorage && key.startsWith("raceflow.")) {
    if (key === SESSION_KEY && value !== activeSessionId) {
      activeSessionId = value;
      void connectLiveSession(value, false);
    }
    void sendUpdate(key, value);
  }
};

Storage.prototype.removeItem = function removeItem(key: string) {
  originalRemoveItem.call(this, key);
  if (this === localStorage && key.startsWith("raceflow.")) {
    void sendUpdate(key, null);
  }
};

export async function connectLiveSession(
  sessionId: string,
  hydrate = true,
) {
  activeSessionId = sessionId;
  originalSetItem.call(localStorage, SESSION_KEY, sessionId);
  eventSource?.close();
  notify(navigator.onLine ? "reconnecting" : "offline");

  if (hydrate) {
    try {
      const response = await fetch(
        `/api/live/state?session=${encodeURIComponent(sessionId)}`,
      );
      if (response.ok) {
        const state = (await response.json()) as Record<string, string>;
        applyingRemoteUpdate = true;
        Object.entries(state).forEach(([key, value]) => {
          if (key === 'raceflow.timerOnly.v1') return;
          originalSetItem.call(localStorage, key, value);
          dispatchStorageChange(key, value);
        });
        applyingRemoteUpdate = false;
      }
    } catch {
      notify(navigator.onLine ? "reconnecting" : "offline");
    }
  }

  eventSource = new EventSource(
    `/api/live/events?session=${encodeURIComponent(sessionId)}`,
  );
  eventSource.addEventListener("connected", () => notify("connected"));
  eventSource.addEventListener("update", (event) => {
    const update = JSON.parse((event as MessageEvent<string>).data) as {
      key: string;
      value: string | null;
      sourceId?: string;
    };
    if (update.sourceId === sourceId) return;
    if (update.key === 'raceflow.timerOnly.v1') return;

    applyingRemoteUpdate = true;
    if (update.value === null) originalRemoveItem.call(localStorage, update.key);
    else originalSetItem.call(localStorage, update.key, update.value);
    applyingRemoteUpdate = false;
    dispatchStorageChange(update.key, update.value);
  });
  eventSource.onerror = () =>
    notify(navigator.onLine ? "reconnecting" : "offline");
}

export async function initialiseLiveSession() {
  const querySession = new URLSearchParams(window.location.search).get(
    "session",
  );
  const sessionId = querySession || activeSessionId;
  if (sessionId) await connectLiveSession(sessionId, Boolean(querySession));
}

export function subscribeConnection(
  listener: (state: ConnectionState) => void,
) {
  listeners.add(listener);
  listener(connectionState);
  return () => {
    listeners.delete(listener);
  };
}

export function getConnectionState() {
  return connectionState;
}

export function getSessionId() {
  return activeSessionId;
}

export function getDeviceId() {
  return sourceId;
}

export function saveSessionRole(role: string, lane?: number) {
  localStorage.setItem(ROLE_KEY, role);
  if (lane) localStorage.setItem("raceflow.sessionLane", String(lane));
}
