/*
 * State and district, chosen from the gazetteer rather than typed.
 *
 * A typed district was free text everywhere: "અમદાવાદ" or "Ahmdabad" never
 * reached the Ahmedabad desks. This picker offers the real list, with every
 * name in the reader's language (and the English one beside it), searchable
 * by typing any of the four, so a phone user finds "Vadodara" by typing
 * "baroda", "વડોદરા" or "वडोदरा".
 *
 * The state list is bundled (shared/geo/states.js), so the sighting form works
 * with no signal. Districts come from GET /api/geo/districts and are kept on
 * the phone once fetched; with neither, the district falls back to a text box
 * and the server places what was typed (shared/geo/index.js canonicalPlace).
 *
 * `value` and `onChange` carry { state, stateCode, district, districtCode }:
 * English canonical names, which is what the server stores, and LGD codes.
 * `allowUnsure` adds a "Not sure" choice for citizens: it sends no place, and
 * the phone's location decides.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { currentLocale, useLanguage, useT } from './i18n.jsx';
import { resolveState, STATES } from '../../shared/geo/states.js';
import { geoKey } from '../../shared/geo/normalise.js';

const CACHE_PREFIX = 'khozo.geo.districts.v1.';
const loaded = new Map();

function readCache(code) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_PREFIX + code) || 'null');
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(code, list) {
  try {
    window.localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(list));
  } catch {
    // Private mode or a full store: the list is fetched again next time.
  }
}

/**
 * A state's districts: from this phone if it has them (refreshed quietly),
 * else from the API. Rejects only when neither has them.
 */
export function loadDistricts(code) {
  if (!code) return Promise.resolve([]);
  if (loaded.has(code)) return loaded.get(code);
  const fetched = api.get(`/geo/districts?state=${encodeURIComponent(code)}`).then((data) => {
    const list = Array.isArray(data?.districts) ? data.districts.filter((d) => d && d.code && d.name) : [];
    if (list.length) writeCache(code, list);
    return list;
  });
  const cached = readCache(code);
  const promise = cached
    ? Promise.resolve(cached)
    : fetched.catch((err) => {
        loaded.delete(code);
        throw err;
      });
  if (cached) fetched.then((list) => list.length && loaded.set(code, Promise.resolve(list))).catch(() => {});
  loaded.set(code, promise);
  return promise;
}

const nameIn = (names, lang, fallback) => (names && (names[lang] || names.en)) || fallback || '';

/**
 * A text box that filters a list, for choosing one of many on a phone. The
 * list opens on focus; typing narrows it by any of the option's names.
 */
