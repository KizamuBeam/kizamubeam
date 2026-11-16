import './core-fixtures-env';
import assert from 'node:assert/strict';
import { recognize, SHAPER_MIN_CONFIDENCE } from '../src/shaper';
import type { Pt } from '../src/model';

let count = 0;
function test(name: string, f: () => void) { f(); count++; console.log(`PASS ${name}`); }

// Deterministisches Wackeln (kein Math.random): Sinus-Mix wie Pencil-Tests
const jit = (i: number, a: number) => Math.sin(i * 12.9898) * 0.5 * a + Math.sin(i * 3.7) * 0.5 * a;

function stroke(n: number, f: (t: number) => Pt, wobble = 0.4): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = f(i / (n - 1));
    out.push({ x: p.x + jit(i, wobble), y: p.y + jit(i + 50, wobble) });
  }
  return out;
}

test('gerade Linie wird erkannt', () => {
  const m = recognize(stroke(40, (t) => ({ x: t * 100, y: t * 5 })));
  assert.ok(m && m.kind === 'line', `erwartet line, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m.confidence >= SHAPER_MIN_CONFIDENCE);
  if (m.kind === 'line') assert.ok(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) > 90);
});

test('Rechteck wird erkannt', () => {
  const per = (t: number): Pt => {
    const p = t * 4, s = 100, h = 60;
    if (p < 1) return { x: p * s, y: 0 };
    if (p < 2) return { x: s, y: (p - 1) * h };
    if (p < 3) return { x: s - (p - 2) * s, y: h };
    return { x: 0, y: h - (p - 3) * h };
  };
  const m = recognize(stroke(120, per));
  assert.ok(m && (m.kind === 'rect' || m.kind === 'roundrect'), `erwartet rect/roundrect, bekommen ${m?.kind ?? 'null'}`);
  assert.ok(m!.confidence >= SHAPER_MIN_CONFIDENCE);
});

test('Kreis wird Ellipse mit rx≈ry', () => {
  const m = recognize(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') {
    assert.ok(Math.abs(m.rx - m.ry) / Math.max(m.rx, m.ry) < 0.25, `rx=${m.rx} ry=${m.ry}`);
    assert.ok(Math.abs(m.rx - 50) < 8, `rx=${m.rx}`);
  }
});

test('Ellipse wird erkannt', () => {
  const m = recognize(stroke(100, (t) => ({ x: 60 + Math.cos(t * Math.PI * 2) * 60, y: 40 + Math.sin(t * Math.PI * 2) * 30 })));
  assert.ok(m && m.kind === 'ellipse', `erwartet ellipse, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'ellipse') assert.ok(m.rx > m.ry * 1.4, `rx=${m.rx} ry=${m.ry}`);
});

test('Dreieck wird Polygon mit 3 Seiten', () => {
  const v = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 40, y: 90 }];
  const per = (t: number): Pt => {
    const p = t * 3, i = Math.min(2, Math.floor(p)), f = p - i;
    const a = v[i], b = v[(i + 1) % 3];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const m = recognize(stroke(90, per));
  assert.ok(m && m.kind === 'polygon', `erwartet polygon, bekommen ${m?.kind ?? 'null'}`);
  if (m.kind === 'polygon') assert.equal(m.sides, 3);
});

test('Kritzel ohne Form bleibt Freihand (null)', () => {
  // Deterministischer Random-Walk: keine Grundform
  let x = 0, y = 0;
  const pts: Pt[] = [];
  for (let i = 0; i < 120; i++) {
    x += Math.sin(i * 7.3) * 9 + Math.sin(i * 1.7) * 4;
    y += Math.cos(i * 5.1) * 9 + Math.cos(i * 2.3) * 4;
    pts.push({ x, y });
  }
  const m = recognize(pts);
  assert.ok(!m || m.confidence < SHAPER_MIN_CONFIDENCE, `erwartet null, bekommen ${m?.kind} @ ${m?.confidence}`);
});

test('Tap und offener Bogen werden keine Ellipse', () => {
  assert.equal(recognize([{ x: 10, y: 10 }, { x: 10, y: 10 }]), null);
  const arc = stroke(60, (t) => ({ x: 50 + Math.cos(t * Math.PI) * 50, y: 50 - Math.sin(t * Math.PI) * 50 }));
  const m = recognize(arc);
  assert.ok(!m || m.kind !== 'ellipse', `offener Bogen darf keine Ellipse sein, bekommen ${m?.kind}`);
});

console.log(`Shaper-Erkennung: ${count} Tests, Schwelle ${SHAPER_MIN_CONFIDENCE}.`);

// --- Slice C: Gesten-Entscheidung am Editor (Fixture wie freehand-edit-test) ---
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { defaultLayer, newDoc, type Obj } from '../src/model';

