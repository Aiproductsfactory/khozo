import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Caption } from './Caption';
import { LATIN, fontFor } from './fonts';
import { Logo } from './Logo';
import { EmergencyPhone, Journey, NoForward, Platform, ReportPhone } from './pictures';
import { KHOZO_COLOURS, fill, type Colours, type ExplainerProps, type LanguagePack } from './props';
import { Scene } from './Scene';

/** Seconds per scene, in order. The total is the composition's length. */
export const SCENES = { see: 4, danger: 4, send: 5, onlyPolice: 4, dontForward: 3, motto: 5 } as const;
export const TOTAL_SECONDS = Object.values(SCENES).reduce((a, b) => a + b, 0);

const Helplines: React.FC<{ props: ExplainerProps; colours: Colours; light?: boolean; size: number }> = ({ props, colours, light = false, size }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: size * 0.5, fontFamily: LATIN, fontSize: size, color: light ? '#fff' : colours.ink }}>
    <span>
      <b style={{ fontWeight: 800 }}>{props.emergency}</b> <span style={{ opacity: 0.75 }}>Emergency</span>
    </span>
    {props.helplines.map((h) => (
      <span key={h.number}>
        <b style={{ fontWeight: 800 }}>{h.number}</b> <span style={{ opacity: 0.75 }}>{h.label}</span>
      </span>
    ))}
  </div>
);

/** The end card: the message in every language given, the logo, the issuer, the address. */
const Motto: React.FC<{ props: ExplainerProps; colours: Colours; durationInFrames: number }> = ({ props, colours, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const upright = height > width;
  const base = Math.round(width * (upright ? 0.064 : 0.04));
  const fade = interpolate(frame, [0, fps / 3, durationInFrames - fps / 3, durationInFrames], [0, 1, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const packs: LanguagePack[] = [props.primary, ...(props.secondary ? [props.secondary] : [])];
  const pad = Math.round(width * 0.08);
  return (
    <AbsoluteFill style={{ background: colours.deep, opacity: fade, padding: pad, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'grid', gap: base * 0.9, width: '100%', maxWidth: upright ? undefined : width * 0.7, textAlign: 'center' }}>
        {packs.map((pack, i) => {
          const t = spring({ frame: frame - i * fps * 0.5, fps, config: { damping: 200, stiffness: 120 } });
          return (
            <div
              key={pack.code}
              style={{
                opacity: t,
                transform: `translateY(${(1 - t) * 30}px)`,
                fontFamily: fontFor(pack.script),
                fontWeight: 800,
                fontSize: base * (i === 0 ? 1.15 : 0.85),
                lineHeight: 1.3,
                color: i === 0 ? '#b5df82' : '#fff',
                textWrap: 'balance',
              }}
            >
              {pack.motto}
            </div>
          );
        })}
        <div style={{ marginTop: base * 0.6, display: 'grid', justifyItems: 'center', gap: base * 0.5, opacity: spring({ frame: frame - fps * 1.4, fps, config: { damping: 200 } }) }}>
          <div style={{ background: '#fff', color: colours.deep, borderRadius: 999, padding: `${base * 0.3}px ${base * 0.9}px`, fontFamily: LATIN, fontWeight: 800, fontSize: base * 0.9 }}>{props.url}</div>
          <Helplines props={props} colours={colours} light size={base * 0.5} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: pad * 0.8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: pad, opacity: spring({ frame: frame - fps * 1.8, fps, config: { damping: 200 } }) }}>
        <span style={{ fontFamily: LATIN, fontSize: base * 0.5, color: '#c4dba9', fontWeight: 700 }}>{props.issuer}</span>
        <Logo size={base * 1.1} colours={colours} light localName={props.primary.script === 'latin' ? null : { text: props.primary.code === 'gu' ? 'ખોઝો' : 'खोज़ो', script: props.primary.script }} />
      </div>
    </AbsoluteFill>
  );
};

export const Explainer: React.FC<ExplainerProps> = (props) => {
  const { fps, width, height } = useVideoConfig();
  const colours: Colours = { ...KHOZO_COLOURS, ...(props.colours || {}) };
  const upright = height > width;
  const pic = Math.round(upright ? width * 0.78 : height * 0.72);
  const cap = Math.round(width * (upright ? 0.064 : 0.036));
  const line = (key: keyof Omit<LanguagePack, 'code' | 'script'>) => ({
    primary: { text: fill(props.primary[key], props), pack: props.primary },
    secondary: props.secondary ? { text: fill(props.secondary[key], props), pack: props.secondary } : null,
  });
  let at = 0;
  const seq = (seconds: number) => {
    const from = at * fps;
    at += seconds;
    return { from, durationInFrames: seconds * fps };
  };
  const see = seq(SCENES.see);
  const danger = seq(SCENES.danger);
  const send = seq(SCENES.send);
  const onlyPolice = seq(SCENES.onlyPolice);
  const dontForward = seq(SCENES.dontForward);
  const motto = seq(SCENES.motto);

  return (
    <AbsoluteFill style={{ background: colours.paper }}>
      <Sequence {...see}>
        <Scene
          background={colours.paper}
          durationInFrames={see.durationInFrames}
          picture={<Platform size={pic} colours={colours} />}
          caption={<Caption {...line('see')} colours={colours} size={cap} delay={fps * 0.3} />}
        />
      </Sequence>
      <Sequence {...danger}>
        <Scene
          background={colours.paper}
          durationInFrames={danger.durationInFrames}
          picture={<EmergencyPhone size={pic * 0.9} colours={colours} emergency={props.emergency} />}
          caption={<Caption {...line('danger')} colours={colours} size={cap} delay={fps * 0.3} />}
          footer={<Helplines props={props} colours={colours} size={cap * 0.5} />}
        />
      </Sequence>
      <Sequence {...send}>
        <Scene
          background={colours.paper}
          durationInFrames={send.durationInFrames}
          picture={<ReportPhone size={pic * 0.95} colours={colours} url={props.url} pressAt={fps * 2.6} />}
          caption={<Caption {...line('send')} colours={colours} size={cap} delay={fps * 0.3} />}
        />
      </Sequence>
      <Sequence {...onlyPolice}>
        <Scene
          background={colours.soft}
          durationInFrames={onlyPolice.durationInFrames}
          picture={<Journey size={pic * 1.1} colours={colours} />}
          caption={<Caption {...line('onlyPolice')} colours={colours} size={cap * 0.9} delay={fps * 0.3} />}
        />
      </Sequence>
      <Sequence {...dontForward}>
        <Scene
          background={colours.paper}
          durationInFrames={dontForward.durationInFrames}
          picture={<NoForward size={pic * 0.9} colours={colours} />}
          caption={<Caption {...line('dontForward')} colours={colours} size={cap * 1.1} delay={fps * 0.2} />}
        />
      </Sequence>
      <Sequence {...motto}>
        <Motto props={props} colours={colours} durationInFrames={motto.durationInFrames} />
      </Sequence>
    </AbsoluteFill>
  );
};
