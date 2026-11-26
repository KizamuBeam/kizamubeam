// Muster-Bauoperationen, Phase 1 (rein, UI-frei, ohne Solver).
// Verhalten nach docs/muster-neubau-funktionsbeschreibung.md und -umsetzungsplan.md.
// Kopien sind bewusst reine Geometrie ohne Constraints: starre Kopie der Quellen,
// Nachführung erfolgt ausschließlich über updatePattern (keine Solver-Bindung).
import type { Pt } from '../model';
import type { SketchPattern, PatternInstance, PatternAlignment, PatternExpressionKey } from './pattern';
import {
  MAX_PATTERN_COPIES,
  asWholeCount,
  validCircularCount,
  validRectangularCount,
  validRectangularProduct,
  validPatternAngle,
  validPatternSpacing,
  validPatternSpacingForCount,
  validPatternExpression,
} from './pattern';
import {
  addPt,
  addLine,
  addCircle,
  addEllipse,
  addArc,
  addPoint,
  addCon,
  ptOf,
  entOf,
  entPoints,
  deleteIds,
  isConstructionGeometry,
  type Sketch,
  type SkEnt,
  type SkPt,
} from './model';

/** Bau-Ergebnis: Muster (Geometrie + patterns-Eintrag in sk) oder deutsche Fehlermeldung. */
export type PatternBuildResult = { pattern: SketchPattern } | { error: string };

/** Spiegel-Ergebnis: genau eine Kopie, KEIN Muster-Objekt. */
export type MirrorBuildResult = { curves: number[]; points: number[] } | { error: string };

export interface CircularBuildParams {
  entities: number[];
  center: number | Pt;
  count: number;
  angle?: number;
  alignment?: PatternAlignment;
  reversed?: boolean;
  /** Verlinkte Ausdruckstexte (werden validiert und am Muster gespeichert, nicht ausgewertet) */
  expressions?: Partial<Record<PatternExpressionKey, string>>;
}

export interface RectangularBuildParams {
  entities: number[];
  count: number;
  spacing: number;
  count2?: number;
  spacing2?: number;
  dir?: Pt;
  dir2?: Pt | null;
  direction?: number;
  direction2?: number;
  alignment?: PatternAlignment;
  alignment2?: PatternAlignment;
  reversed?: boolean;
  reversed2?: boolean;
  /** Verlinkte Ausdruckstexte (werden validiert und am Muster gespeichert, nicht ausgewertet) */
  expressions?: Partial<Record<PatternExpressionKey, string>>;
}

export interface MirrorParams {
  entities: number[];
  line: number;
}

export interface CircularUpdateParams {
  type: 'circular';
  entities?: number[];
  center?: number | Pt;
  count?: number;
  angle?: number;
  alignment?: PatternAlignment;
  reversed?: boolean;
  expressions?: Partial<Record<PatternExpressionKey, string>>;
}

export interface RectangularUpdateParams {
  type: 'rectangular';
  entities?: number[];
  count?: number;
  spacing?: number;
  count2?: number;
  spacing2?: number;
  dir?: Pt;
  dir2?: Pt | null;
  direction?: number | null;
  direction2?: number | null;
  alignment?: PatternAlignment;
  alignment2?: PatternAlignment;
  reversed?: boolean;
  reversed2?: boolean;
  expressions?: Partial<Record<PatternExpressionKey, string>>;
}

export type UpdatePatternParams = CircularUpdateParams | RectangularUpdateParams;

type Seed = { ents: SkEnt[]; entIds: number[]; bare: SkPt[] };

/** Obergrenze neuer Kopie-Koordinaten (Spec §6: Kopie außerhalb des Koordinatenbereichs). */
const MAX_BUILD_COORD = 1e6;
const COORD_RANGE_ERROR = 'Kopie außerhalb des Koordinatenbereichs.';

const hasError = (v: unknown): v is { error: string } =>
  !!v && typeof v === 'object' && typeof (v as { error?: unknown }).error === 'string';

const isAlign = (v: unknown): v is PatternAlignment => v === 'left' || v === 'center' || v === 'right';

const isFiniteVec = (v: unknown): v is Pt =>
  !!v && typeof v === 'object' &&
  typeof (v as Pt).x === 'number' && typeof (v as Pt).y === 'number' &&
  isFinite((v as Pt).x) && isFinite((v as Pt).y);

const sameIdList = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Alle Kopie-ids (Kurven + Kopiepunkte) aller Muster: Quellen dürfen nie darunter sein. */
function collectCopyIds(sk: Sketch): Set<number> {
  const out = new Set<number>();
  for (const p of sk.patterns ?? []) {
    for (const inst of p.instances) {
      for (const c of inst.curves) out.add(c);
      for (const pair of inst.points) out.add(pair[1]);
    }
  }
  return out;
}

/**
 * Quellen prüfen: existent, keine Hilfsgeometrie, kein Mitglied eines Musters.
 * Punkt-Ents (t: 'point') und nackte Skizzenpunkte sind als Quelle erlaubt.
 */
