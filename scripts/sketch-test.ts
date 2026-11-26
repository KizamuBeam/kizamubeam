// Tests der Skizzen (Datenmodell, Umriss, Löser PlaneGCS). Aufruf: npm run test:sketch
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Editor } from '../src/editor';
import type { GenShape, Mat } from '../src/model';
const M = await import('../src/sketch/model');
const S = await import('../src/sketch/solver');
const { EditorSketch } = await import('../src/editor/sketch');
const { EditorGuides } = await import('../src/editor/guides');
const { EditorCommands } = await import('../src/editor/commands');
const { EditorSnapping } = await import('../src/editor/snapping');
const { SnapSet, angleGuide, snapToExtension, trackPoint } = await import('../src/snap');
const SN = await import('../src/snap');
const SEL = await import('../src/sketch/selection');
const { apply } = await import('../src/model');
const { findArcs } = await import('../src/arcs');
const { subsToSketch } = await import('../src/sketch/convert');
const { shapeSubs } = await import('../src/geom');
const { addSketchPolyline } = await import('../src/sketch/polyline');
const { sketchFrameSelection } = await import('../src/sketch/selection');
const CL = await import('../src/sketch/constrLines');
const CM = await import('../src/sketch/circleModes');
const { applySketchTrim, pickSketchExtend, planSketchTrim } = await import('../src/sketch/trim');
const { applyTrimSpan, pickTrimSpan } = await import('../src/sketch/trimSpans');
const { applySketchSplit, planSketchSplit } = await import('../src/sketch/split');
const { addSketchSlot, addOrientedSketchSlot, sketchSlots, sketchSlotAxis, sketchSlotWidth } = await import('../src/sketch/slot');
const { addRoundedSketchRectangle } = await import('../src/sketch/roundedRectangle');
const { addSketchPolygon, sketchPolygonVertices } = await import('../src/sketch/polygon');
const { addSketchCircleOffset } = await import('../src/sketch/circleOffset');
const { addSmoothOffset, planSmoothOffset } = await import('../src/sketch/smoothOffset');
const { addSplitInset, planSplitInset } = await import('../src/sketch/splitInset');
const { translateSketchSelection } = await import('../src/sketch/translate');
const { applySketchCorner, planSketchCorner } = await import('../src/sketch/corner');
const { sketchRigidMatrix, transformedSketch } = await import('../src/sketch/transform');
const { sketchEdgeIntersections } = await import('../src/sketch/trimSpans');
const FMT = await import('../src/sketchDimensionInput');
const PTR = await import('../src/editor/pointer');
const RND = await import('../src/editor/render');
const TYPO = await import('../src/uiTypography');
const I18N = await import('../src/i18n');
const MDL = await import('../src/model');
const { Editor } = await import('../src/editor');
const { DEFAULT_GRID } = await import('../src/grid');
const FV = await import('../src/sketch/formVariants');

S.setSolverWasm(resolve('node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'));
await S.loadSolver();

let failed = 0;
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('Gerade und Bogen: Fase und Rundung behalten die bemaßten Quellen', () => {
  for (const rounded of [false, true]) {
    const sk = M.emptySketch(), c = M.addPt(sk, 0, 0), a = M.addPt(sk, 10, 0), b = M.addPt(sk, 0, 10), far = M.addPt(sk, 26, 0);
    const arc = M.addArc(sk, c.id, a.id, b.id), line = M.addLine(sk, a.id, far.id);
    for (const p of [c, far]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
    M.addCon(sk, 'horizontal', [c.id, a.id]); M.addCon(sk, 'vertical', [c.id, b.id]);
    const radius = M.addCon(sk, 'radius', [arc.id], { v: 10 });
    const plan = planSketchCorner(sk, line.id, 'a', 2, rounded);
    assert.ok(plan);
    assert.notEqual(applySketchCorner(sk, plan), false);
    const result = S.solveSketch(sk);
    assert.ok(result.ok && !result.redundant.length && result.dof === 0, JSON.stringify(result));
    const reload = M.parseSketch(M.sketchJson(sk));
    reload.cons.find((x) => x.id === radius.id)!.v = 11;
    const next = S.solveSketch(reload);
    assert.ok(next.ok && !next.redundant.length, JSON.stringify(next));
    assert.equal(M.sketchSubs(reload).length, 1);
    assert.equal(reload.ents.filter((e) => !e.aux).length, 3);
    assert.ok(M.entOf(reload, arc.id)?.aux && M.entOf(reload, line.id)?.aux);
  }
});


test('Spiegeln: verknüpfte Teilbögen behalten Quelle und lösen erneut', () => {
  const sk = M.emptySketch(), c = M.addPt(sk, 0, 0), a = M.addPt(sk, 10, 0), b = M.addPt(sk, 0, 10);
  const arc = M.addArc(sk, c.id, a.id, b.id);
  M.addCon(sk, 'fixed', [c.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [c.id, a.id]); M.addCon(sk, 'vertical', [c.id, b.id]);
  const radius = M.addCon(sk, 'radius', [arc.id], { v: 10 });
  const theta = Math.PI / 8;
  applySketchSplit(sk, arc.id, { x: 10 * Math.cos(theta), y: 10 * Math.sin(theta) });
  const m = sketchRigidMatrix(true, [{ x: 0, y: 0 }], { x: 0, y: 1 })!;
  const copy = transformedSketch(sk, new Set(sk.ents.filter((e) => !e.aux).map((e) => e.id)), m, true);
  assert.ok('sketch' in copy);
  copy.sketch.cons.find((x) => x.id === radius.id)!.v = 12;
  const result = S.solveSketch(copy.sketch);
  assert.ok(result.ok && result.dof === 0 && !result.redundant.length, JSON.stringify(result));
  copy.sketch.cons.filter((x) => x.t === 'arcSpan').forEach((x) => near(x.v!, 0.75));
  assert.equal(M.sketchSubs(copy.sketch).length, 1);
});

test('Spiegeln: Polygon und Konturversatz behalten ihre parametrische Zuordnung', () => {
  const mirror = sketchRigidMatrix(true, [{ x: 0, y: 0 }], { x: 0, y: 1 })!;
  const flip = (sk: Sk) => {
    const copy = transformedSketch(sk, new Set(sk.ents.filter((e) => !e.aux).map((e) => e.id)), mirror, true);
    assert.ok('sketch' in copy);
    const saved = M.parseSketch(M.sketchJson(copy.sketch));
    const solved = S.solveSketch(saved);
    assert.ok(solved.ok && !solved.redundant.length, JSON.stringify(solved));
    assert.equal(M.sketchSubs(saved).length, M.sketchSubs(sk).length);
    assert.equal(saved.cons.length, sk.cons.length);
    return saved;
  };
  const polygon = M.emptySketch();
  addSketchPolygon(polygon, { x: 24, y: 8 }, { x: 32, y: 8 }, 5);
  const poly = flip(polygon);
  poly.cons.find((c) => c.t === 'radius')!.v = 9;
  assert.ok(S.solveSketch(poly).ok);

  const offset = M.emptySketch();
  addSketchSlot(offset, { x: 0, y: 0 }, 20, false, 10);
  const line = offset.ents.find((e) => e.t === 'line' && !e.aux)!;
  assert.notEqual(addSmoothOffset(offset, line.id, { x: 10, y: -8 }), false);
  flip(offset);
});

const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      pending.push((r as Promise<void>).then(() => {
        console.log(`ok   ${name}`);
      }).catch((e) => {
        failed++;
        console.log(`FAIL ${name}\n${(e as Error).stack}`);
      }));
      return;
    }
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
type Sk = ReturnType<typeof M.emptySketch>;

/** Rechteck aus vier Linien mit gemeinsamen Punkten (ungefähr gezeichnet) */
function roughRect(sk: Sk) {
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 41, 1), M.addPt(sk, 40.5, 19), M.addPt(sk, -1, 20.5)];
  const l = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id));
  return { p, l };
}

test('Rechteck: horizontal/vertikal, Länge und Höhe, fester Punkt → voll bestimmt', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'horizontal', [l[0].id]);
  M.addCon(sk, 'horizontal', [l[2].id]);
  M.addCon(sk, 'vertical', [l[1].id]);
  M.addCon(sk, 'vertical', [l[3].id]);
  M.addCon(sk, 'fixed', [p[0].id], { x: 0, y: 0 });
  M.addCon(sk, 'distance', [l[0].id], { v: 50 });
  M.addCon(sk, 'distance', [l[1].id], { v: 30 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 0);
  near(M.ptOf(sk, p[2].id)!.x, 50);
  near(M.ptOf(sk, p[2].id)!.y, 30);
  const subs = M.sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.ok(subs[0].closed);
  assert.equal(subs[0].nodes.length, 4);
});

test('Polylinie: Gerade und rückwärts laufender Kreisbogen teilen einen Knoten', () => {
  const sk = M.emptySketch();
  assert.equal(addSketchPolyline(sk, { x: -10, y: 6 }, [
    { end: { x: 2, y: 6 } },
    { end: { x: 12, y: 6 }, through: { x: 7, y: 11 } },
  ], false), null);
  const [line, arc] = sk.ents;
  assert.ok(line.t === 'line' && arc.t === 'arc');
  assert.equal(line.b, arc.e);
  near(arc.r, 5);
  assert.ok(S.solveSketch(sk).ok);
  const [path, ...extra] = M.sketchSubs(sk);
  assert.equal(extra.length, 0);
  assert.ok(!path.closed);
  assert.ok(path.nodes.some(({ x, y }) => Math.abs(x - 7) < 1e-6 && Math.abs(y - 11) < 1e-6));
});

test('Polylinie: geschlossene Kette verwendet denselben Start- und Endknoten', () => {
  for (const explicit of [true, false]) {
    const sk = M.emptySketch();
    const start = { x: 1, y: 2 };
    const edges = explicit
      ? [{ end: { x: 11, y: 2 } }, { end: start, through: { x: 6, y: 7 } }]
      : [{ end: { x: 11, y: 2 }, through: { x: 6, y: 7 } }];
    assert.equal(addSketchPolyline(sk, start, edges, true), null);
    assert.equal(sk.ents.length, 2);
    assert.equal(sk.pts.length, 3);
    assert.ok(S.solveSketch(sk).ok);
    const subs = M.sketchSubs(sk);
    assert.equal(subs.length, 1);
    assert.ok(subs[0].closed);
  }
});

test('Polylinie: ungültiges spätes Segment hinterlässt keine Teilkette', () => {
  const sk = M.emptySketch();
  assert.deepEqual(addSketchPolyline(sk, { x: 0, y: 0 }, [
    { end: { x: 10, y: 0 } }, { end: { x: 30, y: 0 }, through: { x: 20, y: 0 } },
  ], false), { index: 1, reason: 'arc' });
  assert.deepEqual(sk, M.emptySketch());
});

test('Polylinie: nicht darstellbarer Kreismittelpunkt verschiebt keine eingegebenen Punkte', () => {
  const sk = M.emptySketch();
  const x = 1e16;
  assert.deepEqual(addSketchPolyline(sk, { x, y: 0 }, [
    { through: { x: x + 2, y: 2 }, end: { x: x + 2, y: 0 } },
  ], false), { index: 0, reason: 'precision' });
  assert.deepEqual(sk, M.emptySketch());
});

function circleTool(sk: Sk) {
  const m: Mat = [0, 1, -1, 0, 70, 50];
  const json = M.sketchJson(sk);
  const shape: GenShape = { kind: 'gen', gen: 'sketch', params: { sketch: json }, subs: M.sketchSubs(sk) };
  const obj = { id: 'sketch', shape, m };
  const snapshots: string[] = [];
  const snapping = new EditorSnapping();
  const ed = Object.assign(new EditorSketch(), {
    doc: { objs: [obj] },
    sketchEdit: { obj, m, sk, json, tool: 'circle', sel: new Set(), labels: [], draft: [], draftIds: [], dimPick: [],
      drawAux: false, drawLine: 'normal', showRelations: true, showDims: true, showPoints: true, showConstruction: true },
    history: { position: 0 },
    snapObjects: true, snapGrid: false, view: { zoom: 2 }, dpr: 1.5,
    toScreen: ({ x, y }: { x: number; y: number }) => ({ x: 2 * x + 20, y: 2 * y + 35 }),
    toWorld: (sx: number, sy: number) => ({ x: (sx - 20) / 2, y: (sy - 35) / 2 }),
    snapPt: snapping.snapPt, snapModes: snapping.snapModes, snapTol: snapping.snapTol, clearSnap: snapping.clearSnap,
    snapTargetSet: snapping.snapTargetSet,
    addTrackPt: snapping.addTrackPt, clearTrack: snapping.clearTrack, clearTrackTimer: snapping.clearTrackTimer,
    armTrackTimer: snapping.armTrackTimer, fireTrackDwell: snapping.fireTrackDwell,
    trackDwellOnHit: snapping.trackDwellOnHit,
    gridRound: snapping.gridRound, gridStep: 1, hoverSnapSet: () => new SnapSet(), skScale: () => 2,
    paramList: () => [], emit() {}, redraw() {}, touch() {},
    snapshot: () => snapshots.push(String(shape.params.sketch)),
  }) as unknown as Editor;
  const click = (x: number, y: number, dx = 0, dy = 0) => {
    const { x: sx, y: sy } = ed.skToScreen({ x, y });
    ed.sketchDown(sx + dx, sy + dy, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent);
  };
  return { ed, shape, snapshots, click };
}

test('Gleich mit Maßkonflikt: Folgemaße werden Referenz, erstes Objekt bleibt Master', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 0, 0), p1 = M.addPt(sk, 10, 0);
  const c2 = M.addPt(sk, 30, 0), p2 = M.addPt(sk, 45, 0);
  const k1 = M.addCircle(sk, c1.id, 10), k2 = M.addCircle(sk, c2.id, 15);
  const d1 = M.addCon(sk, 'radius', [k1.id], { v: 10 });
  const d2 = M.addCon(sk, 'radius', [k2.id], { v: 15 });
  const { ed, snapshots } = circleTool(sk);
  ed.sketchEdit!.sel = new Set([k1.id, k2.id]);
  ed.sketchConstrain('equal');
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((ssk.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((ssk.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.ok(ed.sketchEdit!.status?.ok, JSON.stringify(ed.sketchEdit!.status));
  near((M.entOf(ssk, k1.id) as { r: number }).r, 10);
  near((M.entOf(ssk, k2.id) as { r: number }).r, 10);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Gleich mit Maßkonflikt: Master ist das zuerst gewählte Objekt', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 0, 0), p1 = M.addPt(sk, 10, 0);
  const c2 = M.addPt(sk, 30, 0), p2 = M.addPt(sk, 45, 0);
  const k1 = M.addCircle(sk, c1.id, 10), k2 = M.addCircle(sk, c2.id, 15);
  const d1 = M.addCon(sk, 'radius', [k1.id], { v: 10 });
  const d2 = M.addCon(sk, 'radius', [k2.id], { v: 15 });
  const { ed, snapshots } = circleTool(sk);
  ed.sketchEdit!.sel = new Set([k2.id, k1.id]);
  ed.sketchConstrain('equal');
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((ssk.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß (zweite Auswahl zuerst) bleibt treibend');
  assert.equal((ssk.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, true, 'Master-fremdes Maß wird Referenz');
  assert.ok(ed.sketchEdit!.status?.ok, JSON.stringify(ed.sketchEdit!.status));
  near((M.entOf(ssk, k1.id) as { r: number }).r, 15);
  near((M.entOf(ssk, k2.id) as { r: number }).r, 15);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Gleich mit Maßkonflikt: gilt auch für Linien', () => {
  const sk = M.emptySketch();
  const a1 = M.addPt(sk, 0, 0), b1 = M.addPt(sk, 40, 0);
  const a2 = M.addPt(sk, 0, 20), b2 = M.addPt(sk, 60, 20);
  const l1 = M.addLine(sk, a1.id, b1.id), l2 = M.addLine(sk, a2.id, b2.id);
  const d1 = M.addCon(sk, 'distance', [l1.id], { v: 40 });
  const d2 = M.addCon(sk, 'distance', [l2.id], { v: 60 });
  const { ed, snapshots } = circleTool(sk);
  ed.sketchEdit!.sel = new Set([l1.id, l2.id]);
  ed.sketchConstrain('equal');
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((ssk.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((ssk.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.ok(ed.sketchEdit!.status?.ok, JSON.stringify(ed.sketchEdit!.status));
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Gleich mit Maßkonflikt: Bögen folgen derselben Master-Regel', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), a = M.addPt(sk, 10, 0), b = M.addPt(sk, 0, 10);
  const c2 = M.addPt(sk, 30, 0), a2 = M.addPt(sk, 45, 0), b2 = M.addPt(sk, 30, 15);
  const g1 = M.addArc(sk, c.id, a.id, b.id), g2 = M.addArc(sk, c2.id, a2.id, b2.id);
  const d1 = M.addCon(sk, 'radius', [g1.id], { v: 10 });
  const d2 = M.addCon(sk, 'radius', [g2.id], { v: 15 });
  const { ed, snapshots } = circleTool(sk);
  ed.sketchEdit!.sel = new Set([g1.id, g2.id]);
  ed.sketchConstrain('equal');
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((ssk.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.ok(ed.sketchEdit!.status?.ok, JSON.stringify(ed.sketchEdit!.status));
  near((M.entOf(ssk, g2.id) as { r: number }).r, 10);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Gleich ohne Maße im Konflikt bleibt Widerspruch (kein stilles Lockern)', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 0, 0), q1 = M.addPt(sk, 10, 0);
  const c2 = M.addPt(sk, 30, 0), q2 = M.addPt(sk, 45, 0);
  const k1 = M.addCircle(sk, c1.id, 10), k2 = M.addCircle(sk, c2.id, 15);
  M.addCon(sk, 'fixed', [c1.id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [q1.id], { x: 10, y: 0 });
  M.addCon(sk, 'pointOnCircle', [q1.id, k1.id]);
  M.addCon(sk, 'fixed', [c2.id], { x: 30, y: 0 });
  M.addCon(sk, 'fixed', [q2.id], { x: 45, y: 0 });
  M.addCon(sk, 'pointOnCircle', [q2.id, k2.id]);
  const { ed, snapshots } = circleTool(sk);
  ed.sketchEdit!.sel = new Set([k1.id, k2.id]);
  ed.sketchConstrain('equal');
  const rej = ed.sketchEdit!.sk;
  assert.ok(!rej.cons.some((c) => c.t === 'equal'), 'keine Gleich-Bedingung gesetzt');
  assert.ok(rej.cons.every((c) => !(c as M.SkCon).driven), 'kein Maß umgewandelt');
  assert.ok(String(ed.hint).includes('Widerspruch'), `Widerspruch gemeldet, war: ${ed.hint}`);
  assert.equal(ed.sketchEdit!.sel.size, 2, 'Auswahl bleibt bei Ablehnung');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt bei Ablehnung');
});

test('Kreiswerkzeug: Linienmitte und Endpunkt bleiben nach Änderung der Linienlänge gefangen', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'fixed', [a.id], a);
  M.addCon(sk, 'horizontal', [line.id]);
  const length = M.addCon(sk, 'distance', [line.id], { v: 40 });
  const before = M.sketchJson(sk);
  const { ed, shape, snapshots, click } = circleTool(sk);
  click(20, 0, 3, -2); // innerhalb der Fangdistanz, nicht genau auf der Mitte
  assert.equal(M.sketchJson(sk), before);
  assert.equal(snapshots.length, 0);
  click(40, 0, -2, 3);
  const circle = sk.ents[1];
  assert.ok(circle?.t === 'circle');
  assert.deepEqual(sk.cons.slice(3).map(({ t, r }) => [t, r]), [
    ['midpoint', [circle.c, line.id]], ['pointOnCircle', [b.id, circle.id]],
  ]);
  assert.equal(sk.pts.length, 3);
  assert.ok(ed.sketchEdit!.status?.ok);
  assert.equal(ed.sketchEdit!.status!.dof, 0);
  near(M.ptOf(sk, circle.c)!.x, 20);
  near(circle.r, 20);
  assert.deepEqual(snapshots, [before]);

  const placed = String(shape.params.sketch);
  shape.params.sketch = snapshots[0];
  ed.syncSketch();
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before);
  shape.params.sketch = placed;
  ed.syncSketch();
  const loaded = ed.sketchEdit!.sk;
  loaded.cons.find((c) => c.id === length.id)!.v = 60;
  assert.ok(ed.sketchSolve(false).ok);
  near(M.ptOf(loaded, b.id)!.x, 60);
  near(M.ptOf(loaded, circle.c)!.x, 30);
  near((M.entOf(loaded, circle.id) as typeof circle).r, 30);
});

test('Linienmitte bleibt bei Linie, Polylinie und Mittelpunkt-Rechteck an der Quelle gebunden', () => {
  for (const tool of ['line', 'polyline', 'centerRect'] as const) {
    const sk = M.emptySketch();
    const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
    const source = M.addLine(sk, a.id, b.id);
    M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
    M.addCon(sk, 'horizontal', [source.id]);
    const width = M.addCon(sk, 'distance', [source.id], { v: 40 });
    const { ed, shape, click } = circleTool(sk);
    ed.setSketchTool(tool);
    const at = ed.skToScreen({ x: 20, y: 0 });
    const end = ed.skToScreen({ x: 26, y: 12 });
    const event = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent;
    if (tool === 'line') { click(20, 0); click(26, 12); }
    if (tool === 'polyline') {
      ed.sketchPolylineClick(at.x, at.y, event);
      ed.sketchPolylineClick(end.x, end.y, event);
      assert.ok(ed.finishSketchPolyline());
    }
    if (tool === 'centerRect') {
      const first = ed.sketchPointAt(at.x, at.y, event);
      ed.placeSketchCenterRect(first.p, first.id);
      ed.placeSketchCenterRect({ x: 26, y: 12 });
    }
    const saved = M.parseSketch(shape.params.sketch);
    const mid = saved.cons.find((c) => c.t === 'midpoint' && c.r[1] === source.id);
    assert.ok(mid, tool);
    assert.ok(!saved.cons.some((c) => c.t === 'fixed' && c.r[0] === mid.r[0]));
    saved.cons.find((c) => c.id === width.id)!.v = 60;
    const moved = S.solveSketch(saved);
    assert.ok(moved.ok && !moved.redundant.length, `${tool}: ${JSON.stringify(moved)}`);
    near(M.ptOf(saved, mid.r[0])!.x, 30);
  }
});

test('Mittelpunkt-Rechteck: gefangene Ecke steuert die Größe ohne doppelte Maße', () => {
  const sk = M.emptySketch();
  const p = M.addPt(sk, 10, -5);
  const fixed = M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  const { ed } = circleTool(sk);
  ed.setSketchTool('centerRect');
  ed.placeSketchCenterRect({ x: 0, y: 0 });
  ed.placeSketchCenterRect(p, p.id);
  assert.ok(sk.ents.some((e) => e.t === 'line' && !e.aux && [e.a, e.b].includes(p.id)));
  assert.ok(!sk.cons.some((c) => c.t === 'distance'));
  fixed.x = 18;
  assert.ok(S.solveSketch(sk).ok);
  const path = M.sketchSubs(sk)[0];
  near(Math.min(...path.nodes.map((n) => n.x)), -18);
  near(Math.max(...path.nodes.map((n) => n.x)), 18);
});

test('Entfernen eines Fangobjekts verwirft den betroffenen Entwurf', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, a.id, b.id);
  const { ed, click } = circleTool(sk);
  ed.sketchEdit!.sel.add(line.id);
  click(20, 0);
  assert.equal(ed.sketchEdit!.draft[0].midpointOf, line.id);
  ed.sketchDeleteSel();
  click(20, 25);
  assert.equal(sk.ents.length, 0);
  assert.equal(sk.cons.length, 0);
  assert.equal(ed.sketchEdit!.draft.length, 1);
});

test('Kreiswerkzeug: freier Kreis bleibt frei, vorhandener Mittelpunkt wird wiederverwendet', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0), center = M.addPt(sk, 20, 0);
  const line = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'midpoint', [center.id, line.id]);
  const { ed, click } = circleTool(sk);
  click(20, 0);
  click(20, 20);
  const attached = sk.ents[1];
  assert.ok(attached?.t === 'circle');
  assert.equal(attached.c, center.id);
  assert.equal(sk.cons.length, 1);
  assert.equal(sk.pts.length, 3);

  ed.snapObjects = false;
  ed.snapTolerance = { normal: 14, alt: 20 };
  click(20, 6);
  click(35, 20);
  const free = sk.ents[2];
  assert.ok(free?.t === 'circle');
  assert.notEqual(free.c, center.id);
  assert.equal(sk.cons.length, 1);
  near(M.ptOf(sk, free.c)!.y, 6);
});

test('Bemaßter Kreis: Durchmesser bleibt nach dem Laden editierbar, Mittelpunkt bleibt fest', () => {
  const sk = M.emptySketch(), center = { x: 45, y: -8 };
  assert.equal(M.addDimensionedCircle(sk, center, { v: -2 }), false);
  assert.equal(M.addDimensionedCircle(sk, { x: 2 ** 53, y: 0 }, { v: 2 }), false);
  assert.deepEqual(sk, M.emptySketch());
  M.addDimensionedCircle(sk, center, { v: 8, expr: 'Bohrung' });
  const loaded = M.parseSketch(M.sketchJson(sk));
  const dim = loaded.cons.find((c) => c.t === 'diameter')!;
  assert.equal(dim.expr, 'Bohrung');
  dim.v = 12;
  const result = S.solveSketch(loaded);
  assert.ok(result.ok);
  assert.equal(result.dof, 0);
  const circle = loaded.ents[0];
  assert.ok(circle.t === 'circle');
  near(circle.r, 6);
  near(M.ptOf(loaded, circle.c)!.x, center.x);
  near(M.ptOf(loaded, circle.c)!.y, center.y);
  assert.ok(M.sketchSubs(loaded)[0].closed);
});

test('Rahmenauswahl: Kreistangente trifft, innenliegender Rahmen ohne Kontur nicht', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0);
  const e = M.addCircle(sk, c.id, 10);
  const screen: Parameters<typeof sketchFrameSelection>[1] = [0, 2, -3, 0, 100, 80];
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 138, y: 77 }, { x: 130, y: 83 }), [e.id]);
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 107, y: 77 }, { x: 93, y: 83 }), []);
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 69, y: 59 }, { x: 129, y: 101 }), []);
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 69, y: 59 }, { x: 130, y: 101 }), [e.id]);
});

test('Rahmenauswahl: Schnitt mit dem Vollkreis zählt außerhalb des Bogens nicht', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), a = M.addPt(sk, 10, 0), b = M.addPt(sk, 0, 10);
  const arc = M.addArc(sk, c.id, a.id, b.id);
  const screen: Parameters<typeof sketchFrameSelection>[1] = [2, 0, 0, 3, 100, 80];
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 102, y: 48 }, { x: 97, y: 52 }), []);
  assert.deepEqual(sketchFrameSelection(sk, screen, { x: 102, y: 108 }, { x: 97, y: 112 }), [arc.id]);
});

test('Skizze trimmen: Freigabe, Richtungsbezug und späterer Schnittpunkt', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const c = M.addPt(sk, 25, -11), d = M.addPt(sk, 25, 9);
  const target = M.addLine(sk, a.id, b.id, false), cutter = M.addLine(sk, c.id, d.id, true);
  const horizontal = M.addCon(sk, 'horizontal', [a.id, b.id]);
  const len = M.addCon(sk, 'distance', [target.id], { v: 40, expr: 'Breite' });
  const onLine = M.addCon(sk, 'pointOnLine', [M.addPt(sk, 8, 0).id, target.id]);
  const toLine = M.addCon(sk, 'distance', [M.addPt(sk, 6, 3).id, target.id], { v: 3 });
  const fixed = [a, c, d].map((p) => M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y }));
  const before = M.sketchJson(sk);
  const plan = planSketchTrim(sk, target.id, cutter.id, 'b')!;
  assert.deepEqual(plan.hit, { x: 25, y: 0 });
  assert.deepEqual(plan.removed.map((c) => c.id), [len.id]);
  assert.deepEqual(plan.rebind, [horizontal.id]);
  assert.equal(applySketchTrim(sk, target.id, cutter.id, 'b', new Set()), false);
  assert.equal(M.sketchJson(sk), before);
  assert.notEqual(applySketchTrim(sk, target.id, cutter.id, 'b', new Set([len.id])), false);
  const kept = M.entOf(sk, target.id);
  assert.ok(kept?.t === 'line');
  assert.equal(kept.a, a.id);
  assert.deepEqual(horizontal.r, [a.id, kept.b]);
  assert.equal(M.ptOf(sk, b.id), undefined);
  assert.ok(sk.cons.includes(onLine) && sk.cons.includes(toLine));
  fixed[1].x = fixed[2].x = 28;
  assert.ok(S.solveSketch(sk).ok);
  near(M.ptOf(sk, kept.b)!.x, 28);
  near(M.ptOf(sk, kept.b)!.y, 0);
  assert.equal(M.sketchSubs(sk).length, 1);
});

test('Skizze trimmen: ein geteilter Endpunkt und seine Bezüge bleiben erhalten', () => {
  const sk = M.emptySketch();
  const [a, b, c, d, e] = [[0, 0], [20, 0], [10, -10], [10, 10], [20, 8]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), cutter = M.addLine(sk, c.id, d.id);
  const shared = M.addLine(sk, b.id, e.id);
  const anchor = M.addCon(sk, 'fixed', [b.id], b);
  assert.equal(planSketchTrim(sk, line.id, shared.id, 'b'), null);
  assert.notEqual(applySketchTrim(sk, line.id, cutter.id, 'b', new Set()), false);
  assert.equal(M.ptOf(sk, b.id), b);
  assert.ok(sk.cons.includes(anchor));
  assert.deepEqual(M.entOf(sk, shared.id), shared);
});

