// Macro buttons per device (#506): parsing, placeholders, laser check, presets and the line-by-line runner
import { strict as assert } from 'node:assert';
import {
  endsRelative, expandMacro, laserOnLines, macroPresets, MacroIo, macroVarNames, macroVars, normalizeMacroVars, normalizeMacros,
  runMacroLines, stripComment, varsFromText, varsToText,
} from '../src/macros';
import { newDevice } from '../src/gcode';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`ok ${++passed} ${name}`);
}

const PROBE = `G91                 ; relative mode
G38.2 Z-{probeMax} F{probeFeed}     ; probe
G10 L20 P1 Z0       ; set work Z
G0 Z{focusLift}
(comment only)
G90`;

await test('comments and blank lines are dropped, placeholders filled', () => {
  assert.equal(stripComment('G0 Z7 ; up'), 'G0 Z7');
  assert.equal(stripComment('(note) G90'), 'G90');
  assert.deepEqual(macroVarNames(PROBE), ['probeMax', 'probeFeed', 'focusLift']);
  const r = expandMacro(PROBE, { probeMax: 40, probeFeed: 150, focusLift: 7.25 });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.lines, ['G91', 'G38.2 Z-40 F150', 'G10 L20 P1 Z0', 'G0 Z7.25', 'G90']);
});

await test('missing placeholders are reported, not sent as text', () => {
  const r = expandMacro(PROBE, { probeMax: 40 });
  assert.deepEqual(r.missing, ['probeFeed', 'focusLift']);
});

await test('device variables plus materialThickness from the material height', () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), zMaterial: 3, macroVars: { focusLift: 7, 'bad name': 1 } as Record<string, number> };
  assert.deepEqual(macroVars(d), { materialThickness: 3, focusLift: 7 });
  assert.deepEqual(macroVars({ ...d, zMaterial: undefined, macroVars: undefined }), {});
});

await test('laser-on detection: M3/M4 with S > 0 or without S', () => {
  assert.deepEqual(laserOnLines(['M3 S0', 'M4 S0', 'G0 X1', 'M5', 'M30', 'M8']), []);
  assert.deepEqual(laserOnLines(['M3 S100']), ['M3 S100']);
  assert.deepEqual(laserOnLines(['m4s1']), ['m4s1']);
  assert.deepEqual(laserOnLines(['M3']), ['M3']);
  assert.deepEqual(laserOnLines(['M03 S10', 'G1 X5 M4 S2']), ['M03 S10', 'G1 X5 M4 S2']);
  assert.deepEqual(laserOnLines(['M34', 'M300 S440']), []);
});

await test('relative mode at the end is detected; $J lines do not count', () => {
  assert.equal(endsRelative(['G91', 'G0 Z5', 'G90']), false);
  assert.equal(endsRelative(['G91', 'G0 Z5']), true);
  assert.equal(endsRelative(['$J=G91 Z5 F100']), false);
  assert.equal(endsRelative(['G90 G91']), true);
  assert.equal(endsRelative(['G91.1']), false);
});

await test('variables text round trip and bad lines', () => {
  const { vars, bad } = varsFromText('probeMax = 40\nprobeFeed: 150\n\nfocusLift=7,5 ; mm\n2bad = 1\nx = abc');
  assert.deepEqual(vars, { probeMax: 40, probeFeed: 150, focusLift: 7.5 });
  assert.deepEqual(bad, ['2bad = 1', 'x = abc']);
  assert.deepEqual(varsFromText(varsToText(vars)).vars, vars);
});

await test('stored macros are cleaned up (ids unique, broken entries dropped)', () => {
  const ms = normalizeMacros([{ id: 'a', name: 'One', gcode: 'M8' }, { id: 'a', name: 'Two', gcode: 'M9', tip: ' ' }, { name: 'x' }, null, 'M3']);
  assert.equal(ms.length, 2);
  assert.notEqual(ms[0].id, ms[1].id);
  assert.equal(ms[1].tip, undefined);
  assert.deepEqual(normalizeMacros('nope'), []);
  assert.deepEqual(normalizeMacroVars({ a: 1, b: 'x', c: NaN, 'd e': 2 }), { a: 1 });
});

await test('presets per firmware: probing only for the GRBL family, air uses the device command', () => {
  const grbl = macroPresets('grbl', 'M7');
  assert.ok(grbl.some((p) => p.key === 'probe-z'));
  assert.equal(grbl.find((p) => p.key === 'air-on')!.gcode, 'M7');
  const probe = grbl.find((p) => p.key === 'probe-z')!;
  const r = expandMacro(probe.gcode, probe.vars!);
  assert.deepEqual(r.lines, ['G91', 'G38.2 Z-40 F150', 'G10 L20 P1 Z0', 'G0 Z7', 'G90']);
  assert.equal(endsRelative(r.lines), false);
  for (const fw of ['fluidnc', 'grbl', 'grblhal', 'marlin', 'smoothie', 'xtool'] as const)
    for (const p of macroPresets(fw, 'M8')) assert.deepEqual(laserOnLines(expandMacro(p.gcode, p.vars ?? {}).lines), [], `${fw} ${p.key}`);
  assert.ok(!macroPresets('marlin', 'M8').some((p) => p.key === 'probe-z'));
  assert.deepEqual(macroPresets('ruida', 'M8'), []);
});

