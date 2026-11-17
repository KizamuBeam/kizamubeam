// Anpassbare Funktionsleisten: Hauptleiste oben und Werkzeugleiste links bestehen aus Aktionen, deren
// Auswahl und Reihenfolge der Nutzer festlegt (Fenster → Funktionsleisten anpassen … oder Rechtsklick auf
// eine Leiste). Außerdem lassen sich alle Leisten (auch Eigenschaften, Palette, Statusleiste) ausblenden.
// Gespeichert wird je Nutzer im localStorage („kizamubeam.toolbars“).
import { h } from './dom';
import { t } from './i18n';
import { SEP, upgradeLegacyConfig } from './toolbars/legacy';
import { initToolbarFramework } from './toolbars/system';
import type { ToolbarSystem } from './toolbars/system';
import { DEFAULT_ICON_SIZE, DEFAULT_VIEW, clone, ownEntry, setEntry } from './toolbars/model';
import type { BarDefinition, Definitions, IconSize, Item, ViewLayout } from './toolbars/model';
import { decode, encode } from './toolbars/migration';
import { TOOLBAR_STORAGE_KEY } from './toolbars/runtime';
import { validView } from './toolbars/state';
import type { ControlDefinition } from './toolbars/registry';
export { initToolbarFramework } from './toolbars/system';
export { SEP, upgradeBar } from './toolbars/legacy';

export interface Action {
  id: string;
  /** Rubrik im Anpassen-Dialog */
  cat: string;
  /** Name in Listen und Tooltip (mit Tastenkürzel) */
  label: string;
  /** Symbol aus icons.ts; ohne Symbol zeigt die Leiste den Kurztext */
  icon?: string;
  short?: string;
  run: () => void;
  enabled?: () => boolean;
  /** Knopf als eingeschaltet zeigen (aktives Werkzeug) */
  on?: () => boolean;
  /** Symbol und Tooltip, die sich zur Laufzeit ändern */
  dyn?: () => { icon?: string; label?: string };
  /** Kleiner Knopf (Optionen zu einem Nachbarn) */
  small?: boolean;
  /** Knopfgruppe: zeigt die zuletzt benutzte Aktion, der Pfeil daneben klappt die übrigen auf.
   *  Kleine Aktionen (Optionen) erscheinen nur in der Liste und werden nicht zur gezeigten. */
  items?: string[];
}

export type BarId = 'main' | 'tools';
/** Leisten, die sich ausblenden lassen */
export type BarKey = BarId | 'numbar' | 'textbar' | 'palette' | 'status';

const BAR_EL: Record<BarKey, string> = { main: '#toolbar', tools: '#tools', numbar: '#numbar', textbar: '#textbar', palette: '#palette', status: '#status' };

const actions = new Map<string, Action>();
/** Aktion zu einer Kennung (z. B. für die Kacheln im Werkzeugkasten) */
export const getAction = (id: string) => actions.get(id);
let editableBars: BarDefinition[] = [];
let system: ToolbarSystem | undefined;
export interface ToolbarControlsBundle { definitions: Definitions; controls: ControlDefinition[]; dispose(): void }
let controlsBundle: ToolbarControlsBundle | undefined;
let initialized: { list: Action[]; def: Record<BarId, string[]>; migrate: [string[], string][] } | undefined;
let cleanups: (() => void)[] = [];
let closeMenu: (() => void) | undefined;
let closeDialog: (() => void) | undefined;
/** Eigene Host-Elemente: pro Init neu erzeugt, beim Abbauen wieder entfernt. */
let customHostElements: HTMLElement[] = [];
/** Eigene Leisten dieser Sitzung, die (noch) nicht im Storage stehen (z. B. bei blockiertem Storage). */
let sessionCustom: BarDefinition[] = [];
/** Eigene Leisten heißen `custom-N`; eingebaute Treffer sind darüber geschützt. */
const CUSTOM_BAR = /^custom-\d+$/;

export function setToolbarControls(bundle: ToolbarControlsBundle) {
  if (bundle === controlsBundle) return;
  teardownViews();
  controlsBundle?.dispose();
  controlsBundle = bundle;
  if (initialized) initToolbars(initialized.list, initialized.def, initialized.migrate);
}

