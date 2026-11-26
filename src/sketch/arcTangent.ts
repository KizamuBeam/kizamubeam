// Tangentenbogen des Skizzenmodus (Paket 4): reine Geometrie ohne DOM.
// Start ist ein gefangener Endpunkt einer Linie/eines Bogens (keine Ellipse, kein Muster),
// Ende ein freier Punkt; die Tangentenlage sichert eine Hilfslinie in Referenzrichtung.
// Der Radius folgt aus der Geometrie; die Seite (stetig/Gegenrichtung) wählt der Editor
// per Cursor-Nähe bzw. U-Taste — hier nur als flip-Flag.
import type { Pt } from '../model';
import {
  addArc, addCon, addLine, addPt, entOf, materializeSketchPoint, ptOf,
  type Sketch, type SketchPickedPoint,
} from './model';

export type SketchArcMode = 'centerStartEnd' | 'tangent';

const MIN = 1e-6;
const TAU = 2 * Math.PI;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const finite = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Ankunftsrichtung an einem Kurven-Endpunkt (Einheit, zeigt in Fortsetzung auf den Punkt). */
export function refEndDir(sk: Sketch, entId: number, ptId: number): Pt | null {
  const e = entOf(sk, entId);
  if (!e) return null;
  if (e.t === 'line') {
    const a = ptOf(sk, e.a), b = ptOf(sk, e.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!(len > MIN)) return null;
    if (ptId === e.b) return { x: dx / len, y: dy / len };
    if (ptId === e.a) return { x: -dx / len, y: -dy / len };
    return null;
  }
  if (e.t === 'arc') {
    if (ptId === e.e) return { x: -Math.sin(e.a1), y: Math.cos(e.a1) };
    if (ptId === e.s) return { x: Math.sin(e.a0), y: -Math.cos(e.a0) };
    return null;
  }
  return null;
}

/** Kreismitte eines Bogens mit Startrichtung durch Start und Ende; null ohne Lösung. */
export function tangentArcCenter(start: Pt, dir: Pt, end: Pt): { c: Pt; r: number } | null {
  if (!finite(start) || !finite(end) || !finite(dir)) return null;
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.hypot(dx, dy) <= MIN) return null;
  const dl = Math.hypot(dir.x, dir.y);
  if (!(dl > 1e-9)) return null;
  const n = { x: -dir.y / dl, y: dir.x / dl };
  const denom = n.x * dx + n.y * dy;
  if (Math.abs(denom) <= 1e-9 * Math.hypot(dx, dy)) return null;
  const lam = (dx * dx + dy * dy) / (2 * denom);
  if (!Number.isFinite(lam) || !(Math.abs(lam) > 5e-7)) return null;
  return { c: { x: start.x + lam * n.x, y: start.y + lam * n.y }, r: Math.abs(lam) };
}

/**
 * Bogenlage Start→Ende mit Startrichtung; flip wählt die Gegenseite (U-Taste).
 * sIsStart=false stellt den Bogen gegen den Uhrzeigersinn als E→S dar (addArc
 * kennt nur wachsende Winkel); die Tangentlage am Start bleibt in beiden Fällen.
 */
export function tangentArcOrder(start: Pt, dir: Pt, end: Pt, flip = false): { c: Pt; r: number; sIsStart: boolean } | null {
  const found = tangentArcCenter(start, dir, end);
  if (!found) return null;
  const aS = Math.atan2(start.y - found.c.y, start.x - found.c.x);
  const aE = Math.atan2(end.y - found.c.y, end.x - found.c.x);
  const m = norm(aE - aS);
  // Winzige Bögen verwerfen der Solver ohnehin (invalidGeometry) — hier schon mit Hinweis.
  if (!(m > 0) || !(m * found.r > MIN) || !((TAU - m) * found.r > MIN)) return null;
  const tc = { x: -Math.sin(aS), y: Math.cos(aS) };
  const dl = Math.hypot(dir.x, dir.y) || 1;
  const cont = (tc.x * dir.x + tc.y * dir.y) / dl >= 0;
  return { ...found, sIsStart: flip ? !cont : cont };
}