test('Skizze trimmen: ein auf den Endpunkt gerundeter Schnitt verändert nichts', () => {
  const sk = M.emptySketch();
  const x = 1e16;
  const [a, b, c, d] = [[x, 0], [x + 2, 0], [x, -1], [x + 2, 1]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), cutter = M.addLine(sk, c.id, d.id);
  const before = M.sketchJson(sk);
  assert.equal(applySketchTrim(sk, line.id, cutter.id, 'b', new Set()), false);
  assert.equal(M.sketchJson(sk), before);
});

test('Skizze trimmen: ein von der Zielgeraden weg gerundeter Schnitt verändert nichts', () => {
  const sk = M.emptySketch();
  const y = 1e16;
  const [a, b, c, d] = [[0, y], [4, y + 2], [1, y - 2], [1, y + 4]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), cutter = M.addLine(sk, c.id, d.id);
  const before = M.sketchJson(sk);
  assert.equal(applySketchTrim(sk, line.id, cutter.id, 'b', new Set()), false);
  assert.equal(M.sketchJson(sk), before);
});

test('Skizze verlängern: nur das gewählte äußere Ende bis zum Schneidsegment', () => {
  const sk = M.emptySketch();
  const [a, b, c, d] = [[0, 2], [10, 2], [25, -4], [25, 12]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), cutter = M.addLine(sk, c.id, d.id, true);
  M.addCon(sk, 'horizontal', [line.id]);
  for (const p of [a, c, d]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  assert.equal(planSketchTrim(sk, line.id, cutter.id, 'a', 'extend'), null);
  assert.equal(planSketchTrim(sk, line.id, cutter.id, 'b'), null);
  assert.deepEqual(planSketchTrim(sk, line.id, cutter.id, 'b', 'extend')?.hit, { x: 25, y: 2 });
  assert.notEqual(applySketchTrim(sk, line.id, cutter.id, 'b', new Set(), 'extend'), false);
  assert.ok(S.solveSketch(sk).ok && line.t === 'line');
  near(M.ptOf(sk, line.b)!.x, 25);
  near(M.ptOf(sk, line.b)!.y, 2);
  const far = M.emptySketch();
  const [fa, fb, fc, fd] = [[1e15, 1e9], [10, 7e-7], [8.25, 0], [9.25, 0]].map(([x, y]) => M.addPt(far, x, y));
  const fl = M.addLine(far, fa.id, fb.id), cut = M.addLine(far, fc.id, fd.id);
  assert.equal(planSketchTrim(far, fl.id, cut.id, 'b', 'extend'), null);
});

test('Trimmen: Kreis schneidet Mittelstück einer Geraden; Länge und Maße der Vorlage bleiben', () => {
  const sk = M.emptySketch();
  const [a, b, c] = [[0, -16], [0, 16], [3, 0]].map(([x, y]) => M.addPt(sk, x, y));
  const l = M.addLine(sk, a.id, b.id), circle = M.addCircle(sk, c.id, 5);
  const size = M.addCon(sk, 'diameter', [circle.id], { v: 10 });
  const dim = M.addCon(sk, 'distance', [l.id], { v: 32 });
  M.addCon(sk, 'vertical', [l.id]);
  for (const p of [a, c]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  const span = pickTrimSpan(sk, l.id, { x: 0, y: 0 });
  assert.ok(span && 'from' in span.stroke);
  near(span.stroke.from.y, -4);
  near(span.stroke.to.y, 4);
  assert.notEqual(applyTrimSpan(sk, span), false);
  assert.ok(M.entOf(sk, l.id)?.aux);
  assert.ok(sk.cons.includes(dim));
  assert.ok(S.solveSketch(sk).ok);
  assert.equal(M.sketchSubs(sk).filter((p) => !p.closed).length, 2);
  size.v = 2 * Math.sqrt(45);
  assert.ok(S.solveSketch(sk).ok);
  const fresh = sk.pts.filter((p) => p.id > circle.id);
  near(Math.min(...fresh.map((p) => p.y)), -6);
  near(Math.max(...fresh.map((p) => p.y)), 6);
});

test('Trimmen: Geraden schneiden einen Kreisbogen aus einem Kreis', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 4, 0);
  const circle = M.addCircle(sk, c.id, 5);
  M.addCon(sk, 'diameter', [circle.id], { v: 10 });
  const [a, b] = [[2, -10], [2, 10]].map(([x, y]) => M.addPt(sk, x, y));
  M.addLine(sk, a.id, b.id);
  for (const p of [a, b, c]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  const span = pickTrimSpan(sk, circle.id, { x: -1, y: 0 });
  assert.ok(span && 'center' in span.stroke);
  assert.ok(span.stroke.end - span.stroke.start < Math.PI);
  applyTrimSpan(sk, span);
  const solved = S.solveSketch(sk);
  assert.ok(solved.ok && !solved.redundant.length);
  const arc = sk.ents.at(-1)!;
  assert.ok(arc.t === 'arc' && arc.a1 - arc.a0 > Math.PI);
  near(arc.r, 5);
  assert.ok(M.entOf(sk, circle.id)?.aux);
});

test('Trimmen: deckt der Kreis die ganze Rechteckkante zwischen ihren Endpunkten ab, bleibt kein Schnittrest', () => {
  const sk = M.emptySketch();
  M.addCenteredRectangle(sk, { x: -20, y: 0 }, 40, 8);
  const edge = sk.ents[1];
  assert.equal(pickTrimSpan(sk, edge.id, { x: 0, y: 0 }), undefined);
  const c = M.addPt(sk, 3, 0);
  M.addCircle(sk, c.id, 5);
  const span = pickTrimSpan(sk, edge.id, { x: 0, y: 0 });
  assert.ok(span && span.from.at === 0 && span.to.at === 1);
  const relations = sk.cons.length;
  applyTrimSpan(sk, span);
  assert.equal(sk.cons.length, relations);
  assert.ok(edge.aux);
  assert.ok(S.solveSketch(sk).ok);
  const open = M.sketchSubs(sk).find((p) => !p.closed);
  assert.equal(open?.nodes.length, 4);
});

test('Trimmen: vorhandener Bogen behält Radius ohne doppelte Beziehung', () => {
  const sk = M.emptySketch();
  const [c, a, b, p, q] = [[0, 0], [5, 0], [-5, 0], [2, 0], [2, 7]].map(([x, y]) => M.addPt(sk, x, y));
  const arc = M.addArc(sk, c.id, a.id, b.id);
  M.addLine(sk, p.id, q.id);
  for (const pt of [c, a, p, q]) M.addCon(sk, 'fixed', [pt.id], { x: pt.x, y: pt.y });
  M.addCon(sk, 'horizontal', [c.id, b.id]);
  const span = pickTrimSpan(sk, arc.id, a);
  assert.ok(span);
  applyTrimSpan(sk, span);
  const r = S.solveSketch(sk);
  assert.ok(r.ok && !r.redundant.length, JSON.stringify(r));
  assert.equal(sk.cons.filter((con) => con.t === 'equal').length, 0);
});

test('Trimmen: vorhandener Schneidendpunkt verbindet die sichtbaren Reststücke', () => {
  const sk = M.emptySketch();
  const [c, a, b] = [[0, 0], [-3, -4], [-3, 7]].map(([x, y]) => M.addPt(sk, x, y));
  const circle = M.addCircle(sk, c.id, 5);
  M.addLine(sk, a.id, b.id);
  const span = pickTrimSpan(sk, circle.id, { x: -5, y: 0 });
  assert.ok(span);
  applyTrimSpan(sk, span);
  assert.ok(S.solveSketch(sk).ok);
  assert.equal(M.sketchSubs(sk).length, 1);
  const [p, q] = [[-6, 0], [-4, 0]].map(([x, y]) => M.addPt(sk, x, y));
  const probe = M.addLine(sk, p.id, q.id);
  assert.equal(pickTrimSpan(sk, probe.id, { x: -5.5, y: 0 }), undefined);
});

test('Trimmen: überlappende Kreise behalten ihre Bemaßung, Berührungen schneiden nicht', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 18, 23), b = M.addPt(sk, 24, 23);
  const first = M.addCircle(sk, a.id, 5), second = M.addCircle(sk, b.id, 5);
  for (const p of [a, b]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  for (const e of [first, second]) M.addCon(sk, 'diameter', [e.id], { v: 10 });
  b.x = 28;
  assert.equal(pickTrimSpan(sk, first.id, { x: 23, y: 23 }), undefined);
  b.x = 18;
  assert.equal(pickTrimSpan(sk, first.id, { x: 23, y: 23 }), undefined);
  b.x = 24;
  const trim = pickTrimSpan(sk, first.id, { x: 23, y: 23 });
  assert.ok(trim && 'center' in trim.stroke && trim.stroke.end - trim.stroke.start < Math.PI);
  assert.notEqual(applyTrimSpan(sk, trim), false);
  assert.ok(first.aux && !second.aux);
  const solved = S.solveSketch(sk);
  assert.ok(solved.ok && !solved.redundant.length, JSON.stringify(solved));
  const arc = sk.ents.at(-1)!;
  assert.ok(arc.t === 'arc' && arc.a1 - arc.a0 > Math.PI);
  for (const id of [arc.s, arc.e]) {
    const p = M.ptOf(sk, id)!;
    near(p.x, 21);
    near(Math.abs(p.y - 23), 4);
  }
  const reverse = pickTrimSpan(sk, second.id, { x: 19, y: 23 });
  assert.ok(reverse);
  applyTrimSpan(sk, reverse);
  const again = S.solveSketch(sk);
  assert.ok(again.ok && !again.redundant.length, JSON.stringify(again));
  assert.equal(M.sketchSubs(sk).length, 1);
  assert.ok(M.sketchSubs(sk)[0].closed);
});

test('Trimmen: nur Schnittpunkte auf dem vorhandenen Kreisbogen zählen', () => {
  const sk = M.emptySketch();
  const [a, b, c, d, e] = [[0, 0], [6, 0], [11, 0], [1, 0], [-5, 0]].map(([x, y]) => M.addPt(sk, x, y));
  const target = M.addArc(sk, a.id, e.id, M.addPt(sk, 5, 0).id);
  // The cutter sweeps the upper half, so only the upper intersection can split the target.
  const cutter = M.addArc(sk, b.id, d.id, c.id);
  const plan = pickTrimSpan(sk, target.id, { x: -4, y: -3 });
  assert.ok(plan && plan.from.at === 0 && plan.to.cutter === cutter.id);
  assert.equal(pickTrimSpan(sk, target.id, { x: 0, y: 5 }), undefined);
});

test('Verlängern: die nähere Kante am Endpunkt wird nicht übersprungen', () => {
  const sk = M.emptySketch();
  const [a, b, c, d, e, f] = [[0, 0], [10, 0], [15, 0], [15, 5], [25, -5], [25, 5]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), nearEdge = M.addLine(sk, c.id, d.id);
  M.addLine(sk, e.id, f.id);
  const plan = pickSketchExtend(sk, line.id, b);
  assert.equal(plan?.cutter, nearEdge.id);
  assert.notEqual(applySketchTrim(sk, line.id, nearEdge.id, 'b', new Set(), 'extend'), false);
  assert.ok(line.t === 'line' && line.b === c.id);
  assert.equal(sk.cons.length, 0);
});

test('Bogenteilung: gewählter Winkelanteil bleibt nach Speichern, Radius- und Endwinkeländerung erhalten', () => {
  const sk = M.emptySketch(), c = M.addPt(sk, 0, 0);
  const a = M.addPt(sk, 0, 10), b = M.addPt(sk, 10, 0);
  const arc = M.addArc(sk, c.id, a.id, b.id);
  M.addCon(sk, 'fixed', [c.id], { x: 0, y: 0 });
  const ray = M.addLine(sk, c.id, a.id, true), endRay = M.addLine(sk, c.id, b.id, true);
  M.addCon(sk, 'vertical', [ray.id]);
  const angle = M.addCon(sk, 'angle', [ray.id, endRay.id], { v: 90 });
  const radius = M.addCon(sk, 'radius', [arc.id], { v: 10 });
  assert.equal(S.solveSketch(sk).dof, 0);
  assert.equal(planSketchSplit(sk, arc.id, { x: 7, y: 7 }), undefined);
  const plan = planSketchSplit(sk, arc.id, { x: -10, y: 0 })!;
  near(plan.fraction, 1 / 3);
  assert.notEqual(applySketchSplit(sk, arc.id, undefined, plan), false);
  const reloaded = M.parseSketch(M.sketchJson(sk));
  reloaded.cons.find((c) => c.id === radius.id)!.v = 16;
  reloaded.cons.find((c) => c.id === angle.id)!.v = 108;
  const result = S.solveSketch(reloaded);
  assert.ok(result.ok && !result.redundant.length && result.dof === 0, JSON.stringify(result));
  const spans = reloaded.ents.filter((e) => e.t === 'arc' && !e.aux);
  const original = reloaded.ents.find((e) => e.id === arc.id);
  assert.ok(original?.t === 'arc' && original.aux);
  assert.equal(spans.length, 2);
  near(spans[0].r, 16);
  near((spans[0].a1 - spans[0].a0) / (original.a1 - original.a0), 1 / 3);
  assert.equal(spans[0].e, spans[1].s);
  assert.equal(M.sketchSubs(reloaded).length, 1);
  original.aux = false;
  assert.equal(S.solveSketch(reloaded).invalidGeometry, true);
  original.aux = true;
  M.deleteIds(reloaded, [spans[0].id]);
  assert.ok(S.solveSketch(reloaded).ok);
});

test('Aufteilen: Mittelpunkt folgt der bemaßten Geraden, der Ausgabeumriss bleibt verbunden', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 12, 18), b = M.addPt(sk, 42, 18);
  const line = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'fixed', [a.id], { x: a.x, y: a.y });
  M.addCon(sk, 'horizontal', [line.id]);
  const distance = M.addCon(sk, 'distance', [line.id], { v: 30 });
  const before = M.sketchJson(sk);
  const plan = planSketchSplit(sk, line.id)!;
  near(plan.splitAt.x, 27);
  assert.equal(M.sketchJson(sk), before);
  assert.notEqual(applySketchSplit(sk, line.id), false);
  assert.equal(applySketchSplit(sk, line.id), false);
  const restored = M.parseSketch(M.sketchJson(sk));
  assert.equal(restored.ents.filter((e) => !e.aux).length, 2);
  restored.cons.find((c) => c.id === distance.id)!.v = 60;
  const solved = S.solveSketch(restored);
  assert.ok(solved.ok && !solved.redundant.length, JSON.stringify(solved));
  const paths = M.sketchSubs(restored);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].nodes.length, 3);
  near(paths[0].nodes[1].x, 42);
  near(paths[0].nodes[2].x, 72);
  restored.cons.find((c) => c.id === distance.id)!.v = 5;
  assert.ok(S.solveSketch(restored).ok);
  assert.deepEqual(M.sketchSubs(restored)[0].nodes.map((p) => Math.round(p.x * 2) / 2), [12, 14.5, 17]);
});

test('Verlängern: nur der sichtbare Bogen zählt und der Endpunkt folgt seinem Radius', () => {
  const sk = M.emptySketch();
  const [a, b, c, s, e] = [[0, 0], [10, 0], [25, 0], [25, -5], [25, 5]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id);
  const arc = M.addArc(sk, c.id, s.id, e.id);
  M.addCon(sk, 'horizontal', [line.id]);
  for (const p of [a, c]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  M.addCon(sk, 'vertical', [s.id, c.id]);
  M.addCon(sk, 'vertical', [e.id, c.id]);
  const radius = M.addCon(sk, 'radius', [arc.id], { v: 5 });
  const plan = pickSketchExtend(sk, line.id, b);
  assert.ok(plan && plan.cutter === arc.id);
  near(plan.hit.x, 30); // The nearer crossing at x=20 belongs to the missing semicircle.
  assert.notEqual(applySketchTrim(sk, line.id, arc.id, 'b', new Set(), 'extend'), false);
  assert.ok(line.t === 'line');
  assert.ok(sk.cons.some((c) => c.t === 'pointOnCircle' && c.r[0] === line.b && c.r[1] === arc.id));
  radius.v = 8;
  const solved = S.solveSketch(sk);
  assert.ok(solved.ok && !solved.redundant.length, JSON.stringify(solved));
  near(M.ptOf(sk, line.b)!.x, 33);
});

test('Tangentialkontakt einer Geraden ist ein Verlängerungsziel, aber keine Trimmgrenze', () => {
  const sk = M.emptySketch();
  const [a, b, c] = [[-4, -3], [0, 0], [1, 7]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id), circle = M.addCircle(sk, c.id, 5);
  const hit = planSketchTrim(sk, line.id, circle.id, 'b', 'extend')?.hit;
  assert.ok(hit);
  near(hit.x, 4);
  near(hit.y, 3);
  b.x = 8;
  b.y = 6;
  assert.equal(pickTrimSpan(sk, line.id, { x: 6, y: 4.5 }), undefined);
});

test('unterbestimmt: Freiheitsgrade werden gemeldet', () => {
  const sk = M.emptySketch();
  roughRect(sk);
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 8);
});

test('Mittelpunktrechteck: bemaßt, größenänderbar und ohne Hilfsdiagonale im Umriss', () => {
  const sk = M.emptySketch();
  const center = { x: 42, y: -7 };
  assert.equal(M.addCenteredRectangle(sk, center, 60, 0), false);
  assert.equal(M.addCenteredRectangle(sk, { x: 1e20, y: 0 }, 1, 1), false);
  assert.deepEqual(sk, M.emptySketch());
  M.addCenteredRectangle(sk, center, 60, 40);
  for (const width of [60, 80]) {
    sk.cons.find((c) => c.t === 'distance')!.v = width;
    const r = S.solveSketch(sk);
    assert.ok(r.ok);
    assert.equal(r.dof, 0);
    const subs = M.sketchSubs(sk);
    assert.equal(subs.length, 1);
    assert.ok(subs[0].closed);
    assert.equal(subs[0].nodes.length, 4);
    const xs = subs[0].nodes.map(({ x }) => x);
    const ys = subs[0].nodes.map(({ y }) => y);
    near(Math.min(...xs), center.x - width / 2);
    near(Math.max(...xs), center.x + width / 2);
    near(Math.min(...ys), center.y - 20);
    near(Math.max(...ys), center.y + 20);
  }
});

test('Widerspruch: Beziehungen werden genannt, die Skizze bleibt unverändert', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'fixed', [p[0].id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [p[1].id], { x: 20, y: 0 });
  const c = M.addCon(sk, 'distance', [l[0].id], { v: 10 });
  const before = JSON.stringify(sk.pts);
  const r = S.solveSketch(sk);
  assert.ok(!r.ok);
  assert.ok(r.conflicting.includes(c.id), JSON.stringify(r));
  assert.equal(JSON.stringify(sk.pts), before);
});

test('parallel, senkrecht, gleich lang, Winkel', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 1), c = M.addPt(sk, 0, 10), d = M.addPt(sk, 8, 13);
  const l1 = M.addLine(sk, a.id, b.id), l2 = M.addLine(sk, c.id, d.id);
  M.addCon(sk, 'parallel', [l1.id, l2.id]);
  M.addCon(sk, 'equal', [l1.id, l2.id]);
  assert.ok(S.solveSketch(sk).ok);
  const len = (l: typeof l1) => M.measureCon(sk, { id: 0, t: 'distance', r: [l.id] })!;
  near(len(l1), len(l2), 1e-6);
  near(M.measureCon(sk, { id: 0, t: 'angle', r: [l1.id, l2.id] })! % 180, 0, 1e-5);
  const sk2 = M.emptySketch();
  const p = [M.addPt(sk2, 0, 0), M.addPt(sk2, 10, 0), M.addPt(sk2, 10, 0.1), M.addPt(sk2, 14, 9)];
  const m1 = M.addLine(sk2, p[0].id, p[1].id), m2 = M.addLine(sk2, p[2].id, p[3].id);
  M.addCon(sk2, 'coincident', [p[1].id, p[2].id]);
  M.addCon(sk2, 'angle', [m1.id, m2.id], { v: 60 });
  assert.ok(S.solveSketch(sk2).ok);
  near(M.measureCon(sk2, { id: 0, t: 'angle', r: [m1.id, m2.id] })!, 60, 1e-5);
  // über Koinzidenz verbundene Linien bilden einen Zug
  const subs = M.sketchSubs(sk2);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].nodes.length, 3);
});

test('Kreise: Radius, Durchmesser, konzentrisch, tangential an Linie', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 20, 20), c2 = M.addPt(sk, 22, 19);
  const k1 = M.addCircle(sk, c1.id, 9), k2 = M.addCircle(sk, c2.id, 3);
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 2);
  const l = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'radius', [k1.id], { v: 10 });
  M.addCon(sk, 'diameter', [k2.id], { v: 4 });
  M.addCon(sk, 'concentric', [k1.id, k2.id]);
  M.addCon(sk, 'horizontal', [l.id]);
  M.addCon(sk, 'tangent', [l.id, k1.id]);
  assert.ok(S.solveSketch(sk).ok);
  const p1 = M.ptOf(sk, c1.id)!, p2 = M.ptOf(sk, c2.id)!;
  near(p1.x, p2.x, 1e-6);
  near(p1.y, p2.y, 1e-6);
  near((M.entOf(sk, k1.id) as { r: number }).r, 10, 1e-6);
  near((M.entOf(sk, k2.id) as { r: number }).r, 2, 1e-6);
  near(Math.abs(p1.y - M.ptOf(sk, a.id)!.y), 10, 1e-6);
  // Umriss: Kreise als Kreise erkennbar
  const arcs = findArcs(M.sketchSubs(sk));
  assert.equal(arcs.filter((x) => x.full).length, 2);
});

test('Eckenbearbeitung: Fase und Rundung behalten Rechteckmaße und verwerfen zu große Werte', () => {
  for (const rounded of [false, true]) {
    const sk = M.emptySketch();
    M.addCenteredRectangle(sk, { x: 20, y: 15 }, 40, 30);
    const side = sk.ents[0];
    const original = sk.cons.filter((c) => c.t === 'distance').map((c) => c.id);
    assert.equal(planSketchCorner(sk, side.id, 'a', 30, rounded), undefined);
    const plan = planSketchCorner(sk, side.id, 'a', 5, rounded);
    assert.ok(plan);
    assert.notEqual(applySketchCorner(sk, plan), false);
    const parsed = M.parseSketch(M.sketchJson(sk));
    const body = parsed.ents.find((e) => e.cornerBounds)!;
    const { dimension, rays } = body.cornerBounds!;
    const dim = parsed.cons.find((c) => c.id === dimension)!;
    const first = S.solveSketch(parsed);
    assert.ok(first.ok && first.dof === 0 && !first.redundant.length, JSON.stringify(first));
    if (body.t === 'arc') { near(body.r, 5); near(body.a1 - body.a0, Math.PI / 2); }
    const subs = M.sketchSubs(parsed);
    assert.equal(subs.length, 1);
    assert.ok(subs[0].closed);
    dim.v = 8;
    assert.ok(S.solveSketch(parsed).ok);
    for (const [corner, , cut] of rays) {
      const a = M.ptOf(parsed, corner)!, b = M.ptOf(parsed, cut)!;
      near(Math.hypot(a.x - b.x, a.y - b.y), 8);
    }
    assert.deepEqual(original.map((id) => parsed.cons.find((c) => c.id === id)?.v), [40, 30]);
    dim.v = 35;
    const before = JSON.stringify(parsed.pts);
    assert.equal(S.solveSketch(parsed).ok, false);
    assert.equal(JSON.stringify(parsed.pts), before);
  }
});

test('Eckenbearbeitung: Rücksprung darf eine konkave Kontur nicht kreuzen', () => {
  for (const rounded of [false, true]) {
    const sk = M.emptySketch();
    const points = [[0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10]].map(([x, y]) => M.addPt(sk, x, y));
    const sides = points.map((p, i) => M.addLine(sk, p.id, points[(i + 1) % points.length].id));
    for (const p of points) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
    const big = M.cloneSketch(sk);
    applySketchCorner(big, planSketchCorner(big, sides[0].id, 'a', 5, rounded)!);
    assert.equal(S.solveSketch(big).ok, false);
    applySketchCorner(sk, planSketchCorner(sk, sides[0].id, 'a', 0.5, rounded)!);
    assert.ok(S.solveSketch(sk).ok);
    const dim = sk.ents.find((e) => e.cornerBounds)!.cornerBounds!.dimension;
    sk.cons.find((c) => c.id === dim)!.v = 5;
    const before = JSON.stringify(sk.pts);
    assert.equal(S.solveSketch(sk).ok, false);
    assert.equal(JSON.stringify(sk.pts), before);
  }
});

test('Eckenbearbeitung: Rundung darf einen vorhandenen Kreis nicht überdecken', () => {
  const sk = M.emptySketch();
  const [a, b, c, center] = [[0, 0], [10, 0], [0, 10], [2, 2]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id);
  M.addLine(sk, a.id, c.id);
  const circle = M.addCircle(sk, center.id, 2);
  M.addCon(sk, 'diameter', [circle.id], { v: 4 });
  for (const p of [a, b, c, center]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  const plan = planSketchCorner(sk, line.id, 'a', 2, true);
  assert.ok(plan);
  applySketchCorner(sk, plan);
  const result = S.solveSketch(sk);
  assert.equal(result.invalidGeometry, true, JSON.stringify(result));
});

test('Eckenbearbeitung: zur Geraden kollabierende Fase wird abgewiesen', () => {
  const sk = M.emptySketch();
  const [a, b, c] = [[0, 0], [10, 0], [0, 10]].map(([x, y]) => M.addPt(sk, x, y));
  const line = M.addLine(sk, a.id, b.id);
  M.addLine(sk, a.id, c.id);
  const [, , change] = [a, b, c].map((p) => M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y }));
  applySketchCorner(sk, planSketchCorner(sk, line.id, 'a', 2, false)!);
  assert.ok(S.solveSketch(sk).ok);
  const old = JSON.stringify(sk.pts);
  change.x = 20; change.y = 0;
  assert.equal(S.solveSketch(sk).ok, false);
  assert.equal(JSON.stringify(sk.pts), old);
});

test('Polygon: regelmäßige Kontur bleibt beim Ändern des Umkreisradius erhalten', () => {
  for (const n of [3, 5, 6, 24]) {
    const sk = M.emptySketch();
    const center = { x: 30, y: 27 };
    assert.notEqual(addSketchPolygon(sk, center, { x: 46, y: 32 }, n), false);
    const radius = sk.cons.find((c) => c.t === 'radius')!;
    radius.v = 12;
    const r = S.solveSketch(sk);
    assert.ok(r.ok && !r.redundant.length, `${n}: ${JSON.stringify(r)}`);
    const [outline] = M.sketchSubs(sk);
    assert.ok(outline.closed);
    assert.equal(outline.nodes.length, n);
    const length = 24 * Math.sin(Math.PI / n);
    outline.nodes.forEach((p, i) => {
      const next = outline.nodes[(i + 1) % n];
      near(Math.hypot(p.x - center.x, p.y - center.y), 12);
      near(Math.hypot(next.x - p.x, next.y - p.y), length);
    });
  }
});

test('Polygon: Solver verwirft einen gleichseitigen Stern', () => {
  const sk = M.emptySketch();
  addSketchPolygon(sk, { x: 0, y: 0 }, { x: 20, y: 0 }, 5);
  const circle = sk.ents.find((e) => e.t === 'circle')!;
  circle.polygon!.vertices.forEach((id, i) => {
    const point = M.ptOf(sk, id)!;
    point.x = 20 * Math.cos(i * 4 * Math.PI / 5);
    point.y = 20 * Math.sin(i * 4 * Math.PI / 5);
  });
  const before = M.sketchJson(sk);
  assert.equal(S.solveSketch(sk).invalidGeometry, true);
  assert.equal(M.sketchJson(sk), before);
});

test('Polygon umschrieben: Kantenmitten liegen auf dem Radius, Ecken auf Radius/cos', () => {
  const sk = M.emptySketch();
  const center = { x: 30, y: 27 }, rim = { x: 42, y: 27 };
  assert.notEqual(addSketchPolygon(sk, center, rim, 6, undefined, undefined, 'circumscribed'), false);
  const circle = sk.ents.find((e) => e.t === 'circle')!;
  assert.ok(circle.t === 'circle');
  near(circle.r, 12);
  const r = S.solveSketch(sk);
  assert.ok(r.ok && !r.redundant.length, JSON.stringify(r));
  const outer = 12 / Math.cos(Math.PI / 6);
  const pts = circle.polygon!.vertices.map((id) => M.ptOf(sk, id)!);
  assert.equal(pts.length, 6);
  pts.forEach((p, i) => {
    near(Math.hypot(p.x - center.x, p.y - center.y), outer);
    const q = pts[(i + 1) % pts.length];
    near(Math.hypot((p.x + q.x) / 2 - center.x, (p.y + q.y) / 2 - center.y), 12);
  });
  const [outline] = M.sketchSubs(sk);
  assert.ok(outline.closed);
  assert.equal(outline.nodes.length, 6);
});

