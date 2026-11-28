// Tests für DXF-Export sowie PDF/AI-Export und -Import. Aufruf: npm run test:vecformats
// Optional: KIZAMUBEAM_DUMP=<ordner> schreibt die erzeugten Dateien zum Prüfen mit Fremdprogrammen.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { zlibSync } from 'fflate';
const { buildDxf, buildPdf } = await import('../src/vecexport');
const { importPdf, importPdfPages, encodePng, pageMatrix } = await import('../src/pdfimport');
const { importDxf, importSvg } = await import('../src/importers');
type SubPath = import('../src/model').SubPath;
type ExportItem = import('../src/vecexport').ExportItem;
type ImportedPath = import('../src/importers').ImportedPath;
type ImportedImage = import('../src/importers').ImportedImage;

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const dump = process.env.KIZAMUBEAM_DUMP;
if (dump) mkdirSync(dump, { recursive: true });
const save = (name: string, data: string | Uint8Array) => dump && writeFileSync(`${dump}/${name}`, data);
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b}`);

// Testzeichnung: Rechteck (gerade), Kreis aus vier Kurven, offene S-Kurve, gemischter Pfad
const k = 0.5523;
const rect: SubPath = { closed: true, nodes: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 40 }, { x: 10, y: 40 }] };
const circle: SubPath = {
  closed: true,
  nodes: [
    { x: 120, y: 50, cin: { x: 120, y: 50 - 20 * k }, cout: { x: 120, y: 50 + 20 * k } },
    { x: 100, y: 70, cin: { x: 100 + 20 * k, y: 70 }, cout: { x: 100 - 20 * k, y: 70 } },
    { x: 80, y: 50, cin: { x: 80, y: 50 + 20 * k }, cout: { x: 80, y: 50 - 20 * k } },
    { x: 100, y: 30, cin: { x: 100 - 20 * k, y: 30 }, cout: { x: 100 + 20 * k, y: 30 } },
  ],
};
const sCurve: SubPath = { closed: false, nodes: [{ x: 20, y: 100, cout: { x: 40, y: 80 } }, { x: 60, y: 100, cin: { x: 40, y: 120 } }] };
const mixed: SubPath = { closed: true, nodes: [{ x: 150, y: 150 }, { x: 190, y: 150, cout: { x: 200, y: 170 } }, { x: 170, y: 190, cin: { x: 190, y: 190 } }] };
const items: ExportItem[] = [
  { kind: 'path', subs: [rect], layer: 0, fill: false },
  { kind: 'path', subs: [circle], layer: 1, fill: true },
  { kind: 'path', subs: [sCurve], layer: 5, fill: false },
  { kind: 'path', subs: [mixed], layer: 2, fill: false },
];
const layers = Array.from({ length: 30 }, (_, i) => ({ index: i, name: i === 1 ? 'Gravur Äpfel' : `C${String(i).padStart(2, '0')}` }));
const bed = { w: 300, h: 200 };

/** Knoten (mit Anfassern) eines Unterpfads vergleichen; ein fehlender Anfasser zählt wie einer auf dem Knoten */
function sameSub(a: SubPath, b: SubPath, tol: number) {
  assert.equal(a.closed, b.closed, 'geschlossen');
  assert.equal(a.nodes.length, b.nodes.length, 'Knotenzahl');
  a.nodes.forEach((n, i) => {
    const m = b.nodes[i];
    near(n.x, m.x, tol, `x[${i}]`);
    near(n.y, m.y, tol, `y[${i}]`);
    for (const h of ['cin', 'cout'] as const) {
      const p = n[h] ?? n,
        q = m[h] ?? m;
      near(p.x, q.x, tol, `${h}.x[${i}]`);
      near(p.y, q.y, tol, `${h}.y[${i}]`);
    }
  });
}

await test('DXF: Rundreise über den eigenen Import ist genau (Kurven als Bézier-Spline)', async () => {
  const { text, skippedImages } = buildDxf(items, layers, bed.h);
  save('test.dxf', text);
  assert.equal(skippedImages, 0);
  assert.match(text, /AC1015/);
  assert.match(text, /\r\nLWPOLYLINE\r\n/);
  assert.match(text, /\r\nSPLINE\r\n/);
  const res = importDxf(text);
  const paths = res.items.filter((it): it is ImportedPath => it.kind === 'path');
  // y zeigt in DXF nach oben: wie der Editor am Bett spiegeln
  const flip = (sp: SubPath): SubPath => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      x: n.x,
      y: bed.h - n.y,
      ...(n.cin ? { cin: { x: n.cin.x, y: bed.h - n.cin.y } } : {}),
      ...(n.cout ? { cout: { x: n.cout.x, y: bed.h - n.cout.y } } : {}),
    })),
  });
  assert.equal(paths.length, 4, 'vier Objekte');
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const got = paths.find((p) => p.layer === it.layer);
    assert.ok(got, `Layer ${it.layer} fehlt`);
    sameSub(it.subs[0], flip(got.subs[0]), 1e-5);
  }
  assert.equal(res.notes.length, 0, res.notes.join(' '));
});

await test('DXF: Layer mit Namen, Echtfarbe und $INSUNITS = mm', async () => {
  const { text } = buildDxf(items, layers, bed.h);
  assert.match(text, /\$INSUNITS\r\n 70\r\n4|\$INSUNITS\r\n70\r\n4/);
  assert.ok(text.includes('C01 Gravur \\U+00C4pfel'), 'Layername (ANSI mit \\U+)');
  assert.ok(text.includes('\r\n420\r\n255\r\n'), 'Echtfarbe Blau (0x0000ff)');
});

await test('DXF: Bilder werden gezählt und übersprungen', async () => {
  const r = buildDxf([...items, { kind: 'image', m: [10, 0, 0, 10, 0, 0], layer: 0, pxW: 0, pxH: 0 }], layers, bed.h);
  assert.equal(r.skippedImages, 1);
  assert.equal(importDxf(r.text).items.length, 4);
});

// Kleines Bild 2×2: rot, grün / blau, halbdurchsichtig weiß
const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
const alpha = new Uint8Array([255, 255, 255, 128]);
const imgM: [number, number, number, number, number, number] = [40, 0, 0, 20, 200, 20];

await test('PDF: Rundreise über den eigenen Import (Pfade, Layerfarben, Bild, zwei Seiten)', async () => {
  const pdf = buildPdf(
    [
      { name: 'Seite 1', items: [...items, { kind: 'image', m: imgM, layer: 0, pxW: 2, pxH: 2, rgb, alpha }] },
      { name: 'Rückseite', items: [{ kind: 'path', subs: [rect], layer: 3, fill: false }] },
    ],
    { bed, layers, title: 'Test', date: new Date(Date.UTC(2026, 10, 2)) },
  );
  save('test.pdf', pdf);
  save('test.ai', pdf);
  const head = new TextDecoder().decode(pdf.subarray(0, 8));
  assert.equal(head, '%PDF-1.5');
  const r = await importPdf(pdf);
  assert.equal(r.pageCount, 2);
  near(r.pageSize.w, 300, 1e-3, 'Breite');
  near(r.pageSize.h, 200, 1e-3, 'Höhe');
  const paths = r.items.filter((it): it is ImportedPath => it.kind === 'path');
  assert.equal(paths.length, 4);
  for (const it of items) {
    if (it.kind !== 'path') continue;
    const got = paths.find((p) => p.layer === it.layer);
    assert.ok(got, `Layer ${it.layer} fehlt`);
    sameSub(it.subs[0], got.subs[0], 2e-4);
  }
  const imgs = r.items.filter((it): it is ImportedImage => it.kind === 'image');
  assert.equal(imgs.length, 1);
  imgM.forEach((v, i) => near(imgs[0].m[i], v, 1e-3, `Bildmatrix[${i}]`));
  assert.ok(imgs[0].href.startsWith('data:image/png;base64,iVBORw0KGgo'), 'PNG');
  const p2 = await importPdf(pdf, { page: 1 });
  assert.equal(p2.items.length, 1);
  assert.equal((p2.items[0] as ImportedPath).layer, 3);
  const all = await importPdfPages(pdf);
  assert.deepEqual(all.map((p) => p.items.length), [5, 1]);
});

await test('PDF: JPEG wird unverändert eingebettet und wieder ausgelesen', async () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const pdf = buildPdf([{ name: '', items: [{ kind: 'image', m: imgM, layer: 0, pxW: 8, pxH: 8, jpeg: fakeJpeg }] }], { bed, layers });
  const r = await importPdf(pdf);
  const img = r.items[0] as ImportedImage;
  assert.equal(img.href, 'data:image/jpeg;base64,' + Buffer.from(fakeJpeg).toString('base64'));
});

// ---------- Fremde PDF-Aufbauten von Hand ----------

const enc = new TextEncoder();
function concat(parts: (string | Uint8Array)[]): Uint8Array {
  const bs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
/** PDF mit klassischer Querverweistabelle aus Objektkörpern (Index = Objektnummer - 1) */
function classicPdf(bodies: (string | Uint8Array)[], trailerExtra = '', breakOffsets = false): Uint8Array {
  const parts: (string | Uint8Array)[] = ['%PDF-1.4\n'];
  const offs: number[] = [];
  let len = enc.encode(parts[0] as string).length;
  bodies.forEach((b, i) => {
    offs.push(len);
    const chunk = concat([`${i + 1} 0 obj\n`, b, '\nendobj\n']);
    parts.push(chunk);
    len += chunk.length;
  });
  let x = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) x += `${String(breakOffsets ? o + 7 : o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(x);
  return concat(parts);
}
const streamObj = (dict: string, data: Uint8Array) => concat([`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream']);

await test('PDF: Form-XObject, cm, re, CMYK, gedrehte Seite (Rotate 90)', async () => {
  const form = enc.encode('0 1 0 0 K 0 0 m 10 0 l S');
  const content = enc.encode('q 2 0 0 2 0 0 cm 0 1 1 0 k 10 10 20 30 re f Q q 1 0 0 1 100 100 cm /Fm0 Do Q');
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 100] >>',
    '<< /Type /Page /Parent 2 0 R /Rotate 90 /Contents 4 0 R /Resources << /XObject << /Fm0 5 0 R >> >> >>',
    streamObj('', content),
    streamObj('/Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 0 0 1 5 0]', form),
  ]);
  const r = await importPdf(pdf);
  const K = 25.4 / 72;
  near(r.pageSize.w, 100 * K, 1e-6, 'gedrehte Breite');
  near(r.pageSize.h, 200 * K, 1e-6, 'gedrehte Höhe');
  const paths = r.items as ImportedPath[];
  assert.equal(paths.length, 2);
  // Rechteck: 20..60 × 20..80 pt, Farbe CMYK 0 1 1 0 = Rot
  assert.equal(paths[0].layer, 2, 'rot = Layer 02');
  const P = pageMatrix([0, 0, 200, 100], 90).m;
  const n0 = paths[0].subs[0].nodes[0];
  near(n0.x, P[0] * 20 + P[2] * 20 + P[4], 1e-6, 'x');
  near(n0.y, P[1] * 20 + P[3] * 20 + P[5], 1e-6, 'y');
  // Linie aus dem Formular: 105..115 pt bei y = 100, Magenta
  assert.equal(paths[1].layer, 7, 'magenta = Layer 07');
  const a = paths[1].subs[0].nodes[0];
  near(a.x, 100 * K, 1e-6, 'Linie x (aus y)');
  near(a.y, 105 * K, 1e-6, 'Linie y (aus x)');
});

await test('PDF: Querverweis-Stream mit Objekt-Stream, PNG-Prädiktor und Flate', async () => {
  // Objekte 1–3 im Objekt-Stream 5, Inhalt 4 als normaler Stream, Querverweise in Stream 6
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>'];
  let hdr = '',
    body = '';
  objs.forEach((o, i) => {
    hdr += `${i + 1} ${body.length} `;
    body += o + '\n';
  });
  const osData = zlibSync(enc.encode(hdr + body));
  const content = zlibSync(enc.encode('1 0 0 RG 0 0 m 72 72 l S'));
  const head = '%PDF-1.5\n';
  const o4 = concat(['4 0 obj\n', streamObj('/Filter /FlateDecode', content), '\nendobj\n']);
  const o5 = concat(['5 0 obj\n', streamObj(`/Type /ObjStm /N 3 /First ${hdr.length} /Filter /FlateDecode`, osData), '\nendobj\n']);
  const off4 = head.length,
    off5 = off4 + o4.length,
    off6 = off5 + o5.length;
  // Einträge W [1 2 1] für Objekte 0–6, mit PNG-Prädiktor „Up“ (Spalten = 4)
  const rows = [
    [0, 0, 0, 255],
    [2, 0, 5, 0],
    [2, 0, 5, 1],
    [2, 0, 5, 2],
    [1, off4 >> 8, off4 & 255, 0],
    [1, off5 >> 8, off5 & 255, 0],
    [1, off6 >> 8, off6 & 255, 0],
  ];
  const raw: number[] = [];
  let prev = [0, 0, 0, 0];
  for (const r of rows) {
    raw.push(2, ...r.map((v, i) => (v - prev[i] + 256) & 255));
    prev = r;
  }
  const xs = zlibSync(new Uint8Array(raw));
  const o6 = concat([
    '6 0 obj\n',
    streamObj('/Type /XRef /Size 7 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >>', xs),
    '\nendobj\n',
  ]);
  const pdf = concat([head, o4, o5, o6, `startxref\n${off6}\n%%EOF\n`]);
  const r = await importPdf(pdf);
  const paths = r.items as ImportedPath[];
  assert.equal(paths.length, 1);
  assert.equal(paths[0].layer, 2);
  near(paths[0].subs[0].nodes[1].x, 25.4, 1e-6, '72 pt = 25,4 mm');
  near(paths[0].subs[0].nodes[1].y, (100 - 72) * (25.4 / 72), 1e-6, 'y gespiegelt');
});

await test('PDF: kaputte Querverweise → Datei wird durchsucht', async () => {
  const pdf = classicPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
      streamObj('', enc.encode('0 0 1 rg 10 10 m 20 10 l 20 20 l h f')),
    ],
    '',
    true,
  );
  const r = await importPdf(pdf);
  assert.equal(r.items.length, 1);
  assert.equal((r.items[0] as ImportedPath).layer, 1, 'blau');
  assert.ok((r.items[0] as ImportedPath).subs[0].closed);
});

await test('PDF: Filter LZW, ASCII85, ASCIIHex; Text und Inline-Bild werden gemeldet', async () => {
  // „1 0 0 RG 0 0 m 10 10 l S“ in ASCIIHex, dahinter Text und ein Inline-Bild
  const c = '1 0 0 RG 0 0 m 10 10 l S BT /F1 12 Tf (Hallo) Tj ET BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI 0 0 1 RG 5 5 m 6 6 l S';
  const hex = Buffer.from(c, 'latin1').toString('hex') + '>';
  // LZW-Beispiel aus der PDF-Spezifikation: „-----A---B“
  const lzwData = new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]);
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents [4 0 R 5 0 R 6 0 R] >>',
    streamObj('/Filter /ASCIIHexDecode', enc.encode(hex)),
    // „% -----A---B“ als Kommentar: prüft nur, dass LZW nicht stört
    streamObj('/Filter /LZWDecode', lzwData),
    streamObj('/Filter /ASCII85Decode', enc.encode('0H`(m0Ha7`+>Fun+Di5]+?:Q\\+B&~>')),
  ]);
  const r = await importPdf(pdf);
  assert.equal(r.items.length, 3, 'zwei Linien aus Hex + eine aus ASCII85');
  assert.ok(r.notes.some((n) => /Text|text/.test(n)), r.notes.join(' | '));
  assert.ok(r.notes.some((n) => /Bild|image/.test(n)), r.notes.join(' | '));
});

await test('PDF: verschlüsselte Datei wird abgelehnt', async () => {
  const pdf = classicPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'], '/Encrypt << /Filter /Standard >> ');
  await assert.rejects(() => importPdf(pdf), /Kennwort|password/);
});

await test('PDF: Bild mit Indexed-Farbraum und Maske, 1-Bit-Graustufen', async () => {
  const idx = zlibSync(new Uint8Array([0, 1, 1, 0]));
  const bits = new Uint8Array([0b10000000, 0b01000000]);
  const pdf = classicPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /A 5 0 R /B 6 0 R >> >> >>',
    streamObj('', enc.encode('q 72 0 0 72 0 0 cm /A Do Q q 36 0 0 36 0 0 cm /B Do Q')),
    streamObj('/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace [/Indexed /DeviceRGB 1 <FF000000FF00>] /Filter /FlateDecode', idx),
    streamObj('/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 1 /ColorSpace /DeviceGray', bits),
  ]);
  const r = await importPdf(pdf);
  const imgs = r.items as ImportedImage[];
  assert.equal(imgs.length, 2);
  near(imgs[0].m[0], 25.4, 1e-6, 'Bildbreite 72 pt');
  near(imgs[0].m[3], 25.4, 1e-6, 'Bildhöhe 72 pt (y nach unten)');
  near(imgs[0].m[5], (100 - 72) * (25.4 / 72), 1e-6, 'oberer Rand');
  assert.equal(r.notes.length, 0, r.notes.join(' '));
});

// ---------- Text und Verschlüsselung (Dateien in scripts/fixtures/pdf, siehe README dort) ----------

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/pdf/${n}`, import.meta.url)));
type Item = ImportedPath | ImportedImage;
const summary = (items: Item[]) =>
  items.map((it) => {
    if (it.kind !== 'path') return 'Bild';
    const xs = it.subs.flatMap((s) => s.nodes.map((n) => n.x)),
      ys = it.subs.flatMap((s) => s.nodes.map((n) => n.y));
    return { layer: it.layer, contours: it.subs.length, x: Math.min(...xs), y: Math.min(...ys) };
  });
const boxFont = async () => ({
  unitsPerEm: 1000,
  name: 'Box',
  substituted: true,
  glyph: (ch: string) => (ch.trim() ? { subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 700 }, { x: 0, y: 700 }] }], advance: 600 } : { subs: [], advance: 600 }),
});

