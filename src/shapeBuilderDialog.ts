// Formerstellung: modeless, positionierbares Werkzeugfenster mit Booleschen Operationen.
// Varianten Vereinen, Abziehen (A−B / B−A) und Schnittmenge werden live am Canvas vorgemerkt (Ergebnis farbig
// gefüllt und deutlich umrandet, ausgeschlossene Teile rot), die Originale können erhalten bleiben oder auf
// „Nicht lasern“ gelegt werden.
import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import type { AssistantOp } from './editor/shapeops';
import { h } from './dom';
import { t } from './i18n';
import { movableToolWindow } from './toolWindow';

const open = new WeakSet<Editor>();

type Op = AssistantOp;

export async function openShapeBuilderDialog(ed: Editor): Promise<void> {
  if (open.has(ed) || ed.outlinePreview || document.querySelector('dialog[open]')) return;
  open.add(ed);
  let attached = false, disposeWindow = () => {}, applying = false, disposed = false;
  const busyTimer = setTimeout(() => { ed.hint = t('Formerstellung wird berechnet …'); ed.emit('tool'); }, 300);
  try {
    const keep = h('input', { type: 'checkbox', checked: true, id: 'shape-builder-keep', 'aria-label': t('Originale behalten') });
    const noLaser = h('input', { type: 'checkbox', checked: true, id: 'shape-builder-noLaser', 'aria-label': t('Behaltene Originale auf „Nicht lasern“ setzen') });
    const enabledNote = h('p', { class: 'note', id: 'shape-builder-noLaser-note' }, t('Originale bleiben erhalten, aber auf „Nicht lasern“ gelegt.'));
    const syncNoLaser = () => {
      const kept = keep.checked;
      noLaser.disabled = !kept;
      enabledNote.hidden = !kept || !noLaser.checked;
    };
    keep.addEventListener('change', syncNoLaser);
    noLaser.addEventListener('change', syncNoLaser);
    syncNoLaser();

    const ops = h('div', { class: 'shape-builder-ops', role: 'group', 'aria-label': t('Operation auswählen') });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const title = h('h3', {}, t('Formerstellung'));
    const dlg = h('dialog', { class: 'shape-builder-dialog outline-tool-window', 'aria-labelledby': 'shape-builder-title' });
    title.id = 'shape-builder-title';
    const opButtons: { el: HTMLButtonElement; op: Op | 'reset' }[] = [];
    let currentOp: Op = 'union';
    let applyReady = false;
    let preview: OutlinePreview | null = null;
    let cancelPreview = false;

    const refresh = async () => {
      if (disposed || cancelPreview) return;
      const selectable = ed.sel.filter((o) => o.shape.kind !== 'image');
      if (selectable.length < 2) {
        applyReady = false; apply.disabled = true;
        info.textContent = t('Mindestens zwei Formen auswählen. Bilder sind nicht unterstützt.'); if (preview) ed.outlinePreview = null;
        preview = null; return;
      }
      try {
        const result = await ed.previewAssistant(currentOp);
        if (!result) {
          applyReady = false; apply.disabled = true;
          info.textContent = t('Für diese Auswahl ist die Operation nicht anwendbar.'); if (preview) ed.outlinePreview = null;
          preview = null; return;
        }
        applyReady = true;
        preview = {
          subs: result.subs, holes: [], hover: -1,
          excluded: result.excluded,
          removed: [], original: [], markers: [],
          accentResult: true,
          pick: () => {}, move: () => {}, cancel: () => dlg.close(),
        };
        ed.outlinePreview = preview;
        info.textContent = currentOp === 'union' ? t('Vereinen: alle Konturen verschmelzen zu einem Ergebnis.')
          : currentOp === 'subtractAB' ? t('Abziehen A−B: vom zuerst gewählten Objekt werden alle anderen abgezogen.')
          : currentOp === 'subtractBA' ? t('Abziehen B−A: vom zweiten gewählten Objekt werden alle anderen abgezogen.')
          : t('Schnittmenge: nur der gemeinsame Bereich bleibt erhalten.');
        ed.redraw();
        apply.disabled = !applyReady;
      } catch (error) {
        applyReady = false; info.textContent = error instanceof Error ? error.message : String(error);
        apply.disabled = true;
        if (preview) ed.outlinePreview = null;
        preview = null;
      }
    };

    const setOp = (op: Op) => {
      currentOp = op;
      opButtons.forEach((b) => b.el.classList.toggle('active', b.op === op));
      void refresh();
    };

    ([
      { op: 'union', icon: 'boolUnion', caption: t('Vereinen · A oder B'), hint: t('Vereinen: alle Konturen verschmelzen zu einem Ergebnis.') },
      { op: 'intersect', icon: 'boolIntersect', caption: t('Schnittmenge · A und B'), hint: t('Schnittmenge: nur der gemeinsame Bereich bleibt erhalten.') },
      { op: 'subtractAB', icon: 'boolSubAB', caption: t('Abziehen · A−B'), hint: t('Abziehen A−B: vom zuerst gewählten Objekt werden alle anderen abgezogen.') },
      { op: 'subtractBA', icon: 'boolSubBA', caption: t('Abziehen · B−A'), hint: t('Abziehen B−A: vom zweiten gewählten Objekt werden alle anderen abgezogen.') },
    ] as { op: Op; icon: string; caption: string; hint: string }[]).forEach(({ op, icon, caption, hint }) => {
      const el = h('button', { class: 'btn shape-builder-op', type: 'button', 'data-op': op, title: hint, 'aria-label': caption, icon, onmouseenter: () => setOp(op), onclick: () => setOp(op) }, h('small', {}, caption));
      opButtons.push({ el, op });
      ops.append(el);
    });
    const resetBtn = h('button', { class: 'btn shape-builder-op', type: 'button', 'data-op': 'reset', title: t('Vorschau zurücksetzen'), 'aria-label': t('Zurücksetzen'), icon: 'refresh', onclick: () => { if (preview) { ed.outlinePreview = null; preview = null; } info.textContent = t('Originale werden unverändert gezeigt.'); opButtons.forEach((b) => b.el.classList.remove('active')); apply.disabled = true; } }, h('small', {}, t('Zurücksetzen')));
    opButtons.push({ el: resetBtn, op: 'reset' });
    ops.append(resetBtn);

    const apply = h('button', { class: 'btn primary' }, t('Übernehmen'));
    apply.disabled = true;
    apply.addEventListener('click', () => {
      if (apply.disabled || applying) return;
      applying = true; apply.disabled = true;
      try {
        void ed.applyAssistant(currentOp, { keepOriginals: keep.checked, noLaserOriginals: noLaser.checked }).then((ok) => {
          if (ok) dlg.close();
          else { applying = false; apply.disabled = !applyReady; info.textContent = t('Auswahl geprüft, keine Änderungen vorgenommen.'); }
        });
      } catch (error) {
        applying = false; apply.disabled = false;
        info.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    dlg.append(
      title,
      h('p', { class: 'note' }, t('Die Auswahl wird live als Vorschau gezeigt. Bei Übernehmen wird ein einziger Undo-Schritt erzeugt.')),
      ops,
      h('div', { class: 'form' },
        h('label', { for: keep.id }, t('Originale behalten')), keep,
        h('label', { for: noLaser.id }, t('Behaltene Originale auf „Nicht lasern“ setzen')), noLaser),
      enabledNote,
      info,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        apply));

    const changed = (what: string) => { if (!applying && !disposed && (what === 'doc' || what === 'sel' || what === 'tool')) { dlg.close(); ed.hint = t('Auswahl oder Quelle geändert. Formerstellung erneut öffnen.'); } };
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelPreview = true;
      ed.off(changed);
      disposeWindow();
      clearTimeout(busyTimer);
      if (ed.outlinePreview === preview) ed.outlinePreview = null;
      ed.redraw();
      open.delete(ed); dlg.remove();
    };
    dlg.addEventListener('close', cleanup);
    dlg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); dlg.close(); } });

    document.body.append(dlg); dlg.show(); attached = true;
    clearTimeout(busyTimer);
    ed.on(changed);
    disposeWindow = movableToolWindow(dlg, title, () => {});
    setOp('union');
  } catch (error) {
    ed.hint = error instanceof Error ? error.message : String(error);
    ed.emit('tool');
  } finally {
    clearTimeout(busyTimer);
    if (!attached) open.delete(ed);
  }
}
