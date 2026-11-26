import type { Pt } from '../model';
import { addArc, addCon, addLine, addPt, entOf, ptOf, type Sketch, type SkEnt } from './model';
import { isSketchTrimBoundary } from './trim';
import { sketchLineCircle } from './intersections';

const TAU = 2 * Math.PI;
const EPS = 1e-6; // sketch millimeters
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
type Line = { type: 'line'; start: Pt; end: Pt; length: number; a: number; b: number };
type Round = { type: 'round'; center: Pt; radius: number; start: number; sweep: number; c: number; s?: number; e?: number };
type Curve = Line | Round;
type Boundary = { at: number; cutter?: number; point?: number };
export type TrimStroke = { from: Pt; to: Pt } | { center: Pt; radius: number; start: number; end: number };
export type TrimSpan = { target: number; from: Boundary; to: Boundary; stroke: TrimStroke };

function curveOf(sk: Sketch, e: SkEnt): Curve | undefined {
  if (e.t === 'line') {
    const start = ptOf(sk, e.a), end = ptOf(sk, e.b);
    if (!start || !end) return;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > EPS) return { type: 'line', start, end, length, a: e.a, b: e.b };
  } else if (e.t === 'circle' || e.t === 'arc') {
    // Ellipsen ausgenommen (Paket D): als Kreis mit Nebenradius zu schneiden wäre falsche Geometrie.
    const center = ptOf(sk, e.c);
    if (!center || !(e.r > EPS)) return;
    return e.t === 'arc' ? { type: 'round', center, radius: e.r, start: e.a0, sweep: e.a1 - e.a0, c: e.c, s: e.s, e: e.e }
      : { type: 'round', center, radius: e.r, start: 0, sweep: TAU, c: e.c };
  }
}

function at(c: Curve, t: number): Pt {
  if (c.type === 'line') return { x: c.start.x + t * (c.end.x - c.start.x), y: c.start.y + t * (c.end.y - c.start.y) };
  const a = c.start + t * c.sweep;
  return { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) };
}

function parameter(c: Curve, p: Pt): number {
  if (c.type === 'line') return ((p.x - c.start.x) * ((c.end.x - c.start.x) / c.length) + (p.y - c.start.y) * ((c.end.y - c.start.y) / c.length)) / c.length;
  const a = wrap(Math.atan2(p.y - c.center.y, p.x - c.center.x) - c.start);
  return (TAU - a < EPS / c.radius ? 0 : a) / c.sweep;
}

function length(c: Curve) { return c.type === 'line' ? c.length : c.radius * c.sweep; }
function endpoint(c: Curve, t: number) {
  const tol = EPS / length(c);
  if (t <= tol) return c.type === 'line' ? c.a : c.s;
  if (1 - t <= tol) return c.type === 'line' ? c.b : c.e;
}
function on(c: Curve, p: Pt) {
  const t = parameter(c, p), q = at(c, t);
  const tol = EPS / length(c);
  return t >= -tol && t <= 1 + tol && Math.hypot(p.x - q.x, p.y - q.y) <= EPS;
}

function lineRound(line: Line, round: Round): Pt[] {
  const ux = (line.end.x - line.start.x) / line.length, uy = (line.end.y - line.start.y) / line.length;
  const hits = sketchLineCircle(line.start, { x: ux, y: uy }, round.center, round.radius);
  return hits.length === 2 ? hits.map((d) => ({ x: line.start.x + d * ux, y: line.start.y + d * uy })) : [];
}

function roundRound(a: Round, b: Round): Pt[] {
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
  const d = Math.hypot(dx, dy), sum = a.radius + b.radius, diff = a.radius - b.radius;
  // Tangencies (including internal ones) do not delimit removable spans.
  if (!(d > Math.abs(diff) && d < sum)) return [];
  const along = (d + (diff / d) * sum) / 2;
  const halfChord = Math.sqrt((a.radius - along) * (a.radius + along));
  if (!(halfChord > EPS && Number.isFinite(halfChord))) return [];
  const ux = dx / d, uy = dy / d;
  return [-halfChord, halfChord].map((h) => ({
    x: a.center.x + along * ux - h * uy,
    y: a.center.y + along * uy + h * ux,
  }));
}

function intersections(a: Curve, b: Curve): Pt[] {
  if (a.type === 'round') return b.type === 'round' ? roundRound(a, b) : lineRound(b, a);
  if (b.type === 'round') return lineRound(a, b);
  const x = a.end.x - a.start.x, y = a.end.y - a.start.y;
  const u = b.end.x - b.start.x, v = b.end.y - b.start.y;
  const det = x * v - y * u;
  if (!(Math.abs(det) > a.length * b.length * 1e-10)) return [];
  return [at(a, ((b.start.x - a.start.x) * v - (b.start.y - a.start.y) * u) / det)];
}

