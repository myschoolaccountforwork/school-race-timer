# Build 017 — Multi-device Timing Only (local relay pilot)

Implemented locally. **Separate physical phones have not been tested.** This is not deployed and is not yet validated for a school meet.

## Audit of the previous implementation

| Component | Finding / reuse |
| --- | --- |
| Build 016 `TimingOnlyScreen`, `timerOnly.ts` | Lane results, positions with ties, locked local history, CSV/PDF/Excel retained. Shared `TimerHistory` and `timerExports` now serve both modes. |
| Chief Timekeeper / Lane Timekeeper | Useful control and layout patterns, but their data model requires queued student heats; kept unchanged. They use wall-clock time and shared browser storage, so were not reused for authoritative timing. |
| `liveSession.ts` and Vite live middleware | A real HTTP POST + SSE transport exists, backed by in-process maps. It can exchange updates between devices that reach that Vite server. It is not just localStorage, but it has no Chief permission boundary, broadcasts every `raceflow.*` key, and merges whole result maps. No physical-device verification was found. |
| QR / Join | QR library reused. Existing full-event join flow assumes one volunteer per lane and event metadata; unchanged. New Timing Only join path supports multiple anonymous volunteers per lane. |
| Production output | `dist/` contains browser assets, **not a relay server**. The relay is registered for Vite development and preview only. Static hosting alone cannot connect devices. |

The old full-event transport remains in place. The narrow shared changes exclude `raceflow.timerOnly.v1` from outgoing/incoming generic live updates, skip full-event hydration when initially loading a `/timing` route, and use `getRandomValues` for device IDs so LAN HTTP does not depend on HTTPS-only `randomUUID`. Existing full-event roles and marshalling logic were not changed.

## Minimum infrastructure and boundaries

One school-approved computer must run a single Node/Vite process and stay awake. Chief and volunteers must reach its same origin through shared Wi-Fi or an approved private network, with firewall permission and no Wi-Fi client isolation. An internet connection is not required for that LAN; cellular phones cannot reach a private LAN host unless network routing is arranged.

The new `/api/timer/*` relay uses **memory only**: no Firebase, Supabase, external signalling, cloud database or new dependencies. It accepts lane numbers, anonymous capabilities, race controls, times and statuses. It never reads full-event localStorage. Arbitrary command fields are rejected. Confirmed history is saved only in the Chief browser under Build 016's existing key. Participants receive neither Chief credentials nor other volunteers' tokens.

This is an optional local pilot. It is not a hardened public backend: it has bearer capabilities rather than named accounts, single-process memory, basic size/session/participant limits, same-origin checks and no multi-instance coordination. Anyone with the join link can volunteer. Session credentials live in tab sessionStorage; refresh retains them, but closing the Chief tab can lose access. Idle sessions expire after four hours, and any relay restart loses all live state and volunteer connections. Confirmed browser history survives.

LAN HTTP exposes traffic to the trusted network. An approved HTTPS endpoint/reverse proxy, network access controls, service lifecycle, security review and retention rules must be arranged before public/production use. Nothing has been published, deployed or pushed. No persistent backend has been introduced.

## Run locally

Use Node 24+ for the TypeScript-based test runner.

```powershell
npm.cmd run dev
```

Or serve the production client build with the local preview relay:

```powershell
npm.cmd run build
npm.cmd run preview -- --host 0.0.0.0
```

Open the Chief device using the host's reachable LAN address and the port printed by Vite, for example `http://192.168.1.50:5173/timing`. Do not generate a phone join link using `localhost` or `127.0.0.1`: those addresses point to each phone itself. The UI warns about this. No firewall or network settings have been changed by this build.

## Workflow

1. Open **Timing Only → Multi-device Timing Only**. Choose 1–10 lanes and create a session.
2. Display its QR or copy/select its join link. Join capabilities are in the URL fragment, not a query sent to the server. Each volunteer selects a lane; several may share it. No names are requested.
3. Connection status uses authenticated polling at roughly 750 ms plus request latency. The Chief sees per-volunteer heartbeats: connected under four seconds, reconnecting under eight, disconnected thereafter. Volunteers also see whether the Chief is still present.
4. Start on the Chief. Every device estimates the same relay start in its own monotonic clock. Volunteers tap the large **Finish** button, or submit DNS, DNF or DQ. One immutable candidate per volunteer per race is allowed; later changes go through the Chief. Lane assignments remain for the session.
5. Chief Finish records a lane independently, and **Finish all unresolved lanes** records one common instant for all remaining official lanes. **Stop clock** ends timing without inventing missing finishes. Volunteer candidates never overwrite official results. The Chief selects a candidate or enters a corrected time/status. Corrections may be made while other lanes are running.
6. Stop, resolve every official lane, then confirm and lock. Unselected candidates are not official. Next Race is enabled only after the confirmed race has been saved locally. Saving failures display a message and retry while connected. Existing confirmed history is merged by race ID, retaining Build 016 records. Exports include the official results.
7. Next Race retains volunteers and lanes. Reset and False Start generate fresh attempt IDs; False Start retains official DNS lanes.

