// Leiste des Skizzenmodus (oben über der Arbeitsfläche): Werkzeuge, Beziehungen für die Auswahl, Hilfsgeometrie,
// Zustand (Freiheitsgrade, voll bestimmt, Widerspruch), Fertig und Abbrechen. Dazu der Dialog für Bemaßungswerte.
import type { Editor } from './editor';
import { askValueInline, dimensionNumber, type DimensionInputOptions, type DimensionValue } from './sketchDimensionInput';
import { cadWindowMove, evalExpr, h, showDialog } from './dom';
import { t, tn } from './i18n';
import { CON_BUTTONS, CON_LABELS, conFromSel, sketchDimensionTitle, sketchOpenEnds, SkTool, patternCount2Max, setPatternDialogRefresh, setPatternEditOpener, clearPatternSingle, patternSingleOf, patternParamResolver, validatePatternDraft, type PatternDraft, type PatternToolKind } from './editor/sketch';
import { sketchSlots } from './sketch/slot';
import { evaluate, scopeOf } from './params';
import { guardDimParams, materializeDimParam, readDimField } from './editor/params';
import { addCenteredRectangle, addDimensionedCircle, centeredRectangleSpan, cloneSketch, entOf, entPoints, isDim, measureCon, MIN_SKETCH_RECTANGLE_SIZE, sketchJson, sketchSubs, validCircleDiameter, type SkCon, type Sketch } from './sketch/model';
import { diagnosticTitle, solveDiagnostics } from './sketch/diagnostics';
import { sketchPolylineDialog } from './sketchPolylineDialog';
import { MAX_SKETCH_POLYGON_SIDES, type SketchPolygonMode } from './sketch/polygon';
import { SKETCH_VARIANTS, applySketchVariant, isSketchVariantActive, type SketchVariantDef, type SketchVariantGroup } from './sketch/formVariants';
import { sketchTransformScope, translateSketchSelection } from './sketch/translate';
import { divideSelection } from './sketch/divide';
import type { ToolbarControlsBundle } from './toolbars';
import type { ControlContext, ToolbarAction, ToolbarControl } from './toolbars/registry';
import type { GroupDefinition, Item, Leaf } from './toolbars/model';
import { DEFAULT_VIEW } from './toolbars/model';
import { setSolverWasm, solveSketch } from './sketch/solver';
import { SKETCH_LINE_TYPES, sketchStatusInfo, type SketchLineType } from './sketch/sidepanel';
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';

setSolverWasm(wasmUrl);

const TOOLS: [SkTool, string, string][] = [
  ['select', 'select', t('Auswählen und ziehen (S)')],
  ['line', 'sketchLine', t('Linie (L)')],
  ['constr', 'sketchLine', t('Konstruktionslinie (K)')],
  ['polyline', 'line', t('Polylinie zeichnen')],
  ['rect', 'rect', t('Rechteck (R)')],
  ['centerRect', 'sketchCenterRect', t('Rechteck vom Mittelpunkt')],
  ['circle', 'sketchCircle', t('Kreis (C)')],
  ['ellipse', 'sketchCircle', t('Ellipse')],
  ['arc', 'arc', t('Bogen (A)')],
  ['point', 'startpoint', t('Punkt setzen')],
  ['slot', 'sketchSlot', t('Langloch')],
  ['roundRect', 'sketchRoundRect', t('Rundrechteck')],
  ['polygon', 'polygon', t('Polygon')],
  ['circleOffset', 'offset', t('Konturversatz')],
  ['dim', 'sketchDimension', t('Bemaßen (D)')],
];

const RELATION_ICONS: Record<(typeof CON_BUTTONS)[number], string> = {
  coincident: 'sketchCoincident', joinEnds: 'sketchJoin', horizontal: 'sketchHorizontal', vertical: 'sketchVertical',
  parallel: 'sketchParallel', collinear: 'sketchCollinear', perpendicular: 'sketchPerpendicular', equal: 'sketchEqual',
  tangent: 'sketchTangent', concentric: 'sketchConcentric', midpoint: 'sketchMidpoint', symmetric: 'sketchSymmetric', fixed: 'lock',
};

function sketchButton(icon: string, label: string, onclick: () => void, toggle = false) {
  return h('button', { type: 'button', class: 'ib sketch-icon', icon, title: label, 'aria-label': label, 'aria-pressed': toggle ? 'false' : undefined, onclick });
}

const KEYS: Partial<Record<string, string>> = {
  coincident: 'O', horizontal: 'H', vertical: 'V', parallel: 'P', perpendicular: 'N', equal: 'E', tangent: 'T', concentric: 'X', midpoint: 'M', symmetric: 'Y', fixed: 'F',
};

const SKETCH_BAR = 'sketch:bar';
const SKETCH_COMMANDS = 'sketch:commands';
const SKETCH_FORMS = 'sketch:forms';
const SKETCH_SIDE = 'sketch:side';
const SKETCH_SIDE_PANEL = 'sketch:side-panel';

/**
 * Probe-DOF für die Lage-frei-Erkennung (Seitenmenü-Status): Klon +
 * fixed-Bindung auf dem ersten Punkt + Solve. Fasst das Modell nie an;
 * null bei Fehlschlag (Löser nicht bereit, Geometriefehler) → Fallback-Text.
 * Der Aufrufer (sketchStatusInfo) ruft die Probe nur bei DOF 1..3 auf.
 */
function trialFixDof(sk: Sketch): number | null {
  try {
    const clone = cloneSketch(sk);
    const pt = clone.pts[0];
    if (!pt) return null;
    clone.cons.push({ id: clone.next++, t: 'fixed', r: [pt.id], x: pt.x, y: pt.y });
    const res = solveSketch(clone);
    return res.ok ? res.dof : null;
  } catch {
    return null;
  }
}

function sketchToolButton(ed: Editor, id: SkTool, icon: string, label: string) {
  return sketchButton(icon, label, () => {
    ed.setSketchTool(id);
    if (!ed.canvas.hasAttribute('tabindex')) ed.canvas.tabIndex = -1;
    if (!ed.sketchEdit?.valueEdit) ed.canvas.focus({ preventScroll: true });
  }, true);
}

const TOP_TOOLS = new Set<SkTool>(['dim']);

