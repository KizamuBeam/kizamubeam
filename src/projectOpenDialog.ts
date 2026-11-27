// Interner Öffnen-Dialog mit Projektvorschau (nur Desktop-App): Ordnerbaum links,
// Dateiliste mit Suche und Sortierung in der Mitte, Vorschau rechts. Die Auswahl
// verändert den Editor nicht; erst „Öffnen“ übernimmt über den bestehenden Ablauf.
import type { Editor } from './editor';
import { h, showDialog } from './dom';
import { t } from './i18n';
import { applyProjectText, noteOpenedDir, openStartDir } from './files';
import {
  ancestorsOf,
  baseName,
  filterFiles,
  formatModified,
  formatSize,
  isHiddenEntry,
  normalizeFavorites,
  sortFiles,
  toggleFavorite,
  visibleEntries,
  type FileSortKey,
  type ProjectDirEntry,
  type ProjectFileEntry,
  type ProjectPlace,
  type ProjectRoot,
  type SortDir,
} from './projectOpenFiles';
import { decodePreviewImages, drawPreviewPage, parsePreviewProject, type PreviewProject } from './projectPreview';

interface DirListing {
  dir: string;
  parent: string | null;
  dirs: ProjectDirEntry[];
  files: ProjectFileEntry[];
  truncated: boolean;
}

const PREVIEW_LIMIT = 64 * 1024 * 1024;

/** Zuletzt geöffnete Ordner dieser Sitzung (flüchtig, max. 8) für „Zuletzt verwendet“. */
const recentDirs: string[] = [];
const noteRecentDir = (dir: string) => {
  const i = recentDirs.indexOf(dir);
  if (i >= 0) recentDirs.splice(i, 1);
  recentDirs.unshift(dir);
  while (recentDirs.length > 8) recentDirs.pop();
};

/** Favoriten-Ordner dieser Sitzung im Dialog (persistent, rechnergebunden, max. 32). */
const FAV_KEY = 'kizamubeam.openFavorites';
const loadFavorites = (): string[] => {
  try {
    return normalizeFavorites(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'));
  } catch {
    return [];
  }
};
/** Show hidden files and folders (dot names, system hidden flag); off by default, remembered per machine. */
const HIDDEN_KEY = 'kizamubeam.openShowHidden';
/** Collapsed section headings of the left column (favorites, recent, places, devices, folders). */
const COLLAPSED_KEY = 'kizamubeam.openCollapsed';
const loadJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const saveJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or private: the choice only lasts for this dialog */
  }
};

