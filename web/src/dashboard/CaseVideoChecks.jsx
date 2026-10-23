import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';
import { CheckCard } from './VideoChecks.jsx';

/**
 * The CCTV checks made for one case on police laptops with Khozo Desktop
 * (GET /api/reports/:id/video-jobs): which cameras and hours were read, by
 * whom, and what was found. A check that found no one is worth knowing too:
 * those cameras need not be read again. Shown only when there is one.
 */
export default function CaseVideoChecks({ caseId }) {
  const t = useT();
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    let live = true;
    setJobs(null);
    api.get(`/reports/${encodeURIComponent(caseId)}/video-jobs`)
      .then((data) => { if (live) setJobs(data.jobs || []); })
      .catch(() => { if (live) setJobs([]); });
    return () => { live = false; };
  }, [caseId]);

  if (!jobs?.length) return null;
  return (
    <section className="rounded-xl ring-1 ring-black/5">
      <div className="border-b border-black/5 px-4 py-3">
        <h3 className="font-semibold">{t('CCTV checks for this case')}</h3>
        <p className="mt-0.5 text-xs text-gray-500">{t('Footage read on police laptops with Khozo Desktop. A check that found no one still shows which cameras and hours were read.')}</p>
      </div>
      {jobs.map((job) => <CheckCard key={job.id} job={job} showCase={false} />)}
    </section>
  );
}
