// Fangen wie in LightBurn: Objektfang (Knoten, Mittelpunkt, Zentrum, Schnittpunkt, Linie) und Ausrichtungshilfen.
// Alle Koordinaten in Welt-mm; Toleranzen werden vom Editor aus Bildschirmpixeln umgerechnet.
import { apply, inv, visibleLeaves, mul, Obj, Pt } from './model';
import { bezierPt, Box, boundsOf, segments, shapeSubs, textOutline } from './geom';
import { t } from './i18n';
import { shapeCenters } from './arcs';

export type SnapKind = 'node' | 'mid' | 'center' | 'quad' | 'cross' | 'line' | 'track' | 'angle' | 'ext' | 'intersection';

/** Feste Reihenfolge der Fangziele für UI und Tests. */
export const SNAP_TARGET_ORDER: readonly SnapKind[] = ['node', 'mid', 'center', 'quad', 'cross', 'line'];

export const SNAP_LABELS: Record<SnapKind, string> = {
  node: t('Knoten'),
  mid: t('Mittelpunkt'),
  center: t('Zentrum'),
  quad: t('Quadrant'),
  cross: t('Schnittpunkt'),
  line: t('Linie'),
  track: t('Fangspur'),
  angle: t('Winkel'),
  ext: t('Verlängerung'),
  // Eigener Marker und eigener Locale-Schlüssel folgen in Phase 2; bis dahin bewusst
  // dieselbe Bezeichnung wie 'cross' (kein neuer Schlüssel, kein neues Rendering nötig).
  intersection: t('Schnittpunkt'),
};

export interface SnapHit {
  p: Pt;
  kind: SnapKind;
}

/** Ausrichtungshilfe: senkrechte (x) oder waagrechte (y) Linie von a bis b, oder beliebiges Stück a bis b (Winkelstrahl, Verlängerung) */
export type AlignGuide = { axis: 'x' | 'y'; v: number; a: number; b: number } | { axis: 'seg'; a: Pt; b: Pt };

export interface SnapPoint {
  x: number;
  y: number;
  kind: 'node' | 'mid' | 'center' | 'quad';
}

/** Gerade Stücke der Umrisse (Kurven angenähert) mit Begrenzung für die schnelle Vorauswahl */
interface Piece {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** gerade Strecke (keine Kurvennäherung): darf auf ihrer Verlängerung fangen */
  straight: boolean;
}

const CURVE_STEPS = 16;
/** Höchstzahl der Stücke, die für Schnittpunkte paarweise geprüft werden */
const MAX_CROSS_PIECES = 160;

export class SnapSet {
  pts: SnapPoint[] = [];
  pieces: Piece[] = [];
  /** Begrenzungen der Objekte (oberste Ebene) für Ausrichtungshilfen */
  boxes: Box[] = [];

  addPoint(x: number, y: number, kind: SnapPoint['kind']) {
    this.pts.push({ x, y, kind });
  }
  addPiece(ax: number, ay: number, bx: number, by: number, straight = true) {
    if (ax === bx && ay === by) return;
    this.pieces.push({
      ax, ay, bx, by, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by),
      straight,
    });
  }
}

/**
 * Fangpunkte aller sichtbaren Objekte sammeln.
 * visible: Blatt-Objekt sichtbar? skip: Objekte der obersten Ebene, die nicht fangen (z. B. die bewegte Auswahl).
 */
