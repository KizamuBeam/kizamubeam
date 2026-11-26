// Anbindung an PlaneGCS (Löser aus FreeCAD, als WebAssembly; LGPL-2.0-or-later): Skizze → Primitive → Lösung.
// Der Löser wird beim ersten Gebrauch geladen (loadSolver). Danach läuft solveSketch synchron.
import { GcsWrapper, init_planegcs_module, SolveStatus } from '@salusoft89/planegcs';
import { entOf, entPoints, isConstructionGeometry, ptOf, Sketch, SkCon, SkEnt, validCircleDiameter } from './model';
import { sketchSlots } from './slot';
import { cornerCrossesOutline, sketchEdgeIntersections } from './trimSpans';
import { isConvexPolygonBranch } from './polygon';
import { matchesSmoothOffset } from './smoothOffset';

type Module = Awaited<ReturnType<typeof init_planegcs_module>>;
type Prim = Record<string, unknown> & { id: string; type: string };

let wasmUrl: string | undefined;
let mod: Module | null = null;
let loading: Promise<Module> | null = null;

/** Adresse der .wasm-Datei (im Browser von Vite geliefert, in Tests ein Dateipfad) */
export function setSolverWasm(url: string) {
  wasmUrl = url;
}
export const solverReady = () => !!mod;

export function loadSolver(): Promise<void> {
  const l = (loading ??= init_planegcs_module(wasmUrl ? { locateFile: () => wasmUrl! } : undefined).then((m: Module) => (mod = m)));
  return l.then(() => undefined);
}

export interface SolveResult {
  inputIssues?: { kind: 'formula' | 'geometry'; id: number; message: string }[];
  ok: boolean;
  invalidGeometry?: boolean;
  /** Freiheitsgrade (0 = voll bestimmt) */
  dof: number;
  /** Beziehungen, die sich widersprechen bzw. überzählig sind (ids der Skizze) */
  conflicting: number[];
  redundant: number[];
  /** Geometry IDs classified from the local rank of the solved equations. Missing IDs are unclassified. */
  definition?: Map<number, 'fixed' | 'free'>;
}

const P = (id: number) => `p${id}`;
const E = (id: number) => `e${id}`;
const C = (id: number, suffix = '') => `c${id}${suffix}`;
const idOf = (s: string) => parseInt(s.slice(1), 10);

function geometryDefinition(sk: Sketch, dof: number) {
  const states = new Map<number, 'fixed' | 'free'>();
  if (dof === 0) {
    for (const item of [...sk.pts, ...sk.ents]) states.set(item.id, 'fixed');
    return states;
  }
  // A lock at the current solution removes a degree of freedom only if that coordinate can move.
  // Group actual solver primitives (including generated helpers) to avoid probing unrelated geometry.
  const primitives = toPrimitives(sk), index = new Map(primitives.map((p, i) => [p.id, i]));
  const parents = primitives.map((_, i) => i);
  const root = (i: number) => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  };
  const connect = (i: number, value: unknown) => {
    if (typeof value === 'string') {
      const j = index.get(value);
      if (j !== undefined) parents[root(i)] = root(j);
    } else if (value && typeof value === 'object') for (const part of Object.values(value)) connect(i, part);
  };
  primitives.forEach((p, i) => Object.values(p).forEach((v) => connect(i, v)));
  const components = new Map<number, Prim[]>();
  primitives.forEach((p, i) => {
    const r = root(i), component = components.get(r);
    if (component) component.push(p);
    else components.set(r, [p]);
  });
  const ranks = new Map<number, number | undefined>();
  let budget = 24000;
  const rank = (component: Prim[], locks: Prim[]) => {
    budget -= component.length + locks.length;
    const g = new GcsWrapper(new mod!.GcsSystem());
    g.debug_mode = 0;
    try {
      g.push_primitives_and_params([...component, ...locks] as never);
      const status = g.solve();
      const n = g.gcs.dof();
      if (!g.has_gcs_conflicting_constraints() && n >= 0 && (status === SolveStatus.Success || status === SolveStatus.Converged || g.has_gcs_redundant_constraints() || g.has_gcs_partially_redundant_constraints())) return n;
    } catch {
      // A failed diagnostic probe must not prevent editing an otherwise valid sketch.
      return undefined;
    } finally { g.destroy_gcs_module(); }
  };
  const classify = (id: number, primitive: string, locks: Prim[]) => {
    const i = index.get(primitive);
    if (i === undefined) return;
    const r = root(i), component = components.get(r)!;
    if (component.every((p) => p.type === 'point' || p.type === 'circle' || p.type === 'line')) { states.set(id, 'free'); return; }
    if (!ranks.has(r) && budget >= component.length) ranks.set(r, rank(component, []));
    const before = ranks.get(r);
    if (before === undefined) return;
    if (before === 0) { states.set(id, 'fixed'); return; }
    if (budget < component.length + locks.length) return;
    const after = rank(component, locks);
    if (after !== undefined && after <= before) states.set(id, after < before ? 'free' : 'fixed');
  };
  for (const p of sk.pts) classify(p.id, P(p.id), [
    { id: 'probeX', type: 'coordinate_x', p_id: P(p.id), x: p.x },
    { id: 'probeY', type: 'coordinate_y', p_id: P(p.id), y: p.y },
  ]);
  for (const e of sk.ents) {
    // Punkt-Elemente haben kein eigenes Primitiv: Zustand des referenzierten (freien) Teilchens übernehmen.
    if (e.t === 'point') {
      const st = states.get(entPoints(e)[0]);
      if (st) states.set(e.id, st);
      continue;
    }
    const pointStates = entPoints(e).map((id) => states.get(id));
    if (pointStates.includes('free')) states.set(e.id, 'free');
    else if (pointStates.every((s) => s === 'fixed')) {
      // Ellipsen haben kein Primitiv zum Sondieren: wie Linien fixiert, sobald alle Punkte stehen.
      if (e.t === 'line' || e.t === 'ellipse') states.set(e.id, 'fixed');
      else classify(e.id, E(e.id), [e.t === 'circle'
        ? { id: 'probeR', type: 'circle_radius', c_id: E(e.id), radius: e.r }
        : { id: 'probeR', type: 'arc_radius', a_id: E(e.id), radius: e.r }]);
    }
  }
  return states;
}