function validateSources(sk: Sketch, entities: unknown): Seed | { error: string } {
  if (!Array.isArray(entities) || entities.length === 0) {
    return { error: 'Ausgangsform fehlt: zuerst Elemente wählen.' };
  }
  const ids: number[] = [];
  for (const id of entities) {
    if (typeof id !== 'number' || !ids.includes(id)) ids.push(id);
  }
  if (!ids.length || !ids.every((id) => typeof id === 'number')) {
    return { error: 'Ausgangsform fehlt: zuerst Elemente wählen.' };
  }
  const copies = collectCopyIds(sk);
  const seed: Seed = { ents: [], entIds: [], bare: [] };
  for (const id of ids) {
    if (copies.has(id)) {
      return { error: 'Ausgangsform darf keine Kopie eines Musters enthalten (kein Selbst-Seed).' };
    }
    const e = entOf(sk, id);
    if (e) {
      if (isConstructionGeometry(e)) {
        return { error: 'Ausgangsform darf keine Hilfsgeometrie enthalten.' };
      }
      seed.ents.push(e);
      seed.entIds.push(id);
      continue;
    }
    const p = ptOf(sk, id);
    if (p) {
      seed.bare.push(p);
      continue;
    }
    return { error: `Ausgangsform ${id} ist unbekannt oder gelöscht.` };
  }
  return seed;
}

/** Mittelpunkt-Parameter prüfen (Anlage {x,y} wird erst in der Bau-Phase materialisiert). */
const CIRCULAR_EXPR_KEYS: readonly PatternExpressionKey[] = ['count', 'angle'];
const RECT_EXPR_KEYS: readonly PatternExpressionKey[] = ['count', 'count2', 'spacing', 'spacing2'];

/** Verlinkte Ausdruckstexte prüfen (Schlüssel-Whitelist + Text-Regel); Fehler → keine Mutation. */
function validateExpressions(params: { expressions?: unknown }, allowed: readonly PatternExpressionKey[]): Partial<Record<PatternExpressionKey, string>> | { error: string } {
  const raw = params.expressions;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Ausdrücke sind ungültig (erwartet Text wie „Anzahl: n“).' };
  }
  const out: Partial<Record<PatternExpressionKey, string>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(allowed as readonly string[]).includes(key) || !validPatternExpression(key, value)) {
      return { error: `Ausdruck für „${key}“ ist ungültig (Projekt-Parameter, 1…4096 Zeichen).` };
    }
    out[key as PatternExpressionKey] = value as string;
  }
  return out;
}

/** Geprüfte Ausdrücke übernehmen (leer → Schlüssel entfernen). */
function applyExpressions(existing: SketchPattern, expressions: Partial<Record<PatternExpressionKey, string>>) {
  if (Object.keys(expressions).length) existing.expressions = expressions;
  else delete existing.expressions;
}

function validateCenterParam(sk: Sketch, center: unknown): { kind: 'id'; id: number } | { kind: 'pt'; x: number; y: number } | { error: string } {
  if (typeof center === 'number') {
    return ptOf(sk, center)
      ? { kind: 'id', id: center }
      : { error: 'Mittelpunkt ist unbekannt oder gelöscht: zuerst einen Mittelpunkt wählen.' };
  }
  if (isFiniteVec(center)) return { kind: 'pt', x: center.x, y: center.y };
  return { error: 'Mittelpunkt ist ungültig: Skizzenpunkt oder freie Lage {x, y} wählen.' };
}

/** Freiraum-Mittelpunkt anlegen (fixiert, kein Bildschirm-Artefakt). */
function materializeCenter(sk: Sketch, c: { x: number; y: number }): number {
  const p = addPt(sk, c.x, c.y);
  addCon(sk, 'fixed', [p.id], { x: c.x, y: c.y });
  return p.id;
}

/** Slot-Multiplikator je Ausrichtung: rechts n, links −n, zentriert 0,+1,−1,+2,−2,…; umgekehrt negiert. */
function alignMult(i: number, alignment: PatternAlignment, reversed: boolean): number {
  const m = alignment === 'center' ? (i % 2 === 0 ? -i / 2 : Math.ceil(i / 2)) : alignment === 'left' ? -i : i;
  return reversed ? -m : m;
}

type Transform = (p: Pt) => Pt;

const rotateAbout = (c: Pt, deg: number): Transform => {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return (p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos });
};

const translateBy = (dx: number, dy: number): Transform => (p) => ({ x: p.x + dx, y: p.y + dy });

const mirrorAcross = (a: Pt, b: Pt): Transform => {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  return (p) => {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const fx = a.x + t * dx, fy = a.y + t * dy;
    return { x: 2 * fx - p.x, y: 2 * fy - p.y };
  };
};

/** Eine Quelle starr kopieren (flip: Spiegelung kehrt Bogen-Orientierung um → s/e tauschen). */
function copyEnt(sk: Sketch, src: SkEnt, map: Map<number, number>, flip: boolean): SkEnt {
  const at = (id: number): number => map.get(id) as number;
  switch (src.t) {
    case 'line': return addLine(sk, at(src.a), at(src.b));
    case 'circle': return addCircle(sk, at(src.c), src.r);
    case 'ellipse': return addEllipse(sk, at(src.c), at(src.m), src.r);
    case 'point': return addPoint(sk, at(src.p));
    case 'arc': {
      const nc = at(src.c), ns = at(src.s), ne = at(src.e);
      // addArc bestimmt Radius und Winkel (a0 < a1) per atan2 aus der neuen Geometrie neu.
      return flip ? addArc(sk, nc, ne, ns) : addArc(sk, nc, ns, ne);
    }
  }
}

