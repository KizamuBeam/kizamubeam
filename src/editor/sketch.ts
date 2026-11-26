// Editor: Skizzenmodus. Eine Skizze (Generator-Objekt gen 'sketch') wird mit Doppelklick geöffnet; Linien, Rechtecke,
// Kreise und Bögen zeichnen, Beziehungen und Bemaßungen setzen, Punkte ziehen. Der Löser (PlaneGCS) hält alle
// Beziehungen ein. Jede Änderung ist ein Undo-Schritt; der Umriss des Objekts wird sofort neu gebaut.
import { apply, inv, Mat, newId, Obj, Pt, translate, visibleLeaves } from '../model';
import type { GenShape, SubPath } from '../model';
import {
  addArc, addCenteredRectangle, addCircle, addCon, addEllipse, addLine, addPoint, addPt, addSketchRectangle, applyEllipseAxes, classifyDistancePlacement, cloneSketch, coincidentRoots, ConType, deleteIds, emptySketch, entOf, isDim, measureCon, parseSketch,
  entPoints, markAuxFrom, materializeSketchPoint, pointPair, ptOf, Sketch, SkCon, SkEnt, type SketchPickedPoint, sketchJson, sketchPointLinked, sketchSubs, snapToAngleStep, toggleRoundDim, validCircleDiameter, validEllipseAxes, MIN_SKETCH_ELLIPSE_AXIS,
} from '../sketch/model';
import { loadSolver, solveSketch, SolveResult, solverReady } from '../sketch/solver';
import { MAX_PATTERN_ANGLE, MAX_PATTERN_COPIES, asWholeCount, validPatternExpression, type PatternExpressionKey, type SketchPattern } from '../sketch/pattern';
import { buildCircularPattern, buildRectangularPattern, mirrorEntities, patternChildren, patternContainingCopy, syncPatternDirections, updatePattern, type UpdatePatternParams } from '../sketch/patternBuild';
import { diagnosticTitle, solveDiagnostics, type SketchDiagnostic } from '../sketch/diagnostics';
import { brokenFeatureReferences, changedPlacement, featureReferences, lostConditions } from '../sketch/references';
import type { SketchTransformBlock } from '../sketch/translate';
import { addSketchPolyline, sketchPolylineArc, type SketchSegment } from '../sketch/polyline';
import { sketchFrameSelection } from '../sketch/selection';
import { applySketchSplit, planSketchSplit, type SketchSplit } from '../sketch/split';
import { sketchSlotAxis, sketchSlots, sketchSlotWidth } from '../sketch/slot';
import { addRoundedSketchRectangle, roundedRectangleSize } from '../sketch/roundedRectangle';
import { sketchRigidMatrix, sketchRotationMatrix, transformedSketch } from '../sketch/transform';
import { addSketchPolygon, type SketchPolygonMode } from '../sketch/polygon';
import { addCenterCornerRectangle, addThreePointRectangle, centerCornerRectCorners, threePointRectCorners, type SketchRectMode } from '../sketch/rectModes';
import { addCenterArcSlot, addCenterSlot, addOverallSlot, addThroughArcSlot, arcSlotCenterSpine, arcSlotSpineThrough, sketchArcSlotWidth, slotCentersFromOverall, type SketchSlotMode } from '../sketch/slotModes';
import { addTangentCircleAt, addThreePointCircle, addTwoPointCircle, circumcenter, tangentRefKind, threeTangentCandidates, twoPointCircle, twoTangentCandidates, twoTangentRadiusFor, type SketchCircleMode } from '../sketch/circleModes';
import { addAngleConstrLine, addBisectorConstrLine, addExternalTangentConstrLine, addFreeConstrLine, addHVConstrLine, addParallelConstrLine, addPointTangentConstrLine, addTwoTangentConstrLine, constrRefKind, pointTangentDir, type SketchConstrMode } from '../sketch/constrLines';
import { addTangentArc, refEndDir, type SketchArcMode } from '../sketch/arcTangent';
import { addSketchCircleOffset } from '../sketch/circleOffset';
import { addSmoothOffset } from '../sketch/smoothOffset';
import { addSplitInset, planSplitInset } from '../sketch/splitInset';
import { applySketchCorner, planSketchCorner, type SketchCorner } from '../sketch/corner';
import { applySketchDivide, divideSelection, MAX_SKETCH_DIVIDE, MIN_SKETCH_DIVIDE } from '../sketch/divide';
import { applySketchTrim, pickSketchExtend, pickSketchTrim, type SketchTrim } from '../sketch/trim';
import { applyTrimSpan, pickTrimSpan, sketchEdgeIntersections, sketchRoundTrimHit, type TrimSpan } from '../sketch/trimSpans';
import { evaluate, renameInExpr, Scope, scopeOf, usesName } from '../params';
import { angleGuide } from '../snap';
import type { Issue } from '../generators';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { evalExpr, h, showDialog } from '../dom';
import { dimensionNumber } from '../sketchDimensionInput';
import { dimParamScope, materializeDimParam } from './params';
import { dimensionOffset } from '../sketch/dimensionPlacement';
import { applyDrawLineKind, isConstructionGeometry, setSketchLineType, sketchSnapActive, sketchWorldBounds, type SketchDrawLine, type SketchLineType } from '../sketch/sidepanel';
import { RULER, SNAP_PX } from './shared';

export type SkTool = 'select' | 'line' | 'constr' | 'polyline' | 'rect' | 'centerRect' | 'roundRect' | 'circle' | 'ellipse' | 'arc' | 'point' | 'slot' | 'polygon' | 'circleOffset' | 'dim' | 'trim' | 'extend' | 'split' | 'chamfer' | 'fillet' | 'rotate' | 'mirror';
export const isSketchTransform = (tool?: SkTool): tool is 'rotate' | 'mirror' => tool === 'rotate' || tool === 'mirror';
export const isSketchShapePlacement = (tool?: SkTool): tool is 'slot' | 'polygon' | 'roundRect' | 'rotate' | 'mirror' => tool === 'slot' || tool === 'polygon' || tool === 'roundRect' || isSketchTransform(tool);

export const isSketchCircleTool = (tool?: SkTool): tool is 'circleOffset' => tool === 'circleOffset';

export function isSketchLineEdit(tool?: SkTool): tool is 'trim' | 'extend' | 'split' | 'chamfer' | 'fillet' {
  return tool === 'trim' || tool === 'extend' || tool === 'split' || tool === 'chamfer' || tool === 'fillet';
}
type SketchLinePlan = SketchTrim | TrimSpan | SketchSplit | SketchCorner;
export type SketchRelationAction = ConType | 'collinear' | 'joinEnds';

/** Was unter dem Mauszeiger liegt: Punkt, Element oder Bemaßung/Beziehung (Symbol) */
export type SkHit = { kind: 'pt' | 'ent' | 'con'; id: number } | null;

export interface SketchSession {
  obj: Obj;
  /** Welt-Matrix des Objekts (Skizze → Welt) */
  m: Mat;
  sk: Sketch;
  /** zuletzt geschriebener Stand (erkennt Undo/Redo von außen) */
  json: string;
  /** Stand beim Öffnen (Abbrechen) */
  orig: string;
  tool: SkTool;
  sel: Set<number>;
  hover: SkHit;
  /** Konstruktions-Modus: neu gezeichnete Elemente erhalten aux (G schaltet um, Auswahl-Toggle bleibt) */
  drawAux: boolean;
  /** Zeichenmodus für neue Linien: Mittellinie/Unendlich (nur Linienwerkzeug; Konstruktion läuft über drawAux) */
  drawLine: SketchDrawLine;
  /** Sichtbarkeitsschalter des Seitenmenüs: reine Anzeige, ändern nie Geometrie, Bestimmung oder Ausgabe.
   * Ausgeblendete Konstruktionsgeometrie ist auch nicht fangbar (kein Kanten-/Mittenfang, keine Auswahl). */
  showRelations: boolean;
  showDims: boolean;
  showPoints: boolean;
  showConstruction: boolean;
  /** Fangschalter der Skizze: false schaltet snapPt für die Platzierung aus (Session-Flag, Standard an) */
  sketchSnap: boolean;
  /** Solver-DOF beim Sitzungsbeginn: Basis des Bestimmungsbalkens (null = nie erfundene Prozente, Balken aus) */
  startDof: number | null;
  snapCycle?: { at: Pt; index: number };
  snapPointer?: Pt;
  linkedSnap?: boolean;
  boundCrossSnap?: boolean;
  mirrorLineMode?: boolean;
  /** Muster-Entwurf (Phase 2): Fenster-Entwurf — Klicks routen hierher, Commit erst bei OK/Übernehmen. */
  patternDraft?: PatternDraft | null;
  /** Abstands-Ziehen (Phase 3): Pfeil-Richtung, Zeiger und wiederherzustellender Text (nur Entwurf, kein Commit). */
  patternDrag?: { dir: 0 | 1; pointerId: number; restore: string } | null;
  /** Schließer des Muster-Fensters (DOM, gesetzt von sketchPanel). */
  patternClose?: (() => void) | null;
  /** Punkte der Linie/Form im Entstehen (ids) bzw. Klickpunkte */
  draft: SketchPickedPoint[];
  draftIds: (number | null)[];
  polyline?: { start: SketchPickedPoint; startId: number | null; segments: SketchSegment[]; through?: SketchPickedPoint; throughId?: number | null };
  polylineArc?: boolean;
  polylinePointer?: number;
  polygonSides?: number;
  polygonMode?: SketchPolygonMode;
  /** Kreismodus des Kreiswerkzeugs (Werkzeug-Button, Default Mitte+Rand wie bisher) */
  circleMode?: SketchCircleMode;
  /** Rechteckmodus des Rechteckwerkzeugs (Werkzeug-Button, Default 2 Ecken wie bisher) */
  rectMode?: SketchRectMode;
  /** Langlochmodus des Langlochwerkzeugs (Werkzeug-Button, Default Mitte-zu-Mitte wie bisher) */
  slotMode?: SketchSlotMode;
  /** Konstruktionslinienmodus des Konstruktionslinien-Werkzeugs (Werkzeug-Button, Default frei) */
  constrMode?: SketchConstrMode;
  /** gesammelte Referenzen der Konstruktionslinien-Modi (flüchtig, keine Geometrie) */
  constrRefs?: number[];
  /** Cursor-Ablage des Referenzklicks (Seite für Tangenten/Halbierende, flüchtig) */
  constrCursor?: Pt;
  /** Bogenmodus des Bogenwerkzeugs (Werkzeug-Button, Default Mitte-Anfang-Ende wie bisher) */
  arcMode?: SketchArcMode;
  /** Referenz-Element des Tangentenbogens (flüchtig, keine Geometrie) */
  arcRef?: number;
  /** Gegenrichtung des Tangentenbogens (U-Taste, flüchtig) */
  arcFlip?: boolean;
  /** gesammelte Tangentenziele des Kreismodus (flüchtig, keine Geometrie) */
  circleRefs?: number[];
  splitInsetPending?: NonNullable<ReturnType<typeof planSplitInset>>;
  translationPreview?: { subs: SubPath[]; delta: Pt };
  centerRectPress?: { id: number; x: number; y: number; newCenter: boolean };
  trimPreview?: SketchLinePlan;
  trimPointer?: number;
  trimPressed?: SketchLinePlan;
  trimPending?: boolean;
  polylineKeys?: Pt;
  frame?: { from: Pt; to: Pt; additive: boolean; pointerId?: number };
  frameKeys?: Pt;
  /** gewählte Elemente des Bemaßungs-Werkzeugs */
  dimPick: SkHit[];
  valueEdit?: { controller: AbortController; draft?: SkCon };
  dimPress?: { pointerId: number; hit: SkHit };
  /** Durchmesser/Radius-Umschaltung der ausstehenden runden Wahl (Taste U oder Zweitklick) */
  dimRoundFlip?: boolean;
  relationPick?: { type: SketchRelationAction; previous: Set<number> };
  status: SolveResult | null;
  rejectedDiagnostics?: SketchDiagnostic[];
  drag: { pt: number; moved: boolean } | { con: number; start: Pt; at: Pt } | null;
  /** Lage der Symbol- und Bemaßungsbeschriftungen auf dem Bildschirm (für Treffertest) */
  labels: { id: number; x: number; y: number; w: number; h: number }[];
  /** Ansicht der Skizzen-Hilfslinien (flüchtig, wird nicht gespeichert) */
  guideHidden?: boolean;
  guideLocked?: boolean;
}

// ---------- Muster-Fenster (Phase 2) ----------

export type PatternToolKind = 'mirror' | 'circular' | 'rectangular';
export type PatternDraftSpot = 'entities' | 'line' | 'center' | 'direction' | 'direction2';

export interface PatternDraft {
  kind: PatternToolKind;
  /** Gesetzte Muster-ID: Edit-Modus (OK → updatePattern, kein Übernehmen-Button). */
  editPatternId?: string;
  entities: number[];
  line?: number;
  center?: number;
  direction?: number;
  direction2?: number;
  /** Vorgemerkter Freiraum-Punkt (erst bei OK materialisiert, nie ein Bildschirm-Artefakt). */
  freeCenter?: Pt;
  active: PatternDraftSpot;
  countText: string;
  count2Text: string;
  spacingText: string;
  spacing2Text: string;
  angleText: string;
  reversed: boolean;
  reversed2: boolean;
  centered: boolean;
  centered2: boolean;
  error: string;
}

/** Einzel-Eingaben je Werkzeug (zentraler Dispatch statt if/else-Duplikat). */
const PATTERN_SINGLES: Record<PatternToolKind, Array<'line' | 'center' | 'direction' | 'direction2'>> = {
  mirror: ['line'],
  circular: ['center'],
  rectangular: ['direction', 'direction2'],
};

export const PATTERN_TITLES: Record<PatternToolKind, string> = {
  mirror: 'Spiegeln',
  circular: 'Kreismuster',
  rectangular: 'Rechteckmuster',
};

type PatternRefresh = () => void;
const patternRefreshers = new WeakMap<Editor, PatternRefresh>();

/** Fenster-Seite (sketchPanel) meldet Live-Auffrischung an; null löst. */
export function setPatternDialogRefresh(ed: Editor, fn: PatternRefresh | null) {
  if (fn) patternRefreshers.set(ed, fn);
  else patternRefreshers.delete(ed);
}

function notifyPatternDialog(ed: Editor) {
  patternRefreshers.get(ed)?.();
}

/** Edit-Öffner der Fenster-Seite (sketchPanel): Doppelklick/Kontextmenü → Edit-Fenster. */
type PatternEditOpener = (patternId: string) => void;
const patternEditOpeners = new WeakMap<Editor, PatternEditOpener>();

/** Fenster-Seite meldet den Edit-Öffner an; null löst (Fallback: reiner Entwurf ohne Fenster). */
export function setPatternEditOpener(ed: Editor, fn: PatternEditOpener | null) {
  if (fn) patternEditOpeners.set(ed, fn);
  else patternEditOpeners.delete(ed);
}

/** Edit-Einstieg (Badge, Kopie-Doppelklick, Kontextmenü): Fenster, sonst reiner Entwurf. */
export function openPatternEdit(ed: Editor, patternId: string): boolean {
  const opener = patternEditOpeners.get(ed);
  if (opener) { opener(patternId); return true; }
  return !!ed.startPatternEditDraft(patternId);
}

/** Kontextmenü-Aktion: Auswahl → genau ein Muster → Edit-Einstieg. */
export function openPatternEditForSelection(ed: Editor): boolean {
  const s = ed.sketchEdit;
  if (!s) return false;
  const hit = patternHitOfSelection(s.sk, s.sel);
  if (!hit) return false;
  return openPatternEdit(ed, hit.id);
}

type SingleSlot = 'line' | 'center' | 'direction' | 'direction2';

const singleEmpty = (d: PatternDraft, k: SingleSlot): boolean =>
  k === 'center' ? d.center === undefined && !d.freeCenter : d[k] === undefined;

function advancePatternSingle(d: PatternDraft) {
  d.active = PATTERN_SINGLES[d.kind].find((k) => singleEmpty(d, k)) ?? 'entities';
}

function setPatternSingle(d: PatternDraft, k: PatternDraftSpot, id: number) {
  if (k === 'line') d.line = id;
  else if (k === 'center') { d.center = id; d.freeCenter = undefined; }
  else if (k === 'direction') d.direction = id;
  else if (k === 'direction2') d.direction2 = id;
}

type ValidPattern =
  | { kind: 'mirror'; entities: number[]; line: number }
  | { kind: 'circular'; entities: number[]; center: number | Pt; count: number; angle: number; centered: boolean; reversed: boolean; expressions?: Partial<Record<PatternExpressionKey, string>> }
  | { kind: 'rectangular'; entities: number[]; count: number; spacing: number; count2: number; spacing2: number;
      direction?: number; direction2?: number; centered: boolean; centered2: boolean; reversed: boolean; reversed2: boolean; expressions?: Partial<Record<PatternExpressionKey, string>> };

export type PatternParamResolver = (name: string) => number | null;

/** Projekt-Parameter als Resolver (nur endliche Zahlen; Unbekanntes → null). */
export const patternParamResolver = (params: { name: string; value: unknown }[] | undefined): PatternParamResolver =>
  (name) => {
    const v = params?.find((p) => p.name === name)?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

/** Erster unbekannter Bezeichner eines Ausdruckstexts (Einheiten ausgenommen), sonst null. */
function missingPatternParam(text: string, resolve: PatternParamResolver): string | null {
  const re = /[A-Za-z_äöüÄÖÜß][\wäöüÄÖÜß]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    if (/^(mm|cm|m|in)$/i.test(word)) continue;
    if (resolve(word) === null) return word;
  }
  return null;
}

const PATTERN_PARAM_LABEL: Record<PatternExpressionKey, string> = {
  count: 'Die Anzahl', count2: 'Die Anzahl (Richtung 2)',
  spacing: 'Der Abstand (Richtung 1)', spacing2: 'Der Abstand (Richtung 2)', angle: 'Der Winkel',
};

export interface PatternParamUpdate { id: string; params: UpdatePatternParams; }

/** Einzel-Belegung eines Entwurfs lesen (Spiegellinie per Klick abwählbar). */
export function patternSingleOf(d: PatternDraft, k: PatternDraftSpot): number | undefined {
  if (k === 'line') return d.line;
  if (k === 'center') return d.center;
  if (k === 'direction') return d.direction;
  if (k === 'direction2') return d.direction2;
  return undefined;
}

/** Einzel-Belegung löschen (Entwurf bleibt offen, nichts wird committet). */
export function clearPatternSingle(d: PatternDraft, k: PatternDraftSpot) {
  if (k === 'line') d.line = undefined;
  else if (k === 'center') { d.center = undefined; d.freeCenter = undefined; }
  else if (k === 'direction') d.direction = undefined;
  else if (k === 'direction2') d.direction2 = undefined;
}

/**
 * Badge-Anker eines Musters (reine Funktion, kein Input-Mut): Quellenschwerpunkt
 * (Mittel aller Quellpunkte); ohne Schwerpunkt → Kreismittelpunkt, sonst erster Quellpunkt.
 */
export function patternBadgeAnchor(sk: Sketch, pattern: SketchPattern): Pt | null {
  const c = patternSourceCentroid(sk, pattern.entities);
  if (c) return c;
  if (pattern.kind.type === 'circular') {
    const p = ptOf(sk, pattern.kind.center);
    if (p) return { x: p.x, y: p.y };
  }
  for (const id of pattern.entities) {
    const p = ptOf(sk, id);
    if (p) return { x: p.x, y: p.y };
    const e = entOf(sk, id);
    const first = e ? entPoints(e)[0] : undefined;
    const q = first === undefined ? undefined : ptOf(sk, first);
    if (q) return { x: q.x, y: q.y };
  }
  return null;
}

/** Muster, das die id als Quelle oder Kopie enthält (Quelle schlägt Kopie). */
export function patternOwnerOfId(sk: Sketch, id: number): SketchPattern | null {
  return (sk.patterns ?? []).find((p) => p.entities.includes(id)) ?? patternContainingCopy(sk, id) ?? null;
}

/**
 * Auswahl → genau ein Muster (Quelle oder Kopie): jede gewählte id muss zum selben
 * Muster gehören, sonst null (Kontextmenü bleibt dann disabled).
 */
export function patternHitOfSelection(sk: Sketch, sel: Iterable<number>): SketchPattern | null {
  let found: SketchPattern | null = null, any = false;
  for (const id of sel) {
    any = true;
    const owner = patternOwnerOfId(sk, id);
    if (!owner) return null;
    if (!found) found = owner;
    else if (found.id !== owner.id) return null;
  }
  return any ? found : null;
}

/**
 * Param-Nachführung planen (Phase 4, rein lesend bis auf den Probe-Klon): alle Muster mit
 * Ausdrücken gegen die Projekt-Parameter auflösen und auf einem Klon vorab anwenden.
 * Erster Fehler bricht ab und nennt Muster-ID + Parametername; nichts wird mutiert.
 */
export function planPatternParamRefresh(sk: Sketch, resolve: PatternParamResolver): { updates: PatternParamUpdate[] } | { error: string } {
  const updates: PatternParamUpdate[] = [];
  for (const p of sk.patterns ?? []) {
    const expr = p.expressions;
    if (!expr || !Object.keys(expr).length) continue;
    const values = {} as Record<PatternExpressionKey, number>;
    for (const [key, text] of Object.entries(expr)) {
      const k = key as PatternExpressionKey;
      const missing = missingPatternParam(text, resolve);
      if (missing) return { error: `Muster ${p.id}: Parameter „${missing}“ ist unbekannt (Ausdruck „${text}“ prüfen).` };
      const split = splitPatternNumber(text, PATTERN_PARAM_LABEL[k] ?? 'Der Wert', k, resolve);
      if ('error' in split) return { error: `Muster ${p.id}: ${split.error}` };
      values[k] = split.value;
    }
    const params: UpdatePatternParams = p.kind.type === 'circular'
      ? {
        type: 'circular',
        ...(values.count !== undefined ? { count: values.count } : {}),
        ...(values.angle !== undefined ? { angle: values.angle } : {}),
        expressions: expr,
      }
      : {
        type: 'rectangular',
        ...(values.count !== undefined ? { count: values.count } : {}),
        ...(values.count2 !== undefined ? { count2: values.count2 } : {}),
        ...(values.spacing !== undefined ? { spacing: values.spacing } : {}),
        ...(values.spacing2 !== undefined ? { spacing2: values.spacing2 } : {}),
        expressions: expr,
      };
    updates.push({ id: p.id, params });
  }
  if (!updates.length) return { updates };
  const trial = cloneSketch(sk);
  for (const u of updates) {
    const r = updatePattern(trial, u.id, u.params);
    if ('error' in r) return { error: `Muster ${u.id}: ${r.error}` };
  }
  return { updates };
}

/**
 * Zahl oder verlinkter Ausdruck: reine Zahlen (mit Einheit) → { value };
 * Text mit Bezeichnern → gegen Projekt-Parameter auflösen, { value, expr } merken.
 * Unauflösbar → Fehler (nie still 0, nie still Zahl).
 */
