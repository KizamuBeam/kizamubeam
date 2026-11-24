// Save-Pfad-Plumbing: welcher Pfad nach dem Öffnen bleibt, Tab-Plumbing für stilles Speichern.
// saveTextAs/Dialog sind nicht node-testbar; getestet werden keepProjectPath + makeTab/openInTab/newTab.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc } = await import('../src/model');
const { keepProjectPath } = await import('../src/editor/tabs');
const { makeTab } = await import('../src/editor/tabs');
type E = import('../src/editor').Editor;
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
function editor(): E {
  const ed = Object.create(Editor.prototype) as E;
  const doc = newDoc();
  Object.assign(ed, { doc, sel: [], tabs: [], tabIndex: 0, tool: 'select', listeners: new Set(),
    history: new History(), batching: false, hint: '', view: { zoom: 1, ox: 0, oy: 0 } });
  ed.emit = () => {};
  ed.scheduleSave = () => {};
  return ed;
}

await test('keepProjectPath: nur .kzb behält den Pfad', () => {
  assert.equal(keepProjectPath('a.kzb', '/x/a.kzb'), '/x/a.kzb');
  assert.equal(keepProjectPath('A.KZB', '/x/A.KZB'), '/x/A.KZB');
  assert.equal(keepProjectPath('a.lbrn2', '/x/a.lbrn2'), null);
  assert.equal(keepProjectPath('a.lbrn', '/x/a.lbrn'), null);
  assert.equal(keepProjectPath('a.json', '/x/a.json'), null);
  assert.equal(keepProjectPath('a.kzt', '/x/a.kzt'), null);
  assert.equal(keepProjectPath('a.kzb', null), null);
});

await test('makeTab: Pfad default null, explizit übernommen', () => {
  assert.equal(makeTab(newDoc()).path, null);
  assert.equal(makeTab(newDoc(), 'a', false, false, '/x/a.kzb').path, '/x/a.kzb');
});

await test('openInTab im leeren Tab: Name und Pfad gesetzt', () => {
  const ed = editor();
  const tab = makeTab(newDoc());
  ed.tabs = [tab]; ed.tabIndex = 0;
  ed.parseProject = () => newDoc();
  ed.tabIsBlank = () => true;
  ed.clearPageState = () => {};
  ed.zoomPage = () => {};
  ed.openInTab('{}', 'a', '/x/a.kzb');
  assert.equal(ed.tab.name, 'a');
  assert.equal(ed.tab.path, '/x/a.kzb');
});

await test('openInTab im belegten Tab: neuer Tab mit Pfad', () => {
  const ed = editor();
  const tab = makeTab(newDoc());
  ed.tabs = [tab]; ed.tabIndex = 0;
  ed.parseProject = () => newDoc();
  ed.tabIsBlank = () => false;
  ed.showTab = () => {};
  ed.openInTab('{}', 'b', '/x/b.kzb');
  assert.equal(ed.tabs.length, 2);
  assert.equal(ed.tabs[1].name, 'b');
  assert.equal(ed.tabs[1].path, '/x/b.kzb');
  // Quell-Tab unverändert
  assert.equal(ed.tabs[0].path, null);
});

await test('openInTab mit lbrn-Pfad: Pfad bleibt null', () => {
  const ed = editor();
  const tab = makeTab(newDoc());
  ed.tabs = [tab]; ed.tabIndex = 0;
  ed.parseProject = () => newDoc();
  ed.tabIsBlank = () => true;
  ed.clearPageState = () => {};
  ed.zoomPage = () => {};
  ed.openInTab('{}', 'c', keepProjectPath('c.lbrn2', '/x/c.lbrn2'));
  assert.equal(ed.tab.name, 'c');
  assert.equal(ed.tab.path, null);
});

console.log(`Save-Pfad: ${count} checks passed without hardware/app startup.`);
