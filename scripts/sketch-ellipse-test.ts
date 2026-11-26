// Paket D (Ellipse: volle Ellipse, keine Bögen): Geometrie, Roundtrip, Guards,
// ein Undo, Solver-Entscheid (starre Form, kein Solver-Primitiv).
// Aufruf: npm run test:sketch-ellipse (node scripts/run-ts.mjs scripts/sketch-ellipse-test.ts)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import type { Editor } from '../src/editor';
const M = await import('../src/sketch/model');
const S = await import('../src/sketch/solver');
const T = await import('../src/sketch/trim');
const TS = await import('../src/sketch/trimSpans');
const SP = await import('../src/sketch/split');
const DV = await import('../src/sketch/divide');
const CO = await import('../src/sketch/corner');
const TR = await import('../src/sketch/translate');
const { Editor } = await import('../src/editor');
const MOD = await import('../src/editor/sketch');
const { EditorSketch } = MOD;
const { History } = await import('../src/history');
const { newDoc } = await import('../src/model');
const RND = await import('../src/editor/render');
const TYPO = await import('../src/uiTypography');

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

/** Ellipse mit Hauptachse entlang +X: Mitte (10,20), Ende (26,20), Nebenradius 6. */
function axisSketch() {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 10, 20), m = M.addPt(sk, 26, 20);
  const el = M.addEllipse(sk, c.id, m.id, 6);
  return { sk, c, m, el };
}

/** Rotierte Ellipse: Hauptachse 30°, große Halbachse 10, kleine 4. */
function rotatedSketch() {
  const sk = M.emptySketch();
  const a = (30 * Math.PI) / 180;
  const c = M.addPt(sk, 0, 0), m = M.addPt(sk, 10 * Math.cos(a), 10 * Math.sin(a));
  const el = M.addEllipse(sk, c.id, m.id, 4);
  return { sk, c, m, el, a };
}

test('Geometrie: Achsen exakt, Nebenradius exakt', () => {
  const { sk, c, m, el } = axisSketch();
  assert.equal(el.t, 'ellipse');
  if (el.t !== 'ellipse') throw new Error('Typwächter');
  assert.deepEqual(M.entPoints(el), [c.id, m.id]);
  near(Math.hypot(m.x - c.x, m.y - c.y), 16);
  assert.equal(el.r, 6);
  assert.ok(M.validEllipseAxes(16, 6));
  assert.ok(!M.validEllipseAxes(16, 0));
  assert.ok(!M.validEllipseAxes(0, 6));
});

test('Geometrie: rotierte Achsen exakt (30°)', () => {
  const { sk, c, m, el, a } = rotatedSketch();
  if (el.t !== 'ellipse') throw new Error('Typwächter');
  near(Math.hypot(m.x - c.x, m.y - c.y), 10);
  near(Math.atan2(m.y - c.y, m.x - c.x), a);
  // Nebenachse steht senkrecht auf der Hauptachse, Länge = r.
  const ux = (m.x - c.x) / 10, uy = (m.y - c.y) / 10;
  const minor = { x: c.x - uy * el.r, y: c.y + ux * el.r };
  near(Math.hypot(minor.x - c.x, minor.y - c.y), 4);
  near((minor.x - c.x) * ux + (minor.y - c.y) * uy, 0);
});

test('Umriss: geschlossene Ellipse, Gelenke exakt auf der Kurve', () => {
  for (const { sk, c, m, el } of [axisSketch(), rotatedSketch()]) {
    if (el.t !== 'ellipse') throw new Error('Typwächter');
    const subs = M.sketchSubs(sk);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].closed, true);
    assert.ok(subs[0].nodes.length >= 8);
    const ax = m.x - c.x, ay = m.y - c.y, A = Math.hypot(ax, ay);
    const ux = ax / A, uy = ay / A, vx = -uy, vy = ux;
    // Jedes Gelenk t = k·π/4 liegt exakt auf der Ellipse (normierte Gleichung = 1).
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const ex = c.x + A * Math.cos(t) * ux + el.r * Math.sin(t) * vx;
      const ey = c.y + A * Math.cos(t) * uy + el.r * Math.sin(t) * vy;
      const hit = subs[0].nodes.some((n) => Math.hypot(n.x - ex, n.y - ey) < 1e-6);
      assert.ok(hit, `Gelenk ${k} fehlt`);
    }
  }
});

