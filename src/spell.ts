// Mehrsprachige Rechtschreibprüfung (DOM-frei): Wort-Extraktion, Einstellungen, Benutzerwörterbuch,
// Katalog nachladbarer Hunspell-Wörterbücher und synchroner Cache für die Konstruktionsprüfung.
// Die eigentliche Hunspell-Prüfung und Downloads laufen im Rust-Backend (src-tauri/src/spell.rs).
import { lang } from './i18n';

export interface SpellDictInfo {
  /** Kennung im Katalog und im Rust-Backend (wooorm/dictionaries) */
  code: string;
  /** BCP-47-Sprachtag für lokalisierte Anzeigenamen (Intl.DisplayNames) */
  bcp47: string;
  /** Kurzangabe der Wörterbuch-Lizenz */
  license: string;
}

/** Kuratierter Katalog UTF-8-normierter Hunspell-Wörterbücher (spiegelt ALLOWED_CODES in src-tauri/src/spell.rs) */
export const SPELL_CATALOG: readonly SpellDictInfo[] = [
  { code: 'de', bcp47: 'de-DE', license: 'GPL-2.0 / GPL-3.0' },
  { code: 'de-AT', bcp47: 'de-AT', license: 'GPL-2.0 / GPL-3.0' },
  { code: 'de-CH', bcp47: 'de-CH', license: 'GPL-2.0 / GPL-3.0' },
  { code: 'en', bcp47: 'en-US', license: 'MIT / BSD' },
  { code: 'en-GB', bcp47: 'en-GB', license: 'MIT / BSD' },
  { code: 'en-AU', bcp47: 'en-AU', license: 'MIT / BSD' },
  { code: 'en-CA', bcp47: 'en-CA', license: 'MIT / BSD' },
  { code: 'es', bcp47: 'es', license: 'GPL-3.0 / LGPL-3.0 / MPL-1.1' },
  { code: 'fr', bcp47: 'fr', license: 'MPL-2.0' },
  { code: 'it', bcp47: 'it', license: 'GPL-3.0' },
  { code: 'pt', bcp47: 'pt-BR', license: 'LGPL-3.0 / MPL-2.0' },
  { code: 'pt-PT', bcp47: 'pt-PT', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'nl', bcp47: 'nl', license: 'BSD-3-Clause / CC-BY-3.0' },
  { code: 'pl', bcp47: 'pl', license: 'GPL-3.0 / LGPL-3.0 / MPL-2.0' },
  { code: 'cs', bcp47: 'cs', license: 'GPL-2.0' },
  { code: 'da', bcp47: 'da', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'sv', bcp47: 'sv', license: 'LGPL-3.0' },
  { code: 'nb', bcp47: 'nb', license: 'GPL-2.0' },
  { code: 'nn', bcp47: 'nn', license: 'GPL-2.0' },
  { code: 'hu', bcp47: 'hu', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'ro', bcp47: 'ro', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'tr', bcp47: 'tr', license: 'MIT' },
  { code: 'hr', bcp47: 'hr', license: 'LGPL-2.1 / SISSL' },
  { code: 'sk', bcp47: 'sk', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'sl', bcp47: 'sl', license: 'GPL-3.0 / LGPL-2.1' },
  { code: 'uk', bcp47: 'uk', license: 'GPL-3.0' },
  { code: 'ru', bcp47: 'ru', license: 'BSD-3-Clause' },
  { code: 'el', bcp47: 'el', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'bg', bcp47: 'bg', license: 'GPL-2.0 / LGPL-2.1 / MPL-1.1' },
  { code: 'ca', bcp47: 'ca', license: 'GPL-2.0 / LGPL-2.1' },
  { code: 'et', bcp47: 'et', license: 'LGPL-2.1' },
  { code: 'lt', bcp47: 'lt', license: 'BSD-3-Clause' },
  { code: 'lv', bcp47: 'lv', license: 'LGPL-2.1' },
  { code: 'vi', bcp47: 'vi', license: 'GPL-2.0' },
];

const CATALOG_MAP = new Map<string, SpellDictInfo>(SPELL_CATALOG.map((d) => [d.code, d]));

export interface SpellSettings {
  /** Rechtschreibprüfung beim Tippen im Texteditor aktiv */
  enabled: boolean;
  /** Aktivierte Wörterbuch-Sprachen (mehrere gleichzeitig möglich) */
  langs: string[];
  /** Eigene Wörter (Eigennamen, Fachbegriffe), die immer als richtig gelten */
  userWords: string[];
}

