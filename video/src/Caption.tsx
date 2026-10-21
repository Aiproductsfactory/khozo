import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fontFor } from './fonts';
import type { Colours, LanguagePack } from './props';

/**
 * The line the viewer reads, in the primary language, with the secondary
 * language beneath. It rises in over half a second and stays.
 */
export const Caption: React.FC<{
  primary: { text: string; pack: LanguagePack };
  secondary?: { text: string; pack: LanguagePack } | null;
  colours: Colours;
  light?: boolean;
  size?: number;
  align?: 'center' | 'left';
  delay?: number;
}> = ({ primary, secondary = null, colours, light = false, size = 64, align = 'center', delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 120 } });
  const y = interpolate(t, [0, 1], [40, 0]);
  return (
    <div style={{ opacity: t, transform: `translateY(${y}px)`, textAlign: align, display: 'grid', gap: size * 0.3 }}>
      <div
        style={{
          fontFamily: fontFor(primary.pack.script),
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.3,
          color: light ? '#fff' : colours.ink,
          textWrap: 'balance',
        }}
      >
        {primary.text}
      </div>
      {secondary && (
        <div
          style={{
            fontFamily: fontFor(secondary.pack.script),
            fontWeight: 400,
            fontSize: size * 0.56,
            lineHeight: 1.4,
            color: light ? 'rgba(255,255,255,0.82)' : '#56616b',
            textWrap: 'balance',
          }}
        >
          {secondary.text}
        </div>
      )}
    </div>
  );
};
