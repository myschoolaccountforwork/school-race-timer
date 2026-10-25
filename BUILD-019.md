# Build 019 — Stage 1 reliable timing capture

Implemented locally on `timer-only`. No push, Render deployment, hosting-setting change, Firebase production change, paid service creation or database introduction was performed.

**Stage 1 captures and delivers timestamps. It does not reconcile volunteer clocks or verify volunteer elapsed times. Physical-phone timing accuracy has not been validated.** This document supersedes the Build 018/clock-fix instructions about using relay receipt as the start or requiring clock sync to capture a finish.

## Chief-controlled workflow

1. Create a Multi-device Timing Only session, normally with eight lanes. Share the existing public HTTPS QR/link. Volunteers select lanes; several can share a lane. They remain joined between attempts/races.
2. Every phone loads the current race-attempt ID and volunteer assignment before racing. The volunteer is armed for that displayed attempt. There is no volunteer Start button, countdown or future start.
3. Chief presses **Start once at the physical starter signal**. The first operation in the capture handler reads `performance.now()`. IDs, local storage and delivery come afterward. The original capture includes a random ID, race-attempt ID, clock-epoch ID and the unchanged monotonic timestamp.
4. Chief timing begins immediately on that phone, even before the relay acknowledges Start. Start is saved in the local capture journal and queued for upload. The relay distributes the exact original `chiefStart` reference in every participant's state snapshot. It does not replace it with receipt time. Polling/network delay can delay notification, not change the original capture.
5. Each Chief lane Finish reads its own local timestamp immediately, saves it and queues delivery. Its elapsed time is `local finish - original local Start`. No network clock synchronisation, connection freshness or global upload busy flag blocks another lane. Stop and Finish all unresolved lanes also capture locally. Finish all samples each unresolved lane in the same handler; these are individual captures, not a promise of identical timestamps.
6. Volunteers can capture Finish while the displayed attempt is ready/armed or running, including poor sync, Chief disconnection and temporarily lost connectivity. Each raw finish is saved locally before upload. It is **Pending verification**, with no calculated/verified race duration in Stage 1.
7. Chief reviews local lane times, selects submitted DNS/DNF/DQ statuses or enters manual corrections/statuses. Raw volunteer timestamps have no official-selection button. Confirm/lock and Next Race wait for the current Chief capture queue to settle and confirmed history to save locally. Race-control mutations still require connection and Chief access.

The existing single-device Timing Only screen remains the fallback. The shared screen retains QR/copy/share, lane selection, multiple volunteers, connection diagnostics, False Start/Reset, correction/status controls, locking, Next Race, saved history and CSV/Excel/PDF exports. Legacy relay operations remain for compatibility, but Build 019's screen provides only original-Chief-tap Start. Marshalling and its transport are unchanged.

## Capture and delivery model

`localCapture.ts` implements a journal separate from the race-control request state. Each raw capture is frozen in memory and persists as immutable data; delivery/error metadata changes separately. The journal uses a new browser-local key scoped to the random session and credential. Existing credential and confirmed-history keys remain unchanged.

Each capture holds only:

- Random capture, race-attempt and clock-epoch identifiers.
- Kind (`start`, `finish`, `stop`), local monotonic timestamp and optional lane.
- Original Chief Start capture ID when known at capture time.
- An optional copy of the current midpoint clock sample (local midpoint, relay timestamp and uncertainty). This is raw evidence only, not reconciliation or a verification guarantee.

Copies of received original Chief Start references are also saved locally. A volunteer capture made before a delayed Start announcement retains its original attempt and missing `startId`; later arrival saves the reference separately and never rewrites the raw finish. Later stages can inspect this evidence. Neither race reassignment nor an elapsed-time guess is performed now.

| Display state | Meaning |
| --- | --- |
| Captured (memory only) | Timestamp exists in this page, but local persistence failed. Do not close/reload. |
| Captured / Saved locally | Original record was successfully written to browser storage; eligible for delivery. |
| Received | Relay acknowledged that exact immutable capture. This does not mean verified timing or human Chief review. |
| Pending verification | Volunteer measurement has not been reconciled. No official elapsed time is derived from it in Stage 1. |
| Upload rejected | Record remains locally with the server error. It is not relabelled Received or silently moved to a new attempt. |