/** Alle Quellpunkte je Slot transformiert neu anlegen, Ents mappen; Punktepaare [Quelle, Kopie]. */
function buildInstances(
  sk: Sketch, seed: Seed, indices: [number, number][],
  transformOf: (index: [number, number]) => Transform, flip: boolean,
): PatternInstance[] {
  const instances: PatternInstance[] = [];
  for (const index of indices) {
    const move = transformOf(index);
    const need: number[] = [];
    for (const e of seed.ents) for (const pid of entPoints(e)) if (!need.includes(pid)) need.push(pid);
    for (const p of seed.bare) if (!need.includes(p.id)) need.push(p.id);
    const map = new Map<number, number>();
    for (const pid of need) {
      const src = ptOf(sk, pid) as SkPt;
      const np = move(src);
      map.set(pid, addPt(sk, np.x, np.y).id);
    }
    const points: [number, number][] = need.map((pid) => [pid, map.get(pid) as number]);
    const curves: number[] = seed.ents.map((e) => copyEnt(sk, e, map, flip).id);
    instances.push({ index, curves, points });
  }
  return instances;
}

/** Alle Zielpunkte endlich und im Koordinatenbereich? (rein lesend, ohne Mutation) */
function copyTargetsValid(
  sk: Sketch, seed: Seed, indices: [number, number][],
  transformOf: (index: [number, number]) => Transform,
): boolean {
  const need: number[] = [];
  for (const e of seed.ents) for (const pid of entPoints(e)) if (!need.includes(pid)) need.push(pid);
  for (const p of seed.bare) if (!need.includes(p.id)) need.push(p.id);
  for (const index of indices) {
    const move = transformOf(index);
    for (const pid of need) {
      const s = ptOf(sk, pid);
      if (!s) return false;
      const np = move(s);
      if (!isFinite(np.x) || !isFinite(np.y) || Math.abs(np.x) > MAX_BUILD_COORD || Math.abs(np.y) > MAX_BUILD_COORD) return false;
    }
  }
  return true;
}

/** Quellen aus einem Muster-Eintrag auflösen (still); null bei fehlender Quelle. */
function seedOfPattern(sk: Sketch, entities: number[]): Seed | null {
  const seed: Seed = { ents: [], entIds: [], bare: [] };
  for (const id of entities) {
    const e = entOf(sk, id);
    if (e) { seed.ents.push(e); seed.entIds.push(id); continue; }
    const p = ptOf(sk, id);
    if (p) { seed.bare.push(p); continue; }
    return null;
  }
  return seed;
}

/** Kopie-ids einer Instanz (Kurven + exklusive Kopiepunkte) zum Löschen sammeln. */
function instanceIds(inst: PatternInstance): number[] {
  return [...inst.curves, ...inst.points.map((pair) => pair[1])];
}

function freshPatternId(sk: Sketch, wanted?: string): string | { error: string } {
  if (wanted !== undefined) {
    if (!wanted) return { error: 'Muster-Kennung ist ungültig.' };
    if ((sk.patterns ?? []).some((p) => p.id === wanted)) return { error: 'Muster-Kennung ist bereits vergeben.' };
    return wanted;
  }
  let candidate = `p${sk.next++}`;
  while ((sk.patterns ?? []).some((p) => p.id === candidate)) candidate = `p${sk.next++}`;
  return candidate;
}

function pushPattern(sk: Sketch, pattern: SketchPattern): void {
  if (!sk.patterns) sk.patterns = [];
  sk.patterns.push(pattern);
}

/** Achsenvektor auflösen: lebende Linien-Referenz schlägt festen Vektor; Ergebnis normiert. */
function resolveAxisVector(
  sk: Sketch, label: string, fixed: Pt | null | undefined, ref: number | undefined, fallback: Pt,
): { vec: Pt } | { error: string } {
  if (ref !== undefined && ref !== null) {
    const e = entOf(sk, ref);
    const a = e?.t === 'line' ? ptOf(sk, e.a) : undefined;
    const b = e?.t === 'line' ? ptOf(sk, e.b) : undefined;
    if (!e || e.t !== 'line' || !a || !b) {
      return { error: `Richtung ${label} ist unbekannt oder keine gerade Linie.` };
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-9) || !isFinite(len)) return { error: `Richtung ${label} ist entartet (Länge 0).` };
    return { vec: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
  }
  const v = fixed ?? fallback;
  if (!isFiniteVec(v)) return { error: `Richtung ${label} ist ungültig.` };
  const len = Math.hypot(v.x, v.y);
  if (!(len > 1e-9)) return { error: `Richtung ${label} ist entartet (Länge 0).` };
  return { vec: { x: v.x / len, y: v.y / len } };
}

interface CircularSlots {
  seed: Seed;
  count: number;
  angle: number;
  alignment: PatternAlignment;
  reversed: boolean;
  center: { kind: 'id'; id: number } | { kind: 'pt'; x: number; y: number };
  expressions: Partial<Record<PatternExpressionKey, string>>;
}

