import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * One scene: a picture and a caption. Upright (phone) video stacks the caption
 * under the picture; wide video puts the picture on the left and the caption
 * on the right. Scenes fade in and out over a third of a second.
 */
export const Scene: React.FC<{
  background: string;
  picture: React.ReactNode;
  caption: React.ReactNode;
  footer?: React.ReactNode;
  durationInFrames: number;
}> = ({ background, picture, caption, footer = null, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fade = Math.round(fps / 3);
  const opacity = interpolate(frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const upright = height > width;
  const pad = Math.round(width * (upright ? 0.08 : 0.06));
  return (
    <AbsoluteFill style={{ background, opacity }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: pad,
          display: 'flex',
          flexDirection: upright ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: pad,
        }}
      >
        <div style={{ flex: upright ? '0 0 auto' : '0 0 46%', width: upright ? '100%' : undefined, display: 'grid', placeItems: 'center' }}>{picture}</div>
        <div style={{ flex: upright ? '0 0 auto' : '1 1 0', width: upright ? '100%' : undefined, display: 'grid', alignContent: 'center' }}>{caption}</div>
      </div>
      {footer && <div style={{ position: 'absolute', left: pad, right: pad, bottom: pad * 0.7 }}>{footer}</div>}
    </AbsoluteFill>
  );
};
