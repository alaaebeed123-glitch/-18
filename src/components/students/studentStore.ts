import { useMemo, useSyncExternalStore } from 'react';
import { READING_UNITS } from '../../data/platformCurriculum';
import { TAJWEED_TOPICS, type TajweedTabId } from '../tajweed/tajweedConfig';
import { useSessionReport, type SessionReportData } from '../reports/reportStore';
import { useMushafBookmarks, type MushafBookmark } from './mushafBookmarksStore';

export const STUDENT_PROFILES_STORAGE_KEY = 'safara_student_profiles_v1';

export type StudentLevel = 'foundation' | 'memorization' | 'mastery';

export const STUDENT_LEVEL_LABELS: Record<StudentLevel, string> = {
  foundation: 'تأسيس وقراءة',
  memorization: 'حفظ وتثبيت',
  mastery: 'إتقان وتجويد',
};

export interface StudentTajweedCheckpoint {
  topicId: string;
  tabId: TajweedTabId;
  completedTopicIds: string[];
  updatedAt?: number;
}

export interface StudentReadingCheckpoint {
  unitId: string;
  subTab: string;
  completedUnitIds: string[];
  updatedAt?: number;
}

export interface StudentWhiteboardCheckpoint {
  pageId: string;
  nextAssignment: string;
  updatedAt?: number;
}

export interface StudentProfileRecord {
  id: string;
  name: string;
  level: StudentLevel;
  goal: string;
  notes: string;
  tajweed: StudentTajweedCheckpoint;
  reading: StudentReadingCheckpoint;
  whiteboard: StudentWhiteboardCheckpoint;
  createdAt: number;
  updatedAt: number;
}

export interface StudentDirectoryEntry {
  key: string;
  id: string;
  name: string;
  isSavedProfile: boolean;
  profile: StudentProfileRecord;
  bookmarks: MushafBookmark[];
  reports: SessionReportData[];
  lastActivityAt: number;
}