/** Fake controller: answers each line with the reply from `answer` (undefined = no answer) */
function fakeIo(answer: (line: string) => { line?: string; alarm?: boolean; lost?: boolean } | undefined) {
  const sent: string[] = [];
  let fn: ((e: { line?: string; alarm?: boolean; lost?: boolean }) => void) | null = null;
  const io: MacroIo = {
    async send(line) {
      sent.push(line);
      const a = answer(line);
      if (a) queueMicrotask(() => fn?.(a));
    },
    listen(f) {
      fn = f;
      return () => { if (fn === f) fn = null; };
    },
  };
  return { io, sent };
}

await test('runner sends line by line and waits for ok', async () => {
  const { io, sent } = fakeIo(() => ({ line: 'ok' }));
  const r = await runMacroLines(['G91', 'G0 Z1', 'G90'], io);
  assert.deepEqual(r, { ok: true, sent: 3 });
  assert.deepEqual(sent, ['G91', 'G0 Z1', 'G90']);
});

await test('alarm during probing stops the macro and restores absolute mode', async () => {
  const { io, sent } = fakeIo((l) => (l.startsWith('G38') ? { line: 'ALARM:4' } : { line: 'ok' }));
  const r = await runMacroLines(['G91', 'G38.2 Z-40 F150', 'G10 L20 P1 Z0', 'G0 Z7', 'G90'], io);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'alarm');
  assert.equal(r.ok === false && r.line, 'G38.2 Z-40 F150');
  assert.equal(r.sent, 1);
  assert.deepEqual(sent, ['G91', 'G38.2 Z-40 F150', 'G90']);
});

await test('alarm from the status report counts as well', async () => {
  const { io, sent } = fakeIo((l) => (l === 'G0 Z1' ? { alarm: true } : { line: 'ok' }));
  const r = await runMacroLines(['G0 Z1', 'M8'], io);
  assert.equal(r.ok === false && r.reason, 'alarm');
  assert.deepEqual(sent, ['G0 Z1']);
});

await test('error stops the macro; relative macro without G90 gets G90 afterwards', async () => {
  const err = fakeIo((l) => (l === 'X' ? { line: 'error:20' } : { line: 'ok' }));
  const r = await runMacroLines(['M8', 'X', 'M9'], err.io);
  assert.equal(r.ok === false && r.reason, 'error');
  assert.equal(r.ok === false && r.reply, 'error:20');
  assert.deepEqual(err.sent, ['M8', 'X']);
  const rel = fakeIo(() => ({ line: 'ok' }));
  assert.equal((await runMacroLines(['G91', 'G0 Z5'], rel.io)).ok, true);
  assert.deepEqual(rel.sent, ['G91', 'G0 Z5', 'G90']);
});

await test('timeout and lost connection stop the macro', async () => {
  const silent = fakeIo(() => undefined);
  const r = await runMacroLines(['G0 Z1', 'M8'], silent.io, { timeoutMs: 20 });
  assert.equal(r.ok === false && r.reason, 'timeout');
  assert.deepEqual(silent.sent, ['G0 Z1']);
  const lost = fakeIo(() => ({ lost: true }));
  const r2 = await runMacroLines(['G91', 'G0 Z1'], lost.io);
  assert.equal(r2.ok === false && r2.reason, 'lost');
  assert.deepEqual(lost.sent, ['G91']);
});

await test('stop request ends before the next line', async () => {
  let stop = false;
  const { io, sent } = fakeIo(() => ((stop = true), { line: 'ok' }));
  const r = await runMacroLines(['M8', 'M9'], io, { stopped: () => stop });
  assert.equal(r.ok === false && r.reason, 'stopped');
  assert.deepEqual(sent, ['M8']);
});

await test('loading devices keeps macros and cleans them', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  return import('../src/gcode').then(({ loadDevices }) => {
    store.set('kizamubeam.devices', JSON.stringify({ current: 'x', devices: [{ ...newDevice({ fw: 'grbl' }), id: 'x', macros: [{ id: 'a', name: 'Air', gcode: 'M8' }, { bad: 1 }], macroVars: { probeMax: 40, no: 'x' } }] }));
    const st = loadDevices();
    assert.deepEqual(st.devices[0].macros, [{ id: 'a', name: 'Air', gcode: 'M8' }]);
    assert.deepEqual(st.devices[0].macroVars, { probeMax: 40 });
  });
});

console.log(`${passed} macro tests passed`);
