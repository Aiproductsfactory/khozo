import React from 'react';
import { Composition } from 'remotion';
import { Explainer, TOTAL_SECONDS } from './Explainer';
import { AHMEDABAD } from './props';

const FPS = 30;

/**
 * Two cuts of the same video. "Vertical" is for phones: WhatsApp Status,
 * Instagram Reels, YouTube Shorts. "Landscape" is for cinema slides, YouTube
 * and screens at stations. Both take the same props (README).
 */
export const Root: React.FC = () => (
  <>
    <Composition
      id="Vertical"
      component={Explainer}
      durationInFrames={TOTAL_SECONDS * FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={AHMEDABAD}
    />
    <Composition
      id="Landscape"
      component={Explainer}
      durationInFrames={TOTAL_SECONDS * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={AHMEDABAD}
    />
  </>
);
