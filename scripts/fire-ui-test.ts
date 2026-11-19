// Real fireUi + DOM builder + machine boundary; only DOM and Tauri transport are in-memory doubles.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { fireControls, fireOverlayInPanel, fireSettings, fireWarning, installFireOverlay, setFireOverlayInPanel } from '../src/fireUi';
import { machine } from '../src/machine';
import { newDevice } from '../src/gcode';

class Element {
  children: (Element | string)[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, ((e: unknown) => unknown)[]>();
  hidden = false;
  disabled = false;
  value = '';
  className = '';
  classList = { toggle: (name: string, enabled: boolean) => {
    const names = this.className.split(/\s+/).filter((part) => part && part !== name);
    if (enabled) names.push(name);
    this.className = names.join(' ');
    return enabled;
  } };
  textContent = '';
  constructor(readonly tag: string) {}
  append(...nodes: (Element | string)[]) { this.children.push(...nodes); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; if (key === 'value') this.value = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  focus() {}
  checkVisibility() { return true; }
  private capturedPointer = -1;
  setPointerCapture(id: number) { this.capturedPointer = id; }
  hasPointerCapture(id: number) { return this.capturedPointer === id; }
  addEventListener(type: string, fn: (e: unknown) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  async emit(type: string, extra = {}) {
    for (const fn of this.listeners.get(type) ?? []) await fn({ target: this, isTrusted: true,
      preventDefault() {}, stopPropagation() {}, ...extra });
  }
  all(tag: string): Element[] {
    return this.children.flatMap((c) => typeof c === 'string' ? [] : [...(c.tag === tag ? [c] : []), ...c.all(tag)]);
  }
}
const body = new Element('body');
const windowEvents = new Element('window');
const documentEvents = new Element('document');
Object.assign(document, { body, createElement: (tag: string) => new Element(tag),
  addEventListener: documentEvents.addEventListener.bind(documentEvents) });
Object.assign(window, { addEventListener: windowEvents.addEventListener.bind(windowEvents) });
let setActionInView = (_visible: boolean) => {};
Object.assign(globalThis, { IntersectionObserver: class {
  constructor(private readonly notify: (entries: unknown[]) => void) {}
  observe(target: Element) {
    setActionInView = (visible) => this.notify([{ target, isIntersecting: visible, intersectionRatio: Number(visible),
      boundingClientRect: { width: visible ? 100 : 0 } }]);
  }
} });
const sent: string[] = [];
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string) => { sent.push(cmd); } } });
let d = newDevice({ fw: 'grbl', laser: { type: 'diode' }, fireEnabled: true });
Object.assign(machine, { connected: true, connectedDevice: d.id, fwId: d.fw });
machine.status.state = 'Idle';
installFireOverlay();
const overlay = body.children[0] as Element;
let settingsOpened = 0;
const panel = fireControls(() => d, () => { settingsOpened++; });
const root = panel.root as unknown as Element;
const [start, hold, settingsLink] = root.all('button');
const [power, seconds] = root.all('input');
let scenarios = 0;
const scenario = (name: string) => console.log(`ok UI ${++scenarios} ${name}`);
d.fireEnabled = false;
machine.connected = false;
panel.refresh();
assert.equal(root.hidden, false);
assert.equal(root.tag, 'section');
assert.equal(start.disabled, true);
assert.equal(hold.disabled, true);
assert.equal(power.disabled, true);
assert.equal(seconds.disabled, true);
assert.equal(settingsLink.disabled, false);
await settingsLink.emit('click');
assert.equal(settingsOpened, 1);
assert.equal(sent.length, 0);
scenario('unconfigured test fire stays visible and links to settings without a connection');
d.fireEnabled = true;
machine.connected = true;
panel.refresh();
assert.equal(power.disabled, false);
assert.equal(seconds.disabled, false);
assert.equal(start.disabled, false);
assert.equal(hold.disabled, false);
assert.equal(start.textContent, 'Testfeuer starten');
scenario('idle controls expose start and hold, not stop');
for (const input of [power, seconds]) {
  assert.ok(input.attributes['aria-label']);
  const original = input.value;
  for (const value of ['', '0', '-1', 'Infinity', 'NaN', '99999', '0,', '0,5.1', '0,5x']) {
    input.value = value;
    await input.emit('input');
    assert.equal(start.disabled, true, value);
  }
  input.value = original;
  await input.emit('input');
}
scenario('invalid visible power/duration blocks start and exposes accessible labels');
power.value = '0,5';
seconds.value = '2.5';
await power.emit('input');
await seconds.emit('input');
assert.equal(start.disabled, false);
scenario('manual controls accept fractional power and duration with either separator');
await start.emit('click', { isTrusted: false });
assert.equal(sent.length, 0);
scenario('untrusted activation does not dispatch');
await start.emit('click');
assert.equal(start.disabled, false);
assert.equal(start.textContent, 'Testfeuer stoppen');
assert.equal(hold.disabled, true);
assert.equal(settingsLink.disabled, true);
assert.equal(fireOverlayInPanel(), true);
setActionInView(true);
assert.equal(overlay.hidden, false);
setFireOverlayInPanel(false);
assert.equal(overlay.hidden, true);
setActionInView(false);
assert.equal(overlay.hidden, false);
const [overlayStop, confirm] = overlay.all('button');
assert.equal(overlayStop.disabled, false);
assert.equal(confirm.hidden, true);
scenario('overlay opt-out only applies while the inline action is visible');
await windowEvents.emit('keydown', { key: 'Escape' });
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(machine.fire.state, 'unknown');
assert.equal(confirm.hidden, false);
assert.equal(confirm.disabled, false);
assert.equal(start.textContent, 'Am Gerät geprüft: Laser ist aus');
assert.match(confirm.className, /\bfire-confirm\b/);
assert.equal(overlay.all('span')[0].attributes.role, 'status');
assert.equal(overlay.all('span')[0].textContent, 'Laserstatus unbekannt – direkt am Gerät abschalten');
scenario('Escape leaves explicit unknown status and local recovery');
await confirm.emit('click', { isTrusted: false });
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
assert.equal(overlay.hidden, true);
assert.equal(machine.fire.state, 'idle');
assert.equal(start.textContent, 'Testfeuer starten');
scenario('only trusted physical-off acknowledgement releases lock');

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
await start.emit('click');
await start.emit('click');
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
assert.equal(machine.fire.state, 'idle');
scenario('main button stops, then requires a separate confirmation');

