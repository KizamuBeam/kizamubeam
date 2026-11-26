import type { Editor } from './editor';
import type { Pt } from './model';
import { h } from './dom';
import { dec, t } from './i18n';
import { materializeDimParam, readDimField } from './editor/params';

export interface DimensionInputOptions {
  signal?: AbortSignal;
  placement?: (place: Pt) => number;
  cycle?: () => number;
  label?: () => string;
}

export interface DimensionValue {
  v: number;
  expr?: string;
  place?: Pt;
  pendingParam?: { name: string; value: number };
}

export const dimensionNumber = (value: number) => dec(value.toFixed(2));

/** Winkelanzeige: zwei Nachkommastellen mit dem Dezimaltrennzeichen der Sprache (Anzeige nur, Wert exakt). */
export const degreeNumber = (value: number) => dec(value.toFixed(2));

/** Zählfelder (Spalten, Zeilen, Anzahl): ganze Zahl ohne Nachkommastellen. */
export const countNumber = (value: number) => String(Math.trunc(value));

/** The editor owns cancellation; this view owns only its DOM and pointer capture. */
export function askValueInline(ed: Editor, title: string, current: number, unit: string, expr?: string, options: DimensionInputOptions = {}): Promise<DimensionValue | null | 'unavailable'> {
  if (typeof document === 'undefined' || !ed.canvas) return Promise.resolve('unavailable');
  if (options.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false, pinned = false, edited = false;
    let place = ed.cursorOnCanvas ? ed.toScreen(ed.cursor) : { x: ed.w / 2, y: ed.h / 2 };
    let placed = false, press: number | undefined;
    const val = h('input', { type: 'text', id: 'sk-val-inline', value: expr ?? dimensionNumber(current), 'aria-label': title, list: 'sk-dim-params' }) as HTMLInputElement;
    const params = h('datalist', { id: 'sk-dim-params' }, ...ed.paramList().map((p) => h('option', { value: p.name })));
    const err = h('div', { class: 'note', role: 'alert' });
    const box = h('div', { class: 'sk-dim-inline', role: 'dialog', 'aria-label': title, style: 'position:fixed;z-index:60;background:var(--panel, #fff);border:1px solid #888;border-radius:6px;padding:6px;box-shadow:0 2px 10px rgba(0,0,0,.25)' }, val, params,
      h('div', { class: 'note' }, t('Klicken fixiert die Ablage. Enter übernimmt, Esc verwirft. U wechselt das Kreismaß.')), err);
    const positionBox = () => {
      const rect = ed.canvas.getBoundingClientRect();
      box.style.left = `${rect.left + place.x + 12}px`;
      box.style.top = `${rect.top + place.y + 12}px`;
      const label = options.label?.() ?? title;
      box.setAttribute('aria-label', label);
      val.setAttribute('aria-label', label);
    };
    const update = (e: PointerEvent) => {
      const rect = ed.canvas.getBoundingClientRect();
      place = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      placed = true;
      const proposal = options.placement?.(place);
      if (proposal !== undefined) {
        current = proposal;
        if (!edited && !expr) val.value = dimensionNumber(current);
      }
      positionBox();
    };
    const finish = (result: DimensionValue | null, restore = true) => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', follow, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', blur);
      options.signal?.removeEventListener('abort', abort);
      val.removeEventListener('blur', inputBlur);
      const focused = document.activeElement === val;
      box.remove();
      if (restore && focused) ed.canvas.focus({ preventScroll: true });
      resolve(result);
    };
    const follow = (e: PointerEvent) => { if (!pinned && e.target === ed.canvas) update(e); };
    const down = (e: PointerEvent) => {
      if (e.target !== ed.canvas || e.button !== 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      press = e.pointerId;
    };
    const release = () => { press = undefined; };
    const up = (e: PointerEvent) => {
      if (press !== e.pointerId) return;
      release();
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.target === ed.canvas && e.button === 0 && !pinned) { update(e); pinned = true; }
      val.focus({ preventScroll: true });
    };
    const abort = () => finish(null, false);
    const blur = () => finish(null, false);
    const inputBlur = () => finish(null, false);
    val.addEventListener('input', () => { edited = true; });
    val.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      else if (e.key.toLowerCase() === 'u' && !edited && !expr && options.cycle) {
        e.preventDefault(); current = options.cycle(); val.value = dimensionNumber(current); val.select(); positionBox();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const parsed = !edited ? { v: current, ...(expr ? { expr } : {}) } : readDimField(ed, val.value, unit);
        if ('error' in parsed) { err.textContent = parsed.error; return; }
        const { pendingParam, ...answer } = parsed as Exclude<ReturnType<typeof readDimField>, { error: string }>;
        if (pendingParam && !options.signal) materializeDimParam(ed, pendingParam);
        finish({ ...answer, ...(options.signal && pendingParam ? { pendingParam } : {}), ...(placed ? { place } : {}) });
      }
    });
    window.addEventListener('pointermove', follow, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', blur);
    options.signal?.addEventListener('abort', abort, { once: true });
    document.body.append(box);
    positionBox();
    val.focus(); val.select();
    val.addEventListener('blur', inputBlur);
  });
}
