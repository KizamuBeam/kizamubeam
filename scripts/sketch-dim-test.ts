// Bemaßungs-Pakete (SolidCraft-Vorbild): Umschaltung Durchmesser/Radius, Ablage-Typ,
// Bogenlänge, Kante-zu-Kante, Referenzmaße (driven), Ausdrücke/Parameter.
// Aufruf: npm run test:sketch-dim (node scripts/run-ts.mjs scripts/sketch-dim-test.ts)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Editor } from '../src/editor';
const M = await import('../src/sketch/model');
const S = await import('../src/sketch/solver');
const P = await import('../src/params');
const EP = await import('../src/editor/params');
const { EditorSketch } = await import('../src/editor/sketch');
const { History } = await import('../src/history');

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

/** Editor-Stub für addSketchDim/sketchDimPick (wie circleTool in sketch-test.ts), mit echten
 * Param-Methoden, echtem Verlauf und installiertem Dim-Param-Guard (Produktionspfad). */
function dimEditor(sk: ReturnType<typeof M.emptySketch>, onValue: (ed: Editor, title: string, cur: number) => { v: number; expr?: string; place?: { x: number; y: number } } | null) {
  const json = M.sketchJson(sk);
  const shape = { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: M.sketchSubs(sk) };
  const obj = { id: 'sketch', shape, m: [1, 0, 0, 1, 0, 0] };
  const doc: { pages: { name: string; objs: unknown[] }[]; page: number; params?: P.ProjectParam[] } =
    { pages: [{ name: 'Seite 1', objs: [obj] }], page: 0 };
  Object.defineProperty(doc, 'objs', {
    get(this: { pages: { objs: unknown[] }[]; page: number }) { return this.pages[this.page].objs; },
    set(this: { pages: { objs: unknown[] }[]; page: number }, v: unknown[]) { this.pages[this.page].objs = v; },
    enumerable: false, configurable: true,
  });
  const ed = Object.assign(new EditorSketch(), {
    doc,
    sketchEdit: { obj, m: obj.m, sk, json, tool: 'dim', sel: new Set<number>(), labels: [], draft: [], draftIds: [], dimPick: [], status: null },
    history: new History(),
    onSketchValue: async (title: string, cur: number) => onValue(ed as unknown as Editor, title, cur),
    toScreen: (p: { x: number; y: number }) => ({ ...p }),
    toWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
    view: { zoom: 1 },
    emit() {}, redraw() {}, touch() {},
  });
  for (const k of Object.getOwnPropertyNames(EP.EditorParams.prototype)) {
    if (k !== 'constructor' && !(k in ed)) (ed as unknown as Record<string, unknown>)[k] =
      (EP.EditorParams.prototype as unknown as Record<string, unknown>)[k];
  }
  const rec = ed as unknown as Record<string, unknown> & { history: History };
  rec.state = () => JSON.stringify({ doc: (ed as unknown as { doc: unknown }).doc, sel: [] as unknown[] });
  rec.snapshot = (label?: unknown) => rec.history.push((rec.state as () => string)(), typeof label === 'string' ? label : 'test');
  rec.dropSnapshot = () => rec.history.drop();
  EP.guardDimParams(ed as unknown as Editor);
  return ed as unknown as Editor;
}

/** Production owned-input path: return the intent without mutating the document. */
const answerWith = (input: string, unit = 'mm') => (ed: Editor) => {
  const r = EP.readDimField(ed, input, unit);
  if ('error' in r) throw new Error(`unerwarteter readDimField-Fehler: ${r.error}`);
  return r;
};

/** Real History states, complete document replacement, then production sketch synchronization.
 * Only DOM/editor selection cleanup and loadDoc migration/defaulting are outside this fixture. */
function historyStep(ed: Editor, direction: 'undo' | 'redo') {
  const state = direction === 'undo' ? ed.history.stepBack(ed.state()) : ed.history.stepForward(ed.state());
  assert.notEqual(state, null);
  const accessor = Object.getOwnPropertyDescriptor(ed.doc, 'objs')!;
  ed.doc = JSON.parse(state!).doc;
  Object.defineProperty(ed.doc, 'objs', accessor);
  ed.syncSketch();
}

