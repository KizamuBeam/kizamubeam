// Joints on curved edges (#513): finger joints and tenon and slot along a smooth run of segments (a circle, the
// rounded corner of a box), mated with a straight edge, usually the edge of a strip that is bent round the curve.
// Positions along a curved edge are measured on the line where the middle of the mating plate stands (the layer of
// a bent board that keeps its length), so fingers and tenons meet their partners after bending. Fingers and slots
// follow the curve; their flanks run along the normal. The result is fitted back to Bézier curves.
// Pure geometry in world coordinates (mm) like jointsGeom.ts, problems and notes as codes (texts in jointText.ts).
import type { Node, Pt, SubPath } from './model';
import { bezierPt, segments } from './curves';
import { fitPolyline } from './fit';
import { dropBacktrack, fingerCount, jointAdjust, tenonCenters, type JointEdge, type JointGeometryVersion, type JointGeomResult, type JointMsg, type JointOptions } from './jointsGeom';

/** Largest angle (degrees) between two segments that still continue a smooth run */
const SMOOTH_DEG = 3;
/** Largest distance between two points when a curve is sampled (mm) */
const STEP = 0.4;
/** Deviation of the fitted curves (mm) */
const FIT_TOL = 0.01;

/** Is the chosen edge more than one straight segment (a curve or a smooth run)? */
export const isCurvedEdge = (e: { subs: SubPath[]; sub: number; seg: number; segs?: number }) =>
  (e.segs ?? 1) > 1 || !!segments(e.subs[e.sub])[e.seg]?.curve;