seconds.value = '0.03';
await seconds.emit('input');
const timedStart = start.emit('click');
await start.emit('pointerdown', { isPrimary: true, button: 0 });
await timedStart;
await new Promise((resolve) => setTimeout(resolve, 60));
await start.emit('click', { detail: 1 });
assert.equal(machine.fire.state, 'unknown');
assert.equal(start.textContent, 'Am Gerät geprüft: Laser ist aus');
await start.emit('pointerdown', { isPrimary: true, button: 0 });
await start.emit('click', { detail: 1 });
assert.equal(machine.fire.state, 'idle');
seconds.value = '2.5';
await seconds.emit('input');
scenario('expiry switches to confirmation, without treating a press on Stop as an acknowledgement');

const commandsBeforeHoldClick = sent.length;
await hold.emit('click');
await hold.emit('keydown', { code: 'Space', repeat: true });
assert.equal(sent.length, commandsBeforeHoldClick);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  await hold.emit('pointerdown', { isPrimary: true, button: 0, pointerId: 3 });
  await settle();
  assert.equal(machine.fire.state, 'firing');
  await hold.emit(event, { pointerId: 3 });
  await settle();
  assert.equal(machine.fire.state, 'unknown');
  await start.emit('click');
}
await hold.emit('keydown', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'firing');
await hold.emit('keyup', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'unknown');
await start.emit('click');
scenario('hold stops on pointer release, cancellation, capture loss, or Space release');

setActionInView(true);
await hold.emit('keydown', { code: 'Space' });
await settle();
assert.equal(machine.fire.state, 'firing');
setActionInView(false);
await settle();
assert.equal(machine.fire.state, 'unknown');
assert.equal(overlay.hidden, false);
await start.emit('click');
scenario('leaving the visible panel during a hold requests stop and restores the overlay');

for (const type of ['co2', 'ir', 'fiber', undefined] as const) {
  d = { ...d, laser: type === undefined ? undefined : { type } };
  panel.refresh();
  assert.equal(start.disabled, false);
  assert.equal(hold.disabled, false);
}
scenario('CO2, IR, fiber and unspecified sources use the same start and hold controls');
await start.emit('click');
await windowEvents.emit('blur');
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(machine.fire.state, 'unknown');
assert.equal(overlay.hidden, false);
scenario('loss of focus ends session without claiming shutdown');
const draft = { ...d };
const settings = fireSettings(draft);
assert.equal(settings.save(), false);
assert.equal(draft.fireMaxPower, d.fireMaxPower);
scenario('already-open Fire settings cannot save while session is locked');
machine.connected = false;
(machine as unknown as { emit(e: { type: 'connection' }): void }).emit({ type: 'connection' });
assert.equal(overlayStop.disabled, true);
assert.match(overlay.all('span')[1].textContent, /keine lokale Verbindung/);
assert.equal(confirm.disabled, false);
await confirm.emit('click');
assert.equal(machine.fire.locked, false);
scenario('disconnected overlay disables software stop with reason but permits physical-off acknowledgement');
const fields = new Element('div');
fields.append(...settings.rows as unknown as Element[]);
assert.ok(fields.all('div').some((el) => el.children.includes(fireWarning())));
const settingsInputs = fields.all('input').filter((el) => el.attributes.inputmode === 'decimal');
assert.equal(settingsInputs.length, 2);
for (const input of settingsInputs) {
  const original = input.value;
  for (const value of ['', '-1', '0', 'NaN', 'Infinity', '99999', '0,5,1', '0.5x']) {
    input.value = value;
    await input.emit('input');
    assert.equal(settings.save(), false, value);
    assert.equal(input.attributes['aria-invalid'], 'true');
  }
  input.value = original;
  await input.emit('input');
}
settingsInputs[0].value = '0,5';
settingsInputs[1].value = '4.5';
assert.equal(settings.save(), true);
assert.equal(draft.fireMaxPower, 0.5);
assert.equal(draft.fireMaxSeconds, 4.5);
scenario('Fire-specific settings reject invalid visible drafts, display exact opt-in warning and save valid values');
machine.fire.confirmOff();
console.log(`${scenarios} individually reported fire UI scenarios passed (in-memory DOM/transport; no hardware)`);
