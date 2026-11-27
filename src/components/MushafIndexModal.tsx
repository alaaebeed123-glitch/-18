import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Compass, Layers, Sparkles, X } from 'lucide-react';
import { toArabicDigits, type MushafDataset, type MushafSurahMeta } from '../utils/mushafData';
import { getOrBuildQuranIndex, normalizeSurahNameForMatch } from '../utils/quranIndexData';

type IndexTab = 'surahs' | 'juz' | 'hizb' | 'sajdah';
type SurahFilter = 'all' | 'makki' | 'madani';

interface MushafIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: MushafDataset | null;
  surahs: MushafSurahMeta[];
  currentPage: number;
  currentJozz: number;
  currentSurahId: number;
  onJumpToLocation: (pageNum: number, ayahKey?: string) => void;
}

export const MushafIndexModal: React.FC<MushafIndexModalProps> = ({
  isOpen,
  onClose,
  dataset,
  surahs,
  currentPage,
  currentJozz,
  currentSurahId,
  onJumpToLocation,
}) => {
  const [activeTab, setActiveTab] = useState<IndexTab>('surahs');
  const [surahQuery, setSurahQuery] = useState('');
  const [surahRevFilter, setSurahRevFilter] = useState<SurahFilter>('all');
  const [selectedJuzFilter, setSelectedJuzFilter] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const indexData = useMemo(() => {
    if (!isOpen || !dataset) return null;
    return getOrBuildQuranIndex(dataset);
  }, [isOpen, dataset]);

  const filteredSurahs = useMemo(() => {
    const normQ = normalizeSurahNameForMatch(surahQuery);
    return surahs.filter((s) => {
      if (surahRevFilter === 'makki' && s.rev !== 'مَكِّيَّةٌ') return false;
      if (surahRevFilter === 'madani' && s.rev !== 'مَدَنِيَّةٌ') return false;
      if (!normQ) return true;
      const sNorm = normalizeSurahNameForMatch(s.name);
      return sNorm.includes(normQ) || String(s.id) === surahQuery.trim();
    });
  }, [surahs, surahQuery, surahRevFilter]);

  const filteredQuarters = useMemo(() => {
    if (!indexData) return [];
    if (!selectedJuzFilter) return indexData.quarters;
    return indexData.quarters.filter((q) => q.jozz === selectedJuzFilter);
  }, [indexData, selectedJuzFilter]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="mushaf-modal-backdrop"
      dir="rtl"
      data-annotation-ui="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mushaf-index-card"
        role="dialog"
        aria-modal="true"
        aria-label="فهرس المصحف الشريف"
      >
        <header className="mushaf-index-header">
          <div className="mushaf-index-title-wrap">
            <BookOpen className="w-4 h-4 text-[#0035D1]" aria-hidden="true" />
            <h2 className="mushaf-index-title">فهرس المصحف الشريف</h2>
          </div>
          <button
            type="button"
            className="mushaf-modal-close-btn"
            onClick={onClose}
            aria-label="إغلاق الفهرس"
            title="إغلاق (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="mushaf-index-tabs" role="tablist" aria-label="أقسام الفهرس">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'surahs'}
            className={`mushaf-index-tab ${activeTab === 'surahs' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('surahs')}
          >
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            <span>السور ({toArabicDigits(surahs.length)})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'juz'}
            className={`mushaf-index-tab ${activeTab === 'juz' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('juz')}
          >
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
            <span>الأجزاء ({toArabicDigits(30)})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'hizb'}
            className={`mushaf-index-tab ${activeTab === 'hizb' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('hizb')}
          >
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            <span>الأحزاب والأرباع ({toArabicDigits(240)})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sajdah'}
            className={`mushaf-index-tab ${activeTab === 'sajdah' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('sajdah')}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>السجدات ({toArabicDigits(indexData?.sajdahs.length ?? 15)})</span>
          </button>
        </div>

        <div className="mushaf-index-body">
          {activeTab === 'surahs' && (
            <div className="mushaf-index-pane">
              <div className="mushaf-index-filters">
                <input
                  type="text"
                  className="mushaf-index-filter-input"
                  value={surahQuery}
                  onChange={(e) => setSurahQuery(e.target.value)}
                  placeholder="ابحث باسم السورة أو رقمها..."
                  aria-label="تصفية السور"
                />
                <div className="mushaf-index-filter-pills" role="group" aria-label="نوع السورة">
                  <button
                    type="button"
                    className={`mushaf-index-pill ${surahRevFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setSurahRevFilter('all')}
                  >
                    الكل
                  </button>
                  <button
                    type="button"
                    className={`mushaf-index-pill ${surahRevFilter === 'makki' ? 'is-active' : ''}`}
                    onClick={() => setSurahRevFilter('makki')}
                  >
                    مكية
                  </button>
                  <button
                    type="button"
                    className={`mushaf-index-pill ${surahRevFilter === 'madani' ? 'is-active' : ''}`}
                    onClick={() => setSurahRevFilter('madani')}
                  >
                    مدنية
                  </button>
                </div>
              </div>

              <div className="mushaf-index-grid is-surahs">
                {filteredSurahs.map((s) => {
                  const isCurrent = s.id === currentSurahId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`mushaf-index-item-card ${isCurrent ? 'is-current' : ''}`}
                      onClick={() => {
                        onJumpToLocation(s.startPage, `${s.id}:1`);
                        onClose();
                      }}
                    >
                      <span className="mushaf-index-num-badge">{toArabicDigits(s.id)}</span>
                      <div className="mushaf-index-item-info">
                        <span className="mushaf-index-item-name">سورة {s.name}</span>
                        <span className="mushaf-index-item-sub">
                          {s.rev} · {toArabicDigits(s.totalAyat)} آية
                        </span>
                      </div>
                      <span className="mushaf-index-page-tag">ص {toArabicDigits(s.startPage)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'juz' && (
            <div className="mushaf-index-pane">
              {indexData ? (
                <div className="mushaf-index-grid is-juz">
                  {indexData.juzSummaries.map((j) => {
                    const isCurrent = j.jozz === currentJozz;
                    return (
                      <button
                        key={j.jozz}
                        type="button"
                        className={`mushaf-index-item-card ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {
                          onJumpToLocation(j.pageNum, j.ayahKey);
                          onClose();
                        }}
                      >
                        <span className="mushaf-index-num-badge">{toArabicDigits(j.jozz)}</span>
                        <div className="mushaf-index-item-info">
                          <span className="mushaf-index-item-name">
                            الجزء {toArabicDigits(j.jozz)} · {j.surahName} ({toArabicDigits(j.ayahNum)})
                          </span>
                          <span className="mushaf-index-item-snippet">{j.snippet}</span>
                        </div>
                        <span className="mushaf-index-page-tag">ص {toArabicDigits(j.pageNum)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mushaf-index-loading">جارٍ تحميل بيانات الأجزاء...</p>
              )}
            </div>
          )}

          {activeTab === 'hizb' && (
            <div className="mushaf-index-pane">
              {indexData ? (
                <>
                  <div className="mushaf-index-filters">
                    <label className="mushaf-index-juz-filter">
                      <span>تصفية بالجزء:</span>
                      <select
                        value={selectedJuzFilter}
                        onChange={(e) => setSelectedJuzFilter(Number(e.target.value))}
                      >
                        <option value={0}>كل الأجزاء ({toArabicDigits(30)})</option>
                        {Array.from({ length: 30 }, (_, idx) => idx + 1).map((j) => (
                          <option key={j} value={j}>
                            الجزء {toArabicDigits(j)} (حزب {toArabicDigits(j * 2 - 1)}–{toArabicDigits(j * 2)})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mushaf-index-list">
                    {filteredQuarters.map((q) => {
                      const isCurrent = q.pageNum === currentPage;
                      return (
                        <button
                          key={q.quarterNumber}
                          type="button"
                          className={`mushaf-index-row-card ${isCurrent ? 'is-current' : ''} ${
                            q.kind === 'hizb' ? 'is-hizb-head' : ''
                          }`}
                          onClick={() => {
                            onJumpToLocation(q.pageNum, q.ayahKey);
                            onClose();
                          }}
                        >
                          <span className="mushaf-index-ornament-symbol" aria-hidden="true">۞</span>
                          <div className="mushaf-index-item-info">
                            <span className="mushaf-index-item-name">
                              {q.kindLabel} {toArabicDigits(q.hizbNum)} · سورة {q.surahName} ({toArabicDigits(q.ayahNum)})
                            </span>
                            <span className="mushaf-index-item-snippet">{q.snippet}</span>
                          </div>
                          <span className="mushaf-index-page-tag">ص {toArabicDigits(q.pageNum)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="mushaf-index-loading">جارٍ تحميل الأرباع والأحزاب...</p>
              )}
            </div>
          )}

          {activeTab === 'sajdah' && (
            <div className="mushaf-index-pane">
              {indexData ? (
                <div className="mushaf-index-list">
                  {indexData.sajdahs.map((s) => {
                    const isCurrent = s.pageNum === currentPage;
                    return (
                      <button
                        key={s.ayahKey}
                        type="button"
                        className={`mushaf-index-row-card ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {
                          onJumpToLocation(s.pageNum, s.ayahKey);
                          onClose();
                        }}
                      >
                        <span className="mushaf-index-sajdah-symbol" aria-hidden="true">۩</span>
                        <div className="mushaf-index-item-info">
                          <span className="mushaf-index-item-name">
                            السجدة {toArabicDigits(s.index)} · سورة {s.surahName} (الآية {toArabicDigits(s.ayahNum)})
                          </span>
                          <span className="mushaf-index-item-snippet">{s.snippet}</span>
                        </div>
                        <span className="mushaf-index-page-tag">
                          الجزء {toArabicDigits(s.jozz)} · ص {toArabicDigits(s.pageNum)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mushaf-index-loading">جارٍ تحميل مواضع السجدات...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
