// Tests für das interaktive Kanten-Werkzeug (Geometrie, Sätze, Löschen, Ändern).
// Aufruf: npm run test:edge-fillet
import { strict as assert } from 'node:assert';
import { cornerSub, revertCornerSet, sharedVertex, virtualVertex } from '../src/corners';
import { piecesOf } from '../src/pathtools';
import { Editor } from '../src/editor';
import { newDoc } from '../src/model';
import type { CornerSet, Obj } from '../src/model';
import type { EdgePick } from '../src/joints';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const sq = () => ({ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });

function stubEditor(sel: Obj[]): Editor {
  const ed = Object.create(Editor.prototype) as Editor;
  const doc = newDoc() as unknown as { objs: Obj[] };
  doc.objs.push(...sel);
  Object.assign(ed, {
    doc, sel, filletMode: 'round' as const, filletR: 3,
    filletPicks: [], filletTarget: null, filletOffer: null, filletEditId: null, filletListObj: null, filletPreview: null,
    snapshot() {}, touch() {}, emit() {}, redraw() {}, dropSnapshot() {}, saveToolOptions() {},
  });
  return ed;
}

const mkPath = (nodes: { x: number; y: number }[], closed = true): Obj =>
  ({ id: Math.floor(Math.random() * 1e9), m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'path', subs: [{ closed, nodes }] } }) as unknown as Obj;

test('sharedVertex: benachbart, Umlauf, offen, ungleich', () => {
  const sp = sq();
  assert.equal(sharedVertex(sp, 0, 1), 1);
  assert.equal(sharedVertex(sp, 1, 0), 1);
  assert.equal(sharedVertex(sp, 3, 0), 0);
  assert.equal(sharedVertex(sp, 0, 3), 0);
  assert.equal(sharedVertex(sp, 0, 2), null);
  assert.equal(sharedVertex(sp, 1, 1), null);
  const open = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
  assert.equal(sharedVertex(open, 0, 1), 1);
  assert.equal(sharedVertex(open, 9, 0), null);
});

test('virtualVertex: Schnittpunkt mit Parametern, parallel, Kurve', () => {
  const p1 = { a: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, b: { x: 10, y: 0 }, curve: false };
  const p2 = { a: { x: 10, y: 10 }, c1: { x: 10, y: 10 }, c2: { x: 10, y: 0 }, b: { x: 10, y: 0 }, curve: false };
  const v = virtualVertex(p1, p2);
  assert.ok(v && Math.abs(v.x.x - 10) < 1e-9 && Math.abs(v.x.y) < 1e-9 && Math.abs(v.t1 - 1) < 1e-9 && Math.abs(v.t2 - 1) < 1e-9);
  const par = { a: { x: 0, y: 5 }, c1: { x: 0, y: 5 }, c2: { x: 10, y: 5 }, b: { x: 10, y: 5 }, curve: false };
  assert.equal(virtualVertex(p1, par), null);
  assert.equal(virtualVertex({ ...p1, curve: true }, p2), null);
});

test('cornerSub: Endpunkte je Ecke werden gemeldet', () => {
  const res = cornerSub(sq(), [1], 'round', 3);
  assert.equal(res.done, 1);
  const e = res.ends.get(1);
  assert.ok(e);
  assert.ok(Math.abs(e!.p1.x - 7) < 1e-9 && Math.abs(e!.p2.y - 3) < 1e-9);
});

test('Satz runden am Pfad: anwenden, löschen stellt exakt wieder her', () => {
  const o = mkPath(sq().nodes);
  const before = JSON.parse(JSON.stringify((o.shape as { subs: unknown }).subs));
  const ed = stubEditor([o]);
  ed.filletTarget = { kind: 'vertex', obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, idx: 1 };
  assert.ok(ed.confirmFillet());
  const subs = (o.shape as { subs: { nodes: unknown[] }[] }).subs;
  assert.ok(subs[0].nodes.length > 4);
  const sets = (o.shape as { cornerSets?: CornerSet[] }).cornerSets ?? [];
  assert.equal(sets.length, 1);
  assert.equal(ed.deleteFilletSet(sets[0].id), true);
  assert.deepEqual((o.shape as { subs: unknown }).subs, before);
  assert.deepEqual((o.shape as { cornerSets?: CornerSet[] }).cornerSets ?? [], []);
});

test('Überlappende Sätze: älterer erst nach jüngerem löschbar', () => {
  const o = mkPath(sq().nodes);
  const ed = stubEditor([o]);
  ed.filletMode = 'round'; ed.filletR = 2;
  ed.filletTarget = { kind: 'vertex', obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, idx: 1 };
  assert.ok(ed.confirmFillet());
  // Vertex 2 (10,10) hat sich verschoben — Index neu auflösen
  const sub1 = (o.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0];
  const idx2 = sub1.nodes.findIndex((n) => Math.hypot(n.x - 10, n.y - 10) < 1e-9);
  assert.ok(idx2 >= 0);
  ed.filletTarget = { kind: 'vertex', obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, idx: idx2 };
  assert.ok(ed.confirmFillet());
  const sets = (o.shape as { cornerSets: CornerSet[] }).cornerSets;
  assert.equal(sets.length, 2);
  assert.equal(ed.deleteFilletSet(sets[0].id), false);
  assert.equal(ed.deleteFilletSet(sets[1].id), true);
  assert.equal(ed.deleteFilletSet(sets[0].id), true);
});

