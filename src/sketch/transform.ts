import { apply, type Mat, type Pt } from '../model';
import { cloneSketch, type Sketch } from './model';
import { sketchTransformScope, type SketchTransformBlock } from './translate';

const EPS = 1e-8;
export function sketchRotationMatrix(pivot: Pt, degrees: number): Mat | undefined {
  if (!Number.isFinite(degrees)) return;
  const turn = (degrees % 360) * Math.PI / 180;
  const c = Math.cos(turn), s = Math.sin(turn);
  if (Math.abs(s) < EPS && c > 0) return;
  return [c, s, -s, c, pivot.x - c * pivot.x + s * pivot.y, pivot.y - s * pivot.x - c * pivot.y];
}
export function sketchRigidMatrix(mirror: boolean, points: readonly Pt[], cursor: Pt): Mat | undefined {
  const [a, b] = points;
  if (!a || (!mirror && !b)) return;
  const dx = cursor.x - a.x, dy = cursor.y - a.y, len = Math.hypot(dx, dy);
  if (!(len > EPS) || !Number.isFinite(len)) return;
  let u = dx / len, v = dy / len;
  if (!mirror) {
    const x = b.x - a.x, y = b.y - a.y, l = Math.hypot(x, y);
    if (!(l > EPS) || !Number.isFinite(l)) return;
    [u, v] = [(x * u + y * v) / l, (x * v - y * u) / l];
    if (Math.abs(v) < EPS && u > 0) return;
  }
  const c = mirror ? u * u - v * v : u, s = mirror ? 2 * u * v : v;
  const q = mirror ? s : -s, r = mirror ? -c : c;
  return [c, s, q, r, a.x - c * a.x - q * a.y, a.y - s * a.x - r * a.y];
}

export function transformedSketch(sk: Sketch, selection: ReadonlySet<number>, m: Mat, mirror: boolean):
  { sketch: Sketch; driven: Set<number> } | SketchTransformBlock {
  if (!m.every(Number.isFinite) || Math.abs(Math.hypot(m[0], m[1]) - 1) > EPS ||
    Math.abs(m[2] - (mirror ? m[1] : -m[1])) > EPS || Math.abs(m[3] - (mirror ? -m[0] : m[0])) > EPS) {
    return { blocking: [], unsupported: true };
  }
  const scope = sketchTransformScope(sk, selection);
  if ('blocking' in scope) return scope;
  const { ids } = scope;
  const copy = cloneSketch(sk), blocking: number[] = [];
  const aligned = Math.abs(m[1]) < EPS, swapped = Math.abs(m[0]) < EPS;
  for (const c of copy.cons) {
    if (!c.r.some((id) => ids.has(id))) continue;
    if (mirror && c.t === 'arcSpan' && c.v !== undefined) c.v = 1 - c.v;
    if (mirror && c.t === 'intersection' && c.v !== undefined) {
      // Round tangents are defined counterclockwise in sketch coordinates, so each reverses under reflection.
      const round = c.r.slice(1).filter((id) => sk.ents.find((e) => e.id === id)?.t !== 'line').length;
      if (round !== 1) c.v *= -1;
    }
    if (c.t === 'horizontal' || c.t === 'vertical' || c.t === 'hdistance' || c.t === 'vdistance') {
      if (!aligned && !swapped) { blocking.push(c.id); continue; }
      if (swapped) c.t = c.t === 'horizontal' ? 'vertical' : c.t === 'vertical' ? 'horizontal' : c.t === 'hdistance' ? 'vdistance' : 'hdistance';
    }
    if (c.t === 'fixed') {
      const p = copy.pts.find((p) => p.id === c.r[0]);
      if (!p) return { blocking: [c.id] };
      const q = apply(m, c.x ?? p.x, c.y ?? p.y);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return { blocking: [c.id], unsupported: true };
      c.x = q.x; c.y = q.y;
    }
    if (c.at) c.at = apply([m[0], m[1], m[2], m[3], 0, 0], c.at.x, c.at.y);
  }
  if (blocking.length) return { blocking };
  for (const p of copy.pts) if (ids.has(p.id)) {
    const q = apply(m, p.x, p.y);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return { blocking: [], unsupported: true };
    Object.assign(p, q);
  }
  const turn = Math.atan2(m[1], m[0]);
  if (mirror) for (const e of copy.ents) if (ids.has(e.id)) {
    if (e.polygon) {
      const [first, ...rest] = e.polygon.vertices;
      e.polygon.vertices = [first, ...rest.reverse()];
    }
    if (e.arcStations) e.arcStations.stations.reverse();
    if (e.smoothOffset) e.smoothOffset.side *= -1;
  }
  for (const e of copy.ents) if (e.t === 'arc' && ids.has(e.id)) {
    const sweep = e.a1 - e.a0;
    e.a0 = mirror ? turn - e.a1 : e.a0 + turn;
    e.a1 = e.a0 + sweep;
    if (mirror) [e.s, e.e] = [e.e, e.s];
  }
  return { sketch: copy, driven: scope.driven };
}
