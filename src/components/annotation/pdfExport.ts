import { jsPDF } from 'jspdf';
import { domToCanvas } from 'modern-screenshot';
import {
  drawAppleHighlighterStroke,
  drawApplePenStroke,
  type RenderTransform,
} from './strokeEngine';
import type { AnnotationStroke } from './types';

export type ExportFileFormat = 'pdf' | 'png';

export interface PdfExportTarget {
  surfaceId: string;
  strokes: ReadonlyArray<AnnotationStroke>;
  pageElement: HTMLElement | null;
  overlayElement: HTMLElement | null;
  isBounded: boolean;
  backgroundHex?: string;
  fallbackHlCanvas?: HTMLCanvasElement | null;
  fallbackPenCanvas?: HTMLCanvasElement | null;
  includeAnnotations?: boolean;
}

export interface SurfaceExportOptions {
  format?: ExportFileFormat;
  filename?: string;
  includeAnnotations?: boolean;
}

export interface MultiPagePdfExportOptions {
  totalPages: number;
  renderPage: (index: number) => Promise<PdfExportTarget | null>;
  filename: string;
  includeAnnotations?: boolean;
  onProgress?: (current: number, total: number) => void;
}

const EMBEDDABLE_FONT_FAMILIES = new Set([
  'cairo',
  'ibm plex sans arabic',
  'amiri',
  'amiri quran',
  'tajawal',
  'lemonada',
  'alyamama',
  'baloo bhaijaan 2',
  'scheherazade new',
  'noto naskh arabic',
  'reem kufi',
  'almarai',
  'zain',
  'kufam',
]);

let cachedFontsCssPromise: Promise<string> | null = null;

