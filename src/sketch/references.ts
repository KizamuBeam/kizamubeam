import type { Sketch, SkEnt } from './model';

/** Geometry and conditions used by a feature's branch/validity guards. */
export function featureReferences(e: SkEnt): number[] {
  const { cornerBounds: corner, polygon, arcStations: stations, smoothOffset: offset, patternRadius } = e;
  return [
    ...(e.t === 'line' ? e.slotCaps ?? [] : []),
    ...(corner ? [corner.dimension, ...corner.rays.flat(), ...(corner.arc ? [corner.arc.source, corner.arc.corner, corner.arc.cut, corner.arc.retained] : [])] : []),
    ...(polygon ? [...polygon.vertices, ...polygon.relations] : []),
    ...(patternRadius === undefined ? [] : [patternRadius]),
    ...(stations ? [stations.guide, ...stations.stations, ...stations.relations] : []),
    ...(offset ? [offset.source, offset.first, offset.dimension, ...offset.relations] : []),
  ];
}

export function lostConditions(before: Sketch, after: Sketch) {
  const kept = new Set(after.cons.map((c) => c.id));
  return before.cons.filter((c) => !kept.has(c.id));
}

/** Never strand a surviving feature even if the remaining equations are solvable. */
export function brokenFeatureReferences(before: Sketch, after: Sketch) {
  const existing = new Set([...before.pts, ...before.ents, ...before.cons].map((item) => item.id));
  const remaining = new Set([...after.pts, ...after.ents, ...after.cons].map((item) => item.id));
  return after.ents.flatMap((e) => [...new Set(featureReferences(e))]
    .filter((id) => existing.has(id) && !remaining.has(id)).map((id) => ({ feature: e.id, id })));
}

/** Compare the solved sketch to the requested placement, including the shape of round edges. */
export function changedPlacement(expected: Sketch, solved: Sketch, driven: ReadonlySet<number>) {
  const changed = new Set<number>();
  const pts = new Map(solved.pts.map((p) => [p.id, p]));
  const ents = new Map(solved.ents.map((e) => [e.id, e]));
  const near = (delta: number) => Math.abs(delta) <= 1e-6;
  for (const p of expected.pts) {
    if (driven.has(p.id)) continue;
    const q = pts.get(p.id);
    if (!q || !near(Math.hypot(q.x - p.x, q.y - p.y))) changed.add(p.id);
  }
  for (const e of expected.ents) {
    if (driven.has(e.id) || e.t === 'line' || e.t === 'point') continue;
    const q = ents.get(e.id);
    if (!q || q.t === 'line' || q.t !== e.t || !near(q.r - e.r)) { changed.add(e.id); continue; }
    if (e.t === 'arc' && q.t === 'arc') {
      const angle = q.a0 - e.a0;
      if (!near(e.r * Math.atan2(Math.sin(angle), Math.cos(angle))) || !near(e.r * ((q.a1 - q.a0) - (e.a1 - e.a0)))) changed.add(e.id);
    }
  }
  return changed;
}
