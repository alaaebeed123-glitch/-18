import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnnotation, useAnnotationToolState } from './AnnotationContext';
import {
  adjustSnappedShapeOnDrag,
  applyShapeHandleDrag,
  computeShapeCssBounds,
  computeSmoothingProfile,
  createLivePenDraftSession,
  cssBoundsToPixelRect,
  detectHoldShape,
  drawAppleHighlighterStroke,
  drawApplePenStroke,
  drawLassoOverlay,
  drawMagneticSnapIndicator,
  drawShapeSelectionOverlay,
  enforcePerfectShape,
  eraseStrokePartiallyPath,
  findMagneticSnapTarget,
  findScribbleErasedStrokeIds,
  findStrokesInLasso,
  getLiveDraftDpr,
  getStrokeScreenBounds,
  getStrokesGroupBounds,
  hitTestLassoGroupHandle,
  hitTestShapeHandle,
  hitTestShapeStroke,
  hitTestStroke,
  hitTestStrokePath,
  isDarkThemeActive,
  remapPointsAfterShapeEdit,
  renderLiveHighlighterWithSession,
  renderLivePenDraftWithSession,
  renderMorphedShapeStroke,
  reportLiveDrawFrameDuration,
  resetLivePenDraftSession,
  resolveDisplayStrokeColor,
  scaleStrokesInGroup,
  snapInitialShapeToAnchors,
  traceShapePath,
  translateStroke,
  tryMergeTwoStrokeArrow,
  unionPixelRects,
  type CssBounds,
  type LassoGroupHandleId,
  type LivePenDraftSession,
  type PixelRect,
  type RenderTransform,
  type SnapDragBase,
} from './strokeEngine';
import type {
  AnnotationPoint,
  AnnotationShape,
  AnnotationStroke,
  AnnotationStrokeKind,
  AnnotationTool,
  GlobalStrokeAnchor,
} from './types';
import {
  buildStylusPointMeta,
  createDraftCanvasContext,
  shouldIgnoreTouchForPalmOrPencilOnly,
} from './pointerUtils';

interface LaserSample {
  x: number;
  y: number;
  t: number;
}

interface LaserTrail {
  color: string;
  size: number;
  smoothing: number;
  fadeDurationMs: number;
  points: LaserSample[];
  /** Optional universal snapped geometric shape/curve when user pauses briefly with laser */
  shape?: AnnotationShape;
  /** null while the pointer is held down so 100% of the stroke stays visible; timestamped on release to fade out smoothly */
  releasedAt: number | null;
  /** Cached Path2D + bounds to avoid re-smoothing & rebuilding paths on every fade frame */
  cachedRawLen?: number;
  cachedPath?: Path2D | null;
  cachedBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

interface LaserPulse {
  x: number;
  y: number;
  startedAt: number;
  color: string;
}

const LASER_HOLD_AFTER_RELEASE_MS = 200;
const LASER_FADE_DURATION_MS = 1150;
const LASER_PULSE_LIFE_MS = 380;
const HOLD_SNAP_DELAY_MS = 760;
const HOLD_MOVE_THRESHOLD_PX = 3.5;
const HOLD_PATH_RESET_PX = 4.5;
const MAX_GLOBAL_DPR = 1.5;
const MAX_LASER_DPR = 1.5;

const IDENTITY_TRANSFORM: RenderTransform = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  unitScale: 1,
};

function smoothLaserSamples(raw: LaserSample[], smoothingAmount: number): LaserSample[] {
  const n = raw.length;
  if (n <= 2) return raw;

  const profile = computeSmoothingProfile(smoothingAmount, false);
  const minDist = profile.minDistPx;
  let filtered: LaserSample[];
  if (minDist <= 0.05) {
    filtered = raw;
  } else {
    filtered = [raw[0]];
    let lastKept = raw[0];
    for (let i = 1; i < n - 1; i++) {
      const pt = raw[i];
      if (Math.hypot(pt.x - lastKept.x, pt.y - lastKept.y) >= minDist) {
        filtered.push(pt);
        lastKept = pt;
      } else {
        const next = raw[i + 1];
        const v1x = pt.x - lastKept.x;
        const v1y = pt.y - lastKept.y;
        const v2x = next.x - pt.x;
        const v2y = next.y - pt.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (
          l1 > 0.8 &&
          l2 > 0.8 &&
          (v1x * v2x + v1y * v2y) / (l1 * l2) < profile.cuspDotThreshold
        ) {
          filtered.push(pt);
          lastKept = pt;
        }
      }
    }
    filtered.push(raw[n - 1]);
  }

  const m = filtered.length;
  if (m <= 2) return filtered;

  const budget = Math.min(8, profile.passBudget);
  const passes = Math.ceil(budget);
  if (passes <= 0) return filtered;

  let cur = filtered;
  for (let pass = 0; pass < passes; pass++) {
    const passWeight = pass < passes - 1 ? 1.0 : Math.max(0.001, budget - (passes - 1));
    const next: LaserSample[] = new Array(m);
    next[0] = cur[0];
    next[m - 1] = cur[m - 1];
    for (let i = 1; i < m - 1; i++) {
      const prev = cur[i - 1];
      const pt = cur[i];
      const after = cur[i + 1];

      let pBack = i - 1;
      while (pBack > 0 && Math.hypot(pt.x - cur[pBack].x, pt.y - cur[pBack].y) < profile.chordWindowPx) {
        pBack--;
      }
      let pFwd = i + 1;
      while (pFwd < m - 1 && Math.hypot(cur[pFwd].x - pt.x, cur[pFwd].y - pt.y) < profile.chordWindowPx) {
        pFwd++;
      }
      const v1x = pt.x - cur[pBack].x;
      const v1y = pt.y - cur[pBack].y;
      const v2x = cur[pFwd].x - pt.x;
      const v2y = cur[pFwd].y - pt.y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      let cornerFactor = 1.0;
      if (l1 > 0.001 && l2 > 0.001) {
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        cornerFactor = Math.max(profile.minCornerFactor, Math.min(1.0, (dot + 0.15) / 0.85));
      }

      const tx = 0.25 * prev.x + 0.5 * pt.x + 0.25 * after.x;
      const ty = 0.25 * prev.y + 0.5 * pt.y + 0.25 * after.y;

      const alpha = profile.strength * cornerFactor * passWeight;
      next[i] = {
        x: pt.x + (tx - pt.x) * alpha,
        y: pt.y + (ty - pt.y) * alpha,
        t: pt.t,
      };
    }
    cur = next;
  }
  return cur;
}

function buildSmoothLaserPath2D(pts: LaserSample[]): Path2D | null {
  const n = pts.length;
  if (n < 2) return null;
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  if (n === 2) {
    path.lineTo(pts[1].x, pts[1].y);
    return path;
  }
  for (let i = 1; i < n - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) * 0.5;
    const midY = (pts[i].y + pts[i + 1].y) * 0.5;
    path.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  path.lineTo(pts[n - 1].x, pts[n - 1].y);
  return path;
}

const LASER_CHROME_CONTROLS_SELECTOR =
  '[data-annotation-ui="true"], #main-header, .mushaf-sticky-hud, .mushaf-hud-launcher, .mushaf-audio-bar, .audio-dock-portal, .audio-dock-anchor, .audio-orb-anchor, .mushaf-toolbar-row, .mushaf-toolbar, .mushaf-teacher-dock, .mushaf-bookmarks-popover, .mushaf-side-nav-rail, .mushaf-pagination-bar, .mushaf-liquid-lens-header, .mushaf-liquid-lens-footer, .nav-tabs, .topic-dropdown-wrapper, select, input, textarea';

function getElementFromTarget(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isGlobalDrawSelectionTool(tool: AnnotationTool): boolean {
  return (
    tool === 'pen' ||
    tool === 'fountain' ||
    tool === 'pencil' ||
    tool === 'highlighter' ||
    tool === 'tape'
  );
}

interface DocRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SVG_INTERNAL_TAGS = new Set([
  'path',
  'circle',
  'rect',
  'line',
  'polygon',
  'polyline',
  'ellipse',
  'g',
  'defs',
  'use',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
]);

function isGlobalAnchorExcludedElement(el: Element): boolean {
  if (
    el.classList.contains('global-annotation-stage') ||
    el.classList.contains('global-annotation-canvas') ||
    el.classList.contains('global-laser-canvas') ||
    el.classList.contains('global-tape-hotspots-layer') ||
    el.classList.contains('annotation-tape-hotspot')
  ) {
    return true;
  }
  if (el.closest('[data-annotation-ui="true"], #main-header, .global-tape-hotspots-layer')) {
    return true;
  }
  return false;
}

function escapeCssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, '\\$1');
}

