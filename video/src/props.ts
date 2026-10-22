// What the explainer says and for whom. Everything a police force or a
// country changes is here, so the same video serves Ahmedabad today and
// another state or country later: pass a JSON file with `--props` (README).

export type Script = 'latin' | 'gujarati' | 'devanagari';

/** The six lines of the video in one language. */
export type LanguagePack = {
  code: string;
  script: Script;
  /** Scene 1: a question to the viewer. */
  see: string;
  /** Scene 2: the emergency number comes first. */
  danger: string;
  /** Scene 3: what to send, and where. */
  send: string;
  /** Scene 4: who sees it, and what it costs. */
  onlyPolice: string;
  /** Scene 5: the one thing never to do. */
  dontForward: string;
  /** Scene 6: the message people remember. */
  motto: string;
  /** Words inside the pictures: the report form, the police, a forwarded chat. */
  ui: {
    photoAdded: string;
    place: string;
    nameOptional: string;
    send: string;
    sent: string;
    police: string;
    forwarded: string;
    emergency: string;
  };
};

export type Helpline = { label: string; number: string };

export type ExplainerProps = {
  /** Who issues the video. Shown on the end card and never anywhere else. */
  issuer: string;
  /** Where the public reports: printed, never a QR code (a code is for paper). */
  url: string;
  /** The emergency number comes first, before the website. */
  emergency: string;
  /** Other helplines, shown beside the emergency number, labelled in the primary language. */
  helplines: Helpline[];
  /** The language the lines are spoken in; the big caption. */
  primary: LanguagePack;
  /** Shown under the primary line, smaller. Null for one language only. */
  secondary: LanguagePack | null;
  /** The brand colours. The defaults are Khozo's. */
  colours?: Partial<Colours>;
};

export type Colours = {
  brand: string;
  deep: string;
  ink: string;
  paper: string;
  soft: string;
  warn: string;
};

export const KHOZO_COLOURS: Colours = {
  brand: '#67a426',
  deep: '#1f3a10',
  ink: '#1c2530',
  paper: '#f6f8f5',
  soft: '#edf5e3',
  warn: '#c0392b',
};

export const ENGLISH: LanguagePack = {
  code: 'en',
  script: 'latin',
  see: 'Seen a child, woman or person who seems lost?',
  danger: 'In danger? Call {emergency} first.',
  send: 'No danger? Send a photo, or just the place, to the police.',
  onlyPolice: 'Only the police see it. Free. No login. Your name is optional.',
  dontForward: 'Never forward the photo.',
  motto: 'See it. Send it to the police. Don’t forward it.',
  ui: { photoAdded: 'Photo added', place: 'Near Platform 4', nameOptional: 'Your name (optional)', send: 'Send to the police', sent: 'Sent to the police ✓', police: 'THE POLICE', forwarded: 'Forwarded', emergency: 'Emergency' },
};

export const GUJARATI: LanguagePack = {
  code: 'gu',
  script: 'gujarati',
  see: 'ખોવાયેલ લાગતા કોઈ બાળક, મહિલા કે વ્યક્તિને આપે જોયું છે?',
  danger: 'જોખમ હોય તો પહેલાં {emergency} પર ફોન કરો.',
  send: 'જોખમ નથી? ફોટો, કે ફક્ત જગ્યા, પોલીસને મોકલો.',
  onlyPolice: 'ફક્ત પોલીસ જ જુએ છે. મફત. લૉગ ઇન વિના. નામ આપવું ફરજિયાત નથી.',
  dontForward: 'ફોટો ક્યારેય ફોરવર્ડ ન કરો.',
  motto: 'જુઓ. પોલીસને મોકલો. ફોરવર્ડ ન કરો.',
  ui: { photoAdded: 'ફોટો ઉમેર્યો', place: 'પ્લેટફોર્મ 4 પાસે', nameOptional: 'આપનું નામ (વૈકલ્પિક)', send: 'પોલીસને મોકલો', sent: 'પોલીસને મોકલ્યું ✓', police: 'પોલીસ', forwarded: 'ફોરવર્ડ કરેલું', emergency: 'ઇમરજન્સી' },
};

export const HINDI: LanguagePack = {
  code: 'hi',
  script: 'devanagari',
  see: 'क्या आपने कोई खोया हुआ-सा बच्चा, महिला या व्यक्ति देखा है?',
  danger: 'ख़तरा हो तो पहले {emergency} पर कॉल करें।',
  send: 'ख़तरा नहीं? फ़ोटो, या सिर्फ़ जगह, पुलिस को भेजें।',
  onlyPolice: 'सिर्फ़ पुलिस देखती है। मुफ़्त। बिना लॉग इन के। नाम देना ज़रूरी नहीं।',
  dontForward: 'फ़ोटो कभी फ़ॉरवर्ड न करें।',
  motto: 'देखें। पुलिस को भेजें। फ़ॉरवर्ड न करें।',
  ui: { photoAdded: 'फ़ोटो जोड़ी गई', place: 'प्लेटफ़ॉर्म 4 के पास', nameOptional: 'आपका नाम (वैकल्पिक)', send: 'पुलिस को भेजें', sent: 'पुलिस को भेजा गया ✓', police: 'पुलिस', forwarded: 'फ़ॉरवर्ड किया गया', emergency: 'इमरजेंसी' },
};

export const LANGUAGES: Record<string, LanguagePack> = { en: ENGLISH, gu: GUJARATI, hi: HINDI };

/** Ahmedabad City Police, Gujarati first with English beneath. */
export const AHMEDABAD: ExplainerProps = {
  issuer: 'Ahmedabad City Police',
  url: 'khozo.org/report',
  emergency: '112',
  helplines: [
    { label: 'બાળક', number: '1098' },
    { label: 'મહિલા', number: '181' },
  ],
  primary: GUJARATI,
  secondary: ENGLISH,
};

/** "{emergency}" in a line becomes the number. */
export function fill(line: string, props: Pick<ExplainerProps, 'emergency'>): string {
  return line.replaceAll('{emergency}', props.emergency);
}
