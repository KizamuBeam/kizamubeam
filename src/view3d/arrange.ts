// Arrangement of parts in the 3D view (hide, transparent, move, rotate), e.g. for assembly instructions.
// Pure state and math on top of three.js matrices, no DOM, so it can be tested in Node (npm run test:3d).
// Parts are addressed by their part key (see partKey in solids.ts): strips of a bent part move as one part.
import * as THREE from 'three';

export type Axis = 'x' | 'y' | 'z';

export interface PartArrangement {
  hidden: boolean;
  /** Drawn see-through so the parts behind it stay visible */
  ghost: boolean;
  /** Extra world transform applied on top of the assembled (and exploded) position */
  m: THREE.Matrix4;
}

export const AXES: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/** Rotation by `deg` degrees around a world axis through `pivot`, applied after `m` */
export function rotateAbout(m: THREE.Matrix4, axis: THREE.Vector3, deg: number, pivot: THREE.Vector3): THREE.Matrix4 {
  const r = new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), THREE.MathUtils.degToRad(deg));
  const t = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const back = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  return t.multiply(r).multiply(back).multiply(m);
}

/** Translation by `d`, applied after `m` */
export function translateBy(m: THREE.Matrix4, d: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(d.x, d.y, d.z).multiply(m);
}

/** Snap an angle to `step` degrees (0 = no snapping) */
export const snapAngle = (deg: number, step: number) => (step > 0 ? Math.round(deg / step) * step : deg);

/**
 * Plane for dragging a part: through `at`, facing the camera. With an axis lock the plane contains the axis and
 * faces the camera as much as possible, so the pointer ray meets it even when looking along a side of the part.
 */
export function dragPlane(at: THREE.Vector3, viewDir: THREE.Vector3, axis: THREE.Vector3 | null): THREE.Plane {
  let n = viewDir.clone().normalize();
  if (axis) {
    const a = axis.clone().normalize();
    // Component of the view direction perpendicular to the axis
    const perp = n.clone().sub(a.clone().multiplyScalar(n.dot(a)));
    if (perp.lengthSq() > 1e-8) n = perp.normalize();
  }
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, at);
}

/** Movement from `from` to `to`, limited to an axis if one is locked */
export function dragDelta(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3 | null): THREE.Vector3 {
  const d = to.clone().sub(from);
  if (!axis) return d;
  const a = axis.clone().normalize();
  return a.multiplyScalar(d.dot(a));
}

export class Arrangement {
  private parts = new Map<string, PartArrangement>();

  get(key: string): PartArrangement {
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { hidden: false, ghost: false, m: new THREE.Matrix4() }));
    return p;
  }

  /** Read without creating an entry */
  peek(key: string): PartArrangement | undefined {
    return this.parts.get(key);
  }

  isHidden = (key: string) => !!this.parts.get(key)?.hidden;
  isGhost = (key: string) => !!this.parts.get(key)?.ghost;
  isMoved = (key: string) => {
    const p = this.parts.get(key);
    return !!p && !p.m.equals(new THREE.Matrix4());
  };

  setHidden(keys: Iterable<string>, on: boolean) {
    for (const k of keys) this.get(k).hidden = on;
  }

  setGhost(keys: Iterable<string>, on: boolean) {
    for (const k of keys) this.get(k).ghost = on;
  }

  /** Show only `keys`: all other parts of `all` are hidden, the given ones shown */
  isolate(keys: Iterable<string>, all: Iterable<string>) {
    const keep = new Set(keys);
    for (const k of all) this.get(k).hidden = !keep.has(k);
  }

  showAll() {
    for (const p of this.parts.values()) p.hidden = false;
  }

  /** Back to the assembled position, visible and opaque (all parts without `keys`) */
  reset(keys?: Iterable<string>) {
    if (!keys) {
      this.parts.clear();
      return;
    }
    for (const k of keys) this.parts.delete(k);
  }

  rotate(keys: Iterable<string>, axis: THREE.Vector3, deg: number, pivot: THREE.Vector3) {
    for (const k of keys) {
      const p = this.get(k);
      p.m = rotateAbout(p.m, axis, deg, pivot);
    }
  }

  translate(keys: Iterable<string>, d: THREE.Vector3) {
    for (const k of keys) {
      const p = this.get(k);
      p.m = translateBy(p.m, d);
    }
  }

  /** Copy of the transforms, to restore them when a drag is cancelled */
  snapshot(keys: Iterable<string>): Map<string, THREE.Matrix4> {
    return new Map([...keys].map((k) => [k, this.get(k).m.clone()]));
  }

  restore(saved: Map<string, THREE.Matrix4>) {
    for (const [k, m] of saved) this.get(k).m = m.clone();
  }

  /** Hidden parts among `keys` */
  hiddenOf(keys: Iterable<string>): string[] {
    return [...keys].filter((k) => this.isHidden(k));
  }

  /** Anything differs from the plain assembled view (among `keys`) */
  changed(keys: Iterable<string>): boolean {
    return [...keys].some((k) => this.isHidden(k) || this.isGhost(k) || this.isMoved(k));
  }

  /** Any part is moved or rotated (then the red intersections no longer match) */
  anyMoved(keys: Iterable<string>): boolean {
    return [...keys].some((k) => this.isMoved(k));
  }
}
