// Editor: Fangen an Raster, Objekten und Hilfslinien.
import { Obj, Pt } from '../model';
import { alignBox, alignPoint, buildSnapSet, findSnap, SNAP_TARGET_ORDER, SnapHit, SnapKind, SnapSet } from '../snap';
import type { Editor } from '../editor';
import { Drag } from './shared';
import { cleanGrid, GRID_KEY, GridSettings } from '../grid';
import { t } from '../i18n';

const SNAP_KEY = 'kizamubeam.snap';

/** Aktive Objektfang-Ziele je Editor (Standard: alle Arten); legacy Stände ohne Feld gelten als vollständig */
const SNAP_TARGETS_KEY = 'kizamubeam.snapTargets';
const isSnapKind = (v: unknown): v is SnapKind => typeof v === 'string' && (SNAP_TARGET_ORDER as readonly string[]).includes(v);
export const validSnapTargets = (v: unknown): v is SnapKind[] =>
  Array.isArray(v) && v.length > 0 && v.every(isSnapKind) && new Set(v).size === v.length;
export function defaultSnapTargets(): SnapKind[] {
  return [...SNAP_TARGET_ORDER];
}
/** Gespeicherte Fangziele laden (Fixtures ohne localStorage ergeben die Standards) */
export function loadSnapTargets(): SnapKind[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAP_TARGETS_KEY) ?? 'null');
    if (validSnapTargets(raw)) return [...raw];
  } catch {
    /* Standardwerte */
  }
  return defaultSnapTargets();
}

const SNAP_PX_ALT = 20;

/** Fangdistanzen in px (normal, mit Alt); frei einstellbar, Defaults wie bisher */
export interface SnapTolerance { normal: number; alt: number }
const SNAP_TOLERANCE_KEY = 'kizamubeam.snapTolerance';
const DEFAULT_SNAP_TOLERANCE: SnapTolerance = { normal: 8, alt: SNAP_PX_ALT };
const SNAP_TOL_MIN = 1, SNAP_TOL_MAX = 64;
const validSnapTol = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= SNAP_TOL_MIN && v <= SNAP_TOL_MAX;
export function loadSnapTolerance(): SnapTolerance {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAP_TOLERANCE_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        normal: validSnapTol(raw.normal) ? raw.normal : DEFAULT_SNAP_TOLERANCE.normal,
        alt: validSnapTol(raw.alt) ? raw.alt : DEFAULT_SNAP_TOLERANCE.alt,
      };
    }
  } catch {
    /* Standardwerte */
  }
  return { ...DEFAULT_SNAP_TOLERANCE };
}
/** Fangdistanzen speichern (Edit → Settings → Arbeitsfläche und Fangen); false bei ungültigen Werten */
export function saveSnapTolerance(v: SnapTolerance): boolean {
  if (!validSnapTol(v.normal) || !validSnapTol(v.alt)) return false;
  try {
    localStorage.setItem(SNAP_TOLERANCE_KEY, JSON.stringify({ normal: v.normal, alt: v.alt }));
    return true;
  } catch {
    return false;
  }
}

/** Vorheriger Fang-Zustand für den Hauptschalter (wird beim Ausschalten gemerkt) */
export const SNAP_PREV_KEY = 'kizamubeam.snapPrev';
const snapPrevByEditor = new WeakMap<Editor, { grid: boolean; objects: boolean }>();

/** Fang an/aus als Ganzes: an, sobald Raster oder Objekte fangen */
export function isSnapOn(ed: Editor): boolean {
  return ed.snapObjects || ed.snapGrid;
}
/** Fang-Hauptschalter: alles aus (vorherigen Stand merken) bzw. vorherigen Stand oder Standard wiederherstellen */
export function toggleSnapMaster(ed: Editor) {
  if (isSnapOn(ed)) {
    const prev = { grid: ed.snapGrid, objects: ed.snapObjects };
    snapPrevByEditor.set(ed, prev);
    try {
      localStorage.setItem(SNAP_PREV_KEY, JSON.stringify(prev));
    } catch {
      /* Speicher nicht verfügbar */
    }
    ed.setSnap({ grid: false, objects: false });
    return;
  }
  let prev: { grid?: unknown; objects?: unknown } | null = null;
  try {
    const raw = snapPrevByEditor.get(ed) ?? JSON.parse(localStorage.getItem(SNAP_PREV_KEY) ?? 'null');
    if (raw && typeof raw === 'object') prev = raw;
  } catch {
    /* Standardwerte */
  }
  ed.setSnap({
    grid: typeof prev?.grid === 'boolean' ? prev.grid : false,
    objects: typeof prev?.objects === 'boolean' ? prev.objects : true,
  });
}

type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean };

