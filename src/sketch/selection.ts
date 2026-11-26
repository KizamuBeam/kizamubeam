import { apply, type Mat, type Pt } from '../model';
import { ptOf, type Sketch } from './model';

const TAU = 2 * Math.PI;

/** Frame selection in CSS pixels; a leftward frame crosses, a rightward frame encloses. */
export function sketchFrameSelection(sk: Sketch, m: Mat, from: Pt, to: Pt): number[] {
  const crossing = to.x < from.x;
  const lo = [Math.min(from.x, to.x), Math.min(from.y, to.y)];
  const hi = [Math.max(from.x, to.x), Math.max(from.y, to.y)];
  const eps = 1e-7;
  const inside = (p: Pt) => p.x >= lo[0] - eps && p.x <= hi[0] + eps && p.y >= lo[1] - eps && p.y <= hi[1] + eps;
  const project = (p: Pt) => apply(m, p.x, p.y);
  function lineHits(a: Pt, b: Pt) {
    if (!crossing) return inside(a) && inside(b);
    let enter = 0, exit = 1;
    for (const [i, key] of (['x', 'y'] as const).entries()) {
      const d = b[key] - a[key];
      if (!d) {
        if (a[key] < lo[i] - eps || a[key] > hi[i] + eps) return false;
      } else {
        const u = (lo[i] - eps - a[key]) / d, v = (hi[i] + eps - a[key]) / d;
        enter = Math.max(enter, Math.min(u, v));
        exit = Math.min(exit, Math.max(u, v));
        if (enter > exit) return false;
      }
    }
    return true;
  }
  return sk.ents.filter((e) => {
    if (e.t === 'point') {
      const p = ptOf(sk, e.p);
      return !!p && inside(project(p));
    }
    if (e.t === 'line') {
      const a = ptOf(sk, e.a), b = ptOf(sk, e.b);
      return !!a && !!b && lineHits(project(a), project(b));
    }
    const c = ptOf(sk, e.c);
    if (!c || !(e.r > 0)) return false;
    // Halbachsen in Skizzenkoordinaten: Kreis → (r, r); Ellipse → Hauptvektor (m-c) und Nebenvektor senkrecht dazu.
    let ax = e.r, ay = 0, bx = 0, by = e.r;
    if (e.t === 'ellipse') {
      const mp = ptOf(sk, e.m);
      if (!mp) return false;
      ax = mp.x - c.x;
      ay = mp.y - c.y;
      if (!(Math.hypot(ax, ay) > 0)) return false;
      bx = (-ay / Math.hypot(ax, ay)) * e.r;
      by = (ax / Math.hypot(ax, ay)) * e.r;
    }
    const center = project(c);
    const u = [m[0] * ax + m[2] * bx, m[1] * ax + m[3] * bx], v = [m[0] * ay + m[2] * by, m[1] * ay + m[3] * by];
    const start = e.t === 'arc' ? e.a0 : 0, end = e.t === 'arc' ? e.a1 : TAU;
    const on = (a: number) => a + Math.ceil((start - a - eps) / TAU) * TAU <= end + eps;
    const at = (a: number): Pt => ({ x: center.x + u[0] * Math.cos(a) + v[0] * Math.sin(a), y: center.y + u[1] * Math.cos(a) + v[1] * Math.sin(a) });
    const candidates = [start, end];
    for (const [i, key] of (['x', 'y'] as const).entries()) {
      const phi = Math.atan2(v[i], u[i]);
      if (!crossing) {
        for (const a of [phi, phi + Math.PI]) if (on(a)) candidates.push(a);
      } else {
        const span = Math.hypot(u[i], v[i]);
        if (span === 0) continue;
        for (const edge of [lo[i], hi[i]]) {
          if (Math.abs(edge - center[key]) > span + eps) continue;
          const a = Math.acos(Math.max(-1, Math.min(1, (edge - center[key]) / span)));
          for (const root of [phi - a, phi + a]) if (on(root)) candidates.push(root);
        }
      }
    }
    return crossing ? candidates.some((a) => inside(at(a))) : candidates.every((a) => inside(at(a)));
  }).map((e) => e.id);
}
