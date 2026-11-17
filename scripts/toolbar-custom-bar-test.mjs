// Eigene Funktionsleisten: Erstellen, Rekonstruieren, Umbenennen, Löschen, Größen.
// Aufruf: node scripts/toolbar-custom-bar-test.mjs (hängt in test:toolbar-layout).
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// ---------- Minimaler DOM-Stub (Baum, Tag/Klassen-Selektoren, Dialoge) ----------
class Style {
  setProperty(key, value) { this[key] = String(value); }
  getPropertyValue(key) { return this[key] ?? ''; }
  getPropertyPriority() { return ''; }
  removeProperty(key) { delete this[key]; }
}
function matches(el, selector) {
  if (!(el instanceof El)) return false;
  for (const part of String(selector).split(',').map((s) => s.trim())) {
    if (part.startsWith('.')) { if (el.classList.contains(part.slice(1))) return true; continue; }
    if (part.startsWith('#')) { if (el.id === part.slice(1)) return true; continue; }
    if (part.startsWith('[')) {
      const m = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (m && (m[2] === undefined ? el.dataset[m[1]] !== undefined : el.dataset[m[1]] === m[2])) return true;
      continue;
    }
    const dot = part.indexOf('.');
    if (dot > 0) {
      if (el.tag === part.slice(0, dot) && el.classList.contains(part.slice(dot + 1))) return true;
      continue;
    }
    if (/^[a-zA-Z][\w-]*$/.test(part) && el.tag === part) return true;
  }
  return false;
}
class El {
  constructor(tag) {
    this.tag = tag; this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this.ownerDocument = null;
    this.dataset = {}; this._attrs = new Map(); this._listeners = new Map();
    this._class = ''; this.style = new Style();
    this.hidden = false; this.disabled = false; this.checked = false;
    this._value = ''; this.textContent = ''; this.innerHTML = '';
    this.open = false; this.id = ''; this.title = ''; this.type = '';
    this.tabIndex = -1; this.clientWidth = 0; this.clientHeight = 0;
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v); }
  get classList() {
    const self = this;
    const list = () => self._class.split(/\s+/).filter(Boolean);
    const write = (l) => { self._class = l.join(' '); };
    return {
      add: (...c) => write([...new Set([...list(), ...c])]),
      remove: (...c) => write(list().filter((x) => !c.includes(x))),
      toggle: (c, force) => { const next = force ?? !list().includes(c); write(next ? [...new Set([...list(), c])] : list().filter((x) => x !== c)); return next; },
      contains: (c) => list().includes(c),
    };
  }
  get value() { return this._value; }
  set value(v) { this._value = String(v); this._attrs.set('value', String(v)); }
  get parentElement() { return this.parentNode instanceof El ? this.parentNode : null; }
  get firstChild() { return this.children.find((c) => c instanceof El) ?? null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  get isConnected() {
    let node = this;
    while (node) {
      if (node === document.body || node === document.documentElement) return true;
      node = node.parentNode;
    }
    return false;
  }
  get options() { return this.children.filter((c) => c instanceof El && c.tag === 'option'); }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (node == null || node === false) continue;
      if (typeof node === 'string') this.textContent += node;
      else { node.remove(); node.parentNode = this; this.children.push(node); }
    }
  }
  appendChild(node) { this.append(node); return node; }
  prepend(...nodes) {
    const els = [];
    for (const node of nodes.flat()) {
      if (node == null || node === false || typeof node === 'string') continue;
      node.remove(); node.parentNode = this; els.push(node);
    }
    this.children.unshift(...els);
  }
  insertBefore(node, before) {
    node.remove(); node.parentNode = this;
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
    return node;
  }
  before(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(this);
    const els = [];
    for (const node of nodes.flat()) {
      if (typeof node === 'string' || node == null) continue;
      node.remove(); node.parentNode = parent; els.push(node);
    }
    parent.children.splice(at, 0, ...els);
  }
  replaceChildren(...nodes) {
    for (const child of this.children) if (child instanceof El) child.parentNode = null;
    this.children = []; this.textContent = '';
    this.append(...nodes);
  }
  remove() {
    const parent = this.parentNode;
    if (parent) parent.children = parent.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  getAttribute(key) { return this._attrs.has(key) ? this._attrs.get(key) : null; }
  setAttribute(key, value) {
    this._attrs.set(key, String(value));
    if (key === 'value') this._value = String(value);
    if (key === 'id') this.id = String(value);
    if (key === 'class') this._class = String(value);
  }
  removeAttribute(key) { this._attrs.delete(key); }
  hasAttribute(key) { return this._attrs.has(key); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (list) this._listeners.set(type, list.filter((x) => x !== fn));
  }
  fire(type, extra = {}) {
    for (const fn of [...(this._listeners.get(type) ?? [])]) fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra });
  }
  click() { if (!this.disabled) this.fire('click'); }
  focus() {}
  blur() {}
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.fire('close'); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (el) => { for (const c of el.children) if (c instanceof El) { if (matches(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    let parent = node.parentNode;
    while (parent) { if (parent === this) return true; parent = parent.parentNode; }
    return false;
  }
  closest(sel) {
    let node = this;
    while (node) { if (matches(node, sel)) return node; node = node.parentNode; }
    return null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
const store = new Map();
const hostSelectors = new Map();
const body = new El('body');
const documentElement = new El('html');
documentElement.clientWidth = 1024; documentElement.clientHeight = 768;
const document = {
  createElement: (tag) => { const el = new El(tag); el.ownerDocument = document; return el; },
  createComment: (text) => { const el = new El('#comment'); el.ownerDocument = document; el.textContent = String(text); return el; },
  getElementById: () => null,
  querySelector: (sel) => {
    if (hostSelectors.has(sel)) return hostSelectors.get(sel);
    if (sel.startsWith('#')) { const el = document.createElement('div'); hostSelectors.set(sel, el); return el; }
    return body.querySelector(sel);
  },
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  body, documentElement, activeElement: null, defaultView: undefined,
  addEventListener() {}, removeEventListener() {},
};
Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
globalThis.HTMLElement = El;
globalThis.Element = El;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['de'], language: 'de' } });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => void store.set(key, String(value)),
  removeItem: (key) => void store.delete(key),
} });
let confirmResult = true;
const confirmations = [];
globalThis.confirm = (message) => { confirmations.push(message); return confirmResult; };

