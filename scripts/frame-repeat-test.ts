// Continuous frame (#503): runFrameLoop in src/laser.ts repeats a lap until it is ended, stopped, fails or times out.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { DEFAULT_DEVICE } = await import('../src/gcode');
const { frameJob, frameLooping, runFrameLoop } = await import('../src/laser');
const { machine } = await import('../src/machine');

const m = machine as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}`);
    console.error(e);
  }
}

/** A lap that "runs" on the machine for `ms` milliseconds */
const lapOf = (log: boolean[], ms = 20, ok = () => true) => async (first: boolean) => {
  log.push(first);
  if (!ok()) return false;
  m.progress = { sent: 0, acked: 0, total: 1, errors: 0 };
  setTimeout(() => (m.progress = null), ms);
  return true;
};
const reset = () => {
  m.connected = true;
  m.progress = null;
  m.remote = null;
  m.storedJob = null;
};

await test('defaults: off, 5 minutes', async () => {
  assert.equal(DEFAULT_DEVICE.frameRepeat, false);
  assert.equal(DEFAULT_DEVICE.frameRepeatMinutes, 5);
});

await test('repeats until Frame is clicked again, then finishes the current lap', async () => {
  reset();
  const laps: boolean[] = [];
  const run = runFrameLoop(lapOf(laps, 30), false, 5, 5);
  assert.equal(frameLooping(), 'frame');
  await sleep(110);
  await frameJob(null as never, false); // second click ends the loop
  assert.equal(machine.running, true, 'the current lap keeps running');
  const before = laps.length;
  await run;
  assert.equal(machine.running, false);
  assert.equal(laps.length, before, 'no new lap after the end');
  assert.ok(laps.length >= 2, `several laps (${laps.length})`);
  assert.deepEqual(laps.slice(0, 2), [true, false], 'only the first lap is the first');
  assert.equal(frameLooping(), null);
});

await test('Stop ends the loop, also between laps', async () => {
  reset();
  const laps: boolean[] = [];
  const run = runFrameLoop(lapOf(laps, 20), true, 5, 5);
  assert.equal(frameLooping(), 'contour');
  await sleep(50);
  m.emit({ type: 'stop' });
  m.progress = null;
  await run;
  const n = laps.length;
  await sleep(40);
  assert.equal(laps.length, n);
  assert.equal(frameLooping(), null);
});

await test('a failed lap (done with error) ends the loop', async () => {
  reset();
  const laps: boolean[] = [];
  const run = runFrameLoop(lapOf(laps, 20), false, 5, 5);
  await sleep(10);
  m.emit({ type: 'done', ok: false, message: 'Abgebrochen' });
  await run;
  assert.equal(laps.length, 1);
});

await test('a lap that does not start ends the loop', async () => {
  reset();
  const laps: boolean[] = [];
  let n = 0;
  await runFrameLoop(lapOf(laps, 5, () => ++n < 3), false, 5, 5);
  assert.equal(laps.length, 3);
  assert.equal(frameLooping(), null);
});

await test('disconnect ends the loop', async () => {
  reset();
  const laps: boolean[] = [];
  const run = runFrameLoop(lapOf(laps, 1000), false, 5, 5);
  await sleep(20);
  m.connected = false;
  m.emit({ type: 'connection' });
  await run;
  assert.equal(laps.length, 1);
});

await test('time limit ends the loop', async () => {
  reset();
  const laps: boolean[] = [];
  const t0 = performance.now();
  await runFrameLoop(lapOf(laps, 10), false, 0.001, 5); // 60 ms
  assert.ok(performance.now() - t0 < 1000);
  assert.ok(laps.length >= 2);
});

await test('waits for a remote host that reports the lap late', async () => {
  reset();
  const laps: boolean[] = [];
  const lap = async (first: boolean) => {
    laps.push(first);
    // The host's state arrives 50 ms after the request
    setTimeout(() => (m.progress = { sent: 0, acked: 0, total: 1, errors: 0 }), 50);
    setTimeout(() => (m.progress = null), 100);
    return true;
  };
  const run = runFrameLoop(lap, false, 5, 5);
  await sleep(30);
  assert.equal(laps.length, 1, 'no second request before the host reported the first lap');
  await sleep(150);
  await frameJob(null as never, false);
  await run;
  assert.ok(laps.length >= 2);
});

m.connected = false;
if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
