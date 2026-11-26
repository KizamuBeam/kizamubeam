// Skizzen mit Beziehungen und Bemaßungen (wie in CAD-Programmen): Datenmodell und Umriss.
// Eine Skizze besteht aus Punkten, Elementen (Linie, Kreis, Bogen) und Beziehungen. Alle Werte in lokalen mm der
// Skizze (y nach unten). Gespeichert wird sie als Parameter „sketch“ eines Generator-Objekts (gen: 'sketch'),
// dadurch funktionieren Speichern, Undo, Kopieren, 3D-Ansicht, Export usw. ohne Sonderfälle.
import type { Pt, SubPath } from '../model';
import { cleanSketchPatterns } from './pattern';
import type { SketchPattern } from './pattern';

export interface SkPt {
  id: number;
  x: number;
  y: number;
}

export type SkEnt = (
  /** Mittellinie (centerline) und Unendlich (infinite) sind reine Anzeige-/Zeichenstile: Solver wie
   * normale 2-Punkt-Linie, aus Profilen und Ausgabe wie aux ausgeschlossen. aux bleibt separat bestehen. */
  | { id: number; t: 'line'; a: number; b: number; aux?: boolean; centerline?: boolean; infinite?: boolean; slotCaps?: [number, number] }
  | { id: number; t: 'circle'; c: number; r: number; aux?: boolean }
  /** Volle Ellipse: Mitte c, Hauptachsen-Ende m (|m-c| = große Halbachse, beliebig rotiert), r = kleine Halbachse.
   * Starre Form ohne Bögen: kein Solver-Primitiv (siehe solver.ts), Achsen per Dialog. */
  | { id: number; t: 'ellipse'; c: number; m: number; r: number; aux?: boolean }
  /** Einzelpunkt: eigenständig selektierbar/löschbar/fangbar, nimmt nicht an Profilen teil (wie aux ausgeschlossen) */
  | { id: number; t: 'point'; p: number; aux?: boolean }
  /** Bogen um c von s nach e mit wachsendem Winkel (a0 < a1, Bogenmaß in Skizzenkoordinaten mit y nach unten) */
  | { id: number; t: 'arc'; c: number; s: number; e: number; r: number; a0: number; a1: number; aux?: boolean }
) & { trimSupport?: true; cornerBounds?: { dimension: number; rays: [number, number, number][]; arc?: { source: number; corner: number; cut: number; retained: number } }; polygon?: { vertices: number[]; relations: number[] }; patternRadius?: number; arcStations?: { guide: number; stations: number[]; relations: number[] }; smoothOffset?: { source: number; first: number; dimension: number; side: number; relations: number[] } };

/** Beziehungen (ohne Wert) und Bemaßungen (mit Wert v) */
export type ConType =
  | 'coincident' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal' | 'fixed'
  | 'pointOnLine' | 'pointOnCircle' | 'midpoint' | 'intersection' | 'segmentFraction' | 'arcSpan' | 'symmetric' | 'tangent' | 'concentric'
  | 'distance' | 'hdistance' | 'vdistance' | 'angle' | 'radius' | 'diameter' | 'radialOffset' | 'arcLength';

export const DIMENSIONS: ConType[] = ['distance', 'hdistance', 'vdistance', 'angle', 'radius', 'diameter', 'radialOffset', 'arcLength'];
export const isDim = (t: ConType) => DIMENSIONS.includes(t);

/** Durchmesser/Radius-Umschaltung im Bemaßungswerkzeug (Zweitklick oder Taste U) */
export const toggleRoundDim = (t: ConType): 'radius' | 'diameter' | null =>
  t === 'radius' ? 'diameter' : t === 'diameter' ? 'radius' : null;

export interface SkCon {
  id: number;
  t: ConType;
  /** beteiligte Punkte/Elemente (ids) */
  r: number[];
  /** Wert der Bemaßung (mm bzw. Grad bei angle) */
  v?: number;
  /** Referenzmaß: lösbar, aber redundant — misst nur, treibt nichts (Anzeige in Klammern, nicht editierbar) */
  driven?: boolean;
  /** Geometric lower bound for a driving dimension that must stay positive. */
  min?: number;
  /** Formel mit Projekt-Parametern (ersetzt v beim Lösen) */
  expr?: string;
  /** Lage der Beschriftung relativ zur Mitte der Bemaßung (mm) */
  at?: Pt;
  /** fixed: festgehaltene Lage des Punkts */
  x?: number;
  y?: number;
}