for (const operation of ['add', 'edit'] as const) for (const existing of [false, true]) {
  test(`${operation}: ${existing ? 'existing' : 'new'} Width and dimension restore atomically through Undo/Redo`, async () => {
    const sk = M.emptySketch(), a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, a.id, b.id);
    M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
    M.addCon(sk, 'horizontal', [line.id]);
    const original = operation === 'edit' || existing ? M.addCon(sk, 'distance', [line.id], { v: 10, ...(existing ? { expr: 'Width' } : {}) }) : undefined;
    const ed = dimEditor(sk, answerWith('Width = 25.123456789'));
    if (existing) ed.doc.params = [{ name: 'Width', type: 'number', value: 10 }];
    const before = ed.state(), geometry = M.sketchJson(sk), count = sk.cons.length;
    if (operation === 'edit') await ed.editSketchDim(original!.id);
    else await ed.addSketchDim('distance', [line.id]);
    assert.equal(ed.history.position, 1);
    assert.equal(ed.sketchEdit!.sk.cons.length, count + (operation === 'add' ? 1 : 0));
    assert.equal(ed.findParam('Width')!.value, 25.123456789);
    const con = ed.sketchEdit!.sk.cons.find((c) => c.expr === 'Width')!;
    assert.equal(con.v, 25.123456789);
    near(M.measureCon(ed.sketchEdit!.sk, con)!, 25.123456789);
    const after = ed.state();
    historyStep(ed, 'undo');
    assert.equal(ed.findParam('Width')?.value, existing ? 10 : undefined, 'Undo restores the pre-parameter value/absence');
    assert.equal(ed.state(), before, 'Undo restores the entire original document');
    assert.equal(M.sketchJson(ed.sketchEdit!.sk), geometry, 'Undo restores original geometry and expression');
    historyStep(ed, 'redo');
    assert.equal(ed.state(), after, 'Redo restores the complete accepted document');
    assert.equal(ed.findParam('Width')!.value, 25.123456789);
    const restored = ed.sketchEdit!.sk.cons.find((c) => c.expr === 'Width')!;
    assert.equal(restored.v, 25.123456789);
    near(M.measureCon(ed.sketchEdit!.sk, restored)!, 25.123456789);
  });
}

for (const operation of ['add', 'edit'] as const) for (const cancel of [false, true]) {
  test(`${operation}: ${cancel ? 'cancel' : 'rejection'} preserves document and an existing Redo branch`, async () => {
    const sk = M.emptySketch(), a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, a.id, b.id);
    M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
    M.addCon(sk, 'fixed', [b.id], { x: 10, y: 0 });
    const con = operation === 'edit' ? M.addCon(sk, 'distance', [line.id], { v: 10, expr: 'Width' }) : undefined;
    const ed = dimEditor(sk, cancel ? () => null : answerWith('Width = 99'));
    ed.doc.params = [{ name: 'Width', type: 'number', value: 10 }];
    ed.snapshot('future');
    ed.doc.params[0].value = 12;
    const future = ed.state();
    historyStep(ed, 'undo');
    const before = ed.state(), rows = ed.history.rows();
    if (con) await ed.editSketchDim(con.id);
    else await ed.addSketchDim('distance', [line.id]);
    assert.equal(ed.state(), before);
    assert.deepEqual(ed.history.rows(), rows);
    assert.equal(ed.history.position, 0);
    historyStep(ed, 'redo');
    assert.equal(ed.state(), future, 'the original Redo document remains reachable');
  });
}

test('Umschaltung: Durchmesser/Radius und zurück, sonst null', () => {
  assert.equal(M.toggleRoundDim('radius'), 'diameter');
  assert.equal(M.toggleRoundDim('diameter'), 'radius');
  assert.equal(M.toggleRoundDim('distance'), null);
  assert.equal(M.toggleRoundDim('angle'), null);
});

test('Kreis öffnet sofort die Eingabe; weitere Picks öffnen keine zweite', async () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), q = M.addPt(sk, 10, 0);
  const circle = M.addCircle(sk, c.id, 5);
  M.addCon(sk, 'fixed', [c.id], { x: 0, y: 0 });
  const titles: string[] = [];
  const ed = dimEditor(sk, (_ed, title) => {
    titles.push(title);
    return { v: 8 };
  });
  ed.sketchDimPick({ kind: 'ent', id: circle.id });
  assert.equal(ed.sketchEdit!.dimPick.length, 0);
  ed.sketchDimPick({ kind: 'ent', id: circle.id });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(titles, ['Durchmesser']);
  void q;
});

