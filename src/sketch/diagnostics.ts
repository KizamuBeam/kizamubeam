import { t } from '../i18n';
import type { SolveResult } from './solver';

export type SketchDiagnostic = { kind: 'formula' | 'geometry' | 'conflict' | 'redundant' | 'solve' | 'reference'; ids: readonly number[]; message?: string };

export function diagnosticTitle(kind: SketchDiagnostic['kind']) {
  switch (kind) {
    case 'formula': return t('Formelfehler');
    case 'geometry': return t('Ungültige Geometrie');
    case 'conflict': return t('Widerspruch');
    case 'redundant': return t('Redundante Bedingung');
    case 'solve': return t('Skizze nicht lösbar');
    case 'reference': return t('Blockierende Referenzen');
  }
}

export function solveDiagnostics(r?: SolveResult | null): SketchDiagnostic[] {
  if (!r) return [];
  if (r.inputIssues?.length) return r.inputIssues.map(({ kind, id, message }) => ({ kind, ids: [id], message }));
  const entries: SketchDiagnostic[] = [];
  if (r.invalidGeometry) entries.push({ kind: 'geometry', ids: r.conflicting });
  else if (r.conflicting.length) entries.push({ kind: 'conflict', ids: r.conflicting });
  if (r.redundant?.length) entries.push({ kind: 'redundant', ids: r.redundant });
  if (!r.ok && !entries.length) entries.push({ kind: 'solve', ids: [] });
  return entries;
}