// ---------- Gebündelte Fassade (kein Browser, kein Storage-Zugriff von außen) ----------
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = await build({ entryPoints: ['src/toolbars.ts'], bundle: true, write: false, format: 'esm',
  platform: 'node', loader: { '.woff': 'empty', '.woff2': 'empty' }, logLevel: 'error' });
const tmp = mkdtempSync(join(tmpdir(), 'kizamubeam-custom-bar-'));
const bundled = join(tmp, 'toolbars.mjs');
writeFileSync(bundled, out.outputFiles[0].text);
const tb = await import(pathToFileURL(bundled).href);

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
const KEY = 'kizamubeam.toolbars';
const actions = [{ id: 'a', cat: 'Test', label: 'Aktion A', run() {} }];
const def = { main: ['a'], tools: [] };
const raw = () => store.get(KEY) ?? null;
const snap = () => JSON.parse(raw()).state;
const dialog = () => document.querySelector('.toolbar-dialog');
const barOptions = (dlg) => dlg.querySelectorAll('select')[0].querySelectorAll('option');
const optionByValue = (dlg, value) => barOptions(dlg).find((o) => o.value === value);
const customRow = (dlg) => dlg.querySelectorAll('.tb-top')[2];

// ---------- Gemeinsame Symbolgröße ----------
store.delete(KEY);
tb.initToolbars(actions, def);
test('gemeinsame Größe startet mit m', () => assert.equal(tb.toolbarIconSize(), 'm'));
tb.setAllToolbarIconSizes('l');
test('setAll schreibt jede Leiste und meldet l', () => {
  assert.ok(Object.values(snap().content.iconSizes).every((s) => s === 'l'));
  assert.equal(snap().content.iconSizes.main, 'l');
  assert.equal(tb.toolbarIconSize(), 'l');
});
test('gemischte Größen melden m', () => {
  const next = JSON.parse(raw());
  next.state.content.iconSizes.tools = 's';
  store.set(KEY, JSON.stringify(next));
  tb.initToolbars(actions, def);
  assert.equal(tb.toolbarIconSize(), 'm');
});
tb.disposeToolbars();
test('ohne System m und kein Absturz', () => {
  assert.equal(tb.toolbarIconSize(), 'm');
  tb.setAllToolbarIconSizes('s');
});

// ---------- Erstellen mit Validierung ----------
store.delete(KEY);
tb.initToolbars(actions, def);
test('leere Namen legen nichts an und öffnen nichts', () => {
  assert.equal(tb.createToolbar(''), undefined);
  assert.equal(tb.createToolbar('   '), undefined);
  assert.equal(tb.createToolbar(42), undefined);
  assert.equal(dialog(), null);
});
test('create legt custom-1 mit Label an und wählt sie vor', () => {
  assert.equal(tb.createToolbar('Meine Leiste'), 'custom-1');
  const s = snap();
  assert.deepEqual(s.content.bars['custom-1'], []);
  assert.equal(s.content.labels['custom-1'], 'Meine Leiste');
  const dlg = dialog();
  assert.ok(dlg && dlg.open);
  assert.equal(dlg.querySelectorAll('select')[0].value, 'custom-1');
  assert.equal(optionByValue(dlg, 'custom-1').textContent, 'Meine Leiste');
});
test('eingebaute und unbekannte Leisten sind geschützt', () => {
  assert.equal(tb.renameToolbar('main', 'X'), false);
  assert.equal(tb.renameToolbar('tools', 'X'), false);
  assert.equal(tb.deleteToolbar('main'), false);
  assert.equal(tb.deleteToolbar('tools'), false);
  assert.equal(tb.renameToolbar('custom-9', 'X'), false);
  assert.equal(tb.deleteToolbar('custom-9'), false);
  assert.equal(snap().content.labels['custom-1'], 'Meine Leiste');
});

