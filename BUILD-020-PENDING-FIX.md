# Build 020 — intermittent Pending reconciliation investigation

Investigated against the exact local/deployed source commit `c7d50aa` on `timer-only`. No commit, push, deployment, hosting change or Firebase production change was performed. The working tree was clean when this investigation began.

## Findings and confidence

**Test 1 is consistent with the existing uncertainty policy.** Half of the reported Chief/volunteer minimum RTT sum is `(217 + 412) / 2 = 314.5 ms`, before timestamp/drift allowances and intersection of individual evidence intervals. That is the right uncertainty scale for a result around ±315 ms, not grounds to raise the 100 ms limit. Exact reproduction of 18.863 seconds or its bound needs the original four timestamps and selected evidence; the two minimum RTT numbers alone do not determine it.

**Test 2's precise physical cause is not established from the report.** No production URL, per-endpoint reason/epoch diagnostics, raw archive or request trace was available or accessed. With ongoing healthy sampling, waiting 60 seconds does not itself expire the evidence needed for a subsequent Start. A simulated 60-second wait with continuous samples successfully reconciles, and another test with the reported RTTs produces an elapsed value labelled Unverified, rather than a blank Pending result.

In `c7d50aa`, a received result with **no elapsed value** narrows the calculation failure to a missing original Start or zero usable samples for at least one endpoint (or a missing reconciliation object from a mixed/older response). High uncertainty alone does not remove the elapsed value. A count of six retained samples is not proof that any match the particular capture epoch and event window.

Two real defects were confirmed and corrected:

1. **Cross-epoch retention defect (relay).** `ClockEvidence.accept()` sorted the authenticated participant's last 64 samples by client `t1` across different browser clock epochs. After reload, a new document's `performance.now()` starts small. If the previous document had filled the history with large `t1` values, every valid new sample could be immediately evicted despite successful completion responses. A received Finish in that new epoch would then remain Pending with no elapsed value. Retention now uses acceptance order; timestamp ordering remains scoped to a matching epoch during mapping/pinning. Executing the exact `c7d50aa` class against the regression inputs retained **0** new-epoch samples; the correction retains **2**. The 64-sample bound and epoch checks remain.
2. **Lost clock-completion retry gap (frontend).** The client saved a signed sample before posting `clock/complete`, but never retried a failed completion independently. If a sample arrived after the immutable Start capture and its completion was lost, the already-received Start could not acquire that evidence from its original payload. Later probes more than 15 seconds away could not repair the gap even though valid original signed evidence remained in local storage. Clock completion receipts/rejections are now persisted, and an independent retry sends the exact saved sample, without editing the Start/Finish or retaking any timestamp.

The first defect requires a full old history plus a new local timestamp origin; a fresh healthy 60-second session normally has roughly 15–20 exchanges at the reported delays, so that condition is **not proven for Test 2**. The second requires failed/lost completions and insufficient otherwise-received nearby evidence; it is likewise not proven for that physical run. New diagnostics are needed to distinguish these from ordinary clock interruptions, connectivity/storage failures or missing Start delivery.

## End-to-end trace

1. `RelayTimingScreen` calls `useLocalCaptures.capture('finish', lane, ...)`. Its first action reads `performance.now()`. Chief Start and all Chief finishes retain the same immediate local path.
2. `CaptureJournal.add()` binds the immutable Finish to the displayed race-attempt ID, current document clock epoch and known original Start ID. It copies up to four already-collected nearby signed samples. Saving succeeds before the capture is eligible for the outbox.
3. The independent outbox posts `command: localCapture` with the unchanged capture ID/timestamp. Network failures retry; permanent client errors remain rejected locally. No global upload busy condition blocks another Chief lane or volunteer Finish.
4. The relay authenticates the bearer credential, validates the raw capture/attempt/lane and any embedded signed samples, and stores the raw record. It resolves the anonymous volunteer ID from the authenticated participant, rather than an IP address or client-supplied identity. Finish receipt does not imply receipt of Chief Start or successful clock completion.
5. `TimerRelay.snapshot()` recalculates every visible current-attempt volunteer Finish. `reconciliation()` looks up the original Chief Start by the same attempt ID, maps each endpoint using its owner's authenticated same-epoch evidence, and subtracts the intervals. It never substitutes a relay/message arrival time.
6. `clockComplete()` accepts signed evidence, pins evidence for matching owner/epoch captures and increments session revision. The Chief polls approximately every 750 ms after a completed poll. Snapshots are accepted by revision/monotonic server time, so Pending is **not a cached terminal calculation**; it is reconsidered without another Finish tap or manual reconcile command.
7. `VolunteerMeasurement` renders the returned status, calculation/uncertainty and reason. It now renders endpoint diagnostics even when neither elapsed time nor mappings exist. Previously, the detailed evidence section required both mappings, precisely when a missing endpoint most needed explanation.