test('Rechteck rund: parametrisch, löschen stellt Einzelwert wieder her', () => {
  const o = { id: 11, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 10, r: 0 } } as unknown as Obj;
  const ed = stubEditor([o]);
  ed.filletMode = 'round'; ed.filletR = 3;
  ed.filletTarget = { kind: 'rect', obj: o, m: [1, 0, 0, 1, 0, 0], corner: 1, scale: 1 };
  assert.ok(ed.confirmFillet());
  assert.equal(o.shape.kind, 'rect');
  if (o.shape.kind === 'rect') assert.deepEqual([...(o.shape.corners ?? [])], [0, 3, 0, 0]);
  const sets = (o.shape as { cornerSets: CornerSet[] }).cornerSets;
  assert.equal(sets.length, 1);
  assert.equal(sets[0].rectCorner, 1);
  assert.equal(ed.deleteFilletSet(sets[0].id), true);
  if (o.shape.kind === 'rect') assert.deepEqual([...(o.shape.corners ?? [0, 0, 0, 0])], [0, 0, 0, 0]);
});

test('Rechteck-Fase: Pfad-Umbau, löschen stellt Pfad wieder her', () => {
  const o = { id: 12, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 10, r: 0 } } as unknown as Obj;
  const ed = stubEditor([o]);
  ed.filletMode = 'chamfer'; ed.filletR = 3;
  ed.filletTarget = { kind: 'rect', obj: o, m: [1, 0, 0, 1, 0, 0], corner: 0, scale: 1 };
  assert.ok(ed.confirmFillet());
  assert.equal(o.shape.kind, 'path');
  const sets = (o.shape as unknown as { cornerSets: CornerSet[] }).cornerSets;
  assert.equal(sets.length, 1);
  assert.equal(sets[0].rectCorner, undefined);
  assert.equal(ed.deleteFilletSet(sets[0].id), true);
  assert.deepEqual((o.shape as unknown as { cornerSets?: CornerSet[] }).cornerSets ?? [], []);
});

test('Offene Kontur: Verlängerung schließen, verrunden, löschen öffnet wieder', () => {
  const o = mkPath([{ x: 2, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 8, y: 0 }], false);
  const before = JSON.parse(JSON.stringify((o.shape as { subs: unknown }).subs));
  const ed = stubEditor([o]);
  const a: EdgePick = { obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, seg: 0 };
  const b: EdgePick = { obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, seg: 2 };
  ed.filletPicks = [a, b];
  ed.analyzeFilletPair();
  assert.ok(ed.filletOffer !== null);
  assert.ok(ed.filletOffer && Math.abs(ed.filletOffer.x.x - 5) < 1e-9 && Math.abs(ed.filletOffer.x.y + 15) < 1e-9);
  ed.acceptFilletOffer();
  ed.filletMode = 'round'; ed.filletR = 2;
  ed.refreshFilletPreview();
  assert.ok(ed.confirmFillet());
  const s1 = o.shape as { kind: string; subs: { closed: boolean }[]; cornerSets: CornerSet[] };
  assert.equal(s1.kind, 'path');
  assert.equal(s1.subs[0].closed, true);
  assert.equal(s1.cornerSets[0].extended, true);
  assert.equal(ed.deleteFilletSet(s1.cornerSets[0].id), true);
  const s2 = o.shape as { subs: unknown; cornerSets?: unknown[] };
  assert.deepEqual(s2.subs, before);
  assert.deepEqual(s2.cornerSets ?? [], []);
});

test('Parallele Enden: kein Angebot, zweite Kante verworfen', () => {
  const o = mkPath([{ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false);
  const ed = stubEditor([o]);
  ed.filletPicks = [
    { obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, seg: 0 },
    { obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, seg: 2 },
  ];
  ed.analyzeFilletPair();
  assert.equal(ed.filletOffer, null);
  assert.equal(ed.filletPicks.length, 1);
});

test('Ändern: Wert übernehmen, Kanten neu wählen, ersetzen', () => {
  const o = mkPath(sq().nodes);
  const ed = stubEditor([o]);
  ed.filletMode = 'round'; ed.filletR = 2;
  ed.filletTarget = { kind: 'vertex', obj: o, m: [1, 0, 0, 1, 0, 0], sub: 0, idx: 1 };
  assert.ok(ed.confirmFillet());
  const first = (o.shape as { cornerSets: CornerSet[] }).cornerSets[0];
  const nodesR2 = JSON.stringify((o.shape as { subs: { nodes: unknown }[] }).subs[0].nodes);
  assert.ok(ed.beginEditFilletSet(first.id));
  assert.equal(ed.filletMode, 'round');
  assert.equal(ed.filletR, 2);
  assert.equal(ed.filletEditId, first.id);
  // Nachbarkanten des Bogens neu wählen (Stückende bei p1, Stückanfang bei p2)
  const sub = (o.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0];
  const ps = piecesOf(sub);
  const k = ps.findIndex((q) => Math.hypot(q.a.x - first.p1.x, q.a.y - first.p1.y) < 1e-9 && Math.hypot(q.b.x - first.p2.x, q.b.y - first.p2.y) < 1e-9);
  assert.ok(k >= 0);
  const n = ps.length;
  const mk = (seg: number): EdgePick => ({ obj: o, m: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], sub: 0, seg });
  ed.filletPicks = [mk((k - 1 + n) % n), mk((k + 1) % n)];
  ed.analyzeFilletPair();
  assert.ok(ed.filletTarget !== null);
  ed.filletR = 4;
  assert.ok(ed.confirmFillet());
  const sets = (o.shape as { cornerSets: CornerSet[] }).cornerSets;
  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, first.id);
  assert.equal(sets[0].r, 4);
  const nodesR4 = JSON.stringify((o.shape as { subs: { nodes: unknown }[] }).subs[0].nodes);
  assert.ok(nodesR4 !== nodesR2);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
