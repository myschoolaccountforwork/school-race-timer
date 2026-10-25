# Build 019 — Chief Start/Finish interface investigation

## Confirmed findings

The working-tree Chief interface at `/timing/multi` is `src/features/timing/RelayTimingScreen.tsx`, routed by `src/App.tsx`. It already contains one local Chief Start action, eight Chief lane Finish buttons, local Stop and Finish all. There is no relay-receipt Start button or start-reference selector in that working-tree screen.

At the start of this investigation, the latest local commit was `983bd22` (`Build 018 fix hosted clock synchronisation`). Build 019 Stage 1 changes, including its new capture modules, were still uncommitted. That committed Build 018 screen does render **Start at relay**, matching the reported phone interface. Its handler calls `relay.command('startRelay')`; the relay records its processing time. Its Finish controls require `relay.synchronised` and share the old busy/pending restrictions.

This establishes a local source/commit version mismatch and explains exactly how the older interface behaves. The reported relay-start label cannot be rendered by the current Build 019 working-tree screen. **The precise hosted cause is not established:** no deployed site URL or Render deployment metadata was supplied or inspected. An older deployed commit, another site/route, or an older loaded/cached frontend must be distinguished using the checks below. A successful health check does not identify the frontend bundle version.

The Build 019 current local path is:

1. Start click calls `local.capture('start', undefined, relay.clockEvidence)`.
2. `useLocalCaptures.capture()` immediately reads `performance.now()` before validation, journal IDs, storage or delivery.
3. The journal preserves the original timestamp and saves it locally before the outbox delivers `action: 'localCapture'`.
4. The local race overlay begins running immediately, without a relay acknowledgement. `usableStart` identifies the original Start in the current uninterrupted Chief clock epoch.
5. Each lane button calls `local.capture('finish', lane, relay.clockEvidence)`. It is disabled only if there is no usable local Start, the race is not running, or that lane already has a result/status. Clock synchronisation, network busy/pending and connection freshness are not in this button's disabled expression.
6. The outbox may serialise uploads, but it never serialises Chief input capture. Volunteer raw records remain Pending verification, with no raw-to-official selection route.

No missing handler or sync-gating defect was reproduced in this current screen. The application label was made explicit: **Chief Start (physical signal)**. This is the same single local Start action; no second Start, countdown, scheduled start or relay-receipt start option was added.

## Changes for this investigation

- `src/features/timing/RelayTimingScreen.tsx`: rename the existing local Start button to **Chief Start (physical signal)**. Its handler and capture/readiness safeguards are unchanged.
- `server/chiefScreen.test.mjs`: actual rendered-screen browser regression test, using the real React route/hooks and real local relay. It does not mock the capture hook or replace the component with a test screen.
- `package.json`, `package-lock.json`: add `playwright-core` as a development-only dependency; include the browser regression in `npm test` and provide `npm run test:ui`.
- `BUILD-019-UI-FIX.md`: this report and manual version-verification instructions.

The earlier Stage 1 changes were already present when this investigation began and remain in the working tree. No commit, push, deployment or hosting-setting change was performed. Existing unrelated files were left alone.

## Rendered-screen regression

The test runs headless Microsoft Edge with a 390 × 844 viewport. It starts Vite and the actual timer relay locally, then:

1. Opens `/timing/multi` with a fresh browser profile and creates a session through the rendered button.
2. Delays every state response by 450 ms, deliberately keeping clock samples outside the existing 100 ms uncertainty policy.
3. Checks that no **Start at relay** control exists and that the intended Chief physical-start button is enabled.
4. Clicks that button, records the actual journal Start, and withholds its relay acknowledgement.
5. Confirms all eight Chief Finish buttons are enabled despite insufficient clock sync and the outstanding Start upload.
6. Clicks Lane 1, Lane 2 and Lane 3 consecutively, confirming each capture has a unique ID, the same original Start/attempt/epoch and an independently retained monotonic timestamp.
7. Checks all four records are saved locally while the acknowledgement is still withheld.
8. Releases delivery, checks all records become Received without changing raw timestamps, and verifies the relay lane elapsed values equal the local finish-minus-original-start differences.
9. Confirms the relay did not substitute a receipt timestamp and that the page raised no uncaught browser errors.

This tests UI wiring and state transitions, not touch accuracy, actual mobile carrier behavior or physical timing accuracy. Volunteer verification remains unfinished Stage 1 behavior; no timing safeguards were relaxed.

## Running the tests

Use Node 24 and run `npm.cmd ci` after reviewing the development dependency change. The browser test uses an installed Edge browser by default; it downloads no browser automatically. On a machine without Edge, set `RACEFLOW_TEST_BROWSER` to an installed Chromium-compatible browser executable before running it. The test fails rather than silently skipping if no suitable browser can be launched.

```powershell
npm.cmd run test:ui
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

The frontend/relay deployment build does not run browser tests automatically, and `playwright-core` introduces no browser requirement at the venue.

Validation completed locally: the dedicated rendered-screen test passed; `npm.cmd test` passed all 36 tests including that browser test; `npm.cmd run lint` passed; `npm.cmd run build` passed with the existing large-bundle warning. `git diff --check` also passed. These results do not establish physical timing accuracy.

## Verify the hosted version before racing

1. Confirm the phone's full URL is the intended **staging frontend** and ends in `/timing/multi` for the Chief. The relay's `/healthz` URL is a different service.
2. Check the page header. New code must show **BUILD 019 - LOCAL CAPTURE** and **Chief Start (physical signal)**. Seeing **Start at relay** means an older/different frontend is still loaded; there is no separate hidden local Start to find in that older screen.
3. In Render, inspect the latest successful **frontend deployment's source commit**. Compare it with an approved commit that actually includes `localCapture.ts`, `useLocalCaptures.ts`, the `localCapture` relay protocol and the Build 019 screen. The existing local `983bd22` commit does not include Stage 1. Selecting branch `timer-only` alone does not publish uncommitted working-tree changes.
4. Commit/push Stage 1 plus this test/label change only after separate authorization, or perform those actions yourself. Nothing in this investigation publishes them.
5. In a rehearsal window with no active races, manually release the matching relay **first**, then rebuild/release the frontend from the same approved commit. Relay restart ends memory-only sessions. Do not change the production Firebase site as part of these staging checks.
6. Reload/reopen the phone after checking local records are saved/exported. If the new header is still absent, verify the correct frontend deployment/URL and compare in a fresh browser tab/profile; do not clear saved race results just to diagnose a bundle version.
7. Create a new session and verify the intended single Chief Start, independent lane finishes, and Pending verification volunteer records. Complete the physical-phone checklist in `BUILD-019.md` before relying on the system.

No change to clock thresholds, volunteer verification, hosting plans or marshalling is required for this UI investigation.
