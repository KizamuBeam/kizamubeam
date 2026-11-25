// Platten für die 3D-Ansicht: Konturen als Linienzüge mit ihrer Lage im Raum, und die Prüfung, ob sich zwei
// Platten durchdringen (z. B. bei Presspassung oder falsch bemaßten Zinken).
import ClipperLib from 'clipper-lib';
import type { Pt, SubPath } from '../model';
import { IDENT } from '../model';
import { execute, flattenSub, Paths, SCALE } from '../clip';
import { buildGen, getGenerator, isPending, normalizeParams, Params } from '../generators';
import { assemblyPoses, cross, dot, genThickness, Pose, V3 } from './poses';

export interface Solid {
  /** Schlüssel des Teils (Baugruppe) bzw. der Objekt-ID */
  key: string;
  label: string;
  /** Geschlossene Konturen in lokalen Koordinaten (mm), Löcher nach Gerade-Ungerade-Regel */
  polys: Pt[][];
  pose: Pose;
  th: number;
  /** Drehzahl relativ zum Antrieb (nur Zahnräder) */
  spin?: number;
  /** Strip of a bent part (pose.bend): key of that part; all its strips share it (bentSolids) */
  part?: string;
  /** Local x where a strip was cut off its neighbours; the outline draws no edges there */
  seams?: number[];
}

/** Key of the part a solid belongs to (a strip of a bent part: that part) */
export const partKey = (s: Solid) => s.part ?? s.key;

/**
 * A bent part as rigid plates, one per segment of its path (collinear segments merged). Each strip keeps the local
 * coordinates of the part (only its slice of the outline along x), so places and engravings fit without conversion.
 * Strip keys are `${key}~${i}`, the part key is in `part`. Adjacent strips meet in the middle of the plate (inside the
 * bend they overlap in a thin wedge, outside a thin gap opens; findOverlaps and analyzeAssembly ignore that within one part).
 */
