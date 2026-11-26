// Reine Logik des CAD-Seitenmenüs der Skizze (DOM-frei, testbar): Linientypen,
// Sichtbarkeitsfilter, Solver-Status mit Fortschritt, Einpass-BBox, Fangschalter.
// Darf nichts aus editor/ oder DOM importieren (sonst läuft es nicht unter run-ts).
import { apply, type Mat, type Pt } from '../model';
import { t } from '../i18n';
import { isConstructionGeometry, type Sketch, type SkEnt } from './model';

/** Linientyp des Seitenmenüs: Normal, Konstruktion (aux), Mittellinie, Unendlich. */
export type SketchLineType = 'normal' | 'construction' | 'centerline' | 'infinite';
export const SKETCH_LINE_TYPES: SketchLineType[] = ['normal', 'construction', 'centerline', 'infinite'];

export { isConstructionGeometry };

export interface SketchLineTypeResult { applied: number[]; skipped: number[]; }
/**
 * Linientyp auf Entities anwenden. Mittellinie/Unendlich brauchen Linien
 * (andere Entities landen in skipped für den Hinweis); Normal und Konstruktion
 * wirken auf alle gewählten Entities. aux wird nie heimlich umgedeutet.
 */
export function setSketchLineType(sk: Sketch, ids: Iterable<number>, type: SketchLineType): SketchLineTypeResult {
  const applied: number[] = [], skipped: number[] = [];
  for (const id of ids) {
    const e = sk.ents.find((x) => x.id === id);
    if (!e) { skipped.push(id); continue; }
    if (type === 'normal') {
      delete e.aux;
      if (e.t === 'line') { delete e.centerline; delete e.infinite; }
      applied.push(id);
    } else if (type === 'construction') {
      e.aux = true;
      if (e.t === 'line') { delete e.centerline; delete e.infinite; }
      applied.push(id);
    } else if (e.t !== 'line') {
      skipped.push(id);
    } else if (type === 'centerline') {
      e.centerline = true;
      delete e.infinite;
      applied.push(id);
    } else {
      e.infinite = true;
      delete e.centerline;
      applied.push(id);
    }
  }
  return { applied, skipped };
}

/** Zeichenmodus für neue Linien (Konstruktion läuft weiter über drawAux). */
export type SketchDrawLine = 'normal' | 'centerline' | 'infinite';
/** Zeichenmodus auf eine frisch gezeichnete Linie anwenden (nur Linien, kein aux-Ersatz). */
export function applyDrawLineKind(e: SkEnt, drawLine: SketchDrawLine, drawAux: boolean): void {
  if (e.t !== 'line' || drawAux || drawLine === 'normal') return;
  if (drawLine === 'centerline') { e.centerline = true; delete e.infinite; }
  else { e.infinite = true; delete e.centerline; }
}

/** Sichtbarkeitsschalter des Seitenmenüs: reine Anzeige, alles Standard an. */
export interface SketchVisibility { relations: boolean; dims: boolean; points: boolean; construction: boolean }
export const DEFAULT_SKETCH_VISIBILITY: SketchVisibility = { relations: true, dims: true, points: true, construction: true };
/** Session-Flags (undefined = ältere Sitzung) fallen auf sichtbar zurück. */
export const sketchVisibilityOf = (s: { showRelations?: boolean; showDims?: boolean; showPoints?: boolean; showConstruction?: boolean }): SketchVisibility => ({
  relations: s.showRelations !== false,
  dims: s.showDims !== false,
  points: s.showPoints !== false,
  construction: s.showConstruction !== false,
});
/** Einzelnes Element sichtbar? Punkte regelt der points-Schalter am Aufrufort. */
export const isEntVisible = (e: SkEnt, vis: SketchVisibility): boolean =>
  vis.construction || !isConstructionGeometry(e);

/** Fangschalter der Skizze (Session-Flag, Standard an). */
export const sketchSnapActive = (s: { sketchSnap?: boolean }): boolean => s.sketchSnap !== false;

