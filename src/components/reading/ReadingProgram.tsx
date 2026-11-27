import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAnnotationActions } from '../annotation';
import { getReadingUnitById, resolveActiveReadingTab } from '../../data/platformCurriculum';
import { playTabSwitch } from '../../utils/feedbackEffects';

interface ReadingSubItem {
  id: string;
  label: string;
  active: boolean;
  action: { fn: string; args?: (string | number | boolean)[] };
}

export interface ReadingInitialTarget {
  mainCat: string;
  subTab: string;
  seq: number;
}

interface ReadingProgramProps {
  onNavigateView: (view: 'home' | 'mushaf' | 'tajweed', tajweedTopic?: string) => void;
  initialTarget?: ReadingInitialTarget | null;
}

const INITIAL_SUB_ITEMS: ReadingSubItem[] = [
  { id: 'fatha-p1', label: 'صفحة ١', active: true, action: { fn: 'changeTriPage', args: [1] } },
  { id: 'fatha-p2', label: 'صفحة ٢', active: false, action: { fn: 'changeTriPage', args: [2] } },
  { id: 'fatha-p3', label: 'صفحة ٣', active: false, action: { fn: 'changeTriPage', args: [3] } },
  { id: 'fatha-p4', label: 'صفحة ٤', active: false, action: { fn: 'changeTriPage', args: [4] } },
  { id: 'fatha-p5', label: 'صفحة ٥ (الجُمَل)', active: false, action: { fn: 'changeTriPage', args: [5] } },
];

