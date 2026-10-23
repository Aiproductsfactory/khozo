import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import CaseRoute from './CaseRoute.jsx';
import { CheckCard } from './VideoChecks.jsx';

/**
 * The CCTV checks made for one case on police laptops with Khozo Desktop
 * (GET /api/reports/:id/video-jobs): which cameras and hours were read, by
 * whom and on which laptop, what was found and what each officer decided. A
 * check that found no one is worth knowing too: those cameras need not be
 * read again. Above them, the route the CCTV sightings make. Shown only when
 * there is one or the other.
 */
export default function CaseVideoChecks({ caseId }) {
  const t = useT();
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/reports/${encodeURIComponent(caseId)}/video-jobs`)
      .then((d) => { if (live) setData({ jobs: d.jobs || [], route: d.route || [] }); })
      .catch(() => { if (live) setData({ jobs: [], route: [] }); });
    return () => { live = false; };
  }, [caseId]);

  if (!data?.jobs.length && !data?.route.length) return null;
  return (
    <>
      <CaseRoute route={data.route} />
      {data.jobs.length > 0 && (
        <section className="rounded-xl ring-1 ring-black/5">
          <div className="border-b border-black/5 px-4 py-3">
            <h3 className="font-semibold">{t('CCTV checks for this case')}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{t('Footage read on police laptops with Khozo Desktop. A check that found no one still shows which cameras and hours were read.')}</p>
          </div>
          {data.jobs.map((job) => <CheckCard key={job.id} job={job} showCase={false} />)}
        </section>
      )}
    </>
  );
}