The outbox attempts delivery on a 750 ms timer and on the browser `online` event, with one upload worker per journal. This serialises transport only, never lane capture. Network failures, timeouts, HTTP 408 and HTTP 429 leave saved captures queued. Other HTTP 4xx failures are retained as rejected records with the reason. These require inspection/new-session recovery rather than endless retry. A request can take up to the existing 3.5-second client timeout.

The relay uses the capture ID as the command ID. Repeating the same authenticated ID and payload acknowledges the same record. Changed payloads under that ID are rejected. A second capture ID for the same participant/lane/kind/attempt is rejected. Different volunteers on the same lane retain separate captures.

Chief raw captures compute local lane elapsed values only when Start ID, attempt ID and clock epoch match and timestamps are ordered. They do not overwrite an already corrected result or status. No relay arrival timestamp is used. A new `chief-local` timing source distinguishes these lane values from manual corrections in history/exports. "Official" means selected/confirmed by the Chief; no Stage 1 display claims certified accuracy.

## Attempt isolation, Reset, False Start and locking

- Reset and False Start create new attempt IDs; False Start retains official DNS lanes. Next Race also creates a new attempt and retains volunteer assignments.
- Each tap binds to the attempt displayed at the instant of capture. Delivery never consults the newest race ID to rewrite it.
- The relay remembers known attempt IDs for the session. Late finish records for old attempts are retained as archived raw records, not applied to the current race. Late raw records after locking can be retained but cannot change locked lanes/history. Late Start commands cannot start an old attempt.
- Current snapshots expose current-attempt raw captures; earlier local records and received start references remain in their originating phone's archive. Export before discarding access or browser data.
- A disconnected volunteer cannot know that the Chief has just reset/advanced. Its capture remains on its previously displayed attempt and may consequently be archived rather than usable. This is explicit uncertainty, not an automatic reassignment.

Raw capture receipt is separate from legacy status submissions and official results. There is no raw-to-official reconciliation/selection operation. Chief manual corrections are possible from independent timing evidence; they remain marked manual rather than turning a raw volunteer capture into a verified time.

## Storage failure, reload and clock continuity

The timestamp is taken before synchronous local storage work. Each successful save commits the journal before the upload worker can send it. Storage latency can still delay subsequent browser input handling; physical tests must include a realistically sized journal. This implementation does not claim hardware-level touch timestamps or zero browser scheduling delay.

If writing fails, the new record stays **Captured (memory only)** and cannot upload. A prominent warning and **Retry local saving** control are provided. Another successful save can also persist those unchanged records. Keep the page open and export the raw archive. If reading the existing archive fails or it is malformed, new capture/overwrite is blocked to preserve recoverable data.

Saved/received/rejected records survive reload in the same browser profile. An in-flight upload whose acknowledgement was lost is retried with its original ID/timestamp after reload. A best-effort browser leave warning protects active Chief clocks or memory-only records, but mobile OS termination cannot be prevented.

Every document has a new clock epoch. Visibility changes conservatively interrupt the running Chief clock and create a new epoch, even if a particular device might have maintained its clock. Previously captured intervals remain available. New Chief timed captures after reload/backgrounding are blocked until a new attempt is started; no wall-clock reconstruction is used. Clock rollback similarly invalidates the epoch. Return to the page and reset the attempt if appropriate, or enter independent manual results for every lane. Resolving every lane in a Chief-local race stops it and permits confirmation without inventing missing times.

Volunteer captures after reload/visibility interruption use their new epoch and remain pending; Stage 1 does not claim continuity across those boundaries. The raw journal retains the epoch information for later evaluation.

Chief-only fallback preserves known local lane results and can carry a continuously running Chief-local elapsed interval into the existing single-device screen. If Chief continuity is lost during a running race, fallback refuses to invent a continuation: reset or resolve independent manual results first. Switching fallback ends participation in that shared session where the relay can be reached. Volunteers must be told to stop using it. Raw journal files are retained separately; export them before forgetting the session.

Use one active Chief tab and one volunteer tab per phone. Concurrent tabs are not coordinated local capture writers; server duplicate/permission checks prevent duplicate official mutations but cannot make multiple browser tabs one stopwatch.

