// Modus-Varianten der Skizzenwerkzeuge als eigene Buttons (keine Selects).
// DOM-frei und testbar: die Tabelle trägt Tool, Modus-Feld und Label je Variante;
// sketchPanel.ts baut daraus die Flyout-Aktionen, Tests fahren dieselbe Liste.
import { t } from '../i18n';
import type { SkTool } from '../editor/sketch';
import type { SketchArcMode } from './arcTangent';
import type { SketchCircleMode } from './circleModes';
import type { SketchConstrMode } from './constrLines';
import type { SketchRectMode } from './rectModes';
import type { SketchSlotMode } from './slotModes';

export type SketchVariantGroup = 'circle' | 'rectangle' | 'slot' | 'arc' | 'constr';

/** Minimaler Modus-State; SketchSession ist zuweisbar, Tests nutzen ein Fake. */
export interface SketchVariantTarget {
  tool: SkTool;
  circleMode?: SketchCircleMode;
  rectMode?: SketchRectMode;
  slotMode?: SketchSlotMode;
  constrMode?: SketchConstrMode;
  arcMode?: SketchArcMode;
}

export interface SketchVariantDef {
  /** Aktions-Suffix (Panel meldet `sketch:form:${key}` an). */
  key: string;
  tool: 'circle' | 'rect' | 'slot' | 'constr' | 'arc';
  icon: string;
  label: string;
  group: SketchVariantGroup;
  set(target: SketchVariantTarget): void;
  isActive(target: SketchVariantTarget): boolean;
}

