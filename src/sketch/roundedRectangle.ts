import type { Pt } from '../model';
import { addCenteredRectangle, addCon, cloneSketch, type Sketch, type SketchPickedPoint } from './model';
import { applySketchCorner, planSketchCorner } from './corner';

export function roundedRectangleSize(center: Pt, corner: Pt, edge?: Pt) {
  const x = Math.abs(corner.x - center.x), y = Math.abs(corner.y - center.y);
  const radius = edge ? Math.min(x - Math.abs(edge.x - center.x), y - Math.abs(edge.y - center.y)) : 0;
  return { width: 2 * x, height: 2 * y, radius };
}

export function addRoundedSketchRectangle(sk: Sketch, center: SketchPickedPoint, width: number, height: number, radius: number, centerId?: number | null): void | false {
  if (!(radius > 1e-6 && radius < Math.min(width, height) / 2 - 1e-6)) return false;
  const trial = cloneSketch(sk), start = trial.ents.length;
  if (addCenteredRectangle(trial, center, width, height, centerId) === false) return false;
  const corners = trial.ents.slice(start).flatMap((e) => e.t === 'line' && !e.aux ? [e.a] : []);
  let master: number | undefined;
  for (const p of corners) {
    const side = trial.ents.slice(start).find((e) => e.t === 'line' && !e.aux && (e.a === p || e.b === p));
    if (side?.t !== 'line') return false;
    const plan = planSketchCorner(trial, side.id, side.a === p ? 'a' : 'b', radius, true);
    const firstNew = trial.ents.length;
    if (!plan || applySketchCorner(trial, plan) === false) return false;
    const connector = trial.ents.slice(firstNew).find((e) => e.t === 'arc');
    const last = trial.cons.at(-1);
    if (connector?.t !== 'arc' || last?.t !== 'radius') return false;
    if (master === undefined) master = connector.id;
    else {
      trial.cons.pop();
      const equal = addCon(trial, 'equal', [master, connector.id]);
      if (connector.cornerBounds) connector.cornerBounds.dimension = equal.id;
    }
  }
  Object.assign(sk, trial);
}