## Raw archives and official exports

**Export raw capture archive** downloads JSON containing this phone's retained captures and delivery states, received Chief Start references, random session/participant identity, role and currently received raw captures. It excludes authentication credentials and join capabilities. It is an evidence archive, not an official timing export or an import/reconciliation feature.

The Chief's ordinary CSV/Excel/PDF exports remain based on confirmed official lanes. Build 019 Chief-local races identify the start reference/timing source and explicitly exclude unreconciled volunteer raw timestamps. Legacy records remain supported. Raw volunteer archives are available from their originating phones even after subsequent races; the Chief's current received-capture snapshot does not constitute a permanent archive of all volunteers' earlier data.

## Relay security/privacy and lifetime

No student names, identifiers, dates of birth, event records or generic browser storage are uploaded. The new command accepts only whitelisted capture fields and bounded identifiers, timestamps, lane numbers and clock evidence. Arbitrary student fields are rejected, including inside evidence. Authentication still uses bearer credentials; only Chief credentials can create the original start, stop or change official results. Volunteers can submit raw finishes only for their assigned lane. Snapshot credentials are omitted.

The service remains single-instance, memory-only, with existing CORS, rate limits, 8 KiB request limit, four-hour idle timeout and sixteen-hour absolute lifetime. The provider still processes connection metadata/IP addresses as documented in Build 018. Added raw captures and known-attempt IDs are bounded by the existing session command limit. A relay restart/deployment loses sessions and their in-memory archives. Persisted local records survive but Stage 1 does not automatically recreate/import an expired session or bridge relay clocks across restarts. Export affected records and create a new session/new QR for further racing.

## What remains unfinished

- No four-timestamp clock protocol, drift estimation, confidence-interval reconciliation or verified volunteer duration is implemented.
- The existing diagnostic samples are retained only as evidence. Even a low displayed uncertainty does not change a volunteer's Pending verification state.
- Volunteer screens intentionally show no elapsed stopwatch calculated from message arrival. They show the attempt/start reference and raw capture status. An original Chief Start can be delivered only after Chief connectivity and successful saving/upload; notification is not instantaneous.
- Rejected uploads and ambiguous/missed attempts require inspection. There is no archive import UI, automatic old-session restoration or automatic repair of lost local storage.
- Unsaved records can be lost on page/OS termination. Browser storage can be evicted; export regularly. Storage is localStorage, not a background service worker or guaranteed durable hardware log.
- Chief local captures avoid network-offset error but still have human reaction, touch dispatch, browser scheduling and oscillator errors. A single person timing eight lanes remains operationally challenging.
- Lock, official corrections/status submissions, Reset/False Start and Next Race still need the relay; local capture continues for the currently known attempt during a network interruption.
- There is no claim that software tests establish physical timing accuracy, mobile carrier reliability or certification. Independent reference testing and later reconciliation stages remain necessary before relying on volunteer timing.

## Files changed

- `src/features/timing/localCapture.ts`: immutable journal, storage, queue, retry/receipt, epoch and local elapsed rules.
- `src/features/timing/useLocalCaptures.ts`: independent capture/outbox integration, local race overlay, start-reference archive, lifecycle and export.
- `src/features/timing/RelayTimingScreen.tsx`: immediate Chief Start/finishes, raw volunteer Finish, status/error/recovery UI; relay-start selector removed.
- `src/features/timing/useTimerRelay.ts`: exposes its local animation tick and raw clock evidence; no capture readiness dependency.
- `src/features/timing/relayProtocol.ts`, `timerOnly.ts`: additive raw-capture, original-start and timing-source types.
- `src/features/timing/TimerHistory.tsx`, `timerExports.ts`: provenance and explicit volunteer exclusion for confirmed results.
- `server/timerRelay.ts`: validated local-capture protocol, Chief-local elapsed values, raw archive/attempt isolation and manual recovery.
- `server/localCapture.test.mjs`, `package.json`: Stage 1 tests included in `npm test`.
- `BUILD-019.md`: scope, behavior, deployment and acceptance instructions.

## Local validation and testing

