import { h } from './dom';
import { commandKey } from './commandKeys';

export interface ContextAction {
  id: string; label: string; run: () => unknown; enabled?: boolean; checked?: boolean;
  items?: ContextAction[];
}
let activeClose: (() => void) | null = null;
export const closeEditorMenu = () => activeClose?.();

/** Owns listeners, focus and keyboard capture; does not touch documents or machine state. */
export function showEditorMenu(x: number, y: number, groups: ContextAction[][], onClose?: () => void) {
  closeEditorMenu();
  // Existing toolbar/toolbox menus share this CSS class. Dismiss them normally,
  // allowing their own outside-click cleanup rather than removing their DOM.
  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const previous = document.activeElement as HTMLElement | null;
  const root = h('div', { class: 'ctx-menu menu-items editor-context-menu', role: 'menu' });
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true; root.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', scroll, true);
    activeClose = null; onClose?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const closeSubs = (except: HTMLElement | null = null) => {
    for (const sub of [...root.querySelectorAll<HTMLElement>('.editor-context-submenu')]) {
      if (sub !== except && !sub.hidden) {
        sub.hidden = true;
        sub.closest('.editor-context-subitem')?.querySelector('button')?.setAttribute('aria-expanded', 'false');
      }
    }
  };
  const fill = (parent: HTMLElement, actions: ContextAction[]) => {
    for (const action of actions) {
      if (action.items) {
        const nested = h('div', { class: 'editor-context-submenu', hidden: true, role: 'menu' });
        fill(nested, action.items);
        const openSub = () => {
          closeSubs(nested);
          nested.hidden = false;
          button.setAttribute('aria-expanded', 'true');
          // Fixed am Viewport verankern (nicht absolut im Menü): Ein Flyout mit
          // left:100% ragt aus der Menübox und erzeugt dort Scroll-Overflow
          // (horizontale Scrollbar, verschobene Darstellung). Fixed-Elemente
          // scrollen nicht mit und lösen keinen Scroll-Overflow des Menüs aus.
          const r = button.getBoundingClientRect();
          nested.style.position = 'fixed';
          nested.style.margin = '0';
          nested.style.left = '0px';
          nested.style.top = '0px';
          const w = nested.offsetWidth, hh = nested.offsetHeight;
          let left = r.right - 2;
          if (left + w > innerWidth - 8 && r.left - w + 2 >= 8) left = r.left - w + 2;
          nested.style.left = `${Math.max(8, left)}px`;
          // Vertikal im Viewport halten: Bei Triggern nahe unten nach oben schieben.
          nested.style.top = `${Math.max(8, Math.min(r.top - 4, innerHeight - hh - 8))}px`;
        };
        const closeSub = () => {
          nested.hidden = true; button.setAttribute('aria-expanded', 'false');
        };
        const button = h('button', { role: 'menuitem', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
          onclick: () => { if (nested.hidden) { openSub(); nested.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }); } else closeSub(); },
          onmouseenter: () => openSub(), onfocus: () => openSub() },
          action.label, ' ▸');
        const wrap = h('div', { class: 'editor-context-subitem', onmouseleave: () => closeSub() }, button, nested);
        parent.append(wrap); continue;
      }
      const button = h('button', { type: 'button', role: action.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': action.checked === undefined ? undefined : String(action.checked), disabled: action.enabled === false,
        onclick: () => { if (disposed || button.disabled) return; close(); void action.run(); } },
      h('span', {}, action.checked ? '✓ ' + action.label : action.label), commandKey(action.id) ? h('kbd', {}, commandKey(action.id)) : null);
      parent.append(button);
    }
  };
  groups.filter((group) => group.length).forEach((group, i) => { if (i) root.append(h('hr', { role: 'separator' })); fill(root, group); });
  const outside = (event: MouseEvent) => { if (!root.contains(event.target as Node)) close(); };
  // Scrollen innerhalb des Menüs schließt nur offene Flyouts (fixiert am
  // Viewport, würden sonst vom auslösenden Eintrag losgelöst stehenbleiben).
  const scroll = (event: Event) => {
    if (!root.contains(event.target as Node)) close();
    // Scrollen im Menü parkt offene Flyouts; Scrollen innerhalb eines Flyouts lässt es offen.
    else if (!(event.target as HTMLElement | null)?.closest?.('.editor-context-submenu')) closeSubs();
  };
  const keydown = (event: KeyboardEvent) => {
    // Never let Delete, Ctrl+A, Space or node shortcuts reach the editor while a menu owns focus.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      // First Escape only backs out of an open flyout; the second closes the menu.
      const open = root.querySelector('.editor-context-submenu:not([hidden])');
      const parentButton = (document.activeElement as HTMLElement | null)?.closest('.editor-context-subitem')?.querySelector('button');
      if (open && document.activeElement && open.contains(document.activeElement) && parentButton) {
        event.preventDefault(); closeSubs(); (parentButton as HTMLButtonElement).focus(); return;
      }
      event.preventDefault(); close(); return;
    }
    if (event.key === 'Tab') { close(); return; }
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((b) => b.getClientRects().length);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'ArrowRight') {
      // Ins Flyout springen, nicht toggeln: Bei offenem Flyout Fokus auf den ersten Eintrag legen.
      const btn = document.activeElement as HTMLButtonElement | null;
      const sub = btn?.closest('.editor-context-subitem')?.querySelector<HTMLElement>('.editor-context-submenu');
      if (btn?.getAttribute('aria-haspopup') === 'true' && sub) {
        event.preventDefault();
        if (sub.hidden) btn.click();
        else sub.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      }
    } else if (event.key === 'ArrowLeft') {
      const sub = (document.activeElement as HTMLElement | null)?.closest('.editor-context-submenu');
      const parentButton = sub?.parentElement?.querySelector('button');
      if (sub && parentButton) {
        event.preventDefault(); closeSubs(); (parentButton as HTMLButtonElement).focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); buttons[current]?.click(); }
  };
  document.body.append(root);
  root.style.left = `${Math.max(4, Math.min(x, innerWidth - root.offsetWidth - 4))}px`;
  root.style.top = `${Math.max(4, Math.min(y, innerHeight - root.offsetHeight - 4))}px`;
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('scroll', scroll, true);
  window.addEventListener('blur', close); window.addEventListener('resize', close);
  activeClose = close;
  root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  return close;
}
