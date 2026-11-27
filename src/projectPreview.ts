// Vorschau für den internen Öffnen-Dialog: Projekttext einlesen (KizamuBeam oder
// LightBurn) bzw. SVG über den Vektor-Import abbilden und eine Seite auf ein Canvas
// zeichnen — ohne Editor-Nebenwirkungen (kein Tab, keine Job-Übernahme,
// keine Schrift-Rückfragen, kein globales Asset-Register).
import { isOff, loadDoc, pageName, visibleLeaves, PALETTE, DEFAULT_ADJUST, type Layer, type Mat, type Obj, type ImageShape, type TextShape } from './model';
import { boundsOf, drawText, shapeSubs, subsToPath2D } from './geom';
import { convertLbrn, isLbrn } from './lbrn';
import { importSvg, type ImportResult, type SvgDpi } from './importers';
import { flipImageV } from './images';

export interface PreviewPage {
  name: string;
  objs: Obj[];
}

export interface PreviewProject {
  /** Dateiname zur Anzeige */
  fileName: string;
  pages: PreviewPage[];
  /** Gespeicherte aktive Seite (KizamuBeam) bzw. 0 */
  startPage: number;
  layers: Record<number, Layer>;
  /** Bilddaten dieser Datei (Asset-ID → data:-URL), lokal zur Vorschau */
  assets: Map<string, string>;
  bed: { w: number; h: number };
}

/** Projekttext für die Vorschau einlesen; wirft bei ungültigen Daten (deutsch, wie der Import). */
export async function parsePreviewProject(
  text: string,
  fileName: string,
  bed: { w: number; h: number },
  svgDpi?: SvgDpi,
): Promise<PreviewProject> {
  if (/\.svg$/i.test(fileName)) {
    return svgPreviewProject(importSvg(text, { svgDpi }), fileName, bed);
  }
  if (isLbrnFile(fileName, text)) {
    const assets = new Map<string, string>();
    let n = 0;
    const r = await convertLbrn(text, {
      bedH: bed.h,
      assetId: async (url) => {
        const id = `preview-${n++}`;
        assets.set(id, url);
        return id;
      },
      flipImage: flipImageV,
    });
    const named = new Map<string, string>();
    for (const [id, url] of assets) named.set(id, url);
    for (const [id, url] of Object.entries(r.assets)) named.set(id, url);
    return {
      fileName,
      pages: [{ name: pageName(0), objs: r.objs }],
      startPage: 0,
      layers: r.layers as Record<number, Layer>,
      assets: named,
      bed: { ...bed },
    };
  }
  const doc = loadDoc(JSON.parse(text));
  const assets = new Map<string, string>();
  if (doc.assets) for (const [id, url] of Object.entries(doc.assets)) assets.set(id, url);
  return {
    fileName,
    pages: doc.pages.map((p, i) => ({ name: p.name || pageName(i), objs: p.objs })),
    startPage: Math.min(Math.max(0, doc.page), Math.max(0, doc.pages.length - 1)),
    layers: doc.layers,
    assets,
    bed: { ...doc.bed },
  };
}

const isLbrnFile = (fileName: string, text: string): boolean => {
  try {
    return /\.lbrn2?$/i.test(fileName) || isLbrn(text);
  } catch {
    return /\.lbrn2?$/i.test(fileName);
  }
};

/** SVG-Vorschau über den Vektor-Import abbilden (reine Abbildung, ohne Editor). */
export function svgPreviewProject(
  res: ImportResult,
  fileName: string,
  bed: { w: number; h: number },
): PreviewProject {
  const assets = new Map<string, string>();
  const objs: Obj[] = res.items.map((it, i) => {
    if (it.kind === 'path') {
      return { id: -1000 - i, m: [1, 0, 0, 1, 0, 0] as Mat, layer: it.layer, shape: { kind: 'path', subs: it.subs } };
    }
    const id = `svg-img-${i}`;
    // Nur eingebettete Bilder (data:-URL) lassen sich ohne Dateizugriff zeigen
    if (it.href.startsWith('data:')) assets.set(id, it.href);
    const shape: ImageShape = { kind: 'image', asset: id, w: 1, h: 1, pxW: 1, pxH: 1, adjust: { ...DEFAULT_ADJUST } };
    return { id: -2000 - i, m: it.m, layer: it.layer, shape };
  });
  return { fileName, pages: [{ name: '', objs }], startPage: 0, layers: {}, assets, bed: { ...bed } };
}

/** Blätter dieser Seite samt Welt-Matrix, ohne ausgeblendete Objekte und ohne ausgeblendete Ebenen. */
export function* previewLeaves(objs: Obj[], layers: Record<number, Layer>): Generator<[Obj, Mat]> {
  for (const [o, m] of visibleLeaves(objs)) {
    if (layers[o.layer]?.show === false) continue;
    yield [o, m];
  }
}

