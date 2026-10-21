// The faces the video is set in, fetched from Google Fonts at render time so a
// render machine with no Gujarati or Devanagari font still draws every letter.
import { loadFont as loadNotoSans } from '@remotion/google-fonts/NotoSans';
import { loadFont as loadGujarati } from '@remotion/google-fonts/NotoSansGujarati';
import { loadFont as loadDevanagari } from '@remotion/google-fonts/NotoSansDevanagari';
import type { Script } from './props';

const latin = loadNotoSans('normal', { weights: ['400', '700', '800'], subsets: ['latin'] });
const gujarati = loadGujarati('normal', { weights: ['400', '700', '800'], subsets: ['gujarati'] });
const devanagari = loadDevanagari('normal', { weights: ['400', '700', '800'], subsets: ['devanagari'] });

/** The font stack for a script: its own face first, Latin for digits and names. */
export function fontFor(script: Script): string {
  const own = script === 'gujarati' ? gujarati.fontFamily : script === 'devanagari' ? devanagari.fontFamily : latin.fontFamily;
  return `'${own}', '${latin.fontFamily}', sans-serif`;
}

export const LATIN = `'${latin.fontFamily}', sans-serif`;
