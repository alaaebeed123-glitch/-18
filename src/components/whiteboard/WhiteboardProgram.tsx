import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer,
  PenTool,
  Plus,
  Redo2,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { AnnotationSurface, useAnnotation } from '../annotation';
import { toArabicDigits } from '../../utils/mushafData';
import {
  cloneCardWithOffset,
  createBlankWhiteboardPage,
  createWhiteboardId,
  loadWhiteboardState,
  saveWhiteboardState,
} from './whiteboardStorage';
import {
  WHITEBOARD_BACKGROUNDS,
  WHITEBOARD_QUICK_SYMBOLS,
  WHITEBOARD_TEMPLATES,
  type WhiteboardBackground,
  type WhiteboardCard,
  type WhiteboardCardVariant,
  type WhiteboardPage,
  type WhiteboardPersistedState,
} from './whiteboardTypes';

export interface WhiteboardProgramProps {
  onPlayChime?: (success?: boolean) => void;
}

const CARD_VARIANT_LABELS: Array<{ id: WhiteboardCardVariant; label: string }> = [
  { id: 'note', label: 'بطاقة' },
  { id: 'ayah', label: 'آية' },
  { id: 'heading', label: 'عنوان' },
  { id: 'transparent', label: 'نص حر' },
];

export const WhiteboardProgram: React.FC<WhiteboardProgramProps> = ({ onPlayChime }) => {
  const {
    activeTool,
    setActiveTool,
    isPaletteOpen,
    setPaletteOpen,
    undo,
    redo,
    canUndo,
    canRedo,
    clearSurface,
    registerWhiteboardExportProvider,
    exportCurrentSurface,
    exportWhiteboardPages,
    isExportingPdf,
    exportProgress,
    activeStrokeCount,
    setFallbackSurfaceId,
  } = useAnnotation();

  const [wbState, setWbState] = useState<WhiteboardPersistedState>(() => loadWhiteboardState());
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportIncludeAnnotations, setExportIncludeAnnotations] = useState(true);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const templatesMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportPageWaitersRef = useRef<Map<string, Array<() => void>>>(new Map());
  const dragSessionRef = useRef<{
    cardId: string;
    startClientX: number;
    startClientY: number;
    origXPct: number;
    origYPct: number;
    boardWidth: number;
    boardHeight: number;
  } | null>(null);

  const activePageIndex = useMemo(() => {
    const idx = wbState.pages.findIndex((p) => p.id === wbState.activePageId);
    return idx >= 0 ? idx : 0;
  }, [wbState.pages, wbState.activePageId]);

  const activePage: WhiteboardPage = wbState.pages[activePageIndex] || wbState.pages[0];
  const activeSurfaceId = `whiteboard:page:${activePage.id}`;
  const isDrawingMode = activeTool !== 'cursor';
  const isDarkBoard = activePage.background === 'chalkboard';

  // Persist whiteboard pages & cards
  useEffect(() => {
    saveWhiteboardState(wbState);
  }, [wbState]);

  const initialToolSyncedRef = useRef(false);

  // Default to Pen tool & open the PencilKit dock when entering Whiteboard
  useEffect(() => {
    setFallbackSurfaceId('view:whiteboard');
    if (initialToolSyncedRef.current) return;
    initialToolSyncedRef.current = true;
    setPaletteOpen(true);
    if (activeTool === 'cursor') {
      setActiveTool('pen');
    }
  }, [activeTool, setActiveTool, setFallbackSurfaceId, setPaletteOpen]);

  // Close templates & export menus on outside click & handle Escape for fullscreen
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (templatesMenuRef.current && !templatesMenuRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTemplatesOpen(false);
        setExportMenuOpen(false);
        setConfirmClearOpen(false);
        if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // Sync body class when whiteboard fullscreen classroom mode is active
  useEffect(() => {
    document.body.classList.toggle('is-whiteboard-fullscreen', isFullscreen);
    return () => {
      document.body.classList.remove('is-whiteboard-fullscreen');
    };
  }, [isFullscreen]);

  const activePageIdRef = useRef(activePage.id);
  activePageIdRef.current = activePage.id;

  useEffect(() => {
    const waiters = exportPageWaitersRef.current.get(activePage.id);
    if (!waiters || waiters.length === 0) return;
    let raf1 = 0;
    let raf2 = 0;
    let cancelled = false;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const pending = exportPageWaitersRef.current.get(activePage.id);
        if (!pending || pending.length === 0) return;
        exportPageWaitersRef.current.delete(activePage.id);
        for (const fn of pending) fn();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [activePage.id]);

  const navigateToPageForExport = useCallback(async (targetPageId: string) => {
    if (activePageIdRef.current === targetPageId) {
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
      const existing = exportPageWaitersRef.current.get(targetPageId) ?? [];
      existing.push(finish);
      exportPageWaitersRef.current.set(targetPageId, existing);
      setSelectedCardId(null);
      setEditingCardId(null);
      setWbState((prev) => ({ ...prev, activePageId: targetPageId }));
      fallbackTimer = window.setTimeout(finish, 900);
    });
  }, []);

  const restorePageAfterExport = useCallback((originalPageId: string) => {
    setWbState((prev) => ({ ...prev, activePageId: originalPageId }));
  }, []);

  useEffect(() => {
    registerWhiteboardExportProvider({
      activePageId: activePage.id,
      activePageTitle: activePage.title || `لوحة ${toArabicDigits(activePageIndex + 1)}`,
      pages: wbState.pages.map((p, idx) => ({
        id: p.id,
        title: p.title || `لوحة ${toArabicDigits(idx + 1)}`,
        index: idx + 1,
      })),
      navigateToPageForExport,
      restorePageAfterExport,
    });
  }, [
    registerWhiteboardExportProvider,
    activePage.id,
    activePage.title,
    activePageIndex,
    wbState.pages,
    navigateToPageForExport,
    restorePageAfterExport,
  ]);

  useEffect(() => {
    return () => {
      registerWhiteboardExportProvider(null);
    };
  }, [registerWhiteboardExportProvider]);

  const updateActivePage = useCallback((updater: (page: WhiteboardPage) => WhiteboardPage) => {
    setWbState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => (p.id === prev.activePageId ? updater(p) : p)),
    }));
  }, []);

  const handleSelectPage = (pageId: string) => {
    setSelectedCardId(null);
    setEditingCardId(null);
    setConfirmClearOpen(false);
    setWbState((prev) => ({ ...prev, activePageId: pageId }));
    onPlayChime?.(true);
  };

  const handleAddPage = () => {
    setSelectedCardId(null);
    setEditingCardId(null);
    setConfirmClearOpen(false);
    setWbState((prev) => {
      const nextPage = createBlankWhiteboardPage(prev.pages.length + 1, activePage.background);
      return {
        activePageId: nextPage.id,
        pages: [...prev.pages, nextPage],
      };
    });
    onPlayChime?.(true);
  };

  const handleDeleteCurrentPage = () => {
    if (wbState.pages.length <= 1) {
      clearSurface(activeSurfaceId);
      updateActivePage((p) => ({ ...p, cards: [] }));
      setConfirmClearOpen(false);
      return;
    }
    clearSurface(activeSurfaceId);
    setSelectedCardId(null);
    setEditingCardId(null);
    setConfirmClearOpen(false);
    setWbState((prev) => {
      const remaining = prev.pages.filter((p) => p.id !== prev.activePageId);
      const nextIdx = Math.min(activePageIndex, remaining.length - 1);
      return {
        activePageId: remaining[nextIdx].id,
        pages: remaining,
      };
    });
  };

  const handleChangeBackground = (bg: WhiteboardBackground) => {
    updateActivePage((p) => ({ ...p, background: bg }));
  };

  const handleAddCard = (variant: WhiteboardCardVariant, initialText?: string) => {
    const offset = (activePage.cards.length % 4) * 4;
    const newCard: WhiteboardCard = {
      id: createWhiteboardId('card'),
      text:
        initialText ??
        (variant === 'ayah'
          ? '﴿ وَقُل رَّبِّ زِدْنِي عِلْمًا ﴾'
          : variant === 'heading'
            ? 'عنوان الدرس'
            : variant === 'transparent'
              ? 'اكتب هنا...'
              : 'ملاحظة أو مثال تعليمي'),
      xPct: Math.max(8, 28 - offset),
      yPct: Math.min(72, 14 + offset * 2),
      widthPct: variant === 'heading' || variant === 'ayah' ? 56 : 36,
      fontSizePx: variant === 'ayah' ? 28 : variant === 'heading' ? 24 : 20,
      variant,
      align: variant === 'ayah' || variant === 'heading' ? 'center' : 'right',
    };

    // Switch to cursor so teacher can immediately type/move the new card
    setActiveTool('cursor');
    updateActivePage((p) => ({ ...p, cards: [...p.cards, newCard] }));
    setSelectedCardId(newCard.id);
    setEditingCardId(newCard.id);
    setTemplatesOpen(false);
    onPlayChime?.(true);
  };

  const handleApplyTemplate = (templateId: string) => {
    const tpl = WHITEBOARD_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const newCards: WhiteboardCard[] = tpl.cards.map((c) => ({
      ...c,
      id: createWhiteboardId('card'),
    }));
    setActiveTool('cursor');
    updateActivePage((p) => ({ ...p, cards: [...p.cards, ...newCards] }));
    if (newCards[0]) {
      setSelectedCardId(newCards[0].id);
    }
    setTemplatesOpen(false);
    onPlayChime?.(true);
  };

  const updateCard = useCallback(
    (cardId: string, updater: (card: WhiteboardCard) => WhiteboardCard) => {
      updateActivePage((p) => ({
        ...p,
        cards: p.cards.map((c) => (c.id === cardId ? updater(c) : c)),
      }));
    },
    [updateActivePage]
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      updateActivePage((p) => ({
        ...p,
        cards: p.cards.filter((c) => c.id !== cardId),
      }));
      if (selectedCardId === cardId) setSelectedCardId(null);
      if (editingCardId === cardId) setEditingCardId(null);
    },
    [editingCardId, selectedCardId, updateActivePage]
  );

  const handleCardDragStart = (e: React.PointerEvent, card: WhiteboardCard) => {
    if (isDrawingMode) return;
    e.preventDefault();
    e.stopPropagation();
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    setSelectedCardId(card.id);
    setEditingCardId(null);
    dragSessionRef.current = {
      cardId: card.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXPct: card.xPct,
      origYPct: card.yPct,
      boardWidth: Math.max(rect.width, 320),
      boardHeight: Math.max(rect.height, 320),
    };
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;
      const dxPct = ((e.clientX - session.startClientX) / session.boardWidth) * 100;
      const dyPct = ((e.clientY - session.startClientY) / session.boardHeight) * 100;
      const nextX = Math.max(1, Math.min(86, session.origXPct + dxPct));
      const nextY = Math.max(1, Math.min(86, session.origYPct + dyPct));
      updateCard(session.cardId, (c) => ({ ...c, xPct: nextX, yPct: nextY }));
    };
    const handlePointerUp = () => {
      dragSessionRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [updateCard]);

  const handleInsertSymbol = (symbol: string) => {
    if (!selectedCardId) return;
    updateCard(selectedCardId, (c) => ({ ...c, text: `${c.text}${symbol}` }));
  };

  const selectedCard = useMemo(
    () => activePage.cards.find((c) => c.id === selectedCardId) ?? null,
    [activePage.cards, selectedCardId]
  );

  const handleClearBoard = () => {
    clearSurface(activeSurfaceId);
    updateActivePage((p) => ({ ...p, cards: [] }));
    setSelectedCardId(null);
    setEditingCardId(null);
    setConfirmClearOpen(false);
  };

  return (
    <>
      {!isFullscreen && (
        <div className="unified-hero-pod" id="whiteboard-hero-pod">
          <section className="lesson-hero-title-area" id="whiteboard-main-heading-area">
            <div className="lesson-title-badge-row">
              <span className="lesson-badge-category">
                <span className="badge-ornament-star">✦</span>
                <span className="badge-text-diacritics">مساحة الشرح المباشر</span>
                <span className="badge-ornament-star">✦</span>
              </span>
            </div>

            <h1 className="lesson-primary-heading">السبورة التفاعلية</h1>

            <div className="lesson-title-deco-line" aria-hidden="true">
              <span className="deco-line-half"></span>
              <span className="deco-rosette">✦</span>
              <span className="deco-line-half deco-line-r"></span>
            </div>
          </section>
        </div>
      )}

      <main id="whiteboard-standalone-shell" aria-label="السبورة التفاعلية">
        <div
          className={`wb-shell ${isFullscreen ? 'is-fullscreen' : ''}`}
      dir="rtl"
      data-board-theme={activePage.background}
    >
      {/* Top Whiteboard Control Toolbar */}
      <div className="wb-toolbar" role="toolbar" aria-label="أدوات السبورة التفاعلية">
        {/* Right Group: Page Controls & Title */}
        <div className="wb-toolbar-group">
          <div className="wb-page-nav">
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() => {
                if (activePageIndex > 0) {
                  handleSelectPage(wbState.pages[activePageIndex - 1].id);
                }
              }}
              disabled={activePageIndex === 0}
              title="اللوحة السابقة"
              aria-label="اللوحة السابقة"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="wb-page-counter" title="رقم اللوحة الحالية">
              {toArabicDigits(activePageIndex + 1)} / {toArabicDigits(wbState.pages.length)}
            </span>
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() => {
                if (activePageIndex < wbState.pages.length - 1) {
                  handleSelectPage(wbState.pages[activePageIndex + 1].id);
                }
              }}
              disabled={activePageIndex >= wbState.pages.length - 1}
              title="اللوحة التالية"
              aria-label="اللوحة التالية"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            className="wb-page-title-input"
            value={activePage.title}
            aria-label="عنوان اللوحة"
            onChange={(e) => updateActivePage((p) => ({ ...p, title: e.target.value }))}
            maxLength={40}
          />

          <button
            type="button"
            className="wb-action-btn is-primary"
            onClick={handleAddPage}
            title="إضافة لوحة جديدة فارغة"
          >
            <Plus className="w-4 h-4" />
            <span>لوحة جديدة</span>
          </button>

          {wbState.pages.length > 1 && (
            <button
              type="button"
              className="wb-icon-btn is-danger"
              onClick={handleDeleteCurrentPage}
              title="حذف هذه اللوحة"
              aria-label="حذف هذه اللوحة"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Center Group: Pen vs Cursor Mode + Insert Cards/Templates */}
        <div className="wb-toolbar-group">
          <div className="wb-mode-switch" role="group" aria-label="وضع التفاعل">
            <button
              type="button"
              className={`wb-mode-btn ${!isDrawingMode ? 'is-active' : ''}`}
              onClick={() => setActiveTool('cursor')}
              title="تحريك وكتابة البطاقات النصية"
            >
              <MousePointer className="w-4 h-4" />
              <span>كتابة وتحريك</span>
            </button>
            <button
              type="button"
              className={`wb-mode-btn ${isDrawingMode ? 'is-active' : ''}`}
              onClick={() => {
                setPaletteOpen(true);
                if (!isDrawingMode) setActiveTool('pen');
              }}
              title="الكتابة والرسم الحر بالقلم"
            >
              <PenTool className="w-4 h-4" />
              <span>قلم السبورة</span>
            </button>
          </div>

          <button
            type="button"
            className={`wb-action-btn ${isPaletteOpen ? 'is-active-soft' : ''}`}
            onClick={() => setPaletteOpen(!isPaletteOpen)}
            title="إظهار أو إخفاء شريط أدوات القلم والتظليل والليزر"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">أدوات القلم</span>
          </button>

          <button
            type="button"
            className="wb-action-btn"
            onClick={() => handleAddCard('note')}
            title="إضافة بطاقة نص أو مثال"
          >
            <StickyNote className="w-4 h-4" />
            <span>+ بطاقة</span>
          </button>

          <button
            type="button"
            className="wb-action-btn"
            onClick={() => handleAddCard('ayah')}
            title="إضافة بطاقة آية قرآنية"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden md:inline">+ آية</span>
          </button>

          <div className="relative" ref={templatesMenuRef}>
            <button
              type="button"
              className="wb-action-btn"
              onClick={() => setTemplatesOpen((prev) => !prev)}
              aria-expanded={templatesOpen}
              title="قوالب جاهزة للدروس الشرعية"
            >
              <LayoutTemplate className="w-4 h-4" />
              <span className="hidden lg:inline">قوالب</span>
            </button>
            {templatesOpen && (
              <div className="wb-dropdown-menu" role="menu">
                <div className="wb-dropdown-header">إدراج قالب درس جاهز</div>
                {WHITEBOARD_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="menuitem"
                    className="wb-dropdown-item"
                    onClick={() => handleApplyTemplate(tpl.id)}
                  >
                    <Type className="w-4 h-4 shrink-0" />
                    <span>{tpl.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Left Group: Backgrounds, Undo/Redo, Clear, Export, Fullscreen */}
        <div className="wb-toolbar-group">
          <div className="wb-bg-picker" role="group" aria-label="خلفية السبورة">
            {WHITEBOARD_BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                type="button"
                className={`wb-bg-swatch ${bg.previewClass} ${
                  activePage.background === bg.id ? 'is-selected' : ''
                }`}
                onClick={() => handleChangeBackground(bg.id)}
                title={`خلفية: ${bg.label}`}
                aria-label={`خلفية ${bg.label}`}
                aria-pressed={activePage.background === bg.id}
              />
            ))}
          </div>

          <div className="wb-mini-actions">
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() => undo(activeSurfaceId)}
              disabled={!canUndo}
              title="تراجع"
              aria-label="تراجع"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() => redo(activeSurfaceId)}
              disabled={!canRedo}
              title="إعادة"
              aria-label="إعادة"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                className="wb-icon-btn is-danger"
                onClick={() => setConfirmClearOpen((p) => !p)}
                disabled={activeStrokeCount === 0 && activePage.cards.length === 0}
                title="مسح محتوى اللوحة"
                aria-label="مسح محتوى اللوحة"
              >
                <Eraser className="w-4 h-4" />
              </button>
              {confirmClearOpen && (
                <div className="wb-confirm-popover" role="dialog" aria-label="تأكيد مسح اللوحة">
                  <p className="wb-confirm-text">مسح جميع الرسومات والبطاقات في هذه اللوحة؟</p>
                  <div className="wb-confirm-actions">
                    <button
                      type="button"
                      className="wb-confirm-yes"
                      onClick={handleClearBoard}
                    >
                      نعم، امسح
                    </button>
                    <button
                      type="button"
                      className="wb-confirm-no"
                      onClick={() => setConfirmClearOpen(false)}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                className={`wb-icon-btn ${exportMenuOpen ? 'is-active' : ''}`}
                onClick={() => setExportMenuOpen((prev) => !prev)}
                disabled={isExportingPdf}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                title={
                  isExportingPdf && exportProgress
                    ? `جارٍ التصدير (${toArabicDigits(exportProgress.current)}/${toArabicDigits(exportProgress.total)})`
                    : 'تصدير وتنزيل السبورة'
                }
                aria-label="تصدير وتنزيل السبورة"
              >
                {isExportingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </button>
              {exportMenuOpen && (
                <div className="wb-dropdown-menu wb-export-menu" role="menu" aria-label="خيارات تنزيل السبورة">
                  <div className="wb-dropdown-header">تصدير السبورة</div>
                  <button
                    type="button"
                    role="menuitem"
                    className="wb-dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exportCurrentSurface({
                        surfaceId: activeSurfaceId,
                        format: 'pdf',
                        includeAnnotations: exportIncludeAnnotations,
                      });
                    }}
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    <span>اللوحة الحالية (PDF)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="wb-dropdown-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exportCurrentSurface({
                        surfaceId: activeSurfaceId,
                        format: 'png',
                        includeAnnotations: exportIncludeAnnotations,
                      });
                    }}
                  >
                    <ImageIcon className="w-4 h-4 shrink-0" />
                    <span>اللوحة الحالية (صورة PNG)</span>
                  </button>
                  {wbState.pages.length > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="wb-dropdown-item"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void exportWhiteboardPages({
                          pageIds: wbState.pages.map((p) => p.id),
                          format: 'pdf',
                          includeAnnotations: exportIncludeAnnotations,
                        });
                      }}
                    >
                      <Layers className="w-4 h-4 shrink-0" />
                      <span>كل اللوحات ({toArabicDigits(wbState.pages.length)}) في PDF</span>
                    </button>
                  )}
                  <label className="wb-export-toggle-row">
                    <input
                      type="checkbox"
                      checked={exportIncludeAnnotations}
                      onChange={(e) => setExportIncludeAnnotations(e.target.checked)}
                    />
                    <span>تضمين الكتابة والتظليل</span>
                  </label>
                </div>
              )}
            </div>

            <button
              type="button"
              className="wb-action-btn"
              onClick={() => setIsFullscreen((prev) => !prev)}
              title={isFullscreen ? 'الخروج من ملء الشاشة (Esc)' : 'تكبير السبورة لملء الشاشة'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              <span className="hidden xl:inline">{isFullscreen ? 'تصغير' : 'ملء الشاشة'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Card Formatting Bar when a card is selected in Cursor Mode */}
      {selectedCard && !isDrawingMode && (
        <div className="wb-card-inspector" role="toolbar" aria-label="تنسيق البطاقة المحددة">
          <div className="wb-inspector-section">
            {CARD_VARIANT_LABELS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`wb-chip-btn ${selectedCard.variant === v.id ? 'is-active' : ''}`}
                onClick={() => updateCard(selectedCard.id, (c) => ({ ...c, variant: v.id }))}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="wb-inspector-section">
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() =>
                updateCard(selectedCard.id, (c) => ({
                  ...c,
                  fontSizePx: Math.max(14, c.fontSizePx - 2),
                }))
              }
              title="تصغير الخط"
              aria-label="تصغير الخط"
            >
              <span className="text-xs font-extrabold">A-</span>
            </button>
            <span className="wb-font-readout">{toArabicDigits(selectedCard.fontSizePx)}</span>
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() =>
                updateCard(selectedCard.id, (c) => ({
                  ...c,
                  fontSizePx: Math.min(54, c.fontSizePx + 2),
                }))
              }
              title="تكبير الخط"
              aria-label="تكبير الخط"
            >
              <span className="text-xs font-extrabold">A+</span>
            </button>

            <button
              type="button"
              className={`wb-icon-btn ${selectedCard.align === 'right' ? 'is-active' : ''}`}
              onClick={() => updateCard(selectedCard.id, (c) => ({ ...c, align: 'right' }))}
              title="محاذاة لليمين"
              aria-label="محاذاة لليمين"
            >
              <AlignRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              className={`wb-icon-btn ${selectedCard.align === 'center' ? 'is-active' : ''}`}
              onClick={() => updateCard(selectedCard.id, (c) => ({ ...c, align: 'center' }))}
              title="توسيط"
              aria-label="توسيط"
            >
              <AlignCenter className="w-4 h-4" />
            </button>
          </div>

          <div className="wb-inspector-section">
            {WHITEBOARD_QUICK_SYMBOLS.map((sym) => (
              <button
                key={sym.label}
                type="button"
                className="wb-symbol-btn"
                onClick={() => handleInsertSymbol(sym.insert)}
                title={sym.title}
              >
                {sym.label}
              </button>
            ))}
          </div>

          <div className="wb-inspector-section">
            <button
              type="button"
              className="wb-icon-btn"
              onClick={() => {
                const cloned = cloneCardWithOffset(selectedCard);
                updateActivePage((p) => ({ ...p, cards: [...p.cards, cloned] }));
                setSelectedCardId(cloned.id);
              }}
              title="تكرار البطاقة"
              aria-label="تكرار البطاقة"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="wb-icon-btn is-danger"
              onClick={() => deleteCard(selectedCard.id)}
              title="حذف البطاقة"
              aria-label="حذف البطاقة"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Board Stage + Bounded PencilKit AnnotationSurface */}
      <div
        ref={stageRef}
        className={`wb-stage wb-bg-${activePage.background}`}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isDrawingMode) {
            setSelectedCardId(null);
            setEditingCardId(null);
          }
        }}
      >
        {/* Subtle Empty State Hint */}
        {activePage.cards.length === 0 && activeStrokeCount === 0 && (
          <div className={`wb-empty-hint ${isDarkBoard ? 'is-dark' : ''}`} aria-hidden="true">
            <PenTool className="w-7 h-7 opacity-40" />
            <p className="wb-empty-title">سبورة الشرح التفاعلية جاهزة</p>
            <p className="wb-empty-sub">
              اكتب مباشرةً بالقلم، أو أضف بطاقة نص أو آية قرآنية من الشريط بالأعلى
            </p>
          </div>
        )}

        {/* Draggable / Editable Text & Verse Cards */}
        {activePage.cards.map((card) => {
          const isSelected = selectedCardId === card.id && !isDrawingMode;
          const isEditing = editingCardId === card.id && !isDrawingMode;
          return (
            <div
              key={card.id}
              className={`wb-card is-variant-${card.variant} ${isSelected ? 'is-selected' : ''} ${
                isDrawingMode ? 'is-draw-passthrough' : ''
              } ${isDarkBoard ? 'is-on-dark-board' : ''}`}
              style={{
                left: `${card.xPct}%`,
                top: `${card.yPct}%`,
                width: `${card.widthPct}%`,
              }}
              onClick={(e) => {
                if (isDrawingMode) return;
                e.stopPropagation();
                setSelectedCardId(card.id);
              }}
              onDoubleClick={(e) => {
                if (isDrawingMode) return;
                e.stopPropagation();
                setSelectedCardId(card.id);
                setEditingCardId(card.id);
              }}
            >
              {!isDrawingMode && (
                <div
                  className="wb-card-drag-bar"
                  onPointerDown={(e) => handleCardDragStart(e, card)}
                  title="اسحب لتحريك البطاقة"
                >
                  <GripVertical className="w-3.5 h-3.5 opacity-60" />
                  <span className="wb-card-drag-label">
                    {isEditing ? 'جارٍ التعديل' : 'اسحب للتحريك · انقر مرتين للتعديل'}
                  </span>
                </div>
              )}

              {isEditing ? (
                <textarea
                  autoFocus
                  className={`wb-card-textarea text-${card.align}`}
                  style={{ '--wb-card-fs-num': String(card.fontSizePx) } as React.CSSProperties}
                  value={card.text}
                  rows={Math.max(2, card.text.split('\n').length)}
                  onChange={(e) =>
                    updateCard(card.id, (c) => ({ ...c, text: e.target.value }))
                  }
                  onBlur={() => setEditingCardId(null)}
                />
              ) : (
                <div
                  className={`wb-card-body text-${card.align}`}
                  style={{ '--wb-card-fs-num': String(card.fontSizePx) } as React.CSSProperties}
                >
                  {card.text}
                </div>
              )}
            </div>
          );
        })}

        {/* Bounded PencilKit High-DPI Drawing Surface */}
        <AnnotationSurface
          surfaceId={activeSurfaceId}
          ariaLabel={`طبقة الرسم والكتابة على ${activePage.title}`}
        />
      </div>

      {/* Quick Page Strip Footer */}
      {wbState.pages.length > 1 && (
        <div className="wb-pages-strip" role="tablist" aria-label="صفحات السبورة">
          {wbState.pages.map((page, idx) => (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={page.id === activePage.id}
              className={`wb-page-pill ${page.id === activePage.id ? 'is-active' : ''}`}
              onClick={() => handleSelectPage(page.id)}
            >
              <span>{page.title || `لوحة ${toArabicDigits(idx + 1)}`}</span>
            </button>
          ))}
        </div>
      )}
        </div>
      </main>
    </>
  );
};

export default WhiteboardProgram;
