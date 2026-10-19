import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProtectedImage, txt } from '../lib.jsx';
import { useT } from '../i18n.jsx';
import { useBackClose } from '../useBackClose.js';

/**
 * Photographs whole and as large as the screen allows, side by side when
 * there are two: the case photo beside the sighting that may be the same
 * person, so an officer looks at the faces themselves and not only at a
 * score. A 96 px avatar is too small to tell one teenager from another.
 *
 * "Actual size" shows the pixels as they are, scrollable: a face in a street
 * photo can be a few dozen pixels across, and fitting the picture to the
 * screen shrinks it further. Clicking a photo switches between the two.
 *
 * `panes`: [{ label, photos: [{ id, src, caption }], startId }] - one pane a
 * record, each showing one of its photos at a time with a strip to choose
 * another (a case holds up to five, a sighting three: shared/photo-set.js),
 * opening on `startId`, the photo the match was scored on. `photos`:
 * [{ src, label, caption }] is the one-photo-a-pane shorthand. `footer` sits
 * under the photos (a link on to the sighting, a reminder that looking is not
 * confirming).
 *
 * Rendered into <body>: opened from inside the case sheet, it would otherwise
 * share the console's stacking context and sit under the side navigation.
 */
export default function PhotoViewer({ panes: givenPanes, photos, title, onClose, footer }) {
  const t = useT();
  const [actual, setActual] = useState(false);
  useBackClose(true, onClose);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const panes = useMemo(() => {
    const raw = Array.isArray(givenPanes)
      ? givenPanes
      : (Array.isArray(photos) ? photos : []).filter(Boolean).map((p) => ({ label: p.label, photos: [{ id: 'only', src: p.src, caption: p.caption }] }));
    return raw
      .filter(Boolean)
      .map((pane) => ({ ...pane, photos: (Array.isArray(pane.photos) ? pane.photos : []).filter((p) => p && txt(p.src)) }))
      .filter((pane) => pane.photos.length);
  }, [givenPanes, photos]);
  // Which photo each pane shows: the one the match was scored on, at first.
  const [at, setAt] = useState(() => panes.map((pane) => Math.max(0, pane.photos.findIndex((p) => p.id === pane.startId))));
  const two = panes.length > 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-neutral-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={txt(title) || t('Photo')}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <p className="min-w-0 truncate text-sm font-semibold sm:text-base">{txt(title)}</p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setActual((v) => !v)}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ring-1 ring-white/30 hover:bg-white/10 sm:text-sm"
          >
            {actual ? t('Fit to screen') : t('Actual size')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10"
            aria-label={t('Close')}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 gap-2 px-2 pb-2 sm:gap-3 sm:px-4 ${two ? 'flex-col sm:flex-row' : 'flex-col'}`}>
        {panes.map((pane, i) => {
          const index = Math.min(at[i] ?? 0, pane.photos.length - 1);
          const photo = pane.photos[index];
          const many = pane.photos.length > 1;
          return (
            <figure key={`${txt(pane.label)}-${i}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
              {(txt(pane.label) || many) && (
                <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                  {txt(pane.label) && <span className="font-bold uppercase tracking-wider text-white/90">{txt(pane.label)}</span>}
                  {many && <span className="text-white/60">{t('{n} of {total}', { n: index + 1, total: pane.photos.length })}</span>}
                  {txt(photo.caption) && <span className="min-w-0 truncate text-white/70">{txt(photo.caption)}</span>}
                </figcaption>
              )}
              <div
                className={`flex min-h-0 flex-1 overflow-auto rounded-xl bg-white/5 ring-1 ring-white/10 ${actual ? 'items-start justify-start' : 'items-center justify-center'}`}
              >
                <button
                  type="button"
                  onClick={() => setActual((v) => !v)}
                  className={actual ? 'block shrink-0 cursor-zoom-out' : 'flex h-full w-full cursor-zoom-in items-center justify-center'}
                  aria-label={actual ? t('Fit to screen') : t('Actual size')}
                >
                  <ProtectedImage
                    key={photo.src}
                    src={photo.src}
                    alt={txt(pane.label)}
                    className={actual ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
                    loading={<span className="p-6 text-sm text-white/60">{t('Loading photo…')}</span>}
                    fallback={<span className="p-6 text-sm text-white/60">{t('This photo could not be shown.')}</span>}
                  />
                </button>
              </div>
              {/* The record's other photos, to look at each in turn. */}
              {many && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('Photos of this record')}>
                  {pane.photos.map((p, j) => (
                    <button
                      key={p.id || j}
                      type="button"
                      onClick={() => setAt((prev) => prev.map((v, k) => (k === i ? j : v)))}
                      aria-pressed={j === index}
                      aria-label={t('Photo {n}', { n: j + 1 })}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition ${j === index ? 'ring-white' : 'ring-white/10 opacity-70 hover:opacity-100'}`}
                    >
                      <ProtectedImage src={p.src} alt="" className="h-full w-full object-cover" fallback={<span className="text-[10px] text-white/50">{j + 1}</span>} />
                    </button>
                  ))}
                </div>
              )}
            </figure>
          );
        })}
        {panes.length === 0 && (
          <p className="m-auto text-sm text-white/70">{t('No photo on this record.')}</p>
        )}
      </div>

      {footer && <div className="safe-bottom border-t border-white/10 px-3 py-2 text-xs text-white/80 sm:px-4 sm:py-3 sm:text-sm">{footer}</div>}
    </div>,
    document.body,
  );
}
