import type { Pt } from '../model';
import { addCon, addPt, entOf, entPoints, ptOf, type SkCon, type SkEnt, type Sketch } from './model';
import { sketchLineCircle } from './intersections';

type TrimEnd = 'a' | 'b';
export type SketchLineEdit = 'trim' | 'extend';
export interface SketchTrim {
  target: number;
  cutter: number;
  end: TrimEnd;
  keep: Pt;
  drop: Pt;
  hit: Pt;
  hitPoint?: number;
  dropPoint: boolean;
  rebind: number[];
  removed: SkCon[];
}

export function isSketchTrimBoundary(sk: Sketch, e: SkEnt): boolean {
  if (e.trimSupport) return false;
  // Ellipsen sind vorerst keine Schneiden (Paket D: trim/split/pattern/divide ausgenommen, kein Umbau).
  if (e.t === 'ellipse') return false;
  if (!e.aux || e.t !== 'line' || !sk.cons.some((c) => c.t === 'midpoint' && c.r[1] === e.id)) return true;
  // A center rectangle's helper diagonal connects two opposite corners. It is not a cutting edge.
  const neighbors = (p: number) => sk.ents.flatMap((l) => (!l.aux || l.trimSupport) && l.t === 'line' ? l.a === p ? [l.b] : l.b === p ? [l.a] : [] : []);
  const ends = new Set(neighbors(e.b));
  return new Set(neighbors(e.a).filter((p) => ends.has(p))).size < 2;
}

/** Trim one end at an interior crossing of two straight segments. All coordinates are sketch-local. */
export function planSketchTrim(sk: Sketch, target: number, cutter: number, end: TrimEnd, mode: SketchLineEdit = 'trim'): SketchTrim | null {
  const line = entOf(sk, target), boundary = entOf(sk, cutter);
  if (target === cutter || line?.t !== 'line' || !boundary || boundary.t === 'point' || !isSketchTrimBoundary(sk, boundary)) return null;
  const keep = ptOf(sk, end === 'a' ? line.b : line.a), drop = ptOf(sk, line[end]);
  if (!keep || !drop) return null;
  if (boundary.t !== 'line') {
    if (mode !== 'extend') return null;
    const center = ptOf(sk, boundary.c);
    const dx = drop.x - keep.x, dy = drop.y - keep.y, len = Math.hypot(dx, dy);
    if (!center || !(len > 1e-6) || !Number.isFinite(len) || !(boundary.r > 1e-6)) return null;
    const ux = dx / len, uy = dy / len, eps = 1e-6;
    for (const d of sketchLineCircle(drop, { x: ux, y: uy }, center, boundary.r)) {
      if (!(d > eps && Number.isFinite(d))) continue;
      const q = { x: drop.x + d * ux, y: drop.y + d * uy };
      const endpoint = boundary.t === 'arc' ? [ptOf(sk, boundary.s), ptOf(sk, boundary.e)]
        .find((p) => p && Math.hypot(q.x - p.x, q.y - p.y) <= eps) : undefined;
      const hit = endpoint ? { x: endpoint.x, y: endpoint.y } : q;
      const rx = hit.x - center.x, ry = hit.y - center.y;
      if (!(Math.abs(Math.hypot(rx, ry) - boundary.r) <= eps
        && Math.abs((hit.x - drop.x) * uy - (hit.y - drop.y) * ux) <= eps
        && (hit.x - drop.x) * ux + (hit.y - drop.y) * uy > eps)) continue;
      if (boundary.t === 'arc' && !endpoint) {
        const tau = 2 * Math.PI;
        const angle = ((Math.atan2(ry, rx) - boundary.a0) % tau + tau) % tau;
        if (angle > boundary.a1 - boundary.a0) continue;
      }
      return finishPlan(sk, target, cutter, end, keep, drop, hit, endpoint?.id);
    }
    return null;
  }
  const a = ptOf(sk, boundary.a), b = ptOf(sk, boundary.b);
  if (!a || !b) return null;
  const dx = drop.x - keep.x, dy = drop.y - keep.y;
  const bx = b.x - a.x, by = b.y - a.y;
  const d = dx * by - dy * bx;
  const length = Math.hypot(dx, dy), span = Math.hypot(bx, by);
  if (!(Math.abs(d) > length * span * 1e-10)) return null;
  const origin = mode === 'extend' ? drop : keep;
  const x = a.x - origin.x, y = a.y - origin.y;
  const u = (x * by - y * bx) / d, v = (x * dy - y * dx) / d;
  const eps = 1e-6;
  const margin = mode === 'trim' ? eps : -eps;
  if (!(v * span > margin && (1 - v) * span > margin)) return null;
  if (!(u * length > eps) || (mode === 'trim' && !((1 - u) * length > eps))) return null;
  const intersection = { x: origin.x + u * dx, y: origin.y + u * dy };
  const endpoint = mode === 'extend' ? [a, b].find((p) => Math.hypot(p.x - intersection.x, p.y - intersection.y) <= eps) : undefined;
  const hit = endpoint ? { x: endpoint.x, y: endpoint.y } : intersection;
  if (![keep, drop].every((p) => Math.hypot(p.x - hit.x, p.y - hit.y) > eps)) return null;
  const alongCutter = (hit.x - a.x) * (bx / span) + (hit.y - a.y) * (by / span);
  if (!endpoint && !(alongCutter > eps && span - alongCutter > eps)) return null;
  if (Math.abs((hit.x - a.x) * (by / span) - (hit.y - a.y) * (bx / span)) > eps) return null;
  if (Math.abs((hit.x - keep.x) * (dy / length) - (hit.y - keep.y) * (dx / length)) > eps) return null;
  return finishPlan(sk, target, cutter, end, keep, drop, hit, endpoint?.id);
}

