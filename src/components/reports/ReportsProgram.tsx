import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  Check,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileImage,
  FilePlus2,
  History,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toArabicDigits } from '../../utils/mushafData';
import { useAnnotationActions } from '../annotation';
import { exportReportElementToFile, type ExportFileFormat } from '../annotation/pdfExport';
import {
  archiveAndStartNewReport,
  clearReportMistakes,
  deleteReportFromHistory,
  loadReportFromHistory,
  MISTAKE_CATEGORY_LABELS,
  moveCapturedMistake,
  RATING_LABELS,
  removeCapturedMistake,
  requestJumpToMushafAyah,
  updateCapturedMistake,
  updateReportDraft,
  useSessionReport,
  type ReportMistakeCategory,
  type ReportOverallRating,
} from './reportStore';
import { useStudentsDirectory } from '../students/studentStore';

interface ReportsProgramProps {
  onOpenMushaf: () => void;
}

const RATING_ORDER: ReportOverallRating[] = ['excellent', 'very_good', 'good', 'needs_focus'];
const CATEGORY_ORDER: ReportMistakeCategory[] = ['memorization', 'recitation', 'tajweed'];

function formatArabicReportDate(isoDate: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return toArabicDigits(isoDate);
  const [y, m, d] = parts;
  return `${toArabicDigits(d)} / ${toArabicDigits(m)} / ${toArabicDigits(y)}`;
}

function buildReportFilename(studentName: string, sessionDate: string, format: ExportFileFormat): string {
  const cleanStudent = studentName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9_-]/g, '');
  const cleanDate = (sessionDate || 'session').replace(/[^0-9-]/g, '');
  const base = cleanStudent ? `safara-report-${cleanStudent}-${cleanDate}` : `safara-report-${cleanDate}`;
  return `${base}.${format}`;
}

