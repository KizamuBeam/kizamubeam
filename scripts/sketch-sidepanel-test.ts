// CAD-Seitenmenü der Skizze (B-96): Linientypen, Sichtbarkeit, Status, Einpassen.
// Aufruf: npm run test:sketch-sidepanel (rot-vor-grün: scheitert bis src/sketch/sidepanel.ts existiert)
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const M = await import('../src/sketch/model');
const SP = await import('../src/sketch/sidepanel');
const S = await import('../src/sketch/solver');
const RND = await import('../src/editor/render');
const TYPO = await import('../src/uiTypography');
const I18N = await import('../src/i18n');
import type { Editor } from '../src/editor';
import type { Sketch } from '../src/sketch/model';

S.setSolverWasm(resolve('node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'));
await S.loadSolver();

let failed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  pending.push((async () => {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
  })());
}
function rectSketch(): { sk: Sketch; lines: number[] } {
  const sk = M.emptySketch();
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 10, 0), M.addPt(sk, 10, 10), M.addPt(sk, 0, 10)];
  const lines = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id).id);
  return { sk, lines };
}

/** renderSketch mit aufzeichnendem Fake-Canvas (Zoom != 1, Offset, dpr 2). */
function renderRecord(sk: Sketch, status: { ok: boolean; dof: number; conflicting: number[]; redundant: number[] }, flags: Record<string, boolean> = {}) {
  const calls: { op: string; args: number[] | string }[] = [];
  const dashes: number[][] = [];
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'setLineDash') return (d: number[]) => { dashes.push([...d]); };
      if (prop === 'canvas') return undefined;
      return (...args: number[]) => { calls.push({ op: String(prop), args }); };
    },
    set(_t, prop, value) {
      calls.push({ op: `set:${String(prop)}`, args: String(value) });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sketchEdit = {
    sk, m: [1, 0, 0, 1, 0, 0], sel: new Set<number>(), hover: null, status, labels: [],
    tool: 'line', draft: [], draftIds: [], dimPick: [],
    showRelations: true, showDims: true, showPoints: true, showConstruction: true, ...flags,
  };
  const ed = {
    dark: false, dpr: 2, view: { zoom: 2.5, ox: 73, oy: -31 }, w: 1600, h: 1200,
    typo: undefined, colors: {}, cursor: { x: 0, y: 0 }, cursorOnCanvas: false,
    syncSketch() {}, skToScreen: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }), skScale: () => 2.5,
    sketchEdit,
  } as unknown as Editor;
  (ed as unknown as { typo: unknown }).typo = TYPO.resolveTypography({ workspace: 150 });
  (RND.EditorRender.prototype.renderSketch as unknown as (this: Editor, ctx: CanvasRenderingContext2D) => void).call(ed, ctx);
  return { calls, dashes };
}
const strokesOf = (calls: { op: string; args: number[] | string }[]) =>
  calls.filter((c) => c.op === 'set:strokeStyle').map((c) => String(c.args));

test('Linientyp neu: centerline-Flag sitzt, aux bleibt unberührt', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const l = M.addLine(sk, a.id, b.id);
  const r = SP.setSketchLineType(sk, [l.id], 'centerline');
  assert.deepEqual(r, { applied: [l.id], skipped: [] });
  const e = M.entOf(sk, l.id)!;
  assert.equal(e.t, 'line');
  assert.ok(e.t === 'line' && e.centerline === true);
  assert.ok(!e.aux, 'aux bleibt separat bestehen (nicht gesetzt)');
});

test('Linientyp neu: infinite-Flag sitzt, löscht centerline', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  const l = M.addLine(sk, a.id, b.id);
  SP.setSketchLineType(sk, [l.id], 'centerline');
  SP.setSketchLineType(sk, [l.id], 'infinite');
  const e = M.entOf(sk, l.id)!;
  assert.ok(e.t === 'line' && e.infinite === true && !e.centerline);
});

test('Linientyp Auswahl: nur Linien geeignet, Rest meldet Hint', () => {
  const { sk, lines } = rectSketch();
  const c = M.addCircle(sk, sk.pts[0].id, 5);
  const r = SP.setSketchLineType(sk, [...lines.slice(0, 1), c.id], 'infinite');
  assert.deepEqual(r.applied, [lines[0]]);
  assert.deepEqual(r.skipped, [c.id]);
  const e = M.entOf(sk, c.id)!;
  assert.ok(!(e.t === 'line' && e.infinite), 'Kreis bleibt unverändert');
});

