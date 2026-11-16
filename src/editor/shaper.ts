// Shaper-Werkzeug: eine Freihand-Geste wirkt je nach Treffer als Bool-Operation,
// als Form-Erkennung oder fällt auf den Bleistift-Pfad zurück.
// Reihenfolge: mehrere getroffene Formen → vereinen; eine getroffene Form mit
// Grenzübertritt → abziehen (Kapsel entlang der Geste); sonst Erkennung (wenn an),
// sonst Bleistift-Fallback über fitPoints. Je Geste genau ein Undo-Schritt.
import type { Editor } from '../editor';
import { homeLayer, IDENT, leaves, Mat, mul, newId, Obj, Pt, rotate, Shape, translate } from '../model';
import { booleanOp, closedCount, offsetOp, region } from '../ops';
import { SCALE } from '../clip';
import { pointInPoly } from '../polyTopology';
import { recognize, type ShaperMatch } from '../shaper';
import { t } from '../i18n';
import { vectorError } from '../vectorMessages';

/** Welt-Polygone der geschlossenen Fläche eines Objekts (µm-Pfade → mm-Punkte). */
function worldPolys(o: Obj): Pt[][] {
  return region(o).map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
}

function inPolys(p: Pt, polys: Pt[][]): boolean {
  return polys.some((poly) => poly.length > 2 && pointInPoly(p, poly));
}

function orient(a: Pt, b: Pt, c: Pt): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0;
}

/** Echte Segment-Kreuzung (Berühren an Endpunkten zählt nicht: konservativ, kein versehentliches Bool). */
function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4), o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2);
  return o1 !== o2 && o3 !== o4;
}

