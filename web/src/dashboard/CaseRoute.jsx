import { Link } from 'react-router-dom';
import { currentLocale, useT } from '../i18n.jsx';

/**
 * A case's route (spec F13): each moment a CCTV check put the person on a
 * camera and an officer sent it to the case, in time order, from every laptop
 * and both kinds of check (GET /api/reports/:id/video-jobs `route`, from
 * shared/video-jobs.js caseRoute). A sighting the case's officers turn down
 * drops off it.
 *
 * The map is drawn here from the cameras' map points, with no map service:
 * it shows the order and the rough direction, not the roads. Each camera
 * opens on Google Maps from the list.
 */

const W = 640;
const H = 300;
const PAD = 34;

/** The cameras' points, placed in the box with east to the right and north up, distances kept in proportion. */
function placed(moments) {
  const points = moments.filter((m) => m.lat != null && m.lng != null);
  if (!points.length) return [];
  const midLat = points.reduce((n, m) => n + m.lat, 0) / points.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = points.map((m) => m.lng * kx);
  const ys = points.map((m) => m.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const scale = Math.min(W - 2 * PAD, H - 2 * PAD) / span;
  const offX = (W - (x1 - x0) * scale) / 2;
  const offY = (H - (y1 - y0) * scale) / 2;
  return moments.map((m, i) => (m.lat == null || m.lng == null ? null : {
    n: i + 1,
    x: offX + (m.lng * kx - x0) * scale,
    y: H - (offY + (m.lat - y0) * scale),
  }));
}

export default function CaseRoute({ route }) {
  const t = useT();
  if (!route?.length) return null;
  const spots = placed(route);
  const drawn = spots.filter(Boolean);
  const when = (m) => (m.seenAt
    ? new Date(m.seenAt).toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
    : t('time not known ({video} into the video)', { video: m.videoTime || '-' }));
  return (
    <section className="rounded-xl ring-1 ring-black/5" aria-label={t('Route from CCTV')}>
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{t('Route from CCTV')}</h3>
        <p className="mt-0.5 text-xs text-gray-500">{t('Each moment an officer sent to this case from a CCTV check, in time order. Each is a lead, not an identification.')}</p>
      </div>
      {drawn.length > 1 && (
        <figure className="px-4 pt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl rounded-lg bg-slate-50 ring-1 ring-black/5" role="img" aria-label={t('The cameras in the order the person was seen')}>
            <polyline
              points={drawn.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--color-khozo-dark)"
              strokeWidth="2.5"
              strokeDasharray="6 5"
            />
            {drawn.map((p) => (
              <g key={p.n}>
                <circle cx={p.x} cy={p.y} r="13" fill="var(--color-khozo-dark)" />
                <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{p.n}</text>
              </g>
            ))}
          </svg>
          <figcaption className="mt-1 text-xs text-gray-500">{t('North is up. Drawn from the cameras\' map points, not a road map.')}</figcaption>
        </figure>
      )}
      <ol className="space-y-2 px-4 py-3 text-sm">
        {route.map((m, i) => (
          <li key={m.sightingId} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-khozo-dark text-xs font-bold text-white">{i + 1}</span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{m.cameraPlace || '-'}</p>
              <p className="text-gray-600">{when(m)}</p>
              <p className="text-xs text-gray-500">
                {m.fromOpenCases
                  ? t('Sent from a check against open cases by {officer}', { officer: m.markedBy || '-' })
                  : t('Marked by {officer}', { officer: m.markedBy || '-' })}
                {m.laptop ? ` · ${t('Laptop: {laptop}', { laptop: m.laptop })}` : ''}
                {m.status === 'matched' ? ` · ${t('Confirmed on review')}` : ` · ${t('Waiting for review')}`}
              </p>
              <p className="mt-1 flex flex-wrap gap-2 text-xs">
                <Link to={`/app/sightings?id=${encodeURIComponent(m.sightingId)}`} className="font-semibold text-khozo-dark underline">{t('Open sighting')}</Link>
                {m.lat != null && m.lng != null && (
                  <a className="text-khozo-dark underline" href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noopener noreferrer">{t('On the map')}</a>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {route.length > 1 && drawn.length < route.length && (
        <p className="px-4 pb-3 text-xs text-gray-500">{t('Some cameras have no map point, so they are in the list but not on the drawing.')}</p>
      )}
    </section>
  );
}
