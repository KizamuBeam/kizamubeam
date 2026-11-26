// Konstruktionslinien des Skizzenmodus (Paket 4): reine Geometrie ohne DOM.
// Der Editor sammelt Punkte/Referenzen und legt pro Modus genau eine unendliche
// Linie in einem sketchChange; Entartungen melden false (Hinweis, kein Undo, keine Mutation).
// Alle Linien entstehen als infinite (reiner Zeichenstil wie centerline: der Solver sieht
// die normale 2-Punkt-Linie, Profile schließen sie via isConstructionGeometry aus).
// drawAux bleibt außen vor: infinite trägt die Konstruktion bereits, aux wäre redundant.
import type { Pt } from '../model';
import {
  addCon, addLine, addPt, entOf, materializeSketchPoint, ptOf,
  type Sketch, type SketchPickedPoint, type SkEnt,
} from './model';

export type SketchConstrMode = 'free' | 'horizontal' | 'vertical' | 'angle' | 'parallel'
  | 'perpendicular' | 'externalTangent' | 'pointTangent' | 'twoTangent' | 'bisector';

const MIN = 1e-6;
const finite = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Mögliche Referenzen: Linien, Kreise, Bögen. Ellipsen und Punkte sind ausgenommen. */
export function constrRefKind(sk: Sketch, id: number): 'line' | 'circle' | 'arc' | null {
  const e = entOf(sk, id);
  if (!e) return null;
  return e.t === 'line' || e.t === 'circle' || e.t === 'arc' ? e.t : null;
}

/** Zwei verschiedene Skizzenpunkte als unendliche Linie; null bei Entartung. */
export function addInfiniteLine(sk: Sketch, a: number, b: number): SkEnt | null {
  const A = ptOf(sk, a), B = ptOf(sk, b);
  if (!A || !B || Math.hypot(B.x - A.x, B.y - A.y) <= MIN) return null;
  const e = addLine(sk, a, b);
  if (e.t !== 'line') return null; // addLine legt immer Linien an (Typwächter)
  e.infinite = true;
  return e;
}

/** Frei: 2 Punkte, keine Bindung. */
export function addFreeConstrLine(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, aid?: number | null, bid?: number | null): boolean {
  if (!finite(a) || !finite(b) || Math.hypot(b.x - a.x, b.y - a.y) <= MIN) return false;
  return !!addInfiniteLine(sk, materializeSketchPoint(sk, a, aid), materializeSketchPoint(sk, b, bid));
}

/** Waagrecht/senkrecht durch einen Punkt, Richtung per H/V-Bindung gesichert. */
export function addHVConstrLine(sk: Sketch, through: SketchPickedPoint, horizontal: boolean, tid?: number | null): boolean {
  if (!finite(through)) return false;
  const i = materializeSketchPoint(sk, through, tid);
  const j = addPt(sk, through.x + (horizontal ? 10 : 0), through.y + (horizontal ? 0 : 10)).id;
  const e = addInfiniteLine(sk, i, j);
  if (!e) return false;
  addCon(sk, horizontal ? 'horizontal' : 'vertical', [e.id]);
  return true;
}

/** Winkel durch einen Punkt (Grad in Skizzenkoordinaten, y nach unten); reine Geometrie. */
export function addAngleConstrLine(sk: Sketch, through: SketchPickedPoint, angleDeg: number, tid?: number | null): boolean {
  if (!finite(through) || !Number.isFinite(angleDeg)) return false;
  const rad = (angleDeg * Math.PI) / 180;
  const d = { x: Math.cos(rad), y: Math.sin(rad) };
  if (!(Math.hypot(d.x, d.y) > 1e-9)) return false;
  const i = materializeSketchPoint(sk, through, tid);
  const j = addPt(sk, through.x + 10 * d.x, through.y + 10 * d.y).id;
  return !!addInfiniteLine(sk, i, j);
}

/** Parallel/senkrecht zur Referenzlinie durch einen Punkt, Richtung per Bindung gesichert. */
export function addParallelConstrLine(sk: Sketch, refId: number, through: SketchPickedPoint, perpendicular: boolean, tid?: number | null): boolean {
  const ref = entOf(sk, refId);
  if (ref?.t !== 'line') return false;
  const a = ptOf(sk, ref.a), b = ptOf(sk, ref.b);
  if (!a || !b) return false;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (!(len > MIN)) return false;
  if (!finite(through)) return false;
  const ux = dx / len, uy = dy / len;
  const vx = perpendicular ? -uy : ux, vy = perpendicular ? ux : uy;
  const i = materializeSketchPoint(sk, through, tid);
  const j = addPt(sk, through.x + 10 * vx, through.y + 10 * vy).id;
  const e = addInfiniteLine(sk, i, j);
  if (!e) return false;
  addCon(sk, perpendicular ? 'perpendicular' : 'parallel', [e.id, refId]);
  return true;
}