await test('Text: CFF (Type1C, CIDFontType0C mit Identity-H, OpenType) wird zu Umrissen', async () => {
  const r = await importPdf(fixture('text-cff.pdf'));
  assert.deepEqual(r.notes, []);
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  // „Hallo CFF Grüße“ = 18 Konturen (blau), „Hallo“ = 7 (rot), „Grüße“ = 8 (schwarz)
  assert.deepEqual(s.map((x) => [x.layer, x.contours]), [[1, 18], [2, 7], [0, 8]]);
  near(s[0].x, 7.75, 0.05, 'linker Rand');
  near(s[2].y, 44.84, 0.05, 'Oberkante „Grüße“');
});

await test('Text: TrueType und Type 1 eingebettet, Zeichenabstand und Breite', async () => {
  const r = await importPdf(fixture('text-rl.pdf'));
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  assert.deepEqual(s.map((x) => [x.layer, x.contours]), [[0, 34], [1, 26], [1, 29]]);
  // Helvetica ist nicht eingebettet: ohne Ersatz übersprungen und gemeldet
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /1/);
});

await test('Text: nicht eingebettete Schrift über Ersatzschrift der App', async () => {
  const r = await importPdf(fixture('text-rl.pdf'), { fallback: boxFont });
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  // „Helvetica Bold nicht eingebettet“ hat 29 Zeichen ohne Leerzeichen, rot
  assert.deepEqual(s[1], { ...s[1], layer: 2, contours: 29 });
  near(s[1].x, 10, 1e-4, 'Start bei 10 mm');
  assert.ok(r.notes.some((n) => /Box/.test(n)), r.notes.join(' | '));
});

