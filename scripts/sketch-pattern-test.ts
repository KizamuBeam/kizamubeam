// Phase 0: Muster-Typen, Caps, Parse-Regel (rein, ohne UI/Solver).
// Aufruf: npm run test:sketch-pattern (node scripts/run-ts.mjs scripts/sketch-pattern-test.ts)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const M = await import('../src/sketch/model');
const P = await import('../src/sketch/pattern');

let failed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  pending.push((async () => {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n${(e as Error).stack}`);
    }
  })());
}

/** Valides Kreismuster mit n Kopien (leere Instanzen, nur Zählung/Slots). */
function circular(count: number, angle = 360): P.SketchPattern {
  const kind: P.CircularPatternKind = { type: 'circular', center: 1, count, angle, alignment: 'right', reversed: false };
  return { id: 'p1', entities: [2], kind, instances: Array.from({ length: count - 1 }, (_, i) => ({ index: [i + 1, 0] as [number, number], curves: [], points: [] })) };
}

function rectangular(count: number, count2: number): P.SketchPattern {
  const kind: P.RectangularPatternKind = {
    type: 'rectangular', count, spacing: 20, count2, spacing2: 10,
    dir: { x: 1, y: 0 }, dir2: { x: 0, y: 1 }, alignment: 'right', alignment2: 'right', reversed: false, reversed2: false,
  };
  const instances: P.PatternInstance[] = [];
  for (let i = 0; i < count; i++) for (let j = 0; j < count2; j++) {
    if (i === 0 && j === 0) continue;
    instances.push({ index: [i, j], curves: [], points: [] });
  }
  return { id: 'p2', entities: [2], kind, instances };
}

test('Caps: Kreis-Anzahl 2…500 ganzzahlig', () => {
  assert.equal(P.validCircularCount(2), true);
  assert.equal(P.validCircularCount(500), true);
  assert.equal(P.validCircularCount(1), false);
  assert.equal(P.validCircularCount(0), false);
  assert.equal(P.validCircularCount(501), false);
  assert.equal(P.validCircularCount(2.5), false);
  assert.equal(P.validCircularCount(NaN), false);
  assert.equal(P.validCircularCount(Infinity), false);
  assert.equal(P.validCircularCount('4'), false);
});

test('Caps: Toleranz |v−rund| < 1e-9', () => {
  assert.equal(P.asWholeCount(4.0000000001), 4);
  assert.equal(P.asWholeCount(4.00000001), null);
  assert.equal(P.asWholeCount(3.9999999999), 4);
});

test('Caps: Rechteck-Anzahl und Produkt ≤ 500', () => {
  assert.equal(P.validRectangularCount(1), true);
  assert.equal(P.validRectangularCount(500), true);
  assert.equal(P.validRectangularCount(0), false);
  assert.equal(P.validRectangularCount(501), false);
  assert.equal(P.validRectangularProduct(25, 20), true);
  assert.equal(P.validRectangularProduct(26, 20), false);
  assert.equal(P.validRectangularProduct(1, 1), true);
  assert.equal(P.validRectangularProduct(0, 5), false);
});

test('Caps: Winkel 0 < |a| ≤ 360, Abstand endlich', () => {
  assert.equal(P.validPatternAngle(360), true);
  assert.equal(P.validPatternAngle(-360), true);
  assert.equal(P.validPatternAngle(180), true);
  assert.equal(P.validPatternAngle(0.5), true);
  assert.equal(P.validPatternAngle(0), false);
  assert.equal(P.validPatternAngle(361), false);
  assert.equal(P.validPatternAngle(Infinity), false);
  assert.equal(P.validPatternSpacing(20), true);
  assert.equal(P.validPatternSpacing(0), true);
  assert.equal(P.validPatternSpacing(Infinity), false);
  assert.equal(P.validPatternSpacingForCount(0, 1), true);
  assert.equal(P.validPatternSpacingForCount(0, 2), false);
  assert.equal(P.validPatternSpacingForCount(20, 2), true);
});

test('Caps: Ausdrücke 1…4096 Zeichen, nur bekannte Schlüssel', () => {
  assert.equal(P.validPatternExpression('count', 'n'), true);
  assert.equal(P.validPatternExpression('angle', 'halber Winkel'), true);
  assert.equal(P.validPatternExpression('count', ''), false);
  assert.equal(P.validPatternExpression('count', '   '), false);
  assert.equal(P.validPatternExpression('falsch', 'n'), false);
  assert.equal(P.validPatternExpression('count', 'x'.repeat(4097)), false);
  assert.equal(P.validPatternExpression('count', 'x'.repeat(4096)), true);
});

test('Slots: Kopie-Anzahl ohne Original', () => {
  assert.equal(P.patternInstanceCount(circular(4).kind), 3);
  assert.equal(P.patternInstanceCount(circular(2).kind), 1);
  assert.equal(P.patternInstanceCount(rectangular(3, 2).kind), 5);
  assert.equal(P.patternInstanceCount(rectangular(1, 1).kind), 0);
});

test('Struktur: valide Muster passieren, Rest fällt weg', () => {
  assert.equal(P.isValidSketchPattern(circular(4)), true);
  assert.equal(P.isValidSketchPattern(rectangular(3, 2)), true);
  assert.equal(P.isValidSketchPattern({ ...circular(4), id: '' }), false);
  assert.equal(P.isValidSketchPattern({ ...circular(4), entities: [] }), false);
  assert.equal(P.isValidSketchPattern(circular(1)), false);
  assert.equal(P.isValidSketchPattern({ ...circular(4), instances: [] }), false);
  const wrongKind = { ...circular(4), kind: { ...(circular(4).kind as P.CircularPatternKind), type: 'bogus' } };
  assert.equal(P.isValidSketchPattern(wrongKind), false);
});

test('Struktur: Ausdrücke werden mitgeprüft', () => {
  const withExpr = { ...circular(4), expressions: { count: 'n' } };
  assert.equal(P.isValidSketchPattern(withExpr), true);
  assert.equal(P.isValidSketchPattern({ ...circular(4), expressions: { bogus: 'n' } }), false);
  assert.equal(P.isValidSketchPattern({ ...circular(4), expressions: { count: '' } }), false);
  assert.equal(P.isValidSketchPattern({ ...circular(4), expressions: 'n' }), false);
});

test('Roundtrip: Muster überleben Speichern/Laden, Ungültige nicht', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0), c = M.addPt(sk, 30, 0);
  const circle = M.addCircle(sk, c.id, 5);
  const good = circular(4);
  good.entities = [circle.id];
  (good.kind as P.CircularPatternKind).center = pivot.id;
  const raw = JSON.parse(M.sketchJson(sk));
  raw.patterns = [good, circular(1), { id: '', entities: [1], kind: circular(4).kind, instances: [] }, null, 'text'];
  const back = M.parseSketch(raw);
  assert.equal(back.patterns?.length, 1);
  assert.equal(back.patterns?.[0].id, 'p1');
  assert.deepEqual(back.patterns?.[0].entities, [circle.id]);
});

test('Roundtrip: ohne Muster kein patterns-Feld (kein JSON-Bloat)', () => {
  const sk = M.emptySketch();
  M.addPt(sk, 1, 2);
  const back = M.parseSketch(M.sketchJson(sk));
  assert.equal(back.patterns, undefined);
  assert.equal('patterns' in JSON.parse(M.sketchJson(sk)), false);
  const empty = M.parseSketch({ ...JSON.parse(M.sketchJson(sk)), patterns: [] });
  assert.equal(empty.patterns, undefined);
});

// Phase 1: reine Bau-Operationen (Geometrie-Asserts, kein Mock).
const PB = await import('../src/sketch/patternBuild');

function pbNear(a: number, b: number, eps = 1e-9): void {
  assert.ok(Math.abs(a - b) < eps, `erwartet ${b}, erhalten ${a}`);
}

function pbPt(sk: M.Sketch, id: number): { x: number; y: number } {
  const p = M.ptOf(sk, id);
  assert.ok(p, `Punkt ${id} fehlt`);
  return { x: p!.x, y: p!.y };
}

/** Kopiepunkt eines Slots finden: [Quellpunkt-id, Kopiepunkt-id]-Paar auflösen. */
function pbCopy(sk: M.Sketch, inst: P.PatternInstance, seedPt: number): { x: number; y: number } {
  const pair = inst.points.find(([s]) => s === seedPt);
  assert.ok(pair, `Slot ${inst.index} bildet Quellpunkt ${seedPt} nicht ab`);
  return pbPt(sk, pair![1]);
}

function pbLineSketch(): { sk: M.Sketch; pivot: number; pa: number; pb: number; line: number } {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const pa = M.addPt(sk, 30, 0);
  const pb = M.addPt(sk, 30, 10);
  const line = M.addLine(sk, pa.id, pb.id);
  return { sk, pivot: pivot.id, pa: pa.id, pb: pb.id, line: line.id };
}

test('Phase 1: Kreis 4×90° Positionen exakt', () => {
  const { sk, pivot, pa, pb, line } = pbLineSketch();
  const r = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 4, angle: 360 });
  assert.ok(!('error' in r), `unerwarteter Fehler: ${(r as { error: string }).error}`);
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.equal(pattern.instances.length, 3);
  assert.deepEqual(pattern.instances.map((i) => i.index), [[1, 0], [2, 0], [3, 0]]);
  const at = (k: number) => pbCopy(sk, pattern.instances[k], pa);
  const p1 = at(0), p2 = at(1), p3 = at(2);
  pbNear(p1.x, 0); pbNear(p1.y, 30);
  pbNear(p2.x, -30); pbNear(p2.y, 0);
  pbNear(p3.x, 0); pbNear(p3.y, -30);
  const q1 = pbCopy(sk, pattern.instances[0], pb);
  pbNear(q1.x, -10); pbNear(q1.y, 30);
});

test('Phase 1: Kreis zentriert 5 Slots (0,+1,−1,+2,−2)', () => {
  const { sk, pivot, pa, line } = pbLineSketch();
  // Teilwinkel 180° bei Count 5: Schritt 45°, Multiplikatoren +1,−1,+2,−2.
  const r = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 5, angle: 180, alignment: 'center' });
  assert.ok(!('error' in r));
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.equal(pattern.instances.length, 4);
  const d = 30 * Math.cos(Math.PI / 4);
  const got = pattern.instances.map((inst) => pbCopy(sk, inst, pa));
  pbNear(got[0].x, d); pbNear(got[0].y, d);
  pbNear(got[1].x, d); pbNear(got[1].y, -d);
  pbNear(got[2].x, 0); pbNear(got[2].y, 30);
  pbNear(got[3].x, 0); pbNear(got[3].y, -30);
});

test('Phase 1: Kreis Flip-Seite negiert Slots', () => {
  const { sk, pivot, pa, line } = pbLineSketch();
  const r = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 4, angle: 360, reversed: true });
  assert.ok(!('error' in r));
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  const got = pattern.instances.map((inst) => pbCopy(sk, inst, pa));
  pbNear(got[0].x, 0); pbNear(got[0].y, -30);
  pbNear(got[1].x, -30); pbNear(got[1].y, 0);
  pbNear(got[2].x, 0); pbNear(got[2].y, 30);
});

test('Phase 1: Kreis Teilwinkel 180° Endpunkte inklusive', () => {
  const { sk, pivot, pa, line } = pbLineSketch();
  const r = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 3, angle: 180 });
  assert.ok(!('error' in r));
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.equal(pattern.instances.length, 2);
  pbNear(pbCopy(sk, pattern.instances[0], pa).x, 0);
  pbNear(pbCopy(sk, pattern.instances[0], pa).y, 30);
  pbNear(pbCopy(sk, pattern.instances[1], pa).x, -30);
  pbNear(pbCopy(sk, pattern.instances[1], pa).y, 0);
});

test('Phase 1: Rechteck 3×2 Positionen, dir2 senkrecht', () => {
  const sk = M.emptySketch();
  const pa = M.addPt(sk, 0, 0), pb = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, pa.id, pb.id);
  const r = PB.buildRectangularPattern(sk, { entities: [line.id], count: 3, spacing: 10, count2: 2, spacing2: 5 });
  assert.ok(!('error' in r));
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.equal(pattern.instances.length, 5);
  const byKey = new Map(pattern.instances.map((inst) => [`${inst.index[0]},${inst.index[1]}`, inst]));
  const expect: Record<string, [number, number]> = {
    '1,0': [10, 0], '2,0': [20, 0], '0,1': [0, 5], '1,1': [10, 5], '2,1': [20, 5],
  };
  for (const [key, [x, y]] of Object.entries(expect)) {
    const inst = byKey.get(key)!;
    assert.ok(inst, `Slot ${key} fehlt`);
    const got = pbCopy(sk, inst, pa.id);
    pbNear(got.x, x);
    pbNear(got.y, y);
  }
});

test('Phase 1: Rechteck Richtung per Linie (live-Vektor)', () => {
  const sk = M.emptySketch();
  const la = M.addPt(sk, 0, 0), lb = M.addPt(sk, 0, 20);
  const dirLine = M.addLine(sk, la.id, lb.id);
  const seed = M.addPt(sk, 4, 4);
  const seedEnt = M.addPoint(sk, seed.id);
  const r = PB.buildRectangularPattern(sk, { entities: [seedEnt.id], count: 2, spacing: 15, direction: dirLine.id });
  assert.ok(!('error' in r), `unerwarteter Fehler: ${(r as { error: string }).error}`);
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.equal(pattern.instances.length, 1);
  const got = pbCopy(sk, pattern.instances[0], seed.id);
  pbNear(got.x, 4);
  pbNear(got.y, 19);
  const kind = pattern.kind as P.RectangularPatternKind;
  pbNear(kind.dir.x, 0);
  pbNear(kind.dir.y, 1);
});

test('Phase 1: Spiegeln an Vertikaler (x→−x), Linie gefiltert', () => {
  const sk = M.emptySketch();
  const la = M.addPt(sk, 0, -10), lb = M.addPt(sk, 0, 10);
  const axis = M.addLine(sk, la.id, lb.id);
  const seed = M.addPt(sk, 30, 5);
  const seedEnt = M.addPoint(sk, seed.id);
  const r = PB.mirrorEntities(sk, { entities: [axis.id, seedEnt.id], line: axis.id });
  assert.ok(!('error' in r));
  const out = r as { curves: number[]; points: number[] };
  assert.equal(out.curves.length, 1);
  assert.equal(out.points.length, 1);
  const got = pbPt(sk, out.points[0]);
  pbNear(got.x, -30);
  pbNear(got.y, 5);
  assert.ok(!('patterns' in sk) || sk.patterns === undefined, 'Spiegeln darf kein Muster anlegen');
});

test('Phase 1: Update 4→5 behält überlebende Kurven-ids', () => {
  const { sk, pivot, line } = pbLineSketch();
  const built = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 4 });
  assert.ok(!('error' in built));
  const before = (built as { pattern: P.SketchPattern }).pattern;
  const oldCurves = before.instances.map((i) => i.curves[0]);
  const up = PB.updatePattern(sk, before.id, { type: 'circular', count: 5 });
  assert.ok(!('error' in up));
  const after = (up as { pattern: P.SketchPattern }).pattern;
  assert.equal(after.instances.length, 4);
  assert.deepEqual(after.instances.slice(0, 3).map((i) => i.curves[0]), oldCurves);
  assert.ok(!oldCurves.includes(after.instances[3].curves[0]), 'neuer Slot braucht frische id');
});

test('Phase 1: Update 5→3 retiriert Slots und löscht deren Geometrie', () => {
  const { sk, pivot, line } = pbLineSketch();
  const built = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 5 });
  assert.ok(!('error' in built));
  const before = (built as { pattern: P.SketchPattern }).pattern;
  const retired = before.instances.slice(2).flatMap((i) => [...i.curves, ...i.points.map((p) => p[1])]);
  const up = PB.updatePattern(sk, before.id, { type: 'circular', count: 3 });
  assert.ok(!('error' in up));
  const after = (up as { pattern: P.SketchPattern }).pattern;
  assert.equal(after.instances.length, 2);
  for (const id of retired) {
    assert.equal(M.entOf(sk, id), undefined, `Kurve ${id} muss weg sein`);
    assert.equal(M.ptOf(sk, id), undefined, `Punkt ${id} muss weg sein`);
  }
});

test('Phase 1: Update Seed-Wechsel vergibt frische ids', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const a1 = M.addPt(sk, 10, 0), a2 = M.addPt(sk, 20, 0);
  const lineA = M.addLine(sk, a1.id, a2.id);
  const b1 = M.addPt(sk, 0, 10), b2 = M.addPt(sk, 0, 20);
  const lineB = M.addLine(sk, b1.id, b2.id);
  const built = PB.buildCircularPattern(sk, { entities: [lineA.id], center: pivot.id, count: 3 });
  assert.ok(!('error' in built));
  const before = (built as { pattern: P.SketchPattern }).pattern;
  const oldIds = before.instances.flatMap((i) => [...i.curves, ...i.points.map((p) => p[1])]);
  const up = PB.updatePattern(sk, before.id, { type: 'circular', entities: [lineB.id] });
  assert.ok(!('error' in up));
  const after = (up as { pattern: P.SketchPattern }).pattern;
  assert.deepEqual(after.entities, [lineB.id]);
  for (const id of after.instances.flatMap((i) => [...i.curves, ...i.points.map((p) => p[1])])) {
    assert.ok(!oldIds.includes(id), `id ${id} muss frisch sein`);
  }
});

test('Phase 1: patternOf/patternChildren liefern Kurven und Punkte', () => {
  const { sk, pivot, line } = pbLineSketch();
  const built = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 3 });
  assert.ok(!('error' in built));
  const pattern = (built as { pattern: P.SketchPattern }).pattern;
  assert.equal(PB.patternOf(sk, pattern.id)?.id, pattern.id);
  assert.equal(PB.patternOf(sk, 'gibt-es-nicht'), undefined);
  const kids = PB.patternChildren(pattern);
  assert.equal(kids.curves.length, 2);
  assert.equal(kids.points.length, pattern.instances.reduce((n, i) => n + i.points.length, 0));
  for (const c of kids.curves) assert.ok(M.entOf(sk, c), `Kurve ${c} fehlt`);
  for (const p of kids.points) assert.ok(M.ptOf(sk, p), `Punkt ${p} fehlt`);
});

test('Phase 1: Prune nach Quell-Löschung (Geometrie bleibt)', () => {
  const { sk, pivot, line } = pbLineSketch();
  const built = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 3 });
  assert.ok(!('error' in built));
  const pattern = (built as { pattern: P.SketchPattern }).pattern;
  const copyCurve = pattern.instances[0].curves[0];
  M.deleteIds(sk, [line]);
  assert.equal(PB.prunePatterns(sk), 1);
  assert.equal(sk.patterns, undefined);
  assert.ok(M.entOf(sk, copyCurve), 'Kopie-Geometrie bleibt stehen');
  assert.equal(PB.prunePatterns(sk), 0);
});

test('Phase 1: Fehlerfälle melden deutsch, ohne Mutation', () => {
  const { sk, pivot, line } = pbLineSketch();
  const snap = () => `${sk.next}/${sk.ents.length}/${sk.pts.length}/${sk.cons.length}/${(sk.patterns ?? []).length}`;
  const fails = (r: unknown, head: string): void => {
    assert.ok(r !== null && typeof r === 'object' && 'error' in r, 'Fehler erwartet');
    assert.ok((r as { error: string }).error.startsWith(head), `Fehler muss mit „${head}“ beginnen, war: ${(r as { error: string }).error}`);
  };
  const auxPt = M.addPt(sk, 99, 99);
  const auxLine = M.addLine(sk, auxPt.id, pivot, true);
  const cases: Array<[() => unknown, string]> = [
    [() => PB.buildCircularPattern(sk, { entities: [], center: pivot, count: 4 }), 'Ausgangsform'],
    [() => PB.buildCircularPattern(sk, { entities: [auxLine.id], center: pivot, count: 4 }), 'Ausgangsform'],
    [() => PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 1 }), 'Anzahl'],
    [() => PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 4, angle: 0 }), 'Winkel'],
    [() => PB.buildCircularPattern(sk, { entities: [line], center: 999999, count: 4 }), 'Mittelpunkt'],
    [() => PB.buildRectangularPattern(sk, { entities: [line], count: 3, spacing: 0 }), 'Abstand'],
    [() => PB.buildRectangularPattern(sk, { entities: [line], count: 26, spacing: 5, count2: 20, spacing2: 5 }), 'Anzahlen'],
    [() => PB.buildRectangularPattern(sk, { entities: [line], count: 2, spacing: 5, direction: 999999 }), 'Richtung'],
    [() => PB.mirrorEntities(sk, { entities: [line], line: 999999 }), 'Spiegellinie'],
    [() => PB.updatePattern(sk, 'gibt-es-nicht', { type: 'circular', count: 5 }), 'Muster'],
  ];
  for (const [run, head] of cases) {
    const before = snap();
    fails(run(), head);
    assert.equal(snap(), before, `Fehlerfall „${head}“ darf nichts mutieren`);
  }
  // Selbst-Seed: Kopiekurve als Quelle ist verboten.
  const good = PB.buildCircularPattern(sk, { entities: [line], center: pivot, count: 3 });
  assert.ok(!('error' in good));
  const copyCurve = (good as { pattern: P.SketchPattern }).pattern.instances[0].curves[0];
  const before = snap();
  fails(PB.buildCircularPattern(sk, { entities: [copyCurve], center: pivot, count: 3 }), 'Ausgangsform');
  assert.equal(snap(), before, 'Selbst-Seed darf nichts mutieren');
  // Art-Wechsel ist verboten.
  fails(PB.updatePattern(sk, (good as { pattern: P.SketchPattern }).pattern.id, { type: 'rectangular', count: 2, spacing: 5 }), 'Art');
});

test('Phase 1: Bogen-Kopie rotiert exakt (Radius, a0/a1, Punkte)', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const c = M.addPt(sk, 10, 0), s = M.addPt(sk, 15, 0), e = M.addPt(sk, 10, 5);
  const arc = M.addArc(sk, c.id, s.id, e.id);
  const r = PB.buildCircularPattern(sk, { entities: [arc.id], center: pivot.id, count: 4, angle: 360 });
  assert.ok(!('error' in r), `unerwarteter Fehler: ${(r as { error: string }).error}`);
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  assert.deepEqual(pattern.instances[0].index, [1, 0]);
  const copy = M.entOf(sk, pattern.instances[0].curves[0]);
  assert.equal(copy?.t, 'arc');
  if (copy?.t === 'arc') {
    assert.ok(Math.abs(copy.r - 5) < 1e-9, `r=${copy.r}`);
    assert.ok(Math.abs(copy.a0 - Math.PI / 2) < 1e-9, `a0=${copy.a0}`);
    assert.ok(Math.abs(copy.a1 - Math.PI) < 1e-9, `a1=${copy.a1}`);
    const cc = M.ptOf(sk, copy.c)!, sc = M.ptOf(sk, copy.s)!, ec = M.ptOf(sk, copy.e)!;
    for (const [p, x, y] of [[cc, 0, 10], [sc, 0, 15], [ec, -5, 10]] as const) {
      assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, `Punkt (${p.x},${p.y}), erwartet (${x},${y})`);
    }
  }
});

test('Phase 1: Ellipsen-Kopie rotiert Achsen exakt', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const c = M.addPt(sk, 10, 0), m = M.addPt(sk, 14, 0);
  const el = M.addEllipse(sk, c.id, m.id, 2);
  const r = PB.buildCircularPattern(sk, { entities: [el.id], center: pivot.id, count: 4, angle: 360 });
  assert.ok(!('error' in r), `unerwarteter Fehler: ${(r as { error: string }).error}`);
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  const copy = M.entOf(sk, pattern.instances[0].curves[0]);
  assert.equal(copy?.t, 'ellipse');
  if (copy?.t === 'ellipse') {
    const cc = M.ptOf(sk, copy.c)!, mc = M.ptOf(sk, copy.m)!;
    assert.ok(Math.abs(cc.x) < 1e-9 && Math.abs(cc.y - 10) < 1e-9, `Mitte (${cc.x},${cc.y})`);
    assert.ok(Math.abs(mc.x) < 1e-9 && Math.abs(mc.y - 14) < 1e-9, `Achse (${mc.x},${mc.y})`);
    assert.equal(copy.r, 2);
  }
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log(`\nAlle Muster-Tests bestanden (${pending.length} Tests)`);

// Phase 2: Fenster-Framework (echte Editor-Pipeline, keine Mocks).
const E2 = await import('../src/editor');
const H2 = await import('../src/history');
const D2 = await import('../src/model');
const SOL2 = await import('../src/sketch/solver');
const { resolve: resolvePhase2 } = await import('node:path');
const { readFileSync: readPhase2 } = await import('node:fs');
SOL2.setSolverWasm(resolvePhase2('node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'));
await SOL2.loadSolver();

/** Echte Editor-Pipeline: doc-Objekt, Sitzung, Verlauf; nur emit/redraw/DOM-Ablagen sind Stubs. */
function phase2Harness(secondAux = false) {
  const ed = Object.create(E2.Editor.prototype);
  const doc = D2.newDoc();
  doc.layers[0] = D2.defaultLayer(0);
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const pa = M.addPt(sk, 10, 0), pb = M.addPt(sk, 110, 0);
  const line = M.addLine(sk, pa.id, pb.id);
  const la = M.addPt(sk, -50, -50), lb = M.addPt(sk, -50, 50);
  const aux = M.addLine(sk, la.id, lb.id, true);
  let aux2 = -1;
  if (secondAux) {
    const q1 = M.addPt(sk, -60, -60), q2 = M.addPt(sk, -60, 60);
    aux2 = M.addLine(sk, q1.id, q2.id, true).id;
  }
  const json = M.sketchJson(sk);
  const obj = {
    id: D2.newId(), m: D2.IDENT, layer: 0,
    shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: M.sketchSubs(sk) },
  };
  doc.objs = [obj];
  Object.assign(ed, {
    doc, history: new H2.History(), currentLayer: 0, sel: [], tool: 'sketch',
    view: { zoom: 1, ox: 0, oy: 0 }, dpr: 1,
    cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    sketchEdit: {
      obj, m: D2.IDENT, sk, json, orig: json, tool: 'select', sel: new Set(),
      hover: null, labels: [], draft: [], draftIds: [], dimPick: [], status: null, drag: null,
      drawAux: false, drawLine: 'normal', showRelations: true, showDims: true,
      showPoints: true, showConstruction: true, sketchSnap: true, startDof: null,
    },
  });
  ed.emit = () => {};
  ed.redraw = () => {};
  ed.clearSnap = () => {};
  ed.clearTrack = () => {};
  ed.scheduleSave = () => {};
  ed.touch = () => {};
  return { ed, sk, line: line.id, aux: aux.id, aux2, pivot: pivot.id };
}

test('Phase 2: Fenster öffnet mit vorselektierten Elementen, doc + history unberührt', () => {
  const { ed, sk, line } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const json = M.sketchJson(sk), pos = ed.history.position;
  const d = ed.startPatternDraft('circular');
  assert.ok(d, 'Entwurf öffnet');
  assert.deepEqual(d.entities, [line]);
  assert.equal(M.sketchJson(sk), json, 'Öffnen mutiert die Skizze nicht');
  assert.equal(ed.history.position, pos, 'Öffnen committet nichts');
});

test('Phase 2: Spiegel-Auto-Linie aus genau einer Hilfslinie vorbelegt', () => {
  const a = phase2Harness();
  a.ed.sketchEdit.sel = new Set([a.line, a.aux]);
  const d = a.ed.startPatternDraft('mirror');
  assert.ok(d);
  assert.equal(d.line, a.aux, 'genau eine gerade Hilfslinie → Spiegellinie');
  assert.deepEqual(d.entities, [a.line]);
  const b = phase2Harness(true);
  b.ed.sketchEdit.sel = new Set([b.line, b.aux, b.aux2]);
  const d2 = b.ed.startPatternDraft('mirror');
  assert.ok(d2);
  assert.equal(d2.line, undefined, 'zwei Hilfslinien → keine Vorbelegung');
});

test('Phase 2: falscher Pick fällt auf Elemente zurück, Linie bei Richtung dorthin', () => {
  const { ed, line } = phase2Harness();
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  d.active = 'center';
  const mid = ed.skToScreen({ x: 60, y: 0 });
  ed.sketchPatternClick(mid.x, mid.y);
  assert.deepEqual(d.entities, [line], 'Kurven-Klick landet trotz aktiver Mitte in Elemente');
  assert.equal(d.center, undefined, 'Mitte bleibt leer');
  assert.equal(d.active, 'center', 'aktive Eingabe bleibt');
  const r = ed.startPatternDraft('rectangular');
  assert.ok(r);
  r.active = 'direction';
  ed.sketchPatternClick(mid.x, mid.y);
  assert.equal(r.direction, line, 'Linien-Klick bei aktiver Richtung → dorthin');
  assert.deepEqual(r.entities, [], 'Elemente bleiben leer');
});

test('Phase 2: Enter wendet an (Muster da, Fenster zu, genau ein Undo)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  ed.startPatternDraft('circular');
  ed.sketchEdit.patternDraft.center = pivot;
  const pos = ed.history.position;
  assert.equal(ed.sketchKey({ key: 'Enter', target: {} }), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns?.length, 1, 'Kreismuster da');
});

test('Phase 2: Escape verwirft exakt (doc + history byte-identisch)', () => {
  const { ed, sk, line, pivot } = phase2Harness();
  ed.startPatternDraft('circular');
  const d = ed.sketchEdit.patternDraft;
  d.entities = [line];
  d.center = pivot;
  d.countText = '6';
  const json = M.sketchJson(sk), pos = ed.history.position;
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} }), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Entwurf weg');
  assert.equal(M.sketchJson(sk), json, 'doc-JSON identisch');
  assert.equal(ed.history.position, pos, 'history.position identisch');
});

test('Phase 2: halb gefüllt → deutscher Fehler, kein Commit', () => {
  const { ed, sk, line } = phase2Harness();
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  d.entities = [line];
  const pos = ed.history.position;
  assert.equal(ed.confirmPatternDraft(), false);
  assert.ok(d.error.startsWith('Zuerst'), `Fehler im Stil „Zuerst …“, war: ${d.error}`);
  assert.equal(ed.history.position, pos, 'kein Undo-Schritt');
  assert.equal(sk.patterns, undefined, 'kein Muster');
});

test('Phase 2: Übernehmen committet, leert Picks, behält Werte', () => {
  const { ed, line } = phase2Harness();
  const d = ed.startPatternDraft('rectangular');
  assert.ok(d);
  d.entities = [line];
  d.countText = '3';
  d.spacingText = '20';
  d.count2Text = '2';
  d.spacing2Text = '5';
  const pos = ed.history.position;
  assert.equal(ed.applyPatternDraft(), true);
  assert.equal(ed.history.position, pos + 1, 'ein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns?.length, 1, 'Rechteckmuster da');
  const kept = ed.sketchEdit.patternDraft;
  assert.ok(kept, 'Fenster bleibt offen');
  assert.deepEqual(kept.entities, [], 'Picks gelöscht');
  assert.equal(kept.countText, '3', 'Werte behalten');
  assert.equal(kept.spacing2Text, '5', 'Werte behalten');
});

test('Phase 2: Freiraum-Punkt erst bei OK materialisiert', () => {
  const { ed, sk, line } = phase2Harness();
  const ptsBefore = sk.pts.length;
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  const mid = ed.skToScreen({ x: 60, y: 0 });
  ed.sketchPatternClick(mid.x, mid.y);
  assert.deepEqual(d.entities, [line]);
  d.active = 'center';
  ed.sketchPatternClick(500, 500);
  assert.ok(d.freeCenter, 'Freiraum-Punkt vorgemerkt');
  assert.equal(sk.pts.length, ptsBefore, 'Vormerken legt keinen Punkt an');
  assert.equal(ed.confirmPatternDraft(), true);
  const p = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(p && p.kind.type === 'circular', 'Muster da');
  assert.ok(M.ptOf(ed.sketchEdit.sk, p.kind.center), 'Freiraum-Punkt bei OK materialisiert');
});

test('Phase 2: Spiegeln committet Kopie ohne Muster-Objekt', () => {
  const { ed, sk, line, aux } = phase2Harness();
  const entsBefore = sk.ents.length;
  const d = ed.startPatternDraft('mirror');
  assert.ok(d);
  d.entities = [line];
  d.line = aux;
  const pos = ed.history.position;
  assert.equal(ed.confirmPatternDraft(), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns, undefined, 'kein Muster-Objekt');
  assert.ok(ed.sketchEdit.sk.ents.length > entsBefore, 'Kopie da');
});

test('Phase 2: Rechtsklick bestätigt und wendet bei vollem Entwurf an', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.startPatternDraft('circular');
  const d = ed.sketchEdit.patternDraft;
  d.entities = [line];
  d.center = pivot;
  const pos = ed.history.position;
  assert.equal(ed.sketchPatternRight(), true, 'nichts leer → OK');
  assert.equal(ed.sketchEdit.patternDraft, null);
  assert.equal(ed.history.position, pos + 1);
  const m = phase2Harness();
  const dm = m.ed.startPatternDraft('mirror');
  assert.ok(dm);
  dm.entities = [m.line];
  dm.active = 'entities';
  assert.equal(m.ed.sketchPatternRight(), true, 'nächste leere Eingabe');
  assert.equal(dm.active, 'line', 'aktive Eingabe bestätigt → nächste leere');
  assert.equal(m.ed.history.position, 0, 'kein Commit');
});

test('Phase 2: Verdrahtung (statisch): Gruppe, Fenster-Texte, Overlay, Klick-Routing', () => {
  const root = new URL('../src/', import.meta.url);
  const panel = readPhase2(new URL('sketchPanel.ts', root), 'utf8');
  const sketch = readPhase2(new URL('editor/sketch.ts', root), 'utf8');
  const render = readPhase2(new URL('editor/render.ts', root), 'utf8');
  assert.ok(panel.includes("group('pattern', t('Muster')"), 'PATTERN-Gruppe');
  for (const icon of ['sketchCircularPattern', 'sketchRectangularPattern', 'mirrorh']) {
    assert.ok(panel.includes(`'${icon}'`), `Gruppe nutzt Icon ${icon}`);
  }
  for (const key of ['Spiegeln', 'Kreismuster', 'Rechteckmuster']) {
    assert.ok(panel.includes(`t('${key}')`), `Fenster-Titel fehlt: ${key}`);
    assert.ok(sketch.includes(key) || key === 'Spiegeln', `Dispatch kennt ${key}`);
  }
  for (const key of ['Übernehmen', 'Richtung umkehren', 'Zentrieren', 'Anzahlen schließen das Original ein']) {
    assert.ok(panel.includes(key), `Fenster-Text fehlt: ${key}`);
  }
  assert.ok(panel.includes('openPatternDialog') && panel.includes('setPatternDialogRefresh'), 'Fenster-Gerüst mit Live-Auffrischung');
  assert.ok(panel.includes('prevContext') && panel.includes('sketchPatternRight'), 'Rechtsklick ohne Kontextmenü-Pfad');
  for (const fn of ['startPatternDraft', 'sketchPatternClick', 'sketchPatternRight', 'confirmPatternDraft', 'applyPatternDraft', 'cancelPatternDraft', 'patternPreviewGeom', 'validatePatternDraft']) {
    assert.ok(sketch.includes(fn), `Editor-Pfad fehlt: ${fn}`);
  }
  assert.ok(sketch.includes('patternDraft') && sketch.includes('sketchPatternClick(sx, sy)'), 'Klick-Routing bei offenem Fenster');
  assert.ok(render.includes('cachedPatternPreviewGeom') && render.includes('#1f9d55'), 'grüne Live-Vorschau auf Klon (mit Budget-Guard)');
  assert.ok(panel.includes('openCadWindow') && panel.includes('cad-window'), 'Fenster-Framework im Seitenkarten-Stil');
  assert.ok(panel.includes('Einklappen') && panel.includes('Schließen'), 'Fenster: Einklappen + Schließen wie Seitenkarte');
  assert.ok(!panel.includes('background:#fff'), 'kein hartes Weiß mehr (Theme-Variablen)');
  assert.ok(panel.includes('patternClose = win.close') || panel.includes('patternClose=win.close') || panel.includes('patternClose = win.close;'), 'Entwurf-Schließen hängt am Fenster');
});

test('CAD-Fenster: Zieh-Math klemmt im Viewport', async () => {
  const { cadWindowMove } = await import('../src/dom');
  assert.deepEqual(cadWindowMove({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 30, y: 20 }, { w: 1500, h: 1000 }), { x: 130, y: 120 });
  assert.deepEqual(cadWindowMove({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: -500, y: -500 }, { w: 1500, h: 1000 }), { x: 0, y: 0 }, 'links/oben geklemmt');
  assert.deepEqual(cadWindowMove({ x: 1400, y: 900 }, { x: 0, y: 0 }, { x: 500, y: 500 }, { w: 1500, h: 1000 }), { x: 1420, y: 960 }, 'rechts/unten geklemmt');
});

test('Icons: Muster-Symbole zeigen Drehung/Raster (eigene Zeichnung, kein Fremd-Asset)', async () => {
  const { ICONS } = await import('../src/icons');
  for (const key of ['sketchCircularPattern', 'sketchRectangularPattern']) {
    const svg = ICONS[key];
    assert.ok(svg.includes('<svg') && svg.includes('viewBox="0 0 24 24"'), `${key} ist ein 24er-Icon`);
  }
  const circ = ICONS.sketchCircularPattern;
  assert.ok(circ.includes('M19 13a7 7'), 'Kreis: Rotationspfeil um die Mitte');
  assert.ok(circ.includes('fill="currentColor"'), 'Kreis: Mittelpunkt/Quelle markiert');
  const rect = ICONS.sketchRectangularPattern;
  assert.ok(rect.includes('M4.5 5h15') && rect.includes('M3 8.5v9'), 'Rechteck: je ein Pfeil pro Richtung');
  assert.ok(rect.includes('stroke-dasharray'), 'Rechteck: Kopien gestrichelt wie bei circArray/gridArray');
});

test('Phase 2: Ausdruck wird verlinkt gespeichert (count „n“)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.doc.params = [{ name: 'n', type: 'number', value: 4 }];
  ed.sketchEdit.sel = new Set([line]);
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  d.center = pivot;
  d.countText = 'n';
  const pos = ed.history.position;
  assert.equal(ed.confirmPatternDraft(), true);
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern, 'Muster da');
  assert.equal(pattern.instances.length, 3, 'n=4 → 3 Kopien');
  assert.deepEqual(pattern.expressions, { count: 'n' }, 'Ausdruckstext bleibt verlinkt');
  const back = M.parseSketch(M.sketchJson(ed.sketchEdit.sk));
  assert.deepEqual(back.patterns?.[0].expressions, { count: 'n' }, 'Ausdruck überlebt Roundtrip');
});

test('Phase 2: unbekannter Ausdruck → Fehler, kein Commit', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  d.center = pivot;
  d.countText = 'gibtsnicht';
  const pos = ed.history.position;
  assert.equal(ed.confirmPatternDraft(), false);
  assert.ok(d.error.includes('Parameter'), `Fehler nennt Parameter, war: ${d.error}`);
  assert.equal(ed.history.position, pos, 'kein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns, undefined, 'kein Muster');
});

test('Phase 1: build speichert Ausdrücke, Update übernimmt sie, Ungültiges ohne Mutation', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0), a = M.addPt(sk, 30, 0), b = M.addPt(sk, 30, 10);
  const line = M.addLine(sk, a.id, b.id);
  const snap = () => `${sk.next}/${sk.ents.length}/${sk.pts.length}/${(sk.patterns ?? []).length}`;
  const good = PB.buildCircularPattern(sk, { entities: [line.id], center: pivot.id, count: 3, expressions: { count: 'n' } });
  assert.ok(!('error' in good));
  const pid = (good as { pattern: P.SketchPattern }).pattern.id;
  assert.deepEqual((good as { pattern: P.SketchPattern }).pattern.expressions, { count: 'n' });
  const upd = PB.updatePattern(sk, pid, { type: 'circular', expressions: { count: 'm' } });
  assert.ok(!('error' in upd));
  assert.deepEqual((upd as { pattern: P.SketchPattern }).pattern.expressions, { count: 'm' });
  const before = snap();
  const bad = PB.buildCircularPattern(sk, { entities: [line.id], center: pivot.id, count: 3, expressions: { bogus: 'n' } });
  assert.ok('error' in bad, 'falscher Schlüssel abgewiesen');
  assert.equal(snap(), before, 'keine Mutation');
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen (inkl. Phase 2)`);
  process.exit(1);
}
console.log(`\nAlle Muster-Tests bestanden (inkl. Phase 2, ${pending.length} Tests)`);

// Phase 3: Abstands-Pfeile, Zieh-Mapping, Budget-Guard (echte Editor-Pipeline wo möglich, sonst reine Helfer).
const SK = await import('../src/editor/sketch');

function phase3Draft(over: Partial<SK.PatternDraft> = {}): SK.PatternDraft {
  return {
    kind: 'rectangular', entities: [], active: 'entities',
    countText: '3', count2Text: '2', spacingText: '20', spacing2Text: '5', angleText: '360',
    reversed: false, reversed2: false, centered: false, centered2: false, error: '',
    ...over,
  };
}

function phase3LineSketch(): { sk: M.Sketch; line: number } {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, a.id, b.id);
  return { sk, line: line.id };
}

