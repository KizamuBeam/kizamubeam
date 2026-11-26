import type { Pt } from '../model';
import { entPoints, type Sketch } from './model';
import { featureReferences } from './references';

/** Include connected construction geometry, but never drag along unselected output. */
export type SketchTransformBlock = { blocking: number[]; external?: number[]; unsupported?: boolean };

export function sketchTransformScope(sk: Sketch, selection: ReadonlySet<number>): { ids: Set<number>; driven: Set<number> } | SketchTransformBlock {
  const ids = new Set([...sk.pts, ...sk.ents].filter((item) => selection.has(item.id)).map((item) => item.id));
  if (!ids.size) return { blocking: [], external: [] };
  const ents = sk.ents;
  const cons = sk.cons;
  const links = [...ents.map((e) => [e.id, ...entPoints(e), ...featureReferences(e)]), ...cons.map((c) => [c.id, ...c.r])];
  const adjacency = new Map<number, number[][]>();
  for (const link of links) for (const id of link) {
    const list = adjacency.get(id);
    if (list) list.push(link);
    else adjacency.set(id, [link]);
  }
  const visited = new Set<number[]>();
  for (const id of ids) for (const link of adjacency.get(id) ?? []) if (!visited.has(link)) {
    visited.add(link);
    for (const linked of link) ids.add(linked);
  }
  const external = ents.filter((e) => !e.aux && ids.has(e.id) && !selection.has(e.id));
  if (!external.length) {
    return { ids, driven: new Set<number>() };
  }
  // Unselected output in the dependency closure would move silently: report it and change nothing.
  const outside = new Set(external.flatMap((e) => [e.id, ...entPoints(e), ...featureReferences(e)]));
  const blocking = cons.filter((c) => outside.has(c.id) || c.r.some((id) => outside.has(id)) && c.r.some((id) => !outside.has(id))).map((c) => c.id);
  return { blocking, external: external.map((e) => e.id) };
}

export function planSketchTranslation(sk: Sketch, selection: ReadonlySet<number>) {
  const scope = sketchTransformScope(sk, selection);
  return 'ids' in scope ? scope.ids : undefined;
}

export function translateSketchSelection(sk: Sketch, selection: ReadonlySet<number>, delta: Pt): void | false {
  const ids = planSketchTranslation(sk, selection);
  if (!ids || !Number.isFinite(delta.x) || !Number.isFinite(delta.y) || (!delta.x && !delta.y)) return false;
  const points = sk.pts.filter((p) => ids.has(p.id));
  const valid = (p: Pt) => Number.isFinite(p.x + delta.x) && Number.isFinite(p.y + delta.y)
    && (!delta.x || p.x + delta.x !== p.x) && (!delta.y || p.y + delta.y !== p.y);
  const fixed = sk.cons.filter((c) => c.t === 'fixed' && ids.has(c.r[0])).map((c) => {
    const p = points.find((p) => p.id === c.r[0]);
    return { c, x: c.x ?? p?.x ?? NaN, y: c.y ?? p?.y ?? NaN };
  });
  if (!points.every(valid) || !fixed.every(valid)) return false;
  for (const p of points) { p.x += delta.x; p.y += delta.y; }
  for (const { c, x, y } of fixed) { c.x = x + delta.x; c.y = y + delta.y; }
}