export function bentSolids(s: Solid): Solid[] {
  const bend = s.pose.bend;
  if (!bend) return [s];
  // Merge collinear segments
  const pts: [number, number][] = [bend.path[0]];
  for (let i = 1; i < bend.path.length; i++) {
    const q = bend.path[i];
    if (pts.length > 1) {
      const a = pts[pts.length - 2],
        b = pts[pts.length - 1];
      const d1 = [b[0] - a[0], b[1] - a[1]],
        d2 = [q[0] - b[0], q[1] - b[1]];
      const l1 = Math.hypot(d1[0], d1[1]),
        l2 = Math.hypot(d2[0], d2[1]);
      if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9 * l1 * l2 && d1[0] * d2[0] + d1[1] * d2[1] > 0) {
        pts[pts.length - 1] = q;
        continue;
      }
    }
    pts.push(q);
  }
  const { o, u, v, n } = s.pose;
  const xs = [bend.x0 ?? 0];
  for (let i = 1; i < pts.length; i++) xs.push(xs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  let ylo = Infinity,
    yhi = -Infinity,
    xlo = Infinity,
    xhi = -Infinity;
  for (const poly of s.polys)
    for (const q of poly) {
      ylo = Math.min(ylo, q.y);
      yhi = Math.max(yhi, q.y);
      xlo = Math.min(xlo, q.x);
      xhi = Math.max(xhi, q.x);
    }
  const subj: Paths = s.polys.map((poly) => poly.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  const out: Solid[] = [];
  const m = pts.length - 1;
  for (let i = 0; i < m; i++) {
    // The first and last strip go on straight beyond the ends of the path
    const xa = i === 0 ? Math.min(xlo, xs[0]) - 1 : xs[i],
      xb = i === m - 1 ? Math.max(xhi, xs[m]) + 1 : xs[i + 1];
    if (xb <= xlo || xa >= xhi) continue;
    const rect = [
      [xa, ylo - 1],
      [xb, ylo - 1],
      [xb, yhi + 1],
      [xa, yhi + 1],
    ].map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
    const polys = execute(ClipperLib.ClipType.ctIntersection, subj, [rect], ClipperLib.PolyFillType.pftEvenOdd)
      .filter((p) => p.length > 2)
      .map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
    if (!polys.length) continue;
    const len = xs[i + 1] - xs[i];
    const ta = (pts[i + 1][0] - pts[i][0]) / len,
      tb = (pts[i + 1][1] - pts[i][1]) / len;
    const comb = (a: number, b: number): V3 => [a * u[0] + b * n[0], a * u[1] + b * n[1], a * u[2] + b * n[2]];
    const u2 = comb(ta, tb),
      n2 = comb(-tb, ta);
    // The middle of the plate lies on the path
    const base = comb(pts[i][0], pts[i][1]);
    const h = s.th / 2;
    const o2: V3 = [0, 1, 2].map((k) => o[k] + base[k] - xs[i] * u2[k] - h * n2[k]) as V3;
    const seams = [...(i > 0 ? [xa] : []), ...(i < m - 1 ? [xb] : [])];
    out.push({ ...s, key: `${s.key}~${out.length}`, part: s.key, seams, polys, pose: { o: o2, u: u2, v, n: n2 } });
  }
  return out;
}

/** Konturen in Linienzüge zerlegen (offene Pfade werden ignoriert) */
export function subsPolys(subs: SubPath[]): Pt[][] {
  return subs.filter((sp) => sp.closed && sp.nodes.length > 2).map((sp) => flattenSub(sp, IDENT).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
}

/**
 * Outline segments of an extruded plate, built from its 2D contours instead of the triangulated mesh
 * (EdgesGeometry draws stray lines where the cap triangulation has T-junctions, issue #182).
 * Each contour is drawn at z = 0 and z = th; a vertical edge is added at every vertex where the contour
 * turns by more than angleDeg (same threshold EdgesGeometry used), so smooth curves stay clean.
 * Returns flat xyz pairs for a LineSegments geometry.
 */
export function outlineSegments(polys: Pt[][], th: number, angleDeg = 25, seams: number[] = []): number[] {
  const out: number[] = [];
  const onSeam = (q: Pt) => seams.some((x) => Math.abs(q.x - x) < 2e-3);
  const cosMax = Math.cos((angleDeg * Math.PI) / 180);
  const eps = 1e-9;
  for (const raw of polys) {
    // Drop repeated points, including a closing point equal to the first one
    const poly: Pt[] = [];
    for (const q of raw) {
      const last = poly[poly.length - 1];
      if (!last || Math.hypot(q.x - last.x, q.y - last.y) > eps) poly.push(q);
    }
    while (poly.length > 1 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) <= eps) poly.pop();
    if (poly.length < 3) continue;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i],
        b = poly[(i + 1) % n];
      const seamA = onSeam(a);
      if (!(seamA && onSeam(b) && Math.abs(a.x - b.x) < 2e-3)) out.push(a.x, a.y, 0, b.x, b.y, 0, a.x, a.y, th, b.x, b.y, th);
      if (seamA) continue;
      const p = poly[(i + n - 1) % n];
      const ix = a.x - p.x,
        iy = a.y - p.y,
        ox = b.x - a.x,
        oy = b.y - a.y;
      const cos = (ix * ox + iy * oy) / (Math.hypot(ix, iy) * Math.hypot(ox, oy));
      if (cos < cosMax) out.push(a.x, a.y, 0, a.x, a.y, th);
    }
  }
  return out;
}

/**
 * Alle Teile einer Baugruppe in Lage, ohne Schnittfuge (so, wie sie nach dem Lasern aussehen).
 * keys: nur diese Teile (vom Nutzer gelöschte fehlen); fallbackTh: Dicke, wenn der Generator keine kennt.
 * Liefert null, wenn der Generator unbekannt ist, keinen räumlichen Aufbau hat oder die Parameter fehlerhaft sind,
 * und 'pending', solange ein Plugin noch rechnet (danach meldet onPluginResult das Ergebnis).
 */
