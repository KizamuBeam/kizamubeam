import type { Pt } from '../model';
import { entOf, gapSegment, pointPair, ptOf, type Sketch, type SkCon } from './model';

/** Endpoints used by both the renderer and placement; never alter sketch points. */
export function dimensionSegment(sk: Sketch, c: SkCon): { a: Pt; b: Pt; endpoint?: Pt } | null {
  const line = c.r.length === 2 ? entOf(sk, c.r[1]) : undefined;
  if (line?.t === 'line' && c.t === 'distance') {
    const p = ptOf(sk, c.r[0]), a = ptOf(sk, line.a)!, b = ptOf(sk, line.b)!;
    if (!p) return null;
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy || 1;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
    return { a: p, b: { x: a.x + dx * t, y: a.y + dy * t } };
  }
  const gap = c.t === 'distance' ? gapSegment(sk, c.r) : null;
  if (gap) return { a: gap.a, b: gap.b, endpoint: gap.b };
  const pp = pointPair(sk, c.r);
  if (!pp) return null;
  const [a, endpoint] = pp;
  const b = c.t === 'hdistance' ? { x: endpoint.x, y: a.y }
    : c.t === 'vdistance' ? { x: a.x, y: endpoint.y } : endpoint;
  return { a, b, endpoint };
}

export function dimensionOffset(sk: Sketch, c: SkCon, drop?: Pt): Pt | undefined {
  if (c.t === 'distance' || c.t === 'hdistance' || c.t === 'vdistance') {
    const segment = dimensionSegment(sk, c);
    if (!segment) return undefined;
    const { a, b } = segment;
    if (drop) return { x: drop.x - (a.x + b.x) / 2, y: drop.y - (a.y + b.y) / 2 };
    if (c.t === 'distance' && pointPair(sk, c.r)) {
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / length * 5, y: (b.x - a.x) / length * 5 };
    }
  } else if (drop && c.t === 'angle') {
    const points = c.r.flatMap((id) => {
      const e = entOf(sk, id);
      return e?.t === 'line' ? [ptOf(sk, e.a)!, ptOf(sk, e.b)!] : [];
    });
    if (points.length === 4) return { x: drop.x - points.reduce((sum, p) => sum + p.x, 0) / 4,
      y: drop.y - points.reduce((sum, p) => sum + p.y, 0) / 4 };
  } else if (drop) {
    const e = entOf(sk, c.r[0]);
    const center = e && (e.t === 'circle' || e.t === 'arc') ? ptOf(sk, e.c) : undefined;
    if (center) return { x: drop.x - center.x, y: drop.y - center.y };
  }
  return undefined;
}