let failed = 0;
async function etest(name: string, f: () => void | Promise<void>) {
  try { await f(); count++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${(e as Error).stack}`); }
}

function sEditor() {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: newDoc(), sel: [], nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, drag: null,
    canvas: { style: {} }, snapHit: null, alignGuides: [], tool: 'shaper', currentLayer: 0,
    boolKeep: false, shaperRecognize: true, shaperTolerance: 0.2,
    pencilTolerance: 0.2, pencilClosed: false,
  });
  ed.doc.layers[0] = defaultLayer(0);
  ed.emit = () => {};
  ed.redraw = () => {};
  return ed;
}

let nextId = 1000;
function rectObj(x: number, y: number, w: number, h: number): Obj {
  return { id: nextId++, m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w, h, r: 0 } };
}

/** Gerade Geste von a nach b in 1-mm-Schritten (Welt) */
function linePts(a: Pt, b: Pt): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

await etest('Union: offene Geste über zwei Rechtecke verschmilzt (ein Undo)', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 20, 10), rectObj(30, 0, 20, 10)];
  await ed.finishShaper(linePts({ x: -5, y: 5 }, { x: 55, y: 5 }));
  assert.equal(ed.doc.objs.length, 1, 'ein Ergebnisobjekt');
  assert.equal(ed.doc.objs[0].shape.kind, 'path');
  assert.equal(ed.sel.length, 1);
  assert.equal(ed.history.position, 1, 'genau ein Undo-Schritt');
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2, 'Undo stellt beide Rechtecke wieder her');
});

await etest('Subtract: kreuzende Linie zieht Kapsel ab (zwei Teile)', async () => {
  const ed = sEditor();
  ed.doc.objs = [rectObj(0, 0, 40, 20)];
  await ed.finishShaper(linePts({ x: 20, y: -10 }, { x: 20, y: 30 }));
  assert.equal(ed.doc.objs.length, 1, 'Objektzahl gleich');
  const shape = ed.doc.objs[0].shape;
  assert.ok(shape.kind === 'path' && shape.subs.length === 2, `Kapsel teilt das Rechteck, Subs: ${shape.kind === 'path' ? shape.subs.length : '?'}`);
  assert.equal(ed.history.position, 1, 'genau ein Undo-Schritt');
});

await etest('Erkennung: Kreisgeste legt Ellipse an', async () => {
  const ed = sEditor();
  await ed.finishShaper(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'ellipse', `erwartet ellipse, bekommen ${ed.doc.objs[0].shape.kind}`);
  assert.ok(ed.hint.includes('Ellipse'), `Hinweis nennt die Form: ${ed.hint}`);
  assert.equal(ed.history.position, 1);
});

await etest('Fallback: Kritzel ohne Form wird Freihandpfad', async () => {
  const ed = sEditor();
  const pts: Pt[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < 120; i++) {
    x += Math.sin(i * 7.3) * 9 + Math.sin(i * 1.7) * 4;
    y += Math.cos(i * 5.1) * 9 + Math.cos(i * 2.3) * 4;
    pts.push({ x, y });
  }
  await ed.finishShaper(pts);
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'path', 'Fallback ist ein Pfad');
  assert.equal(ed.history.position, 1);
});

await etest('Erkennung aus: Kreisgeste wird Freihandpfad', async () => {
  const ed = sEditor();
  ed.shaperRecognize = false;
  await ed.finishShaper(stroke(100, (t) => ({ x: 50 + Math.cos(t * Math.PI * 2) * 50, y: 50 + Math.sin(t * Math.PI * 2) * 50 })));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'path', 'ohne Erkennung kein Grundform-Objekt');
});

await etest('BoolKeep: Originale bleiben bei Union erhalten', async () => {
  const ed = sEditor();
  ed.boolKeep = true;
  ed.doc.objs = [rectObj(0, 0, 20, 10), rectObj(30, 0, 20, 10)];
  await ed.finishShaper(linePts({ x: -5, y: 5 }, { x: 55, y: 5 }));
  assert.equal(ed.doc.objs.length, 3, 'beide Originale plus Ergebnis');
  assert.equal(ed.sel.length, 1);
});

await etest('Tap legt nichts an und verbraucht kein Undo', async () => {
  const ed = sEditor();
  await ed.finishShaper([{ x: 10, y: 10 }, { x: 10, y: 10 }]);
  assert.equal(ed.doc.objs.length, 0);
  assert.equal(ed.history.position, 0);
});

if (failed) {
  console.log(`${failed} Shaper-Editor-Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log(`Shaper-Editor: alle Tests bestanden (insgesamt ${count}).`);