test('Linientyp normal/Konstruktion wirken auf alle Entities, aux separat', () => {
  const { sk, lines } = rectSketch();
  const c = M.addCircle(sk, sk.pts[0].id, 5);
  SP.setSketchLineType(sk, [lines[0], c.id], 'construction');
  assert.ok(M.entOf(sk, lines[0])!.aux && M.entOf(sk, c.id)!.aux);
  SP.setSketchLineType(sk, [lines[0], c.id], 'normal');
  assert.ok(!M.entOf(sk, lines[0])!.aux && !M.entOf(sk, c.id)!.aux);
});

test('Profile und Ausgabe schließen centerline/infinite wie aux aus', () => {
  const { sk, lines } = rectSketch();
  SP.setSketchLineType(sk, [lines[0]], 'centerline');
  SP.setSketchLineType(sk, [lines[1]], 'infinite');
  const subs = M.sketchSubs(sk);
  // offene Kette aus 2 Rest-Linien statt Rechteck
  assert.ok(subs.length === 1 && !subs[0].closed, JSON.stringify(subs.map((s) => s.closed)));
  assert.ok(!M.openSketchEntIds(sk).has(lines[0]) && !M.openSketchEntIds(sk).has(lines[1]));
});

test('Sichtbarkeit ändert nur Render: Geometrie-JSON identisch', () => {
  const { sk, lines } = rectSketch();
  SP.setSketchLineType(sk, [lines[0]], 'centerline');
  const before = M.sketchJson(sk);
  const hidden = { relations: true, dims: true, points: true, construction: false };
  assert.ok(!SP.isEntVisible(M.entOf(sk, lines[0])!, hidden));
  assert.ok(SP.isEntVisible(M.entOf(sk, lines[2])!, hidden));
  assert.equal(M.sketchJson(sk), before, 'reine Anzeige, keine Geometrieänderung');
  const { calls } = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, { showConstruction: false });
  const strokes = strokesOf(calls);
  assert.ok(strokes.length > 0, 'sichtbare Linien werden weiter gezeichnet');
});

test('versteckte Konstruktionsgeometrie wird nicht gezeichnet', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  M.addLine(sk, a.id, b.id, true);
  const shown = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, {});
  const hidden = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, { showConstruction: false });
  assert.ok(strokesOf(shown.calls).length > 0, 'aux sichtbar gezeichnet');
  assert.ok(hidden.calls.length < shown.calls.length, 'weniger Zeichenaufrufe ohne Konstruktion');
});

test('Sichtbarkeit Punkte/Bemaßungen/Beziehungen blendet nur diese aus', () => {
  const sk = M.emptySketch();
  const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
  M.addLine(sk, a.id, b.id);
  M.addCon(sk, 'distance', [a.id, b.id], { v: 10 });
  const all = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, {});
  const noDims = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, { showDims: false });
  assert.ok(noDims.calls.length < all.calls.length, 'Bemaßungen ausgeblendet');
  const noPts = renderRecord(sk, { ok: true, dof: 1, conflicting: [], redundant: [] }, { showPoints: false });
  assert.ok(noPts.calls.length < all.calls.length, 'Punkte ausgeblendet');
});

test('Snap-Schalter: Standard an, explizit aus', () => {
  assert.ok(SP.sketchSnapActive({}), 'Default: Fangen an');
  assert.ok(SP.sketchSnapActive({ sketchSnap: true }));
  assert.ok(!SP.sketchSnapActive({ sketchSnap: false }));
});

