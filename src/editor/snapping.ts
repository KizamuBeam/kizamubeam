// Editor: Fangen an Raster, Objekten und Hilfslinien.
import { Obj, Pt } from '../model';
import { alignBox, alignPoint, AlignGuide, buildSnapSet, EXT_REACH_MULT, findSnap, guideIntersections, PROJ_CORRIDOR_MULT, SNAP_TARGET_ORDER, SnapHit, SnapKind, SnapSet, snapToAllExtensions, snapToAllPolar, trackDwellNext, trackPoint } from '../snap';
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

/** Hover-Dwell in ms, bis ein Fangpunkt als Tracking-Referenz gemerkt wird */
export const TRACK_DWELL_MS = 500;
/** Max. gemerkte Tracking-Punkte; darüber fällt der älteste raus */
const TRACK_MAX = 7;

/** Fangdistanzen in px (normal, mit Alt); frei einstellbar, Defaults wie bisher */
export interface SnapTolerance { normal: number; alt: number }
const SNAP_TOLERANCE_KEY = 'kizamubeam.snapTolerance';
const DEFAULT_SNAP_TOLERANCE: SnapTolerance = { normal: 8, alt: SNAP_PX_ALT };
const SNAP_TOL_MIN = 1, SNAP_TOL_MAX = 64;
const validSnapTol = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= SNAP_TOL_MIN && v <= SNAP_TOL_MAX;
/**
 * Bester Schnittpunkt der Projektions-Kandidaten für den Cursor: paarweise Schnitte aller
 * seg-Guides, nur über Kandidaten-Grenzen hinweg (Führungen desselben Kandidaten — etwa beide
 * Achsen einer Fangspur — kreuzen sich im eigenen Treffer und zählen nicht). Der Schnitt muss
 * in exakter Punkttoleranz tol liegen; Gleichstand: näherer, dann kleinerer Guide-Index
 * (guideIntersections liefert nach (i, j) sortiert). Liefert beide kreuzenden Führungen.
 * Modullokal (kein this), damit schlanke Test-Harnische ohne neue Methode auskommen.
 */
