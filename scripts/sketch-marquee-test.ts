// Marquee- und Klick-Selektion in der Skizze (volle Typabdeckung), inkl. verwaister Zieh-Zustände.
// Aufruf: npm run test:sketch-marquee
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const M = await import('../src/sketch/model');
const E2 = await import('../src/editor');
const D2 = await import('../src/model');
const H2 = await import('../src/history');

const ed = Object.create(E2.Editor.prototype);
const doc = D2.newDoc();
const sk = M.emptySketch();
// Linie + Kreis + Bogen + Ellipse + Einzelpunkt + Hilfslinie + Maß + Fixierung
const a = M.addPt(sk, 30, 30), b = M.addPt(sk, 110, 30);
const line = M.addLine(sk, a.id, b.id);
const cc = M.addPt(sk, 160, 30);
const circle = M.addCircle(sk, cc.id, 12);
const ac = M.addPt(sk, 60, 90), as = M.addPt(sk, 80, 90), ae = M.addPt(sk, 60, 110);
const arc = M.addArc(sk, ac.id, as.id, ae.id);
const ec = M.addPt(sk, 140, 90), em = M.addPt(sk, 154, 90);
const ellipse = M.addEllipse(sk, ec.id, em.id, 5);
const sp = M.addPt(sk, 200, 30);
const point = M.addPoint(sk, sp.id);
const hp = M.addPt(sk, 0, 150), hq = M.addPt(sk, 220, 150);
M.addLine(sk, hp.id, hq.id, true);
M.addCon(sk, 'distance', [line.id], { v: 80 } as never);
M.addCon(sk, 'fixed', [a.id], { x: 30, y: 30 } as never);
const json = M.sketchJson(sk);
const obj = { id: D2.newId(), m: D2.IDENT, layer: 0, shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: json }, subs: [] } };
doc.objs = [obj];
Object.assign(ed, {
  doc, history: new H2.History(), currentLayer: 0, sel: [], tool: 'sketch',
  view: { zoom: 1, ox: 0, oy: 0 }, dpr: 1, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
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
ed.canvas = { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };

const step = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    console.log(`THROWS ${name}: ${(e as Error).message}\n${(e as Error).stack}`);
    process.exitCode = 1;
  }
};
const down = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, pointerId: 1 };
step('Klick Linie', () => { ed.sketchDown(70, 30, down); assert.ok(ed.sketchEdit.sel.has(line.id)); ed.sketchUp({ pointerId: 1, button: 0, clientX: 70, clientY: 30 }); });
step('Klick Kreis', () => { ed.sketchDown(160, 42, down); assert.ok(ed.sketchEdit.sel.has(circle.id)); ed.sketchUp({ pointerId: 1, button: 0, clientX: 160, clientY: 42 }); });
step('Klick Bogen', () => { ed.sketchDown(75, 95, down); assert.ok(ed.sketchEdit.sel.size > 0); ed.sketchUp({ pointerId: 1, button: 0, clientX: 75, clientY: 95 }); });
step('Klick Ellipse', () => { ed.sketchDown(147, 90, down); assert.ok(ed.sketchEdit.sel.size > 0); ed.sketchUp({ pointerId: 1, button: 0, clientX: 147, clientY: 90 }); });
step('Klick Einzelpunkt', () => { ed.sketchDown(200, 30, down); assert.ok(ed.sketchEdit.sel.size > 0); ed.sketchUp({ pointerId: 1, button: 0, clientX: 200, clientY: 30 }); });
step('Marquee über alles', () => {
  ed.sketchEdit.sel.clear();
  ed.sketchDown(25, 120, down);
  assert.ok(ed.sketchEdit.frame, 'Rahmen startet');
  ed.sketchMove(230, 10, { pointerId: 1 });
  ed.sketchUp({ pointerId: 1, button: 0, clientX: 230, clientY: 10 });
  assert.ok(ed.sketchEdit.sel.size >= 5, `alle Elemente drin, waren: ${ed.sketchEdit.sel.size}`);
});
if (!process.exitCode) console.log('RICH-REPRO OK');