Chief Start uses only the Chief's original local capture. Chief local lane elapsed times and the independent fallback do not depend on volunteer reconciliation, clock completion retries or network acknowledgements.

## Every calculation path to Pending

| Condition | Why no verified result / recovery |
| --- | --- |
| Original Chief Start has not reached the relay for this attempt | A volunteer can capture on an armed attempt before a delayed Start announcement. Check the Chief Start outbox; receipt of Finish is independent. The original Start arriving later triggers calculation automatically. |
| No authenticated samples for either endpoint's participant | Probes or completions may have failed, been rejected, or never run; local storage failures can prevent completion delivery. New diagnostics distinguish probe count, accepted submissions and last rejection. |
| Samples exist but none match the capture's device epoch | Reload/visibility/rollback starts a different epoch. Old/new origins cannot be substituted; the corrected retention rule prevents the identified eviction defect. Only original matching-epoch evidence can repair an old gap. |
| Matching device samples belong to another relay epoch | A different relay process/session cannot supply interchangeable evidence. A real restart normally ends the session and produces 404/disconnection, not a live recoverable Pending result. Do not mix data across restarted sessions. |
| Matching samples have invalid finite values/order | Rejected samples are not usable evidence. Proper server authentication/validation rejects them; diagnostics distinguish invalid candidate data from empty history. Finish is retained and remains unverified/pending as applicable. |
| All matching valid samples are over 15000 ms from the original event | The age check is relative to capture time, not the current review time. New samples now cannot repair a past gap. Signed original evidence arriving later may recover it. |
| One usable sample, or distinct samples span less than 1000 ms | A provisional calculation may be shown, but there is insufficient evidence to verify. A second distinct nearby sample can resolve it; samples from a different epoch do not count. |

Those paths can remain Pending indefinitely if required original evidence is lost, evicted before pinning, never collected or never delivered. Local/relay histories are deliberately bounded. There is no promise to reconstruct a missing event from wall time or network receipt time.

**High uncertainty, inconsistent intervals, mismatched Start/attempt IDs and a non-positive elapsed interval are Unverified paths, not a reason to invent a Pending elapsed value.** If the UI has no reconciliation object at all, it now explicitly reports missing relay details and asks to check matching frontend/relay versions; it does not pretend the result has merely not been verified yet.

## Sixty seconds, retention and asynchronous behavior

- Sampling normally continues after a successful cycle with a three-second delay. Waiting 60 seconds can improve preparedness, but does not guarantee current same-epoch evidence if a device was backgrounded, reloaded, throttled, disconnected or unable to save/upload.
- Recent histories hold 64 samples, captures embed up to four, and the relay pins up to eight relevant samples/constraints per received capture. Old samples naturally outside the event window are not usable; event-near pinned samples do not become stale just because someone reviews them later.
- Clock and capture requests can arrive in either order. A Finish or Start can be stored before its clock evidence. The code already reconsidered it on later completion/poll; the retry gap prevented some saved evidence from ever arriving. Retrying now repairs that delivery path.
- One queued completion is retried per background sampling cycle concurrently with probing, so a failed retry does not hold up collection or input handling. Successful receipts persist; 408, 429 and network failures remain retryable. Other HTTP 4xx responses are retained as rejected sample receipts with the reason. Samples and original captures are never retimestamped.
- Build 020 journals without receipt metadata remain readable; their retained signed samples can safely replay. The client retains at most 64 samples/associated receipts. A long outage or eviction can still lose evidence; the fix does not create an unlimited archive or cross-restart restoration.
- Epoch changes during an in-flight probe discard that exchange. This is intentional: its endpoints may not be comparable. Retrying an already-saved historical sample is allowed in the same active session even after the page's current epoch changes.
- Diagnostic counters/last-accepted ages change during polling. They are excluded from the reconciliation version hash, so merely opening diagnostics, replaying a receipt or waiting cannot continuously invalidate the Chief's selection. The actual calculation/evidence version is still checked at selection.

## Improved diagnostics

`Clock evidence diagnostics` appears on a Pending result without requiring a calculated time. It reports separately for Chief Start and volunteer Finish:

