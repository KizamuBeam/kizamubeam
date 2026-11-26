// Editor: Hilfslinien aus dem Lineal. Sie sind keine Objekte, sondern eine eigene Ebene „Hilfslinien“:
// nie gelasert oder exportiert, ausblendbar und sperrbar, Objekte fangen an ihnen.
import { Guide } from '../model';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Abstand in Bildschirmpixeln, ab dem eine Hilfslinie gegriffen wird */
const GRAB_PX = 4;

export class EditorGuides {
  /**
   * Wirksame Hilfslinien: im Skizzenmodus die der Skizze (Weltkoordinaten, mit ihr
   * gespeichert, außerhalb unsichtbar), sonst die des Dokuments (alle Seiten).
   */
  guideList(this: Editor): Guide[] {
    const s = this.sketchEdit;
    if (s) return s.sk.guides ?? [];
    return this.doc.guides ?? [];
  }
  guidesShown(this: Editor): boolean {
    const s = this.sketchEdit;
    if (s) return !s.guideHidden;
    return !this.doc.guidesHidden;
  }
  guidesLocked(this: Editor): boolean {
    const s = this.sketchEdit;
    if (s) return !!s.guideLocked;
    return !!this.doc.guidesLocked;
  }
  /** Bildschirmlage einer Hilfslinie (x bei senkrechten, y bei waagrechten) */
  guideScreen(this: Editor, g: Guide): number {
    return g.axis === 'x' ? this.toScreen({ x: g.v, y: 0 }).x : this.toScreen({ x: 0, y: g.v }).y;
  }
  /** Hilfslinie unter dem Mauszeiger, die sich verschieben lässt (sichtbar, nicht gesperrt), sonst -1 */
  guideAt(this: Editor, sx: number, sy: number): number {
    const s = this.sketchEdit;
    if (s ? (s.guideHidden || s.guideLocked) : (this.doc.guidesHidden || this.doc.guidesLocked)) return -1;
    if (sx < RULER || sy < RULER) return -1;
    const list = this.guideList();
    let best = -1,
      bd = GRAB_PX;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = Math.abs(this.guideScreen(list[i]) - (list[i].axis === 'x' ? sx : sy));
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  /** Neue Hilfslinie anhängen (vorher snapshot) und ihren Index liefern; eine ausgeblendete Ebene wird wieder sichtbar */
  pushGuide(this: Editor, g: Guide): number {
    if (this.sketchEdit) {
      const list = (this.sketchEdit.sk.guides ??= []);
      list.push(g);
      delete this.sketchEdit.guideHidden;
      if (this.sketchEdit) this.writeSketch();
      return list.length - 1;
    }
    const list = (this.doc.guides ??= []);
    list.push(g);
    delete this.doc.guidesHidden;
    return list.length - 1;
  }
  removeGuide(this: Editor, i: number) {
    const s = this.sketchEdit;
    const list = this.guideList();
    if (!list[i]) return;
    list.splice(i, 1);
    if (!list.length) {
      if (s) delete s.sk.guides;
      else delete this.doc.guides;
    }
    // Hervorhebung zeigt sonst auf eine andere Linie
    this.guideHover = this.guidePin = null;
    if (this.sketchEdit) this.writeSketch();
  }
  /** Laufende Verschiebung direkt übernehmen (Aufrufer snapshotet + emitted); Skizze schreibt nach */
  setGuideLive(this: Editor, i: number, v: number) {
    const list = this.guideList();
    const g = list[i];
    if (!g || !isFinite(v)) return;
    list[i] = { axis: g.axis, v };
    if (this.sketchEdit) this.writeSketch();
  }
  /** Hilfslinie i auf Weltkoordinate v (mm) setzen; ein Undo-Schritt, keine Änderung bei gleichem/ungültigem Wert */
  setGuidePos(this: Editor, i: number, v: number) {
    const list = this.guideList();
    const g = list[i];
    if (!g || !isFinite(v) || g.v === v) return;
    this.snapshot(t('Hilfslinie'));
    list[i] = { axis: g.axis, v };
    if (this.sketchEdit) this.writeSketch();
    this.emit('doc');
  }
  /** Ebene „Hilfslinien“ ein-/ausblenden oder sperren (Skizze: nur für die Sitzung) */
  setGuideLayer(this: Editor, patch: { hidden?: boolean; locked?: boolean }) {
    const s = this.sketchEdit;
    this.snapshot(t('Hilfslinien'));
    if (patch.hidden !== undefined) {
      if (s) {
        if (patch.hidden) s.guideHidden = true;
        else delete s.guideHidden;
      } else if (patch.hidden) this.doc.guidesHidden = true;
      else delete this.doc.guidesHidden;
    }
    if (patch.locked !== undefined) {
      if (s) {
        if (patch.locked) s.guideLocked = true;
        else delete s.guideLocked;
      } else if (patch.locked) this.doc.guidesLocked = true;
      else delete this.doc.guidesLocked;
    }
    this.emit('doc');
  }
  /** Alle Hilfslinien löschen */
  clearGuides(this: Editor) {
    if (!this.guideList().length) return;
    this.snapshot(t('Hilfslinien löschen'));
    if (this.sketchEdit) delete this.sketchEdit.sk.guides;
    else delete this.doc.guides;
    this.guideHover = this.guidePin = null;
    if (this.sketchEdit) this.writeSketch();
    this.emit('doc');
  }
  /** S6-Follow-up: flüchtige Hervorhebung aus dem Objekte-Panel (Hover); kein Undo, keine Sicherung */
  setGuideHover(this: Editor, i: number | null) {
    const v = i !== null && this.guideList()[i] ? i : null;
    if ((this.guideHover ?? null) === v) return;
    this.guideHover = v;
    this.redraw();
  }
  /** S6-Follow-up: Hervorhebung per Klick anpinnen/lösen; kein Undo, keine Sicherung */
  toggleGuidePin(this: Editor, i: number) {
    if (!this.guideList()[i]) return;
    this.guidePin = this.guidePin === i ? null : i;
    this.redraw();
  }
  /** Wirksame Hervorhebung (Hover schlägt Pin), als gültiger Index, sonst -1 */
  guideHi(this: Editor): number {
    const i = this.guideHover ?? this.guidePin ?? -1;
    return this.guideList()[i] ? i : -1;
  }
  /** Hilfslinien über die ganze Arbeitsfläche zeichnen (Bildschirmkoordinaten) */
  renderGuides(this: Editor, ctx: CanvasRenderingContext2D) {
    const list = this.guideList();
    if (!list.length || !this.guidesShown()) return;
    const d = this.drag;
    const active = d?.type === 'guide' ? d.idx : null;
    ctx.save();
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1;
    ctx.globalAlpha = this.guidesLocked() ? 0.6 : 0.9;
    ctx.setLineDash([6, 4]);
    const line = (g: Guide) => {
      const s = Math.round(this.guideScreen(g)) + 0.5;
      if (g.axis === 'x') {
        ctx.moveTo(s, RULER);
        ctx.lineTo(s, this.h);
      } else {
        ctx.moveTo(RULER, s);
        ctx.lineTo(this.w, s);
      }
    };
    ctx.beginPath();
    list.forEach((g, i) => i !== active && line(g));
    ctx.stroke();
    // S6-Follow-up: aus dem Panel hervorgehobene Linie leicht betonen (kräftiger, gleiche Strichelung)
    const hi = this.guideHi();
    if (hi >= 0 && hi !== active) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      line(list[hi]);
      ctx.stroke();
    }
    if (active !== null && list[active]) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      line(list[active]);
      ctx.stroke();
    }
    ctx.restore();
  }
}
