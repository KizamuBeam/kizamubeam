// Macro buttons (issue #506): row in the Move tab and the console, runner with the same gates as
// jogging, and the "Macros" tab of the device settings.
import { h } from './dom';
import { fireLockMessage } from './fire';
import type { Device } from './gcode';
import { t } from './i18n';
import { machine } from './machine';
import { showEditorMenu } from './contextMenu';
import {
  expandMacro, laserOnLines, Macro, macroFailText, macroPresets, macroTitle, macroVarNames, macroVars, MAX_MACRO_LINES, MAX_MACROS,
  MacroIo, newMacroId, runMacroLines, varsFromText, varsToText,
} from './macros';

let active: { id: string; stop: boolean } | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Called when a macro starts or ends */
export const onMacroChange = (f: () => void) => listeners.add(f);

/** A macro is running (moves and other macros stay locked until it ends) */
export const macroRunning = () => !!active;

const machineIo: MacroIo = {
  send: (line) => machine.send(line),
  listen: (fn) => machine.on((e) => {
    if (e.type === 'connection' && !machine.connected) fn({ lost: true });
    else if (e.type === 'status' && machine.status.state.startsWith('Alarm')) fn({ alarm: true });
    else if (e.type === 'line' && (e.dir === 'in' || e.dir === 'error')) fn({ line: e.dir === 'error' && !/^(error|alarm)/i.test(e.line) ? `error: ${e.line}` : e.line });
  }),
};

/** Why a macro cannot run right now; null = allowed */
export function macroBlocker(d: Device): string | null {
  if (machine.fire.locked) return fireLockMessage();
  if (d.fw === 'ruida') return t('Ruida-Steuerungen verwenden keinen G-Code. Makros sind hier nicht verfügbar.');
  if (!machine.connected || machine.running) return t('Nicht verbunden oder Maschine beschäftigt.');
  if (active) return t('Es läuft bereits ein Makro.');
  if (d.fw !== 'marlin' && machine.status.state !== 'Idle') return t('Makros nur bei Stillstand (Idle).');
  return null;
}

/** Run one macro after the gates and, for laser-on commands, a confirmation */
export async function runMacro(d: Device, m: Macro, notify: (msg: string, error?: boolean) => void) {
  const name = m.name.trim() || t('Makro');
  const why = macroBlocker(d);
  if (why) return notify(why, true);
  const { lines, missing } = expandMacro(m.gcode, macroVars(d));
  if (missing.length) return notify(t('Makro „{name}“: Wert fehlt für {vars}. In den Geräteeinstellungen unter „Makros“ eintragen.', { name, vars: missing.map((v) => `{${v}}`).join(', ') }), true);
  if (!lines.length) return notify(t('Makro „{name}“ enthält keine Befehle.', { name }), true);
  if (lines.length > MAX_MACRO_LINES) return notify(t('Makro „{name}“ hat mehr als {n} Zeilen.', { name, n: MAX_MACRO_LINES }), true);
  const laser = laserOnLines(lines);
  if (laser.length && !confirm(t('⚠ Achtung') + '\n\n' + t('Das Makro „{name}“ schaltet den Laser ein:', { name }) + '\n' + laser.join('\n') + '\n\n' + t('Schutzbrille tragen und Freiraum prüfen. Makro trotzdem ausführen?'))) return;
  // Gates again: the confirmation may have taken a while
  const again = macroBlocker(d);
  if (again) return notify(again, true);
  const run = { id: m.id, stop: false };
  active = run;
  changed();
  machine.log(t('Makro „{name}“ startet ({n} Zeilen).', { name, n: lines.length }));
  try {
    const r = await runMacroLines(lines, machineIo, { stopped: () => run.stop });
    if (r.ok) notify(t('Makro „{name}“ fertig.', { name }));
    else notify(macroFailText(name, r), r.reason !== 'stopped');
  } finally {
    active = null;
    changed();
  }
}

/** Ask the running macro to stop after the current line */
export function stopMacro() {
  if (active) active.stop = true;
}

/**
 * Row of macro buttons. `onEdit(id)` opens the device settings at the macro (id `new` = add one).
 * `compact` leaves out the heading and the add button (console).
 */
