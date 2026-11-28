// Export von Vektordateien: DXF (AutoCAD R2000, mm) sowie PDF und PDF-kompatibles Illustrator (.ai).
// Reine Rechenlogik ohne Oberfläche: Die Aufrufer (files.ts) sammeln die Objekte und die Bildpunkte ein.
import { zlibSync } from 'fflate';
import { apply, Mat, mul, PALETTE, Pt, SubPath } from './model';
import { segments } from './curves';
import { checkEmbeddable, FontRejectReason, gidHex, PdfFontParts, pdfFontParts } from './pdftext';

export type Rgb = [number, number, number];
/** What the laser does with an item; used for the colour option "by operation" and the CutContour spot colour */
export type ExportOp = 'cut' | 'score' | 'engrave';

interface ExportBase {
  layer: number;
  /** Item belongs to an extra PDF layer (guides, notes, registration marks, artboard frames) instead of its layer */
  group?: string;
  op?: ExportOp;
  /** Not counted for "fit page to content" (guides across the bed) */
  noBounds?: boolean;
}
/** Kontur in Weltkoordinaten (mm, y nach unten) */
export interface ExportPath extends ExportBase {
  kind: 'path';
  subs: SubPath[];
  /** Fläche füllen (Layer im Modus Füllen) */
  fill: boolean;
  /** Fixed colour (otherwise from the layer and the colour option) */
  color?: Rgb;
  /** Fixed line width in mm (otherwise the export line width) */
  width?: number;
}
/** Rasterbild: m bildet das Einheitsquadrat (0,0 = linke obere Bildecke) auf die Bildfläche in mm ab */
export interface ExportImage extends ExportBase {
  kind: 'image';
  m: Mat;
  pxW: number;
  pxH: number;
  /** JPEG-Datei (wird unverändert eingebettet) … */
  jpeg?: Uint8Array;
  /** … oder Bildpunkte RGB (3 Byte je Punkt) und optional Deckkraft (1 Byte je Punkt) */
  rgb?: Uint8Array;
  alpha?: Uint8Array;
  /** … oder Graustufen (1 Byte je Punkt), z. B. das Bild so, wie es gelasert wird */
  gray?: Uint8Array;
}
/** Font file for real text; key identifies the font within one export */
export interface ExportFont {
  key: string;
  name: string;
  bytes: Uint8Array;
}
/** A run of glyphs: m maps run space (em units, y up, baseline at 0) to world mm; x is the pen position in em */
export interface ExportRun {
  m: Mat;
  glyphs: { gid: number; x: number; text: string }[];
}
/** Text that may stay text in the PDF; outline (world mm) is used when it cannot (and for page bounds) */
export interface ExportText extends ExportBase {
  kind: 'text';
  fill: boolean;
  font: ExportFont;
  runs: ExportRun[];
  outline: SubPath[];
}
/** Plain lines of text in Helvetica (project notes); x, y = top left in mm from the top left of the page */
export interface ExportNote extends ExportBase {
  kind: 'note';
  x: number;
  y: number;
  size: number;
  lines: string[];
}
export type ExportItem = ExportPath | ExportImage | ExportText | ExportNote;

export interface ExportPage {
  name: string;
  items: ExportItem[];
}

export interface LayerInfo {
  index: number;
  name: string;
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const layerRgb = (i: number) => hexRgb(PALETTE[i] ?? '#000000');

// ---------- DXF ----------

/** Die neun Grundfarben des AutoCAD-Farbindex (ACI) für Programme ohne Echtfarben */
const ACI_BASE: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]],
  [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]],
];
export function nearestAci(rgb: [number, number, number]): number {
  let best = 7,
    bd = Infinity;
  for (const [n, c] of ACI_BASE) {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bd) ((bd = d), (best = n));
  }
  return best;
}

