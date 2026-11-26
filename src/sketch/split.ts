import type { Pt } from '../model';
import { addArc, addCon, addLine, addPt, entOf, ptOf, type Sketch } from './model';

export type SketchSplit = { target: number; splitAt: Pt; fraction: number };

/** The fractional position is independent of the source segment's length and direction.
 * Ellipsen ausgenommen (Paket D): plan/apply lehnen per Typprüfung ab, kein Umbau. */
export function planSketchSplit(sk: Sketch, target: number, cursor?: Pt, midpointTolerance = 0): SketchSplit | undefined {
  const line = entOf(sk, target);
  if (line?.t === 'arc' && !line.aux && !line.trimSupport) {
    const c = ptOf(sk, line.c), turn = 2 * Math.PI, sweep = line.a1 - line.a0;
    if (!c || !(line.r > 1e-6 && sweep > 0 && sweep < turn)) return;
    if (cursor && Math.hypot(cursor.x - c.x, cursor.y - c.y) <= 1e-6) return;
    const a = cursor ? ((Math.atan2(cursor.y - c.y, cursor.x - c.x) - line.a0) % turn + turn) % turn : sweep / 2;
    const f = Math.abs(a - sweep / 2) * line.r <= midpointTolerance ? 0.5 : a / sweep;
    if (!(f > 0 && f < 1 && Math.min(f, 1 - f) * sweep * line.r > 1e-6)) return;
    const angle = line.a0 + f * sweep;
    return { target, splitAt: { x: c.x + line.r * Math.cos(angle), y: c.y + line.r * Math.sin(angle) }, fraction: f };
  }
  if (line?.t !== 'line' || line.aux || line.trimSupport) return;
  const a = ptOf(sk, line.a), b = ptOf(sk, line.b);
  if (!a || !b) return;
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!(length > 2e-6 && Number.isFinite(length))) return;
  const along = cursor ? (cursor.x - a.x) * (dx / length) + (cursor.y - a.y) * (dy / length) : length / 2;
  const fraction = Math.abs(along - length / 2) <= midpointTolerance ? 0.5 : along / length;
  if (!(fraction > 0 && fraction < 1)) return;
  const splitAt = { x: a.x + dx * fraction, y: a.y + dy * fraction };
  if (!Number.isFinite(splitAt.x) || !Number.isFinite(splitAt.y)) return;
  if (![a, b].every((p) => Math.hypot(splitAt.x - p.x, splitAt.y - p.y) > 1e-6)) return;
  return { target, splitAt, fraction };
}

export function applySketchSplit(sk: Sketch, target: number, cursor?: Pt, preview?: SketchSplit): void | false {
  const plan = preview ?? planSketchSplit(sk, target, cursor), line = entOf(sk, target);
  if (!plan || !line || (line.t !== 'line' && line.t !== 'arc') || line.aux) return false;
  const id = addPt(sk, plan.splitAt.x, plan.splitAt.y).id;
  if (line.t === 'arc') {
    const joint = line.a0 + plan.fraction * (line.a1 - line.a0);
    for (const [s, e, a0, a1] of [[line.s, id, line.a0, joint], [id, line.e, joint, line.a1]]) {
      const child = addArc(sk, line.c, s, e);
      if (child.t === 'arc') Object.assign(child, { a0, a1 });
      addCon(sk, 'arcSpan', [child.id, line.id, id], { v: plan.fraction });
    }
    line.aux = true;
    line.trimSupport = true;
    return;
  }
  if (Math.abs(plan.fraction - 0.5) < 1e-12) addCon(sk, 'midpoint', [id, line.id]);
  else addCon(sk, 'segmentFraction', [id, line.id], { v: plan.fraction });
  addLine(sk, line.a, id);
  addLine(sk, id, line.b);
  line.aux = true;
  line.trimSupport = true;
}