Use Node 24.x on `timer-only`:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:preview
```

For local/LAN development, use the existing `npm.cmd run dev` arrangement. Production frontend builds still use `VITE_TIMER_RELAY_URL` and `VITE_PUBLIC_SITE_URL`; the standalone relay still uses `NODE_ENV=production` and the exact `TIMER_ALLOWED_ORIGINS` allowlist. No new environment variables or dependencies are required.

New automated tests cover clock read before IDs/storage, eight closely spaced finishes during delayed Start acknowledgement, immutable timestamps and disk-before-delivery, lost acknowledgements/reload/retry, duplicate/changed-payload rejection, poor-sync/late-start volunteer capture, old-attempt archival after reset, subsequent race continuity, multiple volunteers per lane, locks, manual DNF/DQ recovery, DNS retention, storage failure/retry/corrupt data, clock interruption, retained start references, permissions and standalone production-mode HTTP capture requests. Physical UI/cellular timing is not established by these tests.

Verification completed: `npm.cmd test` passed all 35 tests; `npm.cmd run lint` passed; `npm.cmd run build` passed with the existing large-bundle warning; `npm.cmd run test:preview` passed its integration test. These are local software checks, not timing-accuracy validation.

## Deployment requirements — manual owner action only

1. Review the diff and this Stage 1 limitation: volunteer finish capture works, but verified volunteer timing is not yet implemented. Authorize or perform any commit/push separately.
2. Pick a rehearsal window with no active races. Deploy the **relay first** from the approved `timer-only` commit using the existing service/configuration. Restarting ends all existing memory sessions.
3. Check the relay `/healthz`, then rebuild/deploy the **staging frontend** from the same commit with its existing HTTPS URL variables. The new frontend requires `localCapture` support; do not release it alone against an old relay.
4. Reload/reopen phones and verify **BUILD 019 - LOCAL CAPTURE**. Forget ended old sessions if necessary; preserve/export confirmed history and raw records first. Create a new Chief session and QR.
5. Complete the physical checklist below. No hosting-plan change, paid service, production Firebase deployment or GitHub-setting change is required or authorized by this document.

## Physical-phone acceptance checklist

- [ ] One Chief and at least two volunteer phones, including two volunteers on one lane, use independent mobile-data connections. Test relevant iOS Safari and Android Chrome versions at the venue.
- [ ] Chief presses Start at the physical starter signal once. There is no relay-receipt Start option or volunteer Start/countdown. All phones receive the same original Start reference, even with deliberately delayed delivery.
- [ ] Chief captures eight closely spaced lane finishes while Start/finish acknowledgements are delayed or connectivity is disabled. Every capture retains its original time and the correct lane; no upload blocks another lane.
- [ ] Volunteer Finish remains usable with poor clock sync and during temporary disconnection for the armed attempt. It shows Saved locally, then Received, always Pending verification; it cannot become an official time.
- [ ] Capture before a delayed Start announcement; reset/false-start while another phone is offline. The raw timestamp remains on the displayed original attempt and is not silently reassigned.
- [ ] Restore connectivity, lose acknowledgements and retry/reload saved captures. Confirm idempotent receipt and original timestamps without duplicates.
- [ ] Exercise local-storage quota/write failure: show memory-only warning, block unsaved uploads, retry saving and export. Do not use a live race for destructive browser-storage tests.
- [ ] Background/reload the Chief during an active race: new timed captures are blocked explicitly; old captures remain, and a new attempt or complete independent manual results permit recovery. Test volunteer new-epoch captures separately.
- [ ] Test every status/correction, False Start DNS retention, Reset, locking, repeated Next Race without rejoining, fallback and raw/official exports. Unreconciled raw volunteer times are absent from official CSV/Excel/PDF.
- [ ] Rehearse relay restart: local archives/confirmed history survive where saved, old sessions fail visibly, and new-session/new-QR recovery works without claiming automatic reconciliation.
- [ ] Compare Chief local intervals with an independent timing reference across race lengths. Measure human input error, missed rapid taps and browser/storage overhead with a realistically sized journal. Record device/network conditions and organiser acceptance thresholds. These measurements do not validate volunteer reconciliation that Stage 1 does not implement.

**Next action:** review/approve the Stage 1 release, then manually release relay before frontend and run this rehearsal checklist. Do not treat Pending verification volunteer records as usable verified race times.