function teardownViews() {
  closeMenu?.();
  closeDialog?.();
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  for (const element of customHostElements) element.remove();
  customHostElements = [];
  system?.dispose();
  system = undefined;
}

export function disposeToolbars() {
  teardownViews();
  controlsBundle?.dispose();
  controlsBundle = undefined;
  sessionCustom = [];
  initialized = undefined;
}

export const barNames = (): Record<BarKey, string> => ({
  main: t('Hauptleiste'),
  tools: t('Werkzeugleiste'),
  numbar: t('Eigenschaftenleiste'),
  textbar: t('Textleiste'),
  palette: t('Farbpalette'),
  status: t('Statusleiste'),
});

/** Aktionen und Standardbelegung festlegen, gespeicherte Anpassung laden und die Leisten aufbauen */
export function initToolbars(list: Action[], def: Record<BarId, string[]>, migrate: [string[], string][] = []) {
  teardownViews();
  initialized = { list, def, migrate };
  actions.clear();
  list.forEach((action) => actions.set(action.id, action));
  const item = (id: string): Item => id === SEP ? { kind: 'separator' }
    : { kind: actions.get(id)?.items ? 'group' : 'legacy', id };
  const names = barNames();
  const definitions: Definitions = {
    bars: (Object.keys(BAR_EL) as BarKey[]).map((id) => ({ id, label: names[id],
      items: id === 'main' || id === 'tools' ? def[id].map(item) : [],
      layout: { ...DEFAULT_VIEW, placement: { kind: 'dock', edge: id === 'tools' ? 'left' : 'top', lane: id === 'numbar' ? 1 : id === 'textbar' ? 2 : 0, order: 0 },
        orientation: id === 'tools' ? 'vertical' : 'horizontal' },
    })),
    groups: list.filter((action) => action.items).map((action) => ({ id: action.id, label: action.label,
      kind: 'flyout', items: action.items!.map((id) => id === SEP ? { kind: 'separator' as const } : { kind: 'action' as const, id }),
    })),
  };
  for (const bar of controlsBundle?.definitions.bars ?? []) {
    const index = definitions.bars.findIndex((candidate) => candidate.id === bar.id);
    if (index < 0) definitions.bars.push(bar);
    else definitions.bars[index] = bar;
  }
  definitions.groups.push(...controlsBundle?.definitions.groups ?? []);
  const baseIds = new Set(definitions.bars.map((bar) => bar.id));
  const upgradeLegacy = (raw: unknown) => {
    const result = upgradeLegacyConfig(raw, def, migrate);
    if (!result.ok) throw Error(result.error.message);
    return result.config;
  };
  // Eigene Leisten stehen nicht in den Basis-Definitionen: aus dem Storage rekonstruieren.
  // Inhalt und Layout kommen über normalize aus dem Storage, nur Kennung und Name ergänzen.
  // Ist der Storage maßgeblich, fallen Sitzungsreste weg, die er nicht bestätigt (z. B. gelöscht).
  let storedIds: Set<string> | undefined;
  try {
    const raw = localStorage.getItem(TOOLBAR_STORAGE_KEY);
    if (raw != null) {
      const decoded = decode(raw, { bars: definitions.bars, groups: definitions.groups }, { upgradeLegacy });
      if (decoded.ok) {
        storedIds = new Set(Object.keys(decoded.value.state.content.bars));
        const labels = storedLabels(decoded.value.state.content.labels);
        for (const id of Object.keys(decoded.value.state.content.bars)) {
          if (baseIds.has(id)) continue;
          baseIds.add(id);
          const layout = ownEntry(decoded.value.state.layout.bars, id);
          definitions.bars.push({ id, label: labels[id] ?? id, items: [],
            layout: layout && validView(layout) ? clone(layout) : clone(DEFAULT_VIEW) });
        }
      }
    }
    if (raw == null) storedIds = new Set();
  } catch {
    // Fremde oder defekte Daten bleiben unangetastet; die Leisten starten mit den Basis-Definitionen.
  }
  if (storedIds) sessionCustom = sessionCustom.filter((bar) => storedIds.has(bar.id));
  for (const bar of sessionCustom) {
    if (baseIds.has(bar.id)) continue;
    baseIds.add(bar.id);
    definitions.bars.push({ ...bar, items: [], layout: clone(bar.layout) });
  }
  const hosts = new Map<string, { element: HTMLElement; ownerId: string }>();
  const visibilityHosts = new Map<string, HTMLElement>();
  for (const bar of definitions.bars) {
    const selector = Object.hasOwn(BAR_EL, bar.id) ? BAR_EL[bar.id as BarKey] : undefined;
    let element: HTMLElement | null = null;
    if (selector) element = document.querySelector<HTMLElement>(selector);
    else {
      element = document.createElement('div');
      document.body.append(element);
      customHostElements.push(element);
    }
    if (!element) continue;
    if (bar.id === 'palette' || bar.id === 'status') visibilityHosts.set(bar.id, element);
    else hosts.set(bar.id, { element, ownerId: bar.id });
  }
  editableBars = definitions.bars.filter((bar) => hosts.has(bar.id));
  system = initToolbarFramework({ definitions, actions: list.filter((action) => !action.items),
    controls: controlsBundle?.controls, hosts, visibilityHosts,
    storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    upgradeLegacy,
  });
  for (const action of list) if (action.items) system.registry.registerGroup(action);
  system.refresh();
  for (const [id, descriptor] of hosts) {
    const host = descriptor.element;
    const contextmenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      const root = host.querySelector<HTMLElement>('[data-view]');
      let entry = event.target instanceof Element ? event.target : null;
      while (entry && entry.parentElement !== root) entry = entry.parentElement;
      const index = entry && root ? [...root.children].indexOf(entry) : -1;
      const selected = barItems(id)[index];
      barMenu(id, event.clientX, event.clientY, selected && 'id' in selected ? selected.id : null, index);
    };
    host.addEventListener('contextmenu', contextmenu);
    cleanups.push(() => host.removeEventListener('contextmenu', contextmenu));
  }
}