export function sketchForms(ed: Editor) {
  const actions: ToolbarAction[] = [], groups: GroupDefinition[] = [];
  const action = (key: string, icon: string, label: string, run: () => void, on?: () => boolean, enabled?: () => boolean): Leaf => {
    const id = `sketch:form:${key}`;
    const available = () => !!ed.sketchEdit && (enabled?.() ?? true);
    actions.push({ id, icon, label, on, enabled: available, run: () => { if (available()) run(); } });
    return { kind: 'action', id };
  };
  const mode = (id: SkTool, icon: string, label: string, enabled?: () => boolean) => action(id, icon, label, () => {
    ed.setSketchTool(id);
    if (!ed.canvas.hasAttribute('tabindex')) ed.canvas.tabIndex = -1;
    if (!ed.sketchEdit?.valueEdit) ed.canvas.focus({ preventScroll: true });
  }, () => ed.sketchEdit?.tool === id, enabled);
  /** Modus-Variante als eigener Werkzeug-Button: setzt Tool+Basis+Modus in einem Lauf (Single Source bleibt das Modus-Feld). */
  const variantDef = (def: SketchVariantDef) =>
    action(def.key, def.icon, def.label, () => {
      const s = ed.sketchEdit;
      if (!s) return;
      applySketchVariant(s, def.key);
      ed.setSketchTool(def.tool);
      if (!ed.canvas.hasAttribute('tabindex')) ed.canvas.tabIndex = -1;
      if (!ed.sketchEdit?.valueEdit) ed.canvas.focus({ preventScroll: true });
    }, () => !!ed.sketchEdit && isSketchVariantActive(ed.sketchEdit, def.key));
  const variantsOf = (group: SketchVariantGroup) => SKETCH_VARIANTS.filter((v) => v.group === group).map((v) => variantDef(v));
  const tools = new Map(TOOLS.filter(([id]) => !TOP_TOOLS.has(id)).map(([id, icon, label]) => [id, mode(id, icon, label)]));
  const tool = (id: SkTool) => tools.get(id)!;
  const entities = () => ed.sketchEdit?.sk.ents ?? [];
  const boundaryCount = () => entities().filter((e) => !e.trimSupport && e.t !== 'point').length;
  const visibleLine = () => entities().some((e) => e.t === 'line' && !e.aux);
  const canCorner = () => visibleLine() && entities().filter((e) => (e.t === 'line' || e.t === 'arc') && !e.aux).length >= 2;
  const hasSelection = () => !!ed.sketchEdit?.sel.size;
  const canDivide = () => {
    const s = ed.sketchEdit;
    return !!s && divideSelection(s.sk, s.sel) !== undefined;
  };
  const group = (key: string, label: string, ...items: Leaf[]): Item => {
    const id = `sketch:forms:${key}`;
    groups.push({ id, label, kind: 'flyout', items });
    return { kind: 'group', id };
  };
  const items: Item[] = [
    group('select', t('Auswahl'), tool('select'), action('frame', 'sketchFrame', t('Rahmenauswahl'), () => ed.startSketchFrameKeys())),
    { kind: 'separator' },
    tool('line'),
    // Eine Flyout-Gruppe statt Untergruppen (frei/achsig/Tangenten/Halbierende): GroupDefinition fasst nur Leaves, keine Verschachtelung.
    group('constr', t('Konstruktionslinie'), ...variantsOf('constr')),
    group('polyline', t('Polylinie'), tool('polyline'), action('polylineInput', 'sketchPolylineInput', t('Polylinie über Koordinaten'), () => sketchPolylineDialog(ed))),
    group('circle', t('Kreis'), ...variantsOf('circle'),
      tool('ellipse'), action('circleInput', 'sketchDiameter', t('Kreis mit Durchmesser'), () => centeredShapeDialog(ed, 'circle'))),
    group('rectangle', t('Rechteck'), ...variantsOf('rectangle'),
      tool('centerRect'), tool('roundRect'), action('rectInput', 'sketchCenterRectInput', t('Mittelpunkt-Rechteck über Koordinaten'), () => centeredShapeDialog(ed, 'rect'))),
    group('arc', t('Bogen'), ...variantsOf('arc')),
    tool('point'), tool('polygon'),
    group('slot', t('Langloch'), ...variantsOf('slot')),
    { kind: 'separator' },
    group('segments', t('Trimmen'),
      mode('trim', 'trim', t('Trimmen'), () => boundaryCount() >= 2 && entities().some((e) => (e.t === 'line' || e.t === 'arc') && !e.aux && !e.trimSupport)),
      mode('extend', 'sketchExtend', t('Verlängern'), () => boundaryCount() >= 2 && visibleLine()),
      mode('split', 'sketchSplit', t('Aufteilen'), () => entities().some((e) => (e.t === 'line' || e.t === 'arc') && !e.aux && !e.trimSupport))),
    action('divide', 'sketchSplit', t('In N gleiche Teile teilen'), () => void ed.sketchDivideSelected(), undefined, canDivide),
    group('corners', t('Abrunden'), mode('fillet', 'sketchFillet', t('Abrunden'), canCorner),
      mode('chamfer', 'sketchChamfer', t('Fasen'), canCorner)),
    group('pattern', t('Muster'),
      action('pattern:mirror', 'mirrorh', t('Spiegeln'), () => openPatternDialog(ed, 'mirror')),
      action('pattern:circular', 'sketchCircularPattern', t('Kreismuster'), () => openPatternDialog(ed, 'circular')),
      action('pattern:rectangular', 'sketchRectangularPattern', t('Rechteckmuster'), () => openPatternDialog(ed, 'rectangular'))),
    tool('circleOffset'),
    action('move', 'sketchMove', t('Präzise verschieben'), () => translateDialog(ed), undefined, hasSelection),
    mode('rotate', 'rotcw', t('Drehen'), hasSelection),
    mode('mirror', 'mirrorh', t('Spiegeln'), hasSelection),
    action('aux', 'sketchConstruction', t('Hilfsgeometrie ein/aus (G): wird nicht gelasert'), () => ed.sketchToggleAux(), undefined,
      () => entities().some((e) => ed.sketchEdit?.sel.has(e.id))),
    action('drawAux', 'sketchConstruction', t('Konstruktion zeichnen (G): neue Elemente als Hilfsgeometrie'), () => ed.sketchToggleDrawAux(),
      () => !!ed.sketchEdit?.drawAux),
    action('delete', 'delete', t('Auswahl löschen (Entf)'), () => ed.sketchDeleteSel(), undefined, hasSelection),
  ];
  return { actions, groups, items };
}

