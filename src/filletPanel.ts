// Bewegliches Werkzeugfenster für das Kanten-Werkzeug: Modus, Wert, Angebot, Kantensätze.
import { CornerMode, CornerSet, Obj } from './model';
import { h, numInput, setVal } from './dom';
import { dec, t, tn } from './i18n';
import { movableToolWindow } from './toolWindow';
import type { Editor } from './editor';

const MODES: { mode: CornerMode; icon: string }[] = [
  { mode: 'round', icon: 'filletRound' },
  { mode: 'inverse', icon: 'filletInverse' },
  { mode: 'chamfer', icon: 'filletChamfer' },
];

const modeName = (m: CornerMode) =>
  m === 'round' ? t('Runden') : m === 'inverse' ? t('Innen runden') : t('Fasen');

function setLabel(s: CornerSet): string {
  const what = s.rectCorner !== undefined
    ? t('Rechteck-Ecke {n}', { n: String(s.rectCorner + 1) })
    : s.extended
      ? t('Verlängerung')
      : t('Ecke');
  const op = s.mode === 'round'
    ? t('Runden {r} mm', { r: dec(String(s.r)) })
    : s.mode === 'inverse'
      ? t('Innen runden {r} mm', { r: dec(String(s.r)) })
      : t('Fasen {r} mm', { r: dec(String(s.r)) });
  return `${op} · ${what}`;
}