export function macroRow(getDevice: () => Device, onEdit: (id: string) => void, notify: (msg: string, error?: boolean) => void, compact = false) {
  const buttons = h('div', { class: 'macro-buttons' });
  const root = h('div', { class: compact ? 'macro-row compact' : 'macro-row' },
    ...(compact ? [] : [h('div', { class: 'sub' }, t('Makros'))]),
    buttons,
  );
  const fill = () => {
    const d = getDevice();
    buttons.textContent = '';
    const list = d.macros ?? [];
    root.hidden = d.fw === 'ruida' || (compact && !list.length);
    const why = macroBlocker(d);
    for (const m of list) {
      const running = active?.id === m.id;
      const b = h('button', {
        class: 'btn small' + (running ? ' on' : ''),
        title: running ? t('Läuft. Klicken stoppt nach der aktuellen Zeile.') : macroTitle(m),
        disabled: !running && !!why,
        onclick: () => (running ? stopMacro() : void runMacro(getDevice(), m, notify)),
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          showEditorMenu(e.clientX, e.clientY, [[
            { id: 'macro-run', label: t('Ausführen'), enabled: !why, run: () => runMacro(getDevice(), m, notify) },
            { id: 'macro-edit', label: t('Makro bearbeiten …'), run: () => onEdit(m.id) },
            { id: 'macro-add', label: t('Makro hinzufügen …'), run: () => onEdit('new') },
          ]]);
        },
      }, m.name.trim() || t('Makro'));
      buttons.append(b);
    }
    if (!compact) {
      buttons.append(h('button', {
        class: 'btn small macro-add', title: list.length ? t('Makro hinzufügen oder bearbeiten (Rechtsklick auf ein Makro bearbeitet es)') : t('Eigene G-Code-Folgen als Knöpfe anlegen, z. B. Z antasten oder Air Assist'),
        onclick: () => onEdit('new'),
      }, list.length ? '+' : t('+ Makro')));
    }
  };
  listeners.add(fill);
  machine.on((e) => e.type !== 'line' && fill());
  fill();
  return { root, refresh: fill };
}

// ---------- Device settings tab ----------

/**
 * Editor for the macros of a device draft. Changes go to `d.macros` / `d.macroVars` right away
 * (the dialog copies them back on "Apply"). `save()` validates the variables; false = stay open.
 */