/** DXF-Layername eines KizamuBeam-Layers: Nummer vorneweg, damit Namen eindeutig bleiben */
export function dxfLayerName(L: LayerInfo): string {
  const id = `C${String(L.index).padStart(2, '0')}`;
  const nm = L.name.replace(/[<>/\\":;?*|=`,\r\n]/g, ' ').trim();
  return nm && nm !== id ? `${id} ${nm}` : id;
}
/** DXF bis R2000 ist ANSI-kodiert: Zeichen außerhalb von ASCII als \U+XXXX schreiben */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

const fmt = (v: number) => {
  const s = (Math.abs(v) < 5e-10 ? 0 : v).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/**
 * DXF (AC1015 = AutoCAD 2000) in mm. Gerade Unterpfade werden zu LWPOLYLINE, Unterpfade mit Kurven zu einer
 * kubischen SPLINE, deren Kontrollpunkte genau die Bézier-Punkte sind (also ohne Annäherung). y zeigt in DXF
 * nach oben: am Bett gespiegelt, damit die Zeichnung in CAD-Programmen gleich herum liegt.
 * Bilder kann DXF nicht einbetten; sie werden übersprungen (skippedImages).
 */
export function buildDxf(all: ExportItem[], layers: LayerInfo[], bedH: number): { text: string; skippedImages: number } {
  const items = all.flatMap((it): (ExportPath | ExportImage)[] =>
    it.kind === 'text' ? [{ kind: 'path', subs: it.outline, layer: it.layer, fill: it.fill }] : it.kind === 'note' ? [] : [it],
  );
  let handle = 0x20;
  const H = () => (handle++).toString(16).toUpperCase();
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? fmt(v) : v);
  const flip = (p: Pt): Pt => ({ x: p.x, y: bedH - p.y });

  const used = new Map<number, LayerInfo>();
  let skippedImages = 0;
  for (const it of items) {
    if (it.kind === 'image') skippedImages++;
    else if (!used.has(it.layer)) used.set(it.layer, layers.find((L) => L.index === it.layer) ?? { index: it.layer, name: '' });
  }
  const layerList = [...used.values()].sort((a, b) => a.index - b.index);

  // Handles, auf die verwiesen wird
  const hBlockRecTable = 'A',
    hModel = '1F',
    hPaper = '1E',
    hDict = 'C';

  // ----- HEADER -----
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1015');
  g(9, '$DWGCODEPAGE');
  g(3, 'ANSI_1252');
  g(9, '$INSBASE');
  g(10, 0), g(20, 0), g(30, 0);
  g(9, '$EXTMIN');
  g(10, 0), g(20, 0), g(30, 0);
  g(9, '$EXTMAX');
  g(10, 1000), g(20, 1000), g(30, 0);
  g(9, '$INSUNITS');
  g(70, '4');
  g(9, '$MEASUREMENT');
  g(70, '1');
  g(9, '$LUNITS');
  g(70, '2');
  const seedAt = out.length;
  g(9, '$HANDSEED');
  g(5, 'FFFF');
  g(0, 'ENDSEC');

  // ----- CLASSES (leer) -----
  g(0, 'SECTION');
  g(2, 'CLASSES');
  g(0, 'ENDSEC');

  // ----- TABLES -----
  g(0, 'SECTION');
  g(2, 'TABLES');
  const table = (name: string, h: string, n: number, body: () => void) => {
    g(0, 'TABLE');
    g(2, name);
    g(5, h);
    g(330, '0');
    g(100, 'AcDbSymbolTable');
    g(70, String(n));
    body();
    g(0, 'ENDTAB');
  };
  const rec = (type: string, owner: string, sub: string) => {
    g(0, type);
    g(5, H());
    g(330, owner);
    g(100, 'AcDbSymbolTableRecord');
    g(100, sub);
  };
  table('VPORT', '8', 1, () => {
    rec('VPORT', '8', 'AcDbViewportTableRecord');
    g(2, '*ACTIVE');
    g(70, '0');
    g(10, 0), g(20, 0), g(11, 1), g(21, 1), g(12, 200), g(22, 200), g(13, 0), g(23, 0), g(14, 10), g(24, 10);
    g(15, 10), g(25, 10), g(16, 0), g(26, 0), g(36, 1), g(17, 0), g(27, 0), g(37, 0);
    g(40, 400), g(41, 1.5), g(42, 50), g(43, 0), g(44, 0), g(50, 0), g(51, 0);
    g(71, '0'), g(72, '100'), g(73, '1'), g(74, '3'), g(75, '0'), g(76, '0'), g(77, '0'), g(78, '0');
    g(281, '0'), g(65, '1'), g(110, 0), g(120, 0), g(130, 0), g(111, 1), g(121, 0), g(131, 0), g(112, 0), g(122, 1), g(132, 0);
    g(79, '0'), g(146, 0);
  });
  table('LTYPE', '5', 3, () => {
    for (const nm of ['ByBlock', 'ByLayer', 'Continuous']) {
      rec('LTYPE', '5', 'AcDbLinetypeTableRecord');
      g(2, nm);
      g(70, '0');
      g(3, nm === 'Continuous' ? 'Solid line' : '');
      g(72, '65');
      g(73, '0');
      g(40, 0);
    }
  });
  table('LAYER', '2', layerList.length + 1, () => {
    const layer = (name: string, rgb: [number, number, number]) => {
      rec('LAYER', '2', 'AcDbLayerTableRecord');
      g(2, name);
      g(70, '0');
      g(62, String(nearestAci(rgb)));
      g(420, String((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]));
      g(6, 'Continuous');
      g(370, '-3');
      g(390, '0');
    };
    layer('0', [0, 0, 0]);
    for (const L of layerList) layer(dxfText(dxfLayerName(L)), layerRgb(L.index));
  });
  table('STYLE', '3', 1, () => {
    rec('STYLE', '3', 'AcDbTextStyleTableRecord');
    g(2, 'Standard');
    g(70, '0'), g(40, 0), g(41, 1), g(50, 0), g(71, '0'), g(42, 2.5), g(3, 'txt'), g(4, '');
  });
  table('VIEW', '6', 0, () => {});
  table('UCS', '7', 0, () => {});
  table('APPID', '9', 1, () => {
    rec('APPID', '9', 'AcDbRegAppTableRecord');
    g(2, 'ACAD');
    g(70, '0');
  });
  g(0, 'TABLE');
  g(2, 'DIMSTYLE');
  g(5, 'B');
  g(330, '0');
  g(100, 'AcDbSymbolTable');
  g(70, '1');
  g(100, 'AcDbDimStyleTable');
  g(71, '0');
  g(0, 'DIMSTYLE');
  g(105, H());
  g(330, 'B');
  g(100, 'AcDbSymbolTableRecord');
  g(100, 'AcDbDimStyleTableRecord');
  g(2, 'Standard');
  g(70, '0');
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'BLOCK_RECORD');
  g(5, hBlockRecTable);
  g(330, '0');
  g(100, 'AcDbSymbolTable');
  g(70, '2');
  for (const [nm, h] of [['*Model_Space', hModel], ['*Paper_Space', hPaper]]) {
    g(0, 'BLOCK_RECORD');
    g(5, h);
    g(330, hBlockRecTable);
    g(100, 'AcDbSymbolTableRecord');
    g(100, 'AcDbBlockTableRecord');
    g(2, nm);
    g(340, '0');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ----- BLOCKS -----
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  for (const [nm, owner] of [['*Model_Space', hModel], ['*Paper_Space', hPaper]]) {
    g(0, 'BLOCK');
    g(5, H());
    g(330, owner);
    g(100, 'AcDbEntity');
    if (nm === '*Paper_Space') g(67, '1');
    g(8, '0');
    g(100, 'AcDbBlockBegin');
    g(2, nm);
    g(70, '0');
    g(10, 0), g(20, 0), g(30, 0);
    g(3, nm);
    g(1, '');
    g(0, 'ENDBLK');
    g(5, H());
    g(330, owner);
    g(100, 'AcDbEntity');
    if (nm === '*Paper_Space') g(67, '1');
    g(8, '0');
    g(100, 'AcDbBlockEnd');
  }
  g(0, 'ENDSEC');

  // ----- ENTITIES -----
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const ext = (p: Pt) => {
    x0 = Math.min(x0, p.x), y0 = Math.min(y0, p.y), x1 = Math.max(x1, p.x), y1 = Math.max(y1, p.y);
  };
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const lname = dxfText(dxfLayerName(used.get(it.layer)!));
    for (const sp of it.subs) {
      if (sp.nodes.length < 2 && !(sp.nodes.length === 1 && sp.closed)) continue;
      const segs = segments(sp);
      if (!segs.length) continue;
      const head = (type: string, sub: string) => {
        g(0, type);
        g(5, H());
        g(330, hModel);
        g(100, 'AcDbEntity');
        g(8, lname);
        g(100, sub);
      };
      if (!segs.some((s) => s.curve)) {
        const pts = sp.nodes.map(flip);
        head('LWPOLYLINE', 'AcDbPolyline');
        g(90, String(pts.length));
        g(70, sp.closed ? '1' : '0');
        g(43, 0);
        for (const p of pts) {
          g(10, p.x), g(20, p.y);
          ext(p);
        }
        continue;
      }
      // Kubische B-Spline mit dreifachen inneren Knoten = Folge von Bézier-Segmenten
      const ctrl: Pt[] = [flip(segs[0].a)];
      for (const s of segs) ctrl.push(flip(s.c1), flip(s.c2), flip(s.b));
      const n = segs.length;
      const knots = [0, 0, 0, 0];
      for (let k = 1; k < n; k++) knots.push(k, k, k);
      knots.push(n, n, n, n);
      head('SPLINE', 'AcDbSpline');
      g(210, 0), g(220, 0), g(230, 1);
      // 8 = eben; geschlossene Kurven zusätzlich mit 1 (Anfang = Ende, die Knoten bleiben geklemmt)
      g(70, String(8 | (sp.closed ? 1 : 0)));
      g(71, '3');
      g(72, String(knots.length));
      g(73, String(ctrl.length));
      g(74, '0');
      g(42, 0.0000001), g(43, 0.0000001);
      for (const k of knots) g(40, k);
      for (const p of ctrl) {
        g(10, p.x), g(20, p.y), g(30, 0);
        ext(p);
      }
    }
  }
  g(0, 'ENDSEC');

  // ----- OBJECTS: Stammverzeichnis, ohne das AutoCAD die Datei nicht öffnet -----
  g(0, 'SECTION');
  g(2, 'OBJECTS');
  const hGroup = H();
  g(0, 'DICTIONARY');
  g(5, hDict);
  g(330, '0');
  g(100, 'AcDbDictionary');
  g(281, '1');
  g(3, 'ACAD_GROUP');
  g(350, hGroup);
  g(0, 'DICTIONARY');
  g(5, hGroup);
  g(330, hDict);
  g(100, 'AcDbDictionary');
  g(281, '1');
  g(0, 'ENDSEC');
  g(0, 'EOF');

  out[seedAt + 3] = handle.toString(16).toUpperCase();
  // Ausdehnung eintragen
  if (isFinite(x0)) {
    const iMin = out.indexOf('$EXTMIN'),
      iMax = out.indexOf('$EXTMAX');
    out[iMin + 2] = fmt(x0);
    out[iMin + 4] = fmt(y0);
    out[iMax + 2] = fmt(x1);
    out[iMax + 4] = fmt(y1);
  }
  return { text: out.join('\r\n') + '\r\n', skippedImages };
}

// ---------- PDF ----------

const PT = 72 / 25.4;
const num = (v: number) => {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
/** Text als PDF-Zeichenkette (UTF-16BE mit BOM, damit Umlaute in Ebenen- und Seitennamen ankommen) */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}
/** Text in WinAnsi for the standard font Helvetica; characters it cannot show become “?” */
function winAnsiString(s: string): string {
  let out = '(';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += '\\' + ch;
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += '\\' + c.toString(8).padStart(3, '0');
    else out += '?';
  }
  return out + ')';
}
const pdfDate = (d: Date) => {
  const p = (v: number) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/** Extra PDF layer that is not a KizamuBeam layer (guides, notes, registration marks, artboard frames) */
export interface PdfGroup {
  id: string;
  name: string;
  /** Printed (default true); false = visible on screen only */
  print?: boolean;
  /** Switched on when the file opens (default true) */
  on?: boolean;
}

/** Page size: bed size, content bounds plus margin, or paper (portrait size in mm; turned to fit the content) */
export type PdfPageSize = { kind: 'bed' } | { kind: 'content'; margin: number } | { kind: 'paper'; w: number; h: number };

export interface PdfOptions {
  bed: { w: number; h: number };
  layers: LayerInfo[];
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  /** Strichstärke der Linien in mm */
  stroke?: number;
  /** Colours: layer colours, all black, or by operation (cut red, score blue, engrave black) */
  colors?: 'layer' | 'black' | 'operation';
  /** Cut lines in the spot colour “CutContour” (print and cut services) */
  cutContour?: boolean;
  pageSize?: PdfPageSize;
  /** Layers whose PDF layer is switched off when the file opens (hidden layers) */
  layersOff?: number[];
  groups?: PdfGroup[];
  /**
   * Illustrator: all pages side by side on one PDF page, gap in mm, each framed by a rectangle in the given group
   * (Object → Artboards → Convert to Artboards turns the frames into artboards)
   */
  artboards?: { gap: number; group: string };
  /** Keep text as text with the font embedded (otherwise outlines) */
  realText?: boolean;
  /** A font could not be embedded; its texts became outlines */
  onTextFallback?: (reason: FontRejectReason, font: string) => void;
  /** Feste Zeit (Tests) */
  date?: Date;
}

/** Bounds of the items in world mm (control points included), null when there is nothing */
export function itemsBounds(items: ExportItem[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (p: Pt) => {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  const subs = (list: SubPath[]) => {
    for (const sp of list) for (const n of sp.nodes) [n, n.cin, n.cout].forEach((p) => p && add(p));
  };
  for (const it of items) {
    if (it.noBounds || it.kind === 'note') continue;
    if (it.kind === 'path') subs(it.subs);
    else if (it.kind === 'text') subs(it.outline);
    else
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) add(apply(it.m, u, v));
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Size of a PDF page in mm and where the world origin lands on it (dx, dy) */
export function pageFrame(items: ExportItem[], o: Pick<PdfOptions, 'bed' | 'pageSize'>): { w: number; h: number; dx: number; dy: number } {
  const ps = o.pageSize ?? { kind: 'bed' };
  if (ps.kind === 'bed') return { w: o.bed.w, h: o.bed.h, dx: 0, dy: 0 };
  const b = itemsBounds(items) ?? { x: 0, y: 0, w: o.bed.w, h: o.bed.h };
  if (ps.kind === 'content') {
    const m = Math.max(0, ps.margin);
    return { w: Math.max(1, b.w + 2 * m), h: Math.max(1, b.h + 2 * m), dx: m - b.x, dy: m - b.y };
  }
  // Paper: long side along the long side of the content, content centred
  let pw = ps.w,
    ph = ps.h;
  if ((b.w > b.h) !== (pw > ph)) [pw, ph] = [ph, pw];
  return { w: pw, h: ph, dx: (pw - b.w) / 2 - b.x, dy: (ph - b.h) / 2 - b.y };
}

/** Factor (≤ 1) that brings an image of pxW × pxH pixels on the area m (unit square → mm) down to maxDpi */
export function dpiScale(m: Mat, pxW: number, pxH: number, maxDpi: number): number {
  if (!(maxDpi > 0) || !pxW || !pxH) return 1;
  const maxW = Math.max(1, Math.round((Math.hypot(m[0], m[1]) / 25.4) * maxDpi)),
    maxH = Math.max(1, Math.round((Math.hypot(m[2], m[3]) / 25.4) * maxDpi));
  return Math.min(1, maxW / pxW, maxH / pxH);
}

/** Downsample an RGB/gray image (box filter) so it has at most maxDpi pixels per inch on the page */
export function limitImageDpi(img: ExportImage, maxDpi: number): ExportImage {
  if (img.jpeg) return img;
  const f = dpiScale(img.m, img.pxW, img.pxH, maxDpi);
  if (f >= 1) return img;
  const W = Math.max(1, Math.round(img.pxW * f)),
    H = Math.max(1, Math.round(img.pxH * f));
  const shrink = (src: Uint8Array | undefined, ch: number) => {
    if (!src) return undefined;
    const out = new Uint8Array(W * H * ch);
    for (let y = 0; y < H; y++) {
      const sy0 = Math.floor((y * img.pxH) / H),
        sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.pxH) / H));
      for (let x = 0; x < W; x++) {
        const sx0 = Math.floor((x * img.pxW) / W),
          sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.pxW) / W));
        for (let c = 0; c < ch; c++) {
          let sum = 0;
          for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) sum += src[(yy * img.pxW + xx) * ch + c];
          out[(y * W + x) * ch + c] = Math.round(sum / ((sy1 - sy0) * (sx1 - sx0)));
        }
      }
    }
    return out;
  };
  return { ...img, pxW: W, pxH: H, rgb: shrink(img.rgb, 3), alpha: shrink(img.alpha, 1), gray: shrink(img.gray, 1) };
}

