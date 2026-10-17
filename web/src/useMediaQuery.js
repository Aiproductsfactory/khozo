import { useEffect, useState } from 'react';

/** True while the media query matches; follows rotation and resizing. */
export function useMediaQuery(query) {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    let list;
    try {
      list = window.matchMedia(query);
    } catch {
      return undefined;
    }
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

/** Phone width: below Tailwind's `sm` breakpoint. */
export const PHONE_QUERY = '(max-width: 639px)';
