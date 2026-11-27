import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, ClipboardCheck, GraduationCap, Home, Layers, PenTool, Users } from 'lucide-react';
import { SafaraTypographyLogo } from './components/SafaraTypographyLogo';
import { SilkWaveBackground } from './components/SilkWaveBackground';
import {
  AnnotationProvider,
  AnnotationToolCursor,
  FloatingAnnotationPalette,
  GlobalAnnotationLayer,
  OpticalLaserLayer,
  useAnnotationActions,
} from './components/annotation';
import { HomeGateway } from './components/home/HomeGateway';
import { prefetchReadingProgram } from './components/reading/readingPrefetch';
import type { ReadingInitialTarget } from './components/reading/ReadingProgram';
import { TajweedTopicDropdown } from './components/tajweed/TajweedTopicDropdown';
import type { TajweedTabId } from './components/tajweed/tajweedConfig';
import type { StudentNavigationRequest } from './components/students/StudentsProgram';
import { playTabSwitch } from './utils/feedbackEffects';

const MushafView = lazy(() => import('./components/mushaf/MushafView'));
const TajweedProgram = lazy(() => import('./components/tajweed/TajweedProgram'));
const ReadingProgram = lazy(() => import('./components/reading/ReadingProgram'));
const WhiteboardProgram = lazy(() => import('./components/whiteboard/WhiteboardProgram'));
const ReportsProgram = lazy(() => import('./components/reports/ReportsProgram'));
const StudentsProgram = lazy(() => import('./components/students/StudentsProgram'));

export type AppView =
  | 'home'
  | 'mushaf'
  | 'tajweed'
  | 'reading'
  | 'whiteboard'
  | 'students'
  | 'reports';

const VIEW_PATHS: Record<AppView, string> = {
  home: '/',
  mushaf: '/mushaf',
  tajweed: '/tajweed',
  reading: '/reading',
  whiteboard: '/whiteboard',
  students: '/students',
  reports: '/reports',
};

const PLATFORM_SECTIONS: Array<{
  id: AppView;
  domId: string;
  label: string;
  icon: typeof Home;
}> = [
  { id: 'home', domId: 'nav-home-btn', label: 'الرئيسية', icon: Home },
  { id: 'mushaf', domId: 'nav-mushaf-btn', label: 'المصحف الشريف', icon: BookOpen },
  { id: 'tajweed', domId: 'nav-tajweed-btn', label: 'برنامج التجويد', icon: GraduationCap },
  { id: 'reading', domId: 'nav-reading-btn', label: 'التدريب القرائي', icon: Layers },
  { id: 'whiteboard', domId: 'nav-whiteboard-btn', label: 'السبورة', icon: PenTool },
  { id: 'students', domId: 'nav-students-btn', label: 'ملف الطالب', icon: Users },
  { id: 'reports', domId: 'nav-reports-btn', label: 'تقارير الحصص', icon: ClipboardCheck },
];

function getViewFromPathname(pathname: string): AppView {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/mushaf') return 'mushaf';
  if (normalized === '/tajweed') return 'tajweed';
  if (normalized === '/reading' || normalized === '/noor-bayan') return 'reading';
  if (normalized === '/whiteboard') return 'whiteboard';
  if (normalized === '/students') return 'students';
  if (normalized === '/reports') return 'reports';
  return 'home';
}

const ProgramLoadingFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="wb-lazy-loader" role="status" aria-live="polite">
    {label}
  </div>
);

