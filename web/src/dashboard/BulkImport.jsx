import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { currentLocale, msg, useT } from '../i18n.jsx';
import DistrictPicker from '../DistrictPicker.jsx';
import { colLetters, loadMedia, openWorkbook, readSheet } from '../bulk/xlsx.js';
import { csvToSheet, parseCsv, toCsv } from '../bulk/csv.js';
import { detectLayout, rowTexts, usesLegacyFont } from '../bulk/prepare.js';
import { FIELDS, TEMPLATE_HEADERS } from '../bulk/columns.js';
import { GUJARAT_STATIONS } from '../bulk/gujaratRegister.js';
import { PRESETS, assignPhotos, buildRecords, checkRecord, matchesExisting, payloadFor, personCategoryFor } from '../bulk/records.js';
import { extOf, isShadowPicture, toJpeg } from '../bulk/photos.js';
import { createControl, makeRequest, runImport } from '../bulk/importer.js';

/*
 * Bulk import: a department hands over its register as a spreadsheet and it
 * becomes searchable, face-matchable cases. Nothing is sent until the officer
 * has seen every row in the preview; rows are then registered one at a time
 * through the same POST /api/reports the Register form uses, so every rule
 * (validation, duplicate check, face screening, audit) applies unchanged.
 * Behaviour mirrors scripts/import-gujarat-cases.mjs.
 */

const FORMAL_ROLES = ['police', 'sjpu', 'admin', 'super_admin'];
const PAGE_SIZE = 100;
const DELAY_MS = 1200;

const CONNECTED_SOURCES = [
  { id: 'trackchild', name: 'TrackChild', note: msg('National missing and found children portal (MWCD)') },
  { id: 'khoyapaya', name: 'Khoya-Paya', note: msg('Citizen reports of missing and found children') },
  { id: 'zipnet', name: 'ZIPNET', note: msg('Missing-person and unidentified-body records shared by state police') },
  { id: 'cctns', name: 'CCTNS', note: msg('Police FIR and case records') },
  { id: 'ngo', name: msg('NGO portals'), note: msg('Shelter homes and child-rights organisations') },
];

const PRESET_HELP = {
  khozo: msg('Khozo’s own columns. Download the blank form, fill in one row per person and save it as Excel or CSV.'),
  gujarat: msg('The police station register (અ.નં, નામ, જાતી, ઉ.વ, ગુમ થયા તારીખ …). Reads photos pasted into the sheet and text typed in the old Gujarati font.'),
  other: msg('An export from another portal or an NGO register. Check the column mapping below before you import.'),
};

const STATUS_STYLE = {
  ready: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  exists: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  created: 'bg-emerald-600 text-white ring-emerald-700/20',
  skipped: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  review: 'bg-amber-100 text-amber-900 ring-amber-600/30',
  failed: 'bg-red-600 text-white ring-red-700/20',
  sending: 'bg-gray-100 text-gray-700 ring-gray-500/20',
};

const STATUS_LABEL = {
  ready: msg('Ready'),
  warning: msg('To check'),
  error: msg('Cannot import'),
  exists: msg('Already in Khozo'),
  created: msg('Created'),
  skipped: msg('Already imported'),
  review: msg('Needs review'),
  failed: msg('Failed'),
  sending: msg('Sending…'),
};

const FILTERS = [
  { id: 'all', label: msg('All') },
  { id: 'ready', label: msg('Ready') },
  { id: 'warning', label: msg('To check') },
  { id: 'error', label: msg('Cannot import') },
  { id: 'exists', label: msg('Already in Khozo') },
];
const RESULT_FILTERS = [
  { id: 'created', label: msg('Created') },
  { id: 'review', label: msg('Needs review') },
  { id: 'failed', label: msg('Failed') },
];

const READ_ERRORS = {
  xls: msg('Old .xls files cannot be read here. Open the file in Excel, choose Save As → Excel Workbook (.xlsx) or CSV, and upload that.'),
  'not-a-zip': msg('This file is not a readable Excel workbook. Save it again as .xlsx or CSV and try once more.'),
  'not-a-workbook': msg('This file is not a readable Excel workbook. Save it again as .xlsx or CSV and try once more.'),
  'no-sheet': msg('The workbook has no sheet with data.'),
  type: msg('Choose an Excel (.xlsx) or CSV file.'),
};

function genderText(t, gender, age) {
  if (!gender) return '';
  const adult = personCategoryFor(age, gender) !== 'child';
  if (gender === 'Female') return adult ? t('Woman') : t('Girl');
  if (gender === 'Male') return adult ? t('Man') : t('Boy');
  return t('Other');
}

function fmtIsoDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(currentLocale(), { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}

function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

// Numbers go into t() as text: interpolation in i18n.jsx skips a value of 0,
// which would print "{n} cannot import" instead of "0 cannot import".
const num = (v) => String(v ?? '');
const textVars = (vars) => (vars ? Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, num(v)])) : vars);

