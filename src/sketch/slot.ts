import { addArc, addCon, addLine, addPt, materializeSketchPoint, ptOf, sketchPointLinked, type SkEnt, type Sketch, type SketchPickedPoint } from './model';
import type { Pt } from '../model';

const MIN_SLOT_SIZE = 1e-6;

/** Recognize intact native slots, including older axial slots without an axis entity. */
export function sketchSlots(sk: Sketch) {
  type Arc = Extract<SkEnt, { t: 'arc' }>;
  const arcs = new Map(sk.ents.flatMap((e) => e.t === 'arc' && !e.trimSupport ? [[e.id, e] as const] : []));
  const ends = new Map<number, Arc[]>();
  for (const e of arcs.values()) for (const id of [e.s, e.e]) ends.set(id, [...ends.get(id) ?? [], e]);
  const sides = sk.ents.filter((e) => e.t === 'line' && !e.trimSupport);
  const widths = sk.cons.filter((c) => c.t === 'diameter' && c.min === MIN_SLOT_SIZE);
  const results = [];
  const used = new Set<number>();
  for (const width of widths) {
    const left = arcs.get(width.r[0]);
    if (!left) continue;
    const axis = sk.ents.find((e) => e.t === 'line' && e.slotCaps?.[0] === left.id);
    const candidates = axis?.t === 'line' && axis.slotCaps ? [arcs.get(axis.slotCaps[1])] : sides.flatMap((e) =>
      e.t === 'line' && (e.a === left.s || e.b === left.s) ? ends.get(e.a === left.s ? e.b : e.a) ?? [] : []);
    for (const right of new Set(candidates)) {
      if (!right || left.id === right.id || left.c === right.c) continue;
      const joins = (a: number, b: number) => sides.filter((e) => e.t === 'line' && (e.a === a && e.b === b || e.a === b && e.b === a));
      const side1 = joins(left.s, right.e), side2 = joins(left.e, right.s);
      if (side1.length !== 1 || side2.length !== 1) continue;
      const distance = sk.cons.find((c) => c.min === MIN_SLOT_SIZE && (axis
        ? c.t === 'distance' && c.r.length === 1 && c.r[0] === axis.id
        : (c.t === 'hdistance' || c.t === 'vdistance') && c.r.length === 2 && c.r.includes(left.c) && c.r.includes(right.c)));
      if (!axis && !distance) continue;
      const a = ptOf(sk, left.c), b = ptOf(sk, right.c);
      if (!a || !b) continue;
      const centerDistance = Math.hypot(b.x - a.x, b.y - a.y), breadth = left.r * 2;
      results.push({ left, right, sides: [side1[0], side2[0]], width, distance, centerDistance, breadth, total: centerDistance + breadth });
      used.add(left.id);
      used.add(right.id);
      break;
    }
  }
  /** Bogenslots (Paket 3): halbrunde Kappen an konzentrischen Seiten, tangent gesichert. */
  for (const width of widths) {
    const cap1 = arcs.get(width.r[0]);
    if (!cap1 || used.has(cap1.id)) continue;
    const atJoint = (pid: number) => (ends.get(pid) ?? []).filter((e) => e.id !== cap1.id);
    const fromS = atJoint(cap1.s), fromE = atJoint(cap1.e);
    if (fromS.length !== 1 || fromE.length !== 1) continue;
    const [sideA, sideB] = [fromS[0], fromE[0]];
    if (sideA.id === sideB.id || sideA.c !== sideB.c) continue;
    const far = (side: typeof sideA, joint: number) => (side.s === joint ? side.e : side.s);
    const q1 = far(sideA, cap1.s), q2 = far(sideB, cap1.e);
    if (q1 === q2) continue;
    const cap2 = (ends.get(q1) ?? []).find((e) => e.id !== sideA.id && e.id !== sideB.id && !used.has(e.id)
      && (e.s === q1 && e.e === q2 || e.s === q2 && e.e === q1));
    if (!cap2 || cap2.c === sideA.c || cap1.c === cap2.c) continue;
    // Fugensicherung: je Seite zwei Tangenten zu trimSupport-Hilfslinien.
    const trimTangents = (side: number) => sk.cons.filter((c) => {
      if (c.t !== 'tangent' || !c.r.includes(side) || c.r.length !== 2) return false;
      const other = sk.ents.find((e) => e.id === c.r.find((id) => id !== side));
      return other?.t === 'line' && !!other.trimSupport;
    }).length;
    if (!(trimTangents(sideA.id) >= 2 && trimTangents(sideB.id) >= 2)) continue;
    const breadth = cap1.r * 2;
    if (Math.abs(cap1.r - cap2.r) > 2e-6) continue;
    const outer = sideA.r >= sideB.r ? sideA : sideB;
    if (Math.abs(Math.max(sideA.r, sideB.r) - Math.min(sideA.r, sideB.r) - breadth) > 2e-6) continue;
    const sweep = outer.a1 - outer.a0;
    if (!(sweep > 1e-6)) continue;
    const centerDistance = (sideA.r + sideB.r) / 2 * sweep;
    results.push({ left: cap1, right: cap2, sides: [sideA, sideB], width, distance: undefined, centerDistance, breadth, total: centerDistance + breadth });
    used.add(cap1.id);
    used.add(cap2.id);
  }
  return results;
}

