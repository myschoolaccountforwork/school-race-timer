# RaceFlow Build 018 — Internet multi-device Timing Only

Implemented on `timer-only`. Nothing deployed, purchased, pushed, or changed in Firebase or GitHub settings. Physical phones and timing accuracy have **not** been validated. Deployment and the checklist below remain necessary before meet use.

## 1. Summary of changes

- Standalone Node 24 HTTP relay, independent of Vite, with `/healthz`, bounded request timeouts and automatic memory cleanup. Render terminates public HTTPS; its private connection to Node uses HTTP.
- Frontend uses a separately configured HTTPS relay origin. Chief creates the session, displays/copies/shares a QR join link, manages every lane independently and exports from their phone. No venue laptop or shared network is needed once both services are hosted.
- Existing multiple volunteers per lane, candidates, official selection/corrections, DNS/DNF/DQ, locking, next race, false start, Chief fallback and exports retained. Full-event/marshalling code and its existing transport are unchanged. The new relay serves **only** `/api/timer/*`; it is not a replacement for the full-event transport.
- Credentials now survive refresh, app switching and reopening the same browser using localStorage. Existing Build 017 tab credentials migrate when opened. Join links contain only session ID and join capability, never the Chief token.
- Strict request-field allowlists, exact production origin allowlist, request size and traffic limits. Memory-only sessions expire after four hours idle or sixteen hours total, even with ongoing polling.
- Production join links require public HTTPS origins. Missing/invalid production relay configuration fails visibly rather than using a development server. LAN QR addresses remain available in development only.
- Connection failures disable fresh timing actions. Unacknowledged actions are marked unverified and can retry their original capture; volunteers never write official results. Confirmed history remains in the Chief browser when browser storage is available.

## 2. Files changed

- `server/relayServer.ts`: standalone server, health check, scheduled cleanup, startup configuration.
- `server/timerRelay.ts`: production CORS, validation, traffic limits and maximum lifetime.
- `server/internetRelay.test.mjs`: standalone HTTP integration, permissions, lifecycle, configuration and QR tests.
- `server/timerRelay.test.mjs`: creation fixture updated for strict schemas; existing coverage retained.
- `src/features/timing/relayUrls.ts`: relay URL and safe join-link configuration.
- `src/features/timing/useTimerRelay.ts`: configurable relay endpoint and availability messages.
- `src/features/timing/RelayTimingScreen.tsx`: persistent credentials, migration, sharing, recovery control and Build 018 guidance.
- `src/features/events/TimingOnlyScreen.tsx`: Build label and link text only.
- `src/features/events/TimingOnlyScreen.css`: narrow-screen controls and wrapping.
- `package.json`, `package-lock.json`: relay/test commands and Node runtime constraint; no new dependencies.
- `tsconfig.node.json`: type-check standalone server.
- `render.yaml`, `.env.example`, `BUILD-018.md`: deployment template, configuration and this guide.

## 3. Local testing

Use Node 24.x and run from this repository on `timer-only`:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:preview
```

For local/LAN testing, run `npm.cmd run dev`, then open `http://<computer-LAN-IP>:5173/timing/multi` on the Chief phone. Volunteers use the generated LAN link on the same network. This is development testing only; internet operation uses the hosted addresses below. Do not set production variables for this same-origin development mode. Remove any `.env.local` production URL values before testing the local relay.

To exercise the standalone process locally, run `npm.cmd run relay` in a second terminal (default port 8787). `http://localhost:8787/healthz` should return `{"ok":true}`. The automated standalone tests connect directly over HTTP with a production HTTPS Origin header, including CORS preflight; this verifies protocol behavior, not real TLS or phone browsers. The preview test checks Vite preview wiring, not a venue hosting arrangement.

## 4. Frontend deployment — owner action after approval

Use a separate staging Static Site on Render first; leave the production Firebase website alone. No Firebase configuration or CLI deployment has been added.