test('Taste U schaltet die ausstehende runde Wahl um', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0);
  const circle = M.addCircle(sk, c.id, 5);
  const proto = EditorSketch.prototype as unknown as Record<string, (this: unknown, e: unknown) => unknown>;
  const fake = {
    sketchEdit: { tool: 'dim', dimPick: [{ kind: 'ent', id: circle.id }], sk, sel: new Set<number>() },
    hint: '',
    emit() {}, redraw() {},
    dimRoundType: (EditorSketch.prototype as unknown as { dimRoundType: (this: unknown) => unknown }).dimRoundType,
    dimRoundHint: () => {},
  };
  assert.equal(proto.dimRoundType!.call(fake), 'diameter');
  const handled = proto.sketchKey!.call(fake, { key: 'u', target: null });
  assert.equal(handled, true);
  assert.equal((fake.sketchEdit as { dimRoundFlip?: boolean }).dimRoundFlip, true);
  assert.equal(proto.dimRoundType!.call(fake), 'radius');
});

test('Ablage-bestimmt-Typ: gegenüber frei, oben hdistance, daneben vdistance', () => {
  const h: [M.SkPt, M.SkPt] = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }];
  assert.equal(M.classifyDistancePlacement(h[0], h[1], { x: 50, y: 40 }), 'distance');
  assert.equal(M.classifyDistancePlacement(h[0], h[1], { x: 50, y: 7 }), 'hdistance');
  assert.equal(M.classifyDistancePlacement(h[0], h[1], { x: 130, y: 2 }), 'vdistance');
  const v: [M.SkPt, M.SkPt] = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 0, y: 100 }];
  assert.equal(M.classifyDistancePlacement(v[0], v[1], { x: 5, y: 150 }), 'hdistance');
  assert.equal(M.classifyDistancePlacement(v[0], v[1], { x: 40, y: 55 }), 'distance');
});

test('Bogenlänge wird aus Radius und Spannweite gemessen', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), s = M.addPt(sk, 10, 0), e = M.addPt(sk, 0, 10);
  const arc = M.addArc(sk, c.id, s.id, e.id);
  near(M.measureCon(sk, { id: 7, t: 'arcLength', r: [arc.id] })!, (10 * Math.PI) / 2);
  assert.equal(M.measureCon(sk, { id: 7, t: 'arcLength', r: [c.id] }), null);
});

test('Kante-zu-Kante: Linie/Kreis, Punkt/Kreis, Kreis/Kreis (außen, Wand, Überlappung, Berührung)', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, a.id, b.id);
  const cc = M.addPt(sk, 5, 4);
  const circ = M.addCircle(sk, cc.id, 1);
  near(M.measureCon(sk, { id: 20, t: 'distance', r: [line.id, circ.id] })!, 3);
  const p = M.addPt(sk, 0, 0), q = M.addPt(sk, 3, 4);
  const single = M.addCircle(sk, q.id, 2);
  near(M.measureCon(sk, { id: 21, t: 'distance', r: [p.id, single.id] })!, 3);
  const c1 = M.addPt(sk, 0, 0), c2 = M.addPt(sk, 10, 0);
  const k1 = M.addCircle(sk, c1.id, 2), k2 = M.addCircle(sk, c2.id, 3);
  near(M.measureCon(sk, { id: 22, t: 'distance', r: [k1.id, k2.id] })!, 5);
  const g = M.addPt(sk, 0, 0), h = M.addPt(sk, 3, 0);
  const big = M.addCircle(sk, g.id, 10), small = M.addCircle(sk, h.id, 2);
  near(M.measureCon(sk, { id: 23, t: 'distance', r: [big.id, small.id] })!, 5);
  const o1 = M.addPt(sk, 40, 0), o2 = M.addPt(sk, 48, 0);
  const v1 = M.addCircle(sk, o1.id, 5), v2 = M.addCircle(sk, o2.id, 5);
  near(M.measureCon(sk, { id: 24, t: 'distance', r: [v1.id, v2.id] })!, -2);
  const t1 = M.addPt(sk, 60, 0), t2 = M.addPt(sk, 70, 0);
  const w1 = M.addCircle(sk, t1.id, 5), w2 = M.addCircle(sk, t2.id, 5);
  near(M.measureCon(sk, { id: 25, t: 'distance', r: [w1.id, w2.id] })!, 0);
});