export function buildSnapSet(objs: Obj[], visible: (leaf: Obj) => boolean, skip: Set<Obj> = new Set()): SnapSet {
  const set = new SnapSet();
  for (const top of objs) {
    if (skip.has(top)) continue;
    let any = false;
    for (const [leaf, m] of visibleLeaves([top])) {
      if (!visible(leaf)) continue;
      any = true;
      const s = leaf.shape;
      const subs = s.kind === 'text' ? (textOutline(s)?.subs ?? []) : shapeSubs(s);
      for (const sp of subs) {
        for (const n of sp.nodes) {
          const q = apply(m, n.x, n.y);
          set.addPoint(q.x, q.y, 'node');
        }
        for (const sg of segments(sp)) {
          const a = apply(m, sg.a.x, sg.a.y),
            b = apply(m, sg.b.x, sg.b.y);
          if (!sg.curve) {
            set.addPoint((a.x + b.x) / 2, (a.y + b.y) / 2, 'mid');
            set.addPiece(a.x, a.y, b.x, b.y);
            continue;
          }
          const mid = bezierPt(sg.a, sg.c1, sg.c2, sg.b, 0.5);
          const mq = apply(m, mid.x, mid.y);
          set.addPoint(mq.x, mq.y, 'mid');
          let prev = a;
          for (let i = 1; i <= CURVE_STEPS; i++) {
            const t = bezierPt(sg.a, sg.c1, sg.c2, sg.b, i / CURVE_STEPS);
            const q = i === CURVE_STEPS ? b : apply(m, t.x, t.y);
            set.addPiece(prev.x, prev.y, q.x, q.y, false);
            prev = q;
          }
        }
      }
      // echte Mittelpunkte von Kreisen, Bögen (auch Löchern) und Vielecken, dazu Quadranten
      if (s.kind !== 'text')
        for (const c of shapeCenters(s, () => subs)) {
          const q = apply(m, c.x, c.y);
          set.addPoint(q.x, q.y, 'center');
          for (const p of c.quads ?? []) {
            const w = apply(m, p.x, p.y);
            set.addPoint(w.x, w.y, 'quad');
          }
        }
      const lb = boundsOf([leaf], mul(m, inv(leaf.m)));
      if (lb) set.addPoint(lb.x + lb.w / 2, lb.y + lb.h / 2, 'center');
    }
    if (!any) continue;
    const b = boundsOf([top]);
    if (!b) continue;
    set.boxes.push(b);
    if (top.shape.kind === 'group') set.addPoint(b.x + b.w / 2, b.y + b.h / 2, 'center');
  }
  return set;
}

/**
 * Nächsten Fangpunkt suchen. Punkte (Knoten, Mittelpunkt, Zentrum, Schnittpunkt) haben Vorrang vor Linien.
 * extra: zusätzliche Knoten (z. B. die Linie im Entstehen).
 */
export function findSnap(set: SnapSet, p: Pt, tol: number, extra: Pt[] = [], targets?: ReadonlySet<SnapKind>): SnapHit | null {
  let best: SnapHit | null = null,
    bd = tol;
  const consider = (x: number, y: number, kind: SnapKind) => {
    if (targets && !targets.has(kind)) return;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= bd) {
      bd = d;
      best = { p: { x, y }, kind };
    }
  };
  for (const q of set.pts) if (Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol) consider(q.x, q.y, q.kind);
  for (const q of extra) consider(q.x, q.y, 'node');

  // Stücke in der Nähe: für Schnittpunkte und Linienfang
  const near: Piece[] = [];
  for (const s of set.pieces) {
    if (s.x1 < p.x - tol || s.x0 > p.x + tol || s.y1 < p.y - tol || s.y0 > p.y + tol) continue;
    if (distToPiece(s, p).d <= tol) near.push(s);
  }
  if (near.length <= MAX_CROSS_PIECES) {
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const x = crossPoint(near[i], near[j]);
        if (x) consider(x.x, x.y, 'cross');
      }
  }
  if (best) return best;
  if (targets && !targets.has('line')) return best;
  for (const s of near) {
    const r = distToPiece(s, p);
    if (r.d <= bd) {
      bd = r.d;
      best = { p: r.p, kind: 'line' };
    }
  }
  return best;
}

function distToPiece(s: Piece, p: Pt): { d: number; p: Pt } {
  const vx = s.bx - s.ax,
    vy = s.by - s.ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / l2)) : 0;
  const q = { x: s.ax + vx * t, y: s.ay + vy * t };
  return { d: Math.hypot(q.x - p.x, q.y - p.y), p: q };
}

/** Echter Schnittpunkt zweier Stücke; aneinanderstoßende Stücke (gemeinsamer Endpunkt) zählen nicht */
function crossPoint(s: Piece, t: Piece): Pt | null {
  const rx = s.bx - s.ax,
    ry = s.by - s.ay,
    qx = t.bx - t.ax,
    qy = t.by - t.ay;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-12) return null;
  const u = ((t.ax - s.ax) * qy - (t.ay - s.ay) * qx) / den;
  const v = ((t.ax - s.ax) * ry - (t.ay - s.ay) * rx) / den;
  const e = 1e-9;
  if (u < -e || u > 1 + e || v < -e || v > 1 + e) return null;
  const x = s.ax + rx * u,
    y = s.ay + ry * u;
  const shared = (ax: number, ay: number) => Math.abs(ax - x) < 1e-6 && Math.abs(ay - y) < 1e-6;
  if ((shared(s.ax, s.ay) || shared(s.bx, s.by)) && (shared(t.ax, t.ay) || shared(t.bx, t.by))) return null;
  return { x, y };
}