test('Polygon Kante: zwei Klicks bestimmen die erste Kante exakt', () => {
  const sk = M.emptySketch();
  assert.notEqual(addSketchPolygon(sk, { x: 0, y: 0 }, { x: 10, y: 0 }, 4, undefined, undefined, 'edge'), false);
  const circle = sk.ents.find((e) => e.t === 'circle')!;
  assert.ok(circle.t === 'circle');
  near(M.ptOf(sk, circle.c)!.x, 5);
  near(M.ptOf(sk, circle.c)!.y, 5);
  near(circle.r, 5);
  const r = S.solveSketch(sk);
  assert.ok(r.ok && !r.redundant.length, JSON.stringify(r));
  const pts = circle.polygon!.vertices.map((id) => M.ptOf(sk, id)!);
  assert.equal(pts.length, 4);
  near(pts[0].x, 0); near(pts[0].y, 0);
  near(pts[1].x, 10); near(pts[1].y, 0);
  const [outline] = M.sketchSubs(sk);
  assert.ok(outline.closed);
  const sorted = [...outline.nodes].sort((a, b) => a.x - b.x || a.y - b.y);
  assert.deepEqual(sorted.map(({ x, y }) => [Math.round(x), Math.round(y)]), [[0, 0], [0, 10], [10, 0], [10, 10]]);
});

test('Polygon Standard: Default ist byte-identisch zu einbeschrieben', () => {
  const plain = M.emptySketch(), explicit = M.emptySketch();
  assert.notEqual(addSketchPolygon(plain, { x: 30, y: 27 }, { x: 46, y: 32 }, 6), false);
  assert.notEqual(addSketchPolygon(explicit, { x: 30, y: 27 }, { x: 46, y: 32 }, 6, undefined, undefined, 'inscribed'), false);
  assert.equal(M.sketchJson(plain), M.sketchJson(explicit));
  const circle = plain.ents.find((e) => e.t === 'circle')!;
  assert.ok(circle.t === 'circle');
  assert.deepEqual(plain.cons.filter((c) => c.t === 'pointOnCircle').length, 6);
  assert.deepEqual(plain.cons.filter((c) => c.t === 'equal').length, 5);
});

test('Polygon Werkzeug: ein Polygon ist genau ein Undo-Schritt', () => {
  for (const mode of [undefined, 'edge'] as const) {
    const sk = M.emptySketch();
    const { ed, snapshots } = circleTool(sk);
    ed.setSketchTool('polygon');
    if (mode) ed.sketchEdit!.polygonMode = mode;
    ed.sketchShapePlacementClick({ x: 30, y: 27 }, null);
    ed.sketchShapePlacementClick(mode === 'edge' ? { x: 42, y: 27 } : { x: 42, y: 27 }, null);
    assert.equal(snapshots.length, 1, mode ?? 'inscribed');
    assert.ok(sk.ents.some((e) => e.t === 'circle' && Array.isArray(e.polygon?.vertices)));
  }
});

test('Präzises Verschieben: vollständige Auswahl bewahrt Maße und Hilfsgeometrie', () => {
  const sk = M.emptySketch();
  M.addCenteredRectangle(sk, { x: 20, y: 10 }, 30, 12);
  const other = M.addPt(sk, 99, 20);
  M.addCircle(sk, other.id, 2);
  const before = M.sketchJson(sk);
  assert.equal(translateSketchSelection(sk, new Set([sk.ents[0].id]), { x: -4, y: 21 }), false);
  assert.equal(M.sketchJson(sk), before);
  const lines = new Set(sk.ents.filter((e) => e.t === 'line' && !e.aux).map((e) => e.id));
  assert.notEqual(translateSketchSelection(sk, lines, { x: -4, y: 21 }), false);
  assert.ok(S.solveSketch(sk).ok);
  const old = M.parseSketch(before);
  for (const p of old.pts) {
    const q = M.ptOf(sk, p.id)!;
    near(q.x, p.x - (p.id === other.id ? 0 : 4));
    near(q.y, p.y + (p.id === other.id ? 0 : 21));
  }
  assert.deepEqual(sk.cons.filter((c) => c.t === 'distance'), old.cons.filter((c) => c.t === 'distance'));
});

test('Freier Teilpunkt folgt Länge, Richtung und Verschiebung der Ursprungslinie', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 20, -10), b = M.addPt(sk, 50, 10);
  const line = M.addLine(sk, a.id, b.id);
  const fa = M.addCon(sk, 'fixed', [a.id], { x: a.x, y: a.y }), fb = M.addCon(sk, 'fixed', [b.id], { x: b.x, y: b.y });
  assert.notEqual(applySketchSplit(sk, line.id, { x: 27.5, y: -5 }), false);
  const saved = M.parseSketch(M.sketchJson(sk));
  Object.assign(saved.cons.find((c) => c.id === fa.id)!, { x: -2, y: 12 });
  Object.assign(saved.cons.find((c) => c.id === fb.id)!, { x: -10, y: 8 });
  const joint = saved.cons.find((c) => c.t === 'segmentFraction')!;
  near(joint.v!, 0.25);
  const result = S.solveSketch(saved);
  assert.ok(result.ok && result.dof === 0 && !result.redundant.length, JSON.stringify(result));
  const p = M.ptOf(saved, joint.r[0])!;
  assert.ok(Math.hypot(p.x + 4, p.y - 11) < 1e-6, JSON.stringify(saved.pts));
  assert.equal(M.sketchSubs(saved).length, 1);
  Object.assign(saved.cons.find((c) => c.id === fb.id)!, { x: -2 - 1e-7, y: 12 });
  const pointsBefore = JSON.stringify(saved.pts);
  assert.equal(S.solveSketch(saved).ok, false);
  assert.equal(JSON.stringify(saved.pts), pointsBefore);
});

test('Innenversatz: zwei getrennte Konturen, keine Änderung während der Vorschau', () => {
  const sk = M.emptySketch();
  const outline = [[0, 0], [14, 0], [14, 5], [24, 5], [24, 0], [38, 0], [38, 14], [24, 14], [24, 9], [14, 9], [14, 14], [0, 14]];
  const points = outline.map(([x, y]) => M.addPt(sk, x, y));
  const sides = points.map((p, i) => M.addLine(sk, p.id, points[(i + 1) % points.length].id));
  const before = M.sketchJson(sk);
  assert.equal(planSplitInset(sk, sides[0].id, { x: 7, y: 1 }), undefined);
  assert.equal(planSplitInset(sk, sides[0].id, { x: 7, y: -3 }), undefined);
  assert.equal(planSplitInset(sk, sides[0].id, { x: 7, y: 8 }), undefined);
  const plan = planSplitInset(sk, sides[0].id, { x: 7, y: 3 });
  assert.ok(plan);
  assert.equal(plan.contours.length, 2);
  assert.deepEqual(plan.contours.map((p) => [Math.min(...p.map((v) => v.x)), Math.max(...p.map((v) => v.x))]).sort((a, b) => a[0] - b[0]), [[3, 11], [27, 35]]);
  assert.equal(M.sketchJson(sk), before);
  addSplitInset(sk, plan);
  assert.ok(S.solveSketch(sk).ok);
  const reopened = M.parseSketch(M.sketchJson(sk));
  const output = M.sketchSubs(reopened);
  assert.equal(output.length, 3);
  assert.ok(output.every((p) => p.closed));
  assert.deepEqual(reopened.pts.slice(0, points.length).map(({ x, y }) => [x, y]), outline);
});

test('Konturversatz: Langloch bleibt ein exakter geschlossener Linien-/Bogenzug', () => {
  for (const [radius, fromArc] of [[3, false], [7, true]] as const) {
    const sk = M.emptySketch();
    addSketchSlot(sk, { x: 0, y: 0 }, 20, false, 10);
    assert.ok(S.solveSketch(sk).ok);
    const base = sk.ents.find((e) => e.t === (fromArc ? 'arc' : 'line'))!;
    const p = fromArc ? { x: -radius, y: 0 } : { x: 10, y: -radius };
    const preview = planSmoothOffset(sk, base.id, p);
    assert.ok(preview);
    assert.equal(M.sketchSubs(preview).length, 1);
    assert.ok(M.sketchSubs(preview)[0].closed);
    assert.notEqual(addSmoothOffset(sk, base.id, p), false);
    const result = S.solveSketch(sk);
    assert.ok(result.ok && result.dof === 0 && !result.redundant.length, JSON.stringify(result));
    const arcs = sk.ents.filter((e) => e.t === 'arc' && e.smoothOffset);
    assert.equal(arcs.length, 2);
    for (const arc of arcs) { near(arc.r, radius); near(arc.a1 - arc.a0, Math.PI); }
    const saved = M.parseSketch(M.sketchJson(sk));
    assert.equal(M.sketchSubs(saved).filter((s) => s.closed).length, 2);
    saved.cons.find((c) => c.t === 'diameter')!.v = 12;
    saved.cons.find((c) => c.t === 'hdistance')!.v = 26;
    const resized = S.solveSketch(saved);
    assert.ok(resized.ok && !resized.redundant.length, JSON.stringify(resized));
    for (const arc of saved.ents.filter((e) => e.t === 'arc' && e.smoothOffset)) near(arc.r, radius + 1);
    const offset = saved.cons.find((c) => c.id === arcs[0].smoothOffset!.dimension)!;
    offset.v = 3;
    assert.ok(S.solveSketch(saved).ok);
    for (const arc of saved.ents.filter((e) => e.t === 'arc' && e.smoothOffset)) near(arc.r, fromArc ? 9 : 3);
    const before = M.sketchJson(sk);
    assert.equal(addSmoothOffset(sk, base.id, { x: 0, y: 0 }), false);
    assert.equal(M.sketchJson(sk), before);
  }
});



test('Kreisversatz: bleibt nach Neuöffnung verbunden und kollabiert nicht', () => {
  const sk = M.emptySketch();
  const p = M.addPt(sk, 20, 30), source = M.addCircle(sk, p.id, 10);
  M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  M.addCon(sk, 'radius', [source.id], { v: 10 });
  assert.notEqual(addSketchCircleOffset(sk, source.id, { x: 27, y: 30 }), false);
  assert.notEqual(addSketchCircleOffset(sk, source.id, { x: 34, y: 30 }), false);
  const saved = M.parseSketch(M.sketchJson(sk));
  const dim = saved.cons.find((c) => c.t === 'radius')!;
  dim.v = 12;
  const result = S.solveSketch(saved);
  assert.ok(result.ok && result.dof === 0 && !result.redundant.length, JSON.stringify(result));
  assert.deepEqual(saved.ents.filter((e) => e.t === 'circle').map((e) => Math.round(e.r)), [12, 9, 16]);
  dim.v = 2;
  const before = M.sketchJson(saved);
  assert.equal(S.solveSketch(saved).invalidGeometry, true);
  assert.equal(M.sketchJson(saved), before);
});


test('Rundrechteck: ein Radius steuert vier Ecken und bleibt an den Hauptmaßen gebunden', () => {
  const sk = M.emptySketch();
  assert.notEqual(addRoundedSketchRectangle(sk, { x: 10, y: 15 }, 30, 20, 4), false);
  const saved = M.parseSketch(M.sketchJson(sk));
  const radius = saved.cons.find((c) => c.t === 'radius')!;
  assert.equal(saved.cons.filter((c) => c.t === 'radius').length, 1);
  saved.cons.find((c) => c.t === 'distance' && c.v === 30)!.v = 36;
  radius.v = 6;
  const r = S.solveSketch(saved);
  assert.ok(r.ok && !r.redundant.length, JSON.stringify(r));
  const paths = M.sketchSubs(saved);
  assert.equal(paths.length, 1); assert.ok(paths[0].closed);
  const arcs = saved.ents.filter((e) => e.t === 'arc');
  assert.equal(arcs.length, 4);
  arcs.forEach((arc) => { near(arc.r, 6); near(arc.a1 - arc.a0, Math.PI / 2); });
  radius.v = 10;
  assert.equal(S.solveSketch(saved).ok, false);
});

test('Schräges Langloch: Richtung, Länge und Breite bleiben nach Wiederöffnung editierbar', () => {
  const sk = M.emptySketch(), a = { x: 10, y: 20 }, b = { x: 26, y: 32 };
  assert.deepEqual(sketchSlotAxis(a, { x: 26, y: 20.2 }, 0.5), { x: 26, y: 20 });
  near(sketchSlotWidth(a, b, { x: 7.6, y: 23.2 }), 8);
  assert.notEqual(addOrientedSketchSlot(sk, a, b, 8), false);
  const saved = M.parseSketch(M.sketchJson(sk));
  saved.cons.find((c) => c.t === 'distance')!.v = 32;
  saved.cons.find((c) => c.t === 'diameter')!.v = 10;
  saved.cons.find((c) => c.t === 'angle')!.v = 60;
  const solved = S.solveSketch(saved);
  assert.ok(solved.ok && solved.dof === 0 && !solved.redundant.length, JSON.stringify(solved));
  const arcs = saved.ents.filter((e) => e.t === 'arc');
  near(M.ptOf(saved, arcs[1].c)!.x, 26);
  near(M.ptOf(saved, arcs[1].c)!.y, 20 + 16 * Math.sqrt(3));
  arcs.forEach((e) => { near(e.r, 5); near(e.a1 - e.a0, Math.PI); });
  assert.equal(M.sketchSubs(saved).length, 1);
  assert.ok(M.sketchSubs(saved)[0].closed);
});

test('Schräges Langloch: gefangener Endmittelpunkt bestimmt Länge und Richtung ohne Zusatzmaß', () => {
  const sk = M.emptySketch(), a = { x: 0, y: 0 }, b = M.addPt(sk, 18, 8);
  const fix = M.addCon(sk, 'fixed', [b.id], { x: b.x, y: b.y });
  assert.notEqual(addOrientedSketchSlot(sk, a, b, 6, null, b.id), false);
  assert.deepEqual(sk.cons.filter((c) => M.isDim(c.t)).map((c) => c.t), ['diameter']);
  fix.x = 19; fix.y = 16;
  const r = S.solveSketch(sk);
  assert.ok(r.ok && r.dof === 0 && !r.redundant.length, JSON.stringify(r));
  const arc = sk.ents.find((e) => e.t === 'arc' && e.c === b.id)!;
  near(arc.r, 3); near(arc.a1 - arc.a0, Math.PI);
  assert.ok(M.sketchSubs(sk)[0].closed);
});

test('Langloch: Breite und Mittelpunktsabstand bleiben unabhängig bearbeitbar', () => {
  for (const [delta, vertical] of [[24, false], [-24, true]] as const) {
    const sk = M.emptySketch();
    assert.notEqual(addSketchSlot(sk, { x: 12, y: 27 }, delta, vertical, 8), false);
    const saved = M.parseSketch(M.sketchJson(sk));
    saved.cons.find((c) => c.t === 'diameter')!.v = 10;
    saved.cons.find((c) => c.t === (vertical ? 'vdistance' : 'hdistance'))!.v = 32;
    const r = S.solveSketch(saved);
    assert.ok(r.ok && r.dof === 0 && !r.redundant.length, JSON.stringify(r));
    const paths = M.sketchSubs(saved);
    assert.equal(paths.length, 1);
    assert.ok(paths[0].closed);
    const arcs = saved.ents.filter((e) => e.t === 'arc');
    for (const arc of arcs) { near(arc.r, 5); near(arc.a1 - arc.a0, Math.PI); }
    const [a, b] = arcs.map((arc) => M.ptOf(saved, arc.c)!);
    near(Math.hypot(b.x - a.x, b.y - a.y), 32);
  }
});

test('Langloch aus zwei Bögen und zwei Linien: geschlossener Umriss, tangential', () => {
  const sk = M.emptySketch();
  const c1 = M.addPt(sk, 0, 0), c2 = M.addPt(sk, 20, 0);
  const t1 = M.addPt(sk, 0, -5), b1 = M.addPt(sk, 0, 5), t2 = M.addPt(sk, 20, -5), b2 = M.addPt(sk, 20, 5);
  // Bogen links von unten (b1, Winkel 90°) über links (180°) nach oben (t1, 270°)
  const a1 = M.addArc(sk, c1.id, b1.id, t1.id);
  const a2 = M.addArc(sk, c2.id, t2.id, b2.id);
  const top = M.addLine(sk, t1.id, t2.id), bot = M.addLine(sk, b2.id, b1.id);
  M.addCon(sk, 'tangent', [top.id, a1.id]);
  M.addCon(sk, 'tangent', [bot.id, a2.id]);
  M.addCon(sk, 'radius', [a1.id], { v: 4 });
  M.addCon(sk, 'equal', [a1.id, a2.id]);
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
  const subs = M.sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.ok(subs[0].closed);
  const arcs = findArcs(subs).filter((x) => !x.full);
  assert.equal(arcs.length, 2);
  for (const x of arcs) near(x.r, 4, 0.01);
});

test('Ziehen: gezogener Punkt folgt, verbundene Beziehungen bleiben erfüllt', () => {
  const sk = M.emptySketch();
  const { p, l } = roughRect(sk);
  M.addCon(sk, 'horizontal', [l[0].id]);
  M.addCon(sk, 'horizontal', [l[2].id]);
  M.addCon(sk, 'vertical', [l[1].id]);
  M.addCon(sk, 'vertical', [l[3].id]);
  assert.ok(S.solveSketch(sk).ok);
  assert.ok(S.solveSketch(sk, { drag: { pt: p[2].id, x: 70, y: 45 } }).ok);
  near(M.ptOf(sk, p[2].id)!.x, 70, 1e-6);
  near(M.ptOf(sk, p[1].id)!.x, 70, 1e-6);
  near(M.ptOf(sk, p[3].id)!.y, 45, 1e-6);
  // fester Punkt lässt sich nicht wegziehen
  M.addCon(sk, 'fixed', [p[0].id], { x: M.ptOf(sk, p[0].id)!.x, y: M.ptOf(sk, p[0].id)!.y });
  assert.ok(S.solveSketch(sk).ok);
  assert.ok(!S.solveSketch(sk, { drag: { pt: p[0].id, x: -30, y: -30 } }).ok);
});

test('Löschen nimmt Elemente, verwaiste Punkte und Beziehungen mit; JSON hin und zurück', () => {
  const sk = M.emptySketch();
  const { l } = roughRect(sk);
  M.addCon(sk, 'parallel', [l[0].id, l[2].id]);
  M.deleteIds(sk, [l[0].id]);
  assert.equal(sk.ents.length, 3);
  assert.equal(sk.cons.length, 0);
  assert.equal(sk.pts.length, 4);
  M.deleteIds(sk, [l[1].id]);
  assert.equal(sk.pts.length, 3); // der Punkt zwischen l[0] und l[1] gehört zu nichts mehr
  const back = M.parseSketch(M.sketchJson(sk));
  assert.deepEqual(back, sk);
  assert.deepEqual(M.parseSketch('kaputt'), M.emptySketch());
});

test('Bemaßung mit Formel-Wert und waagrechter Abstand', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 13, 7);
  M.addCon(sk, 'hdistance', [a.id, b.id], { v: 25 });
  M.addCon(sk, 'vdistance', [a.id, b.id], { v: 5 });
  M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  assert.equal(r.dof, 0);
  near(M.ptOf(sk, b.id)!.x, 25, 1e-6);
  near(M.ptOf(sk, b.id)!.y, 5, 1e-6);
});

test('Umwandeln: Rechteck mit Rundungen und Loch → Linien, Bögen, Kreis, waagrecht/senkrecht', () => {
  const subs = [
    ...shapeSubs({ kind: 'rect', w: 60, h: 40, r: 8 }),
    ...shapeSubs({ kind: 'ellipse', rx: 6, ry: 6 }),
  ];
  const sk = subsToSketch(subs);
  const kinds = sk.ents.map((e) => e.t);
  assert.equal(kinds.filter((k) => k === 'line').length, 4);
  assert.equal(kinds.filter((k) => k === 'arc').length, 4);
  assert.equal(kinds.filter((k) => k === 'circle').length, 1);
  assert.equal(sk.cons.filter((c) => c.t === 'horizontal').length, 2);
  assert.equal(sk.cons.filter((c) => c.t === 'vertical').length, 2);
  const r = S.solveSketch(sk);
  assert.ok(r.ok);
  // Umriss bleibt geschlossen: Rechteck als ein geschlossener Pfad plus der Kreis
  const out = M.sketchSubs(sk);
  assert.equal(out.length, 2);
  assert.ok(out.every((sp) => sp.closed));
});

test('Diagnose trennt Formel, Geometrie, Widerspruch und Redundanz und nennt die Bedingung', async () => {
  const { solveDiagnostics, diagnosticTitle } = await import('../src/sketch/diagnostics');
  assert.deepEqual(solveDiagnostics({ ok: false, dof: 0, conflicting: [], redundant: [], inputIssues: [{ kind: 'formula', id: 7, message: 'x' }] }),
    [{ kind: 'formula', ids: [7], message: 'x' }]);
  assert.deepEqual(solveDiagnostics({ ok: false, dof: 1, conflicting: [4], redundant: [9] }),
    [{ kind: 'conflict', ids: [4] }, { kind: 'redundant', ids: [9] }]);
  assert.deepEqual(solveDiagnostics({ ok: false, dof: 1, conflicting: [5], redundant: [], invalidGeometry: true }),
    [{ kind: 'geometry', ids: [5] }]);
  assert.deepEqual(solveDiagnostics({ ok: false, dof: 2, conflicting: [], redundant: [] }), [{ kind: 'solve', ids: [] }]);
  assert.deepEqual(solveDiagnostics(null), []);
  const titles = new Set(['formula', 'geometry', 'conflict', 'redundant', 'solve', 'reference'].map((kind) => diagnosticTitle(kind as never)));
  assert.equal(titles.size, 6);
});

test('Referenzprüfung blockiert gelöste Bedingungen und meldet entfernte Maße', async () => {
  const { brokenFeatureReferences, lostConditions } = await import('../src/sketch/references');
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 20, 0);
  const l1 = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'horizontal', [l1.id]);
  const c = M.addPt(sk, 20, 20);
  const l2 = M.addLine(sk, b.id, c.id);
  const plan = planSketchCorner(sk, l1.id, 'b', 4, true);
  assert.ok(plan && 'sides' in plan);
  if (!plan || !('sides' in plan)) return;
  applySketchCorner(sk, plan);
  const connector = sk.ents.find((e) => e.cornerBounds)!;
  const before = M.cloneSketch(sk);
  assert.deepEqual(brokenFeatureReferences(before, sk), []);
  const broken = M.cloneSketch(sk);
  broken.cons = broken.cons.filter((item) => item.id !== connector.cornerBounds!.dimension);
  const refs = brokenFeatureReferences(before, broken);
  assert.ok(refs.length && refs.every(({ feature }) => feature === connector.id));
  assert.deepEqual(lostConditions(before, broken).map((item) => item.id), [connector.cornerBounds!.dimension]);
});



test('Schnittpunkt bleibt auf seinem Zweig und innerhalb beider endlicher Kurven', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, -20, 3), b = M.addPt(sk, 20, 3), center = M.addPt(sk, 0, 0);
  const line = M.addLine(sk, a.id, b.id, true), circle = M.addCircle(sk, center.id, 5, true);
  const anchors = [a, b, center].map((p) => M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y }));
  M.addCon(sk, 'radius', [circle.id], { v: 5 });
  const two = sketchEdgeIntersections(sk, line, circle);
  assert.equal(two.length, 2);
  assert.notEqual(two[0].branch, two[1].branch);
  const point = M.materializeSketchPoint(sk, { ...two[1], intersection: { edges: [line.id, circle.id], branch: two[1].branch } });
  const loaded = M.parseSketch(M.sketchJson(sk));
  loaded.cons.find((c) => c.id === anchors[2].id)!.x = 2;
  assert.ok(S.solveSketch(loaded).ok);
  near(M.ptOf(loaded, point)!.x, 6);
  loaded.cons.find((c) => c.id === anchors[1].id)!.x = 1;
  const prior = M.ptOf(loaded, point)!.x;
  assert.equal(S.solveSketch(loaded).invalidGeometry, true);
  assert.equal(M.ptOf(loaded, point)!.x, prior);
  a.y = b.y = 5;
  assert.equal(sketchEdgeIntersections(sk, line, circle).length, 0);
});


test('Ein kollabierendes sichtbares Segment wird vor dem Schreiben erkannt', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
  const fixed = M.addCon(sk, 'fixed', [b.id], { x: 10, y: 0 });
  assert.ok(S.solveSketch(sk).ok);
  fixed.x = 0;
  assert.equal(S.solveSketch(sk).invalidGeometry, true);
  assert.equal(b.x, 10);
});

test('Definitionsstatus: feste Geometrie, gekoppelte freie Punkte und freier Kreisradius', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0), c = M.addPt(sk, 30, 0), d = M.addPt(sk, 40, 0);
  const fixed = M.addLine(sk, a.id, b.id), sliding = M.addLine(sk, b.id, c.id), circle = M.addCircle(sk, d.id, 3);
  for (const p of [a, b, d]) M.addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
  M.addCon(sk, 'horizontal', [sliding.id]);
  const r = S.solveSketch(sk, { definition: true });
  assert.ok(r.ok);
  for (const id of [a.id, b.id, d.id, fixed.id]) assert.equal(r.definition?.get(id), 'fixed', String(id));
  for (const id of [c.id, sliding.id, circle.id]) assert.equal(r.definition?.get(id), 'free', String(id));
});

test('Natives Langloch: zweiter Radius und Tangenten sind ohne Zusatzmaß festgelegt', () => {
  for (const diagonal of [false, true]) {
    const sk = M.emptySketch();
    if (diagonal) addOrientedSketchSlot(sk, { x: 0, y: 0 }, { x: 30, y: 10 }, 8);
    else addSketchSlot(sk, { x: 0, y: 0 }, 30, false, 8);
    const r = S.solveSketch(sk, { definition: true });
    assert.ok(r.ok);
    const arcs = sk.ents.filter((e) => e.t === 'arc');
    assert.equal(sk.cons.filter((c) => c.t === 'diameter').length, 1);
    for (const arc of arcs) assert.equal(r.definition?.get(arc.id), 'fixed', `diagonal=${diagonal}`);
    sk.cons.find((c) => c.t === 'diameter')!.v = 12;
    assert.ok(S.solveSketch(sk).ok);
    for (const arc of arcs) near(arc.r, 6);
  }
});

test('snapToAngleStep: 45°-Raster um Startpunkt, Abstand bleibt', () => {
  const d = Math.hypot(10, 3);
  const a = M.snapToAngleStep({ x: 0, y: 0 }, { x: 10, y: 3 });
  near(a.y, 0);
  near(Math.hypot(a.x, a.y), d);
  const db = Math.hypot(5, 10);
  const b = M.snapToAngleStep({ x: 0, y: 0 }, { x: 5, y: 10 });
  near(b.x, db / Math.SQRT2);
  near(b.y, db / Math.SQRT2);
  const c = M.snapToAngleStep({ x: 1, y: 1 }, { x: 11, y: 11 });
  near(c.x, 11);
  near(c.y, 11);
  assert.deepEqual(M.snapToAngleStep({ x: 2, y: 2 }, { x: 2, y: 2 }), { x: 2, y: 2 });
});

test('Linienwerkzeug: Shift snappt freien Endpunkt auf 45°', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const a = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchDown(a.x, a.y, plain);
  const b = ed.skToScreen({ x: 30, y: 8 });
  ed.sketchDown(b.x, b.y, shift);
  const live = ed.sketchEdit!.sk;
  const line = live.ents.find((e) => e.t === 'line');
  assert.ok(line?.t === 'line');
  const p0 = M.ptOf(live, line.a)!, p1 = M.ptOf(live, line.b)!;
  near(p1.x - p0.x, Math.hypot(30, 8));
  near(p1.y - p0.y, 0);
});

test('Linienwerkzeug: ohne Shift bleibt freier Endpunkt exakt', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const a = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchDown(a.x, a.y, plain);
  const b = ed.skToScreen({ x: 30, y: 8 });
  ed.sketchDown(b.x, b.y, plain);
  const live = ed.sketchEdit!.sk;
  const line = live.ents.find((e) => e.t === 'line');
  assert.ok(line?.t === 'line');
  const p0 = M.ptOf(live, line.a)!, p1 = M.ptOf(live, line.b)!;
  near(p1.x - p0.x, 30);
  near(p1.y - p0.y, 8);
});

test('Polylinie: Shift snappt freies Segmentende auf 45°', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('polyline');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const a = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchPolylineClick(a.x, a.y, plain);
  const b = ed.skToScreen({ x: 6, y: 20 });
  ed.sketchPolylineClick(b.x, b.y, shift);
  assert.ok(ed.finishSketchPolyline());
  const live = ed.sketchEdit!.sk;
  assert.equal(live.ents.length, 1);
  const line = live.ents[0];
  assert.ok(line?.t === 'line');
  const p0 = M.ptOf(live, line.a)!, p1 = M.ptOf(live, line.b)!;
  near(p0.x, 0);
  near(p0.y, 0);
  near(p1.x - p0.x, 0);
  near(p1.y - p0.y, Math.hypot(6, 20));
});

/** Fangspur/Winkel/Verlängerung: minimaler Fang-Harness ohne Canvas */
function trackHarness(set: SnapSet) {
  const snapping = new EditorSnapping();
  const ed = {
    snapTolerance: { normal: 8, alt: 20 }, view: { zoom: 2 }, snapObjects: true, snapGrid: false, gridStep: 1,
    snapHit: null as Editor['snapHit'], alignGuides: [] as Editor['alignGuides'],
    hoverSnapSet: () => set,
    snapModes: snapping.snapModes, snapTol: snapping.snapTol, clearSnap: snapping.clearSnap, gridRound: snapping.gridRound,
    snapTargetSet: snapping.snapTargetSet,
    addTrackPt: snapping.addTrackPt, clearTrack: snapping.clearTrack, clearTrackTimer: snapping.clearTrackTimer,
    armTrackTimer: snapping.armTrackTimer, fireTrackDwell: snapping.fireTrackDwell,
    trackDwellOnHit: snapping.trackDwellOnHit,
  } as unknown as Editor;
  return { ed, snapping };
}

