import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpLeft,
  BookMarked,
  BookOpen,
  Check,
  ClipboardCheck,
  Edit3,
  FilePlus2,
  GraduationCap,
  Layers,
  PenTool,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { READING_UNITS } from '../../data/platformCurriculum';
import { INITIAL_MUSHAF_SURAHS, toArabicDigits } from '../../utils/mushafData';
import { useAnnotationActions } from '../annotation';
import {
  archiveAndStartNewReport,
  loadReportFromHistory,
  RATING_LABELS,
  requestJumpToMushafAyah,
  updateReportDraft,
  useSessionReport,
} from '../reports/reportStore';
import { TAJWEED_TABS_CONFIG, TAJWEED_TOPICS, type TajweedTabId } from '../tajweed/tajweedConfig';
import { loadWhiteboardState, saveWhiteboardState } from '../whiteboard/whiteboardStorage';
import {
  addOrUpdateMushafBookmark,
  BOOKMARK_KIND_LABELS,
  removeMushafBookmark,
  setAllMushafBookmarks,
  useMushafBookmarks,
  type MushafBookmark,
  type MushafBookmarkKind,
} from './mushafBookmarksStore';
import {
  createStudentProfile,
  deleteStudentProfileByName,
  normalizeStudentKey,
  STUDENT_LEVEL_LABELS,
  upsertStudentProfileByName,
  useStudentsDirectory,
  type StudentLevel,
} from './studentStore';

export interface StudentNavigationRequest {
  view: 'mushaf' | 'tajweed' | 'reading' | 'whiteboard' | 'reports';
  tajweedTopic?: string;
  tajweedTab?: TajweedTabId;
  readingTarget?: { mainCat: string; subTab: string };
}

interface StudentsProgramProps {
  onNavigateProgram: (req: StudentNavigationRequest) => void;
}

const LEVEL_OPTIONS: StudentLevel[] = ['foundation', 'memorization', 'mastery'];
const BOOKMARK_KINDS: MushafBookmarkKind[] = ['hifz', 'review', 'stop'];