test('Phase 3: Pfeil-Geometrie exakt (Default, Schwerpunkt, Länge)', () => {
  const { sk, line } = phase3LineSketch();
  const arrows = SK.patternSpacingArrows(sk, phase3Draft({ entities: [line] }));
  assert.ok(arrows && arrows.length === 2, 'je Richtung ein Pfeil');
  const [a0, a1] = arrows;
  assert.equal(a0.dir, 0);
  assert.deepEqual(a0.origin, { x: 5, y: 0 });
  assert.deepEqual(a0.vec, { x: 1, y: 0 });
  assert.equal(a0.spacing, 20);
  assert.equal(a0.count, 3);
  assert.equal(a1.dir, 1);
  assert.deepEqual(a1.origin, { x: 5, y: 0 });
  pbNear(a1.vec.x, 0); pbNear(a1.vec.y, 1);
  assert.equal(a1.spacing, 5);
  assert.equal(a1.count, 2);
});

test('Phase 3: Pfeil folgt gepickter Linie, Flip invertiert', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 0, 20);
  const vline = M.addLine(sk, a.id, b.id);
  const c = M.addPt(sk, 4, 4), dpt = M.addPt(sk, 9, 4);
  const seed = M.addLine(sk, c.id, dpt.id);
  const arrows = SK.patternSpacingArrows(sk, phase3Draft({ entities: [seed.id], direction: vline.id }));
  assert.ok(arrows && arrows.length === 2);
  pbNear(arrows[0].vec.x, 0); pbNear(arrows[0].vec.y, 1);
  pbNear(arrows[1].vec.x, -1); pbNear(arrows[1].vec.y, 0);
  const flip = SK.patternSpacingArrows(sk, phase3Draft({ entities: [seed.id], direction: vline.id, reversed: true }));
  assert.ok(flip && flip.length === 2);
  pbNear(flip[0].vec.x, 0); pbNear(flip[0].vec.y, -1);
});