function finishPlan(sk: Sketch, target: number, cutter: number, end: TrimEnd, keep: Pt & { id: number }, drop: Pt & { id: number }, hit: Pt, hitPoint?: number): SketchTrim {
  const dropPoint = !sk.ents.some((e) => e.id !== target && entPoints(e).includes(drop.id));
  const direction = new Set(['horizontal', 'vertical', 'parallel', 'perpendicular', 'angle']);
  const rebind = sk.cons.filter((c) => dropPoint && (c.t === 'horizontal' || c.t === 'vertical')
    && c.r.length === 2 && c.r.includes(keep.id) && c.r.includes(drop.id)).map((c) => c.id);
  const support = (c: SkCon) => (c.t === 'pointOnLine' || c.t === 'distance') && c.r.length === 2 && c.r[1] === target;
  const removed = sk.cons.filter((c) => !rebind.includes(c.id) && ((dropPoint && c.r.includes(drop.id))
    || (c.r.includes(target) && !direction.has(c.t) && !support(c))));
  const point = ({ x, y }: Pt) => ({ x, y });
  return { target, cutter, end, keep: point(keep), drop: point(drop), hit, hitPoint, dropPoint, rebind, removed: structuredClone(removed) };
}

/** Recompute before changing anything and require explicit approval of every removal. */
export function applySketchTrim(sk: Sketch, target: number, cutter: number, end: TrimEnd, approved: ReadonlySet<number>, mode: SketchLineEdit = 'trim'): void | false {
  const plan = planSketchTrim(sk, target, cutter, end, mode);
  const line = entOf(sk, target);
  if (!plan || line?.t !== 'line' || plan.removed.some((c) => !approved.has(c.id))) return false;
  const old = line[end];
  line[end] = plan.hitPoint ?? addPt(sk, plan.hit.x, plan.hit.y).id;
  if (plan.dropPoint) sk.pts = sk.pts.filter((p) => p.id !== old);
  const ids = new Set(plan.removed.map((c) => c.id));
  sk.cons = sk.cons.filter((c) => !ids.has(c.id));
  for (const c of sk.cons) if (plan.rebind.includes(c.id)) c.r = c.r.map((p) => p === old ? line[end] : p);
  if (plan.hitPoint === undefined) addCon(sk, entOf(sk, cutter)?.t === 'line' ? 'pointOnLine' : 'pointOnCircle', [line[end], cutter]);
}

/** Select the outer section the pointer is over; never cut across an intervening intersection. */
export function pickSketchTrim(sk: Sketch, target: number, cursor: Pt): SketchTrim | null {
  const line = entOf(sk, target);
  if (line?.t !== 'line') return null;
  const a = ptOf(sk, line.a), b = ptOf(sk, line.b);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const along = (p: Pt) => (p.x - a.x) * dx + (p.y - a.y) * dy;
  let first: SketchTrim | undefined, last: SketchTrim | undefined;
  for (const cutter of sk.ents) {
    const plan = planSketchTrim(sk, target, cutter.id, 'a');
    if (!plan) continue;
    if (!first || along(plan.hit) < along(first.hit)) first = plan;
    if (!last || along(plan.hit) > along(last.hit)) last = plan;
  }
  if (!first || !last) return null;
  const at = along(cursor);
  if (at < along(first.hit)) return first;
  if (at > along(last.hit)) return planSketchTrim(sk, target, last.cutter, 'b');
  return null;
}

export function pickSketchExtend(sk: Sketch, target: number, cursor: Pt): SketchTrim | null {
  const line = entOf(sk, target);
  if (line?.t !== 'line') return null;
  const a = ptOf(sk, line.a), b = ptOf(sk, line.b);
  if (!a || !b) return null;
  const end = (cursor.x - (a.x + b.x) / 2) * (b.x - a.x) + (cursor.y - (a.y + b.y) / 2) * (b.y - a.y) < 0 ? 'a' : 'b';
  let best: SketchTrim | null = null, distance = Infinity;
  for (const cutter of sk.ents) {
    const candidate = planSketchTrim(sk, target, cutter.id, end, 'extend');
    if (!candidate) continue;
    const gap = Math.hypot(candidate.hit.x - candidate.drop.x, candidate.hit.y - candidate.drop.y);
    if (gap < distance) { best = candidate; distance = gap; }
  }
  return best;
}
