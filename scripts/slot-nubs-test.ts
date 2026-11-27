// Run: node scripts/run-ts.mjs scripts/slot-nubs-test.ts
// Material latching nubs (Rastnasen) on all three slot cutter paths.
import './core-fixtures-env';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { manufacturedSlotPaths } from '../src/slotManufacturing';
import { projectedSlot, straightGeometry } from '../src/straightSlots';
import { guidedSlot, nearestSlotAnchor } from '../src/contourSlots';
import { nubLayout, sameNubs, validNubValues } from '../src/slotNubs';
import { flattenSub, execute, SCALE } from '../src/clip';
import { IDENT } from '../src/model';
import type { Pt, SubPath } from '../src/model';
import type { ProjectionFrame, SlotProjection } from '../src/straightSlots';
import type { PlacedSlot, SlotGroup, SlotNubs } from '../src/slotPlacement';
const { slotOutline, cutSlots, resolvedSlots, effectiveSlot, adoptSlotFeatureRecipe, readSlotRecipe, nubsOf } = await import('../src/slotPlacement');

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('PASS', name); };
const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const local = (f: ProjectionFrame, p: Pt): Pt => ({ x: (p.x - f.a.x) * f.edge.tangent.x + (p.y - f.a.y) * f.edge.tangent.y,
  y: (p.x - f.a.x) * f.edge.normal.x + (p.y - f.a.y) * f.edge.normal.y });
const localPaths = (f: ProjectionFrame, paths: SubPath[]) => paths.map(sp => ({ ...sp, nodes: sp.nodes.map(p => local(f, p)) }));
const area = (paths: SubPath[]) => Math.abs(paths.reduce((sum, sp) => sum + sp.nodes.reduce((a, p, i) => {
  const q = sp.nodes[(i + 1) % sp.nodes.length]; return a + (p.x * q.y - p.y * q.x) / 2;
}, 0), 0));
const contains = (paths: SubPath[], p: Pt) => paths.some(sp => ClipperLib.Clipper.PointInPolygon(
  { X: Math.round(p.x * 1000), Y: Math.round(p.y * 1000) }, flattenSub(sp, IDENT)) !== 0);
const stripArea = (paths: SubPath[], x0: number, x1: number) => {
  const strip = [{ X: Math.round(x0 * 1000), Y: -1000000 }, { X: Math.round(x1 * 1000), Y: -1000000 },
    { X: Math.round(x1 * 1000), Y: 1000000 }, { X: Math.round(x0 * 1000), Y: 1000000 }];
  const cut = execute(ClipperLib.ClipType.ctIntersection, paths.map(sp => flattenSub(sp, IDENT)), [strip], ClipperLib.PolyFillType.pftNonZero);
  return Math.abs(cut.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0)) / (SCALE * SCALE);
};

const NUBS: SlotNubs = { height: 0.15, width: 1.2, count: 2, inset: 3 };
const rect: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] };
const edge = straightGeometry([rect], 45).edges.find(e => e.length >= 40)!;
const frameProjection: SlotProjection = { edge: edge.key, origin: { kind: 'vertex', sub: 0, node: 0 },
  target: 'center', distance: 30, direction: 1, cornerAngle: 45 };
const frame = projectedSlot([rect], frameProjection, 3.8, 10, edge.a);