test('Phase 3: Kreis/Spiegel/leer/Nullabstand → kein Pfeil', () => {
  const { sk, line } = phase3LineSketch();
  assert.equal(SK.patternSpacingArrows(sk, phase3Draft({ kind: 'circular', entities: [line] })), null);
  assert.equal(SK.patternSpacingArrows(sk, phase3Draft({ kind: 'mirror', entities: [line] })), null);
  assert.equal(SK.patternSpacingArrows(sk, phase3Draft({ entities: [] })), null);
  assert.equal(SK.patternSpacingArrows(sk, phase3Draft({ entities: [line], countText: '1', spacingText: '0', count2Text: '1', spacing2Text: '0' }))?.length, 0);
});

test('Phase 3: Zieh-Mapping (Projektion, Vorzeichen-Flip, Format)', () => {
  assert.equal(SK.projectPatternSpacing({ x: 5, y: 0 }, { x: 1, y: 0 }, { x: 17.5, y: 3 }), 12.5);
  assert.equal(SK.projectPatternSpacing({ x: 5, y: 0 }, { x: 1, y: 0 }, { x: -5, y: 0 }), -10);
  assert.equal(SK.projectPatternSpacing({ x: 5, y: 0 }, { x: 0, y: -1 }, { x: 9, y: -7 }), 7);
  assert.equal(SK.formatPatternSpacing(20), '20');
  assert.equal(SK.formatPatternSpacing(-20), '-20');
  assert.equal(SK.formatPatternSpacing(10 / 3), '3.33');
});