export type SketchStatusKind = 'empty' | 'unevaluated' | 'conflict' | 'full' | 'free' | 'position';
export interface SketchStatusInfo { kind: SketchStatusKind; text: string; dof: number | null; progress: number | null }
/**
 * Solver-Status für die persistente Anzeige (Zahl = Solver-DOF).
 * Fortschritt 1−Rest/Start; ohne Start-Basis (Sitzungsbeginn) kein Balken,
 * nie erfundene Prozente.
 *
 * `trialDof` beantwortet probeweise, wie viele DOF übrig blieben, wenn ein
 * Punkt fixiert wäre (Klon + fixed-Bindung + Solve, kein Modell-Touch; der
 * Aufrufer baut die Probe). Liefert sie 0, ist nur starre Lage frei (Form
 * bestimmt). Der Trial-Solve läuft nur bei DOF 1..3: Ein starrer Körper hat
 * in der Ebene höchstens 3 Freiheitsgrade (x, y, Drehung); bei mehr DOF ist
 * die Form sicher noch frei und die Probe (voller Solver-Lauf auf einem Klon)
 * wäre reine Verschwendung. Schlägt die Probe fehl (Ausnahme/null), fällt der
 * Text auf den bisherigen zurück — nie lügen.
 */
export function sketchStatusInfo(
  sk: Sketch,
  status: { ok: boolean; dof: number; conflicting: readonly number[] } | null,
  startDof: number | null,
  trialDof?: () => number | null,
): SketchStatusInfo {
  if (!sk.ents.length) return { kind: 'empty', text: t('Noch keine Geometrie'), dof: null, progress: null };
  if (!status) return { kind: 'unevaluated', text: t('Noch nicht ausgewertet'), dof: null, progress: null };
  const progress = startDof !== null && startDof > 0
    ? Math.min(1, Math.max(0, 1 - status.dof / startDof))
    : null;
  if (!status.ok || status.conflicting.length) return { kind: 'conflict', text: t('Konflikt'), dof: status.dof, progress };
  if (status.dof === 0) return { kind: 'full', text: t('Vollständig bestimmt'), dof: 0, progress };
  if (status.dof >= 1 && status.dof <= 3 && trialDof) {
    try {
      if (trialDof() === 0) return { kind: 'position', text: t('Form bestimmt · Lage frei · {n} Freiheitsgrade', { n: status.dof }), dof: status.dof, progress };
    } catch {
      // Probe gescheitert (Löser nicht bereit, Geometriefehler): Fallback unten.
    }
  }
  return { kind: 'free', text: t('Unterbestimmt · {n} Freiheitsgrade', { n: status.dof }), dof: status.dof, progress };
}

export interface SketchBox { x: number; y: number; w: number; h: number }
/** Welt-BBox aller Skizzenpunkte (für „Skizze einpassen"), null bei leerer Skizze. */
export function sketchWorldBounds(sk: Sketch, m: Mat): SketchBox | null {
  if (!sk.pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sk.pts) {
    const w = apply(m, p.x, p.y);
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

export interface SketchClipRect { minX: number; minY: number; maxX: number; maxY: number }
/**
 * Unendliche Linie (durch a/b) ans sichtbare Rechteck klippen (Liang–Barsky),
 * mit kleiner Marge übers Rechteck hinaus. Null bei entarteter Richtung.
 */
export function infiniteLineEnds(a: Pt, b: Pt, rect: SketchClipRect): [Pt, Pt] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!(Math.hypot(dx, dy) > 1e-9)) return null;
  let t0 = -Infinity, t1 = Infinity;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, a.x - rect.minX) || !clip(dx, rect.maxX - a.x)
    || !clip(-dy, a.y - rect.minY) || !clip(dy, rect.maxY - a.y)) return null;
  if (!(t1 > t0)) return null;
  // Kleine Marge über den Ausschnitt hinaus (Länge in Skizzeneinheiten).
  const m = 8 / Math.hypot(dx, dy);
  return [{ x: a.x + (t0 - m) * dx, y: a.y + (t0 - m) * dy }, { x: a.x + (t1 + m) * dx, y: a.y + (t1 + m) * dy }];
}