1. Review these changes and approve hosting and any costs. Commit/push `timer-only` yourself, or explicitly authorize that separately. No push has been performed here.
2. In Render, create a **Static Site** from this repository, branch `timer-only`, root at the repository root. Disable automatic deployment. Give it a staging name distinct from production.
3. Set build command `npm ci && npm run build`, publish directory `dist`, and Node version `NODE_VERSION=24`.
4. Obtain its public HTTPS address. Configure a rewrite from `/*` to `/index.html`, status **200** (rewrite, not redirect), so `/timing/multi` and `/timing/join` open directly.
5. Deploy the relay as described below, allowing exactly this frontend origin.
6. Set frontend build environment `VITE_TIMER_RELAY_URL=https://<your-relay>.onrender.com` and `VITE_PUBLIC_SITE_URL=https://<your-staging-site>.onrender.com`. Use origins only: no path, trailing slash, token or query. The public-site helper rejects literal IP addresses, localhost and `.local` names. Use a real public DNS name.
7. Manually build/deploy the frontend. Vite variables are embedded at build time: rebuild after changing either value. Never put Chief or volunteer credentials in environment variables.
8. Open `https://<your-staging-site>.onrender.com/timing/multi` on a phone. Create eight lanes and scan the QR with another phone using mobile data. Inspect the displayed join URL: it must be the public frontend origin, not the relay origin or a LAN address.
9. Complete the physical tests below. Any later deployment to the production Firebase website requires separate approval and the existing website's deployment process; this guide does not authorize it.

## 5. Relay deployment — owner action after approval

The `render.yaml` template describes a **paid Starter** single-instance service to avoid depending on an idle-sleeping service. It is a reviewable template, not an instruction to purchase automatically. Review current provider costs before approving.

1. After approval and an authorized push, create a Render **Web Service** from this repository, branch `timer-only`. Alternatively, import `render.yaml` as a Blueprint after reviewing its service/cost settings.
2. Runtime: Node. Root directory: repository root. Build: `npm ci`. Start: `npm run relay`. Set **exactly one instance**. Do not add a database or disk. Disable automatic deployments; a deployment restarts memory and ends active sessions.
3. Set `NODE_VERSION=24`, `NODE_ENV=production`, `TIMER_ALLOWED_ORIGINS=https://<your-staging-site>.onrender.com`. A comma-separated list can allow additional approved HTTPS frontend origins; do not use `*`, paths or trailing slashes. Startup rejects missing production origins.
4. Let Render provide `PORT`; the process binds to `0.0.0.0`. Set health-check path `/healthz`.
5. Manually deploy and copy the public **HTTPS** service origin. Visit `/healthz` at that origin and confirm `{"ok":true}`. Set that origin in the frontend's `VITE_TIMER_RELAY_URL`, then rebuild the frontend.
6. Test joining across independent connections. If browser requests fail, check exact origin spelling, frontend build values, CORS preflight and service health. Do not fix CORS with a wildcard.
7. Before the carnival, verify the selected plan remains running, choose a deployment freeze and assign someone to monitor service availability. Never scale horizontally: sessions do not replicate between processes. Restarts, health recovery, provider maintenance and deploys lose all sessions.