function sketchCommands(ed: Editor, context: ControlContext): ToolbarControl {
  const bar = h('div', { class: 'sketch-controls' });
  // Browser-Aktivierung von Schaltflächen nicht von den Arbeitsflächen-Kürzeln abfangen lassen.
  bar.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.code === 'Space')) e.stopPropagation();
  });
  const toolBtns = new Map<SkTool, HTMLButtonElement>();
  const conBtns = new Map<(typeof CON_BUTTONS)[number], HTMLButtonElement>();
  const cons = h('div', { class: 'sketch-direct', role: 'group', 'aria-label': t('Beziehungen') });
  const options = h('div', { class: 'sketch-options', role: 'group', 'aria-label': t('Werkzeugoptionen'), hidden: true });
  const numericAngle = h('button', { type: 'button', class: 'ib text', onclick: () => void ed.sketchNumericRotate() }, t('Winkel eingeben'));
  const mirrorAxis = h('button', { type: 'button', class: 'ib text', 'aria-pressed': 'false', onclick: () => {
    const s = ed.sketchEdit;
    if (s?.tool !== 'mirror') return;
    const enabled = !s.mirrorLineMode;
    ed.setSketchTool('mirror');
    s.mirrorLineMode = enabled;
    if (enabled) ed.hint = t('Klicke auf eine Linie als Spiegelachse.');
    ed.emit('tool');
    ed.canvas.focus({ preventScroll: true });
  } }, t('Linie als Spiegelachse'));
  options.append(numericAngle, mirrorAxis);
  for (const [id, icon, label] of TOOLS) {
    if (!TOP_TOOLS.has(id)) continue;
    const b = sketchToolButton(ed, id, icon, label);
    toolBtns.set(id, b);
    cons.append(b);
  }
  const polygonSides = h('select', { 'aria-label': t('Anzahl der Polygonseiten'), onchange: () => {
    if (!ed.sketchEdit || ed.sketchEdit.tool !== 'polygon') return;
    ed.sketchEdit.polygonSides = Number(polygonSides.value);
    ed.redraw();
  } }, ...Array.from({ length: MAX_SKETCH_POLYGON_SIDES - 2 }, (_, i) => h('option', { value: String(i + 3) }, String(i + 3))));
  const polygonField = h('label', { hidden: true }, t('Anzahl der Polygonseiten'), ' ', polygonSides);
  options.append(polygonField);
  const polygonModes = [['inscribed', t('Umkreis')], ['circumscribed', t('Inkreis')], ['edge', t('Kante (2 Punkte)')]] as const;
  const polygonMode = h('select', { 'aria-label': t('Polygonmodus'), onchange: () => {
    if (!ed.sketchEdit || ed.sketchEdit.tool !== 'polygon') return;
    ed.sketchEdit.polygonMode = polygonMode.value as SketchPolygonMode;
    ed.redraw();
  } }, ...polygonModes.map(([value, label]) => h('option', { value }, label)));
  const polygonModeField = h('label', { hidden: true }, t('Polygonmodus'), ' ', polygonMode);
  options.append(polygonModeField);
  const axisButtons = (['hdistance', 'vdistance'] as const).map((axis) => {
    const name = CON_LABELS[axis];
    const button = sketchButton(axis === 'hdistance' ? 'sketchDimensionX' : 'sketchDimensionY', name, () => pickAxisDimension(ed, axis));
    cons.append(button);
    return button;
  });
  for (const c of CON_BUTTONS) {
    const label = KEYS[c] ? `${CON_LABELS[c]} (${KEYS[c]})` : CON_LABELS[c];
    const b = sketchButton(RELATION_ICONS[c], label, () => {
      if (c === 'joinEnds') pickAxisDimension(ed, c);
      else ed.startSketchRelation(c);
    });
    conBtns.set(c, b);
    cons.append(b);
  }
  const editDim = sketchButton('sketchEditDimension', t('Maß bearbeiten'), () => editDimensionDialog(ed));
  const relations = sketchButton('sketchRelations', t('Beziehungen'), () => showRelations(ed));
  const status = h('span', { role: 'status' });
  const issueDetails = h('div', { class: 'sketch-entries' });
  let issueKey = '';
  const diagnostics = h('div', { class: 'sketch-entries' }, status,
    h('p', { class: 'note' }, t('Neutral: vollständig bestimmt. Blau: noch beweglich. Grau: nicht ausgewertet. Pfirsich-Marker: offenes Ende (markiert nur, ersetzt die Strichfarbe nicht). Rot: Widerspruch.')),
    issueDetails,
    sketchButton('sketchRelations', t('Beziehungen'), () => showRelations(ed)),
    sketchButton('sketchEditDimension', t('Maß bearbeiten'), () => editDimensionDialog(ed)));
  cons.prepend(relations, editDim);
  const done = h('button', { type: 'button', class: 'ib text sketch-session-action', onclick: () => ed.closeSketch() }, t('Fertig'));
  const cancel = h('button', { type: 'button', class: 'ib text sketch-session-action', title: t('Alle Änderungen seit dem Öffnen verwerfen'), onclick: () => ed.closeSketch(true) }, t('Abbrechen'));
  const menu = h('div', { class: 'toolbar-menu-list' });
  const popup = h('div', { class: 'toolbar-popup toolbar-menu sketch-popup', id: context.id('groups'), role: 'group', hidden: true }, menu);
  // Use the top layer so dock-zone overflow doesn't clip the commands; the
  // fixed-position fallback also works on older desktop WebViews.
  if (typeof popup.showPopover === 'function') popup.setAttribute('popover', 'manual');
  let anchor: HTMLButtonElement | undefined;
  const closePopup = (restore = false) => {
    if (!anchor) return;
    const previous = anchor;
    anchor = undefined;
    previous.setAttribute('aria-expanded', 'false');
    if (popup.hasAttribute('popover')) popup.hidePopover();
    popup.hidden = true;
    if (restore && previous.getClientRects().length) previous.focus({ preventScroll: true });
  };
  const groups = [
    { name: t('Solverstatus: Beziehungen und Maße'), icon: 'sketchRelations', body: diagnostics },
  ].map(({ name, icon, body }) => {
    const heading = h('h4', { id: context.id(icon) }, name);
    const section = h('section', { 'aria-labelledby': heading.id }, heading, body);
    for (const entry of body.querySelectorAll('button')) {
      entry.className = 'toolbar-menu-item';
      const icon = h('span', { class: 'menu-icon', 'aria-hidden': 'true' });
      icon.append(...entry.childNodes);
      entry.append(h('span', { class: 'menu-check', 'aria-hidden': 'true' }), icon, h('span', { class: 'menu-label' }, entry.getAttribute('aria-label')));
    }
    menu.append(section);
    return { name, icon, section };
  });
  const openPopup = (trigger: HTMLButtonElement, selected?: HTMLElement) => {
    if (!ed.sketchEdit || !context.isAvailable()) return;
    if (anchor === trigger && (!popup.hasAttribute('popover') || popup.matches(':popover-open'))) { closePopup(); return; }
    closePopup();
    anchor = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    popup.setAttribute('aria-label', trigger.getAttribute('aria-label') ?? trigger.textContent ?? '');
    for (const [i, { section }] of groups.entries()) section.hidden = selected ? section !== selected : i !== 0;
    popup.hidden = false;
    if (popup.hasAttribute('popover')) popup.showPopover();
    const rect = trigger.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const height = popup.offsetHeight;
    popup.style.left = `${Math.max(4, Math.min(rect.left, clientWidth - popup.offsetWidth - 4))}px`;
    popup.style.top = `${Math.max(4, Math.min(rect.bottom + 4 + height <= clientHeight ? rect.bottom + 4 : rect.top - height - 4, clientHeight - height - 4))}px`;
    (popup.querySelector<HTMLButtonElement>('section:not([hidden]) button:not(:disabled)') ?? popup).focus({ preventScroll: true });
  };
  popup.tabIndex = -1;
  const trigger = (label: string, section?: HTMLElement, icon?: string) => {
    const button = h('button', { type: 'button', class: 'ib text sketch-trigger', title: label, 'aria-label': label,
      'aria-expanded': 'false', 'aria-controls': popup.id, onclick: () => openPopup(button, section) },
    icon ? h('span', { icon, 'aria-hidden': 'true' }) : null, h('span', {}, label));
    return button;
  };
  const more = trigger(t('Mehr'));
  more.classList.add('sketch-more');
  const solverLabel = t('Solverstatus: Beziehungen und Maße');
  const solver = trigger(solverLabel, groups[0].section, 'sketchRelations');
  // Dauerhaft sichtbarer Bestimmungsstatus (Zahl = Solver-DOF), nicht im Popup versteckt.
  const stateLabel = h('span', { class: 'sketch-state', role: 'status' });
  solver.classList.add('sketch-solver');
  const badge = solver.lastElementChild!;
  badge.setAttribute('aria-hidden', 'true');
  const sessions = h('div', { class: 'sketch-sessions' }, done, cancel);
  bar.append(h('div', { class: 'sketch-row' }, h('div', { class: 'sketch-direct-scroll' }, cons), more, solver, stateLabel, sessions), options, popup);

  // Restore focus before opening a command dialog, which then owns its own focus.
  popup.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) closePopup(true); }, true);
  const dismiss = (e: PointerEvent) => {
    if (anchor && !popup.contains(e.target as Node) && !anchor.contains(e.target as Node)) closePopup();
  };
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anchor) { e.preventDefault(); e.stopPropagation(); closePopup(true); }
  });
  bar.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && !bar.contains(e.relatedTarget)) closePopup();
  });
  const onResize = () => closePopup(true);
  const onScroll = (e: Event) => { if (anchor && !popup.contains(e.target as Node)) closePopup(); };

  const refresh = () => {
    const s = ed.sketchEdit;
    if (!s || !context.isAvailable()) { closePopup(); return; }
    polygonField.hidden = s.tool !== 'polygon';
    polygonSides.value = String(s.polygonSides ?? 6);
    polygonModeField.hidden = s.tool !== 'polygon';
    polygonMode.value = s.polygonMode ?? 'inscribed';
    numericAngle.hidden = s.tool !== 'rotate';
    numericAngle.disabled = !s.draft.length;
    mirrorAxis.hidden = s.tool !== 'mirror';
    mirrorAxis.classList.toggle('on', !!s.mirrorLineMode);
    mirrorAxis.setAttribute('aria-pressed', String(!!s.mirrorLineMode));
    options.hidden = numericAngle.hidden && mirrorAxis.hidden && polygonField.hidden && polygonModeField.hidden;
    for (const [id, b] of toolBtns) {
      const pressed = s.tool === id;
      b.classList.toggle('on', pressed);
      b.setAttribute('aria-pressed', String(pressed));
      const tick = b.querySelector('.menu-check');
      if (tick) tick.textContent = pressed ? '✓' : '';
    }
    for (const [id, b] of conBtns) {
      b.disabled = id === 'joinEnds' ? new Set(sketchOpenEnds(s.sk).values()).size < 2 : !s.sk.pts.length;
      b.classList.toggle('on', s.relationPick?.type === id);
      if (id !== 'joinEnds') b.setAttribute('aria-pressed', String(s.relationPick?.type === id));
    }
    editDim.disabled = !s.sk.cons.some((c) => isDim(c.t));
    relations.disabled = !s.sk.cons.some((c) => !isDim(c.t));
    for (const b of axisButtons) b.disabled = s.sk.pts.length < 2;
    const st = s.status;
    const issues = sketchIssues(ed);
    const bad = issues.length > 0;
    const label = bad ? [...new Set(issues.map(({ kind }) => diagnosticTitle(kind)))].join(' · ')
      : !st ? '' : st.dof === 0 ? t('Voll bestimmt') : t('Freiheitsgrade: {n}', { n: st.dof });
    const byId = new Map(s.sk.cons.map((c) => [c.id, c]));
    const key = JSON.stringify([issues, issues.flatMap((issue) => issue.ids.map((id) => byId.get(id)))]);
    if (key !== issueKey) {
      issueKey = key;
      issueDetails.replaceChildren(...issues.map(({ kind, ids, message }) => {
        const entries = [...new Set(ids)].flatMap((id) => {
          const c = byId.get(id);
          return c ? [h('button', { type: 'button', class: 'toolbar-menu-item', onclick: () => jumpToCondition(ed, id) },
            h('span', { class: 'menu-label' }, conditionText(c)))] : [];
        });
        return h('div', { class: 'sketch-issue' }, h('strong', {}, diagnosticTitle(kind)), message ? h('span', {}, message) : null, ...entries);
      }));
    }
    if (status.textContent !== label) status.textContent = label;
    const stateText = !st ? '' : sketchStatusInfo(s.sk, st, s.startDof, () => trialFixDof(s.sk)).text;
    if (stateLabel.textContent !== stateText) stateLabel.textContent = stateText;
    solver.classList.toggle('bad', bad);
    badge.textContent = bad ? '!' : !st ? '' : String(st.dof);
    solver.title = label ? `${solverLabel} · ${label}` : solverLabel;
    solver.setAttribute('aria-label', solver.title);
  };
  return {
    mount(host) {
      host.append(bar);
      ed.canvas.addEventListener('pointerup', refresh);
      document.addEventListener('pointerdown', dismiss, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
    },
    update: refresh,
    activate() {},
    dispose() {
      closePopup();
      ed.canvas.removeEventListener('pointerup', refresh);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      bar.remove();
    },
  };
}