test('Status-Texte: leer, unausgewertet, Konflikt, voll, unterbestimmt', () => {
  const empty = SP.sketchStatusInfo(M.emptySketch(), null, null);
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.text, I18N.t('Noch keine Geometrie'));
  const { sk } = rectSketch();
  const unevaluated = SP.sketchStatusInfo(sk, null, null);
  assert.equal(unevaluated.kind, 'unevaluated');
  assert.equal(unevaluated.progress, null, 'ohne Start-Basis kein Balken');
  const conflict = SP.sketchStatusInfo(sk, { ok: false, dof: 2, conflicting: [1], redundant: [] }, 6);
  assert.equal(conflict.kind, 'conflict');
  const full = SP.sketchStatusInfo(sk, { ok: true, dof: 0, conflicting: [], redundant: [] }, 6);
  assert.equal(full.kind, 'full');
  assert.equal(full.text, I18N.t('Vollständig bestimmt'));
  assert.equal(full.progress, 1);
  const free = SP.sketchStatusInfo(sk, { ok: true, dof: 2, conflicting: [], redundant: [] }, 8);
  assert.equal(free.kind, 'free');
  assert.equal(free.text, I18N.t('Unterbestimmt · {n} Freiheitsgrade', { n: 2 }));
  assert.ok(Math.abs(free.progress! - 0.75) < 1e-9, `1-Rest/Start erwartet, ist ${free.progress}`);
  const noBasis = SP.sketchStatusInfo(sk, { ok: true, dof: 2, conflicting: [], redundant: [] }, null);
  assert.equal(noBasis.progress, null, 'Balken ohne Start-Basis ausblenden, keine erfundenen Prozente');
});

test('Status Lage-frei: Rechteck H/V + Maße zeigt Form-bestimmt-Text (n=2)', () => {
  const sk = M.emptySketch();
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 125, 0), M.addPt(sk, 125, 125), M.addPt(sk, 0, 125)];
  const lines = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id).id);
  M.addCon(sk, 'horizontal', [lines[0]]);
  M.addCon(sk, 'horizontal', [lines[2]]);
  M.addCon(sk, 'vertical', [lines[1]]);
  M.addCon(sk, 'vertical', [lines[3]]);
  M.addCon(sk, 'distance', [lines[0]], { v: 125 });
  M.addCon(sk, 'distance', [lines[1]], { v: 125 });
  const st = S.solveSketch(sk);
  assert.ok(st.ok && st.dof === 2, `Rechteck H/V + Maße: dof 2 erwartet, ist ok=${st.ok} dof=${st.dof}`);
  const probe = () => {
    const clone = M.cloneSketch(sk);
    const pt = clone.pts[0];
    clone.cons.push({ id: clone.next++, t: 'fixed', r: [pt.id], x: pt.x, y: pt.y });
    const r = S.solveSketch(clone);
    return r.ok ? r.dof : null;
  };
  assert.equal(probe(), 0, 'Probe mit fixiertem Punkt löst Lage-DOF auf');
  const json = M.sketchJson(sk);
  const info = SP.sketchStatusInfo(sk, st, null, probe);
  assert.equal(info.kind, 'position');
  assert.equal(info.text, I18N.t('Form bestimmt · Lage frei · {n} Freiheitsgrade', { n: 2 }));
  assert.equal(M.sketchJson(sk), json, 'Probe fasst das Modell nicht an');
});

