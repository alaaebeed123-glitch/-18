import React from 'react';
import { ArrowLeft, BookOpen, Check, ClipboardCheck, GraduationCap, Layers, PenTool, Users } from 'lucide-react';
import { prefetchReadingProgram } from '../reading/readingPrefetch';

export type AcademyProgramView = 'mushaf' | 'tajweed' | 'reading' | 'whiteboard' | 'reports' | 'students';

interface HomeGatewayProps {
  onNavigate: (view: AcademyProgramView) => void;
}

export const HomeGateway: React.FC<HomeGatewayProps> = ({ onNavigate }) => {
  return (
    <main id="platform-home">
      <section className="home-hero">
        <span className="home-hero-kicker">منصة مَعَ السَّفَرَة التعليمية</span>
        <h1 className="home-hero-title">اختر البرنامج الذي تريد البدء به</h1>
        <p className="home-hero-subtitle">
          ستة برامج تعليمية متكاملة: تصفّح المصحف الشريف برسمه العثماني وأحكامه الملونة، وتعلّم أحكام التجويد خطوةً بخطوة، وتدرّب على القراءة المنهجية، واشرح دروسك على السبورة التفاعلية، وتابع ملفات الطلاب وعلامات توقفهم، وأصدِر تقارير الحصص المصوّرة.
        </p>
      </section>

      <section className="home-programs-grid" aria-label="البرامج المتاحة">
        <button
          type="button"
          id="gateway-mushaf-card"
          className="home-program-card is-mushaf"
          onClick={() => onNavigate('mushaf')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <BookOpen className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">البرنامج الأول</span>
              <h2 className="home-card-title">المصحف الشريف</h2>
            </div>
          </div>

          <p className="home-card-desc">
            مصحف رقمي متكامل بـ ٦٠٤ صفحات بتوزيع مصحف المدينة المنورة، مع تلوين أحكام التجويد ووضع العرض المكبّر.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تلوين أحكام التجويد (مصحف مجوَّد) مع إمكانية التبديل</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>وضع ملء الشاشة المخصّص للبث والشرح المباشر أونلاين</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>انتقال فوري بالسورة والجزء ورقم الصفحة</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>افتح المصحف الشريف</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>

        <button
          type="button"
          id="gateway-tajweed-card"
          className="home-program-card is-tajweed"
          onClick={() => onNavigate('tajweed')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <GraduationCap className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">البرنامج الثاني</span>
              <h2 className="home-card-title">برنامج التجويد</h2>
            </div>
          </div>

          <p className="home-card-desc">
            منهج تفاعلي لأحكام التجويد يجمع بين الشرح المرئي للمخارج، التعرّف على الحروف، التدرّب في الكلمات، والتطبيق العملي داخل المصحف.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>أربعة أبواب شاملة: الحروف اللثوية، الغنة، القلقلة، والنون الساكنة</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تمارين تفاعلية ومنافسات زمنية وتصحيح فوري</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تطبيق مباشر على صفحات المصحف الشريف عند كل درس</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>ادخل إلى برنامج التجويد</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>

        <button
          type="button"
          id="gateway-reading-card"
          className="home-program-card is-reading"
          onMouseEnter={prefetchReadingProgram}
          onFocus={prefetchReadingProgram}
          onClick={() => onNavigate('reading')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <Layers className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">البرنامج الثالث</span>
              <h2 className="home-card-title">التدريب القرائي المنهجي</h2>
            </div>
          </div>

          <p className="home-card-desc">
            منصة تدريبية متدرّجة لتعليم القراءة العربية وإتقان الحركات والمدود والسكون والتنوين والشدة، مترابطة مع برنامج التجويد والمصحف.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تدرّج منهجي شامل: الفتح، الكسر، الضم، المدود، السكون، والتنوين</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تدريبات تأسيسية شاملة للحروف والسكون والمقاطع وكلمات منهج نور البيان</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>ربط مباشر مع دروس التجويد والتطبيق في المصحف الشريف</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>افتح التدريب القرائي</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>

        <button
          type="button"
          id="gateway-whiteboard-card"
          className="home-program-card is-whiteboard"
          onClick={() => onNavigate('whiteboard')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <PenTool className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">البرنامج الرابع</span>
              <h2 className="home-card-title">السبورة التفاعلية</h2>
            </div>
          </div>

          <p className="home-card-desc">
            سبورة شرح حرّة ومتعددة الصفحات للمعلمين في الدروس الشرعية، تجمع بين الكتابة بالقلم وإدراج الآيات والبطاقات النصية والقوالب الجاهزة.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>صفحات متعددة وخلفيات متنوّعة (بيضاء، مسطّرة، شبكة، ورق مصحف، خضراء)</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>دعم كامل لأدوات القلم والتظليل والليزر وشريط الإخفاء وحفظ PDF</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>بطاقات آيات قرآنية ونصوص قابلة للتحريك ورموز تشكيل سريعة</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>افتح السبورة التفاعلية</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>

        <button
          type="button"
          id="gateway-reports-card"
          className="home-program-card is-reports"
          onClick={() => onNavigate('reports')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <ClipboardCheck className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">البرنامج الخامس</span>
              <h2 className="home-card-title">تقارير الحصص والمتابعة</h2>
            </div>
          </div>

          <p className="home-card-desc">
            برنامج مستقل لإعداد تقارير الحصص بصيغة PDF، يلتقط الآيات التي أخطأ فيها الطالب من المصحف مباشرةً بنفس علامات وتحديدات المعلم، مع خطة الحصة القادمة.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>التقاط الآية من المصحف بضغطة واحدة مع علامات القلم والتظليل عليها</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>تدوين مقرر الحفظ والمراجعة اليومية والمطلوب للحصة القادمة وتوجيه المعلم</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>معاينة فورية بنسق A4 وتصدير PDF احترافي جاهز للإرسال لولي الأمر</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>افتح تقارير الحصص</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>

        <button
          type="button"
          id="gateway-students-card"
          className="home-program-card is-students"
          onClick={() => onNavigate('students')}
        >
          <div className="home-card-top">
            <span className="home-card-icon" aria-hidden="true">
              <Users className="w-7 h-7" strokeWidth={2.1} />
            </span>
            <div className="home-card-headings">
              <span className="home-card-kicker">المتابعة الشاملة</span>
              <h2 className="home-card-title">ملف الطالب</h2>
            </div>
          </div>

          <p className="home-card-desc">
            صفحة موحّدة لكل طالب تجمع مواضع توقفه في المصحف، ودرسه الحالي في التجويد والقراءة المنهجية، ولوحة السبورة المرتبطة به وسجل تقاريره.
          </p>

          <ul className="home-card-highlights">
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>مزامنة فورية لعلامات التوقف والحفظ والمراجعة من المصحف</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>انتقال بضغطة واحدة إلى موضع توقف الطالب في أي برنامج</span>
            </li>
            <li>
              <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              <span>عرض جميع تقارير الحصص المسجلة للطالب وبدء تقرير جديد</span>
            </li>
          </ul>

          <div className="home-card-footer">
            <span className="home-card-cta">
              <span>افتح ملفات الطلاب</span>
              <ArrowLeft className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />
            </span>
          </div>
        </button>
      </section>
    </main>
  );
};

export default HomeGateway;