const tangentOut = (s: ReturnType<typeof segments>[number]): Pt => {
  const d = Math.hypot(s.b.x - s.c2.x, s.b.y - s.c2.y) > 1e-9 ? { x: s.b.x - s.c2.x, y: s.b.y - s.c2.y } : { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};
const tangentIn = (s: ReturnType<typeof segments>[number]): Pt => {
  const d = Math.hypot(s.c1.x - s.a.x, s.c1.y - s.a.y) > 1e-9 ? { x: s.c1.x - s.a.x, y: s.c1.y - s.a.y } : { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};

/**
 * The smooth run of segments around segment seg of a sub-path: neighbours are added while they continue without a
 * corner. Returns its first segment and the number of segments; a closed outline without corners is the whole loop,
 * starting at seg.
 */
export function smoothChain(sp: SubPath, seg: number): { seg: number; segs: number } {
  const segs = segments(sp);
  const n = segs.length;
  const cosMax = Math.cos((SMOOTH_DEG * Math.PI) / 180);
  const joins = (i: number, j: number) => {
    const a = tangentOut(segs[i]),
      b = tangentIn(segs[j]);
    return a.x * b.x + a.y * b.y >= cosMax;
  };
  let first = seg,
    count = 1;
  // forwards
  while (count < n) {
    const last = (first + count - 1) % n;
    const next = last + 1;
    if (next >= n && !sp.closed) break;
    if (!joins(last, next % n)) break;
    count++;
  }
  if (count === n) return { seg, segs: n };
  // backwards
  while (count < n) {
    const prev = first - 1;
    if (prev < 0 && !sp.closed) break;
    const p = (prev + n) % n;
    if (!joins(p, first)) break;
    first = p;
    count++;
  }
  return { seg: first, segs: count };
}

/** Point in the area of the closed sub-paths (even-odd)? */
function insideSubs(subs: SubPath[], p: Pt): boolean {
  let inside = false;
  for (const sp of subs) {
    if (!sp.closed) continue;
    const pts: Pt[] = [];
    for (const s of segments(sp)) {
      if (!s.curve) pts.push(s.a);
      else for (let i = 0; i < 16; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 16));
    }
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** An edge (straight, curved or a smooth run) sampled as a polyline, with positions measured on a parallel line */
interface CurveEdge {
  P: Pt[];
  /** Unit normals away from the material */
  N: Pt[];
  /** Length along the line at distance w (cumulative per point) */
  A: number[];
  len: number;
  loop: boolean;
  closed: boolean;
  curved: boolean;
}

function sampleEdge(e: JointEdge, w: number): CurveEdge {
  const sp = e.subs[e.sub];
  const all = segments(sp);
  const k = e.segs ?? 1;
  const loop = sp.closed && k >= all.length;
  const P: Pt[] = [];
  const T: Pt[] = [];
  for (let j = 0; j < k; j++) {
    const s = all[(e.seg + j) % all.length];
    if (!s.curve) {
      const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      const l = Math.hypot(d.x, d.y) || 1;
      P.push({ x: s.a.x, y: s.a.y });
      T.push({ x: d.x / l, y: d.y / l });
    } else {
      // Rough length from the control polygon, then even steps in the parameter
      const rough = Math.hypot(s.c1.x - s.a.x, s.c1.y - s.a.y) + Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) + Math.hypot(s.b.x - s.c2.x, s.b.y - s.c2.y);
      const m = Math.max(8, Math.ceil(rough / STEP));
      for (let i = 0; i < m; i++) {
        const t = i / m;
        const q = bezierPt(s.a, s.c1, s.c2, s.b, t);
        // Derivative of the cubic
        const u = 1 - t;
        const dx = 3 * u * u * (s.c1.x - s.a.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.b.x - s.c2.x);
        const dy = 3 * u * u * (s.c1.y - s.a.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.b.y - s.c2.y);
        const l = Math.hypot(dx, dy);
        P.push(q);
        T.push(l > 1e-12 ? { x: dx / l, y: dy / l } : tangentIn(s));
      }
    }
  }
  const last = all[(e.seg + k - 1) % all.length];
  P.push({ x: last.b.x, y: last.b.y });
  T.push(tangentOut(last));
  // At a straight segment the tangent of its start point is its direction; at the join to a curve average both
  for (let i = 1; i < P.length - 1; i++) {
    const d = { x: P[i + 1].x - P[i - 1].x, y: P[i + 1].y - P[i - 1].y };
    const l = Math.hypot(d.x, d.y);
    if (l > 1e-12) T[i] = { x: d.x / l, y: d.y / l };
  }
  if (loop) {
    const d = { x: P[1].x - P[P.length - 2].x, y: P[1].y - P[P.length - 2].y };
    const l = Math.hypot(d.x, d.y) || 1;
    T[0] = T[P.length - 1] = { x: d.x / l, y: d.y / l };
  }
  // Normal: left of the direction of travel as with straight edges, turned away from the material of closed outlines
  let N = T.map((t) => ({ x: t.y, y: -t.x }));
  if (sp.closed) {
    // Probe beside the middle of a piece of the edge (not at a corner)
    const i = Math.floor((P.length - 1) / 2);
    const j = i + 1;
    const mid = { x: (P[i].x + P[j].x) / 2, y: (P[i].y + P[j].y) / 2 };
    const nm = { x: (N[i].x + N[j].x) / 2, y: (N[i].y + N[j].y) / 2 };
    const eps = 0.02;
    if (insideSubs(e.subs, { x: mid.x + nm.x * eps, y: mid.y + nm.y * eps })) N = N.map((q) => ({ x: -q.x, y: -q.y }));
  }
  const A = [0];
  for (let i = 1; i < P.length; i++) {
    const a = { x: P[i - 1].x + N[i - 1].x * w, y: P[i - 1].y + N[i - 1].y * w },
      b = { x: P[i].x + N[i].x * w, y: P[i].y + N[i].y * w };
    A.push(A[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { P, N, A, len: A[A.length - 1], loop, closed: sp.closed, curved: isCurvedEdge(e) };
}

/** Does the line at distance v stay a clean parallel of the edge (no segment turns back)? */
function offsetOk(g: CurveEdge, v: number): boolean {
  for (let i = 1; i < g.P.length; i++) {
    const dx = g.P[i].x - g.P[i - 1].x,
      dy = g.P[i].y - g.P[i - 1].y;
    if (dx * dx + dy * dy < 1e-18) continue;
    const ox = dx + (g.N[i].x - g.N[i - 1].x) * v,
      oy = dy + (g.N[i].y - g.N[i - 1].y) * v;
    if (ox * dx + oy * dy <= 0) return false;
  }
  return true;
}

/** Point at position u (measured on the reference line) and distance v from the edge (v > 0 away from the material) */
function at(g: CurveEdge, u: number, v: number): Pt {
  if (g.loop) u = ((u % g.len) + g.len) % g.len;
  const A = g.A;
  // Beyond the ends: straight on along the end direction
  if (u <= 0 || u >= g.len) {
    const i = u <= 0 ? 0 : A.length - 1;
    const d = travel(g, i);
    const s = u <= 0 ? u : u - g.len;
    return { x: g.P[i].x + d.x * s + g.N[i].x * v, y: g.P[i].y + d.y * s + g.N[i].y * v };
  }
  let lo = 0,
    hi = A.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (A[m] <= u) lo = m;
    else hi = m;
  }
  const f = A[hi] - A[lo] > 1e-12 ? (u - A[lo]) / (A[hi] - A[lo]) : 0;
  const p = { x: g.P[lo].x + (g.P[hi].x - g.P[lo].x) * f, y: g.P[lo].y + (g.P[hi].y - g.P[lo].y) * f };
  let n = { x: g.N[lo].x + (g.N[hi].x - g.N[lo].x) * f, y: g.N[lo].y + (g.N[hi].y - g.N[lo].y) * f };
  const l = Math.hypot(n.x, n.y) || 1;
  n = { x: n.x / l, y: n.y / l };
  return { x: p.x + n.x * v, y: p.y + n.y * v };
}

/** Unit direction of travel at the end point i */
function travel(g: CurveEdge, i: number): Pt {
  const j = i === 0 ? 1 : i - 1;
  const d = i === 0 ? { x: g.P[j].x - g.P[i].x, y: g.P[j].y - g.P[i].y } : { x: g.P[i].x - g.P[j].x, y: g.P[i].y - g.P[j].y };
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

/** Points from u0 to u1 (u0 < u1) at distance v: both ends and every sample point between them, also across the seam of a loop */
function run(g: CurveEdge, u0: number, u1: number, v: number, out: Pt[]) {
  const us = [u0];
  const laps = g.loop ? [Math.floor(u0 / g.len), Math.floor(u1 / g.len)] : [0, 0];
  for (let k = laps[0]; k <= laps[1]; k++)
    for (let i = 0; i < g.A.length - 1; i++) {
      const u = k * g.len + g.A[i];
      if (u > u0 + 1e-9 && u < u1 - 1e-9) us.push(u);
    }
  us.sort((a, b) => a - b);
  us.push(u1);
  for (const u of us) out.push(at(g, u, v));
}

/** Copy of the sub-paths (nodes and handles) */
const copySubs = (subs: SubPath[]): SubPath[] =>
  subs.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n): Node => ({ x: n.x, y: n.y, ...(n.cin ? { cin: { ...n.cin } } : {}), ...(n.cout ? { cout: { ...n.cout } } : {}), ...(n.smooth ? { smooth: true } : {}) })) }));