test('Status Kontrollfälle: echt unterbestimmt, fixiert, Konflikt, Trial-Fehlschlag', () => {
  // Echt unterbestimmt: Rechteck H/V + nur Breite — Höhe bleibt frei, Probe-DOF > 0.
  const sk = M.emptySketch();
  const p = [M.addPt(sk, 0, 0), M.addPt(sk, 125, 0), M.addPt(sk, 125, 125), M.addPt(sk, 0, 125)];
  const lines = p.map((q, i) => M.addLine(sk, q.id, p[(i + 1) % 4].id).id);
  M.addCon(sk, 'horizontal', [lines[0]]);
  M.addCon(sk, 'horizontal', [lines[2]]);
  M.addCon(sk, 'vertical', [lines[1]]);
  M.addCon(sk, 'vertical', [lines[3]]);
  M.addCon(sk, 'distance', [lines[0]], { v: 125 });
  const st = S.solveSketch(sk);
  assert.ok(st.ok && st.dof > 0, `Kontrolle lösbar erwartet, ist ok=${st.ok} dof=${st.dof}`);
  const probe = () => {
    const clone = M.cloneSketch(sk);
    const pt = clone.pts[0];
    clone.cons.push({ id: clone.next++, t: 'fixed', r: [pt.id], x: pt.x, y: pt.y });
    const r = S.solveSketch(clone);
    return r.ok ? r.dof : null;
  };
  assert.ok(probe() !== 0, 'Kontrolle bleibt nach Fixieren unterbestimmt');
  const free = SP.sketchStatusInfo(sk, st, null, probe);
  assert.equal(free.kind, 'free');
  assert.equal(free.text, I18N.t('Unterbestimmt · {n} Freiheitsgrade', { n: st.dof }));
  // Fixierter Punkt: voll bestimmt, Probe wird nicht gebraucht.
  let calls = 0;
  const full = SP.sketchStatusInfo(sk, { ok: true, dof: 0, conflicting: [], redundant: [] }, 6, () => { calls++; return 0; });
  assert.equal(full.kind, 'full');
  assert.equal(full.text, I18N.t('Vollständig bestimmt'));
  assert.equal(calls, 0, 'kein Trial-Solve bei dof 0');
  // Konflikt bleibt Konflikt, auch wenn die Probe 0 melden würde.
  const conflict = SP.sketchStatusInfo(sk, { ok: false, dof: 2, conflicting: [1], redundant: [] }, 6, () => 0);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.text, I18N.t('Konflikt'));
  // Trial-Fehlschlag (Ausnahme / null) fällt auf den bisherigen Text zurück, lügt nie.
  const throwing = SP.sketchStatusInfo(sk, st, null, () => { throw new Error('Löser weg'); });
  assert.equal(throwing.kind, 'free');
  assert.equal(throwing.text, I18N.t('Unterbestimmt · {n} Freiheitsgrade', { n: st.dof }));
  const nullable = SP.sketchStatusInfo(sk, st, null, () => null);
  assert.equal(nullable.kind, 'free');
  assert.equal(nullable.text, I18N.t('Unterbestimmt · {n} Freiheitsgrade', { n: st.dof }));
  // Performance-Guard: dof außerhalb 1..3 löst keinen Trial-Solve aus.
  let guarded = 0;
  const big = SP.sketchStatusInfo(sk, { ok: true, dof: 4, conflicting: [], redundant: [] }, null, () => { guarded++; return 0; });
  assert.equal(big.kind, 'free');
  assert.equal(guarded, 0, 'kein Trial-Solve bei dof 4');
});

test('Einpassen rechnet korrekte BBox (Welt, mit Matrix)', () => {
  const { sk } = rectSketch();
  const box = SP.sketchWorldBounds(sk, [2, 0, 0, 2, 5, 7]);
  assert.ok(box, 'BBox vorhanden');
  assert.deepEqual(box, { x: 5, y: 7, w: 20, h: 20 });
  assert.equal(SP.sketchWorldBounds(M.emptySketch(), [1, 0, 0, 1, 0, 0]), null);
});

test('Solver: infinite Linie wie normale 2-Punkt-Linie', () => {
  const build = (infinite: boolean) => {
    const sk = M.emptySketch();
    const a = M.addPt(sk, 0, 0), b = M.addPt(sk, 10, 0);
    const l = M.addLine(sk, a.id, b.id);
    if (infinite) SP.setSketchLineType(sk, [l.id], 'infinite');
    M.addCon(sk, 'fixed', [a.id], { x: 0, y: 0 });
    M.addCon(sk, 'horizontal', [l.id]);
    return S.solveSketch(sk);
  };
  const plain = build(false), inf = build(true);
  assert.ok(plain.ok && inf.ok, `Solver ok (plain ${plain.ok}, infinite ${inf.ok})`);
  assert.equal(inf.dof, plain.dof, 'gleicher DOF wie normale Linie');
});

test('Status-Keys mit Platzhalter in allen Locales', () => {
  for (const lang of ['en', 'es', 'it', 'pt-BR']) {
    const dict = JSON.parse(readFileSync(fileURLToPath(new URL(`../src/locales/${lang}.json`, import.meta.url)), 'utf8')) as Record<string, string>;
    for (const key of ['Noch keine Geometrie', 'Unterbestimmt · {n} Freiheitsgrade', 'Form bestimmt · Lage frei · {n} Freiheitsgrade', 'Vollständig bestimmt', 'Konflikt', 'Noch nicht ausgewertet'])
      assert.ok(dict[key], `${lang}: fehlt ${key}`);
    assert.ok(dict['Unterbestimmt · {n} Freiheitsgrade'].includes('{n}'), `${lang}: Platzhalter fehlt`);
    assert.ok(dict['Form bestimmt · Lage frei · {n} Freiheitsgrade'].includes('{n}'), `${lang}: Platzhalter fehlt`);
  }
});