export function normalizeStudentKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function createStudentId(): string {
  return `stu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_TAJWEED_TOPIC = TAJWEED_TOPICS[0]?.id ?? 'lathawiya';
const DEFAULT_READING_UNIT = READING_UNITS[0]?.id ?? 'letters';
const DEFAULT_READING_SUBTAB = READING_UNITS[0]?.defaultSubTab ?? 'baa';

export function buildDefaultStudentProfile(
  name: string,
  overrides?: Partial<Omit<StudentProfileRecord, 'id' | 'name'>>
): StudentProfileRecord {
  const now = Date.now();
  return {
    id: createStudentId(),
    name: normalizeStudentKey(name),
    level: overrides?.level ?? 'memorization',
    goal: overrides?.goal ?? '',
    notes: overrides?.notes ?? '',
    tajweed: {
      topicId: overrides?.tajweed?.topicId ?? DEFAULT_TAJWEED_TOPIC,
      tabId: overrides?.tajweed?.tabId ?? 'explain',
      completedTopicIds: Array.isArray(overrides?.tajweed?.completedTopicIds)
        ? overrides.tajweed.completedTopicIds
        : [],
      updatedAt: overrides?.tajweed?.updatedAt,
    },
    reading: {
      unitId: overrides?.reading?.unitId ?? DEFAULT_READING_UNIT,
      subTab: overrides?.reading?.subTab ?? DEFAULT_READING_SUBTAB,
      completedUnitIds: Array.isArray(overrides?.reading?.completedUnitIds)
        ? overrides.reading.completedUnitIds
        : [],
      updatedAt: overrides?.reading?.updatedAt,
    },
    whiteboard: {
      pageId: overrides?.whiteboard?.pageId ?? '',
      nextAssignment: overrides?.whiteboard?.nextAssignment ?? '',
      updatedAt: overrides?.whiteboard?.updatedAt,
    },
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

function normalizeRecord(raw: unknown): StudentProfileRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<StudentProfileRecord>;
  const cleanName = typeof obj.name === 'string' ? normalizeStudentKey(obj.name) : '';
  if (!cleanName) return null;

  const validLevels: StudentLevel[] = ['foundation', 'memorization', 'mastery'];
  const level: StudentLevel =
    obj.level && validLevels.includes(obj.level) ? obj.level : 'memorization';

  const validTabIds: TajweedTabId[] = ['explain', 'letters', 'words', 'apply'];
  const tajweedTopicId =
    obj.tajweed?.topicId && TAJWEED_TOPICS.some((t) => t.id === obj.tajweed?.topicId)
      ? obj.tajweed.topicId
      : DEFAULT_TAJWEED_TOPIC;
  const tajweedTabId: TajweedTabId =
    obj.tajweed?.tabId && validTabIds.includes(obj.tajweed.tabId)
      ? obj.tajweed.tabId
      : 'explain';

  const matchedUnit =
    READING_UNITS.find((u) => u.id === obj.reading?.unitId) ?? READING_UNITS[0];
  const readingSubTab =
    typeof obj.reading?.subTab === 'string' && obj.reading.subTab
      ? obj.reading.subTab
      : matchedUnit.defaultSubTab;

  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : createStudentId(),
    name: cleanName,
    level,
    goal: typeof obj.goal === 'string' ? obj.goal : '',
    notes: typeof obj.notes === 'string' ? obj.notes : '',
    tajweed: {
      topicId: tajweedTopicId,
      tabId: tajweedTabId,
      completedTopicIds: Array.isArray(obj.tajweed?.completedTopicIds)
        ? obj.tajweed.completedTopicIds.filter((x): x is string => typeof x === 'string')
        : [],
      updatedAt: typeof obj.tajweed?.updatedAt === 'number' ? obj.tajweed.updatedAt : undefined,
    },
    reading: {
      unitId: matchedUnit.id,
      subTab: readingSubTab,
      completedUnitIds: Array.isArray(obj.reading?.completedUnitIds)
        ? obj.reading.completedUnitIds.filter((x): x is string => typeof x === 'string')
        : [],
      updatedAt: typeof obj.reading?.updatedAt === 'number' ? obj.reading.updatedAt : undefined,
    },
    whiteboard: {
      pageId: typeof obj.whiteboard?.pageId === 'string' ? obj.whiteboard.pageId : '',
      nextAssignment:
        typeof obj.whiteboard?.nextAssignment === 'string' ? obj.whiteboard.nextAssignment : '',
      updatedAt:
        typeof obj.whiteboard?.updatedAt === 'number' ? obj.whiteboard.updatedAt : undefined,
    },
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
  };
}

function readProfilesFromStorage(): StudentProfileRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STUDENT_PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenKeys = new Set<string>();
    const valid: StudentProfileRecord[] = [];
    for (const item of parsed) {
      const normalized = normalizeRecord(item);
      if (normalized && !seenKeys.has(normalized.name)) {
        seenKeys.add(normalized.name);
        valid.push(normalized);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

let cachedProfiles: StudentProfileRecord[] = readProfilesFromStorage();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

function persistProfiles(next: StudentProfileRecord[]): void {
  cachedProfiles = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STUDENT_PROFILES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues
    }
  }
  notifyListeners();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STUDENT_PROFILES_STORAGE_KEY) {
      cachedProfiles = readProfilesFromStorage();
      notifyListeners();
    }
  });
}

export function subscribeStudentProfiles(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getStudentProfilesSnapshot(): StudentProfileRecord[] {
  return cachedProfiles;
}

export function useStudentProfiles(): StudentProfileRecord[] {
  return useSyncExternalStore(
    subscribeStudentProfiles,
    getStudentProfilesSnapshot,
    getStudentProfilesSnapshot
  );
}

export function upsertStudentProfileByName(
  name: string,
  updater: (current: StudentProfileRecord) => Partial<StudentProfileRecord>
): StudentProfileRecord | null {
  const key = normalizeStudentKey(name);
  if (!key) return null;

  const existingIdx = cachedProfiles.findIndex((p) => normalizeStudentKey(p.name) === key);
  const base =
    existingIdx >= 0 ? cachedProfiles[existingIdx] : buildDefaultStudentProfile(key);
  const patch = updater(base);
  const nextName = patch.name ? normalizeStudentKey(patch.name) : base.name;
  const updated: StudentProfileRecord = {
    ...base,
    ...patch,
    name: nextName || base.name,
    updatedAt: Date.now(),
  };

  if (existingIdx >= 0) {
    const nextList = cachedProfiles.slice();
    nextList[existingIdx] = updated;
    persistProfiles(nextList);
  } else {
    persistProfiles([updated, ...cachedProfiles]);
  }
  return updated;
}

export function createStudentProfile(input: {
  name: string;
  level?: StudentLevel;
  goal?: string;
}): StudentProfileRecord | null {
  const cleanName = normalizeStudentKey(input.name);
  if (!cleanName) return null;

  const existing = cachedProfiles.find((p) => normalizeStudentKey(p.name) === cleanName);
  if (existing) {
    return upsertStudentProfileByName(cleanName, () => ({
      level: input.level ?? existing.level,
      goal: input.goal ?? existing.goal,
    }));
  }

  const created = buildDefaultStudentProfile(cleanName, {
    level: input.level ?? 'memorization',
    goal: input.goal ?? '',
  });
  persistProfiles([created, ...cachedProfiles]);
  return created;
}

export function deleteStudentProfileByName(name: string): void {
  const key = normalizeStudentKey(name);
  persistProfiles(cachedProfiles.filter((p) => normalizeStudentKey(p.name) !== key));
}

export function useStudentsDirectory(): StudentDirectoryEntry[] {
  const profiles = useStudentProfiles();
  const bookmarks = useMushafBookmarks();
  const { draft, history } = useSessionReport();

  return useMemo(() => {
    const map = new Map<string, StudentDirectoryEntry>();

    const ensureEntry = (rawName: string, savedProfile?: StudentProfileRecord): StudentDirectoryEntry => {
      const key = normalizeStudentKey(rawName);
      const existing = map.get(key);
      if (existing) {
        if (savedProfile) {
          existing.isSavedProfile = true;
          existing.profile = savedProfile;
          existing.id = savedProfile.id;
          existing.lastActivityAt = Math.max(existing.lastActivityAt, savedProfile.updatedAt);
        }
        return existing;
      }
      const profile = savedProfile ?? buildDefaultStudentProfile(key);
      const entry: StudentDirectoryEntry = {
        key,
        id: profile.id,
        name: key,
        isSavedProfile: Boolean(savedProfile),
        profile,
        bookmarks: [],
        reports: [],
        lastActivityAt: savedProfile ? savedProfile.updatedAt : 0,
      };
      map.set(key, entry);
      return entry;
    };

    for (const profile of profiles) {
      ensureEntry(profile.name, profile);
    }

    for (const bm of bookmarks) {
      const studentName = bm.studentName ? normalizeStudentKey(bm.studentName) : '';
      if (!studentName) continue;
      const entry = ensureEntry(studentName);
      entry.bookmarks.push(bm);
      entry.lastActivityAt = Math.max(entry.lastActivityAt, bm.createdAt || 0);
    }

    const allReports: SessionReportData[] = [draft, ...history];
    const seenReportIds = new Set<string>();
    for (const rep of allReports) {
      if (seenReportIds.has(rep.id)) continue;
      seenReportIds.add(rep.id);
      const studentName = rep.studentName ? normalizeStudentKey(rep.studentName) : '';
      if (!studentName) continue;
      const entry = ensureEntry(studentName);
      entry.reports.push(rep);
      entry.lastActivityAt = Math.max(entry.lastActivityAt, rep.updatedAt || 0);
    }

    return Array.from(map.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [profiles, bookmarks, draft, history]);
}