/** Aktivierung und Zustand aller Knöpfe nachziehen (nach Auswahl- oder Werkzeugwechsel) */
export function refreshBars() {
  system?.refresh();
}

/** Die Aktion, die eine Knopfgruppe gerade zeigt */
function groupCurrent(g: Action): Action {
  // Aktives Werkzeug bevorzugen: es kann auch über Menü/Shortcut gewählt sein.
  for (const id of g.items!) {
    const a = actions.get(id);
    if (!a?.small && a?.on?.()) return a;
  }
  const id = system && ownEntry(system.runtime.read().content.choices, g.id);
  return actions.get(id && g.items!.includes(id) ? id : g.items!.find((x) => !actions.get(x)?.small)!) ?? g;
}

export const isBarHidden = (k: string) => system?.runtime.read().layout.hidden.includes(k) ?? false;

export function toggleBar(k: string) {
  system?.runtime.layout({ kind: 'visibility', barId: k, visible: isBarHidden(k) });
}

/** Ein- und Ausblenden der Leisten im Menü Fenster zurücksetzen */
export function showAllBars() {
  for (const id of Object.keys(system?.runtime.read().content.bars ?? {}))
    system?.runtime.layout({ kind: 'visibility', barId: id, visible: true });
}

/** Gespeicherte Leistennamen lesen (fremde oder defekte Werte fallen auf {} zurück). */
function storedLabels(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) if (typeof label === 'string' && label) setEntry(out, key, label);
  return out;
}

/** Laufzeitmethoden für eigene Leisten; die parallele Runtime bringt sie mit, sonst greift der Rückweg. */
interface CustomBarMethods {
  addBar?: (bar: { id: string; label: string; items?: Item[]; layout?: ViewLayout; iconSize?: IconSize }) => { ok: boolean; error?: string };
  removeBar?: (barId: string) => { ok: boolean; error?: string };
  setBarLabel?: (barId: string, label: string) => { ok: boolean; error?: string };
}

