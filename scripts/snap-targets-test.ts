// Fangziele: Maske filtert Objektfang (Knoten/Mitte/Zentrum/Quadrant/Schnitt/Linie),
// Persistenz mit Legacy-Fallback, Reset und Guards gegen leere Auswahl.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc } from '../src/model';
import { findSnap, SNAP_TARGET_ORDER, SnapSet } from '../src/snap';
import { defaultSnapTargets, loadSnapTargets, validSnapTargets } from '../src/editor/snapping';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }

function editor(): Editor {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', nodeSets: new Map(), segmentSets: new Map(),
    handleSets: new Map(), nodeSel: new Set(), nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null,
    vectorPreview: null, drag: null, draft: null, history: new History(), batching: false,
    view: { zoom: 1, ox: 0, oy: 0 }, listeners: new Set(), isolation: null, builderSession: null,
    snapGrid: false, snapObjects: true, alignGuides: [], space: false, currentLayer: 0, snapHit: null,
    snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    tabs: [], tabIndex: 0, grid: { show: true, spacing: 10, divisions: 1, every: 0, opacity: 100 },
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.saveNow = () => {}; ed.syncTextLinks = () => {};
  ed.snapshot = () => {}; ed.emit = () => {};
  return ed;
}

function pointSet(): SnapSet {
  const set = new SnapSet();
  set.addPoint(10, 10, 'node');
  set.addPoint(20, 20, 'mid');
  return set;
}

await test('alle sechs Ziele sind Standard und valide', () => {
  assert.deepEqual([...SNAP_TARGET_ORDER], ['node', 'mid', 'center', 'quad', 'cross', 'line']);
  assert.deepEqual(defaultSnapTargets(), ['node', 'mid', 'center', 'quad', 'cross', 'line']);
  assert.equal(validSnapTargets(defaultSnapTargets()), true);
  assert.equal(validSnapTargets([]), false);
  assert.equal(validSnapTargets(['node', 'node']), false);
  assert.equal(validSnapTargets(['node', 'fiktiv']), false);
  assert.equal(validSnapTargets('node'), false);
});

await test('ohne Maske fängt der Objektfang wie bisher', () => {
  const hit = findSnap(pointSet(), { x: 10.2, y: 10.1 }, 8);
  assert.equal(hit?.kind, 'node');
});

await test('Maske blendet einzelne Zielarten aus', () => {
  const set = pointSet();
  assert.equal(findSnap(set, { x: 10.2, y: 10.1 }, 8, undefined, new Set(['mid']))?.kind, undefined);
  assert.equal(findSnap(set, { x: 10.2, y: 10.1 }, 8, undefined, new Set(['node']))?.kind, 'node');
  assert.equal(findSnap(set, { x: 20.1, y: 20.2 }, 8, undefined, new Set(['node', 'mid']))?.kind, 'mid');
});

await test('Linienfang folgt der Maske', () => {
  const set = new SnapSet();
  set.addPiece(0, 0, 100, 0);
  const near = { x: 50, y: 2 };
  assert.equal(findSnap(set, near, 8)?.kind, 'line');
  assert.equal(findSnap(set, near, 8, undefined, new Set(['node', 'mid', 'center', 'quad', 'cross']))?.kind, undefined);
  assert.equal(findSnap(set, near, 8, undefined, new Set(['line']))?.kind, 'line');
});

await test('Schnittpunkte folgen der Maske', () => {
  const set = new SnapSet();
  set.addPiece(0, 0, 100, 100);
  set.addPiece(0, 100, 100, 0);
  const mid = { x: 50.2, y: 49.8 };
  assert.equal(findSnap(set, mid, 8)?.kind, 'cross');
  assert.equal(findSnap(set, mid, 8, undefined, new Set(['node']))?.kind, undefined);
});

await test('Fixtures ohne Feld bekommen alle Ziele', () => {
  const ed = editor();
  assert.deepEqual([...ed.snapTargetSet()], [...SNAP_TARGET_ORDER]);
});

await test('setSnap speichert Ziele, Reset stellt alle wieder her', () => {
  const ed = editor();
  ed.setSnap({ targets: ['node', 'line'] });
  assert.deepEqual([...ed.snapTargetSet()], ['node', 'line']);
  assert.throws(() => ed.setSnap({ targets: [] as never }), /gespeichert/);
  assert.deepEqual([...ed.snapTargetSet()], ['node', 'line']);
  ed.resetSnapTargets();
  assert.deepEqual([...ed.snapTargetSet()], [...SNAP_TARGET_ORDER]);
});

await test('gespeicherte Ziele überleben Reload, Legacy bleibt vollständig', () => {
  const g = globalThis as Record<string, unknown>;
  const real = g.localStorage;
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    const ed = editor();
    ed.setSnap({ targets: ['center', 'cross'] });
    ed.snapTargets = undefined as never;
    ed.loadSnapSettings();
    assert.deepEqual([...ed.snapTargetSet()], ['center', 'cross']);
    store.delete('kizamubeam.snapTargets');
    ed.snapTargets = undefined as never;
    ed.loadSnapSettings();
    assert.deepEqual([...ed.snapTargetSet()], [...SNAP_TARGET_ORDER]);
    assert.deepEqual(loadSnapTargets(), [...SNAP_TARGET_ORDER]);
  } finally {
    g.localStorage = real;
  }
});

console.log(`DONE ${count} tests`);
