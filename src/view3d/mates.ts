// Teile, die mit dem Verbindungs-Werkzeug verbunden wurden, im Raum zusammensetzen.
//
// Jede gemerkte Verbindung (Mate in model.ts) legt fest, wie das Gegenstück zum ersten Teil steht. Gerechnet wird
// in den Weltkoordinaten der Arbeitsfläche (mm): Eine Lage bildet (x, y, Höhe in der Platte) in den Raum ab.
// Ausgehend vom Teil mit den meisten Verbindungen wird Teil für Teil angesetzt (Breitensuche); schließt eine
// Verbindung einen Kreis (Box mit vier Wänden), entscheidet die Überschneidungsprüfung, ob alles passt.
import type { Mat, Mate, Pt } from '../model';
import { apply } from '../model';
import { flatPose, Pose, V3 } from './poses';
import { bentSolids, type Solid } from './solids';
import ClipperLib from 'clipper-lib';
import { execute, SCALE } from '../clip';

export interface MatePart {
  id: number;
  label: string;
  /** Konturen in Weltkoordinaten der Arbeitsfläche */
  polys: Pt[][];
  /** Weltmatrix des Objekts (für die lokal gespeicherten Punkte der Verbindungen) */
  m: Mat;
  mates: Mate[];
}

interface Line {
  /** Anfang, Ende, Einheitsrichtung, Einheitsnormale ins Material (alles 2D, Welt) */
  a: Pt;
  b: Pt;
  dir: Pt;
  in: Pt;
}

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });

function line(m: Mat, pts: [Pt, Pt, Pt]): Line {
  const [a, b, c] = pts.map((p) => apply(m, p.x, p.y));
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y) || 1;
  const dir = { x: d.x / l, y: d.y / l };
  let n = { x: -dir.y, y: dir.x };
  const w = sub(c, a);
  if (n.x * w.x + n.y * w.y < 0) n = { x: -n.x, y: -n.y };
  return { a, b, dir, in: n };
}

const v3 = (p: Pt, z = 0): V3 => [p.x, p.y, z];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const plus = (...vs: V3[]): V3 => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0] as V3);
const lerp = (l: Line, t: number): Pt => ({ x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t });

/**
 * Lage einer Platte, deren Linie L auf die Raumlinie durch Q mit Richtung T fällt, deren Material von der Linie aus
 * in Richtung I liegt und deren Dicke in Richtung N zeigt. at: Anteil der Linie, der auf Q fällt.
 */
function fit(L: Line, at: number, Q: V3, T: V3, I: V3, N: V3): Pose {
  // Lineare Abbildung über die Basis (dir, in) der Linie: dir → T, in → I
  const u = plus(scale(T, L.dir.x), scale(I, L.in.x));
  const v = plus(scale(T, L.dir.y), scale(I, L.in.y));
  const p = lerp(L, at);
  return { o: plus(Q, scale(u, -p.x), scale(v, -p.y)), u, v, n: N };
}

/**
 * Lage des Gegenstücks B, wenn das erste Teil A die Lage „Identität“ hat (Weltkoordinaten, Dicke nach +z).
 * Konventionen: Gegenstücke stehen auf der Seite +z von A; die beiden Kanten laufen gegenläufig wie in einem
 * aufgefalteten Netz.
 */
