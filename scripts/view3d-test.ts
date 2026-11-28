// Tests der 3D-Ansicht: Baugruppen in Lage bringen und auf Durchdringungen prüfen. Aufruf: npm run test:3d
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Params } from '../src/generators';
import './builtin-generators';
import type { Solid } from '../src/view3d/solids';
const { asmSolids, findOverlaps, solidBounds } = await import('../src/view3d/solids');
const { rotatePose } = await import('../src/view3d/poses');
const { defaultParams, getGenerator } = await import('../src/generators/index');
const { computeJoint, jointMate, DEFAULT_JOINT } = await import('../src/joints');
const { assembleMates } = await import('../src/view3d/mates');
const solidsMod = await import('../src/view3d/solids');
const { subsPolys } = solidsMod;
const { sphereLayout } = await import('../src/generators/discsphere');
import type { Obj, Mate } from '../src/model';
import type { JointOptions } from '../src/joints';
const { loadDoc, IDENT } = await import('../src/model');
const { collectScene } = await import('../src/view3d/panel');
const { computeBlueprintLayout, computeOrthoScale } = await import('../src/view3d/blueprint');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≠ ${b} (±${eps})`);

function solids(gen: string, o: Params = {}): Solid[] {
  const s = asmSolids(gen, { ...defaultParams(getGenerator(gen)!), ...o }, 3);
  assert.ok(s && s.length, `${gen}: keine Teile`);
  return s!;
}
function bounds(s: Solid[]) {
  const b = s.map(solidBounds);
  return [0, 1, 2].map((k) => [Math.min(...b.map((x) => x.min[k])), Math.max(...b.map((x) => x.max[k]))]);
}
const pairs = (s: Solid[]) => findOverlaps(s).map((o) => `${o.a}/${o.b}`);

test('Mehrlagenarbeit: Platten bleiben über Seiten verknüpft und stapeln sich bündig', () => {
  const rect = (id: number, x: number, y: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w: 40, h: 30, r: 0 } });
  const lower = rect(901, 20, 20), upper = rect(902, 180, 90);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [lower] }, { name: 'B', objs: [upper] }], multiLayerAssemblies: [{ id: 'layers', plates: [
    { object: 901, name: 'Basis', thickness: 2, look: { id: 'birch' }, anchor: IDENT },
    { object: 902, name: 'Decklage', thickness: 4, look: { id: 'acrylic' }, anchor: IDENT },
  ] }] });
  const ed = { doc, sel: [lower], layer: () => ({ mode: 'line', output: true, show: true, material: undefined }) } as never;
  const scene = collectScene(ed, 3, false).scene;
  assert.equal(scene.solids.length, 2);
  assert.deepEqual(scene.solids.map((s) => s.label), ['Basis', 'Decklage']);
  assert.deepEqual(scene.solids.map((s) => [s.pose.o[2], s.th]), [[0, 2], [2, 4]]);
  const centers = scene.solids.map((s) => {
    const b = solidBounds(s);
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
  });
  assert.deepEqual(centers[0], centers[1]);
  assert.deepEqual(pairs(scene.solids), []);
});

test('Box: Platten ergeben den Kasten, mit Spiel ohne und mit Presspassung mit Durchdringung', () => {
  for (const o of [{ top: 'closed' }, { top: 'open', width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6 }]) {
    const s = solids('box', o);
    assert.deepEqual(pairs(s), [], JSON.stringify(o));
  }
  const s = solids('box', { top: 'closed', width: 120, depth: 80, height: 60 });
  const b = bounds(s);
  [120, 80, 60].forEach((len, k) => (near(b[k][0], 0, 1e-6, 'Anfang'), near(b[k][1], len, 1e-6, 'Ende')));
  assert.deepEqual(pairs(solids('box', { top: 'closed', clearance: 0.3 })), []);
  // Jede der zwölf Kanten greift ineinander
  const press = findOverlaps(solids('box', { top: 'closed', clearance: -0.3 }));
  assert.equal(press.length, 12, press.map((o) => `${o.a}/${o.b}`).join(' '));
  assert.ok(press.every((o) => o.pieces.length > 0 && o.volume > 0.01));
});

test('Überschneidungen: Rundungsrauschen (1 µm) gilt als Berührung, echte Durchdringung bleibt', () => {
  // Fachtiefe 28,533… wird im Umriss gerundet, die Lage der Trennwand nicht
  const rounded = solids('box-divided', { width: 150, depth: 100, height: 60, thickness: 3.6, top: 'open', compartmentsX: 3, compartmentsY: 3, dividerDrop: 2 });
  assert.deepEqual(pairs(rounded), []);
  // 0,1 mm tiefes Eindringen wird weiterhin gemeldet
  const [a, b] = [0, 0.1].map((dz) => ({ key: dz ? 'b' : 'a', label: '', pose: { o: [0, 0, dz] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number], n: [0, 0, 1] as [number, number, number] }, th: 3, polys: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]] }));
  assert.equal(findOverlaps([a, b]).length, 1);
  assert.equal(findOverlaps([a, { ...b, pose: { ...b.pose, o: [0, 0, 2.995] as [number, number, number] } }]).length, 0);
});

test('Overlaps: plates in one plane that meet edge to edge count as touching up to the tolerance', () => {
  const plate = (key: string, x: number): Solid => ({ key, label: '', th: 3, pose: { o: [x, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, polys: [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 50 }, { x: 0, y: 50 }]] });
  assert.equal(findOverlaps([plate('a', 0), plate('b', 19.995)]).length, 0, '5 µm');
  assert.equal(findOverlaps([plate('a', 0), plate('b', 19.9)]).length, 1, '0.1 mm');
});

test('Box mit Trennwänden: offene und geschlossene Kisten mit individuellen Trennwänden', () => {
  const cases: Params[] = [
    { top: 'open' }, { top: 'closed' },
    { top: 'open', compartmentsX: 3, ratiosX: '1:2:1' },
    { top: 'open', compartmentsY: 2, ratiosY: '1:1' },
    { top: 'open', compartmentsX: 3, compartmentsY: 2, ratiosX: '33mm:50mm*2:1', ratiosY: '1:1' },
    { top: 'closed', compartmentsX: 3, compartmentsY: 2, ratiosX: '33mm:50mm*2:1', ratiosY: '1:1' },
  ];
  for (const options of cases) {
    const assembled = solids('box-divided', { width: 300, depth: 200, height: 100, thickness: 6, finger: 20, dividerDrop: 10, ...options });
    assert.equal(assembled.length, (options.top === 'closed' ? 6 : 5) + Number(options.compartmentsX ?? 1) + Number(options.compartmentsY ?? 1) - 2);
    assert.deepEqual(pairs(assembled), [], JSON.stringify(options));
    const b = bounds(assembled);
    [300, 200, 100].forEach((value, axis) => { near(b[axis][0], 0, 1e-6); near(b[axis][1], value, 1e-6); });
  }
  assert.equal(asmSolids('box-divided', { ...defaultParams(getGenerator('box-divided')!), compartmentsX: 3, ratiosX: '10000mm:1:1' }, 3), null);
});

test('Schublade: Schubkasten im Korpus, Blende davor, nichts durchdringt sich', () => {
  for (const o of [{}, { front: 'inset' }, { carcass: false }, { sidePlay: 0, topPlay: 0, backPlay: 0 }, { front: 'none', handle: 'none' }]) assert.deepEqual(pairs(solids('drawer', o)), [], JSON.stringify(o));
  const b = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3 }));
  near(b[0][0], 0, 1e-6, 'links');
  near(b[0][1], 160, 1e-6, 'rechts');
  near(b[1][0], -3, 1e-6, 'Blende vorne');
  near(b[1][1], 150, 1e-6, 'hinten');
  near(b[2][1], 80, 1e-6, 'oben');
  // Schubkasten mit der Luft in der Öffnung des Korpus
  const d = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3, sidePlay: 1, topPlay: 2, backPlay: 2 }).filter((x) => x.key.startsWith('d_')));
  assert.deepEqual(d, [[4, 156], [0, 145], [3, 75]]);
  // Presspassung nur innerhalb von Korpus und Schubkasten
  const press = findOverlaps(solids('drawer', { clearance: -0.3 }));
  assert.ok(press.length > 0);
  assert.ok(press.every((o) => o.a.slice(0, 2) === o.b.slice(0, 2)), press.map((o) => `${o.a}/${o.b}`).join(' '));
});

test('Einsatz: Stege kreuzen sich in den Schlitzen', () => {
  assert.deepEqual(pairs(solids('insert', {})), []);
  assert.deepEqual(pairs(solids('insert', { play: 0 })), []);
  const press = findOverlaps(solids('insert', { cellsX: 4, cellsY: 3, play: -0.3 }));
  assert.equal(press.length, 3 * 2, 'jede Kreuzung');
  const b = bounds(solids('insert', { width: 150, depth: 100, height: 40, endPlay: 0.5 }));
  near(b[1][1] - b[1][0], 99.5, 1e-6, 'Längsstege');
  near(b[2][1] - b[2][0], 40, 1e-6, 'Höhe');
});

test('Steckregal: Böden stecken in den Seiten', () => {
  for (const o of [{}, { play: 0 }, { shelves: 5, width: 420, depth: 200, height: 600, thickness: 6, overhang: 0 }]) assert.deepEqual(pairs(solids('shelf', o)), [], JSON.stringify(o));
  const press = findOverlaps(solids('shelf', { shelves: 3, play: -0.3 }));
  assert.equal(press.length, 2 * 3, press.map((o) => `${o.a}/${o.b}`).join(' '));
  const b = bounds(solids('shelf', { width: 300, depth: 150, height: 300 }));
  near(b[0][1] - b[0][0], 300, 1e-6, 'Breite');
  near(b[2][1], 300, 1e-6, 'Höhe');
});

test('Zahnradpaar: Räder greifen ineinander und drehen sich ohne Durchdringung', () => {
  for (const o of [{}, { teeth1: 13, teeth2: 30 }, { teeth1: 9, teeth2: 9, profileShift: 0.3 }, { plate: false }] as Params[]) {
    const s = solids('gearpair', o);
    const z1 = Number(o.teeth1 ?? defaultParams(getGenerator('gearpair')!).teeth1);
    // Über eine Zahnteilung von Rad 1 drehen
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * ((2 * Math.PI) / z1);
      const turned = s.map((x) => (x.spin ? { ...x, pose: rotatePose(x.pose, a * x.spin) } : x));
      assert.deepEqual(pairs(turned), [], `${JSON.stringify(o)} bei ${a}`);
    }
  }
  // Ohne Flankenspiel und um einen halben Zahn verdreht greifen die Zähne aufeinander
  const s = solids('gearpair', { teeth1: 12, teeth2: 20, plate: true });
  const wrong = s.map((x) => (x.key === 'gear2' ? { ...x, pose: rotatePose(x.pose, Math.PI / 20) } : x));
  assert.deepEqual(pairs(wrong), ['gear1/gear2']);
  // Räder liegen auf der Platte
  const plate = s.find((x) => x.key === 'plate')!;
  near(solidBounds(s.find((x) => x.key === 'gear1')!).min[2], solidBounds(plate).max[2], 1e-9, 'auf der Platte');
});

test('Teile ohne räumlichen Aufbau', () => {
  assert.equal(asmSolids('gear', defaultParams(getGenerator('gear')!), 3), null);
  assert.equal(asmSolids('unbekannt', {}, 3), null);
  const some = asmSolids('box', { ...defaultParams(getGenerator('box')!), top: 'closed' }, 3, new Set(['front', 'left']))!;
  assert.deepEqual(some.map((x) => x.key).sort(), ['front', 'left']);
});

// ---------- Teile aus dem Verbindungs-Werkzeug ----------

const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
let nid = 1;
const rect = (x: number, y: number, w: number, h: number): Obj => ({
  id: nid++, m: [...I], layer: 0,
  shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }] },
});
/** Verbindung wie im Editor anwenden und merken (Weltmatrix = Identität, lokal = Welt) */
function join(a: Obj, segA: number, b: Obj, segB: number, o: Partial<JointOptions>) {
  const opt = { ...DEFAULT_JOINT, ...o };
  const picks = [{ obj: a, m: I, sub: 0, seg: segA }, { obj: b, m: I, sub: 0, seg: segB }];
  const mw = jointMate(picks, opt);
  const r = computeJoint(picks, opt);
  assert.ok(!r.error, r.error);
  for (const [obj, c] of r.changes) obj.shape = { kind: 'path', subs: c.subs };
  assert.ok(mw, 'keine Lage');
  const m: Mate = { to: b.id, kind: opt.kind, th: opt.thickness, a: mw!.a, b: mw!.b, ...(mw!.out ? { out: true } : {}), ...(mw!.lap ? { lap: mw!.lap } : {}) };
  a.mates = [...(a.mates ?? []), m];
}
function assembled(objs: Obj[]) {
  const parts = objs.map((o) => ({ id: o.id, label: String(o.id), polys: subsPolys((o.shape as { subs: never }).subs), m: I, mates: o.mates ?? [] }));
  return assembleMates(parts, 3).solids;
}
const perp = (a: Solid, b: Solid) => Math.abs(a.pose.n[0] * b.pose.n[0] + a.pose.n[1] * b.pose.n[1] + a.pose.n[2] * b.pose.n[2]) < 1e-9;

test('Verbindungen: Fingerzinken stellen die Wand senkrecht an die Kante', () => {
  for (const direction of ['in', 'out'] as const) {
    for (const clearance of [0, 0.2]) {
      const bottom = rect(0, 0, 100, 80),
        front = rect(0, 100, 100, 50);
      // Unterkante des Bodens (Segment 2) mit Oberkante der Wand (Segment 0)
      join(bottom, 2, front, 0, { kind: 'finger', direction, clearance, thickness: 3, fingerWidth: 10 });
      const s = assembled([bottom, front]);
      assert.equal(s.length, 2);
      assert.ok(perp(s[0], s[1]), 'nicht senkrecht');
      assert.deepEqual(pairs(s), [], `${direction} ${clearance}`);
      const b = bounds(s);
      near(b[2][1] - b[2][0], direction === 'in' ? 50 : 53, 1e-6, `Höhe ${direction}`);
      near(b[1][1] - b[1][0], direction === 'in' ? 80 : 83, 1e-6, `Tiefe ${direction}`);
    }
    const bottom = rect(0, 0, 100, 80),
      front = rect(0, 100, 100, 50);
    join(bottom, 2, front, 0, { kind: 'finger', direction, clearance: -0.2 });
    assert.equal(findOverlaps(assembled([bottom, front])).length, 1, `Presspassung ${direction}`);
  }
});

test('Verbindungen: Box aus Boden und vier Wänden', () => {
  // Außenmaß 100 × 80 × 50, Zinken nach innen, jede Wand mit dem Boden verbunden
  const bottom = rect(0, 0, 100, 80);
  const front = rect(0, 100, 100, 50),
    back = rect(0, 160, 100, 50),
    left = rect(120, 100, 80, 50),
    right = rect(120, 160, 80, 50);
  const o = { kind: 'finger' as const, direction: 'in' as const, thickness: 3, fingerWidth: 10 };
  // Hinten anfangen: eingefügte Zinken verschieben die Nummern der folgenden Segmente
  join(bottom, 3, left, 2, o);
  join(bottom, 2, front, 2, o);
  join(bottom, 1, right, 2, o);
  join(bottom, 0, back, 2, o);
  const s = assembled([bottom, front, back, left, right]);
  const b = bounds(s);
  near(b[0][1] - b[0][0], 100, 1e-6, 'Breite');
  near(b[1][1] - b[1][0], 80, 1e-6, 'Tiefe');
  near(b[2][1] - b[2][0], 50, 1e-6, 'Höhe');
  // Nur der Boden ist verbunden: jede Wand berührt ihn ohne Durchdringung
  const touch = findOverlaps(s).filter((x) => [x.a, x.b].includes(String(bottom.id)));
  assert.deepEqual(touch.map((x) => `${x.a}/${x.b}`), []);
});

test('Verbindungen: Zapfen stecken in den Schlitzen der Gegenplatte', () => {
  for (const kind of ['tenon', 'wedge', 'snap', 'tslot'] as const) {
    const plate = rect(0, 0, 100, 80),
      wall = rect(200, 0, 60, 40);
    // Unterkante der Wand (Segment 2) bekommt Zapfen, die Oberkante der Platte (Segment 0) mit 20 mm Abstand die Schlitze
    join(wall, 2, plate, 0, { kind, tenonCount: 2, tenonWidth: 10, slotOffset: 20, thickness: 3 });
    const s = assembled([wall, plate]);
    assert.ok(perp(s[0], s[1]), `${kind}: nicht senkrecht`);
    assert.deepEqual(pairs(s), [], kind);
  }
  const plate = rect(0, 0, 100, 80),
    wall = rect(200, 0, 60, 40);
  join(wall, 2, plate, 0, { kind: 'tenon', tenonCount: 2, tenonWidth: 10, slotOffset: 20, clearance: -0.2 });
  assert.equal(findOverlaps(assembled([wall, plate])).length, 1, 'Presspassung');
});

// ---------- Joints on curves (#513): the strip is bent round the curve ----------
{
  const { smoothChain } = await import('../src/jointsCurve');
  const { bentPoint } = await import('../src/view3d/mates');
  const K = 0.5522847498;
  /** Circle as four Bézier quarters, like the ellipse tool draws it */
  const circleObj = (cx: number, cy: number, r: number, ry = r): Obj => {
    const k = r * K, ky = ry * K;
    return {
      id: nid++, m: [...I], layer: 0,
      shape: { kind: 'path', subs: [{ closed: true, nodes: [
        { x: cx + r, y: cy, cin: { x: cx + r, y: cy - ky }, cout: { x: cx + r, y: cy + ky } },
        { x: cx, y: cy + ry, cin: { x: cx + k, y: cy + ry }, cout: { x: cx - k, y: cy + ry } },
        { x: cx - r, y: cy, cin: { x: cx - r, y: cy + ky }, cout: { x: cx - r, y: cy - ky } },
        { x: cx, y: cy - ry, cin: { x: cx - k, y: cy - ry }, cout: { x: cx + k, y: cy - ry } },
      ] }] },
    };
  };
  /** Joint like the editor applies and records it, the curve picked as its smooth run */
  const joinCurve = (a: Obj, segA: number, b: Obj, segB: number, o: Partial<JointOptions>) => {
    const opt = { ...DEFAULT_JOINT, ...o };
    const pk = (obj: Obj, seg: number) => {
      const sp = (obj.shape as { subs: never[] }).subs[0];
      const c = smoothChain(sp, seg);
      return { obj, m: I, sub: 0, seg: c.seg, ...(c.segs > 1 ? { segs: c.segs } : {}) };
    };
    const picks = [pk(a, segA), pk(b, segB)];
    const mw = jointMate(picks, opt);
    const r = computeJoint(picks, opt, 2);
    assert.ok(!r.error, r.error);
    for (const [obj, c] of r.changes) obj.shape = { kind: 'path', subs: c.subs };
    assert.ok(mw?.bend, 'no bend recorded');
    const bend = { on: mw!.bend!.on === 0 ? 'a' : 'b', path: mw!.bend!.path, x0: mw!.bend!.x0, z: mw!.bend!.z } as Mate['bend'];
    a.mates = [...(a.mates ?? []), { to: b.id, kind: opt.kind, th: opt.thickness, a: mw!.a, b: mw!.b, ...(mw!.out ? { out: true } : {}), bend }];
  };
  const extent = (s: Solid[]) => bounds(s).map(([lo, hi]) => hi - lo);

  test('Curves in 3D: a strip with fingers round a disc stands bent round it, no overlaps', () => {
    for (const direction of ['in', 'out'] as const) {
      const R = 50, th = 3;
      const disc = circleObj(0, 0, R);
      const L = 2 * Math.PI * (R + (direction === 'in' ? -th / 2 : th / 2));
      const strip = rect(0, 150, L + 0.05, 40);
      // The disc first (fingers on the ring), then the strip's upper edge
      joinCurve(disc, 0, strip, 0, { kind: 'finger', direction, thickness: th, fingerWidth: 10, clearance: 0.1 });
      const s = assembled([disc, strip]);
      assert.ok(s.length > 50, `${s.length} solids`);
      assert.ok(s.filter((x) => x.part === String(strip.id)).length === s.length - 1, 'strip in pieces');
      assert.deepEqual(pairs(s), [], direction);
      const e = extent(s);
      const outer = 2 * R + (direction === 'in' ? 0 : 2 * th);
      near(e[0], outer, 0.05, `width ${direction}`);
      near(e[1], outer, 0.05, `depth ${direction}`);
      near(e[2], direction === 'in' ? 40 : 43, 0.01, `height ${direction}`);
      // A longer strip: the end past the ring (to be cut off) is left out
      const d3 = circleObj(0, 0, R), s3 = rect(0, 150, L + 80, 40);
      joinCurve(d3, 0, s3, 0, { kind: 'finger', direction, thickness: th, fingerWidth: 10, clearance: 0.1 });
      assert.deepEqual(pairs(assembled([d3, s3])), [], `long strip ${direction}`);
      // A press fit shows as overlaps
      const d2 = circleObj(0, 0, R), s2 = rect(0, 150, L + 0.05, 40);
      joinCurve(d2, 0, s2, 0, { kind: 'finger', direction, thickness: th, fingerWidth: 10, clearance: -0.2 });
      assert.ok(findOverlaps(assembled([d2, s2])).length > 0, `press fit ${direction}`);
    }
  });

  test('Curves in 3D: the strip picked first; a lid on its other edge is fitted onto the bent strip', () => {
    const th = 3;
    const floor = circleObj(0, 0, 50), lid = circleObj(300, 0, 50);
    // As long as the ring on the wall middle: the lid's pattern starts at the strip's far end, round the ring where
    // the floor's starts
    const ringLen = 2 * Math.PI * 48.5 + 0.1;
    const strip = rect(0, 150, ringLen, 60);
    // Lower edge of the strip (segment 2, runs right to left) with the lid first, then the upper edge with the floor;
    // the strip picked first both times
    joinCurve(strip, 2, lid, 0, { kind: 'finger', direction: 'in', thickness: th, fingerWidth: 10, clearance: 0.1 });
    // The lid's joint starts the strip's outline at its fingers: find the upper edge again
    const ns = (strip.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0].nodes;
    const top = ns.findIndex((q, i) => q.y === 150 && ns[(i + 1) % ns.length].y === 150 && Math.abs(ns[(i + 1) % ns.length].x - q.x) > 290);
    assert.ok(top >= 0);
    joinCurve(strip, top, floor, 1, { kind: 'finger', direction: 'in', thickness: th, fingerWidth: 10, clearance: 0.1 });
    const parts = [floor, lid, strip].map((o) => ({ id: o.id, label: String(o.id), polys: subsPolys((o.shape as { subs: never }).subs), m: I, mates: o.mates ?? [] }));
    const r = assembleMates(parts, 3);
    const s = r.solids;
    assert.equal(new Set(r.groups.values()).size, 1, 'one assembly');
    assert.deepEqual(pairs(s), []);
    const e = extent(s);
    near(e[2], 60, 0.01, 'height');
    // Floor and lid parallel, the strip between them
    const F = s.find((x) => x.key === String(floor.id))!, Lid = s.find((x) => x.key === String(lid.id))!;
    near(Math.abs(F.pose.n[2]), 1, 1e-6, 'floor flat');
    near(Math.abs(Lid.pose.n[2]), 1, 1e-6, 'lid flat');
    // The two lie face to face: the outline of the upper one 60 over the lower one's, its thickness pointing down
    const [lo, hi] = F.pose.o[2] < Lid.pose.o[2] ? [F, Lid] : [Lid, F];
    near(hi.pose.o[2] - lo.pose.o[2], 60, 1e-3, 'lid height');
    near(lo.pose.n[2], 1, 1e-6, 'lower face up');
    near(hi.pose.n[2], -1, 1e-6, 'upper face down');
    assert.ok(r.frames.has(strip.id));
    // A press fit at the lid shows
    const f2 = circleObj(0, 0, 50), l2 = circleObj(300, 0, 50), s2 = rect(0, 150, ringLen, 60);
    joinCurve(s2, 2, l2, 0, { kind: 'finger', direction: 'in', thickness: th, fingerWidth: 10, clearance: -0.3 });
    const ns2 = (s2.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0].nodes;
    joinCurve(s2, ns2.findIndex((q, i) => q.y === 150 && ns2[(i + 1) % ns2.length].y === 150 && Math.abs(ns2[(i + 1) % ns2.length].x - q.x) > 290), f2, 1, { kind: 'finger', direction: 'in', thickness: th, fingerWidth: 10, clearance: 0.1 });
    const bad = findOverlaps(assembled([f2, l2, s2])).map((o) => [o.a, o.b].sort().join('/'));
    assert.ok(bad.some((x) => x.includes(String(l2.id))), 'lid press fit');
    assert.ok(!bad.some((x) => x.split('/').includes(String(f2.id))), 'floor fits');
  });

  test('Curves in 3D: a lid whose pattern cannot meet the strip stays a separate assembly', () => {
    // An ellipse picked at different places: round the ring the patterns of floor and lid are offset, so the strip
    // cannot hold both
    const floor = circleObj(0, 0, 70, 40), lid = circleObj(300, 0, 70, 40);
    const strip = rect(0, 150, 400, 60);
    joinCurve(strip, 2, lid, 0, { kind: 'finger', direction: 'in', thickness: 3, fingerWidth: 10 });
    const ns = (strip.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0].nodes;
    joinCurve(strip, ns.findIndex((q, i) => q.y === 150 && ns[(i + 1) % ns.length].y === 150 && Math.abs(ns[(i + 1) % ns.length].x - q.x) > 300), floor, 1, { kind: 'finger', direction: 'in', thickness: 3, fingerWidth: 10 });
    const parts = [floor, lid, strip].map((o) => ({ id: o.id, label: String(o.id), polys: subsPolys((o.shape as { subs: never }).subs), m: I, mates: o.mates ?? [] }));
    const r = assembleMates(parts, 3);
    assert.equal(r.placed.size, 3);
    assert.equal(new Set(r.groups.values()).size, 2);
  });

  test('Curves in 3D: tenons on a strip go into slots along a curve in the floor (case A)', () => {
    const R = 50, th = 3, off = 10;
    for (const [extra, tenonCount] of [[0, 6], [40, 5], [120, 2]] as const) {
      const disc = circleObj(0, 0, R);
      const ring = 2 * Math.PI * (R - off);
      const strip = rect(0, 150, ring + extra, 40);
      // The strip's upper edge gets the tenons, the disc's rim the slots (on their line 10 mm inside)
      joinCurve(strip, 0, disc, 0, { kind: 'tenon', thickness: th, tenonCount, tenonWidth: 15, slotOffset: off, clearance: 0.1 });
      const s = assembled([disc, strip]);
      assert.ok(s.filter((x) => x.part === String(strip.id)).length > 50, 'strip bent');
      assert.deepEqual(pairs(s), [], `extra ${extra}`);
      // The tenons go through the floor: from its lower face up to the top of the strip
      near(extent(s)[2], th + 40, 0.01, 'height');
      near(extent(s)[0], 2 * R, 0.01, 'width');
    }
    // A press fit in the slots shows
    const d2 = circleObj(0, 0, R), s2 = rect(0, 150, 2 * Math.PI * (R - off), 40);
    joinCurve(s2, 0, d2, 0, { kind: 'tenon', thickness: th, tenonCount: 6, tenonWidth: 15, slotOffset: off, clearance: 0.1, slotClearance: -0.3 });
    assert.notDeepEqual(pairs(assembled([d2, s2])), [], 'press fit');
  });

  test('Curves in 3D: tenons on the rim of a disc go into slots in the strip round it (case B)', () => {
    const R = 50, th = 3, off = 10;
    for (const [extra, ry, tenonCount] of [[0, R, 6], [30, R, 6], [0, 35, 6], [110, R, 2]] as const) {
      const disc = circleObj(0, 0, R, ry);
      // Length of the ring half a thickness outside the rim: sampled like the joint does it
      const c = smoothChain((disc.shape as { subs: never[] }).subs[0], 0);
      const r0 = computeJoint([{ obj: disc, m: I, sub: 0, seg: c.seg, segs: c.segs }], { ...DEFAULT_JOINT, kind: 'tenon', thickness: th, tenonCount: 6, tenonWidth: 15 }, 2);
      // The joint says it in its text (to a hundredth)
      const len = Number(String(r0.info).match(/([0-9]+,[0-9]+) mm \(/)?.[1].replace(',', '.'));
      assert.ok(len > 0, JSON.stringify(r0.info));
      const strip = rect(0, 150, len + extra, 40);
      // A strip longer than the ring: its slots lie in its middle, the ends beyond one round are left out in 3D
      joinCurve(disc, 0, strip, 0, { kind: 'tenon', thickness: th, tenonCount, tenonWidth: 15, slotOffset: off, clearance: 0.1 });
      const s = assembled([disc, strip]);
      assert.ok(s.filter((x) => x.part === String(strip.id)).length > 50, 'strip bent');
      assert.deepEqual(pairs(s), [], `extra ${extra}, ry ${ry}`);
      // The disc lies in the middle of the slots, 10 mm above the strip's edge
      const D = s.find((x) => x.key === String(disc.id))!;
      const b = bounds(s);
      near(D.pose.o[2] + (D.pose.n[2] > 0 ? 0 : -th) - b[2][0], off - th / 2, 0.01, 'disc height');
      near(extent(s)[2], 40, 0.01, 'height');
    }
  });

  test('Curves in 3D: a floor in slots of the strip and a lid with fingers on its other edge make one assembly', () => {
    const R = 50, th = 3;
    const floor = circleObj(0, 0, R), lid = circleObj(300, 0, R);
    // The ring on the wall middle, outside the floor and the lid alike
    const ring = 2 * Math.PI * (R + th / 2);
    const strip = rect(0, 150, ring + 0.05, 60);
    joinCurve(floor, 0, strip, 0, { kind: 'tenon', thickness: th, tenonCount: 6, tenonWidth: 15, slotOffset: 10, clearance: 0.1 });
    // The strip's lower edge (segment 2) with the lid, fingers out so the lid lies on the strip
    joinCurve(lid, 0, strip, 2, { kind: 'finger', direction: 'out', thickness: th, fingerWidth: 10, clearance: 0.1 });
    const parts = [floor, lid, strip].map((o) => ({ id: o.id, label: String(o.id), polys: subsPolys((o.shape as { subs: never }).subs), m: I, mates: o.mates ?? [] }));
    const r = assembleMates(parts, 3);
    assert.equal(r.placed.size, 3);
    assert.deepEqual(pairs(r.solids), []);
    assert.equal(new Set(r.groups.values()).size, 1, 'one assembly');
  });

  test('Curves in 3D: a point of a bent plate follows its path', () => {
    const pose = { o: [0, 0, 5] as [number, number, number], u: [1, 0, 0] as [number, number, number], v: [0, 0, 1] as [number, number, number], n: [0, 1, 0] as [number, number, number], bend: { path: [[0, 0], [10, 0], [10, 10]] as [number, number][], x0: 2 } };
    const q = bentPoint(pose, 17, 4, 1.5, 3);
    // 2 … 12 along x, then 5 up the second piece; the middle of the plate on the path, y upwards
    near(q[0], 10, 1e-9); near(q[1], 5, 1e-9); near(q[2], 9, 1e-9);
  });
}

test('Verbindungen: Schlitze auf einer Hilfslinie gehören zur Platte darunter', () => {
  const side = rect(0, 0, 120, 160),
    shelf = rect(200, 40, 100, 40);
  const guide: Obj = { id: nid++, m: [...I], layer: 0, shape: { kind: 'path', subs: [{ closed: false, nodes: [{ x: 20, y: 80 }, { x: 100, y: 80 }] }] } };
  // Linke Kante des Regalbodens (Segment 3) bekommt die Zapfen, die Hilfslinie die Schlitze
  join(shelf, 3, guide, 0, { kind: 'tenon', tenonCount: 2, tenonWidth: 15, thickness: 3 });
  shelf.mates![0].to = side.id;
  side.shape = { kind: 'path', subs: [...(side.shape as { subs: never[] }).subs, ...(guide.shape as { subs: never[] }).subs] };
  const s = assembled([shelf, side]);
  assert.ok(perp(s[0], s[1]));
  assert.deepEqual(pairs(s), []);
});

test('Verbindungen: Überblattung kreuzt die Platten', () => {
  for (const [lapDepth, clearance, expect] of [[50, 0, 0], [30, 0.1, 0], [50, -0.2, 1]] as const) {
    const a = rect(0, 0, 100, 40),
      b = rect(0, 60, 120, 40);
    join(a, 0, b, 2, { kind: 'lap', lapCount: 1, lapDepth, clearance, thickness: 3 });
    const s = assembled([a, b]);
    assert.ok(perp(s[0], s[1]));
    assert.equal(findOverlaps(s).length, expect, `${lapDepth} ${clearance}`);
    // Gleich breite Platten liegen bündig: beide reichen quer zur Kreuzung gleich weit (A liegt flach, Kante bei y = 0)
    const ya = solidBounds(s[0]),
      yb = solidBounds(s[1]);
    near(ya.min[1], yb.min[1], 1e-3, 'bündig unten');
    near(ya.max[1], yb.max[1], 1e-3, 'bündig oben');
  }
});

test('Verbindungen: Deckel liegt geschlossen auf der Rückwand', () => {
  const back = rect(0, 0, 100, 50),
    lid = rect(0, 70, 100, 80);
  join(back, 0, lid, 0, { kind: 'lidhinge', thickness: 3 });
  const s = assembled([back, lid]);
  assert.ok(perp(s[0], s[1]));
  assert.deepEqual(pairs(s), []);
  // Rückwand flach (100 × 50), Deckel senkrecht auf ihrer Oberkante, nach außen: 100 × 53 × 80
  const dims = bounds(s).map(([lo, hi]) => hi - lo).sort((x, y) => x - y);
  [53, 80, 100].forEach((v, i) => near(dims[i], v, 1e-6, 'Maße'));
});

// ---------- Material-Aussehen ----------
const { LOOKS, cleanLook, guessLook, layerLook, lookTexture, resolveLook, DEFAULT_LOOK } = await import('../src/view3d/looks');
const { sanitizeEntry } = await import('../src/materials');

test('Aussehen: Vorlagen eindeutig und vollständig', () => {
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length);
  for (const l of LOOKS) {
    assert.match(l.color, /^#[0-9a-f]{6}$/);
    assert.match(l.engrave.color, /^#[0-9a-f]{6}$/);
    assert.ok(l.tile > 0 && l.rough >= 0 && l.rough <= 1 && l.clear >= 0 && l.clear <= 1, l.id);
  }
});

test('Aussehen: gespeicherte Werte prüfen', () => {
  assert.deepEqual(cleanLook({ id: 'slate' }), { id: 'slate' });
  assert.deepEqual(cleanLook({ id: 'oak', color: '#AABBCC' }), { id: 'oak', color: '#aabbcc' });
  assert.deepEqual(cleanLook({ id: 'oak', color: 'rot' }), { id: 'oak' });
  assert.equal(cleanLook({ id: 'gibtsnicht' }), undefined);
  assert.equal(cleanLook(null), undefined);
  assert.equal(resolveLook({ id: 'oak', color: '#112233' }).color, '#112233');
});

test('Aussehen: aus dem Materialnamen raten', () => {
  assert.equal(guessLook('Schiefer')?.id, 'slate');
  assert.equal(guessLook('Sperrholz Pappel 3 mm')?.id, 'poplar');
  assert.equal(guessLook('Birch plywood')?.id, 'birch');
  assert.equal(guessLook('Acryl schwarz')?.id, 'acrylic-opaque');
  assert.equal(guessLook('Plexiglas klar')?.id, 'acrylic');
  assert.equal(guessLook('Graupappe')?.id, 'cardboard');
  assert.equal(guessLook('Aluminium eloxiert')?.id, 'anodized');
  assert.equal(guessLook('MDF')?.id, 'mdf');
  assert.equal(guessLook('Glasfaser'), undefined);
  assert.equal(guessLook('Irgendwas'), undefined);
  const names: Record<string, string> = { m1: 'Schiefer' };
  // Eigenes Aussehen vor geratenem vor Standard
  assert.equal(layerLook({ look: { id: 'oak' }, material: 'm1' }, (id) => names[id], DEFAULT_LOOK).id, 'oak');
  assert.equal(layerLook({ material: 'm1' }, (id) => names[id], DEFAULT_LOOK).id, 'slate');
  assert.equal(layerLook({}, (id) => names[id], { id: 'walnut' }).id, 'walnut');
});

test('Aussehen: Texturen kachelbar', () => {
  const N = 64;
  for (const l of LOOKS) {
    const { rgba, height } = lookTexture(l, N);
    assert.equal(rgba.length, N * N * 4);
    assert.equal(height.length, N * N);
    // Gegenüberliegende Ränder passen zusammen: Sprung über den Rand nicht viel größer als innen
    let edge = 0,
      inner = 0;
    for (let j = 0; j < N; j++) {
      const at = (i: number) => rgba[(j * N + i) * 4 + 1];
      edge += Math.abs(at(N - 1) - at(0));
      inner += Math.abs(at(N / 2) - at(N / 2 - 1));
    }
    assert.ok(edge <= inner * 2.5 + N * 2, `${l.id}: Rand ${edge} / innen ${inner}`);
  }
});

test('Aussehen: Material-Bibliothek speichert es mit', () => {
  const e = sanitizeEntry({ material: 'Schiefer', settings: { mode: 'fill', look: { id: 'slate', color: '#000000' } } })!;
  assert.deepEqual(e.settings.look, { id: 'slate', color: '#000000' });
  const bad = sanitizeEntry({ material: 'X', settings: { mode: 'line', look: { id: 'nix' } } })!;
  assert.equal('look' in bad.settings, false);
});

test('Scheibenkugel: schräge Schlitze ohne Durchdringung', () => {
  for (const o of [{ shape: 'dodeca' }, { shape: 'icosa', overlap: 0 }, { shape: 'icosa', overlap: 100, thickness: 2 }, { shape: 'rhombi' }, { shape: 'tico', diameter: 300 }] as Params[]) {
    // Ganz ohne Spiel liegen die Flächen genau aufeinander; die Rundung der Konturen auf 0,001 mm kann dann winzige
    // Überdeckungen ergeben. Deshalb mit 0,02 mm Spiel prüfen.
    const s = solids('discsphere', { ...o, play: 0.02, kerf: 0 });
    assert.deepEqual(pairs(s), [], JSON.stringify(o));
    // Mit Presspassung überdecken sich genau die gesteckten Paare
    const press = findOverlaps(solids('discsphere', { ...o, play: -0.2, kerf: 0 }));
    const L = sphereLayout({ ...defaultParams(getGenerator('discsphere')!), ...o, play: -0.2 })!;
    assert.equal(press.length, L.discs.reduce((n, d) => n + d.slots.length, 0) / 2, `${JSON.stringify(o)}: Presspassung`);
  }
  // Rand der Scheiben auf der Kugel, die Plattendicke (1 mm) steht etwas über
  const b = bounds(solids('discsphere', { diameter: 200, shape: 'icosa' }));
  assert.ok(b.every(([lo, hi]) => hi - lo <= 202 && hi - lo > 190), JSON.stringify(b));
});

test('Schräge Platten: Durchdringung wird gefunden', () => {
  // Zwei volle Rechtecke, die sich im Winkel von 60° kreuzen
  const rect = [[{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }]];
  const c = Math.cos(Math.PI / 3),
    sn = Math.sin(Math.PI / 3);
  const A: Solid = { key: 'a', label: 'a', polys: rect, th: 2, pose: { o: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] } };
  const n: [number, number, number] = [0, -sn, c];
  const B: Solid = { key: 'b', label: 'b', polys: rect, th: 2, pose: { o: [0, -n[1], -n[2]], u: [1, 0, 0], v: [0, c, sn], n } };
  const ov = findOverlaps([A, B]);
  assert.equal(ov.length, 1);
  // Querschnitt = Raute mit Seiten 2/sin 60°, Fläche 4/sin 60°, über 40 mm Länge
  near(ov[0].volume, (40 * 4) / sn, 0.5, 'Volumen');
});

// ---------- Steckprüfung ----------
const { analyzeAssembly } = await import('../src/view3d/assembly');
const ClipperLib = (await import('clipper-lib')).default;
const { execute, SCALE } = await import('../src/clip');

test('Steckprüfung: Generator-Baugruppen hängen zusammen und lassen sich stecken', () => {
  for (const [gen, o] of [['box', {}], ['box', { top: 'closed' }], ['drawer', {}], ['insert', {}], ['shelf', {}]] as const) {
    const r = analyzeAssembly(solids(gen, o));
    assert.equal(r.groups.length, 1, `${gen}: ${r.groups.length} Gruppen`);
    assert.deepEqual(r.conflicts, [], gen);
    assert.equal(r.order.length, r.pieces.length, gen);
  }
  // Regal und Einsatz: Halbschlitze, also feste Steckrichtungen
  assert.ok(analyzeAssembly(solids('shelf')).crossings.length >= 4);
  // Scheibenkugel aus starren Scheiben: Ringe schließen sich, nicht alles lässt sich gerade stecken
  const ds = analyzeAssembly(solids('discsphere'));
  assert.equal(ds.groups.length, 1);
  assert.ok(ds.conflicts.length > 0);
});

test('Steckprüfung: loses Teil, eigene Gruppe und widersprüchliche Steckrichtungen', () => {
  const th = 3;
  // Rechteck minus Schlitze, in lokalen Koordinaten (x, y)
  const plate = (w: [number, number], h: [number, number], cuts: [number, number, number, number][]) => {
    const r = (x0: number, y0: number, x1: number, y1: number) => [{ X: x0 * SCALE, Y: y0 * SCALE }, { X: x1 * SCALE, Y: y0 * SCALE }, { X: x1 * SCALE, Y: y1 * SCALE }, { X: x0 * SCALE, Y: y1 * SCALE }];
    const res = execute(ClipperLib.ClipType.ctDifference, [r(w[0], h[0], w[1], h[1])], cuts.map((c) => r(...c)), ClipperLib.PolyFillType.pftNonZero);
    return res.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
  };
  const W = th / 2 + 0.05;
  // Zwei Rückgrate (Ebene y = 0 und y = 20, in x/z), zwei Rippen (Ebene x = 30 und x = 70, in y/z)
  // top: Schlitz von oben (sonst von unten) an x = 30 / 70 bzw. y = 0 / 20
  const cut = (c: number, top: boolean): [number, number, number, number] => (top ? [c - W, 20, c + W, 41] : [c - W, -1, c + W, 20]);
  const spine = (y: number, t30: boolean, t70: boolean): Solid => ({
    key: `S${y}`, label: `S${y}`, th, pose: { o: [0, y - th / 2, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    polys: plate([0, 100], [0, 40], [cut(30, t30), cut(70, t70)]),
  });
  const rib = (x: number, t0: boolean, t20: boolean): Solid => ({
    key: `R${x}`, label: `R${x}`, th, pose: { o: [x - th / 2, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
    polys: plate([-10, 30], [0, 40], [cut(0, t0), cut(20, t20)]),
  });
  const good = () => [spine(0, true, true), spine(20, true, true), rib(30, false, false), rib(70, false, false)];
  const ok = analyzeAssembly(good());
  assert.equal(ok.groups.length, 1);
  assert.equal(ok.crossings.length, 4);
  assert.deepEqual(ok.conflicts, []);
  // Gemischt, aber in passender Reihenfolge steckbar (Rippe 70 von oben auf das hintere Rückgrat)
  assert.deepEqual(analyzeAssembly([spine(0, true, true), spine(20, true, false), rib(30, false, false), rib(70, false, true)]).conflicts, []);
  // Jedes Teil müsste auf seine beiden Nachbarn in entgegengesetzten Richtungen: geht in keiner Reihenfolge
  const bad = analyzeAssembly([spine(0, true, false), spine(20, false, true), rib(30, false, true), rib(70, true, false)]);
  assert.equal(bad.groups.length, 1);
  assert.equal(bad.crossings.length, 4);
  assert.equal(bad.conflicts.length, 1, JSON.stringify(bad.conflicts));
  // Loses Teil daneben und ein Teil aus zwei Inseln
  const far: Solid = { ...rib(30, false, false), key: 'X', label: 'X', pose: { ...rib(30, false, false).pose, o: [200, 0, 0] } };
  const two: Solid = { key: 'T', label: 'T', th, pose: { o: [0, 50, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] }, polys: [...plate([0, 10], [0, 10], []), ...plate([20, 30], [0, 10], [])] };
  const lo = analyzeAssembly([...good(), far, two]);
  assert.equal(lo.pieces.length, 7);
  assert.equal(lo.groups.length, 4);
  assert.equal(lo.groups[0].length, 4);
  assert.deepEqual(lo.pieces.filter((p) => p.key === 'T').map((p) => p.island), [1, 2]);
});

test('outline: aligned slots give no stray lines (issue #182)', () => {
  const { outlineSegments } = solidsMod;
  const rect = (x0: number, y0: number, w: number, h: number) => [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
  const polys = [rect(0, 0, 100, 80)];
  for (const cx of [33.333, 66.667]) for (const y of [8, 26, 44, 62]) polys.push(rect(cx - 1.5, y, 3, 10));
  const seg = outlineSegments(polys, 3);
  // 9 rectangles: 4 edges top + 4 bottom + 4 verticals each
  assert.equal(seg.length / 6, 9 * 12);
  // Every horizontal segment lies on a contour edge (no line joining two slots)
  for (let i = 0; i < seg.length; i += 6) {
    const len = Math.hypot(seg[i + 3] - seg[i], seg[i + 4] - seg[i + 1]);
    if (len > 0) assert.ok(len <= 10 + 1e-9 || len === 100 || len === 80, `unexpected segment length ${len}`);
  }
  // Smooth circle: no vertical edges, closing duplicate point ignored
  const circle = Array.from({ length: 65 }, (_, k) => ({ x: Math.cos((k / 64) * 2 * Math.PI) * 10, y: Math.sin((k / 64) * 2 * Math.PI) * 10 }));
  assert.equal(outlineSegments([circle], 3).length / 6, 64 * 2);
});

// ---------- Issue #260: Baugruppen nach dem Verschachteln nicht ineinander ----------
const { spreadApart, SPREAD_GAP } = await import('../src/view3d/spread');
const { EditorGenerators } = await import('../src/editor/generators');
const { buildGen } = await import('../src/generators/index');
const { defaultLayer } = await import('../src/model');
const { boundsOf } = await import('../src/geom');
const jigMod = await import('../src/generators/jig');
const { normalizeParams } = await import('../src/generators/index');

type Rect = { x0: number; y0: number; x1: number; y1: number };
const footOf = (parts: Solid[]): Rect => {
  const b = parts.map(solidBounds);
  return { x0: Math.min(...b.map((x) => x.min[0])), y0: Math.min(...b.map((x) => x.min[1])), x1: Math.max(...b.map((x) => x.max[0])), y1: Math.max(...b.map((x) => x.max[1])) };
};
const closer = (a: Rect, b: Rect, gap: number) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

function boxesEditor(n: number) {
  const ed: any = Object.create(EditorGenerators.prototype);
  ed.doc = loadDoc({ bed: { w: 3000, h: 3000 }, objs: [], layers: {} });
  ed.currentLayer = 0; ed.agentCall = true; ed.sel = [];
  ed.snapshot = () => {}; ed.touch = () => {}; ed.emit = () => {}; ed.setSel = (o: Obj[]) => (ed.sel = o);
  ed.layer = (i: number) => ed.doc.layers[i] ?? (ed.doc.layers[i] = defaultLayer(i));
  const gen = getGenerator('box')!;
  const roots: Obj[][] = [];
  for (let i = 0; i < n; i++) {
    const members: Obj[] = ed.addGen(buildGen(gen, defaultParams(gen)), 0, { x: 150 + i * 450, y: 150 });
    // Jede Box ist eine eigene Baugruppe (die App vergibt beim Einfügen neue Kennungen)
    for (const o of members) if (o.shape.kind === 'gen') o.shape = { ...o.shape, asm: 'box' + i };
    roots.push(members);
  }
  // Ohne Auswahl zeigt die Ansicht alle Teile der Seite
  ed.sel = [];
  return { ed, roots };
}
/** Pro Baugruppe: Grundriss ihrer Platten in der 3D-Szene (in der Reihenfolge, in der die Baugruppen vorkommen) */
function footprints(solidsList: { group?: string; key: string }[]) {
  const by = new Map<string, Solid[]>();
  for (const s of solidsList) {
    const k = s.group ?? s.key;
    (by.get(k) ?? by.set(k, []).get(k)!).push(s as unknown as Solid);
  }
  return [...by.values()].map(footOf);
}

test('Baugruppen nebeneinander auf der Arbeitsfläche: Lage bleibt unter der Mitte der Teile (unverändert)', () => {
  const { ed, roots } = boxesEditor(3);
  const scene = collectScene(ed, 3, false).scene;
  const f = footprints(scene.solids);
  assert.equal(f.length, 3);
  roots.forEach((members, i) => {
    const c = boundsOf(members)!;
    const g = f[i];
    near((g.x0 + g.x1) / 2, c.x + c.w / 2, 1e-6, 'x ' + i);
    near((g.y0 + g.y1) / 2, -(c.y + c.h / 2), 1e-6, 'y ' + i);
  });
  assert.equal(scene.overlaps.length, 0);
});

test('Baugruppen nach dem Verschachteln (Teile verschränkt): keine Überdeckung zwischen verschiedenen Baugruppen', () => {
  const { ed, roots } = boxesEditor(3);
  // Teil k jeder Box in dieselbe Spalte k: alle Baugruppen haben dann fast dieselbe Mitte auf der Arbeitsfläche
  roots.forEach((members, i) => members.forEach((o, k) => { o.m = [o.m[0], o.m[1], o.m[2], o.m[3], 100 + k * 160 + i * 12, 100 + i * 9]; }));
  const scene = collectScene(ed, 3, false).scene;
  const group = new Map(scene.solids.map((s) => [s.key, s.group]));
  const cross = scene.overlaps.filter((o) => group.get(o.a) !== group.get(o.b));
  assert.equal(cross.length, 0, cross.map((o) => o.a + '/' + o.b).join(' '));
  assert.equal(scene.overlaps.length, 0);
  const f = footprints(scene.solids);
  assert.equal(f.length, 3);
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) assert.ok(!closer(f[i], f[j], SPREAD_GAP - 1e-6), `Baugruppe ${i} und ${j} zu nah`);
  // Zweiter Aufruf mit denselben Daten: gleiche Lagen (kein Springen)
  const again = collectScene(ed, 3, false).scene;
  assert.deepEqual(again.solids.map((s) => [s.key, s.pose.o]), scene.solids.map((s) => [s.key, s.pose.o]));
});

test('spreadApart: berührende Blöcke bleiben, überdeckende werden mit Abstand nebeneinandergelegt', () => {
  const one = () => solids('box', { top: 'closed' });
  const w = footOf(one()).x1 - footOf(one()).x0;
  const shift = (parts: Solid[], dx: number) => parts.forEach((p) => (p.pose = { ...p.pose, o: [p.pose.o[0] + dx, p.pose.o[1], p.pose.o[2]] }));
  const posOf = (...lists: Solid[][]) => JSON.stringify(lists.map((x) => x.map((p) => p.pose.o)));
  // Genau berührend: nichts bewegt sich
  const a = one(), b = one();
  shift(b, w);
  const before = posOf(a, b);
  spreadApart([{ parts: a, order: 1 }, { parts: b, order: 2 }]);
  assert.equal(posOf(a, b), before);
  // Vier Blöcke an derselben Stelle: danach nirgends mehr Überdeckung, der Abstand stimmt, fast quadratisch
  const four = [one(), one(), one(), one()];
  spreadApart(four.map((parts, i) => ({ parts, order: i + 1 })));
  const fp = four.map(footOf);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(!closer(fp[i], fp[j], SPREAD_GAP - 1e-6), `${i}/${j}`);
  const all = footOf(four.flat());
  assert.ok((all.x1 - all.x0) / (all.y1 - all.y0) < 2.5, 'Anordnung zu langgestreckt');
  // Lose Platten: nur ausweichen, wenn sie einen Block überdecken; der Block bleibt stehen, die Platte hält Abstand
  const blk = one(), plate = one(), far = one();
  const fb = footOf(blk);
  shift(far, 5000);
  const farBefore = posOf(far);
  const blkBefore = posOf(blk);
  spreadApart([{ parts: blk, order: 1 }], [{ parts: plate, order: 2 }, { parts: far, order: 3 }]);
  assert.equal(posOf(blk), blkBefore, 'Block bleibt');
  assert.equal(posOf(far), farBefore, 'Platte ohne Überdeckung bleibt');
  assert.ok(!closer(footOf(plate), fb, SPREAD_GAP - 1e-6), 'Platte hält Abstand zum Block');
  // Zwei lose Platten auf demselben Platz: beide weichen dem Block aus, aber nicht ineinander
  const p1 = one(), p2 = one();
  spreadApart([{ parts: one(), order: 1 }], [{ parts: p1, order: 2 }, { parts: p2, order: 3 }]);
  assert.ok(!closer(footOf(p1), footOf(p2), SPREAD_GAP - 1e-6), 'lose Platten nicht ineinander');
});

/** Fläche der Konturen einer Platte nach Gerade-Ungerade-Regel (Löcher abgezogen), ohne Verschachtelung auszuwerten */
const plateArea = (polys: Solid['polys']) => {
  const areaOf = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, q, i) => s + (p[(i + 1) % p.length].x - q.x) * (p[(i + 1) % p.length].y + q.y), 0) / 2);
  const contains = (outer: { x: number; y: number }[], q: { x: number; y: number }) => {
    let inside = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) if (outer[i].y > q.y !== outer[j].y > q.y && q.x < ((outer[j].x - outer[i].x) * (q.y - outer[i].y)) / (outer[j].y - outer[i].y) + outer[i].x) inside = !inside;
    return inside;
  };
  return polys.reduce((sum, p, i) => sum + (polys.filter((o, j) => j !== i && contains(o, p[0])).length % 2 ? -1 : 1) * areaOf(p), 0);
};

function cutLayer(ed: any) {
  ed.doc.layers[1] = { ...defaultLayer(1), mode: 'line' };
}
const cutRect = (id: number, x: number, y: number, w: number, h: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer: 1, shape: { kind: 'rect', w, h, r: 0 } } as Obj);
const wall = (members: Obj[], part: string) => members.find((o) => o.shape.kind === 'gen' && o.shape.part === part)!;

test('Schneidform ganz in einer Wand: Loch in der Wand, keine lose Platte, Box bleibt', () => {
  const { ed, roots } = boxesEditor(1);
  const before = collectScene(ed, 3, false).scene;
  const front = wall(roots[0], 'front');
  const b = boundsOf([front])!;
  cutLayer(ed);
  ed.doc.objs.push(cutRect(9001, b.x + b.w / 2 - 10, b.y + b.h / 2 - 5, 20, 10));
  const after = collectScene(ed, 3, false).scene;
  assert.equal(after.solids.length, before.solids.length, 'keine zusätzliche Platte');
  assert.ok(!after.solids.some((s) => s.key.startsWith('f')), 'nicht als lose Platte');
  const key = (sc: typeof before) => sc.solids.find((s) => s.key.endsWith(':front'))!;
  near(plateArea(key(before).polys) - plateArea(key(after).polys), 200, 1e-3, 'Loch 20 × 10');
  assert.deepEqual(after.solids.map((s) => [s.key, s.pose.o]), before.solids.map((s) => [s.key, s.pose.o]), 'Lage der Box unverändert');
});

test('Schneidform am Rand einer Wand: Kerbe, keine lose Platte', () => {
  const { ed, roots } = boxesEditor(1);
  const before = collectScene(ed, 3, false).scene;
  const b = boundsOf([wall(roots[0], 'front')])!;
  cutLayer(ed);
  // Mitte der linken Kante der Wand: die Hälfte des Rechtecks liegt außerhalb der Wand
  ed.doc.objs.push(cutRect(9002, b.x - 5, b.y + b.h / 2 - 5, 10, 10));
  const after = collectScene(ed, 3, false).scene;
  assert.ok(!after.solids.some((s) => s.key.startsWith('f')), 'nicht als lose Platte');
  const lost = plateArea(before.solids.find((s) => s.key.endsWith(':front'))!.polys) - plateArea(after.solids.find((s) => s.key.endsWith(':front'))!.polys);
  assert.ok(lost > 1 && lost <= 50 + 1e-6, `Kerbe ${lost} mm²`);
});

test('Schneidform auf einem Fülllayer, auf anderer Seite oder neben der Wand schneidet nichts', () => {
  const { ed, roots } = boxesEditor(1);
  const before = collectScene(ed, 3, false).scene;
  const b = boundsOf([wall(roots[0], 'front')])!;
  const polys = () => collectScene(ed, 3, false).scene.solids.find((s) => s.key.endsWith(':front'))!.polys.length;
  // Fülllayer (Gravur): keine Platte, kein Loch
  ed.doc.objs.push({ ...cutRect(9003, b.x + 5, b.y + 5, 10, 10), layer: 0 } as Obj);
  assert.equal(polys(), before.solids.find((s) => s.key.endsWith(':front'))!.polys.length);
  // Auf einer anderen Seite: gleiche Stelle, aber kein Loch
  cutLayer(ed);
  ed.doc.pages.push({ name: 'B', objs: [cutRect(9004, b.x + 5, b.y + 5, 10, 10)] } as never);
  assert.equal(polys(), before.solids.find((s) => s.key.endsWith(':front'))!.polys.length);
  // Berührt nur die Kante: nichts wird geschnitten
  ed.doc.objs.push(cutRect(9005, b.x - 10, b.y + b.h / 2 - 5, 10, 10));
  assert.equal(polys(), before.solids.find((s) => s.key.endsWith(':front'))!.polys.length);
});

test('Lose Platte fern von allen Teilen bleibt an ihrer Stelle der Arbeitsfläche', () => {
  const { ed } = boxesEditor(1);
  cutLayer(ed);
  ed.doc.objs.push(cutRect(9006, 2000, 2000, 30, 20));
  const sc = collectScene(ed, 3, false).scene;
  const f = sc.solids.find((s) => s.key.startsWith('f'))!;
  assert.ok(f, 'lose Platte vorhanden');
  const bb = solidBounds(f);
  near(bb.min[0], 2000, 1e-6, 'x');
  near(bb.max[1], -2000, 1e-6, 'y');
});

test('Lose Platte, die die Box in 3D überdeckt, weicht allein aus; die Box bleibt', () => {
  const { ed, roots } = boxesEditor(1);
  // Teile der Box weit auseinander: die Box steht in 3D in der Mitte, auf der Arbeitsfläche liegt dort nichts
  const spots: [number, number][] = [[100, 100], [1300, 100], [100, 1300], [1300, 1300], [100, 700]];
  roots[0].forEach((o, k) => { o.m = [o.m[0], o.m[1], o.m[2], o.m[3], spots[k][0], spots[k][1]]; });
  const alone = collectScene(ed, 3, false).scene;
  const g = footOf(alone.solids as unknown as Solid[]);
  cutLayer(ed);
  const cx = (g.x0 + g.x1) / 2, cy = -(g.y0 + g.y1) / 2;
  ed.doc.objs.push(cutRect(9007, cx - 15, cy - 10, 30, 20));
  const sc = collectScene(ed, 3, false).scene;
  const box = sc.solids.filter((s) => !s.key.startsWith('f'));
  assert.deepEqual(box.map((s) => [s.key, s.pose.o]), alone.solids.map((s) => [s.key, s.pose.o]), 'Box bleibt stehen');
  const f = sc.solids.find((s) => s.key.startsWith('f'))!;
  assert.ok(f, 'lose Platte vorhanden');
  assert.ok(!closer(footOf([f as unknown as Solid]), footOf(box as unknown as Solid[]), SPREAD_GAP - 1e-6), 'Platte hält Abstand zur Box');
});

test('Mehrlagenarbeit: Schneidform in einer Platte wird zum Loch', () => {
  const rect = (id: number, x: number, y: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w: 40, h: 30, r: 0 } });
  const lower = rect(901, 20, 20), upper = rect(902, 180, 90);
  const hole = cutRect(903, 30, 30, 10, 10);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [lower, hole] }, { name: 'B', objs: [upper] }], multiLayerAssemblies: [{ id: 'layers', plates: [
    { object: 901, name: 'Basis', thickness: 2, look: { id: 'birch' }, anchor: IDENT },
    { object: 902, name: 'Decklage', thickness: 4, look: { id: 'acrylic' }, anchor: IDENT },
  ] }] });
  const ed = { doc, sel: [lower], layer: () => ({ mode: 'line', output: true, show: true, material: undefined }) } as never;
  const sc = collectScene(ed, 3, false).scene;
  assert.equal(sc.solids.length, 2, 'Platten, kein loses Teil');
  const basis = sc.solids.find((s) => s.label === 'Basis')!;
  near(plateArea(basis.polys), 40 * 30 - 100, 1e-3, 'Basis mit Loch');
});


test('Jig (Generator-Platte) über einer Wand schneidet nichts hinein und bleibt eine eigene Platte', () => {
  const { ed, roots } = boxesEditor(1);
  const before = collectScene(ed, 3, false).scene;
  const front = wall(roots[0], 'front');
  const b = boundsOf([front])!;
  const { JIG, encodeShapes, outlineFromPolys } = jigMod;
  const circle = Array.from({ length: 48 }, (_, k) => ({ x: Math.cos((k / 48) * 2 * Math.PI) * 10, y: Math.sin((k / 48) * 2 * Math.PI) * 10 }));
  const jig = buildGen(JIG, normalizeParams(JIG, { ...defaultParams(JIG), shapes: encodeShapes([{ n: 'A', c: 2, r: 0, s: outlineFromPolys([circle]) }]) }));
  cutLayer(ed);
  const members: Obj[] = ed.addGen(jig, 1, { x: 0, y: 0 });
  ed.sel = [];
  // Jig mitten über die Wand legen
  const jb = boundsOf(members)!;
  for (const o of members) o.m = [o.m[0], o.m[1], o.m[2], o.m[3], o.m[4] + b.x + b.w / 2 - (jb.x + jb.w / 2), o.m[5] + b.y + b.h / 2 - (jb.y + jb.h / 2)];
  const after = collectScene(ed, 3, false).scene;
  const frontOf = (sc: typeof before) => sc.solids.find((s) => s.key.endsWith(':front'))!;
  near(plateArea(frontOf(after).polys), plateArea(frontOf(before).polys), 1e-6, 'Wand unverändert');
  assert.equal(frontOf(after).polys.length, frontOf(before).polys.length);
  assert.ok(after.solids.some((s) => s.key.startsWith('f')), 'Jig bleibt als eigene Platte');
});


const { apply } = await import('../src/model');
/** Das Loch einer Platte (Kontur mit der gesuchten Fläche), über die Matrix des Teils zurück auf die Arbeitsfläche: Rahmen [x0, y0, x1, y1] */
function holeOnCanvas(after: Solid['polys'], area: number, m: Obj['m']) {
  const areaOf = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, q, i) => s + (p[(i + 1) % p.length].x - q.x) * (p[(i + 1) % p.length].y + q.y), 0) / 2);
  const hit = after.filter((p) => Math.abs(areaOf(p) - area) < 0.05);
  assert.equal(hit.length, 1, 'genau eine Kontur mit der Fläche des Lochs');
  const pts = hit[0].map((q) => apply(m, q.x, q.y));
  return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
}
const frontOf = (sc: { solids: { key: string; polys: Solid['polys'] }[] }) => sc.solids.find((s) => s.key.endsWith(':front'))!;

test('Loch an der richtigen Stelle, wenn das Teil auf der Arbeitsfläche verschoben, gedreht oder gespiegelt ist', () => {
  const rot = (deg: number) => (m: Obj['m']): Obj['m'] => {
    const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
    return [c, s, -s, c, m[4], m[5]];
  };
  const cases: [string, (m: Obj['m']) => Obj['m']][] = [
    ['verschoben', (m) => [m[0], m[1], m[2], m[3], m[4] + 137, m[5] + 61]],
    ['90° gedreht', rot(90)],
    ['30° gedreht', rot(30)],
    ['gespiegelt', (m) => [-m[0], m[1], -m[2], m[3], m[4] + 200, m[5]]],
  ];
  for (const [name, mk] of cases) {
    const { ed, roots } = boxesEditor(1);
    const front = wall(roots[0], 'front');
    front.m = mk(front.m);
    const before = collectScene(ed, 3, false).scene;
    const b = boundsOf([front])!;
    cutLayer(ed);
    const cx = b.x + b.w / 2 + 7, cy = b.y + b.h / 2 - 3;
    ed.doc.objs.push(cutRect(9100, cx - 6, cy - 4, 12, 8));
    const after = collectScene(ed, 3, false).scene;
    assert.ok(!after.solids.some((s) => s.key.startsWith('f')), name + ': nicht als lose Platte');
    near(plateArea(frontOf(before).polys) - plateArea(frontOf(after).polys), 96, 0.05, name + ': Loch 12 × 8');
    const box = holeOnCanvas(frontOf(after).polys, 96, front.m);
    [cx - 6, cy - 4, cx + 6, cy + 4].forEach((v, i) => near(box[i], v, 0.02, name + ': Lage des Lochs ' + i));
  }
});

test('Loch bleibt richtig, wenn die Parameter der Baugruppe danach geändert werden', () => {
  const { ed, roots } = boxesEditor(1);
  const front = wall(roots[0], 'front');
  const b = boundsOf([front])!;
  cutLayer(ed);
  const cutter = cutRect(9101, b.x + b.w / 2 - 10, b.y + b.h / 2 - 5, 20, 10);
  ed.doc.objs.push(cutter);
  const before = collectScene(ed, 3, false).scene;
  const clean = boxesEditor(1);
  const plain = collectScene(clean.ed, 3, false).scene;
  near(plateArea(frontOf(plain).polys) - plateArea(frontOf(before).polys), 200, 1e-3, 'Loch vor der Änderung');
  // Breite und Höhe ändern: das Teil wird neu berechnet und, wie vom Generator vorgesehen, neu angeordnet
  const gen = getGenerator('box')!;
  const params = { ...(front.shape as { params: Params }).params, width: 140, height: 70 };
  ed.updateGen(front, buildGen(gen, params), true);
  const after = collectScene(ed, 3, false).scene;
  const nb = boundsOf([wall(roots[0], 'front')])!;
  const cb = { x0: cutter.m[4], y0: cutter.m[5], x1: cutter.m[4] + 20, y1: cutter.m[5] + 10 };
  const inside = cb.x0 > nb.x + 5 && cb.x1 < nb.x + nb.w - 5 && cb.y0 > nb.y + 5 && cb.y1 < nb.y + nb.h - 5;
  // Referenz: dieselbe Baugruppe (neue Maße) ohne die Form
  const without = ed.doc.objs.filter((o: Obj) => o !== cutter);
  const keep = ed.doc.objs;
  ed.doc.objs = without;
  const plain2 = collectScene(ed, 3, false).scene;
  ed.doc.objs = keep;
  const lost = plateArea(frontOf(plain2).polys) - plateArea(frontOf(after).polys);
  assert.ok(inside, 'die Form liegt nach der Änderung noch ganz auf der neuen Wand');
  near(lost, 200, 1e-3, 'Loch nach der Änderung');
});


test('findOverlaps sieht die Platte mit Loch: ohne Zinkenrand überdeckt die Frontwand nichts mehr', () => {
  const { ed, roots } = boxesEditor(1);
  // Presspassung (negatives Steckspiel): die Zinken der Wände dringen ineinander ein
  const front0 = wall(roots[0], 'front');
  ed.updateGen(front0, buildGen(getGenerator('box')!, { ...(front0.shape as { params: Params }).params, clearance: -0.5 }), true);
  const before = collectScene(ed, 3, false).scene;
  const involvesFront = (o: { a: unknown; b: unknown }) => [o.a, o.b].some((k) => String(k).endsWith(':front'));
  assert.ok(before.overlaps.some(involvesFront), 'Ausgangslage: die Frontwand überdeckt sich mit Nachbarn');
  // Vier Streifen schneiden den ganzen Zinkenrand der Frontwand weg
  const front = wall(roots[0], 'front');
  const b = boundsOf([front])!;
  cutLayer(ed);
  const w = 8, o = 30;
  ed.doc.objs.push(
    cutRect(9200, b.x - o, b.y - o, b.w + 2 * o, o + w),
    cutRect(9201, b.x - o, b.y + b.h - w, b.w + 2 * o, o + w),
    cutRect(9202, b.x - o, b.y - o, o + w, b.h + 2 * o),
    cutRect(9203, b.x + b.w - w, b.y - o, o + w, b.h + 2 * o),
  );
  const after = collectScene(ed, 3, false).scene;
  assert.ok(!after.solids.some((s) => s.key.startsWith('f')), 'keine losen Platten');
  assert.ok(plateArea(frontOf(after).polys) < plateArea(frontOf(before).polys), 'Frontwand wurde beschnitten');
  assert.ok(!after.overlaps.some(involvesFront), 'die beschnittene Frontwand überdeckt nichts mehr');
  assert.deepEqual(after.overlaps, findOverlaps(after.solids as unknown as Solid[]), 'Überdeckungen stammen von den beschnittenen Platten');
});

test('Schneidformen wie beim Lasern: ausgeblendet schneidet, Layer ohne Ausgabe und noLaser schneiden nicht', () => {
  const lost = (setup: (ed: any, cutter: Obj) => void) => {
    const { ed, roots } = boxesEditor(1);
    const plain = collectScene(ed, 3, false).scene;
    const b = boundsOf([wall(roots[0], 'front')])!;
    cutLayer(ed);
    const cutter = cutRect(9300, b.x + b.w / 2 - 10, b.y + b.h / 2 - 5, 20, 10);
    ed.doc.objs.push(cutter);
    setup(ed, cutter);
    return plateArea(frontOf(plain).polys) - plateArea(frontOf(collectScene(ed, 3, false).scene).polys);
  };
  // Ausgeblendete Objekte lasert die Ausgabe trotzdem (Issue #217): das Loch gehört in die Ansicht
  near(lost((_, c) => (c.hidden = true)), 200, 1e-3, 'ausgeblendet');
  near(lost((ed) => (ed.doc.layers[1] = { ...ed.doc.layers[1], output: false })), 0, 1e-6, 'Layer ohne Ausgabe');
  near(lost((_, c) => (c.noLaser = true)), 0, 1e-6, 'noLaser');
});

const { checkAssemblies } = await import('../src/asmcheck');
test('Steckprüfung sieht die ausgeschnittene Platte: ein ringsum freigeschnittenes Stück der Frontwand hängt an nichts', () => {
  const findings = (withCut: boolean, withPages = true) => {
    const { ed, roots } = boxesEditor(1);
    const b = boundsOf([wall(roots[0], 'front')])!;
    if (withCut) {
      cutLayer(ed);
      // Rahmen aus vier Streifen (2 mm breit) um ein Fenster von 40 × 20 mm: das Innere fällt beim Lasern heraus
      const x = b.x + b.w / 2 - 20, y = b.y + b.h / 2 - 10;
      ed.doc.objs.push(cutRect(9400, x - 2, y - 2, 44, 2), cutRect(9401, x - 2, y + 20, 44, 2), cutRect(9402, x - 2, y, 2, 20), cutRect(9403, x + 40, y, 2, 20));
    }
    const out: { kind: string; level: string; msg: string }[] = [];
    const pages = ed.doc.pages.map((pg: { objs: Obj[] }) => pg.objs);
    checkAssemblies(ed.doc.objs, pages.flat(), (i: number) => ed.layer(i), out as never, withPages ? pages : undefined);
    return out;
  };
  assert.deepEqual(findings(false), [], 'ohne Formen: alles hängt zusammen');
  const cut = findings(true);
  assert.equal(cut.length, 1, 'ein Befund');
  assert.equal(cut[0].kind, 'loose');
  assert.equal(cut[0].level, 'error');
  // Ohne Seiten (andere Aufrufer von checkDesign) wird wie bisher nicht geschnitten
  assert.deepEqual(findings(true, false), [], 'ohne pages wie bisher');
});

test('Gravuren ohne Platte: nur Gravuren, die auf keinem Teil liegen, und nur gezeigte (Issue #326)', () => {
  const rect = (id: number, layer: number, x: number, y: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer, shape: { kind: 'rect', w: 40, h: 30, r: 0 } });
  const plate = rect(1, 0, 20, 20), near = rect(2, 1, 30, 30), far = rect(3, 1, 200, 150);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [plate, near, far] }] });
  // Layer 0 schneidet, Layer 1 füllt
  const mk = (sel: Obj[]) => ({ doc, sel, layer: (i: number) => ({ mode: i === 1 ? 'fill' : 'line', output: true, show: true, material: undefined }) }) as never;
  const ids = (sel: Obj[]) => collectScene(mk(sel), 3, false).loose.map((o) => o.id);
  assert.deepEqual(ids([]), [3], 'ohne Auswahl: die ganze Seite');
  assert.deepEqual(ids([plate, near, far]), [3], 'mit Auswahl aller Objekte');
  assert.deepEqual(ids([far]), [3], 'nur die lose Gravur gewählt: sie hat keine Platte');
  assert.deepEqual(ids([plate, near]), [], 'die lose Gravur ist nicht gewählt und wird nicht gemeldet');
  assert.deepEqual(ids([plate]), [], 'nur die Platte gewählt');
  assert.deepEqual(ids([near]), [], 'nur die Gravur gewählt, sie liegt auf einer Platte der Seite, die nicht gezeigt wird');
});

test('Rohplatte: Teile darauf bleiben Teile, die Platte bekommt Löcher; die Anzeige lässt sich ausschalten (Issue #326)', () => {
  const rect = (id: number, layer: number, x: number, y: number, w: number, h: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer, shape: { kind: 'rect', w, h, r: 0 } });
  const sheet = rect(1, 7, 0, 0, 100, 100), part = rect(2, 0, 10, 10, 20, 20), engr = rect(3, 1, 60, 60, 20, 20);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [sheet, part, engr] }] });
  // Layer 0 und 7 schneiden (7 ohne Ausgabe), Layer 1 füllt
  const ed = { doc, sel: [], layer: (i: number) => ({ mode: i === 1 ? 'fill' : 'line', output: i !== 7, show: true, material: undefined }) } as never;
  const area = (p: { polys: { x: number; y: number }[][] }) =>
    p.polys.reduce((a, q, i) => a + (i ? -1 : 1) * Math.abs(q.reduce((s, v, k) => s + v.x * q[(k + 1) % q.length].y - q[(k + 1) % q.length].x * v.y, 0)) / 2, 0);
  const on = collectScene(ed, 3, false).scene.solids;
  assert.equal(on.length, 2, 'Platte und Teil');
  const plate = on.find((x) => x.polys.length === 2)!, piece = on.find((x) => x.polys.length === 1)!;
  assert.ok(plate && piece, 'die Platte hat ein Loch, das Teil bleibt ein Teil');
  near(area(plate), 100 * 100 - 20 * 20, 1e-3, 'Fläche der Platte ohne das Teil');
  near(area(piece), 20 * 20, 1e-3, 'Fläche des Teils');
  const off = collectScene(ed, 3, false, undefined, false);
  assert.equal(off.scene.solids.length, 1, 'ohne Rohplatte nur das Teil');
  assert.equal(off.scene.solids[0].polys.length, 1);
  assert.deepEqual(collectScene(ed, 3, false).loose, [], 'Gravur auf der Platte ist nicht lose');
  assert.deepEqual(off.loose, [], 'auch nicht, wenn die Platte ausgeblendet ist');
  assert.deepEqual(collectScene({ ...ed, sel: [engr] } as never, 3, false, undefined, false).loose, [], 'auch nicht, wenn nur die Gravur gewählt ist');
});

test('Darstellungsmodus Layer-Farben: collectScene übernimmt die Layer-Farbe für jedes Teil', () => {
  const rect = (id: number, layer: number, x: number, y: number): Obj => ({ id, m: [1, 0, 0, 1, x, y], layer, shape: { kind: 'rect', w: 20, h: 20, r: 0 } });
  const a = rect(1, 0, 0, 0), b = rect(2, 2, 40, 0);
  const doc = loadDoc({ version: 2, bed: { w: 300, h: 200 }, page: 0, layers: {}, pages: [{ name: 'A', objs: [a, b] }] });
  const colors = ['#112233', '#445566', '#cc3311'];
  const ed = {
    doc,
    sel: [],
    layer: () => ({ mode: 'line', output: true, show: true, material: undefined }),
    layerDrawColor: (i: number) => colors[i] ?? '#000000',
  } as never;
  const solids = collectScene(ed, 3, false).scene.solids;
  assert.equal(solids.length, 2);
  assert.deepEqual(solids.map((s) => s.layerColor).sort(), ['#112233', '#cc3311']);
});

test('Blueprint-Layout: 4 Ansichten ohne Überlappung und einheitlicher Orthografik-Maßstab', () => {
  const layout = computeBlueprintLayout(800, 600);
  assert.equal(layout.iso.w, 800);
  assert.equal(layout.iso.y, 0);
  assert.equal(layout.front.x, 0);
  assert.equal(layout.front.y, layout.iso.h);
  assert.equal(layout.front.h, 600 - layout.iso.h);
  assert.equal(layout.top.x, layout.front.w);
  assert.equal(layout.side.x, layout.front.w);
  assert.equal(layout.top.y, layout.front.y);
  assert.equal(layout.side.y, layout.top.y + layout.top.h);
  assert.equal(layout.top.h + layout.side.h, layout.front.h);
  assert.equal(layout.front.w + layout.top.w, 800);

  // Einheitlicher Maßstab: das größte Projektionsmaß passt mit Rand in alle 3 Ortho-Ansichten
  const size = { x: 200, y: 120, z: 80 };
  const s = computeOrthoScale(size, layout);
  assert.ok(s > 0);
  assert.ok(size.x * s <= layout.front.w * 0.65 && size.z * s <= layout.front.h * 0.65);
  assert.ok(size.x * s <= layout.top.w * 0.65 && size.y * s <= layout.top.h * 0.65);
  assert.ok(size.y * s <= layout.side.w * 0.65 && size.z * s <= layout.side.h * 0.65);
});

// ---------- Bent parts (pose.bend, #513) ----------
{
  type V = [number, number, number];
  const { bentSolids, partKey } = solidsMod;
  const { analyzeAssembly } = await import('../src/view3d/assembly');
  const { checkGenResult } = await import('../src/plugins/contract');
  const at = (s: Solid, x: number, y: number, z = 0): V => [0, 1, 2].map((k) => s.pose.o[k] + x * s.pose.u[k] + y * s.pose.v[k] + z * s.pose.n[k]) as V;
  const strip = (len: number, h: number): Pt[][] => [[{ x: 0, y: 0 }, { x: len, y: 0 }, { x: len, y: h }, { x: 0, y: h }]];
  type Pt = { x: number; y: number };
  // Wall standing up: local x along X, y down the height (v = −Z), n towards +Y; the path bends it in the XY plane
  const wall = (path: [number, number][], len: number, x0?: number): Solid => ({
    key: 'wall',
    label: 'Box: Wall',
    th: 3,
    polys: strip(len, 40),
    pose: { o: [0, 0, 40], u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], bend: { path, ...(x0 !== undefined && { x0 }) } },
  });
  /** Quarter arc of radius r from (0, 0) turning towards +n, then straight on */
  const arc = (r: number, steps: number): [number, number][] => Array.from({ length: steps + 1 }, (_, i) => [r * Math.sin((i / steps) * (Math.PI / 2)), r - r * Math.cos((i / steps) * (Math.PI / 2))]);

  test('Bent part: a straight path gives the unbent plate', () => {
    const s = bentSolids(wall([[0, 1.5], [50, 1.5], [100, 1.5]], 100));
    assert.equal(s.length, 1, 'collinear segments merge');
    assert.deepEqual([s[0].pose.o, s[0].pose.u, s[0].pose.n], [[0, 0, 40], [1, 0, 0], [0, 1, 0]]);
    assert.equal(s[0].part, 'wall');
    assert.equal(partKey(s[0]), 'wall');
    assert.deepEqual(s[0].seams, []);
  });

  test('Bent part: strips follow the arc, local x is the arc length and the strips join edge to edge', () => {
    const r = 30,
      steps = 18;
    const path = arc(r, steps);
    const chord = 2 * r * Math.sin(Math.PI / 4 / steps);
    const len = steps * chord + 50;
    const s = bentSolids(wall([...path, [r + 50 * 0, r + 50]], len));
    assert.equal(s.length, steps + 1);
    s.forEach((x, i) => {
      assert.equal(x.key, `wall~${i}`);
      // u, n stay orthonormal and v is unchanged
      near(Math.hypot(...x.pose.u), 1, 1e-12, 'u');
      near(x.pose.u[0] * x.pose.n[0] + x.pose.u[1] * x.pose.n[1] + x.pose.u[2] * x.pose.n[2], 0, 1e-12, 'u·n');
      assert.deepEqual(x.pose.v, [0, 0, -1]);
    });
    // Each path point lies where its local x says, in the middle of the plate
    for (let i = 0; i <= steps; i++) {
      const p = at(s[Math.min(i, steps)], i * chord, 0, 1.5);
      near(p[0], path[i][0], 1e-9, `x ${i}`);
      near(p[1], path[i][1], 1e-9, `y ${i}`);
      if (i > 0) {
        // The middle of the plate is continuous (a thin wedge opens outside the bend, and closes inside)
        const q = at(s[i - 1], i * chord, 7, 1.5);
        const w = at(s[i], i * chord, 7, 1.5);
        near(Math.hypot(q[0] - w[0], q[1] - w[1], q[2] - w[2]), 0, 1e-9, `seam ${i}`);
      }
    }
    // After the arc the wall runs along +Y
    near(s[steps].pose.u[1], 1, 1e-12, 'last strip along Y');
    const end = at(s[steps], len, 0, 1.5);
    near(end[0], r, 1e-9);
    near(end[1], r + 50, 1e-9);
    // Outlines: the strips cover the plate and no seam is drawn
    const area = s.reduce((a, x) => a + x.polys.reduce((b, poly) => b + Math.abs(poly.reduce((c, q, k) => c + q.x * poly[(k + 1) % poly.length].y - poly[(k + 1) % poly.length].x * q.y, 0)) / 2, 0), 0);
    near(area, len * 40, 0.05, 'area (coordinates rounded to 1 µm)');
    const segs = solidsMod.outlineSegments(s[3].polys, 3, 25, s[3].seams);
    for (let k = 0; k < segs.length; k += 6) assert.ok(!(Math.abs(segs[k] - segs[k + 3]) < 1e-9 && s[3].seams!.some((x) => Math.abs(segs[k] - x) < 1e-6)), 'no edge along a seam');
  });

  test('Bent part: x0 shifts the start of the path along the plate', () => {
    const s = bentSolids(wall([[0, 0], [10, 0], [10, 10]], 40, -5));
    // x = −5 at the first point, the corner at x = 5
    const p = at(s[0], 0, 0, 1.5);
    near(p[0], 5, 1e-9);
    near(p[1], 0, 1e-9);
    const c = at(s[1], 5, 0, 1.5);
    near(c[0], 10, 1e-9);
    near(c[1], 0, 1e-9);
    const e = at(s[1], 15, 0, 1.5);
    near(e[0], 10, 1e-9);
    near(e[1], 10, 1e-9);
  });

  test('Bent part: no overlaps between its own strips; an overlap with another part is reported once by part key', () => {
    const s = bentSolids(wall(arc(30, 12).concat([[30, 80]]), 12 * 2 * 30 * Math.sin(Math.PI / 48) + 50));
    assert.deepEqual(findOverlaps(s), []);
    const plate: Solid = { key: 'floor', label: 'Box: Floor', th: 3, polys: [[{ x: -10, y: -10 }, { x: 60, y: -10 }, { x: 60, y: -90 }, { x: -10, y: -90 }]], pose: { o: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] } };
    const ov = findOverlaps([...s, plate]);
    assert.equal(ov.length, 1, ov.map((o) => `${o.a}/${o.b}`).join(' '));
    assert.equal(`${ov[0].a}/${ov[0].b}`, 'wall/floor');
    assert.ok(ov[0].pieces.length > 1 && ov[0].volume > 0);
    // The assembly check sees one part: all strips hang together
    const r = analyzeAssembly(s);
    assert.equal(r.groups.length, 1);
    assert.ok(r.pieces.every((p) => p.key === 'wall' && p.island === 0));
    assert.deepEqual(r.conflicts, []);
  });

  test('Plugin contract: pose.bend is checked and copied', () => {
    const pose = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    const res = (bend: unknown) => ({ parts: [{ key: 'a', subs: [], at: { x: 0, y: 0 } }], poses: { poses: { a: { ...pose, bend } } } });
    const ok = checkGenResult(res({ path: [[0, 0], [10, 0], [20, 5]], x0: -3, junk: 1 }));
    assert.deepEqual(ok.poses!.poses.a.bend, { path: [[0, 0], [10, 0], [20, 5]], x0: -3 });
    assert.equal(checkGenResult({ parts: [], poses: { poses: { a: pose } } }).poses!.poses.a.bend, undefined);
    for (const bad of [{ path: [[0, 0]] }, { path: [[0, 0], [0, 0]] }, { path: [[0, 0], [1]] }, { path: [[0, 0], [1, NaN]] }, { path: [[0, 0], [1, 0]], x0: 'a' }, { path: Array.from({ length: 2001 }, (_, i) => [i, 0]) }])
      assert.throws(() => checkGenResult(res(bad)), JSON.stringify(bad).slice(0, 60));
  });
}

{
  const THREE = await import('three');
  const { Arrangement, AXES, dragDelta, dragPlane, rotateAbout, snapAngle } = await import('../src/view3d/arrange');
  const at = (m: InstanceType<typeof THREE.Matrix4>, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  const nearV = (v: { x: number; y: number; z: number }, x: number, y: number, z: number, what: string) => {
    near(v.x, x, 1e-9, what + ' x');
    near(v.y, y, 1e-9, what + ' y');
    near(v.z, z, 1e-9, what + ' z');
  };

  test('Anordnung: Drehen um den Mittelpunkt hält den Mittelpunkt fest', () => {
    const m = rotateAbout(new THREE.Matrix4(), AXES.z, 90, new THREE.Vector3(10, 0, 0));
    nearV(at(m, 10, 0, 0), 10, 0, 0, 'Mitte');
    nearV(at(m, 20, 0, 0), 10, 10, 0, 'Ecke');
    // Two quarter turns around X = flipped over
    const flip = rotateAbout(rotateAbout(new THREE.Matrix4(), AXES.x, 90, new THREE.Vector3()), AXES.x, 90, new THREE.Vector3());
    nearV(at(flip, 0, 0, 3), 0, 0, -3, 'umgedreht');
  });

  test('Anordnung: Ausblenden, Transparent, Nur dieses Teil, Zurücksetzen', () => {
    const a = new Arrangement();
    const all = ['box:front', 'box:back', 'box:bottom'];
    assert.equal(a.changed(all), false);
    a.setHidden(['box:front'], true);
    assert.deepEqual(a.hiddenOf(all), ['box:front']);
    a.setGhost(['box:back'], true);
    assert.ok(a.isGhost('box:back') && !a.isGhost('box:front'));
    assert.equal(a.anyMoved(all), false, 'Ausblenden ist keine Bewegung');
    a.isolate(['box:bottom'], all);
    assert.deepEqual(a.hiddenOf(all), ['box:front', 'box:back']);
    a.showAll();
    assert.deepEqual(a.hiddenOf(all), []);
    a.translate(['box:front'], new THREE.Vector3(0, -50, 0));
    assert.ok(a.isMoved('box:front') && a.anyMoved(all));
    a.reset(['box:front']);
    assert.ok(!a.isMoved('box:front') && a.isGhost('box:back'));
    a.reset();
    assert.equal(a.changed(all), false);
  });

  test('Anordnung: Abbrechen stellt die Lage vor dem Ziehen wieder her', () => {
    const a = new Arrangement();
    a.translate(['p'], new THREE.Vector3(5, 0, 0));
    const saved = a.snapshot(['p']);
    a.rotate(['p'], AXES.y, 45, new THREE.Vector3(1, 2, 3));
    a.translate(['p'], new THREE.Vector3(0, 0, 9));
    a.restore(saved);
    nearV(at(a.get('p').m, 0, 0, 0), 5, 0, 0, 'zurück');
  });

  test('Anordnung: Ziehen entlang einer Achse und Einrasten', () => {
    const d = dragDelta(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 5), AXES.z);
    nearV(d, 0, 0, 5, 'nur Z');
    nearV(dragDelta(new THREE.Vector3(1, 1, 1), new THREE.Vector3(3, 4, 5), null), 2, 3, 4, 'frei');
    // Looking straight down while moving along Z: the plane still contains the Z axis
    const pl = dragPlane(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0, -1), AXES.z);
    near(pl.normal.z, 0, 1e-9, 'Ebene enthält Z');
    near(pl.distanceToPoint(new THREE.Vector3(0, 0, 42)), 0, 1e-9, 'Punkt auf der Achse');
    assert.equal(snapAngle(22, 15), 15);
    assert.equal(snapAngle(23, 15), 30);
    assert.equal(snapAngle(23, 0), 23);
  });
}

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle 3D-Tests bestanden');