/** CAD-Seitenmenü der Skizze (2D): Name, Status, Linientyp, Anzeige, Fangen, Fertig/Abbrechen. */
function sketchSidePanel(ed: Editor, context: ControlContext): ToolbarControl {
  const panel = h('div', { class: 'sketch-side sketch-side-card' });
  panel.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.code === 'Space')) e.stopPropagation();
  });
  const bodyId = context.id('side-body');
  const head = h('div', { class: 'sketch-side-head' });
  const name = h('h3', { class: 'sketch-side-name' });
  const collapse = h('button', { type: 'button', class: 'ib sketch-side-collapse', title: t('Einklappen'),
    'aria-label': t('Einklappen'), 'aria-expanded': 'true', 'aria-controls': bodyId }, '▾') as HTMLButtonElement;
  head.append(name, collapse);
  const body = h('div', { class: 'sketch-side-body', id: bodyId });
  const statusText = h('p', { class: 'sketch-side-status', role: 'status' });
  const progress = h('progress', { class: 'sketch-side-progress', max: 1, value: 0, 'aria-label': t('Bestimmungsfortschritt') }) as HTMLProgressElement;
  const fit = h('button', { type: 'button', class: 'ib text', onclick: () => ed.sketchFitView() }, t('Skizze einpassen'));
  fit.title = t('Skizze einpassen');
  fit.setAttribute('aria-label', fit.title);
  const LINE_LABEL: Record<SketchLineType, string> = {
    normal: t('Normal'),
    construction: t('Konstruktion'),
    centerline: t('Mittellinie'),
    infinite: t('Unendlich'),
  };
  const LINE_ICON: Record<SketchLineType, string> = {
    normal: 'lineTypeNormal',
    construction: 'sketchConstruction',
    centerline: 'lineTypeCenterline',
    infinite: 'lineTypeInfinite',
  };
  const LINE_TITLE: Record<SketchLineType, string> = {
    normal: t('Normale Linien zeichnen bzw. Auswahl zurückwandeln'),
    construction: t('Konstruktion zeichnen (G): neue Elemente als Hilfsgeometrie'),
    centerline: t('Mittellinie zeichnen bzw. Auswahl wandeln: Strich-Punkt, kein Profil'),
    infinite: t('Unendliche Linie zeichnen bzw. Auswahl wandeln: verlängert dargestellt, kein Profil'),
  };
  const lineHint = h('p', { class: 'note', role: 'status' });
  const lineButtons = new Map<SketchLineType, HTMLButtonElement>();
  for (const type of SKETCH_LINE_TYPES) {
    const b = h('button', {
      type: 'button', class: 'ib text sketch-side-type', title: LINE_TITLE[type],
      'aria-label': LINE_TITLE[type], 'aria-pressed': 'false',
      onclick: () => {
        const s = ed.sketchEdit;
        if (s && (type === 'centerline' || type === 'infinite')) {
          const sel = [...s.sel].map((id) => entOf(s.sk, id)).filter((e) => !!e);
          const skipped = sel.filter((e) => e.t !== 'line').length;
          lineHint.textContent = skipped
            ? t('Mittellinie und Unendlich brauchen Linien: {n} übersprungen.', { n: skipped })
            : '';
        } else lineHint.textContent = '';
        ed.sketchApplyLineType(type);
        refresh();
      },
    }, h('span', { icon: LINE_ICON[type], 'aria-hidden': 'true' }), ' ', LINE_LABEL[type]) as HTMLButtonElement;
    lineButtons.set(type, b);
  }
  const segment = h('div', { class: 'sketch-side-segment', role: 'group', 'aria-label': t('Linientyp') }, ...SKETCH_LINE_TYPES.map((type) => lineButtons.get(type)!));
  const check = (label: string, get: () => boolean, set: (on: boolean) => void) => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = get();
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => { set(input.checked); ed.redraw(); refresh(); });
    const row = h('label', { class: 'check' }, input, ' ', label);
    return { row, input, get };
  };
  const displayChecks = [
    check(t('Beziehungen'), () => !!ed.sketchEdit && ed.sketchEdit.showRelations !== false, (on) => { if (ed.sketchEdit) ed.sketchEdit.showRelations = on; }),
    check(t('Bemaßungen'), () => !!ed.sketchEdit && ed.sketchEdit.showDims !== false, (on) => { if (ed.sketchEdit) ed.sketchEdit.showDims = on; }),
    check(t('Punkte'), () => !!ed.sketchEdit && ed.sketchEdit.showPoints !== false, (on) => { if (ed.sketchEdit) ed.sketchEdit.showPoints = on; }),
    // Ausgeblendete Konstruktionsgeometrie ist auch nicht fangbar (kein Kanten-/Mittenfang, keine Auswahl).
    check(t('Konstruktionsgeometrie'), () => !!ed.sketchEdit && ed.sketchEdit.showConstruction !== false, (on) => { if (ed.sketchEdit) ed.sketchEdit.showConstruction = on; }),
  ];
  const snapChecks = [
    check(t('Fangen in der Skizze'), () => !!ed.sketchEdit && ed.sketchEdit.sketchSnap !== false, (on) => { if (ed.sketchEdit) ed.sketchEdit.sketchSnap = on; }),
    check(t('Objektfang'), () => ed.snapObjects !== false, (on) => { ed.setSnap({ objects: on }); }),
    check(t('Rasterfang'), () => ed.snapGrid !== false, (on) => { ed.setSnap({ grid: on }); }),
  ];
  const group = (label: string, open: boolean, ...body: Node[]) => {
    const details = h('details', open ? { open: true } : {});
    details.append(h('summary', {}, label), ...body);
    return details;
  };
  // Fertig/Abbrechen: derselbe Pfad wie oben (ed.closeSketch), keine Duplikat-Logik.
  const done = h('button', { type: 'button', class: 'ib text sketch-session-action sketch-side-finish', onclick: () => ed.closeSketch() }, t('Fertig'));
  const cancel = h('button', { type: 'button', class: 'ib text sketch-session-action', title: t('Alle Änderungen seit dem Öffnen verwerfen'), onclick: () => ed.closeSketch(true) }, t('Abbrechen'));
  const actions = h('div', { class: 'sketch-side-row' }, cancel, fit);
  const displayGroup = group(t('Anzeige'), true, ...displayChecks.map((c) => c.row),
    h('p', { class: 'note' }, t('Nur Anzeige: Geometrie, Bestimmung und Ausgabe bleiben unverändert.')));
  const snapGroup = group(t('Fangen'), true, ...snapChecks.map((c) => c.row));
  const setCollapsed = (collapsed: boolean) => {
    body.hidden = collapsed;
    collapse.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? t('Aufklappen') : t('Einklappen');
    collapse.title = label;
    collapse.setAttribute('aria-label', label);
    collapse.textContent = collapsed ? '▸' : '▾';
  };
  collapse.addEventListener('click', () => setCollapsed(!body.hidden));
  body.append(statusText, progress, segment, lineHint, displayGroup, snapGroup, done, actions);
  panel.append(head, body);
  const refresh = () => {
    const s = ed.sketchEdit;
    if (!s || !context.isAvailable()) return;
    name.textContent = s.obj.name ?? t('Skizze');
    const info = sketchStatusInfo(s.sk, s.status, s.startDof, () => trialFixDof(s.sk));
    if (statusText.textContent !== info.text) statusText.textContent = info.text;
    progress.hidden = info.progress === null;
    if (info.progress !== null) progress.value = info.progress;
    const current: SketchLineType = s.drawAux ? 'construction' : s.drawLine;
    for (const [type, b] of lineButtons) {
      const pressed = type === current;
      b.classList.toggle('on', pressed);
      b.setAttribute('aria-pressed', String(pressed));
    }
    for (const c of [...displayChecks, ...snapChecks]) c.input.checked = c.get();
  };
  return {
    mount(host) { host.append(panel); },
    update: refresh,
    activate() {},
    dispose() { panel.remove(); },
  };
}

