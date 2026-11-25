// Tests des Deckelscharniers (Verbindung „lidhinge“). Aufruf: npm run test:joints
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Obj, Pt, SubPath } from '../src/model';
import type { EdgePick, JointOptions } from '../src/joints';
const { IDENT } = await import('../src/model');
const { computeJoint, DEFAULT_JOINT, lidHingeDims, lidHingeProfiles } = await import('../src/joints');
const { bezierPt, segments } = await import('../src/curves');

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
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const rect = (x: number, y: number, w: number, h: number): Obj => ({
  id: Math.random(), m: IDENT, layer: 0,
  shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }] },
});
const pick = (obj: Obj, seg: number): EdgePick => ({ obj, m: IDENT, sub: 0, seg });
const opts = (o: Partial<JointOptions> = {}): JointOptions => ({ ...DEFAULT_JOINT, kind: 'lidhinge', thickness: 3, ...o });

/** Unterpfad als fein abgetastetes Polygon */
function flatten(sp: SubPath): Pt[] {
  const pts: Pt[] = [];
  for (const s of segments(sp)) {
    if (!s.curve) pts.push(s.a);
    else for (let i = 0; i < 32; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 32));
  }
  return pts;
}
function inside(poly: Pt[], p: Pt): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
const area = (poly: Pt[]) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
/** Punkte eines Rechtecks [x0,x1]×[y0,y1] (Rand und Inneres), um die Achse gedreht (im Uhrzeigersinn = Deckel öffnet) */
function rectSamples(x0: number, x1: number, y0: number, y1: number, step = 0.1): Pt[] {
  const pts: Pt[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) for (let y = y0; y <= y1 + 1e-9; y += step) pts.push({ x, y });
  return pts;
}
const rotCw = (p: Pt, c: Pt, a: number): Pt => {
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) + dy * Math.sin(a), y: c.y - dx * Math.sin(a) + dy * Math.cos(a) };
};

test('Schlitze in Rückwand und Deckel, Knöchel als neue Teile', () => {
  const wall = rect(0, 0, 100, 50), lid = rect(0, -100, 100, 60);
  const r = computeJoint([pick(wall, 0), pick(lid, 0)], opts());
  assert.equal(r.error, undefined);
  // 5 Knöchel: 3 am Kasten (außen und Mitte), 2 am Deckel
  assert.equal(r.changes.get(wall)!.subs.length, 1 + 3);
  assert.equal(r.changes.get(lid)!.subs.length, 1 + 2);
  // je Knöchel Umriss + Stiftloch
  assert.equal(r.added.length, 5 * 2);
  const d = lidHingeDims(opts(), 1);
  // Schlitz: Materialdicke breit, Zapfenlänge tief, mit Abstand zur Kante; erster mittig bei 10 mm
  const slot = r.changes.get(wall)!.subs[1].nodes;
  const xs = slot.map((p) => p.x), ys = slot.map((p) => p.y);
  near(Math.max(...xs) - Math.min(...xs), 3);
  near((Math.max(...xs) + Math.min(...xs)) / 2, 10);
  near(Math.max(...ys) - Math.min(...ys), d.T);
  near(Math.min(...ys), d.s0);
  // Deckel-Schlitze an den Stellen dazwischen (30 und 70 mm)
  const mids = r.changes.get(lid)!.subs.slice(1).map((sp) => (Math.min(...sp.nodes.map((p) => p.x)) + Math.max(...sp.nodes.map((p) => p.x))) / 2);
  assert.deepEqual(mids.map((m) => Math.round(m * 1000) / 1000).sort((a, b) => a - b), [30, 70]);
  assert.match(r.info, /3 Knöchel für den Kasten, 2 für den Deckel; Stift Ø 3 mm, etwa 87 mm lang/);
});

test('Gerade Knöchelzahl wird ungerade, eine Kante allein geht nicht', () => {
  const wall = rect(0, 0, 100, 50), lid = rect(0, -100, 100, 60);
  const r = computeJoint([pick(wall, 0), pick(lid, 0)], opts({ hingeCount: 4 }));
  assert.equal(r.added.length, 5 * 2);
  assert.ok(computeJoint([pick(wall, 0)], opts()).error);
  assert.ok(computeJoint([pick(wall, 0), pick(lid, 0)], opts({ hingeCount: 41 })).error, 'zu viele Knöchel');
});