// ---------- Rekonstruktion: Label und Layout ----------
test('rename ändert Label und übersteht Rekonstruktion', () => {
  assert.equal(tb.renameToolbar('custom-1', 'Umbenannt'), true);
  assert.equal(snap().content.labels['custom-1'], 'Umbenannt');
  tb.initToolbars(actions, def);
  tb.openToolbarDialog();
  assert.equal(optionByValue(dialog(), 'custom-1').textContent, 'Umbenannt');
  assert.equal(tb.renameToolbar('custom-1', '  '), false);
});
test('gespeichertes Layout übersteht Rekonstruktion, Ungültiges fällt auf Standard', () => {
  const next = JSON.parse(raw());
  next.state.layout.bars['custom-1'] = { placement: { kind: 'floating', x: 10, y: 20 },
    orientation: 'vertical', rows: 2, columns: 3 };
  store.set(KEY, JSON.stringify(next));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog('custom-1');
  let dlg = dialog();
  assert.equal(dlg.querySelectorAll('select')[2].value, 'vertical');
  assert.equal(dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'number')[0].value, '2');
  const bad = JSON.parse(raw());
  bad.state.layout.bars['custom-1'] = { bogus: true };
  store.set(KEY, JSON.stringify(bad));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog('custom-1');
  dlg = dialog();
  assert.equal(dlg.querySelectorAll('select')[2].value, 'horizontal');
  assert.equal(dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'number')[0].value, '1');
});

// ---------- IDs, Löschen, Dialog-Abläufe ----------
test('IDs sind kleinste freie Nummern, Löschen entfernt Inhalt und Label', () => {
  store.delete(KEY);
  tb.initToolbars(actions, def);
  assert.equal(tb.createToolbar('A'), 'custom-1');
  assert.equal(tb.createToolbar('B'), 'custom-2');
  assert.equal(tb.deleteToolbar('custom-1'), true);
  let s = snap();
  assert.ok(!('custom-1' in s.content.bars));
  assert.ok(!('custom-1' in (s.content.labels ?? {})));
  assert.ok('custom-2' in s.content.bars);
  assert.equal(tb.createToolbar('C'), 'custom-1');
  assert.equal(snap().content.labels['custom-1'], 'C');
});
test('Dialog: eingebaute Leiste zeigt nur Erstellen, eigene zusätzlich Umbenennen und Löschen', () => {
  tb.openToolbarDialog('main');
  let row = customRow(dialog());
  assert.equal(row.querySelectorAll('input').length, 1);
  assert.equal(row.querySelectorAll('button').length, 1);
  tb.openToolbarDialog('custom-1');
  row = customRow(dialog());
  assert.equal(row.querySelectorAll('input').length, 2);
  assert.equal(row.querySelectorAll('button').length, 2);
});
test('Dialog: Erstellen per Knopf, Umbenennen per Feld, Löschen mit Bestätigung', () => {
  tb.openToolbarDialog('main');
  let row = customRow(dialog());
  row.querySelectorAll('input')[0].value = 'Dialog-Leiste';
  row.querySelectorAll('button')[0].click();
  let dlg = dialog();
  const created = barOptions(dlg).find((o) => o.textContent === 'Dialog-Leiste');
  assert.ok(created && /^custom-\d+$/.test(created.value));
  assert.equal(dlg.querySelectorAll('select')[0].value, created.value);
  row = customRow(dlg);
  row.querySelectorAll('input')[1].value = 'Via Dialog';
  row.querySelectorAll('input')[1].fire('change');
  assert.equal(snap().content.labels[created.value], 'Via Dialog');
  confirmations.length = 0;
  confirmResult = false;
  customRow(dialog()).querySelectorAll('button')[1].click();
  assert.ok(optionByValue(dialog(), created.value));
  assert.ok(confirmations.some((m) => m.includes('Via Dialog')));
  confirmResult = true;
  customRow(dialog()).querySelectorAll('button')[1].click();
  assert.equal(optionByValue(dialog(), created.value), undefined);
  assert.ok(!('Via Dialog' in Object.values(snap().content.labels ?? {})));
});

// ---------- Fremde Formate ----------
test('fremde Legacy-Leisten erscheinen mit ID als Name', () => {
  store.set(KEY, JSON.stringify({ v: 14, bars: { main: ['a'], tools: [], 'plugin-bar': ['a'] } }));
  tb.initToolbars(actions, def);
  tb.openToolbarDialog();
  const found = optionByValue(dialog(), 'plugin-bar');
  assert.ok(found);
  assert.equal(found.textContent, 'plugin-bar');
});
test('blockierter Storage wird nie überschrieben', () => {
  const future = '{"format":"toolbar-layout","version":999,"state":{}}';
  store.set(KEY, future);
  tb.initToolbars(actions, def);
  assert.equal(tb.createToolbar('Session'), 'custom-1');
  assert.equal(raw(), future);
  assert.equal(tb.deleteToolbar('custom-1'), true);
  assert.equal(raw(), future);
});

tb.disposeToolbars();
assert.equal(document.querySelector('.toolbar-dialog'), null);
console.log(`${passed} custom toolbar tests passed`);