// Icons sind wiederverwendet (keine neuen): Kreis/Durchmesser, Rechteck/Mitte-Ecke,
// Langloch, Bogen, Konstruktionslinie. Labels sind die bisherigen Select-Texte.
export const SKETCH_VARIANTS: SketchVariantDef[] = [
  { key: 'circle-centerRim', tool: 'circle', icon: 'sketchCircle', label: t('Mitte und Rand'), group: 'circle',
    set: (s) => { s.circleMode = 'centerRim'; }, isActive: (s) => (s.circleMode ?? 'centerRim') === 'centerRim' },
  { key: 'circle-twoPoint', tool: 'circle', icon: 'sketchDiameter', label: t('Durchmesser (2 Punkte)'), group: 'circle',
    set: (s) => { s.circleMode = 'twoPoint'; }, isActive: (s) => (s.circleMode ?? 'centerRim') === 'twoPoint' },
  { key: 'circle-threePoint', tool: 'circle', icon: 'sketchCircle', label: t('3 Punkte (Umkreis)'), group: 'circle',
    set: (s) => { s.circleMode = 'threePoint'; }, isActive: (s) => (s.circleMode ?? 'centerRim') === 'threePoint' },
  { key: 'circle-twoTangent', tool: 'circle', icon: 'sketchDiameter', label: t('2 Tangenten + Radius'), group: 'circle',
    set: (s) => { s.circleMode = 'twoTangent'; }, isActive: (s) => (s.circleMode ?? 'centerRim') === 'twoTangent' },
  { key: 'circle-threeTangent', tool: 'circle', icon: 'sketchCircle', label: t('3 Tangenten (Inkreis)'), group: 'circle',
    set: (s) => { s.circleMode = 'threeTangent'; }, isActive: (s) => (s.circleMode ?? 'centerRim') === 'threeTangent' },
  { key: 'rect-corners', tool: 'rect', icon: 'rect', label: t('Ecken (2 Punkte)'), group: 'rectangle',
    set: (s) => { s.rectMode = 'corners'; }, isActive: (s) => (s.rectMode ?? 'corners') === 'corners' },
  { key: 'rect-centerCorner', tool: 'rect', icon: 'sketchCenterRect', label: t('Mitte und Ecke'), group: 'rectangle',
    set: (s) => { s.rectMode = 'centerCorner'; }, isActive: (s) => (s.rectMode ?? 'corners') === 'centerCorner' },
  { key: 'rect-threePoint', tool: 'rect', icon: 'rect', label: t('3 Punkte (Kante + Tiefe)'), group: 'rectangle',
    set: (s) => { s.rectMode = 'threePoint'; }, isActive: (s) => (s.rectMode ?? 'corners') === 'threePoint' },
  { key: 'slot-centerToCenter', tool: 'slot', icon: 'sketchSlot', label: t('Mitte zu Mitte'), group: 'slot',
    set: (s) => { s.slotMode = 'centerToCenter'; }, isActive: (s) => (s.slotMode ?? 'centerToCenter') === 'centerToCenter' },
  { key: 'slot-overall', tool: 'slot', icon: 'sketchSlot', label: t('Gesamtlänge (2 Enden)'), group: 'slot',
    set: (s) => { s.slotMode = 'overall'; }, isActive: (s) => (s.slotMode ?? 'centerToCenter') === 'overall' },
  { key: 'slot-arcCenter', tool: 'slot', icon: 'sketchSlot', label: t('Bogen (Mitte, Anfang, Ende)'), group: 'slot',
    set: (s) => { s.slotMode = 'arcCenter'; }, isActive: (s) => (s.slotMode ?? 'centerToCenter') === 'arcCenter' },
  { key: 'slot-arcThreePoint', tool: 'slot', icon: 'sketchSlot', label: t('Bogen (3 Punkte)'), group: 'slot',
    set: (s) => { s.slotMode = 'arcThreePoint'; }, isActive: (s) => (s.slotMode ?? 'centerToCenter') === 'arcThreePoint' },
  { key: 'arc-centerStartEnd', tool: 'arc', icon: 'arc', label: t('Mitte, Anfang, Ende'), group: 'arc',
    set: (s) => { s.arcMode = 'centerStartEnd'; }, isActive: (s) => (s.arcMode ?? 'centerStartEnd') === 'centerStartEnd' },
  { key: 'arc-tangent', tool: 'arc', icon: 'arc', label: t('Tangente am Start'), group: 'arc',
    set: (s) => { s.arcMode = 'tangent'; }, isActive: (s) => (s.arcMode ?? 'centerStartEnd') === 'tangent' },
  { key: 'constr-free', tool: 'constr', icon: 'sketchLine', label: t('Frei (2 Punkte)'), group: 'constr',
    set: (s) => { s.constrMode = 'free'; }, isActive: (s) => (s.constrMode ?? 'free') === 'free' },
  { key: 'constr-horizontal', tool: 'constr', icon: 'sketchLine', label: t('Waagrecht'), group: 'constr',
    set: (s) => { s.constrMode = 'horizontal'; }, isActive: (s) => (s.constrMode ?? 'free') === 'horizontal' },
  { key: 'constr-vertical', tool: 'constr', icon: 'sketchLine', label: t('Senkrecht'), group: 'constr',
    set: (s) => { s.constrMode = 'vertical'; }, isActive: (s) => (s.constrMode ?? 'free') === 'vertical' },
  { key: 'constr-angle', tool: 'constr', icon: 'sketchLine', label: t('Winkel (Punkt + Winkel)'), group: 'constr',
    set: (s) => { s.constrMode = 'angle'; }, isActive: (s) => (s.constrMode ?? 'free') === 'angle' },
  { key: 'constr-parallel', tool: 'constr', icon: 'sketchLine', label: t('Parallel (Linie + Punkt)'), group: 'constr',
    set: (s) => { s.constrMode = 'parallel'; }, isActive: (s) => (s.constrMode ?? 'free') === 'parallel' },
  { key: 'constr-perpendicular', tool: 'constr', icon: 'sketchLine', label: t('Senkrecht (Linie + Punkt)'), group: 'constr',
    set: (s) => { s.constrMode = 'perpendicular'; }, isActive: (s) => (s.constrMode ?? 'free') === 'perpendicular' },
  { key: 'constr-externalTangent', tool: 'constr', icon: 'sketchLine', label: t('Tangente außen (Punkt + Kreis)'), group: 'constr',
    set: (s) => { s.constrMode = 'externalTangent'; }, isActive: (s) => (s.constrMode ?? 'free') === 'externalTangent' },
  { key: 'constr-pointTangent', tool: 'constr', icon: 'sketchLine', label: t('Tangente am Punkt (Kurve + Punkt)'), group: 'constr',
    set: (s) => { s.constrMode = 'pointTangent'; }, isActive: (s) => (s.constrMode ?? 'free') === 'pointTangent' },
  { key: 'constr-twoTangent', tool: 'constr', icon: 'sketchLine', label: t('Zwei Tangenten (2 Kreise)'), group: 'constr',
    set: (s) => { s.constrMode = 'twoTangent'; }, isActive: (s) => (s.constrMode ?? 'free') === 'twoTangent' },
  { key: 'constr-bisector', tool: 'constr', icon: 'sketchLine', label: t('Winkelhalbierende (2 Linien)'), group: 'constr',
    set: (s) => { s.constrMode = 'bisector'; }, isActive: (s) => (s.constrMode ?? 'free') === 'bisector' },
];

/** Button-Lauf (ohne Fokus/DOM): Modus-Feld setzen; das Panel schaltet danach das Tool. */
export function applySketchVariant(target: SketchVariantTarget, key: string): SketchVariantDef | undefined {
  const def = SKETCH_VARIANTS.find((v) => v.key === key);
  if (!def) return undefined;
  def.set(target);
  return def;
}

export function isSketchVariantActive(target: SketchVariantTarget, key: string): boolean {
  const def = SKETCH_VARIANTS.find((v) => v.key === key);
  return !!def && target.tool === def.tool && def.isActive(target);
}