test('Lückensegment liegt senkrecht/radial/auf der Zentrumsachse', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, a.id, b.id);
  const cc = M.addPt(sk, 5, 4);
  const circ = M.addCircle(sk, cc.id, 1);
  const seg = M.gapSegment(sk, [line.id, circ.id])!;
  near(seg.a.x, 5); near(seg.a.y, 0); near(seg.b.x, 5); near(seg.b.y, 3); near(seg.gap, 3);
});

test('driven bleibt Legacy-byte-identisch, übersteht parsen', () => {
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
  M.addCon(sk, 'distance', [p1.id, p2.id], { v: 10 });
  assert.ok(!M.sketchJson(sk).includes('driven'));
  M.addCon(sk, 'distance', [p1.id, p2.id], { v: 10, driven: true });
  const back = M.parseSketch(M.sketchJson(sk));
  assert.equal(back.cons.filter((c) => c.driven).length, 1);
  assert.equal(back.cons.filter((c) => !c.driven).length, 1);
});

test('Solver ignoriert driven; treibender Widerspruch schlägt fehl', () => {
  const driving = () => {
    const sk = M.emptySketch();
    const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
    M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
    M.addCon(sk, 'fixed', [p2.id], { x: 10, y: 0 });
    M.addCon(sk, 'distance', [p1.id, p2.id], { v: 10 });
    return { sk, p1, p2 };
  };
  {
    const { sk } = driving();
    M.addCon(sk, 'distance', [sk.pts[0].id, sk.pts[1].id], { v: 99, driven: true });
    const r = S.solveSketch(sk);
    assert.ok(r.ok);
    assert.equal(r.conflicting.length, 0);
    near(M.measureCon(sk, { id: 0, t: 'distance', r: [sk.pts[0].id, sk.pts[1].id] })!, 10);
  }
  {
    const { sk } = driving();
    M.addCon(sk, 'distance', [sk.pts[0].id, sk.pts[1].id], { v: 99 });
    const r = S.solveSketch(sk);
    assert.ok(!r.ok || r.conflicting.length > 0);
  }
});

test('Bogenlänge löst am Bogen (Radius fest, Anfang fest)', () => {
  const sk = M.emptySketch();
  const c = M.addPt(sk, 0, 0), s = M.addPt(sk, 10, 0), e = M.addPt(sk, 0, 10);
  const arc = M.addArc(sk, c.id, s.id, e.id);
  M.addCon(sk, 'fixed', [c.id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [s.id], { x: 10, y: 0 });
  M.addCon(sk, 'radius', [arc.id], { v: 10 });
  M.addCon(sk, 'arcLength', [arc.id], { v: (10 * Math.PI) / 2 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
  near(M.measureCon(sk, { id: 99, t: 'arcLength', r: [arc.id] })!, (10 * Math.PI) / 2, 1e-3);
  const ent = M.entOf(sk, arc.id);
  assert.ok(ent?.t === 'arc');
  if (ent?.t === 'arc') near(Math.hypot(M.ptOf(sk, ent.e)!.x, M.ptOf(sk, ent.e)!.y), 10, 1e-3);
});

test('Lücke Linie↔Kreis löst bei festem Radius (Zentrum wandert)', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [b.id], { x: 10, y: 0 });
  const cc = M.addPt(sk, 5, 8);
  const circ = M.addCircle(sk, cc.id, 2);
  M.addCon(sk, 'diameter', [circ.id], { v: 4 });
  M.addCon(sk, 'distance', [line.id, circ.id], { v: 3 });
  const r = S.solveSketch(sk);
  assert.ok(r.ok, JSON.stringify(r));
  near(M.ptOf(sk, cc.id)!.y, 5, 1e-4);
  near(circ.r, 2);
});

test('Überbestimmt lösbar → Referenzmaß; unmöglich → Ablehnung', async () => {
  const setup = () => {
    const sk = M.emptySketch();
    const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, p1.id, p2.id);
    M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
    M.addCon(sk, 'horizontal', [line.id]);
    M.addCon(sk, 'distance', [line.id], { v: 10 });
    return { sk, p1, p2 };
  };
  {
    const { sk, p1, p2 } = setup();
    const n = sk.cons.length;
    const ed = dimEditor(sk, () => ({ v: 10 }));
    await ed.addSketchDim('distance', [p1.id, p2.id]);
    assert.equal(sk.cons.length, n + 1);
    assert.equal(sk.cons[sk.cons.length - 1].driven, true);
  }
  {
    const { sk, p1, p2 } = setup();
    const n = sk.cons.length;
    const ed = dimEditor(sk, () => ({ v: 99 }));
    await ed.addSketchDim('distance', [p1.id, p2.id]);
    assert.equal(sk.cons.length, n);
  }
});

