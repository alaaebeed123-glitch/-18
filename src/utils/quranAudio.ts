import type { MushafDataset, MushafSurahMeta } from './mushafData';

export type ReciterId =
  | 'Alafasy_128kbps'
  | 'Husary_128kbps'
  | 'Husary_Muallim_128kbps'
  | 'Minshawy_Murattal_128kbps'
  | 'Abdul_Basit_Murattal_192kbps'
  | 'MaherAlMuaiqly128kbps'
  | 'Yasser_Ad-Dussary_128kbps'
  | 'Abdurrahmaan_As-Sudais_192kbps';

export interface ReciterMeta {
  id: ReciterId;
  name: string;
  shortName: string;
  style: string;
}

export const QURAN_RECITERS: readonly ReciterMeta[] = [
  {
    id: 'Alafasy_128kbps',
    name: 'مشاري راشد العفاسي',
    shortName: 'العفاسي',
    style: 'مرتل',
  },
  {
    id: 'Husary_128kbps',
    name: 'محمود خليل الحصري',
    shortName: 'الحصري',
    style: 'مرتل',
  },
  {
    id: 'Husary_Muallim_128kbps',
    name: 'محمود خليل الحصري (المعلم)',
    shortName: 'الحصري المعلم',
    style: 'للتلقين والحفظ',
  },
  {
    id: 'Minshawy_Murattal_128kbps',
    name: 'محمد صديق المنشاوي',
    shortName: 'المنشاوي',
    style: 'مرتل',
  },
  {
    id: 'Abdul_Basit_Murattal_192kbps',
    name: 'عبد الباسط عبد الصمد',
    shortName: 'عبد الباسط',
    style: 'مرتل',
  },
  {
    id: 'MaherAlMuaiqly128kbps',
    name: 'ماهر المعيقلي',
    shortName: 'المعيقلي',
    style: 'مرتل',
  },
  {
    id: 'Yasser_Ad-Dussary_128kbps',
    name: 'ياسر الدوسري',
    shortName: 'الدوسري',
    style: 'مرتل',
  },
  {
    id: 'Abdurrahmaan_As-Sudais_192kbps',
    name: 'عبد الرحمن السديس',
    shortName: 'السديس',
    style: 'مرتل',
  },
];

export const DEFAULT_RECITER_ID: ReciterId = 'Alafasy_128kbps';
export type AyahRepeatOption = number; // 0 = continuous repeat of same ayah, >= 1 = exact repeat count
export type PlaybackRateOption = 0.75 | 0.85 | 1 | 1.25 | 1.5 | 1.75 | 2;

export const AYAH_REPEAT_OPTIONS: readonly number[] = [1, 2, 3, 5, 7, 0];
export const AYAH_COUNT_PRESETS: readonly number[] = [1, 3, 5, 10, 0]; // 0 = continuous playback
export const PLAYBACK_RATE_OPTIONS: readonly PlaybackRateOption[] = [0.75, 0.85, 1, 1.25, 1.5, 1.75, 2];

export type AudioPauseGap = 'none' | '3s' | '5s' | 'ayah';

export const AUDIO_PAUSE_GAP_OPTIONS: readonly { id: AudioPauseGap; label: string }[] = [
  { id: 'none', label: 'بدون' },
  { id: '3s', label: '٣ ثوانٍ' },
  { id: '5s', label: '٥ ثوانٍ' },
  { id: 'ayah', label: 'بقدر الآية' },
];

const RECITER_STORAGE_KEY = 'talakah_quran_reciter_v1';
const RATE_STORAGE_KEY = 'talakah_quran_rate_v1';
const REPEAT_STORAGE_KEY = 'talakah_quran_repeat_v1';
const AYAH_COUNT_STORAGE_KEY = 'talakah_quran_ayah_count_v1';
const SECTION_REPEAT_STORAGE_KEY = 'talakah_quran_section_repeat_v1';
const AUTO_FOLLOW_STORAGE_KEY = 'talakah_quran_auto_follow_v1';
const PAUSE_GAP_STORAGE_KEY = 'talakah_quran_pause_gap_v1';
const STOP_AT_PAGE_END_STORAGE_KEY = 'talakah_quran_stop_page_end_v1';

export function isValidReciterId(value: string | null): value is ReciterId {
  return Boolean(value && QURAN_RECITERS.some((r) => r.id === value));
}