function AppContent() {
  const { setFallbackSurfaceId, setPaletteOpen, setActiveTool } = useAnnotationActions();

  const [appView, setAppView] = useState<AppView>(() =>
    typeof window !== 'undefined' ? getViewFromPathname(window.location.pathname) : 'home'
  );
  const [currentTopic, setCurrentTopic] = useState('noon_sakinah');
  const [tajweedActiveTab, setTajweedActiveTab] = useState<TajweedTabId>('explain');
  const [readingDeepLink, setReadingDeepLink] = useState<ReadingInitialTarget | null>(null);
  const [mushafPresentationMode, setMushafPresentationMode] = useState(false);

  const autoOpenedPaletteRef = useRef(false);
  const readingTargetSeqRef = useRef(1);

  // Idle-prefetch Reading program assets when on Home screen
  useEffect(() => {
    if (appView !== 'home') return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(prefetchReadingProgram, { timeout: 1800 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(prefetchReadingProgram, 1200);
    return () => window.clearTimeout(timer);
  }, [appView]);

  const navigateView = (
    nextView: AppView,
    tajweedTopic?: string,
    options?: {
      tajweedTab?: TajweedTabId;
      readingTarget?: { mainCat: string; subTab: string };
    }
  ) => {
    if (tajweedTopic) {
      setCurrentTopic(tajweedTopic);
      setTajweedActiveTab(options?.tajweedTab ?? 'explain');
    } else if (options?.tajweedTab) {
      setTajweedActiveTab(options.tajweedTab);
    }
    if (options?.readingTarget) {
      readingTargetSeqRef.current += 1;
      setReadingDeepLink({
        mainCat: options.readingTarget.mainCat,
        subTab: options.readingTarget.subTab,
        seq: readingTargetSeqRef.current,
      });
    }
    if (nextView === appView) return;
    if (nextView !== 'mushaf') {
      setMushafPresentationMode(false);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
    playTabSwitch();
    setAppView(nextView);
    if (typeof window !== 'undefined') {
      const targetPath = VIEW_PATHS[nextView];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ view: nextView }, '', targetPath);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateFromStudent = (req: StudentNavigationRequest) => {
    navigateView(req.view, req.tajweedTopic, {
      tajweedTab: req.tajweedTab,
      readingTarget: req.readingTarget,
    });
  };

  // Handle browser back/forward history
  useEffect(() => {
    function handlePopState() {
      const viewFromUrl = getViewFromPathname(window.location.pathname);
      if (viewFromUrl !== 'mushaf') {
        setMushafPresentationMode(false);
      }
      setAppView(viewFromUrl);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const toggleMushafPresentation = () => {
    setMushafPresentationMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  };

  useEffect(() => {
    if (!mushafPresentationMode) return;
    let enteredNativeFullscreen = !!document.fullscreenElement;
    function onFsChange() {
      if (document.fullscreenElement) {
        enteredNativeFullscreen = true;
      } else if (enteredNativeFullscreen) {
        setMushafPresentationMode(false);
      }
    }
    function onEscPresentation(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMushafPresentationMode(false);
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onEscPresentation);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onEscPresentation);
    };
  }, [mushafPresentationMode]);

  // Sync Home fallback annotation surface & auto-open pen palette on first program entry
  useEffect(() => {
    if (appView === 'home') {
      setFallbackSurfaceId('view:home');
      setActiveTool('cursor');
    } else if (!autoOpenedPaletteRef.current) {
      autoOpenedPaletteRef.current = true;
      setPaletteOpen(true);
    }
  }, [appView, setActiveTool, setFallbackSurfaceId, setPaletteOpen]);

  return (
    <>
      <SilkWaveBackground />
      <div className={`app ${appView === 'mushaf' && mushafPresentationMode ? 'is-mushaf-presentation' : ''}`}>
        {/* Global Academy Header */}
        <header id="main-header" className="main-app-header">
          <div className="header-standalone-logo" id="header-brand-logo">
            <button
              type="button"
              className="header-logo-home-btn"
              onClick={() => navigateView('home')}
              aria-label="العودة إلى الشاشة الرئيسية"
            >
              <SafaraTypographyLogo size="md" showTagline={false} />
            </button>
          </div>

          <div className="header-topic-slot" id="header-topic-menu">
            <nav className="header-nav-actions" aria-label="الأقسام الرئيسية">
              {PLATFORM_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = appView === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    id={section.domId}
                    className={`header-nav-btn ${isActive ? 'is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onMouseEnter={section.id === 'reading' ? prefetchReadingProgram : undefined}
                    onFocus={section.id === 'reading' ? prefetchReadingProgram : undefined}
                    onClick={() => navigateView(section.id)}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="headerActiveNavIndicator"
                        className="header-nav-active-bg"
                        aria-hidden="true"
                        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      />
                    )}
                    <Icon className="header-nav-icon w-4 h-4" strokeWidth={isActive ? 2.3 : 2} aria-hidden="true" />
                    <span className="header-nav-label">{section.label}</span>
                  </button>
                );
              })}
            </nav>

            {appView === 'tajweed' && (
              <>
                <span className="header-slot-divider" aria-hidden="true" />
                <TajweedTopicDropdown
                  currentTopic={currentTopic}
                  onSelectTopic={(topicId) => {
                    setCurrentTopic(topicId);
                    setTajweedActiveTab('explain');
                  }}
                />
              </>
            )}
          </div>
        </header>

        {/* Active Academy Program Router (each program isolated in its own lazy module) */}
        {appView === 'home' && <HomeGateway onNavigate={(view) => navigateView(view)} />}

        {appView === 'mushaf' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل المصحف الشريف..." />}>
            <MushafView
              isPresentationMode={mushafPresentationMode}
              onTogglePresentationMode={toggleMushafPresentation}
              onOpenReports={() => navigateView('reports')}
            />
          </Suspense>
        )}

        {appView === 'tajweed' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل برنامج التجويد..." />}>
            <TajweedProgram
              currentTopic={currentTopic}
              activeTab={tajweedActiveTab}
              onTabChange={setTajweedActiveTab}
            />
          </Suspense>
        )}

        {appView === 'reading' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل التدريب القرائي..." />}>
            <ReadingProgram
              onNavigateView={navigateView}
              initialTarget={readingDeepLink}
            />
          </Suspense>
        )}

        {appView === 'whiteboard' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل السبورة التفاعلية..." />}>
            <WhiteboardProgram />
          </Suspense>
        )}

        {appView === 'students' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل ملفات الطلاب..." />}>
            <StudentsProgram onNavigateProgram={handleNavigateFromStudent} />
          </Suspense>
        )}

        {appView === 'reports' && (
          <Suspense fallback={<ProgramLoadingFallback label="جارٍ تحميل تقارير الحصص..." />}>
            <ReportsProgram onOpenMushaf={() => navigateView('mushaf')} />
          </Suspense>
        )}

        {/* Global Footer */}
        <footer id="main-footer">
          <div className="footer-content">
            <span>منصة مَعَ السَّفَرَة — تعليم قراءة العربية والقرآن والتجويد</span>
            {appView === 'tajweed' && (
              <div className="footer-keys-hint" title="يمكنك التنقل بين المراحل بالأسهم">
                <span className="key-badge">←</span>
                <span className="key-badge">→</span>
                <span>للتنقل السريع بين المراحل</span>
              </div>
            )}
          </div>
        </footer>

        <GlobalAnnotationLayer />
      </div>

      <OpticalLaserLayer />
      <AnnotationToolCursor />
      <FloatingAnnotationPalette />
    </>
  );
}

export default function App() {
  return (
    <AnnotationProvider defaultOpen={false}>
      <AppContent />
    </AnnotationProvider>
  );
}
