import { useSyncExternalStore } from 'react';

export type ReportMistakeCategory = 'memorization' | 'recitation' | 'tajweed';

export type ReportOverallRating = 'excellent' | 'very_good' | 'good' | 'needs_focus';

export interface CapturedAyahMistake {
  id: string;
  surahId: number;
  surahName: string;
  ayahNum: number;
  pageNum: number;
  ayahText: string;
  imageDataUrl: string;
  imageAspectRatio: number;
  category: ReportMistakeCategory;
  note: string;
  capturedAt: number;
}

export interface SessionReportData {
  id: string;
  studentName: string;
  teacherName: string;
  academyTitle: string;
  sessionDate: string;
  surahSummary: string;
  overallRating: ReportOverallRating;
  newHifzToday: string;
  reviewToday: string;
  nextHifz: string;
  nextReview: string;
  teacherNote: string;
  mistakes: CapturedAyahMistake[];
  updatedAt: number;
}

export interface PendingMushafJump {
  pageNum: number;
  surahId: number;
  ayahNum: number;
  seq: number;
}

export interface ReportStoreSnapshot {
  draft: SessionReportData;
  history: SessionReportData[];
  pendingMushafJump: PendingMushafJump | null;
}

export const MISTAKE_CATEGORY_LABELS: Record<ReportMistakeCategory, string> = {
  memorization: 'خطأ حفظ',
  recitation: 'خطأ تلاوة وتشكيل',
  tajweed: 'ملاحظة تجويد',
};

export const RATING_LABELS: Record<ReportOverallRating, string> = {
  excellent: 'ممتاز',
  very_good: 'جيد جداً',
  good: 'جيد',
  needs_focus: 'يحتاج تركيز',
};

