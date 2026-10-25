import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { complete, newRace } from '../src/features/timing/timerOnly.ts';
import type { TimerRace, ResultStatus } from '../src/features/timing/timerOnly.ts';
import type { RelayCommand, RelaySnapshot, Submission, Volunteer } from '../src/features/timing/relayProtocol.ts';
import { chiefElapsed } from '../src/features/timing/localCapture.ts';
import type { TimingCapture } from '../src/features/timing/localCapture.ts';
import { ClockEvidence } from './clockEvidence.ts';
import { reconcile } from '../src/features/timing/reconciliation.ts';
import type { FourTimestamp } from '../src/features/timing/reconciliation.ts';

interface Participant extends Volunteer { token: string }
interface Session {
  id: string; chiefToken: string; joinToken: string; revision: number; race: TimerRace;
  volunteers: Participant[]; submissions: Submission[]; history: TimerRace[];
  chiefLastSeen: number; created: number; touched: number; commands: Map<string, string>;
  attempts: Set<string>; captures: NonNullable<RelaySnapshot['captures']>;
  clocks: ClockEvidence;
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
  readonly relayEpoch = randomUUID();
  sessions = new Map<string, Session>();
  clock: () => number;
  constructor(clock = () => performance.now()) { this.clock = clock; }
  prune() {
    for (const [id, session] of this.sessions) if ((this.clock() - session.touched > 4 * 60 * 60 * 1000 || this.clock() - session.created > 16 * 60 * 60 * 1000)) this.sessions.delete(id);
  }
  create(laneCount: number, number = 1) {
    this.prune();
    requireThat(Number.isInteger(laneCount) && laneCount >= 1 && laneCount <= 10, 'Choose 1-10 lanes.', 400);
    requireThat(Number.isSafeInteger(number) && number > 0 && number <= 1000000, 'Invalid race number.', 400);
    requireThat(this.sessions.size < 100, 'Relay session capacity reached.', 503);
    const session: Session = { id: randomUUID(), chiefToken: randomUUID(), joinToken: randomUUID(), revision: 0,
      race: newRace(number, laneCount), volunteers: [], submissions: [], history: [], chiefLastSeen: this.clock(), created: this.clock(), touched: this.clock(), commands: new Map(), attempts: new Set(), captures: [], clocks: new ClockEvidence(this.relayEpoch, randomUUID(), this.clock) };
    session.attempts.add(session.race.id);
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
  private clockSession(id: string, token: string) {
    const s = this.get(id);
    requireThat(token === s.chiefToken || s.volunteers.some(v => v.token === token), 'Clock access denied.', 403);
    s.touched = this.clock(); return s;
  }
  clockProbe(id: string, token: string, epochId: string, t1: number, t2 = this.clock()) {
    return this.clockSession(id, token).clocks.probe(token, epochId, t1, t2, this.clock());
  }
  clockComplete(id: string, token: string, sample: FourTimestamp) {
    const s = this.clockSession(id, token);
    s.clocks.accept(token, sample);
    const selfId = s.volunteers.find(v => v.token === token)?.id;
    for (const c of s.captures) if (c.epochId === sample.epochId &&
      (c.source === 'chief' ? token === s.chiefToken : c.volunteerId === selfId)) s.clocks.pin(token, c);
    s.revision++;
    return { accepted: true, relayEpoch: this.relayEpoch };
  }
  private reconciliation(s: Session, capture: NonNullable<RelaySnapshot['captures']>[number]) {
    const start = s.captures.find(c => c.raceId === capture.raceId && c.kind === 'start' && c.source === 'chief');
    const owner = s.volunteers.find(v => v.id === capture.volunteerId)?.token ?? '';
    const result = reconcile(start, capture, this.relayEpoch,
      start ? s.clocks.pin(s.chiefToken, start) : [], s.clocks.pin(owner, capture),
      { start: start ? s.clocks.available(s.chiefToken, start) : [], finish: s.clocks.available(owner, capture) });
    if (result.diagnostics?.start) result.diagnostics.start.health = s.clocks.health(s.chiefToken);
    if (result.diagnostics) result.diagnostics.finish.health = s.clocks.health(owner);
    // Health counters and age diagnostics change during polling, not the
    // measurement. They must not invalidate an otherwise unchanged selection.
    const calculation = { ...result }; delete calculation.diagnostics;
    return { ...result, id: createHash('sha256').update(JSON.stringify(calculation)).digest('hex') };
  }
  private needsReview(s: Session, lane: TimerRace['lanes'][number]) {
    if (!lane.reconciliation) return false;
    const raw = s.captures.find(c => c.id === lane.reconciliation!.captureId);
    if (!raw) return true;
    const current = this.reconciliation(s, raw);
    return current.verification !== 'verified' || current.lower! > lane.reconciliation.upper! || current.upper! < lane.reconciliation.lower!;
  }
  snapshot(id: string, token: string): RelaySnapshot {
    const s = this.get(id);
    const chief = token === s.chiefToken;
    const self = s.volunteers.find(p => p.token === token);
    requireThat(chief || self, 'Session access denied.', 403);
    if (self) self.lastSeen = this.clock(); else s.chiefLastSeen = this.clock();
    s.touched = this.clock();
    const race = structuredClone(s.race);
    for (const lane of race.lanes) if (lane.reconciliation) lane.reviewRequired = this.needsReview(s, lane);
    const history = chief ? structuredClone(s.history) : [];
    for (const r of history) for (const lane of r.lanes) if (lane.reconciliation) lane.reviewRequired = this.needsReview(s, lane);
    return structuredClone({ sessionId: id, revision: s.revision, serverNow: this.clock(), race,
      volunteers: s.volunteers.map(({ id, lane, lastSeen }) => ({ id, lane, lastSeen })),
      submissions: chief ? s.submissions : s.submissions.filter(r => r.volunteerId === self!.id),
      history: chief ? history : [], chiefLastSeen: s.chiefLastSeen, selfId: self?.id,
      captures: s.captures.filter(c => c.raceId === s.race.id && (chief || c.volunteerId === self?.id)).map(c => {
        if (c.source !== 'lane' || c.kind !== 'finish') return c;
        const result = this.reconciliation(s, c); return { ...c, verification: result.verification, reconciliation: result };
      }) });
  }
  command(id: string, token: string, command: RelayCommand) {
    const s = this.get(id);
    const chief = token === s.chiefToken;
    const volunteer = s.volunteers.find(p => p.token === token);
    requireThat(chief || volunteer, 'Session access denied.', 403);
    requireThat(command && typeof command === 'object', 'Invalid command.', 400);
    const allowed = new Set(['id', 'raceId', 'action', 'lane', 'milliseconds', 'status', 'submissionId', 'uncertainty', 'at', 'capture', 'reconciliationId']);
    requireThat(Object.keys(command).every(key => allowed.has(key)), 'Unexpected command fields.', 400);
    requireThat(typeof command.id === 'string' && /^[a-f0-9-]{16,100}$/.test(command.id), 'Invalid command ID.', 400);
    requireThat(command.status === undefined || statuses.has(command.status), 'Invalid status.', 400);
    requireThat(command.milliseconds === undefined || command.milliseconds === null || (Number.isSafeInteger(command.milliseconds) && command.milliseconds >= 0), 'Invalid milliseconds.', 400);
    requireThat(command.lane === undefined || (Number.isInteger(command.lane) && command.lane >= 1 && command.lane <= s.race.laneCount), 'Invalid lane.', 400);
    requireThat(command.submissionId === undefined || (typeof command.submissionId === 'string' && /^[a-f0-9-]{16,100}$/.test(command.submissionId)), 'Invalid submission ID.', 400);
    requireThat(command.uncertainty === undefined || (Number.isFinite(command.uncertainty) && command.uncertainty >= 0), 'Invalid clock uncertainty.', 400);
    requireThat(command.at === undefined || (typeof command.at === 'number' && Number.isFinite(command.at)), 'Invalid timestamp.', 400);
    requireThat(command.reconciliationId === undefined || (typeof command.reconciliationId === 'string' && /^[a-f0-9]{64}$/.test(command.reconciliationId)), 'Invalid reconciliation version.', 400);
    const fingerprint = JSON.stringify({ token, command });
    const prior = s.commands.get(command.id);
    if (prior) { requireThat(prior === fingerprint, 'Duplicate command ID with different data.'); return this.snapshot(id, token); }
    if (command.action === 'localCapture') {
      requireThat(Object.keys(command).every(k => ['id', 'raceId', 'action', 'capture'].includes(k)), 'Unexpected capture command fields.', 400);
      requireThat(s.commands.size < 20000, 'Session command limit reached.', 503);
      this.localCapture(s, command, chief, volunteer);
      s.commands.set(command.id, fingerprint); s.revision++; s.touched = this.clock();
      return this.snapshot(id, token);
    }
    requireThat(command.capture === undefined, 'Capture requires localCapture action.', 400);
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
    s.attempts.add(s.race.id);
    s.commands.set(command.id, fingerprint); s.revision++; s.touched = this.clock();
    return this.snapshot(id, token);
  }
  localCapture(s: Session, command: RelayCommand, chief: boolean, volunteer?: Participant) {
    const c = command.capture as TimingCapture;
    requireThat(c && typeof c === 'object' && !Array.isArray(c), 'Missing capture.', 400);
    requireThat(Object.keys(c).every(k => ['id', 'raceId', 'epochId', 'localAt', 'kind', 'lane', 'startId', 'evidence', 'syncSamples'].includes(k)), 'Unexpected capture fields.', 400);
    for (const id of [c.id, c.raceId, c.epochId, ...(c.startId === undefined ? [] : [c.startId])]) requireThat(typeof id === 'string' && /^[a-f0-9-]{16,100}$/.test(id), 'Invalid capture identifier.', 400);
    requireThat(c.id === command.id && c.raceId === command.raceId, 'Capture identity mismatch.', 400);
    requireThat(Number.isFinite(c.localAt) && c.localAt >= 0 && c.localAt <= 1e15, 'Invalid capture timestamp.', 400);
    requireThat(['start', 'finish', 'stop'].includes(c.kind), 'Invalid capture kind.', 400);
    if (c.evidence !== undefined) {
      requireThat(c.evidence && typeof c.evidence === 'object' && Object.keys(c.evidence).every(k => ['localMidpoint', 'serverTime', 'uncertainty'].includes(k)), 'Invalid evidence fields.', 400);
      requireThat([c.evidence.localMidpoint, c.evidence.serverTime, c.evidence.uncertainty].every(v => Number.isFinite(v) && v >= 0 && v <= 1e15), 'Invalid clock evidence.', 400);
    }
    requireThat(s.attempts.has(c.raceId), 'Unknown race attempt; capture retained on your phone.', 409);
    if (c.syncSamples !== undefined) {
      requireThat(Array.isArray(c.syncSamples) && c.syncSamples.length <= 4, 'Invalid capture clock samples.', 400);
      const owner = chief ? s.chiefToken : volunteer!.token;
      for (const sample of c.syncSamples) { requireThat(sample.epochId === c.epochId, 'Capture clock epoch mismatch.', 400); s.clocks.accept(owner, sample); }
    }
    requireThat(chief || (volunteer && c.kind === 'finish'), 'Only the Chief can start or stop.', 403);
    if (c.kind === 'finish') {
      requireThat(Number.isInteger(c.lane) && c.lane! >= 1 && c.lane! <= s.race.laneCount, 'Invalid lane.', 400);
      requireThat(chief || c.lane === volunteer?.lane, 'Capture lane does not match assignment.', 403);
    } else requireThat(c.lane === undefined && (c.kind !== 'start' || c.startId === undefined), 'Invalid start/stop fields.', 400);
    requireThat(!s.captures.some(p => p.raceId === c.raceId && p.kind === c.kind && p.lane === c.lane && p.source === (chief ? 'chief' : 'lane') && p.volunteerId === volunteer?.id), 'A capture already exists for this lane and attempt.', 409);
    const current = c.raceId === s.race.id;
    if (c.kind === 'start') {
      requireThat(current && s.race.state === 'ready' && !complete(s.race), 'Race is not ready to start.');
      s.race.chiefStart = { id: c.id, raceId: c.raceId, epochId: c.epochId, localAt: c.localAt, kind: 'start' };
      s.race.startReference = 'chief-local'; s.race.startedAt = null; s.race.state = 'running';
    } else if (chief && current && s.race.state !== 'confirmed') {
      const start = s.race.chiefStart;
      const ms = start ? chiefElapsed(start, c) : null;
      requireThat(ms !== null, 'Chief clock continuity lost. Use manual correction or reset.', 409);
      const stop = s.captures.find(p => p.raceId === c.raceId && p.source === 'chief' && p.kind === 'stop');
      // Completing official lanes is not a physical Chief Stop boundary. A
      // delayed independent Chief capture must not be lost merely because a
      // volunteer selection has already resolved that lane.
      requireThat(s.race.state === 'running' || (c.kind === 'finish' && s.race.state === 'stopped' && (!stop || c.localAt <= stop.localAt)), 'Race is stopped.', 409);
      if (c.kind === 'stop') { s.race.state = 'stopped'; s.race.elapsed = ms; }
      else {
        const lane = s.race.lanes[c.lane! - 1];
        lane.chiefLocalMilliseconds = ms;
        // An immutable capture must never overwrite a later Chief correction/status.
        if (lane.milliseconds === null && !lane.status && !lane.corrected) { lane.milliseconds = ms; lane.timingSource = 'chief-local'; }
        if (complete(s.race)) { s.race.state = 'stopped'; s.race.elapsed = Math.max(ms, ...s.race.lanes.map(l => l.milliseconds ?? 0)); }
      }
    }
    s.captures.push({ ...structuredClone(c), source: chief ? 'chief' : 'lane', ...(volunteer ? { volunteerId: volunteer.id } : {}), verification: 'pending' });
    s.clocks.pin(chief ? s.chiefToken : volunteer!.token, c);
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
      requireThat(race.startReference !== 'chief-local', 'Use original Chief local captures for timing this race.', 409);
      requireThat(typeof c.at === 'number' && Number.isFinite(c.at) && typeof c.uncertainty === 'number' && c.uncertainty >= 0 && c.uncertainty <= 100, 'A fresh synchronised clock is required.', 400);
      requireThat(c.at <= eventTime + c.uncertainty + 10 && eventTime - c.at < 5000, 'Timing action expired. Check the race before retrying.');
      eventTime = c.at;
    }
    const elapsed = () => Math.max(0, Math.round(eventTime - race.startedAt!));
    const lane = race.lanes.find(l => l.lane === c.lane);
    switch (c.action) {
      case 'selectCapture': {
        requireThat(lane, 'Invalid lane.', 400);
        const raw = s.captures.find(p => p.id === c.submissionId && p.raceId === race.id && p.lane === lane.lane && p.source === 'lane' && p.kind === 'finish');
        requireThat(raw, 'Volunteer capture not found.');
        const result = this.reconciliation(s, raw);
        requireThat(result.verification === 'verified', 'Only clock-policy verified volunteer times may be selected.');
        requireThat(c.reconciliationId === result.id, 'Clock evidence changed. Review the current calculation before selecting.');
        lane.milliseconds = result.milliseconds!; lane.status = ''; lane.corrected = false;
        lane.timingSource = 'volunteer-verified';
        lane.reconciliation = structuredClone({ ...result, captureId: raw.id, volunteerId: raw.volunteerId! });
        delete lane.reviewRequired;
        if (complete(race)) { race.state = 'stopped'; race.elapsed = Math.max(...race.lanes.map(l => l.milliseconds ?? 0)); }
        break;
      }
      case 'start': case 'startRelay':
        requireThat(race.state === 'ready' && !complete(race), 'Race is not ready to start.');
        if (c.action === 'startRelay') requireThat(c.at === undefined && c.uncertainty === undefined, 'Relay start must not supply a client timestamp.', 400);
        race.startReference = c.action === 'startRelay' ? 'relay' : 'tap';
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
        lane.timingSource = 'manual';
        delete lane.reconciliation; delete lane.reviewRequired;
        if (race.startReference === 'chief-local' && complete(race)) {
          race.state = 'stopped'; race.elapsed = Math.max(...race.lanes.map(l => l.milliseconds ?? 0));
        }
        break;
      }
      case 'confirm':
        requireThat(!race.lanes.some(l => this.needsReview(s, l)), 'Selected clock evidence is no longer sufficient. Review or correct affected lanes.');
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
export interface RelayOptions {
  allowedOrigins?: string[];
  production?: boolean;
  rateLimit?: number;
}
export function timerRelayMiddleware(relay = new TimerRelay(), options: RelayOptions = {}) {
  // Never trust client-supplied forwarded IPs. Proxied clients share the IP bucket.
  const buckets = new Map<string, { count: number; reset: number }>();
  const take = (key: string, limit: number) => {
    const now = relay.clock();
    for (const [id, bucket] of buckets) if (bucket.reset <= now) buckets.delete(id);
    const bucket = buckets.get(key) ?? { count: 0, reset: now + 60000 };
    requireThat(buckets.has(key) || buckets.size < 10000, 'Traffic capacity reached.', 503);
    buckets.set(key, bucket);
    requireThat(++bucket.count <= limit, 'Too many requests. Wait a minute.', 429);
  };
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const receivedAt = relay.clock(); // t2 before body parsing/authentication work.
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/timer/')) return next();
      const origin = request.headers.origin;
      if (origin) {
        const permitted = options.production
          ? options.allowedOrigins?.includes(origin)
          : options.allowedOrigins?.includes(origin) || new URL(origin).host === request.headers.host;
        requireThat(permitted, 'Cross-origin requests denied.', 403);
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      response.setHeader('X-Content-Type-Options', 'nosniff');
      take('ip:' + (request.socket.remoteAddress ?? 'unknown'), options.rateLimit ?? 30000);
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.writeHead(204); response.end(); return;
      }
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (token) {
        requireThat(/^[a-f0-9-]{16,100}$/.test(token), 'Invalid credential.', 403);
        take('token:' + token, 240);
      }
      const sessionId = url.searchParams.get('id') ?? '';
      requireThat([...url.searchParams.keys()].every(key => key === 'id'), 'Unexpected query fields.', 400);
      if (request.method === 'GET' && url.pathname === '/api/timer/state') return json(response, 200, relay.snapshot(sessionId, token));
      if (request.method === 'POST') {
        requireThat(request.headers['content-type']?.startsWith('application/json'), 'Expected JSON.', 415);
        const body = await readJson(request);
        requireThat(body && typeof body === 'object' && !Array.isArray(body), 'Expected an object.', 400);
        const schemas: Record<string, string[]> = {
          create: ['laneCount', 'number'], preview: ['sessionId', 'joinToken'],
          join: ['sessionId', 'joinToken', 'lane', 'token'], command: ['sessionId', 'command'], close: ['sessionId'],
          'clock/probe': ['sessionId', 'epochId', 't1'], 'clock/complete': ['sessionId', 'sample'],
        };
        const endpoint = url.pathname.slice('/api/timer/'.length);
        requireThat(schemas[endpoint] && Object.keys(body).every(key => schemas[endpoint].includes(key)), 'Unexpected request fields.', 400);
        for (const key of ['sessionId', 'joinToken', 'token']) if (key in body) requireThat(typeof body[key] === 'string' && /^[a-f0-9-]{16,100}$/.test(body[key] as string), 'Invalid identifier.', 400);
        if (endpoint === 'create') take('create:' + (request.socket.remoteAddress ?? 'unknown'), 10);
        if (endpoint === 'clock/probe') return json(response, 200, relay.clockProbe(body.sessionId as string, token, body.epochId as string, body.t1 as number, receivedAt));
        if (endpoint === 'clock/complete') return json(response, 200, relay.clockComplete(body.sessionId as string, token, body.sample as FourTimestamp));
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
