import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue } from 'motion/react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  Repeat,
  SlidersHorizontal,
  Square,
  Volume2,
} from 'lucide-react';
import { toArabicDigits, type MushafDataset, type MushafSurahMeta } from '../utils/mushafData';
import {
  AUDIO_PAUSE_GAP_OPTIONS,
  AYAH_REPEAT_OPTIONS,
  PLAYBACK_RATE_OPTIONS,
  QURAN_RECITERS,
  getJozzAyahSpan,
  getPageAyahSpan,
  type AudioPauseGap,
  type PlaybackRateOption,
  type ReciterId,
} from '../utils/quranAudio';
import {
  getBottomDockState,
  setBottomDockSplitOrder,
  solveBottomDockLayout,
  updateAudioDockState,
  useBottomDockCoordinatorState,
  type DockCornerSide,
} from '../utils/bottomDockCoordinator';
import type { AudioControlApplyPayload, AudioControlTarget } from './AudioControlModal';

export interface FloatingAudioDockProps {
  isExpanded: boolean;
  onExpand: () => void;
  onMinimize: () => void;
  onStopPlayback: () => void;
  audioTarget: AudioControlTarget | null;
  fallbackTarget: AudioControlTarget | null;
  isPlaying: boolean;
  isLoading: boolean;
  audioError: string | null;
  reciterId: ReciterId;
  rate: PlaybackRateOption;
  repeat: number;
  repeatProgress: number;
  repeatSection: boolean;
  ayahCount: number;
  autoFollow: boolean;
  pauseGap: AudioPauseGap;
  stopAtPageEnd: boolean;
  isPauseGapWaiting: boolean;
  sessionTotal: number;
  sessionIndex: number;
  sessionRepeatSection?: boolean;
  surahMetaMap: Map<number, MushafSurahMeta>;
  mushafDataset: MushafDataset | null;
  currentPageNum: number;
  currentJozz: number;
  onTogglePlay: () => void;
  onStepAyah: (delta: -1 | 1) => void;
  onJumpToPlayingAyah: () => void;
  onChangeReciter: (id: ReciterId) => void;
  onSetRate: (rate: PlaybackRateOption) => void;
  onSetRepeat: (repeat: number) => void;
  onSetRepeatSection: (val: boolean) => void;
  onSetAutoFollow: (val: boolean) => void;
  onSetPauseGap: (gap: AudioPauseGap) => void;
  onSetStopAtPageEnd: (val: boolean) => void;
  subscribeAudioProgress: (
    cb: (ratio: number, isWaitingGap: boolean) => void
  ) => () => void;
  onSeekAudioProgress: (ratio: number) => void;
  onApplyPreset: (payload: AudioControlApplyPayload) => void;
  onOpenCustomModal: (target: AudioControlTarget) => void;
}

const AUDIO_ORB_STORAGE_KEY = 'safara:audio_orb_side_v1';
const ORB_MARGIN_X = 32;
const ORB_BOTTOM_MARGIN = 26;
const ORB_SIZE = 58;

const APPLE_CALM_EASE = [0.22, 1, 0.36, 1] as const;
const APPLE_IPAD_EASE = [0.22, 1, 0.36, 1] as const;
const APPLE_EXIT_EASE = [0.4, 0, 0.2, 1] as const;

const APPLE_DOCK_SPRING = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 29,
  mass: 0.96,
};

const APPLE_ORB_SPRING = {
  type: 'spring' as const,
  stiffness: 250,
  damping: 30,
  mass: 0.9,
};

const APPLE_SNAP_SPRING = {
  type: 'spring' as const,
  stiffness: 240,
  damping: 30,
  mass: 0.92,
};

const APPLE_CONTAINER_SPRING = {
  type: 'spring' as const,
  stiffness: 230,
  damping: 30,
  mass: 0.94,
};

const APPLE_POPOVER_SPRING = {
  type: 'spring' as const,
  stiffness: 290,
  damping: 31,
  mass: 0.82,
};

function prefersReducedMotionNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rubberBandClamp(val: number, min: number, max: number, maxOvershoot = 14): number {
  if (val < min) {
    const over = min - val;
    return min - (over * maxOvershoot) / (over + maxOvershoot * 2.2);
  }
  if (val > max) {
    const over = val - max;
    return max + (over * maxOvershoot) / (over + maxOvershoot * 2.2);
  }
  return val;
}

interface ViewportMetrics {
  vw: number;
  vh: number;
  offsetLeft: number;
  offsetTop: number;
  scale: number;
  isZoomedOrShifted: boolean;
}

function getLayoutViewport(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return { vw: 1280, vh: 800, offsetLeft: 0, offsetTop: 0, scale: 1, isZoomedOrShifted: false };
  }
  const docEl = document.documentElement;
  const layoutVw = docEl && docEl.clientWidth > 0 ? docEl.clientWidth : window.innerWidth;
  const layoutVh = docEl && docEl.clientHeight > 0 ? docEl.clientHeight : window.innerHeight;
  const vv = window.visualViewport;
  if (!vv) {
    return { vw: layoutVw, vh: layoutVh, offsetLeft: 0, offsetTop: 0, scale: 1, isZoomedOrShifted: false };
  }
  const scale = vv.scale && Number.isFinite(vv.scale) && vv.scale > 0.1 ? vv.scale : 1;
  const offsetLeft = Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0;
  const offsetTop = Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;
  const isZoomedOrShifted =
    Math.abs(scale - 1) > 0.005 || Math.abs(offsetLeft) > 0.5 || Math.abs(offsetTop) > 0.5;
  const hasSoftKeyboardShrink =
    Math.abs(scale - 1) <= 0.005 && vv.height > 0 && vv.height < layoutVh - 40;
  const vw =
    isZoomedOrShifted && vv.width > 0 ? Math.max(240, Math.round(vv.width * scale)) : layoutVw;
  const vh =
    (isZoomedOrShifted || hasSoftKeyboardShrink) && vv.height > 0
      ? Math.max(180, Math.round(vv.height * scale))
      : layoutVh;
  return { vw, vh, offsetLeft, offsetTop, scale, isZoomedOrShifted };
}

function clientToPortalPoint(clientX: number, clientY: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: clientX, y: clientY };
  const vv = window.visualViewport;
  if (!vv) return { x: clientX, y: clientY };
  const scale = vv.scale && Number.isFinite(vv.scale) && vv.scale > 0.1 ? vv.scale : 1;
  const offsetLeft = Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0;
  const offsetTop = Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;
  if (Math.abs(scale - 1) <= 0.005 && Math.abs(offsetLeft) <= 0.5 && Math.abs(offsetTop) <= 0.5) {
    return { x: clientX, y: clientY };
  }
  return {
    x: (clientX - offsetLeft) * scale,
    y: (clientY - offsetTop) * scale,
  };
}

function getOrbMetrics(vw: number, vh: number) {
  const isNarrow = vw <= 640 || vh <= 480;
  return {
    marginX: isNarrow ? 16 : ORB_MARGIN_X,
    bottomMargin: isNarrow ? 16 : ORB_BOTTOM_MARGIN,
    orbSize: isNarrow ? 52 : ORB_SIZE,
  };
}

function clampOrbCoords(
  rawLeft: number,
  rawTop: number,
  vw: number,
  vh: number
): { left: number; top: number } {
  const { orbSize } = getOrbMetrics(vw, vh);
  const minLeft = 10;
  const maxLeft = Math.max(minLeft, vw - orbSize - 10);
  const minTop = 14;
  const maxTop = Math.max(minTop, vh - orbSize - 14);
  return {
    left: Math.max(minLeft, Math.min(maxLeft, rawLeft)),
    top: Math.max(minTop, Math.min(maxTop, rawTop)),
  };
}

function resolveAudioOrbCoords(
  side: DockCornerSide,
  vw: number,
  vh: number,
  bottomOffset = 0
): { left: number; top: number } {
  const { marginX, bottomMargin, orbSize } = getOrbMetrics(vw, vh);
  const left = side === 'right' ? vw - orbSize - marginX : marginX;
  const top = vh - orbSize - bottomMargin - bottomOffset;
  return clampOrbCoords(left, top, vw, vh);
}

function getDockCornerPocketMetrics(vw: number, vh: number) {
  const isWide = vw >= 640;
  const zoneW = isWide
    ? Math.min(180, Math.max(105, vw * 0.14))
    : Math.min(130, Math.max(88, vw * 0.24));
  const zoneTop = Math.max(vh * 0.76, vh - 140);
  return {
    zoneW,
    zoneTop,
    exitW: zoneW + 34,
  };
}

function detectCornerMagnet(
  clientX: number,
  _clientY: number,
  vw: number,
  vh: number,
  prevSide: DockCornerSide | null = null,
  isDockDrag = false,
  dockRect?: {
    rawLeft: number;
    dockW: number;
    totalDxFromStart: number;
    startClientX: number;
    vx: number;
  }
): DockCornerSide | null {
  const dockPocket = getDockCornerPocketMetrics(vw, vh);
  const cornerZoneW = isDockDrag ? dockPocket.zoneW : Math.min(220, Math.max(115, vw * 0.19));
  const cornerExitW = isDockDrag ? dockPocket.exitW : cornerZoneW + 36;

  if (isDockDrag && dockRect) {
    const overhangPx = Math.min(105, Math.max(54, dockRect.dockW * 0.16));
    const allowLeft =
      prevSide === 'left' ||
      dockRect.totalDxFromStart <= -14 ||
      dockRect.startClientX > vw * 0.35;
    const allowRight =
      prevSide === 'right' ||
      dockRect.totalDxFromStart >= 14 ||
      dockRect.startClientX < vw * 0.65;

    if (
      allowLeft &&
      (clientX <= cornerZoneW ||
        dockRect.rawLeft <= -overhangPx ||
        (prevSide === 'left' &&
          (clientX <= cornerExitW || dockRect.rawLeft <= -overhangPx + 38)))
    ) {
      return 'left';
    }
    if (
      allowRight &&
      (clientX >= vw - cornerZoneW ||
        dockRect.rawLeft + dockRect.dockW >= vw + overhangPx ||
        (prevSide === 'right' &&
          (clientX >= vw - cornerExitW || dockRect.rawLeft + dockRect.dockW >= vw + overhangPx - 38)))
    ) {
      return 'right';
    }
    return null;
  }

  if (clientX <= cornerZoneW || (prevSide === 'left' && clientX <= cornerExitW)) {
    return 'left';
  }
  if (clientX >= vw - cornerZoneW || (prevSide === 'right' && clientX >= vw - cornerExitW)) {
    return 'right';
  }
  return null;
}

function loadInitialOrbSide(): DockCornerSide {
  if (typeof window === 'undefined') return 'right';
  try {
    const raw = window.localStorage.getItem(AUDIO_ORB_STORAGE_KEY);
    if (raw === 'left' || raw === 'right') return raw;
  } catch {
    // Ignore storage errors
  }
  return 'right';
}