test('nubLayout centers, 45° flanks, insets and graceful degradation', () => {
  assert.equal(nubLayout(10, undefined, 1), null);
  assert.equal(nubLayout(10, { ...NUBS, height: 0 }, 1), null);
  assert.equal(nubLayout(10, { ...NUBS, count: 0 }, 1), null);
  const l = nubLayout(10, NUBS, 3.8 / 4)!;
  assert.ok(l);
  assert.deepEqual(l.centers, [4, 6]);
  near(l.base, 1.2); near(l.depth, 0.15); near(l.base / 2 - l.inner, l.depth);
  // Nub edges keep at least the inset clear of mouth and bottom (plus pitch margin).
  assert.ok(l.centers[0] - l.base / 2 >= 3);
  assert.ok(10 - (l.centers[1] + l.base / 2) >= 3);
  // Too many nubs for a short wall: count is reduced, never overlapping.
  const capped = nubLayout(10, { ...NUBS, count: 16 }, 3.8 / 4)!;
  assert.ok(capped.centers.length < 16 && capped.centers.length >= 1);
  for (let i = 1; i < capped.centers.length; i++)
    assert.ok(capped.centers[i] - capped.centers[i - 1] - capped.base > 0.01);
  // No room at all: no nubs instead of invalid geometry.
  assert.equal(nubLayout(2, NUBS, 1), null);
  assert.equal(nubLayout(10, { ...NUBS, inset: 6 }, 1), null);
  // Protrusion is clamped to a quarter of the inner wall distance.
  const clamped = nubLayout(10, { ...NUBS, height: 0.5 }, 0.1)!;
  near(clamped.depth, 0.1);
  assert.ok(validNubValues(NUBS) && !validNubValues({ ...NUBS, height: -0.1 }));
  assert.ok(!validNubValues({ ...NUBS, width: 0.05 }) && !validNubValues({ ...NUBS, count: 17 }));
  assert.ok(!validNubValues({ ...NUBS, count: 2.5 }) && !validNubValues({ ...NUBS, inset: NaN }));
  assert.ok(sameNubs(undefined, { ...NUBS, height: 0 }) && !sameNubs(NUBS, { ...NUBS, height: 0.2 }));
  assert.ok(sameNubs(NUBS, { ...NUBS }) && !sameNubs(NUBS, { ...NUBS, count: 3 }));
});