/** Transverse intersections on both finite edges. The tangent cross product identifies the branch. */
export function sketchEdgeIntersections(sk: Sketch, first: SkEnt, second: SkEnt, includeTangency = false) {
  const a = curveOf(sk, first), b = curveOf(sk, second);
  if (!a || !b) return [];
  const tangent = (c: Curve, p: Pt) => c.type === 'line'
    ? { x: (c.end.x - c.start.x) / c.length, y: (c.end.y - c.start.y) / c.length }
    : { x: (c.center.y - p.y) / c.radius, y: (p.x - c.center.x) / c.radius };
  let hits = intersections(a, b);
  if (!hits.length && includeTangency) {
    const line = a.type === 'line' ? a : b.type === 'line' ? b : undefined;
    if (line) {
      const round = a.type === 'round' ? a : b.type === 'round' ? b : undefined;
      if (round) {
        const direction = { x: (line.end.x - line.start.x) / line.length, y: (line.end.y - line.start.y) / line.length };
        hits = sketchLineCircle(line.start, direction, round.center, round.radius).map((d) => ({ x: line.start.x + d * direction.x, y: line.start.y + d * direction.y }));
      }
    } else if (a.type === 'round' && b.type === 'round') {
      const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y, d = Math.hypot(dx, dy);
      if (d > EPS && Math.min(Math.abs(d - a.radius - b.radius), Math.abs(d - Math.abs(a.radius - b.radius))) < EPS) {
        const dir = Math.abs(d - a.radius - b.radius) < EPS || a.radius >= b.radius ? 1 : -1;
        hits = [{ x: a.center.x + dir * a.radius * dx / d, y: a.center.y + dir * a.radius * dy / d }];
      }
    }
  }
  return hits.flatMap((p) => {
    if (!on(a, p) || !on(b, p)) return [];
    const u = tangent(a, p), v = tangent(b, p), cross = u.x * v.y - u.y * v.x;
    return Math.abs(cross) > 1e-6 ? [{ ...p, branch: Math.sign(cross) }] : includeTangency ? [{ ...p, branch: 0 }] : [];
  });
}

/** Check a new corner against all other visible edges, allowing only its connected endpoints. */
export function cornerCrossesOutline(sk: Sketch, connector: SkEnt): boolean {
  const curve = curveOf(sk, connector);
  if (!curve) return true;
  for (const e of sk.ents) {
    if (e.aux || e.id === connector.id) continue;
    const other = curveOf(sk, e);
    if (!other) continue;
    let hits = intersections(curve, other);
    if (curve.type === 'round' && other.type === 'round' && !hits.length) {
      const dx = other.center.x - curve.center.x, dy = other.center.y - curve.center.y;
      const d = Math.hypot(dx, dy), sum = curve.radius + other.radius, diff = curve.radius - other.radius;
      if (d <= EPS && Math.abs(diff) <= EPS) {
        hits = [at(curve, 0), at(curve, 0.5), at(curve, 1), at(other, 0), at(other, 0.5), at(other, 1)];
      } else if (d > EPS && (Math.abs(d - sum) <= EPS || Math.abs(d - Math.abs(diff)) <= EPS)) {
        const along = (d + (diff / d) * sum) / 2;
        hits = [{ x: curve.center.x + along * dx / d, y: curve.center.y + along * dy / d }];
      }
    } else if (curve.type === 'line' && other.type === 'line' && !hits.length) {
      // Collinear finite edges can overlap without a unique intersection.
      hits = [curve.start, curve.end, other.start, other.end, at(curve, 0.5), at(other, 0.5)];
    } else if (curve.type === 'line' && other.type === 'round' || curve.type === 'round' && other.type === 'line') {
      const line = curve.type === 'line' ? curve : other as Line;
      const round = curve.type === 'round' ? curve : other as Round;
      const ux = (line.end.x - line.start.x) / line.length, uy = (line.end.y - line.start.y) / line.length;
      hits = sketchLineCircle(line.start, { x: ux, y: uy }, round.center, round.radius)
        .map((d) => ({ x: line.start.x + d * ux, y: line.start.y + d * uy }));
    }
    for (const p of hits) {
      if (!on(curve, p) || !on(other, p)) continue;
      const a = endpoint(curve, parameter(curve, p)), b = endpoint(other, parameter(other, p));
      if (a === undefined || a !== b) return true;
    }
  }
  return false;
}

/** Nearest point on a circular element in sketch coordinates, for hover hit testing. */
export function sketchRoundTrimHit(sk: Sketch, e: SkEnt, p: Pt): Pt | undefined {
  const curve = curveOf(sk, e);
  if (curve?.type !== 'round') return;
  const t = parameter(curve, p);
  if (t <= 1) return at(curve, t);
  const a = at(curve, 0), b = at(curve, 1);
  return Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b;
}