/** Primitive für PlaneGCS; drag hält einen Punkt an der gegebenen Stelle fest (Ziehen) */
export function toPrimitives(sk: Sketch, drag?: { pt: number; x: number; y: number }): Prim[] {
  const out: Prim[] = [];
  for (const p of sk.pts) {
    const d = drag && drag.pt === p.id;
    out.push({ id: P(p.id), type: 'point', x: d ? drag!.x : p.x, y: d ? drag!.y : p.y, fixed: !!d });
  }
  for (const e of sk.ents) {
    if (e.t === 'line') out.push({ id: E(e.id), type: 'line', p1_id: P(e.a), p2_id: P(e.b) });
    else if (e.t === 'circle') out.push({ id: E(e.id), type: 'circle', c_id: P(e.c), radius: e.r });
    // Punkte brauchen kein eigenes Primitiv: Der referenzierte Skizzenpunkt ist bereits als
    // freier 2-DOF-Teilchen registriert (ohne Umbau); das Element spiegelt nur dessen Zustand.
    // Abweichung: Ein Punkt-Element fügt dem Gleichungssystem keine Bedingungen hinzu.
    else if (e.t === 'arc') {
      out.push({ id: E(e.id), type: 'arc', c_id: P(e.c), start_id: P(e.s), end_id: P(e.e), radius: e.r, start_angle: e.a0, end_angle: e.a1 });
      if (!sk.cons.some((c) => c.t === 'arcSpan' && c.r[0] === e.id && entOf(sk, c.r[1])?.t === 'arc')) out.push({ id: `r${e.id}`, type: 'arc_rules', a_id: E(e.id) });
    }
    // Ellipsen stellen bewusst kein Primitiv (Paket D, starre Form): PlaneGCS kennt nur die
    // Fokus-Form { c_id, focus1_id, radmin }, nicht { Mitte, Hauptachsen-Ende, Nebenradius }.
    // Ohne Umbau von Parametrierung, Beziehungen und Rückschreibung nicht abbildbar — die Punkte
    // c/m nehmen als freie Teilchen teil (Ziehen, starres Verschieben), r schreibt nur der Dialog.
  }
  for (const c of sk.cons) out.push(...conPrims(sk, c));
  return out;
}

const isRound = (e: SkEnt | undefined): e is SkEnt & { t: 'circle' | 'arc' } => !!e && (e.t === 'circle' || e.t === 'arc');

