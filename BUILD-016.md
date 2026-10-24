# Build 016 — Timer Only

Open **Timing Only** from the RaceFlow home screen (`/timing`). This mode runs on one device and uses its own `raceflow.timerOnly.v1` local storage entry, separate from marshalling and event timing data.

1. Select 1–10 lanes and mark any DNS lanes.
2. Start, then tap each lane's Finish button as the athlete finishes. Timing stops automatically when all lanes have a time or status; Stop also ends timing manually.
3. After stopping, record missing statuses or use Correct time / status. Corrections accept seconds or `mm:ss.mmm`. DQ, DNS and DNF do not receive positions. Equal millisecond times share positions using competition ranking (1, 1, 3).
4. Confirm & lock results, then select Next Race. Confirmed results cannot be edited or reset.
5. Export individual races or all confirmed races as CSV, Excel or PDF from the history section.

Reset clears the current unconfirmed race. False Start clears its times and retains DNS lanes. Both ask before clearing results. A stopped race cannot resume; use Reset or False Start to restart it.

Race actions and confirmed history are saved locally. A running race recovers from its stored start timestamp after refresh. Clearing browser data removes these records; export copies for retention. A local saving failure displays a warning and prevents confirmation from locking unsaved results.

Validation:

- `npm.cmd run build`
- `npm.cmd run lint`
- `node --test src/features/timing/timerOnly.test.mjs`