/** Beide Tangentpunkte von außen an den Kreis; leer, wenn der Punkt innen oder auf dem Kreis liegt. */
export function externalTangentPoints(center: Pt, r: number, through: Pt): Pt[] {
  if (!finite(center) || !finite(through) || !(r > 1e-9)) return [];
  const dx = through.x - center.x, dy = through.y - center.y;
  const d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
  if (!(d > r + 1e-9) || !Number.isFinite(d)) return [];
  const base = (r * r) / d2, h = (r * Math.sqrt(d2 - r * r)) / d2;
  const candidates = [
    { x: center.x + base * dx - h * dy, y: center.y + base * dy + h * dx },
    { x: center.x + base * dx + h * dy, y: center.y + base * dy - h * dx },
  ];
  return candidates.filter(finite);
}

/** Tangente von außen: Punkt + Kreis/Bogen, Tangentpunkt nächst zum Cursor, tangent-Bindung. */
export function addExternalTangentConstrLine(sk: Sketch, targetId: number, through: SketchPickedPoint, cursor: Pt, tid?: number | null): boolean {
  const t = entOf(sk, targetId);
  if (t?.t !== 'circle' && t?.t !== 'arc') return false;
  const c = ptOf(sk, t.c);
  if (!c || !(t.r > 1e-9)) return false;
  if (!finite(through) || !finite(cursor)) return false;
  const cands = externalTangentPoints(c, t.r, through);
  if (!cands.length) return false;
  cands.sort((p, q) => Math.hypot(p.x - cursor.x, p.y - cursor.y) - Math.hypot(q.x - cursor.x, q.y - cursor.y));
  const T = cands[0];
  const i = materializeSketchPoint(sk, through, tid);
  const j = addPt(sk, T.x, T.y).id;
  const e = addInfiniteLine(sk, i, j);
  if (!e) return false;
  addCon(sk, 'tangent', [e.id, targetId]);
  return true;
}

/** Tangenteneinheitsrichtung einer Kurve am Punkt: Linie → Eigenrichtung, Kreis/Bogen → Kreistangente. */
export function pointTangentDir(sk: Sketch, targetId: number, at: Pt): Pt | null {
  const t = entOf(sk, targetId);
  if (!t || !finite(at)) return null;
  if (t.t === 'line') {
    const a = ptOf(sk, t.a), b = ptOf(sk, t.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    return len > MIN ? { x: dx / len, y: dy / len } : null;
  }
  if (t.t === 'circle' || t.t === 'arc') {
    const c = ptOf(sk, t.c);
    if (!c) return null;
    const dx = at.x - c.x, dy = at.y - c.y, len = Math.hypot(dx, dy);
    return len > MIN ? { x: -dy / len, y: dx / len } : null;
  }
  return null;
}

/** Tangente-am-Punkt: Kurve + Kurvenpunkt, reine Geometrie ohne Bindung. */
export function addPointTangentConstrLine(sk: Sketch, targetId: number, at: SketchPickedPoint, aid?: number | null): boolean {
  const d = pointTangentDir(sk, targetId, at);
  if (!d) return false;
  const i = materializeSketchPoint(sk, at, aid);
  const j = addPt(sk, at.x + 10 * d.x, at.y + 10 * d.y).id;
  return !!addInfiniteLine(sk, i, j);
}

export interface CommonTangent { p: Pt; q: Pt }

/** Gemeinsame Tangenten zweier Kreise (direkt + quer); leer ohne gemeinsame Tangente. */
export function commonTangents(c0: Pt, r0: number, c1: Pt, r1: number): CommonTangent[] {
  if (![c0.x, c0.y, c1.x, c1.y, r0, r1].every(Number.isFinite)) return [];
  if (!(r0 > 1e-9) || !(r1 > 1e-9)) return [];
  const dx = c1.x - c0.x, dy = c1.y - c0.y, d = Math.hypot(dx, dy);
  if (!(d > 1e-9) || !Number.isFinite(d)) return [];
  const phi = Math.atan2(dy, dx);
  const out: CommonTangent[] = [];
  // Direkt: Differenz der Radien; quer: Summe mit gespiegeltem Tangentpunkt.
  const variants: Array<{ w: number; mirror: boolean }> = [{ w: r0 - r1, mirror: false }, { w: r0 + r1, mirror: true }];
  for (const { w, mirror } of variants) {
    if (d < Math.abs(w) - 1e-9) continue;
    const alpha = Math.acos(Math.min(1, Math.max(-1, w / d)));
    for (const sgn of [1, -1]) {
      const ang = phi + sgn * alpha;
      const n = { x: Math.cos(ang), y: Math.sin(ang) };
      const p = { x: c0.x + r0 * n.x, y: c0.y + r0 * n.y };
      const q = mirror ? { x: c1.x - r1 * n.x, y: c1.y - r1 * n.y } : { x: c1.x + r1 * n.x, y: c1.y + r1 * n.y };
      if (Math.hypot(q.x - p.x, q.y - p.y) <= MIN) continue;
      out.push({ p, q });
    }
  }
  return out.filter((t, i) => out.findIndex((u) =>
    Math.hypot(u.p.x - t.p.x, u.p.y - t.p.y) <= 1e-9 && Math.hypot(u.q.x - t.q.x, u.q.y - t.q.y) <= 1e-9) === i);
}

const distToTangent = (p: Pt, t: CommonTangent): number => {
  const dx = t.q.x - t.p.x, dy = t.q.y - t.p.y, len = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (t.p.y - p.y) - (t.p.x - p.x) * dy) / len;
};