export interface Sketch {
  v: 1;
  pts: SkPt[];
  ents: SkEnt[];
  cons: SkCon[];
  /** nächste freie id (gemeinsam für Punkte, Elemente, Beziehungen) */
  next: number;
  /**
   * Konstruktions-Hilfslinien dieser Skizze (Weltkoordinaten, wie Doku-Hilfslinien):
   * im Skizzenmodus angelegt, nur dort sichtbar/fangbar, mit der Skizze gespeichert.
   * Beim Verschieben des Skizzen-Objekts bleiben sie stehen.
   */
  guides?: SkGuide[];
  /** Skizzen-Muster (Kreis/Rechteck); Typen und Caps in ./pattern */
  patterns?: SketchPattern[];
}

/** Eine Skizzen-Hilfslinie: achsparallele Linie in Weltkoordinaten (x: senkrecht, y: waagrecht) */
export interface SkGuide {
  axis: 'x' | 'y';
  v: number;
}

/** Obergrenze für gespeicherte Skizzen-Hilfslinien (Schutz vor aufgeblähtem JSON) */
export const MAX_SKETCH_GUIDES = 256;

/** Ungültige Einträge raus, Rest übernehmen (Rohdaten aus Datei/Clipboard misstrauen) */
export function cleanSketchGuides(raw: unknown): SkGuide[] {
  if (!Array.isArray(raw)) return [];
  const out: SkGuide[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const { axis, v } = g as { axis: unknown; v: unknown };
    if ((axis === 'x' || axis === 'y') && typeof v === 'number' && isFinite(v)) out.push({ axis, v });
    if (out.length >= MAX_SKETCH_GUIDES) break;
  }
  return out;
}

export const emptySketch = (): Sketch => ({ v: 1, pts: [], ents: [], cons: [], next: 1 });

export function parseSketch(s: unknown): Sketch {
  try {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    if (!o || typeof o !== 'object') return emptySketch();
    const sk = o as Partial<Sketch>;
    // leere Listen nicht persistieren (kein JSON-Bloat, kein guides: []/patterns: [])
    const guides = cleanSketchGuides(sk.guides);
    const patterns = cleanSketchPatterns(sk.patterns);
    const out: Sketch = {
      v: 1,
      pts: Array.isArray(sk.pts) ? sk.pts.filter((p) => p && isFinite(p.x) && isFinite(p.y)) : [],
      ents: Array.isArray(sk.ents) ? sk.ents : [],
      cons: Array.isArray(sk.cons) ? sk.cons : [],
      next: typeof sk.next === 'number' ? sk.next : 1,
      ...(guides.length ? { guides } : {}),
      ...(patterns.length ? { patterns } : {}),
    };
    const maxId = Math.max(0, ...out.pts.map((p) => p.id), ...out.ents.map((e) => e.id), ...out.cons.map((c) => c.id));
    out.next = Math.max(out.next, maxId + 1);
    return out;
  } catch {
    return emptySketch();
  }
}

export const sketchJson = (sk: Sketch) => JSON.stringify(sk);
export const cloneSketch = (sk: Sketch): Sketch => JSON.parse(JSON.stringify(sk));

export function ptOf(sk: Sketch, id: number): SkPt | undefined {
  return sk.pts.find((p) => p.id === id);
}
export function entOf(sk: Sketch, id: number): SkEnt | undefined {
  return sk.ents.find((e) => e.id === id);
}

export function addPt(sk: Sketch, x: number, y: number): SkPt {
  const p = { id: sk.next++, x, y };
  sk.pts.push(p);
  return p;
}
export function addLine(sk: Sketch, a: number, b: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'line', a, b, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}

/** Einzelpunkt auf bestehendem Skizzenpunkt (Fang wiederverwendet die Punkt-id, sonst neuer Punkt) */
export function addPoint(sk: Sketch, p: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'point', p, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}

/** Konstruktionsgeometrie: aux sowie Mittellinie/Unendlich (aux bleibt separat bestehen). */
export const isConstructionGeometry = (e: SkEnt): boolean =>
  !!e.aux || (e.t === 'line' && (!!e.centerline || !!e.infinite));

/** Konstruktions-Modus: alle Elemente ab id `from` als Hilfsgeometrie markieren (ein Undo-Schritt, keine Profilwirkung) */
export function markAuxFrom(sk: Sketch, from: number) {
  for (const e of sk.ents) if (e.id >= from) e.aux = true;
}