/** Internen Öffnen-Dialog mit Vorschau zeigen; Auflösen nach „Öffnen“ oder Abbruch. */
export async function openProjectWithPreview(ed: Editor): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const listDir = (path: string | null) =>
    invoke<DirListing>('project_list_dir', { path });
  const readFile = (path: string, full: boolean) =>
    invoke<{ path: string; name: string; text: string }>('project_read_file', { path, full });
  const loadRoots = () => invoke<ProjectRoot[]>('project_roots');
  const loadPlaces = () => invoke<ProjectPlace[]>('project_places');

  let navId = 0;
  let treeId = 0;
  let previewId = 0;
  let closed = false;
  let confirming = false;
  let currentDir = '';
  let currentParent: string | null = null;
  let selectedPath: string | null = null;
  let project: PreviewProject | null = null;
  let pageIndex = 0;
  let images = new Map<string, HTMLImageElement | null>();
  let fellBackHome = false;

  // Linke Spalte: Orte und Ordnerbaum
  let roots: ProjectRoot[] = [];
  let places: ProjectPlace[] = [];
  let favorites: string[] = loadFavorites();
  const expanded = new Set<string>();
  const treeKids = new Map<string, ProjectDirEntry[]>();
  let showHidden = loadJson<boolean>(HIDDEN_KEY, false) === true;
  const collapsed = new Set<string>(
    (loadJson<unknown>(COLLAPSED_KEY, []) as unknown[]).filter((k): k is string => typeof k === 'string'),
  );
  const treeLoading = new Set<string>();

  // Mittlere Spalte: Dateiliste
  let allFiles: ProjectFileEntry[] = [];
  let allDirs: ProjectDirEntry[] = [];
  let allTruncated = false;
  let searchQuery = '';
  let sortKey: FileSortKey = 'name';
  let sortDir: SortDir = 1;

  const status = h('div', { class: 'note project-open-status', role: 'status', 'aria-live': 'polite' });
  const pathInput = h('input', {
    class: 'project-open-path',
    type: 'text',
    'aria-label': t('Ordnerpfad'),
    spellcheck: 'false',
  }) as HTMLInputElement;
  const goBtn = h('button', { class: 'btn small', type: 'button' }, t('Gehe zu'));
  const upBtn = h('button', { class: 'btn small', type: 'button', title: t('Übergeordneter Ordner') }, t('Aufwärts'));
  const favBtn = h('button', {
    class: 'btn small project-open-fav',
    type: 'button',
    title: t('Zu Favoriten hinzufügen'),
    'aria-label': t('Zu Favoriten hinzufügen'),
    'aria-pressed': 'false',
  }, '☆') as HTMLButtonElement;
  const treeBox = h('div', { class: 'project-open-tree', role: 'tree', 'aria-label': t('Ordnerbaum'), tabindex: '0' });
  const searchInput = h('input', {
    class: 'project-open-search',
    type: 'search',
    'aria-label': t('Dateien suchen'),
    placeholder: t('Suchen …'),
    spellcheck: 'false',
  }) as HTMLInputElement;
  const sortSelect = h('select', {
    class: 'project-open-sort',
    'aria-label': t('Sortierung'),
  },
    h('option', { value: 'name' }, t('Name')),
    h('option', { value: 'size' }, t('Größe')),
    h('option', { value: 'modified' }, t('Datum')),
  ) as HTMLSelectElement;
  const sortDirBtn = h('button', {
    class: 'btn small',
    type: 'button',
    title: t('Sortierreihenfolge umkehren'),
    'aria-label': t('Sortierreihenfolge umkehren'),
  }, '▲');
  const filesBox = h('div', { class: 'project-open-files', role: 'listbox', 'aria-label': t('Dateien im Ordner'), tabindex: '0' });
  const fileLabel = h('div', { class: 'project-open-file' });
  const pageLabel = h('div', { class: 'project-open-page', role: 'status', 'aria-live': 'polite' });
  const prevBtn = h('button', {
    class: 'btn small project-open-pagebtn',
    type: 'button',
    title: t('Vorherige Seite'),
    'aria-label': t('Vorherige Seite'),
  }, '‹');
  const nextBtn = h('button', {
    class: 'btn small project-open-pagebtn',
    type: 'button',
    title: t('Nächste Seite'),
    'aria-label': t('Nächste Seite'),
  }, '›');
  const fileInfo = h('div', { class: 'project-open-info' });
  const hiddenBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  hiddenBox.checked = showHidden;
  const hiddenToggle = h('label', { class: 'project-open-hidden' }, hiddenBox, t('Versteckte Dateien und Ordner anzeigen'));
  const canvas = h('canvas', { class: 'project-open-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const previewBox = h('div', { class: 'project-open-preview' }, canvas);
  const previewHint = h('div', { class: 'note' }, t('Datei wählen, um die Vorschau zu sehen.'));
  previewBox.append(previewHint);
  const cancelBtn = h('button', { class: 'btn', type: 'button' }, t('Abbrechen'));
  const openBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, t('Öffnen'));

  const setStatus = (msg: string) => {
    status.textContent = msg;
  };
  const updateOpenBtn = () => {
    (openBtn as HTMLButtonElement).disabled = confirming || !selectedPath;
  };
  const updateStar = () => {
    const isFav = currentDir !== '' && favorites.includes(currentDir);
    favBtn.textContent = isFav ? '★' : '☆';
    const label = isFav ? t('Aus Favoriten entfernen') : t('Zu Favoriten hinzufügen');
    favBtn.title = label;
    favBtn.setAttribute('aria-label', label);
    favBtn.setAttribute('aria-pressed', String(isFav));
    favBtn.disabled = currentDir === '';
  };
  const saveFavorites = () => {
    try {
      if (favorites.length) localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
      else localStorage.removeItem(FAV_KEY);
    } catch {
      /* Speicher voll oder privat: Favoriten gelten nur für diese Sitzung */
    }
  };

  const updatePageControls = () => {
    const total = project?.pages.length ?? 0;
    const multi = total > 1;
    (prevBtn as HTMLButtonElement).disabled = !multi || pageIndex <= 0;
    (nextBtn as HTMLButtonElement).disabled = !multi || pageIndex >= total - 1;
    const sel = selectedPath ? allFiles.find((f) => f.path === selectedPath) : undefined;
    fileInfo.textContent = sel ? `${formatSize(sel.size)} · ${formatModified(sel.modified_ms)}` : '';
    if (!project) {
      pageLabel.textContent = '';
      fileLabel.textContent = '';
      return;
    }
    fileLabel.textContent = project.fileName;
    const name = project.pages[pageIndex]?.name ?? '';
    pageLabel.textContent =
      total > 1
        ? t('Seite {current} von {total} · {name}', { current: pageIndex + 1, total, name })
        : name;
  };

  const clearPreview = () => {
    project = null;
    images = new Map();
    pageIndex = 0;
    previewId++;
    updatePageControls();
    showPreviewPlaceholder(t('Datei wählen, um die Vorschau zu sehen.'));
  };

  const renderPreview = () => {
    if (!project || !project.pages[pageIndex]) return;
    const r = previewBox.getBoundingClientRect();
    const w = Math.max(80, r.width - 16);
    const hh = Math.max(80, r.height - 16);
    drawPreviewPage(canvas, w, hh, project.pages[pageIndex], project.layers, images, project.bed);
  };

  const showPreviewPlaceholder = (msg: string) => {
    previewHint.textContent = msg;
    previewHint.style.display = '';
    canvas.style.display = 'none';
  };
  const showPreviewCanvas = () => {
    previewHint.style.display = 'none';
    canvas.style.display = '';
  };

  const loadPreview = async (path: string, name: string) => {
    const id = ++previewId;
    project = null;
    images = new Map();
    pageIndex = 0;
    updatePageControls();
    showPreviewPlaceholder(t('Vorschau wird geladen …'));
    setStatus('');
    try {
      const { text } = await readFile(path, false);
      if (closed || id !== previewId) return;
      if (text.length > PREVIEW_LIMIT) {
        // Datei bleibt ausdrücklich öffenbar; nur die Vorschau entfällt
        showPreviewPlaceholder(t('Vorschau nicht verfügbar (Datei zu groß). „Öffnen“ lädt das Projekt trotzdem.'));
        project = null;
        updatePageControls();
        fileLabel.textContent = name;
        return;
      }
      const parsed = await parsePreviewProject(text, name, { ...ed.doc.bed }, ed.svgDpi);
      if (closed || id !== previewId) return;
      project = parsed;
      pageIndex = Math.min(Math.max(0, parsed.startPage), parsed.pages.length - 1);
      updatePageControls();
      if (!parsed.pages.length) {
        showPreviewPlaceholder(t('Leere Vorschau: Das Projekt enthält keine Seiten.'));
        return;
      }
      showPreviewCanvas();
      renderPreview();
      const checkCancel = () => closed || id !== previewId;
      const decoded = await decodePreviewImages(parsed.assets, {
        get cancelled() {
          return checkCancel();
        },
      });
      if (closed || id !== previewId) return;
      images = decoded;
      renderPreview();
    } catch (e) {
      if (closed || id !== previewId) return;
      project = null;
      updatePageControls();
      fileLabel.textContent = name;
      const msg = e instanceof Error ? e.message : String(e);
      showPreviewPlaceholder(t('Vorschau nicht verfügbar: {message}', { message: msg }));
      setStatus(t('Vorschau fehlgeschlagen — „Öffnen“ bleibt möglich.'));
    } finally {
      if (!closed && id === previewId) updateOpenBtn();
    }
  };

  const rootLabel = (r: ProjectRoot): string =>
    r.kind === 'home' ? t('Persönlicher Ordner') : r.name;

  const placeLabel = (p: ProjectPlace): string => {
    switch (p.kind) {
      case 'pictures': return t('Bilder');
      case 'documents': return t('Dokumente');
      case 'downloads': return t('Downloads');
      case 'music': return t('Musik');
      case 'videos': return t('Videos');
      default: return p.name;
    }
  };

  /** Folders on the way to the current one stay visible even when hidden */
  const keepPaths = (): Set<string> => new Set(currentDir ? ancestorsOf(currentDir) : []);
  const visibleDirs = (list: ProjectDirEntry[]): ProjectDirEntry[] => visibleEntries(list, showHidden, keepPaths());

  /** Collapsible section heading; returns whether its rows should be rendered */
  const renderHead = (key: string, label: string): boolean => {
    const open = !collapsed.has(key);
    treeBox.append(h('button', {
      class: 'project-open-tree-head',
      type: 'button',
      'aria-expanded': String(open),
      onclick: () => {
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        saveJson(COLLAPSED_KEY, [...collapsed]);
        renderTree();
      },
    }, h('span', { class: 'project-open-tree-head-twisty', 'aria-hidden': 'true' }, open ? '▾' : '▸'), label));
    return open;
  };

  const renderPlaceRow = (path: string, label: string) => {
    const row = h('div', {
      class: 'project-open-tree-row',
      role: 'treeitem',
      'aria-selected': String(path === currentDir),
      title: path,
    });
    row.append(h('span', { class: 'project-open-twisty-leaf' }, ''));
    row.append(h('button', {
      class: 'project-open-tree-label',
      type: 'button',
      onclick: () => selectTreeDir(path),
    }, label));
    treeBox.append(row);
  };

  const renderTree = () => {
    treeBox.replaceChildren();
    if (favorites.length && renderHead('fav', t('Favoriten'))) {
      for (const dir of favorites) renderPlaceRow(dir, baseName(dir));
    }
    if (recentDirs.length && renderHead('recent', t('Zuletzt verwendet'))) {
      for (const dir of recentDirs) renderPlaceRow(dir, baseName(dir));
    }
    const std = places.filter((p) => p.kind !== 'device');
    if (std.length && renderHead('places', t('Orte'))) {
      for (const p of std) renderPlaceRow(p.path, placeLabel(p));
    }
    const devs = places.filter((p) => p.kind === 'device');
    if (devs.length && renderHead('devices', t('Datenträger'))) {
      for (const p of devs) renderPlaceRow(p.path, placeLabel(p));
    }
    const renderNode = (path: string, label: string, depth: number) => {
      const all = treeKids.get(path);
      const kids = all && visibleDirs(all);
      const isOpen = expanded.has(path);
      const row = h('div', {
        class: 'project-open-tree-row',
        role: 'treeitem',
        'aria-selected': String(path === currentDir),
        'aria-expanded': kids ? String(isOpen) : 'false',
        style: `padding-left:${4 + depth * 14}px`,
        title: path,
      });
      if (kids && !kids.length) {
        row.append(h('span', { class: 'project-open-twisty project-open-twisty-leaf' }, '·'));
      } else {
        const tw = h('button', {
          class: 'project-open-twisty',
          type: 'button',
          tabindex: '-1',
          'aria-label': isOpen ? t('Ordner einklappen') : t('Ordner ausklappen'),
          onclick: (e: Event) => {
            e.stopPropagation();
            void toggleExpand(path);
          },
        }, isOpen ? '▾' : '▸');
        if (treeLoading.has(path)) tw.textContent = '…';
        row.append(tw);
      }
      row.append(h('button', {
        class: 'project-open-tree-label',
        type: 'button',
        onclick: () => selectTreeDir(path),
        ondblclick: () => selectTreeDir(path),
      }, label));
      treeBox.append(row);
      if (isOpen && kids) {
        for (const k of kids) renderNode(k.path, k.name, depth + 1);
      }
    };
    if (!roots.length) {
      treeBox.append(h('div', { class: 'note' }, t('Keine Ordner verfügbar.')));
      return;
    }
    if (!renderHead('tree', t('Ordner'))) return;
    for (const r of roots) renderNode(r.path, rootLabel(r), 0);
  };

  const loadTreeKids = async (path: string, op: number): Promise<void> => {
    if (treeKids.has(path) || treeLoading.has(path)) return;
    treeLoading.add(path);
    renderTree();
    try {
      const listing = await listDir(path);
      if (closed || op !== treeId) return;
      treeKids.set(listing.dir, listing.dirs);
    } catch {
      if (closed || op !== treeId) return;
      treeKids.set(path, []);
    } finally {
      treeLoading.delete(path);
      if (!closed && op === treeId) renderTree();
    }
  };

  /** Ahnenkette im Baum öffnen, damit der aktuelle Ordner sichtbar und markiert ist. */
  const ensureVisibleInTree = async (dir: string): Promise<void> => {
    const op = ++treeId;
    for (const anc of ancestorsOf(dir)) {
      if (closed || op !== treeId) return;
      // Nur Äste laden, die zum Baum gehören (Wurzeläste oder bereits bekannte Kinder)
      const known =
        roots.some((r) => r.path === anc) ||
        [...treeKids.values()].some((kids) => kids.some((k) => k.path === anc));
      if (!known) continue;
      await loadTreeKids(anc, op);
      if (closed || op !== treeId) return;
      expanded.add(anc);
    }
    if (!closed && op === treeId) renderTree();
  };

  const toggleExpand = async (path: string): Promise<void> => {
    if (expanded.has(path)) {
      treeId++;
      expanded.delete(path);
      renderTree();
      return;
    }
    const op = ++treeId;
    await loadTreeKids(path, op);
    if (closed || op !== treeId) return;
    expanded.add(path);
    renderTree();
  };

  const selectTreeDir = (path: string) => {
    if (path !== currentDir) void load(path);
    else void ensureVisibleInTree(path);
  };

  const visibleFiles = (): ProjectFileEntry[] =>
    sortFiles(
      filterFiles(showHidden ? allFiles : allFiles.filter((f) => !isHiddenEntry(f)), searchQuery),
      sortKey,
      sortDir,
    );
  /** Subfolders at the top of the file list, always by name; double click or Enter opens them */
  const visibleSubdirs = (): ProjectDirEntry[] =>
    filterFiles(visibleEntries(allDirs, showHidden), searchQuery)
      .slice()
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const renderFiles = () => {
    filesBox.replaceChildren();
    const shown = visibleFiles();
    const subdirs = visibleSubdirs();
    for (const d of subdirs) {
      filesBox.append(h('button', {
        class: 'project-open-file-item project-open-dir-item',
        type: 'button',
        role: 'option',
        'aria-selected': 'false',
        'data-dir': d.path,
        title: d.path,
        onclick: (e: Event) => markOption(e.currentTarget as HTMLElement),
        ondblclick: () => void load(d.path),
      },
        h('span', { class: 'project-open-dir-icon', icon: 'open', 'aria-hidden': 'true' }),
        h('span', { class: 'project-open-file-name' }, d.name),
      ));
    }
    if (!shown.length) {
      filesBox.append(h('div', { class: 'note' },
        allFiles.length ? t('Keine Treffer.') : t('Keine Projektdateien in diesem Ordner.')));
    }
    for (const f of shown) {
      const meta = `${formatSize(f.size)} · ${formatModified(f.modified_ms)}`;
      const b = h('button', {
        class: 'project-open-file-item',
        type: 'button',
        role: 'option',
        'aria-selected': String(selectedPath === f.path),
        'data-path': f.path,
        title: f.path,
        onclick: () => selectFile(f.path, f.name),
        ondblclick: () => {
          selectFile(f.path, f.name);
          void confirmOpen();
        },
      },
        h('span', { class: 'project-open-file-name' }, f.name),
        h('span', { class: 'project-open-file-meta' }, meta),
      );
      filesBox.append(b);
    }
    if (allTruncated) {
      filesBox.append(h('div', { class: 'note' }, t('Liste begrenzt — per Suche oder Pfad einschränken.')));
    }
  };

  /** Highlight one row of the file list (folder or file) */
  const markOption = (el: HTMLElement | null) => {
    for (const o of filesBox.querySelectorAll('[aria-selected="true"]')) o.setAttribute('aria-selected', 'false');
    el?.setAttribute('aria-selected', 'true');
  };

  const selectFile = (path: string, name: string) => {
    selectedPath = path;
    updateOpenBtn();
    markOption(filesBox.querySelector(`[data-path="${CSS.escape(path)}"]`));
    void loadPreview(path, name);
  };

  async function load(path: string | null): Promise<void> {
    const id = ++navId;
    setStatus(t('Ordner wird geladen …'));
    try {
      const listing = await listDir(path);
      if (closed || id !== navId) return;
      currentDir = listing.dir;
      currentParent = listing.parent;
      pathInput.value = listing.dir;
      (upBtn as HTMLButtonElement).disabled = !listing.parent;
      allFiles = listing.files;
      allDirs = listing.dirs;
      allTruncated = listing.truncated;
      // Auswahl außerhalb des Ordners verwerfen
      if (selectedPath && !allFiles.some((f) => f.path === selectedPath)) {
        selectedPath = null;
        clearPreview();
      }
      updateOpenBtn();
      updateStar();
      renderFiles();
      setStatus('');
      noteRecentDir(listing.dir);
      renderTree();
      // Baum nachziehen (blockiert die Dateiliste nicht — sie steht schon)
      treeKids.set(listing.dir, listing.dirs);
      void ensureVisibleInTree(listing.dir);
    } catch (e) {
      if (closed || id !== navId) return;
      const msg = e instanceof Error ? e.message : String(e);
      // Bevorzugter Startordner unzugänglich: einmalig in den Benutzerordner fallen
      if (!fellBackHome && path) {
        fellBackHome = true;
        setStatus(t('Ordner nicht zugänglich — Benutzerordner wird geöffnet.'));
        await load(null);
        return;
      }
      setStatus(t('Ordner konnte nicht geöffnet werden: {message}', { message: msg }));
    }
  }

  async function confirmOpen(): Promise<void> {
    if (!selectedPath || confirming) return;
    confirming = true;
    updateOpenBtn();
    setStatus(t('Projekt wird geöffnet …'));
    try {
      const res = await readFile(selectedPath, true);
      if (closed) return;
      // SVG wird nicht als Projekt geöffnet, sondern wie über Datei → Importieren eingefügt
      if (/\.svg$/i.test(selectedPath)) {
        const { importSvg } = await import('./importers');
        await ed.importVectors(importSvg(res.text, { svgDpi: ed.svgDpi }), res.name);
        noteOpenedDir(res.path);
        closed = true;
        dlg.close();
        return;
      }
      await applyProjectText(ed, res.text, res.name, res.path);
      noteOpenedDir(res.path);
      closed = true;
      dlg.close();
    } catch (e) {
      if (closed) return;
      const msg = e instanceof Error ? e.message : String(e);
      const looksGone = /no such file|not found|nicht gefunden|existiert nicht|Zugriff|permission|denied/i.test(msg);
      setStatus(
        looksGone
          ? t('Datei nicht mehr lesbar: {message}', { message: msg })
          : t('Datei konnte nicht geöffnet werden: {message}', { message: msg }),
      );
      confirming = false;
      updateOpenBtn();
    }
  }

  goBtn.addEventListener('click', () => void load(pathInput.value.trim() || null));
  pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void load(pathInput.value.trim() || null);
    }
  });
  upBtn.addEventListener('click', () => {
    if (currentParent) void load(currentParent);
  });
  favBtn.addEventListener('click', () => {
    if (!currentDir) return;
    const res = toggleFavorite(favorites, currentDir);
    favorites = res.list;
    saveFavorites();
    updateStar();
    renderTree();
  });
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderFiles();
  });
  sortSelect.addEventListener('change', () => {
    sortKey = (sortSelect.value as FileSortKey) || 'name';
    renderFiles();
  });
  sortDirBtn.addEventListener('click', () => {
    sortDir = sortDir > 0 ? -1 : 1;
    sortDirBtn.textContent = sortDir > 0 ? '▲' : '▼';
    renderFiles();
  });
  hiddenBox.addEventListener('change', () => {
    showHidden = hiddenBox.checked;
    saveJson(HIDDEN_KEY, showHidden);
    renderTree();
    renderFiles();
  });
  // File list keys: arrows move the selection (files show their preview), Enter opens the file or
  // folder, Backspace goes up one level
  const activate = (el: HTMLElement) => {
    el.focus();
    const path = el.getAttribute('data-path');
    if (path) {
      const entry = allFiles.find((f) => f.path === path);
      if (entry) selectFile(entry.path, entry.name);
    } else markOption(el);
    el.scrollIntoView({ block: 'nearest' });
  };
  filesBox.addEventListener('keydown', (e) => {
    const items = [...filesBox.querySelectorAll<HTMLElement>('[role="option"]')];
    const cur = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[role="option"]') ?? null;
    const i = cur ? items.indexOf(cur) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      if (!items.length) return;
      e.preventDefault();
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1)
        : Math.max(0, i < 0 ? 0 : i - 1);
      activate(items[next]);
      return;
    }
    if (e.key === 'Backspace' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (currentParent) void load(currentParent);
      return;
    }
    if (e.key !== 'Enter' || !cur) return;
    e.preventDefault();
    const dir = cur.getAttribute('data-dir');
    if (dir) {
      void load(dir);
      return;
    }
    const path = cur.getAttribute('data-path');
    const entry = path ? allFiles.find((f) => f.path === path) : undefined;
    if (entry) selectFile(entry.path, entry.name);
    void confirmOpen();
  });
  prevBtn.addEventListener('click', () => {
    if (pageIndex > 0) {
      pageIndex--;
      updatePageControls();
      renderPreview();
    }
  });
  nextBtn.addEventListener('click', () => {
    if (project && pageIndex < project.pages.length - 1) {
      pageIndex++;
      updatePageControls();
      renderPreview();
    }
  });
  cancelBtn.addEventListener('click', () => dlg.close());
  openBtn.addEventListener('click', () => void confirmOpen());

  const ro = new ResizeObserver(() => {
    if (project) renderPreview();
  });

  const dlg = h('dialog', { class: 'project-open-dialog', 'aria-label': t('Öffnen mit Vorschau') },
    h('h3', {}, t('Öffnen mit Vorschau')),
    h('div', { class: 'project-open-bar' }, pathInput, goBtn, upBtn, favBtn),
    h('div', { class: 'project-open-main' },
      h('div', { class: 'project-open-left' }, treeBox, hiddenToggle),
      h('div', { class: 'project-open-mid' },
        h('div', { class: 'project-open-searchrow' }, searchInput, sortSelect, sortDirBtn),
        filesBox,
      ),
      h('div', { class: 'project-open-right' },
        fileLabel,
        previewBox,
        h('div', { class: 'project-open-pages' }, prevBtn, pageLabel, nextBtn),
        fileInfo,
      ),
    ),
    status,
    h('div', { class: 'dialog-buttons' },
      h('span', { class: 'param-spacer' }),
      cancelBtn,
      openBtn,
    ),
  ) as HTMLDialogElement;
  // Dialog keys: Alt+Up goes up one level, Ctrl/Cmd+F jumps to the search field
  dlg.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentParent) void load(currentParent);
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
  showDialog(dlg, () => {
    closed = true;
    navId++;
    treeId++;
    previewId++;
    ro.disconnect();
  });
  ro.observe(previewBox);
  updatePageControls();
  (upBtn as HTMLButtonElement).disabled = true;
  updateStar();
  (prevBtn as HTMLButtonElement).disabled = true;
  (nextBtn as HTMLButtonElement).disabled = true;
  showPreviewPlaceholder(t('Datei wählen, um die Vorschau zu sehen.'));
  try {
    roots = await loadRoots();
  } catch {
    roots = [];
  }
  try {
    places = await loadPlaces();
  } catch {
    places = [];
  }
  if (closed) return;
  if (!roots.length) {
    // Ohne Baumdaten: Startordner als einziger Ast (Filter/Sortierung laufen trotzdem)
    const start = openStartDir();
    roots = [{ name: start ?? t('Ordner'), path: start ?? '', kind: 'home' }];
  }
  renderTree();
  await load(openStartDir());
}
