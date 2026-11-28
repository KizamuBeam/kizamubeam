// PDF and Illustrator (.ai) export with options (issue #234): scope, page size, real text, images, colours, line
// weight, fills, registration marks, CutContour, metadata and Illustrator artboards. The dialog remembers the last
// settings (Settings → Files). buildPdfBytes is also used by the MCP tool save_document.
import type { Editor } from './editor';
import { h } from './dom';
import { dec, t } from './i18n';
import { NOTE_KEYS, Obj, Pt, SubPath } from './model';
import { NOTE_LABELS } from './editor/notes';
import { findMarks, markPlaces, markSubs } from './printcut';
import { bytesToBase64, exportHint, exportItems, exportName, layerInfos, saveDataUrl } from './files';
import { buildPdf, ExportItem, ExportPage, itemsBounds, PdfGroup, PdfPageSize } from './vecexport';
import { cleanPdfOptions, lineWidthMm, loadPdfOptions, PAPER_MM, PDF_EXPORT_DEFAULTS, PdfExportOptions, resetPdfOptions, savePdfOptions } from './pdfExportOptions';

export type PdfFormat = 'pdf' | 'ai';

/** Registration mark size and distance to the design in mm (same defaults as the Print and Cut assistant) */
const MARK_SIZE = 6,
  MARK_MARGIN = 4;

const shiftSubs = (subs: SubPath[], c: Pt): SubPath[] =>
  subs.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      x: n.x + c.x,
      y: n.y + c.y,
      ...(n.cin ? { cin: { x: n.cin.x + c.x, y: n.cin.y + c.y } } : {}),
      ...(n.cout ? { cout: { x: n.cout.x + c.x, y: n.cout.y + c.y } } : {}),
    })),
  }));

/** Three registration marks around the items (L shape), like the Print and Cut assistant places them */
function markItems(items: ExportItem[], bed: { w: number; h: number }, clampToBed: boolean): ExportItem[] {
  const box = itemsBounds(items);
  if (!box) return [];
  const o = MARK_MARGIN + MARK_SIZE / 2;
  const pts = clampToBed
    ? markPlaces(box, MARK_SIZE, MARK_MARGIN, bed)
    : [
        { x: box.x - o, y: box.y - o },
        { x: box.x + box.w + o, y: box.y - o },
        { x: box.x - o, y: box.y + box.h + o },
      ];
  return pts.map((c) => ({ kind: 'path', subs: shiftSubs(markSubs(MARK_SIZE), c), layer: 0, group: 'marks', fill: false, color: [0, 0, 0], width: 0.3 }));
}

function guideItems(ed: Editor): ExportItem[] {
  const { w, h: bh } = ed.doc.bed;
  return (ed.doc.guides ?? []).map((g) => ({
    kind: 'path',
    subs: [{ closed: false, nodes: g.axis === 'y' ? [{ x: 0, y: g.v }, { x: w, y: g.v }] : [{ x: g.v, y: 0 }, { x: g.v, y: bh }] }],
    layer: 0,
    group: 'guides',
    noBounds: true,
    fill: false,
    color: [0, 150, 255],
    width: 0.1,
  }));
}

function noteItem(ed: Editor): ExportItem | null {
  const notes = ed.doc.notes;
  if (!notes) return null;
  const lines: string[] = [];
  for (const k of NOTE_KEYS) {
    const v = notes[k]?.trim();
    if (!v) continue;
    lines.push(`${NOTE_LABELS()[k]}:`, ...v.split(/\r?\n/).map((l) => '  ' + l));
  }
  return lines.length ? { kind: 'note', layer: 0, group: 'notes', x: 5, y: 5, size: 3.5, lines } : null;
}

/**
 * PDF bytes for the project with these options (missing ones use the defaults). currentOnly is the older way to say
 * scope "page". .ai places all pages side by side on one page as artboard frames (unless artboards is off).
 */