test('disabled nubs leave every cutter byte-identical', () => {
  const plain = manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner' });
  assert.deepEqual(plain, [frame.outline]);
  assert.deepEqual(manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner', nubs: { ...NUBS, height: 0 } }), plain);
  assert.deepEqual(manufacturedSlotPaths(frame, { burn: 0.06, cornerStyle: 'loop', nubs: { ...NUBS, count: 0 } }),
    manufacturedSlotPaths(frame, { burn: 0.06, cornerStyle: 'loop' }));
  const free: PlacedSlot = { x: 50, y: 40, angle: 0, width: 3.7, depth: 10, clearance: 0.1, factor: 1 };
  assert.deepEqual(slotOutline(free).nodes, [{ x: 48.1, y: 35 }, { x: 51.9, y: 35 }, { x: 51.9, y: 45 }, { x: 48.1, y: 45 }]);
  const anchor = nearestSlotAnchor([rect], { x: 40, y: 0 }, 1, 'curve')!;
  assert.equal(guidedSlot([rect], { x: 0, y: 0, angle: 0, width: 10, depth: 12, clearance: 0, factor: 1, anchor }).outline.nodes.length, 4);
});

test('projected cutter keeps symmetric nub material on both walls', () => {
  const plain = localPaths(frame, manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner' }));
  const nubbed = localPaths(frame, manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner', nubs: NUBS }));
  near(area(plain), 3.8 * (10 + Math.max(0.05, 3.8 * 0.02)), 1e-6);
  // Four trapezoids (two per wall) are removed from the cutter: less cut out.
  near(area(plain) - area(nubbed), 4 * ((1.2 + 0.9) / 2) * 0.15, 0.05);
  // Nub centers hold material: outside the nubbed cutter, inside the plain one.
  for (const [x, mirror] of [[0.075, 3.725]] as const) for (const y of [4, 6]) {
    assert.ok(!contains(nubbed, { x, y }), `left nub (${x},${y}) keeps material`);
    assert.ok(!contains(nubbed, { x: mirror, y }), `right nub (${mirror},${y}) keeps material`);
    assert.ok(contains(plain, { x, y }) && contains(plain, { x: mirror, y }));
  }
  // Slot center and inset margins stay cut on both variants.
  for (const p of [{ x: 1.9, y: 5 }, { x: 0.075, y: 1 }, { x: 3.725, y: 8.8 }])
    assert.ok(contains(nubbed, p) && contains(plain, p));
  // Left and right wall strips lose exactly the same area: symmetric pairs.
  near(stripArea(nubbed, 0, 1.9), stripArea(nubbed, 1.9, 3.8), 0.02);
  // Nubs combine with every corner relief and every burn.
  for (const cornerStyle of ['corner', 'loop', 'backarc', 'diagonal'] as const) for (const burn of [0, 0.06, 0.2]) {
    const withNubs = manufacturedSlotPaths(frame, { burn, cornerStyle, nubs: NUBS });
    const without = manufacturedSlotPaths(frame, { burn, cornerStyle });
    assert.ok(area(withNubs) < area(without), `${cornerStyle}/burn ${burn} keeps nub material`);
    if (cornerStyle === 'backarc') assert.equal(withNubs.length, burn > 0 ? 3 : 1);
  }
  // Invalid nubs reject instead of silently disabling.
  assert.throws(() => manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner', nubs: { ...NUBS, height: -0.1 } }));
  assert.throws(() => manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner', nubs: { ...NUBS, width: 0.05 } }));
  assert.throws(() => manufacturedSlotPaths(frame, { burn: 0, cornerStyle: 'corner', nubs: { ...NUBS, count: 17 } }));
});

test('a projected cutter supports sixteen nubs on each wall', () => {
  const deep = projectedSlot([rect], frameProjection, 4, 30, edge.a);
  for (const cornerStyle of ['corner', 'loop', 'backarc', 'diagonal'] as const) {
    const cutter = localPaths(deep, manufacturedSlotPaths(deep, { burn: 0.8, cornerStyle,
      nubs: { ...NUBS, count: 16, inset: 0 } }));
    for (const x of [0.95, 3.05]) {
      const tips = cutter.flatMap(path => path.nodes).filter(p => Math.abs(p.x - x) < 1e-8 && p.y > 0 && p.y < 29);
      assert.equal(tips.length, 32, cornerStyle);
    }
  }
});

test('projected relief leaves the last nub intact on both walls', () => {
  const shallow = projectedSlot([rect], frameProjection, 4, 10, edge.a);
  for (const cornerStyle of ['loop', 'diagonal'] as const) {
    const options = { burn: 0.8, cornerStyle };
    const plain = localPaths(shallow, manufacturedSlotPaths(shallow, options));
    const nubbed = localPaths(shallow, manufacturedSlotPaths(shallow, { ...options,
      nubs: { ...NUBS, count: 6, inset: 0 } }));
    const keptArea = (1.2 - 0.15) * 0.15;
    near(area(plain) - area(nubbed), 10 * keptArea, 0.015);
  }
});

test('ungrouped projected slots use their own nub settings', () => {
  const slot: PlacedSlot = { x: 0, y: 0, angle: 0, width: 3.8, depth: 10, clearance: 0, factor: 1,
    projection: frameProjection };
  const recipe = { source: { kind: 'path' as const, subs: [rect] }, base: [rect], slots: [slot] };
  near(area(cutSlots({ ...recipe, slots: [{ ...slot, nubs: NUBS }] })) - area(cutSlots(recipe)), 0.63, 0.015);
});

test('free rectangle keeps symmetric nub material on both long walls', () => {
  const free: PlacedSlot = { x: 50, y: 40, angle: 0, width: 3.7, depth: 10, clearance: 0.1, factor: 1 };
  const nubbed = slotOutline({ ...free, nubs: NUBS });
  assert.equal(nubbed.nodes.length, 4 + 4 * 2 * 2);
  near(area([nubbed]), 3.8 * 10 - 4 * ((1.2 + 0.9) / 2) * 0.15, 0.05);
  // Bays dent inward from both walls at the distributed centers (mouth at y = 35).
  const leftApex = nubbed.nodes.filter(p => Math.abs(p.x - (48.1 + 0.15)) < 0.01).map(p => p.y).sort((a, b) => a - b);
  const rightApex = nubbed.nodes.filter(p => Math.abs(p.x - (51.9 - 0.15)) < 0.01).map(p => p.y).sort((a, b) => a - b);
  assert.deepEqual(leftApex, [38.55, 39.45, 40.55, 41.45]);
  assert.deepEqual(rightApex, [38.55, 39.45, 40.55, 41.45]);
  // Rotation carries bays rigidly: same area, same node count.
  const rotated = slotOutline({ ...free, angle: 30, nubs: NUBS });
  assert.equal(rotated.nodes.length, nubbed.nodes.length);
  near(area([rotated]), area([nubbed]), 1e-6);
  const r = cutSlots({ source: { kind: 'path' as const, subs: [rect] }, base: [rect],
    slots: [{ ...free, id: 'a', nubs: NUBS }] });
  const rPlain = cutSlots({ source: { kind: 'path' as const, subs: [rect] }, base: [rect], slots: [{ ...free, id: 'a' }] });
  assert.ok(area(r) - area(rPlain) > 0.3, 'free-rect nubs keep material end to end');
});

test('contour cutter keeps symmetric nub material on both walls', () => {
  const anchor = nearestSlotAnchor([rect], { x: 40, y: 0 }, 1, 'curve')!;
  const values: PlacedSlot = { x: 0, y: 0, angle: 0, width: 10, depth: 12, clearance: 0, factor: 1, anchor };
  const plain = guidedSlot([rect], values);
  const nubbed = guidedSlot([rect], { ...values, nubs: NUBS });
  assert.equal(plain.outline.nodes.length, 4);
  assert.equal(nubbed.outline.nodes.length, 4 + 4 * 2 * 2);
  // Bottom corners survive; bays sit strictly between them.
  const has = (x: number, y: number) => nubbed.outline.nodes.some(p => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
  assert.ok(has(45, 12) && has(35, 12));
  // Bottom corners survive; bays sit strictly between them.
  const ys = nubbed.outline.nodes.map(p => p.y);
  assert.ok(Math.min(...ys) < 0 && Math.abs(Math.max(...ys) - 12) < 1e-6);
  const r = cutSlots({ source: { kind: 'path' as const, subs: [rect] }, base: [rect], slots: [{ ...values, id: 'a', nubs: NUBS }] });
  const rPlain = cutSlots({ source: { kind: 'path' as const, subs: [rect] }, base: [rect], slots: [{ ...values, id: 'a' }] });
  assert.ok(area(r) - area(rPlain) > 0.3, 'contour nubs keep material end to end');
});

test('clearing and retyping a group nub field preserves the other settings', () => {
  const group: SlotGroup = { id: 'g', name: 'g', width: 3.7, depth: 10, clearance: 0, factor: 1,
    burn: 0, cornerStyle: 'corner', nubs: { ...NUBS } };
  const recipe = { source: { kind: 'path' as const, subs: [rect] }, base: [rect], groups: [group],
    slots: [{ ...group, id: 's', groupId: group.id, x: 0, y: 0, angle: 0, nubs: undefined, projection: {
      edge: edge.key, origin: { kind: 'vertex' as const, sub: edge.sub, node: edge.start },
      target: 'center' as const, distance: 30, direction: 1 as const, cornerAngle: 45,
    } }] };
  group.nubs = { ...nubsOf(group, undefined), count: 5 };
  group.nubs = { ...nubsOf(group, undefined), inset: NaN };
  assert.throws(() => cutSlots(recipe));
  group.nubs = { ...nubsOf(group, undefined), inset: 1 };
  assert.deepEqual(group.nubs, { ...NUBS, count: 5, inset: 1 });
  const material = cutSlots(recipe);
  assert.equal(material.length, 1);
  assert.equal(material[0].nodes.length, 8 + 5 * 2 * 4);
});

test('projected slots keep nub material end to end, groups split by nubs', () => {
  const groups = [{ id: 'g', name: 'g', width: 3.7, depth: 10, clearance: 0.1, factor: 1, burn: 0, cornerStyle: 'corner' as const, nubs: NUBS }];
  const slot: PlacedSlot = { id: 'a', groupId: 'g', x: 0, y: 0, angle: 0, width: 3.7, depth: 10, clearance: 0.1, factor: 1,
    projection: { edge: edge.key, origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'center', distance: 30, direction: 1, cornerAngle: 45 } };
  const recipe = { source: { kind: 'path' as const, subs: [rect] }, base: [rect], settings: { cornerAngle: 45 }, groups, slots: [slot] };
  const withNubs = cutSlots(recipe), without = cutSlots({ ...recipe, groups: [{ ...groups[0], nubs: { ...NUBS, height: 0 } }] });
  assert.ok(area(withNubs) - area(without) > 0.3, 'projection nubs keep material end to end');
  // Slot override wins over the group; mirrors inherit the effective nubs.
  const eff = effectiveSlot({ ...recipe, groups }, { ...slot, nubs: { ...NUBS, height: 0.2 } });
  near(eff.nubs!.height, 0.2);
  near(effectiveSlot({ ...recipe, groups }, slot).nubs!.height, 0.15);
  const sq: SubPath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  const parent: PlacedSlot = { id: 'p', groupId: 'g', x: 0, y: 0, angle: 0, width: 3.7, depth: 10, clearance: 0.1, factor: 1,
    projection: { edge: '0:0:0', origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'center', distance: 25, direction: 1, cornerAngle: 20 } };
  const mirrored = resolvedSlots({ source: { kind: 'path' as const, subs: [sq] }, base: [sq], settings: { cornerAngle: 20 },
    groups, slots: [parent, { id: 'm', x: 999, y: 999, angle: 0, width: 999, depth: 999, clearance: 999, factor: 999,
      mirror: { slotId: 'p', axis: { kind: 'helper', helperId: 'h' } } }],
    helpers: [{ id: 'h', first: { kind: 'vertex', sub: 0, node: 0 }, second: { kind: 'vertex', sub: 0, node: 1 }, edge: '0:0:0' }] });
  assert.deepEqual(mirrored.find(s => s.id === 'm')!.nubs, NUBS);
  // Legacy auto-grouping keeps nubbed and plain slots apart.
  const base = { source: { kind: 'path' as const, subs: [rect] }, base: [rect], slots: [
    { ...slot, id: 'p', groupId: undefined, projection: undefined, nubs: undefined },
    { ...slot, id: 'q', groupId: undefined, projection: undefined, nubs: NUBS },
  ] };
  assert.equal(adoptSlotFeatureRecipe(base).groups!.length, 2);
  assert.equal(adoptSlotFeatureRecipe({ ...base, slots: base.slots.map(s => ({ ...s, nubs: NUBS })) }).groups!.length, 1);
  // Invalid recipe nubs reject; disabled nubs behave like absent nubs.
  assert.throws(() => readSlotRecipe({ recipe: JSON.stringify({ ...recipe, groups: [{ ...groups[0], nubs: { ...NUBS, count: 17 } }] }) }));
  assert.throws(() => readSlotRecipe({ recipe: JSON.stringify({ ...recipe, slots: [{ ...slot, nubs: { ...NUBS, inset: -1 } }] }) }));
  assert.deepEqual(cutSlots({ ...recipe, groups: [{ ...groups[0], nubs: undefined }] }), without);
});

test('legacy diagonal relief survives a one-micron burn', () => {
  const options = { burn: 0.001, cornerStyle: 'diagonal' as const };
  const legacy = manufacturedSlotPaths(frame, options);
  assert.ok(legacy[0].nodes.length > 4);
  assert.deepEqual(manufacturedSlotPaths(frame, { ...options, nubs: { ...NUBS, height: 0 } }), legacy);
});

test('concave mouths leave all requested nub material inside the board', () => {
  const concave: SubPath = { closed: true, nodes: [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 43, y: 7.5 }, { x: 57, y: 7.5 },
    { x: 60, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
  ] };
  const anchor = nearestSlotAnchor([concave], { x: 50, y: 7.5 }, 1, 'chord')!;
  const values = { x: 0, y: 0, angle: 0, width: 16, depth: 20, clearance: 0, factor: 1, anchor };
  const withNubs = { ...values, nubs: { height: 0.5, width: 1.2, count: 10, inset: 0 } };
  const recipe = { source: { kind: 'path' as const, subs: [concave] }, base: [concave] };
  const kept = area(cutSlots({ ...recipe, slots: [withNubs] })) - area(cutSlots({ ...recipe, slots: [values] }));
  assert.ok(Math.abs(kept - 7) < 0.01, `Expected 7 mm² of kept material, got ${kept}`);
});

console.log(`Slot nubs: ${n} checks passed.`);
