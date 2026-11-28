// Job graph (#551): compiling, cleaning, and what the steps do to the job and its G-code. Run: npm run test:job-graph
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, estimate, gcodeInserts, newDevice, prepareGCode, rotaryMoves, startHere, writeGCode, type Device } from '../src/gcode';
import { checkCustomGcode, cleanJobGraph, compileJobGraph, defaultJobGraph, stepDeviations, type JobGraph } from '../src/jobGraph';
import { defaultImageLayer, defaultLayer, loadDoc, type Layer, type Obj } from '../src/model';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const sq = (x: number, y: number, s: number) => ({ closed: true, nodes: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });
/** Layer 1: a plate with two holes; layer 2: a small square to engrave */
function sample(graph?: JobGraph) {
  const objs: Obj[] = [
    { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [sq(50, 50, 100), sq(70, 70, 10), sq(120, 120, 10)] } },
    { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 2, shape: { kind: 'path', subs: [sq(200, 200, 20)] } },
  ];
  return loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {}, ...(graph ? { jobGraph: graph } : {}) });
}
const layers: Record<number, Layer> = {
  1: { ...defaultLayer(1), mode: 'line', speed: 600, power: 90, priority: 1 },
  2: { ...defaultLayer(2), mode: 'line', speed: 3000, power: 20, priority: 0 },
};
const device: Device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute', returnHome: false };
const run = (doc: ReturnType<typeof sample>, d: Device = device) =>
  buildJob({ doc, layer: (i) => layers[i] ?? defaultLayer(i), imgLayer: () => defaultImageLayer(), device: d });
const gcode = async (doc: ReturnType<typeof sample>, d: Device = device) => {
  const job = await run(doc, d);
  return { job, lines: writeGCode(job, d, estimate(job.moves, d)).lines.filter((l) => !l.startsWith('; Erzeugt')) };
};

/** Graph: start → ops in the given order → end, each op fed by a layer node (optionally through split/order) */
function chain(ops: { layer: number; part?: 'inner' | 'outer'; order?: string; over?: object; before?: string; after?: string }[], extra: { at: number; node: object }[] = []): JobGraph {
  const nodes: object[] = [{ id: 'start', kind: 'start', x: 0, y: 0 }];
  const edges: object[] = [];
  let prev = 'start';
  const seq = (id: string) => (edges.push({ from: prev, out: 'next', to: id, in: 'prev' }), (prev = id));
  ops.forEach((o, k) => {
    for (const e of extra.filter((x) => x.at === k)) (nodes.push(e.node), seq((e.node as { id: string }).id));
    const id = `op${k}`;
    nodes.push({ id, kind: 'op', x: 0, y: 0, over: o.over, before: o.before, after: o.after }, { id: `l${k}`, kind: 'layer', layer: o.layer, x: 0, y: 0 });
    let src = `l${k}`,
      port = 'objs';
    if (o.part) {
      nodes.push({ id: `s${k}`, kind: 'split', x: 0, y: 0 });
      edges.push({ from: src, out: port, to: `s${k}`, in: 'objs' });
      (src = `s${k}`), (port = o.part);
    }
    if (o.order) {
      nodes.push({ id: `o${k}`, kind: 'order', preset: o.order, x: 0, y: 0 });
      edges.push({ from: src, out: port, to: `o${k}`, in: 'objs' });
      (src = `o${k}`), (port = 'objs');
    }
    edges.push({ from: src, out: port, to: id, in: 'objs' });
    seq(id);
  });
  for (const e of extra.filter((x) => x.at === ops.length)) (nodes.push(e.node), seq((e.node as { id: string }).id));
  nodes.push({ id: 'end', kind: 'end', x: 0, y: 0 });
  seq('end');
  return cleanJobGraph({ v: 1, enabled: true, nodes, edges })!;
}

await test('Default graph from the layers gives byte-identical G-code', async () => {
  const plain = await gcode(sample());
  const withGraph = await gcode(sample(defaultJobGraph([2, 1])));
  assert.deepEqual(withGraph.lines, plain.lines);
  assert.deepEqual(withGraph.job.warnings, plain.job.warnings);
});

await test('A switched-off graph changes nothing', async () => {
  const g = chain([{ layer: 1 }]);
  g.enabled = false;
  assert.deepEqual((await gcode(sample(g))).lines, (await gcode(sample())).lines);
});