test('Stiftloch mittig im Auge, mit Spiel', () => {
  const o = opts({ pinDia: 3, pinPlay: 0.2 });
  const d = lidHingeDims(o, 1);
  for (const part of Object.values(lidHingeProfiles(o, 1))) {
    const hole = flatten(part[1]);
    const cx = hole.reduce((s, p) => s + p.x, 0) / hole.length, cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
    near(cx, d.ax, 1e-3);
    near(cy, d.ay, 1e-3);
    for (const p of hole) near(Math.hypot(p.x - d.ax, p.y - d.ay), 1.6, 2e-3);
    const outline = flatten(part[0]);
    // Auge: ganzer Kreis um das Loch liegt im Teil (Wandstärke rundum)
    for (let a = 0; a < 2 * Math.PI; a += 0.05) assert.ok(inside(outline, { x: d.ax + Math.cos(a) * (d.R - 0.05), y: d.ay + Math.sin(a) * (d.R - 0.05) }) || Math.sin(a) < 0, 'Auge offen');
    assert.ok(Math.abs(area(outline)) > Math.PI * d.R * d.R * 0.5);
  }
});

test('Deckel öffnet bis 100° ohne an Kasten-Knöcheln oder Rückwand anzustoßen', () => {
  for (const o of [opts(), opts({ thickness: 6, pinDia: 4, hingeWall: 3 }), opts({ thickness: 2, pinDia: 1.75, hingeWall: 1.5 })]) {
    const d = lidHingeDims(o, 1);
    const prof = lidHingeProfiles(o, 1);
    const A = { x: d.ax, y: d.ay };
    const boxKnuckle = flatten(prof.box[0]);
    const lidKnuckle = flatten(prof.lid[0]);
    const lidPlate = rectSamples(-40, -0.01, 0.01, d.th - 0.01, 0.2);
    // Rückwand ohne den Bereich der Schlitze (dort steckt der Zapfen des eigenen Knöchels)
    const wallHit = (p: Pt) => p.x > -d.th && p.x < 0 && p.y < 0 && p.y > -60;
    const lidKnSamples = rectSamples(-d.mid - d.tenonHalf, d.ax + d.R, d.ay - d.R, d.ay + d.R, 0.2).filter((p) => inside(lidKnuckle, p) && p.y > d.th + 0.01 || (inside(lidKnuckle, p) && p.x > 0.01));
    for (let deg = 0; deg <= 100; deg += 2) {
      const a = (deg * Math.PI) / 180;
      for (const p of lidPlate) assert.ok(!inside(boxKnuckle, rotCw(p, A, a)), `Deckel trifft Kasten-Knöchel bei ${deg}° (t=${d.th})`);
      for (const p of lidKnSamples) assert.ok(!wallHit(rotCw(p, A, a)), `Deckel-Knöchel trifft Rückwand bei ${deg}° (t=${d.th})`);
    }
  }
});

// --- Fingerzinken nach innen: keine Stege der Breite null an den Ecken (#401) ---
const finger = (o: Partial<JointOptions> = {}): JointOptions => ({ ...DEFAULT_JOINT, kind: 'finger', thickness: 3, fingerWidth: 10, direction: 'in', ...o });
/** Stellen, an denen die Kontur auf derselben Linie zurückläuft */
function spikes(sp: SubPath): Pt[] {
  const ns = sp.nodes, out: Pt[] = [];
  ns.forEach((b, i) => {
    const a = ns[(i + ns.length - 1) % ns.length], c = ns[(i + 1) % ns.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 1e-9 && dot < 0) out.push(b);
  });
  return out;
}
/** Knoten als Ring vergleichen (Anfang egal) */
function sameRing(got: Pt[], want: [number, number][]) {
  const s = (p: { x: number; y: number }) => `${Math.round(p.x * 1e6) / 1e6},${Math.round(p.y * 1e6) / 1e6}`;
  const g = got.map(s), w = want.map(([x, y]) => s({ x, y }));
  assert.equal(g.length, w.length, `nodes: ${g.join(' ')}`);
  const k = g.indexOf(w[0]);
  assert.ok(k >= 0, `nodes: ${g.join(' ')}`);
  assert.deepEqual([...g.slice(k), ...g.slice(0, k)], w);
}