/** Kreis-Parameter vollständig prüfen (ohne Mutation); Fehler → keine Mutation. */
function validateCircular(sk: Sketch, params: {
  entities: unknown; center: unknown; count: unknown; angle?: unknown; alignment?: unknown; reversed?: unknown;
  expressions?: unknown;
}): CircularSlots | { error: string } {
  const alignment = params.alignment ?? 'right';
  if (!isAlign(alignment)) return { error: 'Ausrichtung ist ungültig (links, zentriert oder rechts).' };
  const reversed = params.reversed ?? false;
  if (typeof reversed !== 'boolean') return { error: 'Ausrichtung ist ungültig (links, zentriert oder rechts).' };
  const seed = validateSources(sk, params.entities);
  if (hasError(seed)) return seed;
  if (!validCircularCount(params.count)) {
    return { error: 'Anzahl muss ganzzahlig zwischen 2 und 500 liegen (Original eingeschlossen).' };
  }
  const count = Math.round(params.count as number);
  const angle = params.angle ?? 360;
  if (!validPatternAngle(angle)) return { error: 'Winkel muss ungleich 0° und höchstens 360° sein.' };
  const center = validateCenterParam(sk, params.center);
  if (hasError(center)) return center;
  const expressions = validateExpressions(params, CIRCULAR_EXPR_KEYS);
  if (hasError(expressions)) return expressions;
  return { seed, count, angle: angle as number, alignment, reversed, center, expressions };
}

function circularTransforms(slots: CircularSlots, centerPt: Pt): (index: [number, number]) => Transform {
  const full = Math.abs(Math.abs(slots.angle) - 360) < 1e-9;
  const step = slots.angle / (full ? slots.count : slots.count - 1);
  return ([i]) => rotateAbout(centerPt, step * alignMult(i, slots.alignment, slots.reversed));
}

function circularIndices(count: number): [number, number][] {
  return Array.from({ length: count - 1 }, (_, k) => [k + 1, 0] as [number, number]);
}

export function buildCircularPattern(sk: Sketch, params: CircularBuildParams, id?: string): PatternBuildResult {
  const slots = validateCircular(sk, params);
  if (hasError(slots)) return slots;
  const indices = circularIndices(slots.count);
  const probeCenter = slots.center.kind === 'id' ? (ptOf(sk, slots.center.id) as SkPt) : { x: slots.center.x, y: slots.center.y };
  if (slots.center.kind === 'pt' && (Math.abs(slots.center.x) > MAX_BUILD_COORD || Math.abs(slots.center.y) > MAX_BUILD_COORD)) {
    return { error: COORD_RANGE_ERROR };
  }
  if (!copyTargetsValid(sk, slots.seed, indices, circularTransforms(slots, probeCenter))) {
    return { error: COORD_RANGE_ERROR };
  }
  const wanted = freshPatternId(sk, id);
  if (hasError(wanted)) return wanted;
  if (indices.length > MAX_PATTERN_COPIES) {
    return { error: 'Kopie-Budget überschritten: höchstens 500 Kopien je Muster.' };
  }
  // Ab hier: genau ein logischer Bau-Schritt (alle Prüfungen bestanden).
  const centerId = slots.center.kind === 'id' ? slots.center.id : materializeCenter(sk, slots.center);
  const centerPt = ptOf(sk, centerId) as SkPt;
  const instances = buildInstances(sk, slots.seed, indices, circularTransforms(slots, centerPt), false);
  const pattern: SketchPattern = {
    id: wanted,
    entities: slots.seed.entIds.concat(slots.seed.bare.map((p) => p.id)),
    kind: { type: 'circular', center: centerId, count: slots.count, angle: slots.angle, alignment: slots.alignment, reversed: slots.reversed },
    ...(Object.keys(slots.expressions).length ? { expressions: slots.expressions } : {}),
    instances,
  };
  pushPattern(sk, pattern);
  return { pattern };
}

interface RectangularSlots {
  seed: Seed;
  count: number;
  spacing: number;
  count2: number;
  spacing2: number;
  vec: Pt;
  vec2: Pt;
  direction?: number;
  direction2?: number;
  alignment: PatternAlignment;
  alignment2: PatternAlignment;
  reversed: boolean;
  reversed2: boolean;
  expressions: Partial<Record<PatternExpressionKey, string>>;
}

