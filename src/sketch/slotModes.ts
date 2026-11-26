// Slot-Varianten des Skizzenmodus (Paket 3): reine Geometrie ohne DOM.
// Der Editor sammelt Punkte und legt pro Modus genau einen Slot in einem
// sketchChange; Entartungen melden null/false (Hinweis, kein Undo, keine Mutation).
import type { Pt } from '../model';
import {
  addArc, addCon, addLine, addPt, materializeSketchPoint, ptOf, sketchPointLinked,
  type Sketch, type SketchPickedPoint,
} from './model';
import { addOrientedSketchSlot } from './slot';
import { circumcenter } from './circleModes';

export type SketchSlotMode = 'centerToCenter' | 'overall' | 'arcCenter' | 'arcThreePoint';

const MIN = 1e-6;
const TAU = 2 * Math.PI;
const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/** Mitte-zu-Mitte: zwei Bogenmittelpunkte + Breite (kapselt den heutigen 3-Klick-Fluss). */
export function addCenterSlot(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, width: number,
  aid?: number | null, bid?: number | null): boolean {
  if (![a.x, a.y, b.x, b.y, width].every(Number.isFinite)) return false;
  if (!(width >= MIN) || !(Math.hypot(b.x - a.x, b.y - a.y) > MIN)) return false;
  return addOrientedSketchSlot(sk, a, b, width, aid, bid) !== false;
}

/** Gesamt-Enden + Breite → Bogenmittelpunkte (Enden − r entlang Achse); null bei Entartung. */
export function slotCentersFromOverall(a: Pt, b: Pt, width: number): { start: Pt; end: Pt } | null {
  if (![a.x, a.y, b.x, b.y, width].every(Number.isFinite)) return null;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), r = width / 2;
  if (!(width >= MIN) || !(len - width > MIN)) return null;
  const ux = dx / len, uy = dy / len;
  return { start: { x: a.x + ux * r, y: a.y + uy * r }, end: { x: b.x - ux * r, y: b.y - uy * r } };
}

/**
 * Gesamt-Slot: Endenpaar + Breite, Cons wie Bestand (Delegation an addOrientedSketchSlot).
 * Gefangene Enden bleiben Bezugspunkte auf der Mittelachse (pointOnLine), die frischen
 * Mitten tragen die Geometrie — so verzerrt ein Fang die Umrechnung nicht.
 */
export function addOverallSlot(sk: Sketch, a: SketchPickedPoint, b: SketchPickedPoint, width: number,
  aid?: number | null, bid?: number | null): boolean {
  const centers = slotCentersFromOverall(a, b, width);
  if (!centers) return false;
  const from = sk.next;
  if (addOrientedSketchSlot(sk, centers.start, centers.end, width, null, null) === false) return false;
  const axis = sk.ents.find((e) => e.t === 'line' && e.id >= from && Array.isArray(e.slotCaps));
  if (axis?.t === 'line') {
    if (aid != null || sketchPointLinked(a)) addCon(sk, 'pointOnLine', [materializeSketchPoint(sk, a, aid), axis.id]);
    if (bid != null || sketchPointLinked(b)) addCon(sk, 'pointOnLine', [materializeSketchPoint(sk, b, bid), axis.id]);
  }
  return true;
}

/** Bogenmitte + Start + Ende → Mittellinienbogen (Ende aufs Kreisradius projiziert, CCW). */
export function arcSlotCenterSpine(o: Pt, s: Pt, e: Pt): { center: Pt; radius: number; start: Pt; end: Pt } | null {
  if (![o.x, o.y, s.x, s.y, e.x, e.y].every(Number.isFinite)) return null;
  const radius = Math.hypot(s.x - o.x, s.y - o.y);
  const d = Math.hypot(e.x - o.x, e.y - o.y);
  if (!(radius > MIN) || !(d > 1e-9)) return null;
  const end = { x: o.x + (e.x - o.x) / d * radius, y: o.y + (e.y - o.y) / d * radius };
  if (!(Math.hypot(end.x - s.x, end.y - s.y) > MIN)) return null;
  return { center: { x: o.x, y: o.y }, radius, start: { x: s.x, y: s.y }, end };
}

/**
 * Umkreisbogen durch drei Mittellinienpunkte; null bei kollinearen Punkten.
 * Bewusst kein linearer Fallback: Ein stiller Geradslot aus drei Klicks wäre
 * überraschend — der Editor weist mit Hinweis ab (wie Paket 1 beim Kreis).
 */