/** Gemeinsame Symbolgröße aller Leisten; 'm' bei gemischten Größen oder ohne Leisten. */
export function toolbarIconSize(): IconSize {
  const sizes = system ? Object.values(system.runtime.read().content.iconSizes) : [];
  return sizes.length > 0 && sizes.every((size) => size === sizes[0]) ? sizes[0] : 'm';
}

/** Eine Größe für alle Leisten (Einstellungen → Darstellung). Ohne Leisten wirkungslos. */
export function setAllToolbarIconSizes(size: IconSize) {
  const current = system;
  if (!current || (size !== 's' && size !== 'm' && size !== 'l')) return;
  for (const id of Object.keys(current.runtime.read().content.bars)) current.runtime.setIconSize(id, size);
}

/** Sitzungsliste eigener Leisten nachführen (Rückweg bei blockiertem Storage, Geister-Bereinigung bei Init). */
function trackSessionCustom(id: string, label: string) {
  const known = sessionCustom.find((bar) => bar.id === id);
  if (known) known.label = label;
  else sessionCustom.push({ id, label, items: [], layout: clone(DEFAULT_VIEW) });
}

/** Sitzungs- und Storage-Stand eigener Leisten sichern, solange der Storage beschreibbar ist. */
function persistCustomState(): boolean {
  const current = system;
  if (!current || !current.runtime.persistence().writable) return false;
  try {
    const state = current.runtime.read();
    const labels = storedLabels(state.content.labels);
    for (const bar of sessionCustom) {
      if (!ownEntry(state.content.bars, bar.id)) setEntry(state.content.bars, bar.id, []);
      if (!ownEntry(state.content.iconSizes, bar.id)) setEntry(state.content.iconSizes, bar.id, bar.iconSize ?? DEFAULT_ICON_SIZE);
      if (!ownEntry(state.layout.bars, bar.id)) setEntry(state.layout.bars, bar.id, clone(bar.layout));
      labels[bar.id] = bar.label;
    }
    (state.content as { labels?: Record<string, string> }).labels = labels;
    const encoded = encode(state);
    if (!encoded.ok) return false;
    localStorage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
    return true;
  } catch { return false; }
}

/** Eigene Leiste samt Inhalt, Layout, Größe und Name aus dem Storage entfernen. */
function removeCustomState(id: string): boolean {
  const current = system;
  if (!current || !current.runtime.persistence().writable) return false;
  try {
    const state = current.runtime.read();
    if (!ownEntry(state.content.bars, id)) return true;
    delete state.content.bars[id];
    delete state.content.iconSizes[id];
    delete state.layout.bars[id];
    state.layout.hidden = state.layout.hidden.filter((entry) => entry !== id);
    for (const key of Object.keys(state.layout.detached))
      if (ownEntry(state.layout.detached, key)?.ownerId === id) delete state.layout.detached[key];
    const labels = storedLabels(state.content.labels);
    delete labels[id];
    (state.content as { labels?: Record<string, string> }).labels = labels;
    const encoded = encode(state);
    if (!encoded.ok) return false;
    localStorage.setItem(TOOLBAR_STORAGE_KEY, encoded.value);
    return true;
  } catch { return false; }
}

/** Ansichten neu aufbauen und den Anpassen-Dialog wieder öffnen (vorhandenes setToolbarControls-Muster). */
function reinitAfterCustomChange(select?: string) {
  if (!initialized) return;
  const snapshot = initialized;
  teardownViews();
  initToolbars(snapshot.list, snapshot.def, snapshot.migrate);
  openToolbarDialog(select);
}

/** Eigene Leiste anlegen (ID `custom-N` mit kleinstem freien N); gibt die ID zurück. */
export function createToolbar(name: string): string | undefined {
  const current = system;
  if (!current || !initialized || typeof name !== 'string') return undefined;
  const label = name.trim();
  if (!label) return undefined;
  const taken = new Set(Object.keys(current.runtime.read().content.bars));
  let n = 1;
  while (taken.has(`custom-${n}`)) n++;
  const id = `custom-${n}`;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  trackSessionCustom(id, label);
  if (typeof custom.addBar === 'function') {
    const added = custom.addBar({ id, label, items: [], layout: clone(DEFAULT_VIEW) });
    if (!added || !added.ok) {
      sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
      return undefined;
    }
  } else persistCustomState();
  reinitAfterCustomChange(id);
  return id;
}