function shouldKeepUnicodeRange(unicodeRange: string | undefined): boolean {
  if (!unicodeRange) return true;
  const upper = unicodeRange.toUpperCase();
  return (
    upper.includes('U+06') ||
    upper.includes('U+075') ||
    upper.includes('U+08A') ||
    upper.includes('U+FB5') ||
    upper.includes('U+FE7') ||
    upper.includes('U+0000') ||
    upper.includes('U+0020') ||
    upper.includes('U+0030') ||
    upper.includes('U+0041') ||
    upper.includes('U+0061') ||
    upper.includes('U+0-FF') ||
    upper.includes('U+200') ||
    upper.includes('U+201') ||
    upper.includes('U+202')
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert font blob to data URL.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchAsText(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

interface ParsedFontFaceEntry {
  rawFamily: string;
  familyName: string;
  srcVal: string;
  fontWeight: string;
  fontStyle: string;
  unicodeRange: string;
  baseHref: string;
  rawCssText?: string;
}

function parseFontFaceBlocksFromCssText(cssText: string, baseHref: string): ParsedFontFaceEntry[] {
  const entries: ParsedFontFaceEntry[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(cssText)) !== null) {
    const body = match[1];
    const familyMatch = body.match(/font-family\s*:\s*([^;]+)/i);
    const srcMatch = body.match(/src\s*:\s*([^;]+)/i);
    if (!familyMatch || !srcMatch) continue;
    const rawFamily = familyMatch[1].trim();
    const familyName = rawFamily.replace(/["']/g, '').trim().toLowerCase();
    const srcVal = srcMatch[1].trim();
    const weightMatch = body.match(/font-weight\s*:\s*([^;]+)/i);
    const styleMatch = body.match(/font-style\s*:\s*([^;]+)/i);
    const rangeMatch = body.match(/unicode-range\s*:\s*([^;]+)/i);
    entries.push({
      rawFamily,
      familyName,
      srcVal,
      fontWeight: weightMatch ? weightMatch[1].trim() : 'normal',
      fontStyle: styleMatch ? styleMatch[1].trim() : 'normal',
      unicodeRange: rangeMatch ? rangeMatch[1].trim() : '',
      baseHref,
      rawCssText: match[0],
    });
  }
  return entries;
}

async function buildEmbeddedFontsCss(): Promise<string> {
  const rules: string[] = [];

  // Always embed local UthmanicHafs woff2 first so Quranic script never falls back to system fonts
  const hafsDataUrl = await fetchAsDataUrl('/fonts/hafs.18.woff2', 10000);
  if (hafsDataUrl) {
    rules.push(
      `@font-face { font-family: 'UthmanicHafs'; src: url('${hafsDataUrl}') format('woff2'); font-weight: 100 900; font-style: normal; }`
    );
  }

  const collectedEntries: ParsedFontFaceEntry[] = [];
  const styleSheets = Array.from(document.styleSheets);
  const blockedSheetFetches: Promise<void>[] = [];

  for (const sheet of styleSheets) {
    const baseHref = sheet.href || window.location.href;
    let cssRules: CSSRuleList | null = null;
    try {
      cssRules = sheet.cssRules;
    } catch {
      cssRules = null;
    }

    if (cssRules) {
      for (const rule of Array.from(cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const rawFamily = rule.style.getPropertyValue('font-family');
        const familyName = rawFamily.replace(/["']/g, '').trim().toLowerCase();
        const srcVal = rule.style.getPropertyValue('src');
        if (!srcVal) continue;
        collectedEntries.push({
          rawFamily,
          familyName,
          srcVal,
          fontWeight: rule.style.getPropertyValue('font-weight') || 'normal',
          fontStyle: rule.style.getPropertyValue('font-style') || 'normal',
          unicodeRange: rule.style.getPropertyValue('unicode-range') || '',
          baseHref,
          rawCssText: rule.cssText,
        });
      }
    } else if (sheet.href) {
      const sheetUrl = sheet.href;
      blockedSheetFetches.push(
        fetchAsText(sheetUrl, 6000).then((text) => {
          if (!text) return;
          collectedEntries.push(...parseFontFaceBlocksFromCssText(text, sheetUrl));
        })
      );
    }
  }

  if (blockedSheetFetches.length > 0) {
    await Promise.all(blockedSheetFetches);
  }

  const fontTasks: Promise<void>[] = [];
  const seenKeys = new Set<string>();

  for (const entry of collectedEntries) {
    if (!EMBEDDABLE_FONT_FAMILIES.has(entry.familyName)) continue;
    if (!shouldKeepUnicodeRange(entry.unicodeRange)) continue;

    const urlMatches = Array.from(
      entry.srcVal.matchAll(/url\((['"]?)([^'")]+)\1\)(?:\s*format\((['"]?)([^'")]+)\3\))?/g)
    );
    if (urlMatches.length === 0) continue;

    const preferred =
      urlMatches.find((m) => (m[4] || '').toLowerCase() === 'woff2' || m[2].includes('.woff2')) ??
      urlMatches.find((m) => (m[4] || '').toLowerCase() === 'woff' || m[2].includes('.woff')) ??
      urlMatches[0];
    const rawUrl = preferred[2];
    const matchedFormat =
      preferred[4] || (rawUrl.includes('.woff2') ? 'woff2' : rawUrl.includes('.woff') ? 'woff' : '');
    if (!rawUrl) continue;

    if (rawUrl.startsWith('data:')) {
      if (entry.rawCssText) rules.push(entry.rawCssText);
      continue;
    }

    let resolvedUrl = rawUrl;
    try {
      resolvedUrl = new URL(rawUrl, entry.baseHref).toString();
    } catch {
      // keep rawUrl
    }

    const dedupeKey = `${entry.familyName}|${entry.fontWeight}|${entry.fontStyle}|${entry.unicodeRange}|${resolvedUrl}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const formatClause = matchedFormat ? ` format('${matchedFormat}')` : '';
    const rangeCss = entry.unicodeRange ? ` unicode-range: ${entry.unicodeRange};` : '';

    fontTasks.push(
      fetchAsDataUrl(resolvedUrl, 6000).then((dataUrl) => {
        if (!dataUrl) return;
        rules.push(
          `@font-face { font-family: ${entry.rawFamily}; src: url('${dataUrl}')${formatClause}; font-weight: ${entry.fontWeight}; font-style: ${entry.fontStyle};${rangeCss} }`
        );
      })
    );
  }

  await Promise.all(fontTasks);
  return rules.join('\n');
}

export function getEmbeddedFontsCssText(): Promise<string> {
  if (!cachedFontsCssPromise) {
    cachedFontsCssPromise = buildEmbeddedFontsCss().catch(() => '');
  }
  return cachedFontsCssPromise;
}

function shouldIncludeDomNode(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  if (node.hasAttribute('data-annotation-ui')) return false;
  const cl = node.classList;
  if (
    cl.contains('annotation-surface') ||
    cl.contains('annotation-tape-hotspot') ||
    cl.contains('global-annotation-stage') ||
    cl.contains('global-annotation-canvas') ||
    cl.contains('global-laser-canvas') ||
    cl.contains('annotation-tool-cursor') ||
    cl.contains('mushaf-liquid-lens-backdrop') ||
    cl.contains('apple-palette-anchor') ||
    cl.contains('audio-dock-portal')
  ) {
    return false;
  }
  return true;
}

export function buildExportFilename(surfaceId: string, format: ExportFileFormat = 'pdf'): string {
  const ext = format === 'png' ? 'png' : 'pdf';
  const mushafMatch = surfaceId.match(/^mushaf:page:(\d+)$/);
  if (mushafMatch) {
    return `safara-mushaf-page-${mushafMatch[1]}.${ext}`;
  }
  const wbMatch = surfaceId.match(/^whiteboard:page:(.+)$/);
  if (wbMatch) {
    const cleanId = wbMatch[1].replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'board';
    return `safara-whiteboard-${cleanId}.${ext}`;
  }
  const safeName =
    surfaceId
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';
  return `safara-${safeName}.${ext}`;
}

function ensureExtension(filename: string, ext: ExportFileFormat): string {
  const clean = filename.trim() || `safara-export.${ext}`;
  const lower = clean.toLowerCase();
  if (lower.endsWith(`.${ext}`)) return clean;
  return `${clean.replace(/\.(pdf|png)$/i, '')}.${ext}`;
}

export async function ensureBrowserFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    // Proceed even if a remote font failed to load
  }
}

export async function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((result) => resolve(result), 'image/png');
    } catch {
      resolve(null);
    }
  });

  const a = document.createElement('a');
  a.download = filename;
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    return;
  }

  a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function resolveCaptureScale(width: number, height: number): number {
  const desired = 2.5;
  const maxDim = 10500;
  const maxPixels = 28_000_000;
  let scale = desired;
  if (width * scale > maxDim) {
    scale = maxDim / Math.max(1, width);
  }
  if (height * scale > maxDim) {
    scale = Math.min(scale, maxDim / Math.max(1, height));
  }
  if (width * height * scale * scale > maxPixels) {
    scale = Math.min(scale, Math.sqrt(maxPixels / Math.max(1, width * height)));
  }
  return Math.max(1, Math.min(desired, scale));
}

export async function captureElementCanvas(
  el: HTMLElement,
  width: number,
  height: number,
  scale: number,
  backgroundColor: string,
  filterFn?: (node: Node) => boolean
): Promise<HTMLCanvasElement> {
  const isFlatBoundedStage =
    el.classList.contains('mushaf-page-sheet') ||
    el.classList.contains('wb-stage') ||
    el.classList.contains('report-sheet-paper');
  const fontsCss = await getEmbeddedFontsCssText();

  const baseOptions = {
    scale,
    width,
    height,
    backgroundColor,
    ...(filterFn ? { filter: filterFn } : {}),
    maximumCanvasSize: 16384,
    timeout: 15000,
    style: isFlatBoundedStage
      ? {
          margin: '0',
          borderRadius: '0',
          boxShadow: 'none',
        }
      : {
          margin: '0',
        },
  };

  try {
    return await domToCanvas(el, {
      ...baseOptions,
      font: fontsCss ? { cssText: fontsCss } : false,
    });
  } catch (err) {
    console.warn('[pdfExport] Retrying DOM capture without external font embedding:', err);
    return await domToCanvas(el, {
      ...baseOptions,
      font: false,
    });
  }
}

function paintSilkBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const baseGrad = ctx.createLinearGradient(0, 0, w, h);
  baseGrad.addColorStop(0, '#001A75');
  baseGrad.addColorStop(0.45, '#002DB3');
  baseGrad.addColorStop(1, '#00155E');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  const sheen1 = ctx.createRadialGradient(
    w * 0.25,
    h * 0.2,
    0,
    w * 0.25,
    h * 0.2,
    Math.max(w, h) * 0.65
  );
  sheen1.addColorStop(0, 'rgba(59, 133, 255, 0.42)');
  sheen1.addColorStop(1, 'rgba(0, 45, 179, 0)');
  ctx.fillStyle = sheen1;
  ctx.fillRect(0, 0, w, h);

  const sheen2 = ctx.createRadialGradient(
    w * 0.78,
    h * 0.75,
    0,
    w * 0.78,
    h * 0.75,
    Math.max(w, h) * 0.6
  );
  sheen2.addColorStop(0, 'rgba(30, 107, 255, 0.28)');
  sheen2.addColorStop(1, 'rgba(0, 20, 102, 0)');
  ctx.fillStyle = sheen2;
  ctx.fillRect(0, 0, w, h);
}

async function buildAnnotatedPageComposite(target: PdfExportTarget): Promise<{
  canvas: HTMLCanvasElement;
  bgHex: string;
}> {
  const pageEl = target.pageElement;
  const overlayEl = target.overlayElement ?? pageEl;
  const bgHex =
    target.backgroundHex && target.backgroundHex !== 'transparent'
      ? target.backgroundHex
      : target.isBounded
      ? '#FCF8EE'
      : '#002DB3';

  if (pageEl) {
    const pageRect = pageEl.getBoundingClientRect();
    const overlayRect = overlayEl ? overlayEl.getBoundingClientRect() : pageRect;

    const pageW = Math.max(
      1,
      Math.round(target.isBounded ? pageRect.width : Math.max(pageEl.scrollWidth, pageRect.width))
    );
    const pageH = Math.max(
      1,
      Math.round(target.isBounded ? pageRect.height : Math.max(pageEl.scrollHeight, pageRect.height))
    );

    const overlayW = Math.max(1, target.isBounded ? overlayRect.width : pageW);
    const overlayH = Math.max(1, target.isBounded ? overlayRect.height : pageH);
    const overlayOffsetX = target.isBounded ? overlayRect.left - pageRect.left : 0;
    const overlayOffsetY = target.isBounded ? overlayRect.top - pageRect.top : 0;

    const captureScale = resolveCaptureScale(pageW, pageH);
    const domCanvas = await captureElementCanvas(
      pageEl,
      pageW,
      pageH,
      captureScale,
      target.isBounded ? bgHex : 'rgba(0, 0, 0, 0)',
      shouldIncludeDomNode
    );

    const composite = document.createElement('canvas');
    composite.width = Math.max(1, domCanvas.width);
    composite.height = Math.max(1, domCanvas.height);

    const compCtx = composite.getContext('2d');
    if (!compCtx) {
      throw new Error('Could not initialize 2D canvas context for PDF export.');
    }

    if (target.isBounded) {
      compCtx.fillStyle = bgHex;
      compCtx.fillRect(0, 0, composite.width, composite.height);
    } else {
      paintSilkBackdrop(compCtx, composite.width, composite.height);
    }
    compCtx.drawImage(domCanvas, 0, 0, composite.width, composite.height);

    const actualScaleX = composite.width / pageW;
    const actualScaleY = composite.height / pageH;
    const drawX = overlayOffsetX * actualScaleX;
    const drawY = overlayOffsetY * actualScaleY;
    const overlayPxW = Math.max(1, Math.round(overlayW * actualScaleX));
    const overlayPxH = Math.max(1, Math.round(overlayH * actualScaleY));

    const includeAnnotations = target.includeAnnotations !== false;
    const strokes = includeAnnotations ? target.strokes : [];
    if (strokes.length > 0) {
      const tf: RenderTransform = target.isBounded
        ? {
            scaleX: overlayW / 1000,
            scaleY: overlayH / 1000,
            offsetX: 0,
            offsetY: 0,
            unitScale: Math.max(0.55, Math.min(1.65, overlayW / 920)),
          }
        : {
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
            unitScale: 1,
          };

      const hasHl = strokes.some((s) => s.kind === 'highlighter');
      const hasPen = strokes.some((s) => s.kind !== 'highlighter');

      if (hasHl) {
        const hlCanvas = document.createElement('canvas');
        hlCanvas.width = overlayPxW;
        hlCanvas.height = overlayPxH;
        const hlCtx = hlCanvas.getContext('2d');
        const scratchCanvas = document.createElement('canvas');
        if (hlCtx) {
          for (let i = 0; i < strokes.length; i++) {
            const st = strokes[i];
            if (st.kind === 'highlighter') {
              drawAppleHighlighterStroke(
                hlCtx,
                scratchCanvas,
                st,
                tf,
                actualScaleX,
                actualScaleY,
                false
              );
            }
          }
          compCtx.save();
          if (target.isBounded) {
            compCtx.beginPath();
            compCtx.rect(drawX, drawY, overlayPxW, overlayPxH);
            compCtx.clip();
          }
          compCtx.globalCompositeOperation = 'multiply';
          compCtx.drawImage(hlCanvas, drawX, drawY, overlayPxW, overlayPxH);
          compCtx.restore();
        }
      }

      if (hasPen) {
        const penCanvas = document.createElement('canvas');
        penCanvas.width = overlayPxW;
        penCanvas.height = overlayPxH;
        const penCtx = penCanvas.getContext('2d');
        if (penCtx) {
          penCtx.save();
          penCtx.scale(actualScaleX, actualScaleY);
          for (let i = 0; i < strokes.length; i++) {
            const st = strokes[i];
            if (st.kind !== 'highlighter') {
              drawApplePenStroke(penCtx, st, tf, false, undefined, target.isBounded);
            }
          }
          penCtx.restore();
          compCtx.save();
          if (target.isBounded) {
            compCtx.beginPath();
            compCtx.rect(drawX, drawY, overlayPxW, overlayPxH);
            compCtx.clip();
          }
          compCtx.drawImage(penCanvas, drawX, drawY, overlayPxW, overlayPxH);
          compCtx.restore();
        }
      }
    } else if (
      includeAnnotations &&
      target.fallbackPenCanvas &&
      target.fallbackPenCanvas.width > 0 &&
      target.fallbackPenCanvas.height > 0
    ) {
      if (
        target.fallbackHlCanvas &&
        target.fallbackHlCanvas.width > 0 &&
        target.fallbackHlCanvas.height > 0
      ) {
        compCtx.save();
        compCtx.globalCompositeOperation = 'multiply';
        compCtx.drawImage(target.fallbackHlCanvas, drawX, drawY, overlayPxW, overlayPxH);
        compCtx.restore();
      }
      compCtx.drawImage(target.fallbackPenCanvas, drawX, drawY, overlayPxW, overlayPxH);
    }

    // For non-bounded pages anchored to `.app`, crop out the top `#main-header`
    if (!target.isBounded) {
      const appHeader = document.getElementById('main-header');
      if (appHeader) {
        const headerRect = appHeader.getBoundingClientRect();
        if (headerRect.height > 8 && headerRect.top >= pageRect.top - 4) {
          const cropTopPx = Math.round((headerRect.bottom - pageRect.top + 6) * actualScaleY);
          if (cropTopPx > 0 && cropTopPx < composite.height - 120) {
            const cropped = document.createElement('canvas');
            cropped.width = composite.width;
            cropped.height = composite.height - cropTopPx;
            const cCtx = cropped.getContext('2d');
            if (cCtx) {
              cCtx.drawImage(
                composite,
                0,
                cropTopPx,
                composite.width,
                cropped.height,
                0,
                0,
                cropped.width,
                cropped.height
              );
              return { canvas: cropped, bgHex };
            }
          }
        }
      }
    }

    return { canvas: composite, bgHex };
  }

  if (
    target.fallbackPenCanvas &&
    target.fallbackPenCanvas.width > 0 &&
    target.fallbackPenCanvas.height > 0
  ) {
    const composite = document.createElement('canvas');
    composite.width = target.fallbackPenCanvas.width;
    composite.height = target.fallbackPenCanvas.height;
    const ctx = composite.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context.');
    }
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, composite.width, composite.height);
    if (target.includeAnnotations !== false) {
      if (
        target.fallbackHlCanvas &&
        target.fallbackHlCanvas.width > 0 &&
        target.fallbackHlCanvas.height > 0
      ) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(target.fallbackHlCanvas, 0, 0, composite.width, composite.height);
        ctx.restore();
      }
      ctx.drawImage(target.fallbackPenCanvas, 0, 0, composite.width, composite.height);
    }
    return { canvas: composite, bgHex };
  }

  throw new Error('No printable surface available.');
}

export async function exportSurfaceToFile(
  target: PdfExportTarget,
  options: SurfaceExportOptions = {}
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Export requires a browser environment.');
  }

  const format: ExportFileFormat = options.format ?? 'pdf';
  const includeAnnotations = options.includeAnnotations ?? target.includeAnnotations ?? true;

  await ensureBrowserFontsReady();
  await getEmbeddedFontsCssText();

  const { canvas: contentCanvas } = await buildAnnotatedPageComposite({
    ...target,
    includeAnnotations,
  });

  const filename = ensureExtension(
    options.filename || buildExportFilename(target.surfaceId, format),
    format
  );

  if (format === 'png') {
    await downloadCanvasAsPng(contentCanvas, filename);
    contentCanvas.width = 0;
    contentCanvas.height = 0;
    return filename;
  }

  const cw = contentCanvas.width;
  const ch = contentCanvas.height;
  const contentAspect = ch / Math.max(1, cw);

  const pdfWidthPt = 595.28; // Standard A4 width in points
  const a4HeightPt = 841.89;

  let pdf: jsPDF;

  // Bounded pages (Quran Mushaf pages & Whiteboard) and single-screen views export directly
  // 1:1 full-bleed with exact proportions — no extra top logo banner, footer, or outer margins.
  if (target.isBounded || contentAspect <= 2.2) {
    const pdfHeightPt = Math.max(120, Math.round(pdfWidthPt * contentAspect * 100) / 100);
    pdf = new jsPDF({
      orientation: pdfWidthPt > pdfHeightPt ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pdfWidthPt, pdfHeightPt],
      compress: true,
    });

    const imgData = contentCanvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, pdfHeightPt, undefined, 'FAST');
  } else {
    const sliceSrcHeight = Math.max(1, Math.floor(cw * (a4HeightPt / pdfWidthPt)));
    pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [pdfWidthPt, a4HeightPt],
      compress: true,
    });

    let cursorY = 0;
    let pageIndex = 0;
    while (cursorY < ch) {
      if (pageIndex > 0) {
        pdf.addPage([pdfWidthPt, a4HeightPt], 'portrait');
      }
      const sh = Math.min(sliceSrcHeight, ch - cursorY);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = cw;
      sliceCanvas.height = sliceSrcHeight;
      const sCtx = sliceCanvas.getContext('2d');
      if (!sCtx) {
        throw new Error('Could not initialize multi-page PDF canvas.');
      }
      sCtx.fillStyle = target.backgroundHex || '#002DB3';
      sCtx.fillRect(0, 0, cw, sliceSrcHeight);
      sCtx.drawImage(contentCanvas, 0, cursorY, cw, sh, 0, 0, cw, sh);

      const imgData = sliceCanvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, a4HeightPt, undefined, 'FAST');
      sliceCanvas.width = 0;
      sliceCanvas.height = 0;

      cursorY += sh;
      pageIndex++;
    }
  }

  contentCanvas.width = 0;
  contentCanvas.height = 0;
  pdf.save(filename);
  return filename;
}

export async function exportSurfaceToPdf(target: PdfExportTarget): Promise<string> {
  return exportSurfaceToFile(target, { format: 'pdf' });
}

export async function exportMultiPagePdf(options: MultiPagePdfExportOptions): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('PDF export requires a browser environment.');
  }

  const { totalPages, renderPage, includeAnnotations = true, onProgress } = options;
  if (totalPages <= 0) {
    throw new Error('No pages selected for PDF export.');
  }

  await ensureBrowserFontsReady();
  await getEmbeddedFontsCssText();

  const pdfWidthPt = 595.28;
  let pdf: jsPDF | null = null;
  let renderedCount = 0;

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);
    const target = await renderPage(i);
    if (!target) continue;

    const { canvas: contentCanvas } = await buildAnnotatedPageComposite({
      ...target,
      includeAnnotations,
    });

    const cw = contentCanvas.width;
    const ch = contentCanvas.height;
    const contentAspect = ch / Math.max(1, cw);
    const pdfHeightPt = Math.max(120, Math.round(pdfWidthPt * contentAspect * 100) / 100);
    const orientation = pdfWidthPt > pdfHeightPt ? 'landscape' : 'portrait';

    if (!pdf) {
      pdf = new jsPDF({
        orientation,
        unit: 'pt',
        format: [pdfWidthPt, pdfHeightPt],
        compress: true,
      });
    } else {
      pdf.addPage([pdfWidthPt, pdfHeightPt], orientation);
    }

    const imgData = contentCanvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, pdfHeightPt, undefined, 'FAST');
    contentCanvas.width = 0;
    contentCanvas.height = 0;
    renderedCount += 1;

    // Yield to browser between pages so UI/progress stays responsive
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  if (!pdf || renderedCount === 0) {
    throw new Error('Could not capture any page for PDF export.');
  }

  const filename = ensureExtension(options.filename, 'pdf');
  pdf.save(filename);
  return filename;
}