test('Fangspur: einzelne Referenz rastet horizontal/vertikal', () => {
  const hit = trackPoint([{ x: 10, y: 20 }], { x: 12, y: 22 }, 5)!;
  assert.ok(hit);
  assert.deepEqual(hit.p, { x: 10, y: 20 });
  assert.equal(hit.guides.length, 2);
  const yOnly = trackPoint([{ x: 10, y: 20 }], { x: 30, y: 22 }, 5)!;
  assert.ok(yOnly);
  assert.deepEqual(yOnly.p, { x: 30, y: 20 });
  assert.equal(yOnly.guides.length, 1);
  assert.equal(yOnly.guides[0].axis, 'y');
  assert.equal(trackPoint([{ x: 10, y: 20 }], { x: 30, y: 40 }, 5), null);
  assert.equal(trackPoint([], { x: 1, y: 1 }, 5), null);
});

test('Fangspur: zwei Referenzen schneiden sich aus verschiedenen Punkten', () => {
  const hit = trackPoint([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 1, y: 9 }, 5)!;
  assert.ok(hit);
  assert.deepEqual(hit.p, { x: 0, y: 10 });
  assert.equal(hit.guides.length, 2);
});

test('Verlängerungslinie: Fang hinter dem Endpunkt, nicht auf der Strecke', () => {
  const set = new SnapSet();
  set.addPiece(0, 0, 10, 0);
  const hit = snapToExtension(set, { x: 14, y: 1 }, 2, 8)!;
  assert.ok(hit);
  near(hit.p.x, 14);
  near(hit.p.y, 0);
  assert.equal(hit.guide.axis, 'seg');
  if (hit.guide.axis !== 'seg') throw new Error('Streckenführung erwartet');
  assert.deepEqual(hit.guide.a, { x: 10, y: 0 });
  // auf der Strecke ist der Linienfang zuständig, nicht die Verlängerung
  assert.equal(snapToExtension(set, { x: 5, y: 1 }, 2, 8), null);
  // jenseits der Reichweite kein Fang
  assert.equal(snapToExtension(set, { x: 30, y: 0 }, 2, 8), null);
  // Kurvennäherungen haben keine Verlängerung
  const curves = new SnapSet();
  curves.addPiece(0, 0, 1, 0, false);
  assert.equal(snapToExtension(curves, { x: 5, y: 0.5 }, 2, 8), null);
});

test('Verlängerungslinie: Standard-Reichweite 32× Toleranz jenseits des Endpunkts', () => {
  const set = new SnapSet();
  set.addPiece(0, 0, 10, 0);
  // ext = 40 bei tol = 2 (20×) fängt mit Standard-Reichweite (32×2 = 64)
  const hit = snapToExtension(set, { x: 50, y: 1 }, 2)!;
  assert.ok(hit);
  near(hit.p.x, 50);
  near(hit.p.y, 0);
  // ext = 70 jenseits der 64 fängt nicht mehr
  assert.equal(snapToExtension(set, { x: 80, y: 0 }, 2), null);
});

test('Winkel-Projektion: Strahl vom Anker durch den Punkt, verlängert', () => {
  const g = angleGuide({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
  assert.equal(g.axis, 'seg');
  if (g.axis !== 'seg') throw new Error('Strahlenführung erwartet');
  assert.deepEqual(g.a, { x: 0, y: 0 });
  near(g.b.x, 15);
  near(g.b.y, 0);
  const d = angleGuide({ x: 1, y: 1 }, { x: 11, y: 11 }, 0);
  if (d.axis !== 'seg') throw new Error('Strahlenführung erwartet');
  near(d.b.x, 11);
  near(d.b.y, 11);
});

test('snapPt: Fangspur aus expliziten Referenzen schlägt vor dem Raster zu', () => {
  const { ed, snapping } = trackHarness(new SnapSet());
  const p = snapping.snapPt.call(ed, { x: 30, y: 2 }, null, { track: [{ x: 0, y: 0 }] });
  assert.deepEqual(p, { x: 30, y: 0 });
  assert.equal(ed.snapHit?.kind, 'track');
  assert.equal(ed.alignGuides.length, 1);
});

test('snapPt: Verlängerung fängt, Fangspur hat Vorrang', () => {
  const set = new SnapSet();
  set.addPiece(0, 0, 10, 0);
  const { ed, snapping } = trackHarness(set);
  const p = snapping.snapPt.call(ed, { x: 14, y: 1 }, null, { extensions: true });
  assert.deepEqual(p, { x: 14, y: 0 });
  assert.equal(ed.snapHit?.kind, 'ext');
  assert.equal(ed.alignGuides.length, 1);
  // beide Treffer möglich: die Fangspur gewinnt
  const q = snapping.snapPt.call(ed, { x: 14, y: 3 }, null, { track: [{ x: 0, y: 5 }], extensions: true });
  assert.deepEqual(q, { x: 14, y: 5 });
  assert.equal(ed.snapHit?.kind, 'track');
});

test('Linienwerkzeug: Shift zeigt Winkel-Führung und Markierung', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const a = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchDown(a.x, a.y, plain);
  const b = ed.skToScreen({ x: 30, y: 8 });
  ed.sketchDown(b.x, b.y, shift);
  const live = ed.sketchEdit!.sk;
  const line = live.ents.find((e) => e.t === 'line');
  assert.ok(line?.t === 'line');
  const p0 = M.ptOf(live, line.a)!, p1 = M.ptOf(live, line.b)!;
  near(p1.x - p0.x, Math.hypot(30, 8));
  near(p1.y - p0.y, 0);
  assert.equal(ed.snapHit?.kind, 'angle');
  assert.equal(ed.alignGuides.length, 1);
  assert.equal(ed.alignGuides[0].axis, 'seg');
});

test('Polylinie: Shift zeigt Winkel-Führung und Markierung', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('polyline');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const a = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchPolylineClick(a.x, a.y, plain);
  const b = ed.skToScreen({ x: 6, y: 20 });
  ed.sketchPolylineClick(b.x, b.y, shift);
  assert.equal(ed.snapHit?.kind, 'angle');
  assert.equal(ed.alignGuides.length, 1);
  assert.equal(ed.alignGuides[0].axis, 'seg');
  assert.ok(ed.finishSketchPolyline());
  const live = ed.sketchEdit!.sk;
  const line = live.ents[0];
  assert.ok(line?.t === 'line');
  const p0 = M.ptOf(live, line.a)!, p1 = M.ptOf(live, line.b)!;
  near(p1.x - p0.x, 0);
  near(p1.y - p0.y, Math.hypot(6, 20));
});

test('Fangspur im Sketch: Draft wird in Weltkoordinaten verfolgt', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.sketchEdit!.draft = [{ x: 0, y: 0 }];
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const s = ed.skToScreen({ x: 1, y: 30 });
  const { p } = ed.sketchPointAt(s.x, s.y, plain);
  near(p.x, 0);
  near(p.y, 30);
  assert.equal(ed.snapHit?.kind, 'track');
});

test('Shift-Winkel behält Fangspur-Treffer (Vorrang)', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.sketchEdit!.draft = [{ x: 0, y: 0 }];
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const s = ed.skToScreen({ x: 30, y: 1 });
  const { p } = ed.sketchPointAt(s.x, s.y, shift);
  assert.equal(ed.snapHit?.kind, 'track');
  near(p.x, 30);
  near(p.y, 0);
});

test('Winkel-Führung liegt in Weltkoordinaten', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.sketchEdit!.draft = [{ x: 0, y: 0 }];
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const s = ed.skToScreen({ x: 30, y: 8 });
  ed.sketchPointAt(s.x, s.y, shift);
  assert.equal(ed.snapHit?.kind, 'angle');
  const g = ed.alignGuides[0];
  assert.equal(g.axis, 'seg');
  if (g.axis !== 'seg') throw new Error('Strahlenführung erwartet');
  near(g.a.x, 70);
  near(g.a.y, 50);
  near(g.b.x, 70);
  assert.ok(g.b.y > 80);
});

test('Skizzenpunkt-Hover merkt sich für Fangspur (Dwell im Pick-Zweig)', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  M.addLine(sk, a.id, b.id);
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  // erster Eckpunkt: halten → gemerkt
  const s0 = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchPointAt(s0.x, s0.y, plain);
  ed.fireTrackDwell(Date.now() + 600);
  assert.deepEqual(ed.trackPts, [{ x: 70, y: 50 }]);
  // zweiter Eckpunkt lässt sich danach ebenfalls merken (kein Tool-Neustart nötig)
  const s1 = ed.skToScreen({ x: 40, y: 0 });
  ed.sketchPointAt(s1.x, s1.y, plain);
  ed.fireTrackDwell(Date.now() + 600);
  assert.deepEqual(ed.trackPts, [{ x: 70, y: 50 }, { x: 70, y: 90 }]);
});

test('Draft: nur der letzte Punkt ankert Tracking (kein Phantom aus Verlauf)', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.sketchEdit!.draft = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  // Welt (50,68): fern aller Achsen des letzten Punkts, aber im Polar-Kegel des ersten
  const s = ed.skToScreen({ x: 18, y: 20 });
  const { p } = ed.sketchPointAt(s.x, s.y, plain);
  near(p.x, 18);
  near(p.y, 20);
  assert.equal(ed.snapHit, null);
  assert.equal(ed.alignGuides.length, 0);
});

test('Draft: letzter Punkt ankert die Fangspur weiter', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.sketchEdit!.draft = [{ x: 100, y: 100 }, { x: 0, y: 0 }];
  const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const s = ed.skToScreen({ x: 1, y: 30 });
  const { p } = ed.sketchPointAt(s.x, s.y, plain);
  near(p.x, 0);
  near(p.y, 30);
  assert.equal(ed.snapHit?.kind, 'track');
});

test('Polylinie: Shift überschreibt keinen Verlängerungs-Treffer', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  const set = new SnapSet();
  set.addPiece(0, 0, 10, 0);
  ed.hoverSnapSet = () => set;
  ed.setSketchTool('polyline');
  ed.sketchEdit!.polyline = { start: { x: 0, y: 0 }, startId: null, segments: [] };
  const shift = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true } as PointerEvent;
  const s = ed.skToScreen({ x: -49, y: 56 });
  ed.sketchPolylinePoint(s.x, s.y, shift);
  assert.equal(ed.snapHit?.kind, 'ext');
});

test('snapToPolar: Strahl vom Anker, nur nah am Strahl', () => {
  const tol = 2;
  const on = SN.snapToPolar([{ x: 100, y: 100 }], { x: 120, y: 120 }, tol)!;
  assert.ok(on);
  near(on.p.x, 120);
  near(on.p.y, 120);
  const L = 40, a = Math.PI / 4 + 0.025;
  const close = SN.snapToPolar([{ x: 100, y: 100 }], { x: 100 + L * Math.cos(a), y: 100 + L * Math.sin(a) }, tol)!;
  assert.ok(close);
  near(close.p.x, 100 + (L * Math.cos(0.025)) / Math.SQRT2, 1e-9);
  near(close.p.y, 100 + (L * Math.cos(0.025)) / Math.SQRT2, 1e-9);
  assert.equal(SN.snapToPolar([{ x: 100, y: 100 }], { x: 60, y: 50 }, tol), null);
  assert.equal(SN.snapToPolar([{ x: 100, y: 100 }], { x: 140, y: 110 }, tol), null);
  assert.equal(SN.snapToPolar([{ x: 100, y: 100 }], { x: 100, y: 100 }, tol), null);
  const behind = SN.snapToPolar([{ x: 100, y: 100 }], { x: 60, y: 59.9 }, tol)!;
  assert.ok(behind);
  near(behind.p.x, 60, 0.2);
  near(behind.p.y, 60, 0.2);
  const b = { x: 0, y: 0 }, c = { x: 30, y: 20 };
  const winC = SN.snapToPolar([b, c], { x: 30, y: 21.2 }, tol)!;
  assert.ok(winC);
  assert.deepEqual(winC.guide.a, c);
  const winB = SN.snapToPolar([b, c], { x: 28.8, y: 0 }, tol)!;
  assert.ok(winB);
  assert.deepEqual(winB.guide.a, b);
});

test('trackDwellNext: Halten merkt, Wegbewegen setzt zurück', () => {
  const H = { x: 10, y: 20 };
  let st = SN.trackDwellNext(null, null, 1000, 500, 1);
  assert.equal(st.acquire, null);
  assert.equal(st.next, null);
  st = SN.trackDwellNext(st.next, H, 1000, 500, 1);
  assert.equal(st.acquire, null);
  st = SN.trackDwellNext(st.next, H, 1300, 500, 1);
  assert.equal(st.acquire, null);
  st = SN.trackDwellNext(st.next, { x: 10.2, y: 20.1 }, 1600, 500, 1);
  assert.deepEqual(st.acquire, { x: 10.2, y: 20.1 });
  assert.equal(st.next, null);
  st = SN.trackDwellNext({ p: H, since: 1000 }, null, 1400, 500, 1);
  assert.equal(st.acquire, null);
  assert.equal(st.next, null);
  st = SN.trackDwellNext({ p: H, since: 1000 }, { x: 50, y: 50 }, 1600, 500, 1);
  assert.equal(st.acquire, null);
  assert.deepEqual(st.next, { p: { x: 50, y: 50 }, since: 1600 });
});

test('Fangspur: gemerkter Punkt fängt Lot auch fernab des Punkts', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.trackPts = [{ x: 200, y: 100 }];
  const tol = ed.snapTol().normal / ed.view.zoom;
  const ev = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const at = ed.toScreen({ x: 250, y: 100 + tol * 0.4 });
  const { p } = ed.sketchPointAt(at.x, at.y, ev);
  const w = apply([0, 1, -1, 0, 70, 50], p.x, p.y);
  near(w.x, 250);
  near(w.y, 100);
  assert.ok(ed.alignGuides.length >= 1);
  assert.equal(ed.snapHit?.kind, 'track');
  const far = ed.toScreen({ x: 250, y: 100 + tol * 2 });
  const free = ed.sketchPointAt(far.x, far.y, ev);
  const wf = apply([0, 1, -1, 0, 70, 50], free.p.x, free.p.y);
  near(wf.x, 250);
  near(wf.y, 100 + tol * 2);
});

test('Polar: Cursor nahe 45°-Strahl eines gemerkten Punkts rastet ein', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.trackPts = [{ x: 200, y: 100 }];
  const ev = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as PointerEvent;
  const at = ed.toScreen({ x: 200 + 40 * Math.cos(Math.PI / 4 + 0.5 * Math.PI / 180), y: 100 + 40 * Math.sin(Math.PI / 4 + 0.5 * Math.PI / 180) });
  const { p } = ed.sketchPointAt(at.x, at.y, ev);
  const w = apply([0, 1, -1, 0, 70, 50], p.x, p.y);
  near(w.x, 228.277, 0.01);
  near(w.y, 128.277, 0.01);
  assert.equal(ed.snapHit?.kind, 'angle');
  assert.ok(ed.alignGuides.length >= 1);
});

test('snapPt: exakter Treffer schlägt Fangspur', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.trackPts = [{ x: 200, y: 100 }];
  const H = { x: 200, y: 150 };
  const w = ed.snapPt(H, null, { extra: [H] });
  assert.deepEqual(w, H);
  assert.notEqual(ed.snapHit?.kind, 'track');
});

test('snapPt: 500 ms Halten merkt den Fangpunkt', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  const H = { x: 300, y: 300 };
  ed.trackPts = [];
  ed.snapPt(H, null, { extra: [H], now: 1000 });
  assert.deepEqual(ed.trackPts, []);
  ed.snapPt(H, null, { extra: [H], now: 1300 });
  assert.deepEqual(ed.trackPts, []);
  ed.snapPt(H, null, { extra: [H], now: 1600 });
  assert.deepEqual(ed.trackPts, [H]);
  ed.snapPt(H, null, { extra: [H], now: 2200 });
  assert.deepEqual(ed.trackPts, [H]);
});

test('fireTrackDwell: Stillhalten ohne Mausbewegung merkt den Punkt', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  const H = { x: 300, y: 300 };
  ed.trackDwell = { p: H, since: 1000 };
  ed.fireTrackDwell(1600);
  assert.deepEqual(ed.trackPts, [H]);
  ed.trackDwell = { p: H, since: 1000 };
  ed.fireTrackDwell(1300);
  assert.deepEqual(ed.trackPts, [H]);
  assert.notEqual(ed.trackDwell, null);
});

test('Esc vergisst gemerkte Fangspur zuerst, Werkzeug bleibt', () => {  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.setSketchTool('line');
  ed.trackPts = [{ x: 1, y: 2 }];
  assert.equal(ed.sketchKey({ key: 'Escape' } as KeyboardEvent), true);
  assert.deepEqual(ed.trackPts, []);
  assert.equal(ed.sketchEdit!.tool, 'line');
});

test('Werkzeugwechsel löscht die Fangspur', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.trackPts = [{ x: 1, y: 2 }];
  ed.setSketchTool('polyline');
  assert.deepEqual(ed.trackPts, []);
});

test('Einfügen ist im Skizzenmodus blockiert (weder Bild noch Objekt)', async () => {
  let snapshots = 0, externalCalls = 0;
  const fake = {
    sketchEdit: { tool: 'line' },
    pasteTimer: 0,
    clipboard: [{ id: 'x' }],
    doc: { objs: [] as unknown[] },
    hint: '',
    snapshot: () => { snapshots++; },
    setSel: () => undefined,
    emit: () => undefined,
    externalPaste: async () => { externalCalls++; return true; },
  } as unknown as Editor;
  // direkter Objekt-Paste (Menü, Kürzel-Fallback): kein Dokument-Zugang, nur Hinweis
  EditorCommands.prototype.paste.call(fake);
  assert.equal((fake.doc.objs as unknown[]).length, 0);
  assert.equal(snapshots, 0);
  assert.ok(fake.hint.length > 0);
  // Fenster-Paste (Bild aus der Zwischenablage): externer Import wird gar nicht erst gefragt
  let prevented = false;
  await EditorCommands.prototype.onPaste.call(fake, {
    target: { tagName: 'DIV' },
    preventDefault: () => { prevented = true; },
    clipboardData: null,
  } as unknown as ClipboardEvent);
  assert.ok(prevented);
  assert.equal(externalCalls, 0);
  assert.equal((fake.doc.objs as unknown[]).length, 0);
  assert.equal(snapshots, 0);
});

test('Skizzen-Hilfslinien: Modell rundläuft, Ungültiges fällt raus', () => {
  const sk = M.emptySketch();
  sk.guides = [{ axis: 'x', v: 10 }, { axis: 'y', v: -3.5 }];
  assert.deepEqual(M.parseSketch(M.sketchJson(sk)).guides, [{ axis: 'x', v: 10 }, { axis: 'y', v: -3.5 }]);
  assert.equal(M.parseSketch(M.sketchJson(M.emptySketch())).guides, undefined);
  const dirty = M.parseSketch({
    v: 1, pts: [], ents: [], cons: [], next: 1,
    guides: [{ axis: 'x', v: 1 }, { axis: 'z', v: 2 }, { axis: 'y', v: NaN }, null, { axis: 'y', v: 5 }],
  });
  assert.deepEqual(dirty.guides, [{ axis: 'x', v: 1 }, { axis: 'y', v: 5 }]);
  const many = M.parseSketch({ v: 1, pts: [], ents: [], cons: [], next: 1,
    guides: Array.from({ length: 300 }, (_, i) => ({ axis: 'x', v: i })) });
  assert.equal(many.guides?.length, M.MAX_SKETCH_GUIDES);
});

test('Skizzen-Hilfslinien: nur im Skizzenmodus sichtbar, getrennt vom Dokument', () => {
  const guides = new EditorGuides();
  let snapshots = 0, writes = 0;
  const sk = M.emptySketch();
  const session = { sk };
  const doc = { guides: [{ axis: 'x' as const, v: 99 }] };
  const ed = {
    sketchEdit: session,
    doc,
    snapshot: () => { snapshots++; },
    emit: () => undefined,
    writeSketch: () => { writes++; },
    guideList: guides.guideList,
    guidesShown: guides.guidesShown,
  } as unknown as Editor;
  // Skizzenmodus: eigene, anfangs leere Liste; Dokument-Liste unberührt
  assert.deepEqual(guides.guideList.call(ed), []);
  const idx = guides.pushGuide.call(ed, { axis: 'y', v: 20 });
  assert.equal(idx, 0);
  assert.deepEqual(sk.guides, [{ axis: 'y', v: 20 }]);
  assert.equal(writes, 1);
  assert.deepEqual(doc.guides, [{ axis: 'x', v: 99 }]);
  assert.deepEqual(guides.guideList.call(ed), [{ axis: 'y', v: 20 }]);
  // Verschieben schreibt nach
  guides.setGuidePos.call(ed, 0, 21);
  assert.deepEqual(sk.guides, [{ axis: 'y', v: 21 }]);
  assert.equal(snapshots, 1);
  assert.equal(writes, 2);
  // Ausblenden gilt nur für die Sitzung, nicht das Dokument
  guides.setGuideLayer.call(ed, { hidden: true });
  assert.equal(guides.guidesShown.call(ed), false);
  assert.equal((doc as { guidesHidden?: boolean }).guidesHidden, undefined);
  guides.setGuideLayer.call(ed, { hidden: false });
  assert.equal(guides.guidesShown.call(ed), true);
  // Löschen schreibt nach, Dokument-Liste bleibt
  guides.removeGuide.call(ed, 0);
  assert.deepEqual(sk.guides, undefined);
  assert.equal(writes, 3);
  // Außerhalb: nur Dokument-Linien
  (ed as { sketchEdit: null }).sketchEdit = null;
  assert.deepEqual(guides.guideList.call(ed), [{ axis: 'x', v: 99 }]);
});

test('Skizzen-Hilfslinien: Sperre, Live-Verschiebung und Löschen routen sitzungsweise', () => {
  const guides = new EditorGuides();
  let writes = 0, snapshots = 0;
  const sk = M.emptySketch();
  sk.guides = [{ axis: 'x', v: 5 }];
  const ed = {
    sketchEdit: { sk },
    doc: { guides: [{ axis: 'y' as const, v: 7 }], guidesLocked: true },
    snapshot: () => { snapshots++; },
    emit: () => undefined,
    writeSketch: () => { writes++; },
    guideList: guides.guideList,
    guidesShown: guides.guidesShown,
    guidesLocked: guides.guidesLocked,
  } as unknown as Editor;
  // Sitzung ungesperrt trotz gesperrtem Dokument
  assert.equal(ed.guidesLocked(), false);
  guides.setGuideLayer.call(ed, { locked: true });
  assert.equal(ed.guidesLocked(), true);
  assert.equal(ed.doc.guidesLocked, true); // Dokument-Flag unberührt
  // Live-Verschiebung schreibt nach
  guides.setGuideLive.call(ed, 0, 6);
  assert.deepEqual(sk.guides, [{ axis: 'x', v: 6 }]);
  assert.equal(writes, 1);
  // Löschen leert nur die Sitzung
  guides.clearGuides.call(ed);
  assert.equal(sk.guides, undefined);
  assert.deepEqual(ed.doc.guides, [{ axis: 'y', v: 7 }]);
  assert.equal(snapshots, 2); // setGuideLayer + clearGuides
  // Dokument-Modus: gleiche Aufrufe treffen das Dokument
  (ed as { sketchEdit: null }).sketchEdit = null;
  assert.equal(ed.guidesLocked(), true);
  guides.clearGuides.call(ed);
  assert.equal(ed.doc.guides, undefined);
});









test('Anzeigeformat: Winkel und Hinweise 2-stellig, Zählfelder ganzzahlig', () => {
  const { dimensionNumber, degreeNumber, countNumber } = FMT;
  const { hintNum } = PTR;
  const { dec } = I18N;
  assert.equal(degreeNumber(45.678), dec('45.68'));
  assert.equal(degreeNumber(7), dec('7.00'));
  assert.equal(hintNum(10), dimensionNumber(10));
  assert.equal(hintNum(10), dec('10.00'));
  assert.equal(countNumber(7), '7');
  assert.equal(countNumber(2), '2');
  assert.equal(dimensionNumber(3.5), dec('3.50'));
});

test('Größen-Hinweis: 2 Nachkommastellen mit Sprachtrennzeichen', () => {
  const { dec } = I18N;
  const o = { id: 1, m: MDL.IDENT, layer: 0, shape: { kind: 'rect', w: 10, h: 5, r: 0 } };
  const sizeHint = PTR.EditorPointer.prototype.sizeHint as unknown as (this: unknown, obj: unknown) => string;
  assert.equal(sizeHint.call({}, o), `${dec('10.00')} × ${dec('5.00')} mm`);
});

test('Offene Profile: nur nicht-geschlossene Ketten sind offen', () => {
  const open = M.emptySketch();
  const a = M.addPt(open, 0, 0), b = M.addPt(open, 10, 0), c = M.addPt(open, 10, 10);
  const l1 = M.addLine(open, a.id, b.id), l2 = M.addLine(open, b.id, c.id);
  assert.deepEqual([...M.openSketchEntIds(open)].sort((x, y) => x - y), [l1.id, l2.id].sort((x, y) => x - y));
  const joined = M.emptySketch();
  const j1 = M.addPt(joined, 0, 0), j2 = M.addPt(joined, 10, 0), j3 = M.addPt(joined, 10, 0), j4 = M.addPt(joined, 20, 0);
  const e1 = M.addLine(joined, j1.id, j2.id), e2 = M.addLine(joined, j3.id, j4.id);
  M.addCon(joined, 'coincident', [j2.id, j3.id]);
  const through = M.openSketchEntIds(joined);
  assert.ok(through.has(e1.id) && through.has(e2.id));
  const closed = M.emptySketch();
  const p = [M.addPt(closed, 0, 0), M.addPt(closed, 10, 0), M.addPt(closed, 10, 10), M.addPt(closed, 0, 10)];
  p.map((q, i) => M.addLine(closed, q.id, p[(i + 1) % 4].id));
  assert.equal(M.openSketchEntIds(closed).size, 0);
  const circ = M.emptySketch();
  const cc = M.addPt(circ, 5, 5);
  M.addCircle(circ, cc.id, 3);
  assert.equal(M.openSketchEntIds(circ).size, 0);
  const aux = M.emptySketch();
  const u = M.addPt(aux, 0, 0), v = M.addPt(aux, 7, 0);
  const helper = M.addLine(aux, u.id, v.id, true);
  assert.ok(!M.openSketchEntIds(aux).has(helper.id));
});

/** renderSketch mit Stub-Canvas: aufgezeichnete strokeStyle-Werte als Harness für colorOf. */
function sketchColorHarness(sk: Sk, status: { ok: boolean; dof: number; conflicting: number[]; redundant: number[]; definition?: Map<number, 'free' | 'fixed'> }, sel: number[] = []) {
  const strokes: string[] = [], fills: string[] = [];
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(_t, p, v) {
      if (p === 'strokeStyle') strokes.push(String(v));
      if (p === 'fillStyle') fills.push(String(v));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set(sel), hover: null, status, labels: [],
    tool: 'line', draft: [], draftIds: [], dimPick: [],
  };
  const ed = {
    dark: false, dpr: 1, view: { zoom: 1, ox: 0, oy: 0 }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    syncSketch() {}, skToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => 1,
    sketchEdit,
  } as unknown as Editor;
  return { ed, ctx, strokes, fills };
}

test('Bestimmung: Strichfarbe, Konflikt und Auswahl schlagen sie (kein Pfirsich-Strich)', () => {
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const setup = () => {
    const sk = M.emptySketch();
    const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, a.id, b.id);
    return { sk, line };
  };
  const run = (sk: Sk, status: { ok: boolean; dof: number; conflicting: number[]; redundant: number[]; definition?: Map<number, 'free' | 'fixed'> }, sel: number[] = []) => {
    const { ed, ctx, strokes, fills } = sketchColorHarness(sk, status, sel);
    (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
    renderSketch.call(ed, ctx);
    return { strokes, fills };
  };
  const okStatus = { ok: true, dof: 1, conflicting: [], redundant: [] as number[] };
  let { sk, line } = setup();
  const freeDef = () => new Map([[line.id, 'free' as const]]);
  const plain = run(sk, { ...okStatus, definition: freeDef() });
  assert.ok(plain.strokes.includes('#2866b2'), JSON.stringify(plain.strokes));
  assert.ok(!plain.strokes.includes('#FFC478'), JSON.stringify(plain.strokes));
  assert.ok(plain.fills.includes('#FFC478'), 'offenes Ende bekommt einen Pfirsich-Marker');
  ({ sk, line } = setup());
  const con = M.addCon(sk, 'horizontal', [line.id]);
  const conflicted = run(sk, { ok: false, dof: 0, conflicting: [con.id], redundant: [], definition: freeDef() });
  assert.ok(conflicted.strokes.includes('#b52626'), JSON.stringify(conflicted.strokes));
  assert.ok(!conflicted.strokes.includes('#FFC478'), JSON.stringify(conflicted.strokes));
  ({ sk, line } = setup());
  const selected = run(sk, { ...okStatus, definition: freeDef() }, [line.id]);
  assert.ok(selected.strokes.includes('#ff6020'), JSON.stringify(selected.strokes));
  assert.ok(!selected.strokes.includes('#FFC478'), JSON.stringify(selected.strokes));
  assert.ok(selected.fills.includes('#FFC478'), 'Marker bleibt über der Auswahl sichtbar');
});

