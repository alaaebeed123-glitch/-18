import { useSyncExternalStore } from 'react';

export const BOOKMARKS_STORAGE_KEY = 'talakah_mushaf_bookmarks_v1';
const BOOKMARKS_EVENT_NAME = 'talakah:mushaf-bookmarks-changed';
const MAX_BOOKMARKS = 60;

export type MushafBookmarkKind = 'hifz' | 'review' | 'stop';

export const BOOKMARK_KIND_LABELS: Record<MushafBookmarkKind, string> = {
  hifz: 'حفظ',
  review: 'مراجعة',
  stop: 'توقف',
};

export interface MushafBookmark {
  id: string;
  pageNum: number;
  surahName: string;
  surahId?: number;
  ayahNum?: number;
  focusedKeys?: string[];
  label: string;
  studentName?: string;
  kind?: MushafBookmarkKind;
  createdAt: number;
}

function readBookmarksFromStorage(): MushafBookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let cachedBookmarks: MushafBookmark[] = readBookmarksFromStorage();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

function persistBookmarks(next: MushafBookmark[]): void {
  const clamped = next.slice(0, MAX_BOOKMARKS);
  cachedBookmarks = clamped;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(clamped));
      window.dispatchEvent(new CustomEvent(BOOKMARKS_EVENT_NAME));
    } catch {
      // Ignore storage quota issues
    }
  }
  notifyListeners();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === BOOKMARKS_STORAGE_KEY) {
      cachedBookmarks = readBookmarksFromStorage();
      notifyListeners();
    }
  });
}

export function subscribeMushafBookmarks(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getMushafBookmarksSnapshot(): MushafBookmark[] {
  return cachedBookmarks;
}

export function useMushafBookmarks(): MushafBookmark[] {
  return useSyncExternalStore(
    subscribeMushafBookmarks,
    getMushafBookmarksSnapshot,
    getMushafBookmarksSnapshot
  );
}

export function addOrUpdateMushafBookmark(bookmark: MushafBookmark): void {
  const filtered = cachedBookmarks.filter(
    (b) =>
      !(
        b.pageNum === bookmark.pageNum &&
        b.ayahNum === bookmark.ayahNum &&
        (b.studentName || '').trim() === (bookmark.studentName || '').trim() &&
        b.label === bookmark.label
      )
  );
  persistBookmarks([bookmark, ...filtered]);
}

export function setAllMushafBookmarks(
  updater: MushafBookmark[] | ((prev: MushafBookmark[]) => MushafBookmark[])
): void {
  const next = typeof updater === 'function' ? updater(cachedBookmarks) : updater;
  persistBookmarks(next);
}

export function removeMushafBookmark(id: string): void {
  persistBookmarks(cachedBookmarks.filter((b) => b.id !== id));
}
