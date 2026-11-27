import { useSyncExternalStore } from 'react';

export type DockCornerSide = 'left' | 'right';
export type BottomSplitOrder = 'pens-left' | 'audio-left';

export interface BottomDockParticipant {
  mounted: boolean;
  expanded: boolean;
  width: number;
  height: number;
  orbSide: DockCornerSide;
}

export interface BottomDockCoordinatorState {
  pen: BottomDockParticipant;
  audio: BottomDockParticipant;
  splitOrder: BottomSplitOrder;
}

export interface BottomDockLayoutSolution {
  isSplitActive: boolean;
  isSideBySide: boolean;
  isCompactSplit: boolean;
  isStacked: boolean;
  splitOrder: BottomSplitOrder;
  penMaxWidth: number | null;
  audioMaxWidth: number | null;
  penRestLeft: number;
  penRestTop: number;
  audioRestLeft: number;
  audioRestTop: number;
  penOrbBottomOffset: number;
  audioOrbBottomOffset: number;
}

const SPLIT_ORDER_STORAGE_KEY = 'safara:bottom_dock_split_order_v1';

function loadInitialSplitOrder(): BottomSplitOrder {
  if (typeof window === 'undefined') return 'pens-left';
  try {
    const raw = window.localStorage.getItem(SPLIT_ORDER_STORAGE_KEY);
    if (raw === 'audio-left' || raw === 'pens-left') return raw;
  } catch {
    // Ignore storage read restrictions
  }
  return 'pens-left';
}

let state: BottomDockCoordinatorState = {
  pen: {
    mounted: false,
    expanded: false,
    width: 660,
    height: 68,
    orbSide: 'left',
  },
  audio: {
    mounted: false,
    expanded: false,
    width: 660,
    height: 68,
    orbSide: 'right',
  },
  splitOrder: loadInitialSplitOrder(),
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BottomDockCoordinatorState {
  return state;
}

function areParticipantsEqual(a: BottomDockParticipant, b: BottomDockParticipant): boolean {
  return (
    a.mounted === b.mounted &&
    a.expanded === b.expanded &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1 &&
    a.orbSide === b.orbSide
  );
}

export function updatePenDockState(patch: Partial<BottomDockParticipant>): void {
  const nextPen: BottomDockParticipant = { ...state.pen, ...patch };
  if (areParticipantsEqual(state.pen, nextPen)) return;
  state = { ...state, pen: nextPen };
  notifyListeners();
}

export function updateAudioDockState(patch: Partial<BottomDockParticipant>): void {
  const nextAudio: BottomDockParticipant = { ...state.audio, ...patch };
  if (areParticipantsEqual(state.audio, nextAudio)) return;
  state = { ...state, audio: nextAudio };
  notifyListeners();
}

export function setBottomDockSplitOrder(order: BottomSplitOrder): void {
  if (state.splitOrder === order) return;
  state = { ...state, splitOrder: order };
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SPLIT_ORDER_STORAGE_KEY, order);
    }
  } catch {
    // Ignore storage write errors
  }
  notifyListeners();
}

export function getBottomDockState(): BottomDockCoordinatorState {
  return state;
}