export function arcSlotSpineThrough(s: Pt, t: Pt, e: Pt): { center: Pt; radius: number; start: Pt; end: Pt } | null {
  if (![s.x, s.y, t.x, t.y, e.x, e.y].every(Number.isFinite)) return null;
  const o = circumcenter(s, t, e);
  const radius = o ? Math.hypot(s.x - o.x, s.y - o.y) : 0;
  if (!o || !(radius > MIN)) return null;
  const sweep = normAngle(Math.atan2(e.y - o.y, e.x - o.x) - Math.atan2(s.y - o.y, s.x - o.x));
  if (!(sweep > 1e-6) || !(TAU - sweep > 1e-6)) return null;
  return { center: o, radius, start: { x: s.x, y: s.y }, end: { x: e.x, y: e.y } };
}

/** Vorschau des Bogenmitte-Entwurfs (Mitte + Anfang + Ende/Cursor) als Zeichenbogen. */
export function arcSlotCenterPreview(o: Pt, s: Pt | undefined, e: Pt | undefined, cursor: Pt): { c: Pt; r: number; a0: number; a1: number } | null {
  const start = s ?? cursor, raw = e ?? cursor;
  const radius = Math.hypot(start.x - o.x, start.y - o.y);
  const d = Math.hypot(raw.x - o.x, raw.y - o.y);
  if (!(radius > 1e-9) || !(d > 1e-9)) return null;
  const end = { x: o.x + (raw.x - o.x) / d * radius, y: o.y + (raw.y - o.y) / d * radius };
  if (!(Math.hypot(end.x - start.x, end.y - start.y) > 1e-9)) return null;
  return arcSlotPreviewArc(o, radius, start, end);
}

/** Vorschau des 3-Punkt-Entwurfs (Start + Durchgang + Ende/Cursor) als Umkreisbogen. */
export function arcSlotThroughPreview(s: Pt, t: Pt | undefined, e: Pt | undefined, cursor: Pt): { c: Pt; r: number; a0: number; a1: number } | null {
  if (!t && !e) return null;
  const through = t ?? cursor, end = e ?? cursor;
  const spine = arcSlotSpineThrough(s, through, end);
  if (!spine) return null;
  return arcSlotPreviewArc(spine.center, spine.radius, spine.start, spine.end, through);
}

/** Breite am Bogen: doppelter Abstand der Kante zur Mittellinie (Kreis mit Radius). */
export function sketchArcSlotWidth(center: Pt, radius: number, edge: Pt): number {
  if (![center.x, center.y, radius, edge.x, edge.y].every(Number.isFinite)) return 0;
  return 2 * Math.abs(Math.hypot(edge.x - center.x, edge.y - center.y) - radius);
}

