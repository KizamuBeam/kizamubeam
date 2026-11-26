import type { Pt } from '../model';
import { addArc, addCon, addLine, addPt, coincidentRoots, entOf, ptOf, type Sketch, type SkEnt } from './model';

type Side = { id: number; corner: number; far: number; cut: Pt };
export type SketchCorner = { target: number; sides: [Side, Side]; size: number; center?: Pt; reverse: boolean };
const EPS = 1e-6;
const TURN = 2 * Math.PI;
type Arc = Extract<SkEnt, { t: 'arc' }>;
const positiveAngle = (a: number) => ((a % TURN) + TURN) % TURN;

function planMixedCorner(sk: Sketch, line: Extract<SkEnt, { t: 'line' }>, cornerId: number, arc: Arc, arcStart: boolean, size: number, rounded: boolean): SketchCorner | undefined {
  const p = ptOf(sk, cornerId), u = ptOf(sk, line.a === cornerId ? line.b : line.a), c = ptOf(sk, arc.c);
  const corner = arcStart ? arc.s : arc.e, far = arcStart ? arc.e : arc.s, q = ptOf(sk, corner);
  if (!p || !q || !u || !c || Math.hypot(p.x - q.x, p.y - q.y) > EPS) return;
  const length = Math.hypot(u.x - p.x, u.y - p.y), r = arc.r, sweep = arc.a1 - arc.a0, start = arcStart ? arc.a0 : arc.a1, d = arcStart ? 1 : -1;
  if (!(length > EPS && r > EPS && sweep > EPS)) return;
  const x = (u.x - p.x) / length, y = (u.y - p.y) / length;
  const cross = d * (x * Math.cos(start) + y * Math.sin(start));
  if (Math.abs(cross) < EPS) return;
  const k = Math.sign(cross);
  const result = (along: number, a: number, center?: Pt): SketchCorner | undefined => {
    const walked = positiveAngle(d * (a - start));
    if (!(along > EPS && along < length - EPS && walked * r > EPS && (sweep - walked) * r > EPS)) return;
    const ab = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    return { target: line.id, sides: [
      { id: line.id, corner: cornerId, far: u.id, cut: { x: p.x + x * along, y: p.y + y * along } },
      { id: arc.id, corner, far, cut: ab },
    ], size, center, reverse: k > 0 };
  };
  if (!rounded) return result(size, start + d * 2 * Math.asin(size / (2 * r)));
  const offset = r + k * d * size;
  if (!(offset > EPS)) return;
  const f = { x: p.x - k * y * size, y: p.y + k * x * size };
  const vx = c.x - f.x, vy = c.y - f.y, at = vx * x + vy * y, h = vx * y - vy * x;
  const sq = offset * offset - h * h;
  if (!(sq > EPS * EPS)) return;
  const plans = [at - Math.sqrt(sq), at + Math.sqrt(sq)].flatMap((along) => {
    const center = { x: f.x + x * along, y: f.y + y * along };
    const a = Math.atan2(center.y - c.y, center.x - c.x), plan = result(along, a, center);
    if (!plan) return [];
    const [left, right] = plan.sides;
    const angle = (v: Pt) => Math.atan2(v.y - center.y, v.x - center.x);
    const minor = positiveAngle(k * (angle(left.cut) - angle(right.cut)));
    return minor > EPS && minor < Math.PI - EPS ? [plan] : [];
  });
  return plans.length === 1 ? plans[0] : undefined;
}