export function asmSolids(gen: string, raw: Params, fallbackTh: number, keys?: Set<string>): Solid[] | null | 'pending' {
  const g = getGenerator(gen);
  if (!g) return null;
  // Für die Körper zählt nur die Form der Teile, nicht ihre Lage: ohne das Zusammenschieben (nestParts)
  const params = normalizeParams(g, { ...raw, kerf: 0, partLayout: 'rows' });
  const th = genThickness(params, fallbackTh);
  // Generate first: a plugin generator starts computing here and knows its poses only afterwards
  const r = buildGen(g, params);
  if (isPending(r)) return 'pending';
  const poses = assemblyPoses(gen, params, th);
  if (!poses) return null;
  if (!r.parts.length) return null;
  const out: Solid[] = [];
  for (const p of r.parts) {
    const key = p.shape.part ?? 'main';
    const pose = poses.poses[key];
    if (!pose || (keys && !keys.has(key))) continue;
    out.push(...bentSolids({ key, label: g.label(params, p.shape.part), polys: subsPolys(p.shape.subs), pose, th, spin: poses.spin?.[key] }));
  }
  return out;
}

// ---------- Überschneidungen ----------

export interface Overlap {
  a: string;
  b: string;
  /** Volumen der Durchdringung in mm³ */
  volume: number;
  /** Bereiche der Durchdringung als Platten (zum Einfärben) */
  pieces: Solid[];
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const world = (s: Solid, x: number, y: number, z = 0): V3 => add(add(add(s.pose.o, s.pose.u, x), s.pose.v, y), s.pose.n, z);

/** Ausdehnung einer Platte entlang der Richtung d */
function extent(s: Solid, d: V3): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const poly of s.polys)
    for (const q of poly)
      for (const z of [0, s.th]) {
        const v = dot(world(s, q.x, q.y, z), d);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  return [lo, hi];
}

/** Dicke der Platte entlang ihrer Normalen als Bereich der Koordinate dot(P, d) für d = ±n */
function slab(s: Solid, d: V3): [number, number] {
  const o = dot(s.pose.o, d);
  return dot(s.pose.n, d) > 0 ? [o, o + s.th] : [o - s.th, o];
}

/** Schnitt einer Kontur (in Koordinaten (t, w)) mit der Geraden t = const: Intervalle in w */
function scan(polys: [number, number][][], t: number): [number, number][] {
  const xs: number[] = [];
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ta, wa] = poly[j],
        [tb, wb] = poly[i];
      if (ta <= t !== tb <= t) xs.push(wa + ((t - ta) * (wb - wa)) / (tb - ta));
    }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const clipTo = (iv: [number, number][], lo: number, hi: number) =>
  iv.map(([a, b]): [number, number] => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b - a > 1e-9);
const measure = (iv: [number, number][]) => iv.reduce((s, [a, b]) => s + b - a, 0);

const EPS_VOL = 1e-3;

/**
 * Senkrechte Platten (Zinken, Kreuzschlitze): Koordinaten t entlang der Schnittgeraden, a entlang nA, b entlang nB.
 * A ist in a die eigene Dicke und in (t, b) die Kontur, B entsprechend. Für jedes t ist der gemeinsame Querschnitt
 * ein Rechteck aus (Dicke von A ∩ Kontur von B) × (Dicke von B ∩ Kontur von A); t wird fein abgetastet.
 */
