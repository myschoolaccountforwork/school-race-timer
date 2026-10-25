// Real browser + actual React screen/hooks + real local relay. No hook mocks.
// Use installed Edge by default, or RACEFLOW_TEST_BROWSER=<Chromium executable>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

test('rendered Chief screen captures original local Start and consecutive lanes without sync or acknowledgements', { timeout: 60000 }, async t => {
  const app = await createServer({
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    // Isolate local UI tests from production .env settings.
    define: { 'import.meta.env.VITE_TIMER_RELAY_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify('') },
  });
  let browser, page;
  let releaseStart = () => {};
  t.after(async () => {
    releaseStart();
    if (page) await page.unrouteAll({ behavior: 'wait' });
    await browser?.close();
    await app.close();
  });
  await app.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.RACEFLOW_TEST_BROWSER ? { executablePath: process.env.RACEFLOW_TEST_BROWSER } : { channel: 'msedge' }),
  });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let startDelivered;
  const pendingStart = new Promise(resolve => { releaseStart = resolve; });
  const startAtRelay = new Promise(resolve => { startDelivered = resolve; });
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

test('rendered Chief and volunteer reconcile a preserved raw finish, select only verified evidence and export it', { timeout: 60000 }, async t => {
  const app = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
    define: { 'import.meta.env.VITE_TIMER_RELAY_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify('') },
  });
  let browser, chief, volunteer;
  t.after(async () => {
    if (chief) await chief.unrouteAll({ behavior: 'wait' });
    if (volunteer) await volunteer.unrouteAll({ behavior: 'wait' });
    await browser?.close();
    await app.close();
  });
  await app.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.RACEFLOW_TEST_BROWSER ? { executablePath: process.env.RACEFLOW_TEST_BROWSER } : { channel: 'msedge' }),
  });
  const chiefContext = await browser.newContext(), volunteerContext = await browser.newContext();
  chief = await chiefContext.newPage(); volunteer = await volunteerContext.newPage();
  const errors = [];
  chief.on('pageerror', e => errors.push(e.message)); volunteer.on('pageerror', e => errors.push(e.message));
  let slow = true, pause = false;
  await volunteer.route('**/api/timer/clock/probe', async route => {
    if (pause) return route.abort();
    const response = await route.fetch();
    if (slow) await delay(450);
    if (pause) return route.abort();
    await route.fulfill({ response });
  });
  const origin = `http://127.0.0.1:${app.httpServer.address().port}`;
  await chief.goto(`${origin}/timing/multi`);
  await chief.getByLabel('Number of lanes').selectOption('1');
  await chief.getByRole('button', { name: 'Create session', exact: true }).click();
  const join = await chief.locator('.relay-join-link input').inputValue();
  await volunteer.goto(join);
  await volunteer.getByRole('button', { name: 'Join Lane 1', exact: true }).click();
  for (const page of [chief, volunteer]) await page.waitForFunction(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('raceflow.captures.v1.'));
    return key && JSON.parse(localStorage.getItem(key)).clockSamples.length >= 2;
  });
  await chief.getByRole('button', { name: 'Chief Start (physical signal)', exact: true }).click();
  await volunteer.getByText('Chief original Start reference:', { exact: false }).waitFor();
  assert.equal(await volunteer.getByRole('button', { name: /Start/ }).count(), 0);
  const finish = volunteer.getByRole('button', { name: /^Finish.*Lane 1$/ });
  assert.equal(await finish.isEnabled(), true);
  await finish.click();
  await chief.getByText('Unverified', { exact: true }).waitFor();
  const select = chief.getByRole('button', { name: 'Use verified time as official', exact: true });
  assert.equal(await select.isEnabled(), false);
  const raw = await volunteer.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('raceflow.captures.v1.'));
    return JSON.parse(localStorage.getItem(key)).records.find(r => r.capture.kind === 'finish').capture;
  });
  slow = false;
  await chief.getByText('Verified (clock policy)', { exact: true }).waitFor();
  await volunteer.getByText('Verified (clock policy)', { exact: true }).waitFor();
  pause = true;
  await chief.route('**/api/timer/clock/probe', route => route.abort());
  const rawAfter = await volunteer.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('raceflow.captures.v1.'));
    return JSON.parse(localStorage.getItem(key)).records.find(r => r.capture.kind === 'finish').capture;
  });
  assert.deepEqual(rawAfter, raw);
  assert.equal(await select.isEnabled(), true);
  await select.click();
  await chief.getByText('Official selection: clock-policy verified at selection,', { exact: false }).waitFor();
  chief.on('dialog', dialog => dialog.accept());
  const confirm = chief.getByRole('button', { name: 'Confirm & lock results', exact: true });
  await pageEnabled(confirm);
  await confirm.click();
  await pageEnabled(chief.getByRole('button', { name: 'Next Race', exact: true }));
  const credentials = await chief.evaluate(() => JSON.parse(localStorage.getItem('timer-only-chief')));
  const response = await chief.request.get(`${origin}/api/timer/state?id=${credentials.sessionId}`, { headers: { Authorization: `Bearer ${credentials.token}` } });
  const snapshot = await response.json();
  const lane = snapshot.history[0].lanes[0];
  assert.equal(lane.timingSource, 'volunteer-verified');
  assert.equal(lane.reconciliation.captureId, raw.id);
  assert.ok(lane.reconciliation.uncertainty <= 100);
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const downloading = chief.waitForEvent('download');
    await chief.getByRole('button', { name: new RegExp(`^Export all.*${format.toUpperCase()}$`) }).click();
    const download = await downloading;
    const data = await readFile(await download.path());
    if (format === 'pdf') {
      assert.equal(data.subarray(0, 4).toString(), '%PDF');
      assert.ok(data.toString('latin1').includes(raw.id));
      assert.ok(data.toString('latin1').includes('raceflow-020-total-100ms-v1'));
    } else {
      const book = XLSX.read(data, { type: 'buffer' });
      const row = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])[0];
      assert.equal(row.Milliseconds, lane.milliseconds);
      assert.equal(row['Capture ID'], raw.id);
      assert.equal(row['Uncertainty (ms)'], lane.reconciliation.uncertainty);
      assert.match(row.Verification, /Clock-policy verified/);
    }
  }
  assert.deepEqual(errors, []);
});

async function pageEnabled(locator) {
  await locator.waitFor();
  await locator.page().waitForFunction(element => !element.disabled, await locator.elementHandle());
}