export function solveBottomDockLayout(
  vw: number,
  vh: number,
  current: BottomDockCoordinatorState = state
): BottomDockLayoutSolution {
  const bottomMargin = vh < 480 ? 8 : 22;
  const edge = vw < 640 ? 8 : 14;
  const orbSize = vw <= 640 || vh <= 480 ? 52 : 58;
  const orbMarginX = vw <= 640 || vh <= 480 ? 16 : 32;

  const penActive = current.pen.mounted && current.pen.expanded;
  const audioActive = current.audio.mounted && current.audio.expanded;

  const penNaturalW = Math.max(220, current.pen.width || 660);
  const penNaturalH = Math.max(48, current.pen.height || 68);
  const audioNaturalW = Math.max(220, current.audio.width || 660);
  const audioNaturalH = Math.max(48, current.audio.height || 68);

  const singleAvailW = Math.max(220, vw - edge * 2);
  const singlePenW = Math.min(penNaturalW, singleAvailW);
  const singlePenH = Math.min(penNaturalH, Math.max(48, vh - 16));
  const singleAudioW = Math.min(audioNaturalW, singleAvailW);
  const singleAudioH = Math.min(audioNaturalH, Math.max(48, vh - 16));

  let isSplitActive = false;
  let isSideBySide = false;
  let isCompactSplit = false;
  let isStacked = false;
  let penMaxWidth: number | null = null;
  let audioMaxWidth: number | null = null;
  let penRestLeft = Math.max(
    edge,
    Math.min(Math.max(edge, vw - singlePenW - edge), vw * 0.5 - singlePenW * 0.5)
  );
  let penRestTop = Math.max(8, vh - bottomMargin - singlePenH);
  let audioRestLeft = Math.max(
    edge,
    Math.min(Math.max(edge, vw - singleAudioW - edge), vw * 0.5 - singleAudioW * 0.5)
  );
  let audioRestTop = Math.max(8, vh - bottomMargin - singleAudioH);
  let penOrbBottomOffset = 0;
  let audioOrbBottomOffset = 0;

  if (penActive && audioActive) {
    isSplitActive = true;
    if (vw >= 1020) {
      isSideBySide = true;
      const splitGap = vw >= 1280 ? 14 : 10;
      const usableW = Math.max(320, vw - edge * 2 - splitGap);
      const sharedSlotW = Math.min(720, Math.max(320, Math.floor(usableW * 0.5)));

      isCompactSplit = sharedSlotW < 700;
      penMaxWidth = sharedSlotW;
      audioMaxWidth = sharedSlotW;
      const effPenW = sharedSlotW;
      const effAudioW = sharedSlotW;

      const sharedH = isCompactSplit ? 64 : 68;
      const effPenH = sharedH;
      const effAudioH = sharedH;
      const totalW = effPenW + splitGap + effAudioW;
      const groupLeft = Math.max(edge, (vw - totalW) * 0.5);

      if (current.splitOrder === 'pens-left') {
        penRestLeft = groupLeft;
        audioRestLeft = Math.min(
          Math.max(edge, vw - effAudioW - edge),
          groupLeft + effPenW + splitGap
        );
      } else {
        audioRestLeft = groupLeft;
        penRestLeft = Math.min(
          Math.max(edge, vw - effPenW - edge),
          groupLeft + effAudioW + splitGap
        );
      }
      penRestTop = Math.max(8, vh - bottomMargin - effPenH);
      audioRestTop = Math.max(8, vh - bottomMargin - effAudioH);
    } else {
      isStacked = true;
      const stackGap = 10;
      penMaxWidth = singleAvailW;
      audioMaxWidth = singleAvailW;
      penRestLeft = Math.max(
        edge,
        Math.min(Math.max(edge, vw - singlePenW - edge), vw * 0.5 - singlePenW * 0.5)
      );
      penRestTop = Math.max(8, vh - bottomMargin - singlePenH);
      audioRestLeft = Math.max(
        edge,
        Math.min(Math.max(edge, vw - singleAudioW - edge), vw * 0.5 - singleAudioW * 0.5)
      );
      audioRestTop = Math.max(8, penRestTop - stackGap - singleAudioH);
    }
  } else if (penActive) {
    if (current.audio.mounted) {
      const orbLeft =
        current.audio.orbSide === 'right' ? vw - orbSize - orbMarginX : orbMarginX;
      const orbRight = orbLeft + orbSize;
      const penRight = penRestLeft + singlePenW;
      const overlaps =
        current.audio.orbSide === 'right'
          ? penRight + 10 > orbLeft
          : penRestLeft - 10 < orbRight;
      if (overlaps) {
        audioOrbBottomOffset = singlePenH + 10;
      }
    }
  } else if (audioActive) {
    if (current.pen.mounted) {
      const orbLeft =
        current.pen.orbSide === 'right' ? vw - orbSize - orbMarginX : orbMarginX;
      const orbRight = orbLeft + orbSize;
      const audioRight = audioRestLeft + singleAudioW;
      const overlaps =
        current.pen.orbSide === 'right'
          ? audioRight + 10 > orbLeft
          : audioRestLeft - 10 < orbRight;
      if (overlaps) {
        penOrbBottomOffset = singleAudioH + 10;
      }
    }
  } else if (current.pen.mounted && current.audio.mounted) {
    if (current.pen.orbSide === current.audio.orbSide) {
      audioOrbBottomOffset = orbSize + 12;
    }
  }

  return {
    isSplitActive,
    isSideBySide,
    isCompactSplit,
    isStacked,
    splitOrder: current.splitOrder,
    penMaxWidth,
    audioMaxWidth,
    penRestLeft,
    penRestTop,
    audioRestLeft,
    audioRestTop,
    penOrbBottomOffset,
    audioOrbBottomOffset,
  };
}