/** Rechteck-Parameter vollständig prüfen (ohne Mutation); Fehler → keine Mutation. */
function validateRectangular(sk: Sketch, params: {
  entities: unknown; count: unknown; spacing: unknown; count2?: unknown; spacing2?: unknown;
  dir?: unknown; dir2?: unknown; direction?: unknown; direction2?: unknown;
  alignment?: unknown; alignment2?: unknown; reversed?: unknown; reversed2?: unknown;
  expressions?: unknown;
}): RectangularSlots | { error: string } {
  const alignment = params.alignment ?? 'right';
  const alignment2 = params.alignment2 ?? 'right';
  if (!isAlign(alignment) || !isAlign(alignment2)) {
    return { error: 'Ausrichtung ist ungültig (links, zentriert oder rechts).' };
  }
  const reversed = params.reversed ?? false, reversed2 = params.reversed2 ?? false;
  if (typeof reversed !== 'boolean' || typeof reversed2 !== 'boolean') {
    return { error: 'Ausrichtung ist ungültig (links, zentriert oder rechts).' };
  }
  const seed = validateSources(sk, params.entities);
  if (hasError(seed)) return seed;
  const count = asWholeCount(params.count);
  if (!validRectangularCount(params.count)) {
    return { error: 'Anzahl (Richtung 1) muss ganzzahlig zwischen 1 und 500 liegen (Original eingeschlossen).' };
  }
  const count2 = params.count2 ?? 1;
  if (!validRectangularCount(count2)) {
    return { error: 'Anzahl (Richtung 2) muss ganzzahlig zwischen 1 und 500 liegen (Original eingeschlossen).' };
  }
  if (!validRectangularProduct(params.count, count2)) {
    return { error: 'Anzahlen ergeben mehr als 500 Kopien (Anzahl 1 × Anzahl 2 ≤ 500).' };
  }
  const spacing = params.spacing as number;
  if (!validPatternSpacing(spacing)) return { error: 'Abstand (Richtung 1) muss endlich sein (höchstens 1e6 mm).' };
  if (!validPatternSpacingForCount(spacing, params.count)) {
    return { error: 'Abstand (Richtung 1) muss ungleich 0 sein, wenn Anzahl größer als 1 ist.' };
  }
  const spacing2 = params.spacing2 ?? spacing;
  if (!validPatternSpacing(spacing2)) return { error: 'Abstand (Richtung 2) muss endlich sein (höchstens 1e6 mm).' };
  if (!validPatternSpacingForCount(spacing2, count2)) {
    return { error: 'Abstand (Richtung 2) muss ungleich 0 sein, wenn Anzahl größer als 1 ist.' };
  }
  const direction = params.direction === null ? undefined : params.direction as number | undefined;
  const direction2 = params.direction2 === null ? undefined : params.direction2 as number | undefined;
  if (direction !== undefined && typeof direction !== 'number') return { error: 'Richtung 1 ist unbekannt oder keine gerade Linie.' };
  if (direction2 !== undefined && typeof direction2 !== 'number') return { error: 'Richtung 2 ist unbekannt oder keine gerade Linie.' };
  const dir = params.dir === undefined ? { x: 1, y: 0 } : params.dir;
  if (!isFiniteVec(dir)) return { error: 'Richtung 1 ist ungültig.' };
  const v1 = resolveAxisVector(sk, '1', dir, direction, { x: 1, y: 0 });
  if (hasError(v1)) return v1;
  const perp: Pt = { x: -v1.vec.y, y: v1.vec.x };
  const v2 = resolveAxisVector(sk, '2', params.dir2 === undefined || params.dir2 === null ? null : params.dir2 as Pt, direction2, perp);
  if (hasError(v2)) return v2;
  const expressions = validateExpressions(params, RECT_EXPR_KEYS);
  if (hasError(expressions)) return expressions;
  return {
    seed, count: count as number, spacing, count2: count2 as number, spacing2,
    vec: v1.vec, vec2: v2.vec, direction, direction2,
    alignment, alignment2: alignment2 as PatternAlignment, reversed, reversed2,
    expressions,
  };
}

function rectangularIndices(count: number, count2: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) for (let j = 0; j < count2; j++) {
    if (i === 0 && j === 0) continue;
    out.push([i, j]);
  }
  return out;
}

interface RectangularTransformParams {
  vec: Pt; vec2: Pt; spacing: number; spacing2: number;
  alignment: PatternAlignment; alignment2: PatternAlignment;
  reversed: boolean; reversed2: boolean;
}

function rectangularTransforms(slots: RectangularTransformParams): (index: [number, number]) => Transform {
  return ([i, j]) => {
    const m1 = alignMult(i, slots.alignment, slots.reversed);
    const m2 = alignMult(j, slots.alignment2, slots.reversed2);
    return translateBy(
      slots.vec.x * slots.spacing * m1 + slots.vec2.x * slots.spacing2 * m2,
      slots.vec.y * slots.spacing * m1 + slots.vec2.y * slots.spacing2 * m2,
    );
  };
}

export function buildRectangularPattern(sk: Sketch, params: RectangularBuildParams, id?: string): PatternBuildResult {
  const slots = validateRectangular(sk, params);
  if (hasError(slots)) return slots;
  const indices = rectangularIndices(slots.count, slots.count2);
  if (!copyTargetsValid(sk, slots.seed, indices, rectangularTransforms(slots))) {
    return { error: COORD_RANGE_ERROR };
  }
  const wanted = freshPatternId(sk, id);
  if (hasError(wanted)) return wanted;
  if (indices.length > MAX_PATTERN_COPIES) {
    return { error: 'Kopie-Budget überschritten: höchstens 500 Kopien je Muster.' };
  }
  // Ab hier: genau ein logischer Bau-Schritt (alle Prüfungen bestanden).
  const instances = buildInstances(sk, slots.seed, indices, rectangularTransforms(slots), false);
  const pattern: SketchPattern = {
    id: wanted,
    entities: slots.seed.entIds.concat(slots.seed.bare.map((p) => p.id)),
    kind: {
      type: 'rectangular', count: slots.count, spacing: slots.spacing, count2: slots.count2, spacing2: slots.spacing2,
      dir: slots.vec, dir2: slots.vec2, alignment: slots.alignment, alignment2: slots.alignment2,
      reversed: slots.reversed, reversed2: slots.reversed2,
      ...(slots.direction !== undefined ? { direction: slots.direction } : {}),
      ...(slots.direction2 !== undefined ? { direction2: slots.direction2 } : {}),
    },
    ...(Object.keys(slots.expressions).length ? { expressions: slots.expressions } : {}),
    instances,
  };
  pushPattern(sk, pattern);
  return { pattern };
}

