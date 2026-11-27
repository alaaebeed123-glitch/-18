import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Loader2,
  Pause,
  Play,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  TOTAL_MUSHAF_PAGES,
  toArabicDigits,
  type MushafDataset,
  type MushafSurahMeta,
} from '../utils/mushafData';
import {
  QURAN_RECITERS,
  compareAyahRefs,
  computeAyahRangeEnd,
  countAyahsBetween,
  findMushafPageForAyah,
  getJozzAyahSpan,
  getPageAyahSpan,
  type PlaybackRateOption,
  type ReciterId,
} from '../utils/quranAudio';

export interface AudioControlTarget {
  surahId: number;
  ayahNum: number;
}

export interface AudioControlApplyPayload {
  surahId: number;
  ayahNum: number;
  reciterId: ReciterId;
  rate: PlaybackRateOption;
  repeat: number;
  repeatSection: boolean;
  ayahCount: number;
  autoFollow: boolean;
}

type AudioScopeType = 'ayah' | 'page' | 'jozz' | 'surah';
type AudioRangeMode = 'continuous' | 'range' | 'single';

interface AudioControlModalProps {
  target: AudioControlTarget | null;
  onClose: () => void;
  surahMetaMap: Map<number, MushafSurahMeta>;
  mushafDataset: MushafDataset | null;
  currentPageSurahId?: number;
  currentPageNum?: number;
  currentJozz?: number;
  reciterId: ReciterId;
  rate: PlaybackRateOption;
  repeat: number;
  repeatSection: boolean;
  ayahCount: number;
  autoFollow: boolean;
  activeSessionTotal?: number;
  activeSessionRepeatSection?: boolean;
  activeAudioTarget: AudioControlTarget | null;
  isPlaying: boolean;
  isLoading: boolean;
  onStartPlayback: (payload: AudioControlApplyPayload) => void;
  onPausePlayback: () => void;
  onOpenAudioDock?: () => void;
}