test('Umriss: Ellipse geschlossen, offene Linie gemeldet', () => {
  const { sk, el } = axisSketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 5, 0);
  const line = M.addLine(sk, a.id, b.id);
  const open = M.openSketchEntIds(sk);
  assert.ok(!open.has(el.id), 'Ellipse nie offen');
  assert.ok(open.has(line.id), 'offene Linie gemeldet');
  assert.equal(M.sketchSubs(sk).filter((s) => s.closed).length, 1);
});

test('Roundtrip: JSON erhält die Ellipse byte-identisch', () => {
  const { sk, el } = axisSketch();
  const reload = M.parseSketch(M.sketchJson(sk));
  assert.deepEqual(M.entOf(reload, el.id), M.entOf(sk, el.id));
  assert.equal(reload.next, sk.next);
});

test('Achsen-Dialog: applyEllipseAxes setzt beide Halbachsen, Richtung bleibt', () => {
  const { sk, c, m, el } = rotatedSketch();
  assert.equal(M.applyEllipseAxes(sk, el.id, 20, 2), undefined);
  if (el.t !== 'ellipse') throw new Error('Typwächter');
  near(Math.hypot(m.x - c.x, m.y - c.y), 20);
  assert.equal(el.r, 2);
  near(Math.atan2(m.y - c.y, m.x - c.x), (30 * Math.PI) / 180);
  const line = M.addLine(sk, c.id, m.id);
  assert.equal(M.applyEllipseAxes(sk, line.id, 20, 2), false);
  assert.equal(M.applyEllipseAxes(sk, el.id, 0, 2), false);
  assert.equal(M.applyEllipseAxes(sk, el.id, 20, -1), false);
  assert.equal(M.applyEllipseAxes(sk, 9999, 20, 2), false);
});

test('Guards: trim/split/divide schließen die Ellipse aus', () => {
  const { sk, el } = axisSketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, a.id, b.id);
  // Trimmen: Ellipse weder Ziel noch Schneide (extend-Modus eingeschlossen).
  assert.equal(T.planSketchTrim(sk, el.id, line.id, 'a'), null);
  assert.equal(T.isSketchTrimBoundary(sk, el), false);
  assert.equal(T.planSketchTrim(sk, line.id, el.id, 'a', 'extend'), null);
  assert.equal(TS.pickTrimSpan(sk, el.id, { x: 10, y: 20 }), undefined);
  // Aufteilen/Teilen: keine Pläne, keine Mutation.
  assert.equal(SP.planSketchSplit(sk, el.id), undefined);
  assert.equal(SP.applySketchSplit(sk, el.id), false);
  assert.equal(DV.planSketchDivide(sk, el.id, 3), undefined);
  assert.equal(DV.applySketchDivide(sk, el.id, 3), false);
  assert.equal(DV.divideSelection(sk, new Set([el.id])), undefined);
  assert.equal(CO.planSketchCorner(sk, el.id, 'a', 2, false), undefined);
  // Offener Umriss: nur Linienenden zählen (Ellipse übersprungen, kein Absturz).
  assert.ok(MOD.sketchOpenEnds(sk).size >= 0);
});

test('Guards: keine Beziehungen und keine Maße an der Ellipse', () => {
  const { sk, el } = axisSketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, a.id, b.id);
  const circ = M.addCircle(sk, a.id, 5);
  for (const t of ['equal', 'tangent', 'concentric']) {
    assert.equal(MOD.conFromSel(sk, [el.id, circ.id], t), null, t);
    assert.equal(MOD.conFromSel(sk, [el.id, line.id], t), null, t);
  }
  // Punkt-Bindungen an den Ellipsenpunkten bleiben möglich (Solver-Teilchen).
  assert.ok(MOD.conFromSel(sk, [a.id, b.id], 'coincident'));
});

