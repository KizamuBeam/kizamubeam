// Reine Helfer für den internen Öffnen-Dialog: Ordner-Ahnenkette, Dateifilter,
// Sortierung und Größenanzeige. Absichtlich ohne DOM und ohne Tauri, damit sie
// per Unit-Test prüfbar bleiben.
export interface ProjectFileEntry {
  name: string;
  path: string;
  size: number | null;
  modified_ms: number | null;
}

export interface ProjectRoot {
  name: string;
  path: string;
  kind: string;
}

export interface ProjectPlace {
  name: string;
  path: string;
  kind: string;
}

/** Letztes Pfadsegment zur Anzeige (funktioniert mit / und \ sowie Wurzeln). */
export function baseName(path: string): string {
  const segs = splitPath(path);
  if (!segs.length) return path;
  return segs[segs.length - 1];
}

const splitPath = (path: string): string[] => path.split(/[\\/]+/).filter((s) => s !== '');

/** Ahnenkette von der Wurzel bis zum Ordner selbst, z. B. ['/', '/a', '/a/b']. */
export function ancestorsOf(path: string): string[] {
  const p = path.trim().replace(/[\\/]+/g, '/');
  if (!p || p === '/') return ['/'];
  // UNC: //server/freigabe/...
  const unc = p.startsWith('//') ? `//${splitPath(p.slice(2)).slice(0, 2).join('/')}` : null;
  if (unc) {
    const rest = splitPath(p.slice(2)).slice(2);
    const chain = [unc];
    let cur = unc;
    for (const seg of rest) {
      cur += `/${seg}`;
      chain.push(cur);
    }
    return chain.map((c) => c.replace(/\//g, '/'));
  }
  // Windows-Laufwerk: C:/...
  const drive = /^([a-zA-Z]:)(\/|$)/.exec(p);
  if (drive) {
    const root = `${drive[1].toUpperCase()}/`;
    const chain = [root];
    let cur = root;
    for (const seg of splitPath(p.slice(2))) {
      cur += `${seg}/`;
      chain.push(cur.endsWith('/') && cur.length > root.length ? cur.slice(0, -1) : cur);
    }
    // Einheitlich ohne Schrägstrich am Ende (außer der Wurzel selbst)
    return chain.map((c) => (c.length > root.length && c.endsWith('/') ? c.slice(0, -1) : c));
  }
  // POSIX
  const chain = ['/'];
  let cur = '';
  for (const seg of splitPath(p)) {
    cur += `/${seg}`;
    chain.push(cur);
  }
  return chain;
}

/** Dateiname enthält die Suchanfrage (Groß-/Kleinschreibung egal); leere Anfrage passt immer. */
export function filterFiles(files: ProjectFileEntry[], query: string): ProjectFileEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.name.toLowerCase().includes(q));
}

export type FileSortKey = 'name' | 'size' | 'modified';
export type SortDir = 1 | -1;

/** Dateien sortieren; ohne Angabe (null) landen hinten, Kipp-Schalter dreht nur um. */
export function sortFiles(files: ProjectFileEntry[], key: FileSortKey, dir: SortDir): ProjectFileEntry[] {
  const out = [...files];
  const cmp = (a: ProjectFileEntry, b: ProjectFileEntry): number => {
    if (key === 'name') return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
    const av = key === 'size' ? a.size : a.modified_ms;
    const bv = key === 'size' ? b.size : b.modified_ms;
    if (av === null && bv === null) return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av === bv
      ? (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
      : av < bv ? -1 : 1;
  };
  out.sort(cmp);
  if (dir < 0) out.reverse();
  return out;
}

/** Bytezahl kompakt für die Dateiliste (Einheiten international, kein i18n nötig). */
export function formatSize(n: number | null): string {
  if (n === null || !isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? Math.round(kb * 10) / 10 : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
  return `${Math.round((mb / 1024) * 10) / 10} GB`;
}

/** Änderungszeit als lokales Datum für die Dateiliste (null → Gedankenstrich). */
export function formatModified(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return '–';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '–';
  }
}

/** Höchstens so viele Favoriten-Ordner werden gespeichert. */
export const MAX_FAVORITES = 32;

/** Favoritenliste bereinigen: nur nichtleere Pfade, ohne Duplikate, höchstens MAX_FAVORITES. */
export function normalizeFavorites(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const dir = v.trim();
    if (!dir || out.includes(dir)) continue;
    out.push(dir);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** Ordner zu Favoriten hinzufügen oder entfernen; liefert die neue Liste und ob er jetzt dabei ist. */
export function toggleFavorite(list: string[], dir: string): { list: string[]; added: boolean } {
  const clean = dir.trim();
  if (!clean) return { list: [...list], added: false };
  if (list.includes(clean)) return { list: list.filter((d) => d !== clean), added: false };
  return { list: [...list, clean].slice(-MAX_FAVORITES), added: true };
}