/** Punkt waagrecht und senkrecht an Fangpunkten ausrichten (Alt beim Zeichnen) */
export function alignPoint(set: SnapSet, p: Pt, tol: number, extra: Pt[] = []): { p: Pt; guides: AlignGuide[] } {
  return alignToPts([...set.pts, ...extra], p, tol);
}

/**
 * Fangspur (Tracking): waagrecht/senkrecht an explizit erfassten Referenzpunkten ausrichten.
 * Ein Punkt rastet die Achse ein, zwei Punkte schneiden sich aus verschiedenen Referenzen.
 * Ohne Treffer in der Toleranz null.
 */
export function trackPoint(refs: Pt[], p: Pt, tol: number): { p: Pt; guides: AlignGuide[] } | null {
  if (!refs.length) return null;
  const r = alignToPts(refs, p, tol);
  return r.guides.length ? r : null;
}

function alignToPts(pts: Pt[], p: Pt, tol: number): { p: Pt; guides: AlignGuide[] } {
  let bx: { d: number; v: number; o: number } | null = null,
    by: { d: number; v: number; o: number } | null = null;
  const check = (q: Pt) => {
    const dx = Math.abs(q.x - p.x),
      dy = Math.abs(q.y - p.y);
    if (dx <= tol && (!bx || dx < bx.d)) bx = { d: dx, v: q.x, o: q.y };
    if (dy <= tol && (!by || dy < by.d)) by = { d: dy, v: q.y, o: q.x };
  };
  pts.forEach(check);
  const out = { x: p.x, y: p.y };
  const guides: AlignGuide[] = [];
  const gx = bx as { v: number; o: number } | null,
    gy = by as { v: number; o: number } | null;
  if (gx) out.x = gx.v;
  if (gy) out.y = gy.v;
  if (gx) guides.push({ axis: 'x', v: gx.v, a: gx.o, b: out.y });
  if (gy) guides.push({ axis: 'y', v: gy.v, a: gy.o, b: out.x });
  return { p: out, guides };
}

/**
 * Polarfang: 45°-Strahlen (POLAR_STEP) von Ankern. Rastet ein, wenn der Lot-Abstand des
 * Cursors zum Strahl ≤ tol ist und der Cursor vorwärts (in Strahlrichtung) liegt.
 * Hinter dem Anker und bei Anker == Cursor gibt es keinen Fang. Nächster Strahl
 * (kleinster Lot-Abstand) gewinnt, Gleichstand: früherer Anker.
 */
export const POLAR_STEP = Math.PI / 4;
/** Alle Polarstrahlen aller Anker (Reihenfolge der Anker); snapToPolar wählt den besten. */
export function snapToAllPolar(anchors: Pt[], p: Pt, tol: number, step = POLAR_STEP): { p: Pt; guide: AlignGuide; d: number }[] {
  const out: { p: Pt; guide: AlignGuide; d: number }[] = [];
  for (const a of anchors) {
    const vx = p.x - a.x, vy = p.y - a.y;
    const L = Math.hypot(vx, vy);
    if (!(L > 1e-9)) continue;
    const ang = Math.atan2(vy, vx);
    const k = Math.round(ang / step);
    const dev = ang - k * step;
    const fwd = L * Math.cos(dev), perp = Math.abs(L * Math.sin(dev));
    if (!(fwd > 0) || perp > tol) continue;
    const dx = Math.cos(k * step), dy = Math.sin(k * step);
    const q = { x: a.x + dx * fwd, y: a.y + dy * fwd };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    out.push({ p: q, guide: { axis: 'seg', a: { x: a.x, y: a.y }, b: q }, d });
  }
  return out;
}
export function snapToPolar(anchors: Pt[], p: Pt, tol: number, step = POLAR_STEP): { p: Pt; guide: AlignGuide } | null {
  let best: { p: Pt; guide: AlignGuide; d: number } | null = null;
  for (const c of snapToAllPolar(anchors, p, tol, step)) {
    if (best && !(c.d < best.d - 1e-9)) continue;
    best = c;
  }
  return best;
}

/** Laufende Hover-Dwell-Beobachtung für gemerkte Tracking-Punkte (Editor-Feld, Weltkoordinaten) */
export interface TrackDwell { p: Pt; since: number }
/**
 * Hover-Dwell (rein, für Tests): derselbe exakte Treffer ≥ dwellMs lang gehalten → acquire.
 * Wegbewegen (anderer Punkt oder kein Treffer) setzt zurück; nach acquire neu halten nötig.
 */
