// Real constructor wiring; synthetic events cannot prove native PRIMARY-paste suppression.
import './core-fixtures-env';
import assert from 'node:assert/strict';

const { Editor } = await import('../src/editor');
const { newDoc, newId } = await import('../src/model');

class Target extends EventTarget {
  style = {};
  tagName = 'CANVAS';
  classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  getContext() { return {}; }
  getBoundingClientRect() { return { left: 11, top: 17, width: 1000, height: 900 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
const canvas = new Target();
const win = Object.assign(new Target(), {
  devicePixelRatio: 2, setInterval: () => 1, clearInterval() {},
  setTimeout: () => 1, clearTimeout() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
});
Object.assign(globalThis, {
  window: win,
  document: Object.assign(new Target(), {
    documentElement: new Target(), body: new Target(), querySelector: () => null,
    createElement: () => new Target(),
  }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  ResizeObserver: class { observe() {} },
  requestAnimationFrame: () => 1,
  setTimeout: () => 1, clearTimeout() {},
});
const ed = new Editor(canvas as unknown as HTMLCanvasElement);
ed.doc = newDoc();
const copied: import('../src/model').Obj = {
  id: newId(), m: [1, 0, 0, 1, 30, 40], layer: 0,
  shape: { kind: 'rect', w: 20, h: 10, r: 0 },
};
// Clipboard survives a document change, matching the reported cross-project case.
ed.doc.objs = [copied];
ed.setSel([copied]);
ed.copy();
ed.doc = newDoc();
ed.setSel([]);
ed.view = { zoom: 3, ox: 71, oy: 43 };
ed.dpr = 2;

function event(type: string, button = 1, x = 150, y = 160) {
  return Object.assign(new Event(type, { cancelable: true }), {
    button, buttons: type === 'pointerup' ? 0 : 4, pointerId: 1, pointerType: 'mouse',
    clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
  });
}
let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error}`); }
}

for (const type of ['mousedown', 'auxclick']) {
  for (const button of [0, 1, 2]) await test(`${type} cancels only middle button (${button})`, () => {
    const e = event(type, button);
    assert.equal(canvas.dispatchEvent(e), button !== 1);
    assert.equal(e.defaultPrevented, button === 1);
  });
}
for (const moved of [false, true]) await test(`middle gesture, moved=${moved}: pan only, clipboard unchanged`, () => {
  const before = ed.state(), clipboard = JSON.stringify(ed.clipboard), history = ed.history.position;
  const view = { ...ed.view };
  canvas.dispatchEvent(event('pointerdown'));
  assert.equal(ed.drag?.type, 'pan');
  canvas.dispatchEvent(event('mousedown'));
  if (moved) canvas.dispatchEvent(event('pointermove', 1, 186, 184));
  canvas.dispatchEvent(event('pointerup', 1, moved ? 186 : 150, moved ? 184 : 160));
  canvas.dispatchEvent(event('auxclick'));
  assert.deepEqual(ed.view, { zoom: 3, ox: view.ox + (moved ? 36 : 0), oy: view.oy + (moved ? 24 : 0) });
  assert.equal(ed.drag, null);
  assert.equal(ed.state(), before);
  assert.equal(ed.history.position, history);
  assert.equal(JSON.stringify(ed.clipboard), clipboard);
});
await test('normal window paste still inserts internal clipboard after middle gestures', () => {
  const e = new Event('paste', { cancelable: true });
  win.dispatchEvent(e);
  assert.ok(e.defaultPrevented);
  assert.equal(ed.doc.objs.length, 1);
  assert.notEqual(ed.doc.objs[0].id, copied.id);
});
await test('menu paste remains available', () => {
  ed.paste();
  assert.equal(ed.doc.objs.length, 2);
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
