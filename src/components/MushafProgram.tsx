import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  BookMarked,
  BookOpen,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  ClipboardPlus,
  Compass,
  Eye,
  EyeOff,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ScanEye,
  Search,
  SlidersHorizontal,
  SunMedium,
  User,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MushafSearchModal } from './MushafSearchModal';
import { MushafIndexModal } from './MushafIndexModal';
import { TafsirModal, type TafsirAyahTarget } from './TafsirModal';
import {
  AudioControlModal,
  type AudioControlApplyPayload,
  type AudioControlTarget,
} from './AudioControlModal';
import { FloatingAudioDock } from './FloatingAudioDock';
import {
  AyahRosette,
  AyahRosetteSymbolDefs,
  getSharedHafsMeasureProbe,
  MushafLineRow,
  type MushafLetterUnit,
  type MushafLineItem,
} from './MushafLineRow';
import {
  AnnotationSurface,
  useAnnotationActions,
  useAnnotationToolState,
  type MushafExportSurahOption,
} from './annotation';
import type { AnnotationShape, AnnotationStroke } from './annotation/types';
import { analyzeWordTajweed, TAJWEED_COLORS, TAJWEED_LEGEND } from '../utils/tajweedRules';
import {
  findMushafPageForAyah,
  getAyahAudioUrl,
  getNextQuranAyah,
  getPrevQuranAyah,
  loadSavedAudioAutoFollow,
  loadSavedAudioPauseGap,
  loadSavedAyahCount,
  loadSavedAyahRepeat,
  loadSavedPlaybackRate,
  loadSavedReciterId,
  loadSavedSectionRepeat,
  loadSavedStopAtPageEnd,
  preloadAyahAudio,
  QURAN_RECITERS,
  saveAudioAutoFollow,
  saveAudioPauseGap,
  saveAyahCount,
  saveAyahRepeat,
  savePlaybackRate,
  saveReciterId,
  saveSectionRepeat,
  saveStopAtPageEnd,
  type AudioPauseGap,
  type AyahRepeatOption,
  type PlaybackRateOption,
  type ReciterId,
} from '../utils/quranAudio';
import {
  DIACRITIC_RE,
  INITIAL_MUSHAF_SURAHS,
  TOTAL_MUSHAF_PAGES,
  toArabicDigits,
  tokenizeMushafText,
  type MushafDataset,
  type MushafRawPage,
  type MushafSurahMeta,
  type TokenizedMushafPage,
  type TokenizedMushafRow,
} from '../utils/mushafData';
import { extractAyahTextFromDataset } from '../utils/tafsirData';
import { captureMushafAyahVisual } from './reports/captureMushafAyah';
import {
  clearPendingMushafJump,
  upsertCapturedAyahMistake,
  useSessionReport,
} from './reports/reportStore';
import {
  getOrBuildQuranIndex,
  type QuranSearchResult,
} from '../utils/quranIndexData';
import {
  addOrUpdateMushafBookmark,
  BOOKMARK_KIND_LABELS,
  removeMushafBookmark,
  useMushafBookmarks,
  type MushafBookmark,
  type MushafBookmarkKind,
} from './students/mushafBookmarksStore';
import { useStudentProfiles } from './students/studentStore';

export interface MushafPracticeConfig {
  targetLetters: string[];
  targetLabel: string;
  hitMessage?: string;
  missMessage?: string;
  completeSingleMessage?: string;
  onPracticeComplete?: () => void;
}

export interface MushafProgramProps {
  variant?: 'standalone' | 'embedded';
  initialPage?: number;
  initialTajweed?: boolean;
  isPresentationMode?: boolean;
  onTogglePresentationMode?: () => void;
  practiceConfig?: MushafPracticeConfig;
  onPlayChime?: (success: boolean) => void;
  onTriggerConfetti?: () => void;
  onOpenReports?: () => void;
}

const MUSHAF_BASE_SCALE = 1.3;
const MUSHAF_ZOOM_STEPS = [0.75, 0.85, 1, 1.15, 1.3] as const;
const MUSHAF_ZOOM_PRESETS: Record<
  (typeof MUSHAF_ZOOM_STEPS)[number],
  { capPx: number; slotPct: number; mobilePct: number }
> = {
  0.75: { capPx: 960, slotPct: 68, mobilePct: 82 },
  0.85: { capPx: 1120, slotPct: 77, mobilePct: 89 },
  1: { capPx: 1300, slotPct: 86, mobilePct: 95 },
  1.15: { capPx: 1460, slotPct: 93, mobilePct: 98 },
  1.3: { capPx: 1620, slotPct: 100, mobilePct: 100 },
};
const PAPER_THEME_STORAGE_KEY = 'talakah_mushaf_paper_theme_v1';

type MushafPaperTheme = 'cream' | 'white' | 'sepia' | 'night';

const MUSHAF_PAPER_THEME_OPTIONS: Array<{
  id: MushafPaperTheme;
  label: string;
  swatch: string;
  ink: string;
}> = [
  { id: 'cream', label: 'كريمي أصلي', swatch: '#FCF8EE', ink: '#0B1F5E' },
  { id: 'white', label: 'أبيض نقي', swatch: '#FFFFFF', ink: '#0F172A' },
  { id: 'sepia', label: 'بيج هادئ', swatch: '#F2E7CF', ink: '#3B2B1B' },
  { id: 'night', label: 'ليلي مريح', swatch: '#131C31', ink: '#E2E8F0' },
];

function loadSavedPaperTheme(): MushafPaperTheme {
  if (typeof window === 'undefined') return 'cream';
  try {
    const raw = window.localStorage.getItem(PAPER_THEME_STORAGE_KEY);
    if (raw === 'cream' || raw === 'white' || raw === 'sepia' || raw === 'night') {
      return raw;
    }
  } catch {
    // Ignore storage issues
  }
  return 'cream';
}

// Module-level caches for instant re-entry, zero-stall page flipping, and cached font shaping widths
let cachedMushafDataset: MushafDataset | null = null;
let cachedMushafDatasetPromise: Promise<MushafDataset | null> | null = null;

function loadMushafDatasetCached(): Promise<MushafDataset | null> {
  if (cachedMushafDataset) return Promise.resolve(cachedMushafDataset);
  if (!cachedMushafDatasetPromise) {
    cachedMushafDatasetPromise = fetch('/data/mushaf_pages_v18.json')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load Mushaf dataset'))))
      .then((data: MushafDataset) => {
        if (
          data &&
          Array.isArray(data.surahs) &&
          Array.isArray(data.pages) &&
          data.pages.length === TOTAL_MUSHAF_PAGES
        ) {
          cachedMushafDataset = data;
          return data;
        }
        return null;
      })
      .catch(() => {
        cachedMushafDatasetPromise = null;
        return null;
      });
  }
  return cachedMushafDatasetPromise;
}

const MAX_TOKENIZED_PAGE_CACHE = 120;
const tokenizedPageCache = new Map<string, TokenizedMushafPage>();

const MAX_PROBE_WORD_CACHE = 6000;
const probeWordWidthCache = new Map<string, number>();

const MAX_UNIFORM_FS_CACHE = 800;
const uniformFontSizeCache = new Map<string, number>();

function computeAndCacheUniformFontSize(
  pageData: TokenizedMushafPage,
  pageNum: number,
  availableWidth: number,
  bodyHeight: number,
  fontsReadyTick: number
): number {
  const isOpeningSpread = pageNum <= 2;
  const rowCount = isOpeningSpread ? 8 : 15;
  const rowHeight = bodyHeight > 0 ? bodyHeight / rowCount : 0;
  const fsCacheKey = `${pageNum}:${Math.round(availableWidth)}:${Math.round(rowHeight)}:${fontsReadyTick}`;

  if (fontsReadyTick > 0) {
    const cachedSize = uniformFontSizeCache.get(fsCacheKey);
    if (cachedSize !== undefined) {
      return cachedSize;
    }
  }

  const REF_FONT_PX = 40;
  const canUseWordCache = fontsReadyTick > 0;
  const probeEl = getSharedHafsMeasureProbe(REF_FONT_PX);

  const measureTextAtRef = (text: string): number => {
    if (canUseWordCache) {
      const hit = probeWordWidthCache.get(text);
      if (hit !== undefined) return hit;
    }
    if (!probeEl) return 0;
    probeEl.textContent = text;
    const w = probeEl.getBoundingClientRect().width;
    if (canUseWordCache && w > 0) {
      if (probeWordWidthCache.size >= MAX_PROBE_WORD_CACHE) {
        const oldest = probeWordWidthCache.keys().next().value;
        if (oldest !== undefined) probeWordWidthCache.delete(oldest);
      }
      probeWordWidthCache.set(text, w);
    }
    return w;
  };

  let minRowFit = Number.POSITIVE_INFINITY;

  for (const row of pageData.rows) {
    if (row.kind === 'basmalah') {
      const basmalahW = measureTextAtRef('بِسۡ\u0640\u0640\u0640مِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِي\u0640\u0640\u0640مِ');
      if (basmalahW > 0) {
        minRowFit = Math.min(minRowFit, REF_FONT_PX * (availableWidth / basmalahW));
      }
      continue;
    }

    if (row.kind !== 'text' || row.items.length === 0) continue;

    let scalableW = 0;
    let fixedW = 0;

    for (const item of row.items) {
      if (item.kind === 'rosette') {
        scalableW += REF_FONT_PX * 0.88;
        continue;
      }

      let wordText = '';
      let leadingSymbols = '';
      let trailingSymbols = '';
      let seenLetter = false;
      for (const token of item.tokens) {
        if (token.type === 'symbol') {
          if (!seenLetter) {
            leadingSymbols += token.base + token.extra;
          } else {
            trailingSymbols += token.base + token.extra;
          }
        } else {
          seenLetter = true;
          wordText += token.base + token.extra;
        }
      }
      if (!wordText && !leadingSymbols && !trailingSymbols) {
        wordText = item.rawWord;
      }

      if (leadingSymbols) {
        scalableW += measureTextAtRef(leadingSymbols);
        fixedW += 4;
      }
      if (wordText) {
        scalableW += measureTextAtRef(wordText);
      }
      if (trailingSymbols) {
        scalableW += measureTextAtRef(trailingSymbols);
        fixedW += 4;
      }
      if (item.ayahEnd !== null) {
        scalableW += REF_FONT_PX * (0.88 + 0.08);
      }
    }

    const gapEm = row.isCentered ? 0.16 : 0.14;
    scalableW += Math.max(0, row.items.length - 1) * REF_FONT_PX * gapEm;

    if (scalableW > 0) {
      const usableW = Math.max(1, availableWidth - fixedW);
      minRowFit = Math.min(minRowFit, REF_FONT_PX * (usableW / scalableW));
    }
  }

  const maxByWidthRatio = availableWidth * (isOpeningSpread ? 0.055 : 0.0455);
  const maxByHeight = rowHeight > 0 ? rowHeight * (isOpeningSpread ? 0.57 : 0.62) : maxByWidthRatio;
  const safeWidthScale = availableWidth > 16 ? (availableWidth - 4) / availableWidth : 1;
  const fitByWidth = Number.isFinite(minRowFit)
    ? minRowFit * safeWidthScale * 0.972
    : maxByWidthRatio;
  const computedSize = Math.max(
    8,
    Number(Math.min(fitByWidth, maxByHeight, maxByWidthRatio).toFixed(2))
  );

  if (canUseWordCache) {
    if (uniformFontSizeCache.size >= MAX_UNIFORM_FS_CACHE) {
      const oldest = uniformFontSizeCache.keys().next().value;
      if (oldest !== undefined) uniformFontSizeCache.delete(oldest);
    }
    uniformFontSizeCache.set(fsCacheKey, computedSize);
  }

  return computedSize;
}

