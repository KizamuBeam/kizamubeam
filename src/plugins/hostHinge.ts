// Host function hinge: the app's living hinge patterns (the Living hinge tool, src/hingesGeom.ts) for plugins, so a
// plugin that needs a bendable area (a curved wall, a bent strip) does not carry its own copy.
// Input: the area to fill as closed sub-paths (holes by even-odd) and the pattern's options; answer: the cuts as open
// sub-paths and a note, or only an error. Notes and errors are codes hinge-… with numbers; the app writes their texts
// (hingeText.ts, plugins/words.ts). v is the version of the pattern geometry: the same input and version always give
// the same cuts. Runs inside the plugin Worker: no i18n here.
import ClipperLib from 'clipper-lib';
import type { SubPath } from '../model';
import { IDENT } from '../mat';
import { execute, flattenSub } from '../clip';
import { computeHingeGeom, DEFAULT_HINGE, type HingeKind, type HingeMsg, type HingeOptions, type HingeOrient } from '../hingesGeom';

type Bad = (what: string) => never;
type Num = (v: unknown, what: string, min?: number, max?: number) => number;
type Subs = (v: unknown, what: string) => SubPath[];

const KINDS: HingeKind[] = ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'];
const ORIENTS: HingeOrient[] = ['auto', 'vertical', 'horizontal', 'angle'];
/** Numeric options and their ranges (mm, degrees); the geometry checks the finer limits and answers with a code */
const NUM_OPTS: Record<string, [number, number]> = {
  cutLength: [0, 10000], bridge: [0, 1000], spacing: [0, 1000], margin: [0, 1000], angle: [-360, 360],
  waveAmp: [0, 1000], waveLength: [0, 10000], diamondAngle: [0, 180],
};

const msg = (m: HingeMsg) => ({ code: `hinge-${m.code}`, ...(m.values ? { values: m.values } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** { v?, area: closed sub-paths, kind, cutLength?, bridge?, spacing?, margin?, orient?, angle?, waveAmp?, waveLength?, diamondAngle? } */
export function hingeFn(input: unknown, subsOf: Subs, num: Num, bad: Bad): unknown {
  if (!isObj(input)) return bad('hinge');
  const v = input.v === undefined ? 1 : input.v;
  if (v !== 1) return bad('v');
  const o: HingeOptions = { ...DEFAULT_HINGE };
  for (const [k, x] of Object.entries(input)) {
    if (k === 'v' || k === 'area') continue;
    if (k === 'kind') o.kind = (KINDS as unknown[]).includes(x) ? (x as HingeKind) : bad('kind');
    else if (k === 'orient') o.orient = (ORIENTS as unknown[]).includes(x) ? (x as HingeOrient) : bad('orient');
    else if (NUM_OPTS[k]) (o as unknown as Record<string, number>)[k] = num(x, k, ...NUM_OPTS[k]);
    else return bad(k);
  }
  if (input.kind === undefined) return bad('kind');
  const closed = subsOf(input.area, 'area').filter((s) => s.closed && s.nodes.length >= 3);
  // Holes by even-odd, like the outlines of one object in the Living hinge tool
  const paths = closed.length ? execute(ClipperLib.ClipType.ctUnion, closed.map((s) => flattenSub(s, IDENT)), [], ClipperLib.PolyFillType.pftEvenOdd) : [];
  const r = computeHingeGeom(paths, o);
  if (r.error) return { v, error: msg(r.error) };
  return { v, subs: r.subs, info: r.info ? [msg(r.info)] : [] };
}