export function mateRelative(A: Line, B: Line, mt: Mate): Pose | null {
  const th = mt.th;
  const Z: V3 = [0, 0, 1];
  const inA = v3(A.in),
    dirA = v3(A.dir);
  const midA = lerp(A, 0.5);
  switch (mt.kind) {
    case 'finger':
      // Ecke: B steht senkrecht auf der Kante von A. Zinken nach innen (Außenmaß): B liegt im Zinkenstreifen von A,
      // seine Außenseite bündig mit der Kante. Zinken nach außen (Innenmaß): B liegt vor der Kante, über der Dicke von A.
      return mt.out
        ? fit(B, 0.5, v3(midA, th), scale(dirA, -1), Z, scale(inA, -1))
        : fit(B, 0.5, v3(midA, 0), scale(dirA, -1), Z, inA);
    case 'lidhinge':
      // Deckel liegt geschlossen auf der Oberkante der Rückwand A, hinten bündig mit ihrer Außenseite (z = 0)
      return fit(B, 0.5, v3(midA, 0), scale(dirA, -1), Z, scale(inA, -1));
    case 'lap': {
      if (!mt.lap) return null;
      // Kreuzung: Der Schlitz von A läuft von der Kante ins Material (Richtung inA). B steht senkrecht dazu,
      // seine Kante liegt um beide Schlitztiefen tiefer, sein Material zeigt zurück zur Kante von A.
      const P = lerp(A, mt.lap.ua);
      const foot = { x: P.x + A.in.x * (mt.lap.da + mt.lap.db), y: P.y + A.in.y * (mt.lap.da + mt.lap.db) };
      return fit(B, mt.lap.ub, plus(v3(foot, th / 2), scale(dirA, -th / 2)), Z, scale(inA, -1), dirA);
    }
    default: {
      // Zapfen-Familie: A ist das Teil mit den Zapfen, B hat die Schlitze. Dafür B fest und A ansetzen,
      // dann umkehren: A steht auf B (Seite +z), Mittelebene von A durch die Schlitzmitte, Zapfen nach unten durch B.
      const nB = v3(B.in);
      const mid = lerp(B, 0.5);
      const PA = fit(A, 0.5, plus(v3(mid, th), scale(nB, -th / 2)), v3(B.dir), Z, nB);
      return invert(PA);
    }
  }
}

/** Verkettung: erst q, dann p */
export function compose(p: Pose, q: Pose): Pose {
  const L = (w: V3): V3 => plus(scale(p.u, w[0]), scale(p.v, w[1]), scale(p.n, w[2]));
  // A bend lies in the plane of u and n of q, so it moves with them
  return { o: plus(p.o, L(q.o)), u: L(q.u), v: L(q.v), n: L(q.n), ...(q.bend ? { bend: q.bend } : {}) };
}

/** Umkehrung (die Achsen sind orthonormal: Transponierte) */
export function invert(p: Pose): Pose {
  const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    o: [-d(p.u, p.o), -d(p.v, p.o), -d(p.n, p.o)],
    u: [p.u[0], p.v[0], p.n[0]],
    v: [p.u[1], p.v[1], p.n[1]],
    n: [p.u[2], p.v[2], p.n[2]],
  };
}

export interface MateAssembly {
  solids: Solid[];
  /** Kennung der Gruppe je Teil (zusammenhängende Teile werden gemeinsam auseinandergezogen) */
  groups: Map<string, string>;
  /** Teile, die über Verbindungen angesetzt wurden */
  placed: Set<number>;
  /**
   * Bent strips (#513): their outlines in the solids are not in world coordinates of the work area but along the strip
   * (x along its edge from the start, y into the material); this maps the work area onto them
   */
  frames: Map<number, Mat>;
}

/** World of the work area → coordinates along a strip's edge line (x from its start, y into the material) */
function stripFrame(L: Line): Mat {
  // apply(m, x, y) = (a·x + c·y + e, b·x + d·y + f)
  return [L.dir.x, L.in.x, L.dir.y, L.in.y, -(L.a.x * L.dir.x + L.a.y * L.dir.y), -(L.a.x * L.in.x + L.a.y * L.in.y)] as Mat;
}

/**
 * Point of a bent plate in space: local (x, y) at height s in the plate, exactly as bentSolids lays the strips (the
 * plate goes on straight before the first and after the last point of the path)
 */
