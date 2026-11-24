// Overlap-Lock: kurzer Rechtsklick nach Chooser-Wahl ersetzt die Auswahl nicht.
// Echte Treffertests brauchen Path2D/Canvas; daher hitTest-Stubs (Präzedenz:
// interaction-test). resolveContextHit selektiert intern.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, newId } = await import('../src/model');
const { overlapCandidates, lockedOverlapHit, resolveContextHit } = await import('../src/editorContext');
type E = import('../src/editor').Editor;
type Obj = import('../src/model').Obj;
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
const rect = (x = 0, y = 0): Obj => ({ id: newId(), m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0 } });
function editor(): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', listeners: new Set(), history: new History(),
    batching: false, hint: '', overlapLock: null });
  ed.setSel = function (objs: Obj[]) { this.sel = [...objs]; };
  ed.emit = () => {};
  return ed;
}
const stubHit = (ed: E, hit: Obj | null) =>
  ((ed as unknown as { hitTest: () => Obj | null }).hitTest = () => hit);

await test('ohne Sperre ersetzt kurzer Rechtsklick durch Treffer (oberstes)', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  stubHit(ed, top);
  resolveContextHit(ed, { x: 5, y: 5 }, overlapCandidates);
  assert.deepEqual(ed.sel, [top]);
  assert.equal(ed.overlapLock, null);
});

await test('Sperre hält: Lock-Objekt bleibt gewählt, kein hitTest', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  ed.overlapLock = bottom; // Chooser-Pick setzt die Sperre
  stubHit(ed, null); // dürfte nie aufgerufen werden (Kandidaten-Seam reicht)
  let calls = 0;
  const cands = () => { calls++; return [bottom, top]; };
  resolveContextHit(ed, { x: 5, y: 5 }, cands);
  assert.deepEqual(ed.sel, [bottom]);
  assert.equal(calls, 1);
  assert.equal(ed.overlapLock, bottom);
});

await test('Sperre löst anderswo: Clear + normales Trefferverhalten', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  ed.overlapLock = bottom;
  stubHit(ed, top);
  resolveContextHit(ed, { x: 100, y: 100 }, () => []);
  assert.deepEqual(ed.sel, [top]);
  assert.equal(ed.overlapLock, null);
});

await test('stale Sperre (Objekt nicht mehr gewählt) greift nicht', () => {
  const ed = editor();
  const top = rect(), bottom = rect(), other = rect();
  ed.doc.objs = [bottom, top, other];
  ed.setSel([other]);
  ed.overlapLock = bottom;
  stubHit(ed, top);
  const cands = () => [bottom, top];
  resolveContextHit(ed, { x: 5, y: 5 }, cands);
  assert.deepEqual(ed.sel, [top]);
  assert.equal(ed.overlapLock, null);
});

console.log(`Overlap-Lock: ${count} checks passed.`);

await test('lockedOverlapHit meldet das gesperrte Objekt (Verschiebe-Griff)', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  ed.overlapLock = bottom;
  assert.equal(lockedOverlapHit(ed, { x: 5, y: 5 }, () => [bottom, top]), bottom);
});

await test('Links-Drücken greift das gesperrte statt des obersten Objekts', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  ed.overlapLock = bottom;
  stubHit(ed, top);
  // Ausdruck wie in pointer.ts (select-Fall): Sperre schlägt hitTest.
  const o = lockedOverlapHit(ed, { x: 5, y: 5 }, () => [bottom, top]) ?? ed.hitTest({ x: 5, y: 5 });
  assert.equal(o, bottom);
});

await test('lockedOverlapHit ist null ohne Sperre oder Treffer', () => {
  const ed = editor();
  const top = rect(), bottom = rect();
  ed.doc.objs = [bottom, top];
  ed.setSel([bottom]);
  assert.equal(lockedOverlapHit(ed, { x: 5, y: 5 }, () => [bottom, top]), null);
  ed.overlapLock = bottom;
  assert.equal(lockedOverlapHit(ed, { x: 100, y: 100 }, () => []), null);
});

console.log(`Overlap-Lock: ${count} checks passed.`);