export function computeBottomDockOverlayClearance(
  vw: number,
  vh: number,
  sheetMaxWidth = 660,
  current: BottomDockCoordinatorState = state
): number {
  const sol = solveBottomDockLayout(vw, vh, current);
  const penExpanded = current.pen.mounted && current.pen.expanded;
  const audioExpanded = current.audio.mounted && current.audio.expanded;

  let maxOccupiedBottom = 0;

  if (penExpanded || audioExpanded) {
    let highestExpandedTop = vh;
    if (penExpanded) {
      highestExpandedTop = Math.min(highestExpandedTop, sol.penRestTop);
    }
    if (audioExpanded) {
      highestExpandedTop = Math.min(highestExpandedTop, sol.audioRestTop);
    }
    maxOccupiedBottom = Math.max(maxOccupiedBottom, vh - highestExpandedTop);
  }

  // Also check any collapsed corner orb that horizontally overlaps the centered overlay
  const isNarrow = vw <= 640 || vh <= 480;
  const orbSize = isNarrow ? 52 : 58;
  const orbMarginX = isNarrow ? 16 : 32;
  const orbBottomMargin = isNarrow ? 16 : 26;
  const sidePad = vw <= 640 ? 8 : Math.min(24, Math.max(12, vw * 0.025));
  const actualSheetW = Math.min(sheetMaxWidth, Math.max(0, vw - sidePad * 2));
  const sheetLeft = (vw - actualSheetW) * 0.5;
  const sheetRight = sheetLeft + actualSheetW;

  if (current.pen.mounted && !penExpanded) {
    const orbLeft = current.pen.orbSide === 'right' ? vw - orbSize - orbMarginX : orbMarginX;
    const orbRight = orbLeft + orbSize;
    if (orbRight + 6 > sheetLeft && orbLeft - 6 < sheetRight) {
      maxOccupiedBottom = Math.max(
        maxOccupiedBottom,
        orbBottomMargin + sol.penOrbBottomOffset + orbSize
      );
    }
  }

  if (current.audio.mounted && !audioExpanded) {
    const orbLeft = current.audio.orbSide === 'right' ? vw - orbSize - orbMarginX : orbMarginX;
    const orbRight = orbLeft + orbSize;
    if (orbRight + 6 > sheetLeft && orbLeft - 6 < sheetRight) {
      maxOccupiedBottom = Math.max(
        maxOccupiedBottom,
        orbBottomMargin + sol.audioOrbBottomOffset + orbSize
      );
    }
  }

  if (maxOccupiedBottom <= 0) return 0;
  const gap = vh < 520 ? 10 : 14;
  return Math.min(Math.round(maxOccupiedBottom + gap), Math.max(0, vh - 240));
}

export function useBottomDockCoordinatorState(): BottomDockCoordinatorState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
