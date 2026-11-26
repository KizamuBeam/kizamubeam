// Skizzen-Bestimmungsfarben: Strich bleibt Bestimmung (blau/neutral/grau), offene Enden
// bekommen Pfirsich-Marker statt Pfirsich-Strich. Aufruf: npm run test:sketch-definition
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const M = await import('../src/sketch/model');
const RND = await import('../src/editor/render');
const TYPO = await import('../src/uiTypography');
const I18N = await import('../src/i18n');
import type { Editor } from '../src/editor';
import type { Sketch } from '../src/sketch/model';

type Status = { ok: boolean; dof: number; conflicting: number[]; redundant: number[]; definition?: Map<number, 'fixed' | 'free'> };

function openChain(): { sk: Sketch; ids: number[] } {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0), c = M.addPt(sk, 10, 10);
  const l1 = M.addLine(sk, a.id, b.id), l2 = M.addLine(sk, b.id, c.id);
  return { sk, ids: [l1.id, l2.id] };
}

function closedRect(): { sk: Sketch; ids: number[] } {
  const sk = M.emptySketch();
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 10, 0), M.addPt(sk, 10, 10), M.addPt(sk, 0, 10)];
  const ids = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id).id);
  return { sk, ids };
}

/** renderSketch mit Stub-Canvas unter Nicht-Identitäts-View (Zoom/Offset/dpr gesetzt). */
function renderStrokes(sk: Sketch, status: Status, dark: boolean, sel: number[] = []) {
  const strokes: string[] = [], fills: string[] = [], arcs: number[] = [];
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'arc') return (_x: number, _y: number, r: number) => { arcs.push(r); };
      return () => {};
    },
    set(_t, prop, value) {
      if (prop === 'strokeStyle') strokes.push(String(value));
      if (prop === 'fillStyle') fills.push(String(value));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set(sel), hover: null, status, labels: [],
    tool: 'line', draft: [], draftIds: [], dimPick: [],
  };
  const ed = {
    dark, dpr: 2, view: { zoom: 2.5, ox: 73, oy: -31 }, w: 1600, h: 1200,
    typo: undefined, colors: {}, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    syncSketch() {}, skToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => 2.5,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = TYPO.resolveTypography({ workspace: 150 });
  (RND.EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void).call(ed, ctx);
  return { strokes, fills, arcs };
}

const FREE_LIGHT = '#2866b2', FREE_DARK = '#83b3f5';
const MARKER_LIGHT = '#FFC478', MARKER_DARK = '#E69A3C';
const NEUTRAL_LIGHT = '#222936';

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

test('freie offene Kette: blauer Strich, Pfirsich-Marker, kein Pfirsich-Strich', () => {
  const { sk, ids } = openChain();
  const definition = new Map(ids.map((id) => [id, 'free' as const]));
  const { strokes, fills, arcs } = renderStrokes(sk, { ok: true, dof: 1, conflicting: [], redundant: [], definition }, false);
  assert.ok(strokes.includes(FREE_LIGHT), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_LIGHT), JSON.stringify(strokes));
  assert.ok(fills.includes(MARKER_LIGHT), JSON.stringify(fills));
  assert.equal(arcs.length, 2, JSON.stringify(arcs));
  for (const r of arcs) assert.ok(Math.abs(r * 2.5 - 3.5) < 1e-9, `Marker nicht screen-konstant: r=${r}`);
});

test('freie offene Kette (dunkel): hellblauer Strich, dunkler Pfirsich-Marker', () => {
  const { sk, ids } = openChain();
  const definition = new Map(ids.map((id) => [id, 'free' as const]));
  const { strokes, fills } = renderStrokes(sk, { ok: true, dof: 1, conflicting: [], redundant: [], definition }, true);
  assert.ok(strokes.includes(FREE_DARK), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_DARK), JSON.stringify(strokes));
  assert.ok(fills.includes(MARKER_DARK), JSON.stringify(fills));
});

test('fixierte offene Kette: neutraler Strich plus Marker', () => {
  const { sk, ids } = openChain();
  const definition = new Map(ids.map((id) => [id, 'fixed' as const]));
  const { strokes, fills } = renderStrokes(sk, { ok: true, dof: 0, conflicting: [], redundant: [], definition }, false);
  assert.ok(strokes.includes(NEUTRAL_LIGHT), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_LIGHT), JSON.stringify(strokes));
  assert.ok(fills.includes(MARKER_LIGHT), JSON.stringify(fills));
});

test('geschlossene freie Kette: blauer Strich, kein Marker', () => {
  const { sk, ids } = closedRect();
  const definition = new Map(ids.map((id) => [id, 'free' as const]));
  const { strokes, fills, arcs } = renderStrokes(sk, { ok: true, dof: 1, conflicting: [], redundant: [], definition }, false);
  assert.ok(strokes.includes(FREE_LIGHT), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_LIGHT) && !fills.includes(MARKER_LIGHT), JSON.stringify({ strokes, fills }));
  assert.equal(arcs.length, 0, JSON.stringify(arcs));
});