export function installSketchPanel(ed: Editor): ToolbarControlsBundle {
  ed.onSketchValue = async (title, current, unit, expr, options) => {
    // Inline-Wertbox zuerst (folgt dem Cursor), askValue-Dialog nur als Fallback
    const inline = await askValueInline(ed, title, current, unit, expr, options);
    if (inline === 'unavailable') return askValue(ed, title, current, unit, expr, options);
    return inline;
  };
  guardDimParams(ed);
  setPatternEditOpener(ed, (id) => openPatternEditDialog(ed, id));
  ed.onSketchTrimLosses = (losses, deleting) => new Promise((resolve) => {
    let approved = false;
    const dlg = h('dialog', { 'aria-labelledby': 'sk-trim-confirm' });
    dlg.append(h('h3', { id: 'sk-trim-confirm' }, deleting ? t('Skizze: Löschen') : t('Aufgelistete Maße und Beziehungen entfernen')),
      ...(deleting ? [h('p', {}, t('Beim Löschen der Auswahl gehen diese Maße und Beziehungen verloren:'))] : []),
      h('ul', { id: 'sk-trim-losses' }, ...losses.map((c) => h('li', {}, `${CON_LABELS[c.t]} #${c.id}${c.expr ? `: ${c.expr}` : c.v === undefined ? '' : `: ${dimensionNumber(c.v)}`}`))),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', autofocus: true, onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: () => { approved = true; dlg.close(); } }, deleting ? t('Löschen') : t('Aufgelistete Maße und Beziehungen entfernen'))));
    showDialog(dlg, () => resolve(approved));
  });
  ed.onSketchSplitInset = ({ source, contours }) => new Promise((resolve) => {
    let approved = false;
    const title = t('Geteilten Innenversatz übernehmen?');
    const count = tn('{n} neue Schnittkontur', '{n} neue Schnittkonturen', contours.length);
    const preview = h('canvas', { width: 320, height: 160, role: 'img', 'aria-label': count });
    const ctx = preview.getContext('2d');
    if (ctx) {
      const xs = source.map((p) => p.x), ys = source.map((p) => p.y);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
      const scale = Math.min(296 / width, 136 / height);
      ctx.translate((320 - width * scale) / 2, (160 - height * scale) / 2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-320, -160, 640, 320);
      for (const [i, path] of [source, ...contours].entries()) {
        ctx.beginPath();
        path.forEach((p, j) => { const x = (p.x - minX) * scale, y = (p.y - minY) * scale; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath();
        ctx.strokeStyle = i ? '#1f6fe0' : '#555';
        ctx.setLineDash(i ? [] : [4, 3]);
        ctx.lineWidth = i ? 2 : 1;
        ctx.stroke();
      }
    }
    const dlg = h('dialog', { 'aria-labelledby': 'sk-split-inset-title' });
    dlg.append(h('h3', { id: 'sk-split-inset-title' }, title), h('p', {}, count), preview,
      h('p', {}, t('Blau: neue Schnitte. Gestrichelt: Original. Das Original bleibt erhalten; die neuen Konturen sind nicht mit ihm verknüpft.')),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', autofocus: true, onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: () => { approved = true; dlg.close(); } }, t('Teilkonturen übernehmen'))));
    showDialog(dlg, () => resolve(approved));
  });
  const label = t('Skizze');
  const forms = sketchForms(ed);
  // Standardposition rechts als schwebende Karte; die vorhandene Dock-/Floating-Mechanik
  // (Ziehen, Tastatur, Pos1-Rücksetzung) bleibt erhalten, nur die Vorgabe ändert sich.
  const sideX = typeof window === 'undefined' ? 1200 : Math.max(0, window.innerWidth - 304);
  return {
    definitions: { bars: [{ id: SKETCH_BAR, label, items: [{ kind: 'control', id: SKETCH_COMMANDS }],
      layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'top', lane: 3, order: 0 } } },
    { id: SKETCH_FORMS, label: t('Skizzenformen'), items: forms.items, fixedItems: true,
      layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: 'left', lane: 1, order: 0 } } },
    { id: SKETCH_SIDE, label: t('Skizzen-Seitenmenü'), items: [{ kind: 'control', id: SKETCH_SIDE_PANEL }],
      layout: { ...DEFAULT_VIEW, placement: { kind: 'floating', x: sideX, y: 76 }, orientation: 'vertical' } }], groups: forms.groups },
    actions: forms.actions,
    controls: [{ id: SKETCH_COMMANDS, label, create: (context) => sketchCommands(ed, context) },
      { id: SKETCH_SIDE_PANEL, label: t('Skizzen-Seitenmenü'), create: (context) => sketchSidePanel(ed, context) }],
    contextual: new Map([[SKETCH_BAR, { className: 'sketch-bar sketch-edit-bar', visible: () => !!ed.sketchEdit, resetGripWithHome: true }],
      [SKETCH_FORMS, { className: 'sketch-bar sketch-form-bar', visible: () => !!ed.sketchEdit, resetGripWithHome: true }],
      [SKETCH_SIDE, { className: 'sketch-bar sketch-side-bar', visible: () => !!ed.sketchEdit, resetGripWithHome: true }]]),
    visibleInWorkspace: (id) => !ed.sketchEdit || id === SKETCH_BAR || id === SKETCH_FORMS || id === SKETCH_SIDE || id === 'status',
    dispose() { setPatternEditOpener(ed, null); },
  };
}

/** Bestätigungsdialog im Stil der bestehenden Skizzen-Dialoge (Abbrechen vs. ausführen). */
function confirmPatternDanger(title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    let approved = false;
    const dlg = h('dialog', { 'aria-labelledby': 'sk-pattern-danger' });
    dlg.append(h('h3', { id: 'sk-pattern-danger' }, title), h('p', {}, body),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', autofocus: true, onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: () => { approved = true; dlg.close(); } }, title)));
    showDialog(dlg, () => resolve(approved));
  });
}

export interface CadWindow { card: HTMLElement; head: HTMLElement; body: HTMLElement; close: () => void; }

/**
 * Schwebendes Standard-Fenster im Stil der Skizzen-Seitenkarte: Titel, Einklappen,
 * Schließen, Ziehen per Kopf. Rahmen für alle Fenster im CAD-Modus.
 */
