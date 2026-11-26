// Skizzen-Muster (Kreismuster, Rechteckmuster): Typen, Caps und reine Validatoren.
// Verhalten nach docs/muster-neubau-funktionsbeschreibung.md.
// Anzahlen schließen das Original ein; Kopie-IDs sind pro Slot stabil (Phase 1).
import type { Pt } from '../model';

export type PatternAlignment = 'left' | 'center' | 'right';

export interface CircularPatternKind {
  type: 'circular';
  /** Skizzenpunkt-id des Drehpunkts (lebende Referenz, kein Bildschirm-Artefakt) */
  center: number;
  /** Anzahl inkl. Original: 2…500 */
  count: number;
  /** Gesamtwinkel in Grad: 0 < |angle| ≤ 360, Default 360 */
  angle: number;
  alignment: PatternAlignment;
  reversed: boolean;
}

export interface RectangularPatternKind {
  type: 'rectangular';
  /** Anzahl inkl. Original, je Richtung 1…500, Produkt ≤ 500 */
  count: number;
  /** Abstand in mm (≠ 0 bei count > 1), Default 20 */
  spacing: number;
  count2: number;
  spacing2: number;
  /** Normalisierte Richtungsvektoren (Fallback X bzw. Senkrechte) */
  dir: Pt;
  dir2: Pt | null;
  /** Optionale lebende Linien-Referenzen (Skizzenlinien-ids) */
  direction?: number;
  direction2?: number;
  alignment: PatternAlignment;
  alignment2: PatternAlignment;
  reversed: boolean;
  reversed2: boolean;
}

export type SketchPatternKind = CircularPatternKind | RectangularPatternKind;

export interface PatternInstance {
  /** Kopie-Slot: Kreis [1..count), Rechteck [i,j] ohne [0,0] */
  index: [number, number];
  curves: number[];
  /** [Quellpunkt-id, Kopiepunkt-id] je abgebildetem Punkt */
  points: [number, number][];
}

export type PatternExpressionKey = 'count' | 'count2' | 'spacing' | 'spacing2' | 'angle';

export interface SketchPattern {
  id: string;
  /** Quell-Element-ids (keine Kopien, keine Hilfsgeometrie) */
  entities: number[];
  kind: SketchPatternKind;
  /** Als Text verlinkte Ausdrücke (Parameter-Namen); Zahlenwerte bleiben maßgeblich */
  expressions?: Partial<Record<PatternExpressionKey, string>>;
  instances: PatternInstance[];
}

/** Harte Caps: höchstens 500 Kopien je Muster (Anzahlen inkl. Original). */
export const MAX_PATTERN_COPIES = 500;
export const MIN_CIRCULAR_COUNT = 2;
export const MAX_RECTANGULAR_COUNT = 500;
/** Obergrenze Gesamtwinkel: 360 (kein Minimum außer ≠ 0, siehe validPatternAngle). */
export const MAX_PATTERN_ANGLE = 360;
export const COUNT_TOLERANCE = 1e-9;
export const MAX_PATTERN_SPACING = 1e6;
export const MAX_PATTERN_EXPRESSION = 4096;
const EXPRESSION_KEYS: readonly PatternExpressionKey[] = ['count', 'count2', 'spacing', 'spacing2', 'angle'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isPt = (v: unknown): v is Pt => isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number';

/** Ganzzahligkeit mit SolidCraft-Toleranz: |v − rund| < 1e-9. */
export const asWholeCount = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) && Math.abs(v - Math.round(v)) < COUNT_TOLERANCE ? Math.round(v) : null;

export const validCircularCount = (count: unknown): count is number => {
  const n = asWholeCount(count);
  return n !== null && n >= MIN_CIRCULAR_COUNT && n <= MAX_PATTERN_COPIES;
};

export const validRectangularCount = (count: unknown): count is number => {
  const n = asWholeCount(count);
  return n !== null && n >= 1 && n <= MAX_RECTANGULAR_COUNT;
};

export const validRectangularProduct = (count: unknown, count2: unknown): boolean => {
  const a = asWholeCount(count), b = asWholeCount(count2);
  return a !== null && b !== null && a >= 1 && b >= 1 && a <= MAX_RECTANGULAR_COUNT && b <= MAX_RECTANGULAR_COUNT && a * b <= MAX_PATTERN_COPIES;
};