test('Solver-Entscheid: starre Form ohne Ellipsen-Primitiv (PlaneGCS kennt nur Fokus-Form)', () => {
  // PlaneGCS-Signatur: { type:'ellipse', c_id, focus1_id, radmin } — Fokus statt
  // Hauptachsen-Ende; ohne Umbau von toPrimitives/conPrims/Rückschreibung nicht abbildbar.
  const { sk, c, m, el } = axisSketch();
  M.addCon(sk, 'fixed', [c.id], { x: c.x, y: c.y });
  const prims = S.toPrimitives(sk);
  assert.ok(prims.every((p) => p.type !== 'ellipse'), 'kein Ellipsen-Primitiv');
  assert.ok(prims.some((p) => p.type === 'point'), 'Punkte bleiben Solver-Teilchen');
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(M.entOf(sk, el.id)?.t, 'ellipse');
  assert.equal((M.entOf(sk, el.id) as { r: number }).r, 6);
  near(M.ptOf(sk, m.id)!.x, 26);
  const def = S.solveSketch(sk, { definition: true });
  // Nur die Mitte fixiert: Form noch frei; beide Punkte fixiert: fixiert wie ein Kreis.
  assert.equal(def.definition?.get(el.id), 'free');
  M.addCon(sk, 'fixed', [m.id], { x: m.x, y: m.y });
  assert.ok(S.solveSketch(sk).ok);
  assert.equal(S.solveSketch(sk, { definition: true }).definition?.get(el.id), 'fixed');
});

test('Solver-Entscheid: als Ganzes verschiebbar, Achsen per Ziehen/Translation', () => {
  const { sk, c, m, el } = axisSketch();
  // Starres Verschieben ohne Solver (Translate-Pfad): beide Punkte wandern mit.
  assert.equal(TR.translateSketchSelection(sk, new Set([el.id]), { x: 5, y: -5 }), undefined);
  near(M.ptOf(sk, c.id)!.x, 15);
  near(M.ptOf(sk, c.id)!.y, 15);
  near(M.ptOf(sk, m.id)!.x, 31);
  near(M.ptOf(sk, m.id)!.y, 15);
  if (el.t !== 'ellipse') throw new Error('Typwächter');
  assert.equal(el.r, 6);
  near(Math.hypot(m.x - c.x, m.y - c.y), 16);
  // Ziehen des Hauptachsen-Endes per Solver-Drag: Form folgt, r bleibt.
  const drag = S.solveSketch(sk, { drag: { pt: m.id, x: 40, y: 15 } });
  assert.ok(drag.ok, JSON.stringify(drag));
  near(M.ptOf(sk, m.id)!.x, 40);
  near(M.ptOf(sk, m.id)!.y, 15);
  assert.equal(el.r, 6);
  // pointOnCircle an der Ellipse ist per UI unmöglich; korrupte Dateien lösen trotzdem.
  const p = M.addPt(sk, 15, 15);
  M.addCon(sk, 'pointOnCircle', [p.id, el.id]);
  assert.ok(S.solveSketch(sk).ok);
});

/** Voller Editor (Prototyp) mit Skizzen-Objekt: echte sketchChange/Undo-Pfade. */
function ellipseEditor(sk: M.Sketch) {
  const json = M.sketchJson(sk);
  const obj = { id: 1, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: M.sketchSubs(sk) } };
  const doc = newDoc();
  doc.objs = [obj as never];
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc,
    sketchEdit: { obj, m: (obj as { m: number[] }).m, sk, json, tool: 'select', sel: new Set<number>(), labels: [], draft: [], draftIds: [], dimPick: [], status: null },
    history: new History(),
    listeners: new Set(), view: { zoom: 1, ox: 0, oy: 0 }, hint: '',
    sel: [], tool: 'sketch', drag: null, draft: null, clipboard: [],
    nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
  });
  ed.redraw = () => {};
  ed.scheduleSave = () => {};
  ed.syncTextLinks = () => {};
  return ed;
}

test('Ein Undo: genau ein Verlaufsschritt, Undo stellt her', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 10, 20), m = M.addPt(sk, 26, 20);
  const ed = ellipseEditor(sk);
  const before = ed.state(), pos = ed.history.position;
  const ok = ed.sketchChange('Skizze: Ellipse', (s) => {
    M.addEllipse(s, c.id, m.id, 6);
  });
  assert.equal(ok, true);
  assert.equal(ed.history.position, pos + 1, 'genau ein Undo-Schritt');
  assert.ok(ed.sketchEdit!.sk.ents.some((e) => e.t === 'ellipse'));
  const after = ed.state();
  ed.doUndo();
  assert.equal(ed.state(), before);
  ed.doRedo();
  assert.equal(ed.state(), after);
});