export function openCadWindow(opts: { title: string; onClose: () => void; x?: number; y?: number }): CadWindow {
  const card = h('div', { class: 'sketch-side-card cad-window', role: 'dialog', 'aria-label': opts.title });
  if (opts.x !== undefined) card.style.left = `${opts.x}px`;
  else card.style.right = '320px';
  card.style.top = `${opts.y ?? 76}px`;
  const head = h('div', { class: 'sketch-side-head' });
  const name = h('h3', { class: 'sketch-side-name' }, opts.title);
  const bodyId = `cad-win-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const body = h('div', { class: 'sketch-side-body', id: bodyId });
  const collapse = h('button', {
    type: 'button', class: 'ib', title: t('Einklappen'), 'aria-label': t('Einklappen'),
    'aria-expanded': 'true', 'aria-controls': bodyId,
    onclick: () => {
      const hidden = body.hidden = !body.hidden;
      collapse.textContent = hidden ? '▸' : '▾';
      collapse.setAttribute('aria-expanded', String(!hidden));
    },
  }, '▾') as HTMLButtonElement;
  const closeBtn = h('button', {
    type: 'button', class: 'ib', title: t('Schließen'), 'aria-label': t('Schließen'),
    onclick: () => api.close(),
  }, '✕') as HTMLButtonElement;
  head.append(name, collapse, closeBtn);
  card.append(head, body);
  let closed = false;
  const api: CadWindow = {
    card, head, body,
    close: () => {
      if (closed) return;
      closed = true;
      opts.onClose();
      card.remove();
    },
  };
  // Ziehen per Kopf (nicht auf Knöpfen starten); Position in left/top überführen.
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const base = { x: rect.left, y: rect.top };
    const from = { x: e.clientX, y: e.clientY };
    try { head.setPointerCapture(e.pointerId); } catch { /* ohne Capture weiterziehen */ }
    const move = (ev: PointerEvent) => {
      const p = cadWindowMove(base, from, { x: ev.clientX, y: ev.clientY }, { w: window.innerWidth, h: window.innerHeight });
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
      card.style.right = 'auto';
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  return api;
}

/** Muster-Fenster (Phase 2): ein Gerüst, drei Konfigurationen. Nicht-modal — Canvas-Picks laufen weiter. */
function openPatternDialog(ed: Editor, kind: PatternToolKind, opts?: { editId?: string }) {
  const s = ed.sketchEdit;
  if (!s) return;
  const draft = opts?.editId ? ed.startPatternEditDraft(opts.editId) : ed.startPatternDraft(kind);
  if (!draft) return;
  // Edit-Modus: gleiche Belegung, Titel mit „(bearbeiten)“, Zahlen als gespeicherte Texte,
  // kein Übernehmen — OK läuft über updatePattern mit ID, dazu Auflösen/Entfernen.
  const isEdit = !!opts?.editId;
  // Rechtsklick-Pfad: Kontextmenü abfangen, solange der Entwurf offen ist (kein pointer.ts-Eingriff).
  const prevContext = ed.onCanvasContext;
  const wrapped = (e: MouseEvent) => {
    if (ed.sketchEdit?.patternDraft) ed.sketchPatternRight();
    else prevContext?.(e);
  };
  ed.onCanvasContext = wrapped;
  const title = (kind === 'mirror' ? t('Spiegeln') : kind === 'circular' ? t('Kreismuster') : t('Rechteckmuster')) + (isEdit ? ' (bearbeiten)' : '');
  const win = openCadWindow({ title, onClose: () => {
    // Rekursionssicher: cancelPatternDraft ruft patternClose genau einmal, zweite Runde kehrt sofort zurück.
    ed.cancelPatternDraft();
    setPatternDialogRefresh(ed, null);
    if (ed.onCanvasContext === wrapped) ed.onCanvasContext = prevContext;
  } });
  const card = win.card;
  const rows = h('div', { style: 'display:flex;flex-direction:column;gap:4px;margin:8px 0;' });
  const err = h('p', { class: 'note', role: 'alert', style: 'color:var(--danger,#b52626);max-width:300px;' });
  const fmtCoord = (v: number) => String(Math.round(v * 100) / 100);

  const describe = (spot: string): string => {
    const dd = ed.sketchEdit?.patternDraft;
    if (!dd) return '—';
    if (spot === 'entities') return dd.entities.length ? `${dd.entities.length} ${t('Elemente')}` : '—';
    if (spot === 'line') return dd.line === undefined ? '—' : `#${dd.line}`;
    if (spot === 'center') {
      if (dd.center !== undefined) return `#${dd.center}`;
      if (dd.freeCenter) return `${t('Freiraum')} (${fmtCoord(dd.freeCenter.x)}, ${fmtCoord(dd.freeCenter.y)})`;
      return '—';
    }
    if (spot === 'direction') return dd.direction === undefined ? t('Automatisch (Skizzen-X)') : `#${dd.direction}`;
    if (spot === 'direction2') return dd.direction2 === undefined ? t('Automatisch (senkrecht)') : `#${dd.direction2}`;
    return '—';
  };
  const rowBtns = new Map<string, HTMLButtonElement>();
  // Zahlfelder spiegeln Ziehen wider: refresh() schreibt den Entwurfstext zurück (außer im Fokus)
  // und setzt die Stepper-Maxima neu (Anzahl 2 folgt floor(500/Anzahl 1), mind. 1).
  const synced: Array<{ input: HTMLInputElement; get: (dd: PatternDraft) => string; step?: { min: number; max: (dd: PatternDraft) => number } }> = [];
  const makeRow = (spot: 'entities' | 'line' | 'center' | 'direction' | 'direction2', label: string) => {
    const value = h('span', {}, '—');
    const b = h('button', {
      type: 'button', class: 'ib text', 'aria-pressed': 'false',
      style: 'display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;',
      onclick: () => {
        const dd = ed.sketchEdit?.patternDraft;
        if (!dd) return;
        // Erneuter Klick auf die belegte aktive Zeile löst sie (Spiegellinie abwählbar).
        if (dd.active === spot && spot !== 'entities' && patternSingleOf(dd, spot) !== undefined) {
          clearPatternSingle(dd, spot);
          dd.error = '';
          refresh();
          ed.redraw();
          return;
        }
        dd.active = spot;
        dd.error = '';
        refresh();
        ed.redraw();
      },
    }, h('span', {}, label), value) as HTMLButtonElement;
    rowBtns.set(spot, b);
    return b;
  };
  const numField = (label: string, get: (dd: PatternDraft) => string, set: (dd: PatternDraft, v: string) => void, step?: { min: number; max: (dd: PatternDraft) => number }) => {
    const input = h('input', {
      type: 'text', inputmode: 'decimal', value: get(draft), 'aria-label': label,
      style: 'width:90px;margin-left:8px;',
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const dd = ed.sketchEdit?.patternDraft;
      if (!dd || !ed.sketchEdit) return;
      set(dd, input.value);
      const checked = validatePatternDraft(ed.sketchEdit.sk, dd, patternParamResolver(ed.doc.params));
      dd.error = 'error' in checked ? checked.error : '';
      refresh();
      ed.redraw();
    });
    synced.push({ input, get, step });
    const row = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0;' },
      h('span', {}, label), h('span', {}, input));
    if (step) {
      const bump = (dir: 1 | -1) => {
        const dd = ed.sketchEdit?.patternDraft;
        if (!dd) return;
        const cur = Number.parseInt(input.value.trim(), 10);
        const next = Math.max(step.min, Math.min(step.max(dd), (Number.isFinite(cur) ? cur : step.min) + dir));
        input.value = String(next);
        set(dd, input.value);
        refresh();
        ed.redraw();
      };
      const minus = h('button', { type: 'button', class: 'ib', 'aria-label': '−', onclick: () => bump(-1) }, '−');
      const plus = h('button', { type: 'button', class: 'ib', 'aria-label': '+', onclick: () => bump(1) }, '+');
      row.lastElementChild?.append(minus, plus);
    }
    return row;
  };
  const toggle = (label: string, get: (dd: PatternDraft) => boolean, set: (dd: PatternDraft, on: boolean) => void) => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = get(draft);
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      const dd = ed.sketchEdit?.patternDraft;
      if (!dd) return;
      set(dd, input.checked);
      dd.error = '';
      refresh();
      ed.redraw();
    });
    return h('label', { class: 'check', style: 'display:flex;gap:6px;align-items:center;margin:2px 0;' }, input, ' ', label);
  };
  // Konfiguration je Werkzeug (ein Gerüst, drei Inhalte).
  rows.append(makeRow('entities', t('Elemente')));
  if (kind === 'mirror') rows.append(makeRow('line', t('Spiegellinie')));
  if (kind === 'circular') rows.append(makeRow('center', t('Mittelpunkt')));
  if (kind === 'rectangular') {
    rows.append(makeRow('direction', t('Richtung')), makeRow('direction2', t('Richtung 2')));
  }
  const numbers = h('div', {});
  if (kind === 'circular') {
    numbers.append(
      numField(t('Anzahl'), (dd) => dd.countText, (dd, v) => { dd.countText = v; }, { min: 2, max: () => 500 }),
      numField(t('Gesamtwinkel (°)'), (dd) => dd.angleText, (dd, v) => { dd.angleText = v; }),
      toggle(t('Richtung umkehren'), (dd) => dd.reversed, (dd, on) => { dd.reversed = on; }),
      toggle(t('Zentrieren'), (dd) => dd.centered, (dd, on) => { dd.centered = on; }));
  }
  if (kind === 'rectangular') {
    numbers.append(
      numField(t('Anzahl'), (dd) => dd.countText, (dd, v) => { dd.countText = v; }, { min: 1, max: () => 500 }),
      numField(t('Abstand (mm)'), (dd) => dd.spacingText, (dd, v) => { dd.spacingText = v; }),
      toggle(t('Richtung umkehren'), (dd) => dd.reversed, (dd, on) => { dd.reversed = on; }),
      toggle(t('Zentrieren'), (dd) => dd.centered, (dd, on) => { dd.centered = on; }),
      numField(t('Anzahl Richtung 2'), (dd) => dd.count2Text, (dd, v) => { dd.count2Text = v; }, { min: 1, max: (dd) => patternCount2Max(dd.countText) }),
      numField(t('Abstand Richtung 2 (mm)'), (dd) => dd.spacing2Text, (dd, v) => { dd.spacing2Text = v; }),
      toggle(t('Richtung 2 umkehren'), (dd) => dd.reversed2, (dd, on) => { dd.reversed2 = on; }),
      toggle(t('Richtung 2 zentrieren'), (dd) => dd.centered2, (dd, on) => { dd.centered2 = on; }));
  }
  const danger = (label: string, body: string, run: () => void) =>
    h('button', {
      type: 'button', class: 'btn', onclick: () => {
        void confirmPatternDanger(label, body).then((ok) => { if (ok) run(); });
      },
    }, label);
  const buttons = h('div', { class: 'dialog-buttons', style: 'display:flex;gap:8px;margin-top:8px;' },
    h('button', { type: 'button', class: 'btn primary', onclick: () => { if (isEdit) ed.confirmPatternEdit(); else ed.confirmPatternDraft(); } }, t('OK')),
    ...(isEdit
      ? [danger(t('Auflösen'), t('Die Verknüpfung wird gelöscht, die Geometrie bleibt stehen.'), () => ed.dissolvePatternDraft()),
        danger(t('Entfernen'), t('Die Kopien werden gelöscht, die Quellen bleiben stehen.'), () => ed.removePatternDraftCopies())]
      : [h('button', { type: 'button', class: 'btn', onclick: () => ed.applyPatternDraft() }, t('Übernehmen'))]),
    h('button', { type: 'button', class: 'btn', onclick: () => ed.cancelPatternDraft() }, t('Abbrechen')));
  card.append(rows, numbers,
    h('p', { class: 'note', style: 'max-width:300px;' },
      t('Anzahlen schließen das Original ein. Zentrieren balanciert die Kopien; Umkehren wählt bei geraden Anzahlen die Extraseite.')),
    err, buttons);
  // Eigene Tastenhoheit wie showModal-Dialoge: Editor-Kürzel bleiben draußen, Enter = OK, Escape = Abbrechen.
  card.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); ed.confirmPatternOK(); }
    else if (e.key === 'Escape') { e.preventDefault(); ed.cancelPatternDraft(); }
  });
  const refresh = () => {
    const dd = ed.sketchEdit?.patternDraft;
    if (!dd) return;
    for (const [spot, b] of rowBtns) {
      const on = dd.active === spot;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      const value = b.lastElementChild;
      if (value) value.textContent = describe(spot);
    }
    for (const { input, get, step } of synced) {
      const v = get(dd);
      if (input !== document.activeElement && input.value !== v) input.value = v;
      if (step) {
        input.min = String(step.min);
        input.max = String(step.max(dd));
      }
    }
    if (err.textContent !== dd.error) err.textContent = dd.error;
  };
  ed.sketchEdit!.patternClose = win.close;
  setPatternDialogRefresh(ed, refresh);
  document.body.append(card);
  refresh();
}

/** Edit-Fenster für ein Muster (Phase 4): gleiches Gerüst, vorbelegt mit Muster-ID. */
export function openPatternEditDialog(ed: Editor, patternId: string) {
  const s = ed.sketchEdit;
  if (!s) return;
  const pattern = (s.sk.patterns ?? []).find((p) => p.id === patternId);
  if (!pattern) return;
  openPatternDialog(ed, pattern.kind.type === 'circular' ? 'circular' : 'rectangular', { editId: patternId });
}