function conPrims(sk: Sketch, c: SkCon): Prim[] {
  // Referenzmaß: misst nur, treibt nichts (wird nach dem Lösen aus der Geometrie gelesen)
  if (c.driven) return [];
  const id = C(c.id);
  const r = c.r;
  const ent = (i: number) => entOf(sk, r[i]);
  const v = c.v ?? 0;
  switch (c.t) {
    case 'arcSpan': {
      const child = ent(0), source = ent(1), joint = r[2];
      if (child?.t !== 'arc' || source?.t !== 'arc' || !(v > 0 && v < 1)) return [];
      const first = child.e === joint;
      const shared = first ? 'end_angle' : 'start_angle', outer = first ? 'start_angle' : 'end_angle';
      const ref = (o_id: string, prop: string) => ({ o_id, prop });
      const a = E(source.id), b = E(child.id), delta = `sd${c.id}`, start = `so${c.id}`, ratio = `sf${c.id}`, line = `sl${c.id}`;
      const owner = sk.cons.find((x) => x.t === 'arcSpan' && x.r[1] === source.id && x.r[2] === joint && entOf(sk, x.r[0])?.t === 'arc');
      const result: Prim[] = [
        { id: C(c.id, 'r'), type: 'equal', param1: ref(a, 'radius'), param2: ref(b, 'radius') },
        { id: C(c.id, 'e'), type: 'equal', param1: ref(a, outer), param2: ref(b, outer) },
      ];
      if (owner && owner.id !== c.id) {
        const other = entOf(sk, owner.r[0]);
        if (other?.t === 'arc') result.push({ id: C(c.id, 'j'), type: 'equal', param1: ref(E(other.id), other.e === joint ? 'end_angle' : 'start_angle'), param2: ref(b, shared) });
        return result;
      }
      return [...result,
        { id: delta, type: 'point', x: v * (source.a1 - source.a0), y: source.a1 - source.a0 },
        { id: start, type: 'point', x: 0, y: 0, fixed: true },
        { id: ratio, type: 'point', x: v, y: 1, fixed: true },
        { id: line, type: 'line', p1_id: start, p2_id: ratio },
        { id: C(c.id, 'x'), type: 'difference', param1: ref(a, 'start_angle'), param2: ref(b, shared), difference: ref(delta, 'x') },
        { id: C(c.id, 'y'), type: 'difference', param1: ref(a, 'start_angle'), param2: ref(a, 'end_angle'), difference: ref(delta, 'y') },
        { id: C(c.id, 'l'), type: 'point_on_line_pl', p_id: delta, l_id: line },
        { id: C(c.id, 'p'), type: 'curve_value', p_id: P(joint), a_id: a, u: ref(b, shared) },
      ];
    }
    case 'coincident':
      return [{ id, type: 'p2p_coincident', p1_id: P(r[0]), p2_id: P(r[1]) }];
    case 'horizontal':
    case 'vertical': {
      const h = c.t === 'horizontal';
      if (r.length === 1) return [{ id, type: h ? 'horizontal_l' : 'vertical_l', l_id: E(r[0]) }];
      return [{ id, type: h ? 'horizontal_pp' : 'vertical_pp', p1_id: P(r[0]), p2_id: P(r[1]) }];
    }
    case 'parallel':
      return [{ id, type: 'parallel', l1_id: E(r[0]), l2_id: E(r[1]) }];
    case 'perpendicular':
      return [{ id, type: 'perpendicular_ll', l1_id: E(r[0]), l2_id: E(r[1]) }];
    case 'equal': {
      const a = ent(0),
        b = ent(1);
      if (a?.t === 'line' && b?.t === 'line') return [{ id, type: 'equal_length', l1_id: E(a.id), l2_id: E(b.id) }];
      if (a?.t === 'circle' && b?.t === 'circle') return [{ id, type: 'equal_radius_cc', c1_id: E(a.id), c2_id: E(b.id) }];
      if (a?.t === 'arc' && b?.t === 'arc') return [{ id, type: 'equal_radius_aa', a1_id: E(a.id), a2_id: E(b.id) }];
      if (a?.t === 'circle' && b?.t === 'arc') return [{ id, type: 'equal_radius_ca', c1_id: E(a.id), a2_id: E(b.id) }];
      if (a?.t === 'arc' && b?.t === 'circle') return [{ id, type: 'equal_radius_ca', c1_id: E(b.id), a2_id: E(a.id) }];
      return [];
    }
    case 'fixed':
      return [
        { id: C(c.id, 'x'), type: 'coordinate_x', p_id: P(r[0]), x: c.x ?? ptOf(sk, r[0])?.x ?? 0 },
        { id: C(c.id, 'y'), type: 'coordinate_y', p_id: P(r[0]), y: c.y ?? ptOf(sk, r[0])?.y ?? 0 },
      ];
    case 'intersection': return [1, 2].flatMap((i): Prim[] => {
      const e = ent(i), id = C(c.id, i === 1 ? 'a' : 'b'), p_id = P(r[0]);
      if (!e) return [];
      if (e.t === 'line') return [{ id, p_id, type: 'point_on_line_pl', l_id: E(e.id) }];
      if (e.t === 'arc') return [{ id, p_id, type: 'point_on_arc', a_id: E(e.id) }];
      return [{ id, p_id, type: 'point_on_circle', c_id: E(e.id) }];
    });
    case 'pointOnLine':
      return [{ id, type: 'point_on_line_pl', p_id: P(r[0]), l_id: E(r[1]) }];
    case 'pointOnCircle': {
      const e = ent(1);
      // Ellipsen haben kein Solver-Primitiv (Paket D): keine Bindung abbilden, auch aus Altdateien nicht.
      if (!e || (e.t !== 'circle' && e.t !== 'arc')) return [];
      return e.t === 'arc' ? [{ id, type: 'point_on_arc', p_id: P(r[0]), a_id: E(r[1]) }] : [{ id, type: 'point_on_circle', p_id: P(r[0]), c_id: E(r[1]) }];
    }
    case 'midpoint': {
      const l = ent(1);
      if (l?.t !== 'line') return [];
      return [{ id, type: 'p2p_symmetric_ppp', p1_id: P(l.a), p2_id: P(l.b), p_id: P(r[0]) }];
    }
    case 'segmentFraction': {
      const l = ent(1), p = ptOf(sk, r[0]);
      if (l?.t !== 'line' || !p || !(v > 0 && v < 1)) return [];
      const a = ptOf(sk, l.a), b = ptOf(sk, l.b);
      if (!a || !b) return [];
      // Similar triangles on a normal to AB give AP/AB = AV/AU. Solver-only geometry
      // avoids selection clutter and remains well-conditioned for any direction of AB.
      const span = `fs${c.id}`, part = `fp${c.id}`;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(length > 1e-6)) return [];
      const normal = { x: -(b.y - a.y), y: b.x - a.x };
      const [ab, au, ub, vp] = ['ab', 'au', 'ub', 'vp'].map((suffix) => `fl${c.id}${suffix}`);
      return [
        { id: span, type: 'point', x: a.x + normal.x, y: a.y + normal.y },
        { id: part, type: 'point', x: a.x + normal.x * v, y: a.y + normal.y * v },
        { id: ab, type: 'line', p1_id: P(l.a), p2_id: P(l.b) },
        { id: au, type: 'line', p1_id: P(l.a), p2_id: span },
        { id: ub, type: 'line', p1_id: span, p2_id: P(l.b) },
        { id: vp, type: 'line', p1_id: part, p2_id: P(p.id) },
        { id: C(c.id, 'n'), type: 'perpendicular_ll', l1_id: ab, l2_id: au },
        { id: C(c.id, 'u'), type: 'p2p_distance', p1_id: P(l.a), p2_id: span, distance: length },
        { id: C(c.id, 'v'), type: 'p2p_distance', p1_id: P(l.a), p2_id: part, distance: length * v },
        { id: C(c.id, 'av'), type: 'point_on_line_pl', p_id: part, l_id: au },
        { id: C(c.id, 'ap'), type: 'point_on_line_pl', p_id: P(p.id), l_id: ab },
        { id: C(c.id, 'par'), type: 'parallel', l1_id: ub, l2_id: vp },
      ];
    }
    case 'symmetric':
      return [{ id, type: 'p2p_symmetric_ppl', p1_id: P(r[0]), p2_id: P(r[1]), l_id: E(r[2]) }];
    case 'tangent': {
      const a = ent(0),
        b = ent(1);
      // Ellipsen haben kein Solver-Primitiv (Paket D): keine Tangenten-Bindung abbilden.
      if (!a || !b || a.t === 'ellipse' || b.t === 'ellipse') return [];
      const line = a.t === 'line' ? a : b.t === 'line' ? b : null;
      const other = line === a ? b : a;
      if (line && other.t === 'circle') return [{ id, type: 'tangent_lc', l_id: E(line.id), c_id: E(other.id) }];
      if (line && other.t === 'arc') return [{ id, type: 'tangent_la', l_id: E(line.id), a_id: E(other.id) }];
      if (a.t === 'circle' && b.t === 'circle') return [{ id, type: 'tangent_cc', c1_id: E(a.id), c2_id: E(b.id) }];
      if (a.t === 'arc' && b.t === 'arc') return [{ id, type: 'tangent_aa', a1_id: E(a.id), a2_id: E(b.id) }];
      const circ = a.t === 'circle' ? a : b,
        arc = a.t === 'arc' ? a : b;
      return [{ id, type: 'tangent_ca', c_id: E(circ.id), a_id: E(arc.id) }];
    }
    case 'concentric': {
      const a = ent(0),
        b = ent(1);
      if (!isRound(a) || !isRound(b)) return [];
      return [{ id, type: 'p2p_coincident', p1_id: P(a.c), p2_id: P(b.c) }];
    }
    case 'distance': {
      if (r.length === 1) {
        const l = ent(0);
        if (l?.t !== 'line') return [];
        return [{ id, type: 'p2p_distance', p1_id: P(l.a), p2_id: P(l.b), distance: v }];
      }
      if (entOf(sk, r[1])?.t === 'line') return [{ id, type: 'p2l_distance', p_id: P(r[0]), l_id: E(r[1]), distance: v }];
      if (ptOf(sk, r[0]) && ptOf(sk, r[1])) return [{ id, type: 'p2p_distance', p1_id: P(r[0]), p2_id: P(r[1]), distance: v }];
      // Kante-zu-Kante: Lücke zum Kreisrand. Berührung (v = 0) ist exakt (Tangente/Punkt auf Kreis);
      // sonst Abstand der Bezugspunkte mit dem aktuellen Radius als Stand (exakt bei festem Radius).
      const E_ = (i: number) => entOf(sk, r[i]);
      const line = E_(0)?.t === 'line' ? E_(0)! : E_(1)?.t === 'line' ? E_(1)! : undefined;
      const circ = (e: SkEnt | undefined) => (e?.t === 'circle' ? e : undefined);
      const cA = circ(E_(0)), cB = circ(E_(1));
      if (cA && cB) {
        if (v === 0) {
          const a = ptOf(sk, cA.c)!, b = ptOf(sk, cB.c)!;
          if (Math.hypot(b.x - a.x, b.y - a.y) >= Math.max(cA.r, cB.r)) return [{ id, type: 'tangent_cc', c1_id: E(cA.id), c2_id: E(cB.id) }];
        }
        const a = ptOf(sk, cA.c)!, b = ptOf(sk, cB.c)!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const [lo, hi] = cA.r <= cB.r ? [cA.r, cB.r] : [cB.r, cA.r];
        const target = d + lo <= hi ? hi - lo - v : cA.r + cB.r + v;
        return [{ id, type: 'p2p_distance', p1_id: P(cA.c), p2_id: P(cB.c), distance: target }];
      }
      if (line && (cA ?? cB)) {
        const cc = (cA ?? cB)!;
        if (v === 0) return [{ id, type: 'tangent_lc', l_id: E(line.id), c_id: E(cc.id) }];
        return [{ id, type: 'p2l_distance', p_id: P(cc.c), l_id: E(line.id), distance: v + cc.r }];
      }
      {
        const p = ptOf(sk, r[0]) ? r[0] : ptOf(sk, r[1]) ? r[1] : undefined;
        const cc = ptOf(sk, r[0]) ? cB : cA;
        if (p !== undefined && cc) {
          if (v === 0) return [{ id, type: 'point_on_circle', p_id: P(p), c_id: E(cc.id) }];
          return [{ id, type: 'p2p_distance', p1_id: P(p), p2_id: P(cc.c), distance: v + cc.r }];
        }
      }
      return [];
    }
    case 'radialOffset': {
      const a = ent(0), b = ent(1);
      if (a?.t !== 'circle' || b?.t !== 'circle') return [];
      return [{ id, type: 'difference', param1: { o_id: E(a.id), prop: 'radius' }, param2: { o_id: E(b.id), prop: 'radius' }, difference: v }];
    }
    case 'hdistance':
    case 'vdistance': {
      let a = r[0],
        b = r[1];
      if (r.length === 1) {
        const l = ent(0);
        if (l?.t !== 'line') return [];
        a = l.a;
        b = l.b;
      }
      const pa = ptOf(sk, a),
        pb = ptOf(sk, b);
      if (!pa || !pb) return [];
      const prop = c.t === 'hdistance' ? 'x' : 'y';
      // Vorzeichen wie in der aktuellen Lage, damit die Teile nicht umklappen
      const sign = (pb[prop] - pa[prop]) < 0 ? -1 : 1;
      return [{ id, type: 'difference', param1: { o_id: P(a), prop }, param2: { o_id: P(b), prop }, difference: sign * v }];
    }
    case 'angle': {
      const l1 = ent(0),
        l2 = ent(1);
      if (l1?.t !== 'line' || l2?.t !== 'line') return [];
      const signed = signedLineAngle(sk, l1, l2);
      const rad = (v * Math.PI) / 180;
      return [{ id, type: 'l2l_angle_ll', l1_id: E(l1.id), l2_id: E(l2.id), angle: signed < 0 ? -rad : rad }];
    }
    case 'radius':
    case 'diameter': {
      const e = ent(0);
      if (!isRound(e)) return [];
      const rad = c.t === 'radius' ? v : v / 2;
      return [e.t === 'circle' ? { id, type: 'circle_radius', c_id: E(e.id), radius: rad } : { id, type: 'arc_radius', a_id: E(e.id), radius: rad }];
    }
    case 'arcLength': {
      const e = ent(0);
      if (e?.t !== 'arc') return [];
      return [{ id, type: 'arc_length', a_id: E(e.id), dist: v }];
    }
  }
}

