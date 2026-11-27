import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPlus,
  Copy,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-react';
import { AyahRosette } from './MushafLineRow';
import { toArabicDigits, type MushafDataset, type MushafSurahMeta } from '../utils/mushafData';
import {
  extractAyahTextFromDataset,
  fetchSurahTafsir,
  getCachedSurahTafsir,
  loadSavedTafsirEdition,
  loadSavedTafsirFontSize,
  prefetchSurahTafsir,
  saveTafsirEdition,
  saveTafsirFontSize,
  TAFSIR_EDITIONS,
  type TafsirEditionId,
} from '../utils/tafsirData';
import {
  computeBottomDockOverlayClearance,
  useBottomDockCoordinatorState,
} from '../utils/bottomDockCoordinator';

export interface TafsirAyahTarget {
  surahId: number;
  ayahNum: number;
}

export interface TafsirAudioState {
  activeTarget: TafsirAyahTarget | null;
  isPlaying: boolean;
  isLoading: boolean;
  isSingleMode: boolean;
  audioError?: string | null;
  onPlaySingleAyah: (surahId: number, ayahNum: number) => void;
  onPlayFromHere: (surahId: number, ayahNum: number) => void;
  onOpenAudioSettings: (surahId: number, ayahNum: number) => void;
}

interface TafsirModalProps {
  target: TafsirAyahTarget | null;
  onClose: () => void;
  onChangeTarget: (next: TafsirAyahTarget) => void;
  mushafDataset: MushafDataset | null;
  surahMetaMap: Map<number, MushafSurahMeta>;
  audioState?: TafsirAudioState;
  onSendToReport?: (surahId: number, ayahNum: number) => Promise<'added' | 'updated' | null>;
  isAyahInReport?: boolean;
}

const SECTION_HEADER_LABELS = new Set([
  'تسمية السورة',
  'من مقاصد السورة',
  '[التفسير]',
  'التفسير',
  '[الآية]',
  'وهي مكية',
  'وهي مدنية',
  'مكية',
  'مدنية',
]);

const BASMALAH_RE =
  /^بِ?سْ?مِ?\s+الل[هَِّ]*\s+الر[حَِّ]*م[نَِٰ]*\s+الر[حَِّ]*ي[مِ]*$/;

function normalizeSectionLabel(line: string): string | null {
  if (SECTION_HEADER_LABELS.has(line)) {
    return line.replace(/^\[|\]$/g, '');
  }
  return null;
}

function splitTafsirParagraphs(text: string): string[] {
  if (!text) return [];
  const rawBlocks = text.split(/\n{2,}/);
  const result: string[] = [];

  for (const block of rawBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const lines = trimmedBlock
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let buffer = '';
    for (const line of lines) {
      const isBas = BASMALAH_RE.test(line);
      const isSection = SECTION_HEADER_LABELS.has(line) || isBas;
      const startsNewItem =
        line.startsWith('•') ||
        line.startsWith('{') ||
        line.startsWith('﴿') ||
        isSection;

      const hasUnclosedQuote =
        (buffer.match(/﴿/g)?.length ?? 0) > (buffer.match(/﴾/g)?.length ?? 0) ||
        (buffer.match(/\{/g)?.length ?? 0) > (buffer.match(/\}/g)?.length ?? 0);

      if (!buffer) {
        buffer = line;
      } else if (isSection && !hasUnclosedQuote) {
        result.push(buffer);
        buffer = line;
      } else if (startsNewItem && !hasUnclosedQuote && buffer.length > 48) {
        result.push(buffer);
        buffer = line;
      } else {
        buffer = `${buffer} ${line}`;
      }
    }
    if (buffer) {
      result.push(buffer);
    }
  }

  return result;
}

function renderQuranPhrase(inner: string, key: React.Key): React.ReactNode {
  return (
    <span key={key} className="tafsir-inline-quran">
      <span className="tafsir-quran-bracket" aria-hidden="true">﴿</span>
      <span className="tafsir-quran-words">{inner}</span>
      <span className="tafsir-quran-bracket" aria-hidden="true">﴾</span>
    </span>
  );
}