export function loadSavedReciterId(): ReciterId {
  if (typeof window === 'undefined') return DEFAULT_RECITER_ID;
  try {
    const saved = window.localStorage.getItem(RECITER_STORAGE_KEY);
    return isValidReciterId(saved) ? saved : DEFAULT_RECITER_ID;
  } catch {
    return DEFAULT_RECITER_ID;
  }
}

export function saveReciterId(id: ReciterId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECITER_STORAGE_KEY, id);
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedPlaybackRate(): PlaybackRateOption {
  if (typeof window === 'undefined') return 1;
  try {
    const num = Number(window.localStorage.getItem(RATE_STORAGE_KEY));
    if (PLAYBACK_RATE_OPTIONS.includes(num as PlaybackRateOption)) {
      return num as PlaybackRateOption;
    }
    return 1;
  } catch {
    return 1;
  }
}

export function savePlaybackRate(rate: PlaybackRateOption): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedAyahRepeat(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(REPEAT_STORAGE_KEY);
    if (raw === null) return 1;
    const num = Math.floor(Number(raw));
    if (Number.isFinite(num) && num >= 0 && num <= 99) {
      return num;
    }
    return 1;
  } catch {
    return 1;
  }
}

export function saveAyahRepeat(repeat: number): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = Math.max(0, Math.min(99, Math.floor(repeat)));
    window.localStorage.setItem(REPEAT_STORAGE_KEY, String(normalized));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedAyahCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(AYAH_COUNT_STORAGE_KEY);
    if (raw === null) return 0;
    const num = Math.floor(Number(raw));
    if (Number.isFinite(num) && num >= 0 && num <= 6236) {
      return num;
    }
    return 0;
  } catch {
    return 0;
  }
}

