export type WhiteboardBackground =
  | 'plain'
  | 'ruled'
  | 'grid'
  | 'parchment'
  | 'chalkboard';

export type WhiteboardCardVariant = 'note' | 'ayah' | 'heading' | 'transparent';

export interface WhiteboardCard {
  id: string;
  text: string;
  /** Horizontal position in % from left (0..88) */
  xPct: number;
  /** Vertical position in % from top (0..85) */
  yPct: number;
  /** Width in % of board (16..88) */
  widthPct: number;
  fontSizePx: number;
  variant: WhiteboardCardVariant;
  align: 'right' | 'center';
}

export interface WhiteboardPage {
  id: string;
  title: string;
  background: WhiteboardBackground;
  cards: WhiteboardCard[];
  createdAt: number;
}

export interface WhiteboardPersistedState {
  activePageId: string;
  pages: WhiteboardPage[];
}

export const WHITEBOARD_BACKGROUNDS: Array<{
  id: WhiteboardBackground;
  label: string;
  previewClass: string;
  isDark?: boolean;
}> = [
  { id: 'plain', label: 'بيضاء', previewClass: 'bg-white border-slate-300' },
  { id: 'ruled', label: 'مسطّرة', previewClass: 'bg-sky-50 border-sky-300' },
  { id: 'grid', label: 'شبكة', previewClass: 'bg-slate-50 border-slate-300' },
  { id: 'parchment', label: 'ورق مصحف', previewClass: 'bg-amber-50 border-amber-300' },
  { id: 'chalkboard', label: 'خضراء داكنة', previewClass: 'bg-emerald-950 border-emerald-700', isDark: true },
];

export const WHITEBOARD_QUICK_SYMBOLS: Array<{ label: string; insert: string; title: string }> = [
  { label: '﴿ ﴾', insert: '﴿  ﴾', title: 'قوسا الآية القرآنية' },
  { label: 'ﷺ', insert: ' ﷺ ', title: 'صلى الله عليه وسلم' },
  { label: '۞', insert: ' ۞ ', title: 'زخرفة قرآنية' },
  { label: 'ـَ', insert: 'َ', title: 'فتحة' },
  { label: 'ـِ', insert: 'ِ', title: 'كسرة' },
  { label: 'ـُ', insert: 'ُ', title: 'ضمة' },
  { label: 'ـْ', insert: 'ْ', title: 'سكون' },
  { label: 'ـّ', insert: 'ّ', title: 'شدة' },
  { label: 'ـً', insert: 'ً', title: 'تنوين فتح' },
];

export const WHITEBOARD_TEMPLATES: Array<{
  id: string;
  label: string;
  cards: Array<Omit<WhiteboardCard, 'id'>>;
}> = [
  {
    id: 'lesson-header',
    label: 'عنوان درس شرعي',
    cards: [
      {
        text: 'عنوان الدرس: أحكام التلاوة والآداب الشرعية',
        xPct: 16,
        yPct: 6,
        widthPct: 68,
        fontSizePx: 26,
        variant: 'heading',
        align: 'center',
      },
      {
        text: '١- التعريف والضابط\n٢- الأمثلة التطبيقية\n٣- التنبيهات العملية',
        xPct: 54,
        yPct: 24,
        widthPct: 38,
        fontSizePx: 20,
        variant: 'note',
        align: 'right',
      },
    ],
  },
  {
    id: 'ayah-card',
    label: 'بطاقة آية قرآنية',
    cards: [
      {
        text: '﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾',
        xPct: 18,
        yPct: 14,
        widthPct: 64,
        fontSizePx: 30,
        variant: 'ayah',
        align: 'center',
      },
    ],
  },
  {
    id: 'comparison',
    label: 'مقارنة عمودين',
    cards: [
      {
        text: 'الحكم الأول:\n• الضابط:\n• المثال:',
        xPct: 53,
        yPct: 18,
        widthPct: 40,
        fontSizePx: 20,
        variant: 'note',
        align: 'right',
      },
      {
        text: 'الحكم الثاني:\n• الضابط:\n• المثال:',
        xPct: 7,
        yPct: 18,
        widthPct: 40,
        fontSizePx: 20,
        variant: 'note',
        align: 'right',
      },
    ],
  },
];
