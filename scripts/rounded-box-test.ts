// Rounded box (#513): centre line, strip, tabs and slots, living hinge cuts from the app (host.hinge), pieces for the
// work area and problems. The plugin's functions run in Node without QuickJS, with the app's host functions.
// Aufruf: npm run test:rounded-box
import './core-fixtures-env';
import { strict as assert } from 'node:assert';

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

const { hostCaller } = await import('../src/plugins/hostfns');
const call = hostCaller(['hinge', 'nest']);
const viaHost = (name: string) => (input: unknown) => {
  const r = JSON.parse(call(name, JSON.stringify(input)));
  if (r.error) throw new Error(r.error);
  return r.ok;
};
(globalThis as Record<string, unknown>).host = { hinge: viaHost('hinge'), nest: viaHost('nest') };
const { build } = await import('../plugins/rounded-box/src/box');
const { ring, pointAt, trace, closedRing, slot, stripMap, offsetPolygon, pieceOutline, dovetail } = await import('../plugins/rounded-box/src/geom');
type Node = { x: number; y: number; cin?: { x: number; y: number }; cout?: { x: number; y: number } };
type Sub = { closed: boolean; nodes: Node[] };

const DEF = {
  width: 160, depth: 110, height: 60, radius: 35, thickness: 3, clearance: 0.1, kerf: 0, lid: false, rim: 4,
  hingeKind: 'straight', cutLength: 18, bridge: 3, spacing: 1.5, bendExtra: 0, tabWidth: 10, tabPitch: 40,
};
const box = (p: Partial<typeof DEF> = {}, area: { width: number; height: number } | null = { width: 600, height: 400 }) => build({ ...DEF, ...p }, area);
const codes = (b: ReturnType<typeof box>) => b.issues.map((i) => i.code).sort();
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
/** Points along a sub-path, Bézier segments sampled */
function samples(s: Sub, n = 8) {
  const out: { x: number; y: number }[] = [];
  const N = s.nodes.length, segs = s.closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const a = s.nodes[i], b = s.nodes[(i + 1) % N];
    const c1 = a.cout ?? a, c2 = b.cin ?? b;
    for (let k = 0; k < n; k++) {
      const t = k / n, m = 1 - t;
      out.push({ x: m * m * m * a.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * b.x, y: m * m * m * a.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * b.y });
    }
  }
  return out;
}
const bbox = (pts: { x: number; y: number }[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });

test('centre line: length of a rounded rectangle, points and arcs as Bézier curves on it', () => {
  const rg = ring(157, 107, 33.5);
  near(rg.length, 2 * (157 + 107) - 8 * 33.5 + 2 * Math.PI * 33.5);
  // Every sampled point of the outline moved 5 mm out lies on the rounded rectangle 167 × 117, radius 38.5
  const out = closedRing(rg, 5);
  assert.equal(out.nodes.length, 8);
  const dist = (p: { x: number; y: number }) => {
    const qx = Math.max(Math.abs(p.x) - (83.5 - 38.5), 0), qy = Math.max(Math.abs(p.y) - (58.5 - 38.5), 0);
    return Math.hypot(qx, qy) - 38.5;
  };
  // A quarter circle as one Bézier curve is off by less than 0.03 % of its radius
  for (const p of samples(out as Sub, 16)) assert.ok(Math.abs(dist(p)) < 3e-4 * 38.5, `${p.x}, ${p.y}: ${dist(p)}`);
  // pointAt and trace agree
  const tr = trace(rg, 10, 150, -2);
  const end = pointAt(rg, 150, -2);
  near(tr[tr.length - 1].x, end[0]);
  near(tr[tr.length - 1].y, end[1]);
  // Slots are as wide as asked, across the centre line
  const sl = slot(rg, 100, 110, 3.1);
  const rIn = 33.5 - 1.55, rOut = 33.5 + 1.55;
  const c = { x: 78.5 - 33.5, y: 53.5 - 33.5 };
  for (const p of samples(sl as Sub, 8)) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    assert.ok(d > rIn - 0.01 && d < rOut + 0.01, String(d));
  }
});

test('strip map: bends get the extra length, straight sides keep theirs', () => {
  const rg = ring(100, 60, 20);
  const m0 = stripMap(rg, 0), m1 = stripMap(rg, 1.5);
  near(m0.length, rg.length);
  near(m1.length, rg.length + 6);
  for (const s of [0, 17, 60, 123.4, rg.length - 1]) near(m1.s(m1.x(s)), s);
  assert.equal(m1.bends.length, 4);
  assert.equal(m1.straights.length, 4);
});

test('default box: floor and one wall strip as long as the centre line; a slot for every tab', () => {
  const b = box();
  assert.deepEqual(codes(b), []);
  assert.deepEqual(b.parts.map((p) => p.key), ['floor', 'wall']);
  const rm = 35 - 1.5;
  near(b.stripLength, 2 * (157 + 107) - 8 * rm + 2 * Math.PI * rm);
  const floor = b.parts[0].subs as Sub[];
  // Floor outline: wall outside plus the rim
  const fb = bbox(samples(floor[0], 16));
  near(fb.x1 - fb.x0, 160 + 8, 1e-3);
  near(fb.y1 - fb.y0, 110 + 8, 1e-3);
  // Tabs: outline points below the lower edge of the wall (y down, centred on the part)
  const wall = b.parts[1].subs as Sub[];
  const below = wall[0].nodes.filter((n) => n.y > 30 + 1e-6);
  assert.equal(below.length % 2, 0);
  assert.equal(floor.length - 1, below.length / 2, 'one slot per tab');
  // Living hinge cuts in the four corners: open lines, vertical, none at the ends of the strip
  const cuts = wall.slice(1);
  assert.ok(cuts.length > 100, String(cuts.length));
  const half = b.stripLength / 2;
  for (const s of cuts) {
    assert.equal(s.closed, false);
    near(s.nodes[0].x, s.nodes[s.nodes.length - 1].x, 1e-6);
    assert.ok(s.nodes[0].x > -half + dovetail(3).depth && s.nodes[0].x < half, String(s.nodes[0].x));
  }
  assert.equal(b.info.find(([k]) => k === 'info.cuts')![1], String(cuts.length));
});

