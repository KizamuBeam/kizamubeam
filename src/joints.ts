// Holzverbindungen für gelaserte Bauteile: Fingerzinken, Schlitz und Zapfen, Überblattung, Schnapp- und Hakenverbindung,
// Keilzapfen, T-Slot mit Mutter und Deckelscharnier mit Stift.
// Eine Verbindung wird auf gerade Kanten vorhandener Formen angewendet (Fingerzinken und Zapfen auch auf Kurven, jointsCurve.ts). Die Kante wird durch das Zinken- bzw.
// Zapfenprofil ersetzt, Schlitze kommen als geschlossene Unterpfade hinzu. Alles bleibt ein normaler Pfad mit
// geraden Segmenten (exakte Ecken, keine Näherung) und lässt sich danach im Knoteneditor weiter bearbeiten.
// Gerechnet wird in Weltkoordinaten (mm), damit Materialdicke und Breiten auch bei gedrehten oder skalierten
// Objekten stimmen; das Ergebnis wird in die lokalen Koordinaten des Objekts zurückgerechnet.
// The geometry lives in jointsGeom.ts (also used by the plugin host function joints, #398), the texts in jointText.ts.
import { apply, Mat, Obj, Pt, SubPath } from './model';
import { bezierPt } from './curves';
import { segments, shapeSubs } from './geom';
import { transformSubs } from './importers';
import { smoothChain } from './jointsCurve';
import { computeJointGeom, jointMate as mateGeom, type JointGeometryVersion, type JointOptions, type MateWorld } from './jointsGeom';
import { jointInfoText, jointText } from './jointText';

export {
  DEFAULT_JOINT, fingerCount, fingerProfile, JOINT_GEOMETRY_VERSION, jointAdjust, lapCenters, lidHingeDims, lidHingeProfiles, tenonCenters,
  type JointGeometryVersion, type JointKind, type JointMsg, type JointOptions, type MateWorld,
} from './jointsGeom';

/**
 * Gewählte Kante: Blatt-Objekt, seine Weltmatrix und das Segment in shapeSubs(obj.shape). segs: a smooth run of that
 * many segments from seg on (a curve picked with the Joint tool, see smoothChain), not set for a straight edge.
 */
export interface EdgePick {
  obj: Obj;
  m: Mat;
  sub: number;
  seg: number;
  segs?: number;
}

export interface JointResult {
  /** Neue Unterpfade je geändertem Objekt, in Weltkoordinaten */
  changes: Map<Obj, { m: Mat; subs: SubPath[] }>;
  /** Neue Teile (z. B. Keile), in Weltkoordinaten */
  added: SubPath[];
  info: string;
  error?: string;
}

/** Unterpfade eines Objekts in Weltkoordinaten (Kopie) */
export const worldSubs = (o: Obj, m: Mat): SubPath[] => transformSubs(shapeSubs(o.shape), m);

/** Ist das Segment eine gerade Kante (keine Kurve, nicht entartet)? */
export function isStraight(o: Obj, sub: number, seg: number): boolean {
  const sp = shapeSubs(o.shape)[sub];
  const s = sp && segments(sp)[seg];
  return !!s && !s.curve && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6;
}

/** Segment indices of a pick (one for a straight edge, the whole run for a curve) */
const pickSegs = (p: EdgePick, n: number) => Array.from({ length: p.segs ?? 1 }, (_, i) => (p.seg + i) % n);

/** Do two picks name the same edge? Curves: the same outline and at least one common segment */
export function samePick(p: EdgePick, q: EdgePick): boolean {
  if (p.obj !== q.obj || p.sub !== q.sub) return false;
  if (!p.segs && !q.segs) return p.seg === q.seg;
  const n = segments(shapeSubs(p.obj.shape)[p.sub]).length;
  const a = new Set(pickSegs(p, n));
  return pickSegs(q, n).some((i) => a.has(i));
}

/** Is the pick still a valid edge of its object: a straight segment, or the same smooth run of a curve? */
export function validEdge(p: EdgePick): boolean {
  if (!p.segs) return isStraight(p.obj, p.sub, p.seg);
  const sp = shapeSubs(p.obj.shape)[p.sub];
  if (!sp || p.seg >= segments(sp).length) return false;
  const c = smoothChain(sp, p.seg);
  return c.seg === p.seg && c.segs === p.segs;
}

/** Pick for the segment under the pointer: a straight segment alone, a curve with its whole smooth run (#513) */
export function edgePickAt(obj: Obj, m: Mat, sub: number, seg: number): EdgePick {
  const sp = shapeSubs(obj.shape)[sub];
  const s = segments(sp)[seg];
  return s.curve ? { obj, m, sub, ...smoothChain(sp, seg) } : { obj, m, sub, seg };
}

/** Points of the picked edge in world coordinates (curves sampled), for drawing it */
export function pickPoints(p: EdgePick): Pt[] {
  const sp = shapeSubs(p.obj.shape)[p.sub];
  const all = segments(sp);
  const pts: Pt[] = [];
  for (const i of pickSegs(p, all.length)) {
    const s = all[i];
    const k = s.curve ? 16 : 1;
    for (let j = 0; j < k; j++) {
      const q = s.curve ? bezierPt(s.a, s.c1, s.c2, s.b, j / k) : s.a;
      pts.push(apply(p.m, q.x, q.y));
    }
    if (i === (p.seg + (p.segs ?? 1) - 1) % all.length) pts.push(apply(p.m, s.b.x, s.b.y));
  }
  return pts;
}

const edges = (picks: EdgePick[]) => {
  const subs = new Map<Obj, SubPath[]>();
  return picks.map((p) => {
    let s = subs.get(p.obj);
    if (!s) subs.set(p.obj, (s = worldSubs(p.obj, p.m)));
    return { obj: p.obj, subs: s, sub: p.sub, seg: p.seg, ...(p.segs ? { segs: p.segs } : {}) };
  });
};

/**
 * Welche Linie an welche gehört, vor dem Anwenden der Verbindung berechnet: Kante 1 mit einem Punkt im Material,
 * am Gegenstück die Kante bzw. (Zapfen-Familie) die Mittellinie der Schlitze. null bei nur einer Kante.
 */
export function jointMate(picks: EdgePick[], o: JointOptions): MateWorld | null {
  if (picks.length < 2 || picks[0].obj === picks[1].obj) return null;
  return mateGeom(edges(picks), o);
}

/**
 * Verbindung berechnen. Fingerzinken: eine oder zwei Kanten (die zweite bekommt das Gegenstück).
 * Schlitz und Zapfen: erste Kante bekommt die Zapfen, die zweite Linie (Kante oder einzelne Hilfslinie) die Schlitze.
 * v: version of the joint geometry (jointsGeom.ts); the Joint tool passes the newest one (clearance is the total play, #402).
 */
export function computeJoint(picks: EdgePick[], o: JointOptions, v: JointGeometryVersion = 1): JointResult {
  const r = computeJointGeom(edges(picks), o, v);
  if (r.error) return { changes: new Map(), added: [], info: '', error: jointText(r.error) ?? r.error.code };
  const m = new Map(picks.map((p) => [p.obj, p.m]));
  return { changes: new Map([...r.changes].map(([obj, subs]) => [obj, { m: m.get(obj)!, subs }])), added: r.added, info: jointInfoText(r.info) };
}