/** Rechteck aus gegenüberliegenden Ecken mit waagrechten und senkrechten Seiten. */
export function addSketchRectangle(sk: Sketch, a: Pt, b: Pt, aid?: number | null, bid?: number | null, other?: { p1?: number; p3?: number }) {
  const p0 = aid ?? addPt(sk, a.x, a.y).id;
  const p1 = other?.p1 ?? addPt(sk, b.x, a.y).id;
  const p2 = bid ?? addPt(sk, b.x, b.y).id;
  const p3 = other?.p3 ?? addPt(sk, a.x, b.y).id;
  const sides = [addLine(sk, p0, p1), addLine(sk, p1, p2), addLine(sk, p2, p3), addLine(sk, p3, p0)];
  sides.forEach((side, i) => addCon(sk, i % 2 ? 'vertical' : 'horizontal', [side.id]));
  return { p0, p2, sides };
}

export type SketchPickedPoint = Pt & { midpointOf?: number; intersection?: { edges: [number, number]; branch: number } };
export const sketchPointLinked = (p: SketchPickedPoint) => p.midpointOf !== undefined || p.intersection !== undefined;

/** Volle Ellipse als geschlossene Bezierkette (Mitte c, Hauptachsen-Ende m, Nebenradius r). */
export function ellipseNodes(c: Pt, m: Pt, r: number): SubPath['nodes'] {
  const dx = m.x - c.x, dy = m.y - c.y;
  const a = Math.hypot(dx, dy);
  const ux = dx / a, uy = dy / a;
  const vx = -uy, vy = ux;
  const n = 8, d = (2 * Math.PI) / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const nodes: SubPath['nodes'] = [];
  for (let i = 0; i <= n; i++) {
    const t = i * d, co = Math.cos(t), si = Math.sin(t);
    const x = c.x + a * co * ux + r * si * vx, y = c.y + a * co * uy + r * si * vy;
    const tx = -a * si * ux + r * co * vx, ty = -a * si * uy + r * co * vy;
    nodes.push({
      x, y,
      ...(i > 0 ? { cin: { x: x - tx * k, y: y - ty * k } } : {}),
      ...(i < n ? { cout: { x: x + tx * k, y: y + ty * k } } : {}),
    });
  }
  return nodes;
}

/** Winkelfang: Ziel auf das nächste Vielfache von `step` (Standard 45°) um den Anker legen; Abstand bleibt. */
export function snapToAngleStep(from: Pt, to: Pt, step = Math.PI / 4): Pt {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return { x: to.x, y: to.y };
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + len * Math.cos(a), y: from.y + len * Math.sin(a) };
}

export function materializeSketchPoint(sk: Sketch, p: SketchPickedPoint, existing?: number | null): number {
  if (existing != null) return existing;
  const id = addPt(sk, p.x, p.y).id;
  if (p.midpointOf !== undefined) addCon(sk, 'midpoint', [id, p.midpointOf]);
  else if (p.intersection) addCon(sk, 'intersection', [id, ...p.intersection.edges], { v: p.intersection.branch });
  return id;
}

/** Bemaßtes Rechteck: Hilfsdiagonale und fester Mittelpunkt halten die Lage bei Maßänderungen. */
export function addCenteredRectangle(sk: Sketch, center: SketchPickedPoint, width: number, height: number, centerId?: number | null,
  corner?: { point: SketchPickedPoint; id?: number | null }): void | false {
  const x = centeredRectangleSpan(center.x, width), y = centeredRectangleSpan(center.y, height);
  if (!x || !y) return false;
  const a = { x: x[0], y: y[0] }, b = { x: x[1], y: y[1] };
  const c = materializeSketchPoint(sk, center, centerId);
  const cornerId = corner ? materializeSketchPoint(sk, corner.point, corner.id) : undefined;
  const left = corner && corner.point.x < center.x, top = corner && corner.point.y < center.y;
  const { p0, p2, sides } = addSketchRectangle(sk, a, b, left && top ? cornerId : undefined, !left && !top ? cornerId : undefined,
    { p1: !left && top ? cornerId : undefined, p3: left && !top ? cornerId : undefined });
  const diagonal = addLine(sk, p0, p2, true);
  if (centerId == null && !sketchPointLinked(center)) addCon(sk, 'fixed', [c], { x: center.x, y: center.y });
  addCon(sk, 'midpoint', [c, diagonal.id]);
  if (!corner) {
    addCon(sk, 'distance', [sides[0].id], { v: width });
    addCon(sk, 'distance', [sides[1].id], { v: height });
  }
}