/** Berührt die Geste die Fläche (Punkt innen oder Kante gekreuzt)? */
function touches(polys: Pt[][], points: Pt[]): boolean {
  for (const p of points) if (inPolys(p, polys)) return true;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    for (const poly of polys) {
      if (poly.length < 2) continue;
      for (let j = 0; j < poly.length; j++) {
        if (segCross(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
      }
    }
  }
  return false;
}

/** Wie oft wechselt die Geste zwischen innen und außen? ≥1 = Grenzübertritt. */
function crossings(polys: Pt[][], points: Pt[]): number {
  let n = 0, inside = inPolys(points[0], polys);
  for (let i = 1; i < points.length; i++) {
    const now = inPolys(points[i], polys);
    if (now !== inside) { n++; inside = now; }
  }
  return n;
}

/** Erkannte Grundform als Form + Welt-Matrix (rect eckbasiert, Rest zentriert). */
function shaperShape(m: ShaperMatch): { shape: Shape; mat: Mat } {
  switch (m.kind) {
    case 'rect':
    case 'roundrect':
      return {
        shape: { kind: 'rect', w: m.w, h: m.h, r: m.kind === 'roundrect' ? m.r : 0 },
        mat: mul(translate(m.cx, m.cy), mul(rotate(m.angle), translate(-m.w / 2, -m.h / 2))),
      };
    case 'ellipse':
      return {
        shape: { kind: 'ellipse', rx: m.rx, ry: m.ry },
        mat: mul(translate(m.cx, m.cy), rotate(m.angle)),
      };
    case 'polygon':
      return {
        shape: { kind: 'polygon', sides: m.sides, r: m.r, star: false, inner: 0.5 },
        mat: mul(translate(m.cx, m.cy), rotate(m.rotation)),
      };
    case 'line':
      return { shape: { kind: 'path', subs: [{ nodes: [{ ...m.a }, { ...m.b }], closed: false }] }, mat: [...IDENT] };
  }
}

function shaperName(m: ShaperMatch): string {
  switch (m.kind) {
    case 'line': return t('Linie');
    case 'rect': return t('Rechteck');
    case 'roundrect': return t('abgerundetes Rechteck');
    case 'ellipse': return t('Ellipse');
    case 'polygon': return t('Polygon mit {n} Seiten', { n: m.sides });
  }
}

export class EditorShaper {
  /** Getroffene geschlossene Formen (Top-Level, auswählbar, ohne Text): Treffer per Punkt-innen oder Kantenkreuzung. */
  shaperHits(this: Editor, points: Pt[]): { obj: Obj; polys: Pt[][] }[] {
    const out: { obj: Obj; polys: Pt[][] }[] = [];
    for (const o of this.doc.objs) {
      if (!this.selectable(o)) continue;
      if (closedCount(o) === 0) continue;
      let text = false;
      for (const [leaf] of leaves([o])) if (leaf.shape.kind === 'text') { text = true; break; }
      if (text) continue;
      const polys = worldPolys(o);
      if (polys.length && touches(polys, points)) out.push({ obj: o, polys });
    }
    return out;
  }

  /** Mehrere getroffene Formen zu einer Kontur verschmelzen. */
  async shaperUnion(this: Editor, inputs: Obj[]) {
    const keep = this.boolKeep;
    if (!keep && !(await this.guardGen(inputs, t('Shaper: Vereinen')))) return;
    const subs = booleanOp('union', inputs, []);
    if (!subs.length) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Shaper: Vereinen'));
    const z = inputs.map((o) => this.doc.objs.indexOf(o));
    let idx = keep ? Math.max(...z) + 1 : Math.min(...z);
    if (!keep) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    const res: Obj = { id: newId(), m: [...IDENT], layer: homeLayer(inputs[0]), shape: { kind: 'path', subs } };
    idx = Math.min(idx, this.doc.objs.length);
    this.doc.objs.splice(idx, 0, res);
    this.setSel([res]);
    this.hint = keep ? t('Originale behalten, Ergebnis liegt davor.') : '';
    this.emit('doc');
    this.emit('tool');
  }

  /** Kapsel entlang der Geste von der Zielfläche abziehen. */
  async shaperSubtract(this: Editor, target: Obj, points: Pt[]) {
    const radius = Math.max(this.shaperTolerance, 0.5);
    const cutterSubs = offsetOp([{
      id: newId(), m: [...IDENT], layer: target.layer,
      shape: { kind: 'path', subs: [{ nodes: points.map((p) => ({ ...p })), closed: false }] },
    }], { distance: radius, direction: 'outward', join: 'round' });
    if (!cutterSubs.length) {
      this.hint = t('Shaper: Aus der Geste lässt sich kein Abzug formen.');
      this.emit('tool');
      return;
    }
    const cutter: Obj = { id: newId(), m: [...IDENT], layer: target.layer, shape: { kind: 'path', subs: cutterSubs } };
    const keep = this.boolKeep;
    if (!keep && !(await this.guardGen([target], t('Shaper: Abziehen')))) return;
    const subs = booleanOp('subtract', [target, cutter], []);
    if (!subs.length) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Shaper: Abziehen'));
    const at = this.doc.objs.indexOf(target);
    const idx = keep ? at + 1 : Math.max(0, at);
    if (!keep) this.doc.objs = this.doc.objs.filter((o) => o !== target);
    const res: Obj = { id: newId(), m: [...IDENT], layer: homeLayer(target), shape: { kind: 'path', subs } };
    this.doc.objs.splice(Math.min(idx, this.doc.objs.length), 0, res);
    this.setSel([res]);
    this.hint = keep ? t('Originale behalten, Ergebnis liegt davor.') : '';
    this.emit('doc');
    this.emit('tool');
  }

  /** Erkannte Grundform als neues Objekt auf dem aktuellen Layer anlegen. */
  shaperCreate(this: Editor, m: ShaperMatch) {
    if (this.layer(this.currentLayer).locked || !this.layer(this.currentLayer).show)
      throw new Error(t('Eine sichtbare, entsperrte Ebene wählen.'));
    const { shape, mat } = shaperShape(m);
    this.snapshot(t('Shaper: Form erkennen'));
    const obj: Obj = { id: newId(), m: [...mat], layer: this.currentLayer, shape };
    this.doc.objs.push(obj);
    this.setSel([obj]);
    this.hint = t('Shaper: {name} erkannt.', { name: shaperName(m) });
    this.emit('doc');
    this.emit('tool');
  }

  /** Geste auswerten: Vereinen, Abziehen, Erkennen oder Bleistift-Fallback. */
  async finishShaper(this: Editor, points: Pt[]) {
    try {
      if (points.length < 2 || points.every((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) < 0.01)) {
        this.hint = t('Kein Freihandpfad erstellt: zum Zeichnen ziehen, nicht nur klicken.');
        this.emit('tool');
        return;
      }
      const hits = this.shaperHits(points);
      if (hits.length >= 2) {
        await this.shaperUnion(hits.map((h) => h.obj));
        return;
      }
      if (hits.length === 1 && crossings(hits[0].polys, points) >= 1) {
        await this.shaperSubtract(hits[0].obj, points);
        return;
      }
      if (this.shaperRecognize) {
        const m = recognize(points);
        if (m && m.kind !== 'line') {
          this.shaperCreate(m);
          return;
        }
      }
      this.finishPencil(points, false);
    } catch (error) {
      this.hint = vectorError(error);
      this.emit('tool');
    }
  }
}