test('Punkt-X-Kreuz: Non-Identity-Render ohne Offen-Farbe', () => {
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const sk = M.emptySketch();
  const p = M.addPt(sk, 3, 4);
  M.addPoint(sk, p.id);
  const strokes: string[] = [];
  const moves: Array<[number, number]> = [];
  const lines: Array<[number, number]> = [];
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
      if (prop === 'lineTo') return (x: number, y: number) => { lines.push([x, y]); };
      return () => {};
    },
    set(_t, prop, v) {
      if (prop === 'strokeStyle') strokes.push(String(v));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
    status: { ok: true, dof: 1, conflicting: [], redundant: [] }, labels: [],
    tool: 'line', draft: [], draftIds: [], dimPick: [],
  };
  const ed = {
    dark: false, dpr: 2, view: { zoom: 2, ox: 30, oy: -17 }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    syncSketch() {}, skToScreen: (q: { x: number; y: number }) => ({ x: q.x * 2 + 30, y: q.y * 2 - 17 }), skScale: () => 2,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
  renderSketch.call(ed, ctx);
  assert.ok(strokes.includes('#5a5a5a') || strokes.includes('#2866b2'), JSON.stringify(strokes));
  assert.ok(!strokes.includes('#FFC478') && !strokes.includes('#E69A3C'), JSON.stringify(strokes));
  assert.ok(!strokes.includes('#b52626') && !strokes.includes('#ff7777'), JSON.stringify(strokes));
  const h = 4 / 2;
  const has = (a: Array<[number, number]>, x: number, y: number) => a.some(([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9);
  assert.ok(has(moves, p.x - h, p.y - h) && has(moves, p.x - h, p.y + h), JSON.stringify({ moves, lines }));
  assert.ok(has(lines, p.x + h, p.y + h) && has(lines, p.x + h, p.y - h), JSON.stringify({ moves, lines }));
});

test('Polygon-Vorschau: inscribed/circumscribed unter Non-Identity (Zoom/Offset/dpr)', () => {
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const ZOOM = 2, OX = 30, OY = -17, DPR = 2, SIDES = 6;
  const center = { x: 0, y: 0 }, rim = { x: 10, y: 0 };
  const toScr = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * ZOOM + OX, y: p.y * ZOOM + OY });
  for (const mode of ['inscribed', 'circumscribed'] as const) {
    const strokes: string[] = [];
    const moves: Array<[number, number]> = [];
    const lines: Array<[number, number]> = [];
    let closes = 0;
    const ctx = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
        if (prop === 'lineTo') return (x: number, y: number) => { lines.push([x, y]); };
        if (prop === 'closePath') return () => { closes++; };
        return () => {};
      },
      set(_t, prop, v) {
        if (prop === 'strokeStyle') strokes.push(String(v));
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const sk = M.emptySketch();
    const sketchEdit = {
      sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
      status: { ok: true, dof: 1, conflicting: [], redundant: [] }, labels: [],
      tool: 'polygon', draft: [center], draftIds: [], dimPick: [],
      polygonSides: SIDES, polygonMode: mode,
    };
    const ed = {
      dark: false, dpr: DPR, view: { zoom: ZOOM, ox: OX, oy: OY }, w: 800, h: 600,
      typo: undefined, colors: {}, cursor: { ...rim }, cursorOnCanvas: true,
      syncSketch() {},
      toScreen: toScr,
      toWorld: (sx: number, sy: number) => ({ x: (sx - OX) / ZOOM, y: (sy - OY) / ZOOM }),
      skToScreen: toScr, skFromWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => ZOOM,
      sketchEdit,
    } as unknown as Editor;
    (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
    renderSketch.call(ed, ctx);
    // Vorschau-Pfad: Entwurfsblau, geschlossenes Vieleck
    assert.ok(strokes.includes('#1f6fe0'), JSON.stringify({ mode, strokes }));
    const expected = sketchPolygonVertices(center, rim, SIDES, mode);
    assert.equal(expected.length, SIDES, JSON.stringify({ mode, expected }));
    const drawn = [...moves, ...lines].map(([x, y]) => ({ x, y }));
    for (const v of expected) {
      const s = toScr(v);
      assert.ok(drawn.some((p) => Math.abs(p.x - s.x) < 1e-9 && Math.abs(p.y - s.y) < 1e-9),
        JSON.stringify({ mode, missing: s, moves, lines }));
    }
    assert.equal(moves.length, 1, JSON.stringify({ mode, moves }));
    assert.equal(lines.length, SIDES - 1, JSON.stringify({ mode, lines }));
    assert.equal(closes, 1, JSON.stringify({ mode, closes }));
    // Non-Identity-Nachweis: erste Ecke liegt transformiert, nicht in Skizzenkoordinaten
    assert.ok(Math.abs(moves[0][0] - (expected[0].x * ZOOM + OX)) < 1e-9
      && Math.abs(moves[0][1] - (expected[0].y * ZOOM + OY)) < 1e-9, JSON.stringify({ mode, moves }));
  }
});

test('Punkt: anlegen, selektieren, löschen (verwaister Punkt verschwindet)', () => {
  const sk = M.emptySketch();
  const p = M.addPt(sk, 3, 4);
  const e = M.addPoint(sk, p.id);
  assert.equal(e.t, 'point');
  assert.deepEqual(M.entPoints(e), [p.id]);
  // fangbar: referenzierter Skizzenpunkt existiert
  assert.deepEqual(M.ptOf(sk, e.p), p);
  // selektierbar: Rahmenauswahl findet den Punkt
  const hits = SEL.sketchFrameSelection(sk, [1, 0, 0, 1, 0, 0], { x: -10, y: -10 }, { x: 10, y: 10 });
  assert.ok(hits.includes(e.id), JSON.stringify(hits));
  // löschen: Element weg, verwaister Punkt weg
  M.deleteIds(sk, [e.id]);
  assert.ok(!M.entOf(sk, e.id));
  assert.ok(!M.ptOf(sk, p.id));
});

test('Punkt: kein Profil-Einfluss (Umriss, offene Ketten)', () => {
  const sk = M.emptySketch();
  roughRect(sk);
  assert.equal(M.sketchSubs(sk).length, 1);
  const dot = M.addPoint(sk, M.addPt(sk, 100, 100).id);
  const aux = M.addPoint(sk, M.addPt(sk, 101, 101).id, true);
  assert.equal(M.sketchSubs(sk).length, 1);
  assert.ok(!M.openSketchEntIds(sk).has(dot.id));
  assert.ok(!M.openSketchEntIds(sk).has(aux.id));
});

test('Punkt: JSON-Roundtrip inkl. aux', () => {
  const sk = M.emptySketch();
  const e = M.addPoint(sk, M.addPt(sk, 3, 4).id, true);
  const back = M.parseSketch(M.sketchJson(sk));
  const found = M.entOf(back, e.id);
  assert.equal(found?.t, 'point');
  assert.equal((found as { aux?: boolean }).aux, true);
});

test('Punkt: Solver sieht freien 2-DOF-Teilchen ohne Umbau (kein eigenes Primitiv, Zustand spiegelt den Punkt)', () => {
  const sk = M.emptySketch();
  const e = M.addPoint(sk, M.addPt(sk, 3, 4).id);
  const r = S.solveSketch(sk, { definition: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.dof, 2);
  assert.equal(r.definition?.get(e.id), 'free');
});

test('Konstruktions-Modus: markAuxFrom markiert nur neue Elemente', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  M.addLine(sk, a.id, b.id);
  const from = sk.next;
  const c = M.addPt(sk, 0, 10), d = M.addPt(sk, 10, 10);
  M.addLine(sk, c.id, d.id);
  M.addPoint(sk, M.addPt(sk, 5, 5).id);
  M.markAuxFrom(sk, from);
  assert.equal(sk.ents.filter((e) => e.aux).length, 2);
  assert.ok(!sk.ents.some((e) => e.id < from && e.aux));
});

test('Punkt-Werkzeug: Hinweistext vorhanden (t-abgedeckt)', () => {
  const sk = M.emptySketch();
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  const s = { tool: 'point', sk, sel: new Set<number>(), draft: [], draftIds: [], dimPick: [],
    relationPick: undefined, polyline: undefined } as never;
  const ed = { sketchEdit: s, hint: '', emit() {}, redraw() {}, clearTrack() {} } as unknown as Editor;
  Object.setPrototypeOf(ed, proto);
  (ed as unknown as { sketchHint: () => void }).sketchHint();
  assert.ok(typeof (ed as unknown as { hint: unknown }).hint === 'string'
    && ((ed as unknown as { hint: string }).hint.length > 0), JSON.stringify((ed as unknown as { hint: unknown }).hint));
});

test('Punkt ziehen: Fang-Markierung und Hover fallen mit Drag-Ende, Klick-Selektion bleibt', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  const m: Mat = [1, 0, 0, 1, 0, 0];
  const shape = { kind: 'gen', gen: 'sketch', params: { sketch: M.sketchJson(sk) }, subs: M.sketchSubs(sk) };
  const obj = { id: 'sketch-drag', shape, m };
  const snapping = new EditorSnapping();
  const ed = Object.assign(new EditorSketch(), {
    doc: { objs: [obj] },
    sketchEdit: { obj, m, sk, json: M.sketchJson(sk), tool: 'select', sel: new Set<number>(), hover: null, labels: [], draft: [], draftIds: [], dimPick: [], status: null, drag: null },
    snapObjects: true, snapGrid: false, view: { zoom: 2 }, dpr: 1.5,
    toScreen: ({ x, y }: { x: number; y: number }) => ({ x: 2 * x + 20, y: 2 * y + 35 }),
    toWorld: (sx: number, sy: number) => ({ x: (sx - 20) / 2, y: (sy - 35) / 2 }),
    snapPt: snapping.snapPt, snapModes: snapping.snapModes, snapTol: snapping.snapTol, clearSnap: snapping.clearSnap,
    snapTargetSet: snapping.snapTargetSet,
    addTrackPt: snapping.addTrackPt, clearTrack: snapping.clearTrack, clearTrackTimer: snapping.clearTrackTimer,
    armTrackTimer: snapping.armTrackTimer, fireTrackDwell: snapping.fireTrackDwell, trackDwellOnHit: snapping.trackDwellOnHit,
    gridRound: snapping.gridRound, gridStep: 1, hoverSnapSet: () => new SnapSet(), skScale: () => 2,
    paramList: () => [], emit() {}, redraw() {}, touch() {}, snapshot() {},
    canvas: { style: {}, focus() {} },
  }) as unknown as Editor;
  const ev = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 7 } as unknown as PointerEvent;
  ed.sketchSolve(false);
  assert.ok(ed.sketchEdit!.status?.ok);
  // Hover wie bei echter Mausbewegung, dann Punkt greifen und auf den anderen Punkt ziehen.
  const atB = ed.skToScreen({ x: 40, y: 0 });
  ed.sketchMove(atB.x, atB.y, ev);
  assert.deepEqual(ed.sketchEdit!.hover, { kind: 'pt', id: b.id });
  ed.sketchDown(atB.x, atB.y, ev);
  assert.deepEqual(ed.sketchEdit!.drag, { pt: b.id, moved: false });
  const atA = ed.skToScreen({ x: 0, y: 0 });
  ed.sketchMove(atA.x, atA.y, ev);
  assert.equal((ed.sketchEdit!.drag as unknown as { moved: boolean }).moved, true);
  // Eingehängter Fang während des Ziehens (im Minimal-Harness ohne Fremdgeometrie direkt belegt).
  (ed as unknown as { snapHit: unknown }).snapHit = { p: { x: 0, y: 0 }, kind: 'node' };
  ed.sketchUp(ev);
  assert.equal(ed.sketchEdit!.drag, null);
  assert.equal(ed.sketchEdit!.hover, null, 'Hover fällt mit Drag-Ende');
  assert.equal((ed as unknown as { snapHit: unknown }).snapHit, null, 'Fang-Markierung fällt mit Drag-Ende');
  assert.ok(ed.sketchEdit!.sel.has(b.id), 'Ziehen ändert die Auswahl nicht');
  // Klick ohne Ziehen: Auswahl bleibt, Fang-Markierung fällt (kein klebender Marker).
  // Marker-Altlast wie nach einem Zeichenwerkzeug simulieren (sketchPointAt setzt ihn dort).
  (ed as unknown as { snapHit: unknown }).snapHit = { p: { x: 0, y: 0 }, kind: 'node' };
  ed.sketchDown(atB.x, atB.y, ev);
  ed.sketchUp(ev);
  assert.equal((ed as unknown as { snapHit: unknown }).snapHit, null, 'Fang-Markierung fällt mit Klick-Selektion');
  assert.ok(ed.sketchEdit!.sel.has(b.id), 'Klick-Selektion unverändert');
});

test('Dok-Auswahlrahmen bleibt im Skizzenmodus aus (echte render-Pipeline, non-identity)', () => {
  const g = globalThis as Record<string, unknown>;
  class MockPath2D {
    ops: string[] = [];
    moveTo() { this.ops.push('moveTo'); }
    lineTo() { this.ops.push('lineTo'); }
    bezierCurveTo() { this.ops.push('bezier'); }
    closePath() { this.ops.push('close'); }
    rect() { this.ops.push('rect'); }
    arc() { this.ops.push('arc'); }
    addPath(other: MockPath2D) { if (other?.ops) this.ops.push(...other.ops); }
  }
  g.Path2D ??= MockPath2D;
  g.DOMMatrix ??= class { constructor(public values?: unknown) {} };
  type CtxCall = { op: string; path?: MockPath2D; dash?: string };
  const calls: CtxCall[] = [];
  const noop = () => {};
  const ctx = {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: noop, restore: noop, clip: noop,
    setTransform: noop, transform: noop, translate: noop, scale: noop, rotate: noop,
    setLineDash: (dash: number[]) => { calls.push({ op: 'dash', dash: dash.join(',') }); },
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, rect: noop, arc: noop,
    fillRect: noop, strokeRect: () => { calls.push({ op: 'rect' }); }, fillText: noop,
    measureText: () => ({ width: 10 }),
    fill: (path?: MockPath2D) => { calls.push({ op: 'fill', path }); },
    stroke: (path?: MockPath2D) => { calls.push({ op: 'stroke', path }); },
  } as unknown as CanvasRenderingContext2D;
  const sk = M.emptySketch();
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 40, 0), M.addPt(sk, 40, 30), M.addPt(sk, 0, 30)];
  p.forEach((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id));
  const obj = { id: 'sketch-frame-obj', m: MDL.IDENT, layer: 0,
    shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: M.sketchJson(sk) }, subs: M.sketchSubs(sk) } };
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: MDL.newDoc(), currentLayer: 0, sel: [obj], tool: 'sketch', draft: null, continuedFrom: null, drag: null,
    view: { zoom: 2.5, ox: 73, oy: -31 },
    canvas: { width: 1600, height: 1200, style: {} }, ctx, dpr: 2,
    typo: TYPO.baselineTypography(), grid: { ...DEFAULT_GRID, show: false },
    filled: true, dark: false, centerMarks: 'off',
    cursor: { x: 40, y: 50 }, snapHit: null, alignGuides: [],
    nodeHover: null, segHover: null, builderSession: null, isolation: null, overlapHover: null,
    // Dokument-Auswahl wie beim Skizzeneintritt: das Skizzen-Objekt bleibt selektiert.
    sketchEdit: {
      obj, m: MDL.IDENT, sk, json: M.sketchJson(sk), tool: 'select', sel: new Set<number>(),
      hover: null, labels: [], draft: [], draftIds: [], dimPick: [], status: null,
      drag: null,
    },
  });
  ed.doc.layers[0] = { ...MDL.defaultLayer(0), mode: 'fill' };
  ed.doc.objs = [obj];
  ed.emit = () => {};
  ed.redraw = () => {};
  ed.render();
  // Positivkontrolle: die Skizze wurde tatsächlich gezeichnet (kein No-op-Render).
  const fills = calls.filter((c) => c.op === 'fill' && c.path instanceof MockPath2D);
  assert.ok(fills.some((c) => c.path!.ops.length > 0), 'Skizze erreicht den Füllpfad');
  let dash = '';
  const framed = calls.filter((c) => {
    if (c.op === 'dash') { dash = c.dash ?? ''; return false; }
    return c.op === 'rect' && dash === '4,3';
  });
  assert.equal(framed.length, 0, 'kein gestrichelter Dok-Auswahlrahmen im Skizzenmodus');
});

test('Definitionsstatus: Mittelpunkt-Kreis ohne Durchmesser und freie Kanten bleiben unterbestimmt', () => {
  // Rechteck-ähnlich mit schräger Kante rechts, 2 Maße (Höhe links, Breite oben);
  // Unterkante und schräge Kante ohne Längenmaß, Kreis nur per Mittelpunkt gebunden.
  const sk = M.emptySketch();
  const p0 = M.addPt(sk, 0, 0), p1 = M.addPt(sk, 60, 0), p2 = M.addPt(sk, 45, 40), p3 = M.addPt(sk, 0, 40);
  const bottom = M.addLine(sk, p0.id, p1.id);
  const slant = M.addLine(sk, p1.id, p2.id);
  const top = M.addLine(sk, p2.id, p3.id);
  const left = M.addLine(sk, p3.id, p0.id);
  M.addCon(sk, 'fixed', [p0.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [bottom.id]);
  M.addCon(sk, 'vertical', [left.id]);
  M.addCon(sk, 'horizontal', [top.id]);
  M.addCon(sk, 'distance', [left.id], { v: 40 });
  M.addCon(sk, 'distance', [top.id], { v: 45 });
  const mid = M.addPt(sk, 52.5, 20);
  M.addCon(sk, 'midpoint', [mid.id, slant.id]);
  const circle = M.addCircle(sk, mid.id, 8);
  const r = S.solveSketch(sk, { definition: true });
  assert.ok(r.ok && !r.redundant.length, JSON.stringify(r));
  assert.ok(r.dof > 0);
  assert.equal(r.definition?.get(circle.id), 'free', 'Kreis ohne Durchmesser');
  assert.equal(r.definition?.get(slant.id), 'free', 'schräge Kante ohne Längenmaß');
  assert.equal(r.definition?.get(bottom.id), 'free', 'Unterkante ohne Längenmaß');
  assert.equal(r.definition?.get(top.id), 'fixed', 'bemaßte Kante');
});

test('Konstruktions-Modus: G schaltet drawAux bei leerer Auswahl (Auswahl-Toggle bleibt erhalten)', () => {
  const sk = M.emptySketch();
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  assert.equal(typeof proto.sketchToggleDrawAux, 'function');
  assert.equal(typeof proto.sketchToggleAux, 'function');
  const s = { tool: 'select', sk, sel: new Set<number>(), drawAux: false, draft: [], draftIds: [], dimPick: [],
    relationPick: undefined, frame: undefined, frameKeys: undefined, polyline: undefined,
    polylinePointer: undefined, centerRectPress: undefined, trimPreview: undefined,
    trimPointer: undefined, trimPressed: undefined, valueEdit: undefined, dimPress: undefined,
    mirrorLineMode: false, snapCycle: undefined, polylineArc: false, dimRoundFlip: undefined } as never;
  const ed = { sketchEdit: s, canvas: {}, hint: '', trackPts: undefined as never,
    emit() {}, redraw() {}, clearSnap() {}, clearTrack() {} } as unknown as Editor;
  Object.setPrototypeOf(ed, proto);
  assert.equal(proto.sketchKey.call(ed, { key: 'g', target: {} }), true);
  assert.equal((s as unknown as { drawAux: boolean }).drawAux, true);
});

test('Punkt-Werkzeug: Esc ohne Mutation (kein Entwurf, kein Undo-Schritt)', () => {
  const sk = M.emptySketch();
  const json = M.sketchJson(sk);
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  const s = { tool: 'point', sk, sel: new Set<number>(), draft: [], draftIds: [], dimPick: [],
    relationPick: undefined, frame: undefined, frameKeys: undefined, polyline: undefined,
    polylinePointer: undefined, centerRectPress: undefined, trimPreview: undefined,
    trimPointer: undefined, trimPressed: undefined, valueEdit: undefined, dimPress: undefined,
    mirrorLineMode: false, snapCycle: undefined, polylineArc: false, dimRoundFlip: undefined } as never;
  const ed = { sketchEdit: s, canvas: {}, hint: '', trackPts: undefined as never,
    emit() {}, redraw() {}, clearSnap() {}, clearTrack() {} } as unknown as Editor;
  Object.setPrototypeOf(ed, proto);
  assert.equal(proto.sketchKey.call(ed, { key: 'Escape', target: {} }), true);
  assert.equal(M.sketchJson(sk), json);
  assert.equal((s as unknown as { tool: string }).tool, 'select');
});

// Paket 1 „Kreis-Varianten": echte Editor-Pipeline (circleTool + sketchDown-Klicks).
// circleMode ist ein Sitzungsfeld wie polygonMode; Default bleibt Mitte+Rand (Legacy).
function circleModeOf(ed: Editor) {
  return (ed.sketchEdit as unknown as { circleMode?: string }).circleMode;
}
function setCircleMode(ed: Editor, mode: string) {
  (ed.sketchEdit as unknown as { circleMode?: string }).circleMode = mode;
}
/** Linie über die Editor-Pipeline ziehen; Entwurf danach verwerfen (kein Kettenzug). */
function drawLine(ed: Editor, click: (x: number, y: number) => void, x1: number, y1: number, x2: number, y2: number) {
  ed.sketchEdit!.tool = 'line';
  click(x1, y1);
  click(x2, y2);
  ed.sketchEdit!.draft = [];
  ed.sketchEdit!.draftIds = [];
}

test('Kreis 2-Punkt: Durchmesser-Enden → Mitte und halbe Distanz, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'twoPoint');
  assert.equal(circleModeOf(ed), 'twoPoint');
  click(0, 0);
  click(10, 0);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, 5);
  near(c.y, 0);
  near(circle.r, 5);
  assert.equal(ssk.cons.filter((con) => con.t === 'pointOnCircle' && con.r[1] === circle.id).length, 2, 'beide Enden auf dem Kreis');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 3-Punkt: Umkreis durch drei Punkte, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'threePoint');
  click(0, 0);
  click(6, 0);
  click(0, 8);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, 3);
  near(c.y, 4);
  near(circle.r, 5);
  assert.equal(ssk.cons.filter((con) => con.t === 'pointOnCircle' && con.r[1] === circle.id).length, 3, 'alle drei Punkte auf dem Kreis');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 3-Punkt: kollineare Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'threePoint');
  click(0, 0);
  click(5, 0);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(10, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Kreis 2-Tangenten: Linie+Linie Klick-Radius → nächstgelegener Schnitt, genau ein Undo', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const l2 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  assert.equal(((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? []).length, 2, 'beide Referenzen gehalten');
  assert.ok(ed.hint.length > 0, 'Radius-Hinweis gesetzt');
  const rNow = CM.twoTangentRadiusFor(ed.sketchEdit!.sk, l1.id, l2.id, { x: 2, y: 5 });
  near(rNow!, 2);
  click(2, 5);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, 2);
  near(c.y, 2);
  near(circle.r, 2);
  for (const ref of [l1, l2]) assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(ref.id)), `Tangente an #${ref.id}`);
  assert.ok(ssk.cons.some((con) => con.t === 'radius' && con.r[0] === circle.id && con.v === 2), 'Radiusmaß');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 2-Tangenten: Kreis+Linie Klick-Radius → nächstgelegener Schnitt', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const cc = fix(0, 0);
  const rim = M.addPt(sk, 5, 0);
  const seed = M.addCircle(sk, cc.id, 5);
  M.addCon(sk, 'pointOnCircle', [rim.id, seed.id]);
  const line = M.addLine(sk, fix(-10, -8).id, fix(10, -8).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(5, 0);
  click(4, -8);
  click(5, -6);
  const ssk = ed.sketchEdit!.sk;
  const found = ssk.ents.filter((e) => e.t === 'circle');
  assert.equal(found.length, 2, 'genau ein neuer Kreis');
  const circle = found.find((e) => e.id !== seed.id)!;
  assert.ok(circle && circle.t === 'circle');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, Math.sqrt(13));
  near(c.y, -6);
  near(circle.r, 2);
  assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(seed.id)), 'Tangente an den Kreis');
  assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(line.id)), 'Tangente an die Linie');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 2-Tangenten: Klick auf Referenz (r≈0) → Hinweis ohne Mutation, Refs bleiben', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const nEnts = M.emptySketch().ents.length;
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(0.5, 0);
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts + 2, 'kein Kreis erzeugt');
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? []).length, 2, 'Refs für Wiederholung gehalten');
});

test('Kreis 2-Tangenten: parallele Linien ohne Kandidat → Hinweis ohne Mutation', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(-10, 10).id, fix(10, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0, 0);
  click(0, 10);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  const n0 = snapshots.length;
  click(0, 2);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Kreis 2-Tangenten: Vorschau-Pfad unter Cursor vor Commit', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const l2 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const preview = CM.twoTangentPreview(sk, l1.id, l2.id, { x: 2, y: 5 });
  assert.ok(preview, 'Vorschau vorhanden');
  near(preview!.center.x, 2);
  near(preview!.center.y, 2);
  near(preview!.radius, 2);
  assert.equal(CM.twoTangentPreview(sk, l1.id, l2.id, { x: 0.5, y: 0 }), null, 'keine Vorschau bei r≈0');
});

test('Kreis 2-Tangenten: Esc nach Referenzen verwirft ohne Mutation, Modus bleibt', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? []).length, 0, 'Esc verwirft die Referenzen');
  assert.equal(circleModeOf(ed), 'twoTangent', 'Modus bleibt gewählt');
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
});

test('Kreis 2-Tangenten: Ellipse als Ziel abgelehnt (keine Mutation)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'ellipse';
  click(20, 0); click(25, 0); click(20, 3);
  assert.ok(ed.sketchEdit!.sk.ents.some((e) => e.t === 'ellipse'));
  const nEnts = ed.sketchEdit!.sk.ents.length;
  const n0 = snapshots.length;
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(25, 0);
  assert.deepEqual((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? [], [], 'keine Referenz übernommen');
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts, 'keine Mutation');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Kreis 3-Tangenten: drei Geraden → Inkreis, genau ein Undo', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const l2 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const l3 = M.addLine(sk, fix(0, 6).id, fix(6, 0).id);
  const refs = [l1, l2, l3];
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'threeTangent');
  click(0, 4);
  click(4, 0);
  click(3, 3);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const r = 6 - 3 * Math.SQRT2;
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, r);
  near(c.y, r);
  near(circle.r, r);
  for (const ref of refs) assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(ref.id)), `Tangente an #${ref.id}`);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 3-Tangenten: drei Parallelen → Hinweis ohne Mutation', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(-10, 5).id, fix(10, 5).id);
  M.addLine(sk, fix(-10, 10).id, fix(10, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  const nEnts = ed.sketchEdit!.sk.ents.length;
  const n0 = snapshots.length;
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'threeTangent');
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(0, 0);
  click(0, 5);
  click(0, 10);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts, 'kein Kreis erzeugt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Kreis 3-Tangenten: Cursor-nächster Ankreis statt Inkreis, genau ein Undo', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(14, 0).id);
  const l2 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const l3 = M.addLine(sk, fix(12, 0).id, fix(-6, 9).id);
  const refs = [l1, l2, l3];
  const cursor = { x: -2.05, y: 7.025 };
  const oracle = CM.threeTangentCandidates(sk, refs.map((e) => e.id), cursor);
  assert.equal(oracle.length, 4, 'Inkreis + 3 Ankreise');
  const incircle = oracle.reduce((a, b) => (a.radius < b.radius ? a : b));
  assert.ok(Math.hypot(oracle[0].center.x - incircle.center.x, oracle[0].center.y - incircle.center.y) > 1, 'Cursor-nächster ist ein Ankreis, nicht der Inkreis');
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'threeTangent');
  click(6, 0);
  click(0, 3);
  click(cursor.x, cursor.y);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, oracle[0].center.x);
  near(c.y, oracle[0].center.y);
  near(circle.r, oracle[0].radius);
  assert.ok(c.x < 0, 'Ankreis liegt außerhalb des Dreiecks');
  for (const ref of refs) {
    const e = M.entOf(ssk, ref.id) as unknown as { a: number; b: number };
    const a = M.ptOf(ssk, e.a)!, b = M.ptOf(ssk, e.b)!;
    const dist = Math.abs((b.x - a.x) * (a.y - c.y) - (a.x - c.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
    near(dist, circle.r);
    assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(ref.id)), `Tangente an #${ref.id}`);
  }
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 2-Tangenten: Klick wählt unter vier Kandidaten den nächsten, genau ein Undo', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const l2 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const oracle = CM.twoTangentCandidates(sk, l1.id, l2.id, 2, { x: -2, y: -4 });
  assert.equal(oracle.length, 4, 'vier Tangentialkreise');
  near(oracle[0].x, -2);
  near(oracle[0].y, -2);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(5, 0);
  click(0, 3);
  click(-2, -4);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, -2);
  near(c.y, -2);
  near(circle.r, 2);
  near(c.x, oracle[0].x);
  near(c.y, oracle[0].y);
  for (const ref of [l1, l2]) assert.ok(ssk.cons.some((con) => con.t === 'tangent' && con.r.includes(circle.id) && con.r.includes(ref.id)), `Tangente an #${ref.id}`);
  assert.ok(ssk.cons.some((con) => con.t === 'radius' && con.r[0] === circle.id && con.v === 2), 'Radiusmaß');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis Legacy-Default: Mitte+Rand unverändert (ein pointOnCircle)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  assert.equal(circleModeOf(ed), undefined, 'kein Modus gesetzt');
  drawLine(ed, click, 20, 0, 30, 0);
  ed.sketchEdit!.tool = 'circle';
  click(0, 0);
  click(20, 0);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  const c = M.ptOf(ssk, circle.c)!;
  near(c.x, 0);
  near(c.y, 0);
  near(circle.r, 20);
  assert.equal(ssk.cons.filter((con) => con.t === 'pointOnCircle' && con.r[1] === circle.id).length, 1, 'genau eine Randbindung');
  assert.equal(snapshots.length, 2, 'Linie und Kreis je ein Undo-Schritt');
});