/** Replace the edge (segments seg … seg + segs − 1) of a sub-path by the polyline pts (from its start to its end) */
function replaceEdge(sp: SubPath, e: { seg: number; segs?: number }, pts: Pt[], loop: boolean) {
  if (loop) {
    const fitted = fitPolyline(pts, true, FIT_TOL);
    sp.nodes = fitted.nodes;
    return;
  }
  const k = e.segs ?? 1;
  const n = sp.nodes.length;
  // Closed outlines: start the node list at the edge, so it never wraps
  const ns = sp.closed ? [...sp.nodes.slice(e.seg), ...sp.nodes.slice(0, e.seg)] : sp.nodes;
  const s = sp.closed ? 0 : e.seg;
  const fitted = fitPolyline(pts, false, FIT_TOL).nodes;
  const first = fitted[0],
    last = fitted[fitted.length - 1];
  if (ns[s].cin) first.cin = ns[s].cin;
  const end = ns[(s + k) % n];
  if (end.cout && (sp.closed || s + k < n)) last.cout = end.cout;
  const after = sp.closed ? (k < n ? ns.slice(k + 1) : []) : ns.slice(s + k + 1);
  sp.nodes = [...ns.slice(0, s), ...fitted, ...after];
}

/**
 * Joint with at least one curved edge: finger joints (one or two edges) and tenon and slot (edge 1 gets the tenons,
 * edge 2 the slots). Other kinds need straight edges.
 */