test('Auswahl über offener Kette: Orange-Strich, Marker bleibt sichtbar', () => {
  const { sk, ids } = openChain();
  const definition = new Map(ids.map((id) => [id, 'free' as const]));
  const { strokes, fills } = renderStrokes(sk, { ok: true, dof: 1, conflicting: [], redundant: [], definition }, false, [ids[0]]);
  assert.ok(strokes.includes('#ff6020'), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_LIGHT), JSON.stringify(strokes));
  assert.ok(fills.includes(MARKER_LIGHT), JSON.stringify(fills));
});

test('Konflikt schlägt Bestimmung, kein Pfirsich-Strich', () => {
  const { sk, ids } = openChain();
  const con = M.addCon(sk, 'horizontal', [ids[0]]);
  const definition = new Map(ids.map((id) => [id, 'free' as const]));
  const { strokes } = renderStrokes(sk, { ok: false, dof: 0, conflicting: [con.id], redundant: [], definition }, false);
  assert.ok(strokes.includes('#b52626'), JSON.stringify(strokes));
  assert.ok(!strokes.includes(MARKER_LIGHT), JSON.stringify(strokes));
});

test('offene Enden: zwei bei offener Kette, keine bei geschlossener', () => {
  assert.equal(RND.sketchOpenEndPts(openChain().sk).length, 2);
  assert.equal(RND.sketchOpenEndPts(closedRect().sk).length, 0);
});

test('Kontrast: Bestimmungswerte paarweise verschieden, keine Kollision mit Rot/Orange', () => {
  const c = RND.SKETCH_STATE_COLORS;
  const all = [c.free.light, c.free.dark, c.unknown.light, c.unknown.dark, c.openMarker.light, c.openMarker.dark];
  assert.equal(new Set(all).size, all.length, JSON.stringify(all));
  const reserved = ['#ff6020', '#d0451b', '#b52626', '#ff7777', '#222936', '#e4e9f0'];
  for (const v of all) assert.ok(!reserved.includes(v), v);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const key of ['light', 'dark'] as const) {
    const [r, g, b] = rgb(c.unknown[key]);
    assert.equal(r, g, 'Grau entsättigt (hell/dunkel)');
    assert.equal(g, b, 'Grau entsättigt (hell/dunkel)');
    const [fr, , fb] = rgb(c.free[key]);
    assert.ok(fb > fr, 'Blau klar gesättigt, Blaustich statt Rot');
  }
});

test('Status-Texte: Keys mit Platzhalter in allen Locales, t() setzt die Zahl ein', () => {
  const under = 'Unterbestimmt · {n} Freiheitsgrade', full = 'Vollständig bestimmt';
  for (const lang of ['en', 'es', 'it', 'pt-BR']) {
    const dict = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/locales/${lang}.json`, import.meta.url)), 'utf8')) as Record<string, string>;
    for (const key of [under, full]) assert.ok(dict[key], `${lang}: fehlt ${key}`);
    assert.ok(dict[under].includes('{n}'), `${lang}: Platzhalter {n} fehlt in ${JSON.stringify(dict[under])}`);
  }
  const text = I18N.t(under, { n: 3 });
  assert.ok(text.includes('3') && !text.includes('{n}'), JSON.stringify(text));
  assert.ok(I18N.t(full).length > 0);
});

test('Panel-Verdrahtung (statisch): persistenter Status außerhalb des Solver-Popups', () => {
  // sketchPanel.ts braucht DOM/Vite (?url-Wasm) und läuft nicht unter run-ts.mjs; darum nur
  // Verdrahtungsnachweis — das Verhalten prüfen die Render- und Locale-Tests oben.
  const src = readFileSync(fileURLToPath(new URL('../src/sketchPanel.ts', import.meta.url)), 'utf8');
  // Langtexte kommen aus dem geteilten Helper (sketchStatusInfo mit Lage-frei-Probe),
  // nicht mehr aus Inline-t() — der persistente stateLabel nutzt denselben Pfad.
  const side = readFileSync(fileURLToPath(new URL('../src/sketch/sidepanel.ts', import.meta.url)), 'utf8');
  assert.ok(side.includes("t('Unterbestimmt · {n} Freiheitsgrade'"), 'persistenter DOF-Text fehlt (sidepanel-Helper)');
  assert.ok(side.includes("t('Vollständig bestimmt')"), 'Voll-bestimmt-Text fehlt (sidepanel-Helper)');
  assert.ok(side.includes("t('Form bestimmt · Lage frei · {n} Freiheitsgrade'"), 'Lage-frei-Text fehlt (sidepanel-Helper)');
  assert.ok(src.includes('sketchStatusInfo('), 'Leiste muss den geteilten Status-Helper nutzen');
  const rowAt = src.indexOf("bar.append(h('div', { class: 'sketch-row' }");
  assert.ok(rowAt > 0 && src.slice(rowAt, rowAt + 400).includes('stateLabel'),
    'Status muss in der Leisten-Zeile (außerhalb des Popups) stehen');
  const noteAt = src.indexOf("class: 'note'");
  assert.ok(noteAt > 0 && !src.slice(noteAt, noteAt + 600).includes('stateLabel'),
    'Status darf nicht im eingeklappten Hinweis stecken');
});

if (failed) process.exit(1);