/** Vorschau-Bogen (Mitte, Radius, CCW-Winkel wie addArc) aus Entwurf + Cursor. */
export function arcSlotPreviewArc(center: Pt, radius: number, start: Pt, end: Pt, through?: Pt): { c: Pt; r: number; a0: number; a1: number } | null {
  if (!(radius > 1e-9) || ![center.x, center.y, start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  const aStart = Math.atan2(start.y - center.y, start.x - center.x);
  let a0 = aStart, a1 = Math.atan2(end.y - center.y, end.x - center.x);
  if (through && [through.x, through.y].every(Number.isFinite)) {
    const at = Math.atan2(through.y - center.y, through.x - center.x);
    // Bogen durch den Durchgang: gegen den Uhrzeigersinn, wenn er dort entlang läuft.
    if (!(normAngle(at - a0) <= normAngle(a1 - a0))) { const t = a0; a0 = a1; a1 = t; }
  }
  while (a1 <= a0) a1 += TAU;
  return { c: { x: center.x, y: center.y }, r: radius, a0, a1 };
}

function arcSlotJoints(sk: Sketch, o: number, s: Pt, e: Pt, radius: number, r: number) {
  const c = ptOf(sk, o)!;
  const du = { x: (s.x - c.x) / radius, y: (s.y - c.y) / radius };
  const dv = { x: (e.x - c.x) / radius, y: (e.y - c.y) / radius };
  const at = (d: Pt, rr: number) => addPt(sk, c.x + d.x * rr, c.y + d.y * rr).id;
  return { outerS: at(du, radius + r), outerE: at(dv, radius + r), innerS: at(du, radius - r), innerE: at(dv, radius - r) };
}

/**
 * Bogenslot: konzentrische Seiten (außen/innen), zwei halbrunde Anschlusskappen.
 * Die Fugen sind exakt tangential (konstruktiv); je Seite sichern zwei
 * tangent-Cons zu trimSupport-Hilfslinien die Lage (Solver bildet tangent_la nach
 * solver.ts:268-282; Ellipsen kommen nicht vor). Direkte Bogen-Bogen-Tangenten
 * tragen nichts: Sie wären mit gemeinsamen Punkten strukturell redundant und
 * würden den Aufbau verwerfen — daher der Umweg über separate Hilfspunkte.
 * Die Mittellinie läuft als trimSupport-Bogen mit (kein Profil, keine Erkennung).
 */
function buildArcSlot(sk: Sketch, o: SketchPickedPoint, s: SketchPickedPoint, e: SketchPickedPoint,
  spine: { center: Pt; radius: number; start: Pt; end: Pt }, through: SketchPickedPoint | undefined,
  width: number, oId?: number | null, sId?: number | null, eId?: number | null, throughId?: number | null): boolean {
  const { center, radius } = spine;
  const r = width / 2;
  if (!(width >= MIN) || !(radius > MIN) || !(radius - r > MIN)) return false;
  const oc = materializeSketchPoint(sk, { ...o, x: center.x, y: center.y }, oId);
  const sc = materializeSketchPoint(sk, { ...s, x: spine.start.x, y: spine.start.y }, sId);
  const ec = materializeSketchPoint(sk, { ...e, x: spine.end.x, y: spine.end.y }, eId);
  const joints = arcSlotJoints(sk, oc, spine.start, spine.end, radius, r);
  const ccw = !through || normAngle(Math.atan2(through.y - center.y, through.x - center.x)
      - Math.atan2(spine.start.y - center.y, spine.start.x - center.x))
    <= normAngle(Math.atan2(spine.end.y - center.y, spine.end.x - center.x)
      - Math.atan2(spine.start.y - center.y, spine.start.x - center.x));
  const outer = ccw ? addArc(sk, oc, joints.outerS, joints.outerE) : addArc(sk, oc, joints.outerE, joints.outerS);
  const inner = ccw ? addArc(sk, oc, joints.innerS, joints.innerE) : addArc(sk, oc, joints.innerE, joints.innerS);
  const capS = addArc(sk, sc, joints.outerS, joints.innerS);
  addArc(sk, ec, joints.innerE, joints.outerE);
  const mid = ccw ? addArc(sk, oc, sc, ec, true) : addArc(sk, oc, ec, sc, true);
  mid.trimSupport = true;
  // Fugentangenten (trimSupport, separate Punkte): je Seite zwei tangent_la.
  const tangentLine = (joint: number) => {
    const j = ptOf(sk, joint)!;
    const dx = j.x - center.x, dy = j.y - center.y, l = Math.hypot(dx, dy);
    const a = addPt(sk, j.x, j.y).id;
    const b = addPt(sk, j.x - (dy / l) * 2, j.y + (dx / l) * 2).id;
    const line = addLine(sk, a, b, true);
    line.trimSupport = true;
    return line.id;
  };
  const tOS = tangentLine(joints.outerS), tOE = tangentLine(joints.outerE);
  const tIS = tangentLine(joints.innerS), tIE = tangentLine(joints.innerE);
  addCon(sk, 'diameter', [capS.id], { v: width, min: MIN });
  for (const [side, line] of [[outer.id, tOS], [outer.id, tOE], [inner.id, tIS], [inner.id, tIE]])
    addCon(sk, 'tangent', [side, line]);
  addCon(sk, 'radius', [outer.id], { v: radius + r });
  if (oId == null && !sketchPointLinked(o)) addCon(sk, 'fixed', [oc], { x: center.x, y: center.y });
  if (through) {
    const t = materializeSketchPoint(sk, through, throughId);
    addCon(sk, 'pointOnCircle', [t, mid.id]);
  }
  return true;
}

/** Bogenmitte-Modus: Mitte + Start + Ende + Breite (Ende auf den Kreis gelegt). */
export function addCenterArcSlot(sk: Sketch, o: SketchPickedPoint, s: SketchPickedPoint, e: SketchPickedPoint,
  width: number, oId?: number | null, sId?: number | null, eId?: number | null): boolean {
  const spine = arcSlotCenterSpine(o, s, e);
  if (!spine) return false;
  return buildArcSlot(sk, o, s, e, spine, undefined, width, oId, sId, eId);
}

/** Bogen-3-Punkt-Modus: Mittellinie ist der Umkreisbogen der drei Punkte. */
export function addThroughArcSlot(sk: Sketch, s: SketchPickedPoint, t: SketchPickedPoint, e: SketchPickedPoint,
  width: number, sId?: number | null, tId?: number | null, eId?: number | null): boolean {
  const spine = arcSlotSpineThrough(s, t, e);
  if (!spine) return false;
  return buildArcSlot(sk, spine.center, s, e, spine, t, width, null, sId, eId, tId);
}