/** 0 < |angle| ≤ 360, endlich (kein Mindestwinkel — auch 0.5° ist zulässig). */
export const validPatternAngle = (angle: unknown): angle is number =>
  typeof angle === 'number' && isFinite(angle) && Math.abs(angle) > 0 && Math.abs(angle) <= MAX_PATTERN_ANGLE;

/** Endlich und im Arbeitsbereich (pragmatische Obergrenze 1e6 mm). */
export const validPatternSpacing = (spacing: unknown): spacing is number =>
  typeof spacing === 'number' && isFinite(spacing) && Math.abs(spacing) <= MAX_PATTERN_SPACING;

/** Abstand 0 nur bei Anzahl 1 erlaubt. */
export const validPatternSpacingForCount = (spacing: unknown, count: unknown): boolean => {
  if (!validPatternSpacing(spacing)) return false;
  const n = asWholeCount(count);
  return n !== null && (n <= 1 || spacing !== 0);
};

export const validPatternExpression = (key: unknown, value: unknown): value is string =>
  typeof key === 'string' && (EXPRESSION_KEYS as readonly string[]).includes(key) &&
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_PATTERN_EXPRESSION;

/** Erwartete Kopie-Anzahl (ohne Original): Kreis count−1, Rechteck n1·n2−1. */
export const patternInstanceCount = (kind: SketchPatternKind): number =>
  kind.type === 'circular' ? kind.count - 1 : kind.count * kind.count2 - 1;

/** Strukturelle Prüfung eines Musters (ohne Querverweise); ungültige fallen weg. */
export const isValidSketchPattern = (p: unknown): p is SketchPattern => {
  if (!isRecord(p) || typeof p.id !== 'string' || !p.id) return false;
  if (!Array.isArray(p.entities) || !p.entities.length || !p.entities.every((e) => typeof e === 'number')) return false;
  if (!Array.isArray(p.instances) || p.instances.length >= MAX_PATTERN_COPIES) return false;
  if (p.expressions !== undefined) {
    if (!isRecord(p.expressions)) return false;
    for (const [key, value] of Object.entries(p.expressions)) {
      if (!validPatternExpression(key, value)) return false;
    }
  }
  for (const inst of p.instances) {
    if (!isRecord(inst) || !Array.isArray(inst.index) || inst.index.length !== 2) return false;
    if (!Array.isArray(inst.curves) || !inst.curves.every((c) => typeof c === 'number')) return false;
    if (!Array.isArray(inst.points)) return false;
    if (!inst.points.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'number')) return false;
  }
  const kind = p.kind;
  if (!isRecord(kind)) return false;
  if (kind.type === 'circular') {
    const count = asWholeCount(kind.count);
    return typeof kind.center === 'number' && count !== null &&
      count >= MIN_CIRCULAR_COUNT && count <= MAX_PATTERN_COPIES &&
      validPatternAngle(kind.angle) && (kind.alignment === 'left' || kind.alignment === 'center' || kind.alignment === 'right') &&
      typeof kind.reversed === 'boolean' && count - 1 === p.instances.length;
  }
  if (kind.type === 'rectangular') {
    const count = asWholeCount(kind.count), count2 = asWholeCount(kind.count2);
    return count !== null && count2 !== null && validRectangularProduct(count, count2) &&
      validPatternSpacingForCount(kind.spacing, count) && validPatternSpacingForCount(kind.spacing2, count2) &&
      isPt(kind.dir) && (kind.dir2 === null || isPt(kind.dir2)) &&
      (kind.direction === undefined || typeof kind.direction === 'number') &&
      (kind.direction2 === undefined || typeof kind.direction2 === 'number') &&
      (kind.alignment === 'left' || kind.alignment === 'center' || kind.alignment === 'right') &&
      (kind.alignment2 === 'left' || kind.alignment2 === 'center' || kind.alignment2 === 'right') &&
      typeof kind.reversed === 'boolean' && typeof kind.reversed2 === 'boolean' &&
      count * count2 - 1 === p.instances.length;
  }
  return false;
};

/** Unbekannte/ungültige Einträge raus, Rest übernehmen (Rohdaten misstrauen). */
export function cleanSketchPatterns(raw: unknown): SketchPattern[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidSketchPattern);
}
