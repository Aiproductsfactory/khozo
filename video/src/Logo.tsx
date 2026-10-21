import React from 'react';
import { LATIN, fontFor } from './fonts';
import type { Colours } from './props';

/** The hand in the Khozo tile, as on khozo.org (web/public/icons/icon.svg). */
export const HAND = 'M12 2a1 1 0 0 1 1 1v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6.3-3.9L3 16.2A1.5 1.5 0 0 1 5.4 14.4L7 16V5a1 1 0 1 1 2 0v6h1V3a1 1 0 0 1 1-1z';

export const Tile: React.FC<{ size: number; colours: Colours }> = ({ size, colours }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.2,
      background: colours.brand,
      display: 'grid',
      placeItems: 'center',
      flex: 'none',
    }}
  >
    <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="#fff">
      <path d={HAND} />
    </svg>
  </div>
);

/** The tile with the name in English and in the primary script. */
export const Logo: React.FC<{ size: number; colours: Colours; light?: boolean; localName?: { text: string; script: 'latin' | 'gujarati' | 'devanagari' } | null }> = ({
  size,
  colours,
  light = false,
  localName = null,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
    <Tile size={size} colours={colours} />
    <div style={{ display: 'grid', lineHeight: 1 }}>
      <span style={{ fontFamily: LATIN, fontWeight: 800, fontSize: size * 0.56, letterSpacing: -0.5, color: light ? '#fff' : colours.ink }}>KHOZO</span>
      {localName && (
        <span style={{ fontFamily: fontFor(localName.script), fontWeight: 700, fontSize: size * 0.34, marginTop: size * 0.08, color: light ? 'rgba(255,255,255,0.8)' : colours.brand }}>
          {localName.text}
        </span>
      )}
    </div>
  </div>
);