export const MIN_SKETCH_RECTANGLE_SIZE = 1e-6;

export function centeredRectangleSpan(center: number, size: number): [number, number] | null {
  const lo = center - size / 2, hi = center + size / 2;
  return Number.isFinite(lo) && Number.isFinite(hi) && size >= MIN_SKETCH_RECTANGLE_SIZE && lo < hi ? [lo, hi] : null;
}
export function addCircle(sk: Sketch, c: number, r: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'circle', c, r, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}

/** Untere Achsen-Grenze der Ellipse (wie Rechteck-Mindestmaß): darunter keine gültige Form. */
export const MIN_SKETCH_ELLIPSE_AXIS = 1e-6;

/** Gültige Ellipsenachsen: endliche, positive Halbachsen (große aus Punkten, kleine r). */
export function validEllipseAxes(major: number, minor: number): boolean {
  return Number.isFinite(major) && Number.isFinite(minor)
    && major >= MIN_SKETCH_ELLIPSE_AXIS && minor >= MIN_SKETCH_ELLIPSE_AXIS;
}

export function addEllipse(sk: Sketch, c: number, m: number, r: number, aux = false): SkEnt {
  const e: SkEnt = { id: sk.next++, t: 'ellipse', c, m, r, ...(aux ? { aux } : {}) };
  sk.ents.push(e);
  return e;
}

/** Achsen einer Ellipse setzen (Mitte und Richtung bleiben, Dialog schreibt beide Halbachsen). */
export function applyEllipseAxes(sk: Sketch, target: number, major: number, minor: number): void | false {
  const e = entOf(sk, target);
  if (e?.t !== 'ellipse' || !validEllipseAxes(major, minor)) return false;
  const c = ptOf(sk, e.c), m = ptOf(sk, e.m);
  if (!c || !m) return false;
  const dx = m.x - c.x, dy = m.y - c.y, len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return false;
  m.x = c.x + (dx / len) * major;
  m.y = c.y + (dy / len) * major;
  e.r = minor;
}

export function validCircleDiameter(center: Pt, diameter: number): boolean {
  return [center.x, center.y].every((axis) => {
    const span = centeredRectangleSpan(axis, diameter);
    return !!span && span[0] < axis && axis < span[1];
  });
}

export function addDimensionedCircle(sk: Sketch, center: Pt, diameter: { v: number; expr?: string }): void | false {
  if (!validCircleDiameter(center, diameter.v)) return false;
  const c = addPt(sk, center.x, center.y);
  const circle = addCircle(sk, c.id, diameter.v / 2);
  addCon(sk, 'fixed', [c.id], center);
  addCon(sk, 'diameter', [circle.id], diameter);
}
/** Bogen um den Punkt c von Punkt s nach Punkt e (mit wachsendem Winkel); Radius und Winkel aus den Punkten */
export function addArc(sk: Sketch, c: number, s: number, e: number, aux = false): SkEnt {
  const C = ptOf(sk, c)!,
    S = ptOf(sk, s)!,
    E = ptOf(sk, e)!;
  const r = Math.hypot(S.x - C.x, S.y - C.y);
  const a0 = Math.atan2(S.y - C.y, S.x - C.x);
  let a1 = Math.atan2(E.y - C.y, E.x - C.x);
  while (a1 <= a0) a1 += 2 * Math.PI;
  const ent: SkEnt = { id: sk.next++, t: 'arc', c, s, e, r, a0, a1, ...(aux ? { aux } : {}) };
  sk.ents.push(ent);
  return ent;
}
export function addCon(sk: Sketch, t: ConType, r: number[], extra: Partial<SkCon> = {}): SkCon {
  const c: SkCon = { id: sk.next++, t, r, ...extra };
  sk.cons.push(c);
  return c;
}

/** Punkte, die ein Element benutzt */
export function entPoints(e: SkEnt): number[] {
  return e.t === 'line' ? [e.a, e.b] : e.t === 'circle' ? [e.c] : e.t === 'ellipse' ? [e.c, e.m] : e.t === 'point' ? [e.p] : [e.c, e.s, e.e];
}