/** Eigene Leiste löschen (eingebaute sind geschützt); true bei Erfolg. */
export function deleteToolbar(id: string): boolean {
  const current = system;
  if (!current || !initialized || !CUSTOM_BAR.test(id)) return false;
  if (!ownEntry(current.runtime.read().content.bars, id)) return false;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  if (typeof custom.removeBar === 'function') {
    const removed = custom.removeBar(id);
    if (removed && removed.ok) {
      sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
      reinitAfterCustomChange();
      return true;
    }
    // Eigene Leisten stehen für Hosts und Dialog in den Definitions und gelten der
    // Runtime dort als eingebaut: dann den Storage-Eingriff als Rückweg nehmen.
    if (!removed || removed.error !== 'Built-in bar') return false;
  }
  sessionCustom = sessionCustom.filter((bar) => bar.id !== id);
  removeCustomState(id);
  reinitAfterCustomChange();
  return true;
}

/** Eigene Leiste umbenennen (eingebaute sind geschützt); true bei Erfolg. */
export function renameToolbar(id: string, name: string): boolean {
  const current = system;
  if (!current || !initialized || !CUSTOM_BAR.test(id) || typeof name !== 'string') return false;
  const label = name.trim();
  if (!label || !ownEntry(current.runtime.read().content.bars, id)) return false;
  const custom = current.runtime as ToolbarSystem['runtime'] & CustomBarMethods;
  if (typeof custom.setBarLabel === 'function') {
    const renamed = custom.setBarLabel(id, label);
    if (renamed && renamed.ok) {
      trackSessionCustom(id, label);
      reinitAfterCustomChange(id);
      return true;
    }
    if (!renamed || renamed.error !== 'Built-in bar') return false;
  }
  trackSessionCustom(id, label);
  persistCustomState();
  reinitAfterCustomChange(id);
  return true;
}

const barItems = (id: string): Item[] => system ? ownEntry(system.runtime.read().content.bars, id) ?? [] : [];
const setBar = (id: string, items: Item[]) => system?.runtime.setBarItems(id, items);
const newItem = (id: string): Item => id === SEP ? { kind: 'separator' }
  : { kind: actions.get(id)?.items ? 'group' : 'action', id };

// ---------- Kontextmenü einer Leiste ----------