function projIntersectionWinners(
  cands: { p: Pt; guides: AlignGuide[]; kind: 'track' | 'angle' | 'ext'; d: number }[],
  p: Pt,
  tol: number,
): { p: Pt; guides: AlignGuide[] } | null {
  const guides = cands.flatMap((c) => c.guides);
  const src = cands.flatMap((c, s) => c.guides.map(() => s));
  let win: { p: Pt; guides: AlignGuide[]; d: number } | null = null;
  for (const x of guideIntersections(guides, 0)) {
    if (src[x.i] === src[x.j]) continue;
    const d = Math.hypot(x.p.x - p.x, x.p.y - p.y);
    if (d > tol || (win && d >= win.d - 1e-9)) continue;
    win = { p: x.p, guides: [guides[x.i], guides[x.j]], d };
  }
  return win && { p: win.p, guides: win.guides };
}
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
  /** Gemerkte Spur + Dwell + Timer verwerfen (Esc, Werkzeugwechsel, Schließen) */
  clearTrack(this: Editor) {
    this.trackPts = [];
    this.trackDwell = null;
    this.clearTrackTimer();
  }
  clearTrackTimer(this: Editor) {
    if (this.trackTimer != null) clearTimeout(this.trackTimer);
    this.trackTimer = null;
  }
  /** Stillhalte-Timer: feuert, auch wenn die Maus sich nicht mehr bewegt (sonst käme kein Dwell zustande) */
  armTrackTimer(this: Editor) {
    if (this.trackTimer != null || !this.trackDwell) return;
    const wait = Math.max(0, TRACK_DWELL_MS - (Date.now() - this.trackDwell.since));
    const t = setTimeout(() => this.fireTrackDwell(), wait);
    (t as unknown as { unref?: () => void }).unref?.();
    this.trackTimer = t;
  }
  /** Timer-Ablauf (oder Test mit Zeit): Dwell mit aktueller Zeit fortsetzen */
  fireTrackDwell(this: Editor, now = Date.now()) {
    this.trackTimer = null;
    const dw = this.trackDwell;
    if (!dw) return;
    const next = trackDwellNext(dw, dw.p, now);
    this.trackDwell = next.next;
    if (next.acquire) this.addTrackPt(next.acquire, 1e-6);
    else if (this.trackDwell) this.armTrackTimer();
  }
  /** Hover-Dwell für einen exakten Treffer fortschreiben (Weltkoord.); acquire → merken. now: Zeitbasis, Standard Date.now(). */
  trackDwellOnHit(this: Editor, p: Pt, tolWorld: number, now = Date.now()) {
    const dw = trackDwellNext(this.trackDwell, p, now, TRACK_DWELL_MS, tolWorld * 0.25);
    this.trackDwell = dw.next;
    if (dw.acquire) {
      this.addTrackPt(dw.acquire, tolWorld);
      this.clearTrackTimer();
    } else if (this.trackDwell) this.armTrackTimer();
    else this.clearTrackTimer();
  }
  /** Gemerkten Tracking-Punkt übernehmen: entdoppelt (tol), max. TRACK_MAX — ältester fällt raus */
  addTrackPt(this: Editor, q: Pt, tol: number) {
    const arr = this.trackPts ?? (this.trackPts = []);
    if (arr.some((a) => Math.hypot(a.x - q.x, a.y - q.y) <= tol)) return;
    arr.push({ x: q.x, y: q.y });
    while (arr.length > TRACK_MAX) arr.shift();
  }
  /** Fangpunkte aller sichtbaren Objekte außer skip, dazu die sichtbaren Hilfslinien (Fang an der ganzen Linie und an Kreuzungen) */
  buildSnap(this: Editor, skip: Obj[] = []): SnapSet {
    const set = buildSnapSet(this.viewObjects(), (o) => this.layer(o.layer).show, new Set(skip));
    if (this.guidesShown()) {
      const { w, h } = this.doc.bed;
      const m = Math.max(w, h) * 10;
      for (const g of this.guideList()) {
        if (g.axis === 'x') set.addPiece(g.v, -m, g.v, h + m, false);
        else set.addPiece(-m, g.v, w + m, g.v, false);
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
   * Weltpunkt fangen: zuerst exakter Objektfang (dabei Hover-Dwell für Tracking), mit Alt
   * Ausrichtung an Fangpunkten, sonst Fangspur/Polar/Verlängerung, dann Raster.
   * toggle: Ctrl kehrt das Fangen um (nicht beim Aufziehen von Formen, dort heißt Ctrl „von der Mitte“).
   * track: explizite Fangspur-Referenzen (z. B. bereits gesetzte Punkte); extensions: Fang auf
   * Verlängerungslinien gerader Stücke. Gemerkte Punkte (trackPts) gelten immer als Referenzen.
   * Rangfolge: exakt > Schnittpunkt zweier Projektionen > Spur ≈ Polar ≈ Verlängerung
   * (nächster gewinnt, stabil: Spur, Polar, Verlängerung). Ein Schnittpunkt braucht den Cursor
   * in exakter Punkttoleranz tol; Gleichstand zweier Schnitte: näherer, dann kleinerer
   * Guide-Index (guideIntersections liefert nach (i, j) sortiert). Paare aus demselben
   * Kandidaten (z. B. beide Achsen einer Fangspur) kreuzen sich im eigenen Treffer und zählen nicht.
   * Verlängerungen fangen seitlich bis PROJ_CORRIDOR_MULT × tol, längs bleibt
   * EXT_REACH_MULT × tol. now: Zeitbasis für Dwell (Tests), Standard Date.now().
   */
  snapPt(this: Editor, p: Pt, e: Mods | null, opt: { set?: SnapSet; extra?: Pt[]; toggle?: boolean; track?: Pt[]; extensions?: boolean; now?: number } = {}): Pt {
    this.clearSnap();
    const md = this.snapModes(e, opt.toggle ?? true);
    if (md.obj) {
      const set = opt.set ?? this.hoverSnapSet();
      const tol = (md.alt ? this.snapTol().alt : this.snapTol().normal) / this.view.zoom;
      const hit = findSnap(set, p, tol, opt.extra, this.snapTargetSet());
      if (hit) {
        this.snapHit = hit;
        this.trackDwellOnHit(hit.p, tol, opt.now);
        return hit.p;
      }
      this.trackDwell = null;
      this.clearTrackTimer();
      if (md.alt) {
        const a = alignPoint(set, p, tol, opt.extra);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          return a.p;
        }
      } else {
        const cands: { p: Pt; guides: AlignGuide[]; kind: 'track' | 'angle' | 'ext'; d: number }[] = [];
        if (opt.track?.length || (this.trackPts?.length ?? 0)) {
          const refs = [...(this.trackPts ?? []), ...(opt.track ?? [])];
          const t = trackPoint(refs, p, tol);
          if (t) cands.push({ p: t.p, guides: t.guides, kind: 'track', d: Math.hypot(t.p.x - p.x, t.p.y - p.y) });
          for (const pol of snapToAllPolar(refs, p, tol))
            cands.push({ p: pol.p, guides: [pol.guide], kind: 'angle', d: pol.d });
        }
        if (opt.extensions) {
          // Seitlich verbreiterter Korridor, längs unverändert: maxExt aus der Basis-tol.
          // Vorsortiert nach (Abstand, Verlängerung), damit der Gesamt-Sieger dem bisherigen entspricht.
          const allX = snapToAllExtensions(set, p, PROJ_CORRIDOR_MULT * tol, EXT_REACH_MULT * tol)
            .sort((a, b) => (Math.abs(a.d - b.d) > 1e-9 ? a.d - b.d : a.ext - b.ext));
          for (const x of allX) cands.push({ p: x.p, guides: [x.guide], kind: 'ext', d: x.d });
        }
        const cross = projIntersectionWinners(cands, p, tol);
        if (cross) {
          this.alignGuides = cross.guides;
          this.snapHit = { p: cross.p, kind: 'intersection' };
          return cross.p;
        }
        if (cands.length) {
          cands.sort((a, b) => Math.abs(a.d - b.d) > 1e-9 ? a.d - b.d : 0); // stabil: Gleichstand behält Spur vor Polar vor Verlängerung
          const w = cands[0];
          this.alignGuides = w.guides;
          this.snapHit = { p: w.p, kind: w.kind };
          return w.p;
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
