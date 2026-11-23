// Pictures a plugin may bring along (manifest fields `iconImage` and `previewImage`): a square PNG icon for its
// toolbox tile and a preview image for the Extensions window. Only the file header is read, so the checks run the
// same in the app, in Node tests and in the catalogue build; the browser decodes the picture itself (img-src data:).
import { base64ToBytes } from './engine';
import { t } from '../i18n';

export type PluginImageKind = 'icon' | 'preview';
export type ImageMime = 'image/png' | 'image/jpeg';

/** Limits of the two pictures: formats, bytes, pixels per side and (preview) the widest aspect ratio */
export const IMAGE_LIMITS = {
  icon: { key: 'iconImage', types: ['image/png'] as ImageMime[], bytes: 128 * 1024, min: 32, max: 512, square: true, ratio: 1 },
  preview: { key: 'previewImage', types: ['image/png', 'image/jpeg'] as ImageMime[], bytes: 512 * 1024, min: 120, max: 2048, square: false, ratio: 3 },
} as const;

export interface PluginImage {
  /** data:<mime>;base64,… exactly as it is used for <img src> */
  url: string;
  mime: ImageMime;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export class ImageError extends Error {}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

/** Width and height from the header of a PNG or JPEG file, or null when the bytes are neither */
export function imageSize(b: Uint8Array): { mime: ImageMime; width: number; height: number } | null {
  // PNG: signature, then the IHDR chunk (length 13) with width and height
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 33 && PNG.every((x, i) => b[i] === x)) {
    if (u32(b, 8) !== 13 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    return { mime: 'image/png', width: u32(b, 16), height: u32(b, 20) };
  }
  // JPEG: walk the segments up to the first start-of-frame marker
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      if (m === 0xd9 || m === 0xda) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', width: u16(b, i + 7), height: u16(b, i + 5) };
      const len = u16(b, i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** Check picture bytes against the limits of `kind`; the message names the manifest field */
export function checkImageBytes(bytes: Uint8Array, kind: PluginImageKind, mime?: string): PluginImage {
  const L = IMAGE_LIMITS[kind];
  const types = L.types.map((x) => x.slice(6).toUpperCase()).join('/');
  if (bytes.length > L.bytes) throw new ImageError(t('„{key}“ ist größer als {kb} KB', { key: L.key, kb: L.bytes / 1024 }));
  const s = imageSize(bytes);
  if (!s || !(L.types as readonly string[]).includes(s.mime) || (mime !== undefined && mime !== s.mime))
    throw new ImageError(t('„{key}“ muss ein {types}-Bild sein', { key: L.key, types }));
  const { width: w, height: hgt } = s;
  if (w < L.min || hgt < L.min || w > L.max || hgt > L.max)
    throw new ImageError(t('„{key}“ ist {w} × {h} Pixel, erlaubt sind {min} bis {max} Pixel je Seite', { key: L.key, w, h: hgt, min: L.min, max: L.max }));
  if (L.square && w !== hgt) throw new ImageError(t('„{key}“ muss quadratisch sein (ist {w} × {h} Pixel)', { key: L.key, w, h: hgt }));
  if (Math.max(w, hgt) / Math.min(w, hgt) > L.ratio) throw new ImageError(t('„{key}“ ist zu schmal (Seitenverhältnis höchstens {r}:1)', { key: L.key, r: L.ratio }));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: `data:${s.mime};base64,${btoa(bin)}`, mime: s.mime, width: w, height: hgt, bytes };
}

/** Check a manifest value: a data: URL with base64 PNG (icon) or PNG/JPEG (preview) */
export function parsePluginImage(v: unknown, kind: PluginImageKind): PluginImage {
  const L = IMAGE_LIMITS[kind];
  const types = L.types.map((x) => x.slice(6).toUpperCase()).join('/');
  const m = typeof v === 'string' ? /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(v) : null;
  // Base64 is 4/3 of the bytes; refuse a huge string before decoding it
  if (!m || m[2].length > Math.ceil(L.bytes / 3) * 4 + 4) {
    if (m) throw new ImageError(t('„{key}“ ist größer als {kb} KB', { key: L.key, kb: L.bytes / 1024 }));
    throw new ImageError(t('„{key}“ muss ein {types}-Bild als data:-Adresse mit Base64 sein', { key: L.key, types }));
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(m[2]);
  } catch {
    throw new ImageError(t('„{key}“ muss ein {types}-Bild als data:-Adresse mit Base64 sein', { key: L.key, types }));
  }
  return checkImageBytes(bytes, kind, m[1]);
}
