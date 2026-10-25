import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initialiseLiveSession } from "./features/live/liveSession";
import "./index.css";

// Timing Only has an isolated relay and must never hydrate full-event student data.
void (window.location.pathname.startsWith('/timing') ? Promise.resolve() : initialiseLiveSession()).finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
});
