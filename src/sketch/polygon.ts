import type { Pt } from '../model';
import { addCircle, addCon, addLine, addPt, materializeSketchPoint, sketchPointLinked, validCircleDiameter, type Sketch, type SketchPickedPoint } from './model';

export const MAX_SKETCH_POLYGON_SIDES = 24;

export type SketchPolygonMode = 'inscribed' | 'circumscribed' | 'edge';

export function sketchPolygonVertices(center: Pt, rim: Pt, sides: number, mode: 'inscribed' | 'circumscribed' = 'inscribed'): Pt[] {
  if (mode !== 'inscribed') {
    const dx = rim.x - center.x, dy = rim.y - center.y;
    if (!Number.isInteger(sides) || sides < 3 || sides > MAX_SKETCH_POLYGON_SIDES || !validCircleDiameter(center, 2 * Math.hypot(dx, dy))) return [];
    // Umschrieben: der Klick liegt auf einer Kantenmitte; Ecken auf Radius/cos(π/n), um π/n verdreht.
    const half = Math.PI / sides, scale = 1 / Math.cos(half);
    const ca = Math.cos(half), sa = Math.sin(half);
    const bx = (dx * ca - dy * sa) * scale, by = (dx * sa + dy * ca) * scale;
    const vertices = Array.from({ length: sides }, (_, i) => {
      const angle = 2 * Math.PI * i / sides, a = Math.cos(angle), b = Math.sin(angle);
      return { x: center.x + bx * a - by * b, y: center.y + bx * b + by * a };
    });
    return vertices.every((p, i) => Math.hypot(p.x - vertices[(i + 1) % sides].x, p.y - vertices[(i + 1) % sides].y) > 1e-6) ? vertices : [];
  }
  const dx = rim.x - center.x, dy = rim.y - center.y;
  if (!Number.isInteger(sides) || sides < 3 || sides > MAX_SKETCH_POLYGON_SIDES || !validCircleDiameter(center, 2 * Math.hypot(dx, dy))) return [];
  const vertices = Array.from({ length: sides }, (_, i) => {
    const angle = 2 * Math.PI * i / sides, a = Math.cos(angle), b = Math.sin(angle);
    return { x: center.x + dx * a - dy * b, y: center.y + dx * b + dy * a };
  });
  return vertices.every((p, i) => Math.hypot(p.x - vertices[(i + 1) % sides].x, p.y - vertices[(i + 1) % sides].y) > 1e-6) ? vertices : [];
}

/** Kante aus zwei Klicks: erste Kante p0→p1, Rest gegen den Uhrzeigersinn um den rekonstruierten Mittelpunkt. */
export function sketchPolygonEdgeVertices(p0: Pt, p1: Pt, sides: number): Pt[] {
  const ex = p1.x - p0.x, ey = p1.y - p0.y, length = Math.hypot(ex, ey);
  if (!Number.isInteger(sides) || sides < 3 || sides > MAX_SKETCH_POLYGON_SIDES || !(length > 1e-6) || !Number.isFinite(length)) return [];
  const step = 2 * Math.PI / sides;
  const apothem = length / (2 * Math.tan(Math.PI / sides));
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const center = { x: mid.x - ey / length * apothem, y: mid.y + ex / length * apothem };
  if (!validCircleDiameter(center, 2 * Math.hypot(p0.x - center.x, p0.y - center.y))) return [];
  const outer = length / (2 * Math.sin(Math.PI / sides));
  const base = Math.atan2(p0.y - center.y, p0.x - center.x);
  const vertices = Array.from({ length: sides }, (_, i) => {
    const angle = base + step * i;
    return { x: center.x + outer * Math.cos(angle), y: center.y + outer * Math.sin(angle) };
  });
  return vertices.every((p, i) => Math.hypot(p.x - vertices[(i + 1) % sides].x, p.y - vertices[(i + 1) % sides].y) > 1e-6) ? vertices : [];
}