function barMenu(id: string, x: number, y: number, action: string | null, index: number) {
  closeMenu?.();
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    if (closeMenu === close) closeMenu = undefined;
  };
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close();
  const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const item = (label: string, f: () => void) => h('button', { onclick: () => (close(), f()) }, label);
  const a = action ? actions.get(action) ?? { label: action } : null;
  const menu = h(
    'div',
    { class: 'ctx-menu menu-items' },
    item(t('Funktionsleisten anpassen …'), () => openToolbarDialog(id)),
    index >= 0 ? item(t('„{name}“ aus der Leiste entfernen', { name: a?.label.replace(/ \(.*\)$/, '') ?? SEP }), () => setBar(id, barItems(id).filter((_, i) => i !== index))) : null,
    h('hr'),
    item(t('{bar} ausblenden', { bar: editableBars.find((bar) => bar.id === id)?.label ?? id }), () => toggleBar(id)),
  );
  menu.style.left = `${Math.min(x, window.innerWidth - 260)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  document.body.append(menu);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', keydown, true);
  closeMenu = close;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

// ---------- Anpassen-Dialog ----------

export function openToolbarDialog(start: string = 'main') {
  if (!system) return;
  closeDialog?.();
  let bar = editableBars.some((candidate) => candidate.id === start) ? start : editableBars[0]?.id ?? 'main';
  let selAvail: string | null = null;
  let selIdx = -1;
  let filter = '';
  const barSel = h('select', { onchange: () => ((bar = barSel.value), (selIdx = -1), sync(), renderLists()) },
    ...editableBars.map((definition) => h('option', { value: definition.id }, definition.label)),
  ) as HTMLSelectElement;
  barSel.value = bar;
  const sizeSel = h('select', { onchange: () => system?.runtime.setIconSize(bar, sizeSel.value as IconSize) },
    h('option', { value: 's' }, t('Klein|Symbole')),
    h('option', { value: 'm' }, t('Normal|Symbole')),
    h('option', { value: 'l' }, t('Groß|Symbole')),
  ) as HTMLSelectElement;
  const shownChk = h('input', { type: 'checkbox', onchange: () => toggleBar(bar) }) as HTMLInputElement;
  const changeLayout = (change: Partial<ViewLayout>) => {
    const current = system && ownEntry(system.runtime.read().layout.bars, bar);
    if (current) system?.runtime.layout({ kind: 'place', target: { barId: bar }, view: { ...current, ...change } });
    sync();
  };
  const orientation = h('select', { 'aria-label': t('Ausrichtung der Leiste'), onchange: () => changeLayout({ orientation: orientation.value === 'vertical' ? 'vertical' : 'horizontal' }) },
    h('option', { value: 'horizontal' }, t('Waagerecht')),
    h('option', { value: 'vertical' }, t('Senkrecht')),
  );
  const countInput = (key: 'rows' | 'columns', label: string) => h('input', {
    type: 'number', min: 1, step: 1, 'aria-label': label, style: 'width: 6ch',
    onchange(event: Event) {
      const value = (event.target as HTMLInputElement).valueAsNumber;
      if (Number.isSafeInteger(value) && value >= 1) changeLayout({ [key]: value });
      else sync();
    },
  });
  const rows = countInput('rows', t('Zeilen der Leiste'));
  const columns = countInput('columns', t('Spalten der Leiste'));
  const locked = h('input', { type: 'checkbox', onchange: () => { system?.runtime.lock(locked.checked); sync(); } });
  let layoutResetButton: HTMLButtonElement | undefined;
  const sync = () => {
    sizeSel.value = system && ownEntry(system.runtime.read().content.iconSizes, bar) || 'm';
    shownChk.checked = !isBarHidden(bar);
    const state = system?.runtime.read();
    const layout = state && ownEntry(state.layout.bars, bar);
    locked.checked = state?.layout.locked ?? false;
    if (layoutResetButton) layoutResetButton.disabled = locked.checked;
    shownChk.disabled = locked.checked;
    orientation.value = layout?.orientation ?? 'horizontal';
    rows.value = String(layout?.rows ?? 1);
    columns.value = String(layout?.columns ?? 1);
    orientation.disabled = rows.disabled = columns.disabled = locked.checked;
    rebuildCustomRow();
  };
  const search = h('input', { type: 'search', placeholder: t('Suchen …'), oninput: () => ((filter = search.value.toLowerCase()), renderLists()) }) as HTMLInputElement;
  const avail = h('div', { class: 'tb-list' });
  const current = h('div', { class: 'tb-list' });

  const row = (a: Action | null, extra: Record<string, unknown>) => {
    // Knopfgruppen zeigen das Symbol der Aktion, die sie gerade tragen
    const ic = a?.items ? groupCurrent(a) : a;
    return h('div', { class: 'tb-row', tabIndex: 0, role: 'button',
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (event.currentTarget as HTMLElement).click();
        }
      }, ...extra },
      ic ? h('span', { class: `tb-icon${ic.icon ? '' : ' text'}`, icon: ic.icon ?? '' }, ic.icon ? null : ic.short ?? '') : h('span', { class: 'tb-icon' }),
      h('span', {}, a ? a.label : t('— Trennlinie —')),
    );
  };

  const add = (id: string) => {
    const list = barItems(bar);
    const at = selIdx >= 0 ? selIdx + 1 : list.length;
    list.splice(at, 0, newItem(id));
    selIdx = at;
    setBar(bar, list);
    renderLists();
  };
  const removeSel = () => {
    if (selIdx < 0) return;
    const list = barItems(bar).filter((_, i) => i !== selIdx);
    selIdx = Math.min(selIdx, list.length - 1);
    setBar(bar, list);
    renderLists();
  };
  const move = (d: number) => {
    const list = barItems(bar);
    const k = selIdx + d;
    if (selIdx < 0 || k < 0 || k >= list.length) return;
    [list[selIdx], list[k]] = [list[k], list[selIdx]];
    selIdx = k;
    setBar(bar, list);
    renderLists();
  };

  let dragFrom: { kind: 'avail'; id: string } | { kind: 'cur'; index: number } | null = null;
  const renderLists = () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.tb-row') : null;
    const focusList = focused && (avail.contains(focused) ? avail : current.contains(focused) ? current : null);
    const focusIndex = focusList && focused ? [...focusList.querySelectorAll('.tb-row')].indexOf(focused) : -1;
    const focusId = focused?.dataset.action;
    const used = new Set(barItems(bar).flatMap((item) => 'id' in item ? [item.id] : []));
    avail.replaceChildren();
    let cat = '';
    for (const a of actions.values()) {
      if (filter && !a.label.toLowerCase().includes(filter) && !a.cat.toLowerCase().includes(filter)) continue;
      if (a.cat !== cat) avail.append(h('div', { class: 'tb-cat' }, (cat = a.cat)));
      const r = row(a, {
        draggable: true,
        onclick: () => ((selAvail = a.id), renderLists()),
        ondblclick: () => add(a.id),
        ondragstart: () => (dragFrom = { kind: 'avail', id: a.id }),
      });
      r.dataset.action = a.id;
      r.classList.toggle('sel', selAvail === a.id);
      r.classList.toggle('used', used.has(a.id));
      avail.append(r);
    }
    current.replaceChildren();
    barItems(bar).forEach((item, i) => {
      const id = 'id' in item ? item.id : SEP;
      const unknown: Action = { id, cat: '', label: id, run() {} };
      const r = row(item.kind === 'separator' ? null : actions.get(id) ?? unknown, {
        draggable: true,
        onclick: () => ((selIdx = i), renderLists()),
        ondblclick: () => ((selIdx = i), removeSel()),
        ondragstart: () => (dragFrom = { kind: 'cur', index: i }),
      });
      r.dataset.index = String(i);
      r.classList.toggle('sel', i === selIdx);
      current.append(r);
    });
    if (!barItems(bar).length) current.append(h('div', { class: 'muted tb-hint' }, t('Aktionen hierher ziehen')));
    if (focusList) {
      const rows = [...focusList.querySelectorAll<HTMLElement>('.tb-row')];
      const replacement = focusList === avail ? rows.find((candidate) => candidate.dataset.action === focusId) : rows[Math.min(focusIndex, rows.length - 1)];
      (replacement ?? search).focus();
    }
  };
  // Ziehen: aus „Verfügbar“ einfügen oder in der Leiste umsortieren
  const dropIndex = (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.tb-row');
    if (!r?.dataset.index) return barItems(bar).length;
    const box = r.getBoundingClientRect();
    return Number(r.dataset.index) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
  };
  current.addEventListener('dragover', (e) => {
    if (!dragFrom) return;
    e.preventDefault();
    current.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const k = dropIndex(e);
    const rows = current.querySelectorAll('.tb-row');
    if (k < rows.length) rows[k].classList.add('drop-before');
    else rows[rows.length - 1]?.classList.add('drop-after');
  });
  current.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragFrom) return;
    const list = barItems(bar);
    let k = dropIndex(e);
    if (dragFrom.kind === 'avail') list.splice(k, 0, newItem(dragFrom.id));
    else {
      const [x] = list.splice(dragFrom.index, 1);
      if (k > dragFrom.index) k--;
      list.splice(k, 0, x);
    }
    selIdx = k;
    dragFrom = null;
    setBar(bar, list);
    renderLists();
  });
  avail.addEventListener('dragover', (e) => dragFrom?.kind === 'cur' && e.preventDefault());
  avail.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragFrom?.kind !== 'cur') return;
    selIdx = dragFrom.index;
    dragFrom = null;
    removeSel();
  });
  const btn = (label: string, title: string, f: () => void) => h('button', { class: 'btn', title, onclick: f }, label);
  // Erstellen-Zeile; für eigene Leisten zusätzlich Umbenennen (Textfeld) und Löschen (mit Bestätigung).
  const customRow = h('div', { class: 'tb-top' });
  const newName = h('input', { type: 'text', placeholder: t('Name der neuen Leiste'), 'aria-label': t('Neue Leiste') }) as HTMLInputElement;
  const rebuildCustomRow = () => {
    customRow.replaceChildren(
      h('label', {}, t('Neue Leiste'), newName),
      btn(t('Erstellen'), t('Neue Leiste'), () => void createToolbar(newName.value)),
    );
    if (!CUSTOM_BAR.test(bar)) return;
    const target = editableBars.find((candidate) => candidate.id === bar);
    if (!target) return;
    const rename: HTMLInputElement = h('input', { type: 'text', value: target.label, 'aria-label': t('Name'),
      onchange: () => void renameToolbar(bar, rename.value) });
    customRow.append(
      h('label', {}, t('Name'), rename),
      btn(t('Löschen'), t('Leiste löschen'), () => {
        if (confirm(t('Leiste „{name}“ löschen?', { name: target.label }))) deleteToolbar(bar);
      }),
    );
  };
  const dlg = h(
    'dialog',
    { class: 'toolbar-dialog' },
    h('h3', {}, t('Funktionsleisten anpassen')),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Leiste'), barSel),
      h('label', {}, t('Symbolgröße'), sizeSel),
      h('label', { class: 'check' }, shownChk, t('Anzeigen')),
    ),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Ausrichtung der Leiste'), orientation),
      h('label', {}, t('Zeilen der Leiste'), rows),
      h('label', {}, t('Spalten der Leiste'), columns),
      h('label', { class: 'check' }, locked, t('Leistenlayout sperren')),
    ),
    customRow,
    h('div', { class: 'tb-cols' },
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('Verfügbare Aktionen')), search, avail),
      h('div', { class: 'tb-mid' },
        btn('→', t('Gewählte Aktion hinter der markierten Stelle einfügen'), () => selAvail && add(selAvail)),
        btn('←', t('Markierten Eintrag aus der Leiste entfernen'), removeSel),
      ),
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('In der Leiste')), current,
        h('div', { class: 'tb-btns' },
          btn('↑', t('Nach oben bzw. links'), () => move(-1)),
          btn('↓', t('Nach unten bzw. rechts'), () => move(1)),
          btn(t('Trennlinie'), t('Trennlinie hinter der markierten Stelle einfügen'), () => add(SEP)),
        ),
      ),
    ),
    h('p', { class: 'note' }, t('Doppelklick fügt hinzu bzw. entfernt. Einträge lassen sich auch ziehen. Änderungen gelten sofort.')),
    h('div', { class: 'dialog-buttons' },
      btn(t('Standard wiederherstellen'), t('Diese Leiste auf die Standardbelegung zurücksetzen'), () => {
        selIdx = -1;
        const definition = editableBars.find((candidate) => candidate.id === bar);
        if (definition) setBar(bar, structuredClone(definition.items));
        sync();
        renderLists();
      }),
      (layoutResetButton = btn(t('Leistenlayout zurücksetzen'), t('Positionen und Sichtbarkeit zurücksetzen; Belegung und Symbolgrößen behalten'), () => {
        system?.runtime.layout({ kind: 'reset' });
        sync();
      })),
      btn(t('Alle Belegungen zurücksetzen'), t('Belegungen zurücksetzen; Positionen und Symbolgrößen behalten'), () => {
        system?.runtime.resetContent();
        selIdx = -1;
        sync();
        renderLists();
      }),
      h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen')),
    ),
  );
  const unsubscribe = system.runtime.subscribe(sync);
  const close = () => {
    unsubscribe();
    if (dlg.open) dlg.close();
    dlg.remove();
    if (closeDialog === close) closeDialog = undefined;
  };
  closeDialog = close;
  dlg.addEventListener('close', close);
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  sync();
  renderLists();
  dlg.showModal();
}