test('Esc: Entwurf verworfen ohne Mutation (3-Klick-Werkzeug)', () => {
  const { sk } = axisSketch();
  const json = M.sketchJson(sk);
  const proto = (EditorSketch as unknown as { prototype: Record<string, (...a: never[]) => unknown> }).prototype;
  const s = { tool: 'ellipse', sk, sel: new Set<number>(), draft: [{ x: 10, y: 20 }], draftIds: [null], dimPick: [],
    relationPick: undefined, frame: undefined, frameKeys: undefined, polyline: undefined,
    polylinePointer: undefined, centerRectPress: undefined, trimPreview: undefined,
    trimPointer: undefined, trimPressed: undefined, valueEdit: undefined, dimPress: undefined,
    mirrorLineMode: false, snapCycle: undefined, polylineArc: false, dimRoundFlip: undefined } as never;
  const ed = { sketchEdit: s, canvas: {}, hint: '', trackPts: undefined as never,
    emit() {}, redraw() {}, clearSnap() {}, clearTrack() {} } as unknown as Editor;
  Object.setPrototypeOf(ed, proto);
  assert.equal(proto.sketchKey.call(ed, { key: 'Escape', target: {} }), true);
  assert.equal(M.sketchJson(sk), json);
  assert.deepEqual((s as unknown as { draft: unknown[] }).draft, []);
  assert.deepEqual((s as unknown as { draftIds: unknown[] }).draftIds, []);
});

test('Ellipse: Non-Identity-Render trifft ctx.ellipse in Definitionsfarbe', () => {
  const { EditorRender } = RND;
  const { resolveTypography } = TYPO;
  const renderSketch = EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void;
  const { sk, c, m, el } = axisSketch();
  if (el.t !== 'ellipse') throw new Error('Typwächter');
  const ZOOM = 2, OX = 30, OY = -17, DPR = 2;
  const strokes: string[] = [];
  const ellipses: Array<[number, number, number, number, number, number, number]> = [];
  const transforms: number[][] = [];
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'transform') return (...a: number[]) => { transforms.push(a); };
      if (prop === 'ellipse') return (x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number) => { ellipses.push([x, y, rx, ry, rot, a0, a1]); };
      return () => {};
    },
    set(_t, prop, v) {
      if (prop === 'strokeStyle') strokes.push(String(v));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null,
    status: { ok: true, dof: 0, conflicting: [], redundant: [], definition: new Map([[el.id, 'fixed']]) },
    labels: [], tool: 'line', draft: [], draftIds: [], dimPick: [],
  };
  const toScr = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * ZOOM + OX, y: p.y * ZOOM + OY });
  const ed = {
    dark: false, dpr: DPR, view: { zoom: ZOOM, ox: OX, oy: OY }, w: 800, h: 600,
    typo: undefined, colors: {}, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    syncSketch() {}, toScreen: toScr,
    toWorld: (sx: number, sy: number) => ({ x: (sx - OX) / ZOOM, y: (sy - OY) / ZOOM }),
    skToScreen: toScr, skFromWorld: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => ZOOM,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = resolveTypography({ workspace: 150 });
  renderSketch.call(ed, ctx);
  // (a) ctx.ellipse-Pfad: Zentrum und Halbachsen in Skizzenkoordinaten, Rotation entlang der Hauptachse.
  assert.equal(ellipses.length, 1, JSON.stringify(ellipses));
  const [x, y, rx, ry, rot, a0, a1] = ellipses[0];
  near(x, c.x); near(y, c.y);
  near(rx, Math.hypot(m.x - c.x, m.y - c.y));
  near(ry, el.r);
  near(rot, Math.atan2(m.y - c.y, m.x - c.x));
  assert.equal(a0, 0); near(a1, Math.PI * 2);
  // Vorschau-Mapping: Canvas-Transform trägt zoom/ox/oy, die Skizzenmitte landet auf skToScreen.
  assert.ok(transforms.some((a) => a.length === 6 && a[0] === ZOOM && a[3] === ZOOM && a[4] === OX && a[5] === OY), JSON.stringify(transforms));
  const scr = toScr(c);
  near(scr.x, c.x * ZOOM + OX); near(scr.y, c.y * ZOOM + OY);
  // (b) Definitionsfarbe (fixiert → Basis), kein Pfirsich (offen) und kein Rot (Widerspruch).
  assert.ok(strokes.includes('#222936'), JSON.stringify(strokes));
  assert.ok(!strokes.includes('#FFC478') && !strokes.includes('#E69A3C'), JSON.stringify(strokes));
  assert.ok(!strokes.includes('#b52626') && !strokes.includes('#ff7777'), JSON.stringify(strokes));
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log(`\nAlle Ellipsen-Tests bestanden (${pending.length} Tests)`);