/** Native sketch lines, constrained to one construction circle with equal chord lengths. */
export function addSketchPolygon(sk: Sketch, center: SketchPickedPoint, rim: SketchPickedPoint, sides: number,
  centerId?: number | null, rimId?: number | null, mode: SketchPolygonMode = 'inscribed'): void | false {
  if (mode === 'edge') return addSketchEdgePolygon(sk, center, rim, sides, centerId, rimId);
  if (mode === 'circumscribed') return addCircumscribedSketchPolygon(sk, center, rim, sides, centerId, rimId);
  const vertices = sketchPolygonVertices(center, rim, sides);
  if (!vertices.length) return false;
  const c = materializeSketchPoint(sk, center, centerId);
  const radius = Math.hypot(rim.x - center.x, rim.y - center.y);
  const circle = addCircle(sk, c, radius, true);
  circle.trimSupport = true;
  const pts = vertices.map((p, i) => i === 0 ? materializeSketchPoint(sk, rim, rimId) : addPt(sk, p.x, p.y).id);
  const relations = pts.map((p) => addCon(sk, 'pointOnCircle', [p, circle.id]).id);
  const edges = pts.map((p, i) => addLine(sk, p, pts[(i + 1) % sides]));
  for (const edge of edges.slice(1)) relations.push(addCon(sk, 'equal', [edges[0].id, edge.id]).id);
  circle.polygon = { vertices: pts, relations };
  if (rimId == null && !sketchPointLinked(rim)) addCon(sk, 'radius', [circle.id], { v: radius });
  if (centerId == null && !sketchPointLinked(center)) addCon(sk, 'fixed', [c], { x: center.x, y: center.y });
}

/**
 * Umschrieben: Konstruktionskreis durch die Kantenmitten; Kanten tangential,
 * gleich lang; der Rim-Klick wird als Kantenmitte der ersten Kante verankert.
 */
function addCircumscribedSketchPolygon(sk: Sketch, center: SketchPickedPoint, rim: SketchPickedPoint, sides: number,
  centerId?: number | null, rimId?: number | null): void | false {
  const vertices = sketchPolygonVertices(center, rim, sides, 'circumscribed');
  if (!vertices.length) return false;
  const c = materializeSketchPoint(sk, center, centerId);
  const radius = Math.hypot(rim.x - center.x, rim.y - center.y);
  const circle = addCircle(sk, c, radius, true);
  circle.trimSupport = true;
  const pts = vertices.map((p) => addPt(sk, p.x, p.y).id);
  const mid = materializeSketchPoint(sk, rim, rimId);
  const edges = pts.map((p, i) => addLine(sk, p, pts[(i + 1) % sides]));
  const relations = edges.map((e) => addCon(sk, 'tangent', [e.id, circle.id]).id);
  for (const edge of edges.slice(1)) relations.push(addCon(sk, 'equal', [edges[0].id, edge.id]).id);
  relations.push(addCon(sk, 'midpoint', [mid, edges[edges.length - 1].id]).id);
  circle.polygon = { vertices: pts, relations };
  if (rimId == null && !sketchPointLinked(rim)) addCon(sk, 'radius', [circle.id], { v: radius });
  if (centerId == null && !sketchPointLinked(center)) addCon(sk, 'fixed', [c], { x: center.x, y: center.y });
}

/**
 * Kante: zwei Klicks bestimmen die erste Kante exakt; Mittelpunkt und
 * Inkreisradius werden aus der Kantenmitte rekonstruiert, Kanten tangential.
 */
function addSketchEdgePolygon(sk: Sketch, p0: SketchPickedPoint, p1: SketchPickedPoint, sides: number,
  p0Id?: number | null, p1Id?: number | null): void | false {
  const vertices = sketchPolygonEdgeVertices(p0, p1, sides);
  if (!vertices.length) return false;
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const apothem = length / (2 * Math.tan(Math.PI / sides));
  const ex = (p1.x - p0.x) / length, ey = (p1.y - p0.y) / length;
  const center = { x: mid.x - ey * apothem, y: mid.y + ex * apothem };
  const c = addPt(sk, center.x, center.y).id;
  const circle = addCircle(sk, c, apothem, true);
  circle.trimSupport = true;
  const pts = vertices.map((p, i) => {
    if (i === 0) return materializeSketchPoint(sk, p0, p0Id);
    if (i === 1) return materializeSketchPoint(sk, p1, p1Id);
    return addPt(sk, p.x, p.y).id;
  });
  const edges = pts.map((p, i) => addLine(sk, p, pts[(i + 1) % sides]));
  const relations = edges.map((e) => addCon(sk, 'tangent', [e.id, circle.id]).id);
  for (const edge of edges.slice(1)) relations.push(addCon(sk, 'equal', [edges[0].id, edge.id]).id);
  circle.polygon = { vertices: pts, relations };
  if (p1Id == null && !sketchPointLinked(p1)) addCon(sk, 'radius', [circle.id], { v: apothem });
  addCon(sk, 'fixed', [c], { x: center.x, y: center.y });
}

/** Equal chords also admit stars and retraced contours. Keep the seeded convex branch. */
export function isConvexPolygonBranch(center: Pt, vertices: Pt[]): boolean {
  const step = 2 * Math.PI / vertices.length;
  return vertices.length >= 3 && vertices.every((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    const ax = a.x - center.x, ay = a.y - center.y, bx = b.x - center.x, by = b.y - center.y;
    return Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 && Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by) - step) < 1e-4;
  });
}