const OP_RGB: Record<ExportOp, Rgb> = { cut: [255, 0, 0], score: [0, 0, 255], engrave: [0, 0, 0] };
const groupTag = (id: string) => 'G' + id.replace(/[^A-Za-z0-9]/g, '');

/**
 * PDF 1.5 mit einer Seite je Projektseite (1:1 in mm; Bettgröße, Inhalt mit Rand oder Papierformat). Konturen
 * bleiben Bézierkurven, Füll-Layer werden gefüllt (gerade-ungerade), jeder Layer wird eine eigene Ebene (Optional
 * Content), damit PDF-Programme und Illustrator die Layer auseinanderhalten. Bilder werden als JPEG oder
 * verlustfrei (Flate) eingebettet. Texte bleiben auf Wunsch echter Text mit eingebetteter Schrift.
 * Dieselbe Datei mit der Endung .ai öffnet Illustrator als PDF-kompatible Illustrator-Datei (mit artboards alle
 * Seiten nebeneinander auf einer Seite).
 */
export function buildPdf(pages: ExportPage[], o: PdfOptions): Uint8Array {
  const enc = new TextEncoder();
  const objs: (Uint8Array | null)[] = [null]; // Index = Objektnummer
  const alloc = () => objs.push(null) - 1;
  const set = (n: number, body: string | Uint8Array) => {
    const head = enc.encode(`${n} 0 obj\n`);
    const b = typeof body === 'string' ? enc.encode(body) : body;
    const tail = enc.encode('\nendobj\n');
    const all = new Uint8Array(head.length + b.length + tail.length);
    all.set(head, 0);
    all.set(b, head.length);
    all.set(tail, head.length + b.length);
    objs[n] = all;
  };
  const stream = (n: number, dict: string, data: Uint8Array) => {
    const head = enc.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    const tail = enc.encode('\nendstream');
    const all = new Uint8Array(head.length + data.length + tail.length);
    all.set(head, 0);
    all.set(data, head.length);
    all.set(tail, head.length + data.length);
    set(n, all);
  };

  const catalog = alloc(),
    pagesObj = alloc(),
    info = alloc();

  // ----- Ebenen: Layer, die irgendwo vorkommen, und Zusatzgruppen -----
  const allItems = pages.flatMap((p) => p.items);
  const usedLayers = [...new Set(allItems.filter((it) => !it.group).map((it) => it.layer))].sort((a, b) => a - b);
  const groups = (o.groups ?? []).filter((g) => allItems.some((it) => it.group === g.id) || o.artboards?.group === g.id);
  const props: string[] = [];
  const ocgOn: string[] = [],
    ocgOff: string[] = [],
    noPrint: string[] = [];
  const ocgList: string[] = [];
  for (const li of usedLayers) {
    const n = alloc();
    const L = o.layers.find((x) => x.index === li);
    set(n, `<< /Type /OCG /Name ${pdfString(L ? dxfLayerName(L) : `C${String(li).padStart(2, '0')}`)} >>`);
    props.push(`/L${li} ${n} 0 R`);
    ocgList.push(`${n} 0 R`);
    (o.layersOff?.includes(li) ? ocgOff : ocgOn).push(`${n} 0 R`);
  }
  for (const g of groups) {
    const n = alloc();
    const usage = g.print === false ? ' /Usage << /Print << /PrintState /OFF >> /View << /ViewState /ON >> >>' : '';
    set(n, `<< /Type /OCG /Name ${pdfString(g.name)}${usage} >>`);
    props.push(`/${groupTag(g.id)} ${n} 0 R`);
    ocgList.push(`${n} 0 R`);
    (g.on === false ? ocgOff : ocgOn).push(`${n} 0 R`);
    if (g.print === false) noPrint.push(`${n} 0 R`);
  }

  // ----- Schriften für echten Text: erst alle Glyphen sammeln, dann einbetten -----
  interface FontUse {
    res: string;
    font: ExportFont;
    uni: Map<number, string>;
    parts?: PdfFontParts;
    rejected?: FontRejectReason;
  }
  const fonts = new Map<string, FontUse>();
  if (o.realText)
    for (const it of allItems) {
      if (it.kind !== 'text') continue;
      let f = fonts.get(it.font.key);
      if (!f) {
        f = { res: `F${fonts.size}`, font: it.font, uni: new Map() };
        const r = checkEmbeddable(it.font.bytes);
        if (r) f.rejected = r;
        fonts.set(it.font.key, f);
      }
      if (f.rejected) continue;
      for (const run of it.runs) for (const g of run.glyphs) if (!f.uni.has(g.gid) || (!f.uni.get(g.gid) && g.text)) f.uni.set(g.gid, g.text);
    }
  const fontRefs: string[] = [];
  for (const f of fonts.values()) {
    if (f.rejected) {
      o.onTextFallback?.(f.rejected, f.font.name);
      continue;
    }
    const parts = pdfFontParts(f.font.bytes, f.uni, f.font.name);
    if (typeof parts === 'string') {
      f.rejected = parts;
      o.onTextFallback?.(parts, f.font.name);
      continue;
    }
    f.parts = parts;
    const type0 = alloc(),
      cid = alloc(),
      desc = alloc(),
      prog = alloc(),
      tu = alloc();
    stream(prog, `${parts.programDict} /Filter /FlateDecode`, zlibSync(parts.program));
    set(desc, `<< ${parts.descriptor} /${parts.programKey} ${prog} 0 R >>`);
    set(
      cid,
      `<< /Type /Font /Subtype /${parts.cidSubtype} /BaseFont /${parts.baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${desc} 0 R /DW 1000 /W [${parts.widths}] ${parts.cidToGid} >>`,
    );
    stream(tu, '/Filter /FlateDecode', zlibSync(enc.encode(parts.toUnicode)));
    set(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${parts.baseFont} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    fontRefs.push(`/${f.res} ${type0} 0 R`);
  }
  let helv = 0;
  const helvetica = () => {
    if (!helv) {
      helv = alloc();
      set(helv, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      fontRefs.push(`/Helv ${helv} 0 R`);
    }
  };
  let cutCs = 0;
  const cutContour = () => {
    if (!cutCs) {
      cutCs = alloc();
      set(cutCs, '[/Separation /CutContour /DeviceRGB << /FunctionType 2 /Domain [0 1] /C0 [1 1 1] /C1 [1 0 1] /N 1 >>]');
    }
  };

  const lwMm = o.stroke ?? 0.1;
  const colorOf = (it: ExportItem): Rgb => {
    if ((it.kind === 'path' && it.color) || (it.group && it.kind === 'note')) return it.kind === 'path' && it.color ? it.color : [0, 0, 0];
    if (o.colors === 'black') return [0, 0, 0];
    if (o.colors === 'operation') return OP_RGB[it.op ?? 'engrave'];
    return layerRgb(it.layer);
  };

  /** Content of one project page; F maps world mm to PDF points, frameTop/Left in pt for notes */
  const drawItems = (items: ExportItem[], F: Mat, frame: { left: number; top: number }, xobj: string[]) => {
    let c = '';
    for (const it of items) {
      const tag = `/OC /${it.group ? groupTag(it.group) : `L${it.layer}`} BDC\n`;
      const rgb = colorOf(it).map((v) => num(v / 255)).join(' ');
      if (it.kind === 'image') {
        const imgN = alloc();
        const name = `Im${xobj.length}`;
        xobj.push(`/${name} ${imgN} 0 R`);
        let smask = '';
        const dim = `/Type /XObject /Subtype /Image /Width ${it.pxW} /Height ${it.pxH} /BitsPerComponent 8`;
        if (it.jpeg) stream(imgN, `${dim} /ColorSpace /DeviceRGB /Filter /DCTDecode`, it.jpeg);
        else if (it.gray) stream(imgN, `${dim} /ColorSpace /DeviceGray /Filter /FlateDecode`, zlibSync(it.gray));
        else if (it.rgb) {
          if (it.alpha && it.alpha.some((a) => a < 255)) {
            const sN = alloc();
            stream(sN, `${dim} /ColorSpace /DeviceGray /Filter /FlateDecode`, zlibSync(it.alpha));
            smask = ` /SMask ${sN} 0 R`;
          }
          stream(imgN, `${dim} /ColorSpace /DeviceRGB /Filter /FlateDecode${smask}`, zlibSync(it.rgb));
        } else {
          xobj.pop();
          set(imgN, 'null');
          continue;
        }
        // Bildraum: (0,0) = linke untere Ecke, oberste Bildzeile bei v = 1
        const m = mul(F, mul(it.m, [1, 0, 0, -1, 0, 1]));
        c += `${tag}q ${m.map(num).join(' ')} cm /${name} Do Q\nEMC\n`;
        continue;
      }
      if (it.kind === 'note') {
        helvetica();
        const size = it.size * PT,
          lead = size * 1.25;
        const x = frame.left + it.x * PT,
          y = frame.top - it.y * PT - size;
        c += `${tag}BT /Helv ${num(size)} Tf ${rgb} rg ${num(lead)} TL ${num(x)} ${num(y)} Td\n`;
        it.lines.forEach((ln, i) => (c += `${i ? 'T* ' : ''}${winAnsiString(ln)} Tj\n`));
        c += 'ET\nEMC\n';
        continue;
      }
      const spot = !!o.cutContour && it.op === 'cut';
      if (spot) cutContour();
      const fill = it.fill && !spot;
      const strokeCol = spot ? '/CutContour CS 1 SCN' : `${rgb} RG`;
      const fillCol = fill ? ` ${rgb} rg` : '';
      const width = it.kind === 'path' && it.width !== undefined ? it.width : lwMm;
      const wOp = width !== lwMm ? `${num(width * PT)} w ` : '';
      const f = it.kind === 'text' ? fonts.get(it.font.key) : undefined;
      if (it.kind === 'text' && f?.parts) {
        const parts = f.parts;
        c += `${tag}q ${wOp}${strokeCol}${fillCol}\nBT /${f.res} 1 Tf ${fill ? 2 : 1} Tr\n`;
        for (const run of it.runs) {
          if (!run.glyphs.length) continue;
          const tm = mul(F, run.m);
          let tj = '';
          if (Math.abs(run.glyphs[0].x) > 1e-6) tj += `${num(-run.glyphs[0].x * 1000)} `;
          run.glyphs.forEach((g, i) => {
            tj += gidHex(g.gid);
            const next = run.glyphs[i + 1];
            if (!next) return;
            const adj = parts.width(g.gid) - (next.x - g.x) * 1000;
            if (Math.abs(adj) > 5e-4) tj += ` ${num(adj)} `;
          });
          c += `${tm.map(num).join(' ')} Tm [${tj}] TJ\n`;
        }
        c += 'ET Q\nEMC\n';
        continue;
      }
      const subs = it.kind === 'text' ? it.outline : it.subs;
      let d = '';
      for (const sp of subs) {
        if (!sp.nodes.length) continue;
        const P = (p: Pt) => {
          const q = apply(F, p.x, p.y);
          return `${num(q.x)} ${num(q.y)}`;
        };
        d += `${P(sp.nodes[0])} m\n`;
        for (const s of segments(sp)) d += s.curve ? `${P(s.c1)} ${P(s.c2)} ${P(s.b)} c\n` : `${P(s.b)} l\n`;
        if (sp.closed) d += 'h\n';
      }
      if (!d) continue;
      const q0 = wOp ? 'q ' : '',
        q1 = wOp ? ' Q' : '';
      c += `${tag}${q0}${wOp}${strokeCol}${fillCol}\n${d}${fill ? 'B*' : 'S'}${q1}\nEMC\n`;
    }
    return c;
  };

  // ----- Seiten -----
  const frames = pages.map((p) => pageFrame(p.items, o));
  const kids: number[] = [];
  const resources = (xobj: string[]) => {
    const cs = cutCs ? ` /ColorSpace << /CutContour ${cutCs} 0 R >>` : '';
    const fnt = fontRefs.length ? ` /Font << ${fontRefs.join(' ')} >>` : '';
    return `/Resources << /XObject << ${xobj.join(' ')} >> /Properties << ${props.join(' ')} >>${fnt}${cs} >>`;
  };
  // Seiten erst nach allen Inhalten schreiben: Schrift und Schmuckfarbe kommen beim Zeichnen dazu
  const pending: { pageN: number; W: number; H: number; content: string; xobj: string[] }[] = [];
  const head = (lw: number) => `${num(lw * PT)} w 1 J 1 j\n`;
  if (o.artboards && pages.length) {
    const gap = Math.max(0, o.artboards.gap);
    const H = Math.max(...frames.map((f) => f.h));
    const W = frames.reduce((a, f) => a + f.w, 0) + gap * (pages.length - 1);
    const xobj: string[] = [];
    let c = head(lwMm);
    let ox = 0;
    pages.forEach((p, i) => {
      const fr = frames[i];
      const F: Mat = [PT, 0, 0, -PT, PT * (ox + fr.dx), PT * (H - fr.dy)];
      const rect = `${num(ox * PT)} ${num((H - fr.h) * PT)} ${num(fr.w * PT)} ${num(fr.h * PT)} re`;
      // Inhalt auf die eigene Zeichenfläche beschneiden (Hilfslinien reichen sonst in die Nachbarseite)
      c += `q ${rect} W n\n${drawItems(p.items, F, { left: ox * PT, top: H * PT }, xobj)}Q\n`;
      c += `/OC /${groupTag(o.artboards!.group)} BDC\nq 0.5 0.5 0.5 RG ${num(0.2 * PT)} w ${rect} S Q\nEMC\n`;
      ox += fr.w + gap;
    });
    pending.push({ pageN: alloc(), W: W * PT, H: H * PT, content: c, xobj });
  } else
    pages.forEach((p, i) => {
      const fr = frames[i];
      const F: Mat = [PT, 0, 0, -PT, PT * fr.dx, PT * (fr.h - fr.dy)];
      const xobj: string[] = [];
      const c = head(lwMm) + drawItems(p.items, F, { left: 0, top: fr.h * PT }, xobj);
      pending.push({ pageN: alloc(), W: fr.w * PT, H: fr.h * PT, content: c, xobj });
    });
  for (const pg of pending) {
    const contentN = alloc();
    kids.push(pg.pageN);
    stream(contentN, '/Filter /FlateDecode', zlibSync(enc.encode(pg.content)));
    set(pg.pageN, `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(pg.W)} ${num(pg.H)}] /Contents ${contentN} 0 R ${resources(pg.xobj)} >>`);
  }
  set(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const labels = o.artboards ? '' : ` /PageLabels << /Nums [${pages.map((p, i) => `${i} << /P ${pdfString(p.name || String(i + 1))} >>`).join(' ')}] >>`;
  const as = noPrint.length ? ` /AS [<< /Event /Print /OCGs [${noPrint.join(' ')}] /Category [/Print] >> << /Event /View /OCGs [${noPrint.join(' ')}] /Category [/View] >>]` : '';
  set(
    catalog,
    `<< /Type /Catalog /Pages ${pagesObj} 0 R${labels} ` +
      `/OCProperties << /OCGs [${ocgList.join(' ')}] /D << /Order [${ocgList.join(' ')}] /ON [${ocgOn.join(' ')}] /OFF [${ocgOff.join(' ')}]${as} >> >> >>`,
  );
  const date = pdfString(pdfDate(o.date ?? new Date()));
  const meta = [
    ['Author', o.author],
    ['Subject', o.subject],
    ['Keywords', o.keywords],
  ]
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => ` /${k} ${pdfString(v!.trim())}`)
    .join('');
  set(info, `<< /Title ${pdfString(o.title?.trim() || 'KizamuBeam')}${meta} /Creator (KizamuBeam) /Producer (KizamuBeam) /CreationDate ${date} /ModDate ${date} >>`);

  // Zusammensetzen mit Querverweistabelle
  const header = new Uint8Array([...enc.encode('%PDF-1.5\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const offsets: number[] = [];
  let len = header.length;
  for (let n = 1; n < objs.length; n++) {
    if (!objs[n]) set(n, 'null');
    offsets[n] = len;
    len += objs[n]!.length;
  }
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  const tail = enc.encode(xref);
  const outBytes = new Uint8Array(len + tail.length);
  outBytes.set(header, 0);
  let pos = header.length;
  for (let n = 1; n < objs.length; n++) {
    outBytes.set(objs[n]!, pos);
    pos += objs[n]!.length;
  }
  outBytes.set(tail, pos);
  return outBytes;
}