test('Phase 3: Guard — gleiche Signatur kein Neubau, Änderung baut neu, Cap dokumentiert', () => {
  const { sk, line } = phase3LineSketch();
  const d = phase3Draft({ entities: [line] });
  assert.equal(SK.PATTERN_PREVIEW_SUB_CAP, 200);
  const g1 = SK.cachedPatternPreviewGeom(sk, d);
  assert.ok(g1, 'gültige Belegung → Geometrie');
  assert.strictEqual(SK.cachedPatternPreviewGeom(sk, d), g1, 'gleiche Signatur → dieselbe Referenz');
  assert.equal(SK.patternDraftSignature(d), SK.patternDraftSignature(phase3Draft({ entities: [line] })), 'Signatur stabil');
  d.spacingText = '21';
  const g3 = SK.cachedPatternPreviewGeom(sk, d);
  assert.ok(g3 && g3 !== g1, 'geänderte Belegung → Neubau');
});

test('Phase 3: Ziehen simuliert (Press→Ziehen→Loslassen, nur Entwurf, Flip, Escape)', () => {
  const { ed, line } = phase2Harness();
  const d = ed.startPatternDraft('rectangular');
  assert.ok(d);
  d.entities = [line];
  d.countText = '3';
  d.spacingText = '20';
  d.count2Text = '2';
  d.spacing2Text = '5';
  // Schwerpunkt der Quelle (10,0)-(110,0) = (60,0); Pfeil 1: (60,0)→(80,0).
  assert.equal(ed.sketchPatternArrowAt(75, 0), 0);
  assert.equal(ed.sketchPatternArrowAt(60, 10), 1);
  assert.equal(ed.sketchPatternArrowAt(300, 300), null);
  const pos = ed.history.position;
  ed.sketchDown(75, 0, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 7 });
  assert.equal(ed.sketchEdit.patternDrag?.dir, 0);
  assert.deepEqual(d.entities, [line], 'Press auf Pfeil pickt nichts');
  ed.sketchMove(90, 0, { pointerId: 7 } as unknown as PointerEvent);
  assert.equal(d.spacingText, '30', 'Projektion (90−60) = 30');
  ed.sketchMove(40, 0, { pointerId: 7 } as unknown as PointerEvent);
  assert.equal(d.spacingText, '-20', 'über den Start → Vorzeichen kippt');
  assert.equal(ed.history.position, pos, 'Ziehen committet nichts');
  assert.equal(ed.sketchEdit.sk.patterns, undefined, 'kein Muster gebaut');
  ed.sketchUp({ pointerId: 7 } as unknown as PointerEvent);
  assert.equal(ed.sketchEdit.patternDrag, null, 'Loslassen beendet das Ziehen');
  assert.equal(ed.history.position, pos, 'Loslassen committet nichts');
  assert.ok(ed.sketchEdit.patternDraft, 'Fenster bleibt offen');
  // Escape während Ziehen stellt alten Text wieder her.
  ed.sketchDown(50, 0, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 9 });
  assert.equal(ed.sketchEdit.patternDrag?.dir, 0);
  ed.sketchMove(90, 0, { pointerId: 9 } as unknown as PointerEvent);
  assert.equal(d.spacingText, '30');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as unknown as KeyboardEvent), true);
  assert.equal(d.spacingText, '-20', 'Escape stellt alten Text wieder her');
  assert.equal(ed.sketchEdit.patternDrag, null);
  assert.ok(ed.sketchEdit.patternDraft, 'Fenster bleibt offen');
  assert.equal(ed.history.position, pos, 'Escape committet nichts');
});

