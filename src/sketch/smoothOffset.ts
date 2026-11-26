import type { Pt } from '../model';
import { addArc, addCon, addLine, addPt, cloneSketch, coincidentRoots, emptySketch, entOf, ptOf, type Sketch, type SkEnt } from './model';
import { cornerCrossesOutline } from './trimSpans';

const EPS = 1e-6, TURN = 2 * Math.PI;
type Edge = { ent: Exclude<SkEnt, { t: 'circle' } | { t: 'point' } | { t: 'ellipse' }>; start: number; end: number };
type Span = { a: Pt; b: Pt; center?: Pt; reverse?: boolean };

function tangent(sk: Sketch, edge: Edge, end: boolean): Pt | undefined {
  const { ent, start, end: finish } = edge;
  const a = ptOf(sk, start), b = ptOf(sk, finish);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) <= EPS) return;
  const c = ent.t === 'arc' ? ptOf(sk, ent.c) : undefined;
  const p = end ? b : a, sign = ent.t === 'arc' && start !== ent.s ? -1 : 1;
  const x = c ? -sign * (p.y - c.y) : b.x - a.x, y = c ? sign * (p.x - c.x) : b.y - a.y;
  const l = Math.hypot(x, y);
  if (l > EPS) return { x: x / l, y: y / l };
}

function insert(sk: Sketch, spans: Span[]) {
  const vertices = spans.map(({ a }) => addPt(sk, a.x, a.y).id);
  return spans.map(({ center, reverse }, i) => {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    return center ? addArc(sk, addPt(sk, center.x, center.y).id, reverse ? b : a, reverse ? a : b) : addLine(sk, a, b);
  });
}

/** Exact offset of a convex smooth loop. No flattening or approximate joins. */
function plan(sk: Sketch, id: number, cursor: Pt) {
  const source = entOf(sk, id), root = coincidentRoots(sk);
  // Ellipsen ausgenommen (Paket D: Konturversatz nur Kreis/glatte konvexe Kontur, kein Umbau).
  if (!source || source.aux || source.t === 'circle' || source.t === 'ellipse' || source.t === 'point') return;
  const ends = (e: Edge['ent']) => e.t === 'line' ? [e.a, e.b] : [e.s, e.e];
  const at = new Map<number, Edge['ent'][]>();
  for (const e of sk.ents) if (!e.aux && e.t !== 'circle' && e.t !== 'ellipse' && e.t !== 'point') for (const p of ends(e)) {
    const key = root(p);
    if (!at.has(key)) at.set(key, []);
    at.get(key)!.push(e);
  }
  const [start] = ends(source), edges: Edge[] = [], seen = new Set<number>();
  let next = source, from = root(start);
  for (;;) {
    if (seen.has(next.id) || edges.length >= 128) return;
    seen.add(next.id);
    const [a, b] = ends(next);
    const pair = root(a) === from ? [a, b] : [b, a];
    if (root(pair[0]) === root(pair[1])) return;
    edges.push({ ent: next, start: pair[0], end: pair[1] });
    from = root(pair[1]);
    const links = at.get(from);
    if (links?.length !== 2) return;
    if (from === root(start)) break;
    next = links[0] === next ? links[1] : links[0];
  }
  let total = 0;
  for (const edge of edges) if (edge.ent.t === 'arc') total += (edge.ent.a1 - edge.ent.a0) * (edge.start === edge.ent.s ? 1 : -1);
  const direction = Math.sign(total);
  if (!edges.some((edge) => edge.ent.t === 'line')) return;
  if (Math.abs(Math.abs(total) - TURN) > EPS || edges.some(({ ent, start }) => ent.t === 'arc' && (start === ent.s ? 1 : -1) !== direction)) return;
  const p = ptOf(sk, start), t = tangent(sk, edges[0], false);
  if (!p || !t) return;
  const c = source.t === 'arc' ? ptOf(sk, source.c) : undefined;
  const d = c && source.t === 'arc' ? source.r - Math.hypot(cursor.x - c.x, cursor.y - c.y) : (cursor.y - p.y) * t.x - (cursor.x - p.x) * t.y;
  if (!Number.isFinite(d) || Math.abs(d) <= EPS) return;
  const spans: Span[] = [];
  for (const [i, edge] of edges.entries()) {
    const after = edges[(i + 1) % edges.length];
    const a = ptOf(sk, edge.start)!, b = ptOf(sk, edge.end)!, nextStart = ptOf(sk, after.start)!;
    const u = tangent(sk, edge, false), v = tangent(sk, edge, true), w = tangent(sk, after, false);
    if (!u || !v || !w || !nextStart || Math.hypot(b.x - nextStart.x, b.y - nextStart.y) > EPS || Math.hypot(v.x - w.x, v.y - w.y) > EPS) return;
    const ent = edge.ent, center = ent.t === 'arc' ? ptOf(sk, ent.c) : undefined;
    if (ent.t === 'arc' && (!center || !(ent.r - direction * d > EPS))) return;
    spans.push({ a: { x: a.x - d * u.y, y: a.y + d * u.x }, b: { x: b.x - d * v.y, y: b.y + d * v.x }, center, reverse: direction < 0 });
  }
  if (spans.some(({ a, b }, i) => ![a.x, a.y, b.x, b.y].every(Number.isFinite) || Math.hypot(a.x - b.x, a.y - b.y) <= EPS
    || Math.hypot(b.x - spans[(i + 1) % spans.length].a.x, b.y - spans[(i + 1) % spans.length].a.y) > EPS)) return;
  const trial = cloneSketch(sk);
  const added = insert(trial, spans);
  if (added.some((e) => cornerCrossesOutline(trial, e))) return;
  return { spans, edges, d, direction };
}