function translateDialog(ed: Editor) {
  ed.syncSketch();
  const active = ed.sketchEdit;
  if (!active) return;
  const selection = new Set(active.sel);
  const title = t('Präzise verschieben');
  const scope = sketchTransformScope(active.sk, selection);
  const source = sketchJson(active.sk), position = ed.history.position;
  const validSelection = 'ids' in scope;
  const dlg = h('dialog', { class: 'offset-dialog', 'aria-labelledby': 'sk-translate-title' });
  const fields = [t('ΔX (mm)'), t('ΔY (mm)')];
  const inputs = fields.map((label, i) => h('input', { id: `sk-delta-${i}`, 'aria-label': label, type: 'text', inputmode: 'decimal', value: '0', disabled: !validSelection }));
  const subs = validSelection ? sketchSubs({ ...active.sk, ents: active.sk.ents.filter((item) => selection.has(item.id)) }) : [];
  for (const input of inputs) input.addEventListener('input', () => {
    const [x, y] = inputs.map((field) => evalExpr(field.value.trim()));
    active.translationPreview = x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) && (x || y) ? { subs, delta: { x, y } } : undefined;
    ed.redraw();
  });
  const blocked = 'blocking' in scope ? active.sk.cons.filter((c) => scope.blocking.includes(c.id)) : [];
  const err = h('div', { class: 'note', role: 'alert' }, 'blocking' in scope ? ed.sketchTransformMessage(scope) : '',
    blocked.length ? h('ul', {}, ...blocked.map((c) => h('li', {}, conditionText(c)))) : null);
  const form = h('form', { onsubmit: (e: Event) => {
    e.preventDefault();
    ed.syncSketch();
    if (ed.sketchEdit !== active || ed.history.position !== position || sketchJson(active.sk) !== source ||
      active.sel.size !== selection.size || [...selection].some((id) => !active.sel.has(id))) { dlg.close(); return; }
    if ('blocking' in scope) return;
    const [x, y] = inputs.map((input) => evalExpr(input.value.trim()));
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      err.textContent = t('Gib eine gültige Koordinate ein.');
      return;
    }
    if (x === 0 && y === 0) { dlg.close(); return; }
    if (ed.sketchChange(title, (sk) => translateSketchSelection(sk, selection, { x, y }), { preservePlacement: scope.driven })) dlg.close();
    else {
      const ids = new Set(active.rejectedDiagnostics?.flatMap((issue) => issue.ids));
      const reasons = active.sk.cons.filter((c) => ids.has(c.id));
      err.replaceChildren(ed.hint, ...(reasons.length ? [h('ul', {}, ...reasons.map((c) => h('li', {}, conditionText(c))))] : []));
    }
  } }, h('div', { class: 'form' }, ...fields.flatMap((label, i) => [h('label', { for: inputs[i].id }, label), inputs[i]])), err,
  h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
    h('button', { class: 'btn primary', type: 'submit', disabled: !validSelection }, title)));
  dlg.append(h('h3', { id: 'sk-translate-title' }, title), form);
  showDialog(dlg, () => { active.translationPreview = undefined; ed.redraw(); });
  if (validSelection) inputs[0].select();
}

function centeredShapeDialog(ed: Editor, shape: 'rect' | 'circle') {
  const active = ed.sketchEdit;
  if (!active) return;
  const circle = shape === 'circle';
  const title = circle ? t('Kreis mit Durchmesser') : t('Rechteck vom Mittelpunkt');
  const id = circle ? 'sk-circle' : 'sk-rect';
  const fields = [
    [t('Mittelpunkt X (mm)'), '0'], [t('Mittelpunkt Y (mm)'), '0'],
    ...(circle ? [[t('Durchmesser (mm)'), '']] : [[t('Breite (mm)'), ''], [t('Höhe (mm)'), '']]),
  ];
  const inputs = fields.map(([, value], i) => h('input', { id: `${id}-${i}`, type: 'text', inputmode: circle && i === 2 ? 'text' : 'decimal', value, 'aria-describedby': `${id}-error` }));
  const err = h('div', { class: 'note', id: `${id}-error`, role: 'alert' });
  const dlg = h('dialog', { class: 'offset-dialog', 'aria-labelledby': `${id}-title` });
  const form = h('form', { onsubmit: (e: Event) => {
    e.preventDefault();
    if (ed.sketchEdit !== active) { dlg.close(); return; }
    const values = inputs.map((input) => evalExpr(input.value.trim()));
    let expr: string | undefined;
    if (circle && values[2] === null) {
      try {
        const source = inputs[2].value.trim();
        const value = evaluate(source, scopeOf(ed.paramList()));
        if (typeof value === 'number') { values[2] = value; expr = source; }
      } catch { /* Die ungültige Formel wird am Feld gemeldet. */ }
    }
    inputs.forEach((input) => input.removeAttribute('aria-invalid'));
    const invalid = values.findIndex((v, i) => v === null || !Number.isFinite(v) || (i >= 2 && v < MIN_SKETCH_RECTANGLE_SIZE));
    if (invalid >= 0) {
      err.textContent = invalid < 2 ? t('Gib eine gültige Koordinate ein.')
        : circle && (values[2] === null || !Number.isFinite(values[2])) ? t('Gib einen Durchmesser oder eine Formel mit einem gültigen Zahlenwert ein.')
        : t('Gib ein Maß von mindestens 0,000001 mm ein.');
      inputs[invalid].setAttribute('aria-invalid', 'true');
      inputs[invalid].focus();
      return;
    }
    const [x, y, width, height] = values as number[];
    const center = { x, y };
    const axis = circle
      ? [{ x, y: 0 }, { x: 0, y }].findIndex((p) => !validCircleDiameter(p, width))
      : [centeredRectangleSpan(x, width), centeredRectangleSpan(y, height)].indexOf(null);
    if (axis >= 0) {
      err.textContent = t('Für dieses Maß liegt der Mittelpunkt zu weit vom Ursprung. Ändere die Koordinate oder das Maß.');
      inputs[axis].setAttribute('aria-invalid', 'true');
      inputs[circle ? 2 : axis + 2].setAttribute('aria-invalid', 'true');
      inputs[axis].focus();
      return;
    }
    const created = circle
      ? ed.sketchChange(t('Skizze: Kreis'), (sk) => addDimensionedCircle(sk, center, { v: width, expr }))
      : ed.sketchChange(t('Skizze: Rechteck'), (sk) => addCenteredRectangle(sk, center, width, height));
    if (created) dlg.close();
    else err.textContent = circle ? t('Der Kreis konnte nicht erstellt werden. Prüfe Mittelpunkt und Durchmesser.')
      : t('Das Rechteck konnte nicht erstellt werden. Prüfe Mittelpunkt und Abmessungen.');
  } },
  h('div', { class: 'note' }, t('Die Koordinaten beziehen sich auf die Skizze.')),
  circle ? h('div', { class: 'note' }, t('Zahl, Rechnung (z. B. 40/2) oder Formel mit Projekt-Parametern (z. B. Breite - 2*Dicke).')) : null,
  h('div', { class: 'form' }, ...fields.flatMap(([label], i) => [h('label', { for: inputs[i].id }, label), inputs[i]])), err,
  h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
    h('button', { class: 'btn primary', type: 'submit' }, circle ? t('Kreis erstellen') : t('Rechteck erstellen'))));
  dlg.append(h('h3', { id: `${id}-title` }, title), form);
  showDialog(dlg);
  inputs[0].select();
}