test('Phase 3: Kreis-Fenster und geschlossenes Fenster → kein Pfeil-Hit, Picks wie bisher', () => {
  const { ed, line } = phase2Harness();
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  assert.equal(ed.sketchPatternArrowAt(60, 0), null, 'Kreisfenster: kein Pfeil');
  ed.sketchDown(60, 0, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 3 });
  assert.ok(ed.sketchEdit.patternDrag == null, 'kein Ziehen ohne Pfeil');
  assert.deepEqual(d.entities, [line], 'Kurven-Klick landet weiter in Elemente');
  ed.cancelPatternDraft();
  assert.equal(ed.sketchPatternArrowAt(60, 0), null, 'ohne Fenster: kein Hit');
});

test('Phase 3: Verdrahtung (statisch): Cache, Pfeile, Ziehen, Cap, Dialog-Refresh', () => {
  const root = new URL('../src/', import.meta.url);
  const sketch = readPhase2(new URL('editor/sketch.ts', root), 'utf8');
  const render = readPhase2(new URL('editor/render.ts', root), 'utf8');
  const panel = readPhase2(new URL('sketchPanel.ts', root), 'utf8');
  for (const fn of ['patternSpacingArrows', 'projectPatternSpacing', 'formatPatternSpacing', 'cachedPatternPreviewGeom', 'patternDraftSignature', 'sketchPatternArrowAt', 'sketchPatternDragTo']) {
    assert.ok(sketch.includes(fn), `Helfer fehlt: ${fn}`);
  }
  assert.ok(sketch.includes('patternDrag'), 'Zieh-Zustand in der Sitzung');
  assert.ok(sketch.includes('PATTERN_PREVIEW_SUB_CAP'), 'harte Zeichen-Cap');
  assert.ok(render.includes('cachedPatternPreviewGeom') && render.includes('PATTERN_PREVIEW_SUB_CAP'), 'Overlay mit Guard + Cap');
  assert.ok(render.includes('#ff6020') && render.includes('#1f6fe0'), 'eigene Pfeilfarben je Richtung');
  assert.ok(panel.includes('synced'), 'Dialog schreibt Ziehen in die Zahlfelder zurück');
});

