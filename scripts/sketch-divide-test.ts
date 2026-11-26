// Paket C (Teilen: Kurve in N gleiche Teile): Anteile, Grenzen, ein Undo, Kurve unverändert.
// Aufruf: npm run test:sketch-divide (node scripts/run-ts.mjs scripts/sketch-divide-test.ts)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import type { Editor } from '../src/editor';
const M = await import('../src/sketch/model');
const D = await import('../src/sketch/divide');
const S = await import('../src/sketch/solver');
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc } = await import('../src/model');

S.setSolverWasm(resolve('node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'));
await S.loadSolver();

let failed = 0;
const pending: Promise<void>[] = [];
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

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

/** Voller Editor (Prototyp, kein Konstruktor) mit Skizzen-Objekt: echte sketchChange/Undo-Pfade. */
function divideEditor(sk: M.Sketch, sel: number[], n: number | null) {
  const json = M.sketchJson(sk);
  const obj = { id: 1, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: M.sketchSubs(sk) } };
  const doc = newDoc();
  doc.objs = [obj as never];
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc,
    sketchEdit: { obj, m: (obj as { m: number[] }).m, sk, json, tool: 'select', sel: new Set(sel), labels: [], draft: [], draftIds: [], dimPick: [], status: null },
    history: new History(),
    onSketchValue: async () => (n === null ? null : { v: n }),
    listeners: new Set(), view: { zoom: 1, ox: 0, oy: 0 }, hint: '',
    sel: [], tool: 'sketch', drag: null, draft: null, clipboard: [],
    nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
  });
  ed.redraw = () => {};
  ed.scheduleSave = () => {};
  ed.syncTextLinks = () => {};
  return ed;
}

const lineSketch = () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 30, 0);
  const line = M.addLine(sk, a.id, b.id);
  return { sk, line };
};

test('Linie: N-1 Punkte auf Bogenlängen-Anteilen k/N, Kurve unverändert', () => {
  const { sk, line } = lineSketch();
  const curveBefore = JSON.stringify(M.entOf(sk, line.id));
  const plan = D.planSketchDivide(sk, line.id, 3);
  assert.ok(plan);
  assert.equal(plan.points.length, 2);
  near(plan.points[0].x, 10); near(plan.points[0].y, 0);
  near(plan.points[1].x, 20); near(plan.points[1].y, 0);
  assert.equal(D.applySketchDivide(sk, line.id, 3), undefined);
  assert.equal(JSON.stringify(M.entOf(sk, line.id)), curveBefore);
  const pts = sk.ents.filter((e) => e.t === 'point');
  assert.equal(pts.length, 2);
  for (const p of pts) {
    assert.equal(p.aux, undefined);
    const pid = p.t === 'point' ? p.p : -1;
    assert.ok(sk.cons.some((c) => c.t === 'pointOnLine' && c.r[0] === pid && c.r[1] === line.id), 'Punkt-auf-Kurve-Bindung');
  }
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
});

test('Kreis: N Punkte gleichmäßig ab +X-Achse', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 5, 5);
  const circle = M.addCircle(sk, c.id, 10);
  const plan = D.planSketchDivide(sk, circle.id, 4);
  assert.ok(plan);
  assert.equal(plan.points.length, 4);
  for (const [i, [x, y]] of [[15, 5], [5, 15], [-5, 5], [5, -5]].entries()) {
    near(plan.points[i].x, x); near(plan.points[i].y, y);
  }
  assert.equal(D.applySketchDivide(sk, circle.id, 4), undefined);
  assert.equal(sk.ents.filter((e) => e.t === 'point').length, 4);
  assert.ok(sk.cons.every((co) => co.t === 'pointOnCircle' && co.r[1] === circle.id));
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
});

test('Bogen: N-1 Punkte auf a0..a1', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), s = M.addPt(sk, 10, 0), e = M.addPt(sk, 0, 10);
  const arc = M.addArc(sk, c.id, s.id, e.id);
  const plan = D.planSketchDivide(sk, arc.id, 4);
  assert.ok(plan);
  assert.equal(plan.points.length, 3);
  for (const [i, k] of [1, 2, 3].entries()) {
    const a = (Math.PI / 2) * (k / 4);
    near(plan.points[i].x, 10 * Math.cos(a));
    near(plan.points[i].y, 10 * Math.sin(a));
  }
  assert.equal(D.applySketchDivide(sk, arc.id, 4), undefined);
  assert.equal(sk.ents.filter((e) => e.t === 'point').length, 3);
  assert.ok(sk.cons.every((co) => co.t === 'pointOnCircle' && co.r[1] === arc.id));
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
});

test('Grenzen: n außerhalb 2..64 oder nicht ganzzahlig abgelehnt, fremde Typen abgelehnt', () => {
  const { sk, line } = lineSketch();
  for (const n of [0, 1, 65, 100, -3, 2.5, NaN, Infinity]) assert.equal(D.planSketchDivide(sk, line.id, n), undefined, `n=${n}`);
  for (const n of [2, 3, 64]) assert.ok(D.planSketchDivide(sk, line.id, n), `n=${n}`);
  assert.equal(D.applySketchDivide(sk, line.id, 1), false);
  const pt = M.addPt(sk, 1, 1);
  const single = M.addPoint(sk, pt.id);
  assert.equal(D.planSketchDivide(sk, single.id, 3), undefined);
  assert.equal(D.planSketchDivide(sk, 9999, 3), undefined);
  const deg = M.emptySketch();
  const p = M.addPt(deg, 1, 1);
  const zero = M.addLine(deg, p.id, p.id);
  assert.equal(D.planSketchDivide(deg, zero.id, 3), undefined);
});

test('Ein Undo: genau ein Verlaufsschritt, Undo stellt her, Kurve unverändert', async () => {
  const { sk, line } = lineSketch();
  const curveBefore = JSON.stringify(M.entOf(sk, line.id));
  const ed = divideEditor(sk, [line.id], 3);
  const before = ed.state(), pos = ed.history.position;
  await ed.sketchDivideSelected();
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.equal(JSON.stringify(M.entOf(ed.sketchEdit!.sk, line.id)), curveBefore, 'Kurve unverändert');
  assert.equal(ed.sketchEdit!.sk.ents.filter((e) => e.t === 'point').length, 2);
  const after = ed.state();
  ed.doUndo();
  assert.equal(ed.state(), before);
  ed.doRedo();
  assert.equal(ed.state(), after);
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log(`\nAlle Divide-Tests bestanden (${pending.length} Tests)`);
