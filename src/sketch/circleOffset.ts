import type { Pt } from '../model';
import { addCircle, addCon, entOf, ptOf, validCircleDiameter, type Sketch } from './model';
import { cornerCrossesOutline } from './trimSpans';

export function planSketchCircleOffset(sk: Sketch, source: number, cursor: Pt) {
  const circle = entOf(sk, source);
  if (circle?.t !== 'circle' || circle.aux) return;
  const center = ptOf(sk, circle.c);
  if (!center) return;
  const radius = Math.hypot(cursor.x - center.x, cursor.y - center.y);
  const offset = radius - circle.r;
  if (!validCircleDiameter(center, 2 * radius) || Math.abs(offset) <= 1e-6) return;
  if (cornerCrossesOutline(sk, { id: -1, t: 'circle', c: circle.c, r: radius })) return;
  return { center, radius, offset };
}

export function addSketchCircleOffset(sk: Sketch, source: number, cursor: Pt): void | false {
  const plan = planSketchCircleOffset(sk, source, cursor);
  if (!plan) return false;
  const copy = addCircle(sk, plan.center.id, plan.radius);
  addCon(sk, 'radialOffset', [source, copy.id], { v: plan.offset, at: { x: cursor.x - plan.center.x, y: cursor.y - plan.center.y } });
}
