// Guided Shape Builder (Formerstellung dialog): previewAssistant/applyAssistant on real editor methods.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, newId } = await import('../src/model');
type Obj = import('../src/model').Obj;
type E = import('../src/editor').Editor;
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
const rect = (x = 30, y = 30, w = 20, h = 20): Obj => ({ id: newId(), m: [1, 0, 0, 1, x, y], layer: 0, shape: { kind: 'rect', w, h, r: 0 } });
function editor(objects: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: false, snapObjects: false, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.doc.objs = [...objects]; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, eps = 0.01) =>
  x >= x0 - eps && x <= x1 + eps && y >= y0 - eps && y <= y1 + eps;

await test('guided preview union merges overlapping rects, nothing excluded', async () => {
  const ed = editor([rect(), rect(40)]);
  const p = await ed.previewAssistant('union');
  assert.ok(p); assert.ok(p.subs.length > 0); assert.ok(p.subs.every((s) => s.closed));
  assert.equal(p.excluded.length, 0);
});

await test('guided preview subtract cuts second rect, excluded shows cutter', async () => {
  const ed = editor([rect(), rect(40)]);
  const p = await ed.previewAssistant('subtractAB');
  assert.ok(p); assert.ok(p.subs.length > 0);
  assert.ok(p.excluded.length > 0);
  for (const s of p.subs) for (const n of s.nodes) assert.ok(inBox(n.x, n.y, 30, 30, 40, 50), 'cut area removed');
});

await test('guided preview subtractBA cuts first rect, excluded shows A', async () => {
  const ed = editor([rect(), rect(40)]);
  const p = await ed.previewAssistant('subtractBA');
  assert.ok(p); assert.ok(p.subs.length > 0);
  assert.ok(p.excluded.length > 0);
  for (const s of p.subs) for (const n of s.nodes) assert.ok(inBox(n.x, n.y, 50, 30, 60, 50), 'keeps B minus A');
});

await test('guided preview intersect keeps only the shared area', async () => {
  const ed = editor([rect(), rect(40)]);
  const p = await ed.previewAssistant('intersect');
  assert.ok(p); assert.ok(p.subs.length > 0);
  assert.ok(p.excluded.length > 0);
  for (const s of p.subs) for (const n of s.nodes) assert.ok(inBox(n.x, n.y, 40, 30, 50, 50), 'inside overlap');
});

await test('guided preview rejects single shape and empty selection', async () => {
  assert.equal(await editor([rect()]).previewAssistant('union'), null);
  assert.equal(await editor([]).previewAssistant('union'), null);
});

await test('guided apply union keeps originals as noLaser and undoes in one step', async () => {
  const a = rect(), b = rect(40), ed = editor([a, b]);
  assert.ok(await ed.applyAssistant('union', { keepOriginals: true, noLaserOriginals: true }));
  assert.equal(ed.doc.objs.length, 3);
  assert.equal(a.noLaser, true); assert.equal(b.noLaser, true);
  const res = ed.doc.objs[2];
  assert.equal(res.shape.kind, 'path'); assert.deepEqual(ed.sel, [res]);
  assert.equal(ed.history.position, 1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2);
  assert.ok(ed.doc.objs.every((o) => !o.noLaser));
});

await test('guided apply subtract without keep deletes originals in one step', async () => {
  const ed = editor([rect(), rect(40)]);
  assert.ok(await ed.applyAssistant('subtractAB', { keepOriginals: false, noLaserOriginals: false }));
  assert.equal(ed.doc.objs.length, 1);
  assert.equal(ed.doc.objs[0].shape.kind, 'path');
  assert.equal(ed.history.position, 1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2);
});

await test('guided apply subtractBA keeps B minus A and undoes in one step', async () => {
  const a = rect(), b = rect(40), ed = editor([a, b]);
  assert.ok(await ed.applyAssistant('subtractBA', { keepOriginals: false, noLaserOriginals: false }));
  assert.equal(ed.doc.objs.length, 1);
  const res = ed.doc.objs[0];
  assert.equal(res.shape.kind, 'path');
  for (const s of (res.shape as { subs: import('../src/model').SubPath[] }).subs)
    for (const n of s.nodes) assert.ok(inBox(n.x, n.y, 50, 30, 60, 50), 'keeps B minus A');
  assert.equal(ed.history.position, 1);
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2);
});

await test('guided op buttons have square boolean icons', async () => {
  const { ICONS } = await import('../src/icons');
  for (const name of ['boolUnion', 'boolIntersect', 'boolSubAB', 'boolSubBA']) {
    assert.ok(ICONS[name]?.includes('<svg'), `missing icon ${name}`);
    assert.ok(ICONS[name]?.includes('<rect'), `icon ${name} should show squares`);
  }
});

await test('guided apply keep without noLaser leaves originals laserable', async () => {
  const a = rect(), b = rect(40), ed = editor([a, b]);
  assert.ok(await ed.applyAssistant('union', { keepOriginals: true, noLaserOriginals: false }));
  assert.equal(ed.doc.objs.length, 3);
  assert.ok(ed.doc.objs.every((o) => !o.noLaser));
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2);
});

await test('guided apply intersect on disjoint shapes keeps document, no undo step', async () => {
  const a = rect(), b = rect(100, 100), ed = editor([a, b]);
  assert.ok(await ed.applyAssistant('intersect', { keepOriginals: true, noLaserOriginals: true }));
  assert.equal(ed.doc.objs.length, 2);
  assert.equal(ed.history.position, 0);
  assert.deepEqual(ed.sel, [a, b]);
});

console.log(`Guided Shape Builder: ${count} checks passed without hardware/app startup.`);