export function pickTrimSpan(sk: Sketch, target: number, cursor: Pt): TrimSpan | undefined {
  const ent = entOf(sk, target), curve = ent && curveOf(sk, ent);
  if (!ent || !curve || ent.aux) return;
  const loop = ent.t === 'circle';
  const tol = EPS / length(curve);
  const hits: Boundary[] = [];
  let roundBoundary = false;
  if (ent.t === 'line') for (const c of sk.cons) {
    if (c.t !== 'pointOnLine' || c.r[1] !== target) continue;
    const point = ptOf(sk, c.r[0]);
    if (!point || !on(curve, point)) continue;
    const t = parameter(curve, point);
    if (t > tol && t < 1 - tol && !hits.some((h) => Math.abs(h.at - t) <= tol)) hits.push({ at: t, point: point.id });
  }
  for (const cutter of sk.ents) {
    if (cutter.id === target || !isSketchTrimBoundary(sk, cutter)) continue;
    const other = curveOf(sk, cutter);
    if (!other) continue;
    for (const p of intersections(curve, other)) {
      if (!on(curve, p) || !on(other, p)) continue;
      let t = Math.max(0, Math.min(1, parameter(curve, p)));
      if (t <= tol) t = 0;
      else if (1 - t <= tol) t = loop ? 0 : 1;
      const point = endpoint(other, parameter(other, p));
      // A shared corner is an existing connection, not a cut across the side.
      if (point !== undefined && point === endpoint(curve, t)) continue;
      if (other.type === 'round') roundBoundary = true;
      if (!hits.some((h) => Math.abs(h.at - t) <= tol)) hits.push({ at: t, cutter: cutter.id, point });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  if (!hits.length || (loop && hits.length < 2)) return;
  if (!loop && hits.length === 1 && (hits[0].at === 0 || hits[0].at === 1)) return;
  const bounds = loop ? [...hits, { ...hits[0], at: hits[0].at + 1 }] : [
    ...(hits[0].at > 0 ? [{ at: 0 }] : []), ...hits, ...(hits.at(-1)!.at < 1 ? [{ at: 1 }] : []),
  ];
  let t = parameter(curve, cursor);
  if (loop && t < bounds[0].at) t += 1;
  const i = bounds.findIndex((b, i) => i > 0 && t <= b.at + tol && t >= bounds[i - 1].at - tol);
  if (i < 1) return;
  const from = bounds[i - 1], to = bounds[i];
  // Keep the established single line/line end trim (and its loss approval) when applicable.
  if (curve.type === 'line' && !roundBoundary && (from.at === 0 || to.at === 1)
    && ![from, to].some((h) => h.point !== undefined && h.cutter === undefined)
    && !(from.at === 0 && from.cutter !== undefined) && !(to.at === 1 && to.cutter !== undefined)) return;
  return { target, from, to, stroke: curve.type === 'line' ? { from: at(curve, from.at), to: at(curve, to.at) }
    : { center: curve.center, radius: curve.radius, start: curve.start + curve.sweep * from.at, end: curve.start + curve.sweep * to.at } };
}

/** The construction original retains its IDs and constraints; only resulting pieces are output. */
export function applyTrimSpan(sk: Sketch, span: TrimSpan): void | false {
  const ent = entOf(sk, span.target), curve = ent && curveOf(sk, ent);
  if (!ent || ent.aux || !curve) return false;
  const sections: [Boundary, Boundary][] = ent.t === 'circle' ? [[span.to, { ...span.from, at: span.from.at + 1 }]] : [
    [{ at: 0 }, span.from], [span.to, { at: 1 }],
  ];
  const point = ({ at: t, cutter, point: existing }: Boundary) => {
    if (ent.t === 'line' && (t === 0 || t === 1)) return t === 0 ? ent.a : ent.b;
    if (ent.t === 'arc' && (t === 0 || t === 1)) return t === 0 ? ent.s : ent.e;
    const p = at(curve, t);
    const id = existing ?? addPt(sk, p.x, p.y).id;
    if (ent.t === 'line' && !sk.cons.some((c) => c.t === 'pointOnLine' && c.r[0] === id && c.r[1] === ent.id)) addCon(sk, 'pointOnLine', [id, ent.id]);
    if (cutter !== undefined && existing === undefined) addCon(sk, entOf(sk, cutter)?.t === 'line' ? 'pointOnLine' : 'pointOnCircle', [id, cutter]);
    return id;
  };
  for (const [a, b] of sections) {
    if ((b.at - a.at) * length(curve) <= EPS) continue;
    const start = point(a), end = point(b);
    if (ent.t === 'line') addLine(sk, start, end);
    else if (ent.t !== 'point') {
      const arc = addArc(sk, ent.c, start, end);
      // An endpoint already bound to the original radius makes an extra equality redundant.
      const incidence = (id: number) => sk.cons.find((c) => c.t === 'pointOnCircle' && c.r[0] === id && c.r[1] === ent.id);
      const originalEndpoint = (id: number) => ent.t === 'arc' && (id === ent.s || id === ent.e);
      const radiusBound = (id: number) => originalEndpoint(id) || !!incidence(id);
      if (!radiusBound(start) && !radiusBound(end)) addCon(sk, 'equal', [ent.id, arc.id]);
      else if (radiusBound(start) && radiusBound(end)) {
        // The new arc itself enforces the second incidence through its shared center and first endpoint.
        const implied = incidence(end) ?? incidence(start);
        if (implied) sk.cons = sk.cons.filter((c) => c.id !== implied.id);
      }
    }
  }
  ent.aux = true;
  ent.trimSupport = true;
}
