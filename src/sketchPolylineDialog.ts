import { evalExpr, h, showDialog } from './dom';
import type { Editor } from './editor';
import { t } from './i18n';
import { addSketchPolyline, type SketchSegment } from './sketch/polyline';

export function sketchPolylineDialog(ed: Editor) {
  const active = ed.sketchEdit;
  if (!active) return;
  const point = (name: string, value = '') => {
    const inputs = ['X', 'Y'].map((axis) => h('input', { type: 'text', inputmode: 'decimal', size: 10, value, 'aria-label': `${axis} — ${name}`, 'aria-describedby': 'sk-poly-error' }));
    return { inputs, group: h('fieldset', {}, h('legend', {}, name), ...inputs.map((input, i) => h('label', {}, i ? 'Y ' : 'X ', input))) };
  };
  const start = point(t('Startpunkt (mm)'), '0');
  const rows = h('div');
  const closed = h('input', { type: 'checkbox', 'aria-describedby': 'sk-poly-error' });
  const err = h('div', { id: 'sk-poly-error', role: 'alert', class: 'note' });
  const dlg = h('dialog', { class: 'sketch-polyline-dialog', 'aria-labelledby': 'sk-poly-title' });
  const segments: { group: HTMLFieldSetElement; legend: HTMLLegendElement; kind: HTMLSelectElement; end: ReturnType<typeof point>; via: ReturnType<typeof point> }[] = [];
  const updateRows = () => {
    segments.forEach(({ legend }, i) => { legend.textContent = t('Segment {n}', { n: i + 1 }); });
    remove.disabled = segments.length <= 1;
  };
  const addRow = (focus: boolean) => {
    const end = point(t('Endpunkt (mm)')), via = point(t('Punkt auf dem Bogen (mm)'));
    const kind = h('select', { onchange: () => { via.group.hidden = kind.value !== 'arc'; } },
      h('option', { value: 'line' }, t('Gerade')), h('option', { value: 'arc' }, t('Bogen')));
    via.group.hidden = true;
    const legend = h('legend');
    const group = h('fieldset', {}, legend, h('label', {}, t('Segmenttyp'), ' ', kind), end.group, via.group);
    segments.push({ group, legend, kind, end, via });
    rows.append(group);
    updateRows();
    if (focus) kind.focus();
  };
  const add = h('button', { type: 'button', class: 'btn', onclick: () => addRow(true) }, t('Segment hinzufügen'));
  const remove = h('button', { type: 'button', class: 'btn', onclick: () => {
    if (segments.length <= 1) return;
    segments.pop()!.group.remove();
    updateRows();
    if (remove.disabled) add.focus();
  } }, t('Letztes Segment entfernen'));
  const mark = (input: HTMLElement, message: string) => {
    err.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  function read({ inputs }: ReturnType<typeof point>) {
    const values = inputs.map((input) => evalExpr(input.value));
    const i = values.findIndex((value) => value === null || !Number.isFinite(value));
    if (i < 0) return { x: values[0]!, y: values[1]! };
    mark(inputs[i], t('Gib eine gültige Koordinate ein.'));
    return null;
  }
  const form = h('form', { onsubmit: (event: Event) => {
    event.preventDefault();
    if (ed.sketchEdit !== active) { dlg.close(); return; }
    err.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const origin = read(start);
    if (!origin) return;
    const edges: SketchSegment[] = [];
    for (const row of segments) {
      const end = read(row.end);
      if (!end) return;
      const through = row.kind.value === 'arc' ? read(row.via) : undefined;
      if (through === null) return;
      edges.push({ end, through });
    }
    const result: { issue: ReturnType<typeof addSketchPolyline> } = { issue: null };
    if (ed.sketchChange(t('Polylinie'), (sk) => {
      result.issue = addSketchPolyline(sk, origin, edges, closed.checked);
      if (result.issue) return false;
    })) { dlg.close(); return; }
    const issue = result.issue;
    if (issue?.reason === 'arc') mark(segments[issue.index].via.inputs[0], t('Der Bogen braucht drei verschiedene Punkte, die nicht auf einer Geraden liegen.'));
    else if (issue?.reason === 'precision') mark(segments[issue.index].via.inputs[0], t('Der Bogen lässt sich an dieser Position nicht genau berechnen. Verlege seine Punkte näher an den Skizzenursprung.'));
    else if (issue?.reason === 'closure') mark(closed, t('Diese Kette lässt sich so nicht schließen. Ändere den letzten Endpunkt oder füge ein Segment hinzu.'));
    else if (issue) mark(segments[issue.index].end.inputs[0], t('Wähle einen Endpunkt mit ausreichendem Abstand zum Segmentanfang.'));
    else err.textContent = t('Die Polylinie konnte nicht berechnet werden. Prüfe die Koordinaten.');
  } },
  h('div', { class: 'note' }, t('Die Koordinaten beziehen sich auf die Skizze.')), start.group, rows,
  h('div', { class: 'dialog-buttons' }, add, remove),
  h('label', {}, closed, ' ', t('Schließen, bei Bedarf mit einer Geraden')), err,
  h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
    h('button', { class: 'btn primary', type: 'submit' }, t('Polylinie erstellen'))));
  addRow(false);
  dlg.append(h('h3', { id: 'sk-poly-title' }, t('Polylinie')), form);
  showDialog(dlg);
  start.inputs[0].select();
}
