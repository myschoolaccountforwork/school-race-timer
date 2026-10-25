# Build 020 — Volunteer time reconciliation

Implemented locally on `timer-only`. No commit, push, Render deployment, hosting-setting change, production Firebase change, paid service or database was created.

**Verified means the calculated elapsed interval meets the application's 100 ms clock policy under explicit assumptions. It does not mean certified or physically validated swimming timing.** Physical testing of Build 019 established capture/delivery operation; it did not establish the accuracy of this new reconciliation implementation.

## Behavior

- Chief still presses **Chief Start (physical signal)** once at the starter's signal. The original `performance.now()` capture is unchanged. No volunteer Start, countdown, future start or relay-receipt start has been added.
- Chief lane finishes remain immediate local captures, saved before delivery. All eight lanes are independent of network acknowledgements and synchronisation readiness.
- Volunteer Finish remains enabled for the armed/running attempt even with poor synchronisation or temporary disconnection. It captures the original local timestamp and retains the same capture/attempt/clock-epoch IDs through saving, upload and retries.
- Both Chief and volunteer clients collect authenticated four-timestamp evidence in the background. The relay maps the Chief's original Start and volunteer's original Finish into its common monotonic clock domain and subtracts their intervals. Message arrival never becomes either event timestamp.
- Volunteer results show calculated elapsed time and a conservative uncertainty where available, plus **Pending verification**, **Unverified** or **Verified (clock policy)**. Raw captures are retained in all cases. Calculations can improve as additional nearby evidence arrives, without changing the raw timestamp.
- Chief can explicitly select a verified result for the correct lane/attempt. Unverified/pending results have a disabled selection control, and the server independently rejects attempts to select them. Nothing automatically becomes official.
- Corrections, statuses, multiple volunteers per lane, False Start/Reset, locking, next races, reconnection, local confirmed history and exports remain. Marshalling and its transport are unchanged.

## Four-timestamp protocol

The existing authenticated `/api/timer/*` service gains:

1. `POST /api/timer/clock/probe`: body contains random session ID, local clock-epoch ID and `t1` (client send timestamp).
2. The relay records `t2` at middleware entry, before body parsing/authentication, and `t3` before preparing the response. The response echoes the epoch and `t1`, adds a random probe ID and relay-process epoch, and includes an HMAC proof covering those fields and the authenticated participant. Credentials are not echoed.
3. The client captures `t4` immediately after the response is read/parsed. JSON processing, browser scheduling and HTTP/CORS overhead remain in the observed exchange rather than being silently excluded.
4. The completed signed sample is saved locally, then sent to `POST /api/timer/clock/complete` using the same bearer credential. The relay validates the signature, participant, epoch, field allowlist, finite/order/bounds checks and duplicate semantics before accepting it as evidence.

Each session has a randomly generated signing secret held only in relay memory. No environment secret or new dependency is required. Both endpoints inherit the existing exact-origin CORS rules, 8 KiB request limit, authentication and request rate limits. Server-issued timestamps cannot be edited or reused under another participant/session without failing validation. A relay restart produces a different process epoch and loses the session; evidence is not bridged into a new session.

Sampling runs immediately after joining/creation and waits three seconds after each completed exchange. Probe and completion run independently of capture/outbox controls. At least two distinct samples spanning one second are needed near **each** event. Typical clean startup therefore needs several seconds of evidence collection, but lack of evidence never disables Start/Finish capture.