/**
 * Löschen: Elemente/Punkte/Beziehungen mit diesen ids. Mit gelöschten Punkten verschwinden ihre Elemente,
 * mit Elementen ihre nicht mehr benutzten Punkte, und jede Beziehung, die etwas Gelöschtes nennt.
 */
export function deleteIds(sk: Sketch, ids: Iterable<number>) {
  const del = new Set(ids);
  for (const e of sk.ents) if (entPoints(e).some((p) => del.has(p))) del.add(e.id);
  const ents = sk.ents.filter((e) => !del.has(e.id));
  const used = new Set(ents.flatMap(entPoints));
  // Punkte löschen, die nur zu gelöschten Elementen gehörten
  for (const e of sk.ents) if (del.has(e.id)) for (const p of entPoints(e)) if (!used.has(p)) del.add(p);
  sk.ents = ents;
  sk.pts = sk.pts.filter((p) => !del.has(p.id));
  sk.cons = sk.cons.filter((c) => !del.has(c.id) && !c.r.some((r) => del.has(r)));
}

/** Aktueller Messwert einer Bemaßung (mm bzw. Grad), aus der Geometrie */
export function measureCon(sk: Sketch, c: SkCon): number | null {
  const P = (id: number) => ptOf(sk, id);
  const E = (id: number) => entOf(sk, id);
  switch (c.t) {
    case 'radialOffset': {
      const a = E(c.r[0]), b = E(c.r[1]);
      return a?.t === 'circle' && b?.t === 'circle' ? b.r - a.r : null;
    }
    case 'distance': {
      if (c.r.length === 1) {
        const e = E(c.r[0]);
        if (e?.t !== 'line') return null;
        const a = P(e.a)!,
          b = P(e.b)!;
        return Math.hypot(b.x - a.x, b.y - a.y);
      }
      const p = P(c.r[0]);
      const q = P(c.r[1]);
      if (p && q) return Math.hypot(q.x - p.x, q.y - p.y);
      const l = E(c.r[1]);
      if (p && l?.t === 'line') return distPointLine(p, P(l.a)!, P(l.b)!);
      // Kante-zu-Kante: Linie↔Kreis, Punkt↔Kreis, Kreis↔Kreis
      const gap = gapOf(sk, c.r);
      if (gap !== null) return gap;
      return null;
    }
    case 'hdistance':
    case 'vdistance': {
      const ps = pointPair(sk, c.r);
      if (!ps) return null;
      return Math.abs(c.t === 'hdistance' ? ps[1].x - ps[0].x : ps[1].y - ps[0].y);
    }
    case 'angle': {
      const l1 = E(c.r[0]),
        l2 = E(c.r[1]);
      if (l1?.t !== 'line' || l2?.t !== 'line') return null;
      return (lineAngle(sk, l1, l2) * 180) / Math.PI;
    }
    case 'radius':
    case 'diameter': {
      const e = E(c.r[0]);
      if (e?.t !== 'circle' && e?.t !== 'arc') return null;
      return c.t === 'radius' ? e.r : e.r * 2;
    }
    case 'arcLength': {
      const e = E(c.r[0]);
      if (e?.t !== 'arc') return null;
      return e.r * arcSweep(e);
    }
    default:
      return null;
  }
}

/** Bogenwinkel (Spannweite, 0 … 2π) eines Bogens */
export function arcSweep(e: SkEnt & { t: 'arc' }): number {
  const turn = 2 * Math.PI;
  return ((e.a1 - e.a0) % turn + turn) % turn;
}

/**
 * Kante-zu-Kante-Lücke (mm, 0 = Berührung, negativ = Überlappung):
 * Linie↔Kreis senkrecht zur Linie, Punkt↔Kreis radial, Kreis↔Kreis entlang der Zentrumsachse
 * (ineinander: Wandstärke). Zentrum-Picks (Punkt-ids) bleiben Mittenabstand wie bisher.
 */
export function gapOf(sk: Sketch, r: number[]): number | null {
  return gapSegment(sk, r)?.gap ?? null;
}

