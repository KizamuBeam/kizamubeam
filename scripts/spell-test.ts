// Tests für die mehrsprachige Rechtschreibprüfung (Tokenizer, Benutzerwörterbuch, Cache & Konstruktionsprüfung).
// Aufruf: npm run test:spell
import './core-fixtures-env';
import { strict as assert } from 'node:assert';

// Minimaler localStorage + Canvas-Stub für Node
const store = new Map<string, string>();
{
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  const doc = (g.document ?? {}) as { createElement?: (tag: string) => unknown; documentElement?: { lang: string } };
  doc.documentElement ??= { lang: '' };
  const prev = doc.createElement;
  doc.createElement = (tag: string) => {
    if (tag === 'canvas') return { getContext: () => ({ font: '', measureText: (s: string) => ({ width: [...s].length * 6 }) }), style: {} };
    return prev ? prev(tag) : { style: {} };
  };
  g.document = doc;
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    closePath() {}
    rect() {}
  };
}

const spell = await import('../src/spell');
const { checkDesign, checkSpelling, DEFAULT_CHECK, fixLabel } = await import('../src/check');
const { defaultLayer, translate } = await import('../src/model');
import type { Obj } from '../src/model';

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

function makeMockBackend() {
  const dicts: Record<string, Set<string>> = {
    de: new Set(['Holz', 'Gravur', 'Werkstatt', 'Schneidebrett', 'Straße', 'Äpfel', 'WERKSTATT']),
    en: new Set(['wood', 'laser', 'workshop', 'engraving']),
  };
  const installed = new Set<string>(['de']);
  return {
    installed,
    backend: {
      listInstalled: async () => [...installed].sort(),
      download: async (code: string) => { installed.add(code); },
      remove: async (code: string) => { installed.delete(code); },
      checkWords: async (langs: string[], words: string[]) =>
        words.filter((w) => !langs.some((l) => installed.has(l) && dicts[l]?.has(w))),
      suggest: async (langs: string[], word: string, limit = 5) => {
        const out: string[] = [];
        if (langs.includes('de') && word === 'Werkstat') out.push('Werkstatt');
        if (langs.includes('en') && word === 'workshpo') out.push('workshop');
        return out.slice(0, limit);
      },
    },
  };
}

await test('extractWords preserves UTF-16 offsets and skips placeholders/codes/URLs', () => {
  const txt = 'Hallo Straße! {Breite + 1} %# %4# %Y %{Name} 12mm A4 CNC WERKSTATT https://example.com a@b.de Holz-Laser';
  const spans = spell.extractWords(txt, true);
  assert.deepEqual(
    spans.map((s) => s.word),
    ['Hallo', 'Straße', 'WERKSTATT', 'Holz-Laser'],
  );
  for (const s of spans) {
    assert.equal(txt.slice(s.start, s.end), s.word);
  }
});

await test('extractWords keeps %Y literals when hasVt is false', () => {
  const txt = 'Rabatt %Y Test';
  const withVt = spell.extractWords(txt, true).map((s) => s.word);
  const withoutVt = spell.extractWords(txt, false).map((s) => s.word);
  assert.deepEqual(withVt, ['Rabatt', 'Test']);
  assert.deepEqual(withoutVt, ['Rabatt', 'Test']); // single letter Y skipped anyway
  const vtCol = spell.extractWords('Hallo %{Kunde} Welt', true).map((s) => s.word);
  const noVtCol = spell.extractWords('Hallo %{Kunde} Welt', false).map((s) => s.word);
  assert.deepEqual(vtCol, ['Hallo', 'Welt']);
  assert.deepEqual(noVtCol, ['Hallo', 'Kunde', 'Welt']);
});

await test('defaultDictForLang maps app locales to catalog codes', () => {
  assert.equal(spell.defaultDictForLang('de'), 'de');
  assert.equal(spell.defaultDictForLang('de-AT'), 'de-AT');
  assert.equal(spell.defaultDictForLang('pt-BR'), 'pt');
  assert.equal(spell.defaultDictForLang('en-GB'), 'en-GB');
  assert.equal(spell.defaultDictForLang('fr-CA'), 'fr');
  assert.equal(spell.defaultDictForLang('zz-ZZ'), 'en');
});

await test('replaceWordSpan replaces exact word and rejects stale offset', () => {
  assert.equal(spell.replaceWordSpan('Meine Werkstat!', 6, 14, 'Werkstat', 'Werkstatt'), 'Meine Werkstatt!');
  assert.equal(spell.replaceWordSpan('Meine Werkstatt!', 6, 14, 'Werkstat', 'Werkstatt'), null);
});