export const MushafProgram: React.FC<MushafProgramProps> = ({
  variant = 'standalone',
  initialPage = 1,
  initialTajweed = true,
  isPresentationMode = false,
  onTogglePresentationMode,
  practiceConfig,
  onPlayChime,
  onTriggerConfetti,
  onOpenReports,
}) => {
  const hasPractice = !!practiceConfig && practiceConfig.targetLetters.length > 0;
  const targetLetters = practiceConfig?.targetLetters ?? [];
  const targetLettersKey = targetLetters.join(',');

  const [mushafDataset, setMushafDataset] = useState<MushafDataset | null>(() => cachedMushafDataset);
  const [selectedSurah, setSelectedSurah] = useState('الفاتحة');
  const [currentMushafPage, setCurrentMushafPage] = useState(initialPage);
  const [mushafMode, setMushafMode] = useState<'practice' | 'reading'>(
    hasPractice ? 'practice' : 'reading'
  );
  const [mushafTajweed, setMushafTajweed] = useState(initialTajweed);
  const [surahCorrectMap, setSurahCorrectMap] = useState<Record<string, boolean>>({});
  const [surahRevealed, setSurahRevealed] = useState(false);
  const [surahStatus, setSurahStatus] = useState<{ msg: string; kind: 'ok' | 'bad' | null }>({
    msg: '',
    kind: null,
  });
  const [surahWrongKey, setSurahWrongKey] = useState<string | null>(null);
  const [mushafZoom, setMushafZoom] = useState<number>(1);
  const [pageTurn, setPageTurn] = useState<{ dir: 'next' | 'prev'; seq: number } | null>(null);
  const turnSeqRef = useRef(0);
  const pageBodyRef = useRef<HTMLDivElement>(null);
  const ayahHoverLayerRef = useRef<HTMLDivElement>(null);
  const ayahSelectedLayerRef = useRef<HTMLDivElement>(null);
  const ayahPlayingLayerRef = useRef<HTMLDivElement>(null);
  const hoveredAyahKeyRef = useRef<string | null>(null);
  const hoveredAyahNodesRef = useRef<HTMLElement[]>([]);
  const selectedAyahNodesRef = useRef<HTMLElement[]>([]);
  const playingAyahNodesRef = useRef<HTMLElement[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playbackRequestIdRef = useRef(0);
  const isSwitchingAudioRef = useRef(false);
  const [uniformFontState, setUniformFontState] = useState<{
    pageNum: number;
    zoomKey: number;
    isolateSurahId: number | null;
    size: number;
  } | null>(null);
  const [exportIsolateSurahId, setExportIsolateSurahId] = useState<number | null>(null);
  const exportIsolateSurahIdRef = useRef<number | null>(null);
  exportIsolateSurahIdRef.current = exportIsolateSurahId;
  const [fontsReadyTick, setFontsReadyTick] = useState(() =>
    typeof document !== 'undefined' && Boolean(document.fonts?.check?.('16px "UthmanicHafs"')) ? 1 : 0
  );

  // Interactive online teacher tools (Focus, Hifz, Bookmarks; drawing lives in global floating palette)
  const {
    setActiveTool: setAnnotationTool,
    registerMushafExportProvider,
    getSurfaceStrokes,
  } = useAnnotationActions();
  const { activeTool: activeAnnotationTool } = useAnnotationToolState();
  const { draft: sessionReportDraft, pendingMushafJump } = useSessionReport();
  const [isReportCaptureMode, setIsReportCaptureMode] = useState(false);
  const [isCapturingReportAyah, setIsCapturingReportAyah] = useState(false);
  const [reportCaptureToast, setReportCaptureToast] = useState<{
    text: string;
    action: 'added' | 'updated';
    seq: number;
  } | null>(null);
  const reportToastTimerRef = useRef<number | null>(null);
  const reportToastSeqRef = useRef(0);
  const [isTeacherDockOpen, setIsTeacherDockOpen] = useState(false);
  const [isScrolledPastToolbar, setIsScrolledPastToolbar] = useState(false);
  const [isFloatingHudOpen, setIsFloatingHudOpen] = useState(false);
  const [isFloatingPinned, setIsFloatingPinned] = useState(false);
  const [reservedHudHeight, setReservedHudHeight] = useState(0);
  const [floatingHudWidth, setFloatingHudWidth] = useState(0);
  const hudSlotRef = useRef<HTMLDivElement>(null);
  const hudBoxRef = useRef<HTMLDivElement>(null);
  const hudSentinelRef = useRef<HTMLDivElement>(null);
  const lensStageRef = useRef<HTMLDivElement>(null);
  const pendingScrollAyahRef = useRef<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusLensOpen, setIsFocusLensOpen] = useState(false);
  const [focusedAyahKeys, setFocusedAyahKeys] = useState<string[]>([]);
  const [isFocusPickerOpen, setIsFocusPickerOpen] = useState(false);
  const [isHifzHidden, setIsHifzHidden] = useState(false);
  const [isHifzFirstWordCue, setIsHifzFirstWordCue] = useState(false);
  const [hifzTargetRangeKeys, setHifzTargetRangeKeys] = useState<string[] | null>(null);
  const [hifzSlipCount, setHifzSlipCount] = useState(0);
  const [revealedWordKeys, setRevealedWordKeys] = useState<Record<string, boolean>>({});
  const [revealedAyahKeys, setRevealedAyahKeys] = useState<Record<string, boolean>>({});
  const [isRangeToolOpen, setIsRangeToolOpen] = useState(false);
  const [rangeStartKey, setRangeStartKey] = useState('');
  const [rangeEndKey, setRangeEndKey] = useState('');
  const bookmarks = useMushafBookmarks();
  const studentProfiles = useStudentProfiles();
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [bookmarkNoteInput, setBookmarkNoteInput] = useState('');
  const [bookmarkStudentInput, setBookmarkStudentInput] = useState('');
  const [bookmarkKindInput, setBookmarkKindInput] = useState<MushafBookmarkKind>('hifz');
  const [bookmarkStudentFilter, setBookmarkStudentFilter] = useState<string>('all');
  const [mushafPaperTheme, setMushafPaperTheme] = useState<MushafPaperTheme>(() =>
    loadSavedPaperTheme()
  );
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuWrapRef = useRef<HTMLDivElement>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isIndexModalOpen, setIsIndexModalOpen] = useState(false);
  const [transientHighlightAyahKey, setTransientHighlightAyahKey] = useState<string | null>(null);
  const transientHighlightTimerRef = useRef<number | null>(null);
  const [isFloatingHudEntering, setIsFloatingHudEntering] = useState(false);
  const [isHudLauncherEntering, setIsHudLauncherEntering] = useState(false);
  const [tafsirTarget, setTafsirTarget] = useState<TafsirAyahTarget | null>(null);
  const [audioModalTarget, setAudioModalTarget] = useState<AudioControlTarget | null>(null);
  const [audioReciterId, setAudioReciterId] = useState<ReciterId>(() => loadSavedReciterId());
  const [audioRate, setAudioRate] = useState<PlaybackRateOption>(() => loadSavedPlaybackRate());
  const [audioRepeat, setAudioRepeat] = useState<AyahRepeatOption>(() => loadSavedAyahRepeat());
  const [audioRepeatSection, setAudioRepeatSection] = useState<boolean>(() =>
    loadSavedSectionRepeat()
  );
  const [audioAutoFollow, setAudioAutoFollow] = useState<boolean>(() =>
    loadSavedAudioAutoFollow()
  );
  const [audioAyahCount, setAudioAyahCount] = useState<number>(() => loadSavedAyahCount());
  const [audioSectionStart, setAudioSectionStart] = useState<{
    surahId: number;
    ayahNum: number;
  } | null>(null);
  const [audioSession, setAudioSession] = useState<{
    total: number;
    index: number;
    repeatSection?: boolean;
  }>({
    total: 0,
    index: 1,
  });
  const [audioRepeatProgress, setAudioRepeatProgress] = useState(1);
  const [audioPauseGap, setAudioPauseGap] = useState<AudioPauseGap>(() => loadSavedAudioPauseGap());
  const [audioStopAtPageEnd, setAudioStopAtPageEnd] = useState<boolean>(() =>
    loadSavedStopAtPageEnd()
  );
  const [audioPauseGapWaiting, setAudioPauseGapWaiting] = useState(false);
  const [isAudioBarOpen, setIsAudioBarOpen] = useState(false);
  const [audioTarget, setAudioTarget] = useState<{ surahId: number; ayahNum: number } | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioPauseTimerRef = useRef<number | null>(null);
  const audioPauseRafRef = useRef<number | null>(null);
  const audioProgressListenersRef = useRef<Set<(ratio: number, isWaitingGap: boolean) => void>>(
    new Set()
  );
  const lastAudioProgressRef = useRef<{ ratio: number; isWaitingGap: boolean }>({
    ratio: 0,
    isWaitingGap: false,
  });

  const emitAudioProgress = useCallback((ratio: number, isWaitingGap: boolean) => {
    lastAudioProgressRef.current = { ratio, isWaitingGap };
    audioProgressListenersRef.current.forEach((cb) => cb(ratio, isWaitingGap));
  }, []);

  const clearAudioPauseTimer = useCallback(() => {
    if (audioPauseTimerRef.current !== null) {
      window.clearTimeout(audioPauseTimerRef.current);
      audioPauseTimerRef.current = null;
    }
    if (audioPauseRafRef.current !== null) {
      window.cancelAnimationFrame(audioPauseRafRef.current);
      audioPauseRafRef.current = null;
    }
    setAudioPauseGapWaiting(false);
  }, []);

  const subscribeAudioProgress = useCallback(
    (cb: (ratio: number, isWaitingGap: boolean) => void) => {
      audioProgressListenersRef.current.add(cb);
      cb(lastAudioProgressRef.current.ratio, lastAudioProgressRef.current.isWaitingGap);
      return () => {
        audioProgressListenersRef.current.delete(cb);
      };
    },
    []
  );

  const handleSeekAudioProgress = useCallback(
    (ratio: number) => {
      const audio = audioElRef.current;
      if (!audio || audioPauseTimerRef.current !== null) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const clamped = Math.max(0, Math.min(0.995, ratio));
      audio.currentTime = clamped * audio.duration;
      emitAudioProgress(clamped, false);
    },
    [emitAudioProgress]
  );

  useEffect(() => {
    return () => {
      clearAudioPauseTimer();
    };
  }, [clearAudioPauseTimer]);

  const pageResizeListenersRef = useRef<Set<() => void>>(new Set());
  const subscribePageResize = useCallback((cb: () => void) => {
    pageResizeListenersRef.current.add(cb);
    return () => {
      pageResizeListenersRef.current.delete(cb);
    };
  }, []);

  const showFloatingHud = isScrolledPastToolbar && isFloatingHudOpen;
  const showHudLauncher = isScrolledPastToolbar && !isFloatingHudOpen;

  useEffect(() => {
    if (!showFloatingHud) {
      setIsFloatingHudEntering(false);
      return;
    }
    setIsFloatingHudEntering(true);
    const timer = window.setTimeout(() => {
      setIsFloatingHudEntering(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [showFloatingHud]);

  useEffect(() => {
    if (!showHudLauncher) {
      setIsHudLauncherEntering(false);
      return;
    }
    setIsHudLauncherEntering(true);
    const timer = window.setTimeout(() => {
      setIsHudLauncherEntering(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [showHudLauncher]);

  useEffect(() => {
    const sentinel = hudSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const passed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setIsScrolledPastToolbar((prev) => (prev === passed ? prev : passed));
        if (!passed) {
          setIsFloatingHudOpen(false);
        }
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showFloatingHud) return;
    let widthRaf = 0;
    const syncWidth = () => {
      if (hudSlotRef.current) {
        const nextW = Math.round(hudSlotRef.current.getBoundingClientRect().width);
        setFloatingHudWidth((prev) => (prev === nextW ? prev : nextW));
      }
    };
    const scheduleSyncWidth = () => {
      if (widthRaf) return;
      widthRaf = requestAnimationFrame(() => {
        widthRaf = 0;
        syncWidth();
      });
    };
    syncWidth();
    window.addEventListener('resize', scheduleSyncWidth, { passive: true });
    return () => {
      if (widthRaf) cancelAnimationFrame(widthRaf);
      window.removeEventListener('resize', scheduleSyncWidth);
    };
  }, [showFloatingHud]);

  useEffect(() => {
    if (!showFloatingHud || isFocusLensOpen || tafsirTarget !== null || audioModalTarget !== null || isSearchModalOpen || isIndexModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsFloatingHudOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showFloatingHud, isFocusLensOpen, tafsirTarget, audioModalTarget, isSearchModalOpen, isIndexModalOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PAPER_THEME_STORAGE_KEY, mushafPaperTheme);
    } catch {
      // Ignore storage quota issues
    }
  }, [mushafPaperTheme]);

  useEffect(() => {
    if (!isThemeMenuOpen) return;
    const handleOutside = (e: PointerEvent) => {
      if (
        themeMenuWrapRef.current &&
        !themeMenuWrapRef.current.contains(e.target as Node)
      ) {
        setIsThemeMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsThemeMenuOpen(false);
    };
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('keydown', handleEsc, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('keydown', handleEsc, true);
    };
  }, [isThemeMenuOpen]);

  useEffect(() => {
    const onSearchShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault();
        setIsIndexModalOpen(false);
        setIsThemeMenuOpen(false);
        setIsSearchModalOpen(true);
      }
    };
    window.addEventListener('keydown', onSearchShortcut);
    return () => window.removeEventListener('keydown', onSearchShortcut);
  }, []);

  useEffect(() => {
    return () => {
      if (transientHighlightTimerRef.current !== null) {
        window.clearTimeout(transientHighlightTimerRef.current);
      }
    };
  }, []);

  const handleOpenFloatingHud = useCallback(() => {
    if (hudBoxRef.current) {
      setReservedHudHeight(hudBoxRef.current.offsetHeight);
    }
    if (hudSlotRef.current) {
      setFloatingHudWidth(Math.round(hudSlotRef.current.getBoundingClientRect().width));
    }
    setIsFloatingHudOpen(true);
  }, []);

  const handleScrollToTop = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleToggleTeacherDock = useCallback(() => {
    setIsTeacherDockOpen((prev) => !prev);
  }, []);

  const zoomStepIdx = MUSHAF_ZOOM_STEPS.findIndex((z) => Math.abs(z - mushafZoom) < 0.01);
  const resolvedZoomIdx = zoomStepIdx >= 0 ? zoomStepIdx : MUSHAF_ZOOM_STEPS.indexOf(1);
  const resolvedZoomStep = MUSHAF_ZOOM_STEPS[resolvedZoomIdx];
  const activeZoomPreset = MUSHAF_ZOOM_PRESETS[resolvedZoomStep];
  const effectiveMushafScale = Number((mushafZoom * MUSHAF_BASE_SCALE).toFixed(3));
  const currentZoomKey = Math.round(mushafZoom * 100);
  const canZoomOut = resolvedZoomIdx > 0;
  const canZoomIn = resolvedZoomIdx < MUSHAF_ZOOM_STEPS.length - 1;
  const handleStepZoom = (delta: -1 | 1) => {
    const nextIdx = Math.max(0, Math.min(MUSHAF_ZOOM_STEPS.length - 1, resolvedZoomIdx + delta));
    setMushafZoom(MUSHAF_ZOOM_STEPS[nextIdx]);
  };

  useEffect(() => {
    setMushafMode(hasPractice ? 'practice' : 'reading');
    setSurahCorrectMap({});
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
  }, [hasPractice, targetLettersKey]);

  useEffect(() => {
    if (mushafDataset) return;
    let cancelled = false;
    loadMushafDatasetCached().then((data) => {
      if (!cancelled && data) {
        setMushafDataset(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mushafDataset]);

  const mushafSurahs = mushafDataset?.surahs || INITIAL_MUSHAF_SURAHS;

  const surahMetaMap = useMemo(() => {
    const map = new Map<number, MushafSurahMeta>();
    for (const s of mushafSurahs) {
      map.set(s.id, s);
    }
    return map;
  }, [mushafSurahs]);

  const clampedMushafPage = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, currentMushafPage));

  const getPageSurahNames = useCallback(
    (rawPage: MushafRawPage | undefined): string[] => {
      if (!rawPage) return [];
      const names: string[] = [];
      for (const row of rawPage.rows) {
        if (row.k === 't' && row.r) {
          for (const run of row.r) {
            const meta = surahMetaMap.get(run.s);
            if (meta && !names.includes(meta.name)) {
              names.push(meta.name);
            }
          }
        }
      }
      if (names.length === 0) {
        for (const row of rawPage.rows) {
          if (row.s) {
            const meta = surahMetaMap.get(row.s);
            if (meta && !names.includes(meta.name)) {
              names.push(meta.name);
            }
          }
        }
      }
      return names;
    },
    [surahMetaMap]
  );

  // Memoize all 604 Mushaf page selector labels once per dataset load instead of scanning 604 pages on every render
  const pageSelectOptions = useMemo(() => {
    const opts: Array<{ pageNum: number; label: string }> = new Array(TOTAL_MUSHAF_PAGES);
    for (let idx = 0; idx < TOTAL_MUSHAF_PAGES; idx++) {
      const pNum = idx + 1;
      const pSurah = getPageSurahNames(mushafDataset?.pages[idx])[0];
      opts[idx] = {
        pageNum: pNum,
        label: `صفحة ${toArabicDigits(pNum)}${pSurah ? ` (${pSurah})` : ''}`,
      };
    }
    return opts;
  }, [mushafDataset, getPageSurahNames]);

  const buildTokenizedPage = useCallback(
    (pageNum: number): TokenizedMushafPage | null => {
      const rawPage = mushafDataset?.pages[pageNum - 1];
      if (!rawPage) return null;

      const cacheKey = `${targetLettersKey}:${pageNum}`;
      const cached = tokenizedPageCache.get(cacheKey);
      if (cached) {
        tokenizedPageCache.delete(cacheKey);
        tokenizedPageCache.set(cacheKey, cached);
        return cached;
      }

    const surahNames = getPageSurahNames(rawPage);
    const rows: TokenizedMushafRow[] = [];

    for (const row of rawPage.rows) {
      if (row.k === 'b' && row.s) {
        const surahMeta = surahMetaMap.get(row.s);
        if (surahMeta) {
          rows.push({ kind: 'banner', line: row.l, surahMeta });
        }
        continue;
      }

      if (row.k === 'm' && row.s) {
        rows.push({ kind: 'basmalah', line: row.l, surahId: row.s });
        continue;
      }

      if (row.k === 't' && row.r) {
        const items: MushafLineItem[] = [];
        let endCount = 0;
        const plainParts: string[] = [];

        row.r.forEach((run, runIdx) => {
          const hasRubMarker = run.t.startsWith('\u00A0') && !run.t.includes('\u06DE');
          const clean = run.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
          const words = clean ? clean.split(/[\s\u00A0]+/) : [];
          if (run.e === 1) endCount++;

          if (words.length === 0) {
            if (run.e === 1) {
              items.push({
                kind: 'rosette',
                keyPrefix: `${pageNum}_${row.l}_${runIdx}_end`,
                ayahNum: run.a,
                surahId: run.s,
              });
            }
            return;
          }

          plainParts.push(clean);
          words.forEach((word, wIdx) => {
            const isFirstWordOfRun = wIdx === 0;
            const isLastWordOfRun = wIdx === words.length - 1;
            const rawWithRub = isFirstWordOfRun && hasRubMarker ? `\u06DE${word}` : word;
            items.push({
              kind: 'word',
              keyPrefix: `${pageNum}_${row.l}_${runIdx}_${wIdx}`,
              rawWord: rawWithRub,
              tokens: tokenizeMushafText(rawWithRub, targetLetters),
              ayahEnd: isLastWordOfRun && run.e === 1 ? run.a : null,
              surahId: run.s,
              ayahNum: run.a,
            });
          });
        });

        const lastRun = row.r[row.r.length - 1];
        const lastSurahMeta = lastRun ? surahMetaMap.get(lastRun.s) : undefined;
        const isSurahEnd = !!(
          lastRun &&
          lastRun.e === 1 &&
          lastSurahMeta &&
          lastRun.a === lastSurahMeta.totalAyat
        );
        const baseTextLen =
          plainParts.join(' ').replace(new RegExp(DIACRITIC_RE.source, 'g'), '').length + endCount * 3;
        const isClosingPairRow = pageNum === 604 && row.l === 14;
        const isCentered = pageNum <= 2 || isClosingPairRow || (isSurahEnd && baseTextLen < 36);

        rows.push({
          kind: 'text',
          line: row.l,
          isCentered,
          items,
        });
      }
    }

    const flatWords: Array<Extract<MushafLineItem, { kind: 'word' }>> = [];
    for (const r of rows) {
      if (r.kind === 'text') {
        for (const item of r.items) {
          if (item.kind === 'word') {
            flatWords.push(item);
          }
        }
      }
    }

    let prevPageLastWord:
      | { surahId: number; ayahNum: number; tokens: MushafLetterUnit[] }
      | undefined;
    const prevRawPage = pageNum > 1 ? mushafDataset?.pages[pageNum - 2] : undefined;
    if (prevRawPage) {
      for (let rIdx = prevRawPage.rows.length - 1; rIdx >= 0; rIdx--) {
        const pr = prevRawPage.rows[rIdx];
        if (pr.k === 't' && pr.r && pr.r.length > 0) {
          const lastRun = pr.r[pr.r.length - 1];
          if (lastRun.e === 1) break;
          const clean = lastRun.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
          const words = clean ? clean.split(/[\s\u00A0]+/) : [];
          if (words.length > 0) {
            prevPageLastWord = {
              surahId: lastRun.s,
              ayahNum: lastRun.a,
              tokens: tokenizeMushafText(words[words.length - 1], targetLetters),
            };
          }
          break;
        }
        if (pr.k === 'b' || pr.k === 'm') break;
      }
    }

    let nextPageFirstWord:
      | { surahId: number; ayahNum: number; tokens: MushafLetterUnit[] }
      | undefined;
    const nextRawPage = pageNum < TOTAL_MUSHAF_PAGES ? mushafDataset?.pages[pageNum] : undefined;
    if (nextRawPage) {
      for (const nr of nextRawPage.rows) {
        if (nr.k === 'b' || nr.k === 'm') break;
        if (nr.k === 't' && nr.r) {
          for (const nRun of nr.r) {
            const clean = nRun.t.replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, '');
            const words = clean ? clean.split(/[\s\u00A0]+/) : [];
            if (words.length > 0) {
              nextPageFirstWord = {
                surahId: nRun.s,
                ayahNum: nRun.a,
                tokens: tokenizeMushafText(words[0], targetLetters),
              };
              break;
            }
          }
        }
        if (nextPageFirstWord) break;
      }
    }

    flatWords.forEach((wordItem, idx) => {
      const isFirstOnPage = idx === 0;
      const isLastOnPage = idx === flatWords.length - 1;
      const prevWord = idx > 0 ? flatWords[idx - 1] : undefined;
      const candidatePrevTokens = isFirstOnPage
        ? prevPageLastWord &&
          prevPageLastWord.surahId === wordItem.surahId &&
          prevPageLastWord.ayahNum === wordItem.ayahNum
          ? prevPageLastWord.tokens
          : undefined
        : prevWord &&
          prevWord.ayahEnd === null &&
          prevWord.surahId === wordItem.surahId &&
          prevWord.ayahNum === wordItem.ayahNum
        ? prevWord.tokens
        : undefined;
      const prevEndsWithWaqfLazim = Boolean(
        candidatePrevTokens?.some((t) => t.type === 'letter' && t.extra.includes('\u06D8'))
      );
      const prevWordTokens = prevEndsWithWaqfLazim ? undefined : candidatePrevTokens;

      const curEndsWithWaqfLazim = wordItem.tokens.some(
        (t) => t.type === 'letter' && t.extra.includes('\u06D8')
      );
      const nextWord = idx < flatWords.length - 1 ? flatWords[idx + 1] : undefined;
      const sameNextAyahOnPage = !!(
        nextWord &&
        nextWord.surahId === wordItem.surahId &&
        nextWord.ayahNum === wordItem.ayahNum
      );
      const nextWordTokens =
        wordItem.ayahEnd !== null || curEndsWithWaqfLazim
          ? undefined
          : isLastOnPage
          ? nextPageFirstWord &&
            nextPageFirstWord.surahId === wordItem.surahId &&
            nextPageFirstWord.ayahNum === wordItem.ayahNum
            ? nextPageFirstWord.tokens
            : undefined
          : sameNextAyahOnPage
          ? nextWord!.tokens
          : undefined;
      const isAyahEndBoundary =
        wordItem.ayahEnd !== null || (!isLastOnPage && !sameNextAyahOnPage);
      wordItem.tajweed = analyzeWordTajweed(wordItem.tokens, {
        prevWordTokens,
        nextWordTokens,
        isAyahEnd: isAyahEndBoundary,
      });
    });

    const built: TokenizedMushafPage = {
      pageNum,
      jozz: rawPage.j,
      surahNames,
      rows,
    };

    if (tokenizedPageCache.size >= MAX_TOKENIZED_PAGE_CACHE) {
      const oldest = tokenizedPageCache.keys().next().value;
      if (oldest !== undefined) tokenizedPageCache.delete(oldest);
    }
    tokenizedPageCache.set(cacheKey, built);

    return built;
  },
  [mushafDataset, surahMetaMap, getPageSurahNames, targetLetters, targetLettersKey]
  );

  const activeSinglePageData = useMemo(
    () => buildTokenizedPage(clampedMushafPage),
    [buildTokenizedPage, clampedMushafPage]
  );
  const activeSinglePageDataRef = useRef<typeof activeSinglePageData>(null);
  activeSinglePageDataRef.current = activeSinglePageData;

  const isolatedPageInfo = useMemo(() => {
    if (exportIsolateSurahId === null || !activeSinglePageData) return null;
    const keptRows: TokenizedMushafRow[] = [];
    const keptIndices: number[] = [];

    activeSinglePageData.rows.forEach((row, idx) => {
      if (row.kind === 'banner') {
        if (row.surahMeta.id === exportIsolateSurahId) {
          keptRows.push(row);
          keptIndices.push(idx);
        }
        return;
      }
      if (row.kind === 'basmalah') {
        if (row.surahId === exportIsolateSurahId) {
          keptRows.push(row);
          keptIndices.push(idx);
        }
        return;
      }
      const matchingItems = row.items.filter((item) => item.surahId === exportIsolateSurahId);
      if (matchingItems.length > 0) {
        keptRows.push(
          matchingItems.length === row.items.length ? row : { ...row, items: matchingItems }
        );
        keptIndices.push(idx);
      }
    });

    if (keptRows.length === 0) return null;
    const totalSlots = clampedMushafPage <= 2 ? 8 : 15;
    const keptCount = keptRows.length;
    const droppedLeading = keptIndices[0];
    const lastKeptIdx = keptIndices[keptIndices.length - 1];
    const droppedTrailing = Math.max(0, totalSlots - (lastKeptIdx + 1));
    const surahName =
      surahMetaMap.get(exportIsolateSurahId)?.name || activeSinglePageData.surahNames[0] || '';

    return {
      surahId: exportIsolateSurahId,
      surahName,
      rows: keptRows,
      totalSlots,
      keptCount,
      droppedLeading,
      droppedTrailing,
      isCompacted: keptCount < totalSlots,
    };
  }, [exportIsolateSurahId, activeSinglePageData, clampedMushafPage, surahMetaMap]);

  const isolatedPageInfoRef = useRef(isolatedPageInfo);
  isolatedPageInfoRef.current = isolatedPageInfo;

  // Pre-tokenize and pre-compute uniform font sizes/word widths for adjacent pages during idle frames
  useEffect(() => {
    if (!mushafDataset) return;

    type IdleDeadlineLike = { timeRemaining: () => number };
    const w = window as unknown as {
      requestIdleCallback?: (cb: (deadline: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const neighborPages: number[] = [];
    if (clampedMushafPage < TOTAL_MUSHAF_PAGES) neighborPages.push(clampedMushafPage + 1);
    if (clampedMushafPage > 1) neighborPages.push(clampedMushafPage - 1);
    if (neighborPages.length === 0) return;

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    let nextIdx = 0;

    const warmOnePage = (targetPageNum: number) => {
      const tokenized = buildTokenizedPage(targetPageNum);
      if (!tokenized || fontsReadyTick <= 0) return;
      const bodyEl = pageBodyRef.current;
      if (!bodyEl) return;
      const cs = getComputedStyle(bodyEl);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const targetIsOpening = targetPageNum <= 2;
      const currentIsOpening = clampedMushafPage <= 2;
      const bodyW = bodyEl.clientWidth;
      const availableWidth =
        targetIsOpening === currentIsOpening
          ? bodyW - padX
          : targetIsOpening
          ? Math.max(0, bodyW - padX)
          : bodyW;
      if (availableWidth <= 0) return;
      const bodyHeight =
        targetIsOpening === currentIsOpening
          ? bodyEl.clientHeight
          : targetIsOpening
          ? Math.round(bodyW * 0.93)
          : Math.round(bodyW * 1.46);
      computeAndCacheUniformFontSize(
        tokenized,
        targetPageNum,
        availableWidth,
        bodyHeight,
        fontsReadyTick
      );
    };

    const scheduleStep = () => {
      if (cancelled || nextIdx >= neighborPages.length) return;
      if (typeof w.requestIdleCallback === 'function') {
        idleId = w.requestIdleCallback(
          (deadline) => {
            idleId = null;
            if (cancelled) return;
            while (nextIdx < neighborPages.length) {
              warmOnePage(neighborPages[nextIdx]);
              nextIdx += 1;
              if (nextIdx < neighborPages.length && deadline.timeRemaining() < 2) {
                scheduleStep();
                return;
              }
            }
          },
          { timeout: 240 }
        );
      } else {
        timeoutId = window.setTimeout(() => {
          timeoutId = null;
          if (cancelled) return;
          warmOnePage(neighborPages[nextIdx]);
          nextIdx += 1;
          if (nextIdx < neighborPages.length) {
            scheduleStep();
          }
        }, 48);
      }
    };

    scheduleStep();

    return () => {
      cancelled = true;
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [mushafDataset, clampedMushafPage, buildTokenizedPage, fontsReadyTick, currentZoomKey, isPresentationMode]);

  const visiblePagesData = useMemo(
    () => [activeSinglePageData],
    [activeSinglePageData]
  );

  const uniformPageFontSize =
    uniformFontState &&
    uniformFontState.pageNum === clampedMushafPage &&
    uniformFontState.isolateSurahId === exportIsolateSurahId
      ? uniformFontState.size
      : null;
  const isUniformFontSynced = Boolean(
    uniformFontState &&
      uniformFontState.pageNum === clampedMushafPage &&
      uniformFontState.zoomKey === currentZoomKey &&
      uniformFontState.isolateSurahId === exportIsolateSurahId
  );

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) {
        setFontsReadyTick((prev) => (prev === 0 ? 1 : prev + 1));
      }
    };
    const loadHafs =
      typeof document.fonts.load === 'function'
        ? document.fonts.load('16px "UthmanicHafs"').catch(() => undefined)
        : Promise.resolve();
    Promise.all([loadHafs, document.fonts.ready]).then(markReady);
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const bodyEl = pageBodyRef.current;
    if (!bodyEl || !activeSinglePageData) {
      setUniformFontState(null);
      return;
    }

    let cancelled = false;
    let rafId = 0;

    const computeUniformFontSize = (): boolean => {
      if (cancelled || !pageBodyRef.current) return false;
      const node = pageBodyRef.current;
      const cs = getComputedStyle(node);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const availableWidth = node.clientWidth - padX;
      if (availableWidth <= 0) return false;

      const currentIso = isolatedPageInfoRef.current;
      const effectiveBodyHeight =
        currentIso && currentIso.isCompacted && currentIso.keptCount > 0
          ? (node.clientHeight * currentIso.totalSlots) / currentIso.keptCount
          : node.clientHeight;

      const computedSize = computeAndCacheUniformFontSize(
        activeSinglePageData,
        clampedMushafPage,
        availableWidth,
        effectiveBodyHeight,
        fontsReadyTick
      );

      let didUpdate = false;
      setUniformFontState((prev) => {
        if (
          prev &&
          prev.pageNum === clampedMushafPage &&
          prev.zoomKey === currentZoomKey &&
          prev.isolateSurahId === exportIsolateSurahId &&
          Math.abs(prev.size - computedSize) < 0.15
        ) {
          return prev;
        }
        didUpdate = true;
        return {
          pageNum: clampedMushafPage,
          zoomKey: currentZoomKey,
          isolateSurahId: exportIsolateSurahId,
          size: computedSize,
        };
      });
      return didUpdate;
    };

    computeUniformFontSize();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    let lastW = Math.round(bodyEl.clientWidth);
    let lastH = Math.round(bodyEl.clientHeight);
    const ro = new ResizeObserver(() => {
      const nextW = Math.round(bodyEl.clientWidth);
      const nextH = Math.round(bodyEl.clientHeight);
      if (nextW <= 0 || (nextW === lastW && nextH === lastH)) return;
      lastW = nextW;
      lastH = nextH;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const sizeChanged = computeUniformFontSize();
        if (!sizeChanged) {
          pageResizeListenersRef.current.forEach((cb) => cb());
        }
      });
    });

    ro.observe(bodyEl);

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    activeSinglePageData,
    clampedMushafPage,
    currentZoomKey,
    isPresentationMode,
    fontsReadyTick,
    exportIsolateSurahId,
    isolatedPageInfo,
  ]);

  const currentJozz = activeSinglePageData?.jozz || 1;
  const currentSurahIdx = Math.max(0, mushafSurahs.findIndex((s) => s.name === selectedSurah));
  const currentSurahEntry = mushafSurahs[currentSurahIdx] || mushafSurahs[0];

  const allSurahExportOptions = useMemo<MushafExportSurahOption[]>(() => {
    const bounds = new Map<number, { min: number; max: number }>();
    if (mushafDataset?.pages) {
      mushafDataset.pages.forEach((rawPage, idx) => {
        const pageNum = idx + 1;
        for (const row of rawPage.rows) {
          if (row.s) {
            const existing = bounds.get(row.s);
            if (!existing) {
              bounds.set(row.s, { min: pageNum, max: pageNum });
            } else {
              if (pageNum < existing.min) existing.min = pageNum;
              if (pageNum > existing.max) existing.max = pageNum;
            }
          }
          if (row.r) {
            for (const run of row.r) {
              const existing = bounds.get(run.s);
              if (!existing) {
                bounds.set(run.s, { min: pageNum, max: pageNum });
              } else {
                if (pageNum < existing.min) existing.min = pageNum;
                if (pageNum > existing.max) existing.max = pageNum;
              }
            }
          }
        }
      });
    }
    return mushafSurahs.map((s) => {
      const b = bounds.get(s.id);
      const startPage = b ? b.min : s.startPage;
      const endPage = b ? b.max : s.startPage;
      return {
        id: s.id,
        name: s.name,
        startPage,
        endPage,
        pageCount: Math.max(1, endPage - startPage + 1),
      };
    });
  }, [mushafDataset, mushafSurahs]);

  const surahExportById = useMemo(() => {
    const map = new Map<number, MushafExportSurahOption>();
    for (const opt of allSurahExportOptions) {
      map.set(opt.id, opt);
    }
    return map;
  }, [allSurahExportOptions]);

  const surahsOnCurrentPage = useMemo<MushafExportSurahOption[]>(() => {
    const rawPage = mushafDataset?.pages[clampedMushafPage - 1];
    if (!rawPage) return [];
    const seenIds: number[] = [];
    for (const row of rawPage.rows) {
      if (row.k === 't' && row.r) {
        for (const run of row.r) {
          if (!seenIds.includes(run.s)) seenIds.push(run.s);
        }
      }
    }
    if (seenIds.length === 0) {
      for (const row of rawPage.rows) {
        if (row.s && !seenIds.includes(row.s)) seenIds.push(row.s);
      }
    }
    return seenIds
      .map((id) => surahExportById.get(id))
      .filter((item): item is MushafExportSurahOption => Boolean(item));
  }, [mushafDataset, clampedMushafPage, surahExportById]);

  const exportWaitersRef = useRef<
    Array<{ pageNum: number; isolateSurahId: number | null; resolve: () => void }>
  >([]);
  const clampedMushafPageRef = useRef(clampedMushafPage);
  clampedMushafPageRef.current = clampedMushafPage;
  const isUniformFontSyncedRef = useRef(isUniformFontSynced);
  isUniformFontSyncedRef.current = isUniformFontSynced;

  useEffect(() => {
    if (!isUniformFontSynced) return;
    const hasMatch = exportWaitersRef.current.some(
      (w) => w.pageNum === clampedMushafPage && w.isolateSurahId === exportIsolateSurahId
    );
    if (!hasMatch) return;
    let raf1 = 0;
    let raf2 = 0;
    let cancelled = false;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const remaining: typeof exportWaitersRef.current = [];
        const ready: Array<() => void> = [];
        for (const w of exportWaitersRef.current) {
          if (w.pageNum === clampedMushafPage && w.isolateSurahId === exportIsolateSurahId) {
            ready.push(w.resolve);
          } else {
            remaining.push(w);
          }
        }
        exportWaitersRef.current = remaining;
        for (const fn of ready) fn();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [clampedMushafPage, exportIsolateSurahId, isUniformFontSynced]);

  const navigateToPageForExport = useCallback(
    async (targetPageNum: number, options?: { isolateSurahId?: number }) => {
      const clamped = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, Math.floor(targetPageNum)));
      const targetIsolate = options?.isolateSurahId ?? null;
      if (
        clamped === clampedMushafPageRef.current &&
        targetIsolate === exportIsolateSurahIdRef.current &&
        isUniformFontSyncedRef.current
      ) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return;
      }
      await new Promise<void>((resolve) => {
        let done = false;
        let fallbackTimer = 0;
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(fallbackTimer);
          resolve();
        };
        exportWaitersRef.current.push({
          pageNum: clamped,
          isolateSurahId: targetIsolate,
          resolve: finish,
        });
        setPageTurn(null);
        setExportIsolateSurahId(targetIsolate);
        setCurrentMushafPage(clamped);
        fallbackTimer = window.setTimeout(finish, 1400);
      });
    },
    []
  );

  const restorePageAfterExport = useCallback((originalPage: number) => {
    setPageTurn(null);
    setExportIsolateSurahId(null);
    setCurrentMushafPage(Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, Math.floor(originalPage))));
  }, []);

  const transformStrokesForExport = useCallback(
    (
      pageNum: number,
      strokes: ReadonlyArray<AnnotationStroke>,
      isolateSurahId?: number
    ): ReadonlyArray<AnnotationStroke> => {
      if (isolateSurahId === undefined || strokes.length === 0) return strokes;
      const iso = isolatedPageInfoRef.current;
      if (!iso || iso.surahId !== isolateSurahId || !iso.isCompacted || iso.keptCount <= 0) {
        return strokes;
      }
      if (clampedMushafPageRef.current !== pageNum) return strokes;

      const bodyEl = pageBodyRef.current;
      const innerEl = bodyEl?.parentElement ?? null;
      if (!bodyEl || !innerEl) return strokes;

      const bodyRect = bodyEl.getBoundingClientRect();
      const innerRect = innerEl.getBoundingClientRect();
      if (bodyRect.height <= 0 || innerRect.height <= 0 || innerRect.width <= 0) return strokes;

      const headerTopOffset = Math.max(0, bodyRect.top - innerRect.top);
      const footerBottomSpace = Math.max(0, innerRect.bottom - bodyRect.bottom);
      const rowH = bodyRect.height / iso.keptCount;
      const fullBodyH = rowH * iso.totalSlots;
      const fullOverlayH = headerTopOffset + fullBodyH + footerBottomSpace;
      const keptOverlayH = innerRect.height;
      const overlayW = innerRect.width;
      if (fullOverlayH <= 0 || keptOverlayH <= 0) return strokes;

      const bandTopPx = headerTopOffset + iso.droppedLeading * rowH;
      const bandBottomPx = headerTopOffset + (iso.droppedLeading + iso.keptCount) * rowH;
      const minAllowedPx = bandTopPx - (iso.droppedLeading > 0 ? rowH * 0.08 : rowH * 0.55);
      const maxAllowedPx = bandBottomPx + (iso.droppedTrailing > 0 ? rowH * 0.08 : rowH * 0.55);
      const shiftPx = iso.droppedLeading * rowH;
      const yStretch = fullOverlayH / keptOverlayH;
      const circleScaleComp = (overlayW + fullOverlayH) / (overlayW + keptOverlayH);
      const toOrigPxY = (ny: number) => (ny / 1000) * fullOverlayH;
      const mapNormY = (ny: number) => (((ny / 1000) * fullOverlayH - shiftPx) / keptOverlayH) * 1000;

      const out: AnnotationStroke[] = [];
      for (const stroke of strokes) {
        let minPxY = Infinity;
        let maxPxY = -Infinity;
        const pushNormY = (ny: number) => {
          const py = toOrigPxY(ny);
          if (py < minPxY) minPxY = py;
          if (py > maxPxY) maxPxY = py;
        };

        if (stroke.shape) {
          const s = stroke.shape;
          if (s.type === 'line' || s.type === 'brace') {
            pushNormY(s.y1);
            pushNormY(s.y2);
          } else if (s.type === 'arc') {
            pushNormY(s.y1);
            pushNormY(s.cy);
            pushNormY(s.y2);
          } else if (s.type === 'ellipse') {
            const cyPx = toOrigPxY(s.cy);
            const isIso = Boolean(s.isCircle || (s.rotation && Math.abs(s.rotation) > 0.001));
            const ryPx = isIso
              ? s.ry * ((overlayW + fullOverlayH) / 2000)
              : s.ry * (fullOverlayH / 1000);
            if (cyPx - ryPx < minPxY) minPxY = cyPx - ryPx;
            if (cyPx + ryPx > maxPxY) maxPxY = cyPx + ryPx;
          } else if (s.type === 'polygon' || s.type === 'curve') {
            for (const p of s.points) pushNormY(p.y);
          } else if (s.type === 'arrow') {
            pushNormY(s.y1);
            pushNormY(s.y2);
            pushNormY(s.leftY);
            pushNormY(s.rightY);
            if (s.cy !== undefined) pushNormY(s.cy);
            if (s.tailLeftY !== undefined) pushNormY(s.tailLeftY);
            if (s.tailRightY !== undefined) pushNormY(s.tailRightY);
          }
        }
        if (!Number.isFinite(minPxY) || !Number.isFinite(maxPxY)) {
          for (const pt of stroke.points) pushNormY(pt.y);
        }
        if (!Number.isFinite(minPxY) || !Number.isFinite(maxPxY)) continue;

        const centerPxY = (minPxY + maxPxY) * 0.5;
        if (centerPxY < minAllowedPx || centerPxY > maxAllowedPx) continue;

        let nextShape: AnnotationShape | undefined;
        if (stroke.shape) {
          const s = stroke.shape;
          if (s.type === 'line') {
            nextShape = { ...s, y1: mapNormY(s.y1), y2: mapNormY(s.y2) };
          } else if (s.type === 'arc') {
            nextShape = { ...s, y1: mapNormY(s.y1), cy: mapNormY(s.cy), y2: mapNormY(s.y2) };
          } else if (s.type === 'ellipse') {
            const isIso = Boolean(s.isCircle || (s.rotation && Math.abs(s.rotation) > 0.001));
            nextShape = isIso
              ? {
                  ...s,
                  cy: mapNormY(s.cy),
                  rx: s.rx * circleScaleComp,
                  ry: s.ry * circleScaleComp,
                }
              : {
                  ...s,
                  cy: mapNormY(s.cy),
                  ry: s.ry * yStretch,
                };
          } else if (s.type === 'polygon') {
            nextShape = {
              ...s,
              points: s.points.map((p) => ({ x: p.x, y: mapNormY(p.y) })),
            };
          } else if (s.type === 'curve') {
            nextShape = {
              ...s,
              points: s.points.map((p) => ({ x: p.x, y: mapNormY(p.y) })),
            };
          } else if (s.type === 'arrow') {
            nextShape = {
              ...s,
              y1: mapNormY(s.y1),
              y2: mapNormY(s.y2),
              leftY: mapNormY(s.leftY),
              rightY: mapNormY(s.rightY),
              ...(s.cy !== undefined ? { cy: mapNormY(s.cy) } : {}),
              ...(s.tailLeftY !== undefined ? { tailLeftY: mapNormY(s.tailLeftY) } : {}),
              ...(s.tailRightY !== undefined ? { tailRightY: mapNormY(s.tailRightY) } : {}),
            };
          } else if (s.type === 'brace') {
            nextShape = { ...s, y1: mapNormY(s.y1), y2: mapNormY(s.y2) };
          }
        }

        out.push({
          ...stroke,
          points: stroke.points.map((pt) => ({ ...pt, y: mapNormY(pt.y) })),
          ...(nextShape ? { shape: nextShape } : {}),
        });
      }
      return out;
    },
    []
  );

  useEffect(() => {
    registerMushafExportProvider({
      currentPage: clampedMushafPage,
      totalPages: TOTAL_MUSHAF_PAGES,
      surahsOnCurrentPage,
      allSurahs: allSurahExportOptions,
      navigateToPageForExport,
      restorePageAfterExport,
      transformStrokesForExport,
    });
  }, [
    registerMushafExportProvider,
    clampedMushafPage,
    surahsOnCurrentPage,
    allSurahExportOptions,
    navigateToPageForExport,
    restorePageAfterExport,
    transformStrokesForExport,
  ]);

  useEffect(() => {
    return () => {
      registerMushafExportProvider(null);
    };
  }, [registerMushafExportProvider]);

  const quranIndex = useMemo(
    () => (mushafDataset ? getOrBuildQuranIndex(mushafDataset) : null),
    [mushafDataset]
  );

  const currentPageActiveQuarter = quranIndex?.activeQuarterByPage.get(clampedMushafPage) ?? null;
  const currentPageQuarters = quranIndex?.quartersByPage.get(clampedMushafPage) ?? [];
  const currentPageSajdahs = quranIndex?.sajdahsByPage.get(clampedMushafPage) ?? [];

  const { pageAyahList, pageWordKeysByAyah, pageFirstWordKeys } = useMemo(() => {
    if (!activeSinglePageData) {
      return {
        pageAyahList: [] as Array<{ key: string; surahId: number; ayahNum: number; surahName: string }>,
        pageWordKeysByAyah: new Map<string, string[]>(),
        pageFirstWordKeys: new Set<string>(),
      };
    }

    // Check if the first Ayah on this page actually started on the previous page (continued mid-ayah)
    let continuedAyahKeyFromPrevPage: string | null = null;
    if (clampedMushafPage > 1 && mushafDataset?.pages[clampedMushafPage - 2]) {
      const prevRaw = mushafDataset.pages[clampedMushafPage - 2];
      for (let rIdx = prevRaw.rows.length - 1; rIdx >= 0; rIdx--) {
        const pr = prevRaw.rows[rIdx];
        if (pr.k === 't' && pr.r && pr.r.length > 0) {
          const lastRun = pr.r[pr.r.length - 1];
          if (lastRun.e !== 1) {
            continuedAyahKeyFromPrevPage = `${lastRun.s}:${lastRun.a}`;
          }
          break;
        }
        if (pr.k === 'b' || pr.k === 'm') break;
      }
    }

    const seen = new Set<string>();
    const list: Array<{ key: string; surahId: number; ayahNum: number; surahName: string }> = [];
    const wordMap = new Map<string, string[]>();
    const firstWordSet = new Set<string>();

    for (const row of activeSinglePageData.rows) {
      if (row.kind !== 'text') continue;
      for (const item of row.items) {
        const key = `${item.surahId}:${item.ayahNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            key,
            surahId: item.surahId,
            ayahNum: item.ayahNum,
            surahName: surahMetaMap.get(item.surahId)?.name || '',
          });
        }
        if (item.kind === 'word') {
          let arr = wordMap.get(key);
          if (!arr) {
            arr = [];
            wordMap.set(key, arr);
            if (key !== continuedAyahKeyFromPrevPage) {
              firstWordSet.add(item.keyPrefix);
            }
          }
          arr.push(item.keyPrefix);
        }
      }
    }
    return { pageAyahList: list, pageWordKeysByAyah: wordMap, pageFirstWordKeys: firstWordSet };
  }, [activeSinglePageData, surahMetaMap, clampedMushafPage, mushafDataset]);

  useEffect(() => {
    if (pageAyahList.length === 0) {
      setRangeStartKey('');
      setRangeEndKey('');
      return;
    }
    setRangeStartKey((prev) =>
      pageAyahList.some((a) => a.key === prev) ? prev : pageAyahList[0].key
    );
    setRangeEndKey((prev) =>
      pageAyahList.some((a) => a.key === prev)
        ? prev
        : pageAyahList[Math.min(pageAyahList.length - 1, 2)].key
    );
  }, [pageAyahList]);

  const currentPageBookmark = useMemo(
    () => bookmarks.find((bm) => bm.pageNum === clampedMushafPage),
    [bookmarks, clampedMushafPage]
  );

  const savedStudentNames = useMemo(() => {
    const set = new Set<string>();
    for (const profile of studentProfiles) {
      if (profile.name.trim()) set.add(profile.name.trim());
    }
    for (const bm of bookmarks) {
      if (bm.studentName?.trim()) set.add(bm.studentName.trim());
    }
    return Array.from(set);
  }, [bookmarks, studentProfiles]);

  const filteredBookmarks = useMemo(() => {
    if (bookmarkStudentFilter === 'all') return bookmarks;
    return bookmarks.filter((bm) => (bm.studentName || '').trim() === bookmarkStudentFilter);
  }, [bookmarks, bookmarkStudentFilter]);

  const surahTotalTargets = useMemo(() => {
    if (!hasPractice) return 0;
    let count = 0;
    for (const pageData of visiblePagesData) {
      if (!pageData) continue;
      for (const row of pageData.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          for (const t of item.tokens) {
            if (t.type === 'letter' && t.isTarget) count++;
          }
        }
      }
    }
    return count;
  }, [hasPractice, visiblePagesData]);

  const surahFoundCount = useMemo(() => {
    if (!hasPractice) return 0;
    let count = 0;
    for (const pageData of visiblePagesData) {
      if (!pageData) continue;
      for (const row of pageData.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          for (let tIdx = 0; tIdx < item.tokens.length; tIdx++) {
            const key = `${item.keyPrefix}_${tIdx}`;
            if (item.tokens[tIdx].isTarget && surahCorrectMap[key]) count++;
          }
        }
      }
    }
    return count;
  }, [hasPractice, visiblePagesData, surahCorrectMap]);

  const handleSelectSurah = (name: string) => {
    const target = mushafSurahs.find((s) => s.name === name);
    setSelectedSurah(name);
    if (target) {
      setCurrentMushafPage(target.startPage);
    }
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
    setFocusedAyahKeys([]);
    setIsFocusPickerOpen(false);
    setHifzTargetRangeKeys(null);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const handleJumpToPage = (pageNum: number) => {
    const clampedPage = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, pageNum));
    setCurrentMushafPage(clampedPage);
    const pNames = getPageSurahNames(mushafDataset?.pages[clampedPage - 1]);
    if (pNames[0]) {
      setSelectedSurah(pNames[0]);
    }
    setSurahRevealed(false);
    setSurahStatus({ msg: '', kind: null });
    setFocusedAyahKeys([]);
    setIsFocusPickerOpen(false);
    setHifzTargetRangeKeys(null);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const triggerTurnEffect = useCallback((dir: 'next' | 'prev') => {
    turnSeqRef.current += 1;
    setPageTurn({ dir, seq: turnSeqRef.current });
  }, []);

  useEffect(() => {
    if (!pageTurn) return;
    const timer = window.setTimeout(() => {
      setPageTurn((prev) => (prev && prev.seq === pageTurn.seq ? null : prev));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [pageTurn]);

  const handleStepMushafPage = (delta: number) => {
    const target = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, clampedMushafPage + delta));
    if (target === clampedMushafPage) return;
    handleJumpToPage(target);
    triggerTurnEffect(delta > 0 ? 'next' : 'prev');
  };

  useEffect(() => {
    if (variant !== 'standalone') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFocusLensOpen || tafsirTarget !== null || audioModalTarget !== null || isSearchModalOpen || isIndexModalOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (clampedMushafPage > 1) {
          handleJumpToPage(clampedMushafPage - 1);
          triggerTurnEffect('prev');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    variant,
    clampedMushafPage,
    mushafDataset,
    triggerTurnEffect,
    isFocusLensOpen,
    tafsirTarget,
    audioModalTarget,
    isSearchModalOpen,
    isIndexModalOpen,
  ]);

  const handleSurahLetterClick = (unit: MushafLetterUnit, key: string) => {
    if (!hasPractice || mushafMode !== 'practice') return;

    if (surahCorrectMap[key]) {
      const next = { ...surahCorrectMap, [key]: false };
      setSurahCorrectMap(next);
      setSurahStatus({ msg: '', kind: null });
      return;
    }

    if (unit.isTarget) {
      onPlayChime?.(true);
      const next = { ...surahCorrectMap, [key]: true };
      setSurahCorrectMap(next);
      setSurahStatus({
        msg: practiceConfig?.hitMessage || 'أحسنت! إجابة صحيحة ✓',
        kind: 'ok',
      });

      const newFound = surahFoundCount + 1;
      if (newFound === surahTotalTargets && surahTotalTargets > 0) {
        setSurahStatus({
          msg:
            practiceConfig?.completeSingleMessage ||
            `ممتاز! وجدت كل ${practiceConfig?.targetLabel || 'المواضع المطلوبة'} في هذه الصفحة ✓`,
          kind: 'ok',
        });
        onTriggerConfetti?.();
        practiceConfig?.onPracticeComplete?.();
      }
    } else {
      onPlayChime?.(false);
      setSurahWrongKey(key);
      setSurahStatus({
        msg: practiceConfig?.missMessage || 'حاول مرة أخرى، هذا ليس الحرف المطلوب',
        kind: 'bad',
      });
      setTimeout(() => setSurahWrongKey(null), 450);
    }
  };

  const handleSurahLetterClickRef = useRef(handleSurahLetterClick);
  handleSurahLetterClickRef.current = handleSurahLetterClick;
  const stableSurahLetterClick = useCallback((unit: MushafLetterUnit, key: string) => {
    handleSurahLetterClickRef.current(unit, key);
  }, []);

  const isEffectivePractice = hasPractice && mushafMode === 'practice';
  const hasTeacherActiveState = isFocusMode || isHifzHidden;

  const liquidCardRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const liquidMoveRafRef = useRef(0);
  const liquidPendingPtRef = useRef<{ el: HTMLElement; x: number; y: number } | null>(null);

  const handleLiquidPointerEnter = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    liquidCardRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const handleLiquidPointerLeave = useCallback(() => {
    liquidCardRectRef.current = null;
  }, []);

  const handleLiquidPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    liquidPendingPtRef.current = { el, x: e.clientX, y: e.clientY };
    if (liquidMoveRafRef.current) return;
    liquidMoveRafRef.current = window.requestAnimationFrame(() => {
      liquidMoveRafRef.current = 0;
      const pt = liquidPendingPtRef.current;
      if (!pt) return;
      const rect = liquidCardRectRef.current ?? pt.el.getBoundingClientRect();
      if (!liquidCardRectRef.current) {
        liquidCardRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
      if (rect.width <= 0 || rect.height <= 0) return;
      const xPct = Math.max(0, Math.min(100, ((pt.x - rect.left) / rect.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((pt.y - rect.top) / rect.height) * 100));
      pt.el.style.setProperty('--lg-x', `${xPct.toFixed(1)}%`);
      pt.el.style.setProperty('--lg-y', `${yPct.toFixed(1)}%`);
    });
  }, []);

  useEffect(() => {
    if (!isFocusLensOpen) {
      liquidCardRectRef.current = null;
      if (liquidMoveRafRef.current) {
        window.cancelAnimationFrame(liquidMoveRafRef.current);
        liquidMoveRafRef.current = 0;
      }
    }
  }, [isFocusLensOpen]);

  const pageAyahIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    pageAyahList.forEach((a, idx) => map.set(a.key, idx));
    return map;
  }, [pageAyahList]);

  const pageAyahGroupsBySurah = useMemo(() => {
    const groups: Array<{
      surahId: number;
      surahName: string;
      ayahs: Array<{ key: string; surahId: number; ayahNum: number; surahName: string }>;
    }> = [];
    for (const ayah of pageAyahList) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.surahId === ayah.surahId) {
        lastGroup.ayahs.push(ayah);
      } else {
        groups.push({
          surahId: ayah.surahId,
          surahName: ayah.surahName,
          ayahs: [ayah],
        });
      }
    }
    return groups;
  }, [pageAyahList]);

  const sortFocusKeys = useCallback(
    (keys: Iterable<string>): string[] => {
      const unique = Array.from(new Set(keys)).filter((k) => pageAyahIndexMap.has(k));
      unique.sort((a, b) => (pageAyahIndexMap.get(a) ?? 0) - (pageAyahIndexMap.get(b) ?? 0));
      return unique;
    },
    [pageAyahIndexMap]
  );

  useEffect(() => {
    if (isFocusMode && focusedAyahKeys.length === 0 && pageAyahList.length > 0) {
      setFocusedAyahKeys([pageAyahList[0].key]);
    }
  }, [isFocusMode, focusedAyahKeys.length, pageAyahList]);

  const handleToggleFocusMode = () => {
    if (isFocusMode) {
      setIsFocusMode(false);
      setIsFocusLensOpen(false);
      setIsFocusPickerOpen(false);
      setFocusedAyahKeys([]);
    } else {
      setIsFocusMode(true);
      setAnnotationTool('cursor');
      if (pageAyahList.length > 0) {
        setFocusedAyahKeys([pageAyahList[0].key]);
      }
    }
  };

  const focusedAyahSet = useMemo(() => new Set(focusedAyahKeys), [focusedAyahKeys]);

  const focusedAyahIndices = useMemo(() => {
    const indices: number[] = [];
    for (const k of focusedAyahKeys) {
      const idx = pageAyahIndexMap.get(k);
      if (idx !== undefined) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    return indices;
  }, [focusedAyahKeys, pageAyahIndexMap]);

  const firstFocusedIdx = focusedAyahIndices.length > 0 ? focusedAyahIndices[0] : -1;
  const lastFocusedIdx =
    focusedAyahIndices.length > 0 ? focusedAyahIndices[focusedAyahIndices.length - 1] : -1;

  const focusedAyahMetas = useMemo(
    () => focusedAyahIndices.map((idx) => pageAyahList[idx]).filter(Boolean),
    [focusedAyahIndices, pageAyahList]
  );

  const primaryFocusedAyahMeta = focusedAyahMetas[0] ?? null;
  const focusedCount = focusedAyahMetas.length;

  const isFocusedContiguous = useMemo(() => {
    if (focusedAyahIndices.length <= 1) return true;
    for (let i = 1; i < focusedAyahIndices.length; i++) {
      if (focusedAyahIndices[i] !== focusedAyahIndices[i - 1] + 1) return false;
    }
    return true;
  }, [focusedAyahIndices]);

  const focusedSingleSurahName = useMemo(() => {
    if (focusedAyahMetas.length === 0) return null;
    const firstSurahId = focusedAyahMetas[0].surahId;
    return focusedAyahMetas.every((m) => m.surahId === firstSurahId)
      ? focusedAyahMetas[0].surahName
      : null;
  }, [focusedAyahMetas]);

  const focusedCompactLabel = useMemo(() => {
    if (focusedAyahMetas.length === 0) return 'اختر آية';
    if (focusedAyahMetas.length === 1) {
      return `آية ${toArabicDigits(focusedAyahMetas[0].ayahNum)}`;
    }
    if (isFocusedContiguous && focusedSingleSurahName) {
      const firstNum = toArabicDigits(focusedAyahMetas[0].ayahNum);
      const lastNum = toArabicDigits(focusedAyahMetas[focusedAyahMetas.length - 1].ayahNum);
      return `آيات ${firstNum} – ${lastNum}`;
    }
    if (focusedAyahMetas.length <= 3 && focusedSingleSurahName) {
      return `آيات ${focusedAyahMetas.map((m) => toArabicDigits(m.ayahNum)).join('، ')}`;
    }
    return `${toArabicDigits(focusedAyahMetas.length)} آيات`;
  }, [focusedAyahMetas, isFocusedContiguous, focusedSingleSurahName]);

  const focusedLensTitle = useMemo(() => {
    if (focusedAyahMetas.length === 0) return { surah: '', ayahs: '' };
    if (focusedSingleSurahName) {
      if (focusedAyahMetas.length === 1) {
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآية ${toArabicDigits(focusedAyahMetas[0].ayahNum)}`,
        };
      }
      if (isFocusedContiguous) {
        const firstNum = toArabicDigits(focusedAyahMetas[0].ayahNum);
        const lastNum = toArabicDigits(focusedAyahMetas[focusedAyahMetas.length - 1].ayahNum);
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآيات ${firstNum} – ${lastNum}`,
        };
      }
      if (focusedAyahMetas.length <= 4) {
        return {
          surah: `سورة ${focusedSingleSurahName}`,
          ayahs: `الآيات ${focusedAyahMetas.map((m) => toArabicDigits(m.ayahNum)).join('، ')}`,
        };
      }
      return {
        surah: `سورة ${focusedSingleSurahName}`,
        ayahs: `مقطع مختار (${toArabicDigits(focusedAyahMetas.length)} آيات)`,
      };
    }
    const uniqueSurahs = Array.from(new Set(focusedAyahMetas.map((m) => m.surahName)));
    return {
      surah: uniqueSurahs.map((s) => `سورة ${s}`).join(' · '),
      ayahs: `${toArabicDigits(focusedAyahMetas.length)} آيات مختارة`,
    };
  }, [focusedAyahMetas, focusedSingleSurahName, isFocusedContiguous]);

  /**
   * Groups focused word items into natural Mushaf passages:
   * - Contiguous ayahs within the same Surah stay seamlessly joined together.
   * - Skipped ayah gaps or Surah transitions create clean separated blocks.
   */
  const focusedLensPassageGroups = useMemo(() => {
    if (!activeSinglePageData || focusedAyahSet.size === 0) return [];

    // 1. Collect all line items (words + standalone rosettes) per focused ayah key
    const itemsByAyah = new Map<string, MushafLineItem[]>();
    for (const row of activeSinglePageData.rows) {
      if (row.kind !== 'text') continue;
      for (const item of row.items) {
        const k = `${item.surahId}:${item.ayahNum}`;
        if (!focusedAyahSet.has(k)) continue;
        const arr = itemsByAyah.get(k);
        if (arr) arr.push(item);
        else itemsByAyah.set(k, [item]);
      }
    }

    // 2. Partition focused indices into contiguous same-surah runs
    const groups: Array<{
      id: string;
      surahId: number;
      surahName: string;
      ayahLabel: string;
      items: MushafLineItem[];
    }> = [];

    let runStartIdx = 0;
    while (runStartIdx < focusedAyahIndices.length) {
      let runEndIdx = runStartIdx;
      const startMeta = pageAyahList[focusedAyahIndices[runStartIdx]];
      while (
        runEndIdx + 1 < focusedAyahIndices.length &&
        focusedAyahIndices[runEndIdx + 1] === focusedAyahIndices[runEndIdx] + 1 &&
        pageAyahList[focusedAyahIndices[runEndIdx + 1]]?.surahId === startMeta.surahId
      ) {
        runEndIdx++;
      }

      const runMetas = focusedAyahIndices
        .slice(runStartIdx, runEndIdx + 1)
        .map((i) => pageAyahList[i])
        .filter(Boolean);
      const runItems: MushafLineItem[] = [];
      for (const meta of runMetas) {
        const list = itemsByAyah.get(meta.key);
        if (list) runItems.push(...list);
      }

      const firstNum = runMetas[0].ayahNum;
      const lastNum = runMetas[runMetas.length - 1].ayahNum;
      groups.push({
        id: `${runMetas[0].key}_${runMetas[runMetas.length - 1].key}`,
        surahId: startMeta.surahId,
        surahName: startMeta.surahName,
        ayahLabel:
          runMetas.length === 1
            ? `الآية ${toArabicDigits(firstNum)}`
            : `الآيات ${toArabicDigits(firstNum)} – ${toArabicDigits(lastNum)}`,
        items: runItems,
      });

      runStartIdx = runEndIdx + 1;
    }

    return groups;
  }, [activeSinglePageData, focusedAyahSet, focusedAyahIndices, pageAyahList]);

  const canStepFocusPrev = firstFocusedIdx > 0;
  const canStepFocusNext = lastFocusedIdx >= 0 && lastFocusedIdx < pageAyahList.length - 1;
  const canAppendFocusAyah =
    pageAyahList.length > 0 && focusedAyahIndices.length < pageAyahList.length;

  const handleToggleFocusAyahKey = useCallback(
    (aKey: string) => {
      setFocusedAyahKeys((prev) => {
        if (prev.includes(aKey)) {
          if (prev.length <= 1) return prev;
          return sortFocusKeys(prev.filter((k) => k !== aKey));
        }
        return sortFocusKeys([...prev, aKey]);
      });
    },
    [sortFocusKeys]
  );

  const handleAppendFocusedAyah = useCallback(() => {
    if (pageAyahList.length === 0) return;
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      if (ordered.length === 0) return [pageAyahList[0].key];
      const indices = ordered
        .map((k) => pageAyahIndexMap.get(k))
        .filter((v): v is number => v !== undefined);
      const maxIdx = Math.max(...indices);
      const minIdx = Math.min(...indices);
      if (maxIdx < pageAyahList.length - 1) {
        return sortFocusKeys([...ordered, pageAyahList[maxIdx + 1].key]);
      }
      if (minIdx > 0) {
        return sortFocusKeys([...ordered, pageAyahList[minIdx - 1].key]);
      }
      // Fill any interior gap if both ends are already selected
      const missing = pageAyahList.find((a) => !ordered.includes(a.key));
      return missing ? sortFocusKeys([...ordered, missing.key]) : ordered;
    });
  }, [pageAyahList, pageAyahIndexMap, sortFocusKeys]);

  const handleRemoveLastFocusedAyah = useCallback(() => {
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      if (ordered.length <= 1) return ordered;
      return ordered.slice(0, -1);
    });
  }, [sortFocusKeys]);

  const handleResetToSingleFocus = useCallback(() => {
    setFocusedAyahKeys((prev) => {
      const ordered = sortFocusKeys(prev);
      return ordered.length > 0 ? [ordered[0]] : ordered;
    });
  }, [sortFocusKeys]);

  const handleSelectAllPageFocus = useCallback(() => {
    if (pageAyahList.length === 0) return;
    setFocusedAyahKeys(pageAyahList.map((a) => a.key));
  }, [pageAyahList]);

  const scrollAyahIntoView = useCallback(
    (ayahKey: string) => {
      if (typeof window === 'undefined') return;
      window.requestAnimationFrame(() => {
        if (isFocusLensOpen) {
          const stageEl = lensStageRef.current;
          if (!stageEl) return;
          const els = stageEl.querySelectorAll<HTMLElement>(`[data-lens-ayah-key="${ayahKey}"]`);
          if (els.length === 0) return;
          const stageRect = stageEl.getBoundingClientRect();
          let minTop = Infinity;
          let maxBottom = -Infinity;
          els.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.top < minTop) minTop = r.top;
            if (r.bottom > maxBottom) maxBottom = r.bottom;
          });
          if (maxBottom > stageRect.bottom - 18 || minTop < stageRect.top + 18) {
            const delta = minTop - (stageRect.top + 28);
            stageEl.scrollTo({
              top: Math.max(0, stageEl.scrollTop + delta),
              behavior: 'smooth',
            });
          }
          return;
        }

        const bodyEl = pageBodyRef.current;
        if (!bodyEl) return;
        const els = bodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${ayahKey}"]`);
        if (els.length === 0) return;

        let minTop = Infinity;
        let maxBottom = -Infinity;
        els.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top < minTop) minTop = r.top;
          if (r.bottom > maxBottom) maxBottom = r.bottom;
        });

        const topSafe = showFloatingHud ? 108 : 64;
        const bottomSafe = window.innerHeight - 108;
        if (maxBottom <= bottomSafe && minTop >= topSafe) {
          return;
        }

        const ayahHeight = maxBottom - minTop;
        const safeHeight = Math.max(120, bottomSafe - topSafe);
        let desiredTop = topSafe + 18;
        if (ayahHeight <= safeHeight && maxBottom > bottomSafe) {
          desiredTop = Math.max(
            topSafe + 18,
            Math.min(topSafe + safeHeight * 0.32, bottomSafe - ayahHeight - 20)
          );
        }

        const deltaY = minTop - desiredTop;
        const prefersReduced =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({
          top: Math.max(0, window.scrollY + deltaY),
          behavior: prefersReduced ? 'auto' : 'smooth',
        });
      });
    },
    [isFocusLensOpen, showFloatingHud]
  );

  const scrollToMushafTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const targetEl = pageBodyRef.current || hudSlotRef.current;
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const topTarget = Math.max(0, window.scrollY + rect.top - 72);
      const prefersReduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: topTarget, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
  }, []);

  useEffect(() => {
    const key = pendingScrollAyahRef.current;
    if (!key) return;
    pendingScrollAyahRef.current = null;
    scrollAyahIntoView(key);
  }, [focusedAyahKeys, revealedAyahKeys, scrollAyahIntoView]);

  const handleStepFocusedAyah = useCallback(
    (delta: -1 | 1) => {
      if (pageAyahList.length === 0) return;
      setFocusedAyahKeys((prev) => {
        const ordered = sortFocusKeys(prev);
        if (ordered.length === 0) {
          pendingScrollAyahRef.current = pageAyahList[0].key;
          return [pageAyahList[0].key];
        }
        const indices = ordered
          .map((k) => pageAyahIndexMap.get(k))
          .filter((v): v is number => v !== undefined);
        if (indices.length === 0) {
          pendingScrollAyahRef.current = pageAyahList[0].key;
          return [pageAyahList[0].key];
        }
        if (delta < 0 && indices[0] <= 0) return ordered;
        if (delta > 0 && indices[indices.length - 1] >= pageAyahList.length - 1) return ordered;
        const shifted = indices.map((idx) =>
          pageAyahList[Math.max(0, Math.min(pageAyahList.length - 1, idx + delta))].key
        );
        const nextOrdered = sortFocusKeys(shifted);
        pendingScrollAyahRef.current =
          delta > 0 ? nextOrdered[nextOrdered.length - 1] : nextOrdered[0];
        return nextOrdered;
      });
    },
    [pageAyahList, pageAyahIndexMap, sortFocusKeys]
  );

  useEffect(() => {
    if (!isFocusLensOpen || tafsirTarget !== null || audioModalTarget !== null) return;
    const handleLensKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsFocusLensOpen(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleStepFocusedAyah(1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleStepFocusedAyah(-1);
      }
    };
    window.addEventListener('keydown', handleLensKeyDown, true);
    return () => window.removeEventListener('keydown', handleLensKeyDown, true);
  }, [isFocusLensOpen, tafsirTarget, audioModalTarget, handleStepFocusedAyah]);

  const hifzTargetAyahSet = useMemo(
    () => (hifzTargetRangeKeys && hifzTargetRangeKeys.length > 0 ? new Set(hifzTargetRangeKeys) : null),
    [hifzTargetRangeKeys]
  );

  const hifzEffectiveFirstWordKeys = useMemo(
    () => (isHifzHidden && isHifzFirstWordCue ? pageFirstWordKeys : null),
    [isHifzHidden, isHifzFirstWordCue, pageFirstWordKeys]
  );

  const hifzTargetedAyahList = useMemo(
    () =>
      hifzTargetAyahSet
        ? pageAyahList.filter((a) => hifzTargetAyahSet.has(a.key))
        : pageAyahList,
    [pageAyahList, hifzTargetAyahSet]
  );

  const hifzRevealedAyahCount = useMemo(() => {
    if (!isHifzHidden) return 0;
    let count = 0;
    for (const a of hifzTargetedAyahList) {
      if (revealedAyahKeys[a.key]) {
        count++;
        continue;
      }
      const wKeys = pageWordKeysByAyah.get(a.key);
      if (wKeys && wKeys.length > 0 && wKeys.every((wk) => Boolean(revealedWordKeys[wk]) || (isHifzFirstWordCue && pageFirstWordKeys.has(wk)))) {
        count++;
      }
    }
    return count;
  }, [isHifzHidden, hifzTargetedAyahList, revealedAyahKeys, pageWordKeysByAyah, revealedWordKeys, isHifzFirstWordCue, pageFirstWordKeys]);

  const handleToggleHifzMode = () => {
    if (isHifzHidden) {
      setIsHifzHidden(false);
      setHifzTargetRangeKeys(null);
      setHifzSlipCount(0);
      setRevealedWordKeys({});
      setRevealedAyahKeys({});
    } else {
      setIsHifzHidden(true);
      setAnnotationTool('cursor');
      setHifzSlipCount(0);
      setRevealedWordKeys({});
      setRevealedAyahKeys({});
    }
  };

  const handleRevealNextAyah = useCallback(
    (allowNextPage = false) => {
      if (hifzTargetedAyahList.length === 0) return;
      const nextHidden = hifzTargetedAyahList.find((a) => {
        if (revealedAyahKeys[a.key]) return false;
        const wordKeys = pageWordKeysByAyah.get(a.key);
        if (
          wordKeys &&
          wordKeys.length > 0 &&
          wordKeys.every((wk) => Boolean(revealedWordKeys[wk]))
        ) {
          return false;
        }
        return true;
      });
      if (!nextHidden) {
        if (allowNextPage && !hifzTargetAyahSet && clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
          scrollToMushafTop();
        }
        return;
      }
      pendingScrollAyahRef.current = nextHidden.key;
      setRevealedAyahKeys((prev) => ({ ...prev, [nextHidden.key]: true }));
      if (isFocusMode) {
        setFocusedAyahKeys((prev) => sortFocusKeys([...prev, nextHidden.key]));
      }
    },
    [
      hifzTargetedAyahList,
      hifzTargetAyahSet,
      pageWordKeysByAyah,
      revealedAyahKeys,
      revealedWordKeys,
      isFocusMode,
      sortFocusKeys,
      clampedMushafPage,
      mushafDataset,
      triggerTurnEffect,
      scrollToMushafTop,
    ]
  );

  useEffect(() => {
    if ((!isHifzHidden && !isFocusMode) || tafsirTarget !== null || audioModalTarget !== null || isSearchModalOpen || isIndexModalOpen) return;
    const handleSpaceKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('.apple-palette-dock, .apple-palette-anchor, .audio-dock-anchor, .audio-orb-anchor'))
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (
        target instanceof HTMLElement &&
        target.closest('.mushaf-sticky-hud, .mushaf-hud-launcher, .mushaf-liquid-lens-header, .mushaf-liquid-lens-footer')
      ) {
        target.blur();
      }
      if (e.repeat) return;
      if (isHifzHidden) {
        handleRevealNextAyah(true);
      } else if (isFocusMode) {
        if (canStepFocusNext) {
          handleStepFocusedAyah(1);
        } else if (clampedMushafPage < TOTAL_MUSHAF_PAGES) {
          handleJumpToPage(clampedMushafPage + 1);
          triggerTurnEffect('next');
          scrollToMushafTop();
        }
      }
    };
    window.addEventListener('keydown', handleSpaceKeyDown, true);
    return () => window.removeEventListener('keydown', handleSpaceKeyDown, true);
  }, [
    isHifzHidden,
    isFocusMode,
    tafsirTarget,
    audioModalTarget,
    isSearchModalOpen,
    isIndexModalOpen,
    handleRevealNextAyah,
    handleStepFocusedAyah,
    canStepFocusNext,
    clampedMushafPage,
    mushafDataset,
    triggerTurnEffect,
    scrollToMushafTop,
  ]);

  const handleRevealAllHifz = () => {
    const all: Record<string, boolean> = {};
    for (const a of hifzTargetedAyahList) {
      all[a.key] = true;
    }
    setRevealedAyahKeys(all);
  };

  const handleHideAllHifz = () => {
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const selectedRangeKeys = useMemo(() => {
    if (pageAyahList.length === 0) return [];
    const sIdx = Math.max(0, pageAyahList.findIndex((a) => a.key === rangeStartKey));
    const eIdx = Math.max(0, pageAyahList.findIndex((a) => a.key === rangeEndKey));
    const lo = Math.min(sIdx, eIdx);
    const hi = Math.max(sIdx, eIdx);
    return pageAyahList.slice(lo, hi + 1).map((a) => a.key);
  }, [pageAyahList, rangeStartKey, rangeEndKey]);

  const handleApplyRangeFocus = () => {
    if (selectedRangeKeys.length === 0) return;
    setIsFocusMode(true);
    setAnnotationTool('cursor');
    setFocusedAyahKeys(selectedRangeKeys);
    scrollAyahIntoView(selectedRangeKeys[0]);
  };

  const handleApplyRangeHifz = () => {
    if (selectedRangeKeys.length === 0) return;
    setIsHifzHidden(true);
    setAnnotationTool('cursor');
    setHifzTargetRangeKeys(selectedRangeKeys);
    setHifzSlipCount(0);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
    scrollAyahIntoView(selectedRangeKeys[0]);
  };

  const handleApplyRangeAudio = () => {
    if (selectedRangeKeys.length === 0) return;
    const firstKey = selectedRangeKeys[0];
    const firstMeta = pageAyahList.find((a) => a.key === firstKey);
    if (!firstMeta) return;
    playSpecificAyahRef.current(firstMeta.surahId, firstMeta.ayahNum, {
      resetRepeat: true,
      openBar: true,
      sessionTotalOverride: selectedRangeKeys.length,
      repeatSectionOverride: false,
    });
  };

  const handleHideFocusedInHifz = () => {
    if (focusedAyahKeys.length === 0) return;
    setIsHifzHidden(true);
    setAnnotationTool('cursor');
    setHifzTargetRangeKeys([...focusedAyahKeys]);
    setHifzSlipCount(0);
    setRevealedWordKeys({});
    setRevealedAyahKeys({});
  };

  const handleJumpWithHighlight = useCallback(
    (pageNum: number, ayahKey?: string) => {
      if (pageNum !== clampedMushafPage) {
        triggerTurnEffect(pageNum > clampedMushafPage ? 'next' : 'prev');
        handleJumpToPage(pageNum);
      }
      if (ayahKey) {
        pendingScrollAyahRef.current = ayahKey;
        setTransientHighlightAyahKey(ayahKey);
        if (transientHighlightTimerRef.current !== null) {
          window.clearTimeout(transientHighlightTimerRef.current);
        }
        transientHighlightTimerRef.current = window.setTimeout(() => {
          setTransientHighlightAyahKey(null);
          transientHighlightTimerRef.current = null;
        }, 3200);
        if (pageNum === clampedMushafPage) {
          scrollAyahIntoView(ayahKey);
        }
      }
    },
    [clampedMushafPage, triggerTurnEffect, scrollAyahIntoView]
  );

  const handleSelectSearchResult = useCallback(
    (result: QuranSearchResult) => {
      const aKey =
        result.surahId && result.ayahNum ? `${result.surahId}:${result.ayahNum}` : undefined;
      handleJumpWithHighlight(result.pageNum, aKey);
    },
    [handleJumpWithHighlight]
  );

  const areAllFocusedRevealed = useMemo(
    () => focusedAyahMetas.length > 0 && focusedAyahMetas.every((m) => Boolean(revealedAyahKeys[m.key])),
    [focusedAyahMetas, revealedAyahKeys]
  );

  const handleToggleRevealFocusedAyahs = useCallback(() => {
    if (focusedAyahMetas.length === 0) return;
    const nextVal = !areAllFocusedRevealed;
    setRevealedAyahKeys((prev) => {
      const updated = { ...prev };
      for (const m of focusedAyahMetas) {
        updated[m.key] = nextVal;
      }
      return updated;
    });
  }, [areAllFocusedRevealed, focusedAyahMetas]);

  const capturedReportAyahKeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of sessionReportDraft.mistakes) {
      set.add(`${m.surahId}:${m.ayahNum}`);
    }
    return set;
  }, [sessionReportDraft.mistakes]);

  useEffect(() => {
    return () => {
      if (reportToastTimerRef.current !== null) {
        window.clearTimeout(reportToastTimerRef.current);
      }
    };
  }, []);

  const showReportToast = useCallback((text: string, action: 'added' | 'updated') => {
    if (reportToastTimerRef.current !== null) {
      window.clearTimeout(reportToastTimerRef.current);
    }
    reportToastSeqRef.current += 1;
    setReportCaptureToast({ text, action, seq: reportToastSeqRef.current });
    reportToastTimerRef.current = window.setTimeout(() => {
      setReportCaptureToast(null);
      reportToastTimerRef.current = null;
    }, 3400);
  }, []);

  const handleCaptureAyahToReport = useCallback(
    async (surahId: number, ayahNum: number): Promise<'added' | 'updated' | null> => {
      const bodyEl = pageBodyRef.current;
      const borderInnerEl = bodyEl?.closest<HTMLElement>('.mushaf-page-border-inner') ?? null;
      if (!bodyEl || !borderInnerEl || isCapturingReportAyah) return null;

      setIsCapturingReportAyah(true);
      try {
        const pageNum = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, currentMushafPage));
        const surfaceId = `mushaf:page:${pageNum}`;
        const strokes = getSurfaceStrokes(surfaceId);
        const surahName =
          surahMetaMap.get(surahId)?.name ??
          mushafSurahs.find((s) => s.id === surahId)?.name ??
          '';
        const extracted = extractAyahTextFromDataset(mushafDataset, surahId, ayahNum);

        const visual = await captureMushafAyahVisual({
          pageBorderInnerEl: borderInnerEl,
          pageBodyEl: bodyEl,
          surahId,
          ayahNum,
          strokes,
        });

        const { action } = upsertCapturedAyahMistake({
          surahId,
          surahName,
          ayahNum,
          pageNum,
          ayahText: extracted.text,
          imageDataUrl: visual.imageDataUrl,
          imageAspectRatio: visual.imageAspectRatio,
        });

        onPlayChime?.(true);
        const verb = action === 'updated' ? 'تم تحديث' : 'تم إرسال';
        showReportToast(
          `${verb} سورة ${surahName} · الآية ${toArabicDigits(ayahNum)} إلى التقرير`,
          action
        );
        return action;
      } catch (err) {
        console.error('[MushafProgram] Failed to capture Ayah for report:', err);
        const msg = err instanceof Error && err.message ? err.message : 'تعذّر التقاط الآية للتقرير.';
        showReportToast(msg, 'updated');
        return null;
      } finally {
        setIsCapturingReportAyah(false);
      }
    },
    [
      currentMushafPage,
      getSurfaceStrokes,
      isCapturingReportAyah,
      mushafDataset,
      mushafSurahs,
      onPlayChime,
      showReportToast,
      surahMetaMap,
    ]
  );

  const handleToggleReportCaptureMode = useCallback(() => {
    setIsReportCaptureMode((prev) => {
      const next = !prev;
      if (next) {
        setAnnotationTool('cursor');
      }
      return next;
    });
  }, [setAnnotationTool]);

  const teacherActionRef = useRef({
    isHifzHidden,
    isFocusMode,
    isReportCaptureMode,
    hifzTargetAyahSet,
    revealedAyahKeys,
    focusedAyahSet,
    sortFocusKeys,
    handleToggleFocusAyahKey,
    handleCaptureAyahToReport,
  });
  teacherActionRef.current = {
    isHifzHidden,
    isFocusMode,
    isReportCaptureMode,
    hifzTargetAyahSet,
    revealedAyahKeys,
    focusedAyahSet,
    sortFocusKeys,
    handleToggleFocusAyahKey,
    handleCaptureAyahToReport,
  };

  // Stable callback identities prevent all 15 MushafLineRow instances from failing React.memo on reveal/focus updates
  const handleWordTeacherClick = useCallback((word: Extract<MushafLineItem, { kind: 'word' }>) => {
    const state = teacherActionRef.current;
    if (state.isReportCaptureMode) {
      void state.handleCaptureAyahToReport(word.surahId, word.ayahNum);
      return;
    }
    const aKey = `${word.surahId}:${word.ayahNum}`;
    const isTargetedHifz =
      state.isHifzHidden && (!state.hifzTargetAyahSet || state.hifzTargetAyahSet.has(aKey));
    if (isTargetedHifz) {
      if (state.revealedAyahKeys[aKey]) {
        setRevealedAyahKeys((prev) => ({ ...prev, [aKey]: false }));
      } else {
        setRevealedWordKeys((prev) => ({ ...prev, [word.keyPrefix]: !prev[word.keyPrefix] }));
      }
      if (state.isFocusMode && !state.focusedAyahSet.has(aKey)) {
        setFocusedAyahKeys((prev) => state.sortFocusKeys([...prev, aKey]));
      }
      return;
    }
    if (state.isFocusMode) {
      state.handleToggleFocusAyahKey(aKey);
    } else if (state.isHifzHidden) {
      setTafsirTarget({ surahId: word.surahId, ayahNum: word.ayahNum });
    }
  }, []);

  const handleAyahTeacherClick = useCallback((surahId: number, ayahNum: number) => {
    const state = teacherActionRef.current;
    if (state.isReportCaptureMode) {
      void state.handleCaptureAyahToReport(surahId, ayahNum);
      return;
    }
    const aKey = `${surahId}:${ayahNum}`;
    const isTargetedHifz =
      state.isHifzHidden && (!state.hifzTargetAyahSet || state.hifzTargetAyahSet.has(aKey));
    if (isTargetedHifz) {
      setRevealedAyahKeys((prev) => ({ ...prev, [aKey]: !prev[aKey] }));
      if (state.isFocusMode && !state.focusedAyahSet.has(aKey)) {
        setFocusedAyahKeys((prev) => state.sortFocusKeys([...prev, aKey]));
      }
      return;
    }
    if (state.isFocusMode) {
      state.handleToggleFocusAyahKey(aKey);
    } else if (state.isHifzHidden) {
      setTafsirTarget({ surahId, ayahNum });
    }
  }, []);

  const handleOpenTafsirForAyah = useCallback((surahId: number, ayahNum: number) => {
    setTafsirTarget({ surahId, ayahNum });
  }, []);

  const handleOpenToolbarTafsir = useCallback(() => {
    const preferred = primaryFocusedAyahMeta ?? pageAyahList[0];
    if (preferred) {
      setTafsirTarget({ surahId: preferred.surahId, ayahNum: preferred.ayahNum });
    } else if (currentSurahEntry) {
      setTafsirTarget({ surahId: currentSurahEntry.id, ayahNum: 1 });
    }
  }, [primaryFocusedAyahMeta, pageAyahList, currentSurahEntry]);

  const audioRuntimeRef = useRef({
    audioTarget,
    audioReciterId,
    audioRate,
    audioRepeat,
    audioRepeatSection,
    audioAutoFollow,
    audioPauseGap,
    audioStopAtPageEnd,
    audioAyahCount,
    audioSectionStart,
    audioSession,
    audioRepeatProgress,
    surahMetaMap,
    mushafDataset,
    clampedMushafPage,
    tafsirTarget,
    isAudioBarOpen,
    handleJumpToPage,
    triggerTurnEffect,
    scrollAyahIntoView,
  });
  audioRuntimeRef.current = {
    audioTarget,
    audioReciterId,
    audioRate,
    audioRepeat,
    audioRepeatSection,
    audioAutoFollow,
    audioPauseGap,
    audioStopAtPageEnd,
    audioAyahCount,
    audioSectionStart,
    audioSession,
    audioRepeatProgress,
    surahMetaMap,
    mushafDataset,
    clampedMushafPage,
    tafsirTarget,
    isAudioBarOpen,
    handleJumpToPage,
    triggerTurnEffect,
    scrollAyahIntoView,
  };

  const playSpecificAyahRef = useRef<
    (
      surahId: number,
      ayahNum: number,
      opts?: {
        resetRepeat?: boolean;
        openBar?: boolean;
        reciterOverride?: ReciterId;
        rateOverride?: PlaybackRateOption;
        keepSession?: boolean;
        sessionTotalOverride?: number;
        repeatSectionOverride?: boolean;
        nextSessionIndexOverride?: number;
      }
    ) => void
  >(() => {});

  const getAudioElement = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    if (!audioElRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';

      const syncRate = () => {
        const rate = audioRuntimeRef.current.audioRate;
        audio.defaultPlaybackRate = rate;
        if (Math.abs(audio.playbackRate - rate) > 0.01) {
          audio.playbackRate = rate;
        }
      };

      const syncAudioBarProgress = () => {
        if (audioPauseTimerRef.current !== null) return;
        if (!audio.getAttribute('src') || !Number.isFinite(audio.duration) || audio.duration <= 0) {
          emitAudioProgress(0, false);
          return;
        }
        emitAudioProgress(Math.max(0, Math.min(1, audio.currentTime / audio.duration)), false);
      };

      audio.addEventListener('loadedmetadata', () => {
        if (!audio.getAttribute('src')) return;
        syncRate();
        syncAudioBarProgress();
      });

      audio.addEventListener('timeupdate', syncAudioBarProgress);

      audio.addEventListener('playing', () => {
        if (!audio.getAttribute('src')) return;
        clearAudioPauseTimer();
        isSwitchingAudioRef.current = false;
        syncRate();
        setIsAudioPlaying(true);
        setIsAudioLoading(false);
        setAudioError(null);
      });

      audio.addEventListener('pause', () => {
        if (isSwitchingAudioRef.current || audioPauseTimerRef.current !== null) return;
        if (!audio.ended) {
          setIsAudioPlaying(false);
        }
      });

      audio.addEventListener('waiting', () => {
        if (!audio.getAttribute('src')) return;
        setIsAudioLoading(true);
      });

      audio.addEventListener('canplay', () => {
        if (!audio.getAttribute('src')) return;
        syncRate();
        setIsAudioLoading(false);
      });

      audio.addEventListener('error', () => {
        if (!audio.getAttribute('src')) return;
        clearAudioPauseTimer();
        isSwitchingAudioRef.current = false;
        setIsAudioPlaying(false);
        setIsAudioLoading(false);
        emitAudioProgress(0, false);
        setAudioError('تعذر تحميل التلاوة الصوتية، تحقق من الاتصال');
      });

      audio.addEventListener('ended', () => {
        const rt = audioRuntimeRef.current;
        const cur = rt.audioTarget;
        if (!cur) {
          setIsAudioPlaying(false);
          emitAudioProgress(0, false);
          return;
        }

        const scheduleAfterGap = (nextStep: () => void) => {
          const gapMode = rt.audioPauseGap;
          const rawGapMs =
            gapMode === '3s'
              ? 3000
              : gapMode === '5s'
              ? 5000
              : gapMode === 'ayah'
              ? Math.max(
                  1500,
                  Math.min(
                    25000,
                    Math.round(
                      (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 4) *
                        1000
                    )
                  )
                )
              : 0;
          if (rawGapMs <= 0) {
            nextStep();
            return;
          }
          clearAudioPauseTimer();
          setAudioPauseGapWaiting(true);
          const startedAt = performance.now();
          emitAudioProgress(1, true);
          const stepCountdown = () => {
            if (audioPauseTimerRef.current === null) return;
            const elapsed = performance.now() - startedAt;
            const remainRatio = Math.max(0, 1 - elapsed / rawGapMs);
            emitAudioProgress(remainRatio, true);
            if (remainRatio > 0) {
              audioPauseRafRef.current = window.requestAnimationFrame(stepCountdown);
            }
          };
          audioPauseTimerRef.current = window.setTimeout(() => {
            clearAudioPauseTimer();
            emitAudioProgress(0, false);
            nextStep();
          }, rawGapMs);
          audioPauseRafRef.current = window.requestAnimationFrame(stepCountdown);
        };

        if (rt.audioRepeat === 0 || rt.audioRepeatProgress < rt.audioRepeat) {
          scheduleAfterGap(() => {
            if (rt.audioRepeat > 1) {
              setAudioRepeatProgress((p) => p + 1);
            }
            audio.currentTime = 0;
            audio.defaultPlaybackRate = rt.audioRate;
            audio.playbackRate = rt.audioRate;
            audio.play().catch(() => {
              setIsAudioPlaying(false);
            });
          });
          return;
        }

        if (rt.audioSession.total > 0 && rt.audioSession.index >= rt.audioSession.total) {
          const shouldLoopSection =
            rt.audioSession.total > 1 && (rt.audioSession.repeatSection ?? rt.audioRepeatSection);
          if (shouldLoopSection && rt.audioSectionStart) {
            const loopStart = rt.audioSectionStart;
            scheduleAfterGap(() => {
              setAudioSession({
                total: rt.audioSession.total,
                index: 1,
                repeatSection: shouldLoopSection,
              });
              if (rt.audioAutoFollow && !rt.tafsirTarget) {
                const loopPage = findMushafPageForAyah(
                  rt.mushafDataset,
                  loopStart.surahId,
                  loopStart.ayahNum
                );
                if (loopPage && loopPage !== rt.clampedMushafPage) {
                  rt.handleJumpToPage(loopPage);
                  rt.triggerTurnEffect(loopPage > rt.clampedMushafPage ? 'next' : 'prev');
                }
                rt.scrollAyahIntoView(`${loopStart.surahId}:${loopStart.ayahNum}`);
              }
              playSpecificAyahRef.current(loopStart.surahId, loopStart.ayahNum, {
                resetRepeat: true,
                openBar: false,
                keepSession: true,
                nextSessionIndexOverride: 1,
              });
            });
            return;
          }
          setIsAudioPlaying(false);
          setAudioRepeatProgress(1);
          emitAudioProgress(0, false);
          return;
        }

        const nextAyah = getNextQuranAyah(cur.surahId, cur.ayahNum, rt.surahMetaMap);
        if (!nextAyah) {
          setIsAudioPlaying(false);
          setAudioRepeatProgress(1);
          emitAudioProgress(0, false);
          return;
        }

        if (rt.audioStopAtPageEnd) {
          const curPage =
            findMushafPageForAyah(rt.mushafDataset, cur.surahId, cur.ayahNum) ??
            rt.clampedMushafPage;
          const nextPage = findMushafPageForAyah(
            rt.mushafDataset,
            nextAyah.surahId,
            nextAyah.ayahNum
          );
          if (curPage && nextPage && nextPage !== curPage) {
            setIsAudioPlaying(false);
            setAudioRepeatProgress(1);
            emitAudioProgress(0, false);
            return;
          }
        }

        scheduleAfterGap(() => {
          const nextIndex =
            rt.audioSession.total > 0 ? Math.min(rt.audioSession.total, rt.audioSession.index + 1) : 1;

          if (rt.audioSession.total > 0) {
            setAudioSession((prev) => ({
              total: prev.total,
              index: Math.min(prev.total, prev.index + 1),
              repeatSection: prev.repeatSection,
            }));
          }

          if (rt.audioAutoFollow && !rt.tafsirTarget) {
            const nextPage = findMushafPageForAyah(rt.mushafDataset, nextAyah.surahId, nextAyah.ayahNum);
            if (nextPage && nextPage !== rt.clampedMushafPage) {
              rt.handleJumpToPage(nextPage);
              rt.triggerTurnEffect('next');
            }
            rt.scrollAyahIntoView(`${nextAyah.surahId}:${nextAyah.ayahNum}`);
          }
          playSpecificAyahRef.current(nextAyah.surahId, nextAyah.ayahNum, {
            resetRepeat: true,
            openBar: false,
            keepSession: true,
            nextSessionIndexOverride: nextIndex,
          });
        });
      });

      audioElRef.current = audio;
    }
    return audioElRef.current;
  }, [clearAudioPauseTimer, emitAudioProgress]);

  const playSpecificAyah = useCallback(
    (
      surahId: number,
      ayahNum: number,
      opts?: {
        resetRepeat?: boolean;
        openBar?: boolean;
        reciterOverride?: ReciterId;
        rateOverride?: PlaybackRateOption;
        keepSession?: boolean;
        sessionTotalOverride?: number;
        repeatSectionOverride?: boolean;
        nextSessionIndexOverride?: number;
      }
    ) => {
      const audio = getAudioElement();
      if (!audio) return;

      clearAudioPauseTimer();
      emitAudioProgress(0, false);

      const rt = audioRuntimeRef.current;
      const reciter = opts?.reciterOverride ?? rt.audioReciterId;
      const effectiveRate = opts?.rateOverride ?? rt.audioRate;
      const reqId = ++playbackRequestIdRef.current;

      if (opts?.openBar !== false) {
        setIsAudioBarOpen(true);
      }
      if (opts?.resetRepeat !== false) {
        setAudioRepeatProgress(1);
      }
      if (!opts?.keepSession || opts?.sessionTotalOverride !== undefined) {
        setAudioSession({
          total: opts?.sessionTotalOverride ?? rt.audioAyahCount,
          index: 1,
          repeatSection: opts?.repeatSectionOverride,
        });
        setAudioSectionStart({ surahId, ayahNum });
      }
      setAudioTarget({ surahId, ayahNum });
      setAudioError(null);
      setIsAudioLoading(true);

      const url = getAyahAudioUrl(reciter, surahId, ayahNum);
      if (audio.src !== url) {
        isSwitchingAudioRef.current = true;
        audio.src = url;
      } else {
        audio.currentTime = 0;
      }
      audio.defaultPlaybackRate = effectiveRate;
      audio.playbackRate = effectiveRate;

      const sessionTotalForPreload =
        opts?.sessionTotalOverride !== undefined
          ? opts.sessionTotalOverride
          : opts?.keepSession
          ? rt.audioSession.total
          : rt.audioAyahCount;
      const sessionIndexForPreload =
        opts?.nextSessionIndexOverride ??
        (!opts?.keepSession || opts?.sessionTotalOverride !== undefined ? 1 : rt.audioSession.index);
      const shouldLoopForPreload =
        opts?.repeatSectionOverride ?? rt.audioSession.repeatSection ?? rt.audioRepeatSection;
      const sectionStartForPreload =
        !opts?.keepSession || opts?.sessionTotalOverride !== undefined
          ? { surahId, ayahNum }
          : rt.audioSectionStart;

      audio
        .play()
        .then(() => {
          if (playbackRequestIdRef.current !== reqId) return;
          isSwitchingAudioRef.current = false;
          audio.defaultPlaybackRate = effectiveRate;
          audio.playbackRate = effectiveRate;
          setIsAudioPlaying(true);
          setIsAudioLoading(false);

          if (sessionTotalForPreload === 1) {
            return;
          }
          if (sessionTotalForPreload > 1 && sessionIndexForPreload >= sessionTotalForPreload) {
            if (shouldLoopForPreload && sectionStartForPreload) {
              preloadAyahAudio(
                reciter,
                sectionStartForPreload.surahId,
                sectionStartForPreload.ayahNum
              );
            }
            return;
          }
          const next = getNextQuranAyah(surahId, ayahNum, rt.surahMetaMap);
          if (next) {
            preloadAyahAudio(reciter, next.surahId, next.ayahNum);
          }
        })
        .catch((err: unknown) => {
          if (playbackRequestIdRef.current !== reqId) return;
          isSwitchingAudioRef.current = false;
          const isAbort =
            err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError');
          if (!isAbort) {
            setAudioError('تعذر تشغيل التلاوة، حاول مجدداً');
          }
          setIsAudioPlaying(false);
          setIsAudioLoading(false);
        });
    },
    [getAudioElement, clearAudioPauseTimer, emitAudioProgress]
  );

  playSpecificAyahRef.current = playSpecificAyah;

  const handleTogglePlayAyah = useCallback(
    (surahId: number, ayahNum: number, opts?: { openBar?: boolean }) => {
      const rt = audioRuntimeRef.current;
      const audio = getAudioElement();
      if (!audio) return;
      const isSameTarget =
        rt.audioTarget?.surahId === surahId && rt.audioTarget?.ayahNum === ayahNum;

      if (isSameTarget && !audioError) {
        if (audioPauseTimerRef.current !== null) {
          clearAudioPauseTimer();
          emitAudioProgress(0, false);
          setIsAudioPlaying(false);
          setIsAudioLoading(false);
          return;
        }
        if (!audio.paused) {
          audio.pause();
          setIsAudioPlaying(false);
          setIsAudioLoading(false);
        } else {
          if (opts?.openBar !== false) {
            setIsAudioBarOpen(true);
          }
          if (
            rt.audioSession.total > 1 &&
            rt.audioSession.index >= rt.audioSession.total &&
            audio.ended &&
            rt.audioSectionStart
          ) {
            const restartRef = rt.audioSectionStart;
            const preservedRepeatSection =
              rt.audioSession.repeatSection ?? rt.audioRepeatSection;
            if (rt.audioAutoFollow && !rt.tafsirTarget) {
              const restartPage = findMushafPageForAyah(
                rt.mushafDataset,
                restartRef.surahId,
                restartRef.ayahNum
              );
              if (restartPage && restartPage !== rt.clampedMushafPage) {
                rt.handleJumpToPage(restartPage);
                rt.triggerTurnEffect(restartPage > rt.clampedMushafPage ? 'next' : 'prev');
              }
              rt.scrollAyahIntoView(`${restartRef.surahId}:${restartRef.ayahNum}`);
            }
            playSpecificAyah(restartRef.surahId, restartRef.ayahNum, {
              resetRepeat: true,
              openBar: opts?.openBar,
              sessionTotalOverride: rt.audioSession.total,
              repeatSectionOverride: preservedRepeatSection,
            });
            return;
          }
          if (audio.ended) {
            setAudioRepeatProgress(1);
          }
          audio.defaultPlaybackRate = rt.audioRate;
          audio.playbackRate = rt.audioRate;
          audio
            .play()
            .then(() => {
              audio.defaultPlaybackRate = rt.audioRate;
              audio.playbackRate = rt.audioRate;
              setIsAudioPlaying(true);
              setIsAudioLoading(false);
            })
            .catch(() => {
              playSpecificAyah(surahId, ayahNum, { resetRepeat: false, openBar: opts?.openBar });
            });
        }
        return;
      }

      playSpecificAyah(surahId, ayahNum, { resetRepeat: true, openBar: opts?.openBar });
    },
    [getAudioElement, playSpecificAyah, audioError, clearAudioPauseTimer, emitAudioProgress]
  );

  const handleApplyAudioModal = useCallback(
    (payload: AudioControlApplyPayload) => {
      const rt = audioRuntimeRef.current;
      const wasReciterChanged = payload.reciterId !== rt.audioReciterId;
      const isSameActive =
        rt.audioTarget?.surahId === payload.surahId &&
        rt.audioTarget?.ayahNum === payload.ayahNum;

      setAudioReciterId(payload.reciterId);
      saveReciterId(payload.reciterId);
      setAudioRate(payload.rate);
      savePlaybackRate(payload.rate);
      setAudioRepeat(payload.repeat);
      saveAyahRepeat(payload.repeat);
      setAudioRepeatSection(payload.repeatSection);
      saveSectionRepeat(payload.repeatSection);
      setAudioAutoFollow(payload.autoFollow);
      saveAudioAutoFollow(payload.autoFollow);
      setAudioAyahCount(payload.ayahCount);
      saveAyahCount(payload.ayahCount);
      setAudioSectionStart({ surahId: payload.surahId, ayahNum: payload.ayahNum });
      setAudioRepeatProgress(1);

      if (audioElRef.current) {
        audioElRef.current.defaultPlaybackRate = payload.rate;
        audioElRef.current.playbackRate = payload.rate;
      }

      if (payload.autoFollow) {
        const targetPage = findMushafPageForAyah(rt.mushafDataset, payload.surahId, payload.ayahNum);
        if (targetPage && targetPage !== rt.clampedMushafPage) {
          rt.handleJumpToPage(targetPage);
          rt.triggerTurnEffect(targetPage > rt.clampedMushafPage ? 'next' : 'prev');
        }
        rt.scrollAyahIntoView(`${payload.surahId}:${payload.ayahNum}`);
      }

      if (isSameActive && isAudioPlaying && !wasReciterChanged) {
        setAudioSession({
          total: payload.ayahCount,
          index: 1,
          repeatSection: payload.repeatSection,
        });
        setIsAudioBarOpen(true);
        return;
      }

      setAudioSession({
        total: payload.ayahCount,
        index: 1,
        repeatSection: payload.repeatSection,
      });
      playSpecificAyah(payload.surahId, payload.ayahNum, {
        resetRepeat: true,
        openBar: true,
        reciterOverride: payload.reciterId,
        rateOverride: payload.rate,
        keepSession: true,
        nextSessionIndexOverride: 1,
      });
    },
    [isAudioPlaying, playSpecificAyah]
  );

  const handlePauseCurrentAudio = useCallback(() => {
    clearAudioPauseTimer();
    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
    }
    setIsAudioPlaying(false);
    setIsAudioLoading(false);
  }, [clearAudioPauseTimer]);

  const handleToolbarAudioToggle = useCallback(() => {
    if (!isAudioBarOpen) {
      if (isAudioPlaying) {
        handlePauseCurrentAudio();
        return;
      }
      setIsAudioBarOpen(true);
      if (audioTarget) {
        handleTogglePlayAyah(audioTarget.surahId, audioTarget.ayahNum, { openBar: true });
      } else {
        const preferred = primaryFocusedAyahMeta ?? pageAyahList[0];
        if (preferred) {
          playSpecificAyah(preferred.surahId, preferred.ayahNum, { openBar: true });
        } else if (currentSurahEntry) {
          playSpecificAyah(currentSurahEntry.id, 1, { openBar: true });
        }
      }
      return;
    }

    if (audioTarget) {
      handleTogglePlayAyah(audioTarget.surahId, audioTarget.ayahNum, { openBar: true });
    } else {
      const preferred = primaryFocusedAyahMeta ?? pageAyahList[0];
      if (preferred) {
        playSpecificAyah(preferred.surahId, preferred.ayahNum, { openBar: true });
      } else if (currentSurahEntry) {
        playSpecificAyah(currentSurahEntry.id, 1, { openBar: true });
      }
    }
  }, [
    isAudioBarOpen,
    isAudioPlaying,
    audioTarget,
    primaryFocusedAyahMeta,
    pageAyahList,
    currentSurahEntry,
    handlePauseCurrentAudio,
    playSpecificAyah,
    handleTogglePlayAyah,
  ]);

  const handleCloseAudioBar = useCallback(() => {
    clearAudioPauseTimer();
    emitAudioProgress(0, false);
    playbackRequestIdRef.current += 1;
    isSwitchingAudioRef.current = false;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
    }
    setIsAudioPlaying(false);
    setIsAudioLoading(false);
    setAudioError(null);
    setAudioTarget(null);
    setAudioSectionStart(null);
    setAudioRepeatProgress(1);
    setAudioSession({ total: 0, index: 1 });
  }, [clearAudioPauseTimer, emitAudioProgress]);

  const handleSetDirectRate = useCallback((nextRate: PlaybackRateOption) => {
    setAudioRate(nextRate);
    savePlaybackRate(nextRate);
    if (audioElRef.current) {
      audioElRef.current.defaultPlaybackRate = nextRate;
      audioElRef.current.playbackRate = nextRate;
    }
  }, []);

  const handleSetDirectRepeat = useCallback((nextRepeat: number) => {
    setAudioRepeat(nextRepeat);
    saveAyahRepeat(nextRepeat);
    setAudioRepeatProgress(1);
  }, []);

  const handleSetDirectRepeatSection = useCallback((nextVal: boolean) => {
    setAudioRepeatSection(nextVal);
    saveSectionRepeat(nextVal);
    setAudioSession((prev) => (prev.total > 0 ? { ...prev, repeatSection: nextVal } : prev));
  }, []);

  const handleSetDirectAutoFollow = useCallback((nextVal: boolean) => {
    setAudioAutoFollow(nextVal);
    saveAudioAutoFollow(nextVal);
  }, []);

  const handleSetPauseGap = useCallback((gap: AudioPauseGap) => {
    setAudioPauseGap(gap);
    saveAudioPauseGap(gap);
  }, []);

  const handleSetStopAtPageEnd = useCallback((val: boolean) => {
    setAudioStopAtPageEnd(val);
    saveStopAtPageEnd(val);
  }, []);

  useEffect(() => {
    if (
      isHifzHidden ||
      isFocusMode ||
      (!isAudioBarOpen && !audioTarget) ||
      tafsirTarget !== null ||
      audioModalTarget !== null ||
      isFocusLensOpen
    ) {
      return;
    }
    const onAudioSpaceKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      handleToolbarAudioToggle();
    };
    window.addEventListener('keydown', onAudioSpaceKey);
    return () => window.removeEventListener('keydown', onAudioSpaceKey);
  }, [
    isHifzHidden,
    isFocusMode,
    isAudioBarOpen,
    audioTarget,
    tafsirTarget,
    audioModalTarget,
    isFocusLensOpen,
    handleToolbarAudioToggle,
  ]);

  const handleChangeReciter = useCallback(
    (nextId: ReciterId) => {
      setAudioReciterId(nextId);
      saveReciterId(nextId);
      setAudioError(null);
      const rt = audioRuntimeRef.current;
      if (rt.audioTarget) {
        const wasPlaying = Boolean(audioElRef.current && !audioElRef.current.paused);
        if (wasPlaying || isAudioLoading) {
          playSpecificAyah(rt.audioTarget.surahId, rt.audioTarget.ayahNum, {
            resetRepeat: false,
            openBar: isAudioBarOpen,
            reciterOverride: nextId,
            keepSession: true,
          });
        } else if (audioElRef.current) {
          isSwitchingAudioRef.current = true;
          audioElRef.current.src = getAyahAudioUrl(
            nextId,
            rt.audioTarget.surahId,
            rt.audioTarget.ayahNum
          );
          audioElRef.current.defaultPlaybackRate = rt.audioRate;
          audioElRef.current.playbackRate = rt.audioRate;
          audioElRef.current.load();
          isSwitchingAudioRef.current = false;
        }
      }
    },
    [isAudioLoading, isAudioBarOpen, playSpecificAyah]
  );

  const handleStepAudioAyah = useCallback(
    (delta: -1 | 1) => {
      const cur = audioTarget ?? primaryFocusedAyahMeta ?? pageAyahList[0];
      if (!cur) return;
      const next =
        delta > 0
          ? getNextQuranAyah(cur.surahId, cur.ayahNum, surahMetaMap)
          : getPrevQuranAyah(cur.surahId, cur.ayahNum, surahMetaMap);
      if (!next) return;

      const rt = audioRuntimeRef.current;
      let nextTotal = rt.audioSession.total;
      let nextIndex = rt.audioSession.index;
      let nextRepeatSection = rt.audioSession.repeatSection;

      if (!audioTarget) {
        nextTotal = rt.audioAyahCount;
        nextIndex = 1;
        nextRepeatSection = rt.audioRepeatSection;
        setAudioSectionStart(next);
        setAudioSession({ total: nextTotal, index: 1, repeatSection: nextRepeatSection });
      } else if (rt.audioSession.total > 0) {
        const candidateIdx = rt.audioSession.index + delta;
        if (candidateIdx >= 1 && candidateIdx <= rt.audioSession.total) {
          nextIndex = candidateIdx;
          setAudioSession({
            total: rt.audioSession.total,
            index: nextIndex,
            repeatSection: rt.audioSession.repeatSection,
          });
        } else {
          nextTotal = 0;
          nextIndex = 1;
          nextRepeatSection = false;
          setAudioSectionStart(null);
          setAudioSession({ total: 0, index: 1, repeatSection: false });
        }
      }

      if (rt.audioAutoFollow) {
        const nextPage = findMushafPageForAyah(mushafDataset, next.surahId, next.ayahNum);
        if (nextPage && nextPage !== clampedMushafPage) {
          handleJumpToPage(nextPage);
          triggerTurnEffect(delta > 0 ? 'next' : 'prev');
        }
        scrollAyahIntoView(`${next.surahId}:${next.ayahNum}`);
      }

      playSpecificAyah(next.surahId, next.ayahNum, {
        resetRepeat: true,
        openBar: true,
        keepSession: true,
        sessionTotalOverride: nextTotal,
        repeatSectionOverride: nextRepeatSection,
        nextSessionIndexOverride: nextIndex,
      });
    },
    [
      audioTarget,
      primaryFocusedAyahMeta,
      pageAyahList,
      surahMetaMap,
      mushafDataset,
      clampedMushafPage,
      triggerTurnEffect,
      scrollAyahIntoView,
      playSpecificAyah,
    ]
  );

  const handleJumpToPlayingAyah = useCallback(() => {
    if (!audioTarget) return;
    const p = findMushafPageForAyah(mushafDataset, audioTarget.surahId, audioTarget.ayahNum);
    if (p && p !== clampedMushafPage) {
      handleJumpToPage(p);
      triggerTurnEffect(p > clampedMushafPage ? 'next' : 'prev');
    }
    scrollAyahIntoView(`${audioTarget.surahId}:${audioTarget.ayahNum}`);
  }, [audioTarget, mushafDataset, clampedMushafPage, triggerTurnEffect, scrollAyahIntoView]);

  const handleToggleAyahQuickMenu = useCallback((surahId: number, ayahNum: number) => {
    setTafsirTarget((prev) => {
      if (prev && prev.surahId === surahId && prev.ayahNum === ayahNum) {
        return null;
      }
      return { surahId, ayahNum };
    });
  }, []);

  useEffect(() => {
    if (!pendingMushafJump || !mushafDataset) return;
    handleJumpToPage(pendingMushafJump.pageNum);
    if (pendingMushafJump.surahId > 0 && pendingMushafJump.ayahNum > 0) {
      scrollAyahIntoView(`${pendingMushafJump.surahId}:${pendingMushafJump.ayahNum}`);
    }
    clearPendingMushafJump();
  }, [pendingMushafJump, mushafDataset, handleJumpToPage, scrollAyahIntoView]);

  const handleWordDefaultClick = useCallback(
    (word: Extract<MushafLineItem, { kind: 'word' }>) => {
      if (teacherActionRef.current.isReportCaptureMode) {
        void teacherActionRef.current.handleCaptureAyahToReport(word.surahId, word.ayahNum);
        return;
      }
      handleToggleAyahQuickMenu(word.surahId, word.ayahNum);
    },
    [handleToggleAyahQuickMenu]
  );

  const handleAyahDefaultClick = useCallback(
    (surahId: number, ayahNum: number) => {
      if (teacherActionRef.current.isReportCaptureMode) {
        void teacherActionRef.current.handleCaptureAyahToReport(surahId, ayahNum);
        return;
      }
      handleToggleAyahQuickMenu(surahId, ayahNum);
    },
    [handleToggleAyahQuickMenu]
  );

  const syncSelectedAyahLayer = useCallback(() => {
    const bodyEl = pageBodyRef.current;
    const layerEl = ayahSelectedLayerRef.current;
    if (selectedAyahNodesRef.current.length > 0) {
      for (const node of selectedAyahNodesRef.current) {
        node.classList.remove('is-ayah-selected');
      }
      selectedAyahNodesRef.current = [];
    }
    if (!bodyEl || !layerEl) return;
    const activeTargetKey = tafsirTarget
      ? `${tafsirTarget.surahId}:${tafsirTarget.ayahNum}`
      : transientHighlightAyahKey;
    if (!activeTargetKey) {
      if (layerEl.childElementCount > 0) layerEl.replaceChildren();
      return;
    }

    const nodes = Array.from(bodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${activeTargetKey}"]`));
    if (nodes.length === 0) {
      if (layerEl.childElementCount > 0) layerEl.replaceChildren();
      return;
    }

    const isAlsoPlaying = Boolean(
      tafsirTarget &&
        audioTarget?.surahId === tafsirTarget.surahId &&
        audioTarget?.ayahNum === tafsirTarget.ayahNum
    );
    const isTransientFlash = !tafsirTarget && Boolean(transientHighlightAyahKey);
    const rowBounds = new Map<HTMLElement, { minLeft: number; maxRight: number }>();
    for (const node of nodes) {
      node.classList.add('is-ayah-selected');
      if (isAlsoPlaying) continue;
      const rowEl = node.closest<HTMLElement>('.mushaf-line-row');
      if (!rowEl) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const existing = rowBounds.get(rowEl);
      if (!existing) {
        rowBounds.set(rowEl, { minLeft: rect.left, maxRight: rect.right });
      } else {
        if (rect.left < existing.minLeft) existing.minLeft = rect.left;
        if (rect.right > existing.maxRight) existing.maxRight = rect.right;
      }
    }
    selectedAyahNodesRef.current = nodes;

    if (isAlsoPlaying) {
      if (layerEl.childElementCount > 0) layerEl.replaceChildren();
      return;
    }

    const bodyRect = bodyEl.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    rowBounds.forEach(({ minLeft, maxRight }, rowEl) => {
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.height <= 0) return;
      const padX = 3.5;
      const padY = Math.max(1, rowRect.height * 0.04);
      const band = document.createElement('div');
      band.className = isTransientFlash
        ? 'mushaf-ayah-selected-band is-search-flash'
        : 'mushaf-ayah-selected-band';
      band.style.left = `${(minLeft - bodyRect.left - padX).toFixed(1)}px`;
      band.style.top = `${(rowRect.top - bodyRect.top + padY).toFixed(1)}px`;
      band.style.width = `${(maxRight - minLeft + padX * 2).toFixed(1)}px`;
      band.style.height = `${Math.max(4, rowRect.height - padY * 2).toFixed(1)}px`;
      frag.appendChild(band);
    });
    layerEl.replaceChildren(frag);
  }, [tafsirTarget, transientHighlightAyahKey, audioTarget]);

  useLayoutEffect(() => {
    syncSelectedAyahLayer();
    const bodyEl = pageBodyRef.current;
    if (!bodyEl || (!tafsirTarget && !transientHighlightAyahKey) || typeof ResizeObserver === 'undefined') return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncSelectedAyahLayer();
      });
    });
    ro.observe(bodyEl);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    syncSelectedAyahLayer,
    tafsirTarget,
    transientHighlightAyahKey,
    clampedMushafPage,
    activeSinglePageData,
    uniformPageFontSize,
    isUniformFontSynced,
    mushafZoom,
  ]);

  useEffect(() => {
    return () => {
      playbackRequestIdRef.current += 1;
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute('src');
        audioElRef.current = null;
      }
    };
  }, []);

  const syncPlayingAyahLayer = useCallback(() => {
    const bodyEl = pageBodyRef.current;
    const layerEl = ayahPlayingLayerRef.current;
    if (playingAyahNodesRef.current.length > 0) {
      for (const node of playingAyahNodesRef.current) {
        node.classList.remove('is-ayah-playing');
      }
      playingAyahNodesRef.current = [];
    }
    if (!bodyEl || !layerEl) return;
    if (!audioTarget || !audioAutoFollow) {
      if (layerEl.childElementCount > 0) layerEl.replaceChildren();
      return;
    }

    const playingKey = `${audioTarget.surahId}:${audioTarget.ayahNum}`;
    const nodes = Array.from(bodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${playingKey}"]`));
    if (nodes.length === 0) {
      if (layerEl.childElementCount > 0) layerEl.replaceChildren();
      return;
    }

    const rowBounds = new Map<HTMLElement, { minLeft: number; maxRight: number }>();
    for (const node of nodes) {
      node.classList.add('is-ayah-playing');
      const rowEl = node.closest<HTMLElement>('.mushaf-line-row');
      if (!rowEl) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const existing = rowBounds.get(rowEl);
      if (!existing) {
        rowBounds.set(rowEl, { minLeft: rect.left, maxRight: rect.right });
      } else {
        if (rect.left < existing.minLeft) existing.minLeft = rect.left;
        if (rect.right > existing.maxRight) existing.maxRight = rect.right;
      }
    }
    playingAyahNodesRef.current = nodes;

    const bodyRect = bodyEl.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    rowBounds.forEach(({ minLeft, maxRight }, rowEl) => {
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.height <= 0) return;
      const padX = 4;
      const padY = Math.max(1, rowRect.height * 0.035);
      const band = document.createElement('div');
      band.className = 'mushaf-ayah-playing-band';
      band.style.left = `${(minLeft - bodyRect.left - padX).toFixed(1)}px`;
      band.style.top = `${(rowRect.top - bodyRect.top + padY).toFixed(1)}px`;
      band.style.width = `${(maxRight - minLeft + padX * 2).toFixed(1)}px`;
      band.style.height = `${Math.max(4, rowRect.height - padY * 2).toFixed(1)}px`;
      frag.appendChild(band);
    });
    layerEl.replaceChildren(frag);
  }, [audioTarget, audioAutoFollow]);

  useLayoutEffect(() => {
    syncPlayingAyahLayer();
    const bodyEl = pageBodyRef.current;
    if (!bodyEl || !audioTarget || typeof ResizeObserver === 'undefined') return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncPlayingAyahLayer();
      });
    });
    ro.observe(bodyEl);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [
    syncPlayingAyahLayer,
    audioTarget,
    clampedMushafPage,
    activeSinglePageData,
    uniformPageFontSize,
    isUniformFontSynced,
    mushafZoom,
  ]);

  const isWholeAyahInteractive =
    !isHifzHidden &&
    (isFocusMode || (!isEffectivePractice && activeAnnotationTool === 'cursor'));

  const clearAyahHover = useCallback(() => {
    pageBodyRef.current?.classList.remove('is-ayah-hover-active');
    if (hoveredAyahNodesRef.current.length > 0) {
      for (const node of hoveredAyahNodesRef.current) {
        node.classList.remove('is-ayah-hovered');
      }
      hoveredAyahNodesRef.current = [];
    }
    if (ayahHoverLayerRef.current && ayahHoverLayerRef.current.childElementCount > 0) {
      ayahHoverLayerRef.current.replaceChildren();
    }
    hoveredAyahKeyRef.current = null;
  }, []);

  const applyAyahHover = useCallback((ayahKey: string) => {
    if (hoveredAyahKeyRef.current === ayahKey) return;
    const bodyEl = pageBodyRef.current;
    const layerEl = ayahHoverLayerRef.current;
    if (!bodyEl || !layerEl) return;

    clearAyahHover();
    hoveredAyahKeyRef.current = ayahKey;

    const nodes = Array.from(bodyEl.querySelectorAll<HTMLElement>(`[data-ayah-key="${ayahKey}"]`));
    if (nodes.length === 0) return;

    bodyEl.classList.add('is-ayah-hover-active');

    const rowBounds = new Map<HTMLElement, { minLeft: number; maxRight: number }>();
    for (const node of nodes) {
      node.classList.add('is-ayah-hovered');
      const rowEl = node.closest<HTMLElement>('.mushaf-line-row');
      if (!rowEl) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const existing = rowBounds.get(rowEl);
      if (!existing) {
        rowBounds.set(rowEl, { minLeft: rect.left, maxRight: rect.right });
      } else {
        if (rect.left < existing.minLeft) existing.minLeft = rect.left;
        if (rect.right > existing.maxRight) existing.maxRight = rect.right;
      }
    }
    hoveredAyahNodesRef.current = nodes;

    const bodyRect = bodyEl.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    rowBounds.forEach(({ minLeft, maxRight }, rowEl) => {
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.height <= 0) return;
      const padX = 3;
      const padY = Math.max(1, rowRect.height * 0.04);
      const band = document.createElement('div');
      band.className = 'mushaf-ayah-hover-band';
      band.style.left = `${(minLeft - bodyRect.left - padX).toFixed(1)}px`;
      band.style.top = `${(rowRect.top - bodyRect.top + padY).toFixed(1)}px`;
      band.style.width = `${(maxRight - minLeft + padX * 2).toFixed(1)}px`;
      band.style.height = `${Math.max(4, rowRect.height - padY * 2).toFixed(1)}px`;
      frag.appendChild(band);
    });
    layerEl.replaceChildren(frag);
  }, [clearAyahHover]);

  const handlePageBodyPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'touch' || !isWholeAyahInteractive) {
        if (hoveredAyahKeyRef.current !== null) clearAyahHover();
        return;
      }
      const target = e.target as HTMLElement | null;
      const ayahEl = target?.closest<HTMLElement>('[data-ayah-key]');
      if (ayahEl) {
        const key = ayahEl.getAttribute('data-ayah-key');
        if (key) {
          applyAyahHover(key);
          return;
        }
      }
      if (hoveredAyahKeyRef.current !== null) {
        // Keep hover steady when passing over tiny flex gaps between words of the same verse
        if (target?.closest('.mushaf-line-row') && ayahHoverLayerRef.current) {
          const bands = ayahHoverLayerRef.current.children;
          for (let i = 0; i < bands.length; i++) {
            const r = bands[i].getBoundingClientRect();
            if (
              e.clientX >= r.left - 2 &&
              e.clientX <= r.right + 2 &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom
            ) {
              return;
            }
          }
        }
        clearAyahHover();
      }
    },
    [isWholeAyahInteractive, applyAyahHover, clearAyahHover]
  );

  useEffect(() => {
    clearAyahHover();
  }, [
    clampedMushafPage,
    isWholeAyahInteractive,
    uniformPageFontSize,
    mushafZoom,
    focusedAyahKeys,
    tafsirTarget,
    audioModalTarget,
    clearAyahHover,
  ]);

  const handleSaveBookmark = (e?: React.FormEvent) => {
    e?.preventDefault();
    const pageSurah =
      primaryFocusedAyahMeta?.surahName ||
      activeSinglePageData?.surahNames[0] ||
      currentSurahEntry.name;
    const customLabel = bookmarkNoteInput.trim();
    const studentName = bookmarkStudentInput.trim();
    const defaultLabel =
      focusedAyahMetas.length > 0
        ? `سورة ${pageSurah} · ${focusedCompactLabel}`
        : `سورة ${pageSurah} · صفحة ${toArabicDigits(clampedMushafPage)}`;
    const newBm: MushafBookmark = {
      id: `bm_${Date.now()}`,
      pageNum: clampedMushafPage,
      surahName: pageSurah,
      surahId: primaryFocusedAyahMeta?.surahId,
      ayahNum: primaryFocusedAyahMeta?.ayahNum,
      focusedKeys: isFocusMode && focusedAyahKeys.length > 0 ? [...focusedAyahKeys] : undefined,
      label: customLabel || defaultLabel,
      studentName: studentName || undefined,
      kind: bookmarkKindInput,
      createdAt: Date.now(),
    };
    addOrUpdateMushafBookmark(newBm);
    setBookmarkNoteInput('');
  };

  const handleJumpToBookmark = (bm: MushafBookmark) => {
    handleJumpToPage(bm.pageNum);
    if (bm.focusedKeys && bm.focusedKeys.length > 0) {
      setIsFocusMode(true);
      setFocusedAyahKeys(bm.focusedKeys);
    } else if (bm.surahId && bm.ayahNum) {
      setIsFocusMode(true);
      setFocusedAyahKeys([`${bm.surahId}:${bm.ayahNum}`]);
    }
    setIsBookmarksOpen(false);
  };

  const handleDeleteBookmark = (id: string) => {
    removeMushafBookmark(id);
  };

  const renderLensWordText = (wordItem: Extract<MushafLineItem, { kind: 'word' }>) => {
    let leadingSymbols = '';
    let trailingSymbols = '';
    let seenLetter = false;
    const segments: Array<{ text: string; color: string | null }> = [];

    for (let tIdx = 0; tIdx < wordItem.tokens.length; tIdx++) {
      const token = wordItem.tokens[tIdx];
      if (token.type === 'symbol') {
        if (!seenLetter) leadingSymbols += token.base + token.extra;
        else trailingSymbols += token.base + token.extra;
        continue;
      }
      seenLetter = true;
      const piece = token.base + token.extra;
      const rule = mushafTajweed && wordItem.tajweed ? wordItem.tajweed[tIdx] : undefined;
      const color = rule ? TAJWEED_COLORS[rule] : null;
      if (segments.length > 0 && segments[segments.length - 1].color === color) {
        segments[segments.length - 1].text += piece;
      } else {
        segments.push({ text: piece, color });
      }
    }

    return (
      <>
        {leadingSymbols && (
          <span className="mushaf-symbol" aria-hidden="true">
            {leadingSymbols}
          </span>
        )}
        {segments.map((seg, idx) =>
          seg.color ? (
            <span key={idx} style={{ color: seg.color }}>
              {seg.text}
            </span>
          ) : (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          )
        )}
        {trailingSymbols && (
          <span className="mushaf-symbol" aria-hidden="true">
            {trailingSymbols}
          </span>
        )}
      </>
    );
  };

  return (
    <div
      className="sub-panel active"
      id="sub-surah"
      data-variant={variant}
      data-mushaf-theme={mushafPaperTheme}
    >
      <div
        ref={hudSlotRef}
        className={`mushaf-hud-slot ${showFloatingHud ? 'is-floating-open' : ''}`}
        style={
          showFloatingHud
            ? ({
                minHeight: reservedHudHeight > 0 ? `${reservedHudHeight}px` : undefined,
                '--mushaf-floating-w': floatingHudWidth > 0 ? `${floatingHudWidth}px` : undefined,
              } as React.CSSProperties)
            : undefined
        }
      >
      <div
        ref={hudBoxRef}
        className={`mushaf-sticky-hud ${showFloatingHud ? 'is-floating-open' : ''} ${
          showFloatingHud && isFloatingHudEntering ? 'is-entering' : ''
        }`}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && isFloatingHudEntering) {
            setIsFloatingHudEntering(false);
          }
        }}
        data-annotation-ui="true"
      >
        <div className="apply-toolbar-row mushaf-toolbar-row" id="surah-toolbar-row">
        <div className="apply-select-group mushaf-nav-controls">
          <div className="apply-select-wrap">
            <select
              id="surah-select"
              aria-label="اختر سورة"
              value={currentSurahEntry.name}
              onChange={(e) => handleSelectSurah(e.target.value)}
            >
              {mushafSurahs.map((surah) => (
                <option key={surah.id} value={surah.name}>
                  {toArabicDigits(surah.id)}. سورة {surah.name} ({toArabicDigits(surah.totalAyat)})
                </option>
              ))}
            </select>
            <ChevronDown className="apply-select-chevron" aria-hidden="true" />
          </div>
        </div>

        <div className="mushaf-toolbar-actions">

          {hasPractice && (
            <div className="mushaf-mode-toggle" role="group" aria-label="وضع عرض المصحف">
              <button
                type="button"
                className={`mushaf-mode-btn ${mushafMode === 'practice' ? 'is-active' : ''}`}
                onClick={() => {
                  setMushafMode('practice');
                  setSurahStatus({ msg: '', kind: null });
                }}
              >
                <BookMarked className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع التدريب</span>
              </button>
              <button
                type="button"
                className={`mushaf-mode-btn ${mushafMode === 'reading' ? 'is-active' : ''}`}
                onClick={() => {
                  setMushafMode('reading');
                  setSurahRevealed(false);
                  setSurahStatus({ msg: '', kind: null });
                }}
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع القراءة</span>
              </button>
            </div>
          )}

          <div className="mushaf-zoom-control" role="group" aria-label="تكبير وتصغير الآيات">
            <button
              type="button"
              className="mushaf-zoom-btn"
              disabled={!canZoomIn}
              onClick={() => handleStepZoom(1)}
              title="تكبير الآيات"
              aria-label="تكبير الآيات"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`mushaf-zoom-readout ${mushafZoom !== 1 ? 'is-modified' : ''}`}
              disabled={mushafZoom === 1}
              onClick={() => setMushafZoom(1)}
              title={mushafZoom === 1 ? 'الحجم الافتراضي للآيات' : 'إعادة الحجم إلى ١٠٠٪'}
              aria-label={`نسبة تكبير الآيات ${toArabicDigits(Math.round(mushafZoom * 100))} بالمئة`}
            >
              {toArabicDigits(Math.round(mushafZoom * 100))}٪
            </button>
            <button
              type="button"
              className="mushaf-zoom-btn"
              disabled={!canZoomOut}
              onClick={() => handleStepZoom(-1)}
              title="تصغير الآيات"
              aria-label="تصغير الآيات"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className={`mushaf-tajweed-toggle-btn ${mushafTajweed ? 'is-active' : ''}`}
            aria-pressed={mushafTajweed}
            aria-label={mushafTajweed ? 'التجويد مفعّل، اضغط للإيقاف' : 'التجويد متوقف، اضغط للتفعيل'}
            onClick={() => setMushafTajweed((prev) => !prev)}
            title={mushafTajweed ? 'إيقاف ألوان التجويد' : 'تفعيل ألوان التجويد'}
          >
            <Palette className="w-3.5 h-3.5" aria-hidden="true" />
            <span>التجويد</span>
            <span className="mushaf-tajweed-switch" aria-hidden="true">
              <span className="mushaf-tajweed-switch-knob" />
            </span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn mushaf-audio-toggle-btn ${
              isAudioBarOpen ? 'is-open' : ''
            } ${isAudioPlaying ? 'is-playing' : ''}`}
            aria-expanded={isAudioBarOpen}
            onClick={handleToolbarAudioToggle}
            title={isAudioPlaying ? 'إيقاف التلاوة مؤقتاً' : 'تشغيل التلاوة الصوتية للآيات'}
          >
            {isAudioLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : isAudioPlaying ? (
              <Pause className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{isAudioPlaying ? 'إيقاف التلاوة' : 'التلاوة'}</span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn mushaf-search-toggle-btn ${
              isSearchModalOpen ? 'is-open' : ''
            }`}
            onClick={() => setIsSearchModalOpen(true)}
            title="بحث فوري في القرآن الكريم (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            <span>بحث</span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn mushaf-index-toggle-btn ${
              isIndexModalOpen ? 'is-open' : ''
            }`}
            onClick={() => setIsIndexModalOpen(true)}
            title="فهرس السور والأجزاء والأحزاب وسجدات التلاوة"
          >
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
            <span>الفهرس</span>
          </button>

          <div ref={themeMenuWrapRef} className="mushaf-theme-wrap">
            <button
              type="button"
              className={`mushaf-teacher-toggle-btn mushaf-theme-toggle-btn ${
                isThemeMenuOpen ? 'is-open' : ''
              }`}
              aria-expanded={isThemeMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsThemeMenuOpen((prev) => !prev)}
              title="تغيير لون وخلفية ورق المصحف"
            >
              <SunMedium className="w-3.5 h-3.5" aria-hidden="true" />
              <span
                className="mushaf-theme-swatch-dot"
                style={{
                  backgroundColor:
                    MUSHAF_PAPER_THEME_OPTIONS.find((t) => t.id === mushafPaperTheme)?.swatch ?? '#FCF8EE',
                }}
                aria-hidden="true"
              />
              <span>المظهر</span>
            </button>

            {isThemeMenuOpen && (
              <div className="mushaf-theme-popover" role="menu" aria-label="ثيمات ورق المصحف">
                {MUSHAF_PAPER_THEME_OPTIONS.map((opt) => {
                  const isSelected = mushafPaperTheme === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      className={`mushaf-theme-option ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        setMushafPaperTheme(opt.id);
                        setIsThemeMenuOpen(false);
                      }}
                    >
                      <span
                        className="mushaf-theme-swatch-dot is-lg"
                        style={{ backgroundColor: opt.swatch }}
                        aria-hidden="true"
                      />
                      <span className="mushaf-theme-option-label">{opt.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn mushaf-tafsir-toggle-btn ${
              tafsirTarget ? 'is-open' : ''
            }`}
            onClick={handleOpenToolbarTafsir}
            title="عرض تفسير آيات الصفحة (المختصر، غريب القرآن، الميسّر، السعدي، فتح القدير)"
          >
            <BookOpenText className="w-3.5 h-3.5" aria-hidden="true" />
            <span>التفسير</span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn ${isTeacherDockOpen ? 'is-open' : ''} ${
              hasTeacherActiveState ? 'has-active' : ''
            }`}
            aria-expanded={isTeacherDockOpen}
            aria-pressed={isTeacherDockOpen}
            onClick={handleToggleTeacherDock}
            title="أدوات الحصة للمصحف (تركيز آية، إخفاء للتسميع، تحديد نطاق، علامة التوقف)"
          >
            <ScanEye className="w-3.5 h-3.5" aria-hidden="true" />
            <span>أدوات المعلم</span>
          </button>

          <button
            type="button"
            className={`mushaf-teacher-toggle-btn mushaf-report-capture-btn ${
              isReportCaptureMode ? 'is-capturing' : ''
            }`}
            aria-pressed={isReportCaptureMode}
            onClick={handleToggleReportCaptureMode}
            title="تفعيل وضع التقاط الآيات مع علامات القلم وإرسالها مباشرة لتقرير الحصة"
          >
            {isCapturingReportAyah ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ClipboardPlus className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {isReportCaptureMode
                ? 'إيقاف الالتقاط'
                : sessionReportDraft.mistakes.length > 0
                ? `التقاط خطأ (${toArabicDigits(sessionReportDraft.mistakes.length)})`
                : 'التقاط خطأ'}
            </span>
          </button>

          {variant === 'standalone' && onTogglePresentationMode && (
            <button
              type="button"
              className={`mushaf-presentation-btn ${isPresentationMode ? 'is-active' : ''}`}
              aria-pressed={isPresentationMode}
              onClick={onTogglePresentationMode}
              title={isPresentationMode ? 'إنهاء ملء الشاشة (Esc)' : 'تكبير العرض للبث والشاشة الكاملة'}
            >
              {isPresentationMode ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>إنهاء العرض</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>ملء الشاشة</span>
                </>
              )}
            </button>
          )}

          {isEffectivePractice && (
            <div
              className={`counter-pill ${
                surahTotalTargets > 0 && surahFoundCount === surahTotalTargets ? 'is-complete' : ''
              }`}
              id="surah-counter"
              aria-live="polite"
            >
              وجدت {toArabicDigits(surahFoundCount)} من {toArabicDigits(surahTotalTargets)}
            </div>
          )}

          {showFloatingHud && (
            <div className="mushaf-floating-hud-controls">
              <button
                type="button"
                className={`mushaf-floating-pin-btn ${isFloatingPinned ? 'is-pinned' : ''}`}
                aria-pressed={isFloatingPinned}
                onClick={() => setIsFloatingPinned((prev) => !prev)}
                title={
                  isFloatingPinned
                    ? 'إلغاء تثبيت الشريط (ينطوي تلقائياً عند لمس المصحف)'
                    : 'تثبيت الشريط العائم أثناء التمرير'
                }
              >
                {isFloatingPinned ? (
                  <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isFloatingPinned ? 'مثبّت' : 'تثبيت'}</span>
              </button>
              <button
                type="button"
                className="mushaf-floating-close-btn"
                onClick={() => setIsFloatingHudOpen(false)}
                title="طي الشريط لإتاحة كامل مساحة المصحف (Esc)"
                aria-label="طي الشريط"
              >
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>طي</span>
              </button>
            </div>
          )}
        </div>
      </div>


      {(isReportCaptureMode || reportCaptureToast) && (
        <div
          className={`mushaf-report-capture-bar ${isReportCaptureMode ? 'is-armed' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="mushaf-report-capture-info">
            <ClipboardCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {reportCaptureToast
                ? reportCaptureToast.text
                : activeAnnotationTool !== 'cursor'
                ? 'ارسم على موضع الخطأ بالقلم ثم اضغط «التقاط خطأ» أو اختر أداة المؤشر واضغط على الآية'
                : 'وضع الالتقاط نشط — اضغط على أي آية لإرسالها مع علامات القلم إلى التقرير'}
            </span>
          </div>
          <div className="mushaf-report-capture-actions">
            {activeAnnotationTool !== 'cursor' && isReportCaptureMode && (
              <button
                type="button"
                className="mushaf-report-bar-btn"
                onClick={() => setAnnotationTool('cursor')}
              >
                تحديد الآية الآن
              </button>
            )}
            {variant === 'standalone' && onOpenReports && sessionReportDraft.mistakes.length > 0 && (
              <button
                type="button"
                className="mushaf-report-bar-btn is-primary"
                onClick={onOpenReports}
              >
                <span>فتح التقرير ({toArabicDigits(sessionReportDraft.mistakes.length)})</span>
              </button>
            )}
            {isReportCaptureMode && (
              <button
                type="button"
                className="mushaf-report-bar-btn"
                onClick={() => setIsReportCaptureMode(false)}
              >
                إنهاء
              </button>
            )}
          </div>
        </div>
      )}

      {isTeacherDockOpen && (
        <div
          className="mushaf-teacher-dock"
          role="toolbar"
          aria-label="أدوات المعلم للمصحف أثناء الحصة"
        >
          <div className="mushaf-teacher-dock-row">
            <div className="mushaf-teacher-group" role="group" aria-label="وضع التركيز على آية أو عدة آيات">
              <button
                type="button"
                className={`mushaf-teacher-btn ${isFocusMode ? 'is-active' : ''}`}
                aria-pressed={isFocusMode}
                onClick={handleToggleFocusMode}
                title="تعتيم باقي الصفحة وإضاءة آية أو عدة آيات معاً لمنع التشتت"
              >
                <ScanEye className="w-3.5 h-3.5" aria-hidden="true" />
                <span>وضع التركيز</span>
              </button>

              {isFocusMode && pageAyahList.length > 0 && (
                <>
                  <div className="mushaf-teacher-stepper">
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn"
                      disabled={!canStepFocusPrev}
                      onClick={() => handleStepFocusedAyah(-1)}
                      title={focusedCount > 1 ? 'تحريك المقطع للآية السابقة' : 'الآية السابقة'}
                      aria-label={focusedCount > 1 ? 'تحريك المقطع للآية السابقة' : 'الآية السابقة'}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <span className="mushaf-teacher-step-label">{focusedCompactLabel}</span>
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn"
                      disabled={!canStepFocusNext}
                      onClick={() => handleStepFocusedAyah(1)}
                      title={focusedCount > 1 ? 'تحريك المقطع للآية التالية' : 'الآية التالية'}
                      aria-label={focusedCount > 1 ? 'تحريك المقطع للآية التالية' : 'الآية التالية'}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="mushaf-teacher-stepper is-range-ctrl" role="group" aria-label="إضافة أو تقليص آيات التركيز">
                    <button
                      type="button"
                      className="mushaf-teacher-step-btn is-add-ayah"
                      disabled={!canAppendFocusAyah}
                      onClick={handleAppendFocusedAyah}
                      title="إضافة الآية التالية إلى وضع التركيز"
                      aria-label="إضافة الآية التالية إلى وضع التركيز"
                    >
                      <Plus className="w-3.5 h-3.5" strokeWidth={2.3} />
                      <span>إضافة آية</span>
                    </button>
                    {focusedCount > 1 && (
                      <button
                        type="button"
                        className="mushaf-teacher-step-btn is-remove-ayah"
                        onClick={handleRemoveLastFocusedAyah}
                        title="إزالة آخر آية مضافة من التركيز"
                        aria-label="إزالة آخر آية مضافة من التركيز"
                      >
                        <Minus className="w-3.5 h-3.5" strokeWidth={2.3} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`mushaf-teacher-btn ${isFocusPickerOpen ? 'is-active' : 'is-subtle'}`}
                    aria-expanded={isFocusPickerOpen}
                    onClick={() => setIsFocusPickerOpen((prev) => !prev)}
                    title="اختيار أي مجموعة آيات من الصفحة لوضع التركيز"
                  >
                    <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>تحديد الآيات</span>
                  </button>

                  <button
                    type="button"
                    className={`mushaf-teacher-btn ${isFocusLensOpen ? 'is-active' : 'is-subtle'}`}
                    aria-pressed={isFocusLensOpen}
                    onClick={() => setIsFocusLensOpen((prev) => !prev)}
                    title="عرض الآيات المختارة داخل عدسة زجاجية هادئة فوق صفحة القرآن"
                  >
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>عدسة زجاجية</span>
                  </button>

                  {focusedCount > 0 && (
                    <button
                      type="button"
                      className="mushaf-teacher-btn is-subtle"
                      onClick={handleHideFocusedInHifz}
                      title="إخفاء الآيات المحددة فقط للتسميع الفوري"
                    >
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>تسميع المحدد</span>
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="mushaf-teacher-divider" aria-hidden="true" />

            <div className="mushaf-teacher-group" role="group" aria-label="أدوات التسميع والإخفاء">
              <button
                type="button"
                className={`mushaf-teacher-btn ${isHifzHidden ? 'is-active' : ''}`}
                aria-pressed={isHifzHidden}
                onClick={handleToggleHifzMode}
                title="إخفاء كلمات الآيات للتسميع مع إبقاء أرقام الآيات ظاهرة"
              >
                {isHifzHidden ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isHifzHidden ? 'إنهاء التسميع' : 'إخفاء للتسميع'}</span>
              </button>

              {isHifzHidden && (
                <>
                  <button
                    type="button"
                    className={`mushaf-teacher-btn ${isHifzFirstWordCue ? 'is-active' : 'is-subtle'}`}
                    aria-pressed={isHifzFirstWordCue}
                    onClick={() => setIsHifzFirstWordCue((prev) => !prev)}
                    title="إظهار أول كلمة من كل آية كتذكير أثناء التسميع"
                  >
                    <span>أول كلمة</span>
                  </button>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={() => handleRevealNextAyah(false)}
                    title="كشف الآية التالية كاملة بالتدريج (أو اضغط المسطرة Space)"
                  >
                    <span>كشف آية</span>
                  </button>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={handleRevealAllHifz}
                    title="كشف جميع آيات النطاق أو الصفحة"
                  >
                    <span>كشف الكل</span>
                  </button>
                  <button
                    type="button"
                    className="mushaf-teacher-btn is-subtle"
                    onClick={handleHideAllHifz}
                    title="إعادة إخفاء جميع الكلمات"
                  >
                    <span>إخفاء الكل</span>
                  </button>

                  {hifzTargetAyahSet && (
                    <button
                      type="button"
                      className="mushaf-teacher-btn is-subtle"
                      onClick={() => setHifzTargetRangeKeys(null)}
                      title="التبديل من النطاق المحدد إلى تسميع كل الصفحة"
                    >
                      <span>كل الصفحة ({toArabicDigits(hifzTargetAyahSet.size)} آيات)</span>
                    </button>
                  )}

                  <span className="mushaf-hifz-progress-pill" title="عدد الآيات المكشوفة في التسميع">
                    {toArabicDigits(hifzRevealedAyahCount)}/{toArabicDigits(hifzTargetedAyahList.length)}
                  </span>

                  <div className="mushaf-hifz-slip-pill" role="group" aria-label="عداد تنبيهات التسميع">
                    <button
                      type="button"
                      className="mushaf-hifz-slip-add"
                      onClick={() => setHifzSlipCount((c) => c + 1)}
                      title="تسجيل تنبيه / فتح على الطالب أثناء التسميع"
                    >
                      <span>
                        {hifzSlipCount > 0
                          ? `تنبيه (${toArabicDigits(hifzSlipCount)})`
                          : '+ تنبيه'}
                      </span>
                    </button>
                    {hifzSlipCount > 0 && (
                      <button
                        type="button"
                        className="mushaf-hifz-slip-reset"
                        onClick={() => setHifzSlipCount(0)}
                        title="تصفير عداد التنبيهات"
                        aria-label="تصفير عداد التنبيهات"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mushaf-teacher-divider" aria-hidden="true" />

            <div className="mushaf-teacher-group" role="group" aria-label="تحديد نطاق سريع وعلامات التوقف">
              <button
                type="button"
                className={`mushaf-teacher-btn ${isRangeToolOpen ? 'is-active' : ''}`}
                aria-expanded={isRangeToolOpen}
                onClick={() => setIsRangeToolOpen((prev) => !prev)}
                title="تحديد نطاق من آية إلى آية للتركيز أو التسميع أو التلاوة"
              >
                <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
                <span>تحديد نطاق</span>
              </button>

              <button
                type="button"
                className={`mushaf-teacher-btn ${currentPageBookmark ? 'is-bookmarked' : ''}`}
                onClick={() => handleSaveBookmark()}
                title="حفظ الصفحة والآية الحالية كعلامة توقف للطالب"
              >
                {currentPageBookmark ? (
                  <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>حفظ الموضع</span>
              </button>

              <button
                type="button"
                className={`mushaf-teacher-btn ${isBookmarksOpen ? 'is-active' : ''}`}
                aria-expanded={isBookmarksOpen}
                onClick={() => setIsBookmarksOpen((prev) => !prev)}
                title="عرض علامات توقف الطلاب المحفوظة"
              >
                <span>العلامات ({toArabicDigits(bookmarks.length)})</span>
              </button>
            </div>
          </div>

          {isRangeToolOpen && pageAyahList.length > 0 && (
            <div className="mushaf-range-drawer" role="region" aria-label="تحديد نطاق آيات في الصفحة">
              <div className="mushaf-range-selects">
                <label className="mushaf-range-field">
                  <span>من</span>
                  <select
                    value={rangeStartKey}
                    onChange={(e) => setRangeStartKey(e.target.value)}
                    aria-label="بداية النطاق"
                  >
                    {pageAyahList.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.surahName} ({toArabicDigits(a.ayahNum)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mushaf-range-field">
                  <span>إلى</span>
                  <select
                    value={rangeEndKey}
                    onChange={(e) => setRangeEndKey(e.target.value)}
                    aria-label="نهاية النطاق"
                  >
                    {pageAyahList.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.surahName} ({toArabicDigits(a.ayahNum)})
                      </option>
                    ))}
                  </select>
                </label>
                <span className="mushaf-range-count-tag">
                  {toArabicDigits(selectedRangeKeys.length)} آية
                </span>
              </div>
              <div className="mushaf-range-actions">
                <button
                  type="button"
                  className="mushaf-teacher-btn is-subtle"
                  onClick={handleApplyRangeFocus}
                >
                  <ScanEye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>تركيز النطاق</span>
                </button>
                <button
                  type="button"
                  className="mushaf-teacher-btn is-subtle"
                  onClick={handleApplyRangeHifz}
                >
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>تسميع النطاق</span>
                </button>
                <button
                  type="button"
                  className="mushaf-teacher-btn is-subtle"
                  onClick={handleApplyRangeAudio}
                >
                  <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>تلاوة النطاق</span>
                </button>
              </div>
            </div>
          )}

          {isFocusMode && isFocusPickerOpen && pageAyahList.length > 0 && (
            <div className="mushaf-focus-picker-drawer" role="region" aria-label="اختيار آيات وضع التركيز">
              <div className="mushaf-focus-picker-head">
                <span className="mushaf-focus-picker-hint">
                  اضغط على أرقام الآيات أو مباشرة على الصفحة لإضافتها أو إزالتها ({toArabicDigits(focusedCount)} من{' '}
                  {toArabicDigits(pageAyahList.length)})
                </span>
                <div className="mushaf-focus-picker-quick">
                  {focusedCount > 1 && (
                    <button
                      type="button"
                      className="mushaf-focus-quick-btn"
                      onClick={handleResetToSingleFocus}
                    >
                      آية واحدة
                    </button>
                  )}
                  {focusedCount < pageAyahList.length && (
                    <button
                      type="button"
                      className="mushaf-focus-quick-btn"
                      onClick={handleSelectAllPageFocus}
                    >
                      كل الصفحة
                    </button>
                  )}
                </div>
              </div>
              <div className="mushaf-focus-picker-chips">
                {pageAyahGroupsBySurah.map((group) => (
                  <React.Fragment key={group.surahId}>
                    {pageAyahGroupsBySurah.length > 1 && (
                      <span className="mushaf-focus-surah-tag">{group.surahName}</span>
                    )}
                    {group.ayahs.map((ayah) => {
                      const isSelected = focusedAyahSet.has(ayah.key);
                      return (
                        <button
                          key={ayah.key}
                          type="button"
                          className={`mushaf-focus-ayah-chip ${isSelected ? 'is-selected' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => handleToggleFocusAyahKey(ayah.key)}
                          title={
                            isSelected
                              ? focusedCount > 1
                                ? `إزالة آية ${toArabicDigits(ayah.ayahNum)} من التركيز`
                                : `آية ${toArabicDigits(ayah.ayahNum)} محددة`
                              : `إضافة آية ${toArabicDigits(ayah.ayahNum)} إلى التركيز`
                          }
                        >
                          {toArabicDigits(ayah.ayahNum)}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {isBookmarksOpen && (
            <div className="mushaf-bookmarks-drawer">
              <form className="mushaf-bookmark-form" onSubmit={handleSaveBookmark}>
                <div className="mushaf-bookmark-student-wrap">
                  <User className="w-3.5 h-3.5 text-[#64748B] shrink-0" aria-hidden="true" />
                  <input
                    type="text"
                    className="mushaf-bookmark-student-input"
                    list="mushaf-student-names-list"
                    value={bookmarkStudentInput}
                    onChange={(e) => setBookmarkStudentInput(e.target.value)}
                    placeholder="اسم الطالب (اختياري)"
                    aria-label="اسم الطالب"
                  />
                  <datalist id="mushaf-student-names-list">
                    {savedStudentNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div className="mushaf-bookmark-kinds" role="group" aria-label="نوع العلامة">
                  {(['hifz', 'review', 'stop'] as MushafBookmarkKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`mushaf-bookmark-kind-btn ${
                        bookmarkKindInput === k ? 'is-active' : ''
                      }`}
                      onClick={() => setBookmarkKindInput(k)}
                    >
                      {BOOKMARK_KIND_LABELS[k]}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  className="mushaf-bookmark-input"
                  value={bookmarkNoteInput}
                  onChange={(e) => setBookmarkNoteInput(e.target.value)}
                  placeholder="ملاحظة إضافية (اختياري، مثل: تثبيت من آية ١٥)"
                  aria-label="ملاحظة علامة التوقف"
                />
                <button type="submit" className="mushaf-teacher-btn is-active">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>حفظ العلامة</span>
                </button>
              </form>

              {savedStudentNames.length > 0 && (
                <div className="mushaf-bookmark-filter-bar" role="group" aria-label="تصفية العلامات حسب الطالب">
                  <button
                    type="button"
                    className={`mushaf-bookmark-filter-chip ${
                      bookmarkStudentFilter === 'all' ? 'is-active' : ''
                    }`}
                    onClick={() => setBookmarkStudentFilter('all')}
                  >
                    الكل ({toArabicDigits(bookmarks.length)})
                  </button>
                  {savedStudentNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`mushaf-bookmark-filter-chip ${
                        bookmarkStudentFilter === name ? 'is-active' : ''
                      }`}
                      onClick={() => setBookmarkStudentFilter(name)}
                    >
                      <User className="w-3 h-3" aria-hidden="true" />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
              )}

              {filteredBookmarks.length > 0 ? (
                <div className="mushaf-bookmarks-list">
                  {filteredBookmarks.map((bm) => {
                    const kind = bm.kind ?? 'stop';
                    return (
                      <div
                        key={bm.id}
                        className={`mushaf-bookmark-item ${
                          bm.pageNum === clampedMushafPage ? 'is-current' : ''
                        }`}
                      >
                        <button
                          type="button"
                          className="mushaf-bookmark-jump"
                          onClick={() => handleJumpToBookmark(bm)}
                        >
                          <BookmarkCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span className={`mushaf-bookmark-kind-tag is-kind-${kind}`}>
                            {BOOKMARK_KIND_LABELS[kind]}
                          </span>
                          {bm.studentName && (
                            <span className="mushaf-bookmark-student-tag">
                              {bm.studentName}
                            </span>
                          )}
                          <span className="mushaf-bookmark-label">{bm.label}</span>
                          <span className="mushaf-bookmark-meta">
                            ص {toArabicDigits(bm.pageNum)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mushaf-bookmark-del"
                          onClick={() => handleDeleteBookmark(bm.id)}
                          aria-label={`حذف علامة ${bm.label}`}
                          title="حذف العلامة"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mushaf-bookmarks-empty">
                  {bookmarks.length > 0
                    ? 'لا توجد علامات محفوظة لهذا الطالب حالياً.'
                    : 'لا توجد علامات توقف محفوظة بعد — اكتب اسم الطالب واضغط «حفظ العلامة» للعودة إليه بضغطة واحدة.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
      </div>
      <div ref={hudSentinelRef} className="mushaf-hud-sentinel" aria-hidden="true" />

      {showHudLauncher && (
        <div
          className={`mushaf-hud-launcher ${isHudLauncherEntering ? 'is-entering' : ''}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && isHudLauncherEntering) {
              setIsHudLauncherEntering(false);
            }
          }}
          data-annotation-ui="true"
          role="region"
          aria-label="وصول سريع لشريط المصحف"
        >
          {(isAudioPlaying || isAudioLoading || Boolean(audioError)) && (
            <>
              <div className="mushaf-hud-audio-pill">
                <button
                  type="button"
                  className={`mushaf-hud-audio-play ${isAudioPlaying ? 'is-playing' : ''}`}
                  onClick={handleToolbarAudioToggle}
                  title={isAudioPlaying ? 'إيقاف التلاوة مؤقتاً' : 'تشغيل التلاوة'}
                  aria-label={isAudioPlaying ? 'إيقاف التلاوة مؤقتاً' : 'تشغيل التلاوة'}
                >
                  {isAudioLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  ) : isAudioPlaying ? (
                    <Pause className="w-3 h-3" fill="currentColor" aria-hidden="true" />
                  ) : (
                    <Play className="w-3 h-3" fill="currentColor" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className={`mushaf-hud-audio-label ${audioError ? 'is-error' : ''}`}
                  onClick={
                    audioError
                      ? handleOpenFloatingHud
                      : audioTarget
                      ? handleJumpToPlayingAyah
                      : handleOpenFloatingHud
                  }
                  title={
                    audioError
                      ? audioError
                      : audioTarget
                      ? 'الانتقال إلى الآية المتلوة'
                      : 'فتح شريط التلاوة'
                  }
                >
                  {audioError
                    ? 'خطأ في الصوت'
                    : audioTarget
                    ? `${surahMetaMap.get(audioTarget.surahId)?.name ?? ''} · ${toArabicDigits(
                        audioTarget.ayahNum
                      )}`
                    : 'التلاوة'}
                </button>
              </div>
              <span className="mushaf-hud-launcher-sep" aria-hidden="true" />
            </>
          )}

          <button
            type="button"
            className="mushaf-hud-launcher-btn"
            onClick={handleOpenFloatingHud}
            title="إظهار شريط أدوات المصحف"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>أدوات المصحف</span>
            {(isHifzHidden || isFocusMode) && (
              <span className="mushaf-hud-launcher-dot" aria-hidden="true" />
            )}
          </button>

          <span className="mushaf-hud-launcher-sep" aria-hidden="true" />
          <button
            type="button"
            className="mushaf-hud-launcher-top"
            onClick={handleScrollToTop}
            title="العودة لأعلى الصفحة"
            aria-label="العودة لأعلى الصفحة"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {isEffectivePractice && practiceConfig && (
        <div className="instruction">
          اضغط على <span className="apply-instruction-accent">{practiceConfig.targetLabel}</span> في الصفحة
        </div>
      )}

      <div
        className={`quran-frame ${
          isEffectivePractice && surahTotalTargets > 0 && surahFoundCount === surahTotalTargets
            ? 'is-solved'
            : ''
        }`}
        id="surah-frame"
        onPointerDownCapture={() => {
          if (showFloatingHud && !isFloatingPinned) {
            setIsFloatingHudOpen(false);
          }
        }}
      >
        <svg
          className="tile-deco-pattern"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="100" cy="20" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
          <circle cx="100" cy="20" r="38" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
          <circle cx="100" cy="20" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25" />
          <rect x="76" y="-4" width="48" height="48" rx="6" transform="rotate(45 100 20)" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          <rect x="76" y="-4" width="48" height="48" rx="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        </svg>

        <div
          className={`mushaf-inner-frame ${isEffectivePractice ? 'is-practice-mode' : 'is-reading-mode'} ${
            pageTurn ? 'is-turning' : ''
          }`}
          style={
            {
              '--mushaf-zoom': effectiveMushafScale,
              '--mushaf-user-zoom': mushafZoom,
              '--mushaf-cap-px': `${activeZoomPreset.capPx}px`,
              '--mushaf-slot-pct': `${activeZoomPreset.slotPct}%`,
              '--mushaf-mobile-pct': `${activeZoomPreset.mobilePct}%`,
            } as React.CSSProperties
          }
        >
          <div className="mushaf-spread-stage">
            <div className="mushaf-side-nav-rail is-prev">
              <button
                type="button"
                className="mushaf-side-nav-btn"
                title="الصفحة السابقة"
                aria-label="الصفحة السابقة"
                disabled={clampedMushafPage <= 1}
                onClick={() => handleStepMushafPage(-1)}
              >
                <ChevronRight className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>

            <div className="mushaf-spread-slot">
            <div
              className="mushaf-book-spread is-single-page"
              data-turn-dir={pageTurn?.dir}
              data-turn-phase={pageTurn ? (pageTurn.seq % 2 === 0 ? 'a' : 'b') : undefined}
              onAnimationEnd={(e) => {
                if (pageTurn && e.target === e.currentTarget) {
                  setPageTurn(null);
                }
              }}
              aria-label={`المصحف الشريف - صفحة ${toArabicDigits(clampedMushafPage)}`}
            >
            {[{ side: 'single' as const, pageNum: clampedMushafPage, pageData: activeSinglePageData }].map(
              ({ side, pageNum, pageData }) => {
              const displayedRows = isolatedPageInfo ? isolatedPageInfo.rows : pageData?.rows ?? [];
              const totalBodySlots = isolatedPageInfo?.isCompacted
                ? isolatedPageInfo.keptCount
                : pageNum <= 2
                ? 8
                : 15;
              const showMarginOrnaments = Boolean(pageData && !isolatedPageInfo?.isCompacted);
              const lineRowSlotIndex = new Map<number, number>();
              if (showMarginOrnaments) {
                displayedRows.forEach((r, idx) => {
                  if (r.kind === 'text') lineRowSlotIndex.set(r.line, idx);
                });
              }

              return (
              <article
                key="mushaf-single-sheet"
                data-mushaf-theme={mushafPaperTheme}
                className={`mushaf-page-sheet is-${side}-page ${pageNum <= 2 ? 'is-opening-spread' : ''} ${
                  isFocusMode ? 'is-focus-mode-active' : ''
                } ${isHifzHidden ? 'is-hifz-mode-active' : ''} ${
                  isFocusMode && isFocusLensOpen && focusedCount > 0 ? 'has-focus-lens' : ''
                }`}
                aria-label={`صفحة ${toArabicDigits(pageNum)}`}
              >
                <AyahRosetteSymbolDefs />
                <div className="mushaf-page-border-outer">
                  <div className="mushaf-page-border-inner">
                    <header className="mushaf-page-header">
                      <span className="mushaf-page-header-surah">
                        {isolatedPageInfo
                          ? `سُورَةُ ${isolatedPageInfo.surahName}`
                          : pageData && pageData.surahNames.length > 0
                          ? pageData.surahNames.length === 1
                            ? `سُورَةُ ${pageData.surahNames[0]}`
                            : pageData.surahNames.join(' · ')
                          : `صفحة ${toArabicDigits(pageNum)}`}
                      </span>
                      <span className="mushaf-page-header-right">
                        {currentPageBookmark && (
                          <span className="mushaf-page-bookmark-tag" title={currentPageBookmark.label}>
                            <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {currentPageBookmark.studentName
                                ? currentPageBookmark.studentName
                                : 'علامة التوقف'}
                            </span>
                          </span>
                        )}
                        {currentPageActiveQuarter && (
                          <span className="mushaf-page-header-hizb">
                            الحزب {toArabicDigits(currentPageActiveQuarter.hizbNum)}
                            {currentPageActiveQuarter.quarterIndexInHizb > 0
                              ? ` · ${currentPageActiveQuarter.kindLabel}`
                              : ''}
                          </span>
                        )}
                        <span className="mushaf-page-header-juz">
                          الجزء {toArabicDigits(pageData?.jozz || currentJozz)}
                        </span>
                      </span>
                    </header>

                    <div
                      ref={pageBodyRef}
                      className={`mushaf-page-body ${pageNum <= 2 ? 'is-opening-spread' : 'is-standard-page'} ${
                        isolatedPageInfo?.isCompacted ? 'is-surah-isolated' : ''
                      }`}
                      style={
                        {
                          ...(uniformPageFontSize
                            ? { '--mushaf-uniform-fs': `${uniformPageFontSize.toFixed(2)}px` }
                            : {}),
                          ...(isolatedPageInfo?.isCompacted
                            ? {
                                '--mushaf-isolated-rows': isolatedPageInfo.keptCount,
                                '--mushaf-isolated-ratio': Number(
                                  (isolatedPageInfo.keptCount / isolatedPageInfo.totalSlots).toFixed(6)
                                ),
                              }
                            : {}),
                        } as React.CSSProperties
                      }
                      onPointerMove={handlePageBodyPointerMove}
                      onPointerLeave={clearAyahHover}
                    >
                      <div ref={ayahPlayingLayerRef} className="mushaf-ayah-playing-layer" aria-hidden="true" />
                      <div ref={ayahSelectedLayerRef} className="mushaf-ayah-selected-layer" aria-hidden="true" />
                      <div ref={ayahHoverLayerRef} className="mushaf-ayah-hover-layer" aria-hidden="true" />
                      {showMarginOrnaments && (currentPageQuarters.length > 0 || currentPageSajdahs.length > 0) && (
                        <div className="mushaf-margin-badges-layer" data-annotation-ui="true">
                          {currentPageQuarters.map((q) => {
                            const slotIdx = lineRowSlotIndex.get(q.lineNum);
                            if (slotIdx === undefined) return null;
                            const topPct = ((slotIdx + 0.5) / totalBodySlots) * 100;
                            return (
                              <button
                                key={`q_badge_${q.quarterNumber}`}
                                type="button"
                                className="mushaf-margin-badge is-quarter"
                                style={{ top: `${topPct.toFixed(3)}%` }}
                                onClick={() => handleJumpWithHighlight(pageNum, q.ayahKey)}
                                title={`${q.kindLabel} ${toArabicDigits(q.hizbNum)} · سورة ${q.surahName} (${toArabicDigits(q.ayahNum)})`}
                                aria-label={`${q.kindLabel} ${toArabicDigits(q.hizbNum)}`}
                              >
                                ۞
                              </button>
                            );
                          })}
                          {currentPageSajdahs.map((s) => {
                            const slotIdx = lineRowSlotIndex.get(s.lineNum);
                            if (slotIdx === undefined) return null;
                            const topPct = ((slotIdx + 0.5) / totalBodySlots) * 100;
                            return (
                              <button
                                key={`sajdah_badge_${s.ayahKey}`}
                                type="button"
                                className="mushaf-margin-badge is-sajdah"
                                style={{ top: `${topPct.toFixed(3)}%` }}
                                onClick={() => handleJumpWithHighlight(pageNum, s.ayahKey)}
                                title={`سجدة تلاوة · سورة ${s.surahName} (${toArabicDigits(s.ayahNum)})`}
                                aria-label={`سجدة تلاوة في سورة ${s.surahName}`}
                              >
                                ۩
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {pageData ? (
                        (isolatedPageInfo ? isolatedPageInfo.rows : pageData.rows).map((row) => {
                          if (row.kind === 'banner') {
                            const seg = row.surahMeta;
                            return (
                              <div
                                key={`${pageNum}_b_${row.line}_${seg.id}`}
                                className="mushaf-surah-banner"
                                aria-label={`سورة ${seg.name}`}
                              >
                                <div className="mushaf-banner-dashed-inset" aria-hidden="true" />

                                <div className="mushaf-banner-wing is-right">
                                  <div className="mushaf-wing-fill" aria-hidden="true" />
                                  <svg
                                    className="mushaf-wing-arc-svg"
                                    viewBox="0 0 28 60"
                                    preserveAspectRatio="none"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path d="M28 0H22C10 2 3 15 3 30C3 45 10 58 22 60H28Z" fill="var(--mushaf-wing-arc-fill, #EEF3FF)" />
                                    <path
                                      d="M25 1.5C11 3.5 3.5 16 3.5 30C3.5 44 11 56.5 25 58.5"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <svg className="mushaf-wing-star" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path
                                      d="M10 1.5L12.1 7.9L18.5 10L12.1 12.1L10 18.5L7.9 12.1L1.5 10L7.9 7.9L10 1.5Z"
                                      fill="var(--mushaf-wing-star-fill, rgba(59, 130, 246, 0.14))"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  <span className="mushaf-wing-text">{seg.rev}</span>
                                </div>

                                <div className="mushaf-surah-center">
                                  <svg className="mushaf-center-asterisk" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                                    <path
                                      d="M9 1.5V16.5M1.5 9H16.5M3.7 3.7L14.3 14.3M14.3 3.7L3.7 14.3"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="9" cy="9" r="1.6" fill="var(--mushaf-banner-dot-bg, #FFFFFF)" stroke="currentColor" strokeWidth="1.1" />
                                  </svg>
                                  <span className="mushaf-surah-title">سُورَةُ {seg.name}</span>
                                  <svg className="mushaf-center-asterisk" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                                    <path
                                      d="M9 1.5V16.5M1.5 9H16.5M3.7 3.7L14.3 14.3M14.3 3.7L3.7 14.3"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="9" cy="9" r="1.6" fill="var(--mushaf-banner-dot-bg, #FFFFFF)" stroke="currentColor" strokeWidth="1.1" />
                                  </svg>
                                </div>

                                <div className="mushaf-banner-wing is-left">
                                  <div className="mushaf-wing-fill" aria-hidden="true" />
                                  <svg
                                    className="mushaf-wing-arc-svg"
                                    viewBox="0 0 28 60"
                                    preserveAspectRatio="none"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path d="M0 0H6C18 2 25 15 25 30C25 45 18 58 6 60H0Z" fill="var(--mushaf-wing-arc-fill, #EEF3FF)" />
                                    <path
                                      d="M3 1.5C17 3.5 24.5 16 24.5 30C24.5 44 17 56.5 3 58.5"
                                      stroke="currentColor"
                                      strokeWidth="1.35"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <span className="mushaf-wing-text">آيَاتُهَا</span>
                                  <span
                                    className={`mushaf-wing-ayah-badge ${seg.totalAyat >= 100 ? 'is-triple' : ''}`}
                                    aria-label={`${toArabicDigits(seg.totalAyat)} آية`}
                                  >
                                    <svg className="mushaf-wing-badge-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path
                                        d="M12 1.8L14.8 4.6L18.8 4.6L19.4 8.6L22.2 12L19.4 15.4L18.8 19.4L14.8 19.4L12 22.2L9.2 19.4L5.2 19.4L4.6 15.4L1.8 12L4.6 8.6L5.2 4.6L9.2 4.6L12 1.8Z"
                                        fill="var(--mushaf-banner-badge-bg, #FFFFFF)"
                                        stroke="currentColor"
                                        strokeWidth="1.35"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                    <span className="mushaf-wing-badge-num">{toArabicDigits(seg.totalAyat)}</span>
                                  </span>
                                  <svg className="mushaf-wing-star" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path
                                      d="M10 1.5L12.1 7.9L18.5 10L12.1 12.1L10 18.5L7.9 12.1L1.5 10L7.9 7.9L10 1.5Z"
                                      fill="var(--mushaf-wing-star-fill, rgba(59, 130, 246, 0.14))"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </div>
                              </div>
                            );
                          }

                          if (row.kind === 'basmalah') {
                            return (
                              <div
                                key={`${pageNum}_m_${row.line}_${row.surahId}`}
                                className="mushaf-basmalah"
                                aria-hidden="true"
                              >
                                {'بِسۡ\u0640\u0640\u0640مِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِي\u0640\u0640\u0640مِ'}
                              </div>
                            );
                          }

                          return (
                            <MushafLineRow
                              key={`${pageNum}_t_${row.line}`}
                              items={row.items}
                              isCentered={row.isCentered}
                              isPractice={isEffectivePractice}
                              isTajweedEnabled={mushafTajweed}
                              correctMap={surahCorrectMap}
                              revealed={surahRevealed}
                              wrongKey={surahWrongKey}
                              onLetterClick={stableSurahLetterClick}
                              toArabicDigits={toArabicDigits}
                              zoomScale={effectiveMushafScale}
                              uniformFontSize={uniformPageFontSize}
                              isFontSynced={isUniformFontSynced}
                              focusedAyahKeys={isFocusMode ? focusedAyahSet : null}
                              isHifzHidden={isHifzHidden}
                              hifzTargetAyahKeys={hifzTargetAyahSet}
                              hifzFirstWordKeys={hifzEffectiveFirstWordKeys}
                              revealedWordKeys={revealedWordKeys}
                              revealedAyahKeys={revealedAyahKeys}
                              onWordAction={
                                isReportCaptureMode || isHifzHidden || isFocusMode
                                  ? handleWordTeacherClick
                                  : !isEffectivePractice && activeAnnotationTool === 'cursor'
                                  ? handleWordDefaultClick
                                  : undefined
                              }
                              onAyahAction={
                                isReportCaptureMode || isHifzHidden || isFocusMode
                                  ? handleAyahTeacherClick
                                  : !isEffectivePractice && activeAnnotationTool === 'cursor'
                                  ? handleAyahDefaultClick
                                  : undefined
                              }
                              ayahActionTitle={
                                isReportCaptureMode
                                  ? 'اضغط لالتقاط هذه الآية وإرسالها للتقرير'
                                  : undefined
                              }
                              subscribePageResize={subscribePageResize}
                            />
                          );
                        })
                      ) : (
                        <div className="mushaf-page-loading">جارٍ تحميل صفحات المصحف الشريف...</div>
                      )}
                    </div>

                    <footer className="mushaf-page-footer">
                      <span className="mushaf-page-footer-flourish" aria-hidden="true">✦</span>
                      <span className="mushaf-page-footer-num">{toArabicDigits(pageNum)}</span>
                      <span className="mushaf-page-footer-flourish" aria-hidden="true">✦</span>
                    </footer>

                    <AnnotationSurface
                      surfaceId={`mushaf:page:${pageNum}`}
                      ariaLabel={`طبقة الرسم والتظليل على صفحة ${toArabicDigits(pageNum)}`}
                    />
                  </div>
                </div>

                {isFocusMode && isFocusLensOpen && focusedCount > 0 && (
                  <div
                    className="mushaf-liquid-lens-backdrop"
                    role="dialog"
                    aria-modal="false"
                    aria-label={`عدسة التركيز الزجاجية — ${focusedLensTitle.surah} ${focusedLensTitle.ayahs}`}
                    dir="rtl"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        setIsFocusLensOpen(false);
                      }
                    }}
                  >
                    <div
                      className="mushaf-liquid-lens-card"
                      data-mushaf-theme={mushafPaperTheme}
                      onPointerEnter={handleLiquidPointerEnter}
                      onPointerLeave={handleLiquidPointerLeave}
                      onPointerMove={handleLiquidPointerMove}
                    >
                      <header className="mushaf-liquid-lens-header">
                        <div className="mushaf-liquid-lens-title">
                          <span>{focusedLensTitle.surah}</span>
                          <span className="mushaf-liquid-sep" aria-hidden="true">·</span>
                          <span>{focusedLensTitle.ayahs}</span>
                        </div>

                        <div className="mushaf-liquid-lens-head-actions">
                          {primaryFocusedAyahMeta && (
                            <>
                              <button
                                type="button"
                                className={`mushaf-liquid-btn ${
                                  audioTarget?.surahId === primaryFocusedAyahMeta.surahId &&
                                  audioTarget?.ayahNum === primaryFocusedAyahMeta.ayahNum &&
                                  isAudioPlaying
                                    ? 'is-active'
                                    : ''
                                }`}
                                onClick={() =>
                                  handleTogglePlayAyah(
                                    primaryFocusedAyahMeta.surahId,
                                    primaryFocusedAyahMeta.ayahNum,
                                    { openBar: false }
                                  )
                                }
                                title="استماع لتلاوة الآية المختارة"
                              >
                                {audioTarget?.surahId === primaryFocusedAyahMeta.surahId &&
                                audioTarget?.ayahNum === primaryFocusedAyahMeta.ayahNum &&
                                isAudioLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                ) : audioTarget?.surahId === primaryFocusedAyahMeta.surahId &&
                                  audioTarget?.ayahNum === primaryFocusedAyahMeta.ayahNum &&
                                  isAudioPlaying ? (
                                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                <span>
                                  {audioTarget?.surahId === primaryFocusedAyahMeta.surahId &&
                                  audioTarget?.ayahNum === primaryFocusedAyahMeta.ayahNum &&
                                  isAudioPlaying
                                    ? 'إيقاف'
                                    : 'استماع'}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="mushaf-liquid-btn"
                                onClick={() =>
                                  handleOpenTafsirForAyah(
                                    primaryFocusedAyahMeta.surahId,
                                    primaryFocusedAyahMeta.ayahNum
                                  )
                                }
                                title="عرض تفسير الآية المختارة"
                              >
                                <BookOpenText className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>التفسير</span>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className={`mushaf-liquid-btn ${isHifzHidden ? 'is-active' : ''}`}
                            aria-pressed={isHifzHidden}
                            onClick={handleToggleHifzMode}
                            title={isHifzHidden ? 'إظهار كلمات الآيات' : 'إخفاء كلمات الآيات للتسميع'}
                          >
                            {isHifzHidden ? (
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{isHifzHidden ? 'إنهاء الإخفاء' : 'إخفاء للتسميع'}</span>
                          </button>
                          <button
                            type="button"
                            className="mushaf-liquid-icon-btn"
                            onClick={() => setIsFocusLensOpen(false)}
                            title="إغلاق العدسة (Esc)"
                            aria-label="إغلاق العدسة الزجاجية"
                          >
                            <X className="w-4 h-4" strokeWidth={2.2} />
                          </button>
                        </div>
                      </header>

                      {audioError && (
                        <div className="mushaf-liquid-audio-error" role="status" aria-live="polite">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{audioError}</span>
                        </div>
                      )}

                      <div ref={lensStageRef} className="mushaf-liquid-lens-stage">
                        <div className="mushaf-liquid-lens-scroll-inner">
                          {focusedLensPassageGroups.map((group, gIdx) => (
                            <React.Fragment key={group.id}>
                              {gIdx > 0 && (
                                <div className="mushaf-lens-passage-divider" aria-hidden="true">
                                  <span className="mushaf-lens-passage-line" />
                                  <span className="mushaf-lens-passage-meta">
                                    {group.surahId !== focusedLensPassageGroups[gIdx - 1].surahId
                                      ? `سورة ${group.surahName} · ${group.ayahLabel}`
                                      : group.ayahLabel}
                                  </span>
                                  <span className="mushaf-lens-passage-line" />
                                </div>
                              )}
                              <div
                                className={`mushaf-liquid-lens-ayah ${
                                  focusedCount >= 4
                                    ? 'is-count-many'
                                    : focusedCount >= 2
                                    ? 'is-count-multi'
                                    : 'is-count-single'
                                }`}
                                dir="rtl"
                              >
                                {group.items.map((lineItem, wIdx) => {
                                  if (lineItem.kind === 'rosette') {
                                    return (
                                      <AyahRosette
                                        key={`${lineItem.keyPrefix}_lens_r_${wIdx}`}
                                        ayahNum={lineItem.ayahNum}
                                        toArabicDigits={toArabicDigits}
                                        isFocused={true}
                                        title={isHifzHidden ? 'اضغط لكشف أو إخفاء الآية كاملة' : undefined}
                                        onClick={
                                          isHifzHidden
                                            ? () => handleAyahTeacherClick(lineItem.surahId, lineItem.ayahNum)
                                            : undefined
                                        }
                                      />
                                    );
                                  }
                                  const wordItem = lineItem;
                                  const wordAyahKey = `${wordItem.surahId}:${wordItem.ayahNum}`;
                                  const isTargetedByHifz = Boolean(
                                    isHifzHidden &&
                                      (!hifzTargetAyahSet || hifzTargetAyahSet.has(wordAyahKey))
                                  );
                                  const isHifzCue = Boolean(
                                    isTargetedByHifz &&
                                      hifzEffectiveFirstWordKeys &&
                                      hifzEffectiveFirstWordKeys.has(wordItem.keyPrefix)
                                  );
                                  const isWordHidden = Boolean(
                                    isTargetedByHifz &&
                                      !isHifzCue &&
                                      !revealedWordKeys[wordItem.keyPrefix] &&
                                      !revealedAyahKeys[wordAyahKey]
                                  );
                                  const isWordRevealedInHifz = Boolean(
                                    isTargetedByHifz &&
                                      !isWordHidden &&
                                      !isHifzCue &&
                                      (revealedWordKeys[wordItem.keyPrefix] ||
                                        revealedAyahKeys[wordAyahKey])
                                  );
                                  return (
                                    <span
                                      key={`${wordItem.keyPrefix}_lens_${wIdx}`}
                                      className="mushaf-lens-word-cluster"
                                    >
                                      <span
                                        data-lens-ayah-key={wordAyahKey}
                                        className={`mushaf-lens-word ${isWordHidden ? 'is-hifz-hidden' : ''} ${
                                          isWordRevealedInHifz ? 'is-hifz-revealed' : ''
                                        } ${isHifzCue ? 'is-hifz-cue' : ''} ${
                                          isTargetedByHifz ? 'is-interactive' : ''
                                        }`}
                                        title={
                                          isWordHidden
                                            ? 'اضغط لكشف الكلمة'
                                            : isWordRevealedInHifz
                                            ? 'اضغط لإعادة إخفاء الكلمة'
                                            : undefined
                                        }
                                        onClick={
                                          isTargetedByHifz ? () => handleWordTeacherClick(wordItem) : undefined
                                        }
                                      >
                                        <span className="mushaf-lens-word-text">
                                          {isWordHidden ? wordItem.rawWord : renderLensWordText(wordItem)}
                                        </span>
                                      </span>
                                      {wordItem.ayahEnd !== null && (
                                        <AyahRosette
                                          ayahNum={wordItem.ayahEnd}
                                          toArabicDigits={toArabicDigits}
                                          isFocused={true}
                                          title={isHifzHidden ? 'اضغط لكشف أو إخفاء الآية كاملة' : undefined}
                                          onClick={
                                            isHifzHidden
                                              ? () => handleAyahTeacherClick(wordItem.surahId, wordItem.ayahEnd!)
                                              : undefined
                                          }
                                        />
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      <footer className="mushaf-liquid-lens-footer">
                        <button
                          type="button"
                          className="mushaf-liquid-btn"
                          disabled={!canStepFocusPrev}
                          onClick={() => handleStepFocusedAyah(-1)}
                        >
                          <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                          <span>{focusedCount > 1 ? 'المقطع السابق' : 'الآية السابقة'}</span>
                        </button>

                        <div className="mushaf-liquid-lens-mid-actions">
                          <div className="mushaf-liquid-range-group" role="group" aria-label="إضافة أو تقليص آية">
                            <button
                              type="button"
                              className="mushaf-liquid-btn is-primary"
                              disabled={!canAppendFocusAyah}
                              onClick={handleAppendFocusedAyah}
                              title="إضافة الآية التالية إلى العدسة"
                            >
                              <Plus className="w-3.5 h-3.5" strokeWidth={2.4} aria-hidden="true" />
                              <span>إضافة آية</span>
                            </button>
                            {focusedCount > 1 && (
                              <button
                                type="button"
                                className="mushaf-liquid-icon-btn"
                                onClick={handleRemoveLastFocusedAyah}
                                title="إزالة آخر آية مضافة"
                                aria-label="إزالة آخر آية مضافة"
                              >
                                <Minus className="w-3.5 h-3.5" strokeWidth={2.4} />
                              </button>
                            )}
                          </div>

                          {isHifzHidden && (
                            <button
                              type="button"
                              className="mushaf-liquid-btn is-primary"
                              onClick={handleToggleRevealFocusedAyahs}
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>
                                {areAllFocusedRevealed
                                  ? focusedCount > 1
                                    ? 'إعادة إخفاء الآيات'
                                    : 'إعادة إخفاء الآية'
                                  : focusedCount > 1
                                  ? 'كشف الآيات المختارة'
                                  : 'كشف هذه الآية'}
                              </span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          className="mushaf-liquid-btn"
                          disabled={!canStepFocusNext}
                          onClick={() => handleStepFocusedAyah(1)}
                        >
                          <span>{focusedCount > 1 ? 'المقطع التالي' : 'الآية التالية'}</span>
                          <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
                        </button>
                      </footer>
                    </div>
                  </div>
                )}
              </article>
              );
            })}
            </div>
            </div>

            <div className="mushaf-side-nav-rail is-next">
              <button
                type="button"
                className="mushaf-side-nav-btn"
                title="الصفحة التالية"
                aria-label="الصفحة التالية"
                disabled={clampedMushafPage >= TOTAL_MUSHAF_PAGES}
                onClick={() => handleStepMushafPage(1)}
              >
                <ChevronLeft className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          </div>

          {mushafTajweed && (
            <div
              className="mushaf-tajweed-legend"
              data-mushaf-theme={mushafPaperTheme}
              aria-label="دليل ألوان أحكام التجويد"
            >
              {TAJWEED_LEGEND.map((item) => (
                <span key={item.kind} className="mushaf-tajweed-chip">
                  <span
                    className="mushaf-tajweed-dot"
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span
                    className="mushaf-tajweed-label"
                    style={{
                      color:
                        item.kind === 'idgham'
                          ? 'var(--tajweed-idgham-label, #526075)'
                          : item.color,
                    }}
                  >
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          )}

          <div className="mushaf-pagination-bar" role="navigation" aria-label="تصفح صفحات المصحف">
            <button
              type="button"
              className="mushaf-page-btn"
              disabled={clampedMushafPage <= 1}
              onClick={() => handleStepMushafPage(-1)}
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2.4} />
              <span>الصفحة السابقة</span>
            </button>

            <div className="mushaf-page-jump">
              <select
                className="mushaf-page-select"
                aria-label="اختر صفحة المصحف"
                value={clampedMushafPage}
                onChange={(e) => handleJumpToPage(Number(e.target.value))}
              >
                {pageSelectOptions.map((opt) => (
                  <option key={opt.pageNum} value={opt.pageNum}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="mushaf-page-btn"
              disabled={clampedMushafPage >= TOTAL_MUSHAF_PAGES}
              onClick={() => handleStepMushafPage(1)}
            >
              <span>الصفحة التالية</span>
              <ChevronLeft className="w-4 h-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {isEffectivePractice && surahStatus.msg && (
        <div
          role="status"
          aria-live="polite"
          className={`status-line word-extract-feedback ${
            surahStatus.kind === 'bad' ? 'is-wrong' : 'is-correct-letter'
          }`}
          id="surah-status"
        >
          {surahStatus.kind === 'bad' ? (
            <X className="w-4 h-4 shrink-0" strokeWidth={2.6} />
          ) : (
            <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />
          )}
          <span>{surahStatus.msg}</span>
        </div>
      )}

      {isEffectivePractice && (
        <div className="controls-row" id="surah-controls">
          <button
            type="button"
            className="btn"
            id="surah-reveal"
            onClick={() => setSurahRevealed(true)}
          >
            إظهار الحل
          </button>
          <button
            type="button"
            className="btn primary"
            id="surah-reset"
            onClick={() => {
              setSurahCorrectMap({});
              setSurahRevealed(false);
              setSurahStatus({ msg: '', kind: null });
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      <TafsirModal
        target={tafsirTarget}
        onClose={() => {
          setTafsirTarget(null);
          if (isAudioPlaying) {
            setIsAudioBarOpen(true);
          }
        }}
        onChangeTarget={setTafsirTarget}
        mushafDataset={mushafDataset}
        surahMetaMap={surahMetaMap}
        audioState={{
          activeTarget: audioTarget,
          isPlaying: isAudioPlaying,
          isLoading: isAudioLoading,
          isSingleMode: audioSession.total === 1,
          audioError,
          onPlaySingleAyah: (surahId, ayahNum) => {
            const isSameSinglePlaying =
              audioTarget?.surahId === surahId &&
              audioTarget?.ayahNum === ayahNum &&
              audioSession.total === 1 &&
              isAudioPlaying;
            if (isSameSinglePlaying) {
              handlePauseCurrentAudio();
              return;
            }
            playSpecificAyah(surahId, ayahNum, {
              resetRepeat: true,
              openBar: true,
              sessionTotalOverride: 1,
              repeatSectionOverride: false,
            });
          },
          onPlayFromHere: (surahId, ayahNum) => {
            const isSameStreamPlaying =
              audioTarget?.surahId === surahId &&
              audioTarget?.ayahNum === ayahNum &&
              audioSession.total !== 1 &&
              isAudioPlaying;
            if (isSameStreamPlaying) {
              handlePauseCurrentAudio();
              return;
            }
            playSpecificAyah(surahId, ayahNum, {
              resetRepeat: true,
              openBar: true,
              sessionTotalOverride: 0,
              repeatSectionOverride: false,
            });
            setTafsirTarget(null);
          },
          onOpenAudioSettings: (surahId, ayahNum) => {
            setTafsirTarget(null);
            setAudioModalTarget({ surahId, ayahNum });
          },
        }}
        onSendToReport={handleCaptureAyahToReport}
        isAyahInReport={
          tafsirTarget
            ? capturedReportAyahKeys.has(`${tafsirTarget.surahId}:${tafsirTarget.ayahNum}`)
            : false
        }
      />
      <AudioControlModal
        target={audioModalTarget}
        onClose={() => setAudioModalTarget(null)}
        surahMetaMap={surahMetaMap}
        mushafDataset={mushafDataset}
        currentPageSurahId={currentSurahEntry?.id ?? pageAyahList[0]?.surahId ?? audioModalTarget?.surahId ?? 1}
        currentPageNum={clampedMushafPage}
        currentJozz={currentJozz}
        reciterId={audioReciterId}
        rate={audioRate}
        repeat={audioRepeat}
        repeatSection={audioRepeatSection}
        ayahCount={audioAyahCount}
        autoFollow={audioAutoFollow}
        activeSessionTotal={audioTarget ? audioSession.total : undefined}
        activeSessionRepeatSection={audioTarget ? audioSession.repeatSection : undefined}
        activeAudioTarget={audioTarget}
        isPlaying={isAudioPlaying}
        isLoading={isAudioLoading}
        onStartPlayback={handleApplyAudioModal}
        onPausePlayback={handlePauseCurrentAudio}
        onOpenAudioDock={() => setIsAudioBarOpen(true)}
      />
      <FloatingAudioDock
        isExpanded={isAudioBarOpen}
        onExpand={() => setIsAudioBarOpen(true)}
        onMinimize={() => setIsAudioBarOpen(false)}
        onStopPlayback={handleCloseAudioBar}
        audioTarget={audioTarget}
        fallbackTarget={
          primaryFocusedAyahMeta
            ? { surahId: primaryFocusedAyahMeta.surahId, ayahNum: primaryFocusedAyahMeta.ayahNum }
            : pageAyahList[0]
            ? { surahId: pageAyahList[0].surahId, ayahNum: pageAyahList[0].ayahNum }
            : currentSurahEntry
            ? { surahId: currentSurahEntry.id, ayahNum: 1 }
            : null
        }
        isPlaying={isAudioPlaying}
        isLoading={isAudioLoading}
        audioError={audioError}
        reciterId={audioReciterId}
        rate={audioRate}
        repeat={audioRepeat}
        repeatProgress={audioRepeatProgress}
        repeatSection={audioRepeatSection}
        ayahCount={audioAyahCount}
        autoFollow={audioAutoFollow}
        pauseGap={audioPauseGap}
        stopAtPageEnd={audioStopAtPageEnd}
        isPauseGapWaiting={audioPauseGapWaiting}
        sessionTotal={audioSession.total}
        sessionIndex={audioSession.index}
        sessionRepeatSection={audioSession.repeatSection}
        surahMetaMap={surahMetaMap}
        mushafDataset={mushafDataset}
        currentPageNum={clampedMushafPage}
        currentJozz={currentJozz}
        onTogglePlay={handleToolbarAudioToggle}
        onStepAyah={handleStepAudioAyah}
        onJumpToPlayingAyah={handleJumpToPlayingAyah}
        onChangeReciter={handleChangeReciter}
        onSetRate={handleSetDirectRate}
        onSetRepeat={handleSetDirectRepeat}
        onSetRepeatSection={handleSetDirectRepeatSection}
        onSetAutoFollow={handleSetDirectAutoFollow}
        onSetPauseGap={handleSetPauseGap}
        onSetStopAtPageEnd={handleSetStopAtPageEnd}
        subscribeAudioProgress={subscribeAudioProgress}
        onSeekAudioProgress={handleSeekAudioProgress}
        onApplyPreset={handleApplyAudioModal}
        onOpenCustomModal={(t) => setAudioModalTarget(t)}
      />
      <MushafSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        dataset={mushafDataset}
        surahs={mushafSurahs}
        onSelectResult={handleSelectSearchResult}
      />
      <MushafIndexModal
        isOpen={isIndexModalOpen}
        onClose={() => setIsIndexModalOpen(false)}
        dataset={mushafDataset}
        surahs={mushafSurahs}
        currentPage={clampedMushafPage}
        currentJozz={activeSinglePageData?.jozz || currentJozz}
        currentSurahId={currentSurahEntry.id}
        onJumpToLocation={handleJumpWithHighlight}
      />
    </div>
  );
};
