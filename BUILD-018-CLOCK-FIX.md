# Build 018 — hosted clock synchronisation fix

Implemented locally on `timer-only`. No push, deployment, hosting-setting change or paid service creation was performed. This document supersedes the Build 018 description of Start readiness. The original physical-phone checklist still applies.

## Cause established from code

The Chief Start button required `relay.synchronised`, in addition to a connected Chief, no busy/pending action, a ready race and at least one unresolved lane. The command sender and relay also required a client-mapped timestamp and uncertainty at most 100 ms for `start`.

Each successful poll measures browser `performance.now()` before fetch and after JSON parsing. The relay snapshot contains Node `performance.now()`. A sample maps the relay timestamp to the local request midpoint:

```
midpoint = (sent + received) / 2
network uncertainty = (received - sent) / 2
estimated relay time at tap = serverTime + tapTime - midpoint
active uncertainty = network uncertainty + sample age * 0.0001
```

The two monotonic clocks have independent origins, which this offset mapping handles. There is no Unix-time versus monotonic-time mismatch in this path. Clock origin differences alone do not prevent sync. The midpoint assumes roughly symmetric paths; server work, response preparation and browser processing are included in observed delay. This is an estimate, not an accuracy guarantee.

Polling waits 750 ms **after** a request completes. The 750 ms wait is not included in that request's round trip. Fetch times out after 3.5 seconds. The lowest-delay sample within the last 15 seconds is selected; samples are not averaged into increasing confidence. Connection success must be less than three seconds old. Once a race is running, its mapping is frozen to avoid jumps, with a 100 ppm drift allowance. A fresh sample is still needed to allow timed actions. Returning from background clears mappings and requires new samples.

Consequently, if every recent round trip exceeds about 200 ms, uncertainty remains over 100 ms and the original Start stays disabled no matter how long someone waits. Drift makes the practical boundary slightly stricter. That is a reproducible design/readiness limitation. The regression test simulates 30 successive 400 ms round trips and reproduces it.

**The exact cause on the deployed phone is not established.** No hosted URL, measured phone traces, response timings or console errors were supplied or accessed. High network delay is consistent with the report, but not proven. Seeing Connected indicates successful authenticated snapshots, not a clock that meets timing limits. Other possibilities must be distinguished with the diagnostics below. Code inspection found no deterministic failure that prevents every valid sample from being recorded.

## Changes

### Explicit start reference

The Chief now chooses between:

- **Relay receipt (internet test)** — default. `startRelay` requires a fresh authenticated connection, Chief permission, ready race and no outstanding action. It does not need a synchronised browser clock. The relay records its own monotonic time while processing this command and rejects any supplied client timestamp or uncertainty. This is an explicit protocol operation, not an automatic fallback from a failed tap capture.
- **Chief tap (requires clock sync)** — retains the original `start` operation, tap capture and all existing timing checks. Use this when testing timing against the physical starter, subject to measured acceptance.

**Relay receipt is not the Chief tap or the physical starter.** Outbound delivery delay shifts the start reference later; subsequent elapsed times can understate physical-start race duration. A fresh connection cannot bound that delay. A confirmation explains this before relay start; the race screen, local history and CSV/Excel/PDF exports retain an internet-test warning. The clock uncertainty shown for finishes does not include physical-start delivery error. The server receipt timestamp itself is authoritative, but the resulting duration must not be described as verified physical-start timing.

The relay-start command is idempotent: retrying a lost acknowledgement returns the original accepted start rather than starting a new clock. An undelivered command can start when it eventually arrives, so wait for authoritative acknowledgement. Do not use phone start display or receipt acknowledgement as a certified swimming start signal.

### Finish safety and diagnostics

The 100 ms limit, 15-second sample window, three-second connection freshness, frozen race mapping, drift allowance, permission checks and timed finish/Stop capture remain. A high-delay connection can now start a relay test while **Finish remains disabled**. This is intentional and exposes the original finish feasibility limitation rather than concealing it. No arrival-time finish fallback was added. Volunteer candidates still require Chief selection, and official corrections/fallback remain available.

The interface displays a concise Start readiness reason and an expandable **Connection and clock diagnostics** panel showing:

- Connection state and age of the last successful response.
- Latest measured round trip and latest sample age.
- Selected low-delay sample age and network uncertainty.
- Active clock uncertainty including drift, frozen race clock age and estimated relay/browser offset.
- Specific reason Finish's clock is blocked and why Start is blocked or ready.
- Poll interval and freshness rules. Transport/API/sample errors remain visible alongside diagnostics.

Invalid or non-finite clock samples now produce an explicit error rather than contaminating selection. Invalid/future samples are excluded by selection. Requests sent before a visibility-change clock reset cannot restore an old clock mapping when their delayed responses arrive. These are defensive corrections; they have not been demonstrated as the cause of this phone report. The initial relay/server origin mapping and limits were not changed to make a slow connection look precise.