export function saveAyahCount(count: number): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = Math.max(0, Math.min(6236, Math.floor(count)));
    window.localStorage.setItem(AYAH_COUNT_STORAGE_KEY, String(normalized));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedSectionRepeat(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SECTION_REPEAT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSectionRepeat(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SECTION_REPEAT_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedAudioAutoFollow(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(AUTO_FOLLOW_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function saveAudioAutoFollow(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTO_FOLLOW_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedAudioPauseGap(): AudioPauseGap {
  if (typeof window === 'undefined') return 'none';
  try {
    const raw = window.localStorage.getItem(PAUSE_GAP_STORAGE_KEY);
    if (raw === 'none' || raw === '3s' || raw === '5s' || raw === 'ayah') return raw;
    return 'none';
  } catch {
    return 'none';
  }
}

export function saveAudioPauseGap(gap: AudioPauseGap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAUSE_GAP_STORAGE_KEY, gap);
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSavedStopAtPageEnd(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STOP_AT_PAGE_END_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveStopAtPageEnd(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STOP_AT_PAGE_END_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage quota issues
  }
}

function pad3(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(3, '0');
}

export function getAyahAudioUrl(
  reciterId: ReciterId,
  surahId: number,
  ayahNum: number
): string {
  return `https://everyayah.com/data/${reciterId}/${pad3(surahId)}${pad3(ayahNum)}.mp3`;
}

let preloadAudioEl: HTMLAudioElement | null = null;
let lastPreloadedUrl = '';

export function preloadAyahAudio(
  reciterId: ReciterId,
  surahId: number,
  ayahNum: number
): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  const url = getAyahAudioUrl(reciterId, surahId, ayahNum);
  if (url === lastPreloadedUrl) return;
  lastPreloadedUrl = url;
  if (!preloadAudioEl) {
    preloadAudioEl = new Audio();
    preloadAudioEl.preload = 'auto';
  }
  preloadAudioEl.src = url;
  preloadAudioEl.load();
}

export interface AyahRef {
  surahId: number;
  ayahNum: number;
}

export function getNextQuranAyah(
  surahId: number,
  ayahNum: number,
  surahMetaMap: Map<number, MushafSurahMeta>
): AyahRef | null {
  const currentMeta = surahMetaMap.get(surahId);
  const total = currentMeta?.totalAyat ?? 1;
  if (ayahNum < total) {
    return { surahId, ayahNum: ayahNum + 1 };
  }
  if (surahId < 114) {
    return { surahId: surahId + 1, ayahNum: 1 };
  }
  return null;
}

export function getPrevQuranAyah(
  surahId: number,
  ayahNum: number,
  surahMetaMap: Map<number, MushafSurahMeta>
): AyahRef | null {
  if (ayahNum > 1) {
    return { surahId, ayahNum: ayahNum - 1 };
  }
  if (surahId > 1) {
    const prevMeta = surahMetaMap.get(surahId - 1);
    if (prevMeta) {
      return { surahId: prevMeta.id, ayahNum: prevMeta.totalAyat };
    }
  }
  return null;
}

export function computeAyahRangeEnd(
  startSurahId: number,
  startAyahNum: number,
  count: number,
  surahMetaMap: Map<number, MushafSurahMeta>
): { end: AyahRef; actualCount: number } {
  if (count <= 1) {
    return { end: { surahId: startSurahId, ayahNum: startAyahNum }, actualCount: 1 };
  }
  let cur: AyahRef = { surahId: startSurahId, ayahNum: startAyahNum };
  let actualCount = 1;
  for (let i = 1; i < count; i++) {
    const next = getNextQuranAyah(cur.surahId, cur.ayahNum, surahMetaMap);
    if (!next) break;
    cur = next;
    actualCount += 1;
  }
  return { end: cur, actualCount };
}

export function findMushafPageForAyah(
  dataset: MushafDataset | null,
  surahId: number,
  ayahNum: number
): number | null {
  if (!dataset) return null;
  for (let i = 0; i < dataset.pages.length; i++) {
    const page = dataset.pages[i];
    for (const row of page.rows) {
      if (row.k !== 't' || !row.r) continue;
      for (const run of row.r) {
        if (run.s === surahId && run.a === ayahNum) {
          return i + 1;
        }
      }
    }
  }
  return null;
}

export function compareAyahRefs(a: AyahRef, b: AyahRef): number {
  if (a.surahId !== b.surahId) return a.surahId - b.surahId;
  return a.ayahNum - b.ayahNum;
}

export function countAyahsBetween(
  from: AyahRef,
  to: AyahRef,
  surahMetaMap: Map<number, MushafSurahMeta>
): number {
  if (compareAyahRefs(to, from) <= 0) return 1;
  if (from.surahId === to.surahId) {
    return to.ayahNum - from.ayahNum + 1;
  }
  const fromTotal = surahMetaMap.get(from.surahId)?.totalAyat ?? from.ayahNum;
  let total = Math.max(1, fromTotal - from.ayahNum + 1);
  for (let sid = from.surahId + 1; sid < to.surahId; sid++) {
    total += surahMetaMap.get(sid)?.totalAyat ?? 0;
  }
  total += Math.max(1, to.ayahNum);
  return total;
}

export interface AyahSpanResult {
  start: AyahRef;
  end: AyahRef;
  count: number;
}

export function getPageAyahSpan(
  dataset: MushafDataset | null,
  fromPage: number,
  toPage: number,
  surahMetaMap: Map<number, MushafSurahMeta>
): AyahSpanResult | null {
  if (!dataset || dataset.pages.length === 0) return null;
  const maxPage = dataset.pages.length;
  const p1 = Math.max(1, Math.min(maxPage, fromPage));
  const p2 = Math.max(p1, Math.min(maxPage, toPage));
  let start: AyahRef | null = null;
  let end: AyahRef | null = null;

  for (let p = p1; p <= p2; p++) {
    const page = dataset.pages[p - 1];
    if (!page) continue;
    for (const row of page.rows) {
      if (row.k !== 't' || !row.r) continue;
      for (const run of row.r) {
        const ref: AyahRef = { surahId: run.s, ayahNum: run.a };
        if (!start) start = ref;
        end = ref;
      }
    }
  }
  if (!start || !end) return null;
  return {
    start,
    end,
    count: countAyahsBetween(start, end, surahMetaMap),
  };
}

export function getJozzAyahSpan(
  dataset: MushafDataset | null,
  fromJozz: number,
  toJozz: number,
  surahMetaMap: Map<number, MushafSurahMeta>
): AyahSpanResult | null {
  if (!dataset || dataset.pages.length === 0) return null;
  const j1 = Math.max(1, Math.min(30, fromJozz));
  const j2 = Math.max(j1, Math.min(30, toJozz));
  let start: AyahRef | null = null;
  let end: AyahRef | null = null;

  for (const page of dataset.pages) {
    if (page.j < j1 || page.j > j2) continue;
    for (const row of page.rows) {
      if (row.k !== 't' || !row.r) continue;
      for (const run of row.r) {
        const ref: AyahRef = { surahId: run.s, ayahNum: run.a };
        if (!start) start = ref;
        end = ref;
      }
    }
  }
  if (!start || !end) return null;
  return {
    start,
    end,
    count: countAyahsBetween(start, end, surahMetaMap),
  };
}
