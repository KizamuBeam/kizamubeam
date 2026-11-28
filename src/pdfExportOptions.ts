// Options of the PDF/AI export dialog (File → Export as PDF / Illustrator): defaults, cleaning and the remembered
// last settings. No DOM, so the MCP server, the settings window and tests share it.

export type PdfScope = 'all' | 'page' | 'selection';
export type PdfPaper = 'bed' | 'content' | 'a4' | 'a3' | 'letter';

export interface PdfExportOptions {
  /** All pages, the current page, or only the selected objects (current page) */
  scope: PdfScope;
  /** Include hidden layers as PDF layers that are switched off */
  hiddenLayers: boolean;
  /** Layers with output switched off: as normal PDF layers, switched off, or left out */
  nonOutput: 'on' | 'off' | 'omit';
  /** Guides as a non-printing PDF layer */
  guides: boolean;
  /** Project notes as a non-printing PDF layer on the first page */
  notes: boolean;
  pageSize: PdfPaper;
  /** Margin in mm around the content (page size “content”) */
  margin: number;
  /** Keep text as text with the font embedded (otherwise outlines) */
  realText: boolean;
  images: 'embed' | 'omit' | 'frame';
  /** Highest image resolution in dpi, 0 = unchanged */
  imageDpi: number;
  /** The original image or the image as it is lasered (dithered at the layer's line interval) */
  imageSource: 'original' | 'laser';
  colors: 'layer' | 'black' | 'operation';
  lineWeight: 'hairline' | 'visible' | 'custom';
  /** Line width in mm for lineWeight “custom” */
  lineWidth: number;
  /** Fill layers filled, or everything as outline */
  fills: 'layer' | 'outline';
  /** Add registration marks around the design (Print and Cut) */
  marks: boolean;
  /** Cut lines in the spot colour “CutContour” */
  cutContour: boolean;
  /** Illustrator: all pages side by side on one page, with frames for Convert to Artboards */
  artboards: boolean;
  author: string;
  /** Per export only, never remembered */
  title: string;
  subject: string;
  keywords: string;
}

export const PDF_EXPORT_DEFAULTS: PdfExportOptions = {
  scope: 'all',
  hiddenLayers: false,
  nonOutput: 'on',
  guides: false,
  notes: false,
  pageSize: 'bed',
  margin: 5,
  realText: false,
  images: 'embed',
  imageDpi: 0,
  imageSource: 'original',
  colors: 'layer',
  lineWeight: 'visible',
  lineWidth: 0.1,
  fills: 'layer',
  marks: false,
  cutContour: false,
  artboards: true,
  author: '',
  title: '',
  subject: '',
  keywords: '',
};

/** Paper sizes in mm (portrait) */
export const PAPER_MM: Record<'a4' | 'a3' | 'letter', { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  letter: { w: 215.9, h: 279.4 },
};

/** Line width in mm for the chosen line weight */
export const lineWidthMm = (o: Pick<PdfExportOptions, 'lineWeight' | 'lineWidth'>) =>
  o.lineWeight === 'hairline' ? 0.01 : o.lineWeight === 'custom' ? Math.min(10, Math.max(0.001, o.lineWidth)) : 0.1;

const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const flag = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const number = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const text = (v: unknown, def: string) => (typeof v === 'string' ? v.slice(0, 500) : def);

/** Options from stored or MCP data; unknown or broken values fall back to the defaults */
export function cleanPdfOptions(raw: unknown): PdfExportOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = PDF_EXPORT_DEFAULTS;
  return {
    scope: pick(r.scope, ['all', 'page', 'selection'] as const, d.scope),
    hiddenLayers: flag(r.hiddenLayers, d.hiddenLayers),
    nonOutput: pick(r.nonOutput, ['on', 'off', 'omit'] as const, d.nonOutput),
    guides: flag(r.guides, d.guides),
    notes: flag(r.notes, d.notes),
    pageSize: pick(r.pageSize, ['bed', 'content', 'a4', 'a3', 'letter'] as const, d.pageSize),
    margin: number(r.margin, d.margin, 0, 500),
    realText: flag(r.realText, d.realText),
    images: pick(r.images, ['embed', 'omit', 'frame'] as const, d.images),
    imageDpi: Math.round(number(r.imageDpi, d.imageDpi, 0, 4800)),
    imageSource: pick(r.imageSource, ['original', 'laser'] as const, d.imageSource),
    colors: pick(r.colors, ['layer', 'black', 'operation'] as const, d.colors),
    lineWeight: pick(r.lineWeight, ['hairline', 'visible', 'custom'] as const, d.lineWeight),
    lineWidth: number(r.lineWidth, d.lineWidth, 0.001, 10),
    fills: pick(r.fills, ['layer', 'outline'] as const, d.fills),
    marks: flag(r.marks, d.marks),
    cutContour: flag(r.cutContour, d.cutContour),
    artboards: flag(r.artboards, d.artboards),
    author: text(r.author, d.author),
    title: text(r.title, d.title),
    subject: text(r.subject, d.subject),
    keywords: text(r.keywords, d.keywords),
  };
}

const KEY = 'kizamubeam.pdfExport';
const REMEMBER_KEY = 'kizamubeam.pdfExportRemember';

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Remember the last export settings? (Settings → Files; on by default) */
export function loadPdfRemember(): boolean {
  return storage()?.getItem(REMEMBER_KEY) !== '0';
}
export function savePdfRemember(on: boolean) {
  const s = storage();
  if (!s) return;
  if (on) s.removeItem(REMEMBER_KEY);
  else {
    s.setItem(REMEMBER_KEY, '0');
    s.removeItem(KEY);
  }
}

/** Last settings (or the defaults); title, subject and keywords always start empty */
export function loadPdfOptions(): PdfExportOptions {
  let raw: unknown = null;
  if (loadPdfRemember())
    try {
      raw = JSON.parse(storage()?.getItem(KEY) ?? 'null');
    } catch {
      raw = null;
    }
  return { ...cleanPdfOptions(raw), title: '', subject: '', keywords: '' };
}

export function savePdfOptions(o: PdfExportOptions) {
  if (!loadPdfRemember()) return;
  const keep: Partial<PdfExportOptions> = { ...o };
  delete keep.title;
  delete keep.subject;
  delete keep.keywords;
  try {
    storage()?.setItem(KEY, JSON.stringify(keep));
  } catch {
    /* Speicher voll: nicht merken */
  }
}

/** Forget the remembered settings (button in the dialog and in Settings → Files) */
export function resetPdfOptions() {
  storage()?.removeItem(KEY);
}
