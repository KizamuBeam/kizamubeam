// Real text in exported PDF/AI files: read sfnt fonts (TrueType/OpenType, also WOFF), subset TrueType outlines and
// write the PDF objects for a Type0 font (CIDFontType2 or CIDFontType0 with Identity-H) plus a ToUnicode CMap.
// Pure logic without DOM, so it can be tested in Node (scripts/vecformats-test.ts).
import { unzlibSync } from 'fflate';
import { parseCFF, unicodeToName } from './pdffonts';

export interface SfntTable {
  tag: string;
  data: Uint8Array;
}

/** Font facts the PDF needs (font units) */
export interface FontFacts {
  /** 'truetype' = glyf outlines (subset), 'cff' = OpenType with CFF outlines (embedded whole) */
  kind: 'truetype' | 'cff';
  unitsPerEm: number;
  numGlyphs: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  italicAngle: number;
  fixedPitch: boolean;
  /** OS/2 fsType (embedding permissions), 0 when the table is missing */
  fsType: number;
  postScriptName: string;
  /** Advance width per glyph ID in font units */
  advance(gid: number): number;
}

export type FontRejectReason = 'license' | 'format';

const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const i16 = (b: Uint8Array, p: number) => {
  const v = u16(b, p);
  return v & 0x8000 ? v - 0x10000 : v;
};
const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const tagAt = (b: Uint8Array, p: number) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);

/**
 * Tables of a single sfnt font. WOFF (version 1) is unpacked. Collections (.ttc), WOFF2 and anything else
 * give null, so the caller falls back to outlines.
 */
export function readSfnt(bytes: Uint8Array): { flavor: string; tables: Map<string, Uint8Array> } | null {
  if (bytes.length < 12) return null;
  const sig = tagAt(bytes, 0);
  const tables = new Map<string, Uint8Array>();
  try {
    if (sig === 'wOFF') {
      const flavor = tagAt(bytes, 4);
      const n = u16(bytes, 12);
      for (let i = 0; i < n; i++) {
        const p = 44 + i * 20;
        const tag = tagAt(bytes, p);
        const off = u32(bytes, p + 4),
          comp = u32(bytes, p + 8),
          orig = u32(bytes, p + 12);
        const raw = bytes.subarray(off, off + comp);
        tables.set(tag, comp < orig ? unzlibSync(raw) : raw);
      }
      return { flavor, tables };
    }
    if (sig !== 'OTTO' && sig !== 'true' && u32(bytes, 0) !== 0x00010000) return null;
    const n = u16(bytes, 4);
    for (let i = 0; i < n; i++) {
      const p = 12 + i * 16;
      const off = u32(bytes, p + 8),
        len = u32(bytes, p + 12);
      if (off + len > bytes.length) return null;
      tables.set(tagAt(bytes, p), bytes.subarray(off, off + len));
    }
    return { flavor: sig, tables };
  } catch {
    return null;
  }
}

function nameString(name: Uint8Array | undefined, id: number): string {
  if (!name || name.length < 6) return '';
  const count = u16(name, 2),
    strOff = u16(name, 4);
  let mac = '';
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    if (p + 12 > name.length) break;
    const platform = u16(name, p),
      nameId = u16(name, p + 6),
      len = u16(name, p + 8),
      off = strOff + u16(name, p + 10);
    if (nameId !== id) continue;
    const s = name.subarray(off, off + len);
    if (platform === 3 || platform === 0) {
      let out = '';
      for (let k = 0; k + 1 < s.length; k += 2) out += String.fromCharCode(u16(s, k));
      if (out) return out;
    } else if (platform === 1 && !mac) mac = String.fromCharCode(...s);
  }
  return mac;
}

