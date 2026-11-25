// Host function hinge: the living hinge patterns of the app for plugins, the same cuts as the Living hinge tool,
// with codes the app turns into texts. Aufruf: npm run test:plugins
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Obj, SubPath } from '../src/model';
const gl = globalThis as Record<string, unknown>;
const mem = new Map<string, string>([['kizamubeam.lang', 'en']]);
gl.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { setQuickJSWasm, EngineError } = await import('../src/plugins/engine');
const qjs = readFileSync(new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm', import.meta.url));
setQuickJSWasm(qjs.buffer.slice(qjs.byteOffset, qjs.byteOffset + qjs.byteLength));
const { hostCaller } = await import('../src/plugins/hostfns');
const { inProcess } = await import('../src/plugins/client');
const { checkGenResult } = await import('../src/plugins/contract');
const { parsePack } = await import('../src/packs');
const { pluginWords } = await import('../src/plugins/words');
const { computeHinge, DEFAULT_HINGE } = await import('../src/hinges');
const { IDENT } = await import('../src/model');

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const call = (input: unknown, allowed = ['hinge']) => JSON.parse(hostCaller(allowed)('hinge', JSON.stringify(input))) as { ok?: Record<string, unknown>; error?: string };
const rectSub = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const round = (subs: unknown) => JSON.parse(JSON.stringify(subs), (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
const obj = (subs: SubPath[]): Obj => ({ id: 1, layer: 0, m: IDENT, shape: { kind: 'path', subs } }) as Obj;

await test('the same cuts as the Living hinge tool, for every pattern', () => {
  // A plate with a hole: the cuts stay out of the hole
  const area = [rectSub(0, 0, 120, 60), rectSub(50, 20, 20, 20)];
  for (const kind of ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'] as const)
    for (const extra of [{}, { orient: 'vertical' as const, margin: 5 }, { orient: 'angle' as const, angle: 30, bridge: 2 }]) {
      const r = call({ area, kind, ...extra });
      const tool = computeHinge([obj(area)], { ...DEFAULT_HINGE, kind, ...extra });
      assert.ok(!tool.error && tool.subs.length > 0, kind);
      assert.equal(r.ok!.v, 1);
      assert.deepEqual(round(r.ok!.subs), round(tool.subs), `${kind} ${JSON.stringify(extra)}`);
      assert.equal((r.ok!.info as unknown[]).length, 1);
    }
});

await test('vertical cuts across a strip, with bridges; none in the margin', () => {
  const r = call({ area: [rectSub(0, 0, 200, 40)], kind: 'straight', orient: 'vertical', cutLength: 10, bridge: 2, spacing: 1.5, margin: 4 });
  const subs = r.ok!.subs as SubPath[];
  assert.ok(subs.length > 100);
  for (const s of subs) {
    assert.equal(s.closed, false);
    assert.ok(Math.abs(s.nodes[0].x - s.nodes[1].x) < 1e-9, 'vertical');
    for (const p of s.nodes) assert.ok(p.x >= 4 - 1e-6 && p.x <= 196 + 1e-6 && p.y >= 4 - 1e-6 && p.y <= 36 + 1e-6, JSON.stringify(p));
  }
  assert.deepEqual((r.ok!.info as { code: string }[]).map((m) => m.code), ['hinge-rows-info']);
});

await test('a pattern that does not fit answers with an error code; the app writes the text', () => {
  assert.deepEqual(call({ area: [rectSub(0, 0, 10, 10)], kind: 'straight', margin: 6 }).ok, { v: 1, error: { code: 'hinge-margin' } });
  assert.deepEqual(call({ area: [rectSub(0, 0, 50, 50)], kind: 'straight', bridge: 0.1 }).ok, { v: 1, error: { code: 'hinge-bridge' } });
  assert.deepEqual(call({ area: [], kind: 'wave' }).ok, { v: 1, error: { code: 'hinge-no-area' } });
  const many = call({ area: [rectSub(0, 0, 3000, 3000)], kind: 'straight', cutLength: 1, bridge: 0.3, spacing: 0.3 }).ok!;
  assert.equal((many.error as { code: string }).code, 'hinge-too-many-rows');
});

await test('bad input is refused', () => {
  const area = [rectSub(0, 0, 50, 50)];
  for (const input of [
    null, [], { area }, { area, kind: 'zigzag' }, { area, kind: 'straight', v: 2 }, { area, kind: 'straight', evil: 1 },
    { area, kind: 'straight', orient: 'diagonal' }, { area, kind: 'straight', cutLength: -1 }, { area, kind: 'straight', keepOutline: true },
    { area: 'x', kind: 'straight' }, { kind: 'straight' },
  ])
    assert.deepEqual(call(input), { error: 'host-bad-input' }, JSON.stringify(input)?.slice(0, 90));
  assert.deepEqual(call({ area, kind: 'straight' }, ['joints']), { error: 'host-not-allowed' });
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PLUGIN = `globalThis.plugin = {
  validate: (p) => {
    const r = host.hinge({ area: [{ closed: true, nodes: [{x:0,y:0},{x:100,y:0},{x:100,y:p.height},{x:0,y:p.height}] }], kind: 'straight', orient: 'vertical', margin: 5 });
    return r.error ? [{ level: 'error', code: r.error.code, values: r.error.values }] : [];
  },
  generate: (p) => {
    const outline = { closed: true, nodes: [{x:0,y:0},{x:100,y:0},{x:100,y:p.height},{x:0,y:p.height}] };
    const r = host.hinge({ area: [outline], kind: 'straight', orient: 'vertical', margin: 5 });
    return { parts: [{ key: 'strip', at: { x: 0, y: 0 }, subs: [outline, ...r.subs] }], info: [['cuts', r.info]] };
  },
};`;
const manifest = (host: string[]) =>
  parsePack(JSON.stringify({
    format: 'kizamubeam-pack', formatVersion: 2, id: 'com.example.hinge', version: '1.0.0', name: 'Hinge example',
    plugins: [{ id: 'com.example.bent', type: 'generator', api: 1, kind: 'part', runtime: 'js', code: PLUGIN, sha256: sha(PLUGIN), host,
      params: [{ key: 'height', type: 'length', def: 40, min: 1, max: 500 }], texts: { en: { name: 'Bent strip', desc: 'Uses hinge', height: 'Height', cuts: 'Cuts' } } }],
  })).plugins[0];

await test('a JS plugin uses host.hinge; info and errors in the interface language', async () => {
  const m = manifest(['hinge']);
  const p = inProcess('js', PLUGIN, m.host ?? []);
  const r = checkGenResult(await p.call('generate', { height: 40 }));
  assert.equal(r.parts.length, 1);
  assert.ok(r.parts[0].subs.length > 20, 'outline and cuts');
  const words = pluginWords(m);
  assert.match(words.render(r.info[0][1]), /^\d+ cuts in \d+ rows, [\d.]+ m of cuts in total$/);
  const issues = await p.call('validate', { height: 8 }) as { level: 'error'; code: string }[];
  assert.equal(words.issue(issues[0]).msg, 'The margin is too large for the shape, no area is left.');
  const q = inProcess('js', PLUGIN, []);
  try {
    await q.call('generate', { height: 40 });
    assert.fail('no error');
  } catch (e) {
    assert.ok(e instanceof EngineError && e.code === 'host-not-allowed', String(e));
  }
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall plugin hinge tests passed');