function pickAxisDimension(ed: Editor, axis: 'hdistance' | 'vdistance' | 'joinEnds') {
  const s = ed.sketchEdit;
  if (!s || s.sk.pts.length < 2) return;
  const selected = [...s.sel].filter((id) => s.sk.pts.some((p) => p.id === id));
  const apply = (points: number[]) => {
    if (axis === 'joinEnds') ed.sketchConstrain(axis, points);
    else void ed.addSketchDim(axis, points);
  };
  if (s.sel.size === 2 && selected.length === 2 && (axis !== 'joinEnds' || conFromSel(s.sk, selected, axis))) {
    apply(selected);
    return;
  }
  const title = CON_LABELS[axis];
  const ends = axis === 'joinEnds' ? sketchOpenEnds(s.sk) : undefined;
  const makeSelect = (id: string) => h('select', { id, 'aria-describedby': 'sk-axis-error' }, ...s.sk.pts.filter((p) => !ends || ends.has(p.id)).map((p) =>
    h('option', { value: String(p.id) }, `#${p.id} · X ${dimensionNumber(p.x)} · Y ${dimensionNumber(p.y)}`)));
  const first = makeSelect('sk-axis-first'), second = makeSelect('sk-axis-second');
  if (selected.length) first.value = String(selected[0]);
  if (ends) second.value = String([...ends].find(([, owner]) => owner !== ends.get(Number(first.value)))?.[0]);
  else second.selectedIndex = first.selectedIndex === 0 ? 1 : 0;
  const err = h('div', { id: 'sk-axis-error', class: 'note', role: 'alert' });
  const clearError = () => {
    err.textContent = '';
    second.removeAttribute('aria-invalid');
  };
  first.addEventListener('change', clearError);
  second.addEventListener('change', clearError);
  const dlg = h('dialog', { 'aria-labelledby': 'sk-axis-title' });
  let points: number[] | undefined;
  dlg.append(h('h3', { id: 'sk-axis-title' }, title), h('form', { onsubmit: (e: Event) => {
    e.preventDefault();
    if (first.value === second.value) {
      err.textContent = t('Wähle zwei verschiedene Skizzenpunkte.');
      second.setAttribute('aria-invalid', 'true');
      second.focus();
      return;
    }
    const pair = [Number(first.value), Number(second.value)];
    if (axis === 'joinEnds' && !conFromSel(s.sk, pair, axis)) {
      err.textContent = t('Wähle zwei noch offene Endpunkte verschiedener Segmente.');
      second.setAttribute('aria-invalid', 'true');
      second.focus();
      return;
    }
    points = pair;
    dlg.close();
  } }, h('div', { class: 'form' }, h('label', { for: first.id }, t('Erster Punkt')), first,
    h('label', { for: second.id }, t('Zweiter Punkt')), second), err,
  h('div', { class: 'dialog-buttons' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
    h('button', { type: 'submit', class: 'btn primary' }, axis === 'joinEnds' ? t('Verbinden') : t('Maß eingeben')))));
  showDialog(dlg, () => { if (points && ed.sketchEdit === s) apply(points); });
  first.focus();
}

function showRelations(ed: Editor, target?: number) {
  const active = ed.sketchEdit;
  if (!active) return;
  const relations = active.sk.cons.filter((c) => !isDim(c.t));
  if (!relations.length) return;
  const refs = new Set(active.sel);
  for (const ent of active.sk.ents) if (active.sel.has(ent.id)) for (const p of entPoints(ent)) refs.add(p);
  const related = relations.filter((c) => refs.has(c.id) || c.r.some((id) => refs.has(id)));
  const issues = activeIssues(ed);
  const limit = h('input', { type: 'checkbox', checked: target === undefined && !!related.length && !relations.some((c) => issues.has(c.id)), disabled: !related.length });
  const list = h('select', { id: 'sk-rel-list' });
  const refresh = () => {
    const current = list.value;
    list.replaceChildren(...(limit.checked ? related : relations).map((c) =>
      h('option', { value: String(c.id) }, `${CON_LABELS[c.t]} #${c.id} · ${c.r.map((r) => `#${r}`).join(', ')}`)));
    if ([...list.options].some((option) => option.value === current)) list.value = current;
  };
  limit.addEventListener('change', refresh);
  refresh();
  const flagged = relations.find((c) => issues.has(c.id));
  if (target !== undefined || flagged) list.value = String(target ?? flagged!.id);
  const dlg = h('dialog', { 'aria-labelledby': 'sk-rel-title' });
  const apply = (remove: boolean) => {
    if (ed.sketchEdit !== active) { dlg.close(); return; }
    const id = Number(list.value);
    ed.syncSketch();
    if (ed.sketchEdit !== active || !active.sk.cons.some((c) => c.id === id && !isDim(c.t))) { dlg.close(); return; }
    if (remove) {
      if (ed.sketchChange(t('Beziehung löschen'), (sk) => {
        const i = sk.cons.findIndex((c) => c.id === id && !isDim(c.t));
        if (i < 0) return false;
        sk.cons.splice(i, 1);
      }, { keepOnFail: true, approvedLosses: new Set([id]) })) active.sel.delete(id);
    } else {
      active.sel.clear();
      active.sel.add(id);
    }
    ed.emit('sel');
    ed.redraw();
    dlg.close();
  };
  dlg.append(h('h3', { id: 'sk-rel-title' }, t('Beziehungen')),
    h('form', { onsubmit: (e: Event) => { e.preventDefault(); apply(false); } },
      h('label', {}, limit, ' ', t('Nur Beziehungen der Auswahl')),
      h('div', { class: 'form' }, h('label', { for: list.id }, t('Beziehung')), list),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn', type: 'button', onclick: () => apply(true) }, t('Beziehung löschen')),
        h('button', { class: 'btn primary', type: 'submit' }, t('Anzeigen')))));
  showDialog(dlg);
  list.focus();
}

function sketchIssues(ed: Editor) {
  const s = ed.sketchEdit;
  const issues = [...(s?.rejectedDiagnostics ?? []), ...solveDiagnostics(s?.status)];
  const keys = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([issue.kind, issue.ids, issue.message]);
    return !keys.has(key) && !!keys.add(key);
  });
}

function activeIssues(ed: Editor) {
  return new Set(sketchIssues(ed).flatMap((issue) => issue.ids));
}

function conditionText(c: SkCon) {
  return `${CON_LABELS[c.t]} #${c.id}${c.expr ? `: ${c.expr}` : c.v === undefined ? '' : `: ${dimensionNumber(c.v)}`}`;
}

function jumpToCondition(ed: Editor, id: number) {
  ed.syncSketch();
  const s = ed.sketchEdit, c = s?.sk.cons.find((item) => item.id === id);
  if (!s || !c) return;
  s.sel = new Set([id]);
  ed.emit('sel');
  ed.redraw();
  if (isDim(c.t)) void ed.editSketchDim(id);
  else showRelations(ed, id);
}

function editDimensionDialog(ed: Editor) {
  const active = ed.sketchEdit;
  if (!active) return;
  const dims = active.sk.cons.filter((c) => isDim(c.t));
  if (!dims.length) return;
  const slots = sketchSlots(active.sk);
  const mm = (n: number) => `${dimensionNumber(n)} mm`;
  const summary = h('p', { role: 'status' });
  const select = h('select', { id: 'sk-edit-dim' }, ...dims.map((c) => {
    const value = c.v ?? measureCon(active.sk, c);
    const kind = sketchDimensionTitle(c, slots);
    const axis = c.t === 'distance' && c.r.length === 1 && active.sk.cons.find((rel) =>
      (rel.t === 'horizontal' || rel.t === 'vertical') && rel.r.length === 1 && rel.r[0] === c.r[0]);
    const direction = axis ? ` · ${CON_LABELS[axis.t]}` : '';
    const label = `${kind}${direction} #${c.id}${value == null ? '' : `: ${dimensionNumber(value)} ${c.t === 'angle' ? '°' : 'mm'}`}${c.driven ? ` · ${t('Referenz (nur lesend)')}` : ''}`;
    return h('option', { value: String(c.id) }, label);
  }));
  const issues = activeIssues(ed);
  const selected = dims.find((c) => active.sel.has(c.id)) ?? dims.find((c) => issues.has(c.id));
  if (selected) select.value = String(selected.id);
  const updateSummary = () => {
    const id = Number(select.value), slot = slots.find((s) => s.width.id === id || s.distance?.id === id);
    summary.textContent = slot ? t('Breite: {width} · Mittelpunktsabstand: {distance} · Gesamtlänge: {total} (berechnet)',
      { width: mm(slot.breadth), distance: mm(slot.centerDistance), total: mm(slot.total) }) : '';
    summary.hidden = !slot;
  };
  select.addEventListener('change', updateSummary);
  updateSummary();
  let chosen: number | null = null;
  const dlg = h('dialog', { class: 'offset-dialog', 'aria-labelledby': 'sk-edit-dim-title' });
  dlg.append(h('form', { onsubmit: (e: Event) => { e.preventDefault(); chosen = Number(select.value); dlg.close(); } },
    h('h3', { id: 'sk-edit-dim-title' }, t('Maß bearbeiten')),
    h('div', { class: 'form' }, h('label', { for: select.id }, t('Maß')), select), summary,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', type: 'submit' }, t('Maß bearbeiten')))));
  showDialog(dlg, () => { if (chosen !== null && ed.sketchEdit === active) void ed.editSketchDim(chosen); });
  select.focus();
}

/** Wert einer Bemaßung erfragen: Zahl (mit Rechnung, z. B. 30/2), Formel mit Projekt-Parametern oder `name = wert` */
function askValue(ed: Editor, title: string, current: number, unit: string, expr?: string, options: DimensionInputOptions = {}): Promise<DimensionValue | null> {
  return new Promise((resolve) => {
    let result: DimensionValue | null = null;
    let edited = false;
    const val = h('input', { type: 'text', id: 'sk-val', value: expr ?? dimensionNumber(current), style: 'width: 160px', list: 'sk-dim-params-fallback' }) as HTMLInputElement;
    val.addEventListener('input', () => { edited = true; });
    const params = h('datalist', { id: 'sk-dim-params-fallback' }, ...ed.paramList().map((p) => h('option', { value: p.name })));
    const err = h('div', { class: 'note' });
    const ok = () => {
      const r = edited ? readDimField(ed, val.value, unit) : { v: current, expr, pendingParam: undefined };
      if ('error' in r) {
        err.textContent = r.error;
        return;
      }
      const { pendingParam, ...ans } = r;
      if (pendingParam && !options.signal) materializeDimParam(ed, pendingParam);
      result = { ...ans, ...(options.signal && pendingParam ? { pendingParam } : {}) };
      dlg.close();
    };
    val.onkeydown = (e) => {
      if (e.key === 'Enter') ok();
    };
    const dlg = h(
      'dialog',
      { class: 'offset-dialog' },
      h('h3', {}, title),
      h('div', { class: 'form' }, h('label', { for: 'sk-val' }, unit === '°' ? t('Winkel (°)') : t('Wert (mm)')), val, params),
      h('div', { class: 'note' }, t('Zahl, Rechnung (z. B. 40/2), Formel mit Projekt-Parametern (z. B. Breite - 2*Dicke) oder „name = wert“ für einen neuen Parameter.')),
      err,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: ok }, t('Übernehmen'))),
    );
    dlg.addEventListener('close', () => {
      options.signal?.removeEventListener('abort', abort);
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dlg);
    const abort = () => { result = null; dlg.close(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    dlg.showModal();
    if (options.signal?.aborted) abort();
    // Der Dialog öffnet beim Klick auf die Arbeitsfläche; der folgende mousedown nimmt sonst den Fokus wieder weg
    val.select();
    setTimeout(() => val.select(), 0);
  });
}