function splitPatternNumber(raw: string, label: string, key: PatternExpressionKey, resolve?: PatternParamResolver): { value: number; expr?: string } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: `${label} muss eine Zahl oder ein gültiger Ausdruck sein.` };
  const direct = evalExpr(text);
  const bare = text.replace(/\s*(mm|cm|m|in|")\s*$/i, '').replace(/,/g, '.');
  const plain = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(bare);
  if (direct !== null && plain) return { value: direct };
  if (!resolve) return { error: `${label} muss eine Zahl sein (Ausdrücke brauchen Projekt-Parameter).` };
  let substituted: string;
  try {
    substituted = text.replace(/[A-Za-z_äöüÄÖÜß][\wäöüÄÖÜß]*/g, (m) => {
      if (/^(mm|cm|m|in)$/i.test(m)) return m;
      const v = resolve(m);
      if (v === null) throw new Error(m);
      return `(${v})`;
    });
  } catch {
    return { error: `${label} „${text}“ ist unbekannt (Projekt-Parameter prüfen).` };
  }
  const v = evalExpr(substituted);
  if (v === null || !Number.isFinite(v)) return { error: `${label} muss eine Zahl oder ein gültiger Ausdruck sein.` };
  if (!validPatternExpression(key, text)) return { error: `${label}-Ausdruck ist ungültig (1…4096 Zeichen).` };
  return { value: v, expr: text };
}

function parsePatternCount(text: string, label: string, min: number, max: number, key: PatternExpressionKey, resolve?: PatternParamResolver): { value: number; expr?: string } | { error: string } {
  const split = splitPatternNumber(text, label, key, resolve);
  if ('error' in split) return split;
  const n = asWholeCount(split.value);
  if (n === null) return { error: `${label} muss ganzzahlig sein.` };
  if (n < min || n > max) return { error: `${label} muss zwischen ${min} und ${max} liegen (Original eingeschlossen).` };
  return split.expr ? { value: n, expr: split.expr } : { value: n };
}

function parsePatternMeasure(text: string, label: string, fallback: number, key: PatternExpressionKey, resolve?: PatternParamResolver): { value: number; expr?: string } | { error: string } {
  const raw = text.trim();
  if (!raw) return { value: fallback };
  const split = splitPatternNumber(raw, label, key, resolve);
  if ('error' in split) return split;
  if (Math.abs(split.value) > 1e6) return { error: `${label} muss endlich sein (höchstens 1e6 mm).` };
  return split;
}

/** Stepper-Maximum der zweiten Rechteck-Anzahl: floor(500/erste Anzahl), mind. 1 (rein). */
export function patternCount2Max(countText: string): number {
  const n = Number.parseInt(countText.trim(), 10);
  const c = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  return Math.max(1, Math.floor(MAX_PATTERN_COPIES / c));
}

/** Entwurf gegen Belegung und Caps prüfen (ohne Mutation); Fehler im Stil „Zuerst …“ / „… muss …“. */
export function validatePatternDraft(sk: Sketch, d: PatternDraft, resolve?: PatternParamResolver): ValidPattern | { error: string } {
  if (!d.entities.length) return { error: 'Zuerst Elemente auswählen.' };
  const entities = [...d.entities];
  if (d.kind === 'mirror') {
    if (d.line === undefined) return { error: 'Zuerst Spiegellinie auswählen.' };
    const e = entOf(sk, d.line);
    if (!e || e.t !== 'line') return { error: 'Die Spiegellinie muss eine gerade Linie sein.' };
    return { kind: 'mirror', entities, line: d.line };
  }
  if (d.kind === 'circular') {
    const center: number | Pt | undefined = d.center ?? d.freeCenter;
    if (center === undefined) return { error: 'Zuerst Mittelpunkt auswählen.' };
    if (typeof center === 'number' && !ptOf(sk, center)) {
      return { error: 'Der Mittelpunkt ist unbekannt oder gelöscht: zuerst einen Mittelpunkt wählen.' };
    }
    const count = parsePatternCount(d.countText, 'Die Anzahl', 2, MAX_PATTERN_COPIES, 'count', resolve);
    if ('error' in count) return count;
    const angle = parsePatternMeasure(d.angleText, 'Der Winkel', 360, 'angle', resolve);
    if ('error' in angle) return angle;
    if (!(Math.abs(angle.value) > 0) || Math.abs(angle.value) > MAX_PATTERN_ANGLE) {
      return { error: 'Der Winkel muss ungleich 0° und höchstens 360° sein.' };
    }
    const expressions: Partial<Record<PatternExpressionKey, string>> = {};
    if (count.expr) expressions.count = count.expr;
    if (angle.expr) expressions.angle = angle.expr;
    return { kind: 'circular', entities, center, count: count.value, angle: angle.value, centered: d.centered, reversed: d.reversed,
      ...(Object.keys(expressions).length ? { expressions } : {}) };
  }
  const count = parsePatternCount(d.countText, 'Die Anzahl (Richtung 1)', 1, MAX_PATTERN_COPIES, 'count', resolve);
  if ('error' in count) return count;
  const count2 = parsePatternCount(d.count2Text.trim() ? d.count2Text : '1', 'Die Anzahl (Richtung 2)', 1, MAX_PATTERN_COPIES, 'count2', resolve);
  if ('error' in count2) return count2;
  if (count.value * count2.value > MAX_PATTERN_COPIES) {
    return { error: 'Die Anzahlen müssen zusammen höchstens 500 ergeben (Anzahl 1 × Anzahl 2 ≤ 500).' };
  }
  const spacing = parsePatternMeasure(d.spacingText, 'Der Abstand (Richtung 1)', 20, 'spacing', resolve);
  if ('error' in spacing) return spacing;
  if (count.value > 1 && spacing.value === 0) {
    return { error: 'Der Abstand (Richtung 1) muss ungleich 0 sein, wenn Anzahl größer als 1 ist.' };
  }
  const spacing2 = parsePatternMeasure(d.spacing2Text.trim() ? d.spacing2Text : String(spacing.value), 'Der Abstand (Richtung 2)', spacing.value, 'spacing2', resolve);
  if ('error' in spacing2) return spacing2;
  if (count2.value > 1 && spacing2.value === 0) {
    return { error: 'Der Abstand (Richtung 2) muss ungleich 0 sein, wenn Anzahl größer als 1 ist.' };
  }
  for (const [id, label] of [[d.direction, 'Richtung 1'], [d.direction2, 'Richtung 2']] as const) {
    if (id !== undefined) {
      const e = entOf(sk, id);
      if (!e || e.t !== 'line') return { error: `Die ${label} muss eine gerade Linie sein.` };
    }
  }
  const rectExpressions: Partial<Record<PatternExpressionKey, string>> = {};
  if (count.expr) rectExpressions.count = count.expr;
  if (count2.expr) rectExpressions.count2 = count2.expr;
  if (spacing.expr) rectExpressions.spacing = spacing.expr;
  if (spacing2.expr) rectExpressions.spacing2 = spacing2.expr;
  return {
    kind: 'rectangular', entities, count: count.value, spacing: spacing.value, count2: count2.value, spacing2: spacing2.value,
    ...(d.direction !== undefined ? { direction: d.direction } : {}),
    ...(d.direction2 !== undefined ? { direction2: d.direction2 } : {}),
    centered: d.centered, centered2: d.centered2, reversed: d.reversed, reversed2: d.reversed2,
    ...(Object.keys(rectExpressions).length ? { expressions: rectExpressions } : {}),
  };
}

/**
 * Vorschau-Geometrie auf geklontem Sketch (Dokument unberührt): Kopie-Subs und Kopie-Punkte,
 * oder null bei ungültiger Belegung. Rendert nie, mutiert nie den Input.
 */
export function patternPreviewGeom(sk: Sketch, d: PatternDraft, resolve?: PatternParamResolver): { subs: SubPath[]; points: Pt[] } | null {
  const v = validatePatternDraft(sk, d, resolve);
  if ('error' in v) return null;
  const clone = cloneSketch(sk);
  let curves: number[] = [], points: number[] = [];
  if (v.kind === 'mirror') {
    const r = mirrorEntities(clone, { entities: v.entities, line: v.line });
    if ('error' in r) return null;
    curves = r.curves;
    points = r.points;
  } else if (v.kind === 'circular') {
    const r = buildCircularPattern(clone, {
      entities: v.entities, center: v.center, count: v.count, angle: v.angle,
      alignment: v.centered ? 'center' : 'right', reversed: v.reversed,
    });
    if ('error' in r) return null;
    ({ curves, points } = patternChildren(r.pattern));
  } else {
    const r = buildRectangularPattern(clone, {
      entities: v.entities, count: v.count, spacing: v.spacing, count2: v.count2, spacing2: v.spacing2,
      ...(v.direction !== undefined ? { direction: v.direction } : {}),
      ...(v.direction2 !== undefined ? { direction2: v.direction2 } : {}),
      alignment: v.centered ? 'center' : 'right', alignment2: v.centered2 ? 'center' : 'right',
      reversed: v.reversed, reversed2: v.reversed2,
    });
    if ('error' in r) return null;
    ({ curves, points } = patternChildren(r.pattern));
  }
  const keep = new Set(curves);
  const subs = sketchSubs({ ...clone, ents: clone.ents.filter((e) => keep.has(e.id)) });
  const pts: Pt[] = [];
  for (const id of points) {
    const p = ptOf(clone, id);
    if (p) pts.push({ x: p.x, y: p.y });
  }
  return { subs, points: pts };
}

// ---------- Muster-Fenster (Phase 3): Abstands-Pfeile, Ziehen, Budget-Guard ----------

/**
 * Harte Zeichen-Cap der Muster-Vorschau: höchstens so viele Kopie-Subs werden gezeichnet,
 * damit 500 Kopien nicht ruckeln. Der Geometrie-Bau bleibt vollständig (stabile Slots/IDs),
 * nur das Overlay zeichnet die ersten N Subs.
 */
export const PATTERN_PREVIEW_SUB_CAP = 200;

/** Belegungsrelevante Entwurfsfelder (ohne aktive Eingabe/Fehlertext) als Cache-Signatur. */
export function patternDraftSignature(d: PatternDraft): string {
  return JSON.stringify({
    kind: d.kind, entities: d.entities, line: d.line, center: d.center, freeCenter: d.freeCenter,
    direction: d.direction, direction2: d.direction2,
    countText: d.countText, count2Text: d.count2Text, spacingText: d.spacingText,
    spacing2Text: d.spacing2Text, angleText: d.angleText,
    reversed: d.reversed, reversed2: d.reversed2, centered: d.centered, centered2: d.centered2,
  });
}

/**
 * Vorschau-Geometrie mit Budget-Guard: pro Entwurf höchstens einmal je Belegungs-Signatur
 * neu aufgebaut (sketchJson der Skizze steckt in der Signatur — Quell-Verschiebungen bauen neu).
 * Gleiche Signatur → dieselbe Referenz (kein Neubau). Render pfade mutieren nie den Input.
 */
const patternPreviewCache = new WeakMap<PatternDraft, { sig: string; geom: { subs: SubPath[]; points: Pt[] } | null }>();

export function cachedPatternPreviewGeom(sk: Sketch, d: PatternDraft, resolve?: PatternParamResolver): { subs: SubPath[]; points: Pt[] } | null {
  const sig = `${patternDraftSignature(d)}|${sketchJson(sk)}`;
  const hit = patternPreviewCache.get(d);
  if (hit && hit.sig === sig) return hit.geom;
  const geom = patternPreviewGeom(sk, d, resolve);
  patternPreviewCache.set(d, { sig, geom });
  return geom;
}

/** Ein Abstands-Pfeil: Start, effektiver Einheitsvektor (Flip eingerechnet), Abstand, Anzahl. */
export interface PatternSpacingArrow {
  dir: 0 | 1;
  origin: Pt;
  /** normiert; zeigt bei Flip in die Gegenrichtung */
  vec: Pt;
  /** vorzeichenbehaftet (Ziehen über den Start kippt das Vorzeichen) */
  spacing: number;
  count: number;
}

/** Richtungsvektor einer gepickten Linie (normiert), sonst der Default. Spiegelt patternBuild. */
function patternArrowBaseVec(sk: Sketch, ref: number | undefined, fallback: Pt): Pt | null {
  if (ref === undefined) return fallback;
  const e = entOf(sk, ref);
  const a = e?.t === 'line' ? ptOf(sk, e.a) : undefined;
  const b = e?.t === 'line' ? ptOf(sk, e.b) : undefined;
  if (!e || e.t !== 'line' || !a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Quellenschwerpunkt der belegten Elemente (Mittel aller referenzierten Punkte), sonst null. */
function patternSourceCentroid(sk: Sketch, entities: number[]): Pt | null {
  const pts: Pt[] = [];
  for (const id of entities) {
    const p = ptOf(sk, id);
    if (p) { pts.push({ x: p.x, y: p.y }); continue; }
    const e = entOf(sk, id);
    if (!e) continue;
    for (const pid of entPoints(e)) {
      const q = ptOf(sk, pid);
      if (q) pts.push({ x: q.x, y: q.y });
    }
  }
  if (!pts.length) return null;
  return { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length };
}

/**
 * Abstands-Pfeile des Rechteckmusters (reine Funktion, kein Editor nötig):
 * je Richtung ein Pfeil ab dem Quellenschwerpunkt, Länge = Abstand, Richtung = ggf. gepickte
 * Linie (sonst Skizzen-X bzw. deren Senkrechte), Flip invertiert den Vektor.
 * Null bei ungültiger Belegung oder Kreis/Spiegel (dort: kein Pfeil, nur Overlay).
 * Richtungen mit Betrag < 1e-9 entfallen (degenerierter Pfeil).
 */
export function patternSpacingArrows(sk: Sketch, d: PatternDraft, resolve?: PatternParamResolver): PatternSpacingArrow[] | null {
  if (d.kind !== 'rectangular') return null;
  const v = validatePatternDraft(sk, d, resolve);
  if ('error' in v || v.kind !== 'rectangular') return null;
  const v1 = patternArrowBaseVec(sk, v.direction, { x: 1, y: 0 });
  if (!v1) return null;
  const perp: Pt = { x: -v1.y, y: v1.x };
  const v2 = patternArrowBaseVec(sk, v.direction2, perp);
  if (!v2) return null;
  const origin = patternSourceCentroid(sk, v.entities);
  if (!origin) return null;
  const eff = (u: Pt, flip: boolean): Pt => (flip ? { x: -u.x, y: -u.y } : u);
  const out: PatternSpacingArrow[] = [];
  const defs = [
    { dir: 0 as const, vec: eff(v1, v.reversed), spacing: v.spacing, count: v.count },
    { dir: 1 as const, vec: eff(v2, v.reversed2), spacing: v.spacing2, count: v.count2 },
  ];
  for (const a of defs) {
    if (!(Math.abs(a.spacing) >= 1e-9)) continue;
    out.push({ ...a, origin: { ...origin } });
  }
  return out;
}

/**
 * Zieh-Mapping (rein): Cursor-Projektion auf die Pfeilachse (Weltkoordinaten) → neuer Abstand.
 * Das Vorzeichen folgt der Achse — Ziehen über den Startpunkt kippt es (Flip).
 */
export function projectPatternSpacing(origin: Pt, vec: Pt, cursor: Pt): number {
  return (cursor.x - origin.x) * vec.x + (cursor.y - origin.y) * vec.y;
}

/** Zahl für den Entwurfstext: auf 0,01 mm gerundet (Ausdruckstext wird dabei ersetzt). */
export function formatPatternSpacing(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Benutzt eine Skizze den Parameter name in einer Maß-Formel? */
export function sketchUsesParam(o: Obj, name: string): boolean {
  return isSketchObj(o) && parseSketch(o.shape.params.sketch).cons.some((c) => !!c.expr && usesName(c.expr, name, false));
}

/** Parameter in den Maß-Formeln einer Skizze umbenennen */
export function renameSketchParam(o: Obj, from: string, to: string) {
  if (!isSketchObj(o)) return;
  const sk = parseSketch(o.shape.params.sketch);
  if (!sk.cons.some((c) => c.expr)) return;
  for (const c of sk.cons) if (c.expr) c.expr = renameInExpr(c.expr, from, to);
  o.shape.params = { ...o.shape.params, sketch: sketchJson(sk) };
}

/** Toleranz für automatische Beziehungen beim Zeichnen (Grad) */
const AUTO_DEG = 3;

/** Hinweis des Konstruktionslinien-Werkzeugs je Modus (Werkzeug-Button). */
function constrTip(mode: SketchConstrMode): string {
  switch (mode) {
    case 'horizontal': return t('Konstruktionslinie: einen Punkt anklicken — waagrechte unendliche Linie.');
    case 'vertical': return t('Konstruktionslinie: einen Punkt anklicken — senkrechte unendliche Linie.');
    case 'angle': return t('Konstruktionslinie: Ankerpunkt und dann Richtung anklicken — Winkellinie.');
    case 'parallel': return t('Konstruktionslinie: eine Linie und dann einen Punkt anklicken — parallele unendliche Linie.');
    case 'perpendicular': return t('Konstruktionslinie: eine Linie und dann einen Punkt anklicken — senkrechte unendliche Linie.');
    case 'externalTangent': return t('Konstruktionslinie: einen Kreis oder Bogen und dann einen Punkt anklicken — Tangente von außen.');
    case 'pointTangent': return t('Konstruktionslinie: eine Kurve und dann einen Punkt darauf anklicken — Tangente am Punkt.');
    case 'twoTangent': return t('Konstruktionslinie: zwei Kreise oder Bögen anklicken — gemeinsame Tangente, nächst zum Zeiger.');
    case 'bisector': return t('Konstruktionslinie: zwei Linien anklicken — Winkelhalbierende, nächst zum Zeiger.');
    default: return t('Konstruktionslinie: zwei Punkte anklicken — die Linie ist unendlich und bleibt Konstruktion.');
  }
}

const isSketchObj = (o: Obj | null | undefined): o is Obj & { shape: GenShape } => !!o && o.shape.kind === 'gen' && o.shape.gen === 'sketch';
export { isSketchObj };

function validRoundDimension(sk: Sketch, c: Pick<SkCon, 't' | 'r'>, value: number): boolean {
  if (c.t !== 'diameter' && c.t !== 'radius') return true;
  const e = entOf(sk, c.r[0]);
  const center = e && (e.t === 'circle' || e.t === 'arc') ? ptOf(sk, e.c) : undefined;
  return !center || validCircleDiameter(center, c.t === 'radius' ? 2 * value : value);
}

export class EditorSketch {
  /** Neue, leere Skizze in der Mitte der Ansicht anlegen und öffnen */
  async newSketch(this: Editor) {
    const c = this.toWorld(this.w / 2, this.h / 2);
    const shape: GenShape = { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: sketchJson(emptySketch()) }, subs: [] };
    const o: Obj = { id: newId(), m: translate(Math.round(c.x), Math.round(c.y)), layer: this.currentLayer, shape };
    this.snapshot(t('Neue Skizze'));
    this.doc.objs.push(o);
    this.setSel([o]);
    this.emit('doc');
    await this.editSketch(o, 'line');
  }

  /** Skizze öffnen (Doppelklick) */
  async editSketch(this: Editor, o: Obj, tool: SkTool = 'select') {
    if (!isSketchObj(o)) return;
    this.hint = t('Löser wird geladen …');
    this.emit('tool');
    try {
      await loadSolver();
    } catch (e) {
      this.hint = t('Der Löser für Skizzen ließ sich nicht laden: {msg}', { msg: String(e) });
      this.emit('tool');
      return;
    }
    let m: Mat = o.m;
    for (const [leaf, lm] of visibleLeaves(this.doc.objs)) if (leaf === o) m = lm;
    const sk = parseSketch(o.shape.params.sketch);
    const json = sketchJson(sk);
    this.setTool('sketch');
    this.sketchEdit = {
      obj: o, m, sk, json, orig: json, tool, sel: new Set(), hover: null, draft: [], draftIds: [], dimPick: [], status: null, drag: null, labels: [],
      drawAux: false, drawLine: 'normal',
      showRelations: true, showDims: true, showPoints: true, showConstruction: true, sketchSnap: true, startDof: null,
    };
    this.sketchSolve(false);
    if (this.sketchEdit) this.sketchEdit.startDof = this.sketchEdit.status ? this.sketchEdit.status.dof : null;
    this.sketchSolve(false);
    this.sketchHint();
    this.emit('tool');
    this.redraw();
  }

  /** Skizzenmodus beenden; cancel stellt den Stand beim Öffnen wieder her */
  closeSketch(this: Editor, cancel = false) {
    const s = this.sketchEdit;
    if (!s) return;
    if (s.patternDraft) this.cancelPatternDraft();
    s.valueEdit?.controller.abort();
    s.valueEdit = undefined;
    this.syncSketch();
    if (cancel && s.json !== s.orig) {
      this.snapshot(t('Skizze: Abbrechen'));
      s.sk = parseSketch(s.orig);
      this.writeSketch();
    }
    const o = s.obj;
    this.sketchEdit = null;
    this.clearTrack();
    // leere Skizzen nicht stehen lassen
    if (!s.sk.ents.length && this.doc.objs.includes(o)) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel([]);
      this.emit('doc');
    } else if (this.doc.objs.includes(o)) this.setSel([o]);
    this.setTool('select');
  }

  /** Nach Undo/Redo: Sitzung auf das (neu geladene) Objekt und seine Skizze setzen */
  syncSketch(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    let o: Obj | undefined = s.obj;
    let m = s.m;
    let found = false;
    for (const [leaf, lm] of visibleLeaves(this.doc.objs))
      if (leaf === s.obj || leaf.id === s.obj.id) {
        o = leaf;
        m = lm;
        found = true;
        break;
      }
    if (!found || !isSketchObj(o)) {
      s.valueEdit?.controller.abort();
      s.valueEdit = undefined;
      this.sketchEdit = null;
      this.setTool('select');
      return;
    }
    s.obj = o;
    s.m = m;
    const json = String(o.shape.params.sketch);
    if (json !== s.json) {
      s.valueEdit?.controller.abort();
      s.valueEdit = undefined;
      s.trimPreview = s.trimPointer = undefined;
      s.trimPressed = undefined;
      if (s.tool === 'centerRect' || isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool) || s.draft.some(sketchPointLinked)) {
        s.draft = [];
        s.draftIds = [];
      }
      s.centerRectPress = undefined;
      s.frame = s.frameKeys = undefined;
      s.polyline = undefined;
      s.polylinePointer = undefined;
      s.sk = parseSketch(json);
      s.json = sketchJson(s.sk);
      s.sel.clear();
      this.sketchSolve(false);
    }
  }

  /** Skizze in das Objekt schreiben (Parameter und Umriss) */
  writeSketch(this: Editor) {
    const s = this.sketchEdit!;
    s.trimPreview = s.trimPointer = undefined;
    s.trimPressed = undefined;
    const shape = s.obj.shape as GenShape;
    s.json = sketchJson(s.sk);
    shape.params = { ...shape.params, sketch: s.json };
    shape.subs = sketchSubs(s.sk);
    this.touch(shape);
    this.emit('doc');
  }

  /** Formeln der Bemaßungen auswerten (Projekt-Parameter); liefert Fehlermeldungen ungültiger Formeln */
  sketchResolveExprs(this: Editor, sk: Sketch, scope?: Scope): NonNullable<SolveResult['inputIssues']> {
    const errs: NonNullable<SolveResult['inputIssues']> = [];
    const values: [SkCon, number][] = [];
    for (const c of sk.cons) {
      if (!c.expr) continue;
      try {
        const v = evaluate(c.expr, scope);
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          errs.push({ kind: 'formula', id: c.id, message: t('„{expr}“ ergibt keine Zahl.', { expr: c.expr }) });
          continue;
        }
        if (c.min !== undefined && v < c.min) {
          errs.push({ kind: 'geometry', id: c.id, message: t('„{expr}“ ergibt ein zu kleines Maß. Ändere die Formel oder den Projektparameter.', { expr: c.expr }) });
          continue;
        }
        if (!validRoundDimension(sk, c, v)) {
          errs.push({ kind: 'geometry', id: c.id, message: t('„{expr}“ ergibt kein darstellbares Kreismaß. Ändere die Formel oder den Projektparameter.', { expr: c.expr }) });
          continue;
        }
        values.push([c, v]);
      } catch (e) {
        errs.push({ kind: 'formula', id: c.id, message: `${c.expr}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    if (!errs.length) for (const [c, v] of values) c.v = v;
    return errs;
  }

  /**
   * Nach Änderung der Projekt-Parameter: Maße mit Formel neu auswerten und die Skizze neu lösen.
   * Ist der Löser noch nicht geladen, wird er geladen und die Parameter danach noch einmal angewendet.
   */
  refreshSketchParams(this: Editor, o: Obj, scope: Scope): Issue[] {
    if (!isSketchObj(o)) return [];
    // Phase 4: verlinkte Muster-Ausdrücke zuerst planen (validiert vor Mutation, Fehler nennt
    // Muster-ID und Parametername), dann in EINEM Undo-Schritt anwenden.
    if (this.sketchEdit?.obj === o) {
      const s = this.sketchEdit;
      const plan = planPatternParamRefresh(s.sk, patternParamResolver(this.paramList()));
      if ('error' in plan) return [{ level: 'error', msg: plan.error }];
      if (plan.updates.length) {
        let failed: string | null = null;
        const ok = this.sketchChange(t('Skizze: Muster'), (sk) => {
          for (const u of plan.updates) {
            const r = updatePattern(sk, u.id, u.params);
            if ('error' in r) { failed = `Muster ${u.id}: ${r.error}`; return false; }
          }
        });
        if (!ok) return [{ level: 'error', msg: failed ?? t('Die Muster ließen sich mit den neuen Maßen nicht nachführen.') }];
      }
      const r = this.sketchSolve(true);
      if (this.syncPatternsAfterSolve() > 0) this.writeSketch();
      this.emit('tool');
      return solveDiagnostics(r).map(({ kind, message }) => ({ level: 'error', msg: message ?? diagnosticTitle(kind) }));
    }
    const sk = parseSketch(o.shape.params.sketch);
    const plan = planPatternParamRefresh(sk, patternParamResolver(this.paramList()));
    if ('error' in plan) return [{ level: 'error', msg: plan.error }];
    if (!sk.cons.some((c) => c.expr) && !plan.updates.length) return [];
    if (!solverReady()) {
      loadSolver().then(() => this.applyParams(), () => {});
      return [];
    }
    if (plan.updates.length) {
      for (const u of plan.updates) {
        const r = updatePattern(sk, u.id, u.params);
        if ('error' in r) return [{ level: 'error', msg: `Muster ${u.id}: ${r.error}` }];
      }
    }
    const before = sk.cons.map((c) => c.v);
    const issues: Issue[] = this.sketchResolveExprs(sk, scope).map(({ message }) => ({ level: 'error', msg: message }));
    if (sk.cons.every((c, i) => c.v === before[i])) return issues;
    const r = solveSketch(sk);
    if (!r.ok) {
      issues.push({ level: 'error', msg: t('Die Skizze lässt sich mit den neuen Maßen nicht lösen.') });
      return issues;
    }
    const shape = o.shape as GenShape;
    shape.params = { ...shape.params, sketch: sketchJson(sk) };
    shape.subs = sketchSubs(sk);
    this.touch(shape);
    return issues;
  }

  /** Lösen; bei Erfolg (oder write=false) Status merken. Liefert das Ergebnis. */
  sketchSolve(this: Editor, write = true, drag?: { pt: number; x: number; y: number }, scope = scopeOf(this.paramList())): SolveResult {
    const s = this.sketchEdit!;
    s.rejectedDiagnostics = undefined;
    const lastValues = s.sk.cons.filter((c) => c.expr).map((c) => [c, c.v] as const);
    const issues = this.sketchResolveExprs(s.sk, scope);
    const r: SolveResult = issues.length
      ? { ok: false, dof: s.status?.dof ?? 0, conflicting: [], redundant: [], inputIssues: issues }
      : solveSketch(s.sk, drag ? { drag } : { definition: true });
    if (drag && r.ok && s.status?.definition) {
      r.definition = s.status.definition;
      r.dof = s.status.dof; // The temporary mouse lock is not part of the sketch definition.
    }
    if (!r.ok) for (const [c, v] of lastValues) c.v = v;
    if (r.ok || !drag) s.status = r;
    if (r.ok && write) this.writeSketch();
    return r;
  }

  /**
   * Lebende Muster-Richtungen nach dem Solve nachführen (F1): nur wenn ein Rechteckmuster
   * mit direction/direction2-Referenz existiert; Teil des laufenden Edits, kein eigener
   * Undo-Schritt; ohne Richtungsänderung kein Neubau. Der Aufrufer schreibt danach.
   */
  syncPatternsAfterSolve(this: Editor): number {
    const s = this.sketchEdit;
    if (!s || !(s.sk.patterns ?? []).some((p) => p.kind.type === 'rectangular' && (p.kind.direction !== undefined || p.kind.direction2 !== undefined))) return 0;
    return syncPatternDirections(s.sk).synced;
  }

  /**
   * Änderung an der Skizze als Undo-Schritt: fn ändert s.sk; schlägt das Lösen danach fehl, wird die Änderung
   * zurückgenommen (bei Beziehungen) bzw. trotzdem behalten, wenn keep gesetzt ist.
   */
  sketchChange(this: Editor, label: string, fn: (sk: Sketch) => void | false, opts: { keepOnFail?: boolean; preservePlacement?: ReadonlySet<number>; approvedLosses?: ReadonlySet<number>; pendingParam?: { name: string; value: number } } = {}): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    this.syncSketch();
    const before = cloneSketch(s.sk);
    const beforeStatus = s.status;
    const previousRedundant = new Set(s.status?.redundant);
    if (fn(s.sk) === false) { s.sk = before; return false; }
    const expected = opts.preservePlacement && cloneSketch(s.sk);
    const approvedLosses = opts.approvedLosses;
    if (!this.sketchCheckReferences(before, s.sk, approvedLosses)) {
      s.sk = before;
      this.emit('tool');
      this.redraw();
      return false;
    }
    const r = this.sketchSolve(false, undefined, dimParamScope(this, opts.pendingParam));
    const redundant = r.redundant.some((id) => id > 0 && !previousRedundant.has(id));
    const moved = r.ok && expected && changedPlacement(expected, s.sk, opts.preservePlacement!);
    if (moved && moved.size || r.inputIssues?.length || r.invalidGeometry || redundant || (!r.ok && !opts.keepOnFail)) {
      s.sk = before;
      s.status = beforeStatus;
      const existing = new Set(before.cons.map((c) => c.id));
      s.rejectedDiagnostics = solveDiagnostics(r).map((issue) => ({ ...issue, ids: issue.ids.filter((id) => existing.has(id)) }));
      if (moved && moved.size) {
        const refs = new Set(moved);
        for (const e of before.ents) if (moved.has(e.id) || entPoints(e).some((id) => moved.has(id))) {
          refs.add(e.id);
          for (const id of featureReferences(e)) refs.add(id);
        }
        s.rejectedDiagnostics.push({ kind: 'reference', ids: before.cons.filter((c) => refs.has(c.id) || c.r.some((id) => refs.has(id))).map((c) => c.id),
          message: t('Die vorhandenen Bedingungen lassen die gewünschte Lage nicht zu.') });
      }
      this.hint = s.rejectedDiagnostics.map(({ kind }) => diagnosticTitle(kind)).join(' · ');
      this.emit('tool');
      this.redraw();
      return false;
    }
    this.syncPatternsAfterSolve();
    this.snapshot(label);
    if (opts.pendingParam) materializeDimParam(this, opts.pendingParam);
    this.writeSketch();
    this.sketchHint();
    return true;
  }

  sketchCheckReferences(this: Editor, before: Sketch, after: Sketch, approvedLosses?: ReadonlySet<number>) {
    const broken = brokenFeatureReferences(before, after);
    const unapproved = lostConditions(before, after).filter((c) => !approvedLosses?.has(c.id));
    if (!broken.length && !unapproved.length) return true;
    this.hint = broken.length ? t('Diese Änderung würde Referenzen einer bestehenden Geometrie lösen: {refs}', {
      refs: broken.map(({ feature, id }) => `#${feature} → #${id}`).join(', '),
    }) : t('Diese Änderung würde Maße oder Beziehungen ohne Bestätigung entfernen.');
    this.sketchEdit!.rejectedDiagnostics = [{ kind: 'reference', message: this.hint, ids: [...broken.map(({ id }) => id), ...unapproved.map(({ id }) => id)] }];
    return false;
  }

  sketchHint(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    const tips: Record<SkTool, string> = {
      select: t('Skizze: Elemente anklicken (Shift ergänzt), Punkte ziehen, Beziehungen oben wählen. Doppelklick auf ein Maß ändert es. Entf löscht. Enter oder „Fertig“ beendet.'),
      line: t('Linie: Punkte anklicken, ein bestehender Punkt wird verbunden. Shift rastet den Winkel auf 45° ein. Punkt kurz halten merkt ihn für Lot- und Winkellinien, Esc vergisst. Doppelklick, Enter oder Esc beendet den Linienzug.'),
      constr: constrTip(s.constrMode ?? 'free'),
      polyline: s.polylineArc
        ? (s.polyline?.through ? t('Bogen: Endpunkt anklicken. A wechselt zur Geraden.') : t('Polylinie: A wechselt das Segment. Für einen Bogen erst einen Punkt auf dem Bogen, dann den Endpunkt anklicken.'))
        : t('Polylinie: Punkte anklicken oder Pfeiltasten und Einfg nutzen. Shift rastet auf 45° ein. A wechselt zum Bogen, Enter übernimmt, Esc verwirft. Am Startpunkt schließen. Punkt kurz halten merkt ihn für Lot- und Winkellinien.'),
      rect: (s.rectMode ?? 'corners') === 'threePoint'
        ? t('Rechteck: zwei Punkte einer Kante und einen Punkt für die Tiefe anklicken.')
        : (s.rectMode ?? 'corners') === 'centerCorner'
          ? t('Rechteck: Anker (Mitte) und eine Ecke anklicken.')
          : t('Rechteck: zwei gegenüberliegende Ecken anklicken.'),
      trim: t('Trimmen: Zeige auf die Kontur und klicke auf den Abschnitt, den du entfernen willst. Per Tastatur: Pfeiltasten und Enter.'),
      extend: t('Verlängern: Zeige auf ein Linienende und klicke, um es bis zur nächsten Kontur zu verlängern. Per Tastatur: Pfeiltasten und Enter.'),
      slot: (s.slotMode ?? 'centerToCenter') === 'overall'
        ? t('Langloch: Setze zwei Enden für die Gesamtlänge und dann die Breite. Per Tastatur: Pfeiltasten und Einfg.')
        : (s.slotMode ?? 'centerToCenter') === 'arcCenter'
          ? t('Langloch: Setze Bogenmitte, Anfang und Ende und dann die Breite. Per Tastatur: Pfeiltasten und Einfg.')
          : (s.slotMode ?? 'centerToCenter') === 'arcThreePoint'
            ? t('Langloch: Setze Start, Durchgang und Ende auf dem Bogen und dann die Breite. Per Tastatur: Pfeiltasten und Einfg.')
            : t('Langloch: Setze zwei Mittelpunkte entlang einer Achse und dann die Breite. Per Tastatur: Pfeiltasten und Einfg.'),
      roundRect: t('Rundrechteck: Setze Mittelpunkt, Ecke und anschließend den Radius innerhalb des Rechtecks. Per Tastatur: Pfeiltasten und Einfg.'),
      rotate: t('Drehen: Setze Drehpunkt, Ausgangsrichtung und Zielrichtung. Per Tastatur: Pfeiltasten und Einfg.'),
      mirror: t('Spiegeln: Setze zwei Punkte auf der Spiegelachse. Per Tastatur: Pfeiltasten und Einfg.'),
      polygon: s.polygonMode === 'edge'
        ? t('Polygon: Setze zwei Punkte einer Kante. Per Tastatur: Pfeiltasten und Einfg.')
        : t('Polygon: Setze den Mittelpunkt und einen Eckpunkt. Per Tastatur: Pfeiltasten und Einfg.'),
      circleOffset: t('Konturversatz: Wähle einen Kreis oder eine glatte konvexe Kontur und setze den Versatz innen oder außen.'),
      split: t('Aufteilen: Zeige auf eine Gerade oder einen Kreisbogen. Nahe der Mitte rastet der Teilpunkt ein. Klicke oder drücke Enter.'),
      chamfer: t('Fasen: Zeige nahe einer Ecke auf eine Kante. Der Abstand zur Ecke bestimmt die Fase. Klicke oder drücke Enter.'),
      fillet: t('Abrunden: Zeige nahe einer Ecke auf eine Kante. Der Abstand zur Ecke bestimmt den Radius. Klicke oder drücke Enter.'),
      centerRect: t('Mittelpunkt-Rechteck: vom Mittelpunkt zur Ecke ziehen oder beide Punkte anklicken. Pfeiltasten und Einfg funktionieren ebenfalls.'),
      circle: s.circleMode === 'twoPoint'
        ? t('Kreis: zwei gegenüberliegende Punkte des Durchmessers anklicken.')
        : s.circleMode === 'threePoint'
          ? t('Kreis: drei Punkte auf dem Kreis anklicken.')
          : s.circleMode === 'twoTangent'
            ? t('Kreis: zwei Tangentenziele (Linie, Kreis oder Bogen) anklicken, dann den Radius per Klickabstand festlegen.')
            : s.circleMode === 'threeTangent'
              ? t('Kreis: drei Geraden als Tangentenziele anklicken.')
              : t('Kreis: Mittelpunkt anklicken, dann einen Punkt auf dem Kreis.'),
      ellipse: t('Ellipse: Mittelpunkt, Hauptachsen-Ende und Nebenradius-Punkt anklicken.'),
      arc: (s.arcMode ?? 'centerStartEnd') === 'tangent'
        ? t('Bogen: Startpunkt (Endpunkt einer Linie oder eines Bogens) und dann den Endpunkt anklicken. U kehrt die Richtung um.')
        : t('Bogen: Mittelpunkt, Anfang und Ende anklicken (im Uhrzeigersinn).'),
      point: t('Punkt: vorhandenen Punkt anklicken oder freie Stelle anklicken. Esc bricht ab.'),
      dim: t('Bemaßen: Kante anklicken oder zwei Referenzen auswählen und D drücken. Klicken fixiert die Ablage, Enter übernimmt, Esc verwirft.'),
    };
    this.hint = tips[s.tool];
    this.emit('tool');
  }

  setSketchTool(this: Editor, tool: SkTool) {
    const s = this.sketchEdit;
    if (!s) return;
    if (s.patternDraft) this.cancelPatternDraft();
    s.valueEdit?.controller.abort();
    s.valueEdit = undefined;
    s.dimPress = undefined;
    if (s.relationPick) s.sel = s.relationPick.previous;
    s.relationPick = undefined;
    s.tool = tool;
    s.mirrorLineMode = false;
    s.snapCycle = undefined;
    this.clearTrack();
    s.draft = [];
    s.draftIds = [];
    s.circleRefs = undefined;
    s.constrRefs = undefined;
    s.constrCursor = undefined;
    s.arcRef = undefined;
    s.arcFlip = undefined;
    s.polyline = undefined;
    s.polylinePointer = undefined;
    s.centerRectPress = undefined;
    s.trimPreview = s.trimPointer = undefined;
    s.trimPressed = undefined;
    s.polylineKeys = undefined;
    s.frame = s.frameKeys = undefined;
    s.polylineArc = false;
    s.dimPick = [];
    s.dimRoundFlip = undefined;
    this.sketchHint();
    this.redraw();
    // Multi-reference dimensions start from the existing selection; a single edge starts immediately.
    if (tool === 'dim' && s.sel.size) {
      const hits = [...s.sel].map((id): SkHit => ptOf(s.sk, id) ? { kind: 'pt', id } : entOf(s.sk, id) ? { kind: 'ent', id } : null).filter((h) => h !== null);
      if (hits.length === 2) s.dimPick = [hits[0]];
      if (hits.length === 1 || hits.length === 2) this.sketchDimPick(hits[hits.length - 1]);
    }
  }

  // ---------- Koordinaten und Treffer ----------

  skToScreen(this: Editor, p: Pt): Pt {
    return this.toScreen(apply(this.sketchEdit!.m, p.x, p.y));
  }
  skFromWorld(this: Editor, p: Pt): Pt {
    return apply(inv(this.sketchEdit!.m), p.x, p.y);
  }
  /** Maßstab Skizze → Bildschirm */
  skScale(this: Editor): number {
    const m = this.sketchEdit!.m;
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * this.view.zoom;
  }

  sketchEdgeCandidates(this: Editor, sx: number, sy: number, tolerance = SNAP_PX) {
    const s = this.sketchEdit!;
    const sk = s.sk;
    const hits: { ent: SkEnt; distance: number }[] = [];
    const k = this.skScale();
    for (const e of sk.ents) {
      // Ausgeblendete Konstruktionsgeometrie ist auch nicht fangbar (Seitenmenü-Doku).
      if (!s.showConstruction && isConstructionGeometry(e)) continue;
      let d = Infinity;
      if (e.t === 'point') {
        const p = ptOf(sk, e.p);
        if (!p) continue;
        const q = this.skToScreen(p);
        d = Math.hypot(sx - q.x, sy - q.y);
      } else if (e.t === 'line') {
        const a = this.skToScreen(ptOf(sk, e.a)!),
          b = this.skToScreen(ptOf(sk, e.b)!);
        d = segDist(sx, sy, a, b);
      } else {
        const C = ptOf(sk, e.c)!;
        const w = this.skFromWorld(this.toWorld(sx, sy)), turn = 2 * Math.PI;
        if (e.t === 'ellipse') {
          // Normierte Ellipsengleichung: Abstand ≈ |ρ-1| · kleine Halbachse (Fangtoleranz reicht).
          const mp = ptOf(sk, e.m)!;
          const ax = mp.x - C.x, ay = mp.y - C.y, A = Math.hypot(ax, ay);
          if (A > 1e-9 && e.r > 1e-9) {
            const tx = ((w.x - C.x) * ax + (w.y - C.y) * ay) / (A * A);
            const px = (w.x - C.x) - tx * ax, py = (w.y - C.y) - tx * ay;
            const rho = Math.hypot(tx, Math.hypot(px, py) / e.r);
            d = Math.abs(rho - 1) * Math.min(A, e.r) * k;
          }
        } else {
          const angle = Math.atan2(w.y - C.y, w.x - C.x);
          const relative = e.t === 'arc' ? ((angle - e.a0) % turn + turn) % turn : 0;
          if (e.t === 'arc' && relative > e.a1 - e.a0) {
            d = Math.min(...[e.s, e.e].map((id) => {
              const q = this.skToScreen(ptOf(sk, id)!);
              return Math.hypot(sx - q.x, sy - q.y);
            }));
          } else {
            const c = this.skToScreen(C);
            d = Math.abs(Math.hypot(sx - c.x, sy - c.y) - e.r * k);
          }
        }
      }
      if (d < tolerance) hits.push({ ent: e, distance: d });
    }
    return hits.sort((a, b) => a.distance - b.distance || Number(!!a.ent.aux) - Number(!!b.ent.aux) || a.ent.id - b.ent.id);
  }

  sketchSelectionCandidates(this: Editor, sx: number, sy: number): NonNullable<SkHit>[] {
    const labels = this.sketchEdit!.labels.filter((l) => sx >= l.x && sx <= l.x + l.w && sy >= l.y && sy <= l.y + l.h);
    const hits = [...this.sketchPointCandidates(sx, sy).map(({ id }) => ({ kind: 'pt' as const, id })),
      ...labels.map(({ id }) => ({ kind: 'con' as const, id })),
      ...this.sketchEdgeCandidates(sx, sy).map(({ ent }) => ({ kind: 'ent' as const, id: ent.id }))];
    const s = this.sketchEdit!, type = s.relationPick?.type;
    if (!type) return hits;
    return hits.filter((h) => h.kind !== 'con' && (s.sel.has(h.id) ||
      conFromSel(s.sk, [...s.sel, h.id], type) || canPickRelationPart(s.sk, s.sel, h, type)));
  }

  sketchHitTest(this: Editor, sx: number, sy: number): SkHit {
    const hits = this.sketchSelectionCandidates(sx, sy);
    return hits[this.sketchCycleIndex(sx, sy) % hits.length] ?? null;
  }

  sketchSelectHit(this: Editor, id: number, add: boolean) {
    const s = this.sketchEdit!;
    if (add && s.sel.has(id)) s.sel.delete(id);
    else {
      if (!add && !s.sel.has(id)) s.sel.clear();
      s.sel.add(id);
    }
  }

  /** Persistenter Skizzenfang, sonst Objekt-/Rasterfang für die Platzierung. */
  sketchPointCandidates(this: Editor, sx: number, sy: number) {
    return this.sketchEdit!.sk.pts.map((p) => {
      const q = this.skToScreen(p);
      return { id: p.id, distance: Math.hypot(q.x - sx, q.y - sy) };
    }).filter((p) => p.distance < SNAP_PX + 2).sort((a, b) => a.distance - b.distance || a.id - b.id);
  }

  sketchCycleIndex(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit!, cycle = s.snapCycle;
    return cycle && Math.hypot(sx - cycle.at.x, sy - cycle.at.y) <= 2 ? cycle.index : 0;
  }

  sketchPlacementCandidates(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const s = this.sketchEdit!;
    type Pick = { p: SketchPickedPoint; id: number | null; kind: 'node' | 'center' | 'mid' | 'cross'; distance: number };
    const picks: Pick[] = this.sketchPointCandidates(sx, sy).map(({ id, distance }) => {
      const { x, y } = ptOf(s.sk, id)!;
      const center = s.sk.ents.some((ent) => (ent.t === 'circle' || ent.t === 'arc' || ent.t === 'ellipse') && ent.c === id);
      return { p: { x, y }, id, distance, kind: center ? 'center' : 'node' };
    });
    const midpointPlacement = s.tool === 'line' || s.tool === 'rect' || s.tool === 'polyline' || s.tool === 'arc' || s.tool === 'point'
      || s.tool === 'constr'
      || s.tool === 'centerRect' || s.tool === 'polygon'
      || ((s.tool === 'circle' || s.tool === 'ellipse' || s.tool === 'roundRect') && !s.draft.length) || (s.tool === 'slot' && s.draft.length < 2) || isSketchTransform(s.tool);
    if (midpointPlacement && this.snapModes(e, true).obj) {
      const tol = this.snapTol();
      const limit = e.altKey ? tol.alt : tol.normal;
      const virtual: Pick[] = [];
      const add = (p: SketchPickedPoint, kind: 'mid' | 'cross') => {
        const q = this.skToScreen(p), distance = Math.hypot(q.x - sx, q.y - sy);
        if (distance < limit && !picks.some((k) => Math.hypot(k.p.x - p.x, k.p.y - p.y) < 1e-6)) virtual.push({ p, id: null, distance, kind });
      };
      for (const line of s.sk.ents) {
        if (line.t !== 'line' || line.trimSupport
          || (!s.showConstruction && isConstructionGeometry(line))) continue;
        const a = ptOf(s.sk, line.a), b = ptOf(s.sk, line.b);
        if (!a || !b) continue;
        add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, midpointOf: line.id }, 'mid');
      }
      const edges = this.sketchEdgeCandidates(sx, sy, limit).map(({ ent }) => ent)
        .filter((ent) => !ent.trimSupport).sort((a, b) => a.id - b.id);
      for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i], b = edges[j];
        for (const { x, y, branch } of sketchEdgeIntersections(s.sk, a, b, true)) {
          add(branch ? { x, y, intersection: { edges: [a.id, b.id], branch } } : { x, y }, 'cross');
        }
      }
      picks.push(...virtual.sort((a, b) => a.distance - b.distance || Number(b.kind === 'cross') - Number(a.kind === 'cross')));
    }
    return picks;
  }

  sketchPointAt(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }): { p: SketchPickedPoint; id: number | null } {
    const s = this.sketchEdit!, hits = this.sketchPlacementCandidates(sx, sy, e);
    const pick = hits[this.sketchCycleIndex(sx, sy) % hits.length];
    s.linkedSnap = !!pick && (pick.id !== null || sketchPointLinked(pick.p));
    s.boundCrossSnap = !!pick?.p.intersection;
    if (pick) {
      if (!isSketchCircleTool(s.tool)) s.hover = pick.id !== null ? { kind: 'pt', id: pick.id } : null;
      this.clearSnap();
      const wp = apply(s.m, pick.p.x, pick.p.y);
      this.snapHit = { p: wp, kind: pick.kind };
      // Hover-Dwell auch für Skizzen-Treffer: erst so lassen sich Ecken/Mitten als Projektions-Anker merken
      if (this.snapModes(e, true).obj) {
        const tolPx = e.altKey ? this.snapTol().alt : this.snapTol().normal;
        this.trackDwellOnHit(wp, tolPx / this.view.zoom);
      }
      return pick;
    }
    const w = sketchSnapActive(s)
      ? this.snapPt(this.toWorld(sx, sy), e, { toggle: true, track: s.draft.length ? [apply(s.m, s.draft[s.draft.length - 1].x, s.draft[s.draft.length - 1].y)] : undefined, extensions: true })
      : this.toWorld(sx, sy);
    const free = this.skFromWorld(w);
    // Winkelfang (Linie): Shift legt freie Endpunkte auf das nächste 45°-Raster um den Anfang; Treffer behalten Vorrang.
    if (e.shiftKey && s.tool === 'line' && s.draft.length && !this.snapHit) {
      const anchor = s.draft[s.draft.length - 1];
      const q = this.sketchAngleSnap(anchor, free);
      return { p: { ...free, x: q.x, y: q.y }, id: null };
    }
    return { p: free, id: null };
  }

  /** Winkelfang mit sichtbarer Projektion: freier Punkt aufs 45°-Raster um den Anker, Strahl als Führung */
  sketchAngleSnap(this: Editor, anchor: Pt, free: Pt): Pt {
    const s = this.sketchEdit!;
    const q = snapToAngleStep(anchor, free);
    const g = angleGuide(anchor, q, 12 / this.skScale());
    this.alignGuides = [{ axis: 'seg', a: apply(s.m, g.a.x, g.a.y), b: apply(s.m, g.b.x, g.b.y) }];
    this.snapHit = { p: apply(s.m, q.x, q.y), kind: 'angle' };
    return q;
  }

  sketchMirrorAxis(this: Editor, sx: number, sy: number): [Pt, Pt] | undefined {
    const s = this.sketchEdit;
    if (!s) return;
    let distance = SNAP_PX, result: [Pt, Pt] | undefined;
    for (const e of s.sk.ents) if (e.t === 'line' && !e.trimSupport) {
      const a = ptOf(s.sk, e.a), b = ptOf(s.sk, e.b);
      if (!a || !b) continue;
      const d = segDist(sx, sy, this.skToScreen(a), this.skToScreen(b));
      if (d < distance) { result = [a, b]; distance = d; }
    }
    return result;
  }

  sketchTransformMessage(this: Editor, result: SketchTransformBlock) {
    const refs = new Set(result.blocking);
    if (result.unsupported) return t('Die Transformation ergibt ungültige Koordinaten.');
    const conditions = this.sketchEdit?.sk.cons.filter((c) => refs.has(c.id)).map((c) => `${CON_LABELS[c.t]} #${c.id}`) ?? [];
    return [result.external?.length ? t('Nicht ausgewählte Elemente bleiben unverändert: {ids}', { ids: result.external.map((id) => `#${id}`).join(', ') }) : '',
      conditions.length ? t('Diese Beziehungen verhindern die Transformation: {relations}', { relations: conditions.join(', ') }) : ''].filter(Boolean).join(' · ')
      || t('Wähle alle verbundenen sichtbaren Elemente aus. Beziehungen zur restlichen Skizze werden nicht gelöst.');
  }

  commitSketchTransform(this: Editor, m: Mat | undefined, mirror: boolean) {
    this.syncSketch();
    const s = this.sketchEdit;
    if (!m || !s) return;
    const result = transformedSketch(s.sk, s.sel, m, mirror);
    if ('blocking' in result) {
      s.rejectedDiagnostics = [{ kind: result.unsupported ? 'geometry' : 'reference', ids: result.blocking }];
      this.hint = this.sketchTransformMessage(result);
      s.rejectedDiagnostics[0].message = this.hint;
      this.emit('tool');
    } else if (this.sketchChange(mirror ? t('Spiegeln') : t('Drehen'), (sk) => { Object.assign(sk, result.sketch); }, { preservePlacement: result.driven })) this.setSketchTool('select');
    this.redraw();
  }

  // ---------- Muster-Fenster (Phase 2): Entwurf, Klick-Routing, Commit ----------

  /** Entwurf öffnen (ohne Commit): Vorselektion → Elemente, genau eine gerade Hilfslinie → Spiegellinie. */
  startPatternDraft(this: Editor, kind: PatternToolKind): PatternDraft | null {
    const s = this.sketchEdit;
    if (!s) return null;
    if (s.patternDraft) this.cancelPatternDraft();
    // Verwaiste Gesten ausräumen: sonst liefe ein offener Rahmen ins Dokument statt in den Entwurf.
    s.frame = undefined;
    s.frameKeys = undefined;
    s.drag = null;
    const entities: number[] = [];
    const auxLines: number[] = [];
    for (const id of s.sel) {
      const e = entOf(s.sk, id);
      if (e) {
        if (e.t === 'line' && isConstructionGeometry(e)) auxLines.push(id);
        else if (!isConstructionGeometry(e)) entities.push(id);
        continue;
      }
      if (ptOf(s.sk, id) && !entities.includes(id)) entities.push(id);
    }
    const draft: PatternDraft = {
      kind, entities, active: 'entities',
      countText: kind === 'circular' ? '4' : '3', count2Text: '2',
      spacingText: '20', spacing2Text: '20', angleText: '360',
      reversed: false, reversed2: false, centered: false, centered2: false, error: '',
    };
    // Genau eine gerade Hilfslinie in der Auswahl belegt die Spiegellinie vor (nur aktive Skizze,
    // ohne Preference-Schalter — Abweichung vom Spec, siehe Phase-5-Vermerk).
    if (kind === 'mirror' && auxLines.length === 1) draft.line = auxLines[0];
    s.patternDraft = draft;
    this.redraw();
    return draft;
  }

  /** Klick-Routing bei offenem Fenster: Kurven/Punkte immer → Elemente, sonst in die aktive Eingabe. */
  sketchPatternClick(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d) return;
    d.error = '';
    const hit = this.sketchHitTest(sx, sy);
    if (!hit) {
      // Klick ins Leere: nur bei aktivem Mittelpunkt als Freiraum-Punkt vormerken.
      if (d.kind === 'circular' && d.active === 'center') {
        d.freeCenter = this.skFromWorld(this.toWorld(sx, sy));
        d.center = undefined;
      }
      notifyPatternDialog(this);
      return;
    }
    const toggleEntity = (id: number) => {
      d.entities = d.entities.includes(id) ? d.entities.filter((e) => e !== id) : [...d.entities, id];
    };
    if (hit.kind === 'pt') {
      // Punkt-Klick bei aktivem Mittelpunkt → dorthin, sonst immer Elemente (auch bei aktiver Richtung).
      if (d.kind === 'circular' && d.active === 'center') {
        d.center = hit.id;
        d.freeCenter = undefined;
        advancePatternSingle(d);
      } else toggleEntity(hit.id);
      notifyPatternDialog(this);
      return;
    }
    const e = entOf(s.sk, hit.id);
    if (!e) { notifyPatternDialog(this); return; }
    // Linien-Klick bei aktiver Richtung/Spiegellinie → dorthin (erneuter Klick löst die
    // Belegung — Spiegellinie per Klick abwählbar); sonst alles → Elemente.
    const lineSlots = d.kind === 'mirror' ? ['line'] : d.kind === 'rectangular' ? ['direction', 'direction2'] : [];
    if (e.t === 'line' && (lineSlots as string[]).includes(d.active)) {
      if (d.active !== 'entities' && patternSingleOf(d, d.active) === hit.id) {
        clearPatternSingle(d, d.active);
      } else {
        setPatternSingle(d, d.active, hit.id);
        advancePatternSingle(d);
      }
    } else toggleEntity(hit.id);
    notifyPatternDialog(this);
  }

  /** Rechtsklick: aktive Eingabe bestätigen → nächste leere, sonst OK (kein Kontextmenü-Pfad). */
  sketchPatternRight(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d) return false;
    const singles = PATTERN_SINGLES[d.kind];
    const empty = singles.filter((k) => singleEmpty(d, k));
    if (!empty.length) return this.confirmPatternOK();
    if (d.active !== 'entities' && (singles as string[]).includes(d.active) && singleEmpty(d, d.active as SingleSlot)) {
      const rest = singles.slice(singles.indexOf(d.active as SingleSlot) + 1);
      d.active = rest.find((k) => singleEmpty(d, k)) ?? 'entities';
    } else {
      d.active = empty[0];
    }
    d.error = '';
    notifyPatternDialog(this);
    this.redraw();
    return true;
  }

  // ---------- Muster-Fenster (Phase 3): Abstands-Pfeile und Ziehen ----------

  /**
   * Pfeil unter dem Zeiger (0 = Richtung 1, 1 = Richtung 2), sonst null.
   * Nur bei offenem Rechteck-Fenster mit gültiger Belegung und nur in Pfeilnähe
   * (Screen-Toleranz SNAP_PX wie die Griff-Toleranz des Editors); sonst alles wie bisher.
   */
  sketchPatternArrowAt(this: Editor, sx: number, sy: number): 0 | 1 | null {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d || d.kind !== 'rectangular') return null;
    const arrows = patternSpacingArrows(s.sk, d, patternParamResolver(this.doc.params));
    if (!arrows?.length) return null;
    let best: 0 | 1 | null = null, bestD = SNAP_PX;
    for (const a of arrows) {
      const o = this.skToScreen(a.origin);
      const tip = this.skToScreen({ x: a.origin.x + a.vec.x * a.spacing, y: a.origin.y + a.vec.y * a.spacing });
      const dist = segDist(sx, sy, o, tip);
      if (dist < bestD) { bestD = dist; best = a.dir; }
    }
    return best;
  }

  /**
   * Abstands-Ziehen: Cursor-Projektion auf die Pfeilachse (Weltkoordinaten) → neuer Abstand.
   * Setzt den Entwurfstext als Zahl (ein Ausdruckstext wird dabei ersetzt — der Entwurf bleibt
   * bis OK/Übernehmen uncommittet). Ziehen über den Startpunkt kippt das Vorzeichen.
   */
  sketchPatternDragTo(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit, drag = s?.patternDrag, d = s?.patternDraft;
    if (!s || !drag || !d) return;
    const arrows = patternSpacingArrows(s.sk, d, patternParamResolver(this.doc.params));
    const arrow = arrows?.find((a) => a.dir === drag.dir);
    if (!arrow) return;
    const cursor = this.skFromWorld(this.toWorld(sx, sy));
    const v = projectPatternSpacing(arrow.origin, arrow.vec, cursor);
    const text = formatPatternSpacing(v);
    if (drag.dir === 0) d.spacingText = text;
    else d.spacing2Text = text;
    const checked = validatePatternDraft(s.sk, d, patternParamResolver(this.doc.params));
    d.error = 'error' in checked ? checked.error : '';
    notifyPatternDialog(this);
    this.redraw();
  }

  /** Geometrie in EINEM Undo-Schritt bauen (Spiegeln: kein Muster-Objekt); null = Erfolg. */
  commitPatternGeometry(this: Editor): string | null {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d) return 'Kein Musterentwurf geöffnet.';
    const v = validatePatternDraft(s.sk, d, patternParamResolver(this.doc.params));
    if ('error' in v) return v.error;
    let buildError: string | null = null;
    const label = d.kind === 'mirror' ? t('Spiegeln') : d.kind === 'circular' ? t('Kreismuster') : t('Rechteckmuster');
    const ok = this.sketchChange(label, (sk) => {
      if (v.kind === 'mirror') {
        const r = mirrorEntities(sk, { entities: v.entities, line: v.line });
        if ('error' in r) { buildError = r.error; return false; }
        return;
      }
      const r = v.kind === 'circular'
        ? buildCircularPattern(sk, {
          entities: v.entities, center: v.center, count: v.count, angle: v.angle,
          alignment: v.centered ? 'center' : 'right', reversed: v.reversed,
          ...(v.expressions ? { expressions: v.expressions } : {}),
        })
        : buildRectangularPattern(sk, {
          entities: v.entities, count: v.count, spacing: v.spacing, count2: v.count2, spacing2: v.spacing2,
          ...(v.direction !== undefined ? { direction: v.direction } : {}),
          ...(v.direction2 !== undefined ? { direction2: v.direction2 } : {}),
          alignment: v.centered ? 'center' : 'right', alignment2: v.centered2 ? 'center' : 'right',
          reversed: v.reversed, reversed2: v.reversed2,
          ...(v.expressions ? { expressions: v.expressions } : {}),
        });
      if ('error' in r) { buildError = r.error; return false; }
    });
    if (!ok) return buildError ?? 'Das Muster konnte nicht angewendet werden.';
    return null;
  }

  /** OK-Router: im Edit-Modus Update mit ID, sonst neues Muster. */
  confirmPatternOK(this: Editor): boolean {
    const d = this.sketchEdit?.patternDraft;
    return d?.editPatternId ? this.confirmPatternEdit() : this.confirmPatternDraft();
  }

  /** OK: validieren, committen, Fenster zu. */
  confirmPatternDraft(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d) return false;
    const err = this.commitPatternGeometry();
    if (err !== null) {
      d.error = err;
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    this.cancelPatternDraft();
    return true;
  }

  /** Übernehmen: gleicher Commit, Picks löschen, Werte behalten, Fenster bleibt offen. */
  applyPatternDraft(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    if (!s || !d) return false;
    const err = this.commitPatternGeometry();
    if (err !== null) {
      d.error = err;
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    const { kind, countText, count2Text, spacingText, spacing2Text, angleText, reversed, reversed2, centered, centered2 } = d;
    s.patternDraft = {
      kind, entities: [], active: 'entities', countText, count2Text, spacingText, spacing2Text, angleText,
      reversed, reversed2, centered, centered2, error: '',
    };
    notifyPatternDialog(this);
    this.redraw();
    return true;
  }

  /** Abbrechen/Escape/X: Entwurf inkl. vorgemerktem Freiraum-Punkt verwerfen (doc unberührt). */
  cancelPatternDraft(this: Editor) {
    const s = this.sketchEdit;
    if (!s?.patternDraft) return;
    s.patternDraft = null;
    // Offener Abstands-Zug und Rahmen gehören zum Entwurf: ohne Aufräumen schluckt der
    // Zug alle Moves, und ein überlebender Rahmen liefe ins Dokument statt in den Entwurf.
    s.patternDrag = null;
    s.frame = undefined;
    s.frameKeys = undefined;
    const close = s.patternClose;
    s.patternClose = null;
    setPatternDialogRefresh(this, null);
    close?.();
    this.redraw();
  }

  // ---------- Muster-Fenster (Phase 4): Editieren, Auflösen, Entfernen, Param-Nachführung ----------

  /**
   * Badge unter dem Zeiger (Muster-ID, sonst null). Screen-Toleranz SNAP_PX wie die
   * Griff-Toleranz des Editors; reine Lese-Funktion.
   */
  sketchPatternBadgeAt(this: Editor, sx: number, sy: number): string | null {
    const s = this.sketchEdit;
    if (!s) return null;
    let best: string | null = null, bestD = SNAP_PX;
    for (const p of s.sk.patterns ?? []) {
      const a = patternBadgeAnchor(s.sk, p);
      if (!a) continue;
      const q = this.skToScreen(a);
      const d = Math.hypot(sx - q.x, sy - q.y);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  /**
   * Edit-Entwurf öffnen (ohne Commit): Zahlen als gespeicherte Texte (Ausdrücke als Text,
   * keine Auflösung), Ausrichtung aus der Art, Typwechsel unmöglich (Fenster zeigt nur
   * die eigene Art). Gibt null zurück, wenn das Muster unbekannt ist.
   */
  startPatternEditDraft(this: Editor, patternId: string): PatternDraft | null {
    const s = this.sketchEdit;
    if (!s) return null;
    const pattern = (s.sk.patterns ?? []).find((p) => p.id === patternId);
    if (!pattern) return null;
    if (s.patternDraft) this.cancelPatternDraft();
    s.frame = undefined;
    s.frameKeys = undefined;
    s.drag = null;
    const text = (v: number, key: PatternExpressionKey): string => pattern.expressions?.[key] ?? String(v);
    const kind: PatternToolKind = pattern.kind.type === 'circular' ? 'circular' : 'rectangular';
    const base: PatternDraft = {
      kind, entities: [...pattern.entities], active: 'entities',
      countText: '3', count2Text: '2', spacingText: '20', spacing2Text: '20', angleText: '360',
      reversed: false, reversed2: false, centered: false, centered2: false, error: '',
      editPatternId: pattern.id,
    };
    if (pattern.kind.type === 'circular') {
      const k = pattern.kind;
      Object.assign(base, {
        center: k.center, countText: text(k.count, 'count'), angleText: text(k.angle, 'angle'),
        reversed: k.reversed, centered: k.alignment === 'center',
      });
    } else {
      const k = pattern.kind;
      Object.assign(base, {
        ...(k.direction !== undefined ? { direction: k.direction } : {}),
        ...(k.direction2 !== undefined ? { direction2: k.direction2 } : {}),
        countText: text(k.count, 'count'), count2Text: text(k.count2, 'count2'),
        spacingText: text(k.spacing, 'spacing'), spacing2Text: text(k.spacing2, 'spacing2'),
        reversed: k.reversed, reversed2: k.reversed2,
        centered: k.alignment === 'center', centered2: k.alignment2 === 'center',
      });
    }
    s.patternDraft = base;
    this.redraw();
    return base;
  }

  /** OK im Edit-Fenster: validieren, dann updatePattern mit ID in EINEM Undo-Schritt, Fenster zu. */
  confirmPatternEdit(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    const id = d?.editPatternId;
    if (!s || !d || !id) return false;
    const v = validatePatternDraft(s.sk, d, patternParamResolver(this.doc.params));
    if ('error' in v || v.kind === 'mirror') {
      d.error = 'error' in v ? v.error : 'Art des Musters kann nicht geändert werden (Kreis ↔ Rechteck).';
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    let buildError: string | null = null;
    const label = v.kind === 'circular' ? t('Kreismuster bearbeiten') : t('Rechteckmuster bearbeiten');
    const params: UpdatePatternParams = v.kind === 'circular'
      ? {
        type: 'circular', entities: v.entities, center: v.center, count: v.count, angle: v.angle,
        alignment: v.centered ? 'center' : 'right', reversed: v.reversed,
        ...(v.expressions ? { expressions: v.expressions } : {}),
      }
      : {
        type: 'rectangular', entities: v.entities, count: v.count, spacing: v.spacing,
        count2: v.count2, spacing2: v.spacing2,
        ...(v.direction !== undefined ? { direction: v.direction } : {}),
        ...(v.direction2 !== undefined ? { direction2: v.direction2 } : {}),
        alignment: v.centered ? 'center' : 'right', alignment2: v.centered2 ? 'center' : 'right',
        reversed: v.reversed, reversed2: v.reversed2,
        ...(v.expressions ? { expressions: v.expressions } : {}),
      };
    const ok = this.sketchChange(label, (sk) => {
      const r = updatePattern(sk, id, params);
      if ('error' in r) { buildError = r.error; return false; }
    });
    if (!ok) {
      d.error = buildError ?? t('Das Muster konnte nicht angewendet werden.');
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    this.cancelPatternDraft();
    return true;
  }

  /**
   * Auflösen: Muster-Assoziation löschen (Eintrag raus, Geometrie bleibt), ein Undo-Schritt.
   * Fenster zu bei Erfolg.
   */
  dissolvePatternDraft(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    const id = d?.editPatternId;
    if (!s || !d || !id) return false;
    const ok = this.sketchChange(t('Skizzenmuster auflösen'), (sk) => {
      const list = sk.patterns ?? [];
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      if (!list.length) delete sk.patterns;
    });
    if (!ok) {
      d.error = t('Muster ist unbekannt oder gelöscht.');
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    this.cancelPatternDraft();
    return true;
  }

  /**
   * Entfernen: Kopien löschen (Ents + exklusive Punkte via deleteIds) + Eintrag raus,
   * Quellen bleiben; ein Undo-Schritt. Fenster zu bei Erfolg.
   */
  removePatternDraftCopies(this: Editor): boolean {
    const s = this.sketchEdit, d = s?.patternDraft;
    const id = d?.editPatternId;
    if (!s || !d || !id) return false;
    const pattern = (s.sk.patterns ?? []).find((p) => p.id === id);
    if (!pattern) {
      d.error = t('Muster ist unbekannt oder gelöscht.');
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    const { curves, points } = patternChildren(pattern);
    const gone = new Set([...curves, ...points]);
    const ok = this.sketchChange(t('Skizzenmuster entfernen'), (sk) => {
      deleteIds(sk, gone);
      const list = sk.patterns ?? [];
      const i = list.findIndex((p) => p.id === id);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) delete sk.patterns;
    });
    if (!ok) {
      d.error = t('Das Muster konnte nicht angewendet werden.');
      notifyPatternDialog(this);
      this.redraw();
      return false;
    }
    for (const gid of gone) s.sel.delete(gid);
    this.cancelPatternDraft();
    return true;
  }

  /** Kreis-Varianten (Paket 1): Durchmesser-, Umkreis- und Tangenten-Modi; Legacy läuft im sketchDown-Zweig. */
  sketchCircleModeDown(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }) {
    const s = this.sketchEdit;
    if (!s) return;
    const mode = s.circleMode ?? 'centerRim';
    if (mode === 'twoTangent' || mode === 'threeTangent') {
      if (mode === 'twoTangent' && (s.circleRefs?.length ?? 0) === 2) {
        const refs = [...(s.circleRefs ?? [])];
        const cursor = this.skFromWorld(this.toWorld(sx, sy));
        const r = twoTangentRadiusFor(s.sk, refs[0], refs[1], cursor);
        if (r === null || !(r > 1e-9)) {
          this.hint = t('Mit diesem Radius gibt es keinen Kreis an beiden Referenzen.');
          this.emit('tool');
          this.redraw();
          return;
        }
        const found = twoTangentCandidates(s.sk, refs[0], refs[1], r, cursor)[0];
        if (!found) {
          this.hint = t('Mit diesem Radius gibt es keinen Kreis an beiden Referenzen.');
          this.emit('tool');
          this.redraw();
          return;
        }
        if (this.sketchChange(t('Skizze: Kreis'), (sk) => {
          const from = sk.next;
          const ok = addTangentCircleAt(sk, refs, found, r, true);
          if (s.drawAux) markAuxFrom(sk, from);
          if (!ok) return false;
        })) {
          s.circleRefs = undefined;
          s.draft = [];
          s.draftIds = [];
        }
        this.emit('tool');
        this.redraw();
        return;
      }
      const hit = this.sketchSelectionCandidates(sx, sy).find((h) => h.kind === 'ent');
      const kind = hit ? tangentRefKind(s.sk, hit.id) : null;
      if (!hit || !kind) {
        this.hint = t('Als Tangentenziele eignen sich Linien, Kreise und Bögen — keine Ellipsen, Punkte oder Musterelemente.');
      } else if (mode === 'threeTangent' && kind !== 'line') {
        this.hint = t('Für drei Tangenten nur Geraden wählen.');
      } else {
        const refs = [...(s.circleRefs ?? [])];
        if (refs.includes(hit.id)) this.hint = t('Diese Referenz ist bereits gewählt.');
        else {
          refs.push(hit.id);
          const need = mode === 'twoTangent' ? 2 : 3;
          if (refs.length < need) {
            s.circleRefs = refs;
            this.hint = t('Tangentenziele: {n} von {m} gewählt.', { n: refs.length, m: need });
            this.emit('tool');
            return;
          }
          const cursor = this.skFromWorld(this.toWorld(sx, sy));
          if (mode === 'threeTangent') {
            const found = threeTangentCandidates(s.sk, refs, cursor)[0];
            if (!found) {
              this.hint = t('Diese drei Geraden haben keinen gemeinsamen Tangentialkreis.');
            } else if (this.sketchChange(t('Skizze: Kreis'), (sk) => {
              const from = sk.next;
              const ok = addTangentCircleAt(sk, refs, found.center, found.radius, false);
              if (s.drawAux) markAuxFrom(sk, from);
              if (!ok) return false;
            })) {
              s.draft = [];
              s.draftIds = [];
              return;
            }
          } else {
            s.circleRefs = refs;
            this.hint = t('Radius per Klick festlegen: Abstand zur nächsten Referenz bestimmt den Radius.');
            this.emit('tool');
            this.redraw();
            return;
          }
        }
      }
      this.emit('tool');
      return;
    }
    const { p, id } = this.sketchPointAt(sx, sy, e);
    s.draft.push(p);
    s.draftIds.push(id);
    if (s.draft.length < (mode === 'twoPoint' ? 2 : 3)) return;
    const pts = s.draft, ids = s.draftIds;
    if (mode === 'twoPoint') {
      if (!twoPointCircle(pts[0], pts[1])) {
        this.hint = t('Die beiden Punkte müssen verschieden sein.');
        s.draft = [];
        s.draftIds = [];
        this.emit('tool');
        return;
      }
      if (this.sketchChange(t('Skizze: Kreis'), (sk) => {
        const from = sk.next;
        const ok = addTwoPointCircle(sk, pts[0], pts[1], ids[0], ids[1]);
        if (s.drawAux) markAuxFrom(sk, from);
        if (!ok) return false;
      })) {
        s.draft = [];
        s.draftIds = [];
      }
      return;
    }
    if (!circumcenter(pts[0], pts[1], pts[2])) {
      this.hint = t('Die drei Punkte liegen auf einer Geraden — kein Kreis möglich.');
      s.draft = [];
      s.draftIds = [];
      this.emit('tool');
      return;
    }
    if (this.sketchChange(t('Skizze: Kreis'), (sk) => {
      const from = sk.next;
      const ok = addThreePointCircle(sk, pts[0], pts[1], pts[2], ids[0], ids[1], ids[2]);
      if (s.drawAux) markAuxFrom(sk, from);
      if (!ok) return false;
    })) {
      s.draft = [];
      s.draftIds = [];
    }
  }

  /** Rechteck-Varianten (Paket 2): 3-Punkt- und Mitte-Ecke-Modi; Legacy läuft im rect-Zweig. */
  sketchRectModeDown(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }) {
    const s = this.sketchEdit;
    if (!s) return;
    const mode = s.rectMode ?? 'corners';
    if (mode === 'corners') return;
    const { p, id } = this.sketchPointAt(sx, sy, e);
    const need = mode === 'threePoint' ? 3 : 2;
    if (s.draft.length < need - 1) {
      s.draft.push(p);
      s.draftIds.push(id);
      return;
    }
    const pts = [...s.draft, p], ids = [...s.draftIds, id];
    if (mode === 'threePoint') {
      if (!threePointRectCorners(pts[0], pts[1], pts[2])) {
        this.hint = t('Die drei Punkte bilden keine Kante mit Tiefe — kein Rechteck möglich.');
        s.draft = [];
        s.draftIds = [];
        this.emit('tool');
        return;
      }
      if (this.sketchChange(t('Skizze: Rechteck'), (sk) => {
        const from = sk.next;
        const ok = addThreePointRectangle(sk, pts[0], pts[1], pts[2], ids[0], ids[1], ids[2]);
        if (s.drawAux) markAuxFrom(sk, from);
        if (!ok) return false;
      })) {
        s.draft = [];
        s.draftIds = [];
      }
      return;
    }
    if (!centerCornerRectCorners(pts[0], pts[1])) {
      this.hint = t('Anker und Ecke müssen verschiedene x- und y-Werte haben.');
      s.draft = [];
      s.draftIds = [];
      this.emit('tool');
      return;
    }
    if (this.sketchChange(t('Skizze: Rechteck'), (sk) => {
      const from = sk.next;
      const ok = addCenterCornerRectangle(sk, pts[0], pts[1], ids[0], ids[1]);
      if (s.drawAux) markAuxFrom(sk, from);
      if (!ok) return false;
    })) {
      s.draft = [];
      s.draftIds = [];
    }
  }

  /** Langloch-Varianten (Paket 3): Referenzen sammeln, Breite messen, genau ein Slot je sketchChange. */
  sketchSlotClick(this: Editor, p: SketchPickedPoint, id: number | null) {
    const s = this.sketchEdit;
    if (!s) return;
    const mode = s.slotMode ?? 'centerToCenter';
    const [a, b, c] = s.draft;
    const need = mode === 'centerToCenter' || mode === 'overall' ? 2 : 3;
    if (s.draft.length < need) {
      if (mode === 'centerToCenter' && a) {
        const axis = sketchSlotAxis(a, p, 4 / this.skScale(), id != null || sketchPointLinked(p));
        if (Math.hypot(axis.x - a.x, axis.y - a.y) > 1e-6) { s.draft.push(axis); s.draftIds.push(id); }
        return;
      }
      s.draft.push(p);
      s.draftIds.push(id);
      return;
    }
    if (mode === 'centerToCenter' || mode === 'overall') {
      const width = sketchSlotWidth(a, b, p);
      if (!(width > 1e-6 && Number.isFinite(width))) {
        this.hint = t('Setze die Langlochbreite mit Abstand zur Mittelachse.');
        this.emit('tool');
        return;
      }
      if (mode === 'overall' && !slotCentersFromOverall(a, b, width)) {
        this.hint = t('Die Enden müssen weiter auseinander liegen als die Breite.');
        s.draft = [];
        s.draftIds = [];
        this.emit('tool');
        return;
      }
      if (this.sketchChange(t('Langloch'), (sk) => {
        const from = sk.next;
        const ok = mode === 'centerToCenter'
          ? addCenterSlot(sk, a, b, width, s.draftIds[0], s.draftIds[1])
          : addOverallSlot(sk, a, b, width, s.draftIds[0], s.draftIds[1]);
        if (s.drawAux) markAuxFrom(sk, from);
        if (!ok) return false;
      })) this.setSketchTool('slot');
      return;
    }
    const spine = mode === 'arcCenter' ? arcSlotCenterSpine(a, b, c) : arcSlotSpineThrough(a, b, c);
    if (!spine) {
      this.hint = mode === 'arcCenter'
        ? t('Die beiden Punkte müssen verschieden sein.')
        : t('Die drei Punkte liegen auf einer Geraden — kein Bogenslot möglich.');
      s.draft = [];
      s.draftIds = [];
      this.emit('tool');
      return;
    }
    if (!(spine.radius - sketchArcSlotWidth(spine.center, spine.radius, p) / 2 > 1e-6)) {
      this.hint = t('Die Breite muss kleiner als der doppelte Bogenradius sein.');
      this.emit('tool');
      return;
    }
    const width = sketchArcSlotWidth(spine.center, spine.radius, p);
    if (!(width > 1e-6 && Number.isFinite(width))) {
      this.hint = t('Setze die Langlochbreite mit Abstand zur Bogenmittellinie.');
      this.emit('tool');
      return;
    }
    if (this.sketchChange(t('Langloch'), (sk) => {
      const from = sk.next;
      const ok = mode === 'arcCenter'
        ? addCenterArcSlot(sk, a, b, c, width, s.draftIds[0], s.draftIds[1], s.draftIds[2])
        : addThroughArcSlot(sk, a, b, c, width, s.draftIds[0], s.draftIds[1], s.draftIds[2]);
      if (s.drawAux) markAuxFrom(sk, from);
      if (!ok) return false;
    })) this.setSketchTool('slot');
    else {
      this.hint = t('Die Breite muss kleiner als der doppelte Bogenradius sein.');
      s.draft = [];
      s.draftIds = [];
      this.emit('tool');
    }
  }

  /** Konstruktionslinien-Werkzeug (Paket 4): pro Modus genau eine unendliche Linie je sketchChange. */
  sketchConstrDown(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }) {
    const s = this.sketchEdit;
    if (!s) return;
    const mode = s.constrMode ?? 'free';
    if (mode === 'free' || mode === 'horizontal' || mode === 'vertical' || mode === 'angle') {
      const { p, id } = this.sketchPointAt(sx, sy, e);
      if (mode === 'free') {
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          this.redraw();
          return;
        }
        const a = s.draft[0];
        if (Math.hypot(p.x - a.x, p.y - a.y) <= 1e-6) {
          this.hint = t('Die beiden Punkte müssen verschieden sein.');
          s.draft = [];
          s.draftIds = [];
          this.emit('tool');
          this.redraw();
          return;
        }
        if (this.sketchChange(t('Skizze: Konstruktionslinie'), (sk) => {
          if (!addFreeConstrLine(sk, a, p, s.draftIds[0], id)) return false;
        })) {
          s.draft = [];
          s.draftIds = [];
        }
        this.redraw();
        return;
      }
      if (mode === 'angle') {
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          this.hint = t('Richtung per Klick festlegen.');
          this.emit('tool');
          this.redraw();
          return;
        }
        const a = s.draft[0];
        if (Math.hypot(p.x - a.x, p.y - a.y) <= 1e-9) {
          this.hint = t('Die beiden Punkte müssen verschieden sein.');
          s.draft = [];
          s.draftIds = [];
          this.emit('tool');
          this.redraw();
          return;
        }
        const deg = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
        const tid = s.draftIds[0];
        if (this.sketchChange(t('Skizze: Konstruktionslinie'), (sk) => {
          if (!addAngleConstrLine(sk, a, deg, tid)) return false;
        })) {
          s.draft = [];
          s.draftIds = [];
        }
        this.redraw();
        return;
      }
      // Waagrecht/senkrecht: sofort bauen (drawAux gilt hier nicht — immer infinite, nie aux).
      this.sketchChange(t('Skizze: Konstruktionslinie'), (sk) => {
        if (!addHVConstrLine(sk, p, mode === 'horizontal', id)) return false;
      });
      this.redraw();
      return;
    }
    // Referenz-Modi: erst Referenz(en), dann bauen.
    const twoRefs = mode === 'twoTangent' || mode === 'bisector';
    const refs = [...(s.constrRefs ?? [])];
    if (refs.length < (twoRefs ? 2 : 1)) {
      const hit = this.sketchSelectionCandidates(sx, sy).find((h) => h.kind === 'ent');
      const kind = hit ? constrRefKind(s.sk, hit.id) : null;
      const want = mode === 'parallel' || mode === 'perpendicular' || mode === 'bisector' ? 'line'
        : mode === 'pointTangent' ? 'any' : 'round';
      const okRef = !!hit && !!kind && (want === 'any' || (want === 'line' ? kind === 'line' : kind === 'circle' || kind === 'arc'));
      if (!okRef) {
        this.hint = want === 'line'
          ? t('Als Referenz eignet sich eine Linie.')
          : want === 'round'
            ? t('Als Tangentenziele eignen sich Kreise und Bögen — keine Ellipsen, Punkte oder Musterelemente.')
            : t('Als Kurve eignen sich Linien, Kreise und Bögen — keine Ellipsen, Punkte oder Musterelemente.');
      } else if (refs.includes(hit.id)) {
        this.hint = t('Diese Referenz ist bereits gewählt.');
      } else {
        refs.push(hit.id);
        s.constrRefs = refs;
        s.constrCursor = this.skFromWorld(this.toWorld(sx, sy));
        if (twoRefs && refs.length < 2) this.hint = t('Erste Referenz gewählt — jetzt die zweite anklicken.');
        else if (!twoRefs) this.hint = t('Referenz gewählt — jetzt den Punkt anklicken.');
      }
      // Zwei Referenzen sind vollständig: sofort mit dem Cursor als Seite bauen.
      if (!twoRefs || refs.length < 2) {
        this.emit('tool');
        this.redraw();
        return;
      }
    }
    if (twoRefs) {
      const cursor = this.skFromWorld(this.toWorld(sx, sy));
      const diagBefore = s.rejectedDiagnostics;
      const ok = this.sketchChange(t('Skizze: Konstruktionslinie'), (sk) => {
        if (mode === 'twoTangent') { if (!addTwoTangentConstrLine(sk, refs[0], refs[1], cursor)) return false; }
        else if (!addBisectorConstrLine(sk, refs[0], refs[1], cursor)) return false;
      });
      if (!ok && s.rejectedDiagnostics === diagBefore) {
        this.hint = mode === 'twoTangent'
          ? t('Diese beiden Kreise haben keine gemeinsame Tangente.')
          : t('Parallele Linien haben keine eindeutige Winkelhalbierende.');
        this.emit('tool');
      }
      s.constrRefs = undefined;
      s.constrCursor = undefined;
      s.draft = [];
      s.draftIds = [];
      this.redraw();
      return;
    }
    const { p, id } = this.sketchPointAt(sx, sy, e);
    const cursor = s.constrCursor ?? this.skFromWorld(this.toWorld(sx, sy));
    const diagBefore = s.rejectedDiagnostics;
    const ok = this.sketchChange(t('Skizze: Konstruktionslinie'), (sk) => {
      if (mode === 'parallel') { if (!addParallelConstrLine(sk, refs[0], p, false, id)) return false; }
      else if (mode === 'perpendicular') { if (!addParallelConstrLine(sk, refs[0], p, true, id)) return false; }
      else if (mode === 'externalTangent') { if (!addExternalTangentConstrLine(sk, refs[0], p, cursor, id)) return false; }
      else if (!addPointTangentConstrLine(sk, refs[0], p, id)) return false;
    });
    if (!ok && s.rejectedDiagnostics === diagBefore) {
      this.hint = mode === 'externalTangent'
        ? t('Von diesem Punkt aus gibt es keine Tangente an den Kreis.')
        : mode === 'pointTangent' && pointTangentDir(s.sk, refs[0], p) === null
          ? t('Der Punkt liegt auf der Kreismitte — keine Tangente möglich.')
          : t('Diese Konstruktionslinie lässt sich hier nicht anlegen.');
      this.emit('tool');
    }
    s.constrRefs = undefined;
    s.constrCursor = undefined;
    s.draft = [];
    s.draftIds = [];
    this.redraw();
  }

  /** Bogen-Tangente (Paket 4): Start ist ein gefangener Kurven-Endpunkt, Ende frei, tangent-Bindung. */
  sketchArcTangentDown(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean }) {
    const s = this.sketchEdit;
    if (!s) return;
    if (s.arcRef == null) {
      const { p, id } = this.sketchPointAt(sx, sy, e);
      // Erster Treffer in Elementreihenfolge (Linie wie Bogen); geteilte Punkte bleiben eindeutig fangbar.
      const ref = id != null ? s.sk.ents.find((x) => ((x.t === 'line' && (x.a === id || x.b === id)) || (x.t === 'arc' && (x.s === id || x.e === id)))) : undefined;
      if (!ref || !refEndDir(s.sk, ref.id, id!)) {
        this.hint = t('Der Start muss ein Endpunkt einer Linie oder eines Bogens sein — keine Ellipsen oder Musterelemente.');
        this.emit('tool');
        return;
      }
      s.arcRef = ref.id;
      s.draft = [p];
      s.draftIds = [id];
      this.redraw();
      return;
    }
    const { p, id } = this.sketchPointAt(sx, sy, e);
    const start = s.draft[0], startId = s.draftIds[0], refId = s.arcRef;
    const diagBefore = s.rejectedDiagnostics;
    const ok = this.sketchChange(t('Skizze: Bogen'), (sk) => {
      if (!addTangentArc(sk, refId, start, startId, p, id, !!s.arcFlip)) return false;
    });
    if (!ok && s.rejectedDiagnostics === diagBefore) {
      const same = !!s.draft.length && Math.hypot(p.x - start.x, p.y - start.y) <= 1e-6;
      this.hint = same
        ? t('Start und Ende müssen verschieden sein.')
        : t('Von hier aus gibt es keinen Tangentenbogen — der Endpunkt liegt auf der Tangente.');
      this.emit('tool');
    }
    if (ok) {
      s.draft = [];
      s.draftIds = [];
      s.arcRef = undefined;
      s.arcFlip = undefined;
    }
    this.redraw();
  }

  async sketchNumericRotate(this: Editor) {
    const s = this.sketchEdit, pivot = s?.draft[0];
    if (!s || !pivot || s.tool !== 'rotate') return;
    const source = sketchJson(s.sk), selection = [...s.sel];
    const answer = await this.onSketchValue?.(t('Drehen'), 90, '°');
    this.syncSketch();
    if (answer && this.sketchEdit === s && s.tool === 'rotate' && s.draft[0] === pivot && sketchJson(s.sk) === source
      && selection.length === s.sel.size && selection.every((id) => s.sel.has(id))) {
      this.commitSketchTransform(sketchRotationMatrix(pivot, answer.v), false);
    }
    this.canvas.focus({ preventScroll: true });
  }

  /** Ausgewählte Kurve in N gleiche Teile teilen (ein Undo-Schritt, Kurve unverändert). */
  async sketchDivideSelected(this: Editor) {
    const s = this.sketchEdit;
    const target = s && divideSelection(s.sk, s.sel);
    if (!s || !target) return;
    const source = sketchJson(s.sk), selection = [...s.sel];
    const answer = await this.onSketchValue?.(t('Anzahl der Teile (2–64)'), 2, '');
    this.syncSketch();
    if (!answer || this.sketchEdit !== s || sketchJson(s.sk) !== source
      || selection.length !== s.sel.size || selection.some((id) => !s.sel.has(id))) return;
    if (!Number.isInteger(answer.v) || answer.v < MIN_SKETCH_DIVIDE || answer.v > MAX_SKETCH_DIVIDE) {
      this.hint = t('Die Anzahl muss eine ganze Zahl von 2 bis 64 sein.');
      this.emit('tool');
      this.redraw();
      return;
    }
    this.sketchChange(t('In N gleiche Teile teilen'), (sk) => applySketchDivide(sk, target.id, answer.v));
    this.redraw();
  }

  /** Ellipsenachsen ändern (Mitte und Richtung bleiben; starre Form, kein Solver-Maß). */
  editEllipseAxes(this: Editor) {
    const active = this.sketchEdit;
    const selected = active && active.sel.size === 1 ? [...active.sel][0] : undefined;
    const ent = selected !== undefined && active ? entOf(active.sk, selected) : undefined;
    if (!active || !ent || ent.t !== 'ellipse' || ent.aux) return;
    const c = ptOf(active.sk, ent.c), m = ptOf(active.sk, ent.m);
    if (!c || !m) return;
    const labels = [t('Große Halbachse (mm)'), t('Kleine Halbachse (mm)')];
    const current = [Math.hypot(m.x - c.x, m.y - c.y), ent.r];
    const inputs = current.map((v, i) => h('input', { id: `sk-ellipse-${i}`, type: 'text', inputmode: 'decimal', value: dimensionNumber(v), 'aria-describedby': 'sk-ellipse-error' }));
    const err = h('div', { class: 'note', id: 'sk-ellipse-error', role: 'alert' });
    const dlg = h('dialog', { class: 'offset-dialog', 'aria-labelledby': 'sk-ellipse-title' });
    const form = h('form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (this.sketchEdit !== active) { dlg.close(); return; }
        const values = inputs.map((input) => evalExpr(input.value.trim()));
        inputs.forEach((input) => input.removeAttribute('aria-invalid'));
        const invalid = values.findIndex((v) => v === null || !Number.isFinite(v) || (v as number) < MIN_SKETCH_ELLIPSE_AXIS);
        if (invalid >= 0) {
          err.textContent = t('Gib ein Maß von mindestens 0,000001 mm ein.');
          inputs[invalid].setAttribute('aria-invalid', 'true');
          inputs[invalid].focus();
          return;
        }
        const [major, minor] = values as number[];
        if (this.sketchChange(t('Ellipsenachsen'), (sk) => applyEllipseAxes(sk, ent.id, major, minor))) dlg.close();
        else err.textContent = t('Die Achsen konnten nicht geändert werden. Prüfe die Maße.');
      },
    },
    h('div', { class: 'form' }, ...labels.flatMap((label, i) => [h('label', { for: inputs[i].id }, label), inputs[i]])), err,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', type: 'submit' }, t('Übernehmen'))));
    dlg.append(h('h3', { id: 'sk-ellipse-title' }, t('Ellipsenachsen')), form);
    showDialog(dlg);
    inputs[0].select();
  }

  sketchShapePlacementClick(this: Editor, p: SketchPickedPoint, id: number | null, screen?: Pt) {
    const s = this.sketchEdit;
    if (!s || !isSketchShapePlacement(s.tool)) return;
    const [start, end] = s.draft;
    this.cursor = apply(s.m, p.x, p.y);
    if (isSketchTransform(s.tool)) {
      if (s.tool === 'mirror' && s.mirrorLineMode) {
        const axis = screen && this.sketchMirrorAxis(screen.x, screen.y);
        if (axis) this.commitSketchTransform(sketchRigidMatrix(true, [axis[0]], axis[1]), true);
        return;
      }
      if (!start || (s.tool === 'rotate' && !end)) {
        if (!start || Math.hypot(start.x - p.x, start.y - p.y) > 1e-8) s.draft.push(p);
        this.emit('tool');
      } else {
        const mirror = s.tool === 'mirror';
        this.commitSketchTransform(sketchRigidMatrix(mirror, s.draft, p), mirror);
      }
      this.redraw();
      return;
    }
    if (!start) { s.draft = [p]; s.draftIds = [id]; }
    else if (s.tool === 'polygon') {
      if (this.sketchChange(t('Polygon'), (sk) => {
        const from = sk.next;
        const ok = addSketchPolygon(sk, start, p, s.polygonSides ?? 6, s.draftIds[0], id, s.polygonMode ?? 'inscribed');
        if (s.drawAux) markAuxFrom(sk, from);
        return ok;
      })) this.setSketchTool('polygon');
    } else if (s.tool === 'roundRect') {
      if (!end) {
        const size = roundedRectangleSize(start, p);
        if (size.width > 2e-6 && size.height > 2e-6) s.draft.push(p);
      } else {
        const { width, height, radius } = roundedRectangleSize(start, end, p);
        if (!(radius > 1e-6 && radius < Math.min(width, height) / 2 - 1e-6)) {
          this.hint = t('Der Radius muss positiv und kleiner als die halbe kürzere Rechteckseite sein.');
          this.emit('tool');
        } else if (this.sketchChange(t('Rundrechteck'), (sk) => {
          const from = sk.next;
          const ok = addRoundedSketchRectangle(sk, start, width, height, radius, s.draftIds[0]);
          if (s.drawAux) markAuxFrom(sk, from);
          return ok;
        })) this.setSketchTool('roundRect');
      }
    } else {
      this.sketchSlotClick(p, id);
    }
    this.redraw();
  }

  sketchGridSourceAt(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit!, k = this.skScale();
    const cursor = this.skFromWorld(this.toWorld(sx, sy));
    let id: number | undefined, nearest = SNAP_PX;
    for (const e of s.sk.ents) {
      if (s.tool === 'circleOffset' && (e.t === 'line' || e.t === 'arc')) {
        const a = ptOf(s.sk, e.t === 'line' ? e.a : e.s), b = ptOf(s.sk, e.t === 'line' ? e.b : e.e);
        if (!a || !b) continue;
        const hit = e.t === 'line' ? undefined : sketchRoundTrimHit(s.sk, e, cursor);
        const error = e.t === 'line' ? segDist(sx, sy, this.skToScreen(a), this.skToScreen(b))
          : hit ? Math.hypot(hit.x - cursor.x, hit.y - cursor.y) * k : Infinity;
        if (error < nearest) { nearest = error; id = e.id; }
        continue;
      }
      if (e.t !== 'circle') continue;
      const c = ptOf(s.sk, e.c);
      if (!c) continue;
      const d = Math.hypot(c.x - cursor.x, c.y - cursor.y);
      const error = Math.min(d, Math.abs(d - e.r)) * k;
      if (error < nearest) { nearest = error; id = e.id; }
    }
    return id;
  }

  async sketchGridClick(this: Editor, sx: number, sy: number, p: SketchPickedPoint, pointId: number | null) {
    void pointId;
    const s = this.sketchEdit!, id = s.draftIds[0], origin = s.draft[0];
    if (s.splitInsetPending) return;
    this.cursor = apply(s.m, p.x, p.y);
    if (!origin || id == null) {
      const source = this.sketchGridSourceAt(sx, sy);
      const e = source === undefined ? undefined : entOf(s.sk, source);
      const center = e && e.t !== 'point' ? ptOf(s.sk, e.t === 'line' ? e.a : e.c) : undefined;
      if (center && source !== undefined) { s.draft = [{ x: center.x, y: center.y }]; s.draftIds = [source]; }
    } else if (s.tool === 'circleOffset') {
      const split = planSplitInset(s.sk, id, p);
      if (split) {
        const json = sketchJson(s.sk), position = this.history.position;
        s.splitInsetPending = split;
        this.redraw();
        try {
          const approved = await this.onSketchSplitInset?.(split);
          this.syncSketch();
          if (approved && this.sketchEdit === s && s.tool === 'circleOffset' && s.draftIds[0] === id
            && this.history.position === position && sketchJson(s.sk) === json
            && this.sketchChange(t('Konturversatz'), (sk) => addSplitInset(sk, split))) this.setSketchTool('circleOffset');
        } finally {
          s.splitInsetPending = undefined;
          this.redraw();
        }
        return;
      }
      if (this.sketchChange(t('Konturversatz'), (sk) => entOf(sk, id)?.t === 'circle' ? addSketchCircleOffset(sk, id, p) : addSmoothOffset(sk, id, p))) this.setSketchTool('circleOffset');
    }
    this.redraw();
  }

  sketchPolylinePoint(this: Editor, sx: number, sy: number, e: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey'> & { shiftKey?: boolean }) {
    const draft = this.sketchEdit?.polyline;
    if (draft && (!this.sketchEdit?.polylineArc || draft.through)) {
      const p = this.skToScreen(draft.start);
      if (Math.hypot(p.x - sx, p.y - sy) <= SNAP_PX) return { p: draft.start, id: draft.startId, closes: true };
    }
    const r = this.sketchPointAt(sx, sy, e);
    // Winkelfang: Shift legt freie Segmentenden aufs 45°-Raster um den letzten Punkt (nur gerade Segmente).
    if (e.shiftKey && r.id === null && draft && !this.sketchEdit?.polylineArc && !this.snapHit) {
      const from = draft.segments.at(-1)?.end ?? draft.start;
      const q = this.sketchAngleSnap(from, r.p);
      return { ...r, p: { ...r.p, x: q.x, y: q.y }, closes: false };
    }
    return { ...r, closes: false };
  }

  finishSketchPolyline(this: Editor, closed = false) {
    const s = this.sketchEdit;
    const draft = s?.polyline;
    if (!s || !draft?.segments.length) return false;
    if (!this.sketchChange(t('Polylinie'), (sk) => {
    const from = sk.next;
    const issue = addSketchPolyline(sk, draft.start, draft.segments, closed, draft.startId);
    if (s.drawAux) markAuxFrom(sk, from);
    return issue ? false : undefined;
  })) return false;
    s.polyline = undefined;
    s.polylinePointer = undefined;
    this.sketchHint();
    this.redraw();
    return true;
  }

  sketchPolylineClick(this: Editor, sx: number, sy: number, e: Pick<PointerEvent, 'altKey' | 'ctrlKey' | 'metaKey'> & { shiftKey?: boolean }) {
    const s = this.sketchEdit!;
    const { p, id, closes } = this.sketchPolylinePoint(sx, sy, e);
    const draft = s.polyline;
    if (!draft) s.polyline = { start: p, startId: id, segments: [] };
    else {
      const from = draft.segments.at(-1)?.end ?? draft.start;
      if (Math.hypot(p.x - from.x, p.y - from.y) < 1e-6) return;
      if (s.polylineArc && !draft.through) { draft.through = p; draft.throughId = id; }
      else {
        if (draft.through && typeof sketchPolylineArc(from, draft.through, p) === 'string') {
          this.hint = t('Wähle einen anderen Endpunkt: Der Bogen lässt sich so nicht erstellen.');
          this.emit('tool');
          return;
        }
        draft.segments.push({ end: p, endId: id, through: draft.through, throughId: draft.throughId });
        if (closes) {
          if (this.finishSketchPolyline(true)) return;
          draft.segments.pop();
          this.hint = t('Diese Kette lässt sich so nicht schließen. Ändere den letzten Endpunkt oder füge ein Segment hinzu.');
          this.emit('tool');
          return;
        }
        draft.through = undefined;
        draft.throughId = undefined;
      }
    }
    this.sketchHint();
    this.redraw();
  }

  // ---------- Maus ----------

  sketchTrimAt(this: Editor, sx: number, sy: number): SketchLinePlan | undefined {
    const s = this.sketchEdit;
    if (!s || sx < RULER || sy < RULER || sx >= this.w || sy >= this.h) return;
    const cursor = this.skFromWorld(this.toWorld(sx, sy));
    let result: SketchLinePlan | undefined, distance = SNAP_PX;
    for (const e of s.sk.ents) {
      if (e.aux) continue;
      let d: number;
      if (e.t === 'line') {
        const a = ptOf(s.sk, e.a), b = ptOf(s.sk, e.b);
        if (!a || !b) continue;
        const p = this.skToScreen(a), q = this.skToScreen(b);
        d = segDist(sx, sy, p, q);
        if (s.tool === 'chamfer' || s.tool === 'fillet') {
          if (d >= distance) continue;
          const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
          const along = ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / l;
          const end = along < l / 2 ? 'a' : 'b';
          const plan = planSketchCorner(s.sk, e.id, end, end === 'a' ? along : l - along, s.tool === 'fillet');
          result = plan;
          distance = d;
          continue;
        }
        if (s.tool === 'split') {
          if (d >= distance) continue;
          result = planSketchSplit(s.sk, e.id, cursor, 4 / this.skScale());
          distance = d;
          continue;
        }
      } else {
        if (s.tool === 'split' && e.t === 'arc') {
          const hit = sketchRoundTrimHit(s.sk, e, cursor);
          if (!hit) continue;
          const p = this.skToScreen(hit);
          d = Math.hypot(p.x - sx, p.y - sy);
          if (d >= distance) continue;
          result = planSketchSplit(s.sk, e.id, cursor, 4 / this.skScale());
          distance = d;
          continue;
        }
        if (s.tool !== 'trim') continue;
        const hit = sketchRoundTrimHit(s.sk, e, cursor);
        if (!hit) continue;
        const p = this.skToScreen(hit);
        d = Math.hypot(p.x - sx, p.y - sy);
      }
      if (d >= distance) continue;
      const plan = s.tool === 'extend' ? pickSketchExtend(s.sk, e.id, cursor) : pickTrimSpan(s.sk, e.id, cursor) ?? pickSketchTrim(s.sk, e.id, cursor);
      if (plan) { distance = d; result = plan; }
    }
    return result;
  }

  async commitSketchTrim(this: Editor, plan: SketchLinePlan) {
    const s = this.sketchEdit;
    if (!s || !isSketchLineEdit(s.tool) || s.trimPending) return;
    const mode = s.tool;
    const source = sketchJson(s.sk);
    const position = this.history.position;
    const ids = new Set(('removed' in plan ? plan.removed : []).map((c) => c.id));
    const change = (sk: Sketch) => 'splitAt' in plan ? applySketchSplit(sk, plan.target, undefined, plan)
      : 'sides' in plan ? applySketchCorner(sk, plan) : 'stroke' in plan ? applyTrimSpan(sk, plan)
        : mode === 'trim' || mode === 'extend' ? applySketchTrim(sk, plan.target, plan.cutter, plan.end, ids, mode) : false;
    const trial = cloneSketch(s.sk);
    if (change(trial) === false) {
      this.hint = mode === 'split' ? t('Aufteilen nicht möglich: Prüfe die Maße und Beziehungen der Geraden.')
        : mode === 'fillet' || mode === 'chamfer' ? t('Die Ecke konnte nicht bearbeitet werden. Wähle ein kleineres Maß oder prüfe die Beziehungen.')
        : mode === 'extend' ? t('Verlängern nicht möglich: Prüfe die verbleibenden Maße und Beziehungen.')
        : t('Trimmen nicht möglich: Prüfe die verbleibenden Maße und Beziehungen.');
      this.emit('tool');
      return;
    }
    const removed = lostConditions(s.sk, trial);
    const losses = [...new Set([...('removed' in plan ? plan.removed : []), ...removed.filter((c) => isDim(c.t))])];
    const approvedLosses = new Set(removed.map((c) => c.id));
    if (!this.sketchCheckReferences(s.sk, trial, approvedLosses)) { this.emit('tool'); this.redraw(); return; }
    if (losses.length) {
      s.trimPending = true;
      try {
        if (!(await this.onSketchTrimLosses?.(losses))) return;
      } finally {
        s.trimPending = false;
      }
    }
    this.syncSketch();
    if (this.sketchEdit !== s || s.tool !== mode || this.history.position !== position || sketchJson(s.sk) !== source) return;
    const title = mode === 'split' ? t('Aufteilen') : mode === 'extend' ? t('Verlängern') : mode === 'chamfer' ? t('Fasen') : mode === 'fillet' ? t('Abrunden') : t('Trimmen');
    if (this.sketchChange(title, (sk) => { Object.assign(sk, trial); }, { approvedLosses })) s.trimPreview = undefined;
    this.redraw();
  }

  placeSketchCenterRect(this: Editor, p: SketchPickedPoint, id?: number | null) {
    const s = this.sketchEdit;
    if (!s || s.tool !== 'centerRect' || s.centerRectPress) return;
    const center = s.draft[0];
    if (!center) {
      s.draft = [p];
      s.draftIds = [id ?? null];
    }
    else if (this.sketchChange(t('Skizze: Rechteck'), (sk) => {
      const from = sk.next;
      const ok = addCenteredRectangle(sk, center, 2 * Math.abs(p.x - center.x), 2 * Math.abs(p.y - center.y), s.draftIds[0],
        id != null || sketchPointLinked(p) ? { point: p, id } : undefined);
      if (s.drawAux) markAuxFrom(sk, from);
      return ok;
    })) {
      s.draft = [];
      s.draftIds = [];
    }
    this.redraw();
  }

  finishSketchFrame(this: Editor, to: Pt) {
    const s = this.sketchEdit;
    const frame = s?.frame;
    if (!s || !frame) return;
    s.frame = undefined;
    const { zoom, ox, oy } = this.view;
    const [a, b, c, d, x, y] = s.m;
    const moved = Math.hypot(to.x - frame.from.x, to.y - frame.from.y) >= 3;
    if (!frame.additive) s.sel.clear();
    if (moved) {
      const screen: Mat = [zoom * a, zoom * b, zoom * c, zoom * d, zoom * x + ox, zoom * y + oy];
      for (const id of sketchFrameSelection(s.sk, screen, frame.from, to)) s.sel.add(id);
    }
    this.emit('sel');
    this.redraw();
  }

  /**
   * Rahmen bei offenem Muster-Fenster: ohne Weg → Klick (Freiraum-Mitte, Einzel-Pick),
   * sonst eingeschlossene echte Geometrie in Elemente übernehmen (Hilfsgeometrie nie
   * Quelle — ohne sie würde OK sofort mit Fehler abbrechen; Rest prüft Validierung).
   */
  finishSketchPatternFrame(this: Editor, to: Pt) {
    const s = this.sketchEdit, d = s?.patternDraft, frame = s?.frame;
    if (!s || !d || !frame) return;
    s.frame = undefined;
    if (Math.hypot(to.x - frame.from.x, to.y - frame.from.y) < 3) {
      this.sketchPatternClick(to.x, to.y);
      this.redraw();
      return;
    }
    const { zoom, ox, oy } = this.view;
    const [a, b, c, e, x, y] = s.m;
    const screen: Mat = [zoom * a, zoom * b, zoom * c, zoom * e, zoom * x + ox, zoom * y + oy];
    const have = new Set(d.entities);
    for (const id of sketchFrameSelection(s.sk, screen, frame.from, to)) {
      const ent = entOf(s.sk, id);
      if (!ent || isConstructionGeometry(ent) || have.has(id)) continue;
      have.add(id);
      d.entities.push(id);
    }
    d.error = '';
    notifyPatternDialog(this);
    this.redraw();
  }

  startSketchFrameKeys(this: Editor) {
    this.setSketchTool('select');
    const s = this.sketchEdit;
    if (!s) return;
    s.frameKeys = this.cursorOnCanvas ? this.toScreen(this.cursor) : { x: this.w / 2, y: this.h / 2 };
    if (!this.canvas.hasAttribute('tabindex')) this.canvas.tabIndex = -1;
    this.canvas.focus({ preventScroll: true });
    this.hint = t('Rahmenauswahl: Bewege den Zeiger mit den Pfeiltasten und setze beide Ecken mit Einfg. Esc bricht ab.');
    this.emit('tool');
    this.redraw();
  }

  sketchMove(this: Editor, sx: number, sy: number, e: PointerEvent) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    if (!this.sketchEdit) return;
    // Abstands-Ziehen (Phase 3): nur Entwurf ändern, kein Commit, kein Undo.
    if (s.patternDrag) {
      if (e.pointerId === s.patternDrag.pointerId) this.sketchPatternDragTo(sx, sy);
      return;
    }
    if (isSketchLineEdit(s.tool)) {
      if (!s.trimPending && (s.trimPointer === undefined || s.trimPointer === e.pointerId)) {
        s.polylineKeys = undefined;
        s.trimPreview = this.sketchTrimAt(sx, sy);
        this.canvas.style.cursor = 'crosshair';
        this.redraw();
      }
      return;
    }
    if (s.centerRectPress && s.centerRectPress.id !== e.pointerId) return;
    if (s.frame?.pointerId !== undefined) {
      if (s.frame.pointerId === e.pointerId) {
        s.frame.to = { x: sx, y: sy };
        this.redraw();
      }
      return;
    }
    s.polylineKeys = undefined;
    const d = s.drag;
    if (d && 'pt' in d) {
      const w = this.skFromWorld(this.snapPt(this.toWorld(sx, sy), e, { toggle: true }));
      if (!d.moved) {
        this.snapshot(t('Skizze: Punkt ziehen'));
        d.moved = true;
      }
      const r = this.sketchSolve(false, { pt: d.pt, x: w.x, y: w.y });
      if (r.ok) {
        this.syncPatternsAfterSolve();
        // ohne neuen Undo-Schritt schreiben
        const shape = s.obj.shape as GenShape;
        s.json = sketchJson(s.sk);
        shape.params = { ...shape.params, sketch: s.json };
        shape.subs = sketchSubs(s.sk);
        this.touch(shape);
        this.emit('doc');
      }
      this.redraw();
      return;
    }
    if (d && 'con' in d) {
      const w = this.skFromWorld(this.toWorld(sx, sy));
      const c = s.sk.cons.find((x) => x.id === d.con);
      if (c) c.at = { x: d.at.x + w.x - d.start.x, y: d.at.y + w.y - d.start.y };
      this.redraw();
      return;
    }
    s.snapPointer = { x: sx, y: sy };
    if (s.snapCycle && Math.hypot(sx - s.snapCycle.at.x, sy - s.snapCycle.at.y) > 2) s.snapCycle = undefined;
    s.hover = this.sketchHitTest(sx, sy);
    if (isSketchCircleTool(s.tool)) {
      const source = s.draftIds[0];
      const id = source ?? this.sketchGridSourceAt(sx, sy);
      s.hover = id == null ? null : { kind: 'ent', id };
    }
    if (s.tool !== 'select' && s.tool !== 'dim') {
      const { p } = s.tool === 'polyline' ? this.sketchPolylinePoint(sx, sy, e) : this.sketchPointAt(sx, sy, e);
      this.cursor = apply(s.m, p.x, p.y);
    }
    this.canvas.style.cursor = s.tool === 'select' ? (s.hover ? 'pointer' : 'default') : 'crosshair';
    this.redraw();
  }

  sketchDown(this: Editor, sx: number, sy: number, e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; pointerId: number }) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    if (!this.sketchEdit) return;
    // Muster-Fenster offen: kein Werkzeug-Flow — Press in Pfeilnähe startet Abstand-Ziehen,
    // sonst routen Klicks in den Entwurf.
    if (this.sketchEdit.patternDraft) {
      const arrow = this.sketchPatternArrowAt(sx, sy);
      const pd = this.sketchEdit.patternDraft;
      if (arrow !== null && pd) {
        this.sketchEdit.patternDrag = {
          dir: arrow, pointerId: e.pointerId,
          restore: arrow === 0 ? pd.spacingText : pd.spacing2Text,
        };
        this.redraw();
        return;
      }
      // Leerdruck + Ziehen: Rahmen füllt Elemente (Mehrfach-Pick per Geste);
      // reiner Klick ohne Weg bleibt Klick (Freiraum-Mitte, Einzel-Pick).
      if (!this.sketchHitTest(sx, sy) && sx >= RULER && sy >= RULER) {
        s.frame = { from: { x: sx, y: sy }, to: { x: sx, y: sy }, additive: true, pointerId: e.pointerId };
        this.redraw();
        return;
      }
      this.sketchPatternClick(sx, sy);
      this.redraw();
      return;
    }
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    switch (s.tool) {
      case 'trim':
      case 'extend':
      case 'split':
      case 'chamfer':
      case 'fillet':
        if (!s.trimPending && s.trimPointer === undefined) {
          s.trimPressed = this.sketchTrimAt(sx, sy);
          if (s.trimPressed) s.trimPointer = e.pointerId;
        }
        return;
      case 'centerRect':
        if (s.centerRectPress || sx < RULER || sy < RULER) return;
        s.centerRectPress = { id: e.pointerId, x: sx, y: sy, newCenter: !s.draft.length };
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
        }
        this.cursor = apply(s.m, p.x, p.y);
        this.redraw();
        return;
      case 'polyline':
      case 'slot':
      case 'rotate':
      case 'mirror':
      case 'roundRect':
      case 'polygon':
      case 'circleOffset':
        if (s.polylinePointer === undefined && sx >= RULER && sy >= RULER) {
          s.polylinePointer = e.pointerId;
          this.canvas.focus({ preventScroll: true });
        }
        return;
      case 'select': {
        if (s.frame?.pointerId !== undefined || s.drag) return;
        s.frameKeys = undefined;
        s.frame = undefined;
        const h = this.sketchHitTest(sx, sy);
        if (s.relationPick) { this.sketchRelationClick(h); return; }
        if (!h) {
          if (sx >= RULER && sy >= RULER) s.frame = { from: { x: sx, y: sy }, to: { x: sx, y: sy }, additive: add, pointerId: e.pointerId };
          break;
        }
        this.sketchSelectHit(h.id, add);
        // Klick-Selektion: Fang-Marker des Klicks fällt sofort (kein klebender Marker);
        // Hover/Auswahl bleiben, Drag-Pfade setzen ihren Marker neu.
        this.clearSnap();
        if (h.kind === 'pt') s.drag = { pt: h.id, moved: false };
        else if (h.kind === 'con') {
          const c = s.sk.cons.find((x) => x.id === h.id);
          if (c && isDim(c.t)) s.drag = { con: c.id, start: this.skFromWorld(this.toWorld(sx, sy)), at: c.at ?? { x: 0, y: 0 } };
        }
        break;
      }
      case 'line': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (s.draft.length && s.draftIds.length) {
          const prevId = s.draftIds[s.draftIds.length - 1];
          const prev = s.draft[s.draft.length - 1];
          if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-6) return;
          const closing = id !== null && id === s.draftIds[0];
          let a = 0, b = 0;
          if (!this.sketchChange(t('Skizze: Linie'), (sk) => {
            a = materializeSketchPoint(sk, prev, prevId);
            b = materializeSketchPoint(sk, p, id);
            const l = addLine(sk, a, b, !!s.drawAux);
            // Zeichenmodus Mittellinie/Unendlich (nur Linienwerkzeug, kein aux-Ersatz).
            applyDrawLineKind(l, s.drawLine, s.drawAux);
            if ((prevId == null && !sketchPointLinked(prev)) || (id == null && !sketchPointLinked(p))) autoConstrain(sk, l);
          })) return;
          s.draftIds[s.draftIds.length - 1] = a;
          s.draftIds.push(b);
          s.draft.push(p);
          if (closing) {
            s.draft = [];
            s.draftIds = [];
          }
        } else {
          s.draft = [p];
          s.draftIds = [id];
        }
        break;
      }
      case 'rect': {
        if ((s.rectMode ?? 'corners') !== 'corners') { this.sketchRectModeDown(sx, sy, e); break; }
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          break;
        }
        const a = s.draft[0];
        if (Math.abs(p.x - a.x) < 1e-6 || Math.abs(p.y - a.y) < 1e-6) return;
        const firstId = s.draftIds[0];
        this.sketchChange(t('Skizze: Rechteck'), (sk) => {
          const from = sk.next;
          addSketchRectangle(sk, a, p, materializeSketchPoint(sk, a, firstId), materializeSketchPoint(sk, p, id));
          if (s.drawAux) markAuxFrom(sk, from);
        });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'circle': {
        if ((s.circleMode ?? 'centerRim') !== 'centerRim') { this.sketchCircleModeDown(sx, sy, e); break; }
        const { p, id } = this.sketchPointAt(sx, sy, e);
        if (!s.draft.length) {
          s.draft = [p];
          s.draftIds = [id];
          break;
        }
        const c = s.draft[0];
        const r = Math.hypot(p.x - c.x, p.y - c.y);
        if (r < 1e-6) return;
        const cid = s.draftIds[0];
        this.sketchChange(t('Skizze: Kreis'), (sk) => {
          const center = materializeSketchPoint(sk, c, cid);
          const circle = addCircle(sk, center, r, !!s.drawAux);
          if (id !== null || sketchPointLinked(p)) addCon(sk, 'pointOnCircle', [materializeSketchPoint(sk, p, id), circle.id]);
        });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'ellipse': {
        const { p, id } = this.sketchPointAt(sx, sy, e);
        s.draft.push(p);
        s.draftIds.push(id);
        if (s.draft.length < 3) break;
        const [c, a, b] = s.draft;
        const dx = a.x - c.x, dy = a.y - c.y;
        const major = Math.hypot(dx, dy);
        // Nebenradius = Abstand des dritten Punkts von der Hauptachse (senkrecht, robust bei jedem Klick).
        const r = major > 1e-9 ? Math.abs((b.x - c.x) * dy - (b.y - c.y) * dx) / major : 0;
        if (!validEllipseAxes(major, r)) {
          // Degeneriert: dritter Klick verwerfen (Mitte/Hauptachse bleiben), sonst Neustart.
          s.draft.pop();
          s.draftIds.pop();
          if (!(major >= MIN_SKETCH_ELLIPSE_AXIS)) {
            s.draft = [];
            s.draftIds = [];
          }
          break;
        }
        const [cid, aid] = s.draftIds;
        this.sketchChange(t('Skizze: Ellipse'), (sk) => {
          const center = materializeSketchPoint(sk, c, cid);
          const majorEnd = materializeSketchPoint(sk, a, aid);
          addEllipse(sk, center, majorEnd, r, !!s.drawAux);
        });
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'arc': {
        if ((s.arcMode ?? 'centerStartEnd') === 'tangent') { this.sketchArcTangentDown(sx, sy, e); break; }
        const { p, id } = this.sketchPointAt(sx, sy, e);
        s.draft.push(p);
        s.draftIds.push(id);
        if (s.draft.length < 3) break;
        const [c, a, b] = s.draft;
        const [cid, aid, bid] = s.draftIds;
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        if (r < 1e-6) {
          s.draft = [];
          s.draftIds = [];
          return;
        }
        const made = this.sketchChange(t('Skizze: Bogen'), (sk) => {
          const C = materializeSketchPoint(sk, c, cid);
          const A = materializeSketchPoint(sk, a, aid);
          // Ende auf den Kreis legen
          const ang = Math.atan2(b.y - c.y, b.x - c.x);
           const B = bid != null || sketchPointLinked(b) ? materializeSketchPoint(sk, b, bid)
            : addPt(sk, c.x + r * Math.cos(ang), c.y + r * Math.sin(ang)).id;
          addArc(sk, C, A, B, !!s.drawAux);
        });
        if (!made) {
          s.draft.pop();
          s.draftIds.pop();
          return;
        }
        s.draft = [];
        s.draftIds = [];
        break;
      }
      case 'point': {
        // Fang hat Vorrang (existierender pick-Pfad), sonst neuer Punkt; ein Undo-Schritt, Esc bricht ab (kein Entwurf).
        const { p, id } = this.sketchPointAt(sx, sy, e);
        this.sketchChange(t('Skizze: Punkt'), (sk) => {
          const from = sk.next;
          addPoint(sk, materializeSketchPoint(sk, p, id), !!s.drawAux);
          if (s.drawAux) markAuxFrom(sk, from);
        });
        break;
      }
      case 'constr': {
        this.sketchConstrDown(sx, sy, e);
        break;
      }
      case 'dim':
        if (!s.valueEdit) s.dimPress = { pointerId: e.pointerId, hit: this.sketchHitTest(sx, sy) };
        break;
    }
    this.redraw();
  }

  sketchUp(this: Editor, event?: PointerEvent) {
    const s = this.sketchEdit;
    if (!s) return;
    // Abstands-Ziehen: Loslassen beendet nur den Entwurf (kein Commit, kein Undo).
    if (s.patternDrag && (!event || event.pointerId === s.patternDrag.pointerId)) {
      s.patternDrag = null;
      this.redraw();
      return;
    }
    if (s.tool === 'dim' && s.dimPress && event?.pointerId === s.dimPress.pointerId) {
      const pressed = s.dimPress;
      s.dimPress = undefined;
      const { sx, sy } = this.evPt(event);
      const released = this.sketchHitTest(sx, sy);
      if (event.button === 0 && pressed.hit?.id === released?.id && pressed.hit?.kind === released?.kind) this.sketchDimPick(released);
      return;
    }
    if (isSketchLineEdit(s.tool)) {
      if (!event || s.trimPointer !== event.pointerId) return;
      s.trimPointer = undefined;
      const pressed = s.trimPressed;
      s.trimPressed = undefined;
      if (event.button === 0 && !this.drag) {
        const { sx, sy } = this.evPt(event);
        s.trimPreview = this.sketchTrimAt(sx, sy);
        const released = s.trimPreview;
        if (pressed && released && pressed.target === released.target && (
          'splitAt' in pressed ? 'splitAt' in released
            : 'sides' in pressed ? 'sides' in released && pressed.sides[0].corner === released.sides[0].corner && pressed.sides[1].id === released.sides[1].id
            : 'stroke' in pressed ? 'stroke' in released && pressed.from.at === released.from.at && pressed.to.at === released.to.at
              : 'cutter' in released && pressed.cutter === released.cutter && pressed.end === released.end)) {
          void this.commitSketchTrim(released);
        }
      }
      this.redraw();
      return;
    }
    if (s.tool === 'centerRect') {
      const press = s.centerRectPress;
      if (!press || !event || press.id !== event.pointerId) return;
      s.centerRectPress = undefined;
      const { sx, sy } = this.evPt(event);
      if (event.button !== 0 || sx < RULER || sy < RULER || sx >= this.w || sy >= this.h) {
        if (press.newCenter) s.draft = [];
      } else if (!press.newCenter || Math.hypot(sx - press.x, sy - press.y) >= 3) {
        const { p, id } = this.sketchPointAt(sx, sy, event);
        this.placeSketchCenterRect(p, id);
      }
      this.redraw();
      return;
    }
    if (s.frame?.pointerId !== undefined) {
      if (!event || event.pointerId !== s.frame.pointerId) return;
      if (event.button === 0) {
        const { sx, sy } = this.evPt(event);
        if (s.patternDraft) this.finishSketchPatternFrame({ x: sx, y: sy });
        else this.finishSketchFrame({ x: sx, y: sy });
      } else {
        s.frame = undefined;
        this.redraw();
      }
      return;
    }
    if (s.tool === 'polyline' || isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool)) {
      if (!event || s.polylinePointer !== event.pointerId) return;
      s.polylinePointer = undefined;
      const { sx, sy } = this.evPt(event);
      if (event.button === 0 && !this.drag && sx >= RULER && sy >= RULER && sx < this.w && sy < this.h) {
        if (isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool)) {
          const { p, id } = this.sketchPointAt(sx, sy, event);
          if (isSketchCircleTool(s.tool)) this.sketchGridClick(sx, sy, p, id);
          else this.sketchShapePlacementClick(p, id, { x: sx, y: sy });
        } else this.sketchPolylineClick(sx, sy, event);
      }
      return;
    }
    const d = s.drag;
    s.drag = null;
    if (d && 'con' in d) {
      const c = s.sk.cons.find((x) => x.id === d.con);
      if (c && (c.at?.x !== d.at.x || c.at?.y !== d.at.y)) {
        const at = c.at;
        c.at = d.at;
        this.sketchChange(t('Skizze: Maß verschieben'), (sk) => {
          const cc = sk.cons.find((x) => x.id === d.con);
          if (cc) cc.at = at;
        });
      }
    } else if (d && 'pt' in d && d.moved) {
      this.writeSketch();
      this.sketchSolve(false);
      if (this.syncPatternsAfterSolve() > 0) this.writeSketch();
      // Echter Zug: Fang-Markierung und Hover fallen mit Drag-Ende (Auswahl bleibt).
      s.hover = null;
      this.clearSnap();
    }
    this.redraw();
  }

  sketchDouble(this: Editor, sx: number, sy: number) {
    const s = this.sketchEdit;
    // Muster-Fenster offen: die beiden Klicks haben bereits gepickt (kein Kettengerüst → Einfach-Picks).
    if (!s || s.patternDraft) return;
    if (s.tool === 'polyline' || isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool) || s.tool === 'centerRect' || isSketchLineEdit(s.tool)) return;
    if (s.tool === 'line') {
      s.draft = [];
      s.draftIds = [];
      this.redraw();
      return;
    }
    // Phase 4: Doppelklick auf Badge oder Kopie-Geometrie → Muster bearbeiten.
    const badge = this.sketchPatternBadgeAt(sx, sy);
    if (badge) { openPatternEdit(this, badge); return; }
    const h = this.sketchHitTest(sx, sy);
    if (h && h.kind !== 'con') {
      const owner = patternOwnerOfId(s.sk, h.id);
      if (owner) { openPatternEdit(this, owner.id); return; }
    }
    if (h?.kind === 'con') void this.editSketchDim(h.id);
  }

  // ---------- Bemaßungen ----------

  /** Ausstehende runde Wahl (Kreis/Bogen): eingestellter Typ nach Zweitklick/Taste-Umschaltung */
  dimRoundType(this: Editor): ConType | null {
    const s = this.sketchEdit;
    const e = s?.dimPick.length === 1 && s.dimPick[0]?.kind === 'ent' ? entOf(s.sk, s.dimPick[0].id) : undefined;
    if (e?.t !== 'circle' && e?.t !== 'arc') return null;
    const def: ConType = e.t === 'circle' ? 'diameter' : 'radius';
    return s!.dimRoundFlip ? (toggleRoundDim(def) ?? def) : def;
  }

  /** Hinweis zur ausstehenden runden Wahl (dokumentiert die Umschaltung) */
  dimRoundHint(this: Editor) {
    const cur = this.dimRoundType();
    if (!cur) return;
    const other = toggleRoundDim(cur) ?? cur;
    this.hint = t('Bemaßen: {what} — Zweitklick oder U schaltet auf {other} um, Klick ins Leere übernimmt.', { what: CON_LABELS[cur], other: CON_LABELS[other] });
    this.emit('tool');
  }

  /** Element für das Bemaßungs-Werkzeug wählen; legt die Bemaßung an, sobald die Wahl eindeutig ist */
  sketchDimPick(this: Editor, h: SkHit) {
    const s = this.sketchEdit!;
    if (s.valueEdit) return;
    const sk = s.sk;
    const ent = (x: SkHit) => (x?.kind === 'ent' ? entOf(sk, x.id) : undefined);
    const round = (e: SkEnt | undefined) => (e?.t === 'circle' || e?.t === 'arc' ? e : undefined);
    // Klick ins Leere oder auf ein Maß: ausstehende Wahl bestätigen (Kreis/Bogen mit eingestelltem Typ, Linie als Länge)
    if (!h || h.kind === 'con') {
      const first = s.dimPick.length === 1 ? ent(s.dimPick[0]) : undefined;
      const pending = this.dimRoundType();
      s.dimPick = [];
      s.dimRoundFlip = undefined;
      if (pending && first) void this.addSketchDim(pending, [first.id]);
      else if (first?.t === 'line') void this.addSketchDim('distance', [first.id]);
      this.sketchHint();
      return;
    }
    // Zweiter Klick auf denselben Kreis/Bogen: zwischen Durchmesser/Radius umschalten und anlegen
    if (s.dimPick.length === 1 && h.kind === 'ent') {
      const first = ent(s.dimPick[0]);
      if (first && round(first) && first.id === h.id) {
        const flipped = toggleRoundDim(this.dimRoundType() ?? (first.t === 'circle' ? 'diameter' : 'radius')) ?? 'radius';
        s.dimPick = [];
        s.dimRoundFlip = undefined;
        this.sketchHint();
        void this.addSketchDim(flipped, [first.id]);
        return;
      }
    }
    s.dimPick.push(h);
    const picks = s.dimPick;
    let make: { t: ConType; r: number[] } | null = null;
    if (picks.length === 1) {
      const e = ent(picks[0]);
      if (round(e)) {
        s.dimPick = [];
        void this.addSketchDim(e!.t === 'circle' ? 'diameter' : 'radius', [e!.id]);
        return;
      } else if (e?.t === 'line') {
        s.dimPick = [];
        void this.addSketchDim('distance', [e.id]);
        return;
      }
    } else if (picks.length === 2) {
      const [a, b] = picks;
      const ea = ent(a), eb = ent(b);
      const arcEnd = (arc: SkEnt | undefined, p: SkHit) =>
        arc?.t === 'arc' && p?.kind === 'pt' && (p.id === arc.s || p.id === arc.e);
      if (a?.kind === 'pt' && b?.kind === 'pt') make = { t: 'distance', r: [a.id, b.id] };
      else if (a?.kind === 'pt' && ent(b)?.t === 'line') make = { t: 'distance', r: [a.id, b!.id] };
      else if (b?.kind === 'pt' && ent(a)?.t === 'line') make = { t: 'distance', r: [b.id, a!.id] };
      else if (ent(a)?.t === 'line' && ent(b)?.t === 'line' && a!.id !== b!.id) make = { t: 'angle', r: [a!.id, b!.id] };
      else if (ent(a)?.t === 'line' && a!.id === b!.id) make = { t: 'distance', r: [a!.id] };
      // Bogen + einer seiner Endpunkte: Bogenlänge
      else if (arcEnd(ea, b)) make = { t: 'arcLength', r: [a!.id] };
      else if (arcEnd(eb, a)) make = { t: 'arcLength', r: [b!.id] };
      // Kante-zu-Kante: Linie↔Kreis, Punkt↔Kreis, Kreis↔Kreis (Lücke senkrecht/radial/entlang Zentrumsachse)
      else if (ea?.t === 'line' && eb?.t === 'circle') make = { t: 'distance', r: [a!.id, b!.id] };
      else if (eb?.t === 'line' && ea?.t === 'circle') make = { t: 'distance', r: [b!.id, a!.id] };
      else if (a?.kind === 'pt' && eb?.t === 'circle') make = { t: 'distance', r: [a.id, b!.id] };
      else if (b?.kind === 'pt' && ea?.t === 'circle') make = { t: 'distance', r: [b.id, a!.id] };
      else if (ea?.t === 'circle' && eb?.t === 'circle' && a!.id !== b!.id) make = { t: 'distance', r: [a!.id, b!.id] };
      // Kreis + sein Mittelpunkt-Pick: Mittenabstand wie bisher (beides Punktwahlen)
    }
    if (!make) {
      if (picks.length >= 2) { s.dimPick = []; s.dimRoundFlip = undefined; }
      return;
    }
    const m = make;
    s.dimPick = [];
    s.dimRoundFlip = undefined;
    this.sketchHint();
    void this.addSketchDim(m.t, m.r);
  }

  /** Neue Bemaßung: Wert erfragen (Vorschlag: aktueller Wert) und setzen */
  async addSketchDim(this: Editor, type: ConType, r: number[], opts: { place?: Pt } = {}) {
    const s = this.sketchEdit;
    if (!s || s.valueEdit) return;
    const edit = { controller: new AbortController(), draft: undefined as SkCon | undefined };
    s.valueEdit = edit;
    const json = s.json, position = this.history.position;
    try {
    // Ablage-bestimmt-Typ: explizite Ablage (Inline-Wertbox) entscheidet frei/hdistance/vdistance
    const toSketch = (p: Pt) => this.skFromWorld(this.toWorld(p.x, p.y));
    const twoPts = () => r.length === 2 && r.every((id) => !!ptOf(s.sk, id));
    const baseType = type;
    const classify = (at: Pt) => {
      const pp = baseType === 'distance' ? pointPair(s.sk, r) : null;
      if (pp && twoPts()) type = classifyDistancePlacement(pp[0], pp[1], at);
    };
    if (opts.place) classify(toSketch(opts.place));
    let axis = type === 'hdistance' || type === 'vdistance';
    const validAxisPair = (sk: Sketch) => r.length === 2 && r[0] !== r[1] && r.every((id) => !!ptOf(sk, id));
    if (axis && !validAxisPair(s.sk)) return;
    let probe: SkCon = { id: 0, t: type, r };
    const cur = measureCon(s.sk, probe);
    if (cur === null) return;
    const draftAt = (drop?: Pt) => dimensionOffset(s.sk, { id: -1, t: type, r }, drop);
    let previewPlace = opts.place;
    const preview = (place = previewPlace) => {
      previewPlace = place;
      const drop = place ? toSketch(place) : undefined;
      if (drop) classify(drop);
      probe = { id: -1, t: type, r: [...r] };
      const v = measureCon(s.sk, probe) ?? cur;
      edit.draft = { ...probe, v, at: draftAt(drop) };
      this.redraw();
      return v;
    };
    preview(opts.place);
    const ans = this.onSketchValue ? await this.onSketchValue(dimTitle(type, r), cur, type === 'angle' ? '°' : 'mm', undefined, {
      signal: edit.controller.signal,
      placement: preview,
      label: () => dimTitle(type, r),
      cycle: r.length === 1 && entOf(s.sk, r[0])?.t !== 'line' ? () => {
        const e = entOf(s.sk, r[0]);
        if (r.length === 1 && e && e.t !== 'line') type = type === 'radius' ? 'diameter' : type === 'diameter' && e.t === 'arc' ? 'arcLength' : 'radius';
        return preview();
      } : undefined,
    }) : { v: cur };
    if (!ans || edit.controller.signal.aborted || this.sketchEdit !== s || s.json !== json || this.history.position !== position) return;
    // Bewusste Ablage beim Setzen (Cursor bewegt): Typ nachträglich nach der Ablage bestimmen
    if (ans.place) {
      const at = toSketch(ans.place);
      const before = type;
      classify(at);
      if (type !== before) {
        axis = type === 'hdistance' || type === 'vdistance';
        if (axis && !validAxisPair(s.sk)) return;
        probe = { id: 0, t: type, r };
      }
    }
    axis = type === 'hdistance' || type === 'vdistance';
    const place = ans.place ?? opts.place;
    const drop = place ? toSketch(place) : undefined;
    if (axis && !(ans.v > 0)) {
      this.hint = t('Der Wert muss größer als 0 sein.');
      this.emit('tool');
      return;
    }
    if (!ans.expr && !validRoundDimension(s.sk, probe, ans.v)) {
      this.hint = t('Das Kreismaß ist nicht darstellbar. Gib ein größeres positives Maß ein.');
      s.rejectedDiagnostics = [{ kind: 'geometry', ids: [], message: this.hint }];
      this.emit('tool'); this.redraw();
      return;
    }
    // Maßlinie anfangs bei der Ablage, sonst 5 mm neben der Strecke (wie in der Anzeige ohne eigene Lage)
    const at = draftAt(drop);
    const extra: Partial<SkCon> = { v: ans.v, ...(ans.expr ? { expr: ans.expr } : {}), ...(at ? { at } : {}) };
    // Überbestimmt, aber lösbar: Referenzmaß (driven) statt Ablehnung; unlösbar: echte Ablehnung
    let driven = false;
    {
      const trial = cloneSketch(s.sk);
      const added = addCon(trial, type, r, { ...extra });
      const errs = this.sketchResolveExprs(trial, dimParamScope(this, ans.pendingParam));
      const res = errs.length ? null : solveSketch(trial);
      if (!res || !res.ok) {
        this.hint = t('Das Maß ist geometrisch unmöglich.');
        s.rejectedDiagnostics = [{ kind: 'geometry', ids: [], message: this.hint }];
        this.emit('tool'); this.redraw();
        return;
      }
      const prev = new Set(s.status?.redundant ?? []);
      if (res.redundant.includes(added.id) || res.redundant.some((id) => !prev.has(id))) driven = true;
    }
    this.sketchChange(t('Skizze: Bemaßung'), (sk) => {
      if (axis && !validAxisPair(sk)) return false;
      addCon(sk, type, r, { ...extra, ...(driven ? { driven: true } : {}) });
    }, { pendingParam: ans.pendingParam });
    if (driven) {
      this.hint = t('Referenzmaß: Das Maß war bereits bestimmt und misst nur mit (in Klammern).');
      this.emit('tool');
    }
    } finally {
      if (s.valueEdit === edit) s.valueEdit = undefined;
      this.redraw();
    }
  }

  /** Wert einer Bemaßung ändern (Referenzmaße sind readonly und zeigen nur mit) */
  async editSketchDim(this: Editor, id: number) {
    const s = this.sketchEdit;
    const c = s?.sk.cons.find((x) => x.id === id);
    if (!s || s.valueEdit || !c || !isDim(c.t)) return;
    if (c.driven) {
      this.hint = t('Referenzmaß: Das Maß misst nur mit und lässt sich nicht ändern. Lösche es oder mache es treibend, um den Wert zu setzen.');
      this.emit('tool');
      return;
    }
    const position = this.history.position;
    const edit = { controller: new AbortController() };
    s.valueEdit = edit;
    try {
    const ans = this.onSketchValue ? await this.onSketchValue(sketchDimensionTitle(c, sketchSlots(s.sk)), c.v ?? measureCon(s.sk, c) ?? 0, c.t === 'angle' ? '°' : 'mm', c.expr, { signal: edit.controller.signal }) : null;
    this.syncSketch();
    if (!ans || edit.controller.signal.aborted || this.sketchEdit !== s || this.history.position !== position || !s.sk.cons.includes(c)) return;
    if (!ans.expr && (c.min !== undefined && !(ans.v >= c.min) || !validRoundDimension(s.sk, c, ans.v))) {
      this.hint = c.min !== undefined && !(ans.v >= c.min) ? t('Das Maß ist zu klein. Gib einen größeren positiven Wert ein.')
        : t('Das Kreismaß ist nicht darstellbar. Gib ein größeres positives Maß ein.');
      s.rejectedDiagnostics = [{ kind: 'geometry', ids: [id], message: this.hint }];
      this.emit('tool'); this.redraw();
      return;
    }
    this.sketchChange(t('Skizze: Maß ändern'), (sk) => {
      const cc = sk.cons.find((x) => x.id === id);
      if (!cc) return false;
      cc.v = ans.v;
      if (ans.expr) cc.expr = ans.expr;
      else delete cc.expr;
    }, { pendingParam: ans.pendingParam });
    } finally {
      if (s.valueEdit === edit) s.valueEdit = undefined;
    }
  }

  // ---------- Beziehungen aus der Auswahl ----------

  /** Welche Beziehungen passen zur Auswahl? (für die Knöpfe) */
  sketchConOptions(this: Editor): SketchRelationAction[] {
    const s = this.sketchEdit;
    if (!s) return [];
    return CON_BUTTONS.filter((t) => conFromSel(s.sk, [...s.sel], t) !== null);
  }

  startSketchRelation(this: Editor, type: SketchRelationAction) {
    this.syncSketch();
    const s = this.sketchEdit;
    if (!s) return;
    if (!s.relationPick && conFromSel(s.sk, [...s.sel], type)) { this.sketchConstrain(type); return; }
    const previous = s.relationPick?.previous ?? new Set(s.sel);
    if (s.relationPick?.type === type) { this.setSketchTool('select'); return; }
    this.setSketchTool('select');
    s.relationPick = { type, previous };
    s.sel = new Set();
    s.hover = null;
    this.hint = t('{relation}: Wähle die Bezugselemente. Esc bricht ab.', { relation: CON_LABELS[type] });
    this.canvas.focus({ preventScroll: true });
    this.emit('tool'); this.redraw();
  }

  sketchRelationClick(this: Editor, hit: SkHit) {
    const s = this.sketchEdit, pending = s?.relationPick;
    if (!s || !pending || !hit || hit.kind === 'con') return;
    if (s.sel.has(hit.id)) s.sel.delete(hit.id);
    else s.sel.add(hit.id);
    if (conFromSel(s.sk, [...s.sel], pending.type)) {
      s.relationPick = undefined;
      this.sketchConstrain(pending.type);
    }
    this.emit('tool'); this.redraw();
  }

  /** Beziehung aus der Auswahl setzen */
  sketchConstrain(this: Editor, type: SketchRelationAction, selection?: readonly number[]) {
    const s = this.sketchEdit;
    if (!s) return;
    this.syncSketch();
    const sel = [...(selection ?? s.sel)];
    const list = conFromSel(s.sk, sel, type);
    if (!list) {
      this.hint = t('Diese Beziehung passt nicht zur Auswahl.');
      this.emit('tool');
      return;
    }
    const ok = this.sketchChange(t('Skizze: {name}', { name: CON_LABELS[type] }), (sk) => {
      for (const c of list) addCon(sk, c.t, c.r, c.t === 'fixed' ? { x: ptOf(sk, c.r[0])!.x, y: ptOf(sk, c.r[0])!.y } : {});
    });
    if (ok) s.sel.clear();
    else if (type === 'equal' && this.sketchEqualizeWithDriven(list)) return;
    this.redraw();
  }

  /**
   * Gleich trotz Maßkonflikt: Widerspricht Gleich nur treibenden Maßen an den
   * Folge-Objekten, werden diese zu Referenzmaßen (driven) und Gleich erneut gesetzt.
   * Master ist das erste gewählte Objekt — dessen Maß bleibt treibend. Gilt für alle
   * Gleich-fähigen Typen (Linien, Kreise, Bögen); Maße am Master oder außerhalb der
   * gleichgesetzten Objekte sowie Nicht-Maß-Konflikte bleiben Ablehnung wie bisher.
   */
  sketchEqualizeWithDriven(this: Editor, list: { t: ConType; r: number[] }[]): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    const conflicts = new Set((s.rejectedDiagnostics ?? []).filter((d) => d.kind === 'conflict').flatMap((d) => d.ids));
    const master = list[0]?.r[0];
    const members = new Set(list.flatMap((c) => c.r));
    if (master === undefined || !members.has(master)) return false;
    // Refs, die zu gleichgesetzten Folge-Objekten gehören (Entität selbst oder einer ihrer Punkte,
    // sofern der Punkt kein Master-Objekt mitbestimmt). Fremdrefs schließen Umwandlung aus.
    const ownedByFollowers = (id: number): boolean => {
      if (members.has(id)) return id !== master;
      if (!ptOf(s.sk, id)) return false;
      const owners = s.sk.ents.filter((e) => entPoints(e).includes(id));
      return owners.length > 0 && owners.every((e) => members.has(e.id) && e.id !== master);
    };
    const convertible = [...conflicts].filter((id) => {
      const c = s.sk.cons.find((x) => x.id === id);
      return !!c && isDim(c.t) && !c.driven && c.r.length > 0 && c.r.every(ownedByFollowers);
    });
    if (!convertible.length) {
      // Manche Löserläufe nennen keine blockierenden Maße (z. B. Linien-Längen): dann alle
      // treibenden Größenmaße der Folge-Objekte als Kandidaten — der Retry in einem einzigen
      // sketchChange entscheidet, ein Fehlschlag rollt alles zurück (kein Teilschnitt).
      const isSizeDim = (t: ConType, r: readonly number[]) =>
        (t === 'radius' || t === 'diameter' || t === 'distance' || t === 'arcLength') && r.length === 1;
      convertible.push(...s.sk.cons.filter((c) =>
        isDim(c.t) && !c.driven && isSizeDim(c.t, c.r) && c.r.every(ownedByFollowers)).map((c) => c.id));
    }
    if (!convertible.length) return false;
    const ok = this.sketchChange(t('Skizze: {name}', { name: CON_LABELS.equal }), (sk) => {
      for (const id of convertible) {
        const c = sk.cons.find((x) => x.id === id);
        if (c) c.driven = true;
      }
      for (const c of list) addCon(sk, c.t, c.r);
    });
    if (ok) {
      s.sel.clear();
      this.hint = t('Gleich gesetzt; widersprechende Maße als Referenz übernommen.');
      this.emit('tool');
      this.redraw();
    }
    return ok;
  }

  /** Gewählte Elemente zu Hilfsgeometrie machen (bzw. zurück) */
  sketchToggleAux(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    const ents = s.sk.ents.filter((e) => s.sel.has(e.id));
    if (!ents.length) return;
    const on = !ents.every((e) => e.aux);
    this.sketchChange(t('Skizze: Hilfsgeometrie'), (sk) => {
      for (const e of sk.ents) if (s.sel.has(e.id)) {
        if (on) e.aux = true;
        else delete e.aux;
      }
    }, { keepOnFail: true });
  }

  /** Konstruktions-Modus umschalten: neue Elemente werden Hilfsgeometrie (Auswahl-Toggle bleibt) */
  sketchToggleDrawAux(this: Editor) {
    const s = this.sketchEdit;
    if (!s) return;
    s.drawAux = !s.drawAux;
    if (s.drawAux) s.drawLine = 'normal';
    this.hint = s.drawAux
      ? t('Konstruktions-Modus ein: neue Elemente werden Hilfsgeometrie.')
      : t('Konstruktions-Modus aus.');
    this.emit('tool');
    this.redraw();
  }

  /** Linientyp des Seitenmenüs: mit Auswahl auf Auswahl anwenden, sonst Zeichenmodus. */
  sketchApplyLineType(this: Editor, type: SketchLineType) {
    const s = this.sketchEdit;
    if (!s) return;
    const ids = [...s.sel].filter((id) => entOf(s.sk, id));
    if (!ids.length) {
      // Zeichenmodus: Konstruktion läuft weiter über den G-Toggle (drawAux).
      if (type === 'construction') { if (!s.drawAux) this.sketchToggleDrawAux(); }
      else { s.drawAux = false; s.drawLine = type; this.emit('tool'); this.redraw(); }
      return;
    }
    const apply = (sk: Sketch) => {
      const fresh = [...s.sel].filter((id) => entOf(sk, id));
      const r = setSketchLineType(sk, fresh, type);
      if (!r.applied.length) return false;
      if (r.skipped.length) {
        this.hint = t('Mittellinie und Unendlich brauchen Linien: {n} übersprungen.', { n: r.skipped.length });
        this.emit('tool');
      }
    };
    this.sketchChange(t('Skizze: Linientyp'), apply, { keepOnFail: true });
  }

  /** 2D-„Skizze einpassen": Ansicht auf die Skizzen-BBox legen (Welt, mit Matrix). */
  sketchFitView(this: Editor): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    const box = sketchWorldBounds(s.sk, s.m);
    if (!box) {
      this.hint = t('Noch keine Geometrie');
      this.emit('tool');
      return false;
    }
    this.zoomBox(box, 60);
    this.redraw();
    return true;
  }

  async sketchDeleteSel(this: Editor) {
    this.syncSketch();
    const s = this.sketchEdit;
    if (!s || !s.sel.size || s.trimPending || s.splitInsetPending) return;
    const ids = new Set(s.sel);
    const trial = cloneSketch(s.sk);
    deleteIds(trial, ids);
    const removed = lostConditions(s.sk, trial);
    const approvedLosses = new Set(removed.map((c) => c.id));
    if (!this.sketchCheckReferences(s.sk, trial, approvedLosses)) { this.emit('tool'); this.redraw(); return; }
    const losses = removed.filter((c) => !ids.has(c.id));
    if (losses.length) {
      const before = sketchJson(s.sk), position = this.history.position;
      s.trimPending = true;
      try {
        if (!(await this.onSketchTrimLosses?.(losses, true))) return;
      } finally {
        s.trimPending = false;
      }
      this.syncSketch();
      if (this.sketchEdit !== s || this.history.position !== position || sketchJson(s.sk) !== before
        || s.sel.size !== ids.size || [...ids].some((id) => !s.sel.has(id))) return;
    }
    if (this.sketchChange(t('Skizze: Löschen'), (sk) => { Object.assign(sk, trial); }, { keepOnFail: true, approvedLosses })) {
      s.sel.clear();
      this.setSketchTool(s.tool);
    }
    this.redraw();
  }

  /** Taste im Skizzenmodus; true = verarbeitet */
  sketchKey(this: Editor, e: KeyboardEvent): boolean {
    const s = this.sketchEdit;
    if (!s) return false;
    const k = e.key.toLowerCase();
    if ((k === '[' || k === ']') && e.target === this.canvas && s.snapPointer && this.cursorOnCanvas
      && !s.drag && !s.frame && !isSketchLineEdit(s.tool)) {
      const at = s.snapPointer, selecting = s.tool === 'select' || s.tool === 'dim';
      const count = selecting ? this.sketchSelectionCandidates(at.x, at.y).length : this.sketchPlacementCandidates(at.x, at.y, e).length;
      if (count < 2) return false;
      const index = ((s.snapCycle?.index ?? 0) + (k === ']' ? 1 : -1) + count) % count;
      s.snapCycle = { at, index };
      if (selecting) {
        this.clearSnap();
        s.hover = this.sketchHitTest(at.x, at.y);
        const p = s.hover?.kind === 'pt' ? ptOf(s.sk, s.hover.id) : undefined;
        if (p) this.snapHit = { p: apply(s.m, p.x, p.y), kind: 'node' };
      } else {
        const { p } = s.tool === 'polyline' ? this.sketchPolylinePoint(at.x, at.y, e) : this.sketchPointAt(at.x, at.y, e);
        this.cursor = apply(s.m, p.x, p.y);
      }
      this.redraw();
      return true;
    }
    if (k === 'escape') {
      // Muster-Fenster: Entwurf inkl. vorgemerktem Freiraum-Punkt exakt verwerfen (doc unberührt).
      if (s.patternDrag) {
        // Escape während Abstand-Ziehen: alten Text wiederherstellen, Fenster bleibt offen.
        const dd = s.patternDraft;
        if (dd) {
          if (s.patternDrag.dir === 0) dd.spacingText = s.patternDrag.restore;
          else dd.spacing2Text = s.patternDrag.restore;
          dd.error = '';
        }
        s.patternDrag = null;
        notifyPatternDialog(this);
        this.redraw();
        return true;
      }
      if (s.patternDraft) {
        this.cancelPatternDraft();
        return true;
      }
      if ((this.trackPts?.length ?? 0) || this.trackDwell) {
        this.clearTrack();
        this.clearSnap();
        this.redraw();
        return true;
      }
      if (s.relationPick) { this.setSketchTool('select'); return true; }
      if ((s.tool === 'centerRect' || isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool) || s.tool === 'constr') && (s.draft.length || s.centerRectPress || s.polylinePointer !== undefined)) {
        this.setSketchTool(s.tool);
        return true;
      }
      if (s.frame || s.frameKeys) {
        s.frame = s.frameKeys = undefined;
        this.sketchHint();
        this.redraw();
        return true;
      }
      // Nur Referenzen gewählt (Konstruktion, Tangentenbogen): Entwurf verwerfen, Modus behalten.
      if ((s.tool === 'constr' && ((s.constrRefs?.length ?? 0) > 0 || s.constrCursor !== undefined))
        || (s.tool === 'circle' && ((s.circleRefs?.length ?? 0) > 0))
        || (s.tool === 'arc' && (s.arcMode ?? 'centerStartEnd') === 'tangent' && s.arcRef != null)) {
        this.setSketchTool(s.tool);
        return true;
      }
      if (s.tool === 'polyline' && (s.polyline || s.polylinePointer !== undefined)) {
        this.setSketchTool('polyline');
        return true;
      }
      if (s.draft.length || s.dimPick.length) {
        s.draft = [];
        s.draftIds = [];
        s.circleRefs = undefined;
        s.constrRefs = undefined;
        s.constrCursor = undefined;
        s.arcRef = undefined;
        s.arcFlip = undefined;
        s.dimPick = [];
        s.dimRoundFlip = undefined;
      } else if (s.tool !== 'select') this.setSketchTool('select');
      else if (s.sel.size) s.sel.clear();
      else this.closeSketch();
      this.redraw();
      return true;
    }
    if (k === 'enter') {
      // Muster-Fenster: Enter = OK (Fokus-Regel greift in keyboard.ts — Eingaben/Buttons fangen Enter vorher ab).
      if (s.patternDraft) {
        if (!s.valueEdit) this.confirmPatternOK();
        return true;
      }
      if (s.relationPick) return true;
      // Ausstehende runde Wahl im Bemaßungswerkzeug übernehmen (ggf. nach U-Umschaltung)
      if (s.tool === 'dim') {
        const pending = this.dimRoundType();
        if (pending && s.dimPick[0]?.kind === 'ent') {
          const id = s.dimPick[0].id;
          s.dimPick = [];
          s.dimRoundFlip = undefined;
          this.sketchHint();
          void this.addSketchDim(pending, [id]);
          return true;
        }
      }
      if (isSketchLineEdit(s.tool)) {
        if (s.trimPreview && s.trimPointer === undefined) void this.commitSketchTrim(s.trimPreview);
        return true;
      }
      if ((s.tool === 'centerRect' || isSketchShapePlacement(s.tool) || isSketchCircleTool(s.tool) || s.tool === 'constr') && (s.draft.length || s.centerRectPress || s.polylinePointer !== undefined)) {
        this.setSketchTool(s.tool);
        return true;
      }
      if (s.tool === 'polyline' && s.polyline) {
        this.finishSketchPolyline();
        return true;
      }
      if (s.draft.length) {
        s.draft = [];
        s.draftIds = [];
        this.redraw();
      } else this.closeSketch();
      return true;
    }
    if (k === 'delete' || k === 'backspace') {
      if (s.relationPick) return true;
      this.sketchDeleteSel();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.target === this.canvas && (k === 'insert' || ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k))) {
      const pos = s.frameKeys ?? s.polylineKeys ?? s.snapPointer ?? (this.cursorOnCanvas ? this.toScreen(this.cursor) : { x: this.w / 2, y: this.h / 2 });
      const step = e.shiftKey ? 10 : 1;
      const dx = k === 'arrowright' ? step : k === 'arrowleft' ? -step : 0;
      const dy = k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0;
      const x = Math.max(RULER, Math.min(this.w - 1, pos.x + dx));
      const y = Math.max(RULER, Math.min(this.h - 1, pos.y + dy));
      if (s.frameKeys) {
        const p = { x, y };
        s.frameKeys = p;
        if (s.frame) s.frame.to = p;
        if (k === 'insert') {
          if (s.frame) {
            this.finishSketchFrame(p);
            s.frameKeys = undefined;
            this.sketchHint();
          } else s.frame = { from: p, to: p, additive: e.shiftKey };
        }
        this.redraw();
        return true;
      }
      s.polylineKeys = { x, y };
      s.snapPointer = { x, y };
      if (s.snapCycle && Math.hypot(x - s.snapCycle.at.x, y - s.snapCycle.at.y) > 2) s.snapCycle = undefined;
      this.cursorOnCanvas = true;
      if (s.tool === 'select' || s.tool === 'dim') {
        s.hover = this.sketchHitTest(x, y);
        this.cursor = this.toWorld(x, y);
        this.clearSnap();
        if (k === 'insert' && s.hover) {
          if (s.tool === 'dim') this.sketchDimPick(s.hover);
          else if (s.relationPick) this.sketchRelationClick(s.hover);
          else { this.sketchSelectHit(s.hover.id, e.shiftKey); this.emit('sel'); }
        }
        this.redraw();
        return true;
      }
      if (isSketchLineEdit(s.tool)) {
        s.trimPreview = this.sketchTrimAt(x, y);
        if (k === 'insert' && s.trimPreview) void this.commitSketchTrim(s.trimPreview);
        this.redraw();
        return true;
      }
      const { p, id } = s.tool === 'polyline' ? this.sketchPolylinePoint(x, y, e) : this.sketchPointAt(x, y, e);
      this.cursor = apply(s.m, p.x, p.y);
      this.cursorOnCanvas = true;
      if (k === 'insert') {
        if (s.tool === 'centerRect') this.placeSketchCenterRect(p, id);
        else if (isSketchShapePlacement(s.tool)) this.sketchShapePlacementClick(p, id, { x, y });
        else if (isSketchCircleTool(s.tool)) this.sketchGridClick(x, y, p, id);
        else if (s.tool === 'polyline') this.sketchPolylineClick(x, y, e);
        else this.sketchDown(x, y, { altKey: false, ctrlKey: false, metaKey: false, shiftKey: e.shiftKey, pointerId: -1 });
      }
      this.redraw();
      return true;
    }
    if (s.tool === 'polyline' && k === 'a') {
      s.polylineArc = !s.polylineArc;
      if (s.polyline) { s.polyline.through = undefined; s.polyline.throughId = undefined; }
      this.sketchHint();
      this.redraw();
      return true;
    }
    const tools: Record<string, SkTool> = { l: 'line', r: 'rect', c: 'circle', a: 'arc', d: 'dim', s: 'select', k: 'constr' };
    if (tools[k]) {
      this.setSketchTool(tools[k]);
      return true;
    }
    // Hinweis: X bleibt bei konzentrisch (concentric belegt) und schaltet NICHT den
    // Konstruktions-Modus — SolidCraft-Kürzel nicht blind übernehmen, Belegung geht vor.
    const cons: Record<string, ConType> = { h: 'horizontal', v: 'vertical', o: 'coincident', p: 'parallel', n: 'perpendicular', e: 'equal', t: 'tangent', f: 'fixed', x: 'concentric', m: 'midpoint', y: 'symmetric' };
    if (cons[k]) {
      this.startSketchRelation(cons[k]);
      return true;
    }
    if (k === 'g') {
      // Auswahlpfad bleibt: mit Elementauswahl Hilfsgeometrie umschalten, sonst Konstruktions-Modus.
      if ([...s.sel].some((id) => entOf(s.sk, id))) this.sketchToggleAux();
      else this.sketchToggleDrawAux();
      return true;
    }
    // Bemaßung: ausstehende Kreis-/Bogenwahl zwischen Durchmesser/Radius umschalten
    if (k === 'u' && s.tool === 'dim' && this.dimRoundType()) {
      s.dimRoundFlip = !s.dimRoundFlip;
      this.dimRoundHint();
      this.redraw();
      return true;
    }
    // Bogen-Tangente: ausstehende Richtung zwischen stetig und Gegenrichtung umschalten
    if (k === 'u' && s.tool === 'arc' && (s.arcMode ?? 'centerStartEnd') === 'tangent') {
      s.arcFlip = !s.arcFlip;
      this.sketchHint();
      this.redraw();
      return true;
    }
    return false;
  }

  /**
   * Pfade in eine Skizze umwandeln: gerade Segmente werden Linien, erkannte Kreise und Bögen werden Kreise und
   * Bögen, gemeinsame Knoten gemeinsame Punkte; freie Bézierkurven werden durch Linien angenähert.
   */
  async convertSelToSketch(this: Editor) {
    const { subsToSketch } = await import('../sketch/convert');
    const { shapeSubs } = await import('../geom');
    const { transformSubs } = await import('../importers');
    // Alle gewählten Formen kommen in eine gemeinsame Skizze, damit Beziehungen zwischen ihnen möglich sind
    const src = this.sel.filter((o) => this.doc.objs.includes(o) && !['group', 'image', 'text'].includes(o.shape.kind) && !isSketchObj(o));
    const subs = src.flatMap((o) => transformSubs(shapeSubs(o.shape), o.m));
    if (!subs.length) {
      this.hint = t('Keine Pfade oder Formen in der Auswahl.');
      this.emit('tool');
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of subs)
      for (const q of sp.nodes) {
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }
    const m = translate(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
    const sk = subsToSketch(transformSubs(subs, inv(m)));
    this.snapshot(t('In Skizze umwandeln'));
    const first = src[0];
    const o: Obj = { ...first, m, shape: { kind: 'gen', gen: 'sketch', v: 1, params: { sketch: sketchJson(sk) }, subs: sketchSubs(sk) } };
    delete o.bind;
    this.doc.objs = this.doc.objs.filter((x) => !src.includes(x) || x === first).map((x) => (x === first ? o : x));
    this.setSel([o]);
    this.emit('doc');
    await this.editSketch(o);
  }

}

