// Kreis-Varianten des Skizzenmodus (Paket 1): reine Geometrie ohne DOM.
// Der Editor sammelt Punkte/Referenzen und legt pro Modus genau einen Kreis in einem
// sketchChange; Entartungen melden null/false (Hinweis, kein Undo, keine Mutation).
import type { Pt } from '../model';
import {
  addCircle, addCon, addPt, entOf, materializeSketchPoint, ptOf,
  type Sketch, type SketchPickedPoint,
} from './model';

export type SketchCircleMode = 'centerRim' | 'twoPoint' | 'threePoint' | 'twoTangent' | 'threeTangent';

/** Tangentenziele: Linien, Kreise, Bögen. Ellipsen und Punkte sind ausgenommen. */
export function tangentRefKind(sk: Sketch, id: number): 'line' | 'circle' | 'arc' | null {
  const e = entOf(sk, id);
  if (!e) return null;
  return e.t === 'line' || e.t === 'circle' || e.t === 'arc' ? e.t : null;
}

/** Umkreismittelpunkt dreier Punkte; null bei kollinearen Punkten (|Fläche| ≤ 1e-9). */
export function circumcenter(a: Pt, b: Pt, c: Pt): Pt | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) <= 4e-9 || !Number.isFinite(d)) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Durchmesser-Enden → Mitte und halbe Distanz; null bei zusammenfallenden Punkten. */
export function twoPointCircle(a: Pt, b: Pt): { center: Pt; radius: number } | null {
  const radius = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  return radius > 1e-6 && Number.isFinite(radius)
    ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius }
    : null;
}

interface LineForm { nx: number; ny: number; c: number }
function lineForm(a: Pt, b: Pt): LineForm | null {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  const nx = -dy / len, ny = dx / len;
  return { nx, ny, c: nx * a.x + ny * a.y };
}

type Locus = LineForm | { x: number; y: number; r: number };
const isLineLocus = (l: Locus): l is LineForm => (l as LineForm).nx !== undefined;

/** Versatzorte einer Referenz im Abstand r: Parallelen bzw. konzentrische Kreise. */
function refLoci(sk: Sketch, id: number, r: number): Locus[] | null {
  const e = entOf(sk, id);
  if (!e || tangentRefKind(sk, id) === null) return null;
  if (e.t === 'line') {
    const a = ptOf(sk, e.a), b = ptOf(sk, e.b);
    const f = a && b ? lineForm(a, b) : null;
    if (!f) return null;
    return [{ ...f, c: f.c + r }, { ...f, c: f.c - r }];
  }
  if (e.t !== 'circle' && e.t !== 'arc') return null;
  const c = ptOf(sk, e.c);
  if (!c || !(e.r > 1e-9)) return null;
  const loci: Locus[] = [{ x: c.x, y: c.y, r: e.r + r }];
  if (e.r - r > 1e-9) loci.push({ x: c.x, y: c.y, r: e.r - r });
  return loci;
}