export function bentPoint(p: Pose, x: number, y: number, s: number, th: number): V3 {
  const path = p.bend!.path;
  const xs = [p.bend!.x0 ?? 0];
  for (let i = 1; i < path.length; i++) xs.push(xs[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  let i = 0;
  while (i < path.length - 2 && x > xs[i + 1]) i++;
  const len = xs[i + 1] - xs[i] || 1;
  const ta = (path[i + 1][0] - path[i][0]) / len,
    tb = (path[i + 1][1] - path[i][1]) / len;
  const comb = (a: number, b: number): V3 => plus(scale(p.u, a), scale(p.n, b));
  return plus(p.o, comb(path[i][0], path[i][1]), scale(comb(ta, tb), x - xs[i]), scale(p.v, y), scale(comb(-tb, ta), s - th / 2));
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** Orthonormal frame through three points (columns: along p0→p1, in the plane towards p2, normal) */
function frame3(p: V3[]): [V3, V3, V3] {
  const e1 = unit(sub3(p[1], p[0]));
  const w = sub3(p[2], p[0]);
  const e2 = unit(sub3(w, scale(e1, dot3(w, e1))));
  return [e1, e2, cross3(e1, e2)];
}

/**
 * Placement of a plate that takes the points src (its local coordinates x, y at one height, all in its plane) onto dst
 * (space), from three of them, with its thickness pointing along up (towards the strip that stands on it): mirrored
 * if need be, like the work area is mirrored for the plates placed from it. null if the others land more than 0.2 mm
 * off (the two curves do not have the same shape, or the patterns are not laid out alike).
 */
function rigidFit(src: V3[], dst: V3[], up: V3): Pose | null {
  const k = [0, Math.floor(src.length / 3), Math.floor((2 * src.length) / 3)];
  const S = frame3(k.map((i) => src[i])),
    D = frame3(k.map((i) => dst[i]));
  // The points lie in the plate's plane: its normal may go to either side; take the side of the strip
  if (dot3(S[2], [0, 0, 1]) * dot3(D[2], up) < 0) D[2] = scale(D[2], -1);
  // R = D·Sᵀ: a vector w in local coordinates goes to Σ (w·S_j) D_j
  const R = (w: V3): V3 => plus(scale(D[0], dot3(w, S[0])), scale(D[1], dot3(w, S[1])), scale(D[2], dot3(w, S[2])));
  const pose: Pose = { o: sub3(dst[k[0]], R(src[k[0]])), u: R([1, 0, 0]), v: R([0, 1, 0]), n: R([0, 0, 1]) };
  for (let i = 0; i < src.length; i++) {
    const q = plus(pose.o, scale(pose.u, src[i][0]), scale(pose.v, src[i][1]), scale(pose.n, src[i][2]));
    if (Math.hypot(...sub3(q, dst[i])) > 0.2) return null;
  }
  return pose;
}

/** A finger joint between a curve and a straight edge: the strip S is bent round the curve of C */
interface BentLink {
  C: number;
  S: number;
  /** The strip's edge line (world) */
  edge: Line;
  /** Pose of the strip (along its edge line) when C has the pose "identity" */
  rel: Pose;
  th: number;
}

function bentLink(p: MatePart, q: MatePart, mt: Mate): BentLink | null {
  const b = mt.bend;
  if (!b || b.path.length < 2) return null;
  const [C, S] = b.on === 'a' ? [p, q] : [q, p];
  const edge = line(S.m, b.on === 'a' ? mt.b : mt.a);
  // The middle of the strip stands on path (local coordinates of C → world), its edge line at height z over C, its
  // material upwards
  const path = b.path.map((pt) => {
    const w = apply(C.m, pt.x, pt.y);
    return [w.x, w.y] as [number, number];
  });
  return { C: C.id, S: S.id, edge, rel: { o: [0, 0, b.z], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0], bend: { path, x0: b.x0 } }, th: mt.th };
}

/**
 * Verbundene Teile zusammensetzen. Teile ohne Verbindung kommen nicht vor. fallbackTh: Dicke für Teile, deren
 * Verbindungen keine nennen (gibt es nicht, aber sicher ist sicher).
 *
 * A strip joined to a curve (#513) is bent round it and placed only through such joints: from the curved plate,
 * and from a placed strip on to another curved plate (a lid), which is fitted onto where the strip stands.
 */
export function assembleMates(parts: MatePart[], fallbackTh: number): MateAssembly {
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Kanten des Verbindungsgraphen in beide Richtungen
  const adj = new Map<number, { other: number; rel: Pose; th: number }[]>();
  const bent = new Map<number, BentLink[]>();
  const strips = new Set<number>();
  const link = (x: number, y: number, rel: Pose, th: number) => {
    if (!adj.has(x)) adj.set(x, []);
    adj.get(x)!.push({ other: y, rel, th });
  };
  const linkBent = (x: number, l: BentLink) => {
    if (!bent.has(x)) bent.set(x, []);
    bent.get(x)!.push(l);
  };
  for (const p of parts)
    for (const mt of p.mates) {
      const q = byId.get(mt.to);
      if (!q || q === p) continue;
      if (mt.bend) {
        const l = bentLink(p, q, mt);
        if (!l) continue;
        strips.add(l.S);
        linkBent(l.C, l);
        linkBent(l.S, l);
        continue;
      }
      const rel = mateRelative(line(p.m, mt.a), line(q.m, mt.b), mt);
      if (!rel) continue;
      link(p.id, q.id, rel, mt.th);
      link(q.id, p.id, invert(rel), mt.th);
    }
  const poses = new Map<number, Pose>();
  const thick = new Map<number, number>();
  const groups = new Map<string, string>();
  const frames = new Map<number, Mat>();
  // Wurzel: das Teil mit den meisten Verbindungen, bei Gleichstand das größte (Seitenwand statt Regalboden); a bent
  // strip never (it is placed round its curve)
  const size = (id: number) => {
    const pts = byId.get(id)!.polys.flat();
    const xs = pts.map((q) => q.x),
      ys = pts.map((q) => q.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  const degree = (id: number) => (adj.get(id)?.length ?? 0) + (bent.get(id)?.length ?? 0);
  const order = [...new Set([...adj.keys(), ...bent.keys()])]
    .filter((id) => !strips.has(id))
    .sort((x, y) => degree(y) - degree(x) || size(y) - size(x) || x - y);
  for (const root of order) {
    if (poses.has(root)) continue;
    // Wurzel liegt flach, von oben gesehen wie auf der Arbeitsfläche
    poses.set(root, flatPose());
    const queue = [root];
    while (queue.length) {
      const x = queue.shift()!;
      groups.set(String(x), 'm' + root);
      const px = poses.get(x)!;
      // Rigid joints only between flat plates: a bent strip's pose is not a rigid frame
      if (!strips.has(x))
        for (const e of adj.get(x) ?? []) {
          if (!thick.has(x)) thick.set(x, e.th);
          if (poses.has(e.other) || strips.has(e.other)) continue;
          poses.set(e.other, compose(px, e.rel));
          thick.set(e.other, e.th);
          queue.push(e.other);
        }
      for (const l of bent.get(x) ?? []) {
        if (!thick.has(x)) thick.set(x, l.th);
        if (x === l.C) {
          if (poses.has(l.S)) continue;
          poses.set(l.S, compose(px, l.rel));
          frames.set(l.S, stripFrame(l.edge));
          thick.set(l.S, l.th);
          queue.push(l.S);
        } else {
          if (poses.has(l.C)) continue;
          // The other curved plate: its line of the strip's middle onto the strip as it is already bent
          const to = frames.get(x)!;
          const path = l.rel.bend!.path;
          // Round a closed ring the strip's other edge may start at its far end (a strip longer than the ring, cut
          // to length later): count positions round the ring the strip is bent on
          const own = px.bend!;
          const ring = Math.hypot(own.path[0][0] - own.path.at(-1)![0], own.path[0][1] - own.path.at(-1)![1]) < 0.01;
          let ringLen = 0;
          for (let i = 1; i < own.path.length; i++) ringLen += Math.hypot(own.path[i][0] - own.path[i - 1][0], own.path[i][1] - own.path[i - 1][1]);
          const ox = own.x0 ?? 0;
          const wrap = (v: number) => (ring && ringLen > 0 ? ox + ((((v - ox) % ringLen) + ringLen) % ringLen) : v);
          const src: V3[] = [],
            dst: V3[] = [];
          const x0 = l.rel.bend!.x0 ?? 0;
          let along = x0;
          for (let i = 0; i < path.length; i++) {
            if (i) along += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
            // Point on this joint's edge line, in world coordinates of the strip, then along the strip as placed
            const w = { x: l.edge.a.x + l.edge.dir.x * along, y: l.edge.a.y + l.edge.dir.y * along };
            const f = apply(to, w.x, w.y);
            dst.push(bentPoint(px, wrap(f.x), f.y, l.th / 2, l.th));
            src.push([path[i][0], path[i][1], l.rel.o[2]]);
          }
          // Into the strip's material from this joint's edge, in space
          const e0 = { x: l.edge.a.x + l.edge.dir.x * x0, y: l.edge.a.y + l.edge.dir.y * x0 };
          const f0 = apply(to, e0.x, e0.y),
            f1 = apply(to, e0.x + l.edge.in.x, e0.y + l.edge.in.y);
          const up = sub3(bentPoint(px, wrap(f1.x), f1.y, l.th / 2, l.th), bentPoint(px, wrap(f0.x), f0.y, l.th / 2, l.th));
          const pose = rigidFit(src, dst, up);
          if (!pose) continue;
          poses.set(l.C, pose);
          thick.set(l.C, l.th);
          queue.push(l.C);
        }
      }
    }
  }
  const solids: Solid[] = [];
  for (const [id, pose] of poses) {
    const p = byId.get(id)!;
    const th = thick.get(id) ?? fallbackTh;
    const fr = frames.get(id);
    if (!fr) {
      solids.push({ key: String(id), label: p.label, polys: p.polys, pose, th });
      continue;
    }
    let polys = p.polys.map((poly) => poly.map((q) => apply(fr, q.x, q.y)));
    // A strip longer than its ring would go on straight past its own start, through the plate; that end gets cut
    // off, so it is left out here
    const b = pose.bend!;
    const ring = Math.hypot(b.path[0][0] - b.path.at(-1)![0], b.path[0][1] - b.path.at(-1)![1]) < 0.01;
    if (ring) {
      let len = 0;
      for (let i = 1; i < b.path.length; i++) len += Math.hypot(b.path[i][0] - b.path[i - 1][0], b.path[i][1] - b.path[i - 1][1]);
      const x1 = (b.x0 ?? 0) + len + 0.01;
      const ys = polys.flat().map((q) => q.y);
      const xs = polys.flat().map((q) => q.x);
      if (Math.max(...xs) > x1) {
        const box = [[Math.min(...xs) - 1, Math.min(...ys) - 1], [x1, Math.min(...ys) - 1], [x1, Math.max(...ys) + 1], [Math.min(...xs) - 1, Math.max(...ys) + 1]].map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
        const subj = polys.map((poly) => poly.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
        polys = execute(ClipperLib.ClipType.ctIntersection, subj, [box], ClipperLib.PolyFillType.pftEvenOdd)
          .filter((q) => q.length > 2)
          .map((q) => q.map((r) => ({ x: r.X / SCALE, y: r.Y / SCALE })));
      }
    }
    // Curved fingers are fitted within 0.01 mm on both parts: up to 0.03 mm along the strip counts as touching
    solids.push(...bentSolids({ key: String(id), label: p.label, polys, pose, th, tol: 0.03 }));
  }
  return { solids, groups, placed: new Set(poses.keys()), frames };
}