// Querschnitts-Härtung Paket 1 „Kreis-Varianten" (Pipeline-Tests über circleTool-Harness).
test('Kreis Gleich: 3-Punkt-Kreis mit Radiusmaß vs Maß-Kreis → Folge driven, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'threePoint');
  click(0, 0);
  click(6, 0);
  click(0, 8);
  delete (ed.sketchEdit as unknown as { circleMode?: string }).circleMode;
  click(30, 0);
  click(45, 0);
  const ssk = ed.sketchEdit!.sk;
  const kids = ssk.ents.filter((e) => e.t === 'circle').map((e) => e.id);
  assert.equal(kids.length, 2, 'beide Kreise vorhanden');
  const d1 = M.addCon(ssk, 'radius', [kids[0]], { v: 5 });
  const d2 = M.addCon(ssk, 'radius', [kids[1]], { v: 15 });
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([kids[0], kids[1]]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  near((M.entOf(after, kids[0]) as { r: number }).r, 5);
  near((M.entOf(after, kids[1]) as { r: number }).r, 5);
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Kreis Gleich: 2-Tangenten-Kreis (Radiusmaß) vs Maß-Kreis → Folge driven, ein Undo', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const l2 = M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  click(2, 5);
  delete (ed.sketchEdit as unknown as { circleMode?: string }).circleMode;
  click(30, 0);
  click(35, 0);
  const ssk = ed.sketchEdit!.sk;
  const kids = ssk.ents.filter((e) => e.t === 'circle').map((e) => e.id);
  assert.equal(kids.length, 2, 'Tangential- und Maß-Kreis vorhanden');
  const masterDim = ssk.cons.find((c) => c.t === 'radius' && c.r[0] === kids[0]);
  assert.ok(masterDim, 'Tangentialkreis trägt Radiusmaß');
  const d2 = M.addCon(ssk, 'radius', [kids[1]], { v: 5 });
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([kids[0], kids[1]]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === masterDim!.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  near((M.entOf(after, kids[0]) as { r: number }).r, 2);
  near((M.entOf(after, kids[1]) as { r: number }).r, 2);
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(l1.id + l2.id > 0, true, 'Referenzlinien vorhanden');
});

test('Bemaßung: D-Werkzeug auf 2-Tangenten-Kreis erzeugt Durchmesser-Maß', async () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  click(2, 5);
  const circle = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'circle')[0];
  assert.ok(circle && circle.t === 'circle', 'Tangentialkreis vorhanden');
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 4 })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: circle.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  const dia = after.cons.find((c) => c.t === 'diameter' && c.r[0] === circle.id);
  assert.ok(dia, 'Durchmesser-Maß angelegt');
  assert.equal((dia as M.SkCon | undefined)?.driven, true, 'Durchmesser ist Referenz (Radius bestimmt bereits)');
  assert.equal(snapshots.length, n0 + 1, 'genau ein weiterer Undo-Schritt');
});

test('Bemaßung: überbestimmter Rejekt legt keinen Param an (paramList unverändert)', async () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  M.addLine(sk, fix(0, -10).id, fix(0, 10).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0.5, 0);
  click(0, 5);
  click(2, 5);
  const circle = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'circle')[0];
  assert.ok(circle && circle.t === 'circle', 'Tangentialkreis vorhanden');
  const params: { name: string; value: number }[] = [];
  (ed as unknown as { paramList: () => { name: string; value: number }[] }).paramList = () => params;
  (ed as unknown as { findParam: (n: string) => undefined }).findParam = () => undefined;
  (ed as unknown as { addParam: (t: string, init: object) => object }).addParam = (_t: string, init: object) => {
    const p = { ...(init as object) } as { name: string; value: number };
    params.push(p);
    return p;
  };
  const nCons = ed.sketchEdit!.sk.cons.length;
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 10, pendingParam: { name: 'P9', value: 10 } })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: circle.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.equal(after.cons.length, nCons, 'kein Maß angelegt');
  assert.ok(!after.cons.some((c) => c.t === 'diameter' && c.v === 10), 'widersprüchlicher Durchmesser abgewiesen');
  assert.equal(params.length, 0, 'kein Param angelegt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});


test('Tangentenziele: Ellipse als zweite Referenz abgelehnt (erste bleibt, kein Kreis)', () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const l1 = M.addLine(sk, fix(-10, 0).id, fix(10, 0).id);
  const { ed, snapshots, click } = circleTool(sk);
  ed.sketchEdit!.tool = 'ellipse';
  click(20, 0);
  click(25, 0);
  click(20, 3);
  assert.ok(ed.sketchEdit!.sk.ents.some((e) => e.t === 'ellipse'), 'Ellipse vorhanden');
  const n0 = snapshots.length;
  const nEnts = ed.sketchEdit!.sk.ents.length;
  ed.sketchEdit!.tool = 'circle';
  setCircleMode(ed, 'twoTangent');
  click(0, 0);
  assert.deepEqual((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? [], [l1.id], 'erste Referenz gehalten');
  click(25, 0);
  assert.deepEqual((ed.sketchEdit as unknown as { circleRefs?: number[] }).circleRefs ?? [], [l1.id], 'Ellipse nicht übernommen');
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts, 'kein Kreis erzeugt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Konstruktions-Modus: 2-Punkt-Kreis wird aux und bleibt profilfrei (ein Undo)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'twoPoint');
  ed.sketchToggleDrawAux();
  assert.equal(ed.sketchEdit!.drawAux, true, 'Konstruktions-Modus ein');
  const profileBefore = ed.sketchEdit!.sk.ents.filter((e) => !e.aux).length;
  click(0, 0);
  click(10, 0);
  const ssk = ed.sketchEdit!.sk;
  const circle = ssk.ents.find((e) => e.t === 'circle');
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  assert.equal(circle.aux, true, 'Kreis ist Hilfsgeometrie');
  assert.ok(ssk.ents.length > 0 && ssk.ents.every((e) => e.aux), 'alle neuen Entities aux');
  assert.equal(ssk.ents.filter((e) => !e.aux).length, profileBefore, 'kein Profilzuwachs');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Kreis 2-Punkt: identische Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  setCircleMode(ed, 'twoPoint');
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(5, 5);
  click(5, 5);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.includes('verschieden'), `eigener Hinweis, kein Solver-Fallback: ${ed.hint}`);
});

// Paket 2 „Rechteck-Rest": echte Editor-Pipeline (circleTool-Harness + sketchDown-Klicks).
// rectMode ist ein Sitzungsfeld wie polygonMode/circleMode; Default bleibt 2 Ecken (Legacy).
function rectModeOf(ed: Editor) {
  return (ed.sketchEdit as unknown as { rectMode?: string }).rectMode;
}
function setRectMode(ed: Editor, mode: string) {
  (ed.sketchEdit as unknown as { rectMode?: string }).rectMode = mode;
}
function rectTool(ed: Editor) {
  ed.sketchEdit!.tool = 'rect';
}
const sortedRectNodes = (sk: Sk) => M.sketchSubs(sk)[0].nodes.map(({ x, y }) => [Math.round(x), Math.round(y)] as const)
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('Rechteck 3-Punkt: Kante + Tiefe → exakte Ecken, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  assert.equal(rectModeOf(ed), 'threePoint');
  click(0, 0);
  click(10, 0);
  click(3, 4);
  const ssk = ed.sketchEdit!.sk;
  assert.equal(ssk.ents.filter((e) => e.t === 'line').length, 4, 'vier Seiten');
  assert.equal(ssk.cons.filter((c) => c.t === 'parallel').length, 2, 'gegenüberliegende Seiten parallel');
  assert.equal(ssk.cons.filter((c) => c.t === 'perpendicular').length, 1, 'eine rechte Ecke');
  assert.deepEqual(sortedRectNodes(ssk).map(([x, y]) => [x, y]), [[0, 0], [0, 4], [10, 0], [10, 4]]);
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf nach Erfolg leer');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Rechteck 3-Punkt: schräge Kante → parallel/senkrecht ohne H/V-Zwang', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  click(0, 0);
  click(4, 3);
  click(1, 5);
  const ssk = ed.sketchEdit!.sk;
  const lines = ssk.ents.filter((e) => e.t === 'line');
  assert.equal(lines.length, 4, 'vier Seiten');
  assert.ok(!ssk.cons.some((c) => c.t === 'horizontal' || c.t === 'vertical'), 'kein H/V-Zwang bei schräger Kante');
  assert.equal(ssk.cons.filter((c) => c.t === 'parallel').length, 2, 'zwei Parallelen');
  assert.equal(ssk.cons.filter((c) => c.t === 'perpendicular').length, 1, 'eine Senkrechte');
  assert.ok(S.solveSketch(ssk).ok, 'lösbar');
  const edge = lines[0].id, depth = lines[1].id;
  near(M.measureCon(ssk, { id: 0, t: 'distance', r: [edge] })!, 5, 1e-6);
  near(M.measureCon(ssk, { id: 0, t: 'distance', r: [depth] })!, 3.4, 1e-6);
  near(M.measureCon(ssk, { id: 0, t: 'angle', r: [edge, depth] })!, 90, 1e-4);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Rechteck Mitte-Ecke: Anker ist Mittelpunkt, symmetrische Ecken, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  rectTool(ed);
  setRectMode(ed, 'centerCorner');
  click(5, 5);
  click(9, 8);
  const ssk = ed.sketchEdit!.sk;
  assert.deepEqual(sortedRectNodes(ssk).map(([x, y]) => [x, y]), [[1, 2], [1, 8], [9, 2], [9, 8]]);
  const anchor = ssk.pts.find((p) => Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 5) < 1e-9);
  assert.ok(anchor, 'Ankerpunkt vorhanden');
  const diagonal = ssk.ents.find((e) => e.t === 'line' && e.aux);
  assert.ok(diagonal && diagonal.t === 'line', 'Hilfsdiagonale vorhanden');
  assert.ok(ssk.cons.some((c) => c.t === 'midpoint' && c.r[0] === anchor.id && c.r[1] === diagonal.id), 'Anker ist Mittelpunkt');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Rechteck Mitte-Ecke: gefangener Anker (Linienmitte) bleibt an der Quelle gebunden', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  drawLine(ed, click, 0, 0, 40, 0);
  const source = sk.ents.find((e) => e.t === 'line')!;
  rectTool(ed);
  setRectMode(ed, 'centerCorner');
  click(20, 0);
  click(26, 12);
  const ssk = ed.sketchEdit!.sk;
  const anchor = ssk.cons.find((c) => c.t === 'midpoint' && c.r[1] === source.id);
  assert.ok(anchor, 'Anker hängt an der Linienmitte');
  const outline = M.sketchSubs(ssk).find((s) => s.closed && s.nodes.length === 4);
  assert.ok(outline, 'geschlossenes Viereck vorhanden');
  assert.deepEqual(outline.nodes.map(({ x, y }) => [Math.round(x), Math.round(y)] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([x, y]) => [x, y]),
    [[14, -12], [14, 12], [26, -12], [26, 12]]);
  assert.equal(snapshots.length, 2, 'Linie und Rechteck je ein Undo-Schritt');
});

test('Rechteck 3-Punkt: kollineare Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  click(0, 0);
  click(5, 0);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(10, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Rechteck Mitte-Ecke: identische Punkte → Hinweis, keine Mutation, kein Undo', () => {
  for (const corner of [{ x: 5, y: 5 }, { x: 5, y: 9 }, { x: 9, y: 5 }]) {
    const sk = M.emptySketch();
    const { ed, snapshots, click } = circleTool(sk);
    ed.snapObjects = false;
    rectTool(ed);
    setRectMode(ed, 'centerCorner');
    click(5, 5);
    const before = M.sketchJson(ed.sketchEdit!.sk);
    click(corner.x, corner.y);
    assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, `keine Mutation für ${JSON.stringify(corner)}`);
    assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
    assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  }
});

test('Rechteck Legacy-Default: 2 Ecken unverändert (H/V, ein Undo)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  assert.equal(rectModeOf(ed), undefined, 'kein Modus gesetzt');
  rectTool(ed);
  click(0, 0);
  click(10, 20);
  const ssk = ed.sketchEdit!.sk;
  assert.equal(ssk.ents.filter((e) => e.t === 'line').length, 4, 'vier Seiten');
  assert.equal(ssk.cons.filter((c) => c.t === 'horizontal').length, 2, 'zwei Waagrechte');
  assert.equal(ssk.cons.filter((c) => c.t === 'vertical').length, 2, 'zwei Senkrechte');
  assert.deepEqual(sortedRectNodes(ssk).map(([x, y]) => [x, y]), [[0, 0], [0, 20], [10, 0], [10, 20]]);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

// Querschnitts-Härtung Paket 2 „Rechteck-Rest" (Pipeline-Tests über circleTool-Harness).
test('Rechteck Gleich: 3-Punkt-Rechteck mit treibender Breite + 2. Form → Folge driven, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  click(0, 0);
  click(10, 0);
  click(3, 4);
  setRectMode(ed, 'corners');
  click(30, 30);
  click(50, 50);
  const ssk = ed.sketchEdit!.sk;
  const sides = ssk.ents.filter((e) => e.t === 'line');
  assert.equal(sides.length, 8, 'beide Rechtecke vorhanden');
  const d1 = M.addCon(ssk, 'distance', [sides[0].id], { v: 10 });
  const d2 = M.addCon(ssk, 'distance', [sides[4].id], { v: 20 });
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([sides[0].id, sides[4].id]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Bemaßung: D-Werkzeug auf Rechteckseite erzeugt Abstands-Maß', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  rectTool(ed);
  setRectMode(ed, 'centerCorner');
  click(5, 5);
  click(9, 8);
  const side = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'line' && !e.aux)[0];
  assert.ok(side && side.t === 'line', 'Rechteckseite vorhanden');
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 8 })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: side.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'distance' && c.r[0] === side.id), 'Abstands-Maß angelegt');
  assert.equal(snapshots.length, n0 + 1, 'genau ein weiterer Undo-Schritt');
});

test('Bemaßung: Rejekt auf fixiertem Rechteck legt keinen Param an (params unverändert, kein Undo)', async () => {
  const sk = M.emptySketch();
  const fix = (x: number, y: number) => { const p = M.addPt(sk, x, y); M.addCon(sk, 'fixed', [p.id], { x, y }); return p; };
  const a = fix(0, 0), b = fix(10, 0), c = fix(10, 4), d = fix(0, 4);
  const sides = [M.addLine(sk, a.id, b.id), M.addLine(sk, b.id, c.id), M.addLine(sk, c.id, d.id), M.addLine(sk, d.id, a.id)];
  M.addCon(sk, 'horizontal', [sides[0].id]);
  const { ed, snapshots } = circleTool(sk);
  const params: { name: string; value: number }[] = [];
  (ed as unknown as { paramList: () => { name: string; value: number }[] }).paramList = () => params;
  (ed as unknown as { findParam: (n: string) => undefined }).findParam = () => undefined;
  (ed as unknown as { addParam: (t: string, init: object) => object }).addParam = (_t: string, init: object) => {
    const p = { ...(init as object) } as { name: string; value: number };
    params.push(p);
    return p;
  };
  const nCons = ed.sketchEdit!.sk.cons.length;
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 11, pendingParam: { name: 'P9', value: 11 } })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: sides[0].id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.equal(after.cons.length, nCons, 'kein Maß angelegt');
  assert.ok(!after.cons.some((c) => c.t === 'distance' && c.v === 11), 'widersprüchliches Maß abgewiesen');
  assert.equal(params.length, 0, 'kein Param angelegt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});


test('Rechteck: Esc/Toolwechsel resettet Modus-Refs', () => {
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  click(0, 0);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Kantenanfang liegt im Entwurf');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Esc verwirft den Entwurf');
  assert.equal(rectModeOf(ed), 'threePoint', 'Modus bleibt gewählt');
  click(0, 0);
  ed.setSketchTool('select');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Toolwechsel verwirft den Entwurf');
});

test('Rechteck: Hinweistext je Modus (t-abgedeckt)', () => {
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  const hints = new Set<string>();
  for (const mode of [undefined, 'threePoint', 'centerCorner'] as const) {
    const s = { tool: 'rect', rectMode: mode, sk: M.emptySketch(), sel: new Set<number>(), draft: [], draftIds: [], dimPick: [],
      relationPick: undefined, polyline: undefined, polylineArc: false } as never;
    const ed = { sketchEdit: s, hint: '', emit() {}, redraw() {}, clearTrack() {} } as unknown as Editor;
    Object.setPrototypeOf(ed, proto);
    (ed as unknown as { sketchHint: () => void }).sketchHint();
    const hint = (ed as unknown as { hint: string }).hint;
    assert.ok(hint.length > 0, `Hinweis für ${mode ?? 'corners'} vorhanden`);
    hints.add(hint);
  }
  assert.equal(hints.size, 3, 'jeder Modus hat eigenen Hinweis');
});

test('Konstruktions-Modus: 3-Punkt-Rechteck wird aux und bleibt profilfrei (ein Undo)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  rectTool(ed);
  setRectMode(ed, 'threePoint');
  ed.sketchToggleDrawAux();
  assert.equal(ed.sketchEdit!.drawAux, true, 'Konstruktions-Modus ein');
  click(0, 0);
  click(10, 0);
  click(3, 4);
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.ents.length > 0 && ssk.ents.every((e) => e.aux), 'alle neuen Elemente aux');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Rechteck-Vorschau: 3-Punkt-Draft schräg unter Non-Identity (Zoom/Offset/dpr)', async () => {
  const RM = await import('../src/sketch/rectModes');
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const ZOOM = 2, OX = 30, OY = -17, DPR = 2;
  const a = { x: 0, y: 0 }, b = { x: 4, y: 3 }, depth = { x: 1, y: 5 };
  const expected = RM.threePointRectCorners(a, b, depth);
  assert.ok(expected, 'Orakel liefert schräge Ecken');
  const toScr = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * ZOOM + OX, y: p.y * ZOOM + OY });
  const moves: Array<[number, number]> = [];
  const lines: Array<[number, number]> = [];
  let closes = 0, rects = 0;
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
      if (prop === 'lineTo') return (x: number, y: number) => { lines.push([x, y]); };
      if (prop === 'closePath') return () => { closes++; };
      if (prop === 'rect') return () => { rects++; };
      return () => {};
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
  const sk = M.emptySketch();
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
    status: { ok: true, dof: 1, conflicting: [], redundant: [] }, labels: [],
    tool: 'rect', rectMode: 'threePoint', draft: [a, b], draftIds: [], dimPick: [],
  };
  const ed = {
    dark: false, dpr: DPR, view: { zoom: ZOOM, ox: OX, oy: OY }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { ...depth }, cursorOnCanvas: true,
    syncSketch() {},
    toScreen: toScr,
    toWorld: (sx: number, sy: number) => ({ x: (sx - OX) / ZOOM, y: (sy - OY) / ZOOM }),
    skToScreen: toScr, skFromWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => ZOOM,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
  renderSketch.call(ed, ctx);
  const drawn = [...moves, ...lines];
  for (const corner of expected) {
    const s = toScr(corner);
    assert.ok(drawn.some(([x, y]) => Math.abs(x - s.x) < 1e-9 && Math.abs(y - s.y) < 1e-9),
      `Ecke transformiert gezeichnet: ${JSON.stringify(s)} in ${JSON.stringify(drawn)}`);
  }
  assert.equal(rects, 0, 'schräger Draft ohne ctx.rect-Schnellpfad (Polygon-Pfad)');
  assert.equal(moves.length, 1, JSON.stringify({ moves }));
  assert.equal(lines.length, 3, JSON.stringify({ lines }));
  assert.equal(closes, 1, JSON.stringify({ closes }));
});

test('Rechteck Mitte-Ecke: alle Quadranten symmetrisch um Anker, je ein Undo', () => {
  for (const corner of [{ x: 1, y: 2 }, { x: 1, y: 8 }, { x: 9, y: 2 }]) {
    const sk = M.emptySketch();
    const { ed, snapshots, click } = circleTool(sk);
    ed.snapObjects = false;
    rectTool(ed);
    setRectMode(ed, 'centerCorner');
    click(5, 5);
    click(corner.x, corner.y);
    const ssk = ed.sketchEdit!.sk;
    const pts = M.sketchSubs(ssk)[0].nodes.map(({ x, y }) => [Math.round(x), Math.round(y)]);
    assert.equal(pts.length, 4, `vier Ecken für ${JSON.stringify(corner)}`);
    const key = (x: number, y: number) => `${x},${y}`;
    const set = new Set(pts.map(([x, y]) => key(x, y)));
    assert.ok(set.has(key(corner.x, corner.y)), `Ecke vorhanden für ${JSON.stringify(corner)}`);
    assert.ok(set.has(key(10 - corner.x, 10 - corner.y)), `Gegenecke 2*Anker−Ecke für ${JSON.stringify(corner)}`);
    for (const [x, y] of pts) assert.ok(set.has(key(10 - x, 10 - y)), `symmetrisch um Anker für ${JSON.stringify(corner)}`);
    assert.equal(snapshots.length, 1, `genau ein Undo-Schritt für ${JSON.stringify(corner)}`);
  }
});

test('Konstruktions-Modus: Mitte-Ecke-Rechteck wird aux und bleibt profilfrei (ein Undo)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  rectTool(ed);
  setRectMode(ed, 'centerCorner');
  ed.sketchToggleDrawAux();
  assert.equal(ed.sketchEdit!.drawAux, true, 'Konstruktions-Modus ein');
  const profileBefore = ed.sketchEdit!.sk.ents.filter((e) => !e.aux).length;
  click(5, 5);
  click(9, 8);
  const ssk = ed.sketchEdit!.sk;
  assert.ok(ssk.ents.length > 0 && ssk.ents.every((e) => e.aux), 'alle neuen Entities aux');
  assert.equal(ssk.ents.filter((e) => !e.aux).length, profileBefore, 'kein Profilzuwachs');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

// Paket 3 „Slot-Rest": echte Editor-Pipeline (circleTool-Harness + Down/Up-Klicks).
// slotMode ist ein Sitzungsfeld wie circleMode/rectMode; Default bleibt Mitte-zu-Mitte (Legacy).
function slotModeOf(ed: Editor) {
  return (ed.sketchEdit as unknown as { slotMode?: string }).slotMode;
}
function setSlotMode(ed: Editor, mode: string) {
  (ed.sketchEdit as unknown as { slotMode?: string }).slotMode = mode;
}
function slotTool(ed: Editor) {
  ed.sketchEdit!.tool = 'slot';
}
/** Slot-Klick über Down+Up (Formplatzierung läuft in sketchUp); gleiche pointerId pro Klick. */
function slotClick(ed: Editor, x: number, y: number) {
  if (!(ed as unknown as { canvas?: unknown }).canvas) {
    (ed as unknown as { canvas: unknown }).canvas = { focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  }
  if (typeof (ed as unknown as { evPt?: unknown }).evPt !== 'function') {
    (ed as unknown as { evPt: unknown }).evPt = (e: { clientX: number; clientY: number }) => ({ sx: e.clientX, sy: e.clientY });
  }
  if ((ed as unknown as { w?: number }).w === undefined) (ed as unknown as { w: number }).w = 800;
  if ((ed as unknown as { h?: number }).h === undefined) (ed as unknown as { h: number }).h = 600;
  const { x: sx, y: sy } = ed.skToScreen({ x, y });
  const ev = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 7, clientX: sx, clientY: sy, button: 0 } as unknown as PointerEvent;
  ed.sketchDown(sx, sy, ev);
  ed.sketchUp(ev);
}
const slotCapsOf = (sk: Sk) => sketchSlots(sk);

test('Slot Mitte-zu-Mitte: zwei Zentren + Breite, Cons wie Bestand, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'centerToCenter');
  assert.equal(slotModeOf(ed), 'centerToCenter');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'genau ein Slot erkannt');
  const [slot] = found;
  const a = M.ptOf(ssk, slot.left.c)!, b = M.ptOf(ssk, slot.right.c)!;
  near(a.x, 10); near(a.y, 10); near(b.x, 34); near(b.y, 28);
  near(slot.breadth, 8);
  near(slot.centerDistance, 30);
  assert.equal(ssk.cons.filter((c) => c.t === 'diameter').length, 1, 'treibende Breite');
  assert.equal(ssk.cons.filter((c) => c.t === 'parallel').length, 1, 'parallele Seiten');
  assert.equal(ssk.cons.filter((c) => c.t === 'perpendicular').length, 4, 'vier Seitenanschlüsse');
  assert.ok(ssk.cons.some((c) => c.t === 'distance' && c.r.length === 1), 'Mittelpunktsabstand');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf nach Erfolg leer');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Slot Gesamtlänge: Enden + Breite → Mitten = Enden − r entlang Achse', async () => {
  const SM = await import('../src/sketch/slotModes');
  const centers = SM.slotCentersFromOverall({ x: 0, y: 0 }, { x: 28, y: 0 }, 8);
  assert.ok(centers, 'Umrechnung möglich');
  near(centers.start.x, 4); near(centers.start.y, 0); near(centers.end.x, 24); near(centers.end.y, 0);
  assert.equal(SM.slotCentersFromOverall({ x: 0, y: 0 }, { x: 6, y: 0 }, 8), null, 'Endenabstand ≤ Breite entartet');
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'overall');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'genau ein Slot erkannt');
  const [slot] = found;
  const a = M.ptOf(ssk, slot.left.c)!, b = M.ptOf(ssk, slot.right.c)!;
  near(a.x, 13.2); near(a.y, 12.4); near(b.x, 30.8); near(b.y, 25.6);
  near(slot.breadth, 8);
  near(slot.total, 30);
  assert.equal(ssk.cons.filter((c) => c.t === 'diameter').length, 1, 'treibende Breite');
  assert.equal(ssk.cons.filter((c) => c.t === 'parallel').length, 1, 'parallele Seiten');
  assert.equal(ssk.cons.filter((c) => c.t === 'perpendicular').length, 4, 'vier Seitenanschlüsse');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Slot Bogenmitte: Mitte + Start + Ende + Breite, Anschlussbögen tangent', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'arcCenter');
  slotClick(ed, 10, 10);
  slotClick(ed, 20, 10);
  slotClick(ed, 10, 20);
  slotClick(ed, 22, 10);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'Bogenslot erkannt');
  const [slot] = found;
  near(slot.breadth, 4);
  const caps = [slot.left, slot.right] as unknown as Array<{ id: number; c: number; s: number; e: number; r: number }>;
  for (const cap of caps) near(cap.r, 2);
  const sides = slot.sides.filter((e) => e.t === 'arc') as unknown as Array<{ id: number; c: number; s: number; e: number; r: number }>;
  assert.equal(sides.length, 2, 'zwei Bogenseiten');
  const radii = sides.map((e) => e.r).sort((x, y) => x - y);
  near(radii[0], 8); near(radii[1], 12);
  assert.equal(sides[0].c, sides[1].c, 'Seiten konzentrisch');
  // Fugensicherung: je Seite zwei Tangenten zu trimSupport-Hilfslinien.
  const tangents = ssk.cons.filter((c) => c.t === 'tangent');
  assert.equal(tangents.length, 4, 'vier Fugentangenten');
  for (const side of sides) {
    const atSide = tangents.filter((c) => c.r.includes(side.id));
    assert.equal(atSide.length, 2, `zwei Fugentangenten an Seite #${side.id}`);
    for (const c of atSide) {
      const other = ssk.ents.find((e) => e.id === c.r.find((id) => id !== side.id));
      assert.ok(other?.t === 'line' && !!other.trimSupport, 'Tangente an trimSupport-Hilfslinie');
    }
  }
  // G1 geometrisch: Fugenradius und Kappenradius sind kollinear.
  for (const jid of new Set(sides.flatMap((s) => [s.s, s.e]))) {
    const j = M.ptOf(ssk, jid)!, o = M.ptOf(ssk, sides[0].c)!;
    const cap = caps.find((c) => c.s === jid || c.e === jid)!;
    const cc = M.ptOf(ssk, cap.c)!;
    const cross = (j.x - o.x) * (j.y - cc.y) - (j.y - o.y) * (j.x - cc.x);
    assert.ok(Math.abs(cross) < 1e-6, `glatter Übergang an Fuge #${jid}`);
  }
  assert.ok(S.solveSketch(ssk).ok, 'Bogenslot lösbar');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Slot Bogen-3-Punkt: Start + Durchgang + Ende, Umkreisbogen als Mittellinie', async () => {
  const SM = await import('../src/sketch/slotModes');
  assert.equal(SM.arcSlotSpineThrough({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }), null, 'kollinear → kein Bogen (Hinweis statt Fallback)');
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'arcThreePoint');
  slotClick(ed, 30, 10);
  slotClick(ed, 20, 20);
  slotClick(ed, 10, 10);
  slotClick(ed, 32, 10);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'Bogenslot erkannt');
  const [slot] = found;
  near(slot.breadth, 4);
  const sides = slot.sides.filter((e) => e.t === 'arc') as unknown as Array<{ id: number; c: number; s: number; e: number; r: number }>;
  assert.equal(sides.length, 2, 'zwei Bogenseiten');
  const radii = sides.map((e) => e.r).sort((x, y) => x - y);
  assert.deepEqual(radii.map((r) => Math.round(r)), [8, 12]);
  assert.equal(sides[0].c, sides[1].c, 'Seiten konzentrisch');
  const tangents = ssk.cons.filter((c) => c.t === 'tangent');
  assert.equal(tangents.length, 4, 'vier Fugentangenten');
  for (const side of sides) {
    const atSide = tangents.filter((c) => c.r.includes(side.id));
    assert.equal(atSide.length, 2, `zwei Fugentangenten an Seite #${side.id}`);
    for (const c of atSide) {
      const other = ssk.ents.find((e) => e.id === c.r.find((id) => id !== side.id));
      assert.ok(other?.t === 'line' && !!other.trimSupport, 'Tangente an trimSupport-Hilfslinie');
    }
  }
  // G1 geometrisch: Fugenradius und Kappenradius sind kollinear.
  const caps = [slot.left, slot.right] as unknown as Array<{ id: number; c: number; s: number; e: number }>;
  for (const jid of new Set(sides.flatMap((s) => [s.s, s.e]))) {
    const j = M.ptOf(ssk, jid)!, o = M.ptOf(ssk, sides[0].c)!;
    const cap = caps.find((c) => c.s === jid || c.e === jid)!;
    const cc = M.ptOf(ssk, cap.c)!;
    const cross = (j.x - o.x) * (j.y - cc.y) - (j.y - o.y) * (j.x - cc.x);
    assert.ok(Math.abs(cross) < 1e-6, `glatter Übergang an Fuge #${jid}`);
  }
  assert.ok(S.solveSketch(ssk).ok, 'Bogenslot lösbar');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Slot Bogen-3-Punkt: Durchgang auf CW-Seite → Spine läuft durch T, genau ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'arcThreePoint');
  slotClick(ed, 30, 20);
  slotClick(ed, 20, 10);
  slotClick(ed, 10, 20);
  slotClick(ed, 32, 20);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'Bogenslot erkannt');
  near(found[0].breadth, 4);
  const t = ssk.pts.find((p) => Math.abs(p.x - 20) < 1e-9 && Math.abs(p.y - 10) < 1e-9);
  assert.ok(t, 'Durchgangspunkt vorhanden');
  const spine = ssk.ents.find((e) => e.t === 'arc' && !!e.trimSupport);
  assert.ok(spine && spine.t === 'arc', 'Mittellinie vorhanden');
  assert.ok(ssk.cons.some((c) => c.t === 'pointOnCircle' && c.r.includes(t.id) && c.r.includes(spine.id)),
    'Durchgang liegt auf der Mittellinie');
  assert.ok(S.solveSketch(ssk).ok, 'Bogenslot lösbar');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Slot Bogen-3-Punkt: kollineare Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'arcThreePoint');
  slotClick(ed, 10, 10);
  slotClick(ed, 15, 10);
  slotClick(ed, 20, 10);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  slotClick(ed, 15, 14);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf verworfen');
});