test('Seitenmenü-Verdrahtung (statisch): Name, Gruppen, Aktionen ohne Duplikat-Pfad', () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
  const panel = read('sketchPanel.ts'), side = read('sketch/sidepanel.ts');
  for (const key of ['Skizzen-Seitenmenü', 'Linientyp', 'Konstruktionsgeometrie', 'Skizze einpassen'])
    assert.ok(panel.includes(`t('${key}'`), `Seitenmenü-Text fehlt: ${key}`);
  for (const key of ['Noch keine Geometrie', 'Noch nicht ausgewertet'])
    assert.ok(side.includes(`t('${key}'`), `Status-Text fehlt: ${key}`);
  assert.ok(panel.includes('closeSketch'), 'Fertig/Abbrechen wiederverwenden denselben Pfad');
  assert.ok(panel.includes("'details'"), 'Einklapp-Gruppen');
});

test('Seitenkarte rechts/floating: Kopfzeile, Segment, Checkboxen rechts, Vollbreit-Finish, Aria', () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
  const panel = read('sketchPanel.ts'), css = read('style.css');
  assert.ok(panel.includes("placement: { kind: 'floating'"), 'Standardposition schwebend (wiederverwendetes Dock-/Floating-System)');
  assert.ok(panel.includes('sketch-side-card') && panel.includes('sketch-side-head'), 'Karten-Container mit Kopfzeile');
  assert.ok(panel.includes('sketch-side-segment') && panel.includes('sketch-side-finish'), 'Segment-Kontrolle und Vollbreit-Primärbutton');
  assert.ok(!panel.includes('sketch-side-more') && !panel.includes('moreToggle'), 'kein MORE in der Seitenkarte; Anzeige/Fangen stehen direkt');
  assert.ok(panel.includes("group(t('Anzeige'), true") && panel.includes("group(t('Fangen'), true"), 'Anzeige/Fangen default offen');
  assert.ok(panel.includes("t('Objektfang')") && panel.includes("setSnap({ objects: on })"), 'Objektfang nutzt bestehendes setSnap');
  assert.ok(panel.includes("t('Rasterfang')") && panel.includes("setSnap({ grid: on })"), 'Rasterfang nutzt bestehendes setSnap');
  assert.ok(panel.includes("t('Einklappen')") && panel.includes("t('Aufklappen')"), 'Einklappen mit bestehenden Locales');
  assert.ok(panel.includes('aria-expanded') && panel.includes('aria-controls'), 'Klappzustand für AT offengelegt');
  for (const marker of ['.sketch-side-card', '.sketch-side-segment', 'label.check input', 'prefers-reduced-motion', '--panel', '--accent'])
    assert.ok(css.includes(marker), `Karten-CSS fehlt: ${marker}`);
  assert.ok(!/\.sketch-side-card[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(css), 'keine hartcodierten Dark-only-Farben in der Karte');
  const icons = read('icons.ts');
  for (const key of ['lineTypeNormal:', 'lineTypeCenterline:', 'lineTypeInfinite:', 'sketchConstruction:'])
    assert.ok(icons.includes(key), `Linientyp-Icon fehlt: ${key}`);
  for (const color of ['#1E5AC8', '#E68228', '#C86E3C'])
    assert.ok(icons.includes(color), `Linientyp-Farbe fehlt: ${color}`);
  const infiniteIcon = icons.split('lineTypeInfinite:')[1].split('\n')[0];
  assert.ok(!infiniteIcon.includes('stroke-dasharray'), 'Unendlich ist massiv dargestellt');
  assert.ok(panel.includes('LINE_ICON') && panel.includes("h('span', { icon: LINE_ICON[type]"), 'Segment-Buttons tragen Icons zusätzlich zum Text');
});

await Promise.all(pending);
if (failed) process.exit(1);
console.log('sketch-sidepanel: alle Tests bestanden');
