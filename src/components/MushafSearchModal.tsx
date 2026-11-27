import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Compass, FileText, Hash, Search, X } from 'lucide-react';
import { toArabicDigits, type MushafDataset, type MushafSurahMeta } from '../utils/mushafData';
import { searchQuranIndex, type QuranSearchResult } from '../utils/quranIndexData';

interface MushafSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: MushafDataset | null;
  surahs: MushafSurahMeta[];
  onSelectResult: (result: QuranSearchResult) => void;
}

const QUICK_SEARCH_EXAMPLES = [
  'البقرة 255',
  '18:10',
  'ص 500',
  'جزء 30',
  'حزب 59',
  'الحمد لله',
];

export const MushafSearchModal: React.FC<MushafSearchModalProps> = ({
  isOpen,
  onClose,
  dataset,
  surahs,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveIdx(0);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  const results = useMemo(() => {
    if (!isOpen || !dataset || !query.trim()) return [];
    return searchQuranIndex(query, dataset, surahs, 40);
  }, [isOpen, dataset, surahs, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' && results.length > 0) {
        e.preventDefault();
        setActiveIdx((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp' && results.length > 0) {
        e.preventDefault();
        setActiveIdx((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        const chosen = results[activeIdx] ?? results[0];
        if (chosen) {
          onSelectResult(chosen);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, results, activeIdx, onSelectResult, onClose]);

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
        className="mushaf-search-card"
        role="dialog"
        aria-modal="true"
        aria-label="البحث الفوري في القرآن الكريم"
      >
        <header className="mushaf-search-header">
          <div className="mushaf-search-input-wrap">
            <Search className="mushaf-search-icon w-4 h-4" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="mushaf-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بكلمة أو آية، أو اكتب: البقرة ٢٥٥ · ٢:٢٥٥ · ص ٥٠٠ · جزء ٣٠"
              aria-label="عبارة البحث في القرآن الكريم"
            />
            {query && (
              <button
                type="button"
                className="mushaf-search-clear-btn"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="مسح البحث"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            className="mushaf-modal-close-btn"
            onClick={onClose}
            aria-label="إغلاق نافذة البحث"
            title="إغلاق (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {!query.trim() ? (
          <div className="mushaf-search-empty-state">
            <p className="mushaf-search-hint-title">انتقال وبحث فوري بدون الحاجة للتشكيل:</p>
            <div className="mushaf-search-examples">
              {QUICK_SEARCH_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="mushaf-search-example-btn"
                  onClick={() => setQuery(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="mushaf-search-tips-grid">
              <div className="mushaf-search-tip-item">
                <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>رقم الصفحة: <strong>ص ٢٥٥</strong> أو <strong>٢٥٥</strong></span>
              </div>
              <div className="mushaf-search-tip-item">
                <Hash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>سورة وآية: <strong>البقرة ٢٥٥</strong> أو <strong>٢:٢٥٥</strong></span>
              </div>
              <div className="mushaf-search-tip-item">
                <Compass className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>جزء أو حزب: <strong>جزء ٣٠</strong> أو <strong>حزب ٥٩</strong></span>
              </div>
              <div className="mushaf-search-tip-item">
                <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>بحث نصي: اكتب أي مقطع من الآية</span>
              </div>
            </div>
          </div>
        ) : !dataset ? (
          <div className="mushaf-search-empty-state">
            <p className="mushaf-search-hint-title">جارٍ تجهيز فهرس القرآن الكريم...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="mushaf-search-empty-state">
            <p className="mushaf-search-hint-title">لا توجد نتائج مطابقة لعبارة «{query}»</p>
            <p className="mushaf-search-sub-hint">جرّب كتابة كلمة أقصر أو رقم الصفحة أو اسم السورة ورقم الآية.</p>
          </div>
        ) : (
          <div className="mushaf-search-results" role="listbox" aria-label="نتائج البحث">
            <div className="mushaf-search-count-bar">
              <span>{toArabicDigits(results.length)} نتيجة مطابقة</span>
              <span className="mushaf-search-kbd-hint">↵ للانتقال · ↑↓ للتنقل</span>
            </div>
            {results.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === activeIdx}
                className={`mushaf-search-result-row ${idx === activeIdx ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  onSelectResult(item);
                  onClose();
                }}
              >
                <div className="mushaf-search-result-top">
                  <span className="mushaf-search-result-title">{item.title}</span>
                  <span className="mushaf-search-result-meta">{item.subtitle}</span>
                </div>
                {item.snippet && (
                  <p className="mushaf-search-result-snippet">{item.snippet}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