test('Slot Entartung: Breite ≤ 0 → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'overall');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  slotClick(ed, 22, 19);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Slot Entartung: identische Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'overall');
  slotClick(ed, 15, 15);
  slotClick(ed, 15, 15);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  slotClick(ed, 15, 19);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Slot Legacy-Default: ohne Modus wie heutiger 3-Klick-Fluss', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  assert.equal(slotModeOf(ed), undefined, 'kein Modus gesetzt');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 1, 'genau ein Slot erkannt');
  near(found[0].breadth, 8);
  near(found[0].centerDistance, 30);
  assert.equal(ssk.cons.filter((c) => c.t === 'diameter').length, 1, 'treibende Breite');
  assert.equal(ssk.cons.filter((c) => c.t === 'parallel').length, 1, 'parallele Seiten');
  assert.equal(ssk.cons.filter((c) => c.t === 'perpendicular').length, 4, 'vier Seitenanschlüsse');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

// Querschnitts-Härtung Paket 3 „Slot-Rest" (Pipeline-Tests über circleTool-Harness).
test('Slot Gleich: treibende Breite + 2. Form → Folge driven, Master treibend, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'centerToCenter');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  slotClick(ed, 50, 10);
  slotClick(ed, 74, 28);
  slotClick(ed, 58.4, 23.8);
  const ssk = ed.sketchEdit!.sk;
  const found = slotCapsOf(ssk);
  assert.equal(found.length, 2, 'beide Slots erkannt');
  near(found[0].breadth, 8);
  near(found[1].breadth, 12);
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([found[0].left.id, found[1].left.id]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === found[0].width.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === found[1].width.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Bemaßung: D-Werkzeug auf Slot-Breite erzeugt Radius-Referenz', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'centerToCenter');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  const cap = slotCapsOf(ed.sketchEdit!.sk)[0].left.id;
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 4 })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: cap });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  const rad = after.cons.find((c) => c.t === 'radius' && c.r[0] === cap);
  assert.ok(rad, 'Radius-Maß an der Kappe angelegt');
  assert.equal(rad.driven, true, 'Radius ist Referenz (Durchmesser bestimmt bereits)');
  assert.equal(snapshots.length, n0 + 1, 'genau ein weiterer Undo-Schritt');
});

test('Bemaßung: Rejekt am fixierten Slot legt keinen Param an (params unverändert, kein Undo)', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'overall');
  slotClick(ed, 10, 10);
  slotClick(ed, 34, 28);
  slotClick(ed, 19.6, 22.2);
  for (const p of ed.sketchEdit!.sk.pts) M.addCon(ed.sketchEdit!.sk, 'fixed', [p.id], { x: p.x, y: p.y });
  const cap = slotCapsOf(ed.sketchEdit!.sk)[0].left.id;
  const params: { name: string; value: number }[] = [];
  (ed as unknown as { paramList: () => { name: string; value: number }[] }).paramList = () => params;
  (ed as unknown as { findParam: (n: string) => undefined }).findParam = () => undefined;
  (ed as unknown as { addParam: (t: string, init: object) => object }).addParam = (_t: string, init: object) => {
    const p = { ...(init as object) } as { name: string; value: number };
    params.push(p);
    return p;
  };
  const nCons = ed.sketchEdit!.sk.cons.length;
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 10, pendingParam: { name: 'P9', value: 10 } })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: cap });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.equal(after.cons.length, nCons, 'kein Maß angelegt');
  assert.ok(!after.cons.some((c) => c.t === 'radius' && c.v === 10), 'widersprüchlicher Radius abgewiesen');
  assert.equal(params.length, 0, 'kein Param angelegt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});


test('Slot: Esc/Toolwechsel resettet Modus-Refs, Modus bleibt gewählt', () => {
  const sk = M.emptySketch();
  const { ed } = circleTool(sk);
  ed.snapObjects = false;
  slotTool(ed);
  setSlotMode(ed, 'arcCenter');
  slotClick(ed, 10, 10);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Mitte liegt im Entwurf');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Esc verwirft den Entwurf');
  assert.equal(slotModeOf(ed), 'arcCenter', 'Modus bleibt gewählt');
  slotClick(ed, 10, 10);
  ed.setSketchTool('select');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Toolwechsel verwirft den Entwurf');
});

test('Slot-Vorschau: Bogen-Draft unter Non-Identity (Zoom/Offset/dpr)', async () => {
  await import('../src/sketch/slotModes');
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const ZOOM = 2, OX = 30, OY = -17;
  const center = { x: 0, y: 0 }, start = { x: 10, y: 0 };
  const cursor = { x: 0, y: 10 };
  const toScr = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * ZOOM + OX, y: p.y * ZOOM + OY });
  const moves: Array<[number, number]> = [];
  const lines: Array<[number, number]> = [];
  let closes = 0;
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
      if (prop === 'lineTo') return (x: number, y: number) => { lines.push([x, y]); };
      if (prop === 'closePath') return () => { closes++; };
      if (prop === 'bezierCurveTo') return (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => { lines.push([x, y]); };
      return () => {};
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
  const sk = M.emptySketch();
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
    status: { ok: true, dof: 1, conflicting: [], redundant: [] }, labels: [],
    tool: 'slot', slotMode: 'arcCenter', draft: [center, start], draftIds: [], dimPick: [],
  };
  const ed = {
    dark: false, dpr: 2, view: { zoom: ZOOM, ox: OX, oy: OY }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { ...cursor }, cursorOnCanvas: true,
    syncSketch() {},
    toScreen: toScr,
    toWorld: (sx: number, sy: number) => ({ x: (sx - OX) / ZOOM, y: (sy - OY) / ZOOM }),
    skToScreen: toScr, skFromWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => ZOOM,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
  renderSketch.call(ed, ctx);
  const drawn = [...moves, ...lines];
  for (const p of [start, cursor]) {
    const s = toScr(p);
    assert.ok(drawn.some(([x, y]) => Math.abs(x - s.x) < 1e-6 && Math.abs(y - s.y) < 1e-6),
      `Bogenpunkt transformiert gezeichnet: ${JSON.stringify(s)} in ${JSON.stringify(drawn)}`);
  }
  assert.equal(closes, 0, 'offener Bogenzug ohne closePath');
});

// Paket 4 „Konstruktionslinien + Bogen-Tangente": echte Editor-Pipeline (circleTool-Harness + sketchDown-Klicks).
// constrMode/arcMode sind Sitzungsfelder wie circleMode; Defaults bleiben Linienwerkzeug/Legacy-Bogen.
function constrModeOf(ed: Editor) {
  return (ed.sketchEdit as unknown as { constrMode?: string }).constrMode;
}
function setConstrMode(ed: Editor, mode: string) {
  (ed.sketchEdit as unknown as { constrMode?: string }).constrMode = mode;
}
function constrTool(ed: Editor) {
  ed.sketchEdit!.tool = 'constr';
}
function arcModeOf(ed: Editor) {
  return (ed.sketchEdit as unknown as { arcMode?: string }).arcMode;
}
function setArcMode(ed: Editor, mode: string) {
  (ed.sketchEdit as unknown as { arcMode?: string }).arcMode = mode;
}
function arcTool(ed: Editor) {
  ed.sketchEdit!.tool = 'arc';
}
const constrLinesOf = (sk: Sk) => sk.ents.filter((e) => e.t === 'line' && (e as { infinite?: boolean }).infinite === true);
const lineDirOf = (sk: Sk, id: number) => {
  const e = M.entOf(sk, id)!;
  if (e.t !== 'line') throw new Error('keine Linie');
  const a = M.ptOf(sk, e.a)!, b = M.ptOf(sk, e.b)!;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const distPtLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);

test('Konstruktion frei: 2 Punkte → unendliche Linie, profilfrei, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'free');
  click(1, 2);
  click(5, 6);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  assert.equal((lines[0] as { aux?: boolean }).aux, undefined, 'kein aux — infinite trägt die Konstruktion');
  assert.ok(M.isConstructionGeometry(lines[0]), 'Konstruktionsgeometrie');
  const d = lineDirOf(ssk, lines[0].id);
  near(d.x, Math.SQRT1_2);
  near(d.y, Math.SQRT1_2);
  assert.equal(M.sketchSubs(ssk).length, 0, 'kein Profil aus Konstruktionslinien');
  assert.equal(ssk.cons.length, 0, 'keine Bedingungen');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf nach Erfolg leer');
});

test('Konstruktion waagrecht/senkrecht: 1 Punkt → exakte Richtung mit H/V-Bindung, ein Undo', () => {
  for (const [mode, dx, dy, con] of [['horizontal', 1, 0, 'horizontal'], ['vertical', 0, 1, 'vertical']] as const) {
    const sk = M.emptySketch();
    const { ed, snapshots, click } = circleTool(sk);
    ed.snapObjects = false;
    ed.sketchToggleDrawAux();
    constrTool(ed);
    setConstrMode(ed, mode);
    click(3, 4);
    const ssk = ed.sketchEdit!.sk;
    const lines = constrLinesOf(ssk);
    assert.equal(lines.length, 1, `genau eine unendliche Linie (${mode})`);
    assert.equal((lines[0] as { aux?: boolean }).aux, undefined, 'G-Modus gilt hier nicht: infinite statt aux');
    assert.deepEqual([lineDirOf(ssk, lines[0].id).x, lineDirOf(ssk, lines[0].id).y], [dx, dy], 'Richtung exakt');
    assert.ok(ssk.cons.some((c) => c.t === con && c.r[0] === lines[0].id), `${con}-Bindung vorhanden`);
    assert.equal(M.sketchSubs(ssk).length, 0, 'profilfrei');
    assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
  }
});

test('Konstruktion Winkel: Anker + Klick → exakte Richtung, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'angle');
  click(2, 1);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Anker im Entwurf');
  assert.ok(ed.hint.length > 0, 'Richtungs-Hinweis gesetzt');
  click(2 + Math.sqrt(3), 2);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  const d = lineDirOf(ssk, lines[0].id);
  near(d.x, Math.cos(Math.PI / 6), 1e-9);
  near(d.y, Math.sin(Math.PI / 6), 1e-9);
  assert.equal(M.sketchSubs(ssk).length, 0, 'profilfrei');
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf nach Erfolg leer');
});

test('Konstruktion Winkel: Klick auf Anker → Hinweis ohne Mutation', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'angle');
  click(5, 5);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  const n0 = snapshots.length;
  click(5, 5);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf verworfen');
});

test('Konstruktion Winkel: Esc nach Anker verwirft ohne Mutation, Modus bleibt', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'angle');
  click(5, 5);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Anker im Entwurf');
  const before = M.sketchJson(ed.sketchEdit!.sk);
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Esc verwirft den Anker');
  assert.equal(constrModeOf(ed), 'angle', 'Modus bleibt gewählt');
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
});

test('Konstruktion parallel: Referenzlinie + Punkt → parallele Unendliche mit Bindung', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  const ref = sk.ents.find((e) => e.t === 'line')!;
  constrTool(ed);
  setConstrMode(ed, 'parallel');
  click(5, 0);
  click(3, 4);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  assert.deepEqual([lineDirOf(ssk, lines[0].id).x, lineDirOf(ssk, lines[0].id).y], [1, 0], 'Richtung exakt parallel');
  const e = M.entOf(ssk, lines[0].id)!;
  assert.ok(e.t === 'line' && distPtLine({ x: 3, y: 4 }, M.ptOf(ssk, e.a)!, M.ptOf(ssk, e.b)!) < 1e-9, 'geht durch den Punkt');
  assert.ok(ssk.cons.some((c) => c.t === 'parallel' && c.r.includes(lines[0].id) && c.r.includes(ref.id)), 'Parallel-Bindung');
  assert.equal(M.sketchSubs(ssk).length, 1, 'nur die Referenzlinie im Profil');
  assert.equal(snapshots.length, 2, 'Linie und Konstruktion je ein Undo-Schritt');
});

test('Konstruktion senkrecht: Referenzlinie + Punkt → exakte Senkrechte mit Bindung', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  const ref = sk.ents.find((e) => e.t === 'line')!;
  constrTool(ed);
  setConstrMode(ed, 'perpendicular');
  click(5, 0);
  click(3, 4);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  assert.deepEqual([lineDirOf(ssk, lines[0].id).x, lineDirOf(ssk, lines[0].id).y], [0, 1], 'Richtung exakt senkrecht');
  assert.ok(ssk.cons.some((c) => c.t === 'perpendicular' && c.r.includes(lines[0].id) && c.r.includes(ref.id)), 'Senkrecht-Bindung');
  assert.equal(snapshots.length, 2, 'Linie und Konstruktion je ein Undo-Schritt');
});

test('Konstruktion Tangente-außen: Punkt + Kreis → tangent_lc, Cursor-seitig, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  click(0, 0);
  click(5, 0);
  const circle = ed.sketchEdit!.sk.ents.find((e) => e.t === 'circle')!;
  assert.ok(circle && circle.t === 'circle', 'Kreis vorhanden');
  constrTool(ed);
  setConstrMode(ed, 'externalTangent');
  click(4, 3);
  click(12, 0);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  assert.ok(ssk.cons.some((c) => c.t === 'tangent' && c.r.includes(lines[0].id) && c.r.includes(circle.id)), 'Tangenten-Bindung');
  assert.ok(S.toPrimitives(ssk).some((p) => p.type === 'tangent_lc'), 'Solver sieht tangent_lc');
  const e = M.entOf(ssk, lines[0].id)!;
  assert.ok(e.t === 'line', 'Linie');
  const a = M.ptOf(ssk, e.a)!, b = M.ptOf(ssk, e.b)!;
  assert.ok(distPtLine({ x: 12, y: 0 }, a, b) < 1e-9, 'geht durch den Punkt');
  assert.ok(Math.abs(distPtLine({ x: 0, y: 0 }, a, b) - 5) < 1e-6, 'berührt den Kreis');
  const tangentPt = [a, b].find((p) => Math.abs(p.x - 12) > 1e-9)!;
  assert.ok(tangentPt.y > 0, 'Cursor-seitiger Tangentpunkt (oben)');
  assert.ok(Math.abs(Math.hypot(tangentPt.x, tangentPt.y) - 5) < 1e-9, 'Tangentpunkt liegt auf dem Kreis');
  assert.equal(M.sketchSubs(ssk).length, 1, 'nur der Kreis im Profil');
  assert.equal(snapshots.length, 2, 'Kreis und Konstruktion je ein Undo-Schritt');
});

test('Konstruktion Tangente-am-Punkt: Kurve + Punkt → exakte Richtung ohne Cons', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  constrTool(ed);
  setConstrMode(ed, 'pointTangent');
  click(4, 0);
  click(4, 3);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  assert.deepEqual([lineDirOf(ssk, lines[0].id).x, lineDirOf(ssk, lines[0].id).y], [1, 0], 'Richtung der Kurve exakt');
  const e = M.entOf(ssk, lines[0].id)!;
  assert.ok(e.t === 'line' && distPtLine({ x: 4, y: 3 }, M.ptOf(ssk, e.a)!, M.ptOf(ssk, e.b)!) < 1e-9, 'geht durch den Punkt');
  assert.equal(ssk.cons.filter((c) => c.r.includes(lines[0].id)).length, 0, 'reine Geometrie ohne Bindung');
  assert.equal(snapshots.length, 2, 'Linie und Konstruktion je ein Undo-Schritt');
  // Kreis-Variante direkt am Builder: Tangente am Randpunkt ist exakt senkrecht zum Radius.
  const sk2 = M.emptySketch();
  const c = M.addPt(sk2, 0, 0), circ = M.addCircle(sk2, c.id, 5);
  assert.equal(CL.addPointTangentConstrLine(sk2, circ.id, { x: 5, y: 0 }, null), true, 'Tangente am Randpunkt gebaut');
  const built = sk2.ents.filter((x) => x.t === 'line' && (x as { infinite?: boolean }).infinite === true);
  assert.equal(built.length, 1, 'genau eine unendliche Linie');
  assert.deepEqual([lineDirOf(sk2, built[0].id).x, lineDirOf(sk2, built[0].id).y], [0, 1], 'Tangentenrichtung exakt');
  assert.equal(CL.addPointTangentConstrLine(sk2, circ.id, { x: 0, y: 0 }, null), false, 'Kreismitte abgelehnt');
});

test('Konstruktion Zwei-Tangente: 2 Kreise → gemeinsame Tangente nächst zum Zeiger', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  click(0, 0);
  click(4, 0);
  click(14, 0);
  click(18, 0);
  const circles = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'circle');
  assert.equal(circles.length, 2, 'beide Kreise vorhanden');
  constrTool(ed);
  setConstrMode(ed, 'twoTangent');
  click(0, 4);
  click(14, 4);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  for (const c of circles) assert.ok(ssk.cons.some((x) => x.t === 'tangent' && x.r.includes(lines[0].id) && x.r.includes(c.id)), `Tangente an Kreis #${c.id}`);
  assert.deepEqual([lineDirOf(ssk, lines[0].id).x, lineDirOf(ssk, lines[0].id).y], [1, 0], 'obere gemeinsame Tangente exakt');
  const e = M.entOf(ssk, lines[0].id)!;
  assert.ok(e.t === 'line', 'Linie');
  assert.ok(Math.abs(distPtLine({ x: 0, y: 0 }, M.ptOf(ssk, e.a)!, M.ptOf(ssk, e.b)!) - 4) < 1e-6, 'Abstand 4 zu beiden Mitten');
  assert.equal(M.sketchSubs(ssk).length, 2, 'nur die Kreise im Profil');
  assert.equal(snapshots.length, 3, 'Kreise und Konstruktion je ein Undo-Schritt');
});

test('Konstruktion Winkelhalbierende: 2 Linien → 45°-Halbierende nächst zum Zeiger', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  drawLine(ed, click, 0, 0, 0, 10);
  const refs = sk.ents.filter((e) => e.t === 'line');
  assert.equal(refs.length, 2, 'beide Referenzlinien vorhanden');
  constrTool(ed);
  setConstrMode(ed, 'bisector');
  click(6, 0);
  click(1, 6);
  const ssk = ed.sketchEdit!.sk;
  const lines = constrLinesOf(ssk);
  assert.equal(lines.length, 1, 'genau eine unendliche Linie');
  const d = lineDirOf(ssk, lines[0].id);
  near(d.x, Math.SQRT1_2, 1e-9);
  near(d.y, Math.SQRT1_2, 1e-9);
  const e = M.entOf(ssk, lines[0].id)!;
  assert.ok(e.t === 'line' && distPtLine({ x: 0, y: 0 }, M.ptOf(ssk, e.a)!, M.ptOf(ssk, e.b)!) < 1e-9, 'geht durch den Schnittpunkt');
  near(M.measureCon(ssk, { id: 0, t: 'angle', r: [lines[0].id, refs[0].id] })!, 45, 1e-4);
  assert.equal(ssk.cons.filter((c) => c.r.includes(lines[0].id)).length, 0, 'reine Geometrie ohne Bindung');
  assert.equal(snapshots.length, 3, 'Referenzen und Konstruktion je ein Undo-Schritt');
});

test('Konstruktion Entartung: identische Punkte → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'free');
  click(5, 5);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(5, 5);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Entwurf verworfen');
});

test('Konstruktion Entartung: parallele Refs → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  drawLine(ed, click, 0, 5, 10, 5);
  constrTool(ed);
  setConstrMode(ed, 'bisector');
  click(5, 0);
  click(5, 5);
  assert.equal(ed.sketchEdit!.sk.ents.filter((e) => e.t === 'line').length, 2, 'keine dritte Linie');
  assert.equal(snapshots.length, 2, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Konstruktion Entartung: Punkt im Kreis → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  click(0, 0);
  click(5, 0);
  constrTool(ed);
  setConstrMode(ed, 'externalTangent');
  click(4, 3);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(1, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 1, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Konstruktion Zwei-Tangente: dieselbe Referenz zweimal → Hinweis, kein Bau', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  click(0, 0);
  click(5, 0);
  constrTool(ed);
  setConstrMode(ed, 'twoTangent');
  click(5, 0);
  const nEnts = ed.sketchEdit!.sk.ents.length;
  click(5, 0);
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts, 'kein Bau');
  assert.equal(snapshots.length, 1, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Konstruktion Zwei-Tangente: ineinander ohne Tangente → Hinweis, keine Mutation', () => {
  const sk = M.emptySketch();
  const c1c = M.addPt(sk, 0, 0);
  M.addCircle(sk, c1c.id, 5);
  const c2c = M.addPt(sk, 1, 0);
  M.addCircle(sk, c2c.id, 1);
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'twoTangent');
  click(5, 0);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(2, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});


test('Konstruktion: Ellipse als Tangentenziel abgelehnt (keine Mutation, kein Undo)', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  ed.sketchEdit!.tool = 'ellipse';
  click(20, 0);
  click(25, 0);
  click(20, 3);
  assert.ok(ed.sketchEdit!.sk.ents.some((e) => e.t === 'ellipse'), 'Ellipse vorhanden');
  const n0 = snapshots.length;
  const nEnts = ed.sketchEdit!.sk.ents.length;
  constrTool(ed);
  setConstrMode(ed, 'externalTangent');
  click(25, 0);
  assert.equal(ed.sketchEdit!.sk.ents.length, nEnts, 'keine Konstruktionslinie erzeugt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

// Querschnitts-Härtung Paket 4 „Konstruktionslinien" (Pipeline-Tests über circleTool-Harness).
test('Konstruktion Gleich: zwei bemaßte Unendliche → Folge driven, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'free');
  click(0, 0);
  click(10, 0);
  click(0, 20);
  click(14, 20);
  const ssk = ed.sketchEdit!.sk;
  const kids = constrLinesOf(ssk);
  assert.equal(kids.length, 2, 'beide Konstruktionslinien vorhanden');
  const d1 = M.addCon(ssk, 'distance', [kids[0].id], { v: 10 });
  const d2 = M.addCon(ssk, 'distance', [kids[1].id], { v: 14 });
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([kids[0].id, kids[1].id]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Bemaßung: D-Werkzeug auf Konstruktionslinie erzeugt Längenmaß', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'free');
  click(0, 0);
  click(10, 0);
  const line = constrLinesOf(ed.sketchEdit!.sk)[0];
  assert.ok(line, 'Konstruktionslinie vorhanden');
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 10 })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: line.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  const dim = after.cons.find((c) => c.t === 'distance' && c.r[0] === line.id);
  assert.ok(dim, 'Längenmaß angelegt');
  assert.equal(snapshots.length, n0 + 1, 'genau ein weiterer Undo-Schritt');
});

test('Bemaßung: Rejekt an überbestimmter Konstruktionslinie legt keinen Param an', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  constrTool(ed);
  setConstrMode(ed, 'free');
  click(0, 0);
  click(10, 0);
  const line = constrLinesOf(ed.sketchEdit!.sk)[0];
  assert.ok(line, 'Konstruktionslinie vorhanden');
  M.addCon(ed.sketchEdit!.sk, 'distance', [line.id], { v: 10 });
  const params: { name: string; value: number }[] = [];
  (ed as unknown as { paramList: () => { name: string; value: number }[] }).paramList = () => params;
  (ed as unknown as { findParam: (n: string) => undefined }).findParam = () => undefined;
  (ed as unknown as { addParam: (t: string, init: object) => object }).addParam = (_t: string, init: object) => {
    const p = { ...(init as object) } as { name: string; value: number };
    params.push(p);
    return p;
  };
  const nCons = ed.sketchEdit!.sk.cons.length;
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 12, pendingParam: { name: 'P9', value: 12 } })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: line.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.equal(after.cons.length, nCons, 'kein Maß angelegt');
  assert.ok(!after.cons.some((c) => c.t === 'distance' && c.v === 12), 'widersprüchliche Länge abgewiesen');
  assert.equal(params.length, 0, 'kein Param angelegt');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Konstruktion: Esc/Toolwechsel resettet Refs, Modus bleibt gewählt', () => {
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  constrTool(ed);
  setConstrMode(ed, 'parallel');
  click(5, 0);
  assert.equal(((ed.sketchEdit as unknown as { constrRefs?: number[] }).constrRefs ?? []).length, 1, 'Referenz gewählt');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(((ed.sketchEdit as unknown as { constrRefs?: number[] }).constrRefs ?? []).length, 0, 'Esc verwirft die Referenz');
  assert.equal(constrModeOf(ed), 'parallel', 'Modus bleibt gewählt');
  click(5, 0);
  ed.setSketchTool('select');
  assert.equal(((ed.sketchEdit as unknown as { constrRefs?: number[] }).constrRefs ?? []).length, 0, 'Toolwechsel verwirft die Referenz');
});

test('Bogen-Tangente: Linienende + freier Punkt → Bogen mit G1-Bindung, Radius aus Geometrie', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  const ref = sk.ents.find((e) => e.t === 'line')!;
  arcTool(ed);
  setArcMode(ed, 'tangent');
  assert.equal(arcModeOf(ed), 'tangent');
  click(10, 0);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Start im Entwurf');
  click(16, 6);
  const ssk = ed.sketchEdit!.sk;
  const arcs = ssk.ents.filter((e) => e.t === 'arc');
  assert.equal(arcs.length, 1, 'genau ein Bogen');
  const arc = arcs[0];
  assert.ok(arc.t === 'arc', 'Bogen');
  const auxLines = ssk.ents.filter((e) => e.t === 'line' && e.aux);
  assert.equal(auxLines.length, 2, 'Richtungs-Hilfslinie plus Startradius-Hilfslinie');
  const helper = auxLines.find((e) => ssk.cons.some((c) => c.t === 'parallel' && c.r.includes(e.id) && c.r.includes(ref.id)))!;
  assert.ok(helper && helper.t === 'line', 'Richtungs-Hilfslinie mit Parallel-Bindung');
  const startId = [arc.s, arc.e].find((id) => id === ref.a || id === ref.b)!;
  assert.ok(ssk.cons.some((c) => c.t === 'coincident' && c.r.includes(helper.a) && c.r.includes(startId)), 'H1 am Fugen-Start verankert');
  const startradius = auxLines.find((e) => e.id !== helper.id)!;
  assert.ok(ssk.cons.some((c) => c.t === 'perpendicular' && c.r.includes(helper.id) && c.r.includes(startradius.id)), 'G1-Bindung Hilfslinie ⟂ Startradius');
  assert.ok(ssk.cons.some((c) => c.t === 'parallel' && c.r.includes(helper.id) && c.r.includes(ref.id)), 'Richtungsanker parallel zur Referenz');
  assert.ok(!S.toPrimitives(ssk).some((p) => p.type === 'tangent_la'), 'kein tangent_la-Primitiv (strukturell redundant an S)');
  const s = M.ptOf(ssk, arc.s)!;
  near(s.x, 10);
  near(s.y, 0);
  near(arc.r, 6, 1e-6);
  near(arc.a1 - arc.a0, Math.PI / 2, 1e-6);
  const cc = M.ptOf(ssk, arc.c)!;
  near((s.x - cc.x) * 1 + (s.y - cc.y) * 0, 0, 1e-6);
  const subs = M.sketchSubs(ssk);
  assert.equal(subs.length, 1, 'Linie und Bogen bilden ein Profil');
  assert.equal(subs[0].nodes.length, 3, 'Linienende, Fuge, Bogenende');
  assert.equal(subs[0].closed, false, 'offener Zug');
  assert.equal(snapshots.length, 2, 'Linie und Bogen je ein Undo-Schritt');
});