/** Facts of an sfnt font; null when required tables are missing */
export function fontFacts(sf: { flavor: string; tables: Map<string, Uint8Array> }): FontFacts | null {
  const T = sf.tables;
  const head = T.get('head'),
    hhea = T.get('hhea'),
    hmtx = T.get('hmtx'),
    maxp = T.get('maxp');
  if (!head || !hhea || !hmtx || !maxp || head.length < 54 || hhea.length < 36 || maxp.length < 6) return null;
  const kind = T.has('glyf') && T.has('loca') ? 'truetype' : T.has('CFF ') ? 'cff' : null;
  if (!kind) return null;
  const os2 = T.get('OS/2'),
    post = T.get('post');
  const nMetrics = u16(hhea, 34);
  const numGlyphs = u16(maxp, 4);
  const ascent = i16(hhea, 4),
    descent = i16(hhea, 6);
  const capHeight = os2 && os2.length >= 90 && u16(os2, 0) >= 2 ? i16(os2, 88) : ascent;
  const ps = nameString(T.get('name'), 6) || nameString(T.get('name'), 4);
  return {
    kind,
    unitsPerEm: u16(head, 18) || 1000,
    numGlyphs,
    ascent,
    descent,
    capHeight: capHeight || ascent,
    bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
    italicAngle: post && post.length >= 8 ? (u32(post, 4) | 0) / 65536 : 0,
    fixedPitch: !!post && post.length >= 16 && u32(post, 12) !== 0,
    fsType: os2 && os2.length >= 10 ? u16(os2, 8) : 0,
    postScriptName: ps.replace(/[^\x21-\x7e]|[[\](){}<>/%#]/g, ''),
    advance: (gid) => {
      if (!nMetrics) return 0;
      const i = Math.min(gid, nMetrics - 1);
      return 4 * i + 2 <= hmtx.length ? u16(hmtx, 4 * i) : 0;
    },
  };
}

/**
 * May the font be embedded? fsType bit 1 (restricted license) and bit 9 (bitmap only) forbid it;
 * installable, preview/print and editable embedding are fine for a PDF.
 */
export const embeddingAllowed = (fsType: number) => (fsType & 0x0002) === 0 && (fsType & 0x0200) === 0;

// ---------- TrueType subset ----------

/** Glyph IDs of a set plus all components of composite glyphs (recursively) */
function withComponents(glyf: Uint8Array, offs: number[], gids: Iterable<number>): Set<number> {
  const out = new Set<number>([0]);
  const stack = [...gids];
  while (stack.length) {
    const g = stack.pop()!;
    if (out.has(g) && g !== 0) continue;
    out.add(g);
    const a = offs[g],
      b = offs[g + 1];
    if (a === undefined || b === undefined || b - a < 10) continue;
    if (i16(glyf, a) >= 0) continue;
    let p = a + 10;
    for (;;) {
      const flags = u16(glyf, p);
      const comp = u16(glyf, p + 2);
      if (!out.has(comp)) stack.push(comp);
      p += 4 + (flags & 0x0001 ? 4 : 2);
      if (flags & 0x0008) p += 2;
      else if (flags & 0x0040) p += 4;
      else if (flags & 0x0080) p += 8;
      if (!(flags & 0x0020) || p + 4 > b) break;
    }
  }
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = pad4(b.length);
  for (let i = 0; i < n; i += 4) sum = (sum + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return sum;
}

/** Write an sfnt file from tables (sorted by tag, 4-byte aligned, with checksums) */
export function writeSfnt(flavor: number, tables: SfntTable[]): Uint8Array {
  const list = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = list.length;
  let size = 12 + 16 * n;
  for (const t of list) size += pad4(t.data.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  dv.setUint16(6, (1 << es) * 16);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - (1 << es) * 16);
  let off = 12 + 16 * n;
  let headAt = -1;
  list.forEach((t, i) => {
    const p = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[p + k] = t.tag.charCodeAt(k);
    dv.setUint32(p + 4, checksum(t.data));
    dv.setUint32(p + 8, off);
    dv.setUint32(p + 12, t.data.length);
    out.set(t.data, off);
    if (t.tag === 'head') headAt = off;
    off += pad4(t.data.length);
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** cmap with one format 4 subtable (Windows Unicode BMP) */
function buildCmap(map: Map<number, number>): Uint8Array {
  const codes = [...map.keys()].filter((c) => c > 0 && c < 0xffff).sort((a, b) => a - b);
  const seg = codes.length + 1;
  const len = 16 + seg * 8;
  const t = new Uint8Array(12 + len);
  const dv = new DataView(t.buffer);
  dv.setUint16(0, 0);
  dv.setUint16(2, 1);
  dv.setUint16(4, 3);
  dv.setUint16(6, 1);
  dv.setUint32(8, 12);
  const s = 12;
  dv.setUint16(s, 4);
  dv.setUint16(s + 2, len);
  dv.setUint16(s + 4, 0);
  dv.setUint16(s + 6, seg * 2);
  let es = 0;
  while (1 << (es + 1) <= seg) es++;
  dv.setUint16(s + 8, (1 << es) * 2);
  dv.setUint16(s + 10, es);
  dv.setUint16(s + 12, seg * 2 - (1 << es) * 2);
  const end = s + 14,
    start = end + seg * 2 + 2,
    delta = start + seg * 2,
    range = delta + seg * 2;
  codes.forEach((c, i) => {
    dv.setUint16(end + i * 2, c);
    dv.setUint16(start + i * 2, c);
    dv.setUint16(delta + i * 2, (map.get(c)! - c) & 0xffff);
    dv.setUint16(range + i * 2, 0);
  });
  const last = codes.length;
  dv.setUint16(end + last * 2, 0xffff);
  dv.setUint16(start + last * 2, 0xffff);
  dv.setUint16(delta + last * 2, 1);
  dv.setUint16(range + last * 2, 0);
  return t;
}

/** post table version 2 with names for the kept glyphs (Illustrator and Acrobat use them when editing text) */
function buildPost(old: Uint8Array | undefined, numGlyphs: number, names: Map<number, string>): Uint8Array {
  const strs: string[] = [];
  const idx = new Uint16Array(numGlyphs);
  for (let g = 1; g < numGlyphs; g++) {
    const n = names.get(g);
    if (!n) continue;
    idx[g] = 258 + strs.length;
    strs.push(n.replace(/[^\x21-\x7e]/g, '').slice(0, 63) || `g${g}`);
  }
  const strBytes = strs.reduce((a, s) => a + 1 + s.length, 0);
  const t = new Uint8Array(32 + 2 + numGlyphs * 2 + strBytes);
  if (old && old.length >= 32) t.set(old.subarray(0, 32));
  const dv = new DataView(t.buffer);
  dv.setUint32(0, 0x00020000);
  dv.setUint16(32, numGlyphs);
  for (let g = 0; g < numGlyphs; g++) dv.setUint16(34 + g * 2, idx[g]);
  let p = 34 + numGlyphs * 2;
  for (const s of strs) {
    t[p++] = s.length;
    for (let i = 0; i < s.length; i++) t[p++] = s.charCodeAt(i);
  }
  return t;
}

/**
 * TrueType subset that keeps the glyph IDs: unused glyphs become empty, so the PDF can use glyph IDs as CIDs
 * (Identity-H, CIDToGIDMap Identity). Layout tables (GSUB, GPOS, kern …) are dropped; the PDF positions every
 * glyph itself. uni maps glyph ID → text for the cmap and post names.
 */
export function subsetTrueType(sf: { tables: Map<string, Uint8Array> }, gids: Iterable<number>, uni: Map<number, string>): Uint8Array {
  const T = sf.tables;
  const head = T.get('head')!,
    loca = T.get('loca')!,
    glyf = T.get('glyf')!,
    maxp = T.get('maxp')!;
  const numGlyphs = u16(maxp, 4);
  const long = i16(head, 50) === 1;
  const offs: number[] = [];
  for (let g = 0; g <= numGlyphs; g++) offs.push(long ? u32(loca, g * 4) : u16(loca, g * 2) * 2);
  const keep = withComponents(glyf, offs, gids);
  let size = 0;
  for (const g of keep) if (g < numGlyphs) size += pad4(offs[g + 1] - offs[g]);
  const newGlyf = new Uint8Array(size);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const ldv = new DataView(newLoca.buffer);
  let p = 0;
  for (let g = 0; g < numGlyphs; g++) {
    ldv.setUint32(g * 4, p);
    if (keep.has(g)) {
      const a = offs[g],
        b = offs[g + 1];
      if (b > a) {
        newGlyf.set(glyf.subarray(a, b), p);
        p += pad4(b - a);
      }
    }
  }
  ldv.setUint32(numGlyphs * 4, p);
  const newHead = new Uint8Array(head);
  new DataView(newHead.buffer).setInt16(50, 1);
  new DataView(newHead.buffer).setUint32(8, 0);
  const cmapMap = new Map<number, number>();
  const names = new Map<number, string>();
  for (const [g, s] of uni) {
    const cps = [...s];
    if (cps.length === 1) {
      const c = cps[0].codePointAt(0)!;
      if (!cmapMap.has(c)) cmapMap.set(c, g);
    }
    if (s) names.set(g, cps.length === 1 ? unicodeToName(s) : cps.map((c) => unicodeToName(c)).join('_'));
  }
  const tables: SfntTable[] = [
    { tag: 'head', data: newHead },
    { tag: 'glyf', data: newGlyf },
    { tag: 'loca', data: newLoca },
    { tag: 'cmap', data: buildCmap(cmapMap) },
    { tag: 'post', data: buildPost(T.get('post'), numGlyphs, names) },
  ];
  for (const tag of ['hhea', 'hmtx', 'maxp', 'cvt ', 'fpgm', 'prep', 'OS/2', 'name']) {
    const d = T.get(tag);
    if (d) tables.push({ tag, data: d });
  }
  return writeSfnt(0x00010000, tables);
}

/** Is the CFF font CID-keyed? Then CIDs are not glyph IDs and Identity-H would pick wrong glyphs. */
export function cffIsCidKeyed(cff: Uint8Array): boolean {
  try {
    return !!parseCFF(cff).cidToGid;
  } catch {
    return true;
  }
}

/** Why the font cannot be embedded, or null when it can */
export function checkEmbeddable(bytes: Uint8Array): FontRejectReason | null {
  const sf = readSfnt(bytes);
  const facts = sf && fontFacts(sf);
  if (!sf || !facts) return 'format';
  if (!embeddingAllowed(facts.fsType)) return 'license';
  if (facts.kind === 'cff' && cffIsCidKeyed(sf.tables.get('CFF ')!)) return 'format';
  return null;
}

/** OpenType file with CFF outlines rebuilt from its tables (unpacks WOFF), for FontFile3 /OpenType */
function openTypeFile(sf: { flavor: string; tables: Map<string, Uint8Array> }): Uint8Array {
  const tables: SfntTable[] = [];
  for (const [tag, data] of sf.tables) if (!['DSIG'].includes(tag)) tables.push({ tag, data: tag === 'head' ? zeroAdjust(data) : data });
  return writeSfnt(0x4f54544f, tables);
}
const zeroAdjust = (head: Uint8Array) => {
  const c = new Uint8Array(head);
  new DataView(c.buffer).setUint32(8, 0);
  return c;
};

// ---------- PDF objects ----------

/** Subset tag (six capital letters) from the used glyphs, stable for the same input */
function subsetTag(gids: number[]): string {
  let h = 2166136261;
  for (const g of gids) h = Math.imul(h ^ g, 16777619) >>> 0;
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + (i + 1) * 7919;
  }
  return s;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
function utf16Hex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
}

/** ToUnicode CMap: glyph ID (2 bytes) → text */
export function toUnicodeCMap(uni: Map<number, string>): string {
  const entries = [...uni].filter(([, s]) => s).sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n${chunk.map(([g, s]) => `<${hex4(g)}> <${utf16Hex(s)}>`).join('\n')}\nendbfchar\n`;
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    body +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  );
}

/** What a writer needs to add the font to a PDF */
export interface PdfFontParts {
  /** Font program and its stream dictionary entries (without /Length and /Filter) */
  program: Uint8Array;
  programDict: string;
  /** Key in the font descriptor: FontFile2 or FontFile3 */
  programKey: 'FontFile2' | 'FontFile3';
  baseFont: string;
  cidSubtype: 'CIDFontType2' | 'CIDFontType0';
  /** CIDToGIDMap entry (only CIDFontType2) */
  cidToGid: string;
  descriptor: string;
  widths: string;
  toUnicode: string;
  /** Advance in thousandths of an em per glyph ID (same values as the /W array) */
  width(gid: number): number;
}

/**
 * Prepare an embedded Type0 font for the glyphs in use. uni: glyph ID → text (for ToUnicode, cmap, post names).
 * fallbackName names the font when it has no PostScript name. Returns a reason instead when it cannot be embedded.
 */
export function pdfFontParts(bytes: Uint8Array, uni: Map<number, string>, fallbackName: string): PdfFontParts | FontRejectReason {
  const sf = readSfnt(bytes);
  const f = sf && fontFacts(sf);
  if (!sf || !f) return 'format';
  if (!embeddingAllowed(f.fsType)) return 'license';
  const gids = [...uni.keys()].filter((g) => g < f.numGlyphs).sort((a, b) => a - b);
  const k = 1000 / f.unitsPerEm;
  const width = (g: number) => Math.round(f.advance(g) * k);
  const name = f.postScriptName || fallbackName.replace(/[^A-Za-z0-9-]/g, '') || 'Font';
  let program: Uint8Array, programKey: 'FontFile2' | 'FontFile3', programDict: string, baseFont: string, cidSubtype: 'CIDFontType2' | 'CIDFontType0';
  if (f.kind === 'truetype') {
    program = subsetTrueType(sf, gids, uni);
    programKey = 'FontFile2';
    programDict = `/Length1 ${program.length}`;
    baseFont = `${subsetTag(gids)}+${name}`;
    cidSubtype = 'CIDFontType2';
  } else {
    if (cffIsCidKeyed(sf.tables.get('CFF ')!)) return 'format';
    // CFF: embedded whole (subsetting CFF is not worth the complexity; larger files are accepted)
    program = openTypeFile(sf);
    programKey = 'FontFile3';
    programDict = '/Subtype /OpenType';
    baseFont = name;
    cidSubtype = 'CIDFontType0';
  }
  const flags = 32 | (f.fixedPitch ? 1 : 0) | (f.italicAngle ? 64 : 0);
  const bb = f.bbox.map((v) => Math.round(v * k));
  const descriptor =
    `/Type /FontDescriptor /FontName /${baseFont} /Flags ${flags} /FontBBox [${bb.join(' ')}] /ItalicAngle ${Math.round(f.italicAngle * 100) / 100} ` +
    `/Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.capHeight * k)} /StemV 80`;
  const widths = gids.map((g) => `${g} [${width(g)}]`).join(' ');
  return {
    program,
    programDict,
    programKey,
    baseFont,
    cidSubtype,
    cidToGid: cidSubtype === 'CIDFontType2' ? '/CIDToGIDMap /Identity' : '',
    descriptor,
    widths,
    toUnicode: toUnicodeCMap(uni),
    width,
  };
}

/** Hex string of glyph IDs for Tj/TJ */
export const gidHex = (gid: number) => `<${hex4(gid)}>`;
