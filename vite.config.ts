import { defineConfig, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { timerRelayMiddleware } from "./server/timerRelay.ts";

interface LiveClient {
  id: string;
  response: import("node:http").ServerResponse;
}

interface LiveUpdate {
  sessionId: string;
  key: string;
  value: string | null;
  sourceId?: string;
}

const sessionState = new Map<string, Map<string, string>>();
const sessionClients = new Map<string, Set<LiveClient>>();

function json(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

function readBody(request: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > 2_000_000) reject(new Error("Request too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function liveSessionMiddleware(): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/live/events") {
      const sessionId = url.searchParams.get("session");
      if (!sessionId) return json(response, 400, { error: "Missing session" });

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();

      const client: LiveClient = { id: randomUUID(), response };
      const clients = sessionClients.get(sessionId) ?? new Set<LiveClient>();
      clients.add(client);
      sessionClients.set(sessionId, clients);
      response.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
      request.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(client);
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/live/state") {
      const sessionId = url.searchParams.get("session");
      if (!sessionId) return json(response, 400, { error: "Missing session" });
      return json(
        response,
        200,
        Object.fromEntries(sessionState.get(sessionId) ?? []),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/live/update") {
      try {
        const update = JSON.parse(await readBody(request)) as LiveUpdate;
        if (!update.sessionId || !update.key.startsWith("raceflow.")) {
          return json(response, 400, { error: "Invalid update" });
        }

        const state = sessionState.get(update.sessionId) ?? new Map<string, string>();
        if (
          (update.value === null && !state.has(update.key)) ||
          (update.value !== null && state.get(update.key) === update.value)
        ) {
          return json(response, 200, { ok: true });
        }
        if (update.value === null) state.delete(update.key);
        else state.set(update.key, update.value);
        sessionState.set(update.sessionId, state);

        const payload = JSON.stringify(update);
        sessionClients.get(update.sessionId)?.forEach((client) => {
          client.response.write(`event: update\ndata: ${payload}\n\n`);
        });
        return json(response, 200, { ok: true });
      } catch {
        return json(response, 400, { error: "Invalid JSON" });
      }
    }

    next();
  };
}

function liveSessionPlugin() {
  const middleware = liveSessionMiddleware();
  return {
    name: "raceflow-live-session",
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(middleware);
    },
  };
}

const timerRelay = timerRelayMiddleware();
export default defineConfig({
  plugins: [react(), {
    name: 'raceflow-timer-only-relay',
    configureServer(server) { server.middlewares.use(timerRelay); },
    configurePreviewServer(server) { server.middlewares.use(timerRelay); },
  }, liveSessionPlugin()],
});