test('Bogen-Tangente: Bogenende + Punkt → G1-Bindung, U kehrt die Richtung um', () => {
  for (const flip of [false, true]) {
    const sk = M.emptySketch();
    const { ed, snapshots, click } = circleTool(sk);
    ed.snapObjects = false;
    arcTool(ed);
    click(0, 0);
    click(10, 0);
    click(0, 10);
    const refs = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'arc');
    assert.equal(refs.length, 1, 'Referenzbogen vorhanden');
    setArcMode(ed, 'tangent');
    click(0, 10);
    assert.equal(ed.sketchEdit!.draft.length, 1, 'Start im Entwurf');
    if (flip) {
      assert.equal(ed.sketchKey({ key: 'u', target: {} } as KeyboardEvent), true);
      assert.equal((ed.sketchEdit as unknown as { arcFlip?: boolean }).arcFlip, true, 'Richtungsumkehr aktiv');
    }
    click(-6, 16);
    const ssk = ed.sketchEdit!.sk;
    const arcs = ssk.ents.filter((e) => e.t === 'arc' && e.id !== refs[0].id);
    assert.equal(arcs.length, 1, 'genau ein Tangentenbogen');
    const arc = arcs[0];
    assert.ok(arc.t === 'arc', 'Bogen');
    const helper = ssk.ents.find((e) => e.t === 'line' && e.aux
      && ssk.cons.filter((c) => c.t === 'perpendicular' && c.r.includes(e.id)).length === 2);
    assert.ok(helper && helper.t === 'line', 'Richtungs-Hilfslinie mit zwei Senkrecht-Bindungen');
    const ref = M.entOf(ssk, refs[0].id)!;
    assert.ok(ref.t === 'arc');
    const startId = [arc.s, arc.e].find((id) => id === ref.s || id === ref.e)!;
    assert.ok(ssk.cons.some((c) => c.t === 'coincident' && c.r.includes(helper.a) && c.r.includes(startId)), 'H1 am Fugen-Start verankert');
    assert.ok(ssk.cons.some((c) => c.t === 'perpendicular' && c.r.includes(helper.id)), 'Richtungsanker senkrecht zum Bogenradius');
    assert.ok(!S.toPrimitives(ssk).some((p) => p.type === 'tangent_la'), 'kein tangent_la-Primitiv (strukturell redundant an S)');
    near(arc.r, 6, 1e-6);
    near(arc.a1 - arc.a0, flip ? (3 * Math.PI) / 2 : Math.PI / 2, 1e-6);
    const kept = M.ptOf(ssk, flip ? arc.s : arc.e)!;
    near(kept.x, 0);
    near(kept.y, 10);
    assert.equal(snapshots.length, 2, 'Bögen je ein Undo-Schritt');
  }
});

test('Bogen Legacy-Default: Mitte-Anfang-Ende unverändert', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  assert.equal(arcModeOf(ed), undefined, 'kein Modus gesetzt');
  arcTool(ed);
  click(0, 0);
  click(10, 0);
  click(0, 10);
  const ssk = ed.sketchEdit!.sk;
  const arcs = ssk.ents.filter((e) => e.t === 'arc');
  assert.equal(arcs.length, 1, 'genau ein Bogen');
  assert.ok(arcs[0].t === 'arc', 'Bogen');
  near(arcs[0].r, 10, 1e-9);
  assert.equal(snapshots.length, 1, 'genau ein Undo-Schritt');
});

test('Bogen-Tangente: Start ohne Fang → Hinweis, keine Mutation, kein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  arcTool(ed);
  setArcMode(ed, 'tangent');
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(30, 30);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 0, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'kein Entwurf');
});

test('Bogen-Tangente: Ende = Start → Hinweis, Start bleibt im Entwurf', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(10, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 1, 'kein weiterer Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Start bleibt im Entwurf');
});

test('Bogen-Tangente: Ende auf der Tangente → Hinweis, keine Mutation', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(20, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, 1, 'kein weiterer Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Start bleibt im Entwurf');
});

test('Bogen-Tangente: Ellipsen-Endpunkt als Start abgelehnt', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  ed.sketchEdit!.tool = 'ellipse';
  click(20, 0);
  click(25, 0);
  click(20, 3);
  assert.ok(ed.sketchEdit!.sk.ents.some((e) => e.t === 'ellipse'), 'Ellipse vorhanden');
  const n0 = snapshots.length;
  arcTool(ed);
  setArcMode(ed, 'tangent');
  const before = M.sketchJson(ed.sketchEdit!.sk);
  click(25, 0);
  assert.equal(M.sketchJson(ed.sketchEdit!.sk), before, 'keine Mutation');
  assert.equal(snapshots.length, n0, 'kein Undo-Schritt');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'kein Entwurf');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

// Querschnitts-Härtung Paket 4 „Bogen-Tangente" (Pipeline-Tests über circleTool-Harness).
test('Bogen-Tangente Gleich: Radiusmaß + Legacy-Maß → Folge driven, ein Undo', () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  click(16, 6);
  const ssk = ed.sketchEdit!.sk;
  const tangent = ssk.ents.filter((e) => e.t === 'arc')[0];
  assert.ok(tangent && tangent.t === 'arc', 'Tangentenbogen vorhanden');
  const legacy = M.addArc(ssk, M.addPt(ssk, 40, 0).id, M.addPt(ssk, 50, 0).id, M.addPt(ssk, 40, 10).id);
  const d1 = M.addCon(ssk, 'radius', [tangent.id], { v: 6 });
  const d2 = M.addCon(ssk, 'radius', [legacy.id], { v: 10 });
  const n0 = snapshots.length;
  ed.sketchEdit!.sel = new Set([tangent.id, legacy.id]);
  ed.sketchConstrain('equal');
  const after = ed.sketchEdit!.sk;
  assert.ok(after.cons.some((c) => c.t === 'equal'), 'Gleich-Bedingung gesetzt');
  assert.equal((after.cons.find((c) => c.id === d1.id) as M.SkCon | undefined)?.driven, undefined, 'Master-Maß bleibt treibend');
  assert.equal((after.cons.find((c) => c.id === d2.id) as M.SkCon | undefined)?.driven, true, 'Folge-Maß wird Referenz');
  near((M.entOf(after, tangent.id) as { r: number }).r, 6);
  near((M.entOf(after, legacy.id) as { r: number }).r, 6);
  assert.equal(snapshots.length, n0 + 1, 'genau ein Undo-Schritt für Gleich');
  assert.equal(ed.sketchEdit!.sel.size, 0, 'Auswahl nach Erfolg gelöscht');
});

test('Bogen-Tangente: D-Werkzeug erzeugt Radius, Rejekt legt keinen Param an', async () => {
  const sk = M.emptySketch();
  const { ed, snapshots, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  click(16, 6);
  const tangent = ed.sketchEdit!.sk.ents.filter((e) => e.t === 'arc')[0];
  assert.ok(tangent && tangent.t === 'arc', 'Tangentenbogen vorhanden');
  const n0 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 6 })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: tangent.id });
  await new Promise((r) => setTimeout(r, 30));
  const sized = ed.sketchEdit!.sk;
  const rad = sized.cons.find((c) => c.t === 'radius' && c.r[0] === tangent.id);
  assert.ok(rad, 'Radius-Maß angelegt');
  assert.equal(rad.driven, undefined, 'Radius treibt (erstes Maß)');
  assert.equal(snapshots.length, n0 + 1, 'genau ein weiterer Undo-Schritt');
  const params: { name: string; value: number }[] = [];
  (ed as unknown as { paramList: () => { name: string; value: number }[] }).paramList = () => params;
  (ed as unknown as { findParam: (n: string) => undefined }).findParam = () => undefined;
  (ed as unknown as { addParam: (t: string, init: object) => object }).addParam = (_t: string, init: object) => {
    const p = { ...(init as object) } as { name: string; value: number };
    params.push(p);
    return p;
  };
  const nCons = ed.sketchEdit!.sk.cons.length;
  const n1 = snapshots.length;
  (ed.sketchEdit as unknown as { dimPick: unknown[] }).dimPick = [];
  ed.sketchEdit!.tool = 'dim';
  ed.onSketchValue = (async () => ({ v: 9, pendingParam: { name: 'P9', value: 9 } })) as unknown as Editor['onSketchValue'];
  ed.sketchDimPick({ kind: 'ent', id: tangent.id });
  await new Promise((r) => setTimeout(r, 30));
  const after = ed.sketchEdit!.sk;
  assert.equal(after.cons.length, nCons, 'kein Maß angelegt');
  assert.ok(!after.cons.some((c) => c.t === 'radius' && c.v === 9), 'widersprüchlicher Radius abgewiesen');
  assert.equal(params.length, 0, 'kein Param angelegt');
  assert.equal(snapshots.length, n1, 'kein Undo-Schritt');
  assert.ok(ed.hint.length > 0, 'Hinweis gesetzt');
});

test('Bogen-Tangente: Esc/Toolwechsel resettet Start, Modus bleibt gewählt', () => {
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  assert.equal(ed.sketchEdit!.draft.length, 1, 'Start im Entwurf');
  assert.equal(ed.sketchKey({ key: 'Escape', target: {} } as KeyboardEvent), true);
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Esc verwirft den Start');
  assert.equal((ed.sketchEdit as unknown as { arcRef?: number }).arcRef, undefined, 'Referenz verworfen');
  assert.equal(arcModeOf(ed), 'tangent', 'Modus bleibt gewählt');
  click(10, 0);
  ed.setSketchTool('select');
  assert.equal(ed.sketchEdit!.draft.length, 0, 'Toolwechsel verwirft den Start');
});

test('Bogen-Tangente-Vorschau: Tangentenbogen-Draft unter Non-Identity (Zoom/Offset/dpr)', async () => {
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const ZOOM = 2, OX = 30, OY = -17;
  const start = { x: 10, y: 0 }, end = { x: 16, y: 6 };
  const toScr = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * ZOOM + OX, y: p.y * ZOOM + OY });
  const moves: Array<[number, number]> = [];
  const lines: Array<[number, number]> = [];
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
      if (prop === 'lineTo') return (x: number, y: number) => { lines.push([x, y]); };
      if (prop === 'bezierCurveTo') return (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => { lines.push([x, y]); };
      return () => {};
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const ref = M.addLine(sk, a.id, b.id);
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
    status: { ok: true, dof: 1, conflicting: [], redundant: [] }, labels: [],
    tool: 'arc', arcMode: 'tangent', draft: [{ x: 10, y: 0 }], draftIds: [b.id], arcRef: ref.id, dimPick: [],
  };
  const ed = {
    dark: false, dpr: 2, view: { zoom: ZOOM, ox: OX, oy: OY }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { ...end }, cursorOnCanvas: true,
    syncSketch() {},
    toScreen: toScr,
    toWorld: (sx: number, sy: number) => ({ x: (sx - OX) / ZOOM, y: (sy - OY) / ZOOM }),
    skToScreen: toScr, skFromWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => ZOOM,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
  renderSketch.call(ed, ctx);
  // Tangentenbogen vom Start zum Cursor: beide Punkte transformiert gezeichnet (arcNodes-Muster, keine lineTo-Abkürzung).
  const drawn = [...moves, ...lines];
  assert.ok(lines.length > 1, 'Bogen als Bézier-Kette gezeichnet');
  for (const p of [start, end]) {
    const s = toScr(p);
    assert.ok(drawn.some(([x, y]) => Math.hypot(x - s.x, y - s.y) < 2),
      `Bogenpunkt transformiert gezeichnet: ${JSON.stringify(s)} in ${JSON.stringify(drawn)}`);
  }
});

// Paket-4-Fix „Bogen-Tangente H1-Anker" (Punkt a): Die Richtungs-Hilfslinie H1→H2 war als
// frische Punkte ohne Bindung an den Fugen-Start gebaut — H1 konnte entlang der Eigenrichtung
// driften, G1 galt nur konstruktiv. H1 ist jetzt per coincident an startId gebunden (kein
// pointOnLine: Damit bliebe H1 entlang der Linie verschiebbar; coincident legt H1 fest und ist
// nicht redundant — parallel/tangent bestimmen nur Richtung und Tangentenlage, keine H1-Lage).
// Rot-Beleg ohne Anker: /tmp/opencode/red-paket4-fix.log (H1 bleibt versetzt, G1 verletzt).
test('Bogen-Tangente H1-Anker (Linienref): Stoer-Solve stellt G1 am Start wieder her', () => {
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  const ref = sk.ents.find((e) => e.t === 'line')!;
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  click(16, 6);
  const ssk = ed.sketchEdit!.sk;
  const arc = ssk.ents.find((e) => e.t === 'arc')!;
  assert.ok(arc.t === 'arc', 'Tangentenbogen vorhanden');
  const helper = ssk.ents.find((e) => e.t === 'line' && e.aux
    && ssk.cons.some((c) => c.t === 'parallel' && c.r.includes(e.id) && c.r.includes(ref.id)))!;
  assert.ok(helper && helper.t === 'line', 'Richtungs-Hilfslinie mit Parallel-Bindung');
  const startId = [arc.s, arc.e].find((id) => id === ref.a || id === ref.b)!;
  assert.ok(startId !== undefined, 'Bogenstart mit Referenz geteilt');
  const first = S.solveSketch(ssk);
  assert.ok(first.ok && !first.redundant.length, `loesbar ohne Redundanz: ${JSON.stringify(first)}`);
  // G1-Mass: |Skalarprodukt| aus Bogenstart-Tangente (senkrecht zum Startradius) und
  // Referenzrichtung; Absolutwert, da die Hilfsrichtung vorzeichenfrei ist.
  const g1 = (): number => {
    const a = M.entOf(ssk, arc.id)!;
    assert.ok(a.t === 'arc');
    const C = M.ptOf(ssk, a.c)!, Sp = M.ptOf(ssk, startId)!;
    const rx = Sp.x - C.x, ry = Sp.y - C.y, rl = Math.hypot(rx, ry);
    const ra = M.entOf(ssk, ref.id)!;
    assert.ok(ra.t === 'line');
    const A = M.ptOf(ssk, ra.a)!, B = M.ptOf(ssk, ra.b)!;
    const dx = B.x - A.x, dy = B.y - A.y, dl = Math.hypot(dx, dy);
    return Math.abs(((-ry * dx) + (rx * dy)) / (rl * dl));
  };
  near(g1(), 1, 1e-6);
  const subsBefore = M.sketchSubs(ssk).length;
  // Stoerung: H1 entlang der Eigenrichtung driften lassen, Hilfslinie parallel versetzen,
  // Bogenende ziehen (wie ein Drag) — der Anker fehlt im un-verankerten Stand.
  const H1 = M.ptOf(ssk, helper.a)!, H2 = M.ptOf(ssk, helper.b)!, E = M.ptOf(ssk, arc.e)!;
  H1.x += 8; H2.x += 8; H2.y += 4; E.x += 2; E.y -= 3;
  const second = S.solveSketch(ssk);
  assert.ok(second.ok && !second.redundant.length, `re-solve ok: ${JSON.stringify(second)}`);
  const Spt = M.ptOf(ssk, startId)!;
  near(Math.hypot(H1.x - Spt.x, H1.y - Spt.y), 0, 1e-6);
  near(g1(), 1, 1e-6);
  assert.equal(M.sketchSubs(ssk).length, subsBefore, 'Profilzahl unveraendert');
  assert.ok(ssk.cons.some((c) => c.t === 'coincident' && c.r.includes(helper.a) && c.r.includes(startId)),
    'H1 per coincident am Fugen-Start verankert');
});

test('Bogen-Tangente H1-Anker (Bogenref): Stoer-Solve stellt G1 am Start wieder her', () => {
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  ed.snapObjects = false;
  arcTool(ed);
  click(0, 0);
  click(10, 0);
  click(0, 10);
  const refEnt = ed.sketchEdit!.sk.ents.find((e) => e.t === 'arc')!;
  setArcMode(ed, 'tangent');
  click(0, 10);
  click(-6, 16);
  const ssk = ed.sketchEdit!.sk;
  const arc = ssk.ents.filter((e) => e.t === 'arc' && e.id !== refEnt.id)[0];
  assert.ok(arc && arc.t === 'arc', 'Tangentenbogen vorhanden');
  const helper = ssk.ents.find((e) => e.t === 'line' && e.aux
    && ssk.cons.filter((c) => c.t === 'perpendicular' && c.r.includes(e.id)).length === 2)!;
  assert.ok(helper && helper.t === 'line', 'Richtungs-Hilfslinie mit zwei Senkrecht-Bindungen');
  const ref = M.entOf(ssk, refEnt.id)!;
  assert.ok(ref.t === 'arc');
  const startId = [arc.s, arc.e].find((id) => id === ref.s || id === ref.e)!;
  assert.ok(startId !== undefined, 'Bogenstart mit Referenz geteilt');
  const first = S.solveSketch(ssk);
  assert.ok(first.ok && !first.redundant.length, `loesbar ohne Redundanz: ${JSON.stringify(first)}`);
  const g1 = (): number => {
    const a = M.entOf(ssk, arc.id)!;
    assert.ok(a.t === 'arc');
    const C = M.ptOf(ssk, a.c)!, Sp = M.ptOf(ssk, startId)!;
    const rx = Sp.x - C.x, ry = Sp.y - C.y, rl = Math.hypot(rx, ry);
    const RC = M.ptOf(ssk, ref.c)!;
    const dx = -(Sp.y - RC.y), dy = Sp.x - RC.x, dl = Math.hypot(dx, dy);
    return Math.abs(((-ry * dx) + (rx * dy)) / (rl * dl));
  };
  near(g1(), 1, 1e-6);
  const subsBefore = M.sketchSubs(ssk).length;
  const H1 = M.ptOf(ssk, helper.a)!, H2 = M.ptOf(ssk, helper.b)!, E = M.ptOf(ssk, arc.s === startId ? arc.e : arc.s)!;
  H1.x += 8; H1.y -= 3; H2.x += 8; H2.y += 1; E.x += 2; E.y -= 3;
  const second = S.solveSketch(ssk);
  assert.ok(second.ok && !second.redundant.length, `re-solve ok: ${JSON.stringify(second)}`);
  const Spt = M.ptOf(ssk, startId)!;
  near(Math.hypot(H1.x - Spt.x, H1.y - Spt.y), 0, 1e-6);
  near(g1(), 1, 1e-6);
  assert.equal(M.sketchSubs(ssk).length, subsBefore, 'Profilzahl unveraendert');
  assert.ok(ssk.cons.some((c) => c.t === 'coincident' && c.r.includes(helper.a) && c.r.includes(startId)),
    'H1 per coincident am Fugen-Start verankert');
});

test('Bogen-Tangente H1-Anker: dof frei vs. fixiert (Erwartung aus Solver-Verhalten)', () => {
  // Erwartung (Solver-Verhalten,Rueckschreibung): freie Pipeline-Skizze (Linie + Bogen +
  // Hilfslinie + Startradius, parallel + coincident + perpendicular) meldet dof 6. Wird die
  // Referenz lagebestimmt (Anfangspunkt fixiert + waagerecht), entzieht das 3 dof ohne
  // Redundanz. (Beide Referenz-Enden voll zu fixieren, macht dagegen den Richtungsanker
  // redundant — die Lage folgt dann bereits aus Anker + G1-Bindung.) Alternativ entzieht
  // das Fixieren des freien Bogenendes 2 dof. Gegenueber dem un-verankerten Stand (dof 8,
  // siehe red-paket4-fix.log) entziehen Anker + G1-Bindung netto 2 dof; tangent_la waere
  // dort redundant.
  const sk = M.emptySketch();
  const { ed, click } = circleTool(sk);
  ed.snapObjects = false;
  drawLine(ed, click, 0, 0, 10, 0);
  arcTool(ed);
  setArcMode(ed, 'tangent');
  click(10, 0);
  click(16, 6);
  const ssk = ed.sketchEdit!.sk;
  const free = S.solveSketch(ssk);
  assert.ok(free.ok && !free.redundant.length, `frei loesbar: ${JSON.stringify(free)}`);
  assert.equal(free.dof, 6);
  const ref = ssk.ents.find((e) => e.t === 'line' && !e.aux)!;
  assert.ok(ref.t === 'line');
  const arc = ssk.ents.find((e) => e.t === 'arc')!;
  assert.ok(arc.t === 'arc');
  const startId = [arc.s, arc.e].find((id) => id === ref.a || id === ref.b)!;
  const endId = arc.s === startId ? arc.e : arc.s;
  const P = M.ptOf(ssk, endId)!;
  M.addCon(ssk, 'fixed', [endId], { x: P.x, y: P.y });
  const fixed = S.solveSketch(ssk);
  assert.ok(fixed.ok && !fixed.redundant.length, `fixiert loesbar: ${JSON.stringify(fixed)}`);
  assert.equal(fixed.dof, 4);
});

// UI-Umbau: jede Modus-Variante ist ein eigener Button (keine Selects mehr).
// Echte Action-Tests: sketchForms(ed) registriert je Variante eine Action
// (`sketch:form:${key}`); die Tests fahren run()/on()/enabled() dieser Actions —
// statt den Ablauf manuell zu replizieren (Review-Fund).
// sketchPanel.ts ist unter run-ts.mjs nicht direkt importierbar (Vite-`?url`-Wasm:
// Build bricht ohne Loader für `.wasm?url` ab, belegt per Probe-Bundle); es wird
// darum zur Laufzeit mit esbuild gebündelt (wasm?url → Leer-Stub) und als echte
// Registrierung gefahren — kein Grep-Test, keine nachgebaute Logik.
import type { sketchForms as sketchFormsType } from '../src/sketchPanel';
import type { ToolbarAction } from '../src/toolbars/registry';
import type { Plugin } from 'esbuild';
async function loadSketchForms(): Promise<typeof sketchFormsType> {
  const { createRequire } = await import('node:module');
  const { build } = createRequire(import.meta.url)('esbuild') as typeof import('esbuild');
  const stub: Plugin = {
    name: 'sketchforms-wasm-url-stub',
    setup(b) {
      b.onResolve({ filter: /\.wasm\?url$/ }, (a) => ({ path: a.path, namespace: 'sketchforms-wasm-url-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'sketchforms-wasm-url-stub' },
        () => ({ contents: 'export default "";', loader: 'js' }));
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'kizamubeam-sketchforms-'));
  const out = join(dir, 'sketchPanel.mjs');
  await build({
    entryPoints: [resolve('src/sketchPanel.ts')],
    bundle: true, platform: 'node', format: 'esm', outfile: out,
    loader: { '.woff': 'empty', '.woff2': 'empty' },
    plugins: [stub], logLevel: 'error',
  });
  try {
    const panel = await import(pathToFileURL(out).href) as { sketchForms: typeof sketchFormsType };
    return panel.sketchForms;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const sketchForms = await loadSketchForms();

/** Harness-Editor für die Formular-Actions: echte setSketchTool-Pipeline, Canvas-Stub. */
function variantEditor(): Editor {
  const sk = M.emptySketch();
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  const s = { tool: 'select', sk, sel: new Set<number>(), draft: [], draftIds: [], dimPick: [],
    relationPick: undefined, frame: undefined, frameKeys: undefined, polyline: undefined,
    polylinePointer: undefined, centerRectPress: undefined, trimPreview: undefined,
    trimPointer: undefined, trimPressed: undefined, valueEdit: undefined, dimPress: undefined,
    mirrorLineMode: false, snapCycle: undefined, polylineArc: false, dimRoundFlip: undefined } as never;
  const canvas = { hasAttribute: () => true, focus() {} };
  const ed = { sketchEdit: s, canvas, hint: '', trackPts: undefined as never,
    emit() {}, redraw() {}, clearSnap() {}, clearTrack() {} } as unknown as Editor;
  Object.setPrototypeOf(ed, proto);
  return ed;
}

/** Eine Variante über die echte Action-Registrierung fahren (keine replizierte Logik). */
function runVariant(def: FV.SketchVariantDef): { ed: Editor; byId: Map<string, ToolbarAction>; action: ToolbarAction } {
  const ed = variantEditor();
  const { actions } = sketchForms(ed);
  const byId = new Map(actions.map((a) => [a.id, a]));
  const action = byId.get(`sketch:form:${def.key}`);
  assert.ok(action, `Action sketch:form:${def.key} registriert`);
  return { ed, byId, action };
}

/** Alle Varianten-Actions einer Gruppe fahren: run() setzt Tool+Modus, on() ist exklusiv. */
function checkVariantGroup(opts: {
  group: FV.SketchVariantGroup;
  tool: FV.SketchVariantDef['tool'];
  keys: string[];
  probe: { key: string; modeField: string; mode: string };
}): void {
  const defs = FV.SKETCH_VARIANTS.filter((v) => v.group === opts.group);
  assert.equal(defs.length, opts.keys.length, `${opts.group}: Variantenzahl`);
  for (const def of defs) {
    const { ed, byId, action } = runVariant(def);
    assert.equal(action.enabled?.(), true, `${def.key} verfügbar`);
    action.run();
    assert.equal(ed.sketchEdit!.tool, opts.tool, `${def.key} setzt Tool ${opts.tool}`);
    assert.ok(FV.isSketchVariantActive(ed.sketchEdit! as unknown as FV.SketchVariantTarget, def.key), `${def.key} aktiv`);
    for (const other of defs)
      assert.equal(byId.get(`sketch:form:${other.key}`)?.on?.(), other.key === def.key, `on() ${other.key} nach run(${def.key})`);
  }
  const probeDef = FV.SKETCH_VARIANTS.find((v) => v.key === opts.probe.key)!;
  const probe = runVariant(probeDef);
  probe.action.run();
  assert.equal(probe.ed.sketchEdit!.tool, opts.tool, `${opts.probe.key} setzt Tool ${opts.tool}`);
  assert.equal((probe.ed.sketchEdit as unknown as Record<string, string>)[opts.probe.modeField],
    opts.probe.mode, `${opts.probe.key} setzt ${opts.probe.modeField}=${opts.probe.mode}`);
  assert.deepEqual(defs.map((d) => d.key).sort(), opts.keys);
}

test('Verdrahtung: Kreis-Varianten setzen Tool+Modus (5 Buttons)', () => {
  checkVariantGroup({ group: 'circle', tool: 'circle',
    keys: ['circle-centerRim', 'circle-threePoint', 'circle-threeTangent', 'circle-twoPoint', 'circle-twoTangent'],
    probe: { key: 'circle-twoPoint', modeField: 'circleMode', mode: 'twoPoint' } });
});

test('Verdrahtung: Rechteck-Varianten setzen Tool+Modus (3 Buttons)', () => {
  checkVariantGroup({ group: 'rectangle', tool: 'rect',
    keys: ['rect-centerCorner', 'rect-corners', 'rect-threePoint'],
    probe: { key: 'rect-centerCorner', modeField: 'rectMode', mode: 'centerCorner' } });
});

test('Verdrahtung: Slot-Varianten setzen Tool+Modus (4 Buttons)', () => {
  checkVariantGroup({ group: 'slot', tool: 'slot',
    keys: ['slot-arcCenter', 'slot-arcThreePoint', 'slot-centerToCenter', 'slot-overall'],
    probe: { key: 'slot-overall', modeField: 'slotMode', mode: 'overall' } });
});

test('Verdrahtung: Bogen-Varianten setzen Tool+Modus (2 Buttons)', () => {
  checkVariantGroup({ group: 'arc', tool: 'arc',
    keys: ['arc-centerStartEnd', 'arc-tangent'],
    probe: { key: 'arc-tangent', modeField: 'arcMode', mode: 'tangent' } });
});

test('Verdrahtung: Konstruktions-Varianten setzen Tool+Modus (10 Buttons, eine Flyout-Gruppe)', () => {
  checkVariantGroup({ group: 'constr', tool: 'constr',
    keys: ['constr-angle', 'constr-bisector', 'constr-externalTangent',
      'constr-free', 'constr-horizontal', 'constr-parallel', 'constr-perpendicular', 'constr-pointTangent',
      'constr-twoTangent', 'constr-vertical'],
    probe: { key: 'constr-horizontal', modeField: 'constrMode', mode: 'horizontal' } });
});

test('Verdrahtung: Varianten-Actions ohne sketchEdit weder verfügbar noch wirksam (Gating)', () => {
  const ed = variantEditor();
  const { actions } = sketchForms(ed);
  const variantIds = new Set(FV.SKETCH_VARIANTS.map((v) => `sketch:form:${v.key}`));
  const variants = actions.filter((a) => variantIds.has(a.id));
  assert.equal(variants.length, FV.SKETCH_VARIANTS.length, 'alle 24 Varianten als Action registriert');
  for (const def of FV.SKETCH_VARIANTS)
    assert.ok(variants.some((a) => a.id === `sketch:form:${def.key}`), `sketch:form:${def.key} registriert`);
  assert.equal(variants.find((a) => a.id === 'sketch:form:unbekannt'), undefined,
    'falsche ID findet keine Action (Rot-Beleg: ohne Registrierung wäre der Lookup leer)');
  (ed as unknown as { sketchEdit: null }).sketchEdit = null;
  for (const a of variants) {
    assert.equal(a.enabled?.(), false, `${a.id} ohne sketchEdit nicht verfügbar`);
    assert.equal(a.on?.(), false, `${a.id} ohne sketchEdit nicht aktiv`);
    a.run(); // No-op statt Absturz (available-Gating in der Registrierung)
  }
  assert.equal(ed.sketchEdit, null, 'run() ohne sketchEdit bleibt No-op');
});

for (const p of pending) await p;

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