Files changed: `server/timerRelay.ts`, `server/timerRelay.test.mjs`, `server/internetRelay.test.mjs`, `src/features/timing/relayClock.ts`, `relayReadiness.ts`, `relayProtocol.ts`, `useTimerRelay.ts`, `RelayTimingScreen.tsx`, `timerOnly.ts`, `TimerHistory.tsx`, `timerExports.ts`, and this document. Marshalling code and hosting configuration are unchanged. New metadata is an anonymous start-reference enum only.

## Diagnostic steps on the hosted phones

1. After manually releasing both components, verify the page header says **BUILD 018 - CLOCK FIX**. Open Multi-device Timing Only and create a new session; do not assume an old tab has new JavaScript.
2. Expand **Connection and clock diagnostics**. Record the exact Start reason, Finish reason, latest round trip, selected uncertainty, sample age and active uncertainty after 30 seconds. Do this on the Chief and each volunteer phone.
3. If round trips remain over 200 ms and selected uncertainty over 100 ms, the retained finish limit explains the block. Waiting does not average the uncertainty down. Compare intended mobile data and Wi-Fi connections and document the difference. A different hosting location may warrant investigation, but no region or hosting change is prescribed or performed here.
4. If samples are missing or stale, record the visible error. Inspect phone browser network/console using remote debugging during rehearsal if available. Check `/api/timer/state` succeeds with JSON containing a finite numeric `serverNow`, and distinguish failed fetch/CORS, 401/403 access, 404 expired/restarted session, 429 throttling and timeouts. A successful `/healthz` alone does not verify authenticated polling or CORS. Never share Authorization headers, localStorage credentials, QR capabilities or unredacted request bodies/screenshots.
5. If the latest round trip is low but selected/active uncertainty is still high, compare the selected sample and frozen race-clock ages. A running frozen mapping can exhaust its drift budget even with fresh polls. Finish stays blocked; use a reference/manual correction or Chief-only fallback as appropriate. Reset only when safe to discard the current attempt.
6. Large positive or negative offset is normal because monotonic origins differ. Abrupt changes following relay restart mean the old session is gone: create a new session and QR. Do not mix timestamps across relay processes.
7. If Start is disabled with low uncertainty, read its specific reason: Chief permission, fresh connection, pending acknowledgement, race readiness or all lanes resolved. With the relay reference selected, client-clock uncertainty alone must not disable Start.

## Manual deployment instructions — only after owner authorization

No new environment variables, dependencies, hosting plans or settings are needed. Existing HTTPS relay URL, frontend origin and exact CORS allowlist remain in use.

1. Review the diff, tests and limitations. Separately authorize or perform the commit/push of `timer-only`. No push was performed for this fix.
2. Choose a rehearsal window with no active races. Manually deploy the **relay first** from the approved commit using its existing `npm run relay` start command. This restarts memory and invalidates live sessions; locally saved confirmed results remain in their browsers.
3. Check the existing relay `/healthz`. Manually rebuild/deploy the **staging frontend** from the same commit with its existing `VITE_TIMER_RELAY_URL` and `VITE_PUBLIC_SITE_URL`. This new frontend needs relay support for `startRelay`; do not ship the frontend alone against the old relay. No production Firebase change is authorized.
4. Reload/reopen every phone and check the CLOCK FIX header. Forget an expired old session if necessary, create a fresh Chief session and share its new QR. Do not clear browser history/storage unnecessarily; it contains confirmed results and credentials.
5. Select Relay receipt, confirm the displayed limitation, and verify it starts while connected even when diagnostics reject finish sync. Verify a pending/lost acknowledgement does not invent a new start time. Verify volunteers cannot start or control official results.
6. Select Chief tap for a separate ready attempt and verify it remains unavailable if clock uncertainty is too high. On a qualifying connection, exercise tap start, independent lane finishes, candidate selection, correction/status, lock, next race, app switching, refresh and exports. Check relay-test labels survive local history and exported files. Run the original physical-phone checklist.
7. If no intended connection meets the unchanged finish threshold, internet finish timing is still not accepted for the event. Collect diagnostics and measure actual error against an independent reference before deciding on a further design change. This fix does not promise that all mobile networks can support the existing accuracy policy.

## Verification and limitations

Automated tests cover the high-delay readiness regression, unrelated monotonic origins, invalid/stale samples, frozen-clock drift, Chief-only relay start, supplied-timestamp rejection, idempotent start acknowledgement, actual standalone HTTP relay start, start-reference retention in confirmed history, and continued rejection of uncertain timed finishes/Chief lane stops. Existing multi-lane, permissions, next-race, expiration and timer tests remain.

Verification completed locally: `npm.cmd test` passed all 23 tests; `npm.cmd run lint` passed; `npm.cmd run build` passed. The build reports a large JavaScript bundle warning and plugin timing notices. These software tests do not establish timing accuracy, carrier behavior, physical-device operation or actual TLS/network performance. A relay-receipt start specifically changes what instant is measured; it does not solve physical-start alignment.