export function computeCurveJointGeom<K>(picks: JointEdge<K>[], o: JointOptions, v: JointGeometryVersion): JointGeomResult<K> {
  const fail = (code: string, values?: JointMsg['values']): JointGeomResult<K> => ({ changes: new Map(), added: [], info: [], error: { code, ...(values ? { values } : {}) } });
  if (o.kind !== 'finger' && o.kind !== 'tenon') return fail('curve-kind');
  if (picks.length > 1 && picks[0].obj === picks[1].obj && picks[0].sub === picks[1].sub) return fail('curve-same-outline');
  const th = o.thickness;
  if (!(th > 0)) return fail('thickness');
  const { along } = jointAdjust(o, v);
  const changes = new Map<K, SubPath[]>();
  const subsOf = (p: JointEdge<K>) => {
    let c = changes.get(p.obj);
    if (!c) changes.set(p.obj, (c = copySubs(p.subs)));
    return c;
  };
  for (const p of picks) subsOf(p);
  const info: JointMsg[] = [];
  /** Where the middle of the mating plate stands, measured from the edge outwards */
  const axisOf = (i: number) => (o.kind === 'finger' ? (o.direction === 'in' ? -th / 2 : th / 2) : i === 0 ? th / 2 : 0);
  const geoms = picks.map((p, i) => sampleEdge({ ...p, subs: changes.get(p.obj)! }, axisOf(i)));
  const curved = geoms.findIndex((g) => g.curved);

  if (o.kind === 'finger') {
    const [vMat, vGap] = o.direction === 'in' ? [0, -th] : [th, 0];
    for (const g of geoms) if (!offsetOk(g, -th) || !offsetOk(g, th)) return fail('curve-tight', { th });
    // A whole loop has no ends: its pattern goes once round with an even number of fields
    const loop = geoms.find((g) => g.loop);
    let pattern: number, n: number;
    if (loop) {
      pattern = loop.len;
      const other = geoms.find((g) => g !== loop);
      // A few tenths short are within what bending varies anyway (and a Bézier circle is a little longer than a true one)
      if (other && other.len < pattern - 0.2) return fail('curve-strip-short', { len: other.len, need: pattern });
      n = Math.max(4, 2 * Math.round(pattern / Math.max(0.1, o.fingerWidth) / 2));
    } else {
      pattern = Math.min(...geoms.map((g) => g.len));
      n = fingerCount(pattern, o.fingerWidth);
    }
    const w = pattern / n;
    if (w - Math.abs(along) <= 0.05) return fail('fingers-narrow');
    geoms.forEach((g, i) => {
      const phase = (i + (o.swap ? 1 : 0)) % 2;
      const mat = (f: number) => (((f % n) + n) % n + phase) % 2 === 0;
      const level = (f: number) => (mat(f) ? vMat : vGap);
      // The partner of a loop starts its pattern at its start, like the strip that goes round it; a longer strip keeps
      // its plain edge after the pattern (cut it off or overlap it). Otherwise the pattern lies in the middle.
      const tail = !!loop && !g.loop && g.len > pattern + 0.01;
      const margin = loop && !g.loop ? 0 : (g.len - pattern) / 2;
      // Boundary j between field j − 1 and field j moves adj/2 into the gap field
      const bound = (j: number) => margin + j * w + (mat(j - 1) ? along / 2 : -along / 2);
      const pts: Pt[] = [];
      if (g.loop) {
        // The flanks are the steps between the runs; the last run ends where the first starts
        for (let f = 0; f < n; f++) run(g, bound(f), bound(f + 1), level(f), pts);
      } else {
        pts.push(at(g, 0, 0));
        for (let f = 0; f < n; f++) run(g, f === 0 ? 0 : bound(f), f === n - 1 && !tail ? g.len : bound(f + 1), level(f), pts);
        if (tail) {
          // Plain edge after the pattern, up to the end
          run(g, bound(n), g.len, 0, pts);
        }
        pts.push(at(g, g.len, 0));
      }
      const sp = changes.get(picks[i].obj)![picks[i].sub];
      replaceEdge(sp, picks[i], pts, g.loop);
      // Fingers cut in that start or end with a gap: the old corner would stay as a spike of zero width (#401)
      if (!g.loop && sp.closed) for (const c of [g.P[0], g.P[g.P.length - 1]]) dropBacktrack(sp, c);
    });
    info.push({ code: 'finger-info', values: { n, width: w } });
    if (geoms.length > 1 && Math.abs(geoms[0].len - geoms[1].len) > 0.01)
      info.push(loop ? { code: 'curve-strip-long', values: { len: Math.max(geoms[0].len, geoms[1].len), pattern } } : { code: 'lengths-differ', values: { len: geoms[0].len, len2: geoms[1].len, pattern } });
  } else {
    // Tenon and slot: tenons on edge 1, slots on edge 2
    const g = geoms[0];
    if (!offsetOk(g, th)) return fail('curve-tight', { th });
    const n = Math.max(1, Math.round(o.tenonCount));
    const tw = o.tenonWidth + along;
    const hw = tw / 2;
    if (!(o.tenonWidth > 0) || tw * n >= g.len - 0.1) return fail('tenons-fit');
    const centers = tenonCenters(g.len, n);
    const pts: Pt[] = [];
    if (g.loop) {
      // Round the loop: each tenon, then the gap to the next one
      centers.forEach((c, k) => {
        run(g, c - hw, c + hw, th, pts);
        run(g, c + hw, (k + 1 < n ? centers[k + 1] : centers[0] + g.len) - hw, 0, pts);
      });
    } else {
      pts.push(at(g, 0, 0));
      let u = 0;
      for (const c of centers) {
        run(g, u, c - hw, 0, pts);
        run(g, c - hw, c + hw, th, pts);
        u = c + hw;
      }
      run(g, u, g.len, 0, pts);
    }
    replaceEdge(changes.get(picks[0].obj)![picks[0].sub], picks[0], pts, g.loop);
    info.push({ code: 'tenon-info', values: { n, kind: o.kind, width: o.tenonWidth, thickness: th } });
    if (picks.length > 1) {
      const s = geoms[1];
      const sideIn = s.closed ? -1 : 1;
      const vc = sideIn * o.slotOffset;
      const sl = o.tenonWidth - along,
        sw = th - o.kerf + (o.slotClearance ?? o.clearance);
      if (sl <= 0 || sw <= 0) return fail('slots-small');
      // Slots measured on their own centre line, where the middle of the tenon plate stands
      const sc = sampleEdge({ ...picks[1], subs: changes.get(picks[1].obj)! }, vc);
      if (!offsetOk(sc, vc - sw / 2) || !offsetOk(sc, vc + sw / 2)) return fail('curve-tight', { th });
      const mid = sc.len / 2;
      const slots: SubPath[] = centers.map((c) => {
        const uc = mid + c - g.len / 2;
        const a: Pt[] = [],
          b: Pt[] = [];
        run(sc, uc - sl / 2, uc + sl / 2, vc - sw / 2, a);
        run(sc, uc - sl / 2, uc + sl / 2, vc + sw / 2, b);
        return fitPolyline([...a, ...b.reverse()], true, FIT_TOL);
      });
      const tsubs = changes.get(picks[1].obj)!;
      // A single guide line is replaced by the slots (as with straight edges)
      if (tsubs.length === 1 && !tsubs[0].closed && tsubs[0].nodes.length === 2) tsubs.length = 0;
      tsubs.push(...slots);
      info.push({ code: 'slot-count', values: { n } });
      if (sc.len < g.len - 0.01) info.push({ code: 'slot-short', values: { len: sc.len, len2: g.len } });
      if (s.closed && o.slotOffset < th / 2 + 0.01) info.push({ code: 'slot-edge' });
    }
  }
  // Length of the curved edge where the middle of the mating plate stands: the length of the strip to bend round it
  if (curved >= 0) info.push({ code: 'curve-strip', values: { len: geoms[curved].len, ...(geoms[curved].loop ? { loop: 1 } : {}) } });
  return { changes, added: [], info };
}
