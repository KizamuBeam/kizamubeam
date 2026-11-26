import type { Editor } from './editor';
import type { ContextAction } from './contextMenu';
import { CON_BUTTONS, CON_LABELS, conFromSel, openPatternEditForSelection, patternHitOfSelection, type SkTool } from './editor/sketch';
import { divideSelection } from './sketch/divide';
import { entOf } from './sketch/model';
import { t } from './i18n';

/** Pending picks and placements retain their own right-click/Escape lifecycle. */
export function sketchContextReady(ed: Editor): boolean {
  const s = ed.sketchEdit;
  return ed.tool === 'sketch' && !!s && !s.draft.length && !s.polyline && !s.relationPick &&
    !s.valueEdit && !s.dimPick.length && !s.dimPress && !s.drag && !s.frame && !s.frameKeys &&
    !s.centerRectPress && s.polylinePointer === undefined && s.trimPointer === undefined &&
    !s.trimPending && !s.splitInsetPending;
}

export function sketchContextStamp(ed: Editor): string {
  const s = ed.sketchEdit;
  return JSON.stringify(s && [s.tool, [...s.sel].sort((a, b) => a - b), s.json, sketchContextReady(ed), !!ed.drag, !!ed.draft]);
}

/** Coordinates are canvas CSS pixels, exactly as for sketchDown, never device pixels. */
export function selectSketchContextHit(ed: Editor, sx: number, sy: number) {
  const s = ed.sketchEdit!;
  const hit = ed.sketchHitTest(sx, sy);
  if (hit) ed.sketchSelectHit(hit.id, false);
  else s.sel.clear();
  ed.redraw();
}

export function sketchContextGroups(ed: Editor): ContextAction[][] {
  const s = ed.sketchEdit!;
  const action = (id: string, label: string, run: ContextAction['run'], enabled = true): ContextAction => ({ id, label, run, enabled });
  const editable = s.sel.size > 0;
  const entities = s.sk.ents.filter((e) => s.sel.has(e.id));
  const singleEllipse = s.sel.size === 1 ? entOf(s.sk, [...s.sel][0]) : undefined;
  const ellipseEditable = singleEllipse?.t === 'ellipse' && !singleEllipse.aux;
  const tool = (id: SkTool, label: string, enabled = true) => ({ ...action(`sketch-tool:${id}`, label,
    () => ed.setSketchTool(id), enabled), checked: s.tool === id });
  return [[
    action('sketch-delete', t('Auswahl löschen (Entf)'), () => ed.sketchDeleteSel(), editable),
    action('sketch-divide', t('In N gleiche Teile teilen'), () => void ed.sketchDivideSelected(), divideSelection(s.sk, s.sel) !== undefined),
    action('sketch-pattern-edit', t('Skizzenmuster bearbeiten'), () => openPatternEditForSelection(ed), patternHitOfSelection(s.sk, s.sel) !== null),
    action('sketch-ellipse-axes', t('Ellipsenachsen…'), () => ed.editEllipseAxes(), ellipseEditable),
    { ...action('sketch-aux', t('Hilfsgeometrie ein/aus (G): wird nicht gelasert'), () => ed.sketchToggleAux(), editable && entities.length > 0),
      checked: entities.length > 0 && entities.every((e) => e.aux) },
  ], [tool('select', t('Auswählen')), tool('line', t('Linie')), tool('circle', t('Kreis')), tool('ellipse', t('Ellipse')),
    tool('rect', t('Rechteck')), tool('point', t('Punkt setzen')), tool('dim', t('Bemaßen (D)'), editable)],
  CON_BUTTONS.map((type) => action(`sketch-relation:${type}`, CON_LABELS[type], () => ed.sketchConstrain(type),
    editable && conFromSel(s.sk, [...s.sel], type) !== null)),
  [action('sketch-cancel', t('Abbrechen'), () => ed.setSketchTool('select'), s.tool !== 'select')]];
}
