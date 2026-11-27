import {
  DIACRITIC_RE,
  TOTAL_MUSHAF_PAGES,
  toArabicDigits,
  type MushafDataset,
  type MushafSurahMeta,
} from './mushafData';

// 41 Surah-start Rub el-Hizb coordinates (surahId:1) that pair with the 199 NBSP-marked
// mid-Surah quarters in mushaf_pages_v18.json to form all 240 Hafs Madinah Mushaf quarters.
const SURAH_START_RUB_KEYS = new Set<string>([
  '1:1',
  '4:1',
  '5:1',
  '7:1',
  '8:1',
  '9:1',
  '15:1',
  '16:1',
  '17:1',
  '20:1',
  '21:1',
  '22:1',
  '23:1',
  '24:1',
  '25:1',
  '26:1',
  '27:1',
  '29:1',
  '30:1',
  '33:1',
  '40:1',
  '46:1',
  '49:1',
  '55:1',
  '56:1',
  '58:1',
  '62:1',
  '65:1',
  '66:1',
  '67:1',
  '68:1',
  '69:1',
  '72:1',
  '75:1',
  '78:1',
  '80:1',
  '82:1',
  '84:1',
  '87:1',
  '90:1',
  '94:1',
]);

export type HizbQuarterKind = 'hizb' | 'rub' | 'nisf' | 'thalatha';

export const HIZB_QUARTER_LABELS: Record<HizbQuarterKind, string> = {
  hizb: 'بداية الحزب',
  rub: 'ربع الحزب',
  nisf: 'نصف الحزب',
  thalatha: 'ثلاثة أرباع الحزب',
};

export interface QuranHizbQuarterInfo {
  quarterNumber: number; // 1..240
  hizbNum: number; // 1..60
  quarterIndexInHizb: 0 | 1 | 2 | 3;
  kind: HizbQuarterKind;
  kindLabel: string;
  jozz: number; // 1..30
  pageNum: number;
  lineNum: number;
  surahId: number;
  surahName: string;
  ayahNum: number;
  ayahKey: string;
  snippet: string;
}

export interface QuranSajdahInfo {
  index: number; // 1..15
  pageNum: number;
  lineNum: number;
  jozz: number;
  surahId: number;
  surahName: string;
  ayahNum: number;
  ayahKey: string;
  snippet: string;
}

export interface QuranJuzSummary {
  jozz: number;
  pageNum: number;
  surahId: number;
  surahName: string;
  ayahNum: number;
  ayahKey: string;
  snippet: string;
}

export interface QuranIndexedAyah {
  key: string;
  surahId: number;
  surahName: string;
  ayahNum: number;
  pageNum: number;
  jozz: number;
  uthmaniText: string;
  normText: string;
  expandedText: string;
}

export interface QuranSearchResult {
  kind: 'direct-page' | 'direct-juz' | 'direct-hizb' | 'ayah';
  id: string;
  title: string;
  subtitle: string;
  pageNum: number;
  surahId?: number;
  surahName?: string;
  ayahNum?: number;
  jozz?: number;
  snippet?: string;
  score: number;
}

const ALL_DIACRITICS_GLOBAL_RE = new RegExp(
  `${DIACRITIC_RE.source}|[\u06DE\u06E9\u06D6-\u06ED\u0615-\u061A\u064B-\u065F\u0670\u0640]`,
  'g'
);

export function arabicDigitsToAscii(input: string): string {
  return input.replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
}

/**
 * Normalizes Arabic / Uthmani text for forgiving diacritic-free Quran search.
 * Optionally converts dagger alif (U+0670) to regular alif so standard keyboard
 * spellings (e.g. "الرحمان" / "مالك" / "الكتاب") match Uthmani orthography too.
 */
