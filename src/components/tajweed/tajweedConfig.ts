import type { Variants } from 'motion/react';

export type TajweedTabId = 'explain' | 'letters' | 'words' | 'apply';

export const TAJWEED_TAB_ORDER: readonly TajweedTabId[] = [
  'explain',
  'letters',
  'words',
  'apply',
];

export const TAJWEED_TOPICS = [
  { id: 'lathawiya', title: 'الحروف اللثوية', lessonNum: 'الدرس الأول', active: true },
  { id: 'noon_meem', title: 'النون والميم المشددتان', lessonNum: 'الدرس الثاني', active: true },
  { id: 'qalqalah', title: 'حروف القلقلة (قطب جد)', lessonNum: 'الدرس الثالث', active: true },
  { id: 'noon_sakinah', title: 'أحكام النون الساكنة والتنوين', lessonNum: 'الدرس الرابع', active: true },
];

export const TAJWEED_TABS_CONFIG: ReadonlyArray<{ id: TajweedTabId; title: string; num: string }> = [
  { id: 'explain', title: 'الشرح', num: '١' },
  { id: 'letters', title: 'تعرّف على الحروف', num: '٢' },
  { id: 'words', title: 'تدرّب في كلمات', num: '٣' },
  { id: 'apply', title: 'طبّق في القرآن', num: '٤' },
];

export const LATHAWIYA_TARGETS = ['ث', 'ذ', 'ظ'];

export const LATHAWIYA_LETTER_POOL = [
  'ث', 'ت', 'ط', 'د', 'ذ', 'ز', 'س', 'ظ', 'ص', 'ض', 'ر', 'ل', 'ن', 'هـ',
];

export const panelVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 24 : -24,
    opacity: 0,
    scale: 0.992,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.28,
      ease: [0.22, 1, 0.36, 1] as const,
      staggerChildren: 0.035,
      delayChildren: 0.015,
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -18 : 18,
    opacity: 0,
    scale: 0.992,
    transition: {
      duration: 0.16,
      ease: [0.4, 0, 1, 1] as const,
    },
  }),
};

export const staggerItemVariants: Variants = {
  enter: {
    opacity: 0,
    y: 10,
  },
  center: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.26,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.12,
      ease: 'easeIn' as const,
    },
  },
};
