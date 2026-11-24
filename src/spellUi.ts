// Oberfläche für die Rechtschreibprüfung: Wörterbuch-Verwaltung in den Einstellungen und
// Live-Unterstreichung samt Korrekturleiste + automatischem Download-Vorschlag im Texteditor (#texteditor).
import { h } from './dom';
import { t } from './i18n';
import type { Obj } from './model';
import {
  activeInstalledLangs,
  addUserWord,
  checkTextAsync,
  defaultDictForLang,
  dictDisplayName,
  dictLicense,
  downloadDict,
  ignoreWordForSession,
  isSpellAvailable,
  isSpellPromptDismissed,
  listInstalledDicts,
  loadSpellSettings,
  onSpellUpdated,
  removeDict,
  removeUserWord,
  replaceWordSpan,
  saveSpellSettings,
  setSpellPromptDismissed,
  SPELL_CATALOG,
  suggestWord,
  type WordSpan,
} from './spell';

/** Einstellungs-Widget: installierte Sprachen an-/abwählen, nachladen, entfernen und eigenes Wörterbuch pflegen */
export function spellSettingsWidget(): HTMLElement {
  const root = h('div', { class: 'spell-settings' });
  const installedBox = h('div', { class: 'spell-installed' });
  const status = h('div', { class: 'spell-status muted', role: 'status' });
  const addSelect = h('select', { class: 'spell-select', 'aria-label': t('Wörterbuch-Sprache auswählen') }) as HTMLSelectElement;
  const addBtn = h('button', { type: 'button', class: 'small' }, t('Herunterladen')) as HTMLButtonElement;
  const addRow = h('div', { class: 'spell-add-row' }, addSelect, addBtn);
  const licenseNote = h('div', { class: 'spell-license muted' });
  const userList = h('div', { class: 'spell-user-list' });
  const userIn = h('input', { type: 'text', class: 'spell-user-in', placeholder: t('Eigenes Wort hinzufügen …'), spellcheck: false }) as HTMLInputElement;
  const userAddBtn = h('button', { type: 'button', class: 'small' }, t('Hinzufügen')) as HTMLButtonElement;
  const userBlock = h(
    'div',
    { class: 'spell-user-block' },
    h('div', { class: 'spell-subhead' }, t('Benutzerwörterbuch')),
    h('div', { class: 'spell-user-add' }, userIn, userAddBtn),
    userList,
  );

  let busy = false;
  let installed: string[] = [];

  const updateLicense = () => {
    const code = addSelect.value;
    const lic = code ? dictLicense(code) : '';
    licenseNote.textContent = lic ? t('Quelle: wooorm/dictionaries (Hunspell UTF-8) · Lizenz: {license}', { license: lic }) : '';
  };

  const renderUserWords = () => {
    const words = loadSpellSettings().userWords;
    if (!words.length) {
      userList.replaceChildren(h('span', { class: 'muted' }, t('Noch keine eigenen Wörter gespeichert.')));
      return;
    }
    userList.replaceChildren(
      ...words.map((w) =>
        h(
          'span',
          { class: 'spell-chip' },
          h('span', {}, w),
          h(
            'button',
            {
              type: 'button',
              class: 'spell-chip-x',
              title: t('Aus Benutzerwörterbuch entfernen'),
              onclick: () => {
                removeUserWord(w);
                renderUserWords();
              },
            },
            '×',
          ),
        ),
      ),
    );
  };

  const renderDicts = () => {
    const settings = loadSpellSettings();
    const instSet = new Set(installed);
    if (!isSpellAvailable()) {
      installedBox.replaceChildren(h('div', { class: 'muted' }, t('Wörterbücher können nur in der Desktop-App geladen und geprüft werden.')));
      addRow.hidden = true;
      licenseNote.hidden = true;
      return;
    }
    addRow.hidden = false;
    licenseNote.hidden = false;

    if (!installed.length) {
      installedBox.replaceChildren(h('div', { class: 'muted' }, t('Noch kein Wörterbuch installiert. Unten eine oder mehrere Sprachen herunterladen.')));
    } else {
      installedBox.replaceChildren(
        ...installed.map((code) => {
          const cb = h('input', { type: 'checkbox', checked: settings.langs.includes(code), disabled: busy }) as HTMLInputElement;
          cb.onchange = () => {
            const cur = loadSpellSettings();
            const langs = cb.checked ? [...new Set([...cur.langs, code])] : cur.langs.filter((c) => c !== code);
            saveSpellSettings({ ...cur, langs });
          };
          const rmBtn = h(
            'button',
            {
              type: 'button',
              class: 'small',
              disabled: busy,
              title: t('Wörterbuch von diesem Rechner entfernen'),
              onclick: async () => {
                busy = true;
                status.textContent = t('Entferne {lang} …', { lang: dictDisplayName(code) });
                renderDicts();
                try {
                  await removeDict(code);
                  installed = await listInstalledDicts(true);
                  status.textContent = t('{lang} entfernt.', { lang: dictDisplayName(code) });
                } catch (e) {
                  status.textContent = String(e instanceof Error ? e.message : e);
                } finally {
                  busy = false;
                  renderDicts();
                }
              },
            },
            t('Entfernen'),
          );
          return h(
            'div',
            { class: 'spell-dict-row' },
            h(
              'label',
              { class: 'spell-dict-label' },
              cb,
              h('span', { class: 'spell-dict-name' }, dictDisplayName(code)),
              h('span', { class: 'muted spell-dict-meta' }, `${code} · ${dictLicense(code)}`),
            ),
            rmBtn,
          );
        }),
      );
    }

    const defCode = defaultDictForLang();
    const available = SPELL_CATALOG.filter((d) => !instSet.has(d.code)).sort((a, b) => {
      if (a.code === defCode) return -1;
      if (b.code === defCode) return 1;
      return dictDisplayName(a.code).localeCompare(dictDisplayName(b.code));
    });
    const prev = addSelect.value;
    addSelect.replaceChildren(...available.map((d) => h('option', { value: d.code }, `${dictDisplayName(d.code)} (${d.code})`)));
    if (available.some((d) => d.code === prev)) addSelect.value = prev;
    addSelect.disabled = busy || !available.length;
    addBtn.disabled = busy || !available.length;
    updateLicense();
  };

  addSelect.onchange = updateLicense;
  addBtn.onclick = async () => {
    const code = addSelect.value;
    if (!code || busy) return;
    busy = true;
    status.textContent = t('Lade Wörterbuch {lang} …', { lang: dictDisplayName(code) });
    renderDicts();
    try {
      await downloadDict(code);
      setSpellPromptDismissed(false);
      installed = await listInstalledDicts(true);
      status.textContent = t('Wörterbuch {lang} installiert.', { lang: dictDisplayName(code) });
    } catch (e) {
      status.textContent = t('Download fehlgeschlagen: {err}', { err: String(e instanceof Error ? e.message : e) });
    } finally {
      busy = false;
      renderDicts();
    }
  };

  const commitUserWord = () => {
    const w = userIn.value.trim();
    if (!w) return;
    addUserWord(w);
    userIn.value = '';
    renderUserWords();
  };
  userAddBtn.onclick = commitUserWord;
  userIn.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitUserWord();
    }
  };

  root.append(installedBox, addRow, licenseNote, status, userBlock);
  renderDicts();
  renderUserWords();
  if (isSpellAvailable()) {
    void listInstalledDicts().then((list) => {
      installed = list;
      renderDicts();
    });
  }
  return root;
}