export function planSketchCorner(sk: Sketch, sideId: number, end: 'a' | 'b', size: number, rounded: boolean): SketchCorner | undefined {
  const a = entOf(sk, sideId);
  if (a?.t !== 'line' || a.aux || !(size > EPS) || !Number.isFinite(size)) return;
  const root = coincidentRoots(sk), cornerId = a[end];
  const at = root(cornerId);
  const incident = sk.ents.filter((e) => !e.aux && (e.t === 'line' ? root(e.a) === at || root(e.b) === at : e.t === 'arc' && (root(e.s) === at || root(e.e) === at)));
  const b = incident.find((e) => e.id !== sideId);
  if (incident.length === 2 && b?.t === 'arc') return planMixedCorner(sk, a, cornerId, b, root(b.s) === at, size, rounded);
  if (incident.length !== 2 || b?.t !== 'line') return;
  const otherEnd = root(b.a) === at ? 'a' : 'b';
  const ids = [[cornerId, a[end === 'a' ? 'b' : 'a']], [b[otherEnd], b[otherEnd === 'a' ? 'b' : 'a']]] as const;
  const p = ptOf(sk, cornerId), q = ptOf(sk, ids[1][0]), u = ptOf(sk, ids[0][1]), v = ptOf(sk, ids[1][1]);
  if (!p || !q || !u || !v || Math.hypot(p.x - q.x, p.y - q.y) > EPS) return;
  const al = Math.hypot(u.x - p.x, u.y - p.y), bl = Math.hypot(v.x - q.x, v.y - q.y);
  if (!(al > EPS && bl > EPS)) return;
  const ax = (u.x - p.x) / al, ay = (u.y - p.y) / al, bx = (v.x - q.x) / bl, by = (v.y - q.y) / bl;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < EPS) return;
  const half = Math.atan2(Math.abs(cross), ax * bx + ay * by) / 2;
  const setback = rounded ? size / Math.tan(half) : size;
  if (!(setback > EPS && setback < Math.min(al, bl) - EPS)) return;
  const cut1 = { x: p.x + ax * setback, y: p.y + ay * setback }, cut2 = { x: q.x + bx * setback, y: q.y + by * setback };
  const bisector = Math.hypot(ax + bx, ay + by);
  return { target: a.id, sides: [{ id: a.id, corner: cornerId, far: ids[0][1], cut: cut1 }, { id: b.id, corner: ids[1][0], far: ids[1][1], cut: cut2 }], size,
    center: rounded ? { x: p.x + (ax + bx) * (size / Math.sin(half) / bisector), y: p.y + (ay + by) * (size / Math.sin(half) / bisector) } : undefined,
    reverse: cross > 0 };
}

export function applySketchCorner(sk: Sketch, plan: SketchCorner): void | false {
  const originals = plan.sides.map((side) => entOf(sk, side.id));
  if (originals.some((e) => !e || e.t === 'circle' || e.aux)) return false;
  let arcBounds: NonNullable<SkEnt['cornerBounds']>['arc'];
  const ends = plan.sides.map(({ id, corner, far, cut }, index) => {
    const p = addPt(sk, cut.x, cut.y).id;
    const source = originals[index];
    if (source?.t === 'arc') {
      const retained = corner === source.s ? addArc(sk, source.c, p, far) : addArc(sk, source.c, far, p);
      arcBounds = { source: id, corner, cut: p, retained: retained.id };
    } else {
      addCon(sk, 'pointOnLine', [p, id]);
      addLine(sk, far, p);
    }
    return p;
  });
  const [a, b] = ends;
  let connector: SkEnt;
  let dimension;
  if (plan.center) {
    const c = addPt(sk, plan.center.x, plan.center.y).id;
    connector = addArc(sk, c, plan.reverse ? b : a, plan.reverse ? a : b);
    for (const [i, side] of plan.sides.entries()) {
      const source = originals[i];
      if (source?.t === 'arc') {
        const centers = addLine(sk, c, source.c, true);
        centers.trimSupport = true;
        addCon(sk, 'pointOnLine', [ends[i], centers.id]);
        continue;
      }
      const radius = addLine(sk, c, ends[i], true);
      radius.trimSupport = true;
      addCon(sk, 'perpendicular', [radius.id, side.id]);
    }
    dimension = addCon(sk, 'radius', [connector.id], { v: plan.size, min: EPS });
  } else {
    connector = addLine(sk, a, b);
    const legs = plan.sides.map((side, i) => addLine(sk, side.corner, ends[i], true));
    for (const leg of legs) leg.trimSupport = true;
    addCon(sk, 'equal', legs.map((e) => e.id));
    dimension = addCon(sk, 'distance', [legs[0].id], { v: plan.size, min: EPS });
  }
  connector.cornerBounds = { dimension: dimension.id, rays: plan.sides.flatMap((s, i) => originals[i]?.t === 'line' ? [[s.corner, s.far, ends[i]]] : []), ...(arcBounds ? { arc: arcBounds } : {}) };
  for (const e of originals) { e!.aux = true; e!.trimSupport = true; }
}
