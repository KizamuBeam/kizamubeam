// Modelles Panel für das Kanten-Werkzeug: Modus, Wert, Angebot, Kantensätze.
import { CornerMode, CornerSet, layerLabel, Obj } from './model';
import { h, numInput, setVal } from './dom';
import { dec, t, tn } from './i18n';
import type { Editor } from './editor';

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
  const status = h('div', { class: 'fillet-status note' });
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
  const radios = (['round', 'inverse', 'chamfer'] as CornerMode[]).map((m) => {
    const inp = h('input', { type: 'radio', name: 'fillet-mode', value: m, onchange: () => { ed.filletMode = m; ed.refreshFilletPreview(); ed.emit('tool'); } }) as HTMLInputElement;
    inp.dataset.mode = m;
    return h('label', { class: 'check', title: modeName(m) }, inp, modeName(m));
  });
  const newBtn = h('button', {
    class: 'btn small', hidden: true, onclick: () => {
      ed.filletEditId = null;
      ed.filletPicks = [];
      ed.filletTarget = null;
      ed.refreshFilletPreview();
      ed.hint = t('Kanten: zwei Kanten anklicken, Runden/Innenrunden/Fasen mit Vorschau. Enter übernimmt, Esc bricht ab.');
      ed.emit('tool');
      ed.redraw();
    },
  }, t('Neuer Satz'));
  const root = h('div', { class: 'fillet-panel', hidden: true },
    h('div', { class: 'fillet-head' },
      h('strong', {}, t('Kanten verrunden / fasen')),
      newBtn,
      h('button', { class: 'btn small', title: t('Schließen (Esc)'), onclick: () => ed.setTool('select') }, '×'),
    ),
    h('div', { class: 'fillet-modes' }, ...radios),
    h('div', { class: 'form' }, h('label', {}, t('Wert (mm)')), valueInput),
    status,
    offerBox,
    h('div', { class: 'fillet-actions' }, applyBtn),
    setsHead,
    setsBox,
    h('div', { class: 'fillet-foot note' }, t('R / F / I: Modus · Enter: anwenden · Esc: zurück')),
  );
  offerBox.append(
    offerText,
    h('div', { class: 'fillet-actions' },
      h('button', { class: 'btn small', onclick: () => ed.declineFilletOffer() }, t('Ablehnen (Esc)')),
      h('button', { class: 'btn small primary', onclick: () => ed.acceptFilletOffer() }, t('Annehmen (Enter)')),
    ),
  );

  const objName = (o: Obj) => `${t('Ebene')} ${layerLabel(o.layer)}`;

  function render() {
    const on = ed.tool === 'fillet';
    root.hidden = !on;
    if (!on) return;
    for (const lab of radios) {
      const inp = lab.querySelector('input') as HTMLInputElement;
      inp.checked = inp.dataset.mode === ed.filletMode;
    }
    setVal(valueInput, dec(String(ed.filletR)));
    const n = ed.filletPicks.length;
    status.textContent = ed.filletEditId !== null
      ? t('Satz wird geändert: Kantenpaar erneut wählen, Wert prüfen, Enter ersetzt den Satz.')
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
    // Sätze: vom Arbeitsobjekt, sonst alle
    let groups: { obj: Obj; sets: CornerSet[] }[] = [];
    const focus = ed.filletPicks[0]?.obj ?? ed.filletListObj;
    if (focus) {
      const sets = ed.filletSetsOf(focus);
      if (sets.length) groups = [{ obj: focus, sets }];
    }
    if (!groups.length) {
      const byObj = new Map<Obj, CornerSet[]>();
      for (const { obj, set } of ed.allFilletSets()) {
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
        h('span', { class: 'fillet-set-label', title: `${setLabel(set)} · ${objName(obj)}` }, setLabel(set), groups.length > 1 ? h('span', { class: 'muted' }, ` · ${objName(obj)}`) : null),
        h('button', { class: 'btn small', title: t('Satz ändern (Kanten neu wählen)'), onclick: () => ed.beginEditFilletSet(set.id) }, t('Ändern')),
        h('button', { class: 'btn small', title: t('Satz löschen (nur dieser)'), onclick: () => ed.deleteFilletSet(set.id) }, '×'),
      );
      if (set.id === ed.filletEditId) row.classList.add('on');
      return row;
    })));
  }
  ed.on((w) => {
    if (w === 'tool' || w === 'doc' || w === 'sel') render();
  });
  document.body.append(root);
  render();
}
