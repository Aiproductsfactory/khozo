// Case data in the reader's script; see scriptDisplay.js for the rules.
import { useLanguage } from './i18n.jsx';
import { displayPlace, displayText } from './scriptDisplay.js';
import { txt } from './safeText.js';

/**
 * d(text) and place(text) in the reader's current language; re-renders on a
 * switch. Each goes through txt() first, so a record field holding an object
 * renders as nothing rather than crashing the page.
 */
export function useDisplay() {
  const { lang } = useLanguage();
  const d = (value) => displayText(txt(value), lang);
  d.place = (value) => displayPlace(txt(value), lang);
  d.places = (...values) => values.map(txt).filter(Boolean).map((v) => displayPlace(v, lang)).join(', ');
  return d;
}