// ---------- Hilfen ----------

function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const tt = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * tt - x, a.y + dy * tt - y);
}

/** Automatische Beziehung für eine neu gezeichnete Linie: fast waagrecht/senkrecht */
function autoConstrain(sk: Sketch, l: SkEnt) {
  if (l.t !== 'line') return;
  const a = ptOf(sk, l.a)!,
    b = ptOf(sk, l.b)!;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const off = (v: number) => Math.min(Math.abs(v), Math.abs(180 - Math.abs(v)));
  if (off(ang) < AUTO_DEG) addCon(sk, 'horizontal', [l.id]);
  else if (Math.abs(Math.abs(ang) - 90) < AUTO_DEG) addCon(sk, 'vertical', [l.id]);
}

export const CON_BUTTONS = ['coincident', 'joinEnds', 'horizontal', 'vertical', 'parallel', 'collinear', 'perpendicular', 'equal', 'tangent', 'concentric', 'midpoint', 'symmetric', 'fixed'] as const satisfies readonly SketchRelationAction[];

export const CON_LABELS: Record<SketchRelationAction, string> = {
  coincident: t('Deckungsgleich'),
  joinEnds: t('Endpunkte verbinden'),
  horizontal: t('Horizontal|Beziehung'),
  vertical: t('Vertikal|Beziehung'),
  parallel: t('Parallel'),
  collinear: t('Auf derselben Geraden'),
  perpendicular: t('Senkrecht|Beziehung'),
  equal: t('Gleich|Beziehung'),
  fixed: t('Fest|Beziehung'),
  pointOnLine: t('Punkt auf Linie'),
  pointOnCircle: t('Punkt auf Kreis'),
  intersection: t('Schnittpunkt'),
  midpoint: t('Mittelpunkt|Beziehung'),
  segmentFraction: t('Anteil der Strecke'),
  arcSpan: t('Anteil des Kreisbogens'),
  symmetric: t('Symmetrisch'),
  tangent: t('Tangential'),
  concentric: t('Konzentrisch'),
  distance: t('Abstand'),
  hdistance: t('Waagrechter Abstand'),
  vdistance: t('Senkrechter Abstand'),
  angle: t('Winkel'),
  radius: t('Radius'),
  diameter: t('Durchmesser'),
  radialOffset: t('Kreisversatz'),
  arcLength: t('Bogenlänge'),
};