test('slots sit where the tabs reach the floor: the strip wrapped round the centre line', () => {
  const b = box({ tabPitch: 25 });
  const rg = ring(157, 107, 33.5);
  const m = stripMap(rg, 0);
  const wall = (b.parts[1].subs as Sub[])[0];
  // Tab centres along the strip (local x + half the strip)
  const xs: number[] = [];
  const low = wall.nodes.filter((n) => n.y > 30 + 1e-6);
  for (let i = 0; i < low.length; i += 2) xs.push((low[i].x + low[i + 1].x) / 2);
  const straight = m.straights.reduce((a, q) => (q[1] - q[0] > a[1] - a[0] ? q : a));
  const seam = (straight[0] + straight[1]) / 2;
  const slots = (b.parts[0].subs as Sub[]).slice(1);
  for (const x of xs) {
    const p = pointAt(rg, m.s(seam + x + b.stripLength / 2));
    const hit = slots.some((s) => {
      const bb = bbox(samples(s));
      return p[0] > bb.x0 - 1e-6 && p[0] < bb.x1 + 1e-6 && p[1] > bb.y0 - 1e-6 && p[1] < bb.y1 + 1e-6;
    });
    assert.ok(hit, `tab at ${x}`);
  }
});

test('dovetails: the end of the strip fits the socket at its start with the play', () => {
  const dv = dovetail(3);
  const o = pieceOutline({ x0: 0, x1: 300, h: 60, t: 3, tabs: [50], tabWidth: 10, top: false, tails: [30], clearance: 0.2, kerf: 0 });
  const head = o.filter(([x]) => Math.abs(x - 300 - dv.depth) < 1e-9).map(([, y]) => y);
  near(Math.max(...head) - Math.min(...head), dv.head);
  const sock = o.filter(([x]) => Math.abs(x - dv.depth - 0.1) < 1e-9).map(([, y]) => y);
  near(Math.max(...sock) - Math.min(...sock), dv.head + 0.2);
  // Kerf moves the whole outline out by half of it
  const k = offsetPolygon([[0, 0], [10, 0], [10, 5], [0, 5]], 0.1);
  assert.deepEqual(k.map((p) => p.map((v) => Math.round(v * 1e9) / 1e9)), [[-0.1, -0.1], [10.1, -0.1], [10.1, 5.1], [-0.1, 5.1]]);
});

test('lid: a second plate like the floor, tabs on both edges', () => {
  const b = box({ lid: true });
  assert.deepEqual(b.parts.map((p) => p.key), ['floor', 'lid', 'wall']);
  assert.deepEqual(b.parts[1].subs, b.parts[0].subs);
  const wall = (b.parts[2].subs as Sub[])[0];
  assert.equal(wall.nodes.filter((n) => n.y < -30 - 1e-6).length, wall.nodes.filter((n) => n.y > 30 + 1e-6).length);
});

test('round box and round ends: the seam lies in a bend and the user is told', () => {
  const round = box({ width: 120, depth: 120, radius: 60 });
  assert.deepEqual(codes(round), ['seam-in-bend']);
  assert.ok(round.parts.length === 2);
  const stadium = box({ width: 200, depth: 80, radius: 40 });
  assert.deepEqual(codes(stadium), []);
});

test('work area: a long wall is split into pieces that fit, joined on straight sides', () => {
  const b = box({ width: 500, depth: 300, radius: 50, height: 80 }, { width: 400, height: 300 });
  assert.deepEqual(codes(b), []);
  assert.ok(b.pieces.length >= 4, String(b.pieces.length));
  for (const [a, z] of b.pieces) assert.ok(z - a <= 400 - dovetail(3).depth - 4 + 1e-6, `${z - a}`);
  assert.deepEqual(b.parts.map((p) => p.key).slice(1), b.pieces.map((_, i) => `wall${i + 1}`));
  // Without a work area: one piece
  assert.equal(box({ width: 500, depth: 300, radius: 50 }, null).pieces.length, 1);
});

test('problems: radius, height, kerf; living hinge problems come from the app', () => {
  assert.deepEqual(codes(box({ radius: 3 })), ['radius-small']);
  assert.deepEqual(codes(box({ radius: 60 })), ['radius-large']);
  assert.deepEqual(codes(box({ height: 12 })), ['height-small']);
  assert.deepEqual(codes(box({ thickness: 1, kerf: 1, clearance: -1 })), ['kerf-large']);
  assert.deepEqual(codes(box({ radius: 12 })), ['radius-tight']);
  assert.deepEqual(codes(box({ spacing: 0.3, bridge: 0.3, cutLength: 2, width: 1800, depth: 1800, radius: 900, height: 900 }, null)), ['hinge-too-many-rows', 'seam-in-bend']);
  // bendExtra makes the strip longer by four times its value
  near(box({ bendExtra: 1 }).stripLength - box().stripLength, 4);
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall rounded box tests passed');