export function planSmoothOffset(sk: Sketch, id: number, cursor: Pt): Sketch | undefined {
  const result = plan(sk, id, cursor);
  if (!result) return;
  const preview = emptySketch(); insert(preview, result.spans);
  return preview;
}

export function addSmoothOffset(sk: Sketch, source: number, cursor: Pt): void | false {
  const result = plan(sk, source, cursor);
  if (!result) return false;
  const { spans, edges, d, direction } = result;
  const vertices = spans.map(({ a }) => addPt(sk, a.x, a.y).id);
  const relations: number[] = [];
  const guides = edges.map(({ ent, start }, i) => {
    const before = edges[(i + edges.length - 1) % edges.length].ent;
    const arc = ent.t === 'arc' ? ent : before.t === 'arc' ? before : undefined;
    const vertex = vertices[i];
    const link = addLine(sk, start, vertex, true);
    link.trimSupport = true;
    if (arc) {
      const ray = addLine(sk, arc.c, start, true);
      ray.trimSupport = true;
      relations.push(addCon(sk, 'pointOnLine', [vertex, ray.id]).id);
    } else relations.push(addCon(sk, 'perpendicular', [link.id, ent.id]).id);
    // Each run of consecutive arcs already enforces equal radial offsets at its internal joints.
    return before.t === 'line' ? link.id : undefined;
  }).filter((id): id is number => id !== undefined);
  const dimension = addCon(sk, 'distance', [guides[0]], { v: Math.abs(d), min: EPS });
  for (const link of guides.slice(1)) relations.push(addCon(sk, 'equal', [guides[0], link]).id);
  relations.push(dimension.id);
  for (const [i, edge] of edges.entries()) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const entity = edge.ent.t === 'arc' ? addArc(sk, edge.ent.c, direction < 0 ? b : a, direction < 0 ? a : b) : addLine(sk, a, b);
    entity.smoothOffset = { source: edge.ent.id, first: edge.start, dimension: dimension.id, side: Math.sign(d), relations };
  }
}

export function matchesSmoothOffset(sk: Sketch, offset: SkEnt, magnitude: number): boolean {
  const link = offset.smoothOffset;
  const source = link ? entOf(sk, link.source) : undefined;
  if (!link || !source || (source.t !== 'line' && source.t !== 'arc') || source.t !== offset.t) return false;
  const reversed = source.t === 'arc' ? link.first !== source.s : link.first !== source.a;
  const end = source.t === 'arc' ? reversed ? source.s : source.e : reversed ? source.a : source.b;
  const start = link.first;
  if (start !== (source.t === 'arc' ? reversed ? source.e : source.s : reversed ? source.b : source.a)) return false;
  const edge = { ent: source, start, end };
  const offsetStart = offset.t === 'arc' ? reversed ? offset.e : offset.s : offset.a;
  const offsetEnd = offset.t === 'arc' ? reversed ? offset.s : offset.e : offset.b;
  const d = link.side * magnitude;
  if (source.t === 'arc' && offset.t === 'arc' && Math.abs((source.a1 - source.a0) - (offset.a1 - offset.a0)) > 1e-5) return false;
  return [[start, offsetStart], [end, offsetEnd]].every(([a, b], i) => {
    const p = ptOf(sk, a), q = ptOf(sk, b), t = tangent(sk, edge, i === 1);
    return p && q && t && Math.hypot(q.x - p.x + d * t.y, q.y - p.y - d * t.x) < 1e-5;
  });
}