function Combobox({ id, label, required, disabled, options, value, onChange, placeholder, emptyText }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const selected = options.find((o) => o.value === value) || null;
  const shown = useMemo(() => {
    const q = geoKey(query);
    if (!q) return options;
    return options.filter((o) => o.keys.some((k) => k.includes(q)));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children?.[active];
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const choose = (option) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const listId = `${id}-options`;
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="label">{label}{required && ' *'}</label>
      <input
        id={id}
        className="field w-full"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-o-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        disabled={disabled}
        value={open ? query : selected?.label || ''}
        placeholder={open && selected ? selected.label : placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
      />
      {open && !disabled && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {shown.map((option, i) => (
            <li
              key={option.value || 'unsure'}
              id={`${id}-o-${i}`}
              role="option"
              aria-selected={option.value === value}
              // mousedown, not click: the text box keeps focus, so the list is
              // not closed by its blur before the choice lands.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                i === active ? 'bg-khozo-light text-khozo-dark' : 'text-ink'
              } ${option.value === value ? 'font-semibold' : ''}`}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.sub && <span className="shrink-0 text-xs text-gray-400">{option.sub}</span>}
            </li>
          ))}
          {!shown.length && <li className="px-3 py-2 text-gray-400">{emptyText || t('No match')}</li>}
        </ul>
      )}
    </div>
  );
}

export default function DistrictPicker({
  value = {},
  onChange,
  allowUnsure = false,
  // "Not sure" for the district only: the state is still required.
  allowUnsureDistrict = allowUnsure,
  required = false,
  lockState = false,
  showDistrict = true,
  disabled = false,
  stateLabel,
  districtLabel,
  unsureLabel,
  className = 'grid gap-4 sm:grid-cols-2',
}) {
  const t = useT();
  const { lang } = useLanguage();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const stateCode = value.stateCode || resolveState(value.state)?.code || '';
  const [districts, setDistricts] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const notSure = unsureLabel || t('Not sure');
  // Only the four place fields ever go back out: a form passing its whole
  // state as `value` must not have its other fields overwritten from here.
  const current = {
    state: value.state || '',
    stateCode: value.stateCode || '',
    district: value.district || '',
    districtCode: value.districtCode || '',
  };

  useEffect(() => {
    let live = true;
    setDistricts(null);
    setLoadFailed(false);
    if (!stateCode || !showDistrict) return undefined;
    loadDistricts(stateCode)
      .then((list) => live && setDistricts(list))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [stateCode, showDistrict]);

  // A value that arrived as names only (an account's jurisdiction, a preset)
  // is given its codes once the lists are known.
  useEffect(() => {
    if (!value.state || value.stateCode || !stateCode) return;
    const state = STATES.find((s) => s.code === stateCode);
    onChange({ ...current, state: state?.name || value.state, stateCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.state, value.stateCode, stateCode]);
  useEffect(() => {
    if (!districts || !value.district || value.districtCode) return;
    const key = geoKey(value.district);
    const hit = districts.find((d) => Object.values(d.names || {}).concat(d.name).some((n) => geoKey(n) === key));
    if (hit) onChange({ ...current, stateCode, district: hit.name, districtCode: hit.code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districts, value.district, value.districtCode]);

  const stateOptions = useMemo(() => {
    const locale = currentLocale();
    const rows = STATES.map((s) => ({
      value: s.code,
      label: (lang !== 'en' && s[lang]) || s.name,
      sub: lang !== 'en' ? s.name : null,
      keys: [s.name, s.gu, s.hi, s.mr, ...(s.aliases || [])].map(geoKey).filter(Boolean),
    })).sort((a, b) => a.label.localeCompare(b.label, locale));
    return allowUnsure ? [{ value: '', label: notSure, keys: [geoKey(notSure)] }, ...rows] : rows;
  }, [lang, allowUnsure, notSure]);

  const districtOptions = useMemo(() => {
    if (!districts) return [];
    const locale = currentLocale();
    const rows = districts.map((d) => ({
      value: d.code,
      label: nameIn(d.names, lang, d.name),
      sub: [lang !== 'en' ? d.name : null, d.kind === 'police' ? t('police') : null].filter(Boolean).join(' · ') || null,
      keys: [d.name, ...Object.values(d.names || {})].map(geoKey).filter(Boolean),
    })).sort((a, b) => a.label.localeCompare(b.label, locale));
    return allowUnsureDistrict ? [{ value: '', label: notSure, keys: [geoKey(notSure)] }, ...rows] : rows;
  }, [districts, lang, allowUnsureDistrict, notSure, t]);

  const chooseState = (code) => {
    const state = STATES.find((s) => s.code === code);
    onChange({ state: state?.name || '', stateCode: state?.code || '', district: '', districtCode: '' });
  };
  const chooseDistrict = (code) => {
    const district = districts?.find((d) => d.code === code);
    onChange({ ...current, stateCode, district: district?.name || '', districtCode: district?.code || '' });
  };

  return (
    <div className={className}>
      <Combobox
        id={`${uid}-state`}
        label={stateLabel || t('State')}
        required={required}
        disabled={disabled || lockState}
        options={stateOptions}
        value={stateCode}
        onChange={chooseState}
        placeholder={allowUnsure ? notSure : t('Choose a state')}
      />
      {showDistrict && (
        loadFailed ? (
          <div className="min-w-0">
            <label htmlFor={`${uid}-district-text`} className="label">{districtLabel || t('District')}{required && ' *'}</label>
            <input
              id={`${uid}-district-text`}
              className="field w-full"
              value={value.district || ''}
              onChange={(e) => onChange({ ...current, stateCode, district: e.target.value, districtCode: '' })}
              disabled={disabled}
              autoComplete="off"
              placeholder={t('Type the district')}
            />
            <p className="mt-1 text-xs text-gray-500">{t('The district list could not be loaded. Type the district; it will be matched when your report is received.')}</p>
          </div>
        ) : (
          <Combobox
            id={`${uid}-district`}
            label={districtLabel || t('District')}
            required={required}
            disabled={disabled || !stateCode || !districts}
            options={districtOptions}
            value={value.districtCode || ''}
            onChange={chooseDistrict}
            placeholder={!stateCode ? t('Choose the state first') : !districts ? t('Loading districts…') : allowUnsureDistrict ? notSure : t('Choose a district')}
            emptyText={t('No district by that name. Try another spelling.')}
          />
        )
      )}
    </div>
  );
}