export interface WordSpan {
  word: string;
  start: number;
  end: number;
}

export interface SpellBackend {
  listInstalled(): Promise<string[]>;
  download(code: string): Promise<void>;
  remove(code: string): Promise<void>;
  checkWords(langs: string[], words: string[]): Promise<string[]>;
  suggest(langs: string[], word: string, limit?: number): Promise<string[]>;
}

const KEY = 'kizamubeam.spell';
const DISMISS_KEY = 'kizamubeam.spellPromptDismissed';

/** Passender Wörterbuch-Code für eine App-Sprache (z. B. 'de' → 'de', 'pt-BR' → 'pt') */
export function defaultDictForLang(appLang: string = lang): string {
  const norm = appLang.trim().toLowerCase();
  if (!norm) return 'en';
  if (norm === 'pt-br') return 'pt';
  const exact = SPELL_CATALOG.find((d) => d.code.toLowerCase() === norm || d.bcp47.toLowerCase() === norm);
  if (exact) return exact.code;
  const primary = norm.split('-')[0];
  const base = SPELL_CATALOG.find((d) => d.code.toLowerCase() === primary);
  return base ? base.code : 'en';
}

/** Lokalisierter Name eines Wörterbuchs in der aktuellen App-Sprache */
export function dictDisplayName(code: string, displayLang: string = lang): string {
  const info = CATALOG_MAP.get(code);
  const tag = info?.bcp47 ?? code;
  try {
    const n = new Intl.DisplayNames([displayLang], { type: 'language' }).of(tag);
    if (n && n !== tag) return n.charAt(0).toLocaleUpperCase(displayLang) + n.slice(1);
  } catch {
    /* unbekannter Code */
  }
  return code;
}

export function dictLicense(code: string): string {
  return CATALOG_MAP.get(code)?.license ?? '';
}

function defaultSettings(): SpellSettings {
  return { enabled: true, langs: [defaultDictForLang()], userWords: [] };
}

export function loadSpellSettings(): SpellSettings {
  const def = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return def;
    const langs: string[] = Array.isArray(raw.langs)
      ? [...new Set<string>(raw.langs.filter((x: unknown): x is string => typeof x === 'string' && CATALOG_MAP.has(x)))]
      : def.langs;
    const userWords: string[] = Array.isArray(raw.userWords)
      ? [...new Set<string>(raw.userWords.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim()))]
      : [];
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled,
      langs: langs.length || Array.isArray(raw.langs) ? langs : def.langs,
      userWords,
    };
  } catch {
    return def;
  }
}

export function saveSpellSettings(s: SpellSettings) {
  const clean: SpellSettings = {
    enabled: !!s.enabled,
    langs: [...new Set(s.langs.filter((c) => CATALOG_MAP.has(c)))],
    userWords: [...new Set(s.userWords.map((w) => w.trim()).filter(Boolean))],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* ohne Speicher nur in dieser Sitzung */
  }
  notify();
}

export function isSpellPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSpellPromptDismissed(dismissed: boolean) {
  try {
    if (dismissed) localStorage.setItem(DISMISS_KEY, '1');
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ohne Speicher */
  }
}

// ---------- Wort-Extraktion (mit exakten UTF-16-Offsets) ----------

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Projektparameter-Platzhalter wie in src/params.ts (doppelte Klammern {{ / }} sind Escape-Zeichen)
const PARAM_RE = /\{\{|\}\}|(?<!%)\{[^{}\n]*\}/g;
// Variabler Text wie in src/vartext.ts (%#, %4#, %0, %{Name}, %Y usw.)
const VARTEXT_RE = /%(%|\{[^}]*\}|\d*#|\d+|[A-Za-z])/g;
const WORD_RE = /\p{L}+(?:['’-]\p{L}+)*/gu;
const DIGIT_RE = /\d/;

function maskMatches(buf: string[], src: string, re: RegExp) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) buf[i] = ' ';
  }
}

/**
 * Extrahiert prüfbare Wörter samt Zeichenposition [start, end) aus einem Text.
 * Überspringt URLs, E-Mail-Adressen, Projektparameter ({expr}), variablen Text (%#, %Y, %0, %{Spalte}),
 * Einzelbuchstaben, mit Ziffern verbundene Kürzel (12mm, A4, M3) und kurze Großbuchstaben-Kürzel (CNC, SVG).
 */