export class EditorSnapping {
  /** Fangdistanzen mit Rückfall auf die Standardwerte (Tests ohne Konstruktor) */
  snapTol(this: Editor): SnapTolerance {
    return this.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  }
  /** Fangdistanzen ändern und merken */
  setSnapTolerance(this: Editor, patch: { normal?: number; alt?: number }) {
    const next = { ...this.snapTolerance, ...patch };
    if (!saveSnapTolerance(next)) throw new Error(t('Einstellung konnte nicht gespeichert werden.'));
    this.snapTolerance = next;
  }
  /** Fang-Einstellungen ändern und merken */
  setSnap(this: Editor, patch: { grid?: boolean; objects?: boolean; step?: number; centers?: Editor['centerMarks']; targets?: SnapKind[] }) {
    if (patch.centers !== undefined) this.centerMarks = patch.centers;
    if (patch.grid !== undefined) this.snapGrid = patch.grid;
    if (patch.objects !== undefined) this.snapObjects = patch.objects;
    if (patch.step !== undefined && patch.step > 0) this.gridStep = patch.step;
    if (patch.targets !== undefined) {
      if (!validSnapTargets(patch.targets)) throw new Error(t('Einstellung konnte nicht gespeichert werden.'));
      this.snapTargets = [...patch.targets];
    }
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ grid: this.snapGrid, objects: this.snapObjects, step: this.gridStep, centers: this.centerMarks }));
      localStorage.setItem(SNAP_TARGETS_KEY, JSON.stringify(this.snapTargets ?? defaultSnapTargets()));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('view');
  }
  /** Hintergrundgitter ändern und merken */
  setGrid(this: Editor, patch: Partial<GridSettings>) {
    this.grid = cleanGrid({ ...this.grid, ...patch });
    try {
      localStorage.setItem(GRID_KEY, JSON.stringify(this.grid));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('view');
  }
  loadGridSettings(this: Editor) {
    try {
      const raw = localStorage.getItem(GRID_KEY);
      if (raw) this.grid = cleanGrid(JSON.parse(raw));
    } catch {
      /* Standardwerte */
    }
  }
  loadSnapSettings(this: Editor) {
    try {
      const st = JSON.parse(localStorage.getItem(SNAP_KEY) ?? '{}');
      if (typeof st.grid === 'boolean') this.snapGrid = st.grid;
      if (typeof st.objects === 'boolean') this.snapObjects = st.objects;
      if (typeof st.step === 'number' && st.step > 0) this.gridStep = st.step;
      if (st.centers === 'off' || st.centers === 'auto' || st.centers === 'all') this.centerMarks = st.centers;
    } catch {
      /* Standardwerte */
    }
    this.snapTargets = loadSnapTargets();
  }
  /** Alle Objektfang-Ziele wieder einschalten und merken */
  resetSnapTargets(this: Editor) {
    this.setSnap({ targets: defaultSnapTargets() });
  }
  /** Aktive Fangziele als Menge (Fixtures ohne Feld ergeben alle Arten) */
  snapTargetSet(this: Editor): ReadonlySet<SnapKind> {
    const cur = this.snapTargets ?? defaultSnapTargets();
    return new Set(cur.filter(isSnapKind));
  }
  clearSnap(this: Editor) {
    this.snapHit = null;
    this.alignGuides = [];
  }
  /** Fangpunkte aller sichtbaren Objekte außer skip, dazu die sichtbaren Hilfslinien (Fang an der ganzen Linie und an Kreuzungen) */
  buildSnap(this: Editor, skip: Obj[] = []): SnapSet {
    const set = buildSnapSet(this.viewObjects(), (o) => this.layer(o.layer).show, new Set(skip));
    if (this.guidesShown()) {
      const { w, h } = this.doc.bed;
      const m = Math.max(w, h) * 10;
      for (const g of this.guideList()) {
        if (g.axis === 'x') set.addPiece(g.v, -m, g.v, h + m);
        else set.addPiece(-m, g.v, w + m, g.v);
      }
    }
    return set;
  }
  /** Fangpunkte aller Objekte, zwischengespeichert bis zur nächsten Änderung */
  hoverSnapSet(this: Editor): SnapSet {
    if (!this.snapCache || this.snapCache.ver !== this.snapVer) this.snapCache = { ver: this.snapVer, set: this.buildSnap() };
    return this.snapCache.set;
  }
  /** Ctrl hält gedrückt: Fangen umkehren (Standard: aus), wie in LightBurn */
  snapModes(this: Editor, e: Mods | null, toggle: boolean) {
    const flip = !!e && toggle && (e.ctrlKey || e.metaKey);
    return { obj: this.snapObjects !== flip, grid: this.snapGrid !== flip, alt: !!e?.altKey };
  }
  gridRound(this: Editor, p: Pt): Pt {
    const g = this.gridStep;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }
  /**
   * Weltpunkt fangen: zuerst Objektfang, mit Alt Ausrichtung an Fangpunkten, sonst Raster.
   * toggle: Ctrl kehrt das Fangen um (nicht beim Aufziehen von Formen, dort heißt Ctrl „von der Mitte“).
   */
  snapPt(this: Editor, p: Pt, e: Mods | null, opt: { set?: SnapSet; extra?: Pt[]; toggle?: boolean } = {}): Pt {
    this.clearSnap();
    const md = this.snapModes(e, opt.toggle ?? true);
    if (md.obj) {
      const set = opt.set ?? this.hoverSnapSet();
      const tol = (md.alt ? this.snapTol().alt : this.snapTol().normal) / this.view.zoom;
      const hit = findSnap(set, p, tol, opt.extra, this.snapTargetSet());
      if (hit) {
        this.snapHit = hit;
        return hit.p;
      }
      if (md.alt) {
        const a = alignPoint(set, p, tol, opt.extra);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          return a.p;
        }
      }
    }
    return md.grid ? this.gridRound(p) : p;
  }
  /** Verschiebung der Auswahl fangen: Griffpunkt oder Ecken/Mitte der Auswahl an anderen Objekten, Alt richtet Kanten aus */
  snapMove(this: Editor, d: Extract<Drag, { type: 'move' }>, dx: number, dy: number, e: Mods): [number, number] {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const tol = (md.alt ? this.snapTol().alt : this.snapTol().normal) / this.view.zoom;
    if (md.obj) {
      const b = d.box;
      const own = d.anchor
        ? [d.anchor]
        : [0, 0.5, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: b.x + fx * b.w, y: b.y + fy * b.h })));
      let best: { hit: SnapHit; from: Pt; dist: number } | null = null;
      const targets = this.snapTargetSet();
      for (const pass of ['point', 'line'] as const) {
        for (const q of own) {
          const moved = { x: q.x + dx, y: q.y + dy };
          const hit = findSnap(d.snapSet, moved, tol, undefined, targets);
          if (!hit || (pass === 'point') === (hit.kind === 'line')) continue;
          const dist = Math.hypot(hit.p.x - moved.x, hit.p.y - moved.y);
          if (!best || dist < best.dist) best = { hit, from: q, dist };
        }
        if (best) break;
      }
      if (best) {
        this.snapHit = best.hit;
        return [best.hit.p.x - best.from.x, best.hit.p.y - best.from.y];
      }
      if (md.alt) {
        const a = alignBox(d.snapSet, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, tol);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          dx += a.dx;
          dy += a.dy;
          // nicht ausgerichtete Achse darf noch am Raster fangen
          if (md.grid && !a.guides.some((g) => g.axis === 'x')) dx = this.gridDelta(d, dx, 'x');
          if (md.grid && !a.guides.some((g) => g.axis === 'y')) dy = this.gridDelta(d, dy, 'y');
          return [dx, dy];
        }
      }
    }
    if (md.grid) return [this.gridDelta(d, dx, 'x'), this.gridDelta(d, dy, 'y')];
    return [dx, dy];
  }
  /** Rasterfang beim Verschieben: der Griffpunkt landet auf dem Raster, ohne Griffpunkt wird der Weg gerundet */
  gridDelta(this: Editor, d: Extract<Drag, { type: 'move' }>, v: number, axis: 'x' | 'y'): number {
    const g = this.gridStep;
    if (!d.anchor) return Math.round(v / g) * g;
    return Math.round((d.anchor[axis] + v) / g) * g - d.anchor[axis];
  }
  /** Hilfslinie fangen: an der Höhe (bzw. x-Lage) des nächsten Fangpunkts irgendwo auf der Fläche, sonst am Raster */
  snapGuide(this: Editor, d: Extract<Drag, { type: 'guide' }>, wp: Pt, e: Mods): number {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const ax = d.axis;
    if (md.obj) {
      const tol = (md.alt ? this.snapTol().alt : this.snapTol().normal) / this.view.zoom;
      const targets = this.snapTargetSet();
      let best: (typeof d.snapSet.pts)[number] | null = null;
      for (const q of d.snapSet.pts) {
        if (!targets.has(q.kind)) continue;
        if (Math.abs(q[ax] - wp[ax]) <= tol && (!best || Math.abs(q[ax] - wp[ax]) < Math.abs(best[ax] - wp[ax]))) best = q;
      }
      if (best) {
        this.snapHit = { p: { x: best.x, y: best.y }, kind: best.kind };
        return best[ax];
      }
    }
    return md.grid ? this.gridRound(wp)[ax] : wp[ax];
  }
}