function signedLineAngle(sk: Sketch, l1: SkEnt & { t: 'line' }, l2: SkEnt & { t: 'line' }): number {
  const a1 = ptOf(sk, l1.a)!,
    b1 = ptOf(sk, l1.b)!,
    a2 = ptOf(sk, l2.a)!,
    b2 = ptOf(sk, l2.b)!;
  let d = Math.atan2(b2.y - a2.y, b2.x - a2.x) - Math.atan2(b1.y - a1.y, b1.x - a1.x);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/**
 * Skizze lösen. Bei Erfolg werden Punkte, Radien und Bogenwinkel übernommen; sonst bleibt die Skizze, wie sie ist.
 * drag: Punkt, der beim Ziehen an der Mausposition festgehalten wird.
 */
export function solveSketch(sk: Sketch, opt: { drag?: { pt: number; x: number; y: number }; definition?: boolean } = {}): SolveResult {
  if (!mod) throw new Error('Löser nicht geladen (loadSolver)');
  const g = new GcsWrapper(new mod.GcsSystem());
  g.debug_mode = 0;
  try {
    g.push_primitives_and_params(toPrimitives(sk, opt.drag) as never);
    let status = g.solve();
    if (status !== SolveStatus.Success) status = g.solve(1 as never); // zweiter Versuch mit Levenberg-Marquardt
    const conflicting = [...new Set(g.get_gcs_conflicting_constraints().map(idOf))];
    const redundant = [...new Set(g.get_gcs_redundant_constraints().map(idOf))];
    const dof = g.gcs.dof();
    const ok = (status === SolveStatus.Success || status === SolveStatus.Converged) && !conflicting.length;
    if (ok) {
      g.apply_solution();
      const prims = g.sketch_index.get_primitives() as unknown as Prim[];
      const byId = new Map(prims.map((p) => [p.id, p]));
      for (const c of sk.cons) if (c.t === 'arcSpan') {
        const [childId, sourceId, joint] = c.r;
        const child = entOf(sk, childId), source = byId.get(E(sourceId)), part = byId.get(E(childId));
        if (child?.t !== 'arc' || !source || !part) continue;
        const a = Number(source.start_angle), b = Number(source.end_angle), r = Number(source.radius), f = c.v ?? NaN;
        const split = a + f * (b - a), first = child.e === joint;
        const start = first ? a : split, end = first ? split : b;
        if ((!child.aux && !entOf(sk, sourceId)?.aux) || !(f > 0 && f < 1 && r > 1e-6 && b - a < 2 * Math.PI && (end - start) * r > 1e-6
          && Math.abs(Number(part.start_angle) - start) < 1e-7 && Math.abs(Number(part.end_angle) - end) < 1e-7)) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [c.id], redundant };
        }
      }
      const point = (id: number) => ({ x: Number(byId.get(P(id))?.x), y: Number(byId.get(P(id))?.y) });
      const invalid = (ids: number[]): SolveResult => ({ ok: false, invalidGeometry: true, dof, conflicting: ids, redundant });
      for (const e of sk.ents) if (!isConstructionGeometry(e) && e.t !== 'point') {
        const ids = [e.id, ...entPoints(e)], refs = () => sk.cons.filter((c) => c.r.some((id) => ids.includes(id))).map((c) => c.id);
        if (e.t === 'line') {
          const a = point(e.a), b = point(e.b);
          if (!(Math.hypot(a.x - b.x, a.y - b.y) > 1e-6)) return invalid(refs());
        } else if (e.t === 'circle' || e.t === 'arc') {
          const q = byId.get(E(e.id)), r = Math.abs(Number(q?.radius));
          if (!validCircleDiameter(point(e.c), r * 2)) return invalid(refs());
          if (e.t === 'arc') {
            const span = Number(q?.end_angle) - Number(q?.start_angle), turn = 2 * Math.PI;
            const sweep = ((span % turn) + turn) % turn;
            if (!(sweep * r > 1e-6 && (turn - sweep) * r > 1e-6)) return invalid(refs());
          }
        }
      }
      for (const slot of sketchSlots(sk)) {
        if (slot.sides.length === 2) {
          const [s1, s2] = slot.sides;
          if (s1.t === 'arc' && s2.t === 'arc') {
            // Bogenslot (Paket 3): konzentrische Seiten im Breitenabstand, halbrunde
            // Kappen, jede Seite an beiden Kappen tangent gesichert.
            const solvedR = (id: number) => Math.abs(Number(byId.get(E(id))?.radius));
            const rHi = Math.max(solvedR(s1.id), solvedR(s2.id)), rLo = Math.min(solvedR(s1.id), solvedR(s2.id));
            // Fugensicherung: je Seite zwei Tangenten zu trimSupport-Hilfslinien.
            const trimTangents = (side: number) => sk.cons.filter((c) => {
              if (c.t !== 'tangent' || !c.r.includes(side) || c.r.length !== 2) return false;
              const other = sk.ents.find((e) => e.id === c.r.find((id) => id !== side));
              return other?.t === 'line' && !!other.trimSupport;
            }).length;
            const sweepOf = (id: number) => {
              const q = byId.get(E(id));
              return Number(q?.end_angle) - Number(q?.start_angle);
            };
            const capsRound = [slot.left, slot.right].every((cap) => {
              const sweep = ((sweepOf(cap.id) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
              return Math.abs(sweep - Math.PI) < 1e-5;
            });
            if (!(s1.c === s2.c && Math.abs(rHi - rLo - slot.breadth) < 1e-6
              && Math.abs(solvedR(slot.left.id) - solvedR(slot.right.id)) < 1e-6
              && Math.abs(solvedR(slot.left.id) * 2 - slot.breadth) < 1e-6 && capsRound
              && trimTangents(s1.id) >= 2 && trimTangents(s2.id) >= 2)) {
              return invalid([slot.width.id]);
            }
            continue;
          }
        }
        const a = point(slot.left.c), b = point(slot.right.c), l = Math.hypot(a.x - b.x, a.y - b.y);
        const r1 = Math.abs(Number(byId.get(E(slot.left.id))?.radius)), r2 = Math.abs(Number(byId.get(E(slot.right.id))?.radius));
        const sideOK = slot.sides.every((s) => s.t === 'line' && Math.abs(Math.hypot(point(s.a).x - point(s.b).x, point(s.a).y - point(s.b).y) - l) < 2e-6);
        const outward = (arc: typeof slot.left, center: typeof a, sign: number) => {
          const q = point(arc.s);
          const arcPrim = byId.get(E(arc.id)), span = Number(arcPrim?.end_angle) - Number(arcPrim?.start_angle);
          return Math.abs(Math.abs(span % (2 * Math.PI)) - Math.PI) < 1e-5 && ((b.x - a.x) * (q.y - center.y) - (b.y - a.y) * (q.x - center.x)) * sign > r1 * l * 0.99;
        };
        if (!(l > 1e-6 && Math.abs(r1 - r2) < 2e-6 && sideOK && outward(slot.left, a, 1) && outward(slot.right, b, -1))) {
          return invalid([slot.width.id, ...(slot.distance ? [slot.distance.id] : [])]);
        }
      }
      for (const axis of sk.ents) {
        if (axis.t !== 'line' || !Array.isArray(axis.slotCaps) || axis.slotCaps.length !== 2) continue;
        const [left, right] = axis.slotCaps.map((id) => entOf(sk, id));
        if (left?.t !== 'arc' || right?.t !== 'arc') continue;
        const a = point(axis.a), b = point(axis.b), dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
        const outward = (arc: typeof left, center: typeof a, sign: number) => {
          const start = point(arc.s), end = point(arc.e), q = byId.get(E(arc.id));
          const r = Math.abs(Number(q?.radius)), angle = Number(q?.end_angle) - Number(q?.start_angle);
          const sweep = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          return r > 1e-7 && Math.abs(sweep - Math.PI) < 1e-5
            && ((start.y - center.y) * dx - (start.x - center.x) * dy) * sign > r * l * 0.99
            && ((end.y - center.y) * dx - (end.x - center.x) * dy) * sign < -r * l * 0.99;
        };
        if (!(l > 1e-6 && outward(left, a, 1) && outward(right, b, -1))) {
          return { ok: false, invalidGeometry: true, dof, conflicting: sk.cons.filter((c) => c.r.includes(axis.id) || c.r.includes(left.id)).map((c) => c.id), redundant };
        }
      }
      for (const c of sk.cons) {
        if (c.t !== 'segmentFraction') continue;
        const line = entOf(sk, c.r[1]), f = c.v ?? NaN;
        if (line?.t !== 'line') continue;
        const a = point(line.a), b = point(line.b), p = point(c.r[0]);
        const dx = b.x - a.x, dy = b.y - a.y;
        if (!(f > 0 && f < 1 && Math.hypot(dx, dy) * Math.min(f, 1 - f) > 1e-6
          && Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f) < 1e-6)) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [c.id], redundant };
        }
      }
      const relationIds = new Set(sk.cons.map((c) => c.id));
      for (const e of sk.ents) {
        if (e.t !== 'circle' || !Array.isArray(e.polygon?.vertices) || !Array.isArray(e.polygon.relations)
          || !e.polygon.relations.every((id) => relationIds.has(id))) continue;
        if (!isConvexPolygonBranch(point(e.c), e.polygon.vertices.map(point))) {
          return { ok: false, invalidGeometry: true, dof, conflicting: e.polygon.relations, redundant };
        }
      }
      const cornerEdges = sk.ents.filter((e) => e.cornerBounds);
      const radiusLinks = new Map(sk.cons.filter((c) => c.t === 'equal').map((c) => [c.id, c]));
      const gridEdges = new Map<number, number>();
      for (const e of sk.ents) {
        const link = e.patternRadius !== undefined ? radiusLinks.get(e.patternRadius) : undefined;
        if (link && link.r[1] === e.id) for (const id of link.r) gridEdges.set(id, link.id);
      }
      const offsets = sk.cons.filter((c) => c.t === 'radialOffset');
      const smoothOffsets = sk.ents.filter((e) => e.smoothOffset);
      const crossings = sk.cons.filter((c) => c.t === 'intersection');
      const geometry: Sketch | undefined = cornerEdges.length || gridEdges.size || offsets.length || smoothOffsets.length || crossings.length ? {
        ...sk,
        pts: sk.pts.map((p) => {
          const q = byId.get(P(p.id));
          return q ? { ...p, x: Number(q.x), y: Number(q.y) } : p;
        }),
        ents: sk.ents.map((e) => {
          const q = byId.get(E(e.id));
          if (!q || e.t === 'line') return e;
          const r = Math.abs(Number(q.radius));
          if (e.t === 'circle') return { ...e, r };
          const a0 = Number(q.start_angle);
          let sweep = (Number(q.end_angle) - a0) % (2 * Math.PI);
          if (sweep <= 0) sweep += 2 * Math.PI;
          return { ...e, r, a0, a1: a0 + sweep };
        }),
      } : undefined;
      for (const c of crossings) {
        const g = geometry!, p = ptOf(g, c.r[0]), a = entOf(g, c.r[1]), b = entOf(g, c.r[2]);
        if (!p || !a || !b || !sketchEdgeIntersections(g, a, b).some((q) => q.branch === c.v && Math.hypot(p.x - q.x, p.y - q.y) < 2e-6)) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [c.id], redundant };
        }
      }
      const constraints = smoothOffsets.length ? new Map(sk.cons.map((c) => [c.id, c])) : undefined;
      for (const edge of smoothOffsets) {
        const link = edge.smoothOffset!, result = entOf(geometry!, edge.id)!;
        const value = constraints?.get(link.dimension)?.v;
        const active = Array.isArray(link.relations) && link.relations.every((id) => relationIds.has(id)) && entOf(geometry!, link.source);
        if ((active && (!(value! >= 1e-6) || !matchesSmoothOffset(geometry!, result, value!))) || (!edge.aux && cornerCrossesOutline(geometry!, result))) {
          return { ok: false, invalidGeometry: true, dof, conflicting: value === undefined ? [] : [link.dimension], redundant };
        }
      }
      for (const c of offsets) {
        const a = byId.get(E(c.r[0])), b = byId.get(E(c.r[1]));
        const source = Number(a?.radius), radius = Number(b?.radius), expected = c.v ?? 0;
        const result = entOf(geometry!, c.r[1]);
        if (!(source > 1e-6 && radius > 1e-6 && Math.abs(expected) > 1e-6 && Math.abs(radius - source - expected) < 1e-5)
          || (result && !result.aux && cornerCrossesOutline(geometry!, result))) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [c.id], redundant };
        }
      }
      for (const [id, relation] of gridEdges) {
        const e = entOf(geometry!, id);
        if (e?.t === 'circle' && !e.aux && cornerCrossesOutline(geometry!, e)) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [relation], redundant };
        }
      }
      for (const e of cornerEdges) {
        const guard = e.cornerBounds!;
        const valid = guard.rays.every(([a, b, c]) => {
          const p = byId.get(P(a)), q = byId.get(P(b)), r = byId.get(P(c));
          if (!p || !q || !r) return true;
          const dx = Number(q.x) - Number(p.x), dy = Number(q.y) - Number(p.y);
          const l = Math.hypot(dx, dy);
          const along = ((Number(r.x) - Number(p.x)) * dx + (Number(r.y) - Number(p.y)) * dy) / l;
          return along > 1e-6 && l - along > 1e-6;
        });
        const arc = e.t === 'arc' ? byId.get(E(e.id)) : undefined;
        const sweep = arc ? ((Number(arc.end_angle) - Number(arc.start_angle)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) : 0;
        const connector = entOf(geometry!, e.id)!;
        const mixed = guard.arc;
        let mixedValid = true;
        if (mixed) {
          const source = entOf(geometry!, mixed.source), retained = entOf(geometry!, mixed.retained);
          if (source?.t === 'arc' && retained?.t === 'arc') {
            const center = point(source.c), cut = point(mixed.cut), turn = 2 * Math.PI;
            const at = ((Math.atan2(cut.y - center.y, cut.x - center.x) - source.a0) % turn + turn) % turn;
            const rest = mixed.corner === source.s ? source.a1 - source.a0 - at : at;
            mixedValid = at * source.r > 1e-6 && (source.a1 - source.a0 - at) * source.r > 1e-6
              && Math.abs(retained.a1 - retained.a0 - rest) * source.r < 1e-5;
          }
        }
        if (!valid || !mixedValid || (arc && !(sweep > 0 && sweep < Math.PI)) || (!connector.aux && cornerCrossesOutline(geometry!, connector))) {
          return { ok: false, invalidGeometry: true, dof, conflicting: [guard.dimension], redundant };
        }
      }
      for (const p of sk.pts) {
        const q = byId.get(P(p.id));
        if (q) {
          p.x = q.x as number;
          p.y = q.y as number;
        }
      }
      for (const e of sk.ents) {
        const q = byId.get(E(e.id));
        if (!q || e.t === 'line' || e.t === 'point') continue;
        e.r = Math.abs(q.radius as number);
        if (e.t === 'arc') {
          let a0 = q.start_angle as number,
            a1 = q.end_angle as number;
          while (a1 <= a0) a1 += 2 * Math.PI;
          while (a1 - a0 > 2 * Math.PI) a1 -= 2 * Math.PI;
          e.a0 = a0;
          e.a1 = a1;
        }
      }
      // feste Punkte merken sich ihre Lage
      for (const c of sk.cons) if (c.t === 'fixed') {
        const p = ptOf(sk, c.r[0]);
        if (p) {
          c.x = p.x;
          c.y = p.y;
        }
      }
    }
    const definition = ok && opt.definition && !opt.drag ? geometryDefinition(sk, dof) : undefined;
    return { ok, dof, conflicting, redundant, definition };
  } finally {
    g.destroy_gcs_module();
  }
}
