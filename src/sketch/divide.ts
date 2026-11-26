// Paket C: Kurve in N gleiche Teile (Punkte auf Bogenlängen-Anteilen k/N, Kurve unverändert).
// Neue Punkte sind Punkt-Elemente ohne aux; die Bindung läuft über vorhandene ConTypes:
// Linie → pointOnLine, Kreis/Bogen → pointOnCircle (der Löser bildet Letzteres am Bogen
// auf point_on_arc ab, siehe conPrims in solver.ts — kein Solver-Umbau nötig).
import type { Pt } from '../model';
import { addCon, addPoint, addPt, arcSweep, entOf, ptOf, type Sketch, type SkEnt } from './model';

/** Gültige Teilungsanzahl: mindestens ein innerer Punkt, höchstens 64 (sicheres Limit). */
export const MIN_SKETCH_DIVIDE = 2;
export const MAX_SKETCH_DIVIDE = 64;

export interface SketchDividePlan {
  target: number;
  n: number;
  points: Pt[];
}

/** Genau eine ausgewählte teilbare Kurve (Linie/Bogen/Kreis, aux egal), sonst undefined.
 * Ellipsen ausgenommen (Paket D): Typprüfung lehnt ab, kein Umbau. */
export function divideSelection(sk: Sketch, sel: ReadonlySet<number>): SkEnt | undefined {
  if (sel.size !== 1) return undefined;
  const id = [...sel][0];
  const e = entOf(sk, id);
  return e && (e.t === 'line' || e.t === 'arc' || e.t === 'circle') ? e : undefined;
}

const finitePt = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Anteile k/N auf der Kurve (offen: N-1 Punkte, Kreis geschlossen ab +X-Achse: N Punkte). */
export function planSketchDivide(sk: Sketch, target: number, n: number): SketchDividePlan | undefined {
  if (!Number.isInteger(n) || n < MIN_SKETCH_DIVIDE || n > MAX_SKETCH_DIVIDE) return undefined;
  const ent = entOf(sk, target);
  if (!ent || (ent.t !== 'line' && ent.t !== 'arc' && ent.t !== 'circle')) return undefined;
  if (ent.t === 'circle') {
    const c = ptOf(sk, ent.c);
    if (!c || !(ent.r > 1e-6) || !Number.isFinite(ent.r)) return undefined;
    const points = Array.from({ length: n }, (_, k) => {
      const a = (2 * Math.PI * k) / n;
      return { x: c.x + ent.r * Math.cos(a), y: c.y + ent.r * Math.sin(a) };
    });
    return points.every(finitePt) ? { target, n, points } : undefined;
  }
  if (ent.t === 'arc') {
    const c = ptOf(sk, ent.c);
    const sweep = arcSweep(ent);
    if (!c || !(ent.r > 1e-6) || !(sweep > 1e-9) || !Number.isFinite(ent.r)) return undefined;
    const points = Array.from({ length: n - 1 }, (_, i) => {
      const a = ent.a0 + (sweep * (i + 1)) / n;
      return { x: c.x + ent.r * Math.cos(a), y: c.y + ent.r * Math.sin(a) };
    });
    return points.every(finitePt) ? { target, n, points } : undefined;
  }
  const a = ptOf(sk, ent.a), b = ptOf(sk, ent.b);
  if (!a || !b) return undefined;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!(Math.hypot(dx, dy) > 1e-6)) return undefined;
  const points = Array.from({ length: n - 1 }, (_, i) => {
    const f = (i + 1) / n;
    return { x: a.x + dx * f, y: a.y + dy * f };
  });
  return points.every(finitePt) ? { target, n, points } : undefined;
}

/** Punkte als Punkt-Elemente (aux=false) plus Punkt-auf-Kurve-Bindung; die Kurve bleibt unverändert. */
export function applySketchDivide(sk: Sketch, target: number, n: number, preview?: SketchDividePlan): void | false {
  const plan = preview && preview.target === target && preview.n === n ? preview : planSketchDivide(sk, target, n);
  const ent = plan && entOf(sk, plan.target);
  if (!plan || !ent || (ent.t !== 'line' && ent.t !== 'arc' && ent.t !== 'circle')) return false;
  for (const p of plan.points) {
    const pid = addPt(sk, p.x, p.y).id;
    addPoint(sk, pid);
    addCon(sk, ent.t === 'line' ? 'pointOnLine' : 'pointOnCircle', [pid, ent.id]);
  }
}
