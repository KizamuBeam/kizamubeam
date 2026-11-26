// Rechteck-Varianten des Skizzenmodus (Paket 2): reine Geometrie ohne DOM.
// Der Editor sammelt Punkte und legt pro Modus genau ein Rechteck in einem
// sketchChange; Entartungen melden null/false (Hinweis, kein Undo, keine Mutation).
import type { Pt } from '../model';
import {
  addCon, addLine, addPt, addSketchRectangle, materializeSketchPoint,
  type Sketch, type SketchPickedPoint,
} from './model';

export type SketchRectMode = 'corners' | 'threePoint' | 'centerCorner';

/** Kante A→B plus Tiefenpunkt: Rechteckecken A, B, B+n·d, A+n·d; null bei Entartung. */
export function threePointRectCorners(a: Pt, b: Pt, depth: Pt): [Pt, Pt, Pt, Pt] | null {
  if (![a.x, a.y, b.x, b.y, depth.x, depth.y].every(Number.isFinite)) return null;
  const ex = b.x - a.x, ey = b.y - a.y;
  const len = Math.hypot(ex, ey);
  if (!(len > 1e-6)) return null;
  const d = ((depth.x - a.x) * -ey + (depth.y - a.y) * ex) / len;
  if (!(Math.abs(d) > 1e-6)) return null;
  const ox = (-ey / len) * d, oy = (ex / len) * d;
  return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x + ox, y: b.y + oy }, { x: a.x + ox, y: a.y + oy }];
}

/** Anker (Mitte) plus Ecke: achsparallele Rechteckecken; null bei Entartung. */
export function centerCornerRectCorners(center: Pt, corner: Pt): [Pt, Pt, Pt, Pt] | null {
  if (![center.x, center.y, corner.x, corner.y].every(Number.isFinite)) return null;
  const dx = Math.abs(corner.x - center.x), dy = Math.abs(corner.y - center.y);
  if (!(dx > 1e-6) || !(dy > 1e-6)) return null;
  return [
    { x: center.x - dx, y: center.y - dy },
    { x: center.x + dx, y: center.y - dy },
    { x: center.x + dx, y: center.y + dy },
    { x: center.x - dx, y: center.y + dy },
  ];
}

/**
 * 3-Punkt-Rechteck: Kante A–B plus Tiefe (Messklick, keine Ecke). Gegenüberliegende
 * Seiten parallel, eine Ecke senkrecht; H/V nur bei achsparalleler Kante, kein Zwang.
 */
export function addThreePointRectangle(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, depth: SketchPickedPoint,
  aid?: number | null, bid?: number | null, _did?: number | null): boolean {
  if (!threePointRectCorners(a, b, depth)) return false;
  const i0 = materializeSketchPoint(sk, a, aid);
  const i1 = materializeSketchPoint(sk, b, bid);
  const [, , c2, c3] = threePointRectCorners(a, b, depth)!;
  const i2 = addPt(sk, c2.x, c2.y).id;
  const i3 = addPt(sk, c3.x, c3.y).id;
  const l0 = addLine(sk, i0, i1), l1 = addLine(sk, i1, i2), l2 = addLine(sk, i2, i3), l3 = addLine(sk, i3, i0);
  addCon(sk, 'parallel', [l0.id, l2.id]);
  addCon(sk, 'parallel', [l1.id, l3.id]);
  addCon(sk, 'perpendicular', [l0.id, l1.id]);
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dy <= 1e-9 * Math.max(1, dx)) addCon(sk, 'horizontal', [l0.id]);
  else if (dx <= 1e-9 * Math.max(1, dy)) addCon(sk, 'vertical', [l0.id]);
  return true;
}

/**
 * Mitte-Ecke-Rechteck: Anker ist der Mittelpunkt (Mittelpunkt-Con auf Hilfsdiagonale),
 * Ecke eine der vier Ecken (wiederverwendet); achsparallel wie das 2-Ecken-Rechteck.
 */
export function addCenterCornerRectangle(sk: Sketch, center: SketchPickedPoint, corner: SketchPickedPoint,
  centerId?: number | null, cornerId?: number | null): boolean {
  const corners = centerCornerRectCorners(center, corner);
  if (!corners) return false;
  const [bl, , tr] = corners;
  const c = materializeSketchPoint(sk, center, centerId);
  const reuse = materializeSketchPoint(sk, corner, cornerId);
  const left = corner.x < center.x, top = corner.y < center.y;
  const { p0, p2 } = addSketchRectangle(sk, bl, tr,
    left && top ? reuse : undefined, !left && !top ? reuse : undefined,
    { p1: !left && top ? reuse : undefined, p3: left && !top ? reuse : undefined });
  const diagonal = addLine(sk, p0, p2, true);
  addCon(sk, 'midpoint', [c, diagonal.id]);
  return true;
}