export function trackDwellNext(prev: TrackDwell | null, hit: Pt | null, now: number, dwellMs = 500, eps = 1e-9): { acquire: Pt | null; next: TrackDwell | null } {
  if (!hit) return { acquire: null, next: null };
  if (prev && Math.hypot(hit.x - prev.p.x, hit.y - prev.p.y) <= eps) {
    if (now - prev.since >= dwellMs) return { acquire: { x: hit.x, y: hit.y }, next: null };
    return { acquire: null, next: prev };
  }
  return { acquire: null, next: { p: { x: hit.x, y: hit.y }, since: now } };
}

/**
 * Winkel-Projektion: Strahl vom Anker durch p als Führung, um `extra` (Welt-mm) verlängert.
 * Der Anker bleibt Anfang, der Endpunkt liegt auf dem Strahl.
 */
export function angleGuide(anchor: Pt, p: Pt, extra = 0): Extract<AlignGuide, { axis: 'seg' }> {
  const dx = p.x - anchor.x,
    dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  const a = { x: anchor.x, y: anchor.y };
  if (!(len > 1e-9)) return { axis: 'seg', a, b: { ...a } };
  const k = (len + extra) / len;
  return { axis: 'seg', a, b: { x: anchor.x + dx * k, y: anchor.y + dy * k } };
}

/**
 * Verlängerungslinie: Fang auf die geradlinige Fortsetzung gerader Stücke jenseits ihrer Endpunkte.
 * Punkte auf der Strecke selbst sind Sache des Linienfangs und zählen nicht; Kurvennäherungen
 * und Hilfslinien (nicht gerade Stücke) haben keine Verlängerung. Die Führung läuft vom
 * näheren Endpunkt zum Fangpunkt. Standard-Reichweite: 32× Toleranz jenseits des Endpunkts
 * (bildschirmkonstant, da tol in Welt-mm bereits durch Zoom geteilt ist) — 8× war im
 * Praxistest zu kurz, der Fang griff erst direkt am Endpunkt.
 */
export const EXT_REACH_MULT = 32;
/**
 * Seitliche Fangbreite für Verlängerungslinien als Vielfaches der Fangtoleranz.
 * Längs bleibt die Reichweite EXT_REACH_MULT × tol; bildschirmkonstant, weil tol bereits
 * Welt-mm pro Fangpixel ist (snapTol / zoom). Fangspur und Polarstrahlen bleiben bewusst
 * bei 1× tol: Aufweiten würde dort gesperrten Regressionstests widersprechen
 * (scripts/sketch-test.ts erwartet bei 2× tol keinen Fang) — siehe snapping.ts.
 */
export const PROJ_CORRIDOR_MULT = 3;
/** Alle Verlängerungs-Treffer (Stück-Reihenfolge); snapToExtension wählt den besten. */
export function snapToAllExtensions(
  set: SnapSet,
  p: Pt,
  tol: number,
  maxExt = EXT_REACH_MULT * tol,
): { p: Pt; guide: AlignGuide; d: number; ext: number }[] {
  const out: { p: Pt; guide: AlignGuide; d: number; ext: number }[] = [];
  for (const s of set.pieces) {
    if (!s.straight) continue;
    const vx = s.bx - s.ax,
      vy = s.by - s.ay;
    const l2 = vx * vx + vy * vy;
    if (!(l2 > 1e-18)) continue;
    const t = ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / l2;
    if (t >= 0 && t <= 1) continue;
    const ext = (t < 0 ? -t : t - 1) * Math.sqrt(l2);
    if (ext > maxExt) continue;
    const q = { x: s.ax + vx * t, y: s.ay + vy * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > tol) continue;
    out.push({ p: q, guide: { axis: 'seg', a: t < 0 ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by }, b: q }, d, ext });
  }
  return out;
}
export function snapToExtension(set: SnapSet, p: Pt, tol: number, maxExt = EXT_REACH_MULT * tol): { p: Pt; guide: AlignGuide } | null {
  let best: { p: Pt; guide: AlignGuide; d: number; ext: number } | null = null;
  for (const c of snapToAllExtensions(set, p, tol, maxExt)) {
    if (best && (c.d > best.d + 1e-9 || (Math.abs(c.d - best.d) <= 1e-9 && c.ext >= best.ext))) continue;
    best = c;
  }
  return best && { p: best.p, guide: best.guide };
}

/**
 * Begrenzung der bewegten Auswahl an Kanten und Mitten anderer Objekte ausrichten (Alt beim Verschieben).
 * Liefert die Korrektur und die anzuzeigenden Hilfslinien.
 */