function Pill({ status, children }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status] || STATUS_STYLE.sending}`}>
      {children}
    </span>
  );
}

function LegacyMark() {
  const t = useT();
  return (
    <span
      className="ml-1 inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 align-middle max-sm:text-xs font-semibold sm:text-[10px] text-violet-700 ring-1 ring-inset ring-violet-600/20"
      title={t('This text was typed in a old Gujarati font and has been converted to standard Gujarati.')}
    >
      {t('converted from the old font')}
    </span>
  );
}

function PresetPicker({ preset, onChange, disabled }) {
  const t = useT();
  const downloadTemplate = () => {
    download('khozo-bulk-import-template.csv', toCsv([Object.values(TEMPLATE_HEADERS)]));
  };
  return (
    <div className="card p-5">
      <h3 className="font-semibold">{t('1. What are you importing?')}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {Object.values(PRESETS).map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm transition ${
              preset === p.id ? 'border-khozo bg-khozo-light/60 ring-2 ring-khozo/30' : 'border-gray-200 hover:bg-gray-50'
            } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            <span className="flex items-start gap-2">
              <input type="radio" name="bulk-preset" className="mt-1" checked={preset === p.id} onChange={() => onChange(p.id)} disabled={disabled} />
              <span className="font-semibold">{t(p.label)}</span>
            </span>
            <span className="pl-6 text-xs text-gray-500">{t(PRESET_HELP[p.id])}</span>
            {p.id === 'khozo' && (
              <button type="button" className="ml-6 mt-1 self-start text-xs font-semibold text-khozo hover:underline" onClick={(e) => { e.preventDefault(); downloadTemplate(); }}>
                {t('Download the blank form (CSV)')}
              </button>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function ConnectedSources() {
  const t = useT();
  return (
    <div className="card p-5">
      <h3 className="font-semibold">{t('Connected sources')}</h3>
      <p className="mt-1 text-xs text-gray-500">{t('Direct connections to other systems are not live yet. Until they are, export the records from the source and import the file here.')}</p>
      <ul className="mt-3 space-y-2">
        {CONNECTED_SOURCES.map((s) => (
          <li key={s.id} className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t(s.name)}</span>
              <span className="rounded-full bg-gray-200/70 px-2 py-0.5 max-sm:text-xs font-medium text-gray-600 sm:text-[11px]">{t('Not connected')}</span>
            </div>
            <p className="text-xs text-gray-500">{t(s.note)}</p>
            <p className="mt-0.5 text-xs text-gray-600">{t('A direct link is waiting for their permission; until then, import their files here')}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MappingTable({ sheet, layout, legacy, onMap, onHeaderRow, disabled }) {
  const t = useT();
  const sample = useMemo(() => {
    const out = [];
    for (let r = layout.headerRow + 1; r <= Math.min(sheet.maxRow, layout.headerRow + 3) && out.length < 1; r++) {
      if (sheet.rows.get(r)) out.push(rowTexts(sheet, r, legacy));
    }
    return out[0] || [];
  }, [sheet, layout.headerRow, legacy]);
  const fieldOf = (col) => Object.keys(layout.mapping).find((f) => Number(layout.mapping[f]) === col) || '';
  const cols = [];
  for (let c = 0; c <= sheet.maxCol; c++) cols.push(c);
  const fieldPicker = (c, label) => {
    const f = fieldOf(c);
    return (
      <select aria-label={label} className={`field py-1 text-xs ${f ? 'border-khozo/50 bg-khozo-light/40' : ''}`} value={f} onChange={(e) => onMap(c, e.target.value)} disabled={disabled}>
        <option value="">{t('Not imported')}</option>
        {FIELDS.map((fd) => (
          <option key={fd.id} value={fd.id}>{t(fd.label)}{fd.required ? ' *' : ''}</option>
        ))}
      </select>
    );
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap text-gray-600">{t('Header row')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, Math.min(30, sheet.maxRow))}
            className="field w-20 py-1"
            value={layout.headerRow}
            onChange={(e) => onHeaderRow(Math.max(1, Number(e.target.value) || 1))}
            disabled={disabled}
          />
        </label>
        <span className="text-xs text-gray-500">{t('Each column below shows its header and the first row. Change a dropdown if a column was read wrongly.')}</span>
      </div>
      {/* Phones: one card per column instead of a table that scrolls sideways. */}
      <ul className="space-y-2 sm:hidden">
        {cols.map((c) => (
          <li key={c} className="rounded-xl border border-black/5 p-3">
            <p className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-gray-400">{colLetters(c)}</span>
              <span className="min-w-0 break-words font-semibold text-ink">{layout.headers[c] || t('(no header)')}</span>
            </p>
            <p className="mt-1 line-clamp-2 break-words text-sm text-gray-600">{sample[c] || '—'}</p>
            <div className="mt-2">{fieldPicker(c, layout.headers[c] || colLetters(c))}</div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-black/5 sm:block">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              {cols.map((c) => (
                <th key={c} className="min-w-[175px] max-w-[240px] border-r border-black/5 px-3 py-2 align-top last:border-0">
                  <span className="font-mono text-[11px] text-gray-400">{colLetters(c)}</span>
                  <span className="block truncate font-semibold text-ink" title={layout.headers[c]}>{layout.headers[c] || t('(no header)')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {cols.map((c) => (
                <td key={c} className="max-w-[220px] border-r border-black/5 px-3 py-2 align-top text-gray-600 last:border-0">
                  <span className="line-clamp-2 break-words" title={sample[c]}>{sample[c] || '—'}</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-black/5">
              {cols.map((c) => (
                <td key={c} className="border-r border-black/5 px-2 py-2 last:border-0">
                  {fieldPicker(c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Issues({ check }) {
  const t = useT();
  if (!check.errors.length && !check.warnings.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 max-sm:text-xs leading-snug sm:text-[11px]">
      {check.errors.map((e) => <li key={e.code} className="text-red-700">{t(e.text, textVars(e.vars))}</li>)}
      {check.warnings.map((w) => <li key={w.code} className="text-amber-800">{t(w.text, textVars(w.vars))}</li>)}
    </ul>
  );
}

function ResultLine({ result, onForce, busy }) {
  const t = useT();
  if (!result) return null;
  if (result.status === 'created') {
    return (
      <p className="mt-1 max-sm:text-xs text-emerald-700 sm:text-[11px]">
        {result.reportId}
        {result.afterDuplicateWarning ? ` · ${t('similar cases were other people')}` : ''}
      </p>
    );
  }
  if (result.status === 'skipped') return <p className="mt-1 max-sm:text-xs text-sky-700 sm:text-[11px]">{t('Already imported as {id}', { id: result.reportId })}</p>;
  if (result.status === 'failed') return <p className="mt-1 max-sm:text-xs text-red-700 sm:text-[11px]">{t(result.message || 'Failed')}</p>;
  if (result.status === 'review') {
    return (
      <div className="mt-1 rounded-lg bg-amber-50 p-2 max-sm:text-xs text-amber-900 sm:text-[11px]">
        <p className="font-semibold">{t('Possible duplicate of:')}</p>
        <ul className="mt-0.5 space-y-0.5">
          {(result.candidates || []).map((d) => (
            <li key={d.reportId}>
              {d.childName} · {d.reportId} · {t('{pct}% similar', { pct: Math.round((d.score || 0) * 100) })}
            </li>
          ))}
        </ul>
        {onForce && (
          <button type="button" className="mt-1 font-semibold text-amber-900 underline" onClick={onForce} disabled={busy}>
            {t('These are different people — create anyway')}
          </button>
        )}
      </div>
    );
  }
  return null;
}

export default function BulkImport() {
  const t = useT();
  const { user } = useAuth();
  const formal = FORMAL_ROLES.includes(user.role);
  const jurisdiction = user.jurisdiction || {};

  const [preset, setPreset] = useState(() => (/gujarat/i.test(jurisdiction.state || '') ? 'gujarat' : 'khozo'));
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetVersion, setSheetVersion] = useState(0);
  const [layout, setLayout] = useState(null);
  const [legacyConvert, setLegacyConvert] = useState(true);
  const [hasLegacyFont, setHasLegacyFont] = useState(false);
  const [shadows, setShadows] = useState(() => new Set());
  const [photoFiles, setPhotoFiles] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [overrides, setOverrides] = useState({});
  const [existing, setExisting] = useState(null);
  // The batch's place, as the district picker gives it: canonical names and
  // LGD codes (shared/geo). Starts on the importing account's own area.
  const [place, setPlace] = useState(() => ({
    state: jurisdiction.state || '',
    stateCode: jurisdiction.stateCode || '',
    district: jurisdiction.district || '',
    districtCode: jurisdiction.districtCode || '',
  }));
  const { state, district } = place;
  const [restrict, setRestrict] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [run, setRun] = useState({ status: 'idle', current: null, retry: null, stopReason: null });
  const [results, setResults] = useState({});

  const wbRef = useRef(null);
  const sheetRef = useRef(null);
  const mediaRef = useRef({});
  const controlRef = useRef(null);
  const thumbCache = useRef(new Map());
  const fileInput = useRef(null);
  const photoInput = useRef(null);

  const running = run.status === 'running' || run.status === 'paused';
  const gujaratPreset = preset === 'gujarat';
  const restrictToPolice = gujaratPreset || restrict;
  const legacy = useMemo(
    () => ({ convert: legacyConvert, heuristic: legacyConvert && (gujaratPreset || hasLegacyFont) }),
    [legacyConvert, gujaratPreset, hasLegacyFont],
  );

  // Object URLs for thumbnails are released when the page closes.
  useEffect(() => () => {
    for (const url of thumbCache.current.values()) if (url) URL.revokeObjectURL(url);
  }, []);

  const resetForNewFile = () => {
    setReadError('');
    setLayout(null);
    setSheets([]);
    setOverrides({});
    setResults({});
    setExisting(null);
    setShadows(new Set());
    setFilter('all');
    setPage(0);
    setRun({ status: 'idle', current: null, retry: null, stopReason: null });
    wbRef.current = null;
    sheetRef.current = null;
    mediaRef.current = {};
  };

  // The preview appears only once the photos are screened and the cases
  // already in Khozo are known, so no row changes status under the officer's eyes.
  const loadSheet = useCallback(async (index, legacyOpts, existingPromise) => {
    const wb = wbRef.current;
    if (!wb) return;
    setLayout(null);
    setReading(t('Reading the sheet…'));
    await yieldToBrowser();
    const sheet = readSheet(wb, index);
    const nextLayout = detectLayout(sheet, legacyOpts);
    // Photos: inflate the pictures this sheet uses and set Excel's shadow masks aside.
    let media = {};
    const found = new Set();
    if (sheet.images.length) {
      setReading(t('Reading {n} photos…', { n: String(sheet.images.length) }));
      await yieldToBrowser();
      media = loadMedia(wb, sheet.images.map((i) => i.media));
      for (const im of sheet.images) {
        const bytes = media[im.media];
        if (bytes && bytes.length < 3000 && (await isShadowPicture(bytes, im.ext))) found.add(im.media);
      }
    }
    if (existingPromise) setExisting(await existingPromise);
    sheetRef.current = sheet;
    mediaRef.current = media;
    setShadows(found);
    setOverrides({});
    setResults({});
    setSheetVersion((v) => v + 1);
    setLayout(nextLayout);
    setReading('');
  }, [t]);

  /** What is already in Khozo, so a re-run shows those rows before anything is sent. */
  const fetchExisting = () => api.get('/reports').then((d) => d.reports || []).catch(() => []);

  const onFile = async (file) => {
    if (!file) return;
    resetForNewFile();
    setFileName(file.name);
    const ext = extOf(file.name);
    try {
      if (ext === 'xls') throw new Error('xls');
      if (!['xlsx', 'xlsm', 'csv', 'txt', 'tsv'].includes(ext)) throw new Error('type');
      setReading(t('Opening {name}…', { name: file.name }));
      const existingPromise = fetchExisting();
      await yieldToBrowser();
      const buf = new Uint8Array(await file.arrayBuffer());
      if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
        const text = new TextDecoder('utf-8').decode(buf);
        const sheet = csvToSheet(parseCsv(text), file.name);
        const opts = { convert: legacyConvert, heuristic: legacyConvert && gujaratPreset };
        const nextLayout = detectLayout(sheet, opts);
        setExisting(await existingPromise);
        wbRef.current = null;
        sheetRef.current = sheet;
        setHasLegacyFont(false);
        setSheets([{ name: file.name, hidden: false }]);
        setSheetIndex(0);
        setSheetVersion((v) => v + 1);
        setLayout(nextLayout);
        setReading('');
      } else {
        const wb = openWorkbook(buf);
        wbRef.current = wb;
        const legacyFont = usesLegacyFont(wb);
        setHasLegacyFont(legacyFont);
        setSheets(wb.sheets);
        const first = Math.max(0, wb.sheets.findIndex((s) => !s.hidden));
        setSheetIndex(first);
        await loadSheet(first, { convert: legacyConvert, heuristic: legacyConvert && (gujaratPreset || legacyFont) }, existingPromise);
      }
    } catch (err) {
      setReading('');
      setReadError(READ_ERRORS[err.message] || READ_ERRORS['not-a-zip']);
    }
  };

  const onSheetChange = async (index) => {
    setSheetIndex(index);
    await loadSheet(index, legacy, fetchExisting());
  };

  // Batch location: the officer's own jurisdiction, or for the Gujarat
  // register, Gujarat and (when the stations are Ahmedabad City's) Ahmedabad.
  const records = useMemo(() => {
    const sheet = sheetRef.current;
    if (!sheet || !layout) return [];
    const recs = buildRecords(sheet, { headerRow: layout.headerRow, mapping: layout.mapping, preset, legacy });
    return assignPhotos(recs, sheet.images, { shadows, files: photoFiles });
    // sheetVersion stands in for the sheet held in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetVersion, layout, preset, legacy, shadows, photoFiles]);

  useEffect(() => {
    if (!records.length || !gujaratPreset) return;
    if (!state) setPlace((p) => ({ ...p, state: 'Gujarat', stateCode: '24', district: '', districtCode: '' }));
    if (!district && !jurisdiction.district) {
      const keyed = records.filter((r) => r.station?.key && GUJARAT_STATIONS[r.station.key.toLowerCase()]).length;
      // Ahmedabad City's stations: LGD state 24, district 438.
      if (keyed >= records.length / 2) setPlace((p) => ({ ...p, state: 'Gujarat', stateCode: '24', district: 'Ahmedabad', districtCode: '438' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, gujaratPreset]);

  const sourceLabel = useMemo(() => {
    const sheetName = sheets.length > 1 ? sheets[sheetIndex]?.name : null;
    const kind = gujaratPreset ? 'Gujarat Police missing-persons register' : preset === 'other' ? 'portal export' : 'Khozo template';
    return `Bulk import (${kind}) "${fileName}"${sheetName ? `, sheet ${sheetName}` : ''}`;
  }, [sheets, sheetIndex, gujaratPreset, preset, fileName]);

  const batch = useMemo(
    () => ({ ...place, restrictToPolice, sourceLabel, user }),
    [place, restrictToPolice, sourceLabel, user]
  );

  const rows = useMemo(() => records.map((rec) => {
    const o = overrides[rec.key] || {};
    const choices = [rec.photo, ...rec.photoAlternatives].filter(Boolean);
    const photoIndex = o.photoIndex ?? 0;
    const eff = {
      ...rec,
      gender: o.gender || rec.gender,
      photo: photoIndex < choices.length ? choices[photoIndex] : null,
      photoAlternatives: photoIndex < choices.length ? choices.filter((_, i) => i !== photoIndex) : [],
      photoError: o.photoError || false,
    };
    const check = checkRecord(eff);
    const payload = payloadFor(eff, batch);
    const existingReport = existing ? existing.find((r) => matchesExisting(r, eff, payload.fields)) : null;
    const status = check.status === 'error' ? 'error' : existingReport ? 'exists' : check.status;
    const selectable = check.status !== 'error';
    const selected = selectable && (o.selected ?? (status !== 'exists' && !eff.returnedDate));
    return { rec: eff, choices, photoIndex, check, payload, existingReport, status, selectable, selected };
  }), [records, overrides, batch, existing]);

  const counts = useMemo(() => {
    const c = { total: rows.length, ready: 0, warning: 0, error: 0, exists: 0, selected: 0, photos: 0, converted: 0 };
    for (const r of rows) {
      c[r.status]++;
      if (r.selected) c.selected++;
      if (r.rec.photo) c.photos++;
      if (Object.keys(r.rec.converted).length) c.converted++;
    }
    return c;
  }, [rows]);

  const mappingProblems = useMemo(() => {
    if (!layout) return [];
    return FIELDS.filter((f) => f.required && (layout.mapping[f.id] == null || layout.mapping[f.id] === '')).map((f) => f.label);
  }, [layout]);

  const visible = useMemo(
    () => rows.filter((r) => filter === 'all' || r.status === filter || results[r.rec.key]?.status === filter),
    [rows, filter, results],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Thumbnails for the rows on screen, made one at a time in the background.
  const pagePhotos = pageRows.map((r) => r.rec.photo).filter(Boolean);
  const pagePhotosRef = useRef(pagePhotos);
  pagePhotosRef.current = pagePhotos;
  const photoKey = pagePhotos.map((p) => p.id).join('|');
  useEffect(() => {
    let stopped = false;
    (async () => {
      for (const p of pagePhotosRef.current) {
        if (stopped) return;
        if (thumbCache.current.has(p.id)) continue;
        thumbCache.current.set(p.id, null);
        let url = '';
        try {
          const bytes = p.kind === 'file' ? new Uint8Array(await p.file.arrayBuffer()) : mediaRef.current[p.media];
          const blob = await toJpeg(bytes, p.kind === 'file' ? extOf(p.file.name) : p.ext, { maxSide: 160, quality: 0.8 });
          url = URL.createObjectURL(blob);
        } catch {
          url = '';
        }
        thumbCache.current.set(p.id, url);
        setThumbs((m) => ({ ...m, [p.id]: url }));
        await yieldToBrowser();
      }
    })();
    return () => {
      stopped = true;
    };
  }, [photoKey]);

  const setOverride = (key, patch) => setOverrides((o) => ({ ...o, [key]: { ...(o[key] || {}), ...patch } }));

  const onMap = (col, field) => {
    setLayout((l) => {
      const mapping = { ...l.mapping };
      for (const f of Object.keys(mapping)) if (Number(mapping[f]) === col) delete mapping[f];
      if (field) mapping[field] = col;
      return { ...l, mapping };
    });
  };

  const onHeaderRow = (headerRow) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const r = Math.min(headerRow, sheet.maxRow);
    setLayout((l) => ({ ...l, headerRow: r, headers: rowTexts(sheet, r, legacy) }));
  };

  const cyclePhoto = (row) => {
    const n = row.choices.length;
    if (!n) return;
    setOverride(row.rec.key, { photoIndex: (row.photoIndex + 1) % (n + 1), photoError: false });
  };

  const selectWhere = (test) => setOverrides((o) => {
    const next = { ...o };
    for (const r of rows) if (r.selectable) next[r.rec.key] = { ...(next[r.rec.key] || {}), selected: test(r) };
    return next;
  });

  // ---------------------------------------------------------------- import

  const itemFor = (r, extra = {}) => ({
    key: r.rec.key,
    rec: r.rec,
    fields: r.payload.fields,
    categories: r.payload.categories,
    photo: r.rec.photo,
    photoName: `${r.rec.serial || `row-${r.rec.sheetRow}`}.jpg`.replace(/[^\w.\-઀-૿]/g, '_'),
    ...extra,
  });

  const getPhoto = async (item) => {
    const p = item.photo;
    if (!p) return null;
    try {
      const bytes = p.kind === 'file' ? new Uint8Array(await p.file.arrayBuffer()) : mediaRef.current[p.media];
      return await toJpeg(bytes, p.kind === 'file' ? extOf(p.file.name) : p.ext);
    } catch {
      setOverride(item.key, { photoError: true });
      return null;
    }
  };

  const start = async (items) => {
    const control = createControl();
    controlRef.current = control;
    setRun({ status: 'running', current: null, retry: null, stopReason: null });
    const request = makeRequest({
      fetchImpl: (url, init) => fetch(url, init),
      headers: () => {
        const token = localStorage.getItem('khozo_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      sleep: control.sleep,
      isCancelled: () => control.cancelled,
      onRetry: (r) => setRun((s) => ({ ...s, retry: r })),
    });
    const acc = { ...results };
    for (const it of items) if (it.forceDuplicate) delete acc[it.key];
    try {
      await runImport({
        items,
        request,
        control,
        getPhoto,
        delayMs: DELAY_MS,
        results: acc,
        onEvent: (e) => {
          if (e.type === 'row') setRun((s) => ({ ...s, current: e.item.key, retry: null }));
          if (e.type === 'result') setResults({ ...acc });
          if (e.type === 'stopped') setRun((s) => ({ ...s, status: 'done', current: null, retry: null, stopReason: e.reason }));
        },
      });
    } catch (err) {
      setRun({ status: 'done', current: null, retry: null, stopReason: err.status === 401 ? 'session' : 'error', error: err.message });
    }
    setResults({ ...acc });
    api.get('/reports').then((d) => setExisting(d.reports || [])).catch(() => {});
  };

  const startAll = () => {
    const chosen = rows.filter((r) => r.selected);
    // Pin the selection: once imported, a row shows as "already in Khozo" and
    // would otherwise drop out of the default selection and out of the progress count.
    setOverrides((o) => {
      const next = { ...o };
      for (const r of chosen) next[r.rec.key] = { ...(next[r.rec.key] || {}), selected: true };
      return next;
    });
    start(chosen.map((r) => itemFor(r)));
  };
  const forceOne = (row) => start([itemFor(row, { forceDuplicate: true })]);
  const pause = () => {
    controlRef.current?.pause();
    setRun((s) => ({ ...s, status: 'paused' }));
  };
  const resume = () => {
    controlRef.current?.resume();
    setRun((s) => ({ ...s, status: 'running' }));
  };
  const cancel = () => {
    controlRef.current?.cancel();
    setRun((s) => ({ ...s, status: 'stopping' }));
  };

  const selectedRows = rows.filter((r) => r.selected);
  const done = selectedRows.filter((r) => results[r.rec.key]).length;
  const summary = useMemo(() => {
    const s = { created: 0, skipped: 0, review: 0, failed: 0 };
    for (const r of Object.values(results)) s[r.status] = (s[r.status] || 0) + 1;
    return s;
  }, [results]);
  const anyResults = Object.keys(results).length > 0;

  const downloadResults = () => {
    const header = [t('Row'), t('Serial / ID'), t('Name'), t('Gender'), t('Age'), t('Date missing'), t('Status'), t('Case ID'), t('Details')];
    const lines = rows.filter((r) => results[r.rec.key] || r.status === 'error').map((r) => {
      const res = results[r.rec.key];
      const status = res ? res.status : 'error';
      const details = res
        ? res.status === 'review'
          ? (res.candidates || []).map((d) => `${d.reportId} ${d.childName} (${Math.round((d.score || 0) * 100)}%)`).join('; ')
          : res.status === 'failed' ? t(res.message || 'Failed') : res.afterDuplicateWarning ? t('similar cases were other people') : ''
        : r.check.errors.map((e) => t(e.text, textVars(e.vars))).join('; ');
      return [r.rec.sheetRow, r.rec.serial, r.rec.name, genderText(t, r.rec.gender, r.rec.age), r.rec.age ?? '', r.rec.dateOfMissing || '', t(STATUS_LABEL[status]), res?.reportId || '', details];
    });
    const stamp = new Date().toISOString().slice(0, 10);
    download(`khozo-bulk-import-results-${stamp}.csv`, toCsv([header, ...lines]));
  };

  const scopeWarning = ['police', 'sjpu'].includes(user.role) && jurisdiction.district && district && district.trim().toLowerCase() !== jurisdiction.district.trim().toLowerCase();
  const canStart = !running && run.status !== 'stopping' && !mappingProblems.length && counts.selected > 0 && state;

  // ---------------------------------------------------------------- render

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold">{t('Bulk import')}</h2>
        <p className="text-sm text-gray-500">
          {t('Turn a police register or portal export into searchable, face-matchable cases. Nothing is sent until you have checked every row.')}
        </p>
      </div>

      {!formal && (
        <div className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {t('Your account files reports for police verification. Imported cases will wait for an officer to verify them.')}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <PresetPicker preset={preset} onChange={(p) => { setPreset(p); setOverrides({}); }} disabled={running} />

          <div className="card p-5">
            <h3 className="font-semibold">{t('2. Choose the file')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('Excel (.xlsx) or CSV. Photos pasted into the sheet are read with the rows. You can also add photo files named after each row’s serial / ID, for example 17.jpg.')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.xls" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn-primary" onClick={() => fileInput.current?.click()} disabled={running}>
                {fileName ? t('Choose another file') : t('Choose Excel or CSV file')}
              </button>
              <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setPhotoFiles((f) => [...f, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
              <button type="button" className="btn-ghost" onClick={() => photoInput.current?.click()} disabled={running}>
                {t('Add photo files')}
              </button>
              {photoFiles.length > 0 && (
                <span className="text-xs text-gray-600">
                  {t('{n} photo files added', { n: num(photoFiles.length) })}
                  <button type="button" className="ml-2 font-semibold text-khozo hover:underline" onClick={() => setPhotoFiles([])} disabled={running}>{t('Remove')}</button>
                </span>
              )}
            </div>
            {fileName && <p className="mt-3 text-sm"><span className="text-gray-500">{t('File')}:</span> <span className="font-medium">{fileName}</span></p>}
            {sheets.length > 1 && (
              <div className="mt-3 max-w-xs">
                <label className="label">{t('Sheet')}</label>
                <select className="field" value={sheetIndex} onChange={(e) => onSheetChange(Number(e.target.value))} disabled={running}>
                  {sheets.map((s, i) => <option key={`${s.name}-${i}`} value={i}>{s.name}{s.hidden ? ` (${t('hidden')})` : ''}</option>)}
                </select>
              </div>
            )}
            {reading && <p className="mt-3 text-sm text-gray-500" role="status">{reading}</p>}
            {readError && <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(readError)}</div>}
          </div>
        </div>

        <ConnectedSources />
      </div>

      {layout && sheetRef.current && (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{t('3. Check the columns')}</h3>
            <span className="text-xs text-gray-500">{t('{n} rows found below the header', { n: num(counts.total) })}</span>
          </div>
          <MappingTable sheet={sheetRef.current} layout={layout} legacy={legacy} onMap={onMap} onHeaderRow={onHeaderRow} disabled={running} />
          {mappingProblems.length > 0 && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {t('Choose the column that holds: {fields}', { fields: mappingProblems.map((l) => t(l)).join(', ') })}
            </div>
          )}
          <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={legacyConvert} onChange={(e) => setLegacyConvert(e.target.checked)} disabled={running} />
            <span>
              {t('Convert text typed in the old Gujarati font (Vakil) to standard Gujarati')}
              {hasLegacyFont && <span className="block text-xs text-gray-500">{t('This workbook uses the old Gujarati font.')}</span>}
            </span>
          </label>

          <div className="border-t border-black/5 pt-4">
            <h4 className="text-sm font-semibold">{t('For every row in this file')}</h4>
            <div className="mt-3">
              <DistrictPicker
                value={place}
                onChange={(next) => setPlace((p) => ({ ...p, ...next }))}
                allowUnsureDistrict
                unsureLabel={t('Not set')}
                disabled={running}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('Uses your own area, unless a row gives its own State or District.')}</p>
            {scopeWarning && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('Your account covers {mine}. Cases filed for another district will not appear in your case list, so a re-run cannot recognise them.', { mine: jurisdiction.district })}
              </p>
            )}
            <label className="mt-3 flex items-start gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={restrictToPolice} onChange={(e) => setRestrict(e.target.checked)} disabled={running || gujaratPreset} />
              <span>
                {t('Restrict to police roles')}
                <span className="block text-xs text-gray-500">
                  {gujaratPreset
                    ? t('Always on for a police register: these records are visible only to police roles inside the console.')
                    : t('Imported cases are visible only to police roles inside the console.')}
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {layout && rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{t('4. Preview')}</h3>
              <span className="text-xs text-gray-500">{t('Untick any row you do not want to import.')}</span>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-lg bg-gray-100 px-3 py-1.5">{t('{n} rows', { n: num(counts.total) })}</span>
              <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">{t('{n} ready', { n: num(counts.ready) })}</span>
              <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-800">{t('{n} to check', { n: num(counts.warning) })}</span>
              <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700">{t('{n} cannot import', { n: num(counts.error) })}</span>
              {counts.exists > 0 && <span className="rounded-lg bg-sky-50 px-3 py-1.5 text-sky-700">{t('{n} already in Khozo', { n: num(counts.exists) })}</span>}
              <span className="rounded-lg bg-gray-100 px-3 py-1.5">{t('{n} with a photo', { n: num(counts.photos) })}</span>
              {counts.converted > 0 && <span className="rounded-lg bg-violet-50 px-3 py-1.5 text-violet-700">{t('{n} rows converted from the old font', { n: num(counts.converted) })}</span>}
              <span className="rounded-lg bg-khozo-light px-3 py-1.5 font-semibold text-khozo-dark">{t('{n} selected', { n: num(counts.selected) })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[...FILTERS, ...(anyResults ? RESULT_FILTERS : [])].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setFilter(f.id); setPage(0); }}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {t(f.label)}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-gray-200" />
              <button type="button" className="text-xs font-semibold text-khozo hover:underline" onClick={() => selectWhere((r) => r.status !== 'exists' && !r.rec.returnedDate)} disabled={running}>{t('Select all importable')}</button>
              <button type="button" className="text-xs font-semibold text-gray-500 hover:underline" onClick={() => selectWhere(() => false)} disabled={running}>{t('Select none')}</button>
            </div>
          </div>
          <div className="stack-scroll overflow-x-auto">
            <table className="stack-table w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-y border-black/5 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="w-10 px-3 py-3"><span className="sr-only">{t('Import')}</span></th>
                  <th className="px-3 py-3">{t('Row')}</th>
                  <th className="px-3 py-3">{t('Photo')}</th>
                  <th className="px-3 py-3">{t('Name')}</th>
                  <th className="px-3 py-3">{t('Gender')}</th>
                  <th className="px-3 py-3">{t('Age')}</th>
                  <th className="px-3 py-3">{t('Date missing')}</th>
                  <th className="px-3 py-3">{t('Police station / reference')}</th>
                  <th className="px-3 py-3">{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const { rec } = r;
                  const res = results[rec.key];
                  const shownStatus = run.current === rec.key ? 'sending' : res ? res.status : r.status;
                  const thumb = rec.photo ? thumbs[rec.photo.id] : null;
                  const stationText = rec.station ? rec.station.gu || rec.station.en : '';
                  return (
                    <tr key={rec.key} className={`border-b border-black/5 align-top last:border-0 ${r.selected ? '' : 'bg-gray-50/70 text-gray-500'}`}>
                      <td className="px-3 py-3" data-label={t('Import')}>
                        <label className="max-sm:flex max-sm:min-h-11 max-sm:items-center">
                          <input
                            type="checkbox"
                            aria-label={t('Import row {n}', { n: rec.sheetRow })}
                            checked={r.selected}
                            disabled={!r.selectable || running}
                            onChange={(e) => setOverride(rec.key, { selected: e.target.checked })}
                          />
                        </label>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500" data-label={t('Row')}>
                        <span className="font-mono">{rec.sheetRow}</span>
                        {rec.serial && <span className="block">#{rec.serial}</span>}
                      </td>
                      <td className="px-3 py-3" data-label={t('Photo')}>
                        <button
                          type="button"
                          onClick={() => cyclePhoto(r)}
                          disabled={running || !r.choices.length}
                          title={r.choices.length > 1 ? t('Several pictures in this row: click to switch, or to import without a photo') : r.choices.length ? t('Click to import without a photo') : t('No photo')}
                          className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-lg border border-black/10 bg-gray-50 max-sm:text-xs text-gray-400 max-sm:leading-tight sm:h-14 sm:w-14 sm:text-[10px]"
                        >
                          {rec.photo ? (thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span>…</span>) : <span>{t('No photo')}</span>}
                          {r.choices.length > 1 && rec.photo && (
                            <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[10px] text-white">{r.photoIndex + 1}/{r.choices.length}</span>
                          )}
                        </button>
                      </td>
                      <td className="stack-full min-w-[200px] max-w-[280px] px-3 py-3 max-sm:order-first">
                        <p className="font-semibold text-ink">{rec.name || <span className="text-red-600">—</span>}{rec.converted.name && <LegacyMark />}</p>
                        {rec.nameEn && <p className="text-xs text-gray-500">{rec.nameEn}</p>}
                        {rec.address && <p className="line-clamp-2 text-xs text-gray-400" title={rec.address}>{rec.address}</p>}
                      </td>
                      <td className="px-3 py-3" data-label={t('Gender')}>
                        {rec.gender && !overrides[rec.key]?.gender ? (
                          genderText(t, rec.gender, rec.age)
                        ) : (
                          <select
                            className="field py-1 text-xs sm:w-28"
                            value={rec.gender || ''}
                            onChange={(e) => setOverride(rec.key, { gender: e.target.value || undefined })}
                            disabled={running}
                            title={rec.genderText}
                          >
                            <option value="">{t('Choose')}</option>
                            <option value="Male">{(rec.age ?? 0) >= 18 ? t('Man') : t('Boy')}</option>
                            <option value="Female">{(rec.age ?? 0) >= 18 ? t('Woman') : t('Girl')}</option>
                          </select>
                        )}
                        {rec.converted.gender && <LegacyMark />}
                      </td>
                      <td className="px-3 py-3" data-label={t('Age')}>{rec.age ?? '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap" data-label={t('Date missing')}>
                        {rec.dateOfMissing ? fmtIsoDate(rec.dateOfMissing) : <span className="text-red-600">—</span>}
                        {rec.dateApproximate && <span className="block max-sm:text-xs text-amber-700 sm:text-[11px]">{t('approximate')}</span>}
                        {rec.converted.dateMissing && <LegacyMark />}
                      </td>
                      <td className="stack-full max-w-[240px] px-3 py-3 text-xs" data-label={t('Police station / reference')}>
                        {stationText && <p className="font-medium text-gray-700">{stationText}{rec.converted.station && <LegacyMark />}</p>}
                        {rec.firNo && <p className="text-gray-500">{rec.firNo}</p>}
                        {rec.converted.reference && <LegacyMark />}
                      </td>
                      <td className="stack-full min-w-[200px] max-w-[280px] px-3 py-3" data-label={t('Status')}>
                        <Pill status={shownStatus}>{t(STATUS_LABEL[shownStatus])}</Pill>
                        {!res && r.status === 'exists' && r.existingReport && <p className="mt-1 max-sm:text-xs text-sky-700 sm:text-[11px]">{r.existingReport.id}</p>}
                        {res ? (
                          <ResultLine result={res} busy={running} onForce={res.status === 'review' ? () => forceOne(r) : null} />
                        ) : (
                          <Issues check={r.check} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 px-5 py-3 text-sm">
              <button type="button" className="btn-ghost py-1.5" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>{t('Previous')}</button>
              <span className="text-gray-500">{t('Page {page} of {pages}', { page: page + 1, pages: pageCount })}</span>
              <button type="button" className="btn-ghost py-1.5" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>{t('Next')}</button>
            </div>
          )}
        </div>
      )}

      {layout && rows.length > 0 && (
        <div className="card space-y-4 p-5">
          <h3 className="font-semibold">{t('5. Import')}</h3>
          <p className="text-sm text-gray-600">
            {t('{n} selected rows will be registered one at a time, with a short pause between rows while each photo is screened. Rows already in Khozo are skipped, so you can safely run the import again.', { n: num(counts.selected) })}
          </p>
          {running || run.status === 'stopping' || anyResults ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{t('{done} of {total} rows processed', { done: num(done), total: num(selectedRows.length) })}</span>
                {run.status === 'paused' && <span className="text-amber-700">{t('Paused')}</span>}
                {run.status === 'stopping' && <span className="text-gray-500">{t('Stopping after this row…')}</span>}
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={selectedRows.length} aria-valuenow={done}>
                <div className="h-full rounded-full bg-khozo transition-all" style={{ width: `${selectedRows.length ? Math.round((done / selectedRows.length) * 100) : 0}%` }} />
              </div>
              {run.retry && (
                <p className="mt-2 text-xs text-amber-700">
                  {t('Khozo is busy; trying again in {s} s (try {n}).', { s: Math.round(run.retry.wait / 1000), n: run.retry.attempt })}
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!running && run.status !== 'stopping' && (
              <button type="button" className="btn-primary" onClick={startAll} disabled={!canStart}>
                {anyResults ? t('Import remaining rows') : t('Import {n} cases', { n: num(counts.selected) })}
              </button>
            )}
            {run.status === 'running' && <button type="button" className="btn-ghost" onClick={pause}>{t('Pause')}</button>}
            {run.status === 'paused' && <button type="button" className="btn-primary" onClick={resume}>{t('Resume')}</button>}
            {running && <button type="button" className="btn-ghost text-red-700" onClick={cancel}>{t('Cancel')}</button>}
          </div>
          {!state && <p className="text-xs text-red-700">{t('Choose the state these cases belong to.')}</p>}

          {run.stopReason === 'session' && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t('You have been signed out. Sign in again in another tab, then press Import remaining rows: rows already imported are skipped.')}</div>
          )}
          {run.stopReason === 'error' && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t('The import stopped: {error}', { error: run.error || '' })}</div>
          )}

          {anyResults && !running && run.status !== 'stopping' && (
            <div className="rounded-xl border border-black/5 bg-gray-50 p-4">
              <h4 className="font-semibold">{run.stopReason === 'cancelled' ? t('Import cancelled') : t('Import finished')}</h4>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-white p-3"><p className="text-2xl font-bold text-emerald-700">{summary.created}</p><p className="text-xs text-gray-500">{t('Created')}</p></div>
                <div className="rounded-lg bg-white p-3"><p className="text-2xl font-bold text-sky-700">{summary.skipped}</p><p className="text-xs text-gray-500">{t('Skipped (already imported)')}</p></div>
                <div className="rounded-lg bg-white p-3"><p className="text-2xl font-bold text-amber-700">{summary.review}</p><p className="text-xs text-gray-500">{t('Needs review')}</p></div>
                <div className="rounded-lg bg-white p-3"><p className="text-2xl font-bold text-red-700">{summary.failed}</p><p className="text-xs text-gray-500">{t('Failed')}</p></div>
              </div>
              {summary.review > 0 && <p className="mt-3 text-xs text-gray-600">{t('Rows that need review may be a person already registered. Use the Needs review filter in the table above and decide one by one.')}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" onClick={downloadResults}>{t('Download results (CSV)')}</button>
                <Link to="/app/cases" className="btn-primary">{t('Open Cases & FIRs')}</Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