function buildStableElementSelector(el: Element, appEl: HTMLElement): string {
  if (el === appEl) return '';
  if (el.id) {
    const idSel = `#${escapeCssId(el.id)}`;
    try {
      if (appEl.querySelectorAll(idSel).length === 1) {
        return idSel;
      }
    } catch {
      // Fall through to structural path
    }
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== appEl) {
    if (cur.id) {
      const idSel = `#${escapeCssId(cur.id)}`;
      try {
        if (appEl.querySelectorAll(idSel).length === 1) {
          const fullSel = parts.length > 0 ? `${idSel} > ${parts.join(' > ')}` : idSel;
          if (appEl.querySelector(fullSel) === el) return fullSel;
        }
      } catch {
        // Keep walking up
      }
    }
    const parent: HTMLElement | null = cur.parentElement;
    if (!parent) break;
    let nth = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      nth++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${nth})`);
    cur = parent;
  }
  if (parts.length === 0) return '';
  const scopedSel = `:scope > ${parts.join(' > ')}`;
  try {
    if (appEl.querySelector(scopedSel) === el) return scopedSel;
  } catch {
    // Fallback to root
  }
  return '';
}

function getRawStrokeDocBounds(stroke: AnnotationStroke): CssBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  if (stroke.shape) {
    const sb = computeShapeCssBounds(stroke.shape, IDENTITY_TRANSFORM, 0);
    if (sb) {
      minX = sb.minX;
      minY = sb.minY;
      maxX = sb.maxX;
      maxY = sb.maxY;
    }
  }
  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

function captureGlobalAnchorForStroke(
  stroke: AnnotationStroke,
  appEl: HTMLElement | null,
  origin: { left: number; top: number; width: number; height: number }
): GlobalStrokeAnchor | undefined {
  if (!appEl || origin.width < 10 || origin.height < 10) return undefined;
  const bounds = getRawStrokeDocBounds(stroke);
  if (bounds && typeof document.elementsFromPoint === 'function') {
    const cMinX = origin.left + bounds.minX;
    const cMaxX = origin.left + bounds.maxX;
    const cMinY = origin.top + bounds.minY;
    const cMaxY = origin.top + bounds.maxY;
    const probePoints: Array<[number, number]> = [
      [(cMinX + cMaxX) * 0.5, (cMinY + cMaxY) * 0.5],
      [cMinX, cMinY],
    ];
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    for (let pi = 0; pi < probePoints.length; pi++) {
      const px = probePoints[pi][0];
      const py = probePoints[pi][1];
      if (px < 0 || py < 0 || px > vw || py > vh) continue;
      const hitEls = document.elementsFromPoint(px, py);
      for (let i = 0; i < hitEls.length; i++) {
        const el = hitEls[i];
        if (el === appEl || !appEl.contains(el)) continue;
        if (isGlobalAnchorExcludedElement(el)) continue;
        if (SVG_INTERNAL_TAGS.has(el.tagName.toLowerCase())) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 24) continue;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'inline') continue;
        if (
          cMinX < r.left - 18 ||
          cMaxX > r.right + 18 ||
          cMinY < r.top - 18 ||
          cMaxY > r.bottom + 18
        ) {
          continue;
        }
        const sel = buildStableElementSelector(el, appEl);
        if (sel !== '') {
          return {
            selector: sel,
            refLeft: r.left - origin.left,
            refTop: r.top - origin.top,
            refWidth: r.width,
            refHeight: r.height,
          };
        }
      }
    }
  }
  return {
    selector: '',
    refLeft: 0,
    refTop: 0,
    refWidth: origin.width,
    refHeight: origin.height,
  };
}

function getAnchorDocRect(
  anchor: GlobalStrokeAnchor,
  appEl: HTMLElement | null,
  origin: { left: number; top: number; width: number; height: number },
  rectCache: Map<string, DocRect | null>
): DocRect | null {
  if (anchor.selector === '') {
    if (origin.width <= 0 || origin.height <= 0) return null;
    return { left: 0, top: 0, width: origin.width, height: origin.height };
  }
  if (rectCache.has(anchor.selector)) {
    return rectCache.get(anchor.selector) ?? null;
  }
  let res: DocRect | null = null;
  if (appEl) {
    try {
      const el = appEl.querySelector(anchor.selector);
      if (el instanceof Element) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          res = {
            left: r.left - origin.left,
            top: r.top - origin.top,
            width: r.width,
            height: r.height,
          };
        }
      }
    } catch {
      res = null;
    }
  }
  rectCache.set(anchor.selector, res);
  return res;
}

function transformAnchoredShape(
  shape: AnnotationShape,
  mapX: (x: number) => number,
  mapY: (y: number) => number,
  scaleX: number,
  scaleY: number
): AnnotationShape {
  switch (shape.type) {
    case 'line':
      return {
        type: 'line',
        x1: mapX(shape.x1),
        y1: mapY(shape.y1),
        x2: mapX(shape.x2),
        y2: mapY(shape.y2),
      };
    case 'arc':
      return {
        type: 'arc',
        x1: mapX(shape.x1),
        y1: mapY(shape.y1),
        cx: mapX(shape.cx),
        cy: mapY(shape.cy),
        x2: mapX(shape.x2),
        y2: mapY(shape.y2),
      };
    case 'ellipse': {
      const cx = mapX(shape.cx);
      const cy = mapY(shape.cy);
      const rot = shape.rotation ?? 0;
      if (!rot || Math.abs(scaleX - scaleY) < 0.01) {
        return {
          ...shape,
          cx,
          cy,
          rx: shape.rx * scaleX,
          ry: shape.ry * scaleY,
          isCircle: shape.isCircle && Math.abs(scaleX - scaleY) < 0.05,
        };
      }
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const ux = shape.rx * cosR * scaleX;
      const uy = shape.rx * sinR * scaleY;
      const vx = -shape.ry * sinR * scaleX;
      const vy = shape.ry * cosR * scaleY;
      return {
        type: 'ellipse',
        cx,
        cy,
        rx: Math.max(1, Math.hypot(ux, uy)),
        ry: Math.max(1, Math.hypot(vx, vy)),
        rotation: Math.atan2(uy, ux),
        isCircle: false,
      };
    }
    case 'polygon':
      return {
        type: 'polygon',
        points: shape.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })),
        closed: shape.closed,
      };
    case 'curve':
      return {
        type: 'curve',
        points: shape.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })),
      };
    case 'arrow':
      return {
        ...shape,
        x1: mapX(shape.x1),
        y1: mapY(shape.y1),
        cx: shape.cx !== undefined ? mapX(shape.cx) : undefined,
        cy: shape.cy !== undefined ? mapY(shape.cy) : undefined,
        x2: mapX(shape.x2),
        y2: mapY(shape.y2),
        leftX: mapX(shape.leftX),
        leftY: mapY(shape.leftY),
        rightX: mapX(shape.rightX),
        rightY: mapY(shape.rightY),
        tailLeftX: shape.tailLeftX !== undefined ? mapX(shape.tailLeftX) : undefined,
        tailLeftY: shape.tailLeftY !== undefined ? mapY(shape.tailLeftY) : undefined,
        tailRightX: shape.tailRightX !== undefined ? mapX(shape.tailRightX) : undefined,
        tailRightY: shape.tailRightY !== undefined ? mapY(shape.tailRightY) : undefined,
      };
    case 'brace':
      return {
        type: 'brace',
        x1: mapX(shape.x1),
        y1: mapY(shape.y1),
        x2: mapX(shape.x2),
        y2: mapY(shape.y2),
        depth: shape.depth * (scaleX + scaleY) * 0.5,
      };
  }
}

function resolveGlobalStroke(
  stroke: AnnotationStroke,
  appEl: HTMLElement | null,
  origin: { left: number; top: number; width: number; height: number },
  rectCache: Map<string, DocRect | null>
): AnnotationStroke {
  const anchor = stroke.anchor;
  if (!anchor || anchor.refWidth < 1 || anchor.refHeight < 1) return stroke;
  const curRect = getAnchorDocRect(anchor, appEl, origin, rectCache);
  if (!curRect || curRect.width < 1 || curRect.height < 1) return stroke;

  const rawScaleX = curRect.width / anchor.refWidth;
  const rawScaleY = curRect.height / anchor.refHeight;
  const scaleX = Math.max(0.2, Math.min(5, rawScaleX));
  // Only scale vertically when height shrinks proportionally or expands with width;
  // prevent tall wrapping cards / multi-row grids from stretching strokes vertically.
  const scaleY =
    anchor.selector === ''
      ? 1
      : rawScaleY > 1 && rawScaleX < 1.02
      ? 1
      : Math.max(0.2, Math.min(5, rawScaleY));

  if (
    Math.abs(curRect.left - anchor.refLeft) < 0.25 &&
    Math.abs(curRect.top - anchor.refTop) < 0.25 &&
    Math.abs(scaleX - 1) < 0.002 &&
    Math.abs(scaleY - 1) < 0.002
  ) {
    return stroke;
  }

  const mapX = (x: number) => curRect.left + (x - anchor.refLeft) * scaleX;
  const mapY = (y: number) => curRect.top + (y - anchor.refTop) * scaleY;
  const sizeScale = Math.max(0.45, Math.min(2, (scaleX + scaleY) * 0.5));

  return {
    ...stroke,
    size: Math.max(1, stroke.size * sizeScale),
    points: stroke.points.map((p) => ({
      ...p,
      x: mapX(p.x),
      y: mapY(p.y),
    })),
    shape: stroke.shape
      ? transformAnchoredShape(stroke.shape, mapX, mapY, scaleX, scaleY)
      : undefined,
  };
}

/**
 * Mounted inside `.app` (below `#main-header` z-index 100).
 * Provides an automatic document-anchored Apple Pen / Highlighter / Eraser canvas
 * for any program screen without a dedicated bounded canvas (e.g., Tajweed, Home).
 *
 * Completely unmounts its fixed canvases whenever a bounded surface (such as the Mushaf)
 * is mounted so Chrome NEVER runs an idle full-screen `mix-blend-mode: multiply` pass!
 */
export const GlobalAnnotationLayer: React.FC = () => {
  const {
    activeTool,
    penSettings,
    fountainSettings,
    pencilSettings,
    highlighterSettings,
    tapeSettings,
    eraserSettings,
    lassoSettings,
    systemSettings,
    activeSurfaceId,
    hasBoundedSurface,
    selectedStroke,
    setSelectedStroke,
    selectedStrokeIds,
    setSelectedStrokeIds,
    setSelectedStrokeAnchor,
    registerSurfaceExporter,
    getStrokes,
    addStroke,
    updateStroke,
    updateStrokesBatch,
    toggleTapeRevealed,
    removeStrokes,
    applyEraseBatch,
  } = useAnnotation();

  const hlCanvasRef = useRef<HTMLCanvasElement>(null);
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const draftCanvasRef = useRef<HTMLCanvasElement>(null);

  const hlCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const penCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const draftCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const committedHlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const committedHlCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasCommittedHlRef = useRef(false);

  const renderedStrokesRef = useRef<AnnotationStroke[]>([]);
  const renderedSurfaceIdRef = useRef<string | null>(null);
  const prevDraftRectRef = useRef<PixelRect | null>(null);
  const prevHlDraftRectRef = useRef<PixelRect | null>(null);

  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTypeRef = useRef<string | null>(null);
  const lastPenActivityAtRef = useRef<number>(0);
  const drawGestureStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingBodyClassActiveRef = useRef<boolean>(false);
  const draftRef = useRef<AnnotationStroke | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdDeadlineRef = useRef<number>(0);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const holdPathAccumRef = useRef<number>(0);
  const mergePrevStrokeIdRef = useRef<string | null>(null);
  const lockPerfectRef = useRef<boolean>(false);
  const shiftRulerActiveRef = useRef<boolean>(false);
  const lastRawPtRef = useRef<AnnotationPoint | null>(null);
  const snapPulseRef = useRef<{ x: number; y: number; color: string; size: number; startedAt: number } | null>(null);
  const erasePulseRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const morphAnimRef = useRef<{
    strokeId: string;
    startedAt: number;
    durationMs: number;
    freehandPts: AnnotationPoint[];
  } | null>(null);
  const magneticCueRef = useRef<{ x: number; y: number } | null>(null);
  const selectedStrokeIdRef = useRef<string | null>(null);
  const selectedGroupIdsRef = useRef<string[]>([]);
  const lassoLoopRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const hoveredGroupHandleRef = useRef<LassoGroupHandleId | null>(null);
  const groupDragSessionRef = useRef<{
    mode: 'move' | 'resize';
    handleId?: LassoGroupHandleId;
    origBounds?: CssBounds;
    strokeIds: string[];
    startNorm: AnnotationPoint;
    origStrokes: AnnotationStroke[];
    currentStrokes: AnnotationStroke[];
  } | null>(null);
  const editingHiddenStrokeIdRef = useRef<string | null>(null);
  const editingStrokeRef = useRef<AnnotationStroke | null>(null);
  const editSessionRef = useRef<{
    strokeId: string;
    mode: 'move' | 'handle';
    handleId: string | null;
    startNorm: AnnotationPoint;
    origStroke: AnnotationStroke;
    rotationDeg?: number | null;
  } | null>(null);
  const snapBaseRef = useRef<SnapDragBase | null>(null);
  const tapeTapStartRef = useRef<{ sx: number; sy: number; maxMove: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const hlAxisLockRef = useRef<{ axis: 'none' | 'h' | 'v' | 'broken'; peakExcursionPx: number }>({
    axis: 'none',
    peakExcursionPx: 0,
  });
  const livePenSessionRef = useRef<LivePenDraftSession | null>(null);
  const drawRafRef = useRef<number>(0);
  const dirtyLiveRef = useRef<{ draft: boolean; hl: boolean }>({ draft: false, hl: false });
  const hasRecordedEraseUndoRef = useRef(false);
  const lastEraserPtRef = useRef<{ x: number; y: number } | null>(null);
  const anchorOriginRef = useRef<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const canvasRectRef = useRef<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const layoutRevisionRef = useRef(0);
  const lastBuiltTransformRef = useRef<{
    offsetX: number;
    offsetY: number;
    pw: number;
    ph: number;
    appW: number;
    appH: number;
    layoutRev: number;
  }>({
    offsetX: 0,
    offsetY: 0,
    pw: 0,
    ph: 0,
    appW: 0,
    appH: 0,
    layoutRev: -1,
  });

  const globalSurfaceId = !hasBoundedSurface ? activeSurfaceId : null;
  const globalStrokes = globalSurfaceId ? getStrokes(globalSurfaceId) : [];
  const globalStrokesRef = useRef(globalStrokes);
  globalStrokesRef.current = globalStrokes;
  const selectedStrokeRef = useRef(selectedStroke);
  selectedStrokeRef.current = selectedStroke;
  const selectedStrokeIdsRef = useRef(selectedStrokeIds);
  selectedStrokeIdsRef.current = selectedStrokeIds;

  const isGlobalDrawActive =
    !hasBoundedSurface &&
    (isGlobalDrawSelectionTool(activeTool) ||
      activeTool === 'eraser' ||
      activeTool === 'lasso');

  const getHlCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!hlCtxRef.current && hlCanvasRef.current) {
      hlCtxRef.current = hlCanvasRef.current.getContext('2d');
    }
    return hlCtxRef.current;
  }, []);

  const getPenCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!penCtxRef.current && penCanvasRef.current) {
      penCtxRef.current = penCanvasRef.current.getContext('2d');
    }
    return penCtxRef.current;
  }, []);

  const getDraftCtx = useCallback((): CanvasRenderingContext2D | null => {
    if (!draftCtxRef.current && draftCanvasRef.current) {
      draftCtxRef.current = createDraftCanvasContext(draftCanvasRef.current);
    }
    return draftCtxRef.current;
  }, []);

  const ensureCommittedHlBuffer = useCallback((pw: number, ph: number): CanvasRenderingContext2D | null => {
    if (!committedHlCanvasRef.current) {
      committedHlCanvasRef.current = document.createElement('canvas');
      committedHlCtxRef.current = committedHlCanvasRef.current.getContext('2d');
    }
    const cHl = committedHlCanvasRef.current;
    if (cHl.width !== pw || cHl.height !== ph) {
      cHl.width = pw;
      cHl.height = ph;
    }
    return committedHlCtxRef.current;
  }, []);

  const ensureScratchCanvas = useCallback((): HTMLCanvasElement => {
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }
    return scratchCanvasRef.current;
  }, []);

  const refreshGlobalGeometry = useCallback(() => {
    const appEl = document.querySelector('.app');
    if (appEl) {
      const r = appEl.getBoundingClientRect();
      anchorOriginRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    } else {
      anchorOriginRef.current = {
        left: -window.scrollX,
        top: -window.scrollY,
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
      };
    }
    const penCanvas = penCanvasRef.current;
    if (penCanvas) {
      const r = penCanvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        canvasRectRef.current = {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      } else {
        canvasRectRef.current = {
          left: 0,
          top: 0,
          width: document.documentElement.clientWidth || window.innerWidth,
          height: document.documentElement.clientHeight || window.innerHeight,
        };
      }
    }
  }, []);

  const resolveSingleStroke = useCallback(
    (stroke: AnnotationStroke, rectCache?: Map<string, DocRect | null>): AnnotationStroke => {
      if (!stroke.anchor) return stroke;
      const appEl = document.querySelector('.app');
      const appHtml = appEl instanceof HTMLElement ? appEl : null;
      return resolveGlobalStroke(
        stroke,
        appHtml,
        anchorOriginRef.current,
        rectCache ?? new Map<string, DocRect | null>()
      );
    },
    []
  );

  const resolveStrokesList = useCallback((list: ReadonlyArray<AnnotationStroke>): AnnotationStroke[] => {
    if (list.length === 0) return [];
    const appEl = document.querySelector('.app');
    const appHtml = appEl instanceof HTMLElement ? appEl : null;
    const rectCache = new Map<string, DocRect | null>();
    const origin = anchorOriginRef.current;
    const out = new Array<AnnotationStroke>(list.length);
    for (let i = 0; i < list.length; i++) {
      out[i] = resolveGlobalStroke(list[i], appHtml, origin, rectCache);
    }
    return out;
  }, []);

  const withCapturedGlobalAnchor = useCallback((stroke: AnnotationStroke): AnnotationStroke => {
    const appEl = document.querySelector('.app');
    const appHtml = appEl instanceof HTMLElement ? appEl : null;
    const anchor = captureGlobalAnchorForStroke(stroke, appHtml, anchorOriginRef.current);
    return anchor ? { ...stroke, anchor } : stroke;
  }, []);

  const getCachedGlobalTransform = useCallback((): RenderTransform => {
    const origin = anchorOriginRef.current;
    const cRect = canvasRectRef.current;
    return {
      scaleX: 1,
      scaleY: 1,
      offsetX: origin.left - cRect.left,
      offsetY: origin.top - cRect.top,
      unitScale: 1,
    };
  }, []);

  const syncGlobalCanvasDimensions = useCallback((): {
    vw: number;
    vh: number;
    pw: number;
    ph: number;
    draftPw: number;
    draftPh: number;
  } | null => {
    const hlCanvas = hlCanvasRef.current;
    const penCanvas = penCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    if (!hlCanvas || !penCanvas || !draftCanvas) return null;

    const cRect = canvasRectRef.current;
    const vw = cRect.width || document.documentElement.clientWidth || window.innerWidth;
    const vh = cRect.height || document.documentElement.clientHeight || window.innerHeight;
    if (vw <= 0 || vh <= 0) return null;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_GLOBAL_DPR);
    const pw = Math.max(1, Math.round(vw * dpr));
    const ph = Math.max(1, Math.round(vh * dpr));
    const draftDpr = getLiveDraftDpr(dpr, vw * vh);
    const desiredDraftPw = Math.max(1, Math.round(vw * draftDpr));
    const desiredDraftPh = Math.max(1, Math.round(vh * draftDpr));
    const canResizeDraft =
      !draftRef.current &&
      !editingStrokeRef.current &&
      !groupDragSessionRef.current &&
      !lassoLoopRef.current;

    if (
      hlCanvas.width !== pw ||
      hlCanvas.height !== ph ||
      penCanvas.width !== pw ||
      penCanvas.height !== ph
    ) {
      hlCanvas.width = pw;
      hlCanvas.height = ph;
      penCanvas.width = pw;
      penCanvas.height = ph;
      draftCanvas.width = desiredDraftPw;
      draftCanvas.height = desiredDraftPh;
      prevDraftRectRef.current = null;
      prevHlDraftRectRef.current = null;
    } else if (
      canResizeDraft &&
      (draftCanvas.width !== desiredDraftPw || draftCanvas.height !== desiredDraftPh)
    ) {
      draftCanvas.width = desiredDraftPw;
      draftCanvas.height = desiredDraftPh;
      prevDraftRectRef.current = null;
    }
    return {
      vw,
      vh,
      pw,
      ph,
      draftPw: draftCanvas.width || desiredDraftPw,
      draftPh: draftCanvas.height || desiredDraftPh,
    };
  }, []);

  const clearGlobalDraftOverlay = useCallback(() => {
    const draftCanvas = draftCanvasRef.current;
    const dCtx = getDraftCtx();
    const prev = prevDraftRectRef.current;
    if (dCtx && draftCanvas && prev) {
      dCtx.save();
      dCtx.setTransform(1, 0, 0, 1, 0, 0);
      dCtx.clearRect(prev.x, prev.y, prev.w, prev.h);
      dCtx.restore();
    }
    if (livePenSessionRef.current) {
      resetLivePenDraftSession(livePenSessionRef.current);
    }
    prevDraftRectRef.current = null;
    if (draftCanvas) {
      if (draftCanvas.style.opacity !== '') {
        draftCanvas.style.opacity = '';
      }
      if (
        !snapPulseRef.current &&
        !erasePulseRef.current &&
        !selectedStrokeIdRef.current &&
        !editingStrokeRef.current &&
        !lassoLoopRef.current &&
        !groupDragSessionRef.current &&
        selectedGroupIdsRef.current.length === 0 &&
        draftCanvas.style.display !== 'none'
      ) {
        draftCanvas.style.display = 'none';
      }
    }
  }, [getDraftCtx]);

  const restoreGlobalHlDraftArea = useCallback(() => {
    const prev = prevHlDraftRectRef.current;
    if (!prev) return;
    const hlCanvas = hlCanvasRef.current;
    const hlCtx = getHlCtx();
    if (hlCtx && hlCanvas) {
      hlCtx.save();
      hlCtx.setTransform(1, 0, 0, 1, 0, 0);
      hlCtx.clearRect(prev.x, prev.y, prev.w, prev.h);
      if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
        hlCtx.drawImage(
          committedHlCanvasRef.current,
          prev.x,
          prev.y,
          prev.w,
          prev.h,
          prev.x,
          prev.y,
          prev.w,
          prev.h
        );
      }
      hlCtx.restore();
    }
    prevHlDraftRectRef.current = null;
    if (hlCanvas && !hasCommittedHlRef.current) {
      hlCanvas.style.display = 'none';
    }
  }, [getHlCtx]);

  const stampGlobalCommittedStroke = useCallback(
    (rawStroke: AnnotationStroke, clearPrevHlDraft = false) => {
      if (hasBoundedSurface) return;
      const dims = syncGlobalCanvasDimensions();
      const hlCanvas = hlCanvasRef.current;
      if (!dims || !hlCanvas) return;

      const stroke = resolveSingleStroke(rawStroke);
      const { vw, vh, pw, ph } = dims;
      const dprX = pw / vw;
      const dprY = ph / vh;
      const tf = getCachedGlobalTransform();

      if (stroke.kind !== 'highlighter') {
        const penCanvas = penCanvasRef.current;
        if (penCanvas && penCanvas.style.display !== 'block') {
          penCanvas.style.display = 'block';
        }
        const penCtx = getPenCtx();
        if (!penCtx) return;
        penCtx.save();
        penCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
        drawApplePenStroke(penCtx, stroke, tf, false);
        penCtx.restore();
        return;
      }

      if (stroke.kind === 'highlighter') {
        const cHlCtx = ensureCommittedHlBuffer(pw, ph);
        const hlCtx = getHlCtx();
        if (!cHlCtx || !hlCtx) return;

        if (!hasCommittedHlRef.current && committedHlCanvasRef.current) {
          cHlCtx.save();
          cHlCtx.setTransform(1, 0, 0, 1, 0, 0);
          cHlCtx.clearRect(0, 0, pw, ph);
          cHlCtx.restore();
        }

        const scratch = ensureScratchCanvas();
        const finalRect = drawAppleHighlighterStroke(cHlCtx, scratch, stroke, tf, dprX, dprY, false);
        hasCommittedHlRef.current = true;
        if (hlCanvas.style.display !== 'block') {
          hlCanvas.style.display = 'block';
        }

        const dirty = clearPrevHlDraft
          ? unionPixelRects(prevHlDraftRectRef.current, finalRect)
          : finalRect;
        prevHlDraftRectRef.current = null;

        if (dirty && committedHlCanvasRef.current) {
          hlCtx.save();
          hlCtx.setTransform(1, 0, 0, 1, 0, 0);
          hlCtx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
          hlCtx.drawImage(
            committedHlCanvasRef.current,
            dirty.x,
            dirty.y,
            dirty.w,
            dirty.h,
            dirty.x,
            dirty.y,
            dirty.w,
            dirty.h
          );
          hlCtx.restore();
        }
      }
    },
    [
      ensureCommittedHlBuffer,
      ensureScratchCanvas,
      getCachedGlobalTransform,
      getHlCtx,
      getPenCtx,
      hasBoundedSurface,
      resolveSingleStroke,
      syncGlobalCanvasDimensions,
    ]
  );

  const rebuildGlobalCommittedLayers = useCallback((skipIfUnchanged = false) => {
    if (hasBoundedSurface) return;
    const hlCanvas = hlCanvasRef.current;
    const penCanvas = penCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    const list = globalStrokesRef.current;
    if (
      list.length === 0 &&
      !draftRef.current &&
      !editingStrokeRef.current &&
      !lassoLoopRef.current &&
      !groupDragSessionRef.current &&
      !snapPulseRef.current &&
      !erasePulseRef.current
    ) {
      hasCommittedHlRef.current = false;
      if (hlCanvas && hlCanvas.style.display !== 'none') hlCanvas.style.display = 'none';
      if (draftCanvas && draftCanvas.style.display !== 'none') draftCanvas.style.display = 'none';
      if (penCanvas) {
        if (renderedStrokesRef.current.length > 0) {
          const penCtx = getPenCtx();
          if (penCtx) {
            penCtx.save();
            penCtx.setTransform(1, 0, 0, 1, 0, 0);
            penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
            penCtx.restore();
          }
        }
        const shouldShowPen = activeTool !== 'cursor';
        const targetPenDisplay = shouldShowPen ? 'block' : 'none';
        if (penCanvas.style.display !== targetPenDisplay) {
          penCanvas.style.display = targetPenDisplay;
        }
      }
      if (committedHlCtxRef.current && committedHlCanvasRef.current && renderedStrokesRef.current.length > 0) {
        const cHl = committedHlCanvasRef.current;
        committedHlCtxRef.current.clearRect(0, 0, cHl.width, cHl.height);
      }
      renderedStrokesRef.current = [];
      renderedSurfaceIdRef.current = globalSurfaceId;
      return;
    }

    refreshGlobalGeometry();
    const dims = syncGlobalCanvasDimensions();
    if (!dims || !hlCanvas) return;

    const { vw, vh, pw, ph } = dims;
    const tf = getCachedGlobalTransform();
    const origin = anchorOriginRef.current;
    const layoutRev = layoutRevisionRef.current;
    const prevBuilt = lastBuiltTransformRef.current;
    if (
      skipIfUnchanged === true &&
      prevBuilt &&
      renderedSurfaceIdRef.current === globalSurfaceId &&
      renderedStrokesRef.current.length === list.length &&
      prevBuilt.pw === pw &&
      prevBuilt.ph === ph &&
      prevBuilt.layoutRev === layoutRev &&
      Math.abs(prevBuilt.appW - origin.width) < 0.5 &&
      Math.abs(prevBuilt.appH - origin.height) < 0.5 &&
      Math.abs(prevBuilt.offsetX - tf.offsetX) < 0.25 &&
      Math.abs(prevBuilt.offsetY - tf.offsetY) < 0.25
    ) {
      return;
    }

    const resolvedList = resolveStrokesList(list);
    const dprX = pw / vw;
    const dprY = ph / vh;
    const hiddenId = mergePrevStrokeIdRef.current;
    const editingHiddenId = editingHiddenStrokeIdRef.current;
    const groupHiddenIds = groupDragSessionRef.current?.strokeIds ?? null;
    const isHidden = (id: string) =>
      (hiddenId !== null && id === hiddenId) ||
      (editingHiddenId !== null && id === editingHiddenId) ||
      (groupHiddenIds !== null && groupHiddenIds.includes(id));

    let hasHl = false;
    let hasPen = false;
    for (let i = 0; i < resolvedList.length; i++) {
      if (isHidden(resolvedList[i].id)) continue;
      if (resolvedList[i].kind === 'highlighter') hasHl = true;
      else hasPen = true;
    }
    hasCommittedHlRef.current = hasHl;

    const hlCtx = getHlCtx();

    if (hasHl && hlCtx) {
      const cHlCtx = ensureCommittedHlBuffer(pw, ph);
      const scratch = ensureScratchCanvas();
      if (cHlCtx && committedHlCanvasRef.current) {
        cHlCtx.save();
        cHlCtx.setTransform(1, 0, 0, 1, 0, 0);
        cHlCtx.clearRect(0, 0, pw, ph);
        cHlCtx.restore();
        for (let i = 0; i < resolvedList.length; i++) {
          if (isHidden(resolvedList[i].id)) continue;
          if (resolvedList[i].kind === 'highlighter') {
            drawAppleHighlighterStroke(cHlCtx, scratch, resolvedList[i], tf, dprX, dprY, false);
          }
        }
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        hlCtx.drawImage(committedHlCanvasRef.current, 0, 0);
        hlCtx.restore();
      }
      if (hlCanvas.style.display !== 'block') {
        hlCanvas.style.display = 'block';
      }
    } else {
      if (committedHlCtxRef.current && committedHlCanvasRef.current) {
        committedHlCtxRef.current.clearRect(
          0,
          0,
          committedHlCanvasRef.current.width,
          committedHlCanvasRef.current.height
        );
      }
      if (hlCtx) {
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        hlCtx.restore();
      }
      if (
        draftRef.current?.kind !== 'highlighter' &&
        editingStrokeRef.current?.kind !== 'highlighter' &&
        hlCanvas.style.display !== 'none'
      ) {
        hlCanvas.style.display = 'none';
      }
    }
    prevHlDraftRectRef.current = null;

    if (penCanvas) {
      const targetPenDisplay = hasPen || activeTool !== 'cursor' ? 'block' : 'none';
      if (penCanvas.style.display !== targetPenDisplay) {
        penCanvas.style.display = targetPenDisplay;
      }
    }

    const penCtx = getPenCtx();
    if (penCtx) {
      penCtx.save();
      penCtx.setTransform(1, 0, 0, 1, 0, 0);
      penCtx.clearRect(0, 0, pw, ph);
      if (hasPen) {
        penCtx.scale(dprX, dprY);
        for (let i = 0; i < resolvedList.length; i++) {
          if (isHidden(resolvedList[i].id)) continue;
          if (resolvedList[i].kind !== 'highlighter') {
            drawApplePenStroke(penCtx, resolvedList[i], tf, false);
          }
        }
      }
      penCtx.restore();
    }

    if (draftCanvas) {
      const dCtx = getDraftCtx();
      if (dCtx) {
        dCtx.save();
        dCtx.setTransform(1, 0, 0, 1, 0, 0);
        dCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
        dCtx.restore();
      }
      prevDraftRectRef.current = null;
      if (
        !draftRef.current &&
        !snapPulseRef.current &&
        !erasePulseRef.current &&
        !editingStrokeRef.current &&
        !lassoLoopRef.current &&
        !groupDragSessionRef.current &&
        selectedGroupIdsRef.current.length === 0 &&
        draftCanvas.style.display !== 'none'
      ) {
        draftCanvas.style.display = 'none';
      }
    }

    lastBuiltTransformRef.current = {
      offsetX: tf.offsetX,
      offsetY: tf.offsetY,
      pw,
      ph,
      appW: origin.width,
      appH: origin.height,
      layoutRev,
    };
    renderedStrokesRef.current = list.slice();
    renderedSurfaceIdRef.current = globalSurfaceId;
  }, [
    activeTool,
    ensureCommittedHlBuffer,
    ensureScratchCanvas,
    getCachedGlobalTransform,
    getDraftCtx,
    getHlCtx,
    getPenCtx,
    globalSurfaceId,
    hasBoundedSurface,
    refreshGlobalGeometry,
    resolveStrokesList,
    syncGlobalCanvasDimensions,
  ]);

  const renderGlobalLiveDraft = useCallback(() => {
    if (drawRafRef.current) {
      cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = 0;
    }
    if (hasBoundedSurface) return;

    const hlCanvas = hlCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    if (!hlCanvas || !draftCanvas) return;

    const dims = syncGlobalCanvasDimensions();
    if (!dims) return;
    const { vw, vh, pw, ph, draftPw, draftPh } = dims;
    const dprX = pw / vw;
    const dprY = ph / vh;
    const draftDprX = draftPw / vw;
    const draftDprY = draftPh / vh;

    const draft = draftRef.current;
    const liveWorkStartMs = draft ? performance.now() : 0;

    const redrawHl = dirtyLiveRef.current.hl;
    const redrawDraft = dirtyLiveRef.current.draft;
    dirtyLiveRef.current.hl = false;
    dirtyLiveRef.current.draft = false;

    let needsMoreFrames = false;
    let needsMoreHlFrames = false;

    const tf = getCachedGlobalTransform();
    const groupDrag = groupDragSessionRef.current;

    const activeHlStroke =
      draft && draft.kind === 'highlighter'
        ? draft
        : editingStrokeRef.current && editingStrokeRef.current.kind === 'highlighter'
        ? editingStrokeRef.current
        : null;

    if (groupDrag) {
      const hlCtx = getHlCtx();
      if (hlCtx) {
        if (hlCanvas.style.display !== 'block') {
          hlCanvas.style.display = 'block';
        }
        hlCtx.save();
        hlCtx.setTransform(1, 0, 0, 1, 0, 0);
        hlCtx.clearRect(0, 0, pw, ph);
        if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
          hlCtx.drawImage(committedHlCanvasRef.current, 0, 0);
        }
        hlCtx.restore();
        const movedHls = groupDrag.currentStrokes.filter((s) => s.kind === 'highlighter');
        if (movedHls.length > 0) {
          const scratch = ensureScratchCanvas();
          for (const st of movedHls) {
            drawAppleHighlighterStroke(hlCtx, scratch, st, tf, dprX, dprY, false);
          }
        }
      }
    } else if (redrawHl || activeHlStroke) {
      const hlCtx = getHlCtx();
      if (hlCtx) {
        if (activeHlStroke) {
          if (hlCanvas.style.display !== 'block') {
            hlCanvas.style.display = 'block';
          }
          const scratch = ensureScratchCanvas();
          let currRect: PixelRect | null = null;
          const hlMorph = morphAnimRef.current;
          if (activeHlStroke.shape && hlMorph && hlMorph.strokeId === activeHlStroke.id) {
            const elapsed = performance.now() - hlMorph.startedAt;
            if (elapsed < hlMorph.durationMs) {
              if (scratch.width !== pw || scratch.height !== ph) {
                scratch.width = pw;
                scratch.height = ph;
              }
              const sCtx = scratch.getContext('2d');
              if (sCtx) {
                sCtx.save();
                sCtx.setTransform(1, 0, 0, 1, 0, 0);
                sCtx.clearRect(0, 0, pw, ph);
                sCtx.setTransform(dprX, 0, 0, dprY, 0, 0);
                const bounds = renderMorphedShapeStroke(
                  sCtx,
                  hlMorph.freehandPts,
                  activeHlStroke.shape,
                  activeHlStroke,
                  tf,
                  elapsed / hlMorph.durationMs,
                  1
                );
                sCtx.restore();
                if (bounds) {
                  currRect = cssBoundsToPixelRect(bounds, dprX, dprY, pw, ph);
                }
              }
              needsMoreFrames = true;
              needsMoreHlFrames = true;
            } else {
              morphAnimRef.current = null;
            }
          }

          if (!needsMoreHlFrames) {
            if (!livePenSessionRef.current) {
              livePenSessionRef.current = createLivePenDraftSession();
            }
            currRect = renderLiveHighlighterWithSession(
              scratch,
              livePenSessionRef.current,
              activeHlStroke,
              tf,
              dprX,
              dprY,
              pw,
              ph
            );
          }
          const dirty = unionPixelRects(prevHlDraftRectRef.current, currRect);
          if (dirty) {
            hlCtx.save();
            hlCtx.setTransform(1, 0, 0, 1, 0, 0);
            hlCtx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
            if (hasCommittedHlRef.current && committedHlCanvasRef.current) {
              hlCtx.drawImage(
                committedHlCanvasRef.current,
                dirty.x,
                dirty.y,
                dirty.w,
                dirty.h,
                dirty.x,
                dirty.y,
                dirty.w,
                dirty.h
              );
            }
            if (currRect) {
              hlCtx.globalCompositeOperation = isDarkThemeActive() ? 'source-over' : 'multiply';
              hlCtx.globalAlpha = activeHlStroke.opacity;
              hlCtx.drawImage(
                scratch,
                currRect.x,
                currRect.y,
                currRect.w,
                currRect.h,
                currRect.x,
                currRect.y,
                currRect.w,
                currRect.h
              );
            }
            hlCtx.restore();
          }
          prevHlDraftRectRef.current = currRect;
        } else {
          restoreGlobalHlDraftArea();
        }
      }
    }

    const rawSel =
      isGlobalDrawSelectionTool(activeTool) && selectedStrokeIdRef.current
        ? globalStrokesRef.current.find((s) => s.id === selectedStrokeIdRef.current) ?? null
        : null;
    const activeSelStroke =
      editingStrokeRef.current ?? (rawSel ? resolveSingleStroke(rawSel) : null);
    const activeGroupStrokes = groupDrag
      ? groupDrag.currentStrokes
      : activeTool === 'lasso' && selectedGroupIdsRef.current.length > 0
      ? resolveStrokesList(
          globalStrokesRef.current.filter((s) => selectedGroupIdsRef.current.includes(s.id))
        )
      : [];
    const hasLassoWork = Boolean(lassoLoopRef.current || activeGroupStrokes.length > 0);
    const hasSnappedShape = Boolean(draft && draft.shape);
    const hasOverlayWork = Boolean(
      activeSelStroke || magneticCueRef.current || morphAnimRef.current || hasLassoWork
    );

    if (redrawDraft || snapPulseRef.current || erasePulseRef.current || hasSnappedShape || hasOverlayWork) {
      const hasPenDraft = Boolean(draft && draft.kind !== 'highlighter');
      const hasWork =
        hasPenDraft ||
        hasSnappedShape ||
        hasOverlayWork ||
        Boolean(snapPulseRef.current) ||
        Boolean(erasePulseRef.current);

      if (hasWork && draftCanvas.style.display !== 'block') {
        draftCanvas.style.display = 'block';
      }

      const dCtx = getDraftCtx();
      if (dCtx) {
        let nextRect: PixelRect | null = null;
        const prevRect = prevDraftRectRef.current;

        const morph = morphAnimRef.current;
        let isMorphing = false;
        if (draft && draft.kind !== 'highlighter' && draft.shape && morph && morph.strokeId === draft.id) {
          const elapsed = performance.now() - morph.startedAt;
          if (elapsed < morph.durationMs) {
            isMorphing = true;
            if (prevRect) {
              dCtx.save();
              dCtx.setTransform(1, 0, 0, 1, 0, 0);
              dCtx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
              dCtx.restore();
            }
            dCtx.save();
            dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
            const bounds = renderMorphedShapeStroke(
              dCtx,
              morph.freehandPts,
              draft.shape,
              draft,
              tf,
              elapsed / morph.durationMs,
              1
            );
            dCtx.restore();
            if (bounds) {
              nextRect = cssBoundsToPixelRect(bounds, draftDprX, draftDprY, draftPw, draftPh);
            }
            needsMoreFrames = true;
          } else {
            morphAnimRef.current = null;
          }
        }

        if (!isMorphing) {
          if (draft && draft.kind !== 'highlighter') {
            if (!livePenSessionRef.current) {
              livePenSessionRef.current = createLivePenDraftSession();
            }
            nextRect = renderLivePenDraftWithSession(
              dCtx,
              draftCanvas,
              livePenSessionRef.current,
              draft,
              tf,
              draftDprX,
              draftDprY,
              draftPw,
              draftPh,
              prevRect
            );
          } else {
            if (draftCanvas.style.opacity !== '') {
              draftCanvas.style.opacity = '';
            }
            if (
              (!draft || draft.kind !== 'highlighter') &&
              livePenSessionRef.current &&
              (livePenSessionRef.current.strokeId || livePenSessionRef.current.frozenBounds)
            ) {
              resetLivePenDraftSession(livePenSessionRef.current);
            }
            if (prevRect) {
              dCtx.save();
              dCtx.setTransform(1, 0, 0, 1, 0, 0);
              dCtx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
              dCtx.restore();
            }
          }
        }

        if (groupDrag) {
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
          for (const st of groupDrag.currentStrokes) {
            if (st.kind !== 'highlighter') {
              const b = drawApplePenStroke(dCtx, st, tf, false);
              if (b) {
                nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(b, draftDprX, draftDprY, draftPw, draftPh));
              }
            }
          }
          dCtx.restore();
        }

        if (hasLassoWork) {
          const groupBounds =
            activeGroupStrokes.length > 0 ? getStrokesGroupBounds(activeGroupStrokes, tf) : null;
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
          const lassoBounds = drawLassoOverlay(
            dCtx,
            lassoLoopRef.current,
            groupBounds,
            lassoSettings.mode,
            groupDrag?.mode === 'resize' ? groupDrag.handleId ?? null : hoveredGroupHandleRef.current
          );
          dCtx.restore();
          if (lassoBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(lassoBounds, draftDprX, draftDprY, draftPw, draftPh));
          }
        }

        if (editingStrokeRef.current && editingStrokeRef.current.kind !== 'highlighter') {
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
          const editBounds = drawApplePenStroke(dCtx, editingStrokeRef.current, tf, false);
          dCtx.restore();
          if (editBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(editBounds, draftDprX, draftDprY, draftPw, draftPh));
          }
        }

        if (activeSelStroke) {
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
          const selBounds = drawShapeSelectionOverlay(
            dCtx,
            activeSelStroke,
            tf,
            editSessionRef.current?.handleId ?? null,
            editSessionRef.current?.rotationDeg ?? null
          );
          dCtx.restore();
          if (selBounds) {
            nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(selBounds, draftDprX, draftDprY, draftPw, draftPh));
          }
        }

        if (magneticCueRef.current) {
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);
          const cueBounds = drawMagneticSnapIndicator(
            dCtx,
            magneticCueRef.current.x,
            magneticCueRef.current.y
          );
          dCtx.restore();
          nextRect = unionPixelRects(nextRect, cssBoundsToPixelRect(cueBounds, draftDprX, draftDprY, draftPw, draftPh));
        }

        if (snapPulseRef.current || erasePulseRef.current) {
          dCtx.save();
          dCtx.setTransform(draftDprX, 0, 0, draftDprY, 0, 0);

          const pulse = snapPulseRef.current;
          if (pulse) {
            const elapsed = performance.now() - pulse.startedAt;
            if (elapsed < 380) {
              const p = elapsed / 380;
              const ease = 1 - Math.pow(1 - p, 3);
              const strokeW = Math.max(1.2, pulse.size);
              const halfTip = strokeW * 0.5;
              const startOuterR = Math.max(1.8, halfTip + 1.0);
              const expandOuter = Math.max(3.8, Math.min(18, strokeW * 1.15 + 2.4));
              const outerR = startOuterR + ease * expandOuter;
              const innerStart = Math.max(0.9, startOuterR * 0.5);
              const innerR = innerStart + ease * (expandOuter * 0.52);
              const fade = Math.pow(1 - p, 1.35);
              dCtx.save();
              dCtx.beginPath();
              dCtx.arc(pulse.x, pulse.y, outerR, 0, Math.PI * 2);
              dCtx.strokeStyle = hexToRgba(resolveDisplayStrokeColor(pulse.color), fade * 0.58);
              dCtx.lineWidth = Math.max(1.0, Math.min(2.2, 0.85 + strokeW * 0.1)) * (1 - p * 0.35);
              dCtx.stroke();

              dCtx.beginPath();
              dCtx.arc(pulse.x, pulse.y, innerR, 0, Math.PI * 2);
              dCtx.strokeStyle = `rgba(255, 255, 255, ${fade * 0.85})`;
              dCtx.lineWidth = Math.max(0.75, Math.min(1.3, 0.65 + strokeW * 0.05));
              dCtx.stroke();
              dCtx.restore();

              const pad = outerR + 4;
              nextRect = unionPixelRects(
                nextRect,
                cssBoundsToPixelRect(
                  { minX: pulse.x - pad, minY: pulse.y - pad, maxX: pulse.x + pad, maxY: pulse.y + pad },
                  draftDprX,
                  draftDprY,
                  draftPw,
                  draftPh
                )
              );
              needsMoreFrames = true;
            } else {
              snapPulseRef.current = null;
            }
          }

          const erasePulse = erasePulseRef.current;
          if (erasePulse) {
            const elapsed = performance.now() - erasePulse.startedAt;
            if (elapsed < 260) {
              const p = elapsed / 260;
              const ease = 1 - Math.pow(1 - p, 3);
              const fade = 1 - p;
              const r = 7 + ease * 15;
              dCtx.save();
              dCtx.beginPath();
              dCtx.arc(erasePulse.x, erasePulse.y, r, 0, Math.PI * 2);
              dCtx.strokeStyle = `rgba(236, 72, 153, ${fade * 0.42})`;
              dCtx.lineWidth = 1.5;
              dCtx.stroke();
              dCtx.restore();

              const pad = r + 4;
              nextRect = unionPixelRects(
                nextRect,
                cssBoundsToPixelRect(
                  {
                    minX: erasePulse.x - pad,
                    minY: erasePulse.y - pad,
                    maxX: erasePulse.x + pad,
                    maxY: erasePulse.y + pad,
                  },
                  draftDprX,
                  draftDprY,
                  draftPw,
                  draftPh
                )
              );
              needsMoreFrames = true;
            } else {
              erasePulseRef.current = null;
            }
          }

          dCtx.restore();
        }

        prevDraftRectRef.current = nextRect;
        if (!nextRect && !needsMoreFrames && draftCanvas.style.display !== 'none') {
          draftCanvas.style.display = 'none';
        }
      }
    }

    if (liveWorkStartMs > 0) {
      reportLiveDrawFrameDuration(performance.now() - liveWorkStartMs);
    }

    if (needsMoreFrames) {
      dirtyLiveRef.current.draft = true;
      if (needsMoreHlFrames) {
        dirtyLiveRef.current.hl = true;
      }
      drawRafRef.current = requestAnimationFrame(renderGlobalLiveDraft);
    }
  }, [
    activeTool,
    ensureScratchCanvas,
    getCachedGlobalTransform,
    getDraftCtx,
    getHlCtx,
    hasBoundedSurface,
    lassoSettings.mode,
    restoreGlobalHlDraftArea,
    syncGlobalCanvasDimensions,
  ]);

  const scheduleGlobalDraw = useCallback(
    (layers: { draft?: boolean; hl?: boolean }) => {
      if (layers.draft) dirtyLiveRef.current.draft = true;
      if (layers.hl) dirtyLiveRef.current.hl = true;
      if (drawRafRef.current) return;
      drawRafRef.current = requestAnimationFrame(renderGlobalLiveDraft);
    },
    [renderGlobalLiveDraft]
  );

  useEffect(() => {
    if (hasBoundedSurface) {
      hlCtxRef.current = null;
      penCtxRef.current = null;
      draftCtxRef.current = null;
      renderedStrokesRef.current = [];
      renderedSurfaceIdRef.current = null;
      return;
    }

    const surfaceChanged = renderedSurfaceIdRef.current !== globalSurfaceId;
    if (surfaceChanged) {
      rebuildGlobalCommittedLayers();
      if (globalStrokes.some((s) => s.kind === 'tape')) {
        setLayoutTick((t) => t + 1);
      }
      return;
    }

    const prev = renderedStrokesRef.current;
    const curr = globalStrokes;

    if (prev.length === curr.length) {
      let same = true;
      for (let i = 0; i < curr.length; i++) {
        if (prev[i] !== curr[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    if (curr.length > prev.length) {
      let prefixMatches = true;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i] !== curr[i]) {
          prefixMatches = false;
          break;
        }
      }
      if (prefixMatches) {
        for (let i = prev.length; i < curr.length; i++) {
          stampGlobalCommittedStroke(curr[i], false);
        }
        renderedStrokesRef.current = curr.slice();
        return;
      }
    }

    rebuildGlobalCommittedLayers();
    if (
      (isGlobalDrawSelectionTool(activeTool) && selectedStrokeIdRef.current && !editSessionRef.current) ||
      (activeTool === 'lasso' && selectedGroupIdsRef.current.length > 0 && !groupDragSessionRef.current)
    ) {
      scheduleGlobalDraw({ draft: true });
    }
  }, [
    globalStrokes,
    globalSurfaceId,
    hasBoundedSurface,
    activeTool,
    rebuildGlobalCommittedLayers,
    stampGlobalCommittedStroke,
    scheduleGlobalDraw,
  ]);

  // Rebuild committed and draft global canvas strokes whenever html.dark theme toggles
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let lastDark = document.documentElement.classList.contains('dark');
    const mo = new MutationObserver(() => {
      const nextDark = document.documentElement.classList.contains('dark');
      if (nextDark === lastDark) return;
      lastDark = nextDark;
      if (livePenSessionRef.current) {
        resetLivePenDraftSession(livePenSessionRef.current);
      }
      rebuildGlobalCommittedLayers();
      if (
        draftRef.current ||
        (isGlobalDrawSelectionTool(activeTool) && selectedStrokeIdRef.current) ||
        (activeTool === 'lasso' && selectedGroupIdsRef.current.length > 0)
      ) {
        scheduleGlobalDraw({ draft: true, hl: true });
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [activeTool, rebuildGlobalCommittedLayers, scheduleGlobalDraw]);

  useEffect(() => {
    if (hasBoundedSurface || !globalSurfaceId) return;
    return registerSurfaceExporter(globalSurfaceId, () => {
      const hl = hlCanvasRef.current;
      const pen = penCanvasRef.current;
      if (!hl || !pen) return null;
      refreshGlobalGeometry();
      let bg = '#0032C4';
      const appEl = document.querySelector('.app');
      const bodyCs = window.getComputedStyle(document.body).backgroundColor;
      if (bodyCs && bodyCs !== 'rgba(0, 0, 0, 0)' && bodyCs !== 'transparent') {
        bg = bodyCs;
      }
      const targetEl = appEl instanceof HTMLElement ? appEl : document.body;
      return {
        hlCanvas: hl,
        penCanvas: pen,
        backgroundHex: bg,
        pageElement: targetEl,
        overlayElement: targetEl,
        isBounded: false,
        strokes: resolveStrokesList(globalStrokesRef.current),
      };
    });
  }, [hasBoundedSurface, globalSurfaceId, refreshGlobalGeometry, registerSurfaceExporter, resolveStrokesList]);

  const syncGlobalSelectedAnchor = useCallback(
    (selId: string | null) => {
      if (
        hasBoundedSurface ||
        !globalSurfaceId ||
        editSessionRef.current !== null ||
        groupDragSessionRef.current !== null
      ) {
        if (
          globalSurfaceId &&
          (selectedStrokeRef.current?.surfaceId === globalSurfaceId ||
            selectedStrokeIdsRef.current?.surfaceId === globalSurfaceId)
        ) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }

      const cRect = canvasRectRef.current;
      if (activeTool === 'lasso') {
        const gIds = selectedGroupIdsRef.current;
        if (gIds.length === 0) {
          if (selectedStrokeIdsRef.current?.surfaceId === globalSurfaceId) {
            setSelectedStrokeAnchor(null);
          }
          return;
        }
        const picked = resolveStrokesList(
          globalStrokesRef.current.filter((s) => gIds.includes(s.id))
        );
        const gBounds = getStrokesGroupBounds(picked, getCachedGlobalTransform());
        if (!gBounds || picked.length === 0) {
          if (selectedStrokeIdsRef.current?.surfaceId === globalSurfaceId) {
            setSelectedStrokeAnchor(null);
          }
          return;
        }
        const kinds = new Set(picked.map((s) => s.kind));
        const kind: AnnotationStrokeKind | 'mixed' =
          kinds.size === 1 ? picked[0].kind : 'mixed';
        setSelectedStrokeAnchor({
          surfaceId: globalSurfaceId,
          strokeId: picked[0].id,
          strokeIds: picked.map((s) => s.id),
          count: picked.length,
          kind,
          centerX: cRect.left + (gBounds.minX + gBounds.maxX) * 0.5,
          topY: cRect.top + gBounds.minY,
          bottomY: cRect.top + gBounds.maxY,
        });
        return;
      }

      if (!selId || !isGlobalDrawSelectionTool(activeTool)) {
        if (selectedStrokeRef.current?.surfaceId === globalSurfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      const rawStroke = globalStrokesRef.current.find((s) => s.id === selId);
      if (!rawStroke) {
        if (selectedStrokeRef.current?.surfaceId === globalSurfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      const stroke = resolveSingleStroke(rawStroke);
      const bounds = getStrokeScreenBounds(stroke, getCachedGlobalTransform());
      if (!bounds) {
        if (selectedStrokeRef.current?.surfaceId === globalSurfaceId) {
          setSelectedStrokeAnchor(null);
        }
        return;
      }
      setSelectedStrokeAnchor({
        surfaceId: globalSurfaceId,
        strokeId: selId,
        strokeIds: [selId],
        count: 1,
        kind: stroke.kind,
        centerX: cRect.left + (bounds.minX + bounds.maxX) * 0.5,
        topY: cRect.top + bounds.minY,
        bottomY: cRect.top + bounds.maxY,
      });
    },
    [
      hasBoundedSurface,
      globalSurfaceId,
      activeTool,
      getCachedGlobalTransform,
      resolveSingleStroke,
      resolveStrokesList,
      setSelectedStrokeAnchor,
    ]
  );

  const syncGlobalSelectedAnchorRef = useRef(syncGlobalSelectedAnchor);
  syncGlobalSelectedAnchorRef.current = syncGlobalSelectedAnchor;

  useEffect(() => {
    if (hasBoundedSurface) return;
    const nextId =
      globalSurfaceId && selectedStroke?.surfaceId === globalSurfaceId
        ? selectedStroke.strokeId
        : null;
    const prevId = selectedStrokeIdRef.current;
    selectedStrokeIdRef.current = nextId;

    const nextGroupIds =
      globalSurfaceId && selectedStrokeIds?.surfaceId === globalSurfaceId
        ? selectedStrokeIds.strokeIds
        : [];
    const prevGroupKey = selectedGroupIdsRef.current.join(',');
    const nextGroupKey = nextGroupIds.join(',');
    selectedGroupIdsRef.current = nextGroupIds;

    if (editSessionRef.current || groupDragSessionRef.current) return;

    if (activeTool === 'lasso' && globalSurfaceId) {
      const validIds = nextGroupIds.filter((id) => globalStrokes.some((s) => s.id === id));
      if (validIds.length !== nextGroupIds.length) {
        selectedGroupIdsRef.current = validIds;
        setSelectedStrokeIds(
          validIds.length > 0 ? { surfaceId: globalSurfaceId, strokeIds: validIds } : null
        );
      }
      if (validIds.length > 0) {
        if (prevGroupKey !== validIds.join(',') || !lassoLoopRef.current) {
          scheduleGlobalDraw({ draft: true });
        }
        syncGlobalSelectedAnchor(validIds[0]);
      } else {
        if (prevGroupKey !== '' || lassoLoopRef.current) {
          clearGlobalDraftOverlay();
        }
        if (selectedStrokeIds?.surfaceId === globalSurfaceId) {
          setSelectedStrokeAnchor(null);
        }
      }
      return;
    }

    if (nextId && isGlobalDrawSelectionTool(activeTool)) {
      const exists = globalStrokes.some((s) => s.id === nextId);
      if (!exists) {
        selectedStrokeIdRef.current = null;
        setSelectedStroke(null);
        clearGlobalDraftOverlay();
        return;
      }
      if (prevId !== nextId) {
        scheduleGlobalDraw({ draft: true });
      }
      syncGlobalSelectedAnchor(nextId);
    } else {
      if (prevId !== nextId || prevGroupKey !== nextGroupKey) {
        clearGlobalDraftOverlay();
      }
      if (globalSurfaceId && selectedStroke?.surfaceId === globalSurfaceId) {
        setSelectedStrokeAnchor(null);
      }
    }
  }, [
    hasBoundedSurface,
    selectedStroke,
    selectedStrokeIds,
    globalSurfaceId,
    activeTool,
    globalStrokes,
    scheduleGlobalDraw,
    clearGlobalDraftOverlay,
    syncGlobalSelectedAnchor,
    setSelectedStroke,
    setSelectedStrokeIds,
    setSelectedStrokeAnchor,
  ]);

  useEffect(() => {
    if (hasBoundedSurface) return;
    let scrollRaf = 0;
    let vvResizeTimer: number | null = null;
    const scheduleSync = () => {
      const hasAnyAnnotation =
        globalStrokesRef.current.length > 0 ||
        Boolean(draftRef.current) ||
        Boolean(editingStrokeRef.current) ||
        Boolean(lassoLoopRef.current) ||
        Boolean(groupDragSessionRef.current) ||
        Boolean(selectedStrokeIdRef.current) ||
        selectedGroupIdsRef.current.length > 0;
      if (!hasAnyAnnotation) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        rebuildGlobalCommittedLayers(true);
        if (
          (isGlobalDrawSelectionTool(activeTool) && selectedStrokeIdRef.current) ||
          (activeTool === 'lasso' && selectedGroupIdsRef.current.length > 0)
        ) {
          scheduleGlobalDraw({ draft: true });
        }
        if (globalStrokesRef.current.some((s) => s.kind === 'tape')) {
          setLayoutTick((t) => t + 1);
        }
        if (selectedStrokeIdRef.current || selectedGroupIdsRef.current.length > 0) {
          syncGlobalSelectedAnchorRef.current(
            selectedStrokeIdRef.current ?? selectedGroupIdsRef.current[0]
          );
        }
      });
    };
    const onScrollOnly = () => {
      scheduleSync();
    };
    const onLayoutOrResize = () => {
      layoutRevisionRef.current += 1;
      scheduleSync();
    };
    const onVisualViewportResize = () => {
      if (vvResizeTimer !== null) window.clearTimeout(vvResizeTimer);
      vvResizeTimer = window.setTimeout(() => {
        vvResizeTimer = null;
        onLayoutOrResize();
      }, 120);
    };
    const onVisualViewportScroll = () => {
      if (!selectedStrokeIdRef.current && selectedGroupIdsRef.current.length === 0) {
        return;
      }
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        if (selectedStrokeIdRef.current || selectedGroupIdsRef.current.length > 0) {
          syncGlobalSelectedAnchorRef.current(
            selectedStrokeIdRef.current ?? selectedGroupIdsRef.current[0]
          );
        }
      });
    };
    window.addEventListener('scroll', onScrollOnly, { passive: true, capture: true });
    window.addEventListener('resize', onLayoutOrResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onVisualViewportResize, { passive: true });
    window.visualViewport?.addEventListener('scroll', onVisualViewportScroll, { passive: true });

    const appEl = document.querySelector('.app');
    appEl?.addEventListener('transitionend', onLayoutOrResize, { passive: true });
    let ro: ResizeObserver | null = null;
    if (appEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onLayoutOrResize);
      ro.observe(appEl);
    }

    return () => {
      window.removeEventListener('scroll', onScrollOnly, { capture: true });
      window.removeEventListener('resize', onLayoutOrResize);
      window.visualViewport?.removeEventListener('resize', onVisualViewportResize);
      window.visualViewport?.removeEventListener('scroll', onVisualViewportScroll);
      appEl?.removeEventListener('transitionend', onLayoutOrResize);
      ro?.disconnect();
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (vvResizeTimer !== null) {
        window.clearTimeout(vvResizeTimer);
        vvResizeTimer = null;
      }
      if (drawRafRef.current) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = 0;
      }
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, [hasBoundedSurface, activeTool, rebuildGlobalCommittedLayers, scheduleGlobalDraw]);

  useEffect(() => {
    drawGestureStartClientRef.current = null;
    isDrawingBodyClassActiveRef.current = false;
    hasRecordedEraseUndoRef.current = false;
    if (draftRef.current) {
      draftRef.current = null;
      clearGlobalDraftOverlay();
      restoreGlobalHlDraftArea();
    }
    snapBaseRef.current = null;
    tapeTapStartRef.current = null;
    hlAxisLockRef.current = { axis: 'none', peakExcursionPx: 0 };
    morphAnimRef.current = null;
    magneticCueRef.current = null;
    if (penCanvasRef.current && penCanvasRef.current.style.cursor !== '') {
      penCanvasRef.current.style.cursor = '';
    }
    if (!isGlobalDrawSelectionTool(activeTool)) {
      selectedStrokeIdRef.current = null;
    }
    if (activeTool !== 'lasso') {
      selectedGroupIdsRef.current = [];
      lassoLoopRef.current = null;
    }
    groupDragSessionRef.current = null;
    editSessionRef.current = null;
    editingStrokeRef.current = null;
    editingHiddenStrokeIdRef.current = null;
    mergePrevStrokeIdRef.current = null;
    activePointerIdRef.current = null;
    clearGlobalDraftOverlay();
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const penCanvas = penCanvasRef.current;
    if (penCanvas && !hasBoundedSurface) {
      const hasCommittedPen = globalStrokesRef.current.some((s) => s.kind !== 'highlighter');
      const targetDisplay = activeTool !== 'cursor' || hasCommittedPen ? 'block' : 'none';
      if (penCanvas.style.display !== targetDisplay) {
        penCanvas.style.display = targetDisplay;
      }
    }
  }, [activeTool, activeSurfaceId, hasBoundedSurface, clearGlobalDraftOverlay, restoreGlobalHlDraftArea]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const armHoldSnapTimer = useCallback(
    (clientX: number, clientY: number) => {
      const draft = draftRef.current;
      if (!draft) return;
      if (
        (draft.kind === 'pen' ||
          draft.kind === 'fountain' ||
          draft.kind === 'pencil' ||
          draft.kind === 'highlighter') &&
        !systemSettings.smartShapes
      ) {
        return;
      }

      holdAnchorRef.current = { x: clientX, y: clientY };
      holdDeadlineRef.current = performance.now() + HOLD_SNAP_DELAY_MS;
      if (holdTimerRef.current !== null) return;

      const scheduleCheck = (delayMs: number) => {
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null;
          const cur = draftRef.current;
          if (!cur || cur.shape) return;
          const remaining = holdDeadlineRef.current - performance.now();
          if (remaining > 18) {
            scheduleCheck(remaining);
            return;
          }
          if (cur.points.length < 4) return;
          let detected = null;
          let mergedPrevId: string | null = null;
          const isInkPenKind = cur.kind === 'pen' || cur.kind === 'fountain' || cur.kind === 'pencil';
          const resolvedPool = resolveStrokesList(globalStrokesRef.current);
          if (isInkPenKind && resolvedPool.length > 0) {
            const prevStroke = resolvedPool[resolvedPool.length - 1];
            const merged = tryMergeTwoStrokeArrow(prevStroke, cur.points, 1, 1);
            if (merged) {
              detected = merged;
              mergedPrevId = prevStroke.id;
            }
          }
          if (!detected) {
            detected = detectHoldShape(cur.points, 1, 1, cur.kind !== 'highlighter');
          }
          if (detected) {
            if (lockPerfectRef.current) {
              detected = enforcePerfectShape(detected, 1, 1);
            } else if (!mergedPrevId) {
              const mag = snapInitialShapeToAnchors(
                detected,
                resolvedPool,
                getCachedGlobalTransform(),
                cur.id,
                11
              );
              detected = mag.shape;
              if (mag.cue) {
                magneticCueRef.current = mag.cue;
              }
            }
            const lastPt = cur.points[cur.points.length - 1];
            snapBaseRef.current = {
              shape: detected,
              anchorX: lastPt.x,
              anchorY: lastPt.y,
            };
            lastRawPtRef.current = lastPt;
            cur.shape = detected;
            if (mergedPrevId) {
              mergePrevStrokeIdRef.current = mergedPrevId;
              morphAnimRef.current = null;
              rebuildGlobalCommittedLayers();
            } else {
              morphAnimRef.current = {
                strokeId: cur.id,
                startedAt: performance.now(),
                durationMs: 130,
                freehandPts: cur.points.map((p) => ({ ...p })),
              };
            }
            const cRect = canvasRectRef.current;
            const anchor = holdAnchorRef.current;
            const unitScale = getCachedGlobalTransform().unitScale;
            const pulseStrokeW =
              cur.kind === 'highlighter' || cur.kind === 'tape'
                ? Math.min(28, Math.max(8, cur.size * unitScale) * 0.7)
                : Math.max(1.2, cur.size * unitScale);
            snapPulseRef.current = {
              x: (anchor ? anchor.x : clientX) - cRect.left,
              y: (anchor ? anchor.y : clientY) - cRect.top,
              color: cur.kind === 'highlighter' ? '#007AFF' : cur.color,
              size: pulseStrokeW,
              startedAt: performance.now(),
            };
            scheduleGlobalDraw({ draft: true, hl: cur.kind === 'highlighter' });
          }
        }, delayMs);
      };

      scheduleCheck(HOLD_SNAP_DELAY_MS);
    },
    [
      getCachedGlobalTransform,
      systemSettings.smartShapes,
      rebuildGlobalCommittedLayers,
      scheduleGlobalDraw,
    ]
  );

  // Allow deleting selected stroke(s) via Delete/Backspace directly while drawing/lasso tools are active
  useEffect(() => {
    if (
      hasBoundedSurface ||
      (!isGlobalDrawSelectionTool(activeTool) && activeTool !== 'lasso') ||
      !globalSurfaceId
    ) {
      return;
    }
    const onDeleteKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          t instanceof HTMLSelectElement ||
          t.isContentEditable)
      ) {
        return;
      }
      const groupIds =
        activeTool === 'lasso'
          ? selectedGroupIdsRef.current
          : selectedStrokeIdRef.current
          ? [selectedStrokeIdRef.current]
          : [];
      if (groupIds.length === 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const existing = groupIds.filter((id) => globalStrokesRef.current.some((s) => s.id === id));
        if (existing.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          selectedStrokeIdRef.current = null;
          selectedGroupIdsRef.current = [];
          setSelectedStroke(null);
          removeStrokes(globalSurfaceId, existing);
          clearGlobalDraftOverlay();
        }
      }
    };
    window.addEventListener('keydown', onDeleteKey);
    return () => window.removeEventListener('keydown', onDeleteKey);
  }, [hasBoundedSurface, activeTool, globalSurfaceId, removeStrokes, setSelectedStroke, clearGlobalDraftOverlay]);

  const eraseGlobalPath = useCallback(
    (sweepLocalPts: ReadonlyArray<{ x: number; y: number }>) => {
      if (!globalSurfaceId || sweepLocalPts.length === 0) return;
      const tf = getCachedGlobalTransform();
      const radiusPx = Math.max(10, eraserSettings.size * 0.55);
      const list = resolveStrokesList(globalStrokesRef.current);
      const hlOnly = Boolean(eraserSettings.highlighterOnly);

      if (eraserSettings.mode === 'partial') {
        const removeIds: string[] = [];
        const additions: AnnotationStroke[] = [];
        for (let i = 0; i < list.length; i++) {
          const st = list[i];
          if (hlOnly && st.kind !== 'highlighter' && st.kind !== 'tape') continue;
          const res = eraseStrokePartiallyPath(st, sweepLocalPts, radiusPx, tf);
          if (res !== null) {
            removeIds.push(st.id);
            if (res.length > 0) {
              for (let j = 0; j < res.length; j++) {
                additions.push(withCapturedGlobalAnchor(res[j]));
              }
            }
          }
        }
        if (removeIds.length > 0) {
          const recordHistory = !hasRecordedEraseUndoRef.current;
          hasRecordedEraseUndoRef.current = true;
          applyEraseBatch(globalSurfaceId, removeIds, additions, recordHistory);
        }
        return;
      }

      const hitIds: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const st = list[i];
        if (hlOnly && st.kind !== 'highlighter' && st.kind !== 'tape') continue;
        if (hitTestStrokePath(sweepLocalPts, st, radiusPx, tf)) {
          hitIds.push(st.id);
        }
      }
      if (hitIds.length > 0) {
        const recordHistory = !hasRecordedEraseUndoRef.current;
        hasRecordedEraseUndoRef.current = true;
        applyEraseBatch(globalSurfaceId, hitIds, [], recordHistory);
      }
    },
    [
      applyEraseBatch,
      eraserSettings.highlighterOnly,
      eraserSettings.mode,
      eraserSettings.size,
      getCachedGlobalTransform,
      globalSurfaceId,
      resolveStrokesList,
      withCapturedGlobalAnchor,
    ]
  );

  const handleGlobalPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isGlobalDrawActive || !globalSurfaceId) return;

    if (e.pointerType === 'pen') {
      lastPenActivityAtRef.current = performance.now();
    }
    if (
      shouldIgnoreTouchForPalmOrPencilOnly(
        e,
        Boolean(systemSettings.pencilOnlyMode),
        lastPenActivityAtRef.current,
        activePointerIdRef.current !== null && activePointerTypeRef.current === 'pen'
      )
    ) {
      return;
    }

    const isDrawTool = isGlobalDrawSelectionTool(activeTool);
    const isRightButton = e.button === 2 && isDrawTool;
    const isAltEdit = e.button === 0 && e.altKey && isDrawTool;

    if (!isRightButton && e.button !== 0 && e.pointerType === 'mouse') return;

    // Always refresh live anchorOrigin & canvasRect on pointerdown (0.01ms once per dot/stroke)
    // so CSS transitions, collapsible cards, nested scrolls, or share banners never offset a dot.
    refreshGlobalGeometry();
    const dims = syncGlobalCanvasDimensions();
    const tfNow = getCachedGlobalTransform();
    const originNow = anchorOriginRef.current;
    const lastBuilt = lastBuiltTransformRef.current;
    if (
      dims &&
      (Math.abs(tfNow.offsetX - lastBuilt.offsetX) > 0.5 ||
        Math.abs(tfNow.offsetY - lastBuilt.offsetY) > 0.5 ||
        dims.pw !== lastBuilt.pw ||
        dims.ph !== lastBuilt.ph ||
        lastBuilt.layoutRev !== layoutRevisionRef.current ||
        Math.abs(originNow.width - lastBuilt.appW) > 0.5 ||
        Math.abs(originNow.height - lastBuilt.appH) > 0.5)
    ) {
      rebuildGlobalCommittedLayers();
    }

    const origin = anchorOriginRef.current;
    const docX = e.clientX - origin.left;
    const docY = e.clientY - origin.top;

    if (typeof window.focus === 'function' && !document.hasFocus()) {
      window.focus();
    }

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic/unsupported pointer capture errors
    }
    activePointerIdRef.current = e.pointerId;
    activePointerTypeRef.current = e.pointerType;
    drawGestureStartClientRef.current = { x: e.clientX, y: e.clientY };
    isDrawingBodyClassActiveRef.current = false;
    if (e.currentTarget.style.cursor !== '') {
      e.currentTarget.style.cursor = '';
    }
    hasRecordedEraseUndoRef.current = false;

    if (activeTool === 'eraser') {
      const cRect = canvasRectRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      lastEraserPtRef.current = { x: localX, y: localY };
      eraseGlobalPath([{ x: localX, y: localY }]);
      return;
    }

    const pt: AnnotationPoint = {
      x: docX,
      y: docY,
      ...buildStylusPointMeta(e),
      t: performance.now(),
    };

    if (activeTool === 'lasso') {
      const cRect = canvasRectRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      const tf = getCachedGlobalTransform();
      const gIds = selectedGroupIdsRef.current;
      if (gIds.length > 0) {
        const picked = resolveStrokesList(
          globalStrokesRef.current.filter((s) => gIds.includes(s.id))
        );
        const gBounds = getStrokesGroupBounds(picked, tf);
        const cornerHandle = hitTestLassoGroupHandle(localX, localY, gBounds, 13);
        if (cornerHandle && gBounds) {
          setSelectedStrokeAnchor(null);
          hoveredGroupHandleRef.current = cornerHandle;
          groupDragSessionRef.current = {
            mode: 'resize',
            handleId: cornerHandle,
            origBounds: gBounds,
            strokeIds: picked.map((s) => s.id),
            startNorm: pt,
            origStrokes: picked,
            currentStrokes: picked,
          };
          rebuildGlobalCommittedLayers();
          dirtyLiveRef.current = { draft: true, hl: true };
          renderGlobalLiveDraft();
          return;
        }
        if (
          gBounds &&
          localX >= gBounds.minX - 6 &&
          localX <= gBounds.maxX + 6 &&
          localY >= gBounds.minY - 6 &&
          localY <= gBounds.maxY + 6
        ) {
          setSelectedStrokeAnchor(null);
          groupDragSessionRef.current = {
            mode: 'move',
            strokeIds: picked.map((s) => s.id),
            startNorm: pt,
            origStrokes: picked,
            currentStrokes: picked,
          };
          rebuildGlobalCommittedLayers();
          dirtyLiveRef.current = { draft: true, hl: true };
          renderGlobalLiveDraft();
          return;
        }
      }

      hoveredGroupHandleRef.current = null;
      selectedGroupIdsRef.current = [];
      setSelectedStrokeIds(null);
      lassoLoopRef.current = [{ x: localX, y: localY }];
      dirtyLiveRef.current = { draft: true, hl: false };
      renderGlobalLiveDraft();
      return;
    }

    // 1) If a shape is already selected, allow left-dragging directly on one of its handles
    if (isDrawTool && selectedStrokeIdRef.current && e.button === 0 && !e.altKey) {
      const cRect = canvasRectRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      const tf = getCachedGlobalTransform();
      const rawCurSel = globalStrokesRef.current.find((s) => s.id === selectedStrokeIdRef.current);
      const curSel = rawCurSel ? resolveSingleStroke(rawCurSel) : undefined;
      if (curSel?.shape) {
        const h = hitTestShapeHandle(localX, localY, curSel.shape, tf, 12);
        if (h) {
          setSelectedStrokeAnchor(null);
          if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
            draftCanvasRef.current.style.opacity = '';
          }
          editingHiddenStrokeIdRef.current = curSel.id;
          editingStrokeRef.current = curSel;
          editSessionRef.current = {
            strokeId: curSel.id,
            mode: 'handle',
            handleId: h.id,
            startNorm: pt,
            origStroke: curSel,
          };
          rebuildGlobalCommittedLayers();
          dirtyLiveRef.current = {
            draft: true,
            hl: curSel.kind === 'highlighter',
          };
          renderGlobalLiveDraft();
          return;
        }
      }
      selectedStrokeIdRef.current = null;
      setSelectedStroke(null);
      clearGlobalDraftOverlay();
    }

    // 2) Right-click / Right-drag OR Alt+Drag moves/resizes any shape or stroke directly
    if (isRightButton || isAltEdit) {
      const cRect = canvasRectRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      const tf = getCachedGlobalTransform();
      const list = resolveStrokesList(globalStrokesRef.current);
      let hitStroke: AnnotationStroke | null = null;
      let hitHandleId: string | null = null;

      if (selectedStrokeIdRef.current) {
        const curSel = list.find((s) => s.id === selectedStrokeIdRef.current);
        if (curSel?.shape) {
          const h = hitTestShapeHandle(localX, localY, curSel.shape, tf, 12);
          if (h) {
            hitStroke = curSel;
            hitHandleId = h.id;
          }
        }
      }

      if (!hitStroke) {
        for (let i = list.length - 1; i >= 0; i--) {
          const st = list[i];
          if (st.shape) {
            const h = hitTestShapeHandle(localX, localY, st.shape, tf, 11);
            if (h) {
              hitStroke = st;
              hitHandleId = h.id;
              break;
            }
          }
        }
      }

      if (!hitStroke) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitTestShapeStroke(localX, localY, list[i], tf, 10)) {
            hitStroke = list[i];
            break;
          }
        }
      }

      if (hitStroke) {
        selectedStrokeIdRef.current = hitStroke.id;
        setSelectedStroke({ surfaceId: globalSurfaceId, strokeId: hitStroke.id });
        setSelectedStrokeAnchor(null);
        if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
          draftCanvasRef.current.style.opacity = '';
        }
        editingHiddenStrokeIdRef.current = hitStroke.id;
        editingStrokeRef.current = hitStroke;
        editSessionRef.current = {
          strokeId: hitStroke.id,
          mode: hitHandleId ? 'handle' : 'move',
          handleId: hitHandleId,
          startNorm: pt,
          origStroke: hitStroke,
        };
        rebuildGlobalCommittedLayers();
        dirtyLiveRef.current = {
          draft: true,
          hl: hitStroke.kind === 'highlighter',
        };
        renderGlobalLiveDraft();
        return;
      }

      selectedStrokeIdRef.current = null;
      setSelectedStroke(null);
      activePointerIdRef.current = null;
      activePointerTypeRef.current = null;
      drawGestureStartClientRef.current = null;
      isDrawingBodyClassActiveRef.current = false;
      clearGlobalDraftOverlay();
      return;
    }

    const isHighlighter = activeTool === 'highlighter';
    snapBaseRef.current = null;
    hlAxisLockRef.current = { axis: 'none', peakExcursionPx: 0 };
    morphAnimRef.current = null;
    magneticCueRef.current = null;
    tapeTapStartRef.current =
      activeTool === 'tape'
        ? {
            sx: e.clientX - canvasRectRef.current.left,
            sy: e.clientY - canvasRectRef.current.top,
            maxMove: 0,
          }
        : null;

    const strokeId = `gst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (activeTool === 'highlighter') {
      draftRef.current = {
        id: strokeId,
        kind: 'highlighter',
        color: highlighterSettings.color,
        size: highlighterSettings.size,
        opacity: highlighterSettings.opacity,
        smoothing: highlighterSettings.smoothing,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'fountain') {
      draftRef.current = {
        id: strokeId,
        kind: 'fountain',
        color: fountainSettings.color,
        size: fountainSettings.size,
        opacity: fountainSettings.opacity,
        smoothing: fountainSettings.smoothing,
        nibAngleDeg: fountainSettings.nibAngleDeg,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'pencil') {
      draftRef.current = {
        id: strokeId,
        kind: 'pencil',
        color: pencilSettings.color,
        size: pencilSettings.size,
        opacity: pencilSettings.opacity,
        smoothing: pencilSettings.smoothing,
        points: [pt],
        shape: undefined,
      };
    } else if (activeTool === 'tape') {
      draftRef.current = {
        id: strokeId,
        kind: 'tape',
        color: tapeSettings.color,
        size: tapeSettings.size,
        opacity: tapeSettings.opacity,
        smoothing: tapeSettings.smoothing,
        tapePattern: tapeSettings.pattern,
        revealed: false,
        points: [pt],
        shape: undefined,
      };
    } else {
      draftRef.current = {
        id: strokeId,
        kind: 'pen',
        color: penSettings.color,
        size: penSettings.size,
        opacity: penSettings.opacity,
        smoothing: penSettings.smoothing,
        lineStyle: penSettings.lineStyle,
        points: [pt],
        shape: undefined,
      };
    }

    if (draftCanvasRef.current && draftCanvasRef.current.style.opacity !== '') {
      draftCanvasRef.current.style.opacity = '';
    }

    holdPathAccumRef.current = 0;
    mergePrevStrokeIdRef.current = null;
    lockPerfectRef.current = e.ctrlKey || e.shiftKey;
    shiftRulerActiveRef.current = e.shiftKey;
    lastRawPtRef.current = pt;
    armHoldSnapTimer(e.clientX, e.clientY);
    dirtyLiveRef.current = { draft: !isHighlighter, hl: isHighlighter };
    renderGlobalLiveDraft();
  };

  useEffect(() => {
    const onModifierChange = (ev: KeyboardEvent) => {
      if (ev.key !== 'Control' && ev.key !== 'Shift') return;
      if (activePointerIdRef.current === null || !draftRef.current) return;
      const cur = draftRef.current;
      const pt = lastRawPtRef.current ?? cur.points[cur.points.length - 1];
      if (!pt) return;

      if (ev.shiftKey && !cur.shape && cur.points.length >= 1) {
        clearHoldTimer();
        morphAnimRef.current = null;
        magneticCueRef.current = null;
        shiftRulerActiveRef.current = true;
        lockPerfectRef.current = true;
        const p0 = cur.points[0];
        const rawLine = { type: 'line' as const, x1: p0.x, y1: p0.y, x2: pt.x, y2: pt.y };
        snapBaseRef.current = { shape: rawLine, anchorX: pt.x, anchorY: pt.y };
        cur.shape = adjustSnappedShapeOnDrag(rawLine, pt, 1, 1, snapBaseRef.current, true, 15);
        dirtyLiveRef.current = { draft: true, hl: cur.kind === 'highlighter' };
        renderGlobalLiveDraft();
        return;
      }

      const nextLock = ev.ctrlKey || ev.shiftKey;
      if (lockPerfectRef.current === nextLock) return;
      lockPerfectRef.current = nextLock;
      if (nextLock) {
        magneticCueRef.current = null;
      }

      if (!cur.shape) return;
      cur.shape = adjustSnappedShapeOnDrag(
        cur.shape,
        pt,
        1,
        1,
        snapBaseRef.current,
        nextLock,
        shiftRulerActiveRef.current ? 15 : 45
      );
      dirtyLiveRef.current = { draft: true, hl: cur.kind === 'highlighter' };
      renderGlobalLiveDraft();
    };
    window.addEventListener('keydown', onModifierChange);
    window.addEventListener('keyup', onModifierChange);
    return () => {
      window.removeEventListener('keydown', onModifierChange);
      window.removeEventListener('keyup', onModifierChange);
    };
  }, [clearHoldTimer, renderGlobalLiveDraft]);

  const handleGlobalPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isGlobalDrawActive) return;

    if (e.pointerType === 'pen') {
      lastPenActivityAtRef.current = performance.now();
    }

    if (
      activePointerIdRef.current === e.pointerId &&
      !isDrawingBodyClassActiveRef.current &&
      drawGestureStartClientRef.current
    ) {
      const dx = e.clientX - drawGestureStartClientRef.current.x;
      const dy = e.clientY - drawGestureStartClientRef.current.y;
      if (dx * dx + dy * dy >= 16) {
        isDrawingBodyClassActiveRef.current = true;
        if (systemSettings.autoMinimizeWhileDrawing) {
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('safara:annotation-stroke-start'));
          });
        }
      }
    }

    if (activeTool === 'eraser') {
      if (e.currentTarget.style.cursor !== '') {
        e.currentTarget.style.cursor = '';
      }
      if (activePointerIdRef.current === e.pointerId) {
        if (canvasRectRef.current.width <= 0) {
          refreshGlobalGeometry();
        }
        const cRect = canvasRectRef.current;
        const samples =
          typeof e.nativeEvent.getCoalescedEvents === 'function'
            ? e.nativeEvent.getCoalescedEvents()
            : null;
        const sampleCount = samples && samples.length > 0 ? samples.length : 0;
        const loopLen = sampleCount > 0 ? sampleCount : 1;

        const sweepPts: Array<{ x: number; y: number }> = [];
        if (lastEraserPtRef.current) {
          sweepPts.push(lastEraserPtRef.current);
        }

        for (let i = 0; i < loopLen; i++) {
          const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
          const localX = ev.clientX - cRect.left;
          const localY = ev.clientY - cRect.top;
          const prevSweep = sweepPts[sweepPts.length - 1];
          if (!prevSweep || Math.hypot(localX - prevSweep.x, localY - prevSweep.y) >= 1.2) {
            sweepPts.push({ x: localX, y: localY });
          }
        }

        if (sweepPts.length > 0) {
          lastEraserPtRef.current = sweepPts[sweepPts.length - 1];
          eraseGlobalPath(sweepPts);
        }
      }
      return;
    }

    if (activeTool === 'lasso') {
      if (canvasRectRef.current.width <= 0) {
        refreshGlobalGeometry();
      }
      const cRect = canvasRectRef.current;
      const origin = anchorOriginRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      const tf = getCachedGlobalTransform();
      if (activePointerIdRef.current === null) {
        const gIds = selectedGroupIdsRef.current;
        let nextCursor = '';
        let nextHoverHandle: LassoGroupHandleId | null = null;
        if (gIds.length > 0) {
          const picked = resolveStrokesList(
            globalStrokesRef.current.filter((s) => gIds.includes(s.id))
          );
          const gb = getStrokesGroupBounds(picked, tf);
          nextHoverHandle = hitTestLassoGroupHandle(localX, localY, gb, 13);
          if (nextHoverHandle) {
            nextCursor =
              nextHoverHandle === 'nw' || nextHoverHandle === 'se' ? 'nwse-resize' : 'nesw-resize';
          } else if (
            gb &&
            localX >= gb.minX - 6 &&
            localX <= gb.maxX + 6 &&
            localY >= gb.minY - 6 &&
            localY <= gb.maxY + 6
          ) {
            nextCursor = 'move';
          }
        }
        if (hoveredGroupHandleRef.current !== nextHoverHandle) {
          hoveredGroupHandleRef.current = nextHoverHandle;
          scheduleGlobalDraw({ draft: true });
        }
        if (e.currentTarget.style.cursor !== nextCursor) {
          e.currentTarget.style.cursor = nextCursor;
        }
        return;
      }
      if (activePointerIdRef.current === e.pointerId) {
        if (groupDragSessionRef.current) {
          const sess = groupDragSessionRef.current;
          if (sess.mode === 'resize' && sess.handleId && sess.origBounds) {
            sess.currentStrokes = scaleStrokesInGroup(
              sess.origStrokes,
              sess.origBounds,
              sess.handleId,
              localX,
              localY,
              tf,
              e.shiftKey
            );
          } else {
            const dx = e.clientX - origin.left - sess.startNorm.x;
            const dy = e.clientY - origin.top - sess.startNorm.y;
            sess.currentStrokes = sess.origStrokes.map((st) => translateStroke(st, dx, dy));
          }
          scheduleGlobalDraw({ draft: true, hl: true });
          return;
        }
        if (lassoLoopRef.current) {
          const pts = lassoLoopRef.current;
          if (lassoSettings.mode === 'rect') {
            const last = pts[pts.length - 1];
            if (!last || Math.hypot(localX - last.x, localY - last.y) >= 2) {
              lassoLoopRef.current = [pts[0], { x: localX, y: localY }];
              scheduleGlobalDraw({ draft: true });
            }
          } else {
            const samples =
              typeof e.nativeEvent.getCoalescedEvents === 'function'
                ? e.nativeEvent.getCoalescedEvents()
                : null;
            const sampleCount = samples && samples.length > 0 ? samples.length : 0;
            const loopLen = sampleCount > 0 ? sampleCount : 1;
            let didAdd = false;
            for (let i = 0; i < loopLen; i++) {
              const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
              const sx = ev.clientX - cRect.left;
              const sy = ev.clientY - cRect.top;
              const last = pts[pts.length - 1];
              if (!last || Math.hypot(sx - last.x, sy - last.y) >= 2.5) {
                pts.push({ x: sx, y: sy });
                didAdd = true;
              }
            }
            if (didAdd) {
              scheduleGlobalDraw({ draft: true });
            }
          }
          return;
        }
      }
      return;
    }

    if (activePointerIdRef.current === null) {
      if (!selectedStrokeIdRef.current && !e.altKey) {
        if (e.currentTarget.style.cursor !== '') {
          e.currentTarget.style.cursor = '';
        }
        return;
      }
      if (canvasRectRef.current.width <= 0) {
        refreshGlobalGeometry();
      }
      const cRect = canvasRectRef.current;
      const localX = e.clientX - cRect.left;
      const localY = e.clientY - cRect.top;
      const tf = getCachedGlobalTransform();
      let nextCursor = '';
      const selId = selectedStrokeIdRef.current;
      if (selId) {
        const rawSel = globalStrokesRef.current.find((s) => s.id === selId);
        const sel = rawSel ? resolveSingleStroke(rawSel) : undefined;
        if (sel?.shape && hitTestShapeHandle(localX, localY, sel.shape, tf, 12)) {
          nextCursor = 'move';
        }
      }
      if (!nextCursor && e.altKey) {
        const resolvedList = resolveStrokesList(globalStrokesRef.current);
        for (let i = resolvedList.length - 1; i >= 0; i--) {
          const st = resolvedList[i];
          if (
            (st.shape && hitTestShapeHandle(localX, localY, st.shape, tf, 11)) ||
            hitTestShapeStroke(localX, localY, st, tf, 10)
          ) {
            nextCursor = 'move';
            break;
          }
        }
      }
      if (e.currentTarget.style.cursor !== nextCursor) {
        e.currentTarget.style.cursor = nextCursor;
      }
      return;
    }

    if (editSessionRef.current && activePointerIdRef.current === e.pointerId) {
      const origin = anchorOriginRef.current;
      const session = editSessionRef.current;
      const lockPerfect = e.ctrlKey || e.shiftKey;
      const tf = getCachedGlobalTransform();
      const rawPt: AnnotationPoint = {
        x: e.clientX - origin.left,
        y: e.clientY - origin.top,
        ...buildStylusPointMeta(e),
        t: performance.now(),
      };

      if (session.mode === 'move') {
        const dx = rawPt.x - session.startNorm.x;
        const dy = rawPt.y - session.startNorm.y;
        editingStrokeRef.current = translateStroke(session.origStroke, dx, dy);
        magneticCueRef.current = null;
      } else if (session.handleId && session.origStroke.shape) {
        let targetPt = rawPt;
        const hId = session.handleId;
        const isEndpointHandle =
          hId === 'start' ||
          hId === 'end' ||
          (session.origStroke.shape.type === 'polygon' && !session.origStroke.shape.closed);
        if (!e.altKey && !lockPerfect && isEndpointHandle) {
          const snap = findMagneticSnapTarget(
            rawPt,
            resolveStrokesList(globalStrokesRef.current),
            tf,
            session.strokeId,
            12
          );
          if (snap) {
            targetPt = { ...rawPt, x: snap.x, y: snap.y };
            magneticCueRef.current = { x: snap.screenX, y: snap.screenY };
          } else {
            magneticCueRef.current = null;
          }
        } else {
          magneticCueRef.current = null;
        }
        const nextShape = applyShapeHandleDrag(
          session.origStroke.shape,
          session.handleId,
          targetPt,
          1,
          1,
          lockPerfect,
          session.startNorm
        );
        if (session.handleId === 'rotate') {
          const b = getStrokeScreenBounds(session.origStroke, tf);
          const localX = e.clientX - canvasRectRef.current.left;
          const localY = e.clientY - canvasRectRef.current.top;
          const sLocalX = session.startNorm.x + tf.offsetX;
          const sLocalY = session.startNorm.y + tf.offsetY;
          const cx = b ? (b.minX + b.maxX) * 0.5 : localX;
          const cy = b ? (b.minY + b.maxY) * 0.5 : localY;
          const a0 = Math.atan2(sLocalY - cy, sLocalX - cx);
          const a1 = Math.atan2(localY - cy, localX - cx);
          let deg = ((a1 - a0) * 180) / Math.PI;
          if (lockPerfect) deg = Math.round(deg / 15) * 15;
          session.rotationDeg = deg;
        } else {
          session.rotationDeg = null;
        }
        editingStrokeRef.current = {
          ...session.origStroke,
          shape: nextShape,
          points: remapPointsAfterShapeEdit(
            session.origStroke,
            nextShape,
            tf,
            session.handleId,
            session.startNorm,
            targetPt
          ),
        };
      }

      scheduleGlobalDraw({ draft: true, hl: session.origStroke.kind === 'highlighter' });
      return;
    }

    if (activePointerIdRef.current !== e.pointerId || !draftRef.current) return;
    const draft = draftRef.current;
    const origin = anchorOriginRef.current;
    const nowTs = performance.now();

    const lockPerfect = e.ctrlKey || e.shiftKey;
    lockPerfectRef.current = lockPerfect;
    const rawMovePt: AnnotationPoint = {
      x: e.clientX - origin.left,
      y: e.clientY - origin.top,
      ...buildStylusPointMeta(e),
      t: nowTs,
    };
    lastRawPtRef.current = rawMovePt;

    if (tapeTapStartRef.current) {
      const localX = e.clientX - canvasRectRef.current.left;
      const localY = e.clientY - canvasRectRef.current.top;
      const moved = Math.hypot(localX - tapeTapStartRef.current.sx, localY - tapeTapStartRef.current.sy);
      if (moved > tapeTapStartRef.current.maxMove) {
        tapeTapStartRef.current.maxMove = moved;
      }
    }

    if (e.shiftKey && !draft.shape && draft.points.length >= 1) {
      clearHoldTimer();
      morphAnimRef.current = null;
      magneticCueRef.current = null;
      shiftRulerActiveRef.current = true;
      const p0 = draft.points[0];
      const rawLine = { type: 'line' as const, x1: p0.x, y1: p0.y, x2: rawMovePt.x, y2: rawMovePt.y };
      snapBaseRef.current = { shape: rawLine, anchorX: rawMovePt.x, anchorY: rawMovePt.y };
      draft.shape = adjustSnappedShapeOnDrag(rawLine, rawMovePt, 1, 1, snapBaseRef.current, true, 15);
      dirtyLiveRef.current = { draft: true, hl: draft.kind === 'highlighter' };
      renderGlobalLiveDraft();
      return;
    }

    if (draft.shape) {
      if (morphAnimRef.current) {
        const anchor = holdAnchorRef.current;
        if (!anchor || Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) > 4.5) {
          morphAnimRef.current = null;
        }
      }
      const tf = getCachedGlobalTransform();
      const isEndpointDrag =
        draft.shape.type === 'line' ||
        draft.shape.type === 'arc' ||
        draft.shape.type === 'arrow' ||
        draft.shape.type === 'brace' ||
        draft.shape.type === 'curve' ||
        (draft.shape.type === 'polygon' && !draft.shape.closed);

      let snappedMovePt = rawMovePt;
      if (!e.altKey && !lockPerfect && isEndpointDrag) {
        const snap = findMagneticSnapTarget(
          rawMovePt,
          resolveStrokesList(globalStrokesRef.current),
          tf,
          draft.id,
          12
        );
        if (snap) {
          snappedMovePt = { ...rawMovePt, x: snap.x, y: snap.y };
          magneticCueRef.current = { x: snap.screenX, y: snap.screenY };
        } else {
          magneticCueRef.current = null;
        }
      } else {
        magneticCueRef.current = null;
      }

      draft.shape = adjustSnappedShapeOnDrag(
        draft.shape,
        snappedMovePt,
        1,
        1,
        snapBaseRef.current,
        lockPerfect,
        shiftRulerActiveRef.current ? 15 : 45
      );
      scheduleGlobalDraw(draft.kind === 'highlighter' ? { hl: true, draft: true } : { draft: true });
      return;
    }

    const samples =
      typeof e.nativeEvent.getCoalescedEvents === 'function'
        ? e.nativeEvent.getCoalescedEvents()
        : null;
    const sampleCount = samples && samples.length > 0 ? samples.length : 0;
    const activeSmoothing =
      draft.kind === 'highlighter'
        ? highlighterSettings.smoothing
        : draft.kind === 'fountain'
        ? fountainSettings.smoothing
        : draft.kind === 'pencil'
        ? pencilSettings.smoothing
        : draft.kind === 'tape'
        ? tapeSettings.smoothing
        : penSettings.smoothing;
    const smoothT = Math.max(0, Math.min(1, (activeSmoothing - 0.01) / 0.99));
    let didAppend = false;
    let appendedPathPx = 0;

    const loopLen = sampleCount > 0 ? sampleCount : 1;
    const firstSampleTs = sampleCount > 1 ? samples![0].timeStamp : 0;
    const lastSampleTs = sampleCount > 1 ? samples![sampleCount - 1].timeStamp : 0;
    const hasCoalescedSpan = sampleCount > 1 && lastSampleTs > firstSampleTs;
    for (let i = 0; i < loopLen; i++) {
      const ev = sampleCount > 0 ? samples![i] : e.nativeEvent;
      if (sampleCount > 1 && ev.clientX === 0 && ev.clientY === 0 && (e.clientX !== 0 || e.clientY !== 0)) {
        continue;
      }
      const sx = ev.clientX - origin.left;
      const sy = ev.clientY - origin.top;
      const prev = draft.points[draft.points.length - 1];
      const minStepPx =
        draft.kind === 'highlighter' || draft.kind === 'tape'
          ? ev.pointerType === 'pen'
            ? 0.72 + smoothT * 0.58
            : 1.0 + smoothT * 1.05
          : ev.pointerType === 'pen'
          ? 0.65 + smoothT * 0.55
          : 0.85 + smoothT * 0.95;
      const dx = sx - prev.x;
      const dy = sy - prev.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < minStepPx * minStepPx) continue;

      let finalX = sx;
      let finalY = sy;
      const useStraightAssist =
        (draft.kind === 'highlighter' && highlighterSettings.straightAssist) ||
        (draft.kind === 'tape' && tapeSettings.straightAssist);
      if (useStraightAssist && draft.points.length >= 2) {
        const first = draft.points[0];
        const absDx = Math.abs(sx - first.x);
        const absDy = Math.abs(sy - first.y);
        const lock = hlAxisLockRef.current;
        if (lock.axis === 'none') {
          if (absDx > 14 && absDy < Math.max(12, absDx * 0.14)) {
            lock.axis = 'h';
            lock.peakExcursionPx = absDx;
          } else if (absDy > 14 && absDx < Math.max(10, absDy * 0.12)) {
            lock.axis = 'v';
            lock.peakExcursionPx = absDy;
          }
        }
        if (lock.axis === 'h') {
          if (absDx > lock.peakExcursionPx) lock.peakExcursionPx = absDx;
          if (absDy > Math.max(22, lock.peakExcursionPx * 0.26)) {
            lock.axis = 'broken';
          } else {
            finalY = prev.y * 0.74 + first.y * 0.2 + sy * 0.06;
          }
        } else if (lock.axis === 'v') {
          if (absDy > lock.peakExcursionPx) lock.peakExcursionPx = absDy;
          if (absDx > Math.max(22, lock.peakExcursionPx * 0.26)) {
            lock.axis = 'broken';
          } else {
            finalX = prev.x * 0.74 + first.x * 0.2 + sx * 0.06;
          }
        }
      }

      const rawSampleTs = hasCoalescedSpan
        ? nowTs - Math.min(32, lastSampleTs - ev.timeStamp)
        : nowTs;
      const sampleTs = Math.max(prev.t + 0.25, rawSampleTs);

      draft.points.push({
        x: finalX,
        y: finalY,
        ...buildStylusPointMeta(ev),
        t: sampleTs,
      });
      appendedPathPx += Math.sqrt(distSq);
      didAppend = true;
    }

    if (!didAppend) {
      return;
    }

    holdPathAccumRef.current += appendedPathPx;
    const anchor = holdAnchorRef.current;
    if (
      !anchor ||
      holdPathAccumRef.current >= HOLD_PATH_RESET_PX ||
      (e.clientX - anchor.x) * (e.clientX - anchor.x) +
        (e.clientY - anchor.y) * (e.clientY - anchor.y) >
        HOLD_MOVE_THRESHOLD_PX * HOLD_MOVE_THRESHOLD_PX
    ) {
      holdPathAccumRef.current = 0;
      armHoldSnapTimer(e.clientX, e.clientY);
    }

    if (draft.kind === 'highlighter') {
      scheduleGlobalDraw({ hl: true });
    } else {
      scheduleGlobalDraw({ draft: true });
    }
  };

  const commitGlobalPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    activePointerTypeRef.current = null;
    drawGestureStartClientRef.current = null;
    isDrawingBodyClassActiveRef.current = false;
    if (drawRafRef.current) {
      cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = 0;
    }
    clearHoldTimer();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    if (activeTool === 'eraser') {
      lastEraserPtRef.current = null;
      hasRecordedEraseUndoRef.current = false;
      return;
    }

    if (activeTool === 'lasso' && globalSurfaceId) {
      if (groupDragSessionRef.current) {
        const sess = groupDragSessionRef.current;
        const didMutate = sess.currentStrokes[0] !== sess.origStrokes[0];
        const movedMap = new Map(
          sess.currentStrokes.map((s) => [s.id, didMutate ? withCapturedGlobalAnchor(s) : s])
        );
        groupDragSessionRef.current = null;
        if (didMutate) {
          updateStrokesBatch(globalSurfaceId, sess.strokeIds, (st) => movedMap.get(st.id) ?? st, true);
        } else {
          rebuildGlobalCommittedLayers();
        }
        scheduleGlobalDraw({ draft: true });
        syncGlobalSelectedAnchor(sess.strokeIds[0] ?? null);
        return;
      }

      const loop = lassoLoopRef.current;
      lassoLoopRef.current = null;
      const tf = getCachedGlobalTransform();
      const isLassoDrag =
        !!loop &&
        loop.length >= 2 &&
        (lassoSettings.mode === 'rect'
          ? Math.hypot(loop[loop.length - 1].x - loop[0].x, loop[loop.length - 1].y - loop[0].y) >= 8
          : (() => {
              let totalDist = 0;
              for (let i = 1; i < loop.length; i++) {
                totalDist += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y);
                if (totalDist >= 8) return true;
              }
              return false;
            })());
      if (loop && isLassoDrag) {
        const foundIds = findStrokesInLasso(
          loop,
          resolveStrokesList(globalStrokesRef.current),
          tf,
          {
            mode: lassoSettings.mode,
            matchMode: lassoSettings.matchMode,
            includeHighlights: lassoSettings.includeHighlights,
          }
        );
        selectedGroupIdsRef.current = foundIds;
        setSelectedStrokeIds(
          foundIds.length > 0 ? { surfaceId: globalSurfaceId, strokeIds: foundIds } : null
        );
        if (foundIds.length > 0) {
          scheduleGlobalDraw({ draft: true });
          syncGlobalSelectedAnchor(foundIds[0]);
        } else {
          clearGlobalDraftOverlay();
        }
        return;
      }
      if (loop && loop.length >= 1) {
        const tap = loop[loop.length - 1];
        const list = resolveStrokesList(globalStrokesRef.current);
        let hitId: string | null = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitTestShapeStroke(tap.x, tap.y, list[i], tf, 10)) {
            hitId = list[i].id;
            break;
          }
        }
        if (hitId) {
          selectedGroupIdsRef.current = [hitId];
          setSelectedStrokeIds({ surfaceId: globalSurfaceId, strokeIds: [hitId] });
          scheduleGlobalDraw({ draft: true });
          syncGlobalSelectedAnchor(hitId);
        } else {
          clearGlobalDraftOverlay();
        }
        return;
      }
      clearGlobalDraftOverlay();
      return;
    }

    if (editSessionRef.current) {
      const session = editSessionRef.current;
      const finalEdit = editingStrokeRef.current;
      editSessionRef.current = null;
      editingHiddenStrokeIdRef.current = null;
      editingStrokeRef.current = null;
      magneticCueRef.current = null;

      if (finalEdit && globalSurfaceId && finalEdit !== session.origStroke) {
        const anchoredEdit = withCapturedGlobalAnchor(finalEdit);
        updateStroke(globalSurfaceId, session.strokeId, () => anchoredEdit, true);
      } else {
        rebuildGlobalCommittedLayers();
      }
      if (isGlobalDrawSelectionTool(activeTool) && selectedStrokeIdRef.current) {
        scheduleGlobalDraw({ draft: true });
        syncGlobalSelectedAnchor(selectedStrokeIdRef.current);
      } else {
        selectedStrokeIdRef.current = null;
        clearGlobalDraftOverlay();
      }
      return;
    }

    const draft = draftRef.current;
    const mergePrevId = mergePrevStrokeIdRef.current;
    const tapeTapInfo = tapeTapStartRef.current;
    mergePrevStrokeIdRef.current = null;
    tapeTapStartRef.current = null;
    draftRef.current = null;
    snapBaseRef.current = null;
    shiftRulerActiveRef.current = false;
    morphAnimRef.current = null;
    magneticCueRef.current = null;

    if (draft && draft.kind === 'tape' && tapeTapInfo && tapeTapInfo.maxMove < 7 && globalSurfaceId) {
      const tf = getCachedGlobalTransform();
      const list = resolveStrokesList(globalStrokesRef.current);
      let hitTape: AnnotationStroke | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const st = list[i];
        if (st.kind === 'tape' && hitTestStroke(tapeTapInfo.sx, tapeTapInfo.sy, st, 8, tf)) {
          hitTape = st;
          break;
        }
      }
      if (hitTape) {
        clearGlobalDraftOverlay();
        toggleTapeRevealed(globalSurfaceId, hitTape.id);
        return;
      }
    }

    if (draft && globalSurfaceId && (draft.points.length > 0 || draft.shape)) {
      const scribbleEnabled =
        systemSettings.scribbleErase &&
        (draft.kind === 'pen' || draft.kind === 'fountain' || draft.kind === 'pencil');

      if (scribbleEnabled && !draft.shape && !mergePrevId) {
        const tf = getCachedGlobalTransform();
        const erasedIds = findScribbleErasedStrokeIds(
          draft.points,
          resolveStrokesList(globalStrokesRef.current),
          tf
        );
        if (erasedIds.length > 0) {
          let sumX = 0;
          let sumY = 0;
          for (let i = 0; i < draft.points.length; i++) {
            sumX += draft.points[i].x * tf.scaleX + tf.offsetX;
            sumY += draft.points[i].y * tf.scaleY + tf.offsetY;
          }
          clearGlobalDraftOverlay();
          restoreGlobalHlDraftArea();
          erasePulseRef.current = {
            x: sumX / draft.points.length,
            y: sumY / draft.points.length,
            startedAt: performance.now(),
          };
          removeStrokes(globalSurfaceId, erasedIds);
          scheduleGlobalDraw({ draft: true });
          return;
        }
      }

      const anchoredDraft = withCapturedGlobalAnchor(draft);
      if (anchoredDraft.kind !== 'highlighter') {
        stampGlobalCommittedStroke(anchoredDraft, false);
        clearGlobalDraftOverlay();
      } else {
        stampGlobalCommittedStroke(anchoredDraft, true);
        clearGlobalDraftOverlay();
      }
      renderedStrokesRef.current = mergePrevId
        ? renderedStrokesRef.current.filter((s) => s.id !== mergePrevId).concat(anchoredDraft)
        : [...renderedStrokesRef.current, anchoredDraft];
      addStroke(globalSurfaceId, anchoredDraft, mergePrevId ? [mergePrevId] : undefined);
    } else {
      if (mergePrevId) {
        rebuildGlobalCommittedLayers();
      }
      clearGlobalDraftOverlay();
      restoreGlobalHlDraftArea();
    }
  };

  const globalTapeHotspots = useMemo(() => {
    if (hasBoundedSurface || activeTool !== 'cursor' || !globalSurfaceId) return [];
    const tf = getCachedGlobalTransform();
    const resolvedList = resolveStrokesList(globalStrokes);
    const items: Array<{ id: string; revealed: boolean; left: number; top: number; width: number; height: number }> = [];
    for (let i = 0; i < resolvedList.length; i++) {
      const st = resolvedList[i];
      if (st.kind !== 'tape') continue;
      const b = getStrokeScreenBounds(st, tf);
      if (!b) continue;
      items.push({
        id: st.id,
        revealed: Boolean(st.revealed),
        left: b.minX - 2,
        top: b.minY - 2,
        width: Math.max(22, b.maxX - b.minX + 4),
        height: Math.max(18, b.maxY - b.minY + 4),
      });
    }
    return items;
  }, [
    hasBoundedSurface,
    activeTool,
    globalSurfaceId,
    globalStrokes,
    layoutTick,
    getCachedGlobalTransform,
    resolveStrokesList,
  ]);

  // Do NOT mount full-screen fixed canvases while a bounded surface (e.g. Mushaf) owns drawing!
  if (hasBoundedSurface) {
    return null;
  }

  return (
    <>
      <canvas
        ref={hlCanvasRef}
        className="global-annotation-canvas is-highlighter-layer"
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      <canvas
        ref={penCanvasRef}
        tabIndex={-1}
        className={`global-annotation-stage is-tool-${activeTool} ${
          isGlobalDrawActive ? 'is-capturing' : ''
        } ${systemSettings.pencilOnlyMode ? 'is-pencil-only' : ''}`}
        aria-hidden="true"
        onPointerDown={handleGlobalPointerDown}
        onPointerMove={handleGlobalPointerMove}
        onPointerUp={commitGlobalPointer}
        onPointerCancel={commitGlobalPointer}
        onPointerLeave={(e) => {
          if (e.currentTarget.style.cursor !== '') {
            e.currentTarget.style.cursor = '';
          }
        }}
        onContextMenu={(e) => {
          if (isGlobalDrawActive) e.preventDefault();
        }}
      />
      <canvas
        ref={draftCanvasRef}
        className="global-annotation-canvas is-draft-layer"
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      {globalSurfaceId && globalTapeHotspots.length > 0 && (
        <div className="global-tape-hotspots-layer" aria-hidden="false">
          {globalTapeHotspots.map((spot) => (
            <button
              key={spot.id}
              type="button"
              className={`annotation-tape-hotspot ${spot.revealed ? 'is-revealed' : ''}`}
              style={{
                left: `${Math.round(spot.left)}px`,
                top: `${Math.round(spot.top)}px`,
                width: `${Math.round(spot.width)}px`,
                height: `${Math.round(spot.height)}px`,
              }}
              title={spot.revealed ? 'إخفاء شريط التحفيظ مجدداً' : 'اضغط لكشف الكلمة المخفية'}
              aria-label={spot.revealed ? 'إخفاء شريط التحفيظ مجدداً' : 'كشف الكلمة المخفية'}
              aria-pressed={spot.revealed}
              onClick={(e) => {
                e.stopPropagation();
                toggleTapeRevealed(globalSurfaceId, spot.id);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
};

/**
 * Root-level Pro-Grade Optical Laser Layer (mounted at root stacking context, z-index 9990).
 *
 * Demand-driven RAF architecture:
 * - Zero idle spin! Automatically halts requestAnimationFrame when the pointer rests still
 *   and no trails/pulses are fading — eliminating needless video encoding frames during Google Meet.
 * - Zero getBoundingClientRect() during pointermove or animation frames via cached viewport metrics.
 * - Hides the canvas completely when inactive in other tools so GPU VRAM & compositor stay free.
 */
export const OpticalLaserLayer: React.FC = () => {
  const { activeTool, laserSettings, systemSettings } = useAnnotationToolState();

  const laserCanvasRef = useRef<HTMLCanvasElement>(null);
  const laserRafRef = useRef<number>(0);
  const laserActiveRef = useRef(false);
  const laserDownRef = useRef(false);
  const laserActivePointerTypeRef = useRef<string | null>(null);
  const laserLastPenAtRef = useRef<number>(0);
  const laserOverUiRef = useRef(false);
  const laserTrailsRef = useRef<LaserTrail[]>([]);
  const laserWriteTrailRef = useRef<LaserTrail | null>(null);
  const laserPulsesRef = useRef<LaserPulse[]>([]);
  const laserSpotlightRef = useRef<{
    x: number;
    y: number;
    color: string;
    radius: number;
    releasedAt: number | null;
  } | null>(null);
  const laserDirtyRectRef = useRef<PixelRect | null>(null);
  const laserHoldTimerRef = useRef<number | null>(null);
  const laserHoldAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const laserSnapBaseRef = useRef<SnapDragBase | null>(null);
  const laserRectRef = useRef<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  const laserSettingsRef = useRef(laserSettings);
  laserSettingsRef.current = laserSettings;
  const pencilOnlyModeRef = useRef(Boolean(systemSettings.pencilOnlyMode));
  pencilOnlyModeRef.current = Boolean(systemSettings.pencilOnlyMode);

  const syncLaserViewport = useCallback(() => {
    const canvas = laserCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const vw = rect.width || document.documentElement.clientWidth || window.innerWidth;
    const vh = rect.height || document.documentElement.clientHeight || window.innerHeight;
    laserRectRef.current = {
      left: rect.width > 0 ? rect.left : 0,
      top: rect.height > 0 ? rect.top : 0,
      width: vw,
      height: vh,
    };
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_LASER_DPR);
    const pw = Math.max(1, Math.round(vw * dpr));
    const ph = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      laserDirtyRectRef.current = null;
    }
  }, []);

  const renderLaserFrame = useCallback(() => {
    laserRafRef.current = 0;

    const canvas = laserCanvasRef.current;
    if (!canvas) return;

    const trails = laserTrailsRef.current;
    const pulses = laserPulsesRef.current;
    const spotlight = laserSpotlightRef.current;
    const hasWork = trails.length > 0 || pulses.length > 0 || spotlight !== null;

    if (!hasWork) {
      if (laserDirtyRectRef.current) {
        const prev = laserDirtyRectRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(prev.x, prev.y, prev.w, prev.h);
          ctx.restore();
        }
        laserDirtyRectRef.current = null;
      }
      if (canvas.style.display !== 'none') {
        canvas.style.display = 'none';
      }
      return;
    }

    if (canvas.style.display !== 'block') {
      canvas.style.display = 'block';
      syncLaserViewport();
    }
    if (canvas.width <= 1 || canvas.height <= 1) {
      syncLaserViewport();
    }

    const { width: vw, height: vh } = laserRectRef.current;
    const pw = canvas.width;
    const ph = canvas.height;
    if (vw <= 0 || vh <= 0 || pw <= 0 || ph <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    const scaleX = pw / vw;
    const scaleY = ph / vh;

    // Clear ONLY the previous frame's dirty bounding box instead of full viewport
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (laserDirtyRectRef.current) {
      const prev = laserDirtyRectRef.current;
      ctx.clearRect(prev.x, prev.y, prev.w, prev.h);
    } else {
      ctx.clearRect(0, 0, pw, ph);
    }
    ctx.scale(scaleX, scaleY);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let hasFadingTrails = false;
    let hasSpotlightAnim = false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (spotlight) {
      let spotAlpha = 1;
      if (spotlight.releasedAt !== null) {
        const elapsed = now - spotlight.releasedAt;
        if (elapsed >= 240) {
          laserSpotlightRef.current = null;
          spotAlpha = 0;
        } else {
          spotAlpha = Math.pow(1 - elapsed / 240, 1.45);
          hasSpotlightAnim = true;
        }
      }
      if (spotAlpha > 0.01) {
        ctx.save();
        ctx.fillStyle = `rgba(15, 23, 42, ${(0.56 * spotAlpha).toFixed(3)})`;
        ctx.fillRect(0, 0, vw, vh);

        // Soft feathered spotlight cutout aperture
        const r = spotlight.radius;
        const featherR = r * 1.18;
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(spotlight.x, spotlight.y, r * 0.62, spotlight.x, spotlight.y, featherR);
        grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
        grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.92)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(spotlight.x, spotlight.y, featherR, 0, Math.PI * 2);
        ctx.fill();

        // Subtle crisp luminous edge ring matching active laser jewel color
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(spotlight.x, spotlight.y, r * 0.92, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(spotlight.color, 0.42 * spotAlpha);
        ctx.lineWidth = 2.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(spotlight.x, spotlight.y, r * 0.92, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.34 * spotAlpha).toFixed(3)})`;
        ctx.lineWidth = 0.85;
        ctx.stroke();
        ctx.restore();

        minX = 0;
        minY = 0;
        maxX = vw;
        maxY = vh;
      }
    }

    for (let tIdx = trails.length - 1; tIdx >= 0; tIdx--) {
      const trail = trails[tIdx];

      let life = 1;
      if (trail.releasedAt !== null) {
        const totalWin = Math.max(
          400,
          trail.fadeDurationMs || LASER_HOLD_AFTER_RELEASE_MS + LASER_FADE_DURATION_MS
        );
        const holdMs = totalWin * 0.16;
        const fadeMs = totalWin * 0.84;
        const elapsedSinceRelease = now - trail.releasedAt;
        if (elapsedSinceRelease >= totalWin) {
          trails.splice(tIdx, 1);
          continue;
        }
        hasFadingTrails = true;
        if (elapsedSinceRelease > holdMs) {
          const u = (elapsedSinceRelease - holdMs) / Math.max(100, fadeMs);
          life = Math.pow(Math.max(0, 1 - u), 1.55);
        }
      }

      if (!trail.shape && (trail.points.length < 2 || life <= 0.01)) continue;
      if (life <= 0.01) continue;

      const beamW = Math.max(1.9, trail.size);

      // Rebuild cached Path2D & bounds ONLY when points/shape actually changed
      if (!trail.shape && trail.cachedRawLen !== trail.points.length) {
        const smoothed = smoothLaserSamples(trail.points, trail.smoothing);
        trail.cachedPath = buildSmoothLaserPath2D(smoothed);
        trail.cachedRawLen = trail.points.length;

        let bMinX = Infinity;
        let bMinY = Infinity;
        let bMaxX = -Infinity;
        let bMaxY = -Infinity;
        for (let i = 0; i < smoothed.length; i++) {
          const pt = smoothed[i];
          if (pt.x < bMinX) bMinX = pt.x;
          if (pt.y < bMinY) bMinY = pt.y;
          if (pt.x > bMaxX) bMaxX = pt.x;
          if (pt.y > bMaxY) bMaxY = pt.y;
        }
        const pad = beamW * 1.4 + 4;
        trail.cachedBounds = Number.isFinite(bMinX)
          ? { minX: bMinX - pad, minY: bMinY - pad, maxX: bMaxX + pad, maxY: bMaxY + pad }
          : null;
      } else if (trail.shape && !trail.cachedBounds) {
        trail.cachedBounds = computeShapeCssBounds(
          trail.shape,
          IDENTITY_TRANSFORM,
          beamW * 2.2 + 16
        );
      }

      if (trail.cachedBounds) {
        if (trail.cachedBounds.minX < minX) minX = trail.cachedBounds.minX;
        if (trail.cachedBounds.minY < minY) minY = trail.cachedBounds.minY;
        if (trail.cachedBounds.maxX > maxX) maxX = trail.cachedBounds.maxX;
        if (trail.cachedBounds.maxY > maxY) maxY = trail.cachedBounds.maxY;
      }

      if (trail.shape) {
        // Snapped laser line/arrow: identical 3-pass optical beam so color & brightness never shift
        traceShapePath(ctx, trail.shape, IDENTITY_TRANSFORM);
        // Pass 1: Soft optical glow
        ctx.strokeStyle = hexToRgba(trail.color, life * 0.24);
        ctx.lineWidth = beamW * 2.15;
        ctx.stroke();

        // Pass 2: Saturated luminous laser core
        ctx.strokeStyle = hexToRgba(trail.color, life * 0.95);
        ctx.lineWidth = beamW * 0.92;
        ctx.stroke();

        // Pass 3: Crisp white-hot core filament (matches freehand laser exactly)
        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.pow(life, 1.3) * 0.86})`;
        ctx.lineWidth = Math.max(0.85, beamW * 0.34);
        ctx.stroke();
      } else if (trail.cachedPath) {
        // Pass 1: Soft optical glow
        ctx.strokeStyle = hexToRgba(trail.color, life * 0.24);
        ctx.lineWidth = beamW * 2.15;
        ctx.stroke(trail.cachedPath);

        // Pass 2: Saturated luminous laser core
        ctx.strokeStyle = hexToRgba(trail.color, life * 0.95);
        ctx.lineWidth = beamW * 0.92;
        ctx.stroke(trail.cachedPath);

        // Pass 3 (lightweight core filament over same Path2D): crisp white-hot highlight
        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.pow(life, 1.3) * 0.86})`;
        ctx.lineWidth = Math.max(0.85, beamW * 0.34);
        ctx.stroke(trail.cachedPath);
      }
    }

    for (let pIdx = pulses.length - 1; pIdx >= 0; pIdx--) {
      const pulse = pulses[pIdx];
      const elapsed = now - pulse.startedAt;
      if (elapsed >= LASER_PULSE_LIFE_MS) {
        pulses.splice(pIdx, 1);
        continue;
      }

      const u = elapsed / LASER_PULSE_LIFE_MS;
      const easeOut = 1 - Math.pow(1 - u, 3);
      const r = 4 + easeOut * 15;
      const fade = Math.pow(1 - u, 1.5);

      if (pulse.x - r - 4 < minX) minX = pulse.x - r - 4;
      if (pulse.y - r - 4 < minY) minY = pulse.y - r - 4;
      if (pulse.x + r + 4 > maxX) maxX = pulse.x + r + 4;
      if (pulse.y + r + 4 > maxY) maxY = pulse.y + r + 4;

      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(pulse.color, fade * 0.62);
      ctx.lineWidth = 1.6 * (1 - u * 0.4);
      ctx.stroke();
    }

    ctx.restore();

    laserDirtyRectRef.current = Number.isFinite(minX)
      ? cssBoundsToPixelRect({ minX, minY, maxX, maxY }, scaleX, scaleY, pw, ph)
      : null;

    // Spin RAF ONLY while trails/spotlight are fading or pulses are animating
    if (hasFadingTrails || hasSpotlightAnim || pulses.length > 0) {
      laserRafRef.current = requestAnimationFrame(renderLaserFrame);
    } else if (trails.length === 0 && pulses.length === 0 && laserSpotlightRef.current === null) {
      laserDirtyRectRef.current = null;
      canvas.style.display = 'none';
    }
  }, [syncLaserViewport]);

  const ensureLaserLoop = useCallback(() => {
    if (!laserRafRef.current) {
      laserRafRef.current = requestAnimationFrame(renderLaserFrame);
    }
  }, [renderLaserFrame]);

  // Keep cached laser viewport synced on resize & visualViewport shifts
  useEffect(() => {
    let vvTimer: number | null = null;
    const onResize = () => {
      if (
        laserTrailsRef.current.length > 0 ||
        laserPulsesRef.current.length > 0 ||
        laserSpotlightRef.current !== null
      ) {
        syncLaserViewport();
        ensureLaserLoop();
      }
    };
    const onVvShift = () => {
      if (
        laserTrailsRef.current.length === 0 &&
        laserPulsesRef.current.length === 0 &&
        laserSpotlightRef.current === null
      ) {
        return;
      }
      if (vvTimer !== null) window.clearTimeout(vvTimer);
      vvTimer = window.setTimeout(() => {
        vvTimer = null;
        onResize();
      }, 140);
    };
    window.addEventListener('resize', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onVvShift, { passive: true });
    window.visualViewport?.addEventListener('scroll', onVvShift, { passive: true });
    return () => {
      if (vvTimer !== null) window.clearTimeout(vvTimer);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onVvShift);
      window.visualViewport?.removeEventListener('scroll', onVvShift);
    };
  }, [syncLaserViewport, ensureLaserLoop]);

  useEffect(() => {
    const isLaser = activeTool === 'laser';
    laserActiveRef.current = isLaser;

    if (!isLaser) {
      if (laserWriteTrailRef.current && laserWriteTrailRef.current.releasedAt === null) {
        laserWriteTrailRef.current.releasedAt = performance.now();
      }
      if (laserSpotlightRef.current && laserSpotlightRef.current.releasedAt === null) {
        laserSpotlightRef.current.releasedAt = performance.now();
      }
      laserDownRef.current = false;
      laserWriteTrailRef.current = null;
      document.body.classList.remove('is-laser-pointer-active', 'is-laser-over-ui');
      ensureLaserLoop();
      return;
    }

    syncLaserViewport();
    laserOverUiRef.current = true;
    document.body.classList.add('is-laser-pointer-active', 'is-laser-over-ui');

    const isOverChromeControls = (target: EventTarget | null): boolean => {
      const el = getElementFromTarget(target);
      if (!el) return false;
      return Boolean(el.closest(LASER_CHROME_CONTROLS_SELECTOR));
    };

    let laserHoldPathAccum = 0;

    const clearLaserHoldTimer = () => {
      if (laserHoldTimerRef.current !== null) {
        window.clearTimeout(laserHoldTimerRef.current);
        laserHoldTimerRef.current = null;
      }
    };

    const armLaserHoldSnap = (x: number, y: number) => {
      clearLaserHoldTimer();
      const cur = laserWriteTrailRef.current;
      if (!cur || cur.shape || laserSettingsRef.current.mode !== 'trail') return;
      laserHoldAnchorRef.current = { x, y };
      laserHoldPathAccum = 0;
      laserHoldTimerRef.current = window.setTimeout(() => {
        laserHoldTimerRef.current = null;
        const activeTrail = laserWriteTrailRef.current;
        if (!activeTrail || activeTrail.shape || activeTrail.points.length < 4) return;
        const asPoints: AnnotationPoint[] = activeTrail.points.map((pt) => ({
          x: pt.x,
          y: pt.y,
          pressure: 0.5,
          t: pt.t,
        }));

        // Allow 2-stroke arrow merging onto an immediately preceding visible line trail
        let detected: AnnotationShape | null = null;
        let mergedPrevTrail: LaserTrail | null = null;
        const trailsList = laserTrailsRef.current;
        const activeIdx = trailsList.indexOf(activeTrail);
        if (activeIdx > 0) {
          const prevTrail = trailsList[activeIdx - 1];
          const prevWin = Math.max(
            400,
            prevTrail?.fadeDurationMs || LASER_HOLD_AFTER_RELEASE_MS + LASER_FADE_DURATION_MS
          );
          const prevVisible =
            prevTrail &&
            (prevTrail.releasedAt === null || performance.now() - prevTrail.releasedAt < prevWin * 0.85);
          const prevEligible =
            prevVisible &&
            (!prevTrail.shape || prevTrail.shape.type === 'line' || prevTrail.shape.type === 'arrow');
          if (prevEligible) {
            const syntheticPrevStroke: AnnotationStroke = {
              id: 'laser-prev',
              kind: 'pen',
              color: prevTrail.color,
              size: prevTrail.size,
              opacity: 1,
              points: prevTrail.points.map((pt) => ({
                x: pt.x,
                y: pt.y,
                pressure: 0.5,
                t: pt.t,
              })),
              shape: prevTrail.shape,
            };
            const merged = tryMergeTwoStrokeArrow(syntheticPrevStroke, asPoints, 1, 1);
            if (merged && merged.type === 'arrow') {
              detected = merged;
              mergedPrevTrail = prevTrail;
            }
          }
        }

        // Laser stays completely freehand for circles/polygons/curves — snap ONLY straight lines & arrows
        if (!detected) {
          const candidate = detectHoldShape(asPoints, 1, 1, true);
          if (candidate && (candidate.type === 'line' || candidate.type === 'arrow')) {
            detected = candidate;
          }
        }

        if (detected) {
          if (mergedPrevTrail) {
            const prevIdx = trailsList.indexOf(mergedPrevTrail);
            if (prevIdx !== -1) {
              trailsList.splice(prevIdx, 1);
            }
          }
          const lastPt = activeTrail.points[activeTrail.points.length - 1];
          laserSnapBaseRef.current = {
            shape: detected,
            anchorX: lastPt.x,
            anchorY: lastPt.y,
          };
          activeTrail.shape = detected;
          activeTrail.cachedPath = null;
          activeTrail.cachedBounds = null;
          laserPulsesRef.current.push({
            x,
            y,
            startedAt: performance.now(),
            color: activeTrail.color,
          });
          ensureLaserLoop();
        }
      }, HOLD_SNAP_DELAY_MS);
    };

    const releaseActiveWriteTrail = () => {
      clearLaserHoldTimer();
      laserHoldAnchorRef.current = null;
      laserHoldPathAccum = 0;
      laserSnapBaseRef.current = null;
      laserDownRef.current = false;
      laserActivePointerTypeRef.current = null;
      let shouldLoop = false;
      if (laserWriteTrailRef.current) {
        if (laserWriteTrailRef.current.releasedAt === null) {
          laserWriteTrailRef.current.releasedAt = performance.now();
        }
        laserWriteTrailRef.current = null;
        shouldLoop = true;
      }
      if (laserSpotlightRef.current && laserSpotlightRef.current.releasedAt === null) {
        laserSpotlightRef.current.releasedAt = performance.now();
        shouldLoop = true;
      }
      if (shouldLoop) {
        ensureLaserLoop();
      }
    };

    const appendToWriteTrail = (x: number, y: number, now: number) => {
      let current = laserWriteTrailRef.current;
      if (!current) {
        current = {
          color: laserSettingsRef.current.color,
          size: laserSettingsRef.current.size,
          smoothing: laserSettingsRef.current.smoothing,
          fadeDurationMs: laserSettingsRef.current.fadeDurationMs,
          points: [],
          releasedAt: null,
        };
        laserWriteTrailRef.current = current;
        laserTrailsRef.current.push(current);
      }
      if (current.shape) {
        current.shape = adjustSnappedShapeOnDrag(
          current.shape,
          { x, y, pressure: 0.5, t: now },
          1,
          1,
          laserSnapBaseRef.current
        );
        current.cachedBounds = null;
        return;
      }
      const last = current.points[current.points.length - 1];
      const stepDist = last ? Math.hypot(x - last.x, y - last.y) : 0;
      if (!last || stepDist >= 1.7) {
        current.points.push({ x, y, t: now });
        laserHoldPathAccum += stepDist;
        const anchor = laserHoldAnchorRef.current;
        if (
          !anchor ||
          laserHoldPathAccum >= HOLD_PATH_RESET_PX ||
          Math.hypot(x - anchor.x, y - anchor.y) > HOLD_MOVE_THRESHOLD_PX
        ) {
          armLaserHoldSnap(x, y);
        }
      }
    };

    const toLaserCoords = (clientX: number, clientY: number): { x: number; y: number } => {
      const r = laserRectRef.current;
      return {
        x: clientX - r.left,
        y: clientY - r.top,
      };
    };

    const getSpotlightRadius = (sizePx: number): number =>
      Math.max(58, Math.min(180, 48 + sizePx * 11));

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        laserLastPenAtRef.current = performance.now();
      }
      if (
        e.pointerType === 'touch' &&
        (pencilOnlyModeRef.current ||
          (laserDownRef.current && laserActivePointerTypeRef.current === 'pen'))
      ) {
        return;
      }
      const overUi = laserDownRef.current ? false : isOverChromeControls(e.target);
      if (laserOverUiRef.current !== overUi) {
        laserOverUiRef.current = overUi;
        document.body.classList.toggle('is-laser-over-ui', overUi);
      }

      const primaryHeld = laserDownRef.current || (e.buttons & 1) === 1;
      if (primaryHeld && !overUi) {
        if (!laserDownRef.current) {
          laserDownRef.current = true;
        }
        if (laserSettingsRef.current.mode === 'spotlight') {
          const pos = toLaserCoords(e.clientX, e.clientY);
          laserSpotlightRef.current = {
            x: pos.x,
            y: pos.y,
            color: laserSettingsRef.current.color,
            radius: getSpotlightRadius(laserSettingsRef.current.size),
            releasedAt: null,
          };
          ensureLaserLoop();
        } else if (laserSettingsRef.current.mode === 'trail') {
          const samples =
            typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
          const sampleCount = samples && samples.length > 0 ? samples.length : 0;
          const loopLen = sampleCount > 0 ? sampleCount : 1;
          const nowTs = performance.now();
          const firstTs = sampleCount > 1 ? samples![0].timeStamp : 0;
          const lastTs = sampleCount > 1 ? samples![sampleCount - 1].timeStamp : 0;
          const hasSpan = sampleCount > 1 && lastTs > firstTs;
          for (let i = 0; i < loopLen; i++) {
            const ev = sampleCount > 0 ? samples![i] : e;
            const pos = toLaserCoords(ev.clientX, ev.clientY);
            const sampleTs = hasSpan ? nowTs - Math.min(32, lastTs - ev.timeStamp) : nowTs;
            appendToWriteTrail(pos.x, pos.y, sampleTs);
          }
          ensureLaserLoop();
        }
      } else if (!primaryHeld && laserDownRef.current) {
        releaseActiveWriteTrail();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.pointerType === 'pen') {
        laserLastPenAtRef.current = performance.now();
      }
      if (
        shouldIgnoreTouchForPalmOrPencilOnly(
          e,
          pencilOnlyModeRef.current,
          laserLastPenAtRef.current,
          laserDownRef.current && laserActivePointerTypeRef.current === 'pen'
        )
      ) {
        return;
      }
      syncLaserViewport();
      const overUi = isOverChromeControls(e.target);
      laserOverUiRef.current = overUi;
      document.body.classList.toggle('is-laser-over-ui', overUi);
      if (overUi) return;

      if (typeof window.focus === 'function' && !document.hasFocus()) {
        window.focus();
      }
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLSelectElement ||
        activeEl instanceof HTMLTextAreaElement
      ) {
        activeEl.blur();
      }

      if (e.cancelable) {
        e.preventDefault();
      }

      const now = performance.now();
      const pos = toLaserCoords(e.clientX, e.clientY);
      laserDownRef.current = true;
      laserActivePointerTypeRef.current = e.pointerType;

      if (laserSettingsRef.current.mode === 'spotlight') {
        laserSpotlightRef.current = {
          x: pos.x,
          y: pos.y,
          color: laserSettingsRef.current.color,
          radius: getSpotlightRadius(laserSettingsRef.current.size),
          releasedAt: null,
        };
        ensureLaserLoop();
      } else if (laserSettingsRef.current.mode === 'dot') {
        laserPulsesRef.current.push({
          x: pos.x,
          y: pos.y,
          startedAt: now,
          color: laserSettingsRef.current.color,
        });
        ensureLaserLoop();
      } else {
        const nextTrail: LaserTrail = {
          color: laserSettingsRef.current.color,
          size: laserSettingsRef.current.size,
          smoothing: laserSettingsRef.current.smoothing,
          fadeDurationMs: laserSettingsRef.current.fadeDurationMs,
          points: [{ x: pos.x, y: pos.y, t: now }],
          releasedAt: null,
        };
        laserWriteTrailRef.current = nextTrail;
        laserTrailsRef.current.push(nextTrail);
        ensureLaserLoop();
      }
    };

    const onPointerUp = () => {
      releaseActiveWriteTrail();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!isOverChromeControls(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onPointerLeave = () => {
      releaseActiveWriteTrail();
    };

    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
    window.addEventListener('click', onClickCapture, { capture: true });
    document.addEventListener('mouseleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);

    return () => {
      if (laserHoldTimerRef.current !== null) {
        window.clearTimeout(laserHoldTimerRef.current);
        laserHoldTimerRef.current = null;
      }
      if (laserWriteTrailRef.current && laserWriteTrailRef.current.releasedAt === null) {
        laserWriteTrailRef.current.releasedAt = performance.now();
      }
      if (laserSpotlightRef.current && laserSpotlightRef.current.releasedAt === null) {
        laserSpotlightRef.current.releasedAt = performance.now();
      }
      document.body.classList.remove('is-laser-pointer-active', 'is-laser-over-ui');
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
      window.removeEventListener('click', onClickCapture, { capture: true });
      document.removeEventListener('mouseleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
    };
  }, [activeTool, ensureLaserLoop, syncLaserViewport]);

  useEffect(() => {
    return () => {
      if (laserHoldTimerRef.current !== null) {
        window.clearTimeout(laserHoldTimerRef.current);
        laserHoldTimerRef.current = null;
      }
      if (laserRafRef.current) {
        cancelAnimationFrame(laserRafRef.current);
        laserRafRef.current = 0;
      }
    };
  }, []);

  return (
    <canvas
      ref={laserCanvasRef}
      className="global-laser-canvas"
      style={{ display: 'none' }}
      aria-hidden="true"
    />
  );
};
