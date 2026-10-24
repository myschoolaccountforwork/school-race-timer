// Stable within this page even if the operating-system wall clock is adjusted.
// Refresh recovery necessarily uses the persisted epoch and the new page's wall clock.
const epochBase = Date.now() - performance.now();
export function localRaceNow() { return epochBase + performance.now(); }