await test('Graph order wins over layer priority', async () => {
  const { job } = await gcode(sample(chain([{ layer: 1 }, { layer: 2 }])));
  const mv = job.moves;
  const firstBurn = [...Array(mv.n).keys()].find((i) => mv.s[i] > 0)!;
  assert.equal(mv.layer[firstBurn], 1, 'layer 1 first, although layer 2 has the lower priority');
});

await test('Split: inner holes before the plate outline, nothing left over', async () => {
  const { job } = await gcode(sample(chain([{ layer: 2 }, { layer: 1, part: 'inner' }, { layer: 1, part: 'outer' }])));
  const mv = job.moves;
  // burning moves of layer 1 in order: the last contour must be the 100 mm plate (x from 50 to 150)
  const xs: number[] = [];
  for (let i = 0; i < mv.n; i++) if (mv.layer[i] === 1 && mv.s[i] > 0) xs.push(mv.x[i]);
  const tail = xs.slice(-4);
  assert.ok(tail.some((x) => x === 150) && tail.some((x) => x === 50), `plate last, got ${tail}`);
  assert.ok(!job.warnings.some((w) => w.includes('keinem Schritt')), job.warnings.join('\n'));
});

await test('Contours no step uses are reported', async () => {
  const { job } = await gcode(sample(chain([{ layer: 2 }, { layer: 1, part: 'outer' }])));
  assert.ok(job.warnings.some((w) => w.includes('2 Konturen') && w.includes('keinem Schritt')), job.warnings.join('\n'));
});

await test('Override changes power and speed of its step only, and is reported', async () => {
  const g = chain([{ layer: 2 }, { layer: 1, over: { power: 50, speed: 900 } }]);
  const { job, lines } = await gcode(sample(g));
  const mv = job.moves;
  for (let i = 0; i < mv.n; i++) {
    if (mv.layer[i] === 1 && mv.f[i] > 0) assert.deepEqual([mv.f[i], Math.round(mv.s[i] * 100)], [900, 50]);
    if (mv.layer[i] === 2 && mv.f[i] > 0) assert.deepEqual([mv.f[i], Math.round(mv.s[i] * 100)], [3000, 20]);
  }
  assert.ok(lines.some((l) => l.includes('S500') && l.includes('F900')));
  assert.equal(stepDeviations(g).length, 1);
  assert.ok(job.warnings.some((w) => w.includes('weicht von den Layer-Einstellungen ab')));
});

await test('Pause: laser off, M0, laser mode again, next cut writes S and F again', async () => {
  const g = chain([{ layer: 2 }, { layer: 1 }], [{ at: 1, node: { id: 'p', kind: 'pause', message: 'Rauch absaugen?', x: 0, y: 0 } }]);
  const { lines } = await gcode(sample(g));
  const k = lines.indexOf('M0');
  assert.ok(k > 0, lines.join('\n'));
  assert.deepEqual(lines.slice(k - 2, k + 2), ['M5', '; Rauch absaugen?', 'M0', 'M4 S0']);
  const nextCut = lines.slice(k).find((l) => l.startsWith('G1'))!;
  assert.match(nextCut, /^G1 .*S900 F600$/);
  const after = lines.slice(k + 2).find((l) => /^G[01]/.test(l))!;
  assert.match(after, /^G0 X\S+ Y\S+$/, 'first move after the pause writes X and Y again');
});

await test('Pause is skipped on firmware without M0 support', async () => {
  const g = chain([{ layer: 1 }], [{ at: 1, node: { id: 'p', kind: 'pause', message: '', x: 0, y: 0 } }]);
  const d = { ...device, ...newDevice({ fw: 'smoothie' }), startFrom: 'absolute' as const, returnHome: false };
  const { job, lines } = await gcode(sample(g), d);
  assert.ok(!lines.includes('M0'));
  assert.ok(job.warnings.some((w) => w.includes('Pausen')));
});

await test('Own G-code: node lines, before/after a step, and at the end', async () => {
  const g = chain([{ layer: 2, after: 'G4 P5' }, { layer: 1, before: 'M7' }], [{ at: 2, node: { id: 'gc', kind: 'gcode', code: 'M9\n', x: 0, y: 0 } }]);
  const { lines } = await gcode(sample(g));
  const k5 = lines.indexOf('G4 P5'),
    k7 = lines.indexOf('M7');
  assert.ok(k5 > 0 && k7 > k5, lines.join('\n'));
  // the end node lines come after the last cut and before the footer
  const k9 = lines.lastIndexOf('M9');
  assert.ok(k9 > lines.findLastIndex((l) => l.startsWith('G1')) && k9 < lines.indexOf('M2'));
});