export const AudioControlModal: React.FC<AudioControlModalProps> = ({
  target,
  onClose,
  surahMetaMap,
  mushafDataset,
  currentPageSurahId,
  currentPageNum,
  currentJozz,
  reciterId,
  rate,
  repeat,
  repeatSection,
  ayahCount,
  autoFollow,
  activeSessionTotal,
  activeSessionRepeatSection,
  activeAudioTarget,
  isPlaying,
  isLoading,
  onStartPlayback,
  onPausePlayback,
  onOpenAudioDock,
}) => {
  const modalCardRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [scopeType, setScopeType] = useState<AudioScopeType>('ayah');
  const [rangeMode, setRangeMode] = useState<AudioRangeMode>('single');

  // Ayah scope state
  const [fromSurahId, setFromSurahId] = useState<number>(target?.surahId ?? 1);
  const [fromAyah, setFromAyah] = useState<number>(target?.ayahNum ?? 1);
  const [toSurahId, setToSurahId] = useState<number>(target?.surahId ?? 1);
  const [toAyah, setToAyah] = useState<number>(target?.ayahNum ?? 1);

  // Page scope state
  const [fromPage, setFromPage] = useState<number>(currentPageNum ?? 1);
  const [toPage, setToPage] = useState<number>(currentPageNum ?? 1);

  // Jozz scope state
  const [fromJozz, setFromJozz] = useState<number>(currentJozz ?? 1);
  const [toJozz, setToJozz] = useState<number>(currentJozz ?? 1);

  // Surah scope state
  const [fromRangeSurahId, setFromRangeSurahId] = useState<number>(target?.surahId ?? 1);
  const [toRangeSurahId, setToRangeSurahId] = useState<number>(target?.surahId ?? 1);

  // Section loop toggle (only relevant when defining a multi-ayah passage)
  const [repeatSectionDraft, setRepeatSectionDraft] = useState<boolean>(repeatSection);

  const orderedSurahs = useMemo(
    () => Array.from(surahMetaMap.values()).sort((a, b) => a.id - b.id),
    [surahMetaMap]
  );

  const pageNumbers = useMemo(
    () => Array.from({ length: TOTAL_MUSHAF_PAGES }, (_, i) => i + 1),
    []
  );

  const jozzNumbers = useMemo(() => Array.from({ length: 30 }, (_, i) => i + 1), []);

  useEffect(() => {
    if (!target) return;
    const meta = surahMetaMap.get(target.surahId);
    const total = meta?.totalAyat ?? 7;
    const clampedFromAyah = Math.max(1, Math.min(total, target.ayahNum));

    const effectiveCount =
      activeAudioTarget &&
      activeAudioTarget.surahId === target.surahId &&
      activeAudioTarget.ayahNum === clampedFromAyah &&
      activeSessionTotal !== undefined
        ? activeSessionTotal
        : ayahCount;

    const initialMode: AudioRangeMode =
      effectiveCount === 0 ? 'continuous' : effectiveCount > 1 ? 'range' : 'single';

    const endInfo =
      effectiveCount > 1
        ? computeAyahRangeEnd(target.surahId, clampedFromAyah, effectiveCount, surahMetaMap)
        : { end: { surahId: target.surahId, ayahNum: clampedFromAyah }, actualCount: 1 };

    const targetPage =
      findMushafPageForAyah(mushafDataset, target.surahId, clampedFromAyah) ??
      currentPageNum ??
      1;
    const targetJozz = mushafDataset?.pages[targetPage - 1]?.j ?? currentJozz ?? 1;

    setScopeType('ayah');
    setRangeMode(initialMode);

    setFromSurahId(target.surahId);
    setFromAyah(clampedFromAyah);
    setToSurahId(endInfo.end.surahId);
    setToAyah(endInfo.end.ayahNum);

    setFromPage(targetPage);
    setToPage(targetPage);

    setFromJozz(targetJozz);
    setToJozz(targetJozz);

    setFromRangeSurahId(target.surahId);
    setToRangeSurahId(target.surahId);

    setRepeatSectionDraft(
      effectiveCount === 0 ? false : activeSessionRepeatSection ?? repeatSection
    );
  }, [
    target,
    surahMetaMap,
    mushafDataset,
    currentPageNum,
    currentJozz,
    repeatSection,
    ayahCount,
    activeSessionTotal,
    activeSessionRepeatSection,
    activeAudioTarget,
  ]);

  const isOpen = Boolean(target);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  const fromSurahTotal = surahMetaMap.get(fromSurahId)?.totalAyat ?? 7;
  const toSurahTotal = surahMetaMap.get(toSurahId)?.totalAyat ?? 7;

  const fromAyahOptions = useMemo(
    () => Array.from({ length: fromSurahTotal }, (_, i) => i + 1),
    [fromSurahTotal]
  );

  const toAyahOptions = useMemo(() => {
    const minAyah = toSurahId === fromSurahId ? fromAyah : 1;
    const len = Math.max(1, toSurahTotal - minAyah + 1);
    return Array.from({ length: len }, (_, i) => minAyah + i);
  }, [toSurahId, fromSurahId, fromAyah, toSurahTotal]);

  const resolvedSelection = useMemo(() => {
    if (scopeType === 'ayah') {
      const start = { surahId: fromSurahId, ayahNum: fromAyah };
      if (rangeMode === 'continuous') {
        return { start, count: 0 };
      }
      if (rangeMode === 'single') {
        return { start, count: 1 };
      }
      const end = { surahId: toSurahId, ayahNum: toAyah };
      return {
        start,
        count: countAyahsBetween(start, end, surahMetaMap),
      };
    }

    if (scopeType === 'page') {
      const span = getPageAyahSpan(
        mushafDataset,
        fromPage,
        rangeMode === 'range' ? toPage : fromPage,
        surahMetaMap
      );
      if (span) {
        return {
          start: span.start,
          count: rangeMode === 'continuous' ? 0 : span.count,
        };
      }
      return {
        start: { surahId: fromSurahId, ayahNum: fromAyah },
        count: rangeMode === 'continuous' ? 0 : 1,
      };
    }

    if (scopeType === 'jozz') {
      const span = getJozzAyahSpan(
        mushafDataset,
        fromJozz,
        rangeMode === 'range' ? toJozz : fromJozz,
        surahMetaMap
      );
      if (span) {
        return {
          start: span.start,
          count: rangeMode === 'continuous' ? 0 : span.count,
        };
      }
      return {
        start: { surahId: fromSurahId, ayahNum: fromAyah },
        count: rangeMode === 'continuous' ? 0 : 1,
      };
    }

    // scopeType === 'surah'
    const start = { surahId: fromRangeSurahId, ayahNum: 1 };
    if (rangeMode === 'continuous') {
      return { start, count: 0 };
    }
    const endSid = rangeMode === 'single' ? fromRangeSurahId : toRangeSurahId;
    const endTotal = surahMetaMap.get(endSid)?.totalAyat ?? 1;
    return {
      start,
      count: countAyahsBetween(start, { surahId: endSid, ayahNum: endTotal }, surahMetaMap),
    };
  }, [
    scopeType,
    rangeMode,
    fromSurahId,
    fromAyah,
    toSurahId,
    toAyah,
    fromPage,
    toPage,
    fromJozz,
    toJozz,
    fromRangeSurahId,
    toRangeSurahId,
    mushafDataset,
    surahMetaMap,
  ]);

  const canRepeatSection = resolvedSelection.count > 1;
  const selectionSummaryText = useMemo(() => {
    if (resolvedSelection.count === 0) {
      const sName = surahMetaMap.get(resolvedSelection.start.surahId)?.name ?? '';
      return `متصل من ${sName} (${toArabicDigits(resolvedSelection.start.ayahNum)})`;
    }
    if (resolvedSelection.count === 1) return 'آية واحدة';
    if (resolvedSelection.count === 2) return 'آيتان';
    if (resolvedSelection.count <= 10) return `${toArabicDigits(resolvedSelection.count)} آيات`;
    return `${toArabicDigits(resolvedSelection.count)} آية`;
  }, [resolvedSelection, surahMetaMap]);

  if (!target || typeof document === 'undefined') return null;

  const openSurahId = currentPageSurahId ?? target.surahId;
  const isSameActiveTarget =
    activeAudioTarget?.surahId === resolvedSelection.start.surahId &&
    activeAudioTarget?.ayahNum === resolvedSelection.start.ayahNum;
  const isLoadingThisTarget = Boolean(isSameActiveTarget && isLoading);

  const handleChangeFromSurah = (nextSid: number) => {
    const initialAyah = 1;
    setFromSurahId(nextSid);
    setFromAyah(initialAyah);
    if (compareAyahRefs({ surahId: toSurahId, ayahNum: toAyah }, { surahId: nextSid, ayahNum: initialAyah }) < 0) {
      setToSurahId(nextSid);
      setToAyah(initialAyah);
    }
  };

  const handleChangeFromAyah = (nextAyah: number) => {
    setFromAyah(nextAyah);
    if (compareAyahRefs({ surahId: toSurahId, ayahNum: toAyah }, { surahId: fromSurahId, ayahNum: nextAyah }) < 0) {
      setToSurahId(fromSurahId);
      setToAyah(nextAyah);
    }
  };

  const handleChangeToSurah = (nextSid: number) => {
    const nextTotal = surahMetaMap.get(nextSid)?.totalAyat ?? 7;
    setToSurahId(nextSid);
    if (nextSid === fromSurahId) {
      setToAyah((prev) => Math.max(fromAyah, Math.min(nextTotal, prev)));
    } else {
      setToAyah(Math.min(nextTotal, 1));
    }
  };

  const handleChangeFromPage = (nextPage: number) => {
    setFromPage(nextPage);
    if (toPage < nextPage) setToPage(nextPage);
  };

  const handleChangeFromJozz = (nextJozz: number) => {
    setFromJozz(nextJozz);
    if (toJozz < nextJozz) setToJozz(nextJozz);
  };

  const handleChangeFromRangeSurah = (nextSid: number) => {
    setFromRangeSurahId(nextSid);
    if (toRangeSurahId < nextSid) setToRangeSurahId(nextSid);
  };

  const activeReciterShort =
    QURAN_RECITERS.find((r) => r.id === reciterId)?.shortName ?? 'القارئ';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStartPlayback({
      surahId: resolvedSelection.start.surahId,
      ayahNum: resolvedSelection.start.ayahNum,
      reciterId,
      rate,
      repeat,
      repeatSection: canRepeatSection && repeatSectionDraft,
      ayahCount: resolvedSelection.count,
      autoFollow,
    });
    onClose();
  };

  return createPortal(
    <div
      className="audio-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="تحديد مقطع التلاوة"
      dir="rtl"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        ref={modalCardRef}
        tabIndex={-1}
        className="audio-modal-card"
        data-annotation-ui="true"
        onSubmit={handleSubmit}
      >
        {/* Top Action Bar: Close (Right) + Play CTA (Left) */}
        <header className="audio-modal-header">
          <div className="audio-modal-header-right">
            <button
              type="button"
              className="audio-modal-close-btn"
              onClick={onClose}
              aria-label="إغلاق نافذة تحديد المقطع"
              title="إغلاق (Esc)"
            >
              <X className="w-4 h-4" strokeWidth={2.2} />
            </button>
            <h2 className="audio-modal-heading">تحديد مقطع التلاوة</h2>
          </div>

          <div className="audio-modal-header-actions">
            {isPlaying && (
              <button
                type="button"
                className="audio-top-stop-btn"
                onClick={() => {
                  onPausePlayback();
                  onClose();
                }}
              >
                <Pause className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true" />
                <span>إيقاف</span>
              </button>
            )}
            <button type="submit" className="audio-top-play-btn">
              <span>{isPlaying ? 'تطبيق المقطع' : 'تشغيل المقطع'}</span>
              {isLoadingThisTarget ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        <div className="audio-modal-body">
          {/* 1. حدد المقطع */}
          <section className="audio-section" aria-labelledby="audio-sec-range">
            <div className="audio-section-head">
              <span id="audio-sec-range" className="audio-section-label">
                نطاق التلاوة
              </span>
              <span className="audio-range-summary">{selectionSummaryText}</span>
            </div>

            <div className="audio-group-card is-range-card">
              {/* 4 Scope Tabs */}
              <div className="audio-seg-track is-4" role="tablist" aria-label="نطاق التلاوة">
                {(
                  [
                    { id: 'ayah', label: 'الآية' },
                    { id: 'page', label: 'الصفحة' },
                    { id: 'jozz', label: 'الجزء' },
                    { id: 'surah', label: 'سورة' },
                  ] as const
                ).map((tab) => {
                  const active = scopeType === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`audio-seg-tab ${active ? 'is-active' : ''}`}
                      onClick={() => setScopeType(tab.id)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* 3 Mode Tabs: متصل vs المقطع vs فقط */}
              <div className="audio-seg-track is-3" role="group" aria-label="نوع التحديد">
                <button
                  type="button"
                  aria-pressed={rangeMode === 'continuous'}
                  className={`audio-seg-tab ${rangeMode === 'continuous' ? 'is-active' : ''}`}
                  onClick={() => setRangeMode('continuous')}
                  title="تلاوة مستمرة بلا توقف من نقطة البداية"
                >
                  متصل
                </button>
                <button
                  type="button"
                  aria-pressed={rangeMode === 'range'}
                  className={`audio-seg-tab ${rangeMode === 'range' ? 'is-active' : ''}`}
                  onClick={() => setRangeMode('range')}
                >
                  المقطع
                </button>
                <button
                  type="button"
                  aria-pressed={rangeMode === 'single'}
                  className={`audio-seg-tab ${rangeMode === 'single' ? 'is-active' : ''}`}
                  onClick={() => setRangeMode('single')}
                >
                  فقط
                </button>
              </div>

              {/* Pickers according to Scope + Mode */}
              <div className="audio-pickers-stack">
                {scopeType === 'ayah' && (
                  <>
                    <div className="audio-picker-block">
                      <span className="audio-picker-kicker">
                        {rangeMode === 'single' ? 'الآية' : 'من'}
                      </span>
                      <div className="audio-dual-picker">
                        <div className="audio-pill-select-wrap is-surah">
                          <select
                            aria-label="سورة البداية"
                            className="audio-pill-select"
                            value={fromSurahId}
                            onChange={(e) => handleChangeFromSurah(Number(e.target.value))}
                          >
                            {orderedSurahs.map((s) => (
                              <option key={s.id} value={s.id}>
                                {toArabicDigits(s.id)}. {s.name}
                                {s.id === openSurahId ? ' (المفتوحة)' : ''}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                        </div>
                        <div className="audio-pill-select-wrap is-num">
                          <select
                            aria-label="رقم آية البداية"
                            className="audio-pill-select is-num"
                            value={fromAyah}
                            onChange={(e) => handleChangeFromAyah(Number(e.target.value))}
                          >
                            {fromAyahOptions.map((num) => (
                              <option key={num} value={num}>
                                {toArabicDigits(num)}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    {rangeMode === 'range' && (
                      <>
                        <div className="audio-card-divider" aria-hidden="true" />
                        <div className="audio-picker-block">
                          <span className="audio-picker-kicker">إلى</span>
                          <div className="audio-dual-picker">
                            <div className="audio-pill-select-wrap is-surah">
                              <select
                                aria-label="سورة النهاية"
                                className="audio-pill-select"
                                value={toSurahId}
                                onChange={(e) => handleChangeToSurah(Number(e.target.value))}
                              >
                                {orderedSurahs
                                  .filter((s) => s.id >= fromSurahId)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {toArabicDigits(s.id)}. {s.name}
                                      {s.id === openSurahId ? ' (المفتوحة)' : ''}
                                    </option>
                                  ))}
                              </select>
                              <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                            </div>
                            <div className="audio-pill-select-wrap is-num">
                              <select
                                aria-label="رقم آية النهاية"
                                className="audio-pill-select is-num"
                                value={toAyah}
                                onChange={(e) => setToAyah(Number(e.target.value))}
                              >
                                {toAyahOptions.map((num) => (
                                  <option key={num} value={num}>
                                    {toArabicDigits(num)}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {scopeType === 'page' && (
                  <>
                    <div className="audio-picker-block">
                      <span className="audio-picker-kicker">
                        {rangeMode === 'single' ? 'الصفحة' : 'من'}
                      </span>
                      <div className="audio-pill-select-wrap">
                        <select
                          aria-label="صفحة البداية"
                          className="audio-pill-select"
                          value={fromPage}
                          onChange={(e) => handleChangeFromPage(Number(e.target.value))}
                        >
                          {pageNumbers.map((p) => (
                            <option key={p} value={p}>
                              صفحة {toArabicDigits(p)}
                              {p === (currentPageNum ?? -1) ? ' (الحالية)' : ''}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                      </div>
                    </div>

                    {rangeMode === 'range' && (
                      <>
                        <div className="audio-card-divider" aria-hidden="true" />
                        <div className="audio-picker-block">
                          <span className="audio-picker-kicker">إلى</span>
                          <div className="audio-pill-select-wrap">
                            <select
                              aria-label="صفحة النهاية"
                              className="audio-pill-select"
                              value={toPage}
                              onChange={(e) => setToPage(Number(e.target.value))}
                            >
                              {pageNumbers
                                .filter((p) => p >= fromPage)
                                .map((p) => (
                                  <option key={p} value={p}>
                                    صفحة {toArabicDigits(p)}
                                  </option>
                                ))}
                            </select>
                            <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {scopeType === 'jozz' && (
                  <>
                    <div className="audio-picker-block">
                      <span className="audio-picker-kicker">
                        {rangeMode === 'single' ? 'الجزء' : 'من'}
                      </span>
                      <div className="audio-pill-select-wrap">
                        <select
                          aria-label="جزء البداية"
                          className="audio-pill-select"
                          value={fromJozz}
                          onChange={(e) => handleChangeFromJozz(Number(e.target.value))}
                        >
                          {jozzNumbers.map((j) => (
                            <option key={j} value={j}>
                              الجزء {toArabicDigits(j)}
                              {j === (currentJozz ?? -1) ? ' (الحالي)' : ''}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                      </div>
                    </div>

                    {rangeMode === 'range' && (
                      <>
                        <div className="audio-card-divider" aria-hidden="true" />
                        <div className="audio-picker-block">
                          <span className="audio-picker-kicker">إلى</span>
                          <div className="audio-pill-select-wrap">
                            <select
                              aria-label="جزء النهاية"
                              className="audio-pill-select"
                              value={toJozz}
                              onChange={(e) => setToJozz(Number(e.target.value))}
                            >
                              {jozzNumbers
                                .filter((j) => j >= fromJozz)
                                .map((j) => (
                                  <option key={j} value={j}>
                                    الجزء {toArabicDigits(j)}
                                  </option>
                                ))}
                            </select>
                            <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {scopeType === 'surah' && (
                  <>
                    <div className="audio-picker-block">
                      <span className="audio-picker-kicker">
                        {rangeMode === 'single' ? 'السورة' : 'من'}
                      </span>
                      <div className="audio-pill-select-wrap">
                        <select
                          aria-label="سورة البداية"
                          className="audio-pill-select"
                          value={fromRangeSurahId}
                          onChange={(e) => handleChangeFromRangeSurah(Number(e.target.value))}
                        >
                          {orderedSurahs.map((s) => (
                            <option key={s.id} value={s.id}>
                              {toArabicDigits(s.id)}. سورة {s.name} ({toArabicDigits(s.totalAyat)} آية)
                              {s.id === openSurahId ? ' — المفتوحة' : ''}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                      </div>
                    </div>

                    {rangeMode === 'range' && (
                      <>
                        <div className="audio-card-divider" aria-hidden="true" />
                        <div className="audio-picker-block">
                          <span className="audio-picker-kicker">إلى</span>
                          <div className="audio-pill-select-wrap">
                            <select
                              aria-label="سورة النهاية"
                              className="audio-pill-select"
                              value={toRangeSurahId}
                              onChange={(e) => setToRangeSurahId(Number(e.target.value))}
                            >
                              {orderedSurahs
                                .filter((s) => s.id >= fromRangeSurahId)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {toArabicDigits(s.id)}. سورة {s.name} ({toArabicDigits(s.totalAyat)} آية)
                                  </option>
                                ))}
                            </select>
                            <ChevronDown className="audio-pill-chevron w-3.5 h-3.5" aria-hidden="true" />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 2. تكرار المقطع (يظهر فقط عند تحديد أكثر من آية) */}
          {canRepeatSection && (
            <section className="audio-section" aria-label="خيار تكرار المقطع">
              <div className="audio-group-card is-toggles">
                <div className="audio-toggle-row">
                  <span className="audio-toggle-title">تكرار هذا المقطع كاملاً</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={repeatSectionDraft}
                    aria-label="تكرار هذا المقطع كاملاً"
                    className={`audio-switch ${repeatSectionDraft ? 'is-on' : ''}`}
                    onClick={() => setRepeatSectionDraft((prev) => !prev)}
                  >
                    <span className="audio-switch-thumb" />
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 3. شريط سياق الصوت الحالي (مصدر الحقيقة في شريط الصوت السفلي) */}
          <div className="audio-modal-context-strip">
            <div className="audio-modal-context-meta">
              <span>{activeReciterShort}</span>
              <span aria-hidden="true">·</span>
              <span>السرعة {toArabicDigits(rate)}×</span>
              <span aria-hidden="true">·</span>
              <span>
                {repeat === 0
                  ? 'تكرار الآية ∞'
                  : repeat === 1
                  ? 'بلا تكرار للآية'
                  : `تكرار الآية ${toArabicDigits(repeat)}×`}
              </span>
            </div>
            {onOpenAudioDock && (
              <button
                type="button"
                className="audio-modal-context-link"
                onClick={() => {
                  onClose();
                  onOpenAudioDock();
                }}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>تعديل الصوت والقارئ</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
};