export function normalizeArabicForSearch(text: string, expandDaggerAlif = false): string {
  let s = text;
  if (expandDaggerAlif) {
    s = s.replace(/\u0670/g, 'ا');
  }
  s = s
    .replace(ALL_DIACRITICS_GLOBAL_RE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

const SURAH_PREFIX_RE = /^(?:سوره|سورة)\s+/;

export function normalizeSurahNameForMatch(name: string): string {
  return normalizeArabicForSearch(name, true).replace(SURAH_PREFIX_RE, '').trim();
}

interface DatasetIndexCache {
  quarters: QuranHizbQuarterInfo[];
  sajdahs: QuranSajdahInfo[];
  juzSummaries: QuranJuzSummary[];
  quartersByPage: Map<number, QuranHizbQuarterInfo[]>;
  sajdahsByPage: Map<number, QuranSajdahInfo[]>;
  activeQuarterByPage: Map<number, QuranHizbQuarterInfo>;
  ayahs: QuranIndexedAyah[];
}

const datasetIndexCache = new WeakMap<MushafDataset, DatasetIndexCache>();

function cleanUthmaniRunSnippet(raw: string): string {
  return raw
    .replace(/[\u00A0\s]+/g, ' ')
    .replace(/\u06DE/g, '')
    .trim();
}

export function getOrBuildQuranIndex(dataset: MushafDataset): DatasetIndexCache {
  const existing = datasetIndexCache.get(dataset);
  if (existing) return existing;

  const surahMap = new Map<number, MushafSurahMeta>();
  for (const s of dataset.surahs) {
    surahMap.set(s.id, s);
  }

  const rawQuarters: Array<{
    pageNum: number;
    lineNum: number;
    jozz: number;
    surahId: number;
    ayahNum: number;
    snippet: string;
  }> = [];
  const rawSajdahs: Array<{
    pageNum: number;
    lineNum: number;
    jozz: number;
    surahId: number;
    ayahNum: number;
    snippet: string;
  }> = [];

  const ayahTextAccum = new Map<
    string,
    { surahId: number; ayahNum: number; pageNum: number; jozz: number; parts: string[] }
  >();
  const orderedAyahKeys: string[] = [];
  const seenQuarterKeys = new Set<string>();
  const seenSajdahKeys = new Set<string>();
  const juzStartCandidate = new Map<number, { pageNum: number; surahId: number; ayahNum: number; snippet: string }>();

  for (let pIdx = 0; pIdx < dataset.pages.length; pIdx++) {
    const pageNum = pIdx + 1;
    const rawPage = dataset.pages[pIdx];
    const pageJozz = rawPage.j;

    for (const row of rawPage.rows) {
      if (row.k !== 't' || !row.r) continue;
      for (const run of row.r) {
        const aKey = `${run.s}:${run.a}`;
        const cleaned = cleanUthmaniRunSnippet(run.t);

        let entry = ayahTextAccum.get(aKey);
        if (!entry) {
          entry = {
            surahId: run.s,
            ayahNum: run.a,
            pageNum,
            jozz: pageJozz,
            parts: [],
          };
          ayahTextAccum.set(aKey, entry);
          orderedAyahKeys.push(aKey);
        }
        if (cleaned) {
          entry.parts.push(cleaned);
        }

        if (!juzStartCandidate.has(pageJozz) && cleaned) {
          juzStartCandidate.set(pageJozz, {
            pageNum,
            surahId: run.s,
            ayahNum: run.a,
            snippet: cleaned,
          });
        }

        const isNbspQuarter = run.t.startsWith('\u00A0') && !run.t.includes('\u06DE');
        const isSurahStartQuarter = run.a === 1 && SURAH_START_RUB_KEYS.has(aKey);
        if ((isNbspQuarter || isSurahStartQuarter) && !seenQuarterKeys.has(aKey)) {
          seenQuarterKeys.add(aKey);
          rawQuarters.push({
            pageNum,
            lineNum: row.l,
            jozz: pageJozz,
            surahId: run.s,
            ayahNum: run.a,
            snippet: cleaned,
          });
        }

        if (run.t.includes('\u06E9') && !seenSajdahKeys.has(aKey)) {
          seenSajdahKeys.add(aKey);
          rawSajdahs.push({
            pageNum,
            lineNum: row.l,
            jozz: pageJozz,
            surahId: run.s,
            ayahNum: run.a,
            snippet: cleaned,
          });
        }
      }
    }
  }

  const quarterKinds: HizbQuarterKind[] = ['hizb', 'rub', 'nisf', 'thalatha'];
  const quarters: QuranHizbQuarterInfo[] = rawQuarters.map((q, idx) => {
    const qNum = idx + 1;
    const hizbNum = Math.floor(idx / 4) + 1;
    const quarterIndexInHizb = (idx % 4) as 0 | 1 | 2 | 3;
    const kind = quarterKinds[quarterIndexInHizb];
    const computedJozz = Math.min(30, Math.floor(idx / 8) + 1);
    const fullAyah = ayahTextAccum.get(`${q.surahId}:${q.ayahNum}`);
    const fullSnippet = fullAyah ? fullAyah.parts.join(' ') : q.snippet;
    return {
      quarterNumber: qNum,
      hizbNum,
      quarterIndexInHizb,
      kind,
      kindLabel: HIZB_QUARTER_LABELS[kind],
      jozz: computedJozz,
      pageNum: q.pageNum,
      lineNum: q.lineNum,
      surahId: q.surahId,
      surahName: surahMap.get(q.surahId)?.name || '',
      ayahNum: q.ayahNum,
      ayahKey: `${q.surahId}:${q.ayahNum}`,
      snippet: fullSnippet.split(' ').slice(0, 8).join(' '),
    };
  });

  const sajdahs: QuranSajdahInfo[] = rawSajdahs.map((s, idx) => {
    const fullAyah = ayahTextAccum.get(`${s.surahId}:${s.ayahNum}`);
    const fullSnippet = fullAyah ? fullAyah.parts.join(' ') : s.snippet;
    return {
      index: idx + 1,
      pageNum: s.pageNum,
      lineNum: s.lineNum,
      jozz: s.jozz,
      surahId: s.surahId,
      surahName: surahMap.get(s.surahId)?.name || '',
      ayahNum: s.ayahNum,
      ayahKey: `${s.surahId}:${s.ayahNum}`,
      snippet: fullSnippet.replace(/\u06E9/g, '').trim(),
    };
  });

  const quartersByPage = new Map<number, QuranHizbQuarterInfo[]>();
  for (const q of quarters) {
    const arr = quartersByPage.get(q.pageNum);
    if (arr) arr.push(q);
    else quartersByPage.set(q.pageNum, [q]);
  }

  const sajdahsByPage = new Map<number, QuranSajdahInfo[]>();
  for (const saj of sajdahs) {
    const arr = sajdahsByPage.get(saj.pageNum);
    if (arr) arr.push(saj);
    else sajdahsByPage.set(saj.pageNum, [saj]);
  }

  // Track the active quarter in effect as the reader reads each page
  const activeQuarterByPage = new Map<number, QuranHizbQuarterInfo>();
  let latestQuarter: QuranHizbQuarterInfo | undefined = quarters[0];
  let qPtr = 0;
  for (let p = 1; p <= TOTAL_MUSHAF_PAGES; p++) {
    while (qPtr < quarters.length && quarters[qPtr].pageNum <= p) {
      latestQuarter = quarters[qPtr];
      qPtr++;
    }
    if (latestQuarter) {
      activeQuarterByPage.set(p, latestQuarter);
    }
  }

  const juzSummaries: QuranJuzSummary[] = [];
  for (let j = 1; j <= 30; j++) {
    const qStart = quarters[(j - 1) * 8];
    const fallback = juzStartCandidate.get(j);
    if (qStart) {
      juzSummaries.push({
        jozz: j,
        pageNum: qStart.pageNum,
        surahId: qStart.surahId,
        surahName: qStart.surahName,
        ayahNum: qStart.ayahNum,
        ayahKey: qStart.ayahKey,
        snippet: qStart.snippet,
      });
    } else if (fallback) {
      juzSummaries.push({
        jozz: j,
        pageNum: fallback.pageNum,
        surahId: fallback.surahId,
        surahName: surahMap.get(fallback.surahId)?.name || '',
        ayahNum: fallback.ayahNum,
        ayahKey: `${fallback.surahId}:${fallback.ayahNum}`,
        snippet: fallback.snippet,
      });
    }
  }

  const ayahs: QuranIndexedAyah[] = orderedAyahKeys.map((key) => {
    const entry = ayahTextAccum.get(key)!;
    const uthmaniText = entry.parts.join(' ').replace(/\s+/g, ' ').trim();
    return {
      key,
      surahId: entry.surahId,
      surahName: surahMap.get(entry.surahId)?.name || '',
      ayahNum: entry.ayahNum,
      pageNum: entry.pageNum,
      jozz: entry.jozz,
      uthmaniText,
      normText: normalizeArabicForSearch(uthmaniText, false),
      expandedText: normalizeArabicForSearch(uthmaniText, true),
    };
  });

  const built: DatasetIndexCache = {
    quarters,
    sajdahs,
    juzSummaries,
    quartersByPage,
    sajdahsByPage,
    activeQuarterByPage,
    ayahs,
  };
  datasetIndexCache.set(dataset, built);
  return built;
}

export function searchQuranIndex(
  rawQuery: string,
  dataset: MushafDataset,
  surahs: MushafSurahMeta[],
  limit = 36
): QuranSearchResult[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const index = getOrBuildQuranIndex(dataset);
  const asciiQuery = arabicDigitsToAscii(trimmed).replace(/[：﹕]/g, ':');
  const results: QuranSearchResult[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (item: QuranSearchResult) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    results.push(item);
  };

  // 1. Page number jump: "500", "ص 500", "صفحة 500", "p 500"
  const pageMatch = asciiQuery.match(/^(?:(?:ص|صفحه|صفحة|p|page)\s*)?(\d{1,3})$/i);
  if (pageMatch) {
    const pageNum = Number(pageMatch[1]);
    if (pageNum >= 1 && pageNum <= TOTAL_MUSHAF_PAGES) {
      const rawPage = dataset.pages[pageNum - 1];
      const firstRun = rawPage?.rows.find((r) => r.k === 't' && r.r && r.r.length > 0)?.r?.[0];
      const surahName = firstRun
        ? surahs.find((s) => s.id === firstRun.s)?.name || ''
        : '';
      pushUnique({
        kind: 'direct-page',
        id: `page:${pageNum}`,
        title: `الانتقال إلى صفحة ${toArabicDigits(pageNum)}`,
        subtitle: `${surahName ? `سورة ${surahName} · ` : ''}الجزء ${toArabicDigits(rawPage?.j || 1)}`,
        pageNum,
        jozz: rawPage?.j || 1,
        score: 200,
      });
    }
  }

  // 2. Juz jump: "جزء 30", "الجزء 15", "ج 1"
  const juzMatch = asciiQuery.match(/^(?:الجزء|جزء|ج)\s*(\d{1,2})$/);
  if (juzMatch) {
    const jNum = Number(juzMatch[1]);
    if (jNum >= 1 && jNum <= 30) {
      const summary = index.juzSummaries.find((j) => j.jozz === jNum);
      if (summary) {
        pushUnique({
          kind: 'direct-juz',
          id: `juz:${jNum}`,
          title: `الجزء ${toArabicDigits(jNum)}`,
          subtitle: `سورة ${summary.surahName} · الآية ${toArabicDigits(summary.ayahNum)} · ص ${toArabicDigits(summary.pageNum)}`,
          pageNum: summary.pageNum,
          surahId: summary.surahId,
          surahName: summary.surahName,
          ayahNum: summary.ayahNum,
          jozz: jNum,
          snippet: summary.snippet,
          score: 195,
        });
      }
    }
  }

  // 3. Hizb jump: "حزب 59", "الحزب 1"
  const hizbMatch = asciiQuery.match(/^(?:الحزب|حزب|ح)\s*(\d{1,2})$/);
  if (hizbMatch) {
    const hNum = Number(hizbMatch[1]);
    if (hNum >= 1 && hNum <= 60) {
      const quarter = index.quarters.find((q) => q.hizbNum === hNum && q.quarterIndexInHizb === 0);
      if (quarter) {
        pushUnique({
          kind: 'direct-hizb',
          id: `hizb:${hNum}`,
          title: `الحزب ${toArabicDigits(hNum)}`,
          subtitle: `سورة ${quarter.surahName} · الآية ${toArabicDigits(quarter.ayahNum)} · ص ${toArabicDigits(quarter.pageNum)}`,
          pageNum: quarter.pageNum,
          surahId: quarter.surahId,
          surahName: quarter.surahName,
          ayahNum: quarter.ayahNum,
          jozz: quarter.jozz,
          snippet: quarter.snippet,
          score: 195,
        });
      }
    }
  }

  // 4. Surah:Ayah numeric format: "2:255"
  const colonMatch = asciiQuery.match(/^(\d{1,3})\s*[:\-/]\s*(\d{1,3})$/);
  if (colonMatch) {
    const sId = Number(colonMatch[1]);
    const aNum = Number(colonMatch[2]);
    const targetAyah = index.ayahs.find((a) => a.surahId === sId && a.ayahNum === aNum);
    if (targetAyah) {
      pushUnique({
        kind: 'ayah',
        id: `ayah:${targetAyah.key}`,
        title: `سورة ${targetAyah.surahName} · الآية ${toArabicDigits(targetAyah.ayahNum)}`,
        subtitle: `صفحة ${toArabicDigits(targetAyah.pageNum)} · الجزء ${toArabicDigits(targetAyah.jozz)}`,
        pageNum: targetAyah.pageNum,
        surahId: targetAyah.surahId,
        surahName: targetAyah.surahName,
        ayahNum: targetAyah.ayahNum,
        jozz: targetAyah.jozz,
        snippet: targetAyah.uthmaniText,
        score: 210,
      });
    }
  }

  // 5. Surah name + optional Ayah number: "البقرة 255", "يس 1", "الكهف"
  const trailingNumMatch = asciiQuery.match(/^(.+?)\s+(\d{1,3})$/);
  if (trailingNumMatch) {
    const rawNamePart = normalizeSurahNameForMatch(trailingNumMatch[1]);
    const ayahNumQuery = Number(trailingNumMatch[2]);
    if (rawNamePart.length >= 2) {
      for (const s of surahs) {
        const sNorm = normalizeSurahNameForMatch(s.name);
        if (sNorm === rawNamePart || sNorm.startsWith(rawNamePart) || sNorm.includes(rawNamePart)) {
          const targetAyah = index.ayahs.find(
            (a) => a.surahId === s.id && a.ayahNum === ayahNumQuery
          );
          if (targetAyah) {
            pushUnique({
              kind: 'ayah',
              id: `ayah:${targetAyah.key}`,
              title: `سورة ${targetAyah.surahName} · الآية ${toArabicDigits(targetAyah.ayahNum)}`,
              subtitle: `صفحة ${toArabicDigits(targetAyah.pageNum)} · الجزء ${toArabicDigits(targetAyah.jozz)}`,
              pageNum: targetAyah.pageNum,
              surahId: targetAyah.surahId,
              surahName: targetAyah.surahName,
              ayahNum: targetAyah.ayahNum,
              jozz: targetAyah.jozz,
              snippet: targetAyah.uthmaniText,
              score: sNorm === rawNamePart ? 205 : 185,
            });
          }
        }
      }
    }
  }

  // 6. Surah name jump without ayah number (when query matches a Surah name)
  const normQuerySurah = normalizeSurahNameForMatch(asciiQuery);
  if (normQuerySurah.length >= 2 && !/\d/.test(asciiQuery)) {
    for (const s of surahs) {
      const sNorm = normalizeSurahNameForMatch(s.name);
      if (sNorm === normQuerySurah || sNorm.startsWith(normQuerySurah)) {
        const ayah1 = index.ayahs.find((a) => a.surahId === s.id && a.ayahNum === 1);
        pushUnique({
          kind: 'ayah',
          id: `surah-jump:${s.id}`,
          title: `سورة ${s.name} (${toArabicDigits(s.totalAyat)} آية)`,
          subtitle: `${s.rev} · تبدأ في صفحة ${toArabicDigits(s.startPage)}`,
          pageNum: s.startPage,
          surahId: s.id,
          surahName: s.name,
          ayahNum: 1,
          snippet: ayah1?.uthmaniText,
          score: sNorm === normQuerySurah ? 180 : 145,
        });
      }
    }
  }

  // 7. Full-text Arabic Quran verse search (normalized, diacritic-insensitive)
  const normQuery = normalizeArabicForSearch(asciiQuery, false);
  const expQuery = normalizeArabicForSearch(asciiQuery, true);
  if (normQuery.length >= 2) {
    const queryWords = expQuery.split(' ').filter(Boolean);
    const textMatches: QuranSearchResult[] = [];
    for (const ayah of index.ayahs) {
      if (seenIds.has(`ayah:${ayah.key}`)) continue;

      let score = 0;
      if (ayah.normText.includes(normQuery)) {
        score = 120;
      } else if (ayah.expandedText.includes(expQuery)) {
        score = 110;
      } else if (
        queryWords.length > 1 &&
        queryWords.every((w) => ayah.expandedText.includes(w) || ayah.normText.includes(w))
      ) {
        score = 75;
      }

      if (score > 0) {
        if (ayah.normText.startsWith(normQuery) || ayah.expandedText.startsWith(expQuery)) {
          score += 12;
        }
        // Boost whole-word boundary matches
        if (` ${ayah.expandedText} `.includes(` ${expQuery} `)) {
          score += 18;
        }
        textMatches.push({
          kind: 'ayah',
          id: `ayah:${ayah.key}`,
          title: `سورة ${ayah.surahName} · الآية ${toArabicDigits(ayah.ayahNum)}`,
          subtitle: `صفحة ${toArabicDigits(ayah.pageNum)} · الجزء ${toArabicDigits(ayah.jozz)}`,
          pageNum: ayah.pageNum,
          surahId: ayah.surahId,
          surahName: ayah.surahName,
          ayahNum: ayah.ayahNum,
          jozz: ayah.jozz,
          snippet: ayah.uthmaniText,
          score,
        });
      }
    }
    textMatches.sort((a, b) => b.score - a.score || (a.pageNum - b.pageNum));
    for (const m of textMatches) {
      if (results.length >= limit) break;
      pushUnique(m);
    }
  }

  results.sort((a, b) => b.score - a.score || a.pageNum - b.pageNum);
  return results.slice(0, limit);
}