function renderInlineQuranQuotes(text: string): React.ReactNode {
  const parts = text.split(/(﴿[^﴾]+﴾|\{[^}]+\}|\[[^\]\n]{2,48}\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, idx) => {
    if (part.startsWith('﴿') && part.endsWith('﴾')) {
      return renderQuranPhrase(part.slice(1, -1).trim(), idx);
    }
    if (part.startsWith('{') && part.endsWith('}')) {
      const inner = part.slice(1, -1).trim();
      if (/^[0-9٠-٩\sـ\-–,،]+$/.test(inner)) {
        return (
          <span key={idx} className="tafsir-inline-ayah-ref">
            ({toArabicDigits(inner)})
          </span>
        );
      }
      return renderQuranPhrase(inner, idx);
    }
    if (part.startsWith('[') && part.endsWith(']')) {
      const inner = part.slice(1, -1).trim();
      if (/^[^\d:]+:\s*[0-9٠-٩\s,\-–ـ،]+$/.test(inner)) {
        return (
          <span key={idx} className="tafsir-inline-citation">
            [{toArabicDigits(inner)}]
          </span>
        );
      }
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const TafsirModal: React.FC<TafsirModalProps> = ({
  target,
  onClose,
  onChangeTarget,
  mushafDataset,
  surahMetaMap,
  audioState,
  onSendToReport,
  isAyahInReport = false,
}) => {
  const [editionId, setEditionId] = useState<TafsirEditionId>(() => loadSavedTafsirEdition());
  const [fontSize, setFontSize] = useState<number>(() => loadSavedTafsirFontSize());
  const [loadedData, setLoadedData] = useState<{
    key: string;
    map: Map<number, string>;
  } | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [copiedAyah, setCopiedAyah] = useState(false);
  const [copiedTafsir, setCopiedTafsir] = useState(false);
  const [isSendingToReport, setIsSendingToReport] = useState(false);
  const [sentToReportState, setSentToReportState] = useState<'added' | 'updated' | null>(null);
  const [showDelayedSkeleton, setShowDelayedSkeleton] = useState(false);
  const [ayahScrollFade, setAyahScrollFade] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  const [isDraggingAyah, setIsDraggingAyah] = useState(false);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const ayahWrapRef = useRef<HTMLDivElement>(null);
  const ayahTextRef = useRef<HTMLParagraphElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const modalCardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const bottomDockState = useBottomDockCoordinatorState();
  const [viewportDims, setViewportDims] = useState<{ vw: number; vh: number }>(() => {
    if (typeof window === 'undefined') return { vw: 1280, vh: 800 };
    const docEl = document.documentElement;
    return {
      vw: docEl && docEl.clientWidth > 0 ? docEl.clientWidth : window.innerWidth,
      vh: docEl && docEl.clientHeight > 0 ? docEl.clientHeight : window.innerHeight,
    };
  });

  const surahMeta = target ? surahMetaMap.get(target.surahId) : undefined;
  const totalAyat = surahMeta?.totalAyat ?? 1;
  const surahName = surahMeta?.name ?? '';
  const activeDataKey = target ? `${editionId}:${target.surahId}` : null;

  const activeEdition = useMemo(
    () => TAFSIR_EDITIONS.find((ed) => ed.id === editionId) ?? TAFSIR_EDITIONS[0],
    [editionId]
  );

  const extractedAyah = useMemo(() => {
    if (!target) return { text: '', pageNum: null };
    return extractAyahTextFromDataset(mushafDataset, target.surahId, target.ayahNum);
  }, [mushafDataset, target]);

  const cachedSyncMap = target ? getCachedSurahTafsir(editionId, target.surahId) : null;

  useEffect(() => {
    if (!target || !activeDataKey) return;
    if (getCachedSurahTafsir(editionId, target.surahId)) {
      setErrorState(null);
      return;
    }

    let cancelled = false;
    setErrorState(null);

    fetchSurahTafsir(editionId, target.surahId)
      .then((map) => {
        if (!cancelled) {
          setLoadedData({ key: activeDataKey, map });
          setErrorState(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorState({
            key: activeDataKey,
            message: 'تعذّر تحميل التفسير حالياً. تأكد من الاتصال بالإنترنت ثم حاول مرة أخرى.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editionId, target?.surahId, activeDataKey, retryToken]);

  useEffect(() => {
    if (target && bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
    setCopiedAyah(false);
    setCopiedTafsir(false);
    setSentToReportState(null);
  }, [target?.surahId, target?.ayahNum, editionId]);

  const updateAyahScrollFade = useCallback(() => {
    const wrap = ayahWrapRef.current;
    const textEl = ayahTextRef.current;
    if (!wrap || !textEl) {
      setAyahScrollFade((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const textRect = textEl.getBoundingClientRect();
    const nextLeft = textRect.left < wrapRect.left - 2;
    const nextRight = textRect.right > wrapRect.right + 2;
    setAyahScrollFade((prev) =>
      prev.left === nextLeft && prev.right === nextRight ? prev : { left: nextLeft, right: nextRight }
    );
  }, []);

  useEffect(() => {
    const wrap = ayahWrapRef.current;
    const textEl = ayahTextRef.current;
    if (!wrap || !textEl || !extractedAyah.text) {
      setAyahScrollFade({ left: false, right: false });
      return;
    }

    // Reset horizontal scroll to the RTL start (right edge) when changing ayah
    wrap.scrollLeft = 0;
    const wrapRect = wrap.getBoundingClientRect();
    const textRect = textEl.getBoundingClientRect();
    if (textRect.right > wrapRect.right + 2) {
      wrap.scrollLeft = wrap.scrollWidth;
    }

    let rafId = window.requestAnimationFrame(updateAyahScrollFade);
    const scheduleFadeUpdate = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateAyahScrollFade();
      });
    };
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleFadeUpdate);
      ro.observe(wrap);
      ro.observe(textEl);
    }
    window.addEventListener('resize', scheduleFadeUpdate);
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) scheduleFadeUpdate();
    });

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', scheduleFadeUpdate);
    };
  }, [target?.surahId, target?.ayahNum, extractedAyah.text, updateAyahScrollFade]);

  const handleAyahPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const wrap = ayahWrapRef.current;
    if (!wrap || wrap.scrollWidth <= wrap.clientWidth + 2) return;

    const startX = e.clientX;
    const startScrollLeft = wrap.scrollLeft;
    setIsDraggingAyah(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      wrap.scrollLeft = startScrollLeft - dx;
    };

    const handlePointerEnd = () => {
      setIsDraggingAyah(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current?.();
    dragCleanupRef.current = handlePointerEnd;

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  }, []);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const canStepPrev = Boolean(target && target.ayahNum > 1);
  const canStepNext = Boolean(target && target.ayahNum < totalAyat);

  const handleStepAyah = useCallback(
    (delta: -1 | 1) => {
      if (!target) return;
      const nextNum = target.ayahNum + delta;
      if (nextNum < 1 || nextNum > totalAyat) return;
      onChangeTarget({ surahId: target.surahId, ayahNum: nextNum });
    },
    [target, totalAyat, onChangeTarget]
  );

  const isModalOpen = Boolean(target);

  useEffect(() => {
    if (!isModalOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalCardRef.current?.focus({ preventScroll: true });

    return () => {
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && prev.isConnected) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || typeof window === 'undefined') return;
    let rafId = 0;
    let vvTimer: number | null = null;
    const syncDims = () => {
      const docEl = document.documentElement;
      const vw = docEl && docEl.clientWidth > 0 ? docEl.clientWidth : window.innerWidth;
      const vh = docEl && docEl.clientHeight > 0 ? docEl.clientHeight : window.innerHeight;
      setViewportDims((prev) => (prev.vw === vw && prev.vh === vh ? prev : { vw, vh }));
    };
    const scheduleWinResize = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncDims();
      });
    };
    const scheduleVvResize = () => {
      if (vvTimer !== null) window.clearTimeout(vvTimer);
      vvTimer = window.setTimeout(() => {
        vvTimer = null;
        syncDims();
      }, 140);
    };
    syncDims();
    window.addEventListener('resize', scheduleWinResize, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleVvResize, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (vvTimer !== null) window.clearTimeout(vvTimer);
      window.removeEventListener('resize', scheduleWinResize);
      vv?.removeEventListener('resize', scheduleVvResize);
    };
  }, [isModalOpen]);

  const bottomDockClearance = useMemo(
    () =>
      isModalOpen
        ? computeBottomDockOverlayClearance(viewportDims.vw, viewportDims.vh, 660, bottomDockState)
        : 0,
    [isModalOpen, viewportDims.vw, viewportDims.vh, bottomDockState]
  );

  useEffect(() => {
    if (!target) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        handleStepAyah(-1);
      } else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        handleStepAyah(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [target, onClose, handleStepAyah]);

  const handleSelectEdition = (nextId: TafsirEditionId) => {
    setEditionId(nextId);
    saveTafsirEdition(nextId);
  };

  const handleAdjustFontSize = (delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(14, Math.min(24, prev + delta));
      saveTafsirFontSize(next);
      return next;
    });
  };

  const activeMap =
    cachedSyncMap ?? (activeDataKey && loadedData?.key === activeDataKey ? loadedData.map : null);
  const hasCurrentData = activeMap !== null;
  const activeErrorMsg =
    !hasCurrentData && activeDataKey && errorState?.key === activeDataKey ? errorState.message : null;
  const showLoading = Boolean(activeDataKey && !hasCurrentData && !activeErrorMsg);

  useEffect(() => {
    if (!showLoading) {
      setShowDelayedSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDelayedSkeleton(true), 140);
    return () => window.clearTimeout(timer);
  }, [showLoading, activeDataKey]);

  const currentTafsirText = target && activeMap ? activeMap.get(target.ayahNum) ?? '' : '';
  const paragraphs = useMemo(() => splitTafsirParagraphs(currentTafsirText), [currentTafsirText]);

  const handleCopyAyah = useCallback(() => {
    if (!target || !extractedAyah.text) return;
    const text = `﴿${extractedAyah.text}﴾ [سورة ${surahName}: ${toArabicDigits(target.ayahNum)}]`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedAyah(true);
        window.setTimeout(() => setCopiedAyah(false), 1800);
      })
      .catch(() => {});
  }, [target, extractedAyah.text, surahName]);

  const handleCopyTafsir = useCallback(() => {
    if (!target || (!extractedAyah.text && !currentTafsirText)) return;
    const lines: string[] = [];
    if (extractedAyah.text) {
      lines.push(`﴿${extractedAyah.text}﴾ [سورة ${surahName}: ${toArabicDigits(target.ayahNum)}]`);
    } else {
      lines.push(`[سورة ${surahName}: ${toArabicDigits(target.ayahNum)}]`);
    }
    if (currentTafsirText) {
      lines.push('');
      lines.push(`${activeEdition.title}:`);
      lines.push(currentTafsirText);
    }
    navigator.clipboard
      ?.writeText(lines.join('\n'))
      .then(() => {
        setCopiedTafsir(true);
        window.setTimeout(() => setCopiedTafsir(false), 1800);
      })
      .catch(() => {});
  }, [target, extractedAyah.text, currentTafsirText, surahName, activeEdition.title]);

  if (!target || !activeDataKey || typeof document === 'undefined') return null;

  const isThisAyahActive = Boolean(
    audioState?.activeTarget &&
      audioState.activeTarget.surahId === target.surahId &&
      audioState.activeTarget.ayahNum === target.ayahNum
  );
  const isSinglePlaying = Boolean(isThisAyahActive && audioState?.isSingleMode && audioState?.isPlaying);
  const isSingleLoading = Boolean(isThisAyahActive && audioState?.isSingleMode && audioState?.isLoading);
  const isStreamPlaying = Boolean(isThisAyahActive && !audioState?.isSingleMode && audioState?.isPlaying);
  const isStreamLoading = Boolean(isThisAyahActive && !audioState?.isSingleMode && audioState?.isLoading);

  return createPortal(
    <div
      className={`tafsir-modal-backdrop ${
        bottomDockClearance > 0 ? 'has-bottom-dock-clearance' : ''
      }`}
      style={
        bottomDockClearance > 0
          ? ({ '--tafsir-dock-clearance': `${bottomDockClearance}px` } as React.CSSProperties)
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label={`خيارات وتفسير سورة ${surahName} الآية ${toArabicDigits(target.ayahNum)}`}
      dir="rtl"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={modalCardRef}
        tabIndex={-1}
        className="tafsir-sheet-stack"
        style={{ '--tafsir-fs': `${fontSize}px` } as React.CSSProperties}
        data-annotation-ui="true"
      >
        {/* Top Floating Card: Ayah Display + Quick Audio & Copy Actions */}
        <section className="ayah-spot-card" aria-label="الآية المختارة وإجراءات التلاوة">
          {extractedAyah.text && (
            <div
              ref={ayahWrapRef}
              className={`ayah-spot-text-wrap ${ayahScrollFade.left ? 'is-fade-left' : ''} ${
                ayahScrollFade.right ? 'is-fade-right' : ''
              } ${ayahScrollFade.left || ayahScrollFade.right ? 'is-scrollable' : ''} ${
                isDraggingAyah ? 'is-dragging' : ''
              }`}
              onScroll={updateAyahScrollFade}
              onPointerDown={handleAyahPointerDown}
            >
              <p ref={ayahTextRef} className="ayah-spot-uthmani">
                {extractedAyah.text}{' '}
                <AyahRosette
                  ayahNum={target.ayahNum}
                  toArabicDigits={toArabicDigits}
                  isFocused={true}
                />
              </p>
            </div>
          )}

          {extractedAyah.text && <div className="ayah-spot-divider" aria-hidden="true" />}

          {audioState?.audioError && (
            <div className="ayah-spot-audio-error" role="status" aria-live="polite">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{audioState.audioError}</span>
            </div>
          )}

          <div className="ayah-spot-actions">
            {audioState && (
              <>
                <button
                  type="button"
                  className={`ayah-spot-action-btn ${isSinglePlaying ? 'is-active' : ''}`}
                  onClick={() => audioState.onPlaySingleAyah(target.surahId, target.ayahNum)}
                  title={isSinglePlaying ? 'إيقاف تلاوة الآية' : 'استماع لهذه الآية فقط'}
                >
                  <span className="ayah-spot-action-icon" aria-hidden="true">
                    {isSingleLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isSinglePlaying ? (
                      <Pause className="w-4 h-4" fill="currentColor" />
                    ) : (
                      <Play className="w-4 h-4" fill="currentColor" />
                    )}
                  </span>
                  <span className="ayah-spot-action-label">
                    {isSinglePlaying ? 'إيقاف' : 'الآية فقط'}
                  </span>
                </button>

                <button
                  type="button"
                  className={`ayah-spot-action-btn ${isStreamPlaying ? 'is-active' : ''}`}
                  onClick={() => audioState.onPlayFromHere(target.surahId, target.ayahNum)}
                  title={
                    isStreamPlaying
                      ? 'إيقاف التلاوة المتصلة مؤقتاً'
                      : 'بدء التلاوة المتصلة من هذه الآية'
                  }
                >
                  <span className="ayah-spot-action-icon" aria-hidden="true">
                    {isStreamLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isStreamPlaying ? (
                      <Pause className="w-4 h-4" fill="currentColor" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </span>
                  <span className="ayah-spot-action-label">
                    {isStreamPlaying ? 'إيقاف المتصلة' : 'البدء من هنا'}
                  </span>
                </button>

                <button
                  type="button"
                  className="ayah-spot-action-btn"
                  onClick={() => audioState.onOpenAudioSettings(target.surahId, target.ayahNum)}
                  title="تحديد نطاق ومقطع التلاوة (من آية أو صفحة أو جزء أو سورة)"
                >
                  <span className="ayah-spot-action-icon" aria-hidden="true">
                    <SlidersHorizontal className="w-4 h-4" />
                  </span>
                  <span className="ayah-spot-action-label">تحديد مقطع</span>
                </button>
              </>
            )}

            <button
              type="button"
              className={`ayah-spot-action-btn ${copiedAyah ? 'is-copied' : ''}`}
              disabled={!extractedAyah.text}
              onClick={handleCopyAyah}
              title="نسخ نص الآية الكريمة"
            >
              <span className="ayah-spot-action-icon" aria-hidden="true">
                {copiedAyah ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </span>
              <span className="ayah-spot-action-label">{copiedAyah ? 'تم النسخ' : 'نسخ الآية'}</span>
            </button>

            {onSendToReport && (
              <button
                type="button"
                className={`ayah-spot-action-btn is-report-send ${
                  sentToReportState || isAyahInReport ? 'is-active' : ''
                }`}
                disabled={isSendingToReport}
                onClick={async () => {
                  if (!target || isSendingToReport) return;
                  setIsSendingToReport(true);
                  try {
                    const res = await onSendToReport(target.surahId, target.ayahNum);
                    if (res) {
                      setSentToReportState(res);
                      window.setTimeout(() => setSentToReportState(null), 2400);
                    }
                  } finally {
                    setIsSendingToReport(false);
                  }
                }}
                title="التقاط هذه الآية مع علامات القلم وإرسالها إلى تقرير الحصة"
              >
                <span className="ayah-spot-action-icon" aria-hidden="true">
                  {isSendingToReport ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : sentToReportState ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <ClipboardPlus className="w-4 h-4" />
                  )}
                </span>
                <span className="ayah-spot-action-label">
                  {isSendingToReport
                    ? 'جارٍ الالتقاط...'
                    : sentToReportState === 'updated'
                    ? 'تم التحديث'
                    : sentToReportState === 'added'
                    ? 'تم الإرسال'
                    : isAyahInReport
                    ? 'تحديث بالتقرير'
                    : 'إرسال للتقرير'}
                </span>
              </button>
            )}
          </div>
        </section>

        {/* Bottom Card: Tafsir Reader */}
        <section className="tafsir-modal-card" aria-label="تفسير الآية">
          <header className="tafsir-modal-header">
            <button
              type="button"
              className="tafsir-close-btn"
              onClick={onClose}
              title="إغلاق (Esc)"
              aria-label="إغلاق نافذة الآية والتفسير"
            >
              <X className="w-4 h-4" strokeWidth={2.2} />
            </button>

            <div className="tafsir-modal-title-text">
              <h2 className="tafsir-modal-heading">
                سورة {surahName}
                <span className="tafsir-modal-dot" aria-hidden="true">·</span>
                <span>الآية {toArabicDigits(target.ayahNum)}</span>
              </h2>
            </div>

            <div className="tafsir-font-ctrl" role="group" aria-label="حجم خط التفسير">
              <button
                type="button"
                className="tafsir-icon-btn"
                onClick={() => handleAdjustFontSize(-1)}
                disabled={fontSize <= 14}
                title="تصغير خط التفسير"
                aria-label="تصغير خط التفسير"
              >
                <span className="tafsir-icon-btn-dec" aria-hidden="true">أ−</span>
              </button>
              <button
                type="button"
                className={`tafsir-font-label ${fontSize !== 17 ? 'is-modified' : ''}`}
                onClick={() => {
                  setFontSize(17);
                  saveTafsirFontSize(17);
                }}
                disabled={fontSize === 17}
                title={fontSize === 17 ? 'الحجم الافتراضي للخط' : 'إعادة الخط للحجم الافتراضي'}
                aria-label={`حجم الخط ${toArabicDigits(fontSize)}، اضغط لإعادة الضبط`}
              >
                {toArabicDigits(fontSize)}
              </button>
              <button
                type="button"
                className="tafsir-icon-btn"
                onClick={() => handleAdjustFontSize(1)}
                disabled={fontSize >= 24}
                title="تكبير خط التفسير"
                aria-label="تكبير خط التفسير"
              >
                <span className="tafsir-icon-btn-inc" aria-hidden="true">أ+</span>
              </button>
            </div>
          </header>

          <div className="tafsir-editions-bar" role="tablist" aria-label="اختيار كتاب التفسير">
            {TAFSIR_EDITIONS.map((ed) => {
              const isSelected = ed.id === editionId;
              return (
                <button
                  key={ed.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`tafsir-edition-tab ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleSelectEdition(ed.id)}
                  onPointerEnter={() => prefetchSurahTafsir(ed.id, target.surahId)}
                  onFocus={() => prefetchSurahTafsir(ed.id, target.surahId)}
                  title={ed.description}
                >
                  <span className="tafsir-edition-tab-name">{ed.shortTitle}</span>
                </button>
              );
            })}
          </div>

          <div ref={bodyScrollRef} className="tafsir-modal-scroll">
            <div className="tafsir-content-card" style={{ fontSize: `${fontSize}px` }}>
              {showLoading ? (
                showDelayedSkeleton ? (
                  <div className="tafsir-loading-state" aria-live="polite">
                    <div className="tafsir-skeleton-line is-wide" />
                    <div className="tafsir-skeleton-line" />
                    <div className="tafsir-skeleton-line is-short" />
                    <span className="tafsir-loading-caption">جارٍ تحميل {activeEdition.title}...</span>
                  </div>
                ) : (
                  <div className="tafsir-loading-state" aria-live="polite" aria-busy="true" />
                )
              ) : activeErrorMsg ? (
                <div className="tafsir-error-state" role="alert">
                  <p>{activeErrorMsg}</p>
                  <button
                    type="button"
                    className="tafsir-retry-btn"
                    onClick={() => {
                      setErrorState(null);
                      setRetryToken((t) => t + 1);
                    }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>إعادة المحاولة</span>
                  </button>
                </div>
              ) : paragraphs.length > 0 ? (
                <div
                  className={`tafsir-paragraphs ${
                    editionId === 'al-muyassar-fi-al-gharib' ? 'is-gharib-list' : ''
                  }`}
                >
                  {paragraphs.map((para, idx) => {
                    const headingText = normalizeSectionLabel(para);
                    if (headingText) {
                      return (
                        <h3 key={idx} className="tafsir-section-heading">
                          {headingText}
                        </h3>
                      );
                    }
                    if (BASMALAH_RE.test(para)) {
                      return (
                        <p key={idx} className="tafsir-basmalah-line">
                          {para}
                        </p>
                      );
                    }
                    return (
                      <p key={idx} className="tafsir-paragraph">
                        {renderInlineQuranQuotes(para)}
                      </p>
                    );
                  })}
                </div>
              ) : editionId === 'al-muyassar-fi-al-gharib' ? (
                <div className="tafsir-empty-gharib">
                  ألفاظ هذه الآية الكريمة واضحة وميسّرة، ولا توجد فيها مفردات غريبة في كتاب «الميسّر في غريب القرآن».
                </div>
              ) : (
                <div className="tafsir-empty-gharib">
                  لا يتوفر نص تفسير لهذه الآية في الكتاب المختار حالياً.
                </div>
              )}
            </div>
          </div>

          <footer className="tafsir-modal-footer">
            {(extractedAyah.text || currentTafsirText) ? (
              <button
                type="button"
                className={`tafsir-copy-btn ${copiedTafsir ? 'is-copied' : ''}`}
                onClick={handleCopyTafsir}
                title="نسخ الآية والتفسير"
              >
                {copiedTafsir ? (
                  <>
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>نسخ التفسير</span>
                  </>
                )}
              </button>
            ) : (
              <span />
            )}

            <div className="tafsir-nav-pill">
              <button
                type="button"
                className="tafsir-nav-btn"
                disabled={!canStepPrev}
                onClick={() => handleStepAyah(-1)}
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
                <span>السابق</span>
              </button>

              <span className="tafsir-footer-counter">
                {toArabicDigits(target.ayahNum)} / {toArabicDigits(totalAyat)}
              </span>

              <button
                type="button"
                className="tafsir-nav-btn"
                disabled={!canStepNext}
                onClick={() => handleStepAyah(1)}
              >
                <span>التالي</span>
                <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>,
    document.body
  );
};