export interface TextEditorSpellController {
  onOpen(): void;
  onInput(): void;
  onClose(): void;
}

/**
 * Bindet Live-Rechtschreibprüfung, rote Wellenunterstreichung, Korrekturleiste und automatischen
 * Wörterbuch-Download-Vorschlag an das Texteditor-Overlay (#texteditor).
 */
export function attachTextEditorSpell(
  box: HTMLElement,
  ta: HTMLTextAreaElement,
  opts: {
    getTarget: () => Obj | null;
    onReplace: (next: string) => void;
    openSettings: () => void;
  },
): TextEditorSpellController {
  const backdrop = box.querySelector('.te-backdrop') as HTMLElement | null;
  const promptEl = h('div', { class: 'te-spell-prompt', hidden: true });
  const barEl = h('div', { class: 'te-spell-bar', hidden: true });
  const hintEl = box.querySelector('.hint');
  if (hintEl) box.insertBefore(barEl, hintEl);
  else box.append(barEl);
  box.insertBefore(promptEl, barEl);

  let badSpans: WordSpan[] = [];
  let seq = 0;
  let timer = 0;
  let activeWordKey = '';
  let promptBusy = false;

  const preventBlur = (e: Event) => e.preventDefault();

  const syncBackdropGeometry = () => {
    if (!backdrop) return;
    backdrop.style.width = `${ta.offsetWidth}px`;
    backdrop.style.height = `${ta.offsetHeight}px`;
    backdrop.scrollTop = ta.scrollTop;
    backdrop.scrollLeft = ta.scrollLeft;
  };

  if (backdrop && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncBackdropGeometry).observe(ta);
  }

  const renderBackdrop = () => {
    if (!backdrop) return;
    const text = ta.value;
    if (!badSpans.length) {
      backdrop.replaceChildren();
      return;
    }
    const nodes: (Node | string)[] = [];
    let pos = 0;
    for (const sp of badSpans) {
      if (sp.start < pos || sp.end > text.length) continue;
      if (sp.start > pos) nodes.push(text.slice(pos, sp.start));
      nodes.push(h('mark', { class: 'spell-err' }, text.slice(sp.start, sp.end)));
      pos = sp.end;
    }
    if (pos < text.length) nodes.push(text.slice(pos));
    // Abschließender Zeilenumbruch sorgt dafür, dass eine leere letzte Zeile genauso hoch ist wie im textarea
    if (text.endsWith('\n')) nodes.push('\n');
    backdrop.replaceChildren(...nodes);
    syncBackdropGeometry();
  };

  const applyReplacement = (span: WordSpan, replacement: string) => {
    const next = replaceWordSpan(ta.value, span.start, span.end, span.word, replacement);
    if (next === null) return;
    ta.value = next;
    const caret = span.start + replacement.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    opts.onReplace(next);
    scheduleCheck(true);
  };

  const spanAtCaret = (): WordSpan | null => {
    const pos = ta.selectionStart ?? 0;
    return badSpans.find((sp) => pos >= sp.start && pos <= sp.end) ?? null;
  };

  const renderBar = () => {
    if (!badSpans.length || !opts.getTarget()) {
      barEl.hidden = true;
      barEl.replaceChildren();
      activeWordKey = '';
      return;
    }
    barEl.hidden = false;
    const focused = spanAtCaret();
    if (!focused) {
      activeWordKey = '';
      // Kompakte anklickbare Liste fehlerhafter Wörter (Klick springt hin und zeigt Vorschläge)
      const shown = badSpans.slice(0, 6);
      barEl.replaceChildren(
        h('span', { class: 'te-spell-label muted' }, t('Prüfen:')),
        ...shown.map((sp) =>
          h(
            'button',
            {
              type: 'button',
              class: 'te-spell-bad',
              onmousedown: preventBlur,
              onclick: () => {
                ta.focus();
                ta.setSelectionRange(sp.start, sp.end);
                renderBar();
              },
            },
            sp.word,
          ),
        ),
        badSpans.length > shown.length ? h('span', { class: 'muted' }, `+${badSpans.length - shown.length}`) : '',
      );
      return;
    }

    const key = `${focused.start}:${focused.word}`;
    if (key === activeWordKey && barEl.dataset.word === key) return;
    activeWordKey = key;
    barEl.dataset.word = key;

    const suggWrap = h('span', { class: 'te-spell-suggs' }, h('span', { class: 'muted' }, '…'));
    const actions = h(
      'span',
      { class: 'te-spell-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: t('Wort ins Benutzerwörterbuch aufnehmen'),
          onmousedown: preventBlur,
          onclick: () => {
            addUserWord(focused.word);
            scheduleCheck(true);
          },
        },
        t('Merken'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'small',
          title: t('Wort in dieser Sitzung ignorieren'),
          onmousedown: preventBlur,
          onclick: () => {
            ignoreWordForSession(focused.word);
            scheduleCheck(true);
          },
        },
        t('Ignorieren'),
      ),
    );
    barEl.replaceChildren(h('span', { class: 'te-spell-word' }, focused.word), suggWrap, actions);

    const mySeq = seq;
    void suggestWord(focused.word, 4).then((list) => {
      if (mySeq !== seq || activeWordKey !== key) return;
      if (!list.length) {
        suggWrap.replaceChildren(h('span', { class: 'muted' }, t('Keine Vorschläge')));
        return;
      }
      suggWrap.replaceChildren(
        ...list.map((cand) =>
          h(
            'button',
            {
              type: 'button',
              class: 'small te-spell-sugg',
              onmousedown: preventBlur,
              onclick: () => applyReplacement(focused, cand),
            },
            cand,
          ),
        ),
      );
    });
  };

  const runCheck = async () => {
    const target = opts.getTarget();
    if (!target || target.shape.kind !== 'text') {
      badSpans = [];
      renderBackdrop();
      renderBar();
      return;
    }
    const mySeq = ++seq;
    const text = ta.value;
    const hasVt = !!target.shape.vt;
    const bad = await checkTextAsync(text, hasVt);
    if (mySeq !== seq || ta.value !== text || !opts.getTarget()) return;
    badSpans = bad;
    activeWordKey = '';
    renderBackdrop();
    renderBar();
  };

  const scheduleCheck = (now = false) => {
    clearTimeout(timer);
    if (now) void runCheck();
    else timer = window.setTimeout(() => void runCheck(), 180);
  };

  const updatePrompt = async () => {
    if (!isSpellAvailable() || !loadSpellSettings().enabled || isSpellPromptDismissed()) {
      promptEl.hidden = true;
      return;
    }
    const installed = await listInstalledDicts();
    if (!opts.getTarget()) return;
    if (installed.length > 0 && activeInstalledLangs().length > 0) {
      promptEl.hidden = true;
      return;
    }
    if (installed.length > 0) {
      // Wörterbücher vorhanden, aber keines aktiv -> keinen Download vorschlagen
      promptEl.hidden = true;
      return;
    }
    const code = defaultDictForLang();
    const name = dictDisplayName(code);
    const loadBtn = h(
      'button',
      {
        type: 'button',
        class: 'small',
        disabled: promptBusy,
        onmousedown: preventBlur,
        onclick: async () => {
          if (promptBusy) return;
          promptBusy = true;
          loadBtn.disabled = true;
          loadBtn.textContent = t('Lädt …');
          try {
            await downloadDict(code);
            promptEl.hidden = true;
            scheduleCheck(true);
          } catch (e) {
            loadBtn.disabled = false;
            loadBtn.textContent = t('Erneut laden');
            loadBtn.title = String(e instanceof Error ? e.message : e);
          } finally {
            promptBusy = false;
          }
        },
      },
      promptBusy ? t('Lädt …') : t('Laden'),
    ) as HTMLButtonElement;

    const settingsBtn = h(
      'button',
      {
        type: 'button',
        class: 'small',
        onmousedown: preventBlur,
        onclick: () => opts.openSettings(),
      },
      t('Sprachen …'),
    );
    const dismissBtn = h(
      'button',
      {
        type: 'button',
        class: 'small te-spell-dismiss',
        title: t('Nicht mehr fragen'),
        onmousedown: preventBlur,
        onclick: () => {
          setSpellPromptDismissed(true);
          promptEl.hidden = true;
        },
      },
      '×',
    );
    promptEl.replaceChildren(
      h('span', { class: 'te-spell-prompt-text' }, t('Wörterbuch ({lang}) für Rechtschreibprüfung laden?', { lang: name })),
      loadBtn,
      settingsBtn,
      dismissBtn,
    );
    promptEl.hidden = false;
  };

  ta.addEventListener('scroll', syncBackdropGeometry);
  ta.addEventListener('click', () => renderBar());
  ta.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) renderBar();
  });

  onSpellUpdated(() => {
    if (opts.getTarget()) {
      void updatePrompt();
      scheduleCheck(true);
    }
  });

  return {
    onOpen() {
      badSpans = [];
      activeWordKey = '';
      renderBackdrop();
      renderBar();
      syncBackdropGeometry();
      void updatePrompt();
      scheduleCheck(true);
    },
    onInput() {
      // Unterstreichung sofort leeren falls Offsets verschoben sind, dann kurz entprellt neu prüfen
      if (badSpans.length) {
        badSpans = [];
        renderBackdrop();
      }
      scheduleCheck(false);
    },
    onClose() {
      clearTimeout(timer);
      seq++;
      badSpans = [];
      activeWordKey = '';
      renderBackdrop();
      barEl.hidden = true;
      promptEl.hidden = true;
    },
  };
}
