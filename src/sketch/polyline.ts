import { circleFrom3 } from '../arcs';
import type { Pt } from '../model';
import { addArc, addCon, addLine, addPt, materializeSketchPoint, ptOf, sketchPointLinked, type Sketch, type SketchPickedPoint } from './model';

export type SketchSegment = { end: SketchPickedPoint; through?: SketchPickedPoint; endId?: number | null; throughId?: number | null };
type PolylineIssue = { index: number; reason: 'endpoint' | 'arc' | 'closure' | 'precision' };
const distance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const finite = ({ x, y }: Pt) => Number.isFinite(x) && Number.isFinite(y);

export function sketchPolylineArc(a: Pt, through: Pt, b: Pt) {
  const circle = circleFrom3(a, through, b);
  if (!circle || !finite(circle.c) || !Number.isFinite(circle.r)) return 'arc' as const;
  if ([a, through, b].some((p) => Math.abs(distance(circle.c, p) - circle.r) > 1e-6)) return 'precision' as const;
  const cross = (through.x - a.x) * (b.y - a.y) - (through.y - a.y) * (b.x - a.x);
  return { center: circle.c, radius: circle.r, forward: cross > 0 };
}

/** Validates every segment before creating any sketched geometry. */
export function addSketchPolyline(sk: Sketch, start: SketchPickedPoint, segments: readonly SketchSegment[], closed: boolean, startId?: number | null): PolylineIssue | null {
  if (!finite(start) || !segments.length) return { index: 0, reason: 'endpoint' };
  const hasPoint = (id: number | null | undefined, p: Pt) => {
    if (id == null) return true;
    const existing = ptOf(sk, id);
    return !!existing && same(existing, p);
  };
  if (!hasPoint(startId, start)) return { index: 0, reason: 'endpoint' };
  const last = segments.length - 1;
  const explicitClosure = closed && same(start, segments[last].end);
  const count = segments.length + (closed && !explicitClosure ? 1 : 0);
  if (closed && (count < 2 || (count === 2 && !segments.some((segment) => segment.through)))) return { index: last, reason: 'closure' };
  const edges: { end: SketchPickedPoint; endId?: number | null; arc?: { center: Pt; forward: boolean; through: SketchPickedPoint; throughId?: number | null } }[] = [];
  let previous = start;
  for (const [index, { end, through, endId, throughId }] of segments.entries()) {
    const chord = distance(previous, end);
    if (!finite(end) || !hasPoint(endId, end) || !Number.isFinite(chord) || chord < 1e-6) return { index, reason: 'endpoint' };
    if (through) {
      if (!hasPoint(throughId, through)) return { index, reason: 'arc' };
      const arc = sketchPolylineArc(previous, through, end);
      if (typeof arc === 'string') return { index, reason: arc };
      edges.push({ end, endId, arc: { ...arc, through, throughId } });
    } else edges.push({ end, endId });
    previous = end;
  }
  if (closed && !explicitClosure) {
    const gap = distance(previous, start);
    if (!Number.isFinite(gap) || gap < 1e-6) return { index: last, reason: 'closure' };
    edges.push({ end: start });
  }
  const first = materializeSketchPoint(sk, start, startId);
  let from = first;
  edges.forEach(({ end, endId, arc }, index) => {
    const to = closed && index === edges.length - 1 ? first : materializeSketchPoint(sk, end, endId);
    if (arc) {
      const e = addArc(sk, addPt(sk, arc.center.x, arc.center.y).id, arc.forward ? from : to, arc.forward ? to : from);
      if (arc.throughId != null || sketchPointLinked(arc.through)) {
        addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, arc.through, arc.throughId), e.id]);
      }
    }
    else addLine(sk, from, to);
    from = to;
  });
  return null;
}