/** Tangentenbogen bauen: Mitte aus Geometrie, G1-Bindung über eine Richtungs-Hilfslinie.
 * Der Startpunkt wird mit der Referenz geteilt (Anschluss); die Hilfslinie liegt
 * konstruktiv in Referenzrichtung (parallel zur Linien-Ref, senkrecht zum Bogenradius).
 * H1 ist per coincident an den Fugen-Start gebunden (kein pointOnLine: H1 bliebe sonst
 * entlang der Eigenrichtung verschiebbar). Ein tangent-Con scheidet aus: Tangenten an
 * Elemente mit gemeinsamen Punkten meldet der Solver als strukturell redundant und
 * sketchChange verwirft den Aufbau (vgl. Bogenslot-Fugen in slotModes.ts) — daher sichert
 * stattdessen perpendicular (Hilfslinie, Bogenstartradius C→S) die Lage: Zusammen mit
 * parallel/senkrecht zur Referenz folgt daraus Ref-Richtung ⟂ Startradius, also G1 am
 * Start als Solver-Invariante. Eine doppelte Tangente nach Slot-Vorbild trägt hier nichts:
 * Jede Tangente an einer Linie durch S wäre gleichermaßen redundant; am freien Ende E
 * fehlt ein Richtungsbezug. */
export function addTangentArc(sk: Sketch, refId: number, start: SketchPickedPoint, startId: number | null,
  end: SketchPickedPoint, endId: number | null, flip = false): boolean {
  if (startId == null) return false;
  const ref = entOf(sk, refId);
  if (!ref || (ref.t !== 'line' && ref.t !== 'arc')) return false;
  const dir = refEndDir(sk, refId, startId);
  if (!dir) return false;
  const g = tangentArcOrder(start, dir, end, flip);
  if (!g || !finite(g.c)) return false;
  // Richtungsanker: frische Hilfslinie durch den Start in Referenzrichtung. H1 ist per
  // coincident an den Fugen-Start gebunden (kein pointOnLine: H1 bliebe sonst entlang der
  // Eigenrichtung verschiebbar). Der Anker ist nicht redundant — parallel/senkrecht und
  // perpendicular (Hilfslinie, Startradius) bestimmen Richtung, H1-Lage und G1 unabhängig
  // (sketchChange verwerfe sonst den Aufbau). Vgl. Bogenslot-Fugen in slotModes.ts.
  const H1 = addPt(sk, start.x, start.y).id;
  const H2 = addPt(sk, start.x + 10 * dir.x, start.y + 10 * dir.y).id;
  const helper = addLine(sk, H1, H2, true);
  addCon(sk, 'coincident', [H1, startId]);
  if (ref.t === 'line') addCon(sk, 'parallel', [helper.id, refId]);
  else {
    const radiusLine = addLine(sk, ref.c, startId, true);
    addCon(sk, 'perpendicular', [helper.id, radiusLine.id]);
  }
  const C = addPt(sk, g.c.x, g.c.y).id;
  const S = materializeSketchPoint(sk, g.sIsStart ? start : end, g.sIsStart ? startId : endId);
  const E = materializeSketchPoint(sk, g.sIsStart ? end : start, g.sIsStart ? endId : startId);
  // Startradius zur FUGE (startId): S ist je nach Umlauf Start oder Ende des Bogens.
  const startradius = addLine(sk, C, startId, true);
  addCon(sk, 'perpendicular', [helper.id, startradius.id]);
  addArc(sk, C, S, E);
  return true;
}

/** Vorschau des Tangentenbogens als CCW-Bogen (arcSubPath-Muster: a0→a1). */
export function tangentArcPreview(start: Pt, dir: Pt, end: Pt, flip = false): { c: Pt; r: number; a0: number; a1: number } | null {
  const g = tangentArcOrder(start, dir, end, flip);
  if (!g) return null;
  const sPt = g.sIsStart ? start : end, ePt = g.sIsStart ? end : start;
  const a0 = Math.atan2(sPt.y - g.c.y, sPt.x - g.c.x);
  let a1 = Math.atan2(ePt.y - g.c.y, ePt.x - g.c.x);
  while (a1 <= a0) a1 += TAU;
  return { c: g.c, r: g.r, a0, a1 };
}
