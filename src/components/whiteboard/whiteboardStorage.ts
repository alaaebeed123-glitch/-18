import { toArabicDigits } from '../../utils/mushafData';
import type { WhiteboardBackground, WhiteboardCard, WhiteboardPage, WhiteboardPersistedState } from './whiteboardTypes';

const WHITEBOARD_STORAGE_KEY = 'safara_whiteboard_pages_v1';

export function createWhiteboardId(prefix = 'wb'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlankWhiteboardPage(
  indexNumber: number,
  background: WhiteboardBackground = 'plain'
): WhiteboardPage {
  return {
    id: createWhiteboardId('page'),
    title: `لوحة ${toArabicDigits(indexNumber)}`,
    background,
    cards: [],
    createdAt: Date.now(),
  };
}

export function loadWhiteboardState(): WhiteboardPersistedState {
  const fallbackPage = createBlankWhiteboardPage(1, 'plain');
  if (typeof window === 'undefined') {
    return { activePageId: fallbackPage.id, pages: [fallbackPage] };
  }

  try {
    const raw = window.localStorage.getItem(WHITEBOARD_STORAGE_KEY);
    if (!raw) {
      return { activePageId: fallbackPage.id, pages: [fallbackPage] };
    }
    const parsed = JSON.parse(raw) as Partial<WhiteboardPersistedState>;
    const pages = Array.isArray(parsed.pages) && parsed.pages.length > 0 ? parsed.pages : [fallbackPage];
    const activeExists = pages.some((p) => p.id === parsed.activePageId);
    return {
      activePageId: activeExists && parsed.activePageId ? parsed.activePageId : pages[0].id,
      pages: pages.map((page, idx) => ({
        id: page.id || createWhiteboardId('page'),
        title: page.title || `لوحة ${toArabicDigits(idx + 1)}`,
        background: page.background || 'plain',
        cards: Array.isArray(page.cards) ? page.cards : [],
        createdAt: typeof page.createdAt === 'number' ? page.createdAt : Date.now(),
      })),
    };
  } catch {
    return { activePageId: fallbackPage.id, pages: [fallbackPage] };
  }
}

export function saveWhiteboardState(state: WhiteboardPersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WHITEBOARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage quota/privacy errors gracefully
  }
}

export function cloneCardWithOffset(card: WhiteboardCard): WhiteboardCard {
  return {
    ...card,
    id: createWhiteboardId('card'),
    xPct: Math.max(4, Math.min(80, card.xPct - 3)),
    yPct: Math.max(4, Math.min(78, card.yPct + 4)),
  };
}