test('Fingerzinken nach innen: Gegenstück, das mit einer Lücke beginnt und endet, ohne Stege an den Ecken (#401)', () => {
  // Beispiel aus #401: rechte Kante von a (50 × 50) und linke Kante von b (40 × 50)
  const a = rect(0, 0, 50, 50), b = rect(0, 0, 40, 50);
  const r = computeJoint([pick(a, 1), pick(b, 3)], finger());
  assert.equal(r.error, undefined);
  const sb = r.changes.get(b)!.subs[0];
  assert.deepEqual(spikes(sb), []);
  sameRing(sb.nodes, [[3, 0], [40, 0], [40, 50], [3, 50], [3, 40], [0, 40], [0, 30], [3, 30], [3, 20], [0, 20], [0, 10], [3, 10]]);
  near(area(flatten(sb)), 40 * 50 - 3 * 10 * 3);
  // a beginnt und endet mit einem Zinken: unverändert bis auf die Lücken
  const sa = r.changes.get(a)!.subs[0];
  assert.deepEqual(spikes(sa), []);
  near(area(flatten(sa)), 50 * 50 - 2 * 10 * 3);
  // swap: jetzt beginnt a mit einer Lücke, b mit einem Zinken
  const s = computeJoint([pick(a, 1), pick(b, 3)], finger({ swap: true }));
  for (const o of [a, b]) assert.deepEqual(spikes(s.changes.get(o)!.subs[0]), [], 'swap');
  near(area(flatten(s.changes.get(a)!.subs[0])), 50 * 50 - 3 * 10 * 3);
});

test('Fingerzinken nach innen: Kanten verschiedener Länge (Rand > 0), Spiel und Schnittfuge, auch einzeln', () => {
  // b ist länger: das Muster (50 mm) liegt mittig, die Endfelder sind um je 5 mm länger
  const a = rect(0, 0, 50, 50), b = rect(0, 0, 40, 60);
  for (const o of [finger(), finger({ clearance: 0.1, kerf: 0.15 }), finger({ swap: true, clearance: -0.1 })]) {
    const r = computeJoint([pick(a, 1), pick(b, 3)], o);
    assert.equal(r.error, undefined);
    for (const obj of [a, b]) assert.deepEqual(spikes(r.changes.get(obj)!.subs[0]), [], JSON.stringify({ clearance: o.clearance, swap: o.swap }));
  }
  const r = computeJoint([pick(a, 1), pick(b, 3)], finger());
  // b (Lücke am Anfang und Ende, je 15 mm lang): die Ecken rücken um die Materialdicke nach innen
  const xs = r.changes.get(b)!.subs[0].nodes.filter((p) => p.y === 0 || p.y === 60).map((p) => p.x).sort((x, y) => x - y);
  assert.deepEqual(xs, [3, 3, 40, 40]);
  near(area(flatten(r.changes.get(b)!.subs[0])), 40 * 60 - (15 + 10 + 15) * 3);
  // eine Kante allein (Zinken ohne Gegenstück), mit Lücke am Anfang
  const one = computeJoint([pick(rect(0, 0, 40, 50), 3)], finger({ swap: true }));
  assert.deepEqual(spikes([...one.changes.values()][0].subs[0]), []);
});

test('Fingerzinken nach außen bleiben, wie sie waren', () => {
  const a = rect(0, 0, 50, 50), b = rect(0, 0, 40, 50);
  const r = computeJoint([pick(a, 1), pick(b, 3)], finger({ direction: 'out' }));
  sameRing(r.changes.get(b)!.subs[0].nodes, [[0, 0], [40, 0], [40, 50], [0, 50], [0, 40], [-3, 40], [-3, 30], [0, 30], [0, 20], [-3, 20], [-3, 10], [0, 10]]);
});