export const ReadingProgram: React.FC<ReadingProgramProps> = ({
  onNavigateView,
  initialTarget = null,
}) => {
  const { setFallbackSurfaceId } = useAnnotationActions();

  const [readingIframeHeight, setReadingIframeHeight] = useState(860);
  const [readingClassroomMode, setReadingClassroomMode] = useState(false);
  const [readingReady, setReadingReady] = useState(false);
  const [readingSectionKey, setReadingSectionKey] = useState('fatha:words');
  const [readingMainCat, setReadingMainCat] = useState('fatha');
  const [readingSubTab, setReadingSubTab] = useState('words');
  const [readingSubItems, setReadingSubItems] = useState<ReadingSubItem[]>(INITIAL_SUB_ITEMS);

  const readingIframeRef = useRef<HTMLIFrameElement>(null);
  const navigateRef = useRef(onNavigateView);
  navigateRef.current = onNavigateView;
  const appliedTargetSeqRef = useRef(0);
  const initialTargetRef = useRef(initialTarget);
  initialTargetRef.current = initialTarget;

  // Sync annotation surface ID to current Reading section
  useEffect(() => {
    setFallbackSurfaceId(`reading:${readingSectionKey}`);
  }, [readingSectionKey, setFallbackSurfaceId]);

  // Keep body class synced when Reading Classroom Mode takes fullscreen
  useEffect(() => {
    document.body.classList.toggle('is-reading-classroom', readingClassroomMode);
    return () => {
      document.body.classList.remove('is-reading-classroom');
    };
  }, [readingClassroomMode]);

  // Reading program iframe bridge: auto-height, classroom mode, section sync, and cross-program navigation
  useEffect(() => {
    let viewportSyncRaf = 0;
    let vvSyncTimer: number | null = null;
    let lastSentTop = -1;
    let lastSentHeight = -1;

    const flushViewportToIframe = () => {
      viewportSyncRaf = 0;
      const iframeEl = readingIframeRef.current;
      if (!iframeEl || !iframeEl.contentWindow) return;
      const rect = iframeEl.getBoundingClientRect();
      const vvHeight = window.visualViewport?.height || window.innerHeight;
      const visibleTop = Math.round(Math.max(0, -rect.top));
      const visibleBottom = Math.min(vvHeight, rect.bottom);
      const visibleHeight = Math.round(Math.max(320, visibleBottom - Math.max(0, rect.top)));
      if (Math.abs(visibleTop - lastSentTop) < 4 && Math.abs(visibleHeight - lastSentHeight) < 4) {
        return;
      }
      lastSentTop = visibleTop;
      lastSentHeight = visibleHeight;
      iframeEl.contentWindow.postMessage(
        {
          type: 'safara:viewport',
          top: visibleTop,
          height: visibleHeight,
        },
        '*'
      );
    };

    const syncViewportToIframe = () => {
      if (viewportSyncRaf) return;
      viewportSyncRaf = requestAnimationFrame(flushViewportToIframe);
    };

    const scheduleVvViewportSync = () => {
      const vvScale = window.visualViewport?.scale ?? 1;
      if (vvScale > 1.02) {
        if (vvSyncTimer !== null) window.clearTimeout(vvSyncTimer);
        vvSyncTimer = window.setTimeout(() => {
          vvSyncTimer = null;
          syncViewportToIframe();
        }, 140);
      } else {
        syncViewportToIframe();
      }
    };

    const handleReadingMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

      if (data.type === 'safara:ready') {
        setReadingReady(true);
        const pendingTarget = initialTargetRef.current;
        if (pendingTarget && appliedTargetSeqRef.current !== pendingTarget.seq) {
          appliedTargetSeqRef.current = pendingTarget.seq;
          setReadingMainCat(pendingTarget.mainCat);
          setReadingSubTab(pendingTarget.subTab);
          setReadingSectionKey(`${pendingTarget.mainCat}:${pendingTarget.subTab}`);
          readingIframeRef.current?.contentWindow?.postMessage(
            {
              type: 'safara:selectLesson',
              mainCat: pendingTarget.mainCat,
              subTab: pendingTarget.subTab,
            },
            '*'
          );
        } else {
          const mainCat = typeof data.mainCat === 'string' && data.mainCat ? data.mainCat : 'fatha';
          const subTab = typeof data.subTab === 'string' && data.subTab ? data.subTab : 'words';
          setReadingMainCat(mainCat);
          setReadingSubTab(subTab);
          if (typeof data.sectionKey === 'string' && data.sectionKey) {
            setReadingSectionKey(data.sectionKey);
          }
          if (Array.isArray(data.subItems)) {
            setReadingSubItems(data.subItems);
          }
        }
        syncViewportToIframe();
      } else if (data.type === 'safara:readingHeight' && typeof data.height === 'number') {
        const nextHeight = Math.max(580, Math.ceil(data.height));
        setReadingIframeHeight((prev) => (Math.abs(prev - nextHeight) >= 2 ? nextHeight : prev));
        syncViewportToIframe();
      } else if (data.type === 'safara:classroomMode') {
        setReadingClassroomMode(Boolean(data.active));
      } else if (data.type === 'safara:readingSection') {
        const mainCat = typeof data.mainCat === 'string' ? data.mainCat : 'fatha';
        const subTab = typeof data.subTab === 'string' ? data.subTab : 'words';
        const sectionKey =
          typeof data.sectionKey === 'string' && data.sectionKey
            ? data.sectionKey
            : `${mainCat}:${subTab}`;
        setReadingMainCat(mainCat);
        setReadingSubTab(subTab);
        setReadingSectionKey(sectionKey);
        if (Array.isArray(data.subItems)) {
          setReadingSubItems(data.subItems);
        }
      } else if (data.type === 'safara:navigate') {
        if (data.view === 'home') {
          navigateRef.current('home');
        } else if (data.view === 'mushaf') {
          navigateRef.current('mushaf');
        } else if (data.view === 'tajweed') {
          const topic = typeof data.topic === 'string' && data.topic ? data.topic : undefined;
          navigateRef.current('tajweed', topic);
        }
      }
    };

    window.addEventListener('message', handleReadingMessage);
    window.addEventListener('scroll', syncViewportToIframe, { passive: true });
    window.addEventListener('resize', syncViewportToIframe, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleVvViewportSync, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleVvViewportSync, { passive: true });
    syncViewportToIframe();

    return () => {
      if (viewportSyncRaf) cancelAnimationFrame(viewportSyncRaf);
      if (vvSyncTimer !== null) {
        window.clearTimeout(vvSyncTimer);
        vvSyncTimer = null;
      }
      window.removeEventListener('message', handleReadingMessage);
      window.removeEventListener('scroll', syncViewportToIframe);
      window.removeEventListener('resize', syncViewportToIframe);
      window.visualViewport?.removeEventListener('resize', scheduleVvViewportSync);
      window.visualViewport?.removeEventListener('scroll', scheduleVvViewportSync);
    };
  }, []);

  const selectReadingUnitTab = (mainCat: string, subTab: string) => {
    setReadingMainCat(mainCat);
    setReadingSubTab(subTab);
    setReadingSectionKey(`${mainCat}:${subTab}`);
    playTabSwitch();
    readingIframeRef.current?.contentWindow?.postMessage(
      { type: 'safara:selectLesson', mainCat, subTab },
      '*'
    );
  };

  useEffect(() => {
    if (!readingReady || !initialTarget) return;
    if (appliedTargetSeqRef.current === initialTarget.seq) return;
    appliedTargetSeqRef.current = initialTarget.seq;
    setReadingMainCat(initialTarget.mainCat);
    setReadingSubTab(initialTarget.subTab);
    setReadingSectionKey(`${initialTarget.mainCat}:${initialTarget.subTab}`);
    readingIframeRef.current?.contentWindow?.postMessage(
      {
        type: 'safara:selectLesson',
        mainCat: initialTarget.mainCat,
        subTab: initialTarget.subTab,
      },
      '*'
    );
  }, [readingReady, initialTarget]);

  const selectReadingSubItem = (action: { fn: string; args?: (string | number | boolean)[] }) => {
    playTabSwitch();
    readingIframeRef.current?.contentWindow?.postMessage(
      { type: 'safara:selectSubItem', action },
      '*'
    );
  };

  const activeReadingUnit = getReadingUnitById(readingMainCat);
  const activeReadingTabKey = resolveActiveReadingTab(activeReadingUnit, readingSubTab);

  return (
    <>
      {!readingClassroomMode && (
        <div className="unified-hero-pod is-reading-pod" id="reading-hero-pod">
          <section className="lesson-hero-title-area" id="reading-main-heading-area">
            <div className="lesson-title-badge-row">
              <span className="lesson-badge-category">
                <span className="badge-ornament-star">✦</span>
                <span className="badge-text-diacritics">{activeReadingUnit.unitOrder}</span>
                <span className="badge-ornament-star">✦</span>
              </span>
            </div>

            <h1 className="lesson-primary-heading">{activeReadingUnit.title}</h1>

            <div className="lesson-title-deco-line" aria-hidden="true">
              <span className="deco-line-half"></span>
              <span className="deco-rosette">✦</span>
              <span className="deco-line-half deco-line-r"></span>
            </div>
          </section>

          <nav className="tabs" id="reading-unit-tabs" aria-label="دروس الوحدة الحالية">
            {activeReadingUnit.tabs.map((tab) => {
              const isActive = activeReadingTabKey === tab.subTab;
              return (
                <button
                  key={`${activeReadingUnit.id}:${tab.subTab}`}
                  type="button"
                  className={`tab-btn ${isActive ? 'active' : ''}`}
                  onClick={() => selectReadingUnitTab(activeReadingUnit.id, tab.subTab)}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeReadingTabPill"
                      className="active-tab-highlight-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    />
                  )}
                  <span className="tab-num-relative">
                    <span className="tab-num">{tab.num}</span>
                  </span>
                  <span className="tab-label-text">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {readingSubItems.length > 0 && (
            <div
              className="reading-unit-subtabs"
              id="reading-unit-subtabs"
              role="tablist"
              aria-label="صفحات وعناصر القسم الحالي"
            >
              {readingSubItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`reading-subtab-btn ${item.active ? 'active' : ''}`}
                  onClick={() => selectReadingSubItem(item.action)}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <main
        id="reading-program-shell"
        className={`reading-program-shell${readingClassroomMode ? ' is-classroom-mode' : ''}`}
        style={readingClassroomMode ? undefined : { height: `${readingIframeHeight}px` }}
        aria-label="منصة التدريب القرائي المنهجي"
      >
        {!readingReady && (
          <div className="reading-program-loader" role="status" aria-live="polite">
            <div className="reading-loader-card">
              <div className="reading-loader-bar">
                <span className="reading-loader-pill" />
                <span className="reading-loader-label">جاري تجهيز برنامج القراءة...</span>
                <span className="reading-loader-pill is-short" />
              </div>
              <div className="reading-loader-grid">
                {Array.from({ length: 12 }).map((_, idx) => (
                  <div key={idx} className="reading-loader-cell" />
                ))}
              </div>
            </div>
          </div>
        )}
        <iframe
          ref={readingIframeRef}
          src="/reading-program.html"
          title="مَعَ السَّفَرَة — منصة التدريب القرائي المنهجي"
          className={`reading-program-iframe${readingReady ? ' is-ready' : ''}`}
          scrolling={readingClassroomMode ? 'auto' : 'no'}
          allow="fullscreen"
          onLoad={() => {
            window.setTimeout(() => setReadingReady(true), 250);
          }}
        />
        <div className="reading-laser-capture-shield" aria-hidden="true" />
      </main>
    </>
  );
};

export default ReadingProgram;