await test('Text: Type-3-Schrift und CID-TrueType aus Chromium, gedrehter Text', async () => {
  const r = await importPdf(fixture('text-chrome.pdf'));
  const s = summary(r.items) as { layer: number; contours: number; x: number; y: number }[];
  assert.deepEqual(s.map((x) => x.contours), [36, 32, 11]);
  assert.deepEqual(r.notes, []);
});

await test('Verschlüsselung: RC4 40/128, AES-128 und AES-256 ohne Öffnungskennwort', async () => {
  for (const f of ['enc-rc4-40.pdf', 'enc-rc4-128.pdf', 'enc-aes128.pdf', 'enc-aes256r6.pdf']) {
    const r = await importPdf(fixture(f));
    assert.equal(r.items.length, 3, f);
    assert.equal((r.items[0] as ImportedPath).layer, 2, `${f}: rotes Rechteck`);
  }
  await assert.rejects(() => importPdf(fixture('enc-userpw.pdf')), /Kennwort|password/);
});

await test('Krypto-Bausteine: bekannte Prüfwerte', async () => {
  const { md5, sha256, sha512, rc4, aesCbcDecrypt, aesCbcEncrypt } = await import('../src/pdfcrypt');
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  const abc = new TextEncoder().encode('abc');
  assert.equal(hex(md5(abc)), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(hex(sha256(abc)), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(sha512(abc, true)).slice(0, 16), 'cb00753f45a35e8b');
  assert.equal(hex(sha512(abc)).slice(0, 16), 'ddaf35a193617aba');
  assert.equal(hex(rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'))), 'bbf316e8d940af0ad3');
  // FIPS-197: AES-128 mit Schlüssel 000102…0f
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  const pt = Uint8Array.from({ length: 16 }, (_, i) => i * 0x11);
  const ct = aesCbcEncrypt(key, new Uint8Array(16), pt);
  assert.equal(hex(ct), '69c4e0d86a7b0430d8cdb78070b4c55a');
  assert.equal(hex(aesCbcDecrypt(key, new Uint8Array(16), ct, false)), hex(pt));
});

await test('PNG-Kodierer erzeugt gültige Kopfzeilen', async () => {
  const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(new TextDecoder().decode(png.subarray(12, 16)), 'IHDR');
});

await test('DXF: Fallback-Einheit greift bei fehlendem oder einheitenlosem $INSUNITS', () => {
  const dxfNoHeader = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '2', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
  const dxfUnitless = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '0', '0', 'ENDSEC', dxfNoHeader].join('\r\n');
  const len = (r: ReturnType<typeof importDxf>) => {
    const n = (r.items[0] as ImportedPath).subs[0].nodes;
    return Math.hypot(n[1].x - n[0].x, n[1].y - n[0].y);
  };
  near(len(importDxf(dxfNoHeader)), 2, 1e-6, 'Default mm');
  near(len(importDxf(dxfNoHeader, { dxfFallbackUnit: 25.4 })), 50.8, 1e-6, 'Zoll-Fallback ohne Header');
  near(len(importDxf(dxfUnitless, { dxfFallbackUnit: 25.4 })), 50.8, 1e-6, 'Zoll-Fallback bei $INSUNITS=0');
});

await test('SVG: Auto-DPI erkennt Adobe-Illustrator-Kommentar trotz Bereinigung', () => {
  type MiniEl = {
    localName: string;
    attrs: Record<string, string>;
    children: MiniEl[];
    textContent: string;
    getAttribute(k: string): string | null;
    hasAttribute(k: string): boolean;
    getAttributeNames(): string[];
    getElementsByTagName(tag: string): MiniEl[];
  };
  const makeEl = (localName: string, attrs: Record<string, string>, children: MiniEl[] = []): MiniEl => ({
    localName,
    attrs,
    children,
    textContent: '',
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    getAttributeNames: () => Object.keys(attrs),
    getElementsByTagName: (tag) => children.filter((c) => c.localName === tag),
  });
  const prevParser = (globalThis as Record<string, unknown>).DOMParser;
  (globalThis as Record<string, unknown>).DOMParser = class {
    parseFromString() {
      const rectEl = makeEl('rect', { x: '0', y: '0', width: '72', height: '72', stroke: '#000000', fill: 'none' });
      const root = makeEl('svg', { width: '72', height: '72', viewBox: '0 0 72 72' }, [rectEl]);
      return { documentElement: root, getElementsByTagName: (tag: string) => root.getElementsByTagName(tag) };
    }
  };
  try {
    const aiSvg = '<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In -->\n<svg width="72" height="72" viewBox="0 0 72 72"><rect x="0" y="0" width="72" height="72" stroke="#000" fill="none"/></svg>';
    const plainSvg = '<svg width="72" height="72" viewBox="0 0 72 72"><rect x="0" y="0" width="72" height="72" stroke="#000" fill="none"/></svg>';
    const widthOf = (r: ReturnType<typeof importSvg>) => {
      const xs = (r.items[0] as ImportedPath).subs[0].nodes.map((n) => n.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    near(widthOf(importSvg(aiSvg, { svgDpi: '96' })), (72 * 25.4) / 96, 1e-6, '96 DPI');
    near(widthOf(importSvg(aiSvg, { svgDpi: '72' })), 25.4, 1e-6, '72 DPI');
    near(widthOf(importSvg(aiSvg, { svgDpi: 'auto' })), 25.4, 1e-6, 'Auto erkennt Illustrator-Kommentar (72 DPI)');
    near(widthOf(importSvg(plainSvg, { svgDpi: 'auto' })), (72 * 25.4) / 96, 1e-6, 'Auto ohne Illustrator bleibt 96 DPI');
  } finally {
    if (prevParser === undefined) delete (globalThis as Record<string, unknown>).DOMParser;
    else (globalThis as Record<string, unknown>).DOMParser = prevParser;
  }
});

// ---------- PDF-Export: echter Text und Optionen (#234) ----------
{
  const opentype = (await import('opentype.js')).default;
  const { textGlyphRuns, textToSubs } = await import('../src/fonts');
  const { readSfnt, fontFacts, toUnicodeCMap, checkEmbeddable } = await import('../src/pdftext');
  const { itemsBounds, limitImageDpi, pageFrame } = await import('../src/vecexport');
  const { cleanPdfOptions, lineWidthMm, PDF_EXPORT_DEFAULTS } = await import('../src/pdfExportOptions');
  const { inflateSync } = await import('fflate');
  type Mat = import('../src/model').Mat;
  type TextShape = import('../src/model').TextShape;
  type ExportText = import('../src/vecexport').ExportText;

  const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
  /** All streams of a PDF, inflated where they are Flate-compressed */
  const streams = (pdf: Uint8Array) => {
    const s = latin1(pdf);
    const out: { dict: string; data: string }[] = [];
    const re = /<<((?:(?!>>\nstream)[\s\S])*)>>\nstream\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const len = Number(/\/Length (\d+)/.exec(m[1])?.[1] ?? 0);
      const raw = pdf.subarray(m.index + m[0].length, m.index + m[0].length + len);
      let data = raw;
      if (m[1].includes('/FlateDecode')) data = inflateSync(raw.subarray(2));
      out.push({ dict: m[1], data: latin1(data) });
    }
    return out;
  };
  const mulM = (a: Mat, b: Mat): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const moveSubs = (subs: SubPath[], m: Mat): SubPath[] => {
    const ap = (p: { x: number; y: number }) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
    return subs.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ ...ap(n), ...(n.cin ? { cin: ap(n.cin) } : {}), ...(n.cout ? { cout: ap(n.cout) } : {}) })) }));
  };
  const ttfBytes = new Uint8Array(readFileSync('node_modules/three/examples/fonts/ttf/kenpixel.ttf'));
  const parse = (b: Uint8Array) => opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const ttf = parse(ttfBytes);
  const textShape = (over: Partial<TextShape> = {}): TextShape => ({
    kind: 'text', text: 'Hallo Welt\nÄpfel 42', font: 'KenPixel', size: 8, bold: false, italic: false, upper: false, align: 'left', hSpace: 0.4, vSpace: 1, ...over,
  });
  const textItem = (ts: TextShape, font: opentype.Font, bytes: Uint8Array, m: Mat, layer = 0, fill = true): ExportText => ({
    kind: 'text',
    layer,
    fill,
    op: fill ? 'engrave' : 'cut',
    font: { key: ts.font, name: ts.font, bytes },
    runs: textGlyphRuns(ts, font)!.map((r) => ({ ...r, m: mulM(m, r.m) })),
    outline: moveSubs(textToSubs(ts, font), m),
  });
  /** Imported outlines land where the exported outlines were (same nodes; closed contours may start elsewhere) */
  const sameOutlines = (want: SubPath[], got: SubPath[], tol: number) => {
    assert.equal(got.length, want.length, 'Anzahl Konturen');
    const left = [...got];
    const fits = (a: SubPath, b: SubPath) => {
      const n = a.nodes.length;
      if (b.nodes.length !== n || a.closed !== b.closed) return false;
      for (let r = 0; r < (a.closed ? n : 1); r++)
        if (a.nodes.every((p, k) => Math.abs(p.x - b.nodes[(k + r) % n].x) <= tol && Math.abs(p.y - b.nodes[(k + r) % n].y) <= tol)) return true;
      return false;
    };
    want.forEach((a, i) => {
      const j = left.findIndex((b) => fits(a, b));
      assert.ok(j >= 0, `Kontur ${i} (${a.nodes.length} Knoten bei ${a.nodes[0].x.toFixed(3)}, ${a.nodes[0].y.toFixed(3)}) fehlt`);
      left.splice(j, 1);
    });
  };
  const outlinesOf = (r: Awaited<ReturnType<typeof importPdf>>) => r.items.filter((it): it is ImportedPath => it.kind === 'path').flatMap((p) => p.subs);

  await test('PDF-Text: TrueType als CIDFontType2-Teilmenge, Rundreise genau, ToUnicode', async () => {
    const ts = textShape();
    const m: Mat = [1, 0, 0, 1, 20, 40];
    const it = textItem(ts, ttf, ttfBytes, m);
    const fallbacks: string[] = [];
    const pdf = buildPdf([{ name: 'p', items: [it] }], { bed, layers, realText: true, onTextFallback: (r) => fallbacks.push(r) });
    save('text-ttf.pdf', pdf);
    assert.deepEqual(fallbacks, []);
    const s = latin1(pdf);
    assert.match(s, /\/Subtype \/CIDFontType2/);
    assert.match(s, /\/Encoding \/Identity-H/);
    assert.match(s, /\/BaseFont \/[A-Z]{6}\+KenPixel/);
    assert.match(s, /\/CIDToGIDMap \/Identity/);
    const st = streams(pdf);
    const content = st.find((x) => x.data.includes(' TJ'));
    assert.ok(content, 'Text im Inhalt');
    assert.match(content!.data, /BT \/F0 1 Tf 2 Tr/);
    const tu = st.find((x) => x.data.includes('beginbfchar'))!.data;
    const H = ttf.charToGlyph('H').index.toString(16).toUpperCase().padStart(4, '0');
    assert.ok(tu.includes(`<${H}> <0048>`), 'H in ToUnicode');
    const ae = ttf.charToGlyph('Ä').index.toString(16).toUpperCase().padStart(4, '0');
    assert.ok(tu.includes(`<${ae}> <00C4>`), 'Ä in ToUnicode');
    // Eingebettete Teilmenge ist eine gültige TrueType-Datei mit denselben Glyphen-IDs
    const prog = st.find((x) => x.dict.includes('/Length1'))!;
    const sub = Uint8Array.from(prog.data, (c) => c.charCodeAt(0));
    assert.ok(sub.length < ttfBytes.length, 'kleiner als die ganze Schrift');
    const sf = readSfnt(sub)!;
    assert.ok(sf && fontFacts(sf), 'lesbar');
    const subFont = parse(sub);
    assert.equal(subFont.numGlyphs, ttf.numGlyphs, 'Glyphen-IDs bleiben');
    assert.ok(subFont.glyphs.get(ttf.charToGlyph('H').index).getPath(0, 0, 10).commands.length > 0, 'H behalten');
    assert.equal(subFont.glyphs.get(ttf.charToGlyph('Z').index).getPath(0, 0, 10).commands.length, 0, 'Z geleert');
    assert.equal(subFont.charToGlyph('H').index, ttf.charToGlyph('H').index, 'cmap der Teilmenge');
    // Rundreise: dieselben Umrisse an derselben Stelle
    sameOutlines(it.outline, outlinesOf(await importPdf(pdf)), 2e-3);
  });

  await test('PDF-Text: gedreht, gestaucht (Höchstbreite), rechtsbündig und auf Pfad', async () => {
    const turn: Mat = [Math.cos(0.4), Math.sin(0.4), -Math.sin(0.4), Math.cos(0.4), 120, 90];
    const squeezed = textShape({ text: 'Breiter Text', maxW: 30, align: 'right' });
    const onPath = textShape({
      text: 'Bogen',
      align: 'center',
      path: { sub: { closed: false, nodes: [{ x: -30, y: 0, cout: { x: -15, y: -25 } }, { x: 30, y: 0, cin: { x: 15, y: -25 } }] }, offset: 0, dist: 0, flip: false },
    });
    const a = textItem(squeezed, ttf, ttfBytes, turn);
    const b = textItem(onPath, ttf, ttfBytes, [1, 0, 0, 1, 60, 150]);
    assert.ok(b.runs.length > 1 && b.runs.every((r) => r.glyphs.length === 1), 'auf Pfad je Glyphe ein Lauf');
    const pdf = buildPdf([{ name: 'p', items: [a, b] }], { bed, layers, realText: true });
    save('text-turned.pdf', pdf);
    sameOutlines([...a.outline, ...b.outline], outlinesOf(await importPdf(pdf)), 3e-3);
  });

  await test('PDF-Text: Linien-Layer als Kontur (1 Tr), geschweißter Text hat keine Glyphen', async () => {
    const it = textItem(textShape(), ttf, ttfBytes, [1, 0, 0, 1, 10, 20], 0, false);
    const pdf = buildPdf([{ name: 'p', items: [it] }], { bed, layers, realText: true });
    assert.match(streams(pdf).find((x) => x.data.includes(' TJ'))!.data, /1 Tr/);
    assert.equal(textGlyphRuns(textShape({ weld: true }), ttf), null);
  });

  await test('PDF-Text: Schrift mit Einbettungsverbot wird zu Umrissen', async () => {
    const locked = new Uint8Array(ttfBytes);
    const sf = readSfnt(locked)!;
    const os2 = sf.tables.get('OS/2')!;
    os2[8] = 0;
    os2[9] = 2; // fsType = 0x0002 (Restricted License)
    assert.equal(checkEmbeddable(locked), 'license');
    const it = textItem(textShape(), ttf, locked, [1, 0, 0, 1, 20, 40]);
    const why: string[] = [];
    const pdf = buildPdf([{ name: 'p', items: [it] }], { bed, layers, realText: true, onTextFallback: (r, f) => why.push(`${r}:${f}`) });
    assert.deepEqual(why, ['license:KenPixel']);
    assert.ok(!latin1(pdf).includes('/FontFile2'), 'keine Schrift eingebettet');
    sameOutlines(it.outline, outlinesOf(await importPdf(pdf)), 2e-4);
  });

  await test('PDF-Text: OpenType mit CFF wird ganz eingebettet (FontFile3 /OpenType)', async () => {
    // Kleine CFF-Schrift mit opentype.js bauen: .notdef, Leerzeichen, A, B
    const glyph = (name: string, unicode: number | undefined, pts: [number, number][]) => {
      const path = new opentype.Path();
      pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      if (pts.length) path.close();
      return new opentype.Glyph({ name, unicode, advanceWidth: 600, path });
    };
    const cffFont = new opentype.Font({
      familyName: 'Probe', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200,
      glyphs: [glyph('.notdef', undefined, []), glyph('space', 32, []), glyph('A', 65, [[50, 0], [300, 700], [550, 0]]), glyph('B', 66, [[50, 0], [50, 700], [500, 600], [500, 100]])],
    });
    const otf = new Uint8Array(cffFont.toArrayBuffer());
    assert.equal(latin1(otf.subarray(0, 4)), 'OTTO');
    const font = parse(otf);
    const ts = textShape({ text: 'AB BA', font: 'Probe', hSpace: 0 });
    const it = textItem(ts, font, otf, [1, 0, 0, 1, 30, 60]);
    const pdf = buildPdf([{ name: 'p', items: [it] }], { bed, layers, realText: true });
    save('text-cff.pdf', pdf);
    const s = latin1(pdf);
    assert.match(s, /\/Subtype \/CIDFontType0 /);
    assert.match(s, /\/FontFile3/);
    assert.match(s, /\/Subtype \/OpenType/);
    sameOutlines(it.outline, outlinesOf(await importPdf(pdf)), 2e-3);
  });

  await test('PDF-Text: WOFF wird entpackt, Sammlungen (.ttc) abgelehnt', async () => {
    const woff = new Uint8Array(readFileSync('node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff'));
    const sf = readSfnt(woff);
    assert.ok(sf && fontFacts(sf)?.kind === 'truetype', 'WOFF lesbar');
    assert.equal(readSfnt(new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1])), null);
    assert.equal(checkEmbeddable(new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1])), 'format');
    assert.match(toUnicodeCMap(new Map([[3, 'ﬁ'], [5, 'fi']])), /<0005> <00660069>/);
  });

  await test('PDF-Optionen: Seitengröße Inhalt mit Rand und Papier quer', () => {
    const its: ExportItem[] = [{ kind: 'path', subs: [rect], layer: 0, fill: false }];
    assert.deepEqual(itemsBounds(its), { x: 10, y: 10, w: 50, h: 30 });
    const c = pageFrame(its, { bed, pageSize: { kind: 'content', margin: 5 } });
    assert.deepEqual(c, { w: 60, h: 40, dx: -5, dy: -5 });
    const a4 = pageFrame(its, { bed, pageSize: { kind: 'paper', w: 210, h: 297 } });
    assert.equal(a4.w, 297, 'quer, weil der Inhalt breiter als hoch ist');
    near(a4.dx + 10 + 25, 297 / 2, 1e-9, 'mittig');
    const pdf = buildPdf([{ name: 'p', items: its }], { bed, layers, pageSize: { kind: 'content', margin: 5 } });
    assert.match(latin1(pdf), new RegExp(`/MediaBox \\[0 0 ${(60 * 72 / 25.4).toFixed(4).replace(/0+$/, '')} `));
  });

  await test('PDF-Optionen: Farben, Haarlinie, CutContour, ausgeschaltete und nicht druckende Ebenen, Metadaten', () => {
    const its: ExportItem[] = [
      { kind: 'path', subs: [rect], layer: 0, fill: false, op: 'cut' },
      { kind: 'path', subs: [circle], layer: 1, fill: true, op: 'engrave' },
      { kind: 'path', subs: [sCurve], layer: 5, fill: false, op: 'score' },
      { kind: 'path', subs: [mixed], layer: 2, fill: false, group: 'guides', color: [0, 150, 255], noBounds: true },
      { kind: 'note', layer: 0, group: 'notes', x: 5, y: 5, size: 3.5, lines: ['Material: Pappel', 'Größe (3 mm)'] },
    ];
    const pdf = buildPdf([{ name: 'p', items: its }], {
      bed, layers, colors: 'operation', stroke: lineWidthMm({ lineWeight: 'hairline', lineWidth: 0 }), cutContour: true, layersOff: [5],
      groups: [{ id: 'guides', name: 'Hilfslinien', print: false }, { id: 'notes', name: 'Notizen', print: false }, { id: 'unused', name: 'X' }],
      author: 'Hanjo', subject: 'Probe', keywords: 'Laser, Test',
    });
    save('options.pdf', pdf);
    const s = latin1(pdf);
    const c = streams(pdf).find((x) => x.data.includes('BDC'))!.data;
    assert.match(c, /^0\.0283 w/, 'Haarlinie 0,01 mm');
    assert.match(c, /\/OC \/L0 BDC\n\/CutContour CS 1 SCN\n/, 'Schnitt als Schmuckfarbe');
    assert.match(c, /\/OC \/L1 BDC\n0 0 0 RG 0 0 0 rg/, 'Gravur schwarz');
    assert.match(c, /\/OC \/L5 BDC\n0 0 1 RG/, 'Ritzen blau');
    assert.match(c, /\/OC \/Gguides BDC\n0 0\.5882 1 RG/, 'feste Farbe der Hilfslinien');
    assert.ok(c.includes('(Gr\\366\\337e \\(3 mm\\)) Tj'), 'Notiz in WinAnsi');
    assert.match(s, /\/Separation \/CutContour \/DeviceRGB/);
    assert.match(s, /\/BaseFont \/Helvetica/);
    assert.match(s, /\/Name \(Hilfslinien\) \/Usage << \/Print << \/PrintState \/OFF >>/);
    assert.ok(!s.includes('(X)'), 'unbenutzte Gruppe fehlt');
    const off = /\/OFF \[([^\]]*)\]/.exec(s)![1];
    const l5 = /(\d+) 0 obj\n<< \/Type \/OCG \/Name \(C05\) >>/.exec(s)![1];
    assert.ok(off.includes(`${l5} 0 R`), 'Layer 5 ausgeschaltet');
    assert.match(s, /\/Event \/Print/);
    assert.match(s, /\/Author \(Hanjo\) \/Subject \(Probe\) \/Keywords \(Laser, Test\)/);
  });

  await test('PDF-Optionen: Illustrator-Zeichenflächen legen die Seiten nebeneinander', async () => {
    const pdf = buildPdf(
      [
        { name: 'A', items: [{ kind: 'path', subs: [rect], layer: 0, fill: false }] },
        { name: 'B', items: [{ kind: 'path', subs: [rect], layer: 3, fill: false }] },
      ],
      { bed, layers, artboards: { gap: 20, group: 'frames' }, groups: [{ id: 'frames', name: 'Zeichenflächen', print: false }] },
    );
    save('artboards.ai', pdf);
    const r = await importPdf(pdf);
    assert.equal(r.pageCount, 1);
    near(r.pageSize.w, 300 * 2 + 20, 1e-3, 'Breite beider Seiten mit Abstand');
    const s = latin1(pdf);
    assert.ok(!s.includes('/PageLabels'));
    const c = streams(pdf).find((x) => x.data.includes('BDC'))!.data;
    assert.equal(c.match(/\/OC \/Gframes BDC/g)?.length, 2, 'zwei Rahmen');
    assert.equal(c.match(/ re W n/g)?.length, 2, 'je Seite beschnitten');
  });

  await test('PDF-Optionen: Bildauflösung begrenzen, Graustufenbild, Optionen bereinigen', () => {
    const big = { kind: 'image' as const, m: [25.4, 0, 0, 25.4, 0, 0] as Mat, layer: 0, pxW: 4, pxH: 4, rgb: new Uint8Array(48).fill(200), alpha: new Uint8Array(16).fill(255) };
    const small = limitImageDpi(big, 2);
    assert.equal(small.pxW, 2);
    assert.equal(small.rgb!.length, 12);
    assert.equal(small.rgb![0], 200);
    assert.equal(limitImageDpi(big, 0), big);
    const pdf = buildPdf([{ name: 'p', items: [{ kind: 'image', m: imgM, layer: 0, pxW: 2, pxH: 1, gray: new Uint8Array([0, 255]) }] }], { bed, layers });
    assert.match(latin1(pdf), /\/ColorSpace \/DeviceGray \/Filter \/FlateDecode \/Length/);
    const o = cleanPdfOptions({ scope: 'nope', margin: -4, imageDpi: 99999, realText: 'ja', title: 7, colors: 'black' });
    assert.equal(o.scope, PDF_EXPORT_DEFAULTS.scope);
    assert.equal(o.margin, 0);
    assert.equal(o.imageDpi, 4800);
    assert.equal(o.realText, false);
    assert.equal(o.title, '');
    assert.equal(o.colors, 'black');
    assert.equal(lineWidthMm({ lineWeight: 'custom', lineWidth: 0.25 }), 0.25);
  });

  await test('DXF: echter Text kommt als Umriss an', () => {
    const it = textItem(textShape(), ttf, ttfBytes, [1, 0, 0, 1, 20, 40]);
    const { text } = buildDxf([it, { kind: 'note', layer: 0, x: 0, y: 0, size: 3, lines: ['x'] }], layers, bed.h);
    const n = importDxf(text).items.filter((x) => x.kind === 'path').flatMap((x) => (x as ImportedPath).subs).length;
    assert.equal(n, it.outline.length);
  });
}

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
