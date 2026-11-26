import ClipperLib from 'clipper-lib';
import type { Pt } from '../model';
import { addCon, addLine, addPt, cloneSketch, coincidentRoots, entOf, ptOf, type Sketch } from './model';
import { cornerCrossesOutline } from './trimSpans';

type SplitInset = { source: Pt[]; contours: Pt[][] };
const GRID = 1e6; // µm fractions in local mm; never flatten round geometry into this operation.
const LIMIT = 128;

function addContours(sk: Sketch, contours: Pt[][], fixed: boolean) {
  return contours.flatMap((path) => {
    const points = path.map((p) => addPt(sk, p.x, p.y));
    if (fixed) for (const p of points) addCon(sk, 'fixed', [p.id], { x: p.x, y: p.y });
    return points.map((p, i) => addLine(sk, p.id, points[(i + 1) % points.length].id));
  });
}

/** Only topology-changing insets of simple straight contours. No silently flattened arcs or merged holes. */
export function planSplitInset(sk: Sketch, id: number, cursor: Pt): SplitInset | undefined {
  const edge = entOf(sk, id);
  if (edge?.t !== 'line' || edge.aux) return;
  const root = coincidentRoots(sk), byVertex = new Map<number, number[]>();
  for (const e of sk.ents) {
    // Ellipsen ausgenommen (Paket D: nur gerade Konturen, kein Umbau).
    if (e.aux || e.t === 'circle' || e.t === 'ellipse' || e.t === 'point') continue;
    for (const p of e.t === 'line' ? [e.a, e.b] : e.t === 'arc' ? [e.s, e.e] : [] as number[]) {
      const key = root(p), incident = byVertex.get(key);
      if (incident) incident.push(e.id); else byVertex.set(key, [e.id]);
    }
  }
  const source: Pt[] = [], walked = new Set<number>();
  let first = edge.a, next = edge;
  for (;;) {
    const second = next.a === first ? next.b : next.a;
    const a = ptOf(sk, first), b = ptOf(sk, second);
    if (!a || !b || root(first) === root(second) || walked.has(next.id) || walked.size >= LIMIT || cornerCrossesOutline(sk, next)) return;
    source.push(a); walked.add(next.id);
    const neighbors = byVertex.get(root(second));
    if (neighbors?.length !== 2) return;
    if (root(second) === root(edge.a)) {
      if (Math.hypot(source[0].x - b.x, source[0].y - b.y) > 1e-6) return;
      break;
    }
    const follow = entOf(sk, neighbors.find((n) => n !== next.id) ?? -1);
    if (follow?.t !== 'line') return;
    first = root(follow.a) === root(second) ? follow.a : follow.b;
    const start = ptOf(sk, first);
    if (!start || Math.hypot(start.x - b.x, start.y - b.y) > 1e-6) return;
    next = follow;
  }
  if (source.length < 3) return;
  const [a, b] = source, dx = b.x - a.x, dy = b.y - a.y;
  const input = source.map((p) => ({ X: Math.round((p.x - a.x) * GRID), Y: Math.round((p.y - a.y) * GRID) }));
  if (!input.every(({ X, Y }) => Math.max(Math.abs(X), Math.abs(Y)) <= 1e12)) return;
  const area = ClipperLib.Clipper.Area(input);
  const distance = ((cursor.y - a.y) * dx - (cursor.x - a.x) * dy) / Math.hypot(dx, dy) * Math.sign(area);
  if (!(distance > 1e-6 && distance < 1e6)) return;
  if (area < 0) input.reverse();
  const offset = new ClipperLib.ClipperOffset(2, 1), result: ClipperLib.Paths = [];
  offset.AddPath(input, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  offset.Execute(result, -distance * GRID);
  if (result.length < 2 || result.reduce((n, p) => n + p.length, 0) > LIMIT * 2 || result.some((p) => p.length < 3 || ClipperLib.Clipper.Area(p) <= 1)) return;
  if (result.some((path) => path.some((p) => ClipperLib.Clipper.PointInPolygon(p, input) !== 1))) return;
  const contours = result.map((path) => path.map(({ X, Y }) => ({ x: a.x + X / GRID, y: a.y + Y / GRID })));
  const trial = cloneSketch(sk);
  const added = addContours(trial, contours, false);
  if (added.some((e) => cornerCrossesOutline(trial, e))) return;
  return { source, contours };
}

export function addSplitInset(sk: Sketch, plan: SplitInset) {
  addContours(sk, plan.contours, true);
}