No submissions are recorded using a new timestamp after reconnection. A captured but unacknowledged action can be retried with its exact ID/time; the relay acknowledges it idempotently. A new second submission from the same volunteer is rejected. Race IDs, assigned lanes, locks and Chief permissions are checked at the relay. A finish captured before Stop can arrive after Stop only if its time is within that stopped race; new Finish clicks are disabled after Stop. Old attempt submissions are rejected after reset or Next Race. Refresh does not retry unknown actions automatically: the authoritative snapshot shows what arrived.

**Use Chief-only fallback** saves the last received official lane results locally and moves back to Build 016 controls. If the shared race was running, its estimated elapsed time continues using the Chief's monotonic page clock. It closes the relay session if reachable and discards its Chief credentials. If unreachable, the old relay will reject volunteer submissions after the Chief heartbeat expires (up to eight seconds); tell volunteers to stop using it. Results not yet received or not selected as official are not imported into fallback. If the clock itself is suspect after device sleep, reset and rerun the race. Single-device mode is available even if no relay can be reached.

## Timing method and accuracy limitations

- Relay time uses Node `performance.now()`. Browser capture and animation use browser `performance.now()`, not changing wall clocks. A four-hour idle timeout also uses monotonic relay time. Dates are for confirmation labels only.
- Each authenticated state/command round trip measures local send and receive times. The response's relay timestamp is associated with their midpoint; half the round-trip time is a network uncertainty estimate. The lowest-delay sample from the last 15 seconds is preferred.
- The race's clock mapping is frozen once running, so later sync samples cannot jump the running clock. A page visibility change invalidates the mapping and requires resynchronisation. Refresh also resynchronises. The UI adds a 100 ppm drift allowance to the frozen estimate; that allowance is an engineering assumption, not measured hardware accuracy.
- Fresh transport status is required (last successful poll under three seconds). Finish/timed Chief actions require fresh clock samples and an estimated uncertainty no larger than 100 ms. Finish captures the tap time before the HTTP request. Chief Start/Stop/lane finishes send their captured relay-time estimate too, avoiding simply treating network arrival as the event time. A timed Chief action not processed within five seconds is rejected as expired unless it was already accepted and is being acknowledged again.
- Polling affects how soon a start, stop or lock appears (typically up to one polling interval plus transit), not by deliberately adding that interval to a finish timestamp. The initial start display can therefore appear late. Volunteers must watch the physical starter/finish, not use the phone display as an official start signal.
- Healthy-LAN clock alignment within tens of milliseconds is a design target, **not a measured result or guarantee**. Half-RTT assumes roughly symmetric paths. Device scheduling, touch handling, clock drift, browser timer precision, packet loss, OS sleep and human reaction add error. Millisecond display does not imply millisecond accuracy. This is manual school timing, not certified electronic/photo-finish timing.
- Build 016 now uses a monotonic epoch anchored once per page. Recovering an active single-device race after refresh still depends on wall-clock epoch recovery. Do not adjust system clocks during a recovered race.

Browser clock background: [MDN performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now). LAN ID compatibility: [MDN crypto.randomUUID secure-context restriction](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID).

## Verification and remaining acceptance

Automated checks:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:preview
```

Tests cover ranking/status rules, correction parsing, monotonic local time under wall-clock changes, ID generation, history merging without losing unfinished local races, midpoint clock estimates, sample expiry, multiple volunteers per lane, candidate selection, Chief permissions, session isolation, duplicate/idempotent actions, stale attempt IDs, locked results, Next Race continuity, lost Chief presence, bad clock samples, delayed Chief captures, relay expiry/restart, and independent HTTP clients. `npm.cmd run test:preview` (after building) checks the real production-preview route and relay wiring. HTTP tests are on one computer and do **not** establish physical-device operation.

Before meet use, test at least one Chief device and two physical phones (including two volunteers on one lane) on the intended school network. Verify QR reachability; start/finish display and measured timing error against a reference; Chief and volunteer finish capture; all statuses, corrections and candidate choice; lock/Next Race; airplane mode, Wi-Fi loss and acknowledgement retry; background/sleep/resume; refresh; false-start stale submissions; Chief fallback; relay restart; quota failures; local history recovery; and every export. Test iOS Safari and Android Chrome as applicable. Record measured error and acceptable thresholds before claiming cross-device timing works.
