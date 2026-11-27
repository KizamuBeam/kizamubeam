// Tests für die Vorschau des internen Öffnen-Dialogs (reine Einleselogik, ohne Editor).
// Aufruf: npm run test:project-open
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { parsePreviewProject, filterVisibleTree, svgPreviewProject } = await import('../src/projectPreview');
const { normalizeFavorites, toggleFavorite, MAX_FAVORITES, isHiddenEntry, visibleEntries } =
  await import('../src/projectOpenFiles');

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

const kzb = (pages: string[], page: number) =>
  JSON.stringify({ version: 2, bed: { w: 400, h: 300 }, pages, page, layers: {} });

await test('KizamuBeam: mehrere Seiten, Start bei gespeicherter aktiver Seite', async () => {
  const p = await parsePreviewProject(
    kzb(
      [
        { name: 'Seite 1', objs: [] },
        { name: 'Deckel', objs: [{ id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 10, h: 5 } }] },
      ] as unknown as string[],
      1,
    ),
    'box.kzb',
    { w: 400, h: 300 },
  );
  assert.equal(p.pages.length, 2);
  assert.equal(p.startPage, 1);
  assert.equal(p.pages[1].name, 'Deckel');
  assert.equal(p.pages[1].objs.length, 1);
});

await test('KizamuBeam: alte Datei mit objs wird eine Seite, ungültiges JSON wirft', async () => {
  const p = await parsePreviewProject(
    JSON.stringify({ bed: { w: 100, h: 100 }, objs: [] }),
    'alt.json',
    { w: 100, h: 100 },
  );
  assert.equal(p.pages.length, 1);
  assert.equal(p.startPage, 0);
  await assert.rejects(() => parsePreviewProject('kein json', 'x.kzb', { w: 1, h: 1 }));
});

const LBRN = `<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="1.5.06" FormatVersion="1">
    <CutSetting type="Cut"><index Value="0"/><name Value="C00"/><maxPower Value="80"/><speed Value="30"/></CutSetting>
    <Shape Type="Rect" CutIndex="0" W="10" H="5"><XForm>1 0 0 1 0 0</XForm></Shape>
</LightBurnProject>`;

await test('LightBurn: genau eine Seite, Objekte vorhanden, kein Editor-Register nötig', async () => {
  const p = await parsePreviewProject(LBRN, 'schild.lbrn', { w: 400, h: 300 });
  assert.equal(p.pages.length, 1);
  assert.equal(p.startPage, 0);
  assert.ok(p.pages[0].objs.length > 0);
});

await test('filterVisibleTree: versteckte Objekte und Ebenen entfallen, Gruppen bleiben', () => {
  const objs = [
    { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 4, h: 4 } },
    { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 1, hidden: true, shape: { kind: 'rect', w: 4, h: 4 } },
    { id: 3, m: [1, 0, 0, 1, 0, 0], layer: 2, shape: { kind: 'rect', w: 4, h: 4 } },
  ] as unknown as Parameters<typeof filterVisibleTree>[0];
  const layers = { 2: { show: false } } as unknown as Parameters<typeof filterVisibleTree>[1];
  const kept = filterVisibleTree(objs, layers);
  assert.deepEqual(kept.map((o) => (o as { id: number }).id), [1]);
});

const { ancestorsOf, baseName, filterFiles, formatSize, sortFiles } = await import('../src/projectOpenFiles');

await test('ancestorsOf: POSIX, Wurzel und Windows-Laufwerk', () => {
  assert.deepEqual(ancestorsOf('/a/b'), ['/', '/a', '/a/b']);
  assert.deepEqual(ancestorsOf('/'), ['/']);
  assert.deepEqual(ancestorsOf('C:\\Users\\sven\\a'), ['C:/', 'C:/Users', 'C:/Users/sven', 'C:/Users/sven/a']);
  assert.deepEqual(ancestorsOf('C:\\'), ['C:/']);
});