function intersectLineLine(a: LineForm, b: LineForm): Pt | null {
  const det = a.nx * b.ny - b.nx * a.ny;
  if (Math.abs(det) <= 1e-12) return null;
  const x = (a.c * b.ny - b.c * a.ny) / det, y = (a.nx * b.c - b.nx * a.c) / det;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function intersectLineCircle(l: LineForm, c: { x: number; y: number; r: number }): Pt[] {
  const dist = l.nx * c.x + l.ny * c.y - l.c, disc = c.r * c.r - dist * dist;
  if (disc < 0 || !(c.r > 0)) return [];
  const foot = { x: c.x - dist * l.nx, y: c.y - dist * l.ny }, h = Math.sqrt(Math.max(0, disc));
  const dx = -l.ny * h, dy = l.nx * h;
  return disc <= 1e-18 ? [foot] : [{ x: foot.x + dx, y: foot.y + dy }, { x: foot.x - dx, y: foot.y - dy }];
}

function intersectCircleCircle(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (!(d > 1e-12) || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const t = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h2 = a.r * a.r - t * t;
  if (h2 < 0) return [];
  const mx = a.x + (dx * t) / d, my = a.y + (dy * t) / d, h = Math.sqrt(Math.max(0, h2));
  const ox = (-dy * h) / d, oy = (dx * h) / d;
  return h2 <= 1e-18 ? [{ x: mx, y: my }] : [{ x: mx + ox, y: my + oy }, { x: mx - ox, y: my - oy }];
}

function byDistance<T>(pts: T[], at: (p: T) => Pt, cursor: Pt): T[] {
  return [...pts].sort((p, q) => {
    const dp = Math.hypot(at(p).x - cursor.x, at(p).y - cursor.y);
    const dq = Math.hypot(at(q).x - cursor.x, at(q).y - cursor.y);
    return dp - dq || at(p).x - at(q).x || at(p).y - at(q).y;
  });
}

/** Mittelpunkte aller Kreise mit Radius r tangential an beiden Referenzen, nächstgelegener zuerst. */
export function twoTangentCandidates(sk: Sketch, aId: number, bId: number, r: number, cursor: Pt): Pt[] {
  if (!(r > 1e-6) || !Number.isFinite(r)) return [];
  const a = refLoci(sk, aId, r), b = refLoci(sk, bId, r);
  if (!a || !b) return [];
  const pts: Pt[] = [];
  for (const x of a) for (const y of b) {
    if (isLineLocus(x) && isLineLocus(y)) { const p = intersectLineLine(x, y); if (p) pts.push(p); }
    else if (isLineLocus(x)) pts.push(...intersectLineCircle(x, y as { x: number; y: number; r: number }));
    else if (isLineLocus(y)) pts.push(...intersectLineCircle(y, x as { x: number; y: number; r: number }));
    else pts.push(...intersectCircleCircle(x as { x: number; y: number; r: number }, y as { x: number; y: number; r: number }));
  }
  const unique = pts.filter((p, i) => Number.isFinite(p.x) && Number.isFinite(p.y)
    && pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 1e-9) === i);
  return byDistance(unique, (p) => p, cursor);
}

export interface TangentCircle { center: Pt; radius: number }

/** Alle Kreise tangential an drei Geraden (Inkreis + Ankreise über Vorzeichenkombinationen). */
export function threeTangentCandidates(sk: Sketch, ids: number[], cursor: Pt): TangentCircle[] {
  if (ids.length !== 3 || ids.some((id) => tangentRefKind(sk, id) !== 'line')) return [];
  const forms: LineForm[] = [];
  for (const id of ids) {
    const e = entOf(sk, id);
    const a = e?.t === 'line' ? ptOf(sk, e.a) : undefined, b = e?.t === 'line' ? ptOf(sk, e.b) : undefined;
    const f = a && b ? lineForm(a, b) : null;
    if (!f) return [];
    forms.push(f);
  }
  const found: TangentCircle[] = [];
  // Alle 8 Vorzeichenkombinationen: −s ist keine Symmetrie (Normale fix), r > 0 filtert die 4 echten Kreise.
  const signs = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]] as const;
  for (const [s1, s2, s3] of signs) {
    // n_i·p − s_i·r = c_i (3 Gleichungen, 3 Unbekannte x, y, r).
    const s = [s1, s2, s3];
    const m = forms.map((f, i) => [f.nx, f.ny, -s[i]]);
    const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (Math.abs(det) <= 1e-12) continue;
    const c = forms.map((f) => f.c);
    const rep = (col: number, vals: number[]) => m.map((row, i) => row.map((v, j) => (j === col ? vals[i] : v)));
    const detOf = (rows: number[][]) => rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
      - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
      + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);
    const x = detOf(rep(0, c)) / det, y = detOf(rep(1, c)) / det, r = detOf(rep(2, c)) / det;
    if (!(r > 1e-6) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) continue;
    found.push({ center: { x, y }, radius: r });
  }
  const unique = found.filter((f, i) => found.findIndex((g) =>
    Math.hypot(g.center.x - f.center.x, g.center.y - f.center.y) <= 1e-9 && Math.abs(g.radius - f.radius) <= 1e-9) === i);
  return byDistance(unique, (f) => f.center, cursor);
}