test('Phase 3: Ziehen unter Zoom/Offset/dpr (nicht-identische View)', () => {
  const { ed, line } = phase2Harness();
  ed.view = { zoom: 2.5, ox: 30, oy: -20 };
  ed.dpr = 2;
  const d = ed.startPatternDraft('rectangular');
  assert.ok(d);
  d.entities = [line];
  d.countText = '3';
  d.spacingText = '20';
  d.count2Text = '1';
  const toScr = (x: number, y: number) => ed.skToScreen({ x, y });
  // Pfeil 1 in Welt (60,0)→(80,0); Treffer über transformierte Screen-Koordinaten.
  const hit = toScr(75, 0);
  assert.equal(ed.sketchPatternArrowAt(hit.x, hit.y), 0, 'Pfeil-Hit unter Zoom/Offset/dpr');
  const pos = ed.history.position;
  ed.sketchDown(hit.x, hit.y, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 11 });
  assert.equal(ed.sketchEdit.patternDrag?.dir, 0);
  const at90 = toScr(90, 0);
  ed.sketchMove(at90.x, at90.y, { pointerId: 11 } as unknown as PointerEvent);
  assert.equal(d.spacingText, '30', 'Projektion (90−60) = 30 trotz Transform');
  const at40 = toScr(40, 0);
  ed.sketchMove(at40.x, at40.y, { pointerId: 11 } as unknown as PointerEvent);
  assert.equal(d.spacingText, '-20', 'Flip trotz Transform');
  assert.equal(ed.history.position, pos, 'kein Commit');
  ed.sketchUp({ pointerId: 11 } as unknown as PointerEvent);
  assert.equal(ed.sketchEdit.patternDrag, null);
  assert.ok(ed.sketchEdit.patternDraft, 'Fenster bleibt offen');
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen (inkl. Phase 3)`);
  process.exit(1);
}
console.log(`\nAlle Muster-Tests bestanden (inkl. Phase 3, ${pending.length} Tests)`);

// Phase 4: Editieren (Badge/Kopie-Doppelklick, Kontextmenü), Auflösen/Entfernen, Param-Nachführung.
const CTX4 = await import('../src/sketchContext');

test('Phase 4: Edit via Badge-Doppelklick (4→5, Überlebende behalten ids, Fenster zu, ein Undo)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern, 'Muster da');
  const oldCurves = pattern.instances.map((i) => i.curves[0]);
  const anchor = SK.patternBadgeAnchor(ed.sketchEdit.sk, pattern);
  assert.ok(anchor, 'Badge-Anker vorhanden (Quellenschwerpunkt)');
  const scr = ed.skToScreen(anchor);
  const pos = ed.history.position;
  // Kein Edit-Öffner registriert → Fallback öffnet den reinen Entwurf (Fenster-Seite hängt den Dialog ein).
  ed.sketchDouble(scr.x, scr.y);
  const d = ed.sketchEdit.patternDraft;
  assert.ok(d && d.editPatternId === pattern.id, 'Edit-Entwurf mit Muster-ID offen');
  d.countText = '5';
  assert.equal(ed.confirmPatternEdit(), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  const after = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(after);
  assert.equal(after.instances.length, 4, '4→5');
  assert.deepEqual(after.instances.slice(0, 3).map((i) => i.curves[0]), oldCurves, 'Überlebende behalten ids');
});

test('Phase 4: Edit via Kopie-Doppelklick und via Kontextmenü-Eintrag', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern);
  // Kopie-Geometrie: Doppelklick auf die erste Kopiekurve öffnet denselben Edit-Einstieg.
  const copyEnt = M.entOf(ed.sketchEdit.sk, pattern.instances[0].curves[0]);
  assert.ok(copyEnt && copyEnt.t === 'line');
  const a = M.ptOf(ed.sketchEdit.sk, copyEnt.a)!, b = M.ptOf(ed.sketchEdit.sk, copyEnt.b)!;
  const mid = ed.skToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  ed.sketchDouble(mid.x, mid.y);
  assert.equal(ed.sketchEdit.patternDraft?.editPatternId, pattern.id, 'Kopie-Doppelklick → Edit-Entwurf');
  ed.cancelPatternDraft();
  // Kontextmenü: genau ein Muster (Kopie) → enabled; Klick öffnet denselben Einstieg.
  ed.sketchEdit.sel = new Set([pattern.instances[1].curves[0]]);
  const groups = CTX4.sketchContextGroups(ed);
  const entry = groups.flat().find((x) => x.id === 'sketch-pattern-edit');
  assert.ok(entry, 'Eintrag „Skizzenmuster bearbeiten“ vorhanden');
  assert.equal(entry.enabled, true, 'enabled bei genau einem Muster (Kopie)');
  let opened: string | null = null;
  SK.setPatternEditOpener(ed, (id) => {
    opened = id;
    ed.startPatternEditDraft(id);
  });
  (entry.run as () => void)();
  assert.equal(opened, pattern.id, 'Menü öffnet Edit für die Muster-ID');
  assert.equal(ed.sketchEdit.patternDraft?.editPatternId, pattern.id);
  SK.setPatternEditOpener(ed, null);
  ed.cancelPatternDraft();
  // Quelle desselben Musters → enabled; leere/fremde Auswahl → disabled.
  ed.sketchEdit.sel = new Set([line]);
  assert.equal(CTX4.sketchContextGroups(ed).flat().find((x) => x.id === 'sketch-pattern-edit')?.enabled, true, 'Quelle → enabled');
  ed.sketchEdit.sel = new Set([line, 999999]);
  assert.equal(CTX4.sketchContextGroups(ed).flat().find((x) => x.id === 'sketch-pattern-edit')?.enabled, false, 'fremde id → disabled');
  ed.sketchEdit.sel = new Set();
  assert.equal(CTX4.sketchContextGroups(ed).flat().find((x) => x.id === 'sketch-pattern-edit')?.enabled, false, 'leer → disabled');
});

test('Phase 4: Ausdruck bleibt als Text im Edit-Fenster und überlebt OK', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.doc.params = [{ name: 'n', type: 'number', value: 4 }];
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  d0.countText = 'n';
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern);
  assert.deepEqual(pattern.expressions, { count: 'n' });
  const d = ed.startPatternEditDraft(pattern.id);
  assert.ok(d);
  assert.equal(d.countText, 'n', 'Ausdruck als Text vorbelegt (nicht aufgelöst)');
  assert.equal(d.angleText, '360', 'Zahl als Text vorbelegt');
  const pos = ed.history.position;
  assert.equal(ed.confirmPatternEdit(), true);
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  const after = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(after);
  assert.equal(after.instances.length, 3, 'n=4 → 3 Kopien');
  assert.deepEqual(after.expressions, { count: 'n' }, 'Ausdruck überlebt OK');
});

test('Phase 4: Auflösen (Geometrie bleibt, Eintrag weg, ein Undo)', () => {
  const { ed, sk, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern);
  const copyCurve = pattern.instances[0].curves[0];
  assert.ok(M.entOf(ed.sketchEdit.sk, copyCurve), 'Kopie da');
  const d = ed.startPatternEditDraft(pattern.id);
  assert.ok(d);
  const pos = ed.history.position;
  assert.equal(ed.dissolvePatternDraft(), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns, undefined, 'Eintrag weg');
  assert.ok(M.entOf(ed.sketchEdit.sk, copyCurve), 'Kopie-Geometrie bleibt stehen');
  assert.ok(M.entOf(ed.sketchEdit.sk, line), 'Quelle bleibt stehen');
  assert.equal(M.sketchJson(sk), M.sketchJson(ed.sketchEdit.sk), 'Harness-Skizze unverändert referenziert');
});

test('Phase 4: Entfernen (Kopien weg, Quellen da, ein Undo)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern);
  const kids = PB.patternChildren(pattern);
  assert.ok(kids.curves.length > 0 && kids.points.length > 0, 'Kopien vorhanden');
  const d = ed.startPatternEditDraft(pattern.id);
  assert.ok(d);
  const pos = ed.history.position;
  assert.equal(ed.removePatternDraftCopies(), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns, undefined, 'Eintrag weg');
  for (const c of kids.curves) assert.equal(M.entOf(ed.sketchEdit.sk, c), undefined, `Kopie ${c} weg`);
  for (const p of kids.points) assert.equal(M.ptOf(ed.sketchEdit.sk, p), undefined, `Kopiepunkt ${p} weg`);
  assert.ok(M.entOf(ed.sketchEdit.sk, line), 'Quelle bleibt stehen');
});

test('Phase 4: Spiegel-Vorbelegung per Klick abwählbar (kein Preference-Schalter)', () => {
  const { ed, line, aux } = phase2Harness();
  ed.sketchEdit.sel = new Set([line, aux]);
  const d = ed.startPatternDraft('mirror');
  assert.ok(d);
  assert.equal(d.line, aux, 'genau eine Hilfslinie → vorbelegt');
  d.active = 'line';
  const e = M.entOf(ed.sketchEdit.sk, aux);
  assert.ok(e && e.t === 'line');
  const a = M.ptOf(ed.sketchEdit.sk, e.a)!, b = M.ptOf(ed.sketchEdit.sk, e.b)!;
  const mid = ed.skToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  ed.sketchPatternClick(mid.x, mid.y);
  assert.equal(d.line, undefined, 'erneuter Klick löst die Spiegellinie');
  assert.deepEqual(d.entities, [line], 'Elemente unberührt');
});

test('Phase 4: Param-Änderung führt verlinktes Muster nach (ein Undo)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.doc.params = [{ name: 'n', type: 'number', value: 4 }];
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  d0.countText = 'n';
  assert.equal(ed.confirmPatternDraft(), true);
  assert.equal(ed.sketchEdit.sk.patterns?.[0].instances.length, 3, 'n=4 → 3 Kopien');
  const pos = ed.history.position;
  ed.doc.params = [{ name: 'n', type: 'number', value: 5 }];
  const problems = ed.applyParams();
  assert.equal(problems.length, 0, `keine Probleme, war: ${JSON.stringify(problems)}`);
  const after = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(after);
  assert.equal(after.instances.length, 4, 'n=5 → 4 Kopien');
  assert.deepEqual(after.expressions, { count: 'n' }, 'Verlinkung bleibt');
  assert.equal(ed.history.position, pos + 1, 'Erfolg = ein Undo-Schritt für alle');
  // Rechteck-Abstand folgt ebenfalls (verlinkter spacing-Ausdruck).
  const { ed: ed2, line: line2 } = phase2Harness();
  ed2.doc.params = [{ name: 's', type: 'number', value: 20 }];
  ed2.sketchEdit.sel = new Set([line2]);
  const r0 = ed2.startPatternDraft('rectangular');
  assert.ok(r0);
  r0.countText = '2';
  r0.spacingText = 's';
  assert.equal(ed2.confirmPatternDraft(), true);
  const rp = ed2.sketchEdit.sk.patterns?.[0];
  assert.ok(rp && rp.kind.type === 'rectangular');
  const seed = M.entOf(ed2.sketchEdit.sk, line2);
  assert.ok(seed && seed.t === 'line');
  const at = (sk: M.Sketch, inst: P.PatternInstance, seedPt: number) => {
    const pair = inst.points.find(([s]) => s === seedPt);
    assert.ok(pair);
    return M.ptOf(sk, pair![1])!;
  };
  const before = { ...at(ed2.sketchEdit.sk, rp.instances.find((i) => i.index[0] === 1 && i.index[1] === 0)!, seed.a) };
  ed2.doc.params = [{ name: 's', type: 'number', value: 30 }];
  const pos2 = ed2.history.position;
  assert.equal(ed2.applyParams().length, 0);
  const rp2 = ed2.sketchEdit.sk.patterns?.[0];
  assert.ok(rp2);
  const moved = at(ed2.sketchEdit.sk, rp2.instances.find((i) => i.index[0] === 1 && i.index[1] === 0)!, seed.a);
  pbNear(moved.x - before.x, 10);
  pbNear(moved.y - before.y, 0);
  assert.equal(ed2.history.position, pos2 + 1, 'ein Undo');
});

test('Phase 4: unauflösbarer Param → Fehler nennt Muster-ID und Parametername, keine Mutation', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.doc.params = [{ name: 'n', type: 'number', value: 4 }];
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  d0.countText = 'n';
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern);
  const pid = pattern.id;
  const json = M.sketchJson(ed.sketchEdit.sk), pos = ed.history.position;
  ed.doc.params = [{ name: 'anderer', type: 'number', value: 9 }];
  const problems = ed.applyParams();
  const msgs = problems.flatMap((p) => p.issues.map((i) => i.msg));
  assert.ok(msgs.some((m) => m.includes(pid) && m.includes('n')), `Fehler nennt Muster-ID und Parametername, war: ${JSON.stringify(msgs)}`);
  assert.equal(M.sketchJson(ed.sketchEdit.sk), json, 'nichts angewendet');
  assert.equal(ed.history.position, pos, 'kein Undo-Schritt');
  assert.equal(ed.sketchEdit.sk.patterns?.[0].instances.length, 3, 'Kopien unverändert');
});

test('Phase 4: Enter im Edit-Modus macht Update mit ID (kein neues Muster)', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  d0.countText = '4';
  assert.equal(ed.confirmPatternDraft(), true);
  const pid = ed.sketchEdit.sk.patterns?.[0].id;
  assert.ok(pid);
  const d = ed.startPatternEditDraft(pid);
  assert.ok(d?.editPatternId, 'Edit-Modus erkannt');
  d.countText = '5';
  const pos = ed.history.position;
  assert.equal(ed.sketchKey({ key: 'Enter', target: {} }), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Fenster zu');
  assert.equal(ed.sketchEdit.sk.patterns?.length, 1, 'kein Duplikat');
  assert.equal(ed.sketchEdit.sk.patterns?.[0].id, pid, 'gleiche ID');
  assert.equal(ed.sketchEdit.sk.patterns?.[0].instances.length, 4, '5 → 4 Kopien');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo');
});

test('Phase 4: Rechtsklick im Edit-Modus macht Update mit ID', () => {
  const { ed, line, pivot } = phase2Harness();
  ed.sketchEdit.sel = new Set([line]);
  const d0 = ed.startPatternDraft('circular');
  assert.ok(d0);
  d0.center = pivot;
  d0.countText = '4';
  assert.equal(ed.confirmPatternDraft(), true);
  const pid = ed.sketchEdit.sk.patterns?.[0].id;
  assert.ok(pid);
  const d = ed.startPatternEditDraft(pid);
  assert.ok(d?.editPatternId, 'Edit-Modus erkannt');
  d.countText = '5';
  const pos = ed.history.position;
  assert.equal(ed.sketchPatternRight(), true);
  assert.equal(ed.sketchEdit.sk.patterns?.length, 1, 'kein Duplikat');
  assert.equal(ed.sketchEdit.sk.patterns?.[0].id, pid, 'gleiche ID');
  assert.equal(ed.sketchEdit.sk.patterns?.[0].instances.length, 4, '5 → 4 Kopien');
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo');
});

test('Phase 4: Verdrahtung (statisch): Badge, Menü, Edit-Fenster, Param-Hook', () => {
  const root = new URL('../src/', import.meta.url);
  const sketch = readPhase2(new URL('editor/sketch.ts', root), 'utf8');
  const render = readPhase2(new URL('editor/render.ts', root), 'utf8');
  const panel = readPhase2(new URL('sketchPanel.ts', root), 'utf8');
  const context = readPhase2(new URL('sketchContext.ts', root), 'utf8');
  const build = readPhase2(new URL('sketch/patternBuild.ts', root), 'utf8');
  for (const fn of ['patternBadgeAnchor', 'sketchPatternBadgeAt', 'patternHitOfSelection', 'patternOwnerOfId',
    'startPatternEditDraft', 'confirmPatternEdit', 'dissolvePatternDraft', 'removePatternDraftCopies',
    'planPatternParamRefresh', 'openPatternEdit', 'openPatternEditForSelection', 'clearPatternSingle', 'patternSingleOf']) {
    assert.ok(sketch.includes(fn), `Editor-Pfad fehlt: ${fn}`);
  }
  assert.ok(render.includes('patternBadgeAnchor') && render.includes('#7a4fd0'), 'Badge-Glyphe in render.ts (eigene Farbe)');
  assert.ok(panel.includes('openPatternEditDialog') && panel.includes('setPatternEditOpener'), 'Edit-Fenster mit Öffner-Registrierung');
  assert.ok(panel.includes('(bearbeiten)') && panel.includes('Auflösen') && panel.includes('Entfernen'), 'Edit-Fenster: Titel, Auflösen, Entfernen');
  assert.ok(panel.includes('confirmPatternEdit') && panel.includes('if (isEdit) ed.confirmPatternEdit(); else ed.confirmPatternDraft()'), 'Edit-Fenster: eigener OK-Pfad');
  assert.ok(panel.includes(': [h(\'button\', { type: \'button\', class: \'btn\', onclick: () => ed.applyPatternDraft() }, t(\'Übernehmen\'))]'), 'Übernehmen nur im Neu-Modus (Edit-Pfad ohne)');
  assert.ok(context.includes('sketch-pattern-edit') && context.includes('Skizzenmuster bearbeiten'), 'Kontextmenü-Eintrag');
  assert.ok(build.includes('patternContainingCopy'), 'Kopie→Muster-Auflösung in patternBuild.ts');
  assert.ok(sketch.includes('refreshSketchParams') && sketch.includes('planPatternParamRefresh(sk'), 'Param-Hook in refreshSketchParams');
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen (inkl. Phase 4)`);
  process.exit(1);
}
console.log(`\nAlle Muster-Tests bestanden (inkl. Phase 4, ${pending.length} Tests)`);