function perpendicular(A: Solid, B: Solid): Overlap | null {
  const nA = A.pose.n,
    nB = B.pose.n;
  const d = cross(nA, nB);
  const [sa0, sa1] = slab(A, nA),
    [sb0, sb1] = slab(B, nB);
  const toTW = (s: Solid, w: V3) => s.polys.map((poly) => poly.map((q): [number, number] => { const P = world(s, q.x, q.y); return [dot(P, d), dot(P, w)]; }));
  const pa = toTW(A, nB),
    pb = toTW(B, nA);
  const [ta0, ta1] = extent(A, d),
    [tb0, tb1] = extent(B, d);
  const t0 = Math.max(ta0, tb0),
    t1 = Math.min(ta1, tb1);
  if (t1 - t0 <= 1e-9) return null;
  const n = Math.min(4000, Math.max(1, Math.ceil((t1 - t0) / 0.02)));
  const step = (t1 - t0) / n;
  let volume = 0;
  const pieces: Solid[] = [];
  // Gleiche Querschnitte nacheinander zu einem Quader zusammenfassen
  let run: { t: number; ia: [number, number][]; ib: [number, number][] } | null = null;
  const same = (x: [number, number][], y: [number, number][]) => x.length === y.length && x.every((v, i) => Math.abs(v[0] - y[i][0]) < 1e-6 && Math.abs(v[1] - y[i][1]) < 1e-6);
  const flush = (tEnd: number) => {
    if (!run) return;
    for (const [a0, a1] of run.ib)
      for (const [b0, b1] of run.ia) {
        const o = add(add([0, 0, 0], d, run.t), add([0, 0, 0], add(add([0, 0, 0], nA, a0), nB, b0)));
        pieces.push({ key: '', label: '', pose: { o, u: d, v: nB, n: nA }, th: a1 - a0, polys: [[{ x: 0, y: 0 }, { x: tEnd - run.t, y: 0 }, { x: tEnd - run.t, y: b1 - b0 }, { x: 0, y: b1 - b0 }]] });
      }
    run = null;
  };
  for (let k = 0; k < n; k++) {
    const t = t0 + (k + 0.5) * step;
    // Kontur von A an der Stelle t, begrenzt auf die Dicke von B (und umgekehrt)
    const ia = clipTo(scan(pa, t), sb0, sb1);
    const ib = ia.length ? clipTo(scan(pb, t), sa0, sa1) : [];
    const area = measure(ia) * measure(ib);
    if (area <= 1e-9) {
      flush(t0 + k * step);
      continue;
    }
    volume += area * step;
    if (run && !(same(run.ia, ia) && same(run.ib, ib))) flush(t0 + k * step);
    if (!run) run = { t: t0 + k * step, ia, ib };
  }
  flush(t1);
  return volume > EPS_VOL ? { a: A.key, b: B.key, volume, pieces } : null;
}

/** Parallele Platten (Zahnräder, flach liegende Teile): gemeinsame Fläche in der Ebene × gemeinsame Dicke */
function parallel(A: Solid, B: Solid): Overlap | null {
  const n = A.pose.n;
  const [a0, a1] = slab(A, n),
    [b0, b1] = slab(B, n);
  const z0 = Math.max(a0, b0),
    h = Math.min(a1, b1) - z0;
  if (h <= 1e-9) return null;
  const toA = (P: V3) => {
    const r = add(P, A.pose.o, -1);
    return { X: Math.round(dot(r, A.pose.u) * SCALE), Y: Math.round(dot(r, A.pose.v) * SCALE) };
  };
  const pa: Paths = A.polys.map((poly) => poly.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  const pb: Paths = B.polys.map((poly) => poly.map((q) => toA(world(B, q.x, q.y))));
  const res = execute(ClipperLib.ClipType.ctIntersection, pa, pb, ClipperLib.PolyFillType.pftEvenOdd);
  const area = res.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
  const volume = Math.abs(area) * h;
  if (volume <= EPS_VOL) return null;
  // Within the plane, too, an overlap narrower than the tolerance on each side counts as touching (end faces of
  // plates that meet edge to edge, such as the pieces of a bent wall, #513)
  const off = new ClipperLib.ClipperOffset();
  off.AddPaths(res, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const core: Paths = [];
  off.Execute(core, -OVERLAP_TOLERANCE * SCALE);
  if (!core.length) return null;
  const o = add(A.pose.o, n, z0 - dot(A.pose.o, n));
  return {
    a: A.key,
    b: B.key,
    volume,
    pieces: [{ key: '', label: '', pose: { ...A.pose, o }, th: h, polys: res.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }))) }],
  };
}

