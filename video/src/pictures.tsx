// The pictures in each scene: shapes, never a real face. The video must not
// show a child, a missing person or anyone who could be taken for one.
import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { LATIN } from './fonts';
import { HAND } from './Logo';
import type { Colours } from './props';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** A small figure standing alone on a platform at dusk. */
export const Platform: React.FC<{ size: number; colours: Colours }> = ({ size, colours }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sway = Math.sin(frame / fps) * 3;
  const glow = interpolate(frame, [0, fps * 2], [0.2, 0.55], clamp);
  const w = size;
  const h = size * 0.75;
  return (
    <svg viewBox="0 0 400 300" width={w} height={h}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2a3a" />
          <stop offset="1" stopColor="#4a4d6a" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" rx="24" fill="url(#sky)" />
      {/* lamps */}
      {[70, 200, 330].map((x) => (
        <g key={x}>
          <rect x={x - 2} y="60" width="4" height="150" fill="#2b3545" />
          <circle cx={x} cy="60" r="10" fill="#ffd27a" opacity={glow} />
          <ellipse cx={x} cy="212" rx="60" ry="10" fill="#ffd27a" opacity={glow * 0.35} />
        </g>
      ))}
      {/* platform */}
      <rect x="0" y="210" width="400" height="90" fill="#2d3340" />
      <rect x="0" y="210" width="400" height="6" fill="#f2d16b" opacity="0.8" />
      {/* a child alone */}
      <g transform={`translate(${200 + sway} 150)`}>
        <circle cx="0" cy="0" r="14" fill="#0e1520" />
        <path d="M-16 60V28a16 16 0 0 1 32 0v32z" fill="#0e1520" />
        <rect x="-12" y="58" width="9" height="20" fill="#0e1520" />
        <rect x="3" y="58" width="9" height="20" fill="#0e1520" />
      </g>
      <text x="200" y="285" textAnchor="middle" fontFamily={LATIN} fontSize="13" fill="#9aa5b5">a child alone, late in the evening</text>
    </svg>
  );
};

/** A phone with the emergency number, ringing. */
export const EmergencyPhone: React.FC<{ size: number; colours: Colours; emergency: string }> = ({ size, colours, emergency }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = (Math.sin((frame / fps) * Math.PI * 2) + 1) / 2;
  const w = size * 0.56;
  const h = size;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: -w * (0.12 + i * 0.12) * (0.5 + pulse),
            borderRadius: w * 0.3,
            border: `${w * 0.02}px solid ${colours.warn}`,
            opacity: (1 - pulse) * (i ? 0.25 : 0.5),
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: w * 0.14,
          background: '#15191d',
          padding: w * 0.05,
          display: 'flex',
        }}
      >
        <div style={{ flex: 1, borderRadius: w * 0.1, background: colours.warn, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: LATIN }}>
          <div style={{ textAlign: 'center', display: 'grid', gap: w * 0.04 }}>
            <svg viewBox="0 0 24 24" width={w * 0.3} height={w * 0.3} fill="#fff" style={{ margin: '0 auto' }}>
              <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
            </svg>
            <div style={{ fontSize: w * 0.34, fontWeight: 800, lineHeight: 1 }}>{emergency}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** The report form on a phone: a photo (no face), a place, a Send button that is pressed. */