test('Dialog-Param: readDimField legt keinen Projekt-Parameter an (nur Intent, echt)', () => {
  const sk = M.emptySketch();
  const ed = dimEditor(sk, () => ({ v: 99 }));
  ed.doc.params = [{ name: 'P', type: 'number', value: 10 }];
  const pos = ed.history.position;
  const r = EP.readDimField(ed, 'Neu = 99', 'mm');
  if ('error' in r) throw new Error(`unerwartet: ${r.error}`);
  assert.equal(r.v, 99);
  assert.equal(r.expr, 'Neu');
  assert.deepEqual(r.pendingParam, { name: 'Neu', value: 99 });
  assert.ok(!ed.paramList().some((p) => p.name === 'Neu'), 'readDimField darf nichts anlegen');
  assert.equal(ed.history.position, pos, 'readDimField darf keinen Verlaufsschritt anlegen');
  const bad = EP.readDimField(ed, 'Neu = 1/0', 'mm');
  assert.ok('error' in bad, 'ungültiger Wert meldet Fehler statt anzulegen');
  assert.ok(!ed.paramList().some((p) => p.name === 'Neu'));
});

test('Bemaßungs-Durchgänge rollen die Param-Anlage bei Rejekt zurück (Guard-Pfad, echt)', async () => {
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, p1.id, p2.id);
  M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  M.addCon(sk, 'distance', [line.id], { v: 10 });
  const ed = dimEditor(sk, answerWith('Neu = 99'));
  const pos = ed.history.position, state = ed.state(), n = sk.cons.length;
  await ed.addSketchDim('distance', [p1.id, p2.id]);
  assert.equal(sk.cons.length, n, 'unmögliches Maß darf kein Maß anlegen');
  assert.ok(!ed.paramList().some((p) => p.name === 'Neu'), 'abgelehntes Maß darf keinen Parameter hinterlassen');
  assert.equal(ed.history.position, pos, 'Rejekt darf keinen Verlaufsschritt hinterlassen (kein No-op-Undo)');
  assert.equal(ed.state(), state, 'Rejekt muss den Dokumentstand unverändert lassen');
});

test('Ablehnung mit neuem Parameter lässt paramList() unverändert (Neu = 99)', async () => {
  const setup = () => {
    const sk = M.emptySketch();
    const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, p1.id, p2.id);
    M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
    M.addCon(sk, 'horizontal', [line.id]);
    M.addCon(sk, 'distance', [line.id], { v: 10 });
    return { sk, p1, p2 };
  };
  {
    // Unmöglicher Wert: Trial schlägt fehl, kein Maß — der bereitgestellte Parameter
    // wird nur im Trial-Scope verwendet und nie im Dokument angelegt.
    const { sk, p1, p2 } = setup();
    const ed = dimEditor(sk, answerWith('Neu = 99'));
    const pos = ed.history.position, state = ed.state();
    const n = sk.cons.length;
    await ed.addSketchDim('distance', [p1.id, p2.id]);
    assert.equal(sk.cons.length, n, 'unmögliches Maß darf kein Maß anlegen');
    assert.ok(!ed.paramList().some((p) => p.name === 'Neu'), 'abgelehntes Maß darf keinen Parameter hinterlassen');
    assert.equal(ed.history.position, pos, 'Rejekt darf keinen Verlaufsschritt hinterlassen');
    assert.equal(ed.state(), state, 'Rejekt muss den Dokumentstand unverändert lassen');
  }
  {
    // Möglicher Wert: Maß mit Formel angelegt, Parameter bleibt (kein Über-Rollback).
    const { sk, p1, p2 } = setup();
    const ed = dimEditor(sk, answerWith('Neu = 10'));
    const pos = ed.history.position;
    const n = sk.cons.length;
    await ed.addSketchDim('distance', [p1.id, p2.id]);
    assert.equal(sk.cons.length, n + 1);
    const c = sk.cons[sk.cons.length - 1];
    assert.equal(c.expr, 'Neu');
    near(c.v!, 10);
    assert.ok(ed.paramList().some((p) => p.name === 'Neu'), 'angenommenes Maß behält den Parameter');
    assert.equal(ed.history.position, pos + 1, 'Erfolg legt genau einen Verlaufsschritt an');
  }
});