export async function buildPdfBytes(
  ed: Editor,
  opts: Partial<PdfExportOptions> & { currentOnly?: boolean } = {},
  format: PdfFormat = 'pdf',
): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const o = cleanPdfOptions({ ...opts, scope: opts.currentOnly ? 'page' : opts.scope });
  const notes = new Set<string>();
  const doc = ed.doc;
  let list: { name: string; objs: Obj[] }[];
  if (o.scope === 'selection') {
    if (ed.sel.length) list = [{ name: doc.pages[doc.page].name, objs: ed.sel }];
    else {
      notes.add(t('Nichts ausgewählt: Die aktuelle Seite wurde exportiert.'));
      list = [doc.pages[doc.page]];
    }
  } else list = o.scope === 'page' ? [doc.pages[doc.page]] : doc.pages;

  const itemOpts = { images: o.images, imageDpi: o.imageDpi, imageSource: o.imageSource, realText: o.realText, fills: o.fills, hiddenLayers: o.hiddenLayers, nonOutput: o.nonOutput };
  const pages: ExportPage[] = [];
  for (const [i, p] of list.entries()) {
    const items = await exportItems(ed, p.objs, true, notes, itemOpts);
    if (o.marks && !findMarks(p.objs).length) items.push(...markItems(items, doc.bed, o.pageSize === 'bed'));
    if (o.guides) items.push(...guideItems(ed));
    if (o.notes && i === 0) {
      const n = noteItem(ed);
      if (n) items.push(n);
    }
    pages.push({ name: p.name, items });
  }

  const layersOff: number[] = [];
  for (const L of Object.values(doc.layers)) if ((o.hiddenLayers && !L.show) || (o.nonOutput === 'off' && !L.output)) layersOff.push(L.index);
  const groups: PdfGroup[] = [
    { id: 'marks', name: t('Passermarken') },
    { id: 'guides', name: t('Hilfslinien'), print: false },
    { id: 'notes', name: t('Notizen'), print: false },
    { id: 'frames', name: t('Zeichenflächen'), print: false },
  ];
  let pageSize: PdfPageSize = { kind: 'bed' };
  if (o.pageSize === 'content') pageSize = { kind: 'content', margin: o.margin };
  else if (o.pageSize !== 'bed') {
    const paper = PAPER_MM[o.pageSize];
    pageSize = { kind: 'paper', ...paper };
    const long = Math.max(paper.w, paper.h),
      short = Math.min(paper.w, paper.h);
    for (const p of pages) {
      const b = itemsBounds(p.items);
      if (b && (Math.max(b.w, b.h) > long + 1e-6 || Math.min(b.w, b.h) > short + 1e-6)) notes.add(t('Der Inhalt ist größer als das Papierformat und ragt über den Rand.'));
    }
  }
  const bytes = buildPdf(pages, {
    bed: doc.bed,
    layers: layerInfos(ed),
    title: o.title.trim() || ed.tab?.name || 'KizamuBeam',
    author: o.author,
    subject: o.subject,
    keywords: o.keywords,
    stroke: lineWidthMm(o),
    colors: o.colors,
    cutContour: o.cutContour,
    pageSize,
    layersOff,
    groups,
    artboards: format === 'ai' && o.artboards && pages.length > 1 ? { gap: 20, group: 'frames' } : undefined,
    realText: o.realText,
    onTextFallback: (reason, font) =>
      notes.add(
        reason === 'license'
          ? t('Die Schrift „{font}“ darf laut Lizenz nicht eingebettet werden; ihre Texte wurden zu Umrissen.', { font })
          : t('Die Schrift „{font}“ lässt sich nicht einbetten; ihre Texte wurden zu Umrissen.', { font }),
      ),
  });
  return { bytes, notes: [...notes] };
}

/** File → Export as PDF / Illustrator: show the options, then save */
export function exportPdf(ed: Editor, format: PdfFormat = 'pdf') {
  openPdfExportDialog(ed, format, async (o) => {
    savePdfOptions(o);
    const { bytes, notes } = await buildPdfBytes(ed, o, format);
    const url = 'data:application/pdf;base64,' + bytesToBase64(bytes);
    const ok = await saveDataUrl(exportName(ed, format), format === 'ai' ? 'Adobe Illustrator' : 'PDF', format, url);
    if (ok) exportHint(ed, format === 'ai' ? 'AI' : 'PDF', notes);
  });
}

type Choice<T extends string> = [T, string][];

