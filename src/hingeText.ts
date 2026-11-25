// Texts of the living hinge messages (hingesGeom.ts): problems and notes of the hinge tool and of host.hinge.
import { dec, locale, t } from './i18n';
import type { HingeMsg } from './hingesGeom';

const de = (v: number, d = 1) => dec(v.toFixed(d));

/** Text of one living hinge message; undefined for an unknown code */
export function hingeText(m: HingeMsg): string | undefined {
  const v = m.values ?? {};
  const num = (k: string) => (typeof v[k] === 'number' ? v[k] : 0);
  const big = (k: string) => num(k).toLocaleString(locale);
  switch (m.code) {
    case 'no-shape': return t('Erst eine geschlossene Form auswählen, die das Muster füllen soll.');
    case 'cut-length': return t('Die Schnittlänge muss größer als 0 sein.');
    case 'bridge': return t('Die Stegbreite muss mindestens 0,3 mm betragen.');
    case 'diamond-angle': return t('Der Rautenwinkel muss zwischen 10° und 170° liegen.');
    case 'spacing': return t('Der Zeilenabstand muss mindestens 0,3 mm betragen.');
    case 'wave-length': return t('Die Wellenlänge muss mindestens 1 mm betragen.');
    case 'wave-amp': return t('Die Wellenhöhe darf nicht negativ sein.');
    case 'margin': return t('Der Rand ist zu groß für die Form, es bleibt keine Fläche übrig.');
    case 'no-area': return t('Keine geschlossene Form gewählt.');
    case 'too-many-rows':
      return v.est === undefined
        ? t('Zu viele Schnitte (höchstens {MAX_CUTS}): Zeilenabstand oder Schnittlänge vergrößern.', { MAX_CUTS: big('max') })
        : t('Zu viele Schnitte (etwa {est}, höchstens {MAX_CUTS}): Zeilenabstand oder Schnittlänge vergrößern.', { est: big('est'), MAX_CUTS: big('max') });
    case 'too-many-cells':
      return v.est === undefined
        ? t('Zu viele Schnitte (höchstens {MAX_CUTS}): Schnittlänge oder Zeilenabstand vergrößern.', { MAX_CUTS: big('max') })
        : t('Zu viele Schnitte (etwa {est}, höchstens {MAX_CUTS}): Schnittlänge oder Zeilenabstand vergrößern.', { est: big('est'), MAX_CUTS: big('max') });
    case 'too-small': return t('Die Form ist zu klein für das Muster: Rand, Schnittlänge oder Stegbreite verkleinern.');
    case 'spiral-small': return t('Die Form ist zu klein für eine Spirale: Rand oder Zeilenabstand verkleinern.');
    case 'spiral-turns': return t('Zu viele Windungen: Zeilenabstand vergrößern.');
    case 'wave-info': return t('{subs} Schnitte in {rows} Zeilen, kleinster Abstand zwischen den Wellen {eff} mm', { subs: num('subs'), rows: num('rows'), eff: de(num('eff'), 2) });
    case 'rows-info': return t('{subs} Schnitte in {rows} Zeilen, zusammen {total} m Schnittlänge', { subs: num('subs'), rows: num('rows'), total: de(num('total'), 2) });
    case 'cells-info': return t('{subs} Schnitte, zusammen {total} m Schnittlänge', { subs: num('subs'), total: de(num('total'), 2) });
    case 'spiral-info':
      return num('pieces') > 1
        ? t('Spirale mit {turns} Windungen in {pieces} Stücken, zusammen {length} m Schnittlänge', { turns: de(num('turns'), 1), pieces: num('pieces'), length: de(num('length'), 2) })
        : t('Spirale mit {turns} Windungen, zusammen {length} m Schnittlänge', { turns: de(num('turns'), 1), length: de(num('length'), 2) });
  }
  return undefined;
}