/** Lückensegment (Anfang/Ende in Skizzen-mm) zur Kante-zu-Kante-Lücke, zum Zeichnen der Maßlinie */
export function gapSegment(sk: Sketch, r: number[]): { a: Pt; b: Pt; gap: number } | null {
  const P = (id: number) => ptOf(sk, id);
  const E = (id: number) => entOf(sk, id);
  if (r.length !== 2) return null;
  const [x, y] = [E(r[0]), E(r[1])];
  // Kreis↔Kreis (nur Vollkreise)
  if (x?.t === 'circle' && y?.t === 'circle') {
    const a = P(x.c)!, b = P(y.c)!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const u = d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
    const [lo, hi] = x.r <= y.r ? [x, y] : [y, x];
    if (d + lo.r <= hi.r) {
      // ineinander: Wandstärke auf der engen Seite
      const w = d > 1e-9 ? { x: (P(lo.c)!.x - P(hi.c)!.x) / d, y: (P(lo.c)!.y - P(hi.c)!.y) / d } : u;
      const s = P(lo.c)!, g = P(hi.c)!;
      return { a: { x: s.x + w.x * lo.r, y: s.y + w.y * lo.r }, b: { x: g.x + w.x * hi.r, y: g.y + w.y * hi.r }, gap: hi.r - d - lo.r };
    }
    return { a: { x: a.x + u.x * x.r, y: a.y + u.y * x.r }, b: { x: b.x - u.x * y.r, y: b.y - u.y * y.r }, gap: d - x.r - y.r };
  }
  // Linie↔Kreis (beide Reihenfolgen)
  const l = x?.t === 'line' ? x : y?.t === 'line' ? y : undefined;
  const circ = (e: SkEnt | undefined) => (e?.t === 'circle' ? e : undefined);
  const cc = circ(l === x ? y : l === y ? x : undefined);
  if (l && cc) {
    const c = P(cc.c)!, la = P(l.a)!, lb = P(l.b)!;
    const dx = lb.x - la.x, dy = lb.y - la.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = ((c.x - la.x) * dx + (c.y - la.y) * dy) / l2;
    const f = { x: la.x + dx * t, y: la.y + dy * t };
    const d = Math.hypot(c.x - f.x, c.y - f.y);
    const n = d > 1e-9 ? { x: (c.x - f.x) / d, y: (c.y - f.y) / d } : { x: -dy / Math.sqrt(l2), y: dx / Math.sqrt(l2) };
    return { a: f, b: { x: c.x - n.x * cc.r, y: c.y - n.y * cc.r }, gap: d - cc.r };
  }
  // Punkt↔Kreis (beide Reihenfolgen): radiale Lücke
  const p = P(ptOf(sk, r[0]) ? r[0] : r[1]);
  const single = circ(ptOf(sk, r[0]) ? y : x);
  if (p && single) {
    const c = P(single.c)!;
    const dx = p.x - c.x, dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    const u = d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
    return { a: { ...p }, b: { x: c.x + u.x * single.r, y: c.y + u.y * single.r }, gap: d - single.r };
  }
  return null;
}

/** Zwei Punkte einer Bemaßung: zwei Punkt-ids oder eine Linie */
export function pointPair(sk: Sketch, r: number[]): [SkPt, SkPt] | null {
  if (r.length === 1) {
    const e = entOf(sk, r[0]);
    if (e?.t !== 'line') return null;
    return [ptOf(sk, e.a)!, ptOf(sk, e.b)!];
  }
  const p = ptOf(sk, r[0]),
    q = ptOf(sk, r[1]);
  return p && q ? [p, q] : null;
}

export function distPointLine(p: Pt, a: Pt, b: Pt): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!L) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
}

/**
 * Ablage-bestimmt-Typ für 2-Punkt-/Linien-Abstand: Die Ablage (Labelposition) entscheidet.
 * label: Ablagepunkt in Skizzen-mm (aus der Inline-Wertbox: Cursor beim Setzen).
 * Ergebnis: weit gegenüber abgelegt = freier Abstand, oben/unten = hdistance, daneben = vdistance.
 * Nur für explizite Ablagen gedacht; der voreingestellte 5-mm-Versatz bleibt freier Abstand.
 */
export function classifyDistancePlacement(a: Pt, b: Pt, label: Pt): 'distance' | 'hdistance' | 'vdistance' {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  // Anteile der Ablage (relativ zur Streckenmitte) senkrecht und längs zur Strecke
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const rx = label.x - mx, ry = label.y - my;
  const off = Math.abs((-dy * rx + dx * ry) / L);
  const along = Math.abs((dx * rx + dy * ry) / L);
  if (off > 10 && off > 2 * along) return 'distance';
  return Math.abs(ry) >= Math.abs(rx) ? 'hdistance' : 'vdistance';
}

