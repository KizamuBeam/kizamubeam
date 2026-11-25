// Biegeschnitte (Living Hinges) für das Werkzeug: die gewählten Formen werden zur Fläche, die das Muster füllt.
// The geometry lives in hingesGeom.ts (also used by the plugin host function hinge), the texts in hingeText.ts.
import type { Obj, SubPath } from './model';
import { region } from './ops';
import { t } from './i18n';
import { computeHingeGeom, type HingeKind, type HingeOptions } from './hingesGeom';
import { hingeText } from './hingeText';

export {
  computeHingeGeom, DEFAULT_HINGE, MAX_CUTS, suggestHinge,
  type HingeGeomResult, type HingeKind, type HingeMsg, type HingeOptions, type HingeOrient,
} from './hingesGeom';

export const HINGE_KINDS: [HingeKind, string][] = [
  ['straight', t('Gerade Schnitte (Mauerwerk)')],
  ['wave', t('Wellen')],
  ['diamond', t('Rauten (Diamant)')],
  ['honeycomb', t('Waben')],
  ['triangle', t('Dreiecke (3D)')],
  ['cross', t('Kreuz / Flechtmuster (3D)')],
  ['spiral', t('Spirale')],
];

export interface HingeResult {
  subs: SubPath[];
  info: string;
  error?: string;
}

export function computeHinge(objs: Obj[], o: HingeOptions): HingeResult {
  if (!objs.length) return { subs: [], info: '', error: hingeText({ code: 'no-shape' }) };
  const r = computeHingeGeom(objs.flatMap((obj) => region(obj)), o);
  if (r.error) return { subs: [], info: '', error: hingeText(r.error) ?? r.error.code };
  return { subs: r.subs, info: r.info ? (hingeText(r.info) ?? '') : '' };
}
