import type { RelayCredentials } from './relayProtocol.ts';
import type { TimerRace } from './timerOnly.ts';
import { complete } from './timerOnly.ts';

export function startDisabledReason(input: {
  role?: RelayCredentials['role']; connected: boolean; chiefConnected: boolean;
  busy: boolean; pending: boolean; race: TimerRace | null; synchronised: boolean;
  reference: 'relay' | 'tap';
}): string {
  if (input.role !== 'chief') return 'Only the Chief may start a race.';
  if (!input.connected || !input.chiefConnected) return 'Waiting for a fresh authenticated relay connection.';
  if (input.busy || input.pending) return 'Waiting for the previous action to be acknowledged.';
  if (!input.race) return 'Waiting for race state.';
  if (input.race.state !== 'ready') return 'Race must be ready; reset or advance after confirmation.';
  if (complete(input.race)) return 'All lanes already have results or statuses.';
  if (input.reference === 'tap' && !input.synchronised) return 'Chief-tap start requires a fresh clock within 100 ms uncertainty. See clock diagnostics.';
  return '';
}