export function mountFilletPanel(ed: Editor) {
  const status = h('div', { class: 'fillet-status note', role: 'status', 'aria-live': 'polite' });
  const offerBox = h('div', { class: 'fillet-offer', hidden: true });
  const offerText = h('div', { class: 'note' });
  const applyBtn = h('button', { class: 'btn primary', onclick: () => ed.confirmFillet() }, t('Anwenden (Enter)'));
  const setsBox = h('div', { class: 'fillet-sets' });
  const setsHead = h('div', { class: 'fillet-sets-head' });
  const valueInput = numInput('small', (v) => {
    if (v > 0) {
      ed.filletR = v;
      ed.refreshFilletPreview();
    }
  }, t('Wert (mm)')) as HTMLInputElement;
  valueInput.style.width = '64px';
  const modeBtns = MODES.map(({ mode, icon }) => {
    const el = h('button', {
      class: 'btn shape-builder-op', type: 'button', title: modeName(mode), 'aria-label': modeName(mode), icon,
      onclick: () => { ed.filletMode = mode; ed.refreshFilletPreview(); ed.emit('tool'); },
    }, h('small', {}, modeName(mode)));
    el.dataset.mode = mode;
    return el;
  });
  const modesBox = h('div', { class: 'shape-builder-ops', role: 'group', 'aria-label': t('Modus wählen') }, ...modeBtns);
  const destructive = h('input', { type: 'checkbox', id: 'fillet-destructive', onchange: () => { ed.filletDestructive = (destructive as HTMLInputElement).checked; } }) as HTMLInputElement;
  const newBtn = h('button', {
    class: 'btn small', hidden: true, onclick: () => {
      ed.filletEditId = null;
      ed.filletPicks = [];
      ed.filletTarget = null;
      ed.filletOffer = null;
      ed.filletPreview = null;
      ed.hint = t('Kanten: zwei Kanten anklicken, Runden/Innenrunden/Fasen mit Vorschau. Enter übernimmt, Esc bricht ab.');
      ed.emit('tool');
      ed.redraw();
    },
  }, t('Neuer Satz'));
  const finish = () => ed.setTool('select');
  const title = h('h3', {}, t('Kanten verrunden / fasen'));
  title.id = 'fillet-title';
  const dlg = h('dialog', { class: 'fillet-dialog outline-tool-window', 'aria-labelledby': 'fillet-title' },
    title,
    h('div', { class: 'fillet-head-row' },
      newBtn,
      h('button', { class: 'btn small', title: t('Schließen (Esc)'), onclick: finish }, '×'),
    ),
    modesBox,
    h('div', { class: 'form' }, h('label', {}, t('Wert (mm)')), valueInput),
    h('div', { class: 'form' },
      h('label', { for: 'fillet-destructive' }, t('Destruktiv anwenden')),
      destructive,
    ),
    status,
    offerBox,
    h('div', { class: 'fillet-actions' }, applyBtn),
    setsHead,
    setsBox,
    h('div', { class: 'fillet-foot note' }, t('R / F / I: Modus · Enter: anwenden · Esc: zurück')),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: finish }, t('Fertig'))),
  );
  offerBox.append(
    offerText,
    h('div', { class: 'fillet-actions' },
      h('button', { class: 'btn small', onclick: () => ed.declineFilletOffer() }, t('Ablehnen (Esc)')),
      h('button', { class: 'btn small primary', onclick: () => ed.acceptFilletOffer() }, t('Annehmen (Enter)')),
    ),
  );

  let shown = false;
  let disposeWindow = () => {};

  function render() {
    const on = ed.tool === 'fillet';
    if (on && !shown) {
      dlg.show();
      shown = true;
      disposeWindow = movableToolWindow(dlg, title, () => {});
    } else if (!on && shown) {
      disposeWindow();
      disposeWindow = () => {};
      if (dlg.open) dlg.close();
      shown = false;
    }
    if (!on) return;
    for (const b of modeBtns) b.classList.toggle('active', b.dataset.mode === ed.filletMode);
    setVal(valueInput, dec(String(ed.filletR)));
    destructive.checked = ed.filletDestructive;
    const n = ed.filletPicks.length;
    status.textContent = ed.filletEditId !== null
      ? t('Satz wird geändert: Wert/Modus anpassen, Enter ersetzt den Satz. Kantenpaar neu wählen möglich.')
      : ed.filletOffer
        ? t('Angebot: Enden verlängern, schließen und verrunden?')
        : ed.filletTarget
          ? t('Paar bereit — Enter übernimmt, danach geht es ohne Neuauswahl weiter.')
          : n === 0
            ? t('Kanten: zwei Kanten anklicken, Runden/Innenrunden/Fasen mit Vorschau. Enter übernimmt, Esc bricht ab.')
            : t('Kanten: jetzt die zweite Kante anklicken. Esc hebt die Wahl auf.');
    offerBox.hidden = !ed.filletOffer;
    if (ed.filletOffer) {
      offerText.textContent = t('Die Kanten treffen sich nicht. Bis zum Schnittpunkt verlängern, schließen und verrunden/fasen?');
    }
    newBtn.hidden = ed.filletEditId === null;
    // Sätze: vom Arbeitsobjekt, sonst alle. Verwaiste Verweise (Objekt z. B. durch
    // Boolesche OP gelöscht) ausblenden statt Geistersätze zu zeigen.
    const live = ed.allFilletSets();
    const liveObjs = new Set(live.map(({ obj }) => obj));
    if (ed.filletEditId !== null && !live.some(({ set }) => set.id === ed.filletEditId)) {
      ed.filletEditId = null;
    }
    let groups: { obj: Obj; sets: CornerSet[] }[] = [];
    const pickObj = ed.filletPicks[0]?.obj;
    const focus = (pickObj && liveObjs.has(pickObj))
      ? pickObj
      : (ed.filletListObj && liveObjs.has(ed.filletListObj) ? ed.filletListObj : null);
    if (focus) {
      const sets = ed.filletSetsOf(focus);
      if (sets.length) groups = [{ obj: focus, sets }];
    }
    if (!groups.length) {
      const byObj = new Map<Obj, CornerSet[]>();
      for (const { obj, set } of live) {
        const arr = byObj.get(obj);
        if (arr) arr.push(set);
        else byObj.set(obj, [set]);
      }
      groups = [...byObj].map(([obj, sets]) => ({ obj, sets }));
    }
    setsHead.textContent = groups.length
      ? tn('Kantensatz', 'Kantensätze', groups.reduce((a, g) => a + g.sets.length, 0))
      : t('Noch keine Kantensätze.');
    setsBox.replaceChildren(...groups.flatMap(({ obj, sets }) => sets.map((set) => {
      const row = h('div', { class: 'fillet-set' },
        h('span', { class: 'fillet-set-label', title: `${setLabel(set)} · ${t('Ebene')} ${obj.layer}` }, setLabel(set), groups.length > 1 ? h('span', { class: 'muted' }, ` · ${t('Ebene')} ${obj.layer}`) : null),
        h('button', { class: 'btn small', title: t('Satz ändern (Wert/Modus anpassen, Enter ersetzt)'), onclick: () => ed.beginEditFilletSet(set.id) }, t('Ändern')),
        h('button', { class: 'btn small', title: t('Satz einbrennen (Geometrie behalten, nicht mehr änderbar)'), onclick: () => ed.bakeFilletSet(set.id) }, t('Einbrennen')),
        h('button', { class: 'btn small', title: t('Satz löschen (nur dieser)'), onclick: () => ed.deleteFilletSet(set.id) }, '×'),
      );
      if (set.id === ed.filletEditId) row.classList.add('on');
      return row;
    })));
  }
  // Esc schließt den Dialog nativ — bei aktivem Werkzeug offen halten, die
  // Schritt-Logik (Angebot/Auswahl/Werkzeug) bleibt beim Editor.
  dlg.addEventListener('cancel', (e) => {
    if (ed.tool === 'fillet') e.preventDefault();
  });
  dlg.addEventListener('close', () => {
    if (!shown) return;
    disposeWindow();
    disposeWindow = () => {};
    shown = false;
  });
  ed.on((w) => {
    if (w === 'tool' || w === 'doc' || w === 'sel') render();
  });
  document.body.append(dlg);
  render();
}