Provider references: [Render web services](https://render.com/docs/web-services), [Blueprint specification](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks), [Node version configuration](https://render.com/docs/node-version).

## 6. Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_TIMER_RELAY_URL` | Frontend build | Required for production multi-device mode. Public HTTPS relay origin. Unset in local same-origin development. |
| `VITE_PUBLIC_SITE_URL` | Frontend build | Recommended canonical public HTTPS frontend origin for QR links. If absent, production uses current origin only if it passes the same public HTTPS checks. |
| `NODE_VERSION` | Hosting build/runtime | `24`; native TypeScript stripping runs the relay without Vite or a compilation server. |
| `NODE_ENV` | Relay runtime | `production` enables mandatory exact origin allowlisting. |
| `TIMER_ALLOWED_ORIGINS` | Relay runtime | Required in production, comma-separated exact HTTPS frontend origins. |
| `PORT` | Relay runtime | Provided by Render; standalone local default `8787`. |

`.env.example` is a template. For local production builds, copy frontend values to `.env.local` (ignored by Git). Runtime relay settings belong on the service. There is no persistent database, shared secret environment variable, or Firebase setting for this timing service.

## 7. Security and privacy

The timing frontend sends only the following fields, never student records or generic event storage:

- Creation: lane count and race number. Relay generates random session ID, Chief capability and volunteer join capability.
- Join/preview: random session ID, join capability, lane number and a random anonymous volunteer credential. Volunteer IDs are random; no names or accounts are requested.
- Authentication: bearer credential in Authorization header. State polling places a random session ID in a URL query. QR join capability is in a URL fragment, which browsers do not send as an HTTP request path or referrer.
- Commands: random command/race IDs, action, optional lane, elapsed milliseconds/status, captured monotonic timestamp, clock uncertainty and selected submission ID.
- In-memory state: anonymous volunteers/last-seen timestamps, race numbers/IDs, lane results/status/corrections, start/stop/elapsed times, confirmation date, candidates, confirmed anonymous race history, command fingerprints for idempotency, session lifetime and connection heartbeats.
- Technical metadata: the Node process temporarily uses socket IP addresses for traffic limits. The hosting provider/CDN/network necessarily processes client IPs, timestamps, TLS/HTTP connection metadata, origins, paths, user agents and potentially access logs. Provider retention and region are subject to its settings/policy and school approval. The application does not log request bodies, credentials or timing results; configure provider logging to avoid Authorization/body collection. Do not claim hosting metadata is anonymous or memory-only.

Unknown fields are rejected on every POST endpoint and command; JSON bodies are limited to 8 KiB. Arbitrary callers can still *send* prohibited data over the network, but it is not accepted into session state. Never enter identifying records in this mode. The unrelated full-event workflow retains its pre-existing behavior and is not routed through this relay.

Chief capabilities use Node cryptographic random UUIDs; volunteer secrets use browser cryptographic random bytes. Only the Chief credential can control races, select/correct/lock official results, advance or close. Snapshots omit all credentials. Join links authorize anonymous participation and can be forwarded: treat them as event access links. CORS restricts browser origins, not direct scripts; server-side capabilities enforce permissions independently.

Limits: 100 sessions, 100 volunteers/session, 20,000 accepted commands/session; 240 requests/minute/credential, 30,000 requests/minute/socket IP and 10 session creations/minute/socket IP. Socket IPs behind a hosting proxy may be shared; forwarded IP headers are deliberately not trusted. Rate buckets expire after one minute, are removed during traffic and are capped at 10,000 entries. Large shared deployments can hit shared proxy limits. These are abuse mitigations, not protection from a distributed denial-of-service attack.

Sessions are pruned at least every minute in the standalone service and also on access. Expiration is four hours without successful activity or sixteen hours absolute. Polling counts as activity. Restart/deploy loses memory immediately; credentials cannot resurrect it. Use **Forget session / create a new one** after an ended session, then share a new QR. During a temporary outage the existing credentials automatically reconnect to the same still-active session.

Chief and lane credentials persist in localStorage on their original browser profile. Use one active Chief tab and one lane tab per volunteer phone; concurrent Chief tabs share authority. Treat the Chief phone/browser as an access credential. Clearing storage, private browsing cleanup, device loss or changing frontend origins loses recovery access. Browser script compromise could read credentials. **Forget session** removes this phone's Chief access but does not revoke the old session; Chief-only fallback attempts to close the old relay session and preserves known official results locally.

Confirmed results are merged into existing Chief-local history before Next Race is enabled. Confirmed results already saved remain available even if the relay restarts. Local storage can be evicted or cleared; export regularly. A race lost before confirmation/receipt is not guaranteed recoverable after restart. Do not assume an unacknowledged finish reached the relay; reconnect and inspect authoritative state or retry the exact action. A volunteer candidate requires explicit Chief selection before it is official. A displayed received candidate means the relay accepted it, not that a human Chief has reviewed it.

## 8. Known limitations and verification

- Software tests do **not** validate timing accuracy, real TLS, mobile carriers, battery life or real phone operation. No physical-device acceptance is claimed.
- Mobile latency/asymmetry, browser scheduling, touch reaction, OS background suspension and sleep can invalidate clock estimates. Timed actions require fresh connectivity and estimated uncertainty at most 100 ms; some mobile links will not qualify. The 100 ppm drift allowance and half-round-trip uncertainty are engineering estimates, not measured guarantees. Watch the physical starter, not the delayed phone start display. See Build 017 for the retained clock method.
- Keep phones awake in the foreground and powered. Backgrounding can disconnect them; return to the original tab and wait for fresh sync. Chief absence beyond eight seconds prevents volunteer submissions until Chief reconnects.
- The relay is one process with no durable recovery, failover or offline volunteer timing. Unacknowledged captures survive only in the current page until resolved, not page closure. Refresh retrieves accepted results but does not invent/replay unknown captures.
- A lost create response may leave an unused session until expiration; retry creates a new one. Browser storage failure can prevent credential recovery.
- Public-origin checks reject literal IPs and local hostnames, but cannot prove that a DNS name resolves publicly or that school networks allow access. Check the actual deployed QR on mobile data.
- The production build retains the existing large JavaScript bundle warning. Allow the site to load before racing.

Automated coverage includes production-mode standalone creation/join, preflight and forbidden origins, eight Chief lanes, several volunteer finishes, all Chief-only actions, candidate/official separation, Chief reconnection with the same credential, next-race continuity, stale captures, QR URL rules, idle/absolute expiration, restart, malformed/unknown/oversized fields, incorrect access and traffic limits. Existing timer, export-input/history, clock and relay tests remain included.

Local verification: `npm test` passed all 21 tests; `npm run lint` passed; `npm run build` passed with the existing large-bundle warning; `npm run test:preview` passed its integration test. These checks were run on one computer and do not establish timing accuracy or physical-phone acceptance.

## 9. Physical-phone acceptance checklist

Use at least one Chief phone plus two volunteer phones; test relevant iOS Safari and Android Chrome versions. Run on deployed HTTPS staging addresses with independent mobile data and mixed Wi-Fi/mobile data.

- [ ] Chief creates eight lanes entirely on their phone. QR/copy/native share opens the public frontend on another phone; no Chief credential appears in the link.
- [ ] Two volunteers join the same lane; another lane also submits. Volunteers remain assigned through several confirmed Next Race cycles.
- [ ] Chief independently finishes all eight lanes; also exercise Finish all, Stop, corrections during running, candidate selection, ties, DNS/DNF/DQ, Reset and False Start.
- [ ] Unselected candidates never become official. Lock prevents edits; Next Race waits for local saving. Export CSV/PDF/Excel and reopen the files.
- [ ] Refresh/reopen the Chief tab and return after switching apps; recover the active session and confirmed history. Refresh volunteers and verify lane continuity without entering names.
- [ ] Toggle airplane mode and drop Wi-Fi during racing. Clear disconnected/unsynchronised state appears; Finish is disabled and no disconnected capture is shown as verified. Restore connectivity and inspect accepted results/retry the exact pending action.
- [ ] Background/sleep/resume each phone; verify clock resync. Test Chief absence beyond eight seconds, delayed responses and stale submissions after reset/next.
- [ ] During rehearsal only, restart the relay: old sessions fail clearly, saved Chief results survive, and a new session/new QR works. Exercise Chief-only fallback and tell volunteers to stop using the old session.
- [ ] Check 320–360 px screens, portrait/landscape, QR sizing, finish target, correction dialog, link selection and daylight readability.
- [ ] Measure actual error against a suitable independent timing reference over repeated race-length trials. Record phones, networks, conditions and acceptance thresholds. Obtain organizer acceptance; do not equate displayed milliseconds or software tests with accuracy validation.
- [ ] Rehearse with charged batteries/power banks, reference/manual fallback, exported results and no venue laptop/shared Wi-Fi. Resolve failed checks before relying on this at the carnival.

**Next owner actions:** review and approve the staging frontend/relay hosting arrangement and costs; authorize a push/deployment if desired; follow sections 4–5; complete this checklist well before the meet. Approve any production Firebase change separately.