/** Kurzzeichen der Beziehungen an der Geometrie */
export const CON_GLYPHS: Partial<Record<SketchRelationAction, string>> = {
  horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', equal: '=', fixed: '⚓', pointOnLine: '⋯', pointOnCircle: '◌', intersection: '×',
  midpoint: 'M', symmetric: '⇹', tangent: 'T', concentric: '◎', coincident: '•', collinear: '━ ━',
};

export const dimTitle = (type: ConType, r: number[]) => (type === 'distance' && r.length === 1 ? t('Länge') : CON_LABELS[type]);

export function sketchDimensionTitle(c: SkCon, slots: ReturnType<typeof sketchSlots>) {
  if (slots.some((slot) => slot.width.id === c.id)) return t('Langlochbreite');
  if (slots.some((slot) => slot.distance?.id === c.id)) return t('Langloch-Mittelpunktsabstand');
  return dimTitle(c.t, c.r);
}

/**
 * Beziehungen, die sich aus der Auswahl für eine Art ergeben (null = passt nicht).
 * Mehrere gleichartige Elemente bekommen die Beziehung paarweise zum ersten (z. B. drei Linien gleich lang).
 */
export function sketchOpenEnds(sk: Sketch): Map<number, number> {
  const root = coincidentRoots(sk), incident = new Map<number, number[]>();
  for (const e of sk.ents) {
    if (isConstructionGeometry(e) || e.t === 'circle' || e.t === 'ellipse' || e.t === 'point') continue;
    for (const p of e.t === 'line' ? [e.a, e.b] : [e.s, e.e]) {
      const id = root(p);
      const list = incident.get(id) ?? [];
      list.push(e.id);
      incident.set(id, list);
    }
  }
  const result = new Map<number, number>();
  for (const p of sk.pts) {
    const list = incident.get(root(p.id));
    if (list?.length === 1) result.set(p.id, list[0]);
  }
  return result;
}