export function extractWords(text: string, hasVt = false): WordSpan[] {
  if (!text) return [];
  const chars = [...text];
  // UTF-16-Index-kompatibles Maskieren: da wir nur ASCII/BMP-Treffer mit Leerzeichen füllen,
  // arbeiten wir direkt auf Code-Units damit start/end exakt zu textarea.value passen.
  const units = Array.from({ length: text.length }, (_, i) => text[i]);
  void chars;
  maskMatches(units, text, URL_RE);
  maskMatches(units, text, EMAIL_RE);
  maskMatches(units, text, PARAM_RE);
  if (hasVt) maskMatches(units, text, VARTEXT_RE);
  const masked = units.join('');

  const out: WordSpan[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(masked)) !== null) {
    const word = m[0];
    const start = m.index;
    const end = start + word.length;
    if (word.length < 2) continue;
    // Mit Ziffern verbundene Tokens überspringen (z. B. 12mm, A4, CO2, 3D)
    if (start > 0 && DIGIT_RE.test(text[start - 1])) continue;
    if (end < text.length && DIGIT_RE.test(text[end])) continue;
    // Kurze Großbuchstaben-Kürzel überspringen (z. B. CNC, SVG, PDF, LED, QR)
    if (word.length <= 3 && word === word.toUpperCase() && word !== word.toLowerCase()) continue;
    out.push({ word, start, end });
  }
  return out;
}

// ---------- Backend-Anbindung & Cache ----------

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let invokeMod: Promise<typeof import('@tauri-apps/api/core')> | null = null;
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await (invokeMod ??= import('@tauri-apps/api/core'));
  return invoke<T>(cmd, args);
}

const tauriBackend: SpellBackend = {
  listInstalled: () => tauriInvoke<string[]>('spell_list_installed'),
  download: (code) => tauriInvoke<void>('spell_download', { code }),
  remove: (code) => tauriInvoke<void>('spell_remove', { code }),
  checkWords: (langs, words) => tauriInvoke<string[]>('spell_check_words', { langs, words }),
  suggest: (langs, word, limit) => tauriInvoke<string[]>('spell_suggest', { langs, word, limit }),
};

let customBackend: SpellBackend | null = null;

function backend(): SpellBackend | null {
  if (customBackend) return customBackend;
  return isTauri() ? tauriBackend : null;
}

/** Ob eine Rechtschreib-Engine verfügbar ist (Desktop-App oder Test-Backend) */
export function isSpellAvailable(): boolean {
  return backend() !== null;
}

/** Nur für Tests: eigenes Backend einspeisen und Caches leeren */
export function setSpellBackendForTests(b: SpellBackend | null) {
  customBackend = b;
  installedCache = null;
  installedPromise = null;
  wordCache.clear();
  suggestCache.clear();
  pendingWords.clear();
  pendingSuggests.clear();
  sessionIgnored.clear();
}

let installedCache: string[] | null = null;
let installedPromise: Promise<string[]> | null = null;
const wordCache = new Map<string, boolean>();
const suggestCache = new Map<string, string[]>();
const sessionIgnored = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of [...listeners]) fn();
}