export const ReportsProgram: React.FC<ReportsProgramProps> = ({ onOpenMushaf }) => {
  const { setFallbackSurfaceId, setActiveTool } = useAnnotationActions();
  const { draft, history } = useSessionReport();
  const studentsDirectory = useStudentsDirectory();

  const reportSheetRef = useRef<HTMLDivElement>(null);
  const statusTimerRef = useRef<number | null>(null);
  const [isExporting, setIsExporting] = useState<ExportFileFormat | null>(null);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    setFallbackSurfaceId('view:reports');
    setActiveTool('cursor');
  }, [setFallbackSurfaceId, setActiveTool]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const handleExport = async (format: ExportFileFormat) => {
    const sheetEl = reportSheetRef.current;
    if (!sheetEl || isExporting) return;

    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    setIsExporting(format);
    setExportStatusMsg(null);
    try {
      const filename = buildReportFilename(draft.studentName, draft.sessionDate, format);
      await exportReportElementToFile({
        element: sheetEl,
        filename,
        format,
        backgroundHex: '#FFFFFF',
      });
      setExportStatusMsg(
        format === 'pdf' ? 'تم تنزيل التقرير بصيغة PDF بنجاح' : 'تم حفظ التقرير كصورة PNG بنجاح'
      );
      statusTimerRef.current = window.setTimeout(() => {
        setExportStatusMsg(null);
        statusTimerRef.current = null;
      }, 3200);
    } catch (err) {
      console.error('[ReportsProgram] Report export failed:', err);
      setExportStatusMsg('تعذّر تصدير التقرير حالياً، يرجى المحاولة مرة أخرى.');
    } finally {
      setIsExporting(null);
    }
  };

  const handleJumpToMushafAyah = (pageNum: number, surahId: number, ayahNum: number) => {
    requestJumpToMushafAyah(pageNum, surahId, ayahNum);
    onOpenMushaf();
  };

  return (
    <main id="reports-program-shell" className="reports-shell" dir="rtl" aria-label="تقارير الحصص والمتابعة">
      {/* Top Action Bar */}
      <header className="reports-topbar">
        <div className="reports-topbar-title-group">
          <div className="reports-topbar-icon" aria-hidden="true">
            <ClipboardCheck className="w-5 h-5" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="reports-topbar-title">تقارير الحصص والمتابعة</h1>
            <p className="reports-topbar-subtitle">
              توثيق الأخطاء المصوّرة من المصحف وخطة الحفظ والمراجعة للحصة القادمة
            </p>
          </div>
        </div>

        <div className="reports-topbar-actions">
          <button
            type="button"
            className="report-action-btn"
            onClick={onOpenMushaf}
            title="الانتقال إلى المصحف لتحديد آيات إضافية بالخطأ"
          >
            <BookOpen className="w-4 h-4" aria-hidden="true" />
            <span>العودة للمصحف</span>
          </button>

          <button
            type="button"
            className="report-action-btn"
            onClick={archiveAndStartNewReport}
            title="حفظ التقرير الحالي في السجل والبدء بتقرير لطالب جديد"
          >
            <FilePlus2 className="w-4 h-4" aria-hidden="true" />
            <span>تقرير جديد</span>
          </button>

          <button
            type="button"
            className="report-action-btn"
            disabled={isExporting !== null}
            onClick={() => handleExport('png')}
            title="حفظ معاينة التقرير كصورة PNG"
          >
            {isExporting === 'png' ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileImage className="w-4 h-4" aria-hidden="true" />
            )}
            <span>صورة PNG</span>
          </button>

          <button
            type="button"
            className="report-action-btn is-primary"
            disabled={isExporting !== null}
            onClick={() => handleExport('pdf')}
            title="تنزيل التقرير كملف PDF جاهز للإرسال لولي الأمر"
          >
            {isExporting === 'pdf' ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{isExporting === 'pdf' ? 'جارٍ التجهيز...' : 'تنزيل التقرير PDF'}</span>
          </button>
        </div>
      </header>

      {exportStatusMsg && (
        <div className="reports-status-banner" role="status" aria-live="polite">
          <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{exportStatusMsg}</span>
        </div>
      )}

      {/* Split Workspace: Right Editor Form + Left Live A4 Sheet */}
      <div className="reports-workspace-grid">
        {/* Right Column: Structured Session Editor */}
        <section className="reports-editor-column" aria-label="بيانات التقرير">
          {/* 1. Student & Session Metadata */}
          <div className="reports-form-section">
            <h2 className="reports-section-heading">بيانات الحصة والطالب</h2>

            <div className="reports-fields-grid">
              <label className="reports-field">
                <span className="reports-field-label">اسم الطالب</span>
                <input
                  type="text"
                  className="reports-input"
                  list="reports-student-names-list"
                  value={draft.studentName}
                  onChange={(e) => updateReportDraft({ studentName: e.target.value })}
                  placeholder="مثال: عبد الرحمن أحمد"
                />
                <datalist id="reports-student-names-list">
                  {studentsDirectory.map((stu) => (
                    <option key={stu.key} value={stu.name} />
                  ))}
                </datalist>
              </label>

              <label className="reports-field">
                <span className="reports-field-label">تاريخ الحصة</span>
                <div className="reports-date-wrap">
                  <Calendar className="w-4 h-4 reports-date-icon" aria-hidden="true" />
                  <input
                    type="date"
                    className="reports-input is-date"
                    value={draft.sessionDate}
                    onChange={(e) => updateReportDraft({ sessionDate: e.target.value })}
                  />
                </div>
              </label>

              <label className="reports-field">
                <span className="reports-field-label">اسم المعلم / الحلقة</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.teacherName}
                  onChange={(e) => updateReportDraft({ teacherName: e.target.value })}
                  placeholder="اختياري"
                />
              </label>

              <label className="reports-field">
                <span className="reports-field-label">السورة / المقرر الحالي</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.surahSummary}
                  onChange={(e) => updateReportDraft({ surahSummary: e.target.value })}
                  placeholder="مثال: سورة المطففين (١ - ٣٦)"
                />
              </label>
            </div>

            <div className="reports-field">
              <span className="reports-field-label">التقييم العام للحصة</span>
              <div className="reports-segmented-group" role="group" aria-label="التقييم العام للحصة">
                {RATING_ORDER.map((ratingKey) => {
                  const isActive = draft.overallRating === ratingKey;
                  return (
                    <button
                      key={ratingKey}
                      type="button"
                      className={`reports-seg-btn is-rating-${ratingKey} ${isActive ? 'is-active' : ''}`}
                      aria-pressed={isActive}
                      onClick={() => updateReportDraft({ overallRating: ratingKey })}
                    >
                      {RATING_LABELS[ratingKey]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 2. Today's Progress */}
          <div className="reports-form-section">
            <h2 className="reports-section-heading">ما تم إنجازه في الحصة</h2>

            <div className="reports-fields-grid">
              <label className="reports-field is-full">
                <span className="reports-field-label">الحفظ الجديد اليوم</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.newHifzToday}
                  onChange={(e) => updateReportDraft({ newHifzToday: e.target.value })}
                  placeholder="مثال: سورة المطففين من آية ١ إلى آية ١٧"
                />
              </label>

              <label className="reports-field is-full">
                <span className="reports-field-label">المراجعة اليوم</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.reviewToday}
                  onChange={(e) => updateReportDraft({ reviewToday: e.target.value })}
                  placeholder="مثال: سورة الانفطار والتكوير"
                />
              </label>
            </div>
          </div>

          {/* 3. Captured Mushaf Mistakes */}
          <div className="reports-form-section">
            <div className="reports-section-header-row">
              <h2 className="reports-section-heading">
                مواضع الخطأ والتركيز ({toArabicDigits(draft.mistakes.length)})
              </h2>
              {draft.mistakes.length > 0 && (
                <button
                  type="button"
                  className="reports-text-danger-btn"
                  onClick={clearReportMistakes}
                  title="حذف جميع الآيات الملتقطة من هذا التقرير"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>تفريغ المواضع</span>
                </button>
              )}
            </div>

            {draft.mistakes.length === 0 ? (
              <div className="reports-mistakes-empty">
                <p>
                  لم تُلتقط آيات بعد. افتح المصحف الشريف، علّم بالقلم أو المظلِّل على مواضع الخطأ أثناء التسميع، ثم فعّل زر <strong>«التقاط خطأ»</strong> واضغط على الآية لإرسالها هنا فوراً.
                </p>
                <button type="button" className="report-action-btn" onClick={onOpenMushaf}>
                  <BookOpen className="w-4 h-4" aria-hidden="true" />
                  <span>الانتقال للمصحف لالتقاط آية</span>
                </button>
              </div>
            ) : (
              <div className="reports-editor-mistakes-list">
                {draft.mistakes.map((mistake, idx) => (
                  <article key={mistake.id} className="reports-editor-mistake-card">
                    <div className="reports-editor-mistake-top">
                      <span className="reports-editor-mistake-meta">
                        {toArabicDigits(idx + 1)}. سورة {mistake.surahName} · الآية{' '}
                        {toArabicDigits(mistake.ayahNum)} · ص {toArabicDigits(mistake.pageNum)}
                      </span>

                      <div className="reports-editor-mistake-tools">
                        <button
                          type="button"
                          className="reports-icon-mini-btn"
                          onClick={() =>
                            handleJumpToMushafAyah(mistake.pageNum, mistake.surahId, mistake.ayahNum)
                          }
                          title="فتح هذه الآية في المصحف لتعديل العلامات وإعادة الالتقاط"
                          aria-label="عرض الآية في المصحف"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="reports-icon-mini-btn"
                          disabled={idx === 0}
                          onClick={() => moveCapturedMistake(mistake.id, -1)}
                          title="تحريك للأعلى"
                          aria-label="تحريك للأعلى"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="reports-icon-mini-btn"
                          disabled={idx === draft.mistakes.length - 1}
                          onClick={() => moveCapturedMistake(mistake.id, 1)}
                          title="تحريك للأسفل"
                          aria-label="تحريك للأسفل"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="reports-icon-mini-btn is-danger"
                          onClick={() => removeCapturedMistake(mistake.id)}
                          title="إزالة من التقرير"
                          aria-label="إزالة من التقرير"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="reports-editor-mistake-thumb">
                      <img
                        src={mistake.imageDataUrl}
                        alt={`سورة ${mistake.surahName} الآية ${mistake.ayahNum} مع علامات المعلم`}
                      />
                    </div>

                    <div className="reports-segmented-group is-compact" role="group" aria-label="تصنيف الملاحظة">
                      {CATEGORY_ORDER.map((cat) => {
                        const active = mistake.category === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            className={`reports-seg-btn is-cat-${cat} ${active ? 'is-active' : ''}`}
                            aria-pressed={active}
                            onClick={() => updateCapturedMistake(mistake.id, { category: cat })}
                          >
                            {MISTAKE_CATEGORY_LABELS[cat]}
                          </button>
                        );
                      })}
                    </div>

                    <input
                      type="text"
                      className="reports-input is-compact"
                      value={mistake.note}
                      onChange={(e) => updateCapturedMistake(mistake.id, { note: e.target.value })}
                      placeholder="ملاحظة المعلم على الموضع (اختياري)..."
                    />
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* 4. Next Session Assignments */}
          <div className="reports-form-section">
            <h2 className="reports-section-heading">المطلوب للحصة القادمة</h2>

            <div className="reports-fields-grid">
              <label className="reports-field is-full">
                <span className="reports-field-label">الحفظ الجديد المطلوب</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.nextHifz}
                  onChange={(e) => updateReportDraft({ nextHifz: e.target.value })}
                  placeholder="مثال: سورة المطففين من آية ١٨ إلى نهاية السورة"
                />
              </label>

              <label className="reports-field is-full">
                <span className="reports-field-label">المراجعة المطلوبة</span>
                <input
                  type="text"
                  className="reports-input"
                  value={draft.nextReview}
                  onChange={(e) => updateReportDraft({ nextReview: e.target.value })}
                  placeholder="مثال: مراجعة النصف الأول من سورة المطففين والتركيز على المواضع المحددة"
                />
              </label>

              <label className="reports-field is-full">
                <span className="reports-field-label">توجيه المعلم لولي الأمر والطالب</span>
                <textarea
                  className="reports-textarea"
                  rows={3}
                  value={draft.teacherNote}
                  onChange={(e) => updateReportDraft({ teacherNote: e.target.value })}
                  placeholder="توجيه مختصر حول طريقة المراجعة أو مواضع التشكيل التي تحتاج انتباهاً قبل الحصة القادمة..."
                />
              </label>
            </div>
          </div>

          {/* 5. Saved History Drawer */}
          {history.length > 0 && (
            <div className="reports-form-section">
              <button
                type="button"
                className="reports-history-toggle"
                aria-expanded={isHistoryOpen}
                onClick={() => setIsHistoryOpen((prev) => !prev)}
              >
                <span className="reports-history-toggle-label">
                  <History className="w-4 h-4" aria-hidden="true" />
                  <span>التقارير المحفوظة ({toArabicDigits(history.length)})</span>
                </span>
                <span>{isHistoryOpen ? 'إخفاء' : 'عرض'}</span>
              </button>

              {isHistoryOpen && (
                <div className="reports-history-list">
                  {history.map((item) => (
                    <div key={item.id} className="reports-history-item">
                      <button
                        type="button"
                        className="reports-history-load-btn"
                        onClick={() => loadReportFromHistory(item.id)}
                      >
                        <strong>{item.studentName.trim() || 'تقرير بدون اسم طالب'}</strong>
                        <span>
                          {item.surahSummary.trim() || 'بدون مقرر'} · {formatArabicReportDate(item.sessionDate)} ·{' '}
                          {toArabicDigits(item.mistakes.length)} مواضع
                        </span>
                      </button>
                      <button
                        type="button"
                        className="reports-icon-mini-btn is-danger"
                        onClick={() => deleteReportFromHistory(item.id)}
                        title="حذف من السجل"
                        aria-label="حذف التقرير من السجل"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Left Column: Live Print-Ready A4 Preview */}
        <section className="reports-preview-column" aria-label="معاينة التقرير">
          <div className="reports-preview-toolbar">
            <span>معاينة التقرير النهائي (A4)</span>
            <span>تظهر الآيات الملتقطة بنفس علامات المعلم تماماً</span>
          </div>

          <div className="reports-a4-scroll-wrap">
            <div ref={reportSheetRef} className="report-sheet-paper">
              <div className="report-sheet-top-rule" aria-hidden="true" />

              {/* Header */}
              <header className="report-sheet-header" data-report-block="true">
                <div className="report-sheet-brand-row">
                  <div className="report-sheet-brand">
                    <span className="report-sheet-emblem" aria-hidden="true">✦</span>
                    <span className="report-sheet-academy">{draft.academyTitle || 'منصة مَعَ السَّفَرَة'}</span>
                  </div>
                  <span className="report-sheet-date-inline">
                    التاريخ: {formatArabicReportDate(draft.sessionDate)}
                  </span>
                </div>

                <h2 className="report-sheet-title">تقرير متابعة حصة القرآن الكريم</h2>

                <div className="report-sheet-meta-grid">
                  <div className="report-meta-cell">
                    <span className="report-meta-label">الطالب</span>
                    <strong className="report-meta-value">
                      {draft.studentName.trim() || '—'}
                    </strong>
                  </div>
                  <div className="report-meta-cell">
                    <span className="report-meta-label">المقرر / السورة</span>
                    <strong className="report-meta-value">
                      {draft.surahSummary.trim() || '—'}
                    </strong>
                  </div>
                  <div className="report-meta-cell">
                    <span className="report-meta-label">التقييم العام</span>
                    <strong className={`report-meta-value is-rating-${draft.overallRating}`}>
                      {RATING_LABELS[draft.overallRating]}
                    </strong>
                  </div>
                  <div className="report-meta-cell">
                    <span className="report-meta-label">المعلم</span>
                    <strong className="report-meta-value">
                      {draft.teacherName.trim() || '—'}
                    </strong>
                  </div>
                </div>
              </header>

              {/* Today's Progress */}
              <section className="report-sheet-section" data-report-block="true">
                <h3 className="report-sheet-section-title">أولاً: ما تم إنجازه في الحصة</h3>
                <div className="report-sheet-two-col">
                  <div className="report-sheet-box">
                    <span className="report-sheet-box-label">الحفظ الجديد اليوم</span>
                    <p className="report-sheet-box-text">
                      {draft.newHifzToday.trim() || 'لم يُدوّن مقرر حفظ جديد لهذه الحصة'}
                    </p>
                  </div>
                  <div className="report-sheet-box">
                    <span className="report-sheet-box-label">المراجعة اليوم</span>
                    <p className="report-sheet-box-text">
                      {draft.reviewToday.trim() || 'لم يُدوّن مقرر مراجعة لهذه الحصة'}
                    </p>
                  </div>
                </div>
              </section>

              {/* Visual Ayah Mistakes */}
              <section className="report-sheet-section">
                <div className="report-sheet-section-head-line" data-report-block="true">
                  <h3 className="report-sheet-section-title">
                    ثانياً: مواضع تحتاج إلى تركيز ومراجعة
                  </h3>
                  <span className="report-sheet-count-inline">
                    {draft.mistakes.length > 0
                      ? `عدد المواضع: ${toArabicDigits(draft.mistakes.length)}`
                      : 'لا توجد أخطاء مسجلة'}
                  </span>
                </div>

                {draft.mistakes.length === 0 ? (
                  <div className="report-sheet-no-mistakes" data-report-block="true">
                    أتمّ الطالب التسميع دون تسجيل مواضع أخطاء في المصحف خلال هذه الحصة.
                  </div>
                ) : (
                  <div className="report-sheet-mistakes-stack">
                    {draft.mistakes.map((mistake, idx) => (
                      <article
                        key={mistake.id}
                        className="report-sheet-mistake-item"
                        data-report-block="true"
                      >
                        <div className="report-sheet-mistake-head">
                          <span className="report-sheet-mistake-ref">
                            {toArabicDigits(idx + 1)}. سورة {mistake.surahName} · الآية{' '}
                            {toArabicDigits(mistake.ayahNum)} · صفحة {toArabicDigits(mistake.pageNum)}
                          </span>
                          <span className={`report-sheet-mistake-tag is-cat-${mistake.category}`}>
                            {MISTAKE_CATEGORY_LABELS[mistake.category]}
                          </span>
                        </div>

                        <div className="report-sheet-mistake-visual">
                          <img
                            src={mistake.imageDataUrl}
                            alt={`سورة ${mistake.surahName} الآية ${mistake.ayahNum}`}
                          />
                        </div>

                        {mistake.note.trim() && (
                          <p className="report-sheet-mistake-note">
                            <strong>ملاحظة المعلم:</strong> {mistake.note.trim()}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {/* Next Session Plan */}
              <section className="report-sheet-section" data-report-block="true">
                <h3 className="report-sheet-section-title">ثالثاً: المطلوب للحصة القادمة</h3>
                <div className="report-sheet-two-col">
                  <div className="report-sheet-box">
                    <span className="report-sheet-box-label">الحفظ الجديد المطلوب</span>
                    <p className="report-sheet-box-text">
                      {draft.nextHifz.trim() || 'يُحدّد حسب خطة الحفظ'}
                    </p>
                  </div>
                  <div className="report-sheet-box">
                    <span className="report-sheet-box-label">المراجعة المطلوبة</span>
                    <p className="report-sheet-box-text">
                      {draft.nextReview.trim() || 'مراجعة ما سبق حفظه مع المواضع الموضّحة أعلاه'}
                    </p>
                  </div>
                </div>

                {draft.teacherNote.trim() && (
                  <div className="report-sheet-advice-box">
                    <span className="report-sheet-box-label">توجيه المعلم للطالب وولي الأمر</span>
                    <p className="report-sheet-box-text">{draft.teacherNote.trim()}</p>
                  </div>
                )}
              </section>

              <footer className="report-sheet-footer" data-report-block="true">
                <span>منصة مَعَ السَّفَرَة لتعليم القرآن الكريم والتجويد</span>
                <span>{formatArabicReportDate(draft.sessionDate)}</span>
              </footer>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default ReportsProgram;