await test('Unsafe own G-code stops the job with a message', async () => {
  for (const code of ['G28', '$H', 'G20', 'M2', 'G91\nG0 X5', 'M3 S2000', 'G92 X0']) {
    const g = chain([{ layer: 1, before: code }]);
    await assert.rejects(run(sample(g)), /Laser-Ablauf/, code);
  }
  assert.deepEqual(checkCustomGcode(['G4 P2 ; cool down', 'M7', 'G91', 'G0 Z-1', 'G90', 'M3 S1000'], 1000), []);
});

await test('Frame: travel around the next step, back to where it started, laser off', async () => {
  const g = chain([{ layer: 2 }, { layer: 1 }], [{ at: 1, node: { id: 'f', kind: 'frame', x: 0, y: 0 } }]);
  const plain = await run(sample(chain([{ layer: 2 }, { layer: 1 }])));
  const { job } = await gcode(sample(g));
  assert.equal(job.moves.n, plain.moves.n + 6);
  // bed y is up: the plate spans x 50…150, y 250…350
  const fr = [...Array(6).keys()].map((k) => {
    const i = [...Array(job.moves.n).keys()].find((i) => job.moves.layer[i] === 1)! + k;
    return [job.moves.x[i], job.moves.y[i], job.moves.s[i]];
  });
  assert.deepEqual(fr.slice(0, 5).map(([x, y]) => [x, y]), [[50, 250], [150, 250], [150, 350], [50, 350], [50, 250]]);
  assert.ok(fr.every(([, , s]) => s === 0));
});

await test('Insert lines survive the rotary transform, "start here" and the native params', async () => {
  const g = chain([{ layer: 2 }, { layer: 1, before: 'M7' }]);
  const job = await run(sample(g));
  const at = [...job.moves.code.keys()][0];
  const rot = { ...device, rotary: { ...device.rotary, enabled: true } };
  const r = rotaryMoves(job.moves, rot, job.bounds).mv;
  assert.ok([...r.code.values()].some((ls) => ls.includes('M7')));
  assert.ok(at > 1);
  const sh = startHere(job.moves, 1, 0);
  assert.ok([...sh.code.values()].some((ls) => ls.includes('M7')), 'after the resume point');
  assert.ok(![...startHere(job.moves, at + 1, 0).code.values()].length, 'before the resume point: skipped');
  assert.ok(gcodeInserts(job.moves, device).some(([i, ls, o]) => i === at && o === 'node' && ls.includes('M7')));
  const p = await prepareGCode(job, device, estimate(job.moves, device));
  assert.ok(p.lines!.includes('M7'));
});

await test('Cleaning: bad wires and nodes are dropped, a cycle is an error', () => {
  const g = cleanJobGraph({
    v: 1,
    nodes: [
      { id: 'start', kind: 'start' },
      { id: 'a', kind: 'op' },
      { id: 'b', kind: 'pause', message: 'x' },
      { id: 'x', kind: 'nonsense' },
      { id: 'l', kind: 'layer', layer: 'no' },
    ],
    edges: [
      { from: 'start', out: 'next', to: 'a', in: 'prev' },
      { from: 'a', out: 'next', to: 'b', in: 'prev' },
      { from: 'b', out: 'next', to: 'a', in: 'prev' }, // second wire into the same input: dropped
      { from: 'start', out: 'next', to: 'a', in: 'objs' }, // wrong port type
    ],
  })!;
  assert.deepEqual(g.nodes.map((n) => n.id), ['start', 'a', 'b']);
  assert.equal(g.edges.length, 2);
  g.edges.push({ from: 'b', out: 'next', to: 'start', in: 'prev' });
  const looped = cleanJobGraph({ ...g, nodes: [...g.nodes], edges: [{ from: 'start', out: 'next', to: 'a', in: 'prev' }, { from: 'a', out: 'next', to: 'b', in: 'prev' }] })!;
  looped.edges.push({ from: 'b', out: 'next', to: 'a', in: 'prev' });
  assert.ok(compileJobGraph(looped).errors.length);
});

await test('Stored graph survives a save/load round trip', () => {
  const g = chain([{ layer: 1, part: 'inner', order: 'ltr', over: { power: 40 } }]);
  const doc = sample(g);
  const back = loadDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(back.jobGraph, g);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
