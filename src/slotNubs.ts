// Shared layout for material latching nubs (Rastnasen) on slot flanges.
// A nub is kept MATERIAL that pokes into the slot cavity from a flange wall;
// it is compressed ("verdrängt") when a mating part is inserted and averages
// out tolerances. Since each slot cutter is the region REMOVED from the board,
// a nub is a notch REMOVED from the cutter: ctDifference(cutter, notch).
//
// Both long flange walls receive an equal number of nubs (symmetric pairs),
// evenly distributed over the usable wall length, inset from the mouth and
// from the bottom by `inset`. Each nub is a trapezoid with 45° flanks: a wide
// base on the wall tapering inward by `depth`. Nubs never touch each other or
// the mouth/bottom: the inset margin plus a pitch of at least 1.25x the nub
// width enforces gaps, and the layout degrades gracefully (fewer or no nubs)
// when they would not fit.
//
// Canonical local frame used by nubLayout: the wall runs along +y from y = 0
// (mouth side) to y = len (bottom side); the wall base is at x = 0 and inward
// (toward the slot center) is +x. Callers map this frame onto their own wall
// (mirroring x for the opposite wall) and compose the notches with their
// cutter: manufacturedSlotPaths subtracts them via Clipper, slotOutline and
// guidedSlot bake the same bays explicitly into their outline polygon.
import type { SlotNubs } from './slotPlacement';

export const NUB_PITCH_FACTOR = 1.25;

export const NUB_BOUNDS = {
  height: [0, 0.5], width: [0.1, 10], count: [0, 16], inset: [0, 50],
} as const;

export function validNubField(key: keyof SlotNubs, value: number): boolean {
  const [min, max] = NUB_BOUNDS[key];
  return Number.isFinite(value) && value >= min && value <= max && (key !== 'count' || Number.isInteger(value));
}

export function validNubValues(n: SlotNubs): boolean {
  return !!n && Object.keys(NUB_BOUNDS).every(key => validNubField(key as keyof SlotNubs, n[key as keyof SlotNubs]));
}

export interface NubLayout {
  /** Nub centers along the wall, measured from the mouth (y = 0). */
  centers: number[];
  /** Base length of each trapezoid on the wall (along y). */
  base: number;
  /** Half-length of the inner (narrow) trapezoid edge. */
  inner: number;
  /** Protrusion of each nub into the slot (along +x). */
  depth: number;
}

/**
 * Evenly spaced nub layout for one wall of usable length `len`.
 * `maxDepth` caps the protrusion so opposing nubs keep at least half the
 * slot open (callers pass a quarter of the inner wall distance).
 * Returns null when nubs are disabled (height 0, count 0, no nubs object)
 * or when not even a single nub fits.
 */
export function nubLayout(len: number, nubs: SlotNubs | undefined, maxDepth: number): NubLayout | null {
  const height = nubs?.height ?? 0;
  const width = nubs?.width ?? 0;
  const count = nubs?.count ?? 0;
  const inset = nubs?.inset ?? 0;
  if (!(height > 0) || !(width > 0) || !(count >= 1) || !(len > 0) || !(maxDepth > 0)) return null;
  const free = len - 2 * Math.max(0, inset);
  if (!(free > width)) return null;
  const usable = Math.min(Math.floor(count), Math.floor(free / (width * NUB_PITCH_FACTOR)));
  if (!(usable >= 1)) return null;
  // Pitch >= 1.25x base keeps a gap between neighbours; the first/last nub
  // keeps at least (pitch - base)/2 beyond the inset from mouth/bottom.
  const pitch = free / usable;
  const base = Math.min(width, pitch * 0.9);
  if (!(base >= 0.03)) return null;
  // 45° flanks: the inner edge is shorter by `depth` on each side.
  const depth = Math.min(height, base / 2 - 0.005, maxDepth);
  if (!(depth > 0.004)) return null;
  const inner = base / 2 - depth;
  const start = Math.max(0, inset);
  const centers: number[] = [];
  for (let i = 0; i < usable; i++) centers.push(start + (free / usable) * (i + 0.5));
  return { centers, base, inner, depth };
}

/** Geometric equality: height 0 disables nubs, other fields are then ignored. */
export function sameNubs(a: SlotNubs | undefined, b: SlotNubs | undefined): boolean {
  const ha = a?.height ?? 0, hb = b?.height ?? 0;
  if (!(ha > 0) && !(hb > 0)) return true;
  if (!(ha > 0) || !(hb > 0)) return false;
  return ha === hb && a!.width === b!.width && a!.count === b!.count && a!.inset === b!.inset;
}