function canPickRelationPart(sk: Sketch, sel: ReadonlySet<number>, hit: NonNullable<SkHit>, type: SketchRelationAction) {
  if (type === 'symmetric') {
    const points = [...sel].filter((id) => ptOf(sk, id)).length;
    return hit.kind === 'pt' ? points < 2 : sel.size === points && entOf(sk, hit.id)?.t === 'line';
  }
  if (sel.size) return false;
  if (type === 'fixed') return hit.kind === 'pt';
  if (type === 'coincident' || type === 'concentric' || type === 'midpoint') {
    return hit.kind === 'pt' || (type === 'coincident' || (entOf(sk, hit.id)?.t === 'line') === (type === 'midpoint'));
  }
  if (hit.kind === 'pt') return type === 'horizontal' || type === 'vertical';
  return type === 'tangent' || type === 'equal' || entOf(sk, hit.id)?.t === 'line';
}

export function conFromSel(sk: Sketch, sel: number[], type: SketchRelationAction): { t: ConType; r: number[] }[] | null {
  const pts = sel.filter((id) => ptOf(sk, id));
  const ents = sel.map((id) => entOf(sk, id)).filter((e): e is SkEnt => !!e);
  // Punkt-Elemente tragen keine Beziehungen (Bezugspunkte schon) — sie nehmen nicht an Profilen teil.
  if (ents.some((e) => e.t === 'point')) return null;
  const lines = ents.filter((e) => e.t === 'line');
  const rounds = ents.filter((e) => e.t === 'circle' || e.t === 'arc');
  if (pts.length + ents.length !== sel.length || !sel.length || new Set(sel).size !== sel.length) return null;
  const pairs = (list: SkEnt[], tt: ConType) => list.slice(1).map((e) => ({ t: tt, r: [list[0].id, e.id] }));
  switch (type) {
    case 'joinEnds': {
      if (pts.length !== 2 || sel.length !== 2) return null;
      const ends = sketchOpenEnds(sk);
      const [a, b] = pts.map((id) => ends.get(id));
      if (a === undefined || b === undefined || a === b) return null;
      return [{ t: 'coincident', r: pts }];
    }
    case 'coincident':
      if (pts.length === 2 && !ents.length) return [{ t: 'coincident', r: pts }];
      if (pts.length === 1 && lines.length === 1 && !rounds.length) return [{ t: 'pointOnLine', r: [pts[0], lines[0].id] }];
      if (pts.length === 1 && rounds.length === 1 && !lines.length) return [{ t: 'pointOnCircle', r: [pts[0], rounds[0].id] }];
      if (lines.length === 2 && sel.length === 2) {
        const [a, b] = lines;
        const candidates = [a.a, a.b].flatMap((p) => [b.a, b.b].map((q) => {
          const u = ptOf(sk, p)!, v = ptOf(sk, q)!;
          return { p, q, distance: Math.hypot(u.x - v.x, u.y - v.y) };
        })).sort((u, v) => u.distance - v.distance || u.p - v.p || u.q - v.q);
        const { p, q } = candidates[0];
        const root = coincidentRoots(sk);
        return root(p) === root(q) ? null : [{ t: 'coincident', r: [p, q] }];
      }
      return null;
    case 'horizontal':
    case 'vertical':
      if (lines.length && !pts.length && !rounds.length) return lines.map((l) => ({ t: type, r: [l.id] }));
      if (pts.length === 2 && !ents.length) return [{ t: type, r: pts }];
      return null;
    case 'parallel':
    case 'perpendicular':
      if (lines.length >= 2 && lines.length === sel.length && (type === 'parallel' || lines.length === 2)) return pairs(lines, type);
      return null;
    case 'collinear': {
      if (lines.length !== 2 || sel.length !== 2 || lines[0].id === lines[1].id) return null;
      const [a, b] = lines;
      const root = coincidentRoots(sk);
      const has = (t: ConType, ...r: number[]) => sk.cons.some((c) => c.t === t && c.r.length === r.length && r.every((id) => c.r.includes(id)));
      const on = (p: number, l: typeof a) => [l.a, l.b].some((q) => root(p) === root(q))
        || sk.cons.some((c) => c.t === 'pointOnLine' && c.r[1] === l.id && root(c.r[0]) === root(p));
      const aOnB = [a.a, a.b].filter((p) => on(p, b));
      const bOnA = [b.a, b.b].filter((p) => on(p, a));
      if (aOnB.length === 2 || bOnA.length === 2) return null;
      const axial = (dir: 'horizontal' | 'vertical', l: typeof a) => has(dir, l.id) || sk.cons.some((c) =>
        c.t === dir && c.r.length === 2 && [l.a, l.b].every((p) => c.r.some((q) => root(p) === root(q))));
      const parallel = has('parallel', a.id, b.id)
        || (['horizontal', 'vertical'] as const).some((dir) => axial(dir, a) && axial(dir, b));
      const onLine = aOnB.length || bOnA.length;
      const result: { t: ConType; r: number[] }[] = [];
      if (!parallel) result.push({ t: 'parallel', r: [a.id, b.id] });
      if (!onLine) result.push({ t: 'pointOnLine', r: [b.a, a.id] });
      return result.length ? result : null;
    }
    case 'equal':
      if (lines.length >= 2 && lines.length === sel.length) return pairs(lines, 'equal');
      if (rounds.length >= 2 && rounds.length === sel.length) return pairs(rounds, 'equal');
      return null;
    case 'tangent':
      // Ellipsen ausgenommen (Paket D: kein Solver-Primitiv, keine Tangenten-Bindung).
      if (ents.length === 2 && !pts.length && rounds.length >= 1 && ents.every((e) => e.t !== 'ellipse')) return [{ t: 'tangent', r: [ents[0].id, ents[1].id] }];
      return null;
    case 'concentric':
      if (rounds.length >= 2 && rounds.length === sel.length) return pairs(rounds, 'concentric');
      if (pts.length === 1 && rounds.length === 1) {
        const center = rounds[0].c;
        const root = coincidentRoots(sk);
        if (root(center) !== root(pts[0])) return [{ t: 'coincident', r: [center, pts[0]] }];
      }
      return null;
    case 'midpoint':
      if (pts.length === 1 && lines.length === 1 && sel.length === 2) return [{ t: 'midpoint', r: [pts[0], lines[0].id] }];
      return null;
    case 'symmetric':
      if (pts.length === 2 && lines.length === 1 && sel.length === 3) return [{ t: 'symmetric', r: [pts[0], pts[1], lines[0].id] }];
      return null;
    case 'fixed':
      if (pts.length && !ents.length) return pts.map((p) => ({ t: 'fixed', r: [p] }));
      return null;
    default:
      return null;
  }
}