test('Neu = …-Erfolg als Referenzmaß: redundantes Maß wird driven, Param bleibt, ein Schritt', async () => {
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, p1.id, p2.id);
  M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  M.addCon(sk, 'distance', [line.id], { v: 10 });
  const ed = dimEditor(sk, answerWith('Neu = 10'));
  const pos = ed.history.position;
  const n = sk.cons.length;
  await ed.addSketchDim('distance', [p1.id, p2.id]);
  assert.equal(sk.cons.length, n + 1);
  const c = sk.cons[sk.cons.length - 1];
  assert.equal(c.driven, true, 'redundantes Maß mit gleichem Wert wird Referenzmaß');
  assert.equal(c.expr, 'Neu');
  near(c.v!, 10);
  assert.ok(ed.paramList().some((p) => p.name === 'Neu'), 'Referenzmaß behält den Parameter');
  assert.equal(ed.history.position, pos + 1, 'Referenzmaß legt genau einen Verlaufsschritt an');
});

test('Ausdrücke, Einheiten und name = wert (paramList-Pfad)', async () => {
  assert.equal(P.evaluate('1in', P.scopeOf([])), 25.4);
  assert.equal(P.evaluate(M.normalizeDimUnits('1 in'), P.scopeOf([])), 25.4);
  assert.equal(M.normalizeDimUnits('2 * 5 mm'), '2 * 5mm');
  assert.equal(P.evaluate('2*width', P.scopeOf([{ name: 'width', type: 'number', value: 5 }])), 10);
  assert.deepEqual(M.splitDimAssignment('width = 2*5'), { name: 'width', expr: '2*5' });
  assert.deepEqual(M.splitDimAssignment('  Breite = Breite + 1 '), { name: 'Breite', expr: 'Breite + 1' });
  assert.equal(M.splitDimAssignment('2*5'), null);
  assert.equal(M.splitDimAssignment(''), null);
  assert.equal(M.splitDimAssignment('a == b'), null);
  assert.equal(M.splitDimAssignment('= 5'), null);
  // Maß mit Formel auf Projekt-Parameter löst über den paramList-Pfad
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 40, 0);
  const line = M.addLine(sk, p1.id, p2.id);
  M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  const ed = dimEditor(sk, () => ({ v: 10, expr: 'width' }));
  (ed.doc as { params: P.ProjectParam[] }).params = [{ name: 'width', type: 'number', value: 10 }];
  await ed.addSketchDim('distance', [line.id]);
  const c = sk.cons[sk.cons.length - 1];
  assert.equal(c.expr, 'width');
  near(c.v!, 10);
});

test('Bewusste Ablage beim Setzen bestimmt frei/hdistance/vdistance', async () => {
  const setup = () => {
    const sk = M.emptySketch();
    const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 100, 0);
    M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
    return { sk, p1, p2 };
  };
  const placed = async (place: { x: number; y: number } | undefined, v: number) => {
    const { sk, p1, p2 } = setup();
    const ed = dimEditor(sk, () => ({ v, place }));
    await ed.addSketchDim('distance', [p1.id, p2.id]);
    return sk.cons[sk.cons.length - 1].t;
  };
  assert.equal(await placed({ x: 50, y: 40 }, 100), 'distance');
  assert.equal(await placed({ x: 50, y: 7 }, 100), 'hdistance');
  assert.equal(await placed({ x: 130, y: 2 }, 10), 'vdistance');
  assert.equal(await placed(undefined, 100), 'distance');
});