await test('filterFiles/sortFiles: Suche, Schlüssel, Nullwerte hinten', () => {
  const files = [
    { name: 'b.kzb', path: '/b.kzb', size: 2000, modified_ms: 300 },
    { name: 'a.lbrn2', path: '/a.lbrn2', size: null, modified_ms: 100 },
    { name: 'C.kzb', path: '/C.kzb', size: 500, modified_ms: null },
  ];
  assert.deepEqual(filterFiles(files, 'kzb').map((f) => f.name), ['b.kzb', 'C.kzb']);
  assert.deepEqual(filterFiles(files, '  A.LBRN2 ').map((f) => f.name), ['a.lbrn2']);
  assert.deepEqual(sortFiles(files, 'name', 1).map((f) => f.name), ['a.lbrn2', 'b.kzb', 'C.kzb']);
  assert.deepEqual(sortFiles(files, 'size', 1).map((f) => f.name), ['C.kzb', 'b.kzb', 'a.lbrn2']);
  assert.deepEqual(sortFiles(files, 'size', -1).map((f) => f.name), ['a.lbrn2', 'b.kzb', 'C.kzb']);
  assert.deepEqual(sortFiles(files, 'modified', 1).map((f) => f.name), ['a.lbrn2', 'b.kzb', 'C.kzb']);
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(null), '–');
  assert.equal(baseName('/a/b'), 'b');
  assert.equal(baseName('C:\\Users\\sven'), 'sven');
  assert.equal(baseName('/'), '/');
});

await test('SVG: Importergebnis wird eine Vorschau-Seite (Pfade, eingebettete Bilder)', () => {
  const p = svgPreviewProject(
    {
      items: [
        { kind: 'path', subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }] }], layer: 2 },
        { kind: 'image', href: 'data:image/png;base64,xx', m: [2, 0, 0, 2, 1, 1], layer: 0 },
        { kind: 'image', href: 'bild.png', m: [1, 0, 0, 1, 0, 0], layer: 0 },
      ],
      notes: [],
    },
    'logo.svg',
    { w: 400, h: 300 },
  );
  assert.equal(p.pages.length, 1);
  assert.equal(p.startPage, 0);
  assert.equal(p.fileName, 'logo.svg');
  assert.equal(p.pages[0].objs.length, 3);
  assert.equal(p.pages[0].objs[0].layer, 2);
  assert.equal(p.assets.size, 1);
  assert.ok(p.assets.has('svg-img-1'));
});

await test('Favoriten: bereinigen, umschalten, begrenzen', () => {
  assert.deepEqual(normalizeFavorites(null), []);
  assert.deepEqual(normalizeFavorites(['/a', '', '/a', '  ', 7, '/b']), ['/a', '/b']);
  assert.equal(MAX_FAVORITES, 32);
  const many = Array.from({ length: 40 }, (_, i) => `/d${i}`);
  assert.equal(normalizeFavorites(many).length, 32);
  let r = toggleFavorite([], '/a');
  assert.deepEqual(r, { list: ['/a'], added: true });
  r = toggleFavorite(r.list, '/a');
  assert.deepEqual(r, { list: [], added: false });
  r = toggleFavorite(['/a'], '  ');
  assert.deepEqual(r, { list: ['/a'], added: false });
});

await test('Hidden entries: backend flag wins, dot name as fallback', () => {
  assert.equal(isHiddenEntry({ name: '.config' }), true);
  assert.equal(isHiddenEntry({ name: 'Library', hidden: true }), true);
  assert.equal(isHiddenEntry({ name: '.odd', hidden: false }), false);
  assert.equal(isHiddenEntry({ name: 'Documents' }), false);
});

await test('Hidden entries: filtered by default, shown on request, current path kept', () => {
  const dirs = [
    { name: '.cache', path: '/Users/a/.cache', hidden: true },
    { name: '.ssh', path: '/Users/a/.ssh', hidden: true },
    { name: 'Desktop', path: '/Users/a/Desktop', hidden: false },
  ];
  assert.deepEqual(visibleEntries(dirs, false).map((d) => d.name), ['Desktop']);
  assert.equal(visibleEntries(dirs, true).length, 3);
  const keep = new Set(ancestorsOf('/Users/a/.cache/sub'));
  assert.deepEqual(visibleEntries(dirs, false, keep).map((d) => d.name), ['.cache', 'Desktop']);
  // Windows paths compare with forward slashes like ancestorsOf
  const win = [{ name: 'AppData', path: 'C:\\Users\\a\\AppData', hidden: true }];
  assert.equal(visibleEntries(win, false, new Set(ancestorsOf('C:\\Users\\a\\AppData\\Local'))).length, 1);
});

await test('Search filter works for folders and files alike', () => {
  const dirs = [{ name: 'Projekte', path: '/p' }, { name: 'Fotos', path: '/f' }];
  assert.deepEqual(filterFiles(dirs, 'proj').map((d) => d.name), ['Projekte']);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