export function sketchSlotAxis(start: Pt, end: Pt, tolerance = 0, referenced = false): Pt {
  if (referenced) return end;
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dy) <= tolerance) return { x: end.x, y: start.y };
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) <= tolerance) return { x: start.x, y: end.y };
  return end;
}

export function sketchSlotWidth(start: Pt, end: Pt, edge: Pt): number {
  const dx = end.x - start.x, dy = end.y - start.y, l = Math.hypot(dx, dy);
  return l > MIN_SLOT_SIZE ? 2 * Math.abs((dx / l) * (edge.y - start.y) - (dy / l) * (edge.x - start.x)) : 0;
}

export function addOrientedSketchSlot(sk: Sketch, start: SketchPickedPoint, end: SketchPickedPoint, width: number,
  startId?: number | null, endId?: number | null): void | false {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy), radius = width / 2;
  const referenced = endId != null || sketchPointLinked(end);
  if (!referenced && (!dx || !dy)) return addSketchSlot(sk, start, dx || dy, !dx, width, startId);
  if (!(length > MIN_SLOT_SIZE && width >= MIN_SLOT_SIZE) || !Number.isFinite(length) || !Number.isFinite(width)) return false;
  const nx = -dy / length * radius, ny = dx / length * radius;
  const cap = (p: Pt) => [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }];
  const [a, b] = [cap(start), cap(end)];
  if (![...a, ...b].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    || [a, b].some(([p, q]) => !(Math.hypot(p.x - q.x, p.y - q.y) > MIN_SLOT_SIZE / 2))) return false;
  const c1 = materializeSketchPoint(sk, start, startId), c2 = materializeSketchPoint(sk, end, endId);
  const link = (p: number, q: number) => { const line = addLine(sk, p, q, true); line.trimSupport = true; return line.id; };
  const axisLine = addLine(sk, c1, c2, true);
  axisLine.trimSupport = true;
  const axis = axisLine.id;
  const [ap, am, bp, bm] = [...a, ...b].map((p) => addPt(sk, p.x, p.y).id);
  for (const [c, p] of [[c1, ap], [c1, am], [c2, bp], [c2, bm]]) addCon(sk, 'perpendicular', [axis, link(c, p)]);
  const side = addLine(sk, am, bm);
  addLine(sk, bp, ap);
  addCon(sk, 'parallel', [axis, side.id]);
  const left = addArc(sk, c1, ap, am);
  const right = addArc(sk, c2, bm, bp);
  if (axisLine.t === 'line') axisLine.slotCaps = [left.id, right.id];
  addCon(sk, 'diameter', [left.id], { v: width, min: MIN_SLOT_SIZE });
  if (startId == null && !sketchPointLinked(start)) addCon(sk, 'fixed', [c1], { x: start.x, y: start.y });
  if (!referenced) {
    addCon(sk, 'distance', [axis], { v: length, min: MIN_SLOT_SIZE });
    const datum = link(c1, addPt(sk, start.x + length, start.y).id);
    addCon(sk, 'horizontal', [datum]);
    addCon(sk, 'equal', [axis, datum]);
    addCon(sk, 'angle', [datum, axis], { v: Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI });
  }
}

/** The two straight sides and the semicircles share their four end points. */
export function addSketchSlot(sk: Sketch, start: SketchPickedPoint, delta: number, vertical: boolean, width: number, startId?: number | null): void | false {
  const radius = width / 2;
  const dx = vertical ? 0 : delta, dy = vertical ? delta : 0;
  const sign = Math.sign(delta);
  const nx = vertical ? -sign * radius : 0, ny = vertical ? 0 : sign * radius;
  const x = start.x + dx, y = start.y + dy;
  if (![start.x, start.y, delta, width, x + nx, x - nx, y + ny, y - ny, start.x + nx, start.x - nx, start.y + ny, start.y - ny].every(Number.isFinite)
    || Math.abs(delta) < MIN_SLOT_SIZE || width < MIN_SLOT_SIZE || (vertical ? y === start.y || start.x + nx === start.x || start.x - nx === start.x
      : x === start.x || start.y + ny === start.y || start.y - ny === start.y)) return false;
  const c1 = materializeSketchPoint(sk, start, startId), c2 = addPt(sk, x, y).id;
  const ap = addPt(sk, start.x + nx, start.y + ny).id, am = addPt(sk, start.x - nx, start.y - ny).id;
  const bp = addPt(sk, x + nx, y + ny).id, bm = addPt(sk, x - nx, y - ny).id;
  const arc = addArc(sk, c1, ap, am);
  addArc(sk, c2, bm, bp);
  const side1 = addLine(sk, am, bm), side2 = addLine(sk, bp, ap);
  const along = vertical ? 'vertical' : 'horizontal';
  const across = vertical ? 'horizontal' : 'vertical';
  for (const [p, c] of [[ap, c1], [am, c1], [bp, c2], [bm, c2]]) addCon(sk, across, [p, c]);
  for (const side of [side1, side2]) addCon(sk, along, [side.id]);
  addCon(sk, 'diameter', [arc.id], { v: width, min: MIN_SLOT_SIZE });
  addCon(sk, vertical ? 'vdistance' : 'hdistance', [c1, c2], { v: Math.abs(delta), min: MIN_SLOT_SIZE });
  if (startId == null && !sketchPointLinked(start)) addCon(sk, 'fixed', [c1], { x: start.x, y: start.y });
}
