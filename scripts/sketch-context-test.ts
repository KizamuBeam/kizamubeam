import './core-fixtures-env';
import assert from 'node:assert/strict';

const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { emptySketch, addPt, addLine } = await import('../src/sketch/model');
const { installEditorContext, openEditorContextMenu } = await import('../src/editorContext');
const { sketchContextGroups } = await import('../src/sketchContext');
const { closeEditorMenu } = await import('../src/contextMenu');

// Small DOM harness: exercise the real menu renderer/keyboard/guards without a browser or server.
class Element extends EventTarget {
  children: (Element | string)[] = [];
  parent?: Element;
  style = {}; className = ''; disabled = false; hidden = false; isConnected = true;
  offsetWidth = 200; offsetHeight = 300;
  attrs = new Map<string, string>();
  constructor(public tag: string) { super(); }
  append(...items: (Element | string)[]) { for (const item of items) { if (item instanceof Element) item.parent = this; this.children.push(item); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.isConnected = false; }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  focus() { dom.activeElement = this; }
  getClientRects() { return [1]; }
  contains(target: Element): boolean { return target === this || this.children.some((c) => c instanceof Element && c.contains(target)); }
  closest(selector: string): Element | null {
    const base = selector.split(':')[0];
    const match = (el: Element): boolean => base.startsWith('.')
      ? el.className.split(' ').includes(base.slice(1))
      : el.tag === base;
    let el: Element | undefined = this;
    while (el) { if (match(el)) return el; el = el.parent; }
    return null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((c) => c instanceof Element ? [
      ...(c.tag === 'button' && (!selector.includes(':not(:disabled)') || !c.disabled) ? [c] : []), ...c.querySelectorAll(selector),
    ] : []);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const documentEvents = new EventTarget();
const dom = Object.assign(new EventTarget(), {
  addEventListener: (type: string, listener: EventListener) => documentEvents.addEventListener(type, listener),
  removeEventListener: (type: string, listener: EventListener) => documentEvents.removeEventListener(type, listener),
  dispatchEvent: (event: Event) => documentEvents.dispatchEvent(event),
  body: new Element('body'), activeElement: null as Element | null,
  documentElement: { lang: 'de', dataset: {} },
  createElement: (tag: string) => new Element(tag),
  querySelector: () => null,
});
const globals = globalThis as Record<string, unknown>;
globals.document = dom;
globals.MouseEvent = class extends Event { constructor(type: string, init: Record<string, unknown>) {
  super(type, init); for (const [key, value] of Object.entries(init)) if (!(key in this)) Object.defineProperty(this, key, { value });
} };
globals.innerWidth = 1200; globals.innerHeight = 900;
const win = new EventTarget();
globals.addEventListener = win.addEventListener.bind(win); globals.removeEventListener = win.removeEventListener.bind(win);
const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
globals.requestAnimationFrame = (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; };
globals.cancelAnimationFrame = (id: number) => frames.delete(id);
const tick = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0); };

const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
const canvasEvents = new EventTarget();
Object.assign(ed, { doc: newDoc(), tool: 'sketch', sel: [], history: new History(), listeners: new Set(),
  nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), clipboard: [],
  currentLayer: 0, snapVer: 0, alignGuides: [], drag: null, draft: null,
  canvas: { style: {}, setPointerCapture() {}, addEventListener: canvasEvents.addEventListener.bind(canvasEvents),
    getBoundingClientRect: () => ({ left: 17, top: 29, width: 1000, height: 800 }) },
  view: { zoom: 2, ox: 41, oy: 53 }, dpr: 2, redraw() {} });
ed.doc.layers[0] = defaultLayer(0);
ed.clearSnap = ed.clearTrack = ed.scheduleSave = () => {};
const sk = emptySketch(), a = addPt(sk, 10, 20), b = addPt(sk, 50, 20), line = addLine(sk, a.id, b.id);
const session = () => ({ sk, m: [1, 0, 0, 1, 11, 13], tool: 'select', sel: new Set(), draft: [], draftIds: [],
  dimPick: [], labels: [], drag: null, json: '', obj: null });