/** Ausschnitt der sichtbaren Blätter (null bei leerer Seite). */
export function previewBounds(objs: Obj[], layers: Record<number, Layer>) {
  return boundsOf(filterVisibleTree(objs, layers));
}

/** Objektbaum ohne ausgeblendete Objekte und Ebenen (flache Kopien von Gruppen, Blätter geteilt). */
export function filterVisibleTree(objs: Obj[], layers: Record<number, Layer>): Obj[] {
  const out: Obj[] = [];
  for (const o of objs) {
    if (isOff(o)) continue;
    if (o.shape.kind === 'group') {
      const kids = filterVisibleTree(o.shape.children, layers);
      if (kids.length) out.push({ ...o, shape: { ...o.shape, children: kids } });
      continue;
    }
    if (layers[o.layer]?.show === false) continue;
    out.push(o);
  }
  return out;
}

/** Eine Vorschau-Seite auf das Canvas zeichnen (CSS-Pixel-Maße, dpr für Schärfe). */
export function drawPreviewPage(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  page: PreviewPage,
  layers: Record<number, Layer>,
  images: Map<string, HTMLImageElement | null>,
  bed: { w: number; h: number },
): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const leaves = [...previewLeaves(page.objs, layers)];
  const box = boundsOf(filterVisibleTree(page.objs, layers));
  // Auch eine leere Seite zeigt das Bett als Orientierung
  const fit = box ?? { x: 0, y: 0, w: Math.max(bed.w, 1), h: Math.max(bed.h, 1) };
  const pad = 12;
  const s = Math.min((cssW - pad * 2) / Math.max(fit.w, 0.5), (cssH - pad * 2) / Math.max(fit.h, 0.5));
  const ox = (cssW - fit.w * s) / 2 - fit.x * s;
  const oy = (cssH - fit.h * s) / 2 - fit.y * s;
  ctx.save();
  // Bett als Orientierung (Datei-Bett, nicht Geräte-Bett)
  ctx.strokeStyle = 'rgba(128,128,128,0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(ox, oy, Math.max(bed.w * s, 1), Math.max(bed.h * s, 1));
  ctx.setLineDash([]);
  const px = 1 / s;
  for (const [o, m] of leaves) {
    const wm: Mat = [m[0] * s, m[1] * s, m[2] * s, m[3] * s, ox + m[4] * s, oy + m[5] * s];
    const color = PALETTE[o.layer] ?? '#888888';
    const sh = o.shape;
    if (sh.kind === 'text') {
      ctx.strokeStyle = ctx.fillStyle = color;
      drawText(ctx, sh as TextShape, wm, 'fill', px);
      continue;
    }
    if (sh.kind === 'image') {
      const img = images.get((sh as ImageShape).asset);
      ctx.save();
      ctx.transform(wm[0], wm[1], wm[2], wm[3], wm[4], wm[5]);
      if (img) {
        try {
          ctx.drawImage(img, 0, 0, (sh as ImageShape).w, (sh as ImageShape).h);
        } catch {
          ctx.fillStyle = 'rgba(128,128,128,0.25)';
          ctx.fillRect(0, 0, (sh as ImageShape).w, (sh as ImageShape).h);
        }
      } else {
        ctx.fillStyle = 'rgba(128,128,128,0.25)';
        ctx.fillRect(0, 0, (sh as ImageShape).w, (sh as ImageShape).h);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = px;
      ctx.strokeRect(0, 0, (sh as ImageShape).w, (sh as ImageShape).h);
      ctx.restore();
      continue;
    }
    const subs = shapeSubs(sh);
    if (!subs.length) continue;
    const p = new Path2D();
    p.addPath(subsToPath2D(subs), new DOMMatrix(wm));
    const closed = subs.every((sp) => sp.closed);
    if (closed) {
      ctx.fillStyle = color + '22';
      try {
        ctx.fill(p, 'evenodd');
      } catch {
        ctx.fill(p);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(px, 0.12 * px + 0.4 / s);
    ctx.stroke(p);
  }
  ctx.restore();
}

/** data:-URLs dieser Vorschau zu Bildern dekodieren (defekte als null markiert). */
export async function decodePreviewImages(
  assets: Map<string, string>,
  token: { cancelled: boolean },
): Promise<Map<string, HTMLImageElement | null>> {
  const out = new Map<string, HTMLImageElement | null>();
  const jobs: Promise<void>[] = [];
  for (const [id, url] of assets) {
    if (!url.startsWith('data:')) {
      out.set(id, null);
      continue;
    }
    jobs.push(
      (async () => {
        try {
          const img = new Image();
          img.decoding = 'async';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Bild defekt'));
            img.src = url;
          });
          if (!token.cancelled) out.set(id, img);
        } catch {
          if (!token.cancelled) out.set(id, null);
        }
      })(),
    );
    // Viele Bilder nicht alle gleichzeitig dekodieren
    if (jobs.length >= 8) {
      await Promise.all(jobs.splice(0, jobs.length));
      if (token.cancelled) return out;
    }
  }
  await Promise.all(jobs);
  return out;
}