export function alignBox(set: SnapSet, b: Box, tol: number): { dx: number; dy: number; guides: AlignGuide[] } {
  const own = (o: number, w: number) => [o, o + w / 2, o + w];
  let best: { x?: { d: number; v: number; o: Box }; y?: { d: number; v: number; o: Box } } = {};
  const ox = own(b.x, b.w),
    oy = own(b.y, b.h);
  for (const o of set.boxes) {
    for (const v of own(o.x, o.w))
      for (const s of ox) {
        const d = v - s;
        if (Math.abs(d) <= tol && (!best.x || Math.abs(d) < Math.abs(best.x.d))) best.x = { d, v, o };
      }
    for (const v of own(o.y, o.h))
      for (const s of oy) {
        const d = v - s;
        if (Math.abs(d) <= tol && (!best.y || Math.abs(d) < Math.abs(best.y.d))) best.y = { d, v, o };
      }
  }
  const dx = best.x?.d ?? 0,
    dy = best.y?.d ?? 0;
  const guides: AlignGuide[] = [];
  if (best.x) {
    const o = best.x.o;
    guides.push({ axis: 'x', v: best.x.v, a: Math.min(o.y, b.y + dy), b: Math.max(o.y + o.h, b.y + dy + b.h) });
  }
  if (best.y) {
    const o = best.y.o;
    guides.push({ axis: 'y', v: best.y.v, a: Math.min(o.x, b.x + dx), b: Math.max(o.x + o.w, b.x + dx + b.w) });
  }
  return { dx, dy, guides };
}

/** Schnittpunkt zweier Projektions-Führungen mit ihren Guide-Indizes (zur Auswahl). */
export interface GuideIntersection {
  p: Pt;
  i: number;
  j: number;
}

/** Führung als Strecke lesen (x/y als senkrechtes/waagrechtes Stück, seg direkt); entartet → null. */
function guideSeg(g: AlignGuide): { ax: number; ay: number; bx: number; by: number } | null {
  const a = g.axis === 'seg' ? g.a : g.axis === 'x' ? { x: g.v, y: g.a } : { x: g.a, y: g.v };
  const b = g.axis === 'seg' ? g.b : g.axis === 'x' ? { x: g.v, y: g.b } : { x: g.b, y: g.v };
  if (!(Math.hypot(b.x - a.x, b.y - a.y) > 1e-12)) return null;
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

/**
 * Paarweise Schnitte aller Projektions-Führungen (Fangspur-/Winkel-/Verlängerungs-Guides).
 * Nur echte Streckenschnitte: Der Schnitt muss auf BEIDEN Segmenten liegen (je um `reach`
 * Welt-mm über die Enden hinaus geduldet, Standard 0) — Schnitte unendlicher Geraden zählen
 * nicht. Parallele/kollineare und entartete Führungen liefern nichts. Epsilon-stabil;
 * Ergebnis nach (Guide-Index i, j) sortiert — deterministisch für Gleichstands-Regeln.
 */
export function guideIntersections(guides: AlignGuide[], reach = 0): GuideIntersection[] {
  const segs: { ax: number; ay: number; bx: number; by: number; k: number }[] = [];
  guides.forEach((g, k) => {
    const s = guideSeg(g);
    if (s) segs.push({ ...s, k });
  });
  const out: GuideIntersection[] = [];
  for (let x = 0; x < segs.length; x++)
    for (let y = x + 1; y < segs.length; y++) {
      const s = segs[x],
        t = segs[y];
      const rx = s.bx - s.ax,
        ry = s.by - s.ay,
        qx = t.bx - t.ax,
        qy = t.by - t.ay;
      const rl = Math.hypot(rx, ry),
        ql = Math.hypot(qx, qy);
      if (!(rl > 0) || !(ql > 0)) continue;
      const den = rx * qy - ry * qx;
      if (Math.abs(den) <= 1e-12 * rl * ql) continue; // parallel/kollinear
      const ox = t.ax - s.ax,
        oy = t.ay - s.ay;
      const u = (ox * qy - oy * qx) / den;
      const v = (ox * ry - oy * rx) / den;
      const eu = reach / rl + 1e-9,
        ev = reach / ql + 1e-9;
      if (u < -eu || u > 1 + eu || v < -ev || v > 1 + ev) continue;
      out.push({ p: { x: s.ax + rx * u, y: s.ay + ry * u }, i: s.k, j: t.k });
    }
  out.sort((a, b) => a.i - b.i || a.j - b.j);
  return out;
}
