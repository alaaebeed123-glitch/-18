import type { AnnotationPoint } from './types';

export const PALM_REJECTION_COOLDOWN_MS = 780;
const PALM_MIN_CONTACT_PX = 22;

export interface PointerGateEventLike {
  pointerType: string;
  width?: number;
  height?: number;
  isPrimary?: boolean;
}

/**
 * Evaluates whether an incoming `pointerdown` should be ignored due to:
 * 1) `pencilOnlyMode` enabled (rejects `touch` contacts so fingers pan/zoom normally), or
 * 2) Automatic Smart Palm Rejection (rejects broad palm contacts or touches arriving
 *    while/shortly after stylus activity).
 */
export function shouldIgnoreTouchForPalmOrPencilOnly(
  e: PointerGateEventLike,
  pencilOnlyMode: boolean,
  lastPenActivityAtMs: number,
  hasActivePenPointer: boolean,
  nowMs = performance.now()
): boolean {
  if (e.pointerType !== 'touch') {
    return false;
  }
  if (pencilOnlyMode) {
    return true;
  }
  if (hasActivePenPointer) {
    return true;
  }
  const w = e.width ?? 0;
  const h = e.height ?? 0;
  if (w >= PALM_MIN_CONTACT_PX || h >= PALM_MIN_CONTACT_PX) {
    return true;
  }
  if (lastPenActivityAtMs > 0 && nowMs - lastPenActivityAtMs < PALM_REJECTION_COOLDOWN_MS) {
    return true;
  }
  return false;
}

export interface StylusSampleLike {
  pointerType: string;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
}

export function buildStylusPointMeta(
  ev: StylusSampleLike
): Pick<AnnotationPoint, 'pressure' | 'tiltX' | 'tiltY'> {
  if (ev.pointerType !== 'pen') {
    return { pressure: 0.5 };
  }
  const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
  const tx = typeof ev.tiltX === 'number' && Number.isFinite(ev.tiltX) ? Math.round(ev.tiltX) : 0;
  const ty = typeof ev.tiltY === 'number' && Number.isFinite(ev.tiltY) ? Math.round(ev.tiltY) : 0;
  if (tx !== 0 || ty !== 0) {
    return { pressure, tiltX: tx, tiltY: ty };
  }
  return { pressure };
}

export interface WebInkStyle {
  color: string;
  diameter: number;
}

export interface WebInkPresenterLike {
  updateInkTrailStartPoint(event: PointerEvent, style: WebInkStyle): void;
}

interface NavigatorWithInk {
  ink?: {
    requestPresenter?: (options: { presentationArea: Element }) => Promise<WebInkPresenterLike | null>;
  };
}

export function isWebInkApiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as NavigatorWithInk).ink?.requestPresenter === 'function'
  );
}

export async function requestWebInkPresenter(
  canvas: HTMLCanvasElement
): Promise<WebInkPresenterLike | null> {
  if (!isWebInkApiSupported()) return null;
  try {
    const presenter = await (navigator as NavigatorWithInk).ink!.requestPresenter!({
      presentationArea: canvas,
    });
    if (presenter && typeof presenter.updateInkTrailStartPoint === 'function') {
      return presenter;
    }
    return null;
  } catch {
    return null;
  }
}

export function createDraftCanvasContext(
  canvas: HTMLCanvasElement
): CanvasRenderingContext2D | null {
  return canvas.getContext('2d');
}

export function hexToInkRgba(color: string, alpha = 1): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 0.999) return color;
  const clean = color.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (full.length === 6) {
    const num = parseInt(full, 16);
    if (!Number.isNaN(num)) {
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  return color;
}