ed.sketchEdit = session() as unknown as NonNullable<typeof ed.sketchEdit>;
ed.rightPress();
assert.equal(ed.suppressContextMenu, false, 'idle sketch right click reaches context dispatch');
const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, library() {},
  vectorFit() {}, builder() {}, preview() {}, objects() {} };
installEditorContext(ed, callbacks);
let opens = 0;
const dispatch = ed.onCanvasContext!;
ed.onCanvasContext = (e) => { opens++; dispatch(e); };
const native = (x: number, y: number) => {
  const e = new MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2 });
  // Same native listener bridge installed by Editor's constructor (no hardware/render loop).
  if (ed.drag?.type === 'right') { ed.drag.context = true; return; }
  if (ed.suppressContextMenu) { ed.suppressContextMenu = false; return; }
  ed.onCanvasContext?.(e);
};
const pointer = (phase: 'onDown' | 'onMove' | 'onUp', x: number, y: number) =>
  ed[phase]({ button: 2, clientX: x, clientY: y, pointerId: 7 } as PointerEvent);
const screen = ed.skToScreen(a), x = screen.x + 17, y = screen.y + 29;
const menu = () => dom.body.children.find((c) => c instanceof Element && c.className.includes('editor-context-menu')) as Element | undefined;
const buttons = () => menu()!.querySelectorAll('button:not(:disabled)');
const key = (value: string) => { const e = new Event('keydown'); Object.assign(e, { key: value }); dom.dispatchEvent(e); };

ed.rightPan = false;
pointer('onDown', x, y); native(x, y);
assert.equal(menu(), undefined, 'press/native press cannot open the menu');
assert.equal(opens, 0);
pointer('onUp', x, y);
assert.equal(opens, 1); assert.ok(menu());
assert.deepEqual([...ed.sketchEdit!.sel], [a.id], 'real hit pipeline uses CSS pixels with zoom, view, sketch and canvas offsets, dpr=2');
native(x, y); assert.equal(opens, 1, 'native after synthetic release is swallowed');
const all = sketchContextGroups(ed).flat();
assert.ok(all.every((a) => a.id.startsWith('sketch-')), 'no document clipboard, laser or object commands');
assert.equal(all.find((a) => a.id === 'sketch-aux')!.enabled, false, 'point alone cannot toggle auxiliary entities');
const first = dom.activeElement;
key('ArrowDown'); assert.notEqual(dom.activeElement, first, 'keyboard moves focus');
key('Escape'); assert.equal(menu(), undefined, 'Escape closes the shared menu');
const invokeKey = new Event('keydown', { cancelable: true }); Object.assign(invokeKey, { key: 'F10', shiftKey: true });
canvasEvents.dispatchEvent(invokeKey);
assert.equal(invokeKey.defaultPrevented, true); assert.ok(menu(), 'Shift+F10 opens the sketch menu');
assert.deepEqual([...ed.sketchEdit!.sel], [a.id], 'keyboard opening preserves selection');
key('Escape');

// A real edge hit offers auxiliary geometry, and keyboard activation dispatches the existing API.
let toggles = 0; ed.sketchToggleAux = () => { toggles++; };
const mid = ed.skToScreen({ x: 30, y: 20 });
pointer('onDown', mid.x + 17, mid.y + 29); pointer('onUp', mid.x + 17, mid.y + 29);
assert.deepEqual([...ed.sketchEdit!.sel], [line.id]);
const aux = buttons().find((b) => b.children.some((c) => c instanceof Element && c.children.some((s) => typeof s === 'string' && s.includes('Hilfsgeometrie'))))!;
aux.focus(); key('Enter'); assert.equal(toggles, 1, 'keyboard activates auxiliary toggle'); assert.equal(menu(), undefined);

