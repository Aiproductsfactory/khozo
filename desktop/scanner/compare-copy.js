// The copy of a face picture that goes to the face engines, and that the
// laptop's own first pass signs too, so both look at the very same picture.
// Its own small module: the app's main process sends copies and must not load
// the recognition model to do it.
import sharp from 'sharp';
import { COMPARE_SIDE } from '../../web/src/video/faces.js';

/**
 * COMPARE_SIDE pixels a side, the size Aarakshak finds faces in best
 * (web/src/video/faces.js). The same bytes every time for the same picture.
 */
export function comparisonCopy(picture) {
  return sharp(picture).resize(COMPARE_SIDE, COMPARE_SIDE).jpeg({ quality: 90 }).toBuffer();
}

/** Five face points of a square picture of `side` pixels, moved onto its comparison copy. */
export const pointsOnCopy = (points, side) => (points && side ? points.map(([x, y]) => [(x * COMPARE_SIDE) / side, (y * COMPARE_SIDE) / side]) : null);
