// Offenes Skizzenprofil auf Füll-Layer: offenes Profil darf nicht gefüllt,
// geschlossenes schon (echte Editor.render-Pipeline, keine Identitäts-View).
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { IDENT, newDoc, defaultLayer, type Mat, type Obj } from '../src/model';
import { DEFAULT_GRID } from '../src/grid';
import { baselineTypography } from '../src/uiTypography';
import { emptySketch, addPt, addLine, sketchSubs } from '../src/sketch/model';

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
const g = globalThis as Record<string, unknown>;
g.Path2D ??= MockPath2D;
g.DOMMatrix ??= class { constructor(public values?: unknown) {} };

type CtxCall = { op: string; path?: MockPath2D };
function mockCtx(calls: CtxCall[]) {
  const noop = () => {};
  return {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: noop, restore: noop, clip: noop,
    setTransform: noop, transform: noop, translate: noop, scale: noop, rotate: noop,
    setLineDash: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, rect: noop, arc: noop,
    fillRect: noop, strokeRect: noop, fillText: noop,
    measureText: () => ({ width: 10 }),
    fill: (path?: MockPath2D) => { calls.push({ op: 'fill', path }); },
    stroke: (path?: MockPath2D) => { calls.push({ op: 'stroke', path }); },
  } as unknown as CanvasRenderingContext2D;
}

function editorWith(obj: Obj) {
  const ed = Object.create(Editor.prototype) as Editor;
  const calls: CtxCall[] = [];
  Object.assign(ed, {
    doc: newDoc(), currentLayer: 0, sel: [], tool: 'select', draft: null, continuedFrom: null, drag: null,
    // Nicht-identische View (Review-Vorgabe für Render-Tests): Zoom, Offset und dpr sind gesetzt.
    view: { zoom: 2.5, ox: 73, oy: -31 },
    canvas: { width: 1600, height: 1200, style: {} }, ctx: mockCtx(calls), dpr: 2,
    typo: baselineTypography(), grid: { ...DEFAULT_GRID, show: false },
    filled: true, dark: false, centerMarks: 'off',
    cursor: { x: 40, y: 50 }, snapHit: null, alignGuides: [],
    nodeHover: null, segHover: null, sketchEdit: null, builderSession: null,
    isolation: null, overlapHover: null,
  });
  ed.doc.layers[0] = { ...defaultLayer(0), mode: 'fill' };
  ed.doc.objs = [obj];
  ed.emit = () => {};
  ed.redraw = () => {};
  return { ed, calls };
}

function sketchObj(subsOf: ReturnType<typeof sketchSubs>): Obj {
  return { id: 1, m: IDENT, layer: 0, shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: '{}' }, subs: subsOf } };
}

function openSketch(): Obj {
  const sk = emptySketch();
  const a = addPt(sk, 0, 0), b = addPt(sk, 40, 0), c = addPt(sk, 40, 30);
  addLine(sk, a.id, b.id);
  addLine(sk, b.id, c.id);
  const subs = sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].closed, false);
  return sketchObj(subs);
}

function closedSketch(): Obj {
  const sk = emptySketch();
  const p = [addPt(sk, 0, 0), addPt(sk, 40, 0), addPt(sk, 40, 30), addPt(sk, 0, 30)];
  p.forEach((q, i) => addLine(sk, q.id, p[(i + 1) % 4].id));
  const subs = sketchSubs(sk);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].closed, true);
  return sketchObj(subs);
}

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

test('offenes Skizzenprofil auf Füll-Layer wird nicht gefüllt, aber gestrokt', () => {
  const { ed, calls } = editorWith(openSketch());
  ed.render();
  const fills = calls.filter((c) => c.op === 'fill' && c.path instanceof MockPath2D);
  assert.ok(fills.length > 0, 'Füllaufrufe erreichen die Arbeitsfläche');
  assert.ok(fills.every((c) => c.path!.ops.length === 0),
    `offenes Profil im Füllpfad: ${JSON.stringify(fills.map((c) => c.path!.ops))}`);
  const strokes = calls.filter((c) => c.op === 'stroke' && c.path instanceof MockPath2D);
  assert.ok(strokes.some((c) => c.path!.ops.length > 0), 'offenes Profil wird weiterhin gestrokt');
});

test('geschlossenes Skizzenprofil auf Füll-Layer wird weiterhin gefüllt', () => {
  const { ed, calls } = editorWith(closedSketch());
  ed.render();
  const fills = calls.filter((c) => c.op === 'fill' && c.path instanceof MockPath2D);
  assert.ok(fills.some((c) => c.path!.ops.length > 0), 'geschlossenes Profil erreicht den Füllpfad');
});

if (failed) process.exit(1);