The four-timestamp exchange is based on the offset/delay structure in [RFC 5905 section 8](https://www.rfc-editor.org/rfc/rfc5905.html#section-8). This is an application protocol over HTTP, not an implementation claiming NTP's accuracy or its hardware/OS timestamping.

## Calculation and policy

For local event timestamp `x`, server-minus-client offset is constrained by non-negative one-way delivery times. Before allowances, the mapping interval is:

```text
lower relay time = x + t3 - t4
upper relay time = x + t2 - t1
network round trip ≈ (t4 - t1) - (t3 - t2)
```

The mapping widens each bound using its distance from the corresponding local endpoint, an assumed **100 ppm maximum device-to-relay rate difference**, and a **2 ms timestamp-placement/precision allowance**. The 100 ppm engineering allowance is retained from earlier builds; neither it nor the 2 ms allowance has been validated across physical phone/browser combinations. They are model assumptions, not measured guarantees.

Samples must have matching device and relay epochs and a midpoint within **15 seconds of the original capture**. This freshness test is relative to the event, not the time someone later reviews or selects it. Saved historical evidence can therefore support a delayed upload; a fresh sample hours after an event cannot masquerade as evidence near that event. Individual exchanges over ten seconds or with invalid ordering are rejected.

Valid projected intervals are intersected. The code does not divide uncertainty by sample count or average away persistent asymmetry. Inconsistent intervals yield Unverified. Retained evidence includes the tightest lower/upper constraints, temporal endpoints and low-delay samples, so a contradictory high-delay sample cannot disappear just because later low-delay samples fill the bounded recent history.

Diagnostics report estimated clock offset, sample age, minimum network round trip, and the observed offset slope in ppm with its uncertainty. The slope can be biased by changing network asymmetry; it is diagnostic and does not replace the conservative 100 ppm projection allowance with an artificially precise fitted drift.

If Start maps to `[Smin, Smax]` and Finish maps to `[Fmin, Fmax]`:

```text
elapsed interval = [Fmin - Smax, Fmax - Smin]
displayed elapsed = rounded midpoint of that interval, in milliseconds
uncertainty = largest distance from that rounded midpoint to either bound
```

The uncertainty includes integer-time rounding and is rounded **upward** to 0.001 ms for consistent CSV/Excel serialization. This decimal representation is not a claim of microsecond accuracy. The interface displays the uncertainty rounded upward to whole milliseconds.

Policy `raceflow-020-total-100ms-v1` permits verification only when:

- The original Chief Start exists and matches the capture's attempt and any captured Start ID.
- Both endpoints have sufficient authenticated evidence in matching epochs.
- Their intervals are consistent and establish a positive elapsed time.
- **Combined elapsed uncertainty is at most 100 ms.** It is not 100 ms independently for each phone, and the threshold has not been raised to make mobile data qualify.

High latency does not necessarily prevent calculation, but can prevent verification/selection. For example, two persistent 400 ms network round trips can contribute about 400 ms combined uncertainty before allowances. Repeated similarly asymmetric samples do not make that disappear. Smaller asymmetric delays can yield a biased point estimate whose full interval still covers the true value under the model; that is why the uncertainty must remain visible.

The relay common clock is a coordinate system for comparing captures. It is not a certified physical time reference. Human reaction, physical starter-to-tap error, touch dispatch delay, browser/OS behavior and absolute oscillator accuracy are not established by this calculation. Standard browser monotonic clocks also require explicit treatment of execution/continuity boundaries: see [W3C High Resolution Time](https://www.w3.org/TR/hr-time-2/).

## Pending, unverified, verified and official

| State | Meaning and behavior |
| --- | --- |
| Captured / Saved locally | Original timestamp is locally retained; unsaved captures still cannot upload. |
| Received | Relay acknowledged the capture. Receipt is independent of verification. |
| Pending verification | Start or sufficient matching, nearby clock evidence is missing/stale. Where possible, a provisional calculated interval is shown. Later authenticated historical/nearby evidence may resolve it. |
| Unverified | A calculated uncertainty exceeds policy, evidence is inconsistent, the attempt/Start is mismatched, or a positive duration cannot be established. Raw timestamp and available calculation remain visible. |
| Verified (clock policy) | The current calculation meets this model's explicit requirements. It is eligible for Chief selection, not automatically official or physically certified. |
| Official selection | Chief explicitly selected the server-verified current calculation/version for that lane. The selected number and its proof/provenance are frozen rather than silently following subsequent estimates. |

`selectCapture` is Chief-only and rechecks verification, capture/lane/attempt identity and the reconciliation version hash at the server. If evidence changed between display and selection, the request is rejected with a review message; review the refreshed calculation and select again. A client cannot send an elapsed value or uncertainty to bypass this check.

Later contradictory evidence flags a selected result for review. Before confirmation, the server blocks locking until the affected lane is reselected under sufficient evidence or manually corrected. After locking, the official time is not rewritten or automatically unlocked; the current race/history/export is flagged **Unverified - review required** for an organiser's audit. Connected Chief-local history refreshes these review flags while preserving the locked numbers and original selected proof. Previously downloaded files cannot be retroactively updated; export again after a flagged change. No automatic amendment workflow was added to locked history.

Manual corrections/status choices clear volunteer verification metadata and are marked manual. Selecting DNS/DNF/DQ through the existing review workflow does not turn them into verified stopwatch captures. The single-device fallback likewise clears verification metadata when a result/status is edited there.

## Independent Chief fallback and exports

Chief Start and lane Finish capture functions have no dependency on four-timestamp success or upload acknowledgements. The raw local journal and its existing retry/duplicate/epoch safeguards remain. Even a delayed Chief finish arriving after a volunteer selection is retained as an independent Chief fallback; it does not overwrite that selection.

The shared screen displays an independent Chief-local value where recorded. Switching to Chief-only fallback prefers those values over volunteer selections in an unconfirmed race, preserves manual statuses/corrections and confirmed history, and leaves a disputed selection unresolved if no Chief value is available. A running, continuous Chief-local timer is anchored correctly in the existing single-device clock domain even though the relay's legacy `startedAt` field is deliberately null for Chief-local starts. Reload/background continuity loss still blocks inventing a running continuation.

Official CSV/Excel/PDF exports contain only official lanes and include source, verification/review state, selected uncertainty, policy ID, capture/Start/reconciliation IDs, evidence IDs and the independent Chief fallback where present. PDFs include readable source/verification/uncertainty/policy/capture details; CSV/Excel retain the full evidence-ID columns. Unselected pending/unverified volunteer captures remain in raw archives, not official result rows.

**Export raw capture archive** also includes retained signed clock samples, original captures and received Start references, plus currently received reconciliations. It contains random session/participant IDs and proof metadata, not bearer credentials, join capabilities or student records. There is no archive import or cross-session recovery feature.

## Persistence, reconnection and limits

- Captures and up to 64 recent signed clock samples persist in the existing local journal schema; legacy Build 019 journals without clock samples still load. Original captures are never edited to attach later evidence.
- New captures embed up to four already collected signed nearby samples. Their signatures let the same active relay validate them after delayed delivery even if their separate completion request was lost. Delayed/duplicate capture uploads retain their original IDs and timestamps.
- The relay keeps 64 recent samples per authenticated participant and pins at most eight relevant samples/constraints per received capture. It retains evidence near historical events through next races within the same memory-only session.
- Old Build 019 captures without signed evidence can remain Pending indefinitely; their old unsigned midpoint estimate is not promoted into authenticated evidence. If the same live epoch has sufficient new samples within the event window they may reconcile, otherwise an independent Chief/manual result is required.
- Epoch changes from reload, visibility interruption or rollback prevent evidence from a different clock context being mixed with a capture. Probe responses spanning an epoch change are discarded. Previously saved captures/evidence remain available for review.
- Existing session expiration (four hours idle/sixteen hours absolute), rate/command limits, single-instance requirement and restart data loss remain. Clock exchanges are memory-only and use the existing per-credential traffic limit. Do not deploy or scale during active sessions.
- Invalid signatures/schemas reject the evidence/capture request rather than forging a measurement. The outbox retains rejected originals locally with the reason. Inspect/export those records; there is no silent retimestamp or attempt reassignment.
- Browser storage failure still leaves new unsaved captures/evidence memory-only, blocks unsaved capture delivery and exposes retry/export controls. Browser storage eviction or OS termination can lose unsaved data. Keep timing pages awake and foregrounded.

Authentication and HMAC protect access and the server-issued part of the exchange. **They cannot attest that a participant honestly reported its client clock/tap timestamps.** Cooperating devices, browser timestamp behavior and the stated drift assumptions remain part of this manual timing model. This is not tamper-proof electronic timing.

## Privacy and security

The relay receives anonymous random IDs, lane numbers, original monotonic captures, four clock timestamps, epoch IDs, HMAC proofs, timing statuses and official-result/review metadata. Every new endpoint/sample/capture has strict field validation; arbitrary student fields are rejected. No names, dates of birth, student identifiers, event records or generic student storage are introduced into the timing relay.

The service remains memory-only. Hosting/CDN infrastructure still processes IPs, HTTP/TLS metadata and potentially access logs as documented in Build 018. Do not log request bodies/Authorization or treat provider metadata as memory-only anonymous application data. HTTPS and the exact production CORS allowlist remain required. No new persistent cloud storage or provider service is required.

## Files changed

- `src/features/timing/reconciliation.ts`: pure four-timestamp interval mapping, diagnostics, policy and elapsed reconciliation.
- `server/clockEvidence.ts`: authenticated/signed server evidence, bounded recent history and pinned constraints.
- `server/timerRelay.ts`: probe/completion endpoints, reconciliation snapshots, verified-only selection, proof/version checks, review flags and independent Chief backup.
- `src/features/timing/localCapture.ts`, `useLocalCaptures.ts`: signed sample persistence/collection, immutable embedded evidence, archive and fallback continuity.
- `src/features/timing/relayProtocol.ts`, `timerOnly.ts`: calculation/provenance/selection types.
- `src/features/timing/VolunteerMeasurement.tsx`, `RelayTimingScreen.tsx`, `TimerHistory.tsx`: state/uncertainty/reason diagnostics, verified-only selection and audit warnings.
- `src/features/timing/timerExportRows.ts`, `timerExports.ts`: shared testable official export rows and CSV/Excel/PDF provenance.
- `src/features/events/TimingOnlyScreen.tsx`: manual edits in fallback clear inherited volunteer verification metadata. Marshalling is unchanged.
- `server/reconciliation.test.mjs`, `server/chiefScreen.test.mjs`, `package.json`: reconciliation/model/authentication and real rendered browser/export tests.
- `BUILD-020.md`: this implementation, policy, limitation and release guide.

## Validation

Run with Node 24:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:preview
```

The existing Edge/Chromium UI test requirements from Build 019 remain: installed Edge by default, or `RACEFLOW_TEST_BROWSER` pointing to an installed compatible Chromium executable. No new dependencies or automatic browser download were added.

Tests cover successful reconciliation across independent origins, persistent high latency, opposing asymmetric paths, missing/stale/single/wrong-epoch samples, drift estimates, discontinuity and contradictory evidence retained beyond the recent-history cap, authenticated signatures/owner isolation, raw preservation through delayed/duplicate uploads, multiple close volunteer finishes, reset/next-race continuity, official selection/version checks, corrections, locked review warnings, exact exported times and conservative uncertainty, and independent Chief fallback.

Deterministic synthetic trials vary asymmetric delays and clock rates within the assumed model and compare calculated intervals against independently calculated true event times. They validate the model implementation, not that real phones satisfy its assumptions.

The rendered two-browser test joins the actual app/relay, forces a high-delay volunteer link, captures an unverified Finish, confirms official selection is disabled, then supplies better nearby evidence. It verifies the unchanged raw capture becomes clock-policy verified, can be explicitly selected and locked, and downloads actual CSV/Excel/PDF files with matching official time/provenance. The existing eight-Chief-lane/no-acknowledgement regression remains included.

Local results: `npm.cmd test` passed all **52 tests**, including both rendered-browser scenarios; `npm.cmd run lint` passed; `npm.cmd run build` passed with the existing large-bundle warning; `git diff --check` passed. These checks do not establish physical timing accuracy or validate the model assumptions on mobile phones.

## Deployment — manual owner action only

1. Review this diff, policy assumptions and test results. Commit/push only after separate authorization or perform those actions yourself; none was performed here.
2. Choose a rehearsal window with no active races. Deploy the **relay first** from the approved `timer-only` commit. The new frontend needs `clock/probe`, `clock/complete`, signed-sample validation and `selectCapture` support. Relay restart ends old memory sessions.
3. Check the relay `/healthz`, then rebuild/deploy the **staging frontend** from the same commit with the existing `VITE_TIMER_RELAY_URL` and `VITE_PUBLIC_SITE_URL`. The relay keeps its existing `NODE_ENV=production`, exact `TIMER_ALLOWED_ORIGINS` and provider `PORT`. No new environment variables/settings/plans are required.
4. Reopen/reload phones and confirm **BUILD 020 - VOLUNTEER RECONCILIATION**. Export existing results/evidence first; create a fresh session/new QR after the relay restart. Avoid mixed Build 019/020 clients: old clients do not collect the new evidence.
5. Before starting a test race, let both devices collect at least two clock samples. Chief Start/Finish remains usable without waiting, but insufficient pre-Start evidence may leave volunteer results Pending until suitable nearby evidence arrives or permanently if the window is missed.
6. Complete the physical acceptance tests below. Do not change the production Firebase site or hosting settings as part of this staging release without approval.

## Physical acceptance before carnival use

- [ ] One Chief phone plus multiple volunteers on independent mobile-data/Wi-Fi connections; include the actual iOS Safari/Android Chrome versions and a separate PC if used. Test the intended venue/carriers under congestion.
- [ ] Exactly one Chief physical-signal Start. Verify all participants share the same original Start ID and no message-arrival timestamp or volunteer Start is used.
- [ ] Chief captures all eight closely spaced finishes while uploads/synchronisation are delayed or offline. Compare original local captures and independent fallback values; no acknowledgement may block another lane.
- [ ] Compare calculated volunteer durations against an independent timing reference of known better accuracy, across repeated race lengths. Record signed error, spread, worst errors, missed captures and whether the claimed intervals cover observed system timing errors. Separate clock/transport tests from human reaction/input tests.
- [ ] Define organiser acceptance thresholds before trials. Measure/assess the 100 ppm and 2 ms model assumptions on intended devices, including timer precision and background behavior. Displayed milliseconds, software verification and agreement between phones alone do not establish physical accuracy.
- [ ] Deliberately induce high/asymmetric latency. Capture must stay enabled, calculated uncertainty must remain visible, and out-of-policy results must be unselectable. Verify recovery with better nearby evidence without changing raw timestamps.
- [ ] Capture before a delayed Start announcement, lose connectivity, retry, and deliver after reset/False Start. Confirm attempt/epoch isolation, no duplicates and no reassignment.
- [ ] Background/sleep/reload, browser storage failure, sample gaps and relay restart. Confirm clear Pending/Unverified states and independent Chief/manual fallback. No wall-clock/receipt-time invention is allowed.
- [ ] Select a verified result, introduce inconsistent evidence, and verify pre-lock confirmation is blocked. If already locked, verify review/audit warnings and exported review state without a silent official time change.
- [ ] Exercise multiple volunteers on one lane, manual corrections and all statuses, locking, repeated Next Race without rejoining, raw archives and official CSV/Excel/PDF exports. Confirm manual edits never retain a verified-volunteer label.

If intended mobile links cannot meet the combined policy, their volunteer measurements remain visible but unverified. Use the Chief's independent local timing or independent manual references; do not increase the threshold or call those results verified to make the workflow pass.