export const FloatingAudioDock: React.FC<FloatingAudioDockProps> = ({
  isExpanded,
  onExpand,
  onMinimize,
  onStopPlayback,
  audioTarget,
  fallbackTarget,
  isPlaying,
  isLoading,
  audioError,
  reciterId,
  rate,
  repeat,
  repeatProgress,
  repeatSection,
  ayahCount,
  autoFollow,
  pauseGap,
  stopAtPageEnd,
  isPauseGapWaiting,
  sessionTotal,
  sessionIndex,
  sessionRepeatSection,
  surahMetaMap,
  mushafDataset,
  currentPageNum,
  currentJozz,
  onTogglePlay,
  onStepAyah,
  onJumpToPlayingAyah,
  onChangeReciter,
  onSetRate,
  onSetRepeat,
  onSetRepeatSection,
  onSetAutoFollow,
  onSetPauseGap,
  onSetStopAtPageEnd,
  subscribeAudioProgress,
  onSeekAudioProgress,
  onApplyPreset,
  onOpenCustomModal,
}) => {
  const coordinatorState = useBottomDockCoordinatorState();
  const [orbSide, setOrbSide] = useState<DockCornerSide>(loadInitialOrbSide);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDockDragging, setIsDockDragging] = useState(false);
  const [isOrbDragging, setIsOrbDragging] = useState(false);
  const [orbDragMagnet, setOrbDragMagnet] = useState<DockCornerSide | null>(null);
  const [orbDragTarget, setOrbDragTarget] = useState<'bottom' | null>(null);
  const [dockDropCorner, setDockDropCorner] = useState<DockCornerSide | null>(null);
  const [viewport, setViewport] = useState<{ vw: number; vh: number }>(() => {
    const m = getLayoutViewport();
    return { vw: m.vw, vh: m.vh };
  });

  const portalRef = useRef<HTMLDivElement | null>(null);
  const dockAnchorRef = useRef<HTMLDivElement | null>(null);
  const dockMotionShellRef = useRef<HTMLDivElement | null>(null);
  const dockShellRef = useRef<HTMLDivElement | null>(null);
  const dockContentRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const orbBtnRef = useRef<HTMLButtonElement | null>(null);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);

  const dimsRef = useRef<{ w: number; h: number }>({ w: 660, h: 68 });
  const suppressNextClickRef = useRef(false);
  const dockLayoutReadyRef = useRef(false);
  const orbLayoutReadyRef = useRef(false);
  const orbSideRef = useRef(orbSide);
  orbSideRef.current = orbSide;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;

  const dockOpeningFromOrbRef = useRef<{ cx: number; cy: number } | null>(null);
  const dockWasCollapsedIntoOrbRef = useRef(false);
  const dockCollapsedFromDragRef = useRef(false);
  const dockCollapseHandedOffRef = useRef(false);
  const dockCollapseDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dockCollapseFlightSecRef = useRef(0.21);
  const wasDragOrbFormedRef = useRef(false);
  const orbPendingVelocityRef = useRef<{ vx: number; vy: number } | null>(null);
  const orbPendingSpringRef = useRef(false);
  const dockPendingVelocityRef = useRef<{ vx: number; vy: number } | null>(null);
  const dockPendingSpringRef = useRef(false);
  const isAnimatingDockRef = useRef(false);
  const dockAnimTargetRef = useRef<{ x: number; y: number } | null>(null);

  const frozenExitLayoutRef = useRef<{
    isSplitActive: boolean;
    isCompactSplit: boolean;
    isSideBySide: boolean;
    maxWidth: number | null;
  } | null>(null);

  const dockX = useMotionValue(0);
  const dockY = useMotionValue(0);
  const dockScale = useMotionValue(1);
  const dockContentOpacity = useMotionValue(1);
  const dockContentScale = useMotionValue(1);
  const dockClipPath = useMotionValue('none');
  const dockOrbCoreOpacity = useMotionValue(0);
  const dockOrbShellX = useMotionValue(0);
  const dockOrbShellY = useMotionValue(0);
  const orbX = useMotionValue(0);
  const orbY = useMotionValue(0);
  const orbLauncherOpacity = useMotionValue(1);

  const dockAnimXRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockAnimYRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockAnimScaleRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockContentOpacityAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockContentScaleAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockClipAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const dockOrbCoreAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const orbAnimXRef = useRef<ReturnType<typeof animate> | null>(null);
  const orbAnimYRef = useRef<ReturnType<typeof animate> | null>(null);

  const dockMoveRafRef = useRef<number | null>(null);
  const dockLatestPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const orbMoveRafRef = useRef<number | null>(null);
  const orbLatestPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const orbDragMagnetRef = useRef<DockCornerSide | null>(null);
  const dockDropCornerRef = useRef<DockCornerSide | null>(null);

  const dockDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    startLeft: number;
    startTop: number;
    liveLeft: number;
    liveTop: number;
    lastClientX: number;
    lastClientY: number;
    lastTime: number;
    vx: number;
    vy: number;
    moved: boolean;
    w: number;
    h: number;
    orbMagnetBlend: number;
    morphedLocalCx?: number;
    morphedLocalCy?: number;
    lastOrbCoords?: { left: number; top: number; localCx: number; localCy: number };
  } | null>(null);

  const orbDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
    lastClientX: number;
    lastClientY: number;
    lastTime: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  // Sync orb side to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(AUDIO_ORB_STORAGE_KEY, orbSide);
    } catch {
      // Ignore storage errors
    }
  }, [orbSide]);

  // Register mount / expanded / orbSide state with bottomDockCoordinator before paint
  useLayoutEffect(() => {
    updateAudioDockState({
      mounted: true,
      expanded: isExpanded,
      orbSide,
    });
  }, [isExpanded, orbSide]);

  useEffect(() => {
    return () => {
      updateAudioDockState({
        mounted: false,
        expanded: false,
      });
    };
  }, []);

  // Zero-re-render GPU progress hairline subscription
  useEffect(() => {
    if (!isExpanded) return;
    return subscribeAudioProgress((ratio, isWaitingGap) => {
      const fillEl = progressFillRef.current;
      if (!fillEl) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      fillEl.style.transform = `scaleX(${clamped.toFixed(4)})`;
      fillEl.classList.toggle('is-waiting-gap', isWaitingGap);
    });
  }, [isExpanded, subscribeAudioProgress]);

  // Keep popover closed when dock minimizes
  useEffect(() => {
    if (!isExpanded) {
      setIsSettingsOpen(false);
    }
  }, [isExpanded]);

  // Sync body drag class so reading iframes never swallow pointer events mid-drag
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const active = isDockDragging || isOrbDragging;
    document.body.classList.toggle('is-palette-dragging', active);
    return () => {
      document.body.classList.remove('is-palette-dragging');
    };
  }, [isDockDragging, isOrbDragging]);

  // Close popover on outside pointerdown or Escape
  useEffect(() => {
    if (!isSettingsOpen) return;
    const onOutside = (e: PointerEvent) => {
      const anchor = dockAnchorRef.current;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const inside = Boolean(
        anchor && (path.length > 0 ? path.includes(anchor) : e.target instanceof Node && anchor.contains(e.target))
      );
      if (!inside) {
        setIsSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onOutside, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onOutside, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [isSettingsOpen]);

  // Sync visualViewport on resize / zoom / pan
  const lastVvRef = useRef<{ vw: number; vh: number; scale: number; ox: number; oy: number; zoomed: boolean } | null>(null);
  const vvStateTimerRef = useRef<number | null>(null);
  const vvZoomIdleTimerRef = useRef<number | null>(null);

  const syncVisualViewport = useCallback((immediateState = false) => {
    const m = getLayoutViewport();
    const portal = portalRef.current;
    const prev = lastVvRef.current;
    const dimsChanged = !prev || Math.abs(prev.vw - m.vw) > 1 || Math.abs(prev.vh - m.vh) > 1;
    const transformChanged =
      !prev ||
      prev.zoomed !== m.isZoomedOrShifted ||
      Math.abs(prev.scale - m.scale) > 0.002 ||
      Math.abs(prev.ox - m.offsetLeft) > 0.5 ||
      Math.abs(prev.oy - m.offsetTop) > 0.5;

    if (portal && (dimsChanged || transformChanged)) {
      if (prev && transformChanged) {
        portal.classList.add('is-vv-zooming');
        if (vvZoomIdleTimerRef.current !== null) {
          window.clearTimeout(vvZoomIdleTimerRef.current);
        }
        vvZoomIdleTimerRef.current = window.setTimeout(() => {
          vvZoomIdleTimerRef.current = null;
          portalRef.current?.classList.remove('is-vv-zooming');
        }, 180);
      }
      if (m.isZoomedOrShifted) {
        const invScale = 1 / m.scale;
        if (dimsChanged || !prev?.zoomed) {
          portal.style.width = `${m.vw}px`;
          portal.style.height = `${m.vh}px`;
          portal.style.transformOrigin = '0 0';
        }
        portal.style.transform = `translate3d(${m.offsetLeft}px, ${m.offsetTop}px, 0) scale(${invScale})`;
      } else if (prev?.zoomed) {
        portal.style.width = '';
        portal.style.height = '';
        portal.style.transformOrigin = '';
        portal.style.transform = '';
      }
      lastVvRef.current = {
        vw: m.vw,
        vh: m.vh,
        scale: m.scale,
        ox: m.offsetLeft,
        oy: m.offsetTop,
        zoomed: m.isZoomedOrShifted,
      };
    }

    const commitViewport = () => {
      setViewport((cur) =>
        Math.abs(cur.vw - m.vw) <= 1 && Math.abs(cur.vh - m.vh) <= 1 ? cur : { vw: m.vw, vh: m.vh }
      );
    };

    if (immediateState || !m.isZoomedOrShifted) {
      if (vvStateTimerRef.current !== null) {
        window.clearTimeout(vvStateTimerRef.current);
        vvStateTimerRef.current = null;
      }
      commitViewport();
    } else {
      if (vvStateTimerRef.current !== null) window.clearTimeout(vvStateTimerRef.current);
      vvStateTimerRef.current = window.setTimeout(() => {
        vvStateTimerRef.current = null;
        commitViewport();
      }, 120);
    }
  }, []);

  useEffect(() => {
    let vvRaf = 0;
    const scheduleVvSync = () => {
      if (vvRaf) return;
      vvRaf = requestAnimationFrame(() => {
        vvRaf = 0;
        syncVisualViewport(false);
      });
    };
    const onWinResize = () => syncVisualViewport(true);
    syncVisualViewport(true);
    window.addEventListener('resize', onWinResize, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleVvSync, { passive: true });
    vv?.addEventListener('scroll', scheduleVvSync, { passive: true });
    return () => {
      if (vvRaf) cancelAnimationFrame(vvRaf);
      if (vvStateTimerRef.current !== null) {
        window.clearTimeout(vvStateTimerRef.current);
        vvStateTimerRef.current = null;
      }
      if (vvZoomIdleTimerRef.current !== null) {
        window.clearTimeout(vvZoomIdleTimerRef.current);
        vvZoomIdleTimerRef.current = null;
      }
      window.removeEventListener('resize', onWinResize);
      vv?.removeEventListener('resize', scheduleVvSync);
      vv?.removeEventListener('scroll', scheduleVvSync);
    };
  }, [syncVisualViewport]);

  const layoutSolution = useMemo(
    () => solveBottomDockLayout(viewport.vw, viewport.vh, coordinatorState),
    [viewport.vw, viewport.vh, coordinatorState]
  );

  const stopDockPositionMotion = useCallback((stopScale = true) => {
    dockAnimXRef.current?.stop();
    dockAnimYRef.current?.stop();
    dockAnimXRef.current = null;
    dockAnimYRef.current = null;
    if (stopScale) {
      dockAnimScaleRef.current?.stop();
      dockAnimScaleRef.current = null;
    }
    isAnimatingDockRef.current = false;
    dockAnimTargetRef.current = null;
  }, []);

  const stopOrbMotion = useCallback(() => {
    orbAnimXRef.current?.stop();
    orbAnimYRef.current?.stop();
    orbAnimXRef.current = null;
    orbAnimYRef.current = null;
  }, []);

  const animateDockTo = useCallback(
    (
      left: number,
      top: number,
      immediate: boolean,
      velocity?: { vx: number; vy: number } | null,
      springConfig: typeof APPLE_SNAP_SPRING = APPLE_SNAP_SPRING
    ) => {
      if (
        !immediate &&
        isAnimatingDockRef.current &&
        dockAnimTargetRef.current &&
        Math.abs(dockAnimTargetRef.current.x - left) < 1.5 &&
        Math.abs(dockAnimTargetRef.current.y - top) < 1.5
      ) {
        return;
      }
      stopDockPositionMotion(immediate);
      dockAnimTargetRef.current = { x: left, y: top };
      if (immediate || prefersReducedMotionNow()) {
        dockX.set(left);
        dockY.set(top);
        dockScale.set(1);
        isAnimatingDockRef.current = false;
        if (!dockClipAnimRef.current) {
          dockAnchorRef.current?.classList.remove('is-dock-animating');
        }
        return;
      }
      isAnimatingDockRef.current = true;
      dockAnchorRef.current?.classList.add('is-dock-animating');
      const dx = left - dockX.get();
      const dy = top - dockY.get();
      const maxSafeVx = Math.max(0, Math.abs(dx) - 6) * 4.5;
      const maxSafeVy = Math.max(0, Math.abs(dy) - 6) * 4.5;
      const safeVx =
        velocity && dx * velocity.vx > 0 && Math.abs(dx) > 10
          ? Math.sign(velocity.vx) * Math.min(Math.abs(velocity.vx) * 0.65, maxSafeVx)
          : 0;
      const safeVy =
        velocity && dy * velocity.vy > 0 && Math.abs(dy) > 10
          ? Math.sign(velocity.vy) * Math.min(Math.abs(velocity.vy) * 0.65, maxSafeVy)
          : 0;
      const ax = animate(dockX, left, { ...springConfig, velocity: safeVx });
      const ay = animate(dockY, top, { ...springConfig, velocity: safeVy });
      dockAnimXRef.current = ax;
      dockAnimYRef.current = ay;
      void Promise.all([ax.finished, ay.finished]).then(() => {
        if (dockAnimXRef.current === ax && dockAnimYRef.current === ay) {
          isAnimatingDockRef.current = false;
          if (!dockClipAnimRef.current) {
            dockAnchorRef.current?.classList.remove('is-dock-animating');
          }
        }
      });
    },
    [dockScale, dockX, dockY, stopDockPositionMotion]
  );

  const animateOrbTo = useCallback(
    (
      left: number,
      top: number,
      immediate: boolean,
      velocity?: { vx: number; vy: number } | null
    ) => {
      stopOrbMotion();
      if (immediate || prefersReducedMotionNow()) {
        orbX.set(left);
        orbY.set(top);
        return;
      }
      const dx = left - orbX.get();
      const dy = top - orbY.get();
      const maxSafeVx = Math.max(0, Math.abs(dx) - 6) * 4.4;
      const maxSafeVy = Math.max(0, Math.abs(dy) - 6) * 4.4;
      const safeVx =
        velocity && dx * velocity.vx > 0 && Math.abs(dx) > 10
          ? Math.sign(velocity.vx) * Math.min(Math.abs(velocity.vx) * 0.55, maxSafeVx)
          : 0;
      const safeVy =
        velocity && dy * velocity.vy > 0 && Math.abs(dy) > 10
          ? Math.sign(velocity.vy) * Math.min(Math.abs(velocity.vy) * 0.55, maxSafeVy)
          : 0;
      const ax = animate(orbX, left, { ...APPLE_ORB_SPRING, velocity: safeVx });
      const ay = animate(orbY, top, { ...APPLE_ORB_SPRING, velocity: safeVy });
      orbAnimXRef.current = ax;
      orbAnimYRef.current = ay;
      void Promise.all([ax.finished, ay.finished]).then(() => {
        if (orbAnimXRef.current === ax && orbAnimYRef.current === ay) {
          orbAnimXRef.current = null;
          orbAnimYRef.current = null;
          orbX.set(left);
          orbY.set(top);
        }
      });
    },
    [orbX, orbY, stopOrbMotion]
  );

  const morphDockToOrbVisual = useCallback(
    (
      dims: { w: number; h: number },
      duration: number,
      vw: number,
      localCx?: number,
      localCy?: number
    ) => {
      const { orbSize } = getOrbMetrics(vw, viewport.vh);
      const shellEl = dockShellRef.current;
      const clipW = shellEl?.offsetWidth || dims.w + 2;
      const clipH = shellEl?.offsetHeight || dims.h + 2;
      const cx = Math.max(
        orbSize * 0.5,
        Math.min(Math.max(orbSize * 0.5, dims.w - orbSize * 0.5), localCx ?? dims.w * 0.5)
      );
      const cy = Math.max(
        orbSize * 0.5,
        Math.min(Math.max(orbSize * 0.5, dims.h - orbSize * 0.5), localCy ?? dims.h * 0.5)
      );
      const shellX = cx - orbSize * 0.5;
      const shellY = cy - orbSize * 0.5;
      dockOrbShellX.set(shellX);
      dockOrbShellY.set(shellY);
      const padLeft = Math.max(0, shellX);
      const padRight = Math.max(0, clipW - shellX - orbSize);
      const padTop = Math.max(0, shellY);
      const padBottom = Math.max(0, clipH - shellY - orbSize);
      const targetInset = `inset(${padTop.toFixed(1)}px ${padRight.toFixed(1)}px ${padBottom.toFixed(1)}px ${padLeft.toFixed(1)}px round 999px)`;
      dockAnchorRef.current?.classList.add('is-morphing-orb', 'is-dock-animating');
      if (dockClipPath.get() === 'none') {
        dockClipPath.set('inset(-28.0px -32.0px -56.0px -32.0px round 999px)');
      }
      dockContentOpacityAnimRef.current?.stop();
      dockContentScaleAnimRef.current?.stop();
      const contentOutAnim = animate(dockContentOpacity, 0, {
        duration: 0.16,
        ease: APPLE_CALM_EASE,
      });
      dockContentOpacityAnimRef.current = contentOutAnim;
      void contentOutAnim.finished.then(() => {
        if (dockContentOpacityAnimRef.current === contentOutAnim) {
          dockContentOpacityAnimRef.current = null;
        }
      });
      const contentScaleOutAnim = animate(dockContentScale, 0.96, {
        duration: 0.18,
        ease: APPLE_CALM_EASE,
      });
      dockContentScaleAnimRef.current = contentScaleOutAnim;
      void contentScaleOutAnim.finished.then(() => {
        if (dockContentScaleAnimRef.current === contentScaleOutAnim) {
          dockContentScaleAnimRef.current = null;
        }
      });
      dockClipAnimRef.current?.stop();
      const clipAnim = animate(dockClipPath, targetInset, {
        duration,
        ease: APPLE_CALM_EASE,
      });
      dockClipAnimRef.current = clipAnim;
      void clipAnim.finished.then(() => {
        if (dockClipAnimRef.current === clipAnim) {
          dockClipAnimRef.current = null;
          if (!isAnimatingDockRef.current) {
            dockAnchorRef.current?.classList.remove('is-dock-animating');
          }
        }
      });
      dockOrbCoreAnimRef.current?.stop();
      const coreAnim = animate(dockOrbCoreOpacity, 1, {
        duration: Math.max(0.18, duration * 0.68),
        delay: Math.min(0.09, duration * 0.28),
        ease: APPLE_CALM_EASE,
      });
      dockOrbCoreAnimRef.current = coreAnim;
      void coreAnim.finished.then(() => {
        if (dockOrbCoreAnimRef.current === coreAnim) {
          dockOrbCoreAnimRef.current = null;
        }
      });
    },
    [dockClipPath, dockContentOpacity, dockContentScale, dockOrbCoreOpacity, dockOrbShellX, dockOrbShellY, viewport.vh]
  );

  const unmorphDockFromOrbVisual = useCallback(() => {
    dockAnchorRef.current?.classList.remove('is-morphing-orb');
    dockClipAnimRef.current?.stop();
    if (dockClipPath.get() !== 'none') {
      const anim = animate(
        dockClipPath,
        'inset(-28.0px -32.0px -56.0px -32.0px round 999px)',
        { duration: 0.28, ease: APPLE_CALM_EASE }
      );
      dockClipAnimRef.current = anim;
      void anim.finished.then(() => {
        if (dockClipAnimRef.current === anim) {
          dockClipAnimRef.current = null;
          dockClipPath.set('none');
          if (!isAnimatingDockRef.current) {
            dockAnchorRef.current?.classList.remove('is-dock-animating');
          }
        }
      });
    }
    dockContentOpacityAnimRef.current?.stop();
    const contentOpAnim = animate(dockContentOpacity, 1, {
      duration: 0.24,
      delay: 0.04,
      ease: APPLE_CALM_EASE,
    });
    dockContentOpacityAnimRef.current = contentOpAnim;
    void contentOpAnim.finished.then(() => {
      if (dockContentOpacityAnimRef.current === contentOpAnim) {
        dockContentOpacityAnimRef.current = null;
        dockContentOpacity.set(1);
      }
    });
    dockContentScaleAnimRef.current?.stop();
    const contentScAnim = animate(dockContentScale, 1, {
      duration: 0.28,
      ease: APPLE_CALM_EASE,
    });
    dockContentScaleAnimRef.current = contentScAnim;
    void contentScAnim.finished.then(() => {
      if (dockContentScaleAnimRef.current === contentScAnim) {
        dockContentScaleAnimRef.current = null;
        dockContentScale.set(1);
      }
    });
    dockOrbCoreAnimRef.current?.stop();
    const coreAnim = animate(dockOrbCoreOpacity, 0, {
      duration: 0.16,
      ease: APPLE_CALM_EASE,
    });
    dockOrbCoreAnimRef.current = coreAnim;
    void coreAnim.finished.then(() => {
      if (dockOrbCoreAnimRef.current === coreAnim) {
        dockOrbCoreAnimRef.current = null;
        dockOrbCoreOpacity.set(0);
      }
    });
  }, [dockClipPath, dockContentOpacity, dockContentScale, dockOrbCoreOpacity]);

  const collapseDockToCornerOrb = useCallback(
    (opts: {
      targetSide: DockCornerSide;
      dims?: { w: number; h: number };
      orbCxOnDock?: number;
      orbCyOnDock?: number;
      fromDrag?: boolean;
      skipVisualMorph?: boolean;
      localCx?: number;
      localCy?: number;
    }) => {
      const {
        targetSide,
        dims: explicitDims,
        orbCxOnDock,
        orbCyOnDock,
        fromDrag = false,
        skipVisualMorph = false,
        localCx,
        localCy,
      } = opts;
      setIsSettingsOpen(false);
      if (typeof window !== 'undefined') {
        const m = getLayoutViewport();
        const { vw, vh } = m;
        const { orbSize } = getOrbMetrics(vw, vh);
        const shellEl = dockShellRef.current;
        const contentEl = dockContentRef.current;
        const dims = explicitDims ?? {
          w: shellEl?.offsetWidth || contentEl?.offsetWidth || dimsRef.current.w,
          h: shellEl?.offsetHeight || contentEl?.offsetHeight || dimsRef.current.h,
        };
        const curr = getBottomDockState();
        const solCollapsed = solveBottomDockLayout(vw, vh, {
          ...curr,
          audio: {
            ...curr.audio,
            expanded: false,
            orbSide: targetSide,
          },
        });
        const cornerCoords = resolveAudioOrbCoords(
          targetSide,
          vw,
          vh,
          solCollapsed.audioOrbBottomOffset
        );
        const cornerCx = cornerCoords.left + orbSize * 0.5;
        const cornerCy = cornerCoords.top + orbSize * 0.5;
        const cx = orbCxOnDock ?? dockX.get() + dims.w * 0.5;
        const cy = orbCyOnDock ?? dockY.get() + dims.h * 0.5;
        const dx = cornerCx - cx;
        const dy = cornerCy - cy;
        const flightDist = Math.hypot(dx, dy);
        const flightSec = fromDrag
          ? Math.min(0.32, Math.max(0.24, 0.22 + flightDist * 0.00018))
          : Math.min(0.38, Math.max(0.3, 0.26 + flightDist * 0.0002));

        const solNow = solveBottomDockLayout(vw, vh, curr);
        frozenExitLayoutRef.current = {
          isSplitActive: solNow.isSplitActive,
          isCompactSplit: solNow.isCompactSplit,
          isSideBySide: solNow.isSideBySide,
          maxWidth: solNow.audioMaxWidth,
        };

        stopDockPositionMotion(!fromDrag);
        dockAnimScaleRef.current?.stop();
        if (Math.abs(dockScale.get() - 1) > 0.002) {
          dockAnimScaleRef.current = animate(dockScale, 1, {
            duration: 0.18,
            ease: APPLE_CALM_EASE,
          });
        } else {
          dockAnimScaleRef.current = null;
          dockScale.set(1);
        }

        if (!skipVisualMorph) {
          morphDockToOrbVisual(
            dims,
            fromDrag ? Math.min(0.27, flightSec * 0.84) : Math.min(0.32, flightSec * 0.84),
            vw,
            localCx,
            localCy
          );
        }

        orbPendingSpringRef.current = false;
        orbPendingVelocityRef.current = null;
        dockCollapseDeltaRef.current = { dx, dy };
        dockCollapseFlightSecRef.current = flightSec;
        dockCollapsedFromDragRef.current = fromDrag;
        dockCollapseHandedOffRef.current = false;
        dockWasCollapsedIntoOrbRef.current = true;
        orbLauncherOpacity.set(0);

        stopOrbMotion();
        orbX.set(cornerCoords.left);
        orbY.set(cornerCoords.top);
        setOrbSide((prev) => (prev === targetSide ? prev : targetSide));
        updateAudioDockState({ expanded: false, orbSide: targetSide });
      }
      onMinimize();
    },
    [
      dockScale,
      dockX,
      dockY,
      morphDockToOrbVisual,
      onMinimize,
      orbLauncherOpacity,
      orbX,
      orbY,
      stopDockPositionMotion,
      stopOrbMotion,
    ]
  );

  const openDockFromOrb = useCallback(() => {
    dockWasCollapsedIntoOrbRef.current = false;
    dockCollapsedFromDragRef.current = false;
    dockCollapseDeltaRef.current = { dx: 0, dy: 0 };
    const { vw, vh } = getLayoutViewport();
    const halfOrb = getOrbMetrics(vw, vh).orbSize * 0.5;
    const resolved = resolveAudioOrbCoords(
      orbSideRef.current,
      vw,
      vh,
      layoutSolution.audioOrbBottomOffset
    );
    const curX = Number.isFinite(orbX.get()) && orbLayoutReadyRef.current ? orbX.get() : resolved.left;
    const curY = Number.isFinite(orbY.get()) && orbLayoutReadyRef.current ? orbY.get() : resolved.top;
    dockOpeningFromOrbRef.current = {
      cx: curX + halfOrb,
      cy: curY + halfOrb,
    };
    updateAudioDockState({ expanded: true });
    onExpand();
  }, [layoutSolution.audioOrbBottomOffset, onExpand, orbX, orbY]);

  const openBarFromDraggedOrb = useCallback(
    (rawLeft: number, rawTop: number) => {
      const { vw, vh } = getLayoutViewport();
      const { bottomMargin, orbSize } = getOrbMetrics(vw, vh);
      const cornerRestTop = vh - orbSize - bottomMargin - layoutSolution.audioOrbBottomOffset;
      const clamped = clampOrbCoords(rawLeft, cornerRestTop, vw, vh);
      const centerX = clamped.left + orbSize * 0.5;
      const centerY = clamped.top + orbSize * 0.5;
      const nextOrbSide: DockCornerSide = centerX < vw * 0.5 ? 'left' : 'right';

      dockWasCollapsedIntoOrbRef.current = false;
      dockCollapsedFromDragRef.current = false;
      dockCollapseDeltaRef.current = { dx: 0, dy: 0 };
      dockOpeningFromOrbRef.current = { cx: centerX, cy: centerY };
      setOrbSide(nextOrbSide);
      updateAudioDockState({ expanded: true, orbSide: nextOrbSide });
      onExpand();
    },
    [layoutSolution.audioOrbBottomOffset, onExpand]
  );

  // Sync orb origin on open and collapse cleanly even when minimized externally
  const prevExpandedForTransitionRef = useRef(isExpanded);
  useLayoutEffect(() => {
    const wasExpanded = prevExpandedForTransitionRef.current;
    prevExpandedForTransitionRef.current = isExpanded;

    if (!wasExpanded && isExpanded) {
      dockWasCollapsedIntoOrbRef.current = false;
      dockCollapsedFromDragRef.current = false;
      dockCollapseHandedOffRef.current = false;
      frozenExitLayoutRef.current = null;
      if (dockMotionShellRef.current) {
        dockMotionShellRef.current.style.opacity = '';
      }
      if (!dockOpeningFromOrbRef.current) {
        const m = getLayoutViewport();
        const { orbSize } = getOrbMetrics(m.vw, m.vh);
        const resolved = resolveAudioOrbCoords(
          orbSideRef.current,
          m.vw,
          m.vh,
          layoutSolution.audioOrbBottomOffset
        );
        const curX = Number.isFinite(orbX.get()) && orbLayoutReadyRef.current ? orbX.get() : resolved.left;
        const curY = Number.isFinite(orbY.get()) && orbLayoutReadyRef.current ? orbY.get() : resolved.top;
        dockOpeningFromOrbRef.current = {
          cx: curX + orbSize * 0.5,
          cy: curY + orbSize * 0.5,
        };
      }
    } else if (wasExpanded && !isExpanded) {
      if (!dockWasCollapsedIntoOrbRef.current && typeof window !== 'undefined') {
        stopDockPositionMotion(true);
        dockScale.set(1);
        const m = getLayoutViewport();
        const { vw, vh } = m;
        const { orbSize } = getOrbMetrics(vw, vh);
        const targetSide = orbSideRef.current;
        const curr = getBottomDockState();
        const solCollapsed = solveBottomDockLayout(vw, vh, {
          ...curr,
          audio: { ...curr.audio, expanded: false, orbSide: targetSide },
        });
        const cornerCoords = resolveAudioOrbCoords(
          targetSide,
          vw,
          vh,
          solCollapsed.audioOrbBottomOffset
        );
        const cornerCx = cornerCoords.left + orbSize * 0.5;
        const cornerCy = cornerCoords.top + orbSize * 0.5;
        const dockW = dockShellRef.current?.offsetWidth || dimsRef.current.w;
        const dockH = dockShellRef.current?.offsetHeight || dimsRef.current.h;
        const dx = cornerCx - (dockX.get() + dockW * 0.5);
        const dy = cornerCy - (dockY.get() + dockH * 0.5);
        const flightSec = Math.min(0.38, Math.max(0.3, 0.26 + Math.hypot(dx, dy) * 0.0002));

        const solNow = solveBottomDockLayout(vw, vh, curr);
        frozenExitLayoutRef.current = {
          isSplitActive: solNow.isSplitActive,
          isCompactSplit: solNow.isCompactSplit,
          isSideBySide: solNow.isSideBySide,
          maxWidth: solNow.audioMaxWidth,
        };

        dockCollapseDeltaRef.current = { dx, dy };
        dockCollapseFlightSecRef.current = flightSec;
        dockCollapsedFromDragRef.current = false;
        dockCollapseHandedOffRef.current = false;
        dockWasCollapsedIntoOrbRef.current = true;
        orbLauncherOpacity.set(0);
        if (orbBtnRef.current) {
          orbBtnRef.current.style.opacity = '0';
        }
        morphDockToOrbVisual({ w: dockW, h: dockH }, Math.min(0.32, flightSec * 0.84), vw);
        stopOrbMotion();
        orbX.set(cornerCoords.left);
        orbY.set(cornerCoords.top);
        updateAudioDockState({ expanded: false, orbSide: targetSide });
      }
    }
  }, [
    isExpanded,
    dockScale,
    dockX,
    dockY,
    orbLauncherOpacity,
    orbX,
    orbY,
    layoutSolution.audioOrbBottomOffset,
    morphDockToOrbVisual,
    stopDockPositionMotion,
    stopOrbMotion,
  ]);

  // Safety handoff timer when minimized into orb
  useLayoutEffect(() => {
    if (isExpanded) {
      dockCollapseHandedOffRef.current = false;
      orbLauncherOpacity.set(1);
      return;
    }
    if (dockWasCollapsedIntoOrbRef.current) {
      const flightSec =
        dockCollapseFlightSecRef.current || (dockCollapsedFromDragRef.current ? 0.26 : 0.32);
      dockCollapsedFromDragRef.current = false;
      orbLauncherOpacity.set(0);
      if (orbBtnRef.current) {
        orbBtnRef.current.style.opacity = '0';
      }
      const timer = window.setTimeout(() => {
        if (!isExpandedRef.current && orbLauncherOpacity.get() < 1) {
          orbLauncherOpacity.set(1);
          if (orbBtnRef.current) {
            orbBtnRef.current.style.opacity = '1';
          }
          if (dockMotionShellRef.current) {
            dockMotionShellRef.current.style.opacity = '0';
          }
          dockCollapseHandedOffRef.current = true;
          dockWasCollapsedIntoOrbRef.current = false;
          frozenExitLayoutRef.current = null;
        }
      }, Math.round((flightSec + 0.14) * 1000));
      return () => window.clearTimeout(timer);
    }
    dockCollapsedFromDragRef.current = false;
    dockCollapseHandedOffRef.current = false;
    orbLauncherOpacity.set(1);
    if (orbBtnRef.current) {
      orbBtnRef.current.style.opacity = '1';
    }
    return undefined;
  }, [isExpanded, orbLauncherOpacity]);

  // Measure live shell size whenever expanded (rAF-deferred ResizeObserver)
  useEffect(() => {
    if (!isExpanded) return;
    const el = dockShellRef.current || dockContentRef.current;
    if (!el) return;

    let rafId = 0;
    const measure = () => {
      if (dockDragRef.current?.moved) return;
      const renderedW = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (renderedW <= 0 || h <= 0) return;
      dimsRef.current = { w: renderedW, h };
      const m = getLayoutViewport();
      const sol = solveBottomDockLayout(m.vw, m.vh, getBottomDockState());
      const isWidthCapped = sol.audioMaxWidth !== null && renderedW >= sol.audioMaxWidth - 4;
      updateAudioDockState(isWidthCapped ? { height: h } : { width: renderedW, height: h });
    };

    const scheduleMeasure = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    isExpanded,
    layoutSolution.isSplitActive,
    layoutSolution.isSideBySide,
    layoutSolution.audioMaxWidth,
    viewport.vw,
  ]);

  // Pre-paint expanded dock positioning & 1:1 Pen-Dock open choreography
  useLayoutEffect(() => {
    if (!isExpanded) {
      dockLayoutReadyRef.current = false;
      return;
    }
    if (dockDragRef.current?.moved) return;

    const { vw, vh } = viewport;
    const edge = vw < 640 ? 8 : 14;
    const shellEl = dockShellRef.current;
    const contentEl = dockContentRef.current;
    const liveRenderedW = Math.round(shellEl?.offsetWidth || contentEl?.offsetWidth || dimsRef.current.w);
    const liveH = Math.round(shellEl?.offsetHeight || contentEl?.offsetHeight || dimsRef.current.h);
    if (liveRenderedW > 0 && liveH > 0) {
      dimsRef.current = { w: liveRenderedW, h: liveH };
    }

    const curr = getBottomDockState();
    const effSol = solveBottomDockLayout(vw, vh, {
      ...curr,
      audio: {
        ...curr.audio,
        expanded: true,
        width: liveRenderedW,
        height: liveH,
      },
    });
    const clampedLeft = Math.max(
      edge,
      Math.min(Math.max(edge, vw - liveRenderedW - edge), effSol.audioRestLeft)
    );
    const clampedTop = effSol.audioRestTop;

    if (!dockLayoutReadyRef.current) {
      dockLayoutReadyRef.current = true;
      dockAnchorRef.current?.classList.remove('is-morphing-orb');
      if (dockMotionShellRef.current) {
        dockMotionShellRef.current.style.opacity = '';
      }
      const fromOrb = dockOpeningFromOrbRef.current;
      dockOpeningFromOrbRef.current = null;

      if (fromOrb && !prefersReducedMotionNow()) {
        const { orbSize } = getOrbMetrics(vw, vh);
        const startLeft = Math.max(
          edge,
          Math.min(Math.max(edge, vw - liveRenderedW - edge), fromOrb.cx - liveRenderedW * 0.5)
        );
        const startTop = Math.max(
          14,
          Math.min(Math.max(14, vh - liveH - 14), fromOrb.cy - liveH * 0.5)
        );
        const clipW = shellEl?.offsetWidth || liveRenderedW;
        const clipH = shellEl?.offsetHeight || liveH;
        const shellX = Math.max(
          0,
          Math.min(Math.max(0, liveRenderedW - orbSize), fromOrb.cx - startLeft - orbSize * 0.5)
        );
        const shellY = Math.max(
          0,
          Math.min(Math.max(0, liveH - orbSize), fromOrb.cy - startTop - orbSize * 0.5)
        );
        const padLeft = Math.max(0, shellX);
        const padRight = Math.max(0, clipW - shellX - orbSize);
        const padTop = Math.max(0, shellY);
        const padBottom = Math.max(0, clipH - shellY - orbSize);

        dockOrbShellX.set(shellX);
        dockOrbShellY.set(shellY);
        dockX.set(startLeft);
        dockY.set(startTop);
        dockScale.set(1);

        dockOrbCoreAnimRef.current?.stop();
        dockOrbCoreOpacity.set(1);
        const coreAnim = animate(dockOrbCoreOpacity, 0, {
          duration: 0.22,
          delay: 0.04,
          ease: APPLE_CALM_EASE,
        });
        dockOrbCoreAnimRef.current = coreAnim;
        void coreAnim.finished.then(() => {
          if (dockOrbCoreAnimRef.current === coreAnim) {
            dockOrbCoreAnimRef.current = null;
            dockOrbCoreOpacity.set(0);
          }
        });

        dockContentOpacityAnimRef.current?.stop();
        dockContentOpacity.set(0);
        const contentOpAnim = animate(dockContentOpacity, 1, {
          duration: 0.28,
          delay: 0.09,
          ease: APPLE_CALM_EASE,
        });
        dockContentOpacityAnimRef.current = contentOpAnim;
        void contentOpAnim.finished.then(() => {
          if (dockContentOpacityAnimRef.current === contentOpAnim) {
            dockContentOpacityAnimRef.current = null;
            dockContentOpacity.set(1);
          }
        });

        dockContentScaleAnimRef.current?.stop();
        dockContentScale.set(0.96);
        const contentScAnim = animate(dockContentScale, 1, {
          duration: 0.34,
          delay: 0.03,
          ease: APPLE_CALM_EASE,
        });
        dockContentScaleAnimRef.current = contentScAnim;
        void contentScAnim.finished.then(() => {
          if (dockContentScaleAnimRef.current === contentScAnim) {
            dockContentScaleAnimRef.current = null;
            dockContentScale.set(1);
          }
        });

        dockClipPath.set(
          `inset(${padTop.toFixed(1)}px ${padRight.toFixed(1)}px ${padBottom.toFixed(1)}px ${padLeft.toFixed(1)}px round 999px)`
        );
        dockAnchorRef.current?.classList.add('is-dock-animating');
        animateDockTo(clampedLeft, clampedTop, false, null, APPLE_DOCK_SPRING);
        dockAnimScaleRef.current?.stop();
        dockAnimScaleRef.current = animate(dockScale, 1, APPLE_DOCK_SPRING);
        dockClipAnimRef.current?.stop();
        const clipAnim = animate(
          dockClipPath,
          'inset(-28px -32px -56px -32px round 999px)',
          { duration: 0.38, ease: APPLE_CALM_EASE }
        );
        dockClipAnimRef.current = clipAnim;
        void clipAnim.finished.then(() => {
          if (dockClipAnimRef.current === clipAnim) {
            dockClipAnimRef.current = null;
            dockClipPath.set('none');
            if (!isAnimatingDockRef.current) {
              dockAnchorRef.current?.classList.remove('is-dock-animating');
            }
          }
        });
        return;
      }

      dockClipAnimRef.current?.stop();
      dockClipAnimRef.current = null;
      dockOrbCoreAnimRef.current?.stop();
      dockOrbCoreAnimRef.current = null;
      dockContentOpacityAnimRef.current?.stop();
      dockContentOpacityAnimRef.current = null;
      dockContentScaleAnimRef.current?.stop();
      dockContentScaleAnimRef.current = null;
      dockOrbCoreOpacity.set(0);
      dockContentOpacity.set(1);
      dockContentScale.set(1);
      dockClipPath.set('none');
      animateDockTo(clampedLeft, clampedTop, true);
      return;
    }

    if (dockMotionShellRef.current && dockMotionShellRef.current.style.opacity !== '') {
      dockMotionShellRef.current.style.opacity = '';
    }

    if (dockPendingSpringRef.current) {
      const releaseVel = dockPendingVelocityRef.current;
      dockPendingSpringRef.current = false;
      dockPendingVelocityRef.current = null;
      if (Math.abs(dockScale.get() - 1) > 0.002) {
        dockAnimScaleRef.current?.stop();
        dockAnimScaleRef.current = animate(dockScale, 1, APPLE_CONTAINER_SPRING);
      }
      animateDockTo(clampedLeft, clampedTop, false, releaseVel);
      return;
    }

    if (!wasDragOrbFormedRef.current && !dockWasCollapsedIntoOrbRef.current && dockOrbCoreAnimRef.current === null) {
      dockOrbCoreOpacity.set(0);
      dockAnchorRef.current?.classList.remove('is-morphing-orb');
    }
    if (
      !wasDragOrbFormedRef.current &&
      !dockWasCollapsedIntoOrbRef.current &&
      dockClipAnimRef.current === null &&
      dockContentOpacityAnimRef.current === null
    ) {
      if (dockContentOpacity.get() !== 1) dockContentOpacity.set(1);
      if (dockContentScale.get() !== 1) dockContentScale.set(1);
    }

    if (
      isAnimatingDockRef.current &&
      dockAnimTargetRef.current &&
      Math.abs(dockAnimTargetRef.current.x - clampedLeft) < 2 &&
      Math.abs(dockAnimTargetRef.current.y - clampedTop) < 2
    ) {
      return;
    }

    if (
      Math.abs(dockX.get() - clampedLeft) > 0.6 ||
      Math.abs(dockY.get() - clampedTop) > 0.6
    ) {
      animateDockTo(clampedLeft, clampedTop, false);
    }
  }, [
    isExpanded,
    viewport,
    layoutSolution.audioRestLeft,
    layoutSolution.audioRestTop,
    layoutSolution.audioMaxWidth,
    layoutSolution.isSplitActive,
    layoutSolution.isSideBySide,
    animateDockTo,
    dockClipPath,
    dockContentOpacity,
    dockContentScale,
    dockOrbCoreOpacity,
    dockOrbShellX,
    dockOrbShellY,
    dockScale,
    dockX,
    dockY,
  ]);

  // Position collapsed orb smoothly without redundant spring restarts
  useLayoutEffect(() => {
    if (isExpanded) {
      orbLayoutReadyRef.current = false;
      return;
    }
    if (orbDragRef.current?.moved) return;

    const coords = resolveAudioOrbCoords(
      orbSide,
      viewport.vw,
      viewport.vh,
      layoutSolution.audioOrbBottomOffset
    );

    if (!orbLayoutReadyRef.current) {
      orbLayoutReadyRef.current = true;
      animateOrbTo(coords.left, coords.top, true);
      return;
    }

    const useSpring = orbPendingSpringRef.current;
    const pendingVel = orbPendingVelocityRef.current;
    orbPendingSpringRef.current = false;
    orbPendingVelocityRef.current = null;

    if (
      useSpring ||
      Math.abs(orbX.get() - coords.left) > 0.8 ||
      Math.abs(orbY.get() - coords.top) > 0.8
    ) {
      animateOrbTo(coords.left, coords.top, false, pendingVel);
    }
  }, [
    isExpanded,
    orbSide,
    viewport.vw,
    viewport.vh,
    layoutSolution.audioOrbBottomOffset,
    animateOrbTo,
    orbX,
    orbY,
  ]);

  // Cleanup animations on unmount
  useEffect(() => {
    return () => {
      dockAnimXRef.current?.stop();
      dockAnimYRef.current?.stop();
      dockAnimScaleRef.current?.stop();
      dockContentOpacityAnimRef.current?.stop();
      dockContentScaleAnimRef.current?.stop();
      dockClipAnimRef.current?.stop();
      dockOrbCoreAnimRef.current?.stop();
      orbAnimXRef.current?.stop();
      orbAnimYRef.current?.stop();
      if (dockMoveRafRef.current !== null) window.cancelAnimationFrame(dockMoveRafRef.current);
      if (orbMoveRafRef.current !== null) window.cancelAnimationFrame(orbMoveRafRef.current);
    };
  }, []);

  // Dock pointer step & release (window-tracked for zero stuck drags)
  const stepDockDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dockDragRef.current;
      if (!drag) return;
      const now = performance.now();
      const dt = Math.max(4, now - drag.lastTime);
      const stepDx = clientX - drag.lastClientX;
      const stepDy = clientY - drag.lastClientY;
      const stepDist = Math.hypot(stepDx, stepDy);
      const instVx = stepDx / dt;
      const instVy = stepDy / dt;
      drag.vx = 0.38 * instVx + 0.62 * drag.vx;
      drag.vy = 0.38 * instVy + 0.62 * drag.vy;
      drag.lastClientX = clientX;
      drag.lastClientY = clientY;
      drag.lastTime = now;

      const totalDx = clientX - drag.startClientX;
      const totalDy = clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(totalDx, totalDy) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        suppressNextClickRef.current = true;
        setIsDockDragging(true);
        setIsSettingsOpen(false);
      }

      const { vw, vh } = getLayoutViewport();
      const { orbSize } = getOrbMetrics(vw, vh);

      // Smoothly recenter horizontal grab offset as the bar slides left/right along the bottom track
      if (stepDist > 0.5 && !wasDragOrbFormedRef.current) {
        const recenterFactor = Math.min(0.18, stepDist / 180);
        drag.grabOffsetX += (drag.w * 0.5 - drag.grabOffsetX) * recenterFactor;
      }

      const safeMinLeft = 12;
      const safeMaxLeft = Math.max(safeMinLeft, vw - drag.w - 12);
      const rawLeft = clientX - drag.grabOffsetX;
      const bottomRestLeft = (vw - drag.w) * 0.5;
      const visualLeft = rubberBandClamp(rawLeft, safeMinLeft, safeMaxLeft, 14);
      const visualTop = drag.startTop + Math.max(-14, Math.min(10, totalDy * 0.14));

      const hasIntentionalDrag =
        Math.hypot(totalDx, totalDy) >= 18 || wasDragOrbFormedRef.current;
      const prevCorner = dockDropCornerRef.current;
      const nextCorner = hasIntentionalDrag
        ? detectCornerMagnet(clientX, clientY, vw, vh, prevCorner, true, {
            rawLeft,
            dockW: drag.w,
            totalDxFromStart: totalDx,
            startClientX: drag.startClientX,
            vx: drag.vx,
          })
        : null;

      let effectiveLeft = visualLeft;
      let effectiveTop = visualTop;

      if (nextCorner) {
        const curr = getBottomDockState();
        const solCollapsed = solveBottomDockLayout(vw, vh, {
          ...curr,
          audio: { ...curr.audio, expanded: false, orbSide: nextCorner },
        });
        const cornerCoords = resolveAudioOrbCoords(
          nextCorner,
          vw,
          vh,
          solCollapsed.audioOrbBottomOffset
        );
        const localCx =
          drag.morphedLocalCx ??
          Math.max(
            orbSize * 0.5,
            Math.min(Math.max(orbSize * 0.5, drag.w - orbSize * 0.5), clientX - visualLeft)
          );
        const localCy =
          drag.morphedLocalCy ??
          Math.max(
            orbSize * 0.5,
            Math.min(Math.max(orbSize * 0.5, drag.h - orbSize * 0.5), drag.h * 0.5)
          );

        if (!wasDragOrbFormedRef.current) {
          wasDragOrbFormedRef.current = true;
          drag.morphedLocalCx = localCx;
          drag.morphedLocalCy = localCy;
          morphDockToOrbVisual({ w: drag.w, h: drag.h }, 0.24, vw, localCx, localCy);
          dockAnimScaleRef.current?.stop();
          dockAnimScaleRef.current = animate(dockScale, 1, {
            duration: 0.22,
            ease: APPLE_CALM_EASE,
          });
        }
        drag.lastOrbCoords = {
          left: cornerCoords.left,
          top: cornerCoords.top,
          localCx,
          localCy,
        };
        drag.orbMagnetBlend = Math.min(1, drag.orbMagnetBlend + dt / 95);
        const b = drag.orbMagnetBlend;
        const easedPull = 0.42 * (1 - (1 - b) * (1 - b));
        const cornerCx = cornerCoords.left + orbSize * 0.5;
        const cornerCy = cornerCoords.top + orbSize * 0.5;
        const cornerDockLeft = cornerCx - localCx;
        const cornerDockTop = cornerCy - localCy;
        effectiveLeft = visualLeft + (cornerDockLeft - visualLeft) * easedPull;
        effectiveTop = visualTop + (cornerDockTop - visualTop) * easedPull;
      } else {
        if (wasDragOrbFormedRef.current) {
          wasDragOrbFormedRef.current = false;
          drag.morphedLocalCx = undefined;
          drag.morphedLocalCy = undefined;
          unmorphDockFromOrbVisual();
        }
        if (drag.orbMagnetBlend > 0) {
          drag.orbMagnetBlend = Math.max(0, drag.orbMagnetBlend - dt / 85);
          if (drag.orbMagnetBlend > 0 && drag.lastOrbCoords) {
            const b = drag.orbMagnetBlend;
            const easedPull = 0.42 * (1 - (1 - b) * (1 - b));
            const prevOrb = drag.lastOrbCoords;
            const cornerDockLeft = prevOrb.left + orbSize * 0.5 - prevOrb.localCx;
            const cornerDockTop = prevOrb.top + orbSize * 0.5 - prevOrb.localCy;
            effectiveLeft = visualLeft + (cornerDockLeft - visualLeft) * easedPull;
            effectiveTop = visualTop + (cornerDockTop - visualTop) * easedPull;
          } else if (drag.orbMagnetBlend === 0) {
            drag.lastOrbCoords = undefined;
          }
        }

        // Soft magnetic detent near bottom-center & gentle condensation scale near left/right shortcut corners
        const centerDist = Math.abs(visualLeft - bottomRestLeft);
        if (centerDist < 42 && Math.abs(drag.vx) < 0.35) {
          const centerMagnet = (1 - centerDist / 42) * 0.22;
          effectiveLeft = effectiveLeft + (bottomRestLeft - effectiveLeft) * centerMagnet;
        }

        const cornerPocket = getDockCornerPocketMetrics(vw, vh);
        const edgeGap = Math.min(
          Math.max(0, clientX - cornerPocket.zoneW),
          Math.max(0, vw - cornerPocket.zoneW - clientX)
        );
        const tCorner = Math.max(0, Math.min(1, 1 - edgeGap / 110));
        const cornerA = tCorner * tCorner * (3 - 2 * tCorner);
        const desiredScale = 0.985 - 0.045 * cornerA;
        dockAnimScaleRef.current?.stop();
        dockAnimScaleRef.current = null;
        const lerpAlpha = 1 - Math.exp(-dt / 42);
        dockScale.set(dockScale.get() + (desiredScale - dockScale.get()) * lerpAlpha);
      }

      if (dockDropCornerRef.current !== nextCorner) {
        dockDropCornerRef.current = nextCorner;
        setDockDropCorner(nextCorner);
      }

      drag.liveLeft = effectiveLeft;
      drag.liveTop = effectiveTop;
      dockX.set(effectiveLeft);
      dockY.set(effectiveTop);
    },
    [dockScale, dockX, dockY, morphDockToOrbVisual, unmorphDockFromOrbVisual]
  );

  const finishDockDrag = useCallback(
    (clientX: number, clientY: number, pointerId?: number) => {
      if (dockMoveRafRef.current !== null) {
        window.cancelAnimationFrame(dockMoveRafRef.current);
        dockMoveRafRef.current = null;
      }
      dockLatestPointerRef.current = null;

      const drag = dockDragRef.current;
      if (!drag) return;
      if (pointerId !== undefined && drag.pointerId !== pointerId) return;

      if (drag.moved && Math.hypot(clientX - drag.lastClientX, clientY - drag.lastClientY) >= 2) {
        stepDockDrag(clientX, clientY);
      }

      const wasMoved = drag.moved;
      const finalLeft = drag.liveLeft;
      const finalTop = drag.liveTop;
      const finalW = drag.w;
      const finalH = drag.h;
      const savedLocalCx = drag.morphedLocalCx;
      const savedLocalCy = drag.morphedLocalCy;
      const savedGrabX = drag.grabOffsetX;
      const savedGrabY = drag.grabOffsetY;
      const dragDistFromStart = Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY);
      const idleMs = performance.now() - drag.lastTime;
      const finalVx = idleMs > 90 ? 0 : drag.vx;
      let dropCorner = dockDropCornerRef.current;
      const wasInFormedOrb = wasDragOrbFormedRef.current;

      dockDragRef.current = null;
      dockDropCornerRef.current = null;
      wasDragOrbFormedRef.current = false;

      try {
        if (dockAnchorRef.current?.hasPointerCapture(drag.pointerId)) {
          dockAnchorRef.current.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Ignore capture release errors
      }

      setIsDockDragging(false);
      setDockDropCorner(null);

      if (!wasMoved) {
        suppressNextClickRef.current = false;
        dockScale.set(1);
        return;
      }
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 60);

      const { vw } = getLayoutViewport();
      const { orbSize } = getOrbMetrics(vw, viewport.vh);

      // Horizontal flick along the bottom rail snaps cleanly into the left or right shortcut orb
      if (!dropCorner && dragDistFromStart >= 22) {
        if (finalVx <= -0.45 && clientX + finalVx * 160 <= vw * 0.42) {
          dropCorner = 'left';
        } else if (finalVx >= 0.45 && clientX + finalVx * 160 >= vw * 0.58) {
          dropCorner = 'right';
        }
      }

      if (dropCorner) {
        const localCx =
          savedLocalCx ??
          Math.max(
            orbSize * 0.5,
            Math.min(Math.max(orbSize * 0.5, finalW - orbSize * 0.5), savedGrabX)
          );
        const localCy =
          savedLocalCy ??
          Math.max(
            orbSize * 0.5,
            Math.min(Math.max(orbSize * 0.5, finalH - orbSize * 0.5), savedGrabY)
          );
        collapseDockToCornerOrb({
          targetSide: dropCorner,
          dims: { w: finalW, h: finalH },
          orbCxOnDock: finalLeft + localCx,
          orbCyOnDock: finalTop + localCy,
          fromDrag: true,
          skipVisualMorph: wasInFormedOrb,
          localCx,
          localCy,
        });
        return;
      }

      if (wasInFormedOrb) {
        unmorphDockFromOrbVisual();
      }

      const clampVel = (v: number) => Math.max(-1800, Math.min(1800, v));
      dockPendingVelocityRef.current = { vx: clampVel(finalVx * 1000), vy: 0 };

      const currCoord = getBottomDockState();
      const splitSol = solveBottomDockLayout(vw, viewport.vh, currCoord);
      if (splitSol.isSplitActive && splitSol.isSideBySide) {
        const finalCenterX = finalLeft + finalW * 0.5;
        if (currCoord.splitOrder === 'pens-left' && finalCenterX < vw * 0.48) {
          dockPendingSpringRef.current = true;
          setBottomDockSplitOrder('audio-left');
          return;
        }
        if (currCoord.splitOrder === 'audio-left' && finalCenterX > vw * 0.52) {
          dockPendingSpringRef.current = true;
          setBottomDockSplitOrder('pens-left');
          return;
        }
      }

      if (Math.abs(dockScale.get() - 1) > 0.002) {
        dockAnimScaleRef.current?.stop();
        dockAnimScaleRef.current = animate(dockScale, 1, APPLE_CONTAINER_SPRING);
      }
      animateDockTo(
        layoutSolution.audioRestLeft,
        layoutSolution.audioRestTop,
        false,
        dockPendingVelocityRef.current
      );
      dockPendingVelocityRef.current = null;
    },
    [
      animateDockTo,
      collapseDockToCornerOrb,
      dockScale,
      layoutSolution.audioRestLeft,
      layoutSolution.audioRestTop,
      stepDockDrag,
      unmorphDockFromOrbVisual,
      viewport.vh,
    ]
  );

  // Window listeners while expanded so dock drag never gets stranded
  useEffect(() => {
    if (!isExpanded) return;

    const onDockWinMove = (e: PointerEvent) => {
      const drag = dockDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToPortalPoint(e.clientX, e.clientY);
      dockLatestPointerRef.current = { clientX: pt.x, clientY: pt.y };
      if (dockMoveRafRef.current === null) {
        dockMoveRafRef.current = window.requestAnimationFrame(() => {
          dockMoveRafRef.current = null;
          const latest = dockLatestPointerRef.current;
          if (latest && dockDragRef.current) {
            stepDockDrag(latest.clientX, latest.clientY);
          }
        });
      }
    };

    const onDockWinEnd = (e: PointerEvent) => {
      const drag = dockDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToPortalPoint(e.clientX, e.clientY);
      finishDockDrag(pt.x, pt.y, e.pointerId);
    };

    const onDockBlur = () => {
      const drag = dockDragRef.current;
      if (!drag) return;
      finishDockDrag(drag.lastClientX, drag.lastClientY);
    };

    window.addEventListener('pointermove', onDockWinMove);
    window.addEventListener('pointerup', onDockWinEnd);
    window.addEventListener('pointercancel', onDockWinEnd);
    window.addEventListener('blur', onDockBlur);
    return () => {
      window.removeEventListener('pointermove', onDockWinMove);
      window.removeEventListener('pointerup', onDockWinEnd);
      window.removeEventListener('pointercancel', onDockWinEnd);
      window.removeEventListener('blur', onDockBlur);
    };
  }, [isExpanded, finishDockDrag, stepDockDrag]);

  const handleDockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    suppressNextClickRef.current = false;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'select, input, textarea, a, [role="slider"], [role="switch"], .audio-dock-popover, .audio-dock-progress-track'
      )
    ) {
      return;
    }
    const anchor = dockAnchorRef.current;
    if (!anchor) return;
    const pt = clientToPortalPoint(e.clientX, e.clientY);
    const w = dockShellRef.current?.offsetWidth || dimsRef.current.w;
    const h = dockShellRef.current?.offsetHeight || dimsRef.current.h;
    const startLeft = dockX.get();
    const startTop = dockY.get();
    stopDockPositionMotion(true);
    wasDragOrbFormedRef.current = false;
    dockDropCornerRef.current = null;
    setDockDropCorner(null);
    dockDragRef.current = {
      pointerId: e.pointerId,
      startClientX: pt.x,
      startClientY: pt.y,
      grabOffsetX: pt.x - startLeft,
      grabOffsetY: pt.y - startTop,
      startLeft,
      startTop,
      liveLeft: startLeft,
      liveTop: startTop,
      lastClientX: pt.x,
      lastClientY: pt.y,
      lastTime: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
      w,
      h,
      orbMagnetBlend: 0,
    };
    try {
      anchor.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic capture issues
    }
  };

  // Orb pointer step & release (1:1 Pen Dock with 10px tap threshold & drag-out-to-expand)
  const stepOrbDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = orbDragRef.current;
      if (!drag) return;
      const now = performance.now();
      const dt = Math.max(4, now - drag.lastTime);
      const instVx = (clientX - drag.lastClientX) / dt;
      const instVy = (clientY - drag.lastClientY) / dt;
      drag.vx = 0.38 * instVx + 0.62 * drag.vx;
      drag.vy = 0.38 * instVy + 0.62 * drag.vy;
      drag.lastClientX = clientX;
      drag.lastClientY = clientY;
      drag.lastTime = now;

      const rawDx = clientX - drag.startClientX;
      const rawDy = clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(rawDx, rawDy) < 10) return;
      if (!drag.moved) {
        drag.moved = true;
        setIsOrbDragging(true);
      }

      const { vw, vh } = getLayoutViewport();
      const { bottomMargin, orbSize } = getOrbMetrics(vw, vh);
      const maxLeft = Math.max(10, vw - orbSize - 10);
      const cornerRestTop = vh - orbSize - bottomMargin - layoutSolution.audioOrbBottomOffset;
      const rawLeft = drag.startLeft + rawDx;
      const rubberLeft = rubberBandClamp(rawLeft, 10, maxLeft, 14);
      const trackTop = cornerRestTop + Math.max(-18, Math.min(10, rawDy * 0.16));
      const rawCenterX = rubberLeft + orbSize * 0.5;
      const rawCenterY = trackTop + orbSize * 0.5;

      const magnetSide = detectCornerMagnet(
        rawCenterX,
        rawCenterY,
        vw,
        vh,
        orbDragMagnetRef.current
      );
      orbDragMagnetRef.current = magnetSide;
      setOrbDragMagnet((prev) => (prev === magnetSide ? prev : magnetSide));

      if (magnetSide !== null) {
        const cornerCoords = resolveAudioOrbCoords(
          magnetSide,
          vw,
          vh,
          layoutSolution.audioOrbBottomOffset
        );
        const visualLeft = rubberLeft + (cornerCoords.left - rubberLeft) * 0.52;
        const visualTop = trackTop + (cornerCoords.top - trackTop) * 0.52;
        orbX.set(visualLeft);
        orbY.set(visualTop);
        setOrbDragTarget((prev) => (prev !== null ? null : prev));
        return;
      }

      orbX.set(rubberLeft);
      orbY.set(trackTop);
      setOrbDragTarget((prev) => (prev === 'bottom' ? prev : 'bottom'));
    },
    [layoutSolution.audioOrbBottomOffset, orbX, orbY]
  );

  const finishOrbDrag = useCallback(
    (clientX: number, clientY: number, pointerId?: number) => {
      if (orbMoveRafRef.current !== null) {
        window.cancelAnimationFrame(orbMoveRafRef.current);
        orbMoveRafRef.current = null;
      }
      orbLatestPointerRef.current = null;

      const drag = orbDragRef.current;
      if (!drag) return;
      if (pointerId !== undefined && drag.pointerId !== pointerId) return;

      stepOrbDrag(clientX, clientY);
      const rawLeft = drag.startLeft + (clientX - drag.startClientX);
      const rawTop = drag.startTop + (clientY - drag.startClientY);
      const activeMagnet = orbDragMagnetRef.current;
      const wasMoved = drag.moved;
      const dragVx = drag.vx;

      orbDragRef.current = null;
      orbDragMagnetRef.current = null;
      try {
        if (orbBtnRef.current?.hasPointerCapture(drag.pointerId)) {
          orbBtnRef.current.releasePointerCapture(drag.pointerId);
        }
      } catch {
        // Ignore release errors
      }

      setIsOrbDragging(false);
      setOrbDragTarget(null);
      setOrbDragMagnet(null);

      if (!wasMoved) {
        openDockFromOrb();
        return;
      }

      const { vw, vh } = getLayoutViewport();
      const { bottomMargin, orbSize } = getOrbMetrics(vw, vh);
      const cornerRestTop = vh - orbSize - bottomMargin - layoutSolution.audioOrbBottomOffset;
      const clamped = clampOrbCoords(rawLeft, cornerRestTop, vw, vh);
      const centerX = clamped.left + orbSize * 0.5;
      let magnetSide =
        detectCornerMagnet(
          centerX,
          clamped.top + orbSize * 0.5,
          vw,
          vh,
          activeMagnet
        ) ?? activeMagnet;

      if (magnetSide === null && Math.abs(dragVx) >= 0.42) {
        const projX = centerX + dragVx * 160;
        if (dragVx < 0 && projX <= vw * 0.35) {
          magnetSide = 'left';
        } else if (dragVx > 0 && projX >= vw * 0.65) {
          magnetSide = 'right';
        }
      }

      if (magnetSide !== null) {
        const clampVel = (v: number) => Math.max(-1600, Math.min(1600, v));
        orbPendingVelocityRef.current = { vx: clampVel(dragVx * 1000), vy: 0 };
        orbPendingSpringRef.current = true;
        setOrbSide(magnetSide);
        return;
      }

      openBarFromDraggedOrb(rawLeft, rawTop);
    },
    [layoutSolution.audioOrbBottomOffset, openBarFromDraggedOrb, openDockFromOrb, stepOrbDrag]
  );

  // Window-level orb drag tracking while minimized
  useEffect(() => {
    if (isExpanded) return;

    const onOrbWinMove = (e: PointerEvent) => {
      const drag = orbDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToPortalPoint(e.clientX, e.clientY);
      orbLatestPointerRef.current = { clientX: pt.x, clientY: pt.y };
      if (orbMoveRafRef.current === null) {
        orbMoveRafRef.current = window.requestAnimationFrame(() => {
          orbMoveRafRef.current = null;
          const latest = orbLatestPointerRef.current;
          if (latest && orbDragRef.current) {
            stepOrbDrag(latest.clientX, latest.clientY);
          }
        });
      }
    };

    const onOrbWinEnd = (e: PointerEvent) => {
      const drag = orbDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = clientToPortalPoint(e.clientX, e.clientY);
      finishOrbDrag(pt.x, pt.y, e.pointerId);
    };

    const onOrbBlur = () => {
      const drag = orbDragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        orbDragRef.current = null;
        orbDragMagnetRef.current = null;
        setIsOrbDragging(false);
        setOrbDragTarget(null);
        setOrbDragMagnet(null);
        return;
      }
      finishOrbDrag(drag.lastClientX, drag.lastClientY);
    };

    window.addEventListener('pointermove', onOrbWinMove);
    window.addEventListener('pointerup', onOrbWinEnd);
    window.addEventListener('pointercancel', onOrbWinEnd);
    window.addEventListener('blur', onOrbBlur);
    return () => {
      window.removeEventListener('pointermove', onOrbWinMove);
      window.removeEventListener('pointerup', onOrbWinEnd);
      window.removeEventListener('pointercancel', onOrbWinEnd);
      window.removeEventListener('blur', onOrbBlur);
    };
  }, [isExpanded, finishOrbDrag, stepOrbDrag]);

  const handleOrbPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stopOrbMotion();
    orbPendingSpringRef.current = false;
    orbLatestPointerRef.current = null;
    orbDragMagnetRef.current = null;
    setOrbDragMagnet(null);
    setOrbDragTarget(null);
    if (orbMoveRafRef.current !== null) {
      window.cancelAnimationFrame(orbMoveRafRef.current);
      orbMoveRafRef.current = null;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic capture errors
    }
    const pt = clientToPortalPoint(e.clientX, e.clientY);
    orbDragRef.current = {
      pointerId: e.pointerId,
      startClientX: pt.x,
      startClientY: pt.y,
      startLeft: orbX.get(),
      startTop: orbY.get(),
      lastClientX: pt.x,
      lastClientY: pt.y,
      lastTime: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    };
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioTarget || isPauseGapWaiting) return;
    const track = progressTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    // RTL reading progress grows from right to left
    const ratio = Math.max(0, Math.min(1, 1 - (e.clientX - rect.left) / rect.width));
    onSeekAudioProgress(ratio);
  };

  const activeReferenceTarget: AudioControlTarget =
    audioTarget ?? fallbackTarget ?? { surahId: 1, ayahNum: 1 };

  const activeSurahMeta = audioTarget ? surahMetaMap.get(audioTarget.surahId) : undefined;
  const fallbackSurahMeta = surahMetaMap.get(activeReferenceTarget.surahId);
  const currentReciterShort =
    QURAN_RECITERS.find((r) => r.id === reciterId)?.shortName ?? 'القارئ';

  const handleApplyQuickScope = (kind: 'single' | 'page' | 'jozz' | 'surah' | 'continuous') => {
    let startSurah = activeReferenceTarget.surahId;
    let startAyah = activeReferenceTarget.ayahNum;
    let nextCount = 0;
    let nextRepeatSection = repeatSection;

    if (kind === 'single') {
      nextCount = 1;
      nextRepeatSection = false;
    } else if (kind === 'page') {
      const span = getPageAyahSpan(mushafDataset, currentPageNum, currentPageNum, surahMetaMap);
      if (span) {
        startSurah = span.start.surahId;
        startAyah = span.start.ayahNum;
        nextCount = span.count;
      } else {
        nextCount = 1;
      }
    } else if (kind === 'jozz') {
      const span = getJozzAyahSpan(mushafDataset, currentJozz, currentJozz, surahMetaMap);
      if (span) {
        startSurah = span.start.surahId;
        startAyah = span.start.ayahNum;
        nextCount = span.count;
      } else {
        nextCount = 0;
      }
    } else if (kind === 'surah') {
      const meta = surahMetaMap.get(activeReferenceTarget.surahId);
      if (meta) {
        startSurah = meta.id;
        startAyah = 1;
        nextCount = meta.totalAyat;
      }
    } else {
      nextCount = 0;
      nextRepeatSection = false;
    }

    onApplyPreset({
      surahId: startSurah,
      ayahNum: startAyah,
      reciterId,
      rate,
      repeat,
      repeatSection: nextRepeatSection,
      ayahCount: nextCount,
      autoFollow,
    });
    setIsSettingsOpen(false);
  };

  const isPrevDisabled =
    !audioTarget && !fallbackTarget
      ? true
      : activeReferenceTarget.surahId === 1 && activeReferenceTarget.ayahNum === 1;
  const isNextDisabled =
    !audioTarget && !fallbackTarget
      ? true
      : activeReferenceTarget.surahId === 114 &&
        activeReferenceTarget.ayahNum >= (surahMetaMap.get(114)?.totalAyat ?? 6);
  const canStop = Boolean(audioTarget || isPlaying || isLoading);
  const hasCustomSettings =
    rate !== 1 || repeat !== 1 || pauseGap !== 'none' || stopAtPageEnd;

  const effSplitActive =
    !isExpanded && frozenExitLayoutRef.current
      ? frozenExitLayoutRef.current.isSplitActive
      : layoutSolution.isSplitActive;
  const isCompactSplit =
    !isExpanded && frozenExitLayoutRef.current
      ? frozenExitLayoutRef.current.isCompactSplit
      : layoutSolution.isCompactSplit;
  const isSideBySideSplit =
    !isExpanded && frozenExitLayoutRef.current
      ? frozenExitLayoutRef.current.isSideBySide
      : layoutSolution.isSplitActive && layoutSolution.isSideBySide;
  const effMaxWidth =
    !isExpanded && frozenExitLayoutRef.current
      ? frozenExitLayoutRef.current.maxWidth
      : layoutSolution.audioMaxWidth;
  const isTightCompactSplit =
    isCompactSplit && (effMaxWidth === null || effMaxWidth < 550);

  const activeCornerMagnet: DockCornerSide | null =
    isExpanded && isDockDragging && dockDropCorner
      ? dockDropCorner
      : !isExpanded && isOrbDragging && orbDragMagnet
      ? orbDragMagnet
      : null;

  const cornerMagnetCoords = useMemo(() => {
    if (!activeCornerMagnet) return null;
    const curr = getBottomDockState();
    const solCollapsed = solveBottomDockLayout(viewport.vw, viewport.vh, {
      ...curr,
      audio: { ...curr.audio, expanded: false, orbSide: activeCornerMagnet },
    });
    return resolveAudioOrbCoords(
      activeCornerMagnet,
      viewport.vw,
      viewport.vh,
      solCollapsed.audioOrbBottomOffset
    );
  }, [activeCornerMagnet, viewport.vw, viewport.vh]);

  const dockAnchorExitVariants = {
    exit: () =>
      dockWasCollapsedIntoOrbRef.current
        ? {
            opacity: 1,
            pointerEvents: 'none' as const,
            transition: { duration: dockCollapseFlightSecRef.current || 0.32 },
          }
        : { opacity: 1, pointerEvents: 'none' as const, transition: { duration: 0.24 } },
  };

  const dockMotionShellVariants = {
    initial: { opacity: 1, x: 0, y: 0, scale: 1 },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: {
        opacity: { duration: 0.22, ease: APPLE_CALM_EASE },
        default: APPLE_DOCK_SPRING,
      },
    },
    exit: () => {
      if (dockWasCollapsedIntoOrbRef.current) {
        const { dx, dy } = dockCollapseDeltaRef.current;
        const flyDuration = dockCollapseFlightSecRef.current || 0.32;
        return {
          x: dx,
          y: dy,
          scale: 1,
          opacity: 1,
          transition: {
            x: { duration: flyDuration, ease: APPLE_CALM_EASE },
            y: { duration: flyDuration, ease: APPLE_CALM_EASE },
            scale: { duration: flyDuration, ease: APPLE_CALM_EASE },
          },
        };
      }
      return {
        opacity: 0,
        scale: 0.92,
        y: 8,
        transition: { duration: 0.24, ease: APPLE_CALM_EASE },
      };
    },
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <MotionConfig reducedMotion="user">
      <div
        ref={portalRef}
        className="audio-dock-portal"
        data-annotation-ui="true"
        dir="rtl"
      >
        {/* Magnetic Bottom-Left & Bottom-Right Shortcut Corner Ring During Drag */}
        <AnimatePresence>
          {activeCornerMagnet && cornerMagnetCoords && (
            <motion.div
              key={`audio-corner-magnet-${activeCornerMagnet}`}
              className="apple-corner-magnet-ring"
              aria-hidden="true"
              initial={{ opacity: 0, scale: 1.24 }}
              animate={{ opacity: 1, scale: 1, transition: APPLE_ORB_SPRING }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18, ease: APPLE_EXIT_EASE } }}
              style={{
                left: `${Math.round(cornerMagnetCoords.left)}px`,
                top: `${Math.round(cornerMagnetCoords.top)}px`,
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence
          onExitComplete={() => {
            if (!isExpandedRef.current) {
              dockWasCollapsedIntoOrbRef.current = false;
              dockCollapseHandedOffRef.current = false;
              frozenExitLayoutRef.current = null;
              if (orbLauncherOpacity.get() < 1) {
                orbLauncherOpacity.set(1);
              }
              if (orbBtnRef.current) {
                orbBtnRef.current.style.opacity = '1';
              }
            }
          }}
        >
          {!isExpanded ? (
            <motion.div
              key="audio-orb"
              className="audio-orb-anchor"
              initial={false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0, ease: 'linear' } }}
              style={{
                left: 0,
                top: 0,
                x: orbX,
                y: orbY,
                pointerEvents: isExpanded ? 'none' : undefined,
              }}
            >
              <motion.button
                ref={orbBtnRef}
                type="button"
                className={`audio-orb-btn ${isPlaying ? 'is-playing' : ''} ${
                  isLoading ? 'is-loading' : ''
                } ${isOrbDragging ? 'is-dragging' : ''} ${
                  orbDragTarget ? 'is-orb-primed' : ''
                }`}
                initial={false}
                animate={{
                  scale: orbDragTarget ? 1.1 : isOrbDragging ? 1.05 : 1,
                }}
                transition={APPLE_ORB_SPRING}
                style={{ opacity: orbLauncherOpacity }}
                onPointerDown={handleOrbPointerDown}
                onClick={(e) => {
                  if (e.detail === 0) {
                    openDockFromOrb();
                  }
                }}
                title={
                  isPlaying && audioTarget && activeSurahMeta
                    ? `تلاوة سورة ${activeSurahMeta.name} · آية ${toArabicDigits(audioTarget.ayahNum)} — اضغط للتحكم`
                    : 'فتح نافذة التحكم في التلاوة الصوتية'
                }
                aria-label="فتح نافذة التحكم في التلاوة الصوتية"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin audio-orb-spinner" aria-hidden="true" />
                ) : isPlaying ? (
                  <span className="audio-orb-eq" aria-hidden="true">
                    <span className="audio-orb-eq-bar" />
                    <span className="audio-orb-eq-bar" />
                    <span className="audio-orb-eq-bar" />
                  </span>
                ) : (
                  <Volume2 className="w-[22px] h-[22px]" strokeWidth={2} aria-hidden="true" />
                )}
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="audio-dock"
              ref={dockAnchorRef}
              className={`audio-dock-anchor ${isDockDragging ? 'is-dragging' : ''} ${
                effSplitActive ? 'is-split-stage' : ''
              } ${isSideBySideSplit ? 'is-side-split' : ''} ${
                isCompactSplit ? 'is-compact-split' : ''
              } ${dockDropCorner ? 'is-edge-primed' : ''}`}
              variants={dockAnchorExitVariants}
              exit="exit"
              style={
                {
                  left: 0,
                  top: 0,
                  x: dockX,
                  y: dockY,
                  scale: dockScale,
                  pointerEvents: isExpanded ? 'auto' : 'none',
                  maxWidth:
                    effMaxWidth !== null ? `${effMaxWidth}px` : 'calc(100vw - 16px)',
                  ...(effMaxWidth !== null
                    ? { '--split-dock-max-w': `${effMaxWidth}px` }
                    : {}),
                } as React.ComponentProps<typeof motion.div>['style'] & {
                  '--split-dock-max-w'?: string;
                }
              }
              onPointerDown={handleDockPointerDown}
              onClickCapture={(e) => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              <motion.div
                ref={dockMotionShellRef}
                className="audio-dock-motion-shell"
                variants={dockMotionShellVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onAnimationComplete={(definition) => {
                  if (definition !== 'exit') return;
                  if (
                    !isExpandedRef.current &&
                    dockWasCollapsedIntoOrbRef.current &&
                    !dockCollapseHandedOffRef.current
                  ) {
                    dockCollapseHandedOffRef.current = true;
                    orbLauncherOpacity.set(1);
                    if (orbBtnRef.current) {
                      orbBtnRef.current.style.opacity = '1';
                    }
                    if (dockMotionShellRef.current) {
                      dockMotionShellRef.current.style.opacity = '0';
                    }
                  }
                }}
              >
                {/* Upward Quick Audio Settings Popover */}
                <AnimatePresence>
                  {isSettingsOpen && (
                    <motion.div
                      ref={popoverRef}
                      className="audio-dock-popover"
                      role="dialog"
                      aria-label="ضبط التلاوة الصوتية"
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1, transition: APPLE_POPOVER_SPRING }}
                      exit={{
                        opacity: 0,
                        y: 6,
                        scale: 0.98,
                        transition: { duration: 0.18, ease: APPLE_EXIT_EASE },
                      }}
                    >
                      <div className="audio-dock-popover-head">
                        <span className="audio-dock-popover-title">ضبط التلاوة</span>
                        <span className="audio-dock-popover-sub">
                          {currentReciterShort}
                          {audioTarget && activeSurahMeta
                            ? ` · ${activeSurahMeta.name} (${toArabicDigits(audioTarget.ayahNum)})`
                            : fallbackSurahMeta
                            ? ` · ${fallbackSurahMeta.name}`
                            : ''}
                          {repeat > 1 && isPlaying
                            ? ` · تكرار ${toArabicDigits(repeatProgress)}/${toArabicDigits(repeat)}`
                            : ''}
                        </span>
                      </div>

                      <div className="audio-dock-popover-section">
                        <span className="audio-dock-popover-label">نطاق التلاوة</span>
                        <div className="audio-dock-popover-pills">
                          <button
                            type="button"
                            className={`audio-dock-pop-btn ${sessionTotal === 1 ? 'is-active' : ''}`}
                            onClick={() => handleApplyQuickScope('single')}
                          >
                            آية واحدة
                          </button>
                          <button
                            type="button"
                            className="audio-dock-pop-btn"
                            onClick={() => handleApplyQuickScope('page')}
                          >
                            هذه الصفحة
                          </button>
                          <button
                            type="button"
                            className="audio-dock-pop-btn"
                            onClick={() => handleApplyQuickScope('jozz')}
                          >
                            هذا الجزء
                          </button>
                          <button
                            type="button"
                            className="audio-dock-pop-btn"
                            onClick={() => handleApplyQuickScope('surah')}
                          >
                            السورة كاملة
                          </button>
                          <button
                            type="button"
                            className={`audio-dock-pop-btn ${sessionTotal === 0 ? 'is-active' : ''}`}
                            onClick={() => handleApplyQuickScope('continuous')}
                          >
                            متصل
                          </button>
                        </div>
                      </div>

                      <div className="audio-dock-popover-row-grid">
                        <div className="audio-dock-popover-section">
                          <span className="audio-dock-popover-label">تكرار الآية</span>
                          <div className="audio-dock-popover-pills">
                            {AYAH_REPEAT_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                className={`audio-dock-pop-btn is-num ${repeat === opt ? 'is-active' : ''}`}
                                onClick={() => onSetRepeat(opt)}
                              >
                                {opt === 0 ? '∞' : `${toArabicDigits(opt)}×`}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="audio-dock-popover-section">
                          <span className="audio-dock-popover-label">السرعة</span>
                          <div className="audio-dock-popover-pills">
                            {PLAYBACK_RATE_OPTIONS.map((rOpt) => (
                              <button
                                key={rOpt}
                                type="button"
                                className={`audio-dock-pop-btn is-num ${rate === rOpt ? 'is-active' : ''}`}
                                onClick={() => onSetRate(rOpt)}
                              >
                                {toArabicDigits(rOpt)}×
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="audio-dock-popover-section">
                          <span className="audio-dock-popover-label">سكتة الترديد بعد كل آية</span>
                          <div className="audio-dock-popover-pills">
                            {AUDIO_PAUSE_GAP_OPTIONS.map((gOpt) => (
                              <button
                                key={gOpt.id}
                                type="button"
                                className={`audio-dock-pop-btn ${pauseGap === gOpt.id ? 'is-active' : ''}`}
                                onClick={() => onSetPauseGap(gOpt.id)}
                              >
                                {gOpt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="audio-dock-popover-toggles">
                        <div className="apple-inspector-toggle-row">
                          <span className="apple-toggle-title">تتبّع الصفحة تلقائياً</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={autoFollow}
                            className={`apple-switch ${autoFollow ? 'is-on' : ''}`}
                            onClick={() => onSetAutoFollow(!autoFollow)}
                          >
                            <span className="apple-switch-knob" />
                          </button>
                        </div>

                        <div className="apple-inspector-toggle-row">
                          <span className="apple-toggle-title">إيقاف عند نهاية الصفحة الحالية</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={stopAtPageEnd}
                            className={`apple-switch ${stopAtPageEnd ? 'is-on' : ''}`}
                            onClick={() => onSetStopAtPageEnd(!stopAtPageEnd)}
                          >
                            <span className="apple-switch-knob" />
                          </button>
                        </div>

                        {sessionTotal > 1 && (
                          <div className="apple-inspector-toggle-row">
                            <span className="apple-toggle-title">تكرار المقطع كاملاً</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={repeatSection}
                              className={`apple-switch ${repeatSection ? 'is-on' : ''}`}
                              onClick={() => onSetRepeatSection(!repeatSection)}
                            >
                              <span className="apple-switch-knob" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="audio-dock-popover-footer">
                        <button
                          type="button"
                          className="audio-dock-custom-range-btn"
                          onClick={() => {
                            setIsSettingsOpen(false);
                            onOpenCustomModal(activeReferenceTarget);
                          }}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>تحديد نطاق مخصص...</span>
                        </button>

                        {canStop && (
                          <button
                            type="button"
                            className="audio-dock-end-btn"
                            onClick={() => {
                              setIsSettingsOpen(false);
                              onStopPlayback();
                            }}
                            title="إيقاف التلاوة وإلغاء التحديد"
                          >
                            <Square className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true" />
                            <span>إنهاء التلاوة</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main Fixed-Width 3-Zone Frosted Ceramic Audio Dock */}
                <motion.div
                  className="audio-dock-outer"
                  style={{ clipPath: dockClipPath }}
                >
                  <motion.div
                    ref={dockShellRef}
                    className="audio-dock-shell"
                    role="region"
                    aria-label="نافذة التحكم في التلاوة الصوتية"
                  >
                  <motion.div
                    ref={dockContentRef}
                    className="audio-dock-content"
                    style={{
                      opacity: dockContentOpacity,
                      scale: dockContentScale,
                    }}
                  >
                    {/* Zone 1 (Right in RTL): Active Ayah Readout + Passage Scope */}
                    <div className="audio-dock-zone-context">
                      <button
                        type="button"
                        className={`audio-dock-now-btn ${audioError ? 'is-error' : ''}`}
                        onClick={onJumpToPlayingAyah}
                        disabled={!audioTarget}
                        title={
                          audioError
                            ? audioError
                            : audioTarget
                            ? `الانتقال إلى سورة ${activeSurahMeta?.name ?? ''} · الآية ${toArabicDigits(audioTarget.ayahNum)}`
                            : 'اختر آية للبدء'
                        }
                      >
                        {audioError ? (
                          <span className="audio-dock-now-error">{audioError}</span>
                        ) : audioTarget ? (
                          <>
                            <span className="audio-dock-now-surah">
                              {activeSurahMeta?.name ?? ''}
                            </span>
                            <span className="audio-dock-now-sep" aria-hidden="true">·</span>
                            <span className="audio-dock-now-ayah">
                              {isTightCompactSplit
                                ? toArabicDigits(audioTarget.ayahNum)
                                : `الآية ${toArabicDigits(audioTarget.ayahNum)}`}
                            </span>
                            {isPauseGapWaiting && !isTightCompactSplit && (
                              <span className="audio-dock-now-wait">ترديد...</span>
                            )}
                          </>
                        ) : (
                          <span className="audio-dock-now-idle">
                            {isTightCompactSplit ? 'اختر آية' : 'اختر آية للتلاوة'}
                          </span>
                        )}
                      </button>

                      {!isTightCompactSplit && (
                        <button
                          type="button"
                          className={`audio-dock-scope-btn ${sessionTotal > 0 ? 'is-active' : ''}`}
                          onClick={() => onOpenCustomModal(activeReferenceTarget)}
                          title="تحديد نطاق المقطع للتلاوة"
                          aria-label="تحديد نطاق المقطع للتلاوة"
                        >
                          <span className="audio-dock-scope-label">
                            {sessionTotal === 0
                              ? 'متصل'
                              : sessionTotal === 1
                              ? 'آية'
                              : `${toArabicDigits(sessionIndex)}/${toArabicDigits(sessionTotal)}`}
                          </span>
                          {sessionTotal > 1 && sessionRepeatSection && (
                            <Repeat className="w-3 h-3 shrink-0 opacity-85" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="apple-dock-divider" aria-hidden="true" />

                    {/* Zone 2 (Center): Focused Prev / Play-Pause / Next Transport */}
                    <div className="audio-dock-transport" role="group" aria-label="أزرار تشغيل التلاوة">
                      <button
                        type="button"
                        className="audio-dock-step-btn"
                        onClick={() => onStepAyah(-1)}
                        disabled={isPrevDisabled}
                        title="الآية السابقة"
                        aria-label="الآية السابقة"
                      >
                        <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                      </button>

                      <button
                        type="button"
                        className={`audio-dock-play-btn ${isPlaying ? 'is-playing' : ''}`}
                        onClick={onTogglePlay}
                        title={isPlaying ? 'إيقاف مؤقت (مسافة)' : 'تشغيل التلاوة (مسافة)'}
                        aria-label={isPlaying ? 'إيقاف التلاوة مؤقتاً' : 'تشغيل التلاوة'}
                      >
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : isPlaying ? (
                          <Pause className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Play className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        className="audio-dock-step-btn"
                        onClick={() => onStepAyah(1)}
                        disabled={isNextDisabled}
                        title="الآية التالية"
                        aria-label="الآية التالية"
                      >
                        <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
                      </button>
                    </div>

                    <div className="apple-dock-divider" aria-hidden="true" />

                    {/* Zone 3 (Left in RTL): Fixed-width Reciter, Unified Settings, Split Swap, Minimize */}
                    <div className="audio-dock-actions">
                      <div className="audio-dock-reciter-wrap">
                        <select
                          className="audio-dock-reciter-select"
                          value={reciterId}
                          onChange={(e) => onChangeReciter(e.target.value as ReciterId)}
                          aria-label="اختيار القارئ"
                          title="اختيار القارئ"
                        >
                          {QURAN_RECITERS.map((r) => (
                            <option key={r.id} value={r.id}>
                              {isTightCompactSplit ? r.shortName : r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        className={`audio-dock-icon-btn ${
                          isSettingsOpen ? 'is-active-utility' : ''
                        } ${hasCustomSettings ? 'has-custom' : ''}`}
                        aria-expanded={isSettingsOpen}
                        aria-haspopup="dialog"
                        onClick={() => setIsSettingsOpen((prev) => !prev)}
                        title="ضبط نطاق التلاوة والسرعة والتكرار وسكتة الترديد"
                        aria-label="ضبط التلاوة"
                      >
                        <SlidersHorizontal className="w-4 h-4" strokeWidth={1.9} aria-hidden="true" />
                      </button>

                      {isSideBySideSplit && (
                        <button
                          type="button"
                          className="audio-dock-icon-btn"
                          onClick={() =>
                            setBottomDockSplitOrder(
                              coordinatorState.splitOrder === 'pens-left' ? 'audio-left' : 'pens-left'
                            )
                          }
                          title="تبديل جهة الصوت والأقلام (يمين / شمال)"
                          aria-label="تبديل جهة الصوت والأقلام"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" strokeWidth={1.9} aria-hidden="true" />
                        </button>
                      )}

                      <button
                        type="button"
                        className="audio-dock-icon-btn is-collapse"
                        onClick={() => {
                          collapseDockToCornerOrb({
                            targetSide: orbSideRef.current,
                          });
                        }}
                        title="طيّ نافذة الصوت إلى الكرة (تستمر التلاوة في الخلفية)"
                        aria-label="طيّ نافذة الصوت"
                      >
                        <ChevronDown className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </motion.div>

                    {/* 2px GPU Edge Progress Track & Click-to-Seek */}
                    <div
                      ref={progressTrackRef}
                      className={`audio-dock-progress-track ${
                        audioTarget && !isPauseGapWaiting ? 'is-seekable' : ''
                      }`}
                      onClick={handleSeekClick}
                      title="شريط تقدم الآية — اضغط للتقديم أو الترجيع"
                    >
                      <div ref={progressFillRef} className="audio-dock-progress-fill" />
                    </div>
                  </motion.div>
                </motion.div>

                {/* In-place morphed 58x58 orb emerging directly from the condensing audio bar */}
                <motion.div
                  className={`audio-dock-orb-shell ${isPlaying ? 'is-playing' : ''}`}
                  aria-hidden="true"
                  style={{
                    x: dockOrbShellX,
                    y: dockOrbShellY,
                    opacity: dockOrbCoreOpacity,
                  }}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin audio-orb-spinner" aria-hidden="true" />
                  ) : isPlaying ? (
                    <span className="audio-orb-eq" aria-hidden="true">
                      <span className="audio-orb-eq-bar" />
                      <span className="audio-orb-eq-bar" />
                      <span className="audio-orb-eq-bar" />
                    </span>
                  ) : (
                    <Volume2 className="w-[22px] h-[22px]" strokeWidth={2} aria-hidden="true" />
                  )}
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>,
    document.body
  );
};
