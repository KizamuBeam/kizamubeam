// Pfadinseln trennen als modelloses Werkzeugfenster: Vorschau auf der
// Arbeitsfläche (Canvas), Inselauswahl per Klick oder Liste.
import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import { h } from './dom';
import { t } from './i18n';
import { IDENT, type Mat, type Obj, type SubPath } from './model';
import { transformSubs } from './importers';
import { flattenSub, type Path } from './clip';
import { movableToolWindow } from './toolWindow';
import { pathIslandPlan, type IslandOptions } from './pathIslands';

const open = new WeakSet<Editor>();

interface IslandGroup {
  leaf: Obj;
  m: Mat;
  group: SubPath[];
  world: SubPath[];
  rings: Path[];
  box: { x0: number; y0: number; x1: number; y1: number };
  area: number;
  pi: number;
}

const containsPoint = (rings: Path[], x: number, y: number): boolean => {
  const X = Math.round(x * 1000), Y = Math.round(y * 1000);
  let inside = false;
  for (const ring of rings) {
    let j = ring.length - 1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[j];
      if ((a.Y > Y) !== (b.Y > Y) && X < ((b.X - a.X) * (Y - a.Y)) / (b.Y - a.Y) + a.X) inside = !inside;
      j = i;
    }
  }
  return inside;
};