function openPdfExportDialog(ed: Editor, format: PdfFormat, run: (o: PdfExportOptions) => Promise<void>) {
  let st: PdfExportOptions = loadPdfOptions();
  const refresh: (() => void)[] = [];
  let n = 0;

  const select = <K extends keyof PdfExportOptions>(key: K, choices: () => Choice<PdfExportOptions[K] & string>) => {
    const el = h('select', {
      id: `pdfx-${n++}`,
      onchange: () => {
        (st[key] as string) = el.value;
        update();
      },
    });
    refresh.push(() => {
      el.replaceChildren(...choices().map(([v, label]) => h('option', { value: v }, label)));
      el.value = st[key] as string;
    });
    return el;
  };
  const check = <K extends keyof PdfExportOptions>(key: K, label: string, hint?: string) => {
    const box = h('input', { type: 'checkbox', onchange: () => (((st[key] as boolean) = box.checked), update()) }) as HTMLInputElement;
    refresh.push(() => (box.checked = st[key] as boolean));
    return h('label', { class: 'pdfx-check', title: hint }, box, ' ' + label);
  };
  const number = <K extends keyof PdfExportOptions>(key: K, min: number, max: number, step: number) => {
    const el = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), id: `pdfx-${n++}` }) as HTMLInputElement;
    el.onchange = () => {
      const v = Number(el.value.replace(',', '.'));
      if (Number.isFinite(v)) (st[key] as number) = Math.min(max, Math.max(min, v));
      update();
    };
    refresh.push(() => (el.value = String(st[key])));
    return el;
  };
  const text = <K extends keyof PdfExportOptions>(key: K, placeholder = '') => {
    const el = h('input', { type: 'text', placeholder, id: `pdfx-${n++}`, oninput: () => ((st[key] as string) = el.value) }) as HTMLInputElement;
    refresh.push(() => (el.value = st[key] as string));
    return el;
  };
  const row = (label: string, control: HTMLElement, hint?: string) => [h('label', { for: control.id, title: hint }, label), control];
  const group = (title: string, ...children: (Node | Node[])[]) => h('fieldset', { class: 'pdfx-group' }, h('legend', {}, title), ...children.flat());

  const margin = number('margin', 0, 500, 1);
  const marginRow = row(t('Rand (mm)'), margin);
  const dpi = number('imageDpi', 0, 4800, 50);
  const width = number('lineWidth', 0.001, 10, 0.01);
  const widthRow = row(t('Linienstärke (mm)'), width);
  const imageSrc = select('imageSource', () => [
    ['original', t('Original')],
    ['laser', t('So, wie es gelasert wird')],
  ]);
  const pages = ed.doc.pages.length;
  const hasSel = ed.sel.length > 0;

  const scope = select('scope', () => [
    ['all', pages > 1 ? t('Alle Seiten ({n})', { n: pages }) : t('Alle Seiten')],
    ['page', t('Aktuelle Seite')],
    ['selection', hasSel ? t('Nur Auswahl') : t('Nur Auswahl (nichts ausgewählt)')],
  ]);
  const basic = group(
    t('Grundeinstellungen'),
    h('div', { class: 'form' },
      ...row(t('Umfang'), scope),
      ...row(t('Layer ohne Ausgabe'), select('nonOutput', () => [
        ['on', t('Mitnehmen')],
        ['off', t('Mitnehmen, ausgeschaltet')],
        ['omit', t('Weglassen')],
      ])),
      ...row(t('Seitengröße'), select('pageSize', () => [
        ['bed', t('Bettgröße ({w} × {h} mm)', { w: dec(String(ed.doc.bed.w)), h: dec(String(ed.doc.bed.h)) })],
        ['content', t('Auf Inhalt zugeschnitten')],
        ['a4', 'A4'],
        ['a3', 'A3'],
        ['letter', 'US Letter'],
      ]), t('A4, A3 und Letter drehen sich passend zum Inhalt; der Inhalt liegt mittig.')),
      ...marginRow,
      ...row(t('Bilder'), select('images', () => [
        ['embed', t('Einbetten')],
        ['frame', t('Nur Rahmen')],
        ['omit', t('Weglassen')],
      ])),
      ...row(t('Bildquelle'), imageSrc),
      ...row(t('Höchstens (dpi, 0 = unverändert)'), dpi),
    ),
    check('realText', t('Text als Text exportieren (Schrift einbetten)'), t('Text bleibt markier- und durchsuchbar und lässt sich in Illustrator, Inkscape oder Affinity bearbeiten, wenn die Schrift dort installiert ist. Aus: Text wird zu Umrissen (sicher für Laser-Dienste).')),
    check('hiddenLayers', t('Ausgeblendete Layer mitnehmen (in der PDF ausgeschaltet)')),
    check('guides', t('Hilfslinien mitnehmen (wird nicht gedruckt)')),
    check('notes', t('Projekt-Notizen mitnehmen (wird nicht gedruckt)')),
  );
  const advanced = group(
    t('Erweitert'),
    h('div', { class: 'form' },
      ...row(t('Farben'), select('colors', () => [
        ['layer', t('Layerfarben')],
        ['black', t('Alles schwarz')],
        ['operation', t('Nach Bearbeitung (Schneiden rot, Ritzen blau, Gravieren schwarz)')],
      ])),
      ...row(t('Linien'), select('lineWeight', () => [
        ['hairline', t('Haarlinie (0,01 mm)')],
        ['visible', t('Sichtbar (0,1 mm)')],
        ['custom', t('Eigene Stärke')],
      ]), t('Viele Laser- und Plotter-Dienste verlangen Haarlinien für Schnittlinien.')),
      ...widthRow,
      ...row(t('Füllungen'), select('fills', () => [
        ['layer', t('Wie im Layer')],
        ['outline', t('Alles als Kontur')],
      ])),
    ),
  );
  const pnc = group(
    t('Print and Cut'),
    check('marks', t('Passermarken ausgeben'), t('Drei Marken um das Design wie im Print-and-Cut-Assistenten; vorhandene Marken bleiben, wie sie sind.')),
    check('cutContour', t('Schnittlinien als Schmuckfarbe „CutContour“'), t('Für Schneideplotter und Druckdienste, die Konturen an dieser Farbe erkennen.')),
  );
  const meta = group(
    t('Dokument'),
    h('div', { class: 'form' },
      ...row(t('Titel'), text('title', ed.tab?.name || 'KizamuBeam')),
      ...row(t('Autor'), text('author')),
      ...row(t('Thema'), text('subject')),
      ...row(t('Stichwörter'), text('keywords')),
    ),
  );
  const ai =
    format === 'ai'
      ? group(
          t('Illustrator'),
          check('artboards', t('Alle Seiten nebeneinander als Zeichenflächen'), t('Illustrator öffnet von einer mehrseitigen Datei nur die erste Seite.')),
          h('div', { class: 'note' }, t('In Illustrator: Objekt → Zeichenflächen → In Zeichenflächen konvertieren, nachdem die Rahmen der Ebene „Zeichenflächen“ ausgewählt sind.')),
        )
      : null;

  function update() {
    for (const r of refresh) r();
    const content = st.pageSize === 'content';
    for (const el of marginRow) el.style.display = content ? '' : 'none';
    for (const el of widthRow) el.style.display = st.lineWeight === 'custom' ? '' : 'none';
    const embed = st.images === 'embed';
    imageSrc.disabled = !embed;
    dpi.disabled = !embed;
  }

  const busy = h('span', { class: 'muted' });
  const ok = h('button', { class: 'btn primary' }, t('Exportieren')) as HTMLButtonElement;
  ok.onclick = async () => {
    ok.disabled = true;
    busy.textContent = t('Wird exportiert …');
    try {
      await run(st);
      dlg.close();
    } finally {
      ok.disabled = false;
      busy.textContent = '';
    }
  };
  const dlg = h(
    'dialog',
    { class: 'pdf-export-dialog' },
    h('h3', {}, format === 'ai' ? t('Als Illustrator-Datei (AI) exportieren') : t('Als PDF exportieren')),
    basic,
    advanced,
    pnc,
    meta,
    ai,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        style: 'margin-right: auto',
        title: t('Alle Einstellungen auf die Standardwerte setzen und die gemerkten vergessen'),
        onclick: () => {
          resetPdfOptions();
          st = { ...PDF_EXPORT_DEFAULTS, title: st.title, subject: st.subject, keywords: st.keywords };
          update();
        },
      }, t('Zurücksetzen')),
      busy,
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      ok,
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  update();
  dlg.showModal();
}
