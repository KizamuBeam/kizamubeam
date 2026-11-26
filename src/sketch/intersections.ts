import type { Pt } from '../model';

/** Intersections with the supporting line; direction must be a unit vector. */
export function sketchLineCircle(origin: Pt, direction: Pt, center: Pt, radius: number): number[] {
  const dx = center.x - origin.x, dy = center.y - origin.y;
  const along = dx * direction.x + dy * direction.y;
  const normal = Math.abs(dx * direction.y - dy * direction.x);
  const roundoff = 8 * Number.EPSILON * Math.max(radius, Math.abs(dx * direction.y), Math.abs(dy * direction.x));
  if (!(normal <= radius + roundoff)) return [];
  if (Math.abs(radius - normal) <= roundoff) return [along];
  const offset = Math.sqrt((radius - normal) * (radius + normal));
  return offset > 0 ? [along - offset, along + offset] : [along];
}