/** 2-Punkt-Kreis: Endpunkte bleiben Skizzenpunkte mit pointOnCircle-Bindung (Durchmesserlage folgt dem Solver). */
export function addTwoPointCircle(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, aid?: number | null, bid?: number | null): boolean {
  const placed = twoPointCircle(a, b);
  if (!placed) return false;
  const c = materializeSketchPoint(sk, placed.center, undefined);
  const circle = addCircle(sk, c, placed.radius);
  addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, a, aid), circle.id]);
  addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, b, bid), circle.id]);
  return true;
}

/** 3-Punkt-Kreis: Umkreis; alle drei Punkte mit pointOnCircle gebunden. */
export function addThreePointCircle(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, c: SketchPickedPoint,
  aid?: number | null, bid?: number | null, cid?: number | null): boolean {
  const o = circumcenter(a, b, c);
  const r = o ? Math.hypot(a.x - o.x, a.y - o.y) : 0;
  if (!o || !(r > 1e-6)) return false;
  const center = addPt(sk, o.x, o.y).id;
  const circle = addCircle(sk, center, r);
  addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, a, aid), circle.id]);
  addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, b, bid), circle.id]);
  addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, c, cid), circle.id]);
  return true;
}

/** Tangentialkreis an geprüfte Referenzen: je eine Tangenten-Bedingung; fixRadius sichert das Maß (2-Tangenten). */
export function addTangentCircleAt(sk: Sketch, refIds: number[], center: Pt, radius: number, fixRadius: boolean): boolean {
  if (!(radius > 1e-6) || !Number.isFinite(radius) || !refIds.length) return false;
  for (const id of refIds) if (!tangentRefKind(sk, id)) return false;
  const c = addPt(sk, center.x, center.y).id;
  const circle = addCircle(sk, c, radius);
  if (fixRadius) addCon(sk, 'radius', [circle.id], { v: radius });
  for (const id of refIds) addCon(sk, 'tangent', [circle.id, id]);
  return true;
}

/** Abstand eines Punkts zur Tangenten-Referenz (Linie unendlich, Kreis/Bogen radial; Bogen außerhalb des Sweeps zum nächsten Ende). Null bei ungültiger Referenz. */
export function distToTangentRef(sk: Sketch, id: number, p: Pt): number | null {
  const e = entOf(sk, id);
  if (!e || tangentRefKind(sk, id) === null) return null;
  if (e.t === 'line') {
    const a = ptOf(sk, e.a), b = ptOf(sk, e.b);
    if (!a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-9)) return null;
    return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
  }
  if (e.t !== 'circle' && e.t !== 'arc') return null;
  const c = ptOf(sk, e.c);
  if (!c || !(e.r > 1e-9)) return null;
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  if (e.t === 'circle') return Math.abs(d - e.r);
  const s = ptOf(sk, e.s), q = ptOf(sk, e.e);
  let ang = Math.atan2(p.y - c.y, p.x - c.x);
  while (ang < e.a0) ang += 2 * Math.PI;
  if (ang <= e.a1) return Math.abs(d - e.r);
  if (!s || !q) return Math.abs(d - e.r);
  return Math.min(Math.hypot(p.x - s.x, p.y - s.y), Math.hypot(p.x - q.x, p.y - q.y));
}

/** Radius aus Klickabstand: Minimum über beide Referenzen; null ohne gültige Referenz. */
export function twoTangentRadiusFor(sk: Sketch, aId: number, bId: number, p: Pt): number | null {
  const da = distToTangentRef(sk, aId, p), db = distToTangentRef(sk, bId, p);
  if (da === null || db === null) return null;
  const r = Math.min(da, db);
  return Number.isFinite(r) ? r : null;
}

/** Kandidatenkreis-Vorschau unter dem Cursor; null ohne Radius oder Kandidat. */
export function twoTangentPreview(sk: Sketch, aId: number, bId: number, cursor: Pt): TangentCircle | null {
  const r = twoTangentRadiusFor(sk, aId, bId, cursor);
  if (r === null || !(r > 1e-9)) return null;
  const found = twoTangentCandidates(sk, aId, bId, r, cursor)[0];
  return found ? { center: found, radius: r } : null;
}