type P2 = [number, number];

/** Konvexes Vieleck an einer Halbebene k·(x, y) ≤ c abschneiden (Sutherland–Hodgman) */
function clipHalf(poly: P2[], kx: number, ky: number, c: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const fa = kx * a[0] + ky * a[1] - c,
      fb = kx * b[0] + ky * b[1] - c;
    if (fa <= 0) out.push(a);
    if (fa < 0 !== fb < 0 && fa !== fb) {
      const u = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
  }
  return out;
}

const polyArea = (p: P2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/**
 * Schräg zueinander stehende Platten (Scheibenkugel). Wie bei senkrechten Platten wird entlang der Schnittgeraden
 * (Richtung d) abgetastet; im Querschnitt senkrecht zu d ist jede Platte eine Menge von Vierecken: A Rechtecke in
 * (wA, nA), B Parallelogramme (Kontur entlang wB × eigene Dicke entlang nB), die mit A geschnitten werden.
 */
function oblique(A: Solid, B: Solid): Overlap | null {
  const nA = A.pose.n,
    nB = B.pose.n;
  const c = cross(nA, nB);
  const len = Math.hypot(c[0], c[1], c[2]);
  const d: V3 = [c[0] / len, c[1] / len, c[2] / len];
  const wA = cross(nA, d),
    wB = cross(nB, d);
  const [sa0, sa1] = slab(A, nA),
    [sb0, sb1] = slab(B, nB);
  const toTW = (s: Solid, w: V3) => s.polys.map((poly) => poly.map((q): [number, number] => { const P = world(s, q.x, q.y); return [dot(P, d), dot(P, w)]; }));
  const pa = toTW(A, wA),
    pb = toTW(B, wB);
  const [ta0, ta1] = extent(A, d),
    [tb0, tb1] = extent(B, d);
  const t0 = Math.max(ta0, tb0),
    t1 = Math.min(ta1, tb1);
  if (t1 - t0 <= 1e-9) return null;
  // Querschnitt-Koordinaten (x, y) = (P·wA, P·nA); P·nB und P·wB sind darin lineare Funktionen (Drehung)
  const a = dot(wA, nB),
    b = dot(nA, nB),
    cc = dot(wA, wB),
    e = dot(nA, wB);
  const det = a * e - b * cc;
  const solve = (s: number, u: number): P2 => [(s * e - b * u) / det, (a * u - cc * s) / det];
  // Bereich in x, in dem die Dicke von B den Streifen der Dicke von A überhaupt trifft (P·nB = a·x + b·y)
  let xlo = -Infinity,
    xhi = Infinity;
  if (Math.abs(a) > 1e-9) {
    const xs = [sb0, sb1].flatMap((s) => [sa0, sa1].map((y) => (s - b * y) / a));
    xlo = Math.min(...xs);
    xhi = Math.max(...xs);
  }
  const n = Math.min(2000, Math.max(1, Math.ceil((t1 - t0) / 0.02)));
  const step = (t1 - t0) / n;
  let volume = 0;
  const pieces: Solid[] = [];
  let run: { t: number; key: string; polys: P2[][] } | null = null;
  const flush = (tEnd: number) => {
    if (!run) return;
    for (const poly of run.polys) pieces.push({ key: '', label: '', pose: { o: [d[0] * run.t, d[1] * run.t, d[2] * run.t], u: wA, v: nA, n: d }, th: tEnd - run.t, polys: [poly.map(([x, y]) => ({ x, y }))] });
    run = null;
  };
  for (let k = 0; k < n; k++) {
    const t = t0 + (k + 0.5) * step;
    const ia = clipTo(scan(pa, t), xlo, xhi);
    const ib = ia.length ? scan(pb, t) : [];
    const polys: P2[][] = [];
    let area = 0;
    for (const [x0, x1] of ia)
      for (const [u0, u1] of ib) {
        let q: P2[] = [solve(sb0, u0), solve(sb1, u0), solve(sb1, u1), solve(sb0, u1)];
        q = clipHalf(q, -1, 0, -x0);
        q = clipHalf(q, 1, 0, x1);
        q = clipHalf(q, 0, -1, -sa0);
        q = clipHalf(q, 0, 1, sa1);
        if (q.length < 3) continue;
        const ar = polyArea(q);
        if (ar <= 1e-9) continue;
        area += ar;
        polys.push(q);
      }
    if (area <= 1e-9) {
      flush(t0 + k * step);
      continue;
    }
    volume += area * step;
    const key = polys.map((p) => p.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(';')).join('|');
    if (run && run.key !== key) flush(t0 + k * step);
    if (!run) run = { t: t0 + k * step, key, polys };
  }
  flush(t1);
  return volume > EPS_VOL ? { a: A.key, b: B.key, volume, pieces } : null;
}

/** Bounding Box im Raum */
export function solidBounds(s: Solid): { min: V3; max: V3 } {
  const ax = [extent(s, [1, 0, 0]), extent(s, [0, 1, 0]), extent(s, [0, 0, 1])];
  return { min: [ax[0][0], ax[1][0], ax[2][0]], max: [ax[0][1], ax[1][1], ax[2][1]] };
}

/** Eindringtiefe in mm, bis zu der Platten als berührend gelten (Rundung der Koordinaten, z. B. Fachbreite 28,533…) */
export const OVERLAP_TOLERANCE = 0.01;

/** Platte auf beiden Flächen um die Toleranz verkleinern; dünnere Platten bleiben unverändert */
function shrunk(s: Solid): Solid {
  if (s.th <= 4 * OVERLAP_TOLERANCE) return s;
  const o = add(s.pose.o, s.pose.n, OVERLAP_TOLERANCE);
  return { ...s, pose: { ...s.pose, o }, th: s.th - 2 * OVERLAP_TOLERANCE };
}

/**
 * Paarweise Durchdringungen. Parallele, senkrechte und schräg zueinander stehende Platten.
 * Eindringtiefen unter OVERLAP_TOLERANCE zählen als Berührung. Strips of a bent part (bentSolids) count as that part:
 * they are not checked against each other, and their overlaps with another part are reported as one (keys of the parts).
 */
export function findOverlaps(solids: Solid[]): Overlap[] {
  const cores = solids.map(shrunk);
  const boxes = solids.map(solidBounds);
  const out: Overlap[] = [];
  const byPair = new Map<string, Overlap>();
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      if (solids[i].part !== undefined && solids[i].part === solids[j].part) continue;
      const p = boxes[i],
        q = boxes[j];
      if ([0, 1, 2].some((k) => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) <= 1e-9)) continue;
      const c = Math.abs(dot(solids[i].pose.n, solids[j].pose.n));
      const test = c > 1 - 1e-9 ? parallel : c < 1e-9 ? perpendicular : oblique;
      // Die verkleinerten Platten entscheiden, ob überhaupt eine Durchdringung vorliegt; Volumen und Bereiche kommen von den echten
      if (test(cores[i], cores[j])) {
        const r = test(solids[i], solids[j]);
        if (!r) continue;
        if (solids[i].part === undefined && solids[j].part === undefined) {
          out.push(r);
          continue;
        }
        const a = partKey(solids[i]),
          b = partKey(solids[j]);
        const k = `${a}\n${b}`;
        const seen = byPair.get(k);
        if (seen) {
          seen.volume += r.volume;
          seen.pieces.push(...r.pieces);
        } else {
          const ov = { ...r, a, b };
          byPair.set(k, ov);
          out.push(ov);
        }
      }
    }
  return out;
}