// Stale actions remain inert even before the frame/event that dismisses the menu.
let runs = 0;
const guarded = () => openEditorContextMenu(ed, x, y, [[{ id: 'test', label: 'Test', run: () => runs++ }]]);
guarded(); const staleSelection = buttons()[0]; ed.sketchEdit!.sel.clear(); staleSelection.click();
await Promise.resolve(); assert.equal(runs, 0, 'selection guard');
guarded(); const staleSession = buttons()[0]; ed.sketchEdit = { ...ed.sketchEdit! }; staleSession.click();
await Promise.resolve(); assert.equal(runs, 0, 'session identity guard');
guarded(); const staleTool = buttons()[0]; ed.sketchEdit!.tool = 'line'; staleTool.click();
await Promise.resolve(); assert.equal(runs, 0, 'tool guard');
guarded(); ed.sketchEdit!.sel.add(a.id); tick(); assert.equal(menu(), undefined, 'silent sketch selection change closes on next frame');
guarded(); ed.sketchEdit!.tool = 'select'; tick(); assert.equal(menu(), undefined, 'silent sketch tool change closes on next frame');

// Existing right-click draft/polyline lifecycle is consumed, never followed by a menu.
let finished = 0;
ed.finishSketchPolyline = () => { finished++; ed.sketchEdit!.polyline = undefined; };
const beforeDraft = opens;
ed.sketchEdit!.draft = [{ x: 1, y: 2 }]; ed.sketchEdit!.draftIds = [null];
pointer('onDown', x, y); assert.equal(ed.sketchEdit!.draft.length, 1, 'draft stays until release');
pointer('onUp', x, y); native(x, y);
assert.equal(ed.sketchEdit!.draft.length, 0); assert.equal(opens, beforeDraft);
ed.sketchEdit!.tool = 'polyline'; ed.sketchEdit!.polyline = { start: a, startId: a.id, segments: [{}] } as never;
pointer('onDown', x, y); pointer('onUp', x, y); native(x, y);
assert.equal(finished, 1, 'polyline finished once'); assert.equal(opens, beforeDraft);
ed.sketchEdit!.relationPick = { type: 'horizontal', previous: new Set() };
pointer('onDown', x, y); pointer('onUp', x, y); native(x, y);
assert.ok(ed.sketchEdit!.relationPick); assert.equal(opens, beforeDraft, 'active relation pick is consumed unchanged');
ed.sketchEdit!.relationPick = undefined; ed.sketchEdit!.tool = 'select';

ed.rightPan = true;
const view = { ...ed.view };
pointer('onDown', x, y); native(x, y); pointer('onMove', x + 30, y - 20); pointer('onUp', x + 30, y - 20); native(x + 30, y - 20);
assert.deepEqual(ed.view, { ...view, ox: view.ox + 30, oy: view.oy - 20 });
assert.equal(opens, beforeDraft, 'right pan never opens sketch menu'); assert.equal(menu(), undefined);
ed.rightPan = false;
pointer('onDown', x, y); pointer('onMove', x + 30, y); pointer('onUp', x + 30, y); native(x + 30, y);
assert.equal(opens, beforeDraft, 'right drag with panning disabled is not a click');

let deleted = 0; ed.sketchDeleteSel = async () => { deleted++; };
ed.sketchEdit!.sel = new Set([line.id]);
openEditorContextMenu(ed, x, y, sketchContextGroups(ed));
buttons()[0].click(); await Promise.resolve(); assert.equal(deleted, 1, 'delete dispatches the protected editor API');
openEditorContextMenu(ed, x, y, sketchContextGroups(ed));
const staleDocument = buttons()[0]; ed.doc = newDoc(); staleDocument.click();
await Promise.resolve(); assert.equal(deleted, 1, 'document replacement also refuses stale sketch actions');

// Normal-mode native routing is unchanged and still opens document actions.
ed.sketchEdit = null; ed.tool = 'select'; ed.suppressContextMenu = false;
ed.guideAt = () => -1; ed.hitTest = () => null;
native(400, 400); assert.ok(menu());
assert.ok(menu()!.querySelectorAll('button').some((b) => b.children.some((c) => c instanceof Element && c.children.includes('Alles auswählen'))));
closeEditorMenu(); assert.equal(frames.size, 0, 'menu frame watchers are cleaned up');
console.log('Sketch context: 14 scenarios passed (dispatch, transformed hits, keyboard invocation/operation, stale guards, draft, polyline, relation, pan, pattern, badge, safe pattern actions, protected delete, normal mode).');