await test('multi-language checkTextAsync, downloadDict, user dictionary and session ignore', async () => {
  store.clear();
  const mock = makeMockBackend();
  spell.setSpellBackendForTests(mock.backend);
  spell.saveSpellSettings({ enabled: true, langs: ['de'], userWords: [] });

  // Mit nur DE ist 'workshop' unbekannt
  let bad = await spell.checkTextAsync('Holz workshop Werkstat');
  assert.deepEqual(bad.map((x) => x.word), ['workshop', 'Werkstat']);

  // EN nachladen -> automatisch aktiviert -> 'workshop' ist jetzt korrekt
  await spell.downloadDict('en');
  assert.ok(spell.loadSpellSettings().langs.includes('en'));
  bad = await spell.checkTextAsync('Holz workshop Werkstat');
  assert.deepEqual(bad.map((x) => x.word), ['Werkstat']);

  // Vorschlag abrufen
  const sugg = await spell.suggestWord('Werkstat');
  assert.deepEqual(sugg, ['Werkstatt']);

  // Ins Benutzerwörterbuch aufnehmen -> nicht mehr markiert
  spell.addUserWord('Werkstat');
  bad = await spell.checkTextAsync('Holz workshop Werkstat');
  assert.deepEqual(bad, []);
  spell.removeUserWord('Werkstat');

  // Für Sitzung ignorieren -> ebenfalls nicht markiert
  spell.ignoreWordForSession('Werkstat');
  bad = await spell.checkTextAsync('Holz workshop Werkstat');
  assert.deepEqual(bad, []);

  // Wörterbuch entfernen nimmt es auch aus aktiven Sprachen
  await spell.removeDict('en');
  assert.ok(!spell.loadSpellSettings().langs.includes('en'));
});

await test('checkTextCached triggers async prefetch and notifies onSpellUpdated', async () => {
  store.clear();
  const mock = makeMockBackend();
  spell.setSpellBackendForTests(mock.backend);
  spell.saveSpellSettings({ enabled: true, langs: ['de'], userWords: [] });

  let updates = 0;
  const unsub = spell.onSpellUpdated(() => updates++);
  // 1. Durchlauf: Wörterbuchliste wird geladen
  assert.equal(spell.checkTextCached('Holz Werkstat'), null);
  await new Promise((r) => setTimeout(r, 40));
  // 2. Durchlauf: Wörter werden zum Prefetch eingereiht
  assert.deepEqual(spell.checkTextCached('Holz Werkstat'), []);
  await new Promise((r) => setTimeout(r, 80));
  // 3. Durchlauf: Befund + Vorschlag sind im Cache
  const cached = spell.checkTextCached('Holz Werkstat');
  assert.ok(cached && cached.length === 1 && cached[0].word === 'Werkstat');
  assert.deepEqual(cached[0].suggestions, ['Werkstatt']);
  assert.ok(updates >= 2);
  unsub();
});

await test('checkDesign disables spelling by default and reports info-level finding when enabled', () => {
  assert.equal(DEFAULT_CHECK.checkSpelling, false);
  const textObj: Obj = {
    id: 1,
    m: translate(20, 20),
    layer: 0,
    shape: { kind: 'text', text: 'Holz Werkstat', font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0 },
  };
  const layer = (i: number) => defaultLayer(i);
  const stubCheck = (text: string) => {
    const idx = text.indexOf('Werkstat');
    return idx >= 0 ? [{ word: 'Werkstat', start: idx, end: idx + 8, suggestions: ['Werkstatt'] }] : [];
  };

  // Standardmäßig aus -> keine Rechtschreib-Befunde
  const offIssues: import('../src/check').CheckIssue[] = [];
  checkSpelling({ objs: [textObj], layer, bed: { w: 200, h: 200 }, settings: { ...DEFAULT_CHECK } }, offIssues, stubCheck);
  assert.equal(offIssues.length, 0);

  // Aktiviert -> Hinweis (level === 'info') + Fix mit Vorschlag
  const onIssues: import('../src/check').CheckIssue[] = [];
  checkSpelling({ objs: [textObj], layer, bed: { w: 200, h: 200 }, settings: { ...DEFAULT_CHECK, checkSpelling: true } }, onIssues, stubCheck);
  assert.equal(onIssues.length, 1);
  assert.equal(onIssues[0].kind, 'spelling');
  assert.equal(onIssues[0].level, 'info');
  assert.ok(onIssues[0].fix && onIssues[0].fix.kind === 'spell');
  assert.equal(onIssues[0].fix.replacement, 'Werkstatt');
  assert.ok(fixLabel(onIssues[0].fix).includes('Werkstatt'));

  // Komplettes checkDesign nutzt den vorgewärmten Cache aus dem vorherigen Test
  const designIssues = checkDesign({
    objs: [textObj],
    layer,
    bed: { w: 200, h: 200 },
    settings: { ...DEFAULT_CHECK, checkSpelling: true },
  }).filter((x) => x.kind === 'spelling');
  assert.equal(designIssues.length, 1);
  assert.equal(designIssues[0].level, 'info');
  assert.ok(designIssues[0].fix && designIssues[0].fix.kind === 'spell' && designIssues[0].fix.replacement === 'Werkstatt');

  // Layer ohne Ausgabe wird übersprungen
  const noOut: import('../src/check').CheckIssue[] = [];
  checkSpelling(
    { objs: [textObj], layer: (i) => ({ ...defaultLayer(i), output: false }), bed: { w: 200, h: 200 }, settings: { ...DEFAULT_CHECK, checkSpelling: true } },
    noOut,
    stubCheck,
  );
  assert.equal(noOut.length, 0);
});

spell.setSpellBackendForTests(null);
if (failed) process.exit(1);
console.log('Alle Rechtschreib-Tests bestanden.');
process.exit(0);