export function mirrorEntities(sk: Sketch, params: MirrorParams): MirrorBuildResult {
  const line = entOf(sk, params.line);
  // Konstruktionslinie ist als Spiegellinie ausdrücklich erlaubt (nur Hilfsgeometrie der Quellen ist verboten).
  if (!line || line.t !== 'line') return { error: 'Spiegellinie ist unbekannt oder keine gerade Linie.' };
  const a = ptOf(sk, line.a), b = ptOf(sk, line.b);
  if (!a || !b) return { error: 'Spiegellinie ist unbekannt oder keine gerade Linie.' };
  if (!(Math.hypot(b.x - a.x, b.y - a.y) > 1e-9)) return { error: 'Spiegellinie ist entartet (Länge 0).' };
  const picked = Array.isArray(params.entities) ? params.entities.filter((e) => e !== params.line) : [];
  if (!picked.length) return { error: 'Ausgangsform fehlt: die Spiegellinie selbst wird nicht kopiert.' };
  const seed = validateSources(sk, picked);
  if (hasError(seed)) return seed;
  if (!copyTargetsValid(sk, seed, [[0, 0]], () => mirrorAcross(a, b))) {
    return { error: COORD_RANGE_ERROR };
  }
  // Ab hier: genau ein logischer Bau-Schritt (alle Prüfungen bestanden).
  const [inst] = buildInstances(sk, seed, [[0, 0]], () => mirrorAcross(a, b), true);
  return { curves: inst.curves, points: inst.points.map((pair) => pair[1]) };
}

/** Überlebende Instanz-Geometrie aus aktuellen Quellen neu setzen (ids bleiben stabil). */
function refreshInstance(sk: Sketch, seed: Seed, inst: PatternInstance, move: Transform): void {
  const map = new Map<number, number>(inst.points);
  for (const [seedId, copyId] of map) {
    const s = ptOf(sk, seedId), c = ptOf(sk, copyId);
    if (!s || !c) continue;
    const np = move(s);
    c.x = np.x;
    c.y = np.y;
  }
  seed.ents.forEach((src, k) => {
    const copy = entOf(sk, inst.curves[k]);
    if (!copy) return;
    if (src.t === 'circle' && copy.t === 'circle') copy.r = src.r;
    else if (src.t === 'ellipse' && copy.t === 'ellipse') copy.r = src.r;
    else if (src.t === 'arc' && copy.t === 'arc') {
      const c = ptOf(sk, map.get(src.c) as number), s = ptOf(sk, map.get(src.s) as number), e = ptOf(sk, map.get(src.e) as number);
      if (!c || !s || !e) return;
      copy.r = Math.hypot(s.x - c.x, s.y - c.y);
      copy.a0 = Math.atan2(s.y - c.y, s.x - c.x);
      copy.a1 = Math.atan2(e.y - c.y, e.x - c.x);
      while (copy.a1 <= copy.a0) copy.a1 += 2 * Math.PI;
    }
  });
}