/** Zwei-Tangente: 2 Kreis/Bogen-Refs, Linie nächst zum Cursor, je eine tangent-Bindung. */
export function addTwoTangentConstrLine(sk: Sketch, aId: number, bId: number, cursor: Pt): boolean {
  if (aId === bId || !finite(cursor)) return false;
  const a = entOf(sk, aId), b = entOf(sk, bId);
  if ((a?.t !== 'circle' && a?.t !== 'arc') || (b?.t !== 'circle' && b?.t !== 'arc')) return false;
  const ca = ptOf(sk, a.c), cb = ptOf(sk, b.c);
  if (!ca || !cb) return false;
  const cands = commonTangents(ca, a.r, cb, b.r);
  if (!cands.length) return false;
  cands.sort((p, q) => distToTangent(cursor, p) - distToTangent(cursor, q));
  const T = cands[0];
  const i = addPt(sk, T.p.x, T.p.y).id;
  const j = addPt(sk, T.q.x, T.q.y).id;
  const e = addInfiniteLine(sk, i, j);
  if (!e) return false;
  addCon(sk, 'tangent', [e.id, aId]);
  addCon(sk, 'tangent', [e.id, bId]);
  return true;
}

/** Winkelhalbierende zweier Linien durch ihren Schnittpunkt, nächst zum Cursor; null bei Parallelen. */
export function bisectorThrough(sk: Sketch, aId: number, bId: number, cursor: Pt): { p: Pt; q: Pt } | null {
  if (aId === bId || !finite(cursor)) return null;
  const a = entOf(sk, aId), b = entOf(sk, bId);
  if (a?.t !== 'line' || b?.t !== 'line') return null;
  const A = ptOf(sk, a.a), B = ptOf(sk, a.b), C = ptOf(sk, b.a), D = ptOf(sk, b.b);
  if (!A || !B || !C || !D) return null;
  const ux = B.x - A.x, uy = B.y - A.y, ul = Math.hypot(ux, uy);
  const vx = D.x - C.x, vy = D.y - C.y, vl = Math.hypot(vx, vy);
  if (!(ul > MIN) || !(vl > MIN)) return null;
  const u = { x: ux / ul, y: uy / ul }, v = { x: vx / vl, y: vy / vl };
  const cross = u.x * v.y - u.y * v.x;
  if (Math.abs(cross) <= 1e-12) return null;
  // Schnittpunkt: A + s·u = C + t·v.
  const s = ((C.x - A.x) * v.y - (C.y - A.y) * v.x) / cross;
  const o = { x: A.x + s * u.x, y: A.y + s * u.y };
  if (!finite(o)) return null;
  const dirs = [{ x: u.x + v.x, y: u.y + v.y }, { x: u.x - v.x, y: u.y - v.y }]
    .map((w) => { const l = Math.hypot(w.x, w.y); return l > 1e-9 ? { x: w.x / l, y: w.y / l } : null; })
    .filter((w): w is Pt => !!w);
  if (!dirs.length) return null;
  dirs.sort((p, q) => {
    const dp = Math.abs((cursor.x - o.x) * p.y - (cursor.y - o.y) * p.x);
    const dq = Math.abs((cursor.x - o.x) * q.y - (cursor.y - o.y) * q.x);
    return dp - dq;
  });
  const w = dirs[0];
  return { p: { x: o.x - 10 * w.x, y: o.y - 10 * w.y }, q: { x: o.x + 10 * w.x, y: o.y + 10 * w.y } };
}

/** Winkelhalbierende bauen: 2 Linien-Refs, Linie nächst zum Cursor, reine Geometrie. */
export function addBisectorConstrLine(sk: Sketch, aId: number, bId: number, cursor: Pt): boolean {
  const t = bisectorThrough(sk, aId, bId, cursor);
  if (!t) return false;
  const i = addPt(sk, t.p.x, t.p.y).id;
  const j = addPt(sk, t.q.x, t.q.y).id;
  return !!addInfiniteLine(sk, i, j);
}