// Phase 5: lebende Richtungen (F1), Stepper-Maxima (F5), Koordinaten-Check (F6).
// PB/SK/M/P-Importe, Helfer (pbNear, pbCopy, pbPt) und phase2Harness von oben wiederverwenden.

function phase5RectWithDirs(): { sk: M.Sketch; dirLine: number; dir2Line: number; seed: number; s1: number } {
  const sk = M.emptySketch();
  const la = M.addPt(sk, 0, 0), lb = M.addPt(sk, 20, 0);
  const dirLine = M.addLine(sk, la.id, lb.id);
  const lc = M.addPt(sk, 100, 100), ld = M.addPt(sk, 100, 130);
  const dir2Line = M.addLine(sk, lc.id, ld.id);
  const s1 = M.addPt(sk, 5, 5), s2 = M.addPt(sk, 15, 5);
  const seed = M.addLine(sk, s1.id, s2.id);
  return { sk, dirLine: dirLine.id, dir2Line: dir2Line.id, seed: seed.id, s1: s1.id };
}

test('Phase 5: Richtungslinien-Dreh → Sync folgt, ids stabil, Fixmuster unberührt', () => {
  const { sk, dirLine, dir2Line, seed, s1 } = phase5RectWithDirs();
  const r = PB.buildRectangularPattern(sk, {
    entities: [seed], count: 2, spacing: 10, count2: 2, spacing2: 7,
    direction: dirLine, direction2: dir2Line,
  });
  assert.ok(!('error' in r), `unerwarteter Fehler: ${(r as { error: string }).error}`);
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  // Zweites Muster ohne Referenz (fester Vektor) im selben Sketch.
  const s3 = M.addPt(sk, 200, 200), s4 = M.addPt(sk, 210, 200);
  const seed2 = M.addLine(sk, s3.id, s4.id);
  const rf = PB.buildRectangularPattern(sk, { entities: [seed2.id], count: 2, spacing: 10 });
  assert.ok(!('error' in rf));
  const fixed = (rf as { pattern: P.SketchPattern }).pattern;
  const fixedCopyBefore = { ...pbCopy(sk, fixed.instances[0], s3.id) };
  const curvesBefore = pattern.instances.flatMap((i) => i.curves);
  const ptsBefore = pattern.instances.flatMap((i) => i.points.map((p) => p[1]));
  // Richtung 1: +X → +Y; Richtung 2: +Y → +X (Endpunkte verschieben).
  const lb = M.ptOf(sk, M.entOf(sk, dirLine)?.t === 'line' ? (M.entOf(sk, dirLine) as { a: number; b: number }).b : -1)!;
  lb.x = 0; lb.y = 20;
  const ld = M.ptOf(sk, (M.entOf(sk, dir2Line) as unknown as { b: number }).b)!;
  ld.x = 130; ld.y = 100;
  const res = PB.syncPatternDirections(sk);
  assert.equal(res.synced, 1, 'genau ein Muster nachgeführt');
  const kind = pattern.kind;
  assert.ok(kind.type === 'rectangular');
  pbNear(kind.dir.x, 0); pbNear(kind.dir.y, 1);
  assert.ok(kind.dir2);
  pbNear(kind.dir2!.x, 1); pbNear(kind.dir2!.y, 0);
  // Kopien folgen: [1,0] = +10 in +Y; [0,1] = +7 in +X; [1,1] = beides.
  const byKey = new Map(pattern.instances.map((i) => [`${i.index[0]},${i.index[1]}`, i]));
  const g10 = pbCopy(sk, byKey.get('1,0')!, s1);
  pbNear(g10.x, 5); pbNear(g10.y, 15);
  const g01 = pbCopy(sk, byKey.get('0,1')!, s1);
  pbNear(g01.x, 12); pbNear(g01.y, 5);
  const g11 = pbCopy(sk, byKey.get('1,1')!, s1);
  pbNear(g11.x, 12); pbNear(g11.y, 15);
  assert.deepEqual(pattern.instances.flatMap((i) => i.curves), curvesBefore, 'Kurven-ids stabil');
  assert.deepEqual(pattern.instances.flatMap((i) => i.points.map((p) => p[1])), ptsBefore, 'Punkt-ids stabil');
  const fixedCopyAfter = pbCopy(sk, fixed.instances[0], s3.id);
  pbNear(fixedCopyAfter.x, fixedCopyBefore.x);
  pbNear(fixedCopyAfter.y, fixedCopyBefore.y);
  assert.ok((fixed.kind as P.RectangularPatternKind).dir.x === 1, 'Fixmuster-Richtung unberührt');
});

test('Phase 5: Sync ohne Änderung → kein Neubau (synced 0, Geometrie byte-identisch)', () => {
  const { sk, dirLine, dir2Line, seed } = phase5RectWithDirs();
  const r = PB.buildRectangularPattern(sk, {
    entities: [seed], count: 2, spacing: 10, count2: 2, spacing2: 7,
    direction: dirLine, direction2: dir2Line,
  });
  assert.ok(!('error' in r));
  const before = M.sketchJson(sk);
  assert.equal(PB.syncPatternDirections(sk).synced, 0);
  assert.equal(M.sketchJson(sk), before, 'kein Neubau ohne Änderung');
});

test('Phase 5: gelöschte Richtungslinie → kein Crash, prune zuständig', () => {
  const { sk, dirLine, seed } = phase5RectWithDirs();
  const r = PB.buildRectangularPattern(sk, { entities: [seed], count: 2, spacing: 10, direction: dirLine });
  assert.ok(!('error' in r));
  const pattern = (r as { pattern: P.SketchPattern }).pattern;
  const curvesBefore = pattern.instances.flatMap((i) => i.curves);
  M.deleteIds(sk, [dirLine]);
  const before = M.sketchJson(sk);
  assert.equal(PB.syncPatternDirections(sk).synced, 0, 'unlösbar → kein Sync, kein Crash');
  assert.equal(M.sketchJson(sk), before, 'Sync mutiert nichts Unlösbares');
  assert.deepEqual(pattern.instances.flatMap((i) => i.curves), curvesBefore, 'Kopie-Geometrie bleibt stehen');
  assert.equal(PB.prunePatterns(sk), 1, 'prune löst die Assoziation (Zuständigkeit)');
});