export function updatePattern(sk: Sketch, patternId: string, params: UpdatePatternParams): PatternBuildResult {
  const existing = patternOf(sk, patternId);
  if (!existing) return { error: 'Muster ist unbekannt oder gelöscht.' };
  if (params.type !== existing.kind.type) {
    return { error: 'Art des Musters kann nicht geändert werden (Kreis ↔ Rechteck).' };
  }
  const seedIds = params.entities ?? existing.entities;
  const seedChanged = !sameIdList(
    [...seedIds].filter((id, i) => seedIds.indexOf(id) === i),
    [...existing.entities].filter((id, i) => existing.entities.indexOf(id) === i),
  );
  if (existing.kind.type === 'circular') {
    const p = params as CircularUpdateParams;
    const base = existing.kind;
    const slots = validateCircular(sk, {
      entities: seedIds, center: p.center ?? base.center, count: p.count ?? base.count,
      angle: p.angle ?? base.angle, alignment: p.alignment ?? base.alignment, reversed: p.reversed ?? base.reversed,
      expressions: p.expressions ?? existing.expressions,
    });
    if (hasError(slots)) return slots;
    const probeCenter = slots.center.kind === 'id' ? (ptOf(sk, slots.center.id) as SkPt) : { x: slots.center.x, y: slots.center.y };
    if (slots.center.kind === 'pt' && (Math.abs(slots.center.x) > MAX_BUILD_COORD || Math.abs(slots.center.y) > MAX_BUILD_COORD)) {
      return { error: COORD_RANGE_ERROR };
    }
    if (!copyTargetsValid(sk, slots.seed, circularIndices(slots.count), circularTransforms(slots, probeCenter))) {
      return { error: COORD_RANGE_ERROR };
    }
    if (seedChanged) {
      for (const inst of existing.instances) deleteIds(sk, instanceIds(inst));
      const centerId = slots.center.kind === 'id' ? slots.center.id : materializeCenter(sk, slots.center);
      const indices = circularIndices(slots.count);
      existing.entities = slots.seed.entIds.concat(slots.seed.bare.map((pt) => pt.id));
      existing.kind = { type: 'circular', center: centerId, count: slots.count, angle: slots.angle, alignment: slots.alignment, reversed: slots.reversed };
      existing.instances = buildInstances(sk, slots.seed, indices, circularTransforms(slots, ptOf(sk, centerId) as SkPt), false);
      applyExpressions(existing, slots.expressions);
      return { pattern: existing };
    }
    const centerId = slots.center.kind === 'id' ? slots.center.id : materializeCenter(sk, slots.center);
    existing.kind = { type: 'circular', center: centerId, count: slots.count, angle: slots.angle, alignment: slots.alignment, reversed: slots.reversed };
    applyExpressions(existing, slots.expressions);
    const move = circularTransforms(slots, ptOf(sk, centerId) as SkPt);
    const wanted = new Map(circularIndices(slots.count).map(([i, j]) => [`${i},${j}`, [i, j] as [number, number]]));
    const kept: PatternInstance[] = [];
    for (const inst of existing.instances) {
      const key = `${inst.index[0]},${inst.index[1]}`;
      if (wanted.has(key)) {
        refreshInstance(sk, slots.seed, inst, move(wanted.get(key) as [number, number]));
        kept.push(inst);
        wanted.delete(key);
      } else {
        deleteIds(sk, instanceIds(inst));
      }
    }
    for (const index of wanted.values()) kept.push(...buildInstances(sk, slots.seed, [index], move, false));
    kept.sort((x, y) => x.index[0] - y.index[0] || x.index[1] - y.index[1]);
    existing.instances = kept;
    return { pattern: existing };
  }
  const p = params as RectangularUpdateParams;
  const base = existing.kind;
  if (base.type !== 'rectangular') return { error: 'Art des Musters kann nicht geändert werden (Kreis ↔ Rechteck).' };
  const slots = validateRectangular(sk, {
    entities: seedIds, count: p.count ?? base.count, spacing: p.spacing ?? base.spacing,
    count2: p.count2 ?? base.count2, spacing2: p.spacing2 ?? base.spacing2,
    dir: p.dir ?? base.dir, dir2: p.dir2 === undefined ? base.dir2 : p.dir2,
    direction: p.direction === undefined ? base.direction : p.direction ?? undefined,
    direction2: p.direction2 === undefined ? base.direction2 : p.direction2 ?? undefined,
    alignment: p.alignment ?? base.alignment, alignment2: p.alignment2 ?? base.alignment2,
    reversed: p.reversed ?? base.reversed, reversed2: p.reversed2 ?? base.reversed2,
    expressions: p.expressions ?? existing.expressions,
  });
  if (hasError(slots)) return slots;
  if (!copyTargetsValid(sk, slots.seed, rectangularIndices(slots.count, slots.count2), rectangularTransforms(slots))) {
    return { error: COORD_RANGE_ERROR };
  }
  const applyKind = (): void => {
    existing.kind = {
      type: 'rectangular', count: slots.count, spacing: slots.spacing, count2: slots.count2, spacing2: slots.spacing2,
      dir: slots.vec, dir2: slots.vec2, alignment: slots.alignment, alignment2: slots.alignment2,
      reversed: slots.reversed, reversed2: slots.reversed2,
      ...(slots.direction !== undefined ? { direction: slots.direction } : {}),
      ...(slots.direction2 !== undefined ? { direction2: slots.direction2 } : {}),
    };
    applyExpressions(existing, slots.expressions);
  };
  if (seedChanged) {
    for (const inst of existing.instances) deleteIds(sk, instanceIds(inst));
    const indices = rectangularIndices(slots.count, slots.count2);
    existing.entities = slots.seed.entIds.concat(slots.seed.bare.map((pt) => pt.id));
    applyKind();
    existing.instances = buildInstances(sk, slots.seed, indices, rectangularTransforms(slots), false);
    return { pattern: existing };
  }
  applyKind();
  const move = rectangularTransforms(slots);
  const wanted = new Map(rectangularIndices(slots.count, slots.count2).map(([i, j]) => [`${i},${j}`, [i, j] as [number, number]]));
  const kept: PatternInstance[] = [];
  for (const inst of existing.instances) {
    const key = `${inst.index[0]},${inst.index[1]}`;
    if (wanted.has(key)) {
      refreshInstance(sk, slots.seed, inst, move(wanted.get(key) as [number, number]));
      kept.push(inst);
      wanted.delete(key);
    } else {
      deleteIds(sk, instanceIds(inst));
    }
  }
  for (const index of wanted.values()) kept.push(...buildInstances(sk, slots.seed, [index], move, false));
  kept.sort((x, y) => x.index[0] - y.index[0] || x.index[1] - y.index[1]);
  existing.instances = kept;
  return { pattern: existing };
}

