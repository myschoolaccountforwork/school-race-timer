// Real browser + actual React screen/hooks + real local relay. No hook mocks.
// Use installed Edge by default, or RACEFLOW_TEST_BROWSER=<Chromium executable>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

test('rendered Chief screen captures original local Start and consecutive lanes without sync or acknowledgements', { timeout: 60000 }, async t => {
  const app = await createServer({
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    // Isolate local UI tests from production .env settings.
    define: { 'import.meta.env.VITE_TIMER_RELAY_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify('') },
  });
  await app.listen();
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true,
    ...(process.env.RACEFLOW_TEST_BROWSER ? { executablePath: process.env.RACEFLOW_TEST_BROWSER } : { channel: 'msedge' }),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let releaseStart;
  let startDelivered;
  const pendingStart = new Promise(resolve => { releaseStart = resolve; });
  const startAtRelay = new Promise(resolve => { startDelivered = resolve; });
  t.after(() => releaseStart());
  await page.route('**/api/timer/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) {
      const response = await route.fetch();
      await delay(450); // Every clock sample is deliberately outside the 100 ms policy.
      await route.fulfill({ response });
      return;
    }
    if (path.endsWith('/command')) {
      const body = route.request().postDataJSON();
      requests.push(body.command);
      if (body.command.action === 'localCapture' && body.command.capture.kind === 'start') {
        const response = await route.fetch(); // Relay accepts, but browser gets no acknowledgement yet.
        startDelivered();
        await pendingStart;
        await route.fulfill({ response });
        return;
      }
    }
    await route.continue();
  });
  const origin = `http://127.0.0.1:${app.httpServer.address().port}`;
  await page.goto(`${origin}/timing/multi`);
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  await page.getByText('Connected to timing relay', { exact: true }).waitFor();
  await page.getByText('Clock alignment is insufficient.', { exact: false }).waitFor();
  const start = page.getByRole('button', { name: 'Chief Start (physical signal)', exact: true });
  assert.equal(await page.getByRole('button', { name: /Start at relay/i }).count(), 0);
  assert.equal(await start.isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: /Chief Finish/ }).count(), 8);
  const before = await page.evaluate(() => performance.now());
  await start.click();
  await startAtRelay;
  const readRecords = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('raceflow.captures.v1.'));
    return key ? JSON.parse(localStorage.getItem(key)).records : [];
  });
  const initial = await readRecords();
  const originalStart = initial.find(r => r.capture.kind === 'start');
  assert.ok(originalStart.capture.localAt >= before);
  assert.ok(originalStart.capture.localAt <= await page.evaluate(() => performance.now()));
  assert.equal(originalStart.delivery, 'saved'); // Explicitly still awaiting acknowledgement.
  assert.equal(await start.isEnabled(), false);
  const laneButton = lane => page.getByRole('button', { name: new RegExp(`^Chief Finish.*Lane ${lane}$`) });
  for (let lane = 1; lane <= 8; lane++) assert.equal(await laneButton(lane).isEnabled(), true);
  for (const lane of [1, 2, 3]) {
    await laneButton(lane).click();
    assert.equal(await laneButton(lane).isEnabled(), false);
    assert.equal(await laneButton(lane + 1).isEnabled(), true);
  }
  const captured = await readRecords();
  const finishes = captured.filter(r => r.capture.kind === 'finish');
  assert.deepEqual(finishes.map(r => r.capture.lane), [1, 2, 3]);
  assert.equal(new Set(captured.map(r => r.capture.id)).size, 4);
  assert.ok(finishes.every(r => r.delivery === 'saved'));
  for (let i = 0; i < finishes.length; i++) {
    const c = finishes[i].capture;
    assert.equal(c.startId, originalStart.capture.id);
    assert.equal(c.raceId, originalStart.capture.raceId);
    assert.equal(c.epochId, originalStart.capture.epochId);
    assert.ok(c.localAt > (i ? finishes[i - 1].capture.localAt : originalStart.capture.localAt));
  }
  // Resume transport; the original records must survive unchanged.
  releaseStart();
  await page.waitForFunction(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('raceflow.captures.v1.'));
    const records = key ? JSON.parse(localStorage.getItem(key)).records : [];
    return records.length === 4 && records.every(r => r.delivery === 'received');
  });
  const received = await readRecords();
  assert.deepEqual(received.map(r => r.capture), captured.map(r => r.capture));
  assert.ok(requests.every(c => c.action === 'localCapture'));
  const credentials = await page.evaluate(() => JSON.parse(localStorage.getItem('timer-only-chief')));
  const response = await page.request.get(`${origin}/api/timer/state?id=${credentials.sessionId}`, { headers: { Authorization: `Bearer ${credentials.token}` } });
  const snapshot = await response.json();
  assert.equal(snapshot.race.startReference, 'chief-local');
  assert.equal(snapshot.race.chiefStart.localAt, originalStart.capture.localAt);
  assert.equal(snapshot.race.startedAt, null); // No relay-receipt time masquerades as the start.
  assert.deepEqual(snapshot.race.lanes.slice(0, 3).map(l => l.milliseconds), finishes.map(r => Math.round(r.capture.localAt - originalStart.capture.localAt)));
  assert.deepEqual(errors, []);
});