/** Benachrichtigung, wenn Wörterbücher geladen/geändert oder asynchrone Prüfergebnisse eingetroffen sind */
export function onSpellUpdated(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getInstalledDictsSync(): string[] | null {
  return installedCache ? [...installedCache] : null;
}

export async function listInstalledDicts(refresh = false): Promise<string[]> {
  const b = backend();
  if (!b) return [];
  if (!refresh && installedCache) return [...installedCache];
  if (!refresh && installedPromise) return installedPromise;
  const p = b
    .listInstalled()
    .then((list) => {
      installedCache = [...list].sort();
      installedPromise = null;
      notify();
      return [...installedCache];
    })
    .catch(() => {
      installedPromise = null;
      return installedCache ? [...installedCache] : [];
    });
  installedPromise = p;
  return p;
}

/** Wörterbuch herunterladen, lokal speichern und automatisch zu den aktiven Sprachen hinzufügen */
export async function downloadDict(code: string): Promise<void> {
  const b = backend();
  if (!b) throw new Error('Rechtschreibprüfung ist nur in der Desktop-App verfügbar.');
  await b.download(code);
  wordCache.clear();
  suggestCache.clear();
  const s = loadSpellSettings();
  if (!s.langs.includes(code)) {
    saveSpellSettings({ ...s, langs: [...s.langs, code] });
  }
  await listInstalledDicts(true);
}

/** Installiertes Wörterbuch entfernen */
export async function removeDict(code: string): Promise<void> {
  const b = backend();
  if (!b) return;
  await b.remove(code);
  wordCache.clear();
  suggestCache.clear();
  const s = loadSpellSettings();
  if (s.langs.includes(code)) {
    saveSpellSettings({ ...s, langs: s.langs.filter((c) => c !== code) });
  }
  await listInstalledDicts(true);
}

/** Aktive Sprachen, die auch tatsächlich installiert sind */
export function activeInstalledLangs(settings: SpellSettings = loadSpellSettings()): string[] {
  if (!installedCache || !installedCache.length) return [];
  const inst = new Set(installedCache);
  return settings.langs.filter((c) => inst.has(c));
}

function isUserOrIgnored(word: string, userSet: Set<string>): boolean {
  const low = word.toLocaleLowerCase();
  return userSet.has(word) || userSet.has(low) || sessionIgnored.has(word) || sessionIgnored.has(low);
}

function makeUserSet(settings: SpellSettings): Set<string> {
  const set = new Set<string>();
  for (const w of settings.userWords) {
    set.add(w);
    set.add(w.toLocaleLowerCase());
  }
  return set;
}

export function addUserWord(word: string) {
  const w = word.trim();
  if (!w) return;
  const s = loadSpellSettings();
  if (s.userWords.some((x) => x.toLocaleLowerCase() === w.toLocaleLowerCase())) return;
  saveSpellSettings({ ...s, userWords: [...s.userWords, w] });
}

export function removeUserWord(word: string) {
  const s = loadSpellSettings();
  const next = s.userWords.filter((x) => x !== word);
  if (next.length !== s.userWords.length) saveSpellSettings({ ...s, userWords: next });
}

export function ignoreWordForSession(word: string) {
  const w = word.trim();
  if (!w) return;
  sessionIgnored.add(w);
  sessionIgnored.add(w.toLocaleLowerCase());
  notify();
}

function cacheKey(langs: string[], word: string): string {
  return `${langs.join(',')}\0${word}`;
}

/** Asynchrone Prüfung eines Textes (für die Live-Prüfung im Texteditor) */
export async function checkTextAsync(text: string, hasVt = false): Promise<WordSpan[]> {
  const b = backend();
  if (!b) return [];
  const settings = loadSpellSettings();
  if (!settings.enabled) return [];
  await listInstalledDicts();
  const langs = activeInstalledLangs(settings);
  if (!langs.length) return [];
  const spans = extractWords(text, hasVt);
  if (!spans.length) return [];
  const userSet = makeUserSet(settings);
  const checkable = spans.filter((sp) => !isUserOrIgnored(sp.word, userSet));
  if (!checkable.length) return [];

  const missing: string[] = [];
  const seenMissing = new Set<string>();
  for (const sp of checkable) {
    const k = cacheKey(langs, sp.word);
    if (!wordCache.has(k) && !seenMissing.has(sp.word)) {
      seenMissing.add(sp.word);
      missing.push(sp.word);
    }
  }
  if (missing.length) {
    const bad = new Set(await b.checkWords(langs, missing));
    for (const w of missing) wordCache.set(cacheKey(langs, w), !bad.has(w));
  }
  return checkable.filter((sp) => wordCache.get(cacheKey(langs, sp.word)) === false);
}

/** Korrekturvorschläge für ein Wort (gecacht) */
export async function suggestWord(word: string, limit = 5): Promise<string[]> {
  const b = backend();
  if (!b || !word) return [];
  await listInstalledDicts();
  const langs = activeInstalledLangs();
  if (!langs.length) return [];
  const k = cacheKey(langs, word);
  const cached = suggestCache.get(k);
  if (cached) return cached.slice(0, limit);
  const list = await b.suggest(langs, word, limit);
  suggestCache.set(k, list);
  return list.slice(0, limit);
}

// ---------- Synchroner Cache + Prefetch für die Konstruktionsprüfung ----------

const pendingWords = new Map<string, Set<string>>();
const pendingSuggests = new Map<string, Set<string>>();
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

function flushPrefetch() {
  prefetchTimer = null;
  const b = backend();
  if (!b) {
    pendingWords.clear();
    pendingSuggests.clear();
    return;
  }
  const wordBatches = [...pendingWords.entries()];
  pendingWords.clear();
  for (const [langKey, set] of wordBatches) {
    const langs = langKey.split(',').filter(Boolean);
    const words = [...set];
    if (!langs.length || !words.length) continue;
    void b
      .checkWords(langs, words)
      .then((badList) => {
        const bad = new Set(badList);
        for (const w of words) wordCache.set(cacheKey(langs, w), !bad.has(w));
        // Für gefundene Tippfehler auch gleich einen Korrekturvorschlag vorladen
        for (const w of badList) queueSuggestPrefetch(langs, w);
        notify();
      })
      .catch(() => {
        /* Fehler still verwerfen */
      });
  }

  const suggBatches = [...pendingSuggests.entries()];
  pendingSuggests.clear();
  for (const [langKey, set] of suggBatches) {
    const langs = langKey.split(',').filter(Boolean);
    if (!langs.length) continue;
    for (const w of set) {
      const k = cacheKey(langs, w);
      if (suggestCache.has(k)) continue;
      void b
        .suggest(langs, w, 3)
        .then((list) => {
          suggestCache.set(k, list);
          notify();
        })
        .catch(() => {
          /* Fehler still verwerfen */
        });
    }
  }
}

function schedulePrefetch() {
  if (prefetchTimer !== null) return;
  prefetchTimer = setTimeout(flushPrefetch, 20);
}

function queueSuggestPrefetch(langs: string[], word: string) {
  const k = cacheKey(langs, word);
  if (suggestCache.has(k)) return;
  const lk = langs.join(',');
  let set = pendingSuggests.get(lk);
  if (!set) {
    set = new Set();
    pendingSuggests.set(lk, set);
  }
  set.add(word);
  schedulePrefetch();
}

export interface CachedMisspelling extends WordSpan {
  suggestions: string[];
}

/**
 * Synchrone Prüfung gegen den Cache (für checkDesign in src/check.ts).
 * Liefert null, wenn noch keine Wörterbuchliste geladen wurde (stößt Laden an und meldet über onSpellUpdated).
 * Fehlende Wörter werden asynchron nachgeladen und über onSpellUpdated nachgemeldet.
 */
export function checkTextCached(text: string, hasVt = false): CachedMisspelling[] | null {
  if (!isSpellAvailable()) return null;
  if (installedCache === null) {
    void listInstalledDicts();
    return null;
  }
  const settings = loadSpellSettings();
  const langs = activeInstalledLangs(settings);
  if (!langs.length) return [];
  const spans = extractWords(text, hasVt);
  if (!spans.length) return [];
  const userSet = makeUserSet(settings);
  const lk = langs.join(',');
  const out: CachedMisspelling[] = [];
  let missingQueued = false;
  for (const sp of spans) {
    if (isUserOrIgnored(sp.word, userSet)) continue;
    const k = cacheKey(langs, sp.word);
    const ok = wordCache.get(k);
    if (ok === undefined) {
      let set = pendingWords.get(lk);
      if (!set) {
        set = new Set();
        pendingWords.set(lk, set);
      }
      set.add(sp.word);
      missingQueued = true;
    } else if (!ok) {
      const sugg = suggestCache.get(k);
      if (sugg === undefined) queueSuggestPrefetch(langs, sp.word);
      out.push({ ...sp, suggestions: sugg ?? [] });
    }
  }
  if (missingQueued) schedulePrefetch();
  return out;
}

const LETTER_RE = /\p{L}/u;

/** Ersetzt ein einzelnes Wort an [start, end) im Text (falls es dort noch vollständig steht) */
export function replaceWordSpan(text: string, start: number, end: number, expectedWord: string, replacement: string): string | null {
  if (start < 0 || end > text.length || start >= end) return null;
  if (text.slice(start, end) !== expectedWord) return null;
  if (start > 0 && LETTER_RE.test(text[start - 1])) return null;
  if (end < text.length && LETTER_RE.test(text[end])) return null;
  return text.slice(0, start) + replacement + text.slice(end);
}