/**
 * Lebende Richtungen nachführen (rein, ohne Undo/Commit): für jedes Rechteckmuster mit
 * direction/direction2-Referenz den Vektor aus der aktuellen Liniengeometrie neu bestimmen
 * (Logik von resolveAxisVector); weicht er um mehr als 1e-9 ab, kind.dir/dir2 aktualisieren
 * und alle Instanz-Geometrien aus aktuellen Quellen neu setzen (ids stabil, refreshInstance).
 * Muster ohne Referenz bleiben unangetastet; unlösbare Referenzen werden übersprungen
 * (prune-Zuständigkeit, kein Crash). Rückgabe: Anzahl nachgeführter Muster.
 */
export function syncPatternDirections(sk: Sketch): { synced: number } {
  let synced = 0;
  for (const p of sk.patterns ?? []) {
    if (p.kind.type !== 'rectangular') continue;
    if (p.kind.direction === undefined && p.kind.direction2 === undefined) continue;
    const seed = seedOfPattern(sk, p.entities);
    if (!seed) continue;
    const k = p.kind;
    const r1 = k.direction !== undefined
      ? resolveAxisVector(sk, '1', k.dir, k.direction, { x: 1, y: 0 })
      : null;
    if (r1 && hasError(r1)) continue;
    const vec1 = r1 ? r1.vec : k.dir;
    const perp: Pt = { x: -vec1.y, y: vec1.x };
    const r2 = k.direction2 !== undefined
      ? resolveAxisVector(sk, '2', k.dir2 ?? null, k.direction2, perp)
      : null;
    if (r2 && hasError(r2)) continue;
    const oldV2: Pt = k.dir2 ?? { x: -k.dir.y, y: k.dir.x };
    const effV2: Pt = r2 ? r2.vec : (k.dir2 ?? perp);
    const moved1 = r1 ? Math.hypot(r1.vec.x - k.dir.x, r1.vec.y - k.dir.y) > 1e-9 : false;
    const moved2 = Math.hypot(effV2.x - oldV2.x, effV2.y - oldV2.y) > 1e-9;
    if (!moved1 && !moved2) continue;
    if (r1) k.dir = r1.vec;
    if (r2) k.dir2 = r2.vec;
    const move = rectangularTransforms({
      vec: k.dir, vec2: effV2, spacing: k.spacing, spacing2: k.spacing2,
      alignment: k.alignment, alignment2: k.alignment2, reversed: k.reversed, reversed2: k.reversed2,
    });
    for (const inst of p.instances) refreshInstance(sk, seed, inst, move(inst.index));
    synced++;
  }
  return { synced };
}

/**
 * Muster ohne existierende Quellen/Mittelpunkt/Richtungen oder mit gelöschter
 * Kopie-Geometrie aus sk.patterns entfernen (Geometrie bleibt stehen).
 * Rückgabe: Anzahl entfernter Muster.
 */
export function prunePatterns(sk: Sketch): number {
  const list = sk.patterns ?? [];
  const intact = (p: SketchPattern): boolean => {
    for (const id of p.entities) {
      if (!entOf(sk, id) && !ptOf(sk, id)) return false;
    }
    if (p.kind.type === 'circular') {
      if (!ptOf(sk, p.kind.center)) return false;
    } else {
      if (p.kind.direction !== undefined) {
        const d = entOf(sk, p.kind.direction);
        if (!d || d.t !== 'line') return false;
      }
      if (p.kind.direction2 !== undefined) {
        const d = entOf(sk, p.kind.direction2);
        if (!d || d.t !== 'line') return false;
      }
    }
    for (const inst of p.instances) {
      if (!inst.curves.every((c) => entOf(sk, c))) return false;
      if (!inst.points.every((pair) => ptOf(sk, pair[1]))) return false;
    }
    return true;
  };
  const keep = list.filter(intact);
  const removed = list.length - keep.length;
  if (removed > 0) {
    if (keep.length) sk.patterns = keep;
    else delete sk.patterns;
  }
  return removed;
}

export function patternOf(sk: Sketch, id: string): SketchPattern | undefined {
  return (sk.patterns ?? []).find((p) => p.id === id);
}

/**
 * Muster, das die id als Quelle oder als Kopie-Geometrie enthält (Phase 4:
 * Edit-Einstieg per Doppelklick auf Kopie). Quellen schlagen Kopien.
 */
export function patternContainingCopy(sk: Sketch, id: number): SketchPattern | undefined {
  for (const p of sk.patterns ?? []) {
    if (p.entities.includes(id)) return p;
  }
  for (const p of sk.patterns ?? []) {
    for (const inst of p.instances) {
      if (inst.curves.includes(id)) return p;
      if (inst.points.some((pair) => pair[1] === id)) return p;
    }
  }
  return undefined;
}

export function patternChildren(pattern: SketchPattern): { curves: number[]; points: number[] } {
  const curves: number[] = [];
  const points: number[] = [];
  for (const inst of pattern.instances) {
    curves.push(...inst.curves);
    for (const pair of inst.points) points.push(pair[1]);
  }
  return { curves, points };
}