export function macroSettings(d: Device, focus?: string) {
  d.macros = (d.macros ?? []).map((m) => ({ ...m }));
  d.macroVars = { ...(d.macroVars ?? {}) };
  if (focus === 'new') {
    const id = newMacroId();
    d.macros.push({ id, name: '', gcode: '' });
    focus = id;
  }
  const list = h('div', { class: 'macro-list wide' });
  const varsArea = h('textarea', { class: 'script', rows: 3, spellcheck: false, placeholder: 'probeMax = 40' }) as HTMLTextAreaElement;
  varsArea.value = varsToText(d.macroVars);
  const varsNote = h('div', { class: 'note wide' });
  const syncVarsNote = () => {
    const used = new Set((d.macros ?? []).flatMap((m) => macroVarNames(m.gcode)));
    const known = macroVars({ ...d, macroVars: varsFromText(varsArea.value).vars });
    const missing = [...used].filter((v) => !(v in known));
    varsNote.classList.toggle('error', missing.length > 0);
    varsNote.textContent = (missing.length ? t('Ohne Wert: {vars}.', { vars: missing.map((v) => `{${v}}`).join(', ') }) + ' ' : '')
      + t('Eine Zeile je Variable, z. B. „probeMax = 40“. Im Makro als {probeMax} verwenden. {materialThickness} kommt aus „Materialhöhe“ (Tab Allgemein).');
  };
  varsArea.addEventListener('input', syncVarsNote);
  const render = () => {
    list.textContent = '';
    const ms = d.macros!;
    if (!ms.length) list.append(h('div', { class: 'note' }, t('Noch keine Makros. Ein Beispiel wählen oder ein neues Makro anlegen.')));
    ms.forEach((m, i) => {
      const name = h('input', { type: 'text', value: m.name, placeholder: t('Name'), maxLength: 60, oninput: (e: Event) => (m.name = (e.target as HTMLInputElement).value) }) as HTMLInputElement;
      const tip = h('input', { type: 'text', value: m.tip ?? '', placeholder: t('Tooltip (optional)'), maxLength: 300, oninput: (e: Event) => (m.tip = (e.target as HTMLInputElement).value || undefined) }) as HTMLInputElement;
      const code = h('textarea', {
        class: 'script', rows: 4, spellcheck: false, placeholder: t('Eine Zeile je Befehl'),
        oninput: (e: Event) => ((m.gcode = (e.target as HTMLTextAreaElement).value), syncVarsNote()),
      }) as HTMLTextAreaElement;
      code.value = m.gcode;
      const move = (to: number) => {
        if (to < 0 || to >= ms.length) return;
        ms.splice(to, 0, ...ms.splice(i, 1));
        render();
      };
      const box = h('fieldset', { class: 'macro-item' },
        h('div', { class: 'macro-head' }, name,
          h('button', { class: 'btn small', title: t('Nach oben'), disabled: i === 0, onclick: () => move(i - 1) }, '↑'),
          h('button', { class: 'btn small', title: t('Nach unten'), disabled: i === ms.length - 1, onclick: () => move(i + 1) }, '↓'),
          h('button', { class: 'btn small', title: t('Makro löschen'), onclick: () => (ms.splice(i, 1), render(), syncVarsNote()) }, '✕'),
        ),
        tip,
        code,
      );
      list.append(box);
      if (m.id === focus) requestAnimationFrame(() => (box.scrollIntoView({ block: 'nearest' }), name.focus()));
    });
  };
  const presets = macroPresets(d.fw, d.airCmd);
  const presetSel = h('select', {},
    h('option', { value: '' }, t('Beispiel wählen …')),
    ...presets.map((p) => h('option', { value: p.key, title: p.tip }, p.name)),
  ) as HTMLSelectElement;
  const add = (m: Macro) => {
    if (d.macros!.length >= MAX_MACROS) return;
    d.macros!.push(m);
    focus = m.id;
    render();
    syncVarsNote();
  };
  const addPreset = h('button', {
    class: 'btn small', onclick: () => {
      const p = presets.find((x) => x.key === presetSel.value);
      if (!p) return;
      // Defaults for the example's placeholders, only where the device has no value yet
      const cur = varsFromText(varsArea.value).vars;
      const extra = Object.entries(p.vars ?? {}).filter(([k]) => !(k in cur));
      if (extra.length) varsArea.value = varsToText({ ...cur, ...Object.fromEntries(extra) });
      add({ id: newMacroId(), name: p.name, tip: p.tip, gcode: p.gcode });
      presetSel.value = '';
    },
  }, t('Hinzufügen'));
  const addEmpty = h('button', { class: 'btn small', onclick: () => add({ id: newMacroId(), name: '', gcode: '' }) }, t('Neues Makro'));
  render();
  syncVarsNote();
  const rows: HTMLElement[] = [
    h('div', { class: 'note wide' }, t('Eigene G-Code-Folgen als Knöpfe im Bewegen-Tab und in der Konsole. Sie laufen nur verbunden und bei Stillstand, Zeile für Zeile; bei Fehler oder Alarm werden die restlichen Zeilen nicht gesendet. Makros, die den Laser einschalten (M3/M4 mit S > 0), fragen vorher nach. Endet ein Makro relativ (G91), wird danach G90 gesendet.')),
    list,
    h('div', { class: 'macro-add-row wide' }, presetSel, addPreset, addEmpty),
    h('div', { class: 'sub' }, t('Variablen')),
    varsArea,
    varsNote,
  ];
  if (!presets.length) rows.splice(2, 1);
  return {
    rows,
    /** Validate and store; false = invalid input (the tab is shown) */
    save(show: () => void): boolean {
      const { vars, bad } = varsFromText(varsArea.value);
      if (bad.length) {
        show();
        varsNote.classList.add('error');
        varsNote.textContent = t('Nicht lesbar: {lines}. Format: name = Zahl', { lines: bad.join(', ') });
        varsArea.focus();
        return false;
      }
      d.macroVars = vars;
      d.macros = d.macros!.filter((m) => m.name.trim() || m.gcode.trim()).map((m) => ({ ...m, name: m.name.trim(), tip: m.tip?.trim() || undefined }));
      return true;
    },
  };
}