function formatArabicDateShort(timestamp: number): string {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatIsoReportDate(isoDate: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return toArabicDigits(isoDate);
  const [y, m, d] = parts;
  return `${toArabicDigits(d)} / ${toArabicDigits(m)} / ${toArabicDigits(y)}`;
}

export const StudentsProgram: React.FC<StudentsProgramProps> = ({ onNavigateProgram }) => {
  const { setFallbackSurfaceId, setActiveTool } = useAnnotationActions();
  const directory = useStudentsDirectory();
  const allBookmarks = useMushafBookmarks();
  const { draft: activeReportDraft } = useSessionReport();

  const [selectedStudentKey, setSelectedStudentKey] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Add student inline drawer
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLevel, setNewLevel] = useState<StudentLevel>('memorization');
  const [newGoal, setNewGoal] = useState('');

  // Inline edit header state
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLevel, setEditLevel] = useState<StudentLevel>('memorization');
  const [editGoal, setEditGoal] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // Mushaf stop bookmark form state
  const [bookmarkFilter, setBookmarkFilter] = useState<'all' | MushafBookmarkKind>('all');
  const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false);
  const [bmSurahId, setBmSurahId] = useState<number>(1);
  const [bmPageNum, setBmPageNum] = useState<number>(1);
  const [bmAyahNum, setBmAyahNum] = useState<string>('');
  const [bmKind, setBmKind] = useState<MushafBookmarkKind>('stop');
  const [bmNote, setBmNote] = useState('');

  // Whiteboard pages loaded from storage
  const [whiteboardPages] = useState(() => loadWhiteboardState().pages);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  useEffect(() => {
    setFallbackSurfaceId('view:students');
    setActiveTool('cursor');
  }, [setFallbackSurfaceId, setActiveTool]);

  useEffect(() => {
    if (!statusFeedback) return;
    const t = window.setTimeout(() => setStatusFeedback(null), 2800);
    return () => window.clearTimeout(t);
  }, [statusFeedback]);

  // Keep selectedStudentKey aligned with available entries
  useEffect(() => {
    if (directory.length === 0) {
      if (selectedStudentKey) setSelectedStudentKey('');
      return;
    }
    const stillExists = directory.some((entry) => entry.key === selectedStudentKey);
    if (!stillExists) {
      setSelectedStudentKey(directory[0].key);
    }
  }, [directory, selectedStudentKey]);

  const filteredDirectory = useMemo(() => {
    const q = normalizeStudentKey(searchQuery);
    if (!q) return directory;
    return directory.filter(
      (entry) =>
        entry.name.includes(q) ||
        entry.profile.goal.includes(q) ||
        STUDENT_LEVEL_LABELS[entry.profile.level].includes(q)
    );
  }, [directory, searchQuery]);

  const activeEntry = useMemo(
    () => directory.find((entry) => entry.key === selectedStudentKey) ?? directory[0] ?? null,
    [directory, selectedStudentKey]
  );

  const unassignedBookmarks = useMemo(
    () => allBookmarks.filter((bm) => !(bm.studentName || '').trim()),
    [allBookmarks]
  );

  const filteredBookmarks = useMemo(() => {
    if (!activeEntry) return [];
    if (bookmarkFilter === 'all') return activeEntry.bookmarks;
    return activeEntry.bookmarks.filter((bm) => (bm.kind ?? 'stop') === bookmarkFilter);
  }, [activeEntry, bookmarkFilter]);

  const selectedReadingUnit = useMemo(() => {
    if (!activeEntry) return READING_UNITS[0];
    return (
      READING_UNITS.find((u) => u.id === activeEntry.profile.reading.unitId) ?? READING_UNITS[0]
    );
  }, [activeEntry]);

  const selectedTajweedTopic = useMemo(() => {
    if (!activeEntry) return TAJWEED_TOPICS[0];
    return (
      TAJWEED_TOPICS.find((t) => t.id === activeEntry.profile.tajweed.topicId) ??
      TAJWEED_TOPICS[0]
    );
  }, [activeEntry]);

  const handleCreateStudent = (e: React.FormEvent) => {
    e.preventDefault();
    const created = createStudentProfile({
      name: newName,
      level: newLevel,
      goal: newGoal.trim(),
    });
    if (!created) return;
    setSelectedStudentKey(created.name);
    setNewName('');
    setNewGoal('');
    setNewLevel('memorization');
    setIsAddOpen(false);
    setStatusFeedback(`تم إنشاء ملف الطالب «${created.name}»`);
  };

  const handleStartEditHeader = () => {
    if (!activeEntry) return;
    setEditName(activeEntry.name);
    setEditLevel(activeEntry.profile.level);
    setEditGoal(activeEntry.profile.goal);
    setIsEditingHeader(true);
    setConfirmDeleteKey(null);
  };

  const handleSaveHeaderEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEntry) return;
    const cleanNewName = normalizeStudentKey(editName);
    if (!cleanNewName) return;

    const oldName = activeEntry.name;
    if (cleanNewName !== oldName) {
      // Carry over bookmarks linked to the previous student name
      setAllMushafBookmarks((prev) =>
        prev.map((bm) =>
          normalizeStudentKey(bm.studentName || '') === oldName
            ? { ...bm, studentName: cleanNewName }
            : bm
        )
      );
      if (normalizeStudentKey(activeReportDraft.studentName) === oldName) {
        updateReportDraft({ studentName: cleanNewName });
      }
      deleteStudentProfileByName(oldName);
    }

    const updated = upsertStudentProfileByName(cleanNewName, (cur) => ({
      ...cur,
      name: cleanNewName,
      level: editLevel,
      goal: editGoal.trim(),
    }));
    if (updated) {
      setSelectedStudentKey(updated.name);
    }
    setIsEditingHeader(false);
    setStatusFeedback('تم تحديث بيانات الطالب');
  };

  const handleDeleteStudent = (targetName: string) => {
    deleteStudentProfileByName(targetName);
    setAllMushafBookmarks((prev) =>
      prev.map((bm) =>
        normalizeStudentKey(bm.studentName || '') === normalizeStudentKey(targetName)
          ? { ...bm, studentName: undefined }
          : bm
      )
    );
    setConfirmDeleteKey(null);
    setIsEditingHeader(false);
    setStatusFeedback(`تمت إزالة ملف «${targetName}»`);
  };

  const handleSurahSelectChange = (surahId: number) => {
    setBmSurahId(surahId);
    const meta = INITIAL_MUSHAF_SURAHS.find((s) => s.id === surahId);
    if (meta) {
      setBmPageNum(meta.startPage);
    }
  };

  const handleSaveStudentBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEntry) return;
    const surahMeta =
      INITIAL_MUSHAF_SURAHS.find((s) => s.id === bmSurahId) ?? INITIAL_MUSHAF_SURAHS[0];
    const parsedAyah = Number.parseInt(bmAyahNum, 10);
    const ayahNum = Number.isFinite(parsedAyah) && parsedAyah > 0 ? parsedAyah : undefined;
    const safePage = Math.max(1, Math.min(604, Math.round(bmPageNum) || surahMeta.startPage));

    const defaultLabel = ayahNum
      ? `سورة ${surahMeta.name} · الآية ${toArabicDigits(ayahNum)}`
      : `سورة ${surahMeta.name} · صفحة ${toArabicDigits(safePage)}`;

    const bm: MushafBookmark = {
      id: `bm_${Date.now()}`,
      pageNum: safePage,
      surahName: surahMeta.name,
      surahId: surahMeta.id,
      ayahNum,
      focusedKeys: ayahNum ? [`${surahMeta.id}:${ayahNum}`] : undefined,
      label: bmNote.trim() || defaultLabel,
      studentName: activeEntry.name,
      kind: bmKind,
      createdAt: Date.now(),
    };
    addOrUpdateMushafBookmark(bm);
    upsertStudentProfileByName(activeEntry.name, (cur) => cur);
    setBmNote('');
    setBmAyahNum('');
    setIsAddBookmarkOpen(false);
    setStatusFeedback(`تم تسجيل موضع التوقف في سورة ${surahMeta.name}`);
  };

  const handleAssignBookmarkToActive = (bookmark: MushafBookmark) => {
    if (!activeEntry) return;
    setAllMushafBookmarks((prev) =>
      prev.map((item) =>
        item.id === bookmark.id ? { ...item, studentName: activeEntry.name } : item
      )
    );
    upsertStudentProfileByName(activeEntry.name, (cur) => cur);
    setStatusFeedback(`تم ربط العلامة بملف «${activeEntry.name}»`);
  };

  const handleOpenBookmarkInMushaf = (bm: MushafBookmark) => {
    requestJumpToMushafAyah(bm.pageNum, bm.surahId ?? 0, bm.ayahNum ?? 0);
    onNavigateProgram({ view: 'mushaf' });
  };

  const handleToggleTajweedCompleted = (topicId: string) => {
    if (!activeEntry) return;
    upsertStudentProfileByName(activeEntry.name, (cur) => {
      const exists = cur.tajweed.completedTopicIds.includes(topicId);
      const nextCompleted = exists
        ? cur.tajweed.completedTopicIds.filter((id) => id !== topicId)
        : [...cur.tajweed.completedTopicIds, topicId];
      return {
        tajweed: {
          ...cur.tajweed,
          completedTopicIds: nextCompleted,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const handleToggleReadingUnitCompleted = (unitId: string) => {
    if (!activeEntry) return;
    upsertStudentProfileByName(activeEntry.name, (cur) => {
      const exists = cur.reading.completedUnitIds.includes(unitId);
      const nextCompleted = exists
        ? cur.reading.completedUnitIds.filter((id) => id !== unitId)
        : [...cur.reading.completedUnitIds, unitId];
      return {
        reading: {
          ...cur.reading,
          completedUnitIds: nextCompleted,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const handleStartReportForStudent = () => {
    if (!activeEntry) return;
    const latestBookmark = activeEntry.bookmarks[0];
    const hasExistingDraftContent =
      activeReportDraft.studentName.trim() !== '' &&
      normalizeStudentKey(activeReportDraft.studentName) !== activeEntry.name &&
      (activeReportDraft.mistakes.length > 0 ||
        activeReportDraft.newHifzToday.trim() !== '' ||
        activeReportDraft.teacherNote.trim() !== '');

    if (hasExistingDraftContent) {
      archiveAndStartNewReport();
    }

    updateReportDraft({
      studentName: activeEntry.name,
      surahSummary:
        activeEntry.profile.goal ||
        (latestBookmark
          ? `سورة ${latestBookmark.surahName} (ص ${toArabicDigits(latestBookmark.pageNum)})`
          : activeReportDraft.surahSummary),
      nextHifz: activeEntry.profile.whiteboard.nextAssignment || activeReportDraft.nextHifz,
      teacherNote: activeEntry.profile.notes || activeReportDraft.teacherNote,
    });
    onNavigateProgram({ view: 'reports' });
  };

  const handleOpenWhiteboardForStudent = () => {
    if (!activeEntry) return;
    const pageId = activeEntry.profile.whiteboard.pageId;
    if (pageId) {
      const wbState = loadWhiteboardState();
      if (wbState.pages.some((p) => p.id === pageId)) {
        saveWhiteboardState({ ...wbState, activePageId: pageId });
      }
    }
    onNavigateProgram({ view: 'whiteboard' });
  };

  return (
    <>
      <div className="unified-hero-pod is-students-pod" id="students-hero-pod">
        <section className="lesson-hero-title-area" id="students-main-heading-area">
          <div className="lesson-title-badge-row">
            <span className="lesson-badge-category">
              <span className="badge-ornament-star">✦</span>
              <span className="badge-text-diacritics">متابعة موحّدة لكل برامج المنصة</span>
              <span className="badge-ornament-star">✦</span>
            </span>
          </div>

          <h1 className="lesson-primary-heading">ملفات الطلاب ومواضع التوقف</h1>

          <div className="lesson-title-deco-line" aria-hidden="true">
            <span className="deco-line-half"></span>
            <span className="deco-rosette">✦</span>
            <span className="deco-line-half deco-line-r"></span>
          </div>
        </section>
      </div>

      <main id="students-standalone-shell" className="students-shell" dir="rtl" aria-label="ملف الطالب الشامل">
        {statusFeedback && (
          <div className="students-status-toast" role="status" aria-live="polite">
            <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{statusFeedback}</span>
          </div>
        )}

        <div className="students-workspace">
          {/* Right Pane: Students Directory Roster */}
          <aside className="students-sidebar" aria-label="قائمة الطلاب">
            <div className="students-sidebar-head">
              <div className="students-sidebar-title-row">
                <Users className="w-4 h-4 text-[#0035D1]" aria-hidden="true" />
                <h2 className="students-sidebar-title">
                  الطلاب ({toArabicDigits(directory.length)})
                </h2>
              </div>
              <button
                type="button"
                className={`students-add-toggle-btn ${isAddOpen ? 'is-open' : ''}`}
                onClick={() => setIsAddOpen((v) => !v)}
              >
                {isAddOpen ? <X className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                <span>{isAddOpen ? 'إغلاق' : 'إضافة طالب'}</span>
              </button>
            </div>

            {isAddOpen && (
              <form className="students-create-form" onSubmit={handleCreateStudent}>
                <input
                  type="text"
                  className="students-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="اسم الطالب الثلاثي أو الثنائي"
                  required
                  autoFocus
                />
                <div className="students-create-row">
                  <select
                    className="students-select"
                    value={newLevel}
                    onChange={(e) => setNewLevel(e.target.value as StudentLevel)}
                    aria-label="المسار التعليمي"
                  >
                    {LEVEL_OPTIONS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {STUDENT_LEVEL_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  className="students-input"
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  placeholder="الهدف الحالي (مثل: حفظ جزء عمّ)"
                />
                <button type="submit" className="students-primary-btn w-full">
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>حفظ ملف الطالب</span>
                </button>
              </form>
            )}

            <div className="students-search-box">
              <Search className="w-4 h-4 students-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="students-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث باسم الطالب أو المسار..."
                aria-label="بحث في قائمة الطلاب"
              />
            </div>

            {filteredDirectory.length > 0 ? (
              <div className="students-roster-list" role="tablist" aria-label="اختيار ملف طالب">
                {filteredDirectory.map((entry) => {
                  const isActive = activeEntry?.key === entry.key;
                  const latestBm = entry.bookmarks[0];
                  const readingUnit = READING_UNITS.find(
                    (u) => u.id === entry.profile.reading.unitId
                  );
                  const metaParts = [
                    latestBm
                      ? `المصحف: ${latestBm.surahName} ص ${toArabicDigits(latestBm.pageNum)}`
                      : `القراءة: ${readingUnit?.shortTitle ?? 'التأسيس'}`,
                    `${toArabicDigits(entry.bookmarks.length)} توقف`,
                    `${toArabicDigits(entry.reports.length)} تقرير`,
                  ];

                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`students-roster-item ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelectedStudentKey(entry.key);
                        setIsEditingHeader(false);
                        setConfirmDeleteKey(null);
                      }}
                    >
                      <div className="students-roster-name-row">
                        <span className="students-roster-name">{entry.name}</span>
                        <span className="students-roster-level">
                          {STUDENT_LEVEL_LABELS[entry.profile.level]}
                        </span>
                      </div>
                      <span className="students-roster-meta">{metaParts.join(' · ')}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="students-roster-empty">
                {directory.length === 0 ? (
                  <p>
                    لا توجد ملفات طلاب مسجلة بعد. أضِف طالباً جديداً أو سجّل علامة توقف باسم طالب من
                    المصحف أو تقرير الحصص ليظهر هنا تلقائياً.
                  </p>
                ) : (
                  <p>لا توجد نتائج مطابقة للبحث «{searchQuery}».</p>
                )}
              </div>
            )}

            {unassignedBookmarks.length > 0 && activeEntry && (
              <div className="students-unassigned-box">
                <div className="students-unassigned-title">
                  علامات مصحف بدون اسم طالب ({toArabicDigits(unassignedBookmarks.length)})
                </div>
                <div className="students-unassigned-list">
                  {unassignedBookmarks.slice(0, 4).map((bm) => (
                    <div key={bm.id} className="students-unassigned-row">
                      <span className="students-unassigned-label">
                        {bm.surahName} · ص {toArabicDigits(bm.pageNum)}
                      </span>
                      <button
                        type="button"
                        className="students-link-btn"
                        onClick={() => handleAssignBookmarkToActive(bm)}
                      >
                        ربط بـ {activeEntry.name}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Left/Main Pane: Active Student Dossier */}
          <section className="students-dossier-pane" aria-label="تفاصيل ملف الطالب">
            {!activeEntry ? (
              <div className="students-empty-hero">
                <div className="students-empty-icon" aria-hidden="true">
                  <UserCheck className="w-8 h-8" strokeWidth={1.8} />
                </div>
                <h2 className="students-empty-title">ابدأ بإنشاء أول ملف طالب</h2>
                <p className="students-empty-desc">
                  يجمع هذا القسم لكل طالب آخر موضع توقف له في المصحف الشريف، ودرسه الحالي في التجويد
                  والتدريب القرائي، ولوحة السبورة المرتبطة به، وسجل تقارير حصصه في صفحة واحدة.
                </p>
                <button
                  type="button"
                  className="students-primary-btn"
                  onClick={() => setIsAddOpen(true)}
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>إضافة طالب الآن</span>
                </button>
              </div>
            ) : (
              <>
                {/* Dossier Header */}
                <header className="student-dossier-header">
                  {!isEditingHeader ? (
                    <>
                      <div className="student-header-identity">
                        <div className="student-header-title-row">
                          <h2 className="student-header-name">{activeEntry.name}</h2>
                          <span className="student-header-track">
                            {STUDENT_LEVEL_LABELS[activeEntry.profile.level]}
                          </span>
                        </div>
                        <p className="student-header-goal">
                          {activeEntry.profile.goal
                            ? `الهدف الحالي: ${activeEntry.profile.goal}`
                            : 'لم يُحدَّد هدف حالي بعد — يمكنك إضافته عبر تعديل البيانات'}
                        </p>
                      </div>

                      <div className="student-header-actions">
                        <button
                          type="button"
                          className="students-primary-btn"
                          onClick={handleStartReportForStudent}
                        >
                          <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                          <span>بدء تقرير حصة</span>
                        </button>
                        <button
                          type="button"
                          className="students-secondary-btn"
                          onClick={handleStartEditHeader}
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>تعديل</span>
                        </button>
                        {confirmDeleteKey === activeEntry.key ? (
                          <div className="student-delete-confirm">
                            <button
                              type="button"
                              className="students-danger-btn"
                              onClick={() => handleDeleteStudent(activeEntry.name)}
                            >
                              تأكيد الحذف
                            </button>
                            <button
                              type="button"
                              className="students-secondary-btn"
                              onClick={() => setConfirmDeleteKey(null)}
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="students-icon-btn"
                            onClick={() => setConfirmDeleteKey(activeEntry.key)}
                            aria-label={`حذف ملف ${activeEntry.name}`}
                            title="حذف ملف الطالب"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <form className="student-header-edit-form" onSubmit={handleSaveHeaderEdit}>
                      <div className="student-edit-grid">
                        <label className="student-field">
                          <span className="student-field-label">اسم الطالب</span>
                          <input
                            type="text"
                            className="students-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            required
                          />
                        </label>
                        <label className="student-field">
                          <span className="student-field-label">المسار</span>
                          <select
                            className="students-select"
                            value={editLevel}
                            onChange={(e) => setEditLevel(e.target.value as StudentLevel)}
                          >
                            {LEVEL_OPTIONS.map((lvl) => (
                              <option key={lvl} value={lvl}>
                                {STUDENT_LEVEL_LABELS[lvl]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="student-field is-wide">
                          <span className="student-field-label">الهدف الحالي</span>
                          <input
                            type="text"
                            className="students-input"
                            value={editGoal}
                            onChange={(e) => setEditGoal(e.target.value)}
                            placeholder="مثال: إتمام سورة البقرة مع ضبط القلقلة"
                          />
                        </label>
                      </div>
                      <div className="student-edit-actions">
                        <button type="submit" className="students-primary-btn">
                          <Check className="w-4 h-4" aria-hidden="true" />
                          <span>حفظ التعديلات</span>
                        </button>
                        <button
                          type="button"
                          className="students-secondary-btn"
                          onClick={() => setIsEditingHeader(false)}
                        >
                          إلغاء
                        </button>
                      </div>
                    </form>
                  )}
                </header>

                {/* Single 4-Column Summary Strip */}
                <div className="student-summary-strip" aria-label="ملخص التقدم">
                  <div className="student-summary-cell">
                    <span className="student-summary-label">علامات المصحف</span>
                    <strong className="student-summary-value">
                      {toArabicDigits(activeEntry.bookmarks.length)}
                    </strong>
                  </div>
                  <div className="student-summary-cell">
                    <span className="student-summary-label">أبواب التجويد</span>
                    <strong className="student-summary-value">
                      {toArabicDigits(activeEntry.profile.tajweed.completedTopicIds.length)} /{' '}
                      {toArabicDigits(TAJWEED_TOPICS.length)}
                    </strong>
                  </div>
                  <div className="student-summary-cell">
                    <span className="student-summary-label">وحدات القراءة</span>
                    <strong className="student-summary-value">
                      {toArabicDigits(activeEntry.profile.reading.completedUnitIds.length)} /{' '}
                      {toArabicDigits(READING_UNITS.length)}
                    </strong>
                  </div>
                  <div className="student-summary-cell">
                    <span className="student-summary-label">تقارير الحصص</span>
                    <strong className="student-summary-value">
                      {toArabicDigits(activeEntry.reports.length)}
                    </strong>
                  </div>
                </div>

                {/* Section 1: Mushaf Checkpoints */}
                <section className="student-section-card" aria-labelledby="sec-mushaf-title">
                  <div className="student-section-head">
                    <div className="student-section-heading-group">
                      <BookOpen className="w-4 h-4 text-[#8A5D0B]" aria-hidden="true" />
                      <div>
                        <h3 id="sec-mushaf-title" className="student-section-title">
                          علامات التوقف في المصحف الشريف
                        </h3>
                        <p className="student-section-sub">
                          مرتبطة مباشرة بعلامات المصحف؛ يمكنك تسجيل موضع جديد أو العودة للموضع فوراً
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="students-secondary-btn"
                      onClick={() => setIsAddBookmarkOpen((v) => !v)}
                    >
                      {isAddBookmarkOpen ? (
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{isAddBookmarkOpen ? 'إلغاء' : 'تسجيل موضع توقف'}</span>
                    </button>
                  </div>

                  {isAddBookmarkOpen && (
                    <form className="student-bm-add-form" onSubmit={handleSaveStudentBookmark}>
                      <div className="student-bm-form-grid">
                        <label className="student-field">
                          <span className="student-field-label">السورة</span>
                          <select
                            className="students-select"
                            value={bmSurahId}
                            onChange={(e) => handleSurahSelectChange(Number(e.target.value))}
                          >
                            {INITIAL_MUSHAF_SURAHS.map((s) => (
                              <option key={s.id} value={s.id}>
                                {toArabicDigits(s.id)}. {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="student-field">
                          <span className="student-field-label">رقم الصفحة</span>
                          <input
                            type="number"
                            min={1}
                            max={604}
                            className="students-input"
                            value={bmPageNum}
                            onChange={(e) => setBmPageNum(Number(e.target.value))}
                          />
                        </label>
                        <label className="student-field">
                          <span className="student-field-label">رقم الآية (اختياري)</span>
                          <input
                            type="number"
                            min={1}
                            className="students-input"
                            value={bmAyahNum}
                            onChange={(e) => setBmAyahNum(e.target.value)}
                            placeholder="مثلاً: ١٥"
                          />
                        </label>
                        <label className="student-field">
                          <span className="student-field-label">النوع</span>
                          <select
                            className="students-select"
                            value={bmKind}
                            onChange={(e) => setBmKind(e.target.value as MushafBookmarkKind)}
                          >
                            {BOOKMARK_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {BOOKMARK_KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="student-bm-form-footer">
                        <input
                          type="text"
                          className="students-input"
                          value={bmNote}
                          onChange={(e) => setBmNote(e.target.value)}
                          placeholder="ملاحظة (اختياري، مثل: تثبيت من أول الوجه)"
                        />
                        <button type="submit" className="students-primary-btn shrink-0">
                          <BookMarked className="w-4 h-4" aria-hidden="true" />
                          <span>حفظ الموضع</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {activeEntry.bookmarks.length > 0 && (
                    <div className="student-filter-tabs" role="group" aria-label="تصفية علامات التوقف">
                      <button
                        type="button"
                        className={`student-filter-tab ${bookmarkFilter === 'all' ? 'is-active' : ''}`}
                        onClick={() => setBookmarkFilter('all')}
                      >
                        الكل ({toArabicDigits(activeEntry.bookmarks.length)})
                      </button>
                      {BOOKMARK_KINDS.map((kind) => {
                        const count = activeEntry.bookmarks.filter(
                          (b) => (b.kind ?? 'stop') === kind
                        ).length;
                        return (
                          <button
                            key={kind}
                            type="button"
                            className={`student-filter-tab ${bookmarkFilter === kind ? 'is-active' : ''}`}
                            onClick={() => setBookmarkFilter(kind)}
                          >
                            {BOOKMARK_KIND_LABELS[kind]} ({toArabicDigits(count)})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {filteredBookmarks.length > 0 ? (
                    <div className="student-checkpoints-list">
                      {filteredBookmarks.map((bm) => {
                        const kind = bm.kind ?? 'stop';
                        const metaLine = [
                          `سورة ${bm.surahName}`,
                          `ص ${toArabicDigits(bm.pageNum)}`,
                          bm.ayahNum ? `الآية ${toArabicDigits(bm.ayahNum)}` : null,
                          formatArabicDateShort(bm.createdAt),
                        ]
                          .filter(Boolean)
                          .join(' · ');

                        return (
                          <div key={bm.id} className="student-checkpoint-row">
                            <div className="student-checkpoint-main">
                              <div className="student-checkpoint-top">
                                <span className={`student-kind-text is-kind-${kind}`}>
                                  {BOOKMARK_KIND_LABELS[kind]}
                                </span>
                                <span className="student-checkpoint-meta">{metaLine}</span>
                              </div>
                              <p className="student-checkpoint-label">{bm.label}</p>
                            </div>

                            <div className="student-checkpoint-actions">
                              <button
                                type="button"
                                className="students-jump-btn"
                                onClick={() => handleOpenBookmarkInMushaf(bm)}
                              >
                                <span>فتح في المصحف</span>
                                <ArrowUpLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="students-icon-btn"
                                onClick={() => removeMushafBookmark(bm.id)}
                                aria-label={`حذف علامة ${bm.label}`}
                                title="حذف العلامة"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="student-empty-inline">
                      {activeEntry.bookmarks.length > 0
                        ? 'لا توجد علامات توقف من هذا النوع حالياً.'
                        : 'لم تُسجَّل علامات توقف في المصحف لهذا الطالب بعد.'}
                    </p>
                  )}
                </section>

                {/* Section 2: Tajweed + Reading Checkpoints */}
                <div className="student-programs-grid">
                  {/* Tajweed Program Progress */}
                  <section className="student-section-card" aria-labelledby="sec-tajweed-title">
                    <div className="student-section-head">
                      <div className="student-section-heading-group">
                        <GraduationCap className="w-4 h-4 text-[#0035D1]" aria-hidden="true" />
                        <div>
                          <h3 id="sec-tajweed-title" className="student-section-title">
                            التقدّم في برنامج التجويد
                          </h3>
                          <p className="student-section-sub">
                            الدرس الحالي ومرحلة التطبيق، مع متابعة الأبواب المنجزة
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="student-curriculum-controls">
                      <label className="student-field">
                        <span className="student-field-label">الباب الحالي</span>
                        <select
                          className="students-select"
                          value={selectedTajweedTopic.id}
                          onChange={(e) =>
                            upsertStudentProfileByName(activeEntry.name, (cur) => ({
                              tajweed: {
                                ...cur.tajweed,
                                topicId: e.target.value,
                                updatedAt: Date.now(),
                              },
                            }))
                          }
                        >
                          {TAJWEED_TOPICS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.lessonNum}: {t.title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="student-field">
                        <span className="student-field-label">المرحلة</span>
                        <select
                          className="students-select"
                          value={activeEntry.profile.tajweed.tabId}
                          onChange={(e) =>
                            upsertStudentProfileByName(activeEntry.name, (cur) => ({
                              tajweed: {
                                ...cur.tajweed,
                                tabId: e.target.value as TajweedTabId,
                                updatedAt: Date.now(),
                              },
                            }))
                          }
                        >
                          {TAJWEED_TABS_CONFIG.map((tab) => (
                            <option key={tab.id} value={tab.id}>
                              {tab.num}. {tab.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="student-checklist-block">
                      <span className="student-field-label">الأبواب المُتقنة</span>
                      <div className="student-checklist-grid">
                        {TAJWEED_TOPICS.map((topic) => {
                          const done = activeEntry.profile.tajweed.completedTopicIds.includes(
                            topic.id
                          );
                          return (
                            <button
                              key={topic.id}
                              type="button"
                              aria-pressed={done}
                              className={`student-check-row ${done ? 'is-done' : ''}`}
                              onClick={() => handleToggleTajweedCompleted(topic.id)}
                            >
                              <span className="student-check-box" aria-hidden="true">
                                {done && <Check className="w-3 h-3" strokeWidth={3} />}
                              </span>
                              <span className="student-check-text">{topic.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="student-card-launch-row">
                      <button
                        type="button"
                        className="students-jump-btn"
                        onClick={() =>
                          onNavigateProgram({
                            view: 'tajweed',
                            tajweedTopic: selectedTajweedTopic.id,
                            tajweedTab: activeEntry.profile.tajweed.tabId,
                          })
                        }
                      >
                        <span>متابعة في برنامج التجويد</span>
                        <ArrowUpLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </section>

                  {/* Reading Program Progress */}
                  <section className="student-section-card" aria-labelledby="sec-reading-title">
                    <div className="student-section-head">
                      <div className="student-section-heading-group">
                        <Layers className="w-4 h-4 text-[#047857]" aria-hidden="true" />
                        <div>
                          <h3 id="sec-reading-title" className="student-section-title">
                            التقدّم في التدريب القرائي
                          </h3>
                          <p className="student-section-sub">
                            تحديد الوحدة والقسم الحالي من الـ {toArabicDigits(READING_UNITS.length)}{' '}
                            وحدة تأسيسية
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="student-curriculum-controls">
                      <label className="student-field">
                        <span className="student-field-label">الوحدة الحالية</span>
                        <select
                          className="students-select"
                          value={selectedReadingUnit.id}
                          onChange={(e) => {
                            const nextUnit =
                              READING_UNITS.find((u) => u.id === e.target.value) ??
                              READING_UNITS[0];
                            upsertStudentProfileByName(activeEntry.name, (cur) => ({
                              reading: {
                                ...cur.reading,
                                unitId: nextUnit.id,
                                subTab: nextUnit.defaultSubTab,
                                updatedAt: Date.now(),
                              },
                            }));
                          }}
                        >
                          {READING_UNITS.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.unitOrder}: {unit.title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="student-field">
                        <span className="student-field-label">القسم داخل الوحدة</span>
                        <select
                          className="students-select"
                          value={activeEntry.profile.reading.subTab}
                          onChange={(e) =>
                            upsertStudentProfileByName(activeEntry.name, (cur) => ({
                              reading: {
                                ...cur.reading,
                                subTab: e.target.value,
                                updatedAt: Date.now(),
                              },
                            }))
                          }
                        >
                          {selectedReadingUnit.tabs.map((t) => (
                            <option key={t.subTab} value={t.subTab}>
                              {t.num}. {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="student-checklist-block">
                      <span className="student-field-label">الوحدات المنجزة</span>
                      <div className="student-units-matrix">
                        {READING_UNITS.map((unit) => {
                          const done = activeEntry.profile.reading.completedUnitIds.includes(
                            unit.id
                          );
                          return (
                            <button
                              key={unit.id}
                              type="button"
                              aria-pressed={done}
                              className={`student-unit-toggle ${done ? 'is-done' : ''}`}
                              onClick={() => handleToggleReadingUnitCompleted(unit.id)}
                            >
                              <span className="student-check-box" aria-hidden="true">
                                {done && <Check className="w-3 h-3" strokeWidth={3} />}
                              </span>
                              <span>{unit.shortTitle}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="student-card-launch-row">
                      <button
                        type="button"
                        className="students-jump-btn"
                        onClick={() =>
                          onNavigateProgram({
                            view: 'reading',
                            readingTarget: {
                              mainCat: selectedReadingUnit.id,
                              subTab: activeEntry.profile.reading.subTab,
                            },
                          })
                        }
                      >
                        <span>متابعة في التدريب القرائي</span>
                        <ArrowUpLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </section>
                </div>

                {/* Section 3: Whiteboard + Session Reports */}
                <div className="student-programs-grid">
                  {/* Whiteboard & Teacher Plan */}
                  <section className="student-section-card" aria-labelledby="sec-wb-title">
                    <div className="student-section-head">
                      <div className="student-section-heading-group">
                        <PenTool className="w-4 h-4 text-[#6D28D9]" aria-hidden="true" />
                        <div>
                          <h3 id="sec-wb-title" className="student-section-title">
                            السبورة التفاعلية وخطة الحصة القادمة
                          </h3>
                          <p className="student-section-sub">
                            ربط لوحة السبورة المخصّصة للطالب وتدوين واجب الحصة القادمة
                          </p>
                        </div>
                      </div>
                    </div>

                    <label className="student-field">
                      <span className="student-field-label">لوحة السبورة المرتبطة</span>
                      <select
                        className="students-select"
                        value={activeEntry.profile.whiteboard.pageId}
                        onChange={(e) =>
                          upsertStudentProfileByName(activeEntry.name, (cur) => ({
                            whiteboard: {
                              ...cur.whiteboard,
                              pageId: e.target.value,
                              updatedAt: Date.now(),
                            },
                          }))
                        }
                      >
                        <option value="">اللوحة النشطة افتراضياً</option>
                        {whiteboardPages.map((pg) => (
                          <option key={pg.id} value={pg.id}>
                            {pg.title} ({toArabicDigits(pg.cards.length)} بطاقة)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="student-field">
                      <span className="student-field-label">الواجب والمطلوب للحصة القادمة</span>
                      <textarea
                        rows={2}
                        className="students-textarea"
                        value={activeEntry.profile.whiteboard.nextAssignment}
                        onChange={(e) =>
                          upsertStudentProfileByName(activeEntry.name, (cur) => ({
                            whiteboard: {
                              ...cur.whiteboard,
                              nextAssignment: e.target.value,
                              updatedAt: Date.now(),
                            },
                          }))
                        }
                        placeholder="مثال: تحضير وجه من سورة لقمان مع التشديد على أحكام الميم الساكنة"
                      />
                    </label>

                    <label className="student-field">
                      <span className="student-field-label">ملاحظات المعلم العامة</span>
                      <textarea
                        rows={2}
                        className="students-textarea"
                        value={activeEntry.profile.notes}
                        onChange={(e) =>
                          upsertStudentProfileByName(activeEntry.name, () => ({
                            notes: e.target.value,
                          }))
                        }
                        placeholder="نقاط القوة والجوانب التي تحتاج تركيزاً مستمراً..."
                      />
                    </label>

                    <div className="student-card-launch-row">
                      <button
                        type="button"
                        className="students-jump-btn"
                        onClick={handleOpenWhiteboardForStudent}
                      >
                        <span>فتح السبورة التفاعلية</span>
                        <ArrowUpLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </section>

                  {/* Reports History for Student */}
                  <section className="student-section-card" aria-labelledby="sec-reports-title">
                    <div className="student-section-head">
                      <div className="student-section-heading-group">
                        <ClipboardCheck className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
                        <div>
                          <h3 id="sec-reports-title" className="student-section-title">
                            سجل تقارير الحصص ({toArabicDigits(activeEntry.reports.length)})
                          </h3>
                          <p className="student-section-sub">
                            جميع التقارير المسجلة باسم الطالب لمتابعة تطوره من حصة لأخرى
                          </p>
                        </div>
                      </div>
                    </div>

                    {activeEntry.reports.length > 0 ? (
                      <div className="student-reports-list">
                        {activeEntry.reports.map((rep) => {
                          const isCurrentDraft = rep.id === activeReportDraft.id;
                          const metaLine = [
                            formatIsoReportDate(rep.sessionDate),
                            RATING_LABELS[rep.overallRating],
                            `${toArabicDigits(rep.mistakes.length)} موضع`,
                          ].join(' · ');

                          return (
                            <div key={rep.id} className="student-report-row">
                              <div className="student-report-info">
                                <div className="student-report-title-row">
                                  <strong className="student-report-title">
                                    {rep.surahSummary.trim() || 'حصة مراجعة وتلاوة'}
                                  </strong>
                                  {isCurrentDraft && (
                                    <span className="student-draft-mark">المسودة المفتوحة</span>
                                  )}
                                </div>
                                <span className="student-checkpoint-meta">{metaLine}</span>
                              </div>

                              <button
                                type="button"
                                className="students-jump-btn"
                                onClick={() => {
                                  if (!isCurrentDraft) {
                                    loadReportFromHistory(rep.id);
                                  }
                                  onNavigateProgram({ view: 'reports' });
                                }}
                              >
                                <span>عرض التقرير</span>
                                <ArrowUpLeft className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="student-empty-inline-wrap">
                        <p className="student-empty-inline">
                          لا توجد تقارير حصص محفوظة لهذا الطالب بعد.
                        </p>
                        <button
                          type="button"
                          className="students-secondary-btn"
                          onClick={handleStartReportForStudent}
                        >
                          <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>إصدار أول تقرير للطالب</span>
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
};

export default StudentsProgram;