export function openPathIslandsDialog(ed: Editor): void {
  if (open.has(ed) || ed.outlinePreview || document.querySelector('dialog[open]')) return;
  if (ed.drag || ed.draft || ed.pickHandler) return;
  if (!ed.sel.length) { ed.hint = t('Zuerst Pfade auswählen.'); ed.emit('tool'); return; }
  open.add(ed);
  let attached = false, disposed = false, applying = false;
  try {
    const leaves = ed.selPathLeaves();
    if (!leaves.length) throw Error(t('Pfadinseln: bearbeitbare Pfade auswählen; Gruppen auflösen und parametrische Formen ausdrücklich umwandeln.'));
    const distance = h('input', { type: 'number', id: 'path-islands-distance', min: 0, max: 1000, step: 0.01, value: '0' });
    const closeGaps = h('input', { type: 'checkbox', id: 'path-islands-close' });
    const gap = h('input', { type: 'number', id: 'path-islands-gap', min: 0, max: 10, step: 0.001, value: '0.01', disabled: true });
    const preserve = h('input', { type: 'checkbox', id: 'path-islands-preserve', checked: true });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const apply = h('button', { class: 'btn primary' }, t('Anwenden'));
    const choices = h('div', { class: 'outline-choices' });
    const boxes: HTMLInputElement[] = [];
    const rows: HTMLLabelElement[] = [];
    const selected = new Set<number>();
    let activeIsland = -1;
    let groups: IslandGroup[] = [];
    let locked = 0;
    /** Categorical palette; red is reserved for invalid islands (excluded). */
    const ISLAND_COLORS = ['#ff8c1a', '#38bdf8', '#34d399', '#a78bfa', '#facc15', '#22d3ee', '#f472b6', '#60a5fa'];
    const islandColor = (i: number) => ISLAND_COLORS[i % ISLAND_COLORS.length];
    let options: IslandOptions = { distance: 0 };
    const title = h('h3', {}, t('Pfadinseln trennen'));
    const dlg = h('dialog', { class: 'path-islands-dialog outline-tool-window', 'aria-labelledby': 'path-islands-title' });
    title.id = 'path-islands-title';

    const rebuild = () => {
      const dist = distance.valueAsNumber, gapTol = gap.valueAsNumber;
      groups = []; locked = 0; selected.clear();
      highlightIsland(-1);
      if (!Number.isFinite(dist) || dist < 0 || dist > 1000) { info.textContent = t('Abstand muss zwischen 0 und 1000 mm liegen.'); return false; }
      if (closeGaps.checked && (!Number.isFinite(gapTol) || gapTol < 0 || gapTol > 10)) { info.textContent = t('Lücke muss zwischen 0 und 10 mm liegen.'); return false; }
      options = { distance: dist, closeGaps: closeGaps.checked, gapTolerance: gapTol };
      for (const [leaf, m] of leaves) {
        const shape = leaf.shape;
        if (shape.kind !== 'path' || shape.mark) { locked++; continue; }
        let plan: { groups: SubPath[][]; preserved: SubPath[] };
        try {
          plan = pathIslandPlan(shape.subs, { ...options, matrix: m, preserveInvalid: false });
        } catch { locked++; continue; }
        for (let pi = 0; pi < plan.groups.length; pi++) {
          const group = plan.groups[pi];
          const world = transformSubs(group, m);
          const rings = world.map((sp) => flattenSub(sp, IDENT));
          const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
          for (const ring of rings) for (const p of ring) {
            box.x0 = Math.min(box.x0, p.X); box.y0 = Math.min(box.y0, p.Y);
            box.x1 = Math.max(box.x1, p.X); box.y1 = Math.max(box.y1, p.Y);
          }
          groups.push({ leaf, m, group, world, rings, box, pi, area: (box.x1 - box.x0) * (box.y1 - box.y0) });
        }
      }
      selected.clear();
      groups.forEach((_, i) => selected.add(i));
      highlightIsland(-1);
      return true;
    };

    const preview: OutlinePreview = {
      subs: [], holes: [], hover: -1, excluded: [],
      pick: (p) => {
        let best = -1, bestArea = Infinity;
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          if (!(g.area > 0) || p.x < g.box.x0 || p.x > g.box.x1 || p.y < g.box.y0 || p.y > g.box.y1) continue;
          if (containsPoint(g.rings, p.x, p.y) && g.area < bestArea) { best = i; bestArea = g.area; }
        }
        if (best >= 0) toggleIsland(best);
      },
      move: (p) => {
        let hover = -1, bestArea = Infinity;
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          if (!(g.area > 0) || p.x < g.box.x0 || p.x > g.box.x1 || p.y < g.box.y0 || p.y > g.box.y1) continue;
          if (containsPoint(g.rings, p.x, p.y) && g.area < bestArea) { hover = i; bestArea = g.area; }
        }
        if (preview.hover !== hover) { preview.hover = hover; ed.redraw(); }
      },
      cancel: () => dismiss(),
    };

    const refresh = () => {
      preview.subs = groups.filter((_, i) => selected.has(i)).flatMap((g) => g.world);
      preview.holes = groups.map((g) => g.world);
      preview.subGroups = groups.map((g, i) => ({ subs: g.world, color: islandColor(i), dim: !selected.has(i) }));
      preview.excluded = [];
      boxes.forEach((box, i) => { box.checked = selected.has(i); });
      const invalid = locked > 0 && !preserve.checked;
      apply.disabled = invalid || !selected.size;
      info.textContent = [
        t('{chosen}/{total} Inseln', { chosen: selected.size, total: groups.length }),
        locked ? t('{n} ungültig.', { n: locked }) : '',
        invalid ? t('Ohne Originale-behalten ist Anwenden bei ungültigen Inseln gesperrt.') : '',
      ].filter(Boolean).join(' ');
      ed.redraw();
    };

    const highlightIsland = (index: number, scroll = false) => {
      activeIsland = index;
      rows.forEach((row, i) => {
        row.classList.toggle('outline-choice-active', i === activeIsland);
        if (i === activeIsland) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      });
      if (scroll) rows[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const toggleIsland = (i: number) => {
      if (i < 0 || i >= groups.length) return;
      highlightIsland(i, true);
      if (selected.has(i)) selected.delete(i); else selected.add(i);
      refresh();
    };

    const rebuildChoices = () => {
      choices.replaceChildren(); boxes.length = 0; rows.length = 0;
      groups.forEach((_, i) => {
        const box = h('input', { type: 'checkbox', onchange: () => toggleIsland(i) });
        boxes.push(box);
        const row = h('label', { class: 'check', 'data-island-group': String(i), onclick: () => highlightIsland(i) },
          box, h('span', { class: 'island-swatch', style: `background:${islandColor(i)}` }), t('Insel {n}', { n: i + 1 }));
        rows.push(row); choices.append(row);
      });
      if (locked) {
        for (let k = 0; k < locked; k++) {
          const row = h('label', { class: 'check' },
            h('input', { type: 'checkbox', disabled: true }), t('Gesperrt'));
          choices.append(row);
        }
      }
    };

    const recompute = () => {
      preview.hover = -1;
      if (rebuild()) { rebuildChoices(); }
      refresh();
    };

    const applyNow = () => {
      if (apply.disabled) return;
      try {
        applying = true;
        // Auswahl nach Blatt gruppieren, globale Gruppenindizes in blattlokale übersetzen
        const order = new Map<Obj, number[]>();
        groups.forEach((g, i) => {
          if (!selected.has(i)) return;
          const list = order.get(g.leaf) ?? [];
          list.push(i);
          order.set(g.leaf, list);
        });
        for (const [leaf, global] of order) {
          const local: number[] = [];
          groups.forEach((g, i) => { if (g.leaf === leaf && global.includes(i)) local.push(g.pi); });
          ed.separateSelectedPathIslands([{ obj: leaf, indexes: local }],
            { ...options, preserveInvalid: preserve.checked });
        }
        dismiss();
      } catch (error) { applying = false; info.textContent = error instanceof Error ? error.message : String(error); }
    };

    dlg.append(title,
      h('p', { class: 'note' }, t('Inseln auf der Arbeitsfläche oder in der Liste wählen.')),
      h('div', { class: 'form' },
        h('label', { for: distance.id }, t('Abstand (mm)')), distance,
        h('label', { for: closeGaps.id }, t('Kleine Lücken ausdrücklich schließen')), closeGaps,
        h('label', { for: gap.id }, t('Lücke (mm)')), gap,
        h('label', { for: preserve.id }, t('Originale behalten')), preserve),
      h('p', { class: 'note' }, t('Abgewählte Inseln bleiben im Original.')),
      info,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => { groups.forEach((_, i) => selected.add(i)); refresh(); } }, t('Alle wählen')),
        h('button', { class: 'btn', onclick: () => { selected.clear(); refresh(); } }, t('Keine wählen'))),
      choices,
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dismiss() }, t('Abbrechen')), apply));
    apply.addEventListener('click', applyNow);
    for (const input of [distance, closeGaps, gap]) input.addEventListener('input', () => { gap.disabled = !closeGaps.checked; recompute(); });
    preserve.addEventListener('change', refresh);
    closeGaps.addEventListener('change', () => { gap.disabled = !closeGaps.checked; });

    const changed = (what: string) => {
      if (!applying && (what === 'doc' || what === 'sel' || what === 'tool')) {
        dismiss();
        ed.hint = t('Auswahl oder Quelle geändert. Pfadinseln erneut öffnen.');
      }
    };
    let disposeWindow = () => {};
    const leave = () => { preview.hover = -1; ed.redraw(); };
    // dlg.close() feuert den close-Event nicht überall zuverlässig
    // (beobachtet im Automations-Browser); cleanup ist idempotent.
    const dismiss = () => { try { dlg.close(); } catch { /* bereits zu */ } finally { cleanup(); } };
    const cleanup = () => {
      if (disposed) return;
      disposed = true; ed.off(changed); disposeWindow();
      ed.canvas.removeEventListener('pointerleave', leave);
      if (ed.outlinePreview === preview) ed.outlinePreview = null;
      ed.canvas.style.cursor = ed.tool === 'select' ? 'default' : 'crosshair';
      open.delete(ed); dlg.remove(); ed.redraw();
    };
    dlg.addEventListener('close', cleanup);
    dlg.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    });
    document.body.append(dlg); dlg.show(); attached = true;
    distance.focus({ preventScroll: true });
    ed.outlinePreview = preview; ed.on(changed);
    ed.canvas.addEventListener('pointerleave', leave);
    disposeWindow = movableToolWindow(dlg, title, () => {});
    rebuild(); rebuildChoices(); refresh();
  } catch (error) {
    ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool');
  } finally { if (!attached) open.delete(ed); }
}