export const ReportPhone: React.FC<{ size: number; colours: Colours; url: string; pressAt: number }> = ({ size, colours, url, pressAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const w = size * 0.56;
  const h = size;
  const press = spring({ frame: frame - pressAt, fps, config: { damping: 14, stiffness: 300 } });
  const scale = 1 - 0.08 * Math.sin(Math.min(1, press) * Math.PI);
  const sent = frame > pressAt + fps * 0.4;
  const row = (label: string, filled: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: w * 0.04, padding: `${w * 0.035}px ${w * 0.05}px`, borderRadius: w * 0.04, background: '#fff', border: `${w * 0.006}px solid #d8dfd2` }}>
      <div style={{ width: w * 0.06, height: w * 0.06, borderRadius: '50%', background: filled ? colours.brand : '#d8dfd2', flex: 'none' }} />
      <div style={{ fontFamily: LATIN, fontSize: w * 0.052, color: colours.ink, fontWeight: 600 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ width: w, height: h, borderRadius: w * 0.14, background: '#15191d', padding: w * 0.05, display: 'flex' }}>
      <div style={{ flex: 1, borderRadius: w * 0.1, background: colours.paper, overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: LATIN }}>
        <div style={{ background: colours.brand, color: '#fff', padding: `${w * 0.06}px ${w * 0.07}px`, display: 'flex', alignItems: 'center', gap: w * 0.04 }}>
          <svg viewBox="0 0 24 24" width={w * 0.09} height={w * 0.09} fill="#fff"><path d={HAND} /></svg>
          <span style={{ fontWeight: 800, fontSize: w * 0.06 }}>{url}</span>
        </div>
        <div style={{ padding: w * 0.07, display: 'grid', gap: w * 0.05, flex: 1 }}>
          {/* the photo: a figure, never a face */}
          <div style={{ height: w * 0.62, borderRadius: w * 0.05, background: '#cfd6cb', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            <svg viewBox="0 0 100 70" width="100%" height="100%">
              <rect width="100" height="70" fill="#b9c2b4" />
              <rect y="48" width="100" height="22" fill="#9aa495" />
              <circle cx="50" cy="26" r="7" fill="#5c6660" />
              <path d="M40 56V40a10 10 0 0 1 20 0v16z" fill="#5c6660" />
            </svg>
          </div>
          {row('Photo added', true)}
          {row('Near Platform 4', true)}
          {row('Your name (optional)', false)}
          <div style={{ marginTop: 'auto' }}>
            <div
              style={{
                transform: `scale(${scale})`,
                background: sent ? colours.deep : colours.brand,
                color: '#fff',
                borderRadius: w * 0.05,
                padding: `${w * 0.05}px`,
                textAlign: 'center',
                fontWeight: 800,
                fontSize: w * 0.06,
              }}
            >
              {sent ? 'Sent to the police ✓' : 'Send to the police'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** A photo card travelling from the phone to a shield with a lock, and nowhere else. */
export const Journey: React.FC<{ size: number; colours: Colours }> = ({ size, colours }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(frame, [fps * 0.3, fps * 1.8], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const arrive = spring({ frame: frame - fps * 1.8, fps, config: { damping: 12, stiffness: 200 } });
  const lock = interpolate(frame, [fps * 2.2, fps * 2.8], [0, 1], clamp);
  const w = size;
  const h = size * 0.5;
  const x = interpolate(t, [0, 1], [70, 330]);
  const y = 95 - Math.sin(t * Math.PI) * 45;
  return (
    <svg viewBox="0 0 400 200" width={w} height={h}>
      {/* the phone it leaves */}
      <rect x="40" y="60" width="60" height="110" rx="10" fill="#15191d" />
      <rect x="47" y="70" width="46" height="90" rx="6" fill={colours.paper} />
      {/* the path */}
      <path d="M100 95 Q 200 10 330 95" fill="none" stroke={colours.brand} strokeWidth="3" strokeDasharray="8 8" opacity="0.5" />
      {/* the shield */}
      <g transform={`translate(330 95) scale(${0.9 + arrive * 0.1})`}>
        <path d="M0 -58 L44 -42 V-10 C44 20 24 42 0 54 C-24 42 -44 20 -44 -10 V-42 Z" fill={colours.deep} />
        <g opacity={lock}>
          <rect x="-16" y="-8" width="32" height="26" rx="4" fill="#fff" />
          <path d="M-9 -8v-8a9 9 0 0 1 18 0v8" fill="none" stroke="#fff" strokeWidth="4" />
        </g>
        <text y="80" textAnchor="middle" fontFamily={LATIN} fontSize="13" fontWeight="700" fill={colours.deep}>THE POLICE</text>
      </g>
      {/* the photo in flight */}
      <g transform={`translate(${x} ${y}) rotate(${t * 20})`} opacity={1 - arrive * 0.9}>
        <rect x="-18" y="-14" width="36" height="28" rx="4" fill="#fff" stroke={colours.brand} strokeWidth="2" />
        <circle cx="0" cy="-3" r="5" fill="#9aa495" />
        <path d="M-8 10V4a8 8 0 0 1 16 0v6z" fill="#9aa495" />
      </g>
      {/* where it does not go */}
      {[{ x: 150, y: 160 }, { x: 230, y: 160 }].map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`} opacity={0.5}>
          <rect x="-26" y="-14" width="52" height="28" rx="14" fill="#cfd6cb" />
          <line x1="-30" y1="18" x2="30" y2="-18" stroke={colours.warn} strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
      <text x="190" y="195" textAnchor="middle" fontFamily={LATIN} fontSize="12" fill="#56616b">not to groups, not to anyone else</text>
    </svg>
  );
};

/** A chat bubble with a forward arrow, crossed out. */
export const NoForward: React.FC<{ size: number; colours: Colours }> = ({ size, colours }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cross = interpolate(frame, [fps * 0.4, fps * 0.9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const shake = frame > fps * 0.9 && frame < fps * 1.3 ? Math.sin(frame * 2) * 4 : 0;
  const w = size;
  const h = size * 0.7;
  return (
    <svg viewBox="0 0 300 210" width={w} height={h}>
      <g transform={`translate(${shake} 0)`}>
        {/* a chat bubble with a photo in it */}
        <path d="M30 30h190a16 16 0 0 1 16 16v90a16 16 0 0 1-16 16H90l-40 30v-30H30a16 16 0 0 1-16-16V46a16 16 0 0 1 16-16z" fill="#fff" stroke="#cfd6cb" strokeWidth="3" />
        <rect x="40" y="48" width="90" height="70" rx="6" fill="#b9c2b4" />
        <circle cx="85" cy="74" r="9" fill="#5c6660" />
        <path d="M70 112V96a15 15 0 0 1 30 0v16z" fill="#5c6660" />
        <text x="140" y="70" fontFamily={LATIN} fontSize="13" fill="#56616b">Forwarded</text>
        {/* the forward arrow */}
        <path d="M150 110 l40 -22 v12 q30 -2 48 24 q-22 -14 -48 -8 v12 z" fill="#56616b" />
      </g>
      {/* the cross */}
      <g stroke={colours.warn} strokeWidth="14" strokeLinecap="round" fill="none">
        <line x1="40" y1="40" x2={40 + 220 * cross} y2={40 + 130 * cross} />
        <line x1="260" y1="40" x2={260 - 220 * cross} y2={40 + 130 * cross} />
      </g>
    </svg>
  );
};
