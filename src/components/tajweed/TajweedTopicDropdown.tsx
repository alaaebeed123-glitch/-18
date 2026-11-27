import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { TAJWEED_TOPICS } from './tajweedConfig';
import { playTabSwitch } from '../../utils/feedbackEffects';

interface TajweedTopicDropdownProps {
  currentTopic: string;
  onSelectTopic: (topicId: string) => void;
}

export const TajweedTopicDropdown: React.FC<TajweedTopicDropdownProps> = ({
  currentTopic,
  onSelectTopic,
}) => {
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTopicDropdownOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTopicDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="topic-switcher-container" ref={dropdownRef}>
      <button
        type="button"
        id="topic-selector-btn"
        className={`topic-switcher-btn ${topicDropdownOpen ? 'is-open' : ''}`}
        onClick={() => setTopicDropdownOpen((prev) => !prev)}
        aria-expanded={topicDropdownOpen}
        aria-haspopup="menu"
      >
        <span className="topic-switcher-text">أبواب التجويد</span>
        <ChevronDown
          className={`topic-switcher-chevron ${topicDropdownOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {topicDropdownOpen && (
          <motion.div
            initial="closed"
            animate="open"
            exit="closed"
            variants={{
              closed: {
                opacity: 0,
                y: -12,
                scale: 0.93,
                transition: {
                  duration: 0.14,
                  ease: [0.4, 0, 1, 1],
                },
              },
              open: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  type: 'spring',
                  stiffness: 430,
                  damping: 28,
                  mass: 0.78,
                  staggerChildren: 0.025,
                  delayChildren: 0.025,
                },
              },
            }}
            style={{ transformOrigin: 'top left' }}
            className="topic-dropdown-wrapper"
            role="menu"
            aria-label="فهرس أبواب التجويد"
          >
            <span className="topic-dropdown-caret" aria-hidden="true" />

            <div className="topic-dropdown-menu">
              <span className="topic-dropdown-top-rim" aria-hidden="true" />

              <div className="topic-dropdown-list">
                {TAJWEED_TOPICS.map((topic) => {
                  const isSelected = topic.id === currentTopic;
                  return (
                    <motion.button
                      key={topic.id}
                      type="button"
                      role="menuitem"
                      variants={{
                        closed: {
                          opacity: 0,
                          y: -5,
                          transition: { duration: 0.09 },
                        },
                        open: {
                          opacity: 1,
                          y: 0,
                          transition: {
                            duration: 0.2,
                            ease: [0.16, 1, 0.3, 1],
                          },
                        },
                      }}
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
                        e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
                      }}
                      className={`topic-dropdown-item ${isSelected ? 'is-active' : ''}`}
                      onClick={() => {
                        onSelectTopic(topic.id);
                        setTopicDropdownOpen(false);
                        playTabSwitch();
                      }}
                    >
                      <div className="topic-dropdown-item-inner">
                        <span className="topic-dropdown-title truncate">{topic.title}</span>
                        {isSelected && (
                          <span className="topic-dropdown-check" aria-label="الدرس الحالي">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
