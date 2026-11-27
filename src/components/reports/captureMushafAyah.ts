import {
  captureElementCanvas,
  ensureBrowserFontsReady,
  getEmbeddedFontsCssText,
  resolveCaptureScale,
} from '../annotation/pdfExport';
import {
  drawAppleHighlighterStroke,
  drawApplePenStroke,
  type RenderTransform,
} from '../annotation/strokeEngine';
import type { AnnotationStroke } from '../annotation/types';

export interface CaptureMushafAyahParams {
  pageBorderInnerEl: HTMLElement;
  pageBodyEl: HTMLElement;
  surahId: number;
  ayahNum: number;
  strokes: ReadonlyArray<AnnotationStroke>;
  backgroundHex?: string;
}

export interface CapturedAyahVisualResult {
  imageDataUrl: string;
  imageAspectRatio: number;
}

function shouldIncludeCaptureNode(node: Node): boolean {
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

/**
 * Captures the exact Mushaf line(s) containing the target Ayah TOGETHER WITH
 * all teacher pen, fountain, pencil, highlighter, and tape annotations drawn on top.
 */
export async function captureMushafAyahVisual(
  params: CaptureMushafAyahParams
): Promise<CapturedAyahVisualResult> {
  const {
    pageBorderInnerEl,
    pageBodyEl,
    surahId,
    ayahNum,
    strokes,
    backgroundHex = '#FCF8EE',
  } = params;

  const targetKey = `${surahId}:${ayahNum}`;
  const targetNodes = Array.from(
    pageBodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${targetKey}"]`)
  );

  if (targetNodes.length === 0) {
    throw new Error('لم يتم العثور على الآية المحددة في الصفحة الحالية.');
  }

  const rowSet = new Set<HTMLElement>();
  for (const node of targetNodes) {
    const row = node.closest<HTMLElement>('.mushaf-line-row');
    if (row) {
      rowSet.add(row);
    }
  }

  const rows = Array.from(rowSet);
  if (rows.length === 0) {
    throw new Error('تعذّر تحديد سطور الآية للالتقاط.');
  }

  const innerRect = pageBorderInnerEl.getBoundingClientRect();
  const bodyRect = pageBodyEl.getBoundingClientRect();
  const innerW = Math.max(1, Math.round(innerRect.width));
  const innerH = Math.max(1, Math.round(innerRect.height));

  let minRowTop = Number.POSITIVE_INFINITY;
  let maxRowBottom = Number.NEGATIVE_INFINITY;
  const dimmedSiblingTokens: HTMLElement[] = [];

  for (const row of rows) {
    const rRect = row.getBoundingClientRect();
    if (rRect.top < minRowTop) minRowTop = rRect.top;
    if (rRect.bottom > maxRowBottom) maxRowBottom = rRect.bottom;

    // Dim non-target Ayah tokens on shared boundary lines so the mistake Ayah stands out clearly
    const allTokensInRow = Array.from(row.querySelectorAll<HTMLElement>('[data-ayah-key]'));
    for (const token of allTokensInRow) {
      if (token.dataset.ayahKey !== targetKey) {
        dimmedSiblingTokens.push(token);
      }
    }
  }

  await ensureBrowserFontsReady();
  await getEmbeddedFontsCssText();

  // Read live canvas fallback dimensions before capture in case vector strokes are empty
  const liveHlCanvas = pageBorderInnerEl.querySelector<HTMLCanvasElement>(
    '.annotation-canvas.is-highlighter-layer'
  );
  const livePenCanvas = pageBorderInnerEl.querySelector<HTMLCanvasElement>(
    '.annotation-canvas.is-pen-layer'
  );

  let domCanvas: HTMLCanvasElement;
  pageBorderInnerEl.classList.add('is-report-capturing');
  for (const token of dimmedSiblingTokens) {
    token.setAttribute('data-report-dim', 'true');
  }

  try {
    const captureScale = resolveCaptureScale(innerW, innerH);
    domCanvas = await captureElementCanvas(
      pageBorderInnerEl,
      innerW,
      innerH,
      captureScale,
      backgroundHex,
      shouldIncludeCaptureNode
    );
  } finally {
    pageBorderInnerEl.classList.remove('is-report-capturing');
    for (const token of dimmedSiblingTokens) {
      token.removeAttribute('data-report-dim');
    }
  }

  // Composite exact teacher annotations over the captured Mushaf page
  const composite = document.createElement('canvas');
  composite.width = Math.max(1, domCanvas.width);
  composite.height = Math.max(1, domCanvas.height);

  const compCtx = composite.getContext('2d');
  if (!compCtx) {
    domCanvas.width = 0;
    domCanvas.height = 0;
    throw new Error('تعذّر تهيئة لوحة الالتقاط.');
  }

  compCtx.fillStyle = backgroundHex;
  compCtx.fillRect(0, 0, composite.width, composite.height);
  compCtx.drawImage(domCanvas, 0, 0, composite.width, composite.height);

  domCanvas.width = 0;
  domCanvas.height = 0;

  const actualScaleX = composite.width / innerW;
  const actualScaleY = composite.height / innerH;

  if (strokes.length > 0) {
    const tf: RenderTransform = {
      scaleX: innerW / 1000,
      scaleY: innerH / 1000,
      offsetX: 0,
      offsetY: 0,
      unitScale: Math.max(0.55, Math.min(1.65, innerW / 920)),
    };

    const hasHl = strokes.some((s) => s.kind === 'highlighter');
    const hasPen = strokes.some((s) => s.kind !== 'highlighter');

    if (hasHl) {
      const hlCanvas = document.createElement('canvas');
      hlCanvas.width = composite.width;
      hlCanvas.height = composite.height;
      const hlCtx = hlCanvas.getContext('2d');
      const scratch = document.createElement('canvas');
      if (hlCtx) {
        for (let i = 0; i < strokes.length; i++) {
          const st = strokes[i];
          if (st.kind === 'highlighter') {
            drawAppleHighlighterStroke(hlCtx, scratch, st, tf, actualScaleX, actualScaleY, false);
          }
        }
        compCtx.save();
        compCtx.globalCompositeOperation = 'multiply';
        compCtx.drawImage(hlCanvas, 0, 0, composite.width, composite.height);
        compCtx.restore();
      }
      hlCanvas.width = 0;
      hlCanvas.height = 0;
      scratch.width = 0;
      scratch.height = 0;
    }

    if (hasPen) {
      const penCanvas = document.createElement('canvas');
      penCanvas.width = composite.width;
      penCanvas.height = composite.height;
      const penCtx = penCanvas.getContext('2d');
      if (penCtx) {
        penCtx.save();
        penCtx.scale(actualScaleX, actualScaleY);
        for (let i = 0; i < strokes.length; i++) {
          const st = strokes[i];
          if (st.kind !== 'highlighter') {
            drawApplePenStroke(penCtx, st, tf, false, undefined, true);
          }
        }
        penCtx.restore();
        compCtx.drawImage(penCanvas, 0, 0, composite.width, composite.height);
      }
      penCanvas.width = 0;
      penCanvas.height = 0;
    }
  } else {
    if (liveHlCanvas && liveHlCanvas.width > 0 && liveHlCanvas.height > 0) {
      compCtx.save();
      compCtx.globalCompositeOperation = 'multiply';
      compCtx.drawImage(liveHlCanvas, 0, 0, composite.width, composite.height);
      compCtx.restore();
    }
    if (livePenCanvas && livePenCanvas.width > 0 && livePenCanvas.height > 0) {
      compCtx.drawImage(livePenCanvas, 0, 0, composite.width, composite.height);
    }
  }

  // Crop precisely around the Ayah line rows + generous breathing room for upper/lower diacritics & pen marks
  const padX = 14;
  const padY = 9;
  const relLeft = Math.max(0, bodyRect.left - innerRect.left - padX);
  const relRight = Math.min(innerW, bodyRect.right - innerRect.left + padX);
  const relTop = Math.max(0, minRowTop - innerRect.top - padY);
  const relBottom = Math.min(innerH, maxRowBottom - innerRect.top + padY);

  const srcX = Math.max(0, Math.floor(relLeft * actualScaleX));
  const srcY = Math.max(0, Math.floor(relTop * actualScaleY));
  const srcW = Math.max(24, Math.min(composite.width - srcX, Math.ceil((relRight - relLeft) * actualScaleX)));
  const srcH = Math.max(24, Math.min(composite.height - srcY, Math.ceil((relBottom - relTop) * actualScaleY)));

  // Cap stored PNG width to 1440px (keeps sharp 2x+ print clarity while staying compact in storage)
  const maxOutWidth = 1440;
  const downScale = srcW > maxOutWidth ? maxOutWidth / srcW : 1;
  const outW = Math.max(1, Math.round(srcW * downScale));
  const outH = Math.max(1, Math.round(srcH * downScale));

  const cropped = document.createElement('canvas');
  cropped.width = outW;
  cropped.height = outH;
  const cropCtx = cropped.getContext('2d');
  if (!cropCtx) {
    composite.width = 0;
    composite.height = 0;
    throw new Error('تعذّر اقتصاص صورة الآية.');
  }

  cropCtx.fillStyle = backgroundHex;
  cropCtx.fillRect(0, 0, outW, outH);
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';
  cropCtx.drawImage(composite, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

  composite.width = 0;
  composite.height = 0;

  const imageDataUrl = cropped.toDataURL('image/png');
  const imageAspectRatio = outW / outH;
  cropped.width = 0;
  cropped.height = 0;

  return {
    imageDataUrl,
    imageAspectRatio,
  };
}
