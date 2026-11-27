// Interaktives Kanten-Werkzeug: zwei Kanten wählen, Runden/Innenrunden/Fasen mit Live-Vorschau,
// als Kantensätze speichern (einzeln löschbar und änderbar), ohne das Werkzeug neu zu öffnen.
import { apply, CornerMode, CornerSet, inv, leaves, Mat, normalizeRect, Obj, Pt, rectCorners, RectShape, SubPath, visibleLeaves } from '../model';
import { shapeSubs } from '../geom';
import { transformSubs } from '../importers';
import { EdgePick, isStraight, samePick } from '../joints';
import { cornerSub, revertCornerSet, sharedVertex, virtualVertex } from '../corners';
import { piecesOf } from '../pathtools';
import { dec, t } from '../i18n';
import type { Editor } from '../editor';
import { TOOL_HINTS } from './shared';

export type FilletTarget =
  | { kind: 'vertex'; obj: Obj; m: Mat; sub: number; idx: number }
  | { kind: 'rect'; obj: Obj; m: Mat; corner: 0 | 1 | 2 | 3; scale: number }
  | { kind: 'virtual'; obj: Obj; m: Mat; sub: number; x: Pt };

/** Eindeutige Satz-ID (eigener Raum, unabhängig vom Objekt-Zähler) */
let filletSeq = 0;
const filletId = () => `fs${Date.now().toString(36)}${(filletSeq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const modeLabel = (mode: CornerMode, r: number) =>
  mode === 'round'
    ? t('Runden {r} mm', { r: dec(String(r)) })
    : mode === 'inverse'
      ? t('Innen runden {r} mm', { r: dec(String(r)) })
      : t('Fasen {r} mm', { r: dec(String(r)) });

const snapshotLabel = (mode: CornerMode) =>
  mode === 'round' ? t('Ecken runden') : mode === 'inverse' ? t('Ecken innen runden') : t('Ecken fasen');

/** Rechteckseite über den Kantenmittelpunkt (lokal): oben, rechts, unten, links */
function rectSide(shape: { w: number; h: number }, mx: number, my: number): 'T' | 'R' | 'B' | 'L' | null {
  const d: ['T' | 'R' | 'B' | 'L', number][] = [
    ['T', Math.abs(my)], ['B', Math.abs(my - shape.h)], ['L', Math.abs(mx)], ['R', Math.abs(mx - shape.w)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][1] > Math.min(shape.w, shape.h) / 2 + 1e-6 ? null : d[0][0];
}

/** Zwei gerade Kanten eines Rechtecks → Ecke (TL=0, TR=1, BR=2, BL=3) */
function rectCornerFromSegs(shape: RectShape, segA: number, segB: number): 0 | 1 | 2 | 3 | null {
  const all = shapeSubs(shape);
  if (!all[0]) return null;
  const ps = piecesOf(all[0]);
  const pa = ps[segA], pb = ps[segB];
  if (!pa || !pb || pa.curve || pb.curve) return null;
  const sa = rectSide(shape, (pa.a.x + pa.b.x) / 2, (pa.a.y + pa.b.y) / 2);
  const sb = rectSide(shape, (pb.a.x + pb.b.x) / 2, (pb.a.y + pb.b.y) / 2);
  if (!sa || !sb || sa === sb) return null;
  const key = [sa, sb].sort().join('');
  if (key === 'LT') return 0;
  if (key === 'RT') return 1;
  if (key === 'BR') return 2;
  if (key === 'BL') return 3;
  return null;
}

export class EditorFillet {
  /** Nächste gerade Kante unter dem Mauszeiger (nur Vektorformen, sichtbare Layer) */
  updateFilletHover(this: Editor, sx: number, sy: number) {
    const prev = this.filletHover;
    let best = 7;
    this.filletHover = null;
    for (const [leaf, m] of visibleLeaves(this.doc.objs)) {
      const k = leaf.shape.kind;
      if (k === 'text' || k === 'image' || k === 'barcode' || k === 'gen' || !this.layer(leaf.layer).show) continue;
      shapeSubs(leaf.shape).forEach((sp, si) =>
        piecesOf(sp).forEach((sg, gi) => {
          if (sg.curve) return;
          const a = this.toScreen(apply(m, sg.a.x, sg.a.y));
          const b = this.toScreen(apply(m, sg.b.x, sg.b.y));
          const dx = b.x - a.x, dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          if (l2 < 1) return;
          const tt = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
          const d = Math.hypot(a.x + dx * tt - sx, a.y + dy * tt - sy);
          if (d < best) {
            best = d;
            this.filletHover = { obj: leaf, m, sub: si, seg: gi };
          }
        }),
      );
    }
    this.canvas.style.cursor = this.filletHover ? 'pointer' : 'crosshair';
    const h = this.filletHover as EdgePick | null;
    if (!h !== !prev || (h && prev && !samePick(h, prev))) this.redraw();
  }

  /** Gewählte Kanten, die es im Dokument noch gibt */
  validFilletPicks(this: Editor): EdgePick[] {
    const alive = new Set([...leaves(this.doc.objs)].map(([o]) => o));
    return this.filletPicks.filter((p) => alive.has(p.obj) && isStraight(p.obj, p.sub, p.seg));
  }

  clearFilletPicks(this: Editor) {
    this.filletPicks = [];
    this.filletOffer = null;
    this.filletEditId = null;
    this.filletPreview = null;
    this.filletTarget = null;
    this.hint = this.tool === 'fillet' ? TOOL_HINTS.fillet : this.hint;
    this.emit('tool');
    this.redraw();
  }

  /** Klick im Kanten-Werkzeug: Kante umschalten, Paar auswerten */
  filletClick(this: Editor) {
    const h = this.filletHover;
    if (!h) return;
    const i = this.filletPicks.findIndex((p) => samePick(p, h));
    if (i >= 0) this.filletPicks.splice(i, 1);
    else this.filletPicks = [...this.filletPicks.slice(-1), h];
    this.filletOffer = null;
    this.filletTarget = null;
    if (this.filletPicks.length === 2) this.analyzeFilletPair();
    this.refreshFilletPreview();
    this.hint = this.filletPicks.length === 1 ? t('Kanten: jetzt die zweite Kante anklicken. Esc hebt die Wahl auf.') : TOOL_HINTS.fillet;
    this.emit('tool');
    this.redraw();
  }

  /** Zwei gewählte Kanten → Ziel (Eckpunkt, Rechteck-Ecke oder Verlängerungs-Angebot) */
  analyzeFilletPair(this: Editor) {
    const picks = this.validFilletPicks();
    if (picks.length < 2) return;
    const [a, b] = picks;
    const dropSecond = (msg: string) => {
      this.filletPicks = [a];
      this.hint = msg;
    };
    if (a.obj !== b.obj) return dropSecond(t('Kanten: beide Kanten müssen zum selben Objekt gehören.'));
    const subs = shapeSubs(a.obj.shape);
    if (a.sub !== b.sub || !subs[a.sub]) return dropSecond(t('Kanten: beide Kanten müssen zur selben Kontur gehören.'));
    // Ändern: Picks müssen die Nachbarn des Satz-Bogens sein (oder dessen Rechteck-Ecke)
    if (this.filletEditId !== null) {
      const old = this.findFilletSet(this.filletEditId);
      if (old && this.editPicksMatch(old.obj, old.set, a, b)) {
        const set = old.set;
        this.filletTarget = set.rectCorner !== undefined
          ? { kind: 'rect', obj: a.obj, m: a.m, corner: set.rectCorner, scale: uniformScale(a.m) }
          : set.extended
            ? { kind: 'virtual', obj: a.obj, m: a.m, sub: set.sub, x: { ...set.vertex } }
            : { kind: 'vertex', obj: a.obj, m: a.m, sub: set.sub, idx: -1 };
        return;
      }
      this.filletPicks = [a];
      this.hint = t('Kanten: die gewählten Kanten gehören nicht zum Satz — Nachbarkanten des Satzes wählen.');
      return;
    }
    const sp = subs[a.sub];
    if (a.obj.shape.kind === 'rect') {
      const corner = rectCornerFromSegs(a.obj.shape, a.seg, b.seg);
      if (corner === null) return dropSecond(t('Kanten: zwei benachbarte Rechteckkanten wählen.'));
      this.filletTarget = { kind: 'rect', obj: a.obj, m: a.m, corner, scale: uniformScale(a.m) };
      return;
    }
    if (a.obj.shape.kind !== 'path') return dropSecond(t('Kanten: nur Pfade und Rechtecke.'));
    const idx = sharedVertex(sp, a.seg, b.seg);
    if (idx !== null) {
      this.filletTarget = { kind: 'vertex', obj: a.obj, m: a.m, sub: a.sub, idx };
      return;
    }
    // Angebot: offene Kontur, beide Endstücke → Enden bis zum Schnittpunkt verlängern und schließen.
    // Nur wenn X jenseits beider Enden liegt (echtes Verlängern, kein Zurückschneiden).
    const m = piecesOf(sp).length;
    const ends = !sp.closed && ((a.seg === 0 && b.seg === m - 1) || (a.seg === m - 1 && b.seg === 0));
    if (ends) {
      const ps = piecesOf(sp);
      const pFirst = ps[0], pLast = ps[m - 1];
      if (pFirst && pLast) {
        const v = virtualVertex(pFirst, pLast);
        const l1 = v ? Math.hypot(pFirst.b.x - pFirst.a.x, pFirst.b.y - pFirst.a.y) : 0;
        const l2 = v ? Math.hypot(pLast.b.x - pLast.a.x, pLast.b.y - pLast.a.y) : 0;
        const far =
          !v || v.t1 >= -1e-9 || v.t2 <= 1 + 1e-9 ||
          -v.t1 * l1 > Math.max(50, 5 * l1) || (v.t2 - 1) * l2 > Math.max(50, 5 * l2);
        if (!v || far) return dropSecond(t('Kanten: Enden laufen nicht aufeinander zu (oder Schnittpunkt zu fern).'));
        this.filletOffer = { obj: a.obj, m: a.m, sub: a.sub, segA: 0, segB: m - 1, x: v.x };
        this.hint = t('Kanten: Enden treffen sich nicht — bis zum Schnittpunkt verlängern und schließen?');
        return;
      }
    }
    return dropSecond(t('Kanten: kein gemeinsamer Eckpunkt. Nur benachbarte Kanten — oder die beiden Enden einer offenen Kontur.'));
  }

  /** Prüfen, ob die Picks die Nachbarn eines Satz-Bogens sind (für Ändern) */
  private editPicksMatch(this: Editor, obj: Obj, set: CornerSet, a: EdgePick, b: EdgePick): boolean {
    if (a.obj !== obj || a.sub !== set.sub) return false;
    const s = obj.shape;
    if (set.rectCorner !== undefined) {
      if (s.kind !== 'rect') return false;
      return rectCornerFromSegs(s, a.seg, b.seg) === set.rectCorner;
    }
    if (s.kind !== 'path' || !s.subs[set.sub]) return false;
    const ps = piecesOf(s.subs[set.sub]);
    const k = ps.findIndex((q) => nearPt(q.a, set.p1) && nearPt(q.b, set.p2));
    if (k < 0) return false;
    const n = ps.length;
    const prev = ((k - 1) + n) % n, next = (k + 1) % n;
    const segs = new Set([a.seg, b.seg]);
    return segs.size === 2 && segs.has(prev) && segs.has(next);
  }

  /** Angebot annehmen: Enden verlängern/schließen steht fest, Vorschau zeigen */
  acceptFilletOffer(this: Editor) {
    const o = this.filletOffer;
    if (!o) return;
    this.filletTarget = { kind: 'virtual', obj: o.obj, m: o.m, sub: o.sub, x: o.x };
    this.filletOffer = null;
    this.refreshFilletPreview();
    this.emit('tool');
    this.redraw();
  }

  /** Angebot ablehnen: zweite Kante verwerfen */
  declineFilletOffer(this: Editor) {
    if (!this.filletOffer) return;
    this.filletPicks = this.filletPicks.slice(0, 1);
    this.filletOffer = null;
    this.filletTarget = null;
    this.filletPreview = null;
    this.hint = TOOL_HINTS.fillet;
    this.emit('tool');
    this.redraw();
  }

  /** Vorschau aus Ziel, Modus und Wert neu berechnen (Welt, ohne das Dokument zu ändern) */
  refreshFilletPreview(this: Editor) {
    this.filletPreview = null;
    if (this.filletOffer && !this.filletTarget) {
      const o = this.filletOffer;
      const sp = shapeSubs(o.obj.shape)[o.sub];
      if (sp) {
        const ps = piecesOf(sp);
        const pa = ps[o.segA], pb = ps[o.segB];
        if (pa && pb) {
          const nearA = Math.hypot(pa.a.x - o.x.x, pa.a.y - o.x.y) <= Math.hypot(pa.b.x - o.x.x, pa.b.y - o.x.y) ? pa.a : pa.b;
          const nearB = Math.hypot(pb.a.x - o.x.x, pb.a.y - o.x.y) <= Math.hypot(pb.b.x - o.x.x, pb.b.y - o.x.y) ? pb.a : pb.b;
          this.filletPreview = transformSubs([{ closed: false, nodes: [{ ...nearA }, { ...o.x }, { ...nearB }] }], o.m);
        }
      }
      this.emit('tool');
      return;
    }
    const tgt = this.filletTarget;
    if (!tgt || !(this.filletR > 0)) {
      this.emit('tool');
      return;
    }
    const mode = this.filletMode, r = this.filletR;
    if (tgt.kind === 'rect') {
      const s = tgt.obj.shape;
      if (s.kind !== 'rect') return;
      if (mode === 'round' && tgt.scale > 0) {
        const corners = rectCorners(s).slice() as [number, number, number, number];
        corners[tgt.corner] = r / tgt.scale;
        this.filletPreview = transformSubs(shapeSubs({ ...s, corners }), tgt.m);
      } else {
        // Fase/Innenrundung oder verzerrte Matrix: Vorschau auf spitzer Kopie (wie beim Anwenden)
        const cp = rectCornerPoint(s, tgt.corner);
        const zero = rectCorners(s).slice() as [number, number, number, number];
        zero[tgt.corner] = 0;
        const world = transformSubs(shapeSubs({ ...s, corners: zero }), tgt.m);
        const wcp = apply(tgt.m, cp.x, cp.y);
        const vIdx = world[0].nodes.findIndex((n) => Math.hypot(n.x - wcp.x, n.y - wcp.y) <= 1e-6);
        if (vIdx < 0) return;
        const res = cornerSub(world[0], [vIdx], mode, r);
        if (!res.done) return;
        world[0] = res.sub;
        this.filletPreview = world;
      }
    } else if (tgt.kind === 'vertex') {
      const subs = shapeSubs(tgt.obj.shape);
      if (!subs[tgt.sub]) return;
      // Ändern: Vorschau auf zurückgebauter Kopie (der Bogen liegt noch im Dokument)
      let work = subs[tgt.sub];
      let idx = tgt.idx;
      if (idx < 0) {
        const found = this.filletEditId !== null ? this.findFilletSet(this.filletEditId) : null;
        if (!found) return;
        const copy: SubPath = { closed: work.closed, nodes: work.nodes.map((n) => ({ ...n })) };
        if (work.start) copy.start = true;
        const back = revertCornerSet(copy, found.set);
        if (!back) return;
        idx = back.nodes.findIndex((nd) => nearPt(nd, found.set.vertex));
        if (idx < 0) return;
        work = back;
      }
      const world = transformSubs(subs, tgt.m);
      const res = cornerSub(transformSubs([work], tgt.m)[0], [idx], mode, r);
      if (!res.done) return;
      world[tgt.sub] = res.sub;
      this.filletPreview = world;
    } else {
      const subs = shapeSubs(tgt.obj.shape);
      const world = transformSubs(subs, tgt.m);
      const closed = closeEndsAt(world[tgt.sub], apply(tgt.m, tgt.x.x, tgt.x.y));
      if (!closed) return;
      const res = cornerSub(closed, [0], mode, r);
      if (!res.done) return;
      this.filletPreview = [res.sub];
    }
    this.emit('tool');
  }

  /** Anwenden: ein Undo-Schritt, Satz speichern, weiter ohne das Werkzeug neu zu öffnen */
  confirmFillet(this: Editor): boolean {
    let tgt = this.filletTarget;
    if (!tgt) {
      this.hint = this.filletPicks.length < 2 ? t('Kanten: erst zwei Kanten wählen.') : TOOL_HINTS.fillet;
      this.emit('tool');
      return false;
    }
    const mode = this.filletMode, r = this.filletR;
    if (!(r > 0)) {
      this.hint = t('Kanten: Wert muss größer als 0 sein.');
      this.emit('tool');
      return false;
    }
    const label = snapshotLabel(mode);
    // Änderung eines Satzes: alten zurückbauen, dann neu anwenden (ein Undo-Schritt)
    const editId = this.filletEditId;
    let old: { obj: Obj; set: CornerSet } | null = null;
    if (editId !== null) {
      old = this.findFilletSet(editId);
      if (!old) {
        this.hint = t('Kanten: Satz wurde verändert oder gelöscht.');
        this.emit('tool');
        return false;
      }
    }
    this.snapshot(editId !== null ? t('Kantensatz ändern') : label);
    if (old && !this.removeFilletSetGeometry(old.obj, old.set)) {
      this.dropSnapshot();
      this.hint = t('Kanten: Satz lässt sich nicht zurückbauen (Nachbar verändert).');
      this.emit('tool');
      return false;
    }
    if (old && tgt.kind === 'vertex' && tgt.idx < 0) {
      // Vertex erst nach dem Rückbau wiederfinden
      const s = old.obj.shape;
      const found = s.kind === 'path' && s.subs[old.set.sub]
        ? s.subs[old.set.sub].nodes.findIndex((nd) => nearPt(nd, old.set.vertex))
        : -1;
      if (found < 0) {
        this.dropSnapshot();
        this.hint = t('Kanten: Satz lässt sich nicht zurückbauen (Nachbar verändert).');
        this.emit('tool');
        return false;
      }
      tgt = { ...tgt, idx: found };
    }
    const applied = tgt.kind === 'rect' && mode === 'round' && tgt.scale > 0
      ? this.applyFilletRect(tgt.obj, tgt.corner, r / tgt.scale, r)
      : this.applyFilletPath(tgt, mode, r);
    if (!applied) {
      this.dropSnapshot();
      this.hint = t('Kanten: Kanten zu kurz für diesen Wert.');
      this.emit('tool');
      return false;
    }
    const set = applied.set;
    if (old) this.detachFilletSet(old.obj, old.set.id);
    if (this.filletDestructive) {
      // Destruktiv: Geometrie bleibt, kein (alter oder neuer) Satz wird gespeichert
    } else {
      // Ersetzen: alten Satz entfernen, neuen mit dessen ID weiterführen
      if (old) set.id = old.set.id;
      this.attachFilletSet(tgt.obj, set);
    }
    this.touch(tgt.obj.shape);
    this.filletPicks = [];
    this.filletTarget = null;
    this.filletOffer = null;
    this.filletPreview = null;
    this.filletEditId = null;
    this.filletListObj = tgt.obj;
    this.hint = `${modeLabel(mode, r)}${applied.limited ? ` ${t('(kleiner, Kanten zu kurz)')}` : ''} — ${t('nächstes Kantenpaar wählen.')}`;
    this.emit('doc');
    this.emit('tool');
    this.redraw();
    return true;
  }

  /** Pfad-Anwendung in Welt-mm (wie cornerSel), Satz-Geometrie lokal speichern */
  private applyFilletPath(
    this: Editor, tgt: FilletTarget, mode: CornerMode, r: number,
  ): { set: CornerSet; limited: boolean } | null {
    const obj = tgt.obj, m = tgt.m;
    let sub = 0;
    let idx: number;
    const extended = tgt.kind === 'virtual';
    let vertex: Pt;
    if (tgt.kind === 'rect') {
      // Ohne Rundungs-Vorteil (Fase/Innenrundung, verzerrte Matrix): Ecke spitz zurücksetzen,
      // in Pfad umwandeln (wie der Ecken-Dialog) und normal anwenden
      const s = obj.shape;
      if (s.kind !== 'rect') return null;
      const cp = rectCornerPoint(s, tgt.corner);
      const corners = rectCorners(s).slice() as [number, number, number, number];
      corners[tgt.corner] = 0;
      s.corners = corners;
      this.convertObjToPath(obj);
      const conv = obj.shape.kind === 'path' ? obj.shape.subs[0] : null;
      if (!conv) return null;
      const found = conv.nodes.findIndex((nd) => Math.hypot(nd.x - cp.x, nd.y - cp.y) <= 1e-6);
      if (found < 0) return null;
      idx = found;
      vertex = { ...cp };
    } else if (tgt.kind === 'virtual') {
      sub = tgt.sub;
      idx = 0;
      vertex = { ...tgt.x };
    } else {
      sub = tgt.sub;
      idx = tgt.idx;
      vertex = { x: 0, y: 0 };
    }
    const shape = obj.shape;
    if (shape.kind !== 'path' || !shape.subs[sub]) return null;
    const local = shape.subs[sub];
    let work: SubPath;
    if (tgt.kind === 'virtual') {
      // Enden bis X verlängern und schließen (X wird Knoten 0, Rest bleibt)
      if (local.closed || local.nodes.length < 2) return null;
      work = { closed: true, nodes: [{ ...tgt.x }, ...local.nodes.map((n) => ({ ...n }))] };
      if (local.start) work.start = true;
    } else {
      work = { closed: local.closed, nodes: local.nodes.map((n) => ({ ...n })) };
      vertex = { ...work.nodes[idx] };
    }
    const world = transformSubs([work], m)[0];
    const ps = piecesOf(work);
    const n = work.nodes.length;
    const ki = work.closed ? (idx - 1 + n) % n : idx - 1;
    const ko = work.closed ? idx % n : idx;
    if (ki < 0 || ko < 0 || ki >= ps.length || ko >= ps.length) return null;
    const pin = ps[ki], pout = ps[ko];
    const res = cornerSub(world, [idx], mode, r);
    if (!res.done) return null;
    const ends = res.ends.get(idx);
    if (!ends) return null;
    const invm = inv(m);
    const toLocal = (p: Pt) => apply(invm, p.x, p.y);
    const seg = (p: { a: Pt; c1: Pt; c2: Pt; b: Pt; curve: boolean }): CornerSet['origIn'] => ({
      a: { ...p.a }, c1: { ...p.c1 }, c2: { ...p.c2 }, b: { ...p.b }, curve: p.curve,
    });
    shape.subs[sub] = transformSubs([res.sub], invm)[0];
    const set: CornerSet = {
      id: filletId(), mode, r, obj: obj.id, sub,
      p1: toLocal(ends.p1), p2: toLocal(ends.p2),
      origIn: seg(pin), origOut: seg(pout),
      vertex,
    };
    if (extended) set.extended = true;
    return { set, limited: res.limited > 0 };
  }

  /** Rechteck rund (parametrisch, ohne Pfad-Umbau): Welt-r in lokalen Wert umrechnen */
  private applyFilletRect(
    this: Editor, obj: Obj, corner: 0 | 1 | 2 | 3, localR: number, worldR: number,
  ): { set: CornerSet; limited: boolean } | null {
    const s = obj.shape;
    if (s.kind !== 'rect') return null;
    const prev = rectCorners(s)[corner];
    const corners = rectCorners(s).slice() as [number, number, number, number];
    corners[corner] = localR;
    s.corners = corners;
    normalizeRect(s);
    const lr = rectCorners(s)[corner];
    const set: CornerSet = {
      id: filletId(), mode: 'round', r: worldR, obj: obj.id, sub: 0,
      p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 },
      origIn: { a: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, b: { x: 0, y: 0 }, curve: false },
      origOut: { a: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 0, y: 0 }, b: { x: 0, y: 0 }, curve: false },
      vertex: { x: 0, y: 0 }, rectCorner: corner, prev, lr,
    };
    return { set, limited: lr < localR - 1e-9 };
  }

  /** Satz an der Form anhängen */
  private attachFilletSet(this: Editor, obj: Obj, set: CornerSet) {
    const s = obj.shape;
    if (s.kind !== 'path' && s.kind !== 'rect') return;
    s.cornerSets = [...(s.cornerSets ?? []), set];
  }

  /** Satz-Geometrie zurückbauen (ohne Listenpflege, ohne Snapshot) */
  private removeFilletSetGeometry(this: Editor, obj: Obj, set: CornerSet): boolean {
    const s = obj.shape;
    if (set.rectCorner !== undefined) {
      if (s.kind !== 'rect' || set.prev === undefined || set.lr === undefined) return false;
      // Nur zurückbauen, wenn der aktuelle Wert noch der des Satzes ist (sonst neueren Satz derselben Ecke zuerst löschen)
      const cur = rectCorners(s)[set.rectCorner];
      if (Math.abs(cur - set.lr) > 1e-6) return false;
      const corners = rectCorners(s).slice() as [number, number, number, number];
      corners[set.rectCorner] = set.prev;
      s.corners = corners;
      normalizeRect(s);
      return true;
    }
    if (s.kind !== 'path' || !s.subs[set.sub]) return false;
    const back = revertCornerSet(s.subs[set.sub], set);
    if (!back) return false;
    let sub: SubPath = back;
    if (set.extended) {
      // Wieder öffnen: X entfernen, ab Nachfolger weiter
      const j = sub.nodes.findIndex((nd) => nearPt(nd, set.vertex));
      if (j < 0) return false;
      const rest = [...sub.nodes.slice(j + 1), ...sub.nodes.slice(0, j)];
      if (!rest.length) return false;
      sub = { closed: false, nodes: rest.map((nd) => ({ ...nd })) };
      if (back.start) sub.start = true;
    }
    s.subs[set.sub] = sub;
    return true;
  }

  /** Satz-Record aus der Form lösen (Listenpflege) */
  private detachFilletSet(this: Editor, obj: Obj, id: string) {
    const s = obj.shape;
    if (s.kind !== 'path' && s.kind !== 'rect') return;
    const kept = (s.cornerSets ?? []).filter((c) => c.id !== id);
    if (kept.length) s.cornerSets = kept;
    else delete s.cornerSets;
  }

  /** Satz suchen (über Blätter) */
  private findFilletSet(this: Editor, id: string): { obj: Obj; set: CornerSet } | null {
    for (const [leaf] of leaves(this.doc.objs)) {
      const s = leaf.shape;
      const arr = (s.kind === 'path' || s.kind === 'rect') ? s.cornerSets : undefined;
      const set = arr?.find((c) => c.id === id);
      if (set) return { obj: leaf, set };
    }
    return null;
  }

  /** Satz löschen (Geometrie + Record, ein Undo-Schritt) */
  deleteFilletSet(this: Editor, id: string): boolean {
    const found = this.findFilletSet(id);
    if (!found) {
      this.hint = t('Kanten: Satz nicht gefunden.');
      this.emit('tool');
      return false;
    }
    this.snapshot(t('Kantensatz löschen'));
    if (!this.removeFilletSetGeometry(found.obj, found.set)) {
      this.dropSnapshot();
      this.hint = t('Kanten: Satz lässt sich nicht löschen — erst überlappende neuere Sätze löschen.');
      this.emit('tool');
      return false;
    }
    this.detachFilletSet(found.obj, id);
    if (this.filletEditId === id) this.filletEditId = null;
    this.touch(found.obj.shape);
    this.hint = t('Kanten: Satz gelöscht.');
    this.emit('doc');
    this.emit('tool');
    this.redraw();
    return true;
  }

  /** Ziel aus Satz-Daten rekonstruieren (für Ändern und Re-Bake nach Verformung).
   * idx -1 heißt: Eckpunkt erst nach dem Rückbau suchen (confirmFillet löst auf) —
   * in der verrundeten Geometrie ist er nicht mehr vorhanden. Nur echt Unmögliches gibt null. */
  private filletTargetFromSet(this: Editor, obj: Obj, m: Mat, set: CornerSet): FilletTarget | null {
    if (set.rectCorner !== undefined) {
      if (obj.shape.kind !== 'rect') return null;
      return { kind: 'rect', obj, m, corner: set.rectCorner, scale: uniformScale(m) };
    }
    if (set.extended) return { kind: 'virtual', obj, m, sub: set.sub, x: { ...set.vertex } };
    const s = obj.shape;
    if (s.kind !== 'path' || !s.subs[set.sub]) return null;
    const idx = s.subs[set.sub].nodes.findIndex((nd) => nearPt(nd, set.vertex));
    return { kind: 'vertex', obj, m, sub: set.sub, idx };
  }

  /**
   * Kantensätze nach einer Matrix-Verformung neu einbrennen, damit Bögen in Welt-mm
   * kreisförmig bleiben (Radius absolut, wie bei Rechtecken). Nur die blatteigene Matrix
   * zählt — Verformung über Gruppen bleibt sichtbar. Kein Snapshot, kein Emit: der
   * Aufrufer (Skalier-Drag, Größenfeld) steht bereits im Undo-Schritt. Bei Fehlschlag
   * bleibt die Geometrie unverändert und es kommt false zurück.
   */
  rebakeFilletSets(this: Editor, obj: Obj): boolean {
    const sets = this.filletSetsOf(obj);
    if (!sets.length || uniformScale(obj.m) !== 0) return true;
    const bakShape = structuredClone(obj.shape);
    for (let i = sets.length - 1; i >= 0; i--) {
      if (!this.removeFilletSetGeometry(obj, sets[i])) { obj.shape = bakShape; return false; }
    }
    // Parametrische Rechteck-Ecken würden unter Verzerrung elliptisch → einmalig in Pfad wandeln
    const sharpWH = obj.shape.kind === 'rect' ? { w: obj.shape.w, h: obj.shape.h } : null;
    if (sharpWH) this.convertObjToPath(obj);
    const s = obj.shape;
    if (s.kind !== 'path') { obj.shape = bakShape; return false; }
    let m: Mat | null = null;
    for (const [leaf, lm] of leaves(this.doc.objs)) {
      if (leaf === obj) { m = lm; break; }
    }
    if (!m) { obj.shape = bakShape; return false; }
    const fresh: CornerSet[] = [];
    for (const old of sets) {
      let tgt = this.filletTargetFromSet(obj, m, old);
      const rc = old.rectCorner;
      if (!tgt && rc !== undefined && sharpWH) {
        // Rechteck-Ecke nach der Pfad-Wandlung: scharfer Eckpunkt liegt an gleicher Stelle
        const sub = s.subs[0];
        const idx = sub?.nodes.findIndex((nd) => nearPt(nd, rectCornerPoint(sharpWH, rc))) ?? -1;
        if (sub && idx >= 0) tgt = { kind: 'vertex', obj, m, sub: 0, idx };
      }
      if (!tgt) { obj.shape = bakShape; return false; }
      const applied = this.applyFilletPath(tgt, old.mode, old.r);
      if (!applied) { obj.shape = bakShape; return false; }
      applied.set.id = old.id;
      fresh.push(applied.set);
    }
    if (fresh.length) s.cornerSets = fresh;
    else delete s.cornerSets;
    this.touch(s);
    return true;
  }

  /** Satz zum Ändern laden: Ziel aus den Satz-Daten wiederherstellen, Enter ersetzt direkt */
  beginEditFilletSet(this: Editor, id: string): boolean {
    const found = this.findFilletSet(id);
    if (!found) return false;
    let m: Mat | null = null;
    for (const [leaf, lm] of leaves(this.doc.objs)) {
      if (leaf === found.obj) {
        m = lm;
        break;
      }
    }
    if (!m) return false;
    this.filletMode = found.set.mode;
    this.filletR = found.set.r;
    this.filletEditId = id;
    this.filletListObj = found.obj;
    this.filletPicks = [];
    this.filletOffer = null;
    const set = found.set;
    const tgt = this.filletTargetFromSet(found.obj, m, set);
    this.filletTarget = tgt;
    if (!tgt) {
      // Eckpunkt nicht mehr auffindbar (Geometrie seither verändert): Kantenpaar neu wählen
      this.filletEditId = null;
      this.hint = t('Kanten: Satz-Geometrie verändert — Kantenpaar erneut wählen.');
    } else {
      this.hint = t('Kanten: Satz wird geändert — Wert/Modus anpassen, Enter ersetzt den Satz. Kantenpaar neu wählen möglich.');
    }
    this.refreshFilletPreview();
    this.emit('tool');
    this.redraw();
    return true;
  }

  /** Satz einbrennen: Geometrie bleibt, der änderbare Satz wird aufgelöst */
  bakeFilletSet(this: Editor, id: string): boolean {
    const found = this.findFilletSet(id);
    if (!found) {
      this.hint = t('Kanten: Satz nicht gefunden.');
      this.emit('tool');
      return false;
    }
    this.snapshot(t('Kantensatz einbrennen'));
    this.detachFilletSet(found.obj, id);
    if (this.filletEditId === id) this.filletEditId = null;
    this.touch(found.obj.shape);
    this.hint = t('Kanten: Satz eingebrannt — Geometrie bleibt, ist aber nicht mehr änderbar.');
    this.emit('doc');
    this.emit('tool');
    this.redraw();
    return true;
  }

  /** Alle Sätze eines Objekts ohne eigenen Undo-Schritt auflösen (Geometrie bleibt); true wenn Sätze bestanden */
  bakeFilletSetsOf(this: Editor, obj: Obj): boolean {
    const sets = this.filletSetsOf(obj);
    if (!sets.length) return false;
    for (const s of sets) {
      this.detachFilletSet(obj, s.id);
      if (this.filletEditId === s.id) this.filletEditId = null;
    }
    this.touch(obj.shape);
    return true;
  }

  /** Sätze eines Objekts (für das Panel) */
  filletSetsOf(this: Editor, obj: Obj): CornerSet[] {
    const s = obj.shape;
    return (s.kind === 'path' || s.kind === 'rect') ? [...(s.cornerSets ?? [])] : [];
  }

  /** Alle Sätze im Dokument mit Objekt */
  allFilletSets(this: Editor): { obj: Obj; set: CornerSet }[] {
    const out: { obj: Obj; set: CornerSet }[] = [];
    for (const [leaf] of leaves(this.doc.objs)) {
      for (const set of this.filletSetsOf(leaf)) out.push({ obj: leaf, set });
    }
    return out;
  }
}

/** Rechteck-Eckpunkt in lokalen Koordinaten (TL=0, TR=1, BR=2, BL=3) */
function rectCornerPoint(shape: { w: number; h: number }, corner: 0 | 1 | 2 | 3): Pt {
  return [{ x: 0, y: 0 }, { x: shape.w, y: 0 }, { x: shape.w, y: shape.h }, { x: 0, y: shape.h }][corner];
}

/** Einheitliche Skalierung einer achsparallelen/uniformen Matrix (0 = nicht uniform/verzerrt) */
function uniformScale(m: Mat): number {
  const s0 = Math.hypot(m[0], m[1]), s1 = Math.hypot(m[2], m[3]);
  if (!(s0 > 1e-12) || Math.abs(s0 - s1) > 1e-9 * Math.max(1, s0)) return 0;
  if (Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-9 * s0 * s1) return 0;
  return s0;
}

/** Offene Kontur an beiden Enden bis X verlängern und schließen (X wird Knoten 0, Rest bleibt) */
function closeEndsAt(sp: SubPath, x: Pt): SubPath | null {
  if (sp.closed || sp.nodes.length < 2) return null;
  return { closed: true, nodes: [{ x: x.x, y: x.y }, ...sp.nodes.map((n) => ({ ...n }))], ...(sp.start ? { start: true } : {}) };
}

function nearPt(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
}
