import React, { useEffect } from 'react';
import { MushafProgram } from '../MushafProgram';
import { useAnnotationActions } from '../annotation';
import { playChime, triggerConfetti } from '../../utils/feedbackEffects';

interface MushafViewProps {
  isPresentationMode: boolean;
  onTogglePresentationMode: () => void;
  onOpenReports?: () => void;
}

export const MushafView: React.FC<MushafViewProps> = ({
  isPresentationMode,
  onTogglePresentationMode,
  onOpenReports,
}) => {
  const { setFallbackSurfaceId } = useAnnotationActions();

  useEffect(() => {
    setFallbackSurfaceId('view:mushaf');
  }, [setFallbackSurfaceId]);

  return (
    <>
      <div className="unified-hero-pod is-mushaf-pod" id="mushaf-hero-pod">
        <section className="lesson-hero-title-area" id="mushaf-main-heading-area">
          <div className="lesson-title-badge-row">
            <span className="lesson-badge-category">
              <span className="badge-ornament-star">✦</span>
              <span className="badge-text-diacritics">برواية حفص عن عاصم</span>
              <span className="badge-ornament-star">✦</span>
            </span>
          </div>

          <h1 className="lesson-primary-heading">المصحف الشريف</h1>

          <div className="lesson-title-deco-line" aria-hidden="true">
            <span className="deco-line-half"></span>
            <span className="deco-rosette">✦</span>
            <span className="deco-line-half deco-line-r"></span>
          </div>
        </section>
      </div>

      <main id="mushaf-standalone-shell" aria-label="المصحف الشريف">
        <MushafProgram
          variant="standalone"
          initialTajweed={true}
          isPresentationMode={isPresentationMode}
          onTogglePresentationMode={onTogglePresentationMode}
          onPlayChime={playChime}
          onTriggerConfetti={triggerConfetti}
          onOpenReports={onOpenReports}
        />
      </main>
    </>
  );
};

export default MushafView;