test('Exist-Param: P = 10 → 99 bei Rejekt stellt Wert, Geometrie und Verlauf zurück', async () => {
  // Die Skizze referenziert P und bleibt mit 99 lösbar (Punkt wandert mit): refreshSketchParams
  // löst neu, dadurch ändert sich die Skizze auch ohne neues Maß. Der Rejekt darf sich davon
  // nicht täuschen lassen — P muss zurück auf 10, Geometrie und Verlauf mit.
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, p1.id, p2.id);
  const p3 = M.addPt(sk, 50, 0);
  M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
  M.addCon(sk, 'fixed', [p3.id], { x: 50, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  M.addCon(sk, 'distance', [line.id], { v: 10, expr: 'P' });
  const ed = dimEditor(sk, answerWith('P = 99'));
  ed.doc.params = [{ name: 'P', type: 'number', value: 10 }];
  const pos = ed.history.position, state = ed.state(), n = sk.cons.length;
  await ed.addSketchDim('distance', [p1.id, p3.id]);
  assert.equal(sk.cons.length, n, 'unmögliches Maß darf kein Maß anlegen');
  assert.equal(ed.findParam('P')!.value, 10, 'abgelehnter Wert darf den Parameter nicht verändern');
  near(M.ptOf(sk, p2.id)!.x, 10, 1e-6);
  near(sk.cons.find((c) => c.expr === 'P')!.v!, 10);
  assert.equal(ed.history.position, pos, 'Rejekt darf keinen Verlaufsschritt hinterlassen');
  assert.equal(ed.state(), state, 'Rejekt muss den Dokumentstand unverändert lassen');
});

test('Rejekt hinterlässt keinen No-op-Undo (Verlaufszeilen unverändert, Redo leer)', async () => {
  const sk = M.emptySketch();
  const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
  const line = M.addLine(sk, p1.id, p2.id);
  M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
  M.addCon(sk, 'horizontal', [line.id]);
  M.addCon(sk, 'distance', [line.id], { v: 10 });
  const ed = dimEditor(sk, answerWith('Neu = 99'));
  ed.snapshot('Basis');
  const rows = ed.history.rows().map((r) => r.label);
  const state = ed.state(), pos = ed.history.position;
  await ed.addSketchDim('distance', [p1.id, p2.id]);
  assert.deepEqual(ed.history.rows().map((r) => r.label), rows, 'kein verwaister Undo-Schritt');
  assert.equal(ed.history.position, pos);
  assert.equal(ed.state(), state);
  assert.equal(ed.history.rows().filter((r) => r.undone).length, 0, 'kein wiederholbarer Phantom-Schritt');
  assert.equal(ed.history.nextUndo(), 'Basis');
});

test('editSketchDim: Rejekt mit neuem Param rollt zurück, Erfolg behält ihn', async () => {
  const setup = (fixP2: boolean) => {
    const sk = M.emptySketch();
    const p1 = M.addPt(sk, 0, 0), p2 = M.addPt(sk, 10, 0);
    const line = M.addLine(sk, p1.id, p2.id);
    M.addCon(sk, 'fixed', [p1.id], { x: 0, y: 0 });
    if (fixP2) M.addCon(sk, 'fixed', [p2.id], { x: 10, y: 0 });
    M.addCon(sk, 'horizontal', [line.id]);
    const c = M.addCon(sk, 'distance', [line.id], { v: 10 });
    return { sk, id: c.id };
  };
  {
    const { sk, id } = setup(true);
    const ed = dimEditor(sk, answerWith('Q = 99'));
    const pos = ed.history.position, state = ed.state();
    await ed.editSketchDim(id);
    // sketchChange ersetzt s.sk bei Rejekt durch einen unberührten Klon: frisch lesen.
    const cur = ed.sketchEdit!.sk;
    const c = cur.cons.find((x) => x.id === id)!;
    assert.equal(c.v, 10, 'abgelehnte Änderung darf das Maß nicht verändern');
    assert.ok(!('expr' in c || c.expr), 'abgelehnte Änderung darf keine Formel hinterlassen');
    assert.ok(!ed.paramList().some((p) => p.name === 'Q'));
    assert.equal(ed.history.position, pos, 'Rejekt darf keinen Verlaufsschritt hinterlassen');
    assert.equal(ed.state(), state);
  }
  {
    const { sk, id } = setup(false);
    const ed = dimEditor(sk, answerWith('Q = 25'));
    const pos = ed.history.position;
    await ed.editSketchDim(id);
    const c = sk.cons.find((x) => x.id === id)!;
    assert.equal(c.expr, 'Q');
    near(c.v!, 25);
    assert.ok(ed.paramList().some((p) => p.name === 'Q'), 'angenommene Änderung behält den Parameter');
    assert.equal(ed.history.position, pos + 1, 'Erfolg legt genau einen Verlaufsschritt an');
  }
});

test('withDimParamRollback direkt: Rejekt ohne Commit rollt zurück, Commit behält', async () => {
  const sk = M.emptySketch();
  const ed = dimEditor(sk, () => null);
  const pos = ed.history.position, state = ed.state();
  await EP.withDimParamRollback(ed, async () => {
    EP.materializeDimParam(ed, { name: 'Neu', value: 99 });
  });
  assert.ok(!ed.paramList().some((p) => p.name === 'Neu'));
  assert.equal(ed.history.position, pos, 'Rejekt ohne Commit darf keinen Verlaufsschritt hinterlassen');
  assert.equal(ed.state(), state);
  await EP.withDimParamRollback(ed, async () => {
    EP.materializeDimParam(ed, { name: 'Neu', value: 10 });
    ed.snapshot('Skizze: Bemaßung');
  });
  assert.ok(ed.paramList().some((p) => p.name === 'Neu'), 'Commit (Maß-Con persistiert) behält den Parameter');
  assert.equal(ed.history.position, pos + 1, 'genau der Maß-Schritt bleibt im Verlauf');
});

test('Verdrahtung (statisch): installSketchPanel sichert add/editSketchDim über guardDimParams ab', () => {
  // sketchPanel.ts braucht DOM/Vite (?url-Wasm) und läuft nicht unter run-ts.mjs; darum nur
  // Verdrahtungsnachweis — das Verhalten prüfen die echten Guard-Tests oben.
  const src = readFileSync(fileURLToPath(new URL('../src/sketchPanel.ts', import.meta.url)), 'utf8');
  assert.ok(src.includes("from './editor/params'") && src.includes('guardDimParams'),
    'sketchPanel muss guardDimParams aus ./editor/params beziehen');
  assert.ok(src.includes('guardDimParams(ed)'), 'installSketchPanel muss den Guard installieren');
});

test('one owned pending edit rejects duplicate entry and stale document commits', async () => {
  const sk = M.emptySketch(), a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 3);
  const answers: ((value: { v: number } | null) => void)[] = [];
  const ed = dimEditor(sk, () => null);
  ed.onSketchValue = () => new Promise((resolve) => { answers.push(resolve); });
  const first = ed.addSketchDim('distance', [a.id, b.id]);
  const second = ed.addSketchDim('distance', [a.id, b.id]);
  const before = ed.history.position;
  ed.sketchEdit!.json = 'replaced document';
  answers.forEach((answer) => answer({ v: 12 }));
  await Promise.all([first, second]);
  assert.equal(answers.length, 1, 'only one value request may own the sketch');
  assert.equal(ed.history.position, before);
  assert.equal(sk.cons.length, 0);
});

test('tool switch cancels a pending dimension before the answer can mutate', async () => {
  const sk = M.emptySketch(), a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 3);
  const ed = dimEditor(sk, () => null);
  let answer!: (value: { v: number }) => void;
  ed.onSketchValue = () => new Promise((resolve) => { answer = resolve; });
  Object.assign(ed, { clearTrack() {} });
  const task = ed.addSketchDim('distance', [a.id, b.id]);
  ed.setSketchTool('line');
  answer({ v: 12 });
  await task;
  assert.equal(sk.cons.length, 0);
  assert.equal(ed.history.position, 0);
});

await Promise.all(pending);
if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log(`\nAlle Dimensions-Tests bestanden (${pending.length} Tests)`);