/** `name = ausdruck` in der Wertbox: definiert einen Projekt-Parameter und bemaßt damit in einem Schritt */
export function splitDimAssignment(src: string): { name: string; expr: string } | null {
  const i = src.indexOf('=');
  if (i <= 0) return null;
  if (src.includes('==') || src.includes('!=') || src.includes('<=') || src.includes('>=')) return null;
  const name = src.slice(0, i).trim(), expr = src.slice(i + 1).trim();
  return name && expr ? { name, expr } : null;
}

/** Einheiten mit Leerzeichen („1 in“) in die evaluate-Form („1in“) bringen */
export function normalizeDimUnits(src: string): string {
  return src.replace(/(\d)\s+(mm|cm|in)(?![\p{L}\p{N}_])/gu, '$1$2');
}

/** Winkel von Linie 1 zu Linie 2 (0 … π), wie PlaneGCS ihn für l2l_angle misst (Richtung b−a) */
export function lineAngle(sk: Sketch, l1: SkEnt & { t: 'line' }, l2: SkEnt & { t: 'line' }): number {
  const a1 = ptOf(sk, l1.a)!,
    b1 = ptOf(sk, l1.b)!,
    a2 = ptOf(sk, l2.a)!,
    b2 = ptOf(sk, l2.b)!;
  const d1 = Math.atan2(b1.y - a1.y, b1.x - a1.x),
    d2 = Math.atan2(b2.y - a2.y, b2.x - a2.x);
  let d = d2 - d1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

// ---------- Umriss ----------

const arcPt = (c: Pt, r: number, a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** Bézierstücke eines Bogens von a0 nach a1 (beliebige Richtung), höchstens 90° je Stück */
export function arcNodes(c: Pt, r: number, a0: number, a1: number): SubPath['nodes'] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const d = (a1 - a0) / n;
  const h = (4 / 3) * Math.tan(d / 4) * r;
  const nodes: SubPath['nodes'] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + i * d;
    const p = arcPt(c, r, a);
    const tx = -Math.sin(a),
      ty = Math.cos(a);
    nodes.push({
      x: p.x, y: p.y,
      ...(i > 0 ? { cin: { x: p.x - tx * h, y: p.y - ty * h } } : {}),
      ...(i < n ? { cout: { x: p.x + tx * h, y: p.y + ty * h } } : {}),
    });
  }
  return nodes;
}