test('Phase 5: Editor-Sync nach Linien-Drag: Kopien folgen, kein eigener Undo-Schritt', () => {
  const { ed, line } = phase2Harness();
  const d = ed.startPatternDraft('rectangular');
  assert.ok(d);
  d.entities = [line];
  d.direction = line;
  d.countText = '2';
  d.spacingText = '10';
  d.count2Text = '1';
  d.spacing2Text = '10';
  assert.equal(ed.confirmPatternDraft(), true);
  const pattern = ed.sketchEdit.sk.patterns?.[0];
  assert.ok(pattern && pattern.kind.type === 'rectangular');
  const lent = M.entOf(ed.sketchEdit.sk, line);
  assert.ok(lent && lent.t === 'line');
  const seedPt = lent.a;
  const before = { ...pbCopy(ed.sketchEdit.sk, pattern.instances[0], seedPt) };
  pbNear(before.x, 20); pbNear(before.y, 0);
  const pos = ed.history.position;
  // Linien-Drag simuliert: Endpunkt ziehen (Richtung +X → (100,40)).
  const end = M.ptOf(ed.sketchEdit.sk, lent.b)!;
  end.y += 40;
  const n = ed.syncPatternsAfterSolve();
  assert.equal(n, 1, 'genau ein Muster nachgeführt');
  assert.equal(ed.history.position, pos, 'kein eigener Undo-Schritt');
  const k = pattern.kind;
  assert.ok(k.type === 'rectangular');
  const len = Math.hypot(100, 40);
  pbNear(k.dir.x, 100 / len); pbNear(k.dir.y, 40 / len);
  const moved = pbCopy(ed.sketchEdit.sk, pattern.instances[0], seedPt);
  pbNear(moved.x, 10 + (10 * 100) / len);
  pbNear(moved.y, (10 * 40) / len);
});

test('Phase 5: Stepper-Maximum zweite Richtung folgt erster Anzahl', () => {
  assert.equal(SK.patternCount2Max('26'), 19, 'count=26 → count2-max=19');
  assert.equal(SK.patternCount2Max('1'), 500);
  assert.equal(SK.patternCount2Max('3'), 166);
  assert.equal(SK.patternCount2Max('500'), 1);
  assert.equal(SK.patternCount2Max(''), 500);
  assert.equal(SK.patternCount2Max('0'), 500);
});

test('Phase 5: Riesen-Abstand Rechteck → Fehler + No-Mutation-Snapshot', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 10, 0), b = M.addPt(sk, 20, 0);
  const line = M.addLine(sk, a.id, b.id);
  const snap = () => `${sk.next}/${sk.ents.length}/${sk.pts.length}/${(sk.patterns ?? []).length}|${M.sketchJson(sk)}`;
  // Grenze: Kopie exakt bei |v| = 1e6 ist zulässig (b: 20 + 999980).
  const ok = PB.buildRectangularPattern(sk, { entities: [line.id], count: 2, spacing: 999980 });
  assert.ok(!('error' in ok), `Grenze 1e6 zulässig, war: ${JSON.stringify(ok)}`);
  const before = snap();
  const bad = PB.buildRectangularPattern(sk, { entities: [line.id], count: 2, spacing: 1e6 });
  assert.ok('error' in bad, 'Überlauf abgewiesen');
  assert.ok((bad as { error: string }).error.includes('Kopie außerhalb des Koordinatenbereichs'), `Fehlertext, war: ${(bad as { error: string }).error}`);
  assert.equal(snap(), before, 'fehlgeschlagener Bau mutiert nichts');
});

test('Phase 5: Riesen-Radius Kreis → Fehler + No-Mutation-Snapshot', () => {
  const sk = M.emptySketch();
  const pivot = M.addPt(sk, 0, 0);
  const a = M.addPt(sk, 1e6, 5e5), b = M.addPt(sk, 1e6 + 10, 5e5);
  const line = M.addLine(sk, a.id, b.id);
  const snap = () => `${sk.next}/${sk.ents.length}/${sk.pts.length}/${(sk.patterns ?? []).length}|${M.sketchJson(sk)}`;
  const before = snap();
  const r = PB.buildCircularPattern(sk, { entities: [line.id], center: pivot.id, count: 4 });
  assert.ok('error' in r, 'Überlauf abgewiesen');
  assert.ok((r as { error: string }).error.includes('Kopie außerhalb des Koordinatenbereichs'));
  assert.equal(snap(), before, 'fehlgeschlagener Bau mutiert nichts');
});

test('Phase 5: Spiegel über den Bereich hinaus → Fehler + No-Mutation-Snapshot', () => {
  const sk = M.emptySketch();
  const la = M.addPt(sk, 1000010, -10), lb = M.addPt(sk, 1000010, 10);
  const axis = M.addLine(sk, la.id, lb.id);
  const seed = M.addPt(sk, 0, 0);
  const seedEnt = M.addPoint(sk, seed.id);
  const snap = () => `${sk.next}/${sk.ents.length}/${sk.pts.length}|${M.sketchJson(sk)}`;
  const before = snap();
  const r = PB.mirrorEntities(sk, { entities: [seedEnt.id], line: axis.id });
  assert.ok('error' in r, 'Überlauf abgewiesen');
  assert.ok((r as { error: string }).error.includes('Kopie außerhalb des Koordinatenbereichs'));
  assert.equal(snap(), before, 'fehlgeschlagener Bau mutiert nichts');
});

test('Phase 5: Update mit Überlauf → Fehler, bestehende Instanzen unverändert', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 10, 0), b = M.addPt(sk, 20, 0);
  const line = M.addLine(sk, a.id, b.id);
  const built = PB.buildRectangularPattern(sk, { entities: [line.id], count: 2, spacing: 5000 });
  assert.ok(!('error' in built));
  const pattern = (built as { pattern: P.SketchPattern }).pattern;
  const snap = () => M.sketchJson(sk);
  const before = snap();
  const r = PB.updatePattern(sk, pattern.id, { type: 'rectangular', count: 201 });
  assert.ok('error' in r, 'Überlauf abgewiesen (10 + 200·5000 > 1e6)');
  assert.ok((r as { error: string }).error.includes('Kopie außerhalb des Koordinatenbereichs'));
  assert.equal(snap(), before, 'fehlgeschlagenes Update mutiert nichts');
  assert.equal(pattern.instances.length, 1, 'Instanzen unverändert');
});

test('Phase 5: Verdrahtung (statisch): Sync nach Solve, Stepper-Max, Koordinaten-Check', () => {
  const root5 = new URL('../src/', import.meta.url);
  const sketch5 = readPhase2(new URL('editor/sketch.ts', root5), 'utf8');
  const panel5 = readPhase2(new URL('sketchPanel.ts', root5), 'utf8');
  const build5 = readPhase2(new URL('sketch/patternBuild.ts', root5), 'utf8');
  assert.ok(build5.includes('syncPatternDirections'), 'Sync in patternBuild.ts');
  assert.ok(build5.includes('Kopie außerhalb des Koordinatenbereichs'), 'Koordinaten-Check in patternBuild.ts');
  const calls = sketch5.match(/syncPatternsAfterSolve/g) ?? [];
  assert.ok(calls.length >= 4, `Sync-Helfer + Aufrufe nach Solve erwartet, gefunden: ${calls.length}`);
  assert.ok(sketch5.includes('patternCount2Max'), 'Stepper-Maximum als reine Funktion');
  assert.ok(panel5.includes('patternCount2Max'), 'Panel nutzt das Stepper-Maximum');
  assert.ok(panel5.includes('input.max'), 'Max-Attribut wird in refresh neu gesetzt');
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen (inkl. Phase 5)`);
  process.exit(1);
}
test('Phase 5: Rahmen füllt Elemente (Rechteck- und Kreisfenster, Hilfslinie raus)', () => {
  for (const kind of ['rectangular', 'circular'] as const) {
    const { ed, line, aux } = phase2Harness();
    ed.canvas = { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    // Nicht-identische View (Review-Forderung): Treffer und Rahmen laufen über Transforms.
    ed.view = { zoom: 2.5, ox: 30, oy: -20 };
    ed.dpr = 2;
    const toScr = (x: number, y: number) => ed.skToScreen({ x, y });
    ed.sketchEdit.sel = new Set([line]);
    const d = ed.startPatternDraft(kind);
    assert.ok(d);
    assert.deepEqual(d.entities, [line], 'Vorselektion drin');
    d.entities = [];
    const down = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 21 };
    // Kreuzender Rahmen (von rechts): Linie drin, Hilfslinie (x=-50) draußen.
    const p0 = toScr(120, 40), p1 = toScr(30, -10);
    ed.sketchDown(p0.x, p0.y, down);
    assert.ok(ed.sketchEdit.frame, 'Rahmen startet bei offenem Fenster');
    ed.sketchMove(p1.x, p1.y, { pointerId: 21 });
    ed.sketchUp({ pointerId: 21, button: 0, clientX: p1.x, clientY: p1.y });
    assert.ok(d.entities.includes(line), `Rahmen übernimmt Linie (${kind})`);
    assert.ok(!d.entities.includes(aux), 'Hilfslinie wird übersprungen');
    assert.deepEqual(ed.sketchEdit.sel, new Set([line]), 'Dokument-Auswahl unberührt');
    assert.equal(ed.sketchEdit.sk.patterns, undefined, 'kein Commit durch Rahmen');
  }
});

test('Phase 5: Escape während Rahmen verwirft Entwurf und Rahmen', () => {
  const { ed, line } = phase2Harness();
  ed.canvas = { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const d = ed.startPatternDraft('rectangular');
  assert.ok(d);
  d.entities = [line];
  const json = M.sketchJson(ed.sketchEdit.sk), pos = ed.history.position;
  const down = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 23 };
  ed.sketchDown(120, 40, down);
  assert.ok(ed.sketchEdit.frame, 'Rahmen läuft');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} }), true);
  assert.equal(ed.sketchEdit.patternDraft, null, 'Entwurf weg');
  assert.equal(ed.sketchEdit.frame, undefined, 'Rahmen weg');
  // Verwaister Release danach: kein Dokument-Effekt, kein Absturz.
  ed.sketchUp({ pointerId: 23, button: 0, clientX: 200, clientY: 200 });
  assert.equal(M.sketchJson(ed.sketchEdit.sk), json, 'doc unverändert');
  assert.equal(ed.history.position, pos, 'kein Undo');
  assert.deepEqual(ed.sketchEdit.sel, new Set(), 'keine Dokument-Auswahl');
});

test('Phase 5: Klick ohne Weg bleibt Klick (Freiraum-Mitte)', () => {
  const { ed } = phase2Harness();
  ed.canvas = { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const d = ed.startPatternDraft('circular');
  assert.ok(d);
  d.active = 'center';
  const down = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 22 };
  ed.sketchDown(200, 200, down);
  ed.sketchUp({ pointerId: 22, button: 0, clientX: 200, clientY: 200 });
  assert.ok(!ed.sketchEdit.frame, 'kein Rahmen übrig');
  assert.deepEqual(d.entities, [], 'keine Elemente gepickt');
  assert.deepEqual(d.freeCenter, { x: 200, y: 200 }, 'Freiraum-Mitte vorgemerkt');
});

console.log(`\nAlle Muster-Tests bestanden (inkl. Phase 5, ${pending.length} Tests)`);