const DRAFT_STORAGE_KEY = 'safara_session_report_draft_v1';
const HISTORY_STORAGE_KEY = 'safara_session_report_history_v1';
const MAX_HISTORY_ITEMS = 16;

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeReportId(): string {
  return `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptySessionReport(preserveDefaultsFrom?: Partial<SessionReportData>): SessionReportData {
  return {
    id: makeReportId(),
    studentName: '',
    teacherName: preserveDefaultsFrom?.teacherName ?? '',
    academyTitle: preserveDefaultsFrom?.academyTitle ?? 'منصة مَعَ السَّفَرَة',
    sessionDate: getTodayIsoDate(),
    surahSummary: '',
    overallRating: 'very_good',
    newHifzToday: '',
    reviewToday: '',
    nextHifz: '',
    nextReview: '',
    teacherNote: '',
    mistakes: [],
    updatedAt: Date.now(),
  };
}

function normalizeDraft(raw: unknown): SessionReportData {
  const base = createEmptySessionReport();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SessionReportData>;
  const validRating: ReportOverallRating =
    r.overallRating === 'excellent' ||
    r.overallRating === 'very_good' ||
    r.overallRating === 'good' ||
    r.overallRating === 'needs_focus'
      ? r.overallRating
      : 'very_good';

  const mistakes: CapturedAyahMistake[] = Array.isArray(r.mistakes)
    ? r.mistakes
        .filter(
          (m): m is CapturedAyahMistake =>
            Boolean(m) &&
            typeof m === 'object' &&
            typeof m.surahId === 'number' &&
            typeof m.ayahNum === 'number' &&
            typeof m.imageDataUrl === 'string' &&
            m.imageDataUrl.length > 0
        )
        .map((m) => ({
          id: typeof m.id === 'string' && m.id ? m.id : `err_${m.surahId}_${m.ayahNum}_${Date.now()}`,
          surahId: m.surahId,
          surahName: typeof m.surahName === 'string' ? m.surahName : '',
          ayahNum: m.ayahNum,
          pageNum: typeof m.pageNum === 'number' ? m.pageNum : 1,
          ayahText: typeof m.ayahText === 'string' ? m.ayahText : '',
          imageDataUrl: m.imageDataUrl,
          imageAspectRatio:
            typeof m.imageAspectRatio === 'number' && m.imageAspectRatio > 0 ? m.imageAspectRatio : 4,
          category:
            m.category === 'memorization' || m.category === 'recitation' || m.category === 'tajweed'
              ? m.category
              : 'recitation',
          note: typeof m.note === 'string' ? m.note : '',
          capturedAt: typeof m.capturedAt === 'number' ? m.capturedAt : Date.now(),
        }))
    : [];

  return {
    id: typeof r.id === 'string' && r.id ? r.id : base.id,
    studentName: typeof r.studentName === 'string' ? r.studentName : '',
    teacherName: typeof r.teacherName === 'string' ? r.teacherName : '',
    academyTitle: typeof r.academyTitle === 'string' && r.academyTitle ? r.academyTitle : base.academyTitle,
    sessionDate: typeof r.sessionDate === 'string' && r.sessionDate ? r.sessionDate : base.sessionDate,
    surahSummary: typeof r.surahSummary === 'string' ? r.surahSummary : '',
    overallRating: validRating,
    newHifzToday: typeof r.newHifzToday === 'string' ? r.newHifzToday : '',
    reviewToday: typeof r.reviewToday === 'string' ? r.reviewToday : '',
    nextHifz: typeof r.nextHifz === 'string' ? r.nextHifz : '',
    nextReview: typeof r.nextReview === 'string' ? r.nextReview : '',
    teacherNote: typeof r.teacherNote === 'string' ? r.teacherNote : '',
    mistakes,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

function loadInitialSnapshot(): ReportStoreSnapshot {
  if (typeof window === 'undefined') {
    return {
      draft: createEmptySessionReport(),
      history: [],
      pendingMushafJump: null,
    };
  }
  let draft = createEmptySessionReport();
  let history: SessionReportData[] = [];
  try {
    const rawDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (rawDraft) {
      draft = normalizeDraft(JSON.parse(rawDraft));
    }
  } catch {
    // ignore storage errors
  }
  try {
    const rawHist = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (rawHist) {
      const parsed = JSON.parse(rawHist);
      if (Array.isArray(parsed)) {
        history = parsed.map((item) => normalizeDraft(item)).slice(0, MAX_HISTORY_ITEMS);
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    draft,
    history,
    pendingMushafJump: null,
  };
}

let storeSnapshot: ReportStoreSnapshot = loadInitialSnapshot();
const listeners = new Set<() => void>();
let jumpSeqCounter = 1;

function persistDraftAndHistory(nextDraft: SessionReportData, nextHistory: SessionReportData[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
  } catch {
    // If quota exceeded (e.g. many large images in history), trim oldest history items and retry
    try {
      const trimmedHistory = nextHistory.slice(0, 4);
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmedHistory));
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft));
    } catch {
      // ignore if still full
    }
  }
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
  } catch {
    // ignore history quota overflow
  }
}

function commitSnapshot(next: ReportStoreSnapshot): void {
  storeSnapshot = next;
  persistDraftAndHistory(next.draft, next.history);
  listeners.forEach((cb) => cb());
}

export function subscribeReportStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getReportSnapshot(): ReportStoreSnapshot {
  return storeSnapshot;
}

export function useSessionReport(): ReportStoreSnapshot {
  return useSyncExternalStore(subscribeReportStore, getReportSnapshot, getReportSnapshot);
}

export function updateReportDraft(
  patch: Partial<Omit<SessionReportData, 'id' | 'updatedAt'>>
): void {
  const nextDraft: SessionReportData = {
    ...storeSnapshot.draft,
    ...patch,
    updatedAt: Date.now(),
  };
  commitSnapshot({
    ...storeSnapshot,
    draft: nextDraft,
  });
}

export function upsertCapturedAyahMistake(input: {
  surahId: number;
  surahName: string;
  ayahNum: number;
  pageNum: number;
  ayahText: string;
  imageDataUrl: string;
  imageAspectRatio: number;
  category?: ReportMistakeCategory;
  note?: string;
}): { action: 'added' | 'updated'; totalCount: number } {
  const current = storeSnapshot.draft;
  const existingIdx = current.mistakes.findIndex(
    (m) => m.surahId === input.surahId && m.ayahNum === input.ayahNum
  );

  let nextMistakes: CapturedAyahMistake[];
  let action: 'added' | 'updated';

  if (existingIdx >= 0) {
    action = 'updated';
    const existing = current.mistakes[existingIdx];
    nextMistakes = current.mistakes.slice();
    nextMistakes[existingIdx] = {
      ...existing,
      surahName: input.surahName || existing.surahName,
      pageNum: input.pageNum,
      ayahText: input.ayahText || existing.ayahText,
      imageDataUrl: input.imageDataUrl,
      imageAspectRatio: input.imageAspectRatio,
      capturedAt: Date.now(),
    };
  } else {
    action = 'added';
    const newEntry: CapturedAyahMistake = {
      id: `err_${input.surahId}_${input.ayahNum}_${Date.now().toString(36)}`,
      surahId: input.surahId,
      surahName: input.surahName,
      ayahNum: input.ayahNum,
      pageNum: input.pageNum,
      ayahText: input.ayahText,
      imageDataUrl: input.imageDataUrl,
      imageAspectRatio: input.imageAspectRatio,
      category: input.category ?? 'recitation',
      note: input.note ?? '',
      capturedAt: Date.now(),
    };
    nextMistakes = [...current.mistakes, newEntry];
  }

  // Keep surahSummary gracefully synced if still empty
  let nextSurahSummary = current.surahSummary;
  if (!nextSurahSummary.trim() && input.surahName) {
    nextSurahSummary = `سورة ${input.surahName}`;
  } else if (
    action === 'added' &&
    input.surahName &&
    nextSurahSummary.startsWith('سورة ') &&
    !nextSurahSummary.includes(input.surahName)
  ) {
    nextSurahSummary = `${nextSurahSummary} · سورة ${input.surahName}`;
  }

  commitSnapshot({
    ...storeSnapshot,
    draft: {
      ...current,
      surahSummary: nextSurahSummary,
      mistakes: nextMistakes,
      updatedAt: Date.now(),
    },
  });

  return { action, totalCount: nextMistakes.length };
}

export function updateCapturedMistake(
  mistakeId: string,
  patch: Partial<Pick<CapturedAyahMistake, 'category' | 'note'>>
): void {
  const current = storeSnapshot.draft;
  const idx = current.mistakes.findIndex((m) => m.id === mistakeId);
  if (idx === -1) return;
  const nextMistakes = current.mistakes.slice();
  nextMistakes[idx] = { ...nextMistakes[idx], ...patch };
  commitSnapshot({
    ...storeSnapshot,
    draft: {
      ...current,
      mistakes: nextMistakes,
      updatedAt: Date.now(),
    },
  });
}

export function removeCapturedMistake(mistakeId: string): void {
  const current = storeSnapshot.draft;
  const nextMistakes = current.mistakes.filter((m) => m.id !== mistakeId);
  if (nextMistakes.length === current.mistakes.length) return;
  commitSnapshot({
    ...storeSnapshot,
    draft: {
      ...current,
      mistakes: nextMistakes,
      updatedAt: Date.now(),
    },
  });
}

export function moveCapturedMistake(mistakeId: string, direction: -1 | 1): void {
  const current = storeSnapshot.draft;
  const idx = current.mistakes.findIndex((m) => m.id === mistakeId);
  if (idx === -1) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= current.mistakes.length) return;
  const nextMistakes = current.mistakes.slice();
  const [item] = nextMistakes.splice(idx, 1);
  nextMistakes.splice(targetIdx, 0, item);
  commitSnapshot({
    ...storeSnapshot,
    draft: {
      ...current,
      mistakes: nextMistakes,
      updatedAt: Date.now(),
    },
  });
}

export function clearReportMistakes(): void {
  const current = storeSnapshot.draft;
  if (current.mistakes.length === 0) return;
  commitSnapshot({
    ...storeSnapshot,
    draft: {
      ...current,
      mistakes: [],
      updatedAt: Date.now(),
    },
  });
}

export function hasSubstantiveReportContent(report: SessionReportData): boolean {
  return Boolean(
    report.studentName.trim() ||
      report.surahSummary.trim() ||
      report.newHifzToday.trim() ||
      report.reviewToday.trim() ||
      report.nextHifz.trim() ||
      report.nextReview.trim() ||
      report.teacherNote.trim() ||
      report.mistakes.length > 0
  );
}

export function archiveAndStartNewReport(): void {
  const current = storeSnapshot.draft;
  let nextHistory = storeSnapshot.history;
  if (hasSubstantiveReportContent(current)) {
    const filtered = nextHistory.filter((item) => item.id !== current.id);
    nextHistory = [current, ...filtered].slice(0, MAX_HISTORY_ITEMS);
  }
  const freshDraft = createEmptySessionReport({
    teacherName: current.teacherName,
    academyTitle: current.academyTitle,
  });
  commitSnapshot({
    ...storeSnapshot,
    draft: freshDraft,
    history: nextHistory,
  });
}

export function loadReportFromHistory(reportId: string): void {
  const target = storeSnapshot.history.find((item) => item.id === reportId);
  if (!target) return;
  const current = storeSnapshot.draft;
  let nextHistory = storeSnapshot.history.filter((item) => item.id !== reportId);
  if (hasSubstantiveReportContent(current) && current.id !== target.id) {
    nextHistory = [current, ...nextHistory.filter((item) => item.id !== current.id)].slice(
      0,
      MAX_HISTORY_ITEMS
    );
  }
  commitSnapshot({
    ...storeSnapshot,
    draft: { ...target, updatedAt: Date.now() },
    history: nextHistory,
  });
}

export function deleteReportFromHistory(reportId: string): void {
  const nextHistory = storeSnapshot.history.filter((item) => item.id !== reportId);
  if (nextHistory.length === storeSnapshot.history.length) return;
  commitSnapshot({
    ...storeSnapshot,
    history: nextHistory,
  });
}

export function requestJumpToMushafAyah(pageNum: number, surahId: number, ayahNum: number): void {
  jumpSeqCounter += 1;
  storeSnapshot = {
    ...storeSnapshot,
    pendingMushafJump: { pageNum, surahId, ayahNum, seq: jumpSeqCounter },
  };
  listeners.forEach((cb) => cb());
}

export function clearPendingMushafJump(): void {
  if (!storeSnapshot.pendingMushafJump) return;
  storeSnapshot = {
    ...storeSnapshot,
    pendingMushafJump: null,
  };
  listeners.forEach((cb) => cb());
}