/** Punkt-ids, die durch Koinzidenz-Beziehungen zusammengehören, auf einen Vertreter abbilden */
export function coincidentRoots(sk: Sketch): (id: number) => number {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of sk.cons) if (c.t === 'coincident' && c.r.length === 2) {
    const a = find(c.r[0]),
      b = find(c.r[1]);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

/**
 * Umriss der Skizze (ohne Hilfsgeometrie): Linien und Bögen, die an Punkten zusammenhängen, werden zu Zügen
 * verbunden (geschlossen, wenn sie zum Anfang zurückkehren); Kreise sind eigene geschlossene Umrisse.
 */
export function sketchSubs(sk: Sketch): SubPath[] {
  const root = coincidentRoots(sk);
  const P = (id: number) => ptOf(sk, id)!;
  type Edge = { e: SkEnt; u: number; v: number; used: boolean };
  const edges: Edge[] = [];
  const subs: SubPath[] = [];
  for (const e of sk.ents) {
    if (e.t === 'point' || isConstructionGeometry(e)) continue;
    if (e.t === 'circle') {
      const c = P(e.c);
      if (!c || !(e.r > 0)) continue;
      const nodes = arcNodes(c, e.r, 0, 2 * Math.PI);
      const last = nodes.pop()!;
      nodes[0].cin = last.cin;
      subs.push({ closed: true, nodes });
      continue;
    }
    if (e.t === 'ellipse') {
      const c = P(e.c), m = P(e.m);
      const major = c && m ? Math.hypot(m.x - c.x, m.y - c.y) : 0;
      if (!c || !m || !(major > 0) || !(e.r > 0)) continue;
      const nodes = ellipseNodes(c, m, e.r);
      const last = nodes.pop()!;
      nodes[0].cin = last.cin;
      subs.push({ closed: true, nodes });
      continue;
    }
    if (e.t === 'line') {
      if (!P(e.a) || !P(e.b)) continue;
      edges.push({ e, u: root(e.a), v: root(e.b), used: false });
    } else {
      if (!P(e.c) || !P(e.s) || !P(e.e)) continue;
      edges.push({ e, u: root(e.s), v: root(e.e), used: false });
    }
  }
  const at = new Map<number, Edge[]>();
  for (const ed of edges) for (const n of [ed.u, ed.v]) at.set(n, [...(at.get(n) ?? []), ed]);
  /** Knoten eines Elements in Laufrichtung (ab Knoten from) */
  const nodesOf = (ed: Edge, from: number): SubPath['nodes'] => {
    const e = ed.e;
    if (e.t === 'line') {
      const a = P(e.a),
        b = P(e.b);
      return from === ed.u ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [{ x: b.x, y: b.y }, { x: a.x, y: a.y }];
    }
    if (e.t !== 'arc') return [];
    const c = P(e.c);
    return from === ed.u ? arcNodes(c, e.r, e.a0, e.a1) : arcNodes(c, e.r, e.a1, e.a0);
  };
  const walk = (start: number) => {
    let cur = start;
    const nodes: SubPath['nodes'] = [];
    for (;;) {
      const next = (at.get(cur) ?? []).find((x) => !x.used);
      if (!next) break;
      next.used = true;
      const ns = nodesOf(next, cur);
      if (!nodes.length) nodes.push(...ns);
      else {
        // gemeinsamen Knoten verschmelzen: Anfasser übernehmen
        const last = nodes[nodes.length - 1];
        if (ns[0].cout) last.cout = ns[0].cout;
        nodes.push(...ns.slice(1));
      }
      cur = cur === next.u ? next.v : next.u;
      if (cur === start) {
        // geschlossen: letzten Knoten mit dem ersten verschmelzen
        const last = nodes.pop()!;
        if (last.cin) nodes[0].cin = last.cin;
        subs.push({ closed: true, nodes });
        return;
      }
      if (at.get(cur)?.length !== 2) break;
    }
    if (nodes.length >= 2) subs.push({ closed: false, nodes });
  };
  // Verzweigungen begrenzen offene Züge, ohne dort anliegende Schleifen zu öffnen.
  for (const [n, list] of at) if (list.length === 1 && !list[0].used) walk(n);
  for (const [n, list] of at) if (list.length > 2) while (list.some((ed) => !ed.used)) walk(n);
  for (const ed of edges) if (!ed.used) walk(ed.u);
  return subs;
}

/**
 * Ids der Elemente in nicht-geschlossenen Ketten (gleicher Kantengraph wie sketchSubs, aber mit
 * Elementbezug statt Knotenliste). Kreise und Ellipsen sind eigene geschlossene Umrisse, Hilfsgeometrie zählt nicht.
 */
export function openSketchEntIds(sk: Sketch): Set<number> {
  const root = coincidentRoots(sk);
  const P = (id: number) => ptOf(sk, id)!;
  type Edge = { e: SkEnt; u: number; v: number; used: boolean };
  const edges: Edge[] = [];
  for (const e of sk.ents) {
    if (e.t === 'point' || isConstructionGeometry(e)) continue;
    if (e.t === 'circle' || e.t === 'ellipse') continue;
    if (e.t === 'line') {
      if (!P(e.a) || !P(e.b)) continue;
      edges.push({ e, u: root(e.a), v: root(e.b), used: false });
    } else {
      if (!P(e.c) || !P(e.s) || !P(e.e)) continue;
      edges.push({ e, u: root(e.s), v: root(e.e), used: false });
    }
  }
  const at = new Map<number, Edge[]>();
  for (const ed of edges) for (const n of [ed.u, ed.v]) at.set(n, [...(at.get(n) ?? []), ed]);
  const closed = new Set<number>();
  const walk = (start: number) => {
    let cur = start;
    const chain: Edge[] = [];
    for (;;) {
      const next = (at.get(cur) ?? []).find((x) => !x.used);
      if (!next) return;
      next.used = true;
      chain.push(next);
      cur = cur === next.u ? next.v : next.u;
      if (cur === start) {
        for (const ed of chain) closed.add(ed.e.id);
        return;
      }
      if (at.get(cur)?.length !== 2) return;
    }
  };
  for (const [n, list] of at) if (list.length === 1 && !list[0].used) walk(n);
  for (const [n, list] of at) if (list.length > 2) while (list.some((ed) => !ed.used)) walk(n);
  for (const ed of edges) if (!ed.used) walk(ed.u);
  const open = new Set<number>();
  for (const ed of edges) if (!closed.has(ed.e.id)) open.add(ed.e.id);
  return open;
}