- Original Start received/missing.
- Capture clock epoch (short random ID), retained sample count, device-/relay-epoch matches.
- Usable event-near samples, stale samples, invalid candidates, nearest matching sample age and nearby sample span.
- Relay-observed probes and accepted sample submissions, age of last acceptance and latest rejection. Counts include duplicate retries and embedded signed evidence; they are not all distinct samples usable for this event.
- Exact reason the endpoint is unavailable/insufficient, and whether original historical evidence is required.

Each phone also shows local signed evidence counts: retained, acknowledged, queued for completion retry and rejected, with the last rejection. Diagnostic marker `020-pending-1` identifies the new relay result format. No bearer credentials, join capabilities, names, student records or IP addresses are added to these messages.

## Regression tests and results

`server/reconciliationPending.test.mjs` adds eight cases:

1. Continuous sampling over a simulated 60-second preparation period, followed by capture and late review.
2. Six samples at the reported 217/412 ms network RTTs: calculated elapsed remains visible and Unverified.
3. A reload after 64 large-timestamp old-epoch samples; two new small-timestamp samples survive and reconcile.
4. Missing Start, missing endpoint, wrong device epoch and stale evidence produce precise diagnostics.
5. Delayed original Start/clock completions automatically reconsider an unchanged raw Finish, even when completion arrives much later.
6. Saved sample receipts persist through reload and allow identical, idempotent retries.
7. Polling diagnostic ages do not alter an otherwise unchanged selection hash.
8. Invalid timestamp and wrong-relay evidence remain ineligible and have separate diagnostic classifications.

`server/chiefScreen.test.mjs` adds an actual two-browser regression: Chief Start is captured before its first probe response, every Chief clock-completion request is lost, volunteer Finish is received and Pending identifies missing Chief evidence. Completions are allowed only after 17 seconds, when fresh probes alone are too late. The durable retry of the original saved samples recovers the result automatically; the original raw Start/Finish and attempt IDs remain unchanged. Existing independent Chief-lane, high-latency, verification/selection and CSV/Excel/PDF browser tests remain.

Required validation commands:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

No tests establish physical timing accuracy or prove which condition occurred in the unrecorded production run. The combined 100 ms policy, 15-second event window, two-sample/one-second minimum, drift allowance and input safeguards are unchanged.

Completed locally: all **61 automated tests** passed, including all three rendered-browser tests; lint passed; production build passed with the existing large-bundle warning. `git diff --check` passed.

## Files changed

- `server/clockEvidence.ts`: arrival-order sample retention, available-evidence inspection and bounded participant clock-health diagnostics.
- `server/timerRelay.ts`: per-endpoint diagnostics, health attachment and stable selection hashes excluding diagnostic-only fields.
- `src/features/timing/reconciliation.ts`: classified Pending reasons and structured event-relative diagnostics; mapping/verification policy unchanged.
- `src/features/timing/localCapture.ts`: backward-compatible persisted clock-completion receipts/rejections and pending sample lookup.
- `src/features/timing/useLocalCaptures.ts`: exact historical sample completion retries and local queue status/archive metadata.
- `src/features/timing/VolunteerMeasurement.tsx`, `RelayTimingScreen.tsx`: Pending diagnostics, version-mismatch message and completion queue counts.
- `server/reconciliationPending.test.mjs`, `server/chiefScreen.test.mjs`, `package.json`: regressions included in the test suite.
- `BUILD-020-PENDING-FIX.md`: this investigation/release report.

## Deployment requirement and next physical diagnostic

**Both relay and frontend need updating.** The relay change fixes epoch retention and supplies endpoint diagnostics; the frontend change retries lost completions and renders those diagnostics. No hosting settings, new environment variables or services are needed.

After separate release authorization, schedule a rehearsal window, deploy the relay first, then the frontend from the same reviewed commit. Restarting the memory-only relay ends old sessions, so export saved records and create a new session/QR. Do not modify Firebase production.

Repeat the two physical tests. If a result remains Pending, record the **reason and both endpoint diagnostic sections**, the local completion queue counts on each device, whether either device reloaded/backgrounded and the original Start ID/attempt ID. Verify `020-pending-1` appears. Check browser network status for `clock/probe`, `clock/complete`, `command` and `state`; a health check alone does not verify those paths. Use the raw evidence archive if a deeper trace is necessary; do not share Authorization headers, join links/capabilities or credential-containing browser storage dumps.

With the same high RTTs, a recovered calculation may correctly remain **Unverified**. That is expected: these fixes restore evidence delivery/diagnosis, not artificially improve timing accuracy.
