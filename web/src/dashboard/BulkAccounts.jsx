// Many accounts from one sheet (POST /api/dashboard/network/users/bulk,
// shared/bulk-accounts.js): police stations with their location, alert
// number and poster codes, control rooms, CWCs, NGOs and every other desk.
// The sheet is checked row by row first and nothing changes until the admin
// says so. New accounts get a one-time activation link each, never a
// password, and the links are handed back as a file to send on.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { msg, useT } from '../i18n.jsx';
import { roleLabel } from '../lib.jsx';
import { openWorkbook, readSheet } from '../bulk/xlsx.js';
import { csvToSheet, parseCsv, toCsv } from '../bulk/csv.js';
import { CHUNK, COLUMNS, sheetRows } from '../bulk/accounts.js';

const ACTIONS = {
  create: { label: msg('New account'), className: 'bg-emerald-50 text-emerald-800' },
  update: { label: msg('Update details'), className: 'bg-sky-50 text-sky-800' },
  unchanged: { label: msg('No change'), className: 'bg-gray-100 text-gray-600' },
  error: { label: msg('Problem: not added'), className: 'bg-red-50 text-red-700' },
};

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BulkAccounts({ onDone }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  // The server's answer per row, keyed by sheet row number.
  const [results, setResults] = useState({});
  const [stage, setStage] = useState('idle'); // idle | checking | checked | adding | done
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');

  const ordered = useMemo(() => rows.map((r) => results[r.index]).filter(Boolean), [rows, results]);
  const count = (action) => ordered.filter((r) => r.action === action).length;
  const links = ordered.filter((r) => r.activationLink);

  const reset = () => {
    setRows([]);
    setResults({});
    setStage('idle');
    setProgress(0);
    setErr('');
    setFileName('');
  };

  /** Sends the rows in parts; `dryRun` checks only. */
  const send = async (list, dryRun) => {
    const out = {};
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      const data = await api.post('/dashboard/network/users/bulk', { rows: part, dryRun });
      for (const r of data.results || []) out[r.index] = r;
      setProgress(Math.min(list.length, i + CHUNK) / list.length);
    }
    return out;
  };

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let sheet;
      if (/\.csv$/i.test(file.name)) sheet = csvToSheet(parseCsv(new TextDecoder().decode(bytes)));
      else sheet = readSheet(openWorkbook(bytes), 0);
      const read = sheetRows(sheet);
      if (read.error) {
        setErr(t('No header row found. Use the template’s column names: Name, Role, Email, State, District, Police station…'));
        return;
      }
      if (!read.rows.length) {
        setErr(t('The sheet has no rows under its header.'));
        return;
      }
      setRows(read.rows);
      setStage('checking');
      setResults(await send(read.rows, true));
      setStage('checked');
    } catch (error) {
      setErr(error?.message === 'not-a-zip' || error?.message === 'not-a-workbook'
        ? t('This is not an Excel (.xlsx) or CSV file.')
        : error.message);
      setStage('idle');
    }
  };

  const add = async () => {
    setErr('');
    setStage('adding');
    setProgress(0);
    try {
      const go = rows.filter((r) => ['create', 'update'].includes(results[r.index]?.action));
      const done = await send(go, false);
      setResults((prev) => ({ ...prev, ...done }));
      setStage('done');
      onDone?.();
    } catch (error) {
      setErr(error.message);
      setStage('checked');
    }
  };

  const template = () => download('khozo-accounts-template.csv', toCsv([COLUMNS.filter((c) => c.header).map((c) => c.header)]));

  const saveLinks = () => download(
    `khozo-activation-links-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv([
      ['Name', 'Email', 'Role', 'Place', 'Activation link', 'Link works until'],
      ...links.map((r) => [r.name, r.email, roleLabel(r.role), r.place, r.activationLink, new Date(r.activationExpiresAt).toLocaleString('en-IN')]),
    ]),
  );

  if (!open) {
    return (
      <section className="card p-4 sm:p-5">
        <h2 className="text-lg font-bold">{t('Add many accounts from a sheet')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('Police stations, control rooms, CWCs, NGOs and other desks: one row each. A police station row can carry its location, alert SMS number and poster codes, so sightings near it reach its phones.')}</p>
        <button type="button" className="btn-primary mt-3 px-4 py-2 text-sm" onClick={() => setOpen(true)}>{t('Upload a sheet')}</button>
      </section>
    );
  }

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{t('Add many accounts from a sheet')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            {t('Each new account gets a one-time activation link instead of a password. You download the links and send each one to its officer; they open it and set their own password. Links work once, for 7 days.')}
          </p>
        </div>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { reset(); setOpen(false); }}>{t('Close')}</button>
      </div>

      <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
        <p className="font-semibold text-gray-800">{t('The sheet')}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>{t('Needed in every row: Name, Role, Email, State and District.')}</li>
          <li>{t('Role, in plain words: Police station, Control room, SJPU, AHTU, CWC, DCPU, RPF, CCI, NGO, and so on.')}</li>
          <li>{t('Police station rows: the station’s name, its location (latitude, longitude, or a Google Maps link), the CUG mobile for alert SMS, and its poster codes separated by commas.')}</li>
          <li>{t('NGO rows: the registration number is needed, and the NGO Darpan ID if it has one. Adding an NGO says your office has checked it.')}</li>
          <li>{t('An email already on Khozo updates that account’s mobile, alert number and station details, and sends a fresh link if it is not active yet. Its name, role and area do not change.')}</li>
        </ul>
        <button type="button" className="mt-2 font-semibold text-khozo-dark underline" onClick={template}>{t('Download the template (CSV)')}</button>
      </div>

      {stage !== 'adding' && stage !== 'checking' && (
        <label className="btn-ghost inline-flex cursor-pointer px-4 py-2 text-sm">
          {fileName ? t('Choose another sheet') : t('Choose an Excel or CSV file')}
          <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={choose} />
        </label>
      )}
      {fileName && <p className="text-xs text-gray-500">{fileName} · {t('{n} rows', { n: rows.length })}</p>}
      {(stage === 'checking' || stage === 'adding') && (
        <p className="text-sm text-gray-600">
          {stage === 'checking' ? t('Checking each row…') : t('Adding accounts…')} {Math.round(progress * 100)}%
        </p>
      )}
      {err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      {ordered.length > 0 && (
        <>
          <p className="text-sm text-gray-700">
            {stage === 'done'
              ? t('Done: {created} new, {updated} updated, {problems} not added.', { created: count('create'), updated: count('update'), problems: count('error') })
              : t('{created} new accounts, {updated} to update, {same} with no change, {problems} with a problem.', { created: count('create'), updated: count('update'), same: count('unchanged'), problems: count('error') })}
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-xl ring-1 ring-black/5">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('Row')}</th>
                  <th className="px-3 py-2">{t('Name')}</th>
                  <th className="px-3 py-2">{t('Role')}</th>
                  <th className="px-3 py-2">{t('Email')}</th>
                  <th className="px-3 py-2">{t('What happens')}</th>
                  <th className="px-3 py-2">{t('Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => (
                  <tr key={r.index} className="border-t border-black/5 align-top">
                    <td className="px-3 py-2 text-gray-400">{r.index}</td>
                    <td className="px-3 py-2 font-medium text-ink">{r.name || '-'}<span className="block text-[11px] font-normal text-gray-500">{r.place}</span></td>
                    <td className="px-3 py-2">{r.role ? roleLabel(r.role) : '-'}</td>
                    <td className="px-3 py-2">{r.email || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${ACTIONS[r.action]?.className || ''}`}>{t(ACTIONS[r.action]?.label || ACTIONS.error.label)}</span>
                      {r.activationLink && <span className="mt-1 block text-[11px] text-emerald-700">{t('Link ready')}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {[...(r.errors || []), ...(r.warnings || [])].join(' · ') || (r.changes?.length ? t('Changes: {fields}', { fields: r.changes.join(', ') }) : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stage === 'checked' && count('create') + count('update') > 0 && (
            <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={add}>
              {t('Add {n} new and update {m}', { n: count('create'), m: count('update') })}
            </button>
          )}
          {stage === 'done' && links.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{t('{n} activation links are ready.', { n: links.length })}</p>
              <p className="mt-1 text-xs">{t('This file lets each person set the password for their account. Send each link only to that officer, by WhatsApp or email, then delete the file. Anyone who has not activated within 7 days needs a new link: upload their rows again.')}</p>
              <button type="button" className="btn-primary mt-2 px-4 py-2 text-sm" onClick={saveLinks}>{t('Download the activation links')}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