// ---------- Joints on curved edges (#513) ----------
{
  const { smoothChain } = await import('../src/jointsCurve');
  const K = 0.5522847498;
  /** Circle as four Bézier quarters (like the ellipse tool) */
  const circle = (cx: number, cy: number, r: number): Obj => {
    const k = r * K;
    return {
      id: Math.random(), m: IDENT, layer: 0,
      shape: { kind: 'path', subs: [{ closed: true, nodes: [
        { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k } },
        { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r } },
        { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k } },
        { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r } },
      ] }] },
    };
  };
  /** Rounded rectangle: lines and quarter arcs, corners tangent */
  const rounded = (w: number, h: number, r: number): Obj => {
    const k = r * K;
    return {
      id: Math.random(), m: IDENT, layer: 0,
      shape: { kind: 'path', subs: [{ closed: true, nodes: [
        { x: r, y: 0 }, { x: w - r, y: 0, cout: { x: w - r + k, y: 0 } }, { x: w, y: r, cin: { x: w, y: r - k } },
        { x: w, y: h - r, cout: { x: w, y: h - r + k } }, { x: w - r, y: h, cin: { x: w - r + k, y: h } },
        { x: r, y: h, cout: { x: r - k, y: h } }, { x: 0, y: h - r, cin: { x: 0, y: h - r + k } },
        { x: 0, y: r, cout: { x: 0, y: r - k } }, { x: r, y: 0, cin: { x: r - k, y: 0 } },
      ].slice(0, 8).map((n, i, a) => (i === 0 ? { ...n, cin: { x: r - k, y: 0 } } : n)) }] },
    };
  };
  const cpick = (obj: Obj, seg: number): EdgePick => {
    const c = smoothChain((obj.shape as { subs: SubPath[] }).subs[0], seg);
    return { obj, m: IDENT, sub: 0, seg: c.seg, segs: c.segs };
  };
  const fingerOpts = (o: Partial<JointOptions> = {}): JointOptions => ({ ...DEFAULT_JOINT, kind: 'finger', thickness: 3, fingerWidth: 10, ...o });
  /** Radii of a finely sampled outline around (cx, cy) */
  const radii = (sp: SubPath, cx: number, cy: number) => flatten(sp).map((p) => Math.hypot(p.x - cx, p.y - cy));

  test('Curves: the smooth run of a circle is the whole loop, of a rounded rectangle the whole outline', () => {
    const c = circle(0, 0, 50);
    assert.deepEqual(smoothChain((c.shape as { subs: SubPath[] }).subs[0], 2), { seg: 2, segs: 4 });
    const r = rounded(100, 60, 15);
    assert.equal(smoothChain((r.shape as { subs: SubPath[] }).subs[0], 1).segs, 8);
    // A plain rectangle: no smooth run beyond the segment
    const q = rect(0, 0, 40, 20);
    assert.deepEqual(smoothChain((q.shape as { subs: SubPath[] }).subs[0], 1), { seg: 1, segs: 1 });
  });

  test('Curves: finger joint round a circle with a straight strip; fields on the wall middle, fingers radial', () => {
    const R = 50, th = 3;
    const disc = circle(0, 0, R);
    const L = 2 * Math.PI * (R - th / 2);
    const strip = rect(0, 100, L, 40);
    const r = computeJoint([cpick(disc, 0), pick(strip, 0)], fingerOpts());
    assert.equal(r.error, undefined, r.error);
    assert.match(r.info, /Felder/);
    const out = r.changes.get(disc)!.subs[0];
    assert.equal(out.closed, true);
    // Every point of the disc lies on the full radius or th further in (fitted within 0.02 mm), with radial flanks
    const rs = radii(out, 0, 0);
    const onLevel = rs.filter((x) => Math.abs(x - R) < 0.02 || Math.abs(x - (R - th)) < 0.02).length;
    assert.ok(onLevel / rs.length > 0.95, `${onLevel} of ${rs.length}`);
    // Even number of fields: as many fingers as gaps round the loop
    const n = Number(r.info.match(/(\d+) Felder/)![1]);
    assert.equal(n % 2, 0);
    // The strip got the matching straight pattern over its whole length (no margin)
    const sn = r.changes.get(strip)!.subs[0].nodes;
    // Fingers cut into the strip ('in'): nothing above its edge at y = 100, the gaps 3 mm down
    assert.ok(sn.every((q) => q.y >= 100 - 1e-9), 'nothing sticks out of the strip');
    assert.ok(sn.some((q) => Math.abs(q.y - 103) < 1e-6));
    const steps = sn.filter((q) => Math.abs(q.y - 100) < 1e-6 || Math.abs(q.y - 97) < 1e-6 || Math.abs(q.y - 103) < 1e-6);
    assert.ok(steps.length >= n, `${steps.length} nodes on the strip edge`);
    // Angle of each finger flank on the disc matches the boundary position on the strip: u / (R − th/2)
    const w = L / n;
    const flank = rs.findIndex((x, i) => i > 0 && Math.abs(rs[i - 1] - R) < 0.02 && Math.abs(x - R) > 0.02);
    assert.ok(flank > 0);
    const pts = flatten(out);
    const ang = Math.atan2(pts[flank].y, pts[flank].x);
    const u = (((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (R - th / 2);
    const rem = u / w - Math.round(u / w);
    assert.ok(Math.abs(rem * w) < 0.3, `flank at ${u} mm, field ${w} mm`);
  });

  const { edgePickAt, samePick, validEdge, pickPoints } = await import('../src/joints');
  test('Curves: picking a curve takes its smooth run; two picks on one circle are the same edge', () => {
    const c = circle(0, 0, 50);
    const p1 = edgePickAt(c, IDENT, 0, 1), p2 = edgePickAt(c, IDENT, 0, 3);
    assert.deepEqual([p1.seg, p1.segs], [1, 4]);
    assert.ok(samePick(p1, p2) && validEdge(p1));
    assert.equal(pickPoints(p1).length, 4 * 16 + 1);
    const q = rect(0, 0, 40, 20);
    const s = edgePickAt(q, IDENT, 0, 2);
    assert.equal(s.segs, undefined);
    assert.ok(!samePick(s, edgePickAt(q, IDENT, 0, 1)));
  });

  test('Curves: the straight partner finds its material side whatever the direction of its outline', () => {
    const disc = circle(0, 0, 40);
    const L = 2 * Math.PI * 38.5;
    // Rectangle drawn the other way round: the top edge runs from right to left
    const strip: Obj = { id: 7, m: IDENT, layer: 0, shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x: 0, y: 100 }, { x: 0, y: 140 }, { x: L, y: 140 }, { x: L, y: 100 }] }] } };
    const r = computeJoint([cpick(disc, 0), pick(strip, 3)], fingerOpts());
    assert.equal(r.error, undefined, r.error);
    const sn = r.changes.get(strip)!.subs[0].nodes;
    assert.ok(sn.every((q) => q.y >= 100 - 1e-9), 'fingers cut in, nothing sticks out');
  });

  test('Curves: a strip longer than the loop gets the pattern from its start and a plain rest, no spike at the corner', () => {
    const disc = circle(0, 0, 40);
    const L = 2 * Math.PI * 38.5;
    const strip = rect(0, 100, L + 60, 40);
    const r = computeJoint([cpick(disc, 0), pick(strip, 0)], fingerOpts());
    assert.equal(r.error, undefined, r.error);
    assert.match(r.info, /Muster ab Streifenanfang/);
    const sn = r.changes.get(strip)!.subs[0].nodes;
    assert.ok(sn.every((q) => q.y >= 100 - 1e-9));
    // The strip (phase 1) starts with a gap: the corner (0, 100) is gone, the outline goes straight down the side
    assert.ok(!sn.some((q) => Math.abs(q.x) < 1e-9 && Math.abs(q.y - 100) < 1e-9), JSON.stringify(sn.slice(0, 4)));
    // The rest after the pattern stays on the edge
    assert.ok(sn.some((q) => Math.abs(q.x - (L + 60)) < 1e-9 && Math.abs(q.y - 100) < 1e-9));
    const last = sn.filter((q) => Math.abs(q.y - 103) < 1e-6).reduce((m, q) => Math.max(m, q.x), 0);
    assert.ok(last <= L + 1e-6, `${last} > ${L}`);
  });

  test('Curves: a strip too short for the loop is refused; text tells the length on the wall middle', () => {
    const disc = circle(0, 0, 40);
    const short = rect(0, 100, 200, 40);
    const r = computeJoint([cpick(disc, 0), pick(short, 0)], fingerOpts());
    assert.ok(r.error && /241[.,]9/.test(r.error), r.error);
    const one = computeJoint([cpick(disc, 0)], fingerOpts());
    assert.equal(one.error, undefined);
    assert.match(one.info, /241[.,]9/);
  });

  test('Curves: tenons on a straight strip, curved slots in a disc on the slot centre line', () => {
    const R = 50, th = 3;
    const disc = circle(0, 0, R);
    const strip = rect(0, 100, 200, 40);
    const r = computeJoint([pick(strip, 0), cpick(disc, 0)], fingerOpts({ kind: 'tenon', tenonCount: 4, tenonWidth: 12, slotOffset: 5 }));
    assert.equal(r.error, undefined, r.error);
    const subs = r.changes.get(disc)!.subs;
    assert.equal(subs.length, 5, 'outline and 4 slots');
    for (const sl of subs.slice(1)) {
      const rs = radii(sl, 0, 0);
      assert.ok(Math.min(...rs) > R - 5 - th / 2 - 0.05 && Math.max(...rs) < R - 5 + th / 2 + 0.05, `${Math.min(...rs)} … ${Math.max(...rs)}`);
    }
    // Tenon spacing 50 mm along the strip = 50 mm along the slot centre line (radius 45)
    const mids = subs.slice(1).map((sl) => {
      const p = flatten(sl);
      const c = p.reduce((a, q) => ({ x: a.x + q.x / p.length, y: a.y + q.y / p.length }), { x: 0, y: 0 });
      return Math.atan2(c.y, c.x);
    });
    let d = Math.abs(mids[1] - mids[0]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    near(d * 45, 50, 0.05);
  });

  test('Curves: kinds other than fingers and tenons need straight edges; a too tight curve is refused', () => {
    const disc = circle(0, 0, 50);
    assert.ok(computeJoint([cpick(disc, 0)], fingerOpts({ kind: 'lap' })).error);
    const tiny = circle(0, 0, 2);
    assert.ok(computeJoint([cpick(tiny, 0)], fingerOpts()).error);
  });

  test('Curves: fingers along a rounded rectangle keep the rest of the outline closed and smooth', () => {
    const r0 = rounded(120, 80, 20);
    const r = computeJoint([cpick(r0, 0)], fingerOpts());
    assert.equal(r.error, undefined, r.error);
    const sp = r.changes.get(r0)!.subs[0];
    assert.ok(sp.closed && sp.nodes.length > 20);
    // All points inside the outer outline and outside the outline 3 mm further in
    for (const p of flatten(sp)) {
      const dx = Math.max(Math.abs(p.x - 60) - 40, 0), dy = Math.max(Math.abs(p.y - 40) - 20, 0);
      const dist = Math.hypot(dx, dy) - 20;
      assert.ok(dist < 0.03 && dist > -3.03, `${p.x}, ${p.y}: ${dist}`);
    }
  });

  test('Curves: an arc between two straight corners is replaced in place', () => {
    // Half disc: straight diameter and one arc (two quarters)
    const k = 30 * K;
    const half: Obj = { id: 1, m: IDENT, layer: 0, shape: { kind: 'path', subs: [{ closed: true, nodes: [
      { x: -30, y: 0, cout: { x: -30, y: k } }, { x: 0, y: 30, cin: { x: -k, y: 30 }, cout: { x: k, y: 30 } }, { x: 30, y: 0, cin: { x: 30, y: k } },
    ] }] } };
    const c = smoothChain((half.shape as { subs: SubPath[] }).subs[0], 0);
    assert.deepEqual(c, { seg: 0, segs: 2 });
    const r = computeJoint([cpick(half, 0)], fingerOpts());
    assert.equal(r.error, undefined, r.error);
    const sp = r.changes.get(half)!.subs[0];
    // The diameter stays one straight segment from (30, 0) back to (−30, 0)
    const ns = sp.nodes;
    const i = ns.findIndex((q) => Math.abs(q.x - 30) < 1e-9 && Math.abs(q.y) < 1e-9);
    assert.ok(i >= 0);
    const next = ns[(i + 1) % ns.length];
    assert.ok(Math.abs(next.x + 30) < 1e-9 && Math.abs(next.y) < 1e-9 && !ns[i].cout && !next.cin);
  });
}

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Verbindungs-Tests bestanden');
