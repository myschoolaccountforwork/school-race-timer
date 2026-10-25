// Run after npm run build. This checks the actual Vite preview plugin wiring,
// not just the isolated HTTP middleware used in the unit/integration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { preview } from 'vite';

test('production preview serves Timer Only routes and the optional memory relay', async t => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  t.after(async () => { app.httpServer.closeAllConnections(); await new Promise(resolve => app.httpServer.close(resolve)); });
  const origin = `http://127.0.0.1:${app.httpServer.address().port}`;
  for (const route of ['/timing', '/timing/multi', '/timing/join']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root"><\/div>/);
  }
  const response = await fetch(origin + '/api/timer/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ laneCount: 10, number: 1 }) });
  assert.equal(response.status, 200);
  const chief = await response.json();
  assert.equal(chief.role, 'chief');
  const stateResponse = await fetch(`${origin}/api/timer/state?id=${chief.sessionId}`, { headers: { Authorization: `Bearer ${chief.token}` } });
  const state = await stateResponse.json();
  assert.equal(state.race.laneCount, 10);
  assert.equal(state.race.state, 'ready');
  const closed = await fetch(origin + '/api/timer/close', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chief.token}` }, body: JSON.stringify({ sessionId: chief.sessionId }) });
  assert.equal(closed.status, 200);
});
