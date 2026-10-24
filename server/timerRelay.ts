import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { complete, newRace } from '../src/features/timing/timerOnly.ts';
import type { TimerRace, ResultStatus } from '../src/features/timing/timerOnly.ts';
import type { RelayCommand, RelaySnapshot, Submission, Volunteer } from '../src/features/timing/relayProtocol.ts';

interface Participant extends Volunteer { token: string }
interface Session {
  id: string; chiefToken: string; joinToken: string; revision: number; race: TimerRace;
  volunteers: Participant[]; submissions: Submission[]; history: TimerRace[];
  chiefLastSeen: number; touched: number; commands: Map<string, string>;
}
export class RelayError extends Error {
  code: number;
  constructor(message: string, code = 409) { super(message); this.code = code; }
}
const requireThat: (condition: unknown, message: string, code?: number) => asserts condition = (condition, message, code) => {
  if (!condition) throw new RelayError(message, code);
};
const statuses = new Set<ResultStatus>(['', 'DNS', 'DNF', 'DQ']);
export class TimerRelay {
  sessions = new Map<string, Session>();
  clock: () => number;
  constructor(clock = () => performance.now()) { this.clock = clock; }
  prune() {
    for (const [id, session] of this.sessions) if (this.clock() - session.touched > 4 * 60 * 60 * 1000) this.sessions.delete(id);
  }
  create(laneCount: number, number = 1) {
    this.prune();
    requireThat(Number.isInteger(laneCount) && laneCount >= 1 && laneCount <= 10, 'Choose 1-10 lanes.', 400);
    requireThat(Number.isInteger(number) && number > 0, 'Invalid race number.', 400);
    requireThat(this.sessions.size < 100, 'Relay session capacity reached.', 503);
    const session: Session = { id: randomUUID(), chiefToken: randomUUID(), joinToken: randomUUID(), revision: 0,
      race: newRace(number, laneCount), volunteers: [], submissions: [], history: [], chiefLastSeen: this.clock(), touched: this.clock(), commands: new Map() };
    this.sessions.set(session.id, session);
    return { sessionId: session.id, token: session.chiefToken, joinToken: session.joinToken, role: 'chief' as const };
  }
  get(id: string) {
    this.prune();
    const session = this.sessions.get(id);
    requireThat(session, 'Session ended or relay restarted. Ask the Chief for a new link.', 404);
    return session;
  }
  join(id: string, joinToken: string, lane: number, token: string) {
    const s = this.get(id);
    requireThat(joinToken === s.joinToken, 'Invalid join link.', 403);
    requireThat(Number.isInteger(lane) && lane >= 1 && lane <= s.race.laneCount, 'Invalid lane.', 400);
    requireThat(typeof token === 'string' && /^[a-f0-9]{48}$/.test(token), 'Invalid volunteer token.', 400);
    const existing = s.volunteers.find(p => p.token === token);
    if (existing) { requireThat(existing.lane === lane, 'Already joined another lane. Leave before changing lanes.'); existing.lastSeen = this.clock(); }
    else {
      requireThat(s.volunteers.length < 100, 'Volunteer capacity reached.', 503);
      s.volunteers.push({ id: randomUUID(), lane, token, lastSeen: this.clock() }); s.revision++;
    }
    s.touched = this.clock();
    return { sessionId: id, token, role: 'lane' as const };
  }
  preview(id: string, joinToken: string) {
    const s = this.get(id);
    requireThat(joinToken === s.joinToken, 'Invalid join link.', 403);
    return { laneCount: s.race.laneCount };
  }
  snapshot(id: string, token: string): RelaySnapshot {
    const s = this.get(id);
    const chief = token === s.chiefToken;
    const self = s.volunteers.find(p => p.token === token);
    requireThat(chief || self, 'Session access denied.', 403);
    if (self) self.lastSeen = this.clock(); else s.chiefLastSeen = this.clock();
    s.touched = this.clock();
    return structuredClone({ sessionId: id, revision: s.revision, serverNow: this.clock(), race: s.race,
      volunteers: s.volunteers.map(({ id, lane, lastSeen }) => ({ id, lane, lastSeen })),
      submissions: chief ? s.submissions : s.submissions.filter(r => r.volunteerId === self!.id),
      history: chief ? s.history : [], chiefLastSeen: s.chiefLastSeen, selfId: self?.id });
  }
  command(id: string, token: string, command: RelayCommand) {
    const s = this.get(id);
    const chief = token === s.chiefToken;
    const volunteer = s.volunteers.find(p => p.token === token);
    requireThat(chief || volunteer, 'Session access denied.', 403);
    requireThat(command && typeof command === 'object', 'Invalid command.', 400);
    const allowed = new Set(['id', 'raceId', 'action', 'lane', 'milliseconds', 'status', 'submissionId', 'uncertainty', 'at']);
    requireThat(Object.keys(command).every(key => allowed.has(key)), 'Unexpected command fields.', 400);
    requireThat(typeof command.id === 'string' && /^[a-f0-9-]{16,100}$/.test(command.id), 'Invalid command ID.', 400);
    requireThat(command.status === undefined || statuses.has(command.status), 'Invalid status.', 400);
    requireThat(command.milliseconds === undefined || command.milliseconds === null || (Number.isSafeInteger(command.milliseconds) && command.milliseconds >= 0), 'Invalid milliseconds.', 400);
    requireThat(command.lane === undefined || (Number.isInteger(command.lane) && command.lane >= 1 && command.lane <= s.race.laneCount), 'Invalid lane.', 400);
    requireThat(command.submissionId === undefined || (typeof command.submissionId === 'string' && /^[a-f0-9-]{16,100}$/.test(command.submissionId)), 'Invalid submission ID.', 400);
    requireThat(command.uncertainty === undefined || (Number.isFinite(command.uncertainty) && command.uncertainty >= 0), 'Invalid clock uncertainty.', 400);
    requireThat(command.at === undefined || (typeof command.at === 'number' && Number.isFinite(command.at)), 'Invalid timestamp.', 400);
    const fingerprint = JSON.stringify({ token, command });
    const prior = s.commands.get(command.id);
    if (prior) { requireThat(prior === fingerprint, 'Duplicate command ID with different data.'); return this.snapshot(id, token); }
    requireThat(command.raceId === s.race.id, 'Stale race: this result belongs to an earlier start.');
    requireThat(s.commands.size < 20000, 'Session command limit reached. Create a new session.', 503);
    if (command.action === 'submit') {
      requireThat(volunteer && !chief, 'Only lane volunteers submit candidate times.', 403);
      requireThat(this.clock() - s.chiefLastSeen < 8000, 'Chief disconnected. Wait for reconnection.');
      requireThat(s.race.state !== 'confirmed', 'Results are locked.');
      requireThat(!s.submissions.some(r => r.raceId === s.race.id && r.volunteerId === volunteer.id), 'Already submitted for this race. Ask the Chief to correct it.');
      requireThat(command.lane === volunteer.lane, 'Submission lane does not match assignment.', 403);
      requireThat(statuses.has(command.status!), 'Invalid status.', 400);
      const ms = command.milliseconds;
      if (command.status === '') {
        requireThat(s.race.startedAt !== null && (s.race.state === 'running' || s.race.state === 'stopped'), 'Race is not running.');
        requireThat(typeof command.uncertainty === 'number' && command.uncertainty >= 0 && command.uncertainty <= 100, 'Clock sync is too uncertain. Ask the Chief to record this lane.');
        const end = s.race.state === 'stopped' ? s.race.elapsed : this.clock() - s.race.startedAt;
        requireThat(Number.isInteger(ms) && ms! >= 0 && ms! <= end + command.uncertainty + 10, 'Finish time is outside this race.', 400);
      } else {
        requireThat(ms === null, 'Status submissions must not include a time.', 400);
        requireThat(command.status !== 'DNF' || s.race.state !== 'ready', 'DNF requires a started race.');
      }
      s.submissions.push({ id: command.id, raceId: s.race.id, volunteerId: volunteer.id, lane: volunteer.lane,
        milliseconds: ms ?? null, status: command.status!, uncertainty: command.status ? 0 : command.uncertainty! });
    } else {
      requireThat(chief, 'Only the Chief may control races or official results.', 403);
      this.chiefCommand(s, command);
    }
    s.commands.set(command.id, fingerprint); s.revision++; s.touched = this.clock();
    return this.snapshot(id, token);
  }
  chiefCommand(s: Session, c: RelayCommand) {
    const race = s.race;
    if (c.action === 'next') {
      requireThat(race.state === 'confirmed', 'Confirm this race before Next Race.');
      s.race = newRace(race.number + 1, race.laneCount); s.submissions = []; return;
    }
    requireThat(race.state !== 'confirmed', 'Results are locked.');
    let eventTime = this.clock();
    if (['start', 'stop', 'stopLane', 'stopAll'].includes(c.action)) {
      requireThat(typeof c.at === 'number' && Number.isFinite(c.at) && typeof c.uncertainty === 'number' && c.uncertainty >= 0 && c.uncertainty <= 100, 'A fresh synchronised clock is required.', 400);
      requireThat(c.at <= eventTime + c.uncertainty + 10 && eventTime - c.at < 5000, 'Timing action expired. Check the race before retrying.');
      eventTime = c.at;
    }
    const elapsed = () => Math.max(0, Math.round(eventTime - race.startedAt!));
    const lane = race.lanes.find(l => l.lane === c.lane);
    switch (c.action) {
      case 'start':
        requireThat(race.state === 'ready' && !complete(race), 'Race is not ready to start.');
        race.startedAt = eventTime; race.state = 'running'; break;
      case 'stop':
        requireThat(race.state === 'running', 'Race is not running.');
        race.elapsed = elapsed(); race.state = 'stopped'; break;
      case 'stopLane': case 'stopAll': {
        requireThat(race.state === 'running', 'Race is not running.');
        requireThat(c.action === 'stopAll' || lane, 'Invalid lane.', 400);
        const ms = elapsed();
        for (const l of race.lanes) if ((c.action === 'stopAll' || l === lane) && l.milliseconds === null && !l.status) l.milliseconds = ms;
        if (complete(race)) { race.state = 'stopped'; race.elapsed = ms; }
        break;
      }
      case 'reset': case 'falseStart': {
        const next = newRace(race.number, race.laneCount);
        if (c.action === 'falseStart') next.lanes = next.lanes.map(l => race.lanes[l.lane - 1].status === 'DNS' ? { ...l, status: 'DNS' } : l);
        s.race = next; s.submissions = []; break;
      }
      case 'correct': case 'select': {
        requireThat(lane, 'Invalid lane.', 400);
        const candidate = c.action === 'select' ? s.submissions.find(r => r.id === c.submissionId && r.raceId === race.id && r.lane === lane.lane) : c;
        requireThat(candidate, 'Submission not found.');
        requireThat(statuses.has(candidate.status!), 'Invalid status.', 400);
        const ms = candidate.milliseconds;
        requireThat((typeof ms === 'number' && Number.isSafeInteger(ms) && ms > 0) || (ms === null && candidate.status !== ''), 'Enter a positive time or status.', 400);
        lane.status = candidate.status!;
        lane.milliseconds = lane.status === 'DNS' || lane.status === 'DNF' ? null : ms!;
        lane.corrected = true;
        break;
      }
      case 'confirm':
        requireThat(race.state !== 'running' && complete(race), 'Stop timing and resolve every lane before confirming.');
        race.state = 'confirmed'; race.confirmedAt = new Date().toISOString();
        s.history.push(structuredClone(race)); break;
      default: throw new RelayError('Unknown command.', 400);
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) { body += String(chunk); requireThat(body.length <= 8192, 'Request too large.', 413); }
  try { return JSON.parse(body) as Record<string, unknown>; } catch { throw new RelayError('Invalid JSON.', 400); }
}
export function timerRelayMiddleware(relay = new TimerRelay()) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/timer/')) return next();
    try {
      if (request.headers.origin) requireThat(new URL(request.headers.origin).host === request.headers.host, 'Cross-origin requests denied.', 403);
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const sessionId = url.searchParams.get('id') ?? '';
      if (request.method === 'GET' && url.pathname === '/api/timer/state') return json(response, 200, relay.snapshot(sessionId, token));
      if (request.method === 'POST') {
        requireThat(request.headers['content-type']?.startsWith('application/json'), 'Expected JSON.', 415);
        const body = await readJson(request);
        if (url.pathname === '/api/timer/create') return json(response, 200, relay.create(body.laneCount as number, body.number as number));
        if (url.pathname === '/api/timer/preview') return json(response, 200, relay.preview(body.sessionId as string, body.joinToken as string));
        if (url.pathname === '/api/timer/join') return json(response, 200, relay.join(body.sessionId as string, body.joinToken as string, body.lane as number, body.token as string));
        if (url.pathname === '/api/timer/command') return json(response, 200, relay.command(body.sessionId as string, token, body.command as RelayCommand));
        if (url.pathname === '/api/timer/close') {
          const session = relay.get(body.sessionId as string);
          requireThat(token === session.chiefToken, 'Only the Chief may close a session.', 403);
          relay.sessions.delete(session.id); return json(response, 200, { closed: true });
        }
      }
      return json(response, 404, { error: 'Unknown timer endpoint.' });
    } catch (error) { return json(response, error instanceof RelayError ? error.code : 400, { error: error instanceof Error ? error.message : 'Invalid request.' }); }
  };
}