export interface ReportExportOptions {
  element: HTMLElement;
  filename: string;
  format?: ExportFileFormat;
  backgroundHex?: string;
}

export async function exportReportElementToFile(options: ReportExportOptions): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Export requires a browser environment.');
  }

  const { element, format = 'pdf', backgroundHex = '#FFFFFF' } = options;
  await ensureBrowserFontsReady();
  await getEmbeddedFontsCssText();

  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(Math.max(element.scrollHeight, rect.height)));
  const scale = resolveCaptureScale(width, height);

  // Measure unbreakable report block boundaries in canvas pixels before rasterizing
  const blocks = Array.from(element.querySelectorAll<HTMLElement>('[data-report-block]')).map((block) => {
    const bRect = block.getBoundingClientRect();
    return {
      top: Math.max(0, bRect.top - rect.top),
      bottom: Math.max(0, bRect.bottom - rect.top),
    };
  });

  const capturedCanvas = await captureElementCanvas(
    element,
    width,
    height,
    scale,
    backgroundHex,
    shouldIncludeDomNode
  );

  const filename = ensureExtension(options.filename, format);
  if (format === 'png') {
    await downloadCanvasAsPng(capturedCanvas, filename);
    capturedCanvas.width = 0;
    capturedCanvas.height = 0;
    return filename;
  }

  const cw = capturedCanvas.width;
  const ch = capturedCanvas.height;
  const scaleX = cw / width;
  const scaleY = ch / height;

  const pdfWidthPt = 595.28; // Standard A4 portrait width
  const a4HeightPt = 841.89; // Standard A4 portrait height
  const maxPageSlicePx = Math.max(1, Math.floor(cw * (a4HeightPt / pdfWidthPt)));
  const padY = Math.round(20 * scaleY);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [pdfWidthPt, a4HeightPt],
    compress: true,
  });

  // Compute smart page slices that prefer breaking right before an unbreakable block rather than splitting it
  const blockPx = blocks.map((b) => ({
    top: Math.floor(b.top * scaleY),
    bottom: Math.ceil(b.bottom * scaleY),
  }));

  let cursorY = 0;
  let pageIdx = 0;

  while (cursorY < ch) {
    if (pageIdx > 0 && ch - cursorY <= Math.round(10 * scaleY)) {
      break;
    }
    if (pageIdx > 0) {
      pdf.addPage([pdfWidthPt, a4HeightPt], 'portrait');
    }

    const hardEnd = Math.min(ch, cursorY + maxPageSlicePx);
    let breakY = hardEnd;

    if (hardEnd < ch) {
      // Find any block that crosses `hardEnd`
      const crossing = blockPx.find(
        (b) => b.top > cursorY + Math.round(40 * scaleY) && b.top < hardEnd && b.bottom > hardEnd
      );
      if (crossing) {
        breakY = Math.max(cursorY + 120, crossing.top - Math.min(padY, crossing.top - cursorY));
      }
    }

    const sliceH = Math.max(1, breakY - cursorY);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = cw;
    sliceCanvas.height = maxPageSlicePx;
    const sCtx = sliceCanvas.getContext('2d');
    if (!sCtx) {
      throw new Error('Could not initialize report A4 canvas.');
    }

    sCtx.fillStyle = backgroundHex;
    sCtx.fillRect(0, 0, cw, maxPageSlicePx);
    sCtx.drawImage(capturedCanvas, 0, cursorY, cw, sliceH, 0, 0, cw, sliceH);

    const imgData = sliceCanvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidthPt, a4HeightPt, undefined, 'FAST');

    sliceCanvas.width = 0;
    sliceCanvas.height = 0;
    cursorY = breakY;
    pageIdx++;
  }

  capturedCanvas.width = 0;
  capturedCanvas.height = 0;
  pdf.save(filename);
  return filename;
}

